-- Migration 026: mixed-stack movements + combat v2. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
-- Constants here MUST stay in sync with src/war/*.js (guarded by src/war/parity.test.js):
--   RNG band: effective strength × (0.85 + random()*0.30)   (combat.js RNG_MIN/RNG_SPAN)
--   retreat:  a losing attacker keeps 0.25 of each unit type (combat.js RETREAT_FRACTION)
--   unit strengths soldier 1 / tank 5 / jet 3 / warship 2    (units.js)
-- Movements now carry a mixed `units` jsonb {soldier,tank,jet,warship}; the whole
-- stack fights as one force (incl. warship-ferried land units) on arrival.

alter table public.war_movements add column if not exists units jsonb not null default '{}'::jsonb;

-- Strength of a jsonb stack. Mirrors war_unit_strength() / src/war/combat.js stackStrength.
create or replace function public.war_stack_strength(s jsonb) returns numeric
language sql immutable as $$
  select coalesce((s->>'soldier')::numeric,0)*1 + coalesce((s->>'tank')::numeric,0)*5
       + coalesce((s->>'jet')::numeric,0)*3 + coalesce((s->>'warship')::numeric,0)*2;
$$;

create or replace function public.war_tick() returns void
language plpgsql security definer set search_path = public as $$
declare
  mv          record;
  dest        record;
  atk_lab     int;
  attack_mult numeric;
  a_str       numeric;
  d_str       numeric;
  a_eff       numeric;
  d_eff       numeric;
  def_bunker  int;
  def_aa      int;
  def_mult    numeric;
  aa          numeric;
  def_shield  timestamptz;
  def_active  timestamptz;
  surv_ratio  numeric;
  ratio       numeric;
  def_raw     numeric;
  loot        int;
  aname       text;
  acolor      text;
  s_sol       numeric;
  s_tank      numeric;
  s_jet       numeric;
  s_ship      numeric;
begin
  -- 1) Resolve arrivals (oldest first; skip rows another tick already grabbed).
  for mv in
    select * from public.war_movements
    where status = 'moving' and arrives_at <= now()
    order by arrives_at
    for update skip locked
  loop
    update public.war_movements set status = 'arrived' where id = mv.id;

    -- decompose the mixed stack once
    s_sol  := coalesce((mv.units->>'soldier')::numeric, 0);
    s_tank := coalesce((mv.units->>'tank')::numeric, 0);
    s_jet  := coalesce((mv.units->>'jet')::numeric, 0);
    s_ship := coalesce((mv.units->>'warship')::numeric, 0);

    select display_name, color into aname, acolor from public.war_players where user_id = mv.player_id;
    select coalesce(sum(level), 0) into atk_lab from public.war_buildings where owner_id = mv.player_id and type = 'lab';
    attack_mult := 1 + 0.1 * atk_lab;
    a_str := public.war_stack_strength(mv.units) * attack_mult;

    select * into dest from public.war_regions where region_id = mv.to_region for update;

    if not found or dest.owner_id is null then
      ------------------------------------------------- unclaimed: fight the garrison
      d_str := public.war_neutral_soldiers(mv.to_region); -- soldiers, strength 1
      a_eff := a_str * (0.85 + random() * 0.30);
      d_eff := d_str * (0.85 + random() * 0.30);
      if a_eff > d_eff then
        surv_ratio := (a_eff - d_eff) / a_eff;
        insert into public.war_regions(region_id, country_code, owner_id, owner_name, color, is_hq, soldier, tank, jet, warship, updated_at)
        values (mv.to_region, null, mv.player_id, aname, acolor, false, 0, 0, 0, 0, now())
        on conflict (region_id) do update
          set owner_id = excluded.owner_id, owner_name = excluded.owner_name, color = excluded.color,
              is_hq = false, soldier = 0, tank = 0, jet = 0, warship = 0, updated_at = now();
        update public.war_regions set
          soldier = greatest(0, floor(s_sol  * surv_ratio)),
          tank    = greatest(0, floor(s_tank * surv_ratio)),
          jet     = greatest(0, floor(s_jet  * surv_ratio)),
          warship = greatest(0, floor(s_ship * surv_ratio)),
          updated_at = now()
        where region_id = mv.to_region;
        -- ensureSurvivor: never leave a captured region with 0 units
        update public.war_regions set soldier = 1
          where region_id = mv.to_region and (soldier + tank + jet + warship) = 0;
        perform public.war_log_event(mv.player_id, 'captured', mv.to_region,
          jsonb_build_object('neutral', true, 'coins', 0));
      end if; -- else: attack failed, units lost

    elsif dest.owner_id = mv.player_id then
      ------------------------------------------------- reinforce own province (whole stack)
      update public.war_regions set
        soldier = soldier + s_sol, tank = tank + s_tank, jet = jet + s_jet, warship = warship + s_ship,
        updated_at = now()
      where region_id = mv.to_region;

    else
      ------------------------------------------------- enemy province
      select shield_until, last_active_at into def_shield, def_active
      from public.war_players where user_id = dest.owner_id;

      if def_shield is not null and def_shield > now() then
        -- shielded: bounce the whole stack home, no combat. Only if the origin is
        -- still owned by the sender (never gift units to whoever took it meanwhile).
        update public.war_regions set
          soldier = soldier + s_sol, tank = tank + s_tank, jet = jet + s_jet, warship = warship + s_ship,
          updated_at = now()
        where region_id = mv.from_region and owner_id = mv.player_id;
        perform public.war_log_event(mv.player_id, 'bounced', mv.to_region, '{}'::jsonb);
      else
        select coalesce(sum(level), 0) into def_bunker from public.war_buildings where region_id = mv.to_region and type = 'bunker';
        select coalesce(sum(level), 0) into def_aa     from public.war_buildings where region_id = mv.to_region and type = 'antiair';
        def_mult := 1 + 0.5 * def_bunker;
        -- offline dug-in bonus: inactive > 24h defends 50% harder
        if def_active is null or def_active < now() - interval '24 hours' then def_mult := def_mult * 1.5; end if;
        aa := least(0.75, 0.25 * def_aa);
        -- anti-air removes a share of the incoming jet contribution before the clash
        a_str := a_str - aa * s_jet * 3 * attack_mult;
        a_str := greatest(0, a_str);

        def_raw := dest.soldier * 1 + dest.tank * 5 + dest.jet * 3 + dest.warship * 2;
        d_str := def_raw * def_mult;

        a_eff := a_str * (0.85 + random() * 0.30);
        d_eff := d_str * (0.85 + random() * 0.30);

        if a_eff > d_eff then
          -- capture: scaled mixed survivors, spoils, building downgrade
          surv_ratio := (a_eff - d_eff) / a_eff;
          loot := floor(0.8 * def_raw * 5); -- lootFraction(full kill)=0.8 × defStrength × COIN_PER_STRENGTH(5)
          if loot > 0 then
            insert into public.wallets (user_id, balance) values (mv.player_id, loot)
            on conflict (user_id) do update set balance = public.wallets.balance + excluded.balance;
          end if;
          delete from public.war_buildings where region_id = mv.to_region and level <= 1;
          update public.war_buildings set level = level - 1, owner_id = mv.player_id where region_id = mv.to_region and level > 1;
          update public.war_regions
            set owner_id = mv.player_id, owner_name = aname, color = acolor, is_hq = false,
                soldier = greatest(0, floor(s_sol  * surv_ratio)),
                tank    = greatest(0, floor(s_tank * surv_ratio)),
                jet     = greatest(0, floor(s_jet  * surv_ratio)),
                warship = greatest(0, floor(s_ship * surv_ratio)),
                updated_at = now()
          where region_id = mv.to_region;
          update public.war_regions set soldier = 1
            where region_id = mv.to_region and (soldier + tank + jet + warship) = 0;
          perform public.war_log_event(mv.player_id, 'captured', mv.to_region,
            jsonb_build_object('coins', loot, 'opponent', dest.owner_name));
          perform public.war_log_event(dest.owner_id, 'lost', mv.to_region,
            jsonb_build_object('opponent', aname));
        else
          -- defender holds: scale survivors down, then attacker retreats 25% home
          ratio := (d_eff - a_eff) / d_eff;
          update public.war_regions
            set soldier = floor(soldier * ratio), tank = floor(tank * ratio),
                jet = floor(jet * ratio), warship = floor(warship * ratio), updated_at = now()
          where region_id = mv.to_region;
          update public.war_regions set soldier = 1
            where region_id = mv.to_region and (soldier + tank + jet + warship) = 0;
          -- attacker retreat (only if the origin is still owned by the sender)
          update public.war_regions set
            soldier = soldier + floor(s_sol  * 0.25),
            tank    = tank    + floor(s_tank * 0.25),
            jet     = jet     + floor(s_jet  * 0.25),
            warship = warship + floor(s_ship * 0.25),
            updated_at = now()
          where region_id = mv.from_region and owner_id = mv.player_id;
          perform public.war_log_event(dest.owner_id, 'defended', mv.to_region,
            jsonb_build_object('opponent', aname));
          perform public.war_log_event(mv.player_id, 'attack_failed', mv.to_region,
            jsonb_build_object('opponent', dest.owner_name));
        end if;
      end if;
    end if;
  end loop;

  -- 2) Accrue capped income into each player's vault (50 coins/bank-level/hour, cap ≈ 10h).
  --    (Per-province income is added in migration 027.) See 023/025 for the rationale on
  --    carrying the sub-coin remainder forward and keeping last_income_at at now() for lv=0.
  with bank as (
    select p.user_id, p.vault, p.last_income_at,
           coalesce((select sum(level) from public.war_buildings b
                     where b.owner_id = p.user_id and b.type = 'bank'), 0) as lv
    from public.war_players p
  ), calc as (
    select user_id, vault, last_income_at, lv,
           floor(lv * 50 * greatest(0, extract(epoch from (now() - last_income_at)) / 3600.0)) as accrued,
           lv * 50 * 10 as cap
    from bank
  )
  update public.war_players p set
    vault = least(p.vault + c.accrued, greatest(p.vault, c.cap))::int,
    last_income_at = case
      when c.lv = 0      then now()
      when c.accrued > 0 then p.last_income_at + (c.accrued::numeric / (c.lv * 50)) * interval '1 hour'
      else p.last_income_at
    end
  from calc c where c.user_id = p.user_id;

  -- 3) Refresh alive flag (no regions left = not alive, can respawn by buying).
  update public.war_players p set
    is_alive = exists (select 1 from public.war_regions r where r.owner_id = p.user_id);

  -- 4) Prune old activity log entries (7-day retention).
  delete from public.war_events where created_at < now() - interval '7 days';
end;
$$;

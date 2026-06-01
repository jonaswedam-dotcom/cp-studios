-- Migration 027: per-province income. Idempotent. Tick body copied from 026 with
-- only the income step changed: rate = banks×50 + provinces×10 (coins/hr), cap = rate×10h.
-- INCOME_PER_PROVINCE_PER_HOUR=10 MUST match src/war/buildings.js (parity.test.js).

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
          -- defender holds: scale survivors down, then attacker retreats 25% home.
          -- Guard d_eff>0: a zeroed attacker (a_eff=0) vs an empty garrison (d_eff=0)
          -- lands here, and (d_eff-a_eff)/d_eff would divide by zero and abort the whole tick.
          if d_eff > 0 then
            ratio := (d_eff - a_eff) / d_eff;
            update public.war_regions
              set soldier = floor(soldier * ratio), tank = floor(tank * ratio),
                  jet = floor(jet * ratio), warship = floor(warship * ratio), updated_at = now()
            where region_id = mv.to_region;
          end if;
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

  -- 2) Accrue capped income: banks×50 + provinces×10 (coins/hr), cap = rate×10h.
  with base as (
    select p.user_id, p.vault, p.last_income_at,
           coalesce((select sum(level) from public.war_buildings b where b.owner_id = p.user_id and b.type='bank'),0) as banklv,
           (select count(*) from public.war_regions r where r.owner_id = p.user_id) as provinces
    from public.war_players p
  ), calc as (
    select user_id, vault, last_income_at,
           (banklv*50 + provinces*10) as rate,
           floor((banklv*50 + provinces*10) * greatest(0, extract(epoch from (now()-last_income_at))/3600.0)) as accrued
    from base
  )
  update public.war_players p set
    vault = least(p.vault + c.accrued, greatest(p.vault, c.rate*10))::int,
    last_income_at = case
      when c.rate = 0    then now()
      when c.accrued > 0 then p.last_income_at + (c.accrued::numeric / c.rate) * interval '1 hour'
      else p.last_income_at end
  from calc c where c.user_id = p.user_id;

  -- 3) Refresh alive flag (no regions left = not alive, can respawn by buying).
  update public.war_players p set
    is_alive = exists (select 1 from public.war_regions r where r.owner_id = p.user_id);

  -- 4) Prune old activity log entries (7-day retention).
  delete from public.war_events where created_at < now() - interval '7 days';
end;
$$;

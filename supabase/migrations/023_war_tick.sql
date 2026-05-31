-- Migration 023: CP War server-side resolution + income. Idempotent (create or replace).
-- ─────────────────────────────────────────────────────────────────────────────
-- Constants here MUST stay in sync with src/war/{units,buildings,spoils,neutral}.js:
--   unit strengths soldier 1 / tank 5 / jet 3 / warship 2  (units.js)
--   bunker +0.5/lvl, antiair min(.75,.25/lvl), lab +0.1/lvl  (buildings.js)
--   bank income 50 coins/level/hour, vault cap = 10h          (buildings.js)
--   loot = 0.8 * defenderStrength * 5                          (spoils.js COIN_PER_STRENGTH=5)
--   neutral garrison h=(h*31+ascii)>>>0; 50 + h%251           (neutral.js)

-- Unit strengths — MUST match src/war/units.js.
create or replace function public.war_unit_strength(t text) returns numeric
language sql immutable as $$
  select case t when 'soldier' then 1 when 'tank' then 5 when 'jet' then 3 when 'warship' then 2 else 1 end;
$$;

-- Neutral garrison soldiers — MUST match src/war/neutral.js (h = (h*31+code)>>>0; 50 + h%251).
create or replace function public.war_neutral_soldiers(rid text) returns integer
language plpgsql immutable as $$
declare h bigint := 0; i int;
begin
  for i in 1..length(rid) loop
    h := (h * 31 + ascii(substr(rid, i, 1))) % 4294967296;
  end loop;
  return 50 + (h % 251)::int;
end;
$$;

-- Collect a player's accrued income vault into their wallet; also stamps activity.
create or replace function public.war_collect_income() returns integer
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select vault into v from public.war_players where user_id = uid for update;
  if v is null then
    update public.war_players set last_active_at = now() where user_id = uid;
    return 0;
  end if;
  update public.war_players set vault = 0, last_active_at = now() where user_id = uid;
  if v > 0 then
    insert into public.wallets (user_id, balance) values (uid, v)
    on conflict (user_id) do update set balance = public.wallets.balance + excluded.balance;
  end if;
  return v;
end;
$$;

-- The world tick: resolve due movements, then accrue capped income, then refresh is_alive.
create or replace function public.war_tick() returns void
language plpgsql security definer set search_path = public as $$
declare
  mv          record;
  dest        record;
  atk_lab     int;
  attack_mult numeric;
  unit_str    numeric;
  a_str       numeric;
  d_str       numeric;
  def_bunker  int;
  def_aa      int;
  def_mult    numeric;
  aa          numeric;
  def_shield  timestamptz;
  def_active  timestamptz;
  surv        int;
  ratio       numeric;
  def_raw     numeric;
  loot        int;
  aname       text;
  acolor      text;
begin
  -- 1) Resolve arrivals (oldest first; skip rows another tick already grabbed).
  for mv in
    select * from public.war_movements
    where status = 'moving' and arrives_at <= now()
    order by arrives_at
    for update skip locked
  loop
    update public.war_movements set status = 'arrived' where id = mv.id;

    select display_name, color into aname, acolor from public.war_players where user_id = mv.player_id;
    select coalesce(sum(level), 0) into atk_lab from public.war_buildings where owner_id = mv.player_id and type = 'lab';
    attack_mult := 1 + 0.1 * atk_lab;
    unit_str := public.war_unit_strength(mv.unit_type);
    a_str := mv.count * unit_str * attack_mult;

    select * into dest from public.war_regions where region_id = mv.to_region for update;

    if not found or dest.owner_id is null then
      ------------------------------------------------- unclaimed: fight the garrison
      d_str := public.war_neutral_soldiers(mv.to_region); -- soldiers, strength 1
      if a_str > d_str then
        surv := greatest(1, floor(mv.count * (a_str - d_str) / a_str)); -- ensureSurvivor parity
        insert into public.war_regions(region_id, country_code, owner_id, owner_name, color, is_hq, soldier, tank, jet, warship, updated_at)
        values (mv.to_region, null, mv.player_id, aname, acolor, false, 0, 0, 0, 0, now())
        on conflict (region_id) do update
          set owner_id = excluded.owner_id, owner_name = excluded.owner_name, color = excluded.color,
              is_hq = false, soldier = 0, tank = 0, jet = 0, warship = 0, updated_at = now();
        execute format('update public.war_regions set %I = %s, updated_at = now() where region_id = %L',
                       mv.unit_type, surv, mv.to_region);
      end if; -- else: attack failed, units lost

    elsif dest.owner_id = mv.player_id then
      ------------------------------------------------- reinforce own province
      execute format('update public.war_regions set %I = %I + %s, updated_at = now() where region_id = %L',
                     mv.unit_type, mv.unit_type, mv.count, mv.to_region);

    else
      ------------------------------------------------- enemy province
      select shield_until, last_active_at into def_shield, def_active
      from public.war_players where user_id = dest.owner_id;

      if def_shield is not null and def_shield > now() then
        -- shielded: bounce the units back home, no combat. Only if the origin is
        -- still owned by the sender (never gift units to whoever took it meanwhile).
        execute format('update public.war_regions set %I = %I + %s, updated_at = now() where region_id = %L and owner_id = %L',
                       mv.unit_type, mv.unit_type, mv.count, mv.from_region, mv.player_id);
      else
        select coalesce(sum(level), 0) into def_bunker from public.war_buildings where region_id = mv.to_region and type = 'bunker';
        select coalesce(sum(level), 0) into def_aa     from public.war_buildings where region_id = mv.to_region and type = 'antiair';
        def_mult := 1 + 0.5 * def_bunker;
        -- offline dug-in bonus: inactive > 24h defends 50% harder
        if def_active is null or def_active < now() - interval '24 hours' then def_mult := def_mult * 1.5; end if;
        aa := least(0.75, 0.25 * def_aa);
        if mv.unit_type = 'jet' then a_str := a_str * (1 - aa); end if;

        def_raw := dest.soldier * 1 + dest.tank * 5 + dest.jet * 3 + dest.warship * 2;
        d_str := def_raw * def_mult;

        if a_str > d_str then
          -- capture: attacker survivors (single unit type), spoils, building downgrade
          surv := greatest(1, floor(mv.count * (a_str - d_str) / a_str)); -- ensureSurvivor parity
          loot := floor(0.8 * def_raw * 5); -- lootFraction(full kill)=0.8 × defStrength × COIN_PER_STRENGTH(5)
          if loot > 0 then
            insert into public.wallets (user_id, balance) values (mv.player_id, loot)
            on conflict (user_id) do update set balance = public.wallets.balance + excluded.balance;
          end if;
          delete from public.war_buildings where region_id = mv.to_region and level <= 1;
          update public.war_buildings set level = level - 1, owner_id = mv.player_id where region_id = mv.to_region and level > 1;
          update public.war_regions
            set owner_id = mv.player_id, owner_name = aname, color = acolor, is_hq = false,
                soldier = 0, tank = 0, jet = 0, warship = 0, updated_at = now()
          where region_id = mv.to_region;
          execute format('update public.war_regions set %I = %s, updated_at = now() where region_id = %L',
                         mv.unit_type, surv, mv.to_region);
        else
          -- defender holds: scale survivors down, but never to a 0-unit ghost province
          ratio := (d_str - a_str) / d_str;
          update public.war_regions
            set soldier = floor(soldier * ratio), tank = floor(tank * ratio),
                jet = floor(jet * ratio), warship = floor(warship * ratio), updated_at = now()
          where region_id = mv.to_region;
          update public.war_regions set soldier = 1
            where region_id = mv.to_region and (soldier + tank + jet + warship) = 0;
        end if;
      end if;
    end if;
  end loop;

  -- 2) Accrue capped income into each player's vault (cap ≈ 10h of bank income).
  --    Never reduce an existing vault if banks were lost (greatest(vault, cap)).
  update public.war_players p set
    vault = least(
      p.vault + floor(
        (select coalesce(sum(level), 0) from public.war_buildings b where b.owner_id = p.user_id and b.type = 'bank')
        * 50 * greatest(0, extract(epoch from (now() - p.last_income_at)) / 3600.0)
      ),
      greatest(
        p.vault,
        (select coalesce(sum(level), 0) from public.war_buildings b where b.owner_id = p.user_id and b.type = 'bank') * 50 * 10
      )
    )::int,
    last_income_at = now();

  -- 3) Refresh alive flag (no regions left = not alive, can respawn by buying).
  update public.war_players p set
    is_alive = exists (select 1 from public.war_regions r where r.owner_id = p.user_id);
end;
$$;

-- Migration 052: server-authoritative CP War economy. ADDITIVE & idempotent.
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  APPLY FIRST (before the 053 lockdown), exactly like 044-before-045.         ║
-- ║  This migration does NOT break the old client: it only ADDS RPCs. The old    ║
-- ║  direct-write client keeps working until 053 revokes those writes.           ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY: until now the war economy was client-authoritative. RLS let a player write
-- their OWN war_regions / war_buildings rows and INSERT war_movements with an
-- arbitrary `units` stack, while the cost was deducted by a SEPARATE client call.
-- So any signed-in user could, with a raw anon-key call (the key ships in the
-- public bundle / the repo is public):
--   • set soldier/tank/jet to 2e9 for free            (free unlimited army)
--   • insert a movement with a phantom `units` stack   (conquer anyone)
--   • insert buildings / set level arbitrarily for free(free banks → income mint,
--     which re-opened the wallet mint that migration 045 closed)
-- These DEFINER RPCs make acquisition + force-movement server-authoritative:
-- cost is computed HERE, the wallet/units are debited HERE, ownership is checked
-- HERE. Combat INPUTS can no longer be fabricated because the source province is
-- debited inside war_send_units. Constants MUST stay in sync with
-- src/war/{units,economy,buildings}.js — guarded by src/war/parity.test.js.
-- ─────────────────────────────────────────────────────────────────────────────

-- Build/upgrade cost ladder — mirrors buildings.js BUILDINGS[*].cost / buildingCost().
-- 1-indexed array; an out-of-range level returns NULL = "already max" (Infinity in JS).
create or replace function public.war_building_cost(p_type text, p_level integer)
returns integer language sql immutable set search_path = public as $$
  select (case p_type
    when 'bunker'  then (array[800,1600,3200])[p_level + 1]
    when 'antiair' then (array[1000,2000,4000])[p_level + 1]
    when 'factory' then (array[1500,3000,6000])[p_level + 1]
    when 'lab'     then (array[1500,3000,6000])[p_level + 1]
    when 'bank'    then (array[1200,2400,4800])[p_level + 1]
    when 'port'    then (array[2500])[p_level + 1]
  end);
$$;

-- ── war_buy_units: deploy units onto a province you own (or respawn) ──────────
-- Server computes the price (unit cost × count × factory discount × army surcharge),
-- debits the wallet atomically, then adds the units. Mirrors economy.js troopCost +
-- armySizeMultiplier and buildings.js costMultiplier. Returns the new balance.
create or replace function public.war_buy_units(p_region text, p_type text, p_count integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid         uuid := auth.uid();
  v_unit_cost integer;
  v_strength  numeric;
  v_factory   integer;
  v_army_mult numeric;
  v_cost_mult numeric;
  v_cost      numeric;   -- numeric (not int): absurd orders overflow int4; balance>=v_cost
  v_owned     integer;    -- then keeps the affordable subtraction in range. See test B / 056.
  v_balance   integer;
  v_name      text;
  v_color     text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_count is null or p_count < 1 then raise exception 'invalid count'; end if;
  if p_type not in ('soldier','tank','jet','warship') then raise exception 'invalid unit type'; end if;

  -- unit base price — mirrors units.js UNITS[*].cost
  v_unit_cost := case p_type when 'soldier' then 100 when 'tank' then 400 when 'jet' then 800 when 'warship' then 4000 end;

  -- anti-snowball army-size surcharge on the caller's TOTAL army strength
  -- (warship weight 20 matches units.js / migration 036). economy.js armySizeMultiplier.
  select coalesce(sum(soldier * 1 + tank * 5 + jet * 3 + warship * 20), 0)
    into v_strength from public.war_regions where owner_id = uid;
  v_army_mult := 1 + 0.25 * floor(v_strength / 2500);

  -- War Factory discount, floored at 0.5 (never free). buildings.js costMultiplier.
  select coalesce(sum(level), 0) into v_factory from public.war_buildings where owner_id = uid and type = 'factory';
  v_cost_mult := greatest(0.5, 1 - 0.1 * v_factory);

  v_cost := round((v_unit_cost::numeric * p_count) * v_cost_mult * v_army_mult);

  select count(*) into v_owned from public.war_regions where owner_id = uid;

  if v_owned = 0 then
    -- respawn: target province must be unclaimed; it becomes the new HQ.
    if p_type = 'warship' then raise exception 'warships require a port'; end if;
    if exists (select 1 from public.war_regions where region_id = p_region and owner_id is not null) then
      raise exception 'region taken';
    end if;
    select display_name, color into v_name, v_color from public.war_players where user_id = uid;
  else
    -- normal: must own the target province; warships need a port there.
    if not exists (select 1 from public.war_regions where region_id = p_region and owner_id = uid) then
      raise exception 'you do not own this province';
    end if;
    if p_type = 'warship' and not exists (
      select 1 from public.war_buildings where region_id = p_region and owner_id = uid and type = 'port'
    ) then raise exception 'warships require a port in this province'; end if;
  end if;

  update public.wallets set balance = balance - v_cost
    where user_id = uid and balance >= v_cost
    returning balance into v_balance;
  if not found then raise exception 'insufficient coins'; end if;

  if v_owned = 0 then
    insert into public.war_regions (region_id, owner_id, owner_name, color, is_hq, soldier, tank, jet, warship, updated_at)
    values (p_region, uid, v_name, v_color, true, 0, 0, 0, 0, now())
    on conflict (region_id) do update
      set owner_id = excluded.owner_id, owner_name = excluded.owner_name, color = excluded.color,
          is_hq = true, soldier = 0, tank = 0, jet = 0, warship = 0, updated_at = now()
      where public.war_regions.owner_id is null;
    if not exists (select 1 from public.war_regions where region_id = p_region and owner_id = uid) then
      raise exception 'region taken';  -- lost a race; rolls back the debit
    end if;
  end if;

  update public.war_regions set
    soldier = soldier + (case when p_type = 'soldier' then p_count else 0 end),
    tank    = tank    + (case when p_type = 'tank'    then p_count else 0 end),
    jet     = jet     + (case when p_type = 'jet'     then p_count else 0 end),
    warship = warship + (case when p_type = 'warship' then p_count else 0 end),
    updated_at = now()
  where region_id = p_region and owner_id = uid;

  return jsonb_build_object('balance', v_balance, 'region', p_region);
end; $$;
revoke all on function public.war_buy_units(text,text,integer) from public;
grant execute on function public.war_buy_units(text,text,integer) to authenticated;

-- ── war_send_units: move a force out of a province you own ────────────────────
-- THE forged-movement fix: the source province is debited HERE, so a movement's
-- `units` can no longer exceed (or be conjured without) the units you actually hold.
-- Own→own is an instant reinforce; otherwise a movement row is queued for war_tick.
-- arrives_at is floored to the unit's minimum travel time so a client can't request
-- instant (past-dated) resolution. NOTE: exact distance-based travel time and
-- range/adjacency stay client-validated (the province graph is a client asset, not in
-- the DB) — a residual, low-severity gap: a real, PAID army is still required and only
-- one region is taken per attack. See docs/DATABASE.md.
create or replace function public.war_send_units(
  p_from text, p_to text, p_units jsonb, p_mode text, p_arrives_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  v_src  record;
  v_dst  record;
  s_sol  integer := coalesce((p_units->>'soldier')::integer, 0);
  s_tank integer := coalesce((p_units->>'tank')::integer, 0);
  s_jet  integer := coalesce((p_units->>'jet')::integer, 0);
  s_ship integer := coalesce((p_units->>'warship')::integer, 0);
  v_min  integer;
  v_floor timestamptz;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_mode not in ('land','air','sea') then raise exception 'invalid mode'; end if;
  if s_sol < 0 or s_tank < 0 or s_jet < 0 or s_ship < 0 then raise exception 'invalid unit count'; end if;
  if (s_sol + s_tank + s_jet + s_ship) = 0 then raise exception 'no units selected'; end if;

  select * into v_src from public.war_regions where region_id = p_from and owner_id = uid for update;
  if not found then raise exception 'you do not own the source province'; end if;
  if v_src.soldier < s_sol or v_src.tank < s_tank or v_src.jet < s_jet or v_src.warship < s_ship then
    raise exception 'not enough units in source province';
  end if;

  update public.war_regions set
    soldier = soldier - s_sol, tank = tank - s_tank, jet = jet - s_jet, warship = warship - s_ship,
    updated_at = now()
  where region_id = p_from and owner_id = uid;

  select * into v_dst from public.war_regions where region_id = p_to for update;

  if found and v_dst.owner_id = uid then
    update public.war_regions set
      soldier = soldier + s_sol, tank = tank + s_tank, jet = jet + s_jet, warship = warship + s_ship,
      updated_at = now()
    where region_id = p_to and owner_id = uid;
    return jsonb_build_object('reinforced', true);
  end if;

  v_min   := case p_mode when 'air' then 60 when 'land' then 180 else 240 end;
  v_floor := now() + make_interval(secs => v_min);
  insert into public.war_movements (player_id, from_region, to_region, units, mode, status, arrives_at)
  values (uid, p_from, p_to,
          jsonb_build_object('soldier', s_sol, 'tank', s_tank, 'jet', s_jet, 'warship', s_ship),
          p_mode, 'moving', greatest(coalesce(p_arrives_at, v_floor), v_floor));
  return jsonb_build_object('moving', true);
end; $$;
revoke all on function public.war_send_units(text,text,jsonb,text,timestamptz) from public;
grant execute on function public.war_send_units(text,text,jsonb,text,timestamptz) to authenticated;

-- ── war_build: build a new building on a province you own ─────────────────────
-- Server-priced, slot-capped (SLOTS_PER_REGION = 3), one-of-each-type (029 unique).
-- Coastal-only gating for ports stays client-side (the graph isn't in the DB) — a
-- minor game-rule gap, not a farming exploit.
create or replace function public.war_build(p_region text, p_type text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_cost integer; v_slots integer; v_balance integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_type not in ('bunker','antiair','factory','lab','bank','port') then raise exception 'invalid building type'; end if;
  if not exists (select 1 from public.war_regions where region_id = p_region and owner_id = uid) then
    raise exception 'you do not own this province';
  end if;
  select count(*) into v_slots from public.war_buildings where region_id = p_region;
  if v_slots >= 3 then raise exception 'no building slots left'; end if;
  v_cost := public.war_building_cost(p_type, 0);
  if v_cost is null then raise exception 'invalid building'; end if;

  update public.wallets set balance = balance - v_cost
    where user_id = uid and balance >= v_cost returning balance into v_balance;
  if not found then raise exception 'insufficient coins'; end if;

  insert into public.war_buildings (region_id, owner_id, type, level) values (p_region, uid, p_type, 1);
  return jsonb_build_object('balance', v_balance);
end; $$;
revoke all on function public.war_build(text,text) from public;
grant execute on function public.war_build(text,text) to authenticated;

-- ── war_upgrade: +1 level on a building you own ───────────────────────────────
create or replace function public.war_upgrade(p_building_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_b record; v_cost integer; v_balance integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into v_b from public.war_buildings where id = p_building_id and owner_id = uid for update;
  if not found then raise exception 'building not found'; end if;
  if not exists (select 1 from public.war_regions where region_id = v_b.region_id and owner_id = uid) then
    raise exception 'you do not own this province';
  end if;
  v_cost := public.war_building_cost(v_b.type, v_b.level);  -- level -> level+1
  if v_cost is null then raise exception 'already max level'; end if;

  update public.wallets set balance = balance - v_cost
    where user_id = uid and balance >= v_cost returning balance into v_balance;
  if not found then raise exception 'insufficient coins'; end if;

  update public.war_buildings set level = level + 1 where id = p_building_id;
  return jsonb_build_object('balance', v_balance);
end; $$;
revoke all on function public.war_upgrade(uuid) from public;
grant execute on function public.war_upgrade(uuid) to authenticated;

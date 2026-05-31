-- Migration 024: schedule war_tick + lock down client writes. Idempotent.

-- pg_cron (enable in Supabase: Database → Extensions → pg_cron, or:)
create extension if not exists pg_cron;

-- (Re)schedule the tick once per minute. cron.schedule upserts by name; the guarded
-- unschedule keeps re-runs clean even if the job already exists under this name.
select cron.unschedule('war-tick') where exists (select 1 from cron.job where jobname = 'war-tick');
select cron.schedule('war-tick', '* * * * *', $$ select public.war_tick(); $$);

-- Tighten war_regions: clients may only write their OWN regions now (spawn, buying
-- units, decrementing on send). The tick (SECURITY DEFINER) does all cross-player
-- writes (capture, combat, reinforce-on-arrival).
drop policy if exists "war_regions_insert" on public.war_regions;
drop policy if exists "war_regions_update" on public.war_regions;
create policy "war_regions_insert" on public.war_regions for insert with check (owner_id = auth.uid());
create policy "war_regions_update" on public.war_regions for update using (owner_id = auth.uid());

-- Tighten war_buildings to owner-only AND region-owned (build/upgrade only on a province
-- you actually own — otherwise a client could plant defensive buildings on anyone's region,
-- since the tick reads bunker/anti-air by region_id). The tick (definer) bypasses this and
-- still transfers/downgrades buildings on capture.
drop policy if exists "war_buildings_insert" on public.war_buildings;
drop policy if exists "war_buildings_update" on public.war_buildings;
drop policy if exists "war_buildings_delete" on public.war_buildings;
create policy "war_buildings_insert" on public.war_buildings for insert
  with check (owner_id = auth.uid()
    and exists (select 1 from public.war_regions r where r.region_id = war_buildings.region_id and r.owner_id = auth.uid()));
create policy "war_buildings_update" on public.war_buildings for update
  using (owner_id = auth.uid()
    and exists (select 1 from public.war_regions r where r.region_id = war_buildings.region_id and r.owner_id = auth.uid()));
create policy "war_buildings_delete" on public.war_buildings for delete using (owner_id = auth.uid());

-- Tighten war_movements updates to the owner. The client no longer resolves movements
-- (the tick does, as definer), so broad-authenticated update is no longer needed and
-- would let a player cancel/expire an incoming attack. Insert policy (own player_id)
-- from migration 019 is unchanged.
drop policy if exists "war_movements_update" on public.war_movements;
create policy "war_movements_update" on public.war_movements for update using (auth.uid() = player_id);

-- Backstop: a movement must carry a positive count (a fabricated count<=0 inserted
-- directly would otherwise feed nonsensical strength/loot math into the tick).
alter table public.war_movements drop  constraint if exists war_movements_count_check;
alter table public.war_movements add   constraint war_movements_count_check check (count > 0);

-- Lock down RPC execute grants. war_tick takes no caller input and is global; clients must
-- NOT be able to force off-schedule resolution — only pg_cron (running as the job owner,
-- unaffected by these revokes) should call it. war_collect_income stays callable by signed-in
-- users (it self-checks auth.uid()), matching the donate_coins grant pattern.
revoke all on function public.war_tick()           from public, anon, authenticated;
revoke all on function public.war_collect_income()  from public, anon;
grant  execute on function public.war_collect_income() to authenticated;

-- NOTE (intended-vs-enforced, accepted for this friends-and-family app): movement rows are
-- still inserted client-side, so the count/unit_type fed to server combat are client-trusted
-- (a determined member could fabricate a movement, equivalent to the already-accepted ability
-- to edit their own wallet / own-region unit counts — see CLAUDE.md §4). Making combat INPUTS
-- fully server-authoritative would require a send_units() SECURITY DEFINER RPC that validates
-- and debits the source region; that is a deliberate future step, not built here.

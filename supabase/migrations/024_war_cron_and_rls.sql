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

-- Tighten war_buildings to owner-only (build/upgrade your own; tick handles capture).
drop policy if exists "war_buildings_insert" on public.war_buildings;
drop policy if exists "war_buildings_update" on public.war_buildings;
drop policy if exists "war_buildings_delete" on public.war_buildings;
create policy "war_buildings_insert" on public.war_buildings for insert with check (owner_id = auth.uid());
create policy "war_buildings_update" on public.war_buildings for update using (owner_id = auth.uid());
create policy "war_buildings_delete" on public.war_buildings for delete using (owner_id = auth.uid());

-- Tighten war_movements updates to the owner. The client no longer resolves movements
-- (the tick does, as definer), so broad-authenticated update is no longer needed and
-- would let a player cancel/expire an incoming attack. Insert policy (own player_id)
-- from migration 019 is unchanged.
drop policy if exists "war_movements_update" on public.war_movements;
create policy "war_movements_update" on public.war_movements for update using (auth.uid() = player_id);

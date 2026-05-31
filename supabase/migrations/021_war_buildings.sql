-- Migration 021: CP War buildings. Idempotent.
create table if not exists public.war_buildings (
  id         uuid primary key default gen_random_uuid(),
  region_id  text not null references public.war_regions(region_id) on delete cascade,
  owner_id   uuid references auth.users(id) on delete set null,
  type       text not null check (type in ('bunker','antiair','factory','lab','bank')),
  level      integer not null default 1 check (level between 1 and 3),
  created_at timestamptz not null default now()
);
create index if not exists war_buildings_region_idx on public.war_buildings(region_id);
create index if not exists war_buildings_owner_idx   on public.war_buildings(owner_id);

alter table public.war_buildings enable row level security;
drop policy if exists "war_buildings_select" on public.war_buildings;
drop policy if exists "war_buildings_insert" on public.war_buildings;
drop policy if exists "war_buildings_update" on public.war_buildings;
drop policy if exists "war_buildings_delete" on public.war_buildings;
create policy "war_buildings_select" on public.war_buildings for select using (auth.role() = 'authenticated');
-- Broad write in Phase 2 (client resolves combat/capture). Phase 3 tightens this.
create policy "war_buildings_insert" on public.war_buildings for insert with check (auth.role() = 'authenticated');
create policy "war_buildings_update" on public.war_buildings for update using (auth.role() = 'authenticated');
create policy "war_buildings_delete" on public.war_buildings for delete using (auth.role() = 'authenticated');

-- Realtime: alter publication supabase_realtime add table public.war_buildings;

-- Migration 019: CP War v2 – real-world province conquest
-- Replaces the hex schema from 015. RUN ONCE: the leading `drop table ... cascade`
-- intentionally removes the v1 hex tables, so re-running this file RESETS all CP War
-- state (regions/players/movements/buildings). It does not error on re-run, but it is
-- destructive — do not re-run on a live season.
-- ─────────────────────────────────────────────────────────────────────────────

drop table if exists public.war_movements cascade;
drop table if exists public.war_tiles     cascade;
drop table if exists public.war_players    cascade;

create table public.war_players (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  display_name   text not null,
  color          text not null,
  spawn_region   text,
  season_id      integer not null default 1,
  is_alive       boolean not null default true,
  shield_until   timestamptz,
  last_income_at timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create table public.war_regions (
  region_id    text primary key,           -- adm1_code from public/war/provinces.json
  country_code text,
  owner_id     uuid references auth.users(id) on delete set null,
  owner_name   text,
  color        text,
  is_hq        boolean not null default false,
  soldier      integer not null default 0,
  tank         integer not null default 0,
  jet          integer not null default 0,
  updated_at   timestamptz not null default now()
);

create table public.war_movements (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references auth.users(id) on delete cascade,
  from_region text not null,
  to_region   text not null,
  unit_type   text not null check (unit_type in ('soldier','tank','jet')),
  count       integer not null,
  mode        text not null check (mode in ('land','air')),
  status      text not null default 'moving' check (status in ('moving','arrived','cancelled')),
  arrives_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists war_regions_owner_idx      on public.war_regions(owner_id);
create index if not exists war_movements_status_idx    on public.war_movements(status, arrives_at);
create index if not exists war_movements_player_idx     on public.war_movements(player_id);

alter table public.war_players   enable row level security;
alter table public.war_regions   enable row level security;
alter table public.war_movements enable row level security;

-- Reads: any signed-in user. NOTE the auth.role() expression form (CLAUDE.md §2).
create policy "war_players_select"   on public.war_players   for select using (auth.role() = 'authenticated');
create policy "war_players_insert"   on public.war_players   for insert with check (auth.uid() = user_id);
create policy "war_players_update"   on public.war_players   for update using (auth.uid() = user_id);

create policy "war_regions_select"   on public.war_regions   for select using (auth.role() = 'authenticated');
-- Broad write: client resolves combat in Phase 1 and must modify enemy regions.
-- Phase 3 replaces this with server-authoritative writes.
create policy "war_regions_insert"   on public.war_regions   for insert with check (auth.role() = 'authenticated');
create policy "war_regions_update"   on public.war_regions   for update using (auth.role() = 'authenticated');

create policy "war_movements_select" on public.war_movements for select using (auth.role() = 'authenticated');
create policy "war_movements_insert" on public.war_movements for insert with check (auth.uid() = player_id);
-- Broad update: any client runs the Phase 1 resolver and must mark others' movements arrived.
-- Phase 3 replaces this with a server-side RPC.
create policy "war_movements_update" on public.war_movements for update using (auth.role() = 'authenticated');

-- ── Realtime ──────────────────────────────────────────────────────────────────
-- Run in Supabase dashboard (Database → Replication) or via SQL:
-- alter publication supabase_realtime add table public.war_regions;
-- alter publication supabase_realtime add table public.war_movements;
-- alter publication supabase_realtime add table public.war_players;

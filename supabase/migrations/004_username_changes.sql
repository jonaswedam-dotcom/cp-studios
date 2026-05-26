-- ============================================================
-- 004 – Username change rate-limiting log
-- Run in Supabase SQL Editor after 003_chat.sql
-- ============================================================

create table if not exists public.username_changes (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  changed_at timestamptz not null default now()
);

-- ── RLS ─────────────────────────────────────────────────────

alter table public.username_changes enable row level security;

create policy "users can insert own username changes"
  on public.username_changes for insert
  with check (auth.uid() = user_id);

create policy "users can read own username changes"
  on public.username_changes for select
  using (auth.uid() = user_id);

-- ============================================================
-- 003 – Group chat
-- Run in Supabase SQL Editor after 002_admin_delete_policies.sql
-- ============================================================

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  sender_name text not null default '',
  content     text,
  image_url   text,
  created_at  timestamptz not null default now(),
  -- every message must have text, an image, or both
  constraint messages_has_content check (content is not null or image_url is not null)
);

-- ── RLS ─────────────────────────────────────────────────────

alter table public.messages enable row level security;

create policy "authenticated can read messages"
  on public.messages for select
  using (auth.role() = 'authenticated');

create policy "authenticated can insert own messages"
  on public.messages for insert
  with check (auth.uid() = user_id);

-- ── Realtime ────────────────────────────────────────────────
-- Adds the messages table to the default Realtime publication so that
-- clients can subscribe to INSERT/UPDATE/DELETE events.

alter publication supabase_realtime add table public.messages;

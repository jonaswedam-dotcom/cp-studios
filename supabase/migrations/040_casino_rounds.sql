-- Migration 040: interactive-casino round lifecycle tables. Idempotent. Additive.
-- ─────────────────────────────────────────────────────────────────────────────
-- Backs the interactive games (Mines, Chicken Road, Blackjack) that hold HIDDEN
-- round state the player acts against across multiple RPC calls.
--
-- Following Aviator's proven split (migration 036): the public row carries only
-- what the client may legitimately see; the secret (mine layout, full deck order,
-- pre-rolled lane outcomes, dealer hole card) lives in a SEPARATE table with NO
-- RLS policies, so it is immune to the Realtime column leak that a hidden column
-- on the public row would NOT be.
--
-- DO NOT add casino_round_secrets to the supabase_realtime publication, and DO
-- NOT add any RLS policy to it. No policies = deny all client access; the
-- SECURITY DEFINER round RPCs (migrations 041/042/043) bypass RLS and are the
-- only writers/readers of the secret.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Public round state (client may read OWN rows) ───────────────────────────
create table if not exists public.casino_rounds (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  game        text        not null,                       -- 'mines' | 'chicken' | 'blackjack'
  bet         integer     not null check (bet > 0),
  status      text        not null default 'active',      -- 'active' | 'busted' | 'cashed_out'
  state       jsonb       not null,                       -- revealed cells, shown hand, lane, mult
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists casino_rounds_user_active_idx
  on public.casino_rounds (user_id, status);

alter table public.casino_rounds enable row level security;

-- own-row SELECT only, via the auth.role() expression form (the role-binding
-- "TO authenticated USING(true)" form is silently broken in this deployment;
-- see CLAUDE.md §2). NO insert/update/delete policies → the client cannot write;
-- the DEFINER round RPCs do every write.
drop policy if exists casino_rounds_select_own on public.casino_rounds;
create policy casino_rounds_select_own
  on public.casino_rounds for select
  using (auth.role() = 'authenticated' and auth.uid() = user_id);

-- ── Hidden secret (NEVER exposed; NEVER published to Realtime) ────────────────
create table if not exists public.casino_round_secrets (
  round_id  uuid  primary key references public.casino_rounds on delete cascade,
  secret    jsonb not null                                -- mine layout / deck order / lane outcomes
);

alter table public.casino_round_secrets enable row level security;
-- NO policies at all = deny all client access. SECURITY DEFINER bypasses RLS.
-- DO NOT add casino_round_secrets to supabase_realtime.

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK:
--   drop table if exists public.casino_round_secrets;
--   drop table if exists public.casino_rounds;
-- ─────────────────────────────────────────────────────────────────────────────

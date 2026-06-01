-- Migration 033: live bet feed — make game_history readable by all members + realtime.
-- ─────────────────────────────────────────────────────────────────────────────
-- The casino's live bet feed (src/components/LiveBetFeed.jsx) subscribes to INSERTs
-- on game_history and pops a bubble for every bet placed across all players.
--
-- Two changes are needed for that to surface OTHER players' bets:
--   1. SELECT policy — migration 005 restricted reads to your own rows
--      (game_history_select_own). Realtime applies RLS, so with the own-only policy
--      a client only ever receives its own INSERTs. Replace it with a select-all
--      policy. Use the expression form `auth.role() = 'authenticated'`, NOT the
--      role-binding form `TO authenticated USING (true)` — the latter is silently
--      broken in this deployment (see migrations 009 / 014 and CLAUDE.md §2).
--   2. Realtime — add game_history to the supabase_realtime publication so clients
--      get change events at all (mirrors messages in 003, war_events in 025).
--
-- Privacy note: this makes every member's bet history (game, amount, win/loss)
-- readable by any signed-in member. That is intended — the feed is public by
-- design. game_history still has no UPDATE/DELETE policy, and inserts remain
-- self-only (game_history_insert_own from 005), so this only widens reads.
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Reads: drop the own-only policy, add a select-all policy (expression form).
drop policy if exists "game_history_select_own" on public.game_history;
drop policy if exists "authenticated can read all game_history" on public.game_history;

create policy "authenticated can read all game_history"
  on public.game_history for select
  using (auth.role() = 'authenticated');

-- 2. Realtime: add game_history to the publication (no-op if already present).
do $$
begin
  alter publication supabase_realtime add table public.game_history;
exception when duplicate_object then null;
end $$;

-- Migration 045: wallet lockdown — revoke the client's balance writes. Idempotent.
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  APPLY LAST. Only after the new server-authoritative client is verified     ║
-- ║  live (every casino game playing end-to-end against migrations 039–044).    ║
-- ║                                                                             ║
-- ║  This is the breaking, cheat-closing migration. Until it is applied, the    ║
-- ║  Math.random / direct-RPC mint exploit stays OPEN for everyone (old cached  ║
-- ║  bundles + raw anon-key calls can still write wallets / call settle_bet /   ║
-- ║  positive apply_balance_delta). Apply promptly after verification.          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- ─────────────────────────────────────────────────────────────────────────────
-- Mirrors the war_players lockdown in migration 028: table-level revoke from BOTH
-- client roles (a column-level revoke wouldn't stop a blanket grant; anon must be
-- covered too even though RLS also blocks it), then grant back ONLY the one column
-- the client legitimately self-edits. The SECURITY DEFINER RPCs run as the table
-- owner and are unaffected.
-- ─────────────────────────────────────────────────────────────────────────────

-- Close BOTH the UPDATE mint and the INSERT mint (the old loadBalance inserted a
-- client-chosen balance: 1100). Wallet creation now goes through ensure_wallet().
revoke insert, update on public.wallets from authenticated, anon;

-- Grant back ONLY the rename mirror column (Navbar mirrors display_name into wallets).
grant update (display_name) on public.wallets to authenticated;

-- Drop the trust-the-client settle_bet (replaced by the per-game play_* / round RPCs).
drop function if exists public.settle_bet(text, integer, text, integer, integer);

-- History rows are inserted only by the play_* / round-settlement DEFINER RPCs now.
-- Revoke the client INSERT to prevent feed/leaderboard spoofing. SELECT own stays.
revoke insert on public.game_history from authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION (run in the SQL editor before + after; see supabase/tests/casino_checks.sql):
--   After: `authenticated` should have only UPDATE(display_name) on wallets (no
--   table INSERT/UPDATE), and `anon` none. Then confirm a raw
--   `UPDATE wallets SET balance=balance+1000` and an `INSERT INTO wallets(...)`
--   from a normal session are both rejected.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK:
--   grant insert, update on public.wallets to authenticated;
--   grant insert on public.game_history to authenticated;
--   -- recreate settle_bet from migration 032 if ever needed.
-- ─────────────────────────────────────────────────────────────────────────────

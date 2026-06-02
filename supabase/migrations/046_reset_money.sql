-- Migration 046: reset all in-game money to a clean baseline for the casino cutover.
-- One-off, manual, idempotent (re-running just re-applies the same fixed values).
-- Modeled on migration 030. COINS-ONLY: wipes casino currency + clears orphaned
-- interactive rounds, but intentionally LEAVES the war map intact (territory,
-- armies, buildings, players). Audit logs (game_history, donations) are untouched.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Wallet coins -> 1000 (the column default from migration 005). On each user's
--    next load the daily bonus re-grants +100 -> uniform 1100, matching a brand-new
--    player's first-visit balance.
update public.wallets set balance = 1000;

-- 2) Re-arm the daily bonus for everyone (NULL last_daily_bonus => "due" on next load).
update public.wallets set last_daily_bonus = null;

-- 3) Re-arm the bankruptcy refill for everyone.
update public.wallets set last_refill = null;

-- 4) Clear any orphaned interactive rounds (the bet was deducted at open; a dangling
--    'active' round after the reset would let a player cash out post-reset coins).
--    casino_round_secrets rows cascade on delete.
delete from public.casino_rounds;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK: none (one-off reset; balances cannot be un-reset).
-- ─────────────────────────────────────────────────────────────────────────────

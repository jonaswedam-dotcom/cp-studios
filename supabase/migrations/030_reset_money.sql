-- Migration 030: Reset all in-game money to a clean baseline.
-- One-off, manual, idempotent (re-running just re-applies the same fixed values).
-- COINS-ONLY: this wipes currency (wallet balances + uncollected war income) but
-- intentionally LEAVES the war map intact (territory, armies, buildings, players).
-- For a full season restart that also wipes the war board, see the variant in
-- docs/superpowers/specs/2026-06-01-economy-rebalance-and-casino-odds-design.md (§6).
-- Audit logs (game_history, donations) are intentionally untouched.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Wallet coins -> 1000 (the column default from migration 005). On each user's
--    next load CasinoContext re-grants the daily bonus (step 2) -> uniform 1100,
--    matching a brand-new player's first-visit balance (1000 + DAILY_BONUS_AMOUNT).
update public.wallets set balance = 1000;

-- 2) Re-arm the daily bonus for everyone (NULL last_daily_bonus => "due" on next load).
update public.wallets set last_daily_bonus = null;

-- 3) Drop every player's uncollected war income vault (vault coins ARE money).
update public.war_players set vault = 0;

-- 4) Reset income/activity clocks to now() so the next war_tick() pays no retroactive
--    back-income across the reset boundary and the offline dug-in defence bonus
--    doesn't immediately fire on freshly-reset players.
update public.war_players set last_income_at = now(), last_active_at = now();

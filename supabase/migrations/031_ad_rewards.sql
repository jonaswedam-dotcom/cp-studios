-- Migration 031: rewarded-ad coin faucet — cooldown + daily-cap columns on wallets.
-- The grant itself is client-side (mirrors the daily-bonus pattern in CasinoContext.jsx);
-- these columns are the durable source of truth for the per-ad cooldown and the daily cap,
-- so the limits survive across devices and a localStorage clear (unlike the emergency refill).
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.wallets add column if not exists last_ad_reward   timestamptz;
alter table public.wallets add column if not exists ad_rewards_date   date;
alter table public.wallets add column if not exists ad_rewards_count  integer not null default 0;

-- No RLS change needed: wallets already allows a user to update only their own row
-- (auth.uid() = user_id), which is exactly what the client ad grant writes.

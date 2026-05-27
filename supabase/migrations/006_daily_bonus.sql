-- Migration 006: Add last_daily_bonus column to wallets
-- Tracks the last time each user claimed their daily 100-coin bonus

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS last_daily_bonus timestamptz;

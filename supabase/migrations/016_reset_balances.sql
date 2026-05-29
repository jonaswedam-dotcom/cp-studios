-- Migration 016: Reset all wallet balances to 1000
UPDATE public.wallets SET balance = 1000;

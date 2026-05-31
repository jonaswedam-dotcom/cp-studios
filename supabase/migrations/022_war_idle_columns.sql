-- Migration 022: columns for the idle economy + activity tracking. Idempotent.
alter table public.war_players add column if not exists vault          integer not null default 0;
alter table public.war_players add column if not exists last_active_at timestamptz not null default now();
-- last_income_at + shield_until already exist from migration 019.

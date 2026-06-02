-- Migration 044: wallet RPCs for the server-authoritative casino. ADDITIVE.
-- ─────────────────────────────────────────────────────────────────────────────
-- Applied BEFORE the lockdown (045) so the new client's ensure_wallet/claim_refill
-- exist before it deploys, and the converted DEFINER RPCs keep working after the
-- client loses direct wallet writes. This migration does NOT break the OLD client
-- (which still writes wallets directly until 045): apply_balance_delta still
-- accepts negatives, claim_daily_bonus/settle_ad_reward keep their 032 bodies.
--
-- Changes:
--   • add wallets.last_refill (column) — gates claim_refill.
--   • ensure_wallet(display_name)  — NEW DEFINER: server-controlled wallet creation
--       (hard-codes starting balance 1100 = 1000 + 100 first-day bonus), replacing
--       the client INSERT so the client can no longer choose its own balance.
--   • claim_refill()              — NEW DEFINER: bankruptcy refill of 100, only when
--       balance = 0 and (last_refill is null or > 24h ago).
--   • apply_balance_delta(p_delta) — DEFINER + SPEND-ONLY (rejects p_delta > 0).
--   • claim_daily_bonus()          — DEFINER (032 body unchanged; fixed +100, 24h-gated).
--   • settle_ad_reward(...)        — DEFINER + SERVER-AUTHORITATIVE: the reward amount,
--       daily cap, and cooldown are now enforced server-side; the client-supplied
--       args are IGNORED. (The 032 body trusted p_reward_amount, which after the 045
--       lockdown would be a settle_bet-class mint vector — call it with a huge amount.)
-- Every balance-mutating function scopes its write WHERE user_id = auth.uid()
-- (the only cross-wallet guard inside a DEFINER function — RLS does not apply there).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── last_refill column ────────────────────────────────────────────────────────
alter table public.wallets add column if not exists last_refill timestamptz;

-- ── ensure_wallet: server-controlled wallet creation ─────────────────────────
-- Mirrors war_spawn's on-conflict-do-nothing pattern. Hard-codes the starting
-- balance (1100 = 1000 start + 100 first-day bonus) and last_daily_bonus = now()
-- so a fresh player can't immediately re-claim the daily bonus. Idempotent.
create or replace function public.ensure_wallet(p_display_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); bal integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;

  insert into public.wallets (user_id, balance, last_daily_bonus, display_name)
  values (uid, 1100, now(), p_display_name)
  on conflict (user_id) do nothing;

  select balance into bal from public.wallets where user_id = uid;
  return jsonb_build_object('balance', bal);
end; $$;
revoke all on function public.ensure_wallet(text) from public;
grant execute on function public.ensure_wallet(text) to authenticated;

-- ── claim_refill: bankruptcy refill (replaces the client's direct SET balance=100) ─
-- Server gate: only when balance = 0, at most once per 24h (last_refill column).
-- Returns the balance and whether the refill was applied.
create or replace function public.claim_refill()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); bal integer; applied boolean := false;
begin
  if uid is null then raise exception 'not authenticated'; end if;

  update public.wallets
    set balance = 100, last_refill = now()
    where user_id = uid
      and balance = 0
      and (last_refill is null or last_refill < now() - interval '24 hours')
    returning balance into bal;

  if found then
    applied := true;
  else
    select balance into bal from public.wallets where user_id = uid;
  end if;

  return jsonb_build_object('balance', bal, 'refilled', applied);
end; $$;
revoke all on function public.claim_refill() from public;
grant execute on function public.claim_refill() to authenticated;

-- ── apply_balance_delta: DEFINER + SPEND-ONLY ─────────────────────────────────
-- 032 body, converted to DEFINER, with a positive-delta rejection so it can no
-- longer mint. All client callers pass -cost (WarPage unit/building spends, the
-- Plinko unmount forfeit). Returns the actual new balance.
create or replace function public.apply_balance_delta(p_delta integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_user_id uuid := auth.uid(); v_new_balance integer;
begin
  if p_delta > 0 then raise exception 'spend only'; end if;   -- cannot mint

  update public.wallets
    set balance = greatest(0, balance + p_delta)
    where user_id = v_user_id
    returning balance into v_new_balance;

  if not found then raise exception 'Wallet not found'; end if;
  return v_new_balance;
end; $$;
revoke all on function public.apply_balance_delta(integer) from public;
grant execute on function public.apply_balance_delta(integer) to authenticated;

-- ── claim_daily_bonus: DEFINER (032 body unchanged) ───────────────────────────
create or replace function public.claim_daily_bonus()
returns table (balance integer, bonus_applied boolean)
language plpgsql security definer set search_path = public as $$
declare v_user_id uuid := auth.uid(); v_balance integer; v_applied boolean := false;
begin
  update public.wallets
    set balance          = balance + 100,
        last_daily_bonus = now()
    where user_id = v_user_id
      and (last_daily_bonus is null or last_daily_bonus < now() - interval '24 hours')
    returning wallets.balance into v_balance;

  if found then
    v_applied := true;
  else
    select wallets.balance into v_balance from public.wallets where user_id = v_user_id;
  end if;

  return query select v_balance, v_applied;
end; $$;
revoke all on function public.claim_daily_bonus() from public;
grant execute on function public.claim_daily_bonus() to authenticated;

-- ── settle_ad_reward: DEFINER + SERVER-AUTHORITATIVE ──────────────────────────
-- The 032 body added a CLIENT-supplied p_reward_amount to the balance. Once DEFINER
-- (post-045), that is a mint vector — settle_ad_reward(1000000, ...) prints coins,
-- exactly like the settle_bet we dropped. So the reward, daily cap, and cooldown are
-- now enforced HERE from the wallet's own columns; the client args are IGNORED (the
-- signature is kept so the existing client call keeps working without a redeploy).
-- Constants mirror CasinoContext.jsx: AD_REWARD_AMOUNT=100, AD_DAILY_CAP=5,
-- AD_COOLDOWN_MS=3 min. Date is UTC to match the client's _adToday().
create or replace function public.settle_ad_reward(
  p_reward_amount    integer,      -- IGNORED (server hard-codes the reward)
  p_last_ad_reward   timestamptz,  -- IGNORED (server stamps now())
  p_ad_rewards_date  text,         -- IGNORED (server computes UTC date)
  p_ad_rewards_count integer       -- IGNORED (server derives from the wallet row)
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_user_id  uuid := auth.uid();
  v_reward   constant integer  := 100;                  -- AD_REWARD_AMOUNT
  v_cap      constant integer  := 5;                    -- AD_DAILY_CAP
  v_cooldown constant interval := interval '3 minutes'; -- AD_COOLDOWN_MS
  v_today    text := to_char((now() at time zone 'utc'), 'YYYY-MM-DD');
  v_last     timestamptz; v_date text; v_count integer; v_used integer; v_new_balance integer;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;

  select last_ad_reward, ad_rewards_date, ad_rewards_count
    into v_last, v_date, v_count
    from public.wallets where user_id = v_user_id for update;
  if not found then raise exception 'Wallet not found'; end if;

  v_used := case when v_date = v_today then coalesce(v_count, 0) else 0 end;
  if v_used >= v_cap then raise exception 'daily ad cap reached'; end if;
  if v_last is not null and now() - v_last < v_cooldown then raise exception 'ad cooldown active'; end if;

  update public.wallets
    set balance          = balance + v_reward,
        last_ad_reward   = now(),
        ad_rewards_date  = v_today,
        ad_rewards_count = v_used + 1
    where user_id = v_user_id
    returning balance into v_new_balance;

  return v_new_balance;
end; $$;
revoke all on function public.settle_ad_reward(integer, timestamptz, text, integer) from public;
grant execute on function public.settle_ad_reward(integer, timestamptz, text, integer) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK:
--   drop function if exists public.ensure_wallet(text);
--   drop function if exists public.claim_refill();
--   alter table public.wallets drop column if exists last_refill;
--   -- restore the 032 SECURITY INVOKER bodies of apply_balance_delta (without the
--   -- positive-delta guard), claim_daily_bonus, settle_ad_reward if reverting fully.
-- ─────────────────────────────────────────────────────────────────────────────

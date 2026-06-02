-- Migration 042: server-authoritative Chicken Road. Idempotent. Additive.
-- ─────────────────────────────────────────────────────────────────────────────
-- keep in sync with src/pages/casino/chickenEngine.js (preRollLanes, chickenPayout)
--   LANE_MULTIPLIERS = [1.3, 2.0, 3.2, 4.8, 7.2, 11.0, 18.0]
--   SAFE_PROBS       = [0.72, 0.64, 0.56, 0.48, 0.40, 0.32, 0.25]
--
-- chicken_open(bet)        : validate, deduct bet, pre-roll all 7 lane outcomes
--                            (lane i safe iff random() < SAFE_PROBS[i]) into the
--                            secret, create an 'active' round at lane 0.
-- chicken_step(round)      : FOR UPDATE + status='active'; reveal the NEXT lane;
--                            unsafe → 'busted' (credit nothing); safe → advance;
--                            after lane 7 → auto-cashout.
-- chicken_cashout(round)   : FOR UPDATE + status='active'; require lane >= 1;
--                            credit bet + floor(bet*(LANE_MULTIPLIERS[lane-1]-1)).
--
-- Bet accounting: bet deducted at open; cashout/auto-cashout credit
--   bet + floor(bet*(mult-1)) so net = floor(bet*(mult-1)), identical to the
--   client. Bust credits nothing (bet already gone).
-- The secret holds the full pre-rolled lane array; the returned jsonb never
-- includes unrevealed lane outcomes mid-round.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── chicken_open ──────────────────────────────────────────────────────────────
create or replace function public.chicken_open(p_bet integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); bal integer; rid uuid; newbal integer;
  -- SAFE_PROBS copied verbatim from chickenEngine.js
  safe_probs double precision[] := array[0.72, 0.64, 0.56, 0.48, 0.40, 0.32, 0.25];
  lanes boolean[] := array[]::boolean[]; i integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_bet <= 0 then raise exception 'bad bet'; end if;
  select balance into bal from public.wallets where user_id = uid for update;
  if bal is null then raise exception 'no wallet'; end if;
  if p_bet > bal then raise exception 'insufficient'; end if;   -- BEFORE deduct

  -- preRollLanes: lane i safe iff random() < SAFE_PROBS[i] (strict <).
  for i in 1..7 loop
    lanes := lanes || (random() < safe_probs[i]);
  end loop;

  update public.wallets set balance = balance - p_bet
    where user_id = uid returning balance into newbal;

  insert into public.casino_rounds (user_id, game, bet, status, state)
    values (uid, 'chicken', p_bet, 'active', jsonb_build_object('lane', 0))
    returning id into rid;
  insert into public.casino_round_secrets (round_id, secret)
    values (rid, jsonb_build_object('lanes', to_jsonb(lanes)));

  return jsonb_build_object('round_id', rid, 'lane', 0, 'balance', newbal);
end; $$;
revoke all on function public.chicken_open(integer) from public;
grant execute on function public.chicken_open(integer) to authenticated;

-- ── chicken_step ──────────────────────────────────────────────────────────────
create or replace function public.chicken_step(p_round uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); rnd public.casino_rounds%rowtype;
  lanes boolean[]; lane integer; bet integer; target integer;
  safe boolean; new_lane integer; mult numeric; win integer; newbal integer;
  -- LANE_MULTIPLIERS copied verbatim
  lane_mult numeric[] := array[1.3, 2.0, 3.2, 4.8, 7.2, 11.0, 18.0];
begin
  if uid is null then raise exception 'not authenticated'; end if;

  select * into rnd from public.casino_rounds
    where id = p_round and user_id = uid for update;
  if not found then raise exception 'round not found'; end if;
  if rnd.status <> 'active' then raise exception 'round not active'; end if;
  if rnd.game <> 'chicken' then raise exception 'wrong game'; end if;

  lane   := (rnd.state->>'lane')::integer;   -- lanes already crossed (0..6 here)
  bet    := rnd.bet;
  target := lane;                            -- 0-indexed lane to cross now
  if target >= 7 then raise exception 'no more lanes'; end if;

  select array(select jsonb_array_elements_text(s.secret->'lanes')::boolean)
    into lanes from public.casino_round_secrets s where s.round_id = p_round;

  safe := lanes[target + 1];   -- 1-based SQL array

  if not safe then
    -- BUST: credit nothing.
    update public.casino_rounds
      set status = 'busted', updated_at = now(),
          state = jsonb_set(state, '{hit_lane}', to_jsonb(target))
      where id = p_round;
    insert into public.game_history (user_id, game, bet, result, payout)
      values (uid, 'chicken-road', bet, 'loss', 0);
    return jsonb_build_object('safe', false, 'hit_lane', target);
  end if;

  new_lane := lane + 1;

  if new_lane = 7 then
    -- all lanes crossed → auto-cashout. credit bet + floor(bet*(mult-1)).
    mult := lane_mult[7];
    win  := bet + floor(bet * (mult - 1))::integer;
    update public.casino_rounds
      set status = 'cashed_out', updated_at = now(),
          state = jsonb_set(state, '{lane}', to_jsonb(new_lane))
      where id = p_round;
    update public.wallets set balance = balance + win
      where user_id = uid returning balance into newbal;
    insert into public.game_history (user_id, game, bet, result, payout)
      values (uid, 'chicken-road', bet, 'win', win);
    return jsonb_build_object(
      'safe', true, 'lane', new_lane, 'cashed_out', true,
      'mult', mult, 'payout', win, 'balance', newbal);
  end if;

  update public.casino_rounds
    set updated_at = now(), state = jsonb_set(state, '{lane}', to_jsonb(new_lane))
    where id = p_round;
  return jsonb_build_object('safe', true, 'lane', new_lane, 'mult', lane_mult[new_lane]);
end; $$;
revoke all on function public.chicken_step(uuid) from public;
grant execute on function public.chicken_step(uuid) to authenticated;

-- ── chicken_cashout ───────────────────────────────────────────────────────────
create or replace function public.chicken_cashout(p_round uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); rnd public.casino_rounds%rowtype;
  lane integer; bet integer; mult numeric; win integer; newbal integer;
  lane_mult numeric[] := array[1.3, 2.0, 3.2, 4.8, 7.2, 11.0, 18.0];
begin
  if uid is null then raise exception 'not authenticated'; end if;

  select * into rnd from public.casino_rounds
    where id = p_round and user_id = uid for update;
  if not found then raise exception 'round not found'; end if;
  if rnd.status <> 'active' then raise exception 'round not active'; end if;
  if rnd.game <> 'chicken' then raise exception 'wrong game'; end if;

  lane := (rnd.state->>'lane')::integer;
  if lane = 0 then raise exception 'cross a lane first'; end if;
  bet  := rnd.bet;
  mult := lane_mult[lane];          -- LANE_MULTIPLIERS[lane - 1] (0-indexed) = [lane] (1-based)
  win  := bet + floor(bet * (mult - 1))::integer;

  update public.casino_rounds
    set status = 'cashed_out', updated_at = now()
    where id = p_round;
  update public.wallets set balance = balance + win
    where user_id = uid returning balance into newbal;
  insert into public.game_history (user_id, game, bet, result, payout)
    values (uid, 'chicken-road', bet, 'win', win);

  return jsonb_build_object('payout', win, 'mult', mult, 'lane', lane, 'balance', newbal);
end; $$;
revoke all on function public.chicken_cashout(uuid) from public;
grant execute on function public.chicken_cashout(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK:
--   drop function if exists public.chicken_cashout(uuid);
--   drop function if exists public.chicken_step(uuid);
--   drop function if exists public.chicken_open(integer);
-- ─────────────────────────────────────────────────────────────────────────────

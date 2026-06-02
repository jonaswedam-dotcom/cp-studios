-- Migration 041: server-authoritative Mines. Idempotent. Additive.
-- ─────────────────────────────────────────────────────────────────────────────
-- keep in sync with src/pages/casino/minesEngine.js (minesMult, buildMines)
--
-- mines_open(bet, mines)  : validate, deduct bet, pick the mine layout (secret),
--                           create an 'active' round; return public state (no layout).
-- mines_reveal(round, cell): FOR UPDATE lock + status='active' re-check + ownership;
--                           dedupe (revealing an already-revealed cell is a no-op);
--                           hitting a mine → 'busted' (reveal layout, credit nothing);
--                           safe → append, recompute mult; when all safe revealed →
--                           auto-cashout (credit + 'cashed_out' + game_history).
-- mines_cashout(round)    : FOR UPDATE + status='active'; require >=1 safe revealed;
--                           credit bet + floor(bet*(mult-1)); 'cashed_out' + history.
--
-- Mult formula (5% house edge), copied verbatim from minesMult:
--   revealed 0 → 1; else m = Π_{i<revealed} (25-i)/(25-mines-i);
--   round(max(1.01, m*0.95), 2)  (2-decimal rounding identical to the client).
-- Bet accounting: bet deducted at open; cashout credits bet + floor(bet*(mult-1))
--   so net = floor(bet*(mult-1)), identical to the client. Bust credits nothing.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Helper: mult for `revealed` safe tiles uncovered with `mines` mines ───────
-- Mirrors minesMult(revealed, mines). Returns numeric rounded to 2 decimals.
create or replace function public._mines_mult(p_revealed integer, p_mines integer)
returns numeric language plpgsql immutable set search_path = public as $$
declare m double precision := 1.0; i integer;
begin
  if p_revealed = 0 then return 1; end if;
  for i in 0..(p_revealed - 1) loop
    m := m * (25 - i)::double precision / (25 - p_mines - i)::double precision;
  end loop;
  return round(greatest(1.01, m * 0.95)::numeric, 2);
end; $$;
revoke all on function public._mines_mult(integer, integer) from public;

-- ── Helper: pick `count` DISTINCT mine cells in 0..24 ─────────────────────────
-- Mirrors buildMines's partial Fisher-Yates exactly (deck 0..24; for i in 0..count-1
-- swap deck[i] with deck[i + floor(rng()*(25-i))]; take the first `count`). No
-- redraw loop — terminates for any rng, identical observable result to the engine.
create or replace function public._mines_pick(p_count integer)
returns integer[] language plpgsql set search_path = public as $$
declare deck integer[]; i integer; j integer; t integer;
begin
  deck := array(select generate_series(0, 24));   -- 1-based array holding values 0..24
  for i in 0..(p_count - 1) loop
    j := i + floor(random() * (25 - i))::integer;  -- 0-based logical index
    t := deck[i + 1];
    deck[i + 1] := deck[j + 1];
    deck[j + 1] := t;
  end loop;
  return deck[1:p_count];                          -- first `count` values
end; $$;
revoke all on function public._mines_pick(integer) from public;

-- ── mines_open ────────────────────────────────────────────────────────────────
create or replace function public.mines_open(p_bet integer, p_mines integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); bal integer; rid uuid; cells integer[]; newbal integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_bet <= 0 then raise exception 'bad bet'; end if;
  if p_mines not in (1, 3, 5, 7, 10) then raise exception 'bad mines'; end if;
  select balance into bal from public.wallets where user_id = uid for update;
  if bal is null then raise exception 'no wallet'; end if;
  if p_bet > bal then raise exception 'insufficient'; end if;   -- BEFORE deduct

  cells := public._mines_pick(p_mines);

  update public.wallets set balance = balance - p_bet
    where user_id = uid returning balance into newbal;

  insert into public.casino_rounds (user_id, game, bet, status, state)
    values (uid, 'mines', p_bet, 'active',
            jsonb_build_object('revealed', '[]'::jsonb, 'mult', 1.0, 'mines', p_mines))
    returning id into rid;
  insert into public.casino_round_secrets (round_id, secret)
    values (rid, jsonb_build_object('mines', to_jsonb(cells)));

  return jsonb_build_object(
    'round_id', rid, 'mines', p_mines, 'mult', 1.0,
    'revealed', '[]'::jsonb, 'balance', newbal);
end; $$;
revoke all on function public.mines_open(integer, integer) from public;
grant execute on function public.mines_open(integer, integer) to authenticated;

-- ── mines_reveal ──────────────────────────────────────────────────────────────
create or replace function public.mines_reveal(p_round uuid, p_cell integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); rnd public.casino_rounds%rowtype;
  mine_cells integer[]; revealed jsonb; revealed_count integer; mines integer;
  bet integer; mult numeric; win integer; newbal integer; safe_total integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_cell < 0 or p_cell > 24 then raise exception 'bad cell'; end if;

  select * into rnd from public.casino_rounds
    where id = p_round and user_id = uid for update;
  if not found then raise exception 'round not found'; end if;
  if rnd.status <> 'active' then raise exception 'round not active'; end if;
  if rnd.game <> 'mines' then raise exception 'wrong game'; end if;

  revealed := rnd.state->'revealed';
  bet      := rnd.bet;
  mines    := (rnd.state->>'mines')::integer;
  safe_total := 25 - mines;

  -- reveal dedupe: revealing an already-revealed cell is a no-op (prevents inflating mult)
  if revealed @> to_jsonb(p_cell) then
    return jsonb_build_object(
      'hit', false, 'cell', p_cell, 'revealed', revealed,
      'mult', (rnd.state->>'mult')::numeric, 'noop', true);
  end if;

  select array(select jsonb_array_elements_text(s.secret->'mines')::integer)
    into mine_cells from public.casino_round_secrets s where s.round_id = p_round;

  if p_cell = any(mine_cells) then
    -- BUST: credit nothing (bet already gone), reveal the full layout.
    update public.casino_rounds
      set status = 'busted', updated_at = now(),
          state = jsonb_set(state, '{busted_cell}', to_jsonb(p_cell))
      where id = p_round;
    insert into public.game_history (user_id, game, bet, result, payout)
      values (uid, 'mines', bet, 'loss', 0);
    return jsonb_build_object('hit', true, 'cell', p_cell, 'mines', to_jsonb(mine_cells));
  end if;

  -- SAFE: append, recompute mult.
  revealed := revealed || to_jsonb(p_cell);
  revealed_count := jsonb_array_length(revealed);
  mult := public._mines_mult(revealed_count, mines);

  if revealed_count = safe_total then
    -- all safe tiles found → auto-cashout. credit bet + floor(bet*(mult-1)).
    win := bet + floor(bet * (mult - 1))::integer;
    update public.casino_rounds
      set status = 'cashed_out', updated_at = now(),
          state = jsonb_set(jsonb_set(state, '{revealed}', revealed),
                            '{mult}', to_jsonb(mult))
      where id = p_round;
    update public.wallets set balance = balance + win
      where user_id = uid returning balance into newbal;
    insert into public.game_history (user_id, game, bet, result, payout)
      values (uid, 'mines', bet, 'win', win);
    return jsonb_build_object(
      'hit', false, 'cell', p_cell, 'revealed', revealed, 'mult', mult,
      'cashed_out', true, 'payout', win, 'balance', newbal);
  end if;

  update public.casino_rounds
    set updated_at = now(),
        state = jsonb_set(jsonb_set(state, '{revealed}', revealed),
                          '{mult}', to_jsonb(mult))
    where id = p_round;
  return jsonb_build_object(
    'hit', false, 'cell', p_cell, 'revealed', revealed, 'mult', mult);
end; $$;
revoke all on function public.mines_reveal(uuid, integer) from public;
grant execute on function public.mines_reveal(uuid, integer) to authenticated;

-- ── mines_cashout ─────────────────────────────────────────────────────────────
create or replace function public.mines_cashout(p_round uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); rnd public.casino_rounds%rowtype;
  revealed_count integer; mines integer; bet integer; mult numeric;
  win integer; newbal integer; mine_cells integer[];
begin
  if uid is null then raise exception 'not authenticated'; end if;

  select * into rnd from public.casino_rounds
    where id = p_round and user_id = uid for update;
  if not found then raise exception 'round not found'; end if;
  if rnd.status <> 'active' then raise exception 'round not active'; end if;
  if rnd.game <> 'mines' then raise exception 'wrong game'; end if;

  revealed_count := jsonb_array_length(rnd.state->'revealed');
  if revealed_count = 0 then raise exception 'reveal a tile first'; end if;

  mines := (rnd.state->>'mines')::integer;
  bet   := rnd.bet;
  mult  := public._mines_mult(revealed_count, mines);
  win   := bet + floor(bet * (mult - 1))::integer;

  update public.casino_rounds
    set status = 'cashed_out', updated_at = now(),
        state = jsonb_set(state, '{mult}', to_jsonb(mult))
    where id = p_round;
  update public.wallets set balance = balance + win
    where user_id = uid returning balance into newbal;
  insert into public.game_history (user_id, game, bet, result, payout)
    values (uid, 'mines', bet, 'win', win);

  -- reveal the mine layout on cashout too (the client reveals all mines).
  select array(select jsonb_array_elements_text(s.secret->'mines')::integer)
    into mine_cells from public.casino_round_secrets s where s.round_id = p_round;

  return jsonb_build_object(
    'payout', win, 'mult', mult, 'mines', to_jsonb(mine_cells), 'balance', newbal);
end; $$;
revoke all on function public.mines_cashout(uuid) from public;
grant execute on function public.mines_cashout(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK:
--   drop function if exists public.mines_cashout(uuid);
--   drop function if exists public.mines_reveal(uuid, integer);
--   drop function if exists public.mines_open(integer, integer);
--   drop function if exists public._mines_pick(integer);
--   drop function if exists public._mines_mult(integer, integer);
-- ─────────────────────────────────────────────────────────────────────────────

-- Migration 039: server-authoritative single-shot casino games. Idempotent. Additive.
-- ─────────────────────────────────────────────────────────────────────────────
-- Moves outcome generation + payout for Dice, Coin Flip, Roulette, Slots, Plinko
-- into the database. The client sends only (bet, choice); the server rolls with
-- random(), computes the net delta from the game's payout rules, applies it as a
-- DELTA write, inserts a game_history row, and returns the outcome to animate.
-- Overriding Math.random or calling these RPCs directly can no longer force wins.
--
-- All payout math is a VERBATIM mirror of the tested pure-JS engines (the source
-- of truth, 92 node:test cases). Keep the constants below in lockstep with:
--   src/pages/casino/diceEngine.js, coinflipEngine.js, rouletteEngine.js,
--   slotsEngine.js, plinkoGeom.js
--
-- random() is a (non-crypto) seeded PRNG — acceptable per the no-provably-fair
-- non-goal; a client cannot see or predict it. gen_random_bytes/pgcrypto avoided.
--
-- Invariants in EVERY function: require auth.uid(); SELECT balance ... FOR UPDATE;
-- reject bet <= 0 and bet > balance BEFORE any write; delta writes only
-- (balance = balance + d) scoped WHERE user_id = auth.uid(); INSERT game_history
-- on the (single) terminal path; return the outcome jsonb + the new balance.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Dice ────────────────────────────────────────────────────────────────────
-- keep in sync with src/pages/casino/diceEngine.js (resolveDice)
-- roll = floor(random()*6)+1; win iff roll == guess; delta = win ? +bet*4 : -bet.
create or replace function public.play_dice(p_bet integer, p_guess integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); bal integer; roll integer; won boolean; d integer; newbal integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_bet <= 0 then raise exception 'bad bet'; end if;
  if p_guess < 1 or p_guess > 6 then raise exception 'bad guess'; end if;
  select balance into bal from public.wallets where user_id = uid for update;
  if bal is null then raise exception 'no wallet'; end if;
  if p_bet > bal then raise exception 'insufficient'; end if;

  roll := floor(random() * 6) + 1;
  won  := (roll = p_guess);
  d    := case when won then p_bet * 4 else -p_bet end;

  update public.wallets set balance = balance + d
    where user_id = uid returning balance into newbal;
  insert into public.game_history (user_id, game, bet, result, payout)
    values (uid, 'dice', p_bet,
            case when won then 'win' else 'loss' end,
            case when won then p_bet + p_bet * 4 else 0 end);

  return jsonb_build_object('roll', roll, 'win', won, 'delta', d, 'balance', newbal);
end; $$;
revoke all on function public.play_dice(integer, integer) from public;
grant execute on function public.play_dice(integer, integer) to authenticated;


-- ── Coin Flip ─────────────────────────────────────────────────────────────────
-- keep in sync with src/pages/casino/coinflipEngine.js (resolveCoinFlip)
-- result = random() > 0.5 ? 'heads' : 'tails'; win iff result == choice;
-- delta = win ? +floor(bet*0.95) : -bet.
create or replace function public.play_coinflip(p_bet integer, p_choice text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); bal integer; res text; won boolean; d integer; newbal integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_bet <= 0 then raise exception 'bad bet'; end if;
  if p_choice not in ('heads', 'tails') then raise exception 'bad choice'; end if;
  select balance into bal from public.wallets where user_id = uid for update;
  if bal is null then raise exception 'no wallet'; end if;
  if p_bet > bal then raise exception 'insufficient'; end if;

  res := case when random() > 0.5 then 'heads' else 'tails' end;
  won := (res = p_choice);
  d   := case when won then floor(p_bet * 0.95) else -p_bet end;

  update public.wallets set balance = balance + d
    where user_id = uid returning balance into newbal;
  insert into public.game_history (user_id, game, bet, result, payout)
    values (uid, 'coinflip', p_bet,
            case when won then 'win' else 'loss' end,
            case when won then p_bet + floor(p_bet * 0.95) else 0 end);

  return jsonb_build_object('result', res, 'win', won, 'delta', d, 'balance', newbal);
end; $$;
revoke all on function public.play_coinflip(integer, text) from public;
grant execute on function public.play_coinflip(integer, text) to authenticated;


-- ── Roulette ──────────────────────────────────────────────────────────────────
-- keep in sync with src/pages/casino/rouletteEngine.js (resolveRoulette + RED_NUMBERS)
-- result = floor(random()*37) (0-36); color from the RED set; number hit → +bet*35,
-- color/parity hit → +bet, else -bet. (0 loses all color/parity bets.)
create or replace function public.play_roulette(p_bet integer, p_kind text, p_number integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); bal integer; res integer; color text;
  won boolean; d integer; newbal integer;
  -- RED_NUMBERS, copied verbatim from rouletteEngine.js
  red int[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_bet <= 0 then raise exception 'bad bet'; end if;
  if p_kind not in ('number', 'red', 'black', 'odd', 'even') then raise exception 'bad kind'; end if;
  if p_kind = 'number' and (p_number is null or p_number < 0 or p_number > 36) then
    raise exception 'bad number';
  end if;
  select balance into bal from public.wallets where user_id = uid for update;
  if bal is null then raise exception 'no wallet'; end if;
  if p_bet > bal then raise exception 'insufficient'; end if;

  res := floor(random() * 37);                 -- 0-36
  color := case
             when res = 0 then 'green'
             when res = any(red) then 'red'
             else 'black'
           end;

  won := case p_kind
           when 'number' then (p_number = res)
           when 'red'    then (color = 'red')
           when 'black'  then (color = 'black')
           when 'odd'    then (res <> 0 and res % 2 <> 0)
           when 'even'   then (res <> 0 and res % 2 = 0)
           else false
         end;

  if not won then d := -p_bet;
  elsif p_kind = 'number' then d := p_bet * 35;
  else d := p_bet;
  end if;

  update public.wallets set balance = balance + d
    where user_id = uid returning balance into newbal;
  insert into public.game_history (user_id, game, bet, result, payout)
    values (uid, 'roulette', p_bet,
            case when won then 'win' else 'loss' end,
            case when not won then 0
                 when p_kind = 'number' then p_bet + p_bet * 35
                 else p_bet + p_bet end);

  return jsonb_build_object('result', res, 'color', color, 'win', won, 'delta', d, 'balance', newbal);
end; $$;
revoke all on function public.play_roulette(integer, text, integer) from public;
grant execute on function public.play_roulette(integer, text, integer) to authenticated;


-- ── Slots ───────────────────────────────────────────────────────────────────
-- keep in sync with src/pages/casino/slotsEngine.js (drawSymbol/spinGrid/evaluateGrid/netForBet)
--   SYMBOLS  = ['🍒','🍋','7️⃣','⭐','💎']        (index 0..4)
--   WEIGHTS  = [6,6,4,3,1]  (sum 20)
--   PAYLINES = 3 rows + 2 diagonals (V, Λ), each 5 [row,col] cells
--   PAYTABLE = total-return multiplier per symbol index, keyed by run length 3/4/5
--   net = (totalReturn - 1) * bet
create or replace function public.play_slots(p_bet integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); bal integer; newbal integer;
  -- grid[row][col] of symbol indices; ROWS=3, REELS=5
  grid integer[][];
  r integer; c integer; draw_r double precision; sym integer;
  -- WEIGHTS copied verbatim; drawSymbol = subtract weights in order against rng()*20
  weights int[] := array[6,6,4,3,1];
  total_return integer := 0;
  d integer;
  -- PAYLINES as flat [row,col] pairs: 5 lines × 5 cells. Mirrors slotsEngine.PAYLINES.
  --   line 0 top row, 1 mid row, 2 bottom row, 3 = V, 4 = Λ
  line_rows int[][] := array[
    array[0,0,0,0,0],   -- top row rows
    array[1,1,1,1,1],   -- mid row rows
    array[2,2,2,2,2],   -- bottom row rows
    array[0,1,2,1,0],   -- V rows
    array[2,1,0,1,2]    -- Λ rows
  ];
  line_cols int[][] := array[
    array[0,1,2,3,4],
    array[0,1,2,3,4],
    array[0,1,2,3,4],
    array[0,1,2,3,4],
    array[0,1,2,3,4]
  ];
  li integer; first_sym integer; run_len integer; pi integer;
  pr integer; pc integer; mult integer;
  lines jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_bet <= 0 then raise exception 'bad bet'; end if;
  select balance into bal from public.wallets where user_id = uid for update;
  if bal is null then raise exception 'no wallet'; end if;
  if p_bet > bal then raise exception 'insufficient'; end if;

  -- spinGrid: one independent weighted draw per cell.
  grid := array_fill(0, array[3,5]);
  for r in 0..2 loop
    for c in 0..4 loop
      -- drawSymbol: r = random()*20; subtract WEIGHTS[i] in order; return first i where r<0.
      draw_r := random() * 20;   -- WEIGHT_TOTAL = 20
      sym := 4;                  -- fallback = last index (WEIGHTS.length-1)
      for li in 1..5 loop
        draw_r := draw_r - weights[li];
        if draw_r < 0 then sym := li - 1; exit; end if;
      end loop;
      grid[r + 1][c + 1] := sym;   -- 1-based storage; logical index = sym (0..4)
    end loop;
  end loop;

  -- evaluateGrid: each payline pays when its leftmost symbol repeats on 3+ consecutive
  -- cells from the left. PAYTABLE lookup is inlined via a CASE per (symbol, run length).
  for li in 0..4 loop
    -- leftmost cell of this line
    pr := line_rows[li + 1][1]; pc := line_cols[li + 1][1];
    first_sym := grid[pr + 1][pc + 1];
    run_len := 1;
    for pi in 2..5 loop
      pr := line_rows[li + 1][pi]; pc := line_cols[li + 1][pi];
      if grid[pr + 1][pc + 1] = first_sym then run_len := run_len + 1; else exit; end if;
    end loop;

    if run_len >= 3 then
      -- PAYTABLE[symbol][runLength] — copied verbatim from slotsEngine.PAYTABLE
      mult := case first_sym
        when 0 then case run_len when 3 then 1  when 4 then 3  else 10  end   -- 🍒
        when 1 then case run_len when 3 then 1  when 4 then 3  else 10  end   -- 🍋
        when 2 then case run_len when 3 then 3  when 4 then 8  else 25  end   -- 7️⃣
        when 3 then case run_len when 3 then 5  when 4 then 15 else 60  end   -- ⭐
        else        case run_len when 3 then 20 when 4 then 80 else 300 end   -- 💎
      end;
      total_return := total_return + mult;
      lines := lines || jsonb_build_object(
        'lineIndex', li, 'symbol', first_sym, 'runLength', run_len, 'multiplier', mult);
    end if;
  end loop;

  -- netForBet: net = (totalReturn - 1) * bet
  d := (total_return - 1) * p_bet;

  update public.wallets set balance = balance + d
    where user_id = uid returning balance into newbal;
  insert into public.game_history (user_id, game, bet, result, payout)
    values (uid, 'slots', p_bet,
            case when d > 0 then 'win' when d = 0 then 'push' else 'loss' end,
            total_return * p_bet);   -- gross return = totalReturn * bet

  -- Return the grid as a 2D jsonb array of symbol indices (row-major) for the client.
  return jsonb_build_object(
    'grid', to_jsonb(grid),
    'totalReturn', total_return,
    'lines', lines,
    'net', d,
    'delta', d,
    'balance', newbal);
end; $$;
revoke all on function public.play_slots(integer) from public;
grant execute on function public.play_slots(integer) to authenticated;


-- ── Plinko ────────────────────────────────────────────────────────────────────
-- keep in sync with src/pages/casino/plinkoGeom.js (resolvePlinko + MULTIPLIERS)
-- decisions[i] = floor(random()*2) per row; slot = sum of rights (0..rows);
-- mult = MULTIPLIERS[rows][risk][slot]; delta = floor(bet*mult) - bet.
create or replace function public.play_plinko(p_bet integer, p_rows integer, p_risk text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); bal integer; newbal integer;
  i integer; dec integer; slot integer := 0; mult double precision; d integer;
  decisions jsonb := '[]'::jsonb;
  -- MULTIPLIERS tables copied VERBATIM from plinkoGeom.js. Indexed [slot] = #right deflections.
  m8_low    double precision[] := array[5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6];
  m8_medium double precision[] := array[13,   3,  1.3, 0.7, 0.4, 0.7, 1.3,  3,  13];
  m8_high   double precision[] := array[29,   4,  1.5, 0.3, 0.2, 0.3, 1.5,  4,  29];
  m12_low    double precision[] := array[10,   3,  1.6, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 1.6,  3,  10];
  m12_medium double precision[] := array[33,  11,   4,   2,  1.1, 0.6, 0.3, 0.6, 1.1,  2,   4,  11,  33];
  m12_high   double precision[] := array[170, 24,   8,   2,  0.7, 0.2, 0.2, 0.2, 0.7,  2,   8,  24, 170];
  m16_low    double precision[] := array[16,   9,   2,  1.4, 1.4, 1.2, 1.1, 1.0, 0.5, 1.0, 1.1, 1.2, 1.4, 1.4,  2,   9,  16];
  m16_medium double precision[] := array[110,  41,  10,   5,   3, 1.5, 1.0, 0.5, 0.3, 0.5, 1.0, 1.5,   3,   5,  10,  41, 110];
  m16_high   double precision[] := array[1000, 130, 26,   9,   4,   2, 0.2, 0.2, 0.2, 0.2, 0.2,   2,   4,   9,  26, 130, 1000];
  tbl double precision[];
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_bet <= 0 then raise exception 'bad bet'; end if;
  if p_rows not in (8, 12, 16) then raise exception 'bad rows'; end if;
  if p_risk not in ('low', 'medium', 'high') then raise exception 'bad risk'; end if;
  select balance into bal from public.wallets where user_id = uid for update;
  if bal is null then raise exception 'no wallet'; end if;
  if p_bet > bal then raise exception 'insufficient'; end if;

  -- decisions: floor(random()*2) per row; slot = number of rights.
  for i in 1..p_rows loop
    dec := floor(random() * 2);          -- 0 = left, 1 = right
    slot := slot + dec;
    decisions := decisions || to_jsonb(dec);
  end loop;

  -- look up MULTIPLIERS[rows][risk]; arrays are 1-based, so slot+1.
  tbl := case p_rows
    when 8  then case p_risk when 'low' then m8_low  when 'medium' then m8_medium  else m8_high  end
    when 12 then case p_risk when 'low' then m12_low when 'medium' then m12_medium else m12_high end
    else         case p_risk when 'low' then m16_low when 'medium' then m16_medium else m16_high end
  end;
  mult := tbl[slot + 1];

  -- delta = floor(bet*mult) - bet  (matches PlinkoGame.jsx)
  d := floor(p_bet * mult) - p_bet;

  update public.wallets set balance = balance + d
    where user_id = uid returning balance into newbal;
  insert into public.game_history (user_id, game, bet, result, payout)
    values (uid, 'plinko', p_bet,
            case when d > 0 then 'win' when d = 0 then 'push' else 'loss' end,
            floor(p_bet * mult));     -- gross return = floor(bet*mult)

  return jsonb_build_object(
    'decisions', decisions,
    'slot', slot,
    'mult', mult,
    'delta', d,
    'balance', newbal);
end; $$;
revoke all on function public.play_plinko(integer, integer, text) from public;
grant execute on function public.play_plinko(integer, integer, text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK:
--   drop function if exists public.play_dice(integer, integer);
--   drop function if exists public.play_coinflip(integer, text);
--   drop function if exists public.play_roulette(integer, text, integer);
--   drop function if exists public.play_slots(integer);
--   drop function if exists public.play_plinko(integer, integer, text);
-- ─────────────────────────────────────────────────────────────────────────────

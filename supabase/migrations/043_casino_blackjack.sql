-- Migration 043: server-authoritative Blackjack. Idempotent. Additive.
-- HIGHEST-RISK SQL TRANSLATION — mirrors blackjackEngine.js line-for-line and the
-- deal/draw order in BlackjackGame.jsx. Reviewed against blackjackEngine.test.js.
-- ─────────────────────────────────────────────────────────────────────────────
-- keep in sync with src/pages/casino/blackjackEngine.js
--   (buildDeck, shuffle, cardValue, handValue, isBlackjack, dealerPlay, settle)
-- and the deal order in BlackjackGame.jsx (handleDeal/handleHit/dealer useEffect).
--
-- Secret holds the full shuffled 52-card deck order + a `dealt` pointer (how many
-- cards have been consumed). The client never sees the deck or the dealer hole
-- card mid-round; the hole card + dealer draws are only returned at settle.
--
-- Card model: a card is {suit, rank}. cardValue: J/Q/K=10, A=11, pips numeric.
--   handValue sums (ace=11) then reduces 11→1 one ace at a time while > 21.
--
-- DECK ORDER (buildDeck): nested loop suits ['♠','♣','♥','♦'] × ranks
--   ['A','2'..'10','J','Q','K'] → 52 cards. shuffle = Fisher-Yates from the end:
--   for i=51 downto 1: j=floor(rng()*(i+1)); swap d[i],d[j].
-- DEAL (handleDeal): the client draws by POPPING from the END of the shuffled
--   deck, in order player1, dealer1, player2, dealer2. So with `dealt` counting
--   from the end, card #1 = deck[52], #2 = deck[51], … (1-based SQL array).
--   player = {#1, #3}, dealer = {#2, #4}; hits/dealer draws continue popping.
--
-- SETTLE (credited gross amount; bet already deducted at deal):
--   both blackjack → push (bet); player blackjack → bet+floor(bet*1.5);
--   dealer blackjack (player not) → 0; player bust → 0; dealer bust → stake*2;
--   higher player → stake*2; lower → 0; equal → stake (push).
--   doubled scales stake by 2 (stake = bet*2); a doubled hand is 3+ cards so it
--   can never be a natural blackjack.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Helper: card value (rank → points; ace = 11) ─────────────────────────────
create or replace function public._bj_card_value(p_rank text)
returns integer language sql immutable set search_path = public as $$
  select case
    when p_rank in ('J', 'Q', 'K') then 10
    when p_rank = 'A' then 11
    else p_rank::integer
  end;
$$;

-- ── Helper: hand value over a jsonb array of {suit,rank} cards ────────────────
-- Mirrors handValue: total with aces=11, then reduce 11→1 one ace at a time while >21.
create or replace function public._bj_hand_value(p_hand jsonb)
returns integer language plpgsql immutable set search_path = public as $$
declare total integer := 0; aces integer := 0; card jsonb; rank text;
begin
  for card in select * from jsonb_array_elements(p_hand) loop
    rank := card->>'rank';
    total := total + public._bj_card_value(rank);
    if rank = 'A' then aces := aces + 1; end if;
  end loop;
  while total > 21 and aces > 0 loop
    total := total - 10;
    aces := aces - 1;
  end loop;
  return total;
end; $$;

-- ── Helper: is a 2-card 21 (natural blackjack) ───────────────────────────────
create or replace function public._bj_is_blackjack(p_hand jsonb)
returns boolean language sql immutable set search_path = public as $$
  select jsonb_array_length(p_hand) = 2 and public._bj_hand_value(p_hand) = 21;
$$;

-- ── Helper: build + shuffle a fresh deck into the secret jsonb array ──────────
-- buildDeck order then Fisher-Yates from the end. Stored 1-based; deal pops the END.
create or replace function public._bj_shuffled_deck()
returns jsonb language plpgsql set search_path = public as $$
declare
  suits text[] := array['♠', '♣', '♥', '♦'];
  ranks text[] := array['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  deck jsonb[] := array[]::jsonb[];
  s integer; r integer; i integer; j integer; tmp jsonb;
begin
  -- buildDeck: suits outer, ranks inner
  for s in 1..array_length(suits, 1) loop
    for r in 1..array_length(ranks, 1) loop
      deck := deck || jsonb_build_object('suit', suits[s], 'rank', ranks[r]);
    end loop;
  end loop;
  -- Fisher-Yates from the end: for i=52 downto 2: j=floor(random()*i)+1; swap.
  -- (engine: i from len-1 downto 1, j=floor(rng()*(i+1)); 1-based equivalent below)
  for i in reverse 52..2 loop
    j := floor(random() * i)::integer + 1;   -- 1..i
    tmp := deck[i]; deck[i] := deck[j]; deck[j] := tmp;
  end loop;
  return to_jsonb(deck);
end; $$;

-- ── Helper: deal the Nth card (1-based) counting from the END of the deck ─────
-- card #n = deck[ 52 - n + 1 ] = deck[ 53 - n ]  (1-based jsonb array).
create or replace function public._bj_card(p_deck jsonb, p_n integer)
returns jsonb language sql immutable set search_path = public as $$
  select p_deck->(53 - p_n - 1);   -- jsonb -> int is 0-based: element (53-n) is index (53-n-1)
$$;

-- ── blackjack_open ────────────────────────────────────────────────────────────
-- Deal player1, dealer1, player2, dealer2 (dealt=4). Resolve naturals immediately;
-- else leave the round 'active' for hit/stand/double. Bet deducted here.
create or replace function public.blackjack_open(p_bet integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); bal integer; rid uuid; newbal integer;
  deck jsonb; player jsonb; dealer jsonb;
  player_bj boolean; dealer_bj boolean; win integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_bet <= 0 then raise exception 'bad bet'; end if;
  select balance into bal from public.wallets where user_id = uid for update;
  if bal is null then raise exception 'no wallet'; end if;
  if p_bet > bal then raise exception 'insufficient'; end if;   -- BEFORE deduct

  deck := public._bj_shuffled_deck();
  -- deal order: p1=#1, dealer1=#2, p2=#3, dealer2=#4
  player := jsonb_build_array(public._bj_card(deck, 1), public._bj_card(deck, 3));
  dealer := jsonb_build_array(public._bj_card(deck, 2), public._bj_card(deck, 4));

  -- deduct the bet up front
  update public.wallets set balance = balance - p_bet
    where user_id = uid returning balance into newbal;

  insert into public.casino_rounds (user_id, game, bet, status, state)
    values (uid, 'blackjack', p_bet, 'active',
            jsonb_build_object('player', player, 'dealer_up', dealer->0, 'doubled', false))
    returning id into rid;
  insert into public.casino_round_secrets (round_id, secret)
    values (rid, jsonb_build_object('deck', deck, 'dealt', 4, 'dealer', dealer));

  player_bj := public._bj_is_blackjack(player);
  dealer_bj := public._bj_is_blackjack(dealer);

  if player_bj or dealer_bj then
    -- naturals resolve immediately (mirrors handleDeal)
    if player_bj and dealer_bj then
      win := p_bet;                                  -- push
    elsif player_bj then
      win := p_bet + floor(p_bet * 1.5)::integer;    -- blackjack 3:2
    else
      win := 0;                                      -- dealer blackjack only
    end if;

    update public.casino_rounds
      set status = 'cashed_out', updated_at = now(),
          state = jsonb_set(state, '{dealer}', dealer)
      where id = rid;
    if win > 0 then
      update public.wallets set balance = balance + win
        where user_id = uid returning balance into newbal;
    end if;
    insert into public.game_history (user_id, game, bet, result, payout)
      values (uid, 'blackjack', p_bet,
              case when player_bj and dealer_bj then 'push'
                   when player_bj then 'win' else 'loss' end,
              win);
    return jsonb_build_object(
      'round_id', rid, 'player', player, 'dealer', dealer,
      'player_value', public._bj_hand_value(player),
      'dealer_value', public._bj_hand_value(dealer),
      'done', true,
      'result', case when player_bj and dealer_bj then 'push'
                     when player_bj then 'win' else 'loss' end,
      'payout', win, 'balance', newbal);
  end if;

  -- in play: return only the dealer's UP card.
  return jsonb_build_object(
    'round_id', rid, 'player', player, 'dealer_up', dealer->0,
    'player_value', public._bj_hand_value(player), 'done', false, 'balance', newbal);
end; $$;
revoke all on function public.blackjack_open(integer) from public;
grant execute on function public.blackjack_open(integer) to authenticated;

-- ── Internal: run the dealer + settle a standing/doubled player ───────────────
-- Mirrors the dealer useEffect + settle(). Returns the terminal jsonb. Assumes the
-- round row is already locked FOR UPDATE by the caller and status='active'.
create or replace function public._bj_finish(
  p_round uuid, p_uid uuid, p_doubled boolean, p_stake integer)
returns jsonb language plpgsql set search_path = public as $$
declare
  rnd public.casino_rounds%rowtype; deck jsonb; dealt integer;
  player jsonb; dealer jsonb; bet integer;
  player_val integer; dealer_val integer; win integer; newbal integer; res text;
begin
  select * into rnd from public.casino_rounds where id = p_round;
  player := rnd.state->'player';
  bet    := rnd.bet;
  select s.secret->'deck', (s.secret->>'dealt')::integer, s.secret->'dealer'
    into deck, dealt, dealer
    from public.casino_round_secrets s where s.round_id = p_round;

  -- dealerPlay: hit while value < 17, drawing the next card from the deck (pop end).
  while public._bj_hand_value(dealer) < 17 loop
    dealt := dealt + 1;
    dealer := dealer || public._bj_card(deck, dealt);
  end loop;

  player_val := public._bj_hand_value(player);
  dealer_val := public._bj_hand_value(dealer);

  -- settle(): naturals already handled at open; here player has 2+ cards and may be
  -- a 3-card 21 (NOT a natural). isBlackjack(player) here is false unless still a
  -- 2-card 21 that wasn't caught at open — but open always resolves a 2-card 21, so
  -- a stand reaching _bj_finish is a non-natural hand. Dealer could still hold a
  -- natural only if open missed it, which it cannot. We therefore follow the engine's
  -- post-natural branches directly.
  if player_val > 21 then
    win := 0; res := 'loss';                       -- player bust
  elsif dealer_val > 21 then
    win := p_stake * 2; res := 'win';              -- dealer bust
  elsif player_val > dealer_val then
    win := p_stake * 2; res := 'win';
  elsif player_val < dealer_val then
    win := 0; res := 'loss';
  else
    win := p_stake; res := 'push';                 -- equal totals
  end if;

  update public.casino_rounds
    set status = 'cashed_out', updated_at = now(),
        state = jsonb_set(jsonb_set(state, '{dealer}', dealer), '{doubled}', to_jsonb(p_doubled))
    where id = p_round;
  if win > 0 then
    update public.wallets set balance = balance + win
      where user_id = p_uid returning balance into newbal;
  else
    select balance into newbal from public.wallets where user_id = p_uid;
  end if;
  insert into public.game_history (user_id, game, bet, result, payout)
    values (p_uid, 'blackjack', bet, res, win);

  return jsonb_build_object(
    'player', player, 'dealer', dealer,
    'player_value', player_val, 'dealer_value', dealer_val,
    'done', true, 'result', res, 'payout', win, 'doubled', p_doubled, 'balance', newbal);
end; $$;

-- Internal helpers are never called directly by the client (the public RPCs invoke
-- them as DEFINER). Revoke PUBLIC execute — _bj_finish in particular writes wallets.
revoke all on function public._bj_card_value(text) from public;
revoke all on function public._bj_hand_value(jsonb) from public;
revoke all on function public._bj_is_blackjack(jsonb) from public;
revoke all on function public._bj_shuffled_deck() from public;
revoke all on function public._bj_card(jsonb, integer) from public;
revoke all on function public._bj_finish(uuid, uuid, boolean, integer) from public;

-- ── blackjack_hit ─────────────────────────────────────────────────────────────
create or replace function public.blackjack_hit(p_round uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); rnd public.casino_rounds%rowtype;
  deck jsonb; dealt integer; player jsonb; bet integer; pval integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into rnd from public.casino_rounds
    where id = p_round and user_id = uid for update;
  if not found then raise exception 'round not found'; end if;
  if rnd.status <> 'active' then raise exception 'round not active'; end if;
  if rnd.game <> 'blackjack' then raise exception 'wrong game'; end if;
  if (rnd.state->>'doubled')::boolean then raise exception 'already doubled'; end if;

  player := rnd.state->'player';
  bet    := rnd.bet;
  select s.secret->'deck', (s.secret->>'dealt')::integer
    into deck, dealt from public.casino_round_secrets s where s.round_id = p_round;

  -- draw one card to the player.
  dealt := dealt + 1;
  player := player || public._bj_card(deck, dealt);
  pval := public._bj_hand_value(player);

  update public.casino_round_secrets
    set secret = jsonb_set(secret, '{dealt}', to_jsonb(dealt))
    where round_id = p_round;
  update public.casino_rounds
    set updated_at = now(), state = jsonb_set(state, '{player}', player)
    where id = p_round;

  if pval > 21 then
    -- BUST: loss (mirrors handleHit). credit nothing.
    update public.casino_rounds set status = 'busted', updated_at = now() where id = p_round;
    insert into public.game_history (user_id, game, bet, result, payout)
      values (uid, 'blackjack', bet, 'loss', 0);
    return jsonb_build_object(
      'player', player, 'player_value', pval, 'done', true, 'result', 'loss', 'payout', 0);
  end if;

  return jsonb_build_object('player', player, 'player_value', pval, 'done', false);
end; $$;
revoke all on function public.blackjack_hit(uuid) from public;
grant execute on function public.blackjack_hit(uuid) to authenticated;

-- ── blackjack_stand ───────────────────────────────────────────────────────────
create or replace function public.blackjack_stand(p_round uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); rnd public.casino_rounds%rowtype;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into rnd from public.casino_rounds
    where id = p_round and user_id = uid for update;
  if not found then raise exception 'round not found'; end if;
  if rnd.status <> 'active' then raise exception 'round not active'; end if;
  if rnd.game <> 'blackjack' then raise exception 'wrong game'; end if;

  return public._bj_finish(p_round, uid, false, rnd.bet);
end; $$;
revoke all on function public.blackjack_stand(uuid) from public;
grant execute on function public.blackjack_stand(uuid) to authenticated;

-- ── blackjack_double ──────────────────────────────────────────────────────────
-- Deduct a second bet, draw exactly one card, then auto-stand (dealer plays, settle
-- with doubled=true → stake = bet*2). Mirrors blackjackEngine.settle's doubled path.
create or replace function public.blackjack_double(p_round uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); rnd public.casino_rounds%rowtype; bal integer;
  deck jsonb; dealt integer; player jsonb; bet integer; pval integer; newbal integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into rnd from public.casino_rounds
    where id = p_round and user_id = uid for update;
  if not found then raise exception 'round not found'; end if;
  if rnd.status <> 'active' then raise exception 'round not active'; end if;
  if rnd.game <> 'blackjack' then raise exception 'wrong game'; end if;
  if (rnd.state->>'doubled')::boolean then raise exception 'already doubled'; end if;
  if jsonb_array_length(rnd.state->'player') <> 2 then raise exception 'can only double on first two cards'; end if;

  bet := rnd.bet;
  -- deduct the second bet (must afford it).
  select balance into bal from public.wallets where user_id = uid for update;
  if bal is null or bal < bet then raise exception 'insufficient to double'; end if;
  update public.wallets set balance = balance - bet where user_id = uid;

  player := rnd.state->'player';
  select s.secret->'deck', (s.secret->>'dealt')::integer
    into deck, dealt from public.casino_round_secrets s where s.round_id = p_round;

  -- draw exactly one card.
  dealt := dealt + 1;
  player := player || public._bj_card(deck, dealt);
  pval := public._bj_hand_value(player);

  update public.casino_round_secrets
    set secret = jsonb_set(secret, '{dealt}', to_jsonb(dealt))
    where round_id = p_round;
  update public.casino_rounds
    set updated_at = now(),
        state = jsonb_set(jsonb_set(state, '{player}', player), '{doubled}', to_jsonb(true))
    where id = p_round;

  if pval > 21 then
    -- doubled bust → loss; stake (bet*2) already deducted, credit nothing.
    update public.casino_rounds set status = 'busted', updated_at = now() where id = p_round;
    select balance into newbal from public.wallets where user_id = uid;
    insert into public.game_history (user_id, game, bet, result, payout)
      values (uid, 'blackjack', bet, 'loss', 0);
    return jsonb_build_object(
      'player', player, 'player_value', pval, 'done', true, 'result', 'loss',
      'payout', 0, 'doubled', true, 'balance', newbal);
  end if;

  -- auto-stand → dealer plays + settle with stake = bet*2.
  return public._bj_finish(p_round, uid, true, bet * 2);
end; $$;
revoke all on function public.blackjack_double(uuid) from public;
grant execute on function public.blackjack_double(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK:
--   drop function if exists public.blackjack_double(uuid);
--   drop function if exists public.blackjack_stand(uuid);
--   drop function if exists public.blackjack_hit(uuid);
--   drop function if exists public.blackjack_open(integer);
--   drop function if exists public._bj_finish(uuid, uuid, boolean, integer);
--   drop function if exists public._bj_card(jsonb, integer);
--   drop function if exists public._bj_shuffled_deck();
--   drop function if exists public._bj_is_blackjack(jsonb);
--   drop function if exists public._bj_hand_value(jsonb);
--   drop function if exists public._bj_card_value(text);
-- ─────────────────────────────────────────────────────────────────────────────

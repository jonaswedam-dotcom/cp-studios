import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SUITS, RANKS,
  buildDeck, shuffle, cardValue, handValue, isBlackjack, dealerPlay, settle,
} from './blackjackEngine.js'

// ── buildDeck ──────────────────────────────────────────────────────────────
test('buildDeck returns 52 unique cards', () => {
  const deck = buildDeck()
  assert.equal(deck.length, 52)
  const keys = new Set(deck.map((c) => `${c.rank}${c.suit}`))
  assert.equal(keys.size, 52)
})

test('buildDeck iterates suits then ranks, matching the component order', () => {
  const deck = buildDeck()
  // First 13 cards are all the first suit, in RANKS order
  assert.deepEqual(deck[0], { suit: SUITS[0], rank: RANKS[0] })
  assert.deepEqual(deck[12], { suit: SUITS[0], rank: RANKS[12] })
  assert.deepEqual(deck[13], { suit: SUITS[1], rank: RANKS[0] })
  assert.deepEqual(deck[51], { suit: SUITS[3], rank: RANKS[12] })
})

// ── shuffle (Fisher-Yates, rng injectable) ───────────────────────────────────
test('shuffle does not mutate the input deck', () => {
  const deck = buildDeck()
  const copy = deck.map((c) => ({ ...c }))
  shuffle(deck, () => 0.5)
  assert.deepEqual(deck, copy)
})

test('shuffle is a permutation (same multiset of cards)', () => {
  const deck = buildDeck()
  const shuffled = shuffle(deck, () => 0.42)
  assert.equal(shuffled.length, 52)
  const a = deck.map((c) => `${c.rank}${c.suit}`).sort()
  const b = shuffled.map((c) => `${c.rank}${c.suit}`).sort()
  assert.deepEqual(a, b)
})

test('shuffle with rng()=0 leaves the deck unchanged (j === i each step)', () => {
  // Fisher-Yates: j = floor(rng()*(i+1)); rng()=0 => j=0... but swap is i<->0.
  // Verify against a hand-rolled reference of the exact same algorithm.
  const deck = buildDeck()
  const rng = () => 0
  const ref = deck.map((c) => ({ ...c }))
  for (let i = ref.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[ref[i], ref[j]] = [ref[j], ref[i]]
  }
  assert.deepEqual(shuffle(deck, rng), ref)
})

test('shuffle matches the component algorithm for a varying rng', () => {
  const deck = buildDeck()
  let n = 0
  const seq = () => ((n = (n * 9301 + 49297) % 233280), n / 233280)
  // Build the reference with a fresh identical sequence.
  let m = 0
  const seq2 = () => ((m = (m * 9301 + 49297) % 233280), m / 233280)
  const ref = deck.map((c) => ({ ...c }))
  for (let i = ref.length - 1; i > 0; i--) {
    const j = Math.floor(seq2() * (i + 1))
    ;[ref[i], ref[j]] = [ref[j], ref[i]]
  }
  assert.deepEqual(shuffle(deck, seq), ref)
})

// ── cardValue ────────────────────────────────────────────────────────────────
test('cardValue: face cards are 10, ace is 11, pips are numeric', () => {
  assert.equal(cardValue('J'), 10)
  assert.equal(cardValue('Q'), 10)
  assert.equal(cardValue('K'), 10)
  assert.equal(cardValue('A'), 11)
  assert.equal(cardValue('2'), 2)
  assert.equal(cardValue('10'), 10)
  assert.equal(cardValue('9'), 9)
})

// ── handValue (ace 11→1, multiple aces) ──────────────────────────────────────
const C = (rank) => ({ suit: '♠', rank })

test('handValue: simple non-ace hand', () => {
  assert.equal(handValue([C('10'), C('7')]), 17)
})

test('handValue: single ace counts as 11 when it does not bust (soft 17)', () => {
  assert.equal(handValue([C('A'), C('6')]), 17) // soft 17
})

test('handValue: ace reduces 11→1 to avoid bust', () => {
  assert.equal(handValue([C('A'), C('6'), C('10')]), 17) // 11+6+10=27 → 1+6+10=17
})

test('handValue: two aces — only one stays 11 (A+A = 12)', () => {
  assert.equal(handValue([C('A'), C('A')]), 12) // 11+11=22 → reduce one → 12
})

test('handValue: two aces both reduce when needed', () => {
  assert.equal(handValue([C('A'), C('A'), C('9')]), 21) // 11+11+9=31 → 11+1+9=21
})

test('handValue: many aces, none can stay 11', () => {
  // A A A A 7 = 4 aces + 7. 11+1+1+1+7=21
  assert.equal(handValue([C('A'), C('A'), C('A'), C('A'), C('7')]), 21)
  // A A A A K K = 4 aces + 20 → all reduce → 4 + 20 = 24 (bust)
  assert.equal(handValue([C('A'), C('A'), C('A'), C('A'), C('K'), C('K')]), 24)
})

test('handValue: natural blackjack is 21', () => {
  assert.equal(handValue([C('A'), C('K')]), 21)
})

test('handValue: hard bust', () => {
  assert.equal(handValue([C('K'), C('Q'), C('5')]), 25)
})

// ── isBlackjack ───────────────────────────────────────────────────────────────
test('isBlackjack: 2-card 21 is blackjack', () => {
  assert.equal(isBlackjack([C('A'), C('10')]), true)
  assert.equal(isBlackjack([C('A'), C('J')]), true)
})

test('isBlackjack: 3-card 21 is NOT blackjack', () => {
  assert.equal(isBlackjack([C('7'), C('7'), C('7')]), false)
})

test('isBlackjack: 2-card non-21 is not blackjack', () => {
  assert.equal(isBlackjack([C('10'), C('9')]), false)
})

// ── dealerPlay (hit while value < 17, stop at 17+) ────────────────────────────
test('dealerPlay: stands immediately at 17+', () => {
  const deck = [C('5'), C('5')] // would only draw if it hits
  const r = dealerPlay(deck, 0, [C('10'), C('7')]) // 17, stand
  assert.equal(handValue(r.dealerCards), 17)
  assert.equal(r.dealerCards.length, 2) // no cards drawn
  assert.equal(r.nextIdx, 0) // deck untouched
})

test('dealerPlay: hits below 17, draws from startIdx forward', () => {
  // dealer starts 10+6=16, must hit. Next card is the 5 at index 0 → 21, stand.
  const deck = [C('5'), C('9')]
  const r = dealerPlay(deck, 0, [C('10'), C('6')])
  assert.equal(handValue(r.dealerCards), 21)
  assert.equal(r.dealerCards.length, 3)
  assert.equal(r.nextIdx, 1)
})

test('dealerPlay: keeps hitting until 17+ then stops', () => {
  // start 2+3=5; draw 4 (9), draw 4 (13), draw 4 (17) → stop.
  const deck = [C('4'), C('4'), C('4'), C('K')]
  const r = dealerPlay(deck, 0, [C('2'), C('3')])
  assert.equal(handValue(r.dealerCards), 17)
  assert.equal(r.nextIdx, 3)
})

test('dealerPlay: dealer can bust', () => {
  // start 10+6=16, draw 10 → 26 bust, stop.
  const deck = [C('10')]
  const r = dealerPlay(deck, 0, [C('10'), C('6')])
  assert.equal(handValue(r.dealerCards), 26)
  assert.equal(r.nextIdx, 1)
})

test('dealerPlay: soft 17 (A+6) stands (value 17, no further hit)', () => {
  const deck = [C('9')]
  const r = dealerPlay(deck, 0, [C('A'), C('6')]) // soft 17 → stand (mirrors component)
  assert.equal(handValue(r.dealerCards), 17)
  assert.equal(r.dealerCards.length, 2)
  assert.equal(r.nextIdx, 0)
})

test('dealerPlay: respects a non-zero startIdx', () => {
  const deck = [C('A'), C('A'), C('5'), C('9')]
  // dealer 10+6=16, start drawing at index 2 → draw 5 (21), stand.
  const r = dealerPlay(deck, 2, [C('10'), C('6')])
  assert.equal(handValue(r.dealerCards), 21)
  assert.equal(r.nextIdx, 3)
})

// ── settle (CREDITED amount; bet already deducted server-side) ────────────────
// Settlement table (credited amount returned to the player):
//   natural blackjack (2-card 21, dealer not blackjack) → bet + floor(bet*1.5)
//   win  → bet*2
//   push → bet
//   loss → 0
//   double scales the staked bet by 2 (win → bet*4, push → bet*2, loss → 0)

test('settle: natural blackjack pays bet + floor(bet*1.5)', () => {
  assert.equal(settle({ playerCards: [C('A'), C('K')], dealerCards: [C('10'), C('7')], bet: 100 }), 250)
  // odd bet exercises the floor: 75 + floor(75*1.5)=75+112=187
  assert.equal(settle({ playerCards: [C('A'), C('K')], dealerCards: [C('10'), C('7')], bet: 75 }), 187)
})

test('settle: player blackjack vs dealer blackjack is a push', () => {
  assert.equal(settle({ playerCards: [C('A'), C('K')], dealerCards: [C('A'), C('Q')], bet: 100 }), 100)
})

test('settle: dealer blackjack beats a non-blackjack 21 (loss)', () => {
  // player draws to 21 in 3 cards (not a natural), dealer has a natural → loss
  assert.equal(settle({ playerCards: [C('7'), C('7'), C('7')], dealerCards: [C('A'), C('K')], bet: 100 }), 0)
})

test('settle: player bust loses regardless of dealer', () => {
  assert.equal(settle({ playerCards: [C('K'), C('Q'), C('5')], dealerCards: [C('10'), C('7')], bet: 100 }), 0)
})

test('settle: dealer bust wins for a standing player', () => {
  assert.equal(settle({ playerCards: [C('10'), C('8')], dealerCards: [C('10'), C('6'), C('10')], bet: 100 }), 200)
})

test('settle: higher player total wins (bet*2)', () => {
  assert.equal(settle({ playerCards: [C('10'), C('10')], dealerCards: [C('10'), C('8')], bet: 100 }), 200)
})

test('settle: lower player total loses (0)', () => {
  assert.equal(settle({ playerCards: [C('10'), C('7')], dealerCards: [C('10'), C('9')], bet: 100 }), 0)
})

test('settle: equal totals push (bet)', () => {
  assert.equal(settle({ playerCards: [C('10'), C('8')], dealerCards: [C('10'), C('8')], bet: 100 }), 100)
})

// ── settle: doubled (stake scaled by 2) ───────────────────────────────────────
test('settle: doubled win pays bet*4 (double the doubled stake)', () => {
  assert.equal(settle({ playerCards: [C('10'), C('10')], dealerCards: [C('10'), C('8')], bet: 100, doubled: true }), 400)
})

test('settle: doubled push returns the doubled stake (bet*2)', () => {
  assert.equal(settle({ playerCards: [C('10'), C('8')], dealerCards: [C('10'), C('8')], bet: 100, doubled: true }), 200)
})

test('settle: doubled loss returns 0', () => {
  assert.equal(settle({ playerCards: [C('10'), C('7')], dealerCards: [C('10'), C('9')], bet: 100, doubled: true }), 0)
})

test('settle: a 3-card 21 (non-natural) that beats the dealer is a normal win, not blackjack pay', () => {
  // player 7+7+7=21 (not a natural), dealer stands on 18 → win pays bet*2, NOT bet*2.5
  assert.equal(settle({ playerCards: [C('7'), C('7'), C('7')], dealerCards: [C('10'), C('8')], bet: 100 }), 200)
})

test('settle: doubled hand can never be a natural blackjack (3+ cards) — pays as a normal win', () => {
  // A double always means 3 cards, so the natural-blackjack branch must not trigger.
  assert.equal(settle({ playerCards: [C('A'), C('5'), C('5')], dealerCards: [C('10'), C('8')], bet: 100, doubled: true }), 400)
})

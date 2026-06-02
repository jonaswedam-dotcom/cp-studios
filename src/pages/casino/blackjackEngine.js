// Pure, DOM-free blackjack rules, extracted verbatim from BlackjackGame.jsx so they
// can be unit-tested with `node --test` (see blackjackEngine.test.js) and so the SQL
// authority can be translated line-for-line from a tested reference.
//
// keep in sync with 043_casino_blackjack.sql
//
// Conventions:
//  - A card is { suit, rank }. cardValue: J/Q/K = 10, A = 11, pips numeric.
//  - handValue counts each ace as 11, then reduces 11→1 (one ace at a time) while the
//    hand would otherwise bust — so multiple aces are handled.
//  - dealerPlay hits while the value is < 17 and stops at 17+ (stands on soft 17,
//    mirroring the component).
//  - settle returns the amount CREDITED back to the player. The server model deducts
//    the bet at deal time, so this is the gross return: blackjack → bet+floor(bet*1.5),
//    win → bet*2, push → bet, loss → 0. A doubled hand scaled its stake by 2.

export const SUITS = ['♠', '♣', '♥', '♦']
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export function buildDeck() {
  const deck = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank })
    }
  }
  return deck
}

// Fisher-Yates. rng is injectable for deterministic tests; the SQL mirrors this with
// a server-side shuffle of the same 52-card deck order.
export function shuffle(deck, rng = Math.random) {
  const d = [...deck]
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[d[i], d[j]] = [d[j], d[i]]
  }
  return d
}

export function cardValue(rank) {
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10
  if (rank === 'A') return 11
  return parseInt(rank, 10)
}

export function handValue(hand) {
  let total = 0
  let aces = 0
  for (const card of hand) {
    total += cardValue(card.rank)
    if (card.rank === 'A') aces++
  }
  while (total > 21 && aces > 0) {
    total -= 10
    aces--
  }
  return total
}

export function isBlackjack(hand) {
  return hand.length === 2 && handValue(hand) === 21
}

// Draw from `deck` starting at `startIdx`, appending to a copy of `dealerCards`,
// while the hand value is < 17. Returns the final hand and the next unused index.
export function dealerPlay(deck, startIdx, dealerCards) {
  const hand = [...dealerCards]
  let idx = startIdx
  while (handValue(hand) < 17) {
    hand.push(deck[idx])
    idx++
  }
  return { dealerCards: hand, nextIdx: idx }
}

// Returns the credited (gross) amount; the bet is assumed already deducted server-side.
export function settle({ playerCards, dealerCards, bet, doubled = false }) {
  const stake = doubled ? bet * 2 : bet
  const playerVal = handValue(playerCards)
  const dealerVal = handValue(dealerCards)

  // Naturals resolve first (a 2-card 21; a doubled hand has 3+ cards so it can't qualify).
  const playerBJ = isBlackjack(playerCards)
  const dealerBJ = isBlackjack(dealerCards)
  if (playerBJ || dealerBJ) {
    if (playerBJ && dealerBJ) return bet // push
    if (playerBJ) return bet + Math.floor(bet * 1.5) // blackjack 3:2
    return 0 // dealer blackjack, player not → loss
  }

  if (playerVal > 21) return 0 // player bust
  if (dealerVal > 21) return stake * 2 // dealer bust → win
  if (playerVal > dealerVal) return stake * 2 // win
  if (playerVal < dealerVal) return 0 // loss
  return stake // push
}

import { useState, useEffect, useRef, useCallback } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'

// ── Card helpers ──────────────────────────────────────────────────────────────
const SUITS = ['♠', '♣', '♥', '♦']
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

function buildDeck() {
  const deck = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank })
    }
  }
  return deck
}

function shuffle(deck) {
  const d = [...deck]
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[d[i], d[j]] = [d[j], d[i]]
  }
  return d
}

function cardValue(rank) {
  if (['J', 'Q', 'K'].includes(rank)) return 10
  if (rank === 'A') return 11
  return parseInt(rank, 10)
}

function handValue(hand) {
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

function isBlackjack(hand) {
  return hand.length === 2 && handValue(hand) === 21
}

// ── Card component ────────────────────────────────────────────────────────────
function Card({ card, faceDown = false, animIndex = 0 }) {
  const isRed = card && (card.suit === '♥' || card.suit === '♦')

  return (
    <div
      style={{
        width: 60,
        height: 85,
        borderRadius: 8,
        flexShrink: 0,
        animation: `cardDeal 0.25s ease forwards`,
        animationDelay: `${animIndex * 0.08}s`,
        opacity: 0,
        transform: 'scale(0.7)',
        marginLeft: animIndex > 0 ? -10 : 0,
        position: 'relative',
        zIndex: animIndex,
      }}
    >
      {faceDown ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 8,
            background: 'linear-gradient(135deg, #1e293b 25%, #334155 50%, #1e293b 75%)',
            border: '1.5px solid #475569',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
          }}
        >
          <span style={{ fontSize: 22, opacity: 0.5 }}>🂠</span>
        </div>
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 8,
            background: 'linear-gradient(160deg, #f8fafc, #e2e8f0)',
            border: '1.5px solid #cbd5e1',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            display: 'flex',
            flexDirection: 'column',
            padding: '3px 4px',
            position: 'relative',
          }}
        >
          {/* Top-left rank + suit */}
          <div style={{ lineHeight: 1, color: isRed ? '#dc2626' : '#111827' }}>
            <div style={{ fontSize: 11, fontWeight: 700 }}>{card.rank}</div>
            <div style={{ fontSize: 9 }}>{card.suit}</div>
          </div>
          {/* Center suit */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%,-50%)',
              fontSize: 20,
              color: isRed ? '#dc2626' : '#111827',
            }}
          >
            {card.suit}
          </div>
          {/* Bottom-right rank + suit (rotated) */}
          <div
            style={{
              position: 'absolute',
              bottom: 3,
              right: 4,
              lineHeight: 1,
              transform: 'rotate(180deg)',
              color: isRed ? '#dc2626' : '#111827',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700 }}>{card.rank}</div>
            <div style={{ fontSize: 9 }}>{card.suit}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function Hand({ hand, hideSecond = false, label, score, hideScore = false }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-cp-muted uppercase tracking-wider">{label}</span>
        {!hideScore && score !== undefined && (
          <span className="text-xs bg-cp-elevated border border-cp-border rounded-md px-2 py-0.5 text-cp-text font-bold">
            {score}
          </span>
        )}
      </div>
      <div className="flex" style={{ minHeight: 85 }}>
        {hand.map((card, i) => (
          <Card
            key={i}
            card={card}
            faceDown={hideSecond && i === 1}
            animIndex={i}
          />
        ))}
        {hand.length === 0 && (
          <div
            style={{
              width: 60,
              height: 85,
              borderRadius: 8,
              border: '1.5px dashed',
              borderColor: '#374151',
              opacity: 0.3,
            }}
          />
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function BlackjackGame() {
  const { balance, placeBet } = useCasino()

  const [deck, setDeck] = useState(() => shuffle(buildDeck()))
  const [playerHand, setPlayerHand] = useState([])
  const [dealerHand, setDealerHand] = useState([])
  const [phase, setPhase] = useState('betting') // 'betting' | 'playing' | 'dealer_turn' | 'result'
  const [bet, setBet] = useState(50)
  const [gameResult, setGameResult] = useState(null) // 'win' | 'loss' | 'push' | null
  const [message, setMessage] = useState('')
  const [wonAmount, setWonAmount] = useState(0)

  const deckRef = useRef(deck)
  deckRef.current = deck

  // Keep refs in sync so the unmount cleanup always sees the latest values
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const betRef = useRef(bet)
  betRef.current = bet
  const placeBetRef = useRef(placeBet)
  placeBetRef.current = placeBet

  // Forfeit the bet if the player navigates away mid-game.
  // Without this, leaving on a bad hand costs nothing.
  useEffect(() => {
    return () => {
      if (phaseRef.current === 'playing' || phaseRef.current === 'dealer_turn') {
        placeBetRef.current('blackjack', betRef.current, -betRef.current)
      }
    }
  }, [])

  // Inject keyframes once
  useEffect(() => {
    const id = 'bj-card-deal-kf'
    if (!document.getElementById(id)) {
      const s = document.createElement('style')
      s.id = id
      s.textContent = `
        @keyframes cardDeal {
          from { opacity: 0; transform: scale(0.7) translateY(-10px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `
      document.head.appendChild(s)
    }
  }, [])

  function draw(currentDeck) {
    const newDeck = [...currentDeck]
    const card = newDeck.pop()
    return { card, newDeck }
  }

  function handleDeal() {
    if ((balance ?? 0) < bet) return

    let d = shuffle(buildDeck())
    const { card: p1, newDeck: d1 } = draw(d)
    const { card: dea1, newDeck: d2 } = draw(d1)
    const { card: p2, newDeck: d3 } = draw(d2)
    const { card: dea2, newDeck: d4 } = draw(d3)

    const ph = [p1, p2]
    const dh = [dea1, dea2]

    setDeck(d4)
    setPlayerHand(ph)
    setDealerHand(dh)
    setGameResult(null)
    setMessage('')
    setWonAmount(0)

    // Check immediate blackjack
    if (isBlackjack(ph)) {
      if (isBlackjack(dh)) {
        // Both blackjack → push
        setPhase('result')
        setGameResult('push')
        setMessage('Both blackjack — push!')
        setWonAmount(0)
        placeBet('blackjack', bet, 0)
      } else {
        setPhase('result')
        setGameResult('win')
        const win = Math.floor(bet * 1.5)
        setMessage('Blackjack! 🎉')
        setWonAmount(win)
        placeBet('blackjack', bet, win)
      }
    } else {
      setPhase('playing')
    }
  }

  function handleHit() {
    if (phase !== 'playing') return
    const { card, newDeck } = draw(deckRef.current)
    const newHand = [...playerHand, card]
    setDeck(newDeck)
    setPlayerHand(newHand)

    if (handValue(newHand) > 21) {
      setPhase('result')
      setGameResult('loss')
      setMessage('Bust! Over 21.')
      setWonAmount(bet)
      placeBet('blackjack', bet, -bet)
    }
  }

  function handleStand() {
    if (phase !== 'playing') return
    setPhase('dealer_turn')
  }

  // Dealer plays when phase becomes 'dealer_turn'
  useEffect(() => {
    if (phase !== 'dealer_turn') return

    let currentHand = [...dealerHand]
    let currentDeck = [...deckRef.current]

    function dealerStep() {
      const val = handValue(currentHand)
      if (val < 17) {
        const card = currentDeck.pop()
        currentHand = [...currentHand, card]
        setDealerHand([...currentHand])
        setDeck([...currentDeck])
        setTimeout(dealerStep, 500)
      } else {
        // Resolve
        const dealerVal = handValue(currentHand)
        const playerVal = handValue(playerHand)
        setPhase('result')

        if (dealerVal > 21 || playerVal > dealerVal) {
          setGameResult('win')
          setMessage(dealerVal > 21 ? 'Dealer busts! You win! 🎉' : 'You win! 🎉')
          setWonAmount(bet)
          placeBet('blackjack', bet, bet)
        } else if (dealerVal > playerVal) {
          setGameResult('loss')
          setMessage('Dealer wins.')
          setWonAmount(bet)
          placeBet('blackjack', bet, -bet)
        } else {
          setGameResult('push')
          setMessage('Push — tied!')
          setWonAmount(0)
          placeBet('blackjack', bet, 0)
        }
      }
    }

    const t = setTimeout(dealerStep, 400)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  function handlePlayAgain() {
    setPlayerHand([])
    setDealerHand([])
    setDeck(shuffle(buildDeck()))
    setPhase('betting')
    setGameResult(null)
    setMessage('')
    setWonAmount(0)
  }

  const playerVal = handValue(playerHand)
  const dealerVal = handValue(dealerHand)
  const showDealerScore = phase === 'result' || phase === 'dealer_turn'
  const isBetting = phase === 'betting'
  const isPlaying = phase === 'playing'
  const isResult = phase === 'result'

  return (
    <GameLayout title="Blackjack">
      <div className="flex flex-col items-center gap-6">

        {/* ── Table ── */}
        <div className="w-full max-w-md bg-cp-card border border-cp-border rounded-2xl p-6 flex flex-col gap-6">

          {/* Dealer hand */}
          <Hand
            hand={dealerHand}
            hideSecond={phase === 'playing'}
            label="Dealer"
            score={showDealerScore ? dealerVal : (dealerHand.length > 0 ? cardValue(dealerHand[0]?.rank) : undefined)}
            hideScore={phase === 'playing'}
          />

          {/* Divider */}
          <div className="border-t border-cp-border-soft" />

          {/* Player hand */}
          <Hand
            hand={playerHand}
            label="You"
            score={playerHand.length > 0 ? playerVal : undefined}
          />
        </div>

        {/* ── Status message ── */}
        {message && (
          <div
            className={`text-center font-bold text-lg px-4 py-2 rounded-xl border ${
              gameResult === 'win'
                ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/25'
                : gameResult === 'loss'
                ? 'text-red-400 bg-red-400/10 border-red-400/25'
                : 'text-cp-muted bg-cp-elevated border-cp-border'
            }`}
            style={{ animation: 'fadeInResult 0.3s ease forwards' }}
          >
            {message}
          </div>
        )}

        {/* ── Bet chips (betting phase only) ── */}
        {isBetting && (
          <div className="w-full max-w-md bg-cp-card border border-cp-border rounded-2xl p-4">
            <BetChips
              bet={bet}
              onBet={setBet}
              balance={balance ?? 0}
              disabled={false}
            />
          </div>
        )}

        {/* ── Action buttons ── */}
        <div className="w-full max-w-md flex flex-col gap-3">
          {isBetting && (
            <button
              onClick={handleDeal}
              disabled={(balance ?? 0) < bet}
              className={`w-full py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
                ${(balance ?? 0) < bet
                  ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                  : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] hover:shadow-[0_0_32px_rgba(251,191,36,0.45)] active:scale-95'
                }
              `}
            >
              Deal
            </button>
          )}

          {isPlaying && (
            <div className="flex gap-3">
              <button
                onClick={handleHit}
                className="flex-1 py-3.5 rounded-2xl font-bold text-base tracking-wide bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_16px_rgba(251,191,36,0.2)] hover:shadow-[0_0_24px_rgba(251,191,36,0.35)] active:scale-95 transition-all"
              >
                Hit
              </button>
              <button
                onClick={handleStand}
                className="flex-1 py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 active:scale-95 transition-all"
              >
                Stand
              </button>
            </div>
          )}

          {phase === 'dealer_turn' && (
            <div className="text-center text-cp-muted text-sm animate-pulse py-2">
              Dealer is playing…
            </div>
          )}

          {isResult && (
            <button
              onClick={handlePlayAgain}
              className="w-full py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 transition-all active:scale-95"
            >
              Play Again
            </button>
          )}
        </div>

        {/* ── Result banner ── */}
        <div className="w-full max-w-md">
          <ResultBanner
            result={gameResult}
            amount={wonAmount}
            message={
              gameResult === 'win' && isBlackjack(playerHand)
                ? 'Blackjack pays 2.5×'
                : gameResult === 'push'
                ? null
                : null
            }
          />
        </div>

        <style>{`
          @keyframes fadeInResult {
            from { opacity: 0; transform: translateY(6px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    </GameLayout>
  )
}

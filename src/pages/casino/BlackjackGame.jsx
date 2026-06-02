import { useState, useEffect } from 'react'
import { GameLayout, BetChips, ResultBanner, formatCoins } from './shared'
import { useCasino } from '../../context/CasinoContext'
import { cardValue, handValue, isBlackjack } from './blackjackEngine'

// ── Server response contract (matches supabase/migrations/043_casino_blackjack.sql) ──
// All four RPCs (blackjack_open/hit/double/stand) return the public round state.
// A Card is { suit, rank }. The terminal flag is `done` (boolean).
//   • Mid-round (done:false): blackjack_open sends `dealer_up` (the single up-card,
//     hole card never sent); blackjack_hit sends just `player` + `player_value`.
//   • Terminal (done:true): sends the full `dealer` array + `result`
//     ('win' | 'loss' | 'push') + `payout` (gross credited) + `balance`.
//     A player bust (hit) is terminal but sends no `dealer` (dealer never played).
// cardValue/handValue/isBlackjack are reused from the tested engine for DISPLAY only
// (scores) — never to decide money.

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

// Map the server's terminal `result` to the UI's banner result + win amount.
// payout is the gross credited amount; net profit shown to the player is
// payout - stake (stake = doubled bet, but the result message uses the base bet).
function describeResult(result) {
  switch (result) {
    case 'blackjack': return { banner: 'win',  message: 'Blackjack! 🎉' }
    case 'win':       return { banner: 'win',  message: 'You win! 🎉' }
    case 'push':      return { banner: 'push', message: 'Push — tied!' }
    case 'loss':      return { banner: 'loss', message: 'Dealer wins.' }
    default:          return { banner: 'loss', message: '' }
  }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function BlackjackGame() {
  const { balance, roundAction, loadBalance } = useCasino()

  const [playerHand, setPlayerHand] = useState([])
  const [dealerHand, setDealerHand] = useState([])
  const [phase, setPhase] = useState('betting') // 'betting' | 'playing' | 'dealer_turn' | 'result'
  const [bet, setBet] = useState(50)
  const [doubled, setDoubled] = useState(false)
  const [gameResult, setGameResult] = useState(null) // 'win' | 'loss' | 'push' | null
  const [message, setMessage] = useState('')
  const [wonAmount, setWonAmount] = useState(0)
  const [roundId, setRoundId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

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

  // Apply a server round response. On a terminal response (status !== 'active') the
  // dealer hand is the full hand; we briefly show "dealer playing" then resolve.
  function applyTerminal(r, baseBet, wasDoubled) {
    const stake = wasDoubled ? baseBet * 2 : baseBet
    const payout = r.payout ?? 0
    const { banner, message: msg } = describeResult(r.result)
    // Terminal responses carry the full dealer hand (stand/double/natural). A player
    // bust carries no `dealer` — keep whatever's shown (the up-card) rather than clearing.
    if (r.dealer) setDealerHand(r.dealer)
    setPhase('result')
    setGameResult(banner)
    setMessage(r.result === 'blackjack'
      ? 'Blackjack! 🎉'
      : msg)
    // Amount shown: profit on a win/bj, the stake lost on a loss, 0 on push.
    if (banner === 'win') setWonAmount(Math.max(0, payout - stake))
    else if (banner === 'loss') setWonAmount(stake)
    else setWonAmount(0)
    loadBalance()
  }

  async function handleDeal() {
    if ((balance ?? 0) < bet || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await roundAction('blackjack_open', { p_bet: bet })
      setRoundId(r.round_id)
      setDoubled(false)
      setPlayerHand(r.player ?? [])
      setGameResult(null)
      setMessage('')
      setWonAmount(0)

      if (r.done) {
        // Natural blackjack (player and/or dealer) — resolves immediately with full dealer hand.
        setDealerHand(r.dealer ?? [])
        applyTerminal(r, bet, false)
      } else {
        // In play — server sends only the dealer's up-card.
        setDealerHand(r.dealer_up ? [r.dealer_up] : [])
        setPhase('playing')
      }
    } catch (e) {
      console.error('[BlackjackGame] open error:', e)
      setError('Deal failed — try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleHit() {
    if (phase !== 'playing' || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await roundAction('blackjack_hit', { p_round: roundId })
      setPlayerHand(r.player ?? [])
      if (r.done) {
        // Bust (only terminal outcome of a hit) — show the dealer pause briefly, then resolve.
        setPhase('dealer_turn')
        setTimeout(() => applyTerminal(r, bet, doubled), 400)
      }
    } catch (e) {
      console.error('[BlackjackGame] hit error:', e)
      setError('Hit failed — try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDouble() {
    if (phase !== 'playing' || busy) return
    if (playerHand.length !== 2 || (balance ?? 0) < bet) return
    setBusy(true)
    setError(null)
    try {
      const r = await roundAction('blackjack_double', { p_round: roundId })
      setDoubled(true)
      setPlayerHand(r.player ?? [])
      // Double draws one card and auto-stands → terminal response.
      setPhase('dealer_turn')
      setTimeout(() => applyTerminal(r, bet, true), 400)
    } catch (e) {
      console.error('[BlackjackGame] double error:', e)
      setError('Double failed — try again.')
      setBusy(false)
    }
    // note: busy stays true through the dealer pause; cleared by Play Again reset
    finally {
      setBusy(false)
    }
  }

  async function handleStand() {
    if (phase !== 'playing' || busy) return
    setBusy(true)
    setError(null)
    setPhase('dealer_turn')
    try {
      const r = await roundAction('blackjack_stand', { p_round: roundId })
      setTimeout(() => applyTerminal(r, bet, doubled), 400)
    } catch (e) {
      console.error('[BlackjackGame] stand error:', e)
      setError('Stand failed — try again.')
      setPhase('playing')
    } finally {
      setBusy(false)
    }
  }

  function handlePlayAgain() {
    setPlayerHand([])
    setDealerHand([])
    setPhase('betting')
    setDoubled(false)
    setGameResult(null)
    setMessage('')
    setWonAmount(0)
    setRoundId(null)
    setError(null)
  }

  const playerVal = handValue(playerHand)
  const dealerVal = handValue(dealerHand)
  const showDealerScore = phase === 'result' || phase === 'dealer_turn'
  const isBetting = phase === 'betting'
  const isPlaying = phase === 'playing'
  const isResult = phase === 'result'

  // While the player is acting the server only sends the dealer's up-card; append a
  // placeholder so the table still shows the familiar "one up, one face-down" layout.
  const dealerDisplay = isPlaying && dealerHand.length === 1
    ? [dealerHand[0], { suit: '', rank: '' }]
    : dealerHand
  const canDouble = isPlaying && playerHand.length === 2 && (balance ?? 0) >= bet && !busy

  return (
    <GameLayout title="Blackjack">
      <div className="flex flex-col items-center gap-6">

        {/* ── Table ── */}
        <div className="w-full max-w-md bg-cp-card border border-cp-border rounded-2xl p-6 flex flex-col gap-6">

          {/* Dealer hand */}
          <Hand
            hand={dealerDisplay}
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
              disabled={(balance ?? 0) < bet || busy}
              className={`w-full py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
                ${(balance ?? 0) < bet || busy
                  ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                  : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_24px_rgba(251,191,36,0.3)] hover:shadow-[0_0_32px_rgba(251,191,36,0.45)] active:scale-95'
                }
              `}
            >
              {busy ? 'Dealing…' : 'Deal'}
            </button>
          )}

          {isPlaying && (
            <div className="flex gap-3">
              <button
                onClick={handleHit}
                disabled={busy}
                className={`flex-1 py-3.5 rounded-2xl font-bold text-base tracking-wide transition-all
                  ${busy
                    ? 'bg-cp-elevated text-cp-muted cursor-not-allowed opacity-50'
                    : 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_16px_rgba(251,191,36,0.2)] hover:shadow-[0_0_24px_rgba(251,191,36,0.35)] active:scale-95'
                  }`}
              >
                Hit
              </button>
              {canDouble && (
                <button
                  onClick={handleDouble}
                  disabled={busy}
                  className="flex-1 py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-amber-400/40 text-amber-400 hover:bg-cp-card active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Double
                </button>
              )}
              <button
                onClick={handleStand}
                disabled={busy}
                className="flex-1 py-3.5 rounded-2xl font-bold text-base tracking-wide bg-cp-elevated border border-cp-border text-cp-text hover:bg-cp-card hover:border-amber-400/40 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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

          {error && (
            <div className="text-center rounded-xl border border-red-400/30 bg-red-400/10 py-2.5 px-4 text-sm text-red-400">
              {error}
            </div>
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

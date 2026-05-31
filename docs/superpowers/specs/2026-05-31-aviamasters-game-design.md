# Aviamasters — Casino Game Design

**Date:** 2026-05-31
**Status:** Approved (design); pending implementation plan
**Author:** Brainstormed with the maintainer

## Summary

Add **Aviamasters** as a new, standalone game in the CP Studios casino, alongside the
existing simple Aviator game. It is a faithful re-creation of BGaming's *Aviamasters*
(as seen on Stake): a plane auto-flies a randomized path, collecting multiplier and
additive nodes that grow a "Counter Balance" multiplier, while rockets cut it in half.
The round **auto-resolves** — the plane either lands on the carrier (win) or splashes
into the water (lose). There is **no cash-out button**.

This is a client-only React game consistent with the rest of the casino (§4 of
`CLAUDE.md`): game logic runs in the browser and writes the resulting balance via the
existing `CasinoContext.placeBet` path. No server authority, no DB or migration changes.

## Goals

- A new game that feels meaningfully different from the existing Aviator (collect nodes +
  rockets, auto-resolve, no cash-out) rather than a re-skin.
- Faithful to the real game's model: ×1.0 start, multiply/add nodes, rockets ÷2,
  **max ×250**, **~97% RTP**.
- Match the existing dark `cp` aesthetic and the code patterns in `AviatorGame.jsx`.
- Tunable: all balance constants live at the top of the file and are verified by a
  simulation script.

## Non-goals (YAGNI for v1)

- Autoplay with stop-conditions.
- Auto-cashout target / any mid-round player decision.
- Provably-fair / server-authoritative resolution (the casino is intentionally
  client-side — see `CLAUDE.md` §4).
- DB schema, RLS, or migration changes. The game id is a free-text label on the bet.

## Player-facing behaviour

### Core loop

1. Player picks a **bet** (via the shared `BetChips`) and a **speed**:
   🐢 tortoise / 🚶 walking / 🐇 hare / ⚡ lightning. Speed is **cosmetic** — it only
   changes the animation tick rate, never the odds or payouts.
2. Player taps **Spin**. The entire round is **pre-rolled** at this moment (path, nodes,
   rockets, and the land/splash outcome), then animated out.
3. The plane auto-flies the path. As it passes each node/rocket the **Counter Balance**
   multiplier (starts ×1.0) updates live:
   - **Multiplicative node** `×2 / ×3 / ×4 / ×5` → multiplies the running multiplier.
   - **Additive node** `+1 / +2 / +5 / +10` → adds a flat amount to the multiplier.
   - **Rocket** → divides the running multiplier by 2 (e.g. 8.0 → 4.0) and drops the
     plane's altitude.
   - The multiplier is clamped to **≤ 250** throughout.
4. The round ends one of two ways (pre-decided at Spin):
   - **Lands on the carrier → WIN.** Payout `= floor(bet × finalMult)`, capped at ×250.
     Net credited to wallet: the winnings.
   - **Splashes into the water → LOSE.** The bet is lost.
5. There is **no mid-round cash-out**. The player watches the round resolve. Faster
   speeds exist for players who don't want to wait.

### Phases

`betting → flying → landed | splashed`

Mirrors the structure of `AviatorGame.jsx` (`betting → flying → crashed | cashedout`),
minus the cash-out action.

## Game model & math

All randomness is rolled once at Spin and stored in refs; the animation only replays it.

### Round generation

1. Roll a **node count** for the flight (weighted, e.g. 3–10 nodes).
2. Build the node sequence. For each node, choose type and value from weighted tables:
   - Multiplicative `×2/×3/×4/×5` — `×2` common, `×5` rare.
   - Additive `+1/+2/+5/+10` — `+1` common, `+10` rare.
   Apply each to the running multiplier in order; clamp to ≤ 250.
3. Roll **rockets** and insert them at random positions in the sequence. Each rocket
   divides the running multiplier by 2. Frequency is weighted, and biased so longer
   flights see more rockets:
   - 0 rockets ≈ 35%
   - 1 rocket  ≈ 45%
   - 2 rockets ≈ 15%
   - 3+ rockets ≈ 5%
4. Roll the **outcome**: `land` (win) with probability `P_LAND`, otherwise `splash`
   (lose). `P_LAND` is **independent of the multiplier** — rockets already provide the
   downside drama, and independence keeps the RTP math clean and tunable.

### Payout

- **Land:** `win = floor(bet × min(finalMult, 250))`; `placeBet('aviamasters', bet, win)`.
- **Splash:** `placeBet('aviamasters', bet, -bet)`.

### RTP / fairness

- Target **RTP ≈ 97%** (the real game's figure), max **×250**.
- `RTP = P_LAND × E[min(finalMult, 250)]`. `P_LAND` and the node/rocket weight tables are
  named constants at the top of the file, tuned together so simulated RTP lands within
  **±1%** of 97%.
- A Monte-Carlo script, `scripts/aviamasters-sim.mjs`, runs ~1,000,000 rounds against the
  same generation function and prints: measured RTP, win rate, multiplier distribution,
  and max observed multiplier. The generation logic is factored so the script and the
  component share it (or it is duplicated verbatim and kept in sync — decided in the
  plan). Tuning is done by running the sim, not by guesswork.

## Code structure

Follows `src/pages/casino/AviatorGame.jsx` closely.

- **New file:** `src/pages/casino/AviamastersGame.jsx`.
  - Constants block at top: node weight tables, rocket distribution, `P_LAND`,
    `MAX_MULT = 250`, `SPEEDS` (tick interval per speed setting).
  - Pure helper(s) to generate a round (node sequence + rockets + outcome + final mult).
  - Phase-driven flight loop via `setInterval` (interval chosen by selected speed),
    started by the `phase === 'flying'` effect, not in the click handler. Refs hold the
    pre-rolled plan and current index so the interval never captures stale state.
    Cleanup on unmount and on phase change.
  - `useCasino().placeBet('aviamasters', ...)` on resolve.
  - Reuses `GameLayout`, `BetChips`, `ResultBanner`, `formatCoins` from `./shared`.
- **Route:** add `/casino/aviamasters` in `src/App.jsx` next to the other casino routes.
- **Catalogue:** add a card to the `GAMES` array in `src/pages/CasinoPage.jsx` with a
  distinct emoji (e.g. 🛩️, separate from Aviator's ✈️), name "Aviamasters", and a short
  description.
- **Simulation:** `scripts/aviamasters-sim.mjs` (Node ESM, no deps), runnable via
  `node scripts/aviamasters-sim.mjs`.

No changes to `CasinoContext`, Supabase, RLS, or migrations.

## Visuals

Match the dark `cp` aesthetic; do **not** reproduce BGaming's artwork.

- Same `#030712` board, faint grid, and trajectory trail as `AviatorGame.jsx`.
- A carrier/ship marker at the landing zone and a water band at the bottom of the board.
- Floating node badges along the path: amber rounded chips for `×N`, green for `+N`;
  collected nodes pop/fade (reuse a `bubblePop`-style keyframe injected once, following
  the Aviator keyframe-injection pattern).
- Rockets rendered as 🚀 hazards on the path; on collision the center readout flashes red
  and the plane dips.
- Large center **Counter Balance** readout (`mult.toFixed(2)×`) that bumps on multiply/add
  and flashes red on a rocket ÷2.
- Plane 🛩️ in flight; resolve shows landing on the ship (🎉) or a splash (🌊) — colour the
  multiplier green on land, red on splash, consistent with `multColor` conventions.
- Speed selector: four small toggle buttons (🐢 / 🚶 / 🐇 / ⚡) shown in the betting phase.

## Testing / verification

- `npm run build` passes (catches hard errors; there is no test suite — `CLAUDE.md`).
- `node scripts/aviamasters-sim.mjs` reports RTP within ±1% of 97% and max ≤ 250×.
- Manual `npm run dev` walkthrough: bet, each speed, observe nodes/rockets applying, both
  land and splash outcomes, wallet balance updates correctly, ×250 cap holds.

## Open questions

None blocking. Whether the sim shares the generator module with the component or
duplicates it is an implementation detail to settle in the plan.

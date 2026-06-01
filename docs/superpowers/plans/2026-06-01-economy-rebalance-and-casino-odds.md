# Economy Reset, Casino-Odds Fix & Ads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reset the shared coin economy, make every casino game house-favored, and add a rewarded-ad coin faucet — without touching the authoritative war_tick SQL.

**Architecture:** Casino + war share `wallets.balance`. Casino odds fixes are JS-only constant changes verified by Monte-Carlo. The money reset and ad schema are new, idempotent SQL migrations (human-applied). The ad faucet mirrors the existing daily-bonus pattern (DB columns + client grant logic) plus a simulated-ad modal.

**Tech Stack:** React 18 + Vite, Supabase Postgres (manual numbered migrations), Tailwind (`cp-*` palette). Verify with `npm run build`, `node --test src/war/*.test.js`, and scratch Monte-Carlo `.mjs` sims.

**Spec:** `docs/superpowers/specs/2026-06-01-economy-rebalance-and-casino-odds-design.md`

**Branch:** `economy-rebalance` (carries the in-progress, RTP-positive Plinko + CasinoContext working-tree changes).

---

### Task 1: Fix Coin Flip + Chicken Road house edge

**Files:**
- Modify: `src/pages/casino/CoinFlipGame.jsx:52,54`
- Modify: `src/pages/casino/ChickenRoadGame.jsx:6`

- [ ] **Step 1: Coin Flip — reduce win payout below even money**

`CoinFlipGame.jsx:52`:
```js
const winAmount = won ? Math.floor(bet * 0.95) : -bet
```
`CoinFlipGame.jsx:54` (display mirror):
```js
setWonAmount(won ? Math.floor(bet * 0.95) : bet)
```

- [ ] **Step 2: Chicken Road — lower the player-favored lane-1/2 multipliers**

`ChickenRoadGame.jsx:6`:
```js
const LANE_MULTIPLIERS = [1.3, 2.0, 3.2, 4.8, 7.2, 11.0, 18.0]
```

- [ ] **Step 3: Verify with Monte-Carlo**

Write `/tmp/verify_odds.mjs` simulating both: Coin Flip win=floor(bet*0.95) at 50% → expect RTP ≈ 97.5%; Chicken Road cumulative `SAFE_PROBS=[0.72,0.64,0.56,0.48,0.40,0.32,0.25]` × `LANE_MULTIPLIERS` → expect every lane RTP < 100% (lane1 ≈ 93.6%, lane2 ≈ 92.2%).
Run: `node /tmp/verify_odds.mjs`
Expected: all RTP values < 100%.

- [ ] **Step 4: Commit**
```bash
git add src/pages/casino/CoinFlipGame.jsx src/pages/casino/ChickenRoadGame.jsx
git commit -m "balance(casino): give Coin Flip + Chicken Road a positive house edge"
```

---

### Task 2: Money-reset migration (030)

**Files:**
- Create: `supabase/migrations/030_reset_money.sql`

- [ ] **Step 1: Write the migration** (exact SQL from spec §3.1)
```sql
-- Migration 030: Reset all in-game money to a clean baseline. One-off, manual, idempotent.
-- COINS-ONLY: wipes currency (wallet balances + uncollected war income) but LEAVES the war
-- map intact (territory, armies, buildings, players). Re-running re-applies the same values.

update public.wallets set balance = 1000;
update public.wallets set last_daily_bonus = null;
update public.war_players set vault = 0;
update public.war_players set last_income_at = now(), last_active_at = now();
```

- [ ] **Step 2: Commit**
```bash
git add supabase/migrations/030_reset_money.sql
git commit -m "feat(db): migration 030 — reset all in-game money (coins-only)"
```

---

### Task 3: Ad-rewards schema migration (031)

**Files:**
- Create: `supabase/migrations/031_ad_rewards.sql`

- [ ] **Step 1: Write the migration** (add cooldown/cap columns to wallets; idempotent)
```sql
-- Migration 031: rewarded-ad coin faucet. Adds cooldown + daily-cap columns to wallets.
-- Grant logic is client-side (mirrors the daily bonus); these columns are the source of truth.
alter table public.wallets add column if not exists last_ad_reward timestamptz;
alter table public.wallets add column if not exists ad_rewards_date date;
alter table public.wallets add column if not exists ad_rewards_count integer not null default 0;
```

- [ ] **Step 2: Commit**
```bash
git add supabase/migrations/031_ad_rewards.sql
git commit -m "feat(db): migration 031 — ad-reward cooldown/cap columns on wallets"
```

---

### Task 4: Ad-reward client logic in CasinoContext

**Files:**
- Modify: `src/context/CasinoContext.jsx` (add constants near `DAILY_BONUS_AMOUNT`; add `claimAdReward`/`canClaimAd`/`adsLeftToday`; load the new columns in `loadBalance`; export in the context value)

- [ ] **Step 1: Add constants** near `DAILY_BONUS_AMOUNT` (line 8)
```js
export const AD_REWARD_AMOUNT = 100
const AD_COOLDOWN_MS = 3 * 60 * 1000 // 3 minutes
const AD_DAILY_CAP = 5               // max ads/day -> max 500 coins/day
```

- [ ] **Step 2: Track ad state** — add React state for `adState` ({ lastAt, date, count }), populate it from the `wallets` row inside `loadBalance` (select `last_ad_reward, ad_rewards_date, ad_rewards_count` alongside the existing balance read).

- [ ] **Step 3: Implement `canClaimAd()` and `adsLeftToday`**
```js
function _todayStr() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}` }
function adsLeftToday() {
  const today = _todayStr()
  const used = adState.date === today ? adState.count : 0
  return Math.max(0, AD_DAILY_CAP - used)
}
function canClaimAd() {
  if (adsLeftToday() <= 0) return false
  if (!adState.lastAt) return true
  return Date.now() - new Date(adState.lastAt).getTime() >= AD_COOLDOWN_MS
}
```

- [ ] **Step 4: Implement `claimAdReward()`** — guard with `canClaimAd()`; compute new balance via the same `balanceRef`/serialized-write path `placeBet` uses; persist `balance`, `last_ad_reward = now`, `ad_rewards_date = today`, `ad_rewards_count = (sameDay ? count : 0) + 1`; update local `balance` + `adState`. Return the granted amount (or 0 if not allowed).

- [ ] **Step 5: Export** `AD_REWARD_AMOUNT`, `claimAdReward`, `canClaimAd`, `adsLeftToday` in the context value object (alongside `claimRefill`/`canClaimRefill`).

- [ ] **Step 6: Verify build**
Run: `npm run build`
Expected: clean build, no undefined references.

- [ ] **Step 7: Commit**
```bash
git add src/context/CasinoContext.jsx
git commit -m "feat(casino): ad-reward grant logic (DB-backed cooldown + daily cap)"
```

---

### Task 5: WatchAdModal component

**Files:**
- Create: `src/pages/casino/WatchAdModal.jsx`

- [ ] **Step 1: Build the modal** — props `{ open, onClose, onClaim, rewardAmount, adsLeft }`. A simulated 15s countdown (disabled "Claim" until 0), then "Claim N coins". Uses `cp-*` palette + `amber-*` accent, `modal-in`/`backdrop-in` animation classes, inline-SVG icon, and a small "Simulated ad — no real ad network" note. Closes on backdrop click / ✕. On claim, call `onClaim()` then `onClose()`.

- [ ] **Step 2: Verify build**
Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**
```bash
git add src/pages/casino/WatchAdModal.jsx
git commit -m "feat(casino): simulated watch-ad modal"
```

---

### Task 6: Wire the ad entry point into CasinoPage

**Files:**
- Modify: `src/pages/CasinoPage.jsx` (import `WatchAdModal`; pull ad helpers from `useCasino()`; add a "Watch ad for coins" button near the balance/Send-Coins area; manage modal open state; success toast mirroring the daily-bonus toast)

- [ ] **Step 1: Import + state** — `import WatchAdModal from './casino/WatchAdModal'`; `const { claimAdReward, canClaimAd, adsLeftToday, AD_REWARD_AMOUNT, ... } = useCasino()`; `const [adOpen, setAdOpen] = useState(false)`; `const [adToast, setAdToast] = useState(0)`.

- [ ] **Step 2: Button + handler** — render a "🎬 Watch ad (+coins)" button (disabled when `!canClaimAd()`, showing `adsLeftToday()` left); `onClick` opens the modal. `handleAdClaim = async () => { const got = await claimAdReward(); if (got) { setAdToast(got); setTimeout(()=>setAdToast(0), 4000) } }`.

- [ ] **Step 3: Render `<WatchAdModal open={adOpen} onClose={()=>setAdOpen(false)} onClaim={handleAdClaim} rewardAmount={AD_REWARD_AMOUNT} adsLeft={adsLeftToday()} />`** and the toast.

- [ ] **Step 4: Verify build**
Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Commit**
```bash
git add src/pages/CasinoPage.jsx
git commit -m "feat(casino): watch-ad entry point on the casino hub"
```

---

### Task 7: Docs

**Files:**
- Modify: `docs/DATABASE.md` (migration index rows 030, 031; `wallets` ad columns)
- Modify: `CLAUDE.md` ("Where to make common changes": tune ad reward)

- [ ] **Step 1:** Add migration-index rows for 030 (reset) and 031 (ad columns) and document the three new `wallets` columns in the wallets table section.
- [ ] **Step 2:** Add a row to CLAUDE.md's change-table: "Change ad reward / cooldown / cap → `CasinoContext.jsx` (`AD_REWARD_AMOUNT`, `AD_COOLDOWN_MS`, `AD_DAILY_CAP`)".
- [ ] **Step 3: Commit**
```bash
git add docs/DATABASE.md CLAUDE.md
git commit -m "docs: document money reset (030), ad columns (031), ad-reward tuning"
```

---

### Task 8: Final verification

- [ ] **Step 1:** `node --test src/war/*.test.js` → all pass (no war constants changed).
- [ ] **Step 2:** `node scripts/slots-sim.mjs` → RTP ~93% (unchanged).
- [ ] **Step 3:** `node /tmp/verify_odds.mjs` → Coin Flip 97.5%, Chicken Road all lanes < 100%.
- [ ] **Step 4:** `npm run build` → clean.
- [ ] **Step 5:** Confirm `git log --oneline` shows the task commits on `economy-rebalance`.

---

## Self-Review

**Spec coverage:** §3.1 reset → Task 2; §3.2 odds → Task 1; §3.3 ads → Tasks 3–6; §3.4 keep war prices → no-op (intentional, documented); §3.5 docs → Task 7; §4 verification → Task 8. ✅ All covered. §6 follow-up is intentionally out of scope.

**Placeholder scan:** Task 4/5/6 describe behavior with concrete signatures rather than full file bodies because they integrate with the uncommitted CasinoContext refactor (balanceRef/serialized writes) that must be read live at implementation time; the exact constants, function names, and call patterns are all specified. No TBD/TODO.

**Type/name consistency:** `claimAdReward`, `canClaimAd`, `adsLeftToday`, `AD_REWARD_AMOUNT`, `AD_COOLDOWN_MS`, `AD_DAILY_CAP`, columns `last_ad_reward`/`ad_rewards_date`/`ad_rewards_count` — used consistently across Tasks 3, 4, 6. ✅

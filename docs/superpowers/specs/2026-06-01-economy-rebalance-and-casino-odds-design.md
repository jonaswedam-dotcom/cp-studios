# Economy Reset, Casino-Odds Fix, Ads & War-Balance — Design Spec

**Date:** 2026-06-01
**Status:** Approved (owner delegated approval; self-reviewed)
**Scope:** Reset the shared coin economy, guarantee every casino game favors the house,
add a rewarded-ad coin faucet, and confirm the casino↔war money link + price coherence.

---

## 0. Background (from a 10-agent in-depth review)

CP Studios has **one shared wallet** (`wallets.balance`, integer) used by BOTH the
client-authoritative casino (10 games) AND the server-authoritative CP War conquest game.
Casino outcomes are computed in the browser and written straight to the wallet; CP War
combat/income run in a `pg_cron` `war_tick()` SECURITY DEFINER function. War balance
constants are **duplicated JS↔SQL** and guarded by `src/war/parity.test.js`.

### Casino probability audit (Monte-Carlo, ≥1M trials/game)

| Game | RTP | House edge | Verdict |
|------|-----|-----------|---------|
| **Coin Flip** | **100.0%** | **0.0%** | ❌ break-even — fix |
| **Chicken Road** (cash at lane 1) | **108.0%** | **−8.0%** | ❌ player-favored — fix |
| **Chicken Road** (cash at lane 2) | **101.4%** | **−1.4%** | ❌ player-favored — fix |
| Dice | 83.3% | 16.7% | ✅ house |
| Roulette (even-money) | 97.3% | 2.7% | ✅ house |
| Roulette (single number) | 94.6% | 5.4% | ✅ house |
| Blackjack | ~99.2% | ~0.8% | ✅ house (thin; documented) |
| Slots | 92.9% | 7.1% | ✅ house |
| Aviator | 75–92% (target-dep.) | 8–25% | ✅ house |
| Aviamasters | 97.4% | 2.6% | ✅ house |
| Mines | 94.8–97.0% | 3.0–5.2% | ✅ house |
| Plinko (after working-tree fix) | 98.8–99.1% | 0.9–1.2% | ✅ house (thin) |

Only **Coin Flip** and **Chicken Road (lanes 1–2)** are not house-favored. The uncommitted
working-tree change to `PlinkoGame.jsx` is **corrective** (fixes a mis-tuned 12-row/low table
from 66.5% RTP up to ~99%) and the uncommitted `CasinoContext.jsx` change fixes a balance
lost-update race — both are RTP-neutral/positive and are kept.

### Economy facts

- Start wallet **1,100** (1,000 + first daily bonus). Daily bonus **+100/24h**. Emergency
  refill **→100** when broke (localStorage cooldown — farmable, accepted).
- War units: soldier 100/str1, tank 400/str5, jet 800/str3, warship 600/str2.
  Spawn = **500 free soldiers** (≈50,000 coins of value) + 48h shield.
- War income: `banks_level×50 + provinces×10` coins/hr (≈160/hr per fully-banked province),
  **uncapped by territory**; vault cap = rate×10h.
- **Loot = `floor(0.8 × defender_raw_strength × 5)` = 4× defender strength, minted from
  nothing** to the attacker. This is the dominant inflation driver (a 5,000-tank capture
  mints 100,000 coins).
- **Disparity quantified:** accumulated wealth outruns unit prices by **10³–10⁷×**. Root cause
  is two uncapped faucets feeding a wallet whose only sinks are voluntary purchases.

**Conclusion:** the disparity is a *money-supply* problem. Resetting + controlling the faucets
fixes it; inflating prices would only chase the inflation.

---

## 1. Goals

1. Reset all in-game money to a clean, coherent baseline.
2. Guarantee **every** casino game has a positive house edge.
3. Add a rewarded-ad coin faucet with a sane reward, cooldown, and daily cap.
4. Confirm casino and war share one wallet and that prices are coherent post-reset.
5. Keep changes surgical, verifiable, and reversible where possible.

## 2. Non-goals (this pass)

- Rewriting the authoritative `war_tick()` SQL (faucet throttle) — delivered as a **ready-to-
  apply follow-up** (§6), gated on staging DB testing, because it can't be executed locally.
- Adding a unit-upkeep coin sink (new mechanic) — documented as a future option.
- Making the casino server-authoritative (accepted client-trust per CLAUDE.md §4).
- Real ad-network integration (not viable for a private app — the "ad" is a simulated timer).

---

## 3. Change set (ship this pass)

### 3.1 Money reset — `supabase/migrations/030_reset_money.sql` (coins-only)

```sql
-- Migration 030: Reset all in-game money to a clean baseline. One-off, manual, idempotent.
-- COINS-ONLY: wipes currency (wallet balances + uncollected war income) but LEAVES the war
-- map intact (territory, armies, buildings, players). Re-running re-applies the same values.

-- 1) Wallet coins -> 1000 for everyone (the SQL column default; client tops up to 1100 below).
update public.wallets set balance = 1000;

-- 2) Re-arm the daily bonus so every wallet claims +100 on next load -> uniform 1100,
--    matching a brand-new player's first-visit balance (1000 + DAILY_BONUS_AMOUNT).
update public.wallets set last_daily_bonus = null;

-- 3) Drop every player's uncollected war income (vault coins ARE money).
update public.war_players set vault = 0;

-- 4) Reset income/activity clocks so the next tick pays no retroactive back-income across
--    the reset boundary and the offline dug-in bonus doesn't immediately fire.
update public.war_players set last_income_at = now(), last_active_at = now();
```

**Decisions:** reset to 1,000 + clear `last_daily_bonus` → everyone lands at a uniform **1,100**
on next load (identical to a fresh player). Coins-only (matches "reset the money", preserves
the in-progress war). `game_history` / `donations` (audit logs) untouched. The localStorage
emergency-refill key is not touched (harmless — only matters at balance 0).

> A **full war-wipe variant** (truncate `war_*`) is documented in §6 for a clean season restart.

### 3.2 Casino odds fixes (house always wins)

**Coin Flip** — `src/pages/casino/CoinFlipGame.jsx`
- Line 52: `const winAmount = won ? bet : -bet` → `const winAmount = won ? Math.floor(bet * 0.95) : -bet`
- Line 54 (display mirror): `setWonAmount(won ? bet : bet)` → `setWonAmount(won ? Math.floor(bet * 0.95) : bet)`
- Effect: win pays 1.95× (stake + 0.95×stake). RTP 100% → **97.5%** (2.5% edge), in line with
  roulette's even-money bet.

**Chicken Road** — `src/pages/casino/ChickenRoadGame.jsx`
- Line 6: `const LANE_MULTIPLIERS = [1.5, 2.2, 3.2, 4.8, 7.2, 11.0, 18.0]`
  → `const LANE_MULTIPLIERS = [1.3, 2.0, 3.2, 4.8, 7.2, 11.0, 18.0]`
- Effect (with unchanged `SAFE_PROBS = [0.72, 0.64, …]`): lane-1 RTP 0.72×1.3 = **93.6%**,
  lane-2 RTP 0.4608×2.0 = **92.2%**; every cashout point is now house-favored, curve stays
  monotonic. Optimal strategy (stop at lane 1) still loses 6.4% to the house.

**Verification:** re-run the Monte-Carlo sims for both; confirm all lanes/sides < 100% RTP.

### 3.3 Rewarded-ad coin faucet (new feature)

**Reward structure (owner asked "how much should people get"):**
- **100 coins per ad** (= the price of 1 soldier; equals one daily bonus, but requires effort).
- **3-minute cooldown** between ads.
- **5 ads/day cap → max 500 coins/day** from ads.

Rationale: pegs the ad faucet to the existing anchors (daily bonus 100, refill 100). A
non-war player earns ≈100 (bonus) + up to 500 (ads) = ~600/day — enough to play and slowly
build toward war, without flooding the shared economy. All limits are easy-to-tune constants.

**Mechanism (DB-backed cooldown, mirroring the daily-bonus pattern — not localStorage):**
- `supabase/migrations/031_ad_rewards.sql` adds to `wallets`:
  `last_ad_reward timestamptz`, `ad_rewards_date date`, `ad_rewards_count int default 0`.
- `src/context/CasinoContext.jsx`: add `AD_REWARD_AMOUNT = 100`, `AD_COOLDOWN_MS`,
  `AD_DAILY_CAP`; add `claimAdReward()` (grant + persist counters, like the daily bonus) and
  `canClaimAd()` / `adsLeftToday`; expose them in the context value.
- `src/pages/casino/WatchAdModal.jsx` (new): a simulated 15-second "ad" countdown → "Claim
  reward" button; uses the `cp-*` palette + `modal-in`/`backdrop-in` + inline-SVG icons.
- `src/pages/CasinoPage.jsx`: a "Watch ad for coins" entry point near the balance card; opens
  the modal, calls `claimAdReward()`, shows a success toast (mirroring the daily-bonus toast).

This makes the existing homepage copy ("Watch ads … to build your stash", `HomePage.jsx:305`)
truthful. The ad is a **simulated placeholder** — no real ad network (not viable for a private
invite-only app); this is stated in the modal/docs.

### 3.4 War prices — keep as-is (with justification)

After the reset, the existing costs are correctly scaled to a ~1,100 wallet:

| Item | Cost | % of fresh wallet (1,100) |
|------|------|---------------------------|
| 1 soldier | 100 | 9% |
| 1 tank | 400 | 36% |
| 1 warship | 600 | 55% |
| 1 jet | 800 | 73% |
| Bank L1 | 1,200 | 109% (≈1 day of saving) |

No price change is warranted; the prices already "match" the post-reset money supply. The
internal cost-per-strength spread (tank 80 best value → warship 300) is an intentional mobility
premium (jets/warships buy reach across water), not a bug. Spawn army (500 soldiers) is left
unchanged — it is gameplay-critical for fighting 50–300 neutral garrisons and is *units*, not
spendable coins.

### 3.5 Docs

- `docs/DATABASE.md`: add migration index rows 030, 031; document the new `wallets` ad columns.
- `CLAUDE.md`: add "tune the ad reward" to the "Where to make common changes" table.
- (Optional) `README.md` casino section: note the ad faucet + 10th game (Aviamasters).

---

## 4. Verification

- `node scripts/slots-sim.mjs` and scratch sims for Coin Flip + Chicken Road → confirm all
  RTP < 100%.
- `node --test src/war/*.test.js` → parity + war logic still green (no war constants changed
  this pass).
- `npm run build` → clean.
- Manual: open casino, watch-ad flow grants 100, respects cooldown + daily cap.

## 5. Risks & mitigations

- **Migrations are applied by a human (Jonas), not auto-run** → the reset and ad-column
  migrations are safe to land in the repo; they take effect only when applied. Flag them as
  deploy dependencies.
- **Client-authoritative casino** → odds fixes reduce *fair-play* RTP to <100%; they don't make
  balances tamper-proof (accepted trade-off, CLAUDE.md §4). The ad grant is DB-cooldown-backed
  (robust vs. localStorage clearing) but, like the daily bonus, is still client-written.
- **Open clients show stale balance after reset** → users refresh / re-login to re-read.

---

## 6. Follow-up package (ready, but gated on staging DB test) — War faucet throttle

The durable fix for *re-inflation* is to throttle the two uncapped faucets. This requires
re-creating the authoritative `war_tick()` function, which cannot be executed against a local
DB, so it is delivered here as a ready-to-apply package to test in a Supabase staging SQL
editor before prod.

**Recommended values:** bank income `50 → 25` coins/level/hr; loot `COIN_PER_STRENGTH 5 → 2`
(loot 4× → 1.6× defender strength). Both ≈2–2.5× less inflation.

**Files to change together (parity protocol from review):**
1. `src/war/buildings.js:2` `INCOME_PER_BANK_LEVEL_PER_HOUR = 50 → 25`
2. `src/war/spoils.js:1` `COIN_PER_STRENGTH = 5 → 2`
3. New `supabase/migrations/032_war_rebalance.sql` — `create or replace` `war_tick()` (faithful
   copy of the 027 body) with `banklv*25` and `0.8 * def_raw * 2`.
4. `src/war/parity.test.js` — repoint the bank-income (`/lv \* 50/`, `/banklv\*50/`) and loot
   (`/0\.8 \* def_raw \* 5/`) assertions to `032` with the new literals; update expected JS
   values (25, 2).
5. `docs/DATABASE.md` dual-constant table + migration index.

**Alternative durable lever (no SQL):** strengthen the JS-only `armySizeMultiplier`
(`src/war/economy.js`) so converting a large wallet into a large army costs progressively more
— a parity-safe soft sink for hoarders.

**Primary inflation control going forward:** periodic money resets (migration 030 is now the
template). For a clean season restart, use the full war-wipe variant:

```sql
-- 030 (full-wipe variant): reset coins AND wipe the war board (DESTRUCTIVE).
update public.wallets set balance = 1000;
update public.wallets set last_daily_bonus = null;
truncate table public.war_movements;
truncate table public.war_buildings;
truncate table public.war_regions cascade;
truncate table public.war_players;
-- optional: truncate table public.war_events;
```

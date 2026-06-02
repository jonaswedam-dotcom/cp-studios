# CP War — Audit Remediation (2026-06-02)

Outcome of the deep-dive audit, executed autonomously on branch
**`fix/war-audit-remediation`** (off `main` @ `e8ce4b3`).

**Guiding constraint:** per this repo's `CLAUDE.md` §4/§7, CP War's client-side unit/coin
economy is an **accepted** friends-and-family trust trade-off ("keep that framing in mind
before 'hardening' things"). So the sweeping "make everything server-authoritative" items
(audit C1/C2) were **not** rebuilt autonomously — that would contradict the project's own
governing design decision. Everything that is an unambiguous bug, a well-specified balance fix,
or a safe client improvement was shipped with tests; the rest is documented below as
ready-to-approve recommendations.

Baseline → after: **83 → 87 war tests pass**, `vite build` clean.

---

## 1. Shipped (committed on the branch)

| Commit | Audit item | What |
|---|---|---|
| `e679ee6` | (pending feature) | Committed the test-clean **land-invasion-range** work that was sitting uncommitted in the tree (ground troops march same-landmass within 2000 km + any border neighbour). Unblocks it. |
| `2cd6606` | **B2** | `armySizeMultiplier` now scales on total army **strength** (not unit count) and is **uncapped** — high-strength tanks/warships can't dodge the anti-snowball surcharge, and a casino windfall can't buy an unbounded doomstack at a flat 3×. |
| `2cd6606` | **B1** | **Loot 5 → 15 `COIN_PER_STRENGTH`** (3×). Conquest paid ~25× less than the army it cost to win, so everyone turtled. New `038_war_balance.sql` redefines `war_tick()` (verbatim copy of `036`, only the loot literal changed — verified by diff) and `parity.test.js` now guards `038` as the live tick. |
| `2d90d2c` | **M8** | `landReachable` filters dangling adjacency ids → no phantom null-centroid clickable targets. |
| `2d90d2c` | polish | `showFlash` clears any in-flight timer before re-arming + on unmount → newer toasts aren't blanked early. |
| `2d90d2c` | **M4** | Spawn lock resets on "world is full" so a later opening retries. |
| `2d90d2c` | **H1** | Build/purchase failures surface the real Supabase error (a missing `port`-type migration now reads diagnosably). |
| `2d90d2c` | polish | Failed `provinces.json` fetch shows an error + **Retry** instead of an infinite "Loading war map…" spinner. |
| `2d90d2c` | **#2** | Leaderboard ranks by composite **Power** (provinces + strength/100 + building levels) via tested `src/war/leaderboard.js`; Sidebar shows the power score. Turtling on raw province count no longer tops the board. |
| `2d90d2c` | **#7** | Pulsing **red ring** on my provinces with an enemy force inbound — incoming attacks are now visible on the map, not just the sidebar. |

### ⚠️ Deploy / apply sequence (the part only you + Jonas can do)

The frontend commits deploy with the next Vercel push. The **balance** change has a server half:

1. **Apply `038_war_balance.sql`** in the Supabase SQL editor **after** `036` (it `create or
   replace`s `war_tick()` and depends on `war_stack_strength()` from `036`).
2. Until `038` is applied, the client **predicts** 15× loot while the server still pays 5× — a
   harmless temporary divergence (same pending-migration pattern as the rest of `030`–`037`).
3. I could not run Postgres locally, so `038` is a **byte-for-byte copy of `036`'s `war_tick()`
   with only the loot literal changed** (confirmed by `diff`). It's low-risk, but if you have a
   staging project, run it there once before prod.

The full pending-migration order for Jonas is now: `032 → 033(×2) → 034 → 036 → 037 → 038`
(never `035_war_map_reset.sql.DISABLED`).

---

## 2. Deliberately deferred — with rationale + ready-to-apply recipes

### C1/C2 — server-authoritative economy (the audit's "Critical")
**Not rebuilt autonomously.** `CLAUDE.md` §4 explicitly accepts client-side unit purchases as
"same trust level as the casino" for this private app, and §7 warns against hardening accepted
trade-offs. A half-fix would also give little real protection (you can still inflate your *own*
region's unit counts and send legitimately) while adding real deploy risk to a live game.

**One genuine gap worth a surgical fix (not the full rewrite):** `CLAUDE.md` §4 claims players
"can no longer touch enemy territory," but the tick trusts a client-written `war_movements` row's
`units`/`from_region`/`arrives_at` with no source-ownership check — so a fabricated movement
*can* take enemy land. If you want to close just that (recommended, your call):
- Add a `war_send_units(from, to, units jsonb)` `SECURITY DEFINER` RPC that verifies
  `from_region` ownership, atomically debits the units, and sets `arrives_at` server-side.
- Migration **A**: create the RPC + `grant execute … to authenticated` (additive, safe).
- Ship the client calling the RPC instead of the direct `war_movements` insert.
- Migration **B** (only after the new client is live): `revoke insert on war_movements`.
- This is a 3-step rollout precisely because doing the revoke in one shot would break the live
  client. Worth a short design pass before starting.

### Balance — SQL-side (B5–B8): ready-to-apply, needs your taste + a staging run
These all live inside `war_tick()`, so each is a new migration that `create or replace`s the
tick (copy `038`, change the noted line, bump `parity.test.js`). I did **not** ship them blind
because they're judgment calls on a live game and untestable locally:
- **B5 (defense stacking):** `038:~109` `def_mult := def_mult * 1.5;` (offline) stacks
  *multiplicatively* with the bunker, so a Lv3-bunker + offline = 3.75× and abandoned bases
  become un-conquerable, freezing the map. Change to **additive**:
  `def_mult := (1 + 0.5*def_bunker) + 0.5;` when offline (and/or cap `def_mult`).
- **B7 (ghost-province income):** income credits every owned region incl. forced `soldier=1`
  shells, minting casino coins. Add a `… and (r.soldier+r.tank+r.jet+r.warship) >= <min>` to the
  province-count subquery in the income CTE.
- **B8 (vault cap / yields):** `rate*10` (10 h cap) punishes the offline players the design
  targets; raise to 24–48 h and lift `banklv*50` / `provinces*10` so territory can fund an army.
- **B6 (neutral attrition):** neutrals are stateless (recomputed from a hash each attack), so a
  failed assault never weakens them — needs a persisted `war_neutral_garrison` row + mirror in
  `neutral.js`. Larger; mostly downstream of B1.

### Unit-cost re-tuning (B3/B4)
Client-only and safe, but pure taste on a live economy — I shipped the **structural** B2 fix
(strength-scaling, which already removes tank's "dodge the cap" advantage) and left individual
cost knobs (jet too pricey at 267/str, soldier role) for you to playtest in `units.js`.

### Other deferred bugs (lower value or behavior-only-verifiable, no UI test harness)
- **H2** same-tick multi-arrival fights a stale garrison — real but needs the tick to batch
  movements per destination; risky tick surgery, document-only for now.
- **M2** realtime coalescing + marker diffing — perf (flicker on busy/mobile boards). A rewrite
  of the core render path; deferred because a behavioral regression wouldn't be caught by build.
- **M5** move writes absolute counts (last-writer-wins) — narrow race; re-read source before
  committing.
- **M6** per-minute `loadBalance()` full reload — minor flicker; skipped to avoid coin
  double-credit risk without first auditing `war_collect_income` ↔ `adjustBalance`.
- **M1** `037` remap drops the loser's units on quarter collisions — run its built-in DRY-RUN
  before committing; confirm no active player drops to 0 quarters.
- **M3** duplicate-numbered migrations (`033`×2, `035`×2) — do **not** renumber (some are already
  applied; Supabase tracks by filename). Add an apply-order manifest and move the `.DISABLED`
  reset out of `migrations/`.
- **M7** world-readable `war_players.vault`/`shield_until`/`last_active_at` — expose a public view
  if desired; low priority for a private app.
- **H4** offline buff is backwards (`last_active_at` only stamped by the income poll) — fix needs
  the server to stop stamping it in `war_collect_income` and stamp on real actions instead.

### Large features (each its own project — needs product design, not blind implementation)
#1 alliances/diplomacy · #3 comeback shield · #4 offline-attack web push · #5 detailed battle
reports · #6 tutorial coachmarks · #8 war-native rewarded-ad hooks · #9 weekly seasons · #10
country-domination bonus. The audit sketched each; say the word and I'll brainstorm + build them.

---

*Verification: `node --test 'src/war/*.test.js'` → 87/87; `npm run build` clean. Land-invasion
feature is independently test-clean and safe to merge.*

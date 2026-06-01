# CP War 2.1 — Engagement & Balance Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 11 engagement/balance changes from `docs/superpowers/specs/2026-06-01-cp-war-engagement-balance-design.md` in four shippable phases.

**Architecture:** Stays inside the CP War 2.0 model — pure tested logic in `src/war/*.js`, a thin React/MapLibre layer, and a server-authoritative `pg_cron` `war_tick()`. Adds one table (`war_events`), one jsonb column (`war_movements.units`), one RPC (`war_spawn()`), and progressive tick edits, all via new idempotent migrations `025`–`028`.

**Tech Stack:** React 18 + Vite, Tailwind (`cp-*` palette), Supabase (Postgres + RLS + Realtime + `pg_cron`), MapLibre GL, `node:test` for the pure modules.

**Conventions to honor (from `CLAUDE.md`):**
- Migrations are **manual, numerically ordered, idempotent** (`create … if not exists`, `drop policy if exists`, `create or replace`). Do **not** edit shipped `019`–`024`.
- Every game constant is **duplicated JS↔SQL** and must stay in sync — Task 0 adds a parity test that enforces this; every later task that touches a constant must keep the test green.
- RLS "any signed-in user can read" uses the `auth.role() = 'authenticated'` expression form (the `TO authenticated USING (true)` form is silently broken here).
- No new dependencies. Inline-SVG icons. Verify with `node --test src/war/*.test.js` and `npm run build`.

---

## Pre-flight (one-time)

- [ ] **Create the feature branch** (work stays off `main`; no push without the maintainer asking)

Run:
```bash
git checkout -b feature/war-engagement-balance
git add docs/superpowers/specs/2026-06-01-cp-war-engagement-balance-design.md docs/superpowers/plans/2026-06-01-cp-war-engagement-balance.md
git commit -m "docs(war): engagement & balance spec + plan"
```

---

## File Structure

**New files**
- `src/war/movement.js` — pure: `validateMove(fromId, toId, stack, graph)` → `{ mode, arrivesInSeconds }` or `{ error }`. One source of truth for mode/reachability/capacity/arrival rules. Consumed by `MoveUnitsModal` and `WarPage`.
- `src/war/movement.test.js` — tests for `validateMove`.
- `src/war/parity.test.js` — asserts JS constants == the literals embedded in the migration SQL text.
- `src/war/events.js` — pure: `EVENT_KINDS` + `describeEvent(event, graph)` → `{ icon, text }` for toast/feed rendering.
- `src/war/events.test.js` — tests for `describeEvent`.
- `supabase/migrations/025_war_events.sql` — `war_events` table + RLS + realtime + `war_log_event()` + tick event-writes.
- `supabase/migrations/026_war_combat_v2.sql` — `war_movements.units` jsonb + tick combat rewrite (mixed stack, RNG, retreat, mixed survivors, warship ferry).
- `supabase/migrations/027_war_income_territory.sql` — tick income rework (per-province).
- `supabase/migrations/028_war_spawn.sql` — `war_spawn()` RPC + `shield_until` column lockdown.

**Modified files**
- `src/war/units.js` — tank cost 500→400.
- `src/war/combat.js` — `resolveCombat` gains `opts.rng`, returns `{ winner, survivors, retreat }`.
- `src/war/economy.js` — `armySizeMultiplier(totalUnits)`; `troopCost`/`maxAffordable` take it.
- `src/war/buildings.js` — `INCOME_PER_PROVINCE_PER_HOUR`; income helper takes `provinceCount`.
- `src/war/MoveUnitsModal.jsx` — mixed-stack picker with mode toggle, capacity/range/arrival readout.
- `src/war/MapView.jsx` — reachable-target highlight on selection.
- `src/war/Sidebar.jsx` — Status panel (shield/income/in-transit/incoming) + Activity (event feed) panel.
- `src/war/useWarData.js` — subscribe to `war_events`; expose `events`.
- `src/pages/WarPage.jsx` — call `war_spawn()`; write `units` jsonb; pass `provinceCount`/`totalUnits`; event toasts.
- `src/war/BuyUnitsModal.jsx` — show the army-size cost multiplier in the price.
- `docs/DATABASE.md` — document `war_events`, `war_movements.units`, `war_spawn()`, the column grants.

---

## Task 0: JS↔SQL parity test harness

Lock the duplicated-constants invariant *before* changing constants, so every later task is guarded.

**Files:**
- Create: `src/war/parity.test.js`

- [ ] **Step 1: Write the parity test**

```js
// Asserts the game constants in src/war/*.js match the literals embedded in the
// authoritative migration SQL. Guards the JS↔SQL duplication called out in CLAUDE.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { UNITS } from './units.js'
import { COIN_PER_STRENGTH } from './spoils.js'
import { INCOME_PER_BANK_LEVEL_PER_HOUR } from './buildings.js'

const here = dirname(fileURLToPath(import.meta.url))
const mig = (f) => readFileSync(join(here, '..', '..', 'supabase', 'migrations', f), 'utf8')

test('unit strengths match war_unit_strength() in 023', () => {
  const sql = mig('023_war_tick.sql')
  for (const [t, s] of [['soldier', 1], ['tank', 5], ['jet', 3], ['warship', 2]]) {
    assert.equal(UNITS[t].strength, s)
    assert.match(sql, new RegExp(`when '${t}' then ${s}`))
  }
})

test('bank income 50/level/hour matches buildings.js + 023', () => {
  assert.equal(INCOME_PER_BANK_LEVEL_PER_HOUR, 50)
  assert.match(mig('023_war_tick.sql'), /lv \* 50/)
})

test('loot uses COIN_PER_STRENGTH (5) and 0.8 in 023', () => {
  assert.equal(COIN_PER_STRENGTH, 5)
  assert.match(mig('023_war_tick.sql'), /0\.8 \* def_raw \* 5/)
})
```

- [ ] **Step 2: Run it — expect PASS against today's code**

Run: `node --test src/war/parity.test.js`
Expected: PASS (3 tests). If any fail, the repo already drifted — stop and report.

- [ ] **Step 3: Commit**

```bash
git add src/war/parity.test.js
git commit -m "test(war): JS↔SQL constant parity harness"
```

> As later tasks add constants (RNG band, retreat %, province income, etc.) they extend this file in their own steps.

---

# PHASE 1 — Make it feel alive

Ships: `war_events` log + realtime toasts + Activity feed + Status panel (shield/income/in-transit/incoming) + reachable-target highlighting. Event-writing is added to the **current** combat logic; Phase 2 carries it forward.

## Task 1.1: `war_events` table + RLS + realtime + tick writes (migration 025)

**Files:**
- Create: `supabase/migrations/025_war_events.sql`

- [ ] **Step 1: Write the table + helper + RLS + realtime**

```sql
-- Migration 025: CP War activity log. Idempotent.
create table if not exists public.war_events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  player_id  uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('captured','lost','defended','attack_failed','bounced','eliminated')),
  region_id  text,
  detail     jsonb not null default '{}'::jsonb
);
create index if not exists war_events_player_idx on public.war_events(player_id, created_at desc);

alter table public.war_events enable row level security;
drop policy if exists war_events_select on public.war_events;
create policy war_events_select on public.war_events
  for select using (player_id = auth.uid());
-- No client insert/update/delete: only the SECURITY DEFINER tick writes/prunes.

-- Insert helper, used by war_tick(). SECURITY DEFINER so RLS doesn't block the tick.
create or replace function public.war_log_event(p_player uuid, p_kind text, p_region text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.war_events(player_id, kind, region_id, detail)
  values (p_player, p_kind, p_region, coalesce(p_detail, '{}'::jsonb));
$$;

-- Realtime so clients get live toasts (client subscribes filtered by player_id).
do $$ begin
  alter publication supabase_realtime add table public.war_events;
exception when duplicate_object then null; end $$;
```

- [ ] **Step 2: Append the tick event-writes to migration 025**

Open `supabase/migrations/023_war_tick.sql`, copy the **entire** `create or replace function public.war_tick() … $$;` block, paste it at the end of `025_war_events.sql`, then insert these `war_log_event(...)` calls into the copied body:

In the **neutral capture** branch, right after the `execute format('update … = surv …')` line (was `023:99-100`):
```sql
        perform public.war_log_event(mv.player_id, 'captured', mv.to_region,
          jsonb_build_object('neutral', true, 'coins', 0));
```

In the **shield bounce** branch, after the bounce `execute format(...)` (was `023:116-117`):
```sql
        perform public.war_log_event(mv.player_id, 'bounced', mv.to_region, '{}'::jsonb);
```

In the **enemy capture** branch, after the region flip `execute format('… = surv …')` (was `023:144-145`):
```sql
        perform public.war_log_event(mv.player_id, 'captured', mv.to_region,
          jsonb_build_object('coins', loot, 'opponent', dest.owner_name));
        perform public.war_log_event(dest.owner_id, 'lost', mv.to_region,
          jsonb_build_object('opponent', aname));
```

In the **defender holds** branch, after the survivor-scaling update (was `023:153-154`):
```sql
        perform public.war_log_event(dest.owner_id, 'defended', mv.to_region,
          jsonb_build_object('opponent', aname));
        perform public.war_log_event(mv.player_id, 'attack_failed', mv.to_region,
          jsonb_build_object('opponent', dest.owner_name));
```

At the **very end of the function**, just before the closing `end;\n$$;`, add 7-day pruning:
```sql
  delete from public.war_events where created_at < now() - interval '7 days';
```

- [ ] **Step 3: Verify the SQL parses** (no live DB; static check)

Run: `grep -c "war_log_event" supabase/migrations/025_war_events.sql`
Expected: `7` (1 definition + 6 calls). Also confirm the file contains exactly one `create or replace function public.war_tick()`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/025_war_events.sql
git commit -m "feat(db): war_events activity log + tick writes (migration 025)"
```

## Task 1.2: `events.js` — render events to icon + text

**Files:**
- Create: `src/war/events.js`
- Create: `src/war/events.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeEvent } from './events.js'

const graph = { regions: { FR1: { city: 'Lyon' }, EG1: { city: 'Cairo' } } }

test('captured event shows city + coins', () => {
  const { icon, text } = describeEvent(
    { kind: 'captured', region_id: 'FR1', detail: { coins: 2400, opponent: 'Alex' } }, graph)
  assert.equal(icon, '⚔')
  assert.match(text, /Lyon/)
  assert.match(text, /2,400/)
})

test('lost event names the attacker', () => {
  const { text } = describeEvent(
    { kind: 'lost', region_id: 'EG1', detail: { opponent: 'Alex' } }, graph)
  assert.match(text, /Cairo/)
  assert.match(text, /Alex/)
})

test('unknown region falls back to the id', () => {
  const { text } = describeEvent({ kind: 'defended', region_id: 'ZZ9', detail: {} }, graph)
  assert.match(text, /ZZ9/)
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test src/war/events.test.js`
Expected: FAIL ("describeEvent is not a function" / module not found).

- [ ] **Step 3: Implement `events.js`**

```js
export const EVENT_KINDS = ['captured', 'lost', 'defended', 'attack_failed', 'bounced', 'eliminated']

const cityOf = (id, graph) => graph?.regions?.[id]?.city || id

// → { icon, text } for a war_events row. Pure; safe on partial graphs.
export function describeEvent(ev, graph) {
  const where = cityOf(ev.region_id, graph)
  const d = ev.detail || {}
  const coins = typeof d.coins === 'number' ? d.coins.toLocaleString() : null
  switch (ev.kind) {
    case 'captured':
      return { icon: '⚔', text: coins && d.coins > 0 ? `Captured ${where} (+${coins})` : `Captured ${where}` }
    case 'lost':
      return { icon: '💀', text: `Lost ${where}${d.opponent ? ` to ${d.opponent}` : ''}` }
    case 'defended':
      return { icon: '🛡', text: `Defended ${where}${d.opponent ? ` from ${d.opponent}` : ''}` }
    case 'attack_failed':
      return { icon: '✈', text: `Attack on ${where} failed` }
    case 'bounced':
      return { icon: '↩', text: `Forces bounced off ${where} (shielded)` }
    case 'eliminated':
      return { icon: '☠', text: `You were eliminated` }
    default:
      return { icon: '•', text: where }
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test src/war/events.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/war/events.js src/war/events.test.js
git commit -m "feat(war): event-to-text renderer"
```

## Task 1.3: subscribe to `war_events` in `useWarData`

**Files:**
- Modify: `src/war/useWarData.js`

- [ ] **Step 1: Read the current hook** to match its load + channel pattern.

Run: `sed -n '1,80p' src/war/useWarData.js`

- [ ] **Step 2: Add an `events` state + initial load + realtime**

Following the existing pattern in the file, add for the signed-in `userId`:
- State: `const [events, setEvents] = useState([])`.
- Initial load in the same place the other tables load:
```js
supabase.from('war_events').select('*').eq('player_id', userId)
  .order('created_at', { ascending: false }).limit(50)
  .then(({ data }) => { if (data) setEvents(data) })
```
- On the existing `war-rt-v2` channel, add a filtered INSERT listener (RLS already restricts rows, the filter narrows the stream):
```js
.on('postgres_changes',
  { event: 'INSERT', schema: 'public', table: 'war_events', filter: `player_id=eq.${userId}` },
  ({ new: row }) => setEvents((prev) => [row, ...prev].slice(0, 50)))
```
- Return `events` in the hook's result object.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean build (no new errors).

- [ ] **Step 4: Commit**

```bash
git add src/war/useWarData.js
git commit -m "feat(war): subscribe to war_events in useWarData"
```

## Task 1.4: Activity feed + toasts in `WarPage`/`Sidebar`

**Files:**
- Modify: `src/pages/WarPage.jsx`
- Modify: `src/war/Sidebar.jsx`

- [ ] **Step 1: Toast the newest event in `WarPage`**

In `WarGame`, pull `events` from `useWarData`. Add an effect that fires the existing `showFlash` when a new event arrives (track the latest seen id in a ref to avoid re-toasting on mount):
```js
const lastEventId = useRef(0)
useEffect(() => {
  const newest = events[0]
  if (!newest || newest.id <= lastEventId.current) return
  if (lastEventId.current !== 0) {           // skip the initial backfill
    const { icon, text } = describeEvent(newest, graph)
    showFlash(`${icon} ${text}`)
  }
  lastEventId.current = newest.id
}, [events, graph])
```
Import `describeEvent` from `../war/events.js`. Pass `events` to `<Sidebar … events={events} />`.

- [ ] **Step 2: Render the Activity panel in `Sidebar`**

Add an `events` prop and, below the How-to card, a panel reusing `cp-elevated`/`cp-card`:
```jsx
<div>
  <p className="text-xs text-cp-muted uppercase tracking-wider mb-2">Activity</p>
  <div className="space-y-1.5 max-h-48 overflow-y-auto">
    {(events || []).length === 0 && <p className="text-xs text-cp-muted/60">No activity yet.</p>}
    {(events || []).map((e) => {
      const { icon, text } = describeEvent(e, graph)
      return (
        <div key={e.id} className="flex items-start gap-2 px-3 py-2 bg-cp-elevated rounded-xl text-xs">
          <span>{icon}</span><span className="flex-1 text-cp-text">{text}</span>
        </div>
      )
    })}
  </div>
</div>
```
`Sidebar` needs `graph` + `describeEvent` (add the prop + import). Keep the existing layout otherwise.

- [ ] **Step 3: Verify build + manual smoke**

Run: `npm run build` → clean.
Manual (note for the reviewer; needs migrations applied + two accounts): an attack resolving produces a toast + an Activity row for both attacker and defender.

- [ ] **Step 4: Commit**

```bash
git add src/pages/WarPage.jsx src/war/Sidebar.jsx
git commit -m "feat(war): activity feed + event toasts"
```

## Task 1.5: Status panel — shield / income / in-transit / incoming

**Files:**
- Modify: `src/war/Sidebar.jsx`
- Modify: `src/pages/WarPage.jsx`

- [ ] **Step 1: Compute the status data in `WarPage`**

Derive from already-loaded `movements`, `regions`, `me`, `myBuildings`:
```js
const now = Date.now()
const myRegionIds = new Set(myRegionRows.map((r) => r.region_id))
const outgoing = movements.filter((m) => m.player_id === userId && m.status === 'moving')
const incoming = movements.filter((m) => m.status === 'moving' && m.player_id !== userId && myRegionIds.has(m.to_region))
const shieldMsLeft = me?.shield_until ? new Date(me.shield_until).getTime() - now : 0
// income/hr: banks×50 + provinces×10 (mirror buildings.js once Task 3.x lands; until then banks only)
const banksLevel = myBuildings.filter((b) => b.type === 'bank').reduce((s, b) => s + b.level, 0)
const incomePerHour = banksLevel * 50 + myRegionRows.length * 10
```
Pass `{ outgoing, incoming, shieldMsLeft, incomePerHour }` to `Sidebar` (plus `graph` for names, already added in 1.4).

- [ ] **Step 2: Render the Status panel in `Sidebar`**

Above the Leaderboard, reusing `formatDuration` (import from `./units.js`) and `describeEvent`'s `cityOf` pattern (use `graph.regions[id]?.city || id`):
```jsx
{me && (
  <div className="bg-cp-elevated border border-cp-border rounded-2xl p-4 space-y-2 text-xs">
    {shieldMsLeft > 0 && (
      <p className="text-cp-text">🛡 Shield: <b>{formatDuration(Math.round(shieldMsLeft / 1000))}</b> left</p>
    )}
    <p className="text-cp-muted">💰 Income: <b className="text-amber-400">+{incomePerHour.toLocaleString()}/hr</b></p>
    {outgoing.length > 0 && (
      <div><p className="text-cp-muted mt-1 mb-1">Outgoing</p>
        {outgoing.map((m) => (
          <p key={m.id} className="text-cp-text">→ {graph.regions[m.to_region]?.city || m.to_region} · {formatDuration(Math.max(0, Math.round((new Date(m.arrives_at).getTime() - Date.now()) / 1000)))}</p>
        ))}</div>
    )}
    {incoming.length > 0 && (
      <div><p className="text-red-400 mt-1 mb-1">⚠ Incoming</p>
        {incoming.map((m) => (
          <p key={m.id} className="text-red-300">{graph.regions[m.to_region]?.city || m.to_region} · {formatDuration(Math.max(0, Math.round((new Date(m.arrives_at).getTime() - Date.now()) / 1000)))}</p>
        ))}</div>
    )}
  </div>
)}
```
(ETAs are correct at render; a live countdown is a future nicety.)

- [ ] **Step 3: Verify build**

Run: `npm run build` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/war/Sidebar.jsx src/pages/WarPage.jsx
git commit -m "feat(war): sidebar status panel (shield/income/in-transit/incoming)"
```

## Task 1.6: reachable-target highlighting on the map

**Files:**
- Modify: `src/war/MapView.jsx`
- Modify: `src/pages/WarPage.jsx`

- [ ] **Step 1: Read how MapView tints ownership**

Run: `sed -n '1,140p' src/war/MapView.jsx`
Identify `syncOwnership` and the region fill layer (the layer/source that colours provinces by owner).

- [ ] **Step 2: Pass the selected region + its reachable sets into MapView**

In `WarPage`, compute when `selected` is set (reuse the same helpers `onRegionClick` already uses):
```js
const highlight = useMemo(() => {
  if (!selected || !graph) return null
  const src = regions[selected]
  if (!src || src.owner_id !== userId) return null
  const land = (src.soldier || src.tank) ? landNeighbors(selected, graph) : []
  const air  = (src.jet) ? airReachable(selected, graph, UNITS.jet.airRangeKm) : []
  const sea  = (src.warship) ? seaReachable(selected, graph, UNITS.warship.seaRangeKm) : []
  const reach = new Set([...land, ...air, ...sea])
  const enemy = [...reach].filter((id) => regions[id]?.owner_id && regions[id].owner_id !== userId)
  const open  = [...reach].filter((id) => !regions[id]?.owner_id || regions[id].owner_id === userId)
  return { enemy: new Set(enemy), open: new Set(open) }
}, [selected, graph, regions, userId])
```
Pass `highlight={highlight}` to `<MapView />`. Import `useMemo`.

- [ ] **Step 3: Render the highlight in MapView**

Add a feature-state or a dedicated line/fill layer that, when `highlight` is set, outlines `highlight.open` provinces in a faint owner/white edge and `highlight.enemy` provinces in a faint red edge. Reuse the existing region source; drive it via MapLibre `setFeatureState({ source, id }, { reach: 'enemy'|'open' })` keyed by `region_id`, and add to the existing fill/line paint:
```js
'line-color': ['case',
  ['==', ['feature-state', 'reach'], 'enemy'], '#ef4444',
  ['==', ['feature-state', 'reach'], 'open'],  '#e5e7eb',
  'transparent'],
'line-width': ['case', ['boolean', ['feature-state', 'reach'], false], 2, 0]
```
On `highlight` change, clear prior states then set the new ones; clear all when `highlight` is null. Match the file's existing feature-state usage if present; otherwise add a minimal highlight line layer above the fill.

- [ ] **Step 4: Verify build + manual**

Run: `npm run build` → clean.
Manual: selecting an owned province with soldiers outlines its land neighbours; with a jet, outlines air-range provinces; enemy targets show red.

- [ ] **Step 5: Commit**

```bash
git add src/war/MapView.jsx src/pages/WarPage.jsx
git commit -m "feat(war): highlight reachable targets on selection"
```

**Phase 1 checkpoint:** `npm run build` clean; `node --test src/war/*.test.js` green. Shippable.

---

# PHASE 2 — Combat depth

Ships: mixed-stack movements (`units` jsonb), ±15% RNG, 25% attacker retreat, mixed survivors, warship ferrying. Touches the tick again and reworks the move modal.

## Task 2.1: `resolveCombat` — RNG + retreat + return shape

**Files:**
- Modify: `src/war/combat.js`
- Modify: `src/war/combat.test.js`

- [ ] **Step 1: Add/adjust failing tests** in `combat.test.js`

```js
// deterministic rng helpers
const fixed = (v) => () => v

test('rng can produce an upset (small force wins on high roll vs low roll)', () => {
  const atk = { soldier: 90 }, def = { soldier: 100 }
  // attacker rolls 1.15, defender rolls 0.85 → 103.5 vs 85 → attacker wins
  let calls = 0
  const rng = () => (calls++ === 0 ? 1.0 : 0.0) // 0.85+1.0*0.30=1.15 ; 0.85+0*0.30=0.85
  const r = resolveCombat(atk, def, { rng })
  assert.equal(r.winner, 'attacker')
})

test('losing attacker retreats ~25% of each unit type', () => {
  const atk = { soldier: 100, tank: 4 }, def = { soldier: 100000 }
  const r = resolveCombat(atk, def, { rng: fixed(0.5) }) // both ×1.0, defender dominates
  assert.equal(r.winner, 'defender')
  assert.deepEqual(r.retreat, { soldier: 25, tank: 1, jet: 0, warship: 0 })
})

test('winning attacker has empty retreat', () => {
  const r = resolveCombat({ soldier: 1000 }, { soldier: 1 }, { rng: fixed(0.5) })
  assert.equal(r.winner, 'attacker')
  assert.equal(stackTotal(r.retreat), 0)
})
```
(Keep the existing deterministic tests passing by defaulting the rolls to ×1.0 when `rng` returns 0.5 — verify any existing exact-strength tests still hold with neutral rolls; if an existing test assumed no multiplier, pass `{ rng: () => 0.5 }`.)

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test src/war/combat.test.js`
Expected: FAIL (retreat undefined / new behavior).

- [ ] **Step 3: Implement in `combat.js`**

Replace `resolveCombat` with:
```js
const RETREAT_FRACTION = 0.25 // losing attacker keeps this share, sent home
const RNG_MIN = 0.85, RNG_SPAN = 0.30 // effective strength ×[0.85,1.15]

function retreatStack(stack) {
  const out = emptyStack()
  for (const t of UNIT_TYPES) out[t] = Math.floor((stack[t] || 0) * RETREAT_FRACTION)
  return out
}

export function resolveCombat(attackStack, defenseStack, opts = {}) {
  const { attackMult = 1, defenseMult = 1, antiAir = 0, rng = Math.random } = opts
  const atk = { ...emptyStack(), ...attackStack }
  const def = { ...emptyStack(), ...defenseStack }

  let aStr = stackStrength(atk) * attackMult
  aStr -= antiAir * (atk.jet || 0) * UNITS.jet.strength * attackMult
  aStr = Math.max(0, aStr)
  const dStr = stackStrength(def) * defenseMult

  const aEff = aStr * (RNG_MIN + rng() * RNG_SPAN)
  const dEff = dStr * (RNG_MIN + rng() * RNG_SPAN)

  if (aEff > dEff) {
    return { winner: 'attacker', survivors: ensureSurvivor(scaleToStrength(atk, aEff, aEff - dEff), atk), retreat: emptyStack() }
  }
  if (dEff > aEff) {
    return { winner: 'defender', survivors: ensureSurvivor(scaleToStrength(def, dEff, dEff - aEff), def), retreat: retreatStack(atk) }
  }
  return { winner: 'defender', survivors: { ...emptyStack(), soldier: 1 }, retreat: retreatStack(atk) }
}

export { RETREAT_FRACTION, RNG_MIN, RNG_SPAN }
```

- [ ] **Step 4: Run — expect PASS** (new + existing)

Run: `node --test src/war/combat.test.js`
Expected: PASS. If a pre-existing test fails because it assumed no RNG, update it to pass `{ rng: () => 0.5 }` (neutral ×1.0) — do **not** weaken assertions.

- [ ] **Step 5: Extend parity test** in `parity.test.js`

```js
import { RETREAT_FRACTION, RNG_MIN, RNG_SPAN } from './combat.js'
test('rng band + retreat match 026 tick', () => {
  const sql = mig('026_war_combat_v2.sql')
  assert.equal(RNG_MIN, 0.85); assert.equal(RNG_SPAN, 0.30); assert.equal(RETREAT_FRACTION, 0.25)
  assert.match(sql, /0\.85 \+ random\(\) \* 0\.30/)
  assert.match(sql, /0\.25/)
})
```
(This test will fail until Task 2.3 writes `026`; that's expected — run it after 2.3.)

- [ ] **Step 6: Commit**

```bash
git add src/war/combat.js src/war/combat.test.js src/war/parity.test.js
git commit -m "feat(war): combat RNG band + attacker retreat"
```

## Task 2.2: `movement.js` — mixed-stack validation

**Files:**
- Create: `src/war/movement.js`
- Create: `src/war/movement.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateMove, WARSHIP_CAPACITY } from './movement.js'

const graph = { regions: {
  A: { neighbors: ['B'], coastal: true,  centroid: [0, 0] },
  B: { neighbors: ['A'], coastal: true,  centroid: [0, 1] },
  C: { neighbors: [],    coastal: true,  centroid: [0, 2] },   // not land-adjacent to A
  X: { neighbors: [],    coastal: false, centroid: [40, 40] }, // far inland
}}

test('land move with soldiers+tanks arrives at the tank speed', () => {
  const r = validateMove('A', 'B', { soldier: 100, tank: 5 }, graph)
  assert.equal(r.mode, 'land')
  assert.equal(r.arrivesInSeconds, 2400) // tank
})

test('land move to a non-neighbour is rejected', () => {
  assert.ok(validateMove('A', 'C', { soldier: 10 }, graph).error)
})

test('air move (jets only) reaches far provinces', () => {
  const r = validateMove('A', 'X', { jet: 10 }, graph)
  assert.equal(r.mode, 'air')
  assert.equal(r.arrivesInSeconds, 600)
})

test('sea move ferries land units within warship capacity', () => {
  const r = validateMove('A', 'C', { warship: 5, soldier: WARSHIP_CAPACITY * 5 }, graph)
  assert.equal(r.mode, 'sea')
  assert.equal(r.arrivesInSeconds, 2400)
})

test('sea move over capacity is rejected', () => {
  assert.ok(validateMove('A', 'C', { warship: 1, soldier: WARSHIP_CAPACITY + 1 }, graph).error)
})

test('mixing jets with land units is rejected', () => {
  assert.ok(validateMove('A', 'B', { soldier: 10, jet: 1 }, graph).error)
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test src/war/movement.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `movement.js`**

```js
import { UNITS, UNIT_TYPES } from './units.js'
import { landNeighbors, airReachable, seaReachable } from './geo.js'

export const WARSHIP_CAPACITY = 20 // land units ferried per warship

const present = (stack) => UNIT_TYPES.filter((t) => (stack[t] || 0) > 0)
const arrival = (types) => Math.max(...types.map((t) => UNITS[t].travelSeconds))

// Returns { mode, arrivesInSeconds } for a valid mixed-stack leg, else { error }.
export function validateMove(fromId, toId, stack, graph) {
  const types = present(stack)
  if (types.length === 0) return { error: 'No units selected.' }
  const set = new Set(types)
  const onlyLand = types.every((t) => UNITS[t].mode === 'land')
  const onlyAir = types.every((t) => t === 'jet')
  const hasWarship = set.has('warship')

  // Air: jets only.
  if (set.has('jet')) {
    if (!onlyAir) return { error: 'Jets fly alone — no other units on an air strike.' }
    if (!airReachable(fromId, graph, UNITS.jet.airRangeKm).includes(toId)) return { error: 'Out of jet range.' }
    return { mode: 'air', arrivesInSeconds: arrival(types) }
  }
  // Sea: warships, optionally ferrying soldiers/tanks.
  if (hasWarship) {
    const cargo = (stack.soldier || 0) + (stack.tank || 0)
    if (cargo > WARSHIP_CAPACITY * (stack.warship || 0)) return { error: 'Over warship capacity.' }
    if (!seaReachable(fromId, graph, UNITS.warship.seaRangeKm).includes(toId)) return { error: 'No sea route.' }
    return { mode: 'sea', arrivesInSeconds: arrival(types) }
  }
  // Land: soldiers/tanks to a bordering province.
  if (onlyLand) {
    if (!landNeighbors(fromId, graph).includes(toId)) return { error: 'Not a bordering province.' }
    return { mode: 'land', arrivesInSeconds: arrival(types) }
  }
  return { error: 'Invalid unit mix.' }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test src/war/movement.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/war/movement.js src/war/movement.test.js
git commit -m "feat(war): mixed-stack movement validation"
```

## Task 2.3: tick combat rewrite (migration 026)

**Files:**
- Create: `supabase/migrations/026_war_combat_v2.sql`

- [ ] **Step 1: Add the `units` column + a strength helper for a jsonb stack**

```sql
-- Migration 026: mixed-stack movements + combat v2. Idempotent.
alter table public.war_movements add column if not exists units jsonb not null default '{}'::jsonb;

-- Strength of a jsonb stack {soldier,tank,jet,warship}. Mirrors war_unit_strength().
create or replace function public.war_stack_strength(s jsonb) returns numeric
language sql immutable as $$
  select coalesce((s->>'soldier')::numeric,0)*1 + coalesce((s->>'tank')::numeric,0)*5
       + coalesce((s->>'jet')::numeric,0)*3 + coalesce((s->>'warship')::numeric,0)*2;
$$;
```

- [ ] **Step 2: Rewrite `war_tick()` in `026`**

Copy the `war_tick()` body from `025_war_events.sql` (the event-writing version) into `026`. In the movement loop, replace the per-`unit_type` logic with jsonb-stack logic:

- Read the stack: `mv.units` (jsonb). Attacker strength:
```sql
    select coalesce(sum(level),0) into atk_lab from public.war_buildings where owner_id = mv.player_id and type='lab';
    attack_mult := 1 + 0.1 * atk_lab;
    a_str := public.war_stack_strength(mv.units) * attack_mult;
    -- anti-air applies to the jet portion only:
    -- (computed below once def_aa is known, before the clash)
```
- **RNG:** wherever the old code compared `a_str` vs `d_str`, instead compute and compare effective values:
```sql
    a_eff := a_str * (0.85 + random() * 0.30);
    d_eff := d_str * (0.85 + random() * 0.30);
```
  (Declare `a_eff numeric; d_eff numeric;`.) Apply anti-air to `a_str` before the roll: `if (mv.units ? 'jet') then a_str := a_str - aa * coalesce((mv.units->>'jet')::numeric,0)*3*attack_mult; a_str := greatest(0, a_str); end if;`
- **Neutral & enemy capture:** survivors are now a **scaled mixed stack**. Compute ratio `(a_eff - d_eff)/a_eff` and write all four columns:
```sql
        surv_ratio := (a_eff - d_eff) / a_eff;
        update public.war_regions set
          soldier = greatest(0, floor(coalesce((mv.units->>'soldier')::numeric,0) * surv_ratio)),
          tank    = greatest(0, floor(coalesce((mv.units->>'tank')::numeric,0)    * surv_ratio)),
          jet     = greatest(0, floor(coalesce((mv.units->>'jet')::numeric,0)     * surv_ratio)),
          warship = greatest(0, floor(coalesce((mv.units->>'warship')::numeric,0) * surv_ratio)),
          owner_id = mv.player_id, owner_name = aname, color = acolor, is_hq = false, updated_at = now()
        where region_id = mv.to_region;
        -- ensureSurvivor: guarantee ≥1 unit on a captured region
        update public.war_regions set soldier = 1
          where region_id = mv.to_region and (soldier+tank+jet+warship) = 0;
```
  (Declare `surv_ratio numeric;`. For the **neutral** branch the region is inserted first as today, then updated with the scaled stack.)
- **Defender holds + retreat:** keep the existing defender survivor scaling (now `(d_eff - a_eff)/d_eff`), then add the 25% attacker retreat to the origin (mirror the shield-bounce write, per unit type):
```sql
        update public.war_regions set
          soldier = soldier + floor(coalesce((mv.units->>'soldier')::numeric,0)*0.25),
          tank    = tank    + floor(coalesce((mv.units->>'tank')::numeric,0)*0.25),
          jet     = jet     + floor(coalesce((mv.units->>'jet')::numeric,0)*0.25),
          warship = warship + floor(coalesce((mv.units->>'warship')::numeric,0)*0.25),
          updated_at = now()
        where region_id = mv.from_region and owner_id = mv.player_id;
```
- **Loot** uses `def_raw` as before (unchanged): `loot := floor(0.8 * def_raw * 5);`.
- **Events:** keep the `war_log_event(...)` calls from Task 1.1; enrich `captured` detail with the surviving stack if convenient (optional).
- **Shield bounce:** bounce the whole stack home:
```sql
        update public.war_regions set
          soldier = soldier + coalesce((mv.units->>'soldier')::numeric,0),
          tank    = tank    + coalesce((mv.units->>'tank')::numeric,0),
          jet     = jet     + coalesce((mv.units->>'jet')::numeric,0),
          warship = warship + coalesce((mv.units->>'warship')::numeric,0),
          updated_at = now()
        where region_id = mv.from_region and owner_id = mv.player_id;
```
- **Reinforce own province:** add the whole stack to the destination (same four-column add as the bounce, but on `mv.to_region`).

- [ ] **Step 3: Static checks**

Run: `grep -c "war_stack_strength\|a_eff\|surv_ratio" supabase/migrations/026_war_combat_v2.sql`
Expected: ≥ 6. Confirm exactly one `create or replace function public.war_tick()` and that `random() * 0.30` and `0.85` appear.

- [ ] **Step 4: Run the parity test from Task 2.1 Step 5**

Run: `node --test src/war/parity.test.js`
Expected: PASS (the `026` regexes now match).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/026_war_combat_v2.sql
git commit -m "feat(db): combat v2 — mixed stacks, RNG, retreat (migration 026)"
```

## Task 2.4: rebuild `MoveUnitsModal` for mixed stacks

**Files:**
- Modify: `src/war/MoveUnitsModal.jsx`

- [ ] **Step 1: Read the current modal** to match props/styling.

Run: `cat src/war/MoveUnitsModal.jsx`

- [ ] **Step 2: Rework to a mixed picker**

The modal receives `{ graph, regions, fromRegion, loading, onConfirm, onClose }`. New behavior:
- Player picks a **destination** (existing flow passes `fromRegion`; keep the destination-pick or accept a preselected `dest`). For each candidate mode, use `validateMove(fromRegion, dest, stack, graph)` to gate.
- Show count inputs for the unit types valid in the chosen mode (land: soldier/tank; air: jet; sea: warship + soldier/tank cargo), each capped at the source region's available count.
- Live readout: mode, arrival via `formatDuration(validateMove(...).arrivesInSeconds)`, and for sea the remaining capacity.
- `onConfirm({ dest, stack, mode })` where `stack` is `{soldier,tank,jet,warship}` (zeros omitted is fine).
Import `validateMove, WARSHIP_CAPACITY` from `./movement.js` and `UNITS, formatDuration` from `./units.js`. Keep the `cp-*` styling and the modal shell already used.

- [ ] **Step 3: Verify build**

Run: `npm run build` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/war/MoveUnitsModal.jsx
git commit -m "feat(war): mixed-stack move modal"
```

## Task 2.5: wire mixed moves through `WarPage`

**Files:**
- Modify: `src/pages/WarPage.jsx`

- [ ] **Step 1: Replace `handleMove` to write a `units` jsonb movement**

```js
const handleMove = useCallback(async ({ dest, stack, mode }) => {
  if (busy || !moveFrom) return
  setBusy(true)
  try {
    const src = regions[moveFrom]
    if (!src || src.owner_id !== userId) { showFlash('Move no longer valid.'); return }
    for (const t of UNIT_TYPES) if ((stack[t] || 0) > (src[t] || 0)) { showFlash('Not enough units.'); return }
    const v = validateMove(moveFrom, dest, stack, graph)
    if (v.error) { showFlash(v.error); return }
    const destRow = regions[dest]
    const destShielded = destRow?.owner_id && destRow.owner_id !== userId &&
      players.some((p) => p.user_id === destRow.owner_id && p.shield_until && new Date(p.shield_until) > new Date())
    if (destShielded) { showFlash("That player is shielded — you can't attack yet."); return }
    const arrivesAt = new Date(Date.now() + v.arrivesInSeconds * 1000).toISOString()
    // decrement each unit type from source
    const dec = {}; for (const t of UNIT_TYPES) dec[t] = (src[t] || 0) - (stack[t] || 0)
    const { error: decErr } = await supabase.from('war_regions').update({ ...dec, updated_at: new Date().toISOString() }).eq('region_id', moveFrom)
    if (decErr) { showFlash('Move failed.'); return }
    const { error: mvErr } = await supabase.from('war_movements').insert({
      player_id: userId, from_region: moveFrom, to_region: dest, units: stack, mode, arrives_at: arrivesAt,
    })
    if (mvErr) {
      await supabase.from('war_regions').update({ ...Object.fromEntries(UNIT_TYPES.map((t) => [t, src[t] || 0])), updated_at: new Date().toISOString() }).eq('region_id', moveFrom)
      showFlash('Move failed.'); return
    }
    showFlash(`Force en route — arrives in ${formatDuration(v.arrivesInSeconds)}`)
  } finally { setMoveFrom(null); setSelected(null); setBusy(false) }
}, [busy, moveFrom, regions, userId, players, graph])
```
Import `validateMove` from `../war/movement.js`. Update `MapView`'s movement animation to read `mv.units` (sum the stack) — `MapView.jsx:135` currently reads `mv.unit_type`; have it fall back to summing `units` for the animation duration via `Math.max` of present types' `travelSeconds` (or just animate over `arrives_at - created_at`).

- [ ] **Step 2: Verify build**

Run: `npm run build` → clean.

- [ ] **Step 3: Commit**

```bash
git add src/pages/WarPage.jsx src/war/MapView.jsx
git commit -m "feat(war): send mixed-stack movements"
```

**Phase 2 checkpoint:** `node --test src/war/*.test.js` green; `npm run build` clean. Shippable.

---

# PHASE 3 — Balance & economy

Ships: tank rebalance, per-province income, army-size cost curve.

## Task 3.1: tank cost 500 → 400

**Files:**
- Modify: `src/war/units.js`

- [ ] **Step 1: Edit the tank cost**

In `UNITS`, change `tank: { … cost: 500 … }` to `cost: 400`. Strength stays 5.

- [ ] **Step 2: Verify tests + build**

Run: `node --test src/war/*.test.js` → green; `npm run build` → clean.

- [ ] **Step 3: Commit**

```bash
git add src/war/units.js
git commit -m "balance(war): tank cost 500→400 (coin-efficient muscle)"
```

## Task 3.2: army-size cost multiplier

**Files:**
- Modify: `src/war/economy.js`
- Modify: `src/war/economy.test.js`
- Modify: `src/war/BuyUnitsModal.jsx`
- Modify: `src/pages/WarPage.jsx`

- [ ] **Step 1: Failing tests** in `economy.test.js`

```js
import { armySizeMultiplier, troopCost } from './economy.js'
test('army multiplier steps every 1000 units, caps at 3x', () => {
  assert.equal(armySizeMultiplier(0), 1)
  assert.equal(armySizeMultiplier(999), 1)
  assert.equal(armySizeMultiplier(1000), 1.25)
  assert.equal(armySizeMultiplier(4000), 2)
  assert.equal(armySizeMultiplier(100000), 3)
})
test('troopCost folds in factory + army multipliers', () => {
  // soldier 100, factory ×0.8, army ×1.25 → 100*10*0.8*1.25 = 1000
  assert.equal(troopCost('soldier', 10, 0.8, 1.25), 1000)
})
```

- [ ] **Step 2: Run — expect FAIL.** `node --test src/war/economy.test.js`

- [ ] **Step 3: Implement in `economy.js`**

```js
export function armySizeMultiplier(totalUnits) {
  return Math.min(3, 1 + 0.25 * Math.floor((totalUnits || 0) / 1000))
}
export function troopCost(type, count, costMult = 1, armyMult = 1) {
  const u = UNITS[type]
  if (!u || count <= 0) return 0
  return Math.round(u.cost * count * costMult * armyMult)
}
export function maxAffordable(type, balance, costMult = 1, armyMult = 1) {
  const u = UNITS[type]
  if (!u) return 0
  return Math.max(0, Math.floor((balance ?? 0) / (u.cost * costMult * armyMult)))
}
```

- [ ] **Step 4: Run — expect PASS.** `node --test src/war/economy.test.js`

- [ ] **Step 5: Use it in the UI**

In `WarPage`, compute `const myArmyMult = armySizeMultiplier(myUnits)` and pass to `handleBuy` (use `troopCost(type, count, myCostMult, myArmyMult)`) and to `<BuyUnitsModal armyMult={myArmyMult} … />`. In `BuyUnitsModal`, multiply the displayed price by `armyMult` and, when `armyMult > 1`, show a small note "Army-size surcharge ×{armyMult}". Import `armySizeMultiplier` in `WarPage`.

- [ ] **Step 6: Verify build.** `npm run build` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/war/economy.js src/war/economy.test.js src/war/BuyUnitsModal.jsx src/pages/WarPage.jsx
git commit -m "balance(war): army-size cost curve"
```

## Task 3.3: per-province income

**Files:**
- Modify: `src/war/buildings.js`
- Modify: `src/war/buildings.test.js`
- Create: `supabase/migrations/027_war_income_territory.sql`
- Modify: `src/pages/WarPage.jsx`

- [ ] **Step 1: Failing test** in `buildings.test.js`

```js
import { INCOME_PER_PROVINCE_PER_HOUR, incomePerTick } from './buildings.js'
test('income includes per-province trickle', () => {
  assert.equal(INCOME_PER_PROVINCE_PER_HOUR, 10)
  // 2 banks (×50) + 3 provinces (×10) = 130/hr; one hour tick → 130
  assert.equal(incomePerTick([{ type: 'bank', level: 2 }], 3600, 3), 130)
})
```

- [ ] **Step 2: Run — expect FAIL.** `node --test src/war/buildings.test.js`

- [ ] **Step 3: Implement in `buildings.js`**

```js
export const INCOME_PER_PROVINCE_PER_HOUR = 10 // tunable
export function incomePerTick(playerBuildings, tickSeconds, provinceCount = 0) {
  const lv = totalLevel(playerBuildings, 'bank')
  const rate = lv * INCOME_PER_BANK_LEVEL_PER_HOUR + provinceCount * INCOME_PER_PROVINCE_PER_HOUR
  return Math.round(rate * (tickSeconds / 3600))
}
```

- [ ] **Step 4: Run — expect PASS.** `node --test src/war/buildings.test.js` (fix the existing 2-bank test to pass `provinceCount = 0` → still 100.)

- [ ] **Step 5: Migration 027 — rework the tick income CTE**

Copy `war_tick()` from `026` into `027`. Replace the income step's `bank`/`calc` CTEs so `rate = banks×50 + provinces×10`:
```sql
  with base as (
    select p.user_id, p.vault, p.last_income_at,
           coalesce((select sum(level) from public.war_buildings b where b.owner_id = p.user_id and b.type='bank'),0) as banklv,
           (select count(*) from public.war_regions r where r.owner_id = p.user_id) as provinces
    from public.war_players p
  ), calc as (
    select user_id, vault, last_income_at,
           (banklv*50 + provinces*10) as rate,
           floor((banklv*50 + provinces*10) * greatest(0, extract(epoch from (now()-last_income_at))/3600.0)) as accrued
    from base
  )
  update public.war_players p set
    vault = least(p.vault + c.accrued, greatest(p.vault, c.rate*10))::int,
    last_income_at = case
      when c.rate = 0    then now()
      when c.accrued > 0 then p.last_income_at + (c.accrued::numeric / c.rate) * interval '1 hour'
      else p.last_income_at end
  from calc c where c.user_id = p.user_id;
```

- [ ] **Step 6: Extend parity test** in `parity.test.js`

```js
import { INCOME_PER_PROVINCE_PER_HOUR } from './buildings.js'
test('province income 10/hr matches 027', () => {
  assert.equal(INCOME_PER_PROVINCE_PER_HOUR, 10)
  assert.match(mig('027_war_income_territory.sql'), /provinces\*10|provinces \* 10/)
})
```

- [ ] **Step 7: Use province income/hr in the sidebar** — already wired in Task 1.5 (`banksLevel*50 + myRegionRows.length*10`). Confirm it matches.

- [ ] **Step 8: Verify + commit**

Run: `node --test src/war/*.test.js` → green; `npm run build` → clean.
```bash
git add src/war/buildings.js src/war/buildings.test.js supabase/migrations/027_war_income_territory.sql src/war/parity.test.js src/pages/WarPage.jsx
git commit -m "feat(war): per-province income (migration 027)"
```

**Phase 3 checkpoint:** tests green, build clean. Shippable.

---

# PHASE 4 — Fairness

Ships: server-granted shield via `war_spawn()` RPC + `shield_until` column lockdown.

## Task 4.1: `war_spawn()` RPC + column grants (migration 028)

**Files:**
- Create: `supabase/migrations/028_war_spawn.sql`

- [ ] **Step 1: Write the RPC + grants**

```sql
-- Migration 028: server-authoritative spawn + shield lockdown. Idempotent.
create or replace function public.war_spawn(p_region text, p_country text, p_color text, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); existing text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  -- idempotent: if the player already exists, return their spawn region
  select spawn_region into existing from public.war_players where user_id = uid;
  if existing is not null then return existing; end if;
  -- region must be unclaimed
  if exists (select 1 from public.war_regions where region_id = p_region and owner_id is not null) then
    raise exception 'region taken';
  end if;
  insert into public.war_players (user_id, display_name, color, spawn_region, shield_until, last_income_at, last_active_at)
  values (uid, p_name, p_color, p_region, now() + interval '48 hours', now(), now())
  on conflict (user_id) do nothing;
  insert into public.war_regions (region_id, country_code, owner_id, owner_name, color, is_hq, soldier, tank, jet, warship, updated_at)
  values (p_region, p_country, uid, p_name, p_color, true, 500, 0, 0, 0, now())
  on conflict (region_id) do update
    set owner_id = excluded.owner_id, owner_name = excluded.owner_name, color = excluded.color,
        is_hq = true, soldier = 500, updated_at = now()
    where public.war_regions.owner_id is null;
  return p_region;
end;
$$;
revoke all on function public.war_spawn(text,text,text,text) from public;
grant execute on function public.war_spawn(text,text,text,text) to authenticated;

-- Shield/vault/activity become definer-only; clients keep their legitimate self-edits.
revoke update (shield_until, vault, last_active_at, last_income_at, is_alive) on public.war_players from authenticated;
grant  update (display_name, color, spawn_region) on public.war_players to authenticated;
```
(START_ARMY soldier=500 mirrors `units.js`; if that constant changes, update here — note added to the parity test below.)

- [ ] **Step 2: Extend parity test** for START_ARMY

```js
import { START_ARMY } from './units.js'
test('START_ARMY soldiers match war_spawn() in 028', () => {
  assert.equal(START_ARMY.soldier, 500)
  assert.match(mig('028_war_spawn.sql'), /true, 500, 0, 0, 0/)
})
```

- [ ] **Step 3: Static check + parity**

Run: `node --test src/war/parity.test.js` → PASS.
Run: `grep -c "revoke update (shield_until" supabase/migrations/028_war_spawn.sql` → `1`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/028_war_spawn.sql src/war/parity.test.js
git commit -m "feat(db): war_spawn() RPC + shield_until lockdown (migration 028)"
```

## Task 4.2: client uses `war_spawn()`

**Files:**
- Modify: `src/pages/WarPage.jsx`

- [ ] **Step 1: Replace the first-join insert/upsert with the RPC**

In the spawn effect, swap the two `supabase.from(...).insert/upsert` calls for:
```js
const { data: spawned, error } = await supabase.rpc('war_spawn', {
  p_region: spawn, p_country: graph.regions[spawn]?.country || null, p_color: color, p_name: userName,
})
if (error || !spawned) { initRef.current = false; showFlash('Could not join the war — try again in a moment.'); return }
showFlash(`You start in ${graph.regions[spawned]?.city || spawned}!`)
```
Remove the now-unused `shield_until` client-set. Leave the eliminated-respawn buy path as-is (it upserts a region the player owns; it does not touch `shield_until`).

- [ ] **Step 2: Verify build**

Run: `npm run build` → clean.

- [ ] **Step 3: Commit**

```bash
git add src/pages/WarPage.jsx
git commit -m "feat(war): spawn via server-authoritative war_spawn() RPC"
```

## Task 4.3: docs

**Files:**
- Modify: `docs/DATABASE.md`

- [ ] **Step 1: Document the additions**

Add to `docs/DATABASE.md`: the `war_events` table (columns, RLS, realtime, 7-day prune), `war_movements.units` jsonb, `war_spawn()` RPC, the `war_players` column-level grants, and the new constants (RNG band, retreat %, province income, army curve, warship capacity) with the JS↔SQL parity-test note. Add migrations `025`–`028` to the migration index and the setup checklist (run in order; `025` adds a realtime table → confirm in the dashboard).

- [ ] **Step 2: Commit**

```bash
git add docs/DATABASE.md
git commit -m "docs(db): document war 2.1 schema + constants"
```

---

## Final verification

- [ ] **All pure-logic tests green:** `node --test src/war/*.test.js` → all pass (combat, movement, economy, buildings, events, units, neutral, spoils, geo, spawn, parity).
- [ ] **Build clean:** `npm run build` → no new errors.
- [ ] **Migration sanity:** each of `025`–`028` contains exactly one definition of any `create or replace` function it owns; `war_tick()` appears once per file that redefines it (025, 026, 027); the parity test passes against all four files.
- [ ] **Manual (needs migrations applied + ≥2 accounts; document for the maintainer, not run here):** mixed land assault arrives together; warship ferries an army overseas; an upset and a 25%-retreat both occur; capture/loss/defence produce a toast + Activity entry; incoming-attack ETA shows; territory income accrues with no bank; the army-size surcharge raises buy prices; a client cannot extend its own `shield_until` (direct `update war_players set shield_until=…` is rejected); `war_spawn()` is idempotent.
- [ ] **Self-review the plan against the spec** (coverage / placeholders / type consistency) — done inline below.

## Plan self-review (coverage map)

| Spec item | Task |
|-----------|------|
| #1 event feed + toasts | 1.1–1.4 |
| #2 in-transit/incoming/shield/income panel | 1.5 |
| #3 reachable highlighting | 1.6 |
| #4 combat RNG | 2.1, 2.3 |
| #5 attacker retreat | 2.1, 2.3 |
| #6 combined arms (mixed stacks) | 2.2–2.5 |
| #7 tank rebalance | 3.1 |
| #8 warship transport (ferry capacity) | 2.2 (`WARSHIP_CAPACITY`), 2.3 (combined stack fights), 2.4 (cargo UI) |
| #9 per-province income | 3.3 |
| #10 currency friction (army-size curve) | 3.2 |
| #11 server-side shield | 4.1–4.2 |
| JS↔SQL parity | Task 0 + extended in 2.1, 3.3, 4.1 |
| Docs | 4.3 |

No placeholders; constant names (`WARSHIP_CAPACITY`, `armySizeMultiplier`, `INCOME_PER_PROVINCE_PER_HOUR`, `RETREAT_FRACTION`, `RNG_MIN`/`RNG_SPAN`) are consistent across the tasks that reference them.

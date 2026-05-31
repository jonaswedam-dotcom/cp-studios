# CP War Phase 3 — Persistent Idle World (Server Tick, Income, Shields) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the live-only game into a persistent world that advances overnight: a scheduled Postgres job resolves movements/combat and credits **capped** passive income with nobody online, combat becomes **server-authoritative**, and players get **shields** so months of progress can't be wiped in one night.

**Architecture:** A `SECURITY DEFINER` Postgres function `war_tick()` (scheduled by `pg_cron`) becomes the single source of truth for movement arrival, combat, capture spoils, and income accrual. The client stops resolving combat and just reads realtime state + collects its capped income vault via an RPC. RLS tightens so clients can only write their **own** regions/buildings; the tick (definer) does everything cross-player. The pure JS combat/economy/building modules from Phases 1–2 are mirrored in SQL (constants kept in sync by comment).

**Tech Stack:** Supabase Postgres (PL/pgSQL, `pg_cron`, RLS, SECURITY DEFINER RPCs), React 18 + Vite, maplibre-gl, Node `node:test`. No new npm deps.

---

## Prerequisites (must exist — from Phases 1 & 2)

Builds on `...phase1-conquest-core.md` and `...phase2-depth.md`. Verify:

- **Units** (`src/war/units.js`): `UNITS` (`soldier` str 1 / `tank` 5 / `jet` 3 / `warship` 2), `UNIT_TYPES`, `START_ARMY`. **The SQL in this plan hardcodes these strengths — keep them in sync.**
- **Buildings** (`src/war/buildings.js`): `BUILDINGS`, `buildingCost`, `defenseMultiplier` (1+0.5·bunkerLvl), `antiAirFactor` (min .75, .25·lvl), `costMultiplier`, `strengthMultiplier` (1+0.1·labLvl), `incomePerTick`, `INCOME_PER_BANK_LEVEL_PER_HOUR = 50`.
- **Combat** (`src/war/combat.js`): `resolveCombat(atk, def, opts)`, `stackFromRow`, `stackStrength`, `stackTotal`, `emptyStack`.
- **Spoils/neutral** (`src/war/spoils.js` `lootFraction`/`lootCoins` w/ `COIN_PER_STRENGTH=5`; `src/war/neutral.js` `neutralGarrison` using the `h = (h*31 + charCode) >>> 0`, `50 + h%251` formula — **the SQL `war_neutral_soldiers` below mirrors this exactly**).
- **DB**: `war_players` (incl. `shield_until`, `last_income_at`), `war_regions` (incl. `warship`), `war_movements` (modes land/air/sea), `war_buildings`. Migrations up to `021`.
- **Client**: `src/pages/WarPage.jsx` orchestrator with a client-side `resolveMovements` interval (this plan removes it); `src/war/MoveUnitsModal.jsx`; `src/context/CasinoContext.jsx` `adjustBalance`.

Branch before the first commit (e.g. `git checkout -b feature/war-phase3`). Tests: `node --test <path>`.

---

## Task 1: Slow the movement timers to the long-game scale

**Files:**
- Modify: `src/war/units.js`

- [ ] **Step 1: Set production travel times in `src/war/units.js`**

```js
export const UNITS = {
  soldier: { label: 'Soldier', strength: 1, cost: 100, mode: 'land', travelSeconds: 3600 },   // 1h
  tank:    { label: 'Tank',    strength: 5, cost: 500, mode: 'land', travelSeconds: 7200 },   // 2h
  jet:     { label: 'Jet',     strength: 3, cost: 800, mode: 'air',  travelSeconds: 1800, airRangeKm: 4500 }, // 30m
  warship: { label: 'Warship', strength: 2, cost: 600, mode: 'sea',  travelSeconds: 7200, seaRangeKm: 7000 }, // 2h
}
// Other exports (UNIT_TYPES, START_ARMY) unchanged.
```

> Tuning note: keep these short (e.g. 30–120s) while testing the tick, then restore the hour-scale values before shipping. They are deliberately slow so a defender always has time to log in (pairs with shields).

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/war/units.js
git commit -m "feat(war): long-game movement timers"
```

---

## Task 2: Idle/shield schema

**Files:**
- Create: `supabase/migrations/022_war_idle_columns.sql`

- [ ] **Step 1: Write `supabase/migrations/022_war_idle_columns.sql`**

```sql
-- Migration 022: columns for the idle economy + activity tracking. Idempotent.
alter table public.war_players add column if not exists vault          integer not null default 0;
alter table public.war_players add column if not exists last_active_at timestamptz not null default now();
-- last_income_at + shield_until already exist from migration 019.
```

Apply by hand in the Supabase SQL editor. Verify: `select vault, last_active_at from public.war_players limit 1;` runs without error.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/022_war_idle_columns.sql
git commit -m "feat(db): war idle/activity columns (vault, last_active_at)"
```

---

## Task 3: Server tick + income RPC (the core of Phase 3)

This is the highest-risk task — test it carefully in Step 3. The function resolves every due movement (move-in vs neutral garrison, reinforce, or combat with building modifiers + shields + offline dug-in bonus + capture spoils), then accrues capped income into each player's vault, then recomputes `is_alive`.

**Files:**
- Create: `supabase/migrations/023_war_tick.sql`

- [ ] **Step 1: Write `supabase/migrations/023_war_tick.sql`**

```sql
-- Migration 023: CP War server-side resolution + income. Idempotent (create or replace).
-- ─────────────────────────────────────────────────────────────────────────────

-- Unit strengths — MUST match src/war/units.js.
create or replace function public.war_unit_strength(t text) returns numeric
language sql immutable as $$
  select case t when 'soldier' then 1 when 'tank' then 5 when 'jet' then 3 when 'warship' then 2 else 1 end;
$$;

-- Neutral garrison soldiers — MUST match src/war/neutral.js (h = (h*31+code)>>>0; 50 + h%251).
create or replace function public.war_neutral_soldiers(rid text) returns integer
language plpgsql immutable as $$
declare h bigint := 0; i int;
begin
  for i in 1..length(rid) loop
    h := (h * 31 + ascii(substr(rid, i, 1))) % 4294967296;
  end loop;
  return 50 + (h % 251)::int;
end;
$$;

-- Collect a player's accrued income vault into their wallet; also stamps activity.
create or replace function public.war_collect_income() returns integer
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select vault into v from public.war_players where user_id = uid for update;
  if v is null then
    update public.war_players set last_active_at = now() where user_id = uid;
    return 0;
  end if;
  update public.war_players set vault = 0, last_active_at = now() where user_id = uid;
  if v > 0 then update public.wallets set balance = balance + v where user_id = uid; end if;
  return v;
end;
$$;

-- The world tick: resolve due movements, then accrue capped income, then refresh is_alive.
create or replace function public.war_tick() returns void
language plpgsql security definer set search_path = public as $$
declare
  mv          record;
  dest        record;
  atk_lab     int;
  attack_mult numeric;
  unit_str    numeric;
  a_str       numeric;
  d_str       numeric;
  def_bunker  int;
  def_aa      int;
  def_mult    numeric;
  aa          numeric;
  def_shield  timestamptz;
  def_active  timestamptz;
  surv        int;
  ratio       numeric;
  def_raw     numeric;
  loot        int;
  aname       text;
  acolor      text;
begin
  -- 1) Resolve arrivals (oldest first; skip rows another tick already grabbed).
  for mv in
    select * from public.war_movements
    where status = 'moving' and arrives_at <= now()
    order by arrives_at
    for update skip locked
  loop
    update public.war_movements set status = 'arrived' where id = mv.id;

    select display_name, color into aname, acolor from public.war_players where user_id = mv.player_id;
    select coalesce(sum(level), 0) into atk_lab from public.war_buildings where owner_id = mv.player_id and type = 'lab';
    attack_mult := 1 + 0.1 * atk_lab;
    unit_str := public.war_unit_strength(mv.unit_type);
    a_str := mv.count * unit_str * attack_mult;

    select * into dest from public.war_regions where region_id = mv.to_region for update;

    if not found or dest.owner_id is null then
      ------------------------------------------------- unclaimed: fight the garrison
      d_str := public.war_neutral_soldiers(mv.to_region); -- soldiers, strength 1
      if a_str > d_str then
        surv := floor(mv.count * (a_str - d_str) / a_str);
        insert into public.war_regions(region_id, owner_id, owner_name, color, is_hq, soldier, tank, jet, warship, updated_at)
        values (mv.to_region, mv.player_id, aname, acolor, false, 0, 0, 0, 0, now())
        on conflict (region_id) do update
          set owner_id = excluded.owner_id, owner_name = excluded.owner_name, color = excluded.color,
              is_hq = false, soldier = 0, tank = 0, jet = 0, warship = 0, updated_at = now();
        execute format('update public.war_regions set %I = %s, updated_at = now() where region_id = %L',
                       mv.unit_type, surv, mv.to_region);
      end if; -- else: attack failed, units lost

    elsif dest.owner_id = mv.player_id then
      ------------------------------------------------- reinforce own province
      execute format('update public.war_regions set %I = %I + %s, updated_at = now() where region_id = %L',
                     mv.unit_type, mv.unit_type, mv.count, mv.to_region);

    else
      ------------------------------------------------- enemy province
      select shield_until, last_active_at into def_shield, def_active
      from public.war_players where user_id = dest.owner_id;

      if def_shield is not null and def_shield > now() then
        -- shielded: bounce the units back home, no combat
        execute format('update public.war_regions set %I = %I + %s, updated_at = now() where region_id = %L',
                       mv.unit_type, mv.unit_type, mv.count, mv.from_region);
      else
        select coalesce(sum(level), 0) into def_bunker from public.war_buildings where region_id = mv.to_region and type = 'bunker';
        select coalesce(sum(level), 0) into def_aa     from public.war_buildings where region_id = mv.to_region and type = 'antiair';
        def_mult := 1 + 0.5 * def_bunker;
        -- offline dug-in bonus: inactive > 24h defends 50% harder
        if def_active is null or def_active < now() - interval '24 hours' then def_mult := def_mult * 1.5; end if;
        aa := least(0.75, 0.25 * def_aa);
        if mv.unit_type = 'jet' then a_str := a_str * (1 - aa); end if;

        def_raw := dest.soldier * 1 + dest.tank * 5 + dest.jet * 3 + dest.warship * 2;
        d_str := def_raw * def_mult;

        if a_str > d_str then
          -- capture: attacker survivors (single unit type), spoils, building downgrade
          surv := floor(mv.count * (a_str - d_str) / a_str);
          loot := floor(0.8 * def_raw * 5); -- lootFraction(full kill)=0.8 × defStrength × COIN_PER_STRENGTH(5)
          if loot > 0 then update public.wallets set balance = balance + loot where user_id = mv.player_id; end if;
          delete from public.war_buildings where region_id = mv.to_region and level <= 1;
          update public.war_buildings set level = level - 1, owner_id = mv.player_id where region_id = mv.to_region and level > 1;
          update public.war_regions
            set owner_id = mv.player_id, owner_name = aname, color = acolor, is_hq = false,
                soldier = 0, tank = 0, jet = 0, warship = 0, updated_at = now()
          where region_id = mv.to_region;
          execute format('update public.war_regions set %I = %s, updated_at = now() where region_id = %L',
                         mv.unit_type, surv, mv.to_region);
        else
          -- defender holds: scale survivors down
          ratio := (d_str - a_str) / d_str;
          update public.war_regions
            set soldier = floor(soldier * ratio), tank = floor(tank * ratio),
                jet = floor(jet * ratio), warship = floor(warship * ratio), updated_at = now()
          where region_id = mv.to_region;
        end if;
      end if;
    end if;
  end loop;

  -- 2) Accrue capped income into each player's vault (cap ≈ 10h of bank income).
  update public.war_players p set
    vault = least(
      p.vault + floor(
        (select coalesce(sum(level), 0) from public.war_buildings b where b.owner_id = p.user_id and b.type = 'bank')
        * 50 * (extract(epoch from (now() - p.last_income_at)) / 3600.0)
      ),
      (select coalesce(sum(level), 0) from public.war_buildings b where b.owner_id = p.user_id and b.type = 'bank') * 50 * 10
    )::int,
    last_income_at = now();

  -- 3) Refresh alive flag (no regions left = not alive, can respawn by buying).
  update public.war_players p set
    is_alive = exists (select 1 from public.war_regions r where r.owner_id = p.user_id);
end;
$$;
```

- [ ] **Step 2: Apply the migration**

Run it by hand in the Supabase SQL editor. Verify the functions exist:
`select proname from pg_proc where proname in ('war_tick','war_collect_income','war_neutral_soldiers','war_unit_strength');`
Expected: four rows.

- [ ] **Step 3: Test the tick with crafted rows (critical)**

In the SQL editor, with two real `auth.users` ids `:A` and `:B`:
```sql
-- seed: A owns X with 100 soldiers; B sends 60 soldiers from Y to X, already due.
insert into war_players(user_id,display_name,color) values (:A,'A','#ef4444'),(:B,'B','#3b82f6') on conflict do nothing;
insert into war_regions(region_id,owner_id,owner_name,color,is_hq,soldier) values ('X',:A,'A','#ef4444',true,100) on conflict (region_id) do update set soldier=100,owner_id=:A;
insert into war_regions(region_id,owner_id,owner_name,color,is_hq,soldier) values ('Y',:B,'B','#3b82f6',true,0) on conflict (region_id) do update set soldier=0,owner_id=:B;
insert into war_movements(player_id,from_region,to_region,unit_type,count,mode,arrives_at)
  values (:B,'Y','X','soldier',60,'land', now() - interval '1 minute');
select war_tick();
select region_id, owner_id, soldier from war_regions where region_id='X';
```
Expected: `X` still owned by `:A` with ~40 soldiers (100 def > 60 atk → defender holds, survivors floor(100·(100−60)/100)=40). Then test an attacker win (atk 150 vs 100 → X flips to `:B` with floor(150·50/150)=50). Then test a shield (`update war_players set shield_until = now()+interval '1 day' where user_id=:A;` → the same attack should bounce back to `Y`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/023_war_tick.sql
git commit -m "feat(db): war_tick() server resolution + income vault + collect RPC"
```

---

## Task 4: Schedule the tick + tighten RLS to server-authoritative

**Files:**
- Create: `supabase/migrations/024_war_cron_and_rls.sql`

- [ ] **Step 1: Write `supabase/migrations/024_war_cron_and_rls.sql`**

```sql
-- Migration 024: schedule war_tick + lock down client writes. Idempotent.

-- pg_cron (enable in Supabase: Database → Extensions → pg_cron, or:)
create extension if not exists pg_cron;

-- (Re)schedule the tick once per minute.
select cron.unschedule('war-tick') where exists (select 1 from cron.job where jobname = 'war-tick');
select cron.schedule('war-tick', '* * * * *', $$ select public.war_tick(); $$);

-- Tighten war_regions: clients may only write their OWN regions now
-- (spawn, buying units, decrementing on send). The tick (SECURITY DEFINER) does
-- all cross-player writes (capture, combat, reinforce-on-arrival).
drop policy if exists "war_regions_insert" on public.war_regions;
drop policy if exists "war_regions_update" on public.war_regions;
create policy "war_regions_insert" on public.war_regions for insert with check (owner_id = auth.uid());
create policy "war_regions_update" on public.war_regions for update using (owner_id = auth.uid());

-- Tighten war_buildings to owner-only (build/upgrade your own; tick handles capture).
drop policy if exists "war_buildings_insert" on public.war_buildings;
drop policy if exists "war_buildings_update" on public.war_buildings;
drop policy if exists "war_buildings_delete" on public.war_buildings;
create policy "war_buildings_insert" on public.war_buildings for insert with check (owner_id = auth.uid());
create policy "war_buildings_update" on public.war_buildings for update using (owner_id = auth.uid());
create policy "war_buildings_delete" on public.war_buildings for delete using (owner_id = auth.uid());
```

- [ ] **Step 2: Apply + verify the schedule**

Run by hand. Verify: `select jobname, schedule from cron.job where jobname='war-tick';` returns one row. Watch it run: `select * from cron.job_run_details order by start_time desc limit 3;` should show recent successful runs.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/024_war_cron_and_rls.sql
git commit -m "feat(db): schedule war_tick via pg_cron + server-authoritative RLS"
```

---

## Task 5: Make the client server-authoritative + collect income

Remove client-side combat resolution; rely on the tick + realtime. Collect income on load and periodically. Set the new-player shield on spawn.

**Files:**
- Modify: `src/pages/WarPage.jsx`

- [ ] **Step 1: Remove client resolution**

Delete the entire `resolveMovements` `useCallback` and the `useEffect(() => { const id = setInterval(resolveMovements, 4000); ... })` that calls it. Also remove now-unused imports that were only used there (`neutralGarrison`, `lootFraction`, `lootCoins`, and `resolveCombat`/`stackFromRow`/`stackStrength`/`stackTotal` if nothing else references them — check with the build in Step 5 and prune what the build flags as unused).

- [ ] **Step 2: Set the new-player shield on spawn**

In the spawn effect's `war_players` insert, add a 48h shield:

```js
      await supabase.from('war_players').insert({
        user_id: userId, display_name: userName, color, spawn_region: spawn,
        shield_until: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      })
```

- [ ] **Step 3: Collect income + stamp activity**

Add a hook near the other effects:

```js
  // Pull accrued income into the wallet on load + every 60s; also stamps last_active_at.
  const { loadBalance } = useCasino() // add loadBalance to the destructure at the top of WarGame
  useEffect(() => {
    if (!userId) return
    let alive = true
    const collect = async () => {
      const { data, error } = await supabase.rpc('war_collect_income')
      if (!alive || error) return
      if (data && data > 0) { showFlash(`+${data.toLocaleString()} coins (income)`); loadBalance() }
    }
    collect()
    const id = setInterval(collect, 60000)
    return () => { alive = false; clearInterval(id) }
  }, [userId, loadBalance])
```

(Update the `const { balance, adjustBalance } = useCasino()` line to also pull `loadBalance`.)

- [ ] **Step 4: Block targeting shielded enemies in `onRegionClick`**

Compute a shielded-owner set and refuse to open a move against it:

```js
  const shieldedOwners = new Set(
    players.filter((p) => p.shield_until && new Date(p.shield_until) > new Date()).map((p) => p.user_id)
  )
```

In `onRegionClick`, before opening the move modal, add:

```js
    const targetRow = regions[regionId]
    if (targetRow?.owner_id && targetRow.owner_id !== userId && shieldedOwners.has(targetRow.owner_id)) {
      showFlash('That player is shielded — you can\'t attack yet.')
      return
    }
```

- [ ] **Step 5: Verify build + tests**

Run: `npm run build && node --test src/war/`
Expected: build succeeds (prune unused imports if it complains); tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/pages/WarPage.jsx
git commit -m "feat(war): server-authoritative client + income collection + shields"
```

---

## Task 6: Long-game balancing simulation (TDD-style sanity script)

A no-deps Node script that uses the real `buildings.js` numbers to confirm the climb takes weeks/months, not hours.

**Files:**
- Create: `scripts/war-balance-sim.mjs`

- [ ] **Step 1: Write `scripts/war-balance-sim.mjs`**

```js
// Sanity-check the idle economy. Run: node scripts/war-balance-sim.mjs
import { buildingCost, incomePerTick, INCOME_PER_BANK_LEVEL_PER_HOUR } from '../src/war/buildings.js'

// Cost to take one bank from nothing to Lv 3.
const bankToMax = buildingCost('bank', 0) + buildingCost('bank', 1) + buildingCost('bank', 2)
// Income at Lv 3 per real hour (collected, no offline cap).
const lv3PerHour = incomePerTick([{ type: 'bank', level: 3 }], 3600)

const hoursToPayback = bankToMax / lv3PerHour
console.log('Bank Lv1→3 total cost:', bankToMax, 'coins')
console.log('Lv3 income/hour:', lv3PerHour, 'coins  (', INCOME_PER_BANK_LEVEL_PER_HOUR, '/level/hr )')
console.log('Hours of income to pay back one maxed bank:', hoursToPayback.toFixed(1))
console.log('Days (8h active/day):', (hoursToPayback / 8).toFixed(1))

// Crude "empire" curve: N maxed banks, collected ~8h/day, time to a 1,000,000 war chest.
for (const banks of [1, 5, 20]) {
  const perDay = lv3PerHour * banks * 8
  console.log(`${banks} maxed banks → ~${perDay.toLocaleString()}/day → ${(1_000_000 / perDay).toFixed(0)} days to 1M`)
}
```

- [ ] **Step 2: Run it and eyeball the curve**

Run: `node scripts/war-balance-sim.mjs`
Expected: prints a payback in the tens of hours and multi-week timelines to a large war chest. If it reads as "hours not weeks," bump `INCOME_PER_BANK_LEVEL_PER_HOUR` down or building costs up in `src/war/buildings.js` and re-run. (Tuning, not a hard pass/fail.)

- [ ] **Step 3: Commit**

```bash
git add scripts/war-balance-sim.mjs
git commit -m "chore(war): idle economy balancing sim"
```

---

## Task 7: Docs + manual verification

**Files:**
- Modify: `docs/DATABASE.md`, `CLAUDE.md`

- [ ] **Step 1: Document the server tick in `docs/DATABASE.md`**

Add: `war_players.vault`/`last_active_at`; the functions `war_tick()`, `war_collect_income()`, `war_unit_strength()`, `war_neutral_soldiers()`; the `pg_cron` `war-tick` schedule; that `war_regions`/`war_buildings` writes are now **owner-only** with the tick doing cross-player writes; migrations `022`–`024`. Note the unit strengths + neutral-garrison formula are duplicated in SQL and `src/war/` and must stay in sync.

- [ ] **Step 2: Update `CLAUDE.md`**

The repo's `CLAUDE.md` §4 says the casino/war is client-authoritative and §6 says CP War is disabled. Update both: CP War is **enabled** and its combat/income are now **server-authoritative via `war_tick()` (`pg_cron`)** — the first server-side game logic in the app; the casino remains client-side. Add a row to the "Where to make common changes" table: "Tune war balance → `src/war/units.js` / `buildings.js`; combat/income live in `supabase/migrations/023_war_tick.sql` (keep constants in sync)."

- [ ] **Step 3: Commit**

```bash
git add docs/DATABASE.md CLAUDE.md
git commit -m "docs(war): document Phase 3 server tick + authority change"
```

- [ ] **Step 4: Manual end-to-end walkthrough** (`npm run dev`, two accounts; temporarily shorten `travelSeconds` for testing)

- [ ] Send an attack, then **close all browsers**; wait past the timer; reopen — the movement resolved **while offline** (the tick did it), state is correct.
- [ ] Build banks; leave; return later → a **"+N coins (income)"** flash, wallet increased; confirm the vault **caps** (being away a very long time doesn't pay more than ~10h).
- [ ] Attacking a **shielded** (new) player is refused in the UI; if forced via a stale movement, the tick **bounces** the units home.
- [ ] An **inactive** defender's province is meaningfully harder to take (dug-in bonus).
- [ ] Confirm a client can no longer write someone else's region directly (RLS): attempting `supabase.from('war_regions').update(...)` on an enemy region from the console is rejected.
- [ ] `npm run build` passes; `node --test src/war/` passes; `node scripts/war-balance-sim.mjs` reads as weeks/months.
- [ ] **Restore the production `travelSeconds`** (Task 1) before shipping.

---

## Self-review notes (for the implementer)

- **Spec coverage (Phase 3):** scheduled server tick (income + combat overnight) ✓ (Tasks 3–4); server-authoritative + tightened RLS ✓ (Tasks 4–5); capped income vault / anti-AFK ✓ (Task 3 income block + cap); shields (new-player + offline dug-in) ✓ (Tasks 3, 5); slow timers ✓ (Task 1); balancing ✓ (Task 6). Seasons/resets and push notifications remain **future** (spec "Future ideas") — not built.
- **Highest risk = `war_tick()` (Task 3).** It re-implements the JS combat/spoils/income math in PL/pgSQL. The Step 3 crafted-row tests are not optional — verify defender-holds, attacker-capture, and shield-bounce before scheduling it. Watch `cron.job_run_details` for errors after Task 4.
- **Constants are duplicated by necessity.** Unit strengths (`war_unit_strength`), the neutral-garrison hash (`war_neutral_soldiers`), bank income rate (50/level/hr), loot (0.8 × strength × 5), and building multipliers exist in BOTH `src/war/*.js` and `023_war_tick.sql`. The docs (Task 7) call this out; changing one means changing the other.
- **Authority change is intentional and documented** (Task 7 updates `CLAUDE.md` §4/§6). Clients now only write their own rows; everything cross-player flows through the definer functions. This closes the tamper gap the old client-authoritative war had.
- **Simplifications kept from Phase 2:** loot is credited to the attacker without debiting the defender's (shared casino) wallet; a failed attack loses its in-transit units. Both are acceptable for a friends-and-family game and are easy to revisit.
```

# Database & Backend (Supabase)

CP Studios has no application server. The React client talks directly to Supabase, and most
access control is enforced by Postgres **Row-Level Security (RLS)** policies plus a couple of
`SECURITY DEFINER` RPC functions. This document describes the schema, the storage bucket, the
policies, and the setup steps.

> ⚠️ **Important:** a few rules the product *appears* to enforce — most notably the
> member-approval gate — are currently checked **only in the client**, not in RLS. Before
> relying on any access rule, confirm a policy actually enforces it. See
> [Security limitations & known gaps](#security-limitations--known-gaps).

All schema is defined in [`../supabase/migrations/`](../supabase/migrations/) as numbered SQL
files (`001`–`029`). There is no migration runner — run them by hand in the Supabase
**SQL Editor**, in order. Migration `024` also needs the **`pg_cron`** extension enabled
(Database → Extensions) to schedule the CP War server tick.

---

## Setup checklist

1. Create a Supabase project; copy the Project URL and anon key into `.env.local`
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
2. Run migrations `001` → `029` in order in the SQL Editor. Enable the `pg_cron` extension
   (Database → Extensions) before/with `024` so the CP War `war-tick` job can be scheduled.
3. Confirm the public storage bucket `cp-studios` exists (migration `001` creates it).
4. Enable **Realtime** on the tables that need it (some are enabled in SQL, others must be
   toggled in **Database → Replication**):
   - `messages` — enabled in migration `003`.
   - `likes`, `comments` — required for live photo reactions (commented hint in `001`).
   - `war_regions`, `war_players`, `war_movements` — required for CP War (commented hint in `019`).
   - `war_buildings` — required for CP War buildings (commented hint in `021`).
   - `war_events` — added to the `supabase_realtime` publication in migration `025`; confirm it is enabled in **Database → Replication** so clients receive live event toasts.
5. Make sure an account exists with the **admin email** (see [Admin model](#admin-model)).

---

## Admin model

There is exactly one admin, identified by a hardcoded email address. The same email appears:

- In the frontend as `ADMIN_EMAIL` in `src/context/AppContext.jsx`.
- In several RLS policies as `(auth.jwt() ->> 'email') = '<admin email>'`.

Both must reference the same address. Changing the admin means editing the constant **and**
every policy that embeds the email (in migrations `001`, `002`, and any later ones).

---

## Tables

### Core: photos & people

#### `profiles`
A "person" in the gallery (not necessarily a 1:1 with an auth user — anyone can add a profile
for a family member).

| Column       | Type          | Notes                                              |
|--------------|---------------|----------------------------------------------------|
| `id`         | uuid PK       | default `gen_random_uuid()`                        |
| `user_id`    | uuid          | FK → `auth.users` (`on delete set null`); often NULL in practice |
| `full_name`  | text          | unique **case-insensitively** (index in `010`)     |
| `bio`        | text          | default `''`                                       |
| `avatar_url` | text          | default `''`                                       |
| `created_at` | timestamptz   | default `now()`                                    |

RLS: any authenticated user can `select` and `insert`; owner (`auth.uid() = user_id`) can
`update`; **admin** can `delete`. (The read policy was rewritten in `008`/`009` to the working
`auth.role() = 'authenticated'` form.)

#### `photos`
| Column        | Type        | Notes                                        |
|---------------|-------------|----------------------------------------------|
| `id`          | uuid PK     |                                              |
| `profile_id`  | uuid        | FK → `profiles` (`on delete cascade`)        |
| `uploader_id` | uuid        | FK → `auth.users` (`on delete set null`)     |
| `image_url`   | text        | public Storage URL                           |
| `caption`     | text        | default `''`                                 |
| `created_at`  | timestamptz | default `now()`                              |

RLS: authenticated can `select`/`insert`; **uploader or admin** can `delete` (migration `002`).

#### `likes`
One row per (photo, user); `unique (photo_id, user_id)`. Authenticated can read; a user can
insert/delete only their own like.

#### `comments`
A comment on a photo (`photo_id`, `user_id`, `content`). Authenticated can read; a user can
insert/delete only their own.

#### `comments_with_author` (view)
Resolves a display author name for each comment: the commenter's `profiles.full_name`, else
the email local-part, else `'Unknown'`. The client reads comments through this view so it can
show names without extra joins.

### Membership / access control

#### `pending_users`
The approval queue. **Note:** despite the intent, this is *not* enforced as the source of truth
for data access — no other table's RLS consults `status`. The pending/rejected gate lives in the
client (`AppContext.login`), so any user who holds a valid Supabase session can still read/write
the `authenticated`-gated tables directly. See
[Security limitations & known gaps](#security-limitations--known-gaps).

| Column       | Type        | Notes                                                  |
|--------------|-------------|--------------------------------------------------------|
| `id`         | uuid PK     |                                                        |
| `user_id`    | uuid UNIQUE | FK → `auth.users` (`on delete cascade`)                |
| `email`      | text        |                                                        |
| `username`   | text        | default `''` — the most reliable name source           |
| `status`     | text        | `pending` \| `approved` \| `rejected` (default pending)|
| `created_at` | timestamptz | default `now()`                                        |

RLS: a user may self-insert their own row and read their own row; the **admin** can read,
update, and delete all rows. Approve/reject/revoke = updating `status`.

#### `username_changes`
Rate-limit log for renames — one row per change. The Navbar enforces **max 3 changes per 24h**
by counting recent rows. A user can read/insert only their own rows.

### Casino

#### `wallets`
One coin wallet per user. Created lazily on first casino visit (and backfilled for existing
approved users in migration `013`).

| Column             | Type        | Notes                                            |
|--------------------|-------------|--------------------------------------------------|
| `id`               | uuid PK     |                                                  |
| `user_id`          | uuid UNIQUE | FK → `auth.users` (`on delete cascade`)          |
| `balance`          | integer     | default `1000`                                   |
| `last_daily_bonus` | timestamptz | added in `006`; drives the +100/24h bonus        |
| `display_name`     | text        | added in `012`; denormalized name for leaderboard/gifting |
| `created_at`       | timestamptz | default `now()`                                  |

RLS: **any authenticated user can read all wallets** (for the leaderboard) — note this uses the
working `auth.role() = 'authenticated'` form after migration `014`. A user can insert/update
only their own wallet. (Migration `016` is a one-off reset of all balances to 1000.)

> Because direct wallet updates are limited to your own row, **coin gifting cannot be a plain
> client update** — it goes through the `donate_coins` RPC (below).

#### `game_history`
Append-only log of bets: `game`, `bet`, `result` (`win`|`loss`|`push`), `payout`. A user can
read/insert only their own rows.

#### `donations`
Audit log of coin transfers (`sender_id`, `recipient_id`, `amount`). Participants can read
their own; only the sender can insert. Written by the `donate_coins` RPC.

### CP War (migration `019` — v2 province schema)

Migration `019_cp_war_v2.sql` **dropped** the hex-grid tables from `015`
(`war_tiles`, and the hex-era `war_players`/`war_movements`) and recreated all three tables
for real-world provinces keyed by Natural Earth `adm1_code`.

#### `war_players`
One row per enrolled player.

| Column           | Type        | Notes                                                      |
|------------------|-------------|------------------------------------------------------------|
| `user_id`        | uuid PK     | FK → `auth.users` (`on delete cascade`)                    |
| `display_name`   | text        |                                                            |
| `color`          | text        | hex colour string assigned at spawn                        |
| `spawn_region`   | text        | `region_id` of the player's HQ province                   |
| `season_id`      | integer     | default `1`                                                |
| `is_alive`       | boolean     | default `true`                                             |
| `shield_until`   | timestamptz | nullable; post-spawn (48h) attack-immunity expiry          |
| `last_income_at` | timestamptz | default `now()`; last time the tick accrued bank income    |
| `vault`          | integer     | default `0` (migration `022`); accrued, uncollected income |
| `last_active_at` | timestamptz | default `now()` (migration `022`); stamped on income collect; drives the offline dug-in defence bonus |
| `created_at`     | timestamptz | default `now()`                                            |

RLS: any authenticated user can `select`. As of migration `028`, `INSERT` and broad `UPDATE`
are **revoked** from `authenticated`; only `UPDATE (display_name, color, spawn_region)` is
granted back. Clients can no longer set or extend `shield_until` directly (closes the
self-shield exploit). Spawn goes through the `war_spawn()` RPC (below); vault and activity
columns are written only by SECURITY DEFINER functions.

#### `war_regions`
The map. One row per province (populated lazily as players claim territory).

| Column       | Type        | Notes                                                             |
|--------------|-------------|-------------------------------------------------------------------|
| `region_id`  | text PK     | = `adm1_code` from `public/war/provinces.json`                    |
| `country_code`| text       |                                                                   |
| `owner_id`   | uuid        | FK → `auth.users` (`on delete set null`); nullable = neutral      |
| `owner_name` | text        |                                                                   |
| `color`      | text        |                                                                   |
| `is_hq`      | boolean     | default `false`; true for the owner's capital province            |
| `soldier`    | integer     | default `0`; units of this type present in the province           |
| `tank`       | integer     | default `0`                                                       |
| `jet`        | integer     | default `0`                                                       |
| `warship`    | integer     | default `0` (added in migration `020`)                            |
| `updated_at` | timestamptz | default `now()`                                                   |

RLS: any authenticated user can `select`. As of Phase 3 (migration `024`) `insert`/`update`
are **owner-only** (`owner_id = auth.uid()`) — a client may only write its own provinces
(spawn, buying units, decrementing on send). All cross-player writes (capture, combat,
reinforce-on-arrival) are done by the SECURITY DEFINER `war_tick()` function. (Phases 1–2 used
broad-authenticated write because combat resolved client-side.)

#### `war_movements`
In-flight unit movements between provinces.

| Column        | Type        | Notes                                                       |
|---------------|-------------|-------------------------------------------------------------|
| `id`          | uuid PK     | default `gen_random_uuid()`                                 |
| `player_id`   | uuid        | FK → `auth.users` (`on delete cascade`)                     |
| `from_region` | text        | source `region_id`                                          |
| `to_region`   | text        | destination `region_id`                                     |
| `unit_type`   | text        | `soldier` \| `tank` \| `jet` \| `warship` (migration `020`) |
| `count`       | integer     |                                                             |
| `mode`        | text        | `land` \| `air` \| `sea` (migration `020`)                  |
| `status`      | text        | `moving` \| `arrived` \| `cancelled` (default `moving`)     |
| `arrives_at`  | timestamptz |                                                             |
| `created_at`  | timestamptz | default `now()`                                             |

RLS: any authenticated user can `select`; a player can `insert`/`update` only their own rows
(`auth.uid() = player_id`; the `update` policy was tightened from broad-authenticated to
owner-only in migration `024`). Movement resolution is done **server-side** by `war_tick()`
(migration `023`); the client only inserts movements.

**`units` jsonb column (migration `026`):** movements now carry a mixed unit stack
`{soldier, tank, jet, warship}` in `units jsonb` (default `{}`). The legacy `unit_type` (text)
and `count` (integer) columns remain but are nullable and no longer used by the server tick
(kept for backward-compatibility). The tick reads `units` exclusively and resolves the whole
mixed stack as one combined force. Warships ferry land units (capacity 20 land units per
warship). New helper: `war_stack_strength(jsonb)` — pure, immutable SQL function; mirrors
`war_unit_strength()` and `src/war/combat.js#stackStrength`.

#### `war_events` (migration `025`)
Activity log: one row per notable game event written by the server tick.

| Column      | Type        | Notes                                                                   |
|-------------|-------------|-------------------------------------------------------------------------|
| `id`        | bigint PK   | generated always as identity                                            |
| `created_at`| timestamptz | default `now()`                                                         |
| `player_id` | uuid        | FK → `auth.users` (`on delete cascade`); the affected player            |
| `kind`      | text        | `captured` \| `lost` \| `defended` \| `attack_failed` \| `bounced` \| `eliminated` |
| `region_id` | text        | nullable; the province the event concerns                               |
| `detail`    | jsonb       | default `{}`; extra context (e.g. `{coins, opponent, neutral}`)         |

RLS: `SELECT` only your own rows (`player_id = auth.uid()`). No client insert/update/delete —
the table is written exclusively by the SECURITY DEFINER tick via `war_log_event(p_player,
p_kind, p_region, p_detail)`. Added to the `supabase_realtime` publication in migration `025`;
clients subscribe filtered by `player_id` to receive live toast notifications. The tick prunes
rows older than 7 days.

#### `war_buildings` (migration `021`)
Structures placed on a province (max 3 slots per province). Defence buildings (`bunker`,
`antiair`) affect only their region; economy buildings (`factory`, `lab`, `bank`) give a
**global** bonus to the owner but sit on one province — when that province is captured they
**transfer + downgrade** by one level (deleted at level 1) rather than being destroyed.

| Column       | Type        | Notes                                                              |
|--------------|-------------|--------------------------------------------------------------------|
| `id`         | uuid PK     | default `gen_random_uuid()`                                        |
| `region_id`  | text        | FK → `war_regions(region_id)` (`on delete cascade`)                |
| `owner_id`   | uuid        | FK → `auth.users` (`on delete set null`)                           |
| `type`       | text        | `bunker` \| `antiair` \| `factory` \| `lab` \| `bank`              |
| `level`      | integer     | `1`–`3` (check constraint); cost rises per level                   |
| `created_at` | timestamptz | default `now()`                                                    |

Effects (mirrored in `src/war/buildings.js`): **bunker** +50%/level defender strength;
**antiair** removes 25%/level of incoming jet strength (cap 75%); **factory** −10%/level troop
cost (floor 40%); **lab** +10%/level troop strength; **bank** passive income (50 coins/level/hr,
paid by the Phase 3 server tick). RLS: `insert`/`update`/`delete` are **owner-only** as of
migration `024` (Phases 2 used broad-authenticated write while the client resolved capture).
Enable Realtime for `war_buildings`.

### CP War server tick (Phase 3 — migrations `022`–`024`)

As of Phase 3, CP War combat and income are **server-authoritative** — the first server-side
game logic in this app (the casino remains client-side). A `pg_cron` job runs `war_tick()`
once per minute; clients only write their own rows and read realtime state.

Functions (all `SECURITY DEFINER` except the two pure helpers):

| Function                       | Purpose                                                                 |
|--------------------------------|-------------------------------------------------------------------------|
| `war_tick()`                   | Resolves every due `war_movements` row (move-in vs neutral garrison, reinforce, or combat with building modifiers + shields + offline dug-in bonus + capture spoils), then accrues capped income into each player's `vault`, then recomputes `is_alive`. Scheduled by `pg_cron` (`war-tick`, `* * * * *`). |
| `war_collect_income()`         | Moves a player's accrued `vault` into their `wallets.balance`, zeroes the vault, stamps `last_active_at`. Called by the client on load + every 60s. Returns the collected amount. |
| `war_unit_strength(text)`      | Pure: unit strength (soldier 1 / tank 5 / jet 3 / warship 2).           |
| `war_neutral_soldiers(text)`   | Pure: deterministic neutral-garrison size (50–300) for an unclaimed region. |

**Duplicated constants (must stay in sync):** unit strengths, the neutral-garrison hash
(`h = (h*31 + ascii) mod 2^32; 50 + h%251`), the bank income rate (50 coins/level/hr), the
vault cap (10h), the loot formula (`0.8 × defenderStrength × 5`), and the building multipliers
all live in BOTH `src/war/*.js` and `023_war_tick.sql`. Changing one means changing the other.
(The JS combat/spoils/neutral modules are retained for unit tests + reference even though the
client no longer resolves combat.)

Income vault never decreases if a player loses all banks (cap drops but accrued coins survive
until collected); attacker/held survivors are floored to ≥1 unit (no 0-unit "ghost" provinces);
a shielded defender bounces incoming units home only if the origin is still owned by the sender.

### CP War 2.1 — engagement/balance pass (migrations `025`–`028`)

#### Combat v2 — mixed stacks + RNG (migration `026`)
`war_tick()` is rewritten to resolve a mixed unit stack (`war_movements.units jsonb`) rather
than a single unit type. Each side's raw strength is multiplied by an independent ±15% RNG
factor (`effective = strength × (0.85 + random() × 0.30)`) before comparing. On a successful
attack, survivors of each unit type are scaled by `(a_eff − d_eff) / a_eff`. On a failed
attack, 25% of each attacker unit type retreats to the origin province (if still owned by the
sender); the rest are lost. Warships ferry land units (capacity 20 land units per warship).

New helper: `war_stack_strength(s jsonb) → numeric` — immutable; computes
`soldier×1 + tank×5 + jet×3 + warship×2` for a jsonb stack.

#### Per-province income (migration `027`)
The income accrual formula is updated: **rate = `banks_level_sum × 50 + province_count × 10`
coins/hr**; vault cap = `rate × 10h`. The 10 coins/hr/province term is additive with bank
income (unchanged at 50/level/hr). Players with no banks and no provinces have
`last_income_at` advanced to `now()` so that acquiring territory later doesn't pay retroactive
back-income.

#### `war_spawn(p_region, p_country, p_color, p_name)` RPC (migration `028`)
SECURITY DEFINER; granted to `authenticated`. Atomically creates the `war_players` row and
the spawn province in `war_regions` (500 soldiers, `is_hq = true`), and sets `shield_until =
now() + 48h`. Idempotent: if the player already has a `spawn_region`, returns it immediately
without re-inserting. Raises `'region taken'` if the chosen province already has an owner.
Clients call `supabase.rpc('war_spawn', ...)` instead of a direct insert.

**Column lockdown (`028`):** `INSERT` and broad `UPDATE` are revoked from `authenticated` on
`war_players`; only `UPDATE (display_name, color, spawn_region)` is granted back. This means
clients can no longer set or extend `shield_until` — the self-shield exploit is closed.
`war_spawn`, `war_collect_income`, and `war_tick` run as the function owner (SECURITY DEFINER)
and are unaffected by this revoke.

#### Tunable constants (JS ↔ SQL parity)
The following constants appear in both the migration SQL and `src/war/*.js`, and are enforced
to match by `src/war/parity.test.js`:

| Constant                | Value      | SQL location  | JS location            |
|-------------------------|------------|---------------|------------------------|
| RNG band                | 0.85–1.15  | `026`/`027`   | `combat.js` RNG_MIN/RNG_SPAN |
| Retreat fraction        | 0.25       | `026`/`027`   | `combat.js` RETREAT_FRACTION |
| Per-province income     | 10/hr      | `027`         | `buildings.js`         |
| Bank income rate        | 50/level/hr| `023`–`027`   | `buildings.js`         |
| Vault cap multiplier    | 10h        | `023`–`027`   | `buildings.js`         |
| Warship land capacity   | 20         | `026`/`027`   | `units.js`             |
| Tank cost (client-only) | 400        | —             | `units.js`             |

`src/war/parity.test.js` parses the migration SQL and asserts these values match the JS
constants. Run `node --test src/war/*.test.js` to verify after changing either side.

### Direct messages (migration `018`)

#### `dm_threads`
One row per unique pair of users. `user_lo` / `user_hi` are the two participants stored in
ascending UUID order (`user_lo < user_hi`), enforced by a `CHECK` constraint. This ordering
guarantee means there is exactly one thread per pair and no duplicates.

| Column           | Type        | Notes                                              |
|------------------|-------------|----------------------------------------------------|
| `id`             | uuid PK     | default `gen_random_uuid()`                        |
| `user_lo`        | uuid        | FK → `auth.users` (`on delete cascade`)            |
| `user_hi`        | uuid        | FK → `auth.users` (`on delete cascade`)            |
| `created_at`     | timestamptz | default `now()`                                    |
| `last_message_at`| timestamptz | bumped automatically by trigger on every new message|

Unique constraint: `(user_lo, user_hi)`. Threads are never created directly by the client —
use the `get_or_create_dm_thread` RPC.

RLS: a participant (`auth.uid() = user_lo or auth.uid() = user_hi`) can `select` their own
threads. No client insert/update/delete — thread creation is handled server-side by the RPC.

#### `direct_messages`
Individual messages within a thread.

| Column        | Type        | Notes                                                      |
|---------------|-------------|------------------------------------------------------------|
| `id`          | uuid PK     | default `gen_random_uuid()`                                |
| `thread_id`   | uuid        | FK → `dm_threads` (`on delete cascade`)                    |
| `sender_id`   | uuid        | FK → `auth.users` (`on delete cascade`)                    |
| `sender_name` | text        | denormalized display name at send time; default `''`       |
| `content`     | text        | message body; nullable if `image_url` is set               |
| `image_url`   | text        | public Storage URL; nullable if `content` is set           |
| `created_at`  | timestamptz | default `now()`                                            |

`CHECK` constraint: at least one of `content` or `image_url` must be non-null.

Index: `(thread_id, created_at)` for efficient pagination within a thread.

RLS (both policies use the `auth.uid()` expression form — not `TO authenticated USING (true)`):
- **select** — participant can read: `exists(select 1 from dm_threads t where t.id = direct_messages.thread_id and (auth.uid() = t.user_lo or auth.uid() = t.user_hi))`.
- **insert** — participant can send: same `exists(...)` check plus `sender_id = auth.uid()`.

#### `trg_bump_dm_thread` trigger
`AFTER INSERT ON direct_messages FOR EACH ROW` — calls the `bump_dm_thread_last_message`
`SECURITY DEFINER` function, which updates `dm_threads.last_message_at` to the new message's
`created_at`. This keeps the thread list sorted by recency without requiring a client-side
update.

---

## RPC functions

These run with `SECURITY DEFINER` (as the function owner) so they can safely bypass per-row
RLS while enforcing their own checks. Granted to the `authenticated` role.

### `donate_coins(p_recipient_id uuid, p_amount integer) → void`  (migration `007`)
Atomically transfers coins between wallets. Validates amount > 0, prevents self-donation,
locks the sender row (`FOR UPDATE`) to avoid races, checks sufficient balance, debits sender,
credits recipient, and logs to `donations`. Raises a descriptive exception on any failure.
Called from the **Send Coins** modal via `supabase.rpc('donate_coins', ...)`.

### `get_wallet_players()` — *removed*
Introduced in `011` to join wallets+profiles for names, then **dropped in `012`** once
`display_name` was denormalized onto `wallets`. Do not reintroduce a profiles join for names.

### `get_or_create_dm_thread(other_user_id uuid) → uuid`  (migration `018`)
Finds or creates the canonical `dm_threads` row for the caller and `other_user_id`. Computes
`user_lo`/`user_hi` from `least`/`greatest`, does an `INSERT … ON CONFLICT DO NOTHING`, then
returns the thread `id`. Raises exceptions for unauthenticated callers or an invalid/self
recipient. Returns: the thread UUID.

### `list_dm_threads() → table`  (migration `018`)
Returns the caller's threads ordered by `last_message_at desc`, each enriched with the other
participant's display name and avatar (read from `auth.users.raw_user_meta_data`) and a
last-message preview. Return columns: `thread_id`, `other_user_id`, `other_name`,
`other_avatar`, `last_content`, `last_image_url`, `last_sender_id`, `last_message_at`.
Reads `auth.users` directly (needs `SECURITY DEFINER`).

### `list_dm_recipients() → table`  (migration `018`)
Returns all users other than the caller who are either approved in `pending_users` or whose
email matches the hardcoded admin addresses. Intended for the compose/new-thread picker.
Return columns: `user_id`, `full_name`, `avatar_url`. Reads `auth.users` and `pending_users`
(needs `SECURITY DEFINER`).

### `war_spawn(p_region text, p_country text, p_color text, p_name text) → text`  (migration `028`)
Creates a new CP War player and their spawn province atomically. Idempotent: returns the
existing `spawn_region` if the player is already enrolled. Raises `'region taken'` if the
target province already has an owner. Sets `shield_until = now() + 48h` on the new player row.
Returns the spawn `region_id`. Granted to `authenticated`; runs `SECURITY DEFINER` so it can
bypass the column-level revoke on `war_players` (clients may no longer insert directly or set
`shield_until`).

---

## Storage

A single **public** bucket, `cp-studios` (created in migration `001`), holds all uploaded
images. Conventional path prefixes:

| Prefix                      | Used by                          |
|-----------------------------|----------------------------------|
| `avatars/<userId>/`         | Profile/user avatars             |
| `photos/<profileId>/`       | Gallery photos                   |
| `chat/<userId>/`            | Images shared in group chat      |
| `dm/<threadId>/`            | Images sent in DM threads        |

Storage policies: authenticated users can upload/update/delete objects in the bucket; reads
are public. `src/lib/storage.js#getStoragePath()` converts a public URL back into the bucket
path so the client can delete the underlying file when a photo/profile is removed.

> **DM images:** images attached to direct messages are stored under `dm/<threadId>/…` in the
> same public bucket. Because the bucket is fully public, anyone who knows (or guesses) the URL
> can fetch the image — there is no per-object access control. This is an accepted trade-off for
> this trusted, friends-and-family app.

> ⚠️ The update/delete policies are named "own objects" but contain **no per-object owner
> check** — any authenticated user can overwrite or delete *any* file in the bucket, and uploads
> are unrestricted by file type/size. See
> [Security limitations & known gaps](#security-limitations--known-gaps).

---

## RLS gotchas (learned the hard way)

The migration history records several real bugs worth remembering:

- **`TO authenticated USING (true)` returns zero rows here.** Use
  `USING (auth.role() = 'authenticated')` instead. (Migrations `009`, `014`.)
- **`profiles.user_id` is frequently NULL**, so any feature that needs a user's display name
  should read `wallets.display_name`, not join through `profiles`. (Migrations `012`, `013`.)
- **Restricted policies leak as fallbacks:** the leaderboard once read `pending_users`, whose
  read policy is owner/admin-only, so everyone showed as "Player". It now reads `wallets`.
  (Migration `008`.)

---

## Security limitations & known gaps

A security review (2026-05) of the RLS policies and the client auth flow found the gaps below.
The two **accepted trade-offs** (hardcoded admin, client-side casino) are intentional for a
private friends-and-family app; everything else is a gap between *intended* and *enforced*
behaviour and would need fixing before this app could be exposed to untrusted users.

| # | Severity | Issue | Where | Suggested fix |
|---|----------|-------|-------|---------------|
| 1 | **High / Critical** | **Member-approval gate is client-side only.** RLS on `profiles`/`photos`/`likes`/`comments` only checks `auth.role() = 'authenticated'`, never `pending_users.status`. Any user with a valid session (sign-up + email confirm) can read/write these tables by calling Supabase directly; **rejected/revoked** users with a live session keep access. Critical if public sign-ups are enabled in the Supabase dashboard; High otherwise. | `AppContext.jsx:95–115`; `001_initial.sql:76–125` | Gate sensitive policies on an `is_approved(auth.uid())` `SECURITY DEFINER` helper that checks `pending_users.status = 'approved'`. For revocation to end live sessions, disable/sign-out the auth user via an Edge Function using the service-role key. |
| 2 | **High** | **Storage objects have no per-object owner check.** The `cp-studios` bucket update/delete policies are named "own objects" but only check `authenticated`, so any member can overwrite/delete *any* file. Uploads are unrestricted by type/size and the bucket is public. | `001_initial.sql:153–167` | Scope insert/update/delete with `(storage.foldername(name))[1] = auth.uid()::text`; enforce allowed MIME types and a size cap in `with check`. |
| 3 | **Medium** | **`photos` insert isn't bound to the uploader.** The insert policy only checks `auth.role()`, so a direct API call can set an arbitrary `uploader_id` (spoofed attribution) on any `profile_id`. | `001_initial.sql:93–95` | Add `with check (auth.uid() = uploader_id)`. |
| 4 | **Medium** | **Session JWT stored in `localStorage`** (supabase-js default). Any XSS can steal the token and take over the account, including the admin (whose privilege is just the email claim). | `src/supabase.js` | Keep the XSS surface at zero (no `dangerouslySetInnerHTML`; render user text as React nodes) and add a strict CSP header in `vercel.json`. Inherent to a serverless SPA — document as accepted if not mitigated further. |
| 5 | **Low** | **Account-state enumeration.** Login returns distinct "email not confirmed" / "pending" / "rejected" messages, and `signup` rethrows the raw Supabase error — both reveal whether an email is registered. (Wrong-password is correctly generic.) | `AppContext.jsx:79–114, 125` | Use generic messaging if enumeration matters for the threat model. |
| 6 | **Low** | **`comments_with_author` view leaks emails.** It falls back to the `auth.users` email local-part as the author name; views run with definer rights, bypassing RLS on `auth.users`. | `001_initial.sql:53–65` | Drop the email fallback, or restrict who can read the view. |
| 7 | **Low** | **No server-enforced password policy or login rate-limiting in code.** Brute-force resistance and password strength depend entirely on Supabase dashboard settings. | Supabase Auth settings | Confirm a minimum password policy and auth rate limits are enabled in the dashboard. |
| 8 | **Low** | **Login ignores the `pending_users` query error.** It destructures only `data`, so a transient query failure is treated as "pending" and signs the user out. Fails closed (not a hole) but can cause spurious lockouts. | `AppContext.jsx:97–101` | Handle the `error` branch explicitly. |
| — | *Accepted* | **Hardcoded admin email** as the sole admin authority, duplicated in the client and ~6 RLS policies. Relies on the verified JWT `email` claim; fragile to maintain. | `AppContext.jsx:7`; `001`/`002` policies | (Accepted.) Optionally move to a roles table / custom claim referenced by both client and RLS. |
| — | *Accepted* | **Casino is not server-authoritative** — game outcomes/balances are computed client-side and written to `wallets` directly. Coin transfers are the safe exception (`donate_coins` RPC). | `CasinoContext.jsx`; `005`/`007` | (Accepted for play-money.) Move game resolution into Postgres functions/Edge Functions if balances ever need to be tamper-proof. |
| — | *Accepted* | **CP War combat *inputs* are client-trusted.** Combat/conquest/income resolution is server-authoritative (`war_tick()`), and clients can no longer write enemy rows. But `war_movements` rows are still inserted client-side, and a player can set their own province's unit counts directly (owner-only RLS), so a determined member could field a fabricated army or send from/to provinces the client-side reachability rules would forbid (the tick doesn't re-validate adjacency/range) — equivalent to the accepted casino self-editing trust (§4). `count > 0` is enforced; building writes are region-owner-bound; `war_tick` is not client-executable. | `WarPage.jsx`; `019`/`023`/`024` | (Accepted for friends-and-family.) Add a `send_units()` `SECURITY DEFINER` RPC that validates source ownership + unit balance and debits atomically; make own-region unit counts server-written. |

---

## Migration index

| File                                   | Summary                                                        |
|----------------------------------------|----------------------------------------------------------------|
| `001_initial.sql`                      | profiles, photos, likes, comments, pending_users, view, RLS, storage bucket |
| `002_admin_delete_policies.sql`        | Admin can delete any photo/profile                             |
| `003_chat.sql`                         | `messages` table + realtime                                    |
| `004_username_changes.sql`             | Rename rate-limit log                                          |
| `005_gambling.sql`                     | `wallets` + `game_history`                                     |
| `006_daily_bonus.sql`                  | `wallets.last_daily_bonus`                                     |
| `007_donations.sql`                    | `donations` table + `donate_coins` RPC                         |
| `008_leaderboard_fix.sql`              | Read leaderboard names from profiles (later superseded)        |
| `009_fix_profiles_rls.sql`             | Definitive profiles read policy                                |
| `010_unique_usernames.sql`             | Case-insensitive unique index on `profiles.full_name`          |
| `011_get_wallet_players.sql`           | (Defunct) wallet+profile name RPC                              |
| `012_wallet_display_name.sql`          | Denormalize `display_name` into wallets; drop the RPC          |
| `013_backfill_wallet_display_names.sql`| Pre-create wallets + backfill names from `pending_users`       |
| `014_wallets_select_all.sql`           | Fix wallets read policy (expression form)                      |
| `015_cp_war.sql`                       | CP War v1 (hex): `war_players`, `war_tiles`, `war_movements` — superseded by `019` |
| `016_reset_balances.sql`               | One-off: reset all balances to 1000                            |
| `017_security_hardening.sql`           | RLS hardening pass (see security review)                       |
| `018_direct_messages.sql`              | `dm_threads`, `direct_messages`, RLS, trigger, 3 RPCs, realtime|
| `019_cp_war_v2.sql`                    | CP War v2: real-world province schema (`war_players`/`war_regions`/`war_movements`) |
| `020_war_warship.sql`                  | CP War Phase 2: `war_regions.warship` column + `warship`/`sea` movement constraints |
| `021_war_buildings.sql`                | CP War Phase 2: `war_buildings` table (bunker/antiair/factory/lab/bank, Lv 1–3) + RLS |
| `022_war_idle_columns.sql`             | CP War Phase 3: `war_players.vault` + `last_active_at` (idle economy/activity) |
| `023_war_tick.sql`                     | CP War Phase 3: `war_tick()` + `war_collect_income()` + helpers (server combat/income) |
| `024_war_cron_and_rls.sql`             | CP War Phase 3: `pg_cron` schedule for `war_tick` + server-authoritative (owner-only) RLS |
| `025_war_events.sql`                   | CP War 2.1: `war_events` table + `war_log_event()` helper (EXECUTE revoked from clients — tick-only) + realtime; tick updated to prune events and call the helper |
| `026_war_combat_v2.sql`                | CP War 2.1: `war_movements.units jsonb` mixed-stack column (+ legacy `unit_type`/`count` made nullable, `mode` check widened to include `sea`) + `war_stack_strength()` helper; tick rewritten for mixed-stack combat with ±15% RNG and 25% attacker retreat |
| `027_war_income_territory.sql`         | CP War 2.1: per-province income — rate = `banks×50 + provinces×10` coins/hr; cap = `rate×10h` |
| `028_war_spawn.sql`                    | CP War 2.1: `war_spawn()` SECURITY DEFINER RPC; `war_players` column lockdown (revoke INSERT/UPDATE, grant back `display_name`/`color`/`spawn_region` only) |
| `029_war_buildings_unique.sql`         | CP War 2.1: dedupe + `UNIQUE(region_id, type)` on `war_buildings` so the tick's `sum(level)` can't double-count duplicate buildings |

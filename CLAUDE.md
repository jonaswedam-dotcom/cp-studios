# CLAUDE.md

Guidance for AI assistants and new contributors working in this repository. Read this
alongside the [`README.md`](README.md) (product overview + setup) and
[`docs/DATABASE.md`](docs/DATABASE.md) (schema, RLS, RPCs).

## What this project is

CP Studios is a **client-only React SPA** (Vite + Tailwind) that talks directly to
**Supabase** (Postgres + Auth + Storage + Realtime). There is no application server. Most
data-access rules live in Postgres **Row-Level Security (RLS)** policies, and the app uses the
Supabase **anon** key — which is safe to ship to the browser *only to the extent RLS actually
enforces each rule*. Treat the client as untrusted: anything not enforced by an RLS policy or a
`SECURITY DEFINER` RPC is not enforced at all. Some rules the UI implies (notably the
member-approval gate) are currently **client-side only** — see §7 below and
[`docs/DATABASE.md`](docs/DATABASE.md#security-limitations--known-gaps).

It is a private, trusted, friends-and-family app. Several design choices (client-side casino
logic, a hardcoded admin email) are acceptable trade-offs for that context but would be
inappropriate for a public product. Keep that framing in mind before "hardening" things.

## Architecture at a glance

```
main.jsx
  └─ BrowserRouter
       └─ App.jsx
            └─ AppProvider                (auth/session, profiles, currentUser)
                 └─ CasinoProvider        (wallet balance, daily bonus, placeBet)
                      ├─ AppRoutes         (guarded routes)
                      └─ ChatBubble        (always mounted, persists across navigation)
```

- **`src/supabase.js`** — the single shared Supabase client, built from
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. Import `{ supabase }` from here everywhere.
- **`src/context/AppContext.jsx`** — `useApp()` exposes `session`, `authLoading`,
  `currentUser` (derived; includes `isAdmin`), the `profiles` list, and `login` / `signup` /
  `logout` / `updateCurrentUser`, plus the `chatOpen` toggle. This is the auth + identity hub.
- **`src/context/CasinoContext.jsx`** — `useCasino()` exposes `balance`, `placeBet`,
  `claimRefill`, daily-bonus state. Wallet rows are created lazily on first read.
- **Route guards** in `App.jsx`: `ProtectedRoute` (must be signed in) wraps everything except
  `/login`; `AdminRoute` additionally requires `currentUser.isAdmin` and protects `/admin`.

### Data flow pattern
Components call `supabase.from(...)` / `supabase.rpc(...)` / `supabase.storage` **directly**.
There is no service/repository layer. Realtime updates come from `supabase.channel(...)`
subscriptions set up inside `useEffect`. Common pattern: optimistic local state update, then
the network call, with realtime reconciling other clients (see `ChatBubble` and the casino
send-coins flow).

## Critical things to know before editing

### 1. The admin email is hardcoded in two places
- `ADMIN_EMAIL` in `src/context/AppContext.jsx` (drives UI: admin nav, delete buttons, gates).
- The same email string is embedded in multiple **RLS policies** in `supabase/migrations/`.

Changing the admin requires updating **both** the constant and every policy that references
the email, or the UI and the database will disagree (e.g. the admin panel renders but the
queries return nothing / are rejected).

### 2. RLS "TO authenticated USING (true)" is silently broken in this deployment
Migrations `009` and `014` document a real, recurring bug: the role-binding policy form
(`... TO authenticated USING (true)`) returns **zero rows** here, while the expression form
works:

```sql
USING (auth.role() = 'authenticated')
```

**Always use the `auth.role()` expression form** for "any signed-in user can read" policies.
If a list mysteriously comes back empty for everyone, suspect this first.

### 3. Display names are denormalized into `wallets.display_name`
Historically, `profiles.user_id` was `NULL` for many rows (the old profile-creation flow did
not set it to the auth user), so joining `wallets` → `profiles` for names returned "Player".
The fix (migrations `012`/`013`) was to store `display_name` directly on `wallets`. Therefore:

- The leaderboard, Send-Coins modal, and homepage stats page read `wallets.display_name` —
  **do not** reintroduce a `profiles` join for names.
- When a user renames themselves, `Navbar.jsx` mirrors the new name into
  `wallets.display_name` (and into auth metadata). Keep these in sync if you touch renaming.

### 4. The casino is not server-authoritative (but CP War now is)
Casino game outcomes are decided in the browser, and `CasinoContext.placeBet()` writes the
resulting balance straight to the `wallets` row (guarded only by "you may update your own
wallet" RLS). Coin transfers are the exception — they go through the `donate_coins` SECURITY
DEFINER RPC, which validates balance and is race-safe. Don't assume casino balances are
tamper-proof; if you ever need them to be, move game resolution into Postgres functions.

**CP War is the exception:** its combat, conquest, and income are **server-authoritative** via
the `war_tick()` SECURITY DEFINER function (scheduled by `pg_cron`), and as of migrations
`052`/`053` so is its **economy**. Unit/building purchases and movements go through DEFINER RPCs
(`war_buy_units`/`war_send_units`/`war_build`/`war_upgrade`) that price + debit + validate
server-side; `053` revokes the client's direct `INSERT`/`UPDATE` on
`war_regions`/`war_buildings`/`war_movements`. This closed the free-army / forged-conquest /
free-building exploits (a player could previously set their own unit counts, forge a movement
stack, or build for free with the cost deducted by a separate client call). Spawn location is
server-random (`055`). See [`docs/DATABASE.md`](docs/DATABASE.md#cp-war--server-authoritative-economy-migrations-052053).

### 5. Migrations are manual and ordered
There is no migration runner. SQL files in `supabase/migrations/` are run by hand in the
Supabase SQL editor, **in numerical order**. When adding schema:
- Create the next-numbered file (`017_...sql`).
- Make it idempotent (`create table if not exists`, `drop policy if exists`, etc.).
- If it adds a realtime table, note the `alter publication supabase_realtime add table ...`
  step (some must be enabled in the dashboard).

### 6. CP War is enabled (real-world-map strategy game)
`src/pages/WarPage.jsx` has `const COMING_SOON = false` — the full game (`WarGame`) renders.
It is a persistent, real-world-map conquest game (MapLibre + Natural Earth admin-1 provinces):
random-city spawn, buy soldiers/tanks/jets/warships, conquer adjacent/reachable provinces,
build & upgrade five building types, with a per-minute `pg_cron` server tick that advances the
world (combat + income) even while everyone is offline (see §4). The
pure game logic lives in testable modules under `src/war/` (`node --test src/war/*.test.js`);
the province graph asset is built by `scripts/build-war-geo.mjs` → `public/war/provinces.*`.
Set `COMING_SOON = true` to hide it behind a "coming soon" screen again.

> **Orphaned file:** `src/pages/WarComingSoon.jsx` is a standalone component that is **not
> imported anywhere** — `WarPage.jsx` defines its own inline `WarComingSoon`. It's dead code;
> flag it rather than silently relying on it.

### 7. Security gaps not (yet) enforced by RLS
A security review found that several access rules are enforced **only in the client**, so they
are bypassable by calling Supabase directly with any valid session. Don't assume a UI gate
implies a server-side one:

- **Member approval is client-side only.** `pending_users.status` is checked in
  `AppContext.login`, but the RLS on `profiles` / `photos` / `likes` / `comments` only requires
  `auth.role() = 'authenticated'`. Any signed-in user — including a *rejected/revoked* one with a
  live session — can read/write those tables directly. Revoking only flips a column; it doesn't
  end sessions. *(Note: the profile-gallery and photo-upload UI has been removed from the app,
  so these surfaces no longer exist in the client — but the tables and their RLS policies remain
  unchanged in Supabase.)*
- **Storage has no per-object ownership.** The `cp-studios` bucket's update/delete policies are
  named "own objects" but only check `authenticated`, so any member can overwrite/delete any
  file; uploads are unrestricted by type/size.
- **`photos` rows aren't bound to the uploader** — the insert policy lets `uploader_id` be spoofed.

These (and lower-severity items) are catalogued in
[`docs/DATABASE.md` → Security limitations & known gaps](docs/DATABASE.md#security-limitations--known-gaps).
The hardcoded admin email (§1) and the client-authoritative casino (§4) are *accepted*
trade-offs for this private app; the items above are **not** — they're gaps between intended and
enforced behaviour.

## Conventions

- **Styling:** Tailwind utility classes only. The custom palette lives under the `cp` color
  group in `tailwind.config.js` (`cp-bg`, `cp-card`, `cp-elevated`, `cp-border`,
  `cp-border-soft`, `cp-text`, `cp-muted`, `cp-accent`, `cp-accent-hover`). The casino screens
  additionally lean on Tailwind's `amber-*` for the "coins/gold" accent. Match the existing
  dark aesthetic; avoid introducing new ad-hoc hex values.
- **Fonts:** `font-sans` (DM Sans) for body, `font-display` (Playfair Display) for headings.
- **Icons:** inline SVG functional components defined at the top of each file — no icon
  package. Follow the same pattern when adding icons.
- **Animations:** reuse the shared classes in `src/index.css` (`page-in`, `modal-in`,
  `backdrop-in`, `comment-in`, `heart-pop`). One-off keyframes are sometimes inlined via a
  `<style>` tag inside a component (e.g. toasts) — that's an accepted local pattern.
- **Storage paths:** files go in the single public `cp-studios` bucket under prefixes like
  `avatars/<userId>/`, `photos/<profileId>/`, `chat/<userId>/`. Use
  `getStoragePath()` from `src/lib/storage.js` to turn a public URL back into a bucket path
  before deleting.
- **`localStorage` keys** are namespaced `cp-studios:...` (e.g. unread tracking, refill
  cooldown, admin last-visit). Keep that prefix.
- **No test suite / linter config** is present. Verify changes by running `npm run dev` and
  exercising the affected flow. Build with `npm run build` to catch hard errors.

## Realtime channels in use

| Channel name        | Where            | Purpose                                            |
|---------------------|------------------|----------------------------------------------------|
| `chat-bubble`       | `ChatBubble.jsx` | Group: new messages + typing-indicator broadcasts  |
| `dm-user-<uid>`     | `ChatBubble.jsx` | Per-user stream of incoming DMs (RLS-scoped)        |
| `dm-typing-<tid>`   | `ChatBubble.jsx` | Per-thread DM typing-indicator broadcasts          |
| `navbar-pending`    | `Navbar.jsx`     | Admin's "new signup request" notification dot       |
| `casino-bet-feed`   | `LiveBetFeed.jsx`| All players' bets (`game_history` INSERTs) → fading top-of-screen bubbles |
| `war-rt-v2`         | `useWarData.js`  | regions / players / movements / buildings sync for CP War |

## Where to make common changes

| Task                                   | Start here                                             |
|----------------------------------------|--------------------------------------------------------|
| Add/adjust a casino game               | `src/pages/casino/<Game>.jsx` + register in `CasinoPage.jsx` `GAMES` |
| Change starting coins / daily bonus    | `CasinoContext.jsx` (`DAILY_BONUS_AMOUNT`, start balance) |
| Tune the rewarded-ad faucet            | `CasinoContext.jsx` (`AD_REWARD_AMOUNT`, `AD_COOLDOWN_MS`, `AD_DAILY_CAP`); columns from migration `031` |
| Reset all in-game money                | new `supabase/migrations/0NN_*.sql` modeled on `030_reset_money.sql` (coins-only) |
| Tweak auth / approval flow             | `AppContext.jsx` (login/signup) + `AdminPage.jsx`      |
| Edit the homepage / intro page         | `src/pages/HomePage.jsx` (+ `src/components/CoinField.jsx`) |
| Change the theme/colors                | `tailwind.config.js`                                   |
| Add a DB table/policy                  | new `supabase/migrations/0NN_*.sql` + `docs/DATABASE.md` |
| Show/hide CP War                       | `WarPage.jsx` → `COMING_SOON` flag                     |
| Tune CP War balance                    | `src/war/units.js` / `buildings.js` — but combat/income also live in `supabase/migrations/023_war_tick.sql`; **keep the duplicated constants in sync** |
| Regenerate the CP War province map     | `scripts/build-war-geo.mjs` → `npm run build:war-geo`  |

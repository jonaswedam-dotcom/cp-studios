# CP Studios

A private, invite-only web app for a small circle of family and friends. It bundles
four things into one cozy dark-themed space:

- 📷 **Photo sharing** — per-person profiles with photo galleries, likes, and comments
- 💬 **Group chat** — a single realtime group chat with text + image messages
- 🎰 **Casino** — a play-money (fake coin) casino with nine games, a daily bonus, a leaderboard, and peer-to-peer coin gifting
- ⚔️ **CP War** — a multiplayer hex-grid territory-conquest game (currently behind a "coming soon" flag)

> Everything is play-money and the casino is purely for fun — "all fun, all fake."

---

## Tech stack

| Layer      | Choice                                                              |
|------------|--------------------------------------------------------------------|
| Frontend   | [React 18](https://react.dev) + [React Router v6](https://reactrouter.com) |
| Build tool | [Vite 5](https://vitejs.dev)                                       |
| Styling    | [Tailwind CSS 3](https://tailwindcss.com) (custom `cp-*` dark palette) |
| Backend    | [Supabase](https://supabase.com) — Postgres, Auth, Storage, Realtime |
| Hosting    | [Vercel](https://vercel.com) (SPA, client-side routing)            |
| Fonts      | DM Sans (body) + Playfair Display (display) via Google Fonts       |

There is no custom backend server. The React app talks directly to Supabase using the
`@supabase/supabase-js` client and the project's **anon** key. Most data access rules live
in Postgres Row-Level Security (RLS) policies — see [`docs/DATABASE.md`](docs/DATABASE.md).
Some rules the UI implies (notably member approval) are currently enforced **only client-side**;
see [Security limitations & known gaps](docs/DATABASE.md#security-limitations--known-gaps).

---

## Quick start

### Prerequisites

- Node.js 18+ and npm
- A Supabase project (free tier is fine)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example file and fill in your Supabase project values:

```bash
cp .env.example .env.local
```

```dotenv
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

Both values come from your Supabase dashboard under **Project Settings → API**.
Vite only exposes variables prefixed with `VITE_` to the client.

### 3. Set up the database

In the Supabase dashboard, open **SQL Editor** and run every migration in
[`supabase/migrations/`](supabase/migrations/) **in numerical order** (`001` → `016`).
They create the tables, RLS policies, the public storage bucket, and the RPC functions.

A few realtime tables must also be enabled manually under **Database → Replication**
(or via SQL) — the migration files note which ones. See
[`docs/DATABASE.md`](docs/DATABASE.md) for the full setup checklist.

### 4. Create the admin account

Access is gated by a single hardcoded admin email. By default this is
`jonas.wedam@gmail.com` (defined in `src/context/AppContext.jsx` **and** in the SQL
RLS policies). Either:

- Sign up with that exact email so you become the admin, **or**
- Change the admin email — see [Changing the admin](#changing-the-admin) below.

### 5. Run the dev server

```bash
npm run dev
```

Vite serves the app at `http://localhost:5173` by default.

---

## npm scripts

| Command           | What it does                                  |
|-------------------|-----------------------------------------------|
| `npm run dev`     | Start the Vite dev server with hot reload     |
| `npm run build`   | Production build into `dist/`                 |
| `npm run preview` | Serve the production build locally            |

---

## How access works

CP Studios is **invite-only with admin approval**:

1. A visitor signs up with name, email, and password (the **Create Account** tab on `/login`).
2. Signup creates a row in the `pending_users` table with status `pending` and immediately
   signs the user back out — so the **UI** won't let them in yet.
3. The **admin** reviews requests on the `/admin` page and **approves** or **rejects** each one.
4. The login flow blocks "email not confirmed", "pending approval", and "rejected" users with
   clear messages before letting them into the app.
5. The admin can later **revoke** an approved user's access from the same page.

The admin account bypasses the pending gate entirely and is the only account that can see
the admin panel, delete any profile/photo, and manage approvals.

> ⚠️ **Security caveat:** steps 2, 4, and 5 are enforced **only in the client**. The database's
> RLS grants data access to *any* authenticated user regardless of approval status, so a
> pending/rejected user who holds a valid session can still reach data by calling Supabase
> directly. This is a known gap — see
> [Security limitations & known gaps](docs/DATABASE.md#security-limitations--known-gaps).

---

## Feature tour

### Photos
- The home page (`/`) shows a grid of **profiles** (one per person). Anyone signed in can add
  a profile with a name, optional bio, and avatar. Names are unique (case-insensitive).
- Opening a profile shows its photo gallery. Any member can upload photos (drag-and-drop or
  browse) with optional captions; images are stored in the `cp-studios` Supabase Storage bucket.
- Photos support **likes** and **comments**, updated in realtime across clients with optimistic UI.
- A **lightbox** lets you page through a profile's photos full-screen.
- An unread dot appears on profiles that have new photos since your last visit (tracked per
  user in `localStorage`).
- The admin can delete any photo or profile (which also removes the underlying storage files).

### Group chat
- A floating chat (right sidebar on desktop, bubble + popup on mobile) provides one shared
  group conversation for everyone.
- Supports text and image messages, day separators, grouped consecutive messages, live
  **typing indicators**, and an unread dot. All realtime via Supabase channels.

### Casino
- Each user has a coin **wallet** (created on first casino visit) starting at 1,000 coins.
- A **daily bonus** of +100 coins is granted automatically once every 24 hours.
- If you hit 0 coins you can claim a one-per-day **emergency refill** of 100 coins.
- Nine games: **Coin Flip, Dice Roll, Roulette, Blackjack, Slots, Aviator, Chicken Road,
  Mines, Plinko.** Every game shares a common layout, bet-amount control, and result banner.
- A **leaderboard** ranks the top 10 wallets, and **Send Coins** lets players gift coins to
  each other (handled atomically by the `donate_coins` database function).
- Every bet is logged to the `game_history` table.

> ⚠️ Game outcomes and balance changes are computed **client-side** and written straight to the
> wallet. This is intentional for a trusted friends-only app — it is **not** cheat-proof. See
> [`CLAUDE.md`](CLAUDE.md) for details before changing this.

### CP War (disabled)
- A realtime, multiplayer **territory conquest** game on a 31×25 hex grid. Players claim a
  starting tile, buy troops (500 coins each), and move/attack neighbouring tiles. Movements
  take time to arrive and combat resolves attacker vs. defender troop counts; eliminating
  enemy troops awards coins.
- It is currently **switched off** via `const COMING_SOON = true` at the top of
  `src/pages/WarPage.jsx`, and the navbar link is intentionally non-clickable. Flip the flag
  to `false` to re-enable the live game.

---

## Project structure

```
cp-studios/
├── index.html                 # Vite entry; loads Google Fonts + /src/main.jsx
├── vite.config.js             # Vite + React plugin
├── tailwind.config.js         # Custom cp-* color palette + font families
├── vercel.json                # SPA rewrite (all routes → index.html)
├── src/
│   ├── main.jsx               # React root + BrowserRouter
│   ├── App.jsx                # Providers, routes, route guards, persistent ChatBubble
│   ├── supabase.js            # Supabase client (reads VITE_ env vars)
│   ├── index.css              # Tailwind layers + shared keyframe animations
│   ├── context/
│   │   ├── AppContext.jsx     # Auth/session, profiles, currentUser, chat toggle
│   │   └── CasinoContext.jsx  # Wallet balance, daily bonus, placeBet, refill
│   ├── components/
│   │   ├── Navbar.jsx         # Top nav + avatar/profile dropdown
│   │   ├── ChatBubble.jsx     # Global realtime group chat
│   │   ├── PhotoCard.jsx      # Photo with likes/comments
│   │   ├── UploadModal.jsx    # Drag-and-drop photo upload
│   │   └── Lightbox.jsx       # Full-screen photo viewer
│   ├── pages/
│   │   ├── LoginPage.jsx        # Sign in / request access
│   │   ├── HomePage.jsx         # Profile grid
│   │   ├── ProfilePage.jsx      # A person's photo gallery
│   │   ├── CreateProfilePage.jsx
│   │   ├── AdminPage.jsx        # Approve / reject / revoke members
│   │   ├── CasinoPage.jsx       # Casino hub: balance, games, leaderboard, send coins
│   │   ├── WarPage.jsx          # CP War game (gated behind COMING_SOON)
│   │   ├── WarComingSoon.jsx    # (orphaned — see CLAUDE.md)
│   │   └── casino/
│   │       ├── shared.jsx       # GameLayout, BetChips, ResultBanner helpers
│   │       └── *Game.jsx        # The nine individual games
│   └── lib/
│       └── storage.js         # Helper to derive a storage path from a public URL
└── supabase/
    └── migrations/            # 001–016 SQL migrations (run manually in order)
```

For a deeper explanation of how the pieces fit together, see [`CLAUDE.md`](CLAUDE.md).
For the database schema, RLS policies, and RPCs, see [`docs/DATABASE.md`](docs/DATABASE.md).

---

## Deployment (Vercel)

The app is a static SPA. `vercel.json` rewrites all routes to `index.html` so client-side
routing works on refresh/deep-link.

1. Import the repo into Vercel.
2. Add the two environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) in the
   Vercel project settings for the Production (and Preview) environments.
3. Vercel auto-detects Vite: build command `npm run build`, output directory `dist`.

---

## Changing the admin

The admin identity is hardcoded in **two** places and both must match:

1. `ADMIN_EMAIL` in `src/context/AppContext.jsx` (controls the UI: admin panel, delete buttons).
2. The email string baked into several Postgres RLS policies (controls what the database
   actually permits). Search the migrations in `supabase/migrations/` for the current admin
   email and update each policy accordingly.

---

## Conventions & notes

- **No icon library** — all icons are small inline SVG components.
- **Animations** (`page-in`, `modal-in`, `backdrop-in`, `comment-in`, `heart-pop`) are defined
  once in `src/index.css` and reused via class names.
- **Colors/fonts** are centralized in `tailwind.config.js` under the `cp` color group.
- **Migrations are applied manually** in the Supabase SQL editor — there is no Supabase CLI
  migration runner wired up. Keep new files numbered and idempotent.

This documentation covers the product as it currently stands. Planned improvements are not yet
reflected here.

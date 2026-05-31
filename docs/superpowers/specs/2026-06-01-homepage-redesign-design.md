# CP Studios — Homepage Redesign

**Date:** 2026-06-01
**Status:** Approved (design); pending spec review

## Problem & goal

CP Studios is opening up to more people. The current homepage (`/`) is a **gallery of
member profiles** that links into per-profile photo pages. Members don't want strangers
(newly added, less-trusted users) browsing those photos. At the same time we want a homepage
that *sells the product*: an animated intro that explains the core game loop.

Goal: **replace the profile gallery with an animated, interactive intro/landing page**, and
**remove the profile + photo feature entirely** from the app.

## Decisions (from brainstorming)

| Question | Decision |
|----------|----------|
| Audience for the new homepage | **Post-login, members only.** `/` stays behind `ProtectedRoute`. New visitors still hit `/login` first. No public route changes. |
| Aesthetic | **Sleek & premium**, true to the existing dark `cp-` palette + Playfair headings — *with interactive elements*. |
| Interactive elements | (1) Cursor-reactive drifting coins/glow, (2) animated "how it works" Earn→Gamble→Conquer loop, (4) live count-up stats. **Not** the mini playable demo. |
| Removal scope | **Remove the profile/photo feature entirely** (pages, components, routes). Data stays untouched in Supabase. |
| Unbuilt parts (ad/survey earning, War) | **Show everything as live, no "coming soon" badges** — these features are being built in parallel and will exist by the time members see this. |

## Scope

### Remove entirely
Files to delete:
- `src/pages/CreateProfilePage.jsx`
- `src/pages/ProfilePage.jsx`
- `src/components/UploadModal.jsx`
- `src/components/PhotoCard.jsx`
- `src/components/Lightbox.jsx`

`src/pages/HomePage.jsx` is **rebuilt from scratch** (gallery logic removed).

Routing (`src/App.jsx`):
- Remove `import ProfilePage` and `import CreateProfilePage`.
- Remove the `<Route path="/profile/:id">` and `<Route path="/create">` blocks.
- The `<Route path="*">` already redirects unknown paths to `/`, so old `/profile/:id`
  and `/create` links degrade gracefully to the homepage.

Navbar (`src/components/Navbar.jsx`):
- Remove the `{ to: '/create', label: 'Upload' }` entry from the nav array.
- Keep **Home, Casino, War, Chat, Admin** exactly as they are.

### Keep / do not touch
- The `profiles` **table** in Supabase — Navbar's username-uniqueness check still queries it
  directly (`profiles.ilike('full_name', ...)`), and DM recipient lookups rely on it.
- `profiles` / `loadProfiles` in `AppContext` become unused by the UI after the gallery is
  gone (only `HomePage` consumed the context list). **Leave them in place** (harmless); add a
  brief code comment flagging them as optional future cleanup. Do **not** rip them out as part
  of this change — out of scope and risks the DM/username flows.
- All photo rows and storage objects stay in Supabase. No deletion, no migration.

## New homepage design (`src/pages/HomePage.jsx`)

A single vertically-scrolling page. Dark `cp-` palette throughout (`cp-bg`, `cp-card`,
`cp-elevated`, `cp-border`, `cp-accent`); `amber-*` for the gold/coin accent, consistent with
the casino screens. `font-display` (Playfair) for headings, `font-sans` (DM Sans) for body.

### Sections (top → bottom)

1. **Hero**
   - "CP Studios" wordmark + a one-line tagline (e.g. "Earn it. Gamble it. Conquer with it.").
   - Primary CTA button **Enter the Casino** → `/casino`.
   - Secondary hint/link about the **daily bonus** (text only; the actual claim lives in the
     casino/wallet flow — homepage just points there).
   - Background: an ambient field of softly drifting gold coins / soft glow that **reacts to
     the cursor** (parallax drift toward the mouse). Falls back to gentle auto-drift on
     touch devices and when `prefers-reduced-motion` is set.

2. **The Loop** (centerpiece)
   - Animated **Earn → Gamble → Conquer** diagram. A coin travels from a survey/ad card →
     into a spinning slot reel (multiplies) → becomes a troop on a war banner.
   - Auto-loops continuously; each node lifts/glows on hover.
   - Three short captions, one per stage, explaining the loop in plain language.

3. **Live stats**
   - Three **count-up** numbers, animated when scrolled into view:
     - **Coins in circulation** — sum of all `wallets.balance`.
     - **Members** — count of `wallets` rows.
     - **Biggest stash** — max `wallets.balance`.

4. **Sections trio**
   - Three cards: **Earn**, **Casino**, **War**.
     - Casino → `/casino`
     - War → `/war`
     - Earn → in-page anchor / placeholder (no dedicated route yet).
   - All presented as live (no "coming soon" labels), per the decision above.

5. **Footer CTA**
   - Repeat the primary **Enter the Casino** button.

## Animation approach

- **No new dependencies.** Pure CSS + light React, matching repo conventions
  (Tailwind-only, inline SVG icons, shared keyframes in `src/index.css`).
- Cursor parallax: a `requestAnimationFrame` loop driven by `mousemove`, applying small
  transforms to coin/glow layers.
- Scroll reveals + stat count-ups: `IntersectionObserver`; count-up interpolates the number
  over a short duration once the stats section enters the viewport.
- **Accessibility:** honor `prefers-reduced-motion` — disable parallax and the auto-loop,
  render a static layout with final values shown immediately.
- New shared keyframes (e.g. `coin-drift`) added to `src/index.css` alongside the existing
  `page-in` / `modal-in` / etc. Count-up is handled in JS, not CSS.

## Data

- **One read-only query on mount:** `supabase.from('wallets').select('balance')`, then derive
  sum / count / max client-side. Acceptable for a small friends-and-family app.
- No schema changes, **no migration**, no new RLS. Reads only `wallets`, which any
  authenticated user can already read.
- Reads `balance` straight from `wallets` — no `profiles` join (consistent with the
  denormalized-name guidance in `CLAUDE.md` §3).

## Build approach

After this spec is approved, the homepage visuals will be built using the **frontend-design**
skill. The removal/routing changes are mechanical and done alongside.

## Out of scope

- Server-side enforcement of the privacy concern (RLS still only checks
  `auth.role() = 'authenticated'`; see `CLAUDE.md` §7). Removing the UI hides the gallery but
  does not stop a member from querying `photos` directly. Not addressed here.
- Building the actual ad/survey earning feature or the War game — only the homepage that
  *presents* them.
- Removing `profiles`/`loadProfiles` from `AppContext`.

## Verification

- `npm run build` passes (no dangling imports to deleted files).
- `npm run dev`: `/` shows the new intro page; nav has no Upload link; visiting `/create` or
  `/profile/<id>` redirects to `/`; Casino, War, Chat, Admin, and username editing still work.
- Stats render with real numbers; animations degrade gracefully with reduced-motion enabled.

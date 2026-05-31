# Direct Messages + Fullscreen Chat — Design

**Date:** 2026-05-31
**Status:** Approved (design); implementation plan to follow
**Scope:** Add 1:1 direct messaging and a fullscreen/maximize mode to the existing chat feature.

---

## 1. Goal & scope

Two additions to the existing chat (`src/components/ChatBubble.jsx`):

1. **Direct Messages (1:1).** Logged-in members can message each other privately, in addition to the existing global group chat.
2. **Fullscreen / maximize.** A button expands the chat to a maximized in-app overlay, and a button restores it to its normal size.

**In scope**
- The single global group chat **stays exactly as it is** (everyone types there).
- **1:1 DMs only.** No group DMs / no "micro group chats" — ever. The data model is deliberately specialized for pairs.
- DMs have **full parity** with the group chat: text, images, and typing indicators.
- DM entry point: a **compose button** in the Direct tab that lists real login accounts.
- Fullscreen on **both** desktop (two-pane) and mobile (single-column, edge-to-edge).

**Out of scope (v1)**
- Group DMs.
- A "Message" button on profile pages (see §3 — profiles are not login accounts).
- Numeric unread counts (boolean unread dots only; can be upgraded later).
- Message editing/deletion, reactions, read receipts, push notifications.

---

## 2. Context: how identity works in this app (why the design is shaped this way)

This is a client-only React/Vite SPA talking directly to Supabase (Postgres + Auth + Storage +
Realtime). Key constraints discovered during design:

- **Profiles are NOT login accounts.** `CreateProfilePage` ("Add a family member or friend to
  the collection") lets any user create profile cards for other people. `profiles.user_id`, when
  set, is the **creator**, not the person pictured — and migrations `011`/`012` document that it
  has historically been `NULL`. Therefore a profile cannot be reliably mapped to an account.
- **DMs must key on the auth account** (`auth.users.id`) — the population that actually signs in
  and uses the group chat. Names/avatars for accounts live in **auth user metadata**
  (`raw_user_meta_data->>'full_name'` / `'avatar_url'`), mirrored into `wallets.display_name`.
- **The reliable account directory is `auth.users`**, which the browser cannot list directly. We
  expose it via a `SECURITY DEFINER` RPC — the established pattern in this codebase
  (`donate_coins`, the former `get_wallet_players`).
- **RLS is the only real enforcement.** The group chat's policy is "any authenticated user can
  read all messages." DMs require stricter, genuinely private RLS (participants only).
- **Migrations are manual and numerically ordered**, run by hand in the Supabase SQL editor.
  Next file is `018_…`. Make it idempotent.

---

## 3. UX model

The chat panel header gains **two tabs: Group | Direct**.

- **Group tab** — the existing group chat, unchanged.
- **Direct tab** — a list of the current user's 1:1 conversations. Each row shows the other
  person's avatar + name, a last-message preview, and an unread dot. A **compose (`+`) button**
  opens a searchable list of login accounts; selecting one opens (or creates) that thread. Tapping
  a row opens the thread; a `‹ Back` returns to the list.
- **A DM thread** reuses the exact group-chat message UI (the existing `ChatPanelBody`): text,
  image attachments, and a "typing…" indicator. Only the data source and send target differ.

**DM entry point:** compose button only. No profile "Message" button in v1 (profiles ≠ accounts,
per §2).

### Fullscreen / maximize

A `⤢` button in the panel header toggles a maximized state; a restore button returns to normal.
It is an **in-app maximized overlay** (covers the page, keeps the top navbar) — **not** the
browser Fullscreen API (more predictable, keeps navigation).

- **Desktop (≥ lg):** normal state is today's 300px right sidebar. Maximized = an overlay with a
  **two-pane layout**: a **left rail** listing *Group Chat (pinned at top) + all your DMs*
  together, and a wide **right pane** showing the active thread. The Group/Direct tabs collapse
  into the single rail when maximized. Restore returns to the sidebar.
- **Mobile (< lg):** normal state is today's floating popup. Maximized = the popup expands
  **edge-to-edge** (single column — too narrow for two panes), with the same tabs/list/thread
  navigation. Restore shrinks it back to the popup.

---

## 4. Data model

Keep the existing `messages` table (group chat) **completely untouched**. Add a parallel,
**pair-based** structure for DMs. The pair model is chosen deliberately: because group DMs are
permanently out of scope, a `conversations` + `participants` schema would add complexity and
migration risk (it would also have to absorb the existing group chat) with no payoff.

```sql
-- 018_direct_messages.sql  (idempotent)

create table if not exists public.dm_threads (
  id              uuid primary key default gen_random_uuid(),
  user_lo         uuid not null references auth.users(id) on delete cascade,
  user_hi         uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint dm_threads_ordered  check (user_lo < user_hi),  -- canonical order
  constraint dm_threads_distinct check (user_lo <> user_hi),
  unique (user_lo, user_hi)
);

create table if not exists public.direct_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.dm_threads(id) on delete cascade,
  sender_id   uuid not null references auth.users(id) on delete cascade,
  sender_name text not null default '',
  content     text,
  image_url   text,
  created_at  timestamptz not null default now(),
  constraint direct_messages_has_content check (content is not null or image_url is not null)
);

create index if not exists direct_messages_thread_idx
  on public.direct_messages (thread_id, created_at);
```

`user_lo`/`user_hi` store the two participant IDs in sorted order so each pair maps to exactly
one row (enforced by the unique constraint). `last_message_at` drives DM-list ordering and is
bumped on every send. `sender_name` is denormalized exactly like `messages.sender_name`.

---

## 5. RPCs (all `SECURITY DEFINER`, `GRANT EXECUTE ... TO authenticated`)

1. **`list_dm_recipients()` → `(user_id, full_name, avatar_url)`**
   The compose-picker directory. Reads `auth.users` metadata for approved members
   (join `pending_users` where `status = 'approved'`, plus admin emails), excluding the caller.
   This is what sidesteps the broken `profiles.user_id`.

2. **`get_or_create_dm_thread(other_user_id uuid) → uuid`**
   Canonicalizes `(least, greatest)` of caller + `other_user_id`, inserts the thread if missing
   (`on conflict (user_lo, user_hi) do nothing`), returns the thread id. Validates that the caller
   is one of the two participants. Race-safe; avoids RLS-insert friction.

3. **`list_dm_threads()` → per-thread row for the caller**
   Returns `{thread_id, other_user_id, other_name, other_avatar, last_content, last_image_url,
   last_sender_id, last_message_at}` for every thread the caller participates in, ordered by
   `last_message_at desc`. Powers the Direct list and the fullscreen rail. Other-user name/avatar
   resolved from auth metadata (same source as `list_dm_recipients`).

---

## 6. Privacy & RLS

DMs are the one place we deliberately **add** enforcement beyond the app's existing
"authenticated can read everything" baseline.

- **`dm_threads`** — `select` allowed only when `auth.uid() in (user_lo, user_hi)`. No direct
  client `insert` (creation goes through `get_or_create_dm_thread`).
- **`direct_messages`** —
  - `select`: allowed only when the caller participates in the row's `thread_id`
    (`exists (select 1 from dm_threads t where t.id = thread_id and auth.uid() in (t.user_lo, t.user_hi))`).
  - `insert`: `with check` that `sender_id = auth.uid()` **and** the caller participates in
    `thread_id`.
  - No update/delete policies in v1 (messages are immutable).
- Enable RLS on both tables.

**Use the `auth.uid() in (...)` / `exists(...)` expression forms** — per CLAUDE.md §2, the
`TO authenticated USING (true)` role-binding form is silently broken in this deployment.

---

## 7. Realtime

- Add `direct_messages` to the `supabase_realtime` publication
  (`alter publication supabase_realtime add table public.direct_messages;`).
- **Subscribe once per user** to `direct_messages` INSERTs. **We rely on Realtime applying the
  SELECT RLS policy** so each client receives only messages from its own threads. On receipt the
  client routes the message to the open thread (if any), bumps the DM list, and sets the unread
  dot.
  - ⚠️ **Riskiest assumption in this design.** Before building on it, verify that RLS-scoped
    `postgres_changes` actually filters correctly in this project (a quick two-account test).
  - **Fallback if it doesn't:** subscribe per-open-thread with a server-side filter
    (`thread_id=eq.<id>`) for live messages, plus a lightweight broadcast "ping" from the sender to
    the recipient to refresh the DM list / unread state for threads that aren't currently open.
- **Typing indicators:** a per-thread broadcast channel `dm-typing-<threadId>`
  (`broadcast: { self: false }`), mirroring the group chat's existing typing broadcast. Subscribed
  only while a thread is open.
- New channel names to add to the CLAUDE.md "Realtime channels in use" table:
  `dm-user-<uid>` (per-user message stream) and `dm-typing-<threadId>` (typing).

---

## 8. Storage (DM images)

Reuse the existing public `cp-studios` bucket under prefix `dm/<threadId>/<timestamp>.<ext>`
(consistent with `chat/<userId>/…`). Upload + public-URL flow identical to the group chat.

⚠️ **Caveat (accepted):** the bucket is public, so a DM image is reachable by anyone who has the
exact URL — it is not cryptographically private. This matches the existing storage posture
(CLAUDE.md §7) and is acceptable for this trusted friends-and-family app. Documented here so it's
a known trade-off, not a surprise.

---

## 9. Unread tracking

- Per-thread `localStorage` key `cp-studios:dm-last-visit:<uid>:<threadId>`, consistent with the
  existing group-chat (`cp-studios:chat-last-visit:<uid>`) and profile-visit patterns.
- **Boolean unread dots** (not numeric counts): a thread is unread when its `last_message_at` is
  newer than the stored last-visit **and** the last message wasn't sent by the current user.
  (Numeric counts would need a server-side `dm_reads` table; deferred.)
- The chat button's existing red dot becomes **"unread in the group chat OR any DM thread."**

---

## 10. Component architecture

Refactor `ChatBubble.jsx` (currently ~583 lines, one file) into focused units so the same thread
UI serves both group and DM, and fullscreen is just a layout switch. **Group-chat behavior must
remain identical.**

- **`ChatPanel`** (container) — owns `open` / `expanded` / `activeTab` (`group`|`direct`) /
  `activeConversation` state and the responsive layout: desktop sidebar ↔ desktop maximized
  overlay (two-pane) ↔ mobile popup ↔ mobile maximized (full-screen). Holds the per-user DM
  realtime subscription.
- **`ConversationThread`** — the existing `ChatPanelBody`, generalized to accept a `conversation`
  descriptor (`{kind: 'group'}` or `{kind: 'dm', threadId, other}`) and route load / send /
  realtime / typing accordingly.
- **`ConversationList`** — the Direct-tab list **and** the fullscreen left rail (one component,
  two contexts). Renders Group Chat (pinned) + DM threads with avatar/preview/unread dot.
- **`NewDmPicker`** — the compose recipient modal (searchable `list_dm_recipients()` results).

> **Implementation note:** the current `ChatBubble` references a single `scrollRef` in
> `scrollToBottom`/`panelBodyProps` while defining separate `desktopScrollRef`/`mobileScrollRef`.
> Reconcile this during the refactor (it falls out naturally when the thread becomes one
> component). Flagging rather than silently rewriting unrelated code.

State placement: `chatOpen` already lives in `AppContext`; keep it there. New `expanded` /
`activeTab` / `activeConversation` state can stay local to `ChatPanel` unless another component
needs it (none currently does).

---

## 11. Rough phasing

Detailed steps belong in the implementation plan; high-level order:

1. **DB:** migration `018_direct_messages.sql` (tables + RLS + publication) and the three RPCs.
   Verify realtime-RLS with a two-account test (§7).
2. **Refactor:** extract `ConversationThread` from `ChatBubble`; add the Group/Direct tabs.
   Group chat behaves identically. (No fullscreen yet.)
3. **DMs:** `ConversationList` (Direct tab) + `NewDmPicker` + send/receive over realtime.
4. **Polish:** typing indicators + unread dots (per-thread + combined button dot).
5. **Fullscreen:** desktop two-pane maximized overlay + mobile edge-to-edge maximize, with the
   restore button.

Update `docs/DATABASE.md` and the CLAUDE.md realtime-channels table as part of the DB phase.

---

## 12. Verification

No automated test suite exists; verify by running `npm run dev` and exercising flows, and
`npm run build` for hard errors. Key checks:

- Group chat unchanged (send/receive text + image, typing, unread dot, scroll-to-bottom).
- DM round-trip between two accounts: compose → send text & image → recipient receives live →
  typing indicator → unread dot clears on open.
- **Privacy:** a third account cannot read a thread it isn't part of (query `direct_messages`
  directly with its session — should return zero rows).
- Fullscreen: desktop two-pane switch + restore; mobile maximize + restore; navbar stays visible.

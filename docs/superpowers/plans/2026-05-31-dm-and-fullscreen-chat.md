# DMs + Fullscreen Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private 1:1 direct messages and a fullscreen/maximize mode to the existing CP Studios chat, leaving the global group chat unchanged.

**Architecture:** Keep the `messages` table (group chat) untouched; add a pair-based `dm_threads` + `direct_messages` schema with participants-only RLS and three `SECURITY DEFINER` RPCs. Refactor the monolithic `ChatBubble.jsx` into a container (`ChatPanel`) plus reusable `ConversationThread` / `ConversationList` / `NewDmPicker` pieces and a `src/lib/dm.js` data module, so the same thread UI serves group + DM and fullscreen is just a layout switch.

**Tech Stack:** React 18 + Vite, Tailwind (custom `cp-*` palette), Supabase (Postgres + Auth + Storage + Realtime), `supabase-js`. No test runner — verify with `npm run build` and manual two-account flows.

---

## ⚠️ Operational constraints (read first)

1. **Migrations are manual.** `supabase/migrations/018_direct_messages.sql` must be pasted into the Supabase SQL editor and run **by the project admin (Jonas)** — the developer running this plan does **not** have Supabase admin access. Until it's applied, DM features will error at runtime against the missing tables/RPCs. Write and commit the frontend anyway; gate live DM verification on the migration being live.
2. **Realtime-RLS is an assumption.** Task 6 depends on Supabase applying the SELECT RLS policy to `postgres_changes`. Verify with a two-account test before trusting it; the fallback is documented in the spec (§7).
3. **RLS policy form:** always use the `auth.uid() = col` / `exists(...)` expression form, never `TO authenticated USING (true)` (silently broken here — CLAUDE.md §2).
4. **Don't touch the group chat's behavior.** The `messages` table, its RLS, and the `chat-bubble` channel stay exactly as they are.
5. **Branch:** all work happens on the `feature/dm-and-fullscreen-chat` branch (created before Task 1), commit per task.

Spec: `docs/superpowers/specs/2026-05-31-dm-and-fullscreen-chat-design.md`.

---

## File structure

**Create**
- `supabase/migrations/018_direct_messages.sql` — tables, RLS, trigger, 3 RPCs, realtime publication.
- `src/lib/dm.js` — all DM data-access (RPC + table + storage wrappers).
- `src/components/chat/chatIcons.jsx` — shared inline SVG icons (moved out of `ChatBubble.jsx`).
- `src/components/chat/ConversationThread.jsx` — message list + input (generalized `ChatPanelBody`).
- `src/components/chat/ConversationList.jsx` — Direct-tab list + fullscreen left rail.
- `src/components/chat/NewDmPicker.jsx` — compose-recipient modal.

**Modify**
- `src/components/ChatBubble.jsx` — becomes the `ChatPanel` container (tabs, active conversation, fullscreen layout, per-user DM realtime). Stays the file `App.jsx` imports, so no `App.jsx` change.
- `docs/DATABASE.md` — document the new tables, RPCs, policies (Task 1).
- `CLAUDE.md` — add the new realtime channels to the channels table (Task 9).

---

## Task 1: Database migration + RPCs

**Files:**
- Create: `supabase/migrations/018_direct_messages.sql`
- Modify: `docs/DATABASE.md`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/018_direct_messages.sql` with exactly this content:

```sql
-- ============================================================
-- 018 – Direct messages (1:1 DMs)
-- Run in Supabase SQL Editor after 017_security_hardening.sql
-- ============================================================

-- ── Tables ───────────────────────────────────────────────────
create table if not exists public.dm_threads (
  id              uuid primary key default gen_random_uuid(),
  user_lo         uuid not null references auth.users(id) on delete cascade,
  user_hi         uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint dm_threads_ordered  check (user_lo < user_hi),
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

-- ── Bump thread.last_message_at on every new message ─────────
create or replace function public.bump_dm_thread_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.dm_threads
     set last_message_at = new.created_at
   where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists trg_bump_dm_thread on public.direct_messages;
create trigger trg_bump_dm_thread
  after insert on public.direct_messages
  for each row execute function public.bump_dm_thread_last_message();

-- ── RLS ──────────────────────────────────────────────────────
alter table public.dm_threads     enable row level security;
alter table public.direct_messages enable row level security;

drop policy if exists "participants can read dm_threads" on public.dm_threads;
create policy "participants can read dm_threads"
  on public.dm_threads for select
  using (auth.uid() = user_lo or auth.uid() = user_hi);
-- (no client insert/update/delete on dm_threads; created via RPC below)

drop policy if exists "participants can read direct_messages" on public.direct_messages;
create policy "participants can read direct_messages"
  on public.direct_messages for select
  using (
    exists (
      select 1 from public.dm_threads t
      where t.id = direct_messages.thread_id
        and (auth.uid() = t.user_lo or auth.uid() = t.user_hi)
    )
  );

drop policy if exists "participant can insert direct_messages" on public.direct_messages;
create policy "participant can insert direct_messages"
  on public.direct_messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.dm_threads t
      where t.id = direct_messages.thread_id
        and (auth.uid() = t.user_lo or auth.uid() = t.user_hi)
    )
  );

-- ── RPCs ─────────────────────────────────────────────────────

-- Find-or-create the canonical thread between caller and other_user_id.
create or replace function public.get_or_create_dm_thread(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me  uuid := auth.uid();
  lo  uuid;
  hi  uuid;
  tid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if other_user_id is null or other_user_id = me then
    raise exception 'invalid recipient';
  end if;
  lo := least(me, other_user_id);
  hi := greatest(me, other_user_id);
  insert into public.dm_threads (user_lo, user_hi)
    values (lo, hi)
    on conflict (user_lo, user_hi) do nothing;
  select id into tid from public.dm_threads where user_lo = lo and user_hi = hi;
  return tid;
end;
$$;
grant execute on function public.get_or_create_dm_thread(uuid) to authenticated;

-- The caller's threads, with the other participant + last-message preview.
create or replace function public.list_dm_threads()
returns table (
  thread_id       uuid,
  other_user_id   uuid,
  other_name      text,
  other_avatar    text,
  last_content    text,
  last_image_url  text,
  last_sender_id  uuid,
  last_message_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    t.id,
    case when t.user_lo = auth.uid() then t.user_hi else t.user_lo end,
    coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1), 'Member'),
    coalesce(u.raw_user_meta_data->>'avatar_url', ''),
    lm.content,
    lm.image_url,
    lm.sender_id,
    t.last_message_at
  from public.dm_threads t
  join auth.users u
    on u.id = (case when t.user_lo = auth.uid() then t.user_hi else t.user_lo end)
  left join lateral (
    select content, image_url, sender_id
    from public.direct_messages m
    where m.thread_id = t.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where auth.uid() = t.user_lo or auth.uid() = t.user_hi
  order by t.last_message_at desc;
$$;
grant execute on function public.list_dm_threads() to authenticated;

-- The account directory for the compose picker (approved members + admins).
create or replace function public.list_dm_recipients()
returns table (
  user_id    uuid,
  full_name  text,
  avatar_url text
)
language sql
security definer
set search_path = public
as $$
  select
    u.id,
    coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1), 'Member'),
    coalesce(u.raw_user_meta_data->>'avatar_url', '')
  from auth.users u
  where u.id <> auth.uid()
    and (
      exists (select 1 from public.pending_users pu
                where pu.user_id = u.id and pu.status = 'approved')
      or u.email in ('jonas.wedam@gmail.com', 'admin@cpstudios.app')
    )
  order by 2;
$$;
grant execute on function public.list_dm_recipients() to authenticated;

-- ── Realtime ─────────────────────────────────────────────────
alter publication supabase_realtime add table public.direct_messages;
```

- [ ] **Step 2: Self-check the SQL**

There is no local Postgres. Re-read the file and confirm: every `create ... if not exists` / `drop ... if exists` is idempotent; policies use the `auth.uid()` expression form (not `TO authenticated USING (true)`); `direct_messages.thread_id` is qualified inside the `exists(...)` subqueries (avoids ambiguity with `dm_threads`); the publication line is last.

- [ ] **Step 3: Document the schema**

In `docs/DATABASE.md`, add a "Direct messages" subsection describing: the two tables and their columns, the participants-only RLS, the three RPCs and their return shapes, the `last_message_at` trigger, and the public-bucket image caveat. Match the doc's existing heading style.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/018_direct_messages.sql docs/DATABASE.md
git commit -m "feat(db): add direct messages schema, RLS, and RPCs (018)"
```

- [ ] **Step 5: Hand the migration to the admin**

Flag to the human: "`018_direct_messages.sql` is ready — Jonas must run it in the Supabase SQL editor before DMs work end-to-end." Do not block subsequent (frontend) tasks on this.

---

## Task 2: DM data-access module

**Files:**
- Create: `src/lib/dm.js`

- [ ] **Step 1: Write `src/lib/dm.js`**

```js
import { supabase } from '../supabase'

// Find or create the 1:1 thread with another account. Returns the thread id (uuid).
export async function getOrCreateThread(otherUserId) {
  const { data, error } = await supabase.rpc('get_or_create_dm_thread', {
    other_user_id: otherUserId,
  })
  if (error) throw error
  return data
}

// The current user's DM threads, newest activity first.
// Each row: { thread_id, other_user_id, other_name, other_avatar,
//             last_content, last_image_url, last_sender_id, last_message_at }
export async function listThreads() {
  const { data, error } = await supabase.rpc('list_dm_threads')
  if (error) throw error
  return data || []
}

// Accounts the current user can DM: [{ user_id, full_name, avatar_url }]
export async function listRecipients() {
  const { data, error } = await supabase.rpc('list_dm_recipients')
  if (error) throw error
  return data || []
}

// All messages in a thread, oldest first.
export async function fetchThreadMessages(threadId) {
  const { data, error } = await supabase
    .from('direct_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

// Insert one DM. Returns the inserted row.
export async function sendDirectMessage({ threadId, senderId, senderName, content, imageUrl }) {
  const { data, error } = await supabase
    .from('direct_messages')
    .insert({
      thread_id:   threadId,
      sender_id:   senderId,
      sender_name: senderName,
      ...(content  && { content }),
      ...(imageUrl && { image_url: imageUrl }),
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Upload a DM image to the public bucket under dm/<threadId>/. Returns its public URL.
export async function uploadDmImage({ threadId, file }) {
  const ext  = file.name.split('.').pop()
  const path = `dm/${threadId}/${Date.now()}.${ext}`
  const { data, error } = await supabase.storage
    .from('cp-studios')
    .upload(path, file, { upsert: false })
  if (error) throw error
  const { data: { publicUrl } } = supabase.storage
    .from('cp-studios')
    .getPublicUrl(data.path)
  return publicUrl
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: builds with no errors (the module is imported nowhere yet, but must parse/transpile cleanly).

- [ ] **Step 3: Commit**

```bash
git add src/lib/dm.js
git commit -m "feat(dm): add DM data-access module (lib/dm.js)"
```

---

## Task 3: Extract the reusable thread UI (no behavior change)

Goal: pull the message-rendering + input UI out of `ChatBubble.jsx` into `ConversationThread`, with the group chat working **identically**. This is a pure refactor — verify by diffing behavior, not by adding features.

**Files:**
- Create: `src/components/chat/chatIcons.jsx`
- Create: `src/components/chat/ConversationThread.jsx`
- Modify: `src/components/ChatBubble.jsx`

- [ ] **Step 1: Move icons**

Create `src/components/chat/chatIcons.jsx` exporting the icon components currently defined in `ChatBubble.jsx` (`BubbleIcon`, `ChevronLeftIcon`, `ChevronRightIcon`, `XIcon`, `ImageIcon`, `SendIcon`, `RemoveIcon`) verbatim. Add two new icons for later tasks:

```jsx
export function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
      <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
    </svg>
  )
}
export function ShrinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
      <line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>
    </svg>
  )
}
```

- [ ] **Step 2: Create `ConversationThread.jsx`**

Move `formatTime`, `formatDateLabel`, `isSameDay`, `TypingIndicator`, `DateSeparator`, `MessageBubble`, and the `ChatPanelBody` body into `src/components/chat/ConversationThread.jsx`. Rename `ChatPanelBody` → `ConversationThread` and import icons from `./chatIcons`. Keep the **same props** it already receives (`messages`, `hasLoaded`, `typingNames`, `imagePreview`, `text`, `sending`, `onTextChange`, `onKeyDown`, `onSend`, `onImageFile`, `onClearImage`, `onMediaLoad`, `scrollRef`, `textareaRef`, `fileRef`, `userId`) plus one new optional prop `placeholder` (string, default `'Message everyone…'`) used for the textarea placeholder so DMs can say `Message <name>…`. Replace the hardcoded `placeholder="Message everyone…"` with `placeholder={placeholder}`.

- [ ] **Step 3: Preserve the existing dual scroll-ref approach**

The baseline already resolves the old `scrollRef` issue: `ChatBubble` holds separate `desktopScrollRef`/`mobileScrollRef`, `scrollToBottom` scrolls both (the hidden one reports `scrollHeight 0` and is a no-op), and each `ChatPanelBody` is passed its own ref via `scrollRef={desktopScrollRef}` / `scrollRef={mobileScrollRef}`. **Keep this pattern** — `ConversationThread` still takes a `scrollRef` prop (it is **not** part of the shared `panelBodyProps`; it's passed per-instance). Do not consolidate or delete the dual refs.

- [ ] **Step 4: Rewire `ChatBubble.jsx`**

Import `ConversationThread` from `./chat/ConversationThread` and icons from `./chat/chatIcons`. Replace both `<ChatPanelBody {...panelBodyProps} />` usages with `<ConversationThread {...panelBodyProps} />`. Remove the now-moved local definitions. No other behavior changes.

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: builds clean, no unused-import or undefined-reference errors.

- [ ] **Step 6: Manual verification (group chat unchanged)**

Run: `npm run dev`. As a logged-in user: open chat → messages load and pin to bottom → send a text message → send an image → typing indicator appears from a second browser → unread red dot behaves as before. Confirm desktop sidebar collapse/expand tab and mobile bubble both still work.

- [ ] **Step 7: Commit**

```bash
git add src/components/chat/chatIcons.jsx src/components/chat/ConversationThread.jsx src/components/ChatBubble.jsx
git commit -m "refactor(chat): extract ConversationThread + icons, fix scroll ref"
```

---

## Task 4: Group/Direct tabs in the panel

Add the tab bar and a `activeTab` state. Direct tab shows an empty-state placeholder for now (populated in Task 5). Group tab renders exactly as today.

**Files:**
- Modify: `src/components/ChatBubble.jsx`

- [ ] **Step 1: Add tab state + header tabs**

In `ChatBubble`, add `const [activeTab, setActiveTab] = useState('group')` (`'group' | 'direct'`). Under the existing panel header (both desktop and mobile variants), render a tab bar:

```jsx
<div className="flex-none flex border-b border-cp-border">
  {['group', 'direct'].map(tab => (
    <button
      key={tab}
      onClick={() => setActiveTab(tab)}
      className={`flex-1 py-2 text-xs font-medium transition-colors ${
        activeTab === tab
          ? 'text-cp-text border-b-2 border-cp-accent'
          : 'text-cp-muted hover:text-cp-text'
      }`}
    >
      {tab === 'group' ? 'Group' : 'Direct'}
    </button>
  ))}
</div>
```

- [ ] **Step 2: Conditionally render body by tab**

When `activeTab === 'group'`, render the `ConversationThread` (current group chat). When `activeTab === 'direct'`, render a placeholder for now:

```jsx
{activeTab === 'direct' && (
  <div className="flex-1 flex items-center justify-center text-cp-muted text-xs">
    Direct messages — coming up
  </div>
)}
```

Keep the group `ConversationThread` mounted but hidden when on the Direct tab (so its message state/scroll isn't lost) — wrap it with `className={activeTab === 'group' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}` rather than unmounting.

- [ ] **Step 3: Build + manual check**

Run: `npm run build`, then `npm run dev`. Confirm tabs switch, Group tab is unchanged, Direct tab shows the placeholder, switching back to Group preserves scroll position.

- [ ] **Step 4: Commit**

```bash
git add src/components/ChatBubble.jsx
git commit -m "feat(chat): add Group/Direct tabs to chat panel"
```

---

## Task 5: DM list, compose picker, open + send (no realtime yet)

**Files:**
- Create: `src/components/chat/ConversationList.jsx`
- Create: `src/components/chat/NewDmPicker.jsx`
- Modify: `src/components/ChatBubble.jsx`

- [ ] **Step 1: `ConversationList.jsx`**

A presentational list used by the Direct tab (and later the fullscreen rail). Props: `threads` (array from `listThreads()`), `activeThreadId`, `onSelect(threadId)`, `onCompose()`, `unreadFor(threadId)` (→ bool), `showGroupRow` (bool, default false — true only in fullscreen rail), `groupHasUnread`, `onSelectGroup`. Render a compose button row at top, then optionally the pinned Group row, then a row per thread:

```jsx
<button onClick={() => onSelect(t.thread_id)}
  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-cp-elevated transition-colors ${
    activeThreadId === t.thread_id ? 'bg-cp-elevated' : ''}`}>
  <img src={t.other_avatar || fallbackAvatar(t.other_name)} alt=""
       className="w-9 h-9 rounded-full object-cover flex-none" />
  <div className="min-w-0 flex-1">
    <div className="text-[13px] text-cp-text font-medium truncate">{t.other_name}</div>
    <div className="text-[11px] text-cp-muted truncate">{previewOf(t)}</div>
  </div>
  {unreadFor(t.thread_id) && <span className="w-2 h-2 rounded-full bg-red-500 flex-none" />}
</button>
```

Define helpers in the file: `fallbackAvatar(name)` → `https://i.pravatar.cc/150?img=${(name?.charCodeAt(0)||65)%68+1}` (matches `normalizeProfile`), and `previewOf(t)` → `t.last_image_url && !t.last_content ? '📷 Photo' : (t.last_content || 'No messages yet')`.

- [ ] **Step 2: `NewDmPicker.jsx`**

A modal listing recipients from `listRecipients()` with a search box. Props: `onPick(userId)`, `onClose()`. On mount, call `listRecipients()` into state; render a text filter (case-insensitive on `full_name`) and a scrollable list of avatar+name rows; clicking a row calls `onPick(user_id)`. Use the existing modal styling pattern (`fixed inset-0 z-50 ... bg-black/75 backdrop-in` + a `bg-cp-card border border-cp-border rounded-2xl modal-in` panel — see `HomePage.jsx` `ConfirmModal`). Show a spinner while loading and an empty state if no recipients.

- [ ] **Step 3: Wire DM state into `ChatBubble`**

Add state: `threads`, `activeThreadId`, `threadMessages` (map `threadId -> messages[]`), `pickerOpen`. Import `listThreads`, `getOrCreateThread`, `fetchThreadMessages`, `sendDirectMessage`, `uploadDmImage` from `../lib/dm`.

- On entering the Direct tab (or chat open), call `listThreads()` → `setThreads`.
- `openThread(threadId)`: `setActiveThreadId(threadId)`; if messages not cached, `fetchThreadMessages` → cache; mark read (Task 7).
- `handleCompose()`: open `NewDmPicker`. `onPick(userId)`: `const id = await getOrCreateThread(userId)`; refresh `threads`; `openThread(id)`; close picker.
- Direct tab renders: if `activeThreadId` → a `ConversationThread` bound to that thread (with a `‹ Back` button in a sub-header that clears `activeThreadId`); else → `ConversationList`.

- [ ] **Step 4: DM send path**

Generalize the send handler so it targets either the group (`messages` table, existing code) or the active DM thread. For a DM, build the bound props for `ConversationThread`:

```jsx
const dmSend = async () => {
  const trimmed = text.trim()
  if ((!trimmed && !imageFile) || sending) return
  setSending(true)
  try {
    let imageUrl = null
    if (imageFile) imageUrl = await uploadDmImage({ threadId: activeThreadId, file: imageFile })
    const row = await sendDirectMessage({
      threadId: activeThreadId, senderId: userId,
      senderName: currentUser?.name || 'Unknown',
      content: trimmed || null, imageUrl,
    })
    setThreadMessages(prev => ({
      ...prev,
      [activeThreadId]: [...(prev[activeThreadId] || []).filter(m => m.id !== row.id), row],
    }))
    setText(''); clearImage()
    listThreads().then(setThreads) // refresh preview/order
  } catch (e) { console.error('DM send failed:', e) }
  finally { setSending(false) }
}
```

Reuse the existing `handleTextChange`/`handleImageFile`/`clearImage`. Build the DM list items with the **same** `listItems` date/grouping logic already in `ChatBubble` (extract that grouping into a small helper `buildListItems(messages)` and use it for both group and DM).

- [ ] **Step 5: Build + manual (two accounts)**

Run `npm run build`, then `npm run dev`. **Requires migration 018 applied.** With account A: Direct tab → compose → pick account B → thread opens → send text + image. Log in as B in a second browser → Direct tab → see the thread → open → messages present (no realtime yet, so B may need to re-open/refresh). Verify the DM textarea placeholder reads `Message <name>…`.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/ConversationList.jsx src/components/chat/NewDmPicker.jsx src/components/ChatBubble.jsx
git commit -m "feat(dm): DM list, compose picker, open + send threads"
```

---

## Task 6: DM realtime (live receive) + typing indicators

**Files:**
- Modify: `src/components/ChatBubble.jsx`

- [ ] **Step 1: Verify realtime-RLS first**

With migration 018 live and two accounts, temporarily log every `direct_messages` INSERT received on a per-user channel (Step 2) and confirm account C (not a participant) receives **nothing** for A↔B threads, while B receives A's messages. If C receives others' rows, stop and switch to the per-open-thread fallback (`thread_id=eq.<id>` filter) described in the spec §7 before continuing.

- [ ] **Step 2: Per-user DM subscription**

In a `useEffect` keyed on `userId`, subscribe:

```jsx
useEffect(() => {
  if (!userId) return
  const ch = supabase
    .channel(`dm-user-${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' },
      ({ new: row }) => {
        if (row.sender_id === userId) return // our own send already handled
        setThreadMessages(prev => {
          const existing = prev[row.thread_id]
          if (!existing) return prev // not loaded yet; list refresh below covers preview
          if (existing.some(m => m.id === row.id)) return prev
          return { ...prev, [row.thread_id]: [...existing, row] }
        })
        // Refresh the thread list (preview + ordering). Unread state is
        // derived from this data + localStorage in Task 7 — no separate dot
        // state is needed here.
        listThreads().then(setThreads)
      })
    .subscribe()
  return () => supabase.removeChannel(ch)
}, [userId])
```

Add `activeThreadIdRef` (a `useRef` mirrored from `activeThreadId` via an effect, mirroring the existing `chatOpenRef` pattern) so the handler reads the current thread without re-subscribing.

- [ ] **Step 3: DM typing indicators**

When a DM thread is open, subscribe to `dm-typing-${activeThreadId}` (broadcast, `self:false`); broadcast `{ userId, name }` from the DM `onTextChange`, and feed received names into the same `typingUsers`/`TypingIndicator` mechanism the group chat uses (scope the typing state to the active conversation so group typing doesn't leak into DMs — key `typingUsers` by conversation or reset on conversation switch).

- [ ] **Step 4: Build + manual (two accounts)**

Run `npm run build`, then `npm run dev`. A and B in two browsers, both in their A↔B thread: A sends → B sees it appear live; A types → B sees "typing…"; B's DM list reorders/preview updates. Open a third account C and confirm it never receives A↔B messages.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatBubble.jsx
git commit -m "feat(dm): live message + typing realtime for DMs"
```

---

## Task 7: Unread dots (per-thread + combined button dot)

**Files:**
- Modify: `src/components/ChatBubble.jsx`

- [ ] **Step 1: Per-thread last-visit helpers**

```js
const dmVisitKey = (uid, threadId) => `cp-studios:dm-last-visit:${uid}:${threadId}`
const markDmRead = (threadId) => {
  if (userId) localStorage.setItem(dmVisitKey(userId, threadId), new Date().toISOString())
}
const isThreadUnread = (t) => {
  if (!userId || !t.last_message_at) return false
  if (t.last_sender_id === userId) return false
  const seen = localStorage.getItem(dmVisitKey(userId, t.thread_id))
  return new Date(t.last_message_at).getTime() > (seen ? new Date(seen).getTime() : 0)
}
```

- [ ] **Step 2: Mark read on open; pass `unreadFor` to the list**

Call `markDmRead(threadId)` inside `openThread`. Pass `unreadFor={(id) => isThreadUnread(threads.find(t => t.thread_id === id) || {})}` to `ConversationList`. Replace the Task 6 `setDmDot` placeholder with: on incoming DM for a non-active thread, just `listThreads().then(setThreads)` — `isThreadUnread` derives the dot from data + localStorage, so no separate dot state is needed.

- [ ] **Step 3: Combined button/tab dot**

Compute `anyDmUnread = threads.some(isThreadUnread)`. The existing `hasChatDot` tracks group unread. Show the floating-button / collapse-tab red dot when `hasChatDot || anyDmUnread`. Add a small red dot on the **Direct** tab label when `anyDmUnread`, and on the **Group** tab when `hasChatDot`.

- [ ] **Step 4: Build + manual**

Run `npm run build`, then `npm run dev`. B receives a DM while on the Group tab → Direct tab shows a dot + the thread row shows a dot + the chat button shows a dot. Opening the thread clears that thread's dot; the button dot clears once nothing is unread.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatBubble.jsx
git commit -m "feat(dm): per-thread and combined unread indicators"
```

---

## Task 8: Fullscreen / maximize

**Files:**
- Modify: `src/components/ChatBubble.jsx`
- Use: `ExpandIcon` / `ShrinkIcon` (from `chatIcons.jsx`, Task 3)

- [ ] **Step 1: Expanded state + header button**

Add `const [expanded, setExpanded] = useState(false)`. In the panel header, add a button before the close button: `{expanded ? <ShrinkIcon/> : <ExpandIcon/>}` toggling `setExpanded(v => !v)`. Reset `expanded` to `false` when the chat closes.

- [ ] **Step 2: Desktop maximized layout (two-pane)**

When `expanded` and on desktop (`lg+`), render the panel as an overlay `fixed inset-0 top-16 z-40` (keeps the 4rem navbar) instead of the 300px sidebar classes. Inside, a two-pane flex row:
- **Left rail** (`w-72 border-r border-cp-border overflow-y-auto`): render `ConversationList` with `showGroupRow`, `groupHasUnread={hasChatDot}`, `onSelectGroup={() => { setActiveTab('group'); setActiveThreadId(null) }}`, plus the DM rows. The Group/Direct tab bar is hidden in this mode (the rail replaces it).
- **Right pane** (`flex-1 flex flex-col min-h-0`): the active `ConversationThread` — group chat if no `activeThreadId` and group selected, else the active DM thread. Selecting a rail row sets the active conversation.

- [ ] **Step 3: Mobile maximized layout (full-screen single column)**

When `expanded` and on mobile (`<lg`), render the popup as `fixed inset-0 z-50` (edge-to-edge) instead of the `w-[350px] h-[480px]` popup, keeping the same tabs/list/thread single-column flow. The same `ShrinkIcon` button restores it to the floating popup.

- [ ] **Step 4: Build + manual (desktop + mobile)**

Run `npm run build`, then `npm run dev`. Desktop: maximize → two-pane overlay with navbar visible → switch between Group and a DM via the left rail → restore returns to the 300px sidebar. Narrow the window (or use device emulation): maximize → fills the screen single-column → restore returns to the floating popup. Confirm send/receive/typing/unread all still work in both maximized layouts.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatBubble.jsx
git commit -m "feat(chat): fullscreen two-pane (desktop) + edge-to-edge (mobile)"
```

---

## Task 9: Docs + final verification pass

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the realtime-channels table**

In `CLAUDE.md` → "Realtime channels in use", add rows for `dm-user-<uid>` (per-user DM message stream, `ChatBubble.jsx`) and `dm-typing-<threadId>` (DM typing broadcasts, `ChatBubble.jsx`).

- [ ] **Step 2: Full manual regression**

With migration 018 live, run through the spec §12 checklist: group chat unchanged; DM round-trip (compose → text + image → live receive → typing → unread clears); privacy (third account reads zero rows from `direct_messages`); fullscreen desktop two-pane + restore; mobile maximize + restore; navbar visible throughout.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record DM realtime channels"
```

---

## Self-review notes (for the executor)

- Every `dm.js` function used in Tasks 5–7 is defined in Task 2. The two new icons used in Task 8 are defined in Task 3.
- `buildListItems` (Task 5 Step 4) is the existing grouping logic extracted; reuse it for group + DM so the date separators / name-grouping match.
- Tasks 5–9 require migration 018 to be live for runtime verification; the code can be written and committed regardless, but don't mark manual-verification steps done until the migration is applied.

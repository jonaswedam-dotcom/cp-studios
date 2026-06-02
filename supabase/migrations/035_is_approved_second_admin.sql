-- ============================================================
-- 035 – Make admin@cpstudios.app a real admin (DB side)
-- Run in the Supabase SQL Editor AFTER 017 (and 001–034), in order.
-- Idempotent: safe to re-run.
-- ============================================================
--
-- The app's ADMIN_EMAILS (src/context/AppContext.jsx) has TWO admins:
--   ['jonas.wedam@gmail.com', 'admin@cpstudios.app']
-- but the DATABASE only ever recognized 'jonas.wedam@gmail.com'. Two consequences:
--
--   1. GROUP CHAT (the reported bug). Migration 017 gated the `messages` table
--      (SELECT + INSERT) behind public.is_approved(), which only passed jonas or
--      a pending_users row with status='approved'. So admin@cpstudios.app could no
--      longer read or send group chat — "messages don't send".
--   2. APPROVALS. The pending_users policies (migration 001) only let jonas read
--      the full pending list, approve/reject, or delete. So admin@cpstudios.app
--      sees an empty Admin panel and its approve clicks silently do nothing (RLS).
--
-- This migration adds admin@cpstudios.app everywhere jonas is named, so the client
-- (ADMIN_EMAILS) and the database agree (CLAUDE.md §1). After it runs,
-- admin@cpstudios.app can use group chat AND approve members from the Admin panel.

-- ── 1. Group chat / content gate ────────────────────────────────────────────
create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (auth.jwt() ->> 'email') in ('jonas.wedam@gmail.com', 'admin@cpstudios.app')
    or exists (
      select 1
      from public.pending_users pu
      where pu.user_id = auth.uid()
        and pu.status  = 'approved'
    );
$$;

grant execute on function public.is_approved() to authenticated, anon;

-- ── 2. Member approvals: recognize both admins on pending_users ──────────────
-- Recreate the three admin-scoped policies (from 001) with a 2-email list.
drop policy if exists "user or admin can read pending" on public.pending_users;
create policy "user or admin can read pending"
  on public.pending_users for select
  using (
    auth.uid() = user_id
    or (auth.jwt() ->> 'email') in ('jonas.wedam@gmail.com', 'admin@cpstudios.app')
  );

drop policy if exists "admin can update pending" on public.pending_users;
create policy "admin can update pending"
  on public.pending_users for update
  using ((auth.jwt() ->> 'email') in ('jonas.wedam@gmail.com', 'admin@cpstudios.app'));

drop policy if exists "admin can delete pending" on public.pending_users;
create policy "admin can delete pending"
  on public.pending_users for delete
  using ((auth.jwt() ->> 'email') in ('jonas.wedam@gmail.com', 'admin@cpstudios.app'));

-- ── 3. (Optional) Approve members who got locked out of group chat by 017 ────
-- After 017, anyone without an approved pending_users row can't read/send group
-- messages. Once §2 above is live, admin@cpstudios.app can do this from the Admin
-- panel UI. To do it here instead, list who would currently fail is_approved():
--
--   select u.id, u.email, coalesce(p.status, '(no pending_users row)') as status
--   from auth.users u
--   left join public.pending_users p on p.user_id = u.id
--   where u.email not in ('jonas.wedam@gmail.com','admin@cpstudios.app')
--     and (p.status is null or p.status <> 'approved')
--   order by status, u.email;
--
-- Then approve each TRUSTED one:
--
--   update public.pending_users set status='approved'
--     where email in ('friend1@example.com','friend2@example.com');

-- NOTE: this does NOT touch the admin content-DELETE policies in 001/002 (delete
-- others' photos/comments). Those still name only jonas. The photo/profile UI is
-- removed from the app, so that gap is currently moot — flagging it, not fixing it.

-- ============================================================
-- 017 – Security hardening (move enforcement into the database)
-- Run in the Supabase SQL Editor AFTER 001–016, in order.
-- Idempotent: safe to re-run.
-- ============================================================
--
-- Fixes from the security review:
--   #1  Member-approval gate was CLIENT-SIDE ONLY. RLS only checked
--       `auth.role() = 'authenticated'`, so any signed-in user — including a
--       rejected/revoked one with a live session — could read/write data by
--       calling Supabase directly. This adds an is_approved() check to the
--       content tables (profiles, photos, likes, comments, messages) + storage.
--   #2  Storage objects had NO per-object owner check ("own objects" policies
--       only checked `authenticated`), and uploads were unrestricted by
--       type/size. Fixed with owner/admin-scoped update+delete policies and
--       bucket-level mime/size limits (SVG excluded — it can carry script).
--   #3  photos insert wasn't bound to the uploader. Fixed via with-check.
--   #6  comments_with_author leaked auth.users emails via view definer rights.
--       Fixed by dropping the email fallback and setting security_invoker.
--
-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️  LOCKOUT WARNING — DO THE BACKFILL BELOW *BEFORE* THE DDL  ⚠️      ║
-- ╚══════════════════════════════════════════════════════════════════════╝
-- After this runs, only the admin (by email) and users whose pending_users
-- row is status='approved' can read/write data. Approve current members first:
--
--   -- 1) Look at who exists and their status:
--   --    select user_id, email, status from public.pending_users order by status, email;
--   --
--   -- 2) Approve trusted members that are missing/pending:
--   --    update public.pending_users set status='approved'
--   --      where email in ('friend1@example.com','friend2@example.com');
--   --
--   -- 3) Find authenticated users with NO pending_users row (they WILL be locked
--   --    out — the admin does NOT need a row, it passes by email):
--   --    select u.id, u.email
--   --    from auth.users u
--   --    left join public.pending_users p on p.user_id = u.id
--   --    where p.user_id is null;
--   --
--   --    For each trusted one, give them an approved row:
--   --    insert into public.pending_users (user_id, email, username, status)
--   --    select id, email, split_part(email,'@',1), 'approved'
--   --    from auth.users where id = '<that-user-uuid>';
-- ============================================================


-- ── Approval helper ─────────────────────────────────────────
-- SECURITY DEFINER so it can read pending_users regardless of the caller's RLS.
-- auth.uid()/auth.jwt() still reflect the CALLING user inside a definer fn.
create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (auth.jwt() ->> 'email') = 'jonas.wedam@gmail.com'
    or exists (
      select 1
      from public.pending_users pu
      where pu.user_id = auth.uid()
        and pu.status  = 'approved'
    );
$$;

grant execute on function public.is_approved() to authenticated, anon;


-- ── Replace SELECT + INSERT policies on the content tables ──────────────────
-- Drop EVERY existing select/insert policy first so we never leave a permissive
-- one OR'd alongside the new gated policy (this is the bug CLAUDE.md §2 warns
-- about, and how the original approval gap slipped through).
do $$
declare
  r record;
begin
  for r in
    select tablename, policyname
    from   pg_policies
    where  schemaname = 'public'
      and  tablename in ('profiles','photos','likes','comments','messages')
      and  cmd in ('SELECT','INSERT')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- profiles
create policy "approved can read profiles"
  on public.profiles for select using (public.is_approved());
create policy "approved can insert profiles"
  on public.profiles for insert with check (public.is_approved());

-- photos  (#3: bind the row to the uploader)
create policy "approved can read photos"
  on public.photos for select using (public.is_approved());
create policy "approved can insert own photos"
  on public.photos for insert
  with check (public.is_approved() and auth.uid() = uploader_id);

-- likes
create policy "approved can read likes"
  on public.likes for select using (public.is_approved());
create policy "approved can insert own like"
  on public.likes for insert
  with check (public.is_approved() and auth.uid() = user_id);

-- comments
create policy "approved can read comments"
  on public.comments for select using (public.is_approved());
create policy "approved can insert own comment"
  on public.comments for insert
  with check (public.is_approved() and auth.uid() = user_id);

-- messages (private group chat)
create policy "approved can read messages"
  on public.messages for select using (public.is_approved());
create policy "approved can insert own message"
  on public.messages for insert
  with check (public.is_approved() and auth.uid() = user_id);

-- NOTE: UPDATE/DELETE policies are left untouched on purpose — they already
-- enforce ownership (owner can update profile / uploader-or-admin can delete /
-- user can delete own like|comment). is_approved() returns true for the admin,
-- so admin delete policies keep working.


-- ── Storage: per-object ownership + approved uploads (#2) ────────────────────
drop policy if exists "authenticated can upload"             on storage.objects;
drop policy if exists "authenticated can update own objects" on storage.objects;
drop policy if exists "authenticated can delete own objects" on storage.objects;

create policy "approved can upload to cp-studios"
  on storage.objects for insert
  with check (bucket_id = 'cp-studios' and public.is_approved());

create policy "owner or admin can update cp-studios objects"
  on storage.objects for update
  using (
    bucket_id = 'cp-studios'
    and (owner = auth.uid() or (auth.jwt() ->> 'email') = 'jonas.wedam@gmail.com')
  );

create policy "owner or admin can delete cp-studios objects"
  on storage.objects for delete
  using (
    bucket_id = 'cp-studios'
    and (owner = auth.uid() or (auth.jwt() ->> 'email') = 'jonas.wedam@gmail.com')
  );

-- Public read ("public read cp-studios") is intentionally KEPT — images must be
-- publicly viewable. Restrict what can be stored at the bucket level instead:
update storage.buckets
  set file_size_limit    = 10485760,  -- 10 MB
      allowed_mime_types = array['image/jpeg','image/png','image/gif','image/webp','image/avif']
  where id = 'cp-studios';


-- ── comments_with_author: stop leaking auth.users emails (#6) ────────────────
-- security_invoker makes the view respect the caller's RLS (so it can't be used
-- to bypass the comments approval gate either). Email fallback removed; fall
-- back to the canonical wallets.display_name, then 'Unknown'.
create or replace view public.comments_with_author
  with (security_invoker = true) as
  select
    c.id,
    c.photo_id,
    c.user_id,
    c.content,
    c.created_at,
    coalesce(
      (select p.full_name    from public.profiles p where p.user_id = c.user_id limit 1),
      (select w.display_name from public.wallets  w where w.user_id = c.user_id limit 1),
      'Unknown'
    ) as author_name
  from public.comments c;

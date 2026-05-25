-- ============================================================
-- 002 – Admin delete policies
-- Run in Supabase SQL Editor after 001_initial.sql
-- ============================================================

-- Allow admin to delete any photo (in addition to the uploader)
drop policy if exists "uploader can delete photo" on public.photos;

create policy "uploader or admin can delete photo"
  on public.photos for delete
  using (
    auth.uid() = uploader_id
    or (auth.jwt() ->> 'email') = 'jonas.wedam@gmail.com'
  );

-- Allow admin to delete any profile
-- (no delete policy existed before – now only admin can delete profiles)
drop policy if exists "owner can delete profile" on public.profiles;

create policy "admin can delete profile"
  on public.profiles for delete
  using (
    (auth.jwt() ->> 'email') = 'jonas.wedam@gmail.com'
  );

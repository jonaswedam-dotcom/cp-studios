-- ============================================================
-- CP Studios – initial schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- ── Tables ──────────────────────────────────────────────────

create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  full_name   text not null,
  bio         text not null default '',
  avatar_url  text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.photos (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  uploader_id uuid references auth.users(id) on delete set null,
  image_url   text not null,
  caption     text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.likes (
  id         uuid primary key default gen_random_uuid(),
  photo_id   uuid not null references public.photos(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (photo_id, user_id)
);

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  photo_id   uuid not null references public.photos(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pending_users (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  email      text not null,
  username   text not null default '',
  created_at timestamptz not null default now(),
  status     text not null default 'pending' check (status in ('pending', 'approved', 'rejected'))
);

-- ── Convenience view: comments with author name ─────────────

create or replace view public.comments_with_author as
  select
    c.id,
    c.photo_id,
    c.user_id,
    c.content,
    c.created_at,
    coalesce(
      (select p.full_name from public.profiles p where p.user_id = c.user_id limit 1),
      split_part((select email from auth.users u where u.id = c.user_id), '@', 1),
      'Unknown'
    ) as author_name
  from public.comments c;

-- ── Row-Level Security ───────────────────────────────────────

alter table public.profiles     enable row level security;
alter table public.photos       enable row level security;
alter table public.likes        enable row level security;
alter table public.comments     enable row level security;
alter table public.pending_users enable row level security;

-- profiles
create policy "authenticated can read profiles"
  on public.profiles for select
  using (auth.role() = 'authenticated');

create policy "authenticated can insert profiles"
  on public.profiles for insert
  with check (auth.role() = 'authenticated');

create policy "owner can update profile"
  on public.profiles for update
  using (auth.uid() = user_id);

-- photos
create policy "authenticated can read photos"
  on public.photos for select
  using (auth.role() = 'authenticated');

create policy "authenticated can insert photos"
  on public.photos for insert
  with check (auth.role() = 'authenticated');

create policy "uploader can delete photo"
  on public.photos for delete
  using (auth.uid() = uploader_id);

-- likes
create policy "authenticated can read likes"
  on public.likes for select
  using (auth.role() = 'authenticated');

create policy "authenticated can insert like"
  on public.likes for insert
  with check (auth.uid() = user_id);

create policy "user can delete own like"
  on public.likes for delete
  using (auth.uid() = user_id);

-- comments
create policy "authenticated can read comments"
  on public.comments for select
  using (auth.role() = 'authenticated');

create policy "authenticated can insert comment"
  on public.comments for insert
  with check (auth.uid() = user_id);

create policy "user can delete own comment"
  on public.comments for delete
  using (auth.uid() = user_id);

-- pending_users
create policy "anyone can self-insert pending"
  on public.pending_users for insert
  with check (auth.uid() = user_id);

create policy "user or admin can read pending"
  on public.pending_users for select
  using (
    auth.uid() = user_id
    or (auth.jwt() ->> 'email') = 'jonas.wedam@gmail.com'
  );

create policy "admin can update pending"
  on public.pending_users for update
  using ((auth.jwt() ->> 'email') = 'jonas.wedam@gmail.com');

create policy "admin can delete pending"
  on public.pending_users for delete
  using ((auth.jwt() ->> 'email') = 'jonas.wedam@gmail.com');

-- ── Storage bucket ───────────────────────────────────────────

insert into storage.buckets (id, name, public)
  values ('cp-studios', 'cp-studios', true)
  on conflict (id) do nothing;

create policy "authenticated can upload"
  on storage.objects for insert
  with check (bucket_id = 'cp-studios' and auth.role() = 'authenticated');

create policy "public read cp-studios"
  on storage.objects for select
  using (bucket_id = 'cp-studios');

create policy "authenticated can update own objects"
  on storage.objects for update
  using (bucket_id = 'cp-studios' and auth.role() = 'authenticated');

create policy "authenticated can delete own objects"
  on storage.objects for delete
  using (bucket_id = 'cp-studios' and auth.role() = 'authenticated');

-- ── Enable Realtime ──────────────────────────────────────────
-- Run these in the Supabase Dashboard → Database → Replication
-- or uncomment and run here:

-- alter publication supabase_realtime add table public.likes;
-- alter publication supabase_realtime add table public.comments;

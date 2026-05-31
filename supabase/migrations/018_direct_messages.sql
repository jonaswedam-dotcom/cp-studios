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
-- DM access is intentionally PARTICIPANTS-ONLY (no is_approved() gate). 017's
-- is_approved() is not yet live and currently names only jonas.wedam@gmail.com,
-- so gating here would lock out admin@cpstudios.app and couple this migration
-- to 017. Approval-gating DMs is a documented follow-up to apply once
-- is_approved() includes all admins (see docs/DATABASE.md security gaps).
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
    u.id                                                                          as user_id,
    coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1), 'Member') as full_name,
    coalesce(u.raw_user_meta_data->>'avatar_url', '')                             as avatar_url
  from auth.users u
  where u.id <> auth.uid()
    and (
      exists (select 1 from public.pending_users pu
                where pu.user_id = u.id and pu.status = 'approved')
      or u.email in ('jonas.wedam@gmail.com', 'admin@cpstudios.app')
    )
  order by full_name;
$$;
grant execute on function public.list_dm_recipients() to authenticated;

-- ── Realtime ─────────────────────────────────────────────────
-- Guarded so re-running this migration doesn't error with
-- "relation is already member of publication" (cf. 017's "safe to re-run").
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'direct_messages'
  ) then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
end $$;

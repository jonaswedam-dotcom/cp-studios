-- ── wallets ──────────────────────────────────────────────────────────────────
create table if not exists wallets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid unique not null references auth.users on delete cascade,
  balance    integer not null default 1000,
  created_at timestamptz default now()
);

alter table wallets enable row level security;

-- Any authenticated user can read wallets (for the leaderboard)
create policy "wallets_select_authenticated"
  on wallets for select
  to authenticated
  using (true);

-- Users can only insert their own wallet row
create policy "wallets_insert_own"
  on wallets for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Users can only update their own wallet row
create policy "wallets_update_own"
  on wallets for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── game_history ──────────────────────────────────────────────────────────────
create table if not exists game_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  game       text not null,
  bet        integer not null,
  result     text not null check (result in ('win', 'loss', 'push')),
  payout     integer not null default 0,
  created_at timestamptz default now()
);

alter table game_history enable row level security;

-- Users can only insert their own game history rows
create policy "game_history_insert_own"
  on game_history for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Users can only read their own game history rows
create policy "game_history_select_own"
  on game_history for select
  to authenticated
  using (auth.uid() = user_id);

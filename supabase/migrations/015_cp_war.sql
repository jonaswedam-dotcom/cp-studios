-- Migration 015: CP War – territory conquest game
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.war_players (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  color         text NOT NULL,
  starting_q    integer,
  starting_r    integer,
  is_alive      boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.war_tiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  q           integer NOT NULL,
  r           integer NOT NULL,
  owner_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_name  text,
  troop_count integer NOT NULL DEFAULT 0,
  color       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (q, r)
);

CREATE TABLE IF NOT EXISTS public.war_movements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_q      integer NOT NULL,
  from_r      integer NOT NULL,
  to_q        integer NOT NULL,
  to_r        integer NOT NULL,
  troop_count integer NOT NULL,
  status      text NOT NULL DEFAULT 'moving'
                CHECK (status IN ('moving','arrived','cancelled')),
  arrives_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS war_tiles_owner_idx      ON public.war_tiles(owner_id);
CREATE INDEX IF NOT EXISTS war_movements_player_idx ON public.war_movements(player_id);
CREATE INDEX IF NOT EXISTS war_movements_status_idx ON public.war_movements(status, arrives_at);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.war_players   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.war_tiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.war_movements ENABLE ROW LEVEL SECURITY;

-- war_players
CREATE POLICY "war_players_select" ON public.war_players
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "war_players_insert" ON public.war_players
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "war_players_update" ON public.war_players
  FOR UPDATE USING (auth.uid() = user_id);

-- war_tiles: everyone can read; anyone authenticated can write
-- (combat resolution runs client-side and touches enemy tiles, so we need broad write)
CREATE POLICY "war_tiles_select" ON public.war_tiles
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "war_tiles_insert" ON public.war_tiles
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "war_tiles_update" ON public.war_tiles
  FOR UPDATE USING (auth.role() = 'authenticated');

-- war_movements
CREATE POLICY "war_movements_select" ON public.war_movements
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "war_movements_insert" ON public.war_movements
  FOR INSERT WITH CHECK (auth.uid() = player_id);

CREATE POLICY "war_movements_update" ON public.war_movements
  FOR UPDATE USING (auth.uid() = player_id);

-- ── Realtime ──────────────────────────────────────────────────────────────────
-- Run these in the Supabase dashboard under Database → Replication, or via SQL:
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.war_tiles;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.war_movements;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.war_players;

-- Migration 035: Reset the CP War board for the country-quarters map (CP War 3.0).
-- The territory model changed from ~4,600 admin-1 provinces to ~1,000 country quarters
-- (region ids went from adm1 codes like 'FR1' to quarter ids like 'FRA_NW'). Every existing
-- war_regions / war_movements / war_buildings row references a region id that no longer
-- exists in the bundled province graph, so this wipes the board and lets everyone respawn
-- onto the new map via war_spawn().
-- One-off, manual, idempotent (TRUNCATE is naturally re-runnable).
-- COINS ARE UNTOUCHED: wallet balances live in public.wallets, not here.
-- ─────────────────────────────────────────────────────────────────────────────

-- Single statement so mutual FKs between these tables don't block the truncate;
-- RESTART IDENTITY resets the war_events id sequence; CASCADE covers any dependents.
truncate table
  public.war_movements,
  public.war_buildings,
  public.war_regions,
  public.war_events,
  public.war_players
  restart identity cascade;

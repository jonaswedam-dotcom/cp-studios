-- Migration 053: CP War write lockdown — revoke the client's direct table writes. Idempotent.
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  APPLY LAST. Only after 052 is live AND the RPC-based client (WarPage.jsx     ║
-- ║  calling war_buy_units / war_send_units / war_build / war_upgrade) is         ║
-- ║  deployed to EVERY frontend that hits this database (Jonas's prod via a       ║
-- ║  push to main, and cp-studios-pi via `vercel deploy --prod`).                 ║
-- ║                                                                              ║
-- ║  This is the breaking, cheat-closing migration. Until it is applied, the      ║
-- ║  free-army / forged-conquest / free-buildings exploits stay OPEN (old cached  ║
-- ║  bundles + raw anon-key calls can still write the war tables directly).       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- ─────────────────────────────────────────────────────────────────────────────
-- Mirrors the wallet lockdown in 045 and the war_players lockdown in 028:
-- table-level revoke from BOTH client roles (a column-level revoke wouldn't stop a
-- blanket grant; anon must be covered even though RLS also blocks it). All war
-- mutation now flows through SECURITY DEFINER functions (war_spawn, war_buy_units,
-- war_send_units, war_build, war_upgrade, war_collect_income) and the war_tick()
-- cron job, which run as the table owner and are UNAFFECTED by these revokes.
-- SELECT stays granted so the client can still read/sync the live game state.
-- ─────────────────────────────────────────────────────────────────────────────

-- Free-army exploit: clients could set their own soldier/tank/jet to any value, and
-- claim unclaimed regions, by writing this table directly. Buying/respawn now go
-- through war_buy_units; movement debits go through war_send_units; the tick does all
-- cross-player writes.
revoke insert, update on public.war_regions from authenticated, anon;

-- Free-buildings / income-mint exploit: clients could insert buildings and bump levels
-- for free. Now via war_build / war_upgrade. The tick still transfers/downgrades
-- buildings on capture (as definer). Client never deletes buildings, so revoke delete too.
revoke insert, update, delete on public.war_buildings from authenticated, anon;

-- Forged-conquest exploit: clients could insert a movement with a phantom `units` stack.
-- Now via war_send_units, which debits the source. The tick marks rows arrived (as definer).
revoke insert, update on public.war_movements from authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION (run in the SQL editor / Management API after applying):
--   Confirm `authenticated` has NO insert/update on these tables, then confirm a
--   simulated client write is rejected, e.g. in a rolled-back transaction:
--     begin;
--       set local role authenticated;
--       set local request.jwt.claims = '{"sub":"<any-uuid>","role":"authenticated"}';
--       update public.war_regions set soldier = 999999999 where region_id = '<any>';
--       -- expected: ERROR: permission denied for table war_regions
--     rollback;
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (re-opens the exploits — only for an emergency client revert):
--   grant insert, update on public.war_regions   to authenticated;
--   grant insert, update, delete on public.war_buildings to authenticated;
--   grant insert, update on public.war_movements to authenticated;
-- ─────────────────────────────────────────────────────────────────────────────

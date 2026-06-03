-- Migration 054: OPTIONAL post-cutover integrity reset. DESTRUCTIVE. NOT auto-applied.
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  DO NOT run this as part of the security cutover. The fix (052 + 053 + the    ║
-- ║  RPC client) CLOSES the exploits for the future on its own. This file only    ║
-- ║  exists to ERASE the cheated state left behind from the window when the war   ║
-- ║  economy was client-authoritative (armies/buildings inflated to absurd        ║
-- ║  values, regions grabbed for free). Because cheated and legit progress are    ║
-- ║  indistinguishable, the only clean remedy is a full season wipe — everyone    ║
-- ║  re-joins and re-spawns fresh. That is a PRODUCT decision: run it deliberately ║
-- ║  (and tell players) AFTER 053 is live, or skip it and let the season ride.    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- Children first (no cross-table FKs between these, but order defensively).
delete from public.war_movements;
delete from public.war_buildings;
delete from public.war_events;
delete from public.war_regions;
delete from public.war_players;   -- players re-join + re-spawn (with a fresh shield) on next load

-- COINS: war loot + bank income fed real wallet balances, so a thorough reset may also
-- want to reset wallets. That is a separate concern (casino balances too) — use the
-- existing 046_reset_money.sql rather than touching wallets here.

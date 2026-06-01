-- Migration 029: one building of each type per region. Idempotent.
-- Without this, a double-click or concurrent insert can create two rows for the same
-- (region_id, type). The tick uses sum(level) for bunker/antiair/lab/factory/bank, so
-- duplicates silently inflate the modifier (and JS read paths disagree). Enforce uniqueness.

-- 1) Collapse any pre-existing duplicates: keep the highest level per (region_id, type),
--    breaking ties by the smaller id. (No-op on a clean DB.)
delete from public.war_buildings b
using public.war_buildings b2
where b.region_id = b2.region_id
  and b.type = b2.type
  and (b.level < b2.level or (b.level = b2.level and b.id > b2.id));

-- 2) Enforce uniqueness going forward.
alter table public.war_buildings drop constraint if exists war_buildings_region_type_unique;
alter table public.war_buildings add  constraint war_buildings_region_type_unique unique (region_id, type);

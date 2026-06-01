-- Migration 028: server-authoritative spawn + shield lockdown. Idempotent.
-- START_ARMY soldier=500 MUST match src/war/units.js (parity.test.js).
create or replace function public.war_spawn(p_region text, p_country text, p_color text, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); existing text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  -- idempotent: if the player already exists, return their spawn region
  select spawn_region into existing from public.war_players where user_id = uid;
  if existing is not null then return existing; end if;
  -- region must be unclaimed
  if exists (select 1 from public.war_regions where region_id = p_region and owner_id is not null) then
    raise exception 'region taken';
  end if;
  insert into public.war_players (user_id, display_name, color, spawn_region, shield_until, last_income_at, last_active_at)
  values (uid, p_name, p_color, p_region, now() + interval '48 hours', now(), now())
  on conflict (user_id) do nothing;
  insert into public.war_regions (region_id, country_code, owner_id, owner_name, color, is_hq, soldier, tank, jet, warship, updated_at)
  values (p_region, p_country, uid, p_name, p_color, true, 500, 0, 0, 0, now())
  on conflict (region_id) do update
    set owner_id = excluded.owner_id, owner_name = excluded.owner_name, color = excluded.color,
        is_hq = true, soldier = 500, updated_at = now()
    where public.war_regions.owner_id is null;
  return p_region;
end;
$$;
revoke all on function public.war_spawn(text,text,text,text) from public;
grant execute on function public.war_spawn(text,text,text,text) to authenticated;

-- Lock down war_players: spawn + shield + vault + activity are now definer-only.
-- Table-level revoke (a column-level revoke wouldn't stop a blanket UPDATE grant),
-- then grant back ONLY the columns the client legitimately self-edits. The definer
-- functions (war_spawn, war_collect_income, war_tick) run as owner and are unaffected.
revoke insert, update on public.war_players from authenticated;
grant update (display_name, color, spawn_region) on public.war_players to authenticated;

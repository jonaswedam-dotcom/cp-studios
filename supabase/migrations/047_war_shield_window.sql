-- Migration 047: Shrink the attack-protection ("shield") window. Idempotent.
-- Run by hand in the Supabase SQL editor in numerical order (CLAUDE.md §5).
--
-- The shield is set once, at spawn, by war_spawn() (migration 028). It was 48 hours,
-- which left most players un-attackable and effectively froze the war. New policy:
--   * New players (future war_spawn calls): 1 hour of protection.
--   * Everyone currently shielded: cut down to at most 30 minutes from now.
-- The shield is enforced server-side in war_tick() (attacks bounce while
-- shield_until > now()). Nothing else needs to change: the client reads shield_until
-- live, so the UI countdown and attack gating follow automatically.

-- 1) New-player shield: 48h -> 1h. Byte-for-byte identical to the 028 definition
--    except the shield_until interval. (Privileges persist across create-or-replace;
--    the revoke/grant below are repeated for self-containment and are safe to re-run.)
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
  values (uid, p_name, p_color, p_region, now() + interval '1 hour', now(), now())
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

-- 2) Existing players: reduce any live shield to at most 30 minutes from now.
--    least() only ever shortens -- a player with <30m left keeps it, and already-expired
--    or never-shielded rows (past timestamp / null) are untouched. Re-running is stable.
update public.war_players
set shield_until = least(shield_until, now() + interval '30 minutes')
where shield_until is not null;

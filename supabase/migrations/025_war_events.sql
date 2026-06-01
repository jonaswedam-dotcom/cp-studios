-- Migration 025: CP War activity log. Idempotent.
create table if not exists public.war_events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  player_id  uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('captured','lost','defended','attack_failed','bounced','eliminated')),
  region_id  text,
  detail     jsonb not null default '{}'::jsonb
);
create index if not exists war_events_player_idx on public.war_events(player_id, created_at desc);

alter table public.war_events enable row level security;
drop policy if exists war_events_select on public.war_events;
create policy war_events_select on public.war_events
  for select using (player_id = auth.uid());
-- No client insert/update/delete: only the SECURITY DEFINER tick writes/prunes.

-- Insert helper, used by war_tick(). SECURITY DEFINER so RLS doesn't block the tick.
create or replace function public.war_log_event(p_player uuid, p_kind text, p_region text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.war_events(player_id, kind, region_id, detail)
  values (p_player, p_kind, p_region, coalesce(p_detail, '{}'::jsonb));
$$;
-- Lock down: only war_tick() (runs as owner) calls this. Without this revoke any
-- authenticated client could call it directly and forge events into ANY player's feed.
revoke all on function public.war_log_event(uuid, text, text, jsonb) from public;
revoke all on function public.war_log_event(uuid, text, text, jsonb) from anon, authenticated;

-- Realtime so clients get live toasts (client subscribes filtered by player_id).
do $$ begin
  alter publication supabase_realtime add table public.war_events;
exception when duplicate_object then null; end $$;

-- The world tick: resolve due movements, then accrue capped income, then refresh is_alive.
create or replace function public.war_tick() returns void
language plpgsql security definer set search_path = public as $$
declare
  mv          record;
  dest        record;
  atk_lab     int;
  attack_mult numeric;
  unit_str    numeric;
  a_str       numeric;
  d_str       numeric;
  def_bunker  int;
  def_aa      int;
  def_mult    numeric;
  aa          numeric;
  def_shield  timestamptz;
  def_active  timestamptz;
  surv        int;
  ratio       numeric;
  def_raw     numeric;
  loot        int;
  aname       text;
  acolor      text;
begin
  -- 1) Resolve arrivals (oldest first; skip rows another tick already grabbed).
  for mv in
    select * from public.war_movements
    where status = 'moving' and arrives_at <= now()
    order by arrives_at
    for update skip locked
  loop
    update public.war_movements set status = 'arrived' where id = mv.id;

    select display_name, color into aname, acolor from public.war_players where user_id = mv.player_id;
    select coalesce(sum(level), 0) into atk_lab from public.war_buildings where owner_id = mv.player_id and type = 'lab';
    attack_mult := 1 + 0.1 * atk_lab;
    unit_str := public.war_unit_strength(mv.unit_type);
    a_str := mv.count * unit_str * attack_mult;

    select * into dest from public.war_regions where region_id = mv.to_region for update;

    if not found or dest.owner_id is null then
      ------------------------------------------------- unclaimed: fight the garrison
      d_str := public.war_neutral_soldiers(mv.to_region); -- soldiers, strength 1
      if a_str > d_str then
        surv := greatest(1, floor(mv.count * (a_str - d_str) / a_str)); -- ensureSurvivor parity
        insert into public.war_regions(region_id, country_code, owner_id, owner_name, color, is_hq, soldier, tank, jet, warship, updated_at)
        values (mv.to_region, null, mv.player_id, aname, acolor, false, 0, 0, 0, 0, now())
        on conflict (region_id) do update
          set owner_id = excluded.owner_id, owner_name = excluded.owner_name, color = excluded.color,
              is_hq = false, soldier = 0, tank = 0, jet = 0, warship = 0, updated_at = now();
        execute format('update public.war_regions set %I = %s, updated_at = now() where region_id = %L',
                       mv.unit_type, surv, mv.to_region);
        perform public.war_log_event(mv.player_id, 'captured', mv.to_region,
          jsonb_build_object('neutral', true, 'coins', 0));
      end if; -- else: attack failed, units lost

    elsif dest.owner_id = mv.player_id then
      ------------------------------------------------- reinforce own province
      execute format('update public.war_regions set %I = %I + %s, updated_at = now() where region_id = %L',
                     mv.unit_type, mv.unit_type, mv.count, mv.to_region);

    else
      ------------------------------------------------- enemy province
      select shield_until, last_active_at into def_shield, def_active
      from public.war_players where user_id = dest.owner_id;

      if def_shield is not null and def_shield > now() then
        -- shielded: bounce the units back home, no combat. Only if the origin is
        -- still owned by the sender (never gift units to whoever took it meanwhile).
        execute format('update public.war_regions set %I = %I + %s, updated_at = now() where region_id = %L and owner_id = %L',
                       mv.unit_type, mv.unit_type, mv.count, mv.from_region, mv.player_id);
        perform public.war_log_event(mv.player_id, 'bounced', mv.to_region, '{}'::jsonb);
      else
        select coalesce(sum(level), 0) into def_bunker from public.war_buildings where region_id = mv.to_region and type = 'bunker';
        select coalesce(sum(level), 0) into def_aa     from public.war_buildings where region_id = mv.to_region and type = 'antiair';
        def_mult := 1 + 0.5 * def_bunker;
        -- offline dug-in bonus: inactive > 24h defends 50% harder
        if def_active is null or def_active < now() - interval '24 hours' then def_mult := def_mult * 1.5; end if;
        aa := least(0.75, 0.25 * def_aa);
        if mv.unit_type = 'jet' then a_str := a_str * (1 - aa); end if;

        def_raw := dest.soldier * 1 + dest.tank * 5 + dest.jet * 3 + dest.warship * 2;
        d_str := def_raw * def_mult;

        if a_str > d_str then
          -- capture: attacker survivors (single unit type), spoils, building downgrade
          surv := greatest(1, floor(mv.count * (a_str - d_str) / a_str)); -- ensureSurvivor parity
          loot := floor(0.8 * def_raw * 5); -- lootFraction(full kill)=0.8 × defStrength × COIN_PER_STRENGTH(5)
          if loot > 0 then
            insert into public.wallets (user_id, balance) values (mv.player_id, loot)
            on conflict (user_id) do update set balance = public.wallets.balance + excluded.balance;
          end if;
          delete from public.war_buildings where region_id = mv.to_region and level <= 1;
          update public.war_buildings set level = level - 1, owner_id = mv.player_id where region_id = mv.to_region and level > 1;
          update public.war_regions
            set owner_id = mv.player_id, owner_name = aname, color = acolor, is_hq = false,
                soldier = 0, tank = 0, jet = 0, warship = 0, updated_at = now()
          where region_id = mv.to_region;
          execute format('update public.war_regions set %I = %s, updated_at = now() where region_id = %L',
                         mv.unit_type, surv, mv.to_region);
          perform public.war_log_event(mv.player_id, 'captured', mv.to_region,
            jsonb_build_object('coins', loot, 'opponent', dest.owner_name));
          perform public.war_log_event(dest.owner_id, 'lost', mv.to_region,
            jsonb_build_object('opponent', aname));
        else
          -- defender holds: scale survivors down, but never to a 0-unit ghost province
          ratio := (d_str - a_str) / d_str;
          update public.war_regions
            set soldier = floor(soldier * ratio), tank = floor(tank * ratio),
                jet = floor(jet * ratio), warship = floor(warship * ratio), updated_at = now()
          where region_id = mv.to_region;
          update public.war_regions set soldier = 1
            where region_id = mv.to_region and (soldier + tank + jet + warship) = 0;
          perform public.war_log_event(dest.owner_id, 'defended', mv.to_region,
            jsonb_build_object('opponent', aname));
          perform public.war_log_event(mv.player_id, 'attack_failed', mv.to_region,
            jsonb_build_object('opponent', dest.owner_name));
        end if;
      end if;
    end if;
  end loop;

  -- 2) Accrue capped income into each player's vault (50 coins/bank-level/hour, cap ≈ 10h).
  --    The tick runs every minute, so accrual per tick is fractional. We floor to whole
  --    coins and advance last_income_at only by the time those whole coins represent,
  --    carrying the sub-coin remainder forward (bumping it to now() every tick would
  --    discard the remainder and stall low-bank income — e.g. 1 bank level would earn 0
  --    forever). Players with no banks have last_income_at kept at now() so that building
  --    a bank later doesn't pay out retroactive back-income. cap = greatest(vault, 10h)
  --    so losing all banks never wipes an already-accrued vault.
  with bank as (
    select p.user_id, p.vault, p.last_income_at,
           coalesce((select sum(level) from public.war_buildings b
                     where b.owner_id = p.user_id and b.type = 'bank'), 0) as lv
    from public.war_players p
  ), calc as (
    -- accrued kept numeric (not cast to int) so a long-offline pre-cap value can't overflow
    -- int before the cap clamps it below; the final vault is cast to int after capping.
    select user_id, vault, last_income_at, lv,
           floor(lv * 50 * greatest(0, extract(epoch from (now() - last_income_at)) / 3600.0)) as accrued,
           lv * 50 * 10 as cap
    from bank
  )
  update public.war_players p set
    vault = least(p.vault + c.accrued, greatest(p.vault, c.cap))::int,
    last_income_at = case
      when c.lv = 0      then now()
      when c.accrued > 0 then p.last_income_at + (c.accrued::numeric / (c.lv * 50)) * interval '1 hour'
      else p.last_income_at
    end
  from calc c where c.user_id = p.user_id;

  -- 3) Refresh alive flag (no regions left = not alive, can respawn by buying).
  update public.war_players p set
    is_alive = exists (select 1 from public.war_regions r where r.owner_id = p.user_id);

  delete from public.war_events where created_at < now() - interval '7 days';
end;
$$;

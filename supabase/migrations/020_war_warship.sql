-- Migration 020: add warships + sea movement to CP War. Idempotent.
alter table public.war_regions   add column if not exists warship integer not null default 0;
alter table public.war_movements drop  constraint if exists war_movements_unit_type_check;
alter table public.war_movements add   constraint war_movements_unit_type_check
  check (unit_type in ('soldier','tank','jet','warship'));
alter table public.war_movements drop  constraint if exists war_movements_mode_check;
alter table public.war_movements add   constraint war_movements_mode_check
  check (mode in ('land','air','sea'));

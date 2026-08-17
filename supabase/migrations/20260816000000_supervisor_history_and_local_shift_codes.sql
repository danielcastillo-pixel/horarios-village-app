begin;

-- Cada local puede utilizar la misma sigla con sus propias horas.
alter table public.shopper_shift_types
  drop constraint if exists shopper_shift_types_code_key;

create unique index if not exists shopper_shift_types_scope_unique
  on public.shopper_shift_types(coalesce(location_id, 0), category, code);

-- La vigencia evita que una rotación o baja borre visualmente semanas anteriores.
alter table public.supervisors
  add column if not exists active_from date not null default date '2026-07-27';

alter table public.supervisors
  add column if not exists active_until date;

update public.supervisors s
set active_until = coalesce(
  (select max(a.work_date)
   from public.assignments a
   where a.supervisor_id = s.id),
  s.active_from
)
where s.active = false
  and s.active_until is null;

commit;

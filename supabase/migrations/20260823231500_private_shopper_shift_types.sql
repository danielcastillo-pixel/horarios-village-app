alter table public.shopper_shift_types
  add column if not exists created_by uuid,
  add column if not exists is_general boolean not null default false;

-- Solo A, B, T, L y V son turnos generales para todos los supervisores.
update public.shopper_shift_types
set is_general=(location_id is null and code in ('A','B','T','L','V')),
    created_by=case when location_id is null and code in ('A','B','T','L','V') then null else created_by end,
    active=case when location_id is null and code in ('A','B','T','L','V') then true else active end;

update public.shopper_shift_types
set active=false
where location_id is null and code not in ('A','B','T','L','V');

drop index if exists public.shopper_shift_types_scope_unique;
create unique index shopper_shift_types_owner_scope_unique
on public.shopper_shift_types(
  coalesce(location_id,0),
  category,
  code,
  coalesce(created_by,'00000000-0000-0000-0000-000000000000'::uuid)
);
create index if not exists shopper_shift_types_creator_idx
on public.shopper_shift_types(created_by,location_id,category)
where created_by is not null;

alter table public.shopper_turns
  add column if not exists shift_type_id bigint references public.shopper_shift_types(id) on delete restrict;
create index if not exists shopper_turns_shift_type_idx
on public.shopper_turns(shift_type_id)
where shift_type_id is not null;

update public.shopper_turns turn
set shift_type_id=(
  select shift_type.id
  from public.shopper_staff staff
  join public.shopper_shift_types shift_type
    on shift_type.code=turn.turn_code
   and (shift_type.category='both' or shift_type.category=staff.category)
   and (shift_type.location_id=staff.location_id or shift_type.location_id is null)
  where staff.id=turn.staff_id
  order by
    (shift_type.location_id=staff.location_id) desc,
    shift_type.is_general desc,
    shift_type.id
  limit 1
)
where turn.shift_type_id is null;

drop policy if exists shopper_shift_types_access on public.shopper_shift_types;
drop policy if exists shopper_shift_types_read_private on public.shopper_shift_types;
drop policy if exists shopper_shift_types_insert_private on public.shopper_shift_types;
drop policy if exists shopper_shift_types_update_private on public.shopper_shift_types;

create policy shopper_shift_types_read_private
on public.shopper_shift_types for select to authenticated
using (
  public.is_admin()
  or is_general
  or created_by=(select auth.uid())
);

create policy shopper_shift_types_insert_private
on public.shopper_shift_types for insert to authenticated
with check (
  public.is_admin()
  or (
    created_by=(select auth.uid())
    and not is_general
    and location_id is not null
    and public.has_location(location_id)
  )
);

create policy shopper_shift_types_update_private
on public.shopper_shift_types for update to authenticated
using (public.is_admin() or created_by=(select auth.uid()))
with check (
  public.is_admin()
  or (
    created_by=(select auth.uid())
    and not is_general
    and location_id is not null
    and public.has_location(location_id)
  )
);

revoke delete on table public.shopper_shift_types from authenticated;

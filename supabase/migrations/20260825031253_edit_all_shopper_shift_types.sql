drop policy if exists shopper_shift_types_update_private on public.shopper_shift_types;

create policy shopper_shift_types_update_private
on public.shopper_shift_types for update to authenticated
using (
  public.is_admin()
  or is_general
  or created_by=(select auth.uid())
)
with check (
  public.is_admin()
  or (is_general and created_by is null and location_id is null)
  or (
    created_by=(select auth.uid())
    and not is_general
    and location_id is not null
    and public.has_location(location_id)
  )
);

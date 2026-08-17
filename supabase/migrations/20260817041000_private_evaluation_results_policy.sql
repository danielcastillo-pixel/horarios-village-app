drop policy if exists administrator_evaluation_results_admin_read on public.administrator_evaluation_results;
create policy administrator_evaluation_results_admin_read
on public.administrator_evaluation_results
for select
to authenticated
using (public.is_admin());

-- No SELECT grant is issued to authenticated. This policy is a second boundary
-- in case a future migration intentionally grants table access to administrators.

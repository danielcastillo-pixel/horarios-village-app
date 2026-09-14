-- Cargo operativo para consolidar toda la nómina regional sin duplicar personas.
alter table public.supervisors add column if not exists job_role text;
update public.supervisors set job_role='Supervisor' where job_role is null or trim(job_role)='';
alter table public.supervisors alter column job_role set default 'Supervisor';
alter table public.supervisors alter column job_role set not null;
alter table public.supervisors drop constraint if exists supervisors_job_role_check;
alter table public.supervisors add constraint supervisors_job_role_check
  check (length(trim(job_role)) between 2 and 80);

alter table public.shopper_staff add column if not exists job_role text;
update public.shopper_staff
set job_role=case when category='delivery' then 'Repartidor' else 'Asesor de compra' end
where job_role is null or trim(job_role)='';
alter table public.shopper_staff alter column job_role set default 'Asesor de compra';
alter table public.shopper_staff alter column job_role set not null;
alter table public.shopper_staff drop constraint if exists shopper_staff_job_role_check;
alter table public.shopper_staff add constraint shopper_staff_job_role_check
  check (length(trim(job_role)) between 2 and 80);

create index if not exists supervisors_location_active_role_idx
  on public.supervisors (location_id, active, job_role);
create index if not exists shopper_staff_location_active_role_idx
  on public.shopper_staff (location_id, active, job_role);

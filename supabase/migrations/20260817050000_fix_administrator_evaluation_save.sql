alter table public.administrator_evaluations
  add column if not exists administrator_position text not null default '';

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.prepare_administrator_evaluation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_name text;
  actor_email text;
begin
  if actor_id is null then
    raise exception 'Sesión no válida.' using errcode = '42501';
  end if;

  select coalesce(nullif(trim(full_name),''),email),email
    into actor_name,actor_email
  from public.profiles
  where id=actor_id and active;

  if actor_email is null then
    raise exception 'Usuario no autorizado.' using errcode = '42501';
  end if;

  if tg_op='INSERT' then
    new.submitted_by:=actor_id;
    new.submitted_by_name:=actor_name;
    new.submitted_by_email:=actor_email;
    new.submitted_at:=now();
  else
    new.location_id:=old.location_id;
    new.week_start:=old.week_start;
    new.week_end:=old.week_end;
    new.submitted_by:=old.submitted_by;
    new.submitted_by_name:=old.submitted_by_name;
    new.submitted_by_email:=old.submitted_by_email;
    new.submitted_at:=old.submitted_at;
  end if;

  new.last_updated_by:=actor_id;
  new.last_updated_by_name:=actor_name;
  new.updated_at:=now();
  return new;
end;
$$;

revoke all on function private.prepare_administrator_evaluation() from public, anon, authenticated;

create or replace function private.calculate_administrator_evaluation_result()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  applicable smallint;
  compliant smallint;
  calculated_score numeric(5,2);
  calculated_semaphore text;
begin
  applicable:=
    (case when new.rule_compliance is null then 0 else 1 end)+
    (case when new.uniform_compliance is null then 0 else 1 end)+
    (case when new.ethics_compliance is null then 0 else 1 end)+
    (case when new.punctuality_compliance is null then 0 else 1 end)+
    (case when new.no_team_complaints is null then 0 else 1 end);
  compliant:=
    (case when new.rule_compliance is true then 1 else 0 end)+
    (case when new.uniform_compliance is true then 1 else 0 end)+
    (case when new.ethics_compliance is true then 1 else 0 end)+
    (case when new.punctuality_compliance is true then 1 else 0 end)+
    (case when new.no_team_complaints is true then 1 else 0 end);

  if applicable<1 then
    raise exception 'Al menos un criterio debe ser aplicable.' using errcode = '23514';
  end if;

  calculated_score:=round(compliant::numeric/applicable::numeric*100,2);
  calculated_semaphore:=case when calculated_score>=90 then 'green' when calculated_score>=75 then 'yellow' else 'red' end;

  insert into public.administrator_evaluation_results(
    evaluation_id,compliant_count,applicable_count,score,semaphore,calculated_at
  ) values (
    new.id,compliant,applicable,calculated_score,calculated_semaphore,now()
  )
  on conflict(evaluation_id) do update set
    compliant_count=excluded.compliant_count,
    applicable_count=excluded.applicable_count,
    score=excluded.score,
    semaphore=excluded.semaphore,
    calculated_at=excluded.calculated_at;
  return new;
end;
$$;

revoke all on function private.calculate_administrator_evaluation_result() from public, anon, authenticated;

drop trigger if exists prepare_administrator_evaluation on public.administrator_evaluations;
create trigger prepare_administrator_evaluation
before insert or update on public.administrator_evaluations
for each row execute function private.prepare_administrator_evaluation();

drop trigger if exists calculate_administrator_evaluation_result on public.administrator_evaluations;
create trigger calculate_administrator_evaluation_result
after insert or update on public.administrator_evaluations
for each row execute function private.calculate_administrator_evaluation_result();

grant select,insert,update on table public.administrator_evaluations to authenticated;
grant usage,select on sequence public.administrator_evaluations_id_seq to authenticated;
grant select on table public.administrator_evaluation_results to authenticated;

drop policy if exists administrator_evaluations_insert on public.administrator_evaluations;
create policy administrator_evaluations_insert
on public.administrator_evaluations
for insert
to authenticated
with check (
  submitted_by=(select auth.uid())
  and (public.is_admin() or public.has_location(location_id))
);

drop policy if exists administrator_evaluations_update on public.administrator_evaluations;
create policy administrator_evaluations_update
on public.administrator_evaluations
for update
to authenticated
using (public.is_admin() or public.has_location(location_id))
with check (public.is_admin() or public.has_location(location_id));

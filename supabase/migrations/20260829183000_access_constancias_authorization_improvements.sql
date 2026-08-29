-- Amplía constancias y autorizaciones conservando los registros históricos.

alter table public.weekly_evidences
  add column if not exists notes text not null default '',
  add column if not exists evidence_paths text[] not null default '{}'::text[];

alter table public.weekly_evidences disable trigger audit_weekly_evidence;
update public.weekly_evidences
set evidence_paths = array[evidence_path]
where cardinality(evidence_paths)=0 and nullif(trim(evidence_path),'') is not null;
alter table public.weekly_evidences enable trigger audit_weekly_evidence;

alter table public.weekly_evidences
  drop constraint if exists weekly_evidences_evidence_type_check;
alter table public.weekly_evidences
  add constraint weekly_evidences_evidence_type_check
  check (evidence_type in ('automatic_assignment','team_meeting','supervisor_meeting'));

alter table public.weekly_evidences
  drop constraint if exists weekly_evidences_evidence_paths_check;
alter table public.weekly_evidences
  add constraint weekly_evidences_evidence_paths_check
  check (
    cardinality(evidence_paths) between 1 and 10
    and array_position(evidence_paths,null) is null
  );

alter table public.weekly_evidences
  drop constraint if exists weekly_evidences_notes_length_check;
alter table public.weekly_evidences
  add constraint weekly_evidences_notes_length_check
  check (length(notes) <= 5000);

-- Los registros antiguos de reuniones se conservan aunque todavía no tengan texto.
-- La API exige texto para toda reunión nueva o actualizada.

alter table public.authorization_requests
  add column if not exists evidence_paths text[] not null default '{}'::text[],
  add column if not exists needs_help boolean not null default false;

alter table public.authorization_requests disable trigger protect_authorization_request;
update public.authorization_requests
set evidence_paths = array[evidence_path]
where cardinality(evidence_paths)=0 and nullif(trim(evidence_path),'') is not null;
alter table public.authorization_requests enable trigger protect_authorization_request;

alter table public.authorization_requests
  drop constraint if exists authorization_requests_evidence_path_check;
alter table public.authorization_requests
  add constraint authorization_requests_evidence_path_check
  check (
    (
      request_type='incentive'
      and evidence_path is not null
      and length(trim(evidence_path)) between 5 and 500
      and cardinality(evidence_paths) between 1 and 10
    )
    or (
      request_type='discount'
      and (
        (evidence_path is null and cardinality(evidence_paths)=0)
        or (
          evidence_path is not null
          and length(trim(evidence_path)) between 5 and 500
          and cardinality(evidence_paths) between 1 and 10
        )
      )
    )
  );

alter table public.authorization_requests
  drop constraint if exists authorization_requests_evidence_paths_check;
alter table public.authorization_requests
  add constraint authorization_requests_evidence_paths_check
  check (
    cardinality(evidence_paths) <= 10
    and array_position(evidence_paths,null) is null
  );

create or replace function private.protect_authorization_request_extras()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  new.evidence_paths:=old.evidence_paths;
  new.needs_help:=old.needs_help;
  return new;
end;
$$;
revoke all on function private.protect_authorization_request_extras() from public, anon, authenticated;

drop trigger if exists zz_protect_authorization_request_extras on public.authorization_requests;
create trigger zz_protect_authorization_request_extras
before update on public.authorization_requests
for each row execute function private.protect_authorization_request_extras();

drop policy if exists weekly_evidence_select on storage.objects;
create policy weekly_evidence_select on storage.objects for select to authenticated
using (
  bucket_id='weekly-evidence'
  and (
    owner_id=(select auth.uid())::text
    or public.is_admin()
    or exists (
      select 1 from public.weekly_evidences evidence
      where (
        evidence.evidence_path=name
        or name=any(evidence.evidence_paths)
      )
      and public.has_location(evidence.location_id)
    )
  )
);

drop policy if exists authorization_evidence_select on storage.objects;
create policy authorization_evidence_select on storage.objects for select to authenticated
using (
  bucket_id='authorization-evidence'
  and (
    owner_id=(select auth.uid())::text
    or public.is_admin()
    or exists (
      select 1 from public.authorization_requests request
      where (
        request.evidence_path=name
        or name=any(request.evidence_paths)
      )
      and public.has_location(request.location_id)
    )
  )
);

grant select,insert,update on table public.weekly_evidences to authenticated;
grant select,insert,update on table public.authorization_requests to authenticated;

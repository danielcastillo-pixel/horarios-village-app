alter table public.authorization_requests
  alter column evidence_path drop not null;

alter table public.authorization_requests
  drop constraint if exists authorization_requests_evidence_path_check;

alter table public.authorization_requests
  add constraint authorization_requests_evidence_path_check
  check (
    (request_type = 'incentive'
      and evidence_path is not null
      and length(trim(evidence_path)) between 5 and 500)
    or
    (request_type = 'discount'
      and (evidence_path is null or length(trim(evidence_path)) between 5 and 500))
  );

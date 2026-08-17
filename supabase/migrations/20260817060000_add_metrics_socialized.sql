alter table public.administrator_evaluations
  add column if not exists metrics_socialized boolean not null default false;

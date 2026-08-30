-- Los supervisores activos permanecen visibles en todas las semanas futuras.
-- Las bajas manuales se conservan porque tienen active=false.
update public.supervisors
set active_until = null
where active = true
  and active_until is not null;

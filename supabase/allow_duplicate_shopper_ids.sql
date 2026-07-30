-- Permite reutilizar el mismo ID operativo en varias filas de shoppers.
-- Los registros continúan diferenciándose internamente por shopper_staff.id.
drop index if exists public.shopper_staff_external_id_unique;

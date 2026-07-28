# Horarios Village

Aplicación web independiente para administrar locales, supervisores, roles,
turnos, horas trabajadas, vacaciones, accesos y reportes Excel.

## Qué incluye

- Inicio de sesión interno con correo y contraseña (sin cuenta de ChatGPT).
- Un administrador con acceso total.
- Registro de usuarios; quedan bloqueados hasta que el administrador los active.
- Supervisores limitados al local asignado.
- Locales, supervisores y roles editables.
- Turnos por rango de horas y cálculo automático de horas.
- `Libre` y `Vacaciones` no suman horas.
- Reporte Excel por local y rango de fechas.
- Base de datos permanente en Supabase.

## Instalación

### 1. Crear la base de datos

1. Entra a https://supabase.com y crea un proyecto.
2. Abre **SQL Editor**.
3. Copia todo el archivo `supabase/schema.sql`, pégalo y presiona **Run**.
4. En **Authentication > Providers > Email**, deja habilitado Email.
5. En **Authentication > Users**, crea tu usuario administrador.
6. Vuelve a SQL Editor y ejecuta, reemplazando el correo:

```sql
update public.profiles
set app_role = 'admin', active = true
where email = 'daniel.castillo@tipti.market';
```

### 2. Subir el proyecto a GitHub

1. Abre tu repositorio `horarios-village-app`.
2. Selecciona **Add file > Upload files**.
3. Descomprime este paquete y arrastra todos los archivos y carpetas.
4. Presiona **Commit changes**.

### 3. Publicar en Vercel

1. Entra a https://vercel.com con GitHub.
2. Selecciona **Add New > Project** e importa `horarios-village-app`.
3. En Supabase abre **Project Settings > API**.
4. En Vercel agrega estas variables:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL de Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clave `anon public` |
| `SUPABASE_SERVICE_ROLE_KEY` | clave `service_role` |

5. Presiona **Deploy**. Vercel mostrará el enlace público para compartir.

## Accesos

- Tú creas tu usuario en Supabase y lo conviertes en administrador con el SQL.
- Cada colaborador se registra con correo y contraseña.
- El usuario nuevo aparece en la pestaña **Accesos**.
- Tú eliges su local y presionas **Activar**.
- No existe acceso anónimo.

## Seguridad

Las políticas RLS están incluidas en `supabase/schema.sql`. Aunque alguien intente
modificar la página desde el navegador, Supabase restringe los datos al local
asignado. Nunca publiques la clave `service_role` ni la escribas dentro del código.

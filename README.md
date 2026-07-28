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
- Módulo de shoppers con asesores de compra y repartidores.

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

### 3. Publicar

El proyecto se publica automáticamente desde la rama `main` de GitHub.

## Accesos

- Tú creas tu usuario en Supabase y lo conviertes en administrador con el SQL.
- Cada colaborador se registra con correo y contraseña.
- El usuario nuevo aparece en la pestaña **Accesos**.
- Tú eliges sus locales permitidos y presionas **Activar**.
- No existe acceso anónimo.

## Seguridad

Las políticas RLS están incluidas en `supabase/schema.sql`. Aunque alguien intente
modificar la página desde el navegador, Supabase restringe los datos a los locales
asignados. Nunca publiques la clave `service_role` ni la escribas dentro del código.

_Último intento de publicación: 28 de julio de 2026._

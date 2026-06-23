# Cómo activar usuarios por invitación en juteach.org

Este proyecto quedó preparado para que:

- Tú seas el administrador.
- Cada persona se registre sola, pero solo con una invitación creada por ti.
- Cada usuario vea, cree y borre únicamente sus propios enlaces/QR.
- Cada usuario tenga máximo 100 enlaces activos.
- Si borra enlaces antiguos, libera espacio para crear nuevos.
- La recuperación de contraseña se haga por correo con Supabase.

## 1. Crear proyecto gratis en Supabase

1. Entra a Supabase y crea un proyecto nuevo.
2. Ve a **SQL Editor**.
3. Copia y ejecuta todo el contenido del archivo `supabase-setup.sql`.

Eso crea dos tablas:

- `invites`: invitaciones autorizadas por el admin.
- `links`: enlaces creados por cada usuario.

## 2. Configurar autenticación

En Supabase, entra a **Authentication**.

Recomendado para probar rápido:

- Desactivar temporalmente la confirmación obligatoria por correo, para que al registrarse entren de una vez.

Recomendado para producción:

- Activar confirmación por correo.
- Agregar `https://juteach.org/Acortador` como URL permitida de redirección.

## 3. Copiar llaves de Supabase

En Supabase, busca las llaves del proyecto:

- Project URL
- anon public key
- service_role key

La `anon public key` puede mostrarse al navegador.

La `service_role key` es secreta. No debe pegarse en archivos públicos ni compartirse.

## 4. Variables que debes agregar en Vercel

En Vercel, abre el proyecto y entra a **Settings → Environment Variables**.

Agrega estas variables:

```txt
SUPABASE_URL=tu_project_url_de_supabase
SUPABASE_ANON_KEY=tu_anon_public_key
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
PUBLIC_SITE_URL=https://juteach.org
MAX_LINKS_PER_USER=100
```

Conserva las que ya tienes:

```txt
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
APP_PASSWORD=...
```

Por ahora puedes dejar tu `APP_PASSWORD` actual. Cuando todo esté probado y te guste, cambiaremos esa clave.

## 5. Cómo usarlo como admin

1. Entra a `https://juteach.org/Acortador`.
2. Inicia sesión con una cuenta tuya o crea tu cuenta con una invitación.
3. Abre la pestaña **Admin**.
4. Escribe tu clave admin actual de Vercel (`APP_PASSWORD`).
5. Escribe el correo de la persona autorizada.
6. Toca **Crear invitación**.
7. Copia el enlace y envíaselo a esa persona.

La persona abre el enlace, crea su cuenta con ese mismo correo, y ya puede crear sus propios enlaces y QR.

## 6. Importante sobre enlaces actuales

Los enlaces que ya existen en Upstash seguirán redirigiendo.

Pero como antes no tenían dueño, no aparecerán automáticamente dentro de la cuenta de un usuario. Si quieres, luego podemos hacer una pequeña migración para asignarlos a tu cuenta admin.

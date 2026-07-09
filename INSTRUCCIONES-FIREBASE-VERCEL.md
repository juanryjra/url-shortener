# Cómo activar usuarios por invitación en juteach.org (con Firebase)

Este proyecto quedó preparado para que:

- Tú seas el administrador.
- Cada persona se registre sola, pero solo con una invitación creada por ti.
- Cada usuario confirme su correo antes de poder usar la app.
- Cada usuario vea, cree y borre únicamente sus propios enlaces/QR.
- Cada usuario tenga máximo 100 enlaces activos.
- Si borra enlaces antiguos, libera espacio para crear nuevos.
- La recuperación de contraseña se haga por correo con Firebase.

## 1. Crear proyecto en Firebase

1. Entra a [console.firebase.google.com](https://console.firebase.google.com) con tu cuenta de Google.
2. Clic en **Agregar proyecto**, ponle un nombre (por ejemplo `juteach-org`) y créalo. No necesitas activar Google Analytics.

## 2. Activar Authentication (Email/Password)

1. En el menú lateral, entra a **Authentication → Sign-in method** (o "Comenzar" si es la primera vez).
2. Activa el proveedor **Correo electrónico/contraseña**.
3. Ve a **Authentication → Templates** (Plantillas):
   - En la plantilla de **Verificación de correo electrónico**, revisa que el idioma sea español si quieres, y guarda.
   - En la plantilla de **Restablecimiento de contraseña**, igual.
4. Ve a **Authentication → Settings → Authorized domains** y agrega `juteach.org` (y el dominio `*.vercel.app` de tus previews si los usas).

No necesitas configurar manualmente la URL de acción: el código ya le indica a Firebase que redirija a `https://juteach.org/Acortador` tanto para el correo de verificación como para el de restablecer contraseña.

## 3. Activar Firestore Database

1. En el menú lateral, entra a **Firestore Database → Crear base de datos**.
2. Elige **modo producción** (no modo de prueba) y la región que prefieras.
3. Ve a la pestaña **Reglas** y reemplaza el contenido por el de [`firestore.rules`](firestore.rules) de este repo:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Esto bloquea cualquier acceso directo desde el navegador. Toda la lectura/escritura de `invites` y `links` la hace el backend (`api/index.js`) con permisos de administrador, que no pasan por estas reglas.

No necesitas crear colecciones ni índices a mano — el backend las crea automáticamente la primera vez que guarda una invitación o un enlace.

## 4. Sacar la configuración web (llaves públicas)

1. Ve a **Configuración del proyecto** (ícono de engranaje) → pestaña **General**.
2. Baja hasta "Tus apps" y clic en el ícono `</>` para registrar una app web (si no tienes una). Ponle un nombre, no necesitas Firebase Hosting.
3. Copia los valores del objeto `firebaseConfig` que te muestra:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `appId`

Estos valores **no son secretos** (se exponen igual en cualquier app web de Firebase), así que se pueden mostrar en el navegador sin problema.

## 5. Crear la cuenta de servicio (llave secreta del backend)

1. Ve a **Configuración del proyecto → Cuentas de servicio**.
2. Clic en **Generar nueva clave privada**. Se descarga un archivo `.json`.
3. Abre ese archivo y copia **todo su contenido** (es un JSON de una sola vez, con `private_key`, `client_email`, etc.).

Este archivo es secreto — no lo subas al repositorio ni lo compartas. Solo se usa en la variable de entorno de Vercel del siguiente paso.

## 6. Variables que debes agregar en Vercel

En Vercel, abre el proyecto y entra a **Settings → Environment Variables**.

Agrega estas variables:

```txt
FIREBASE_API_KEY=el_apiKey_del_paso_4
FIREBASE_AUTH_DOMAIN=el_authDomain_del_paso_4
FIREBASE_PROJECT_ID=el_projectId_del_paso_4
FIREBASE_APP_ID=el_appId_del_paso_4
FIREBASE_SERVICE_ACCOUNT_KEY=el_json_completo_del_paso_5_en_una_sola_linea
PUBLIC_SITE_URL=https://juteach.org
MAX_LINKS_PER_USER=100
```

Para `FIREBASE_SERVICE_ACCOUNT_KEY`, pega el JSON completo de la cuenta de servicio como una sola línea de texto (Vercel acepta valores largos sin problema).

Conserva las que ya tienes:

```txt
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
ADMIN_EMAIL=...
```

Elimina las variables antiguas de Supabase (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) si ya no las vas a usar. `APP_PASSWORD` ya no la usa el código — las acciones de administrador ahora se protegen solo verificando que hayas iniciado sesión con el correo de `ADMIN_EMAIL`, así que también puedes eliminarla.

## 7. Cómo usarlo como admin

1. Entra a `https://juteach.org/Acortador`.
2. Inicia sesión con una cuenta tuya (o créala) usando el correo que pusiste en `ADMIN_EMAIL`. Firebase te pedirá confirmar tu correo antes de dejarte entrar.
3. Abre la pestaña **Admin** (solo aparece para ese correo).
4. Escribe el correo de la persona autorizada.
5. Toca **Crear invitación**.
6. Copia el enlace y envíaselo a esa persona.

La persona abre el enlace, crea su cuenta con ese mismo correo, confirma su correo desde el mensaje que le llega, inicia sesión y ya puede crear sus propios enlaces y QR.

## 8. Importante sobre enlaces actuales

Los enlaces que ya existen en Upstash seguirán redirigiendo (ese sistema no cambió). Pero como los datos de usuarios/invitaciones de Supabase no se migraron, todos los usuarios deben registrarse de nuevo en Firebase.

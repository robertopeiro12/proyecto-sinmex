# T-06 · Autenticación JWT propia (Portal Web) — Diseño

- **Fecha:** 2026-08-03
- **Issue:** T-06 (proyecto-sinmex) — **cierre parcial, ver "Alcance"**
- **Depende de:** T-02 (backend NestJS), T-03 (portal Next.js), T-05 (esquema relacional)
- **Fuente de dominio:** vault `jawa-obsidian-memory` — notas `Usuario`, `Vendedor`, `Perfil`; `ADR-0002` (auth = JWT propio).

## Objetivo

Dar al **Portal Web** autenticación real: un usuario de oficina entra con login y contraseña,
obtiene una sesión que se renueva sola durante la jornada, y la API rechaza cualquier petición
sin sesión válida.

Como efecto colateral necesario, T-06 estrena la **capa de acceso a datos del backend** — es el
primer ticket que lee de Postgres, y T-05 dejó esa decisión diferida a propósito.

## Alcance

**Incluye:**

- Capa de acceso a datos del backend (Kysely sobre `pg`) + tipos generados desde la BD.
- Migración de la tabla `sesion_refresh` + sus tests pgTAP.
- Módulo `auth` en el backend: login, refresh, logout, `me`; hashing argon2id; guard global de sesión.
- Script CLI para crear el primer usuario administrador.
- Pantalla de login en el portal, protección de rutas, y cierre de sesión.

**No incluye** (cada uno en su ticket):

- **Autenticación del `vendedor` y sesión offline** — depende de que exista `apps/tablet` (T-04).
- **Permisos granulares, matriz de perfiles y guards por permiso** — es T-08 completo.
- **CRUD de usuarios desde el portal** — es T-13 (por eso el script CLI).
- **Rate limiting / bloqueo por intentos fallidos** — endurecimiento, T-60.

> [!warning] T-06 no se cierra con este trabajo
> Los criterios del issue #6 piden login **de la App** y **sesión válida offline**. Este diseño
> cubre el portal, el hashing y la expiración/rotación de token; deja fuera al `vendedor` y todo
> lo offline. Al terminar se comenta en el issue qué quedó cubierto y lo restante se retoma junto
> con T-04, en vez de cerrar el ticket como completo.

## Decisiones tomadas (en brainstorming)

| Decisión | Elección | Por qué |
|---|---|---|
| Acceso a datos | **Kysely** + `kysely-codegen` | Las migraciones SQL de T-05 siguen siendo la fuente de verdad del esquema; Kysely solo consulta. Prisma/Drizzle quieren ser dueños del esquema y chocarían con los 7 archivos SQL + 31 tests pgTAP existentes. Sale **ADR-0003**. |
| Sesión del portal | **Cookies httpOnly** (access + refresh) | El JS del portal nunca toca los tokens → un XSS no puede robarlos. Cubre "expiración/rotación" del criterio de aceptación de forma natural. |
| Hashing | **argon2id** (`@node-rs/argon2`) | Recomendación actual de OWASP; binarios precompilados, así que CI no necesita `node-gyp`. |
| Permisos | **Fuera de T-06** | T-06 responde "¿quién eres?"; T-08 responde "¿qué puedes hacer?". Deja T-08 con contenido real. |
| Primer admin | **Script CLI** | Sirve en local, en la máquina del compañero y en producción; ninguna contraseña queda escrita en git. |

## Capa de acceso a datos

`DatabaseModule` global que expone un provider `Kysely<DB>` sobre un único `pg.Pool`,
construido desde `DATABASE_URL` (ya existe en `.env.example`). El pool se cierra en
`onModuleDestroy` para que Jest no quede colgado al terminar la suite.

Los tipos se generan con `kysely-codegen` leyendo la base local y se **versionan** en
`src/database/schema.d.ts`:

- el `build` de CI no necesita una base de datos viva;
- si alguien cambia una migración sin regenerar tipos, el diff lo delata en el PR.

Script nuevo: `npm run db:types --workspace=apps/backend`.

## Modelo — migración nueva

`supabase/migrations/<ts>_sesiones.sql` con la tabla `sesion_refresh`:

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | convención del repo |
| `created_at` / `updated_at` | timestamptz | convención + trigger `set_updated_at` |
| `usuario_id` | uuid NOT NULL | FK → `usuario(id)` |
| `token_hash` | text NOT NULL UNIQUE | el refresh token **hasheado**; robar la BD no da sesiones |
| `expira_en` | timestamptz NOT NULL | vencimiento |
| `revocada_en` | timestamptz NULL | logout y revocación por reuso |
| `reemplazada_por` | uuid NULL | FK → `sesion_refresh(id)`; cadena de rotación |

`token_hash` es único (el lookup de refresh es por él); índice adicional por `usuario_id` para
revocar la cadena completa de un usuario.

El hash del refresh token usa **SHA-256**, no argon2: el token ya es aleatorio de 32 bytes, no
tiene entropía baja que proteger, y el lookup por igualdad exacta debe ser barato.

Sin `deleted_at`: una sesión no es una entidad de negocio con baja lógica, se revoca.

La tabla nace **solo con `usuario_id`** porque T-06 es solo portal. Cuando entre el vendedor se
decidirá si se agrega `vendedor_id` o una tabla hermana — no se pre-construye ahora.

Tests pgTAP en `supabase/tests/70_sesiones_test.sql`, en el mismo estilo que los 31 existentes.

## Autenticación

### Tokens

- **access** — JWT firmado HS256 con `JWT_SECRET` (variable nueva en `.env.example`), vida ~15 min.
  Payload mínimo: `sub` (id del usuario), `tipo: 'usuario'`. **Sin permisos dentro** — eso es T-08.
- **refresh** — token opaco de 32 bytes aleatorios, vida 12 h (la jornada), guardado hasheado en
  `sesion_refresh`.

El campo `tipo` existe desde ya para que, cuando llegue el vendedor, un token emitido para la app
no sea aceptado en el portal.

### Rotación y detección de reuso

Cada llamada a `/auth/refresh` **rota**: revoca la sesión usada, crea una nueva y apunta
`reemplazada_por` a la nueva.

Si llega un refresh token que ya está revocado, se revoca **toda la cadena** de sesiones de ese
usuario. Es la señal clásica de que un token fue robado y se está usando en paralelo.

### Endpoints (`apps/backend/src/modules/auth/`)

| Endpoint | Qué hace |
|---|---|
| `POST /auth/login` | Valida credenciales, emite ambas cookies. |
| `POST /auth/refresh` | Rota el refresh y emite un access nuevo. |
| `POST /auth/logout` | Revoca la sesión y limpia las cookies. |
| `GET /auth/me` | Devuelve id, nombre, login, perfil y sucursal (`null` = General). Sin permisos. |

### Guard

`JwtAuthGuard` registrado **global** vía `APP_GUARD`, con decorador `@Publico()` para exceptuar.

Global por defecto es lo correcto: si en T-09 alguien agrega un endpoint y olvida protegerlo, queda
protegido igual. Se marcan públicos `/health`, `/auth/login` y `/auth/refresh`.

### Cookies y dominios

En desarrollo funcionan sin más: `localhost:3000` y `localhost:3001` comparten host y el puerto no
cuenta para cookies.

En producción **solo funcionan si portal y API viven bajo el mismo dominio padre**
(`portal.ejemplo.mx` + `api.ejemplo.mx`, con `Domain=.ejemplo.mx`). Si terminan en dominios
distintos hay que pasar a `SameSite=None; Secure`, que es más frágil. Los atributos de la cookie
(`domain`, `secure`, `sameSite`) se leen de env y quedan anotados como **restricción de despliegue**.

## Script del primer usuario

`npm run crear-usuario --workspace=apps/backend` — pide login, nombre, contraseña, perfil y
sucursal; hashea con argon2id e inserta. Falla claro si el login ya existe o si el perfil/sucursal
no existen.

Es la herramienta que de todos modos se querrá más adelante para altas de emergencia en producción.

## Portal

- **`/login`** fuera del grupo de rutas `(portal)`, sin sidebar: card centrada con login/password,
  reusando los componentes shadcn ya instalados. Muestra un error genérico si falla.
- **`middleware.ts`** que redirige a `/login` cuando **no hay** cookie de sesión. Solo verifica
  presencia, no valida la firma — la validación real la hace la API. Es barato y evita duplicar el
  secreto en dos servicios.
- **`AuthProvider`** que consulta `/auth/me` y expone el usuario; el layout del portal muestra
  nombre + sucursal y un botón de cerrar sesión.
- **Cliente `fetch`** con `credentials: 'include'` que, ante un 401, intenta `/auth/refresh` una vez
  y reintenta la petición original; si también falla, manda a `/login`.
- Variable nueva: `NEXT_PUBLIC_API_URL`.

## Manejo de errores

- Credenciales inválidas → **401 genérico**, sin distinguir "no existe el usuario" de "contraseña
  incorrecta", y sin diferencia de tiempo de respuesta observable (argon2 corre en ambos casos).
- Usuario con `deleted_at` → no puede entrar, mismo 401 genérico.
- Refresh vencido, revocado o inexistente → 401; el portal manda a `/login`.
- Refresh reusado → 401 **y** revocación de toda la cadena del usuario.
- Sin `JWT_SECRET` configurado → el backend falla al arrancar, no arranca inseguro.

## Pruebas

| Nivel | Qué cubre |
|---|---|
| **pgTAP** | Tabla `sesion_refresh`: columnas, FKs, índices, trigger de `updated_at`. |
| **Unitarias (Jest)** | Servicio de tokens y hashing: hash verificable, rotación, reuso detectado, expiración. |
| **e2e (supertest)** | Flujo completo contra Postgres real: login → `me` → refresh → logout → 401. Incluye credenciales inválidas y usuario dado de baja. |

**CI:** el workflow del backend necesitará Postgres para los e2e. Se usa un `services: postgres` en
GitHub Actions aplicando las migraciones, sin depender de Docker/Colima en el runner.

**Local:** los e2e y `db:types` requieren el stack de Supabase levantado (`colima start` +
`npm run supabase start`), igual que en T-05.

## Impacto en el vault

Al terminar la implementación:

- **Crear `ADR-0003`** — acceso a datos del backend (Kysely; migraciones siguen en SQL con la CLI
  de Supabase; alternativas consideradas y descartadas).
- **Actualizar `Estado del proyecto`** — T-06 parcial (portal hecho, vendedor/offline pendiente).
- **Actualizar `Usuario`** — nota de implementación: argon2id, sesión por cookie, rotación.
- **Bitácora** — entrada del día con la decisión de Kysely y el cierre parcial de T-06.
- **`ADR-0002`** — la fila de Autenticación pasa de "propuesto" a implementado para el portal.

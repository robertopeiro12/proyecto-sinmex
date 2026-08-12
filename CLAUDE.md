# proyecto-sinmex (JAWA)

Este repo es el código del sistema **JAWA**: distribución de bebidas (Té de Jazmín,
Jamaica, Horchata, Limonada, Tamarindo, etc.), con App de Tablet para vendedores/
repartidores y Portal Web para administración.

## Memoria del proyecto (Obsidian vault — fuente de verdad)

El conocimiento de negocio y arquitectura **no vive en este repo**. Vive en un vault de
Obsidian separado, versionado en git, compartido entre los 2 desarrolladores y los
agentes de IA:

- Repo: https://github.com/brg8607/jawa-obsidian-memory
- Ruta local (convención): carpeta hermana de esta, `../jawa-obsidian-memory`

**Antes de trabajar en cualquier tarea de dominio o arquitectura, lee
`../jawa-obsidian-memory/AGENTS.md`** — es el contrato completo de cómo navegar y,
sobre todo, cómo mantener esa memoria actualizada.

Resumen de las reglas de oro del vault (el detalle está en su `AGENTS.md`):

- Una idea, una nota. Enlaza con `[[ ]]` en vez de duplicar contenido.
- Toda nota lleva frontmatter (`tipo`, `estado`, `actualizado`, etc.).
- `90-Fuentes/` es solo lectura — nunca editar.
- Decisión técnica relevante → crear un ADR en `30-Decisiones/`.
- Tras cambios de código relevantes, actualiza la nota de dominio/arquitectura afectada
  y `00-Inicio/Estado del proyecto.md` en el vault.
- No inventes: si algo no está confirmado, márcalo como pendiente en vez de asumir.

Si `../jawa-obsidian-memory` no existe en esta máquina, avisa al usuario en vez de
asumir o inventar contexto de negocio.

## Estructura del repo (monorepo, npm workspaces)

```
proyecto-sinmex/
├── apps/
│   ├── backend/   — NestJS (T-02). Módulos en src/modules/, uno por módulo de dominio
│   │                (mismos slugs que el vault: ventas-cobranza, tesoreria, etc.).
│   │                Excepciones (no corresponden a un slug del vault porque atraviesan
│   │                los 12 módulos de dominio): `modules/sucursales/` (T-09) y
│   │                `modules/sincronizacion/` (T-07).
│   ├── portal/    — Next.js (T-03)
│   └── tablet/    — React Native/Expo + SQLite local (T-04). Rutas de expo-router
│                    en `app/`, capa de datos offline en `src/datos/`.
│                    Ver `apps/tablet/README.md`.
├── supabase/      — migraciones (T-01)
├── .env.example   — plantilla de variables; .env.development es local, nunca se sube
└── package.json   — raíz del workspace
```

## Comandos

Desde la raíz del repo (no entres a `apps/backend` a mano, usa los scripts del workspace):

```
npm install                  # instala todo el monorepo (un solo node_modules)
npm run backend               # levanta el backend en modo dev (watch)
npm run portal                 # levanta el portal (Next.js) en modo dev
npm run tablet                 # levanta el bundler de Expo (app de tablet)
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend      # pruebas end-to-end (requieren Postgres real)
npm run db:types --workspace=apps/backend      # regenera apps/backend/src/database/schema.d.ts desde la BD local
npm run crear-usuario --workspace=apps/backend # da de alta un usuario del portal (input interactivo)
npm run crear-vendedor --workspace=apps/backend # da de alta (o restablece la contraseña de) un vendedor de la app

npm run typecheck --workspace=apps/tablet      # tsc --noEmit de la app de tablet
npm test --workspace=apps/tablet               # pruebas de la capa de datos local (SQLite)
npm run export --workspace=apps/tablet         # bundle de Metro; valida la resolucion del monorepo
```

**App de tablet dentro del monorepo:** `apps/tablet/metro.config.js` configura `watchFolders` a
la raiz y `nodeModulesPaths` (workspace + raiz) porque `npm install` reparte las dependencias
entre ambas carpetas. **No pongas `resolver.disableHierarchicalLookup = true`** (la receta que
circula para pnpm/yarn): con el layout de npm rompe el bundle. Ver los comentarios del archivo.

Health check una vez levantado: `GET http://localhost:3000/health`.

**A qué base de datos apunta cada cosa (importante, no es obvio):**

| Comando | Archivo de entorno | Base de datos |
|---|---|---|
| `npm run backend`, `npm run crear-usuario` | `.env.development` | **`sinmex dev` en la nube** |
| `npm test`, `npm run test:e2e`, `npm run db:types` | `.env.test` | Postgres **local** (Docker) |

Es decir: **levantar el backend en modo dev escribe en la base compartida con el otro dev**, no en
la local. Los datos de prueba que crees haciendo clic en el portal se quedan ahí. Si quieres
trastear sin ensuciar, apunta `DATABASE_URL` de `.env.development` al Postgres local mientras tanto.

Descubierto en T-09, cuando una verificación "local" acabó creando una sucursal de prueba en
`sinmex dev`.

**Dos actores, dos autenticaciones (T-06) — no las mezcles:**

| | Portal Web | App de tablet |
|---|---|---|
| Actor | `Usuario` | `Vendedor` (entidades separadas, ver el vault) |
| Endpoints | `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me` | `/auth/app/login`, `/auth/app/refresh`, `/auth/app/logout`, `/auth/app/me` |
| Transporte | cookies httpOnly (exige dominio padre común) | **tokens** en el cuerpo + `Authorization: Bearer` |
| Claim `tipo` del JWT | `usuario` | `vendedor` |
| Sesión de refresh | tabla `sesion_refresh` | tabla `sesion_vendedor` |
| Guard | por defecto | endpoints marcados con `@SoloApp()` |

El guard global es estricto en los dos sentidos: un token de app **no** entra al portal ni al revés.
El de la app además vale offline — ver `ADR-0005` en el vault y `apps/tablet/src/sesion/`.

**Permisos del portal (T-08a) — el candado no es automatico:**

Un endpoint del portal nace exigiendo **solo sesion**. Para exigir un permiso concreto hay que
marcarlo: `@RequierePermiso('producto.gestionar')` sobre el handler. Sin esa marca, cualquier
usuario con sesion pasa.

- **Los 6 perfiles sembrados estan VACIOS** y siguen asi hasta T-08b: el cliente nunca dijo que
  permisos lleva cada uno, y la matriz la va a configurar el. Hoy el unico camino que pasa un
  `@RequierePermiso` es el perfil **`Administrador General`**, que recibe el catalogo completo, o
  una excepcion en `usuario_permiso`.
- **`usuario_permiso.habilitado` va en los dos sentidos:** `true` concede un permiso que el perfil
  no da, `false` quita uno que si da. La excepcion gana sobre el perfil.
- **Todo se resuelve en `permisos.repository.ts`**, y lo consultan tanto el guard como
  `GET /auth/me`. Si agregas una regla nueva de permisos, va ahi — no en el guard, o el portal y
  la API acabaran discrepando.
- **Los permisos aplican al portal, no a la tablet.** Un `@RequierePermiso` sobre un endpoint
  `@SoloApp()` truena a proposito: el vendedor no tiene perfil.

**Sincronización de la tablet (T-07) — el contrato está documentado, léelo antes de tocarlo:**

`docs/contrato-sincronizacion.md`. Endpoints `GET /sync/pull` y `POST /sync/push`, ambos con
`@SoloApp()`. Tres cosas que se rompen en silencio si no se saben:

- **El contrato lleva versión explícita** (`contrato: 1`) en cada petición y cada respuesta,
  porque tablet y servidor se despliegan por separado. Los tipos están **duplicados** a propósito
  en `apps/backend/src/modules/sincronizacion/contrato.ts` (normativo) y
  `apps/tablet/src/sincronizacion/contrato.ts` (la tablet no puede importar del backend: Metro).
  Si tocas uno, toca el otro y el `docs/` en el mismo commit.
- **`fecha_operacion` la calcula la tablet con su reloj local (Tijuana) y el servidor NUNCA la
  re-deriva de UTC.** A las 18:00 de Tijuana en UTC ya es el día siguiente, y eso partiría cada
  jornada en dos.
- **La idempotencia del push vive en un `unique (vendedor_id, clave_idempotencia)` de la base**,
  no en el servicio. La clave es el `id` local de la fila en SQLite. Una operación **rechazada no
  deja fila**, para que se pueda corregir y reenviar.

**Folios (T-14) — el folio lo emite la TABLET, offline:**

`ADR-0001` en el vault manda el formato: **12 caracteres en 6 segmentos**
(`TJ260322AP05` = sucursal + año + mes + día + vendedor + operación del día).

- **No lo emite el servidor.** T-07 había escrito lo contrario ("se emitirá al proyectar");
  ADR-0001 lo descarta explícitamente porque el folio se escribe en la nota física que el
  cliente firma, en campo, sin red. Ver `ADR-0007` del vault y el §7 de `docs/`.
- **El contador reinicia solo porque cuelga de la fecha.** `folio_contador` tiene llave
  primaria `(vendedor, sucursal, fecha)` en el SQLite de la tablet. No hay ninguna
  comprobación de "¿cambió el día?" que se pueda olvidar: un día nuevo es una fila nueva.
- **Emite dentro de la transacción que guarda la operación.** `folios.emitir()` usa
  `savepoint`, no `begin`, para poder anidarse. T-16/T-20 **deben** llamarlo dentro de su
  propia transacción, o un fallo a media captura quema un número.
- **Folio ≠ clave de idempotencia** y hay que mantenerlos separados: la clave identifica el
  transporte, el folio el hecho de negocio.
- **La colisión se detecta con un `unique` global** en `sync_operacion.folio` (rechazo por
  operación, `folio-duplicado`). Al desempatar un `23505`, **mira primero la clave**: un
  reenvío legítimo trae la misma clave y el mismo folio y es `duplicada`, no colisión.
- **El segmento de vendedor (5º) lo asigna el SERVIDOR** y baja en el `pull`. La tablet no lo
  deriva de `nombre`: solo baja su propia ficha, así que no puede saber si comparte iniciales
  con un compañero. La estrategia de desambiguación es **provisional** (ADR-0007).

`npm run supabase -- migration up --local` aplica migraciones nuevas al Postgres local (ojo con el
`--`: sin él, npm se come los argumentos).

**Requisitos de entorno para lo anterior:**
- `JWT_SECRET` en `.env.development` (raíz del repo) — el backend no arranca sin ella. Genera una
  con `openssl rand -base64 32`.
- Variables de la app (todas en **horas**, todas con default): `ACCESS_TOKEN_TTL_APP_HORAS`,
  `REFRESH_TOKEN_TTL_APP_HORAS`, `VENTANA_OFFLINE_MAX_HORAS`, `VERIFICADOR_LOCAL_ITERACIONES`.
  Ver `.env.example` y `apps/backend/src/modules/auth/ttl-sesion.ts`.
- Para que la tablet alcance el backend: `EXPO_PUBLIC_API_URL` (default `http://localhost:3000`,
  que **solo sirve en emulador**; en una tablet real hay que apuntar a la IP del servidor).
- Para `test`, `test:e2e` y `db:types`: el stack local de Supabase arriba (un daemon de Docker
  corriendo + `npm run supabase start`). En esta máquina el daemon lo da **Colima**
  (`colima start` / `colima stop`), no Docker Desktop — no está instalado aquí. Antes de dar por
  hecho cuál usa una máquina, confirma con `docker context ls` en vez de asumirlo. Además, un
  `.env.test` en la raíz con `DATABASE_URL` (al Postgres local) y
  `JWT_SECRET`. `db:types` filtra con `--include-pattern='public.*'` para no traerse las tablas
  internas de Supabase (`auth.*`, `storage.*`, etc.), que contradicen el ADR-0002 (Supabase solo
  como Postgres gestionado).

CI (`.github/workflows/backend-ci.yml`) levanta su propio Postgres, aplica las migraciones de
`supabase/migrations/` y corre lint + build + test + test:e2e en cada push a `main` y en cada
Pull Request (un push a tu propia rama de feature, sin abrir/actualizar un PR, no lo dispara).

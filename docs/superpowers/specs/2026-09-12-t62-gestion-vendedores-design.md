# T-62 · Gestión de Vendedores (CRUD, credenciales app)

- **Issue:** [#62](https://github.com/robertopeiro12/proyecto-sinmex/issues/62) — Sprint 4
- **Depende de:** T-09 (alcance por sucursal, hecho), T-03 (scaffold del portal, hecho), T-08a
  (guard de permisos, hecho), T-10 (componentes de catálogo, hecho), T-14 (folios y segmento,
  hecho — este ticket lo **enmienda**)
- **Fecha:** 2026-09-12
- **Producto:** Backend + Portal Web

## Objetivo

Que el Jefe de Ventas pueda dar de alta, editar y dar de baja **vendedores** desde el portal. Hoy
la única vía es la consola (`crear-vendedor`), pensada como parche temporal "hasta T-62". Es el
**último catálogo del portal que falta** (T-09/T-10/T-11/T-12/T-13/T-18 ya están hechos, ver
`Estado del proyecto.md`).

Este ticket también **enmienda `ADR-0007`**: T-14 asignaba el segmento de folio cediendo en
silencio ante una colisión de iniciales. El cliente confirmó el 2026-09-12 (cita completa en el
ADR) que quiere lo contrario — **rechazar el alta** — porque así lo resuelven hoy a mano
("Roberto Wperez"). También confirmó que la colisión se evalúa **por sucursal**, no globalmente,
con su propio ejemplo: *"Si tenemos 2 Juan Pérez en TJ y MX no se duplicarían folios porque sería
TJ260912JP01 / MX260912JP01"*.

Ver `10-Dominio/Entidades/Vendedor.md` y
`30-Decisiones/ADR-0007 Emisión offline del folio y desambiguación del vendedor.md` en el vault.

## Alcance

### Dentro

1. Migración: (a) el `unique` de `folio_segmento` pasa de global a `(folio_segmento, sucursal_id)`;
   (b) `vendedor.login` pasa de `unique` plano a índice parcial case-insensitive, mismo bug que
   T-13 corrigió en `usuario.login`.
2. Módulo de backend en `modules/nomina-comisiones/` (hoy stub vacío) con `GET`/`POST`/`PATCH` de
   `/vendedores`, con la regla de rechazo por colisión de segmento.
3. Pantalla `/catalogo/vendedores` en el portal (hoy placeholder).
4. Se actualiza `crear-vendedor.ts` a la regla nueva — deja de ceder, empieza a rechazar.
5. Pruebas: pgTAP de los dos índices, unitarias de la regla de rechazo, e2e del CRUD y las
   colisiones, verificación manual con Playwright.

### Fuera, a propósito

| Qué | Por qué |
|---|---|
| **Nombre de una sola palabra** | `candidatosDeSegmento()` (T-14) ya tiene un fallback (2 primeras letras) y sigue sin cambio. Sigue siendo "elección nuestra" según el vault, no bloqueante — no lo resuelve este ticket. |
| **Reasignar un vendedor a otra sucursal** | No lo pide el issue #62. Además, con el segmento ahora ligado a `(sucursal, segmento)`, mover a alguien de sucursal podría colisionar contra alguien ya asignado en la nueva — es una regla propia que nadie ha pedido. La sucursal es inmutable tras el alta (D3). |
| **Política de contraseña (mínimo, rotación)** | Ya resuelta: sin mínimo, sin rotación (cliente, 2026-09-12). Nada que construir. |
| **Reactivar un vendedor dado de baja** | El issue no lo pide y ninguna pantalla existente (Usuarios, Vehículos, Sucursales) lo ofrece — la baja es lógica pero unidireccional desde el portal, igual que las demás. |
| **Borrado físico (`deleted_at`)** | Igual que Vehículos (T-11, D5) y Sucursales: la API solo usa `activo`. `deleted_at` se queda sin un camino que lo escriba. |

## Decisiones

### D1 — El módulo vive en `modules/nomina-comisiones/`, que hoy está vacío

`Vendedor.md` declara `modulo: nomina-comisiones` en su frontmatter (es la clasificación de
negocio más cercana entre los 12 módulos del cliente, igual razón por la que T-08b puso ahí la
matriz de Perfiles). El `CLAUDE.md` del repo fija que los módulos usan los mismos slugs que el
vault, y `NominaComisionesModule` ya existe como stub vacío y registrado en `app.module.ts`.

A diferencia de Perfiles (T-08b), que sí se puso en `modules/auth/` porque **es** el mecanismo que
el guard de permisos consulta directamente, Vendedor no comparte ese tipo de infraestructura — solo
reusa `resolverAlcance()` y `PasswordService`, igual que Vehículos reusa piezas de Sucursales sin
vivir ahí. No hace falta una tercera excepción a la doctrina de slugs.

### D2 — El catálogo SÍ filtra por el selector "Por sucursal"

Igual que Vehículos (T-11, D2): un vendedor **pertenece físicamente a una sucursal**
(`sucursal_id not null` desde T-05), así que `resolverAlcance()` de T-09 aplica tal cual, sin
tocarla.

### D3 — Al dar de alta, la sucursal la decide el alcance del usuario; es inmutable después

Misma doctrina de T-09/T-11 ("el cliente propone, el servidor dispone"): usuario atado a una
sucursal → se crea ahí (se ignora lo que mande el DTO); usuario General → debe mandarla, si no
llega es 400.

**La sucursal no se puede cambiar en la edición** — el DTO de edición ni siquiera lleva el campo.
No es solo cautela: con el segmento ahora único **por sucursal** (D6), mover a un vendedor de
sucursal podría chocar contra alguien que ya tiene esas iniciales ahí, o dejar huérfana la reserva
en la sucursal vieja. Ninguna fuente pide reasignación, así que no se construye esa regla.

### D4 — Login case-insensitive y liberable al dar de baja (mismo bug que T-13 corrigió)

`vendedor.login` hoy es `unique` plano (`20260803163003_identidad_y_permisos.sql:79`): sensible a
mayúsculas y no libera el login al dar de baja a alguien. Es el mismo defecto que T-13 encontró y
corrigió en `usuario.login` (D1 de su spec). Se aplica la misma corrección:

```sql
alter table vendedor drop constraint vendedor_login_key;

create unique index uq_vendedor_login
  on vendedor (lower(login))
  where deleted_at is null;
```

Y en los DTOs, el mismo `@Transform` de `crear-usuario.dto.ts`/`editar-usuario.dto.ts` que
normaliza a minúsculas **al escribir** (alta y edición), no al leer — para que lo guardado sea
canónico y `AuthVendedorService.validarCredenciales` (que compara tal cual) no necesite tocarse.

> [!warning] Este índice también queda sin scope de sucursal, a propósito
> El login identifica una **credencial de la app**, no una posición en el negocio — dos vendedores
> de sucursales distintas no deberían poder compartir login aunque folio_segmento sí distinga por
> sucursal (D6). Son reglas independientes.

### D5 — Contraseña: sin mínimo, sin rotación (ya confirmado, nada que validar)

El cliente confirmó el 2026-09-12 que no quiere longitud mínima ni rotación periódica para la
contraseña del vendedor (ver `Vendedor.md`). El DTO de alta solo exige que no esté vacía
(`@MinLength(1)`) y un máximo defensivo (`@MaxLength(200)`, mismo tope que usuario, por el límite
práctico de bcrypt/argon2 en la entrada) — **sin** el `@MinLength(8)` que sí lleva
`CrearUsuarioDto`. En edición, vacío u omitido = no cambiar, igual que T-13.

### D6 — Enmienda a ADR-0007: rechazar el alta por colisión, evaluada por sucursal

Reemplaza la Opción B.2 de T-14 (el servidor asigna el segmento y cede en silencio si choca) por
un rechazo explícito, **confirmado por el cliente dos veces** (ver la cita completa en el ADR):
primero describiendo que hoy alteran el nombre a mano, después pidiendo textualmente que el
sistema "no nos deje grabar el registro" si va a repetir folio; y confirmando por separado que la
comparación es **contra la misma sucursal**, con su propio ejemplo de dos "Juan Pérez" en TJ y MX.

**Migración** — el `unique` de T-14 pasa de global a compuesto:

```sql
drop index uq_vendedor_folio_segmento;

create unique index uq_vendedor_folio_segmento
  on vendedor (folio_segmento, sucursal_id)
  where folio_segmento is not null and deleted_at is null;
```

Este cambio **no puede fallar por datos existentes**: el índice viejo era estrictamente más
estricto (único entre *todos* los vendedores vivos), así que ningún dato actual puede violar la
versión con scope por sucursal — es una relajación, no una restricción nueva.

**Regla de aplicación** (`VendedoresService`, y la comparte `crear-vendedor.ts`):

1. Se calcula el candidato de la regla del ADR — `candidatosDeSegmento(nombre)[0]` de
   `segmento-vendedor.ts` (sin cambios: sigue siendo la función pura que reduce el nombre a sus
   iniciales, con el mismo fallback de 2 letras para un nombre de una sola palabra).
2. Se compara contra los vendedores **no borrados** (`deleted_at is null`, sin filtrar por
   `activo` — ver D7) de la **misma sucursal**.
3. Si ya está tomado → **409** ("Ya hay un vendedor en esta sucursal con esas iniciales (AP).
   Ajusta el nombre para diferenciarlo.") y no se inserta/actualiza nada.
4. Si está libre, se asigna tal cual — no se camina ninguna lista de alternativas.

`asignarSegmento()` (la función que hoy auto-asigna caminando `candidatosDeSegmento`) **deja de
usarse** en el alta — solo la usaban `crear-vendedor.ts` y su propio spec, así que no hay más
consumidores que actualizar. Se conserva en `segmento-vendedor.ts` por si algún día hace falta un
modo de asignación automática explícito (p. ej. una herramienta de migración masiva), pero nada en
este ticket la invoca.

### D7 — La baja usa `activo`, y el segmento del vendedor dado de baja NO se libera

Igual que Vehículos (T-11, D5): el checkbox `Activo` en el formulario hace `PATCH { activo: false
}`; `deleted_at` se queda sin un camino que lo escriba desde la API.

El `unique` de D6 filtra por `deleted_at is null`, **no por `activo`** — es intencional y **ya es
el comportamiento actual** (T-14/ADR-0007 ya lo documentaba: "no se recicla al dar de baja").
Un vendedor desactivado sigue "ocupando" su segmento en esa sucursal para siempre, porque sus
folios ya están en notas físicas firmadas y reciclar el segmento las volvería ambiguas. Este
ticket no cambia esa parte — solo el standard de sucursal (D6) y el mecanismo de rechazo en vez de
cesión.

### D8 — `crear-vendedor.ts` se actualiza a la regla nueva, no queda una vía distinta

El script deja de llamar `asignarSegmento()` (que cede automáticamente) y pasa a usar la misma
validación que `VendedoresService.crear()` — mismo criterio de D6. Un alta de emergencia por
consola ya no puede crear un segmento que el portal habría rechazado. El bloque de "restablecer
contraseña" del script no cambia (sigue revocando `sesion_vendedor` al resetear).

### D9 — Sin abstracciones nuevas: se reusa `PantallaCatalogo` y el patrón de Vehículos

En el portal, `PantallaCatalogo<Vendedor>` sin props nuevos — el campo condicional de sucursal
(solo visible para un usuario General) vive en `FormularioVendedor`, calcado de
`FormularioVehiculo` (T-11) y el patrón de "contraseña opcional en edición" de `FormularioUsuario`
(T-13). En el backend, `VendedoresRepository` tiene su propio `buscarSucursalUsuario()` — misma
duplicación deliberada de ~10 líneas que Vehículos, por la misma razón (YAGNI, T-10 ya fijó el
criterio de extraer solo en la tercera/cuarta copia).

## Modelo de datos

La tabla ya existe desde T-05/T-14 y **no se modifica su forma**, solo sus índices (D4, D6):

```sql
create table vendedor (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  login text not null,              -- unique pasa a indice parcial (D4)
  password_hash text not null,
  nombre text not null,
  sucursal_id uuid not null references sucursal(id),
  activo boolean not null default true,
  folio_segmento text                -- check de formato ya existe (T-14); unique pasa a (D6)
);
```

El permiso `vendedor.gestionar` ya existe, sembrado por T-05
(`20260803163500_semillas.sql:33`, grupo "Operacion Comercial"). No hace falta migración de
permiso.

## Endpoints

| Método | Ruta | Permiso | Notas |
|---|---|---|---|
| `GET` | `/vendedores?sucursal=TJ` | solo sesión | Acotado por `resolverAlcance()`. Devuelve activos e inactivos — no hay reactivación desde el portal (ver "Fuera, a propósito"), pero la tabla necesita mostrar quién está dado de baja, igual que Vehículos y Usuarios. |
| `POST` | `/vendedores` | `vendedor.gestionar` | Sucursal según D3. `409 folio-segmento-repetido` si las iniciales ya están tomadas en esa sucursal (D6). `409` si el login ya existe (D4). |
| `PATCH` | `/vendedores/:id` | `vendedor.gestionar` | `nombre?`, `contrasena?`, `activo?`. Si `nombre` cambia, se re-evalúa la colisión de segmento (D6) — el segmento **no se recalcula** si no colisiona, pero si el nuevo nombre chocara con otro vendedor activo de esa sucursal, se rechaza igual que en el alta. `403` si el vendedor es de otra sucursal. `400` si no hay nada que actualizar. |

`GET` no exige permiso, igual que `/sucursales`, `/productos` y `/vehiculos` — el filtro de
sucursal ya acota lo que cada quien ve; el permiso solo protege la escritura.

> [!warning] Editar el nombre de un vendedor YA existente no puede cambiarle el segmento
> El segmento se **pina** al alta (D6, misma doctrina que el ADR). Si `PATCH` cambia `nombre` pero
> el segmento ya asignado sigue libre de colisión con el nuevo nombre, el segmento **no se
> recalcula** — solo se usa para decidir si el nuevo nombre choca con OTRO vendedor. Reevaluar y
> reasignar el propio segmento de alguien que ya tiene folios en la calle repetiría el error que
> ADR-0007 ya descartó para el código de sucursal.

### Forma de la respuesta

```json
{
  "id": "uuid",
  "nombre": "Roberto Pérez",
  "login": "rperez",
  "sucursalId": "uuid",
  "sucursalCodigo": "TJ",
  "folioSegmento": "RP",
  "activo": true
}
```

## Archivos

### Backend — `apps/backend/src/modules/nomina-comisiones/`

| Archivo | Qué hace |
|---|---|
| `vendedores.repository.ts` | `listar()`, `listarPorCodigoSucursal()`, `buscarPorId()`, `buscarPorLogin()`, `contarConSegmentoEnSucursal()`, `crear()`, `actualizar()`, `buscarSucursalUsuario()`. |
| `vendedores.service.ts` | Alcance (D3), rechazo por colisión de segmento (D6) usando `candidatosDeSegmento` de `sincronizacion/segmento-vendedor.ts`, mapeo de `23505` → 409 (login y — de respaldo — el unique de segmento), `400` de `PATCH` vacío, `404`. |
| `vendedores.controller.ts` | Los tres endpoints con sus decoradores. |
| `dto/crear-vendedor.dto.ts` | `nombre` (1–120, recortado), `login` (1–60, `@Transform` a minúsculas), `contrasena` (1–200, sin mínimo — D5), `sucursalId?` (uuid). |
| `dto/editar-vendedor.dto.ts` | `nombre?`, `contrasena?`, `activo?`. Sin `sucursalId` (D3) ni `login` (no se pidió editarlo; si hiciera falta, mismo `@Transform` que el alta). |
| `nomina-comisiones.module.ts` | Deja de estar vacío. |

### Backend — migraciones (`supabase/migrations/`)

| Archivo | Qué hace |
|---|---|
| `20260912_vendedor_login_indice_parcial.sql` | D4. Nombre exacto (timestamp completo) se fija al crear el archivo con `supabase migration new`. |
| `20260912_vendedor_segmento_por_sucursal.sql` | D6. Va **después** de la anterior si se generan en la misma corrida — el orden entre ellas no importa, ninguna depende de la otra. |

### Backend — script

| Archivo | Qué cambia |
|---|---|
| `scripts/crear-vendedor.ts` | Deja de llamar `asignarSegmento()`; usa la misma validación de colisión que `VendedoresService.crear()` (D8). |

### Portal — `apps/portal/src/`

| Archivo | Qué hace |
|---|---|
| `lib/vendedores.ts` | `Vendedor`, `listarVendedores(sucursal?)`, `crearVendedor()`, `editarVendedor()`. Molde de `lib/vehiculos.ts`. |
| `components/vendedores/pantalla-vendedores.tsx` | `PantallaCatalogo<Vendedor>` con `deps={[sucursal]}`. Columnas: Nombre · Login · Sucursal · Segmento · Estado. |
| `components/vendedores/formulario-vendedor.tsx` | `nombre`, `login`, `contraseña` (patrón T-13: vacío en edición = no cambiar, **sin** `minLength`), desplegable de sucursal solo si `usuario.sucursal === null` y solo en el alta, checkbox `activo` solo en edición. |
| `app/(portal)/catalogo/vendedores/page.tsx` | Deja de ser placeholder. |

## Pruebas

| Capa | Qué se prueba |
|---|---|
| **pgTAP** | `uq_vendedor_login`: rechaza login duplicado case-insensitive entre vivos · lo libera un `deleted_at` · `uq_vendedor_folio_segmento`: rechaza mismo segmento en la misma sucursal · **permite** el mismo segmento en sucursales distintas (el caso "Juan Pérez" del cliente) · un `deleted_at` libera el segmento; `activo = false` **no** lo libera (D7). |
| **Unitarias** | La regla de rechazo de D6 como función pura (mismo criterio que `alcance-sucursal.spec.ts`): nombre nuevo con iniciales libres en su sucursal → pasa; mismas iniciales en la misma sucursal con un vendedor activo → rechaza; mismas iniciales pero en otra sucursal → pasa; mismas iniciales pero el otro vendedor está dado de baja (`deleted_at`) → pasa; mismas iniciales pero el otro solo está `activo = false` (no borrado) → **rechaza** (D7). |
| **e2e backend** (`vendedores.e2e-spec.ts`) | CRUD completo · alcance por sucursal en alta/edición (como Vehículos) · colisión de segmento en la misma sucursal → 409 · sin colisión en sucursal distinta → 201 · login duplicado (incluida variación de mayúsculas) → 409 · sin `vendedor.gestionar` → 403 en escritura · `GET` sin permiso funciona · contraseña de 1 carácter se acepta (D5) · editar contraseña en blanco no la cambia. |
| **Portal** | Pantalla de integración siguiendo T-65, `pantalla-vehiculos.tsx` como referencia más cercana (selector de sucursal condicional): carga con/sin `vendedor.gestionar`, alta completa, edición con contraseña en blanco, mensaje del 409 de colisión de segmento legible en el formulario. |

### Verificación manual (Playwright, Postgres **local**, nunca `sinmex dev`)

1. Alta de vendedor como usuario atado a TJ (sin desplegable de sucursal).
2. Alta de un segundo vendedor con las mismas iniciales en TJ → error legible, no se crea.
3. El mismo nombre/iniciales, pero eligiendo MX (como Administrador General) → se crea sin
   problema — replica el ejemplo del cliente (Juan Pérez en TJ y MX).
4. Editar el nombre de un vendedor a algo que colisiona con otro de su misma sucursal → rechazado,
   el vendedor conserva su nombre y segmento originales.
5. Desactivar un vendedor y confirmar que su login/segmento **no** se liberan (dar de alta a otro
   con las mismas iniciales en esa sucursal sigue fallando).
6. Como Administrador General: el desplegable de sucursal se pinta al dar de alta.
7. Un usuario sin `vendedor.gestionar` no ve "Nuevo vendedor" ni "Editar".

## Después del merge

- **Comentar el issue #62** aclarando que el criterio de desambiguación se resolvió con la
  enmienda de `ADR-0007` (rechazo, no cesión), no con la estrategia original de T-14.
- **Actualizar el vault:**
  - `10-Dominio/Entidades/Vendedor.md` — reemplaza el `[!success] Enmendado 2026-09-12` (que hoy
    describe la decisión) por la confirmación de que ya está **implementado**, con el archivo/línea
    donde vive la regla.
  - `ADR-0007` — mismo cambio de estado (de "decidido, pendiente de implementar" a
    "implementado").
  - `00-Inicio/Estado del proyecto.md` — fila de T-62 y la tabla de catálogos pendientes (queda en
    cero: T-62 era el último).

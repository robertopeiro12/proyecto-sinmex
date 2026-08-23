# T-11 · Catálogo de Vehículos (alta con kilometraje inicial)

- **Issue:** [#11](https://github.com/robertopeiro12/proyecto-sinmex/issues/11) — Sprint 3
- **Depende de:** T-05 (esquema, hecho), T-03 (scaffold del portal, hecho), T-09 (alcance por
  sucursal, hecho), T-08a (guard de permisos, hecho), T-10 (componentes de catálogo, hecho)
- **Fecha:** 2026-08-23
- **Producto:** Backend + Portal Web

## Objetivo

Que administración pueda dar de alta, editar y dar de baja los **vehículos** de reparto desde el
portal, con su **kilometraje al alta** y su **sucursal**. Es de lo que cuelga la selección de
vehículo al iniciar la jornada en la tablet (T-38) y el reporte de Kilometraje (Información →
Reportes).

Ver `10-Dominio/Entidades/Vehículo.md` en el vault.

Es la **tercera** pantalla de catálogo del portal y la primera que combina dos cosas que hasta
ahora venían separadas: el **filtro por sucursal** de T-09 (Sucursales) y la **baja lógica con
columna `activo`** de T-10 (Productos). Sirve además como prueba de que `PantallaCatalogo` aguanta
un caso con un campo condicional sin necesitar props nuevos.

## Alcance

### Dentro

1. Migración con el índice único `(sucursal_id, lower(nombre))` que a T-05 le faltó.
2. Módulo de backend en `modules/rutas/` con `GET`/`POST`/`PATCH` de `/vehiculos`, con alcance por
   sucursal.
3. Pantalla `/catalogo/vehiculos` en el portal (hoy es un placeholder), con el candado
   `vehiculo.gestionar` en las acciones de escritura.
4. Pruebas: pgTAP del índice único, e2e del CRUD y del alcance, verificación manual con Playwright.

### Fuera, a propósito

| Qué | Por qué |
|---|---|
| **Kilometraje inicial/final del día** | Es la **jornada**, no la ficha del vehículo. El propio `Vehículo.md` del vault ya recomienda separarlos: la ficha vive en `vehiculo`, los registros diarios son de **T-38** (tablet) y hoy ni siquiera tienen tabla en el backend (`contrato.ts:54` lo deja anotado como TODO). |
| **Reporte de Kilometraje** | Portal → Información → Reportes, su propio ticket. Este ticket solo deja la ficha del vehículo de la que el reporte va a colgar. |
| **"Disponible para precarga en la app (T-38)"** (criterio del issue) | **Ya está hecho desde T-07.** `sincronizacion.repository.ts:136` sincroniza `vehiculo` (id, nombre, sucursal_id, activo) filtrado por la sucursal del vendedor, y deriva la bandera con `bandera(f.activo, f.deleted_at)`. No hay nada nuevo que construir; ver D5. |
| **Crear un módulo `modules/vehiculos/`** | El `CLAUDE.md` fija que los módulos usan los slugs del vault, y `Vehículo.md` declara `modulo: rutas`. Ver D1. |
| **Extraer una capa compartida de "repositorio con alcance"** | YAGNI. Solo dos módulos la necesitan hoy. T-10 ya fijó el criterio: se extrae cuando aparece la tercera copia, no antes. Ver D7. |

> [!info] El criterio 3 del issue #11 ya está cumplido por otro ticket
> Al abrir el PR hay que **comentar el issue** dejando escrito que la precarga en la app la resolvió
> T-07, o al cerrarlo parecerá que se hizo aquí. Mismo cuidado que T-10 tuvo con los criterios que
> pertenecían a T-16/T-18.

## Decisiones

### D1 — El módulo vive en `modules/rutas/`, que hoy está vacío

`Vehículo.md` del vault declara `modulo: rutas` en su frontmatter, y `CLAUDE.md` fija que los
módulos del backend usan **los mismos slugs que el vault**. `RutasModule` ya existe como stub vacío
(`modules/rutas/rutas.module.ts`) y ya está registrado en `app.module.ts`, así que solo hay que
llenarlo.

Es distinto del caso de T-09 (`modules/sucursales/`), que sí fue un módulo nuevo **porque
`Sucursal` atraviesa los 12 módulos de dominio** en vez de pertenecer a uno. El vehículo sí
pertenece a uno.

### D2 — El catálogo SÍ filtra por el selector "Por sucursal"

A diferencia de Productos (T-10, D4), donde el catálogo de sabores es de la empresa entera. Un
vehículo **pertenece físicamente a una sucursal** (`sucursal_id` es `not null` desde T-05), así que
`resolverAlcance()` de T-09 aplica igual que en Sucursales: un administrador atado a Tijuana ve y
gestiona solo los vehículos de Tijuana; un Administrador General (`sucursal_id` nulo) ve todos o
filtra con el selector.

Se reutiliza `resolverAlcance()` **tal cual**, sin tocarla: T-09 la escribió como función pura
precisamente para que la reusaran los cinco catálogos siguientes.

### D3 — Al dar de alta, la sucursal la decide el alcance del usuario, no el cliente

Misma doctrina de T-09: **el cliente propone, el servidor dispone**.

- Usuario **atado a una sucursal** → el vehículo se crea en la suya. Si el DTO trae un
  `sucursal_id`, se **ignora** (no se responde 403: no es un intento de escalada, es un campo que
  el formulario ni siquiera pinta para él).
- Usuario **General** (`sucursal_id` nulo) → tiene que mandar `sucursal_id`; si no llega, es 400.
  El formulario le pinta un desplegable.

En la **edición** el alcance se compara contra la sucursal del vehículo **ya leído de la base**, no
contra el query param — copiado literal de `sucursales.service.ts:81`, donde ese comentario ya
explica por qué: *"aquí el objeto que se va a modificar es el hecho, no lo que el cliente diga"*.

**La sucursal de un vehículo no se puede cambiar en la edición.** No es una limitación técnica sino
la misma cautela que el código inmutable de sucursal (T-09): mover un vehículo de sucursal
cambiaría a qué alcance pertenecen sus registros históricos de kilometraje. Si el negocio de verdad
reasigna vehículos entre sucursales, es un ticket propio con su propia regla para el histórico.

### D4 — El nombre es único por sucursal, y es texto descriptivo libre

El nombre ("Nissan 2019") **identifica** el vehículo para quien lo elige en la app, pero **no es un
código con formato** como el de sucursal: no se valida contra ningún patrón, solo se recorta y se
acota a 80 caracteres, igual que `producto.nombre`.

El índice único va **por sucursal**, no global: dos sucursales pueden tener cada una su "Nissan
2019" sin chocar, pero dentro de la misma sucursal dos vehículos con el mismo nombre harían que el
vendedor no supiera cuál está eligiendo.

Va en la **base** y no solo en el DTO, por la misma razón que T-09 (check del código), T-10
(`uq_producto_nombre`) y T-14 (unique del folio): las semillas y los scripts de alta entran por
debajo de la API.

```sql
create unique index uq_vehiculo_nombre_sucursal
  on vehiculo (sucursal_id, lower(nombre))
  where deleted_at is null;
```

- `lower()`: "Nissan 2019" y "nissan 2019" son el mismo vehículo (mismo criterio que
  `uq_producto_nombre`).
- `where deleted_at is null`: por consistencia con `uq_producto_nombre` y con el resto del esquema,
  donde `deleted_at` significa "esta fila ya no cuenta".

> [!warning] Desactivar un vehículo NO libera su nombre
> La baja desde el portal es `activo = false` (D5), y el índice **no** filtra por `activo`, así que
> un "Nissan 2019" desactivado en Tijuana sigue impidiendo crear otro "Nissan 2019" en Tijuana. Es
> lo correcto y es lo mismo que hace Sucursales con su código: mientras la fila exista, su nombre
> sigue siendo suyo — y lo que se quiere en ese caso es **reactivar** el vehículo, no crear un
> duplicado. El filtro por `deleted_at` solo entraría en juego si algún día apareciera un camino de
> borrado real, que hoy no existe.

### D5 — La baja usa `activo`, y la sincronización con la tablet ya la respeta

`vehiculo` tiene **las dos** columnas: `activo boolean` y `deleted_at timestamptz`. Este ticket
usa **`activo`** para la baja desde el portal (checkbox "Activo", igual que Sucursales), y `deleted_at`
se queda sin usar — como en Sucursales, donde tampoco hay borrado desde la API.

No hace falta tocar nada de sincronización: `sincronizacion.repository.ts:136` ya deriva la bandera
que baja a la tablet con `bandera(f.activo, f.deleted_at)`, así que poner `activo = false` desde el
portal hace que el vehículo **deje de ofrecerse** al vendedor en el siguiente pull, conservando el
histórico de jornadas que ya lo referencian. El pull es incremental (`updated_at > desde`) y una
baja lógica es un `update`, así que viaja por el cursor.

`km_inicial` **no** viaja a la tablet y así se queda: el vendedor captura el km del día, no le
sirve el del alta.

### D6 — `km_inicial` es editable siempre

A diferencia del código de sucursal (T-09) y del folio (T-14), que son inmutables porque quedan
escritos en documentos que no se pueden corregir hacia atrás, el kilometraje al alta es solo el
punto de partida histórico del vehículo. Si se capturó mal, corregirlo es lo correcto.

La columna es `numeric(10,2)`. El DTO lo valida como número `>= 0`.

### D7 — Sin abstracciones nuevas: se reusa lo de T-10 y se copia el patrón de T-09

**En el portal**, la pantalla se arma con `PantallaCatalogo<Vehiculo>` de T-10 sin agregarle ni un
prop. El campo condicional (el desplegable de sucursal, que solo ve un usuario General) vive
**dentro del `FormularioVehiculo`**, que es opaco para `PantallaCatalogo`. Esto es exactamente lo
que T-10 predijo que debía pasar: si un catálogo necesita algo especial, va en su formulario, no en
el envoltorio.

**En el backend**, `VehiculosRepository` tiene su propio `buscarSucursalUsuario()` en vez de
importar el de `sucursales/`. Es ~10 líneas duplicadas, y la alternativa (una capa compartida de
"repositorio con alcance") se descarta por YAGNI: solo dos módulos la necesitan hoy. T-10 ya dejó
escrito el criterio para este tipo de extracción —`esDuplicado()` está triplicado y **tampoco** se
extrajo— : se hace cuando aparece la tercera o cuarta copia y el patrón está claro, no antes.

Diferencia con el de Sucursales: este devuelve también el `id`, no solo el `codigo`, porque hace
falta para el `insert` de D3.

## Modelo de datos

La tabla ya existe desde T-05 (`20260803163100_catalogos.sql:23`) y **no se modifica**:

```sql
create table vehiculo (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  nombre text not null,
  km_inicial numeric(10,2),
  sucursal_id uuid not null references sucursal(id),
  activo boolean not null default true
);
```

El permiso `vehiculo.gestionar` también existe ya, sembrado por T-05
(`20260803163500_semillas.sql:34`, grupo `Operacion Comercial`). **No hace falta la migración de
permiso** que T-08a sí necesitó para `sucursal.gestionar`.

Lo único que se agrega es el índice único de D4.

> [!note] `km_inicial` es nullable en la base y obligatorio en el DTO
> No se cambia la columna a `not null`: la tabla puede tener filas viejas y una migración de
> columna sobre datos existentes no vale la pena por un campo que la API ya exige. El DTO es quien
> lo hace obligatorio en el alta.

## Endpoints

| Método | Ruta | Permiso | Notas |
|---|---|---|---|
| `GET` | `/vehiculos?sucursal=TJ` | solo sesión | Acotado por `resolverAlcance()`. Devuelve activos e inactivos (la pantalla necesita ver uno desactivado para reactivarlo). |
| `POST` | `/vehiculos` | `vehiculo.gestionar` | Sucursal según D3. `409` si el nombre ya existe en esa sucursal. |
| `PATCH` | `/vehiculos/:id` | `vehiculo.gestionar` | `nombre?`, `km_inicial?`, `activo?`. `403` si el vehículo es de otra sucursal. `400` si no hay nada que actualizar. |

`GET` **no** exige permiso, igual que `/sucursales` y `/productos`: el catálogo lo van a necesitar
Rutas (T-38) y los reportes, no solo quien lo administra. El alcance de lo que cada quien ve ya lo
acota `resolverAlcance()`.

`:id` pasa por `ParseUUIDPipe` para que un id mal formado sea 400 y no un 500 desde Postgres (mismo
motivo que T-09 y T-10).

### Forma de la respuesta

```json
{
  "id": "uuid",
  "nombre": "Nissan 2019",
  "kmInicial": 145230.5,
  "sucursalId": "uuid",
  "sucursalCodigo": "TJ",
  "activo": true
}
```

`sucursalCodigo` viaja junto al `sucursalId` porque la tabla del portal pinta el código y sin él
haría una segunda petición para traducir uuid → código. Sale de un `join` a `sucursal`.

## Archivos

### Backend — `apps/backend/src/modules/rutas/`

| Archivo | Qué hace |
|---|---|
| `vehiculos.repository.ts` | `listar()`, `listarPorCodigoSucursal()`, `buscarPorId()`, `crear()`, `actualizar()`, `buscarSucursalUsuario()`. Join a `sucursal` para el código. |
| `vehiculos.service.ts` | Alcance (D3), mapeo de `23505` → 409, `400` de PATCH vacío, `404`. |
| `vehiculos.controller.ts` | Los tres endpoints con sus decoradores. |
| `dto/crear-vehiculo.dto.ts` | `nombre` (1–80, recortado), `kmInicial` (número ≥ 0), `sucursalId?` (uuid). |
| `dto/editar-vehiculo.dto.ts` | Los tres opcionales. Sin `sucursalId` (D3). |
| `rutas.module.ts` | Deja de estar vacío: registra controller, service y repository. |

### Portal — `apps/portal/src/`

| Archivo | Qué hace |
|---|---|
| `lib/vehiculos.ts` | `Vehiculo`, `listarVehiculos(sucursal?)`, `crearVehiculo()`, `editarVehiculo()`. Molde de `lib/sucursales.ts`. |
| `components/vehiculos/pantalla-vehiculos.tsx` | `PantallaCatalogo<Vehiculo>` con `deps={[sucursal]}`. Columnas: Nombre · Sucursal · Km inicial · Estado. |
| `components/vehiculos/formulario-vehiculo.tsx` | `nombre`, `kmInicial`, desplegable de sucursal **solo si** `usuario.sucursal === null`, checkbox `activo` solo en edición. |
| `app/(portal)/catalogo/vehiculos/page.tsx` | Deja de ser placeholder. Lee `searchParams.sucursal` como la de Sucursales. |

El formulario sabe si el usuario es General leyendo `usuario.sucursal === null` del `AuthProvider`
(`/auth/me` ya devuelve `sucursal: { id, codigo, nombre } | null` desde T-06). **No hace falta
ningún endpoint nuevo.** El desplegable se llena con `listarSucursales()` de `lib/sucursales.ts`,
filtrando las inactivas.

## Pruebas

| Capa | Qué se prueba |
|---|---|
| **pgTAP** | El índice único: rechaza nombre duplicado en la misma sucursal (incluso con distinta capitalización) · **permite** el mismo nombre en dos sucursales distintas · un vehículo con `deleted_at` libera su nombre · un vehículo con `activo = false` **NO** lo libera (D4). |
| **e2e backend** (`vehiculos.e2e-spec.ts`) | CRUD completo · usuario de TJ crea sin mandar sucursal y cae en TJ · usuario de TJ no puede editar un vehículo de MX (403) · usuario General elige sucursal · General sin `sucursalId` → 400 · nombre duplicado → 409 · `POST`/`PATCH` sin `vehiculo.gestionar` → 403 · `GET` sin permiso funciona · id mal formado → 400. |
| **Portal** | Sin pruebas de pantalla propias, igual que Sucursales y Productos: T-10 acotó las pruebas del portal a las piezas compartidas (`useCatalogo`, `TablaCatalogo`, `useEnvioFormulario`), que ya están cubiertas y son las que este ticket reusa. |
| **Unitarias** | Ninguna nueva. `resolverAlcance()` ya tiene las suyas desde T-09 y no cambia. |

### Verificación manual (Playwright, Postgres **local**)

Nunca contra `sinmex dev` — T-09 dejó anotado en `CLAUDE.md` que `npm run backend` escribe en la
base compartida en la nube. Checklist:

1. Alta de vehículo como usuario atado a TJ (sin desplegable de sucursal visible).
2. El vehículo aparece en la tabla con su código de sucursal y su km.
3. Editar el nombre y el km; reabrir el formulario y confirmar que el cambio quedó del lado del
   servidor.
4. Desactivar el vehículo → sigue en la lista, marcado como inactivo → reactivarlo.
5. Nombre duplicado en la misma sucursal → error legible, no un 500. Y con el vehículo del paso 4
   desactivado, intentar crear otro con su mismo nombre también da el 409 (D4).
6. Con el selector "Por sucursal" en MX, el vehículo de TJ no aparece.
7. Como Administrador General: el desplegable de sucursal sí se pinta y se puede crear en MX.
8. Un usuario sin `vehiculo.gestionar` no ve el botón "Nuevo vehículo" ni el de "Editar".

## Después del merge

- **Comentar el issue #11** con el criterio 3 (precarga en la app) resuelto por T-07.
- **Actualizar el vault:**
  - `10-Dominio/Entidades/Vehículo.md` — su bloque `[!warning] Pendiente de confirmar` dice que la
    asignación a sucursal *"se infiere del modelo multi-sucursal de v2.0; confirmar"*. Ya está
    confirmada e implementada. El segundo punto (kilometrajes diarios como registros aparte) también
    queda decidido: sí, son de T-38, y esta ficha no los lleva.
  - `00-Inicio/Estado del proyecto.md` — fila de T-11 y la tabla de catálogos pendientes.

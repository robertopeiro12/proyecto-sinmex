# T-12 · Cartera de Clientes (alta/modificación/baja, %comisión, tipos, filtro)

- **Issue:** [#12](https://github.com/robertopeiro12/proyecto-sinmex/issues/12) — Sprint 4
- **Depende de:** T-09 (alcance por sucursal, hecho), T-10 (catálogo de productos, hecho), T-18
  (listas de precios, hecho)
- **Fecha:** 2026-08-31
- **Producto:** Backend + Portal Web

## Objetivo

Que administración pueda dar de alta, editar y dar de baja clientes/prospectos desde el portal:
datos de contacto, lista de precios asignada + override especial por presentación, promoción
(10+1/20+1) sobre productos seleccionados, plazo de crédito, %comisión y ubicación.

Ver `10-Dominio/Entidades/Cliente.md` en el vault.

Es el **quinto** catálogo del portal. El más grande hasta ahora: combina alcance por sucursal
(T-09), baja lógica (T-10/T-11) e historización no retroactiva (T-18) en una sola pantalla.

## Alcance

### Dentro

1. Migración con `unique (cliente_id, presentacion_id, vigente_desde)` sobre `cliente_precio`
   (mismo patrón que `uq_precio_vigencia` de T-18).
2. Módulo de backend en `modules/cartera-clientes/` (ya tiene `precios.*`/`listas-precio.*` de
   T-18): `GET/POST/PATCH/DELETE /clientes` + `GET/POST /tipos-negocio`.
3. Pantalla `/catalogo/clientes` en el portal (hoy placeholder), con filtro "Por sucursal" (T-09)
   + filtro "Tipo" (Cliente/Prospecto/Todos).
4. Pruebas: pgTAP del unique nuevo, e2e de los endpoints y del alcance, pantalla con Testing
   Library (patrón T-65).

### Fuera, a propósito

| Qué | Por qué |
|---|---|
| **Notificación de nota vencida por crédito** | Es T-54. T-12 solo captura `plazo_credito_dias`; nadie consume el campo todavía. |
| **Mapa interactivo para capturar coordenadas** | El issue pide "coordenadas", no un picker. Dos inputs numéricos (lat/lng) para pegar desde Google Maps — igual de funcional, sin dependencia nueva. |
| **Búsqueda/paginación en servidor** | El vault anota "carga perezosa" pero ningún catálogo del portal la tiene hoy (Productos/Vehículos cargan todo). Se sigue el patrón existente; se revisita si el volumen real lo justifica. |
| **Catálogo propio (pantalla aparte) de Tipos de Negocio** | Sin lista del cliente ("se deja igual" del v1) ni semilla. Se resuelve con alta inline desde el formulario de Cliente (ver D1). |
| **Permiso `prospecto.gestionar`** | Ya sembrado (T-05) pero sin uso en este ticket — es para cuando el vendedor dé de alta prospectos desde la tablet (otro ticket). El portal gatea con `cliente.gestionar` para toda la pantalla (ver D2). |
| **Cálculo del precio de una línea de venta con override aplicado** | T-16. T-12 solo deja el override consultable. |

## Decisiones

### D1 — "Tipo de Negocio" se crea inline desde el formulario de Cliente, sin pantalla propia

La tabla `tipo_negocio` existe desde T-05 pero está vacía: el cliente nunca dio una lista concreta
("Tipo de Negocio: para clasificar cliente/prospecto... se deja igual"). Construir una pantalla de
catálogo aparte para una lista que nadie ha definido sería especulativo.

El combobox del formulario permite escribir un nombre nuevo y crearlo al vuelo
(`POST /tipos-negocio { nombre }`, `unique(nombre)` ya existe en la tabla) antes de mandar el
`POST`/`PATCH` de cliente con el `tipoNegocioId` resultante. Si el negocio pide después una
pantalla de administración completa (renombrar, dar de baja), es un ticket propio — el catálogo ya
queda migrado y en uso, no hay que tocar el esquema.

### D2 — Un solo permiso (`cliente.gestionar`) gatea toda la pantalla, sin distinguir Cliente/Prospecto

El catálogo de permisos sembrado en T-05 trae `cliente.gestionar` y `prospecto.gestionar` como
claves separadas. Se decidió que la pantalla del portal usa únicamente `cliente.gestionar` para
alta/edición/baja de cualquier fila, sea Cliente o Prospecto — ningún otro catálogo del portal
condiciona sus botones según el valor de una columna de la propia fila, y añadir esa rama de UI
para un caso sin pedido explícito del cliente sería inventar alcance.

`prospecto.gestionar` queda sembrado y sin consumidor hasta que exista una pantalla en la
**tablet** para que el vendedor dé de alta prospectos (`Cliente.md`: "el Vendedor solo puede dar de
alta Prospectos") — ese es su caso de uso real, no el portal.

### D3 — La pantalla NO usa `PantallaCatalogo` de T-10; es una pantalla propia con secciones

El formulario tiene demasiadas secciones (datos básicos, precio/promoción, crédito, ubicación)
para el envoltorio de alta/edición de una fila simple — la misma razón por la que T-18 ya se salió
de `PantallaCatalogo`. T-12 sí reutiliza:

- `TablaCatalogo` (T-10) para el listado.
- El patrón de filtro `?sucursal=` de la barra lateral (T-09) + un filtro adicional `?tipo=` propio
  de esta pantalla.
- `useEnvioFormulario` (T-10) para el estado de guardado del formulario completo.

Se construye en `components/clientes/`, análogo a `components/precios/` de T-18.

### D4 — Alta y edición son un solo `PATCH`/`POST` que reconcilia todo en una transacción

Igual que T-10 reconcilia presentaciones en el mismo `PATCH` que edita el producto, el `POST`/
`PATCH` de cliente acepta un payload único con:

- Campos base (nombre, domicilio, teléfono, encargado, factura, tipo, tipoNegocioId,
  listaPrecioId, pctComision, plazoCreditoDias, lat, lng, comentarios).
- `promocion: 'ninguna' | '10+1' | '20+1'`.
- `productosPromocion: string[]` — ids de producto. Se **ignora y se vacía** en la base si
  `promocion === 'ninguna'`, aunque el cliente mande algo (evita el estado inconsistente
  "promoción ninguna con productos seleccionados").
- `overridesPrecio: { presentacionId: string; precio: number | null }[]` — `precio: null` significa
  "usa el precio de lista" (no hay override); una fila con `precio` numérico dispara el upsert de
  D5.

Todo dentro de una única `Kysely.transaction()` (plantilla de T-10): actualizar/insertar `cliente`,
reemplazar el set de `cliente_promocion_producto`, y upsertear las filas de `cliente_precio` que
traigan `precio` no nulo. Una función pura `reconciliarPromocionProductos()` (análoga a
`reconciliarPresentaciones` de T-10) decide qué insertar/borrar del set de productos, testeable sin
base de datos.

### D5 — Override de precio: mismo patrón de historización no retroactiva que T-18 (D3/D4)

`cliente_precio` no tiene `sucursal_id` propio (el cliente ya pertenece a una sucursal fija, D6),
así que el unique es más corto que el de `precio`:

```sql
alter table cliente_precio
  add constraint uq_cliente_precio_vigencia
  unique (cliente_id, presentacion_id, vigente_desde);
```

`vigente_desde` es la fecha local del navegador (mismo cuidado de zona horaria que T-18 D3 y los
folios de T-14), nunca derivada por el servidor. El `upsert` corrige la fila de hoy si el admin ya
había tocado ese override hoy, en vez de duplicarla. Quitar un override (volver a "usa lista") es
un `DELETE` de la fila vigente de hoy si existe, o no-op si el override nunca se guardó hoy — no se
modela como una fila con `precio = null` porque la columna es `not null`.

El precio vigente para lectura (`GET /clientes/:id`) sale con el mismo `DISTINCT ON` de T-18 D3,
acotado a `cliente_id` en vez de `sucursal_id`.

### D6 — Sucursal inmutable tras el alta, misma regla que Vehículo (T-11 D2)

El alcance de la sucursal sale de `resolverAlcance()` (T-09), sin tocarla. Un usuario atado a una
sucursal no manda `sucursalId` (se toma la suya); un Administrador General sí debe mandarlo en el
alta. El DTO de edición no lleva el campo — no hay caso de negocio para mover un cliente de
sucursal, y las ventas/folios futuros (T-16) van a colgar de ella.

### D7 — Filtro "Tipo" es acotamiento en cliente, no un parámetro nuevo de alcance

`GET /clientes?sucursal=&tipo=` sigue devolviendo todas las filas de la sucursal resuelta;
`tipo` (`cliente`/`prospecto`/`todos`) es un filtro plano de columna, no interactúa con
`resolverAlcance()`. Se aplica en el `WHERE` del repositorio (no en el cliente) porque no hay razón
para bajar prospectos a un navegador que solo quiere ver clientes — a diferencia de la carga
completa por sucursal (D del Alcance, "fuera de propósito"), que si se filtra en cliente porque es
la misma lista completa la que ya se necesita para buscar por nombre.

### D8 — `pct_comision` se serializa igual que `km_inicial` (T-11) y `precio` (T-18)

`pct_comision` es `numeric(5,2)`; el driver `pg` la entrega como cadena. Se reusa `aNumero()` de
`modules/sincronizacion/dinero.ts` (ya usada por T-11 y T-18), no se duplica una tercera vez —
tercer consumidor real, candidato ya maduro para mudarse a un módulo compartido si aparece un
cuarto (anotado también en T-11, sin resolver aquí para no tocar código fuera de este ticket).

## Modelo de datos

`cliente`, `cliente_precio` y `cliente_promocion_producto` ya existen desde T-05
(`20260803163300_clientes.sql`) y **no cambian de forma**:

```sql
create table cliente (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  nombre text not null,
  domicilio text not null,
  telefono text not null,
  encargado text,
  factura boolean not null default false,
  tipo text not null check (tipo in ('cliente','prospecto')),
  tipo_negocio_id uuid references tipo_negocio(id),
  lista_precio_id uuid not null references lista_precio(id),
  pct_comision numeric(5,2),
  promocion text not null default 'ninguna' check (promocion in ('ninguna','10+1','20+1')),
  plazo_credito_dias integer,
  lat numeric(9,6),
  lng numeric(9,6),
  comentarios text,
  sucursal_id uuid not null references sucursal(id)
);

create table cliente_precio (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  cliente_id uuid not null references cliente(id),
  presentacion_id uuid not null references presentacion(id),
  precio numeric(12,2) not null,
  vigente_desde date not null
);

create table cliente_promocion_producto (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  cliente_id uuid not null references cliente(id),
  producto_id uuid not null references producto(id),
  unique (cliente_id, producto_id)
);

create table tipo_negocio (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  nombre text not null unique
);
```

Migración nueva de T-12 (unique de vigencia, D5):

```sql
alter table cliente_precio
  add constraint uq_cliente_precio_vigencia
  unique (cliente_id, presentacion_id, vigente_desde);
```

Sin migración de permisos — `cliente.gestionar` ya existe desde T-05 (D2).

## Endpoints

| Método | Ruta | Permiso | Notas |
|---|---|---|---|
| `GET` | `/clientes?sucursal=&tipo=` | solo sesión | Lista acotada por `resolverAlcance()` (T-09) y por `tipo` (D7, columna plana). Sin overrides ni promoción — solo campos de lista. |
| `GET` | `/clientes/:id` | solo sesión | Detalle completo: campos base + overrides vigentes de `cliente_precio` (D5) + `productosPromocion` (ids). |
| `POST` | `/clientes` | `cliente.gestionar` | Payload de D4. `sucursalId` obligatorio si el usuario es General (D6); `404` si `tipoNegocioId`/`listaPrecioId` no existen. |
| `PATCH` | `/clientes/:id` | `cliente.gestionar` | Mismo payload de D4, sin `sucursalId` (D6) ni `tipo` (no se reclasifica Cliente↔Prospecto aquí — no lo pide el issue; si se necesita, es un `PATCH` de un campo aparte en un ticket futuro). |
| `DELETE` | `/clientes/:id` | `cliente.gestionar` | Baja lógica (`deleted_at`). Conserva historial (no hay `Venta-Nota` todavía que referencie `cliente_id`, pero la convención es la misma que T-09/T-10/T-11). |
| `GET` | `/tipos-negocio` | solo sesión | `{ id, nombre }[]` activos — lo necesita el desplegable del formulario, no solo quien gestiona (mismo criterio que `GET /productos`, T-10 D5). |
| `POST` | `/tipos-negocio` | `cliente.gestionar` | `{ nombre }`. `409` si ya existe (mismo `esDuplicado()` de 23505 que T-10/T-11/T-18). |

### Forma de `GET /clientes/:id`

```json
{
  "id": "uuid",
  "nombre": "...",
  "...": "campos base",
  "listaPrecioId": "uuid",
  "overridesPrecio": [
    { "presentacionId": "uuid", "precio": "18.50", "vigenteDesde": "2026-08-31" }
  ],
  "promocion": "10+1",
  "productosPromocion": ["uuid-producto-1", "uuid-producto-2"]
}
```

## Archivos

### Backend — `apps/backend/src/modules/cartera-clientes/`

| Archivo | Qué hace |
|---|---|
| `clientes.repository.ts` | `listar(alcance, tipo)`, `obtener(id)` (incluye el `DISTINCT ON` de D5 y el join de promoción), `crear(...)`, `actualizar(id, ...)`, `darDeBaja(id)`. |
| `clientes.service.ts` | Alcance (reusa `resolverAlcance` de T-09), la transacción de D4, mapeo de `23503`/`23505` a 404/409. |
| `clientes.controller.ts` | Los cinco endpoints de `/clientes`. |
| `reconciliar-promocion-productos.ts` (+ `.spec.ts`) | Función pura de D4, análoga a `reconciliar-presentaciones.ts` de T-10. |
| `tipos-negocio.repository.ts` / `.service.ts` / `.controller.ts` | `GET`/`POST /tipos-negocio`, chicos. |
| `dto/crear-cliente.dto.ts`, `dto/editar-cliente.dto.ts`, `dto/crear-tipo-negocio.dto.ts` | Validación de payloads. |
| `cartera-clientes.module.ts` | Registra los controllers/services/repositories nuevos junto a los de T-18. |

### Portal — `apps/portal/src/`

| Archivo | Qué hace |
|---|---|
| `lib/clientes.ts` | Tipos + `listarClientes`, `obtenerCliente`, `crearCliente`, `actualizarCliente`, `eliminarCliente`, `listarTiposNegocio`, `crearTipoNegocio`. |
| `components/clientes/pantalla-clientes.tsx` | Carga la lista (sucursal+tipo), tabla (`TablaCatalogo`) y abre el formulario. |
| `components/clientes/formulario-cliente.tsx` | Formulario por secciones: datos básicos, tipo de negocio (combobox con alta inline, D1), lista de precios + overrides por presentación (tabla chica dentro del formulario), promoción + selector de productos, crédito, ubicación (lat/lng). |
| `components/clientes/selector-tipo-negocio.tsx` | El combobox con "crear ..." de D1. |
| `app/(portal)/catalogo/clientes/page.tsx` | Deja de ser placeholder. Lee `searchParams.sucursal` y `searchParams.tipo`. |

`nav-config.ts` no cambia — la entrada "Clientes" → `/catalogo/clientes` ya existe desde T-03.

## Pruebas

| Capa | Qué se prueba |
|---|---|
| **pgTAP** | `uq_cliente_precio_vigencia` rechaza dos overrides del mismo cliente/presentación el mismo día · permite vigencias en fechas distintas · `tipo_negocio.nombre` único (ya cubierto desde T-05, sin prueba nueva). |
| **e2e backend** (`clientes.e2e-spec.ts`) | Alta/edición/baja completas (incluyendo overrides y productos de promoción) · `promocion: 'ninguna'` vacía `productosPromocion` aunque se manden ids · filtro `tipo` · alcance por sucursal (403 fuera de alcance, igual que T-09/T-10/T-11) · `sucursalId` ignorado en `PATCH` · `POST /tipos-negocio` duplicado → 409 · sin `cliente.gestionar` → 403 en escritura, 200 en lectura. |
| **Unitarias** | `reconciliar-promocion-productos.spec.ts`, sin base de datos (patrón de T-10). |
| **Portal** | `pantalla-clientes.test.tsx`, Testing Library de integración, copiando el patrón de `pantalla-sucursales.test.tsx` (T-65): carga con/sin permiso, alta, edición, error de servidor. |

### Verificación manual (Playwright, Postgres **local**)

Nunca contra `sinmex dev`. Checklist:

1. Alta de un Cliente completo (todos los campos + un override de precio + promoción 10+1 con 2
   productos) → aparece en la lista, `GET /clientes/:id` trae todo de vuelta.
2. Cambiar promoción a "ninguna" → los productos seleccionados desaparecen del detalle.
3. Editar el mismo override el mismo día → sigue siendo una fila en `cliente_precio`, no dos.
4. Crear un Tipo de Negocio nuevo desde el combobox del formulario, sin recargar la página.
5. Filtro "Tipo: Prospecto" oculta los Clientes y viceversa; "Todos" los muestra a ambos.
6. Un usuario atado a TJ no ve clientes de MX ni puede mandar `sucursalId=MX` en el alta.
7. Baja lógica de un cliente: desaparece de la lista, sigue existiendo en la base.
8. Un usuario sin `cliente.gestionar` ve la lista pero no botones de alta/edición/baja.

## Después del merge

- **Actualizar el vault:**
  - `10-Dominio/Entidades/Cliente.md` — quitar el bloque de implementación pendiente, anotar D1
    (alta inline de Tipo de Negocio) y D2 (permiso único).
  - `00-Inicio/Estado del proyecto.md` — fila de T-12; revisar si desbloquea algo más (T-16 sigue
    siendo el camino crítico, ahora con `cliente` ya gestionable desde el portal).

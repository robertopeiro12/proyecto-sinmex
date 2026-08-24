# T-18 · Listas de precios por sucursal + asignación a cliente

- **Issue:** [#18](https://github.com/robertopeiro12/proyecto-sinmex/issues/18) — Sprint 5
- **Depende de:** T-05 (esquema, hecho), T-09 (alcance por sucursal, hecho), T-10 (catálogo de
  productos/presentaciones, hecho)
- **Fecha:** 2026-08-24
- **Producto:** Backend + Portal Web

## Objetivo

Que administración pueda fijar y editar, desde el portal, el **precio de cada presentación de
producto por lista y por sucursal**, con historial ("de la fecha en adelante"). Es de lo que va a
colgar la asignación de lista a un cliente (T-12) y, más adelante, el cálculo del precio de una
línea de venta (T-16).

Ver `10-Dominio/Reglas/Lista de precios.md` en el vault.

Es la **cuarta** pantalla de catálogo del portal, y la primera que no es un CRUD de una entidad
sino una **matriz** (presentación × lista, acotada por sucursal).

## Alcance

### Dentro

1. Migración que da de baja lógica la fila `'Especial'` sembrada por error en `lista_precio` (T-05
   sembró 5 filas; el vault confirmó el 2026-08-23 que Especial no es una lista).
2. Migración con `unique (presentacion_id, lista_precio_id, sucursal_id, vigente_desde)` sobre
   `precio`, y el permiso `precio.gestionar`.
3. Módulo de backend en `modules/cartera-clientes/` (hoy vacío) con `GET /listas-precio`,
   `GET /precios` y `PATCH /precios`.
4. Pantalla `/catalogo/precios` en el portal (nueva entrada de navegación), con matriz editable
   acotada por el filtro global "Por sucursal" (T-09).
5. Pruebas: pgTAP del unique y de la baja de 'Especial', e2e del endpoint y del alcance.

### Fuera, a propósito

| Qué | Por qué |
|---|---|
| **Alta/baja/renombrar listas de precio** | Son **4 fijas**, sembradas por migración. El vault deja "margen para una 5ª más adelante" si el negocio la pide, pero no la pide hoy — eso es un ticket propio si llega. |
| **Pantalla de cliente, asignación de lista a un cliente concreto, override "Especial"** | Es T-12. Las columnas ya existen desde T-05 (`cliente.lista_precio_id`, tabla `cliente_precio`); T-18 solo dejalas listas y sus precios listos para que T-12 las consuma. |
| **Promoción 10+1 / 20+1** | También T-12 (`cliente_promocion_producto`, ya existe). No tiene relación con el precio de lista. |
| **Cálculo del precio de una línea de venta** | T-16 (todavía sin ticket de implementación). T-18 solo dejará los datos consultables (`GET /precios`); no hay pantalla de venta a la que conectar. |
| **Fecha de vigencia futura (programar un cambio)** | Se decidió que toda edición aplica "desde hoy" (ver D3). Si el negocio pide anunciar cambios con anticipación, es una vuelta a este ticket, no algo que se adivine ahora. |
| **Arreglar `reconciliar-presentaciones.ts` de T-10** | Investigado y descartado: el formulario de T-10 ya manda el `id` correcto al editar el texto de una presentación existente (`formulario-producto.tsx:50-53`), así que no hay pérdida de vínculo ahí. El único camino real a una presentación "nueva" es un `Quitar` + `Agregar` explícito, que es intencional y es baja lógica (no destructiva). Ver D6. |

## Decisiones

### D1 — El módulo vive en `modules/cartera-clientes/`, que hoy está vacío

El propio issue T-12 cita como fuente "Cartera de Clientes · Cliente · Lista de precios" del
vault, y la nota `Lista de precios.md` declara `modulo: cartera-clientes` en su frontmatter. No es
un módulo nuevo (a diferencia de `sucursales/` en T-09): pertenece a un slug de dominio que ya
tiene su stub (`cartera-clientes.module.ts`, vacío) registrado en `app.module.ts`.

### D2 — La matriz SÍ filtra por el selector "Por sucursal", y reusa `resolverAlcance()` tal cual

El precio varía por sucursal (a diferencia del catálogo de productos, T-10 D4, que es de la
empresa entera). `GET /precios` recibe `?sucursal=TJ` y aplica la misma función pura de T-09, sin
tocarla — mismo criterio que T-11 (D2).

Un usuario atado a una sucursal edita solo la suya (el `PATCH` valida `sucursal_id` contra el
alcance, igual que T-09/T-11 validan contra el hecho ya leído, no contra lo que mande el cliente).
Un Administrador General usa el selector para moverse entre sucursales.

### D3 — Historización: cada edición escribe (o corrige) la fila de HOY, nunca una fecha futura

`vigente_desde` es la fecha del cambio, no un campo que el usuario capture. El servicio hace un
**upsert** sobre `(presentacion_id, lista_precio_id, sucursal_id, vigente_desde = current_date)`:

- No existía fila de hoy para esa combinación → `INSERT`, abre un nuevo tramo de historia.
- Ya existía (el admin ya editó ese precio hoy) → `UPDATE` de esa misma fila.

Así "corregir un error que se acaba de capturar" no llena el historial de filas basura el mismo
día, y el criterio de aceptación ("no retroactivo, conserva histórico") queda cubierto sin pedirle
una fecha al usuario. Se decidió explícitamente no dar la opción de programar una vigencia futura
(fuera de alcance, ver arriba).

El **precio vigente** para lectura (`GET /precios`, y más adelante T-16) es, por combinación de
presentación+lista+sucursal, la fila con `vigente_desde` más reciente que sea `<= hoy` y no dada de
baja. Se resuelve con `DISTINCT ON` de Postgres:

```sql
select distinct on (presentacion_id, lista_precio_id)
  presentacion_id, lista_precio_id, precio, vigente_desde
from precio
where sucursal_id = $1
  and deleted_at is null
  and vigente_desde <= current_date
order by presentacion_id, lista_precio_id, vigente_desde desc;
```

### D4 — El unique constraint vive en la base, no solo en el `ON CONFLICT` del service

Mismo criterio que T-09 (código de sucursal), T-10 (`uq_producto_nombre`), T-14 (folio) y T-11
(nombre de vehículo): la base decide, no solo el código, porque las semillas y cualquier carga
futura entran por debajo de la API.

```sql
alter table precio
  add constraint uq_precio_vigencia
  unique (presentacion_id, lista_precio_id, sucursal_id, vigente_desde);
```

El `PATCH` usa `insert ... on conflict (presentacion_id, lista_precio_id, sucursal_id,
vigente_desde) do update set precio = excluded.precio`, apoyado en este mismo constraint — no hay
que hacer un `SELECT` previo para decidir si es alta o corrección.

### D5 — Las 4 listas son fijas; el catálogo de listas es de solo lectura desde el portal

`GET /listas-precio` expone las 4 filas sembradas (id + nombre) para que la matriz pinte sus
columnas y para que T-12 las use en el desplegable de asignación. Sin `@RequierePermiso`: lo va a
necesitar cualquier pantalla que hable de precios, no solo quien los administra — mismo criterio
que `GET /productos` (T-10 D5) y `GET /vehiculos` (T-11).

No hay alta/baja/renombrar de listas en esta pantalla (decisión explícita, ver Alcance). Si el
negocio pide la 5ª lista que el vault deja como posibilidad, es una migración + este mismo ticket
reabierto, no algo que se construya especulativamente ahora.

### D6 — Presentación sin precio todavía: celda vacía, no error

Cualquier presentación nueva (recién creada en T-10, o el resultado de un `Quitar` + `Agregar`
sobre una existente) empieza sin ninguna fila en `precio`. `GET /precios` simplemente no incluye
esa combinación en la respuesta — el portal la pinta como celda vacía ("Sin precio"), invitando a
capturarlo, en vez de fallar o mostrar `$0`.

Esto es lo que efectivamente cierra el riesgo que el vault anotó en `Producto.md` sobre
presentaciones "recreadas" perdiendo su vínculo de precio: no se pierde nada, porque no había
vínculo que perder — es una presentación nueva con precios nuevos por capturar, igual que
cualquier otra presentación nueva. No se toca código de T-10.

### D7 — Sin abstracción nueva de "matriz editable": es una pantalla propia, no una variante de `PantallaCatalogo`

`PantallaCatalogo<T>` (T-10) está armado para alta/edición de **una entidad por fila** con un
formulario modal — el propio componente ya anticipa en su comentario que un caso como este
("filtros, lista de precios...") probablemente no encaje. La matriz de T-18 es más parecida a una
hoja de cálculo (muchas celdas editables a la vez, sin modal) que a un catálogo con alta/edición.

Se construye como pantalla propia en `components/precios/`, reusando lo que sí aplica sin
duplicar: `useCatalogo`-style fetch para cargar productos+presentaciones (`GET /productos`, ya
existente) y precios (`GET /precios`), y `useEnvioFormulario` para el estado de guardado de cada
edición de celda.

## Modelo de datos

`lista_precio` y `precio` ya existen desde T-05 (`20260803163200_precios.sql`) y **no cambian de
forma**:

```sql
create table lista_precio (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  nombre text not null unique
);

create table precio (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  presentacion_id uuid not null references presentacion(id),
  lista_precio_id uuid not null references lista_precio(id),
  sucursal_id uuid not null references sucursal(id),
  precio numeric(12,2) not null,
  vigente_desde date not null
);
```

Migraciones nuevas de T-18:

1. **Baja lógica de 'Especial':**
   ```sql
   update lista_precio set deleted_at = now() where nombre = 'Especial';
   ```
   Baja lógica y no `delete`, mismo criterio D1 del proyecto: si algo llegara a referenciar esa
   fila (no debería — no hay pantalla de cliente todavía), no se rompe una referencia.
2. **Unique de vigencia** (D4): `uq_precio_vigencia` sobre `precio`.
3. **Permiso nuevo:**
   ```sql
   insert into permiso (clave, grupo, descripcion) values
     ('precio.gestionar', 'General', 'Editar precios por lista y sucursal')
   on conflict (clave) do nothing;
   ```
   Grupo `General`, igual que `producto.gestionar` y `sucursal.gestionar`. Administrador General lo
   hereda automático (`permisos.repository.ts:43-44` le da el catálogo completo de `permiso`; no
   hace falta fila en `perfil_permiso`).

## Endpoints

| Método | Ruta | Permiso | Notas |
|---|---|---|---|
| `GET` | `/listas-precio` | solo sesión | Las 4 filas activas de `lista_precio`, `{ id, nombre }`. |
| `GET` | `/precios?sucursal=TJ` | solo sesión | Acotado por `resolverAlcance()`. Precio vigente por presentación×lista (D3). Combinaciones sin precio no aparecen (D6). |
| `PATCH` | `/precios` | `precio.gestionar` | Body `{ presentacionId, listaPrecioId, sucursalId, precio }`. Upsert sobre hoy (D3/D4). `403` si `sucursalId` no está en el alcance del usuario. `400` si `precio <= 0` o algún id no existe. |

`sucursalId` en el `PATCH` (y no inferido del alcance) porque un Administrador General edita varias
sucursales desde el mismo selector de la pantalla — mismo patrón que el `sucursal_id` opcional que
manda un General en T-09/T-11, solo que aquí SIEMPRE es obligatorio (a diferencia de un vehículo,
un precio no "pertenece" por defecto a la sucursal del usuario si es General).

### Forma de la respuesta de `GET /precios`

```json
[
  {
    "presentacionId": "uuid",
    "listaPrecioId": "uuid",
    "precio": "10.50",
    "vigenteDesde": "2026-08-24"
  }
]
```

Lista plana, no anidada por producto — el portal ya tiene `GET /productos` con la jerarquía
producto→presentación; cruzar ambas listas en el cliente evita duplicar esa forma en dos
endpoints.

## Archivos

### Backend — `apps/backend/src/modules/cartera-clientes/`

| Archivo | Qué hace |
|---|---|
| `precios.repository.ts` | `listarListas()`, `listarVigentes(sucursalId)` (el `DISTINCT ON` de D3), `upsertPrecio(...)`. |
| `precios.service.ts` | Alcance (D2), mapeo de `precio <= 0` a 400. El `404` de `presentacionId`/`listaPrecioId` inexistente no es una consulta previa: sale de capturar `23503` (foreign_key_violation) del `insert` y mapearlo, mismo estilo que `esDuplicado()` de T-10 para `23505`. |
| `precios.controller.ts` | Los tres endpoints. |
| `dto/actualizar-precio.dto.ts` | `presentacionId`, `listaPrecioId`, `sucursalId` (uuid), `precio` (número > 0). |
| `cartera-clientes.module.ts` | Deja de estar vacío: registra controller, service, repository. |

### Portal — `apps/portal/src/`

| Archivo | Qué hace |
|---|---|
| `lib/precios.ts` | `ListaPrecio`, `Precio`, `listarListas()`, `listarPrecios(sucursal)`, `actualizarPrecio(...)`. |
| `components/precios/pantalla-precios.tsx` | Carga productos+presentaciones, listas y precios; arma la matriz. |
| `components/precios/celda-precio.tsx` | Un input editable por celda; guarda `onBlur`/Enter vía `actualizarPrecio`, con el candado `precio.gestionar` decidiendo si es editable o de solo lectura. |
| `app/(portal)/catalogo/precios/page.tsx` | Deja de ser placeholder — nueva ruta. Lee `searchParams.sucursal` como las demás. |
| `components/layout/nav-config.ts` | Agrega `{ label: "Listas de Precios", href: "/catalogo/precios" }` bajo "Catálogo". |

## Pruebas

| Capa | Qué se prueba |
|---|---|
| **pgTAP** | La baja de 'Especial' deja exactamente 4 listas activas · `uq_precio_vigencia` rechaza dos precios de la misma combinación el mismo día · permite vigencias en fechas distintas para la misma combinación. |
| **e2e backend** (`precios.e2e-spec.ts`) | `GET /listas-precio` devuelve 4 · `GET /precios` filtra por sucursal y por vigencia (una fila futura no debería existir dado D3, pero una fila de ayer sí se ve; se prueba con un insert directo de una fila con `vigente_desde` de ayer y otra de hoy, confirmando que gana la de hoy) · `PATCH` sin `precio.gestionar` → 403 · `PATCH` con sucursal fuera del alcance → 403 · segundo `PATCH` el mismo día corrige en vez de duplicar (upsert) · `precio <= 0` → 400. |
| **Portal** | Sin pruebas de pantalla propias, mismo gap conocido que el resto del portal. |
| **Unitarias** | Ninguna nueva de lógica pura — a diferencia de T-09/T-10/T-11, aquí no hay una función de reconciliación que valga la pena aislar: el upsert lo resuelve el constraint de la base (D4), no una rama de código con casos a probar por separado. |

### Verificación manual (Playwright, Postgres **local**)

Nunca contra `sinmex dev`. Checklist:

1. Como Administrador General, abrir `/catalogo/precios` con TJ seleccionado: ver la matriz con
   filas de presentación y columnas Lista 1–4, celdas vacías (sin datos sembrados aún).
2. Capturar un precio en una celda → refrescar → sigue ahí.
3. Corregirlo el mismo día → confirmar en la base que sigue siendo **una** fila (no dos) para esa
   combinación.
4. Cambiar el selector a MX → la matriz muestra (o no) precios independientes de los de TJ.
5. Un usuario atado a TJ no ve el selector fuera de TJ y no puede mandar un `PATCH` con
   `sucursalId` de MX (probarlo vía la pestaña de red, no solo la UI).
6. Un usuario sin `precio.gestionar` ve la matriz mismo pero las celdas no son editables.
7. Dar de baja "Especial" ya corrida la migración: no aparece como columna en la matriz.

## Después del merge

- **Actualizar el vault:**
  - `10-Dominio/Entidades/Producto.md` — su bloque de advertencia sobre "Especial" queda resuelto
    dos veces (ya lo estaba en `Lista de precios.md`; falta reflejarlo aquí también) y anotar que
    el caso de presentación "recreada" quedó cerrado por D6 (celda vacía, no pérdida de datos).
  - `00-Inicio/Estado del proyecto.md` — fila de T-18 y la tabla de catálogos pendientes (T-12 deja
    de estar bloqueado por T-18).

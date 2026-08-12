# T-10 · Catálogo de Productos (nombre + presentaciones)

- **Issue:** [#10](https://github.com/robertopeiro12/proyecto-sinmex/issues/10) — Sprint 3
- **Depende de:** T-05 (esquema, hecho), T-03 (scaffold del portal, hecho), T-08a (guard de permisos, hecho)
- **Fecha:** 2026-08-11
- **Producto:** Backend + Portal Web

## Objetivo

Que administración pueda dar de alta, editar y dar de baja los productos que JAWA vende —el
**nombre (sabor)** y sus **presentaciones (volumen)**— desde el portal. Es el catálogo del que
cuelgan los precios (T-18), las líneas de venta (T-16) y el inventario, y hoy solo existe como
tablas vacías de T-05.

Es además la **segunda** pantalla de catálogo del portal, y por eso lleva un segundo objetivo: con
dos casos reales enfrente, extraer lo común de las pantallas de catálogo para que T-11 (Vehículos)
y T-62 (Vendedores) sean baratos.

Ver `10-Dominio/Entidades/Producto.md` en el vault.

## Alcance

### Dentro

1. Migración con los índices únicos que a T-05 le faltaron (`producto.nombre`,
   `presentacion.volumen` por producto).
2. Módulo de backend con `GET`/`POST`/`PATCH` de `/productos`, presentaciones anidadas, en
   transacción.
3. Pantalla `/catalogo/productos` en el portal, con el candado `producto.gestionar` en las
   acciones de escritura.
4. Extracción de los componentes de catálogo compartidos, **y reescritura de la pantalla de
   Sucursales encima de ellos**.
5. Infraestructura mínima de pruebas del portal (Vitest + Testing Library), cubriendo **solo** lo
   compartido.

### Fuera, a propósito

| Qué | Por qué |
|---|---|
| **Precio por lista × sucursal** | Es **T-18**. El propio issue lo dice: *"El precio se maneja por listas (ver T-18)"*. La tabla `precio` existe desde T-05 y se queda vacía. |
| **Status de Promoción que fuerza precio $0** | Es una regla de la **venta** (T-16), no del catálogo. El producto no tiene un campo "es promoción": la promoción se configura por **cliente** (`cliente_promocion_producto`, ya existe). |
| **Ordenar por presentación y luego por sabor** | El criterio dice *"(pantalla de Recarga)"*, que es de la **tablet**, no del portal. El portal ordena por nombre, que es lo que sirve para administrar. |
| Pruebas de las pantallas concretas del portal | Se prueba lo compartido, donde un bug se multiplica por cuatro. Cubrir cada pantalla es el ticket de infraestructura completo que T-03/T-09 dejaron pendiente. |
| Reconciliar `Modelo de datos` del vault con el esquema real | Deuda que destapó el 2026-08-11 y que merece su propio ticket. No se toca aquí. |

> [!warning] Los criterios de aceptación del issue #10 no se cumplen todos
> Dos de los cuatro pertenecen a otros tickets. Al abrir el PR hay que **comentar el issue** dejando
> escrito a dónde se movieron, o al cerrarlo se pierden. Es el mismo cuidado que T-08a tuvo con la
> partición de T-08.

## Decisiones

### D1 — La baja de una presentación es `deleted_at`, no borrado físico

No es una preferencia de estilo: lo exige el contrato de sincronización que ya está construido.

`sincronizacion.repository.ts:174` deja escrito que *"`presentacion` no tiene columna `activo`: su
unica baja es `deleted_at`"*, y deriva la bandera que baja a la tablet con
`activo: bandera(true, f.deleted_at)`. El pull es **incremental** (`where updated_at > desde`), así
que:

- Una baja lógica es un `update` → viaja por el cursor → la tablet recibe `activo: 0` y la esconde.
- Un borrado físico hace que la fila **desaparezca del query** → la tablet nunca se entera y se
  queda con la presentación para siempre.

Además hay `precio` y (pronto) líneas de venta apuntando por llave foránea. Es la misma doctrina que
T-09 fijó para sucursales: *"la baja es desactivar, no borrar"*.

**No se agrega una columna `activo` a `presentacion`.** Sería una segunda forma de decir lo mismo, y
obligaría a tocar el repositorio de sincronización y el contrato de la tablet, que hoy son
coherentes.

### D2 — Los índices únicos van en la base, con `where deleted_at is null`

```sql
create unique index uq_producto_nombre
  on producto (lower(nombre)) where deleted_at is null;

create unique index uq_presentacion_volumen
  on presentacion (producto_id, lower(volumen)) where deleted_at is null;
```

**Por qué en la base y no solo en el servicio:** misma razón que el `check` del código de sucursal
(T-09) y el `unique` del folio (T-14) — las semillas, los scripts de alta y cualquier carga futura
entran **por debajo de la API**. Un producto duplicado no se queda quieto: se propaga a la tablet por
el pull y al inventario, y limpiarlo después es doloroso.

**`lower()`** porque "Jamaica" y "jamaica" son el mismo sabor, y dos filas que solo difieren en
mayúsculas son un duplicado a ojos de cualquier persona.

**`where deleted_at is null`** es la parte que se olvida: sin ella, dar de baja un "500 ml" bloquea
ese volumen para siempre en ese producto, y nunca se podría reactivar el catálogo.

> [!warning] Recrear una presentación da una fila **nueva**, no resucita la vieja
> Una presentación no tiene `activo` (D1), así que quitarla y volver a agregar "500 ml" produce un
> `id` distinto. Hoy es inocuo —`precio` está vacía—, pero cuando **T-18** cuelgue precios de
> `presentacion_id`, los de la fila vieja quedan huérfanos y la nueva nace sin precio. Anotarlo en
> el ticket de T-18; aquí no se resuelve.

La tabla `producto` **no tiene semillas** (se verificó: las semillas de T-05 solo mencionan
`producto.gestionar`, que es un permiso), así que la migración entra sin backfill ni riesgo de
fallar sobre datos existentes.

### D3 — El módulo vive en `modules/inventario/`, no en un `modules/productos/` nuevo

El `CLAUDE.md` fija la convención: los módulos del backend usan **los mismos slugs que el vault**.
`Producto.md` declara `modulo: inventario`, y el stub `inventario.module.ts` ya existe vacío desde
T-02.

Las dos excepciones que hay (`modules/sucursales/` y `modules/sincronizacion/`) lo son porque
atraviesan los 12 módulos de dominio en vez de pertenecer a uno. Producto no: pertenece a
Inventario. Crear un tercer módulo fuera de convención sin esa justificación erosiona la regla.

La ruta HTTP sigue siendo `/productos` — el slug organiza el código, no la URL.

### D4 — Sin filtro por sucursal

`producto` no tiene `sucursal_id`: el catálogo de sabores es **de la empresa**, no de la sucursal.
Lo que varía por sucursal es el **precio**, y eso vive en `precio.sucursal_id` (T-18). T-07 ya lo
dejó escrito en `sincronizacion.repository.ts:154`: *"Los productos no cuelgan de una sucursal: el
catalogo es de la empresa"*.

Es la primera pantalla de catálogo donde **`resolverAlcance()` de T-09 no aplica**, y conviene que
quede dicho: no es un olvido. La pantalla ignora el parámetro `?sucursal=` de la barra lateral.

### D5 — `producto.gestionar` en escritura; listar solo pide sesión

`POST` y `PATCH` exigen `@RequierePermiso('producto.gestionar')`. `GET /productos` se queda solo
detrás de sesión válida.

El permiso **ya está sembrado** desde T-05 (grupo General, *"Registrar/editar/eliminar productos"*),
así que a diferencia de T-08a aquí no hace falta migración de permiso.

Listar no lo exige por la misma razón que en Sucursales (D4 de T-08a): la lista de productos la van a
necesitar Ventas, Inventario y Cartera de Clientes, no solo quien administra el catálogo. El permiso
se llama `gestionar`, no `ver`, y el catálogo de sabores no es información sensible.

### D6 — El `PATCH` recibe la lista completa deseada y el servidor la reconcilia

El formulario manda el estado final que el usuario quiere, no una secuencia de operaciones. El
servicio compara contra lo que hay:

| Fila del payload | Acción |
|---|---|
| **con** `id` | `update` del volumen |
| **sin** `id` | `insert` |
| existente **ausente** del payload | `deleted_at = now()` |

**Por qué así y no endpoints sueltos de presentación:** el formulario es uno solo y guarda una vez
(decisión de UI acordada). Un producto no puede quedar a medias entre dos peticiones — sin
presentaciones no sirve para vender.

**Alternativa descartada:** `POST /productos/:id/presentaciones` y `DELETE
/productos/:id/presentaciones/:pid`. Son más endpoints, más estados intermedios inválidos y un
formulario que tiene que orquestar varias llamadas y deshacerlas si una falla.

### D7 — Todo el guardado va en una transacción

Insertar el producto y sus N presentaciones, o reconciliar la lista del `PATCH`, es atómico.

**Esto es un estreno:** `grep -rn "transaction"` sobre `src/modules/` y `src/database/` no devuelve
nada — el backend nunca ha abierto una transacción. `Kysely<DB>` ya trae `.transaction()`, no hay
dependencia que instalar. Conviene que el patrón quede limpio, porque T-16 (venta) y T-18 (precios)
lo van a copiar.

### D8 — Un producto no puede quedarse sin presentaciones activas

El servicio rechaza con **400** el alta o la edición que dejaría cero presentaciones. El vault es
explícito: un producto tiene *"una o más presentaciones"*, y sin ninguna no se puede vender ni poner
precio.

Esta regla **no se puede expresar en un índice** (es un `count` sobre filas relacionadas), así que
vive en el servicio y se prueba ahí. Queda anotado como la excepción consciente a la doctrina de
"la integridad va en la base".

### D9 — La abstracción del portal: envoltorio por fuera, piezas por dentro

Se construyen las piezas (un hook con el estado, una tabla genérica, la plomería de envío del
formulario) **y además** un envoltorio `<PantallaCatalogo>` que las junta.

Productos, y luego T-11 y T-62, usan el envoltorio y quedan en ~15 líneas. Pero **T-12 Clientes es
notoriamente más rico** (filtros, lista de precios, promoción, crédito) y es probable que no quepa;
cuando pase, baja al hook sin tener que inflar el envoltorio con props que solo usa él ni duplicar
la lógica.

El costo de hacerlo así es casi nulo —son los mismos archivos, separados en vez de uno— y evita la
disyuntiva fea entre inflar la abstracción o abandonarla.

**Lo que NO se abstrae: los campos del formulario.** Sucursal tiene código de 2 letras de solo
lectura; Producto tiene una lista dinámica de presentaciones. Genéricos de verdad son la carga, el
estado, los errores y los botones — no los campos. Inventar un motor de formularios sería peor que
copiar.

### D10 — Sucursales se reescribe encima de la abstracción, en este mismo PR

Hace el diff más grande, y es a propósito: es lo que demuestra que la abstracción sirve. Si
Sucursales no cabe, la abstracción está mal y nos enteramos ahora, con dos casos delante, en vez de
en T-11 con la deuda ya repartida en tres pantallas.

## Diseño

### Base de datos

`supabase/migrations/<timestamp>_producto_unicidad.sql` — los dos índices de D2.

### Backend — `apps/backend/src/modules/inventario/`

```
inventario.module.ts        ← deja de estar vacío
productos.controller.ts
productos.service.ts
productos.repository.ts
dto/crear-producto.dto.ts
dto/editar-producto.dto.ts
```

**Endpoints:**

| Ruta | Guard | Devuelve |
|---|---|---|
| `GET /productos` | sesión | productos con sus presentaciones activas, ordenados por nombre |
| `POST /productos` | `producto.gestionar` | el producto creado |
| `PATCH /productos/:id` | `producto.gestionar` | el producto actualizado |

El `GET` devuelve **productos activos e inactivos**, igual que `SucursalesRepository.listar()`: la
pantalla del catálogo necesita ver un producto desactivado para poder reactivarlo. Quien solo quiera
los activos filtra por su cuenta. Las **presentaciones dadas de baja no vuelven** — su baja es
`deleted_at`, que sí es definitiva (D1).

Desactivar un producto (`activo: false`) **no toca sus presentaciones**: siguen existiendo y bajando
por el pull. Es lo correcto — un sabor que se deja de vender una temporada vuelve con sus mismos
volúmenes, y la tablet ya esconde el producto entero por su propia bandera.

**Forma del payload:**

```jsonc
// POST
{ "nombre": "Jamaica",
  "presentaciones": [{ "volumen": "500 ml" }, { "volumen": "1 Litro" }] }

// PATCH — la lista completa deseada (D6)
{ "nombre": "Jamaica",
  "activo": true,
  "presentaciones": [
    { "id": "uuid-existente", "volumen": "500 ml" },  // se actualiza
    { "volumen": "2 Litros" }                          // se inserta
  ] }                                                  // las ausentes: deleted_at
```

**Mapeo de errores:**

| Situación | Respuesta |
|---|---|
| Nombre o volumen duplicado (`23505`) | **409**, con mensaje que nombra qué está repetido |
| DTO inválido, o `presentaciones` vacío (D8) | **400** |
| `id` desconocido o dado de baja | **404** |
| `id` mal formado | **400** (vía `ParseUUIDPipe`, como en Sucursales) |

`deleted_at` nunca se expone en la respuesta, por la convención de T-09.

### Portal — `apps/portal/src/`

```
components/catalogo/
  use-catalogo.ts          ← items, cargando, error, edición, recargar
  tabla-catalogo.tsx       ← tabla genérica por definición de columnas
  use-envio-formulario.ts  ← enviando / error / traducción de ErrorApi
  pantalla-catalogo.tsx    ← el envoltorio (D9)
components/productos/
  pantalla-productos.tsx   ← columnas + permiso + carga
  formulario-producto.tsx  ← nombre + filas de presentaciones + activo
lib/productos.ts           ← listar / crear / editar
app/(portal)/catalogo/productos/page.tsx
```

Y `components/sucursales/pantalla-sucursales.tsx` reescrito sobre el envoltorio (D10).

El formulario de producto conserva el truco del `key` que T-09 documentó: sin él, React reutiliza la
instancia al pasar de editar A a editar B y los campos se quedan con los valores viejos. Con la lista
dinámica de presentaciones el síntoma sería peor, así que la abstracción lo hereda y lo prueba.

La ruta `/catalogo/productos` ya existe como placeholder en `nav-config.ts` desde T-03; se reemplaza
su contenido.

## Pruebas

Se implementa con **TDD**: prueba que falla, código, verde.

| Capa | Qué se prueba | Conteo |
|---|---|---|
| **pgTAP** (`94_producto_unicidad_test.sql`) | rechaza nombre duplicado · rechaza mismo volumen en un producto · **acepta** el mismo volumen en productos distintos · **acepta** recrear uno dado de baja · trata distinta capitalización como duplicado | 83 → **88** |
| **Unitarias backend** | reconciliación del `PATCH` (actualiza / inserta / da de baja las ausentes) · la regla de ≥1 presentación activa (D8) · el mapeo de `23505` a 409 | 108 → ~120 |
| **e2e** (`productos.e2e-spec.ts`) | CRUD completo · 409 en duplicado · **403 sin `producto.gestionar`** · **200 en el `GET` sin el permiso** (defiende D5) · token de app rechazado | 121 → ~137 |
| **Portal** (nuevo) | `use-catalogo` (carga, error de red, recarga tras guardar) · `tabla-catalogo` (columnas, estado vacío) · `use-envio-formulario` (mensaje de `ErrorApi` vs. fallo de red) | 0 → ~12 |

Las tres pruebas en negrita son las que defienden decisiones: si alguien le pone el candado al `GET`
o quita el `where deleted_at is null`, se caen antes de llegar a `main`.

`portal-ci.yml` pasa de lint + build a lint + build + **test**.

## Riesgos y verificación al cerrar

| Riesgo | Mitigación |
|---|---|
| La migración falla sobre datos existentes en `sinmex dev` | La tabla está vacía en local; **verificar con una consulta** que también lo está en `sinmex dev` antes de `db push`, no asumirlo. |
| La migración no llega a `sinmex dev` | `supabase db push` y confirmar con `supabase migration list`, que el vault marca como la única fuente confiable del estado remoto. |
| Abstraer mal y contaminar cuatro pantallas | D10: reescribir Sucursales encima, en el mismo PR. Si no cabe, la abstracción cambia antes de mergear. |
| Romper Sucursales al reescribirla | Sucursales no tiene pruebas automatizadas (deuda de T-09). **Verificación manual explícita** de alta, edición y desactivación de una sucursal antes de dar por cerrado el ticket. |
| Los criterios de aceptación del issue quedan sin cumplir | Comentar el issue #10 con el desglose a T-18/T-16 al abrir el PR. |

Al cerrar: lint + build + test + test:e2e en backend y portal, verificación manual de Sucursales, y
actualizar en el vault `Estado del proyecto.md` y `Producto.md`, más la bitácora del día.

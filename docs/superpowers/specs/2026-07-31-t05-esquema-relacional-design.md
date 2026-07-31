# T-05 · Esquema relacional base — Diseño

- **Fecha:** 2026-07-31
- **Issue:** T-05 (proyecto-sinmex)
- **Depende de:** T-01 (Supabase provisionado)
- **Fuente de dominio:** vault `jawa-obsidian-memory` (actualizado con el documento del cliente de julio 2026) — notas `Modelo de datos`, entidades, `Lista de precios`, `Perfil`, `Folios`.

## Objetivo

Crear el **esquema relacional base** en PostgreSQL (Supabase) con historización por fecha y baja lógica, como cimiento de identidad, catálogos, precios, ventas, cobranza y rutas. Es solo el **esquema + migraciones**; la lógica de negocio y las pantallas viven en sus propios tickets (T-08, T-13, T-18, etc.).

## Alcance

**Incluye:** las tablas núcleo y sus relaciones, la historización de precios, el modelo RBAC (tablas), y la baja lógica. Semillas mínimas de catálogos.

**No incluye** (cada uno en su ticket): eventos GPS de visita (T-41), kilometraje por jornada (T-38), inventario detallado / cambios físicos (T-27/T-35), almacenes general/sucursal (T-63), mantenimientos de vehículo (T-64), tesorería/flujo de efectivo (T-28+), y toda la lógica/UI.

## Enfoque técnico

- **Migraciones SQL a mano** con la CLI de Supabase (ya enlazada en T-01), en `supabase/migrations/`. Sin ORM por ahora (esa decisión se tomará cuando el backend lea datos, T-06+).
- **Convenciones comunes a toda tabla:**
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — permite generación offline en la tablet sin colisiones (requisito de sincronización).
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - `updated_at timestamptz NOT NULL DEFAULT now()` — clave para resolución de conflictos en la sincronización (T-07/T-43).
  - `deleted_at timestamptz NULL` — **baja lógica** (null = activo), conserva histórico.
- **Tipos:** dinero `numeric(12,2)`; fechas de negocio `date`; marcas de tiempo `timestamptz`; enums como `text` con `CHECK` (evita el costo de migrar tipos `enum` de Postgres mientras el dominio se estabiliza).

## Esquema

> Todas las tablas llevan además las 4 columnas comunes (`id`, `created_at`, `updated_at`, `deleted_at`). Abajo solo se listan las columnas propias.

### Identidad y permisos (RBAC)

**`sucursal`**
| Columna | Tipo | Notas |
|---|---|---|
| codigo | text unique | 2 letras (TJ, MX) |
| nombre | text | |
| activa | boolean not null default true | |

**`perfil`**
| Columna | Tipo | Notas |
|---|---|---|
| nombre | text unique | ej. "Jefe de Ventas" |

**`permiso`**
| Columna | Tipo | Notas |
|---|---|---|
| clave | text unique | ej. `venta.registrar` |
| grupo | text | General / Operación / Producción / Información |
| descripcion | text | |

**`perfil_permiso`** (M:N) — `perfil_id → perfil`, `permiso_id → permiso`, unique(perfil_id, permiso_id).

**`usuario`** (staff del portal)
| Columna | Tipo | Notas |
|---|---|---|
| login | text unique | |
| password_hash | text | el hash lo produce T-06 |
| nombre | text | |
| perfil_id | uuid → perfil | |
| sucursal_id | uuid → sucursal **null** | null = "General" (todas) |

**`usuario_permiso`** (override por excepción) — `usuario_id → usuario`, `permiso_id → permiso`, `habilitado boolean`, unique(usuario_id, permiso_id).

**`vendedor`** (personal de campo, solo app)
| Columna | Tipo | Notas |
|---|---|---|
| login | text unique | |
| password_hash | text | |
| nombre | text | sus iniciales van en el folio |
| sucursal_id | uuid → sucursal | |
| activo | boolean not null default true | |

### Catálogos

**`producto`** — `nombre text`, `activo boolean`.
**`presentacion`** — `producto_id → producto`, `volumen text` (ej. "500 ml"). Un producto tiene N presentaciones.
**`vehiculo`** — `nombre text`, `km_inicial numeric`, `sucursal_id → sucursal`, `activo boolean`.
**`tipo_negocio`** — `nombre text unique`.

### Precios (historizados)

**`lista_precio`** — `nombre text unique` (Lista 1–4, Especial).

**`precio`** (precio de una presentación en una lista y sucursal, con vigencia)
| Columna | Tipo | Notas |
|---|---|---|
| presentacion_id | uuid → presentacion | |
| lista_precio_id | uuid → lista_precio | |
| sucursal_id | uuid → sucursal | |
| precio | numeric(12,2) | |
| vigente_desde | date | aplica de esta fecha en adelante |

Índice `(presentacion_id, lista_precio_id, sucursal_id, vigente_desde)`. El precio vigente = fila con `vigente_desde` máximo ≤ fecha objetivo. Nunca se sobreescribe (un cambio inserta fila nueva).

**`cliente_precio`** (override especial por cliente) — `cliente_id → cliente`, `presentacion_id → presentacion`, `precio numeric(12,2)`, `vigente_desde date`.

### Clientes

**`cliente`**
| Columna | Tipo | Notas |
|---|---|---|
| nombre | text | búsqueda incremental |
| domicilio | text | |
| telefono | text | |
| encargado | text null | |
| factura | boolean | ¿requiere factura? |
| tipo | text check (cliente/prospecto) | |
| tipo_negocio_id | uuid → tipo_negocio null | |
| lista_precio_id | uuid → lista_precio | lista asignada |
| pct_comision | numeric(5,2) null | número puro |
| promocion | text check (ninguna/10+1/20+1) default 'ninguna' | |
| plazo_credito_dias | integer null | |
| lat | numeric(9,6) null | |
| lng | numeric(9,6) null | |
| comentarios | text null | |
| sucursal_id | uuid → sucursal | |

**`cliente_promocion_producto`** (a qué productos Jawa aplica la promo) — `cliente_id → cliente`, `producto_id → producto`, unique(cliente_id, producto_id).

### Transaccional

**`venta_nota`** (cabecera)
| Columna | Tipo | Notas |
|---|---|---|
| folio | text unique | `sucursal+AA+MM+DD+vendedor+op` (T-14) |
| fecha | date | |
| cliente_id | uuid → cliente | |
| vendedor_id | uuid → vendedor | repartidor |
| monto_total | numeric(12,2) | Σ líneas; promo no suma |
| num_nota | text | nota física |
| contado_credito | text check (contado/credito) | |
| factura | text null | N/A → pendiente → número |
| semana | integer | derivado de fecha |
| mes | integer | derivado de fecha |
| status | text check (pagada/pendiente/abonado/cuenta_perdida/promocion) | |
| sucursal_id | uuid → sucursal | |

**`venta_nota_detalle`** (partidas)
| Columna | Tipo | Notas |
|---|---|---|
| venta_nota_id | uuid → venta_nota | |
| presentacion_id | uuid → presentacion | |
| cantidad | integer | piezas vendidas |
| precio | numeric(12,2) | precio resuelto al momento |
| cantidad_promocion | integer default 0 | piezas de regalo (no suman al importe) |

**`cobranza_abono`**
| Columna | Tipo | Notas |
|---|---|---|
| venta_nota_id | uuid → venta_nota | |
| fecha_pago | date | |
| vendedor_id | uuid → vendedor | cobrador |
| monto | numeric(12,2) | |
| tipo | text check (cobranza/abono) | |
| saldo_pendiente | numeric(12,2) | |
| metodo_pago | text check (efectivo/transferencia/cheque) | |

### Rutas (solo asignación núcleo)

**`ruta`** — `cliente_id → cliente`, `vendedor_id → vendedor`, `fecha date`, `orden integer`, `tipo text check (diaria/semanal)`. Los eventos de visita (GPS, motivo de no-surtido) van en T-39/T-41.

## Mecanismos clave

1. **Precio de una venta:** al capturar una línea, el precio efectivo = `cliente_precio` vigente si existe; si no, `precio(presentacion, lista_del_cliente, sucursal)` con `vigente_desde` máximo ≤ `venta.fecha`. Se **guarda** el precio resuelto en `venta_nota_detalle.precio` (la venta no cambia si luego cambia el precio).
2. **Baja lógica:** ningún `DELETE` físico en entidades con histórico; se setea `deleted_at`. Las consultas activas filtran `deleted_at IS NULL`.
3. **RBAC:** permisos efectivos de un usuario = permisos de su `perfil` (via `perfil_permiso`), ajustados por `usuario_permiso` (override habilitado/deshabilitado).

## Migraciones (orden propuesto)

1. `..._extensiones_y_convenciones.sql` — `pgcrypto`/`gen_random_uuid` disponible; función `trigger` para `updated_at` (opcional).
2. `..._identidad_y_permisos.sql` — sucursal, perfil, permiso, perfil_permiso, usuario, usuario_permiso, vendedor.
3. `..._catalogos.sql` — producto, presentacion, vehiculo, tipo_negocio.
4. `..._precios.sql` — lista_precio, precio.
5. `..._clientes.sql` — cliente, cliente_precio, cliente_promocion_producto. (`cliente_precio` va aquí porque referencia `cliente`.)
6. `..._transaccional.sql` — venta_nota, venta_nota_detalle, cobranza_abono, ruta.
7. `..._semillas.sql` — sucursales TJ/MX, listas (1–4 + Especial), 6 perfiles semilla, catálogo de permisos.

## Verificación

- `supabase db reset` (o aplicar migraciones) corre sin error contra una BD limpia.
- Comprobar creación de tablas y FKs (p. ej. `supabase migration list` / inspección del esquema).
- Prueba de humo del mecanismo de precios: insertar 2 filas de `precio` con distinto `vigente_desde` y verificar que la consulta "precio vigente a una fecha" devuelve la correcta.
- Prueba de baja lógica: `deleted_at` filtra sin borrar histórico.

## Decisiones tomadas

- `venta_nota_detalle` referencia `presentacion` (no `producto`): el precio y la venta son por volumen.
- `usuario.sucursal_id` nullable = "General".
- Enums como `text + CHECK` en vez de tipos `enum` de Postgres, por flexibilidad mientras el dominio se estabiliza.
- La semilla vive en su propia migración (idempotente donde se pueda).

## Pendientes con el cliente (no bloquean T-05)

- Si "Especial" es una lista más o el override manual; si el nº de listas es fijo.
- Desambiguación de iniciales de vendedor repetidas en el folio.
- Detalle de almacenes (T-63) y del inventario validado (T-27).

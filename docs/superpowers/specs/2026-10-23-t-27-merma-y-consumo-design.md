# T-27 pieza 2 · Merma y consumo en la tablet — diseño

**Ticket:** #27 (T-27, inventario del repartidor) · **Pieza 2 de 3** (acordado con Mario el 2026-10-23) · **Depende
de:** pieza 1 (cargas, existencia en la tablet, PR #142)

## Objetivo

Que la tablet registre las piezas que salen o entran a la camioneta por razones distintas a la venta, para que el
inventario del vendedor cuadre: la **merma del cliente** (producto dañado que el cliente devuelve, y lo que el vendedor
le repone), la **merma del trayecto** (lo que se le rompe o se le echa a perder al vendedor durante el día) y el
**consumo propio**. Con eso la tablet sabe en vivo cuántas piezas buenas y cuánta merma deben regresar a la planta.

**Las tres piezas de T-27:** 1 carga y recarga (hecha, #142) · **2 merma y consumo (este spec)** · 3 corte de
inventario: lo teórico contra el retorno validado que captura el almacenista (tabla `retorno` de Roberto, PR #149) y la
merma retornada.

**Fuera de esta pieza:** cambios físicos (producto bueno por otro sabor) y "merma de almacén" de la fuente de julio
2026 — Mario los dejó fuera el 2026-10-23; se agregarían como otro `tipo` sin rehacer nada. La consulta de movimientos y
el corte en el portal son la pieza 3. La captura de merma/promoción desde el portal es T-35.

## Decisiones de producto

**D1 · Dos tipos de merma.** Elegido por Mario. *Merma del cliente*: el cliente devuelve producto dañado y el vendedor
puede reponérselo. *Merma del trayecto*: al vendedor se le rompe o se le echa a perder producto durante el día. Las dos
tienen que regresar a la planta como merma.

**D2 · La merma del cliente se captura en la ficha del cliente, en una pantalla que se llama "Merma".** Elegido por
Mario. Dos columnas por presentación: **"Recibí dañado"** (al menos una pieza) y **"Le entregué"** (la reposición,
opcional, de cualquier sabor y tamaño). Un comentario opcional.

**D3 · La merma del trayecto y el consumo propio se capturan desde el menú, en "Merma y consumo".** *(agente, sobre la
decisión de Mario de separar las mermas)* No tienen cliente.

**D4 · El consumo propio tiene un límite diario configurable por sucursal.** Elegido por Mario. Columna
`sucursal.consumo_diario_max` (entero ≥ 0, por defecto **1**), editable en *Catálogo › Sucursales*. La tablet no deja
registrar más consumo en el día que el límite.

**D5 · Con el control de inventario prendido, lo que saca piezas buenas respeta la existencia.** Elegido por Mario. La
reposición al cliente, la merma del trayecto y el consumo no se graban si dejan una presentación en negativo, ni con una
carga pendiente — mismo criterio que la venta (pieza 1, D3/D4). Con el control apagado se registran sin bloquear.

**D6 · Un movimiento grabado no se edita ni se borra en la app.** *(agente)* Igual que un gasto o una visita; la
corrección será de la oficina (T-35).

**D7 · Una sola operación `movimiento` con `tipo`.** Elegido por Mario (opción A). Una fuente en la tablet, una
proyección y una tabla en el servidor; la pieza 3 lee todo de un lugar.

## Las cuentas

Por presentación, en la tablet (día de la jornada):

- **Existencia para vender** = Cargado (aceptado) − Vendido − Regalado − Merma entregada al cliente − Merma del
  trayecto − Consumo.
- **Por regresar a la planta:** piezas buenas = la existencia; **merma** = merma recibida del cliente + merma del
  trayecto.

La merma recibida del cliente **no** suma a la existencia (está dañada, no se vende).

## Servidor

### Migración `supabase/migrations/20261025120000_movimiento_inventario.sql`

```sql
alter table sucursal add column consumo_diario_max smallint not null default 1
  check (consumo_diario_max >= 0 and consumo_diario_max <= 99);

create table movimiento_inventario (
  id uuid primary key,                       -- = clave de la operación (como visita y gasto)
  sucursal_id uuid not null references sucursal(id),
  vendedor_id uuid not null references vendedor(id),
  cliente_id uuid references cliente(id),
  tipo text not null check (tipo in ('merma_cliente', 'merma_trayecto', 'consumo')),
  fecha date not null,                        -- fecha_operacion del sobre, nunca re-derivada
  comentario text check (comentario is null or char_length(comentario) between 1 and 300),
  registrado_en timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ck_movimiento_cliente check ((tipo = 'merma_cliente') = (cliente_id is not null))
);
create index idx_movimiento_vendedor_fecha on movimiento_inventario (vendedor_id, fecha) where deleted_at is null;

create table movimiento_inventario_linea (
  id uuid primary key default gen_random_uuid(),
  movimiento_id uuid not null references movimiento_inventario(id),
  presentacion_id uuid not null references presentacion(id),
  sentido text not null check (sentido in ('recibido', 'entregado')),
  piezas integer not null check (piezas > 0),
  constraint uq_movimiento_linea unique (movimiento_id, presentacion_id, sentido)
);
```

Trigger `set_updated_at()` en `movimiento_inventario`. pgTAP `99_movimiento_inventario_test.sql`. Sin RLS.

### Operación `movimiento` en el push (aditiva, `CONTRATO_ACTUAL` sigue en 1)

- `TIPOS_OPERACION` gana `'movimiento'`. La clave **es** `movimiento_inventario.id` (uuid). `cliente_id` va en el
  sobre solo para `merma_cliente`. Sin folio.
- `datos`: `{ tipo, comentario?: string | null, registrado_en, lineas: [{ presentacion_id, sentido, piezas }] }`.
- **Forma** (`sincronizacion/despacho-movimiento.ts`, todo `datos-invalidos` con el campo al inicio del motivo):
  - `merma_cliente`: `cliente_id` obligatorio; al menos una línea `recibido`; `entregado` opcional.
  - `merma_trayecto` y `consumo`: sin `cliente_id`; solo líneas `entregado` (sale de la camioneta), al menos una.
  - Piezas enteras 1–99 999; presentaciones uuid sin repetir por sentido; comentario recortado ≤ 300.
- **Proyección** (`modules/inventario/movimientos.service.ts`), en la transacción de la operación (ADR-0009): inserta
  con `id` = clave; `sucursal_id` = la del vendedor del token; `fecha` = `fecha_operacion`.
- **Rechazos:** `cliente-inexistente` / `cliente-fuera-de-alcance` (los de siempre, alcance una vez por lote),
  `datos-invalidos` (presentación inexistente incluida) y nuevo **`movimiento-id-ocupado`** (motivo neutro).
- **El servidor no revisa** el límite de consumo ni la existencia: las piezas ya salieron; lo exige la tablet (como
  "exige foto" en la visita o "se usa en la app" en el gasto).
- **Orden del push:** `jornadas → prospectos → ventas → cobranzas → visitas → gastos → movimientos → rutas`
  (`fuentesDelPush`, con prueba). Un movimiento a un prospecto cuya alta viaja en el mismo lote cae
  `cliente-fuera-de-alcance` como la visita; la tablet lo sube en el lote siguiente.
- `VendedorPull.consumo_diario_max: number` (de su sucursal). Cambiar el límite toca `vendedor.updated_at` de esa
  sucursal (mismo mecanismo que `control_inventario`).
- `contrato.ts` se actualiza en backend y tablet a la vez, y `docs/contrato-sincronizacion.md` en el mismo commit.

## Portal

- *Catálogo › Sucursales*: campo **"Consumo propio máximo por día"** (entero 0–99, por defecto 1), con ayuda "Piezas que
  cada vendedor puede registrar como consumo propio en un día."
- Nada más en esta pieza.

## Tablet

### Datos (migración local 018)

`movimiento` (`id`, `vendedor_id`, `cliente_id`, `tipo`, `fecha`, `comentario`, `registrado_en`, `sync_estado` y lo que
usan las demás operaciones de la cola) y `movimiento_linea` (`movimiento_id`, `presentacion_id`, `sentido`, `piezas`);
`vendedor.consumo_diario_max integer not null default 1`. Nunca se edita una migración publicada (001–017).

### Lógica pura (con pruebas)

- Las reglas de existencia de la pieza 1 (`src/datos/inventario-reglas.ts`) incorporan los movimientos: `existencias`
  resta merma entregada al cliente, merma del trayecto y consumo, y devuelve además `mermaPorRegresar` por presentación.
- `validarMovimiento(entrada)` → errores de forma (los mismos de arriba).
- `consumoRestante({ limite, consumoDeHoy })`.
- `faltantesDeMovimiento({ controlInventario, existencias, lineasQueSalen })` — mismo criterio que `faltantesDeVenta`.

### Repositorio

`movimientos.registrar()` valida forma, límite de consumo, bloqueo por carga pendiente y faltantes **dentro de su
transacción**, guarda movimiento y líneas, encola la operación y publica el cambio de catálogo (para que Inventario
relea). Error → `ErrorMovimiento` con el detalle; nada queda escrito.

### Pantallas

- **Ficha del cliente → "Merma"** (`operacion/[clienteId]/merma.tsx`; el botón deja de ser "pendiente"): lista de
  presentaciones con dos campos "Recibí dañado" / "Le entregué", "Te quedan N" en "Le entregué" con el control
  prendido, comentario, "Registrar merma". Guardia de doble toque.
- **Menú → "Merma y consumo"** (la entrada deja de ser pendiente): dos botones, "Merma del trayecto" y "Consumo
  propio"; cada uno abre una captura por presentación (solo piezas que salen). Consumo muestra "Te quedan N de consumo
  hoy" y no deja pasar el límite. Debajo, la lista de los movimientos de hoy con su estado de subida.
- **Inventario** (pieza 1) gana columnas: Merma entregada, Merma del trayecto, Consumo; y el bloque **"Por regresar a la
  planta"**: piezas buenas y merma por presentación.
- **Ficha del cliente → "Movimientos de hoy"**: la merma registrada con ese cliente, con su estado de subida.
- Con la jornada cerrada no se registra (como venta y gasto). Nunca se re-renderiza una pantalla a mitad de un gesto.

## Review Focus

1. **Consumo al límite:** con límite 1 y 1 ya registrada, el siguiente consumo no se graba ("Ya registraste tu consumo
   de hoy"); con límite 0 no se ofrece.
2. **Reposición que deja negativo con el control prendido:** no se graba y dice la presentación y cuántas faltan; con el
   control apagado sí se graba.
3. **Merma del cliente solo con "Le entregué":** no se graba (falta lo recibido).
4. **Movimiento a un prospecto recién capturado** en la misma sincronización: no se pierde; sube en el lote siguiente.
5. **Cambio del límite en el portal:** baja a la tablet en el siguiente pull aunque el vendedor no haya cambiado.

## Pruebas

- **pgTAP:** tablas, checks (`ck_movimiento_cliente`, sentido, piezas), columna de sucursal.
- **Backend unit:** `despacho-movimiento` (forma por tipo), proyección.
- **Backend e2e:** push de los tres tipos, cliente fuera de alcance, id ocupado, duplicada, `consumo_diario_max` en el
  pull y su propagación al cambiar la sucursal.
- **Tablet:** reglas puras (existencias con movimientos, merma por regresar, consumo restante, faltantes), migración 018,
  `movimientos.registrar` (transacción, límite, bloqueo, faltantes, nada escrito al fallar), fuente del push y su orden.
- **Portal:** campo de la sucursal.
- **Emulador (al final):** merma del cliente con reposición → existencia y merma por regresar; merma del trayecto;
  consumo hasta el límite; bloqueo con el control prendido; sincronizar y ver las filas en Postgres.

## Para el despliegue

- Migración `20261025120000_movimiento_inventario.sql` a `sinmex dev` después del merge, con el protocolo de push
  (pre-flight: tablas nuevas y una columna con default; nada que contar).
- Backend antes que la app. Una app vieja no manda movimientos.

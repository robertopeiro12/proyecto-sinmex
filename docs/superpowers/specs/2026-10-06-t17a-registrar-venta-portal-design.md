# T-17 (parte 1) · Registrar venta desde el Portal — Diseño

**Issue:** [#17](https://github.com/robertopeiro12/proyecto-sinmex/issues/17) (parte 1 de 2) + [#95](https://github.com/robertopeiro12/proyecto-sinmex/issues/95) (unicidad del # de nota)
**Fecha:** 2026-10-06 · **Estado:** propuesto, pendiente de revisión de Roberto
**Parte 2 (fuera de este diseño):** buscar por Fecha/Cliente/# Nota, modificar y eliminar.

## 1. Para qué

La oficina registra ventas desde el Portal por dos motivos, según el cliente (tío de Roberto, 2026-10-06):

1. **Al vendedor le falló la tablet.** La oficina la captura "como si fuera el vendedor": la venta queda a su nombre, con su comisión.
2. **Venta de mostrador** (lo más común). Alguien llega a la oficina y compra. No hay vendedor. Si el comprador es esporádico (eventos), se usa el cliente **"Clientes Varios"**, que ya existe para eso.

Criterios del issue #17 que cubre esta parte:

- Registrar con los mismos campos que la app. La fecha admite días pasados.
- Bug v2.0: el monto en $ de una venta del portal debe sumar como cualquier otra. Aquí se cierra por construcción, porque el portal usa el mismo `VentasService.registrarVenta` que la tablet y el monto se calcula en un solo lugar (§4).

## 2. Decisiones de producto (Roberto, 2026-10-06)

| Tema | Decisión |
|---|---|
| Repartidor | Se elige de la lista de vendedores **activos** de la sucursal, **o "Oficina"** (venta de mostrador) |
| Venta de mostrador | **Sin vendedor**: no genera comisión y en reportes sale como "Oficina" |
| Comprador de paso | El cliente "Clientes Varios" (uno por sucursal, se da de alta en el Portal como cualquier cliente). No se programa nada especial |
| Folio | Con marca de oficina: `TJ261006OF01`. Lo confirmó el cliente (opción A) |
| Nota de papel | "A veces" existe. Lo obligatorio es el **# de nota**; el folio OF se muestra al grabar por si lo quieren anotar |
| Precio | El de la **lista del cliente** (con su precio especial), **vigente en la fecha de la venta**. No se teclea |
| # de nota | **No se repite dentro de la sucursal** (cierra #95) |
| Venta de contado | Se cobra sola, como en la tablet. Método por default **transferencia**, con opción **efectivo** |
| Factura | Solo `N/A` o `pendiente`. Asignar el número es T-19 |
| Status | Se calcula como en la tablet: contado → pagada; crédito → pendiente; monto $0 → promoción |

## 3. Pantalla

Ruta nueva **`/operacion/registrar-venta`**, entrada **"Registrar venta"** en la sección Operación de `nav-config.ts`.

1. **Fecha.** Hoy por default (zona horaria de Tijuana). Admite días pasados; una fecha futura se rechaza.
2. **Cliente.** Búsqueda incremental por nombre entre los clientes del alcance del usuario (filtro "Por sucursal", `resolverAlcance`). Clientes y prospectos, igual que en la tablet: el código de la tablet no prohíbe venderle a un prospecto. En la práctica, uno sin lista de precios no tendrá productos con precio.
3. **Repartidor.** Los vendedores activos de la sucursal del cliente, más **"Oficina"** al final.
4. **Productos.** Al elegir cliente y fecha se cargan sus presentaciones **con el precio de esa fecha**. Se captura cantidad y piezas de promoción por línea. Una presentación sin precio a esa fecha aparece deshabilitada con el texto "sin precio en la lista". El total se recalcula en vivo.
5. **# de nota** (obligatorio, hasta 30 caracteres), **contado/crédito**, **método de pago** (solo si es contado: transferencia/efectivo), **factura** (N/A/pendiente), **comentarios** (hasta 500).
6. **Grabar.** Al terminar se muestra la venta creada: folio, monto, status. Hay un botón "Registrar otra".
7. Los errores del servidor se muestran con su mensaje, por ejemplo "Ya existe la nota 1234 en esta sucursal".

El botón solo aparece si el usuario tiene el permiso `venta.registrar`, siguiendo el patrón con que el portal ya oculta acciones según `/auth/me`.

## 4. Backend

### 4.1 Endpoints nuevos (módulo `ventas-cobranza`, primer controller del módulo)

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| `GET` | `/ventas/catalogo?clienteId=&fecha=` | sesión | Presentaciones del cliente con su precio vigente **a esa fecha** (`presentacionesConPrecio(..., { vigenteHastaHoy: false })`), incluidas las que no tienen precio (marcadas) |
| `GET` | `/ventas/repartidores?sucursalId=` | sesión | Vendedores activos de la sucursal (id, nombre). "Oficina" lo agrega la pantalla, no el servidor |
| `POST` | `/ventas` | `venta.registrar` | Registra la venta y devuelve su detalle (id, folio, monto, status) |

Las dos lecturas validan el alcance de sucursal igual que los catálogos (403 si la sucursal es ajena).

### 4.2 `POST /ventas`

DTO: `fecha`, `clienteId`, `vendedorId` (uuid **o `null` = Oficina**), `numNota`, `contadoCredito`, `metodoPago` (`transferencia` | `efectivo`, solo contado; default transferencia), `factura`, `comentarios?`, `lineas[]` `{ presentacionId, cantidad, cantidadPromocion }`. **El cliente no manda precios.**

Flujo, todo en **una transacción**:

1. Cargar el cliente. Debe estar no borrado y dentro del alcance del usuario (sin restringir el `tipo`, como la tablet). Su sucursal es la de la venta.
2. Si `vendedorId` no es null: debe ser un vendedor activo de esa misma sucursal.
3. `fecha` ≤ hoy (Tijuana).
4. Resolver precios a la fecha y armar las líneas con `precioCentavos` del servidor. Una línea con cantidad > 0 y sin precio se rechaza con `precio-no-asignado`. Las mismas reglas de forma que la tablet (1–50 líneas, sin presentación repetida, enteros) se reutilizan de `datos-venta.ts`.
5. Emitir el folio de oficina (§4.4).
6. Llamar a `VentasService.registrarVenta(venta, contexto, trx)` con `contexto = { sucursalId, fechaOperacion: fecha, vendedorId (o null), folio, usuarioId, origen: 'portal', metodoPagoContado }`.
7. Traducir errores: `VentaRechazada` → 409 con su motivo. Un 23505 de `uq_venta_nota_num_nota_sucursal` → 409 "Ya existe la nota X en esta sucursal".

### 4.3 Cambios en `VentasService.registrarVenta` (compartido con la tablet)

- `ContextoVenta.vendedorId` pasa a `string | null`, y se agregan `origen: 'app' | 'portal'` y `metodoPagoContado: 'efectivo' | 'transferencia'`. La tablet manda `origen: 'app'` y `efectivo`, así que su comportamiento no cambia.
- Se quita el `throw` de "folio null". Ahora siempre llega un folio: el de la tablet o el de oficina.
- Precio: con `origen: 'app'` sigue el modo actual (existencia hasta hoy, el valor lo pone la nota firmada). Con `'portal'` los precios ya vienen resueltos por el servidor a la fecha.
- Se guardan `origen` y `capturo_usuario_id` en `venta_nota`.
- La cobranza de contado usa `metodoPagoContado`, y su `vendedor_id` (cobrador) es el de la venta, que puede ser null en una venta de Oficina.

### 4.4 Folio de oficina

Formato ADR-0001 con el segmento de vendedor reservado **`OF`**: `{sucursal}{AAMMDD de la fecha de la venta}OF{01..99}`.

- Lo emite el **servidor**. Hay una tabla nueva `folio_oficina_contador (sucursal_id, fecha, ultimo)` con PK `(sucursal_id, fecha)`. Se hace un `insert … on conflict do update set ultimo = ultimo + 1 returning ultimo` **dentro de la transacción de la venta**: si la venta falla, el número no se quema, y dos usuarios grabando a la vez no pueden obtener el mismo.
- Pasado de 99 en un día y sucursal → 409 "Se alcanzó el máximo de 99 ventas de oficina para ese día". Holgado para el volumen descrito.
- La fecha del folio es la **de la venta**, no la de captura. Una venta de la semana pasada lleva la fecha de la semana pasada, con su propio contador.
- **Ningún vendedor puede tener el segmento `OF`**:
  - check en `vendedor.folio_segmento <> 'OF'`;
  - en `VendedoresService.crear()`, si el primer candidato es `OF` se **rechaza** con "Esas iniciales están reservadas para ventas de oficina; ajusta el nombre". Es la misma regla de "rechazar, no ceder" de ADR-0007.

Esto **enmienda** ADR-0001/0007, que solo contemplaban folios emitidos por la tablet, y reconcilia ADR-0009 §2.2 ("desde el portal el folio lo emite el servidor"). Se registra como **ADR-0010** en el vault.

### 4.5 # de nota único por sucursal (#95)

- Índice único `uq_venta_nota_num_nota_sucursal` sobre `(sucursal_id, lower(btrim(num_nota))) where deleted_at is null`. Es parcial para que, en la parte 2, una nota eliminada libere su número.
- **Tablet:** un `push` de venta con # de nota repetido se rechaza **por operación** con el código nuevo `num-nota-duplicada` (motivo legible). Se agrega en los dos `contrato.ts` y en `docs/contrato-sincronizacion.md`, en el **mismo commit**. La tablet muestra el motivo como cualquier rechazo. Una tablet vieja que no conozca el código ve el motivo igual.
- **Ojo:** en la tablet, un reenvío legítimo con la **misma clave** sigue siendo `duplicada` (idempotencia), no este rechazo. Al desempatar un 23505 se mira primero la clave, igual que con el folio (CLAUDE.md, T-14).

## 5. Base de datos (una migración)

| Cambio | Nota |
|---|---|
| `venta_nota.vendedor_id` → nullable | Hoy nada lo lee |
| `venta_nota.origen text not null default 'app'` con check `in ('app','portal')` | El default rellena las filas existentes |
| `venta_nota.capturo_usuario_id uuid null references usuario(id)` | Quién la capturó en el portal |
| Check: `origen = 'app'` ⇒ `vendedor_id is not null` y `capturo_usuario_id is null`; `origen = 'portal'` ⇒ `capturo_usuario_id is not null` | La venta sin vendedor solo existe si nació en el portal |
| `cobranza_abono.vendedor_id` → nullable | Cobro de una venta de Oficina |
| `folio_oficina_contador` | §4.4 |
| check `vendedor.folio_segmento <> 'OF'` | §4.4 |
| `uq_venta_nota_num_nota_sucursal` | §4.5 |

**Pre-flight en `sinmex dev` antes de empujar** (protocolo de CLAUDE.md), solo `select`:

- vendedores con `folio_segmento = 'OF'`;
- pares `(sucursal_id, lower(btrim(num_nota)))` repetidos en `venta_nota` viva.

Los dos deben dar 0. Los checks de `origen` son vacuos por el default.

## 6. Lo que NO entra

- Buscar, modificar y eliminar ventas: **parte 2**. Ahí aplica la regla ya decidida: no se edita ni elimina una venta con abonos (salvo su cobro de contado); eso es T-34.
- Asignar número de factura (T-19), motor de status completo (T-19), cobranza desde el portal sobre notas existentes (T-21).
- Reportes. "Resultados por día", donde el cliente vio el bug, todavía no existe. El criterio queda cubierto porque `monto_total` se calcula igual para los dos orígenes, con una prueba que lo afirma.

## 7. Pruebas

- **pgTAP:**
  - check de `origen`/vendedor/capturó;
  - unicidad del # de nota por sucursal: insensible a mayúsculas y espacios; libre en otra sucursal; libre si la nota está borrada;
  - `OF` prohibido como segmento;
  - el contador de folio.
- **Unit:**
  - formato del folio de oficina;
  - rechazo de iniciales `OF` en el alta de vendedor;
  - armado de líneas con precio del servidor.
- **e2e (`ventas.e2e-spec.ts`):**
  - alta con vendedor y alta de Oficina (sin vendedor);
  - **`monto_total` = Σ cantidad × precio de la lista a esa fecha** (el criterio del bug);
  - fecha pasada usa el precio de entonces;
  - fecha futura → 400; sin precio → rechazo; sin permiso → 403;
  - cliente de otra sucursal → 403;
  - vendedor de otra sucursal → rechazo; vendedor inactivo → rechazo;
  - contado deja su cobro con método transferencia (y efectivo si se elige);
  - # de nota repetido → 409, y libre en otra sucursal;
  - folios consecutivos OF01, OF02 por día y sucursal, y dos grabaciones simultáneas no repiten número.
- **e2e de sincronización:** una venta de tablet con # de nota repetido → `num-nota-duplicada`; el reenvío con la misma clave sigue siendo `duplicada`.
- **Portal (vitest):**
  - la pantalla arma el payload sin precios;
  - "Oficina" manda `vendedorId: null`;
  - presentación sin precio deshabilitada;
  - muestra el mensaje del servidor.
- **Verificación manual** en el navegador contra el Postgres local.

## 8. Riesgos y notas

- **Tablet de prueba de Mario:** la regla del # de nota único también aplica a sus ventas. Si su tablet tiene ventas pendientes con # repetido, se rechazarán con un motivo claro. Se le avisa en el PR.
- **Precio en ventas pasadas:** si el cliente no tenía lista asignada en esa fecha, la venta no se puede registrar ("sin precio en la lista"). Es lo correcto según el vault ("una venta pasada mantiene el precio que tenía entonces"). Si estorba en la práctica, se revisa.
- **ADR-0010** en el vault: folio de oficina `OF` emitido por el servidor y venta de mostrador sin vendedor.

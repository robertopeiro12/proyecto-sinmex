# T-17 (parte 2) · Buscar, editar y eliminar ventas desde el Portal — Diseño

**Issue:** [#17](https://github.com/robertopeiro12/proyecto-sinmex/issues/17) (parte 2 de 2; la parte 1 se mergeó en #108)
**Fecha:** 2026-10-06 · **Estado:** propuesto, pendiente de revisión de Roberto
**Base:** spec de la parte 1, `docs/superpowers/specs/2026-10-06-t17a-registrar-venta-portal-design.md`, y ADR-0011 en el vault.

## 1. Para qué

Criterio del issue #17 que falta: "Modificar y eliminar buscando por Fecha/Cliente/# Nota". Fuente (`Sistema Jawa (fuente).md`, Registro de Operaciones):

> Modificar: se debe tener la opción de búsqueda por Fecha, por Cliente o # Nota. Una vez seleccionando la venta, arrojar la información de la venta y que se le modifique el campo que se necesite… Si se graba, que se actualice la información.
> Eliminar: búsqueda por Fecha, por Cliente o # Nota. Una vez seleccionando la venta: Botón de Eliminar, Cancelar y Salir.

El vault (`Venta-Nota.md`) agrega: "Una venta grabada en la tablet **no se edita ni se anula**: se corrige desde el portal (T-17)". Esta pantalla es la vía de corrección **para todas las ventas**, de tablet y de portal.

Status "cuenta perdida" (fuente): "solo se utilizará cuando se modifique una venta".

## 2. Decisiones de producto (Roberto, 2026-10-06)

| Tema | Decisión |
|---|---|
| Ventas editables | **Todas**: de tablet y de portal |
| Campos editables | Productos y cantidades, # de nota, repartidor, contado/crédito, factura (N/A/pendiente) y comentarios. **No** se editan el cliente ni la fecha; si están mal, se elimina la venta y se registra de nuevo |
| Con abonos | Una venta con abonos vivos de `origen = 'cobro'` **no se edita ni se elimina** (eso es T-34). El cobro automático de contado (`origen = 'venta_contado'`) sí se ajusta solo |
| Cuenta perdida | Botón **"Marcar como cuenta perdida"** en ventas `pendiente` o `abonado`, **aunque tengan abonos**: no toca productos ni montos, solo deja de cobrarse el resto |
| Historial | Se guarda **quién y cuándo**: último usuario que editó, y quién eliminó y cuándo |
| Autorización | Basta el permiso `venta.editar_eliminar`. No pasa por Peticiones (T-34) |
| Búsqueda | Rango **desde–hasta** (default: hoy), más cliente y # de nota opcionales. Respeta "Por sucursal" |
| Eliminar | **Borrado lógico** (`deleted_at`). El # de nota se libera (el índice es parcial). El folio **no** se reutiliza nunca (ADR-0007) |
| Precios al editar | Las líneas existentes **conservan su precio**, que es el de la nota firmada. Una presentación nueva toma el precio de la lista del cliente **a la fecha de la venta** |

## 3. Pantalla

Ruta nueva **`/operacion/ventas`**, entrada **"Ventas"** en Operación de `nav-config.ts`, junto a "Registrar venta".

### 3.1 Búsqueda

- Filtros: **desde**, **hasta** (las dos hoy por default, zona de Tijuana), **cliente** (búsqueda incremental, opcional) y **# de nota** (opcional; sin distinguir mayúsculas ni espacios, coincidencia exacta).
- Resultado: una tabla con folio, fecha, cliente, repartidor ("Oficina" si es null), # de nota, monto, status, origen (Tablet/Portal) y saldo pendiente (monto − abonos vivos).
- Ordenada por fecha descendente y luego folio, con tope de **200** filas. Si hay más, se muestra "Hay más de 200 ventas: acota el rango o filtra por cliente".
- No incluye ventas eliminadas.

### 3.2 Detalle

Al elegir una fila se muestra la venta completa: cabecera, líneas con cantidad, promoción, precio y subtotal, y sus cobros (fecha, método, monto, origen). Debajo, los botones que apliquen:

| Botón | Visible si | Acción |
|---|---|---|
| **Editar** | Tiene permiso, la venta está viva y **no tiene abonos `origen = 'cobro'` vivos** | Abre el formulario de edición (§3.3) |
| **Eliminar** | Mismas condiciones que Editar | Confirmación: "¿Eliminar la venta {folio} (nota {numNota})? No se puede deshacer." |
| **Marcar como cuenta perdida** | Tiene permiso y el status es `pendiente` o `abonado` | Confirmación: "La venta {folio} dejará de cobrarse. ¿Continuar?" |

Si no se puede editar por los abonos, aparece el texto: *"Esta venta tiene cobros registrados: no se puede editar ni eliminar. Para quitar un cobro, ver Peticiones."*

### 3.3 Edición

Usa el mismo formulario de "Registrar venta" en modo edición, con el cliente y la fecha **fijos** (solo lectura):

- Las líneas existentes muestran **su precio guardado**.
- Las presentaciones del catálogo sin línea muestran el precio de la lista **a la fecha de la venta**; las que no tienen precio a esa fecha aparecen deshabilitadas.
- En una venta de **tablet** (`origen = 'app'`) la lista de repartidores **no** incluye "Oficina".
- Al grabar se muestra la venta actualizada; "Volver" regresa a la búsqueda conservando los filtros.

## 4. Backend

### 4.1 Endpoints (en `ventas.controller.ts`)

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| `GET` | `/ventas?desde=&hasta=&sucursal=&clienteId=&numNota=` | sesión | Búsqueda (§3.1). `sucursal` sigue el patrón de alcance de los catálogos (`resolverAlcance`) |
| `GET` | `/ventas/:id` | sesión | Detalle: cabecera, líneas, cobros, más `editable: boolean`, `motivoNoEditable: string \| null` y `puedeMarcarPerdida: boolean` |
| `PATCH` | `/ventas/:id` | `venta.editar_eliminar` | Edita (§4.2). Manda el **estado completo** de los campos editables |
| `DELETE` | `/ventas/:id` | `venta.editar_eliminar` | Elimina (§4.3) |
| `POST` | `/ventas/:id/cuenta-perdida` | `venta.editar_eliminar` | Marca cuenta perdida (§4.4) |

Todos responden **404** si la venta no existe o está eliminada, y **403** si su sucursal está fuera del alcance del usuario.

### 4.2 Editar — `PATCH /ventas/:id`

DTO: `vendedorId` (uuid o null), `numNota`, `contadoCredito`, `metodoPago?` (solo si contado; default: el método del cobro de contado vigente, o `transferencia` si no había), `factura`, `comentarios?`, `lineas[]` `{ presentacionId, cantidad, cantidadPromocion }`. **Sin precios.**

En **una transacción**:

1. `select … for update` de la venta. Esto serializa la edición contra un cobro concurrente de la tablet, que bloquea las notas del cliente con `for update` en `CobranzasRepository`.
2. Si hay abonos vivos con `origen = 'cobro'` → **409** "Tiene cobros registrados: no se puede editar."
3. Repartidor: si no es null, debe ser vendedor **activo** de la sucursal de la venta (400). Si la venta es `origen = 'app'` y viene null → 400 "Una venta de tablet debe tener vendedor."
4. Líneas: se reutilizan las reglas de forma de `datos-venta.ts` (1–50 líneas, sin presentación repetida, enteros). El precio de cada línea es **el guardado** si la presentación ya estaba en la venta; si es nueva, el de la lista a la fecha de la venta (`presentacionesConPrecio(cliente, fecha, { vigenteHastaHoy: false })`). Una presentación nueva con cantidad > 0 y sin precio → 409 `precio-no-asignado`.
5. Recalcular con las reglas compartidas de `reglas-venta.ts`: `monto_total`, y `status = statusInicial(contadoCredito, monto)`. `semana` y `mes` no cambian, porque la fecha no cambia.
6. `pct_comision`:
   - se conserva si el vendedor no cambia;
   - pasa a null si el repartidor pasa a Oficina;
   - si pasa de Oficina a un vendedor, o de un vendedor a otro, se congela el % **actual** del cliente.
7. Detalle:
   - las líneas que ya no vienen se marcan `deleted_at`;
   - las que siguen se actualizan (cantidad y promoción);
   - las nuevas se insertan.

   Requiere que `uq_venta_detalle_presentacion` sea **parcial** (`where deleted_at is null`) (§5).
8. Cobro de contado (`origen = 'venta_contado'`):
   - si antes era contado, su fila viva se marca `deleted_at`;
   - si ahora es contado con monto > 0, se inserta una fila nueva con el monto nuevo, el método elegido, `fecha_pago = fecha_operacion` = fecha de la venta y cobrador = repartidor de la venta (null si es Oficina);
   - una promoción ($0) no se cobra.
9. `actualizado_por_usuario_id` = usuario de la sesión. `updated_at` lo pone el trigger, y así la tablet se entera en el siguiente pull.
10. Un 23505 de `uq_venta_nota_num_nota_sucursal` → 409 "Ya existe la nota X en esta sucursal." (`esNotaDuplicada` / `motivoNotaDuplicada` de la parte 1).

El folio, el cliente, la fecha, la sucursal, el origen y `capturo_usuario_id` **nunca cambian**.

### 4.3 Eliminar — `DELETE /ventas/:id`

En una transacción, con `for update` de la venta:

1. Si hay abonos vivos con `origen = 'cobro'` → 409.
2. Se marcan con `deleted_at` la venta, sus líneas y su cobro de contado vivo.
3. Se guarda `eliminado_por_usuario_id` = usuario de la sesión.

El # de nota queda libre, porque el índice único es parcial. El folio queda usado.

### 4.4 Cuenta perdida — `POST /ventas/:id/cuenta-perdida`

En una transacción, con `for update`:

- status debe ser `pendiente` o `abonado`; si no, 409 "Solo una venta pendiente o abonada se puede marcar como cuenta perdida";
- `status = 'cuenta_perdida'`;
- `actualizado_por_usuario_id` = usuario de la sesión.

No toca líneas, montos ni abonos. No hay "deshacer" en esta versión. Las reglas de cobranza existentes ya tratan `cuenta_perdida` como no cobrable (`esCobrable`), y el pull de las tablets solo baja notas `pendiente`/`abonado`, así que la nota desaparece de su lista por cobrar.

### 4.5 Ventas de la tablet editadas desde el portal

La tablet no vuelve a bajar sus propias ventas: su historial local conserva lo que capturó. Lo que sí baja es la lista de **notas por cobrar** de la sucursal, que refleja la edición, la eliminación o la cuenta perdida en el siguiente pull. Es aceptable y se documenta. No cambia el contrato de sincronización.

## 5. Base de datos (una migración)

| Cambio | Nota |
|---|---|
| `venta_nota.actualizado_por_usuario_id uuid null references usuario(id)` | Último usuario del portal que la editó o la marcó como cuenta perdida |
| `venta_nota.eliminado_por_usuario_id uuid null references usuario(id)` | Quién la eliminó; el cuándo es `deleted_at` |
| `uq_venta_detalle_presentacion` → índice único **parcial** `(venta_nota_id, presentacion_id) where deleted_at is null` | Hoy es una constraint total: impediría volver a agregar una presentación quitada en una edición |

**Pre-flight en `sinmex dev`:** no hay checks, `not null` ni `unique` nuevos que puedan fallar, porque el índice parcial es **más permisivo** que el total. Igual se anota el `migration list` antes y después.

## 6. Lo que NO entra

- Eliminar o editar **cobros** (T-34, Peticiones) y la cobranza desde el portal sobre notas existentes (T-21).
- Deshacer una cuenta perdida, o restaurar una venta eliminada.
- Bloquear la edición de días ya cortados (no existe el corte de caja; es T-33). Ver §8.
- Asignar número de factura (T-19).
- Corregir el # de nota desde la tablet (T-71, #107).

## 7. Pruebas

- **pgTAP:** columnas de auditoría; el índice parcial deja reinsertar una presentación cuya línea está borrada y sigue impidiendo dos vivas.
- **Unit:**
  - armado de líneas en edición (precio guardado para las existentes, de lista para las nuevas);
  - regla de `pct_comision` al cambiar de repartidor;
  - cálculo de "editable / motivo / puede marcar perdida".
- **e2e (`ventas-editar.e2e-spec.ts`):**
  - búsqueda: por rango, por cliente, por # de nota (insensible a mayúsculas), alcance de sucursal (403 en otra), excluye eliminadas, tope de 200;
  - detalle: cobros y banderas;
  - editar:
    - cambia cantidades y recalcula monto y status;
    - conserva el precio de una línea aunque la lista haya cambiado; una línea nueva toma la lista a la fecha;
    - quitar y volver a agregar una presentación;
    - contado → crédito quita el cobro; crédito → contado lo crea con el método elegido;
    - Oficina ↔ vendedor y su `pct_comision`; una venta de tablet no acepta Oficina;
    - # de nota repetido → 409;
    - con abonos `cobro` → 409;
    - sin permiso → 403; otra sucursal → 403;
    - `actualizado_por_usuario_id` lleno;
  - eliminar: soft delete de venta, líneas y cobro de contado; libera el # de nota; con abonos → 409; `eliminado_por_usuario_id` lleno;
  - cuenta perdida: desde pendiente y desde abonado (con abonos); desde pagada → 409; la nota deja de salir en el pull de notas pendientes de la tablet;
  - una venta **de tablet** (creada por el push) se edita y se elimina desde el portal.
- **Portal (vitest):**
  - filtros y tabla;
  - botones según las banderas;
  - confirmaciones;
  - en modo edición, cliente y fecha fijos y sin "Oficina" para una venta de tablet;
  - el payload no lleva precios;
  - se muestra el mensaje del servidor.
- **Verificación manual** en el navegador contra el Postgres local.

## 8. Riesgos y notas

- **Días ya cerrados:** editar o eliminar una venta de contado cambia lo cobrado de ese día. Cuando exista el corte de caja (T-33) hay que decidir si se bloquea editar días ya cortados.
- **Concurrencia con la tablet:** el `for update` serializa la edición contra un cobro en vuelo. Si el cobro llega primero, la edición ve el abono y responde 409. Si la edición llega primero y elimina la venta, el cobro sigue la regla existente: "nota borrada → el dinero va a las otras notas o al saldo a favor".
- **Historial de la tablet** desactualizado tras una edición desde el portal (§4.5): aceptable, se documenta en el PR.

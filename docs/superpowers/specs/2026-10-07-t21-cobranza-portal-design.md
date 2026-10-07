# T-21 · Cobranza / Abono desde el Portal — Diseño

**Issue:** [#21](https://github.com/robertopeiro12/proyecto-sinmex/issues/21)
**Fecha:** 2026-10-07 · **Estado:** propuesto, pendiente de revisión de Roberto
**Base:** `Cobranza-Abono.md`, `Ventas y Cobranza.md` y `Status de venta.md` del vault; T-20 (cobranza
desde la tablet, `cobranzas.service.ts` / `reglas-cobranza.ts`); T-17 (folio `OF`, ADR-0011).

## 1. Para qué

Fuente (`Sistema Jawa (fuente).md`, Registro de Operaciones → Cobranza):

> Debe tener 2 opciones de registro: Cobranza y Abono. Para ambos casos que se busque la cuenta por
> cobrar ya sea por: el nombre del cliente, la fecha o el número de nota […]. Una vez teniendo la cuenta
> elegida, que se le cambie el status a pagado y se refleje como ingreso en el Flujo de Efectivo
> automáticamente así como en la Tesorería por persona. […] en esta sección de Cobranza se pueda
> también poner como "Cuenta perdida".

Hoy la tablet ya cobra (T-20), pero la oficina no tiene dónde registrar un pago: una transferencia, un
cheque o un cliente que llega a pagar. T-21 es esa pantalla.

### Reparto de responsabilidades

**El Portal es de Roberto y la App de tablet es de Mario.** Para T-21, Mario dio permiso a Roberto de
modificar la app: *"cualquier cosa que tenga que ver con este T-21 hay que modificar portal y app (si es
necesario), si no no"*, y **sin tocar código nativo** (Kotlin/Java; en el repo no hay: la app es
React Native/Expo en TypeScript). Los cambios en la app están en §4.6.

## 2. Decisiones de producto (Roberto, 2026-10-07)

| Tema | Decisión |
|---|---|
| Varias notas con un pago | La oficina **palomea las notas** que paga y teclea el monto. Si no alcanza, se pagan primero las palomeadas **más viejas** y la última queda abonada. Si sobra, va a las **otras notas** del cliente (de la más vieja a la más nueva) y luego a **saldo a favor** — igual que la tablet |
| Quién cobró | Se elige al momento: **"Oficina"** (default) o un **repartidor** activo de la sucursal del cliente. En la app es siempre el vendedor de la sesión (ya es así) |
| Saldo a favor | Se puede **aplicar** desde esta pantalla a las notas palomeadas, con las mismas reglas de reparto. No cuenta como dinero nuevo |
| Regla de cobro | **Una sola regla** para tablet y portal (opción A): se amplía a "una o varias notas"; la tablet sigue mandando una |
| Folio | **Los cobros no llevan folio.** Respuesta del cliente (2026-10-07), textual: *"Un solo folio"*, *"Porque la cobranza no lleva folio"*. Solo las ventas se numeran. Un cobro del portal se identifica por fecha, cliente, monto y las notas que pagó (`cobranza_abono.folio` queda null) |
| Tablet | Se modifica **solo lo necesario para T-21** (§4.6), en TypeScript: el cobro deja de llevar folio y el método `saldo_favor` se muestra como "Saldo a favor" |

## 3. Pantalla

Ruta nueva **`/operacion/cobranza`**, entrada **"Cobranza"** en Operación de `nav-config.ts`, después de
"Facturas". Sin el permiso `cobranza.registrar`, la pantalla dice "No tienes permiso para registrar
cobranza".

### 3.1 Buscar

- Tres formas: **cliente** (`BuscadorCliente`), **fecha** (de la venta) o **# de nota** (exacto, sin
  mayúsculas ni espacios, como en Ventas).
- Por cliente: entra directo a ese cliente (§3.2).
- Por fecha o # de nota: una tabla de notas **por cobrar** (`pendiente`/`abonado`, vivas) de cualquier
  cliente del alcance, con cliente, fecha, folio, # de nota, total y saldo. Un clic en una fila entra a
  su cliente con esa nota ya palomeada.

### 3.2 Cliente

- Encabezado: nombre y **saldo a favor** (si es mayor a 0).
- Tabla de sus notas por cobrar, de la más vieja a la más nueva: casilla, fecha, folio, # de nota,
  total, **saldo**, status y sus **abonos anteriores** (fecha, monto, método) desplegables.
- Botón **"Marcar como cuenta perdida"** por nota (reusa `POST /ventas/:id/cuenta-perdida` y su
  permiso `venta.editar_eliminar`; solo se ve si el usuario lo tiene).

### 3.3 Registrar pago

- Campos: **monto**, **fecha del pago** (hoy en Tijuana por default; puede ser pasada, nunca futura, ni
  anterior a la nota palomeada más vieja), **método** (transferencia por default; efectivo, cheque) y
  **cobrador** ("Oficina" por default, o un repartidor).
- **Vista previa** antes de grabar, calculada en el servidor con la misma regla
  (`POST /cobranzas/vista-previa`): por nota, cuánto recibe y cómo queda ("B pagada", "C abono $200,
  debe $500"), más lo que iría a otras notas y a saldo a favor.
- **Grabar** → mensaje "Cobro registrado: $1,500.00 a Cobach XXI" y la tabla se recarga.

### 3.4 Aplicar saldo a favor

- Botón **"Aplicar saldo a favor"**, visible si el cliente tiene saldo a favor y hay notas palomeadas.
- Monto: por default el menor entre el saldo a favor y el saldo de las palomeadas; editable, nunca
  mayor al saldo a favor.
- Misma vista previa y mismo reparto, **sin** método ni cobrador (no entra dinero) y **sin** excedente:
  si el monto supera lo que deben las palomeadas, se rechaza (no tiene sentido mover saldo a favor a
  saldo a favor).

## 4. Backend

### 4.1 Regla de reparto (pura, `reglas-cobranza.ts`)

- Función nueva **`repartirPagoEnNotas(montoCentavos, notasElegidasIds, notas)`**: el orden es las
  **elegidas por fecha y folio**, luego **las demás** por fecha y folio; lo que sobra es saldo a favor.
- **`repartirPago(monto, notaElegidaId, notas)` queda igual por fuera** y pasa a ser
  `repartirPagoEnNotas(monto, [notaElegidaId], notas)`. Sus pruebas actuales no cambian y deben
  seguir pasando: es la garantía de que la tablet no nota nada.
- La copia de `repartirPago` en la tablet (`apps/tablet/src/datos/cobranzas-reglas.ts`) **no se toca**:
  su comportamiento sigue idéntico al del servidor para una nota. La nota del archivo se amplía
  diciendo que `repartirPagoEnNotas` solo existe en el servidor (el portal no reparte localmente).

### 4.2 Servicio (`CobranzasService`)

- `registrarCobranza` acepta **una o varias** notas elegidas y un contexto con `vendedorId: string | null`
  (null = Oficina) y `usuarioId` (quien capturó). La tablet sigue entrando con una nota y su vendedor.
- Método nuevo **`aplicarSaldoFavor`**: bloquea las notas del cliente (como el cobro) y sus movimientos
  de saldo a favor, valida que el monto ≤ saldo a favor vivo y ≤ saldo de las palomeadas, reparte, escribe
  las filas `cobranza_abono` con `origen = 'saldo_favor'` y `metodo_pago = 'saldo_favor'`, y un
  movimiento **negativo** en `saldo_favor_movimiento` con `origen = 'aplicacion'`. Toca `updated_at` del
  cliente (para el pull, como T-20).
- **Servicio del portal** nuevo (`cobranzas-portal.service.ts`) para los endpoints: lee el cliente,
  exige alcance de sucursal, valida el cobrador (repartidor activo de la sucursal del cliente, o null)
  y llama a `CobranzasService` dentro de **una transacción**. **No emite folio** (`folio` null): el
  cliente dijo que la cobranza no lleva folio.

### 4.3 Endpoints (`cobranzas.controller.ts`, todos con `@RequierePermiso('cobranza.registrar')`)

| Método y ruta | Qué hace |
|---|---|
| `GET /cobranzas/por-cobrar?clienteId=` | Notas por cobrar del cliente (con saldo y abonos) y su saldo a favor |
| `GET /cobranzas/por-cobrar?fecha=` / `?numNota=` | Notas por cobrar de esa fecha o # de nota, de cualquier cliente del alcance (respeta "Por sucursal") |
| `POST /cobranzas/vista-previa` | `{ clienteId, notaIds, montoCentavos, modo: 'pago' | 'saldo_favor' }` → el reparto sin grabar |
| `POST /cobranzas` | `{ clienteId, notaIds, montoCentavos, fechaPago, metodoPago, vendedorId: uuid | null }` → registra |
| `POST /cobranzas/saldo-favor` | `{ clienteId, notaIds, montoCentavos }` → aplica saldo a favor |

Errores → **409/400 con mensaje, nunca 500**:
- monto ≤ 0, o con más de 2 decimales;
- fecha futura o anterior a la nota palomeada más vieja;
- una nota palomeada que ya no es cobrable (pagada, cuenta perdida o borrada) mientras se tenía la
  pantalla abierta: `La nota TJ… ya no tiene saldo; vuelve a cargar.`;
- nota de otro cliente o de otra sucursal; cobrador que no es repartidor activo de esa sucursal;
- aplicar más saldo a favor del que hay, o más de lo que deben las palomeadas;
- interbloqueo (`40P01`/`40001`): "Otro usuario estaba modificando… vuelve a intentar" (como facturas).

### 4.4 Base de datos (una migración)

```sql
alter table cobranza_abono
  add column capturo_usuario_id uuid references usuario(id);
-- método y origen nuevos para aplicar saldo a favor (no es dinero nuevo)
alter table cobranza_abono drop constraint cobranza_abono_metodo_pago_check;
alter table cobranza_abono add constraint ck_cobranza_abono_metodo
  check (metodo_pago in ('efectivo', 'transferencia', 'cheque', 'saldo_favor'));
alter table cobranza_abono drop constraint cobranza_abono_origen_check;
alter table cobranza_abono add constraint ck_cobranza_abono_origen
  check (origen in ('venta_contado', 'cobro', 'saldo_favor'));
alter table cobranza_abono add constraint ck_cobranza_abono_saldo_favor
  check ((origen = 'saldo_favor') = (metodo_pago = 'saldo_favor'));

alter table saldo_favor_movimiento
  add column capturo_usuario_id uuid references usuario(id);

-- La cobranza no lleva folio (cliente, 2026-10-07). En sinmex dev no hay cobros todavía.
drop index if exists idx_cobranza_abono_folio;
alter table cobranza_abono drop column folio;
alter table saldo_favor_movimiento drop column folio;
alter table saldo_favor_movimiento drop constraint saldo_favor_movimiento_origen_check;
alter table saldo_favor_movimiento add constraint ck_saldo_favor_origen
  check (origen in ('excedente_cobro', 'aplicacion'));
```

- Los tres checks viejos se declararon en línea (T-05 y T-20), así que llevan el nombre que Postgres les puso
  (`<tabla>_<columna>_check`). Confirmar con `\d cobranza_abono` en la base local antes de escribir la migración.
- **Pre-flight para `sinmex dev`:** contar filas de `cobranza_abono` y `saldo_favor_movimiento` con
  `folio is not null` (se va a borrar la columna): debe dar 0 (hoy la nube no tiene ventas ni cobros).
  Los checks nuevos solo **amplían** valores; el de
  `origen = 'saldo_favor' ⇔ metodo_pago = 'saldo_favor'` se cumple en filas viejas (ninguna tiene
  ninguno de los dos). Contar filas que lo violarían → debe dar 0.

### 4.5 Lo que ya existe y hay que cuidar

- **Tablet / pull:** cada cobro hace `update` del status de sus notas (aunque no cambie) y toca
  `updated_at` del cliente al mover saldo a favor (T-20). Con eso el pull incremental baja las notas con
  su saldo y abonos nuevos y el saldo a favor nuevo. La tablet guarda los abonos como JSON sin validar el
  método, así que `saldo_favor` no la rompe; se ve tal cual (§7).
- **Edición de ventas (T-17):** `abonosDeCobroVivos` cuenta `origen = 'cobro'`. Debe contar también
  `'saldo_favor'`: una venta pagada con saldo a favor no se edita ni se elimina (quitar cobros es T-34).
- **Detalle de venta (portal):** `CobroDeVenta.origen` acepta `'saldo_favor'` y la pantalla muestra
  "Saldo a favor" como método.
- **Concurrencia:** el cobro bloquea las notas del cliente (`bloquearNotasDelCliente`, T-20). Un cobro
  del portal y uno de la tablet sobre el mismo cliente se serializan; el segundo reparte con saldos ya
  actualizados. Las decisiones se toman sobre las filas **bloqueadas**, no sobre datos de un join (la
  lección de T-19).

### 4.6 La cobranza no lleva folio — servidor, contrato y app

Respuesta del cliente (2026-10-07): *"Un solo folio"*, *"Porque la cobranza no lleva folio"*. Solo las
ventas se numeran. **No es un folio opcional: el cobro no tiene folio en ningún lado.**

- **Servidor:**
  - `despacho-cobranza.ts` deja de exigir el folio. Si una operación `cobranza` llega **con** folio (una
    tablet sin actualizar), **se ignora el folio y el cobro se registra**: no se rechaza para no perder un
    cobro real, y el folio no se guarda en ningún lado (ni en `cobranza_abono`, ni en
    `saldo_favor_movimiento`, ni en `sync_operacion.folio`).
  - `CobranzasService`, `ContextoCobranza` y `CobranzasRepository` dejan de recibir y escribir `folio`.
  - Toda lectura que hoy devuelva el folio de un cobro (detalle de venta, pull) deja de hacerlo.
- **Contrato de sincronización** (`contrato.ts` del backend **y** de la tablet, y
  `docs/contrato-sincronizacion.md`, en el mismo commit): la operación `cobranza` ya no lleva `folio`.
  Como el # de nota opcional, **sin subir la versión** (la app no está publicada; la única tablet es la de
  prueba de Mario) y anotado en la lista de "revisar al publicar".
- **App** (`apps/tablet`, solo TypeScript):
  - Al grabar un cobro **no se emite folio** (`folios.emitir` deja de llamarse desde
    `repositorios/cobranzas.ts`). La serie del vendedor queda solo para ventas.
  - Migración local nueva: la tabla `cobranza` **pierde la columna `folio`** (se rehace la tabla, como la
    009; los cobros pendientes de subir se conservan).
  - `fuente-cobranzas.ts` deja de mandar `folio` en el sobre.
  - Pantalla de cobranza: la vista final deja de mostrar "anota este folio en el recibo" y muestra el
    **monto y cómo quedaron las notas** ("$500 · nota TJ261001AP03 pagada"). Los textos que mencionan
    "no se consumió ningún folio" se ajustan.
  - `NOMBRE_METODO` agrega `saldo_favor: 'Saldo a favor'`, y el tipo `MetodoPago` de los abonos que bajan
    en el pull acepta `'saldo_favor'` (lo introduce T-21).
  - La copia de `repartirPago` en la app **no cambia** (§4.1).
- **Orden de despliegue:** el servidor se actualiza primero (acepta cobros sin folio e ignora los que
  traen); después Mario instala la app nueva. Antes de instalarla, **sincronizar** la tablet para subir
  los cobros pendientes.

## 5. Lo que NO entra

- **Corregir o eliminar un cobro** (T-34, con autorización). Un cobro del portal no se deshace en esta
  versión; por eso la vista previa.
- Efecto en **Flujo de Efectivo y Tesorería** (T-32 y tickets de Tesorería): el método `saldo_favor`
  queda listo para que esos módulos no lo cuenten como ingreso.
- Cuentas por Cobrar como reporte (T-22).
- En `apps/tablet`, todo lo que no sea §4.6.

## 6. Pruebas

- **Unitarias:** `repartirPagoEnNotas` (palomeadas en orden de fecha, monto que no alcanza, que sobra a
  otras notas y a saldo a favor, palomeada ya no cobrable); `repartirPago` con **sus pruebas actuales
  sin cambiar**; validaciones del servicio del portal (fechas, monto, cobrador).
- **pgTAP:** los checks nuevos (métodos, orígenes, `saldo_favor` ⇔ `saldo_favor`).
- **e2e:** cobrar varias notas (status y saldos), pago parcial, excedente a otras notas y a saldo a
  favor, que el cobro **no lleve folio** ni consuma el contador `OF`, cobrador Oficina y repartidor, aplicar saldo a
  favor (y sus rechazos), búsquedas por cliente/fecha/# de nota, permiso y alcance por sucursal, nota que
  dejó de ser cobrable, que una venta pagada con saldo a favor no se edite, y que el **pull de la tablet**
  baje la nota cobrada desde el portal con su saldo y el saldo a favor nuevo. Las e2e de cobranza de la
  tablet (T-20) se ajustan solo en lo del folio, y se agregan: un cobro de la tablet **sin folio** se
  registra; uno **con folio** (tablet sin actualizar) también se registra y el folio no queda guardado.
- **App:** cobrar no consume número de la serie del vendedor (una venta después de un cobro sigue el
  consecutivo de ventas); la migración local quita la columna y conserva los cobros pendientes; el sobre
  de cobranza no lleva folio; la pantalla final muestra monto y notas; "Saldo a favor" en abonos.
- **Portal:** búsqueda, palomear, vista previa, grabar, aplicar saldo a favor, cuenta perdida, permisos.
- **Manual:** en el navegador contra el Postgres **local**.

## 7. Notas para Mario (app de tablet)

- Los cambios de la app de T-21 están en §4.6 (con su permiso). Para probarlos: **sincronizar antes** de
  instalar la versión nueva, para subir cobros pendientes.
- La copia de `repartirPago` sigue idéntica a la del servidor; `repartirPagoEnNotas` es solo del
  servidor.

## 8. Riesgos y notas

- Un cobro del portal no se puede deshacer hasta T-34.
- Una tablet sin actualizar sigue gastando un número de su serie al cobrar (el servidor ignora ese
  folio). Solo pasa con la tablet de prueba hasta que instale la versión nueva.

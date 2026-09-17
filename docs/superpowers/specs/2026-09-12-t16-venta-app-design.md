# T-16 · Registrar Operación de Venta — App Tablet

- **Issue:** [#16](https://github.com/robertopeiro12/proyecto-sinmex/issues/16) — Sprint 5
- **Depende de:** T-12 (Cartera de Clientes, #81 ✅), T-10 (Productos, #74 ✅), T-14 (Folios, #72 ✅)
- **Fecha:** 2026-09-12
- **Producto:** Backend + App Tablet
- **Rama:** `feature/t-16-venta-app` desde `main` @ `a7c1ca8`
- **Rige:** `ADR-0009 Proyección de operaciones sincronizadas a los módulos de dominio` (vault,
  `propuesto`). T-16 es el primer ticket que lo usa, y su revisión cruzada es la que lo acepta.

## Objetivo

Que el vendedor registre una venta en ruta **sin red**: elige al cliente, captura solo cantidades
(y piezas de promoción), la app calcula el total con el precio del cliente, emite el folio que
escribe en la nota física y guarda todo en la tablet. Al sincronizar, el servidor la convierte en
una `venta_nota` real.

Ver en el vault `10-Dominio/Entidades/Venta-Nota.md`, `Reglas/Status de venta.md`,
`Modulos/Ventas y Cobranza.md` y `20-Arquitectura/App Tablet.md`.

Es el **primer módulo de dominio** que recibe operaciones de la tablet. Por eso T-16 también
construye la base que usarán T-20, T-38, T-39, T-27 y T-31: `push` con una transacción por
operación y un despachador por `tipo`.

## Alcance

### Dentro

1. **Backend — base de ADR-0009:** `push` pasa a una transacción por operación; despachador por
   `tipo`; la colisión de folio se clasifica fuera de la transacción; el buzón registra a qué fila
   de negocio se convirtió cada operación (`entidad_tabla` / `entidad_id`).
2. **Backend — módulo `ventas-cobranza/`** (hoy `@Module({})` vacío): validación de `datos`,
   reglas puras de la venta, `VentasService.registrarVenta`, repositorio. Consulta de precios
   vigentes de un cliente en `cartera-clientes/`.
3. **Migración** con restricciones de integridad sobre `venta_nota` y `venta_nota_detalle`, más
   `comentarios` y `pct_comision`.
4. **Contrato de sincronización:** forma de `datos` para `tipo: "venta"` y dos códigos de rechazo
   nuevos. Cambio aditivo, `CONTRATO_ACTUAL` sigue en 1.
5. **Tablet:** migración local 004 (`venta`, `venta_linea`), repositorio de ventas con el folio
   emitido en la misma transacción, fuente de operaciones para el motor, pantalla de venta con paso
   de revisión, y un bloque de "ventas de hoy" en la ficha del cliente.
6. **Limpieza:** numeración vieja de tickets en las pantallas de la tablet.
7. **Pruebas:** arreglo de `92_folios_test.sql`, pgTAP de las restricciones nuevas, unitarias de
   las reglas y la validación, e2e de `push` con ventas reales, pruebas de la capa de datos de la
   tablet.

### Fuera, a propósito

| Qué | Por qué |
|---|---|
| **Cobrar o abonar notas pendientes desde la venta** (consignación) | D1: es T-20, que va inmediatamente después y lo agrega en esta misma pantalla. |
| **Editar o anular una venta en la tablet** | D3: nunca se edita. Se corrige desde el portal, T-17 (tercero del roadmap). |
| **Registrar ventas desde el portal** | T-17. T-16 deja `registrarVenta` listo para esa segunda puerta, pero no la construye. |
| **Calcular la comisión** | T-45. T-16 solo guarda el `pct_comision` vigente al vender (D8). |
| **Asignar número de factura** | Portal (T-19). Desde la tablet solo `N/A` o `pendiente`. |
| **`cobranza_abono` para ventas de contado** | D5: lo decide T-20. |
| **Procesar `jornada`, `cobranza`, `gasto`, `merma`, `ruta`** | Siguen como hoy: se guardan en el buzón y quedan `aplicada`. Cada uno es de su ticket. |
| **Prueba de la pantalla en tablet física** | No hay aparato. Se verifica con typecheck, bundle de Metro y pruebas de la capa de datos; queda anotado como pendiente, igual que T-04…T-14. |

## Decisiones

### Decididas con Mario (2026-09-12)

#### D1 — La venta muestra las notas pendientes; el cobro es de T-20

El issue pide *"muestra productos y notas pendientes"*; el vault dice que al registrar la venta se
pueden cobrar en la misma operación (`Status de venta` → casos límite). Se reparte: T-16 **muestra**
las notas del cliente, solo lectura; T-20 agrega el cobro también desde esta pantalla, como
operaciones `cobranza` **separadas** en el mismo lote, cada una con su clave de idempotencia. El
roadmap pasa a `T-16 → T-20 → T-17 → T-38`. La app no está en producción, así que repartirlo no le
cuesta nada al negocio.

#### D2 — Vale el precio de la nota firmada

La tablet no calcula precios: usa el que bajó en el último `pull`. Si el portal cambió el precio
mientras el vendedor estaba en ruta, la nota que firmó el cliente lleva el anterior. **El servidor
guarda el precio que manda la tablet.** Solo rechaza si la presentación no existe o está inactiva, o
si el cliente no tiene precio para ella (D12, D13). No existe `precio-desactualizado`: la venta ya
ocurrió y en campo no hay nada que corregir.

#### D3 — Una venta grabada en la tablet nunca se edita ni se anula

Se corrige desde el portal (T-17). El folio emitido no se reutiliza nunca (ADR-0007). Consecuencia
de diseño: la pantalla tiene un **paso de revisión obligatorio** antes de grabar (D17).

### Reglas de negocio

#### D4 — Status inicial

`contado` → `pagada`; `credito` → `pendiente`; si el monto total es 0 (solo piezas de promoción)
→ `promocion`, sin importar contado/crédito. `cuenta_perdida` y `abonado` nunca son iniciales.
Fuente: `Reglas/Status de venta.md`. Función pura en el backend.

#### D5 — Una venta de contado no crea `cobranza_abono` en T-16

`cobranza_abono` es la tabla de T-20 (ADR-0009). Si T-20 decide que el corte necesita esas filas
también para ventas de contado, se generan a partir de `venta_nota` con `contado_credito = 'contado'`.
Costo de equivocarse: un backfill.

#### D6 — `semana` = semana ISO-8601 de `fecha_operacion`; `mes` = 1–12

El vault solo dice "semana del año". ISO-8601 es la convención más común (lunes a domingo, la
semana 1 contiene el primer jueves). Se calcula de `fecha_operacion` **tal cual llegó**, nunca de
`ocurrido_en` en UTC. **Pendiente de confirmar con el cliente**; la columna se puede recalcular.

#### D7 — `# de nota`: texto obligatorio, sin unicidad

Ninguna fuente pide unicidad ni formato, y la identidad del hecho de negocio es el folio. Se valida
que no esté vacío (≤ 30 caracteres, recortado). **Pendiente de confirmar con el cliente.**

#### D8 — Se congela el `pct_comision` del cliente en la venta

`cliente.pct_comision` no tiene historial: si el administrador lo cambia mañana, el valor de hoy se
pierde. `Cálculo de comisión` deja abierto si un cambio de % recalcula ventas pasadas. Guardar el %
al vender deja las dos opciones abiertas para T-45 a costo de una columna. **No se calcula la
comisión.**

#### D9 — `factura` y `comentarios`

Desde la tablet, `factura` es `N/A` (por defecto) o `pendiente`; el número lo asigna el portal. No
se agrega `check` (el ciclo completo es de T-19). `comentarios` es columna nueva, opcional, ≤ 500.

### Backend

#### D10 — `push`: una transacción por operación (base de ADR-0009)

```
por cada operación del lote, en el orden en que llegó:
  validación genérica (normalizarOperacion, igual que hoy)   → rechazada sin tocar la base
  si el tipo tiene procesador: validación de forma de datos   → rechazada sin tocar la base
  transacción:
    INSERT en sync_operacion ... on conflict (vendedor_id, clave) do nothing
    si no insertó                         → duplicada (no se procesa otra vez)
    si el tipo tiene procesador           → procesar y actualizar entidad_tabla/entidad_id
  commit                                  → aplicada
  si el dominio rechaza                   → rollback → rechazada con su código
  si choca el unique del folio (23505)    → rollback; FUERA de la transacción:
                                             ¿existe esa clave para el vendedor? duplicada : folio-duplicado
  cualquier otro error                    → se propaga (500), como hoy
```

- **Por qué la clasificación del folio sale del `catch`:** Postgres aborta la transacción entera
  con un `unique_violation`; cualquier consulta posterior con el mismo `trx` falla. Hoy el `catch`
  consulta en la misma conexión porque no hay transacción.
- **Una rechazada no deja fila** (contrato §7), ni en el buzón ni en las tablas de negocio: el
  rollback las deshace juntas.
- **Tipos sin procesador** (`jornada`, `cobranza`, `gasto`, `merma`, `ruta`) no cambian de
  comportamiento: buzón y `aplicada`, con `entidad_id` nulo (el índice
  `idx_sync_operacion_sin_proyectar` los sigue listando).
- **Un error inesperado** a mitad de lote deja comprometidas las operaciones anteriores (cada una
  tuvo su commit); el reintento de la tablet las recibe como `duplicada`. Mismo contrato que hoy.

#### D11 — Trazabilidad con `entidad_tabla` / `entidad_id`, sin `sync_operacion_id`

**Enmienda a ADR-0009 §2.4.** T-07 dejó en `sync_operacion` las columnas `entidad_tabla` y
`entidad_id` precisamente para esto (migración `20260807203000`, líneas 15-16 y 71-73), y nadie las
escribe. Al procesar una venta se guarda `entidad_tabla = 'venta_nota'` y `entidad_id` = su id. El
camino inverso lo da el folio, único en las dos tablas. Una columna `sync_operacion_id` en
`venta_nota` sería redundante. Se registra en el ADR al cerrar el ticket.

#### D12 — Rechazos: el dominio da la razón, sincronización pone el código

`ventas-cobranza` no importa tipos del contrato de sincronización (la dependencia va de
sincronización hacia los módulos de dominio, ADR-0009). Lanza `VentaRechazada` con una razón
propia; `push` la traduce. T-17 la traducirá a HTTP.

| Código | Cuándo | Qué hace la tablet |
|---|---|---|
| `datos-invalidos` (**amplía su significado**: *"`datos` no cumple la forma de su tipo"*) | Venta sin `cliente_id` o sin `folio`; `lineas` vacía, con más de 50 o con presentación repetida; cantidades negativas, no enteras o las dos en 0; `precio_centavos` ausente, negativo o no entero, o en 0 en una línea con cantidad > 0; `num_nota` vacío; `contado_credito` o `factura` fuera de sus valores. El `motivo` nombra el campo | Es un bug: marca error y lo muestra |
| `presentacion-inactiva` (**nuevo**) | La presentación no existe, está borrada, o su producto está inactivo o borrado | Marca error; se reintenta en la siguiente sincronización (D19) |
| `precio-no-asignado` (**nuevo**) | Una línea con cantidad > 0 y el cliente no tiene **ningún** precio para esa presentación vigente a `fecha_operacion` (ni asignado después, hasta hoy: ver la enmienda). Es una comprobación de **existencia**, nunca de valor: el precio que manda la tablet no se compara (D2) | Igual; el administrador asigna el precio y la siguiente sincronización la sube |

> **Enmienda 2026-09-14 (revisión final).** La existencia del precio de una venta se evalúa a
> `greatest(fecha_operacion, current_date)`: cuenta los precios vigentes en `fecha_operacion` y los
> asignados después, hasta hoy. **Por qué:** el portal siempre da de alta los precios con
> `vigente_desde` = hoy, así que medir a `fecha_operacion` rechazaba para siempre una venta del día N
> cuyo precio el administrador asignó el día N+1, y la promesa de esta tabla y de D19 ("el
> administrador asigna el precio y la siguiente sincronización la sube") no se cumplía. `current_date`
> de Postgres (UTC) nunca va detrás de la fecha de Tijuana, así que un precio dado de alta "hoy" en
> el portal siempre cuenta. Sigue siendo solo existencia (D2): el precio guardado es el de la
> tablet. El `pull` sigue resolviendo precios a la fecha pedida, y `fecha`, `semana`, `mes` y el
> folio siguen saliendo de `fecha_operacion` tal cual llegó.

#### D13 — El precio solo se exige en líneas con cantidad > 0

Regalar piezas (solo promoción) a un prospecto, que no tiene lista de precios, funciona desde T-16:
la venta queda en `promocion` con monto 0. Es lo que el vault describe para prospectar.

#### D14 — El servidor calcula el monto

`monto_total = Σ (cantidad × precio_centavos)`; las piezas de promoción no suman. La tablet no
manda total. Evita de raíz el bug v2.0 de montos que no suman. Conversión con `dinero.ts`.

### Tablet

#### D15 — El precio lo pone el repositorio, no la pantalla

`ventas.registrar()` recibe cantidades y lee el precio del SQLite local
(`catalogos.precioVigente(cliente, presentación, reloj.hoy())`). Si una línea con cantidad > 0 no
tiene precio, **no deja grabar** y lo dice. En una línea **solo de promoción** sin precio se guarda
`precio_centavos = 0` (D13). La pantalla muestra precios, pero no los envía: no hay forma de que un
error de UI grabe un precio distinto al del catálogo.

#### D16 — Folio y venta en la misma transacción

`enTransaccion(bd, () => { folios.emitir({ vendedorId, claveOperacion: ventaId }); insert venta;
insert lineas })`. `emitir()` usa `savepoint`, así que se anida. Si algo falla, el rollback también
deshace el contador: **no se quema un número**.

#### D17 — Captura → revisión → grabado → folio

Como la venta no se puede editar (D3), la pantalla tiene tres estados con **una sola acción primaria
cada uno** (regla del sistema de diseño):

1. **Captura:** notas pendientes del cliente (solo lectura, con saldo), una fila por presentación
   activa con su precio, dos campos numéricos (cantidad y piezas de promoción), contado/crédito,
   `# de nota`, factura (`N/A` / `pendiente`), comentarios y el total en vivo. Acción: **Revisar**.
2. **Revisión:** resumen (líneas con cantidad, promoción, importe; total; contado/crédito; nota).
   Acciones: **Grabar venta** (primaria) y *Corregir* (vuelve a la captura).
3. **Grabada:** el **folio en grande** para escribirlo en la nota física, y volver a la ficha del
   cliente.

Todas las cifras van en `<Cifra>` y el dinero pasa por `pesos()`. Las lecturas del catálogo
dependen de `versionCatalogos` (defecto del primer arranque, 2026-08-23).

#### D18 — La venta local no es una nota pendiente hasta sincronizar

Las notas pendientes bajan del servidor. Una venta a crédito grabada hoy aparecerá como nota después
de sincronizar. Para que el vendedor no pierda de vista lo que capturó, la ficha del cliente muestra
un bloque **"Ventas de hoy"**: folio, total y estado de sincronización (pendiente, sincronizada o
error con su motivo).

#### D19 — Las ventas con error se reenvían en cada sincronización

Mismo patrón que la jornada: `pendientesDeSincronizar()` incluye `error`. Un rechazo por
`precio-no-asignado` o `presentacion-inactiva` se recupera solo cuando el administrador corrige el
catálogo. Un `datos-invalidos` se reenvía y vuelve a fallar sin efectos (una rechazada no deja
fila), y queda visible en el bloque de D18.

### Pruebas existentes

#### D20 — Las pruebas que usaban `venta` como sobre genérico pasan a una venta válida

`sincronizacion.e2e-spec.ts` usa `tipo: 'venta'` como sobre de prueba en cinco lugares (líneas
~743, 955-958, 1019, 1087, 1314): lote parcial, alcance de cliente, colisión y coherencia de folio.
Con T-16, una venta sin `datos` válidos es `datos-invalidos` y romperían. **No se cambian a otro
`tipo`** (T-20 las rompería de nuevo con `cobranza`): se agrega un helper `ventaValida()` que crea
su presentación y precio de prueba y arma `datos` correctos. Las pruebas conservan lo que miden.
`operaciones.spec.ts` y `motor.spec.ts` de la tablet no cambian: prueban el sobre genérico y un API
falso.

#### D21 — `92_folios_test.sql` deja de depender de los datos de la base

La línea base de hoy (2026-09-12) da `Result: FAIL`: el test crea un vendedor con segmento `AP` en
TJ y la base local ya tiene `vendedor1` (`AP`, TJ, vivo, de la prueba en dispositivo del 23-ago);
choca con `uq_vendedor_folio_segmento` y aborta tras 4 de 15. No es regresión de código, y la CI no
corre pgTAP. Se cambian los segmentos del test por unos que ningún vendedor real puede tener, o se
aparta dentro de la transacción del test a quien los ocupe.

## Modelo de datos

### Postgres — migración nueva

```sql
alter table venta_nota
  add column comentarios text,
  add column pct_comision numeric(5,2),
  add constraint ck_venta_nota_num_nota_no_vacio check (char_length(btrim(num_nota)) > 0),
  add constraint ck_venta_nota_comentarios_largo check (comentarios is null or char_length(comentarios) <= 500);

alter table venta_nota_detalle
  add constraint ck_venta_detalle_cantidades check (
    cantidad >= 0 and cantidad_promocion >= 0 and cantidad + cantidad_promocion > 0),
  add constraint ck_venta_detalle_precio check (precio >= 0),
  add constraint uq_venta_detalle_presentacion unique (venta_nota_id, presentacion_id);
```

Las tres tablas afectadas tienen **0 filas** (verificado en local el 2026-09-12). Nombres finales y
comentarios los fija el plan; cada restricción lleva su prueba pgTAP.

### Tablet — migración local 004

```sql
create table venta (
  id                   text primary key,          -- = clave de idempotencia
  fecha                text not null,             -- reloj.hoy(), día de trabajo
  cliente_id           text not null references cliente(id),
  vendedor_id          text not null references vendedor(id),
  sucursal_id          text not null references sucursal(id),
  folio                text not null unique,
  num_nota             text not null check (length(trim(num_nota)) > 0),
  contado_credito      text not null check (contado_credito in ('contado','credito')),
  factura              text not null default 'N/A' check (factura in ('N/A','pendiente')),
  comentarios          text,
  monto_total_centavos integer not null check (monto_total_centavos >= 0),
  grabada_en           text not null,
  sync_estado          text not null default 'pendiente'
                         check (sync_estado in ('pendiente','enviando','sincronizado','error')),
  sync_error           text,
  sincronizado_en      text
);

create table venta_linea (
  venta_id           text not null references venta(id),
  presentacion_id    text not null references presentacion(id),
  cantidad           integer not null check (cantidad >= 0),
  cantidad_promocion integer not null check (cantidad_promocion >= 0),
  precio_centavos    integer not null check (precio_centavos >= 0),
  primary key (venta_id, presentacion_id),
  check (cantidad + cantidad_promocion > 0)
);

create index idx_venta_sync on venta (sync_estado) where sync_estado <> 'sincronizado';
create index idx_venta_cliente_fecha on venta (cliente_id, fecha);
```

`status` no se guarda en la tablet: lo decide el servidor (D4) y la pantalla muestra
contado/crédito.

## Contrato — `tipo: "venta"`

```jsonc
{
  "clave": "uuid de la venta local",
  "tipo": "venta",
  "fecha_operacion": "2026-09-14",
  "ocurrido_en": "2026-09-14T11:32:05.000-07:00",
  "cliente_id": "uuid",              // obligatorio en venta
  "folio": "TJ260914AP03",           // obligatorio en venta
  "datos": {
    "num_nota": "2346",
    "contado_credito": "credito",    // contado | credito
    "factura": "N/A",                // N/A | pendiente
    "comentarios": null,             // opcional, ≤ 500
    "lineas": [                      // 1..50, sin presentación repetida
      { "presentacion_id": "uuid", "cantidad": 24, "cantidad_promocion": 2, "precio_centavos": 1350 }
      // precio_centavos: entero ≥ 0, siempre presente; > 0 si cantidad > 0 (0 solo en líneas de pura promoción)
    ]
  }
}
```

Tipos `DatosVenta` y `LineaVenta` más los dos códigos nuevos, **a la vez** en
`apps/backend/src/modules/sincronizacion/contrato.ts`, `apps/tablet/src/sincronizacion/contrato.ts`
y `docs/contrato-sincronizacion.md` (§6: forma de `datos` de venta y tabla de códigos; §9: la venta
deja de estar "pendiente").

## Archivos

### Backend

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260912120000_venta_integridad.sql` | Nuevo (D8, D9, restricciones) |
| `supabase/tests/92_folios_test.sql` | Independiente de los datos (D21) |
| `supabase/tests/99_venta_integridad_test.sql` | Nuevo |
| `modules/ventas-cobranza/reglas-venta.ts` (+ spec) | Status inicial, semana ISO, mes, monto — puro |
| `modules/ventas-cobranza/datos-venta.ts` (+ spec) | Valida y normaliza `datos` → `VentaNormalizada` o razón — puro |
| `modules/ventas-cobranza/venta-rechazada.ts` | Error de dominio con razón |
| `modules/ventas-cobranza/ventas.repository.ts` | Presentaciones activas, inserts, `pct_comision` — recibe `trx` |
| `modules/ventas-cobranza/ventas.service.ts` | `registrarVenta(venta, contexto, trx)` |
| `modules/ventas-cobranza/ventas-cobranza.module.ts` | Provee y exporta el servicio; importa cartera-clientes |
| `modules/cartera-clientes/precios.repository.ts` (+ módulo) | `presentacionesConPrecio(clienteId, fecha, trx)`, exportado |
| `modules/sincronizacion/sincronizacion.service.ts` | Transacción por operación, despachador, traducción de razones |
| `modules/sincronizacion/sincronizacion.repository.ts` | `guardarOperacion` recibe `trx`; clasificación de folio fuera; guarda `entidad_*` |
| `modules/sincronizacion/sincronizacion.module.ts` | Importa `VentasCobranzaModule` |
| `modules/sincronizacion/contrato.ts` + `docs/contrato-sincronizacion.md` | `DatosVenta`, códigos nuevos |
| `test/sincronizacion.e2e-spec.ts` (+ helper) | `ventaValida()` (D20) y casos nuevos |

`contexto` de `registrarVenta`: `{ sucursalId, fechaOperacion, vendedorId: string, folio: string |
null, usuarioId: string | null }`. **`vendedorId` es obligatorio siempre**: es el repartidor de la
venta (`venta_nota.vendedor_id not null`, y *Repartidor* es obligatorio en `Venta-Nota`), también en
una venta de oficina. `usuarioId` es **quién la capturó** (portal) y no lo sustituye. T-16 lo llama
con `folio` y sin `usuarioId`; la firma no exige ninguno de los dos, para que T-17 la use sin
cambiarla. Ojo: `venta_nota.folio`
sigue siendo `not null unique` en la base, así que una venta de portal sin folio fallaría ahí; qué
folio lleva una venta de oficina lo decide el spec de T-17 (ver su ficha en el roadmap).

### Tablet

| Archivo | Cambio |
|---|---|
| `src/datos/migraciones/004-ventas.ts` + `index.ts` | Nuevo |
| `src/datos/tipos.ts` | `Venta`, `VentaLinea` |
| `src/datos/ventas-reglas.ts` (+ spec) | Resumen de la captura (importe por línea, total, piezas) y validación — puro, lo usan pantalla y repositorio |
| `src/datos/repositorios/catalogos.ts` (+ spec) | `presentacionesParaVenta(clienteId, fecha)`: presentaciones activas de productos activos con su precio o `null` |
| `src/datos/repositorios/ventas.ts` (+ spec) | `registrar`, `delDia(clienteId, fecha)`, `pendientesDeSincronizar`, `marcarSincronizada`, `marcarError` |
| `src/datos/index.ts` (capa de datos) | Expone `ventas` |
| `src/sincronizacion/contrato.ts` | `DatosVenta`, códigos nuevos |
| `src/sincronizacion/fuente-ventas.ts` (+ spec) | Arma operaciones `venta` |
| `src/estado/proveedor-sesion.tsx` | Registra `fuenteVentas` junto a `fuenteJornadas` |
| `app/(jornada)/operacion/[clienteId]/venta.tsx` | Pantalla (D17) |
| `app/(jornada)/operacion/[clienteId]/index.tsx` | Bloque "Ventas de hoy" (D18) |
| `app/(jornada)/operacion/[clienteId]/visita-sin-venta.tsx`, `registros.tsx`, `app/(jornada)/prospectos.tsx`, `ruta.tsx`, `cerrar-dia.tsx`, `operacion/index.tsx` | Numeración de tickets: visita = T-39, registros = T-27/T-31, prospectos = T-40, ruta = T-41, corte = T-33; verificar `operacion/index.tsx:15` |

## Pruebas

| Nivel | Qué cubre |
|---|---|
| **pgTAP** | `92_folios` en verde sin depender de datos; cada restricción nueva de `venta_nota` y `venta_nota_detalle` (acepta lo válido, rechaza lo inválido) |
| **Unitarias backend** | `reglas-venta` (status en los 3 casos, semana ISO en bordes de año —p. ej. `2027-01-01` es semana 53 de 2026—, mes, monto con y sin promoción); `datos-venta` (cada causa de `datos-invalidos` nombra su campo) |
| **e2e backend (`push`)** | Venta válida → `aplicada`, `venta_nota` + detalle con monto, status, semana, `pct_comision`, y `entidad_*` en el buzón · reenvío → `duplicada` sin segunda venta · `presentacion-inactiva` y `precio-no-asignado` → `rechazada` con **0 filas en el buzón y en negocio** · colisión de folio → `folio-duplicado`, 0 filas · reintento legítimo tras colisión de otra clave sigue `duplicada` · solo promoción a prospecto sin precio → `aplicada`, `promocion`, monto 0 · lote mixto (jornada + venta buena + venta rechazada) → parcial y en orden · el precio aceptado coincide con el que baja en `pull` · `jornada` sigue `aplicada` sin `entidad_id` · las 5 pruebas de D20 migradas |
| **Tablet (Node + SQLite)** | Migración 004 · `registrar` emite folio y guarda en una transacción; un fallo (sin precio, sin segmento) **no consume folio** · `presentacionesParaVenta` respeta inactivos y vigencia · `fuenteVentas` arma el sobre exacto del contrato · reglas puras |
| **Estáticas** | `typecheck` de la tablet, `lint` y `build` del backend, bundle de Metro (`npm run export`) |

Las pruebas no traen conteos escritos: se comparan contra la línea base medida
(`.superpowers/sdd/t-16-venta/linea-base.txt`).

## Plan de tareas y modelos (orientativo; lo fija el plan)

| # | Tarea | Implementa | Revisa |
|---|---|---|---|
| 1 | `92_folios_test.sql` independiente de los datos (D21) | `haiku` | `sonnet` |
| 2 | Migración Postgres + pgTAP | `haiku` | `sonnet` |
| 3 | `reglas-venta.ts` + unitarias | `haiku` | `sonnet` |
| 4 | `datos-venta.ts` + unitarias | `sonnet` | `sonnet` |
| 5 | Contrato: tipos y códigos en backend, tablet y `docs/` | `haiku` | `sonnet` |
| 6 | `presentacionesConPrecio` en cartera-clientes + e2e contra `pull` | `sonnet` | `sonnet` |
| 7 | `ventas.repository` + `ventas.service` + módulo | `sonnet` | `opus` |
| 8 | `push` transaccional + despachador + folio fuera de la transacción + `entidad_*` | `opus` | `opus` |
| 9 | e2e de venta en `push` + helper `ventaValida()` + migrar las 5 pruebas | `sonnet` | `opus` |
| 10 | Tablet: migración 004 + tipos | `sonnet` | `sonnet` |
| 11 | Tablet: reglas puras + `presentacionesParaVenta` + repositorio de ventas | `sonnet` | `sonnet` |
| 12 | Tablet: `fuenteVentas` + registro en la sesión | `haiku` | `sonnet` |
| 13 | Tablet: pantalla `venta.tsx` (D17) | `sonnet` | `sonnet` |
| 14 | Tablet: "Ventas de hoy" + limpieza de numeración | `sonnet` | `sonnet` |
| 15 | Cierre: vault (enmienda ADR-0009 §2.4, notas afectadas, estado, bitácora) + PR | `sonnet` | controlador |
| — | **Revisión final de la rama** | `fable` (techo) / `opus` | — |

## Riesgos

- **La transacción abortada por el folio** (D10): el error más fácil de cometer en la tarea 8. Tiene
  su e2e dedicado.
- **Tipos duplicados** backend/tablet: si divergen no hay error de compilación. La tarea 5 los
  cambia juntos; la revisión final lo verifica.
- **Reactividad de la pantalla**: sin `versionCatalogos` en las dependencias, la pantalla no ve lo
  que escribió el `pull` (defecto del 2026-08-23).
- **Rendimiento de `push`**: ahora hay una transacción y varios `INSERT` por venta. Con ≤ 500
  operaciones por lote no preocupa; se mide cuando haya tablet real.
- **`fecha_operacion` vs UTC** en `semana`/`mes`: prueba de borde de año en la tarea 3.

## Después del merge

- `supabase db push` a `sinmex dev` — **no lo corre el agente**; dueño por acordar.
- Vault: **dos enmiendas a ADR-0009** — §2.4, trazabilidad con `entidad_tabla`/`entidad_id` en vez
  de `sync_operacion_id` (D11); §2.1, la fila `venta` ya no incluye "cobranza de notas pendientes en
  la misma operación": pasa a T-20 como operaciones `cobranza` separadas (D1); `Venta-Nota` y `Ventas y Cobranza` con lo
  implementado; `Sincronización offline` (la venta ya se procesa); `App Tablet` (estado de T-16 y
  numeración corregida); `Estado del proyecto`; bitácora.
- Pendientes con el cliente que salen de aquí: convención de `semana` (D6) y unicidad de `# de
  nota` (D7).
- Siguiente ticket: **T-20**, que agrega el cobro en esta misma pantalla (D1).

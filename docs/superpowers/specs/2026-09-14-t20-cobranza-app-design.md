# T-20 · Cobranza / Abono — App Tablet

- **Issue:** [#20](https://github.com/robertopeiro12/proyecto-sinmex/issues/20) — Sprint 6
- **Depende de:** T-16 (Venta, PR #89 — **sin merge**; esta rama se apila sobre `feature/t-16-venta-app`)
- **Fecha:** 2026-09-14
- **Producto:** Backend + App Tablet
- **Rama:** `feature/t-20-cobranza-app` desde `feature/t-16-venta-app` @ `008dc9e`
- **Rige:** ADR-0009 (con sus enmiendas §2.1 y §2.4) y ADR-0001/0007 (folios). Digest de hechos:
  `.superpowers/sdd/t-20-cobranza/digest.md` (local, no versionado).

## Objetivo

Que el vendedor cobre en ruta **sin red** una nota pendiente —liquidándola o abonando— con método
de pago y fecha de pago, y que al sincronizar el servidor reparta el dinero, cambie el status de las
notas y deje constancia para el corte de caja y la tesorería. Además, que una venta de contado deje
su cobro registrado, y que la consignación (cobrar notas anteriores al surtir) sea un paso directo
después de grabar la venta.

## Alcance

### Dentro

1. **Backend — `CobranzasService.registrarCobranza`** en `ventas-cobranza/`: reparto del pago
   (nota elegida → otras notas → saldo a favor), filas `cobranza_abono`, status de `venta_nota`,
   movimiento de saldo a favor. Proyección `tipo: "cobranza"` en el despachador (patrón de T-40:
   archivo propio `despacho-cobranza.ts`).
2. **Backend — venta de contado:** `VentasService.registrarVenta` crea su `cobranza_abono` de origen
   `venta_contado` (D2).
3. **Migración** `supabase/migrations/20260914160000_cobranza_saldo_favor.sql`: columnas nuevas en
   `cobranza_abono`, tabla `saldo_favor_movimiento`, restricciones; pgTAP.
4. **Contrato de sincronización (aditivo, sigue en v1):** forma de `datos` de `cobranza`; código de
   rechazo `nota-no-encontrada`; `pull` con saldo derivado, abonos por nota, saldo a favor por
   cliente y notas que dejaron de estar pendientes.
5. **Tablet:** migración local 007 (nació como 005; se renumeró al traer `main`, cuya
   `005-prospecto-campos-opcionales` reconstruye `cliente` sin `saldo_favor_centavos`),
   repositorio de cobranzas con folio en la misma transacción y
   reparto local, fuente de operaciones, pantalla `cobranza.tsx` (captura → revisión → grabada),
   paso "¿Cobrar notas pendientes?" al grabar una venta, cobranzas en "registros por subir".
6. **Supabase:** cada migración nueva se aplica al Postgres local; a `sinmex dev` sube **solo al
   mergear el PR**, con el pre-flight de solo lectura corrido en ese momento (D17, enmendado).
7. **Pruebas:** pgTAP, unitarias de reparto y validación (backend y tablet), e2e de `push`/`pull`,
   pruebas de la capa de datos de la tablet; migración de las pruebas que usan `cobranza` como sobre
   genérico.

### Fuera, a propósito

| Qué | Por qué |
|---|---|
| Modificar o eliminar una venta que ya tiene abonos | T-17 (portal). |
| Eliminar una cobranza con autorización del administrador | T-34 (peticiones). |
| Pantalla de cobranza del portal y **usar** el saldo a favor | T-21 y siguientes; T-20 solo lo crea y lo muestra (D5). |
| Marcar "cuenta perdida" | Solo portal (D4). |
| Corte de caja y tesorería | T-33 / T-28–T-29: consumen lo que T-20 deja (D3, D6). |
| Prueba de pantalla en tablet física | No hay aparato; typecheck, lint, bundle y pruebas de datos. |

## Decisiones

### Decididas con Mario (2026-09-14)

#### D1 — Cada cobro elige UNA nota; el excedente se reparte

El vendedor elige una nota y captura el monto. El servidor aplica, en este orden:
1. a la nota elegida, hasta su saldo;
2. si sobra, a las **otras notas pendientes/abonadas del mismo cliente, de la más vieja a la más
   nueva** (`fecha` asc, `folio` asc), hasta sus saldos;
3. si aún sobra, a **saldo a favor** del cliente, visible en su ficha; usarlo es del portal (D5).

Un abono **mayor al saldo se acepta** (Mario). No existe `monto-excede-saldo`.

#### D2 — Una venta de contado deja su cobro, distinguible

Al proyectar una venta `contado` con monto > 0, `registrarVenta` crea una fila `cobranza_abono`
por el total: `tipo = 'cobranza'`, `metodo_pago = 'efectivo'`, `saldo_pendiente = 0`, mismo folio y
fecha que la venta, **`origen = 'venta_contado'`**. Los cobros capturados llevan `origen = 'cobro'`.
Así corte y tesorería suman una sola tabla **y pueden desglosar** (pedido de Mario). Cierra D5 de
T-16. Una venta de monto 0 (promoción) no deja cobro.

#### D3 — El efectivo cuenta en el corte del día en que se captura

`cobranza_abono` gana `fecha_operacion` (la del sobre, tal cual llegó; nunca de UTC). La
`fecha_pago` es informativa. T-33 sumará por `fecha_operacion`.

#### D4 — Lo que decide el vendedor en la tablet

- **Método de pago:** efectivo (default), transferencia o cheque (catálogo confirmado del vault).
- **Fecha de pago:** hoy por default; puede ser pasada, entre la fecha de la nota y hoy.
- **No** marca cuenta perdida (portal) ni registra a otro cobrador: el cobrador es siempre el
  vendedor con sesión (`cobranza_abono.vendedor_id`).

#### D5 — Saldo a favor: se crea y se muestra; usarlo es de otro ticket

Tabla `saldo_favor_movimiento` (libro de movimientos; el saldo del cliente es la suma de sus
movimientos vivos). T-20 solo escribe movimientos positivos de origen `excedente_cobro`. El `pull`
manda `saldo_favor_centavos` por cliente y la ficha lo muestra.

#### D6 — Consignación: paso aparte al terminar la venta

En el paso "grabada" de `venta.tsx`, si el cliente tiene notas pendientes, aparece una acción
neutra **"Cobrar notas pendientes (N)"** que lleva a `cobranza.tsx` del mismo cliente. La acción
primaria sigue siendo "Volver al cliente" (una primaria por paso).

### Reglas de negocio (controlador, a validar en la revisión)

#### D7 — La verdad del saldo es derivada

`saldo(nota) = monto_total − Σ monto de sus cobranza_abono vivos` (regla de `Status de venta`),
calculado por el servidor. `cobranza_abono.saldo_pendiente` guarda la **foto** del saldo tras esa
fila; nunca se lee como fuente (el `pull` deja de leerlo, D12).

#### D8 — Status resultante

Tras aplicar: saldo 0 → `pagada`; 0 < saldo < monto_total → `abonado`; saldo = monto_total →
sin cambio. Solo notas en `pendiente`/`abonado` reciben excedente. `tipo` de cada fila: `cobranza`
si deja la nota en saldo 0, `abono` si no.

#### D9 — Nota ya pagada o de cuenta perdida en el servidor: no se rechaza

Si la nota elegida existe y es de un cliente de la sucursal del vendedor, pero ya está `pagada`,
`cuenta_perdida`, `promocion` o borrada (otro dispositivo o el portal la cerró mientras la tablet
estaba sin red), su saldo aplicable es 0 y **todo el monto pasa a D1 pasos 2–3**. El dinero sí se
cobró; rechazarlo lo perdería. Dos tablets que liquidan la misma nota sin red → la segunda deja
saldo a favor.

#### D10 — Único rechazo de dominio: `nota-no-encontrada`

Cuando `venta_nota_id` no existe, su cliente no es de la sucursal del vendedor, o no coincide con el
`cliente_id` del sobre. Una cobranza sobre una venta aún no proyectada (su lote falló o no ha
subido) se rechaza así y se reenvía en cada sync hasta que la venta entre (D15).

#### D11 — Folio propio

La cobranza lleva folio emitido en la tablet con `folios.emitir()` **dentro de la transacción que la
graba** (ADR-0001: "cada operación (venta/cobranza) necesita un identificador único y legible";
T-14). Su unicidad global vive en `sync_operacion.folio`. En `cobranza_abono.folio` se repite en
todas las filas que genera un mismo cobro (no es `unique` en esa tabla). Consume números del mismo
tope de 99 por vendedor y día.

### Backend

#### D12 — `pull`

- `notasPendientes`: `saldo_centavos` pasa a ser **derivado** (`monto_total − Σ abonos vivos`), y
  cada nota trae `abonos: { fecha_pago, monto_centavos, metodo_pago }[]` (vivos, por fecha).
- Con `desde` no nulo, también baja las notas **cambiadas desde `desde` que ya no están
  pendiente/abonado** (pagadas, de cuenta perdida) con `activo: false`, para que la tablet deje de
  mostrarlas (hoy se quedan para siempre).
- `ClientePull` gana `saldo_favor_centavos`.
- Para que el cursor incremental vea los cambios, **`registrarCobranza` toca `updated_at` de cada
  `venta_nota` que afecta** (aunque el status no cambie) y del `cliente` cuando crea un movimiento
  de saldo a favor.

#### D13 — `push`

`tipo: "cobranza"` entra al despachador con `despacho-cobranza.ts` (`prepararCobranza`,
`CODIGO_POR_RAZON_COBRANZA`), `case` propio en `aplicar` →
`CobranzasService.registrarCobranza(cobranza, contexto, trx)` + `marcarProyectada({ tabla:
'cobranza_abono', id })` con la **primera** fila creada. Todo en la transacción por operación de
T-16, con su reintento ante deadlock. Las notas del cliente se bloquean `for update` en orden de
`id` antes de repartir, para que dos cobros concurrentes del mismo cliente no repartan el mismo saldo.

`contexto` igual que el de venta: `{ sucursalId, fechaOperacion, vendedorId, folio, usuarioId }`
(`vendedorId` obligatorio; `folio`/`usuarioId` nulos según la puerta, para el portal de T-21).

#### D14 — Forma de `datos`

```ts
type MetodoPago = 'efectivo' | 'transferencia' | 'cheque';
type DatosCobranza = {
  venta_nota_id: string;      // uuid
  monto_centavos: number;     // entero 1..999_999_999_999
  metodo_pago: MetodoPago;
  fecha_pago: string;         // AAAA-MM-DD, <= fecha_operacion
};
```

`cliente_id` y `folio` obligatorios en el sobre. Forma inválida → `datos-invalidos`. Los tipos van
duplicados en backend, tablet y `docs/` en el mismo commit.

### Tablet

#### D15 — Repositorio y fuente

Migración local 007: tabla `cobranza` (id = clave, `fecha`, `cliente_id`, `vendedor_id`,
`sucursal_id`, `folio` unique, `venta_nota_id`, `monto_centavos`, `metodo_pago`, `fecha_pago`,
`grabada_en`, `sync_estado`, `sync_error`, `sincronizado_en`); `nota_pendiente.abonos_json`
(texto JSON, default `'[]'`); `cliente.saldo_favor_centavos` (default 0).

`crearRepositorioCobranzas`: `registrar` valida (monto entero > 0 y ≤ tope, método, fecha de pago en
[fecha de la nota, hoy]), emite folio y graba en `enTransaccion`, y **en la misma transacción
aplica el reparto local** con la misma función pura que el servidor (duplicada, D1): descuenta
`nota_pendiente.saldo_centavos`, pone `status = 'abonado'` o `activo = 0` si queda en 0, suma el
excedente a `cliente.saldo_favor_centavos`. El siguiente `pull` pisa con la verdad del servidor.
`fuenteCobranzas` se registra **después** de ventas (orden de fuentes: jornadas, ventas,
cobranzas). Rechazadas se reenvían en cada sync (patrón D19 de T-16).

#### D16 — Pantalla `cobranza.tsx`

Captura → revisión → grabada, mismo sistema de diseño que `venta.tsx`:
- **Captura:** notas del cliente con folio, # nota, fecha, total, saldo y abonos previos; saldo a
  favor del cliente; al elegir una nota: monto (con "Liquidar" que llena el saldo), método (efectivo
  por default) y fecha de pago (hoy por default).
- **Revisión:** muestra el reparto previsto (nota elegida, otras notas, saldo a favor) antes de
  grabar; acción primaria "Grabar cobro", neutra "Corregir".
- **Grabada:** folio en grande; "Volver al cliente".
- Bloque **"Cobros de hoy"** con su estado de sincronización.
- Contadores de "registros por subir" (menú de jornada y cerrar día) suman cobranzas pendientes.

### Supabase

#### D17 — Migraciones a `sinmex dev` solo al mergear el PR (Mario)

**Enmienda del 2026-09-18.** La redacción original decía que cada migración subía a `sinmex dev`
en cuanto pasaran sus pruebas, aunque su PR siguiera abierto. Mario decidió lo contrario y así
quedó en `CLAUDE.md` (PR #91, ya mergeado): la nube refleja `main`, así que la migración sube
**solo al mergear el PR**, y la sube Roberto.

Cada migración nueva: `migration up --local` → pgTAP y e2e verdes → el PR se abre con su
**pre-flight de solo lectura anotado** (consultas que prueban que las restricciones nuevas no
fallan con las filas existentes) → al mergear, correr ese pre-flight y luego `supabase db push` a
`sinmex dev` con `--db-url "$SINMEX_DEV_DB_URL"` (no hace falta `supabase link`), anotando la
lista de `migration list` antes y después, como detalla `CLAUDE.md`.

Motivo del cambio: empujar la migración de un PR abierto deja la nube con un esquema que no existe
en `main`; si la revisión cambia esa migración hace falta una correctiva, porque una ya empujada
nunca se edita.

## Modelo de datos

### Postgres — `20260914160000_cobranza_saldo_favor.sql`

```sql
alter table cobranza_abono
  add column folio text,
  add column origen text not null default 'cobro'
    check (origen in ('venta_contado', 'cobro')),
  add column fecha_operacion date;

-- Filas previas (si las hay en un entorno compartido): su fecha de operacion es la de pago.
update cobranza_abono set fecha_operacion = fecha_pago where fecha_operacion is null;

alter table cobranza_abono
  alter column fecha_operacion set not null,
  add constraint ck_cobranza_abono_monto_positivo check (monto > 0),
  add constraint ck_cobranza_abono_saldo_no_negativo check (saldo_pendiente >= 0);

create index idx_cobranza_abono_nota on cobranza_abono (venta_nota_id) where deleted_at is null;
create index idx_cobranza_abono_folio on cobranza_abono (folio);

create table saldo_favor_movimiento (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  cliente_id      uuid not null references cliente(id),
  vendedor_id     uuid references vendedor(id),
  monto           numeric(12,2) not null check (monto <> 0),
  origen          text not null check (origen in ('excedente_cobro')),
  folio           text,
  fecha_operacion date not null
);
create index idx_saldo_favor_cliente on saldo_favor_movimiento (cliente_id) where deleted_at is null;
create trigger trg_saldo_favor_movimiento_updated before update on saldo_favor_movimiento
  for each row execute function set_updated_at();
```

Pre-flight en `sinmex dev` antes del push: `select count(*) from cobranza_abono where monto <= 0 or
saldo_pendiente < 0;` → 0.

### Tablet — migración local 007

Tabla `cobranza`, columnas `nota_pendiente.abonos_json` y `cliente.saldo_favor_centavos` (D15).

## Pruebas

| Capa | Qué se prueba |
|---|---|
| pgTAP | columnas y checks nuevos; `saldo_favor_movimiento` y su FK; backfill de `fecha_operacion` |
| Unit backend | reparto (nota elegida, excedente a otras en orden, saldo a favor, nota con saldo 0, monto exacto); status y `tipo` resultantes; `normalizarDatosCobranza`; `prepararCobranza`; `registrarCobranza` con repositorio simulado; contado en `registrarVenta` |
| E2E | abono parcial → `abonado`; liquidación → `pagada`; excedente a otra nota y a saldo a favor; nota ya pagada → todo excedente; `nota-no-encontrada` (inexistente, otra sucursal, cliente distinto) no deja fila; reenvío → `duplicada`; cobranza en el lote siguiente a su venta; venta contado crea su cobro `venta_contado`; `pull`: saldo derivado, `abonos`, `saldo_favor_centavos`, nota liquidada baja `activo: false` en incremental |
| Tablet | migración 007; reparto local igual al del servidor (casos compartidos); `registrar` sin quemar folio; validaciones; `fuenteCobranzas`; `guardarSnapshot` con `abonos_json` y saldo a favor |
| Migración de pruebas | `sincronizacion.e2e-spec.ts:~1041` (smoke de 6 tipos con `datos` ad hoc) → `cobranzaValida()`; `despacho.spec.ts:38-48` saca `cobranza` del `it.each`; fixture que inserta `cobranza_abono` directo gana `fecha_operacion` |

## Plan de tareas (orientativo; el plan lo fija)

1. Migración + pgTAP + `db:types` + push local y a `sinmex dev` (con pre-flight) — `haiku`/`sonnet`
2. Reparto y status puros (backend) — `haiku`
3. `normalizarDatosCobranza` — `sonnet`
4. Contrato (backend, tablet, docs §6) — `haiku`
5. `CobranzasRepository` + `CobranzasService` + contado en `registrarVenta` — `sonnet` (revisor `opus`)
6. Despacho + `aplicar` + migración de pruebas genéricas + e2e base — `opus`
7. `pull` (saldo derivado, abonos, saldo a favor, notas cerradas) + e2e — `sonnet` (revisor `opus`)
8. E2E de reglas de cobranza — `sonnet`
9. Tablet migración 007 + tipos + `guardarSnapshot` — `sonnet`
10. Tablet reparto puro + validación — `haiku`
11. Tablet repositorio de cobranzas — `sonnet`
12. `fuenteCobranzas` + contadores — `haiku`
13. Pantalla `cobranza.tsx` + paso de consignación en `venta.tsx` — `sonnet`
14. Cierre: verificación, docs §7/§9, vault — `sonnet`

Revisión final de rama: `opus` (o `fable`).

## Riesgos

- **Rama apilada sobre un PR abierto:** cambios pedidos en #89 obligan a rebasar (y T-40 también
  toca `despacho.ts`/`aplicar`; orden acordado con esa sesión).
- **Migraciones empujadas a `sinmex dev` antes del merge:** descartado por la enmienda de D17;
  la nube refleja `main` y la migración sube al mergear.
- **Reparto duplicado en tablet y servidor:** si divergen, el saldo local parpadea hasta el pull;
  se mitiga con casos de prueba idénticos en los dos lados.
- **Tope de 99 folios por día** ahora compartido entre ventas y cobranzas.

## Después del merge

- Vault: `Cobranza-Abono` (folio, origen, fecha_operacion, saldo derivado, saldo a favor),
  `Status de venta`, `Ventas y Cobranza` (consignación resuelta), ADR-0009 (fila `cobranza`
  implementada), `Estado del proyecto`, bitácora.
- `docs/contrato-sincronizacion.md` §6/§7/§9.

# T-29 · Tesorería: depósitos, retiros, traspasos y cobranza automática — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la oficina registre depósitos, retiros y traspasos entre cuentas de Tesorería, y que la cobranza (portal,
tablet y ventas de contado) sume sola a la cuenta configurada por sucursal y método.

**Architecture:** Dos tablas nuevas (`tesoreria_movimiento`, `tesoreria_destino_cobranza`). La cobranza **no se
copia**: se lee al consultar (`cobro` + `cobranza_abono` de contado) agrupada por día, sucursal y método, y una función
pura resuelve a qué cuenta va. Todo entra al arreglo `movimientos` que `saldoDeCuenta` (T-28) ya recibe. Backend en
`modules/tesoreria/` con servicios y controladores separados por responsabilidad; portal con una pestaña nueva
"Movimientos", una sección de destinos en "Cuentas" y la vista ampliada.

**Tech Stack:** NestJS + Kysely + Postgres local (Supabase), class-validator, Jest (unit + e2e), pgTAP; Next.js 15 +
React 19 + Tailwind, Vitest + Testing Library; Excel con `apps/portal/src/lib/excel/`.

**Spec:** `docs/superpowers/specs/2026-10-19-t29-tesoreria-movimientos-design.md` (léelo antes de empezar cualquier
tarea). Contexto de T-28: `docs/superpowers/specs/2026-10-15-t28-tesoreria-cuentas-saldo-inicial-design.md` y el
bloque "Tesorería (T-28)" de `CLAUDE.md`.

## Global Constraints

- Dinero en la API: **centavos enteros** (`montoCentavos`, `entradasCentavos`…). En la base `numeric(14,2)`. Convertir
  solo con `aCentavos` / `aPesos` de `apps/backend/src/modules/sincronizacion/dinero.ts`. Nunca `x * 100`.
- Monto de un movimiento: entero **> 0** y ≤ `MAX_CENTAVOS_TESORERIA` (de `tesoreria/reglas-saldo.ts`). El tipo dice si
  suma o resta.
- "Hoy" = fecha de **Tijuana** en Postgres (`TesoreriaRepository.hoyEnTijuana()`). Ni movimientos ni `desde` de un
  destino pueden ser futuros.
- Fechas de columnas `date` siempre se leen con `to_char(…, 'YYYY-MM-DD')` (schema.d.ts las tipa como `Timestamp`).
- Cobranza que suma: `cobro` con `origen = 'cobro'` y `deleted_at is null` (monto completo, fecha `fecha_pago`,
  sucursal **del cliente**, método `metodo_pago`) + `cobranza_abono` con `origen = 'venta_contado'`, vivo, de
  `venta_nota` viva (monto, `fecha_pago`, sucursal **de la venta**, `metodo_pago`). **Nunca** `saldo_favor`.
- Destino de la cobranza: el vivo de (sucursal, método) con la **`desde` más reciente ≤ fecha del pago**. Sin destino
  → no suma a ninguna cuenta y aparece en `sinCuenta`.
- Alcance: `resolverAlcance` / `normalizarSucursalPedida` (`modules/sucursales/alcance-sucursal.ts`). Movimientos:
  cuentas **visibles** (su sucursal + generales; un General, todas). Cuenta de otra sucursal o borrada → **404**.
  Cualquiera con `tesoreria.gestionar` usa cuentas generales en movimientos. Destinos: un usuario atado solo configura
  **su** sucursal (otra → 403) y la cuenta destino debe ser de esa sucursal o general (si no → 400).
- Permisos: `tesoreria.gestionar` para movimientos y destinos; `tesoreria.ver` para la vista. **Sin permisos nuevos.**
- Comentario: 1–200 caracteres o `null` (nunca `''`). Todo borrado es baja lógica (`deleted_at`).
- Respuestas camelCase; mensajes al usuario en español con acentos.
- El portal se usa en computadora: las tablas caben desde **1366 px**.
- **No se toca** `apps/tablet`, el contrato de sincronización, ni las pantallas/servicios de Cobranza y Ventas.
- Comandos siempre desde la raíz con `--workspace=…`. pgTAP: `npm run supabase -- test db`. No correr el build del
  portal.

## Review Focus

1. **Cobro borrado con petición (T-34) o venta de contado eliminada/pasada a crédito (T-17)** → deja de sumar sin que
   nadie toque la Tesorería — e2e en Tarea 5.
2. **Aplicar saldo a favor** (cobro `origen = 'saldo_favor'`) → no suma nada a ninguna cuenta — e2e en Tarea 5.
3. **Cambiar el destino del efectivo con `desde` = hoy** → la cobranza de ayer sigue en la cuenta anterior — unitaria en
   Tarea 2 y e2e en Tarea 5.
4. **Usuario de TJ hace un traspaso de "Efectivo TJ" a la cuenta general** → permitido; a una cuenta de MX → 404; un
   usuario de MX que ve la general ve el traspaso con ambos nombres — e2e en Tarea 3.
5. **Eliminar una cuenta que hoy recibe la cobranza** → 409 con el mensaje que nombra sucursal y método; si solo fue
   destino en el pasado, se elimina — e2e en Tarea 4.

---

## Mapa de archivos

**Backend** (`apps/backend/`)
- `supabase/migrations/20261019120000_tesoreria_movimientos.sql`, `supabase/tests/99_tesoreria_movimientos_test.sql` (raíz).
- `src/database/schema.d.ts` — regenerado.
- `src/modules/tesoreria/reglas-destino.ts` + `.spec.ts` — `destinoDe`, tipos de destino y cobranza.
- `src/modules/tesoreria/reglas-saldo.ts` + `.spec.ts` — `movimientosDeSaldo`, `armarVista` ampliada, eventos nuevos.
- `src/modules/tesoreria/dto/movimientos.dto.ts`, `dto/destinos.dto.ts`.
- `src/modules/tesoreria/movimientos.repository.ts`, `movimientos.service.ts`, `movimientos.controller.ts`.
- `src/modules/tesoreria/destinos.repository.ts`, `destinos.service.ts`, `destinos.controller.ts`.
- `src/modules/tesoreria/cobranza-tesoreria.repository.ts` — lectura agrupada de la cobranza.
- `src/modules/tesoreria/tesoreria.service.ts` — `cuentaVisible`, `usuario` público, bloqueo al eliminar, vista.
- `src/modules/tesoreria/tesoreria.module.ts`.
- `test/tesoreria-movimientos.e2e-spec.ts` — e2e nuevas (Tareas 3–5).

**Portal** (`apps/portal/src/`)
- `lib/tesoreria.ts` + `.test.ts` — tipos y llamadas nuevas, descripción de eventos, Excel ampliado.
- `components/tesoreria/pestana-movimientos.tsx`, `formulario-movimiento.tsx` + `pestana-movimientos.test.tsx`.
- `components/tesoreria/seccion-destinos.tsx` + `.test.tsx`; `pestana-cuentas.tsx` (la monta).
- `components/tesoreria/pantalla-tesoreria.tsx` + test (pestaña nueva).
- `components/tesoreria/pestana-vista.tsx` + test (columnas, aviso, eventos).

**Docs:** `CLAUDE.md` (bloque Tesorería).

---

### Tarea 1: Migración, pgTAP y tipos

**Files:**
- Create: `supabase/migrations/20261019120000_tesoreria_movimientos.sql`
- Create: `supabase/tests/99_tesoreria_movimientos_test.sql`
- Modify (regenerado): `apps/backend/src/database/schema.d.ts`

**Interfaces:**
- Produces: tablas `tesoreria_movimiento` (`id, created_at, updated_at, deleted_at, tipo, fecha, monto, cuenta_id,
  cuenta_destino_id, comentario, capturo_usuario_id`) y `tesoreria_destino_cobranza` (`id, created_at, updated_at,
  deleted_at, sucursal_id, metodo, cuenta_id, desde, capturo_usuario_id`); índice único parcial
  `uq_tesoreria_destino_vigencia`; tipos Kysely `TesoreriaMovimiento`, `TesoreriaDestinoCobranza`.

- [ ] **Paso 1: Prueba pgTAP (falla: no existen las tablas)**

`supabase/tests/99_tesoreria_movimientos_test.sql`:

```sql
begin;
select plan(10);

-- T-29: lo que la BASE garantiza de los movimientos y destinos de Tesoreria.
-- Prefijo `ZZ-pgtap-T29`.

select has_table('tesoreria_movimiento', 'existe la tabla de movimientos');
select has_table('tesoreria_destino_cobranza', 'existe la tabla de destinos de la cobranza');

insert into tesoreria_cuenta (nombre) values ('ZZ-pgtap-T29 A'), ('ZZ-pgtap-T29 B');

create temporary table _t29 on commit drop as
select
  (select id from tesoreria_cuenta where nombre = 'ZZ-pgtap-T29 A') as a,
  (select id from tesoreria_cuenta where nombre = 'ZZ-pgtap-T29 B') as b,
  (select id from usuario order by created_at limit 1) as usuario,
  (select id from sucursal where codigo = 'TJ') as tj;

select lives_ok(
  $$insert into tesoreria_movimiento (tipo, fecha, monto, cuenta_id, capturo_usuario_id)
    select 'deposito', date '2026-10-01', 100, a, usuario from _t29$$,
  'un deposito a una cuenta entra');

select throws_ok(
  $$insert into tesoreria_movimiento (tipo, fecha, monto, cuenta_id, capturo_usuario_id)
    select 'retiro', date '2026-10-01', 0, a, usuario from _t29$$,
  '23514', null, 'el monto es mayor que cero');

select throws_ok(
  $$insert into tesoreria_movimiento (tipo, fecha, monto, cuenta_id, capturo_usuario_id)
    select 'traspaso', date '2026-10-01', 10, a, usuario from _t29$$,
  '23514', null, 'un traspaso exige cuenta destino');

select throws_ok(
  $$insert into tesoreria_movimiento (tipo, fecha, monto, cuenta_id, cuenta_destino_id, capturo_usuario_id)
    select 'traspaso', date '2026-10-01', 10, a, a, usuario from _t29$$,
  '23514', null, 'un traspaso no puede ir a la misma cuenta');

select throws_ok(
  $$insert into tesoreria_movimiento (tipo, fecha, monto, cuenta_id, cuenta_destino_id, capturo_usuario_id)
    select 'deposito', date '2026-10-01', 10, a, b, usuario from _t29$$,
  '23514', null, 'solo el traspaso lleva cuenta destino');

select lives_ok(
  $$insert into tesoreria_destino_cobranza (sucursal_id, metodo, cuenta_id, desde, capturo_usuario_id)
    select tj, 'efectivo', a, date '2026-10-01', usuario from _t29$$,
  'un destino de cobranza entra');

select throws_ok(
  $$insert into tesoreria_destino_cobranza (sucursal_id, metodo, cuenta_id, desde, capturo_usuario_id)
    select tj, 'efectivo', b, date '2026-10-01', usuario from _t29$$,
  '23505', null, 'una vigencia viva por sucursal, metodo y desde');

select throws_ok(
  $$insert into tesoreria_destino_cobranza (sucursal_id, metodo, cuenta_id, desde, capturo_usuario_id)
    select tj, 'saldo_favor', a, date '2026-10-02', usuario from _t29$$,
  '23514', null, 'el metodo es efectivo, transferencia o cheque');

select * from finish();
rollback;
```

- [ ] **Paso 2: Correrla y ver que falla**

Run: `npm run supabase -- test db`
Expected: FAIL en `99_tesoreria_movimientos_test.sql` (`relation "tesoreria_movimiento" does not exist`).

- [ ] **Paso 3: Migración**

`supabase/migrations/20261019120000_tesoreria_movimientos.sql`:

```sql
-- T-29: Tesoreria — depositos, retiros y traspasos (registrar operacion) y a que
-- cuenta entra la cobranza. Spec:
-- docs/superpowers/specs/2026-10-19-t29-tesoreria-movimientos-design.md
--
-- La cobranza NO se copia aqui: se lee al consultar de `cobro` y de los
-- `cobranza_abono` de contado. Esta migracion solo guarda los movimientos
-- manuales y la configuracion de destinos (sucursal + metodo -> cuenta, con
-- fecha "desde"). Tablas nuevas y vacias, sin permisos nuevos: sin pre-flight.

create table tesoreria_movimiento (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  tipo               text not null
    constraint ck_tesoreria_movimiento_tipo check (tipo in ('deposito', 'retiro', 'traspaso')),
  fecha              date not null,
  monto              numeric(14,2) not null
    constraint ck_tesoreria_movimiento_monto check (monto > 0),
  cuenta_id          uuid not null references tesoreria_cuenta(id),
  cuenta_destino_id  uuid references tesoreria_cuenta(id),
  comentario         text
    constraint ck_tesoreria_movimiento_comentario
      check (comentario is null or char_length(comentario) between 1 and 200),
  capturo_usuario_id uuid not null references usuario(id),
  constraint ck_tesoreria_movimiento_traspaso check (
    (tipo = 'traspaso') = (cuenta_destino_id is not null)
    and (cuenta_destino_id is null or cuenta_destino_id <> cuenta_id)
  )
);

create index ix_tesoreria_movimiento_fecha
  on tesoreria_movimiento (fecha) where deleted_at is null;

create trigger trg_tesoreria_movimiento_updated before update on tesoreria_movimiento
  for each row execute function set_updated_at();

create table tesoreria_destino_cobranza (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  sucursal_id        uuid not null references sucursal(id),
  metodo             text not null
    constraint ck_tesoreria_destino_metodo check (metodo in ('efectivo', 'transferencia', 'cheque')),
  cuenta_id          uuid not null references tesoreria_cuenta(id),
  desde              date not null,
  capturo_usuario_id uuid not null references usuario(id)
);

create unique index uq_tesoreria_destino_vigencia
  on tesoreria_destino_cobranza (sucursal_id, metodo, desde) where deleted_at is null;

create trigger trg_tesoreria_destino_updated before update on tesoreria_destino_cobranza
  for each row execute function set_updated_at();
```

- [ ] **Paso 4: Aplicar y correr pgTAP**

Run: `npm run supabase -- migration up --local` (si se niega por orden de fechas, `--include-all`; base local)
Run: `npm run supabase -- test db`
Expected: PASS, 10/10 en el archivo nuevo y el resto igual.

- [ ] **Paso 5: Regenerar tipos**

Run: `npm run db:types --workspace=apps/backend`
Expected: `schema.d.ts` gana `TesoreriaMovimiento` y `TesoreriaDestinoCobranza` y sus entradas en `DB`; nada más
cambia.

- [ ] **Paso 6: Commit**

```bash
git add supabase/migrations/20261019120000_tesoreria_movimientos.sql supabase/tests/99_tesoreria_movimientos_test.sql apps/backend/src/database/schema.d.ts
git commit -m "T-29: migración de movimientos y destinos de la cobranza en Tesorería, y pgTAP"
```

---

### Tarea 2: Reglas puras — destinos, movimientos y vista ampliada

**Files:**
- Create: `apps/backend/src/modules/tesoreria/reglas-destino.ts`, `reglas-destino.spec.ts`
- Modify: `apps/backend/src/modules/tesoreria/reglas-saldo.ts`, `reglas-saldo.spec.ts`

**Interfaces:**
- Consumes (T-28, ya existen en `reglas-saldo.ts`): `BaseSaldo`, `MovimientoSaldo`, `CuentaEnAlcance`, `SaldoFijado`,
  `saldoDeCuenta`, `ordenarCuentas`, `esFechaValida`, `MAX_CENTAVOS_TESORERIA`.
- Produces — `reglas-destino.ts`:
  ```ts
  export type MetodoCobranza = 'efectivo' | 'transferencia' | 'cheque';
  export const METODOS_COBRANZA: readonly MetodoCobranza[] = ['efectivo', 'transferencia', 'cheque'];
  export interface DestinoCobranza { id: string; sucursalId: string; sucursalCodigo: string; metodo: MetodoCobranza; cuentaId: string; cuentaNombre: string; desde: string }
  export interface CobranzaDia { fecha: string; sucursalId: string; sucursalCodigo: string; metodo: MetodoCobranza; cantidad: number; montoCentavos: number }
  export function destinoDe(sucursalId: string, metodo: MetodoCobranza, fecha: string, destinos: DestinoCobranza[]): DestinoCobranza | null;
  ```
- Produces — `reglas-saldo.ts` (nuevo y cambiado):
  ```ts
  export type TipoMovimiento = 'deposito' | 'retiro' | 'traspaso';
  export interface MovimientoManual { id: string; tipo: TipoMovimiento; fecha: string; montoCentavos: number; cuentaId: string; cuentaNombre: string; cuentaDestinoId: string | null; cuentaDestinoNombre: string | null; comentario: string | null; capturo: string }
  export function movimientosDeSaldo(manuales: MovimientoManual[], cobranza: CobranzaDia[], destinos: DestinoCobranza[]): { movimientos: MovimientoSaldo[]; sinDestino: CobranzaDia[] };
  // CuentaEnVista gana: entradasCentavos: number; salidasCentavos: number; saldoFijadoEnRango: string | null
  // VistaTesoreria.total gana: entradasCentavos: number; salidasCentavos: number
  // VistaTesoreria gana: sinCuenta: { sucursalCodigo: string; metodo: MetodoCobranza; montoCentavos: number }[]
  export type EventoTesoreria =
    | { tipo: 'saldo-fijado'; id: string; fecha: string; cuentaId: string; cuentaNombre: string; montoCentavos: number; comentario: string | null; capturo: string }
    | { tipo: 'deposito' | 'retiro'; id: string; fecha: string; cuentaId: string; cuentaNombre: string; montoCentavos: number; comentario: string | null; capturo: string }
    | { tipo: 'traspaso'; id: string; fecha: string; cuentaId: string; cuentaNombre: string; cuentaDestinoId: string; cuentaDestinoNombre: string; montoCentavos: number; comentario: string | null; capturo: string }
    | { tipo: 'cobranza'; id: string; fecha: string; cuentaId: string; cuentaNombre: string; sucursalCodigo: string; metodo: MetodoCobranza; cantidad: number; montoCentavos: number };
  export interface ExtrasVista { manuales?: MovimientoManual[]; cobranza?: CobranzaDia[]; destinos?: DestinoCobranza[]; sucursalesEnAlcance?: string[] | null }
  export function armarVista(desde: string, hasta: string, cuentas: CuentaEnAlcance[], saldos: SaldoFijado[], extras?: ExtrasVista): VistaTesoreria;
  ```
  `sucursalesEnAlcance`: códigos de sucursal cuya cobranza sin destino se reporta en `sinCuenta` (`null` o ausente =
  todas). `extras` es opcional: sin él, `armarVista` se comporta como en T-28 más los campos nuevos en 0/`null`/`[]`.

- [ ] **Paso 1: Pruebas de `reglas-destino` (fallan: no existe el módulo)**

`reglas-destino.spec.ts`:

```ts
import { destinoDe, type DestinoCobranza } from './reglas-destino';

const d = (id: string, sucursalId: string, metodo: DestinoCobranza['metodo'], cuentaId: string, desde: string): DestinoCobranza => ({
  id,
  sucursalId,
  sucursalCodigo: sucursalId === 'tj' ? 'TJ' : 'MX',
  metodo,
  cuentaId,
  cuentaNombre: cuentaId,
  desde,
});

describe('destinoDe', () => {
  const destinos = [
    d('1', 'tj', 'efectivo', 'efectivo-tj', '2026-10-01'),
    d('2', 'tj', 'efectivo', 'caja-tj', '2026-10-15'),
    d('3', 'tj', 'transferencia', 'scotia', '2026-10-01'),
    d('4', 'mx', 'efectivo', 'efectivo-mx', '2026-10-01'),
  ];

  it('sin destino para la sucursal y método, o antes de la primera vigencia, es null', () => {
    expect(destinoDe('tj', 'cheque', '2026-10-20', destinos)).toBeNull();
    expect(destinoDe('tj', 'efectivo', '2026-09-30', destinos)).toBeNull();
  });

  it('toma la vigencia más reciente con desde <= fecha', () => {
    expect(destinoDe('tj', 'efectivo', '2026-10-14', destinos)?.cuentaId).toBe('efectivo-tj');
    expect(destinoDe('tj', 'efectivo', '2026-10-15', destinos)?.cuentaId).toBe('caja-tj');
    expect(destinoDe('tj', 'efectivo', '2026-12-01', destinos)?.cuentaId).toBe('caja-tj');
  });

  it('no mezcla sucursales ni métodos', () => {
    expect(destinoDe('mx', 'efectivo', '2026-10-20', destinos)?.cuentaId).toBe('efectivo-mx');
    expect(destinoDe('tj', 'transferencia', '2026-10-20', destinos)?.cuentaId).toBe('scotia');
  });
});
```

- [ ] **Paso 2: Implementar `reglas-destino.ts` y correr**

```ts
/**
 * T-29 — a que cuenta de Tesoreria entra la cobranza. Por sucursal y metodo hay
 * vigencias con fecha "desde"; para un pago se usa la vigente en su fecha. Cambiar
 * el destino es agregar otra vigencia: lo anterior no se mueve (spec §3.3).
 */

export type MetodoCobranza = 'efectivo' | 'transferencia' | 'cheque';

export const METODOS_COBRANZA: readonly MetodoCobranza[] = ['efectivo', 'transferencia', 'cheque'];

export interface DestinoCobranza {
  id: string;
  sucursalId: string;
  sucursalCodigo: string;
  metodo: MetodoCobranza;
  cuentaId: string;
  cuentaNombre: string;
  /** `AAAA-MM-DD`. */
  desde: string;
}

/** La cobranza de un dia, una sucursal y un metodo, ya sumada (cobros + contado). */
export interface CobranzaDia {
  fecha: string;
  sucursalId: string;
  sucursalCodigo: string;
  metodo: MetodoCobranza;
  /** Cuantos pagos (cobros + ventas de contado) forman la suma. */
  cantidad: number;
  montoCentavos: number;
}

/** La vigencia viva de (sucursal, metodo) con la `desde` mas reciente <= `fecha`; si no hay, `null`. */
export function destinoDe(
  sucursalId: string,
  metodo: MetodoCobranza,
  fecha: string,
  destinos: DestinoCobranza[],
): DestinoCobranza | null {
  let elegido: DestinoCobranza | null = null;
  for (const d of destinos) {
    if (d.sucursalId !== sucursalId || d.metodo !== metodo || d.desde > fecha) continue;
    if (elegido === null || d.desde > elegido.desde) elegido = d;
  }
  return elegido;
}
```

Run: `npm test --workspace=apps/backend -- reglas-destino` → PASS.

- [ ] **Paso 3: Pruebas nuevas de `reglas-saldo` (fallan)**

Agregar al final de `reglas-saldo.spec.ts` (los imports nuevos van arriba con los existentes):

```ts
import { movimientosDeSaldo, type MovimientoManual } from './reglas-saldo';
import type { CobranzaDia, DestinoCobranza } from './reglas-destino';

const manual = (
  id: string,
  tipo: MovimientoManual['tipo'],
  fecha: string,
  montoCentavos: number,
  cuentaId: string,
  cuentaDestinoId: string | null = null,
): MovimientoManual => ({
  id,
  tipo,
  fecha,
  montoCentavos,
  cuentaId,
  cuentaNombre: cuentaId === 'a' ? 'Efectivo TJ' : cuentaId === 'b' ? 'ScotiaFiscal' : cuentaId,
  cuentaDestinoId,
  cuentaDestinoNombre: cuentaDestinoId === 'b' ? 'ScotiaFiscal' : cuentaDestinoId,
  comentario: null,
  capturo: 'Ana',
});

const cobranza = (fecha: string, metodo: CobranzaDia['metodo'], montoCentavos: number, cantidad = 1, sucursal = 'tj'): CobranzaDia => ({
  fecha,
  sucursalId: sucursal,
  sucursalCodigo: sucursal === 'tj' ? 'TJ' : 'MX',
  metodo,
  cantidad,
  montoCentavos,
});

const destino = (metodo: DestinoCobranza['metodo'], cuentaId: string, desde: string, sucursal = 'tj'): DestinoCobranza => ({
  id: `${sucursal}-${metodo}-${desde}`,
  sucursalId: sucursal,
  sucursalCodigo: sucursal === 'tj' ? 'TJ' : 'MX',
  metodo,
  cuentaId,
  cuentaNombre: cuentaId === 'a' ? 'Efectivo TJ' : 'ScotiaFiscal',
  desde,
});

describe('movimientosDeSaldo', () => {
  it('depósito suma, retiro resta, traspaso resta en la de salida y suma en la de entrada', () => {
    const { movimientos } = movimientosDeSaldo(
      [
        manual('1', 'deposito', '2026-10-02', 500, 'a'),
        manual('2', 'retiro', '2026-10-03', 200, 'a'),
        manual('3', 'traspaso', '2026-10-04', 300, 'a', 'b'),
      ],
      [],
      [],
    );
    expect(movimientos).toEqual([
      { cuentaId: 'a', fecha: '2026-10-02', montoCentavos: 500 },
      { cuentaId: 'a', fecha: '2026-10-03', montoCentavos: -200 },
      { cuentaId: 'a', fecha: '2026-10-04', montoCentavos: -300 },
      { cuentaId: 'b', fecha: '2026-10-04', montoCentavos: 300 },
    ]);
  });

  it('la cobranza suma a la cuenta destino vigente en su fecha; sin destino va a sinDestino', () => {
    const { movimientos, sinDestino } = movimientosDeSaldo(
      [],
      [cobranza('2026-10-05', 'efectivo', 1000, 3), cobranza('2026-10-05', 'cheque', 700)],
      [destino('efectivo', 'a', '2026-10-01')],
    );
    expect(movimientos).toEqual([{ cuentaId: 'a', fecha: '2026-10-05', montoCentavos: 1000 }]);
    expect(sinDestino).toEqual([cobranza('2026-10-05', 'cheque', 700)]);
  });

  it('un cambio de destino con desde no mueve la cobranza anterior', () => {
    const { movimientos } = movimientosDeSaldo(
      [],
      [cobranza('2026-10-14', 'efectivo', 100), cobranza('2026-10-15', 'efectivo', 200)],
      [destino('efectivo', 'a', '2026-10-01'), destino('efectivo', 'b', '2026-10-15')],
    );
    expect(movimientos).toEqual([
      { cuentaId: 'a', fecha: '2026-10-14', montoCentavos: 100 },
      { cuentaId: 'b', fecha: '2026-10-15', montoCentavos: 200 },
    ]);
  });
});

describe('armarVista con movimientos (T-29)', () => {
  const cuentas: CuentaEnAlcance[] = [
    { id: 'a', nombre: 'Efectivo TJ', sucursalId: 's-tj', sucursalCodigo: 'TJ' },
    { id: 'b', nombre: 'ScotiaFiscal', sucursalId: null, sucursalCodigo: null },
  ];
  const base = [fijado('s1', 'a', '2026-10-01', 100_000), fijado('s2', 'b', '2026-10-01', 500_000)];

  it('entradas, salidas y saldo final con depósito, retiro, traspaso y cobranza', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, base, {
      manuales: [
        manual('m1', 'deposito', '2026-10-03', 5_000, 'a'),
        manual('m2', 'retiro', '2026-10-04', 2_000, 'a'),
        manual('m3', 'traspaso', '2026-10-05', 50_000, 'a', 'b'),
      ],
      cobranza: [cobranza('2026-10-06', 'efectivo', 30_000, 4)],
      destinos: [destino('efectivo', 'a', '2026-10-01')],
    });
    const a = v.cuentas.find((c) => c.id === 'a')!;
    expect(a).toMatchObject({
      saldoInicioCentavos: 100_000,
      entradasCentavos: 35_000,
      salidasCentavos: 52_000,
      saldoFinalCentavos: 83_000,
      saldoFijadoEnRango: null,
    });
    const b = v.cuentas.find((c) => c.id === 'b')!;
    expect(b).toMatchObject({ entradasCentavos: 50_000, salidasCentavos: 0, saldoFinalCentavos: 550_000 });
    expect(v.total).toMatchObject({ entradasCentavos: 85_000, salidasCentavos: 52_000 });
  });

  it('los eventos del rango: manuales y cobranza agrupada, ordenados por fecha', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, base, {
      manuales: [manual('m3', 'traspaso', '2026-10-05', 50_000, 'a', 'b')],
      cobranza: [cobranza('2026-10-03', 'efectivo', 30_000, 4)],
      destinos: [destino('efectivo', 'a', '2026-10-01')],
    });
    expect(v.eventos.map((e) => e.tipo)).toEqual(['cobranza', 'traspaso']);
    expect(v.eventos[0]).toEqual({
      tipo: 'cobranza',
      id: 'cobranza:2026-10-03:a:tj:efectivo',
      fecha: '2026-10-03',
      cuentaId: 'a',
      cuentaNombre: 'Efectivo TJ',
      sucursalCodigo: 'TJ',
      metodo: 'efectivo',
      cantidad: 4,
      montoCentavos: 30_000,
    });
    expect(v.eventos[1]).toMatchObject({ tipo: 'traspaso', cuentaNombre: 'Efectivo TJ', cuentaDestinoNombre: 'ScotiaFiscal' });
  });

  it('un saldo fijado dentro del rango: solo cuentan los movimientos desde él y la fila lo marca', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, [...base, fijado('s3', 'a', '2026-10-10', 70_000)], {
      manuales: [manual('m1', 'deposito', '2026-10-05', 9_000, 'a'), manual('m2', 'deposito', '2026-10-12', 1_000, 'a')],
    });
    expect(v.cuentas.find((c) => c.id === 'a')).toMatchObject({
      saldoInicioCentavos: 100_000,
      entradasCentavos: 1_000,
      saldoFinalCentavos: 71_000,
      saldoFijadoEnRango: '2026-10-10',
    });
  });

  it('cobranza sin destino del rango y de sucursales en alcance va a sinCuenta, sumada por sucursal y método', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, base, {
      cobranza: [
        cobranza('2026-10-03', 'cheque', 700, 1),
        cobranza('2026-10-04', 'cheque', 300, 1),
        cobranza('2026-09-30', 'cheque', 999, 1),
        cobranza('2026-10-04', 'efectivo', 50, 1, 'mx'),
      ],
      destinos: [],
      sucursalesEnAlcance: ['TJ'],
    });
    expect(v.sinCuenta).toEqual([{ sucursalCodigo: 'TJ', metodo: 'cheque', montoCentavos: 1_000 }]);
  });

  it('sin extras, los campos nuevos quedan en cero y vacíos', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, base);
    expect(v.cuentas[0]).toMatchObject({ entradasCentavos: 0, salidasCentavos: 0, saldoFijadoEnRango: null });
    expect(v.sinCuenta).toEqual([]);
    expect(v.total).toMatchObject({ entradasCentavos: 0, salidasCentavos: 0 });
  });
});
```

> Ajusta a `toEqual`/`toMatchObject` existentes de T-28 si alguna prueba vieja de `armarVista` compara la fila de
> cuenta o el objeto `total` completos con `toEqual`: ahora traen campos nuevos. Agrégales
> `entradasCentavos: 0, salidasCentavos: 0, saldoFijadoEnRango: null` (o `entradasCentavos/salidasCentavos: 0` en
> `total`) y `sinCuenta: []` donde corresponda — es el único cambio permitido a pruebas viejas.

Run: `npm test --workspace=apps/backend -- reglas-saldo` → FAIL (no existe `movimientosDeSaldo`).

- [ ] **Paso 4: Implementar en `reglas-saldo.ts`**

Arriba, `import { destinoDe, type CobranzaDia, type DestinoCobranza, type MetodoCobranza } from './reglas-destino';`.

Reemplazar `CuentaEnVista`, `EventoTesoreria` y `VistaTesoreria` por:

```ts
export interface CuentaEnVista {
  id: string;
  nombre: string;
  sucursalCodigo: string | null;
  saldoInicioCentavos: number | null;
  saldoFinalCentavos: number | null;
  /** Movimientos del rango que cuentan para el final (desde el saldo fijado que usa). */
  entradasCentavos: number;
  salidasCentavos: number;
  /** Fecha del saldo fijado que usa el final si cae en (desde, hasta]; si no, null. */
  saldoFijadoEnRango: string | null;
}

export type TipoMovimiento = 'deposito' | 'retiro' | 'traspaso';

export interface MovimientoManual {
  id: string;
  tipo: TipoMovimiento;
  fecha: string;
  /** Siempre positivo: el tipo dice si suma o resta. */
  montoCentavos: number;
  cuentaId: string;
  cuentaNombre: string;
  cuentaDestinoId: string | null;
  cuentaDestinoNombre: string | null;
  comentario: string | null;
  capturo: string;
}

export type EventoTesoreria =
  | {
      tipo: 'saldo-fijado';
      id: string;
      fecha: string;
      cuentaId: string;
      cuentaNombre: string;
      montoCentavos: number;
      comentario: string | null;
      capturo: string;
    }
  | {
      tipo: 'deposito' | 'retiro';
      id: string;
      fecha: string;
      cuentaId: string;
      cuentaNombre: string;
      montoCentavos: number;
      comentario: string | null;
      capturo: string;
    }
  | {
      tipo: 'traspaso';
      id: string;
      fecha: string;
      cuentaId: string;
      cuentaNombre: string;
      cuentaDestinoId: string;
      cuentaDestinoNombre: string;
      montoCentavos: number;
      comentario: string | null;
      capturo: string;
    }
  | {
      tipo: 'cobranza';
      id: string;
      fecha: string;
      cuentaId: string;
      cuentaNombre: string;
      sucursalCodigo: string;
      metodo: MetodoCobranza;
      cantidad: number;
      montoCentavos: number;
    };

export interface VistaTesoreria {
  desde: string;
  hasta: string;
  cuentas: CuentaEnVista[];
  total: {
    saldoInicioCentavos: number;
    saldoFinalCentavos: number;
    cuentasConSaldoInicio: number;
    cuentasConSaldoFinal: number;
    cuentas: number;
    entradasCentavos: number;
    salidasCentavos: number;
  };
  /** Cobranza del rango sin cuenta destino, de las sucursales en alcance. */
  sinCuenta: { sucursalCodigo: string; metodo: MetodoCobranza; montoCentavos: number }[];
  eventos: EventoTesoreria[];
}

export interface ExtrasVista {
  manuales?: MovimientoManual[];
  cobranza?: CobranzaDia[];
  destinos?: DestinoCobranza[];
  /** Codigos de sucursal cuya cobranza sin destino se reporta; null/ausente = todas. */
  sucursalesEnAlcance?: string[] | null;
}
```

Agregar (después de `saldoDeCuenta`):

```ts
/**
 * Convierte movimientos manuales y cobranza en el arreglo que `saldoDeCuenta`
 * suma (spec §3.4): deposito +, retiro −, traspaso − en la de salida y + en la
 * de entrada, cobranza + en la cuenta destino vigente en su fecha.
 */
export function movimientosDeSaldo(
  manuales: MovimientoManual[],
  cobranza: CobranzaDia[],
  destinos: DestinoCobranza[],
): { movimientos: MovimientoSaldo[]; sinDestino: CobranzaDia[] } {
  const movimientos: MovimientoSaldo[] = [];
  for (const m of manuales) {
    if (m.tipo === 'deposito') {
      movimientos.push({ cuentaId: m.cuentaId, fecha: m.fecha, montoCentavos: m.montoCentavos });
    } else if (m.tipo === 'retiro') {
      movimientos.push({ cuentaId: m.cuentaId, fecha: m.fecha, montoCentavos: -m.montoCentavos });
    } else if (m.cuentaDestinoId !== null) {
      movimientos.push({ cuentaId: m.cuentaId, fecha: m.fecha, montoCentavos: -m.montoCentavos });
      movimientos.push({ cuentaId: m.cuentaDestinoId, fecha: m.fecha, montoCentavos: m.montoCentavos });
    }
  }
  const sinDestino: CobranzaDia[] = [];
  for (const c of cobranza) {
    const d = destinoDe(c.sucursalId, c.metodo, c.fecha, destinos);
    if (d === null) sinDestino.push(c);
    else movimientos.push({ cuentaId: d.cuentaId, fecha: c.fecha, montoCentavos: c.montoCentavos });
  }
  return { movimientos, sinDestino };
}

/** El saldo fijado mas reciente con fecha <= `fecha` (la base del calculo), o null. */
function baseDe(cuentaId: string, fecha: string, saldos: BaseSaldo[]): BaseSaldo | null {
  let base: BaseSaldo | null = null;
  for (const s of saldos) {
    if (s.cuentaId !== cuentaId || s.fecha > fecha) continue;
    if (base === null || s.fecha > base.fecha) base = s;
  }
  return base;
}
```

Reemplazar `armarVista` completa por:

```ts
/**
 * La vista de `GET /tesoreria`. `saldos` son los fijados vivos de las cuentas en
 * alcance con fecha <= `hasta`; `extras` trae los movimientos manuales, la
 * cobranza agrupada y los destinos (T-29). Sin `extras` se comporta como T-28.
 */
export function armarVista(
  desde: string,
  hasta: string,
  cuentas: CuentaEnAlcance[],
  saldos: SaldoFijado[],
  extras: ExtrasVista = {},
): VistaTesoreria {
  const manuales = extras.manuales ?? [];
  const cobranza = extras.cobranza ?? [];
  const destinos = extras.destinos ?? [];
  const { movimientos, sinDestino } = movimientosDeSaldo(manuales, cobranza, destinos);

  const filas: CuentaEnVista[] = ordenarCuentas(cuentas).map((c) => {
    const baseFinal = baseDe(c.id, hasta, saldos);
    const corte = baseFinal && baseFinal.fecha > desde ? baseFinal.fecha : desde;
    let entradas = 0;
    let salidas = 0;
    for (const m of movimientos) {
      if (m.cuentaId !== c.id || m.fecha < corte || m.fecha > hasta) continue;
      if (m.montoCentavos >= 0) entradas += m.montoCentavos;
      else salidas += -m.montoCentavos;
    }
    return {
      id: c.id,
      nombre: c.nombre,
      sucursalCodigo: c.sucursalCodigo,
      saldoInicioCentavos: saldoDeCuenta(c.id, desde, 'inicio', saldos, movimientos),
      saldoFinalCentavos: saldoDeCuenta(c.id, hasta, 'final', saldos, movimientos),
      entradasCentavos: entradas,
      salidasCentavos: salidas,
      saldoFijadoEnRango: baseFinal && baseFinal.fecha > desde ? baseFinal.fecha : null,
    };
  });

  const total = {
    saldoInicioCentavos: 0,
    saldoFinalCentavos: 0,
    cuentasConSaldoInicio: 0,
    cuentasConSaldoFinal: 0,
    cuentas: filas.length,
    entradasCentavos: 0,
    salidasCentavos: 0,
  };
  for (const f of filas) {
    if (f.saldoInicioCentavos !== null) {
      total.saldoInicioCentavos += f.saldoInicioCentavos;
      total.cuentasConSaldoInicio += 1;
    }
    if (f.saldoFinalCentavos !== null) {
      total.saldoFinalCentavos += f.saldoFinalCentavos;
      total.cuentasConSaldoFinal += 1;
    }
    total.entradasCentavos += f.entradasCentavos;
    total.salidasCentavos += f.salidasCentavos;
  }

  const enRango = (fecha: string) => fecha >= desde && fecha <= hasta;
  const visibles = new Set(cuentas.map((c) => c.id));

  const sinCuentaMapa = new Map<string, { sucursalCodigo: string; metodo: MetodoCobranza; montoCentavos: number }>();
  for (const c of sinDestino) {
    if (!enRango(c.fecha)) continue;
    if (extras.sucursalesEnAlcance && !extras.sucursalesEnAlcance.includes(c.sucursalCodigo)) continue;
    const clave = `${c.sucursalCodigo}:${c.metodo}`;
    const actual = sinCuentaMapa.get(clave) ?? { sucursalCodigo: c.sucursalCodigo, metodo: c.metodo, montoCentavos: 0 };
    actual.montoCentavos += c.montoCentavos;
    sinCuentaMapa.set(clave, actual);
  }
  const sinCuenta = [...sinCuentaMapa.values()].sort(
    (a, b) => a.sucursalCodigo.localeCompare(b.sucursalCodigo) || a.metodo.localeCompare(b.metodo),
  );

  const eventos: EventoTesoreria[] = [];
  for (const s of saldos) {
    if (!enRango(s.fecha)) continue;
    eventos.push({
      tipo: 'saldo-fijado',
      id: s.id,
      fecha: s.fecha,
      cuentaId: s.cuentaId,
      cuentaNombre: s.cuentaNombre,
      montoCentavos: s.montoCentavos,
      comentario: s.comentario,
      capturo: s.capturo,
    });
  }
  for (const m of manuales) {
    if (!enRango(m.fecha)) continue;
    // Un traspaso se ve si cualquiera de sus dos cuentas esta en alcance (spec §4.2).
    if (!visibles.has(m.cuentaId) && !(m.cuentaDestinoId && visibles.has(m.cuentaDestinoId))) continue;
    if (m.tipo === 'traspaso' && m.cuentaDestinoId !== null && m.cuentaDestinoNombre !== null) {
      eventos.push({
        tipo: 'traspaso',
        id: m.id,
        fecha: m.fecha,
        cuentaId: m.cuentaId,
        cuentaNombre: m.cuentaNombre,
        cuentaDestinoId: m.cuentaDestinoId,
        cuentaDestinoNombre: m.cuentaDestinoNombre,
        montoCentavos: m.montoCentavos,
        comentario: m.comentario,
        capturo: m.capturo,
      });
    } else if (m.tipo === 'deposito' || m.tipo === 'retiro') {
      eventos.push({
        tipo: m.tipo,
        id: m.id,
        fecha: m.fecha,
        cuentaId: m.cuentaId,
        cuentaNombre: m.cuentaNombre,
        montoCentavos: m.montoCentavos,
        comentario: m.comentario,
        capturo: m.capturo,
      });
    }
  }
  for (const c of cobranza) {
    if (!enRango(c.fecha)) continue;
    const d = destinoDe(c.sucursalId, c.metodo, c.fecha, destinos);
    if (d === null || !visibles.has(d.cuentaId)) continue;
    eventos.push({
      tipo: 'cobranza',
      id: `cobranza:${c.fecha}:${d.cuentaId}:${c.sucursalId}:${c.metodo}`,
      fecha: c.fecha,
      cuentaId: d.cuentaId,
      cuentaNombre: d.cuentaNombre,
      sucursalCodigo: c.sucursalCodigo,
      metodo: c.metodo,
      cantidad: c.cantidad,
      montoCentavos: c.montoCentavos,
    });
  }
  eventos.sort(
    (a, b) =>
      a.fecha.localeCompare(b.fecha) ||
      a.cuentaNombre.localeCompare(b.cuentaNombre, 'es', { sensitivity: 'base' }) ||
      a.id.localeCompare(b.id),
  );

  return { desde, hasta, cuentas: filas, total, sinCuenta, eventos };
}
```

> Ojo con el orden esperado en la prueba "los eventos del rango": cobranza del 03 antes que el traspaso del 05.

- [ ] **Paso 5: Correr las pruebas unitarias y el lint**

Run: `npm test --workspace=apps/backend -- reglas` → PASS (reglas-destino y reglas-saldo).
Run: `npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend` → sin errores. Si el build
truena porque `tesoreria.service.ts` arma la vista con la firma vieja, no cambies el servicio todavía: la firma nueva es
compatible (`extras` opcional); si truena por los tipos de `EventoTesoreria` en el servicio o el controlador, corrige
solo el tipo importado.

- [ ] **Paso 6: Commit**

```bash
git add apps/backend/src/modules/tesoreria/reglas-destino.ts apps/backend/src/modules/tesoreria/reglas-destino.spec.ts apps/backend/src/modules/tesoreria/reglas-saldo.ts apps/backend/src/modules/tesoreria/reglas-saldo.spec.ts
git commit -m "T-29: reglas puras — destino de la cobranza por vigencia, movimientos y vista con entradas, salidas y cobranza sin cuenta"
```

---

### Tarea 3: Movimientos manuales — backend y e2e

**Files:**
- Create: `apps/backend/src/modules/tesoreria/dto/movimientos.dto.ts`
- Create: `apps/backend/src/modules/tesoreria/movimientos.repository.ts`
- Create: `apps/backend/src/modules/tesoreria/movimientos.service.ts`
- Create: `apps/backend/src/modules/tesoreria/movimientos.controller.ts`
- Modify: `apps/backend/src/modules/tesoreria/tesoreria.service.ts` (agrega `cuentaVisible`, hace público `usuario`)
- Modify: `apps/backend/src/modules/tesoreria/tesoreria.module.ts`
- Test: `apps/backend/test/tesoreria-movimientos.e2e-spec.ts` (nuevo)

**Interfaces:**
- Consumes: `MovimientoManual`, `TipoMovimiento`, `MAX_CENTAVOS_TESORERIA`, `esFechaValida`, `CuentaEnAlcance` (Tarea 2
  y T-28); `TesoreriaRepository.hoyEnTijuana()`, `listarCuentas(codigo|null)`, `buscarCuenta(id)`;
  `validarRango` (`../estadisticas/reglas-kilometraje`).
- Produces:
  - `TesoreriaService.cuentaVisible(usuarioId, cuentaId): Promise<CuentaEnAlcance>` (404 si no la ve) y
    `TesoreriaService.usuario(usuarioId)` **público**.
  - `MovimientosRepository`: `listar(cuentaIds: string[], desde: string | null, hasta: string): Promise<MovimientoManual[]>`
    (movimientos vivos que tocan alguna de esas cuentas, fecha en `[desde, hasta]`, `desde` null = sin límite inferior;
    más recientes primero), `buscar(id): Promise<MovimientoManual | undefined>`, `crear(datos): Promise<string>`,
    `actualizar(id, cambios): Promise<void>`, `eliminar(id): Promise<void>`.
  - Rutas `GET/POST /tesoreria/movimientos`, `PATCH/DELETE /tesoreria/movimientos/:id` con `tesoreria.gestionar`;
    respuesta = `MovimientoManual` (o `{ id }` al eliminar; lista = `MovimientoManual[]`).

- [ ] **Paso 1: e2e (fallan: 404 en las rutas)**

`apps/backend/test/tesoreria-movimientos.e2e-spec.ts` — el arranque y la limpieza copian el patrón de
`test/tesoreria.e2e-spec.ts` (léelo: `iniciarSesion`, `crearUsuario`, `sembrarCuenta`, `afterAll`). Este archivo
crea además clientes y cobros en las Tareas 4–5; la limpieza ya los contempla.

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import { borrarCobrosDe } from './apoyo-cobros';
import { DB_CONNECTION, type Database } from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';

interface Movimiento {
  id: string;
  tipo: 'deposito' | 'retiro' | 'traspaso';
  fecha: string;
  montoCentavos: number;
  cuentaId: string;
  cuentaNombre: string;
  cuentaDestinoId: string | null;
  cuentaDestinoNombre: string | null;
  comentario: string | null;
  capturo: string;
}

const SUFIJO = `${Date.now()}-${process.pid}`;
const PREFIJO = `ZZ-e2e-t29-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-t29-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-t29-tj-${SUFIJO}`;
const LOGIN_MEXICALI = `e2e-t29-mx-${SUFIJO}`;
const LOGIN_SOLO_VER = `e2e-t29-ver-${SUFIJO}`;

describe('Tesorería — movimientos, destinos y cobranza (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  let idTijuana: string;
  let idMexicali: string;
  let general: string;
  let tijuana: string;
  let mexicali: string;
  let soloVer: string;

  const http = () => request(app.getHttpServer());

  const iniciarSesion = async (login: string): Promise<string> => {
    const res = await http().post('/auth/login').send({ login, password: PASSWORD }).expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const acceso = cookies.find((c) => c.startsWith('jawa_access='));
    if (!acceso) throw new Error('El login no devolvio cookie de acceso.');
    return acceso.split(';')[0];
  };

  const crearUsuario = async (login: string, perfil: string, sucursalId: string | null): Promise<string> => {
    const hash = await app.get(PasswordService).hashear(PASSWORD);
    const { id: perfilId } = await db.selectFrom('perfil').select('id').where('nombre', '=', perfil).executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('usuario')
      .values({ login, nombre: login, password_hash: hash, perfil_id: perfilId, sucursal_id: sucursalId })
      .returning('id')
      .executeTakeFirstOrThrow();
    usuarioIds.push(id);
    return id;
  };

  const sembrarCuenta = async (nombre: string, sucursalId: string | null): Promise<string> => {
    const { id } = await db
      .insertInto('tesoreria_cuenta')
      .values({ nombre: `${PREFIJO} ${nombre}`, sucursal_id: sucursalId })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    idTijuana = (await db.selectFrom('sucursal').select('id').where('codigo', '=', 'TJ').executeTakeFirstOrThrow()).id;
    idMexicali = (await db.selectFrom('sucursal').select('id').where('codigo', '=', 'MX').executeTakeFirstOrThrow()).id;

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', idTijuana);
    await crearUsuario(LOGIN_MEXICALI, 'Administrador General', idMexicali);
    const idSoloVer = await crearUsuario(LOGIN_SOLO_VER, 'Auxiliar Administrativo', null);
    const { id: permisoVer } = await db.selectFrom('permiso').select('id').where('clave', '=', 'tesoreria.ver').executeTakeFirstOrThrow();
    await db.insertInto('usuario_permiso').values({ usuario_id: idSoloVer, permiso_id: permisoVer, habilitado: true }).execute();

    general = await iniciarSesion(LOGIN_GENERAL);
    tijuana = await iniciarSesion(LOGIN_TIJUANA);
    mexicali = await iniciarSesion(LOGIN_MEXICALI);
    soloVer = await iniciarSesion(LOGIN_SOLO_VER);
  });

  afterAll(async () => {
    const cuentas = db.selectFrom('tesoreria_cuenta').select('id').where('nombre', 'like', `${PREFIJO}%`);
    await db.deleteFrom('tesoreria_movimiento').where('cuenta_id', 'in', cuentas).execute();
    await db.deleteFrom('tesoreria_movimiento').where('cuenta_destino_id', 'in', cuentas).execute();
    await db.deleteFrom('tesoreria_destino_cobranza').where('cuenta_id', 'in', cuentas).execute();
    await db.deleteFrom('tesoreria_saldo').where('cuenta_id', 'in', cuentas).execute();
    await db.deleteFrom('tesoreria_cuenta').where('nombre', 'like', `${PREFIJO}%`).execute();
    if (clienteIds.length > 0) {
      await db.deleteFrom('cobranza_abono').where('venta_nota_id', 'in', db.selectFrom('venta_nota').select('id').where('cliente_id', 'in', clienteIds)).execute();
      await borrarCobrosDe(db, clienteIds);
      await db.deleteFrom('venta_nota').where('cliente_id', 'in', clienteIds).execute();
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    if (usuarioIds.length > 0) {
      await db.deleteFrom('usuario_permiso').where('usuario_id', 'in', usuarioIds).execute();
      await db.deleteFrom('sesion_refresh').where('usuario_id', 'in', usuarioIds).execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await app.close();
  });

  describe('movimientos', () => {
    it('depósito, retiro y traspaso: alta con sus nombres y el comentario recortado', async () => {
      const a = await sembrarCuenta('Mov A', idTijuana);
      const b = await sembrarCuenta('Mov B', null);
      const dep = await http().post('/tesoreria/movimientos').set('Cookie', general)
        .send({ tipo: 'deposito', fecha: '2026-10-01', montoCentavos: 150_050, cuentaId: a, comentario: ' Venta de envases ' })
        .expect(201);
      expect(dep.body as Movimiento).toMatchObject({
        tipo: 'deposito', fecha: '2026-10-01', montoCentavos: 150_050, cuentaId: a,
        cuentaNombre: `${PREFIJO} Mov A`, cuentaDestinoId: null, comentario: 'Venta de envases', capturo: LOGIN_GENERAL,
      });
      const tr = await http().post('/tesoreria/movimientos').set('Cookie', general)
        .send({ tipo: 'traspaso', fecha: '2026-10-02', montoCentavos: 100_000, cuentaId: a, cuentaDestinoId: b })
        .expect(201);
      expect(tr.body as Movimiento).toMatchObject({ tipo: 'traspaso', cuentaDestinoId: b, cuentaDestinoNombre: `${PREFIJO} Mov B`, comentario: null });
      await http().post('/tesoreria/movimientos').set('Cookie', general)
        .send({ tipo: 'retiro', fecha: '2026-10-03', montoCentavos: 1, cuentaId: b }).expect(201);
    });

    it('reglas de forma: monto 0, decimales, fecha futura, traspaso sin destino o a la misma cuenta, depósito con destino → 400', async () => {
      const a = await sembrarCuenta('Forma A', idTijuana);
      const b = await sembrarCuenta('Forma B', idTijuana);
      const casos = [
        { tipo: 'deposito', fecha: '2026-10-01', montoCentavos: 0, cuentaId: a },
        { tipo: 'deposito', fecha: '2026-10-01', montoCentavos: 10.5, cuentaId: a },
        { tipo: 'deposito', fecha: '2999-01-01', montoCentavos: 10, cuentaId: a },
        { tipo: 'traspaso', fecha: '2026-10-01', montoCentavos: 10, cuentaId: a },
        { tipo: 'traspaso', fecha: '2026-10-01', montoCentavos: 10, cuentaId: a, cuentaDestinoId: a },
        { tipo: 'deposito', fecha: '2026-10-01', montoCentavos: 10, cuentaId: a, cuentaDestinoId: b },
        { tipo: 'otro', fecha: '2026-10-01', montoCentavos: 10, cuentaId: a },
      ];
      for (const cuerpo of casos) {
        await http().post('/tesoreria/movimientos').set('Cookie', general).send(cuerpo).expect(400);
      }
      const futura = await http().post('/tesoreria/movimientos').set('Cookie', general)
        .send({ tipo: 'deposito', fecha: '2999-01-01', montoCentavos: 10, cuentaId: a }).expect(400);
      expect((futura.body as { message: string }).message).toBe('No se puede registrar un movimiento en una fecha futura.');
    });

    it('Tijuana: traspaso de su efectivo a una general sí; a una cuenta de Mexicali 404', async () => {
      const tj = await sembrarCuenta('Alc TJ', idTijuana);
      const gen = await sembrarCuenta('Alc General', null);
      const mx = await sembrarCuenta('Alc MX', idMexicali);
      await http().post('/tesoreria/movimientos').set('Cookie', tijuana)
        .send({ tipo: 'traspaso', fecha: '2026-10-05', montoCentavos: 5_000, cuentaId: tj, cuentaDestinoId: gen }).expect(201);
      await http().post('/tesoreria/movimientos').set('Cookie', tijuana)
        .send({ tipo: 'traspaso', fecha: '2026-10-05', montoCentavos: 5_000, cuentaId: tj, cuentaDestinoId: mx }).expect(404);
      await http().post('/tesoreria/movimientos').set('Cookie', tijuana)
        .send({ tipo: 'deposito', fecha: '2026-10-05', montoCentavos: 5_000, cuentaId: mx }).expect(404);
    });

    it('Mexicali ve en su lista el traspaso de TJ a la general (toca una cuenta que ve), con ambos nombres', async () => {
      const tj = await sembrarCuenta('Ver TJ', idTijuana);
      const gen = await sembrarCuenta('Ver General', null);
      const { body } = await http().post('/tesoreria/movimientos').set('Cookie', tijuana)
        .send({ tipo: 'traspaso', fecha: '2026-10-06', montoCentavos: 7_000, cuentaId: tj, cuentaDestinoId: gen }).expect(201);
      const lista = await http().get('/tesoreria/movimientos?desde=2026-10-06&hasta=2026-10-06').set('Cookie', mexicali).expect(200);
      const visto = (lista.body as Movimiento[]).find((m) => m.id === (body as Movimiento).id);
      expect(visto).toMatchObject({ cuentaNombre: `${PREFIJO} Ver TJ`, cuentaDestinoNombre: `${PREFIJO} Ver General` });
      // …pero no puede corregirlo ni eliminarlo: no ve la cuenta de salida.
      await http().delete(`/tesoreria/movimientos/${(body as Movimiento).id}`).set('Cookie', mexicali).expect(404);
    });

    it('corregir y eliminar; el tipo no cambia', async () => {
      const a = await sembrarCuenta('Edit A', idTijuana);
      const b = await sembrarCuenta('Edit B', idTijuana);
      const { body } = await http().post('/tesoreria/movimientos').set('Cookie', tijuana)
        .send({ tipo: 'retiro', fecha: '2026-10-07', montoCentavos: 900, cuentaId: a, comentario: 'Gasolina' }).expect(201);
      const id = (body as Movimiento).id;
      const r = await http().patch(`/tesoreria/movimientos/${id}`).set('Cookie', tijuana)
        .send({ montoCentavos: 950, fecha: '2026-10-08', cuentaId: b, comentario: '' }).expect(200);
      expect(r.body as Movimiento).toMatchObject({ tipo: 'retiro', montoCentavos: 950, fecha: '2026-10-08', cuentaId: b, comentario: null });
      await http().patch(`/tesoreria/movimientos/${id}`).set('Cookie', tijuana).send({ tipo: 'deposito' }).expect(400);
      await http().patch(`/tesoreria/movimientos/${id}`).set('Cookie', tijuana).send({}).expect(400);
      await http().delete(`/tesoreria/movimientos/${id}`).set('Cookie', tijuana).expect(200, { id });
      await http().delete(`/tesoreria/movimientos/${id}`).set('Cookie', tijuana).expect(404);
    });

    it('lista del rango: rango obligatorio y máximo un año; sin gestionar es 403', async () => {
      await http().get('/tesoreria/movimientos?desde=2026-10-01').set('Cookie', general).expect(400);
      await http().get('/tesoreria/movimientos?desde=2025-01-01&hasta=2026-10-01').set('Cookie', general).expect(400);
      await http().get('/tesoreria/movimientos?desde=2026-10-01&hasta=2026-10-31').set('Cookie', soloVer).expect(403);
    });
  });
});
```

> `PATCH` con `{ tipo }`: el DTO no tiene `tipo` y `whitelist: true` lo **quitaría** en silencio, dejando un cuerpo
> vacío → el servicio responde 400 "No hay nada que actualizar." — ese es el 400 esperado. No agregues
> `forbidNonWhitelisted` (cambiaría toda la API).

Run: `npm run test:e2e --workspace=apps/backend -- tesoreria-movimientos` → FAIL (404).

- [ ] **Paso 2: DTOs**

`dto/movimientos.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { MAX_CENTAVOS_TESORERIA } from '../reglas-saldo';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MENSAJE_MONTO = 'El monto debe ser mayor a $0 y tener a lo más 2 decimales.';

/** '' y solo espacios -> undefined: el comentario es null o tiene texto. */
const recortarOVacio = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const limpio = value.trim();
  return limpio === '' ? undefined : limpio;
};

export class CrearMovimientoDto {
  @IsIn(['deposito', 'retiro', 'traspaso'], { message: 'El tipo debe ser depósito, retiro o traspaso.' })
  tipo!: 'deposito' | 'retiro' | 'traspaso';

  @Matches(RE_FECHA, { message: 'La fecha debe tener el formato AAAA-MM-DD.' })
  fecha!: string;

  @IsInt({ message: MENSAJE_MONTO })
  @Min(1, { message: MENSAJE_MONTO })
  @Max(MAX_CENTAVOS_TESORERIA, { message: 'El monto es demasiado grande.' })
  montoCentavos!: number;

  @IsUUID(undefined, { message: 'La cuenta no es válida.' })
  cuentaId!: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'La cuenta destino no es válida.' })
  cuentaDestinoId?: string;

  @IsOptional()
  @Transform(recortarOVacio)
  @IsString()
  @MaxLength(200, { message: 'El comentario no puede pasar de 200 caracteres.' })
  comentario?: string;
}

/**
 * Corregir: fecha, monto, cuenta(s) y comentario. El tipo NO se cambia (spec §3.1).
 * `comentario: ''` borra el comentario: por eso aqui no se transforma a
 * undefined sino que el servicio distingue "no vino" de "vino vacio".
 */
export class EditarMovimientoDto {
  @IsOptional()
  @Matches(RE_FECHA, { message: 'La fecha debe tener el formato AAAA-MM-DD.' })
  fecha?: string;

  @IsOptional()
  @IsInt({ message: MENSAJE_MONTO })
  @Min(1, { message: MENSAJE_MONTO })
  @Max(MAX_CENTAVOS_TESORERIA, { message: 'El monto es demasiado grande.' })
  montoCentavos?: number;

  @IsOptional()
  @IsUUID(undefined, { message: 'La cuenta no es válida.' })
  cuentaId?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'La cuenta destino no es válida.' })
  cuentaDestinoId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'El comentario no puede pasar de 200 caracteres.' })
  comentario?: string;
}

export class ListarMovimientosDto {
  @Matches(RE_FECHA, { message: 'La fecha "desde" debe tener el formato AAAA-MM-DD.' })
  desde!: string;

  @Matches(RE_FECHA, { message: 'La fecha "hasta" debe tener el formato AAAA-MM-DD.' })
  hasta!: string;

  @IsOptional()
  @IsString()
  sucursal?: string;
}
```

- [ ] **Paso 3: `TesoreriaService` — `cuentaVisible` y `usuario` público**

En `tesoreria.service.ts`, cambiar `protected async usuario(` por `async usuario(` y agregar, junto a
`cuentaModificable`:

```ts
  /**
   * La cuenta viva que el usuario VE (T-29, movimientos): la de su sucursal o una
   * general; un General, cualquiera. Otra sucursal o borrada -> 404. A diferencia
   * de `cuentaModificable`, una general SI pasa para un usuario atado.
   */
  async cuentaVisible(usuarioId: string, cuentaId: string): Promise<CuentaEnAlcance> {
    const usuario = await this.usuario(usuarioId);
    const cuenta = await this.repo.buscarCuenta(cuentaId);
    if (!cuenta) throw new NotFoundException('No existe esa cuenta.');
    if (usuario.id !== null && cuenta.sucursalId !== null && cuenta.sucursalId !== usuario.id) {
      throw new NotFoundException('No existe esa cuenta.');
    }
    return cuenta;
  }
```

- [ ] **Paso 4: `MovimientosRepository`**

`movimientos.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos, aPesos } from '../sincronizacion/dinero';
import type { MovimientoManual, TipoMovimiento } from './reglas-saldo';

export interface DatosMovimiento {
  tipo: TipoMovimiento;
  fecha: string;
  montoCentavos: number;
  cuentaId: string;
  cuentaDestinoId: string | null;
  comentario: string | null;
}

@Injectable()
export class MovimientosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  private consulta() {
    return this.db
      .selectFrom('tesoreria_movimiento as m')
      .innerJoin('tesoreria_cuenta as c', 'c.id', 'm.cuenta_id')
      .leftJoin('tesoreria_cuenta as d', 'd.id', 'm.cuenta_destino_id')
      .innerJoin('usuario as u', 'u.id', 'm.capturo_usuario_id')
      .select([
        'm.id as id',
        'm.tipo as tipo',
        sql<string>`to_char(m.fecha, 'YYYY-MM-DD')`.as('fecha'),
        'm.monto as monto',
        'm.cuenta_id as cuentaId',
        'c.nombre as cuentaNombre',
        'm.cuenta_destino_id as cuentaDestinoId',
        'd.nombre as cuentaDestinoNombre',
        'm.comentario as comentario',
        'u.nombre as capturo',
      ])
      .where('m.deleted_at', 'is', null);
  }

  private aMovimiento(fila: {
    id: string;
    tipo: string;
    fecha: string;
    monto: string;
    cuentaId: string;
    cuentaNombre: string;
    cuentaDestinoId: string | null;
    cuentaDestinoNombre: string | null;
    comentario: string | null;
    capturo: string;
  }): MovimientoManual {
    const { monto, tipo, ...resto } = fila;
    return { ...resto, tipo: tipo as TipoMovimiento, montoCentavos: aCentavos(monto) };
  }

  /**
   * Vivos que tocan alguna de esas cuentas (como salida o entrada), con fecha en
   * [desde, hasta] (`desde` null = desde siempre). Mas recientes primero.
   */
  async listar(cuentaIds: string[], desde: string | null, hasta: string): Promise<MovimientoManual[]> {
    if (cuentaIds.length === 0) return [];
    let q = this.consulta()
      .where((eb) => eb.or([eb('m.cuenta_id', 'in', cuentaIds), eb('m.cuenta_destino_id', 'in', cuentaIds)]))
      .where('m.fecha', '<=', sql<Date>`${hasta}::date`);
    if (desde !== null) q = q.where('m.fecha', '>=', sql<Date>`${desde}::date`);
    const filas = await q.orderBy('m.fecha', 'desc').orderBy('m.created_at', 'desc').execute();
    return filas.map((f) => this.aMovimiento(f));
  }

  async buscar(id: string): Promise<MovimientoManual | undefined> {
    const fila = await this.consulta().where('m.id', '=', id).executeTakeFirst();
    return fila ? this.aMovimiento(fila) : undefined;
  }

  async crear(datos: DatosMovimiento, usuarioId: string): Promise<string> {
    const { id } = await this.db
      .insertInto('tesoreria_movimiento')
      .values({
        tipo: datos.tipo,
        fecha: datos.fecha,
        monto: aPesos(datos.montoCentavos),
        cuenta_id: datos.cuentaId,
        cuenta_destino_id: datos.cuentaDestinoId,
        comentario: datos.comentario,
        capturo_usuario_id: usuarioId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  }

  async actualizar(id: string, datos: Omit<DatosMovimiento, 'tipo'>): Promise<void> {
    await this.db
      .updateTable('tesoreria_movimiento')
      .set({
        fecha: datos.fecha,
        monto: aPesos(datos.montoCentavos),
        cuenta_id: datos.cuentaId,
        cuenta_destino_id: datos.cuentaDestinoId,
        comentario: datos.comentario,
      })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
  }

  async eliminar(id: string): Promise<void> {
    await this.db
      .updateTable('tesoreria_movimiento')
      .set({ deleted_at: sql`now()` })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
  }
}
```

> Si Kysely no acepta `fecha: string` en `values`/`set` (columna `date` tipada como `Timestamp`), usa
> `sql\`${fecha}::date\`` — mismo criterio que `tesoreria.repository.ts` (`guardarSaldos`).

- [ ] **Paso 5: `MovimientosService`**

`movimientos.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { validarRango } from '../estadisticas/reglas-kilometraje';
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import type { CrearMovimientoDto, EditarMovimientoDto, ListarMovimientosDto } from './dto/movimientos.dto';
import { MovimientosRepository, type DatosMovimiento } from './movimientos.repository';
import { esFechaValida, type MovimientoManual } from './reglas-saldo';
import { TesoreriaRepository } from './tesoreria.repository';
import { TesoreriaService } from './tesoreria.service';

@Injectable()
export class MovimientosService {
  constructor(
    private readonly repo: MovimientosRepository,
    private readonly tesoreriaRepo: TesoreriaRepository,
    private readonly tesoreria: TesoreriaService,
  ) {}

  async listar(usuarioId: string, q: ListarMovimientosDto): Promise<MovimientoManual[]> {
    const error = validarRango(q.desde, q.hasta);
    if (error) throw new BadRequestException(error);
    const cuentas = await this.tesoreria.listarCuentas(usuarioId, normalizarSucursalPedida(q.sucursal));
    return this.repo.listar(cuentas.map((c) => c.id), q.desde, q.hasta);
  }

  async crear(usuarioId: string, dto: CrearMovimientoDto): Promise<MovimientoManual> {
    const datos: DatosMovimiento = {
      tipo: dto.tipo,
      fecha: dto.fecha,
      montoCentavos: dto.montoCentavos,
      cuentaId: dto.cuentaId,
      cuentaDestinoId: dto.cuentaDestinoId ?? null,
      comentario: dto.comentario ?? null,
    };
    await this.validar(usuarioId, datos);
    const id = await this.repo.crear(datos, usuarioId);
    return this.encontrado(id);
  }

  async editar(usuarioId: string, id: string, dto: EditarMovimientoDto): Promise<MovimientoManual> {
    if (
      dto.fecha === undefined &&
      dto.montoCentavos === undefined &&
      dto.cuentaId === undefined &&
      dto.cuentaDestinoId === undefined &&
      dto.comentario === undefined
    ) {
      throw new BadRequestException('No hay nada que actualizar.');
    }
    const actual = await this.modificable(usuarioId, id);
    const comentario = dto.comentario === undefined ? actual.comentario : dto.comentario.trim() || null;
    const datos: DatosMovimiento = {
      tipo: actual.tipo,
      fecha: dto.fecha ?? actual.fecha,
      montoCentavos: dto.montoCentavos ?? actual.montoCentavos,
      cuentaId: dto.cuentaId ?? actual.cuentaId,
      cuentaDestinoId: dto.cuentaDestinoId ?? actual.cuentaDestinoId,
      comentario,
    };
    await this.validar(usuarioId, datos);
    await this.repo.actualizar(id, datos);
    return this.encontrado(id);
  }

  async eliminar(usuarioId: string, id: string): Promise<void> {
    await this.modificable(usuarioId, id);
    await this.repo.eliminar(id);
  }

  /** Vivo y con TODAS sus cuentas visibles para el usuario; si no, 404. */
  private async modificable(usuarioId: string, id: string): Promise<MovimientoManual> {
    const m = await this.repo.buscar(id);
    if (!m) throw new NotFoundException('No existe ese movimiento.');
    await this.tesoreria.cuentaVisible(usuarioId, m.cuentaId).catch(() => {
      throw new NotFoundException('No existe ese movimiento.');
    });
    if (m.cuentaDestinoId !== null) {
      await this.tesoreria.cuentaVisible(usuarioId, m.cuentaDestinoId).catch(() => {
        throw new NotFoundException('No existe ese movimiento.');
      });
    }
    return m;
  }

  /** Forma (spec §3.1) y alcance de las cuentas. */
  private async validar(usuarioId: string, d: DatosMovimiento): Promise<void> {
    if (!esFechaValida(d.fecha)) throw new BadRequestException('La fecha no es válida.');
    if (d.fecha > (await this.tesoreriaRepo.hoyEnTijuana())) {
      throw new BadRequestException('No se puede registrar un movimiento en una fecha futura.');
    }
    if (d.tipo === 'traspaso') {
      if (d.cuentaDestinoId === null) throw new BadRequestException('Elige la cuenta a la que entra el traspaso.');
      if (d.cuentaDestinoId === d.cuentaId) throw new BadRequestException('Un traspaso tiene que ser entre dos cuentas distintas.');
    } else if (d.cuentaDestinoId !== null) {
      throw new BadRequestException('Solo un traspaso lleva cuenta destino.');
    }
    await this.tesoreria.cuentaVisible(usuarioId, d.cuentaId);
    if (d.cuentaDestinoId !== null) await this.tesoreria.cuentaVisible(usuarioId, d.cuentaDestinoId);
  }

  private async encontrado(id: string): Promise<MovimientoManual> {
    const m = await this.repo.buscar(id);
    if (!m) throw new NotFoundException('No existe ese movimiento.');
    return m;
  }
}
```

- [ ] **Paso 6: Controlador y módulo**

`movimientos.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { CrearMovimientoDto, EditarMovimientoDto, ListarMovimientosDto } from './dto/movimientos.dto';
import { MovimientosService } from './movimientos.service';
import type { MovimientoManual } from './reglas-saldo';

// T-29: registrar operacion (depositos, retiros, traspasos). Todo con
// `tesoreria.gestionar`; la vista los muestra con `tesoreria.ver`.
@Controller('tesoreria/movimientos')
export class MovimientosController {
  constructor(private readonly movimientos: MovimientosService) {}

  @Get()
  @RequierePermiso('tesoreria.gestionar')
  listar(@UsuarioActual() usuarioId: string, @Query() q: ListarMovimientosDto): Promise<MovimientoManual[]> {
    return this.movimientos.listar(usuarioId, q);
  }

  @Post()
  @RequierePermiso('tesoreria.gestionar')
  crear(@UsuarioActual() usuarioId: string, @Body() dto: CrearMovimientoDto): Promise<MovimientoManual> {
    return this.movimientos.crear(usuarioId, dto);
  }

  @Patch(':id')
  @RequierePermiso('tesoreria.gestionar')
  editar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarMovimientoDto,
  ): Promise<MovimientoManual> {
    return this.movimientos.editar(usuarioId, id, dto);
  }

  @Delete(':id')
  @RequierePermiso('tesoreria.gestionar')
  async eliminar(@UsuarioActual() usuarioId: string, @Param('id', ParseUUIDPipe) id: string): Promise<{ id: string }> {
    await this.movimientos.eliminar(usuarioId, id);
    return { id };
  }
}
```

`tesoreria.module.ts`: agregar `MovimientosController` a `controllers` y `MovimientosService`,
`MovimientosRepository` a `providers`.

- [ ] **Paso 7: Correr e2e, unitarias, lint y build**

Run: `npm run test:e2e --workspace=apps/backend -- tesoreria` → PASS (los dos archivos: el de T-28 y el nuevo).
Run: `npm test --workspace=apps/backend` → PASS.
Run: `npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend` → sin errores.

- [ ] **Paso 8: Commit**

```bash
git add apps/backend/src/modules/tesoreria apps/backend/test/tesoreria-movimientos.e2e-spec.ts
git commit -m "T-29: depósitos, retiros y traspasos — alta, corrección y baja con alcance por cuentas visibles, y e2e"
```

---

### Tarea 4: Destinos de la cobranza — backend, bloqueo al eliminar cuenta y e2e

**Files:**
- Create: `apps/backend/src/modules/tesoreria/dto/destinos.dto.ts`
- Create: `apps/backend/src/modules/tesoreria/destinos.repository.ts`
- Create: `apps/backend/src/modules/tesoreria/destinos.service.ts`
- Create: `apps/backend/src/modules/tesoreria/destinos.controller.ts`
- Modify: `apps/backend/src/modules/tesoreria/tesoreria.service.ts` (`eliminarCuenta` → 409 si es destino vigente)
- Modify: `apps/backend/src/modules/tesoreria/tesoreria.module.ts`
- Test: `apps/backend/test/tesoreria-movimientos.e2e-spec.ts` (nuevo `describe('destinos')`)

**Interfaces:**
- Consumes: `DestinoCobranza`, `MetodoCobranza`, `METODOS_COBRANZA`, `destinoDe` (Tarea 2); `TesoreriaService.usuario`,
  `TesoreriaRepository.hoyEnTijuana/buscarCuenta`; `resolverAlcance`, `normalizarSucursalPedida`.
- Produces:
  - `DestinosRepository`: `listar(sucursalIds: string[] | null): Promise<DestinoCobranza[]>` (vivos; `null` = todas;
    ordenados por sucursal, método y `desde` desc), `guardar(d: { sucursalId; metodo; cuentaId; desde }, usuarioId): Promise<void>`
    (upsert por `(sucursal_id, metodo, desde)` vivo), `sucursales(codigo: string | null): Promise<{ id: string; codigo: string; nombre: string }[]>`.
  - `DestinosSucursal` (JSON): `{ sucursalId: string; sucursalCodigo: string; sucursalNombre: string; vigentes: Record<MetodoCobranza, DestinoCobranza | null>; historial: DestinoCobranza[] }`.
  - Rutas `GET /tesoreria/destinos?sucursal=` → `DestinosSucursal[]`; `PUT /tesoreria/destinos` → `DestinoCobranza`
    guardado. Ambas `tesoreria.gestionar`.
  - `TesoreriaService.eliminarCuenta`: 409 *"Esta cuenta recibe la cobranza de TJ (efectivo). Cambia ese destino antes
    de eliminarla."* si es destino vigente hoy de algún (sucursal, método) — si son varios, el mensaje nombra el primero
    por código y método.

- [ ] **Paso 1: e2e de destinos (fallan)**

Agregar dentro del `describe` principal de `tesoreria-movimientos.e2e-spec.ts`, después de `describe('movimientos')`:

```ts
  describe('destinos', () => {
    interface Destino { sucursalCodigo: string; metodo: string; cuentaId: string; desde: string }
    interface DestinosSucursal { sucursalCodigo: string; vigentes: Record<string, Destino | null>; historial: Destino[] }

    afterEach(async () => {
      // Los destinos de esta suite se limpian por cuenta en afterAll; aquí no hace falta nada.
    });

    it('un General configura TJ; la vigencia nueva no borra la anterior y la misma desde la corrige', async () => {
      const ef = await sembrarCuenta('Dest Ef TJ', idTijuana);
      const caja = await sembrarCuenta('Dest Caja TJ', idTijuana);
      await http().put('/tesoreria/destinos').set('Cookie', general)
        .send({ sucursalId: idTijuana, metodo: 'cheque', cuentaId: ef, desde: '2019-02-01' }).expect(200);
      await http().put('/tesoreria/destinos').set('Cookie', general)
        .send({ sucursalId: idTijuana, metodo: 'cheque', cuentaId: caja, desde: '2019-02-10' }).expect(200);
      await http().put('/tesoreria/destinos').set('Cookie', general)
        .send({ sucursalId: idTijuana, metodo: 'cheque', cuentaId: ef, desde: '2019-02-10' }).expect(200);
      const r = await http().get('/tesoreria/destinos?sucursal=TJ').set('Cookie', general).expect(200);
      const tj = (r.body as DestinosSucursal[]).find((s) => s.sucursalCodigo === 'TJ')!;
      const cheques = tj.historial.filter((d) => d.metodo === 'cheque' && (d.cuentaId === ef || d.cuentaId === caja));
      expect(cheques.map((d) => [d.desde, d.cuentaId])).toEqual([['2019-02-10', ef], ['2019-02-01', ef]]);
    });

    it('reglas: desde futura 400; método inválido 400; cuenta de otra sucursal 400; cuenta borrada 404', async () => {
      const ef = await sembrarCuenta('Dest Reglas TJ', idTijuana);
      const mx = await sembrarCuenta('Dest Reglas MX', idMexicali);
      await http().put('/tesoreria/destinos').set('Cookie', general)
        .send({ sucursalId: idTijuana, metodo: 'efectivo', cuentaId: ef, desde: '2999-01-01' }).expect(400);
      await http().put('/tesoreria/destinos').set('Cookie', general)
        .send({ sucursalId: idTijuana, metodo: 'saldo_favor', cuentaId: ef, desde: '2019-01-01' }).expect(400);
      const otra = await http().put('/tesoreria/destinos').set('Cookie', general)
        .send({ sucursalId: idTijuana, metodo: 'efectivo', cuentaId: mx, desde: '2019-01-01' }).expect(400);
      expect((otra.body as { message: string }).message).toBe('La cuenta tiene que ser de esa sucursal o general.');
      await db.updateTable('tesoreria_cuenta').set({ deleted_at: new Date() }).where('id', '=', ef).execute();
      await http().put('/tesoreria/destinos').set('Cookie', general)
        .send({ sucursalId: idTijuana, metodo: 'efectivo', cuentaId: ef, desde: '2019-01-01' }).expect(404);
    });

    it('Tijuana configura su sucursal con una cuenta general, pero no Mexicali (403); y solo ve TJ', async () => {
      const gen = await sembrarCuenta('Dest General', null);
      await http().put('/tesoreria/destinos').set('Cookie', tijuana)
        .send({ sucursalId: idTijuana, metodo: 'transferencia', cuentaId: gen, desde: '2019-01-05' }).expect(200);
      await http().put('/tesoreria/destinos').set('Cookie', tijuana)
        .send({ sucursalId: idMexicali, metodo: 'transferencia', cuentaId: gen, desde: '2019-01-05' }).expect(403);
      const r = await http().get('/tesoreria/destinos').set('Cookie', tijuana).expect(200);
      expect((r.body as DestinosSucursal[]).map((s) => s.sucursalCodigo)).toEqual(['TJ']);
    });

    it('eliminar una cuenta que hoy recibe la cobranza: 409; si solo fue destino en el pasado, se elimina', async () => {
      const vieja = await sembrarCuenta('Dest Vieja MX', idMexicali);
      const nueva = await sembrarCuenta('Dest Nueva MX', idMexicali);
      await http().put('/tesoreria/destinos').set('Cookie', general)
        .send({ sucursalId: idMexicali, metodo: 'cheque', cuentaId: vieja, desde: '2019-03-01' }).expect(200);
      const r = await http().delete(`/tesoreria/cuentas/${vieja}`).set('Cookie', general).expect(409);
      expect((r.body as { message: string }).message).toBe(
        'Esta cuenta recibe la cobranza de MX (cheque). Cambia ese destino antes de eliminarla.',
      );
      await http().put('/tesoreria/destinos').set('Cookie', general)
        .send({ sucursalId: idMexicali, metodo: 'cheque', cuentaId: nueva, desde: '2019-03-02' }).expect(200);
      await http().delete(`/tesoreria/cuentas/${vieja}`).set('Cookie', general).expect(200);
    });

    it('sin gestionar, destinos es 403', async () => {
      await http().get('/tesoreria/destinos').set('Cookie', soloVer).expect(403);
    });
  });
```

> Fechas de 2019 a propósito: los destinos de esta suite no deben cambiar a qué cuenta va la cobranza de otras suites
> que corren en paralelo con fechas actuales. **Excepción:** la prueba del 409 depende de que la vigencia sea la de
> hoy, y lo es (2019-03-01 es la más reciente para MX·cheque **dentro de esta suite**). Si la base local tiene otro
> destino MX·cheque con `desde` posterior (no debería), la prueba lo detecta: en ese caso usa un método y sucursal sin
> configurar.

Run: `npm run test:e2e --workspace=apps/backend -- tesoreria-movimientos` → FAIL en `destinos`.

- [ ] **Paso 2: DTO**

`dto/destinos.dto.ts`:

```ts
import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export class GuardarDestinoDto {
  @IsUUID(undefined, { message: 'La sucursal no es válida.' })
  sucursalId!: string;

  @IsIn(['efectivo', 'transferencia', 'cheque'], { message: 'El método debe ser efectivo, transferencia o cheque.' })
  metodo!: 'efectivo' | 'transferencia' | 'cheque';

  @IsUUID(undefined, { message: 'La cuenta no es válida.' })
  cuentaId!: string;

  @Matches(RE_FECHA, { message: 'La fecha "desde" debe tener el formato AAAA-MM-DD.' })
  desde!: string;
}

export class ListarDestinosDto {
  @IsOptional()
  @IsString()
  sucursal?: string;
}
```

- [ ] **Paso 3: `DestinosRepository`**

`destinos.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DestinoCobranza, MetodoCobranza } from './reglas-destino';

@Injectable()
export class DestinosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** Vivos; `sucursalIds` null = todas. Por sucursal, metodo y `desde` (mas reciente primero). */
  async listar(sucursalIds: string[] | null): Promise<DestinoCobranza[]> {
    if (sucursalIds !== null && sucursalIds.length === 0) return [];
    let q = this.db
      .selectFrom('tesoreria_destino_cobranza as t')
      .innerJoin('sucursal as s', 's.id', 't.sucursal_id')
      .innerJoin('tesoreria_cuenta as c', 'c.id', 't.cuenta_id')
      .select([
        't.id as id',
        't.sucursal_id as sucursalId',
        's.codigo as sucursalCodigo',
        't.metodo as metodo',
        't.cuenta_id as cuentaId',
        'c.nombre as cuentaNombre',
        sql<string>`to_char(t.desde, 'YYYY-MM-DD')`.as('desde'),
      ])
      .where('t.deleted_at', 'is', null);
    if (sucursalIds !== null) q = q.where('t.sucursal_id', 'in', sucursalIds);
    const filas = await q.orderBy('s.codigo').orderBy('t.metodo').orderBy('t.desde', 'desc').execute();
    return filas.map((f) => ({ ...f, metodo: f.metodo as MetodoCobranza }));
  }

  /** Agrega una vigencia o corrige la de la misma `desde` (indice parcial uq_tesoreria_destino_vigencia). */
  async guardar(
    d: { sucursalId: string; metodo: MetodoCobranza; cuentaId: string; desde: string },
    usuarioId: string,
  ): Promise<void> {
    await this.db
      .insertInto('tesoreria_destino_cobranza')
      .values({
        sucursal_id: d.sucursalId,
        metodo: d.metodo,
        cuenta_id: d.cuentaId,
        desde: d.desde,
        capturo_usuario_id: usuarioId,
      })
      .onConflict((oc) =>
        oc
          .columns(['sucursal_id', 'metodo', 'desde'])
          .where('deleted_at', 'is', null)
          .doUpdateSet((eb) => ({
            cuenta_id: eb.ref('excluded.cuenta_id'),
            capturo_usuario_id: eb.ref('excluded.capturo_usuario_id'),
          })),
      )
      .execute();
  }

  /** Sucursales (activas o no) en alcance: `codigo` null = todas. */
  async sucursales(codigo: string | null): Promise<{ id: string; codigo: string; nombre: string }[]> {
    let q = this.db.selectFrom('sucursal').select(['id', 'codigo', 'nombre']).where('deleted_at', 'is', null);
    if (codigo !== null) q = q.where('codigo', '=', codigo);
    return q.orderBy('codigo').execute();
  }
}
```

> Si `sucursal` no tiene columna `deleted_at` en `schema.d.ts`, quita ese filtro.

- [ ] **Paso 4: `DestinosService`**

`destinos.service.ts`:

```ts
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { normalizarSucursalPedida, resolverAlcance } from '../sucursales/alcance-sucursal';
import type { GuardarDestinoDto, ListarDestinosDto } from './dto/destinos.dto';
import { DestinosRepository } from './destinos.repository';
import { METODOS_COBRANZA, destinoDe, type DestinoCobranza, type MetodoCobranza } from './reglas-destino';
import { esFechaValida } from './reglas-saldo';
import { TesoreriaRepository } from './tesoreria.repository';
import { TesoreriaService } from './tesoreria.service';

export interface DestinosSucursal {
  sucursalId: string;
  sucursalCodigo: string;
  sucursalNombre: string;
  vigentes: Record<MetodoCobranza, DestinoCobranza | null>;
  historial: DestinoCobranza[];
}

@Injectable()
export class DestinosService {
  constructor(
    private readonly repo: DestinosRepository,
    private readonly tesoreriaRepo: TesoreriaRepository,
    private readonly tesoreria: TesoreriaService,
  ) {}

  async listar(usuarioId: string, q: ListarDestinosDto): Promise<DestinosSucursal[]> {
    const usuario = await this.tesoreria.usuario(usuarioId);
    const alcance = resolverAlcance(usuario.codigo, normalizarSucursalPedida(q.sucursal));
    const sucursales = await this.repo.sucursales(alcance.tipo === 'todas' ? null : alcance.codigo);
    const destinos = await this.repo.listar(sucursales.map((s) => s.id));
    const hoy = await this.tesoreriaRepo.hoyEnTijuana();
    return sucursales.map((s) => {
      const vigentes = Object.fromEntries(
        METODOS_COBRANZA.map((m) => [m, destinoDe(s.id, m, hoy, destinos)]),
      ) as Record<MetodoCobranza, DestinoCobranza | null>;
      return {
        sucursalId: s.id,
        sucursalCodigo: s.codigo,
        sucursalNombre: s.nombre,
        vigentes,
        historial: destinos.filter((d) => d.sucursalId === s.id),
      };
    });
  }

  async guardar(usuarioId: string, dto: GuardarDestinoDto): Promise<DestinoCobranza> {
    if (!esFechaValida(dto.desde)) throw new BadRequestException('La fecha "desde" no es válida.');
    if (dto.desde > (await this.tesoreriaRepo.hoyEnTijuana())) {
      throw new BadRequestException('La fecha "desde" no puede ser futura.');
    }
    const usuario = await this.tesoreria.usuario(usuarioId);
    if (usuario.id !== null && usuario.id !== dto.sucursalId) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }
    const cuenta = await this.tesoreria.cuentaVisible(usuarioId, dto.cuentaId);
    if (cuenta.sucursalId !== null && cuenta.sucursalId !== dto.sucursalId) {
      throw new BadRequestException('La cuenta tiene que ser de esa sucursal o general.');
    }
    try {
      await this.repo.guardar(dto, usuarioId);
    } catch (error) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23503') {
        throw new BadRequestException('La sucursal no existe.');
      }
      throw error;
    }
    const guardado = (await this.repo.listar([dto.sucursalId])).find(
      (d) => d.metodo === dto.metodo && d.desde === dto.desde,
    );
    if (!guardado) throw new BadRequestException('No se pudo guardar el destino.');
    return guardado;
  }
}
```

> Ojo: `cuentaVisible` de un General con una cuenta de **otra** sucursal pasa (la ve); la regla "de esa sucursal o
> general" la impone el `if` siguiente con 400. Para un usuario atado, una cuenta de otra sucursal ya da 404 en
> `cuentaVisible` — orden de errores correcto: primero alcance, luego forma.

- [ ] **Paso 5: Bloqueo al eliminar cuenta**

En `tesoreria.service.ts`: inyectar `DestinosRepository` en el constructor
(`constructor(private readonly repo: TesoreriaRepository, private readonly destinos: DestinosRepository) {}`) — y
actualizar `tesoreria.service.spec.ts` para pasar un segundo argumento (`{ listar: jest.fn().mockResolvedValue([]) }`).
Imports: `METODOS_COBRANZA`, `destinoDe` de `./reglas-destino`. Reemplazar `eliminarCuenta`:

```ts
  async eliminarCuenta(usuarioId: string, id: string): Promise<void> {
    await this.cuentaModificable(usuarioId, id);
    // No se elimina la cuenta que HOY recibe la cobranza de alguna sucursal:
    // el dinero quedaria sin cuenta (spec §3.3). Si solo fue destino en el
    // pasado, si se puede.
    const destinos = await this.destinos.listar(null);
    const hoy = await this.repo.hoyEnTijuana();
    const sucursales = [...new Set(destinos.map((d) => d.sucursalId))];
    for (const sucursalId of sucursales) {
      for (const metodo of METODOS_COBRANZA) {
        const vigente = destinoDe(sucursalId, metodo, hoy, destinos);
        if (vigente?.cuentaId === id) {
          throw new ConflictException(
            `Esta cuenta recibe la cobranza de ${vigente.sucursalCodigo} (${metodo}). Cambia ese destino antes de eliminarla.`,
          );
        }
      }
    }
    await this.repo.eliminarCuenta(id);
  }
```

> `destinos` viene ordenado por código de sucursal y método, así que el primero que se encuentra es el que nombra el
> mensaje.

- [ ] **Paso 6: Controlador y módulo**

`destinos.controller.ts`:

```ts
import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { GuardarDestinoDto, ListarDestinosDto } from './dto/destinos.dto';
import { DestinosService, type DestinosSucursal } from './destinos.service';
import type { DestinoCobranza } from './reglas-destino';

// T-29: a que cuenta entra la cobranza, por sucursal y metodo, con fecha "desde".
@Controller('tesoreria/destinos')
export class DestinosController {
  constructor(private readonly destinos: DestinosService) {}

  @Get()
  @RequierePermiso('tesoreria.gestionar')
  listar(@UsuarioActual() usuarioId: string, @Query() q: ListarDestinosDto): Promise<DestinosSucursal[]> {
    return this.destinos.listar(usuarioId, q);
  }

  @Put()
  @RequierePermiso('tesoreria.gestionar')
  guardar(@UsuarioActual() usuarioId: string, @Body() dto: GuardarDestinoDto): Promise<DestinoCobranza> {
    return this.destinos.guardar(usuarioId, dto);
  }
}
```

`tesoreria.module.ts`: agregar `DestinosController`, `DestinosService`, `DestinosRepository`.

- [ ] **Paso 7: Correr e2e (los dos archivos de Tesorería), unitarias, lint y build**

Run: `npm run test:e2e --workspace=apps/backend -- tesoreria` → PASS.
Run: `npm test --workspace=apps/backend` → PASS.
Run: `npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend` → sin errores.

- [ ] **Paso 8: Commit**

```bash
git add apps/backend/src/modules/tesoreria apps/backend/test/tesoreria-movimientos.e2e-spec.ts
git commit -m "T-29: destinos de la cobranza por sucursal y método con vigencia, y no se elimina la cuenta que hoy los recibe"
```

---

### Tarea 5: La vista con cobranza automática — backend y e2e

**Files:**
- Create: `apps/backend/src/modules/tesoreria/cobranza-tesoreria.repository.ts`
- Modify: `apps/backend/src/modules/tesoreria/tesoreria.service.ts` (`vista`)
- Modify: `apps/backend/src/modules/tesoreria/tesoreria.module.ts`
- Modify: `apps/backend/src/modules/tesoreria/tesoreria.service.spec.ts` (constructor con más argumentos)
- Test: `apps/backend/test/tesoreria-movimientos.e2e-spec.ts` (nuevo `describe('vista con cobranza')`)

**Interfaces:**
- Consumes: `armarVista(desde, hasta, cuentas, saldos, extras)` y `CobranzaDia` (Tarea 2); `MovimientosRepository.listar`
  (Tarea 3); `DestinosRepository.listar` (Tarea 4).
- Produces: `CobranzaTesoreriaRepository.porDia(hasta: string): Promise<CobranzaDia[]>`; `GET /tesoreria` con
  `entradasCentavos`, `salidasCentavos`, `saldoFijadoEnRango`, `total.entradasCentavos/salidasCentavos`, `sinCuenta` y
  eventos nuevos.

- [ ] **Paso 1: e2e de la vista con cobranza (fallan)**

Usa fechas de **marzo de 2019** y una cuenta propia por prueba para no chocar con datos de otras suites. Agregar dentro
del `describe` principal, después de `describe('destinos')`. Arriba del archivo, importar `sembrarCobro` además de
`borrarCobrosDe` desde `./apoyo-cobros`.

```ts
  describe('vista con cobranza', () => {
    interface Vista {
      cuentas: { id: string; saldoInicioCentavos: number | null; saldoFinalCentavos: number | null; entradasCentavos: number; salidasCentavos: number; saldoFijadoEnRango: string | null }[];
      sinCuenta: { sucursalCodigo: string; metodo: string; montoCentavos: number }[];
      eventos: { tipo: string; cuentaId: string; metodo?: string; cantidad?: number; montoCentavos: number; fecha: string }[];
    }

    /** Un cliente propio de la suite en esa sucursal. */
    const sembrarCliente = async (nombre: string, sucursalId: string): Promise<string> => {
      const { id: listaId } = await db.selectFrom('lista_precio').select('id').where('nombre', '=', 'Lista 1').executeTakeFirstOrThrow();
      const { id } = await db
        .insertInto('cliente')
        .values({ nombre: `${PREFIJO} ${nombre}`, domicilio: 'Domicilio', telefono: '000', tipo: 'cliente', lista_precio_id: listaId, sucursal_id: sucursalId })
        .returning('id')
        .executeTakeFirstOrThrow();
      clienteIds.push(id);
      return id;
    };

    /** Una venta de contado viva con su abono de contado (como la deja VentasService). */
    const sembrarContado = async (clienteId: string, sucursalId: string, fecha: string, monto: string, metodo = 'efectivo'): Promise<string> => {
      const { id } = await db
        .insertInto('venta_nota')
        .values({
          folio: `ZZT29${Math.random().toString(36).slice(2, 9)}`.slice(0, 30),
          fecha,
          cliente_id: clienteId,
          vendedor_id: null,
          monto_total: monto,
          num_nota: null,
          contado_credito: 'contado',
          semana: 1,
          mes: 1,
          status: 'pagada',
          sucursal_id: sucursalId,
          origen: 'portal',
          capturo_usuario_id: usuarioIds[0],
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db.insertInto('cobranza_abono').values({
        venta_nota_id: id, fecha_pago: fecha, fecha_operacion: fecha, vendedor_id: null, monto, tipo: 'cobranza',
        saldo_pendiente: '0', metodo_pago: metodo, origen: 'venta_contado', capturo_usuario_id: usuarioIds[0],
      }).execute();
      return id;
    };

    it('cobros y contado suman a la cuenta destino; saldo a favor no; un cobro borrado deja de sumar', async () => {
      const cuenta = await sembrarCuenta('Vista Ef TJ', idTijuana);
      await db.insertInto('tesoreria_saldo').values({ cuenta_id: cuenta, fecha: '2019-03-01', monto: '1000.00', capturo_usuario_id: usuarioIds[0] }).execute();
      await http().put('/tesoreria/destinos').set('Cookie', general)
        .send({ sucursalId: idTijuana, metodo: 'efectivo', cuentaId: cuenta, desde: '2019-03-01' }).expect(200);
      const cliente = await sembrarCliente('Cliente vista', idTijuana);
      await sembrarCobro(db, { clienteId: cliente, vendedorId: null, monto: '200.00', fecha: '2019-03-05', metodoPago: 'efectivo' });
      const borrado = await sembrarCobro(db, { clienteId: cliente, vendedorId: null, monto: '50.00', fecha: '2019-03-05', metodoPago: 'efectivo' });
      await db.updateTable('cobro').set({ deleted_at: new Date() }).where('id', '=', borrado).execute();
      await sembrarCobro(db, { clienteId: cliente, vendedorId: null, monto: '75.00', fecha: '2019-03-05', metodoPago: 'saldo_favor' });
      await sembrarContado(cliente, idTijuana, '2019-03-05', '30.00');

      const v = (await http().get('/tesoreria?desde=2019-03-02&hasta=2019-03-31&sucursal=TJ').set('Cookie', soloVer).expect(200)).body as Vista;
      const fila = v.cuentas.find((c) => c.id === cuenta)!;
      expect(fila).toMatchObject({ saldoInicioCentavos: 100_000, entradasCentavos: 23_000, salidasCentavos: 0, saldoFinalCentavos: 123_000 });
      const ev = v.eventos.filter((e) => e.cuentaId === cuenta && e.tipo === 'cobranza');
      expect(ev).toEqual([expect.objectContaining({ fecha: '2019-03-05', metodo: 'efectivo', cantidad: 2, montoCentavos: 23_000 })]);
    });

    it('una venta de contado eliminada deja de sumar', async () => {
      const cuenta = await sembrarCuenta('Vista Contado TJ', idTijuana);
      await db.insertInto('tesoreria_saldo').values({ cuenta_id: cuenta, fecha: '2019-03-01', monto: '0', capturo_usuario_id: usuarioIds[0] }).execute();
      await http().put('/tesoreria/destinos').set('Cookie', general)
        .send({ sucursalId: idTijuana, metodo: 'cheque', cuentaId: cuenta, desde: '2019-03-01' }).expect(200);
      const cliente = await sembrarCliente('Cliente contado', idTijuana);
      const venta = await sembrarContado(cliente, idTijuana, '2019-03-06', '40.00', 'cheque');
      const antes = (await http().get('/tesoreria?desde=2019-03-06&hasta=2019-03-06&sucursal=TJ').set('Cookie', general).expect(200)).body as Vista;
      expect(antes.cuentas.find((c) => c.id === cuenta)?.entradasCentavos).toBe(4_000);
      await db.updateTable('venta_nota').set({ deleted_at: new Date() }).where('id', '=', venta).execute();
      const despues = (await http().get('/tesoreria?desde=2019-03-06&hasta=2019-03-06&sucursal=TJ').set('Cookie', general).expect(200)).body as Vista;
      expect(despues.cuentas.find((c) => c.id === cuenta)?.entradasCentavos).toBe(0);
    });

    it('cambiar el destino con desde no mueve lo anterior', async () => {
      const vieja = await sembrarCuenta('Vista Vieja MX', idMexicali);
      const nueva = await sembrarCuenta('Vista Nueva MX', idMexicali);
      await http().put('/tesoreria/destinos').set('Cookie', general)
        .send({ sucursalId: idMexicali, metodo: 'transferencia', cuentaId: vieja, desde: '2019-03-01' }).expect(200);
      await http().put('/tesoreria/destinos').set('Cookie', general)
        .send({ sucursalId: idMexicali, metodo: 'transferencia', cuentaId: nueva, desde: '2019-03-15' }).expect(200);
      const cliente = await sembrarCliente('Cliente destino', idMexicali);
      await sembrarCobro(db, { clienteId: cliente, vendedorId: null, monto: '10.00', fecha: '2019-03-14', metodoPago: 'transferencia' });
      await sembrarCobro(db, { clienteId: cliente, vendedorId: null, monto: '20.00', fecha: '2019-03-15', metodoPago: 'transferencia' });
      const v = (await http().get('/tesoreria?desde=2019-03-14&hasta=2019-03-15&sucursal=MX').set('Cookie', general).expect(200)).body as Vista;
      expect(v.cuentas.find((c) => c.id === vieja)?.entradasCentavos).toBe(1_000);
      expect(v.cuentas.find((c) => c.id === nueva)?.entradasCentavos).toBe(2_000);
    });

    it('cobranza sin destino sale en sinCuenta de su sucursal y no suma a ninguna cuenta', async () => {
      // MX · efectivo en marzo de 2019 no tiene destino en esta suite.
      const cliente = await sembrarCliente('Cliente sin destino', idMexicali);
      await sembrarCobro(db, { clienteId: cliente, vendedorId: null, monto: '12.34', fecha: '2019-03-20', metodoPago: 'efectivo' });
      const v = (await http().get('/tesoreria?desde=2019-03-20&hasta=2019-03-20&sucursal=MX').set('Cookie', general).expect(200)).body as Vista;
      expect(v.sinCuenta).toEqual(expect.arrayContaining([{ sucursalCodigo: 'MX', metodo: 'efectivo', montoCentavos: 1_234 }]));
      const tj = (await http().get('/tesoreria?desde=2019-03-20&hasta=2019-03-20&sucursal=TJ').set('Cookie', general).expect(200)).body as Vista;
      expect(tj.sinCuenta.some((s) => s.sucursalCodigo === 'MX')).toBe(false);
    });

    it('depósito, retiro y traspaso en la vista: entradas, salidas y marca de saldo fijado en el rango', async () => {
      const a = await sembrarCuenta('Vista Man A', idTijuana);
      const b = await sembrarCuenta('Vista Man B', null);
      await db.insertInto('tesoreria_saldo').values([
        { cuenta_id: a, fecha: '2019-03-01', monto: '100.00', capturo_usuario_id: usuarioIds[0] },
        { cuenta_id: b, fecha: '2019-03-01', monto: '0', capturo_usuario_id: usuarioIds[0] },
        { cuenta_id: a, fecha: '2019-03-25', monto: '500.00', capturo_usuario_id: usuarioIds[0] },
      ]).execute();
      for (const cuerpo of [
        { tipo: 'deposito', fecha: '2019-03-21', montoCentavos: 1_000, cuentaId: a },
        { tipo: 'traspaso', fecha: '2019-03-22', montoCentavos: 3_000, cuentaId: a, cuentaDestinoId: b },
        { tipo: 'retiro', fecha: '2019-03-26', montoCentavos: 500, cuentaId: a },
      ]) {
        await http().post('/tesoreria/movimientos').set('Cookie', general).send(cuerpo).expect(201);
      }
      const v = (await http().get('/tesoreria?desde=2019-03-20&hasta=2019-03-31&sucursal=TJ').set('Cookie', general).expect(200)).body as Vista;
      expect(v.cuentas.find((c) => c.id === a)).toMatchObject({
        saldoInicioCentavos: 10_000, entradasCentavos: 0, salidasCentavos: 500, saldoFinalCentavos: 49_500, saldoFijadoEnRango: '2019-03-25',
      });
      expect(v.cuentas.find((c) => c.id === b)).toMatchObject({ entradasCentavos: 3_000, saldoFinalCentavos: 3_000 });
      expect(v.eventos.filter((e) => e.cuentaId === a).map((e) => e.tipo)).toEqual(['deposito', 'traspaso', 'saldo-fijado', 'retiro']);
    });
  });
```

> El saldo a favor de 75.00 no suma: `sembrarCobro` con método `saldo_favor` crea un cobro de **origen**
> `saldo_favor`, que la consulta excluye.

Run: `npm run test:e2e --workspace=apps/backend -- tesoreria-movimientos` → FAIL en `vista con cobranza`.

- [ ] **Paso 2: `CobranzaTesoreriaRepository`**

`cobranza-tesoreria.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos } from '../sincronizacion/dinero';
import type { CobranzaDia, MetodoCobranza } from './reglas-destino';

/**
 * T-29 (spec §3.2): la cobranza que entra a Tesoreria, LEIDA (no copiada) de las
 * tablas de Ventas y Cobranza, agrupada por dia de pago, sucursal y metodo.
 *   - `cobro` vivo de origen 'cobro' (tablet o portal), sucursal del CLIENTE.
 *   - abono vivo de origen 'venta_contado' de una venta viva, sucursal de la VENTA.
 * Nunca el saldo a favor aplicado (no es dinero nuevo). Un cobro borrado con
 * peticion (T-34) o una venta eliminada/editada (T-17) dejan de contar solos.
 */
@Injectable()
export class CobranzaTesoreriaRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async porDia(hasta: string): Promise<CobranzaDia[]> {
    const r = await sql<{
      fecha: string;
      sucursal_id: string;
      codigo: string;
      metodo: string;
      cantidad: number;
      monto: string;
    }>`
      select fecha, sucursal_id, codigo, metodo, sum(cantidad)::int as cantidad, sum(monto)::text as monto
      from (
        select to_char(c.fecha_pago, 'YYYY-MM-DD') as fecha, cl.sucursal_id, s.codigo, c.metodo_pago as metodo,
               count(*) as cantidad, sum(c.monto) as monto
          from cobro c
          join cliente cl on cl.id = c.cliente_id
          join sucursal s on s.id = cl.sucursal_id
         where c.deleted_at is null
           and c.origen = 'cobro'
           and c.metodo_pago in ('efectivo', 'transferencia', 'cheque')
           and c.fecha_pago <= ${hasta}::date
         group by 1, 2, 3, 4
        union all
        select to_char(a.fecha_pago, 'YYYY-MM-DD'), vn.sucursal_id, s.codigo, a.metodo_pago,
               count(*), sum(a.monto)
          from cobranza_abono a
          join venta_nota vn on vn.id = a.venta_nota_id
          join sucursal s on s.id = vn.sucursal_id
         where a.deleted_at is null
           and vn.deleted_at is null
           and a.origen = 'venta_contado'
           and a.metodo_pago in ('efectivo', 'transferencia', 'cheque')
           and a.fecha_pago <= ${hasta}::date
         group by 1, 2, 3, 4
      ) t
      group by fecha, sucursal_id, codigo, metodo
      order by fecha, codigo, metodo
    `.execute(this.db);
    return r.rows.map((f) => ({
      fecha: f.fecha,
      sucursalId: f.sucursal_id,
      sucursalCodigo: f.codigo,
      metodo: f.metodo as MetodoCobranza,
      cantidad: Number(f.cantidad),
      montoCentavos: aCentavos(f.monto),
    }));
  }
}
```

- [ ] **Paso 3: `TesoreriaService.vista`**

Inyectar en el constructor (además de `repo` y `destinos`): `private readonly movimientos: MovimientosRepository`,
`private readonly cobranza: CobranzaTesoreriaRepository`. Actualizar `tesoreria.service.spec.ts` para pasar dobles de
los cuatro (`{}` basta para los que no usa). Reemplazar `vista`:

```ts
  /**
   * La vista: saldo al inicio y al final por cuenta, entradas y salidas del rango,
   * total, cobranza sin cuenta y eventos (spec §4.2). La cobranza se lee de TODAS
   * las sucursales: una cuenta general puede recibir la de varias. `sinCuenta` solo
   * reporta las sucursales en alcance.
   */
  async vista(usuarioId: string, q: VistaTesoreriaDto): Promise<VistaTesoreria> {
    const error = validarRango(q.desde, q.hasta);
    if (error) throw new BadRequestException(error);
    const alcance = await this.alcanceDe(usuarioId, normalizarSucursalPedida(q.sucursal));
    const codigo = alcance.tipo === 'todas' ? null : alcance.codigo;
    const cuentas = await this.repo.listarCuentas(codigo);
    const ids = cuentas.map((c) => c.id);
    const [saldos, manuales, cobranza, destinos] = await Promise.all([
      this.repo.saldosDeCuentas(ids, q.hasta),
      this.movimientos.listar(ids, null, q.hasta),
      this.cobranza.porDia(q.hasta),
      this.destinos.listar(null),
    ]);
    return armarVista(q.desde, q.hasta, cuentas, saldos, {
      manuales,
      cobranza,
      destinos,
      sucursalesEnAlcance: codigo === null ? null : [codigo],
    });
  }
```

`tesoreria.module.ts`: agregar `CobranzaTesoreriaRepository` a `providers`.

> Riesgo de dependencia circular: `MovimientosService`/`DestinosService` inyectan `TesoreriaService`, y
> `TesoreriaService` inyecta los **repositorios** (no los servicios) — no hay ciclo.

- [ ] **Paso 4: Correr todo el backend**

Run: `npm run test:e2e --workspace=apps/backend -- tesoreria` → PASS (los dos archivos).
Run: `npm test --workspace=apps/backend` → PASS.
Run: `npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend` → sin errores.
Run: `npm run test:e2e --workspace=apps/backend` → PASS completo (comprueba que las e2e de T-28 siguen verdes con la
vista ampliada).

- [ ] **Paso 5: Commit**

```bash
git add apps/backend/src/modules/tesoreria apps/backend/test/tesoreria-movimientos.e2e-spec.ts
git commit -m "T-29: la vista suma la cobranza (cobros y contado, sin saldo a favor) a su cuenta destino, con entradas, salidas y cobranza sin cuenta"
```

---

### Tarea 6: Portal — `lib/tesoreria.ts`

**Files:**
- Modify: `apps/portal/src/lib/tesoreria.ts`
- Modify: `apps/portal/src/lib/tesoreria.test.ts`

**Interfaces:**
- Consumes: JSON de las Tareas 3–5 (mismos nombres de campos).
- Produces (exportado):
  ```ts
  export type MetodoCobranza = "efectivo" | "transferencia" | "cheque";
  export type TipoMovimiento = "deposito" | "retiro" | "traspaso";
  export interface MovimientoManual { id: string; tipo: TipoMovimiento; fecha: string; montoCentavos: number; cuentaId: string; cuentaNombre: string; cuentaDestinoId: string | null; cuentaDestinoNombre: string | null; comentario: string | null; capturo: string }
  export interface DestinoCobranza { id: string; sucursalId: string; sucursalCodigo: string; metodo: MetodoCobranza; cuentaId: string; cuentaNombre: string; desde: string }
  export interface DestinosSucursal { sucursalId: string; sucursalCodigo: string; sucursalNombre: string; vigentes: Record<MetodoCobranza, DestinoCobranza | null>; historial: DestinoCobranza[] }
  // CuentaEnVista gana entradasCentavos, salidasCentavos, saldoFijadoEnRango; VistaTesoreria gana total.entradasCentavos/salidasCentavos y sinCuenta; EventoTesoreria = unión igual al backend.
  export function listarMovimientos(p: { desde: string; hasta: string; sucursal?: string | null }): Promise<MovimientoManual[]>;
  export function crearMovimiento(d: { tipo: TipoMovimiento; fecha: string; montoCentavos: number; cuentaId: string; cuentaDestinoId?: string; comentario?: string }): Promise<MovimientoManual>;
  export function editarMovimiento(id: string, d: { fecha?: string; montoCentavos?: number; cuentaId?: string; cuentaDestinoId?: string; comentario?: string }): Promise<MovimientoManual>;
  export function eliminarMovimiento(id: string): Promise<{ id: string }>;
  export function obtenerDestinos(sucursal?: string | null): Promise<DestinosSucursal[]>;
  export function guardarDestino(d: { sucursalId: string; metodo: MetodoCobranza; cuentaId: string; desde: string }): Promise<DestinoCobranza>;
  export const ETIQUETA_METODO: Record<MetodoCobranza, string>;          // efectivo → "Efectivo"…
  export const ETIQUETA_TIPO: Record<TipoMovimiento, string>;            // deposito → "Depósito"…
  export function describirEvento(e: EventoTesoreria): { concepto: string; cuenta: string; signo: 1 | -1 | 0 };
  export function primerDiaDelMesDe(fecha: string): string;              // "2026-10-19" → "2026-10-01"
  // definicionExcelTesoreria: 7 columnas (Cuenta, Sucursal, Saldo al inicio, Entradas, Salidas, Saldo al final, Comentario),
  // bloque "Cobranza sin cuenta" si hay, bloque "Movimientos del rango".
  ```

- [ ] **Paso 1: Pruebas (fallan)**

Reemplazar en `tesoreria.test.ts` el `describe("definicionExcelTesoreria")` completo y agregar los nuevos. La `vista` de
prueba gana los campos nuevos:

```ts
describe("describirEvento", () => {
  const base = { id: "x", fecha: "2026-10-10", cuentaId: "a", cuentaNombre: "Efectivo TJ" };
  it("arma concepto, cuenta y signo por tipo", () => {
    expect(describirEvento({ ...base, tipo: "deposito", montoCentavos: 1, comentario: null, capturo: "Ana" })).toEqual({ concepto: "Depósito", cuenta: "Efectivo TJ", signo: 1 });
    expect(describirEvento({ ...base, tipo: "retiro", montoCentavos: 1, comentario: null, capturo: "Ana" })).toEqual({ concepto: "Retiro", cuenta: "Efectivo TJ", signo: -1 });
    expect(
      describirEvento({ ...base, tipo: "traspaso", cuentaDestinoId: "b", cuentaDestinoNombre: "ScotiaFiscal", montoCentavos: 1, comentario: null, capturo: "Ana" }),
    ).toEqual({ concepto: "Traspaso", cuenta: "Efectivo TJ → ScotiaFiscal", signo: 0 });
    expect(
      describirEvento({ ...base, tipo: "cobranza", sucursalCodigo: "TJ", metodo: "efectivo", cantidad: 12, montoCentavos: 1 }),
    ).toEqual({ concepto: "Cobranza en efectivo · 12 cobros · TJ", cuenta: "Efectivo TJ", signo: 1 });
    expect(
      describirEvento({ ...base, tipo: "cobranza", sucursalCodigo: "MX", metodo: "cheque", cantidad: 1, montoCentavos: 1 }),
    ).toEqual({ concepto: "Cobranza en cheque · 1 cobro · MX", cuenta: "Efectivo TJ", signo: 1 });
    expect(describirEvento({ ...base, tipo: "saldo-fijado", montoCentavos: 1, comentario: null, capturo: "Ana" })).toEqual({ concepto: "Saldo fijado", cuenta: "Efectivo TJ", signo: 0 });
  });
});

describe("primerDiaDelMesDe", () => {
  it("devuelve el día 1 del mes", () => {
    expect(primerDiaDelMesDe("2026-10-19")).toBe("2026-10-01");
  });
});

describe("llamadas de movimientos y destinos", () => {
  beforeEach(() => apiFetch.mockReset());
  it("listarMovimientos arma la query; guardarDestino hace PUT", async () => {
    apiFetch.mockResolvedValue([]);
    await listarMovimientos({ desde: "2026-10-01", hasta: "2026-10-31", sucursal: null });
    expect(apiFetch).toHaveBeenCalledWith("/tesoreria/movimientos?desde=2026-10-01&hasta=2026-10-31");
    await guardarDestino({ sucursalId: "s", metodo: "efectivo", cuentaId: "a", desde: "2026-10-01" });
    expect(apiFetch).toHaveBeenLastCalledWith("/tesoreria/destinos", {
      method: "PUT",
      body: JSON.stringify({ sucursalId: "s", metodo: "efectivo", cuentaId: "a", desde: "2026-10-01" }),
    });
  });
});

describe("definicionExcelTesoreria", () => {
  const vista: VistaTesoreria = {
    desde: "2026-10-05",
    hasta: "2026-10-12",
    cuentas: [
      { id: "a", nombre: "Efectivo TJ", sucursalCodigo: "TJ", saldoInicioCentavos: 1_000_000, saldoFinalCentavos: 950_000, entradasCentavos: 20_000, salidasCentavos: 70_000, saldoFijadoEnRango: null },
    ],
    total: { saldoInicioCentavos: 1_000_000, saldoFinalCentavos: 950_000, cuentasConSaldoInicio: 1, cuentasConSaldoFinal: 1, cuentas: 1, entradasCentavos: 20_000, salidasCentavos: 70_000 },
    sinCuenta: [{ sucursalCodigo: "MX", metodo: "transferencia", montoCentavos: 325_000 }],
    eventos: [
      { tipo: "cobranza", id: "c", fecha: "2026-10-06", cuentaId: "a", cuentaNombre: "Efectivo TJ", sucursalCodigo: "TJ", metodo: "efectivo", cantidad: 2, montoCentavos: 20_000 },
      { tipo: "retiro", id: "r", fecha: "2026-10-07", cuentaId: "a", cuentaNombre: "Efectivo TJ", montoCentavos: 70_000, comentario: "Banco", capturo: "Ana" },
    ],
  };

  it("una hoja: cuentas con entradas y salidas, total, cobranza sin cuenta y movimientos", () => {
    const def = definicionExcelTesoreria(vista, { sucursal: "TJ" });
    expect(def.columnas.map((c) => c.encabezado)).toEqual([
      "Cuenta", "Sucursal", "Saldo al inicio", "Entradas", "Salidas", "Saldo al final", "Comentario",
    ]);
    expect(def.filas).toEqual([
      { celdas: ["Efectivo TJ", "TJ", 10000, 200, 700, 9500, null] },
      { celdas: ["Total Tesorería", "1 cuentas", 10000, 200, 700, 9500, null], tipo: "total" },
      { celdas: ["Cobranza sin cuenta asignada", null, null, null, null, null, null], tipo: "grupo" },
      { celdas: ["MX · Transferencia", null, null, 3250, null, null, null] },
      { celdas: ["Movimientos del rango", "Fecha", "Concepto", "Entra", "Sale", null, "Comentario"], tipo: "grupo" },
      { celdas: ["Efectivo TJ", "06/10/2026", "Cobranza en efectivo · 2 cobros · TJ", 200, null, null, null] },
      { celdas: ["Efectivo TJ", "07/10/2026", "Retiro", null, 700, null, "Banco · Capturó: Ana"] },
    ]);
  });
});
```

> Los textos `"1 cuentas"` / `"N de M con saldo"` del total se conservan de T-28 (misma lógica). En las filas de
> movimientos: entra (signo 1) va en la columna 3, sale (signo −1) en la 4; traspaso (signo 0) pone el monto en
> "Sale" con la cuenta "A → B"; saldo fijado pone el monto en "Saldo al final" (columna 5).

Run: `npm test --workspace=apps/portal -- tesoreria` → FAIL.

- [ ] **Paso 2: Implementar**

En `lib/tesoreria.ts`:

1. Reemplazar `CuentaEnVista`, `EventoTesoreria` y `VistaTesoreria` por los equivalentes del backend (Tarea 2,
   `reglas-saldo.ts`) con comillas dobles; agregar `MetodoCobranza`, `TipoMovimiento`, `MovimientoManual`,
   `DestinoCobranza`, `DestinosSucursal` (forma de la sección Interfaces de arriba).
2. Llamadas:

```ts
export function listarMovimientos(p: { desde: string; hasta: string; sucursal?: string | null }): Promise<MovimientoManual[]> {
  return apiFetch<MovimientoManual[]>(`/tesoreria/movimientos${query({ desde: p.desde, hasta: p.hasta, sucursal: p.sucursal })}`);
}

export function crearMovimiento(d: {
  tipo: TipoMovimiento;
  fecha: string;
  montoCentavos: number;
  cuentaId: string;
  cuentaDestinoId?: string;
  comentario?: string;
}): Promise<MovimientoManual> {
  return apiFetch<MovimientoManual>("/tesoreria/movimientos", { method: "POST", body: JSON.stringify(d) });
}

export function editarMovimiento(
  id: string,
  d: { fecha?: string; montoCentavos?: number; cuentaId?: string; cuentaDestinoId?: string; comentario?: string },
): Promise<MovimientoManual> {
  return apiFetch<MovimientoManual>(`/tesoreria/movimientos/${id}`, { method: "PATCH", body: JSON.stringify(d) });
}

export function eliminarMovimiento(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/tesoreria/movimientos/${id}`, { method: "DELETE" });
}

export function obtenerDestinos(sucursal?: string | null): Promise<DestinosSucursal[]> {
  return apiFetch<DestinosSucursal[]>(`/tesoreria/destinos${query({ sucursal })}`);
}

export function guardarDestino(d: { sucursalId: string; metodo: MetodoCobranza; cuentaId: string; desde: string }): Promise<DestinoCobranza> {
  return apiFetch<DestinoCobranza>("/tesoreria/destinos", { method: "PUT", body: JSON.stringify(d) });
}

export const ETIQUETA_METODO: Record<MetodoCobranza, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  cheque: "Cheque",
};

export const ETIQUETA_TIPO: Record<TipoMovimiento, string> = {
  deposito: "Depósito",
  retiro: "Retiro",
  traspaso: "Traspaso",
};

/** Concepto y cuenta para la lista y el Excel; `signo`: 1 entra, −1 sale, 0 neutro (traspaso, saldo fijado). */
export function describirEvento(e: EventoTesoreria): { concepto: string; cuenta: string; signo: 1 | -1 | 0 } {
  switch (e.tipo) {
    case "deposito":
      return { concepto: "Depósito", cuenta: e.cuentaNombre, signo: 1 };
    case "retiro":
      return { concepto: "Retiro", cuenta: e.cuentaNombre, signo: -1 };
    case "traspaso":
      return { concepto: "Traspaso", cuenta: `${e.cuentaNombre} → ${e.cuentaDestinoNombre}`, signo: 0 };
    case "cobranza":
      return {
        concepto: `Cobranza en ${ETIQUETA_METODO[e.metodo].toLowerCase()} · ${e.cantidad} ${e.cantidad === 1 ? "cobro" : "cobros"} · ${e.sucursalCodigo}`,
        cuenta: e.cuentaNombre,
        signo: 1,
      };
    default:
      return { concepto: "Saldo fijado", cuenta: e.cuentaNombre, signo: 0 };
  }
}

export function primerDiaDelMesDe(fecha: string): string {
  return `${fecha.slice(0, 8)}01`;
}
```

3. `definicionExcelTesoreria` — reemplazar el armado de filas y columnas:

```ts
export function definicionExcelTesoreria(vista: VistaTesoreria, filtros: { sucursal: string }): DefinicionExcel {
  const filas: FilaExcel[] = vista.cuentas.map((c) => ({
    celdas: [
      c.nombre,
      etiquetaSucursalCuenta(c.sucursalCodigo),
      pesos(c.saldoInicioCentavos),
      c.entradasCentavos / 100,
      c.salidasCentavos / 100,
      pesos(c.saldoFinalCentavos),
      c.saldoFijadoEnRango ? `Saldo fijado el ${formatearFecha(c.saldoFijadoEnRango)}` : null,
    ],
  }));
  const t = vista.total;
  const conSaldo =
    t.cuentasConSaldoInicio === t.cuentas && t.cuentasConSaldoFinal === t.cuentas
      ? `${t.cuentas} cuentas`
      : t.cuentasConSaldoInicio === t.cuentasConSaldoFinal
        ? `${t.cuentasConSaldoFinal} de ${t.cuentas} con saldo`
        : `Inicio: ${t.cuentasConSaldoInicio} de ${t.cuentas} · final: ${t.cuentasConSaldoFinal} de ${t.cuentas} con saldo`;
  filas.push({
    celdas: ["Total Tesorería", conSaldo, t.saldoInicioCentavos / 100, t.entradasCentavos / 100, t.salidasCentavos / 100, t.saldoFinalCentavos / 100, null],
    tipo: "total",
  });
  if (vista.sinCuenta.length > 0) {
    filas.push({ celdas: ["Cobranza sin cuenta asignada", null, null, null, null, null, null], tipo: "grupo" });
    for (const s of vista.sinCuenta) {
      filas.push({ celdas: [`${s.sucursalCodigo} · ${ETIQUETA_METODO[s.metodo]}`, null, null, s.montoCentavos / 100, null, null, null] });
    }
  }
  if (vista.eventos.length > 0) {
    filas.push({ celdas: ["Movimientos del rango", "Fecha", "Concepto", "Entra", "Sale", null, "Comentario"], tipo: "grupo" });
    for (const e of vista.eventos) {
      const { concepto, cuenta, signo } = describirEvento(e);
      const monto = e.montoCentavos / 100;
      const comentario =
        e.tipo === "cobranza" ? null : e.comentario ? `${e.comentario} · Capturó: ${e.capturo}` : `Capturó: ${e.capturo}`;
      filas.push({
        celdas: [
          cuenta,
          formatearFecha(e.fecha),
          concepto,
          signo === 1 ? monto : null,
          signo === -1 || e.tipo === "traspaso" ? monto : null,
          e.tipo === "saldo-fijado" ? monto : null,
          comentario,
        ],
      });
    }
  }
  return {
    titulo: "Tesorería",
    filtros: [
      ["Rango", `${formatearFecha(vista.desde)} a ${formatearFecha(vista.hasta)}`],
      ["Sucursal", filtros.sucursal],
    ],
    columnas: [
      { encabezado: "Cuenta", tipo: "texto", ancho: 32 },
      { encabezado: "Sucursal", tipo: "texto", ancho: 14 },
      { encabezado: "Saldo al inicio", tipo: "pesos", ancho: 18 },
      { encabezado: "Entradas", tipo: "pesos", ancho: 16 },
      { encabezado: "Salidas", tipo: "pesos", ancho: 16 },
      { encabezado: "Saldo al final", tipo: "pesos", ancho: 18 },
      { encabezado: "Comentario", tipo: "texto", ancho: 40 },
    ],
    filas,
    nombreArchivo: `tesoreria-${vista.desde}-a-${vista.hasta}`,
  };
}
```

> En la prueba la celda "Comentario" de una cobranza es `null` y la del retiro `"Banco · Capturó: Ana"`.
> Las pruebas de T-28 de la frase del total (`"1 de 2 con saldo"`, `"Inicio: …"`, `"2 cuentas"`) siguen valiendo:
> ajusta solo la forma de su `vista` de prueba (campos nuevos) y la posición de la celda si comparan filas completas.

- [ ] **Paso 3: Correr pruebas, lint y tipos**

Run: `npm test --workspace=apps/portal -- tesoreria` → PASS.
Run: `npm run lint --workspace=apps/portal && (cd apps/portal && npx tsc --noEmit -p .)` → sin errores. Si `tsc` marca
`pestana-vista.tsx` por los tipos nuevos de `EventoTesoreria` (`e.comentario` no existe en `cobranza`), haz el cambio
mínimo para que compile (p. ej. `"comentario" in e ? e.comentario : null`); la Tarea 9 rehace esa tabla.

- [ ] **Paso 4: Commit**

```bash
git add apps/portal/src/lib/tesoreria.ts apps/portal/src/lib/tesoreria.test.ts apps/portal/src/components/tesoreria/pestana-vista.tsx
git commit -m "T-29: portal — lib de movimientos y destinos, descripción de eventos y Excel con entradas, salidas y cobranza"
```

---

### Tarea 7: Portal — pestaña Movimientos

**Files:**
- Create: `apps/portal/src/components/tesoreria/formulario-movimiento.tsx`
- Create: `apps/portal/src/components/tesoreria/pestana-movimientos.tsx`
- Test: `apps/portal/src/components/tesoreria/pestana-movimientos.test.tsx`
- Modify: `apps/portal/src/components/tesoreria/pantalla-tesoreria.tsx` + `pantalla-tesoreria.test.tsx`

**Interfaces:**
- Consumes: `listarMovimientos`, `crearMovimiento`, `editarMovimiento`, `eliminarMovimiento`, `listarCuentasTesoreria`,
  `ETIQUETA_TIPO`, `etiquetaSucursalCuenta`, `primerDiaDelMesDe`, `MovimientoManual`, `TipoMovimiento`,
  `CuentaTesoreria` (`@/lib/tesoreria`); `leerMontoCentavos`, `textoMonto` (`@/lib/cobranzas`); `hoyEnTijuana`,
  `formatearPesos` (`@/lib/ventas`); `formatearFecha` (`@/lib/reportes`); `mensajeDe` (`@/lib/api`).
- Produces: `PestanaMovimientos({ sucursal }: { sucursal: string | null })`; `FormularioMovimiento({ cuentas, movimiento, alGuardar, alCancelar })`.
  `PantallaTesoreria` gana la pestaña `movimientos` ("Movimientos", `tesoreria.gestionar`), orden
  Tesorería · Movimientos · Cuentas · Saldos, montada solo mientras está abierta (como Cuentas).

- [ ] **Paso 1: Pruebas (fallan)**

`pestana-movimientos.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as lib from "@/lib/tesoreria";
import type { MovimientoManual } from "@/lib/tesoreria";
import { hoyEnTijuana } from "@/lib/ventas";
import { PestanaMovimientos } from "./pestana-movimientos";

vi.mock("@/lib/tesoreria", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tesoreria")>();
  return {
    ...real,
    listarMovimientos: vi.fn(),
    crearMovimiento: vi.fn(),
    editarMovimiento: vi.fn(),
    eliminarMovimiento: vi.fn(),
    listarCuentasTesoreria: vi.fn(),
  };
});

const HOY = hoyEnTijuana();
const CUENTAS = [
  { id: "a", nombre: "Efectivo TJ", sucursalId: "s", sucursalCodigo: "TJ" },
  { id: "b", nombre: "ScotiaFiscal", sucursalId: null, sucursalCodigo: null },
];
const MOV: MovimientoManual = {
  id: "m1", tipo: "traspaso", fecha: HOY, montoCentavos: 500_000, cuentaId: "a", cuentaNombre: "Efectivo TJ",
  cuentaDestinoId: "b", cuentaDestinoNombre: "ScotiaFiscal", comentario: "Depósito al banco", capturo: "Ana",
};

describe("PestanaMovimientos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lib.listarCuentasTesoreria).mockResolvedValue(CUENTAS);
    vi.mocked(lib.listarMovimientos).mockResolvedValue([MOV]);
    vi.mocked(lib.crearMovimiento).mockResolvedValue(MOV);
  });

  it("lista el mes en curso con el traspaso 'A → B'", async () => {
    render(<PestanaMovimientos sucursal="TJ" />);
    const lista = await screen.findByRole("table", { name: "Movimientos registrados" });
    expect(within(lista).getByText("Efectivo TJ → ScotiaFiscal")).toBeInTheDocument();
    expect(lib.listarMovimientos).toHaveBeenCalledWith({ desde: lib.primerDiaDelMesDe(HOY), hasta: HOY, sucursal: "TJ" });
  });

  it("registra un traspaso: tipo, de, a, monto con comas y comentario", async () => {
    render(<PestanaMovimientos sucursal={null} />);
    await screen.findByRole("table", { name: "Movimientos registrados" });
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "traspaso");
    await userEvent.selectOptions(screen.getByLabelText("De"), "a");
    await userEvent.selectOptions(screen.getByLabelText("A"), "b");
    await userEvent.type(screen.getByLabelText("Monto"), "5,000.00");
    await userEvent.type(screen.getByLabelText("Comentario"), "Depósito al banco");
    await userEvent.click(screen.getByRole("button", { name: "Registrar" }));
    expect(lib.crearMovimiento).toHaveBeenCalledWith({
      tipo: "traspaso", fecha: HOY, montoCentavos: 500_000, cuentaId: "a", cuentaDestinoId: "b", comentario: "Depósito al banco",
    });
    expect(lib.listarMovimientos).toHaveBeenCalledTimes(2);
  });

  it("traspaso a la misma cuenta: aviso en rojo tras tocar y Registrar bloqueado", async () => {
    render(<PestanaMovimientos sucursal={null} />);
    await screen.findByRole("table", { name: "Movimientos registrados" });
    expect(screen.getByRole("button", { name: "Registrar" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "traspaso");
    await userEvent.selectOptions(screen.getByLabelText("De"), "a");
    await userEvent.selectOptions(screen.getByLabelText("A"), "a");
    await userEvent.type(screen.getByLabelText("Monto"), "10");
    expect(screen.getByText("Elige dos cuentas distintas.")).toHaveClass("text-destructive");
    expect(screen.getByRole("button", { name: "Registrar" })).toBeDisabled();
  });

  it("editar reabre el formulario con los datos; eliminar pide confirmación", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(lib.eliminarMovimiento).mockResolvedValue({ id: "m1" });
    render(<PestanaMovimientos sucursal={null} />);
    const lista = await screen.findByRole("table", { name: "Movimientos registrados" });
    await userEvent.click(within(lista).getByRole("button", { name: "Editar" }));
    expect(screen.getByLabelText("Monto")).toHaveValue("5000.00");
    expect(screen.getByLabelText("Tipo")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await userEvent.click(within(lista).getByRole("button", { name: "Eliminar" }));
    expect(lib.eliminarMovimiento).toHaveBeenCalledWith("m1");
  });
});
```

En `pantalla-tesoreria.test.tsx`: agregar `vi.mock("./pestana-movimientos", () => ({ PestanaMovimientos: () => <p>panel movimientos</p> }));`
y cambiar la expectativa de pestañas con los dos permisos a `["Tesorería", "Movimientos", "Cuentas", "Saldos"]` y la de
solo-gestionar a `["Movimientos", "Cuentas", "Saldos"]`.

Run: `npm test --workspace=apps/portal -- tesoreria` → FAIL.

- [ ] **Paso 2: `FormularioMovimiento`**

`formulario-movimiento.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { leerMontoCentavos, textoMonto } from "@/lib/cobranzas";
import {
  crearMovimiento,
  editarMovimiento,
  etiquetaSucursalCuenta,
  ETIQUETA_TIPO,
  type CuentaTesoreria,
  type MovimientoManual,
  type TipoMovimiento,
} from "@/lib/tesoreria";
import { hoyEnTijuana } from "@/lib/ventas";

const CLASE = "rounded-md border px-3 py-2 text-sm";

interface Props {
  cuentas: CuentaTesoreria[];
  /** null = alta. Al editar, el tipo no cambia (spec §3.1). */
  movimiento: MovimientoManual | null;
  alGuardar: () => void;
  alCancelar?: () => void;
}

/** Registrar operación (T-29): depósito, retiro o traspaso de una cuenta a otra. */
export function FormularioMovimiento({ cuentas, movimiento, alGuardar, alCancelar }: Props) {
  const hoy = hoyEnTijuana();
  const [tipo, setTipo] = useState<TipoMovimiento>(movimiento?.tipo ?? "deposito");
  const [fecha, setFecha] = useState(movimiento?.fecha ?? hoy);
  const [cuentaId, setCuentaId] = useState(movimiento?.cuentaId ?? "");
  const [destinoId, setDestinoId] = useState(movimiento?.cuentaDestinoId ?? "");
  const [monto, setMonto] = useState(movimiento ? textoMonto(movimiento.montoCentavos) : "");
  const [comentario, setComentario] = useState(movimiento?.comentario ?? "");
  const [tocado, setTocado] = useState(false);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo guardar el movimiento.");

  const centavos = leerMontoCentavos(monto);
  const problema =
    cuentaId === ""
      ? tipo === "traspaso" ? "Elige la cuenta de la que sale." : "Elige la cuenta."
      : tipo === "traspaso" && destinoId === ""
        ? "Elige la cuenta a la que entra."
        : tipo === "traspaso" && destinoId === cuentaId
          ? "Elige dos cuentas distintas."
          : centavos === null
            ? "Escribe un monto mayor a $0."
            : fecha > hoy
              ? "La fecha no puede ser futura."
              : null;

  const opciones = cuentas.map((c) => (
    <option key={c.id} value={c.id}>
      {c.nombre} · {etiquetaSucursalCuenta(c.sucursalCodigo)}
    </option>
  ));

  async function alEnviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (problema || centavos === null) return;
    const comun = {
      fecha,
      montoCentavos: centavos,
      cuentaId,
      ...(tipo === "traspaso" ? { cuentaDestinoId: destinoId } : {}),
    };
    await enviar(
      () =>
        movimiento
          ? editarMovimiento(movimiento.id, { ...comun, comentario: comentario.trim() })
          : crearMovimiento({ tipo, ...comun, ...(comentario.trim() ? { comentario: comentario.trim() } : {}) }),
      () => {
        if (!movimiento) {
          setMonto("");
          setComentario("");
          setTocado(false);
        }
        alGuardar();
      },
    );
  }

  return (
    <form onSubmit={alEnviar} onChange={() => setTocado(true)} className="flex flex-col gap-4 rounded-md border p-4">
      <h3 className="text-sm font-semibold">{movimiento ? `Editar ${ETIQUETA_TIPO[movimiento.tipo].toLowerCase()}` : "Registrar operación"}</h3>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mov-tipo" className="text-sm font-medium">Tipo</label>
          <select id="mov-tipo" className={CLASE} value={tipo} disabled={enviando || movimiento !== null} onChange={(e) => setTipo(e.target.value as TipoMovimiento)}>
            <option value="deposito">Depósito</option>
            <option value="retiro">Retiro</option>
            <option value="traspaso">Traspaso</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mov-fecha" className="text-sm font-medium">Fecha</label>
          <input id="mov-fecha" type="date" className={CLASE} max={hoy} value={fecha} disabled={enviando} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mov-cuenta" className="text-sm font-medium">{tipo === "traspaso" ? "De" : "Cuenta"}</label>
          <select id="mov-cuenta" className={`${CLASE} w-64`} value={cuentaId} disabled={enviando} onChange={(e) => setCuentaId(e.target.value)}>
            <option value="">Elige…</option>
            {opciones}
          </select>
        </div>
        {tipo === "traspaso" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mov-destino" className="text-sm font-medium">A</label>
            <select id="mov-destino" className={`${CLASE} w-64`} value={destinoId} disabled={enviando} onChange={(e) => setDestinoId(e.target.value)}>
              <option value="">Elige…</option>
              {opciones}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mov-monto" className="text-sm font-medium">Monto</label>
          <input id="mov-monto" inputMode="decimal" className={`${CLASE} w-36 text-right tabular-nums`} value={monto} disabled={enviando} onChange={(e) => setMonto(e.target.value)} />
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor="mov-comentario" className="text-sm font-medium">Comentario</label>
          <input id="mov-comentario" maxLength={200} className={CLASE} value={comentario} disabled={enviando} onChange={(e) => setComentario(e.target.value)} />
        </div>
      </div>
      {problema && <p className={`text-sm ${tocado ? "text-destructive" : "text-muted-foreground"}`}>{problema}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={enviando || problema !== null}>
          {enviando ? "Guardando…" : movimiento ? "Guardar" : "Registrar"}
        </Button>
        {alCancelar && (
          <Button type="button" variant="outline" disabled={enviando} onClick={alCancelar}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
```

> La prueba del aviso en rojo: con De = A, el primer problema que aparece es "Elige dos cuentas distintas." (el
> monto se escribe después, pero el orden del `problema` pone la cuenta primero), y `tocado` ya es `true`.

- [ ] **Paso 3: `PestanaMovimientos`**

`pestana-movimientos.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { mensajeDe } from "@/lib/api";
import { formatearFecha } from "@/lib/reportes";
import {
  eliminarMovimiento,
  ETIQUETA_TIPO,
  listarCuentasTesoreria,
  listarMovimientos,
  primerDiaDelMesDe,
  type CuentaTesoreria,
  type MovimientoManual,
} from "@/lib/tesoreria";
import { formatearPesos, hoyEnTijuana } from "@/lib/ventas";
import { FormularioMovimiento } from "./formulario-movimiento";

/** Registrar operación (T-29): formulario arriba y los movimientos del rango abajo. */
export function PestanaMovimientos({ sucursal }: { sucursal: string | null }) {
  const hoy = hoyEnTijuana();
  const [desde, setDesde] = useState(primerDiaDelMesDe(hoy));
  const [hasta, setHasta] = useState(hoy);
  const [cuentas, setCuentas] = useState<CuentaTesoreria[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoManual[] | null>(null);
  const [editando, setEditando] = useState<MovimientoManual | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ultima = useRef(0);

  const cargar = useCallback(async () => {
    const esta = ++ultima.current;
    setError(null);
    try {
      const lista = await listarMovimientos({ desde, hasta, sucursal });
      if (esta === ultima.current) setMovimientos(lista);
    } catch (err) {
      if (esta === ultima.current) setError(mensajeDe(err, "No se pudieron cargar los movimientos."));
    }
  }, [desde, hasta, sucursal]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    let vigente = true;
    listarCuentasTesoreria(sucursal).then(
      (l) => vigente && setCuentas(l),
      () => vigente && setError("No se pudieron cargar las cuentas."),
    );
    return () => {
      vigente = false;
    };
  }, [sucursal]);

  async function alEliminar(m: MovimientoManual) {
    if (!window.confirm(`¿Eliminar el ${ETIQUETA_TIPO[m.tipo].toLowerCase()} de ${formatearPesos(m.montoCentavos)} del ${formatearFecha(m.fecha)}?`)) return;
    try {
      await eliminarMovimiento(m.id);
      void cargar();
    } catch (err) {
      setError(mensajeDe(err, "No se pudo eliminar el movimiento."));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <FormularioMovimiento
        key={editando?.id ?? "nuevo"}
        cuentas={cuentas}
        movimiento={editando}
        alGuardar={() => {
          setEditando(null);
          void cargar();
        }}
        alCancelar={editando ? () => setEditando(null) : undefined}
      />

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="movs-desde" className="text-sm font-medium">Desde</label>
          <input id="movs-desde" type="date" value={desde} onChange={(e) => e.target.value && setDesde(e.target.value)} className="rounded-md border px-3 py-2 text-sm" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="movs-hasta" className="text-sm font-medium">Hasta</label>
          <input id="movs-hasta" type="date" value={hasta} onChange={(e) => e.target.value && setHasta(e.target.value)} className="rounded-md border px-3 py-2 text-sm" />
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {movimientos === null && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {movimientos !== null && movimientos.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay movimientos en el rango.</p>
      )}
      {movimientos !== null && movimientos.length > 0 && (
        <table className="w-full text-sm" aria-label="Movimientos registrados">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Fecha</th>
              <th className="py-2 pr-4 font-medium">Tipo</th>
              <th className="py-2 pr-4 font-medium">Cuenta</th>
              <th className="py-2 pr-4 text-right font-medium">Monto</th>
              <th className="py-2 pr-4 font-medium">Comentario</th>
              <th className="py-2 pr-4 font-medium">Capturó</th>
              <th className="py-2"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m) => (
              <tr key={m.id} className="border-b last:border-0">
                <td className="whitespace-nowrap py-2 pr-4">{formatearFecha(m.fecha)}</td>
                <td className="whitespace-nowrap py-2 pr-4">{ETIQUETA_TIPO[m.tipo]}</td>
                <td className="py-2 pr-4">{m.cuentaDestinoNombre ? `${m.cuentaNombre} → ${m.cuentaDestinoNombre}` : m.cuentaNombre}</td>
                <td className={`whitespace-nowrap py-2 pr-4 text-right tabular-nums ${m.tipo === "retiro" ? "text-destructive" : ""}`}>
                  {formatearPesos(m.tipo === "retiro" ? -m.montoCentavos : m.montoCentavos)}
                </td>
                <td className="py-2 pr-4">{m.comentario ?? "—"}</td>
                <td className="py-2 pr-4">{m.capturo}</td>
                <td className="whitespace-nowrap py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditando(m)}>Editar</Button>
                    <Button variant="outline" size="sm" onClick={() => void alEliminar(m)}>Eliminar</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Paso 4: Pestaña en `PantallaTesoreria`**

En `pantalla-tesoreria.tsx`: `type Pestana = "tesoreria" | "movimientos" | "cuentas" | "saldos";`, importar
`PestanaMovimientos`, y `TODAS`:

```ts
const TODAS: { clave: Pestana; texto: string; permiso: string }[] = [
  { clave: "tesoreria", texto: "Tesorería", permiso: "tesoreria.ver" },
  { clave: "movimientos", texto: "Movimientos", permiso: "tesoreria.gestionar" },
  { clave: "cuentas", texto: "Cuentas", permiso: "tesoreria.gestionar" },
  { clave: "saldos", texto: "Saldos", permiso: "tesoreria.gestionar" },
];
```

Y en el render de paneles agregar
`{clave === "movimientos" && actual === clave && <PestanaMovimientos sucursal={sucursal} />}`.

- [ ] **Paso 5: Correr pruebas, lint y tipos**

Run: `npm test --workspace=apps/portal` → PASS.
Run: `npm run lint --workspace=apps/portal && (cd apps/portal && npx tsc --noEmit -p .)` → sin errores.

- [ ] **Paso 6: Commit**

```bash
git add apps/portal/src/components/tesoreria
git commit -m "T-29: portal — pestaña Movimientos (registrar, corregir y eliminar depósitos, retiros y traspasos)"
```

---

### Tarea 8: Portal — "¿A qué cuenta entra la cobranza?" en Cuentas

**Files:**
- Create: `apps/portal/src/components/tesoreria/seccion-destinos.tsx`
- Test: `apps/portal/src/components/tesoreria/seccion-destinos.test.tsx`
- Modify: `apps/portal/src/components/tesoreria/pestana-cuentas.tsx` (la monta debajo de la tabla y la recarga al cambiar cuentas)

**Interfaces:**
- Consumes: `obtenerDestinos`, `guardarDestino`, `ETIQUETA_METODO`, `etiquetaSucursalCuenta`, `CuentaTesoreria`,
  `DestinosSucursal`, `MetodoCobranza` (`@/lib/tesoreria`); `hoyEnTijuana` (`@/lib/ventas`); `formatearFecha`;
  `mensajeDe`.
- Produces: `SeccionDestinos({ sucursal, cuentas }: { sucursal: string | null; cuentas: CuentaTesoreria[] })`.

- [ ] **Paso 1: Pruebas (fallan)**

`seccion-destinos.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as lib from "@/lib/tesoreria";
import type { DestinosSucursal } from "@/lib/tesoreria";
import { hoyEnTijuana } from "@/lib/ventas";
import { SeccionDestinos } from "./seccion-destinos";

vi.mock("@/lib/tesoreria", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tesoreria")>();
  return { ...real, obtenerDestinos: vi.fn(), guardarDestino: vi.fn() };
});

const HOY = hoyEnTijuana();
const CUENTAS = [
  { id: "ef", nombre: "Efectivo TJ", sucursalId: "s-tj", sucursalCodigo: "TJ" },
  { id: "mx", nombre: "Efectivo MX", sucursalId: "s-mx", sucursalCodigo: "MX" },
  { id: "sc", nombre: "ScotiaFiscal", sucursalId: null, sucursalCodigo: null },
];
const DESTINOS: DestinosSucursal[] = [
  {
    sucursalId: "s-tj",
    sucursalCodigo: "TJ",
    sucursalNombre: "Tijuana",
    vigentes: {
      efectivo: { id: "d1", sucursalId: "s-tj", sucursalCodigo: "TJ", metodo: "efectivo", cuentaId: "ef", cuentaNombre: "Efectivo TJ", desde: "2026-10-01" },
      transferencia: null,
      cheque: null,
    },
    historial: [{ id: "d1", sucursalId: "s-tj", sucursalCodigo: "TJ", metodo: "efectivo", cuentaId: "ef", cuentaNombre: "Efectivo TJ", desde: "2026-10-01" }],
  },
];

describe("SeccionDestinos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lib.obtenerDestinos).mockResolvedValue(DESTINOS);
    vi.mocked(lib.guardarDestino).mockResolvedValue(DESTINOS[0].historial[0]);
  });

  it("una fila por sucursal con lo vigente; opciones = cuentas de esa sucursal + generales", async () => {
    render(<SeccionDestinos sucursal={null} cuentas={CUENTAS} />);
    const fila = (await screen.findByText("TJ · Tijuana")).closest("tr")!;
    const efectivo = within(fila).getByLabelText("Efectivo de TJ") as HTMLSelectElement;
    expect(efectivo.value).toBe("ef");
    const opciones = [...efectivo.options].map((o) => o.textContent);
    expect(opciones).toEqual(["Sin cuenta", "Efectivo TJ", "ScotiaFiscal · General"]);
    expect(within(fila).getByLabelText("Transferencia de TJ")).toHaveValue("");
  });

  it("Guardar manda solo los métodos cambiados, con la fecha desde (hoy por defecto)", async () => {
    render(<SeccionDestinos sucursal={null} cuentas={CUENTAS} />);
    const fila = (await screen.findByText("TJ · Tijuana")).closest("tr")!;
    await userEvent.selectOptions(within(fila).getByLabelText("Transferencia de TJ"), "sc");
    await userEvent.click(within(fila).getByRole("button", { name: "Guardar" }));
    expect(lib.guardarDestino).toHaveBeenCalledTimes(1);
    expect(lib.guardarDestino).toHaveBeenCalledWith({ sucursalId: "s-tj", metodo: "transferencia", cuentaId: "sc", desde: HOY });
    expect(lib.obtenerDestinos).toHaveBeenCalledTimes(2);
  });

  it("muestra el historial de cambios", async () => {
    render(<SeccionDestinos sucursal={null} cuentas={CUENTAS} />);
    expect(await screen.findByText("TJ · Efectivo → Efectivo TJ desde 01/10/2026")).toBeInTheDocument();
  });
});
```

Run: `npm test --workspace=apps/portal -- seccion-destinos` → FAIL.

- [ ] **Paso 2: Implementar `SeccionDestinos`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { mensajeDe } from "@/lib/api";
import { formatearFecha } from "@/lib/reportes";
import {
  ETIQUETA_METODO,
  guardarDestino,
  obtenerDestinos,
  type CuentaTesoreria,
  type DestinosSucursal,
  type MetodoCobranza,
} from "@/lib/tesoreria";
import { hoyEnTijuana } from "@/lib/ventas";

const METODOS: MetodoCobranza[] = ["efectivo", "transferencia", "cheque"];

/**
 * T-29 (spec §3.3): a qué cuenta entra la cobranza de cada sucursal por método.
 * Cambiar es agregar una vigencia "desde": lo anterior no se mueve.
 */
export function SeccionDestinos({ sucursal, cuentas }: { sucursal: string | null; cuentas: CuentaTesoreria[] }) {
  const hoy = hoyEnTijuana();
  const [datos, setDatos] = useState<DestinosSucursal[] | null>(null);
  const [eleccion, setEleccion] = useState<Record<string, string>>({});
  const [desde, setDesde] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await obtenerDestinos(sucursal);
      setDatos(r);
      setEleccion(
        Object.fromEntries(r.flatMap((s) => METODOS.map((m) => [`${s.sucursalId}:${m}`, s.vigentes[m]?.cuentaId ?? ""]))),
      );
    } catch (err) {
      setError(mensajeDe(err, "No se pudo cargar a qué cuenta entra la cobranza."));
    }
  }, [sucursal]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function guardarFila(s: DestinosSucursal) {
    const cambios = METODOS.filter((m) => {
      const nueva = eleccion[`${s.sucursalId}:${m}`] ?? "";
      return nueva !== "" && nueva !== (s.vigentes[m]?.cuentaId ?? "");
    });
    if (cambios.length === 0) return;
    setGuardando(s.sucursalId);
    setError(null);
    try {
      for (const m of cambios) {
        await guardarDestino({
          sucursalId: s.sucursalId,
          metodo: m,
          cuentaId: eleccion[`${s.sucursalId}:${m}`],
          desde: desde[s.sucursalId] ?? hoy,
        });
      }
      await cargar();
    } catch (err) {
      setError(mensajeDe(err, "No se pudo guardar."));
    } finally {
      setGuardando(null);
    }
  }

  if (datos === null) return error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null;

  return (
    <section className="flex flex-col gap-3 border-t pt-5">
      <h3 className="text-sm font-semibold">¿A qué cuenta entra la cobranza?</h3>
      <p className="text-xs text-muted-foreground">
        Los cobros del portal y de la tablet, y las ventas de contado, suman solos a esta cuenta según su sucursal y
        cómo se pagaron. Un cambio cuenta desde la fecha que elijas; lo anterior no se mueve.
      </p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <table className="w-full text-sm" aria-label="Destinos de la cobranza">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Sucursal</th>
            {METODOS.map((m) => (
              <th key={m} className="py-2 pr-4 font-medium">{ETIQUETA_METODO[m]}</th>
            ))}
            <th className="py-2 pr-4 font-medium">Desde</th>
            <th className="py-2"><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {datos.map((s) => {
            const opciones = cuentas.filter((c) => c.sucursalCodigo === s.sucursalCodigo || c.sucursalId === null);
            return (
              <tr key={s.sucursalId} className="border-b last:border-0">
                <td className="whitespace-nowrap py-2 pr-4">{s.sucursalCodigo} · {s.sucursalNombre}</td>
                {METODOS.map((m) => (
                  <td key={m} className="py-2 pr-4">
                    <select
                      aria-label={`${ETIQUETA_METODO[m]} de ${s.sucursalCodigo}`}
                      className="w-full min-w-40 rounded-md border px-2 py-1.5 text-sm"
                      value={eleccion[`${s.sucursalId}:${m}`] ?? ""}
                      onChange={(e) => setEleccion((p) => ({ ...p, [`${s.sucursalId}:${m}`]: e.target.value }))}
                    >
                      <option value="">Sin cuenta</option>
                      {opciones.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.sucursalId === null ? `${c.nombre} · General` : c.nombre}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
                <td className="py-2 pr-4">
                  <input
                    type="date"
                    aria-label={`Desde, ${s.sucursalCodigo}`}
                    max={hoy}
                    value={desde[s.sucursalId] ?? hoy}
                    onChange={(e) => e.target.value && setDesde((p) => ({ ...p, [s.sucursalId]: e.target.value }))}
                    className="rounded-md border px-2 py-1.5 text-sm"
                  />
                </td>
                <td className="py-2 text-right">
                  <Button size="sm" variant="outline" disabled={guardando !== null} onClick={() => void guardarFila(s)}>
                    {guardando === s.sucursalId ? "Guardando…" : "Guardar"}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {datos.some((s) => s.historial.length > 0) && (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {datos.flatMap((s) =>
            s.historial.map((d) => (
              <li key={d.id}>
                {d.sucursalCodigo} · {ETIQUETA_METODO[d.metodo]} → {d.cuentaNombre} desde {formatearFecha(d.desde)}
              </li>
            )),
          )}
        </ul>
      )}
    </section>
  );
}
```

> Las opciones de la prueba: "Efectivo TJ" (de TJ) y "ScotiaFiscal · General"; "Efectivo MX" no aparece.

- [ ] **Paso 3: Montarla en `PestanaCuentas`**

Al final del `<div className="flex flex-col gap-4">` de `pestana-cuentas.tsx`, después de la tabla:

```tsx
      {!catalogo.cargando && !catalogo.error && <SeccionDestinos sucursal={sucursal} cuentas={catalogo.items} />}
```

(con `import { SeccionDestinos } from "./seccion-destinos";`). En `pestana-cuentas.test.tsx` agregar
`vi.mock("./seccion-destinos", () => ({ SeccionDestinos: () => null }));` para que sus pruebas no dependan de la API
de destinos.

- [ ] **Paso 4: Correr pruebas, lint y tipos**

Run: `npm test --workspace=apps/portal` → PASS.
Run: `npm run lint --workspace=apps/portal && (cd apps/portal && npx tsc --noEmit -p .)` → sin errores.

- [ ] **Paso 5: Commit**

```bash
git add apps/portal/src/components/tesoreria
git commit -m "T-29: portal — a qué cuenta entra la cobranza, por sucursal y método, con fecha desde"
```

---

### Tarea 9: Portal — vista con entradas, salidas, cobranza sin cuenta y movimientos

**Files:**
- Modify: `apps/portal/src/components/tesoreria/pestana-vista.tsx`
- Modify: `apps/portal/src/components/tesoreria/pestana-vista.test.tsx`

**Interfaces:**
- Consumes: `VistaTesoreria` ampliada, `describirEvento`, `ETIQUETA_METODO` (Tarea 6).
- Produces: la misma `PestanaVista({ sucursal, activa })`.

- [ ] **Paso 1: Pruebas (fallan)**

En `pestana-vista.test.tsx`, la `VISTA` de prueba gana `entradasCentavos`, `salidasCentavos`, `saldoFijadoEnRango` en
cada cuenta, `entradasCentavos`/`salidasCentavos` en `total` y `sinCuenta: []`. Agregar:

```tsx
  it("columnas Entradas y Salidas, marca de saldo fijado y aviso de cobranza sin cuenta", async () => {
    vi.mocked(lib.obtenerTesoreria).mockResolvedValue({
      ...VISTA,
      cuentas: [
        { id: "a", nombre: "Efectivo TJ", sucursalCodigo: "TJ", saldoInicioCentavos: 100_000, saldoFinalCentavos: 120_000, entradasCentavos: 30_000, salidasCentavos: 10_000, saldoFijadoEnRango: "2026-10-10" },
      ],
      sinCuenta: [{ sucursalCodigo: "MX", metodo: "transferencia", montoCentavos: 325_000 }],
    });
    render(<PestanaVista sucursal={null} />);
    const tabla = await screen.findByRole("table", { name: "Tesorería por cuenta" });
    expect(within(tabla).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Cuenta", "Sucursal", "Saldo al inicio", "Entradas", "Salidas", "Saldo al final",
    ]);
    const fila = within(tabla).getByText("Efectivo TJ").closest("tr")!;
    expect(within(fila).getByText("$300.00")).toBeInTheDocument();
    expect(within(fila).getByText("$100.00")).toBeInTheDocument();
    expect(within(fila).getByText("saldo fijado el 10/10/2026")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("$3,250.00 de cobranza de MX (transferencia) sin cuenta asignada");
  });

  it("movimientos del rango con concepto y cuenta de cada tipo", async () => {
    vi.mocked(lib.obtenerTesoreria).mockResolvedValue({
      ...VISTA,
      eventos: [
        { tipo: "cobranza", id: "c", fecha: HOY, cuentaId: "a", cuentaNombre: "Efectivo TJ", sucursalCodigo: "TJ", metodo: "efectivo", cantidad: 12, montoCentavos: 840_000 },
        { tipo: "traspaso", id: "t", fecha: HOY, cuentaId: "a", cuentaNombre: "Efectivo TJ", cuentaDestinoId: "b", cuentaDestinoNombre: "ScotiaFiscal", montoCentavos: 500_000, comentario: null, capturo: "Ana" },
      ],
    });
    render(<PestanaVista sucursal={null} />);
    const tabla = await screen.findByRole("table", { name: "Movimientos del rango" });
    expect(within(tabla).getByText("Cobranza en efectivo · 12 cobros · TJ")).toBeInTheDocument();
    expect(within(tabla).getByText("Efectivo TJ → ScotiaFiscal")).toBeInTheDocument();
  });
```

(Actualiza también la prueba de T-28 que buscaba la tabla `"Saldos fijados en el rango"` y el texto vacío: ahora la
tabla se llama `"Movimientos del rango"` y el vacío sigue siendo "Sin movimientos en el rango.").

Run: `npm test --workspace=apps/portal -- pestana-vista` → FAIL.

- [ ] **Paso 2: Implementar**

En `pestana-vista.tsx` (imports: `describirEvento`, `ETIQUETA_METODO`):

1. **Aviso de cobranza sin cuenta**, justo después del párrafo "Del … al …":

```tsx
          {vista.sinCuenta.length > 0 && (
            <div role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {vista.sinCuenta.map((s) => (
                <p key={`${s.sucursalCodigo}:${s.metodo}`}>
                  {formatearPesos(s.montoCentavos)} de cobranza de {s.sucursalCodigo} ({ETIQUETA_METODO[s.metodo].toLowerCase()}) sin cuenta asignada
                </p>
              ))}
              <p className="text-xs">Configúrala en Cuentas → ¿A qué cuenta entra la cobranza?</p>
            </div>
          )}
```

2. **Tabla por cuenta**: encabezados `Cuenta · Sucursal · Saldo al inicio · Entradas · Salidas · Saldo al final`
   (todos los de monto con `text-right`, `pr-4` menos el último). En cada fila, dos celdas nuevas entre inicio y final:

```tsx
                    <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">{formatearPesos(c.entradasCentavos)}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">{formatearPesos(c.salidasCentavos)}</td>
```

   y en la celda del saldo final, debajo del monto:

```tsx
                      {c.saldoFijadoEnRango && (
                        <span className="block text-xs text-muted-foreground">saldo fijado el {formatearFecha(c.saldoFijadoEnRango)}</span>
                      )}
```

   En el pie (`tfoot`), dos celdas con `t.entradasCentavos` y `t.salidasCentavos` en la misma posición.

3. **Movimientos del rango** — reemplazar el bloque "Saldos fijados en el rango" por:

```tsx
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Movimientos del rango</h3>
            {vista.eventos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin movimientos en el rango.</p>
            ) : (
              <table className="w-full text-sm" aria-label="Movimientos del rango">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Fecha</th>
                    <th className="py-2 pr-4 font-medium">Concepto</th>
                    <th className="py-2 pr-4 font-medium">Cuenta</th>
                    <th className="py-2 pr-4 text-right font-medium">Monto</th>
                    <th className="py-2 pr-4 font-medium">Comentario</th>
                    <th className="py-2 font-medium">Capturó</th>
                  </tr>
                </thead>
                <tbody>
                  {vista.eventos.map((e) => {
                    const { concepto, cuenta, signo } = describirEvento(e);
                    return (
                      <tr key={e.id} className="border-b last:border-0">
                        <td className="whitespace-nowrap py-2 pr-4">{formatearFecha(e.fecha)}</td>
                        <td className="py-2 pr-4">{concepto}</td>
                        <td className="py-2 pr-4">{cuenta}</td>
                        <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">
                          <Pesos centavos={signo === -1 ? -e.montoCentavos : e.montoCentavos} />
                        </td>
                        <td className="py-2 pr-4">{e.tipo === "cobranza" ? "—" : (e.comentario ?? "—")}</td>
                        <td className="py-2">{e.tipo === "cobranza" ? "—" : e.capturo}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
```

- [ ] **Paso 3: Correr pruebas, lint y tipos**

Run: `npm test --workspace=apps/portal` → PASS.
Run: `npm run lint --workspace=apps/portal && (cd apps/portal && npx tsc --noEmit -p .)` → sin errores.

- [ ] **Paso 4: Commit**

```bash
git add apps/portal/src/components/tesoreria/pestana-vista.tsx apps/portal/src/components/tesoreria/pestana-vista.test.tsx
git commit -m "T-29: portal — la vista con entradas, salidas, cobranza sin cuenta y movimientos del rango"
```

---

### Tarea 10: Documentación, verificación completa y revisión en navegador

**Files:**
- Modify: `CLAUDE.md` (bloque "Tesorería (T-28)")

- [ ] **Paso 1: Ampliar el bloque de Tesorería en `CLAUDE.md`**

Renombrar el encabezado a `**Tesorería (T-28 / T-29).**` y agregar al final del bloque (antes de "Reportes y Excel"):

```markdown
  - **Movimientos (T-29):** `tesoreria_movimiento` — depósito, retiro y traspaso (de una cuenta a otra), monto
    positivo (el tipo da el signo), sin fechas futuras; se corrigen (no el tipo) y se eliminan con baja lógica. Las
    cuentas tienen que ser **visibles**: un usuario atado puede usar una **general** en un movimiento (llevar el
    efectivo al banco), pero dar de alta/renombrar/eliminar una general y fijarle saldo sigue siendo de un General.
  - **La cobranza NO se copia a Tesorería: se lee al consultar** (`tesoreria/cobranza-tesoreria.repository.ts`):
    `cobro` vivo de origen `cobro` (sucursal del cliente) + abonos vivos `venta_contado` de ventas vivas (sucursal
    de la venta), por `fecha_pago` y método; **nunca** `saldo_favor`. Un cobro borrado (T-34) o una venta
    editada/eliminada (T-17) se corrigen solos.
  - **Destinos** (`tesoreria_destino_cobranza`): sucursal + método → cuenta, con vigencia `desde`; se usa la más
    reciente ≤ fecha del pago. Sin destino, el dinero no suma a ninguna cuenta y sale en `sinCuenta`. No se elimina
    la cuenta que **hoy** recibe cobranza (409).
  - Las compras (T-30/T-31) entrarán igual: otra fuente más del arreglo `movimientos` de `reglas-saldo.ts`.
```

- [ ] **Paso 2: Verificación completa**

Run: `npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend`
Run: `npm test --workspace=apps/backend`
Run: `npm run test:e2e --workspace=apps/backend`
Run: `npm run supabase -- test db`
Run: `npm test --workspace=apps/portal && npm run lint --workspace=apps/portal`
Expected: todo en verde. Anota los conteos.

- [ ] **Paso 3: Revisión en navegador (la hace el coordinador)**

Contra la base **local** (`NODE_ENV=test PORT=3010 npm run backend`, `NEXT_PUBLIC_API_URL=http://localhost:3010 npm run portal`),
a 1366 y 1920:
- Configurar destinos de TJ (efectivo → Efectivo TJ, transferencia → ScotiaFiscal) y dejar MX sin configurar.
- Sembrar (o registrar desde Cobranza) un cobro en efectivo de un cliente de TJ y uno de MX; ver la vista: entra en
  Efectivo TJ, y el de MX sale en el aviso "sin cuenta asignada".
- Registrar un depósito, un retiro y un traspaso Efectivo TJ → ScotiaFiscal con el usuario `tijuana`.
- Ver entradas/salidas, la marca de saldo fijado (fijar uno a media semana), el Excel, y que nada se desplaza de lado
  con montos de 9 cifras y nombres de 60 caracteres.

- [ ] **Paso 4: Commit**

```bash
git add CLAUDE.md
git commit -m "T-29: CLAUDE.md — movimientos, cobranza leída y destinos en el bloque de Tesorería"
```

# T-22 · Cuentas por Cobrar (Portal) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una pantalla del portal (Operación → Cuentas por Cobrar) con todo lo que deben los clientes, agrupado por cliente, con saldo y vencimiento por nota, filtro "Solo vencidas", Excel y botón para ir a cobrar.

**Architecture:** Endpoint de solo lectura `GET /cuentas-por-cobrar` en el módulo hoy vacío `cuentas-cobrar-pagar`: el repositorio trae las notas planas (con `vence` y `dias_atraso` calculados en Postgres contra la fecha de Tijuana) y unas reglas puras las agrupan, filtran, suman y ordenan. El portal pinta la respuesta tal cual, exporta con la utilidad de T-15 y enlaza a Cobranza con `?cliente=&nota=`. Un permiso nuevo `cuentas_cobrar.ver` (migración de una fila).

**Tech Stack:** NestJS + Kysely (`sql` crudo) + Jest/supertest (backend); Postgres/Supabase + pgTAP; Next.js 15 + Vitest + Testing Library (portal); `exceljs` vía `apps/portal/src/lib/excel/`.

**Spec:** `docs/superpowers/specs/2026-10-14-t22-cuentas-por-cobrar-design.md`

## Global Constraints

- Permiso: clave `cuentas_cobrar.ver`, grupo `Operacion Comercial`, descripción `Ver Cuentas por Cobrar`.
- Universo: `venta_nota.deleted_at is null` y `status in ('pendiente', 'abonado')`. Sucursal = la **del cliente** (`cliente.sucursal_id`), igual que Cobranza.
- Abonado = suma de `cobranza_abono.monto` con `deleted_at is null` (cualquier `origen`).
- Dinero en **centavos enteros** con `aCentavos` (`sincronizacion/dinero.ts`) y `saldoDerivadoCentavos` (`ventas-cobranza/reglas-cobranza.ts`), igual que Cobranza. Una nota con saldo 0 no se lista.
- Hoy = `(now() at time zone 'America/Tijuana')::date`, calculado en Postgres. Nunca el reloj del navegador ni UTC.
- Vence = `fecha + plazo_credito_dias`; plazo null → `vence: null`, `diasAtraso: 0`. Días de atraso = `max(hoy − vence, 0)`.
- Orden: clientes por vencido desc, saldo desc, nombre (`localeCompare(…, 'es')`); notas por fecha asc, folio asc.
- Alcance: `resolverAlcance(usuario.codigo, normalizarSucursalPedida(q.sucursal))`.
- Respuestas en camelCase. Textos de pantalla en español con acentos; comentarios de código en el estilo del repo (español, sin acentos en backend).
- **No se toca `apps/tablet`** ni el contrato de sincronización.
- Comandos siempre desde la raíz con `--workspace=…`. Postgres local arriba (`docker context ls`; `colima start` o Docker Desktop; `npm run supabase start`).

## Review Focus

1. **Cliente sin plazo con notas muy viejas** → "Sin plazo", nunca vencida ni sumada en *Vencido* (e2e en Tarea 3, unitaria en Tarea 2).
2. **El mismo día en que vence** → todavía "Al corriente" (0 días); el día siguiente, 1 día (e2e Tarea 3, con fechas relativas a `hoy` del servidor).
3. **Pago borrado por petición (T-34)** → no resta; **saldo a favor aplicado** → sí resta (e2e Tarea 3).
4. **Cambiar "Solo vencidas" o la sucursal mientras una respuesta lenta viene en camino** → la respuesta vieja no pisa la nueva (prueba de pantalla en Tarea 5).
5. **Usuario atado a una sucursal que pide `?sucursal=todas`** → ve la suya, no error; si pide otra por nombre → 403 (e2e Tarea 3).

---

### Tarea 1: Permiso `cuentas_cobrar.ver` (migración + pgTAP)

**Files:**
- Create: `supabase/migrations/20261014120000_permiso_cuentas_cobrar.sql`
- Modify: `supabase/tests/93_permiso_sucursal_test.sql` (conteo 27 → 28)
- Create: `supabase/tests/99_permiso_cuentas_cobrar_test.sql`

**Interfaces:**
- Produces: fila `permiso(clave = 'cuentas_cobrar.ver')`, que usan las Tareas 3 y 5.

- [ ] **Step 1: Escribir la prueba pgTAP (falla)**

`supabase/tests/99_permiso_cuentas_cobrar_test.sql`:

```sql
begin;
select plan(2);

select is(
  (select grupo from permiso where clave = 'cuentas_cobrar.ver' and deleted_at is null),
  'Operacion Comercial',
  'existe el permiso cuentas_cobrar.ver (T-22)'
);

select is(
  (select descripcion from permiso where clave = 'cuentas_cobrar.ver'),
  'Ver Cuentas por Cobrar',
  'cuentas_cobrar.ver lleva su descripcion'
);

select * from finish();
rollback;
```

En `supabase/tests/93_permiso_sucursal_test.sql`, cambiar el comentario y el conteo:

```sql
-- T-05 sembro 22 permisos desde el documento del cliente; T-08a agrego 23o
-- (sucursal.gestionar); T-18 agrego 24o (precio.gestionar); T-08b agrega 25o
-- (perfil.gestionar); T-13 agrega 26o (usuario.gestionar); T-19 agrega 27o
-- (venta.asignar_factura); T-22 agrega 28o (cuentas_cobrar.ver).
select is(
  (select count(*)::int from permiso where deleted_at is null),
  28,
  'el catalogo de permisos tiene 28 claves'
);
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm run supabase -- test db`
Expected: FAIL en `99_permiso_cuentas_cobrar_test.sql` y en el conteo de `93_…` (27 ≠ 28).

- [ ] **Step 3: Escribir la migración**

`supabase/migrations/20261014120000_permiso_cuentas_cobrar.sql`:

```sql
-- T-22: Cuentas por Cobrar (Portal). Solo agrega el permiso de la pantalla;
-- ninguna tabla cambia. El perfil `Administrador General` lo recibe solo
-- (PERFIL_MAESTRO, apps/backend/src/modules/auth/permisos.ts).
insert into permiso (clave, grupo, descripcion) values
  ('cuentas_cobrar.ver', 'Operacion Comercial', 'Ver Cuentas por Cobrar')
on conflict (clave) do nothing;
```

- [ ] **Step 4: Aplicar y correr**

Run: `npm run supabase -- migration up --local && npm run supabase -- test db`
Expected: todas las pruebas pgTAP en verde.

Run: `npm run db:types --workspace=apps/backend && git diff --stat apps/backend/src/database/schema.d.ts`
Expected: sin cambios en `schema.d.ts` (solo se agregó una fila).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261014120000_permiso_cuentas_cobrar.sql supabase/tests/93_permiso_sucursal_test.sql supabase/tests/99_permiso_cuentas_cobrar_test.sql
git commit -m "T-22: permiso cuentas_cobrar.ver (migración + pgTAP)"
```

---

### Tarea 2: Reglas puras de Cuentas por Cobrar (backend)

**Files:**
- Create: `apps/backend/src/modules/cuentas-cobrar-pagar/reglas-cuentas-por-cobrar.ts`
- Test: `apps/backend/src/modules/cuentas-cobrar-pagar/reglas-cuentas-por-cobrar.spec.ts`

**Interfaces:**
- Consumes: `saldoDerivadoCentavos(montoTotalCentavos: number, abonadoCentavos: number): number` de `../ventas-cobranza/reglas-cobranza`.
- Produces (los usa la Tarea 3):

```ts
export interface FilaNotaPorCobrar {
  id: string; clienteId: string; cliente: string; sucursalCodigo: string;
  fecha: string; folio: string; numNota: string | null;
  montoCentavos: number; abonadoCentavos: number;
  status: 'pendiente' | 'abonado';
  vence: string | null; diasAtraso: number;
}
export interface NotaPorCobrar { id; fecha; folio; numNota; montoCentavos; abonadoCentavos; saldoCentavos; status; vence; diasAtraso }
export interface ClienteConDeuda { clienteId; cliente; sucursalCodigo; saldoCentavos; vencidoCentavos; notas: NotaPorCobrar[] }
export interface CuentasPorCobrar { hoy: string; totalCentavos; vencidoCentavos; notas: number; clientes: ClienteConDeuda[] }
export function armarCuentasPorCobrar(hoy: string, filas: FilaNotaPorCobrar[], opciones: { soloVencidas: boolean }): CuentasPorCobrar
```

- [ ] **Step 1: Escribir las pruebas (fallan)**

`reglas-cuentas-por-cobrar.spec.ts`:

```ts
import {
  armarCuentasPorCobrar,
  type FilaNotaPorCobrar,
} from './reglas-cuentas-por-cobrar';

const HOY = '2026-10-14';

const fila = (extra: Partial<FilaNotaPorCobrar>): FilaNotaPorCobrar => ({
  id: 'n1',
  clienteId: 'c1',
  cliente: 'Cobach XXI',
  sucursalCodigo: 'TJ',
  fecha: '2026-10-01',
  folio: 'TJ261001AP01',
  numNota: null,
  montoCentavos: 10000,
  abonadoCentavos: 0,
  status: 'pendiente',
  vence: null,
  diasAtraso: 0,
  ...extra,
});

describe('armarCuentasPorCobrar', () => {
  it('sin filas: todo en cero y sin clientes', () => {
    expect(armarCuentasPorCobrar(HOY, [], { soloVencidas: false })).toEqual({
      hoy: HOY,
      totalCentavos: 0,
      vencidoCentavos: 0,
      notas: 0,
      clientes: [],
    });
  });

  it('saldo = monto − abonado; vencido solo con dias de atraso', () => {
    const r = armarCuentasPorCobrar(
      HOY,
      [
        fila({ id: 'a', abonadoCentavos: 3000, status: 'abonado', vence: '2026-09-28', diasAtraso: 16 }),
        fila({ id: 'b', fecha: '2026-10-10', folio: 'TJ261010AP01', vence: '2026-10-25', diasAtraso: 0 }),
      ],
      { soloVencidas: false },
    );
    expect(r.totalCentavos).toBe(7000 + 10000);
    expect(r.vencidoCentavos).toBe(7000);
    expect(r.notas).toBe(2);
    expect(r.clientes).toHaveLength(1);
    expect(r.clientes[0]).toMatchObject({
      clienteId: 'c1',
      cliente: 'Cobach XXI',
      sucursalCodigo: 'TJ',
      saldoCentavos: 17000,
      vencidoCentavos: 7000,
    });
    expect(r.clientes[0].notas.map((n) => [n.id, n.saldoCentavos])).toEqual([
      ['a', 7000],
      ['b', 10000],
    ]);
    // No viajan de mas: la nota no repite los datos del cliente.
    expect(Object.keys(r.clientes[0].notas[0]).sort()).toEqual(
      [
        'abonadoCentavos', 'diasAtraso', 'fecha', 'folio', 'id', 'montoCentavos',
        'numNota', 'saldoCentavos', 'status', 'vence',
      ].sort(),
    );
  });

  it('sin plazo nunca cuenta como vencida (Review Focus 1)', () => {
    const r = armarCuentasPorCobrar(
      HOY,
      [fila({ fecha: '2025-01-01', vence: null, diasAtraso: 0 })],
      { soloVencidas: false },
    );
    expect(r.vencidoCentavos).toBe(0);
    expect(armarCuentasPorCobrar(HOY, [fila({ vence: null })], { soloVencidas: true }).clientes).toEqual([]);
  });

  it('una nota sin saldo (datos viejos con abonos de mas) no se lista', () => {
    const r = armarCuentasPorCobrar(
      HOY,
      [fila({ abonadoCentavos: 12000, status: 'abonado' })],
      { soloVencidas: false },
    );
    expect(r.notas).toBe(0);
    expect(r.clientes).toEqual([]);
  });

  it('soloVencidas filtra notas, quita al cliente sin vencidas y recalcula totales', () => {
    const r = armarCuentasPorCobrar(
      HOY,
      [
        fila({ id: 'a', vence: '2026-09-28', diasAtraso: 16 }),
        fila({ id: 'b', fecha: '2026-10-10', vence: '2026-10-25', diasAtraso: 0 }),
        fila({ id: 'c', clienteId: 'c2', cliente: 'El Moreno', vence: '2026-10-20', diasAtraso: 0 }),
      ],
      { soloVencidas: true },
    );
    expect(r.notas).toBe(1);
    expect(r.totalCentavos).toBe(10000);
    expect(r.vencidoCentavos).toBe(10000);
    expect(r.clientes.map((c) => c.clienteId)).toEqual(['c1']);
    expect(r.clientes[0].notas.map((n) => n.id)).toEqual(['a']);
  });

  it('ordena clientes por vencido, saldo y nombre; notas por fecha y folio', () => {
    const r = armarCuentasPorCobrar(
      HOY,
      [
        fila({ id: 'x1', clienteId: 'x', cliente: 'Zeta', montoCentavos: 90000 }),
        fila({ id: 'y1', clienteId: 'y', cliente: 'Ámbar', montoCentavos: 5000 }),
        fila({ id: 'w1', clienteId: 'w', cliente: 'Beta', montoCentavos: 5000 }),
        fila({ id: 'v2', clienteId: 'v', cliente: 'Vencido', fecha: '2026-09-02', folio: 'B', vence: '2026-09-02', diasAtraso: 42, montoCentavos: 100 }),
        fila({ id: 'v1', clienteId: 'v', cliente: 'Vencido', fecha: '2026-09-02', folio: 'A', vence: '2026-09-02', diasAtraso: 42, montoCentavos: 100 }),
        fila({ id: 'v0', clienteId: 'v', cliente: 'Vencido', fecha: '2026-09-01', folio: 'C', vence: '2026-09-01', diasAtraso: 43, montoCentavos: 100 }),
      ],
      { soloVencidas: false },
    );
    // Vencido primero aunque deba menos; luego por saldo; empate de saldo -> nombre (Á antes de B).
    expect(r.clientes.map((c) => c.cliente)).toEqual(['Vencido', 'Zeta', 'Ámbar', 'Beta']);
    expect(r.clientes[0].notas.map((n) => n.id)).toEqual(['v0', 'v1', 'v2']);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test --workspace=apps/backend -- reglas-cuentas-por-cobrar`
Expected: FAIL — "Cannot find module './reglas-cuentas-por-cobrar'".

- [ ] **Step 3: Implementar**

`reglas-cuentas-por-cobrar.ts`:

```ts
import { saldoDerivadoCentavos } from '../ventas-cobranza/reglas-cobranza';

/*
 * Cuentas por Cobrar (T-22). Reglas puras: el repositorio trae las notas
 * planas, con `vence` y `diasAtraso` ya calculados en Postgres contra la fecha
 * de Tijuana; aqui se agrupan por cliente, se filtran, se suman y se ordenan.
 * El portal tiene una copia de estas formas en `lib/cuentas-por-cobrar.ts`.
 */

/** Una nota `pendiente`/`abonado` viva, tal como sale de la base. */
export interface FilaNotaPorCobrar {
  id: string;
  clienteId: string;
  cliente: string;
  sucursalCodigo: string;
  fecha: string;
  folio: string;
  numNota: string | null;
  montoCentavos: number;
  abonadoCentavos: number;
  status: 'pendiente' | 'abonado';
  /** `null` = el cliente no tiene plazo de credito. */
  vence: string | null;
  /** 0 = al corriente o sin plazo. */
  diasAtraso: number;
}

export interface NotaPorCobrar {
  id: string;
  fecha: string;
  folio: string;
  numNota: string | null;
  montoCentavos: number;
  abonadoCentavos: number;
  saldoCentavos: number;
  status: 'pendiente' | 'abonado';
  vence: string | null;
  diasAtraso: number;
}

export interface ClienteConDeuda {
  clienteId: string;
  cliente: string;
  sucursalCodigo: string;
  saldoCentavos: number;
  vencidoCentavos: number;
  notas: NotaPorCobrar[];
}

export interface CuentasPorCobrar {
  /** `AAAA-MM-DD` de Tijuana: contra este dia se calcularon los atrasos. */
  hoy: string;
  totalCentavos: number;
  vencidoCentavos: number;
  notas: number;
  clientes: ClienteConDeuda[];
}

export function armarCuentasPorCobrar(
  hoy: string,
  filas: FilaNotaPorCobrar[],
  opciones: { soloVencidas: boolean },
): CuentasPorCobrar {
  const porCliente = new Map<string, ClienteConDeuda>();
  let totalCentavos = 0;
  let vencidoCentavos = 0;
  let notas = 0;

  for (const f of filas) {
    const saldoCentavos = saldoDerivadoCentavos(f.montoCentavos, f.abonadoCentavos);
    // Datos viejos con abonos de mas: no hay nada que cobrar.
    if (saldoCentavos <= 0) continue;
    const vencida = f.diasAtraso > 0;
    if (opciones.soloVencidas && !vencida) continue;

    let cliente = porCliente.get(f.clienteId);
    if (!cliente) {
      cliente = {
        clienteId: f.clienteId,
        cliente: f.cliente,
        sucursalCodigo: f.sucursalCodigo,
        saldoCentavos: 0,
        vencidoCentavos: 0,
        notas: [],
      };
      porCliente.set(f.clienteId, cliente);
    }
    cliente.notas.push({
      id: f.id,
      fecha: f.fecha,
      folio: f.folio,
      numNota: f.numNota,
      montoCentavos: f.montoCentavos,
      abonadoCentavos: f.abonadoCentavos,
      saldoCentavos,
      status: f.status,
      vence: f.vence,
      diasAtraso: f.diasAtraso,
    });
    cliente.saldoCentavos += saldoCentavos;
    totalCentavos += saldoCentavos;
    notas += 1;
    if (vencida) {
      cliente.vencidoCentavos += saldoCentavos;
      vencidoCentavos += saldoCentavos;
    }
  }

  const clientes = [...porCliente.values()];
  for (const c of clientes) c.notas.sort(porFechaYFolio);
  clientes.sort(
    (a, b) =>
      b.vencidoCentavos - a.vencidoCentavos ||
      b.saldoCentavos - a.saldoCentavos ||
      a.cliente.localeCompare(b.cliente, 'es'),
  );
  return { hoy, totalCentavos, vencidoCentavos, notas, clientes };
}

function porFechaYFolio(a: NotaPorCobrar, b: NotaPorCobrar): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  if (a.folio !== b.folio) return a.folio < b.folio ? -1 : 1;
  return 0;
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test --workspace=apps/backend -- reglas-cuentas-por-cobrar`
Expected: PASS (6 pruebas).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/cuentas-cobrar-pagar/reglas-cuentas-por-cobrar.ts apps/backend/src/modules/cuentas-cobrar-pagar/reglas-cuentas-por-cobrar.spec.ts
git commit -m "T-22: reglas de Cuentas por Cobrar (agrupar, filtrar vencidas, totales, orden)"
```

---

### Tarea 3: Endpoint `GET /cuentas-por-cobrar` (backend + e2e)

**Files:**
- Create: `apps/backend/src/modules/cuentas-cobrar-pagar/dto/cuentas-por-cobrar.dto.ts`
- Create: `apps/backend/src/modules/cuentas-cobrar-pagar/cuentas-por-cobrar.repository.ts`
- Create: `apps/backend/src/modules/cuentas-cobrar-pagar/cuentas-por-cobrar.service.ts`
- Create: `apps/backend/src/modules/cuentas-cobrar-pagar/cuentas-por-cobrar.controller.ts`
- Modify: `apps/backend/src/modules/cuentas-cobrar-pagar/cuentas-cobrar-pagar.module.ts`
- Test: `apps/backend/test/cuentas-por-cobrar.e2e-spec.ts`

**Interfaces:**
- Consumes: `armarCuentasPorCobrar`, `FilaNotaPorCobrar`, `CuentasPorCobrar` (Tarea 2); permiso `cuentas_cobrar.ver` (Tarea 1); `aCentavos` (`../sincronizacion/dinero`); `buscarSucursalUsuario` (`../sucursales/buscar-sucursal-usuario`); `resolverAlcance`, `normalizarSucursalPedida` (`../sucursales/alcance-sucursal`); `sembrarCobro`, `borrarCobrosDe` (`test/apoyo-cobros.ts`).
- Produces: `GET /cuentas-por-cobrar?sucursal=<codigo|todas>&soloVencidas=<true|false>` → `CuentasPorCobrar` (camelCase). 400 si `soloVencidas` no es `true`/`false`; 401 sin sesión o usuario inexistente; 403 sin permiso o sucursal ajena.

- [ ] **Step 1: Escribir la prueba e2e (falla)**

`apps/backend/test/cuentas-por-cobrar.e2e-spec.ts`. Siembra en una **sucursal propia `QC`** para que los totales sean exactos (otras suites siembran en TJ/MX; `sucursales.e2e-spec.ts` reserva `ZA`…`ZH`). Las fechas son **relativas a `hoy` que devuelve el propio endpoint**, para no depender de la hora a la que corra.

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import { borrarCobrosDe, sembrarCobro } from './apoyo-cobros';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';
import type { CuentasPorCobrar } from './../src/modules/cuentas-cobrar-pagar/reglas-cuentas-por-cobrar';

const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
// Sucursal propia: los totales de QC son solo de esta suite.
const CODIGO = 'QC';

/** `AAAA-MM-DD` menos `dias`, sin zona horaria de por medio. */
function restarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - dias)).toISOString().slice(0, 10);
}

describe('Cuentas por Cobrar (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  let idQc: string;
  let idTijuana: string;
  let usuarioGeneralId: string;
  let cookieGeneral: string;
  let cookieQc: string;
  let cookieSinPermiso: string;
  let cookieConExcepcion: string;
  let hoy: string;
  let folios = 0;

  const iniciarSesion = async (login: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const acceso = cookies.find((c) => c.startsWith('jawa_access='));
    if (!acceso) throw new Error('El login no devolvio cookie de acceso.');
    return acceso.split(';')[0];
  };

  /** `Auxiliar Administrativo` esta vacio de permisos. */
  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ): Promise<string> => {
    const hash = await app.get(PasswordService).hashear(PASSWORD);
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', perfil)
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('usuario')
      .values({
        login,
        nombre: login,
        password_hash: hash,
        perfil_id: perfilId,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    usuarioIds.push(id);
    return id;
  };

  const sembrarCliente = async (
    nombre: string,
    plazo: number | null,
    sucursalId = idQc,
  ): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `${nombre} ${SUFIJO}`,
        domicilio: 'Calle 1',
        telefono: '6640000000',
        tipo: 'cliente',
        lista_precio_id: lista.id,
        sucursal_id: sucursalId,
        plazo_credito_dias: plazo,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return id;
  };

  /** Venta a credito de oficina; `pendiente` y viva salvo que se diga otra cosa. */
  const sembrarNota = async (
    clienteId: string,
    monto: string,
    fecha: string,
    extra: { status?: string; borrada?: boolean } = {},
  ): Promise<string> => {
    const cliente = await db
      .selectFrom('cliente')
      .select('sucursal_id')
      .where('id', '=', clienteId)
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('venta_nota')
      .values({
        folio: `ZZP${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha,
        cliente_id: clienteId,
        vendedor_id: null,
        monto_total: monto,
        num_nota: null,
        contado_credito: 'credito',
        semana: 1,
        mes: 1,
        status: extra.status ?? 'pendiente',
        sucursal_id: cliente.sucursal_id,
        origen: 'portal',
        capturo_usuario_id: usuarioGeneralId,
        deleted_at: extra.borrada ? new Date() : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  /** Un abono vivo (o borrado, con su pago borrado como lo deja T-34). */
  const sembrarAbono = async (
    notaId: string,
    clienteId: string,
    monto: string,
    opciones: { saldoFavor?: boolean; borrado?: boolean } = {},
  ): Promise<void> => {
    const cobroId = await sembrarCobro(db, {
      clienteId,
      vendedorId: null,
      monto,
      fecha: hoy,
      metodoPago: opciones.saldoFavor ? 'saldo_favor' : 'efectivo',
    });
    const borradoEn = opciones.borrado ? new Date() : null;
    if (borradoEn)
      await db
        .updateTable('cobro')
        .set({ deleted_at: borradoEn })
        .where('id', '=', cobroId)
        .execute();
    await db
      .insertInto('cobranza_abono')
      .values({
        venta_nota_id: notaId,
        vendedor_id: null,
        fecha_pago: hoy,
        fecha_operacion: hoy,
        monto,
        tipo: 'abono',
        saldo_pendiente: '0.00',
        metodo_pago: opciones.saldoFavor ? 'saldo_favor' : 'efectivo',
        origen: opciones.saldoFavor ? 'saldo_favor' : 'cobro',
        cobro_id: cobroId,
        deleted_at: borradoEn,
      })
      .execute();
  };

  const pedir = (cookie: string, query: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .get(`/cuentas-por-cobrar?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const deQc = async (
    query: Record<string, string> = {},
  ): Promise<CuentasPorCobrar> =>
    (await pedir(cookieGeneral, { sucursal: CODIGO, ...query }).expect(200))
      .body as CuentasPorCobrar;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    // Una corrida que trono pudo dejar QC: se reusa.
    idQc = (
      await db
        .insertInto('sucursal')
        .values({ codigo: CODIGO, nombre: 'Prueba Cuentas por Cobrar' })
        .onConflict((oc) => oc.column('codigo').doUpdateSet({ deleted_at: null }))
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    idTijuana = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;

    usuarioGeneralId = await crearUsuario(`e2e-cxc-gen-${SUFIJO}`, 'Administrador General', null);
    await crearUsuario(`e2e-cxc-qc-${SUFIJO}`, 'Administrador General', idQc);
    await crearUsuario(`e2e-cxc-sin-${SUFIJO}`, 'Auxiliar Administrativo', null);
    const conExcepcion = await crearUsuario(`e2e-cxc-exc-${SUFIJO}`, 'Auxiliar Administrativo', null);
    const { id: permisoId } = await db
      .selectFrom('permiso')
      .select('id')
      .where('clave', '=', 'cuentas_cobrar.ver')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('usuario_permiso')
      .values({ usuario_id: conExcepcion, permiso_id: permisoId, habilitado: true })
      .execute();

    cookieGeneral = await iniciarSesion(`e2e-cxc-gen-${SUFIJO}`);
    cookieQc = await iniciarSesion(`e2e-cxc-qc-${SUFIJO}`);
    cookieSinPermiso = await iniciarSesion(`e2e-cxc-sin-${SUFIJO}`);
    cookieConExcepcion = await iniciarSesion(`e2e-cxc-exc-${SUFIJO}`);

    hoy = (await deQc()).hoy;
  });

  afterAll(async () => {
    if (clienteIds.length > 0) {
      const notas = db
        .selectFrom('venta_nota')
        .select('id')
        .where('cliente_id', 'in', clienteIds);
      await db.deleteFrom('cobranza_abono').where('venta_nota_id', 'in', notas).execute();
      await borrarCobrosDe(db, clienteIds);
      await db.deleteFrom('venta_nota').where('cliente_id', 'in', clienteIds).execute();
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    await db.deleteFrom('usuario_permiso').where('usuario_id', 'in', usuarioIds).execute();
    await db.deleteFrom('sesion_refresh').where('usuario_id', 'in', usuarioIds).execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await db.deleteFrom('sucursal').where('codigo', '=', CODIGO).execute();
    await app.close();
  });

  /* ================================================================ */

  it('hoy es una fecha AAAA-MM-DD (la de Tijuana, calculada en Postgres)', () => {
    expect(hoy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  describe('permiso y alcance', () => {
    it('sin sesion es 401', async () => {
      await request(app.getHttpServer()).get('/cuentas-por-cobrar').expect(401);
    });

    it('sin cuentas_cobrar.ver es 403; con la excepcion en usuario_permiso, 200', async () => {
      await pedir(cookieSinPermiso).expect(403);
      await pedir(cookieConExcepcion, { sucursal: CODIGO }).expect(200);
    });

    it('soloVencidas que no es true/false es 400', async () => {
      await pedir(cookieGeneral, { soloVencidas: 'quizas' }).expect(400);
    });

    it('atado a QC: "todas" o nada le da QC; pedir TJ es 403 (Review Focus 5)', async () => {
      const cli = await sembrarCliente('Alcance', 10);
      await sembrarNota(cli, '10.00', hoy);
      const cliTj = await sembrarCliente('Alcance TJ', 10, idTijuana);
      await sembrarNota(cliTj, '10.00', hoy);

      for (const query of [{}, { sucursal: 'todas' }, { sucursal: 'qc' }]) {
        const r = (await pedir(cookieQc, query).expect(200)).body as CuentasPorCobrar;
        const ids = r.clientes.map((c) => c.clienteId);
        expect(ids).toContain(cli);
        expect(ids).not.toContain(cliTj);
        expect(r.clientes.every((c) => c.sucursalCodigo === CODIGO)).toBe(true);
      }
      await pedir(cookieQc, { sucursal: 'TJ' }).expect(403);
    });
  });

  describe('universo, saldos y vencimiento', () => {
    let cliUniverso: string;
    let pendiente: string;
    let abonada: string;
    let conBorrado: string;
    let conSaldoFavor: string;

    beforeAll(async () => {
      cliUniverso = await sembrarCliente('Universo', null);
      pendiente = await sembrarNota(cliUniverso, '100.00', hoy);
      abonada = await sembrarNota(cliUniverso, '100.00', hoy, { status: 'abonado' });
      await sembrarAbono(abonada, cliUniverso, '30.00');
      conBorrado = await sembrarNota(cliUniverso, '100.00', hoy);
      await sembrarAbono(conBorrado, cliUniverso, '40.00', { borrado: true });
      conSaldoFavor = await sembrarNota(cliUniverso, '100.00', hoy, { status: 'abonado' });
      await sembrarAbono(conSaldoFavor, cliUniverso, '25.00', { saldoFavor: true });
      await sembrarNota(cliUniverso, '100.00', hoy, { status: 'pagada' });
      await sembrarNota(cliUniverso, '0.00', hoy, { status: 'promocion' });
      await sembrarNota(cliUniverso, '100.00', hoy, { status: 'cuenta_perdida' });
      await sembrarNota(cliUniverso, '100.00', hoy, { borrada: true });
    });

    it('entran pendiente y abonado vivos; fuera pagada, promocion, cuenta perdida y borrada', async () => {
      const c = (await deQc()).clientes.find((x) => x.clienteId === cliUniverso);
      expect(c?.notas.map((n) => n.id).sort()).toEqual(
        [pendiente, abonada, conBorrado, conSaldoFavor].sort(),
      );
    });

    it('abono vivo resta; abono de un pago borrado no; saldo a favor si (Review Focus 3)', async () => {
      const c = (await deQc()).clientes.find((x) => x.clienteId === cliUniverso)!;
      const saldo = (id: string) => c.notas.find((n) => n.id === id)!.saldoCentavos;
      expect(saldo(pendiente)).toBe(10000);
      expect(saldo(abonada)).toBe(7000);
      expect(saldo(conBorrado)).toBe(10000);
      expect(saldo(conSaldoFavor)).toBe(7500);
      expect(c.notas.find((n) => n.id === abonada)!.abonadoCentavos).toBe(3000);
      expect(c.saldoCentavos).toBe(10000 + 7000 + 10000 + 7500);
    });

    it('vencimiento contra el hoy de Tijuana (Review Focus 1 y 2)', async () => {
      const sinPlazo = await sembrarCliente('Sin plazo', null);
      const viejaSinPlazo = await sembrarNota(sinPlazo, '10.00', restarDias(hoy, 400));
      const plazo0 = await sembrarCliente('Plazo 0', 0);
      const hoy0 = await sembrarNota(plazo0, '10.00', hoy);
      const ayer0 = await sembrarNota(plazo0, '10.00', restarDias(hoy, 1));
      const plazo15 = await sembrarCliente('Plazo 15', 15);
      const venceHoy = await sembrarNota(plazo15, '10.00', restarDias(hoy, 15));
      const vencida16 = await sembrarNota(plazo15, '10.00', restarDias(hoy, 31));

      const r = await deQc();
      const nota = (id: string) =>
        r.clientes.flatMap((c) => c.notas).find((n) => n.id === id)!;
      expect(nota(viejaSinPlazo)).toMatchObject({ vence: null, diasAtraso: 0 });
      expect(nota(hoy0)).toMatchObject({ vence: hoy, diasAtraso: 0 });
      expect(nota(ayer0)).toMatchObject({ vence: restarDias(hoy, 1), diasAtraso: 1 });
      expect(nota(venceHoy)).toMatchObject({ vence: hoy, diasAtraso: 0 });
      expect(nota(vencida16)).toMatchObject({ vence: restarDias(hoy, 16), diasAtraso: 16 });

      const cli15 = r.clientes.find((c) => c.clienteId === plazo15)!;
      expect(cli15.vencidoCentavos).toBe(1000);
      expect(r.clientes.find((c) => c.clienteId === sinPlazo)!.vencidoCentavos).toBe(0);
    });

    it('totales de la sucursal = suma de sus clientes; soloVencidas los recalcula', async () => {
      const todo = await deQc();
      expect(todo.totalCentavos).toBe(
        todo.clientes.reduce((s, c) => s + c.saldoCentavos, 0),
      );
      expect(todo.vencidoCentavos).toBe(
        todo.clientes.reduce((s, c) => s + c.vencidoCentavos, 0),
      );
      expect(todo.notas).toBe(todo.clientes.reduce((s, c) => s + c.notas.length, 0));

      const vencidas = await deQc({ soloVencidas: 'true' });
      expect(vencidas.totalCentavos).toBe(todo.vencidoCentavos);
      expect(vencidas.vencidoCentavos).toBe(todo.vencidoCentavos);
      expect(vencidas.clientes.flatMap((c) => c.notas).every((n) => n.diasAtraso > 0)).toBe(true);
      expect(vencidas.clientes.map((c) => c.clienteId)).not.toContain(cliUniverso);
      // `soloVencidas=false` es lo mismo que no mandarlo.
      expect(await deQc({ soloVencidas: 'false' })).toEqual(todo);
    });
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm run test:e2e --workspace=apps/backend -- cuentas-por-cobrar`
Expected: FAIL — `GET /cuentas-por-cobrar` responde 404 (y no compila el import de tipos si falta la Tarea 2).

- [ ] **Step 3: DTO**

`dto/cuentas-por-cobrar.dto.ts`:

```ts
import { IsIn, IsOptional, IsString } from 'class-validator';

/** `GET /cuentas-por-cobrar` (T-22). */
export class CuentasPorCobrarDto {
  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;

  @IsOptional()
  @IsIn(['true', 'false'], {
    message: '"soloVencidas" debe ser true o false.',
  })
  soloVencidas?: string;
}
```

- [ ] **Step 4: Repositorio**

`cuentas-por-cobrar.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos } from '../sincronizacion/dinero';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type { FilaNotaPorCobrar } from './reglas-cuentas-por-cobrar';

@Injectable()
export class CuentasPorCobrarRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  buscarSucursalUsuario(usuarioId: string) {
    return buscarSucursalUsuario(this.db, usuarioId);
  }

  /** La fecha de hoy en Tijuana, del reloj de Postgres (nunca UTC). */
  async hoyEnTijuana(): Promise<string> {
    const r = await sql<{ hoy: string }>`
      select to_char((now() at time zone 'America/Tijuana')::date, 'YYYY-MM-DD') as hoy
    `.execute(this.db);
    return r.rows[0].hoy;
  }

  /**
   * Las notas vivas `pendiente`/`abonado` del alcance, con lo abonado en vivo
   * (los abonos de un pago borrado por T-34 tienen `deleted_at` y no cuentan) y
   * el vencimiento contra `hoy`. La sucursal es la del CLIENTE, como Cobranza.
   * `date + int` da `date` y `date - date` da dias enteros.
   */
  async notas(
    hoy: string,
    codigoSucursal: string | null,
  ): Promise<FilaNotaPorCobrar[]> {
    const filas = await sql<{
      id: string;
      cliente_id: string;
      cliente: string;
      sucursal_codigo: string;
      fecha: string;
      folio: string;
      num_nota: string | null;
      monto_total: string;
      abonado: string;
      status: string;
      vence: string | null;
      dias_atraso: number;
    }>`
      select vn.id, vn.cliente_id, c.nombre as cliente, s.codigo as sucursal_codigo,
             to_char(vn.fecha, 'YYYY-MM-DD') as fecha, vn.folio, vn.num_nota,
             vn.monto_total::text as monto_total,
             coalesce(a.abonado, 0)::text as abonado,
             vn.status,
             to_char(vn.fecha + c.plazo_credito_dias, 'YYYY-MM-DD') as vence,
             case when c.plazo_credito_dias is null then 0
                  else greatest(${hoy}::date - (vn.fecha + c.plazo_credito_dias), 0)
             end as dias_atraso
        from venta_nota vn
        join cliente c on c.id = vn.cliente_id
        join sucursal s on s.id = c.sucursal_id
        left join lateral (
          select sum(ca.monto) as abonado
            from cobranza_abono ca
           where ca.venta_nota_id = vn.id
             and ca.deleted_at is null
        ) a on true
       where vn.deleted_at is null
         and vn.status in ('pendiente', 'abonado')
         and (${codigoSucursal}::text is null or s.codigo = ${codigoSucursal}::text)
    `.execute(this.db);

    return filas.rows.map((f) => ({
      id: f.id,
      clienteId: f.cliente_id,
      cliente: f.cliente,
      sucursalCodigo: f.sucursal_codigo,
      fecha: f.fecha,
      folio: f.folio,
      numNota: f.num_nota,
      montoCentavos: aCentavos(f.monto_total),
      abonadoCentavos: aCentavos(f.abonado),
      status: f.status as 'pendiente' | 'abonado',
      vence: f.vence,
      diasAtraso: Number(f.dias_atraso),
    }));
  }
}
```

- [ ] **Step 5: Servicio, controlador y módulo**

`cuentas-por-cobrar.service.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import { CuentasPorCobrarRepository } from './cuentas-por-cobrar.repository';
import type { CuentasPorCobrarDto } from './dto/cuentas-por-cobrar.dto';
import {
  armarCuentasPorCobrar,
  type CuentasPorCobrar,
} from './reglas-cuentas-por-cobrar';

@Injectable()
export class CuentasPorCobrarService {
  constructor(private readonly repo: CuentasPorCobrarRepository) {}

  async consultar(
    usuarioId: string,
    q: CuentasPorCobrarDto,
  ): Promise<CuentasPorCobrar> {
    // El guard valido la firma del token, no que el usuario siga existiendo.
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(q.sucursal),
    );

    const hoy = await this.repo.hoyEnTijuana();
    const filas = await this.repo.notas(
      hoy,
      alcance.tipo === 'una' ? alcance.codigo : null,
    );
    return armarCuentasPorCobrar(hoy, filas, {
      soloVencidas: q.soloVencidas === 'true',
    });
  }
}
```

`cuentas-por-cobrar.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { CuentasPorCobrarService } from './cuentas-por-cobrar.service';
import { CuentasPorCobrarDto } from './dto/cuentas-por-cobrar.dto';
import type { CuentasPorCobrar } from './reglas-cuentas-por-cobrar';

// T-22. Solo lectura: cobrar se hace en /cobranzas con su propio permiso.
@Controller('cuentas-por-cobrar')
export class CuentasPorCobrarController {
  constructor(private readonly cuentas: CuentasPorCobrarService) {}

  @Get()
  @RequierePermiso('cuentas_cobrar.ver')
  consultar(
    @UsuarioActual() usuarioId: string,
    @Query() q: CuentasPorCobrarDto,
  ): Promise<CuentasPorCobrar> {
    return this.cuentas.consultar(usuarioId, q);
  }
}
```

`cuentas-cobrar-pagar.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CuentasPorCobrarController } from './cuentas-por-cobrar.controller';
import { CuentasPorCobrarRepository } from './cuentas-por-cobrar.repository';
import { CuentasPorCobrarService } from './cuentas-por-cobrar.service';

// "Cuentas por Cobrar y Pagar" del vault. T-22 trae la cara de Cobrar (solo
// lectura sobre venta_nota y cobranza_abono); Pagar es T-23.
@Module({
  controllers: [CuentasPorCobrarController],
  providers: [CuentasPorCobrarService, CuentasPorCobrarRepository],
})
export class CuentasCobrarPagarModule {}
```

- [ ] **Step 6: Correr y ver que pasa**

Run: `npm run test:e2e --workspace=apps/backend -- cuentas-por-cobrar`
Expected: PASS. Si el insert de `cliente` truena por una columna obligatoria que este plan no lista, copia los valores de `sembrarCliente` de `test/cobranzas-portal.e2e-spec.ts` (es la fuente de verdad) y anótalo en el reporte.

Run: `npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend && npm test --workspace=apps/backend`
Expected: todo en verde.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/modules/cuentas-cobrar-pagar apps/backend/test/cuentas-por-cobrar.e2e-spec.ts
git commit -m "T-22: GET /cuentas-por-cobrar (alcance, vencimiento contra Tijuana, solo vencidas)"
```

---

### Tarea 4: Cliente HTTP, formatos y Excel del portal

**Files:**
- Create: `apps/portal/src/lib/cuentas-por-cobrar.ts`
- Test: `apps/portal/src/lib/cuentas-por-cobrar.test.ts`

**Interfaces:**
- Consumes: `apiFetch` (`./api`); `formatearFecha`, `etiquetaSucursal` (`./reportes`); `ETIQUETA_STATUS` (`./ventas`); `DefinicionExcel`, `FilaExcel` (`./excel/definicion`).
- Produces (los usa la Tarea 5):

```ts
export interface NotaPorCobrar { id; fecha; folio; numNota: string | null; montoCentavos; abonadoCentavos; saldoCentavos; status: "pendiente" | "abonado"; vence: string | null; diasAtraso: number }
export interface ClienteConDeuda { clienteId; cliente; sucursalCodigo; saldoCentavos; vencidoCentavos; notas: NotaPorCobrar[] }
export interface CuentasPorCobrar { hoy; totalCentavos; vencidoCentavos; notas: number; clientes: ClienteConDeuda[] }
export function obtenerCuentasPorCobrar(f: { sucursal: string | null; soloVencidas: boolean }): Promise<CuentasPorCobrar>
export function textoVence(n: { vence: string | null; diasAtraso: number }): string
export function enlaceCobrar(clienteId: string, notaId: string, sucursal: string | null): string
export function definicionExcelCuentasPorCobrar(datos: CuentasPorCobrar, filtros: { sucursal: string; soloVencidas: boolean }): DefinicionExcel
```

- [ ] **Step 1: Escribir las pruebas (fallan)**

`cuentas-por-cobrar.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  definicionExcelCuentasPorCobrar,
  enlaceCobrar,
  obtenerCuentasPorCobrar,
  textoVence,
  type CuentasPorCobrar,
} from "./cuentas-por-cobrar";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

const DATOS: CuentasPorCobrar = {
  hoy: "2026-10-14",
  totalCentavos: 29900,
  vencidoCentavos: 14950,
  notas: 2,
  clientes: [
    {
      clienteId: "c1",
      cliente: "Cobach XXI",
      sucursalCodigo: "TJ",
      saldoCentavos: 29900,
      vencidoCentavos: 14950,
      notas: [
        { id: "n1", fecha: "2026-09-13", folio: "TJ260913AP05", numNota: "2346", montoCentavos: 14950, abonadoCentavos: 0, saldoCentavos: 14950, status: "pendiente", vence: "2026-09-28", diasAtraso: 16 },
        { id: "n2", fecha: "2026-10-10", folio: "TJ261010AP02", numNota: null, montoCentavos: 20000, abonadoCentavos: 5050, saldoCentavos: 14950, status: "abonado", vence: null, diasAtraso: 0 },
      ],
    },
  ],
};

describe("obtenerCuentasPorCobrar", () => {
  beforeEach(() => apiFetch.mockReset());

  it("sin filtros pide la ruta limpia", async () => {
    apiFetch.mockResolvedValue(DATOS);
    await obtenerCuentasPorCobrar({ sucursal: null, soloVencidas: false });
    expect(apiFetch).toHaveBeenCalledWith("/cuentas-por-cobrar");
  });

  it("agrega sucursal y soloVencidas", async () => {
    apiFetch.mockResolvedValue(DATOS);
    await obtenerCuentasPorCobrar({ sucursal: "TJ", soloVencidas: true });
    expect(apiFetch).toHaveBeenCalledWith("/cuentas-por-cobrar?sucursal=TJ&soloVencidas=true");
  });
});

describe("textoVence", () => {
  it("sin plazo, al corriente, 1 día y varios días", () => {
    expect(textoVence({ vence: null, diasAtraso: 0 })).toBe("Sin plazo");
    expect(textoVence({ vence: "2026-10-25", diasAtraso: 0 })).toBe("25/10/2026 · Al corriente");
    expect(textoVence({ vence: "2026-10-13", diasAtraso: 1 })).toBe("13/10/2026 · 1 día");
    expect(textoVence({ vence: "2026-09-28", diasAtraso: 16 })).toBe("28/09/2026 · 16 días");
  });
});

describe("enlaceCobrar", () => {
  it("lleva cliente y nota, y la sucursal si hay", () => {
    expect(enlaceCobrar("c1", "n1", null)).toBe("/operacion/cobranza?cliente=c1&nota=n1");
    expect(enlaceCobrar("c1", "n1", "TJ")).toBe("/operacion/cobranza?cliente=c1&nota=n1&sucursal=TJ");
  });
});

describe("definicionExcelCuentasPorCobrar", () => {
  it("una fila por nota, en pesos, con total y nombre de archivo", () => {
    const def = definicionExcelCuentasPorCobrar(DATOS, { sucursal: "TJ", soloVencidas: false });
    expect(def.titulo).toBe("Cuentas por Cobrar");
    expect(def.filtros).toEqual([
      ["Fecha", "14/10/2026"],
      ["Sucursal", "TJ"],
      ["Notas", "Todas"],
    ]);
    expect(def.columnas.map((c) => c.encabezado)).toEqual([
      "Cliente", "Sucursal", "Fecha", "Folio", "# nota", "Total", "Abonado", "Saldo", "Status", "Vence", "Días de atraso",
    ]);
    expect(def.filas).toEqual([
      { celdas: ["Cobach XXI", "TJ", "2026-09-13", "TJ260913AP05", "2346", 149.5, 0, 149.5, "Pendiente", "2026-09-28", 16], resaltada: true },
      { celdas: ["Cobach XXI", "TJ", "2026-10-10", "TJ261010AP02", "", 200, 50.5, 149.5, "Abonado", "Sin plazo", 0], resaltada: false },
      { tipo: "total", celdas: ["Total", null, null, null, null, 349.5, 50.5, 299, null, null, null] },
    ]);
    expect(def.nombreArchivo).toBe("cuentas-por-cobrar-TJ-2026-10-14");
  });

  it("Todas → archivo con 'todas'; solo vencidas lo dice en los filtros", () => {
    const def = definicionExcelCuentasPorCobrar(DATOS, { sucursal: "Todas", soloVencidas: true });
    expect(def.filtros[2]).toEqual(["Notas", "Solo vencidas"]);
    expect(def.nombreArchivo).toBe("cuentas-por-cobrar-todas-2026-10-14");
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test --workspace=apps/portal -- cuentas-por-cobrar`
Expected: FAIL — no existe `./cuentas-por-cobrar`.

- [ ] **Step 3: Implementar**

`apps/portal/src/lib/cuentas-por-cobrar.ts`:

```ts
import { apiFetch } from "./api";
import type { DefinicionExcel, FilaExcel } from "./excel/definicion";
import { formatearFecha } from "./reportes";
import { ETIQUETA_STATUS } from "./ventas";

/*
 * Cuentas por Cobrar (T-22). Misma forma que
 * apps/backend/src/modules/cuentas-cobrar-pagar/reglas-cuentas-por-cobrar.ts
 * (el portal no puede importar del backend). Dinero en centavos enteros.
 */

export interface NotaPorCobrar {
  id: string;
  fecha: string;
  folio: string;
  /** `null` = sin nota de papel. */
  numNota: string | null;
  montoCentavos: number;
  abonadoCentavos: number;
  saldoCentavos: number;
  status: "pendiente" | "abonado";
  /** `null` = el cliente no tiene plazo de crédito. */
  vence: string | null;
  /** 0 = al corriente o sin plazo. */
  diasAtraso: number;
}

export interface ClienteConDeuda {
  clienteId: string;
  cliente: string;
  sucursalCodigo: string;
  saldoCentavos: number;
  vencidoCentavos: number;
  notas: NotaPorCobrar[];
}

export interface CuentasPorCobrar {
  /** Hoy en Tijuana, según el servidor. */
  hoy: string;
  totalCentavos: number;
  vencidoCentavos: number;
  notas: number;
  clientes: ClienteConDeuda[];
}

export function obtenerCuentasPorCobrar(f: {
  /** Código, `todas`, o null: lo decide el servidor (`resolverAlcance`). */
  sucursal: string | null;
  soloVencidas: boolean;
}): Promise<CuentasPorCobrar> {
  const q = new URLSearchParams();
  if (f.sucursal) q.set("sucursal", f.sucursal);
  if (f.soloVencidas) q.set("soloVencidas", "true");
  const consulta = q.toString();
  return apiFetch<CuentasPorCobrar>(`/cuentas-por-cobrar${consulta ? `?${consulta}` : ""}`);
}

/** "Sin plazo", "25/10/2026 · Al corriente" o "28/09/2026 · 16 días". */
export function textoVence(n: { vence: string | null; diasAtraso: number }): string {
  if (n.vence === null) return "Sin plazo";
  const fecha = formatearFecha(n.vence);
  if (n.diasAtraso <= 0) return `${fecha} · Al corriente`;
  return `${fecha} · ${n.diasAtraso} ${n.diasAtraso === 1 ? "día" : "días"}`;
}

/** Cobranza abre directo ese cliente con esa nota marcada (T-22, criterio 3). */
export function enlaceCobrar(clienteId: string, notaId: string, sucursal: string | null): string {
  const q = new URLSearchParams({ cliente: clienteId, nota: notaId });
  if (sucursal) q.set("sucursal", sucursal);
  return `/operacion/cobranza?${q.toString()}`;
}

const pesos = (centavos: number): number => centavos / 100;

/** Lo que está en pantalla como hoja de Excel, una fila por nota. */
export function definicionExcelCuentasPorCobrar(
  datos: CuentasPorCobrar,
  filtros: { sucursal: string; soloVencidas: boolean },
): DefinicionExcel {
  const filas: FilaExcel[] = [];
  let monto = 0;
  let abonado = 0;
  for (const c of datos.clientes) {
    for (const n of c.notas) {
      monto += n.montoCentavos;
      abonado += n.abonadoCentavos;
      filas.push({
        celdas: [
          c.cliente,
          c.sucursalCodigo,
          n.fecha,
          n.folio,
          n.numNota ?? "",
          pesos(n.montoCentavos),
          pesos(n.abonadoCentavos),
          pesos(n.saldoCentavos),
          ETIQUETA_STATUS[n.status],
          n.vence ?? "Sin plazo",
          n.diasAtraso,
        ],
        resaltada: n.diasAtraso > 0,
      });
    }
  }
  filas.push({
    tipo: "total",
    celdas: ["Total", null, null, null, null, pesos(monto), pesos(abonado), pesos(datos.totalCentavos), null, null, null],
  });

  const archivoSucursal = filtros.sucursal === "Todas" ? "todas" : filtros.sucursal;
  return {
    titulo: "Cuentas por Cobrar",
    filtros: [
      ["Fecha", formatearFecha(datos.hoy)],
      ["Sucursal", filtros.sucursal],
      ["Notas", filtros.soloVencidas ? "Solo vencidas" : "Todas"],
    ],
    columnas: [
      { encabezado: "Cliente", tipo: "texto", ancho: 30 },
      { encabezado: "Sucursal", tipo: "texto", ancho: 10 },
      { encabezado: "Fecha", tipo: "fecha", ancho: 12 },
      { encabezado: "Folio", tipo: "texto", ancho: 16 },
      { encabezado: "# nota", tipo: "texto", ancho: 10 },
      { encabezado: "Total", tipo: "pesos", ancho: 14 },
      { encabezado: "Abonado", tipo: "pesos", ancho: 14 },
      { encabezado: "Saldo", tipo: "pesos", ancho: 14 },
      { encabezado: "Status", tipo: "texto", ancho: 12 },
      { encabezado: "Vence", tipo: "fecha", ancho: 12 },
      { encabezado: "Días de atraso", tipo: "numero", ancho: 15 },
    ],
    filas,
    nombreArchivo: `cuentas-por-cobrar-${archivoSucursal}-${datos.hoy}`,
  };
}
```

(Nota: `definicion.ts` dice que una columna `fecha` escribe tal cual cualquier texto que no sea `AAAA-MM-DD`; así "Sin plazo" sale como texto. Verifícalo en `construir-libro.ts`; si no fuera así, cambia "Vence" a `tipo: "texto"` y manda `formatearFecha(n.vence)`, ajustando la prueba.)

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test --workspace=apps/portal -- cuentas-por-cobrar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/lib/cuentas-por-cobrar.ts apps/portal/src/lib/cuentas-por-cobrar.test.ts
git commit -m "T-22: portal — cliente de Cuentas por Cobrar, texto de vencimiento, enlace a Cobranza y Excel"
```

---

### Tarea 5: Pantalla Operación → Cuentas por Cobrar

**Files:**
- Create: `apps/portal/src/components/cuentas-por-cobrar/pantalla-cuentas-por-cobrar.tsx`
- Create: `apps/portal/src/components/cuentas-por-cobrar/tabla-cuentas-por-cobrar.tsx`
- Create: `apps/portal/src/app/(portal)/operacion/cuentas-por-cobrar/page.tsx`
- Modify: `apps/portal/src/components/layout/nav-config.ts` (debajo de "Cobranza")
- Test: `apps/portal/src/components/cuentas-por-cobrar/pantalla-cuentas-por-cobrar.test.tsx`

**Interfaces:**
- Consumes: todo lo de la Tarea 4; `useAuth` (`@/components/auth/auth-provider`: `{ usuario, cargando, puede }`); `mensajeDe` (`@/lib/api`); `exportarExcel` (`@/lib/excel/exportar`); `etiquetaSucursal`, `formatearFecha` (`@/lib/reportes`); `formatearPesos`, `ETIQUETA_STATUS` (`@/lib/ventas`); `buttonVariants`, `Button` (`@/components/ui/button`); `Card*` (`@/components/ui/card`).
- Produces: `PantallaCuentasPorCobrar({ sucursal }: { sucursal: string | null })` y la ruta `/operacion/cuentas-por-cobrar`.

- [ ] **Step 1: Escribir las pruebas (fallan)**

`pantalla-cuentas-por-cobrar.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as cxc from "@/lib/cuentas-por-cobrar";
import type { CuentasPorCobrar } from "@/lib/cuentas-por-cobrar";
import * as excel from "@/lib/excel/exportar";
import { PantallaCuentasPorCobrar } from "./pantalla-cuentas-por-cobrar";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/cuentas-por-cobrar", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cuentas-por-cobrar")>();
  return { ...real, obtenerCuentasPorCobrar: vi.fn() };
});
vi.mock("@/lib/excel/exportar", () => ({ exportarExcel: vi.fn() }));

const obtener = vi.mocked(cxc.obtenerCuentasPorCobrar);
const exportarExcel = vi.mocked(excel.exportarExcel);

const DATOS: CuentasPorCobrar = {
  hoy: "2026-10-14",
  totalCentavos: 37700,
  vencidoCentavos: 14950,
  notas: 3,
  clientes: [
    {
      clienteId: "c1", cliente: "Cobach XXI", sucursalCodigo: "TJ", saldoCentavos: 29900, vencidoCentavos: 14950,
      notas: [
        { id: "n1", fecha: "2026-09-13", folio: "TJ260913AP05", numNota: "2346", montoCentavos: 14950, abonadoCentavos: 0, saldoCentavos: 14950, status: "pendiente", vence: "2026-09-28", diasAtraso: 16 },
        { id: "n2", fecha: "2026-10-10", folio: "TJ261010AP02", numNota: null, montoCentavos: 20000, abonadoCentavos: 5050, saldoCentavos: 14950, status: "abonado", vence: null, diasAtraso: 0 },
      ],
    },
    {
      clienteId: "c2", cliente: "El Moreno", sucursalCodigo: "MX", saldoCentavos: 7800, vencidoCentavos: 0,
      notas: [
        { id: "n3", fecha: "2026-10-01", folio: "MX261001JP01", numNota: null, montoCentavos: 7800, abonadoCentavos: 0, saldoCentavos: 7800, status: "pendiente", vence: "2026-10-31", diasAtraso: 0 },
      ],
    },
  ],
};

function mockAuth(permisos: string[], codigoSucursal: string | null = null) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: {
      id: "u1", login: "ana", nombre: "Ana", perfil: "Administrador General",
      sucursal: codigoSucursal ? { id: "s", codigo: codigoSucursal, nombre: codigoSucursal } : null,
      permisos,
    },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (clave: string) => permisos.includes(clave),
  });
}

describe("PantallaCuentasPorCobrar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    obtener.mockResolvedValue(DATOS);
    exportarExcel.mockResolvedValue(undefined);
  });

  it("mientras carga la sesión dice Cargando…, no \"No tienes permiso\"", () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: true, cerrarSesion: vi.fn(), puede: () => false });
    render(<PantallaCuentasPorCobrar sucursal={null} />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByText(/No tienes permiso/)).not.toBeInTheDocument();
  });

  it("sin cuentas_cobrar.ver lo dice y no pide nada", () => {
    mockAuth([]);
    render(<PantallaCuentasPorCobrar sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver cuentas por cobrar")).toBeInTheDocument();
    expect(obtener).not.toHaveBeenCalled();
  });

  it("pide al abrir y muestra totales y una fila por cliente", async () => {
    mockAuth(["cuentas_cobrar.ver"]);
    render(<PantallaCuentasPorCobrar sucursal="TJ" />);
    expect(obtener).toHaveBeenCalledWith({ sucursal: "TJ", soloVencidas: false });
    expect(await screen.findByText("$377.00")).toBeInTheDocument();
    expect(screen.getByText("$149.50", { selector: "[data-total='vencido']" })).toBeInTheDocument();
    expect(screen.getByText("3 notas de 2 clientes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cobach XXI/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("TJ260913AP05")).not.toBeInTheDocument();
  });

  it("abre y cierra las notas de un cliente", async () => {
    mockAuth(["cuentas_cobrar.ver"]);
    const u = userEvent.setup();
    render(<PantallaCuentasPorCobrar sucursal={null} />);
    const fila = await screen.findByRole("button", { name: /Cobach XXI/ });
    await u.click(fila);
    expect(fila).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("TJ260913AP05")).toBeInTheDocument();
    expect(screen.getByText("28/09/2026 · 16 días")).toBeInTheDocument();
    expect(screen.getByText("Sin plazo")).toBeInTheDocument();
    await u.click(fila);
    expect(screen.queryByText("TJ260913AP05")).not.toBeInTheDocument();
  });

  it("con cobranza.registrar, Cobrar enlaza a Cobranza con cliente, nota y sucursal", async () => {
    mockAuth(["cuentas_cobrar.ver", "cobranza.registrar"]);
    const u = userEvent.setup();
    render(<PantallaCuentasPorCobrar sucursal="TJ" />);
    await u.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
    expect(screen.getByRole("link", { name: "Cobrar TJ260913AP05" })).toHaveAttribute(
      "href",
      "/operacion/cobranza?cliente=c1&nota=n1&sucursal=TJ",
    );
  });

  it("sin cobranza.registrar no hay botón Cobrar", async () => {
    mockAuth(["cuentas_cobrar.ver"]);
    const u = userEvent.setup();
    render(<PantallaCuentasPorCobrar sucursal={null} />);
    await u.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
    expect(screen.queryByRole("link", { name: /Cobrar/ })).not.toBeInTheDocument();
  });

  it("Solo vencidas vuelve a pedir; una respuesta vieja no pisa la nueva (Review Focus 4)", async () => {
    mockAuth(["cuentas_cobrar.ver"]);
    let soltarVieja: (d: CuentasPorCobrar) => void = () => {};
    obtener
      .mockImplementationOnce(() => new Promise((r) => { soltarVieja = r; }))
      .mockResolvedValueOnce({ ...DATOS, totalCentavos: 14950, notas: 1, clientes: [{ ...DATOS.clientes[0], saldoCentavos: 14950, notas: [DATOS.clientes[0].notas[0]] }] });
    const u = userEvent.setup();
    render(<PantallaCuentasPorCobrar sucursal={null} />);
    await u.click(screen.getByRole("checkbox", { name: "Solo vencidas" }));
    expect(obtener).toHaveBeenLastCalledWith({ sucursal: null, soloVencidas: true });
    expect(await screen.findByText("1 nota de 1 cliente")).toBeInTheDocument();
    soltarVieja(DATOS);
    await waitFor(() => expect(screen.getByText("1 nota de 1 cliente")).toBeInTheDocument());
    expect(screen.queryByText("El Moreno")).not.toBeInTheDocument();
  });

  it("sin notas lo dice y deshabilita Excel", async () => {
    mockAuth(["cuentas_cobrar.ver"]);
    obtener.mockResolvedValue({ hoy: "2026-10-14", totalCentavos: 0, vencidoCentavos: 0, notas: 0, clientes: [] });
    render(<PantallaCuentasPorCobrar sucursal={null} />);
    expect(await screen.findByText("No hay cuentas por cobrar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar a Excel" })).toBeDisabled();
  });

  it("muestra el error del servidor", async () => {
    mockAuth(["cuentas_cobrar.ver"]);
    obtener.mockRejectedValue(new ErrorApi(403, "No tienes acceso a esa sucursal."));
    render(<PantallaCuentasPorCobrar sucursal="MX" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes acceso a esa sucursal.");
  });

  it("exporta lo que está en pantalla, con la sucursal del usuario atado", async () => {
    mockAuth(["cuentas_cobrar.ver"], "TJ");
    const u = userEvent.setup();
    render(<PantallaCuentasPorCobrar sucursal={null} />);
    await screen.findByText("$377.00");
    await u.click(screen.getByRole("button", { name: "Exportar a Excel" }));
    expect(exportarExcel).toHaveBeenCalledWith(
      cxc.definicionExcelCuentasPorCobrar(DATOS, { sucursal: "TJ", soloVencidas: false }),
    );
  });
});
```

(Antes de correrla, mira la firma real de `ErrorApi` en `apps/portal/src/lib/api.ts` y cómo la construye `pantalla-kilometraje.test.tsx`; ajusta el `new ErrorApi(…)` a esa firma.)

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test --workspace=apps/portal -- pantalla-cuentas-por-cobrar`
Expected: FAIL — no existe el componente.

- [ ] **Step 3: Implementar la tabla**

`tabla-cuentas-por-cobrar.tsx`:

```tsx
"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { enlaceCobrar, textoVence, type ClienteConDeuda } from "@/lib/cuentas-por-cobrar";
import { formatearFecha } from "@/lib/reportes";
import { ETIQUETA_STATUS, formatearPesos } from "@/lib/ventas";

/** Una fila por cliente; el botón del nombre abre o cierra sus notas. */
export function TablaCuentasPorCobrar({
  clientes,
  sucursal,
  puedeCobrar,
}: {
  clientes: ClienteConDeuda[];
  sucursal: string | null;
  puedeCobrar: boolean;
}) {
  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set());

  function alternar(id: string) {
    setAbiertos((antes) => {
      const despues = new Set(antes);
      if (despues.has(id)) despues.delete(id);
      else despues.add(id);
      return despues;
    });
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left">
          <th className="py-1.5">Cliente</th>
          <th className="py-1.5 text-right">Notas</th>
          <th className="py-1.5 text-right">Saldo</th>
          <th className="py-1.5 text-right">Vencido</th>
        </tr>
      </thead>
      <tbody>
        {clientes.map((c) => {
          const abierto = abiertos.has(c.clienteId);
          return (
            <Fragment key={c.clienteId}>
              <tr className="border-t">
                <td className="py-1.5">
                  <button
                    type="button"
                    aria-expanded={abierto}
                    onClick={() => alternar(c.clienteId)}
                    className="text-left font-medium hover:underline"
                  >
                    {abierto ? "▾" : "▸"} {c.cliente} · {c.sucursalCodigo}
                  </button>
                </td>
                <td className="py-1.5 text-right">{c.notas.length}</td>
                <td className="py-1.5 text-right font-semibold">{formatearPesos(c.saldoCentavos)}</td>
                <td className={`py-1.5 text-right ${c.vencidoCentavos > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                  {formatearPesos(c.vencidoCentavos)}
                </td>
              </tr>
              {abierto && (
                <tr>
                  <td colSpan={4} className="pb-3 pl-6">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="py-1">Fecha</th>
                          <th className="py-1">Folio</th>
                          <th className="py-1"># nota</th>
                          <th className="py-1 text-right">Total</th>
                          <th className="py-1 text-right">Abonado</th>
                          <th className="py-1 text-right">Saldo</th>
                          <th className="py-1">Status</th>
                          <th className="py-1">Vence</th>
                          {puedeCobrar && <th className="py-1" />}
                        </tr>
                      </thead>
                      <tbody>
                        {c.notas.map((n) => (
                          <tr key={n.id} className="border-t">
                            <td className="py-1">{formatearFecha(n.fecha)}</td>
                            <td className="py-1 font-mono">{n.folio}</td>
                            <td className="py-1">{n.numNota ?? "—"}</td>
                            <td className="py-1 text-right">{formatearPesos(n.montoCentavos)}</td>
                            <td className="py-1 text-right">{formatearPesos(n.abonadoCentavos)}</td>
                            <td className="py-1 text-right font-semibold">{formatearPesos(n.saldoCentavos)}</td>
                            <td className="py-1">{ETIQUETA_STATUS[n.status]}</td>
                            <td className={`py-1 ${n.diasAtraso > 0 ? "text-destructive" : ""}`}>{textoVence(n)}</td>
                            {puedeCobrar && (
                              <td className="py-1 text-right">
                                <Link
                                  href={enlaceCobrar(c.clienteId, n.id, sucursal)}
                                  aria-label={`Cobrar ${n.folio}`}
                                  className={buttonVariants({ size: "sm" })}
                                >
                                  Cobrar
                                </Link>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Implementar la pantalla, la página y el menú**

`pantalla-cuentas-por-cobrar.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { mensajeDe } from "@/lib/api";
import {
  definicionExcelCuentasPorCobrar,
  obtenerCuentasPorCobrar,
  type CuentasPorCobrar,
} from "@/lib/cuentas-por-cobrar";
import { exportarExcel } from "@/lib/excel/exportar";
import { etiquetaSucursal } from "@/lib/reportes";
import { formatearPesos } from "@/lib/ventas";
import { TablaCuentasPorCobrar } from "./tabla-cuentas-por-cobrar";

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Operación → Cuentas por Cobrar (T-22). La página monta este componente con
 * `key={sucursal}`: cambiar el selector global de sucursal empieza limpio.
 */
export function PantallaCuentasPorCobrar({ sucursal }: { sucursal: string | null }) {
  const { puede, usuario, cargando: cargandoSesion } = useAuth();
  const permitido = puede("cuentas_cobrar.ver");
  const [soloVencidas, setSoloVencidas] = useState(false);
  const [datos, setDatos] = useState<CuentasPorCobrar | null>(null);
  const [consultadoConVencidas, setConsultadoConVencidas] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Solo la última petición escribe: una lenta que llega tarde no pisa a la nueva.
  const ultima = useRef(0);

  useEffect(() => {
    if (!permitido) return;
    const esta = ++ultima.current;
    setCargando(true);
    setError(null);
    obtenerCuentasPorCobrar({ sucursal, soloVencidas }).then(
      (respuesta) => {
        if (esta !== ultima.current) return;
        setDatos(respuesta);
        setConsultadoConVencidas(soloVencidas);
        setCargando(false);
      },
      (err: unknown) => {
        if (esta !== ultima.current) return;
        setDatos(null);
        setError(mensajeDe(err, "No se pudieron cargar las cuentas por cobrar."));
        setCargando(false);
      },
    );
  }, [permitido, sucursal, soloVencidas]);

  if (cargandoSesion) {
    // Mientras /auth/me no contesta, `puede()` da false a todos (como PantallaKilometraje).
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cuentas por Cobrar</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Cargando…</p>
        </CardContent>
      </Card>
    );
  }

  if (!permitido) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cuentas por Cobrar</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No tienes permiso para ver cuentas por cobrar</p>
        </CardContent>
      </Card>
    );
  }

  async function alExportar() {
    if (!datos) return;
    setError(null);
    setExportando(true);
    try {
      await exportarExcel(
        definicionExcelCuentasPorCobrar(datos, {
          sucursal: etiquetaSucursal(usuario?.sucursal?.codigo ?? null, sucursal),
          soloVencidas: consultadoConVencidas,
        }),
      );
    } catch {
      setError("No se pudo generar el Excel.");
    } finally {
      setExportando(false);
    }
  }

  const hayNotas = datos !== null && datos.clientes.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cuentas por Cobrar</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {datos && (
          <div className="flex flex-wrap gap-8">
            <div>
              <p className="text-sm text-muted-foreground">Total por cobrar</p>
              <p className="text-2xl font-semibold" data-total="total">{formatearPesos(datos.totalCentavos)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Vencido</p>
              <p
                className={`text-2xl font-semibold ${datos.vencidoCentavos > 0 ? "text-destructive" : ""}`}
                data-total="vencido"
              >
                {formatearPesos(datos.vencidoCentavos)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Notas</p>
              <p className="text-2xl font-semibold">
                {plural(datos.notas, "nota", "notas")} de {plural(datos.clientes.length, "cliente", "clientes")}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={soloVencidas} onChange={(e) => setSoloVencidas(e.target.checked)} />
            Solo vencidas
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={!hayNotas || exportando || cargando}
            onClick={() => void alExportar()}
          >
            Exportar a Excel
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {cargando && !datos && <p className="text-sm text-muted-foreground">Cargando…</p>}

        {datos &&
          (hayNotas ? (
            <TablaCuentasPorCobrar
              clientes={datos.clientes}
              sucursal={sucursal}
              puedeCobrar={puede("cobranza.registrar")}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {consultadoConVencidas ? "No hay notas vencidas." : "No hay cuentas por cobrar."}
            </p>
          ))}
      </CardContent>
    </Card>
  );
}
```

Ojo con el texto "3 notas de 2 clientes": el `<p>` lo arma con una sola cadena para que `getByText` lo encuentre entero (ya es así: `{plural(...)} de {plural(...)}` produce nodos de texto adyacentes dentro del mismo elemento, que Testing Library junta). Si la prueba no lo encuentra, usa un template literal: `` {`${plural(…)} de ${plural(…)}`} ``.

`app/(portal)/operacion/cuentas-por-cobrar/page.tsx`:

```tsx
import { PantallaCuentasPorCobrar } from "@/components/cuentas-por-cobrar/pantalla-cuentas-por-cobrar";

// `key`: cambiar la sucursal del selector global vuelve a montar la pantalla
// (sin mostrar datos de la sucursal anterior), como /informacion/reportes/kilometraje.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaCuentasPorCobrar key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
```

`nav-config.ts`, en Operación, justo debajo de Cobranza:

```ts
      { label: "Cobranza", href: "/operacion/cobranza" },
      { label: "Cuentas por Cobrar", href: "/operacion/cuentas-por-cobrar" },
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm test --workspace=apps/portal && npm run lint --workspace=apps/portal && npm run build --workspace=apps/portal`
Expected: todo en verde (si alguna prueba existente cuenta las rutas del menú, actualízala y dilo en el reporte).

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/components/cuentas-por-cobrar "apps/portal/src/app/(portal)/operacion/cuentas-por-cobrar" apps/portal/src/components/layout/nav-config.ts
git commit -m "T-22: pantalla Operación → Cuentas por Cobrar (por cliente, solo vencidas, Excel, Cobrar)"
```

---

### Tarea 6: Cobranza abre directo un cliente con `?cliente=&nota=`

**Files:**
- Modify: `apps/portal/src/app/(portal)/operacion/cobranza/page.tsx`
- Modify: `apps/portal/src/components/cobranza/pantalla-cobranza.tsx`
- Test: `apps/portal/src/components/cobranza/pantalla-cobranza.test.tsx`

**Interfaces:**
- Consumes: `CobranzaCliente({ clienteId, notaInicial, onVolver })` (ya existe, no cambia).
- Produces: `PantallaCobranza({ sucursal, clienteInicial = null, notaInicial = null }: { sucursal: string | null; clienteInicial?: string | null; notaInicial?: string | null })`.

- [ ] **Step 1: Escribir las pruebas (fallan)**

Agregar al `describe("PantallaCobranza")` de `pantalla-cobranza.test.tsx`:

```tsx
  it("con clienteInicial abre directo ese cliente con su nota, y Volver va al buscador", async () => {
    mockAuth(() => true);
    const usuario = userEvent.setup();
    render(<PantallaCobranza sucursal={null} clienteInicial="c1" notaInicial="n1" />);
    expect(await screen.findByText("Cobach XXI")).toBeInTheDocument();
    expect(porCobrarDeCliente).toHaveBeenCalledWith("c1");
    expect(listarClientes).not.toHaveBeenCalled();
    await usuario.click(screen.getByRole("button", { name: /Volver/ }));
    expect(await screen.findByText("Buscar por fecha")).toBeInTheDocument();
  });

  it("sin cobranza.registrar no abre al cliente aunque venga en la dirección", () => {
    mockAuth(() => false);
    render(<PantallaCobranza sucursal={null} clienteInicial="c1" notaInicial="n1" />);
    expect(screen.getByText("No tienes permiso para registrar cobranza")).toBeInTheDocument();
    expect(porCobrarDeCliente).not.toHaveBeenCalled();
  });
```

(Antes de escribirla, revisa en la prueba existente "de la búsqueda entra al cliente y vuelve" cómo se llama el botón de volver y con qué argumentos se llama `porCobrarDeCliente`; usa exactamente esos.)

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test --workspace=apps/portal -- pantalla-cobranza`
Expected: FAIL — `clienteInicial` no existe en las props (error de tipos en el build) o la pantalla abre en el buscador.

- [ ] **Step 3: Implementar**

En `pantalla-cobranza.tsx`:

```tsx
/** Operación → Cobranza (T-21): buscar la cuenta por cobrar y registrar el pago.
 *  Con `clienteInicial` (desde Cuentas por Cobrar, T-22) abre directo ese cliente. */
export function PantallaCobranza({
  sucursal,
  clienteInicial = null,
  notaInicial = null,
}: {
  sucursal: string | null;
  clienteInicial?: string | null;
  notaInicial?: string | null;
}) {
  const { puede, cargando: cargandoSesion } = useAuth();
  const [vista, setVista] = useState<Vista>(() =>
    clienteInicial
      ? { tipo: "cliente", clienteId: clienteInicial, notaId: notaInicial }
      : { tipo: "buscar" },
  );
```

(El resto del componente no cambia.)

En `operacion/cobranza/page.tsx`:

```tsx
import { PantallaCobranza } from "@/components/cobranza/pantalla-cobranza";

// Server component delgado (mismo patron que /operacion/facturas). `cliente` y
// `nota` llegan del boton Cobrar de Cuentas por Cobrar (T-22).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string; cliente?: string; nota?: string }>;
}) {
  const { sucursal, cliente, nota } = await searchParams;
  return (
    <PantallaCobranza
      key={`${sucursal ?? ""}|${cliente ?? ""}|${nota ?? ""}`}
      sucursal={sucursal ?? null}
      clienteInicial={cliente ?? null}
      notaInicial={nota ?? null}
    />
  );
}
```

(El `key` hace que navegar de una nota a otra sin salir de Cobranza vuelva a montar la pantalla con el cliente nuevo; sin él, `useState` se quedaría con el primero.)

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test --workspace=apps/portal && npm run lint --workspace=apps/portal && npm run build --workspace=apps/portal`
Expected: todo en verde.

- [ ] **Step 5: Commit**

```bash
git add "apps/portal/src/app/(portal)/operacion/cobranza/page.tsx" apps/portal/src/components/cobranza/pantalla-cobranza.tsx apps/portal/src/components/cobranza/pantalla-cobranza.test.tsx
git commit -m "T-22: Cobranza abre directo el cliente y la nota que vienen en la dirección"
```

---

### Tarea 7: Verificación completa y prueba a mano

**Files:** ninguno nuevo (vault y PR los hace el agente principal al final).

- [ ] **Step 1: Todo el backend y el portal**

Run (desde la raíz):

```bash
npm run supabase -- test db
npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend
npm test --workspace=apps/backend && npm run test:e2e --workspace=apps/backend
npm run lint --workspace=apps/portal && npm run build --workspace=apps/portal && npm test --workspace=apps/portal
```

Expected: todo en verde. Anotar los conteos (pgTAP, unit, e2e, portal).

- [ ] **Step 2: Prueba a mano en el navegador contra la base LOCAL**

Con `DATABASE_URL` de `.env.development` apuntando al Postgres local (nunca contra `sinmex dev`), backend en el puerto 3010 si el 3000 está ocupado. Con un Administrador General:
1. Operación → Cuentas por Cobrar: totales, clientes, abrir uno, "Vence" con días.
2. "Solo vencidas" reduce la lista y los totales.
3. Cambiar la sucursal del selector global.
4. "Cobrar" abre Cobranza con el cliente y la nota marcada; registrar un abono; volver a Cuentas por Cobrar y ver el saldo nuevo.
5. Exportar a Excel y abrir el archivo.
6. Usuario sin `cuentas_cobrar.ver`: mensaje de permiso.
Capturas para el PR.

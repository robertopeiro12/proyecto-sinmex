# T-49 · Reporte de Ventas (Portal) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operación → Reporte de Ventas: ventas por rango de fechas, agrupadas por día con subtotales, resumen por repartidor, fila TOTAL, filtros (atajos de rango, repartidor, sucursal) y Excel, en una tabla bien alineada.

**Architecture:** Nuevo handler `GET /reportes/ventas` en el `ReportesController` de T-50 (`modules/estadisticas/`): el repositorio trae ventas planas con piezas sumadas de líneas vivas; unas reglas puras agrupan por día, arman el resumen por repartidor y suman. El portal pinta la respuesta en una sola tabla `table-fixed` y exporta con la utilidad de T-15. Sin migración: el permiso `reporte_ventas.ver` ya existe.

**Tech Stack:** NestJS + Kysely (`sql` crudo) + Jest/supertest; Next.js 15 + Vitest + Testing Library; `exceljs` vía `apps/portal/src/lib/excel/`.

**Spec:** `docs/superpowers/specs/2026-10-14-t49-reporte-ventas-design.md`

## Global Constraints

- Permiso: `reporte_ventas.ver` (ya sembrado). **Sin migración.**
- Universo: `venta_nota.deleted_at is null` y `fecha between desde and hasta`, **cualquier status**. Sucursal = **la de la venta** (`venta_nota.sucursal_id`).
- Rango: obligatorio, máximo 366 días, validado con `validarRango` de `apps/backend/src/modules/estadisticas/reglas-kilometraje.ts` (mismos mensajes).
- Cantidad = `sum(cantidad)`, Promo = `sum(cantidad_promocion)` de líneas de `venta_nota_detalle` con `deleted_at is null`; sin líneas vivas → 0.
- Monto en **centavos enteros** con `aCentavos` (`apps/backend/src/modules/sincronizacion/dinero.ts`).
- Repartidor `null` = venta de mostrador → la pantalla y el Excel dicen **"Oficina"**.
- Factura: `N/A` → "N/A"; `pendiente` → "Pendiente"; `facturada` → `factura.numero`.
- Filtro `repartidor`: uuid de vendedor, `oficina`, o ausente (todos). Otro valor → 400 "El repartidor no es válido.".
- Orden: días por fecha asc; ventas del día por folio asc. Resumen por repartidor: monto desc, luego Oficina al final, luego nombre `localeCompare(…, 'es')`.
- Tabla: **una sola `<table>` `table-fixed`**, columnas Fecha · Folio · Cliente · # nota · Repartidor · Status · Factura · Semana · Cantidad · Promo · Monto; **toda celda (`th` y `td`) con `px-3`**; Semana/Cantidad/Promo/Monto `text-right tabular-nums`.
- Respuestas en camelCase. Textos de pantalla en español con acentos; comentarios backend en español sin acentos.
- **No se toca `apps/tablet`.** Comandos desde la raíz con `--workspace=…`. Nunca contra la base en la nube.

## Review Focus

1. **Venta editada con una línea borrada** → sus piezas no cuentan (e2e Tarea 2).
2. **Vendedor inactivo con ventas viejas** → aparece en el filtro como "(inactivo)" y en el reporte con su nombre (prueba de pantalla Tarea 4; el backend no filtra por `activo`).
3. **"Esta semana" pedido un domingo o en cambio de mes, "Este mes" en febrero** → rangos correctos (unitarias Tarea 3).
4. **Cambiar filtros y volver a dar Mostrar mientras una consulta lenta viene en camino** → la vieja no pisa (Tarea 4, con `act` y probando RED una vez).
5. **Columnas pegadas** → toda celda con `px-3` y números a la derecha (prueba de pantalla Tarea 4).

---

### Tarea 1: Reglas puras del Reporte de Ventas (backend)

**Files:**
- Create: `apps/backend/src/modules/estadisticas/reglas-reporte-ventas.ts`
- Test: `apps/backend/src/modules/estadisticas/reglas-reporte-ventas.spec.ts`

**Interfaces:**
- Produces (Tarea 2 los usa tal cual):

```ts
export type StatusVenta = 'pagada' | 'pendiente' | 'abonado' | 'cuenta_perdida' | 'promocion';
export interface FilaVenta { id; fecha; folio; cliente; numNota: string | null; vendedorId: string | null; repartidor: string | null; status: StatusVenta; factura: string; semana: number; cantidad: number; promocion: number; montoCentavos: number }
export type VentaEnReporte = Omit<FilaVenta, 'vendedorId'>;
export interface TotalVentas { ventas: number; cantidad: number; promocion: number; montoCentavos: number }
export interface DiaDeVentas { fecha: string; ventas: VentaEnReporte[]; subtotal: TotalVentas }
export interface RepartidorEnReporte extends TotalVentas { vendedorId: string | null; repartidor: string | null }
export interface ReporteVentas { desde: string; hasta: string; dias: DiaDeVentas[]; porRepartidor: RepartidorEnReporte[]; total: TotalVentas }
export function armarReporteVentas(desde: string, hasta: string, filas: FilaVenta[]): ReporteVentas
```

- [ ] **Step 1: Escribir las pruebas (fallan)**

`reglas-reporte-ventas.spec.ts`:

```ts
import { armarReporteVentas, type FilaVenta } from './reglas-reporte-ventas';

const fila = (extra: Partial<FilaVenta>): FilaVenta => ({
  id: 'v',
  fecha: '2026-10-13',
  folio: 'TJ261013AP01',
  cliente: 'Cobach XXI',
  numNota: null,
  vendedorId: 'juan',
  repartidor: 'Juan Pérez',
  status: 'pagada',
  factura: 'N/A',
  semana: 42,
  cantidad: 20,
  promocion: 2,
  montoCentavos: 13000,
  ...extra,
});

describe('armarReporteVentas', () => {
  it('sin ventas: sin dias, sin repartidores y total en cero', () => {
    expect(armarReporteVentas('2026-10-01', '2026-10-14', [])).toEqual({
      desde: '2026-10-01',
      hasta: '2026-10-14',
      dias: [],
      porRepartidor: [],
      total: { ventas: 0, cantidad: 0, promocion: 0, montoCentavos: 0 },
    });
  });

  it('agrupa por dia (asc) con ventas por folio (asc) y subtotales', () => {
    const r = armarReporteVentas('2026-10-01', '2026-10-14', [
      fila({ id: 'b', fecha: '2026-10-14', folio: 'TJ261014AP02', cantidad: 30, promocion: 0, montoCentavos: 19500 }),
      fila({ id: 'a2', folio: 'TJ261013OF01', vendedorId: null, repartidor: null, cantidad: 12, promocion: 0, montoCentavos: 7800 }),
      fila({ id: 'a1' }),
    ]);
    expect(r.dias.map((d) => d.fecha)).toEqual(['2026-10-13', '2026-10-14']);
    expect(r.dias[0].ventas.map((v) => v.id)).toEqual(['a1', 'a2']);
    expect(r.dias[0].subtotal).toEqual({ ventas: 2, cantidad: 32, promocion: 2, montoCentavos: 20800 });
    expect(r.dias[1].subtotal).toEqual({ ventas: 1, cantidad: 30, promocion: 0, montoCentavos: 19500 });
    expect(r.total).toEqual({ ventas: 3, cantidad: 62, promocion: 2, montoCentavos: 40300 });
    // La venta del reporte no expone vendedorId.
    expect(Object.keys(r.dias[0].ventas[0])).not.toContain('vendedorId');
  });

  it('resumen por repartidor: monto desc, Oficina al final en empate, suma = total', () => {
    const r = armarReporteVentas('2026-10-01', '2026-10-14', [
      fila({ id: '1', vendedorId: 'juan', repartidor: 'Juan Pérez', montoCentavos: 5000, cantidad: 5, promocion: 0 }),
      fila({ id: '2', vendedorId: 'juan', repartidor: 'Juan Pérez', montoCentavos: 5000, cantidad: 5, promocion: 1 }),
      fila({ id: '3', vendedorId: null, repartidor: null, montoCentavos: 10000, cantidad: 10, promocion: 0 }),
      fila({ id: '4', vendedorId: 'ana', repartidor: 'Ana López', montoCentavos: 10000, cantidad: 8, promocion: 0 }),
      fila({ id: '5', vendedorId: 'pedro', repartidor: 'Pedro Ruiz', montoCentavos: 30000, cantidad: 25, promocion: 3 }),
    ]);
    expect(r.porRepartidor.map((p) => p.repartidor)).toEqual(['Pedro Ruiz', 'Ana López', 'Juan Pérez', null]);
    expect(r.porRepartidor.find((p) => p.vendedorId === 'juan')).toEqual({
      vendedorId: 'juan', repartidor: 'Juan Pérez', ventas: 2, cantidad: 10, promocion: 1, montoCentavos: 10000,
    });
    const suma = r.porRepartidor.reduce(
      (s, p) => ({ ventas: s.ventas + p.ventas, cantidad: s.cantidad + p.cantidad, promocion: s.promocion + p.promocion, montoCentavos: s.montoCentavos + p.montoCentavos }),
      { ventas: 0, cantidad: 0, promocion: 0, montoCentavos: 0 },
    );
    expect(suma).toEqual(r.total);
  });

  it('una venta sin piezas (todas sus lineas borradas) cuenta en ventas y monto', () => {
    const r = armarReporteVentas('2026-10-01', '2026-10-14', [fila({ cantidad: 0, promocion: 0, montoCentavos: 5000 })]);
    expect(r.total).toEqual({ ventas: 1, cantidad: 0, promocion: 0, montoCentavos: 5000 });
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test --workspace=apps/backend -- reglas-reporte-ventas`
Expected: FAIL — "Cannot find module './reglas-reporte-ventas'".

- [ ] **Step 3: Implementar**

`reglas-reporte-ventas.ts`:

```ts
/*
 * Reporte de Ventas (T-49): las reglas sin base de datos. El repositorio trae
 * ventas planas (piezas ya sumadas de lineas vivas, monto en centavos); aqui se
 * agrupan por dia, se arma el resumen por repartidor y se suma. La fuente de
 * julio lo pide asi: "resultados por vendedor y por dia". El portal tiene una
 * copia de estas formas en `lib/reporte-ventas.ts`.
 */

export type StatusVenta =
  | 'pagada'
  | 'pendiente'
  | 'abonado'
  | 'cuenta_perdida'
  | 'promocion';

/** Lo que trae el SQL por venta. */
export interface FilaVenta {
  id: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
  folio: string;
  cliente: string;
  numNota: string | null;
  /** `null` = venta de mostrador (Oficina). Solo para agrupar. */
  vendedorId: string | null;
  repartidor: string | null;
  status: StatusVenta;
  /** 'N/A', 'Pendiente' o el numero de factura. */
  factura: string;
  semana: number;
  cantidad: number;
  promocion: number;
  montoCentavos: number;
}

export type VentaEnReporte = Omit<FilaVenta, 'vendedorId'>;

export interface TotalVentas {
  ventas: number;
  cantidad: number;
  promocion: number;
  montoCentavos: number;
}

export interface DiaDeVentas {
  fecha: string;
  ventas: VentaEnReporte[];
  subtotal: TotalVentas;
}

export interface RepartidorEnReporte extends TotalVentas {
  /** `null` = Oficina. */
  vendedorId: string | null;
  repartidor: string | null;
}

export interface ReporteVentas {
  desde: string;
  hasta: string;
  dias: DiaDeVentas[];
  porRepartidor: RepartidorEnReporte[];
  total: TotalVentas;
}

const cero = (): TotalVentas => ({
  ventas: 0,
  cantidad: 0,
  promocion: 0,
  montoCentavos: 0,
});

function sumar(t: TotalVentas, f: FilaVenta): void {
  t.ventas += 1;
  t.cantidad += f.cantidad;
  t.promocion += f.promocion;
  t.montoCentavos += f.montoCentavos;
}

export function armarReporteVentas(
  desde: string,
  hasta: string,
  filas: FilaVenta[],
): ReporteVentas {
  const ordenadas = [...filas].sort((a, b) =>
    a.fecha !== b.fecha
      ? a.fecha < b.fecha
        ? -1
        : 1
      : a.folio < b.folio
        ? -1
        : a.folio > b.folio
          ? 1
          : 0,
  );

  const dias: DiaDeVentas[] = [];
  const porVendedor = new Map<string, RepartidorEnReporte>();
  const total = cero();

  for (const f of ordenadas) {
    let dia = dias[dias.length - 1];
    if (!dia || dia.fecha !== f.fecha) {
      dia = { fecha: f.fecha, ventas: [], subtotal: cero() };
      dias.push(dia);
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { vendedorId, ...venta } = f;
    dia.ventas.push(venta);
    sumar(dia.subtotal, f);
    sumar(total, f);

    const llave = f.vendedorId ?? 'oficina';
    let rep = porVendedor.get(llave);
    if (!rep) {
      rep = { vendedorId: f.vendedorId, repartidor: f.repartidor, ...cero() };
      porVendedor.set(llave, rep);
    }
    sumar(rep, f);
  }

  const porRepartidor = [...porVendedor.values()].sort(
    (a, b) =>
      b.montoCentavos - a.montoCentavos ||
      Number(a.repartidor === null) - Number(b.repartidor === null) ||
      (a.repartidor ?? '').localeCompare(b.repartidor ?? '', 'es'),
  );

  return { desde, hasta, dias, porRepartidor, total };
}
```

(Si lint marca la línea `eslint-disable` como innecesaria o prefiere otra forma de omitir `vendedorId`, usa la que pase lint sin cambiar el comportamiento.)

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test --workspace=apps/backend -- reglas-reporte-ventas && npm run lint --workspace=apps/backend`
Expected: PASS (4 pruebas), lint limpio.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/estadisticas/reglas-reporte-ventas.ts apps/backend/src/modules/estadisticas/reglas-reporte-ventas.spec.ts
git commit -m "T-49: reglas del Reporte de Ventas (por día, por repartidor, totales)"
```

---

### Tarea 2: Endpoint `GET /reportes/ventas` (backend + e2e)

**Files:**
- Create: `apps/backend/src/modules/estadisticas/dto/reporte-ventas.dto.ts`
- Create: `apps/backend/src/modules/estadisticas/reporte-ventas.repository.ts`
- Create: `apps/backend/src/modules/estadisticas/reporte-ventas.service.ts`
- Modify: `apps/backend/src/modules/estadisticas/reporte-kilometraje.controller.ts` (nuevo handler + inyección)
- Modify: `apps/backend/src/modules/estadisticas/estadisticas.module.ts` (providers)
- Test: `apps/backend/test/reporte-ventas.e2e-spec.ts`

**Interfaces:**
- Consumes: `armarReporteVentas`, `FilaVenta`, `ReporteVentas`, `StatusVenta` (Tarea 1); `validarRango` (`./reglas-kilometraje`); `aCentavos` (`../sincronizacion/dinero`); `buscarSucursalUsuario` (`../sucursales/buscar-sucursal-usuario`); `resolverAlcance`, `normalizarSucursalPedida` (`../sucursales/alcance-sucursal`).
- Produces: `GET /reportes/ventas?desde&hasta&sucursal&repartidor` → `ReporteVentas`. 400 (rango, repartidor), 401, 403.

- [ ] **Step 1: Escribir la prueba e2e (falla)**

`apps/backend/test/reporte-ventas.e2e-spec.ts`. Usa una **sucursal propia `ZV`** (ordena después de TJ: otras suites toman sucursales por orden de código; `ZA`…`ZH` y `ZQ` ya están en uso) y fechas de **marzo de 2018** para que los totales sean exactos. Copia el arranque, `iniciarSesion` y `crearUsuario` de `test/cuentas-por-cobrar.e2e-spec.ts` (mismo patrón).

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';
import type { ReporteVentas } from './../src/modules/estadisticas/reglas-reporte-ventas';

const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const CODIGO = 'ZV';
const DESDE = '2018-03-01';
const HASTA = '2018-03-31';

describe('Reporte de Ventas (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  const vendedorIds: string[] = [];
  let productoId: string;
  let idZv: string;
  let idTijuana: string;
  let generalId: string;
  let cookieGeneral: string;
  let cookieZv: string;
  let cookieSinPermiso: string;
  let cookieConExcepcion: string;
  let juan: string;
  let pedro: string;
  let pre1: string;
  let pre2: string;
  let folios = 0;
  const ids: Record<string, string> = {};

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
      .values({ login, nombre: login, password_hash: hash, perfil_id: perfilId, sucursal_id: sucursalId })
      .returning('id')
      .executeTakeFirstOrThrow();
    usuarioIds.push(id);
    return id;
  };

  const sembrarCliente = async (nombre: string, sucursalId: string): Promise<string> => {
    const lista = await db.selectFrom('lista_precio').select('id').where('nombre', '=', 'Lista 1').executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('cliente')
      .values({ nombre: `${nombre} ${SUFIJO}`, domicilio: 'Calle 1', telefono: '6640000000', tipo: 'cliente', lista_precio_id: lista.id, sucursal_id: sucursalId })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return id;
  };

  const sembrarVendedor = async (nombre: string): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({ login: `e2e-rv-${vendedorIds.length + 1}-${SUFIJO}`, nombre: `${nombre} ${SUFIJO}`, password_hash: 'x', sucursal_id: idZv })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  /** Venta de portal; `vendedor` null = mostrador. Devuelve el id. */
  const sembrarVenta = async (v: {
    clienteId: string;
    fecha: string;
    vendedor: string | null;
    monto: string;
    status?: string;
    numNota?: string;
    borrada?: boolean;
    semana?: number;
    lineas?: { presentacion: string; cantidad: number; promo?: number; borrada?: boolean }[];
  }): Promise<string> => {
    const cliente = await db.selectFrom('cliente').select('sucursal_id').where('id', '=', v.clienteId).executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('venta_nota')
      .values({
        folio: `ZZV${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha: v.fecha,
        cliente_id: v.clienteId,
        vendedor_id: v.vendedor,
        monto_total: v.monto,
        num_nota: v.numNota ?? null,
        contado_credito: 'contado',
        semana: v.semana ?? 10,
        mes: 3,
        status: v.status ?? 'pagada',
        sucursal_id: cliente.sucursal_id,
        origen: 'portal',
        capturo_usuario_id: generalId,
        deleted_at: v.borrada ? new Date() : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const l of v.lineas ?? []) {
      await db
        .insertInto('venta_nota_detalle')
        .values({ venta_nota_id: id, presentacion_id: l.presentacion, cantidad: l.cantidad, cantidad_promocion: l.promo ?? 0, precio: '6.50', deleted_at: l.borrada ? new Date() : null })
        .execute();
    }
    return id;
  };

  const pedir = (cookie: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/reportes/ventas?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const deZv = async (extra: Record<string, string> = {}): Promise<ReporteVentas> =>
    (await pedir(cookieGeneral, { desde: DESDE, hasta: HASTA, sucursal: CODIGO, ...extra }).expect(200)).body as ReporteVentas;

  const todas = (r: ReporteVentas) => r.dias.flatMap((d) => d.ventas);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    idZv = (
      await db
        .insertInto('sucursal')
        .values({ codigo: CODIGO, nombre: 'Prueba Reporte de Ventas' })
        .onConflict((oc) => oc.column('codigo').doUpdateSet({ deleted_at: null }))
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    idTijuana = (await db.selectFrom('sucursal').select('id').where('codigo', '=', 'TJ').executeTakeFirstOrThrow()).id;

    generalId = await crearUsuario(`e2e-rv-gen-${SUFIJO}`, 'Administrador General', null);
    await crearUsuario(`e2e-rv-zv-${SUFIJO}`, 'Administrador General', idZv);
    await crearUsuario(`e2e-rv-sin-${SUFIJO}`, 'Auxiliar Administrativo', null);
    const conExcepcion = await crearUsuario(`e2e-rv-exc-${SUFIJO}`, 'Auxiliar Administrativo', null);
    const { id: permisoId } = await db.selectFrom('permiso').select('id').where('clave', '=', 'reporte_ventas.ver').executeTakeFirstOrThrow();
    await db.insertInto('usuario_permiso').values({ usuario_id: conExcepcion, permiso_id: permisoId, habilitado: true }).execute();
    cookieGeneral = await iniciarSesion(`e2e-rv-gen-${SUFIJO}`);
    cookieZv = await iniciarSesion(`e2e-rv-zv-${SUFIJO}`);
    cookieSinPermiso = await iniciarSesion(`e2e-rv-sin-${SUFIJO}`);
    cookieConExcepcion = await iniciarSesion(`e2e-rv-exc-${SUFIJO}`);

    productoId = (await db.insertInto('producto').values({ nombre: `Horchata rv ${SUFIJO}` }).returning('id').executeTakeFirstOrThrow()).id;
    pre1 = (await db.insertInto('presentacion').values({ producto_id: productoId, volumen: '1 L' }).returning('id').executeTakeFirstOrThrow()).id;
    pre2 = (await db.insertInto('presentacion').values({ producto_id: productoId, volumen: '500 ml' }).returning('id').executeTakeFirstOrThrow()).id;

    juan = await sembrarVendedor('Juan');
    pedro = await sembrarVendedor('Pedro');
    const cobach = await sembrarCliente('Cobach', idZv);
    const moreno = await sembrarCliente('Moreno', idZv);
    const tienda = await sembrarCliente('Tienda TJ', idTijuana);

    ids.v1 = await sembrarVenta({ clienteId: cobach, fecha: '2018-03-05', vendedor: juan, monto: '130.00', lineas: [{ presentacion: pre1, cantidad: 20, promo: 2 }] });
    ids.v2 = await sembrarVenta({ clienteId: moreno, fecha: '2018-03-05', vendedor: null, monto: '78.00', status: 'pendiente', numNota: '345', lineas: [{ presentacion: pre1, cantidad: 12 }] });
    ids.v3 = await sembrarVenta({ clienteId: cobach, fecha: '2018-03-06', vendedor: pedro, monto: '195.00', status: 'abonado', lineas: [{ presentacion: pre1, cantidad: 30 }, { presentacion: pre2, cantidad: 99, borrada: true }] });
    ids.v4 = await sembrarVenta({ clienteId: moreno, fecha: '2018-03-06', vendedor: juan, monto: '0.00', status: 'promocion', lineas: [{ presentacion: pre2, cantidad: 0, promo: 5 }] });
    ids.v5 = await sembrarVenta({ clienteId: cobach, fecha: '2018-03-07', vendedor: juan, monto: '50.00', status: 'cuenta_perdida', lineas: [{ presentacion: pre1, cantidad: 7, borrada: true }] });
    ids.borrada = await sembrarVenta({ clienteId: cobach, fecha: '2018-03-07', vendedor: pedro, monto: '999.00', borrada: true, lineas: [{ presentacion: pre1, cantidad: 1 }] });
    ids.v7 = await sembrarVenta({ clienteId: moreno, fecha: '2018-03-08', vendedor: pedro, monto: '65.00', lineas: [{ presentacion: pre1, cantidad: 10 }] });
    ids.fuera = await sembrarVenta({ clienteId: cobach, fecha: '2018-02-28', vendedor: juan, monto: '10.00', lineas: [{ presentacion: pre1, cantidad: 1 }] });
    ids.tj = await sembrarVenta({ clienteId: tienda, fecha: '2018-03-05', vendedor: null, monto: '40.00', lineas: [{ presentacion: pre1, cantidad: 4 }] });

    // v7 facturada (T-19): la factura es del mismo cliente.
    const { id: facturaId } = await db
      .insertInto('factura')
      .values({ numero: `a780${SUFIJO}`.slice(0, 30), cliente_id: moreno, creado_por_usuario_id: generalId })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db.updateTable('venta_nota').set({ factura: 'facturada', factura_id: facturaId }).where('id', '=', ids.v7).execute();
    await db.updateTable('venta_nota').set({ factura: 'pendiente' }).where('id', '=', ids.v1).execute();
  });

  afterAll(async () => {
    if (clienteIds.length > 0) {
      const notas = db.selectFrom('venta_nota').select('id').where('cliente_id', 'in', clienteIds);
      await db.deleteFrom('venta_nota_detalle').where('venta_nota_id', 'in', notas).execute();
      await db.deleteFrom('venta_nota').where('cliente_id', 'in', clienteIds).execute();
      await db.deleteFrom('factura').where('cliente_id', 'in', clienteIds).execute();
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    await db.deleteFrom('presentacion').where('producto_id', '=', productoId).execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
    await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
    await db.deleteFrom('usuario_permiso').where('usuario_id', 'in', usuarioIds).execute();
    await db.deleteFrom('sesion_refresh').where('usuario_id', 'in', usuarioIds).execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await db.deleteFrom('sucursal').where('codigo', '=', CODIGO).execute();
    await app.close();
  });

  /* ================================================================ */

  describe('permiso, alcance y validacion', () => {
    it('sin sesion 401; sin reporte_ventas.ver 403; con la excepcion 200', async () => {
      await request(app.getHttpServer()).get(`/reportes/ventas?desde=${DESDE}&hasta=${HASTA}`).expect(401);
      await pedir(cookieSinPermiso, { desde: DESDE, hasta: HASTA }).expect(403);
      await pedir(cookieConExcepcion, { desde: DESDE, hasta: HASTA, sucursal: CODIGO }).expect(200);
    });

    it('rango invalido, invertido o de mas de un ano es 400', async () => {
      await pedir(cookieGeneral, { desde: '2018-02-30', hasta: HASTA }).expect(400);
      await pedir(cookieGeneral, { desde: HASTA, hasta: DESDE }).expect(400);
      await pedir(cookieGeneral, { desde: '2017-01-01', hasta: HASTA }).expect(400);
      await pedir(cookieGeneral, { hasta: HASTA }).expect(400);
    });

    it('repartidor que no es uuid ni "oficina" es 400', async () => {
      await pedir(cookieGeneral, { desde: DESDE, hasta: HASTA, repartidor: 'juan' }).expect(400);
    });

    it('atado a ZV: "todas" o nada le da ZV; pedir TJ es 403', async () => {
      for (const q of [{}, { sucursal: 'todas' }]) {
        const r = (await pedir(cookieZv, { desde: DESDE, hasta: HASTA, ...q }).expect(200)).body as ReporteVentas;
        expect(todas(r).map((v) => v.id)).not.toContain(ids.tj);
        expect(todas(r).map((v) => v.id)).toContain(ids.v1);
      }
      await pedir(cookieZv, { desde: DESDE, hasta: HASTA, sucursal: 'TJ' }).expect(403);
    });
  });

  describe('contenido', () => {
    it('entran todos los status vivos del rango; fuera borradas, fuera de rango y otra sucursal', async () => {
      const r = await deZv();
      expect(todas(r).map((v) => v.id).sort()).toEqual([ids.v1, ids.v2, ids.v3, ids.v4, ids.v5, ids.v7].sort());
      expect(new Set(todas(r).map((v) => v.status))).toEqual(new Set(['pagada', 'pendiente', 'abonado', 'promocion', 'cuenta_perdida']));
    });

    it('piezas solo de lineas vivas; venta sin lineas vivas da 0 (Review Focus 1)', async () => {
      const r = await deZv();
      const v = (id: string) => todas(r).find((x) => x.id === id)!;
      expect(v(ids.v1)).toMatchObject({ cantidad: 20, promocion: 2, montoCentavos: 13000 });
      expect(v(ids.v3)).toMatchObject({ cantidad: 30, promocion: 0, montoCentavos: 19500 });
      expect(v(ids.v4)).toMatchObject({ cantidad: 0, promocion: 5, montoCentavos: 0 });
      expect(v(ids.v5)).toMatchObject({ cantidad: 0, promocion: 0, montoCentavos: 5000 });
    });

    it('repartidor, factura, # nota y semana', async () => {
      const r = await deZv();
      const v = (id: string) => todas(r).find((x) => x.id === id)!;
      expect(v(ids.v1).repartidor).toBe(`Juan ${SUFIJO}`);
      expect(v(ids.v2)).toMatchObject({ repartidor: null, numNota: '345', factura: 'N/A', semana: 10 });
      expect(v(ids.v1).factura).toBe('Pendiente');
      expect(v(ids.v7).factura).toBe(`a780${SUFIJO}`.slice(0, 30));
    });

    it('dias, subtotales, total y resumen por repartidor', async () => {
      const r = await deZv();
      expect(r.desde).toBe(DESDE);
      expect(r.hasta).toBe(HASTA);
      expect(r.dias.map((d) => d.fecha)).toEqual(['2018-03-05', '2018-03-06', '2018-03-07', '2018-03-08']);
      expect(r.dias[0].subtotal).toEqual({ ventas: 2, cantidad: 32, promocion: 2, montoCentavos: 20800 });
      expect(r.total).toEqual({ ventas: 6, cantidad: 72, promocion: 7, montoCentavos: 51800 });
      const rep = (id: string | null) => r.porRepartidor.find((p) => p.vendedorId === id)!;
      expect(rep(pedro)).toMatchObject({ ventas: 2, cantidad: 40, promocion: 0, montoCentavos: 26000 });
      expect(rep(juan)).toMatchObject({ ventas: 3, cantidad: 20, promocion: 7, montoCentavos: 18000 });
      expect(rep(null)).toMatchObject({ repartidor: null, ventas: 1, cantidad: 12, montoCentavos: 7800 });
      expect(r.porRepartidor.map((p) => p.vendedorId)).toEqual([pedro, juan, null]);
    });

    it('filtro por vendedor y por oficina', async () => {
      const soloJuan = await deZv({ repartidor: juan });
      expect(todas(soloJuan).map((v) => v.id).sort()).toEqual([ids.v1, ids.v4, ids.v5].sort());
      expect(soloJuan.porRepartidor).toHaveLength(1);
      const oficina = await deZv({ repartidor: 'oficina' });
      expect(todas(oficina).map((v) => v.id)).toEqual([ids.v2]);
      expect(oficina.total.montoCentavos).toBe(7800);
    });
  });
});
```

(Totales esperados: v1 20/2/130 + v2 12/0/78 + v3 30/0/195 + v4 0/5/0 + v5 0/0/50 + v7 10/0/65 = 72 piezas, 7 promo, $518.00. Juan = v1+v4+v5 = 20/7/180; Pedro = v3+v7 = 40/0/260; Oficina = v2.)

- [ ] **Step 2: Correr y ver que falla**

Run: `npm run test:e2e --workspace=apps/backend -- reporte-ventas`
Expected: FAIL — 404 en `GET /reportes/ventas`.

- [ ] **Step 3: DTO**

`dto/reporte-ventas.dto.ts`:

```ts
import { IsOptional, IsString, Matches } from 'class-validator';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /reportes/ventas` (T-49). El formato lo valida aqui; que el dia exista,
 * el orden y el tope de un año, `validarRango` (reglas-kilometraje.ts). El
 * repartidor (uuid u `oficina`) lo valida el servicio.
 */
export class ReporteVentasDto {
  @Matches(RE_FECHA, {
    message: 'La fecha "desde" debe tener el formato AAAA-MM-DD.',
  })
  desde!: string;

  @Matches(RE_FECHA, {
    message: 'La fecha "hasta" debe tener el formato AAAA-MM-DD.',
  })
  hasta!: string;

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;

  /** Id de vendedor u `oficina` (ventas sin vendedor). */
  @IsOptional()
  @IsString()
  repartidor?: string;
}
```

- [ ] **Step 4: Repositorio**

`reporte-ventas.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos } from '../sincronizacion/dinero';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type { FilaVenta, StatusVenta } from './reglas-reporte-ventas';

export type FiltroRepartidor =
  | { tipo: 'todos' }
  | { tipo: 'oficina' }
  | { tipo: 'vendedor'; id: string };

export interface FiltroVentas {
  desde: string;
  hasta: string;
  /** `null` = todas las sucursales (usuario General sin filtro). */
  codigoSucursal: string | null;
  repartidor: FiltroRepartidor;
}

@Injectable()
export class ReporteVentasRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  buscarSucursalUsuario(usuarioId: string) {
    return buscarSucursalUsuario(this.db, usuarioId);
  }

  /**
   * Las ventas vivas del rango, cualquier status. Piezas de lineas VIVAS (una
   * venta editada puede tener lineas borradas, T-17). La sucursal es la de la
   * VENTA, como la pantalla Ventas.
   */
  async ventas(f: FiltroVentas): Promise<FilaVenta[]> {
    const condiciones = [
      sql`vn.deleted_at is null`,
      sql`vn.fecha between ${f.desde}::date and ${f.hasta}::date`,
    ];
    if (f.codigoSucursal !== null)
      condiciones.push(sql`s.codigo = ${f.codigoSucursal}`);
    if (f.repartidor.tipo === 'oficina')
      condiciones.push(sql`vn.vendedor_id is null`);
    if (f.repartidor.tipo === 'vendedor')
      condiciones.push(sql`vn.vendedor_id = ${f.repartidor.id}::uuid`);

    const filas = await sql<{
      id: string;
      fecha: string;
      folio: string;
      cliente: string;
      num_nota: string | null;
      vendedor_id: string | null;
      repartidor: string | null;
      status: string;
      factura: string;
      semana: number;
      cantidad: number;
      promocion: number;
      monto_total: string;
    }>`
      select vn.id, to_char(vn.fecha, 'YYYY-MM-DD') as fecha, vn.folio,
             c.nombre as cliente, vn.num_nota, vn.vendedor_id,
             v.nombre as repartidor, vn.status,
             case vn.factura
               when 'facturada' then f.numero
               when 'pendiente' then 'Pendiente'
               else 'N/A'
             end as factura,
             vn.semana,
             coalesce(d.cantidad, 0)::int as cantidad,
             coalesce(d.promocion, 0)::int as promocion,
             vn.monto_total::text as monto_total
        from venta_nota vn
        join cliente c on c.id = vn.cliente_id
        join sucursal s on s.id = vn.sucursal_id
        left join vendedor v on v.id = vn.vendedor_id
        left join factura f on f.id = vn.factura_id
        left join lateral (
          select sum(dd.cantidad) as cantidad,
                 sum(dd.cantidad_promocion) as promocion
            from venta_nota_detalle dd
           where dd.venta_nota_id = vn.id
             and dd.deleted_at is null
        ) d on true
       where ${sql.join(condiciones, sql` and `)}
    `.execute(this.db);

    return filas.rows.map((r) => ({
      id: r.id,
      fecha: r.fecha,
      folio: r.folio,
      cliente: r.cliente,
      numNota: r.num_nota,
      vendedorId: r.vendedor_id,
      repartidor: r.repartidor,
      status: r.status as StatusVenta,
      factura: r.factura,
      semana: Number(r.semana),
      cantidad: Number(r.cantidad),
      promocion: Number(r.promocion),
      montoCentavos: aCentavos(r.monto_total),
    }));
  }
}
```

- [ ] **Step 5: Servicio, controlador y módulo**

`reporte-ventas.service.ts`:

```ts
import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import type { ReporteVentasDto } from './dto/reporte-ventas.dto';
import { validarRango } from './reglas-kilometraje';
import {
  armarReporteVentas,
  type ReporteVentas,
} from './reglas-reporte-ventas';
import {
  ReporteVentasRepository,
  type FiltroRepartidor,
} from './reporte-ventas.repository';

@Injectable()
export class ReporteVentasService {
  constructor(private readonly repo: ReporteVentasRepository) {}

  async ventas(usuarioId: string, q: ReporteVentasDto): Promise<ReporteVentas> {
    const error = validarRango(q.desde, q.hasta);
    if (error) throw new BadRequestException(error);
    const repartidor = interpretarRepartidor(q.repartidor);

    // El guard valido la firma del token, no que el usuario siga existiendo.
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(q.sucursal),
    );

    const filas = await this.repo.ventas({
      desde: q.desde,
      hasta: q.hasta,
      codigoSucursal: alcance.tipo === 'una' ? alcance.codigo : null,
      repartidor,
    });
    return armarReporteVentas(q.desde, q.hasta, filas);
  }
}

function interpretarRepartidor(crudo: string | undefined): FiltroRepartidor {
  const valor = crudo?.trim();
  if (!valor) return { tipo: 'todos' };
  if (valor.toLowerCase() === 'oficina') return { tipo: 'oficina' };
  if (isUUID(valor)) return { tipo: 'vendedor', id: valor.toLowerCase() };
  throw new BadRequestException('El repartidor no es válido.');
}
```

En `reporte-kilometraje.controller.ts`, inyectar el servicio nuevo y agregar el handler (el resto no cambia):

```ts
import { ReporteVentasDto } from './dto/reporte-ventas.dto';
import type { ReporteVentas } from './reglas-reporte-ventas';
import { ReporteVentasService } from './reporte-ventas.service';

// …dentro de la clase:
  constructor(
    private readonly kilometraje: ReporteKilometrajeService,
    private readonly ventasSrv: ReporteVentasService,
  ) {}

  // T-49. Permiso propio del Reporte de Ventas (sembrado en T-05), no `reportes.ver`.
  @Get('ventas')
  @RequierePermiso('reporte_ventas.ver')
  reporteVentas(
    @UsuarioActual() usuarioId: string,
    @Query() q: ReporteVentasDto,
  ): Promise<ReporteVentas> {
    return this.ventasSrv.ventas(usuarioId, q);
  }
```

Y actualiza su comentario de cabecera: "T-50 y T-49. Kilometraje usa `reportes.ver`; Ventas, `reporte_ventas.ver`."

`estadisticas.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ReportesController } from './reporte-kilometraje.controller';
import { ReporteKilometrajeRepository } from './reporte-kilometraje.repository';
import { ReporteKilometrajeService } from './reporte-kilometraje.service';
import { ReporteVentasRepository } from './reporte-ventas.repository';
import { ReporteVentasService } from './reporte-ventas.service';

// "Estadisticas y Reportes" del vault. T-50 trae Kilometraje (lee `jornada`);
// T-49, Ventas (lee `venta_nota`). Ninguno escribe nada.
@Module({
  controllers: [ReportesController],
  providers: [
    ReporteKilometrajeService,
    ReporteKilometrajeRepository,
    ReporteVentasService,
    ReporteVentasRepository,
  ],
})
export class EstadisticasModule {}
```

- [ ] **Step 6: Correr y ver que pasa**

Run: `npm run test:e2e --workspace=apps/backend -- reporte-ventas`
Expected: PASS. Si un insert truena por una columna o restricción que este plan no anticipó, cópiala de `test/ventas-editar.e2e-spec.ts` / `test/facturas.e2e-spec.ts` (fuentes de verdad) y anótalo en el reporte.

Run: `npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend && npm test --workspace=apps/backend && npm run test:e2e --workspace=apps/backend`
Expected: todo en verde (incluida `reporte-kilometraje`, que comparte controlador).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/modules/estadisticas apps/backend/test/reporte-ventas.e2e-spec.ts
git commit -m "T-49: GET /reportes/ventas (por día, por repartidor, líneas vivas, alcance)"
```

---

### Tarea 3: Cliente HTTP, atajos de rango y Excel del portal

**Files:**
- Create: `apps/portal/src/lib/reporte-ventas.ts`
- Test: `apps/portal/src/lib/reporte-ventas.test.ts`

**Interfaces:**
- Consumes: `apiFetch` (`./api`); `formatearFecha` (`./reportes`); `ETIQUETA_STATUS` (`./ventas`); `DefinicionExcel`, `FilaExcel` (`./excel/definicion`).
- Produces (Tarea 4):

```ts
export type StatusVenta = "pagada" | "pendiente" | "abonado" | "cuenta_perdida" | "promocion";
export interface VentaEnReporte { id; fecha; folio; cliente; numNota: string | null; repartidor: string | null; status: StatusVenta; factura: string; semana: number; cantidad: number; promocion: number; montoCentavos: number }
export interface TotalVentas { ventas; cantidad; promocion; montoCentavos }
export interface DiaDeVentas { fecha: string; ventas: VentaEnReporte[]; subtotal: TotalVentas }
export interface RepartidorEnReporte extends TotalVentas { vendedorId: string | null; repartidor: string | null }
export interface ReporteVentas { desde; hasta; dias: DiaDeVentas[]; porRepartidor: RepartidorEnReporte[]; total: TotalVentas }
export function obtenerReporteVentas(f: { desde: string; hasta: string; sucursal: string | null; repartidor: string | null }): Promise<ReporteVentas>
export function rangoSemana(hoy: string): { desde: string; hasta: string }
export function rangoMes(hoy: string): { desde: string; hasta: string }
export function nombreRepartidor(r: string | null): string   // null → "Oficina"
export function definicionExcelReporteVentas(r: ReporteVentas, filtros: { sucursal: string; repartidor: string }): DefinicionExcel
```

- [ ] **Step 1: Escribir las pruebas (fallan)**

`reporte-ventas.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  definicionExcelReporteVentas,
  nombreRepartidor,
  obtenerReporteVentas,
  rangoMes,
  rangoSemana,
  type ReporteVentas,
} from "./reporte-ventas";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

const REPORTE: ReporteVentas = {
  desde: "2026-10-13",
  hasta: "2026-10-14",
  dias: [
    {
      fecha: "2026-10-13",
      ventas: [
        { id: "a", fecha: "2026-10-13", folio: "TJ261013AP01", cliente: "Cobach XXI", numNota: null, repartidor: "Juan Pérez", status: "pagada", factura: "N/A", semana: 42, cantidad: 20, promocion: 2, montoCentavos: 13000 },
        { id: "b", fecha: "2026-10-13", folio: "TJ261013OF01", cliente: "El Moreno", numNota: "345", repartidor: null, status: "pendiente", factura: "A780", semana: 42, cantidad: 12, promocion: 0, montoCentavos: 7850 },
      ],
      subtotal: { ventas: 2, cantidad: 32, promocion: 2, montoCentavos: 20850 },
    },
  ],
  porRepartidor: [
    { vendedorId: "j", repartidor: "Juan Pérez", ventas: 1, cantidad: 20, promocion: 2, montoCentavos: 13000 },
    { vendedorId: null, repartidor: null, ventas: 1, cantidad: 12, promocion: 0, montoCentavos: 7850 },
  ],
  total: { ventas: 2, cantidad: 32, promocion: 2, montoCentavos: 20850 },
};

describe("obtenerReporteVentas", () => {
  beforeEach(() => apiFetch.mockReset());

  it("manda rango y omite sucursal y repartidor si no hay", async () => {
    apiFetch.mockResolvedValue(REPORTE);
    await obtenerReporteVentas({ desde: "2026-10-01", hasta: "2026-10-14", sucursal: null, repartidor: null });
    expect(apiFetch).toHaveBeenCalledWith("/reportes/ventas?desde=2026-10-01&hasta=2026-10-14");
  });

  it("agrega sucursal y repartidor", async () => {
    apiFetch.mockResolvedValue(REPORTE);
    await obtenerReporteVentas({ desde: "2026-10-01", hasta: "2026-10-14", sucursal: "TJ", repartidor: "oficina" });
    expect(apiFetch).toHaveBeenCalledWith("/reportes/ventas?desde=2026-10-01&hasta=2026-10-14&sucursal=TJ&repartidor=oficina");
  });
});

describe("atajos de rango (Review Focus 3)", () => {
  it("rangoSemana: lunes a domingo", () => {
    expect(rangoSemana("2026-10-14")).toEqual({ desde: "2026-10-12", hasta: "2026-10-18" }); // miércoles
    expect(rangoSemana("2026-10-12")).toEqual({ desde: "2026-10-12", hasta: "2026-10-18" }); // lunes
    expect(rangoSemana("2026-10-18")).toEqual({ desde: "2026-10-12", hasta: "2026-10-18" }); // domingo
    expect(rangoSemana("2026-11-01")).toEqual({ desde: "2026-10-26", hasta: "2026-11-01" }); // domingo, cambio de mes
    expect(rangoSemana("2026-12-31")).toEqual({ desde: "2026-12-28", hasta: "2027-01-03" }); // cambio de año
  });

  it("rangoMes: del 1 al último día, febrero incluido", () => {
    expect(rangoMes("2026-10-14")).toEqual({ desde: "2026-10-01", hasta: "2026-10-31" });
    expect(rangoMes("2026-02-03")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(rangoMes("2028-02-29")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
    expect(rangoMes("2026-04-30")).toEqual({ desde: "2026-04-01", hasta: "2026-04-30" });
  });
});

describe("nombreRepartidor", () => {
  it("null es Oficina", () => {
    expect(nombreRepartidor(null)).toBe("Oficina");
    expect(nombreRepartidor("Juan Pérez")).toBe("Juan Pérez");
  });
});

describe("definicionExcelReporteVentas", () => {
  it("ventas, subtotal por día, TOTAL y resumen por repartidor, en pesos", () => {
    const def = definicionExcelReporteVentas(REPORTE, { sucursal: "TJ", repartidor: "Todos" });
    expect(def.titulo).toBe("Reporte de Ventas");
    expect(def.filtros).toEqual([
      ["Rango", "13/10/2026 a 14/10/2026"],
      ["Sucursal", "TJ"],
      ["Repartidor", "Todos"],
    ]);
    expect(def.columnas.map((c) => c.encabezado)).toEqual([
      "Fecha", "Folio", "Cliente", "# nota", "Repartidor", "Status", "Factura", "Semana", "Cantidad", "Promo", "Monto",
    ]);
    expect(def.columnas.map((c) => c.tipo)).toEqual([
      "fecha", "texto", "texto", "texto", "texto", "texto", "texto", "numero", "numero", "numero", "pesos",
    ]);
    expect(def.filas).toEqual([
      { celdas: ["2026-10-13", "TJ261013AP01", "Cobach XXI", "", "Juan Pérez", "Pagada", "N/A", 42, 20, 2, 130] },
      { celdas: ["2026-10-13", "TJ261013OF01", "El Moreno", "345", "Oficina", "Pendiente", "A780", 42, 12, 0, 78.5] },
      { tipo: "subtotal", celdas: ["Total 13/10/2026", null, null, null, null, null, null, null, 32, 2, 208.5] },
      { tipo: "total", celdas: ["TOTAL", null, null, null, null, null, null, null, 32, 2, 208.5] },
      { celdas: [null, null, null, null, null, null, null, null, null, null, null] },
      { tipo: "grupo", celdas: ["Resumen por repartidor", null, null, null, null, null, null, null, null, null, null] },
      { celdas: [null, null, "Juan Pérez (1 venta)", null, null, null, null, null, 20, 2, 130] },
      { celdas: [null, null, "Oficina (1 venta)", null, null, null, null, null, 12, 0, 78.5] },
    ]);
    expect(def.nombreArchivo).toBe("reporte-ventas_2026-10-13_a_2026-10-14");
  });

  it("plural en el resumen", () => {
    const def = definicionExcelReporteVentas(
      { ...REPORTE, porRepartidor: [{ ...REPORTE.porRepartidor[0], ventas: 3 }] },
      { sucursal: "Todas", repartidor: "Juan Pérez" },
    );
    expect(def.filas.at(-1)?.celdas[2]).toBe("Juan Pérez (3 ventas)");
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test --workspace=apps/portal -- reporte-ventas`
Expected: FAIL — no existe `./reporte-ventas`.

- [ ] **Step 3: Implementar**

`apps/portal/src/lib/reporte-ventas.ts`:

```ts
import { apiFetch } from "./api";
import type { DefinicionExcel, FilaExcel } from "./excel/definicion";
import { formatearFecha } from "./reportes";
import { ETIQUETA_STATUS } from "./ventas";

/*
 * Reporte de Ventas (T-49). Misma forma que
 * apps/backend/src/modules/estadisticas/reglas-reporte-ventas.ts (el portal no
 * puede importar del backend). Dinero en centavos enteros.
 */

export type StatusVenta = "pagada" | "pendiente" | "abonado" | "cuenta_perdida" | "promocion";

export interface VentaEnReporte {
  id: string;
  fecha: string;
  folio: string;
  cliente: string;
  numNota: string | null;
  /** `null` = venta de mostrador (Oficina). */
  repartidor: string | null;
  status: StatusVenta;
  /** "N/A", "Pendiente" o el número de factura. */
  factura: string;
  semana: number;
  cantidad: number;
  promocion: number;
  montoCentavos: number;
}

export interface TotalVentas {
  ventas: number;
  cantidad: number;
  promocion: number;
  montoCentavos: number;
}

export interface DiaDeVentas {
  fecha: string;
  ventas: VentaEnReporte[];
  subtotal: TotalVentas;
}

export interface RepartidorEnReporte extends TotalVentas {
  vendedorId: string | null;
  repartidor: string | null;
}

export interface ReporteVentas {
  desde: string;
  hasta: string;
  dias: DiaDeVentas[];
  porRepartidor: RepartidorEnReporte[];
  total: TotalVentas;
}

export function obtenerReporteVentas(f: {
  desde: string;
  hasta: string;
  /** Código, `todas`, o null: lo decide el servidor (`resolverAlcance`). */
  sucursal: string | null;
  /** Id de vendedor, `oficina`, o null (todos). */
  repartidor: string | null;
}): Promise<ReporteVentas> {
  const q = new URLSearchParams({ desde: f.desde, hasta: f.hasta });
  if (f.sucursal) q.set("sucursal", f.sucursal);
  if (f.repartidor) q.set("repartidor", f.repartidor);
  return apiFetch<ReporteVentas>(`/reportes/ventas?${q.toString()}`);
}

const MS_DIA = 24 * 60 * 60 * 1000;

const aFecha = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const aIso = (d: Date): string => d.toISOString().slice(0, 10);

/** Lunes a domingo de la semana de `hoy` (`AAAA-MM-DD`), sin zona horaria de por medio. */
export function rangoSemana(hoy: string): { desde: string; hasta: string } {
  const d = aFecha(hoy);
  const desdeLunes = (d.getUTCDay() + 6) % 7;
  const lunes = new Date(d.getTime() - desdeLunes * MS_DIA);
  return { desde: aIso(lunes), hasta: aIso(new Date(lunes.getTime() + 6 * MS_DIA)) };
}

/** Del día 1 al último día del mes de `hoy`. */
export function rangoMes(hoy: string): { desde: string; hasta: string } {
  const [anio, mes] = hoy.split("-").map(Number);
  const ultimo = new Date(Date.UTC(anio, mes, 0));
  return { desde: `${hoy.slice(0, 8)}01`, hasta: aIso(ultimo) };
}

export function nombreRepartidor(repartidor: string | null): string {
  return repartidor ?? "Oficina";
}

const pesos = (centavos: number): number => centavos / 100;
const vacias = (n: number): null[] => Array.from({ length: n }, () => null);

/**
 * Lo consultado como hoja de Excel. `filtros` son los APLICADOS en la última
 * consulta, no lo que esté escrito ahora en la pantalla.
 */
export function definicionExcelReporteVentas(
  r: ReporteVentas,
  filtros: { sucursal: string; repartidor: string },
): DefinicionExcel {
  const filas: FilaExcel[] = [];
  for (const dia of r.dias) {
    for (const v of dia.ventas) {
      filas.push({
        celdas: [
          v.fecha,
          v.folio,
          v.cliente,
          v.numNota ?? "",
          nombreRepartidor(v.repartidor),
          ETIQUETA_STATUS[v.status],
          v.factura,
          v.semana,
          v.cantidad,
          v.promocion,
          pesos(v.montoCentavos),
        ],
      });
    }
    filas.push({
      tipo: "subtotal",
      celdas: [`Total ${formatearFecha(dia.fecha)}`, ...vacias(7), dia.subtotal.cantidad, dia.subtotal.promocion, pesos(dia.subtotal.montoCentavos)],
    });
  }
  filas.push({
    tipo: "total",
    celdas: ["TOTAL", ...vacias(7), r.total.cantidad, r.total.promocion, pesos(r.total.montoCentavos)],
  });
  filas.push({ celdas: vacias(11) });
  filas.push({ tipo: "grupo", celdas: ["Resumen por repartidor", ...vacias(10)] });
  for (const p of r.porRepartidor) {
    filas.push({
      celdas: [
        null,
        null,
        `${nombreRepartidor(p.repartidor)} (${p.ventas} ${p.ventas === 1 ? "venta" : "ventas"})`,
        ...vacias(5),
        p.cantidad,
        p.promocion,
        pesos(p.montoCentavos),
      ],
    });
  }

  return {
    titulo: "Reporte de Ventas",
    filtros: [
      ["Rango", `${formatearFecha(r.desde)} a ${formatearFecha(r.hasta)}`],
      ["Sucursal", filtros.sucursal],
      ["Repartidor", filtros.repartidor],
    ],
    columnas: [
      { encabezado: "Fecha", tipo: "fecha", ancho: 12 },
      { encabezado: "Folio", tipo: "texto", ancho: 16 },
      { encabezado: "Cliente", tipo: "texto", ancho: 32 },
      { encabezado: "# nota", tipo: "texto", ancho: 10 },
      { encabezado: "Repartidor", tipo: "texto", ancho: 24 },
      { encabezado: "Status", tipo: "texto", ancho: 15 },
      { encabezado: "Factura", tipo: "texto", ancho: 14 },
      { encabezado: "Semana", tipo: "numero", ancho: 9 },
      { encabezado: "Cantidad", tipo: "numero", ancho: 11 },
      { encabezado: "Promo", tipo: "numero", ancho: 9 },
      { encabezado: "Monto", tipo: "pesos", ancho: 14 },
    ],
    filas,
    nombreArchivo: `reporte-ventas_${r.desde}_a_${r.hasta}`,
  };
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test --workspace=apps/portal -- reporte-ventas && npm run lint --workspace=apps/portal`
Expected: PASS, lint limpio.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/lib/reporte-ventas.ts apps/portal/src/lib/reporte-ventas.test.ts
git commit -m "T-49: portal — cliente del Reporte de Ventas, atajos de rango y Excel"
```

---

### Tarea 4: Pantalla Operación → Reporte de Ventas

**Files:**
- Create: `apps/portal/src/components/reporte-ventas/pantalla-reporte-ventas.tsx`
- Create: `apps/portal/src/components/reporte-ventas/tabla-reporte-ventas.tsx`
- Modify: `apps/portal/src/app/(portal)/operacion/reporte-de-ventas/page.tsx` (hoy `Placeholder`)
- Test: `apps/portal/src/components/reporte-ventas/pantalla-reporte-ventas.test.tsx`

**Interfaces:**
- Consumes: todo lo de la Tarea 3; `listarVendedores(sucursal)` y `Vendedor` (`@/lib/vendedores`: `{ id, nombre, activo, … }`); `useAuth` (`{ usuario, cargando, puede }`); `mensajeDe` (`@/lib/api`); `exportarExcel` (`@/lib/excel/exportar`); `etiquetaSucursal`, `formatearFecha` (`@/lib/reportes`); `formatearPesos`, `hoyEnTijuana`, `ETIQUETA_STATUS` (`@/lib/ventas`); `Button` (`@/components/ui/button`); `Card*` (`@/components/ui/card`).
- Produces: `PantallaReporteVentas({ sucursal }: { sucursal: string | null })`; ruta `/operacion/reporte-de-ventas`.

- [ ] **Step 1: Escribir las pruebas (fallan)**

`pantalla-reporte-ventas.test.tsx` (patrón de `components/reportes/pantalla-kilometraje.test.tsx` y `components/cuentas-por-cobrar/pantalla-cuentas-por-cobrar.test.tsx`; revisa la firma real de `ErrorApi` en `lib/api.ts` — es `(message, status, mensajeApi?)`):

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as excel from "@/lib/excel/exportar";
import * as rv from "@/lib/reporte-ventas";
import type { ReporteVentas } from "@/lib/reporte-ventas";
import * as vendedoresLib from "@/lib/vendedores";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaReporteVentas } from "./pantalla-reporte-ventas";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/reporte-ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/reporte-ventas")>();
  return { ...real, obtenerReporteVentas: vi.fn() };
});
vi.mock("@/lib/vendedores", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/vendedores")>();
  return { ...real, listarVendedores: vi.fn() };
});
vi.mock("@/lib/excel/exportar", () => ({ exportarExcel: vi.fn() }));

const obtener = vi.mocked(rv.obtenerReporteVentas);
const listarVendedores = vi.mocked(vendedoresLib.listarVendedores);
const exportarExcel = vi.mocked(excel.exportarExcel);

const REPORTE: ReporteVentas = {
  desde: "2026-10-13",
  hasta: "2026-10-14",
  dias: [
    {
      fecha: "2026-10-13",
      ventas: [
        { id: "a", fecha: "2026-10-13", folio: "TJ261013AP01", cliente: "Cobach XXI", numNota: null, repartidor: "Juan Pérez", status: "pagada", factura: "N/A", semana: 42, cantidad: 20, promocion: 2, montoCentavos: 13000 },
        { id: "b", fecha: "2026-10-13", folio: "TJ261013OF01", cliente: "El Moreno", numNota: "345", repartidor: null, status: "pendiente", factura: "A780", semana: 42, cantidad: 12, promocion: 0, montoCentavos: 7800 },
      ],
      subtotal: { ventas: 2, cantidad: 32, promocion: 2, montoCentavos: 20800 },
    },
    {
      fecha: "2026-10-14",
      ventas: [
        { id: "c", fecha: "2026-10-14", folio: "TJ261014AP01", cliente: "Los Caldotes", numNota: null, repartidor: "Ana Ruiz", status: "abonado", factura: "Pendiente", semana: 42, cantidad: 30, promocion: 0, montoCentavos: 19500 },
      ],
      subtotal: { ventas: 1, cantidad: 30, promocion: 0, montoCentavos: 19500 },
    },
  ],
  porRepartidor: [
    { vendedorId: "ana", repartidor: "Ana Ruiz", ventas: 1, cantidad: 30, promocion: 0, montoCentavos: 19500 },
    { vendedorId: "juan", repartidor: "Juan Pérez", ventas: 1, cantidad: 20, promocion: 2, montoCentavos: 13000 },
    { vendedorId: null, repartidor: null, ventas: 1, cantidad: 12, promocion: 0, montoCentavos: 7800 },
  ],
  total: { ventas: 3, cantidad: 62, promocion: 2, montoCentavos: 40300 },
};

const VENDEDORES = [
  { id: "juan", nombre: "Juan Pérez", login: "juan", sucursalId: "s", sucursalCodigo: "TJ", folioSegmento: "JP", activo: true },
  { id: "viejo", nombre: "Beto Viejo", login: "beto", sucursalId: "s", sucursalCodigo: "TJ", folioSegmento: "BV", activo: false },
];

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

const PERMISO = "reporte_ventas.ver";

describe("PantallaReporteVentas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    obtener.mockResolvedValue(REPORTE);
    listarVendedores.mockResolvedValue(VENDEDORES);
    exportarExcel.mockResolvedValue(undefined);
  });

  it("mientras carga la sesión dice Cargando…, no \"No tienes permiso\"", () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: true, cerrarSesion: vi.fn(), puede: () => false });
    render(<PantallaReporteVentas sucursal={null} />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByText(/No tienes permiso/)).not.toBeInTheDocument();
  });

  it("sin reporte_ventas.ver lo dice y no pide nada", () => {
    mockAuth([]);
    render(<PantallaReporteVentas sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver el reporte de ventas")).toBeInTheDocument();
    expect(obtener).not.toHaveBeenCalled();
    expect(listarVendedores).not.toHaveBeenCalled();
  });

  it("no consulta al abrir; fechas por defecto hoy; Mostrar manda rango, sucursal y repartidor", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal="TJ" />);
    expect(obtener).not.toHaveBeenCalled();
    const hoy = hoyEnTijuana();
    expect(screen.getByLabelText("Desde")).toHaveValue(hoy);
    expect(screen.getByLabelText("Hasta")).toHaveValue(hoy);
    await u.selectOptions(await screen.findByLabelText("Repartidor"), "oficina");
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(obtener).toHaveBeenCalledWith({ desde: hoy, hasta: hoy, sucursal: "TJ", repartidor: "oficina" });
  });

  it("los atajos llenan las fechas sin consultar", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal={null} />);
    const hoy = hoyEnTijuana();
    await u.click(screen.getByRole("button", { name: "Esta semana" }));
    expect(screen.getByLabelText("Desde")).toHaveValue(rv.rangoSemana(hoy).desde);
    expect(screen.getByLabelText("Hasta")).toHaveValue(rv.rangoSemana(hoy).hasta);
    await u.click(screen.getByRole("button", { name: "Este mes" }));
    expect(screen.getByLabelText("Desde")).toHaveValue(rv.rangoMes(hoy).desde);
    await u.click(screen.getByRole("button", { name: "Hoy" }));
    expect(screen.getByLabelText("Hasta")).toHaveValue(hoy);
    expect(obtener).not.toHaveBeenCalled();
  });

  it("vendedor inactivo aparece en el filtro marcado (Review Focus 2)", async () => {
    mockAuth([PERMISO]);
    render(<PantallaReporteVentas sucursal={null} />);
    const filtro = await screen.findByLabelText("Repartidor");
    expect(await within(filtro).findByRole("option", { name: "Beto Viejo (inactivo)" })).toHaveValue("viejo");
    expect(within(filtro).getByRole("option", { name: "Todos" })).toHaveValue("");
    expect(within(filtro).getByRole("option", { name: "Oficina" })).toHaveValue("oficina");
  });

  it("fechas invertidas: aviso y no consulta", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal={null} />);
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-01" } });
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("La fecha inicial no puede ser posterior a la final.");
    expect(obtener).not.toHaveBeenCalled();
  });

  it("pinta ventas, subtotales por día, TOTAL, resumen por repartidor, Oficina y —", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    const tabla = await screen.findByRole("table", { name: "Ventas" });
    expect(within(tabla).getByText("TJ261013AP01")).toBeInTheDocument();
    const filaOficina = within(tabla).getByText("TJ261013OF01").closest("tr")!;
    expect(within(filaOficina).getByText("Oficina")).toBeInTheDocument();
    const filaSinNota = within(tabla).getByText("TJ261013AP01").closest("tr")!;
    expect(within(filaSinNota).getByText("—")).toBeInTheDocument();
    const subtotal = within(tabla).getByText("Total 13/10/2026").closest("tr")!;
    expect(within(subtotal).getByText("32")).toBeInTheDocument();
    expect(within(subtotal).getByText("$208.00")).toBeInTheDocument();
    const total = within(tabla).getByText("TOTAL").closest("tr")!;
    expect(within(total).getByText("62")).toBeInTheDocument();
    expect(within(total).getByText("$403.00")).toBeInTheDocument();
    const resumen = screen.getByRole("table", { name: "Resumen por repartidor" });
    expect(within(resumen).getAllByRole("row").slice(1).map((r) => r.firstChild?.textContent)).toEqual(["Ana Ruiz", "Juan Pérez", "Oficina"]);
    expect(screen.getByText("3 ventas · 62 piezas · 2 promo · $403.00")).toBeInTheDocument();
  });

  it("tabla alineada: toda celda con px-3 y números a la derecha (Review Focus 5)", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    const tabla = await screen.findByRole("table", { name: "Ventas" });
    expect(tabla).toHaveClass("table-fixed");
    for (const celda of within(tabla).getAllByRole("cell").concat(within(tabla).getAllByRole("columnheader"))) {
      expect(celda).toHaveClass("px-3");
    }
    const encabezados = within(tabla).getAllByRole("columnheader").map((h) => h.textContent);
    expect(encabezados).toEqual(["Fecha", "Folio", "Cliente", "# nota", "Repartidor", "Status", "Factura", "Semana", "Cantidad", "Promo", "Monto"]);
    const monto = within(tabla).getByText("$130.00");
    expect(monto).toHaveClass("text-right");
    expect(monto).toHaveClass("tabular-nums");
  });

  it("sin ventas lo dice y Excel queda deshabilitado", async () => {
    mockAuth([PERMISO]);
    obtener.mockResolvedValue({ ...REPORTE, dias: [], porRepartidor: [], total: { ventas: 0, cantidad: 0, promocion: 0, montoCentavos: 0 } });
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(await screen.findByText("No hay ventas en ese rango.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar a Excel" })).toBeDisabled();
  });

  it("error del servidor en role=alert", async () => {
    mockAuth([PERMISO]);
    obtener.mockRejectedValue(new ErrorApi("Bad Request", 400, "El rango no puede pasar de un año."));
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El rango no puede pasar de un año.");
  });

  it("una consulta vieja no pisa a la nueva; Actualizando… mientras (Review Focus 4)", async () => {
    mockAuth([PERMISO]);
    let soltarVieja: (r: ReporteVentas) => void = () => {};
    let soltarNueva: (r: ReporteVentas) => void = () => {};
    obtener
      .mockResolvedValueOnce(REPORTE)
      .mockImplementationOnce(() => new Promise((r) => { soltarVieja = r; }))
      .mockImplementationOnce(() => new Promise((r) => { soltarNueva = r; }));
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    await screen.findByRole("table", { name: "Ventas" });
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByText("Actualizando…")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    const soloUno: ReporteVentas = { ...REPORTE, dias: [REPORTE.dias[1]], porRepartidor: [REPORTE.porRepartidor[0]], total: { ventas: 1, cantidad: 30, promocion: 0, montoCentavos: 19500 } };
    await act(async () => { soltarNueva(soloUno); });
    await act(async () => { soltarVieja(REPORTE); });
    expect(screen.getByText("1 venta · 30 piezas · 0 promo · $195.00")).toBeInTheDocument();
    expect(screen.queryByText("TJ261013AP01")).not.toBeInTheDocument();
    expect(screen.queryByText("Actualizando…")).not.toBeInTheDocument();
  });

  it("exporta lo consultado con sucursal y repartidor aplicados", async () => {
    mockAuth([PERMISO], "TJ");
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal={null} />);
    await screen.findByRole("option", { name: "Juan Pérez" });
    await u.selectOptions(screen.getByLabelText("Repartidor"), "juan");
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    await screen.findByRole("table", { name: "Ventas" });
    // Cambiar el filtro después de consultar no cambia lo que se exporta.
    await u.selectOptions(screen.getByLabelText("Repartidor"), "oficina");
    await u.click(screen.getByRole("button", { name: "Exportar a Excel" }));
    expect(exportarExcel).toHaveBeenCalledWith(
      rv.definicionExcelReporteVentas(REPORTE, { sucursal: "TJ", repartidor: "Juan Pérez" }),
    );
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test --workspace=apps/portal -- pantalla-reporte-ventas`
Expected: FAIL — no existe el componente.

- [ ] **Step 3: Implementar la tabla**

`tabla-reporte-ventas.tsx`:

```tsx
import { Fragment } from "react";
import { formatearFecha } from "@/lib/reportes";
import { nombreRepartidor, type ReporteVentas } from "@/lib/reporte-ventas";
import { ETIQUETA_STATUS, formatearPesos } from "@/lib/ventas";

/*
 * Una sola tabla `table-fixed` para todo el rango (nunca una por día) para que
 * las columnas queden alineadas. Toda celda lleva `px-3` para que ninguna
 * columna quede pegada a otra; los números van a la derecha con `tabular-nums`.
 */
const TH = "sticky top-0 bg-background px-3 py-2 font-medium";
const TD = "px-3 py-1.5";
const NUM = "text-right tabular-nums";

export function TablaReporteVentas({ reporte }: { reporte: ReporteVentas }) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-md border">
      <table aria-label="Ventas" className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-24" />
          <col className="w-36" />
          <col />
          <col className="w-20" />
          <col className="w-40" />
          <col className="w-32" />
          <col className="w-28" />
          <col className="w-20" />
          <col className="w-24" />
          <col className="w-20" />
          <col className="w-32" />
        </colgroup>
        <thead className="border-b text-left">
          <tr>
            <th className={TH}>Fecha</th>
            <th className={TH}>Folio</th>
            <th className={TH}>Cliente</th>
            <th className={TH}># nota</th>
            <th className={TH}>Repartidor</th>
            <th className={TH}>Status</th>
            <th className={TH}>Factura</th>
            <th className={`${TH} ${NUM}`}>Semana</th>
            <th className={`${TH} ${NUM}`}>Cantidad</th>
            <th className={`${TH} ${NUM}`}>Promo</th>
            <th className={`${TH} ${NUM}`}>Monto</th>
          </tr>
        </thead>
        <tbody>
          {reporte.dias.map((dia) => (
            <Fragment key={dia.fecha}>
              {dia.ventas.map((v) => (
                <tr key={v.id} className="border-t">
                  <td className={TD}>{formatearFecha(v.fecha)}</td>
                  <td className={`${TD} font-mono`}>{v.folio}</td>
                  <td className={`${TD} truncate`} title={v.cliente}>
                    {v.cliente}
                  </td>
                  <td className={TD}>{v.numNota ?? "—"}</td>
                  <td className={`${TD} truncate`} title={nombreRepartidor(v.repartidor)}>
                    {nombreRepartidor(v.repartidor)}
                  </td>
                  <td className={TD}>{ETIQUETA_STATUS[v.status]}</td>
                  <td className={`${TD} truncate`} title={v.factura}>
                    {v.factura}
                  </td>
                  <td className={`${TD} ${NUM}`}>{v.semana}</td>
                  <td className={`${TD} ${NUM}`}>{v.cantidad}</td>
                  <td className={`${TD} ${NUM}`}>{v.promocion}</td>
                  <td className={`${TD} ${NUM}`}>{formatearPesos(v.montoCentavos)}</td>
                </tr>
              ))}
              <tr className="border-t bg-muted/40 font-semibold">
                <td className={TD} colSpan={8}>
                  Total {formatearFecha(dia.fecha)}
                </td>
                <td className={`${TD} ${NUM}`}>{dia.subtotal.cantidad}</td>
                <td className={`${TD} ${NUM}`}>{dia.subtotal.promocion}</td>
                <td className={`${TD} ${NUM}`}>{formatearPesos(dia.subtotal.montoCentavos)}</td>
              </tr>
            </Fragment>
          ))}
          <tr className="border-t-4 border-double font-bold">
            <td className={TD} colSpan={8}>
              TOTAL
            </td>
            <td className={`${TD} ${NUM}`}>{reporte.total.cantidad}</td>
            <td className={`${TD} ${NUM}`}>{reporte.total.promocion}</td>
            <td className={`${TD} ${NUM}`}>{formatearPesos(reporte.total.montoCentavos)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function ResumenRepartidores({ reporte }: { reporte: ReporteVentas }) {
  return (
    <table aria-label="Resumen por repartidor" className="w-full max-w-2xl table-fixed text-sm">
      <colgroup>
        <col />
        <col className="w-20" />
        <col className="w-24" />
        <col className="w-20" />
        <col className="w-32" />
      </colgroup>
      <thead className="border-b text-left">
        <tr>
          <th className={`${TD} font-medium`}>Repartidor</th>
          <th className={`${TD} ${NUM} font-medium`}>Ventas</th>
          <th className={`${TD} ${NUM} font-medium`}>Cantidad</th>
          <th className={`${TD} ${NUM} font-medium`}>Promo</th>
          <th className={`${TD} ${NUM} font-medium`}>Monto</th>
        </tr>
      </thead>
      <tbody>
        {reporte.porRepartidor.map((p) => (
          <tr key={p.vendedorId ?? "oficina"} className="border-t">
            <td className={`${TD} truncate`}>{nombreRepartidor(p.repartidor)}</td>
            <td className={`${TD} ${NUM}`}>{p.ventas}</td>
            <td className={`${TD} ${NUM}`}>{p.cantidad}</td>
            <td className={`${TD} ${NUM}`}>{p.promocion}</td>
            <td className={`${TD} ${NUM}`}>{formatearPesos(p.montoCentavos)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

(Nota: la prueba "pinta…" lee el nombre del repartidor con `r.firstChild?.textContent` en el resumen; la primera celda es el nombre.)

- [ ] **Step 4: Implementar la pantalla y la página**

`pantalla-reporte-ventas.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { mensajeDe } from "@/lib/api";
import { exportarExcel } from "@/lib/excel/exportar";
import { etiquetaSucursal } from "@/lib/reportes";
import {
  definicionExcelReporteVentas,
  obtenerReporteVentas,
  rangoMes,
  rangoSemana,
  type ReporteVentas,
} from "@/lib/reporte-ventas";
import { listarVendedores, type Vendedor } from "@/lib/vendedores";
import { formatearPesos, hoyEnTijuana } from "@/lib/ventas";
import { ResumenRepartidores, TablaReporteVentas } from "./tabla-reporte-ventas";

/** Lo consultado y con qué filtros: es lo que se exporta. */
interface Consultado {
  reporte: ReporteVentas;
  sucursal: string;
  repartidor: string;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Operación → Reporte de Ventas (T-49): "resultados por vendedor y por día".
 * La página la monta con `key={sucursal}`: cambiar la sucursal empieza limpio.
 */
export function PantallaReporteVentas({ sucursal }: { sucursal: string | null }) {
  const { puede, usuario, cargando: cargandoSesion } = useAuth();
  const permitido = puede("reporte_ventas.ver");
  const [desde, setDesde] = useState(() => hoyEnTijuana());
  const [hasta, setHasta] = useState(() => hoyEnTijuana());
  const [repartidor, setRepartidor] = useState("");
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [consultado, setConsultado] = useState<Consultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Solo la última consulta escribe: una lenta que llega tarde no pisa a la nueva.
  const ultima = useRef(0);

  useEffect(() => {
    if (!permitido) return;
    let vigente = true;
    listarVendedores(sucursal).then(
      (lista) => {
        if (vigente) setVendedores(lista);
      },
      () => {
        // Sin la lista, el filtro se queda en "Todos" y "Oficina": el reporte sigue sirviendo.
      },
    );
    return () => {
      vigente = false;
    };
  }, [permitido, sucursal]);

  if (cargandoSesion) {
    // Mientras /auth/me no contesta, `puede()` da false a todos (como PantallaKilometraje).
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reporte de Ventas</CardTitle>
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
          <CardTitle>Reporte de Ventas</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No tienes permiso para ver el reporte de ventas</p>
        </CardContent>
      </Card>
    );
  }

  function aplicar(r: { desde: string; hasta: string }) {
    setDesde(r.desde);
    setHasta(r.hasta);
  }

  function etiquetaRepartidor(valor: string): string {
    if (valor === "") return "Todos";
    if (valor === "oficina") return "Oficina";
    return vendedores.find((v) => v.id === valor)?.nombre ?? "Todos";
  }

  async function alMostrar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (desde > hasta) {
      setError("La fecha inicial no puede ser posterior a la final.");
      return;
    }
    const esta = ++ultima.current;
    const filtroRepartidor = repartidor;
    setCargando(true);
    try {
      const reporte = await obtenerReporteVentas({
        desde,
        hasta,
        sucursal,
        repartidor: filtroRepartidor || null,
      });
      if (esta !== ultima.current) return;
      setConsultado({
        reporte,
        sucursal: etiquetaSucursal(usuario?.sucursal?.codigo ?? null, sucursal),
        repartidor: etiquetaRepartidor(filtroRepartidor),
      });
    } catch (err) {
      if (esta !== ultima.current) return;
      setConsultado(null);
      setError(mensajeDe(err, "No se pudo consultar el reporte."));
    } finally {
      if (esta === ultima.current) setCargando(false);
    }
  }

  async function alExportar() {
    if (!consultado) return;
    setError(null);
    setExportando(true);
    try {
      await exportarExcel(
        definicionExcelReporteVentas(consultado.reporte, {
          sucursal: consultado.sucursal,
          repartidor: consultado.repartidor,
        }),
      );
    } catch {
      setError("No se pudo generar el Excel.");
    } finally {
      setExportando(false);
    }
  }

  const hoy = hoyEnTijuana();
  const reporte = consultado?.reporte ?? null;
  const hayVentas = reporte !== null && reporte.dias.length > 0;
  const actualizando = cargando && consultado !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reporte de Ventas</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={alMostrar} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rv-desde" className="text-sm font-medium">
              Desde
            </label>
            <input
              id="rv-desde"
              type="date"
              required
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rv-hasta" className="text-sm font-medium">
              Hasta
            </label>
            <input
              id="rv-hasta"
              type="date"
              required
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => aplicar({ desde: hoy, hasta: hoy })}>
              Hoy
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => aplicar(rangoSemana(hoy))}>
              Esta semana
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => aplicar(rangoMes(hoy))}>
              Este mes
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rv-repartidor" className="text-sm font-medium">
              Repartidor
            </label>
            <select
              id="rv-repartidor"
              value={repartidor}
              onChange={(e) => setRepartidor(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <option value="">Todos</option>
              <option value="oficina">Oficina</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.activo ? v.nombre : `${v.nombre} (inactivo)`}
                </option>
              ))}
            </select>
          </div>
          {/* Siempre activo: se puede corregir un filtro y volver a consultar; la guarda `ultima` descarta lo viejo. */}
          <Button type="submit">Mostrar</Button>
          <Button
            type="button"
            variant="outline"
            disabled={!hayVentas || exportando || cargando}
            onClick={() => void alExportar()}
          >
            Exportar a Excel
          </Button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {cargando && !consultado && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {actualizando && <p className="text-sm text-muted-foreground">Actualizando…</p>}

        {reporte &&
          (hayVentas ? (
            <div aria-busy={actualizando} className={`flex flex-col gap-5 ${actualizando ? "opacity-60" : ""}`}>
              <p className="text-sm font-medium">
                {`${plural(reporte.total.ventas, "venta", "ventas")} · ${plural(reporte.total.cantidad, "pieza", "piezas")} · ${reporte.total.promocion} promo · ${formatearPesos(reporte.total.montoCentavos)}`}
              </p>
              <ResumenRepartidores reporte={reporte} />
              <TablaReporteVentas reporte={reporte} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No hay ventas en ese rango.</p>
          ))}
      </CardContent>
    </Card>
  );
}
```

`app/(portal)/operacion/reporte-de-ventas/page.tsx`:

```tsx
import { PantallaReporteVentas } from "@/components/reporte-ventas/pantalla-reporte-ventas";

// `key`: cambiar la sucursal del selector global vuelve a montar la pantalla
// (filtros y resultados limpios), como /informacion/reportes/kilometraje.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaReporteVentas key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
```

- [ ] **Step 5: Correr y ver que pasa; probar RED de la guarda una vez**

Run: `npm test --workspace=apps/portal -- pantalla-reporte-ventas`
Expected: PASS.

Luego, **comenta temporalmente** las dos líneas `if (esta !== ultima.current) return;` de `alMostrar`, corre la misma prueba y confirma que "una consulta vieja no pisa a la nueva" **falla**; restáuralas y confirma verde. Anota ambas salidas en el reporte. No hagas commit de la versión rota. (Usa un editor o `python3` para comentar: `sed` de macOS no acepta la sintaxis de GNU.)

Run: `npm test --workspace=apps/portal && npm run lint --workspace=apps/portal && npm run build --workspace=apps/portal`
Expected: todo en verde, salida limpia (sin advertencias de `act`).

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/components/reporte-ventas "apps/portal/src/app/(portal)/operacion/reporte-de-ventas/page.tsx"
git commit -m "T-49: pantalla Operación → Reporte de Ventas (por día, por repartidor, atajos, Excel)"
```

---

### Tarea 5: Verificación completa y prueba a mano

**Files:** ninguno nuevo (vault y PR los hace el agente principal).

- [ ] **Step 1:** Desde la raíz: `npm run supabase -- test db`, lint + build + unit + e2e del backend, lint + build + test del portal. Todo en verde; anotar conteos.
- [ ] **Step 2:** Navegador contra la base **local** (backend `PORT=3010` con `DATABASE_URL` de `.env.test`; portal con `NEXT_PUBLIC_API_URL=http://localhost:3010`). Sembrar ventas de varios días, un cliente de nombre largo, montos de distintos tamaños, una venta de mostrador, una facturada, una promoción y una con línea borrada. Revisar: atajos, filtro de repartidor (incluido un inactivo), subtotales, TOTAL, resumen, **alineación de columnas**, encabezado fijo con scroll, Excel abierto con `exceljs`, usuario sin permiso. Capturas para el PR.

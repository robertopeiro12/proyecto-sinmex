# T-32 · Flujo de Efectivo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vista de solo lectura *Finanzas → Flujo de Efectivo* por rango: ventas totales, cobradas (repartidor/oficina),
% de cobro, gastos (en $0 hasta T-31), utilidades, Total Tesorería, desglose por día, comentarios y Excel.

**Architecture:** Módulo `flujo-efectivo` del backend (hoy vacío): reglas puras (`reglas-flujo.ts`), un repositorio que
lee ventas y cobranza con SQL agrupado, y un servicio que reutiliza `TesoreriaService.vista` (exportado desde
`TesoreriaModule`) para el Total Tesorería. Portal: una pantalla nueva con el patrón del Reporte de Ventas (T-49).

**Tech Stack:** NestJS + Kysely + Postgres local, Jest; Next.js 15 + React 19 + Tailwind, Vitest; Excel con `lib/excel`.

**Spec:** `docs/superpowers/specs/2026-10-19-t32-flujo-efectivo-design.md` (léelo antes de cada tarea).

## Global Constraints

- Dinero en **centavos enteros** en la API; convertir solo con `aCentavos` (`sincronizacion/dinero.ts`). Sumas en SQL
  como `numeric` → `::text`.
- Ventas Totales: `venta_nota` viva, `fecha` en `[desde, hasta]`, cualquier status, sucursal de la venta.
- Cobradas: `cobro` vivo de origen `cobro` por `fecha_pago` (sucursal del cliente; repartidor si `vendedor_id` no nulo)
  + `cobranza_abono` vivo `venta_contado` de `venta_nota` viva por `fecha_pago` (sucursal de la venta; repartidor si
  `venta_nota.vendedor_id` no nulo). Métodos `efectivo|transferencia|cheque` (nunca `saldo_favor`).
- `% de cobro` = cobradas / totales × 100 redondeado a **1 decimal**; `null` si totales = 0.
- Gastos 0 y `gastosDisponibles: false`. Utilidades encadenadas como en el spec.
- Total Tesorería = `TesoreriaService.vista(usuarioId, { desde, hasta, sucursal }).total.saldoFinalCentavos` (y
  `cuentasConSaldoFinal`, `cuentas`).
- Alcance `resolverAlcance`; rango `validarRango` (≤ 366 días) → 400; permiso `flujo_efectivo.ver` → sin él 403.
- Mensajes en español. Portal en computadora: cabe desde 1366 px. No se toca `apps/tablet`.
- Comandos desde la raíz con `--workspace=…`; no correr el build del portal.

## Review Focus

1. Un cobro **del portal con cobrador vendedor** (no Oficina) → repartidor; uno con cobrador Oficina → oficina — e2e T2.
2. Venta de contado **de mostrador** (vendedor nulo) → oficina; de un vendedor → repartidor — e2e T2.
3. **Abono parcial** cuenta por lo abonado; **saldo a favor** no cuenta; **cobro borrado** no cuenta — e2e T2.
4. **Rango sin ventas pero con cobros** → `porcentajeCobro: null`, cobradas > 0 — unitaria T1.
5. Usuario de TJ pidiendo `sucursal=MX` → 403; sin permiso → 403 — e2e T2.

---

### Tarea 1: Permiso y reglas puras

**Files:**
- Create: `supabase/migrations/20261019140000_permiso_flujo_efectivo.sql`
- Modify: `supabase/tests/93_permiso_sucursal_test.sql` (31 → 32 y su comentario)
- Create: `apps/backend/src/modules/flujo-efectivo/reglas-flujo.ts`, `reglas-flujo.spec.ts`

**Interfaces — Produces (`reglas-flujo.ts`):**
```ts
export interface FilaVentaDia { fecha: string; ventasCentavos: number }
export interface FilaCobroDia { fecha: string; repartidor: boolean; montoCentavos: number }
export interface DiaFlujo { fecha: string; ventasCentavos: number; cobradoRepartidorCentavos: number; cobradoOficinaCentavos: number; porcentajeCobro: number | null }
export interface ResumenFlujo {
  ventasTotalesCentavos: number; cobradoRepartidorCentavos: number; cobradoOficinaCentavos: number;
  ventasCobradasCentavos: number; porcentajeCobro: number | null; gastosDisponibles: boolean;
  gastosProduccionCentavos: number; gastosOperacionCentavos: number; gastosFinancierosCentavos: number;
  utilidadBrutaCentavos: number; utilidadOperacionCentavos: number; utilidadNetaCentavos: number;
  dias: DiaFlujo[];
}
export function porcentajeCobro(cobradas: number, totales: number): number | null; // 1 decimal, null si totales = 0
export function armarResumen(ventas: FilaVentaDia[], cobros: FilaCobroDia[]): ResumenFlujo; // gastos 0, gastosDisponibles false
```

- [ ] **Paso 1: Pruebas (fallan)** — `reglas-flujo.spec.ts`:

```ts
import { armarResumen, porcentajeCobro } from './reglas-flujo';

describe('porcentajeCobro', () => {
  it('redondea a 1 decimal, admite más de 100 y es null sin ventas', () => {
    expect(porcentajeCobro(87_500, 100_000)).toBe(87.5);
    expect(porcentajeCobro(1, 3)).toBe(33.3);
    expect(porcentajeCobro(150_000, 100_000)).toBe(150);
    expect(porcentajeCobro(5_000, 0)).toBeNull();
    expect(porcentajeCobro(0, 0)).toBeNull();
  });
});

describe('armarResumen', () => {
  it('suma ventas y cobros por tipo, encadena utilidades con gastos en 0 y arma los días ordenados', () => {
    const r = armarResumen(
      [
        { fecha: '2026-10-02', ventasCentavos: 40_000 },
        { fecha: '2026-10-01', ventasCentavos: 60_000 },
      ],
      [
        { fecha: '2026-10-01', repartidor: true, montoCentavos: 30_000 },
        { fecha: '2026-10-01', repartidor: false, montoCentavos: 10_000 },
        { fecha: '2026-10-03', repartidor: true, montoCentavos: 5_000 },
      ],
    );
    expect(r).toMatchObject({
      ventasTotalesCentavos: 100_000,
      cobradoRepartidorCentavos: 35_000,
      cobradoOficinaCentavos: 10_000,
      ventasCobradasCentavos: 45_000,
      porcentajeCobro: 45,
      gastosDisponibles: false,
      gastosProduccionCentavos: 0,
      utilidadBrutaCentavos: 45_000,
      utilidadOperacionCentavos: 45_000,
      utilidadNetaCentavos: 45_000,
    });
    expect(r.dias).toEqual([
      { fecha: '2026-10-01', ventasCentavos: 60_000, cobradoRepartidorCentavos: 30_000, cobradoOficinaCentavos: 10_000, porcentajeCobro: 66.7 },
      { fecha: '2026-10-02', ventasCentavos: 40_000, cobradoRepartidorCentavos: 0, cobradoOficinaCentavos: 0, porcentajeCobro: 0 },
      { fecha: '2026-10-03', ventasCentavos: 0, cobradoRepartidorCentavos: 5_000, cobradoOficinaCentavos: 0, porcentajeCobro: null },
    ]);
  });

  it('sin nada, todo en cero y sin días', () => {
    expect(armarResumen([], [])).toMatchObject({ ventasTotalesCentavos: 0, porcentajeCobro: null, dias: [] });
  });
});
```

Run: `npm test --workspace=apps/backend -- reglas-flujo` → FAIL.

- [ ] **Paso 2: Implementar `reglas-flujo.ts`**

```ts
/**
 * T-32 — fórmulas del Flujo de Efectivo (spec §3), puras y en centavos.
 * Gastos en 0 hasta que T-30/T-31 (Mario) traigan Compras y Egresos.
 */

export interface FilaVentaDia { fecha: string; ventasCentavos: number }
export interface FilaCobroDia { fecha: string; repartidor: boolean; montoCentavos: number }
export interface DiaFlujo {
  fecha: string;
  ventasCentavos: number;
  cobradoRepartidorCentavos: number;
  cobradoOficinaCentavos: number;
  porcentajeCobro: number | null;
}
export interface ResumenFlujo {
  ventasTotalesCentavos: number;
  cobradoRepartidorCentavos: number;
  cobradoOficinaCentavos: number;
  ventasCobradasCentavos: number;
  porcentajeCobro: number | null;
  gastosDisponibles: boolean;
  gastosProduccionCentavos: number;
  gastosOperacionCentavos: number;
  gastosFinancierosCentavos: number;
  utilidadBrutaCentavos: number;
  utilidadOperacionCentavos: number;
  utilidadNetaCentavos: number;
  dias: DiaFlujo[];
}

/** Cobradas / totales × 100 con 1 decimal; null si no hubo ventas (puede pasar de 100). */
export function porcentajeCobro(cobradas: number, totales: number): number | null {
  if (totales === 0) return null;
  return Math.round((cobradas * 1000) / totales) / 10;
}

export function armarResumen(ventas: FilaVentaDia[], cobros: FilaCobroDia[]): ResumenFlujo {
  const dias = new Map<string, DiaFlujo>();
  const dia = (fecha: string): DiaFlujo => {
    let d = dias.get(fecha);
    if (!d) {
      d = { fecha, ventasCentavos: 0, cobradoRepartidorCentavos: 0, cobradoOficinaCentavos: 0, porcentajeCobro: null };
      dias.set(fecha, d);
    }
    return d;
  };
  for (const v of ventas) dia(v.fecha).ventasCentavos += v.ventasCentavos;
  for (const c of cobros) {
    const d = dia(c.fecha);
    if (c.repartidor) d.cobradoRepartidorCentavos += c.montoCentavos;
    else d.cobradoOficinaCentavos += c.montoCentavos;
  }
  const lista = [...dias.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  for (const d of lista) {
    d.porcentajeCobro = porcentajeCobro(d.cobradoRepartidorCentavos + d.cobradoOficinaCentavos, d.ventasCentavos);
  }

  const ventasTotales = lista.reduce((s, d) => s + d.ventasCentavos, 0);
  const repartidor = lista.reduce((s, d) => s + d.cobradoRepartidorCentavos, 0);
  const oficina = lista.reduce((s, d) => s + d.cobradoOficinaCentavos, 0);
  const cobradas = repartidor + oficina;
  const produccion = 0;
  const operacion = 0;
  const financieros = 0;
  const bruta = cobradas - produccion;
  const deOperacion = bruta - operacion;
  return {
    ventasTotalesCentavos: ventasTotales,
    cobradoRepartidorCentavos: repartidor,
    cobradoOficinaCentavos: oficina,
    ventasCobradasCentavos: cobradas,
    porcentajeCobro: porcentajeCobro(cobradas, ventasTotales),
    gastosDisponibles: false,
    gastosProduccionCentavos: produccion,
    gastosOperacionCentavos: operacion,
    gastosFinancierosCentavos: financieros,
    utilidadBrutaCentavos: bruta,
    utilidadOperacionCentavos: deOperacion,
    utilidadNetaCentavos: deOperacion - financieros,
    dias: lista,
  };
}
```

Run: `npm test --workspace=apps/backend -- reglas-flujo` → PASS.

- [ ] **Paso 3: Migración y pgTAP**

`supabase/migrations/20261019140000_permiso_flujo_efectivo.sql`:

```sql
-- T-32: Flujo de Efectivo (Portal, solo lectura). Solo agrega el permiso de la
-- pantalla; ninguna tabla cambia. `Administrador General` lo recibe solo
-- (PERFIL_MAESTRO). Sin pre-flight.
insert into permiso (clave, grupo, descripcion) values
  ('flujo_efectivo.ver', 'Finanzas', 'Ver Flujo de Efectivo')
on conflict (clave) do nothing;
```

En `93_permiso_sucursal_test.sql`: el conteo pasa a **32** (`'el catalogo de permisos tiene 32 claves'`) y el
comentario suma "T-32 agrega 32o (flujo_efectivo.ver)".

Run: `npm run supabase -- migration up --local` y `npm run supabase -- test db` → PASS.

- [ ] **Paso 4: Commit** — `git commit -m "T-32: permiso flujo_efectivo.ver y fórmulas del Flujo de Efectivo"`

---

### Tarea 2: Backend — endpoint y e2e

**Files:**
- Create: `apps/backend/src/modules/flujo-efectivo/dto/flujo-efectivo.dto.ts`, `flujo-efectivo.repository.ts`,
  `flujo-efectivo.service.ts`, `flujo-efectivo.controller.ts`
- Modify: `flujo-efectivo.module.ts` (imports `TesoreriaModule`), `tesoreria/tesoreria.module.ts` (`exports: [TesoreriaService]`)
- Test: `apps/backend/test/flujo-efectivo.e2e-spec.ts`

**Interfaces:**
- Consumes: `armarResumen`, `ResumenFlujo` (T1); `TesoreriaService.vista(usuarioId, { desde, hasta, sucursal })`
  (devuelve `VistaTesoreria`); `validarRango`; `resolverAlcance`, `normalizarSucursalPedida`;
  `TesoreriaRepository.buscarSucursalUsuario` o `TesoreriaService.usuario` (público desde T-29).
- Produces: `GET /flujo-efectivo?desde=&hasta=&sucursal=` → `FlujoEfectivo`:
  ```ts
  export interface ComentarioIngreso { fecha: string; folio: string; cliente: string; comentario: string }
  export interface ComentarioEgreso { fecha: string; concepto: 'Retiro' | 'Traspaso'; cuenta: string; montoCentavos: number; comentario: string }
  export interface FlujoEfectivo extends ResumenFlujo {
    desde: string; hasta: string;
    totalTesoreriaCentavos: number; tesoreriaCuentasConSaldo: number; tesoreriaCuentas: number;
    comentarios: { ingresos: ComentarioIngreso[]; egresos: ComentarioEgreso[] };
  }
  ```

- [ ] **Paso 1: e2e (fallan: 404)** — `flujo-efectivo.e2e-spec.ts`. Copia el arranque, `crearUsuario`, `iniciarSesion` y
  la limpieza de `apps/backend/test/tesoreria-movimientos.e2e-spec.ts` (usuarios GENERAL y TIJUANA con `Administrador
  General`, y uno SIN con `Auxiliar Administrativo`; clientes y ventas propios; `borrarCobrosDe`). Usa **fechas de
  noviembre de 2018** y clientes propios para no chocar con otras suites. Siembra con:
  - `sembrarCliente(nombre, sucursalId)` y `sembrarVenta(clienteId, sucursalId, fecha, monto, { contado, vendedorId, comentarios })`
    — venta `origen: 'portal'`, `capturo_usuario_id` del General; si `contado`, además su `cobranza_abono` de origen
    `venta_contado` (`cobro_id` null, `metodo_pago` efectivo, `fecha_pago` = fecha), como en `sembrarContado` de la e2e de
    T-29.
  - `sembrarCobro(db, { clienteId, vendedorId, monto, fecha, metodoPago })` de `./apoyo-cobros` (con `vendedorId` null =
    Oficina; `metodoPago: 'saldo_favor'` = saldo a favor). Para un vendedor real, toma uno existente de TJ
    (`select id from vendedor where sucursal_id = TJ limit 1`); si no hay, créalo como en `rutas-diarias.e2e-spec.ts`.

  Casos (todos con `desde=hasta` o rangos dentro de 2018-11):
  1. **Repartidor vs oficina:** en 2018-11-05, cliente TJ: venta crédito $1,000; cobro con vendedor $300; cobro sin
     vendedor $200; contado de vendedor $150; contado de mostrador (vendedor null) $50 →
     `cobradoRepartidorCentavos` 45_000, `cobradoOficinaCentavos` 25_000, `ventasTotalesCentavos` 120_000,
     `porcentajeCobro` 58.3. (Consulta con `sucursal=TJ` y compara contra **sus** números leyendo antes/después: como hay
     datos de otras suites posibles, calcula la diferencia entre una consulta antes de sembrar y una después.)
  2. **Abono parcial y exclusiones:** cobro de $100 (abono parcial de una nota de $1,000) suma 10_000; un cobro
     `saldo_favor` de $70 no suma; un cobro de $40 con `deleted_at` no suma.
  3. **Comentarios:** una venta con `comentarios: 'Pidió factura'` aparece en `comentarios.ingresos` con folio y cliente;
     un retiro de Tesorería con comentario (insertado con la API `POST /tesoreria/movimientos` sobre una cuenta propia)
     aparece en `comentarios.egresos` con concepto `Retiro`.
  4. **Total Tesorería:** `totalTesoreriaCentavos` = `total.saldoFinalCentavos` de `GET /tesoreria` con el mismo rango y
     sucursal.
  5. **Errores:** sin `hasta` → 400; rango > 1 año → 400; usuario SIN → 403; TIJUANA con `sucursal=MX` → 403.

  Run: `npm run test:e2e --workspace=apps/backend -- flujo-efectivo` → FAIL.

- [ ] **Paso 2: DTO** — `dto/flujo-efectivo.dto.ts`: igual que `VistaTesoreriaDto` (`desde`, `hasta` con `Matches`
  `AAAA-MM-DD` y mensajes en español; `sucursal?`).

- [ ] **Paso 3: Repositorio** — `flujo-efectivo.repository.ts` con tres consultas (Kysely + `sql`), filtro opcional por
  código de sucursal (`null` = todas):

```ts
// Ventas del rango por día (sucursal de la venta).
select to_char(vn.fecha, 'YYYY-MM-DD') as fecha, sum(vn.monto_total)::text as monto
  from venta_nota vn join sucursal s on s.id = vn.sucursal_id
 where vn.deleted_at is null and vn.fecha between ${desde}::date and ${hasta}::date
   [and s.codigo = ${codigo}]
 group by 1

// Cobros por día y tipo: cobro (sucursal del cliente) + contado (sucursal de la venta).
select fecha, repartidor, sum(monto)::text as monto from (
  select to_char(c.fecha_pago, 'YYYY-MM-DD') as fecha, (c.vendedor_id is not null) as repartidor, c.monto
    from cobro c join cliente cl on cl.id = c.cliente_id join sucursal s on s.id = cl.sucursal_id
   where c.deleted_at is null and c.origen = 'cobro'
     and c.metodo_pago in ('efectivo','transferencia','cheque')
     and c.fecha_pago between ${desde}::date and ${hasta}::date [and s.codigo = ${codigo}]
  union all
  select to_char(a.fecha_pago, 'YYYY-MM-DD'), (vn.vendedor_id is not null), a.monto
    from cobranza_abono a join venta_nota vn on vn.id = a.venta_nota_id join sucursal s on s.id = vn.sucursal_id
   where a.deleted_at is null and vn.deleted_at is null and a.origen = 'venta_contado'
     and a.metodo_pago in ('efectivo','transferencia','cheque')
     and a.fecha_pago between ${desde}::date and ${hasta}::date [and s.codigo = ${codigo}]
) t group by fecha, repartidor

// Comentarios de ventas del rango.
select to_char(vn.fecha,'YYYY-MM-DD') as fecha, vn.folio, cl.nombre as cliente, btrim(vn.comentarios) as comentario
  from venta_nota vn join cliente cl on cl.id = vn.cliente_id join sucursal s on s.id = vn.sucursal_id
 where vn.deleted_at is null and btrim(coalesce(vn.comentarios,'')) <> ''
   and vn.fecha between ${desde}::date and ${hasta}::date [and s.codigo = ${codigo}]
 order by vn.fecha, vn.folio
```

  El filtro opcional se arma con `codigo === null ? sql\`\` : sql\`and s.codigo = ${codigo}\``. Montos con `aCentavos`.

- [ ] **Paso 4: Servicio y controlador**
  - `FlujoEfectivoService.flujo(usuarioId, q)`: `validarRango` → 400; alcance con `resolverAlcance` (403 si pide otra
    sucursal); las tres consultas; `armarResumen`; `TesoreriaService.vista(usuarioId, { desde, hasta, sucursal: q.sucursal })`
    para `totalTesoreriaCentavos = total.saldoFinalCentavos`, `tesoreriaCuentasConSaldo = total.cuentasConSaldoFinal`,
    `tesoreriaCuentas = total.cuentas`; **egresos** = `vista.eventos` de tipo `retiro` o `traspaso` con `comentario` no
    nulo → `{ fecha, concepto: 'Retiro'|'Traspaso', cuenta: retiro ? cuentaNombre : \`${cuentaNombre} → ${cuentaDestinoNombre}\`, montoCentavos, comentario }`.
  - `FlujoEfectivoController` en `@Controller('flujo-efectivo')`, `@Get()` con `@RequierePermiso('flujo_efectivo.ver')`.
  - `TesoreriaModule`: `exports: [TesoreriaService]`. `FlujoEfectivoModule`: `imports: [TesoreriaModule]`, controller y
    providers. (Si aparece una dependencia circular, no la hay hoy: Tesorería no importa Flujo.)

- [ ] **Paso 5: Correr** — e2e `flujo-efectivo` y `tesoreria` → PASS; `npm test`, lint y build del backend.

- [ ] **Paso 6: Commit** — `git commit -m "T-32: GET /flujo-efectivo — ventas, cobradas por repartidor y oficina, utilidades, Total Tesorería y comentarios"`

---

### Tarea 3: Portal — pantalla, menú y Excel

**Files:**
- Create: `apps/portal/src/lib/flujo-efectivo.ts` + `.test.ts`
- Create: `apps/portal/src/components/flujo-efectivo/pantalla-flujo-efectivo.tsx` + `.test.tsx`
- Create: `apps/portal/src/app/(portal)/finanzas/flujo-efectivo/page.tsx`
- Modify: `apps/portal/src/components/layout/nav-config.ts` (Finanzas: Tesorería, **Flujo de Efectivo**)

**Interfaces:**
- `lib/flujo-efectivo.ts`: tipos `FlujoEfectivo`, `DiaFlujo`, `ComentarioIngreso`, `ComentarioEgreso` (copia exacta del
  backend), `obtenerFlujoEfectivo({ desde, hasta, sucursal })` (`/flujo-efectivo?…`, mismo armado de query que
  `lib/tesoreria.ts`), `formatearPorcentaje(p: number | null): string` (`87.5` → `"87.5%"`, `null` → `"—"`),
  `definicionExcelFlujo(f, { sucursal }): DefinicionExcel` — una hoja, columnas `Concepto | Monto | Detalle`: filas del
  resumen en el orden del cliente (Ventas Totales, Ventas Repartidor, Ventas Oficinas, Ventas Cobradas, % de Cobro,
  Gastos de Producción, Utilidad Bruta, Gastos Operativos, Utilidad de Operación, Gastos Financieros, Utilidad Neta,
  Total Tesorería), "Detalle" = "sin gastos registrados todavía" en las filas de gastos cuando `gastosDisponibles` es
  false; luego bloque `grupo` "Desglose por día" (Fecha, Ventas, Cobrado repartidor, Cobrado oficina, % — usa las mismas
  3 columnas como `[fecha, ventas, "Rep $x · Of $y · z%"]` o agrega columnas si prefieres; documenta la elección en la
  prueba) y bloques "Comentarios de ingresos" / "Comentarios de egresos".
- Pantalla `PantallaFlujoEfectivo({ sucursal })`: patrón de `components/reporte-ventas/pantalla-reporte-ventas.tsx` y de
  `components/tesoreria/pestana-vista.tsx` (rango con atajos Hoy/Ayer/Esta semana/Este mes — `diaAnterior` de
  `lib/tesoreria`, `rangoSemana`/`rangoMes` de `lib/reporte-ventas` —, consulta al abrir, guarda de la última consulta,
  "Cargando…", sin permiso "No tienes permiso para ver el Flujo de Efectivo").
  - **Cuadro resumen** (`<table aria-label="Flujo de Efectivo">`): una fila por concepto en el orden del cliente;
    utilidades y Total Tesorería en negritas; negativos en rojo (`text-destructive`); filas de gastos con la nota gris
    "sin gastos registrados todavía (llegan con Compras y Egresos)" cuando `gastosDisponibles` es false; bajo Total
    Tesorería, "N de M cuentas con saldo" si faltan.
  - **Desglose por día** (`<table aria-label="Desglose por día">`): Fecha · Ventas · Cobrado repartidor · Cobrado
    oficina · % de cobro.
  - **Comentarios** (`<section aria-label="Comentarios">`) en dos columnas: Ingresos (fecha · folio · cliente ·
    comentario) y Egresos (fecha · concepto · cuenta · monto · comentario); vacíos: "Sin comentarios en el rango."
  - **Exportar a Excel**.
- Página: server component delgado con `key={sucursal}` (como `/operacion/reporte-de-ventas`).

- [ ] **Paso 1: Pruebas (fallan)**
  - `lib/flujo-efectivo.test.ts`: `formatearPorcentaje` (87.5, 150, null); query de `obtenerFlujoEfectivo`; Excel: orden de
    conceptos, nota de gastos, bloques de comentarios.
  - `pantalla-flujo-efectivo.test.tsx` (mock de `useAuth`, `obtenerFlujoEfectivo`, `exportarExcel`): consulta hoy al
    abrir; muestra los conceptos en orden con sus montos; nota de gastos; utilidad negativa en rojo; "—" sin ventas;
    desglose por día; comentarios de ingresos y egresos; "Ayer" + Mostrar consulta el día anterior; sin permiso, el aviso.
- [ ] **Paso 2: Implementar** lib, pantalla, página y menú.
- [ ] **Paso 3: Correr** `npm test --workspace=apps/portal`, lint y `cd apps/portal && npx tsc --noEmit -p .`.
- [ ] **Paso 4: Commit** — `git commit -m "T-32: portal — Finanzas → Flujo de Efectivo (resumen, desglose por día, comentarios y Excel)"`

---

### Tarea 4: Documentación y verificación

- [ ] **Paso 1:** en `CLAUDE.md`, después del bloque de Tesorería, un bloque corto:

```markdown
- **Flujo de Efectivo (T-32).** *Finanzas → Flujo de Efectivo* (`/flujo-efectivo`, permiso `flujo_efectivo.ver`,
  `modules/flujo-efectivo/`). Solo lectura. Ventas Totales por **fecha de la venta** (cualquier status, sucursal de la
  venta); Ventas Cobradas = la **misma** cobranza que lee Tesorería, por **fecha del pago**, separada por **quién cobró**
  (con vendedor = repartidor; sin vendedor / venta de mostrador = oficina); abonos por lo abonado; nunca saldo a favor.
  `% de cobro` con 1 decimal, `null` sin ventas. **Gastos en $0** (`gastosDisponibles: false`) hasta T-30/T-31 (Mario):
  al llegar, se suman en `reglas-flujo.ts`. Total Tesorería sale de `TesoreriaService.vista` (exportado), no se recalcula.
```

- [ ] **Paso 2: Verificación completa** — backend lint+build, unit, e2e completo, `npm run supabase -- test db`, portal
  tests + lint. Anota conteos.
- [ ] **Paso 3:** navegador (lo hace el coordinador) a 1366 y 1920 con datos locales.
- [ ] **Paso 4: Commit** — `git commit -m "T-32: CLAUDE.md — bloque de Flujo de Efectivo"`

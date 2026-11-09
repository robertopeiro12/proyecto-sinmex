# Dashboard y Flujo diario — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir las pantallas *Dashboard* (hoy, en vivo) y *Flujo diario* (días pasados; reemplaza a Reporte de
Ventas) del portal, con los datos y la estructura del sistema viejo y el diseño del portal.

**Architecture:** En el backend, un cálculo puro por *vendedor y día* (`reglas-flujo-diario.ts`) alimenta las dos
pantallas: el Flujo diario lo usa para un rango y el Dashboard para hoy de Tijuana. El detalle (lo que se abre debajo
del renglón) se pide aparte al abrirlo. En el portal, las dos pantallas comparten la tabla de detalle por pestañas y
el agrupado por sucursal.

**Tech Stack:** NestJS + Kysely (`sql\`\``) sobre Postgres; Next.js + `components/ui/`; Jest (backend, e2e con
Postgres local) y Vitest (portal).

**Spec:** `docs/superpowers/specs/2026-11-09-dashboard-flujo-diario-design.md` (léelo completo; las maquetas aprobadas
están en `docs/superpowers/specs/2026-11-09-dashboard-flujo-diario/`).

## Global Constraints

- "Hoy" = `hoyEnTijuana()` (backend `modules/sincronizacion/operaciones.ts`, portal `lib/ventas.ts`); "ayer" =
  `diaAnterior(hoyEnTijuana())` (`lib/fechas.ts`). Nunca la hora del navegador ni UTC.
- Filtrar siempre por las columnas de fecha de negocio (`venta_nota.fecha`, `cobranza_abono.fecha_pago`,
  `cobro.fecha_pago`, `gasto.fecha`, `visita.fecha`, `ruta.fecha`, `jornada.fecha`), nunca por `created_at`.
- Todo vivo: `deleted_at is null` en `venta_nota`, `venta_nota_detalle`, `cobranza_abono`, `cobro`, `gasto`,
  `jornada`, `ruta`. Un abono de venta borrada no cuenta.
- Nunca contar `origen`/`metodo_pago = 'saldo_favor'` como cobranza.
- Montos en **centavos enteros** en la API (`aCentavos` de `modules/sincronizacion/dinero.ts`).
- Sucursal = `?sucursal=` de la barra lateral, resuelta con `resolverAlcance` / `normalizarSucursalPedida`; un
  vendedor o sucursal fuera del alcance = **404**.
- Permisos: Dashboard `dashboard.ver` (nuevo, grupo `General`); Flujo diario `reporte_ventas.ver` (el de T-49). No se
  asignan a perfiles.
- Diseño: solo piezas de `apps/portal/src/components/ui/`; nada del aspecto del sistema viejo. Las tablas anchas se
  desplazan dentro de `CajaTabla`.
- Sin Excel, sin Buscar vendedor, sin campana, sin Recargas. Inventario = "Pronto".
- Textos que el usuario ve: español llano. Copia fija: "Pronto", "En ruta", "Terminó", "Sí", "Abonado",
  "resta $X", "Oficina", "Quedó a favor del cliente", "Ruta del día · N clientes", "Sin ruta", "—".
- Portal = Roberto: nada de esta pieza toca `apps/tablet`.
- Pruebas del portal: `NODE_OPTIONS=--no-experimental-webstorage npm test --workspace=apps/portal`.

## Review Focus

1. **Medianoche de Tijuana**: a las 23:30 de Tijuana (07:30 UTC del día siguiente) el Dashboard muestra el día de
   Tijuana, y el Flujo diario abre en el día anterior de Tijuana. → pruebas en Tarea 5 y Tarea 8.
2. **Venta editada o eliminada / cobro borrado con petición (T-34)**: deja de contar solo, en totales y en detalle.
   → e2e en Tarea 3 y Tarea 4.
3. **Vendedor con ruta que no ha hecho nada**: aparece con ceros y "En ruta" (no desaparece). → Tarea 2 y Tarea 5.
4. **Pago de más (saldo a favor)**: el total de Cobranza = suma del detalle (contado + anteriores + a favor). →
   Tarea 2 y Tarea 4.
5. **Usuario atado a Tijuana pidiendo un vendedor o un día de Mexicali**: 404, sin decir si existe. → Tarea 4 y
   Tarea 5.

---

## Mapa de archivos

Backend (`apps/backend/`):

| Archivo | Qué hace |
|---|---|
| `supabase/migrations/20261109120000_permiso_dashboard.sql` (raíz del repo) | Siembra `dashboard.ver`. |
| `src/modules/estadisticas/reglas-flujo-diario.ts` (+ `.spec.ts`) | Puro: resumen por vendedor-día, totales, agrupado por sucursal, estatus. |
| `src/modules/estadisticas/reglas-detalle.ts` (+ `.spec.ts`) | Puro: armar el detalle de un vendedor-día y de un día de sucursal (Liquidada, corte, agrupaciones). |
| `src/modules/estadisticas/flujo-diario.repository.ts` | SQL de los renglones (vendedor-día) y de la cobranza de la oficina. |
| `src/modules/estadisticas/detalle.repository.ts` | SQL del detalle (ventas con líneas, abonos, a favor, gastos, visitas, promociones, jornada). |
| `src/modules/estadisticas/flujo-diario.service.ts` | Rango, alcance, vendedor; arma Flujo diario, detalle de vendedor y de día. |
| `src/modules/estadisticas/dashboard.service.ts` | Hoy de Tijuana; arma Dashboard y su detalle. |
| `src/modules/estadisticas/flujo-diario.controller.ts` | `GET /reportes/flujo-diario`, `/reportes/flujo-diario/vendedor`, `/reportes/flujo-diario/dia`. |
| `src/modules/estadisticas/dashboard.controller.ts` | `GET /dashboard`, `GET /dashboard/vendedor`. |
| `src/modules/estadisticas/dto/flujo-diario.dto.ts` | Validación de query. |
| `test/flujo-diario.e2e-spec.ts`, `test/dashboard.e2e-spec.ts` | e2e con Postgres local. |

Portal (`apps/portal/src/`):

| Archivo | Qué hace |
|---|---|
| `lib/flujo-diario.ts` (+ `.test.ts`) | Tipos (copia de los del backend), fetchers, `agruparPorSucursal`, `etiquetaRutaAsignada`, `etiquetaLiquidada`. |
| `components/ui/selector-segmentado.tsx` (+ test) | Pieza común nueva: "Por producto \| Por cliente". |
| `components/flujo-diario/resumen-cifras.tsx` | Fila de cifras (Venta general, Monto, Cobranza, Gasto, Tesorería, última). |
| `components/flujo-diario/detalle-vendedor.tsx` (+ test) | Pestañas del detalle de un vendedor-día (compartido con el Dashboard). |
| `components/flujo-diario/detalle-dia.tsx` | Pestañas del detalle de un día de sucursal. |
| `components/flujo-diario/tabla-por-vendedor.tsx`, `tabla-por-dia.tsx` | Tablas con bloques por sucursal y renglón abierto. |
| `components/flujo-diario/pantalla-flujo-diario.tsx` (+ test) | La pantalla. |
| `components/dashboard/tabla-dashboard.tsx`, `pantalla-dashboard.tsx` (+ test) | La pantalla del Dashboard. |
| `app/(portal)/operacion/page.tsx`, `app/(portal)/operacion/reporte-de-ventas/page.tsx` | Montan las pantallas. |
| `components/layout/nav-config.ts` (+ tests) | Dashboard sin `pronto`; "Reporte de Ventas" → "Flujo diario". |
| `lib/explicacion-permisos.ts` | Texto de `dashboard.ver`. |
| `components/reporte-ventas/*` | Se borran (la pantalla vieja). `lib/reporte-ventas.ts` y `GET /reportes/ventas` **se quedan**: su Excel se mudará a Información › Reportes (pieza 4). |

---

### Tarea 1: Permiso `dashboard.ver`

**Files:**
- Create: `supabase/migrations/20261109120000_permiso_dashboard.sql`
- Modify: `apps/portal/src/lib/explicacion-permisos.ts`
- Modify: `apps/backend/src/database/schema.d.ts` solo si `db:types` lo cambia (no debería: no hay tablas nuevas)

**Interfaces:**
- Produces: la clave `'dashboard.ver'` en `permiso` (grupo `'General'`, descripción `'Ver el Dashboard'`).

- [ ] **Paso 1:** Revisar `ls supabase/migrations` y las ramas remotas (`git branch -r`): ninguna otra migración usa
  `20261109120000`.
- [ ] **Paso 2:** Escribir la migración con el patrón de `20261020120000_gastos_ruta.sql`:
  `insert into permiso (clave, grupo, descripcion) values ('dashboard.ver', 'General', 'Ver el Dashboard') on conflict (clave) do nothing;`
- [ ] **Paso 3:** Agregar en `explicacion-permisos.ts`: `"dashboard.ver": "Puede ver el Dashboard: lo que llevan hoy los vendedores en ruta."`
- [ ] **Paso 4:** `npm run supabase -- migration up --local` → aplica 1; `npm run db:types --workspace=apps/backend` → `git diff --stat apps/backend/src/database/schema.d.ts` vacío.
- [ ] **Paso 5:** `NODE_OPTIONS=--no-experimental-webstorage npm test --workspace=apps/portal -- explicacion` → PASS (si hay prueba que exige texto para cada permiso sembrado, ahora pasa con el nuevo).
- [ ] **Paso 6:** Commit `Dashboard: permiso dashboard.ver`.

---

### Tarea 2: Reglas puras del resumen por vendedor-día

**Files:**
- Create: `apps/backend/src/modules/estadisticas/reglas-flujo-diario.ts`
- Test: `apps/backend/src/modules/estadisticas/reglas-flujo-diario.spec.ts`

**Interfaces:**
- Produces (exactos; el portal los copia en Tarea 7):

```ts
export interface FilaVendedorDia {
  fecha: string;                 // AAAA-MM-DD
  vendedorId: string;
  vendedor: string;
  sucursalCodigo: string;        // la del vendedor
  clientesEnRuta: number;        // ruta diaria viva de ese día
  atendidosEnRuta: number;       // de esos, con venta o visita ese día
  piezas: number;                // líneas vivas, sin promoción
  montoCentavos: number;
  contadoCentavos: number;       // abonos origen 'venta_contado'
  anterioresCentavos: number;    // abonos origen 'cobro'
  aFavorCentavos: number;        // sobrante de cobros que fue a saldo a favor
  gastoCentavos: number;
  jornadaCerrada: boolean;
  vehiculo: string | null;       // nombre del vehículo de la jornada
}
export interface ResumenVendedorDia extends FilaVendedorDia {
  cobranzaCentavos: number;      // contado + anteriores + aFavor
  tesoreriaCentavos: number;     // cobranza − gasto
  estatus: 'en_ruta' | 'terminado';
}
export interface Totales {
  rutas: number; piezas: number; montoCentavos: number; cobranzaCentavos: number;
  gastoCentavos: number; tesoreriaCentavos: number; clientesEnRuta: number; atendidosEnRuta: number;
}
export interface CobranzaOficinaDia { fecha: string; sucursalCodigo: string; montoCentavos: number }
export interface ResumenDia { fecha: string; sucursalCodigo: string; totales: Totales; oficinaCentavos: number }
export interface BloqueSucursal { sucursalCodigo: string; porVendedor: Totales; porDia: Totales }
export interface FlujoDiario {
  desde: string; hasta: string;
  porVendedor: ResumenVendedorDia[];   // orden: sucursal, fecha DESC, vendedor
  porDia: ResumenDia[];                // orden: sucursal, fecha DESC
  bloques: BloqueSucursal[];           // uno por sucursal presente, en orden de código
  totalPorVendedor: Totales;
  totalPorDia: Totales;                // incluye la cobranza de la oficina
}
export function resumir(f: FilaVendedorDia): ResumenVendedorDia;
export function sumar(resumenes: ResumenVendedorDia[], oficinaCentavos?: number): Totales;
export function armarFlujoDiario(desde: string, hasta: string, filas: FilaVendedorDia[], oficina: CobranzaOficinaDia[]): FlujoDiario;
```

- [ ] **Paso 1: Escribir las pruebas que fallan** en `reglas-flujo-diario.spec.ts`:
  - `resumir`: contado 64 750 + anteriores 92 250 + aFavor 0 − gasto 1 000 → `cobranzaCentavos 157000`,
    `tesoreriaCentavos 156000`; con `aFavorCentavos 5 000` la cobranza sube a 162 000.
  - `resumir`: `jornadaCerrada: false` → `estatus 'en_ruta'` aunque todo sea 0; `true` → `'terminado'`.
  - `sumar`: `rutas` = número de renglones (cuenta a los de ceros); `oficinaCentavos` se suma a cobranza **y** a
    tesorería, no a gasto.
  - `armarFlujoDiario` con los datos reales del spec (07/11, TJ: MJuan 926 pzs / $9,534.50 / $3,060.00; HAntonio 752 /
    $9,684.00 / $1,292.00; Ricardo 1 237 / $17,776.00 / $1,570.00; un cuarto vendedor con ceros) y oficina TJ 07/11
    $437.50: `totalPorVendedor.cobranzaCentavos === 592200`, `porDia[0].totales.cobranzaCentavos === 635950`,
    `porDia[0].totales.rutas === 4`, `totalPorVendedor.montoCentavos === 3699450`.
  - Dos sucursales (TJ y MX): `bloques` trae TJ y MX con sus subtotales y `totalPorDia` = suma de ambos.
  - Un día con cobranza de oficina pero sin vendedores produce un `ResumenDia` con `rutas 0`.
  - Orden: fecha descendente dentro de cada sucursal.
- [ ] **Paso 2:** `npm test --workspace=apps/backend -- reglas-flujo-diario` → FAIL (no existe el módulo).
- [ ] **Paso 3:** Implementar las funciones de la interfaz. `porDia` agrupa `porVendedor` por (sucursal, fecha) y le
  suma la oficina de esa misma llave.
- [ ] **Paso 4:** Mismo comando → PASS.
- [ ] **Paso 5:** Commit `Flujo diario: reglas del resumen por vendedor y día`.

---

### Tarea 3: Renglones desde la base y `GET /reportes/flujo-diario`

**Files:**
- Create: `apps/backend/src/modules/estadisticas/flujo-diario.repository.ts`
- Create: `apps/backend/src/modules/estadisticas/dto/flujo-diario.dto.ts`
- Create: `apps/backend/src/modules/estadisticas/flujo-diario.service.ts`
- Create: `apps/backend/src/modules/estadisticas/flujo-diario.controller.ts`
- Modify: `apps/backend/src/modules/estadisticas/estadisticas.module.ts`
- Test: `apps/backend/test/flujo-diario.e2e-spec.ts`

**Interfaces:**
- Consumes: `armarFlujoDiario`, `FilaVendedorDia`, `CobranzaOficinaDia` (Tarea 2); `validarRango`
  (`reglas-kilometraje.ts`); `resolverAlcance`, `normalizarSucursalPedida`; `buscarSucursalUsuario`.
- Produces:
  - `FlujoDiarioRepository.filas(f: { desde: string; hasta: string; codigoSucursal: string | null; vendedorId: string | null }): Promise<FilaVendedorDia[]>`
  - `FlujoDiarioRepository.oficina(f: { desde: string; hasta: string; codigoSucursal: string | null }): Promise<CobranzaOficinaDia[]>`
  - `FlujoDiarioService.flujo(usuarioId: string, q: FlujoDiarioDto): Promise<FlujoDiario>`
  - `FlujoDiarioDto { desde: string; hasta: string; sucursal?: string; vendedor?: string }` (fechas `AAAA-MM-DD`,
    vendedor uuid; otra cosa → 400 "El vendedor no es válido.")
  - `GET /reportes/flujo-diario?desde&hasta&sucursal&vendedor` con `@RequierePermiso('reporte_ventas.ver')`.
  - Con `vendedor` elegido, el servicio pasa `oficina = []`: "Por día" suma solo a ese vendedor, sin la cobranza de
    la oficina.

Reglas del SQL de `filas` (un renglón por vendedor y fecha del rango):
- **Quiénes**: la unión de (vendedor, fecha) con ruta diaria viva ese día, o con venta, cobro, visita, gasto o jornada
  vivos ese día. Sucursal = la del vendedor.
- **piezas / monto**: como `reporte-ventas.repository.ts` (líneas vivas, `cantidad` sin `cantidad_promocion`).
- **contado**: `cobranza_abono` vivos `origen = 'venta_contado'` de ventas vivas del vendedor con `fecha_pago` = día.
- **anteriores**: `cobranza_abono` vivos `origen = 'cobro'` con `cobro` vivo, `cobro.vendedor_id` = vendedor,
  `fecha_pago` = día, venta viva.
- **aFavor**: por cada `cobro` vivo de origen `cobro` del vendedor ese día, `cobro.monto − suma de sus abonos vivos`
  (si > 0).
- **gasto**: `gasto` vivos del vendedor con `fecha` = día.
- **ruta**: `ruta` viva `tipo = 'diaria'`; atendidos = clientes de esa ruta con venta viva o `visita` del vendedor ese
  día.
- **jornada / vehículo**: `jornada` viva del día → `jornadaCerrada`, `vehiculo.nombre`.
- `oficina`: `cobro` vivo `origen = 'cobro'`, `vendedor_id is null`, por `fecha_pago` y sucursal **del cliente**; y abonos
  `venta_contado` de ventas vivas sin vendedor (mostrador) **no** (esas no son de un vendedor ni de cobranza de oficina
  en el viejo).

- [ ] **Paso 1: Escribir el e2e que falla** (`flujo-diario.e2e-spec.ts`, mismo armado que `reporte-ventas.e2e-spec.ts`:
  sucursal de prueba propia, fechas de 2018 para no chocar). Casos:
  - Sin sesión → 401; sin permiso → 403; con `reporte_ventas.ver` por excepción → 200.
  - Vendedor con ruta diaria de 3 clientes, una venta de contado a uno (2 líneas, una borrada) y una visita a otro:
    `piezas` solo de la línea viva, `clientesEnRuta 3`, `atendidosEnRuta 2`, `contadoCentavos` = el abono.
  - Vendedor con ruta y sin nada más: aparece con ceros y `estatus 'en_ruta'`.
  - Cobro del vendedor que paga una nota anterior y deja sobrante a favor: `anterioresCentavos` = abono,
    `aFavorCentavos` = sobrante, `cobranzaCentavos` = monto del cobro.
  - Cobro borrado (`deleted_at` en `cobro` y sus abonos) y venta eliminada: no cuentan.
  - Cobro de oficina (sin vendedor) a cliente de la sucursal: suma en `porDia[...]oficinaCentavos` y no en ningún
    renglón de vendedor.
  - Un cobro `origen = 'saldo_favor'` no cuenta en nada.
  - Gasto y jornada cerrada: `gastoCentavos`, `estatus 'terminado'`, `vehiculo` = nombre.
  - Usuario atado a otra sucursal pidiendo `sucursal=ZV` → solo ve la suya (regla de `resolverAlcance`).
  - Rango de más de 366 días → 400 (mensaje de `validarRango`).
  - Con `vendedor=<id>`: `porDia` no trae `oficinaCentavos` (0) aunque haya cobro de oficina ese día.
- [ ] **Paso 2:** `npm run test:e2e --workspace=apps/backend -- flujo-diario` → FAIL (404 de ruta).
- [ ] **Paso 3:** Implementar repositorio, DTO, servicio (molde de `ReporteVentasService.ventas`) y controlador;
  registrarlos en `EstadisticasModule`.
- [ ] **Paso 4:** Mismo comando → PASS; `npm run lint --workspace=apps/backend` y `npm run build --workspace=apps/backend` limpios.
- [ ] **Paso 5:** Commit `Flujo diario: GET /reportes/flujo-diario`.

---

### Tarea 4: Detalle de un vendedor-día y de un día de sucursal

**Files:**
- Create: `apps/backend/src/modules/estadisticas/reglas-detalle.ts` (+ `reglas-detalle.spec.ts`)
- Create: `apps/backend/src/modules/estadisticas/detalle.repository.ts`
- Modify: `flujo-diario.service.ts`, `flujo-diario.controller.ts`, `dto/flujo-diario.dto.ts`
- Test: `apps/backend/test/flujo-diario.e2e-spec.ts` (casos nuevos)

**Interfaces:**
- Produces:

```ts
export interface PagoDetalle {
  folio: string; cliente: string; montoCentavos: number;
  metodo: 'efectivo' | 'transferencia' | 'cheque';
  saldoPendienteCentavos: number;   // cobranza_abono.saldo_pendiente (después de ese pago)
  liquidada: boolean;               // saldoPendienteCentavos === 0
}
export interface NotaDetalle {
  folio: string; cliente: string; contadoCredito: 'contado' | 'credito';
  piezas: number; totalCentavos: number; pendienteCentavos: number;
  lineas: { producto: string; cantidad: number; precioCentavos: number }[];
}
export interface DetalleVendedorDia {
  fecha: string; vendedorId: string; vendedor: string;
  porProducto: { presentacion: string; producto: string; piezas: number }[]; // presentacion = volumen, producto = "Agua 500 ml"
  notas: NotaDetalle[];                       // ventas del día (para "Por cliente" y su apertura)
  cobranza: { contado: PagoDetalle[]; anteriores: PagoDetalle[]; aFavor: { cliente: string; montoCentavos: number }[] };
  gastos: { descripcion: string; montoCentavos: number }[];  // campo_nombre + " · " + comentario si hay
  notasCredito: { folio: string; cliente: string; totalCentavos: number; pendienteCentavos: number }[];
  visitas: { cliente: string; vendio: boolean; hora: string | null; motivo: string | null; atendio: string | null; comentario: string | null }[];
  promociones: { cliente: string; producto: string; cantidad: number }[];
  corte: { contadoCentavos: number; anterioresCentavos: number; aFavorCentavos: number; gastoCentavos: number; tesoreriaCentavos: number } | null; // null sin jornada
}
export interface DetalleDia {
  fecha: string; sucursalCodigo: string;
  porPresentacion: { presentacion: string; piezas: number }[];
  porProducto: { producto: string; piezas: number }[];
  porVendedor: { vendedor: string; presentacion: string; piezas: number }[];
  porCliente: { cliente: string; presentacion: string; piezas: number }[];
  cobranza: (PagoDetalle & { cobrador: string | null })[];  // null = Oficina
  aFavor: { cobrador: string | null; cliente: string; montoCentavos: number }[];
  gastos: { vendedor: string; descripcion: string; montoCentavos: number }[];
  visitas: { vendedor: string; cliente: string; vendio: boolean; hora: string | null; motivo: string | null; comentario: string | null }[];
  promociones: { producto: string; cantidad: number }[];
}
// reglas puras
export function armarDetalleVendedor(...filas): DetalleVendedorDia;
export function armarDetalleDia(...filas): DetalleDia;
// servicio
FlujoDiarioService.detalleVendedor(usuarioId: string, q: { fecha: string; vendedor: string; sucursal?: string }): Promise<DetalleVendedorDia>;
FlujoDiarioService.detalleDia(usuarioId: string, q: { fecha: string; sucursal: string }): Promise<DetalleDia>;
```

  - `GET /reportes/flujo-diario/vendedor?fecha&vendedor` y `GET /reportes/flujo-diario/dia?fecha&sucursal`
    (`reporte_ventas.ver`). Vendedor de otra sucursal del alcance → 404 "No encontramos ese vendedor.". Sucursal
    fuera del alcance → 404.
  - Las firmas exactas de las filas que recibe `armarDetalle*` las decide el implementador; el repositorio entrega
    filas planas y las reglas agrupan y ordenan.

Reglas que fijan las pruebas:
- **Visitas** = ventas del día (vendió `true`, hora = `sync_operacion.ocurrido_en` donde `entidad_tabla = 'venta_nota'`
  y `entidad_id` = la venta; si no hay, `venta_nota.created_at`) + `visita` (vendió `false`, hora `visitada_en`,
  `motivo_visita.nombre`, `atendio`, `observaciones`). Orden por hora. Horas en ISO; el portal las pinta en hora de
  Tijuana.
- **porProducto** ordenado por presentación (volumen) y piezas desc; **notas** por hora de venta.
- **notasCredito** = ventas del día a crédito (pendiente = monto − abonos vivos).
- **promociones**: `venta_nota_promocion` de las ventas vivas del día, por cliente y presentación.
- **corte** solo si hay jornada; tesorería = contado + anteriores + aFavor − gasto (la misma del renglón).

- [ ] **Paso 1: Pruebas de reglas que fallan** (`reglas-detalle.spec.ts`):
  - Un abono con `saldoPendienteCentavos 15000` → `liquidada false`; con 0 → `true`.
  - Un cobro de 100 000 que paga dos notas (60 000 + 30 000) y deja 10 000 a favor → `anteriores` con 2 pagos y
    `aFavor` con 10 000; suma de los tres = 100 000.
  - `corte` con jornada = mismos números que `resumir` de Tarea 2 para las mismas cifras; sin jornada `null`.
  - `armarDetalleDia`: `porPresentacion` suma por volumen (1 657 de "500 ml" con dos productos 500 ml); un pago de
    oficina trae `cobrador null`.
  - Visitas mezcladas (venta 10:53, visita 9:15) salen 9:15 primero.
- [ ] **Paso 2:** `npm test --workspace=apps/backend -- reglas-detalle` → FAIL.
- [ ] **Paso 3:** Implementar reglas, repositorio y los dos métodos del servicio y endpoints.
- [ ] **Paso 4: e2e nuevos** en `flujo-diario.e2e-spec.ts`: detalle de vendedor con una venta de contado (líneas con
  precio), un cobro a nota anterior que la deja en "Abonado" (`saldoPendienteCentavos` > 0), un sobrante a favor, un
  gasto con comentario, una visita sin venta; detalle de día con un cobro de oficina; vendedor de otra sucursal → 404;
  venta eliminada no aparece en ninguna lista.
- [ ] **Paso 5:** `npm test --workspace=apps/backend -- reglas-detalle` y `npm run test:e2e --workspace=apps/backend -- flujo-diario` → PASS; lint y build limpios.
- [ ] **Paso 6:** Commit `Flujo diario: detalle por vendedor y por día`.

---

### Tarea 5: Dashboard en el backend

**Files:**
- Create: `apps/backend/src/modules/estadisticas/dashboard.service.ts`
- Create: `apps/backend/src/modules/estadisticas/dashboard.controller.ts`
- Modify: `reglas-flujo-diario.ts` (+ spec), `estadisticas.module.ts`
- Test: `apps/backend/test/dashboard.e2e-spec.ts`

**Interfaces:**
- Consumes: `FlujoDiarioRepository.filas`, `resumir`, `sumar`, `armarDetalleVendedor` y el repositorio de detalle;
  `hoyEnTijuana(ahora?: Date)`.
- Produces:

```ts
export interface Dashboard {
  fecha: string;                                  // hoy de Tijuana
  vendedores: ResumenVendedorDia[];               // orden: sucursal, vendedor
  bloques: { sucursalCodigo: string; totales: Totales; enRuta: number; terminaron: number }[];
  total: Totales & { enRuta: number; terminaron: number };
}
export function armarDashboard(fecha: string, filas: FilaVendedorDia[]): Dashboard; // en reglas-flujo-diario.ts
DashboardService.dashboard(usuarioId: string, q: { sucursal?: string }, ahora?: Date): Promise<Dashboard>;
DashboardService.detalle(usuarioId: string, q: { vendedor: string; sucursal?: string }, ahora?: Date): Promise<DetalleVendedorDia>;
```

  - `GET /dashboard?sucursal` y `GET /dashboard/vendedor?vendedor&sucursal`, ambos `@RequierePermiso('dashboard.ver')`.
  - "Hoy" se calcula en el servidor con `hoyEnTijuana(ahora)`; el cliente no manda fecha. `ahora` solo para pruebas.
  - Quiénes salen: los mismos de `filas` con `desde = hasta = hoy` (ruta diaria hoy, o algún movimiento hoy).
  - Vehículo: el de la jornada o `null` (la asignación en Ruta diaria no existe aún; el spec deja la lectura lista).

- [ ] **Paso 1: Pruebas que fallan:**
  - `reglas-flujo-diario.spec.ts`: `armarDashboard` cuenta `enRuta`/`terminaron` por bloque y en total; un vendedor
    con ruta y ceros cuenta como `enRuta`.
  - `dashboard.e2e-spec.ts`: sin `dashboard.ver` → 403; con él → 200 y `fecha` = `hoyEnTijuana()`.
  - Servicio con `ahora = new Date('2026-11-10T07:30:00Z')` (23:30 del 9 en Tijuana): `fecha === '2026-11-09'` y una
    venta con `fecha '2026-11-09'` cuenta; una con `'2026-11-10'` no.
  - Usuario atado a otra sucursal pidiendo el detalle de un vendedor ajeno → 404.
- [ ] **Paso 2:** Correr → FAIL.
- [ ] **Paso 3:** Implementar `armarDashboard`, servicio y controlador; registrar.
- [ ] **Paso 4:** `npm test --workspace=apps/backend -- reglas-flujo-diario` y `npm run test:e2e --workspace=apps/backend -- dashboard` → PASS; lint y build.
- [ ] **Paso 5:** Commit `Dashboard: GET /dashboard`.

---

### Tarea 6: Selector segmentado (pieza común)

**Files:**
- Create: `apps/portal/src/components/ui/selector-segmentado.tsx`
- Test: `apps/portal/src/components/ui/selector-segmentado.test.tsx`

**Interfaces:**
- Produces: `SelectorSegmentado<T extends string>({ opciones, valor, onCambio, etiqueta }: { opciones: { valor: T; texto: string }[]; valor: T; onCambio: (v: T) => void; etiqueta: string })`
  — un `role="radiogroup"` con `aria-label={etiqueta}`; cada opción `role="radio"` con `aria-checked`. Aspecto de la
  maqueta (fondo `bg-menu`, la elegida en blanco con sombra), estilos con tokens de `globals.css`.

- [ ] **Paso 1: Prueba que falla:** renderiza "Por producto" y "Por cliente", la elegida tiene `aria-checked="true"`,
  picar la otra llama `onCambio("cliente")`; flechas izquierda/derecha cambian la elegida.
- [ ] **Paso 2:** Correr la prueba → FAIL.
- [ ] **Paso 3:** Implementar.
- [ ] **Paso 4:** → PASS.
- [ ] **Paso 5:** Commit `Portal UI: selector segmentado`.

---

### Tarea 7: `lib/flujo-diario.ts` en el portal

**Files:**
- Create: `apps/portal/src/lib/flujo-diario.ts`
- Test: `apps/portal/src/lib/flujo-diario.test.ts`

**Interfaces:**
- Consumes: los tipos de Tareas 2, 4 y 5 (copiados aquí, como hace `lib/reporte-ventas.ts`).
- Produces:
  - `obtenerFlujoDiario(f: { desde: string; hasta: string; sucursal: string | null; vendedor: string | null }): Promise<FlujoDiario>`
  - `obtenerDetalleVendedor(f: { fecha: string; vendedor: string; sucursal: string | null }): Promise<DetalleVendedorDia>`
  - `obtenerDetalleDia(f: { fecha: string; sucursal: string }): Promise<DetalleDia>`
  - `obtenerDashboard(sucursal: string | null): Promise<Dashboard>`
  - `obtenerDetalleDashboard(f: { vendedor: string; sucursal: string | null }): Promise<DetalleVendedorDia>`
  - `agruparPorSucursal<T extends { sucursalCodigo: string }>(filas: T[]): { sucursalCodigo: string; filas: T[] }[]` (respeta el orden de llegada)
  - `etiquetaRutaAsignada(clientesEnRuta: number): string` → `"Ruta del día · 16 clientes"`, `"Ruta del día · 1 cliente"`, `"Sin ruta"`
  - `etiquetaLiquidada(p: PagoDetalle): { texto: "Sí" | "Abonado"; resta: string | null }` (resta con `formatearPesos`)

- [ ] **Paso 1: Pruebas que fallan:** `etiquetaRutaAsignada(16|1|0)`; `etiquetaLiquidada` con saldo 15 000 →
  `{ texto: "Abonado", resta: "$150.00" }`, con 0 → `{ texto: "Sí", resta: null }`; `agruparPorSucursal` de
  [TJ, TJ, MX] da 2 grupos en ese orden; `obtenerFlujoDiario` arma
  `/reportes/flujo-diario?desde=…&hasta=…&sucursal=MX&vendedor=…` (simulando `apiFetch` como en `reporte-ventas.test.ts`).
- [ ] **Paso 2:** Correr → FAIL.
- [ ] **Paso 3:** Implementar.
- [ ] **Paso 4:** → PASS.
- [ ] **Paso 5:** Commit `Flujo diario: lib del portal`.

---

### Tarea 8: Pantalla Flujo diario

**Files:**
- Create: `apps/portal/src/components/flujo-diario/resumen-cifras.tsx`, `detalle-vendedor.tsx`, `detalle-dia.tsx`,
  `tabla-por-vendedor.tsx`, `tabla-por-dia.tsx`, `pantalla-flujo-diario.tsx`
- Test: `apps/portal/src/components/flujo-diario/pantalla-flujo-diario.test.tsx`,
  `apps/portal/src/components/flujo-diario/detalle-vendedor.test.tsx`
- Modify: `apps/portal/src/app/(portal)/operacion/reporte-de-ventas/page.tsx`,
  `apps/portal/src/components/layout/nav-config.ts` (+ `nav-config.test.ts`)
- Delete: `apps/portal/src/components/reporte-ventas/` (los tres archivos)

**Interfaces:**
- Consumes: Tareas 6 y 7; `FiltroFechas`, `Pestanas`, `Tabla`/`Th`/`Td`/`TdMonto`/`CajaTabla`/`FilaGrupo`/`FilaTotal`,
  `Etiqueta`, `Aviso`, `EstadoPantalla`, `EncabezadoPantalla`, `Campo`/`Lista`, `listarVendedores`.
- Produces: `DetalleVendedor({ detalle, modo }: { detalle: DetalleVendedorDia; modo: "flujo" | "dashboard" })` —
  pestañas Venta general (con `SelectorSegmentado` Por producto | Por cliente), Cobranza, Gastos, Notas de venta,
  Visitas, Mermas cambios y promociones, Corte (solo `modo="dashboard"`), Inventario (deshabilitada, "Pronto").
  `ResumenCifras({ totales, ultima }: { totales: Totales; ultima: { titulo: string; valor: string; detalle?: string } })`.

Comportamiento (de la maqueta aprobada `maqueta-flujo-diario.html` y del spec §5.3):
- Título "Flujo diario", descripción "Qué hizo cada vendedor en días pasados. Pica un vendedor o un número para ver el
  detalle." Filtro con Vendedor (Todos / cada uno). **Sin Excel.**
- Abre con `desde = hasta = diaAnterior(hoyEnTijuana())` y consulta sola al entrar.
- Pestañas "Por vendedor" / "Por día". Columnas en el orden del spec. Ruta asignada = `etiquetaRutaAsignada`. Notas de
  venta = "Ver". Inventario = "Pronto".
- Con varias sucursales en la respuesta: `FilaGrupo` por sucursal con su subtotal (`bloques`) y `FilaTotal` general.
- Picar el renglón (o un número) abre el detalle debajo (un renglón abierto a la vez); pide el detalle al abrirlo y
  muestra "Cargando…" en el renglón. Picar otra vez lo cierra.
- `Aviso` informativo bajo "Por vendedor": "La cobranza de esta pestaña es la de los vendedores. «Por día» suma también
  lo que cobró la oficina."
- Liquidada: `Etiqueta` éxito "Sí" / información "Abonado" + "resta $X". Cada pago lleva su método si no es efectivo.
  "Quedó a favor del cliente" como renglón propio en Cobranza; en Corte, renglón "Quedó a favor del cliente" solo si
  es mayor que 0.
- Pestaña "Mermas, cambios y promociones": hoy solo promociones, en un bloque por cliente (maqueta); si no hay, "Sin
  promociones este día.". En "Por día", la pestaña Mermas dice "Todavía no se registran mermas en el sistema." (spec §6).
- Pestaña "Notas de venta": `notasCredito` (folio, cliente, total, pendiente); si no hay, "Sin notas a crédito este día.".
- Nav: `{ label: "Flujo diario", href: "/operacion/reporte-de-ventas" }`; el título de la pestaña del navegador sale
  "Flujo diario | JAWA Tijuana".

- [ ] **Paso 1: Pruebas que fallan** (Vitest + Testing Library, simulando `lib/flujo-diario`):
  - `pantalla-flujo-diario.test.tsx`: con la hora fija en `2026-11-10T07:30:00Z` (`vi.setSystemTime`), la primera
    consulta pide `desde=2026-11-09&hasta=2026-11-09`; no hay botón "Exportar a Excel"; con respuesta de TJ y MX
    aparecen los encabezados de grupo "Tijuana" y "Mexicali" y "Total"; picar "Ricardo" pide su detalle y muestra la
    pestaña Venta general; sin permiso → "sin permiso" de `EstadoPantalla`.
  - `detalle-vendedor.test.tsx`: un pago con saldo pendiente muestra "Abonado" y "resta $150.00"; `modo="flujo"` no
    tiene la pestaña Corte; `modo="dashboard"` con `corte: null` dice "El vendedor no ha terminado su ruta."; el
    selector cambia de "Por producto" a "Por cliente".
  - `nav-config.test.ts`: `buscarItemActual("/operacion/reporte-de-ventas")?.item.label === "Flujo diario"`.
- [ ] **Paso 2:** Correr → FAIL.
- [ ] **Paso 3:** Implementar componentes, página y nav; borrar `components/reporte-ventas/`.
- [ ] **Paso 4:** `NODE_OPTIONS=--no-experimental-webstorage npm test --workspace=apps/portal` → PASS; `npm run lint --workspace=apps/portal` y `npx tsc --noEmit -p apps/portal` limpios.
- [ ] **Paso 5: Revisar en el navegador** (backend 3010 contra Postgres local con datos de prueba) a 1366 y 1920 px:
  la tabla se desplaza dentro de su caja, el detalle se abre bajo el renglón, el aspecto coincide con la maqueta.
- [ ] **Paso 6:** Commit `Flujo diario: pantalla del portal (reemplaza Reporte de Ventas)`.

---

### Tarea 9: Pantalla Dashboard

**Files:**
- Create: `apps/portal/src/components/dashboard/tabla-dashboard.tsx`, `pantalla-dashboard.tsx`
- Test: `apps/portal/src/components/dashboard/pantalla-dashboard.test.tsx`
- Modify: `apps/portal/src/app/(portal)/operacion/page.tsx`, `apps/portal/src/components/layout/nav-config.ts` (quitar `pronto` de Dashboard)

**Interfaces:**
- Consumes: Tareas 7 y 8 (`DetalleVendedor` con `modo="dashboard"`, `ResumenCifras`, `agruparPorSucursal`).

Comportamiento (maqueta `maqueta-dashboard.html`, spec §5.2):
- Título "Dashboard", descripción "Lo que llevan hoy los vendedores en ruta. Pica un vendedor o un número para ver el
  detalle." A la derecha: "Hoy, lunes 9 de noviembre · se actualiza solo · hace N min" (fecha del servidor,
  `Dashboard.fecha`, formateada en español).
- Resumen: Venta general, Monto, Cobranza, Gasto, Tesorería, Vendedores ("N en ruta · N terminaron"). Con varias
  sucursales, un resumen por bloque y uno total.
- Columnas: Vendedor · Ruta asignada · Vehículo (o "—") · Inventario ("Pronto") · Mermas, cambios, promos ("Ver") ·
  Venta general · Cobranza · Gasto · Notas de venta ("Ver") · Notas ant. asignadas ("—") · Ruta (x / y con barrita) ·
  Estatus (`Etiqueta` información "En ruta" / éxito "Terminó") · Corte ("Ver" si terminó, "—" si no).
- **Se actualiza solo cada 60 s** mientras `document.visibilityState === "visible"`; al volver a la pestaña consulta
  de inmediato. La actualización no cierra el renglón abierto ni cambia su pestaña (el detalle abierto también se
  vuelve a pedir). Una consulta lenta no pisa a una más nueva (guarda `ultima`, como `PantallaReporteVentas`).
- Sin vendedores: "No hay vendedores en ruta hoy."

- [ ] **Paso 1: Pruebas que fallan** (`vi.useFakeTimers`):
  - Pide `obtenerDashboard` al entrar y otra vez a los 60 s; no la pide si la pestaña está oculta.
  - Con el detalle de "RBlas" abierto en la pestaña Cobranza, tras la actualización sigue abierto en Cobranza.
  - Estatus "En ruta" y "Terminó" con sus etiquetas; Corte "—" para el que no terminó.
  - Sin permiso `dashboard.ver` → `EstadoPantalla` sin permiso.
- [ ] **Paso 2:** Correr → FAIL.
- [ ] **Paso 3:** Implementar; la prueba de `nav-config` "toda pantalla Placeholder lleva pronto" ya exige quitar `pronto`.
- [ ] **Paso 4:** Pruebas, lint y `tsc` del portal → PASS.
- [ ] **Paso 5: Revisar en el navegador** a 1366 y 1920 px, con "Todas" y con una sucursal; esperar un minuto y ver
  que se actualiza sin cerrar el detalle.
- [ ] **Paso 6:** Commit `Dashboard: pantalla del portal`.

---

### Tarea 10: Documentación

**Files:**
- Modify: `CLAUDE.md` (bloque "Reportes y Excel": Flujo diario y Dashboard, endpoints, permisos, reglas de cobranza
  —contado / anteriores / a favor / oficina—, "hoy" de Tijuana, `GET /reportes/ventas` se queda para el Excel de la
  pieza 4)
- Modify (vault `../jawa-obsidian-memory`): `10-Dominio/Modulos/Estadísticas y Reportes.md`,
  `00-Inicio/Estado del proyecto.md` (pieza 1 hecha), bitácora del día

- [ ] **Paso 1:** Escribir los cambios; en el PR, nota para quien empuje: migración `20261109120000_permiso_dashboard.sql`
  a `sinmex dev` después del merge con el protocolo de `CLAUDE.md` (pre-flight: solo un insert; nada que contar).
- [ ] **Paso 2:** `npm test --workspace=apps/backend`, `npm run test:e2e --workspace=apps/backend`, pruebas del portal:
  todo verde.
- [ ] **Paso 3:** Commit `Dashboard y Flujo diario: CLAUDE.md` y commit/push del vault.

# Inventario de PT con Recargas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pantalla *Producción → Inventario de PT con Recargas* con la fotografía de **hoy** del almacén (Inicial − Recargas − Envíos + Entradas − Merma − Consumo − Descuentos = Actual), sus detalles "a quién" y el acceso a Ajustar.

**Architecture:** sin tabla nueva (solo un permiso). Backend en `apps/backend/src/modules/produccion/` junto a PT con Ventas: el **Inicial** sale de la cuenta que ya existe (`InventarioPtService.calcular` para hoy → `dias[0].inicial`/`ajustado`, que ya resuelve ajuste de hoy, Final de ayer y la regla de Todas); los movimientos del día salen de una consulta nueva solo del Registro de Operación + cargas. Reglas puras nuevas en `reglas-inventario-pt-recargas.ts`. Portal en `components/inventario-pt-recargas/` reutilizando la tabla/ajustes de `components/inventario-pt/` donde se pueda.

**Tech Stack:** Postgres/Supabase (migración + pgTAP), NestJS + Kysely + Jest, Next.js + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-inventario-pt-recargas-design.md` (gemelo: `2026-11-25-inventario-pt-ventas-design.md`)

## Global Constraints

- Migración `supabase/migrations/20261201120000_permiso_inventario_pt_recargas.sql` (versión única; revisada contra `main` y las ramas remotas).
- Fórmula exacta (spec D2): `Actual = Inicial − Recargas − Envíos + Entradas − Merma − Consumo − Descuentos`.
- Recargas = `carga_detalle.piezas` de cargas **vivas de hoy** con `carga.sucursal_id` = la consultada (vendedor vivo o dado de baja), con `carga.estado = 'pendiente'`, o `'aceptada'` y `coalesce(carga_detalle.aceptada, true)`. Rechazada o renglón `aceptada = false` = no cuenta.
- Merma / Consumo / Descuentos = **solo** `operacion_almacen` (`merma`, `consumo`, `descuento`) vivas de hoy. Nada de `movimiento_inventario`, `proceso_oficina` ni cortes. Entradas = `entrada` + `envio` con destino esta sucursal; Envíos = `envio` de esta sucursal.
- Inicial = `dias[0].inicial` de PT con Ventas para hoy (ajuste de hoy o Final de ayer); `null` → Inicial y Actual `null` ("Sin inventario inicial"), nunca 0. No duplicar esa cuenta.
- "Hoy" = hoy de Tijuana del servidor (mismo helper que PT con Ventas); el portal nunca lo calcula.
- Permiso nuevo `inventario_pt_recargas.ver` (grupo `Produccion/Almacen`, ⓘ en `lib/explicacion-permisos.ts`); ajustar sigue siendo `inventario_pt.ajustar` con los endpoints de ajustes existentes.
- Diseño "parecido a todo": igual que PT con Ventas (piezas de `components/ui/`, tamaños con `claveTamano`/`compararTamano`, `SelectorSegmentado`), cabe a 1366 px, sin scroll horizontal de la página.
- Roberto tiene backend (3010) y portal (3001) prendidos: no apagar, **no `npm run build`**, sin `git stash`, migración solo a la base LOCAL.

## Review Focus

1. Un vendedor con una recarga pendiente y otra aceptada con un renglón rechazado: cuenta la pendiente completa y solo los renglones aceptados de la otra; una carga eliminada no cuenta. → e2e Tarea 2.
2. Merma/consumo de la app y de Procesos (con vendedor u Oficina) **no** cambian esta pantalla, aunque sí cambien PT con Ventas. → e2e Tarea 2.
3. Ajuste de hoy guardado: el Inicial de esta pantalla es el del ajuste y lleva "Ajustado"; sin ajuste hoy, el Inicial es igual al Final de ayer que devuelve `GET /inventario-pt?fecha=<ayer>`. → e2e Tarea 2.
4. Envío TJ→MX de hoy: resta en TJ (Envíos), suma en MX (Entradas); con Todas, Envíos y Entradas de ese envío se compensan en Actual. → e2e Tarea 2.
5. Usuario con `inventario_pt_recargas.ver` pero sin `inventario_pt.ver`: la pantalla y sus detalles funcionan; sin `inventario_pt.ajustar` no aparece "Ajustar inventario". → e2e Tarea 2 + prueba Tarea 3.

---

### Tarea 1: Migración y pgTAP
**Files:** `supabase/migrations/20261201120000_permiso_inventario_pt_recargas.sql`, `supabase/tests/99_inventario_pt_test.sql` (o uno nuevo `99_inventario_pt_recargas_test.sql`), el conteo de permisos de `supabase/tests/93_permiso_sucursal_test.sql` si aplica, `apps/backend/src/database/schema.d.ts` (sin cambios esperados).
- Insert del permiso `inventario_pt_recargas.ver` con descripción y grupo `Produccion/Almacen`, igual que se insertaron `inventario_pt.ver`/`.ajustar` en `20261130120000_inventario_pt_ajuste.sql`.
- [ ] pgTAP rojo (el permiso existe con su grupo) → migración → `npm run supabase -- migration up --local`, `npm run supabase -- test db` PASS → prueba en autocommit como el CI (base temporal `prueba_ci`, borrarla) → `npm run db:types --workspace=apps/backend` sin diff → **Commit** `Inventario de PT con Recargas: permiso`.

### Tarea 2: Backend
**Files:** `produccion/{reglas-inventario-pt-recargas.ts,reglas-inventario-pt-recargas.spec.ts,inventario-pt-recargas.repository.ts,inventario-pt-recargas.service.ts,inventario-pt-recargas.controller.ts,dto/inventario-pt-recargas.dto.ts}`, `inventario-pt.service.ts` (exponer lo mínimo para leer el Inicial de hoy por ámbito sin pasar por el permiso `inventario_pt.ver`), `produccion.module.ts`, e2e `apps/backend/test/inventario-pt-recargas.e2e-spec.ts`.
**Produces:**
```ts
interface MovimientosRecargas { recargas: number; envios: number; entradas: number; merma: number; consumo: number; descuentos: number }
interface RenglonPtRecargas extends MovimientosRecargas { presentacionId: string; producto: string; volumen: string;
  inicial: number | null; actual: number | null; ajustado: boolean }
// reglas puras:
function actualDelDia(inicial: number | null, m: MovimientosRecargas): number | null
function porProductoRecargas(renglones: readonly RenglonPtRecargas[]): RenglonPtRecargas[]  // suma; null se propaga; ajustado=false
// GET /inventario-pt/recargas?sucursal&vista=presentacion|producto
//   → { fecha, hoyEnTijuana, consultadoEn /* "hh:mm" Tijuana */, renglones: RenglonPtRecargas[] }
// GET /inventario-pt/recargas/detalle?(presentacion|producto)&sucursal&columna=recargas|descuentos
//   → { detalle: { quien: string; carga: number | null; estado: 'pendiente'|'aceptada' | null; piezas: number }[] }
```
Permiso de ambos GET: `inventario_pt_recargas.ver`. Ruta: declarar `recargas` antes de cualquier ruta con parámetro del controller existente (si lo hubiera) para que no la capture. Alcance como PT con Ventas (atado a otra = 403; `todas` permitido; sucursal inexistente = 400 con el mismo mensaje). Presentaciones: vivas + desactivadas/dadas de baja con algún movimiento hoy. Con Todas: movimientos sumados por presentación; Inicial = el total que ya da PT con Ventas para Todas; Actual `null` si Inicial `null`. `ajustado` solo por presentación (en *producto* siempre `false`). Descuentos detalle = `trabajador` de las operaciones `descuento` de hoy (carga/estado `null`); recargas detalle = nombre del vendedor, `carga.numero`, estado, piezas contadas según la regla.
- [ ] Unit de la regla (`actualDelDia` con números del Excel: Inicial 3022, Recargas 1022, Envíos 1000 → 1000; `null` se propaga; por producto suma y propaga `null`) → e2e (cada columna con su fuente; Review Focus 1–5; carga de otra sucursal no cuenta; fecha de ayer no cuenta; detalle de recargas y de descuentos; permisos 403 sin `inventario_pt_recargas.ver`; alcance) → implementar (una consulta agrupada por sucursal y presentación, sin N+1) → pasan; unit completo, e2e `inventario-pt-recargas` + `inventario-pt` + `cortes`, lint → **Commit** `Inventario de PT con Recargas: backend`.

### Tarea 3: Portal
**Files:** `lib/inventario-pt-recargas.ts` (tipos duplicados del backend + llamadas), `components/inventario-pt-recargas/` (pantalla, tabla, ventana "A quién" + pruebas), `app/(portal)/produccion/inventario-pt-recargas/page.tsx`, `components/layout/nav-config.ts` (Producción, **antes** de "Inventario de PT con Ventas"), `lib/explicacion-permisos.ts`, y lo mínimo de `components/inventario-pt/` para reutilizar (p. ej. exportar piezas de la tabla o permitir fijar la fecha de `ajustes-inventario-pt.tsx` en hoy).
- Encabezado con `EncabezadoPantalla` ("Inventario de PT con Recargas" + una línea: lo que hay hoy en el almacén después de las recargas y envíos). Debajo: "Hoy, <día escrito>" (`diaEscrito`) " · a las <consultadoEn>" y botón **Actualizar**; `SelectorSegmentado` Por presentación | Por producto; botón **Ajustar inventario** (solo con `inventario_pt.ajustar`; deshabilitado con Todas, como en PT con Ventas) que abre la pantalla de ajustes existente fija en hoy y al volver recarga.
- Tabla: columnas Producto · Inicial · Recargas · Envíos · Entradas/Compras · Merma · Consumo · Descuentos · **Actual**; agrupada por tamaño con total (un total con algún `null` queda vacío, como en PT con Ventas); marca "Ajustado" en el Inicial; aviso "Sin inventario inicial" igual al de PT con Ventas. Recargas o Descuentos ≠ 0 son botones que abren la ventana "A quién" (Recargas: Vendedor · Carga · Estado · Piezas + total; Descuentos: Trabajador · Piezas + total).
- [ ] Pruebas rojas (tabla agrupada con totales; Por producto; sin inicial; Ajustado; a quién de recargas y de descuentos; Actualizar vuelve a pedir; Ajustar visible solo con permiso y deshabilitado con Todas; sin `inventario_pt_recargas.ver` → `EstadoPantalla` sin permiso; el menú la tiene antes de PT con Ventas) → implementar → `npm test --workspace=apps/portal`, lint, tsc → **Commit** `Inventario de PT con Recargas: pantalla`.

### Tarea 4: Navegador y documentación
- [ ] Con los servidores de Roberto, a 1366 px, con datos de la base LOCAL (crear lo necesario con comentario "Prueba PT recargas" y borrarlo al final): una recarga pendiente y una aceptada con un renglón rechazado, un envío, una entrada, merma/consumo/descuento del Registro; ver Por presentación y Por producto, a quién, Actualizar, Ajustar inventario (fijo en hoy) y Todas. Sin scroll horizontal.
- [ ] `CLAUDE.md` (bloque nuevo "Inventario de PT con Recargas" junto al de PT con Ventas: fórmula, fuentes, regla de recargas, Inicial compartido, permiso, endpoints, migración y pre-flight "nada que contar"), vault (`10-Dominio/Modulos/Inventario.md`, `00-Inicio/Estado del proyecto.md`, bitácora; commit sin push) → **Commit** `Docs: Inventario de PT con Recargas`.

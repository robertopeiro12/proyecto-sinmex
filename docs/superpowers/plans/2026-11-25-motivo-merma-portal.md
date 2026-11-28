# Motivo de la merma en el portal (mermas y cambios de la app) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La oficina ve en el portal cada merma que el vendedor registra en la app, con su **motivo** y comentario, y los cambios de la app, en las pestañas del Flujo diario / Dashboard que se dejaron reservadas para eso.

**Architecture:** El repositorio del detalle (`estadisticas/detalle.repository.ts`) lee los movimientos vivos de la tablet (`movimiento_inventario` + `movimiento_inventario_linea` + `motivo_merma`) del día como filas planas; `reglas-detalle.ts` las pasa al detalle del vendedor (`movimientos`) y al del día (`mermas`). El portal agrupa y pinta: la pestaña "Mermas/Cambios/Promociones" del vendedor (Dashboard y Flujo diario › Por vendedor) y la pestaña "Mermas" de Flujo diario › Por día.

**Tech Stack:** NestJS + Kysely (`sql` crudo como el resto del repositorio), Next.js + vitest.

**Spec:** sin spec propio. Fuentes: issue #162 (T-81, criterio "El portal muestra el motivo donde hoy se ven los movimientos de merma"), spec `docs/superpowers/specs/2026-11-09-dashboard-flujo-diario-design.md` §5 y §6 (pestaña "Mermas, cambios y promociones": un bloque por cliente; "Cambios / Cambios recibidos" lado a lado; la merma sin cliente arriba; "Las secciones de merma y cambio aparecen cuando existan esos datos"; Por día › Mermas: Producto · Cantidad) y su maqueta `docs/superpowers/specs/2026-11-09-dashboard-flujo-diario/maqueta-dashboard.html` (bloque "Mermas, cambios y promociones"). Decisión de Mario (2026-11-25): alcance **mermas y cambios**, con motivo y comentario.

## Global Constraints

- Rama `feature/motivo-merma-portal`, worktree `JAWA ANDROID/proyecto-sinmex-motivo-merma`. Nunca tocar `JAWA ANDROID/proyecto-sinmex`.
- **Sin migraciones, sin cambios a la tablet ni al contrato de sincronización.** Solo lectura en el backend.
- Solo movimientos **de la tablet** (`movimiento_inventario`), vivos (`deleted_at is null`), con `fecha` = el día del detalle, del alcance del detalle (vendedor, o sucursal del vendedor). Los procesos de la oficina (`proceso_oficina`) **no** entran (se ven en Operación › Procesos). El **consumo no** entra.
- Producto como en el resto del detalle: `producto.nombre || ' ' || presentacion.volumen`.
- Motivo `null` (tablet vieja, antes de la pieza 4) se muestra como **"Sin motivo"** en texto tenue; un motivo dado de baja se muestra con su nombre igual.
- Textos en español de México; iconos SVG, nunca emojis.
- Sin cambiar las columnas ni la cuenta de piezas de ningún reporte: es información nueva en pestañas que ya existen.

## Review Focus

1. Un movimiento con varias líneas (dos productos en una merma): un renglón por línea, cada uno con el motivo y comentario del movimiento. → Task 1 (reglas) y Task 2.
2. Merma de cliente con reposición: lo `recibido` es la merma (con motivo); lo `entregado` es la reposición y va aparte, sin motivo. → Task 1 y 2.
3. Movimiento borrado o de otra fecha / otro vendedor / otra sucursal: no sale. → Task 1 (e2e).
4. Un cliente con solo cambios (sin promociones ni mermas) también tiene su bloque; sin nada en el día: "Sin mermas, cambios ni promociones este día." → Task 2.
5. Merma sin motivo (tablet vieja): "Sin motivo", nunca vacío ni "null". → Task 2.

---

### Task 1: Backend — movimientos de la tablet en el detalle

**Files:**
- Modify: `apps/backend/src/modules/estadisticas/detalle.repository.ts` (consulta `movimientos(cond, fecha)` en el `Promise.all` de `filas`; `FilasDetalle.movimientos`)
- Modify: `apps/backend/src/modules/estadisticas/reglas-detalle.ts` (+ `reglas-detalle.spec.ts`)
- Test: el e2e existente del detalle del vendedor / del día (buscar el que cubre `promociones` en `apps/backend/test/`)

**Interfaces:**
- Produces (fila plana del repositorio):
  `MovimientoFila = { tipo: 'merma_cliente' | 'merma_trayecto' | 'cambio'; vendedor: string; cliente: string | null; producto: string; sentido: 'recibido' | 'entregado'; piezas: number; motivo: string | null; comentario: string | null; registradoEn: string /* ISO UTC */ }`
- Produces (respuesta):
  - `DetalleVendedorDia.movimientos: MovimientoDetalle[]` con `MovimientoDetalle = { tipo; cliente: string | null; producto: string; sentido; cantidad: number; motivo: string | null; comentario: string | null }`. Orden: `registradoEn`, luego producto.
  - `DetalleDia.mermas: { vendedor: string; cliente: string | null; producto: string; cantidad: number; motivo: string | null }[]`: solo `merma_trayecto` y las líneas `recibido` de `merma_cliente` (nada de cambios ni reposiciones). Orden: vendedor, `registradoEn`, producto.

Consulta: `movimiento_inventario mi join movimiento_inventario_linea l on l.movimiento_id = mi.id join vendedor v on v.id = mi.vendedor_id join sucursal s on s.id = v.sucursal_id left join cliente cl on cl.id = mi.cliente_id join presentacion p … join producto pr … left join motivo_merma mm on mm.id = mi.motivo_merma_id where mi.deleted_at is null and mi.fecha = ${fecha}::date and mi.tipo in ('merma_cliente','merma_trayecto','cambio') and ${cond}` (misma `cond` que el resto: `v.id` o `s.codigo`). `registrado_en` con el helper `iso()` del archivo.

- [ ] **Step 1: Failing tests** (reglas, puras): con filas planas de ejemplo, `armarDetalleVendedor(...).movimientos` trae un renglón por línea con `cantidad` = `piezas`, motivo y comentario del movimiento, en orden de `registradoEn`; `armarDetalleDia(...).mermas` trae la merma del vehículo y la línea `recibido` de una merma de cliente, **no** la línea `entregado` (reposición) ni los cambios, con `vendedor`; listas vacías sin movimientos.
- [ ] **Step 2: Failing e2e:** en el e2e del detalle, sembrar para el vendedor del día una `merma_cliente` con motivo (recibido 3 + entregado 2), una `merma_trayecto` sin motivo, un `cambio`, un movimiento **borrado** y uno de **otra fecha**; el detalle del vendedor trae exactamente las 4 líneas vivas del día con su motivo (`null` en la del trayecto), y el del día trae 2 mermas. Seguir cómo ese e2e ya siembra datos (sucursal con código propio para no chocar con otras suites).
- [ ] **Step 3: Implement** repositorio y reglas.
- [ ] **Step 4:** `npm test` y el e2e del archivo (`set -a; . "../proyecto-sinmex/.env.test"; set +a` desde la raíz del worktree), `typecheck`, `lint` del backend → PASS.
- [ ] **Step 5: Commit** — `Motivo de merma en el portal: movimientos de la tablet en el detalle del flujo diario`

---

### Task 2: Portal — pestañas de mermas y cambios

**Files:**
- Modify: `apps/portal/src/lib/flujo-diario.ts` (tipos `movimientos` y `mermas`, iguales a los del backend)
- Modify: `apps/portal/src/components/flujo-diario/detalle-vendedor-pestanas.tsx` (`PestanaMermas`), `detalle-vendedor.tsx` (pasarle `detalle.movimientos`), `detalle-dia.tsx` (pestaña "Mermas")
- Modify: los fixtures de pruebas del portal que construyen `DetalleVendedorDia` / `DetalleDia` (agregar `movimientos: []` / `mermas: []`)
- Test: pruebas vitest junto a esos componentes

**Interfaces:**
- Consumes: `DetalleVendedorDia.movimientos`, `DetalleDia.mermas` (Task 1).
- `PestanaMermas({ promociones, movimientos })`.

Pestaña del vendedor ("Mermas/Cambios/Promociones"), mismo estilo que hoy (`TituloBloque`, `CajaTabla`, `Tabla densidad="compacta"`, encabezado de cliente `Cliente: …`), en este orden:
1. **"Merma del vehículo"** (si hay `merma_trayecto`): Producto · Cantidad · Motivo · Comentario.
2. Un bloque por cliente (unión de clientes de mermas, cambios y promociones; orden alfabético):
   - **"Mermas recibidas"** (`merma_cliente`, `recibido`): Producto · Cantidad · Motivo · Comentario.
   - **"Reposición entregada"** (`merma_cliente`, `entregado`): Producto · Cantidad.
   - **"Cambios (entregó)"** y **"Cambios recibidos"** lado a lado (`cambio`, `entregado` / `recibido`): Producto · Cantidad.
   - **"Promociones"**: como hoy (Producto · Cantidad + Total).
   - Cada sub-tabla aparece solo si tiene renglones.
3. Sin nada: "Sin mermas, cambios ni promociones este día."
Motivo `null` → "Sin motivo" con `text-muted-foreground`. Comentario `null` → celda vacía.

Pestaña "Mermas" de Por día: reemplaza el `SinDatos` "Todavía no se registran mermas en el sistema." por una tabla `aria-label="Mermas"`: Vendedor · Cliente · Producto · Cantidad · Motivo; cliente `null` → "Vehículo". Vacía: "Sin mermas este día." Quitar del comentario de `DetalleDia` lo de "las mermas todavía no existen en la base" y del de `PestanaMermas` lo de "las mermas y cambios no existen en la base".

- [ ] **Step 1: Failing tests:** vehículo + cliente con merma (motivo y "Sin motivo"), reposición, cambios a los dos lados, cliente solo con cambios tiene bloque, vacío dice el texto; Por día: tabla con "Vehículo" y motivo, vacío.
- [ ] **Step 2–4:** implement; `npm test`, `typecheck` y `lint` del portal → PASS (los 20 fallos ya existentes de `localStorage.clear is not a function` no cuentan; ningún fallo nuevo).
- [ ] **Step 5: Commit** — `Motivo de merma en el portal: mermas y cambios de la app en el flujo diario`

---

### Task 3: Cierre

- [ ] Revisión visual del portal a 1366 px contra el Postgres local con datos sembrados (pestaña del vendedor en Dashboard y en Flujo diario, y Por día › Mermas).
- [ ] `CLAUDE.md`: una viñeta en el bloque de la pieza 4 del rediseño (merma y cambios): dónde los ve la oficina y que el consumo y los procesos de oficina no salen ahí. Sin migración que subir.
- [ ] Push de la rama y PR con `Refs #162` (la semilla de motivos sigue por definir con el cliente).

# Inventario por vendedor — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pantalla *Producción → Inventario por vendedor* (pestañas Inventario · Recargas · Merma, por tamaño) y la misma
información en el detalle del vendedor del Dashboard y del Flujo diario, con la pastilla del corte en su columna
"Inventario".

**Architecture:** El backend reusa la cuenta del corte (`movimientosDelDia` + `armarCorte` de
`apps/backend/src/modules/produccion/`) en un endpoint nuevo `GET /inventario-vendedor` del módulo de producción, y
agrega el estado del corte a los renglones del Dashboard/Flujo diario (`modules/estadisticas/`). El portal arma las
secciones por tamaño con las funciones que ya existen en `apps/portal/src/lib/cortes.ts` y un componente de tablas que
usan la pantalla nueva y la pestaña del detalle.

**Tech Stack:** NestJS + Kysely + Jest (backend), Next.js + Tailwind 4 + Vitest/Testing Library (portal).

**Spec:** `docs/superpowers/specs/2026-11-24-inventario-por-vendedor-design.md` (y
`2026-11-18-corte-por-tamano-y-merma-design.md` para la cuenta).

## Global Constraints

- Una sola cuenta: teórica, merma teórica, resultados, faltantes y tamaños salen de `reglas-corte.ts` (backend) / `lib/cortes.ts` (portal). No se recalcula nada aparte.
- Permiso `inventario.ver` (ya existe; sin migración). Alcance como el corte: sucursal ajena 403, vendedor ajeno o dado de baja 404, fecha futura 400 con `hoyEnTijuana`.
- Resultados vacíos (no 0) si el corte del vendedor no está hecho. Resultado > 0 en rojo; negativo sin rojo.
- "Todos" = suma por presentación de los vendedores de la sucursal; los totales de resultado solo suman vendedores con corte hecho; `vendedoresSinCorte` los cuenta.
- Columnas exactas — Inventario: Producto · (Operación del vendedor) Piezas cargadas · Ventas · Merma registrada en sistema · Cambio físico entregado · Cambio físico recibido · Promoción · Consumo · (Validación por almacén) Piezas teóricas por regresar · Piezas reales retornadas · Resultado. Merma: Producto · (Operación del vendedor) Merma recibida del cliente · Merma de almacén · (Validación por almacén) Merma teórica por regresar · Merma real validada · Resultado. Recargas: Producto · Usuario recarga/respuesta · Piezas cargadas · Hora de recarga · Estado (+ Vendedor con "Todos").
- Tipos duplicados backend ↔ portal en el mismo commit (el portal no importa del backend).
- Textos en español, piezas de `components/ui/`, sin `window.confirm`. Cabe a 1366 px (≈1012 px de caja): `table-fixed` + `colgroup`; separador vertical entre bloques como el corte (`border-l-2 border-l-foreground/20`).
- Comandos desde la raíz con `--workspace`. Base local en Docker ya arriba; nunca `.env.development` tal cual.

## Review Focus

1. **"Todos" con vendedores sin corte:** el total del resultado no debe tratar como 0 a quien no tiene corte. → e2e Tarea 1, unit Tarea 3.
2. **Recarga rechazada o pendiente:** sale en Recargas con su estado pero no suma en Inventario. → e2e Tarea 1.
3. **Flujo diario con rango de varios días:** cada renglón (vendedor, fecha) trae el estado de su propio corte. → e2e Tarea 2.
4. **Usuario sin `inventario.ver` en el Dashboard:** la pestaña dice "No tienes permiso" y el resto del detalle sigue funcionando. → prueba Tarea 5.
5. **Vendedor sin movimiento ese día** elegido en la pantalla: tabla vacía con mensaje, no error. → e2e Tarea 1, prueba Tarea 4.

---

### Tarea 1: Endpoint `GET /inventario-vendedor` (backend)

**Files:**
- Create: `apps/backend/src/modules/produccion/inventario-vendedor.controller.ts`, `inventario-vendedor.service.ts`, `reglas-inventario-vendedor.ts` (+ `.spec.ts`), `dto/inventario-vendedor.dto.ts`
- Modify: `apps/backend/src/modules/produccion/produccion.module.ts`, `cortes.repository.ts` (consulta de recargas)
- Test: `apps/backend/test/inventario-vendedor.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `RecargaInventario { cargaId: string; numero: number; vendedorId: string; vendedor: string; presentacionId: string; nombre: string; producto: string; volumen: string; piezas: number; capturo: string; hora: string /* 'HH24:MI' Tijuana de created_at */; estado: 'pendiente'|'aceptada'|'rechazada'; motivoRechazo: string | null }`
  - `InventarioVendedor { fecha: string; hoy: string; sucursal: {id, codigo}; vendedor: {id, nombre} | null; lineas: LineaCortePantalla[]; totales: TotalesCorte; recargas: RecargaInventario[]; vendedoresSinCorte: number; corte: { estado: EstadoCorte; piezasFaltantes: number|null; mermaFaltante: number|null } | null }`
  - `sumarVendedores(cortes: { lineas: LineaCorte[]; hecho: boolean }[]): { lineas: LineaCorte[]; totales: TotalesCorte; vendedoresSinCorte: number }` en `reglas-inventario-vendedor.ts`: suma por `presentacionId` todos los conceptos; `buenas`/`merma`/`faltante`/`resultadoMerma` solo de vendedores con corte hecho (`null` si ninguno con corte tiene esa presentación); `totales.faltante`/`faltanteMerma` con `faltanteDelDia` sobre esas líneas (null si ningún vendedor tiene corte); orden de `armarCorte`.
- Consumes: `movimientosDelDia`, `armarCorte`, `CortesRepository.vendedoresDelDia`/`encabezado`, `resolverAlcance` (como `CortesService.lista`).

- [ ] **Paso 1: Pruebas que fallan.** Unit de `sumarVendedores`: dos vendedores con corte (resultados 2 y −1 en la misma presentación → 1), uno sin corte (sus cargadas suman, sus resultados no; `vendedoresSinCorte` 1), ninguno con corte (resultados y totales `null`). e2e: un vendedor (líneas = las del corte de ese vendedor, `corte.estado` y faltantes); `vendedor=todos` suma dos vendedores y respeta lo de sin corte; recargas con aceptada, pendiente y rechazada (motivo), las dos últimas no suman en cargadas; con "todos", recargas de los dos con su vendedor; vendedor sin movimiento → `lineas: []`, sin error; sin `inventario.ver` 403; sucursal ajena 403; vendedor de otra sucursal 404; fecha futura 400 con `hoyEnTijuana`; `sucursal=todas` → 400 "Elige una sucursal.".
- [ ] **Paso 2:** `npm test --workspace=apps/backend -- reglas-inventario-vendedor` y `npm run test:e2e --workspace=apps/backend -- inventario-vendedor` → FALLAN.
- [ ] **Paso 3: Implementa.** Recargas: `carga` vivas de esa fecha (+ vendedor o sucursal) join `carga_detalle`, `presentacion`, `producto`, `usuario` (capturó), hora con `to_char(c.created_at at time zone 'America/Tijuana','HH24:MI')`; orden hora, vendedor, producto. Con un vendedor: `armarCorte(movimientos, hecho)`; con "todos": `armarCorte` por vendedor y `sumarVendedores`. `@RequierePermiso('inventario.ver')`.
- [ ] **Paso 4:** las dos pruebas → PASAN; `npm test --workspace=apps/backend`, `npm run lint --workspace=apps/backend`, `npm run build --workspace=apps/backend` limpios.
- [ ] **Paso 5: Commit** `Inventario por vendedor: endpoint con inventario, merma y recargas del día`.

---

### Tarea 2: Estado del corte en el Dashboard y el Flujo diario (backend)

**Files:**
- Modify: `apps/backend/src/modules/produccion/cortes.service.ts` (método nuevo), `produccion.module.ts` (exporta `CortesService`), `apps/backend/src/modules/estadisticas/estadisticas.module.ts`, `reglas-flujo-diario.ts`, `flujo-diario.service.ts`, `dashboard.service.ts`
- Test: los e2e existentes del Dashboard y del Flujo diario (`apps/backend/test/` — búscalos por `/dashboard` y `/reportes/flujo-diario`), `reglas-flujo-diario.spec.ts`

**Interfaces:**
- Produces:
  - `CortesService.estadosDelRango(desde: string, hasta: string, codigoSucursal: string | null): Promise<Map<string, EstadoCorteFila>>` con llave `` `${vendedorId}|${fecha}` `` y `EstadoCorteFila = { estado: EstadoCorte; piezasFaltantes: number | null; mermaFaltante: number | null }` (la misma regla que `lista`, un `armarCorte` por vendedor y fecha). Solo fechas con movimiento o corte.
  - `FilaVendedorDia.corte: EstadoCorteFila` (sin movimiento ni corte: `{ estado: 'sin_corte', piezasFaltantes: null, mermaFaltante: null }`).
  - `ResumenDia.faltantesCorte: { piezas: number; merma: number } | null` = suma de `piezasFaltantes`/`mermaFaltante` de los cortes hechos de ese día y sucursal; `null` si ninguno está hecho.
- Consumes: lo de Tarea 1 no; solo el corte existente.

- [ ] **Paso 1: Pruebas que fallan.** Unit: `armarFlujoDiario` suma `faltantesCorte` por día (dos vendedores con 1 y 2 → 3; ninguno hecho → `null`). e2e: Dashboard de hoy trae `corte` del vendedor con corte hecho y faltante, y `sin_corte` del otro; Flujo diario con rango de dos días trae el estado de cada (vendedor, fecha) y `porDia[].faltantesCorte`.
- [ ] **Paso 2:** correr esas pruebas → FALLAN.
- [ ] **Paso 3: Implementa** (las llamadas al corte después de `repo.filas`, una por fecha presente en las filas).
- [ ] **Paso 4:** pruebas → PASAN; `npm test`, lint y build del backend limpios; los e2e de dashboard/flujo existentes siguen pasando.
- [ ] **Paso 5: Commit** `Dashboard y Flujo diario: estado del corte por vendedor y faltantes por día`.

---

### Tarea 3: Tipos y reglas del portal

**Files:**
- Create: `apps/portal/src/lib/inventario-vendedor.ts` (+ `.test.ts`)
- Modify: `apps/portal/src/lib/flujo-diario.ts` (tipos `FilaVendedorDia.corte`, `ResumenDia.faltantesCorte`)

**Interfaces:**
- Consumes: tipos de Tareas 1 y 2 (copiarlos tal cual); de `lib/cortes.ts`: `LineaCorte`, `TotalesCorte`, `EstadoCorte`, `claveTamano`, `compararTamano`, `etiquetaEstadoCorte`.
- Produces:
  - `leerInventarioVendedor(fecha: string, sucursal: string, vendedor: string | "todos"): Promise<InventarioVendedor>`.
  - `gruposPorTamano(lineas: LineaCorte[]): { tamano: string; lineas: LineaCorte[]; totales: TotalesGrupoInventario }[]` — mismo agrupado y orden que `vistaCorte` (clave/compararTamano, producto); `TotalesGrupoInventario` suma cada concepto y `faltante`/`resultadoMerma` con signo, `null` si ninguna línea del grupo lo tiene.
  - `mermaRegistrada(l: LineaCorte): number` = `mermaEntregada + mermaAlmacen`.
  - `textoEstadoRecarga(r: RecargaInventario): string` → "Aceptada", "Pendiente", "Rechazada".
  - `textoHora(hhmm: string): string` → `"07:29"` → `"7:29 a. m."`, `"13:05"` → `"1:05 p. m."`.
  - `textoFaltantesDia(f: { piezas: number; merma: number } | null): string | null` → con la misma frase de `etiquetaEstadoCorte` ("Faltan 3 · 1 de merma", singular con 1); `null` si `null` o los dos en 0.

- [ ] **Paso 1: Pruebas que fallan** de cada función (orden de grupos con "500ML"/"355 ml"/"1 L", totales con `null`, horas límite 00:xx y 12:xx, frases).
- [ ] **Paso 2:** `npm test --workspace=apps/portal -- src/lib/inventario-vendedor` → FALLA.
- [ ] **Paso 3: Implementa.**
- [ ] **Paso 4:** → PASA; `npm run lint` y `npx tsc --noEmit -p apps/portal` (se permiten errores solo en componentes que consumen los tipos nuevos de `flujo-diario.ts` si los hay; anótalos para Tarea 5).
- [ ] **Paso 5: Commit** `Portal: tipos y reglas de Inventario por vendedor`.

---

### Tarea 4: Pantalla *Producción → Inventario por vendedor* (portal)

**Files:**
- Create: `apps/portal/src/components/inventario-vendedor/tablas-inventario.tsx` (las tres sub-pestañas para unos datos dados), `pantalla-inventario-vendedor.tsx` (+ pruebas), `apps/portal/src/app/(portal)/produccion/inventario-vendedor/page.tsx`
- Modify: `apps/portal/src/components/layout/nav-config.ts` (+ su prueba si aplica)

**Interfaces:**
- Consumes: Tarea 3.
- Produces: `TablasInventario({ datos: InventarioVendedor })` — `Pestanas` Inventario · Recargas · Merma; la usa la Tarea 5.

- [ ] **Paso 1: Pruebas que fallan.** Pantalla: abre en hoy con atajos Hoy/Ayer (como Corte, `diaAnterior`), selector de vendedor con "Todos los vendedores" primero, "Elige una sucursal" con todas (`EstadoPantalla`), sin permiso → `EstadoPantalla` sin permiso. Tablas: encabezados exactos de Global Constraints con los dos niveles; sección por tamaño con "Total <tamaño>"; ⓘ en "Merma registrada en sistema" ("Merma entregada al cliente + merma de almacén.") y en los cambios ("Los cambios físicos se registrarán desde la app; por ahora valen 0."); resultados vacíos sin corte, rojo > 0; con "Todos" y `vendedoresSinCorte > 0` un `Aviso` "N vendedores sin corte: sus piezas reales y resultados no se suman."; Recargas con hora "7:29 a. m.", estado y motivo de rechazo, columna Vendedor solo con "Todos"; vacío → "No hubo carga ni venta ese día.".
- [ ] **Paso 2:** `npm test --workspace=apps/portal -- inventario-vendedor` → FALLA.
- [ ] **Paso 3: Implementa** con `EncabezadoPantalla` (título "Inventario por vendedor", una línea: "Lo que cargó, vendió y regresó cada vendedor, por tamaño."), el separador del corte entre bloques, `table-fixed` + `colgroup`. Menú: "Inventario por vendedor" después de "Corte".
- [ ] **Paso 4:** `npm test --workspace=apps/portal`, lint y tsc limpios.
- [ ] **Paso 5: Commit** `Portal: Producción → Inventario por vendedor`.

---

### Tarea 5: Inventario en el Dashboard y el Flujo diario (portal)

**Files:**
- Modify: `apps/portal/src/components/flujo-diario/detalle-vendedor.tsx`, `tabla-por-vendedor.tsx`, `tabla-por-dia.tsx`, `piezas.tsx` (quitar `Pronto` si queda sin uso), `apps/portal/src/components/dashboard/tabla-dashboard.tsx` (+ pruebas de esos componentes)

**Interfaces:**
- Consumes: `TablasInventario`, `leerInventarioVendedor`, `etiquetaEstadoCorte`, `textoFaltantesDia`.

- [ ] **Paso 1: Pruebas que fallan.** La pestaña "Inventario" del detalle ya no está apagada ni dice "pronto"; al abrirla pide `leerInventarioVendedor(fecha, sucursal, vendedorId)` y pinta `TablasInventario`; con 403 muestra "No tienes permiso" y las otras pestañas siguen. La columna "Inventario" del Dashboard y del Flujo *Por vendedor* muestra la pastilla de `etiquetaEstadoCorte(fila.corte)` y al picarla abre el detalle en la pestaña Inventario; *Por día* muestra `textoFaltantesDia` (vacío si `null`) sin botón.
- [ ] **Paso 2:** correr las pruebas de esos componentes → FALLAN.
- [ ] **Paso 3: Implementa.** El detalle pide los datos solo al abrir la pestaña (no al abrir la ventana).
- [ ] **Paso 4:** `npm test --workspace=apps/portal`, lint y tsc limpios.
- [ ] **Paso 5: Commit** `Dashboard y Flujo diario: pestaña Inventario y estado del corte`.

---

### Tarea 6: Revisión en navegador y documentación

- [ ] **Paso 1:** Con backend (3010, base local) y portal (3001) — **si ya están prendidos, reúsalos y NO los apagues** — revisar a 1366 y 1920 px: la pantalla nueva con un vendedor y con "Todos" (datos de ejemplo ya cargados hoy en TJ: Ricardo con corte y faltantes, Juan Pérez sin corte, Pedro Ruiz cuadrado), las tres pestañas, sin scroll horizontal de página; el Dashboard con la pastilla y la pestaña Inventario. Medir el `sticky` de la segunda fila del encabezado si se usa.
- [ ] **Paso 2:** `CLAUDE.md`: bloque nuevo corto "Inventario por vendedor" junto al del corte (endpoint, permiso, "Todos", la columna del Dashboard/Flujo).
- [ ] **Paso 3:** Vault: `10-Dominio/Modulos/Inventario.md` (sección), `00-Inicio/Estado del proyecto.md`, bitácora del día; commit en el vault sin push.
- [ ] **Paso 4: Commit** `Docs: inventario por vendedor`.

# Rediseño app del vendedor — Pieza 6: Corte en la tablet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El vendedor hace su corte en la tablet al terminar la ruta: resumen del día y tres apartados (Efectivo, Notas, Inventario) que cierra uno por uno; el botón Corte pide el kilometraje final, cierra el día y sube el corte como dato informativo.

**Architecture:** Lo que el sistema espera (efectivo, notas, inventario) se calcula con funciones puras sobre los datos locales ya existentes. Lo que el vendedor captura se guarda en una tabla local `corte` (JSON por apartado) en la **misma transacción** que cierra la jornada, y sube como operación nueva **`corte`** (después de `movimientos`), que el servidor guarda en una tabla nueva `corte_vendedor`. Nada de esto cambia saldos, existencias ni el corte de mercancía de la oficina. El candado de Corte del menú se conecta aquí (pieza 1 lo dejó en 0).

**Tech Stack:** Expo + SQLite, NestJS + Kysely, Postgres.

**Spec:** `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md` §13 (Corte), §16-bis. Maquetas 22, 23 y 24.

## Global Constraints

- Rama `feature/rediseno-pieza-1-cascara`; sin PR. Nunca tocar `JAWA ANDROID/proyecto-sinmex`.
- **Migración local 023**; migración del servidor con timestamp único posterior a las anteriores; local + `schema.d.ts`; no a la nube.
- Contrato aditivo (tipo de operación nuevo `corte`, `CONTRATO_ACTUAL` 1); dos `contrato.ts` + doc. Orden del push: `… → movimientos → cortes → rutas`, con su prueba en `fuentes.spec.ts`.
- **Manda la información del sistema**: lo capturado es informativo y no corrige nada.
- El corte de mercancía de la oficina (`/produccion/corte`) no se toca.
- Iconos SVG, textos de las maquetas, dinero con `pesos()`.

## Decisiones de diseño (sin respuesta de Mario)

1. **Efectivo que debe traer** = ventas de contado de hoy + abonos al vender + cobros de hoy en **efectivo** − gastos de hoy. Transferencias y cheques no entran (se muestran aparte como informativo: "Cobros en transferencia / cheque $X").
2. **Notas que trae** = todas las asignadas de hoy (también las que liquidó hoy, marcadas "liquidada $0.00", porque la nota física se regresa) + las suyas de hoy con saldo (`queTraeDelVendedor`, pieza 5, más las asignadas liquidadas hoy).
3. **Inventario** = por producto las piezas buenas por regresar (`filasPorRegresar`) y **un renglón total de merma** (maqueta 24). El vendedor confirma o corrige cada número.
4. **Candado de Corte**: activo solo cuando **hay clientes por visitar y los clientes se pueden abrir** (`candadoDeClientes === null`); con candado de inventario (sin carga aceptada) Corte queda disponible, para no dejar el día sin cerrar (riesgo señalado en la pieza 1). Los prospectos no cuentan.
5. Una vez enviado, el corte no se edita ni se reenvía distinto (la jornada queda cerrada como hoy).

## Review Focus

1. **App cerrada a medio corte**: lo capturado y los apartados cerrados se conservan (borrador local) hasta enviar. → Task 2.
2. **Cerrar jornada falla** (km menor al inicial): no se guarda el corte ni se cierra nada. → Task 2.
3. **Servidor viejo** que no conoce `corte`: la operación queda en error y se reintenta; la jornada sube igual. → Task 3.
4. **Día sin ventas ni ruta**: Efectivo $0.00, sin notas, inventario solo con lo cargado; se puede cerrar. → Task 1.
5. **Corte con día ya cerrado** (jornada cerrada): muestra el resumen de lo enviado en solo lectura. → Task 4.

---

### Task 1: Reglas del corte

**Files:**
- Create: `apps/tablet/src/estado/corte.ts` (+ spec)
- Modify: `apps/tablet/src/datos/repositorios/notas-asignadas.ts` (+ spec) si hace falta una variante que incluya asignadas liquidadas hoy (sin duplicar la regla de `queTraeDelVendedor`)

**Interfaces:**
- Produces: `efectivoEsperado({ ventas, cobros, gastos }): { contadoCentavos: number; abonosCentavos: number; cobrosEfectivoCentavos: number; gastosCentavos: number; debeTraerCentavos: number; otrosMetodosCentavos: number }`; `resumenDelDia({ ventas, cobros, gastos, porVisitar, visitados }): { ventasCentavos; cobranzaCentavos; gastosCentavos; visitados: number; total: number }`; `notasDelCorte(...)`: renglones `{ clave; folio; cliente; estado: 'liquidada' | 'abonó' | 'nueva' | 'pendiente'; montoTexto; saldoCentavos }`; `inventarioDelCorte(filas: FilaPorRegresar[]): { renglones: { presentacionId; etiqueta; sistema: number }[]; mermaSistema: number }`; `type Apartado = 'efectivo' | 'notas' | 'inventario'`; `puedeEnviarCorte(cerrados: ReadonlySet<Apartado>): boolean`; `corteDisponible({ porVisitar, candado, diaCerrado }): boolean`.

- [ ] **Step 1: Failing tests** con los números de la maqueta 22 (contado 3,360 + abonos y cobros 1,550 − gastos 585 = debe traer 4,325), notas de la maqueta 23 (3 de 4), inventario de la 24 (renglones + "Merma Sistema: 5"), `corteDisponible` (por visitar 2 y sin candado → false; con candado de inventario → true; día cerrado → true), `puedeEnviarCorte`.
- [ ] **Step 2–4:** implement; suite, typecheck, lint → PASS.
- [ ] **Step 5: Commit** — `Rediseño pieza 6: reglas del corte del vendedor`

---

### Task 2: Datos locales del corte y cierre atómico

**Files:**
- Create: `apps/tablet/src/datos/migraciones/023-corte.ts` (+ spec): tabla `corte` (`id` = clave, `jornada_id`, `fecha`, `vendedor_id`, `efectivo_json`, `notas_json`, `inventario_json`, `cerrados_json`, `enviado_en`, `sync_estado`, `sync_error`, `sincronizado_en`)
- Create: `apps/tablet/src/datos/repositorios/cortes.ts` (+ spec), registrar en `inicializar.ts`/`index.ts`
- Modify: `apps/tablet/src/datos/repositorios/jornadas.ts` (+ spec): `cerrar` dentro de `enTransaccion`, y `cerrarConCorte(jornadaId, kmFinal, corte)` que guarda el corte y cierra la jornada en la misma transacción

**Interfaces:**
- Produces: `cortes.borrador(jornadaId): CorteBorrador | null`, `cortes.guardarBorrador(jornadaId, parcial)`, `cortes.deHoy(vendedorId)`, `pendientesDeSincronizar()`, `marcarSincronizada/marcarError`; `jornadas.cerrarConCorte(...)`.

- [ ] **Step 1: Failing tests** — borrador se conserva entre lecturas; `cerrarConCorte` con km inválido no guarda corte ni cierra; con km válido guarda ambos; migración 023.
- [ ] **Step 2–4:** implement; suite, typecheck, lint → PASS.
- [ ] **Step 5: Commit** — `Rediseño pieza 6: el corte se guarda y cierra el día en una sola transacción`

---

### Task 3: Operación `corte` (contrato, push y servidor)

**Files:**
- Create: `supabase/migrations/<ts>_corte_vendedor.sql`: tabla `corte_vendedor` (`id` = clave, `vendedor_id`, `sucursal_id`, `fecha`, `efectivo jsonb`, `notas jsonb`, `inventario jsonb`, `enviado_en`, `created_at`; un vivo por vendedor y fecha, único parcial)
- Create: `apps/backend/src/modules/sincronizacion/despacho-corte.ts` (+ spec), `apps/backend/src/modules/rutas/datos-corte.ts` (+ spec) y `cortes-vendedor.service.ts`/`.repository.ts` (+ spec)
- Modify: `despacho.ts`, `sincronizacion.service.ts`, `operaciones.ts`/`TIPOS_OPERACION`, dos `contrato.ts` (`DatosCorte`), `docs/contrato-sincronizacion.md`, `schema.d.ts`
- Create: `apps/tablet/src/sincronizacion/fuente-cortes.ts` (+ spec); Modify: `fuentes.ts` (+ spec del orden), `pendientes.ts` (+ spec)
- Test: e2e del push de corte (en `sincronizacion.e2e-spec.ts` o nuevo `corte-vendedor.e2e-spec.ts`)

**Interfaces:**
- Produces (contrato): tipo `'corte'`; `DatosCorte = { efectivo: { esperado_centavos: number; traido_centavos: number }; notas: { folio: string; traida: boolean; saldo_centavos: number }[]; inventario: { presentacion_id: string; sistema: number; contado: number }[]; merma: { sistema: number; contado: number }; enviado_en: string }`; sin `cliente_id` ni folio; clave uuid.
- Rechazos: forma → `datos-invalidos`; segundo corte del mismo día → `corte-duplicado` (la misma clave es `duplicada`).

- [ ] **Step 1: Failing tests** — forma (unit), despacho (unit), e2e (push guarda la fila; segundo corte del día rechazado; tablet sin el tipo no rompe nada), tablet (fuente arma la operación; orden del push `movimientos → cortes → rutas`; pendientes cuenta cortes).
- [ ] **Step 2–4:** implement; backend unit + e2e tocados, lint; tablet suite/typecheck/lint → PASS.
- [ ] **Step 5: Commit** — `Rediseño pieza 6: la operación corte sube y se guarda en el servidor`

---

### Task 4: Pantalla de Corte y candado del menú

**Files:**
- Create: `apps/tablet/app/(jornada)/corte.tsx` (maquetas 22–24) y registrar en `_layout.tsx`; el menú `corte` apunta a `/(jornada)/corte`; `cerrar-dia.tsx` se borra o queda solo como vista de "día cerrado" dentro de `corte.tsx`
- Modify: `apps/tablet/src/ui/marco-menu.tsx` (pasa `porVisitar` real de `agruparRutaEnCurso(rutas.delDia(vendedor.id))` y respeta `corteDisponible`), `apps/tablet/src/estado/ruta-del-dia.ts` (+ spec) si `entradasMenu` necesita el candado

Pantalla: `MarcoMenu clave="corte"`; si `!corteDisponible` (deep link) aviso "Faltan N clientes por visitar" y nada más; arriba "Resumen del día · N de M visitados" (Ventas, Cobranza, Gastos); pestañas Efectivo / Notas / Inventario con palomita al cerrarse; Efectivo: desglose y "¿Cuánto traes?" + "Cerrar efectivo"; Notas: "Notas que traes N de M" con casillas + "Cerrar notas"; Inventario: renglones "Sistema: 8" con campo (prellenado con el sistema) y el renglón de merma + "Cerrar inventario"; un apartado cerrado se puede reabrir mientras no se envíe; botón **Corte** encendido con los tres cerrados → pide "Kilometraje final" (confirmación con `textoConfirmarCierre`) → `cerrarConCorte` → sincroniza si hay red. Con el día cerrado: resumen de solo lectura y lo pendiente por subir.

- [ ] **Step 1:** construir pantalla y conectar el candado (prueba pura en `ruta-del-dia.spec.ts`/`corte.spec.ts` si cambia la firma).
- [ ] **Step 2:** suite, typecheck, lint → PASS.
- [ ] **Step 3: Commit** — `Rediseño pieza 6: pantalla de corte y candado del menú`
- [ ] **Step 4 (controlador, emulador):** Corte apagado con clientes por visitar; visitar todos; cerrar los tres apartados; km final; en Postgres local `jornada` cerrada y `corte_vendedor` con lo capturado.

---

### Task 5: Cierre

- [ ] Suites completas; `CLAUDE.md` (T-38 jornada: el cierre es el Corte; orden del push con `cortes`; bloque nuevo del corte del vendedor), README, contrato; bóveda (Corte de caja, App Tablet, Estado del proyecto). Push de la rama, **sin PR**.

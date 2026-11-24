# Rediseño app del vendedor — Pieza 3: Aceptar la carga por renglón — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El vendedor acepta su carga como checklist (todo, una parte o nada), sin escribir motivo; lo no palomeado no cuenta en su inventario ni en el corte.

**Architecture:** `carga.estado` conserva sus tres valores; una carga respondida con **al menos un renglón aceptado** queda `aceptada` y con **ninguno** queda `rechazada`. El estado por renglón vive en una columna nueva `carga_detalle.aceptada boolean` (null mientras la carga está pendiente; las cargas viejas aceptadas se leen como "todo aceptado"). La respuesta de la tablet manda la lista de presentaciones aceptadas; el cuerpo viejo (`accion`/`motivo`) sigue funcionando para tablets sin actualizar. Todo lector de "cargas aceptadas" pasa a contar solo renglones aceptados.

**Tech Stack:** Postgres/Supabase, NestJS + Kysely, Next.js (portal), Expo + SQLite (tablet).

**Spec:** `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md` §7 y §16-bis "Inventario y candado de clientes". Maquetas 4 y 5.

## Global Constraints

- Rama `feature/rediseno-pieza-1-cascara`; sin PR (un solo PR al final). Nunca tocar `JAWA ANDROID/proyecto-sinmex`.
- Migración con timestamp único posterior a `20261126120000`; aplicar local, regenerar `schema.d.ts` (con `set -a; . ../proyecto-sinmex/.env.test; set +a`). No se sube a la nube.
- Contrato aditivo, `CONTRATO_ACTUAL` sigue en 1; dos `contrato.ts` + `docs/contrato-sincronizacion.md` en el mismo commit.
- Aceptar sigue necesitando red (endpoint `POST /sync/cargas/:id/respuesta`).
- **La aceptación parcial es definitiva** (spec §16-bis): lo no aceptado se manda en una recarga nueva.
- Un renglón se acepta o no completo; no se aceptan piezas sueltas.
- Tipos duplicados backend ↔ portal (`lib/cargas.ts`, `lib/inventario-vendedor.ts`) cambian en el mismo commit.
- No correr `npm run build` con servidores dev prendidos.

## Decisiones de diseño

1. `ck_carga_motivo` pasa a `motivo_rechazo is null or estado = 'rechazada'` (el motivo deja de ser obligatorio; las filas viejas lo conservan).
2. Una carga **rechazada** (ningún renglón) se puede seguir editando en el portal y vuelve a pendiente, como hoy; una **aceptada** (total o parcial) no se edita.
3. Texto del estado: "Aceptada" si todos los renglones, "Aceptada 3 de 5" si una parte, "Rechazada" si ninguno.

## Review Focus

1. **Carga aceptada antes de esta pieza** (renglones con `aceptada` null): cuenta completa en corte, inventario por vendedor, venta del portal y tablet. → pruebas en Tasks 1 y 3.
2. **Tablet vieja** que manda `{accion:'aceptar'}` o `{accion:'rechazar', motivo}`: sigue funcionando (todo / nada). → Task 1.
3. **Lista de aceptadas con una presentación que no es de la carga, o repetida**: 400. → Task 1.
4. **Pull que llegó antes de responder** no deshace la respuesta ni los renglones. → Task 3.
5. **Candado**: una carga con todos los renglones rechazados se comporta como "rechazada" (clientes cerrados); una parcial abre. → Task 3.

---

### Task 1: Servidor — renglón aceptado y respuesta por lista

**Files:**
- Create: `supabase/migrations/<ts>_carga_renglon_aceptado.sql`: `alter table carga_detalle add column aceptada boolean`; check `ck_carga_motivo` nuevo; (las filas existentes quedan null)
- Modify: `supabase/tests/99_carga_test.sql` (pgTAP del check nuevo)
- Modify: `apps/backend/src/modules/produccion/reglas-carga.ts` (+ spec), `cargas.service.ts`, `cargas.repository.ts`, `dto/cargas.dto.ts`, `apps/backend/src/modules/sincronizacion/cargas-app.controller.ts`, los dos `contrato.ts`, `docs/contrato-sincronizacion.md`, `schema.d.ts`
- Test: `apps/backend/test/cargas-app.e2e-spec.ts`

**Interfaces:**
- Produces (contrato): `CuerpoRespuestaCarga = { version: number; aceptadas: string[] } | { version: number; accion: 'aceptar' | 'rechazar'; motivo?: string }` (la segunda forma es la vieja); `LineaCargaPull.aceptada: boolean | null`.
- Produces (reglas): `normalizarRespuesta(cuerpo, presentacionesDeLaCarga: readonly string[]): RespuestaCarga | error` con `RespuestaCarga = { estado: 'aceptada' | 'rechazada'; aceptadas: ReadonlySet<string>; motivo: string | null }`; la forma vieja `aceptar` = todas, `rechazar` = ninguna con motivo (sigue exigiendo motivo 1..300 en esa forma). `decidirRespuesta` compara también el conjunto para "repetida".
- `escribirRespuesta` pone `carga.estado`, `respondida_en`, `motivo_rechazo` y `carga_detalle.aceptada` por presentación en la misma transacción.

- [ ] **Step 1: Failing tests** — reglas: lista vacía → rechazada sin motivo; todas → aceptada; parte → aceptada con conjunto; presentación ajena o repetida → error; forma vieja aceptar/rechazar. e2e: aceptar 2 de 3 → 200, pull trae `aceptada` por renglón; repetir la misma lista → 200 sin reescribir; otra lista → 409; lista vacía → `rechazada` sin motivo; cuerpo viejo aceptar/rechazar sigue pasando. pgTAP: rechazada sin motivo es válida; motivo con aceptada no.
- [ ] **Step 2: Run** unit y e2e de cargas. FAIL.
- [ ] **Step 3: Implement** (migración local + types).
- [ ] **Step 4: Run** backend unit, e2e de cargas, `npm run supabase -- test db --local` (pgTAP), lint. PASS.
- [ ] **Step 5: Commit** — `Rediseño pieza 3: la carga se acepta por renglón`

---

### Task 2: Servidor — los lectores cuentan solo renglones aceptados

**Files:**
- Modify: `apps/backend/src/modules/produccion/cortes.repository.ts` (`cargasAceptadasDelDia`: `c.estado = 'aceptada' and coalesce(d.aceptada, true)`; `recargas` agrega por renglón `aceptada` y por carga `renglonesAceptados`/`renglones`), `reglas-corte.ts` (doc), `inventario-vendedor.service.ts` y su tipo `RecargaInventario`
- Test: `apps/backend/test/cortes.e2e-spec.ts`, `inventario-vendedor.e2e-spec.ts`, `ventas-inventario.e2e-spec.ts`

**Interfaces:**
- Produces: `RecargaDelDia` gana `renglonesAceptados: number | null` y `renglones: number`, y cada línea `aceptada: boolean | null`.

- [ ] **Step 1: Failing e2e** — carga aceptada 2 de 3: el corte cuenta solo esas 2 presentaciones como cargadas; la venta del portal no deja vender la presentación no aceptada (409 de existencia); inventario por vendedor muestra la recarga "Aceptada 2 de 3"; una carga aceptada vieja (renglones null) cuenta completa.
- [ ] **Step 2–4:** implement; backend unit + e2e tocados + lint. PASS.
- [ ] **Step 5: Commit** — `Rediseño pieza 3: corte, inventario y venta del portal cuentan solo lo aceptado`

---

### Task 3: Tablet — checklist de la carga

**Files:**
- Create: `apps/tablet/src/datos/migraciones/021-carga-renglon.ts` (+ spec): `carga_detalle.aceptada integer` (null/0/1)
- Modify: `apps/tablet/src/datos/repositorios/cargas.ts` (+ spec: `aplicarSnapshotCargas` guarda `aceptada`; `llegaTarde` sin cambio de regla), `apps/tablet/src/datos/inventario-reglas.ts` (+ spec: `existencias` y `candadoDeClientes` cuentan renglones aceptados; null en una aceptada = aceptado), `apps/tablet/src/estado/inventario.ts` (+ spec: `cuerpoRespuesta(version, aceptadas)`, `textoEstadoCarga` "Aceptada" / "Aceptada 3 de 5" / "Rechazada" / "Por aceptar"; quitar `validarRespuesta` del motivo), `apps/tablet/src/sincronizacion/api-carga.ts` si cambia el tipo
- Modify: `apps/tablet/app/(jornada)/inventario/[cargaId].tsx` (maqueta 4: "Seleccionar todos", checklist de renglones con piezas, botón "Aceptar N de M" y "Rechazar todo" con confirmación; sin campo de motivo), `inventario/index.tsx` (pastilla con el texto nuevo; resumen de la maqueta 5)

**Interfaces:**
- Produces: `CargaDetalle.aceptada: 0 | 1 | null`; `cuerpoRespuesta(version: number, aceptadas: readonly string[]): CuerpoRespuestaCarga`; `textoEstadoCarga(carga: CargaConLineas): string`; `alternarRenglon`/`seleccionarTodos` puros para el checklist (en `estado/inventario.ts`).

- [ ] **Step 1: Failing tests** — existencias con carga aceptada 2 de 3 (la tercera no suma); candado: aceptada con todos los renglones en 0 → `rechazada`, con uno en 1 → null; snapshot con `aceptada` por renglón; un pull viejo (misma versión, pendiente) no pisa la respuesta ni los renglones; `cuerpoRespuesta`; `textoEstadoCarga`; checklist puro.
- [ ] **Step 2–4:** implement; suite, typecheck, lint. PASS.
- [ ] **Step 5: Commit** — `Rediseño pieza 3: la tablet acepta la carga como checklist`
- [ ] **Step 6 (controlador, emulador):** con control prendido en la sucursal local: capturar carga en el portal, aceptar 2 de 3 en la tablet, ver Inventario y que la presentación no aceptada no sale en Vender.

---

### Task 4: Portal — renglones aceptados en Recargas e Inventario por vendedor

**Files:**
- Modify: `apps/portal/src/lib/cargas.ts`, `lib/inventario-vendedor.ts`, `components/registro-operacion/rejilla-recargas.tsx`, `components/inventario-vendedor/tablas-inventario.tsx` (+ sus pruebas)

Reglas: en la rejilla, una celda de un renglón no aceptado va con el fondo rojo tenue que hoy usa la rechazada y la etiqueta de la carga dice "Aceptada 3 de 5"; una rechazada sin motivo no pinta "Motivo:". En Inventario por vendedor → Recargas, el estado con el mismo texto.

- [ ] **Step 1: Failing tests** (portal): rejilla con carga parcial pinta las celdas no aceptadas y "Aceptada 2 de 3"; rechazada sin motivo no muestra "Motivo"; tabla de recargas igual.
- [ ] **Step 2–4:** implement; `npm test --workspace=apps/portal`, lint. PASS. Revisar en navegador a 1366 px si hay portal levantado (si no, anotarlo para el controlador).
- [ ] **Step 5: Commit** — `Rediseño pieza 3: el portal muestra qué renglones aceptó el vendedor`

---

### Task 5: Cierre

- [ ] Suites completas, pgTAP; `CLAUDE.md` (bloque T-27 carga y recarga), README de la tablet, contrato; bóveda (Inventario, Estado del proyecto). Push de la rama, **sin PR**.

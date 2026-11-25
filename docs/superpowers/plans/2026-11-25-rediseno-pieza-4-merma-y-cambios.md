# Rediseño app del vendedor — Pieza 4: Merma y cambios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un botón "Merma y cambios" en el cliente con dos apartados; el tipo nuevo **cambio** (lo recibido regresa al inventario del vendedor, lo entregado sale); motivo de merma obligatorio del catálogo del portal (cliente y vehículo); pantalla "Merma / Cambios" del menú con filtros, "Merma del vehículo" y "Consumo"; el corte y la venta del portal cuentan los cambios.

**Architecture:** La operación `movimiento` gana `tipo: 'cambio'` y `motivo_merma_id` (aditivo). El servidor guarda el motivo en `movimiento_inventario.motivo_merma_id` (nulo permitido para filas viejas y tablets viejas), llena las columnas de cambios del corte que hoy valen 0, y baja el catálogo `motivo_merma` en el pull (como `motivos_visita`). La tablet reconstruye su tabla `movimiento` para el check nuevo (receta de la migración 010), guarda el catálogo y copia el nombre del motivo en el movimiento para mostrarlo sin red.

**Tech Stack:** Postgres/Supabase, NestJS + Kysely, Next.js, Expo + SQLite.

**Spec:** `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md` §11 (Merma y cambios), §16-bis "Cambios". Maquetas 14, 15 y 16. Issue #162 (T-81: motivo de merma).

## Global Constraints

- Rama `feature/rediseno-pieza-1-cascara`; sin PR. Nunca tocar `JAWA ANDROID/proyecto-sinmex`.
- Migración del servidor con timestamp único posterior a las de las piezas 2 y 3; local con `migration up --local`; `schema.d.ts` regenerado (`set -a; . ../proyecto-sinmex/.env.test; set +a`). No a la nube.
- **Migración local de la tablet: 022** (020 = pieza 2, 021 = pieza 3).
- Contrato aditivo, `CONTRATO_ACTUAL` 1; dos `contrato.ts` + `docs/contrato-sincronizacion.md` en el mismo commit.
- En pantalla: "Merma y cambios", "Me entregó el cliente", "Le entregué", "Motivo de la merma", "Merma del vehículo", "Consumo".
- Un movimiento grabado no se edita ni se borra en la app.
- Iconos SVG; pgTAP con `npm run supabase -- test db --local`.

## Decisiones de diseño (sin respuesta de Mario)

1. **Motivo**: obligatorio en la app para `merma_cliente` y `merma_trayecto` (de la lista con `aplica_cliente` / `aplica_vehiculo`, respectivamente); el servidor **acepta** su ausencia (tablets viejas, filas viejas) y, si viene, solo exige que exista (uno dado de baja sí entra), como `motivo_visita`. Prohibido en `cambio` y `consumo` (`datos-invalidos`).
2. **Cambio**: con cliente; exige **al menos una pieza recibida y al menos una entregada**; no se cobra diferencia (spec §16-bis). "Me entregó el cliente" elige de **todo el catálogo activo**; "Le entregué" solo de lo que el vendedor trae (con control apagado, todo el catálogo).
3. Un cambio **cuenta como visita** del cliente en la ruta (pieza 1: `visitado`) y el resumen dice "Cambio".
4. La merma del vehículo (M16) lista solo lo que el vendedor trae.
5. Consumo queda como botón secundario en Merma / Cambios, sin motivo.

## Review Focus

1. **Tablet vieja** mandando merma sin motivo: el servidor la acepta. → Task 1.
2. **Cambio que entrega más de lo que trae**: la tablet lo bloquea (faltantes); el servidor no revisa existencia (como hoy). → Task 3.
3. **Cambio recibido** suma a lo vendible en la tablet y en la venta del portal (corte teórica). → Tasks 2 y 3.
4. **Pull con cursor viejo**: los motivos sembrados antes llegan (la migración 022 borra el cursor del pull). → Task 3.
5. **Motivo dado de baja después de capturar sin red**: el movimiento entra igual. → Task 1.

---

### Task 1: Servidor — tipo `cambio` y motivo de merma

**Files:**
- Create: `supabase/migrations/<ts>_movimiento_cambio_motivo.sql`: reemplazar el check de `tipo` (nombre real con `\d movimiento_inventario`) por uno con `'cambio'`; `ck_movimiento_cliente` → `(tipo in ('merma_cliente','cambio')) = (cliente_id is not null)`; `motivo_merma_id uuid references motivo_merma(id)` con check `motivo_merma_id is null or tipo in ('merma_cliente','merma_trayecto')`
- Modify: `supabase/tests/99_movimiento_inventario_test.sql` (el caso que hoy rechaza `'cambio'` pasa a aceptarlo; cambio sin cliente rechazado; motivo en consumo rechazado)
- Modify: `apps/backend/src/modules/inventario/datos-movimiento.ts` (+ spec), `movimientos.service.ts` (+ spec), `movimientos.repository.ts`, `movimiento-rechazado.ts`, `apps/backend/src/modules/sincronizacion/despacho-movimiento.ts` (+ spec), dos `contrato.ts`, `docs/contrato-sincronizacion.md`, `schema.d.ts`
- Test: `apps/backend/test/movimiento.e2e-spec.ts`

**Interfaces:**
- Produces (contrato): `DatosMovimiento.tipo` admite `'cambio'`; `motivo_merma_id?: string | null`.
- Produces: `MovimientoNormalizado.motivoMermaId: string | null`; razón de rechazo nueva `'motivo-merma-inexistente'` (agregar a `CODIGOS_RECHAZO` de los dos contratos si es código nuevo, con su mapeo en `despacho-movimiento.ts`).
- Reglas de forma: cambio con cliente en el sobre, ≥1 `recibido` y ≥1 `entregado`; motivo uuid solo en mermas.

- [ ] **Step 1: Failing tests** (unit de forma, servicio y despacho; e2e: push de un cambio y de una merma con motivo; merma sin motivo entra; motivo inexistente → rechazo; motivo dado de baja → entra; cambio sin entregado → `datos-invalidos`; pgTAP).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (migración local + types). **Step 4: Run** unit, e2e de movimientos, pgTAP, lint → PASS.
- [ ] **Step 5: Commit** — `Rediseño pieza 4: movimiento de cambio y motivo de merma en el servidor`

---

### Task 2: Servidor — corte, inventario por vendedor y venta del portal cuentan cambios; motivos en el pull

**Files:**
- Modify: `apps/backend/src/modules/produccion/cortes.repository.ts` (`movimientosDelDia`: columnas `cambio_entregado`/`cambio_recibido` en cada rama del `union`, `case when mi.tipo = 'cambio' and l.sentido = …`, y quitar los `0 as "cambiosEntregados"/"cambiosRecibidos"`), doc de `reglas-corte.ts`
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts` (`motivosMerma(desde)` como `motivosVisita`), `sincronizacion.service.ts` (colección `catalogos.motivos_merma`), dos `contrato.ts` (`MotivoMermaPull { nombre; aplica_cliente: boolean; aplica_vehiculo: boolean }`), doc
- Modify: `apps/portal/src/components/inventario-vendedor/tablas-inventario.tsx` (quitar el texto "por ahora valen 0" de las ayudas de cambio físico) (+ test si lo cubre)
- Test: `apps/backend/test/cortes.e2e-spec.ts`, `inventario-vendedor.e2e-spec.ts`, `ventas-inventario.e2e-spec.ts`, `sincronizacion.e2e-spec.ts`

- [ ] **Step 1: Failing e2e** — un cambio que recibe 3 Fresa 500 ml y entrega 2 Mango 500 ml: el corte suma 3 a la teórica de Fresa y resta 2 a Mango (`cambiosRecibidos`/`cambiosEntregados`), y no toca la merma teórica; la venta del portal deja vender esas 3 Fresa; inventario por vendedor muestra los cambios; el pull trae `motivos_merma` (vivos y dados de baja como `activo: 0`, incremental por `actualizado_en`).
- [ ] **Step 2–4:** implement; backend unit + e2e tocados, portal tests + lint → PASS.
- [ ] **Step 5: Commit** — `Rediseño pieza 4: el corte cuenta los cambios y los motivos de merma bajan a la tablet`

---

### Task 3: Tablet — datos de cambios y motivos

**Files:**
- Create: `apps/tablet/src/datos/migraciones/022-cambios-motivo-merma.ts` (+ spec): tabla `motivo_merma` (id, nombre, aplica_cliente, aplica_vehiculo 0/1, activo, sincronizado_en); **reconstruir `movimiento`** con el check de `tipo` que incluye `'cambio'`, `cliente_id` obligatorio para merma_cliente y cambio, columnas `motivo_merma_id text` y `motivo_nombre text` (receta de `010-cobranza-sin-folio.ts`: `sinLlavesForaneas` comprobando `movimiento` y `movimiento_linea`, tabla nueva, copia, drop, rename, índices); `delete from sync_cursor where entidad = 'pull'`
- Modify: `src/datos/tipos.ts`, `src/sincronizacion/contrato.ts` (ya en Task 1/2), `src/sincronizacion/motor.ts` (mapeo de `motivos_merma`), `src/datos/repositorios/catalogos.ts` (snapshot, `listarMotivosMerma(aplica: 'cliente' | 'vehiculo')`, `obtenerMotivoMerma`), `src/datos/movimientos-reglas.ts` (+ spec), `src/datos/inventario-reglas.ts` (+ spec: `Existencia` gana `cambiosRecibidos`/`cambiosEntregados`; `existencia` suma recibidos y resta entregados; `mermaRecibida` no cuenta cambios), `src/datos/repositorios/movimientos.ts` (+ spec: `motivoMermaId`, valida motivo vivo con su bandera y copia el nombre; `presentacionesQueTrae(vendedorId)`), `src/sincronizacion/fuente-movimientos.ts` (+ spec), `src/datos/repositorios/rutas.ts` y `src/estado/ruta-del-dia.ts` (+ specs: un cambio marca visitado; resumen "Cambio")

**Interfaces:**
- Produces: `DatosRegistroMovimiento` gana `motivoMermaId?: string | null`; `TipoMovimiento` incluye `'cambio'`; `MotivoMerma` tipo local; `existencias(...)` con cambios.

- [ ] **Step 1: Failing tests** — migración 022 (cambio aceptado, datos viejos conservados, FK íntegras, cursor borrado); reglas (cambio con recibido y entregado; merma sin motivo → error; motivo en cambio → error); existencias con cambio; repositorio (motivo dado de baja o sin la bandera → error; nombre copiado; faltantes del lado entregado); fuente (manda `motivo_merma_id` y `cliente_id` del cambio); ruta (cambio = visitado, "Cambio").
- [ ] **Step 2–4:** implement; suite, typecheck, lint → PASS.
- [ ] **Step 5: Commit** — `Rediseño pieza 4: la tablet guarda cambios y motivos de merma`

---

### Task 4: Tablet — pantallas de Merma y cambios

**Files:**
- Modify (reescribir): `app/(jornada)/operacion/[clienteId]/merma.tsx` (maqueta 14), `app/(jornada)/merma/index.tsx` (maqueta 15), `app/(jornada)/merma/registrar.tsx` (maqueta 16 para merma del vehículo; consumo como hoy)
- Modify: `src/estado/movimiento.ts` (+ spec: `TITULO_MOVIMIENTO` con cambio, `resumenMovimiento` de cambio "Fresa por Mango", `filtrarMovimientos(movs, 'todo' | 'merma' | 'cambios')`, `totalPiezasDelDia`), `src/estado/hoja-cliente.ts` y la hoja (botón "Merma y cambios")

Pantallas:
- **Cliente (M14):** pestañas "Merma · N" / "Cambios · N" (N = piezas recibidas capturadas); en Merma: "Motivo de la merma" (selector de `listarMotivosMerma('cliente')`), "Me entregó el cliente (dañado)" y "Le entregué (opcional)"; en Cambios: "Me entregó el cliente" (todo el catálogo) y "Le entregué" (lo que trae); "Agregar producto" con el mismo selector de la lista de venta (renglón + teclado de la pieza 2); botón "Grabar". Lo capturado en una pestaña no se pierde al cambiar a la otra; cada pestaña graba su propio movimiento.
- **Menú (M15):** botones "Merma del vehículo" (principal) y "Consumo" (secundario, solo si `ofreceConsumo`); tarjeta "Hoy · N movimientos · X pzas"; renglones con hora, cliente o "Vehículo", etiqueta de tipo, motivo o resumen y piezas; filtros abajo Todo / Merma / Cambios.
- **Merma del vehículo (M16):** motivo (`listarMotivosMerma('vehiculo')`), productos que trae con "te quedan N", comentario opcional, "N PIEZAS · Registrar merma".

- [ ] **Step 1: Failing tests** de lo puro nuevo en `movimiento.ts`.
- [ ] **Step 2–4:** implement pantallas; suite, typecheck, lint → PASS.
- [ ] **Step 5: Commit** — `Rediseño pieza 4: pantallas de merma y cambios`
- [ ] **Step 6 (controlador, emulador):** merma con motivo, cambio, merma del vehículo, consumo; filtros; el cambio recibido aparece en Vender; en Postgres local el movimiento trae `motivo_merma_id` y el corte del portal suma el cambio.

---

### Task 5: Cierre

- [ ] Suites completas y pgTAP; `CLAUDE.md` (bloques de merma y consumo T-27 pieza 2, corte de mercancía, venta del portal con la fórmula con cambios), README de la tablet, contrato; bóveda (Inventario: motivo de merma y cambios; Estado del proyecto; cerrar en la nota el pendiente de T-81 que toca a la app). Push de la rama, **sin PR**.

# Notas asignadas en la tablet (PR 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La tablet guarda las notas asignadas, el recado y la ruta del día; pone la nota asignada enfrente al empezar a operar con el cliente (Cobrar / Continuar sin cobrar con comentario), bloquea Vender según la condición y sube el comentario.

**Architecture:** Migración local 019 con tablas nuevas y columnas, y que borra el cursor del pull. La lógica vive en funciones puras (`src/datos/notas-asignadas-reglas.ts`, `src/estado/notas-asignadas.ts`) con pruebas; un repositorio nuevo (`repositorios/notas-asignadas.ts`) lee y escribe; las pantallas solo pintan. El bloqueo se exige también dentro de `ventas.registrar()`, como la carga pendiente.

**Tech Stack:** Expo / React Native, expo-sqlite, Jest (pruebas de la capa de datos con SQLite en memoria, como las existentes).

**Spec:** `docs/superpowers/specs/2026-11-13-notas-asignadas-tablet-condicion-venta-design.md` §2 (reglas 9–11, 15–17) y §6. El servidor ya está en la rama base (`feature/notas-asignadas-condicion-servidor`, PR #158).

## Global Constraints

- Contrato: copia exacta de `apps/backend/src/modules/sincronizacion/contrato.ts` en `apps/tablet/src/sincronizacion/contrato.ts` para `RutaPull.recado`, `RutaDiaPull`, `NotaAsignadaPull` (con `condicion_venta`), `rutas_dia` y `notas_asignadas` en `RespuestaPull` (opcionales en la tablet, como `rutas?`), `'nota-no-cobrada'` en `TipoOperacion`, `DatosNotaNoCobrada`, `'nota-no-cobrada-id-ocupado'` en `CODIGOS_RECHAZO`. `CONTRATO_ACTUAL` sigue en 1.
- Migración local `019-notas-asignadas.ts`, `version: 19`. Nunca editar una migración publicada.
- Condición: `'ninguna' | 'liquidar' | 'abonar'`.
- "Cobro de hoy" = fila de `cobranza` con `fecha` = hoy (fecha de la jornada, `reloj.hoy()`), **nunca** `fecha_pago`, y **nunca** `abonos_json` (el pull lo pisa y trae cobros de la oficina).
- "Tocó la nota" = la nota aparece en `cobranza.reparto_json` de un cobro de hoy (cualquier monto > 0).
- Una nota con `nota_pendiente.saldo_centavos = 0` o sin fila viva en `nota_pendiente` nunca se pide ni bloquea.
- Comentario: recortado, 1 a 300 caracteres. Cada "Continuar sin cobrar" crea su propia fila (no se edita ni se borra).
- Textos fijos: botones **"Cobrar"** y **"Continuar sin cobrar"**; tarjetas **"Notas asignadas por cobrar"** y **"Mensaje de la oficina"**; motivos de bloqueo **"Tiene una nota asignada que debe liquidar antes de venderle"** y **"Tiene una nota asignada que debe abonar antes de venderle"** (si hay de las dos, el de liquidar); condición en pantalla "Debe liquidar" / "Debe abonar" (nada con `ninguna`); grupos de Cobrar **"Asignadas a ti"** y **"Otras notas del cliente"**.
- El servidor no rechaza la venta: el bloqueo es solo de la tablet.
- Orden del push: `jornadas → prospectos → ventas → cobranzas → notas-no-cobradas → visitas → gastos → movimientos → rutas`.
- La tablet no tiene pruebas de componentes: toda decisión de pantalla va en una función pura con prueba; las pantallas solo la llaman.

## Review Focus

1. **Cobro grabado hoy con fecha de pago de ayer**: cumple `abonar` y desbloquea Vender. Test en Task 4.
2. **Pago de la oficina que baja en el pull** (abono en `abonos_json` con fecha de hoy, saldo > 0): **no** cumple `abonar`; si dejó la nota en 0, ya no bloquea. Test en Task 4.
3. **Asignación que llega con `activo: 0`** (la oficina se la pasó a otro o la quitó): deja de pedirse y de bloquear en el siguiente pull. Test en Task 2 y Task 4.
4. **Pull incremental pisa un cobro local sin subir**: `reparto_json` vive en `cobranza`, que el pull no toca, así que el bloqueo sigue cumplido. Test en Task 4.
5. **Vendedor que regresa**: tras "Continuar sin cobrar", al reabrir la ficha la nota sale otra vez y puede cobrarla; después de cobrarla deja de salir. Test en Task 5.

---

### Task 1: Contrato y migración local 019

**Files:**
- Modify: `apps/tablet/src/sincronizacion/contrato.ts`
- Create: `apps/tablet/src/datos/migraciones/019-notas-asignadas.ts`, `019-notas-asignadas.spec.ts`
- Modify: `apps/tablet/src/datos/migraciones/index.ts`, `apps/tablet/src/datos/tipos.ts`

**Interfaces:**
- Produces (SQLite):
  - `alter table ruta add column recado text`
  - `ruta_dia (id text primary key, fecha text not null, nombre_ruta text, vehiculo_id text, activo integer not null default 1, sincronizado_en text not null)`
  - `nota_asignada (id text primary key, venta_nota_id text not null, fecha text not null, condicion_venta text not null check (condicion_venta in ('ninguna','liquidar','abonar')), activo integer not null default 1, sincronizado_en text not null)` + `create index idx_nota_asignada_fecha on nota_asignada (fecha) where activo = 1`. Sin FK a `nota_pendiente`.
  - `nota_no_cobrada (id text primary key, venta_nota_id text not null, cliente_id text not null references cliente(id), vendedor_id text not null references vendedor(id), fecha text not null, comentario text not null, registrado_en text not null, sync_estado text not null default 'pendiente' check (sync_estado in ('pendiente','enviando','sincronizado','error')), sync_error text, sincronizado_en text)` + `idx_nota_no_cobrada_sync (sync_estado) where sync_estado <> 'sincronizado'` + `idx_nota_no_cobrada_nota_fecha (venta_nota_id, fecha)`.
  - `alter table cobranza add column reparto_json text not null default '[]'`.
  - Al final del SQL: `delete from sync_cursor where entidad = 'pull'` (el valor de `CURSOR_PULL`, spec decisión 16).
- Produces (TS, `tipos.ts`): `CondicionVenta`, `RutaDia`, `NotaAsignada`, `NotaNoCobrada` (filas locales); `Ruta.recado: string | null`; `Cobranza.reparto_json: string`.

- [ ] **Step 1: Prueba de la migración que falla** (`019-notas-asignadas.spec.ts`, mismo patrón que `018-movimientos.spec.ts`): las tablas y columnas existen; check de `condicion_venta` rechaza `'otra'`; `cobranza` vieja queda con `reparto_json = '[]'`; un `sync_cursor` con `entidad = 'pull'` desaparece y otro con otra entidad se queda.
- [ ] **Step 2: Correr** `npm test --workspace=apps/tablet -- 019` → FAIL.
- [ ] **Step 3: Implementar** la migración (cabecera de comentario como la 018: qué y por qué, citando la spec), registrarla en `index.ts`, tipos en `tipos.ts` y contrato.
- [ ] **Step 4: Correr** `npm test --workspace=apps/tablet -- migraciones && npm run typecheck --workspace=apps/tablet` → PASS (el `motor.spec.ts` valida versión = índice + 1).
- [ ] **Step 5: Commit** `feat(tablet): contrato y migración local 019 de notas asignadas`.

---

### Task 2: Guardar el pull (recado, rutas_dia, notas_asignadas)

**Files:**
- Modify: `apps/tablet/src/sincronizacion/motor.ts` (`aSnapshot`)
- Modify: `apps/tablet/src/datos/repositorios/catalogos.ts` (`SnapshotCatalogos`, `COLUMNAS`, `guardarSnapshot`)
- Modify: `apps/tablet/src/datos/repositorios/rutas.ts` (`FilaRutaPull`, `aplicarSnapshotRutas`)
- Test: los `.spec.ts` existentes de `catalogos`, `rutas` y `motor`

**Interfaces:**
- Consumes: tablas y tipos de Task 1.
- `SnapshotCatalogos` gana `rutasDia?: Omit<RutaDia,'sincronizado_en'>[]` y `notasAsignadas?: Omit<NotaAsignada,'sincronizado_en'>[]`; `aSnapshot` los llena desde `respuesta.rutas_dia` y `respuesta.notas_asignadas` (ausentes = `undefined`, no escribe nada).
- `guardarSnapshot` hace `upsert` genérico de `ruta_dia` y `nota_asignada` **después** de `nota_pendiente`.
- `FilaRutaPull` incluye `recado`; `aplicarSnapshotRutas` lo escribe en el upsert (un pull de un servidor viejo sin `recado` deja `null`).

- [ ] **Step 1: Pruebas que fallan**: un pull con `rutas_dia`, `notas_asignadas` y `recado` los guarda; un pull incremental con la asignación en `activo: 0` la deja en `activo = 0` (Review Focus 3); un pull sin esas colecciones no borra lo guardado.
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar.** **Step 4: Correr** las suites de `catalogos`, `rutas`, `motor` → PASS.
- [ ] **Step 5: Commit** `feat(tablet): guardar recado, ruta del día y notas asignadas del pull`.

---

### Task 3: La cobranza guarda su reparto

**Files:**
- Modify: `apps/tablet/src/datos/repositorios/cobranzas.ts` (`registrar`, ~l.119-145)
- Test: `apps/tablet/src/datos/repositorios/cobranzas.spec.ts` (o el spec que ya cubre `registrar`)

**Interfaces:**
- `reparto_json` = `JSON.stringify(reparto.aplicaciones.map(a => ({ venta_nota_id: a.notaId, monto_centavos: a.montoCentavos })))`, escrito en el mismo `insert into cobranza`.
- Export nuevo en `cobranzas-reglas.ts`: `leerReparto(json: string): { venta_nota_id: string; monto_centavos: number }[]` (texto corrupto = `[]`, como `leerAbonos`).

- [ ] **Step 1: Pruebas que fallan**: un cobro que alcanza dos notas guarda las dos líneas en orden; `leerReparto('basura')` = `[]`.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`npm test --workspace=apps/tablet -- cobranza`).
- [ ] **Step 5: Commit** `feat(tablet): la cobranza guarda las notas que tocó`.

---

### Task 4: Reglas y repositorio de notas asignadas

**Files:**
- Create: `apps/tablet/src/datos/notas-asignadas-reglas.ts` (+ `.spec.ts`), puro
- Create: `apps/tablet/src/datos/repositorios/notas-asignadas.ts` (+ `.spec.ts`)
- Modify: `apps/tablet/src/datos/inicializar.ts` (cablear `notasAsignadas`)

**Interfaces:**
- `notas-asignadas-reglas.ts`:
  ```ts
  export interface NotaAsignadaDeHoy { asignacionId: string; ventaNotaId: string; clienteId: string; folio: string; fecha: string; saldoCentavos: number; diasAtraso: number; condicion: CondicionVenta; tocadaHoy: boolean; comentadaHoy: boolean }
  export function diasDeAtraso(fechaNota: string, plazoDias: number | null, hoy: string): number; // max(0, hoy - (fecha + plazo)); plazo null = 0
  export function cumpleCondicion(n: NotaAsignadaDeHoy): boolean; // ninguna: true; liquidar: saldo 0; abonar: tocadaHoy || saldo 0
  export function porAtender(notas: NotaAsignadaDeHoy[]): NotaAsignadaDeHoy[]; // saldo > 0 && !tocadaHoy (regla 11: el comentario NO la saca)
  export function motivoBloqueoVenta(notas: NotaAsignadaDeHoy[]): string | null; // textos fijos de Global Constraints; liquidar gana
  export const ETIQUETA_CONDICION: Record<CondicionVenta, string | null>; // 'Debe liquidar' | 'Debe abonar' | null
  ```
- `repositorios/notas-asignadas.ts` (`crearRepositorioNotasAsignadas({ bd, reloj, generarId })`):
  - `deHoyDelCliente(clienteId: string): NotaAsignadaDeHoy[]` — asignación viva de `reloj.hoy()` × `nota_pendiente` viva con `saldo_centavos > 0`… **más** las de saldo 0 (para que `cumpleCondicion` las vea; `porAtender` las filtra); `tocadaHoy` desde `cobranza.fecha = hoy` + `leerReparto`; `comentadaHoy` desde `nota_no_cobrada`; `diasAtraso` con `cliente.plazo_credito_dias`. Orden: fecha, folio.
  - `conteoDeHoyPorCliente(): Map<string, number>` — asignadas por atender por cliente (para la ruta).
  - `bloqueoDeVenta(clienteId: string): string | null` = `motivoBloqueoVenta(deHoyDelCliente(clienteId))`.
  - `registrarNoCobrada({ vendedorId, clienteId, ventaNotaId, comentario }): NotaNoCobrada` — `exigirJornadaAbierta` primero; comentario recortado 1..300 (si no, `ErrorNotaNoCobrada` con "Escribe por qué no te pagó." / "El comentario admite hasta 300 caracteres."); `id = generarId()`, `fecha = reloj.hoy()`, `registrado_en = reloj.ahora()`.
  - `pendientesDeSincronizar()`, `marcarSincronizada(id)`, `marcarError(id, motivo)` — patrón de `gastos.ts`.

- [ ] **Step 1: Pruebas puras que fallan** (`notas-asignadas-reglas.spec.ts`): días de atraso (con plazo, sin plazo, no negativo); `cumpleCondicion` por las tres condiciones; `porAtender` deja una comentada sin cobrar y saca una tocada; `motivoBloqueoVenta` con liquidar+abonar da el de liquidar, con todo cumplido da `null`.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5: Pruebas del repositorio que fallan** (SQLite en memoria, como los demás repos): Review Focus 1 (cobro con `fecha` hoy y `fecha_pago` ayer cumple `abonar`); Review Focus 2 (abono de la oficina en `abonos_json` con saldo > 0 no cumple; con saldo 0 no bloquea); Review Focus 3 (asignación `activo = 0` no aparece); Review Focus 4 (tras un `guardarSnapshot` que reescribe `nota_pendiente` con el saldo viejo, el cobro local de hoy sigue cumpliendo `abonar`); asignación de ayer no aparece; `registrarNoCobrada` con día cerrado lanza el error de jornada y con comentario vacío lanza `ErrorNotaNoCobrada`.
- [ ] **Step 6–7:** implementar → `npm test --workspace=apps/tablet -- notas-asignadas` y typecheck → PASS.
- [ ] **Step 8: Commit** `feat(tablet): reglas y repositorio de notas asignadas`.

---

### Task 5: Bloqueo dentro de la venta y estado de pantalla

**Files:**
- Modify: `apps/tablet/src/datos/repositorios/ventas.ts` (~l.232, dentro de la transacción, junto a `bloqueoDeVenta` de carga)
- Create: `apps/tablet/src/estado/notas-asignadas.ts` (+ `.spec.ts`), puro
- Test: el spec de `ventas.registrar`

**Interfaces:**
- `ventas.registrar` llama `notasAsignadas.bloqueoDeVenta(datos.clienteId)` (o la misma consulta con `bd` dentro de la transacción) y lanza `ErrorVenta(motivo + '. Cóbrala antes de vender.')`. Sin asignadas o con la condición cumplida, nada cambia.
- `estado/notas-asignadas.ts`:
  ```ts
  export type DestinoVender = { tipo: 'venta' } | { tipo: 'notas'; siguiente: 'venta' };
  export function destinoAlVender(porAtender: NotaAsignadaDeHoy[], yaVistasEnEstaVisita: boolean): DestinoVender; // con por atender y sin haberlas visto → 'notas'
  export function despuesDeContinuar(notas: NotaAsignadaDeHoy[], siguiente: 'venta' | null): { tipo: 'venta' } | { tipo: 'ficha'; motivo: string | null };
  export function validarComentario(texto: string): string | null; // mismos mensajes que el repositorio
  export function crearGuardiaComentario(): ... // reutilizar `crearGuardiaRegistro` de `src/estado/movimiento.ts` si sirve tal cual (doble toque)
  ```

- [ ] **Step 1: Pruebas que fallan**: `ventas.registrar` con una asignada `liquidar` sin cobrar lanza con "Tiene una nota asignada que debe liquidar antes de venderle"; tras un cobro que la liquida, graba. `destinoAlVender` y `despuesDeContinuar` en sus casos; Review Focus 5 (comentada sin cobrar → `porAtender` la sigue dando → `destinoAlVender(..., false)` = notas; cobrada → `[]` → venta).
- [ ] **Step 2–4:** FAIL → implementar → PASS (`npm test --workspace=apps/tablet -- ventas notas-asignadas`).
- [ ] **Step 5: Commit** `feat(tablet): la venta respeta la condición de la nota asignada`.

---

### Task 6: Subir el comentario (push)

**Files:**
- Create: `apps/tablet/src/sincronizacion/fuente-notas-no-cobradas.ts` (+ `.spec.ts`)
- Modify: `apps/tablet/src/sincronizacion/fuentes.ts` (`fuentesDelPush`), `pendientes.ts` (`FuentesConPendientes`, `contarPendientesDeSubir`) y sus specs

**Interfaces:**
- `FuenteOperaciones` con `tipo: 'nota-no-cobrada'`; cada operación: `clave` = id, `cliente_id`, `fecha_operacion` = `fecha`, `ocurrido_en` = `registrado_en`, `datos: { venta_nota_id, comentario, registrado_en }`, sin folio. Copiar el patrón de `fuente-gastos.ts`.
- Rechazos `nota-no-encontrada` y `nota-no-cobrada-id-ocupado`: `marcarError` con el motivo; sin reintento automático (igual que el gasto).

- [ ] **Step 1: Pruebas que fallan**: forma de la operación; la prueba de orden de `fuentesDelPush` con `notas-no-cobradas` después de cobranzas; `contarPendientesDeSubir` cuenta los comentarios pendientes.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`npm test --workspace=apps/tablet -- sincronizacion`).
- [ ] **Step 5: Commit** `feat(tablet): subir el comentario de nota no cobrada`.

---

### Task 7: La ruta marca las asignadas, el recado y la visita

**Files:**
- Modify: `apps/tablet/src/datos/repositorios/rutas.ts` (`FilaRutaDelDia`, `delDia()` ~l.186-235)
- Modify: `apps/tablet/src/estado/ruta-del-dia.ts` (`agruparRuta`, y un helper de texto) + spec
- Modify: `apps/tablet/src/ui/lista-ruta.tsx`

**Interfaces:**
- `FilaRutaDelDia` gana `notas_asignadas: number` (asignadas de hoy con saldo y sin cobro de hoy del vendedor, misma regla que `porAtender`), `recado: string | null`, y `visitado`/`visita_sin_venta` cuentan también un `nota_no_cobrada` de hoy del cliente (decisión 17; atendido con venta gana).
- `ruta-del-dia.ts`: `textoMarcaAsignadas(n: number): string` → `"Nota asignada"` (1) / `"Notas asignadas · N"` (N > 1).
- `lista-ruta.tsx`: junto a la `Burbuja`, una marca con `textoMarcaAsignadas` cuando `notas_asignadas > 0` (color de acción, distinto de la burbuja); el recado en una línea bajo el nombre, truncado, con `accessibilityLabel` "Mensaje de la oficina: …".

- [ ] **Step 1: Pruebas que fallan** (spec de `rutas` y `ruta-del-dia`): conteo de asignadas; cliente con solo comentario sale visitado y en "Visitados sin venta"; con comentario y venta, atendido; recado baja a la fila; `textoMarcaAsignadas`.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5: Commit** `feat(tablet): la ruta marca notas asignadas, recado y comentario`.

---

### Task 8: Pantallas — ficha, nota, cobrar y venta

**Files:**
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx` (ficha)
- Create: `apps/tablet/app/(jornada)/operacion/[clienteId]/notas-asignadas.tsx` (la pantalla de la nota)
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/cobranza.tsx`
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx`

**Interfaces:**
- Consumes: Task 4 (`deHoyDelCliente`, `porAtender`, `bloqueoDeVenta`, `registrarNoCobrada`, `ETIQUETA_CONDICION`), Task 5 (`destinoAlVender`, `despuesDeContinuar`, `validarComentario`, guardia), Task 2 (`ruta.recado`, leído con la fila de ruta de hoy del cliente).
- **Ficha**: tarjeta "Mensaje de la oficina" con el recado (si hay), luego tarjeta "Notas asignadas por cobrar" (si `deHoyDelCliente` tiene alguna con saldo) con folio, fecha, saldo, días de atraso y `ETIQUETA_CONDICION`; si hay por atender, botones **Cobrar** (a `cobranza` con `params.notaId` = la primera por atender) y **Continuar sin cobrar** (a `notas-asignadas` sin `siguiente`). **Vender**: `destino` según `destinoAlVender(porAtender, false)`; si `bloqueoDeVenta` da motivo y no hay por atender, Vender deshabilitado con el motivo en su `descripcion`.
- **Pantalla de la nota** (`notas-asignadas.tsx`, params `clienteId`, `siguiente?`): lista las por atender; botón **Cobrar** (a `cobranza` con `notaId`) y **Continuar sin cobrar**, que abre el campo de comentario obligatorio (`validarComentario`, máx. 300, contador) y **Guardar**: `registrarNoCobrada` por cada nota por atender (un solo comentario para todas las de esa vez), luego `despuesDeContinuar`: a la venta (`router.replace`) o de regreso a la ficha mostrando el motivo.
- **Cobrar**: notas en dos grupos "Asignadas a ti" (con `ETIQUETA_CONDICION`) y "Otras notas del cliente"; si llega `notaId`, preseleccionada. El reparto y `registrar` no cambian.
- **Venta**: si `bloqueoDeVenta(clienteId)` da motivo, en lugar de la captura una `Tarjeta` "Nota por cobrar" con el motivo y el botón "Ir a cobrar" (patrón de la tarjeta "Carga por aceptar", `venta.tsx:~515`).

- [ ] **Step 1:** Implementar las cuatro pantallas sin lógica nueva (todo sale de Tasks 4–5).
- [ ] **Step 2:** `npm run typecheck --workspace=apps/tablet`, `npm test --workspace=apps/tablet`, `npm run export --workspace=apps/tablet` → limpios.
- [ ] **Step 3: Commit** `feat(tablet): pantallas de notas asignadas en ficha, cobro y venta`.

---

### Task 9: Documentación y verificación

**Files:**
- Modify: `CLAUDE.md` (bloque "Ruta semanal y Ruta diaria", viñeta de la condición: agregar la parte de la tablet)
- Modify: `apps/tablet/README.md` solo si lista migraciones locales

- [ ] **Step 1:** Viñeta: migración local 019 (tablas, `reparto_json`, borra el cursor del pull: la primera sincronización tras instalar es completa, sin `pm clear`); "cobro de hoy" por `cobranza.fecha` + `reparto_json`, nunca `abonos_json`; la nota sale al abrir la ficha y al picar Vender; Continuar sin cobrar pide comentario cada vez y la nota vuelve a salir; el bloqueo también en `ventas.registrar`; el servidor no rechaza la venta.
- [ ] **Step 2: Verificación**: `npm run typecheck --workspace=apps/tablet && npm test --workspace=apps/tablet && npm run export --workspace=apps/tablet` → limpios; `git diff --stat main...HEAD -- apps/backend apps/portal supabase` igual al del PR #158 (este PR no toca servidor).
- [ ] **Step 3: Commit** `docs: notas asignadas en la tablet en CLAUDE.md`.

# Notas asignadas: condición de venta y comentario de no cobro (servidor + portal) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La oficina asigna cada nota con una condición de venta, la condición baja en el pull, la tablet puede subir el comentario de "no cobré" y la oficina lo ve en la revisión de la tarde y en la pestaña Ruta.

**Architecture:** Una columna nueva en `nota_asignada` y una tabla nueva `nota_no_cobrada`. La condición entra por el `PUT` de notas de Ruta Diaria y viaja dentro de `asignadaA`. El comentario es una operación nueva del push (`nota-no-cobrada`) con el patrón de la visita: forma pura antes de la transacción (`despacho-nota-no-cobrada.ts`), proyección en `modules/rutas/`. Estadísticas solo lee.

**Tech Stack:** NestJS + Kysely + Postgres (Supabase local), pgTAP, Jest (unit + e2e); Next.js + Vitest + Testing Library en el portal.

**Spec:** `docs/superpowers/specs/2026-11-13-notas-asignadas-tablet-condicion-venta-design.md` (secciones 2, 3, 4, 5 y 7; la §6 es el PR 2 de la tablet).

## Global Constraints

- Migración `supabase/migrations/20261113120000_nota_asignada_condicion.sql`. Roberto tiene `20261112120000_corte_mercancia.sql` en su rama: no reusar ese timestamp.
- Condición: `'ninguna' | 'liquidar' | 'abonar'`, default `'ninguna'`. Textos del portal: "Puede vender", "Vender solo si liquida", "Vender solo si abona".
- Comentario: recortado, 1 a 300 caracteres.
- `CONTRATO_ACTUAL` sigue en 1. Todo cambio del contrato es aditivo y se documenta en `docs/contrato-sincronizacion.md` en el mismo commit que `contrato.ts`. **No** se toca `apps/tablet` en este PR.
- Tipo de operación nuevo: `'nota-no-cobrada'`. Código de rechazo nuevo: `'nota-no-cobrada-id-ocupado'`. Se reutiliza `'nota-no-encontrada'`.
- El `PUT /rutas/diaria/notas/:ventaNotaId` para el mismo vendedor sigue siendo no-op aunque traiga otra condición (spec decisión 14). Cambiar la condición = Quitar + Asignar.
- El comentario se acepta aunque la asignación ya no exista (spec decisión 13) y se cruza en la revisión por **nota y fecha**, no por vendedor (decisión 18).
- Después de `db push` a la nube va backend y portal juntos (el portal nuevo manda `condicionVenta`).
- Copia y tipos duplicados: `NotaDeRuta` en `apps/portal/src/lib/rutas.ts` y `NotaRevision` en `apps/portal/src/lib/flujo-diario.ts` son copias del backend; se cambian en el mismo commit que su original.

## Review Focus

1. **Comentario de una nota que la oficina ya pasó a otro vendedor**: debe entrar (`aplicada`) y verse en la revisión del vendedor nuevo con el nombre de quien lo escribió. Test en Task 4 (e2e) y Task 5 (e2e).
2. **Comentario de una nota de otra sucursal o de otro cliente que el del sobre**: `nota-no-encontrada`, sin fila en `nota_no_cobrada` ni en el buzón. Test en Task 4.
3. **Reenvío del mismo comentario** (misma clave): `duplicada`, una sola fila. Misma clave desde otro vendedor: `nota-no-cobrada-id-ocupado`. Test en Task 4.
4. **Pasar una nota con otra condición**: la asignación nueva lleva la condición elegida; la vieja queda dada de baja con la suya. `PUT` del mismo vendedor con otra condición no cambia nada. Test en Task 2.
5. **Pull incremental tras reasignar con otra condición**: la tablet recibe la baja de la vieja (`activo: 0`) y la nueva con su `condicion_venta`. Test en Task 3.

---

### Task 1: Migración, tipos de la base y pgTAP

**Files:**
- Create: `supabase/migrations/20261113120000_nota_asignada_condicion.sql`
- Create: `supabase/tests/99_nota_no_cobrada_test.sql`
- Modify: `apps/backend/src/database/schema.d.ts` (regenerado)

**Interfaces:**
- Produces: columna `nota_asignada.condicion_venta text not null default 'ninguna'` con check `ck_nota_asignada_condicion` en `('ninguna','liquidar','abonar')`; tabla `nota_no_cobrada` exactamente como la §3 de la spec (id uuid pk **sin** default, `venta_nota_id`, `vendedor_id`, `sucursal_id`, `fecha date`, `comentario` con check `ck_nota_no_cobrada_comentario` 1..300, `registrado_en timestamptz`, `created_at`/`updated_at`/`deleted_at`, trigger `trg_nota_no_cobrada_updated` con `set_updated_at()`, índices `idx_nota_no_cobrada_vendedor_fecha` e `idx_nota_no_cobrada_nota` parciales `where deleted_at is null`). Interfaces Kysely `NotaNoCobrada` y `NotaAsignada.condicion_venta: Generated<string>`.

- [ ] **Step 1: Escribir el pgTAP** `99_nota_no_cobrada_test.sql` con `plan(N)` y: `has_column('nota_asignada','condicion_venta')`; `col_default_is('nota_asignada','condicion_venta','ninguna'::text)`; `throws_ok` al insertar `condicion_venta = 'otra'` (23514); `has_table('nota_no_cobrada')`; `throws_ok` con comentario `''` y con 301 caracteres (23514); `lives_ok` con 300; `has_trigger('nota_no_cobrada','trg_nota_no_cobrada_updated')`. Sembrar dentro de la transacción lo mínimo (sucursal, cliente, vendedor, usuario, venta_nota) copiando el patrón de `supabase/tests/99_visita_test.sql`.
- [ ] **Step 2: Correrlo y ver que falla**

Run: `npm run supabase -- test db --local`
Expected: FAIL en `99_nota_no_cobrada_test.sql` (columna y tabla no existen).

- [ ] **Step 3: Escribir la migración** con cabecera de comentario: para qué (spec), pre-flight ("columna con default y tabla nueva; nada que contar"), y que `nota_no_cobrada` no tiene FK a `nota_asignada` a propósito (decisión 13).
- [ ] **Step 4: Aplicarla a la base local.** La local tiene `20261025120000` de T-27, ya en main, así que el CLI funciona:

Run: `npm run supabase -- migration up --local && npm run db:types --workspace=apps/backend`
Expected: aplica `20261113120000`; `git diff --stat apps/backend/src/database/schema.d.ts` muestra solo `NotaAsignada.condicion_venta`, la interfaz `NotaNoCobrada` y su entrada en `DB`.

- [ ] **Step 5: pgTAP en verde**

Run: `npm run supabase -- test db --local`
Expected: PASS, todos los archivos.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261113120000_nota_asignada_condicion.sql supabase/tests/99_nota_no_cobrada_test.sql apps/backend/src/database/schema.d.ts
git commit -m "feat(db): condición de venta en nota_asignada y tabla nota_no_cobrada"
```

---

### Task 2: Asignar con condición (backend de Ruta Diaria)

**Files:**
- Modify: `apps/backend/src/modules/rutas/dto/nota-asignada.dto.ts` (`AsignarNotaDto`)
- Modify: `apps/backend/src/modules/rutas/reglas-notas-ruta.ts` (tipos)
- Modify: `apps/backend/src/modules/rutas/notas-asignadas.repository.ts` (`asignar`, `asignacionesDe`)
- Modify: `apps/backend/src/modules/rutas/notas-asignadas.service.ts:59` (`asignar`)
- Modify: `apps/backend/src/modules/rutas/notas-asignadas.controller.ts:35-48`
- Test: `apps/backend/test/notas-asignadas.e2e-spec.ts`

**Interfaces:**
- Produces (en `reglas-notas-ruta.ts`):
  ```ts
  export const CONDICIONES_VENTA = ['ninguna', 'liquidar', 'abonar'] as const;
  export type CondicionVenta = (typeof CONDICIONES_VENTA)[number];
  // NotaDeRuta.asignadaA pasa a:
  asignadaA: { vendedorId: string; nombre: string; condicionVenta: CondicionVenta } | null;
  ```
  La condición vive dentro de `asignadaA` (es de quien la trae), en vez del `NotaDeRuta.condicionVenta` suelto que sugiere la spec: misma información, sin un campo que pueda contradecir a `asignadaA === null`.
- `AsignarNotaDto.condicionVenta?: CondicionVenta` con `@IsOptional() @IsIn(CONDICIONES_VENTA, { message: 'La condición de venta no es válida.' })`.
- `NotasAsignadasService.asignar(usuarioId, ventaNotaId, vendedorId, fecha, condicionVenta: CondicionVenta = 'ninguna')`.
- `NotasAsignadasRepository.asignar(datos: { ventaNotaId; vendedorId; fecha; usuarioId; condicionVenta: CondicionVenta }, trx)`.

- [ ] **Step 1: Escribir los e2e** en `notas-asignadas.e2e-spec.ts`, junto a los de asignar/pasar, reutilizando su siembra:
  - `asignar sin condicionVenta guarda 'ninguna' y la respuesta trae asignadaA.condicionVenta = 'ninguna'`.
  - `asignar con condicionVenta 'liquidar' la guarda` (leer `nota_asignada.condicion_venta` de la base = `'liquidar'`; `respuesta.asignadas[0].asignadaA.condicionVenta === 'liquidar'`).
  - `condicionVenta 'otra' es 400 con 'La condición de venta no es válida.'` y no deja fila.
  - `el mismo vendedor con otra condición no cambia nada`: asignar `'abonar'`, luego `PUT` mismo vendedor con `'liquidar'` → 200, en la base sigue **una** fila viva con `'abonar'` y su `updated_at` no cambió.
  - `pasar a otro vendedor con 'abonar'`: A tiene la nota con `'liquidar'`; `PUT` para B con `'abonar'` → la de A dada de baja conservando `'liquidar'`, la de B viva con `'abonar'`.
- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npm run test:e2e --workspace=apps/backend -- notas-asignadas`
Expected: FAIL (`condicionVenta` no existe en la respuesta; el 400 no ocurre porque el `ValidationPipe` rechaza la propiedad desconocida con otro mensaje o la ignora).

- [ ] **Step 3: Implementar** tipos, DTO, repositorio (`asignar` inserta `condicion_venta`; `asignacionesDe` selecciona `na.condicion_venta` y la mapea a `condicionVenta`), servicio (pasa la condición a `repo.asignar`; la rama `actual?.vendedorId === vendedor.id` sigue regresando sin escribir) y controlador (`dto.condicionVenta`).
- [ ] **Step 4: Unitarias y e2e en verde**

Run: `npm test --workspace=apps/backend -- rutas && npm run test:e2e --workspace=apps/backend -- notas-asignadas rutas-diarias`
Expected: PASS. Si `reglas-notas-ruta.spec.ts` arma `asignadaA` a mano, agregarle `condicionVenta: 'ninguna'`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/rutas apps/backend/test/notas-asignadas.e2e-spec.ts
git commit -m "feat(rutas): asignar una nota con condición de venta"
```

---

### Task 3: La condición baja en el pull

**Files:**
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts:913` (`NotaAsignadaPull`)
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts:603-640` (`notasAsignadas`)
- Modify: `docs/contrato-sincronizacion.md` (colección `notas_asignadas`)
- Test: el e2e del pull que ya cubre `notas_asignadas` (buscar con `grep -ln notas_asignadas apps/backend/test`); si no hay, en `notas-asignadas.e2e-spec.ts`

**Interfaces:**
- Consumes: `CondicionVenta` (Task 2).
- Produces: `NotaAsignadaPull.condicion_venta: 'ninguna' | 'liquidar' | 'abonar'` (literal en el contrato, sin importar de `rutas/`: el contrato no depende del dominio).

- [ ] **Step 1: Escribir los e2e**:
  - `pull completo trae condicion_venta de cada asignación` (asignar con `'liquidar'` → `notas_asignadas[0].condicion_venta === 'liquidar'`).
  - `pull incremental tras pasar con otra condición` (Review Focus 5): el vendedor A hace pull, la oficina quita y vuelve a asignar a A con `'abonar'`; el pull incremental de A trae la vieja con `activo: 0` y la nueva con `activo: 1, condicion_venta: 'abonar'`.
- [ ] **Step 2: Correr y ver que fallan** (`condicion_venta` undefined).
- [ ] **Step 3: Implementar**: agregar `'na.condicion_venta'` al `select` y al mapeo; tipo en `contrato.ts` con su comentario ("Spec 2026-11-13: lo que la oficina pide para venderle. Aditivo."); en el doc, la fila del campo y una línea: "la tablet decide el bloqueo; el servidor no rechaza la venta".
- [ ] **Step 4: Correr** `npm run test:e2e --workspace=apps/backend -- <archivo>` → PASS.
- [ ] **Step 5: Commit** `feat(sync): condicion_venta en notas_asignadas del pull`.

---

### Task 4: Operación `nota-no-cobrada` en el push

**Files:**
- Create: `apps/backend/src/modules/rutas/datos-nota-no-cobrada.ts` (+ `.spec.ts`)
- Create: `apps/backend/src/modules/rutas/nota-no-cobrada-rechazada.ts`
- Create: `apps/backend/src/modules/rutas/notas-no-cobradas.repository.ts`
- Create: `apps/backend/src/modules/rutas/notas-no-cobradas.service.ts` (+ `.spec.ts`)
- Create: `apps/backend/src/modules/sincronizacion/despacho-nota-no-cobrada.ts` (+ `.spec.ts`)
- Modify: `apps/backend/src/modules/rutas/rutas.module.ts` (provider + export)
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts` (`TIPOS_OPERACION`, `DatosNotaNoCobrada`, `CODIGOS_RECHAZO`, comentario de la lista de tipos)
- Modify: `apps/backend/src/modules/sincronizacion/despacho.ts` (`Proyeccion`, `prepararProyeccion`)
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts` (constructor, `catch` de `aplicar`, `proyectar`)
- Modify: `docs/contrato-sincronizacion.md` (tipo en la lista del sobre, sección "`datos` de una nota no cobrada", código en la tabla de rechazos, tipos con módulo en §7, orden del push con `notas-no-cobradas` después de `cobranzas`)
- Test: `apps/backend/test/nota-no-cobrada.e2e-spec.ts` (nuevo; copiar arranque y siembra de `visita.e2e-spec.ts`)

**Interfaces:**
- `contrato.ts`:
  ```ts
  export type DatosNotaNoCobrada = {
    venta_nota_id: string;
    /** 1..300 tras recortar. */
    comentario: string;
    /** Instante ISO-8601 con zona en que el vendedor lo guardo. */
    registrado_en: string;
  };
  ```
- `datos-nota-no-cobrada.ts`: `export interface NotaNoCobradaNormalizada { ventaNotaId: string; comentario: string; registradoEn: string }` y `export function normalizarDatosNotaNoCobrada(datos: unknown): { ok: true; nota: NotaNoCobradaNormalizada } | { ok: false; motivo: string }`. Reusar `RE_UUID` de `datos-visita.ts` y la validación de instante con zona que usa `normalizarDatosVisita` para `visitada_en`. Motivos con el nombre del campo: `venta_nota_id: …`, `comentario: …`, `registrado_en: …`. `ventaNotaId` en minúsculas.
- `nota-no-cobrada-rechazada.ts`: `type RazonRechazoNotaNoCobrada = 'nota-no-encontrada' | 'nota-no-cobrada-id-ocupado'` y `class NotaNoCobradaRechazada extends Error { razon }`, copia de `visita-rechazada.ts`.
- `despacho-nota-no-cobrada.ts`: `prepararNotaNoCobrada(op: OperacionNormalizada): { ok: true; nota: NotaNoCobradaNormalizada; clienteId: string } | ({ ok: false } & Rechazo)` (folio presente, `cliente_id` ausente o clave no uuid → `datos-invalidos`, mismo orden y estilo que `prepararVisita`) y `CODIGO_POR_RAZON_NOTA_NO_COBRADA: Record<RazonRechazoNotaNoCobrada, CodigoRechazo>`.
- `despacho.ts`: variante `{ tipo: 'nota-no-cobrada'; nota: NotaNoCobradaNormalizada; clienteId: string }`.
- `NotasNoCobradasService.registrar(nota: NotaNoCobradaNormalizada, ctx: { id: string; sucursalId: string; vendedorId: string; clienteId: string; fechaOperacion: string }, trx: Transaction<DB>): Promise<{ tabla: 'nota_no_cobrada'; id: string }>`.
  - Lee la nota con `NotasNoCobradasRepository.notaDe(ventaNotaId, trx): Promise<{ clienteId: string; clienteSucursalId: string } | undefined>` (**sin** filtrar `deleted_at`: una venta borrada después del comentario se acepta, spec §4). Si no existe, su cliente no es `ctx.clienteId` o su sucursal no es `ctx.sucursalId` → `NotaNoCobradaRechazada('nota-no-encontrada')`, con el mismo motivo neutro para los tres casos.
  - `NotasNoCobradasRepository.insertar(fila, trx): Promise<boolean>` con `on conflict (id) do nothing`; `false` → `NotaNoCobradaRechazada('nota-no-cobrada-id-ocupado')`.
  - **No** consulta `nota_asignada` (decisión 13).
- `sincronizacion.service.ts`: `case 'nota-no-cobrada'` en `proyectar` pasando `id: op.clave`, sucursal y vendedor del token, `clienteId: proyeccion.clienteId`, `fechaOperacion: op.fechaOperacion`; `instanceof NotaNoCobradaRechazada` en el `catch` como la visita.

- [ ] **Step 1: Unitarias puras que fallan**: `datos-nota-no-cobrada.spec.ts` (comentario recortado; `'   '` → motivo `comentario:`; 300 entra, 301 no; `venta_nota_id` no uuid; `registrado_en` sin zona; `datos` no objeto) y `despacho-nota-no-cobrada.spec.ts` (con folio, sin `cliente_id`, clave no uuid → `datos-invalidos` con motivo que empieza con `folio:`, `cliente_id:`, `clave:`; válida → `ok: true` y `clienteId` del sobre).
- [ ] **Step 2: Correr** `npm test --workspace=apps/backend -- nota-no-cobrada` → FAIL (módulos no existen).
- [ ] **Step 3: Implementar** `datos-nota-no-cobrada.ts`, `nota-no-cobrada-rechazada.ts`, `despacho-nota-no-cobrada.ts` y el contrato. Correr de nuevo → PASS.
- [ ] **Step 4: Unitaria del servicio que falla** `notas-no-cobradas.service.spec.ts` con repo falso: nota inexistente, de otro cliente y de otra sucursal → `nota-no-encontrada`; `insertar` → `false` → `nota-no-cobrada-id-ocupado`; caso feliz inserta `{ id, venta_nota_id, vendedor_id, sucursal_id, fecha: fechaOperacion, comentario, registrado_en }` y regresa `{ tabla: 'nota_no_cobrada', id }`.
- [ ] **Step 5: Implementar** repositorio, servicio, módulo y el cableado en `despacho.ts` y `sincronizacion.service.ts`. `npm test --workspace=apps/backend` → PASS, `npm run build --workspace=apps/backend` limpio (el `switch` exhaustivo de `prepararProyeccion` y `proyectar` obliga a los dos `case`).
- [ ] **Step 6: e2e que fallan** en `nota-no-cobrada.e2e-spec.ts`, por `POST /sync/push`:
  - `un comentario entra con la clave como id y la fecha del sobre` (estado `aplicada`; fila en `nota_no_cobrada` con `comentario` recortado y `fecha = fecha_operacion`; buzón con `entidad_tabla = 'nota_no_cobrada'`).
  - `entra aunque la nota no esté asignada o se la hayan pasado a otro` (Review Focus 1: sin `nota_asignada`, y con la asignación pasada a otro vendedor).
  - `nota de otra sucursal o de otro cliente que el del sobre es nota-no-encontrada y no deja fila` (Review Focus 2; la de otra sucursal cae antes como `cliente-fuera-de-alcance` si el cliente es de otra sucursal: probar ese código cuando el cliente del sobre es ajeno, y `nota-no-encontrada` cuando el cliente es propio pero la nota es de otro cliente).
  - `reenviar la misma clave es duplicada; la misma clave de otro vendedor es nota-no-cobrada-id-ocupado` (Review Focus 3).
  - `comentario vacío es datos-invalidos`.
- [ ] **Step 7: Correr** `npm run test:e2e --workspace=apps/backend -- nota-no-cobrada visita` → PASS.
- [ ] **Step 8: Commit** `feat(sync): operación nota-no-cobrada (comentario del vendedor)` con el doc del contrato en el mismo commit.

---

### Task 5: La oficina ve el comentario y la condición (estadísticas)

**Files:**
- Modify: `apps/backend/src/modules/estadisticas/reglas-detalle.ts` (`NotaRevision`, filas, `armarDetalleVendedor`)
- Modify: `apps/backend/src/modules/estadisticas/detalle.repository.ts` (`asignadas()`, `filas()`, query nueva `notasNoCobradas()`)
- Test: `apps/backend/src/modules/estadisticas/reglas-detalle.spec.ts`, `apps/backend/test/dashboard.e2e-spec.ts` (o el e2e que ya prueba `asignadasPorEntregar`: `grep -ln asignadasPorEntregar apps/backend/test`)

**Interfaces:**
- Consumes: `CondicionVenta` (Task 2), tabla `nota_no_cobrada` (Task 1).
- Produces:
  ```ts
  // NotaRevision gana (null en las notas nuevas a crédito):
  condicionVenta: CondicionVenta | null;
  comentarioVendedor: { texto: string; vendedor: string } | null;
  // FilasDetalle gana:
  notasNoCobradas: NotaNoCobradaFila[];
  export interface NotaNoCobradaFila { clienteId: string; cliente: string; folio: string; hora: string; comentario: string; }
  ```
- `asignadas()` agrega `na.condicion_venta` y un `left join lateral` al último `nota_no_cobrada` vivo con `venta_nota_id = vn.id and fecha = ${fecha}`, de **cualquier** vendedor, ordenado por `registrado_en desc`, con `vendedor.nombre`.
- `notasNoCobradas(vendedorId, fecha)`: las vivas de ese vendedor y día con cliente y folio; `hora` con el mismo `iso(...)` de `registrado_en` que usa `visitas()`. Solo en el alcance por vendedor (como `ruta` y `asignadas`); por sucursal, `[]`.
- En `armarDetalleVendedor`, cada `NotaNoCobradaFila` entra a `atendidos` como `{ visitado: true, vendio: false, hora, motivo: \`Nota sin cobrar · ${folio}\`, atendio: null, comentario }` (decisión 17). **No** se agrega a `visitasSinVenta` ni a ningún conteo.

- [ ] **Step 1: Unitarias que fallan** en `reglas-detalle.spec.ts`:
  - `un cliente de la ruta con nota no cobrada sale visitado con 'Nota sin cobrar · <folio>' y el comentario, no 'Cliente no visitado'`.
  - `si además le vendió, sale la venta y la nota no cobrada, en orden de hora` (mismo trato que una visita).
  - `la nota no cobrada no suma a visitas sin venta` (el conteo o lista que hoy deriva de `visitasSinVenta` no cambia).
  - `asignadasPorEntregar conserva condicionVenta y comentarioVendedor de la fila`.
- [ ] **Step 2: Correr** `npm test --workspace=apps/backend -- reglas-detalle` → FAIL.
- [ ] **Step 3: Implementar** tipos y `armarDetalleVendedor`; las notas nuevas a crédito llevan `condicionVenta: null, comentarioVendedor: null`. Unitarias → PASS.
- [ ] **Step 4: e2e que fallan** en el archivo de la revisión:
  - `la revisión muestra la condición y el último comentario de la asignada` (dos comentarios del mismo vendedor → sale el más reciente por `registrado_en`).
  - `el comentario de A se ve en la revisión de B después de pasarle la nota, con el nombre de A` (Review Focus 1).
  - `la pestaña Ruta muestra 'Nota sin cobrar · <folio>' para el cliente comentado`.
- [ ] **Step 5: Implementar** las consultas; e2e → PASS. Correr también `npm run test:e2e --workspace=apps/backend -- dashboard flujo-diario` para ver que nada más cambió.
- [ ] **Step 6: Commit** `feat(estadisticas): condición y comentario de no cobro en la revisión y la ruta`.

---

### Task 6: Portal — condición en la ventana de notas

**Files:**
- Modify: `apps/portal/src/lib/rutas.ts:215-256`
- Modify: `apps/portal/src/components/rutas/ventana-notas.tsx`
- Test: `apps/portal/src/components/rutas/ventana-notas.test.tsx`, y `lib/rutas` si tiene prueba

**Interfaces:**
- Consumes: el contrato HTTP de Task 2.
- Produces (`lib/rutas.ts`):
  ```ts
  export type CondicionVenta = "ninguna" | "liquidar" | "abonar";
  export const TEXTO_CONDICION: Record<CondicionVenta, string> = {
    ninguna: "Puede vender",
    liquidar: "Vender solo si liquida",
    abonar: "Vender solo si abona",
  };
  // NotaDeRuta.asignadaA gana condicionVenta: CondicionVenta
  export function asignarNota(ventaNotaId: string, vendedorId: string, fecha: string, condicionVenta: CondicionVenta): Promise<NotasDeRuta>;
  ```
- Ventana: columna **"Condición"** entre "Días de atraso" y "Acción" (`<col className="w-[190px]" />`; colgroup de 7; `FilaVacia columnas={7}`). Medir a 1366 px: la ventana es `ancho="detalle"`; si la tabla se desborda, bajar "Acción" de 240 a 200 px.
  - Editable, sin asignar: `Lista` (de `components/ui/campo.tsx`) con las tres opciones, valor inicial `"ninguna"`, estado por nota en un `Record<ventaNotaId, CondicionVenta>`; botón "Asignar" manda la elegida.
  - Editable, asignada a este vendedor: texto `TEXTO_CONDICION[...]`; botón "Quitar" como hoy.
  - Editable, de otro vendedor: "La trae X" en la celda de Acción como hoy; en la de Condición, `Lista` que arranca con la condición que tenía; "Pasársela" manda la de la `Lista`.
  - Solo lectura: texto de la condición si está asignada; vacío si no.
  - Cada `Lista` lleva `aria-label={\`Condición de la nota ${folio}\`}`.

- [ ] **Step 1: Pruebas que fallan** en `ventana-notas.test.tsx` (ver cómo ya simula `asignarNota`/`quitarNota`):
  - `asignar manda la condición elegida` (elegir "Vender solo si liquida" → `asignarNota` llamado con `"liquidar"`).
  - `sin tocar la lista asigna con 'ninguna'`.
  - `una asignada a este vendedor muestra su condición como texto y no tiene lista`.
  - `pasársela manda la condición de la lista, que arranca con la que tenía`.
  - `en solo lectura la condición es texto`.
- [ ] **Step 2: Correr** `NODE_OPTIONS=--no-experimental-webstorage npm test --workspace=apps/portal -- ventana-notas` → FAIL.
- [ ] **Step 3: Implementar** `lib/rutas.ts` y la ventana.
- [ ] **Step 4: Correr** las pruebas del portal completas, `npx tsc --noEmit` y `npm run lint` en `apps/portal` → todo limpio. Arreglar los demás `asignadaA` de pruebas que no compilen sin `condicionVenta`.
- [ ] **Step 5: Commit** `feat(portal): condición de venta al asignar una nota`.

---

### Task 7: Portal — condición y comentario en la revisión de la tarde

**Files:**
- Modify: `apps/portal/src/lib/flujo-diario.ts:194` (`NotaRevision`)
- Modify: `apps/portal/src/components/flujo-diario/detalle-vendedor-pestanas.tsx` (`TablaRevision`)
- Test: el `.test.tsx` de `detalle-vendedor-pestanas` o de `PestanaNotas` (`grep -ln TITULO_ASIGNADAS_POR_ENTREGAR\|Asignadas NO cobradas apps/portal/src`)

**Interfaces:**
- Consumes: `NotaRevision` de Task 5 (copia exacta) y `TEXTO_CONDICION`/`CondicionVenta` de Task 6 (importar de `lib/rutas`).
- `TablaRevision`: sin columnas nuevas (las cuatro tablas comparten `ColumnasRevision`). En la celda **Cliente**, si `comentarioVendedor`, una segunda línea `text-xs text-muted-foreground`: `"{vendedor}: {texto}"` con `title` del texto completo y `line-clamp-2`. En la celda **Folio**, si `condicionVenta` y no es `"ninguna"`, una `Etiqueta` corta debajo: "Solo si liquida" / "Solo si abona".

- [ ] **Step 1: Pruebas que fallan**: en "Notas Asignadas NO cobradas por Entregar" se ve `"Juan: no estaba el encargado"` y `"Solo si liquida"`; una nota nueva a crédito (`condicionVenta: null, comentarioVendedor: null`) no muestra ninguna de las dos.
- [ ] **Step 2: Correr** → FAIL.
- [ ] **Step 3: Implementar**; actualizar los fixtures de `NotaRevision` en pruebas existentes con los dos campos en `null`.
- [ ] **Step 4: Portal completo** (pruebas, `tsc`, `lint`) → limpio. Revisar en el navegador a 1366 px con datos locales: una asignada con condición y comentario en el detalle del Flujo diario.
- [ ] **Step 5: Commit** `feat(portal): condición y comentario del vendedor en la revisión de notas`.

---

### Task 8: Documentación y verificación de la rama

**Files:**
- Modify: `CLAUDE.md` (bloque "Ruta semanal y Ruta diaria", viñeta nueva "Condición de venta y comentario de no cobro (2026-11-13)")
- Modify: vault `../../Obsidian Memory` solo si Mario lo pide en la revisión del PR (el vault no está en esta rama).

- [ ] **Step 1: CLAUDE.md**: una viñeta de 6–10 líneas: columna y tabla nuevas; condición dentro de `asignadaA`; cambiar = quitar y asignar (el `PUT` del mismo vendedor no edita); operación `nota-no-cobrada` sin folio, `cliente_id` en el sobre, clave = id, aceptada aunque la asignación ya no exista, rechazos `nota-no-encontrada` y `nota-no-cobrada-id-ocupado`; el servidor **no** rechaza la venta (lo hace la tablet, PR 2); revisión y pestaña Ruta la leen por nota y fecha; nube con el protocolo (pre-flight: nada que contar), backend y portal juntos.
- [ ] **Step 2: Verificación completa**

Run:
```bash
npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend && npm test --workspace=apps/backend && npm run test:e2e --workspace=apps/backend
npm run supabase -- test db --local
cd apps/portal && NODE_OPTIONS=--no-experimental-webstorage npm test && npx tsc --noEmit && npm run lint
npm run db:types --workspace=apps/backend && git diff --exit-code apps/backend/src/database/schema.d.ts
```
Expected: todo en verde; `schema.d.ts` sin cambios.

- [ ] **Step 3: Commit** `docs: condición de venta y comentario de no cobro en CLAUDE.md`.

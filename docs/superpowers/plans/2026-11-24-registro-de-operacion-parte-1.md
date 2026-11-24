# Registro de Operación, parte 1 — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** *Producción → Registro de Operación* con pestañas Entradas/Compras · Envíos · Merma · Consumo · Descuentos, el
catálogo de motivos de merma, y el retiro de "Producción del día".

**Architecture:** Una migración crea `operacion_almacen` + `operacion_almacen_linea` + `motivo_merma`, permisos y semilla,
y copia `produccion`. Backend en `apps/backend/src/modules/produccion/` (`operaciones-almacen.*`, `motivos-merma.*`,
reglas puras en `reglas-operacion.ts`). Portal: `lib/operaciones-almacen.ts`, `lib/motivos-merma.ts`,
`components/registro-operacion/`, catálogo en `/catalogo/motivos-de-merma`.

**Tech Stack:** Postgres/Supabase (migración + pgTAP), NestJS + Kysely + Jest, Next.js + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-registro-de-operacion-parte-1-design.md`

## Global Constraints

- Migración `supabase/migrations/20261124120000_registro_operacion.sql` (versión única; revisada contra las ramas abiertas).
- Tipos de operación: `entrada`, `envio`, `merma`, `consumo`, `descuento` (el check deja fácil agregar `retiro_merma` en la parte 2). Checks por tipo: `origen` (`produccion|compra`) solo y obligatorio en entrada; `sucursal_destino_id` solo y obligatorio en envío y ≠ `sucursal_id`; `motivo_merma_id` solo y obligatorio en merma; `trabajador` (1..120, recortado) solo y obligatorio en descuento.
- Líneas: piezas enteras 1..100000, máximo 200 por operación, una por presentación, al menos una.
- Fechas (Tijuana, del reloj de Postgres como el corte): entrada/merma/consumo/descuento ≤ hoy; envío = hoy o ayer. La regla vale para crear, editar y dar de baja.
- Permisos nuevos: `operacion.entrada`, `operacion.envio`, `operacion.merma`, `operacion.consumo`, `operacion.descuento` (grupo `Produccion/Almacen`), `motivo_merma.gestionar` (grupo `General`). El permiso del tipo se exige en el servicio consultando `PermisosRepository.permisosDe` (no se duplica la resolución).
- Alcance de sucursal como el corte: atado solo la suya; ajena al listar = 403, operación de otra sucursal = 404; "todas" = 400 "Elige una sucursal.".
- Envíos con destino X aparecen en `GET ?tipo=entrada&sucursal=X` con `envio: { origen: {id, codigo} }`, solo lectura ahí.
- Motivos: semilla "Producto dañado / mal estado", "Caducado por fecha", "Merma general antes de caducidad", "Lote en mal estado", con `aplica_almacen`, `aplica_cliente`, `aplica_vehiculo` en true.
- Textos en español; piezas de `components/ui/`; `useConfirmar` para bajas; cabe a 1366 px. Tipos duplicados backend ↔ portal en el mismo commit.
- Roberto tiene backend (3010) y portal (3001) prendidos: **no apagar ni reiniciar; no correr `npm run build`** (los tumba). Tipos del backend con `npx tsc --noEmit -p apps/backend/tsconfig.json`.

## Review Focus

1. **Envío a la sucursal destino:** un usuario atado a MX con `operacion.entrada` lo ve en Entradas de MX aunque no alcance TJ, y no lo puede editar ni borrar. → e2e Tarea 3.
2. **Permiso por tipo:** con solo `operacion.consumo`, crear/editar/listar una entrada da 403. → e2e Tarea 3.
3. **Envío de antier:** editar o dar de baja da 400. → e2e Tarea 3.
4. **Motivo dado de baja o sin "almacén":** no se acepta en una merma nueva; una merma existente lo conserva al editar si no se cambia. → e2e Tarea 3.
5. **Copia de `produccion`:** dos presentaciones del mismo día y sucursal quedan en UNA operación entrada con dos líneas; filas borradas no se copian. → pgTAP Tarea 1.

---

### Tarea 1: Migración y pgTAP

**Files:** Create `supabase/migrations/20261124120000_registro_operacion.sql`, `supabase/tests/99_registro_operacion_test.sql`; Modify `apps/backend/src/database/schema.d.ts` (con `npm run db:types --workspace=apps/backend`).

**Interfaces — Produces:** tablas `motivo_merma` (`id`, `nombre`, `aplica_almacen`, `aplica_cliente`, `aplica_vehiculo`, `creado_en`, `actualizado_en`, `deleted_at`; único vivo `lower(btrim(nombre))`; trigger `set_actualizado_en()`), `operacion_almacen` (columnas del spec D2 + `created_at`/`updated_at` con `set_updated_at()`), `operacion_almacen_linea` (`id`, `operacion_id`, `presentacion_id`, `piezas`); permisos; semilla; copia de `produccion` (D12); copia de grants de `almacen_general.gestionar` a `operacion.entrada` en `perfil_permiso` y `usuario_permiso` (D11).

- [ ] **Paso 1:** pgTAP que falla: checks por tipo (cada combinación inválida rechazada), destino = origen rechazado, piezas 0 y 100001 rechazadas, línea duplicada rechazada, motivo con nombre repetido vivo rechazado y libre tras baja, semilla de 4 motivos, permisos presentes, y la copia de `produccion` (Review Focus 5: inserta filas de `produccion` ANTES de aplicar… — como la copia corre en la migración, prueba su resultado con una función o vista auxiliar si hace falta; si no es práctico en pgTAP, cúbrelo con un e2e del backend que ejecute el mismo SQL de copia sobre datos sembrados y déjalo anotado).
- [ ] **Paso 2:** aplicar en local `npm run supabase -- migration up --local`; correr pgTAP (`npm run supabase -- test db`) → los nuevos pasan; los viejos siguen pasando.
- [ ] **Paso 3:** `npm run db:types --workspace=apps/backend` y revisar el diff de `schema.d.ts`.
- [ ] **Paso 4: Commit** `Registro de Operación: migración (operaciones de almacén, motivos de merma, permisos)`.

### Tarea 2: Motivos de merma (backend)

**Files:** Create `apps/backend/src/modules/produccion/motivos-merma.{controller,service,repository}.ts` (+ dto, spec); Modify `produccion.module.ts`; Test `apps/backend/test/motivos-merma.e2e-spec.ts`. Modelo a seguir: `apps/backend/src/modules/rutas/motivos-visita.*`.

**Interfaces — Produces:** `GET /motivos-merma` (cualquier sesión del portal; `?aplica=almacen` filtra vivos con esa casilla), `POST`, `PATCH /:id`, `DELETE /:id` con `motivo_merma.gestionar`. `MotivoMerma { id, nombre, aplicaAlmacen, aplicaCliente, aplicaVehiculo, activo }` (`activo` = no dado de baja). Al menos una casilla prendida (400).

- [ ] Pruebas e2e que fallan (alta, nombre repetido 409, edición, baja, filtro `aplica=almacen`, sin permiso 403, sin casillas 400) → implementar → pasan; `npm test`, lint (lleva `--fix`, revisa que no toque ajenos). **Commit** `Motivos de merma: catálogo en el backend`.

### Tarea 3: Operaciones de almacén (backend)

**Files:** Create `apps/backend/src/modules/produccion/reglas-operacion.ts` (+ spec), `operaciones-almacen.{controller,service,repository}.ts`, `dto/operacion-almacen.dto.ts`; Modify `produccion.module.ts`; quitar `produccion.controller.ts`/`produccion.service.ts`/`produccion.repository.ts`/`reglas-produccion.ts` y sus pruebas **si nada más los usa** (si el corte reusa algo de `reglas-produccion.ts`, muévelo a un archivo común y conserva el comportamiento); Test `apps/backend/test/operaciones-almacen.e2e-spec.ts`.

**Interfaces — Produces:**
- `OperacionAlmacen { id, tipo, sucursal: {id, codigo}, fecha, origen: 'produccion'|'compra'|null, destino: {id, codigo}|null, motivo: {id, nombre}|null, trabajador: string|null, comentario: string|null, lineas: {presentacionId, nombre, producto, volumen, piezas}[], piezas: number, capturo: string, hora: string /* HH24:MI Tijuana de created_at */, editable: boolean, envio: { origen: {id, codigo} } | null }`.
- `GET /operaciones-almacen?sucursal&fecha&tipo` → `{ fecha, hoy, operaciones: OperacionAlmacen[] }` (entrada incluye envíos con destino, D14); `GET /:id`; `POST` (`{ tipo, sucursal, fecha, origen?, destino?, motivoId?, trabajador?, comentario?, lineas }`); `PUT /:id` (mismo cuerpo sin `tipo` ni `sucursal`); `DELETE /:id`.
- `reglas-operacion.ts`: `fechaPermitida(tipo, fecha, hoy): boolean`, `validarOperacion(entrada, hoy): string[]` (mensajes en español), `planLineas(vivas, pedidas)`.

- [ ] Unit de reglas que fallan → implementar → pasan. e2e que fallan cubriendo los 5 tipos (alta, edición, baja), los 5 puntos del Review Focus 1–4, alcance (403/404/"todas"), topes (200 líneas, 100000), presentación inexistente, que `/produccion` ya responde 404 → implementar (el permiso por tipo con `PermisosRepository.permisosDe`; el candado de una edición sobre la fila de la operación `for update`) → pasan. `npm test`, e2e de `operaciones-almacen` y de `cortes`, lint. **Commit** `Registro de Operación: operaciones de almacén en el backend`.

### Tarea 4: Portal — tipos, catálogo de motivos y quitar Producción del día

**Files:** Create `apps/portal/src/lib/operaciones-almacen.ts`, `apps/portal/src/lib/motivos-merma.ts` (+ tests), `apps/portal/src/app/(portal)/catalogo/motivos-de-merma/page.tsx` y su componente (modelo: Motivos de visita con `PantallaCatalogo`); Modify `nav-config.ts` (+ test): Catálogo agrega "Motivos de merma"; Producción queda Recarga · Corte · Registro de Operación · Almacenes (pronto) — se quitan "Peticiones" y "Producción del día"; `/produccion/produccion-del-dia/page.tsx` pasa a redirigir a `/produccion/registro-operacion?pestana=entrada` conservando `sucursal`; borrar la pantalla vieja (`pantalla-produccion-dia.*`) y la página de Peticiones de Producción.

**Interfaces — Produces:** tipos copiados de Tareas 2 y 3; `listarOperaciones`, `crearOperacion`, `editarOperacion`, `eliminarOperacion`, `listarMotivosMerma(aplica?)`; `TIPOS_OPERACION` con su etiqueta ("Entradas/Compras", "Envíos", "Merma", "Consumo", "Descuentos") y su permiso.

- [ ] Pruebas que fallan → implementar → pasan; `npm test --workspace=apps/portal`, lint, `npx tsc --noEmit -p apps/portal`. **Commit** `Portal: motivos de merma y tipos del Registro de Operación`.

### Tarea 5: Portal — pantalla Registro de Operación

**Files:** Create `apps/portal/src/components/registro-operacion/` (pantalla con pestañas, lista por tipo, captura en pantalla completa con rejilla de productos por tamaño) + pruebas; `apps/portal/src/app/(portal)/produccion/registro-operacion/page.tsx`.

**Interfaces — Consumes:** Tarea 4. `useAuth` para saber los permisos: solo salen las pestañas con permiso; la pestaña inicial sale de `?pestana=` si la tiene.

- [ ] Pruebas que fallan: pestañas según permisos; lista del día con hora, quién, piezas y el dato del tipo (origen / destino / motivo / trabajador); renglón "Envío desde TJ" en Entradas sin Editar/Eliminar; fecha con Hoy · Ayer (Envíos no ofrece días anteriores a ayer); "Registrar …" abre la captura con todos los productos activos por tamaño, TAB pasa de un campo de piezas al siguiente, vacío = sin línea, guardar sin líneas deshabilitado; campos por tipo (Producción/Compra; sucursal destino sin la propia; motivo de los de almacén; trabajador obligatorio; comentario opcional); editar precarga; eliminar con `useConfirmar`; "Elige una sucursal" con todas. → implementar → pasan; suite, lint, tsc. **Commit** `Portal: Producción → Registro de Operación`.

### Tarea 6: Navegador y documentación

- [ ] Con los servidores de Roberto (reusar; no apagar ni compilar), revisar a 1366 y 1920 px cada pestaña (capturar, editar, borrar), un envío TJ→MX visto en Entradas de MX, el catálogo de motivos, y que `/produccion/produccion-del-dia` redirige. Datos de prueba con prefijo "Prueba op", borrarlos al final.
- [ ] `CLAUDE.md`: bloque "Registro de Operación (parte 1)" (tablas, tipos y reglas de fecha, permisos por tipo en el servicio, envío visto en el destino, motivos, Producción del día retirada, migración con su pre-flight). Vault: `10-Dominio/Modulos/Producción.md` (o la nota que corresponda), `00-Inicio/Estado del proyecto.md`, bitácora del día; commit sin push. **Commit** `Docs: Registro de Operación parte 1`.

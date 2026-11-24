# Retiro de merma con autorización — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pestaña *Retiro de merma* en Registro de Operación (pedir, corregir, eliminar) y su autorización/rechazo en
*Operación → Peticiones*.

**Architecture:** `retiro_merma` es un tipo más de `operacion_almacen` con columnas de estado. El backend extiende
`apps/backend/src/modules/produccion/operaciones-almacen.*` (+ reglas puras) y agrega tres endpoints de autorización. El
portal agrega la pestaña al Registro de Operación (`components/registro-operacion/`) y una sección a Peticiones
(`components/peticiones/`).

**Tech Stack:** Postgres/Supabase (migración + pgTAP), NestJS + Kysely + Jest, Next.js + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-retiro-de-merma-design.md`

## Global Constraints

- Migración `supabase/migrations/20261125120000_retiro_merma.sql` (versión única; revisar `ls supabase/migrations` y ramas abiertas).
- `estado` ∈ `pendiente|autorizado|rechazado`, solo en `tipo = 'retiro_merma'` (nulo en los demás, por check); `motivo_rechazo` 1..300 solo y obligatorio en `rechazado`; `resuelto_por_usuario_id`/`resuelto_en` presentes en autorizado/rechazado y nulos en pendiente.
- Permisos: pedir/corregir/eliminar = `operacion.retiro_merma` (nuevo, grupo `Produccion/Almacen`, con su ⓘ en `lib/explicacion-permisos.ts`); autorizar/rechazar = `peticiones.gestionar` (existente).
- Transiciones: pendiente → autorizado | rechazado (Administración); rechazado → pendiente (al editar); autorizado = final (editar/eliminar/autorizar/rechazar → 409). Bloqueo `for update` de la fila en toda transición.
- Fecha: hoy o anteriores (Tijuana), como merma/consumo. Alcance de sucursal como el resto del Registro de Operación.
- Textos en español; `useConfirmar`/`Ventana`; cabe a 1366 px. Tipos duplicados backend ↔ portal en el mismo commit.
- Roberto tiene backend (3010) y portal (3001) prendidos: no apagar ni reiniciar; **no correr `npm run build`**. Migración solo a la base LOCAL (`npm run supabase -- migration up --local`; nunca `db reset` ni la nube).

## Review Focus

1. Autorizar dos veces a la vez (dos pestañas): una gana, la otra 409. → e2e Tarea 2.
2. Editar un retiro mientras Administración lo autoriza: el que llegue después ve el estado nuevo (409 si ya está autorizado). → e2e Tarea 2.
3. Usuario con `peticiones.gestionar` atado a TJ no ve ni autoriza retiros de MX (404/403). → e2e Tarea 2.
4. Un rechazado editado vuelve a salir en la bandeja de Peticiones como pendiente. → e2e Tarea 2, prueba Tarea 3.
5. La lista de la pestaña muestra quién resolvió y el motivo del rechazo. → prueba Tarea 3.

---

### Tarea 1: Migración y pgTAP
**Files:** `supabase/migrations/20261125120000_retiro_merma.sql`, `supabase/tests/99_retiro_merma_test.sql`, `apps/backend/src/database/schema.d.ts` (`npm run db:types --workspace=apps/backend`).
- [ ] pgTAP que falla (tipo nuevo aceptado; estado nulo en otros tipos; combinaciones inválidas de estado/motivo/resuelto rechazadas; permiso nuevo presente) → migración → `npm run supabase -- migration up --local` y `npm run supabase -- test db` PASS → probar en autocommit como el CI (base temporal `prueba_ci`, todas las migraciones con `psql -v ON_ERROR_STOP=1 -f`; borrarla) → db:types → **Commit** `Retiro de merma: migración (estado y permiso)`.

### Tarea 2: Backend
**Files:** `operaciones-almacen.{service,repository,controller}.ts`, `dto/operacion-almacen.dto.ts`, `reglas-operacion.ts` (+ spec), e2e `apps/backend/test/retiro-merma.e2e-spec.ts`.
**Produces:** `OperacionAlmacen` gana `estado: 'pendiente'|'autorizado'|'rechazado'|null`, `resolucion: { por: string, en: string /* 'AAAA-MM-DD HH24:MI' Tijuana */, motivo: string|null } | null`; `editable` es false si está autorizado. `GET /operaciones-almacen/retiros-pendientes?sucursal` → `{ retiros: OperacionAlmacen[] }` (pendientes de su alcance; "todas" para un General = de todas); `POST /operaciones-almacen/:id/autorizar`, `POST /operaciones-almacen/:id/rechazar` `{ motivo }` → la operación actualizada. Reglas puras de transición en `reglas-operacion.ts`.
- [ ] Pruebas que fallan (unit de transiciones; e2e de todo el Review Focus 1–4, más crear/editar/eliminar con `operacion.retiro_merma`, autorizar/rechazar sin `peticiones.gestionar` 403, rechazar sin motivo 400, motivo > 300 400) → implementar → pasan; `npm test`, e2e `retiro-merma` y `operaciones-almacen`, lint → **Commit** `Retiro de merma: backend (pedir, corregir, autorizar, rechazar)`.

### Tarea 3: Portal
**Files:** `lib/operaciones-almacen.ts` (tipos, `listarRetirosPendientes`, `autorizarRetiro`, `rechazarRetiro`), `components/registro-operacion/*` (pestaña "Retiro de merma" al final, con su permiso; estado en la lista), `components/peticiones/*` (sección "Retiro de merma"), `lib/explicacion-permisos.ts`.
- [ ] Pruebas que fallan (pestaña por permiso; estado con `Etiqueta` y motivo/quién resolvió; Editar/Eliminar ocultos si autorizado; editar un rechazado avisa que vuelve a pendiente; Peticiones: lista de pendientes con sucursal, fecha, quién pidió, piezas y productos; Autorizar confirma con `useConfirmar`; Rechazar pide motivo en `Ventana` (obligatorio, ≤ 300); 409 en rojo; sin `peticiones.gestionar` la sección no sale) → implementar → `npm test --workspace=apps/portal`, lint, tsc → **Commit** `Retiro de merma: pestaña y autorización en Peticiones`.

### Tarea 4: Navegador y documentación
- [ ] Con los servidores de Roberto (no apagar, no compilar), a 1366 px: pedir un retiro de prueba ("Prueba retiro" en el comentario), verlo en Peticiones, rechazarlo con motivo, corregirlo (vuelve a pendiente), autorizarlo, ver que ya no se edita; borrar los datos de prueba con SQL en la base local al final.
- [ ] `CLAUDE.md` (bloque Registro de Operación: parte 2 hecha, retiro con estado y autorización, migración y su pre-flight), vault (`10-Dominio/Modulos/Producción.md`, `00-Inicio/Estado del proyecto.md`, bitácora del día; commit sin push) → **Commit** `Docs: retiro de merma`.

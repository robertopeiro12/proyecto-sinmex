# Ruta Semanal y Ruta Diaria (parte 1) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer la Ruta Semanal (nueva), rehacer la Ruta Diaria como la del sistema viejo (ruta del día por vendedor,
vehículo, orden ↑↓, recados) y asignar notas por cobrar, con lo que la tablet necesita en el pull.

**Architecture:** En la base, un **encabezado** por vendedor y día (`ruta_dia`: qué ruta semanal y qué vehículo) sobre
las filas de clientes que ya existen (`ruta`, T-37), más `ruta_semanal` / `ruta_semanal_cliente` y `nota_asignada`. Las
reglas (reemplazo de la ruta del día, propagar un cambio de la semanal, armar la lista de notas) son funciones puras en
`apps/backend/src/modules/rutas/reglas-*.ts`; los servicios solo leen, bloquean, llaman la regla y escriben. En el
portal, dos pantallas nuevas sobre `components/ui/`.

**Tech Stack:** NestJS + Kysely sobre Postgres (Supabase local para pruebas); Next.js + `components/ui/`; Jest
(backend, e2e con Postgres local) y Vitest (portal).

**Spec:** `docs/superpowers/specs/2026-11-10-ruta-semanal-y-diaria-design.md` (léelo completo antes de cada tarea; las
citas R-x.y son del vault `90-Fuentes/Respuestas del cliente 2026-11-10 Rutas (fuente).md`).

## Global Constraints

- "Hoy" = hoy de Tijuana: backend `hoyEnTijuana()` de `modules/sincronizacion/operaciones.ts`; portal `hoyEnTijuana`
  de `lib/ventas.ts`. Nunca UTC ni el reloj del navegador para decidir "pasado".
- Todo vivo = `deleted_at is null`. Bajas siempre lógicas.
- Alcance de sucursal: `resolverAlcance`. Vendedor, ruta semanal o nota de otra sucursal = **404** (no se confirma que
  exista), como `RutasDiariasService.vendedorEnAlcance`.
- Permisos: `ruta_semanal.gestionar` (Ruta Semanal) y `ruta_diaria.gestionar` (Ruta Diaria y notas). Ya existen; no se
  crean permisos ni se asignan a perfiles.
- Días de la semana: `dia_semana` 1 = lunes … 6 = sábado. **Sin domingo.**
- Recado: texto recortado, **≤ 200** caracteres, vacío = `null`.
- Montos en centavos enteros en la API (`aCentavos`).
- **No tocar `apps/tablet`.** Lo que le toca a Mario va como nota en el PR (spec §9).
- Pull: cambios **aditivos**, `CONTRATO_ACTUAL` sigue en 1. `RutaPull.origen` sigue siendo `'oficina' | 'vendedor'`
  (`semanal` baja como `oficina`).
- Cada migración con timestamp único (revisar `ls supabase/migrations`); después de crearla, `npm run supabase --
  migration up --local` y `npm run db:types --workspace=apps/backend`.
- Portal: solo piezas de `components/ui/`; confirmar con `useConfirmar`, nunca `window.confirm`; tablas que quepan a
  1366 px (`table-fixed`, `colgroup`). Ninguna acción recarga la página.
- Textos fijos (copiar tal cual): "Ruta Semanal", "Ruta Diaria", "Crear ruta", "Sin ruta", "Sin vehículo",
  "Ruta asignada", "Clientes asignados", "Notas pendientes por cobrar", "Notas asignadas por cobrar", "Asignar ruta",
  "Quitar ruta", "Pasársela", "(la trae {nombre})", "(lo trae {nombre})", "← Volver a Ruta Semanal",
  "← Volver a Ruta Diaria".
- Pruebas del portal: `NODE_OPTIONS=--no-experimental-webstorage npm test --workspace=apps/portal`.
- Backend: `npm run lint`, `npm run build`, `npm test` y `npm run test:e2e` con `--workspace=apps/backend`.

## Review Focus

1. **Medianoche de Tijuana**: a las 23:30 de Tijuana (ya es mañana en UTC), "hoy" sigue siendo el día de Tijuana para
   "fecha pasada = solo lectura", para "no borrar una ruta asignada hoy o después" y para la propagación de la semanal.
   → prueba de `esFechaEditable` en Tarea 3.
2. **Dos guardados al mismo tiempo** (el jefe guarda la ruta del día mientras otro edita la semanal, o la tablet sube un
   `ruta-alta`): no se duplica un cliente ni se pierde un cambio; el candado es la fila del `vendedor` y la de la
   `ruta_semanal`, siempre en el orden semanal → vendedor. → e2e de propagación en Tarea 4.
3. **Cliente dado de baja dentro de una ruta semanal**: asignar esa ruta no falla; el cliente se salta. → Tarea 2 y
   e2e de Tarea 5.
4. **Nota que se termina de pagar después de asignarla**: deja de salir en pendientes pero sigue en "asignadas". →
   Tarea 6.
5. **Tablet sin actualizar**: el pull nunca manda `origen: 'semanal'`. → Tarea 7.

---

## Mapa de archivos

Backend (`apps/backend/`):

| Archivo | Qué hace |
|---|---|
| `supabase/migrations/20261110120000_ruta_semanal_y_dia.sql` (raíz del repo) | tablas y columnas nuevas |
| `src/modules/rutas/reemplazo-ruta.ts` (modificar) | regla del `PUT` de la ruta del día |
| `src/modules/rutas/reglas-ruta-semanal.ts` (nuevo) | propagar un cambio de la semanal; `esFechaEditable` |
| `src/modules/rutas/reglas-notas-ruta.ts` (nuevo) | armar la lista de notas de una ruta del día |
| `src/modules/rutas/rutas-semanales.{repository,service,controller}.ts` (nuevos) | Ruta Semanal |
| `src/modules/rutas/dto/ruta-semanal.dto.ts` (nuevo) | DTOs de la semanal |
| `src/modules/rutas/rutas-diarias.{repository,service,controller}.ts` (modificar) | Ruta Diaria ampliada |
| `src/modules/rutas/dto/ruta-diaria.dto.ts` (modificar) | DTOs de la diaria |
| `src/modules/rutas/notas-asignadas.{repository,service,controller}.ts` (nuevos) | notas por cobrar |
| `src/modules/rutas/rutas.module.ts` (modificar) | registrar lo nuevo |
| `src/modules/sincronizacion/{contrato,sincronizacion.repository,sincronizacion.service}.ts` (modificar) | pull |
| `src/modules/estadisticas/{flujo-diario.repository,reglas-flujo-diario}.ts` (modificar) | nombre de ruta, vehículo asignado |
| `test/rutas-semanales.e2e-spec.ts`, `test/notas-asignadas.e2e-spec.ts` (nuevos), `test/rutas-diarias.e2e-spec.ts` (modificar) | e2e |

Portal (`apps/portal/src/`):

| Archivo | Qué hace |
|---|---|
| `lib/rutas-semanales.ts` (+ `.test.ts`) | API y funciones puras de la semanal |
| `lib/rutas.ts` (+ `.test.ts`, modificar) | API de la diaria ampliada, notas, funciones puras |
| `components/rutas-semanales/*` (nuevos) | pantalla Ruta Semanal |
| `components/rutas/*` (rehacer) | lista del día, ruta de un vendedor, ventana de notas |
| `app/(portal)/operacion/ruta-semanal/page.tsx` | deja de ser `Placeholder` |
| `components/layout/nav-config.ts` | quitar `pronto` de Ruta Semanal |
| `lib/flujo-diario.ts` (modificar) | `etiquetaRutaAsignada` con nombre; vehículo asignado |

---

### Tarea 1: Migración

**Files:**
- Create: `supabase/migrations/20261110120000_ruta_semanal_y_dia.sql`
- Modify: `apps/backend/src/database/schema.d.ts` (regenerado)

**Interfaces:**
- Produces: tablas `ruta_semanal`, `ruta_semanal_cliente`, `ruta_dia`, `nota_asignada`; columnas `ruta.recado`,
  `ruta.quitado_por`; `ruta.origen` admite `semanal`.

- [ ] **Paso 1: Escribir la migración** (comentario de cabecera como las demás: para qué, aditiva, pre-flight "tablas
  nuevas y columnas nulas; nada que contar"):
  - `ruta_semanal(id uuid pk default gen_random_uuid(), sucursal_id uuid not null references sucursal, dia_semana
    smallint not null check (dia_semana between 1 and 6), nombre text not null check (btrim(nombre) <> ''),
    created_at, updated_at, deleted_at)` + trigger `set_updated_at` + único vivo
    `uq_ruta_semanal_nombre on (sucursal_id, dia_semana, lower(btrim(nombre))) where deleted_at is null`.
  - `ruta_semanal_cliente(id, ruta_semanal_id not null references ruta_semanal, cliente_id not null references
    cliente, orden integer not null, created_at, updated_at, deleted_at)` + trigger + único vivo
    `(ruta_semanal_id, cliente_id)`.
  - `ruta_dia(id, vendedor_id not null references vendedor, fecha date not null, ruta_semanal_id null references
    ruta_semanal, nombre_ruta text null, vehiculo_id null references vehiculo, actualizado_por_usuario_id null
    references usuario, created_at, updated_at, deleted_at)` + trigger + únicos vivos `uq_ruta_dia_vendedor_fecha
    (vendedor_id, fecha)` y `uq_ruta_dia_semanal_fecha (ruta_semanal_id, fecha) where deleted_at is null and
    ruta_semanal_id is not null` + check `(ruta_semanal_id is null) = (nombre_ruta is null)`.
  - `nota_asignada(id, venta_nota_id not null references venta_nota, vendedor_id not null references vendedor, fecha
    date not null, asignada_por_usuario_id not null references usuario, quitada_por_usuario_id null references
    usuario, created_at, updated_at, deleted_at)` + trigger + único vivo `uq_nota_asignada_nota_fecha (venta_nota_id,
    fecha)` + índice `(vendedor_id, fecha) where deleted_at is null`.
  - `alter table ruta`: `drop constraint ck_ruta_origen`, `add constraint ck_ruta_origen check (origen in
    ('oficina','vendedor','semanal'))`; `add column recado text check (recado is null or char_length(recado) <= 200)`;
    `add column quitado_por text check (quitado_por in ('oficina','cambio_ruta'))`.
- [ ] **Paso 2: Aplicar y regenerar tipos**
  Run: `npm run supabase -- migration up --local && npm run db:types --workspace=apps/backend`
  Expected: la migración aplica; `schema.d.ts` gana las 4 tablas y las 2 columnas.
- [ ] **Paso 3: Comprobar que nada se rompió**
  Run: `npm run build --workspace=apps/backend && npm run test:e2e --workspace=apps/backend -- rutas-diarias`
  Expected: PASS (la migración es aditiva).
- [ ] **Paso 4: Commit** — `git commit -m "Ruta semanal y del día: migración"`

### Tarea 2: Regla del reemplazo de la ruta del día

**Files:**
- Modify: `apps/backend/src/modules/rutas/reemplazo-ruta.ts`
- Modify: `apps/backend/src/modules/rutas/reemplazo-ruta.spec.ts`
- Modify: `apps/backend/src/modules/rutas/rutas-diarias.repository.ts` (solo el tipo `OrigenRuta`)

**Interfaces:**
- Produces:
  ```ts
  export type OrigenRuta = 'oficina' | 'vendedor' | 'semanal';
  export interface FilaViva { id: string; clienteId: string; orden: number; origen: OrigenRuta; recado: string | null }
  export interface PedidoCliente { clienteId: string; recado: string | null }
  export interface PlanReemplazo {
    actualizar: { id: string; orden: number; recado: string | null }[];
    insertar: { clienteId: string; orden: number; origen: 'oficina' | 'semanal'; recado: string | null }[];
    borrar: { id: string; clienteId: string; quitadoPor: 'oficina' | 'cambio_ruta' }[];
  }
  export function planearReemplazo(
    vivas: readonly FilaViva[],
    pedidos: readonly PedidoCliente[],
    contexto: { clientesDeLaSemanal: ReadonlySet<string>; rutaCambio: boolean },
  ): PlanReemplazo;
  ```
  - El **origen ya no se reescribe**: una fila viva conserva el suyo (cambia la regla D14 de T-37).
  - Nueva: `semanal` si está en `clientesDeLaSemanal`, si no `oficina`.
  - Las que no vienen: las del vendedor se conservan al final (como hoy); las demás se borran con `quitadoPor`:
    `cambio_ruta` si `rutaCambio` y la fila es `semanal`, si no `oficina`.
  - Una fila que ya tiene su orden y su recado no entra en `actualizar`.

- [ ] **Paso 1: Pruebas que fallan** (en `reemplazo-ruta.spec.ts`, ajustar las que esperaban `origen: 'oficina'`):
  - `conserva el origen al reordenar`: vivas `[A(vendedor,1), B(semanal,2)]`, pedidos `[B, A]` → `actualizar` =
    `[{id:B,orden:1}, {id:A,orden:2}]` y ninguna con origen.
  - `una nueva de la semanal nace semanal`: semanal `{C}`, pedidos `[C, D]` → `insertar` =
    `[{C,1,'semanal'}, {D,2,'oficina'}]`.
  - `quitar a mano marca oficina`: vivas `[A(semanal)]`, pedidos `[]`, `rutaCambio:false` → `borrar` =
    `[{id:A, clienteId:'A', quitadoPor:'oficina'}]`.
  - `cambiar de ruta marca cambio_ruta solo lo que vino de la semanal`: vivas `[A(semanal), B(oficina)]`, pedidos `[]`,
    `rutaCambio:true` → `A` con `cambio_ruta`, `B` con `oficina`.
  - `el recado cambia sin mover el orden`: viva `A(orden 1, recado null)`, pedido `A` con `'Solo contado'` →
    `actualizar` = `[{id:A, orden:1, recado:'Solo contado'}]`.
- [ ] **Paso 2: Correr y ver que fallan**
  Run: `npm test --workspace=apps/backend -- reemplazo-ruta`  Expected: FAIL
- [ ] **Paso 3: Implementar** `planearReemplazo` con la firma de arriba. `aplicarReemplazo` del repositorio se ajusta en
  la Tarea 5.
- [ ] **Paso 4: Correr** — Run: `npm test --workspace=apps/backend -- reemplazo-ruta`  Expected: PASS
- [ ] **Paso 5: Commit** — `git commit -m "Ruta del día: el reemplazo conserva el origen y lleva recados"`

### Tarea 3: Regla de propagación de la semanal y fecha editable

**Files:**
- Create: `apps/backend/src/modules/rutas/reglas-ruta-semanal.ts`
- Create: `apps/backend/src/modules/rutas/reglas-ruta-semanal.spec.ts`

**Interfaces:**
- Consumes: `FilaViva`, `OrigenRuta` (Tarea 2).
- Produces:
  ```ts
  export function esFechaEditable(fecha: string, hoy: string): boolean; // fecha >= hoy, AAAA-MM-DD
  export function diaSemanaDe(fecha: string): number | null; // 1 = lunes … 6 = sábado; domingo = null
  export interface PlanPropagacion {
    insertar: { clienteId: string; orden: number }[];   // origen 'semanal'
    borrar: { id: string; clienteId: string }[];         // quitado_por 'cambio_ruta'
  }
  export function planearPropagacion(
    vivasDelDia: readonly FilaViva[],
    agregados: readonly string[],                 // en el orden de la semanal
    quitados: ReadonlySet<string>,
    quitadosAManoEseDia: ReadonlySet<string>,     // filas con quitado_por = 'oficina' ese día
    clientesValidos: ReadonlySet<string>,
  ): PlanPropagacion;
  ```
  Reglas (spec §4): agregado → al final (orden `max + 1`, en el orden de `agregados`) salvo que esté vivo, quitado a
  mano ese día o no sea válido; quitado → se borra solo si su fila viva es `semanal`.

- [ ] **Paso 1: Pruebas que fallan**
  - `esFechaEditable('2026-11-10','2026-11-10')` → `true`; `('2026-11-09','2026-11-10')` → `false`.
  - `diaSemanaDe('2026-11-10')` → `2` (martes); `('2026-11-15')` → `null` (domingo); `('2026-11-14')` → `6`.
  - `agrega al final y respeta lo quitado a mano`: vivas `[A(1), B(2)]`, agregados `[C, D]`, quitados a mano `{D}` →
    `insertar` = `[{C, 3}]`.
  - `no duplica lo que el vendedor ya agregó`: vivas `[C(vendedor)]`, agregados `[C]` → `insertar` = `[]`.
  - `quita solo lo que vino de la semanal`: vivas `[A(semanal), B(oficina)]`, quitados `{A, B}` → `borrar` = `[A]`.
  - `salta clientes no válidos`: agregados `[X]`, válidos `{}` → `insertar` = `[]`.
- [ ] **Paso 2: Correr** — Run: `npm test --workspace=apps/backend -- reglas-ruta-semanal`  Expected: FAIL
- [ ] **Paso 3: Implementar** las tres funciones. `diaSemanaDe` con `Date.UTC` sobre los componentes de la fecha
  (`getUTCDay()`), nunca con la zona del proceso.
- [ ] **Paso 4: Correr** — Expected: PASS
- [ ] **Paso 5: Commit** — `git commit -m "Ruta semanal: regla de propagación a las rutas del día"`

### Tarea 4: Backend de la Ruta Semanal

**Files:**
- Create: `apps/backend/src/modules/rutas/rutas-semanales.repository.ts`, `rutas-semanales.service.ts`,
  `rutas-semanales.controller.ts`, `dto/ruta-semanal.dto.ts`
- Modify: `apps/backend/src/modules/rutas/rutas.module.ts`
- Test: `apps/backend/test/rutas-semanales.e2e-spec.ts`

**Interfaces:**
- Consumes: `planearPropagacion`, `esFechaEditable` (Tarea 3); `hoyEnTijuana`.
- Produces (respuestas en camelCase; tipos exportados del service, el portal los copia en la Tarea 9):
  ```ts
  export interface RutaSemanalResumen { id: string; diaSemana: number; nombre: string; clientes: number; sucursalCodigo: string }
  export interface ClienteDeRutaSemanal { clienteId: string; nombre: string; valido: boolean } // valido=false: baja/prospecto/otra sucursal
  export interface RutaSemanalDetalle extends RutaSemanalResumen { lista: ClienteDeRutaSemanal[] }
  ```
  Endpoints, todos `@RequierePermiso('ruta_semanal.gestionar')`, controlador `@Controller('rutas/semanales')`:
  - `GET /rutas/semanales?sucursal=TJ` → `RutaSemanalResumen[]` (todas, de lunes a sábado; el portal las separa por
    pestaña). Con "Todas" y usuario general sin `sucursal` → 400 "Elige una sucursal.".
  - `POST /rutas/semanales` `{ sucursal, diaSemana, nombre }` → `RutaSemanalDetalle`. Nombre repetido vivo en ese día y
    sucursal → 409 "Ya hay una ruta con ese nombre el {día}.". `nombre` recortado, 1–80 caracteres.
  - `GET /rutas/semanales/:id` → `RutaSemanalDetalle`.
  - `PATCH /rutas/semanales/:id` `{ nombre }` → `RutaSemanalDetalle`; también actualiza `ruta_dia.nombre_ruta` de esa ruta
    con `fecha >= hoy`.
  - `PUT /rutas/semanales/:id/clientes` `{ clientes: string[] }` (≤ 300, sin repetidos, clientes **nuevos** válidos de
    la sucursal; si no, 400 nombrándolos con el mismo texto que `motivoClientesNoValidos`) → `RutaSemanalDetalle`.
    En la misma transacción: bloquear la `ruta_semanal` (`for no key update`), reemplazar `ruta_semanal_cliente`
    (orden = posición), y para cada `ruta_dia` viva de esa ruta con `fecha >= hoy`: bloquear su vendedor, leer sus
    vivas y sus quitados a mano, `planearPropagacion`, escribir (insert `origen='semanal'`; borrar con
    `quitado_por='cambio_ruta'`) y dar de baja las `nota_asignada` de ese vendedor y fecha cuyo cliente salió.
  - `DELETE /rutas/semanales/:id` → 204. Si hay `ruta_dia` viva con `fecha >= hoy` → 409 "Esta ruta está asignada a
    {vendedor} el {fecha larga}.".
  - Otra sucursal = 404 "No existe esa ruta.".

- [ ] **Paso 1: e2e que falla** en `test/rutas-semanales.e2e-spec.ts` (mismo armado que `rutas-diarias.e2e-spec.ts`:
  usuarios general/TJ/sin permiso, vendedores y clientes con `SUFIJO`; fechas **futuras** propias del archivo, desde
  `2099-01-05`, que es lunes):
  - `crea, lista y renombra`: POST → 201 con `clientes: 0`; GET lista la incluye con `diaSemana`; PATCH cambia el nombre.
  - `nombre repetido el mismo día = 409; otro día = 201`.
  - `sin permiso = 403; usuario de TJ sobre una de MX = 404`.
  - `propaga sin deshacer lo quitado a mano`: semanal martes con `[A, B]`; asignar a vendedor el martes `2099-01-06`
    (PUT de la diaria con `rutaSemanalId`, Tarea 5) y quitar `B` a mano; PUT de la semanal con `[A, B, C]` → la ruta
    del día queda `[A, C]` con `C` `origen 'semanal'`.
  - `quitar de la semanal saca solo lo que vino de ella`: con `D` agregado a mano en la diaria y presente en la semanal
    como fila `oficina`, quitar `D` de la semanal → sigue en la diaria.
  - `borrar una ruta asignada hoy o después = 409`; sin asignaciones futuras → 204 y deja de listarse.
  - `cliente dado de baja sale con valido:false` en el detalle.
  > La prueba de propagación depende del PUT de la Tarea 5: escríbela aquí y márcala con `it.todo` hasta la Tarea 5,
  > que la activa.
- [ ] **Paso 2: Correr** — Run: `npm run test:e2e --workspace=apps/backend -- rutas-semanales`  Expected: FAIL (404 de
  rutas inexistentes)
- [ ] **Paso 3: Implementar** repositorio, servicio, DTOs (`class-validator`, mensajes en español como
  `dto/ruta-diaria.dto.ts`) y controlador; registrarlos en `rutas.module.ts`. El nombre del día en los mensajes:
  `['lunes','martes','miércoles','jueves','viernes','sábado'][diaSemana - 1]`.
- [ ] **Paso 4: Correr** e2e + `npm run lint --workspace=apps/backend` — Expected: PASS
- [ ] **Paso 5: Commit** — `git commit -m "Ruta semanal: backend"`

### Tarea 5: Backend de la Ruta Diaria ampliada

**Files:**
- Modify: `apps/backend/src/modules/rutas/rutas-diarias.{repository,service,controller}.ts`, `dto/ruta-diaria.dto.ts`
- Test: `apps/backend/test/rutas-diarias.e2e-spec.ts`, `apps/backend/src/modules/rutas/rutas-diarias.service.spec.ts`

**Interfaces:**
- Consumes: `planearReemplazo` (Tarea 2), `esFechaEditable`, `diaSemanaDe` (Tarea 3), tablas de la Tarea 1.
- Produces (tipos exportados del service; el portal los copia en `lib/rutas.ts`, Tarea 10):
  ```ts
  export interface FilaRutaDiaria { id: string; clienteId: string; clienteNombre: string; orden: number; origen: OrigenRuta; recado: string | null; notasAsignadas: number }
  export interface RutaDiaria {
    vendedor: { id: string; nombre: string; sucursalCodigo: string };
    fecha: string;
    editable: boolean;                       // esFechaEditable(fecha, hoy)
    rutaSemanal: { id: string; nombre: string } | null;
    vehiculo: { id: string; nombre: string } | null;
    filas: FilaRutaDiaria[];
  }
  export interface RenglonDia {
    vendedorId: string; vendedor: string; sucursalCodigo: string;
    rutaNombre: string | null; clientes: number;
    notasPendientes: number; notasAsignadas: number;
    vehiculo: string | null; tieneRuta: boolean;  // tieneRuta: hay ruta_dia viva o filas vivas
  }
  export interface OpcionesDia {                       // lo que llena las listas de la pantalla del vendedor
    rutas: { id: string; nombre: string; ocupadaPor: string | null }[];   // del día de la semana de la fecha
    vehiculos: { id: string; nombre: string; ocupadoPor: string | null }[];
  }
  ```
  Endpoints (`ruta_diaria.gestionar`):
  - `GET /rutas/diaria/dia?fecha&sucursal` → `{ fecha, editable, renglones: RenglonDia[] }`: un renglón por vendedor
    **activo** de la sucursal, por nombre. `notasPendientes` = notas con saldo de los clientes de su ruta (misma
    definición que la Tarea 6).
  - `GET /rutas/diaria?vendedorId&fecha` → `RutaDiaria` (ampliado).
  - `GET /rutas/diaria/opciones?vendedorId&fecha` → `OpcionesDia` (excluye de `ocupadaPor` al propio vendedor).
  - `PUT /rutas/diaria` `{ vendedorId, fecha, rutaSemanalId: string|null, vehiculoId: string|null, clientes: { clienteId,
    recado }[] }` → `RutaDiaria`. Reglas:
    - fecha pasada → 400 "Ese día ya pasó; solo se puede consultar.";
    - `rutaSemanalId` de otro día de la semana o de otra sucursal → 400 "Esa ruta no es del {día}."; ya asignada a otro
      vendedor ese día → 409 "Esa ruta ya la trae {vendedor} ese día." (atrapar `uq_ruta_dia_semanal_fecha` con
      `on conflict` o comprobar con la fila bloqueada; nunca un 500);
    - `vehiculoId` vivo y activo de la sucursal del vendedor, si no 400 "Ese vehículo no es de la sucursal.";
    - recado > 200 → 400 (DTO);
    - Upsert de `ruta_dia` (`nombre_ruta` = nombre actual de la semanal), `planearReemplazo` con
      `clientesDeLaSemanal` = clientes vivos de esa semanal y `rutaCambio` = la semanal cambió respecto a la guardada;
      escribir `quitado_por` en las bajas; dar de baja las `nota_asignada` de ese vendedor y fecha cuyos clientes salieron.
    - Clientes nuevos inválidos: si vienen de la semanal elegida se **saltan**; si se agregaron a mano → 400 como hoy.
  - `DELETE /rutas/diaria?vendedorId&fecha` → 204: baja de `ruta_dia`, de las filas `oficina`/`semanal`
    (`quitado_por='cambio_ruta'`) y de sus `nota_asignada` de ese día. Las `vendedor` se quedan. Fecha pasada → 400.
  - Se **borra** `GET /rutas/diaria/anterior` (y `fechaAnteriorConRuta`, `clientesValidosDeFecha`): "Copiar de ayer"
    desaparece.
  - Candados: `ruta_semanal` (si hay) → `vendedor`, el mismo orden que la Tarea 4.

- [ ] **Paso 1: Mover las fechas del e2e existente al futuro**: en `test/rutas-diarias.e2e-spec.ts`, `diaNuevo` arranca
  en `2099-06-01` (con la regla de fecha pasada, las de 2023 darían 400). Quitar las pruebas de `/anterior`. Ajustar las
  que esperaban que la oficina **adopte** una fila del vendedor como `oficina`: ahora sigue `vendedor`.
- [ ] **Paso 2: e2e que fallan** (mismo archivo):
  - `asigna una ruta semanal y copia sus clientes en orden`, con `rutaSemanal.nombre` y `origen 'semanal'`.
  - `la misma ruta a otro vendedor el mismo día = 409` con el texto de arriba.
  - `ruta de otro día de la semana = 400`.
  - `fecha pasada = 400` (`2020-01-06`) en PUT y DELETE; GET de esa fecha responde `editable: false`.
  - `guarda vehículo y recado`; `vehículo de otra sucursal = 400`.
  - `quitar un cliente con notas asignadas les da de baja` (crear la `nota_asignada` directo en la base).
  - `DELETE conserva lo del vendedor` (fila insertada con `origen 'vendedor'`).
  - `GET /dia lista a los vendedores activos con su ruta y conteos`, incluido uno sin ruta (`rutaNombre: null`,
    `clientes: 0`).
  - Activar el `it.todo` de propagación de la Tarea 4.
- [ ] **Paso 3: Correr** — Run: `npm run test:e2e --workspace=apps/backend -- rutas-diarias rutas-semanales`
  Expected: FAIL
- [ ] **Paso 4: Implementar.** `aplicarReemplazo` escribe `recado`, `origen` por fila insertada y `quitado_por` en las
  bajas. `agregarAlDia` (alta de la tablet) no cambia salvo el tipo.
- [ ] **Paso 5: Correr** e2e + unitarias + lint — Expected: PASS
- [ ] **Paso 6: Commit** — `git commit -m "Ruta diaria: ruta semanal, vehículo, recados y lista del día"`

### Tarea 6: Backend de notas asignadas

**Files:**
- Create: `apps/backend/src/modules/rutas/reglas-notas-ruta.ts` (+ `.spec.ts`),
  `notas-asignadas.{repository,service,controller}.ts`
- Modify: `apps/backend/src/modules/rutas/rutas.module.ts`
- Test: `apps/backend/test/notas-asignadas.e2e-spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface NotaDeRuta {
    ventaNotaId: string; folio: string; clienteId: string; cliente: string;
    fecha: string; saldoCentavos: number; diasAtraso: number;
    asignadaA: { vendedorId: string; nombre: string } | null;   // ese día
  }
  export interface NotasDeRuta {
    pendientes: NotaDeRuta[];   // clientes de su ruta, en el orden de la ruta, luego fecha y folio
    asignadas: NotaDeRuta[];    // las de este vendedor ese día, aunque ya no tengan saldo
  }
  export function armarNotasDeRuta(ordenClientes: readonly string[], notas: readonly NotaDeRuta[], vendedorId: string): NotasDeRuta;
  ```
  "Nota con saldo" (spec §5.4): venta viva, `status in ('pendiente','abonado')`, saldo derivado > 0 (abonos vivos, como
  `cuentas-por-cobrar.repository.ts`), incluidas las del mismo día. `diasAtraso` con el mismo `case` de ese repositorio.
  Endpoints (`ruta_diaria.gestionar`, controlador `@Controller('rutas/diaria/notas')`):
  - `GET ?vendedorId&fecha` → `NotasDeRuta`.
  - `PUT /:ventaNotaId` `{ vendedorId, fecha }` → `NotasDeRuta`: asigna, o **pasa** si la tiene otro ese día (baja de la
    otra con `quitada_por_usuario_id` + alta, una transacción). Fecha pasada → 400; cliente de la nota fuera de la ruta
    de ese día → 400 "Primero agrega a {cliente} a la ruta."; nota sin saldo → 409 "Esa nota ya no tiene saldo.".
    Misma nota y mismo vendedor → 200 sin escribir.
  - `DELETE /:ventaNotaId?vendedorId&fecha` → `NotasDeRuta`.
  - Candado: la fila del `vendedor` destino y la `venta_nota` (`for no key update`), en ese orden.

- [ ] **Paso 1: Pruebas unitarias que fallan** (`reglas-notas-ruta.spec.ts`): orden por ruta y luego fecha/folio; una
  asignada sin saldo sale en `asignadas` y no en `pendientes`; una asignada a otro sale en `pendientes` con `asignadaA`.
- [ ] **Paso 2: e2e que fallan**: asignar; pasar de A a B (A ya no la tiene); quitar; cliente fuera de la ruta = 400;
  nota pagada después de asignarla sigue en `asignadas`; nota del mismo día se puede asignar; otra sucursal = 404.
- [ ] **Paso 3: Correr** — Expected: FAIL
- [ ] **Paso 4: Implementar.**
- [ ] **Paso 5: Correr** unitarias + e2e + lint — Expected: PASS
- [ ] **Paso 6: Commit** — `git commit -m "Ruta diaria: asignar, pasar y quitar notas por cobrar"`

### Tarea 7: Pull de la tablet

**Files:**
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts`, `sincronizacion.repository.ts`,
  `sincronizacion.service.ts`, `docs/contrato-sincronizacion.md`
- Test: el e2e del pull existente (`apps/backend/test/` el que cubre `rutas` en el pull; buscarlo con
  `grep -l "rutas" apps/backend/test/*sincron*`)

**Interfaces:**
- Produces (aditivo, `CONTRATO_ACTUAL` sigue en 1):
  ```ts
  export interface RutaPull extends FilaSincronizable { cliente_id: string; fecha: string; orden: number; origen: 'oficina' | 'vendedor'; recado: string | null }
  export interface RutaDiaPull extends FilaSincronizable { fecha: string; nombre_ruta: string | null; vehiculo_id: string | null }
  export interface NotaAsignadaPull extends FilaSincronizable { venta_nota_id: string; fecha: string }
  // RespuestaPull: rutas_dia: RutaDiaPull[]; notas_asignadas: NotaAsignadaPull[]  (al lado de `rutas`)
  ```
  Misma ventana que `rutas` (`fecha >= current_date - 1`, sin tope, incremental por `updated_at`, bajas como
  `activo: 0`), solo del vendedor del token. `origen: f.origen === 'vendedor' ? 'vendedor' : 'oficina'`.
  **No** se edita `apps/tablet/src/sincronizacion/contrato.ts`: va en la nota para Mario.

- [ ] **Paso 1: e2e que falla**: el pull trae `recado`, una fila `semanal` llega como `origen: 'oficina'`, y trae
  `rutas_dia` y `notas_asignadas` del vendedor (no las de otro); una nota asignada quitada llega con `activo: 0` en el
  pull incremental.
- [ ] **Paso 2: Correr** — Expected: FAIL
- [ ] **Paso 3: Implementar** y documentar en `docs/contrato-sincronizacion.md` (sección de rutas).
- [ ] **Paso 4: Correr** e2e del pull + `npm test` + lint — Expected: PASS
- [ ] **Paso 5: Commit** — `git commit -m "Pull: recado, rutas_dia y notas_asignadas para la tablet"`

### Tarea 8: Dashboard y Flujo diario con el nombre de la ruta

**Files:**
- Modify: `apps/backend/src/modules/estadisticas/flujo-diario.repository.ts`, `reglas-flujo-diario.ts` (+ spec)
- Modify: `apps/portal/src/lib/flujo-diario.ts` (+ test), `components/dashboard/tabla-dashboard.tsx`,
  `components/flujo-diario/tabla-por-vendedor.tsx` (+ sus tests)

**Interfaces:**
- Produces: `FilaVendedorDia` gana `rutaNombre: string | null` (de `ruta_dia` viva de ese vendedor y día) y
  `vehiculoAsignado: string | null` (nombre del vehículo de `ruta_dia`). En el portal:
  `etiquetaRutaAsignada(rutaNombre: string | null, clientesEnRuta: number): string` →
  `"RUTA 5 (BLV 2000) · 16 clientes"`, `"Sin ruta · 3 clientes"` (sin nombre y con clientes), `"Sin ruta"` (0 clientes);
  `etiquetaVehiculo(usado: string | null, asignado: string | null): string` → `"Nissan 02 (asignado: Nissan 01)"` si
  difieren y los dos existen; si no, el que haya; si ninguno, `"—"`.

- [ ] **Paso 1: Pruebas que fallan**: las dos funciones del portal con los casos de arriba; en el repositorio, la fila de
  un vendedor con `ruta_dia` trae `rutaNombre` (e2e de flujo diario existente, un caso nuevo).
- [ ] **Paso 2: Correr** — Expected: FAIL
- [ ] **Paso 3: Implementar** en backend y portal (los tipos duplicados cambian juntos). Las tablas usan las dos
  funciones.
- [ ] **Paso 4: Correr** backend + portal — Expected: PASS
- [ ] **Paso 5: Commit** — `git commit -m "Dashboard y Flujo diario: nombre de la ruta y vehículo asignado"`

### Tarea 9: Portal — Ruta Semanal

**Files:**
- Create: `apps/portal/src/lib/rutas-semanales.ts` (+ `.test.ts`), `components/rutas-semanales/pantalla-ruta-semanal.tsx`,
  `components/rutas-semanales/editar-ruta-semanal.tsx` (+ tests)
- Modify: `apps/portal/src/app/(portal)/operacion/ruta-semanal/page.tsx`, `components/layout/nav-config.ts`

**Interfaces:**
- Consumes: endpoints de la Tarea 4 (tipos copiados con el comentario "copia normativa de …").
- Produces: `listarRutasSemanales(sucursal)`, `crearRutaSemanal({sucursal, diaSemana, nombre})`,
  `obtenerRutaSemanal(id)`, `renombrarRutaSemanal(id, nombre)`, `guardarClientesRutaSemanal(id, clientes)`,
  `eliminarRutaSemanal(id)`; puras `rutasDelDia(rutas, diaSemana)` y `diaDeHoy(hoy: string): number` (lunes si es
  domingo).

- [ ] **Paso 1: Pruebas que fallan** (Vitest + Testing Library, como `pantalla-ruta-diaria.test.tsx`):
  - abre en la pestaña del día de hoy; las pestañas son Lunes … Sábado (sin Domingo);
  - la tabla muestra Ruta · Clientes y no hay "Buscar ruta";
  - "Crear ruta" abre una `Ventana` con solo Nombre y, al crear, abre la edición;
  - editar: agregar desde la lista de todos los clientes (buscador sin acentos), quitar, "Clientes de la ruta: N",
    Guardar llama `guardarClientesRutaSemanal` con los ids en el orden en que se agregaron; un cliente `valido:false`
    sale con la etiqueta "dado de baja";
  - salir con cambios pregunta (`useConfirmar`); eliminar confirma y muestra el 409 en un `Aviso`.
- [ ] **Paso 2: Correr** — Expected: FAIL
- [ ] **Paso 3: Implementar.** Reusar la idea de `CarteraRuta` (izquierda) con su filtro sin acentos. Quitar `pronto: true`
  de Ruta Semanal en `nav-config.ts`.
- [ ] **Paso 4: Correr** pruebas del portal + `npm run lint --workspace=apps/portal` — Expected: PASS
- [ ] **Paso 5: Revisar en el navegador** a 1366 px (backend local en 3010, usuario `revision`), crear, editar y borrar
  una ruta. Tomar captura.
- [ ] **Paso 6: Commit** — `git commit -m "Portal: Ruta Semanal"`

### Tarea 10: Portal — Ruta Diaria (lista del día y ruta de un vendedor)

**Files:**
- Modify: `apps/portal/src/lib/rutas.ts` (+ `.test.ts`)
- Rehacer: `components/rutas/pantalla-ruta-diaria.tsx` (lista del día), crear `components/rutas/ruta-de-vendedor.tsx`;
  `lista-ruta-diaria.tsx` y `cartera-ruta.tsx` se adaptan (+ tests)

**Interfaces:**
- Consumes: endpoints y tipos de la Tarea 5.
- Produces en `lib/rutas.ts`: `obtenerDia(fecha, sucursal)`, `obtenerRutaDiaria`, `obtenerOpciones(vendedorId, fecha)`,
  `guardarRutaDiaria({vendedorId, fecha, rutaSemanalId, vehiculoId, clientes})`, `quitarRutaDiaria(vendedorId, fecha)`;
  puras `moverFila` (se queda), `quitarFila` (se queda: no quita las del vendedor), `fijarRecado(filas, indice, texto)`
  (recorta; vacío = null; > 200 no se acepta), `aplicarRutaSemanal(filas, clientesDeLaSemanal)` (salen las `semanal`,
  entran las nuevas en su orden, se quedan las `oficina` y `vendedor`), `hayCambios` (cuenta orden, recados, ruta y
  vehículo). Se borran `cargarAnterior`, `obtenerRutaAnterior` y "Copiar de ayer".

- [ ] **Paso 1: Pruebas que fallan**:
  - lista del día: columnas Vendedor · Ruta asignada · Clientes asignados · Notas pendientes por cobrar · Notas asignadas
    por cobrar · Vehículo · acciones; "Sin ruta" / "Sin vehículo"; "Asignar ruta" si no tiene, "Editar" y "Quitar ruta"
    si tiene; un día pasado no muestra acciones de cambio;
  - ruta de un vendedor: la lista de rutas deshabilita la que trae otro con "(la trae Juan)"; el vehículo de otro sale
    "(lo trae Juan)" y sí se puede escoger; escoger ruta copia sus clientes; cambiar de ruta con clientes pregunta;
  - ↑ en el primero y ↓ en el último están deshabilitados; ↓ mueve una posición;
  - recado: se escribe y se ve bajo el nombre; 201 caracteres no se acepta;
  - quitar un cliente con `notasAsignadas > 0` avisa "{cliente} tiene N notas asignadas; se le quitarán.";
  - Guardar manda `{rutaSemanalId, vehiculoId, clientes:[{clienteId, recado}]}` y regresa a la lista sin recargar.
- [ ] **Paso 2: Correr** — Expected: FAIL
- [ ] **Paso 3: Implementar.** Tabla de la lista con `table-fixed` + `colgroup` medida a 1366 px.
- [ ] **Paso 4: Correr** pruebas + lint — Expected: PASS
- [ ] **Paso 5: Revisar en el navegador** a 1366 px: asignar una ruta, ordenar, recado, vehículo, guardar, quitar ruta.
- [ ] **Paso 6: Commit** — `git commit -m "Portal: Ruta Diaria como la del sistema viejo"`

### Tarea 11: Portal — Notas por cobrar

**Files:**
- Create: `apps/portal/src/components/rutas/ventana-notas.tsx` (+ test)
- Modify: `apps/portal/src/lib/rutas.ts` (+ test), `components/rutas/pantalla-ruta-diaria.tsx`

**Interfaces:**
- Consumes: Tarea 6.
- Produces: `obtenerNotas(vendedorId, fecha)`, `asignarNota(ventaNotaId, vendedorId, fecha)`,
  `quitarNota(ventaNotaId, vendedorId, fecha)`; pura `filtrarPorFolio(notas, texto)` (sin acentos ni mayúsculas).

- [ ] **Paso 1: Pruebas que fallan**:
  - "Notas pendientes por cobrar" abre la `Ventana` "Notas para {vendedor} · {fecha larga}" con Buscar por folio y
    columnas Cliente · Folio · Fecha · Saldo · Días de atraso · acción;
  - acción "Asignar" / "Quitar" / "La trae Juan · Pasársela" según `asignadaA`; cada clic llama al endpoint y repinta con
    la respuesta (sin botón Guardar); un error sale en un `Aviso` dentro de la ventana;
  - "Notas asignadas por cobrar" abre la lista de asignadas con Quitar;
  - al cerrar, la lista del día vuelve a pedir sus conteos.
- [ ] **Paso 2: Correr** — Expected: FAIL
- [ ] **Paso 3: Implementar.**
- [ ] **Paso 4: Correr** pruebas + lint — Expected: PASS
- [ ] **Paso 5: Revisar en el navegador**: asignar, pasar entre dos vendedores, quitar.
- [ ] **Paso 6: Commit** — `git commit -m "Portal: asignar notas por cobrar en la Ruta Diaria"`

### Tarea 12: Documentación y nota para Mario

**Files:**
- Modify: `CLAUDE.md` (bloque "Ruta diaria (T-37)": encabezado `ruta_dia`, semanal, notas asignadas, origen que conserva
  el servidor, `semanal` → `oficina` en el pull, protocolo de nube para `20261110120000_ruta_semanal_y_dia.sql`)
- Modify (vault `../jawa-obsidian-memory`): `10-Dominio/Entidades/Ruta.md`, `10-Dominio/Modulos/Rutas.md`,
  `00-Inicio/Estado del proyecto.md`, `40-Equipo/Bitácora/2026-11-10.md` (o la del día en que se termine)

- [ ] **Paso 1: Actualizar `CLAUDE.md` y el vault** con lo de arriba (sin duplicar el spec: enlazarlo).
- [ ] **Paso 2: Escribir la nota para Mario** (texto para el PR) con la lista del spec §9: copiar los tipos nuevos a
  `apps/tablet/src/sincronizacion/contrato.ts`, mostrar notas asignadas y recado, cobrar solo asignadas, vehículo
  sugerido, kilometraje ≥ último del vehículo, tickets LIQUIDADA/ABONADO con firma al abonar.
- [ ] **Paso 3: Verificación final**
  Run: `npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend && npm test
  --workspace=apps/backend && npm run test:e2e --workspace=apps/backend && NODE_OPTIONS=--no-experimental-webstorage npm
  test --workspace=apps/portal && npm run lint --workspace=apps/portal`
  Expected: todo PASS.
- [ ] **Paso 4: Commit** — `git commit -m "Ruta semanal y diaria: documentación y nota para Mario"`

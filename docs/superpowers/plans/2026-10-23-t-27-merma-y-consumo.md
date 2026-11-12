# T-27 pieza 2 · Merma y consumo en la tablet — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la tablet registre las piezas que salen o entran a la camioneta por razones distintas a la venta —la
**merma del cliente** (lo dañado que devuelve y lo que se le repone), la **merma del trayecto** y el **consumo
propio**—, que las suba en el push como una sola operación `movimiento` que el servidor proyecta a
`movimiento_inventario`, que el consumo respete un límite diario configurable por sucursal (*Catálogo › Sucursales*) y
que, con el control de inventario prendido, lo que saca piezas buenas no deje ninguna presentación en negativo ni se
grabe con una carga pendiente. Inventario muestra las columnas nuevas y "Por regresar a la planta".

**Architecture:** servidor: migración `20261025120000_movimiento_inventario.sql` (`sucursal.consumo_diario_max`,
`movimiento_inventario`, `movimiento_inventario_linea`); en `modules/inventario/` la forma pura de `datos`
(`datos-movimiento.ts`), la razón de rechazo (`movimiento-rechazado.ts`), el repositorio y `MovimientosService`
(exportado por `InventarioModule`), que proyecta dentro de la transacción de la operación (ADR-0009). `sincronizacion/`
solo despacha: `despacho-movimiento.ts` revisa el sobre (folio, clave uuid, `cliente_id` según el tipo) y
`SincronizacionService.proyectar` llama a `MovimientosService.registrarMovimiento`; el código nuevo es
`movimiento-id-ocupado`. `VendedorPull.consumo_diario_max` sale de la sucursal y cambiarlo toca `vendedor.updated_at`
(mismo mecanismo que `control_inventario`). Portal: campo "Consumo propio máximo por día" en el formulario de la
sucursal (validación pura en `components/sucursales/consumo-diario.ts`). Tablet: migración local 018 (`movimiento`,
`movimiento_linea`, `vendedor.consumo_diario_max`), mezcla del pull, reglas puras (`inventario-reglas.ts` incorpora los
movimientos; `movimientos-reglas.ts` con `validarMovimiento`, `consumoRestante`, `motivoDeConsumo`),
`movimientos.registrar()` que valida forma, límite, bloqueo y faltantes **dentro de su transacción**, la fuente
`fuenteMovimientos` (entre gastos y rutas) y las pantallas: ficha → "Merma", menú → "Merma y consumo" (+ captura),
Inventario extendido y "Movimientos de hoy" en la ficha. `ventas.registrar()` también resta los movimientos.

**Tech Stack:** NestJS 11 + Kysely (backend), Postgres local vía Supabase (e2e, pgTAP), Next.js 15 + Vitest +
Testing Library (portal), Expo SDK 57 / React Native 0.86 + SQLite + Jest en Node (tablet; sin pruebas de pantalla).

**Spec:** `docs/superpowers/specs/2026-10-23-t-27-merma-y-consumo-design.md` — léelo antes de empezar. Sus decisiones
D1…D7 **no se renegocian**. Si este plan lo contradice, manda el spec: para y pregunta (ver "Conflictos para el
controlador" al final, donde están las que este plan tuvo que interpretar).

---

## Global Constraints

Copiadas del spec y del repo. Cada tarea las incluye:

- Rama `feature/t-27-movimientos`. Todos los comandos **desde la raíz del worktree**
  (`/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-t27m`), con los scripts del workspace
  (`--workspace=apps/...`). **Nunca** entres a `../proyecto-sinmex` (clon de demo) ni a otro clon.
- El worktree **no tiene `node_modules`**: corre `npm install` desde la raíz antes de la primera tarea. No se agrega
  ninguna dependencia nueva (ni backend, ni portal, ni tablet: **no hace falta un APK nuevo**).
- **`CONTRATO_ACTUAL` sigue en 1.** El tipo `movimiento`, el código `movimiento-id-ocupado` y
  `VendedorPull.consumo_diario_max` son **aditivos**. Una app vieja no manda movimientos; un servidor viejo responde
  `tipo-desconocido` por operación.
- **Los tipos del contrato están duplicados**: `apps/backend/src/modules/sincronizacion/contrato.ts` (normativo) y
  `apps/tablet/src/sincronizacion/contrato.ts` (en la tablet lo nuevo del pull es **opcional**, regla §3). Si una tarea
  toca uno, toca el otro **y** `docs/contrato-sincronizacion.md` **en el mismo commit** (Tarea 2).
- El tipo `merma` del contrato **se queda reservado** (sin proyección, como `ruta`): no se borra ni se reutiliza
  (Conflicto 1).
- Base de datos: **nunca `db reset`**. Migraciones locales solo con `npm run supabase -- migration up --local` (con el
  `--`). Supabase local es **compartido entre sesiones**. **Nunca apuntes nada a la nube** (`sinmex dev`): `.env.test`
  va a `127.0.0.1:54322`; no se corre `db push` ni nada con `--db-url`. La migración del servidor es
  `supabase/migrations/20261025120000_movimiento_inventario.sql` (timestamp verificado libre al escribir el plan: la
  última es `20261024120000_retorno.sql`; antes de crearla vuelve a mirar `ls supabase/migrations`).
- `movimiento_inventario` lleva el trigger `before update … execute function set_updated_at()`
  (`trg_movimiento_inventario_updated`). Las líneas no tienen `updated_at` (un movimiento no se edita, D6). Sin RLS: el
  alcance lo pone el backend. Sin permisos nuevos.
- pgTAP: `npm run supabase -- test db --local` (CI no lo corre: lo corre el implementador).
- Backend: lint **solo por archivo**: `npm exec --workspace=apps/backend -- prettier --write <archivos>` y
  `npm exec --workspace=apps/backend -- eslint <archivos>`. **Nunca** `npm run lint --workspace=apps/backend` (lleva
  `--fix` y reescribe archivos ajenos). Typecheck del backend = `npm run build --workspace=apps/backend`. Pruebas:
  `npm test --workspace=apps/backend -- <patrón>` y `npm run test:e2e --workspace=apps/backend -- <patrón>`.
- Los e2e **siembran lo que usan** con sufijo `${Date.now()}-${process.pid}` y lo borran en `afterAll` en orden
  inverso a las llaves foráneas. La suite de movimientos usa la sucursal propia **`ZM`** (libre al escribir el plan:
  las suites usan ZA–ZH, ZK, ZN, ZQ, ZV, ZZ) y fechas de **2018-05** para no cruzarse con nadie.
- Portal: `npm test --workspace=apps/portal -- <patrón>`, `npx tsc --noEmit -p apps/portal`,
  `npm run lint --workspace=apps/portal`. Tiene que caber en una ventana de **1366 px**. Reglas del CLAUDE.md "Portal UI
  (piezas comunes)": se usan `apps/portal/src/components/ui/` (`Campo`, `Entrada`…), la pantalla sigue en
  `PantallaCatalogo` (el formulario corto va en su `Ventana`), nada de `window.confirm` (`useConfirmar`).
- Tablet: `npm run typecheck --workspace=apps/tablet`, `npm run lint --workspace=apps/tablet`,
  `npm test --workspace=apps/tablet -- <patrón>`. Las pruebas son **solo** `src/**/*.spec.ts` en Node: nada de
  pantallas ni de `react-native`/`expo-*` en un `.spec.ts`. **La lógica de la tablet vive en funciones puras con
  pruebas de Jest**; la pantalla solo la llama. Registrar un movimiento lleva **guardia contra el doble toque**
  (`crearGuardiaRegistro`, guardada en un `useState(() => …)` que vive lo que la pantalla).
- `src/datos/` **no importa de** `src/estado/`: lo que el repositorio necesita vive en `src/datos/inventario-reglas.ts`
  y `src/datos/movimientos-reglas.ts`; `src/estado/movimiento.ts` e `inventario.ts` lo reexportan.
- Migraciones locales de la tablet: **nunca se edita una publicada** (001…017); la nueva es la **018**. (La prueba de
  la 017 que dice "es la última" se actualiza, como hizo la 016 con la 017.)
- **Lección de T-73: nunca re-renderizar la pantalla a medio gesto.** Las pantallas nuevas no cambian props de la
  `Pantalla` mientras el vendedor captura; lo que dependa de la captura ("Te quedan N") se pinta dentro de cada tarjeta,
  como en la venta. La red definitiva es el repositorio al grabar.
- **La aceptación en la pantalla real es obligatoria**: la Tarea 5 termina con la prueba del controlador en el
  emulador y la Tarea 3 en el navegador a 1366 px. Una tarea de pantalla no está terminada hasta que el controlador la
  vio funcionar.
- Código en español, **identificadores sin acentos**, **textos al usuario en español con acentos** ("Recibí dañado",
  "Le entregué", "Ya registraste tu consumo de hoy", "Consumo propio máximo por día"). Comentarios que explican *por
  qué*; sigue el estilo del archivo que tocas.
- **Nunca `git add -f`** de nada bajo `.superpowers/` (ni de ningún archivo ignorado). `git status` limpio al terminar
  cada tarea; un commit por tarea (o más si el implementador lo prefiere). Los mensajes llevan **`Refs #27`** (nunca
  `Closes`: el ticket tiene pieza 3) y el trailer exacto como **última línea**:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Si `expo` ensucia `apps/tablet/package.json`, `apps/tablet/tsconfig.json` o `app.json` con cambios que no son de la
  tarea, se revierte con `git checkout -- <archivo>` antes del commit.

## Review Focus

Los cinco puntos del spec; cada uno se pinó en la tarea dueña:

1. **Consumo al límite: con límite 1 y 1 ya registrada, el siguiente consumo no se graba ("Ya registraste tu consumo
   de hoy"); con límite 0 no se ofrece.** Tarea 4, `movimientos-reglas.spec.ts` → "Review Focus 1: motivoDeConsumo al
   límite y con límite 0" y `movimientos.spec.ts` → "Review Focus 1: con límite 1 y 1 registrada, el siguiente consumo
   no se graba" / "Review Focus 1: con límite 0 no se graba consumo" (calculado dentro de `enTransaccion`). Tarea 5,
   `movimiento.spec.ts` → "Review Focus 1: con límite 0 no se ofrece consumo; agotado, la captura no queda lista".
2. **Reposición que deja negativo con el control prendido: no se graba y dice la presentación y cuántas faltan; con el
   control apagado sí se graba.** Tarea 4, `movimientos.spec.ts` → "Review Focus 2: con el control prendido una
   reposición que deja negativo no se graba y dice cuántas faltan" y "Review Focus 2: con el control apagado la misma
   reposición sí se graba"; `inventario-reglas.spec.ts` → `faltantesDeMovimiento`.
3. **Merma del cliente solo con "Le entregué": no se graba (falta lo recibido).** Tarea 4, `movimientos-reglas.spec.ts`
   → "Review Focus 3: merma del cliente sin lo recibido" y `movimientos.spec.ts` → "Review Focus 3: merma del cliente
   solo con Le entregué no se graba"; Tarea 2 (la misma regla en el servidor), `datos-movimiento.spec.ts` → "Review
   Focus 3: una merma del cliente sin línea recibido es inválida".
4. **Movimiento a un prospecto recién capturado en la misma sincronización: no se pierde; sube en el lote
   siguiente.** Tarea 2, `movimiento.e2e-spec.ts` → "Review Focus 4: alta y merma en el MISMO lote: la merma cae por
   alcance y entra en el siguiente"; Tarea 4, `fuentes.spec.ts` (movimientos suben después de prospectos) y
   `fuente-movimientos.spec.ts` → "Review Focus 4: un rechazo por alcance se queda en la cola con la misma clave".
5. **Cambio del límite en el portal: baja a la tablet en el siguiente pull aunque el vendedor no haya cambiado.**
   Tarea 2, `movimiento.e2e-spec.ts` → "Review Focus 5: cambiar el límite en el portal baja en el pull incremental";
   Tarea 4, `movimientos.spec.ts` → "Review Focus 5: consumo_diario_max baja en el pull y un login sin red no lo pisa".

---

### Tarea 1: Migración del servidor: `sucursal.consumo_diario_max`, `movimiento_inventario` y sus líneas (servidor del spec, D4, D7)

**Files:**
- Create: `supabase/migrations/20261025120000_movimiento_inventario.sql`
- Test: `supabase/tests/99_movimiento_inventario_test.sql`
- Modify: `apps/backend/src/database/schema.d.ts` (regenerado con `db:types`)

**Interfaces:**
- Consumes: `sucursal`, `vendedor`, `cliente`, `presentacion` y la función `set_updated_at()` (todas existentes).
- Produces (lo que leen las Tareas 2 y, en la pieza 3, el corte):
  - `sucursal.consumo_diario_max smallint not null default 1 check (0..99)`.
  - `movimiento_inventario (id uuid pk sin default, sucursal_id, vendedor_id, cliente_id null, tipo text in
    (merma_cliente|merma_trayecto|consumo), fecha date, comentario text 1..300 null, registrado_en timestamptz,
    created_at, updated_at, deleted_at)` con `ck_movimiento_cliente` (`merma_cliente` ⇔ cliente),
    `idx_movimiento_vendedor_fecha` (parcial, vivos) y `trg_movimiento_inventario_updated`.
  - `movimiento_inventario_linea (id uuid default, movimiento_id, presentacion_id, sentido in (recibido|entregado),
    piezas > 0)` con `uq_movimiento_linea (movimiento_id, presentacion_id, sentido)`.
  - En `schema.d.ts`: `Sucursal.consumo_diario_max: Generated<number>`, `interface MovimientoInventario`,
    `interface MovimientoInventarioLinea`, `DB.movimiento_inventario`, `DB.movimiento_inventario_linea`.

- [ ] **Paso 1: la prueba pgTAP, que falla**

`supabase/tests/99_movimiento_inventario_test.sql`:

```sql
begin;
select plan(23);

-- T-27 pieza 2: lo que la BASE garantiza de los movimientos de inventario (merma
-- del cliente, merma del trayecto, consumo) aunque alguien escriba por debajo del
-- servicio. Prefijo `zz-pgtap-t27m`. Todo se va con el rollback.

select has_table('movimiento_inventario', 'existe la tabla de movimientos de inventario');
select has_table('movimiento_inventario_linea', 'existen las lineas de los movimientos');

select has_column('sucursal', 'consumo_diario_max',
  'la sucursal dice cuanto consumo propio puede registrar cada vendedor al dia (D4)');
select col_not_null('sucursal', 'consumo_diario_max', 'el limite nunca es nulo');
select col_default_is('sucursal', 'consumo_diario_max', '1', 'una pieza por dia por defecto (D4)');

select has_index('movimiento_inventario', 'idx_movimiento_vendedor_fecha',
  'el corte lee por vendedor y fecha');
select has_trigger('movimiento_inventario', 'trg_movimiento_inventario_updated',
  'el movimiento mueve updated_at al editarse (correccion de la oficina, T-35)');

select throws_ok(
  $$update sucursal set consumo_diario_max = -1 where codigo = 'TJ'$$,
  '23514', null, 'el limite no es negativo');
select throws_ok(
  $$update sucursal set consumo_diario_max = 100 where codigo = 'TJ'$$,
  '23514', null, 'el limite no pasa de 99');
select lives_ok(
  $$update sucursal set consumo_diario_max = 0 where codigo = 'TJ'$$,
  'un limite de 0 apaga el consumo propio');

-- Fixtures: un vendedor y un cliente de TJ, un producto con una presentacion.
insert into vendedor (login, nombre, password_hash, sucursal_id)
  values ('zz-pgtap-t27m', 'Vendedor pgTAP T27m', 'x', (select id from sucursal where codigo = 'TJ'));
insert into cliente (nombre, telefono, tipo, sucursal_id)
  values ('ZZ-pgtap-T27m Cliente', '6640000000', 'prospecto', (select id from sucursal where codigo = 'TJ'));
insert into producto (nombre) values ('zz-pgtap-t27m Horchata');
insert into presentacion (producto_id, volumen)
  select id, '1 L' from producto where nombre = 'zz-pgtap-t27m Horchata';

create temporary table _t27m on commit drop as
select
  (select id from vendedor where login = 'zz-pgtap-t27m') as vendedor,
  (select id from sucursal where codigo = 'TJ') as sucursal,
  (select id from cliente where nombre = 'ZZ-pgtap-T27m Cliente') as cliente,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'zz-pgtap-t27m Horchata' and pr.volumen = '1 L') as litro;

select lives_ok(
  $$insert into movimiento_inventario (id, sucursal_id, vendedor_id, cliente_id, tipo, fecha, registrado_en)
    select 'c0ffee00-0000-4000-8000-000000002701', sucursal, vendedor, cliente, 'merma_cliente',
           date '2026-10-23', now() from _t27m$$,
  'una merma del cliente entra con su cliente');

select throws_ok(
  $$insert into movimiento_inventario (id, sucursal_id, vendedor_id, tipo, fecha, registrado_en)
    select 'c0ffee00-0000-4000-8000-000000002702', sucursal, vendedor, 'merma_cliente',
           date '2026-10-23', now() from _t27m$$,
  '23514', null, 'una merma del cliente sin cliente no entra (ck_movimiento_cliente)');

select throws_ok(
  $$insert into movimiento_inventario (id, sucursal_id, vendedor_id, cliente_id, tipo, fecha, registrado_en)
    select 'c0ffee00-0000-4000-8000-000000002703', sucursal, vendedor, cliente, 'merma_trayecto',
           date '2026-10-23', now() from _t27m$$,
  '23514', null, 'la merma del trayecto no lleva cliente (ck_movimiento_cliente)');

select lives_ok(
  $$insert into movimiento_inventario (id, sucursal_id, vendedor_id, tipo, fecha, registrado_en)
    select 'c0ffee00-0000-4000-8000-000000002704', sucursal, vendedor, 'consumo',
           date '2026-10-23', now() from _t27m$$,
  'el consumo entra sin cliente');

select throws_ok(
  $$insert into movimiento_inventario (id, sucursal_id, vendedor_id, tipo, fecha, registrado_en)
    select 'c0ffee00-0000-4000-8000-000000002705', sucursal, vendedor, 'cambio',
           date '2026-10-23', now() from _t27m$$,
  '23514', null, 'el tipo es uno de los tres (los cambios fisicos quedaron fuera)');

select throws_ok(
  $$insert into movimiento_inventario (id, sucursal_id, vendedor_id, tipo, fecha, registrado_en, comentario)
    select 'c0ffee00-0000-4000-8000-000000002706', sucursal, vendedor, 'consumo',
           date '2026-10-23', now(), '' from _t27m$$,
  '23514', null, 'un comentario vacio es null, no cadena vacia');

select throws_ok(
  $$insert into movimiento_inventario (id, sucursal_id, vendedor_id, tipo, fecha, registrado_en, comentario)
    select 'c0ffee00-0000-4000-8000-000000002707', sucursal, vendedor, 'consumo',
           date '2026-10-23', now(), repeat('x', 301) from _t27m$$,
  '23514', null, 'el comentario no pasa de 300 caracteres');

select lives_ok(
  $$insert into movimiento_inventario_linea (movimiento_id, presentacion_id, sentido, piezas)
    select 'c0ffee00-0000-4000-8000-000000002701', litro, 'recibido', 3 from _t27m$$,
  'una linea recibida (lo danado que devuelve el cliente) entra');

select lives_ok(
  $$insert into movimiento_inventario_linea (movimiento_id, presentacion_id, sentido, piezas)
    select 'c0ffee00-0000-4000-8000-000000002701', litro, 'entregado', 2 from _t27m$$,
  'la misma presentacion puede ir entregada (la reposicion)');

select throws_ok(
  $$insert into movimiento_inventario_linea (movimiento_id, presentacion_id, sentido, piezas)
    select 'c0ffee00-0000-4000-8000-000000002704', litro, 'perdido', 1 from _t27m$$,
  '23514', null, 'el sentido es recibido o entregado');

select throws_ok(
  $$insert into movimiento_inventario_linea (movimiento_id, presentacion_id, sentido, piezas)
    select 'c0ffee00-0000-4000-8000-000000002704', litro, 'entregado', 0 from _t27m$$,
  '23514', null, 'las piezas son mayores que cero');

select throws_ok(
  $$insert into movimiento_inventario_linea (movimiento_id, presentacion_id, sentido, piezas)
    select 'c0ffee00-0000-4000-8000-000000002701', litro, 'recibido', 1 from _t27m$$,
  '23505', null, 'una presentacion una sola vez por sentido (uq_movimiento_linea)');

-- El trigger: con created_at/updated_at viejos a mano, un update mueve updated_at a now().
insert into movimiento_inventario (id, sucursal_id, vendedor_id, tipo, fecha, registrado_en, created_at, updated_at)
  select 'c0ffee00-0000-4000-8000-000000002708', sucursal, vendedor, 'merma_trayecto', date '2026-10-23',
         now(), timestamptz '2020-01-01', timestamptz '2020-01-01' from _t27m;
update movimiento_inventario set comentario = 'Corregido por la oficina'
  where id = 'c0ffee00-0000-4000-8000-000000002708';

select ok(
  (select updated_at > timestamptz '2020-01-01' from movimiento_inventario
    where id = 'c0ffee00-0000-4000-8000-000000002708'),
  'editar el movimiento le toca updated_at');

select * from finish();
rollback;
```

- [ ] **Paso 2: correr y ver fallar**

```bash
npm run supabase -- test db --local
```

Esperado: `99_movimiento_inventario_test.sql` falla en `has_table('movimiento_inventario', …)` (y las siguientes); las
demás suites siguen verdes.

- [ ] **Paso 3: la migración**

`supabase/migrations/20261025120000_movimiento_inventario.sql`:

```sql
-- T-27 pieza 2: merma y consumo en la tablet.
-- Spec: docs/superpowers/specs/2026-10-23-t-27-merma-y-consumo-design.md
--
-- Una columna con default y dos tablas nuevas y vacias: no hay filas que violen
-- nada, asi que el pre-flight contra la nube no tiene nada que contar.
--
-- * `sucursal.consumo_diario_max` (D4): piezas de consumo propio que cada
--   vendedor puede registrar en un dia; 1 por defecto, 0 lo apaga. Lo exige la
--   TABLET (el servidor no lo revisa: las piezas ya salieron). Cambiarlo toca
--   `vendedor.updated_at` de esa sucursal (lo hace el backend) para que el pull
--   incremental lo baje.
-- * `movimiento_inventario` (D7): una sola tabla para los tres tipos. `id` ES la
--   clave de la operacion del push (como visita y gasto), sin default. `fecha` es
--   la `fecha_operacion` del sobre, nunca re-derivada. Solo la merma del cliente
--   lleva cliente (`ck_movimiento_cliente`). No se edita en la app (D6); la
--   correccion sera de la oficina (T-35), por eso lleva updated_at y deleted_at.
-- * `movimiento_inventario_linea`: piezas por presentacion y sentido. `recibido`
--   = lo danado que devuelve el cliente (entra a la camioneta como merma);
--   `entregado` = sale de la camioneta (reposicion, merma del trayecto, consumo).

alter table sucursal add column consumo_diario_max smallint not null default 1
  check (consumo_diario_max >= 0 and consumo_diario_max <= 99);

create table movimiento_inventario (
  id            uuid primary key,
  sucursal_id   uuid not null references sucursal(id),
  vendedor_id   uuid not null references vendedor(id),
  cliente_id    uuid references cliente(id),
  tipo          text not null check (tipo in ('merma_cliente', 'merma_trayecto', 'consumo')),
  fecha         date not null,
  comentario    text check (comentario is null or char_length(comentario) between 1 and 300),
  registrado_en timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint ck_movimiento_cliente check ((tipo = 'merma_cliente') = (cliente_id is not null))
);

-- El corte de la pieza 3: los movimientos vivos del vendedor en un dia.
create index idx_movimiento_vendedor_fecha on movimiento_inventario (vendedor_id, fecha)
  where deleted_at is null;

create trigger trg_movimiento_inventario_updated before update on movimiento_inventario
  for each row execute function set_updated_at();

create table movimiento_inventario_linea (
  id              uuid primary key default gen_random_uuid(),
  movimiento_id   uuid not null references movimiento_inventario(id),
  presentacion_id uuid not null references presentacion(id),
  sentido         text not null check (sentido in ('recibido', 'entregado')),
  piezas          integer not null check (piezas > 0),
  constraint uq_movimiento_linea unique (movimiento_id, presentacion_id, sentido)
);
```

- [ ] **Paso 4: aplicarla al Postgres local y ver pasar**

```bash
ls supabase/migrations | tail -3
npm run supabase -- migration up --local
npm run supabase -- test db --local
```

Esperado: `migration up` aplica solo `20261025120000_movimiento_inventario.sql`; pgTAP todo verde,
`99_movimiento_inventario_test.sql` con 23/23. (Si `migration up` quiere aplicar otra migración de una rama ajena en el
Supabase compartido, para y avisa: nunca `db reset`.)

- [ ] **Paso 5: tipos de la base**

```bash
npm run db:types --workspace=apps/backend
git diff --stat apps/backend/src/database/schema.d.ts
```

El diff debe contener **solo** esto (orden alfabético de kysely-codegen):

```ts
export interface MovimientoInventario {
  cliente_id: string | null;
  comentario: string | null;
  created_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
  fecha: Timestamp;
  id: string;
  registrado_en: Timestamp;
  sucursal_id: string;
  tipo: string;
  updated_at: Generated<Timestamp>;
  vendedor_id: string;
}

export interface MovimientoInventarioLinea {
  id: Generated<string>;
  movimiento_id: string;
  piezas: number;
  presentacion_id: string;
  sentido: string;
}
```

más `consumo_diario_max: Generated<number>;` en `Sucursal` y `movimiento_inventario: MovimientoInventario;` /
`movimiento_inventario_linea: MovimientoInventarioLinea;` en `DB`. Si aparece algo más (migraciones de otra rama
aplicadas en el Supabase compartido), quédate solo con estas líneas (`git checkout -p`) y anótalo en el reporte.

- [ ] **Paso 6: build y commit**

```bash
npm run build --workspace=apps/backend
git add supabase/migrations/20261025120000_movimiento_inventario.sql supabase/tests/99_movimiento_inventario_test.sql apps/backend/src/database/schema.d.ts
git commit -m "T-27: migración de los movimientos de inventario y el consumo diario de la sucursal

Refs #27

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 2: Backend: operación `movimiento` en el push y `consumo_diario_max` de la sucursal (servidor y contrato del spec, D4, D7)

**Files:**
- Create: `apps/backend/src/modules/inventario/datos-movimiento.ts`
- Create: `apps/backend/src/modules/inventario/datos-movimiento.spec.ts`
- Create: `apps/backend/src/modules/inventario/movimiento-rechazado.ts`
- Create: `apps/backend/src/modules/inventario/movimientos.repository.ts`
- Create: `apps/backend/src/modules/inventario/movimientos.service.ts`
- Create: `apps/backend/src/modules/inventario/movimientos.service.spec.ts`
- Modify: `apps/backend/src/modules/inventario/inventario.module.ts`
- Create: `apps/backend/src/modules/sincronizacion/despacho-movimiento.ts`
- Create: `apps/backend/src/modules/sincronizacion/despacho-movimiento.spec.ts`
- Modify: `apps/backend/src/modules/sincronizacion/despacho.ts`, `despacho.spec.ts`
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`, `sincronizacion.module.ts`,
  `sincronizacion.repository.ts`
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts` **y** `apps/tablet/src/sincronizacion/contrato.ts`
  **y** `docs/contrato-sincronizacion.md` (mismo commit)
- Modify: `apps/backend/src/modules/sucursales/dto/editar-sucursal.dto.ts`, `sucursales.repository.ts`,
  `sucursales.service.ts`
- Test: `apps/backend/test/movimiento.e2e-spec.ts`

**Interfaces:**
- Consumes: las tablas de la Tarea 1; `RE_UUID` (`modules/rutas/datos-visita.ts`), `esInstante`
  (`modules/rutas/datos-jornada.ts`); `OperacionNormalizada`/`Rechazo` (`sincronizacion/operaciones.ts`).
- Produces:
  - `normalizarDatosMovimiento(datos: Record<string, unknown>): ResultadoDatosMovimiento` con
    `MovimientoNormalizado { tipo: TipoMovimiento; comentario: string | null; registradoEn: string; lineas:
    LineaMovimientoNormalizada[] }` y `LineaMovimientoNormalizada { presentacionId: string; sentido: SentidoMovimiento;
    piezas: number }`; constantes `MAX_PIEZAS_MOVIMIENTO = 99_999`, `MAX_LINEAS_MOVIMIENTO = 200`,
    `LARGO_MAX_COMENTARIO_MOVIMIENTO = 300`.
  - `prepararMovimiento(op: OperacionNormalizada): PreparacionMovimiento` y `CODIGO_POR_RAZON_MOVIMIENTO`.
  - `MovimientosService.registrarMovimiento(m: MovimientoNormalizado, c: ContextoMovimiento, trx):
    Promise<{ tabla: 'movimiento_inventario'; id: string }>`; `ContextoMovimiento { id; sucursalId; vendedorId;
    clienteId: string | null; fechaOperacion }`. Lanza `MovimientoRechazado` (`presentacion-inexistente` →
    `datos-invalidos`, `movimiento-id-ocupado`).
  - Contrato: `TIPOS_OPERACION` + `'movimiento'`; `CODIGOS_RECHAZO` + `'movimiento-id-ocupado'`;
    `type DatosMovimiento`; `VendedorPull.consumo_diario_max: number` (en la tablet `?: number`).
  - API del portal: `PATCH /sucursales/:id` acepta `consumoDiarioMax` (entero 0–99) y la respuesta lleva
    `consumoDiarioMax`; si la petición lo trae se toca `vendedor.updated_at` de la sucursal.

- [ ] **Paso 1: la forma de `datos`, prueba que falla**

`apps/backend/src/modules/inventario/datos-movimiento.spec.ts`:

```ts
import {
  MAX_LINEAS_MOVIMIENTO,
  normalizarDatosMovimiento,
} from './datos-movimiento';

const LITRO = '5f3c1a2b-7d8e-4f90-a1b2-c3d4e5f60718';
const MEDIO = '6a4d2b3c-8e9f-4a01-b2c3-d4e5f6071829';

const datos = (extra: Record<string, unknown> = {}) => ({
  tipo: 'merma_cliente',
  comentario: null,
  registrado_en: '2026-10-23T18:40:00.000Z',
  lineas: [
    { presentacion_id: LITRO, sentido: 'recibido', piezas: 3 },
    { presentacion_id: MEDIO, sentido: 'entregado', piezas: 2 },
  ],
  ...extra,
});

describe('normalizarDatosMovimiento (T-27 pieza 2)', () => {
  it('una merma del cliente valida sale normalizada', () => {
    expect(
      normalizarDatosMovimiento(
        datos({
          comentario: '  Venían reventadas  ',
          registrado_en: '2026-10-23T11:40:00-07:00',
          lineas: [
            { presentacion_id: LITRO.toUpperCase(), sentido: 'recibido', piezas: 3 },
          ],
        }),
      ),
    ).toEqual({
      ok: true,
      movimiento: {
        tipo: 'merma_cliente',
        comentario: 'Venían reventadas',
        registradoEn: '2026-10-23T18:40:00.000Z',
        lineas: [{ presentacionId: LITRO, sentido: 'recibido', piezas: 3 }],
      },
    });
  });

  it('la merma del trayecto y el consumo llevan solo lineas entregado', () => {
    for (const tipo of ['merma_trayecto', 'consumo']) {
      expect(
        normalizarDatosMovimiento(
          datos({
            tipo,
            lineas: [{ presentacion_id: LITRO, sentido: 'entregado', piezas: 1 }],
          }),
        ),
      ).toMatchObject({ ok: true, movimiento: { tipo } });
    }
  });

  it('un comentario vacio o ausente es null', () => {
    expect(normalizarDatosMovimiento(datos({ comentario: '   ' }))).toMatchObject({
      ok: true,
      movimiento: { comentario: null },
    });
    const { comentario: _c, ...sin } = datos();
    void _c;
    expect(normalizarDatosMovimiento(sin)).toMatchObject({
      ok: true,
      movimiento: { comentario: null },
    });
  });

  it('Review Focus 3: una merma del cliente sin linea recibido es invalida', () => {
    const r = normalizarDatosMovimiento(
      datos({
        lineas: [{ presentacion_id: MEDIO, sentido: 'entregado', piezas: 2 }],
      }),
    );
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.motivo).toMatch(/^lineas: .*recibido/);
  });

  it.each([
    [{ tipo: 'cambio' }, /^tipo: /],
    [{ tipo: undefined }, /^tipo: /],
    [{ registrado_en: '2026-10-23' }, /^registrado_en: /],
    [{ comentario: 5 }, /^comentario: /],
    [{ comentario: 'x'.repeat(301) }, /^comentario: .*300/],
    [{ lineas: [] }, /^lineas: /],
    [{ lineas: 'muchas' }, /^lineas: /],
    [
      {
        lineas: Array.from({ length: MAX_LINEAS_MOVIMIENTO + 1 }, () => ({
          presentacion_id: LITRO,
          sentido: 'recibido',
          piezas: 1,
        })),
      },
      /^lineas: /,
    ],
    [{ lineas: [7] }, /^lineas\[0\]: /],
    [
      { lineas: [{ presentacion_id: 'abc', sentido: 'recibido', piezas: 1 }] },
      /^lineas\[0\]\.presentacion_id: /,
    ],
    [
      { lineas: [{ presentacion_id: LITRO, sentido: 'perdido', piezas: 1 }] },
      /^lineas\[0\]\.sentido: /,
    ],
    [
      { lineas: [{ presentacion_id: LITRO, sentido: 'recibido', piezas: 0 }] },
      /^lineas\[0\]\.piezas: /,
    ],
    [
      { lineas: [{ presentacion_id: LITRO, sentido: 'recibido', piezas: 100_000 }] },
      /^lineas\[0\]\.piezas: /,
    ],
    [
      { lineas: [{ presentacion_id: LITRO, sentido: 'recibido', piezas: 1.5 }] },
      /^lineas\[0\]\.piezas: /,
    ],
    [
      {
        lineas: [
          { presentacion_id: LITRO, sentido: 'recibido', piezas: 1 },
          { presentacion_id: LITRO.toUpperCase(), sentido: 'recibido', piezas: 2 },
        ],
      },
      /^lineas\[1\]\.presentacion_id: /,
    ],
    [
      {
        tipo: 'consumo',
        lineas: [{ presentacion_id: LITRO, sentido: 'recibido', piezas: 1 }],
      },
      /^lineas\[0\]\.sentido: .*entregado/,
    ],
  ])('%j es invalido con un motivo que nombra el campo', (extra, motivo) => {
    const r = normalizarDatosMovimiento(datos(extra));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.motivo).toMatch(motivo);
  });

  it('la misma presentacion recibida y entregada si se puede (la reposicion)', () => {
    expect(
      normalizarDatosMovimiento(
        datos({
          lineas: [
            { presentacion_id: LITRO, sentido: 'recibido', piezas: 3 },
            { presentacion_id: LITRO, sentido: 'entregado', piezas: 3 },
          ],
        }),
      ),
    ).toMatchObject({ ok: true });
  });
});
```

- [ ] **Paso 2: correr y ver fallar**

```bash
npm test --workspace=apps/backend -- datos-movimiento
```

Esperado: falla al compilar (`Cannot find module './datos-movimiento'`).

- [ ] **Paso 3: la forma de `datos`**

`apps/backend/src/modules/inventario/datos-movimiento.ts`:

```ts
import { esInstante } from '../rutas/datos-jornada';
import { RE_UUID } from '../rutas/datos-visita';

/**
 * Validacion y normalizacion de `datos` de un movimiento de inventario (T-27
 * pieza 2): la merma del cliente, la merma del trayecto y el consumo propio.
 *
 * Pura, sin base: decide la FORMA. Que las presentaciones existan y que el id
 * este libre lo decide `MovimientosService` dentro de la transaccion; el
 * `cliente_id` va en el sobre y lo revisa `despacho-movimiento.ts`. Comprueba lo
 * que haria reventar a Postgres (un uuid mal formado, unas piezas que no caben,
 * una linea repetida que choca con `uq_movimiento_linea`): un 500 tumba el lote
 * y la tablet reintentaria para siempre.
 *
 * **No** revisa el limite de consumo ni la existencia (D4, D5): las piezas ya
 * salieron de la camioneta; eso lo exige la tablet.
 */

export const TIPOS_MOVIMIENTO = [
  'merma_cliente',
  'merma_trayecto',
  'consumo',
] as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

/** `recibido` = entra a la camioneta (merma del cliente); `entregado` = sale. */
export const SENTIDOS_MOVIMIENTO = ['recibido', 'entregado'] as const;
export type SentidoMovimiento = (typeof SENTIDOS_MOVIMIENTO)[number];

export const MAX_PIEZAS_MOVIMIENTO = 99_999;
/** Holgado: una linea por presentacion y sentido; el catalogo tiene decenas. */
export const MAX_LINEAS_MOVIMIENTO = 200;
export const LARGO_MAX_COMENTARIO_MOVIMIENTO = 300;

export interface LineaMovimientoNormalizada {
  /** uuid en minusculas. */
  presentacionId: string;
  sentido: SentidoMovimiento;
  piezas: number;
}

/** El movimiento ya validado. Id, vendedor, sucursal, cliente y fecha viajan en el contexto. */
export interface MovimientoNormalizado {
  tipo: TipoMovimiento;
  comentario: string | null;
  /** ISO-8601 en UTC (`toISOString`). */
  registradoEn: string;
  lineas: LineaMovimientoNormalizada[];
}

export type ResultadoDatosMovimiento =
  | { ok: true; movimiento: MovimientoNormalizado }
  /** El `motivo` empieza por el campo: es lo que guarda la tablet en `sync_error`. */
  | { ok: false; motivo: string };

function esTipo(valor: unknown): valor is TipoMovimiento {
  return (
    typeof valor === 'string' &&
    (TIPOS_MOVIMIENTO as readonly string[]).includes(valor)
  );
}

function esSentido(valor: unknown): valor is SentidoMovimiento {
  return (
    typeof valor === 'string' &&
    (SENTIDOS_MOVIMIENTO as readonly string[]).includes(valor)
  );
}

/** Valida y normaliza `datos` de una operacion `movimiento`. */
export function normalizarDatosMovimiento(
  datos: Record<string, unknown>,
): ResultadoDatosMovimiento {
  const tipo = datos.tipo;
  if (!esTipo(tipo)) {
    return {
      ok: false,
      motivo: 'tipo: tiene que ser merma_cliente, merma_trayecto o consumo.',
    };
  }

  const registradoEn = datos.registrado_en;
  if (!esInstante(registradoEn)) {
    return {
      ok: false,
      motivo:
        'registrado_en: tiene que ser un instante ISO-8601 con zona (por ejemplo 2026-10-23T18:40:00Z).',
    };
  }

  let comentario: string | null = null;
  const crudo = datos.comentario;
  if (crudo !== undefined && crudo !== null) {
    if (typeof crudo !== 'string') {
      return { ok: false, motivo: 'comentario: tiene que ser texto o null.' };
    }
    const limpio = crudo.trim();
    if (limpio.length > LARGO_MAX_COMENTARIO_MOVIMIENTO) {
      return {
        ok: false,
        motivo: `comentario: no puede pasar de ${LARGO_MAX_COMENTARIO_MOVIMIENTO} caracteres.`,
      };
    }
    comentario = limpio === '' ? null : limpio;
  }

  const crudas: unknown = datos.lineas;
  if (
    !Array.isArray(crudas) ||
    crudas.length === 0 ||
    crudas.length > MAX_LINEAS_MOVIMIENTO
  ) {
    return {
      ok: false,
      motivo: `lineas: tiene que ser una lista de 1 a ${MAX_LINEAS_MOVIMIENTO} líneas.`,
    };
  }

  const lista: unknown[] = crudas;
  const lineas: LineaMovimientoNormalizada[] = [];
  const vistas = new Set<string>();
  for (const [i, cruda] of lista.entries()) {
    const campo = `lineas[${i}]`;
    if (typeof cruda !== 'object' || cruda === null || Array.isArray(cruda)) {
      return { ok: false, motivo: `${campo}: tiene que ser un objeto.` };
    }
    const l = cruda as Record<string, unknown>;

    const presentacion = l.presentacion_id;
    if (typeof presentacion !== 'string' || !RE_UUID.test(presentacion)) {
      return {
        ok: false,
        motivo: `${campo}.presentacion_id: tiene que ser el uuid de una presentación.`,
      };
    }
    const sentido = l.sentido;
    if (!esSentido(sentido)) {
      return {
        ok: false,
        motivo: `${campo}.sentido: tiene que ser recibido o entregado.`,
      };
    }
    const piezas = l.piezas;
    if (
      typeof piezas !== 'number' ||
      !Number.isInteger(piezas) ||
      piezas < 1 ||
      piezas > MAX_PIEZAS_MOVIMIENTO
    ) {
      return {
        ok: false,
        motivo: `${campo}.piezas: tiene que ser un entero de 1 a ${MAX_PIEZAS_MOVIMIENTO}.`,
      };
    }

    const presentacionId = presentacion.toLowerCase();
    const llave = `${presentacionId}|${sentido}`;
    if (vistas.has(llave)) {
      // Chocaria con `uq_movimiento_linea` y saldria como 500 para todo el lote.
      return {
        ok: false,
        motivo: `${campo}.presentacion_id: esa presentación ya viene en otra línea ${sentido}.`,
      };
    }
    vistas.add(llave);

    if (tipo !== 'merma_cliente' && sentido === 'recibido') {
      return {
        ok: false,
        motivo: `${campo}.sentido: la merma del trayecto y el consumo solo llevan líneas entregado (piezas que salen de la camioneta).`,
      };
    }
    lineas.push({ presentacionId, sentido, piezas });
  }

  // D2: "Recibí dañado" lleva al menos una pieza; "Le entregué" es opcional.
  if (tipo === 'merma_cliente' && !lineas.some((l) => l.sentido === 'recibido')) {
    return {
      ok: false,
      motivo:
        'lineas: una merma del cliente lleva al menos una línea recibido (lo que el cliente devolvió dañado).',
    };
  }

  return {
    ok: true,
    movimiento: {
      tipo,
      comentario,
      registradoEn: new Date(registradoEn).toISOString(),
      lineas,
    },
  };
}
```

- [ ] **Paso 4: correr y ver pasar**

```bash
npm test --workspace=apps/backend -- datos-movimiento
```

Esperado: verde.

- [ ] **Paso 5: la proyección, prueba que falla**

`apps/backend/src/modules/inventario/movimientos.service.spec.ts`:

```ts
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { MovimientoNormalizado } from './datos-movimiento';
import { MovimientoRechazado } from './movimiento-rechazado';
import {
  MovimientosService,
  type ContextoMovimiento,
} from './movimientos.service';

const trx = {} as Transaction<DB>;

const contexto: ContextoMovimiento = {
  id: 'c0ffee00-0000-4000-8000-000000002700',
  sucursalId: 'sucursal-tj',
  vendedorId: 'vendedor-1',
  clienteId: 'cliente-1',
  fechaOperacion: '2026-10-23',
};

const movimiento: MovimientoNormalizado = {
  tipo: 'merma_cliente',
  comentario: 'Venían reventadas',
  registradoEn: '2026-10-24T01:30:00.000Z',
  lineas: [
    { presentacionId: 'litro', sentido: 'recibido', piezas: 3 },
    { presentacionId: 'medio', sentido: 'entregado', piezas: 2 },
    { presentacionId: 'litro', sentido: 'entregado', piezas: 1 },
  ],
};

function montar(
  opciones: { existentes?: string[]; idInsertado?: string | null } = {},
) {
  const repo = {
    presentacionesExistentes: jest
      .fn()
      .mockResolvedValue(new Set(opciones.existentes ?? ['litro', 'medio'])),
    insertar: jest
      .fn()
      .mockResolvedValue(
        'idInsertado' in opciones ? opciones.idInsertado : contexto.id,
      ),
    insertarLineas: jest.fn().mockResolvedValue(undefined),
  };
  return { servicio: new MovimientosService(repo as never), repo };
}

describe('MovimientosService.registrarMovimiento (T-27 pieza 2, D7)', () => {
  it('inserta con el id de la clave, el dia del sobre y las lineas', async () => {
    const { servicio, repo } = montar();
    await expect(
      servicio.registrarMovimiento(movimiento, contexto, trx),
    ).resolves.toEqual({ tabla: 'movimiento_inventario', id: contexto.id });
    // Sin repetir: la misma presentacion recibida y entregada se pregunta una vez.
    expect(repo.presentacionesExistentes).toHaveBeenCalledWith(
      ['litro', 'medio'],
      trx,
    );
    expect(repo.insertar).toHaveBeenCalledWith(
      {
        id: contexto.id,
        sucursalId: 'sucursal-tj',
        vendedorId: 'vendedor-1',
        clienteId: 'cliente-1',
        tipo: 'merma_cliente',
        // El dia del sobre tal cual, aunque en UTC `registradoEn` ya sea el 24.
        fecha: '2026-10-23',
        comentario: 'Venían reventadas',
        registradoEn: '2026-10-24T01:30:00.000Z',
      },
      trx,
    );
    expect(repo.insertarLineas).toHaveBeenCalledWith(
      contexto.id,
      movimiento.lineas,
      trx,
    );
  });

  it('una presentacion que no existe es presentacion-inexistente y no inserta nada', async () => {
    const { servicio, repo } = montar({ existentes: ['litro'] });
    const error = await servicio
      .registrarMovimiento(movimiento, contexto, trx)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MovimientoRechazado);
    expect((error as MovimientoRechazado).razon).toBe('presentacion-inexistente');
    expect((error as Error).message).toMatch(/^lineas: .*medio/);
    expect(repo.insertar).not.toHaveBeenCalled();
    expect(repo.insertarLineas).not.toHaveBeenCalled();
  });

  it('un id ocupado es movimiento-id-ocupado con un motivo neutro y sin lineas', async () => {
    const { servicio, repo } = montar({ idInsertado: null });
    const error = await servicio
      .registrarMovimiento(movimiento, contexto, trx)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MovimientoRechazado);
    expect((error as MovimientoRechazado).razon).toBe('movimiento-id-ocupado');
    expect((error as Error).message).toBe(
      'El id de este movimiento ya está ocupado. Avisa a la oficina.',
    );
    expect(repo.insertarLineas).not.toHaveBeenCalled();
  });
});
```

- [ ] **Paso 6: correr y ver fallar**

```bash
npm test --workspace=apps/backend -- movimientos.service
```

Esperado: falla al compilar (`Cannot find module './movimientos.service'`).

- [ ] **Paso 7: razón, repositorio, servicio y módulo**

`apps/backend/src/modules/inventario/movimiento-rechazado.ts`:

```ts
/**
 * Un movimiento de inventario que el DOMINIO no acepta (T-27 pieza 2). Igual que
 * `GastoRechazado`: no importa nada del contrato; `push` la traduce a su codigo
 * (`sincronizacion/despacho-movimiento.ts`). La forma de `datos` no esta aqui:
 * se rechaza antes de abrir la transaccion (`datos-movimiento.ts`).
 */
export type RazonRechazoMovimiento =
  /**
   * Una linea nombra una presentacion que nunca existio (bug de la tablet). Una
   * dada de baja SI se acepta: las piezas ya salieron de la camioneta. Sale como
   * `datos-invalidos` (spec).
   */
  | 'presentacion-inexistente'
  /** El id (la clave) ya lo ocupa otro movimiento. */
  | 'movimiento-id-ocupado';

export interface RechazoMovimiento {
  razon: RazonRechazoMovimiento;
  /** En el espanol que leera quien tenga la tablet en la mano. */
  motivo: string;
}

export class MovimientoRechazado extends Error {
  readonly razon: RazonRechazoMovimiento;

  constructor({ razon, motivo }: RechazoMovimiento) {
    super(motivo);
    this.name = 'MovimientoRechazado';
    this.razon = razon;
  }
}
```

`apps/backend/src/modules/inventario/movimientos.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type {
  LineaMovimientoNormalizada,
  TipoMovimiento,
} from './datos-movimiento';

/** Una fila de `movimiento_inventario` lista para escribir. */
export interface NuevoMovimiento {
  id: string;
  sucursalId: string;
  vendedorId: string;
  clienteId: string | null;
  tipo: TipoMovimiento;
  /** `AAAA-MM-DD`: la `fecha_operacion` del sobre, tal cual. */
  fecha: string;
  comentario: string | null;
  registradoEn: string;
}

/**
 * SQL de los movimientos de inventario (T-27 pieza 2). Lo del push recibe la
 * `trx` y no abre la suya: el movimiento entra o sale junto con su fila del
 * buzon (ADR-0009 §2.3). La pieza 3 (corte) le sumara las lecturas.
 */
@Injectable()
export class MovimientosRepository {
  /**
   * Cuales de esas presentaciones existen. **Sin mirar `deleted_at` ni
   * `activo`**: una dada de baja despues de que el vendedor la saco de la
   * camioneta se acepta; solo un id que nunca existio es un error.
   */
  async presentacionesExistentes(
    ids: readonly string[],
    trx: Transaction<DB>,
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const filas = await trx
      .selectFrom('presentacion')
      .select('id')
      .where('id', 'in', ids)
      .execute();
    return new Set(filas.map((f) => f.id));
  }

  /**
   * Inserta el movimiento, o devuelve `null` si su id ya estaba ocupado.
   *
   * `on conflict (id) do nothing` y no atrapar el `23505`: un unique_violation
   * aborta la transaccion entera de Postgres (T-16, D10).
   */
  async insertar(
    nuevo: NuevoMovimiento,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .insertInto('movimiento_inventario')
      .values({
        id: nuevo.id,
        sucursal_id: nuevo.sucursalId,
        vendedor_id: nuevo.vendedorId,
        cliente_id: nuevo.clienteId,
        tipo: nuevo.tipo,
        // El 'AAAA-MM-DD' del sobre tal cual, sin pasar por Date/UTC.
        fecha: nuevo.fecha,
        comentario: nuevo.comentario,
        registrado_en: nuevo.registradoEn,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .returning('id')
      .executeTakeFirst();
    return fila?.id ?? null;
  }

  async insertarLineas(
    movimientoId: string,
    lineas: readonly LineaMovimientoNormalizada[],
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .insertInto('movimiento_inventario_linea')
      .values(
        lineas.map((l) => ({
          movimiento_id: movimientoId,
          presentacion_id: l.presentacionId,
          sentido: l.sentido,
          piezas: l.piezas,
        })),
      )
      .execute();
  }
}
```

`apps/backend/src/modules/inventario/movimientos.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { MovimientoNormalizado } from './datos-movimiento';
import { MovimientoRechazado } from './movimiento-rechazado';
import { MovimientosRepository } from './movimientos.repository';

/**
 * Quien, cual y cuando. Todo sale del token o del sobre, nunca de `datos`: `id`
 * es la clave de la operacion (uuid validado en `prepararMovimiento`),
 * `sucursalId`/`vendedorId` los del token, `clienteId` el del sobre (ya paso por
 * el alcance del lote) y `fechaOperacion` la del sobre, sin re-derivarla de UTC.
 */
export interface ContextoMovimiento {
  id: string;
  sucursalId: string;
  vendedorId: string;
  clienteId: string | null;
  fechaOperacion: string;
}

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadMovimiento {
  tabla: 'movimiento_inventario';
  id: string;
}

/**
 * Los movimientos de inventario en el servidor (T-27 pieza 2, D7): una sola
 * tabla para la merma del cliente, la del trayecto y el consumo. Vive en
 * `inventario/` (el modulo del vault al que pertenece el inventario del
 * vendedor); `sincronizacion/` solo lo despacha (ADR-0009).
 *
 * **No revisa el limite de consumo ni la existencia** (spec): las piezas ya
 * salieron de la camioneta; lo exige la tablet, como "exige foto" en la visita.
 */
@Injectable()
export class MovimientosService {
  constructor(private readonly repo: MovimientosRepository) {}

  /**
   * @throws {MovimientoRechazado} `presentacion-inexistente` o
   * `movimiento-id-ocupado`. No escribe nada antes de lanzar (y si lanzara
   * despues, el rollback de la operacion se lleva todo).
   */
  async registrarMovimiento(
    movimiento: MovimientoNormalizado,
    contexto: ContextoMovimiento,
    trx: Transaction<DB>,
  ): Promise<EntidadMovimiento> {
    const ids = [...new Set(movimiento.lineas.map((l) => l.presentacionId))];
    const existentes = await this.repo.presentacionesExistentes(ids, trx);
    const faltante = ids.find((id) => !existentes.has(id));
    if (faltante !== undefined) {
      // Sin esto la llave foranea saldria como 500 para todo el lote.
      throw new MovimientoRechazado({
        razon: 'presentacion-inexistente',
        motivo: `lineas: la presentación ${faltante} no existe en el catálogo.`,
      });
    }

    const id = await this.repo.insertar(
      {
        id: contexto.id,
        sucursalId: contexto.sucursalId,
        vendedorId: contexto.vendedorId,
        clienteId: contexto.clienteId,
        tipo: movimiento.tipo,
        fecha: contexto.fechaOperacion,
        comentario: movimiento.comentario,
        registradoEn: movimiento.registradoEn,
      },
      trx,
    );
    if (id === null) {
      // Neutro a proposito, como `gasto-id-ocupado` (T-30/T-31).
      throw new MovimientoRechazado({
        razon: 'movimiento-id-ocupado',
        motivo: 'El id de este movimiento ya está ocupado. Avisa a la oficina.',
      });
    }
    await this.repo.insertarLineas(id, movimiento.lineas, trx);
    return { tabla: 'movimiento_inventario', id };
  }
}
```

`apps/backend/src/modules/inventario/inventario.module.ts` (completo):

```ts
import { Module } from '@nestjs/common';
import { MovimientosRepository } from './movimientos.repository';
import { MovimientosService } from './movimientos.service';
import { ProductosController } from './productos.controller';
import { ProductosRepository } from './productos.repository';
import { ProductosService } from './productos.service';

// Productos vive aqui y no en un `modules/productos/` nuevo: el CLAUDE.md fija
// que los modulos usan los slugs del vault, y `Producto.md` declara
// `modulo: inventario` (D3).
//
// T-27 pieza 2: los movimientos de inventario (merma y consumo). Exporta
// `MovimientosService` para que sincronizacion/ proyecte el `tipo: 'movimiento'`
// (ADR-0009: sincronizacion importa a los modulos de dominio, nunca al reves).
@Module({
  controllers: [ProductosController],
  providers: [
    ProductosService,
    ProductosRepository,
    MovimientosService,
    MovimientosRepository,
  ],
  exports: [MovimientosService],
})
export class InventarioModule {}
```

- [ ] **Paso 8: correr y ver pasar**

```bash
npm test --workspace=apps/backend -- movimientos.service datos-movimiento
```

Esperado: verde.

- [ ] **Paso 9: el e2e, que falla**

`apps/backend/test/movimiento.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';
import {
  CONTRATO_ACTUAL,
  type RespuestaPull,
  type RespuestaPush,
} from './../src/modules/sincronizacion/contrato';

/**
 * T-27 pieza 2: los movimientos de inventario en el push, de punta a punta, y
 * `consumo_diario_max` en el pull. La clave es el id del movimiento, la fecha es
 * la del sobre, el servidor no revisa el limite de consumo ni la existencia, un
 * id ocupado se rechaza con motivo neutro y el reenvio es `duplicada`.
 *
 * Sucursal propia `ZM` (exclusiva de esta suite): cambiar su limite no afecta a
 * TJ ni a MX. Fechas de 2018-05 para no cruzarse con otras suites.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const CODIGO = 'ZM';
const PASSWORD = 'contrasena-del-vendedor';
const LOGIN = `e2e-movimiento-${SUFIJO}`;
const LOGIN_GENERAL = `e2e-movimiento-gen-${SUFIJO}`;
const PREFIJO = `ZZ-movimiento-${SUFIJO}`;
const FECHA = '2018-05-10';

interface FilaMovimiento {
  id: string;
  sucursal_id: string;
  vendedor_id: string;
  cliente_id: string | null;
  tipo: string;
  comentario: string | null;
  fecha_texto: string;
  registrado_en: Date;
}

describe('Movimientos de inventario en el push (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sucursalId: string;
  let usuarioId: string;
  let cookieGeneral: string;
  let vendedorId: string;
  let bearer: string;
  let clienteId: string;
  let clienteAjenoId: string;
  let productoId: string;
  let litro: string;
  let medio: string;

  const push = async (operaciones: unknown[]) => {
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ contrato: CONTRATO_ACTUAL, operaciones })
      .expect(200);
    return res.body as RespuestaPush;
  };

  const pull = async (desde?: string): Promise<RespuestaPull> => {
    const params = new URLSearchParams({ contrato: String(CONTRATO_ACTUAL) });
    if (desde) params.set('desde', desde);
    const res = await request(app.getHttpServer())
      .get(`/sync/pull?${params.toString()}`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    return res.body as RespuestaPull;
  };

  const patchSucursal = (cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/sucursales/${sucursalId}`)
      .set('Cookie', cookieGeneral)
      .send(cuerpo);

  /** Una merma del cliente: 3 litros danados, 2 medios de reposicion. */
  const mermaCliente = (
    datos: Record<string, unknown> = {},
    sobre: Record<string, unknown> = {},
  ) => ({
    clave: randomUUID(),
    tipo: 'movimiento',
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T18:40:00.000Z`,
    cliente_id: clienteId,
    datos: {
      tipo: 'merma_cliente',
      comentario: null,
      registrado_en: `${FECHA}T18:40:00.000Z`,
      lineas: [
        { presentacion_id: litro, sentido: 'recibido', piezas: 3 },
        { presentacion_id: medio, sentido: 'entregado', piezas: 2 },
      ],
      ...datos,
    },
    ...sobre,
  });

  /** Merma del trayecto o consumo: sin `cliente_id`, solo piezas que salen. */
  const sinCliente = (tipo: 'merma_trayecto' | 'consumo', piezas = 1) => ({
    clave: randomUUID(),
    tipo: 'movimiento',
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T19:00:00.000Z`,
    datos: {
      tipo,
      comentario: null,
      registrado_en: `${FECHA}T19:00:00.000Z`,
      lineas: [{ presentacion_id: litro, sentido: 'entregado', piezas }],
    },
  });

  const altaProspecto = () => ({
    clave: randomUUID(),
    tipo: 'prospecto',
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T18:03:22.000Z`,
    datos: {
      nombre: `${PREFIJO} Prospecto ${Math.random().toString(36).slice(2)}`,
      telefono: '6641112233',
      encargado: 'Don Aaron',
      tipo_negocio_id: null,
      comentarios: null,
      lat: null,
      lng: null,
      foto: null,
    },
  });

  const filaMovimiento = (id: string): Promise<FilaMovimiento | undefined> =>
    db
      .selectFrom('movimiento_inventario')
      .select([
        'id',
        'sucursal_id',
        'vendedor_id',
        'cliente_id',
        'tipo',
        'comentario',
        'registrado_en',
      ])
      .select(sql<string>`fecha::text`.as('fecha_texto'))
      .where('id', '=', id)
      .executeTakeFirst();

  const lineas = (id: string) =>
    db
      .selectFrom('movimiento_inventario_linea')
      .select(['presentacion_id', 'sentido', 'piezas'])
      .where('movimiento_id', '=', id)
      .orderBy('sentido', 'desc')
      .execute();

  const buzon = (clave: string) =>
    db
      .selectFrom('sync_operacion')
      .select(['entidad_tabla', 'entidad_id'])
      .where('vendedor_id', '=', vendedorId)
      .where('clave_idempotencia', '=', clave)
      .executeTakeFirst();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    sucursalId = (
      await db
        .insertInto('sucursal')
        .values({ codigo: CODIGO, nombre: 'Prueba movimientos' })
        .onConflict((oc) =>
          oc
            .column('codigo')
            .doUpdateSet({ deleted_at: null, consumo_diario_max: 1 }),
        )
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const hash = await app.get(PasswordService).hashear(PASSWORD);
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Administrador General')
      .executeTakeFirstOrThrow();
    usuarioId = (
      await db
        .insertInto('usuario')
        .values({
          login: LOGIN_GENERAL,
          nombre: LOGIN_GENERAL,
          password_hash: hash,
          perfil_id: perfilId,
          sucursal_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN_GENERAL, password: PASSWORD })
      .expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    cookieGeneral = cookies
      .find((c) => c.startsWith('jawa_access='))!
      .split(';')[0];

    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Vendedor de movimientos',
          password_hash: hash,
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const cliente = async (nombre: string, sucursal: string) =>
      (
        await db
          .insertInto('cliente')
          .values({
            nombre,
            domicilio: 'Calle 1',
            telefono: '6640000000',
            tipo: 'cliente',
            lista_precio_id: lista.id,
            sucursal_id: sucursal,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    clienteId = await cliente(`${PREFIJO} Abarrotes`, sucursalId);
    const tj = await db
      .selectFrom('sucursal')
      .select('id')
      .where('codigo', '=', 'TJ')
      .executeTakeFirstOrThrow();
    // De OTRA sucursal: el alcance del lote lo rechaza.
    clienteAjenoId = await cliente(`${PREFIJO} Ajeno`, tj.id);

    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: `${PREFIJO} Horchata` })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const presentacion = async (volumen: string) =>
      (
        await db
          .insertInto('presentacion')
          .values({ producto_id: productoId, volumen })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    litro = await presentacion('1 L');
    medio = await presentacion('500 ml');

    bearer = (
      (
        await request(app.getHttpServer())
          .post('/auth/app/login')
          .send({ login: LOGIN, password: PASSWORD })
          .expect(200)
      ).body as { tokenAcceso: string }
    ).tokenAcceso;
  });

  afterAll(async () => {
    // Orden inverso a las llaves foraneas.
    const movimientos = db
      .selectFrom('movimiento_inventario')
      .select('id')
      .where('vendedor_id', '=', vendedorId);
    await db
      .deleteFrom('movimiento_inventario_linea')
      .where('movimiento_id', 'in', movimientos)
      .execute();
    await db
      .deleteFrom('movimiento_inventario')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db
      .deleteFrom('cliente')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db
      .deleteFrom('presentacion')
      .where('producto_id', '=', productoId)
      .execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', '=', usuarioId)
      .execute();
    await db.deleteFrom('usuario').where('id', '=', usuarioId).execute();
    await db.deleteFrom('sucursal').where('codigo', '=', CODIGO).execute();
    await app.close();
  });

  it('una merma del cliente entra con la clave como id, el dia del sobre y sus lineas', async () => {
    // A las 18:30 de Tijuana del 10 de mayo en UTC ya es el 11: cuenta el 10.
    const op = mermaCliente({
      registrado_en: '2018-05-11T01:30:00.000Z',
      comentario: '  Venían reventadas  ',
    });
    const r = (await push([op])).resultados[0];
    expect(r.estado).toBe('aplicada');

    const fila = await filaMovimiento(op.clave);
    expect(fila).toMatchObject({
      id: op.clave,
      sucursal_id: sucursalId,
      vendedor_id: vendedorId,
      cliente_id: clienteId,
      tipo: 'merma_cliente',
      comentario: 'Venían reventadas',
      fecha_texto: FECHA,
    });
    expect(new Date(fila!.registrado_en).toISOString()).toBe(
      '2018-05-11T01:30:00.000Z',
    );
    expect(await lineas(op.clave)).toEqual([
      { presentacion_id: litro, sentido: 'recibido', piezas: 3 },
      { presentacion_id: medio, sentido: 'entregado', piezas: 2 },
    ]);
    expect(await buzon(op.clave)).toEqual({
      entidad_tabla: 'movimiento_inventario',
      entidad_id: op.clave,
    });
  });

  it('la merma del trayecto y el consumo entran sin cliente', async () => {
    const trayecto = sinCliente('merma_trayecto', 2);
    const consumo = sinCliente('consumo');
    const r = await push([trayecto, consumo]);
    expect(r.resultados.map((x) => x.estado)).toEqual(['aplicada', 'aplicada']);
    expect(await filaMovimiento(trayecto.clave)).toMatchObject({
      tipo: 'merma_trayecto',
      cliente_id: null,
    });
    expect(await filaMovimiento(consumo.clave)).toMatchObject({
      tipo: 'consumo',
      cliente_id: null,
    });
  });

  it('el servidor no revisa el limite de consumo: dos consumos sobre el limite de 1 entran', async () => {
    const r = await push([sinCliente('consumo', 5), sinCliente('consumo', 5)]);
    expect(r.resultados.map((x) => x.estado)).toEqual(['aplicada', 'aplicada']);
  });

  it('reenviar la misma clave es duplicada, con el mismo id_servidor y sin otra fila', async () => {
    const op = sinCliente('merma_trayecto');
    const primero = (await push([op])).resultados[0];
    const segundo = (await push([op])).resultados[0];
    expect(segundo).toMatchObject({
      estado: 'duplicada',
      id_servidor: primero.id_servidor,
    });
    expect(await lineas(op.clave)).toHaveLength(1);
  });

  it.each([
    ['una merma del cliente sin cliente_id', () => mermaCliente({}, { cliente_id: undefined }), /^cliente_id: /],
    ['un consumo con cliente_id', () => ({ ...sinCliente('consumo'), cliente_id: clienteId }), /^cliente_id: /],
    ['una clave que no es uuid', () => mermaCliente({}, { clave: 'movimiento-123' }), /^clave: /],
    // El folio en el sobre lo cubre `despacho-movimiento.spec.ts`: aqui `normalizarOperacion`
    // lo rechazaria antes como `folio-invalido` (el vendedor de ZM no tiene segmento).
  ])('%s es datos-invalidos y no deja fila', async (_caso, armar, motivo) => {
    const op = armar();
    const r = (await push([op])).resultados[0];
    expect(r).toMatchObject({ estado: 'rechazada', codigo: 'datos-invalidos' });
    expect(r.motivo).toMatch(motivo);
    expect(await buzon(op.clave)).toBeUndefined();
  });

  it('Review Focus 3: una merma del cliente solo con lo entregado es datos-invalidos', async () => {
    const op = mermaCliente({
      lineas: [{ presentacion_id: medio, sentido: 'entregado', piezas: 2 }],
    });
    const r = (await push([op])).resultados[0];
    expect(r).toMatchObject({ estado: 'rechazada', codigo: 'datos-invalidos' });
    expect(r.motivo).toMatch(/^lineas: .*recibido/);
    expect(await filaMovimiento(op.clave)).toBeUndefined();
  });

  it('una presentacion que no existe es datos-invalidos y el rollback no deja ni buzon ni movimiento', async () => {
    const op = mermaCliente({
      lineas: [{ presentacion_id: randomUUID(), sentido: 'recibido', piezas: 1 }],
    });
    const r = (await push([op])).resultados[0];
    expect(r).toMatchObject({ estado: 'rechazada', codigo: 'datos-invalidos' });
    expect(r.motivo).toMatch(/^lineas: /);
    expect(await filaMovimiento(op.clave)).toBeUndefined();
    expect(await buzon(op.clave)).toBeUndefined();
  });

  it('un cliente de otra sucursal es cliente-fuera-de-alcance', async () => {
    const op = mermaCliente({}, { cliente_id: clienteAjenoId });
    expect((await push([op])).resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'cliente-fuera-de-alcance',
    });
  });

  it('un id ocupado por otro movimiento es movimiento-id-ocupado con motivo neutro', async () => {
    const ocupado = randomUUID();
    await db
      .insertInto('movimiento_inventario')
      .values({
        id: ocupado,
        sucursal_id: sucursalId,
        vendedor_id: vendedorId,
        cliente_id: null,
        tipo: 'consumo',
        fecha: FECHA,
        registrado_en: new Date(),
      })
      .execute();
    const r = (await push([mermaCliente({}, { clave: ocupado })]))
      .resultados[0];
    expect(r).toMatchObject({
      estado: 'rechazada',
      codigo: 'movimiento-id-ocupado',
    });
    expect(r.motivo).not.toContain(clienteId);
    expect(await buzon(ocupado)).toBeUndefined();
  });

  it('Review Focus 4: alta y merma en el MISMO lote: la merma cae por alcance y entra en el siguiente', async () => {
    const alta = altaProspecto();
    const op = mermaCliente({}, { cliente_id: alta.clave });
    const r = await push([alta, op]);
    expect(r.resultados[0].estado).toBe('aplicada');
    expect(r.resultados[1]).toMatchObject({
      estado: 'rechazada',
      codigo: 'cliente-fuera-de-alcance',
    });
    // La tablet la reenvia con la misma clave en el siguiente lote: no se pierde.
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
    expect(await filaMovimiento(op.clave)).toMatchObject({
      cliente_id: alta.clave,
    });
  });

  describe('consumo_diario_max (D4)', () => {
    it('Review Focus 5: cambiar el limite en el portal baja en el pull incremental', async () => {
      const completo = await pull();
      expect(completo.catalogos.vendedores).toEqual([
        expect.objectContaining({ id: vendedorId, consumo_diario_max: 1 }),
      ]);
      const antes = completo.servidor_en;
      // Sin cambios, el vendedor no vuelve a bajar.
      expect((await pull(antes)).catalogos.vendedores).toEqual([]);

      const editada = await patchSucursal({ consumoDiarioMax: 3 }).expect(200);
      expect(
        (editada.body as { consumoDiarioMax: number }).consumoDiarioMax,
      ).toBe(3);
      // El vendedor no cambio, pero su sucursal si: baja con el limite nuevo.
      expect((await pull(antes)).catalogos.vendedores).toEqual([
        expect.objectContaining({ id: vendedorId, consumo_diario_max: 3 }),
      ]);
    });

    it.each([[100], [-1], [1.5], ['2']])(
      'consumoDiarioMax %j es 400',
      async (valor) => {
        await patchSucursal({ consumoDiarioMax: valor }).expect(400);
      },
    );

    it('0 apaga el consumo propio y tambien baja', async () => {
      const antes = (await pull()).servidor_en;
      await patchSucursal({ consumoDiarioMax: 0 }).expect(200);
      expect((await pull(antes)).catalogos.vendedores).toEqual([
        expect.objectContaining({ id: vendedorId, consumo_diario_max: 0 }),
      ]);
    });
  });
});
```

Correr:

```bash
npm run test:e2e --workspace=apps/backend -- movimiento.e2e
```

Esperado: falla al compilar (`consumo_diario_max` no está en `VendedorPull`) o, si compila, los push salen
`tipo-desconocido` y el PATCH con `consumoDiarioMax` sale 400 ("No hay nada que actualizar.").

- [ ] **Paso 10: el sobre del movimiento, prueba que falla**

`apps/backend/src/modules/sincronizacion/despacho-movimiento.spec.ts`:

```ts
import { CODIGOS_RECHAZO } from './contrato';
import {
  CODIGO_POR_RAZON_MOVIMIENTO,
  prepararMovimiento,
} from './despacho-movimiento';
import type { OperacionNormalizada } from './operaciones';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
const LITRO = '5f3c1a2b-7d8e-4f90-a1b2-c3d4e5f60718';

const op = (
  extra: Partial<OperacionNormalizada> = {},
): OperacionNormalizada => ({
  clave: 'c0ffee00-0000-4000-8000-000000002700',
  tipo: 'movimiento',
  fechaOperacion: '2026-10-23',
  ocurridoEn: '2026-10-23T18:40:00.000Z',
  clienteId: CLIENTE,
  folio: null,
  datos: {
    tipo: 'merma_cliente',
    comentario: null,
    registrado_en: '2026-10-23T18:40:00.000Z',
    lineas: [{ presentacion_id: LITRO, sentido: 'recibido', piezas: 3 }],
  },
  ...extra,
});

const consumo = {
  tipo: 'consumo',
  registrado_en: '2026-10-23T18:40:00.000Z',
  lineas: [{ presentacion_id: LITRO, sentido: 'entregado', piezas: 1 }],
};

describe('prepararMovimiento (T-27 pieza 2)', () => {
  it('una merma del cliente sale con el cliente del sobre', () => {
    expect(prepararMovimiento(op())).toEqual({
      ok: true,
      clienteId: CLIENTE,
      movimiento: {
        tipo: 'merma_cliente',
        comentario: null,
        registradoEn: '2026-10-23T18:40:00.000Z',
        lineas: [{ presentacionId: LITRO, sentido: 'recibido', piezas: 3 }],
      },
    });
  });

  it('un consumo sin cliente sale con clienteId null', () => {
    expect(
      prepararMovimiento(op({ clienteId: null, datos: consumo })),
    ).toMatchObject({ ok: true, clienteId: null, movimiento: { tipo: 'consumo' } });
  });

  it.each([
    [{ folio: 'TJ261023AP01' }, /^folio: /],
    [{ clave: 'movimiento-123' }, /^clave: .*uuid/],
    [{ clienteId: null }, /^cliente_id: /],
    [{ datos: consumo }, /^cliente_id: /],
    [{ datos: { ...consumo, tipo: 'cambio' } }, /^tipo: /],
  ])(
    '%j es datos-invalidos con un motivo que nombra el campo',
    (extra, motivo) => {
      const r = prepararMovimiento(op(extra));
      expect(r).toMatchObject({ ok: false, codigo: 'datos-invalidos' });
      if (!r.ok) expect(r.motivo).toMatch(motivo);
    },
  );

  it('cada razon del dominio sale con un codigo que existe en el contrato', () => {
    for (const codigo of Object.values(CODIGO_POR_RAZON_MOVIMIENTO)) {
      expect(CODIGOS_RECHAZO).toContain(codigo);
    }
    expect(CODIGO_POR_RAZON_MOVIMIENTO).toEqual({
      'presentacion-inexistente': 'datos-invalidos',
      'movimiento-id-ocupado': 'movimiento-id-ocupado',
    });
  });
});
```

En `apps/backend/src/modules/sincronizacion/despacho.spec.ts`, dentro de `describe('prepararProyeccion', …)`, después
del caso "un gasto con datos libres ya no entra al buzon", agrega:

```ts
  it('un movimiento pasa por prepararMovimiento y sale como proyeccion de movimiento (T-27 pieza 2)', () => {
    const r = prepararProyeccion(
      op({
        tipo: 'movimiento',
        clave: 'c0ffee00-0000-4000-8000-000000002701',
        folio: null,
        clienteId: null,
        datos: {
          tipo: 'merma_trayecto',
          registrado_en: '2026-10-23T18:40:00.000Z',
          lineas: [{ presentacion_id: PRE_A, sentido: 'entregado', piezas: 2 }],
        },
      }),
    );
    expect(r).toEqual({
      ok: true,
      proyeccion: {
        tipo: 'movimiento',
        clienteId: null,
        movimiento: {
          tipo: 'merma_trayecto',
          comentario: null,
          registradoEn: '2026-10-23T18:40:00.000Z',
          lineas: [{ presentacionId: PRE_A, sentido: 'entregado', piezas: 2 }],
        },
      },
    });
  });
```

```bash
npm test --workspace=apps/backend -- despacho
```

Esperado: falla al compilar (`./despacho-movimiento` no existe; `'movimiento'` no es un `TipoOperacion`).

- [ ] **Paso 11: contrato (los dos lados), despacho y proyección**

**`apps/backend/src/modules/sincronizacion/contrato.ts`:**

1. En el comentario de `TIPOS_OPERACION`, cambia la línea `TODO: T-33 — merma …` por:

```ts
 * Reservado: `merma` — sin forma ni proyeccion; se guarda en el buzon tal cual.
 *        La merma de T-27 pieza 2 viaja como `movimiento` (no reutiliza este
 *        tipo: una tablet que ya lo hubiera mandado con datos libres seguiria
 *        entrando igual).
 * Hecho: T-27 pieza 2 — `movimiento`, la merma del cliente, la merma del
 *        trayecto o el consumo propio (ver {@link DatosMovimiento}); se proyecta
 *        a `movimiento_inventario` con `id = clave`. Tipo nuevo = cambio aditivo:
 *        no sube la version.
```

2. Agrega `'movimiento'` al final de `TIPOS_OPERACION` (después de `'visita'`).
3. Al final de `CODIGOS_RECHAZO` (después de `'gasto-id-ocupado'`):

```ts
  /**
   * El id del movimiento de inventario (su clave) ya esta ocupado por otro
   * registro. T-27 pieza 2. El mismo vendedor con la misma clave es `duplicada`,
   * no esto. Motivo neutro.
   */
  'movimiento-id-ocupado',
```

4. Después de `export type DatosGasto = { … };`:

```ts
/**
 * `datos` de una operacion `tipo: "movimiento"` (T-27 pieza 2): piezas que salen
 * o entran a la camioneta por razones distintas a la venta.
 *
 * - `merma_cliente`: el sobre **lleva** `cliente_id`; al menos una linea
 *   `recibido` (lo danado que devolvio) y, opcional, lineas `entregado` (la
 *   reposicion, de cualquier sabor y tamano).
 * - `merma_trayecto` y `consumo`: el sobre **no** lleva `cliente_id`; solo lineas
 *   `entregado`, al menos una.
 *
 * Sin folio. La `clave` **es el id** de la fila `movimiento_inventario`: debe ser
 * uuid. El dia es `fecha_operacion`. El servidor **no** revisa el limite de
 * consumo ni la existencia: lo exige la tablet.
 *
 * Es `type` y no `interface` por la misma razon que {@link DatosVenta}.
 */
export type DatosMovimiento = {
  tipo: 'merma_cliente' | 'merma_trayecto' | 'consumo';
  /** Hasta 300 caracteres; se recorta y uno vacio es `null`. */
  comentario?: string | null;
  /** Instante ISO-8601 con zona en que el vendedor lo guardo. */
  registrado_en: string;
  /** De 1 a 200; una presentacion una sola vez por sentido; piezas enteras 1..99 999. */
  lineas: {
    presentacion_id: string;
    sentido: 'recibido' | 'entregado';
    piezas: number;
  }[];
};
```

5. En `VendedorPull`, después de `control_inventario: boolean;`:

```ts
  /**
   * T-27 pieza 2 (D4): piezas de consumo propio que puede registrar en un dia,
   * de SU sucursal (0..99; 0 = no se ofrece). Cambiarlo en el portal toca
   * `updated_at` de los vendedores de esa sucursal, asi que baja en el pull
   * incremental. Aditivo.
   */
  consumo_diario_max: number;
```

**`apps/tablet/src/sincronizacion/contrato.ts`** (la copia, en el mismo commit):

1. En `TipoOperacion`, después de `| 'visita'`:

```ts
  /** T-27 pieza 2. Merma del cliente, del trayecto o consumo: se proyecta a `movimiento_inventario`. */
  | 'movimiento'
```

(deja el `;` final después de la nueva línea).

2. Al final de `CODIGOS_RECHAZO`, después de `'gasto-id-ocupado',`:

```ts
  /** T-27 pieza 2: el id del movimiento ya lo ocupa otro registro. Motivo neutro. */
  'movimiento-id-ocupado',
```

3. Después de `export type DatosGasto = { … };`:

```ts
/**
 * `datos` de un movimiento de inventario (T-27 pieza 2). Ver la copia normativa
 * en el backend: `merma_cliente` lleva `cliente_id` en el sobre y al menos una
 * linea `recibido`; `merma_trayecto` y `consumo`, sin cliente y solo `entregado`.
 */
export type DatosMovimiento = {
  tipo: 'merma_cliente' | 'merma_trayecto' | 'consumo';
  /** Hasta 300 caracteres. */
  comentario?: string | null;
  registrado_en: string;
  lineas: {
    presentacion_id: string;
    sentido: 'recibido' | 'entregado';
    piezas: number;
  }[];
};
```

4. En `VendedorPull`, después de `control_inventario?: boolean;`:

```ts
  /**
   * T-27 pieza 2 (D4): el consumo propio maximo por dia de su sucursal.
   * **Opcional en la copia de la tablet, obligatorio en el servidor** (regla §3):
   * un servidor anterior no lo manda y la tablet conserva el que tenia (1 la
   * primera vez).
   */
  consumo_diario_max?: number;
```

**`apps/backend/src/modules/sincronizacion/despacho-movimiento.ts`:**

```ts
import {
  normalizarDatosMovimiento,
  type MovimientoNormalizado,
} from '../inventario/datos-movimiento';
import type { RazonRechazoMovimiento } from '../inventario/movimiento-rechazado';
import { RE_UUID } from '../rutas/datos-visita';
import type { CodigoRechazo } from './contrato';
import type { OperacionNormalizada, Rechazo } from './operaciones';

/**
 * La parte del despachador que es del movimiento de inventario (T-27 pieza 2),
 * en su propio archivo para que `despacho.ts` se quede en un `case` corto por
 * tipo (acuerdo de T-40). Puro, sin base.
 */

export type PreparacionMovimiento =
  | {
      ok: true;
      movimiento: MovimientoNormalizado;
      /** El del sobre: solo en la merma del cliente (ya paso por el alcance del lote). */
      clienteId: string | null;
    }
  | ({ ok: false } & Rechazo);

export function prepararMovimiento(
  op: OperacionNormalizada,
): PreparacionMovimiento {
  // Con folio ocuparia un numero de la serie de ventas en `sync_operacion.folio`
  // (mismo criterio que T-40/T-39/T-30).
  if (op.folio !== null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'folio: un movimiento no lleva folio; no es una nota que nadie firme.',
    };
  }

  // La clave ES el id del movimiento (como la visita y el gasto).
  if (!RE_UUID.test(op.clave)) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'clave: la clave de un movimiento debe ser un uuid; es el id con el que la tablet ya lo registró.',
    };
  }

  const r = normalizarDatosMovimiento(op.datos);
  if (!r.ok) return { ok: false, codigo: 'datos-invalidos', motivo: r.motivo };

  // Solo la merma del cliente es de un cliente (`ck_movimiento_cliente`).
  const esDelCliente = r.movimiento.tipo === 'merma_cliente';
  if (esDelCliente && op.clienteId === null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'cliente_id: una merma del cliente va en el sobre con el cliente que devolvió el producto.',
    };
  }
  if (!esDelCliente && op.clienteId !== null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'cliente_id: la merma del trayecto y el consumo no son de un cliente; el sobre no lo lleva.',
    };
  }

  return { ok: true, movimiento: r.movimiento, clienteId: op.clienteId };
}

/**
 * Razon del dominio a codigo del contrato. Un `Record`: una razon nueva no
 * compila sin codigo. La presentacion inexistente es un bug de la tablet:
 * `datos-invalidos` (spec), con el motivo que nombra `lineas`.
 */
export const CODIGO_POR_RAZON_MOVIMIENTO: Record<
  RazonRechazoMovimiento,
  CodigoRechazo
> = {
  'presentacion-inexistente': 'datos-invalidos',
  'movimiento-id-ocupado': 'movimiento-id-ocupado',
};
```

**`apps/backend/src/modules/sincronizacion/despacho.ts`:**

1. Imports: agrega `import type { MovimientoNormalizado } from '../inventario/datos-movimiento';` y
   `import { prepararMovimiento } from './despacho-movimiento';`.
2. En el comentario de `Proyeccion`, cambia "Un tipo sin modulo todavia (merma, ruta)" por "Un tipo sin modulo (merma
   y ruta, reservados)" (conservando sus backticks) y agrega "`movimiento` (T-27 pieza 2)" al final de la lista "Orden
   acordado entre tickets".
3. Al final de la unión `Proyeccion` (después de `| { tipo: 'gasto'; gasto: GastoNormalizado }`, quitando su `;`):

```ts
  // T-27 pieza 2. La fila es de `movimiento_inventario` con id = clave; el
  // cliente (solo en la merma del cliente) es el del sobre.
  | {
      tipo: 'movimiento';
      movimiento: MovimientoNormalizado;
      clienteId: string | null;
    };
```

4. En el `switch` de `prepararProyeccion`, antes de `case 'merma':`:

```ts
    case 'movimiento': {
      // T-27 pieza 2. La forma y el cliente segun el tipo los revisa
      // `despacho-movimiento.ts`; la presentacion y el id ocupado,
      // `MovimientosService` dentro de la transaccion.
      const r = prepararMovimiento(op);
      if (!r.ok) return r;
      return {
        ok: true,
        proyeccion: {
          tipo: 'movimiento',
          movimiento: r.movimiento,
          clienteId: r.clienteId,
        },
      };
    }
```

**`apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`:**

1. Imports: `import { MovimientoRechazado } from '../inventario/movimiento-rechazado';`,
   `import { MovimientosService } from '../inventario/movimientos.service';` y
   `import { CODIGO_POR_RAZON_MOVIMIENTO } from './despacho-movimiento';`.
2. Constructor, después de `private readonly cargas: CargasService,`:

```ts
    // T-27 pieza 2: Inventario es el dueno de los movimientos (merma y consumo).
    private readonly movimientos: MovimientosService,
```

3. En el `catch` de `aplicar`, después del bloque `if (error instanceof GastoRechazado) { … }`:

```ts
      // T-27 pieza 2: el rollback ya dejo sin fila tanto el buzon como el movimiento.
      if (error instanceof MovimientoRechazado) {
        return {
          clave: op.clave,
          tipo: op.tipo,
          estado: 'rechazada',
          codigo: CODIGO_POR_RAZON_MOVIMIENTO[error.razon],
          motivo: error.message,
        };
      }
```

4. En el `switch` de `proyectar`, después del `case 'gasto': …`:

```ts
      case 'movimiento':
        // La entidad del buzon es la fila de `movimiento_inventario` (ADR-0009 §2.4, enmendado).
        return this.movimientos.registrarMovimiento(
          proyeccion.movimiento,
          {
            // T-27 pieza 2: la clave ES el id del movimiento (uuid validado en prepararMovimiento).
            id: op.clave,
            // Del token, nunca del cuerpo.
            sucursalId: vendedor.sucursal_id,
            vendedorId: vendedor.id,
            clienteId: proyeccion.clienteId,
            // Tal cual lo mando la tablet: el servidor no re-deriva el dia de UTC.
            fechaOperacion: op.fechaOperacion,
          },
          trx,
        );
```

**`apps/backend/src/modules/sincronizacion/sincronizacion.module.ts`:** agrega
`import { InventarioModule } from '../inventario/inventario.module';` y, en `imports`, después de `ProduccionModule,`:

```ts
    // T-27 pieza 2 suma Inventario: el dueno de los movimientos (merma y consumo).
    InventarioModule,
```

- [ ] **Paso 12: correr las unitarias y ver pasar**

```bash
npm test --workspace=apps/backend -- despacho datos-movimiento movimientos.service
npm run build --workspace=apps/backend
npm run typecheck --workspace=apps/tablet
```

Esperado: verde; el build compila (el `switch` de `proyectar` ya cubre `movimiento`); la tablet compila con su copia.

- [ ] **Paso 13: `consumoDiarioMax` en la sucursal y en el pull**

`apps/backend/src/modules/sucursales/dto/editar-sucursal.dto.ts`: cambia el import de `class-validator` por

```ts
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
```

y agrega al final de la clase:

```ts
  /**
   * T-27 pieza 2 (D4): "Consumo propio máximo por día". Piezas que cada vendedor
   * de la sucursal puede registrar como consumo propio en un dia; 0 lo apaga.
   * Mismo rango que el check de la base.
   */
  @IsOptional()
  @IsInt({ message: 'El consumo propio máximo es un número entero.' })
  @Min(0, { message: 'El consumo propio máximo va de 0 a 99.' })
  @Max(99, { message: 'El consumo propio máximo va de 0 a 99.' })
  consumoDiarioMax?: number;
```

`apps/backend/src/modules/sucursales/sucursales.repository.ts`:
- En `interface Sucursal`, después de `controlInventario: boolean;`: `/** T-27 pieza 2 (D4). */ consumoDiarioMax: number;`
- En `CAMPOS`, después de `'control_inventario as controlInventario',`: `'consumo_diario_max as consumoDiarioMax',`
- En la firma de `actualizar`, el tipo de `cambios` gana `consumo_diario_max?: number;`, y la primera frase del
  comentario del método pasa a decir "T-27 (D7) y pieza 2 (D4): si cambia `control_inventario` o `consumo_diario_max`,
  en la MISMA transaccion se toca `updated_at` de los vendedores de la sucursal." (el resto igual).

`apps/backend/src/modules/sucursales/sucursales.service.ts`, en `editar`:

```ts
    if (
      dto.nombre === undefined &&
      dto.activa === undefined &&
      dto.controlInventario === undefined &&
      dto.consumoDiarioMax === undefined
    ) {
      throw new BadRequestException('No hay nada que actualizar.');
    }
```

```ts
    const cambios: {
      nombre?: string;
      activa?: boolean;
      control_inventario?: boolean;
      consumo_diario_max?: number;
    } = {};
```

después de `if (dto.controlInventario !== undefined) { … }`:

```ts
    if (dto.consumoDiarioMax !== undefined) {
      cambios.consumo_diario_max = dto.consumoDiarioMax;
    }
```

y

```ts
    // T-27: si la peticion trae la casilla o el limite de consumo se toca a los
    // vendedores, siempre y dentro de la misma transaccion. Comparar contra el
    // valor leido antes dejaba que dos administradores simultaneos se saltaran el
    // toque. Los dos bajan en `VendedorPull` (Review Focus 5 de la pieza 2).
    const tocarVendedores =
      dto.controlInventario !== undefined || dto.consumoDiarioMax !== undefined;
```

`apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts`, en `vendedores()`: después de
`'sucursal.control_inventario as control_inventario',` agrega

```ts
        // T-27 pieza 2 (D4): el limite de consumo es de la sucursal, con el
        // mismo toque de `vendedor.updated_at` que la casilla.
        'sucursal.consumo_diario_max as consumo_diario_max',
```

y en el `map`, después de `control_inventario: f.control_inventario,`: `consumo_diario_max: f.consumo_diario_max,`.

- [ ] **Paso 14: el contrato legible (`docs/contrato-sincronizacion.md`)**

1. En el JSON de ejemplo del pull (§5, la línea con `"folio_segmento": "AP", "control_inventario": false, "activo": 1`),
   agrega `"consumo_diario_max": 1,` antes de `"activo": 1`.
2. Después de la sección de nivel 3 "`control_inventario` del vendedor (T-27)", agrega una sección de nivel 3 titulada
   "`consumo_diario_max` del vendedor (T-27 pieza 2)" con este texto:

```markdown
`VendedorPull.consumo_diario_max` es el "Consumo propio máximo por día" de **su sucursal** (entero 0–99, 1 por
defecto). La tablet no deja registrar en el día más piezas de consumo propio que ese límite, y con 0 no lo ofrece. El
servidor **no** lo revisa en el push. Cambiarlo en el portal toca `updated_at` de los vendedores de esa sucursal (igual
que `control_inventario`), así que baja en el pull incremental aunque el vendedor no haya cambiado. Aditivo; un
servidor anterior no lo manda y la tablet conserva lo que tenía (1 la primera vez).
```

3. En §6, en el comentario del ejemplo `// jornada|venta|cobranza|gasto|merma|ruta|prospecto|ruta-alta|visita`, agrega
   `|movimiento`.
4. Cambia el párrafo "`datos` lo fija el ticket de cada módulo…" para que diga que hoy tienen forma fija **`venta`**,
   **`prospecto`**, **`cobranza`**, **`jornada`**, **`ruta-alta`**, **`visita`**, **`gasto`** y **`movimiento`** (T-27
   pieza 2), "los ocho abajo; `merma` y `ruta` siguen reservados sin forma, y el servidor los guarda tal cual".
5. En las dos líneas "**Orden del push**: `jornadas → prospectos → ventas → cobranzas → visitas → gastos → rutas`"
   (visita y gasto) agrega `movimientos` entre `gastos` y `rutas`.
6. Después de la sección de nivel 3 "`datos` de un gasto de la ruta (T-30/T-31)" (antes de la de Fotos), agrega una
   sección de nivel 3 titulada "`datos` de un movimiento de inventario (T-27 pieza 2)" con este texto:

````markdown
```jsonc
{
  "clave": "uuid de la fila local",     // ES el id del movimiento en el servidor: debe ser uuid
  "tipo": "movimiento",
  "fecha_operacion": "2026-10-23",      // el día al que cuenta (el corte de inventario)
  "ocurrido_en": "2026-10-23T18:40:00.000Z",
  "cliente_id": "uuid",                 // SOLO en merma_cliente; pasa por el alcance del lote. Sin "folio"
  "datos": {
    "tipo": "merma_cliente",            // merma_cliente | merma_trayecto | consumo
    "comentario": null,                 // opcional, <= 300
    "registrado_en": "2026-10-23T11:40:00-07:00",
    "lineas": [
      { "presentacion_id": "uuid", "sentido": "recibido", "piezas": 3 },  // lo dañado que devolvió
      { "presentacion_id": "uuid", "sentido": "entregado", "piezas": 2 }  // la reposición
    ]
  }
}
```

- La forma se valida **antes** de la transacción (`prepararMovimiento` + `normalizarDatosMovimiento`): clave no uuid,
  folio en el sobre, `cliente_id` presente en `merma_trayecto`/`consumo` o ausente en `merma_cliente`, o `datos` mal
  formado es `datos-invalidos` con un motivo que nombra el campo. Una `merma_cliente` lleva al menos una línea
  `recibido`; `merma_trayecto` y `consumo`, solo líneas `entregado` (al menos una). Piezas enteras 1–99 999; una
  presentación una sola vez por sentido; de 1 a 200 líneas; el comentario se recorta y uno vacío es `null`.
- Dentro de la transacción (`MovimientosService.registrarMovimiento`, `modules/inventario/`): una presentación que
  nunca existió es `datos-invalidos` (una dada de baja **sí** se acepta); un id que ya ocupa otro movimiento es
  `movimiento-id-ocupado`, con motivo neutro. La misma clave reenviada es `duplicada`.
- **El servidor no revisa el límite de consumo ni la existencia**: las piezas ya salieron; lo exige la tablet.
- Se guarda en `movimiento_inventario` con `id = clave`, `fecha = fecha_operacion` y la sucursal del token, y sus
  líneas en `movimiento_inventario_linea`. El buzón apunta a esa fila (`entidad_tabla = 'movimiento_inventario'`).
- **Orden del push**: `jornadas → prospectos → ventas → cobranzas → visitas → gastos → movimientos → rutas`. Una
  merma a un prospecto cuya alta viaja en el mismo lote cae `cliente-fuera-de-alcance` (como la visita) y entra en el
  lote siguiente con la misma clave.
````

7. En la tabla "Códigos de rechazo", después de la fila de `gasto-id-ocupado`:

```markdown
| `movimiento-id-ocupado` | El id (la clave) del movimiento de inventario ya lo ocupa otro registro. Motivo neutro; avisar a la oficina (T-27 pieza 2) |
```

8. En §7 "Una transacción por operación": agrega `movimiento` a la lista "(hoy `venta`, `cobranza`, …, `gasto`)"; después
   del punto de `GastosService.registrarGasto`:

```markdown
   - `MovimientosService.registrarMovimiento` (T-27 pieza 2) → comprueba que existan las presentaciones (**aunque
     estén dadas de baja**), inserta en `movimiento_inventario` con `id = clave` y `on conflict (id) do nothing` (si no
     insertó, `movimiento-id-ocupado`) y luego sus líneas. La entidad es la fila de `movimiento_inventario`.
```

   agrega `movimiento-id-ocupado` a la lista de rechazos del dominio del punto 3, y cambia "Los tipos sin módulo todavía
   (`merma`, `ruta`)" por "Los tipos reservados sin módulo (`merma`, `ruta`)".

- [ ] **Paso 15: correr todo y ver pasar**

```bash
npm test --workspace=apps/backend -- despacho datos-movimiento movimientos.service operaciones
npm run test:e2e --workspace=apps/backend -- movimiento.e2e gasto.e2e visita.e2e cargas-app.e2e sucursales.e2e sincronizacion.e2e
npm run build --workspace=apps/backend
npm run typecheck --workspace=apps/tablet
```

Esperado: todo verde (las suites vecinas confirman que el despacho y la sucursal no rompieron nada).

- [ ] **Paso 16: lint por archivo y commit**

```bash
npm exec --workspace=apps/backend -- prettier --write \
  src/modules/inventario/datos-movimiento.ts src/modules/inventario/datos-movimiento.spec.ts \
  src/modules/inventario/movimiento-rechazado.ts src/modules/inventario/movimientos.repository.ts \
  src/modules/inventario/movimientos.service.ts src/modules/inventario/movimientos.service.spec.ts \
  src/modules/inventario/inventario.module.ts \
  src/modules/sincronizacion/despacho-movimiento.ts src/modules/sincronizacion/despacho-movimiento.spec.ts \
  src/modules/sincronizacion/despacho.ts src/modules/sincronizacion/despacho.spec.ts \
  src/modules/sincronizacion/sincronizacion.service.ts src/modules/sincronizacion/sincronizacion.module.ts \
  src/modules/sincronizacion/sincronizacion.repository.ts src/modules/sincronizacion/contrato.ts \
  src/modules/sucursales/dto/editar-sucursal.dto.ts src/modules/sucursales/sucursales.repository.ts \
  src/modules/sucursales/sucursales.service.ts test/movimiento.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint \
  src/modules/inventario/datos-movimiento.ts src/modules/inventario/datos-movimiento.spec.ts \
  src/modules/inventario/movimiento-rechazado.ts src/modules/inventario/movimientos.repository.ts \
  src/modules/inventario/movimientos.service.ts src/modules/inventario/movimientos.service.spec.ts \
  src/modules/inventario/inventario.module.ts \
  src/modules/sincronizacion/despacho-movimiento.ts src/modules/sincronizacion/despacho-movimiento.spec.ts \
  src/modules/sincronizacion/despacho.ts src/modules/sincronizacion/despacho.spec.ts \
  src/modules/sincronizacion/sincronizacion.service.ts src/modules/sincronizacion/sincronizacion.module.ts \
  src/modules/sincronizacion/sincronizacion.repository.ts src/modules/sincronizacion/contrato.ts \
  src/modules/sucursales/dto/editar-sucursal.dto.ts src/modules/sucursales/sucursales.repository.ts \
  src/modules/sucursales/sucursales.service.ts test/movimiento.e2e-spec.ts
npm run lint --workspace=apps/tablet
git add apps/backend/src/modules/inventario apps/backend/src/modules/sincronizacion apps/backend/src/modules/sucursales \
  apps/backend/test/movimiento.e2e-spec.ts apps/tablet/src/sincronizacion/contrato.ts docs/contrato-sincronizacion.md
git status
git commit -m "T-27: operación movimiento en el push y consumo diario de la sucursal en el pull

Refs #27

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Las rutas de `prettier`/`eslint` son relativas a `apps/backend`, porque `npm exec --workspace` corre ahí.) Si
`eslint` marca la variable `_c` del spec de `datos-movimiento` como no usada pese al `void`, reemplaza esa
desestructuración por `const sin: Record<string, unknown> = { ...datos() }; delete sin.comentario;`.

---

### Tarea 3: Portal: "Consumo propio máximo por día" en *Catálogo › Sucursales* (portal del spec, D4)

**Files:**
- Create: `apps/portal/src/components/sucursales/consumo-diario.ts`
- Create: `apps/portal/src/components/sucursales/consumo-diario.test.ts`
- Modify: `apps/portal/src/lib/sucursales.ts`
- Modify: `apps/portal/src/components/sucursales/formulario-sucursal.tsx`
- Modify: `apps/portal/src/components/sucursales/pantalla-sucursales.test.tsx`
- Modify (fixtures de `Sucursal`, solo `consumoDiarioMax: 1`): `components/vendedores/pantalla-vendedores.test.tsx`,
  `components/promociones/pantalla-promociones.test.tsx`, `components/promociones/formulario-promocion.test.tsx`,
  `components/tesoreria/pestana-cuentas.test.tsx`, `components/layout/use-sucursal-actual.test.tsx`,
  `components/layout/marco-portal.test.tsx`, `components/layout/bloque-sucursal.test.tsx`,
  `components/usuarios/pantalla-usuarios.test.tsx`, `components/produccion/pantalla-recarga.test.tsx` (todas bajo
  `apps/portal/src/`)

**Interfaces:**
- Consumes: `PATCH /sucursales/:id` con `consumoDiarioMax` y la respuesta con `consumoDiarioMax` (Tarea 2).
- Produces: `Sucursal.consumoDiarioMax: number`; `editarSucursal(id, { …, consumoDiarioMax?: number })`;
  `leerConsumoDiarioMax(texto: string): number | null`, `AYUDA_CONSUMO_DIARIO`, `ERROR_CONSUMO_DIARIO`.

La validación vive en `components/sucursales/consumo-diario.ts` y **no** en `lib/sucursales.ts`: la prueba de la
pantalla hace `vi.mock("@/lib/sucursales")`, que reemplazaría una función pura de ahí por un mock vacío.

- [ ] **Paso 1: la validación, prueba que falla**

`apps/portal/src/components/sucursales/consumo-diario.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AYUDA_CONSUMO_DIARIO, leerConsumoDiarioMax } from "./consumo-diario";

describe("leerConsumoDiarioMax (T-27 pieza 2, D4)", () => {
  it.each([
    ["1", 1],
    ["0", 0],
    ["99", 99],
    [" 7 ", 7],
    ["05", 5],
  ])("%j es %d", (texto, esperado) => {
    expect(leerConsumoDiarioMax(texto)).toBe(esperado);
  });

  it.each(["", "100", "-1", "1.5", "uno", "1e1"])("%j no vale", (texto) => {
    expect(leerConsumoDiarioMax(texto)).toBeNull();
  });

  it("la ayuda es la del spec", () => {
    expect(AYUDA_CONSUMO_DIARIO).toBe(
      "Piezas que cada vendedor puede registrar como consumo propio en un día.",
    );
  });
});
```

```bash
npm test --workspace=apps/portal -- consumo-diario
```

Esperado: falla (`Failed to resolve import "./consumo-diario"`).

- [ ] **Paso 2: la validación**

`apps/portal/src/components/sucursales/consumo-diario.ts`:

```ts
/**
 * "Consumo propio máximo por día" de la sucursal (T-27 pieza 2, D4): piezas que
 * cada vendedor puede registrar como consumo propio en un día. Entero de 0 a 99
 * (0 lo apaga), el mismo rango que el check de la base y el DTO del backend.
 */
export const AYUDA_CONSUMO_DIARIO = "Piezas que cada vendedor puede registrar como consumo propio en un día.";
export const ERROR_CONSUMO_DIARIO = "Escribe un número entero de 0 a 99.";

/** El texto del campo a número, o `null` si no es un entero de 0 a 99. */
export function leerConsumoDiarioMax(texto: string): number | null {
  const limpio = texto.trim();
  if (!/^\d{1,2}$/.test(limpio)) return null;
  return Number(limpio);
}
```

```bash
npm test --workspace=apps/portal -- consumo-diario
```

Esperado: verde.

- [ ] **Paso 3: la pantalla, prueba que falla**

**Primero** los fixtures (antes de escribir las pruebas nuevas, para que la pasada no las toque): `Sucursal` gana un campo obligatorio, así que todos los objetos de prueba que ya llevan
`controlInventario` necesitan `consumoDiarioMax`. Con una sola pasada (agrega `, consumoDiarioMax: 1` detrás de cada
`controlInventario: false|true` que no lo tenga, incluidas las expectativas de `editarSucursal`, porque el formulario ahora
también lo manda):

```bash
perl -pi -e 's/controlInventario: (false|true)(?!, consumoDiarioMax)/controlInventario: $1, consumoDiarioMax: 1/g' \
  apps/portal/src/components/sucursales/pantalla-sucursales.test.tsx \
  apps/portal/src/components/vendedores/pantalla-vendedores.test.tsx \
  apps/portal/src/components/promociones/pantalla-promociones.test.tsx \
  apps/portal/src/components/promociones/formulario-promocion.test.tsx \
  apps/portal/src/components/tesoreria/pestana-cuentas.test.tsx \
  apps/portal/src/components/layout/use-sucursal-actual.test.tsx \
  apps/portal/src/components/layout/marco-portal.test.tsx \
  apps/portal/src/components/layout/bloque-sucursal.test.tsx \
  apps/portal/src/components/usuarios/pantalla-usuarios.test.tsx \
  apps/portal/src/components/produccion/pantalla-recarga.test.tsx
git diff --stat apps/portal/src
```

Revisa el diff de `pantalla-sucursales.test.tsx`: en "edita una sucursal existente…" y "T-27: prende el control…" la expectativa queda con
`consumoDiarioMax: 1` (lo que el formulario manda sin tocar el campo).

**Después**, en `apps/portal/src/components/sucursales/pantalla-sucursales.test.tsx`, agrega al final del `describe`:

```tsx
  it("T-27 pieza 2: cambia el consumo propio máximo por día desde la edición", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarSucursales.mockResolvedValueOnce([TIJUANA]);
    editarSucursal.mockResolvedValue({ ...TIJUANA, consumoDiarioMax: 3 });
    listarSucursales.mockResolvedValueOnce([{ ...TIJUANA, consumoDiarioMax: 3 }]);

    render(<PantallaSucursales sucursal={null} />);
    await screen.findByText("TJ");

    await usuario.click(screen.getByRole("button", { name: "Editar" }));
    const ventana = screen.getByRole("dialog", { name: "Editar TJ" });
    const campo = within(ventana).getByLabelText("Consumo propio máximo por día") as HTMLInputElement;
    expect(campo.value).toBe("1");
    expect(
      within(ventana).getByText("Piezas que cada vendedor puede registrar como consumo propio en un día."),
    ).toBeInTheDocument();

    await usuario.clear(campo);
    await usuario.type(campo, "3");
    await usuario.click(within(ventana).getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(editarSucursal).toHaveBeenCalledWith("1", {
        nombre: "Tijuana",
        activa: true,
        controlInventario: false,
        consumoDiarioMax: 3,
      }),
    );
  });

  it("T-27 pieza 2: el alta no pide el consumo (nace con 1)", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarSucursales.mockResolvedValue([]);

    render(<PantallaSucursales sucursal={null} />);
    await screen.findByText("No hay sucursales que mostrar.");
    await usuario.click(screen.getByRole("button", { name: "Nueva sucursal" }));
    const ventana = screen.getByRole("dialog", { name: "Nueva sucursal" });
    expect(within(ventana).queryByLabelText("Consumo propio máximo por día")).not.toBeInTheDocument();
  });
```

```bash
npm test --workspace=apps/portal -- pantalla-sucursales
```

Esperado: fallan las dos pruebas nuevas (no hay campo "Consumo propio máximo por día") y las dos de edición (el
formulario todavía no manda `consumoDiarioMax`).

- [ ] **Paso 4: el tipo y el formulario**

`apps/portal/src/lib/sucursales.ts`: en `interface Sucursal`, después de `controlInventario: boolean;`:

```ts
  /** T-27 pieza 2 (D4): "Consumo propio máximo por día" (0–99). */
  consumoDiarioMax: number;
```

y en `editarSucursal`, el tipo de `cambios` pasa a
`{ nombre?: string; activa?: boolean; controlInventario?: boolean; consumoDiarioMax?: number }`.

`apps/portal/src/components/sucursales/formulario-sucursal.tsx`:

1. Import nuevo: `import { AYUDA_CONSUMO_DIARIO, ERROR_CONSUMO_DIARIO, leerConsumoDiarioMax } from "./consumo-diario";`
2. Estado, después de `controlInventario`:

```tsx
  const [consumo, setConsumo] = useState(String(sucursal?.consumoDiarioMax ?? 1));
  const consumoDiarioMax = leerConsumoDiarioMax(consumo);
```

3. `alEnviar` completo:

```tsx
  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    // El campo ya pinta su error; con un valor que no vale no se manda nada.
    if (sucursal && consumoDiarioMax === null) return;
    await enviar(
      () =>
        sucursal
          ? editarSucursal(sucursal.id, {
              nombre,
              activa,
              controlInventario,
              consumoDiarioMax: consumoDiarioMax ?? 1,
            })
          : crearSucursal({ codigo, nombre }),
      alGuardar,
    );
  }
```

4. Después del bloque `{!esAlta && ( <div …> <Casilla etiqueta="Control de inventario en la app" … /> … </div> )}`:

```tsx
      {!esAlta && (
        <Campo
          id="consumo-diario-max"
          etiqueta="Consumo propio máximo por día"
          ayuda={AYUDA_CONSUMO_DIARIO}
          error={consumoDiarioMax === null ? ERROR_CONSUMO_DIARIO : null}
        >
          <Entrada
            id="consumo-diario-max"
            name="consumoDiarioMax"
            type="number"
            inputMode="numeric"
            min={0}
            max={99}
            step={1}
            disabled={enviando}
            value={consumo}
            onChange={(e) => setConsumo(e.target.value)}
            className="w-24"
          />
        </Campo>
      )}
```

5. El botón Guardar: `<Button type="submit" disabled={enviando || (!esAlta && consumoDiarioMax === null)}>`.

- [ ] **Paso 5: correr y ver pasar**

```bash
npm test --workspace=apps/portal -- pantalla-sucursales consumo-diario
npm test --workspace=apps/portal
npx tsc --noEmit -p apps/portal
npm run lint --workspace=apps/portal
```

Esperado: verde; `tsc` sin errores (si queda algún objeto `Sucursal` sin `consumoDiarioMax` que el `perl` no tocó,
`tsc` lo nombra: agrégale `consumoDiarioMax: 1`).

- [ ] **Paso 6: aceptación en el navegador (controlador)**

Con backend y portal de este worktree levantados contra el Supabase local: *Catálogo › Sucursales* → Editar TJ en una
ventana de **1366 px**. El campo cabe en la `Ventana` sin scroll de lado, con su ayuda; poner 3, Guardar, volver a
Editar → dice 3; poner 100 → el navegador no deja enviar (o se ve "Escribe un número entero de 0 a 99." y Guardar queda
deshabilitado). Restablecer a 1 al terminar.

- [ ] **Paso 7: commit**

```bash
git add apps/portal/src
git status
git commit -m "T-27: consumo propio máximo por día en Catálogo › Sucursales

Refs #27

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 4: Tablet, datos: migración 018, mezcla del pull, reglas puras, `movimientos.registrar` y la fuente del push (datos, lógica pura y repositorio del spec, D4, D5, D6, D7)

**Files:**
- Create: `apps/tablet/src/datos/migraciones/018-movimientos.ts`, `018-movimientos.spec.ts`
- Modify: `apps/tablet/src/datos/migraciones/index.ts`, `017-cargas.spec.ts` (solo la primera prueba)
- Modify: `apps/tablet/src/datos/tipos.ts`
- Modify: `apps/tablet/src/datos/repositorios/catalogos.ts`
- Create: `apps/tablet/src/datos/movimientos-reglas.ts`, `movimientos-reglas.spec.ts`
- Modify: `apps/tablet/src/datos/inventario-reglas.ts`, `inventario-reglas.spec.ts`
- Modify: `apps/tablet/src/datos/repositorios/cargas.ts`, `cargas.spec.ts` (solo la prueba de `filasInventario`)
- Modify: `apps/tablet/src/datos/repositorios/ventas.ts`
- Create: `apps/tablet/src/datos/repositorios/movimientos.ts`, `movimientos.spec.ts`
- Modify: `apps/tablet/src/datos/inicializar.ts`, `apps/tablet/src/datos/index.ts`
- Create: `apps/tablet/src/sincronizacion/fuente-movimientos.ts`, `fuente-movimientos.spec.ts`
- Modify: `apps/tablet/src/sincronizacion/fuentes.ts`, `fuentes.spec.ts`, `pendientes.ts`, `pendientes.spec.ts`,
  `motor.ts` (comentario), `motor.spec.ts`

**Interfaces:**
- Consumes: `DatosMovimiento`, `VendedorPull.consumo_diario_max?` y `'movimiento'` de `src/sincronizacion/contrato.ts`
  (Tarea 2); `leerInventarioDelDia`, `bloqueoDeVenta`, `faltantesDeVenta`, `textoFaltante`, `exigirJornadaAbierta` y
  `enTransaccion` (pieza 1 y anteriores).
- Produces:
  - Tipos (`src/datos/tipos.ts`): `TipoMovimiento = 'merma_cliente' | 'merma_trayecto' | 'consumo'`,
    `SentidoMovimiento = 'recibido' | 'entregado'`, `interface Movimiento`, `interface MovimientoLinea`,
    `Vendedor.consumo_diario_max: number`.
  - `src/datos/movimientos-reglas.ts`: `MAX_PIEZAS_MOVIMIENTO = 99_999`, `LARGO_MAX_COMENTARIO_MOVIMIENTO = 300`,
    `MENSAJE_FALTA_RECIBIDO`, `MENSAJE_SIN_PIEZAS`, `MENSAJE_CONSUMO_AGOTADO`, `MENSAJE_SIN_CONSUMO`,
    `interface LineaMovimiento { presentacionId; sentido; piezas }`, `interface EntradaMovimiento { tipo; clienteId:
    string | null; lineas; comentario: string | null }`, `validarMovimiento(e): string[]`,
    `consumoRestante({ limite, consumoDeHoy }): number`, `motivoDeConsumo({ limite, consumoDeHoy, piezas }): string |
    null`, `textoConsumoRestante(n): string`.
  - `src/datos/inventario-reglas.ts`: `interface LineaMovimientoInventario { fecha; tipo; sentido; presentacion_id;
    piezas }`; `Existencia` gana `mermaEntregada`, `mermaTrayecto`, `consumo`, `mermaRecibida`, `mermaPorRegresar`;
    `existencias(cargas, ventas, hoy, movimientos = [])`; `faltantesDeMovimiento({ controlInventario, existencias,
    lineasQueSalen }): Faltante[]`; `consumoDelDia(movimientos, hoy): number`.
  - `leerInventarioDelDia(bd, vendedorId, fecha)` devuelve además `consumoDiarioMax: number` y
    `movimientos: LineaMovimientoInventario[]`.
  - `crearRepositorioMovimientos(deps, { catalogos })` → `registrar(datos: DatosRegistroMovimiento):
    MovimientoConLineas`, `porId`, `delDia(vendedorId, fecha?)`, `delDiaDelCliente(clienteId, fecha?)`,
    `consumoDeHoy(vendedorId)`, `consumoDiarioMax(vendedorId)`, `presentaciones(): PresentacionMovimiento[]`,
    `pendientesDeSincronizar()`, `marcarSincronizada(id)`, `marcarError(id, motivo)`; `ErrorMovimiento`.
  - `CapaDatos.movimientos`, `FuentesConPendientes.movimientos`, `fuenteMovimientos(repo): FuenteOperaciones`.

- [ ] **Paso 1: la migración 018, prueba que falla**

`apps/tablet/src/datos/migraciones/018-movimientos.spec.ts`:

```ts
import type { BaseDatos } from '../base-datos';
import { depsDePrueba, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from '../repositorios/catalogos';
import { migraciones, versionEsquema } from './index';

/**
 * La 018 trae los movimientos de inventario (T-27 pieza 2): `movimiento` y
 * `movimiento_linea`, que escribe la tablet y sube el push, y el limite de
 * consumo propio de la sucursal (`vendedor.consumo_diario_max`).
 */

function baseAlDia(): BaseDatos {
  const deps = depsDePrueba();
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
  return deps.bd;
}

function insertarMovimiento(bd: BaseDatos, cambios: Record<string, string | number | null> = {}) {
  const fila: Record<string, string | number | null> = {
    id: 'mov-1',
    fecha: '2026-08-07',
    vendedor_id: 'ven-1',
    cliente_id: 'cli-1',
    tipo: 'merma_cliente',
    registrado_en: '2026-08-07T15:00:00.000Z',
    ...cambios,
  };
  const columnas = Object.keys(fila);
  bd.runSync(
    `insert into movimiento (${columnas.join(', ')}) values (${columnas.map((c) => `$${c}`).join(', ')})`,
    Object.fromEntries(columnas.map((c) => [`$${c}`, fila[c] ?? null])),
  );
}

describe('migracion 018: movimientos (T-27 pieza 2)', () => {
  it('la 018 es la ultima y deja versionEsquema en 18', () => {
    expect(migraciones[17]?.nombre).toBe('movimientos');
    expect(migraciones[17]?.version).toBe(18);
    expect(migraciones).toHaveLength(18);
    expect(versionEsquema(baseAlDia())).toBe(18);
  });

  it('el vendedor que ya estaba queda con consumo diario 1 y no acepta negativos', () => {
    const bd = baseAlDia();
    expect(
      bd.getFirstSync('select consumo_diario_max from vendedor where id = $id', { $id: 'ven-1' }),
    ).toEqual({ consumo_diario_max: 1 });
    expect(() => bd.execSync("update vendedor set consumo_diario_max = -1 where id = 'ven-1'")).toThrow(/CHECK/);
  });

  it('un movimiento nace pendiente; solo la merma del cliente lleva cliente', () => {
    const bd = baseAlDia();
    insertarMovimiento(bd);
    expect(
      bd.getFirstSync('select sync_estado, sync_error, comentario from movimiento where id = $id', { $id: 'mov-1' }),
    ).toEqual({ sync_estado: 'pendiente', sync_error: null, comentario: null });
    expect(() => insertarMovimiento(bd, { id: 'mov-2', cliente_id: null })).toThrow(/CHECK/);
    expect(() => insertarMovimiento(bd, { id: 'mov-3', tipo: 'consumo' })).toThrow(/CHECK/);
    expect(() => insertarMovimiento(bd, { id: 'mov-4', tipo: 'consumo', cliente_id: null })).not.toThrow();
    expect(() => insertarMovimiento(bd, { id: 'mov-5', tipo: 'cambio', cliente_id: null })).toThrow(/CHECK/);
    expect(() => insertarMovimiento(bd, { id: 'mov-6', cliente_id: 'no-existe' })).toThrow(/FOREIGN KEY/);
  });

  it('las lineas cuelgan de su movimiento, con piezas > 0 y una vez por presentacion y sentido', () => {
    const bd = baseAlDia();
    insertarMovimiento(bd);
    const linea = (sentido: string, piezas: number, movimiento = 'mov-1') =>
      bd.runSync(
        'insert into movimiento_linea (movimiento_id, presentacion_id, sentido, piezas) values ($m, $p, $s, $n)',
        { $m: movimiento, $p: 'pre-1', $s: sentido, $n: piezas },
      );
    linea('recibido', 3);
    linea('entregado', 3);
    expect(() => linea('recibido', 1)).toThrow(/UNIQUE|PRIMARY/);
    expect(() => linea('perdido', 1)).toThrow(/CHECK/);
    expect(() => linea('entregado', 0, 'mov-1')).toThrow(/UNIQUE|PRIMARY|CHECK/);
    expect(() => linea('recibido', 1, 'no-existe')).toThrow(/FOREIGN KEY/);
  });
});
```

En `apps/tablet/src/datos/migraciones/017-cargas.spec.ts`, la primera prueba pasa a ser:

```ts
  it('la 017 es cargas y deja de ser la ultima con la 018 (T-27 pieza 2)', () => {
    expect(migraciones[16]?.nombre).toBe('cargas');
    expect(migraciones[16]?.version).toBe(17);
    expect(versionEsquema(baseAlDia())).toBe(migraciones.length);
  });
```

```bash
npm test --workspace=apps/tablet -- migraciones
```

Esperado: falla la de la 018 (`migraciones[17]` es `undefined`).

- [ ] **Paso 2: la migración, los tipos y la mezcla del pull**

`apps/tablet/src/datos/migraciones/018-movimientos.ts`:

```ts
import type { Migracion } from './motor';

/**
 * Los movimientos de inventario en la tablet (T-27 pieza 2): la merma del
 * cliente, la merma del trayecto y el consumo propio.
 *
 * - `movimiento`: lo escribe la tablet y lo sube el push (`tipo: 'movimiento'`).
 *   `id` = clave de idempotencia y, en el servidor, el id de la fila (como el
 *   gasto). Solo la merma del cliente lleva `cliente_id` (mismo check que el
 *   servidor). No se edita ni se borra en la app (D6). `tipo` lleva check: lo
 *   escribe solo la tablet, nunca el pull.
 * - `movimiento_linea`: piezas por presentacion y sentido (`recibido` = lo danado
 *   que devuelve el cliente; `entregado` = sale de la camioneta). Sin llave
 *   foranea a `presentacion`, como `carga_detalle`.
 * - `vendedor.consumo_diario_max` (D4): el limite de su sucursal; nace en 1 (el
 *   default del servidor) hasta el pull.
 *
 * Tablas nuevas y un `add column` con default: no rehace nada.
 */
export const movimientos: Migracion = {
  version: 18,
  nombre: 'movimientos',
  sql: `
    create table movimiento (
      id              text primary key,           -- = clave de idempotencia
      fecha           text not null,              -- dia de trabajo (fecha_operacion)
      vendedor_id     text not null references vendedor(id),
      cliente_id      text references cliente(id),  -- solo la merma del cliente
      tipo            text not null check (tipo in ('merma_cliente', 'merma_trayecto', 'consumo')),
      comentario      text,
      registrado_en   text not null,              -- ISO; viaja como ocurrido_en
      sync_estado     text not null default 'pendiente'
                        check (sync_estado in ('pendiente','enviando','sincronizado','error')),
      sync_error      text,
      sincronizado_en text,
      check ((tipo = 'merma_cliente') = (cliente_id is not null))
    );
    -- Lo que falta por subir (mismo patron que idx_gasto_sync).
    create index idx_movimiento_sync on movimiento (sync_estado) where sync_estado <> 'sincronizado';
    -- "Movimientos de hoy" del menu, el consumo del dia y el inventario.
    create index idx_movimiento_vendedor_fecha on movimiento (vendedor_id, fecha);
    -- "Movimientos de hoy" de la ficha del cliente.
    create index idx_movimiento_cliente_fecha on movimiento (cliente_id, fecha) where cliente_id is not null;

    create table movimiento_linea (
      movimiento_id   text not null references movimiento(id),
      presentacion_id text not null,
      sentido         text not null check (sentido in ('recibido', 'entregado')),
      piezas          integer not null check (piezas > 0),
      primary key (movimiento_id, presentacion_id, sentido)
    );

    alter table vendedor add column consumo_diario_max integer not null default 1
      check (consumo_diario_max >= 0);
  `,
};
```

`apps/tablet/src/datos/migraciones/index.ts`: `import { movimientos } from './018-movimientos';` (después del de
`017-cargas`) y `movimientos,` al final de la lista `migraciones` (después de `cargas,`).

`apps/tablet/src/datos/tipos.ts`:

1. En `interface Vendedor`, después de `control_inventario: Booleano;`:

```ts
  /**
   * T-27 pieza 2 (D4): piezas de consumo propio que puede registrar en un dia
   * (el de su sucursal; 0 = no se ofrece). Baja en el pull; el login sin red no
   * lo pisa.
   */
  consumo_diario_max: number;
```

2. Al final del archivo:

```ts
/** T-27 pieza 2: los movimientos que no son venta (D1, D3). */
export type TipoMovimiento = 'merma_cliente' | 'merma_trayecto' | 'consumo';

/** `recibido` = entra a la camioneta (lo danado que devuelve el cliente); `entregado` = sale. */
export type SentidoMovimiento = 'recibido' | 'entregado';

/** Un movimiento de inventario (T-27 pieza 2). No se edita ni se borra en la app (D6). */
export interface Movimiento {
  id: string;
  /** Dia de trabajo (`reloj.hoy()`), el de `fecha_operacion`. */
  fecha: FechaISO;
  vendedor_id: string;
  /** Solo en la merma del cliente. */
  cliente_id: string | null;
  tipo: TipoMovimiento;
  comentario: string | null;
  /** Cuando lo guardo el vendedor. Viaja como `ocurrido_en` y `datos.registrado_en`. */
  registrado_en: MomentoISO;
  sync_estado: SyncEstado;
  sync_error: string | null;
  sincronizado_en: MomentoISO | null;
}

export interface MovimientoLinea {
  movimiento_id: string;
  presentacion_id: string;
  sentido: SentidoMovimiento;
  piezas: number;
}
```

`apps/tablet/src/datos/repositorios/catalogos.ts`:

1. En `SnapshotCatalogos`, el campo `vendedores` y su comentario:

```ts
  /**
   * T-27: `control_inventario` (pieza 1) y `consumo_diario_max` (pieza 2) son
   * opcionales aqui: un servidor anterior no los manda y el login sin red no los
   * conoce. Ausentes, el upsert conserva lo que habia (0 y 1 en una fila nueva);
   * ver NO_BORRAR_CON_NULO.
   */
  vendedores?: (Omit<Vendedor, 'sincronizado_en' | 'control_inventario' | 'consumo_diario_max'> &
    Partial<Pick<Vendedor, 'control_inventario' | 'consumo_diario_max'>>)[];
```

2. En `COLUMNAS.vendedor`, después de `'control_inventario',`:

```ts
    // T-27 pieza 2 (D4): el limite de consumo de su sucursal. El login sin red no lo pisa.
    'consumo_diario_max',
```

3. `NO_BORRAR_CON_NULO` (y una línea más en su comentario: "T-27 pieza 2: `consumo_diario_max`, igual; nace en 1, el
   default del servidor."):

```ts
const NO_BORRAR_CON_NULO: Record<string, Record<string, string>> = {
  vendedor: { folio_segmento: 'null', control_inventario: '0', consumo_diario_max: '1' },
};
```

- [ ] **Paso 3: correr y ver pasar**

```bash
npm test --workspace=apps/tablet -- migraciones catalogos cargas
npm run typecheck --workspace=apps/tablet
```

Esperado: verde. (El `aSnapshot` de `motor.ts` ya pasa `consumo_diario_max` tal cual, porque esparce `...v`.)

- [ ] **Paso 4: las reglas puras, pruebas que fallan**

`apps/tablet/src/datos/movimientos-reglas.spec.ts`:

```ts
import {
  consumoRestante,
  LARGO_MAX_COMENTARIO_MOVIMIENTO,
  MENSAJE_CONSUMO_AGOTADO,
  MENSAJE_FALTA_RECIBIDO,
  MENSAJE_SIN_CONSUMO,
  MENSAJE_SIN_PIEZAS,
  motivoDeConsumo,
  textoConsumoRestante,
  validarMovimiento,
  type EntradaMovimiento,
} from './movimientos-reglas';

/** La forma de un movimiento y el limite de consumo (T-27 pieza 2), sin SQLite. */

const merma = (extra: Partial<EntradaMovimiento> = {}): EntradaMovimiento => ({
  tipo: 'merma_cliente',
  clienteId: 'cli-1',
  comentario: null,
  lineas: [
    { presentacionId: 'pre-1', sentido: 'recibido', piezas: 3 },
    { presentacionId: 'pre-2', sentido: 'entregado', piezas: 2 },
  ],
  ...extra,
});

const trayecto = (extra: Partial<EntradaMovimiento> = {}): EntradaMovimiento => ({
  tipo: 'merma_trayecto',
  clienteId: null,
  comentario: null,
  lineas: [{ presentacionId: 'pre-1', sentido: 'entregado', piezas: 1 }],
  ...extra,
});

describe('validarMovimiento', () => {
  it('una merma del cliente con lo recibido y la reposicion es valida; tambien sin reposicion', () => {
    expect(validarMovimiento(merma())).toEqual([]);
    expect(validarMovimiento(merma({ lineas: [{ presentacionId: 'pre-1', sentido: 'recibido', piezas: 1 }] }))).toEqual([]);
  });

  it('Review Focus 3: merma del cliente sin lo recibido', () => {
    expect(
      validarMovimiento(merma({ lineas: [{ presentacionId: 'pre-2', sentido: 'entregado', piezas: 2 }] })),
    ).toEqual([MENSAJE_FALTA_RECIBIDO]);
    expect(validarMovimiento(merma({ lineas: [] }))).toEqual([MENSAJE_FALTA_RECIBIDO]);
    expect(MENSAJE_FALTA_RECIBIDO).toBe('Captura al menos una pieza en «Recibí dañado».');
  });

  it('la merma del cliente necesita al cliente; el trayecto y el consumo no lo llevan', () => {
    expect(validarMovimiento(merma({ clienteId: null }))).toEqual(['La merma del cliente necesita al cliente.']);
    expect(validarMovimiento(trayecto({ tipo: 'consumo', clienteId: 'cli-1' }))).toEqual([
      'La merma del trayecto y el consumo no llevan cliente.',
    ]);
  });

  it('el trayecto y el consumo: al menos una pieza, y solo piezas que salen', () => {
    expect(validarMovimiento(trayecto())).toEqual([]);
    expect(validarMovimiento(trayecto({ lineas: [] }))).toEqual([MENSAJE_SIN_PIEZAS]);
    expect(
      validarMovimiento(trayecto({ lineas: [{ presentacionId: 'pre-1', sentido: 'recibido', piezas: 1 }] })),
    ).toEqual(['Aquí solo se registran piezas que salen de la camioneta.']);
  });

  it('piezas fuera de rango, presentacion repetida y comentario largo', () => {
    expect(
      validarMovimiento(merma({ lineas: [{ presentacionId: 'pre-1', sentido: 'recibido', piezas: 0 }] })),
    ).toEqual(['Las piezas de cada producto van de 1 a 99999.']);
    expect(
      validarMovimiento(trayecto({ lineas: [{ presentacionId: 'pre-1', sentido: 'entregado', piezas: 1.5 }] })),
    ).toEqual(['Las piezas de cada producto van de 1 a 99999.']);
    expect(
      validarMovimiento(
        merma({
          lineas: [
            { presentacionId: 'pre-1', sentido: 'recibido', piezas: 1 },
            { presentacionId: 'pre-1', sentido: 'recibido', piezas: 2 },
          ],
        }),
      ),
    ).toEqual(['La misma presentación viene dos veces.']);
    expect(validarMovimiento(merma({ comentario: 'x'.repeat(LARGO_MAX_COMENTARIO_MOVIMIENTO + 1) }))).toEqual([
      'El comentario lleva hasta 300 caracteres.',
    ]);
  });
});

describe('consumo propio (D4)', () => {
  it('consumoRestante nunca es negativo', () => {
    expect(consumoRestante({ limite: 3, consumoDeHoy: 1 })).toBe(2);
    expect(consumoRestante({ limite: 1, consumoDeHoy: 4 })).toBe(0);
    expect(consumoRestante({ limite: 0, consumoDeHoy: 0 })).toBe(0);
  });

  it('Review Focus 1: motivoDeConsumo al límite y con límite 0', () => {
    expect(motivoDeConsumo({ limite: 1, consumoDeHoy: 0, piezas: 1 })).toBeNull();
    expect(motivoDeConsumo({ limite: 1, consumoDeHoy: 1, piezas: 1 })).toBe(MENSAJE_CONSUMO_AGOTADO);
    expect(MENSAJE_CONSUMO_AGOTADO).toBe('Ya registraste tu consumo de hoy');
    expect(motivoDeConsumo({ limite: 0, consumoDeHoy: 0, piezas: 1 })).toBe(MENSAJE_SIN_CONSUMO);
    expect(MENSAJE_SIN_CONSUMO).toBe('Tu sucursal no tiene consumo propio');
  });

  it('si no alcanza, dice cuánto queda', () => {
    expect(motivoDeConsumo({ limite: 3, consumoDeHoy: 2, piezas: 2 })).toBe(
      'Te quedan 1 de consumo hoy; no puedes registrar 2',
    );
    expect(textoConsumoRestante(2)).toBe('Te quedan 2 de consumo hoy');
  });
});
```

En `apps/tablet/src/datos/inventario-reglas.spec.ts`:

1. Import: agrega `consumoDelDia`, `faltantesDeMovimiento` y `type LineaMovimientoInventario` a los nombres importados
   de `./inventario-reglas`.
2. Las tres expectativas de `Existencia` ganan los campos nuevos (en ceros):

```ts
    expect(e.get('horchata')).toEqual({
      cargado: 30, vendido: 8, regalado: 1,
      mermaEntregada: 0, mermaTrayecto: 0, consumo: 0, mermaRecibida: 0,
      existencia: 21, mermaPorRegresar: 0,
    });
    expect(e.get('jamaica')).toEqual({
      cargado: 6, vendido: 0, regalado: 0,
      mermaEntregada: 0, mermaTrayecto: 0, consumo: 0, mermaRecibida: 0,
      existencia: 6, mermaPorRegresar: 0,
    });
```

y en "lo vendido sin carga queda en negativo":

```ts
    expect(existencias([], [venta({ presentacion_id: 'tamarindo', cantidad: 4, cantidad_promocion: 0 })], HOY).get('tamarindo')).toEqual({
      cargado: 0,
      vendido: 4,
      regalado: 0,
      mermaEntregada: 0,
      mermaTrayecto: 0,
      consumo: 0,
      mermaRecibida: 0,
      existencia: -4,
      mermaPorRegresar: 0,
    });
```

3. Al final del archivo:

```ts
function movimiento(extra: Partial<LineaMovimientoInventario> = {}): LineaMovimientoInventario {
  return { fecha: HOY, tipo: 'merma_trayecto', sentido: 'entregado', presentacion_id: 'horchata', piezas: 1, ...extra };
}

describe('existencias con movimientos (T-27 pieza 2)', () => {
  it('resta merma entregada, merma del trayecto y consumo de hoy; la merma recibida no suma', () => {
    const e = existencias([carga()], [venta()], HOY, [
      movimiento({ tipo: 'merma_cliente', sentido: 'recibido', piezas: 4 }),
      movimiento({ tipo: 'merma_cliente', sentido: 'entregado', piezas: 2 }),
      movimiento({ tipo: 'merma_trayecto', piezas: 1 }),
      movimiento({ tipo: 'consumo', piezas: 1 }),
      movimiento({ tipo: 'consumo', piezas: 9, fecha: '2026-10-21' }),
    ]);
    // 20 − 5 − 1 − 2 − 1 − 1 = 10; regresa como merma 4 recibidas + 1 del trayecto.
    expect(e.get('horchata')).toEqual({
      cargado: 20, vendido: 5, regalado: 1,
      mermaEntregada: 2, mermaTrayecto: 1, consumo: 1, mermaRecibida: 4,
      existencia: 10, mermaPorRegresar: 5,
    });
  });

  it('la merma recibida de una presentacion que no se cargo solo aparece para regresar', () => {
    const e = existencias([], [], HOY, [
      movimiento({ tipo: 'merma_cliente', sentido: 'recibido', presentacion_id: 'jamaica', piezas: 3 }),
    ]);
    expect(e.get('jamaica')).toMatchObject({ existencia: 0, mermaRecibida: 3, mermaPorRegresar: 3 });
  });
});

describe('faltantesDeMovimiento (D5)', () => {
  it('cuenta las piezas que salen contra la existencia que ya resta los movimientos', () => {
    const disponibles = existencias([carga()], [], HOY, [movimiento({ tipo: 'consumo', piezas: 18 })]);
    expect(
      faltantesDeMovimiento({
        controlInventario: true,
        existencias: disponibles,
        lineasQueSalen: [{ presentacionId: 'horchata', cantidad: 3 }],
      }),
    ).toEqual([{ presentacionId: 'horchata', faltan: 1 }]);
  });

  it('con el control apagado no hay faltantes', () => {
    expect(
      faltantesDeMovimiento({
        controlInventario: false,
        existencias: new Map(),
        lineasQueSalen: [{ presentacionId: 'horchata', cantidad: 3 }],
      }),
    ).toEqual([]);
  });
});

describe('consumoDelDia (D4)', () => {
  it('suma las piezas de consumo de hoy, nada mas', () => {
    expect(
      consumoDelDia(
        [
          movimiento({ tipo: 'consumo', piezas: 2 }),
          movimiento({ tipo: 'consumo', piezas: 5, fecha: '2026-10-21' }),
          movimiento({ tipo: 'merma_trayecto', piezas: 7 }),
        ],
        HOY,
      ),
    ).toBe(2);
  });
});
```

```bash
npm test --workspace=apps/tablet -- inventario-reglas movimientos-reglas
```

Esperado: fallan (`./movimientos-reglas` no existe; `faltantesDeMovimiento`/`consumoDelDia` no se exportan; los
objetos `Existencia` no traen los campos nuevos).

- [ ] **Paso 5: las reglas puras**

`apps/tablet/src/datos/movimientos-reglas.ts`:

```ts
import type { SentidoMovimiento, TipoMovimiento } from './tipos';

/**
 * La forma de un movimiento de inventario y el limite de consumo (T-27 pieza 2),
 * sin SQLite ni React.
 *
 * Vive en `src/datos/` porque `movimientos.registrar` la vuelve a calcular
 * DENTRO de su transaccion, y `src/datos/` no importa de `src/estado/`.
 * `src/estado/movimiento.ts` la reexporta para las pantallas. Los topes son los
 * del servidor (`modules/inventario/datos-movimiento.ts`).
 */

export const MAX_PIEZAS_MOVIMIENTO = 99_999;
export const LARGO_MAX_COMENTARIO_MOVIMIENTO = 300;

export const MENSAJE_FALTA_RECIBIDO = 'Captura al menos una pieza en «Recibí dañado».';
export const MENSAJE_SIN_PIEZAS = 'Captura al menos una pieza.';
/** Review Focus 1 (spec). Sin punto: el repositorio se lo agrega al lanzar. */
export const MENSAJE_CONSUMO_AGOTADO = 'Ya registraste tu consumo de hoy';
export const MENSAJE_SIN_CONSUMO = 'Tu sucursal no tiene consumo propio';

export interface LineaMovimiento {
  presentacionId: string;
  sentido: SentidoMovimiento;
  piezas: number;
}

/** Lo que se va a grabar, sin vendedor (`comentario` ya recortado o null). */
export interface EntradaMovimiento {
  tipo: TipoMovimiento;
  clienteId: string | null;
  lineas: readonly LineaMovimiento[];
  comentario: string | null;
}

/**
 * Errores de forma (los mismos que revisa el servidor), en espanol para el
 * vendedor. Vacio = se puede grabar (falta el limite y la existencia, que
 * dependen de la base).
 */
export function validarMovimiento(e: EntradaMovimiento): string[] {
  const errores: string[] = [];
  const delCliente = e.tipo === 'merma_cliente';

  if (delCliente && e.clienteId === null) errores.push('La merma del cliente necesita al cliente.');
  if (!delCliente && e.clienteId !== null) errores.push('La merma del trayecto y el consumo no llevan cliente.');

  // D2: "Recibí dañado" lleva al menos una pieza (Review Focus 3).
  if (delCliente && !e.lineas.some((l) => l.sentido === 'recibido')) errores.push(MENSAJE_FALTA_RECIBIDO);
  if (!delCliente && e.lineas.length === 0) errores.push(MENSAJE_SIN_PIEZAS);

  const vistas = new Set<string>();
  let fueraDeRango = false;
  let repetida = false;
  let entraSinCliente = false;
  for (const l of e.lineas) {
    if (!Number.isInteger(l.piezas) || l.piezas < 1 || l.piezas > MAX_PIEZAS_MOVIMIENTO) fueraDeRango = true;
    const llave = `${l.presentacionId}|${l.sentido}`;
    if (vistas.has(llave)) repetida = true;
    vistas.add(llave);
    if (!delCliente && l.sentido === 'recibido') entraSinCliente = true;
  }
  if (fueraDeRango) errores.push(`Las piezas de cada producto van de 1 a ${MAX_PIEZAS_MOVIMIENTO}.`);
  if (repetida) errores.push('La misma presentación viene dos veces.');
  if (entraSinCliente) errores.push('Aquí solo se registran piezas que salen de la camioneta.');

  if (e.comentario !== null && e.comentario.trim().length > LARGO_MAX_COMENTARIO_MOVIMIENTO) {
    errores.push(`El comentario lleva hasta ${LARGO_MAX_COMENTARIO_MOVIMIENTO} caracteres.`);
  }
  return errores;
}

/** Cuantas piezas de consumo le quedan hoy (nunca negativo). */
export function consumoRestante({ limite, consumoDeHoy }: { limite: number; consumoDeHoy: number }): number {
  return Math.max(0, limite - consumoDeHoy);
}

/** "Te quedan N de consumo hoy" (spec). */
export function textoConsumoRestante(restante: number): string {
  return `Te quedan ${restante} de consumo hoy`;
}

/**
 * D4: por que no se pueden registrar `piezas` de consumo hoy, o `null` si
 * caben. Cuenta piezas (la ayuda del portal: "Piezas que cada vendedor puede
 * registrar como consumo propio en un día").
 */
export function motivoDeConsumo({
  limite,
  consumoDeHoy,
  piezas,
}: {
  limite: number;
  consumoDeHoy: number;
  piezas: number;
}): string | null {
  if (limite <= 0) return MENSAJE_SIN_CONSUMO;
  const restante = consumoRestante({ limite, consumoDeHoy });
  if (restante === 0) return MENSAJE_CONSUMO_AGOTADO;
  if (piezas > restante) return `${textoConsumoRestante(restante)}; no puedes registrar ${piezas}`;
  return null;
}
```

`apps/tablet/src/datos/inventario-reglas.ts`:

1. El import pasa a `import type { Booleano, EstadoCarga, FechaISO, SentidoMovimiento, TipoMovimiento } from './tipos';`
   y al comentario de cabecera se le agrega: "T-27 pieza 2: los movimientos (merma del cliente, del trayecto y consumo)
   restan de la existencia; la merma recibida no suma (está dañada) y va a "Por regresar a la planta"."
2. Después de `interface LineaVentaInventario`:

```ts
/** Una linea de un movimiento de inventario con el tipo y la fecha de su movimiento (T-27 pieza 2). */
export interface LineaMovimientoInventario {
  fecha: FechaISO;
  tipo: TipoMovimiento;
  sentido: SentidoMovimiento;
  presentacion_id: string;
  piezas: number;
}
```

3. `interface Existencia` completa:

```ts
export interface Existencia {
  cargado: number;
  vendido: number;
  regalado: number;
  /** T-27 pieza 2: la reposicion de una merma del cliente ("Le entregué"). */
  mermaEntregada: number;
  /** Lo que se le rompio o echo a perder al vendedor en el dia. */
  mermaTrayecto: number;
  consumo: number;
  /** Lo danado que devolvio el cliente ("Recibí dañado"). NO suma a la existencia. */
  mermaRecibida: number;
  /**
   * cargado − vendido − regalado − mermaEntregada − mermaTrayecto − consumo.
   * Puede ser negativa si se vendio o registro con el control apagado.
   */
  existencia: number;
  /** La merma que regresa a la planta: mermaRecibida + mermaTrayecto. */
  mermaPorRegresar: number;
}
```

4. `existencias` completa:

```ts
/**
 * Por presentacion: lo cargado (cargas **aceptadas** y vivas de `hoy`) menos lo
 * vendido y lo regalado en las ventas de `hoy` (D10: el regalo tambien sale de
 * la camioneta) y, desde la pieza 2, menos la merma entregada, la del trayecto y
 * el consumo de `hoy`. La merma recibida no suma: se cuenta aparte para
 * regresarla a la planta.
 */
export function existencias(
  cargas: readonly CargaInventario[],
  ventas: readonly LineaVentaInventario[],
  hoy: FechaISO,
  movimientos: readonly LineaMovimientoInventario[] = [],
): Map<string, Existencia> {
  const mapa = new Map<string, Existencia>();
  const de = (presentacionId: string): Existencia => {
    let e = mapa.get(presentacionId);
    if (!e) {
      e = {
        cargado: 0,
        vendido: 0,
        regalado: 0,
        mermaEntregada: 0,
        mermaTrayecto: 0,
        consumo: 0,
        mermaRecibida: 0,
        existencia: 0,
        mermaPorRegresar: 0,
      };
      mapa.set(presentacionId, e);
    }
    return e;
  };
  for (const c of cargas) {
    if (c.estado !== 'aceptada' || c.activo !== 1 || c.fecha !== hoy) continue;
    for (const l of c.lineas) de(l.presentacion_id).cargado += l.piezas;
  }
  for (const v of ventas) {
    if (v.fecha !== hoy) continue;
    const e = de(v.presentacion_id);
    e.vendido += v.cantidad;
    e.regalado += v.cantidad_promocion;
  }
  for (const m of movimientos) {
    if (m.fecha !== hoy) continue;
    const e = de(m.presentacion_id);
    // Solo la merma del cliente trae lineas `recibido` (validarMovimiento).
    if (m.sentido === 'recibido') e.mermaRecibida += m.piezas;
    else if (m.tipo === 'merma_cliente') e.mermaEntregada += m.piezas;
    else if (m.tipo === 'merma_trayecto') e.mermaTrayecto += m.piezas;
    else e.consumo += m.piezas;
  }
  for (const e of mapa.values()) {
    e.existencia = e.cargado - e.vendido - e.regalado - e.mermaEntregada - e.mermaTrayecto - e.consumo;
    e.mermaPorRegresar = e.mermaRecibida + e.mermaTrayecto;
  }
  return mapa;
}
```

5. Después de `faltantesDeVenta`:

```ts
/**
 * D5: lo que le falta a un movimiento para no dejar ninguna presentacion en
 * negativo, contando solo las piezas que SALEN (reposicion, merma del trayecto,
 * consumo). Mismo criterio que `faltantesDeVenta`; vacio con el control apagado.
 */
export function faltantesDeMovimiento({
  controlInventario,
  existencias: disponibles,
  lineasQueSalen,
}: {
  controlInventario: boolean;
  existencias: ReadonlyMap<string, Existencia>;
  lineasQueSalen: readonly PiezasDePresentacion[];
}): Faltante[] {
  return faltantesDeVenta({ controlInventario, existencias: disponibles, lineas: lineasQueSalen, regalos: [] });
}

/** D4: piezas de consumo propio registradas `hoy` (todas: ya salieron, suban o no). */
export function consumoDelDia(movimientos: readonly LineaMovimientoInventario[], hoy: FechaISO): number {
  return movimientos
    .filter((m) => m.fecha === hoy && m.tipo === 'consumo')
    .reduce((total, m) => total + m.piezas, 0);
}
```

```bash
npm test --workspace=apps/tablet -- inventario-reglas movimientos-reglas
```

Esperado: verde.

- [ ] **Paso 6: el repositorio, pruebas que fallan**

`apps/tablet/src/datos/repositorios/movimientos.spec.ts`:

```ts
import { depsDePrueba, FIRMA_DE_PRUEBA, MOMENTO, snapshotDePrueba } from '../pruebas-apoyo';
import type { EstadoCarga } from '../tipos';
import { aplicarSnapshotCargas, crearRepositorioCargas } from './cargas';
import { crearRepositorioCatalogos } from './catalogos';
import type { DepsRepositorio } from './deps';
import { crearRepositorioFolios } from './folios';
import { crearRepositorioJornadas, ErrorJornada } from './jornadas';
import { crearRepositorioMovimientos, ErrorMovimiento, type DatosRegistroMovimiento } from './movimientos';
import { crearRepositorioVentas } from './ventas';

/**
 * Los movimientos de inventario en la tablet (T-27 pieza 2): forma, limite de
 * consumo, bloqueo por carga pendiente y faltantes, calculados DENTRO de la
 * transaccion de `registrar`. `MOMENTO` es el 2026-08-07.
 */

const HOY = '2026-08-07';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const folios = crearRepositorioFolios(deps);
  return {
    deps,
    catalogos,
    jornadas: crearRepositorioJornadas(deps),
    cargas: crearRepositorioCargas(deps, { catalogos }),
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
    movimientos: crearRepositorioMovimientos(deps, { catalogos }),
  };
}

/** Merma del cliente: 3 Jamaica 1 L danadas; le repone 2 Jamaica 500 ml. */
const mermaCliente = (extra: Partial<DatosRegistroMovimiento> = {}): DatosRegistroMovimiento => ({
  vendedorId: 'ven-1',
  tipo: 'merma_cliente',
  clienteId: 'cli-1',
  comentario: null,
  lineas: [
    { presentacionId: 'pre-1', sentido: 'recibido', piezas: 3 },
    { presentacionId: 'pre-2', sentido: 'entregado', piezas: 2 },
  ],
  ...extra,
});

/** Merma del trayecto o consumo: solo piezas que salen. */
const sale = (
  tipo: 'merma_trayecto' | 'consumo',
  piezas = 1,
  presentacionId = 'pre-1',
): DatosRegistroMovimiento => ({
  vendedorId: 'ven-1',
  tipo,
  clienteId: null,
  comentario: null,
  lineas: [{ presentacionId, sentido: 'entregado', piezas }],
});

const cuantos = (deps: DepsRepositorio) => ({
  movimientos: deps.bd.getFirstSync<{ n: number }>('select count(*) as n from movimiento')?.n,
  lineas: deps.bd.getFirstSync<{ n: number }>('select count(*) as n from movimiento_linea')?.n,
});

function prenderControl(deps: DepsRepositorio) {
  deps.bd.runSync("update vendedor set control_inventario = 1 where id = 'ven-1'");
}

function limite(deps: DepsRepositorio, n: number) {
  deps.bd.runSync('update vendedor set consumo_diario_max = $n where id = $id', { $n: n, $id: 'ven-1' });
}

function cargar(
  deps: DepsRepositorio,
  id: string,
  numero: number,
  estado: EstadoCarga,
  lineas: { presentacion_id: string; piezas: number }[],
) {
  aplicarSnapshotCargas(
    deps.bd,
    [
      {
        id,
        vendedor_id: 'ven-1',
        fecha: HOY,
        numero,
        estado,
        motivo_rechazo: estado === 'rechazada' ? 'Faltan cajas' : null,
        version: 1,
        respondida_en: estado === 'pendiente' ? null : MOMENTO,
        activo: 1,
        lineas,
      },
    ],
    MOMENTO,
  );
}

describe('movimientos.registrar (T-27 pieza 2)', () => {
  it('graba la merma del cliente con sus lineas, pendiente de subir, en el dia de hoy', () => {
    const { movimientos } = montar();
    const m = movimientos.registrar(mermaCliente({ comentario: '  Venían reventadas  ' }));
    expect(m).toMatchObject({
      fecha: HOY,
      vendedor_id: 'ven-1',
      cliente_id: 'cli-1',
      tipo: 'merma_cliente',
      comentario: 'Venían reventadas',
      registrado_en: MOMENTO,
      sync_estado: 'pendiente',
      sync_error: null,
    });
    expect(m.lineas.map((l) => [l.etiqueta, l.sentido, l.piezas])).toEqual([
      ['Jamaica 1 L', 'recibido', 3],
      ['Jamaica 500 ml', 'entregado', 2],
    ]);
  });

  it('publica el cambio despues del commit; un oyente que truena no lo convierte en fallo', () => {
    const { catalogos, movimientos, deps } = montar();
    const antes = catalogos.version();
    movimientos.registrar(sale('merma_trayecto'));
    expect(catalogos.version()).toBe(antes + 1);
    catalogos.suscribir(() => {
      throw new Error('una pantalla abierta truena al refrescar');
    });
    expect(() => movimientos.registrar(sale('merma_trayecto'))).not.toThrow();
    expect(cuantos(deps).movimientos).toBe(2);
  });

  it('Review Focus 3: merma del cliente solo con Le entregué no se graba', () => {
    const { movimientos, deps } = montar();
    expect(() =>
      movimientos.registrar(
        mermaCliente({ lineas: [{ presentacionId: 'pre-2', sentido: 'entregado', piezas: 2 }] }),
      ),
    ).toThrow(new ErrorMovimiento('Captura al menos una pieza en «Recibí dañado».'));
    expect(cuantos(deps)).toEqual({ movimientos: 0, lineas: 0 });
  });

  it('Review Focus 1: con límite 1 y 1 registrada, el siguiente consumo no se graba', () => {
    const { movimientos, deps } = montar();
    movimientos.registrar(sale('consumo'));
    expect(movimientos.consumoDeHoy('ven-1')).toBe(1);
    expect(() => movimientos.registrar(sale('consumo'))).toThrow('Ya registraste tu consumo de hoy.');
    expect(cuantos(deps)).toEqual({ movimientos: 1, lineas: 1 });
  });

  it('Review Focus 1: con límite 0 no se graba consumo', () => {
    const { movimientos, deps } = montar();
    limite(deps, 0);
    expect(() => movimientos.registrar(sale('consumo'))).toThrow('Tu sucursal no tiene consumo propio.');
    expect(cuantos(deps)).toEqual({ movimientos: 0, lineas: 0 });
  });

  it('con límite 3 y 2 registradas, 2 más no caben y dice cuánto queda', () => {
    const { movimientos, deps } = montar();
    limite(deps, 3);
    movimientos.registrar(sale('consumo', 2));
    expect(() => movimientos.registrar(sale('consumo', 2, 'pre-2'))).toThrow(
      'Te quedan 1 de consumo hoy; no puedes registrar 2.',
    );
    expect(movimientos.registrar(sale('consumo', 1, 'pre-2')).tipo).toBe('consumo');
  });

  it('Review Focus 2: con el control prendido una reposición que deja negativo no se graba y dice cuántas faltan', () => {
    const { movimientos, deps } = montar();
    prenderControl(deps);
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-2', piezas: 2 }]);
    expect(() =>
      movimientos.registrar(
        mermaCliente({
          lineas: [
            { presentacionId: 'pre-1', sentido: 'recibido', piezas: 3 },
            { presentacionId: 'pre-2', sentido: 'entregado', piezas: 3 },
          ],
        }),
      ),
    ).toThrow('No te alcanza el producto: Jamaica 500 ml: falta 1 pieza.');
    expect(cuantos(deps)).toEqual({ movimientos: 0, lineas: 0 });
  });

  it('Review Focus 2: con el control apagado la misma reposición sí se graba', () => {
    const { movimientos, deps, cargas } = montar();
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-2', piezas: 2 }]);
    movimientos.registrar(
      mermaCliente({
        lineas: [
          { presentacionId: 'pre-1', sentido: 'recibido', piezas: 3 },
          { presentacionId: 'pre-2', sentido: 'entregado', piezas: 3 },
        ],
      }),
    );
    expect(cargas.filasInventario('ven-1').find((f) => f.presentacionId === 'pre-2')?.existencia).toBe(-1);
  });

  it('con el control prendido y una carga pendiente no saca piezas; lo solo recibido sí entra (D5)', () => {
    const { movimientos, deps } = montar();
    prenderControl(deps);
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 50 }]);
    cargar(deps, 'carga-2', 2, 'pendiente', [{ presentacion_id: 'pre-1', piezas: 10 }]);
    expect(() => movimientos.registrar(sale('merma_trayecto'))).toThrow(
      'Tienes una carga por aceptar. Acéptala en Inventario antes de sacar piezas de la camioneta.',
    );
    expect(
      movimientos.registrar(mermaCliente({ lineas: [{ presentacionId: 'pre-1', sentido: 'recibido', piezas: 3 }] }))
        .tipo,
    ).toBe('merma_cliente');
    expect(cuantos(deps)).toEqual({ movimientos: 1, lineas: 1 });
  });

  it('valida con la existencia del momento de grabar (dentro de la transaccion)', () => {
    const { movimientos, deps } = montar();
    prenderControl(deps);
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 2 }]);
    expect(() => movimientos.registrar(sale('merma_trayecto', 3))).toThrow('Jamaica 1 L: falta 1 pieza');
    // A media captura se acepta una recarga (la escribe la respuesta o el pull)...
    cargar(deps, 'carga-2', 2, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 5 }]);
    // ...y el MISMO registrar valida con lo que hay al grabar.
    expect(movimientos.registrar(sale('merma_trayecto', 3)).tipo).toBe('merma_trayecto');
  });

  it('la venta tambien resta los movimientos (D5)', () => {
    const { movimientos, ventas, deps } = montar();
    prenderControl(deps);
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 20 }]);
    movimientos.registrar(sale('merma_trayecto', 18));
    expect(() =>
      ventas.registrar({
        vendedorId: 'ven-1',
        clienteId: 'cli-1',
        numNota: '',
        contadoCredito: 'contado',
        factura: 'N/A',
        comentarios: null,
        lineas: [{ presentacionId: 'pre-1', cantidad: 3, cantidadPromocion: 0 }],
        regalos: [],
        firma: FIRMA_DE_PRUEBA,
      }),
    ).toThrow('Jamaica 1 L: falta 1 pieza');
  });

  it('con el dia cerrado no se registra (T-38) y no deja fila', () => {
    const { movimientos, jornadas, deps } = montar();
    const j = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    jornadas.cerrar(j.id, 20);
    expect(() => movimientos.registrar(sale('merma_trayecto'))).toThrow(ErrorJornada);
    expect(cuantos(deps)).toEqual({ movimientos: 0, lineas: 0 });
  });

  it('un cliente o un producto que la tablet no conoce no se graba', () => {
    const { movimientos, deps } = montar();
    expect(() => movimientos.registrar(mermaCliente({ clienteId: 'no-existe' }))).toThrow(ErrorMovimiento);
    expect(() => movimientos.registrar(sale('merma_trayecto', 1, 'pre-nueva'))).toThrow(
      'Un producto no está en el catálogo de la tablet. Sincroniza y vuelve a capturar.',
    );
    expect(cuantos(deps)).toEqual({ movimientos: 0, lineas: 0 });
  });

  it('a un prospecto si se le puede registrar merma (Review Focus 4 del lado de la tablet)', () => {
    const { movimientos } = montar();
    expect(movimientos.registrar(mermaCliente({ clienteId: 'cli-2' })).cliente_id).toBe('cli-2');
  });
});

describe('consultas y cola de movimientos', () => {
  it('delDia y delDiaDelCliente, en orden de captura', () => {
    const { movimientos } = montar();
    const a = movimientos.registrar(sale('merma_trayecto'));
    const b = movimientos.registrar(mermaCliente());
    const c = movimientos.registrar(sale('consumo'));
    expect(movimientos.delDia('ven-1').map((m) => m.id)).toEqual([a.id, b.id, c.id]);
    expect(movimientos.delDiaDelCliente('cli-1').map((m) => m.id)).toEqual([b.id]);
    expect(movimientos.delDiaDelCliente('cli-2')).toEqual([]);
    expect(movimientos.delDia('ven-1', '2026-08-06')).toEqual([]);
  });

  it('pendientes, sincronizada y error (se reenvia con la misma clave)', () => {
    const { movimientos } = montar();
    const a = movimientos.registrar(sale('merma_trayecto'));
    const b = movimientos.registrar(mermaCliente());
    movimientos.marcarSincronizada(a.id);
    movimientos.marcarError(b.id, 'cliente-fuera-de-alcance: El cliente no existe o no es de tu sucursal.');
    expect(movimientos.pendientesDeSincronizar().map((m) => m.id)).toEqual([b.id]);
    expect(movimientos.porId(a.id)).toMatchObject({ sync_estado: 'sincronizado', sync_error: null });
    expect(movimientos.porId(b.id)?.sync_estado).toBe('error');
  });

  it('presentaciones: las activas del catalogo, con su nombre', () => {
    const { movimientos } = montar();
    expect(movimientos.presentaciones()).toEqual([
      { presentacionId: 'pre-1', etiqueta: 'Jamaica 1 L' },
      { presentacionId: 'pre-2', etiqueta: 'Jamaica 500 ml' },
    ]);
  });

  it('Inventario: las columnas nuevas y lo que regresa a la planta', () => {
    const { deps, cargas, movimientos } = montar();
    cargar(deps, 'carga-1', 1, 'aceptada', [
      { presentacion_id: 'pre-1', piezas: 24 },
      { presentacion_id: 'pre-2', piezas: 12 },
    ]);
    movimientos.registrar(mermaCliente());
    movimientos.registrar(sale('merma_trayecto', 1, 'pre-1'));
    movimientos.registrar(sale('consumo', 1, 'pre-2'));
    expect(cargas.filasInventario('ven-1')).toEqual([
      {
        presentacionId: 'pre-1', etiqueta: 'Jamaica 1 L',
        cargado: 24, vendido: 0, regalado: 0,
        mermaEntregada: 0, mermaTrayecto: 1, consumo: 0, mermaRecibida: 3,
        existencia: 23, mermaPorRegresar: 4,
      },
      {
        presentacionId: 'pre-2', etiqueta: 'Jamaica 500 ml',
        cargado: 12, vendido: 0, regalado: 0,
        mermaEntregada: 2, mermaTrayecto: 0, consumo: 1, mermaRecibida: 0,
        existencia: 9, mermaPorRegresar: 0,
      },
    ]);
  });

  it('Review Focus 5: consumo_diario_max baja en el pull y un login sin red no lo pisa', () => {
    const { catalogos, movimientos } = montar();
    expect(movimientos.consumoDiarioMax('ven-1')).toBe(1);

    const yo = snapshotDePrueba().vendedores?.[0];
    if (!yo) throw new Error('El snapshot de prueba trae a ven-1.');
    catalogos.guardarSnapshot({ vendedores: [{ ...yo, consumo_diario_max: 3 }] });
    expect(movimientos.consumoDiarioMax('ven-1')).toBe(3);

    // El upsert de identidad del login sin red no conoce el limite.
    catalogos.guardarSnapshot({
      vendedores: [{ id: 'ven-1', login: 'aperez', nombre: 'Abraham Perez', sucursal_id: 'suc-tj', activo: 1, folio_segmento: null }],
    });
    expect(movimientos.consumoDiarioMax('ven-1')).toBe(3);

    // Un 0 de verdad si gana (apaga el consumo).
    catalogos.guardarSnapshot({ vendedores: [{ ...yo, consumo_diario_max: 0 }] });
    expect(movimientos.consumoDiarioMax('ven-1')).toBe(0);
  });
});
```

En `apps/tablet/src/datos/repositorios/cargas.spec.ts`, la expectativa de "filasInventario: cargado − vendido − regalado
por presentacion, con su nombre" pasa a:

```ts
    expect(cargas.filasInventario('ven-1')).toEqual([
      {
        presentacionId: 'pre-1', etiqueta: 'Jamaica 1 L', cargado: 24, vendido: 10, regalado: 1,
        mermaEntregada: 0, mermaTrayecto: 0, consumo: 0, mermaRecibida: 0, existencia: 13, mermaPorRegresar: 0,
      },
      {
        presentacionId: 'pre-2', etiqueta: 'Jamaica 500 ml', cargado: 12, vendido: 0, regalado: 0,
        mermaEntregada: 0, mermaTrayecto: 0, consumo: 0, mermaRecibida: 0, existencia: 12, mermaPorRegresar: 0,
      },
    ]);
```

```bash
npm test --workspace=apps/tablet -- repositorios/movimientos repositorios/cargas
```

Esperado: `movimientos.spec.ts` falla al compilar (`./movimientos` no existe); `cargas.spec.ts` ya pasa con los campos
nuevos (los calcula `existencias`).

- [ ] **Paso 7: leer los movimientos del día, la venta y el repositorio**

`apps/tablet/src/datos/repositorios/cargas.ts`:

1. Al import de `../inventario-reglas` agrega `type LineaMovimientoInventario`.
2. `leerInventarioDelDia` completa:

```ts
/**
 * Lo que el inventario de hoy necesita, leido de SQLite: la casilla y el limite
 * de consumo del vendedor, sus cargas del dia (con lineas), las lineas de sus
 * ventas del dia y, desde la pieza 2, las de sus movimientos del dia.
 *
 * La usan `ventas.registrar` y `movimientos.registrar` DENTRO de su transaccion
 * (vale la existencia del momento de grabar) y este repositorio para las
 * pantallas.
 */
export function leerInventarioDelDia(
  bd: BaseDatos,
  vendedorId: string,
  fecha: FechaISO,
): {
  controlInventario: boolean;
  consumoDiarioMax: number;
  cargas: CargaInventario[];
  ventas: LineaVentaInventario[];
  movimientos: LineaMovimientoInventario[];
} {
  const vendedor = bd.getFirstSync<{ control_inventario: number; consumo_diario_max: number }>(
    'select control_inventario, consumo_diario_max from vendedor where id = $id',
    { $id: vendedorId },
  );
  const cargas = bd.getAllSync<Carga>(
    'select * from carga where vendedor_id = $vendedor_id and fecha = $fecha order by numero',
    { $vendedor_id: vendedorId, $fecha: fecha },
  );
  const detalle = bd.getAllSync<CargaDetalle>(
    `select d.* from carga_detalle d
       join carga c on c.id = d.carga_id
      where c.vendedor_id = $vendedor_id and c.fecha = $fecha`,
    { $vendedor_id: vendedorId, $fecha: fecha },
  );
  const ventas = bd.getAllSync<LineaVentaInventario>(
    `select v.fecha, l.presentacion_id, l.cantidad, l.cantidad_promocion
       from venta_linea l
       join venta v on v.id = l.venta_id
      where v.vendedor_id = $vendedor_id and v.fecha = $fecha`,
    { $vendedor_id: vendedorId, $fecha: fecha },
  );
  // T-27 pieza 2: todos los del dia, suban o no (las piezas ya salieron).
  const movimientos = bd.getAllSync<LineaMovimientoInventario>(
    `select m.fecha, m.tipo, l.sentido, l.presentacion_id, l.piezas
       from movimiento_linea l
       join movimiento m on m.id = l.movimiento_id
      where m.vendedor_id = $vendedor_id and m.fecha = $fecha`,
    { $vendedor_id: vendedorId, $fecha: fecha },
  );
  return {
    controlInventario: vendedor?.control_inventario === 1,
    // Un vendedor que no esta en la tablet no tiene consumo (registrar ya lo rechaza antes).
    consumoDiarioMax: vendedor?.consumo_diario_max ?? 0,
    cargas: cargas.map((c) => ({ ...c, lineas: detalle.filter((d) => d.carga_id === c.id) })),
    ventas,
    movimientos,
  };
}
```

3. En `paraVenta` y `filasInventario`, `existencias(inventario.cargas, inventario.ventas, hoy)` pasa a
   `existencias(inventario.cargas, inventario.ventas, hoy, inventario.movimientos)`; el comentario de `FilaInventario`
   dice "Una fila de la tabla de Inventario: Cargado − Vendido − Regalado − Merma entregada − Merma del trayecto −
   Consumo = Existencia, y la merma por regresar."

`apps/tablet/src/datos/repositorios/ventas.ts`, dentro de `enTransaccion` de `registrar`:

```ts
          existencias: existencias(inventario.cargas, inventario.ventas, fecha, inventario.movimientos),
```

y en el comentario de `registrar`, después del párrafo "T-27 (D3, D4): …": "T-27 pieza 2 (D5): la existencia ya resta
la merma entregada, la del trayecto y el consumo del día."

`apps/tablet/src/datos/repositorios/movimientos.ts`:

```ts
import {
  bloqueoDeVenta,
  consumoDelDia,
  existencias,
  faltantesDeMovimiento,
  textoFaltante,
} from '../inventario-reglas';
import { motivoDeConsumo, validarMovimiento, type LineaMovimiento } from '../movimientos-reglas';
import type { FechaISO, Movimiento, MovimientoLinea, TipoMovimiento } from '../tipos';
import { leerInventarioDelDia, PRODUCTO_FUERA_DE_CATALOGO } from './cargas';
import type { RepositorioCatalogos } from './catalogos';
import { enTransaccion, type DepsRepositorio } from './deps';
import { exigirJornadaAbierta } from './jornadas';

/** Error de regla de negocio del movimiento (no un fallo tecnico de SQLite). */
export class ErrorMovimiento extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorMovimiento';
  }
}

/** Lo que graba una pantalla (Merma de la ficha o la captura del menu). */
export interface DatosRegistroMovimiento {
  vendedorId: string;
  tipo: TipoMovimiento;
  /** Solo en la merma del cliente. */
  clienteId: string | null;
  lineas: LineaMovimiento[];
  comentario: string | null;
}

export interface LineaMovimientoConEtiqueta extends MovimientoLinea {
  /** "Jamaica 1 L", o `PRODUCTO_FUERA_DE_CATALOGO`. */
  etiqueta: string;
}

export interface MovimientoConLineas extends Movimiento {
  /** Primero lo recibido, luego lo entregado, en orden de captura. */
  lineas: LineaMovimientoConEtiqueta[];
}

/** Una fila de captura: las presentaciones activas del catalogo local. */
export interface PresentacionMovimiento {
  presentacionId: string;
  etiqueta: string;
}

export type RepositorioMovimientos = ReturnType<typeof crearRepositorioMovimientos>;

/**
 * Los movimientos de inventario (T-27 pieza 2): la merma del cliente, la del
 * trayecto y el consumo propio. Grabar, consultar el dia y la cola del push.
 *
 * Un movimiento grabado **no se edita ni se borra** en la app (D6): la
 * correccion es de la oficina (T-35). Por eso no hay `editar` ni `eliminar`.
 *
 * Recibe el MISMO `catalogos` de la capa de datos: es quien publica la version
 * que observan Inventario, la ficha y "Merma y consumo".
 */
export function crearRepositorioMovimientos(
  { bd, reloj, generarId }: DepsRepositorio,
  { catalogos }: { catalogos: RepositorioCatalogos },
) {
  /** "Producto volumen" de todo el catalogo local (es chico); tambien de las dadas de baja. */
  function etiquetas(): Map<string, string> {
    const filas = bd.getAllSync<{ id: string; etiqueta: string }>(
      `select pr.id, p.nombre || ' ' || pr.volumen as etiqueta
         from presentacion pr
         join producto p on p.id = pr.producto_id`,
    );
    return new Map(filas.map((f) => [f.id, f.etiqueta]));
  }

  function conLineas(movimientos: readonly Movimiento[]): MovimientoConLineas[] {
    if (movimientos.length === 0) return [];
    const nombres = etiquetas();
    return movimientos.map((m) => ({
      ...m,
      lineas: bd
        .getAllSync<MovimientoLinea>(
          // 'recibido' > 'entregado': desc pone primero lo que devolvio el cliente.
          'select * from movimiento_linea where movimiento_id = $id order by sentido desc, rowid',
          { $id: m.id },
        )
        .map((l) => ({ ...l, etiqueta: nombres.get(l.presentacion_id) ?? PRODUCTO_FUERA_DE_CATALOGO })),
    }));
  }

  const repo = {
    /**
     * Graba un movimiento en **una sola transaccion**, listo para subir.
     *
     * La forma, el cliente y las presentaciones se revisan antes; el limite de
     * consumo (D4), la carga pendiente y los faltantes (D5) se calculan DENTRO
     * de la transaccion, con la base tal como esta al grabar (como
     * `ventas.registrar`). Un throw hace rollback: nada queda escrito.
     *
     * @throws {ErrorJornada} si el dia de hoy ya esta cerrado (T-38): primero el candado.
     * @throws {ErrorMovimiento} si el movimiento no se puede grabar.
     */
    registrar(datos: DatosRegistroMovimiento): MovimientoConLineas {
      exigirJornadaAbierta({ bd, reloj }, datos.vendedorId);

      const vendedor = bd.getFirstSync<{ id: string }>('select id from vendedor where id = $id', {
        $id: datos.vendedorId,
      });
      if (!vendedor) {
        throw new ErrorMovimiento('Este vendedor no está en la tablet. Sincroniza antes de registrar.');
      }

      const comentario = recortar(datos.comentario);
      const errores = validarMovimiento({ ...datos, comentario });
      if (errores.length > 0) throw new ErrorMovimiento(errores.join(' '));

      if (datos.clienteId !== null) {
        const cliente = catalogos.obtenerCliente(datos.clienteId);
        if (!cliente || cliente.activo !== 1) {
          throw new ErrorMovimiento(
            'Este cliente ya no está en el catálogo de la tablet. Sincroniza antes de registrar la merma.',
          );
        }
      }

      const nombres = etiquetas();
      if (datos.lineas.some((l) => !nombres.has(l.presentacionId))) {
        throw new ErrorMovimiento('Un producto no está en el catálogo de la tablet. Sincroniza y vuelve a capturar.');
      }

      const fecha = reloj.hoy();
      const id = generarId();
      const salen = datos.lineas
        .filter((l) => l.sentido === 'entregado')
        .map((l) => ({ presentacionId: l.presentacionId, cantidad: l.piezas }));

      enTransaccion(bd, () => {
        const inventario = leerInventarioDelDia(bd, datos.vendedorId, fecha);

        if (datos.tipo === 'consumo') {
          const motivo = motivoDeConsumo({
            limite: inventario.consumoDiarioMax,
            consumoDeHoy: consumoDelDia(inventario.movimientos, fecha),
            piezas: salen.reduce((total, l) => total + l.cantidad, 0),
          });
          if (motivo !== null) throw new ErrorMovimiento(`${motivo}.`);
        }

        // D5: solo lo que saca piezas buenas respeta la carga pendiente y la existencia.
        if (salen.length > 0) {
          const bloqueo = bloqueoDeVenta({
            controlInventario: inventario.controlInventario,
            cargas: inventario.cargas,
            hoy: fecha,
          });
          if (bloqueo !== null) {
            throw new ErrorMovimiento(`${bloqueo}. Acéptala en Inventario antes de sacar piezas de la camioneta.`);
          }
          const faltantes = faltantesDeMovimiento({
            controlInventario: inventario.controlInventario,
            existencias: existencias(inventario.cargas, inventario.ventas, fecha, inventario.movimientos),
            lineasQueSalen: salen,
          });
          if (faltantes.length > 0) {
            throw new ErrorMovimiento(
              `No te alcanza el producto: ${faltantes
                .map((f) => textoFaltante(nombres.get(f.presentacionId) ?? 'Un producto', f.faltan))
                .join('; ')}.`,
            );
          }
        }

        bd.runSync(
          `insert into movimiento (id, fecha, vendedor_id, cliente_id, tipo, comentario, registrado_en, sync_estado)
           values ($id, $fecha, $vendedor_id, $cliente_id, $tipo, $comentario, $registrado_en, 'pendiente')`,
          {
            $id: id,
            // El dia de trabajo de la tablet (Tijuana): viaja como `fecha_operacion`.
            $fecha: fecha,
            $vendedor_id: datos.vendedorId,
            $cliente_id: datos.clienteId,
            $tipo: datos.tipo,
            $comentario: comentario,
            $registrado_en: reloj.ahora(),
          },
        );
        for (const l of datos.lineas) {
          bd.runSync(
            `insert into movimiento_linea (movimiento_id, presentacion_id, sentido, piezas)
             values ($movimiento_id, $presentacion_id, $sentido, $piezas)`,
            { $movimiento_id: id, $presentacion_id: l.presentacionId, $sentido: l.sentido, $piezas: l.piezas },
          );
        }
      });

      // Despues del commit: Inventario, la ficha y "Merma y consumo" releen. Un
      // oyente que truena no convierte en fallo un movimiento ya grabado.
      try {
        catalogos.publicarCambio();
      } catch {
        // Solo se pierde el refresco de pantallas abiertas.
      }

      const grabado = repo.porId(id);
      if (!grabado) throw new ErrorMovimiento('No se pudo leer el movimiento recién grabado.');
      return grabado;
    },

    porId(id: string): MovimientoConLineas | null {
      const m = bd.getFirstSync<Movimiento>('select * from movimiento where id = $id', { $id: id });
      return m ? (conLineas([m])[0] ?? null) : null;
    },

    /** Los del vendedor en un dia, en orden de captura ("Movimientos de hoy" del menu). */
    delDia(vendedorId: string, fecha: FechaISO = reloj.hoy()): MovimientoConLineas[] {
      return conLineas(
        bd.getAllSync<Movimiento>(
          `select * from movimiento where vendedor_id = $vendedor_id and fecha = $fecha
            order by registrado_en, rowid`,
          { $vendedor_id: vendedorId, $fecha: fecha },
        ),
      );
    },

    /** La merma registrada con ese cliente en un dia ("Movimientos de hoy" de la ficha). */
    delDiaDelCliente(clienteId: string, fecha: FechaISO = reloj.hoy()): MovimientoConLineas[] {
      return conLineas(
        bd.getAllSync<Movimiento>(
          `select * from movimiento where cliente_id = $cliente_id and fecha = $fecha
            order by registrado_en, rowid`,
          { $cliente_id: clienteId, $fecha: fecha },
        ),
      );
    },

    /** Piezas de consumo propio de hoy (todas, suban o no). */
    consumoDeHoy(vendedorId: string): number {
      const hoy = reloj.hoy();
      return consumoDelDia(leerInventarioDelDia(bd, vendedorId, hoy).movimientos, hoy);
    },

    /** El limite de su sucursal (D4); 0 = no se ofrece consumo. */
    consumoDiarioMax(vendedorId: string): number {
      return leerInventarioDelDia(bd, vendedorId, reloj.hoy()).consumoDiarioMax;
    },

    /** Las presentaciones activas, por producto y volumen: las filas de captura (de cualquier sabor y tamaño, D2). */
    presentaciones(): PresentacionMovimiento[] {
      return bd.getAllSync<PresentacionMovimiento>(
        `select pr.id as presentacionId, p.nombre || ' ' || pr.volumen as etiqueta
           from presentacion pr
           join producto p on p.id = pr.producto_id
          where pr.activo = 1 and p.activo = 1
          order by p.nombre, pr.volumen`,
      );
    },

    /**
     * Lo que falta por subir, incluidos los rechazados (patron D19 de T-16): se
     * reintentan en la siguiente sincronizacion con la misma clave (Review Focus 4).
     */
    pendientesDeSincronizar(): MovimientoConLineas[] {
      return conLineas(
        bd.getAllSync<Movimiento>(
          `select * from movimiento where sync_estado in ('pendiente', 'error')
            order by fecha, registrado_en, rowid`,
        ),
      );
    },

    marcarSincronizada(id: string): void {
      bd.runSync(
        `update movimiento set sync_estado = 'sincronizado', sincronizado_en = $en, sync_error = null
          where id = $id`,
        { $en: reloj.ahora(), $id: id },
      );
    },

    marcarError(id: string, motivo: string): void {
      bd.runSync(`update movimiento set sync_estado = 'error', sync_error = $motivo where id = $id`, {
        $motivo: motivo,
        $id: id,
      });
    },
  };

  return repo;
}

/** Texto recortado no vacio, o `null`. */
function recortar(valor: string | null): string | null {
  if (valor === null) return null;
  const limpio = valor.trim();
  return limpio === '' ? null : limpio;
}
```

`apps/tablet/src/datos/inicializar.ts`:
- Import: `import { crearRepositorioMovimientos, type RepositorioMovimientos } from './repositorios/movimientos';`
- En `CapaDatos`, después de `cargas: RepositorioCargas;`:

```ts
  /** Merma del cliente, merma del trayecto y consumo propio (T-27 pieza 2). */
  movimientos: RepositorioMovimientos;
```

- En el `return`, después de `cargas: …,`:

```ts
    // El MISMO `catalogos`: `registrar` publica por el la version que observan
    // Inventario, la ficha y "Merma y consumo".
    movimientos: crearRepositorioMovimientos(deps, { catalogos }),
```

`apps/tablet/src/datos/index.ts`, al final:

```ts
export { crearRepositorioMovimientos, ErrorMovimiento } from './repositorios/movimientos';
export type {
  DatosRegistroMovimiento,
  MovimientoConLineas,
  PresentacionMovimiento,
  RepositorioMovimientos,
} from './repositorios/movimientos';
```

```bash
npm test --workspace=apps/tablet -- repositorios inventario-reglas movimientos-reglas
npm run typecheck --workspace=apps/tablet
```

Esperado: verde (incluidas `ventas.spec.ts` y `cargas.spec.ts`, que no cambian de comportamiento sin movimientos).

- [ ] **Paso 8: la fuente del push, pruebas que fallan**

`apps/tablet/src/sincronizacion/fuente-movimientos.spec.ts`:

```ts
import { depsDePrueba, MOMENTO, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioMovimientos } from '@/datos/repositorios/movimientos';

import { fuenteMovimientos } from './fuente-movimientos';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const movimientos = crearRepositorioMovimientos(deps, { catalogos });
  return { movimientos, fuente: fuenteMovimientos(movimientos) };
}

describe('fuente de movimientos (T-27 pieza 2)', () => {
  it('sin movimientos no hay nada que subir', () => {
    const { fuente } = montar();
    expect(fuente.tipo).toBe('movimiento');
    expect(fuente.pendientes()).toEqual([]);
  });

  it('la merma del cliente lleva cliente_id en el sobre, sin folio, con sus lineas', () => {
    const { movimientos, fuente } = montar();
    const m = movimientos.registrar({
      vendedorId: 'ven-1',
      tipo: 'merma_cliente',
      clienteId: 'cli-1',
      comentario: 'Reventadas',
      lineas: [
        { presentacionId: 'pre-1', sentido: 'recibido', piezas: 3 },
        { presentacionId: 'pre-2', sentido: 'entregado', piezas: 2 },
      ],
    });
    const [op] = fuente.pendientes();
    expect(op).toEqual({
      clave: m.id,
      tipo: 'movimiento',
      fecha_operacion: '2026-08-07',
      ocurrido_en: MOMENTO,
      cliente_id: 'cli-1',
      datos: {
        tipo: 'merma_cliente',
        comentario: 'Reventadas',
        registrado_en: MOMENTO,
        lineas: [
          { presentacion_id: 'pre-1', sentido: 'recibido', piezas: 3 },
          { presentacion_id: 'pre-2', sentido: 'entregado', piezas: 2 },
        ],
      },
    });
    expect(op).not.toHaveProperty('folio');
  });

  it('la merma del trayecto y el consumo no llevan cliente_id', () => {
    const { movimientos, fuente } = montar();
    movimientos.registrar({
      vendedorId: 'ven-1',
      tipo: 'merma_trayecto',
      clienteId: null,
      comentario: null,
      lineas: [{ presentacionId: 'pre-1', sentido: 'entregado', piezas: 1 }],
    });
    const [op] = fuente.pendientes();
    expect(op).not.toHaveProperty('cliente_id');
    expect(op?.datos).toMatchObject({ tipo: 'merma_trayecto', comentario: null });
  });

  it('Review Focus 4: un rechazo por alcance se queda en la cola con la misma clave', () => {
    const { movimientos, fuente } = montar();
    // cli-2 es un prospecto capturado sin red: su alta todavia no esta arriba.
    const m = movimientos.registrar({
      vendedorId: 'ven-1',
      tipo: 'merma_cliente',
      clienteId: 'cli-2',
      comentario: null,
      lineas: [{ presentacionId: 'pre-1', sentido: 'recibido', piezas: 1 }],
    });
    fuente.marcarError(m.id, 'cliente-fuera-de-alcance: El cliente cli-2 no existe o no es de tu sucursal.');
    expect(fuente.pendientes().map((o) => o.clave)).toEqual([m.id]);
    fuente.marcarSincronizada(m.id);
    expect(fuente.pendientes()).toEqual([]);
  });
});
```

En `apps/tablet/src/sincronizacion/fuentes.spec.ts`: import
`import { crearRepositorioMovimientos } from '@/datos/repositorios/movimientos';`, en `montar()` agrega
`movimientos: crearRepositorioMovimientos(deps, { catalogos }),` (el comentario dice "arma los ocho repositorios") y la
prueba pasa a:

```ts
describe('fuentesDelPush (T-75, D3; T-30/T-31, D5; T-27 pieza 2)', () => {
  it('sube prospectos ANTES que ventas (T-75), visitas despues de cobranzas (T-39), gastos despues de visitas (T-30/T-31) y movimientos despues de gastos (T-27)', () => {
    const datos = montar();
    expect(fuentesDelPush(datos).map((f) => f.tipo)).toEqual([
      'jornada',
      'prospecto',
      'venta',
      'cobranza',
      'visita',
      'gasto',
      'movimiento',
      'ruta-alta',
    ]);
  });
});
```

En `apps/tablet/src/sincronizacion/pendientes.spec.ts`: el mismo import y la misma línea en `montar()`; en la prueba
"suma jornada, venta, …" (que pasa a llamarse "suma jornada, venta, prospecto, cobranza, visita, gasto, movimiento y alta
de ruta pendientes") agrega `movimientos` a la desestructuración y, justo después de `gastos.registrar({ … });`:

```ts
    movimientos.registrar({
      vendedorId: 'ven-1',
      tipo: 'merma_trayecto',
      clienteId: null,
      comentario: null,
      lineas: [{ presentacionId: 'pre-1', sentido: 'entregado', piezas: 1 }],
    });
```

y la expectativa final pasa a `toBe(8)` (el comentario de la prueba dice "Las 8 fuentes del push de hoy (…, T-27
pieza 2)").

En `apps/tablet/src/sincronizacion/motor.spec.ts`, dentro de `describe('aSnapshot (T-27)', …)`:

```ts
  it('pasa el consumo diario del vendedor tal cual y tolera un servidor que no lo manda (pieza 2)', () => {
    const respuesta = respuestaPullDePrueba();
    respuesta.catalogos.vendedores = respuesta.catalogos.vendedores.map((v, i) => ({
      ...v,
      consumo_diario_max: i === 0 ? 3 : 0,
    }));
    expect(aSnapshot(respuesta).vendedores?.map((v) => v.consumo_diario_max)).toEqual([3, 0]);
    expect(aSnapshot(respuestaPullDePrueba()).vendedores?.map((v) => v.consumo_diario_max)).toEqual([
      undefined,
      undefined,
    ]);
  });
```

```bash
npm test --workspace=apps/tablet -- sincronizacion
```

Esperado: fallan `fuente-movimientos.spec.ts` (no existe la fuente), `fuentes.spec.ts` (falta `'movimiento'`) y
`pendientes.spec.ts` (cuenta 7, y `FuentesConPendientes` no tiene `movimientos`). La de `motor.spec.ts` pasa (es la red
de la mezcla).

- [ ] **Paso 9: la fuente y el orden del push**

`apps/tablet/src/sincronizacion/fuente-movimientos.ts`:

```ts
import type { RepositorioMovimientos } from '@/datos/repositorios/movimientos';

import type { DatosMovimiento, OperacionSaliente } from './contrato';
import type { FuenteOperaciones } from './motor';

/**
 * Los movimientos de inventario, como operaciones del push (T-27 pieza 2, D7).
 *
 * - **`clave`** es el `id` de la fila: no cambia, y en el servidor es el id del
 *   movimiento.
 * - **`cliente_id`** solo en la merma del cliente (pasa por el alcance del lote);
 *   el servidor rechaza un consumo o una merma del trayecto que lo traiga. Sin
 *   folio.
 * - `fecha_operacion` es el dia de trabajo de la tablet (`movimiento.fecha`).
 *
 * Va despues de gastos y antes de rutas (y despues de prospectos: la merma a un
 * prospecto capturado sin red necesita su alta ya arriba). Ver `fuentes.ts`.
 */
export function fuenteMovimientos(movimientos: RepositorioMovimientos): FuenteOperaciones {
  return {
    tipo: 'movimiento',

    pendientes(): OperacionSaliente[] {
      return movimientos.pendientesDeSincronizar().map((m) => {
        const datos: DatosMovimiento = {
          tipo: m.tipo,
          comentario: m.comentario,
          registrado_en: m.registrado_en,
          lineas: m.lineas.map((l) => ({
            presentacion_id: l.presentacion_id,
            sentido: l.sentido,
            piezas: l.piezas,
          })),
        };
        const operacion: OperacionSaliente = {
          clave: m.id,
          tipo: 'movimiento',
          fecha_operacion: m.fecha,
          ocurrido_en: m.registrado_en,
          datos,
        };
        return m.cliente_id === null ? operacion : { ...operacion, cliente_id: m.cliente_id };
      });
    },

    marcarSincronizada: (clave) => movimientos.marcarSincronizada(clave),
    marcarError: (clave, motivo) => movimientos.marcarError(clave, motivo),
  };
}
```

`apps/tablet/src/sincronizacion/fuentes.ts`: `import { fuenteMovimientos } from './fuente-movimientos';`; en el
comentario, después del punto de gastos, agrega "- Movimientos despues de gastos (T-27 pieza 2): no dependen de
nada que suba despues; la merma a un prospecto capturado sin red necesita su alta ya aplicada (van despues de
prospectos, como la visita). Antes de las altas de ruta para que el orden del spec quede fijo."; y la lista:

```ts
  return [
    fuenteJornadas(datos.jornadas),
    fuenteProspectos(datos.prospectos),
    fuenteVentas(datos.ventas),
    fuenteCobranzas(datos.cobranzas),
    fuenteVisitas(datos.visitas),
    fuenteGastos(datos.gastos),
    fuenteMovimientos(datos.movimientos),
    fuenteRutas(datos.rutas),
  ];
```

`apps/tablet/src/sincronizacion/pendientes.ts`: `import type { RepositorioMovimientos } from
'@/datos/repositorios/movimientos';`; en `FuentesConPendientes`, después de `gastos`:

```ts
  /** T-27 pieza 2: merma del cliente, merma del trayecto y consumo propio. */
  movimientos: RepositorioMovimientos;
```

y en `contarPendientesDeSubir`, después de la línea de `gastos`:
`datos.movimientos.pendientesDeSincronizar().length +`; el comentario dice "sumando las 8 fuentes del push de hoy (…,
T-27 pieza 2): jornada, venta, prospecto, cobranza, visita, gasto, movimiento y alta de ruta."

`apps/tablet/src/sincronizacion/motor.ts`: en el comentario de `FuenteOperaciones`, "…y el alta de ruta (T-37), en
`proveedor-sesion.tsx`. Falta la merma (T-33)." pasa a "…el alta de ruta (T-37) y los movimientos de inventario (T-27
pieza 2), en `proveedor-sesion.tsx`."

- [ ] **Paso 10: correr todo y ver pasar**

```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
```

Esperado: verde. `proveedor-sesion.tsx` no cambia: ya llama `fuentesDelPush(datos)` con la `CapaDatos` entera, que
ahora trae `movimientos`; `contarPendientesDeSubir(datos)` (ruta y cierre del día) también.

- [ ] **Paso 11: aceptación en el emulador de la capa de datos (controlador)**

Con el backend de este worktree (Tareas 1–2) y la app de este worktree en el emulador (Metro en 8082; ver la memoria
"Demo tablet local"): iniciar sesión con el vendedor demo, Sincronizar ahora, y comprobar en SQLite que
`vendedor.consumo_diario_max` vale lo de su sucursal (`adb shell run-as … sqlite3 …` o el inspector que use el
controlador). Las pantallas llegan en la Tarea 5; aquí solo que la app arranca, migra a la 18 y sincroniza sin error.

- [ ] **Paso 12: commit**

```bash
git add apps/tablet/src
git status
git commit -m "T-27: movimientos de inventario en la tablet (migración 018, reglas, repositorio y push)

Refs #27

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 5: Tablet, pantallas: "Merma" en la ficha, "Merma y consumo" en el menú, Inventario extendido y "Movimientos de hoy" — con la prueba en el emulador (pantallas del spec, D2, D3, D4, D5, D6)

**Files:**
- Create: `apps/tablet/src/estado/movimiento.ts`, `apps/tablet/src/estado/movimiento.spec.ts`
- Modify: `apps/tablet/src/estado/inventario.ts`, `apps/tablet/src/estado/inventario.spec.ts`
- Modify: `apps/tablet/src/estado/ruta-del-dia.ts`, `apps/tablet/src/estado/ruta-del-dia.spec.ts`
- Create: `apps/tablet/app/(jornada)/operacion/[clienteId]/merma.tsx`
- Create: `apps/tablet/app/(jornada)/merma/index.tsx`, `apps/tablet/app/(jornada)/merma/registrar.tsx`
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx`, `apps/tablet/app/(jornada)/inventario/index.tsx`,
  `apps/tablet/app/(jornada)/_layout.tsx`
- Delete: `apps/tablet/app/(jornada)/operacion/[clienteId]/registros.tsx`, `apps/tablet/app/(jornada)/pendiente/[seccion].tsx`

**Interfaces:**
- Consumes (Tarea 4): `datos.movimientos.{registrar, delDia, delDiaDelCliente, consumoDeHoy, consumoDiarioMax,
  presentaciones}`, `ErrorMovimiento`, `datos.cargas.{paraVenta, filasInventario}` (con los campos nuevos de
  `Existencia`), `validarMovimiento`, `motivoDeConsumo`, `consumoRestante`, `textoConsumoRestante`; `leerCantidad`
  (`src/datos/ventas-reglas.ts`), `textoTeQuedan` (`src/estado/inventario.ts`), `estadoSubida`/`motivoDeRechazo`
  (`src/estado/ruta-del-dia.ts`).
- Produces (`src/estado/movimiento.ts`): `TITULO_MOVIMIENTO`, `MENSAJE_DIA_CERRADO_MOVIMIENTO`,
  `type CapturaMovimiento`, `capturar(captura, presentacionId, sentido, texto)`, `piezasCapturadas(captura,
  presentacionId, sentido)`, `validarCapturaMovimiento(e): ValidacionCapturaMovimiento`,
  `faltantesVisiblesMovimiento(e, v)`, `tipoDeCaptura(param)`, `ofreceConsumo(limite)`, `pastillaMovimiento(m)`,
  `resumenMovimiento(m)`, `crearGuardiaRegistro(): GuardiaRegistro`. (`src/estado/inventario.ts`):
  `filasPorRegresar(filas)`. (`src/estado/ruta-del-dia.ts`): la entrada `merma` del menú abre `/(jornada)/merma`;
  desaparecen `SECCIONES_PENDIENTES`, `SeccionPendiente` y `esSeccionPendiente` (no queda ninguna sección pendiente).

- [ ] **Paso 1: la lógica de pantalla, pruebas que fallan**

`apps/tablet/src/estado/movimiento.spec.ts`:

```ts
import {
  capturar,
  crearGuardiaRegistro,
  faltantesVisiblesMovimiento,
  MENSAJE_DIA_CERRADO_MOVIMIENTO,
  MENSAJE_FALTA_RECIBIDO,
  ofreceConsumo,
  pastillaMovimiento,
  piezasCapturadas,
  resumenMovimiento,
  tipoDeCaptura,
  TITULO_MOVIMIENTO,
  validarCapturaMovimiento,
  type EntradaCapturaMovimiento,
} from './movimiento';

/** Lo que deciden las pantallas de merma y consumo (T-27 pieza 2), sin React. */

const entrada = (extra: Partial<EntradaCapturaMovimiento> = {}): EntradaCapturaMovimiento => ({
  tipo: 'merma_cliente',
  clienteId: 'cli-1',
  captura: { 'pre-1': { recibido: '3' }, 'pre-2': { entregado: '2' } },
  comentario: '',
  diaCerrado: false,
  ...extra,
});

describe('validarCapturaMovimiento', () => {
  it('convierte los campos en lineas: lo vacio o en 0 no cuenta', () => {
    const v = validarCapturaMovimiento(
      entrada({ captura: { 'pre-1': { recibido: '3', entregado: '0' }, 'pre-2': { recibido: '', entregado: '2' } } }),
    );
    expect(v).toEqual({
      lineas: [
        { presentacionId: 'pre-1', sentido: 'recibido', piezas: 3 },
        { presentacionId: 'pre-2', sentido: 'entregado', piezas: 2 },
      ],
      comentario: null,
      faltantes: [],
      listo: true,
    });
  });

  it('Review Focus 3: solo con "Le entregué" no queda lista', () => {
    const v = validarCapturaMovimiento(entrada({ captura: { 'pre-2': { entregado: '2' } } }));
    expect(v.listo).toBe(false);
    expect(v.faltantes).toEqual([MENSAJE_FALTA_RECIBIDO]);
  });

  it('una cantidad ilegible lo dice y no queda lista', () => {
    const v = validarCapturaMovimiento(entrada({ captura: { 'pre-1': { recibido: '3a' } } }));
    expect(v.faltantes).toContain('Las piezas son números enteros de 1 a 99999.');
    expect(v.listo).toBe(false);
  });

  it('el comentario se recorta; vacio es null', () => {
    expect(validarCapturaMovimiento(entrada({ comentario: '  Reventadas  ' })).comentario).toBe('Reventadas');
  });

  it('con el dia cerrado no queda lista', () => {
    expect(validarCapturaMovimiento(entrada({ diaCerrado: true })).faltantes).toEqual([MENSAJE_DIA_CERRADO_MOVIMIENTO]);
  });

  it('Review Focus 1: con límite 0 no se ofrece consumo; agotado, la captura no queda lista', () => {
    expect(ofreceConsumo(0)).toBe(false);
    expect(ofreceConsumo(1)).toBe(true);
    const consumo = (consumoDeHoy: number, piezas: string) =>
      validarCapturaMovimiento(
        entrada({
          tipo: 'consumo',
          clienteId: null,
          captura: { 'pre-1': { entregado: piezas } },
          consumo: { limite: 1, consumoDeHoy },
        }),
      );
    expect(consumo(0, '1').listo).toBe(true);
    expect(consumo(1, '1').faltantes).toEqual(['Ya registraste tu consumo de hoy.']);
    expect(consumo(0, '2').faltantes).toEqual(['Te quedan 1 de consumo hoy; no puedes registrar 2.']);
  });

  it('el trayecto sin piezas no queda listo', () => {
    expect(
      validarCapturaMovimiento(entrada({ tipo: 'merma_trayecto', clienteId: null, captura: {} })).faltantes,
    ).toEqual(['Captura al menos una pieza.']);
  });
});

describe('captura', () => {
  it('capturar no muta y conserva el otro campo de la presentacion', () => {
    const antes = { 'pre-1': { recibido: '3' } };
    const despues = capturar(antes, 'pre-1', 'entregado', '2');
    expect(antes).toEqual({ 'pre-1': { recibido: '3' } });
    expect(despues).toEqual({ 'pre-1': { recibido: '3', entregado: '2' } });
    expect(piezasCapturadas(despues, 'pre-1', 'entregado')).toBe(2);
    expect(piezasCapturadas(despues, 'pre-2', 'entregado')).toBe(0);
    expect(piezasCapturadas({ 'pre-1': { entregado: 'x' } }, 'pre-1', 'entregado')).toBe(0);
  });

  it('los faltantes se ven solo cuando el vendedor ya empezo', () => {
    const vacia = entrada({ captura: {} });
    expect(faltantesVisiblesMovimiento(vacia, validarCapturaMovimiento(vacia))).toEqual([]);
    const empezada = entrada({ captura: { 'pre-2': { entregado: '2' } } });
    expect(faltantesVisiblesMovimiento(empezada, validarCapturaMovimiento(empezada))).toEqual([MENSAJE_FALTA_RECIBIDO]);
  });

  it('tipoDeCaptura acepta solo los dos tipos del menu', () => {
    expect(tipoDeCaptura('merma_trayecto')).toBe('merma_trayecto');
    expect(tipoDeCaptura('consumo')).toBe('consumo');
    expect(tipoDeCaptura('merma_cliente')).toBeNull();
    expect(tipoDeCaptura(undefined)).toBeNull();
    expect(tipoDeCaptura(['consumo'])).toBeNull();
  });
});

describe('lista de movimientos', () => {
  it('titulos por tipo', () => {
    expect(TITULO_MOVIMIENTO).toEqual({
      merma_cliente: 'Merma del cliente',
      merma_trayecto: 'Merma del trayecto',
      consumo: 'Consumo propio',
    });
  });

  it('pastillaMovimiento: por subir, subido o rechazado con su motivo', () => {
    expect(pastillaMovimiento({ sync_estado: 'pendiente', sync_error: null })).toEqual({
      texto: 'por subir',
      estado: 'pendiente',
      detalle: null,
    });
    expect(pastillaMovimiento({ sync_estado: 'sincronizado', sync_error: null }).texto).toBe('subido');
    expect(
      pastillaMovimiento({ sync_estado: 'error', sync_error: 'datos-invalidos: lineas: la presentación no existe.' }),
    ).toEqual({ texto: 'rechazado', estado: 'error', detalle: 'lineas: la presentación no existe.' });
  });

  it('resumenMovimiento: lo recibido y lo entregado de la merma; las piezas del resto', () => {
    const linea = (etiqueta: string, sentido: 'recibido' | 'entregado', piezas: number) => ({
      movimiento_id: 'm',
      presentacion_id: etiqueta,
      etiqueta,
      sentido,
      piezas,
    });
    expect(
      resumenMovimiento({
        tipo: 'merma_cliente',
        lineas: [linea('Jamaica 1 L', 'recibido', 3), linea('Jamaica 500 ml', 'entregado', 2)],
      }),
    ).toBe('Recibí dañado: Jamaica 1 L ×3 · Le entregué: Jamaica 500 ml ×2');
    expect(resumenMovimiento({ tipo: 'merma_cliente', lineas: [linea('Jamaica 1 L', 'recibido', 3)] })).toBe(
      'Recibí dañado: Jamaica 1 L ×3',
    );
    expect(
      resumenMovimiento({
        tipo: 'consumo',
        lineas: [linea('Jamaica 1 L', 'entregado', 1), linea('Jamaica 500 ml', 'entregado', 1)],
      }),
    ).toBe('Jamaica 1 L ×1, Jamaica 500 ml ×1');
  });
});

describe('crearGuardiaRegistro (doble toque)', () => {
  it('un segundo toque no vuelve a grabar', () => {
    const guardia = crearGuardiaRegistro();
    const grabar = jest.fn(() => 'grabado');
    expect(guardia.intentar(grabar)).toBe('grabado');
    expect(guardia.intentar(grabar)).toBeNull();
    expect(grabar).toHaveBeenCalledTimes(1);
  });

  it('si grabar falla, la guardia se suelta para reintentar', () => {
    const guardia = crearGuardiaRegistro();
    expect(() =>
      guardia.intentar(() => {
        throw new Error('Ya registraste tu consumo de hoy.');
      }),
    ).toThrow('Ya registraste tu consumo de hoy.');
    expect(guardia.intentar(() => 'segunda')).toBe('segunda');
  });
});
```

En `apps/tablet/src/estado/inventario.spec.ts`: agrega `filasPorRegresar` a la lista que importa de `./inventario` y al
final:

```ts
describe('filasPorRegresar (T-27 pieza 2)', () => {
  it('piezas buenas = la existencia (nunca negativa) y la merma; sin nada que regresar no sale', () => {
    expect(
      filasPorRegresar([
        { presentacionId: 'pre-1', etiqueta: 'Jamaica 1 L', existencia: 23, mermaPorRegresar: 4 },
        { presentacionId: 'pre-2', etiqueta: 'Jamaica 500 ml', existencia: -1, mermaPorRegresar: 0 },
        { presentacionId: 'pre-3', etiqueta: 'Horchata 1 L', existencia: 0, mermaPorRegresar: 2 },
      ]),
    ).toEqual([
      { presentacionId: 'pre-1', etiqueta: 'Jamaica 1 L', buenas: 23, merma: 4 },
      { presentacionId: 'pre-3', etiqueta: 'Horchata 1 L', buenas: 0, merma: 2 },
    ]);
  });
});
```

En `apps/tablet/src/estado/ruta-del-dia.spec.ts`: quita `esSeccionPendiente` y `SECCIONES_PENDIENTES` del import, y el
`describe('menu hamburguesa (D9, D16)', …)` completo pasa a:

```ts
describe('menu hamburguesa (D9, D16)', () => {
  it('las entradas del spec, en su orden, con destino', () => {
    expect(entradasMenu(false).map((e) => [e.titulo, e.destino])).toEqual([
      ['Todos los clientes', '/(jornada)/operacion'],
      ['Prospectos capturados', '/(jornada)/prospectos'],
      ['Gastos', '/(jornada)/gastos'],
      ['Inventario', '/(jornada)/inventario'],
      ['Merma y consumo', '/(jornada)/merma'],
      ['Ruta y GPS', '/(jornada)/ruta'],
      ['Cerrar el día', '/(jornada)/cerrar-dia'],
    ]);
    expect(entradasMenu(false).every((e) => !e.deshabilitada)).toBe(true);
  });

  it('con el dia cerrado se deshabilita solo lo que captura', () => {
    const deshabilitadas = entradasMenu(true)
      .filter((e) => e.deshabilitada)
      .map((e) => e.clave);
    expect(deshabilitadas).toEqual(['gastos', 'merma']);
  });

  it('ninguna entrada abre una pantalla "Próximamente" por seccion', () => {
    expect(entradasMenu(false).some((e) => e.destino.startsWith('/(jornada)/pendiente/'))).toBe(false);
    expect(entradasMenu(false).some((e) => e.descripcion.startsWith('Pendiente: T-27'))).toBe(false);
  });

  it('Gastos abre su pantalla (T-30/T-31)', () => {
    const gastos = entradasMenu(false).find((e) => e.clave === 'gastos');
    expect(gastos).toMatchObject({ titulo: 'Gastos', destino: '/(jornada)/gastos', deshabilitada: false });
    expect(gastos?.descripcion).not.toMatch(/Pendiente/);
  });

  it('Inventario abre su pantalla (T-27) y se consulta con el dia cerrado', () => {
    const inventario = entradasMenu(true).find((e) => e.clave === 'inventario');
    expect(inventario).toMatchObject({
      titulo: 'Inventario',
      destino: '/(jornada)/inventario',
      deshabilitada: false,
    });
    expect(inventario?.descripcion).not.toMatch(/Pendiente/);
  });

  it('Merma y consumo abre su pantalla (T-27 pieza 2)', () => {
    expect(entradasMenu(false).find((e) => e.clave === 'merma')).toEqual({
      clave: 'merma',
      titulo: 'Merma y consumo',
      descripcion: 'Merma del trayecto y consumo propio',
      destino: '/(jornada)/merma',
      deshabilitada: false,
    });
  });
});
```

```bash
npm test --workspace=apps/tablet -- estado
```

Esperado: fallan (`./movimiento` no existe; `filasPorRegresar` no se exporta; el menú todavía dice "Merma, promoción y
consumo" con destino `/pendiente/merma`).

- [ ] **Paso 2: la lógica de pantalla**

`apps/tablet/src/estado/movimiento.ts`:

```ts
import {
  MAX_PIEZAS_MOVIMIENTO,
  motivoDeConsumo,
  validarMovimiento,
  type LineaMovimiento,
} from '@/datos/movimientos-reglas';
import type { LineaMovimientoConEtiqueta } from '@/datos/repositorios/movimientos';
import type { Movimiento, SentidoMovimiento, TipoMovimiento } from '@/datos/tipos';
import { leerCantidad } from '@/datos/ventas-reglas';

import { motivoDeRechazo, type EstadoPastilla } from './ruta-del-dia';

/**
 * Lo que deciden las pantallas de merma y consumo (T-27 pieza 2), sin React: la
 * tablet no tiene pruebas de pantalla, asi que la validacion vive aqui y la
 * pantalla solo la pinta (mismo criterio que `gasto.ts`). Las reglas de la capa
 * de datos se reexportan: son las mismas que vuelve a revisar
 * `movimientos.registrar` al grabar.
 */
export {
  consumoRestante,
  LARGO_MAX_COMENTARIO_MOVIMIENTO,
  MENSAJE_CONSUMO_AGOTADO,
  MENSAJE_FALTA_RECIBIDO,
  MENSAJE_SIN_CONSUMO,
  motivoDeConsumo,
  textoConsumoRestante,
  validarMovimiento,
} from '@/datos/movimientos-reglas';
export type { EntradaMovimiento, LineaMovimiento } from '@/datos/movimientos-reglas';

export const MENSAJE_DIA_CERRADO_MOVIMIENTO = 'El día ya está cerrado: no se pueden registrar movimientos.';

export const TITULO_MOVIMIENTO: Record<TipoMovimiento, string> = {
  merma_cliente: 'Merma del cliente',
  merma_trayecto: 'Merma del trayecto',
  consumo: 'Consumo propio',
};

/** Lo capturado por presentacion, tal cual (el texto de cada campo). */
export type CapturaMovimiento = Record<string, Partial<Record<SentidoMovimiento, string>>>;

/** Escribe un campo sin mutar la captura (la pantalla la guarda en un `useState`). */
export function capturar(
  captura: CapturaMovimiento,
  presentacionId: string,
  sentido: SentidoMovimiento,
  texto: string,
): CapturaMovimiento {
  return { ...captura, [presentacionId]: { ...captura[presentacionId], [sentido]: texto } };
}

/** Las piezas de un campo; vacio o ilegible cuentan 0 (para "Te quedan N"). */
export function piezasCapturadas(
  captura: CapturaMovimiento,
  presentacionId: string,
  sentido: SentidoMovimiento,
): number {
  return leerCantidad(captura[presentacionId]?.[sentido] ?? '') ?? 0;
}

export interface EntradaCapturaMovimiento {
  tipo: TipoMovimiento;
  clienteId: string | null;
  captura: CapturaMovimiento;
  comentario: string;
  /** La jornada de hoy ya esta cerrada (`estadoMenuJornada`). */
  diaCerrado: boolean;
  /** Solo en el consumo: el limite y lo ya registrado hoy. */
  consumo?: { limite: number; consumoDeHoy: number };
}

export interface ValidacionCapturaMovimiento {
  lineas: LineaMovimiento[];
  comentario: string | null;
  /** Lo que falta, en el orden de la pantalla. Vacio = se puede registrar. */
  faltantes: string[];
  listo: boolean;
}

/**
 * La validacion entera de la captura. Pura: misma entrada, misma salida. La
 * existencia NO se revisa aqui (la pantalla pinta "Te quedan N" y la red
 * definitiva es el repositorio al grabar).
 */
export function validarCapturaMovimiento(e: EntradaCapturaMovimiento): ValidacionCapturaMovimiento {
  const lineas: LineaMovimiento[] = [];
  let ilegible = false;
  for (const [presentacionId, campos] of Object.entries(e.captura)) {
    for (const sentido of ['recibido', 'entregado'] as const) {
      const texto = campos[sentido];
      if (texto === undefined) continue;
      const piezas = leerCantidad(texto);
      if (piezas === null) {
        ilegible = true;
        continue;
      }
      if (piezas > 0) lineas.push({ presentacionId, sentido, piezas });
    }
  }
  const comentario = e.comentario.trim() === '' ? null : e.comentario.trim();

  const faltantes: string[] = [];
  if (ilegible) faltantes.push(`Las piezas son números enteros de 1 a ${MAX_PIEZAS_MOVIMIENTO}.`);
  faltantes.push(...validarMovimiento({ tipo: e.tipo, clienteId: e.clienteId, lineas, comentario }));
  if (e.tipo === 'consumo' && e.consumo && lineas.length > 0) {
    const motivo = motivoDeConsumo({
      limite: e.consumo.limite,
      consumoDeHoy: e.consumo.consumoDeHoy,
      piezas: lineas.reduce((total, l) => total + l.piezas, 0),
    });
    if (motivo !== null) faltantes.push(`${motivo}.`);
  }
  if (e.diaCerrado) faltantes.push(MENSAJE_DIA_CERRADO_MOVIMIENTO);

  return { lineas, comentario, faltantes, listo: faltantes.length === 0 };
}

/** Lo que falta se lista solo cuando el vendedor ya empezo a capturar (como el gasto). */
export function faltantesVisiblesMovimiento(e: EntradaCapturaMovimiento, v: ValidacionCapturaMovimiento): string[] {
  const empezo =
    e.comentario !== '' ||
    Object.values(e.captura).some((campos) => Object.values(campos).some((texto) => (texto ?? '') !== ''));
  return empezo ? v.faltantes : [];
}

/** El `tipo` de la captura del menu (parametro de la ruta): solo los que no son de un cliente. */
export function tipoDeCaptura(param: string | string[] | undefined): 'merma_trayecto' | 'consumo' | null {
  return param === 'merma_trayecto' || param === 'consumo' ? param : null;
}

/** D4 / Review Focus 1: con limite 0 el boton "Consumo propio" no se ofrece. */
export function ofreceConsumo(limite: number): boolean {
  return limite > 0;
}

/** La pastilla de UN movimiento en "Movimientos de hoy". */
export function pastillaMovimiento(
  m: Pick<Movimiento, 'sync_estado' | 'sync_error'>,
): { texto: string; estado: EstadoPastilla; detalle: string | null } {
  switch (m.sync_estado) {
    case 'pendiente':
    case 'enviando':
      return { texto: 'por subir', estado: 'pendiente', detalle: null };
    case 'sincronizado':
      return { texto: 'subido', estado: 'listo', detalle: null };
    case 'error':
      return { texto: 'rechazado', estado: 'error', detalle: motivoDeRechazo(m.sync_error) };
  }
}

/** "Recibí dañado: Jamaica 1 L ×3 · Le entregué: Jamaica 500 ml ×2", o las piezas que salieron. */
export function resumenMovimiento(m: { tipo: TipoMovimiento; lineas: readonly LineaMovimientoConEtiqueta[] }): string {
  const lista = (sentido: SentidoMovimiento) =>
    m.lineas
      .filter((l) => l.sentido === sentido)
      .map((l) => `${l.etiqueta} ×${l.piezas}`)
      .join(', ');
  if (m.tipo !== 'merma_cliente') return lista('entregado');
  const partes = [`Recibí dañado: ${lista('recibido')}`];
  const entregado = lista('entregado');
  if (entregado !== '') partes.push(`Le entregué: ${entregado}`);
  return partes.join(' · ');
}

export interface GuardiaRegistro {
  /** `null` = se ignoro: ya se grabo (o se esta grabando) con esta pantalla. */
  intentar<T>(grabar: () => T): T | null;
}

/**
 * Guardia contra el doble toque (leccion de T-39): `registrar()` genera un id
 * nuevo cada vez y `router.back()` deja la pantalla montada durante la
 * transicion, asi que un segundo toque en cola grabaria otro movimiento. Tras
 * grabar se queda cerrada; si grabar lanza (no se grabo), se suelta para
 * reintentar. La pantalla la guarda en un `useState(() => …)`.
 */
export function crearGuardiaRegistro(): GuardiaRegistro {
  let cerrada = false;
  return {
    intentar<T>(grabar: () => T): T | null {
      if (cerrada) return null;
      cerrada = true;
      try {
        return grabar();
      } catch (error) {
        cerrada = false;
        throw error;
      }
    },
  };
}
```

`apps/tablet/src/estado/inventario.ts`: agrega `consumoDelDia` y `faltantesDeMovimiento` al `export { … } from
'@/datos/inventario-reglas'`, `LineaMovimientoInventario` al `export type { … }`, y al final:

```ts
/**
 * "Por regresar a la planta" (T-27 pieza 2): por presentacion, las piezas buenas
 * (la existencia; una negativa —registrada con el control apagado— cuenta 0) y la
 * merma (recibida del cliente + del trayecto). Sin nada que regresar, no sale.
 */
export function filasPorRegresar<
  F extends { presentacionId: string; etiqueta: string; existencia: number; mermaPorRegresar: number },
>(filas: readonly F[]): { presentacionId: string; etiqueta: string; buenas: number; merma: number }[] {
  return filas
    .map((f) => ({
      presentacionId: f.presentacionId,
      etiqueta: f.etiqueta,
      buenas: Math.max(0, f.existencia),
      merma: f.mermaPorRegresar,
    }))
    .filter((f) => f.buenas > 0 || f.merma > 0);
}
```

`apps/tablet/src/estado/ruta-del-dia.ts`:
1. Borra el bloque `/** Las secciones del menu que todavia no existen … */ export const SECCIONES_PENDIENTES = { … } as const;`,
   `export type SeccionPendiente …` y `export function esSeccionPendiente …` (ya no hay secciones pendientes: la última
   era merma).
2. En `entradasMenu`, el comentario dice "Con el dia cerrado se deshabilita solo lo que captura (gastos, merma y
   consumo); lo que consulta se sigue viendo. T-30/T-31 dio a Gastos su pantalla, T-27 a Inventario y la pieza 2 a
   Merma y consumo. Ruta y GPS es la pantalla pendiente de T-41 que ya existe.", y la entrada `merma` pasa a:

```ts
    {
      clave: 'merma',
      titulo: 'Merma y consumo',
      descripcion: 'Merma del trayecto y consumo propio',
      destino: '/(jornada)/merma',
      // Captura (como Gastos): con el dia cerrado no se registra.
      deshabilitada: diaCerrado,
    },
```

```bash
npm test --workspace=apps/tablet -- estado
```

Esperado: verde.

- [ ] **Paso 3: "Merma" en la ficha del cliente**

Borra la pantalla pendiente y la sección parámetrica (ya no queda ninguna):

```bash
git rm "apps/tablet/app/(jornada)/operacion/[clienteId]/registros.tsx" "apps/tablet/app/(jornada)/pendiente/[seccion].tsx"
```

`apps/tablet/app/(jornada)/operacion/[clienteId]/merma.tsx`:

```tsx
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Platform, Text, ToastAndroid, View } from 'react-native';

import { ErrorJornada, ErrorMovimiento } from '@/datos';
import { textoTeQuedan } from '@/estado/inventario';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import {
  capturar,
  crearGuardiaRegistro,
  faltantesVisiblesMovimiento,
  LARGO_MAX_COMENTARIO_MOVIMIENTO,
  piezasCapturadas,
  validarCapturaMovimiento,
  type CapturaMovimiento,
} from '@/estado/movimiento';
import { useJawa } from '@/estado/proveedor-jawa';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/** El aviso breve al volver a la ficha (como "Gasto registrado"). En otra plataforma, un Alert. */
function avisar(texto: string) {
  if (Platform.OS === 'android') ToastAndroid.show(texto, ToastAndroid.SHORT);
  else Alert.alert(texto);
}

/**
 * Merma del cliente (T-27 pieza 2, D2): por presentacion, "Recibí dañado" (lo
 * que el cliente devuelve; al menos una pieza en total) y "Le entregué" (la
 * reposicion, opcional, de cualquier sabor y tamaño), y un comentario. Con el
 * control de inventario prendido, "Le entregué" dice "Te quedan N". Toda la
 * validacion es `validarCapturaMovimiento` (con pruebas); el repositorio vuelve
 * a revisar limite, carga pendiente y existencia al grabar.
 */
export default function MermaDelCliente() {
  const { clienteId } = useLocalSearchParams<{ clienteId: string }>();
  const { datos, vendedor, jornada, versionCatalogos } = useJawa();
  const { estilos } = useTema();
  const menu = estadoMenuJornada(jornada);

  const cliente = useMemo(() => {
    void versionCatalogos;
    return datos.catalogos.obtenerCliente(clienteId);
  }, [datos, clienteId, versionCatalogos]);

  const presentaciones = useMemo(() => {
    void versionCatalogos;
    return datos.movimientos.presentaciones();
  }, [datos, versionCatalogos]);

  // Solo para pintar "Te quedan N": `movimientos.registrar` vuelve a calcular al
  // grabar, con la base de ese momento.
  const inventario = useMemo(() => {
    void versionCatalogos;
    return vendedor ? datos.cargas.paraVenta(vendedor.id) : null;
  }, [datos, vendedor, versionCatalogos]);

  const [captura, setCaptura] = useState<CapturaMovimiento>({});
  const [comentario, setComentario] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [grabado, setGrabado] = useState(false);
  const [guardia] = useState(() => crearGuardiaRegistro());

  const entrada = {
    tipo: 'merma_cliente' as const,
    clienteId,
    captura,
    comentario,
    diaCerrado: !menu.operacionesHabilitadas,
  };
  const validacion = validarCapturaMovimiento(entrada);
  const faltantes = faltantesVisiblesMovimiento(entrada, validacion);

  function registrar() {
    setError(null);
    if (!vendedor) {
      setError('No hay vendedor con sesión iniciada.');
      return;
    }
    if (!validacion.listo) return;
    try {
      const m = guardia.intentar(() =>
        datos.movimientos.registrar({
          vendedorId: vendedor.id,
          tipo: 'merma_cliente',
          clienteId,
          lineas: validacion.lineas,
          comentario: validacion.comentario,
        }),
      );
      if (m === null) return;
      setGrabado(true);
      avisar('Merma registrada');
      router.back();
    } catch (e) {
      setError(
        e instanceof ErrorMovimiento || e instanceof ErrorJornada ? e.message : 'No se pudo registrar la merma.',
      );
    }
  }

  if (!cliente) {
    return (
      <Pantalla titulo="Cliente no encontrado" subtitulo="No está en el catálogo local de esta tablet.">
        <Text style={estilos.textoSuave}>Sincroniza y vuelve a abrir su ficha.</Text>
      </Pantalla>
    );
  }

  return (
    <Pantalla titulo="Merma" subtitulo={`${cliente.nombre} · producto dañado que te devuelve y lo que le repones`}>
      {presentaciones.length === 0 ? (
        <Tarjeta estado="pendiente" etiqueta="Catálogo vacío">
          <Text style={estilos.textoTarjeta}>Sin productos en el catálogo local</Text>
          <Text style={estilos.textoSuave}>Los productos bajan del portal con la sincronización.</Text>
        </Tarjeta>
      ) : (
        presentaciones.map((p) => {
          const entregado = piezasCapturadas(captura, p.presentacionId, 'entregado');
          const quedan = inventario?.controlInventario
            ? textoTeQuedan(inventario.existencias.get(p.presentacionId)?.existencia ?? 0, entregado)
            : null;
          return (
            <Tarjeta key={p.presentacionId} etiqueta={p.etiqueta}>
              <View style={{ flexDirection: 'row', gap: espacio.md }}>
                <View style={{ flex: 1 }}>
                  <Campo
                    etiqueta="Recibí dañado"
                    cifra
                    placeholder="0"
                    value={captura[p.presentacionId]?.recibido ?? ''}
                    onChangeText={(v) => setCaptura((c) => capturar(c, p.presentacionId, 'recibido', v))}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Campo
                    etiqueta="Le entregué"
                    cifra
                    placeholder="0"
                    value={captura[p.presentacionId]?.entregado ?? ''}
                    onChangeText={(v) => setCaptura((c) => capturar(c, p.presentacionId, 'entregado', v))}
                    invalido={quedan?.falta ?? false}
                  />
                  {quedan ? (
                    <Text style={quedan.falta ? estilos.error : estilos.textoSuave}>{quedan.texto}</Text>
                  ) : null}
                </View>
              </View>
            </Tarjeta>
          );
        })
      )}

      <Campo
        etiqueta="Comentario (opcional)"
        value={comentario}
        onChangeText={setComentario}
        placeholder="Lo que haya que recordar"
        maxLength={LARGO_MAX_COMENTARIO_MOVIMIENTO}
        multiline
      />

      {faltantes.length > 0 ? <Text style={estilos.textoSuave}>{faltantes.join(' ')}</Text> : null}
      {menu.avisoDiaCerrado ? <Text style={estilos.error}>{menu.avisoDiaCerrado}</Text> : null}
      {error ? <Text style={estilos.error}>{error}</Text> : null}

      <Boton
        etiqueta="Registrar merma"
        glifo="✓"
        deshabilitado={!validacion.listo || grabado || presentaciones.length === 0}
        onPress={registrar}
        estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
      />
    </Pantalla>
  );
}
```

En `apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx`:

1. Import: `import { pastillaMovimiento, resumenMovimiento } from '@/estado/movimiento';`
2. En el `useMemo` de `hoy`, después de `visitas: …,`:

```tsx
      // T-27 pieza 2: la merma registrada con este cliente hoy.
      movimientos: datos.movimientos.delDiaDelCliente(clienteId),
```

3. Después de `const estadoVisitas: Estado = …;`:

```tsx
  const estadoMovimientos: Estado = estadoSubida(hoy.movimientos.map((m) => m.sync_estado)) ?? 'neutro';
```

4. El bloque `{/* Secundario: sigue aqui hasta que T-27 … */} {esProspecto ? null : ( <View …> <BotonMenu
   titulo="Merma, promoción y consumo" … /> </View> )}` se reemplaza por:

```tsx
      {/* T-27 pieza 2 (D2): la merma del cliente. Tambien al prospecto: pudo
          recibir producto dañado en su regalo de bienvenida (Review Focus 4). */}
      <View style={[estilos.rejilla, { marginTop: espacio.sm }]}>
        <BotonMenu
          titulo="Merma"
          descripcion="Producto dañado que te devuelve y lo que le repones"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/merma', params }}
          deshabilitado={!menu.operacionesHabilitadas}
        />
      </View>
```

5. Después de la `Tarjeta` "Visitas de hoy":

```tsx
      {/* T-27 pieza 2: la merma con este cliente, con su subida. No se edita ni se borra (D6). */}
      <Tarjeta estado={estadoMovimientos} etiqueta="Movimientos de hoy">
        {hoy.movimientos.length === 0 ? (
          <Text style={estilos.textoSuave}>Sin merma registrada hoy.</Text>
        ) : (
          hoy.movimientos.map((m) => {
            const p = pastillaMovimiento(m);
            return (
              <View key={m.id} style={{ gap: espacio.xs, marginBottom: espacio.sm }}>
                <Text style={estilos.textoTarjeta}>
                  Merma · <Cifra valor={formatearHora(m.registrado_en)} />
                </Text>
                <Text style={estilos.textoSuave}>{resumenMovimiento(m)}</Text>
                {m.comentario ? <Text style={estilos.textoSuave}>{m.comentario}</Text> : null}
                <Pastilla texto={p.texto} estado={p.estado} />
                {p.detalle ? <Text style={estilos.error}>{p.detalle}</Text> : null}
              </View>
            );
          })
        )}
      </Tarjeta>
```

- [ ] **Paso 4: "Merma y consumo" en el menú y su captura**

`apps/tablet/app/(jornada)/merma/index.tsx`:

```tsx
import { useMemo } from 'react';
import { Text, View } from 'react-native';

import { estadoMenuJornada } from '@/estado/menu-jornada';
import {
  consumoRestante,
  MENSAJE_CONSUMO_AGOTADO,
  ofreceConsumo,
  pastillaMovimiento,
  resumenMovimiento,
  textoConsumoRestante,
  TITULO_MOVIMIENTO,
} from '@/estado/movimiento';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { estadoSubida } from '@/estado/ruta-del-dia';
import { BotonMenu } from '@/ui/boton-menu';
import { Cifra } from '@/ui/cifra';
import { formatearHora } from '@/ui/momento';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/**
 * Merma y consumo (T-27 pieza 2, D3, entrada del menu): "Merma del trayecto" y
 * "Consumo propio" (con el limite de su sucursal; con 0 no se ofrece, D4), y
 * debajo los movimientos de hoy —tambien la merma de los clientes— con su
 * subida. Un movimiento grabado no se edita ni se borra (D6).
 */
export default function MermaYConsumo() {
  const { datos, vendedor, jornada, versionCatalogos } = useJawa();
  const { ultimaSincronizacion } = useSesion();
  const { estilos } = useTema();
  const menu = estadoMenuJornada(jornada);

  // Se relee UNA vez por cambio (como Gastos): `movimientos.registrar` mueve
  // `versionCatalogos` mientras esta pantalla sigue montada debajo de la
  // captura; la subida cambia la pastilla con `ultimaSincronizacion`.
  const vista = useMemo(() => {
    void versionCatalogos;
    void ultimaSincronizacion;
    if (!vendedor) return { movimientos: [], limite: 0, consumoDeHoy: 0 };
    return {
      movimientos: datos.movimientos.delDia(vendedor.id),
      limite: datos.movimientos.consumoDiarioMax(vendedor.id),
      consumoDeHoy: datos.movimientos.consumoDeHoy(vendedor.id),
    };
  }, [datos, vendedor, versionCatalogos, ultimaSincronizacion]);

  const restante = consumoRestante({ limite: vista.limite, consumoDeHoy: vista.consumoDeHoy });
  const estado = estadoSubida(vista.movimientos.map((m) => m.sync_estado)) ?? 'neutro';

  return (
    <Pantalla titulo="Merma y consumo" subtitulo="Lo que sale de la camioneta sin venderse">
      <View style={estilos.rejilla}>
        <BotonMenu
          titulo="Merma del trayecto"
          descripcion="Producto que se te rompió o se echó a perder hoy"
          destino={{ pathname: '/(jornada)/merma/registrar', params: { tipo: 'merma_trayecto' } }}
          deshabilitado={!menu.operacionesHabilitadas}
          destacada
        />
        {ofreceConsumo(vista.limite) ? (
          <BotonMenu
            titulo="Consumo propio"
            descripcion={restante > 0 ? textoConsumoRestante(restante) : MENSAJE_CONSUMO_AGOTADO}
            destino={{ pathname: '/(jornada)/merma/registrar', params: { tipo: 'consumo' } }}
            deshabilitado={!menu.operacionesHabilitadas || restante === 0}
          />
        ) : null}
      </View>
      <Text style={[estilos.textoSuave, { marginTop: espacio.sm }]}>
        La merma de un cliente se registra en su ficha.
      </Text>
      {menu.avisoDiaCerrado ? <Text style={estilos.error}>{menu.avisoDiaCerrado}</Text> : null}

      <Tarjeta estado={estado} etiqueta="Movimientos de hoy">
        {vista.movimientos.length === 0 ? (
          <Text style={estilos.textoSuave}>Todavía no registras merma ni consumo hoy.</Text>
        ) : (
          vista.movimientos.map((m) => {
            const p = pastillaMovimiento(m);
            const cliente = m.cliente_id ? datos.catalogos.obtenerCliente(m.cliente_id) : null;
            return (
              <View key={m.id} style={{ gap: espacio.xs, marginBottom: espacio.sm }}>
                <Text style={estilos.textoTarjeta}>
                  {TITULO_MOVIMIENTO[m.tipo]}
                  {cliente ? ` · ${cliente.nombre}` : ''} · <Cifra valor={formatearHora(m.registrado_en)} />
                </Text>
                <Text style={estilos.textoSuave}>{resumenMovimiento(m)}</Text>
                {m.comentario ? <Text style={estilos.textoSuave}>{m.comentario}</Text> : null}
                <Pastilla texto={p.texto} estado={p.estado} />
                {p.detalle ? <Text style={estilos.error}>{p.detalle}</Text> : null}
              </View>
            );
          })
        )}
      </Tarjeta>
    </Pantalla>
  );
}
```

`apps/tablet/app/(jornada)/merma/registrar.tsx`:

```tsx
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Platform, Text, ToastAndroid } from 'react-native';

import { ErrorJornada, ErrorMovimiento } from '@/datos';
import { textoTeQuedan } from '@/estado/inventario';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import {
  capturar,
  consumoRestante,
  crearGuardiaRegistro,
  faltantesVisiblesMovimiento,
  LARGO_MAX_COMENTARIO_MOVIMIENTO,
  piezasCapturadas,
  textoConsumoRestante,
  tipoDeCaptura,
  TITULO_MOVIMIENTO,
  validarCapturaMovimiento,
  type CapturaMovimiento,
} from '@/estado/movimiento';
import { useJawa } from '@/estado/proveedor-jawa';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

function avisar(texto: string) {
  if (Platform.OS === 'android') ToastAndroid.show(texto, ToastAndroid.SHORT);
  else Alert.alert(texto);
}

/**
 * Captura de la merma del trayecto o del consumo propio (T-27 pieza 2, D3): una
 * fila por presentacion con las piezas que salen de la camioneta, y un
 * comentario. El consumo dice "Te quedan N de consumo hoy" y no deja pasar el
 * limite (D4); con el control prendido, cada fila dice "Te quedan N" (D5).
 */
export default function RegistrarMovimiento() {
  const params = useLocalSearchParams<{ tipo?: string }>();
  const tipo = tipoDeCaptura(params.tipo);
  const { datos, vendedor, jornada, versionCatalogos } = useJawa();
  const { estilos } = useTema();
  const menu = estadoMenuJornada(jornada);

  const presentaciones = useMemo(() => {
    void versionCatalogos;
    return datos.movimientos.presentaciones();
  }, [datos, versionCatalogos]);

  const inventario = useMemo(() => {
    void versionCatalogos;
    return vendedor ? datos.cargas.paraVenta(vendedor.id) : null;
  }, [datos, vendedor, versionCatalogos]);

  const consumo = useMemo(() => {
    void versionCatalogos;
    return vendedor
      ? {
          limite: datos.movimientos.consumoDiarioMax(vendedor.id),
          consumoDeHoy: datos.movimientos.consumoDeHoy(vendedor.id),
        }
      : { limite: 0, consumoDeHoy: 0 };
  }, [datos, vendedor, versionCatalogos]);

  const [captura, setCaptura] = useState<CapturaMovimiento>({});
  const [comentario, setComentario] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [grabado, setGrabado] = useState(false);
  const [guardia] = useState(() => crearGuardiaRegistro());

  if (tipo === null) {
    return (
      <Pantalla titulo="Sección no encontrada" subtitulo="Vuelve a Merma y consumo.">
        <Text style={estilos.textoSuave}>Esta captura no existe.</Text>
      </Pantalla>
    );
  }

  const entrada = {
    tipo,
    clienteId: null,
    captura,
    comentario,
    diaCerrado: !menu.operacionesHabilitadas,
    consumo: tipo === 'consumo' ? consumo : undefined,
  };
  const validacion = validarCapturaMovimiento(entrada);
  const faltantes = faltantesVisiblesMovimiento(entrada, validacion);
  const restante = consumoRestante(consumo);

  function registrar() {
    setError(null);
    if (!vendedor || tipo === null) {
      setError('No hay vendedor con sesión iniciada.');
      return;
    }
    if (!validacion.listo) return;
    try {
      const m = guardia.intentar(() =>
        datos.movimientos.registrar({
          vendedorId: vendedor.id,
          tipo,
          clienteId: null,
          lineas: validacion.lineas,
          comentario: validacion.comentario,
        }),
      );
      if (m === null) return;
      setGrabado(true);
      avisar(tipo === 'consumo' ? 'Consumo registrado' : 'Merma registrada');
      router.back();
    } catch (e) {
      setError(e instanceof ErrorMovimiento || e instanceof ErrorJornada ? e.message : 'No se pudo registrar.');
    }
  }

  return (
    <Pantalla
      titulo={TITULO_MOVIMIENTO[tipo]}
      subtitulo={tipo === 'consumo' ? 'Lo que tomas para ti de la camioneta' : 'Lo que se rompió o se echó a perder'}
    >
      {tipo === 'consumo' ? (
        <Tarjeta estado={restante > 0 ? 'listo' : 'pendiente'} etiqueta="Consumo de hoy">
          <Text style={estilos.textoTarjeta}>{textoConsumoRestante(restante)}</Text>
        </Tarjeta>
      ) : null}

      {presentaciones.map((p) => {
        const sale = piezasCapturadas(captura, p.presentacionId, 'entregado');
        const quedan = inventario?.controlInventario
          ? textoTeQuedan(inventario.existencias.get(p.presentacionId)?.existencia ?? 0, sale)
          : null;
        return (
          <Tarjeta key={p.presentacionId} etiqueta={p.etiqueta}>
            <Campo
              etiqueta="Piezas"
              cifra
              placeholder="0"
              value={captura[p.presentacionId]?.entregado ?? ''}
              onChangeText={(v) => setCaptura((c) => capturar(c, p.presentacionId, 'entregado', v))}
              invalido={quedan?.falta ?? false}
            />
            {quedan ? <Text style={quedan.falta ? estilos.error : estilos.textoSuave}>{quedan.texto}</Text> : null}
          </Tarjeta>
        );
      })}

      <Campo
        etiqueta="Comentario (opcional)"
        value={comentario}
        onChangeText={setComentario}
        placeholder="Lo que haya que recordar"
        maxLength={LARGO_MAX_COMENTARIO_MOVIMIENTO}
        multiline
      />

      {faltantes.length > 0 ? <Text style={estilos.textoSuave}>{faltantes.join(' ')}</Text> : null}
      {menu.avisoDiaCerrado ? <Text style={estilos.error}>{menu.avisoDiaCerrado}</Text> : null}
      {error ? <Text style={estilos.error}>{error}</Text> : null}

      <Boton
        etiqueta={tipo === 'consumo' ? 'Registrar consumo' : 'Registrar merma del trayecto'}
        glifo="✓"
        deshabilitado={!validacion.listo || grabado || presentaciones.length === 0}
        onPress={registrar}
        estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
      />
    </Pantalla>
  );
}
```

Los hooks de `registrar.tsx` van todos antes del `return` de "Sección no encontrada" (regla de los hooks); por eso
`consumo` se lee aunque el tipo sea trayecto.

`apps/tablet/app/(jornada)/_layout.tsx`: reemplaza el `Stack.Screen` de `operacion/[clienteId]/registros` por

```tsx
      <Stack.Screen name="operacion/[clienteId]/merma" options={{ title: 'Merma' }} />
```

borra `<Stack.Screen name="pendiente/[seccion]" options={{ title: 'Próximamente' }} />` y, después de
`gastos/registrar`:

```tsx
      <Stack.Screen name="merma/index" options={{ title: 'Merma y consumo' }} />
      <Stack.Screen name="merma/registrar" options={{ title: 'Merma y consumo' }} />
```

- [ ] **Paso 5: Inventario con las columnas nuevas y "Por regresar a la planta"**

`apps/tablet/app/(jornada)/inventario/index.tsx`:

1. Import: `import { filasPorRegresar, NOTA_CONTROL_APAGADO, pastillaCarga, totalPiezas } from '@/estado/inventario';`
2. El comentario del componente: "Inventario (T-27, entrada del menu): las cargas de hoy con su estado y total; por
   presentacion Cargado − Vendido − Regalado − Merma entregada − Merma del trayecto − Consumo = Existencia (pieza 2), y
   lo que hay que regresar a la planta: piezas buenas y merma. …" (el resto igual).
3. El `subtitulo` de la `Pantalla`: `"Lo que traes hoy: tus cargas aceptadas menos lo que vendiste, regalaste, repusiste, se mermó y consumiste."`
4. En el `useMemo` de `vista`, la rama sin vendedor pasa a `{ cargas: [], filas: [], control: false }` (igual) y se
   agrega, después del `useMemo`:

```tsx
  const porRegresar = filasPorRegresar(vista.filas);
```

5. La `Tarjeta` de "Por presentación" (la que lleva la etiqueta `"Cargado − Vendido − Regalado = Existencia"`) se
   reemplaza por:

```tsx
        <Tarjeta etiqueta="Cargado − Vendido − Regalado − Merma entregada − Merma del trayecto − Consumo = Existencia">
          {vista.filas.map((f) => (
            <View
              key={f.presentacionId}
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                gap: espacio.sm,
                marginBottom: espacio.xs,
              }}
            >
              <Text style={[estilos.textoTarjeta, { flexShrink: 1 }]}>{f.etiqueta}</Text>
              <Text style={estilos.textoSuave}>
                <Cifra valor={f.cargado} tono="suave" /> − <Cifra valor={f.vendido} tono="suave" /> −{' '}
                <Cifra valor={f.regalado} tono="suave" /> − <Cifra valor={f.mermaEntregada} tono="suave" /> −{' '}
                <Cifra valor={f.mermaTrayecto} tono="suave" /> − <Cifra valor={f.consumo} tono="suave" /> ={' '}
                <Cifra valor={f.existencia} tono={f.existencia <= 0 ? 'peligro' : 'tinta'} />
              </Text>
            </View>
          ))}
        </Tarjeta>
```

6. Al final, después de esa sección (antes de cerrar `</Pantalla>`):

```tsx
      <Text style={estilos.seccion}>Por regresar a la planta</Text>
      {porRegresar.length === 0 ? (
        <Tarjeta etiqueta="Nada por regresar">
          <Text style={estilos.textoSuave}>Cuando te quede producto o registres merma, aparece aquí.</Text>
        </Tarjeta>
      ) : (
        <Tarjeta etiqueta="Piezas buenas · Merma">
          {porRegresar.map((f) => (
            <View
              key={f.presentacionId}
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: espacio.sm, marginBottom: espacio.xs }}
            >
              <Text style={[estilos.textoTarjeta, { flexShrink: 1 }]}>{f.etiqueta}</Text>
              <Text style={estilos.textoSuave}>
                Buenas <Cifra valor={f.buenas} tono="tinta" /> · Merma{' '}
                <Cifra valor={f.merma} tono={f.merma > 0 ? 'aviso' : 'suave'} />
              </Text>
            </View>
          ))}
        </Tarjeta>
      )}
```

- [ ] **Paso 6: typecheck, lint y pruebas**

```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
git status
```

Esperado: verde; `git status` sin cambios de `expo` en `package.json`/`tsconfig.json`/`app.json` (si los hay, `git
checkout -- <archivo>`). (La app no usa `typedRoutes`: `app.json` no lo activa, así que las rutas nuevas no
necesitan tipos generados.)

- [ ] **Paso 7: aceptación en el emulador (controlador, obligatoria)**

Backend y app de este worktree (Metro en 8082), Supabase local con las migraciones de la Tarea 1, vendedor demo
(`demo`/`demo1234`) en una sucursal con **control de inventario prendido** y consumo máximo **1** (portal, Tarea 3), y
una carga aceptada de hoy (portal *Producción › Recarga* → Aceptar en la tablet) con al menos dos presentaciones.

1. **Merma del cliente con reposición**: ficha de un cliente → "Merma" → Recibí dañado 3 de A, Le entregué 2 de B
   ("Te quedan N" baja al teclear) → Registrar merma → vuelve a la ficha con el aviso; "Movimientos de hoy" la muestra
   "por subir". Inventario: B baja 2 en Merma entregada y en Existencia; "Por regresar a la planta" muestra Merma 3 de A
   y las buenas.
2. **Review Focus 3**: en "Merma" capturar solo "Le entregué" → no se habilita "Registrar merma" y dice "Captura al
   menos una pieza en «Recibí dañado»."
3. **Review Focus 2**: "Le entregué" más de lo que queda de B → "Te quedan" en rojo; al tocar Registrar (si la captura
   está lista) dice "No te alcanza el producto: B: faltan N piezas." y no graba. Apagar el control en el portal,
   Sincronizar, repetir → sí graba.
4. **Merma del trayecto**: menú → "Merma y consumo" → "Merma del trayecto" → 1 pieza → registra; aparece en la lista
   de hoy y en Inventario (columna Merma del trayecto y en la merma por regresar).
5. **Review Focus 1**: "Consumo propio" dice "Te quedan 1 de consumo hoy" → registrar 1 → el botón queda deshabilitado
   con "Ya registraste tu consumo de hoy". Poner 0 en el portal, Sincronizar → el botón "Consumo propio" ya no
   aparece (**Review Focus 5**: bajó sin tocar al vendedor).
6. **Bloqueo**: con el control prendido y una carga **pendiente** de hoy, la merma del trayecto dice "Tienes una carga
   por aceptar. Acéptala en Inventario antes de sacar piezas de la camioneta."; una merma del cliente solo con "Recibí
   dañado" sí entra.
7. **Doble toque**: tocar dos veces rápido "Registrar merma del trayecto" → un solo movimiento en la lista.
8. **Sincronizar** y ver en Postgres local (`docker exec supabase_db_proyecto-sinmex psql -U postgres -c "select tipo,
   cliente_id, fecha from movimiento_inventario order by created_at desc limit 5"` y sus líneas): las filas con el id
   de la tablet; las pastillas pasan a "subido".
9. **Día cerrado**: cerrar el día → "Merma y consumo" queda deshabilitada en el menú y el botón "Merma" de la ficha
   también.
10. Restablecer la sucursal (control y consumo como estaban) y revisar que ningún gesto re-renderizó la pantalla a
    medias (los "Te quedan N" cambian dentro de su tarjeta; el título no).

- [ ] **Paso 8: commit**

```bash
git add -A apps/tablet/app apps/tablet/src/estado
git status
git commit -m "T-27: pantallas de merma y consumo, Inventario extendido y movimientos de hoy en la ficha

Refs #27

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 6: Documentación del repo (CLAUDE.md, README de la tablet y enmiendas del spec)

**Files:**
- Modify: `CLAUDE.md`
- Modify: `apps/tablet/README.md`
- Modify: `docs/superpowers/specs/2026-10-23-t-27-merma-y-consumo-design.md` (solo la sección de enmiendas, con lo que el
  controlador haya resuelto de "Conflictos para el controlador")

**Interfaces:**
- Consumes: todo lo de las Tareas 1–5 (nombres de archivos, códigos, textos).
- Produces: documentación; sin código.

- [ ] **Paso 1: CLAUDE.md**

1. En el bloque de gastos (T-30/T-31), la frase "El botón de la ficha queda en "Merma, promoción y consumo" (T-27)."
   pasa a "La ficha ya no tiene ese botón: su "Merma" es de T-27 pieza 2."
2. En el bloque de T-27 pieza 1, "Piezas 2 (movimientos del día) y 3 (corte de inventario) son otros PR." pasa a "La
   pieza 2 (merma y consumo) está abajo; la 3 (corte de inventario) es otro PR."
3. Justo después del bloque de T-27 pieza 1 (después de su punto "**Nube**: `20261022120000_carga_vendedor.sql` …"),
   agrega:

```markdown
- **Merma y consumo en la tablet (T-27 pieza 2).** La tablet registra lo que sale o entra a la camioneta sin ser venta:
  **merma del cliente** (en la ficha, "Merma": "Recibí dañado" —al menos una pieza— y "Le entregué", la reposición de
  cualquier sabor), **merma del trayecto** y **consumo propio** (menú → "Merma y consumo"). Una sola operación
  `movimiento` con `tipo`; un movimiento grabado no se edita ni se borra en la app (D6). Spec:
  `docs/superpowers/specs/2026-10-23-t-27-merma-y-consumo-design.md`.
  - **Servidor**: `sucursal.consumo_diario_max` (0–99, default 1), `movimiento_inventario` (`id` = clave, `fecha` =
    `fecha_operacion`, `ck_movimiento_cliente`: solo la merma del cliente lleva cliente, trigger de `updated_at`) y
    `movimiento_inventario_linea` (`sentido` recibido|entregado, `uq_movimiento_linea`). Proyección en
    `modules/inventario/` (`datos-movimiento.ts`, `movimientos.service.ts`, exportado por `InventarioModule`);
    `sincronizacion/despacho-movimiento.ts` revisa el sobre. Rechazos: `datos-invalidos` (forma, cliente según el tipo,
    presentación que nunca existió), `cliente-fuera-de-alcance` y el nuevo `movimiento-id-ocupado`. **El servidor no
    revisa el límite de consumo ni la existencia** (lo exige la tablet).
  - **Contrato** (aditivo, `CONTRATO_ACTUAL` sigue en 1): tipo `movimiento` (el tipo `merma` queda reservado, sin
    proyección), `VendedorPull.consumo_diario_max`. Cambiar el límite en el portal toca `vendedor.updated_at` de la
    sucursal (como `control_inventario`). Orden del push: `… → gastos → movimientos → rutas`.
  - **Portal**: *Catálogo › Sucursales*: "Consumo propio máximo por día" (0–99) en la edición
    (`components/sucursales/consumo-diario.ts`).
  - **Tablet** (migración local 018): `movimiento`, `movimiento_linea`, `vendedor.consumo_diario_max` (el login sin red
    no lo pisa). Reglas en `src/datos/inventario-reglas.ts` (`existencias` resta merma entregada, del trayecto y consumo,
    y da `mermaPorRegresar`; `faltantesDeMovimiento`, `consumoDelDia`) y `src/datos/movimientos-reglas.ts`
    (`validarMovimiento`, `consumoRestante`, `motivoDeConsumo`); pantalla en `src/estado/movimiento.ts` (guardia de doble
    toque `crearGuardiaRegistro`). **`movimientos.registrar()` revisa forma, límite de consumo (piezas), carga pendiente
    y faltantes dentro de su transacción**; lo que solo recibe merma no se bloquea. `ventas.registrar()` también resta
    los movimientos. Pantallas: ficha → "Merma" y "Movimientos de hoy"; menú → "Merma y consumo" (+ `merma/registrar`);
    Inventario con Merma entregada, Merma del trayecto, Consumo y "Por regresar a la planta".
  - **Nube**: `20261025120000_movimiento_inventario.sql` se sube a `sinmex dev` después del merge, con el protocolo de
    push (pre-flight: tablas nuevas y una columna con default; nada que contar). Backend antes que la app.
```

- [ ] **Paso 2: README de la tablet**

`apps/tablet/README.md`:

1. En "Estructura", la línea `│       ├── pendiente/         # secciones del menu que aun no existen (merma)` pasa a
   `│       ├── merma/             # Merma y consumo: trayecto y consumo propio (T-27 pieza 2)`, y la de `operacion/`
   pasa a `│       ├── operacion/         # todos los clientes -> ficha -> venta / cobranza / visita / merma`.
2. Después de la sección de nivel 2 "Carga, recarga e Inventario (T-27 pieza 1)", agrega una sección de nivel 2
   titulada "Merma y consumo (T-27 pieza 2)" con este texto:

```markdown
Spec: `docs/superpowers/specs/2026-10-23-t-27-merma-y-consumo-design.md`.

- **Migración 018**: `movimiento` y `movimiento_linea` (los escribe la tablet y los sube el push como `tipo:
  'movimiento'`, entre gastos y rutas) y `vendedor.consumo_diario_max` (el límite de su sucursal; baja en el pull).
- **Ficha → "Merma"** (`operacion/[clienteId]/merma.tsx`): por presentación "Recibí dañado" y "Le entregué" (con
  "Te quedan N" si el control está prendido), comentario y "Registrar merma". La ficha muestra "Movimientos de hoy".
- **Menú → "Merma y consumo"** (`merma/index.tsx`): "Merma del trayecto" y "Consumo propio" (con "Te quedan N de
  consumo hoy"; con límite 0 no aparece) abren `merma/registrar.tsx`; debajo, los movimientos de hoy con su subida.
- **Inventario**: Cargado − Vendido − Regalado − Merma entregada − Merma del trayecto − Consumo = Existencia, y "Por
  regresar a la planta" (piezas buenas y merma). La merma recibida del cliente no suma a la existencia.
- `movimientos.registrar()` valida forma, límite de consumo, carga pendiente y faltantes **dentro de su transacción**
  (como la venta) y publica un cambio de catálogo. Un movimiento grabado no se edita ni se borra.
- Lógica con pruebas: `src/datos/movimientos-reglas.ts`, `src/datos/inventario-reglas.ts`,
  `src/datos/repositorios/movimientos.ts`, `src/estado/movimiento.ts`, `src/sincronizacion/fuente-movimientos.ts`.
```

3. En "Pendiente (otros tickets)", la línea de "**T-27 (piezas 2 y 3) / T-33 / T-41**" pasa a "**T-27 (pieza 3) / T-33
   / T-41** — corte de inventario, corte del día, Ruta y GPS. Los gastos (T-30/T-31), la carga e Inventario (T-27 pieza
   1) y la merma y el consumo (T-27 pieza 2) ya tienen pantalla."

- [ ] **Paso 3: enmiendas del spec (solo lo que el controlador haya resuelto)**

Al final de `docs/superpowers/specs/2026-10-23-t-27-merma-y-consumo-design.md`, una sección de nivel 2 "Enmiendas
del plan (2026-10-23)" con una viñeta por cada conflicto que el controlador **aceptó** tal como lo recomienda este plan
(ver "Conflictos para el controlador"), por ejemplo:

```markdown
- El tipo `merma` del contrato queda reservado sin proyección; la merma viaja como `movimiento` (D7).
- `cliente-inexistente` no aplica al movimiento: el alcance del lote ya rechaza un cliente vivo de otra sucursal o dado
  de baja como `cliente-fuera-de-alcance`; un prospecto se acepta.
- La ficha del prospecto también ofrece "Merma" (Review Focus 4).
- El límite de consumo cuenta piezas; con límite 0 el botón no aparece y el repositorio dice "Tu sucursal no tiene
  consumo propio".
- La carga pendiente solo bloquea lo que saca piezas; una merma del cliente solo con "Recibí dañado" entra.
- "Por regresar a la planta": piezas buenas = la existencia, y una negativa cuenta 0.
```

Si el controlador resolvió alguno distinto, escribe su decisión, no la recomendación.

- [ ] **Paso 4: commit**

```bash
git add CLAUDE.md apps/tablet/README.md docs/superpowers/specs/2026-10-23-t-27-merma-y-consumo-design.md
git status
git commit -m "T-27: documentación de la merma y el consumo (pieza 2)

Refs #27

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Conflictos para el controlador

Contradicciones entre el spec y el código, y decisiones que el plan tuvo que tomar. Cada una con su recomendación.

1. **El contrato ya tiene un tipo `merma`** (reservado desde T-07, sin forma ni proyección; `despacho.ts` lo manda al
   buzón y `despacho.spec.ts`/`operaciones.spec.ts`/`sincronizacion.e2e-spec.ts` lo usan así). El spec (D7) pide un tipo
   nuevo `movimiento`. **Recomendación:** dejar `merma` reservado tal cual (quitarlo sería un cambio incompatible y
   rompería pruebas existentes) y agregar `movimiento`, como hizo T-39 con `visita` frente a `ruta`. El plan lo hace así
   y actualiza los comentarios del contrato y del doc.
2. **`cliente-inexistente` no puede salir para un movimiento.** El spec lista "`cliente-inexistente` /
   `cliente-fuera-de-alcance` (los de siempre)", pero en el push el alcance del lote (`clientesEnAlcance`) ya rechaza
   como `cliente-fuera-de-alcance` a un cliente que no existe, está dado de baja o es de otra sucursal, antes de la
   proyección; `cliente-inexistente` hoy es solo del `ruta-alta` (que además rechaza prospectos). **Recomendación:** no
   agregar una segunda revisión del cliente en `MovimientosService`; documentarlo como enmienda.
3. **Merma a un prospecto.** La ficha oculta hoy "Cobrar" y el botón "Merma, promoción y consumo" para los prospectos
   (T-75 D6: "un prospecto no tiene notas ni inventario que ajustar"), pero el Review Focus 4 del spec pide que una
   merma a un prospecto recién capturado no se pierda. **Recomendación:** mostrar "Merma" también al prospecto (pudo
   recibir producto dañado en su regalo de bienvenida); el plan lo hace y el repositorio lo acepta (el catálogo solo
   exige el cliente activo). Si Mario prefiere ocultarlo, basta envolver el `BotonMenu` en `esProspecto ? null : …` y el
   Review Focus 4 queda cubierto solo del lado del servidor y de la cola.
4. **El límite de consumo cuenta piezas, no registros.** El spec dice "La tablet no deja registrar más consumo en el día
   que el límite" y la ayuda del portal habla de "Piezas que cada vendedor puede registrar". **Recomendación:** piezas
   (lo implementado: `motivoDeConsumo` suma las piezas del día). Con límite 0 el botón no aparece y, si se llegara por
   una ruta profunda, el repositorio dice "Tu sucursal no tiene consumo propio."; si no alcanza, "Te quedan N de consumo
   hoy; no puedes registrar M."
5. **La carga pendiente solo bloquea lo que saca piezas.** D5 dice que "lo que saca piezas buenas" respeta existencia y
   carga pendiente. **Recomendación:** una merma del cliente con solo "Recibí dañado" se graba aunque haya carga
   pendiente o el control esté prendido (no saca nada de la camioneta); el plan lo prueba en `movimientos.spec.ts`.
6. **"Piezas buenas" por regresar con existencia negativa** (posible con el control apagado). El spec dice "piezas
   buenas = la existencia". **Recomendación:** mostrar `max(0, existencia)` en "Por regresar a la planta" (no se
   regresan piezas negativas); la tabla por presentación sigue mostrando la existencia real en rojo.
7. **Se borran `SECCIONES_PENDIENTES`, `esSeccionPendiente` y `app/(jornada)/pendiente/[seccion].tsx`.** La merma era
   la última sección "Próximamente" del menú (Ruta y GPS tiene su propia pantalla). **Recomendación:** borrarlas (código
   muerto); si un ticket futuro necesita otra pantalla pendiente, la vuelve a crear. También se borra
   `operacion/[clienteId]/registros.tsx` (la pantalla pendiente que reemplaza "Merma"). La promoción a $0 que mencionaba
   su texto ya vive en la venta (T-74) y la captura desde el portal es T-35.
8. **"Movimientos de hoy" del menú incluye la merma de los clientes** (con el nombre del cliente), no solo trayecto y
   consumo: el spec dice "la lista de los movimientos de hoy". **Recomendación:** los tres tipos.
9. **Presentaciones dadas de baja en el servidor se aceptan**; solo un id que nunca existió es `datos-invalidos` (el
   spec dice "presentación inexistente incluida"). Mismo criterio que el campo de egreso dado de baja en el gasto:
   las piezas ya salieron. **Recomendación:** así.
10. **Tope de líneas por movimiento**: el spec no lo fija; el plan pone `MAX_LINEAS_MOVIMIENTO = 200` en el servidor
    para que un lote raro no reviente (hay decenas de presentaciones). **Recomendación:** aceptar.
11. **El campo del portal solo aparece al editar**, no en el alta (el `CrearSucursalDto` solo lleva código y nombre, y
    la sucursal nace con 1 por el default de la base), igual que la casilla de control de inventario.
    **Recomendación:** así; no hay columna nueva en la tabla del catálogo ("Nada más en esta pieza").
12. **La tablet no guarda `sucursal_id` en `movimiento`** (el spec no lo lista y el servidor la toma del token), a
    diferencia de `gasto`. **Recomendación:** así.
13. **`ventas.registrar()` también resta los movimientos** (consecuencia directa de D5 y de "Existencia para vender"
    del spec): con el control prendido, una venta después de una merma del trayecto ve menos piezas. El plan lo prueba
    en `movimientos.spec.ts` ("la venta también resta los movimientos").
14. **La suite e2e usa la sucursal `ZM`** (libre al escribir el plan) para cambiar el límite sin tocar TJ ni MX; si otra
    rama la tomó entre tanto, usa otra libre y anótalo.
15. **Commits con `Refs #27`**, nunca `Closes`: el ticket tiene pieza 3 (corte).

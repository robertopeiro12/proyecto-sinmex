# T-27 pieza 1 · Carga y recarga del vendedor — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que producción registre en el portal (*Producción › Recarga*) la carga de la mañana y cada recarga de cada
vendedor; que la carga baje a la tablet en el pull, que el vendedor la **acepte o la rechace** con red (endpoint con
versión, 409 si el portal la cambió), y que con el control de inventario de su sucursal prendido (*Catálogo ›
Sucursales*) la tablet no venda con una carga pendiente ni deje ninguna presentación en negativo (piezas vendidas más
piezas regaladas). La pantalla Inventario de la tablet muestra Cargado − Vendido − Regalado = Existencia.

**Architecture:** servidor: migración `20261022120000_carga_vendedor.sql` (`sucursal.control_inventario`, `carga`,
`carga_detalle`); módulo `modules/produccion/` con reglas puras (`reglas-carga.ts`: líneas, editable, rejilla,
respuesta, forma del pull), repositorio y servicio dueños de la tabla, y el controlador del portal (`/cargas`, permiso
`carga.gestionar`, otra sucursal = 404). `sincronizacion/` solo despacha: el pull pide a `CargasService.paraPull` la
colección nueva `cargas` y `VendedorPull` gana `control_inventario`; el endpoint de la app
`POST /sync/cargas/:id/respuesta` (`@SoloApp()`) vive en `sincronizacion/cargas-app.controller.ts` y llama a
`CargasService.responder` (transacción con `for update`, idempotente, 409 con la carga actual). Cambiar la casilla de
la sucursal toca `vendedor.updated_at` de sus vendedores en la misma transacción. Portal: rejilla presentaciones ×
vendedores con subcolumnas por carga (`components/produccion/`), lógica en `lib/cargas.ts`. Tablet: migración local
017 (`carga`, `carga_detalle`, `vendedor.control_inventario`), mezcla del pull en `repositorios/cargas.ts`, reglas puras
del inventario en `src/datos/inventario-reglas.ts` (las usa el repositorio de ventas, que no puede importar de
`src/estado/`) reexportadas y completadas en `src/estado/inventario.ts` (respuesta, textos, guardia de doble toque);
`ventas.registrar()` recalcula bloqueo y faltantes **dentro de su transacción**, antes de emitir el folio.

**Tech Stack:** NestJS 11 + Kysely (backend), Postgres local vía Supabase (e2e, pgTAP), Next.js 15 + Vitest +
Testing Library (portal), Expo SDK 57 / React Native 0.86 + SQLite + Jest en Node (tablet; sin pruebas de pantalla).

**Spec:** `docs/superpowers/specs/2026-10-22-t-27-carga-y-recarga-design.md` — léelo antes de empezar. Sus decisiones
D1…D10 **no se renegocian**. Si este plan lo contradice, manda el spec: para y pregunta (ver "Conflictos para el
controlador" al final, donde están las que este plan tuvo que interpretar).

---

## Global Constraints

Copiadas del spec y del repo. Cada tarea las incluye:

- Rama `feature/t-27-carga-recarga`. Todos los comandos **desde la raíz del worktree**
  (`/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-t27`), con los scripts del workspace
  (`--workspace=apps/...`). **Nunca** entres a `../proyecto-sinmex` (clon de demo) ni a otro clon.
- Si el worktree **no tiene `node_modules`** (hoy no lo tiene), corre `npm install` desde la raíz antes de la primera
  tarea. No se agrega ninguna dependencia nueva en este plan (ni en backend, ni en portal, ni en la tablet: **no hace
  falta un APK nuevo**).
- **`CONTRATO_ACTUAL` sigue en 1.** La colección `cargas` de `RespuestaPull`, `VendedorPull.control_inventario` y el
  endpoint de respuesta son **aditivos**. Una app vieja no ve cargas ni bloquea.
- **Los tipos del contrato están duplicados**: `apps/backend/src/modules/sincronizacion/contrato.ts` (normativo) y
  `apps/tablet/src/sincronizacion/contrato.ts` (en la tablet lo nuevo es **opcional**, por la regla §3). Si una tarea
  toca uno, toca el otro **y** `docs/contrato-sincronizacion.md` **en el mismo commit** (Tarea 3).
- Base de datos: **nunca `db reset`**. Migraciones locales solo con `npm run supabase -- migration up --local` (con el
  `--`). Supabase local es **compartido entre sesiones**. **Nunca apuntes nada a la nube** (`sinmex dev`): `.env.test`
  va a `127.0.0.1:54322`; no se corre `db push` ni nada con `--db-url`. La migración del servidor es
  `supabase/migrations/20261022120000_carga_vendedor.sql` (timestamp verificado libre al escribir el plan: la última
  es `20261021120000_venta_firma.sql`; antes de crearla, vuelve a mirar `ls supabase/migrations`).
- **El permiso `carga.gestionar` YA EXISTE** (semilla `20260803163500_semillas.sql`, grupo `Produccion/Almacen`): no
  se crea permiso ni grupo y el conteo del pgTAP de permisos no cambia. Sin RLS: el alcance lo pone el backend.
- `carga` lleva el trigger `before update … execute function set_updated_at()` (`trg_carga_updated`), como las demás
  tablas con `updated_at`. `carga_detalle` no tiene `updated_at`: editar las líneas sube `carga.version`, y eso mueve
  `carga.updated_at` (lo que lee el pull).
- pgTAP: `npm run supabase -- test db --local` (CI no lo corre: lo corre el implementador).
- Backend: lint **solo por archivo**: `npm exec --workspace=apps/backend -- prettier --write <archivos>` y
  `npm exec --workspace=apps/backend -- eslint <archivos>`. **Nunca** `npm run lint --workspace=apps/backend` (lleva
  `--fix` y reescribe archivos ajenos). Typecheck del backend = `npm run build --workspace=apps/backend`. Pruebas:
  `npm test --workspace=apps/backend -- <patrón>` y `npm run test:e2e --workspace=apps/backend -- <patrón>`.
- Los e2e **siembran lo que usan** con sufijo `${Date.now()}-${process.pid}` y lo borran en `afterAll` en orden
  inverso a las llaves foráneas (`carga_detalle` → `carga` → `presentacion` → `producto` → `sesion_vendedor` →
  `vendedor` → `sesion_refresh` → `usuario` → `sucursal` de prueba). El `POST /cargas` crea la carga **de hoy en
  Tijuana** (D8): los vendedores son nuevos en cada corrida, así que su numeración también.
- Portal: `npm test --workspace=apps/portal -- <patrón>`, `npx tsc --noEmit -p apps/portal`,
  `npm run lint --workspace=apps/portal`. Tiene que caber en una ventana de **1366 px** (≈1012 px de caja): la rejilla
  se desplaza de lado **dentro de su caja**, con la columna de presentación fija; se mide en el navegador.
- Tablet: `npm run typecheck --workspace=apps/tablet`, `npm run lint --workspace=apps/tablet`,
  `npm test --workspace=apps/tablet -- <patrón>`. Las pruebas son **solo** `src/**/*.spec.ts` en Node: nada de
  pantallas ni de `react-native`/`expo-*` en un `.spec.ts`. **La lógica de la tablet vive en funciones puras con
  pruebas de Jest**; la pantalla solo la llama. Responder una carga lleva **guardia contra el doble toque**
  (`crearRespondedorCarga`, guardado en un `useRef`).
- `src/datos/` **no importa de** `src/estado/` (regla de la capa, ver `reglas-firma.ts`): lo que el repositorio de
  ventas necesita vive en `src/datos/inventario-reglas.ts`; `src/estado/inventario.ts` lo reexporta.
- Migraciones locales de la tablet: **nunca se edita una publicada** (001…016); la nueva es la **017**. (La prueba de
  la 016 que dice "es la última" se actualiza, como hizo la 015 con la 016.)
- **Lección de T-73: nunca re-renderizar la pantalla a media firma o a medio gesto.** No se agrega estado que cambie
  mientras el cliente firma (nada de alternar props de la `Pantalla` ni de recalcular la existencia en la revisión): los
  faltantes de la revisión se calculan al tocar "Revisar" y se congelan; la red definitiva es el repositorio al grabar.
- **La aceptación en la pantalla real es obligatoria**: las Tareas 5, 6 y 7 terminan con la prueba del controlador en
  el emulador (y la 4 en el navegador a 1366 px). Una tarea de pantalla no está terminada hasta que el controlador la
  vio funcionar.
- Código en español, **identificadores sin acentos**, **textos al usuario en español con acentos** ("Tienes una carga
  por aceptar", "Conéctate al WiFi para aceptar la carga.", "Control de inventario en la app"). Comentarios que explican
  *por qué*; sigue el estilo del archivo que tocas.
- **Nunca `git add -f`** de nada bajo `.superpowers/` (ni de ningún archivo ignorado). `git status` limpio al terminar
  cada tarea; un commit por tarea (o más si el implementador lo prefiere), con el trailer exacto en la última línea
  del mensaje: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Si `expo` ensucia `apps/tablet/package.json`, `apps/tablet/tsconfig.json` o `app.json` con cambios que no son de la
  tarea, se revierte con `git checkout -- <archivo>` antes del commit.

## Review Focus

Los cinco puntos del spec; cada uno se pinó en la tarea dueña:

1. **Recarga aceptada a mitad de la captura de una venta: la existencia que valida al grabar es la del momento de
   grabar.** Tarea 5, `ventas.spec.ts` → "Review Focus 1: valida con la existencia del momento de grabar": con 20
   aceptadas la captura de 24 + 2 no alcanza; se aplica una recarga aceptada de 10 (como la escribiría el pull o la
   respuesta) y el **mismo** `registrar` entra; y al revés, una venta grabada en medio deja a la siguiente sin piezas.
   El cálculo corre dentro de `enTransaccion` de `registrar`, antes de `folios.emitir`.
2. **El portal edita una carga mientras el vendedor la ve: "Aceptar" con la versión vieja → 409 → la tablet muestra la
   nueva; nunca acepta lo que no vio.** Tarea 3, `cargas-app.e2e-spec.ts` → "Review Focus 2: aceptar con la versión
   vieja es 409 con la carga actual" (y con la nueva, 200); Tarea 6, `api-carga.spec.ts` (409 → `cambio` con la carga
   del cuerpo) e `inventario.spec.ts` → "Review Focus 2: un 409 aplica la carga nueva, sincroniza y suelta el candado".
   La pantalla (Tarea 7) manda la `version` de la carga **que pintó**.
3. **Doble toque en Aceptar con red lenta: una sola respuesta; el segundo envío es idempotente.** Tarea 6,
   `inventario.spec.ts` → "Review Focus 3: dos toques seguidos llaman una sola vez al servidor"; Tarea 3,
   `cargas-app.e2e-spec.ts` → "Review Focus 3: repetir la misma respuesta es 200 y no la reescribe" (mismo
   `respondida_en`).
4. **Carga eliminada en el portal después de bajar a la tablet: baja con `activo: 0`, desaparece del inventario y del
   aviso; responderla da 404 y la tablet se resincroniza.** Tarea 3, `cargas-app.e2e-spec.ts` → "Review Focus 4: una
   carga eliminada baja con activo 0 y responderla es 404"; Tarea 5, `cargas.spec.ts` → "Review Focus 4: una carga
   dada de baja sale del inventario y del aviso"; Tarea 6, `inventario.spec.ts` → "Review Focus 4: un 404 sincroniza y
   avisa que se eliminó".
5. **Sucursal con el control apagado y cargas capturadas: la app vende como hoy, sin bloqueo ni faltantes, aunque haya
   una carga pendiente (solo el aviso).** Tarea 5, `inventario-reglas.spec.ts` → "Review Focus 5: con el control
   apagado no hay bloqueo ni faltantes" y `ventas.spec.ts` → "Review Focus 5: con el control apagado vende aunque haya
   una carga pendiente"; Tarea 7, la pantalla principal muestra el aviso con o sin control.

---

### Tarea 1: Migración del servidor: `sucursal.control_inventario`, `carga` y `carga_detalle` (servidor del spec)

**Files:**
- Create: `supabase/migrations/20261022120000_carga_vendedor.sql`
- Test: `supabase/tests/99_carga_test.sql`
- Modify: `apps/backend/src/database/schema.d.ts` (regenerado con `db:types`)

**Interfaces:**
- Consumes: `sucursal`, `vendedor`, `usuario`, `presentacion` y la función `set_updated_at()` (todas existentes).
- Produces (tablas que leen las Tareas 2 y 3):
  - `sucursal.control_inventario boolean not null default false`.
  - `carga (id, sucursal_id, vendedor_id, fecha date, numero smallint ≥ 1, estado text default 'pendiente'
    in (pendiente|aceptada|rechazada), motivo_rechazo text 1..300, version integer default 1 ≥ 1,
    capturo_usuario_id, respondida_en timestamptz, created_at, updated_at, deleted_at)` con
    `ck_carga_motivo` (`rechazada` ⇔ motivo), `ck_carga_respondida` (`pendiente` ⇔ sin `respondida_en`),
    `uq_carga_vendedor_fecha_numero` (parcial, vivas), `idx_carga_vendedor_updated` y `trg_carga_updated`.
  - `carga_detalle (id, carga_id, presentacion_id, piezas > 0)` con `uq_carga_detalle_presentacion (carga_id,
    presentacion_id)`.
  - En `schema.d.ts`: `Sucursal.control_inventario: Generated<boolean>`, `interface Carga`, `interface CargaDetalle` y
    `DB.carga`, `DB.carga_detalle`.

- [ ] **Paso 1: la prueba pgTAP, que falla**

`supabase/tests/99_carga_test.sql`:

```sql
begin;
select plan(24);

-- T-27 pieza 1: lo que la BASE garantiza de la carga del vendedor aunque alguien
-- escriba por debajo del servicio. Prefijo `zz-pgtap-t27`. Todo se va con el rollback.

select has_table('carga', 'existe la tabla de cargas');
select has_table('carga_detalle', 'existe el detalle de las cargas');

select has_column('sucursal', 'control_inventario',
  'la sucursal dice si la app controla el inventario (D7)');
select col_not_null('sucursal', 'control_inventario', 'la casilla nunca es nula');
select col_default_is('sucursal', 'control_inventario', 'false',
  'apagada por defecto: la version nueva no deja sin vender a nadie');

select has_index('carga', 'uq_carga_vendedor_fecha_numero',
  'un numero vivo por vendedor y dia');
select has_index('carga', 'idx_carga_vendedor_updated',
  'el pull lee por vendedor y updated_at');
select has_trigger('carga', 'trg_carga_updated', 'la carga mueve updated_at al editarse');

select is(
  (select count(*)::int from permiso where clave = 'carga.gestionar' and grupo = 'Produccion/Almacen'),
  1, 'el permiso carga.gestionar ya existia y no se duplica');

-- Fixtures: un vendedor y un usuario de TJ, un producto con dos presentaciones.
insert into vendedor (login, nombre, password_hash, sucursal_id)
  values ('zz-pgtap-t27', 'Vendedor pgTAP T27', 'x', (select id from sucursal where codigo = 'TJ'));
insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-t27-portal', 'Usuario pgTAP T27', 'x', p.id, null from perfil p order by p.nombre limit 1;
insert into producto (nombre) values ('zz-pgtap-t27 Horchata');
insert into presentacion (producto_id, volumen)
  select id, '1 L' from producto where nombre = 'zz-pgtap-t27 Horchata';
insert into presentacion (producto_id, volumen)
  select id, '500 ml' from producto where nombre = 'zz-pgtap-t27 Horchata';

create temporary table _t27 on commit drop as
select
  (select id from vendedor where login = 'zz-pgtap-t27') as vendedor,
  (select id from sucursal where codigo = 'TJ') as sucursal,
  (select id from usuario where login = 'zz-pgtap-t27-portal') as usuario,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'zz-pgtap-t27 Horchata' and pr.volumen = '1 L') as litro,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'zz-pgtap-t27 Horchata' and pr.volumen = '500 ml') as medio;

select lives_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id)
    select sucursal, vendedor, date '2026-10-22', 1, usuario from _t27$$,
  'una carga entra sin decir estado ni version');

select results_eq(
  $$select estado, version, motivo_rechazo, respondida_en from carga
    where vendedor_id = (select vendedor from _t27) and numero = 1$$,
  $$values ('pendiente'::text, 1, null::text, null::timestamptz)$$,
  'nace pendiente, version 1, sin motivo ni respuesta');

select throws_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id)
    select sucursal, vendedor, date '2026-10-22', 0, usuario from _t27$$,
  '23514', null, 'el numero empieza en 1');

select throws_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id, estado, respondida_en)
    select sucursal, vendedor, date '2026-10-22', 9, usuario, 'rechazada', now() from _t27$$,
  '23514', null, 'una rechazada exige motivo (ck_carga_motivo)');

select throws_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id, motivo_rechazo)
    select sucursal, vendedor, date '2026-10-22', 9, usuario, 'Faltan cajas' from _t27$$,
  '23514', null, 'una pendiente no lleva motivo (ck_carga_motivo)');

select throws_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id, estado)
    select sucursal, vendedor, date '2026-10-22', 9, usuario, 'aceptada' from _t27$$,
  '23514', null, 'una aceptada lleva respondida_en (ck_carga_respondida)');

select throws_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id, respondida_en)
    select sucursal, vendedor, date '2026-10-22', 9, usuario, now() from _t27$$,
  '23514', null, 'una pendiente no tiene respondida_en (ck_carga_respondida)');

select throws_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id, estado, motivo_rechazo, respondida_en)
    select sucursal, vendedor, date '2026-10-22', 9, usuario, 'rechazada', repeat('x', 301), now() from _t27$$,
  '23514', null, 'el motivo no pasa de 300 caracteres');

select throws_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id, estado)
    select sucursal, vendedor, date '2026-10-22', 9, usuario, 'perdida' from _t27$$,
  '23514', null, 'el estado es uno de los tres');

select throws_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id)
    select sucursal, vendedor, date '2026-10-22', 1, usuario from _t27$$,
  '23505', null, 'dos cargas vivas no comparten numero el mismo dia');

update carga set deleted_at = now()
  where vendedor_id = (select vendedor from _t27) and numero = 1;

select lives_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id)
    select sucursal, vendedor, date '2026-10-22', 1, usuario from _t27$$,
  'una carga eliminada libera su numero');

create temporary table _t27c on commit drop as
select id from carga
  where vendedor_id = (select vendedor from _t27) and numero = 1 and deleted_at is null;

select lives_ok(
  $$insert into carga_detalle (carga_id, presentacion_id, piezas)
    select (select id from _t27c), litro, 24 from _t27$$,
  'una linea con piezas entra');

select throws_ok(
  $$insert into carga_detalle (carga_id, presentacion_id, piezas)
    select (select id from _t27c), medio, 0 from _t27$$,
  '23514', null, 'las piezas son mayores que cero');

select throws_ok(
  $$insert into carga_detalle (carga_id, presentacion_id, piezas)
    select (select id from _t27c), litro, 5 from _t27$$,
  '23505', null, 'una presentacion una sola vez por carga');

-- El trigger: con created_at/updated_at viejos a mano, un update mueve updated_at a now().
insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id, created_at, updated_at)
  select sucursal, vendedor, date '2026-10-22', 2, usuario,
         timestamptz '2020-01-01', timestamptz '2020-01-01' from _t27;
update carga set version = 2
  where vendedor_id = (select vendedor from _t27) and numero = 2;

select ok(
  (select updated_at > timestamptz '2020-01-01' from carga
    where vendedor_id = (select vendedor from _t27) and numero = 2),
  'editar la carga le toca updated_at (lo lee el pull)');

select * from finish();
rollback;
```

- [ ] **Paso 2: correr y ver fallar**

```bash
npm run supabase -- test db --local
```

Esperado: `99_carga_test.sql` falla en `has_table('carga', …)` (y las siguientes); las demás suites siguen verdes.

- [ ] **Paso 3: la migración**

`supabase/migrations/20261022120000_carga_vendedor.sql`:

```sql
-- T-27 pieza 1: carga y recarga del vendedor.
-- Spec: docs/superpowers/specs/2026-10-22-t-27-carga-y-recarga-design.md
--
-- Una columna con default y dos tablas nuevas y vacias: no hay filas que violen
-- nada, asi que el pre-flight contra la nube no tiene nada que contar.
--
-- * `sucursal.control_inventario` (D7): apagado por defecto. Prendido, la app
--   exige aceptar la carga para vender (D3) y no vende mas de lo que trae (D4).
--   Cambiarlo toca `vendedor.updated_at` de esa sucursal (lo hace el backend)
--   para que el pull incremental lo baje.
-- * `carga`: lo que produccion entrega al vendedor (la de la manana y cada
--   recarga), numerada por vendedor y dia. Una baja logica libera su numero
--   (indice unico parcial). La respuesta del vendedor (D2, D6) vive en `estado`,
--   `motivo_rechazo` y `respondida_en`, atadas por dos checks.
-- * `carga_detalle`: piezas por presentacion. Sin `updated_at`: editar las
--   lineas sube `carga.version`, y eso mueve `carga.updated_at` (el pull).
--
-- El permiso `carga.gestionar` ya existe (semillas, grupo Produccion/Almacen):
-- aqui no se inserta ningun permiso.

alter table sucursal add column control_inventario boolean not null default false;

create table carga (
  id                 uuid primary key default gen_random_uuid(),
  sucursal_id        uuid not null references sucursal(id),
  vendedor_id        uuid not null references vendedor(id),
  fecha              date not null,
  numero             smallint not null check (numero >= 1),
  estado             text not null default 'pendiente'
    check (estado in ('pendiente', 'aceptada', 'rechazada')),
  motivo_rechazo     text
    check (motivo_rechazo is null or char_length(motivo_rechazo) between 1 and 300),
  version            integer not null default 1 check (version >= 1),
  capturo_usuario_id uuid not null references usuario(id),
  respondida_en      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  constraint ck_carga_motivo check ((estado = 'rechazada') = (motivo_rechazo is not null)),
  constraint ck_carga_respondida check ((estado = 'pendiente') = (respondida_en is null))
);

-- La red del numero siguiente: el backend lo calcula con la fila del vendedor
-- bloqueada, y si aun asi dos capturas chocaran, esto lo impide.
create unique index uq_carga_vendedor_fecha_numero
  on carga (vendedor_id, fecha, numero) where deleted_at is null;
-- El pull incremental: las del vendedor del token por `updated_at`.
create index idx_carga_vendedor_updated on carga (vendedor_id, updated_at);

create trigger trg_carga_updated before update on carga
  for each row execute function set_updated_at();

create table carga_detalle (
  id              uuid primary key default gen_random_uuid(),
  carga_id        uuid not null references carga(id),
  presentacion_id uuid not null references presentacion(id),
  piezas          integer not null check (piezas > 0),
  constraint uq_carga_detalle_presentacion unique (carga_id, presentacion_id)
);
```

- [ ] **Paso 4: aplicarla al Postgres local y ver pasar**

```bash
ls supabase/migrations | tail -3
npm run supabase -- migration up --local
npm run supabase -- test db --local
```

Esperado: `migration up` aplica solo `20261022120000_carga_vendedor.sql`; pgTAP todo verde, `99_carga_test.sql` con
24/24.

- [ ] **Paso 5: tipos de la base**

```bash
npm run db:types --workspace=apps/backend
git diff --stat apps/backend/src/database/schema.d.ts
```

El diff debe contener **solo** esto (orden alfabético de kysely-codegen):

```ts
export interface Carga {
  capturo_usuario_id: string;
  created_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
  estado: Generated<string>;
  fecha: Timestamp;
  id: Generated<string>;
  motivo_rechazo: string | null;
  numero: number;
  respondida_en: Timestamp | null;
  sucursal_id: string;
  updated_at: Generated<Timestamp>;
  vendedor_id: string;
  version: Generated<number>;
}

export interface CargaDetalle {
  carga_id: string;
  id: Generated<string>;
  piezas: number;
  presentacion_id: string;
}
```

más `control_inventario: Generated<boolean>;` en `Sucursal` y `carga: Carga;` / `carga_detalle: CargaDetalle;` en
`DB`. Si aparece algo más (migraciones de otra rama aplicadas en el Supabase compartido), quédate solo con estas
líneas (`git checkout -p`) y anótalo en el reporte. Nunca `db reset`.

- [ ] **Paso 6: build y commit**

```bash
npm run build --workspace=apps/backend
git add supabase/migrations/20261022120000_carga_vendedor.sql supabase/tests/99_carga_test.sql apps/backend/src/database/schema.d.ts
git commit -m "T-27: migración de la carga del vendedor y la casilla de control de inventario

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 2: Backend del portal: módulo `produccion/` (`/cargas`) y la casilla de la sucursal (portal del spec, D1, D2, D5, D7, D8)

**Files:**
- Create: `apps/backend/src/modules/produccion/reglas-carga.ts`
- Test: `apps/backend/src/modules/produccion/reglas-carga.spec.ts`
- Create: `apps/backend/src/modules/produccion/dto/cargas.dto.ts`
- Create: `apps/backend/src/modules/produccion/cargas.repository.ts`
- Create: `apps/backend/src/modules/produccion/cargas.service.ts`
- Create: `apps/backend/src/modules/produccion/cargas.controller.ts`
- Modify: `apps/backend/src/modules/produccion/produccion.module.ts`
- Modify: `apps/backend/src/modules/sucursales/dto/editar-sucursal.dto.ts`, `sucursales.service.ts`,
  `sucursales.repository.ts`
- Test: `apps/backend/test/cargas.e2e-spec.ts` (nuevo), `apps/backend/test/sucursales.e2e-spec.ts` (una prueba más)

**Interfaces:**
- Consumes: tablas de la Tarea 1; `resolverAlcance` (`sucursales/alcance-sucursal.ts`), `buscarSucursalUsuario`
  (`sucursales/buscar-sucursal-usuario.ts`), `esViolacionUnicidad` (`database/errores-postgres.ts`),
  `@RequierePermiso`, `@UsuarioActual`.
- Produces:
  - `reglas-carga.ts`: `ESTADOS_CARGA`, `type EstadoCarga = 'pendiente' | 'aceptada' | 'rechazada'`,
    `MAX_PIEZAS_LINEA = 99_999`, `MAX_LINEAS_CARGA = 200`, `LARGO_MAX_MOTIVO_RECHAZO = 300`,
    `MOTIVO_CARGA_ACEPTADA`, `MOTIVO_CARGA_DE_OTRO_DIA`, `MOTIVO_CARGA_CAMBIO`;
    `interface LineaCarga { presentacionId: string; piezas: number }`;
    `interface FilaCarga { id; vendedorId; sucursalId; fecha: string; numero: number; estado: EstadoCarga;
    motivoRechazo: string | null; version: number; respondidaEn: Date | null; eliminada: boolean; lineas: LineaCarga[] }`;
    `interface PresentacionRejilla { id; productoNombre; volumen; activa: boolean }`;
    `interface SucursalRejilla { id; codigo; nombre }`;
    `interface CargaRejilla { id; numero; estado; motivoRechazo; version; respondidaEn: string | null; lineas }`;
    `interface VendedorRejilla { id; nombre; cargas: CargaRejilla[] }`;
    `interface Rejilla { fecha; sucursal: SucursalRejilla; presentaciones: PresentacionRejilla[]; vendedores: VendedorRejilla[] }`;
    `normalizarLineas(lineas: readonly LineaCarga[]): LineaCarga[]`;
    `validarLineas(lineas: readonly LineaCarga[], activas: ReadonlySet<string>): string | null`;
    `motivoNoEditable(carga: Pick<FilaCarga, 'estado' | 'fecha' | 'version'>, hoy: string, version: number): string | null`;
    `mililitros(volumen: string): number | null`; `ordenarPresentaciones(ps): PresentacionRejilla[]`;
    `aCargaRejilla(f: FilaCarga): CargaRejilla`; `armarRejilla(entrada): Rejilla`.
  - `CargasRepository` (exportado por el módulo para la Tarea 3): `enTransaccion`, `buscarSucursalUsuario`,
    `hoyEnTijuana(): Promise<string>`, `sucursalPorId`, `vendedorParaCarga`, `vendedoresDeRejilla`,
    `presentacionesDeRejilla`, `idsPresentacionesActivas`, `bloquearVendedor`, `siguienteNumero`, `insertarCarga`,
    `insertarLineas`, `bloquearCarga(id, trx): Promise<(FilaCarga & { sucursalCodigo: string }) | undefined>`,
    `reemplazarLineas`, `marcarEditada`, `darDeBaja`,
    `leerCargas(filtro: FiltroCargas, conexion?: Database): Promise<FilaCarga[]>` con
    `type FiltroCargas = { id: string } | { sucursalId: string; fecha: string }`.
  - `CargasService`: `rejilla(usuarioId, q): Promise<Rejilla>`, `crear(usuarioId, dto): Promise<CargaRejilla>`,
    `editar(usuarioId, id, dto): Promise<CargaRejilla>`, `eliminar(usuarioId, id, dto): Promise<{ id: string }>`.
  - HTTP (permiso `carga.gestionar`, respuestas en camelCase): `GET /cargas?fecha&sucursal` → `Rejilla`;
    `POST /cargas` `{ vendedorId, lineas }` → 201 `CargaRejilla`; `PATCH /cargas/:id` `{ version, lineas }` →
    `CargaRejilla`; `DELETE /cargas/:id` `{ version }` → `{ id }`. 409 = `{ message, carga: CargaRejilla }`.
  - `Sucursal` (API) gana `controlInventario: boolean`; `PATCH /sucursales/:id` acepta `controlInventario` y, si
    cambia, toca `vendedor.updated_at` de esa sucursal en la misma transacción.

- [ ] **Paso 1: la prueba de las reglas puras, que falla**

`apps/backend/src/modules/produccion/reglas-carga.spec.ts`:

```ts
import {
  aCargaRejilla,
  armarRejilla,
  mililitros,
  MOTIVO_CARGA_ACEPTADA,
  MOTIVO_CARGA_CAMBIO,
  MOTIVO_CARGA_DE_OTRO_DIA,
  motivoNoEditable,
  normalizarLineas,
  ordenarPresentaciones,
  validarLineas,
  type FilaCarga,
  type PresentacionRejilla,
} from './reglas-carga';

const A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const B = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const C = '3f2504e0-4f89-41d3-9a0c-0305e82c3303';

function fila(extra: Partial<FilaCarga> = {}): FilaCarga {
  return {
    id: 'c-1',
    vendedorId: 'v-1',
    sucursalId: 's-tj',
    fecha: '2026-10-22',
    numero: 1,
    estado: 'pendiente',
    motivoRechazo: null,
    version: 1,
    respondidaEn: null,
    eliminada: false,
    lineas: [{ presentacionId: A, piezas: 24 }],
    ...extra,
  };
}

describe('validarLineas (T-27, POST/PATCH)', () => {
  const activas = new Set([A, B]);

  it('lineas validas: null', () => {
    expect(
      validarLineas(
        [
          { presentacionId: A, piezas: 1 },
          { presentacionId: B, piezas: 99_999 },
        ],
        activas,
      ),
    ).toBeNull();
  });

  it('al menos una linea', () => {
    expect(validarLineas([], activas)).toBe('La carga necesita al menos un producto.');
  });

  it('piezas enteras de 1 a 99 999', () => {
    for (const piezas of [0, -1, 1.5, 100_000]) {
      expect(validarLineas([{ presentacionId: A, piezas }], activas)).toBe(
        'Las piezas son enteras, de 1 a 99 999.',
      );
    }
  });

  it('una presentacion no se repite (ni cambiando mayusculas)', () => {
    expect(
      validarLineas(
        normalizarLineas([
          { presentacionId: A, piezas: 1 },
          { presentacionId: A.toUpperCase(), piezas: 2 },
        ]),
        activas,
      ),
    ).toBe('Un producto viene dos veces en la carga.');
  });

  it('solo presentaciones activas', () => {
    expect(validarLineas([{ presentacionId: C, piezas: 3 }], activas)).toBe(
      'Uno de los productos no existe o está dado de baja.',
    );
  });
});

describe('motivoNoEditable (D5, D8)', () => {
  it('pendiente o rechazada de hoy con su version: se puede', () => {
    expect(motivoNoEditable(fila(), '2026-10-22', 1)).toBeNull();
    expect(
      motivoNoEditable(fila({ estado: 'rechazada' }), '2026-10-22', 1),
    ).toBeNull();
  });

  it('una aceptada nunca, aunque la version cuadre (D5)', () => {
    expect(motivoNoEditable(fila({ estado: 'aceptada' }), '2026-10-22', 1)).toBe(
      MOTIVO_CARGA_ACEPTADA,
    );
    expect(MOTIVO_CARGA_ACEPTADA).toContain('Una carga aceptada no se modifica');
  });

  it('una de otro dia no (D8: dias anteriores en solo lectura)', () => {
    expect(motivoNoEditable(fila(), '2026-10-23', 1)).toBe(
      MOTIVO_CARGA_DE_OTRO_DIA,
    );
  });

  it('con otra version: 409 de concurrencia', () => {
    expect(motivoNoEditable(fila({ version: 2 }), '2026-10-22', 1)).toBe(
      MOTIVO_CARGA_CAMBIO,
    );
  });
});

describe('orden de la rejilla (presentacion y luego sabor, criterio de T-10)', () => {
  it('mililitros entiende ml y L, con punto o coma', () => {
    expect(mililitros('500 ml')).toBe(500);
    expect(mililitros('1 L')).toBe(1000);
    expect(mililitros('1.5 L')).toBe(1500);
    expect(mililitros('1,5 l')).toBe(1500);
    expect(mililitros('20 Lts')).toBe(20000);
    expect(mililitros('Garrafa')).toBeNull();
  });

  it('por volumen de menor a mayor, luego por sabor; lo que no se entiende va al final', () => {
    const p = (id: string, productoNombre: string, volumen: string): PresentacionRejilla => ({
      id,
      productoNombre,
      volumen,
      activa: true,
    });
    const orden = ordenarPresentaciones([
      p('1', 'Jamaica', '1 L'),
      p('2', 'Horchata', '1 L'),
      p('3', 'Té de Jazmín', '500 ml'),
      p('4', 'Horchata', 'Garrafa'),
      p('5', 'Horchata', '500 ml'),
    ]);
    expect(orden.map((x) => x.id)).toEqual(['5', '3', '2', '1', '4']);
  });
});

describe('armarRejilla (GET /cargas)', () => {
  it('vendedores en orden alfabetico, cada uno con sus cargas vivas por numero', () => {
    const rejilla = armarRejilla({
      fecha: '2026-10-22',
      sucursal: { id: 's-tj', codigo: 'TJ', nombre: 'Tijuana' },
      presentaciones: [],
      vendedores: [
        { id: 'v-2', nombre: 'Zoila' },
        { id: 'v-1', nombre: 'Ángel' },
        { id: 'v-3', nombre: 'Berta' },
      ],
      cargas: [
        fila({ id: 'c-2', numero: 2 }),
        fila({ id: 'c-1', numero: 1 }),
        fila({ id: 'c-x', numero: 3, eliminada: true }),
        fila({ id: 'c-3', vendedorId: 'v-3', numero: 1 }),
      ],
    });
    expect(rejilla.vendedores.map((v) => v.nombre)).toEqual(['Ángel', 'Berta', 'Zoila']);
    expect(rejilla.vendedores[0].cargas.map((c) => c.id)).toEqual(['c-1', 'c-2']);
    expect(rejilla.vendedores[1].cargas.map((c) => c.id)).toEqual(['c-3']);
    expect(rejilla.vendedores[2].cargas).toEqual([]);
  });

  it('aCargaRejilla: camelCase y respondidaEn en ISO', () => {
    expect(
      aCargaRejilla(
        fila({
          estado: 'rechazada',
          motivoRechazo: 'Faltan 2 cajas',
          respondidaEn: new Date('2026-10-22T15:00:00.000Z'),
        }),
      ),
    ).toEqual({
      id: 'c-1',
      numero: 1,
      estado: 'rechazada',
      motivoRechazo: 'Faltan 2 cajas',
      version: 1,
      respondidaEn: '2026-10-22T15:00:00.000Z',
      lineas: [{ presentacionId: A, piezas: 24 }],
    });
  });
});
```

- [ ] **Paso 2: correr y ver fallar**

`npm test --workspace=apps/backend -- reglas-carga` → falla al resolver `./reglas-carga`.

- [ ] **Paso 3: las reglas puras**

`apps/backend/src/modules/produccion/reglas-carga.ts`:

```ts
/**
 * Reglas de la carga del vendedor (T-27 pieza 1), sin base ni Nest: las lineas
 * de un POST/PATCH, cuando una carga se puede editar, el armado de la rejilla del
 * portal y (Tarea 3) la respuesta del vendedor y la forma del pull.
 */

export const ESTADOS_CARGA = ['pendiente', 'aceptada', 'rechazada'] as const;
export type EstadoCarga = (typeof ESTADOS_CARGA)[number];

/** Piezas por linea: enteras de 1 a 99 999 (spec, POST /cargas). */
export const MAX_PIEZAS_LINEA = 99_999;
/** Tope de lineas: una carga tiene decenas; esto es para que un cuerpo absurdo sea 400. */
export const MAX_LINEAS_CARGA = 200;
/** El mismo 300 del check `carga.motivo_rechazo`. */
export const LARGO_MAX_MOTIVO_RECHAZO = 300;

export const MOTIVO_CARGA_ACEPTADA =
  'Una carga aceptada no se modifica: el vendedor ya la aceptó. Recarga la página.';
export const MOTIVO_CARGA_DE_OTRO_DIA = 'Solo se modifican las cargas de hoy.';
export const MOTIVO_CARGA_CAMBIO =
  'La carga cambió mientras la editabas; recarga la página.';

export interface LineaCarga {
  presentacionId: string;
  piezas: number;
}

/** Una carga leida de la base, ya con sus lineas. */
export interface FilaCarga {
  id: string;
  vendedorId: string;
  sucursalId: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
  numero: number;
  estado: EstadoCarga;
  motivoRechazo: string | null;
  version: number;
  respondidaEn: Date | null;
  eliminada: boolean;
  lineas: LineaCarga[];
}

export interface PresentacionRejilla {
  id: string;
  productoNombre: string;
  volumen: string;
  /**
   * `false` = dada de baja (o su producto). Solo sale en la rejilla si una carga
   * del dia la trae; el portal no la ofrece al capturar.
   */
  activa: boolean;
}

export interface SucursalRejilla {
  id: string;
  codigo: string;
  nombre: string;
}

export interface CargaRejilla {
  id: string;
  numero: number;
  estado: EstadoCarga;
  motivoRechazo: string | null;
  version: number;
  respondidaEn: string | null;
  lineas: LineaCarga[];
}

export interface VendedorRejilla {
  id: string;
  nombre: string;
  cargas: CargaRejilla[];
}

/** `GET /cargas`: la rejilla de Produccion › Recarga. */
export interface Rejilla {
  fecha: string;
  sucursal: SucursalRejilla;
  presentaciones: PresentacionRejilla[];
  vendedores: VendedorRejilla[];
}

/** Ids en minusculas: Postgres compara `uuid` sin importar, pero el `Set` de la validacion si. */
export function normalizarLineas(lineas: readonly LineaCarga[]): LineaCarga[] {
  return lineas.map((l) => ({
    presentacionId: l.presentacionId.toLowerCase(),
    piezas: l.piezas,
  }));
}

/**
 * El 400 de unas lineas que no valen, o `null`. El DTO ya comprobo la forma
 * (uuid, entero); esto repite los topes y decide lo que necesita la base:
 * repetidas y activas. `lineas` ya normalizadas.
 */
export function validarLineas(
  lineas: readonly LineaCarga[],
  activas: ReadonlySet<string>,
): string | null {
  if (lineas.length === 0) return 'La carga necesita al menos un producto.';
  if (lineas.length > MAX_LINEAS_CARGA) {
    return `Una carga lleva hasta ${MAX_LINEAS_CARGA} productos.`;
  }
  const vistas = new Set<string>();
  for (const l of lineas) {
    if (!Number.isInteger(l.piezas) || l.piezas < 1 || l.piezas > MAX_PIEZAS_LINEA) {
      return 'Las piezas son enteras, de 1 a 99 999.';
    }
    if (vistas.has(l.presentacionId)) return 'Un producto viene dos veces en la carga.';
    vistas.add(l.presentacionId);
    if (!activas.has(l.presentacionId)) {
      return 'Uno de los productos no existe o está dado de baja.';
    }
  }
  return null;
}

/**
 * Por que una carga no se puede editar ni eliminar (409), o `null`.
 *
 * - Aceptada: nunca (D5). El inventario de la tablet no cambia por debajo; un
 *   error se corrige con otra recarga o en el corte (pieza 3).
 * - De otro dia: los dias anteriores son de solo lectura (D8).
 * - Con otra version: alguien la edito mientras tanto.
 */
export function motivoNoEditable(
  carga: Pick<FilaCarga, 'estado' | 'fecha' | 'version'>,
  hoy: string,
  version: number,
): string | null {
  if (carga.estado === 'aceptada') return MOTIVO_CARGA_ACEPTADA;
  if (carga.fecha !== hoy) return MOTIVO_CARGA_DE_OTRO_DIA;
  if (carga.version !== version) return MOTIVO_CARGA_CAMBIO;
  return null;
}

/**
 * `"500 ml"` → 500, `"1.5 L"` → 1500; `null` si el texto no es un volumen. El
 * catalogo guarda el volumen como texto libre (T-10), asi que ordenar por texto
 * pondria "1 L" antes que "500 ml".
 */
export function mililitros(volumen: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(ml|l|lt|lts|litro|litros)\s*$/i.exec(volumen);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return m[2].toLowerCase() === 'ml' ? n : n * 1000;
}

/**
 * Presentacion (volumen, de menor a mayor) y luego sabor (producto): el
 * criterio que T-10 dejo para "la pantalla de Recarga". Un volumen que no se
 * entiende va al final, por texto.
 */
export function ordenarPresentaciones(
  presentaciones: readonly PresentacionRejilla[],
): PresentacionRejilla[] {
  return [...presentaciones].sort((a, b) => {
    const ma = mililitros(a.volumen);
    const mb = mililitros(b.volumen);
    if (ma !== null && mb === null) return -1;
    if (ma === null && mb !== null) return 1;
    if (ma !== null && mb !== null && ma !== mb) return ma - mb;
    if (ma === null && mb === null) {
      const porTexto = a.volumen.localeCompare(b.volumen, 'es');
      if (porTexto !== 0) return porTexto;
    }
    return (
      a.productoNombre.localeCompare(b.productoNombre, 'es') || a.id.localeCompare(b.id)
    );
  });
}

export function aCargaRejilla(f: FilaCarga): CargaRejilla {
  return {
    id: f.id,
    numero: f.numero,
    estado: f.estado,
    motivoRechazo: f.motivoRechazo,
    version: f.version,
    respondidaEn: f.respondidaEn === null ? null : f.respondidaEn.toISOString(),
    lineas: f.lineas,
  };
}

/**
 * La rejilla: presentaciones en su orden, vendedores en orden alfabetico y, en
 * cada uno, sus cargas vivas por numero. Una carga de un vendedor que no viene
 * en la lista no se pinta (el repositorio ya trae a los que tienen cargas ese
 * dia aunque esten desactivados).
 */
export function armarRejilla(entrada: {
  fecha: string;
  sucursal: SucursalRejilla;
  presentaciones: readonly PresentacionRejilla[];
  vendedores: readonly { id: string; nombre: string }[];
  cargas: readonly FilaCarga[];
}): Rejilla {
  const porVendedor = new Map<string, FilaCarga[]>();
  for (const c of entrada.cargas) {
    if (c.eliminada) continue;
    const lista = porVendedor.get(c.vendedorId) ?? [];
    lista.push(c);
    porVendedor.set(c.vendedorId, lista);
  }
  return {
    fecha: entrada.fecha,
    sucursal: entrada.sucursal,
    presentaciones: ordenarPresentaciones(entrada.presentaciones),
    vendedores: [...entrada.vendedores]
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.id.localeCompare(b.id))
      .map((v) => ({
        id: v.id,
        nombre: v.nombre,
        cargas: (porVendedor.get(v.id) ?? [])
          .sort((a, b) => a.numero - b.numero)
          .map(aCargaRejilla),
      })),
  };
}
```

- [ ] **Paso 4: correr y ver pasar**

`npm test --workspace=apps/backend -- reglas-carga` → verde.

- [ ] **Paso 5: los DTOs**

`apps/backend/src/modules/produccion/dto/cargas.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_LINEAS_CARGA, MAX_PIEZAS_LINEA } from '../reglas-carga';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PIEZAS = 'Las piezas son enteras, de 1 a 99 999.';
const VERSION = 'Falta la versión de la carga.';

/** `GET /cargas` (T-27). Que la fecha exista lo comprueba el servicio. */
export class ConsultaCargasDto {
  @Matches(RE_FECHA, { message: 'La fecha debe tener el formato AAAA-MM-DD.' })
  fecha!: string;

  /**
   * Id de la sucursal. Obligatoria para un usuario General; uno atado ve la suya
   * (pedir otra es 404, no 403: no se confirma que exista).
   */
  @IsOptional()
  @IsUUID(undefined, { message: 'La sucursal no es válida.' })
  sucursal?: string;
}

export class LineaCargaDto {
  @IsUUID(undefined, { message: 'Uno de los productos no es válido.' })
  presentacionId!: string;

  @IsInt({ message: PIEZAS })
  @Min(1, { message: PIEZAS })
  @Max(MAX_PIEZAS_LINEA, { message: PIEZAS })
  piezas!: number;
}

class LineasCargaDto {
  @IsArray({ message: 'Las líneas de la carga deben ser una lista.' })
  @ArrayMinSize(1, { message: 'La carga necesita al menos un producto.' })
  @ArrayMaxSize(MAX_LINEAS_CARGA, {
    message: `Una carga lleva hasta ${MAX_LINEAS_CARGA} productos.`,
  })
  @ValidateNested({ each: true })
  @Type(() => LineaCargaDto)
  lineas!: LineaCargaDto[];
}

/** `POST /cargas`: la carga de HOY en Tijuana (D8); el numero lo pone el servidor. */
export class CrearCargaDto extends LineasCargaDto {
  @IsUUID(undefined, { message: 'Elige el vendedor.' })
  vendedorId!: string;
}

/** `PATCH /cargas/:id`: reemplaza las lineas y la regresa a pendiente (D5). */
export class EditarCargaDto extends LineasCargaDto {
  @IsInt({ message: VERSION })
  @Min(1, { message: VERSION })
  version!: number;
}

/** `DELETE /cargas/:id`. */
export class VersionCargaDto {
  @IsInt({ message: VERSION })
  @Min(1, { message: VERSION })
  version!: number;
}

/**
 * `POST /sync/cargas/:id/respuesta` (Tarea 3). `motivo` se declara aunque
 * `aceptar` no lo lleve: con `whitelist` un campo no declarado se borraria sin
 * aviso, y "aceptar con motivo" debe ser 400 (spec).
 */
export class RespuestaCargaDto {
  @IsInt({ message: VERSION })
  @Min(1, { message: VERSION })
  version!: number;

  @IsIn(['aceptar', 'rechazar'], { message: 'La acción debe ser aceptar o rechazar.' })
  accion!: 'aceptar' | 'rechazar';

  @IsOptional()
  @IsString({ message: 'El motivo debe ser texto.' })
  motivo?: string;
}
```

- [ ] **Paso 6: el repositorio**

`apps/backend/src/modules/produccion/cargas.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type {
  EstadoCarga,
  FilaCarga,
  LineaCarga,
  PresentacionRejilla,
  SucursalRejilla,
} from './reglas-carga';

/** Que cargas leer. La Tarea 3 agrega el filtro del pull. */
export type FiltroCargas = { id: string } | { sucursalId: string; fecha: string };

export interface VendedorParaCarga {
  id: string;
  nombre: string;
  activo: boolean;
  sucursalId: string;
  sucursalCodigo: string;
}

export interface NuevaCarga {
  sucursalId: string;
  vendedorId: string;
  /** `AAAA-MM-DD`: hoy en Tijuana (D8). */
  fecha: string;
  numero: number;
  capturoUsuarioId: string;
}

/**
 * SQL de la carga del vendedor (T-27). Los metodos que escriben reciben la `trx`
 * del servicio; ninguno abre la suya.
 */
@Injectable()
export class CargasRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  enTransaccion<T>(tarea: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(tarea);
  }

  buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuario(this.db, usuarioId);
  }

  /** Hoy en Tijuana, del reloj de Postgres (nunca UTC): la fecha de una carga nueva (D8). */
  async hoyEnTijuana(): Promise<string> {
    const r = await sql<{ hoy: string }>`
      select to_char((now() at time zone 'America/Tijuana')::date, 'YYYY-MM-DD') as hoy
    `.execute(this.db);
    return r.rows[0].hoy;
  }

  async sucursalPorId(id: string): Promise<SucursalRejilla | undefined> {
    return this.db
      .selectFrom('sucursal')
      .select(['id', 'codigo', 'nombre'])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /** El vendedor (vivo, activo o no) con su sucursal, para el alcance del POST. */
  async vendedorParaCarga(id: string): Promise<VendedorParaCarga | undefined> {
    return this.db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select([
        'vendedor.id as id',
        'vendedor.nombre as nombre',
        'vendedor.activo as activo',
        'vendedor.sucursal_id as sucursalId',
        'sucursal.codigo as sucursalCodigo',
      ])
      .where('vendedor.id', '=', id)
      .where('vendedor.deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /**
   * Las columnas de la rejilla: los vendedores activos de la sucursal y, ademas,
   * los que tienen una carga viva ese dia aunque ya esten desactivados (su
   * carga existe y alguien tiene que poder verla).
   */
  async vendedoresDeRejilla(
    sucursalId: string,
    fecha: string,
  ): Promise<{ id: string; nombre: string }[]> {
    return this.db
      .selectFrom('vendedor')
      .select(['id', 'nombre'])
      .where('sucursal_id', '=', sucursalId)
      .where('deleted_at', 'is', null)
      .where((eb) =>
        eb.or([
          eb('activo', '=', true),
          eb(
            'id',
            'in',
            eb
              .selectFrom('carga')
              .select('carga.vendedor_id')
              .where('carga.deleted_at', 'is', null)
              .where(sql<boolean>`carga.fecha = ${fecha}::date`),
          ),
        ]),
      )
      .execute();
  }

  /**
   * Las filas de la rejilla: presentaciones activas (viva, de un producto vivo y
   * activo) y las que las cargas del dia traen aunque ya no lo esten.
   */
  async presentacionesDeRejilla(
    referenciadas: readonly string[],
  ): Promise<PresentacionRejilla[]> {
    const activa = sql<boolean>`(pr.deleted_at is null and p.deleted_at is null and p.activo)`;
    let q = this.db
      .selectFrom('presentacion as pr')
      .innerJoin('producto as p', 'p.id', 'pr.producto_id')
      .select([
        'pr.id as id',
        'p.nombre as productoNombre',
        'pr.volumen as volumen',
        activa.as('activa'),
      ]);
    q =
      referenciadas.length > 0
        ? q.where((eb) => eb.or([activa, eb('pr.id', 'in', [...referenciadas])]))
        : q.where(activa);
    return q.execute();
  }

  /** De esos ids, los de presentaciones activas (la validacion del POST/PATCH). */
  async idsPresentacionesActivas(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const filas = await this.db
      .selectFrom('presentacion as pr')
      .innerJoin('producto as p', 'p.id', 'pr.producto_id')
      .select('pr.id as id')
      .where('pr.id', 'in', [...ids])
      .where('pr.deleted_at', 'is', null)
      .where('p.deleted_at', 'is', null)
      .where('p.activo', '=', true)
      .execute();
    return new Set(filas.map((f) => f.id));
  }

  /**
   * Bloquea la fila del vendedor hasta el fin de la transaccion: dos capturas
   * simultaneas para el mismo vendedor calculan el numero una despues de la
   * otra. `for update` sobre las cargas no sirve: Postgres no lo permite con
   * `max()` y no bloquearia nada en la primera carga del dia. `for no key update`
   * como en la ruta diaria (T-37): no frena los inserts que solo referencian al
   * vendedor. El indice unico parcial es la red.
   */
  async bloquearVendedor(vendedorId: string, trx: Transaction<DB>): Promise<void> {
    await trx
      .selectFrom('vendedor')
      .select('id')
      .where('id', '=', vendedorId)
      .forNoKeyUpdate()
      .execute();
  }

  /** `max(numero vivo) + 1`: una baja logica libera su numero. */
  async siguienteNumero(
    vendedorId: string,
    fecha: string,
    trx: Transaction<DB>,
  ): Promise<number> {
    const fila = await trx
      .selectFrom('carga')
      .select(sql<number>`coalesce(max(numero), 0) + 1`.as('siguiente'))
      .where('vendedor_id', '=', vendedorId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(fila.siguiente);
  }

  async insertarCarga(nueva: NuevaCarga, trx: Transaction<DB>): Promise<string> {
    const { id } = await trx
      .insertInto('carga')
      .values({
        sucursal_id: nueva.sucursalId,
        vendedor_id: nueva.vendedorId,
        fecha: nueva.fecha,
        numero: nueva.numero,
        capturo_usuario_id: nueva.capturoUsuarioId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  }

  async insertarLineas(
    cargaId: string,
    lineas: readonly LineaCarga[],
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .insertInto('carga_detalle')
      .values(
        lineas.map((l) => ({
          carga_id: cargaId,
          presentacion_id: l.presentacionId,
          piezas: l.piezas,
        })),
      )
      .execute();
  }

  /**
   * Bloquea la carga viva (`for update`) y la devuelve con sus lineas y el codigo
   * de su sucursal; `undefined` si no existe o esta dada de baja. El candado va
   * sobre `carga` sola: con un join, `for update` bloquearia tambien la sucursal.
   */
  async bloquearCarga(
    id: string,
    trx: Transaction<DB>,
  ): Promise<(FilaCarga & { sucursalCodigo: string }) | undefined> {
    const viva = await trx
      .selectFrom('carga')
      .select('id')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!viva) return undefined;
    const [carga] = await this.leerCargas({ id }, trx);
    const { codigo } = await trx
      .selectFrom('sucursal')
      .select('codigo')
      .where('id', '=', carga.sucursalId)
      .executeTakeFirstOrThrow();
    return { ...carga, sucursalCodigo: codigo };
  }

  async reemplazarLineas(
    cargaId: string,
    lineas: readonly LineaCarga[],
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx.deleteFrom('carga_detalle').where('carga_id', '=', cargaId).execute();
    await this.insertarLineas(cargaId, lineas, trx);
  }

  /**
   * Editar la regresa a pendiente (D5): sube la version, limpia motivo y
   * respuesta (los dos checks piden las tres cosas juntas) y, por el trigger,
   * mueve `updated_at`, asi que la tablet la vuelve a bajar.
   */
  async marcarEditada(cargaId: string, trx: Transaction<DB>): Promise<void> {
    await trx
      .updateTable('carga')
      .set({
        version: sql<number>`version + 1`,
        estado: 'pendiente',
        motivo_rechazo: null,
        respondida_en: null,
      })
      .where('id', '=', cargaId)
      .execute();
  }

  /** Baja logica: libera el numero y viaja a la tablet como `activo: 0`. */
  async darDeBaja(cargaId: string, trx: Transaction<DB>): Promise<void> {
    await trx
      .updateTable('carga')
      .set({ deleted_at: sql<Date>`now()` })
      .where('id', '=', cargaId)
      .execute();
  }

  /**
   * Las cargas del filtro con sus lineas. `fecha` sale como texto de Postgres:
   * el driver la convertiria a `Date` en la hora local del proceso.
   */
  async leerCargas(
    filtro: FiltroCargas,
    conexion: Database = this.db,
  ): Promise<FilaCarga[]> {
    let q = conexion
      .selectFrom('carga')
      .select([
        'id',
        'vendedor_id',
        'sucursal_id',
        sql<string>`to_char(fecha, 'YYYY-MM-DD')`.as('fecha'),
        'numero',
        'estado',
        'motivo_rechazo',
        'version',
        'respondida_en',
        'deleted_at',
      ]);
    if ('id' in filtro) {
      q = q.where('id', '=', filtro.id);
    } else {
      q = q
        .where('sucursal_id', '=', filtro.sucursalId)
        .where(sql<boolean>`fecha = ${filtro.fecha}::date`)
        .where('deleted_at', 'is', null);
    }
    const filas = await q.orderBy('fecha').orderBy('numero').execute();
    if (filas.length === 0) return [];

    const lineas = await conexion
      .selectFrom('carga_detalle')
      .select(['carga_id', 'presentacion_id', 'piezas'])
      .where(
        'carga_id',
        'in',
        filas.map((f) => f.id),
      )
      .execute();
    const porCarga = new Map<string, LineaCarga[]>();
    for (const l of lineas) {
      const lista = porCarga.get(l.carga_id) ?? [];
      lista.push({ presentacionId: l.presentacion_id, piezas: l.piezas });
      porCarga.set(l.carga_id, lista);
    }

    return filas.map((f) => ({
      id: f.id,
      vendedorId: f.vendedor_id,
      sucursalId: f.sucursal_id,
      fecha: f.fecha,
      numero: f.numero,
      // El check `estado in (...)` de la base garantiza uno de los tres.
      estado: f.estado as EstadoCarga,
      motivoRechazo: f.motivo_rechazo,
      version: f.version,
      respondidaEn: f.respondida_en,
      eliminada: f.deleted_at !== null,
      lineas: porCarga.get(f.id) ?? [],
    }));
  }
}
```

- [ ] **Paso 7: el servicio**

`apps/backend/src/modules/produccion/cargas.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { esViolacionUnicidad } from '../../database/errores-postgres';
import { resolverAlcance } from '../sucursales/alcance-sucursal';
import type {
  ConsultaCargasDto,
  CrearCargaDto,
  EditarCargaDto,
  VersionCargaDto,
} from './dto/cargas.dto';
import {
  CargasRepository,
  type VendedorParaCarga,
} from './cargas.repository';
import {
  aCargaRejilla,
  armarRejilla,
  motivoNoEditable,
  normalizarLineas,
  validarLineas,
  type CargaRejilla,
  type FilaCarga,
  type LineaCarga,
  type Rejilla,
  type SucursalRejilla,
} from './reglas-carga';

export const MOTIVO_FECHA_INEXISTENTE = 'Esa fecha no existe.';
export const MOTIVO_ELIGE_SUCURSAL = 'Elige la sucursal.';
export const MOTIVO_SUCURSAL_INEXISTENTE = 'No existe esa sucursal.';
export const MOTIVO_VENDEDOR_INEXISTENTE = 'No existe ese vendedor.';
export const MOTIVO_VENDEDOR_INACTIVO =
  'Ese vendedor está desactivado: no se le captura carga.';
export const MOTIVO_CARGA_INEXISTENTE = 'No existe esa carga.';
export const MOTIVO_NUMERO_OCUPADO =
  'Otra captura tomó el mismo número de carga al mismo tiempo; vuelve a guardar.';

/** `AAAA-MM-DD` que existe en el calendario (el DTO ya comprobo el formato). */
function exigirFechaReal(fecha: string): void {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    f.getUTCFullYear() !== anio ||
    f.getUTCMonth() !== mes - 1 ||
    f.getUTCDate() !== dia
  ) {
    throw new BadRequestException(MOTIVO_FECHA_INEXISTENTE);
  }
}

/**
 * La carga del vendedor en el servidor (T-27 pieza 1): la rejilla de Produccion
 * › Recarga (D1) y, en la Tarea 3, la respuesta del vendedor y el pull.
 *
 * El alcance es el de siempre (`resolverAlcance`), pero otra sucursal es **404**
 * y no 403: a un usuario atado no se le confirma que exista el vendedor, la
 * sucursal o la carga de otra (mismo criterio que la ruta diaria, T-37).
 */
@Injectable()
export class CargasService {
  constructor(private readonly repo: CargasRepository) {}

  /** `GET /cargas`. */
  async rejilla(usuarioId: string, q: ConsultaCargasDto): Promise<Rejilla> {
    exigirFechaReal(q.fecha);
    const sucursal = await this.sucursalEnAlcance(usuarioId, q.sucursal);
    const [vendedores, cargas] = await Promise.all([
      this.repo.vendedoresDeRejilla(sucursal.id, q.fecha),
      this.repo.leerCargas({ sucursalId: sucursal.id, fecha: q.fecha }),
    ]);
    const referenciadas = [
      ...new Set(cargas.flatMap((c) => c.lineas.map((l) => l.presentacionId))),
    ];
    const presentaciones = await this.repo.presentacionesDeRejilla(referenciadas);
    return armarRejilla({ fecha: q.fecha, sucursal, presentaciones, vendedores, cargas });
  }

  /**
   * `POST /cargas`: la carga de HOY en Tijuana (D8), pendiente, version 1, con
   * el numero siguiente. El numero se calcula con la fila del vendedor
   * bloqueada; si aun asi choca con el indice unico, 409 y se vuelve a guardar.
   */
  async crear(usuarioId: string, dto: CrearCargaDto): Promise<CargaRejilla> {
    const vendedor = await this.vendedorEnAlcance(usuarioId, dto.vendedorId);
    if (!vendedor.activo) throw new BadRequestException(MOTIVO_VENDEDOR_INACTIVO);
    const lineas = normalizarLineas(dto.lineas);
    await this.exigirLineasValidas(lineas);
    const hoy = await this.repo.hoyEnTijuana();

    let id: string;
    try {
      id = await this.repo.enTransaccion(async (trx) => {
        await this.repo.bloquearVendedor(vendedor.id, trx);
        const numero = await this.repo.siguienteNumero(vendedor.id, hoy, trx);
        const nueva = await this.repo.insertarCarga(
          {
            sucursalId: vendedor.sucursalId,
            vendedorId: vendedor.id,
            fecha: hoy,
            numero,
            capturoUsuarioId: usuarioId,
          },
          trx,
        );
        await this.repo.insertarLineas(nueva, lineas, trx);
        return nueva;
      });
    } catch (error) {
      if (esViolacionUnicidad(error)) throw new ConflictException(MOTIVO_NUMERO_OCUPADO);
      throw error;
    }
    return this.cargaRejilla(id);
  }

  /**
   * `PATCH /cargas/:id`: solo pendiente o rechazada, de hoy y con la version que
   * se edito; reemplaza las lineas y la regresa a pendiente (D5), asi que
   * vuelve a llegar al vendedor.
   */
  async editar(
    usuarioId: string,
    id: string,
    dto: EditarCargaDto,
  ): Promise<CargaRejilla> {
    const lineas = normalizarLineas(dto.lineas);
    await this.exigirLineasValidas(lineas);
    const hoy = await this.repo.hoyEnTijuana();
    await this.repo.enTransaccion(async (trx) => {
      const carga = await this.cargaEnAlcance(usuarioId, id, trx);
      this.exigirEditable(carga, hoy, dto.version);
      await this.repo.reemplazarLineas(carga.id, lineas, trx);
      await this.repo.marcarEditada(carga.id, trx);
    });
    return this.cargaRejilla(id);
  }

  /** `DELETE /cargas/:id`: baja logica con las mismas condiciones que editar. */
  async eliminar(
    usuarioId: string,
    id: string,
    dto: VersionCargaDto,
  ): Promise<{ id: string }> {
    const hoy = await this.repo.hoyEnTijuana();
    await this.repo.enTransaccion(async (trx) => {
      const carga = await this.cargaEnAlcance(usuarioId, id, trx);
      this.exigirEditable(carga, hoy, dto.version);
      await this.repo.darDeBaja(carga.id, trx);
    });
    return { id };
  }

  private exigirEditable(carga: FilaCarga, hoy: string, version: number): void {
    const motivo = motivoNoEditable(carga, hoy, version);
    if (motivo !== null) {
      // Con la carga actual: el portal puede decir que cambio sin otra peticion.
      throw new ConflictException({ message: motivo, carga: aCargaRejilla(carga) });
    }
  }

  private async exigirLineasValidas(lineas: readonly LineaCarga[]): Promise<void> {
    const activas = await this.repo.idsPresentacionesActivas(
      lineas.map((l) => l.presentacionId),
    );
    const error = validarLineas(lineas, activas);
    if (error !== null) throw new BadRequestException(error);
  }

  private async cargaRejilla(id: string): Promise<CargaRejilla> {
    const [carga] = await this.repo.leerCargas({ id });
    return aCargaRejilla(carga);
  }

  /** El codigo de la sucursal del usuario o `null` si es General; 401 si ya no existe. */
  private async alcanceDe(usuarioId: string) {
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    if (!usuario) throw new UnauthorizedException('Sesión inválida.');
    return { usuario, alcance: resolverAlcance(usuario.codigo, null) };
  }

  private async sucursalEnAlcance(
    usuarioId: string,
    pedida: string | undefined,
  ): Promise<SucursalRejilla> {
    const { usuario, alcance } = await this.alcanceDe(usuarioId);
    const id = pedida?.toLowerCase() ?? (alcance.tipo === 'una' ? usuario.id : null);
    if (id === null) throw new BadRequestException(MOTIVO_ELIGE_SUCURSAL);
    const sucursal = await this.repo.sucursalPorId(id);
    if (!sucursal || (alcance.tipo === 'una' && alcance.codigo !== sucursal.codigo)) {
      throw new NotFoundException(MOTIVO_SUCURSAL_INEXISTENTE);
    }
    return sucursal;
  }

  private async vendedorEnAlcance(
    usuarioId: string,
    vendedorId: string,
  ): Promise<VendedorParaCarga> {
    const { alcance } = await this.alcanceDe(usuarioId);
    const vendedor = await this.repo.vendedorParaCarga(vendedorId.toLowerCase());
    if (
      !vendedor ||
      (alcance.tipo === 'una' && alcance.codigo !== vendedor.sucursalCodigo)
    ) {
      throw new NotFoundException(MOTIVO_VENDEDOR_INEXISTENTE);
    }
    return vendedor;
  }

  /** La carga viva bloqueada, si el usuario la alcanza; si no, 404. */
  private async cargaEnAlcance(
    usuarioId: string,
    id: string,
    trx: Transaction<DB>,
  ): Promise<FilaCarga> {
    const { alcance } = await this.alcanceDe(usuarioId);
    const carga = await this.repo.bloquearCarga(id.toLowerCase(), trx);
    if (!carga || (alcance.tipo === 'una' && alcance.codigo !== carga.sucursalCodigo)) {
      throw new NotFoundException(MOTIVO_CARGA_INEXISTENTE);
    }
    return carga;
  }
}
```

- [ ] **Paso 8: controlador y módulo**

`apps/backend/src/modules/produccion/cargas.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  ConsultaCargasDto,
  CrearCargaDto,
  EditarCargaDto,
  VersionCargaDto,
} from './dto/cargas.dto';
import { CargasService } from './cargas.service';
import type { CargaRejilla, Rejilla } from './reglas-carga';

// T-27 (D1). Produccion › Recarga: todo con `carga.gestionar` (ya sembrado en el
// grupo Produccion/Almacen), lectura incluida, como las demas pantallas de una
// sola tarea. El alcance de sucursal lo resuelve el servicio (otra = 404).
@Controller('cargas')
export class CargasController {
  constructor(private readonly cargas: CargasService) {}

  @Get()
  @RequierePermiso('carga.gestionar')
  rejilla(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaCargasDto,
  ): Promise<Rejilla> {
    return this.cargas.rejilla(usuarioId, q);
  }

  @Post()
  @RequierePermiso('carga.gestionar')
  crear(
    @UsuarioActual() usuarioId: string,
    @Body() dto: CrearCargaDto,
  ): Promise<CargaRejilla> {
    return this.cargas.crear(usuarioId, dto);
  }

  @Patch(':id')
  @RequierePermiso('carga.gestionar')
  editar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarCargaDto,
  ): Promise<CargaRejilla> {
    return this.cargas.editar(usuarioId, id, dto);
  }

  @Delete(':id')
  @RequierePermiso('carga.gestionar')
  eliminar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VersionCargaDto,
  ): Promise<{ id: string }> {
    return this.cargas.eliminar(usuarioId, id, dto);
  }
}
```

`apps/backend/src/modules/produccion/produccion.module.ts` (reemplaza el contenido):

```ts
import { Module } from '@nestjs/common';
import { CargasController } from './cargas.controller';
import { CargasRepository } from './cargas.repository';
import { CargasService } from './cargas.service';

// T-27 pieza 1: la carga y las recargas del vendedor (tabla `carga`). Exporta
// `CargasService` para que sincronizacion/ baje las cargas en el pull y atienda
// la respuesta de la tablet (ADR-0009: la dependencia va de sincronizacion hacia
// aqui, nunca al reves).
@Module({
  controllers: [CargasController],
  providers: [CargasService, CargasRepository],
  exports: [CargasService],
})
export class ProduccionModule {}
```

- [ ] **Paso 9: la casilla de la sucursal**

`apps/backend/src/modules/sucursales/dto/editar-sucursal.dto.ts` — agrega al final de la clase:

```ts
  /**
   * T-27 (D7): "Control de inventario en la app". Prendida, los vendedores de la
   * sucursal necesitan aceptar su carga para vender y no venden mas de lo que
   * traen.
   */
  @IsOptional()
  @IsBoolean()
  controlInventario?: boolean;
```

`apps/backend/src/modules/sucursales/sucursales.repository.ts`:

1. Agrega `import { sql } from 'kysely';` arriba.
2. `Sucursal` y `CAMPOS` quedan así:

```ts
export interface Sucursal {
  id: string;
  codigo: string;
  nombre: string;
  activa: boolean;
  /** T-27 (D7). */
  controlInventario: boolean;
}

/** Las columnas que salen a la API. `deleted_at` nunca se expone (ver D6). */
const CAMPOS = [
  'id',
  'codigo',
  'nombre',
  'activa',
  'control_inventario as controlInventario',
] as const;
```

3. Reemplaza `actualizar` por:

```ts
  /**
   * `cambios` nunca llega vacio: el servicio lo comprueba antes. Un `.set({})`
   * genera SQL invalido, asi que el chequeo no es cortesia, es necesario.
   *
   * T-27 (D7): si cambia `control_inventario`, en la MISMA transaccion se toca
   * `updated_at` de los vendedores de la sucursal. La tablet solo baja su propia
   * ficha de `vendedor` y la baja por `updated_at`: sin esto, el pull
   * incremental nunca le traeria la casilla nueva.
   */
  async actualizar(
    id: string,
    cambios: { nombre?: string; activa?: boolean; control_inventario?: boolean },
    tocarVendedores: boolean,
  ): Promise<Sucursal> {
    return this.db.transaction().execute(async (trx) => {
      const sucursal = await trx
        .updateTable('sucursal')
        .set(cambios)
        .where('id', '=', id)
        .returning(CAMPOS)
        .executeTakeFirstOrThrow();
      if (tocarVendedores) {
        await trx
          .updateTable('vendedor')
          .set({ updated_at: sql<Date>`now()` })
          .where('sucursal_id', '=', id)
          .execute();
      }
      return sucursal;
    });
  }
```

`apps/backend/src/modules/sucursales/sucursales.service.ts` — en `editar`, reemplaza el bloque desde el primer `if`
hasta el `return` por:

```ts
    // El 400 va ANTES de tocar la base: un PATCH sin cambios no es un fallo
    // del servidor ni justifica una consulta, es un cuerpo mal armado.
    if (
      dto.nombre === undefined &&
      dto.activa === undefined &&
      dto.controlInventario === undefined
    ) {
      throw new BadRequestException('No hay nada que actualizar.');
    }

    const sucursal = await this.repo.buscarPorId(id);
    if (!sucursal) {
      throw new NotFoundException('No existe esa sucursal.');
    }

    // El alcance manda igual en escritura que en lectura (D3). Se compara
    // contra la sucursal YA leida y no contra el query param: aqui el objeto
    // que se va a modificar es el hecho, no lo que el cliente diga.
    const alcance = await this.alcanceDe(usuarioId, null);
    if (alcance.tipo === 'una' && alcance.codigo !== sucursal.codigo) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }

    const cambios: {
      nombre?: string;
      activa?: boolean;
      control_inventario?: boolean;
    } = {};
    if (dto.nombre !== undefined) {
      cambios.nombre = dto.nombre;
    }
    if (dto.activa !== undefined) {
      cambios.activa = dto.activa;
    }
    if (dto.controlInventario !== undefined) {
      cambios.control_inventario = dto.controlInventario;
    }

    // T-27: solo si la casilla CAMBIA se toca a los vendedores; reenviar el
    // mismo valor no hace bajar de nuevo su ficha.
    const tocarVendedores =
      dto.controlInventario !== undefined &&
      dto.controlInventario !== sucursal.controlInventario;
    return this.repo.actualizar(id, cambios, tocarVendedores);
```

- [ ] **Paso 10: el e2e del portal, que falla antes de levantar el módulo y pasa después**

`apps/backend/test/cargas.e2e-spec.ts`:

```ts
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
import type {
  CargaRejilla,
  Rejilla,
} from './../src/modules/produccion/reglas-carga';

/**
 * Produccion › Recarga (T-27 pieza 1), de punta a punta: permiso, alcance (otra
 * sucursal = 404), numeracion, edicion con version y baja logica.
 *
 * El POST crea la carga de HOY en Tijuana (D8). Los vendedores son nuevos en cada
 * corrida (`SUFIJO`), asi que su numeracion empieza en 1.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-carga-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-carga-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-carga-sin-${SUFIJO}`;
const PRODUCTO = `ZZ-carga-${SUFIJO}`;

type Cuerpo = Record<string, unknown>;

describe('Recarga desde el portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let mxId: string;
  let hoy: string;
  const usuarioIds: string[] = [];
  const vendedorIds: string[] = [];
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let vendedorTj: string;
  let vendedorTjInactivo: string;
  let vendedorMx: string;
  let productoId: string;
  let litro: string;
  let medio: string;
  let borrada: string;

  const iniciarSesion = async (login: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const acceso = cookies.find((c) => c.startsWith('jawa_access='));
    if (!acceso) throw new Error('El login no devolvio cookie de acceso.');
    return acceso.split(';')[0];
  };

  /** `Administrador General` trae todos los permisos; `Auxiliar Administrativo` esta vacio. */
  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ) => {
    const hash = await app.get(PasswordService).hashear(PASSWORD);
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', perfil)
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('usuario')
      .values({
        login,
        nombre: login,
        password_hash: hash,
        perfil_id: perfilId,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    usuarioIds.push(id);
  };

  const sembrarVendedor = async (
    sucursalId: string,
    nombre: string,
    activo = true,
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-carga-v${vendedorIds.length + 1}-${SUFIJO}`,
        nombre: `${nombre} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
        activo,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  const rejilla = (cookie: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/cargas?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const crear = (cookie: string, cuerpo: Cuerpo) =>
    request(app.getHttpServer()).post('/cargas').set('Cookie', cookie).send(cuerpo);

  const editar = (cookie: string, id: string, cuerpo: Cuerpo) =>
    request(app.getHttpServer())
      .patch(`/cargas/${id}`)
      .set('Cookie', cookie)
      .send(cuerpo);

  const eliminar = (cookie: string, id: string, cuerpo: Cuerpo) =>
    request(app.getHttpServer())
      .delete(`/cargas/${id}`)
      .set('Cookie', cookie)
      .send(cuerpo);

  /** Una carga nueva de `vendedor` con `piezas` de 1 L; devuelve la respuesta. */
  const cargaDe = async (vendedor: string, piezas = 24): Promise<CargaRejilla> =>
    (
      await crear(cookieGeneral, {
        vendedorId: vendedor,
        lineas: [{ presentacionId: litro, piezas }],
      }).expect(201)
    ).body as CargaRejilla;

  /** Pone una carga en un estado de respuesta, como lo haria la Tarea 3. */
  const responderEnBase = (id: string, estado: 'aceptada' | 'rechazada') =>
    db
      .updateTable('carga')
      .set({
        estado,
        motivo_rechazo: estado === 'rechazada' ? 'Faltan 2 cajas' : null,
        respondida_en: new Date(),
      })
      .where('id', '=', id)
      .execute();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    const sucursales = await db
      .selectFrom('sucursal')
      .select(['id', 'codigo'])
      .where('codigo', 'in', ['TJ', 'MX'])
      .execute();
    tjId = sucursales.find((s) => s.codigo === 'TJ')!.id;
    mxId = sucursales.find((s) => s.codigo === 'MX')!.id;
    hoy = (
      await sql<{ hoy: string }>`
        select to_char((now() at time zone 'America/Tijuana')::date, 'YYYY-MM-DD') as hoy
      `.execute(db)
    ).rows[0].hoy;

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', tjId);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);

    vendedorTj = await sembrarVendedor(tjId, 'Berta Carga');
    vendedorTjInactivo = await sembrarVendedor(tjId, 'Inactivo Carga', false);
    vendedorMx = await sembrarVendedor(mxId, 'Mario Carga');

    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: PRODUCTO })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const presentacion = async (volumen: string, borradaYa = false) =>
      (
        await db
          .insertInto('presentacion')
          .values({
            producto_id: productoId,
            volumen,
            deleted_at: borradaYa ? new Date() : null,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    litro = await presentacion('1 L');
    medio = await presentacion('500 ml');
    borrada = await presentacion('2 L', true);
  });

  afterAll(async () => {
    const cargas = db
      .selectFrom('carga')
      .select('id')
      .where('vendedor_id', 'in', vendedorIds);
    await db.deleteFrom('carga_detalle').where('carga_id', 'in', cargas).execute();
    await db.deleteFrom('carga').where('vendedor_id', 'in', vendedorIds).execute();
    await db.deleteFrom('presentacion').where('producto_id', '=', productoId).execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
    await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  describe('permiso y alcance', () => {
    it('sin carga.gestionar todo es 403, lectura incluida', async () => {
      const id = '00000000-0000-4000-8000-000000000000';
      await rejilla(cookieSinPermiso, { fecha: hoy, sucursal: tjId }).expect(403);
      await crear(cookieSinPermiso, {
        vendedorId: vendedorTj,
        lineas: [{ presentacionId: litro, piezas: 1 }],
      }).expect(403);
      await editar(cookieSinPermiso, id, {
        version: 1,
        lineas: [{ presentacionId: litro, piezas: 1 }],
      }).expect(403);
      await eliminar(cookieSinPermiso, id, { version: 1 }).expect(403);
    });

    it('un usuario atado a TJ ve la suya sin pedirla; pedir MX es 404, no 403', async () => {
      const res = await rejilla(cookieTijuana, { fecha: hoy }).expect(200);
      expect((res.body as Rejilla).sucursal.codigo).toBe('TJ');
      await rejilla(cookieTijuana, { fecha: hoy, sucursal: mxId }).expect(404);
    });

    it('un General tiene que elegir la sucursal; una inexistente es 404', async () => {
      await rejilla(cookieGeneral, { fecha: hoy }).expect(400);
      await rejilla(cookieGeneral, {
        fecha: hoy,
        sucursal: '00000000-0000-4000-8000-000000000000',
      }).expect(404);
    });

    it('un usuario de TJ no captura ni toca cargas de un vendedor de MX: 404', async () => {
      await crear(cookieTijuana, {
        vendedorId: vendedorMx,
        lineas: [{ presentacionId: litro, piezas: 5 }],
      }).expect(404);
      const ajena = await cargaDe(vendedorMx);
      await editar(cookieTijuana, ajena.id, {
        version: 1,
        lineas: [{ presentacionId: litro, piezas: 6 }],
      }).expect(404);
      await eliminar(cookieTijuana, ajena.id, { version: 1 }).expect(404);
    });
  });

  describe('POST /cargas', () => {
    it('numera 1, 2, 3 y una baja libera el ultimo numero', async () => {
      const vendedor = await sembrarVendedor(tjId, 'Numeracion Carga');
      const uno = await cargaDe(vendedor);
      const dos = await cargaDe(vendedor);
      const tres = await cargaDe(vendedor);
      expect([uno.numero, dos.numero, tres.numero]).toEqual([1, 2, 3]);
      expect(uno).toMatchObject({
        estado: 'pendiente',
        version: 1,
        motivoRechazo: null,
        respondidaEn: null,
        lineas: [{ presentacionId: litro, piezas: 24 }],
      });

      await eliminar(cookieGeneral, tres.id, { version: 1 }).expect(200);
      expect((await cargaDe(vendedor)).numero).toBe(3);
    });

    it('la carga es de hoy en Tijuana y guarda quien la capturo', async () => {
      const carga = await cargaDe(vendedorTj);
      const fila = await db
        .selectFrom('carga')
        .select([
          sql<string>`to_char(fecha, 'YYYY-MM-DD')`.as('fecha'),
          'capturo_usuario_id',
          'sucursal_id',
        ])
        .where('id', '=', carga.id)
        .executeTakeFirstOrThrow();
      expect(fila).toEqual({
        fecha: hoy,
        capturo_usuario_id: usuarioIds[0],
        sucursal_id: tjId,
      });
    });

    it('valida las lineas: vacias, repetidas, dada de baja y piezas fuera de rango', async () => {
      const base = { vendedorId: vendedorTj };
      await crear(cookieGeneral, { ...base, lineas: [] }).expect(400);
      const repetida = await crear(cookieGeneral, {
        ...base,
        lineas: [
          { presentacionId: litro, piezas: 1 },
          { presentacionId: litro, piezas: 2 },
        ],
      }).expect(400);
      expect((repetida.body as { message: string }).message).toBe(
        'Un producto viene dos veces en la carga.',
      );
      await crear(cookieGeneral, {
        ...base,
        lineas: [{ presentacionId: borrada, piezas: 1 }],
      }).expect(400);
      for (const piezas of [0, 100_000, 1.5]) {
        await crear(cookieGeneral, {
          ...base,
          lineas: [{ presentacionId: litro, piezas }],
        }).expect(400);
      }
    });

    it('a un vendedor desactivado no se le captura: 400', async () => {
      await crear(cookieGeneral, {
        vendedorId: vendedorTjInactivo,
        lineas: [{ presentacionId: litro, piezas: 1 }],
      }).expect(400);
    });
  });

  describe('GET /cargas', () => {
    it('la rejilla trae las presentaciones activas en su orden y las cargas del vendedor', async () => {
      const vendedor = await sembrarVendedor(tjId, 'Aaron Rejilla');
      const carga = (
        await crear(cookieGeneral, {
          vendedorId: vendedor,
          lineas: [
            { presentacionId: litro, piezas: 24 },
            { presentacionId: medio, piezas: 12 },
          ],
        }).expect(201)
      ).body as CargaRejilla;

      const r = (await rejilla(cookieGeneral, { fecha: hoy, sucursal: tjId }).expect(200))
        .body as Rejilla;
      const mias = r.presentaciones.filter((p) => p.productoNombre === PRODUCTO);
      // 500 ml antes que 1 L; la dada de baja no sale (ninguna carga la trae).
      expect(mias.map((p) => p.id)).toEqual([medio, litro]);
      const columna = r.vendedores.find((v) => v.id === vendedor);
      expect(columna?.cargas.map((c) => c.id)).toEqual([carga.id]);
      expect(r.vendedores.some((v) => v.id === vendedorTjInactivo)).toBe(false);
      expect(r.vendedores.some((v) => v.id === vendedorMx)).toBe(false);
    });

    it('una fecha que no existe es 400', async () => {
      await rejilla(cookieGeneral, { fecha: '2026-02-30', sucursal: tjId }).expect(400);
    });
  });

  describe('PATCH y DELETE (D5)', () => {
    it('editar una pendiente reemplaza las lineas y sube la version', async () => {
      const carga = await cargaDe(vendedorTj);
      const res = await editar(cookieGeneral, carga.id, {
        version: 1,
        lineas: [{ presentacionId: medio, piezas: 6 }],
      }).expect(200);
      expect(res.body as CargaRejilla).toMatchObject({
        id: carga.id,
        version: 2,
        estado: 'pendiente',
        lineas: [{ presentacionId: medio, piezas: 6 }],
      });
    });

    it('con la version vieja es 409 y trae la carga actual', async () => {
      const carga = await cargaDe(vendedorTj);
      await editar(cookieGeneral, carga.id, {
        version: 1,
        lineas: [{ presentacionId: litro, piezas: 30 }],
      }).expect(200);
      const viejo = await editar(cookieGeneral, carga.id, {
        version: 1,
        lineas: [{ presentacionId: litro, piezas: 31 }],
      }).expect(409);
      const cuerpo = viejo.body as { message: string; carga: CargaRejilla };
      expect(cuerpo.message).toBe(
        'La carga cambió mientras la editabas; recarga la página.',
      );
      expect(cuerpo.carga.version).toBe(2);
      await eliminar(cookieGeneral, carga.id, { version: 1 }).expect(409);
    });

    it('editar una rechazada la regresa a pendiente y limpia motivo y respuesta', async () => {
      const carga = await cargaDe(vendedorTj);
      await responderEnBase(carga.id, 'rechazada');
      const res = await editar(cookieGeneral, carga.id, {
        version: 1,
        lineas: [{ presentacionId: litro, piezas: 26 }],
      }).expect(200);
      expect(res.body as CargaRejilla).toMatchObject({
        estado: 'pendiente',
        motivoRechazo: null,
        respondidaEn: null,
        version: 2,
      });
    });

    it('una aceptada no se edita ni se elimina: 409', async () => {
      const carga = await cargaDe(vendedorTj);
      await responderEnBase(carga.id, 'aceptada');
      const res = await editar(cookieGeneral, carga.id, {
        version: 1,
        lineas: [{ presentacionId: litro, piezas: 1 }],
      }).expect(409);
      expect((res.body as { message: string }).message).toContain(
        'Una carga aceptada no se modifica',
      );
      await eliminar(cookieGeneral, carga.id, { version: 1 }).expect(409);
    });

    it('una carga de otro dia es de solo lectura (D8): 409', async () => {
      const { id } = await db
        .insertInto('carga')
        .values({
          sucursal_id: tjId,
          vendedor_id: vendedorTj,
          fecha: '2015-06-15',
          numero: 1,
          capturo_usuario_id: usuarioIds[0],
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const res = await eliminar(cookieGeneral, id, { version: 1 }).expect(409);
      expect((res.body as { message: string }).message).toBe(
        'Solo se modifican las cargas de hoy.',
      );
    });

    it('eliminar es baja logica: desaparece de la rejilla y la segunda vez es 404', async () => {
      const carga = await cargaDe(vendedorTj);
      await eliminar(cookieGeneral, carga.id, { version: 1 }).expect(200);
      const fila = await db
        .selectFrom('carga')
        .select('deleted_at')
        .where('id', '=', carga.id)
        .executeTakeFirstOrThrow();
      expect(fila.deleted_at).not.toBeNull();
      const r = (await rejilla(cookieGeneral, { fecha: hoy, sucursal: tjId }).expect(200))
        .body as Rejilla;
      const columna = r.vendedores.find((v) => v.id === vendedorTj);
      expect(columna?.cargas.some((c) => c.id === carga.id)).toBe(false);
      await eliminar(cookieGeneral, carga.id, { version: 1 }).expect(404);
    });
  });
});
```

En `apps/backend/test/sucursales.e2e-spec.ts`:

1. En `interface SucursalRespuesta` agrega `controlInventario: boolean;`.
2. Dentro de `describe('PATCH /sucursales/:id', …)`, después de `it('cambia el nombre', …)`, agrega:

```ts
    it('T-27: la casilla de control de inventario toca a los vendedores solo si cambia', async () => {
      // ZH es de las reservadas para esta suite (CODIGOS_DE_PRUEBA): la borra el afterAll.
      const creada = await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', [cookieGeneral])
        .send({ codigo: 'ZH', nombre: 'Control de inventario' })
        .expect(201);
      const sucursal = creada.body as SucursalRespuesta;
      expect(sucursal.controlInventario).toBe(false);

      const { id: vendedorId } = await db
        .insertInto('vendedor')
        .values({
          login: `e2e-suc-inv-${SUFIJO}`,
          nombre: 'Vendedor control inventario',
          password_hash: 'x',
          sucursal_id: sucursal.id,
          updated_at: new Date('2020-01-01T00:00:00Z'),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const tocadoEn = async () =>
        (
          await db
            .selectFrom('vendedor')
            .select('updated_at')
            .where('id', '=', vendedorId)
            .executeTakeFirstOrThrow()
        ).updated_at.getTime();

      try {
        const prendida = await request(app.getHttpServer())
          .patch(`/sucursales/${sucursal.id}`)
          .set('Cookie', [cookieGeneral])
          .send({ controlInventario: true })
          .expect(200);
        expect((prendida.body as SucursalRespuesta).controlInventario).toBe(true);
        const primera = await tocadoEn();
        expect(primera).toBeGreaterThan(new Date('2020-01-01T00:00:00Z').getTime());

        // El mismo valor otra vez: no vuelve a tocar al vendedor.
        await request(app.getHttpServer())
          .patch(`/sucursales/${sucursal.id}`)
          .set('Cookie', [cookieGeneral])
          .send({ controlInventario: true })
          .expect(200);
        expect(await tocadoEn()).toBe(primera);
      } finally {
        await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
      }
    });
```

Corre:

```bash
npm run build --workspace=apps/backend
npm run test:e2e --workspace=apps/backend -- cargas.e2e sucursales.e2e
```

Esperado: todo verde. (Si corres el e2e de cargas antes del Paso 8, falla con 404 en `/cargas`: es la falla
esperada.)

- [ ] **Paso 11: lint, pruebas y commit**

```bash
npm exec --workspace=apps/backend -- prettier --write src/modules/produccion src/modules/sucursales test/cargas.e2e-spec.ts test/sucursales.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/produccion src/modules/sucursales test/cargas.e2e-spec.ts test/sucursales.e2e-spec.ts
npm test --workspace=apps/backend -- reglas-carga alcance-sucursal
git add apps/backend/src/modules/produccion apps/backend/src/modules/sucursales apps/backend/test/cargas.e2e-spec.ts apps/backend/test/sucursales.e2e-spec.ts
git commit -m "T-27: Producción › Recarga en el backend (/cargas) y la casilla de control de inventario de la sucursal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Los comandos de `prettier`/`eslint` con `--workspace=apps/backend` corren dentro de `apps/backend`: las rutas son
relativas a esa carpeta.)

---

### Tarea 3: Backend de la app: respuesta del vendedor, colección `cargas` del pull y `VendedorPull.control_inventario` (contrato del spec, D2, D6, D7)

**Files:**
- Modify: `apps/backend/src/modules/produccion/reglas-carga.ts` (respuesta y forma del pull)
- Test: `apps/backend/src/modules/produccion/reglas-carga.spec.ts`
- Modify: `apps/backend/src/modules/produccion/cargas.repository.ts` (filtro del pull, `escribirRespuesta`,
  `vendedorActivo`)
- Modify: `apps/backend/src/modules/produccion/cargas.service.ts` (`responder`, `paraPull`)
- Create: `apps/backend/src/modules/sincronizacion/cargas-app.controller.ts`
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.module.ts`,
  `sincronizacion.service.ts`, `sincronizacion.repository.ts`
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts` **y** `apps/tablet/src/sincronizacion/contrato.ts`
  **y** `docs/contrato-sincronizacion.md` (mismo commit)
- Test: `apps/backend/test/cargas-app.e2e-spec.ts`

**Interfaces:**
- Consumes: `CargasService`/`CargasRepository`/`FilaCarga`/`RespuestaCargaDto` de la Tarea 2; `@SoloApp`,
  `@VendedorActual`.
- Produces:
  - Contrato (ambas copias): `type EstadoCargaPull = 'pendiente' | 'aceptada' | 'rechazada'`;
    `interface LineaCargaPull { presentacion_id: string; piezas: number }`;
    `interface CargaPull extends FilaSincronizable { vendedor_id; fecha; numero; estado: EstadoCargaPull;
    motivo_rechazo: string | null; version: number; respondida_en: string | null; lineas: LineaCargaPull[] }`;
    `type CuerpoRespuestaCarga = { version: number; accion: 'aceptar' | 'rechazar'; motivo?: string }`;
    `RespuestaPull.cargas: CargaPull[]` (tablet: `cargas?:`); `VendedorPull.control_inventario: boolean` (tablet:
    `control_inventario?:`).
  - `reglas-carga.ts`: `MOTIVO_RESPUESTA_CONFLICTO`; `type RespuestaCarga = { estado: 'aceptada'; motivo: null } |
    { estado: 'rechazada'; motivo: string }`;
    `normalizarRespuesta(accion: 'aceptar' | 'rechazar', motivo: string | null | undefined): { ok: true; respuesta:
    RespuestaCarga } | { ok: false; mensaje: string }`;
    `type DecisionRespuesta = 'escribir' | 'repetida' | 'conflicto'`;
    `decidirRespuesta(carga: Pick<FilaCarga, 'estado' | 'version' | 'motivoRechazo'>, respuesta: RespuestaCarga,
    version: number): DecisionRespuesta`; `aCargaPull(f: FilaCarga): CargaPull`.
  - `CargasService.paraPull(vendedorId: string, desde: Date | null): Promise<CargaPull[]>` y
    `CargasService.responder(vendedorId: string, cargaId: string, dto: RespuestaCargaDto): Promise<CargaPull>`.
  - HTTP: `POST /sync/cargas/:id/respuesta` (`@SoloApp()`, 200 con `CargaPull`; 400 forma; 404 otro vendedor,
    inexistente o eliminada; 409 `{ message, carga: CargaPull }`).

- [ ] **Paso 1: las pruebas de la respuesta y de la forma del pull, que fallan**

En `apps/backend/src/modules/produccion/reglas-carga.spec.ts`, reemplaza el bloque de `import` por:

```ts
import {
  aCargaPull,
  aCargaRejilla,
  armarRejilla,
  decidirRespuesta,
  mililitros,
  MOTIVO_CARGA_ACEPTADA,
  MOTIVO_CARGA_CAMBIO,
  MOTIVO_CARGA_DE_OTRO_DIA,
  motivoNoEditable,
  normalizarLineas,
  normalizarRespuesta,
  ordenarPresentaciones,
  validarLineas,
  type FilaCarga,
  type PresentacionRejilla,
} from './reglas-carga';
```

y agrega al final del archivo:

```ts
describe('normalizarRespuesta (POST /sync/cargas/:id/respuesta)', () => {
  it('aceptar no lleva motivo: ausente o null pasa, con texto es 400', () => {
    expect(normalizarRespuesta('aceptar', undefined)).toEqual({
      ok: true,
      respuesta: { estado: 'aceptada', motivo: null },
    });
    expect(normalizarRespuesta('aceptar', null)).toEqual({
      ok: true,
      respuesta: { estado: 'aceptada', motivo: null },
    });
    expect(normalizarRespuesta('aceptar', 'todo bien')).toEqual({
      ok: false,
      mensaje: 'Aceptar una carga no lleva motivo.',
    });
  });

  it('rechazar exige motivo de 1 a 300 caracteres, recortado', () => {
    expect(normalizarRespuesta('rechazar', '  Faltan 2 cajas  ')).toEqual({
      ok: true,
      respuesta: { estado: 'rechazada', motivo: 'Faltan 2 cajas' },
    });
    expect(normalizarRespuesta('rechazar', 'x'.repeat(300)).ok).toBe(true);
    for (const motivo of [undefined, null, '', '   ', 'x'.repeat(301)]) {
      expect(normalizarRespuesta('rechazar', motivo)).toEqual({
        ok: false,
        mensaje: 'Para rechazar la carga escribe el motivo (hasta 300 caracteres).',
      });
    }
  });
});

describe('decidirRespuesta (D6, Review Focus 2 y 3)', () => {
  const aceptar = { estado: 'aceptada', motivo: null } as const;
  const rechazar = { estado: 'rechazada', motivo: 'Faltan cajas' } as const;

  it('pendiente con su version: se escribe', () => {
    expect(decidirRespuesta(fila(), aceptar, 1)).toBe('escribir');
    expect(decidirRespuesta(fila(), rechazar, 1)).toBe('escribir');
  });

  it('la misma respuesta otra vez (reintento de red, doble toque): repetida', () => {
    expect(decidirRespuesta(fila({ estado: 'aceptada' }), aceptar, 1)).toBe('repetida');
    expect(
      decidirRespuesta(
        fila({ estado: 'rechazada', motivoRechazo: 'Faltan cajas' }),
        rechazar,
        1,
      ),
    ).toBe('repetida');
  });

  it('otra version, u otra respuesta ya escrita: conflicto (409)', () => {
    expect(decidirRespuesta(fila({ version: 2 }), aceptar, 1)).toBe('conflicto');
    expect(
      decidirRespuesta(
        fila({ estado: 'rechazada', motivoRechazo: 'Faltan cajas' }),
        aceptar,
        1,
      ),
    ).toBe('conflicto');
    expect(
      decidirRespuesta(
        fila({ estado: 'rechazada', motivoRechazo: 'Otra cosa' }),
        rechazar,
        1,
      ),
    ).toBe('conflicto');
  });
});

describe('aCargaPull (colección `cargas` del pull)', () => {
  it('snake_case, fecha tal cual, respondida en ISO y la baja como activo 0', () => {
    expect(
      aCargaPull(
        fila({
          estado: 'aceptada',
          respondidaEn: new Date('2026-10-22T15:00:00.000Z'),
          eliminada: true,
        }),
      ),
    ).toEqual({
      id: 'c-1',
      vendedor_id: 'v-1',
      fecha: '2026-10-22',
      numero: 1,
      estado: 'aceptada',
      motivo_rechazo: null,
      version: 1,
      respondida_en: '2026-10-22T15:00:00.000Z',
      activo: 0,
      lineas: [{ presentacion_id: A, piezas: 24 }],
    });
    expect(aCargaPull(fila()).activo).toBe(1);
  });
});
```

`npm test --workspace=apps/backend -- reglas-carga` → falla: `aCargaPull`, `decidirRespuesta` y
`normalizarRespuesta` no existen.

- [ ] **Paso 2: el contrato (backend)**

En `apps/backend/src/modules/sincronizacion/contrato.ts`:

1. En `interface VendedorPull`, después de `folio_segmento: string | null;`, agrega:

```ts
  /**
   * T-27 (D7): la casilla "Control de inventario en la app" de SU sucursal.
   * Prendida, la tablet no vende con una carga pendiente ni deja una
   * presentacion en negativo. Cambiarla en el portal toca `updated_at` de los
   * vendedores de esa sucursal, asi que baja en el pull incremental. Aditivo.
   */
  control_inventario: boolean;
```

2. Antes de `export interface RespuestaPull`, agrega:

```ts
/* ------------------------------------------------------------------ */
/* T-27: carga y recarga del vendedor                                  */
/* ------------------------------------------------------------------ */

export type EstadoCargaPull = 'pendiente' | 'aceptada' | 'rechazada';

export interface LineaCargaPull {
  presentacion_id: string;
  /** Piezas enteras, 1..99 999. */
  piezas: number;
}

/**
 * Una carga (la de la manana o una recarga) que produccion registro en el
 * portal para el vendedor del token (T-27, D1). La tablet NO crea cargas: solo
 * las recibe y responde con `POST /sync/cargas/:id/respuesta`.
 *
 * - Bajan las del vendedor con `fecha >= current_date - 1` del reloj de
 *   Postgres (como `rutas`). Incremental por `updated_at`; sin `desde`, solo las
 *   vivas. Una eliminada en el portal viaja con `activo: 0`.
 * - `version` sube cada vez que el portal edita las lineas (y la regresa a
 *   `pendiente`); la respuesta de la tablet la manda de vuelta y el servidor
 *   contesta 409 si ya no coincide (D6).
 * - `lineas` viene siempre COMPLETA: la tablet reemplaza las suyas.
 */
export interface CargaPull extends FilaSincronizable {
  vendedor_id: string;
  /** `AAAA-MM-DD`: hoy en Tijuana cuando se capturo (D8). */
  fecha: string;
  /** 1, 2, 3… por vendedor y dia. */
  numero: number;
  estado: EstadoCargaPull;
  /** Solo en `rechazada` (1..300). */
  motivo_rechazo: string | null;
  version: number;
  /** Instante ISO de la respuesta, o `null` si sigue pendiente. */
  respondida_en: string | null;
  lineas: LineaCargaPull[];
}

/**
 * Cuerpo de `POST /sync/cargas/:id/respuesta` (T-27, D2/D6). Viaja con red, en
 * el momento: no es una operacion del push ni lleva `contrato`. `motivo` solo
 * con `rechazar` (1..300, se recorta); con `aceptar` es 400.
 */
export type CuerpoRespuestaCarga = {
  version: number;
  accion: 'aceptar' | 'rechazar';
  motivo?: string;
};
```

3. Al final de `interface RespuestaPull` (después de `promociones: PromocionPull[];`), agrega:

```ts
  /**
   * T-27. Las cargas del vendedor del token (ver {@link CargaPull}). Aditiva:
   * una tablet vieja la ignora y sigue vendiendo como hoy.
   */
  cargas: CargaPull[];
```

- [ ] **Paso 3: el contrato (tablet), en el mismo commit**

En `apps/tablet/src/sincronizacion/contrato.ts`:

1. En `interface VendedorPull`, después de `folio_segmento: string | null;`:

```ts
  /**
   * T-27 (D7): el control de inventario de su sucursal. **Opcional en la copia
   * de la tablet, obligatorio en el servidor** (regla §3): un servidor anterior
   * no lo manda y la tablet conserva el valor que ya tenia (0 la primera vez).
   */
  control_inventario?: boolean;
```

2. Antes de `export interface RespuestaPull`, el mismo bloque `T-27` del Paso 2 (`EstadoCargaPull`,
   `LineaCargaPull`, `CargaPull`, `CuerpoRespuestaCarga`) copiado tal cual.

3. Al final de `interface RespuestaPull`:

```ts
  /**
   * T-27. **Opcional en la copia de la tablet, obligatoria en el servidor**, por
   * la misma razon que `rutas`: sin la coleccion la tablet no conoce cargas, no
   * hay nada que aceptar y el control no puede prenderse (el vendedor tampoco).
   */
  cargas?: CargaPull[];
```

- [ ] **Paso 4: las reglas de la respuesta y la forma del pull**

En `apps/backend/src/modules/produccion/reglas-carga.ts`:

1. Agrega al inicio del archivo, antes del comentario de cabecera:

```ts
import type { CargaPull } from '../sincronizacion/contrato';
```

2. Agrega al final del archivo:

```ts
export const MOTIVO_RESPUESTA_CONFLICTO =
  'La carga cambió en el almacén o ya tiene otra respuesta; sincroniza y revísala de nuevo.';

/** Lo que el vendedor contesta, ya validado (D2: completa, con motivo si rechaza). */
export type RespuestaCarga =
  | { estado: 'aceptada'; motivo: null }
  | { estado: 'rechazada'; motivo: string };

/**
 * La forma de la respuesta. `aceptar` no lleva motivo (400 si viene con texto;
 * `null` cuenta como ausente); `rechazar` exige 1..300 caracteres recortados.
 */
export function normalizarRespuesta(
  accion: 'aceptar' | 'rechazar',
  motivo: string | null | undefined,
): { ok: true; respuesta: RespuestaCarga } | { ok: false; mensaje: string } {
  if (accion === 'aceptar') {
    if (motivo !== undefined && motivo !== null) {
      return { ok: false, mensaje: 'Aceptar una carga no lleva motivo.' };
    }
    return { ok: true, respuesta: { estado: 'aceptada', motivo: null } };
  }
  const texto = typeof motivo === 'string' ? motivo.trim() : '';
  if (texto.length < 1 || texto.length > LARGO_MAX_MOTIVO_RECHAZO) {
    return {
      ok: false,
      mensaje: 'Para rechazar la carga escribe el motivo (hasta 300 caracteres).',
    };
  }
  return { ok: true, respuesta: { estado: 'rechazada', motivo: texto } };
}

export type DecisionRespuesta = 'escribir' | 'repetida' | 'conflicto';

/**
 * Que hacer con una respuesta sobre la carga YA bloqueada (`for update`):
 *
 * - `repetida`: ya tiene esa misma respuesta en esa version (reintento de red o
 *   doble toque, Review Focus 3): 200 sin reescribir.
 * - `conflicto`: otra version (el portal la edito, Review Focus 2) o ya no esta
 *   pendiente con otra respuesta: 409 con la carga actual.
 * - `escribir`: pendiente y con la version que vio el vendedor.
 */
export function decidirRespuesta(
  carga: Pick<FilaCarga, 'estado' | 'version' | 'motivoRechazo'>,
  respuesta: RespuestaCarga,
  version: number,
): DecisionRespuesta {
  if (
    carga.version === version &&
    carga.estado === respuesta.estado &&
    (respuesta.estado === 'aceptada' || carga.motivoRechazo === respuesta.motivo)
  ) {
    return 'repetida';
  }
  if (carga.version !== version || carga.estado !== 'pendiente') return 'conflicto';
  return 'escribir';
}

/** Una fila de la coleccion `cargas` del pull (y la respuesta del endpoint de la app). */
export function aCargaPull(f: FilaCarga): CargaPull {
  return {
    id: f.id,
    vendedor_id: f.vendedorId,
    fecha: f.fecha,
    numero: f.numero,
    estado: f.estado,
    motivo_rechazo: f.motivoRechazo,
    version: f.version,
    respondida_en: f.respondidaEn === null ? null : f.respondidaEn.toISOString(),
    activo: f.eliminada ? 0 : 1,
    lineas: f.lineas.map((l) => ({ presentacion_id: l.presentacionId, piezas: l.piezas })),
  };
}
```

`npm test --workspace=apps/backend -- reglas-carga` → verde.

- [ ] **Paso 5: repositorio y servicio**

En `apps/backend/src/modules/produccion/cargas.repository.ts`:

1. Cambia el `import type { … } from './reglas-carga'` para incluir `RespuestaCarga`, y reemplaza `FiltroCargas` por:

```ts
/** Que cargas leer: una, las de la rejilla, o las del vendedor del token para el pull. */
export type FiltroCargas =
  | { id: string }
  | { sucursalId: string; fecha: string }
  | { vendedorId: string; desde: Date | null };
```

2. En `leerCargas`, reemplaza el bloque `if ('id' in filtro) { … } else { … }` por:

```ts
    if ('id' in filtro) {
      q = q.where('id', '=', filtro.id);
    } else if ('sucursalId' in filtro) {
      q = q
        .where('sucursal_id', '=', filtro.sucursalId)
        .where(sql<boolean>`fecha = ${filtro.fecha}::date`)
        .where('deleted_at', 'is', null);
    } else {
      // El pull: las del vendedor del token desde AYER por el reloj de Postgres
      // (UTC), como `rutas` (T-37): el `- 1` mantiene "hoy en Tijuana" dentro de
      // la ventana despues de las 17:00 locales. Sin `desde`, solo las vivas; con
      // `desde`, todo lo que cambio (una baja viaja como `activo: 0`).
      q = q
        .where('vendedor_id', '=', filtro.vendedorId)
        .where(sql<boolean>`fecha >= current_date - 1`);
      q = filtro.desde
        ? q.where('updated_at', '>', filtro.desde)
        : q.where('deleted_at', 'is', null);
    }
```

3. Agrega, después de `darDeBaja`:

```ts
  /** ¿El vendedor del token sigue vivo y activo? (El guard valido la firma, no eso.) */
  async vendedorActivo(vendedorId: string): Promise<boolean> {
    const fila = await this.db
      .selectFrom('vendedor')
      .select('id')
      .where('id', '=', vendedorId)
      .where('activo', '=', true)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /** Escribe la respuesta del vendedor (D2): estado, motivo y `respondida_en = now()`. */
  async escribirRespuesta(
    cargaId: string,
    respuesta: RespuestaCarga,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('carga')
      .set({
        estado: respuesta.estado,
        motivo_rechazo: respuesta.motivo,
        respondida_en: sql<Date>`now()`,
      })
      .where('id', '=', cargaId)
      .execute();
  }
```

En `apps/backend/src/modules/produccion/cargas.service.ts`:

1. Agrega `import type { CargaPull } from '../sincronizacion/contrato';`, `RespuestaCargaDto` al import de
   `./dto/cargas.dto` y `aCargaPull`, `decidirRespuesta`, `MOTIVO_RESPUESTA_CONFLICTO`, `normalizarRespuesta` al import
   de `./reglas-carga`.
2. Agrega, después de `eliminar`:

```ts
  /** La coleccion `cargas` del pull para el vendedor del token (T-27). */
  async paraPull(vendedorId: string, desde: Date | null): Promise<CargaPull[]> {
    return (await this.repo.leerCargas({ vendedorId, desde })).map(aCargaPull);
  }

  /**
   * `POST /sync/cargas/:id/respuesta` (D2, D6): aceptar o rechazar la carga
   * completa, con red y en el momento.
   *
   * La forma se valida primero (400). Despues, en una transaccion con la carga
   * bloqueada: de otro vendedor, inexistente o eliminada → 404 (no confirma que
   * exista); la misma respuesta otra vez → 200 sin reescribir (idempotente);
   * otra version o ya respondida → 409 con la carga actual; si no, se escribe.
   */
  async responder(
    vendedorId: string,
    cargaId: string,
    dto: RespuestaCargaDto,
  ): Promise<CargaPull> {
    const forma = normalizarRespuesta(dto.accion, dto.motivo);
    if (!forma.ok) throw new BadRequestException(forma.mensaje);
    if (!(await this.repo.vendedorActivo(vendedorId))) {
      throw new UnauthorizedException('Sesion invalida.');
    }

    return this.repo.enTransaccion(async (trx) => {
      const carga = await this.repo.bloquearCarga(cargaId, trx);
      if (!carga || carga.vendedorId !== vendedorId) {
        throw new NotFoundException(MOTIVO_CARGA_INEXISTENTE);
      }
      const decision = decidirRespuesta(carga, forma.respuesta, dto.version);
      if (decision === 'conflicto') {
        throw new ConflictException({
          message: MOTIVO_RESPUESTA_CONFLICTO,
          carga: aCargaPull(carga),
        });
      }
      if (decision === 'escribir') {
        await this.repo.escribirRespuesta(carga.id, forma.respuesta, trx);
      }
      const [actual] = await this.repo.leerCargas({ id: carga.id }, trx);
      return aCargaPull(actual);
    });
  }
```

- [ ] **Paso 6: el endpoint de la app y el pull**

`apps/backend/src/modules/sincronizacion/cargas-app.controller.ts`:

```ts
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { SoloApp } from '../auth/solo-app.decorator';
import { VendedorActual } from '../auth/vendedor-actual.decorator';
import { CargasService } from '../produccion/cargas.service';
import { RespuestaCargaDto } from '../produccion/dto/cargas.dto';
import type { CargaPull } from './contrato';

/**
 * La respuesta del vendedor a su carga (T-27, D2/D6), junto a las fotos: un canal
 * aparte del lote del push (sin `contrato` ni `resultados[]`), con la misma auth
 * de vendedor. La regla vive en Produccion (`CargasService.responder`, ADR-0009);
 * aqui solo se recibe.
 *
 * Usa el mismo `Authorization: Bearer` que el resto de la app y nunca renueva la
 * sesion por su cuenta: un 401 lo resuelve la tablet sincronizando.
 *
 * 200 y no 201: responder es idempotente (la misma respuesta otra vez devuelve
 * la carga sin reescribirla).
 */
@Controller('sync')
export class CargasAppController {
  constructor(private readonly cargas: CargasService) {}

  @SoloApp()
  @Post('cargas/:id/respuesta')
  @HttpCode(HttpStatus.OK)
  responder(
    @VendedorActual() vendedorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespuestaCargaDto,
  ): Promise<CargaPull> {
    return this.cargas.responder(vendedorId, id.toLowerCase(), dto);
  }
}
```

`apps/backend/src/modules/sincronizacion/sincronizacion.module.ts`:

- `import { ProduccionModule } from '../produccion/produccion.module';` y
  `import { CargasAppController } from './cargas-app.controller';`.
- `imports: [VentasCobranzaModule, CarteraClientesModule, RutasModule, ComprasEgresosModule, ProduccionModule]`
  (con el comentario `// T-27 suma Produccion: la duena de la carga (pull y respuesta).`).
- `controllers: [SincronizacionController, FotoController, CargasAppController]`.

`apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`:

1. `import { CargasService } from '../produccion/cargas.service';`
2. Al final del constructor:

```ts
    // T-27: Produccion es la duena de la carga del vendedor (pull y respuesta).
    private readonly cargas: CargasService,
```

3. En `pull`, agrega `cargas,` al final de la desestructuración (después de `promociones,`) y al final del
   `Promise.all`:

```ts
      // T-27: las cargas del vendedor. Por VENDEDOR, como la ruta.
      this.cargas.paraPull(vendedor.id, desde),
```

4. En el objeto que devuelve `pull`, después de `promociones,`, agrega `cargas,`.

`apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts` — reemplaza el cuerpo de `vendedores` por:

```ts
    let q = this.db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select([
        'vendedor.id as id',
        'vendedor.login as login',
        'vendedor.nombre as nombre',
        'vendedor.sucursal_id as sucursal_id',
        'vendedor.activo as activo',
        'vendedor.folio_segmento as folio_segmento',
        'vendedor.deleted_at as deleted_at',
        // T-27 (D7): la casilla es de la sucursal; cambiarla toca
        // `vendedor.updated_at` (SucursalesRepository.actualizar), asi que el
        // corte incremental de abajo la trae.
        'sucursal.control_inventario as control_inventario',
      ])
      .where('vendedor.id', '=', vendedorId);
    if (desde) q = q.where('vendedor.updated_at', '>', desde);

    return (await q.execute()).map((f) => ({
      id: f.id,
      login: f.login,
      nombre: f.nombre,
      sucursal_id: f.sucursal_id,
      // Lo asigna el servidor porque la tablet no puede: solo baja su propia
      // ficha, asi que no ve si otro vendedor comparte sus iniciales (T-14).
      folio_segmento: f.folio_segmento,
      control_inventario: f.control_inventario,
      activo: bandera(f.activo, f.deleted_at),
    }));
```

- [ ] **Paso 7: `docs/contrato-sincronizacion.md` (mismo commit que los dos `contrato.ts`)**

1. En el ejemplo de la respuesta `200` de §5, la línea de `"vendedores"` queda:

```jsonc
    "vendedores":     [{ "id": "…", "login": "…", "nombre": "…", "sucursal_id": "…",
                         "folio_segmento": "AP", "control_inventario": false, "activo": 1 }],
```

y la última línea del ejemplo (`"promociones": [ /* filas: ver la seccion promociones, abajo */ ]`) queda:

```jsonc
  "promociones": [ /* filas: ver la seccion promociones, abajo */ ],
  "cargas": [ /* filas: ver la seccion cargas, abajo */ ]
```

2. Después de la sección de nivel 3 titulada "`promociones`: las reglas de regalo (T-74)" (antes del `---` que abre
   §6), agrega **dos** secciones de nivel 3 (tres `#`; el título va fuera del bloque aquí solo para que el extractor de
   tareas no lo confunda con una sección del plan).

   Primera, titulada **`cargas`: la carga y las recargas del vendedor (T-27)**, con este texto:

````markdown
Colección **nueva y de nivel superior** (junto a `rutas`). Aditiva: una tablet vieja la ignora y sigue vendiendo como
hoy; la tablet nueva la trata como opcional.

- Producción captura la carga de la mañana y cada recarga en el portal (*Producción › Recarga*, `/cargas`). La tablet
  **no crea cargas**: las recibe y responde (abajo, §6).
- Solo cargas del **vendedor del token**, con `fecha >= current_date - 1` del reloj de Postgres (como `rutas`).
  Incremental por `updated_at > desde`; sin `desde`, solo las vivas. Una carga eliminada en el portal viaja con
  `activo: 0` y la tablet la saca del inventario y del aviso.
- `lineas` viene **completa** cada vez (la tablet reemplaza las suyas). Editar las líneas en el portal sube `version`
  y regresa la carga a `pendiente` (eso mueve `updated_at`, y vuelve a bajar).
- Una carga **aceptada** no se edita ni se elimina (D5): el inventario de la tablet nunca cambia por debajo.

```jsonc
{ "id": "…", "vendedor_id": "…", "fecha": "2026-10-22", "numero": 2, "estado": "pendiente",
  "motivo_rechazo": null, "version": 1, "respondida_en": null, "activo": 1,
  "lineas": [{ "presentacion_id": "…", "piezas": 24 }] }
```
````

   Segunda, titulada **`control_inventario` del vendedor (T-27)**, con este texto:

````markdown
`VendedorPull.control_inventario` es la casilla "Control de inventario en la app" de **su sucursal** (D7, apagada por
defecto). Prendida, la tablet no vende con una carga pendiente de hoy (D3) ni deja una presentación en negativo,
contando piezas vendidas más piezas regaladas (D4). Cambiar la casilla toca `updated_at` de los vendedores de esa
sucursal, así que baja en el pull incremental. Aditivo; un servidor anterior no lo manda y la tablet conserva lo que
tenía.
````

3. Después de la sección de nivel 3 "Fotos: subida y descarga (canal aparte del lote; T-40, T-39, T-30, T-73)" (antes
   de la sección "Respuesta `200` — parcial y honesta"), agrega una sección de nivel 3 titulada **Respuesta a una
   carga: `POST /sync/cargas/:id/respuesta` (T-27)**, con este texto (y en el título de la sección de fotos no cambies
   nada):

````markdown
Canal aparte del lote, como las fotos: sin `contrato` ni `resultados[]`, solo códigos HTTP. `@SoloApp`, con el mismo
`Authorization: Bearer` de siempre; **no renueva la sesión** por su cuenta (un `401` lo resuelve la tablet
sincronizando y reintentando una vez).

```jsonc
{ "version": 1, "accion": "aceptar" }                              // aceptar: sin motivo
{ "version": 1, "accion": "rechazar", "motivo": "Faltan 2 cajas" } // 1..300, se recorta
```

- **200** con la carga (`CargaPull`) ya respondida. La **misma** respuesta otra vez (reintento de red, doble toque) es
  200 sin reescribir nada.
- **400** si la forma no vale (`aceptar` con motivo, `rechazar` sin motivo o de más de 300).
- **404** si la carga es de otro vendedor, no existe o se eliminó (no confirma que exista). La tablet sincroniza.
- **409** `{ message, carga }` si la `version` ya no coincide (el portal la editó) o ya tiene otra respuesta. La tablet
  aplica la carga del cuerpo, sincroniza y pide revisarla de nuevo: **nunca acepta lo que no vio**.

Sin red no se puede aceptar (D6): la carga ocurre en la planta, con WiFi y con el almacenista enfrente.
````

4. En la tabla de §9 ("Qué NO está en este contrato"), agrega al final la fila:

```markdown
| Movimientos del día de la tablet (merma de 3 tipos, cambios físicos, consumo propio) y corte de inventario | **T-27** piezas 2 y 3 |
```

- [ ] **Paso 8: el e2e de la app**

`apps/backend/test/cargas-app.e2e-spec.ts`:

```ts
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
import type { CargaRejilla } from './../src/modules/produccion/reglas-carga';
import {
  CONTRATO_ACTUAL,
  type CargaPull,
  type RespuestaPull,
} from './../src/modules/sincronizacion/contrato';

/**
 * La carga en la app (T-27 pieza 1): baja en el pull, el vendedor la responde con
 * red (`POST /sync/cargas/:id/respuesta`) y `control_inventario` baja al cambiar
 * la casilla de su sucursal.
 *
 * Sucursal propia `ZK` (exclusiva de esta suite): prender su casilla no afecta a
 * TJ ni a MX. Las cargas se crean por el portal (Tarea 2), de HOY.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const CODIGO = 'ZK';
const PASSWORD = 'contrasena-del-vendedor';
const LOGIN = `e2e-carga-app-${SUFIJO}`;
const LOGIN_AJENO = `e2e-carga-app-a-${SUFIJO}`;
const LOGIN_GENERAL = `e2e-carga-app-gen-${SUFIJO}`;
const PRODUCTO = `ZZ-carga-app-${SUFIJO}`;

type Cuerpo = Record<string, unknown>;

describe('La carga en la app (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sucursalId: string;
  let usuarioId: string;
  let cookieGeneral: string;
  let vendedorId: string;
  let vendedorAjenoId: string;
  let bearer: string;
  let bearerAjeno: string;
  let productoId: string;
  let litro: string;
  let medio: string;
  let hoy: string;

  const entrar = async (login: string): Promise<string> =>
    (
      (
        await request(app.getHttpServer())
          .post('/auth/app/login')
          .send({ login, password: PASSWORD })
          .expect(200)
      ).body as { tokenAcceso: string }
    ).tokenAcceso;

  const pull = async (token: string, desde?: string): Promise<RespuestaPull> => {
    const params = new URLSearchParams({ contrato: String(CONTRATO_ACTUAL) });
    if (desde) params.set('desde', desde);
    const res = await request(app.getHttpServer())
      .get(`/sync/pull?${params.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as RespuestaPull;
  };

  const responder = (token: string, id: string, cuerpo: Cuerpo) =>
    request(app.getHttpServer())
      .post(`/sync/cargas/${id}/respuesta`)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo);

  const nuevaCarga = async (vendedor = vendedorId): Promise<CargaRejilla> =>
    (
      await request(app.getHttpServer())
        .post('/cargas')
        .set('Cookie', cookieGeneral)
        .send({ vendedorId: vendedor, lineas: [{ presentacionId: litro, piezas: 24 }] })
        .expect(201)
    ).body as CargaRejilla;

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
        .values({ codigo: CODIGO, nombre: 'Prueba carga app' })
        .onConflict((oc) =>
          oc
            .column('codigo')
            .doUpdateSet({ deleted_at: null, control_inventario: false }),
        )
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    hoy = (
      await sql<{ hoy: string }>`
        select to_char((now() at time zone 'America/Tijuana')::date, 'YYYY-MM-DD') as hoy
      `.execute(db)
    ).rows[0].hoy;

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
    cookieGeneral = cookies.find((c) => c.startsWith('jawa_access='))!.split(';')[0];

    const vendedor = async (loginVendedor: string, nombre: string) =>
      (
        await db
          .insertInto('vendedor')
          .values({
            login: loginVendedor,
            nombre,
            password_hash: hash,
            sucursal_id: sucursalId,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    vendedorId = await vendedor(LOGIN, 'Vendedor carga app');
    vendedorAjenoId = await vendedor(LOGIN_AJENO, 'Otro vendedor carga app');

    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: PRODUCTO })
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

    bearer = await entrar(LOGIN);
    bearerAjeno = await entrar(LOGIN_AJENO);
  });

  afterAll(async () => {
    const vendedores = [vendedorId, vendedorAjenoId];
    const cargas = db.selectFrom('carga').select('id').where('vendedor_id', 'in', vendedores);
    await db.deleteFrom('carga_detalle').where('carga_id', 'in', cargas).execute();
    await db.deleteFrom('carga').where('vendedor_id', 'in', vendedores).execute();
    await db.deleteFrom('presentacion').where('producto_id', '=', productoId).execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
    await db.deleteFrom('sesion_vendedor').where('vendedor_id', 'in', vendedores).execute();
    await db.deleteFrom('vendedor').where('id', 'in', vendedores).execute();
    await db.deleteFrom('sesion_refresh').where('usuario_id', '=', usuarioId).execute();
    await db.deleteFrom('usuario').where('id', '=', usuarioId).execute();
    await db.deleteFrom('sucursal').where('codigo', '=', CODIGO).execute();
    await app.close();
  });

  it('el pull completo trae solo sus cargas, con lineas, y control_inventario apagado', async () => {
    const carga = await nuevaCarga();
    const ajena = await nuevaCarga(vendedorAjenoId);
    const cuerpo = await pull(bearer);
    expect(cuerpo.cargas.find((c) => c.id === carga.id)).toEqual({
      id: carga.id,
      vendedor_id: vendedorId,
      fecha: hoy,
      numero: carga.numero,
      estado: 'pendiente',
      motivo_rechazo: null,
      version: 1,
      respondida_en: null,
      activo: 1,
      lineas: [{ presentacion_id: litro, piezas: 24 }],
    });
    expect(cuerpo.cargas.some((c) => c.id === ajena.id)).toBe(false);
    expect(cuerpo.catalogos.vendedores).toEqual([
      expect.objectContaining({ id: vendedorId, control_inventario: false }),
    ]);
  });

  it('aceptar escribe la respuesta; Review Focus 3: repetir la misma respuesta es 200 y no la reescribe', async () => {
    const carga = await nuevaCarga();
    const primera = (
      await responder(bearer, carga.id, { version: 1, accion: 'aceptar' }).expect(200)
    ).body as CargaPull;
    expect(primera).toMatchObject({
      id: carga.id,
      estado: 'aceptada',
      motivo_rechazo: null,
      version: 1,
      activo: 1,
    });
    expect(primera.respondida_en).not.toBeNull();

    const segunda = (
      await responder(bearer, carga.id, { version: 1, accion: 'aceptar' }).expect(200)
    ).body as CargaPull;
    expect(segunda.respondida_en).toBe(primera.respondida_en);
  });

  it('rechazar exige motivo (recortado) y aceptar no lleva motivo: 400', async () => {
    const carga = await nuevaCarga();
    for (const cuerpo of [
      { version: 1, accion: 'rechazar' },
      { version: 1, accion: 'rechazar', motivo: '   ' },
      { version: 1, accion: 'rechazar', motivo: 'x'.repeat(301) },
      { version: 1, accion: 'aceptar', motivo: 'Todo bien' },
      { version: 1, accion: 'devolver' },
      { accion: 'aceptar' },
    ]) {
      await responder(bearer, carga.id, cuerpo).expect(400);
    }
    const res = await responder(bearer, carga.id, {
      version: 1,
      accion: 'rechazar',
      motivo: '  Faltan 2 cajas de horchata  ',
    }).expect(200);
    expect(res.body as CargaPull).toMatchObject({
      estado: 'rechazada',
      motivo_rechazo: 'Faltan 2 cajas de horchata',
    });
  });

  it('Review Focus 2: aceptar con la versión vieja es 409 con la carga actual', async () => {
    const carga = await nuevaCarga();
    await request(app.getHttpServer())
      .patch(`/cargas/${carga.id}`)
      .set('Cookie', cookieGeneral)
      .send({ version: 1, lineas: [{ presentacionId: medio, piezas: 12 }] })
      .expect(200);

    const vieja = await responder(bearer, carga.id, {
      version: 1,
      accion: 'aceptar',
    }).expect(409);
    expect((vieja.body as { carga: CargaPull }).carga).toMatchObject({
      id: carga.id,
      version: 2,
      estado: 'pendiente',
      lineas: [{ presentacion_id: medio, piezas: 12 }],
    });
    const fila = await db
      .selectFrom('carga')
      .select('estado')
      .where('id', '=', carga.id)
      .executeTakeFirstOrThrow();
    expect(fila.estado).toBe('pendiente');

    await responder(bearer, carga.id, { version: 2, accion: 'aceptar' }).expect(200);
  });

  it('una carga ya respondida no cambia de respuesta: 409', async () => {
    const carga = await nuevaCarga();
    await responder(bearer, carga.id, {
      version: 1,
      accion: 'rechazar',
      motivo: 'Faltan cajas',
    }).expect(200);
    await responder(bearer, carga.id, { version: 1, accion: 'aceptar' }).expect(409);
  });

  it('la carga de otro vendedor o una que no existe es 404 (y no se toca)', async () => {
    const ajena = await nuevaCarga(vendedorAjenoId);
    await responder(bearer, ajena.id, { version: 1, accion: 'aceptar' }).expect(404);
    await responder(bearer, '00000000-0000-4000-8000-000000000000', {
      version: 1,
      accion: 'aceptar',
    }).expect(404);
    const fila = await db
      .selectFrom('carga')
      .select('estado')
      .where('id', '=', ajena.id)
      .executeTakeFirstOrThrow();
    expect(fila.estado).toBe('pendiente');
    // Su dueño si puede.
    await responder(bearerAjeno, ajena.id, { version: 1, accion: 'aceptar' }).expect(200);
  });

  it('Review Focus 4: una carga eliminada baja con activo 0 y responderla es 404', async () => {
    const carga = await nuevaCarga();
    const antes = (await pull(bearer)).servidor_en;
    await request(app.getHttpServer())
      .delete(`/cargas/${carga.id}`)
      .set('Cookie', cookieGeneral)
      .send({ version: 1 })
      .expect(200);

    const incremental = await pull(bearer, antes);
    expect(incremental.cargas.find((c) => c.id === carga.id)).toMatchObject({ activo: 0 });
    expect((await pull(bearer)).cargas.some((c) => c.id === carga.id)).toBe(false);
    await responder(bearer, carga.id, { version: 1, accion: 'aceptar' }).expect(404);
  });

  it('el pull incremental baja la respuesta', async () => {
    const carga = await nuevaCarga();
    const antes = (await pull(bearer)).servidor_en;
    await responder(bearer, carga.id, { version: 1, accion: 'aceptar' }).expect(200);
    const incremental = await pull(bearer, antes);
    expect(incremental.cargas.find((c) => c.id === carga.id)).toMatchObject({
      estado: 'aceptada',
      version: 1,
    });
  });

  it('control_inventario baja en el pull incremental al cambiar la casilla de su sucursal', async () => {
    const antes = (await pull(bearer)).servidor_en;
    await request(app.getHttpServer())
      .patch(`/sucursales/${sucursalId}`)
      .set('Cookie', cookieGeneral)
      .send({ controlInventario: true })
      .expect(200);
    const incremental = await pull(bearer, antes);
    expect(incremental.catalogos.vendedores).toEqual([
      expect.objectContaining({ id: vendedorId, control_inventario: true }),
    ]);
  });

  it('una cookie del portal no entra al endpoint de la app: 401', async () => {
    const carga = await nuevaCarga();
    await request(app.getHttpServer())
      .post(`/sync/cargas/${carga.id}/respuesta`)
      .set('Cookie', cookieGeneral)
      .send({ version: 1, accion: 'aceptar' })
      .expect(401);
  });
});
```

Corre:

```bash
npm run build --workspace=apps/backend
npm run test:e2e --workspace=apps/backend -- cargas-app.e2e cargas.e2e sincronizacion.e2e promociones-sync.e2e
```

Esperado: todo verde (las suites de sincronización existentes no cambian: `cargas` y `control_inventario` son
campos nuevos).

- [ ] **Paso 9: lint, typecheck de la tablet y commit**

```bash
npm exec --workspace=apps/backend -- prettier --write src/modules/produccion src/modules/sincronizacion test/cargas-app.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/produccion src/modules/sincronizacion test/cargas-app.e2e-spec.ts
npm test --workspace=apps/backend -- reglas-carga
npm run typecheck --workspace=apps/tablet
npm test --workspace=apps/tablet -- motor
git add apps/backend/src/modules/produccion apps/backend/src/modules/sincronizacion apps/backend/test/cargas-app.e2e-spec.ts apps/tablet/src/sincronizacion/contrato.ts docs/contrato-sincronizacion.md
git commit -m "T-27: la carga baja en el pull, el vendedor la responde con red y control_inventario viaja en su ficha

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 4: Portal: Producción › Recarga (rejilla) y la casilla de Catálogo › Sucursales (portal del spec, D1, D2, D5, D7, D8)

**Files:**
- Create: `apps/portal/src/lib/cargas.ts`
- Test: `apps/portal/src/lib/cargas.test.ts`
- Create: `apps/portal/src/components/produccion/rejilla-cargas.tsx`
- Create: `apps/portal/src/components/produccion/pantalla-recarga.tsx`
- Test: `apps/portal/src/components/produccion/pantalla-recarga.test.tsx`
- Modify: `apps/portal/src/app/(portal)/produccion/recarga/page.tsx` (reemplaza el `Placeholder`)
- Modify: `apps/portal/src/lib/sucursales.ts`, `apps/portal/src/components/sucursales/formulario-sucursal.tsx`,
  `apps/portal/src/components/sucursales/pantalla-sucursales.tsx`
- Test: `apps/portal/src/components/sucursales/pantalla-sucursales.test.tsx`
- Modify (solo fixtures de `Sucursal`, por el campo nuevo): `apps/portal/src/components/vendedores/pantalla-vendedores.test.tsx`,
  `components/promociones/pantalla-promociones.test.tsx`, `components/promociones/formulario-promocion.test.tsx`,
  `components/tesoreria/pestana-cuentas.test.tsx`, `components/usuarios/pantalla-usuarios.test.tsx`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /cargas` y `Sucursal.controlInventario` (Tarea 2); `apiFetch`, `mensajeDe`,
  `ErrorApi` (`lib/api.ts`); `listarSucursales`; `hoyEnTijuana` (`lib/ventas.ts`); `useAuth`.
- Produces:
  - `lib/cargas.ts` (copia de las formas de `reglas-carga.ts`): tipos `EstadoCarga`, `LineaCarga`,
    `PresentacionRejilla`, `CargaRejilla`, `VendedorRejilla`, `Rejilla`; `type Borrador = Record<string, string>`;
    `type Columna = { tipo: 'carga'; carga: CargaRejilla } | { tipo: 'nueva' } | { tipo: 'vacia' }`;
    `ETIQUETA_ESTADO`, `MAX_PIEZAS_LINEA`; `obtenerRejilla(fecha, sucursalId)`, `crearCarga({ vendedorId, lineas })`,
    `editarCarga(id, { version, lineas })`, `eliminarCarga(id, version)`; `borradorDe(carga | null): Borrador`,
    `leerBorrador(b): { lineas: LineaCarga[]; error: string | null }`, `totalBorrador(b): number`,
    `piezasDe(carga, presentacionId): number | null`, `totalPiezas(lineas): number`,
    `cargaEditable(carga, esHoy): boolean`, `columnasDeVendedor(vendedor, conNueva: boolean): Columna[]`.
  - `components/produccion/rejilla-cargas.tsx`: `export interface Edicion { vendedorId: string; carga: CargaRejilla |
    null; borrador: Borrador }` y `RejillaCargas`.
  - `components/produccion/pantalla-recarga.tsx`: `PantallaRecarga({ sucursal }: { sucursal: string | null })`.
  - `lib/sucursales.ts`: `Sucursal.controlInventario: boolean`; `editarSucursal(id, { nombre?, activa?,
    controlInventario? })`.

- [ ] **Paso 1: la prueba de la lógica, que falla**

`apps/portal/src/lib/cargas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  borradorDe,
  cargaEditable,
  columnasDeVendedor,
  leerBorrador,
  piezasDe,
  totalBorrador,
  totalPiezas,
  type CargaRejilla,
  type VendedorRejilla,
} from "./cargas";

const CARGA: CargaRejilla = {
  id: "c1",
  numero: 1,
  estado: "pendiente",
  motivoRechazo: null,
  version: 1,
  respondidaEn: null,
  lineas: [
    { presentacionId: "p1", piezas: 24 },
    { presentacionId: "p2", piezas: 12 },
  ],
};

describe("borrador de una carga (T-27)", () => {
  it("una carga nueva empieza vacia; una existente trae sus piezas como texto", () => {
    expect(borradorDe(null)).toEqual({});
    expect(borradorDe(CARGA)).toEqual({ p1: "24", p2: "12" });
  });

  it("leerBorrador: vacio o 0 no es linea; el resto son piezas enteras de 1 a 99 999", () => {
    expect(leerBorrador({ p1: " 30 ", p2: "", p3: "0" })).toEqual({
      lineas: [{ presentacionId: "p1", piezas: 30 }],
      error: null,
    });
    for (const malo of ["abc", "1.5", "-3", "100000"]) {
      expect(leerBorrador({ p1: malo })).toEqual({
        lineas: [],
        error: "Las piezas son enteras, de 1 a 99 999.",
      });
    }
    expect(leerBorrador({ p1: "", p2: "0" })).toEqual({
      lineas: [],
      error: "Captura al menos un producto.",
    });
  });

  it("totalBorrador suma solo lo legible", () => {
    expect(totalBorrador({ p1: "10", p2: "abc", p3: "5" })).toBe(15);
  });
});

describe("lectura de la rejilla", () => {
  it("piezasDe y totalPiezas", () => {
    expect(piezasDe(CARGA, "p2")).toBe(12);
    expect(piezasDe(CARGA, "p9")).toBeNull();
    expect(totalPiezas(CARGA.lineas)).toBe(36);
  });

  it("solo se edita una pendiente o rechazada de hoy (D5, D8)", () => {
    expect(cargaEditable(CARGA, true)).toBe(true);
    expect(cargaEditable({ ...CARGA, estado: "rechazada" }, true)).toBe(true);
    expect(cargaEditable({ ...CARGA, estado: "aceptada" }, true)).toBe(false);
    expect(cargaEditable(CARGA, false)).toBe(false);
  });

  it("columnasDeVendedor: sus cargas, la nueva al final, o una vacia", () => {
    const vendedor: VendedorRejilla = { id: "v1", nombre: "Ana", cargas: [CARGA] };
    expect(columnasDeVendedor(vendedor, false)).toEqual([{ tipo: "carga", carga: CARGA }]);
    expect(columnasDeVendedor(vendedor, true)).toEqual([
      { tipo: "carga", carga: CARGA },
      { tipo: "nueva" },
    ]);
    expect(columnasDeVendedor({ ...vendedor, cargas: [] }, false)).toEqual([{ tipo: "vacia" }]);
    expect(columnasDeVendedor({ ...vendedor, cargas: [] }, true)).toEqual([{ tipo: "nueva" }]);
  });
});
```

`npm test --workspace=apps/portal -- cargas` → falla al resolver `./cargas`.

- [ ] **Paso 2: `lib/cargas.ts`**

```ts
import { apiFetch } from "./api";

// Copia normativa de las formas de apps/backend/src/modules/produccion/reglas-carga.ts
// (`Rejilla`, `CargaRejilla`, ...). Mismo trato que lib/rutas.ts: un cambio de forma
// en un lado exige el equivalente en el otro.

export type EstadoCarga = "pendiente" | "aceptada" | "rechazada";

export interface LineaCarga {
  presentacionId: string;
  piezas: number;
}

export interface PresentacionRejilla {
  id: string;
  productoNombre: string;
  volumen: string;
  /** `false` = dada de baja: sale solo si una carga del dia la trae y no se captura. */
  activa: boolean;
}

export interface CargaRejilla {
  id: string;
  numero: number;
  estado: EstadoCarga;
  motivoRechazo: string | null;
  version: number;
  respondidaEn: string | null;
  lineas: LineaCarga[];
}

export interface VendedorRejilla {
  id: string;
  nombre: string;
  cargas: CargaRejilla[];
}

export interface Rejilla {
  fecha: string;
  sucursal: { id: string; codigo: string; nombre: string };
  presentaciones: PresentacionRejilla[];
  vendedores: VendedorRejilla[];
}

/** El mismo tope que valida el servidor. */
export const MAX_PIEZAS_LINEA = 99_999;

export const ETIQUETA_ESTADO: Record<EstadoCarga, string> = {
  pendiente: "Pendiente",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
};

export function obtenerRejilla(fecha: string, sucursalId: string): Promise<Rejilla> {
  const params = new URLSearchParams({ fecha, sucursal: sucursalId });
  return apiFetch<Rejilla>(`/cargas?${params.toString()}`);
}

/** La carga de HOY (D8): el numero lo pone el servidor. */
export function crearCarga(datos: { vendedorId: string; lineas: LineaCarga[] }): Promise<CargaRejilla> {
  return apiFetch<CargaRejilla>("/cargas", { method: "POST", body: JSON.stringify(datos) });
}

/** Reemplaza las lineas y la regresa a pendiente (D5); 409 si cambio o ya se acepto. */
export function editarCarga(
  id: string,
  datos: { version: number; lineas: LineaCarga[] },
): Promise<CargaRejilla> {
  return apiFetch<CargaRejilla>(`/cargas/${id}`, { method: "PATCH", body: JSON.stringify(datos) });
}

export function eliminarCarga(id: string, version: number): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/cargas/${id}`, {
    method: "DELETE",
    body: JSON.stringify({ version }),
  });
}

/** Lo que se teclea en la subcolumna editable: texto por presentacion. */
export type Borrador = Record<string, string>;

export function borradorDe(carga: CargaRejilla | null): Borrador {
  const borrador: Borrador = {};
  for (const l of carga?.lineas ?? []) borrador[l.presentacionId] = String(l.piezas);
  return borrador;
}

/**
 * Texto → lineas. Vacio o 0 no es linea (el almacenista solo llena lo que
 * entrega); cualquier otra cosa que no sea un entero de 1 a 99 999 es error.
 */
export function leerBorrador(borrador: Borrador): { lineas: LineaCarga[]; error: string | null } {
  const lineas: LineaCarga[] = [];
  for (const [presentacionId, texto] of Object.entries(borrador)) {
    const limpio = texto.trim();
    if (limpio === "" || /^0+$/.test(limpio)) continue;
    if (!/^\d+$/.test(limpio) || Number(limpio) > MAX_PIEZAS_LINEA) {
      return { lineas: [], error: "Las piezas son enteras, de 1 a 99 999." };
    }
    lineas.push({ presentacionId, piezas: Number(limpio) });
  }
  if (lineas.length === 0) return { lineas: [], error: "Captura al menos un producto." };
  return { lineas, error: null };
}

/** El total al pie mientras se edita: solo lo legible. */
export function totalBorrador(borrador: Borrador): number {
  return Object.values(borrador).reduce((total, texto) => {
    const limpio = texto.trim();
    return /^\d+$/.test(limpio) ? total + Number(limpio) : total;
  }, 0);
}

export function piezasDe(carga: CargaRejilla, presentacionId: string): number | null {
  return carga.lineas.find((l) => l.presentacionId === presentacionId)?.piezas ?? null;
}

export function totalPiezas(lineas: readonly LineaCarga[]): number {
  return lineas.reduce((total, l) => total + l.piezas, 0);
}

/** Pendiente o rechazada, y de hoy (D5, D8). El servidor lo vuelve a comprobar (409). */
export function cargaEditable(carga: CargaRejilla, esHoy: boolean): boolean {
  return esHoy && carga.estado !== "aceptada";
}

export type Columna = { tipo: "carga"; carga: CargaRejilla } | { tipo: "nueva" } | { tipo: "vacia" };

/** Las subcolumnas de un vendedor: sus cargas por numero, la nueva al final, o una vacia. */
export function columnasDeVendedor(vendedor: VendedorRejilla, conNueva: boolean): Columna[] {
  const columnas: Columna[] = vendedor.cargas.map((carga) => ({ tipo: "carga", carga }));
  if (conNueva) columnas.push({ tipo: "nueva" });
  return columnas.length > 0 ? columnas : [{ tipo: "vacia" }];
}
```

`npm test --workspace=apps/portal -- lib/cargas` → verde.

- [ ] **Paso 3: la prueba de la pantalla, que falla**

`apps/portal/src/components/produccion/pantalla-recarga.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as cargasLib from "@/lib/cargas";
import type { Rejilla } from "@/lib/cargas";
import * as sucursalesLib from "@/lib/sucursales";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaRecarga } from "./pantalla-recarga";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/sucursales");
vi.mock("@/lib/cargas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cargas")>();
  return {
    ...real,
    obtenerRejilla: vi.fn(),
    crearCarga: vi.fn(),
    editarCarga: vi.fn(),
    eliminarCarga: vi.fn(),
  };
});

const obtenerRejilla = vi.mocked(cargasLib.obtenerRejilla);
const crearCarga = vi.mocked(cargasLib.crearCarga);
const editarCarga = vi.mocked(cargasLib.editarCarga);
const eliminarCarga = vi.mocked(cargasLib.eliminarCarga);
const listarSucursales = vi.mocked(sucursalesLib.listarSucursales);
const HOY = hoyEnTijuana();

const REJILLA: Rejilla = {
  fecha: HOY,
  sucursal: { id: "s-tj", codigo: "TJ", nombre: "Tijuana" },
  presentaciones: [
    { id: "p2", productoNombre: "Jamaica", volumen: "500 ml", activa: true },
    { id: "p1", productoNombre: "Horchata", volumen: "1 L", activa: true },
  ],
  vendedores: [
    {
      id: "v1",
      nombre: "Abraham Pérez",
      cargas: [
        {
          id: "c1",
          numero: 1,
          estado: "aceptada",
          motivoRechazo: null,
          version: 1,
          respondidaEn: "2026-10-22T14:00:00.000Z",
          lineas: [{ presentacionId: "p1", piezas: 24 }],
        },
        {
          id: "c2",
          numero: 2,
          estado: "rechazada",
          motivoRechazo: "Faltan 2 cajas",
          version: 1,
          respondidaEn: "2026-10-22T17:00:00.000Z",
          lineas: [{ presentacionId: "p2", piezas: 12 }],
        },
      ],
    },
    {
      id: "v2",
      nombre: "Berta Ruiz",
      cargas: [
        {
          id: "c3",
          numero: 1,
          estado: "pendiente",
          motivoRechazo: null,
          version: 1,
          respondidaEn: null,
          lineas: [{ presentacionId: "p1", piezas: 10 }],
        },
      ],
    },
  ],
};

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: {
      id: "u1",
      login: "general",
      nombre: "General",
      perfil: "Administrador General",
      sucursal: null,
      permisos: [],
    },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede,
  });
}

describe("PantallaRecarga (T-27)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth(() => true);
    listarSucursales.mockResolvedValue([
      { id: "s-tj", codigo: "TJ", nombre: "Tijuana", activa: true, controlInventario: true },
      { id: "s-mx", codigo: "MX", nombre: "Mexicali", activa: true, controlInventario: false },
    ]);
    obtenerRejilla.mockResolvedValue(REJILLA);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sin carga.gestionar no muestra la rejilla", async () => {
    mockAuth(() => false);
    render(<PantallaRecarga sucursal={null} />);
    expect(await screen.findByText("No tienes permiso para registrar cargas.")).toBeInTheDocument();
    expect(obtenerRejilla).not.toHaveBeenCalled();
  });

  it("pinta las cargas del dia con su estado, sus piezas, el total y el motivo del rechazo", async () => {
    render(<PantallaRecarga sucursal={null} />);
    expect(await screen.findByText("Faltan 2 cajas")).toBeInTheDocument();
    expect(obtenerRejilla).toHaveBeenCalledWith(HOY, "s-tj");
    expect(screen.getByText("Aceptada")).toBeInTheDocument();
    expect(screen.getByText("Rechazada")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getAllByText("24").length).toBeGreaterThan(0);
    // Una aceptada no se edita ni se elimina (D5); la rechazada y la pendiente si.
    expect(
      screen.queryByRole("button", { name: "Editar la carga n.º 1 de Abraham Pérez" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Editar la carga n.º 2 de Abraham Pérez" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Eliminar la carga n.º 1 de Berta Ruiz" }),
    ).toBeInTheDocument();
  });

  it("Nueva carga abre una subcolumna editable y Guardar hace el POST", async () => {
    const usuario = userEvent.setup();
    crearCarga.mockResolvedValue(REJILLA.vendedores[1].cargas[0]);
    render(<PantallaRecarga sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: "Nueva carga para Berta Ruiz" }));
    await usuario.type(screen.getByLabelText("Berta Ruiz · Horchata 1 L"), "30");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(crearCarga).toHaveBeenCalledWith({
        vendedorId: "v2",
        lineas: [{ presentacionId: "p1", piezas: 30 }],
      }),
    );
    await waitFor(() => expect(obtenerRejilla).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("status")).toHaveTextContent("Carga guardada.");
  });

  it("Editar precarga las piezas y manda la version", async () => {
    const usuario = userEvent.setup();
    editarCarga.mockResolvedValue({ ...REJILLA.vendedores[1].cargas[0], version: 2 });
    render(<PantallaRecarga sucursal={null} />);
    await usuario.click(
      await screen.findByRole("button", { name: "Editar la carga n.º 1 de Berta Ruiz" }),
    );
    const campo = screen.getByLabelText("Berta Ruiz · Horchata 1 L") as HTMLInputElement;
    expect(campo.value).toBe("10");
    await usuario.clear(campo);
    await usuario.type(campo, "12");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(editarCarga).toHaveBeenCalledWith("c3", {
        version: 1,
        lineas: [{ presentacionId: "p1", piezas: 12 }],
      }),
    );
  });

  it("Eliminar pide confirmacion y manda la version", async () => {
    const usuario = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    eliminarCarga.mockResolvedValue({ id: "c3" });
    render(<PantallaRecarga sucursal={null} />);
    await usuario.click(
      await screen.findByRole("button", { name: "Eliminar la carga n.º 1 de Berta Ruiz" }),
    );
    expect(window.confirm).toHaveBeenCalledWith("¿Eliminar la carga n.º 1 de Berta Ruiz?");
    await waitFor(() => expect(eliminarCarga).toHaveBeenCalledWith("c3", 1));
  });

  it("un 409 muestra el mensaje del servidor", async () => {
    const usuario = userEvent.setup();
    editarCarga.mockRejectedValue(
      new ErrorApi(
        "fallo",
        409,
        "Una carga aceptada no se modifica: el vendedor ya la aceptó. Recarga la página.",
      ),
    );
    render(<PantallaRecarga sucursal={null} />);
    await usuario.click(
      await screen.findByRole("button", { name: "Editar la carga n.º 1 de Berta Ruiz" }),
    );
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Una carga aceptada no se modifica: el vendedor ya la aceptó. Recarga la página.",
    );
  });

  it("piezas que no son enteras no se mandan", async () => {
    const usuario = userEvent.setup();
    render(<PantallaRecarga sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: "Nueva carga para Berta Ruiz" }));
    await usuario.type(screen.getByLabelText("Berta Ruiz · Jamaica 500 ml"), "abc");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Las piezas son enteras, de 1 a 99 999.");
    expect(crearCarga).not.toHaveBeenCalled();
  });

  it("un dia anterior es de solo lectura (D8)", async () => {
    render(<PantallaRecarga sucursal={null} />);
    await screen.findByText("Faltan 2 cajas");
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-01-05" } });
    await waitFor(() => expect(obtenerRejilla).toHaveBeenLastCalledWith("2026-01-05", "s-tj"));
    expect(await screen.findByText(/solo lectura/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nueva carga/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar la carga/ })).not.toBeInTheDocument();
  });

  it("el selector global de sucursal elige la columna de MX", async () => {
    render(<PantallaRecarga sucursal="MX" />);
    await waitFor(() => expect(obtenerRejilla).toHaveBeenCalledWith(HOY, "s-mx"));
  });
});
```

`npm test --workspace=apps/portal -- pantalla-recarga` → falla al resolver `./pantalla-recarga`.

- [ ] **Paso 4: la rejilla**

`apps/portal/src/components/produccion/rejilla-cargas.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import {
  cargaEditable,
  columnasDeVendedor,
  ETIQUETA_ESTADO,
  piezasDe,
  totalBorrador,
  totalPiezas,
  type Borrador,
  type CargaRejilla,
  type Columna,
  type EstadoCarga,
  type PresentacionRejilla,
  type Rejilla,
  type VendedorRejilla,
} from "@/lib/cargas";

/** La subcolumna que se esta capturando: una carga existente o una nueva (`carga: null`). */
export interface Edicion {
  vendedorId: string;
  carga: CargaRejilla | null;
  borrador: Borrador;
}

interface Props {
  rejilla: Rejilla;
  esHoy: boolean;
  edicion: Edicion | null;
  ocupado: boolean;
  onNueva: (vendedorId: string) => void;
  onEditar: (vendedorId: string, carga: CargaRejilla) => void;
  onEliminar: (vendedorNombre: string, carga: CargaRejilla) => void;
  onPiezas: (presentacionId: string, texto: string) => void;
  onGuardar: () => void;
  onCancelar: () => void;
}

const PASTILLA: Record<EstadoCarga, string> = {
  pendiente: "border-amber-300 bg-amber-50 text-amber-800",
  aceptada: "border-emerald-300 bg-emerald-50 text-emerald-800",
  rechazada: "border-red-300 bg-red-50 text-red-800",
};

/*
 * Diseñada para 1366 px (≈1012 px de caja): la columna de presentación mide 192 px
 * (`w-48`) y cada subcolumna 112 px (`w-28`), así que caben 7 cargas sin desplazar;
 * con más, la tabla se desplaza de lado DENTRO de su caja (`w-0 min-w-full`) con la
 * presentación fija (`sticky left-0`) y el encabezado fijo (`thead sticky top-0`).
 * Medido en el navegador antes de cerrar la tarea.
 */
const TH = "border-b px-2 py-1.5 text-left align-top font-medium";
const CELDA = "w-28 min-w-28 border-b border-l px-2 py-1 text-right tabular-nums";
const FIJA = "sticky left-0 z-10 w-48 min-w-48 border-b bg-background px-2 py-1 text-left";

function enEdicion(columna: Columna, vendedor: VendedorRejilla, edicion: Edicion | null): boolean {
  if (edicion === null || edicion.vendedorId !== vendedor.id) return false;
  if (columna.tipo === "nueva") return true;
  return columna.tipo === "carga" && edicion.carga?.id === columna.carga.id;
}

function claveDe(vendedor: VendedorRejilla, columna: Columna): string {
  return columna.tipo === "carga" ? columna.carga.id : `${vendedor.id}-${columna.tipo}`;
}

export function RejillaCargas(props: Props) {
  const { rejilla, esHoy, edicion, ocupado } = props;
  // Una sola subcolumna editable a la vez: mientras se captura, lo demas se congela.
  const libre = esHoy && edicion === null && !ocupado;

  if (rejilla.vendedores.length === 0) {
    return <p className="text-sm text-muted-foreground">Esta sucursal no tiene vendedores activos.</p>;
  }

  const grupos = rejilla.vendedores.map((vendedor) => ({
    vendedor,
    columnas: columnasDeVendedor(
      vendedor,
      edicion !== null && edicion.vendedorId === vendedor.id && edicion.carga === null,
    ),
  }));

  function botonesEdicion() {
    return (
      <div className="mt-1 flex gap-1">
        <Button type="button" size="xs" disabled={ocupado} onClick={props.onGuardar}>
          {ocupado ? "Guardando…" : "Guardar"}
        </Button>
        <Button type="button" size="xs" variant="outline" disabled={ocupado} onClick={props.onCancelar}>
          Cancelar
        </Button>
      </div>
    );
  }

  function encabezado(vendedor: VendedorRejilla, columna: Columna) {
    const editando = enEdicion(columna, vendedor, edicion);
    if (columna.tipo === "vacia") {
      return <span className="font-normal text-muted-foreground">Sin cargas</span>;
    }
    if (columna.tipo === "nueva") {
      return (
        <>
          <span>Nueva</span>
          {botonesEdicion()}
        </>
      );
    }
    const { carga } = columna;
    return (
      <>
        <div className="flex items-center justify-between gap-1">
          <span>n.º {carga.numero}</span>
          <span className={`rounded-full border px-1.5 text-[11px] font-normal ${PASTILLA[carga.estado]}`}>
            {ETIQUETA_ESTADO[carga.estado]}
          </span>
        </div>
        {carga.estado === "rechazada" && carga.motivoRechazo ? (
          <p className="mt-0.5 whitespace-normal text-[11px] font-normal text-destructive">{carga.motivoRechazo}</p>
        ) : null}
        {editando ? (
          botonesEdicion()
        ) : cargaEditable(carga, esHoy) ? (
          <div className="mt-1 flex gap-1">
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={!libre}
              aria-label={`Editar la carga n.º ${carga.numero} de ${vendedor.nombre}`}
              onClick={() => props.onEditar(vendedor.id, carga)}
            >
              Editar
            </Button>
            <Button
              type="button"
              size="xs"
              variant="destructive"
              disabled={!libre}
              aria-label={`Eliminar la carga n.º ${carga.numero} de ${vendedor.nombre}`}
              onClick={() => props.onEliminar(vendedor.nombre, carga)}
            >
              Eliminar
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  function celda(vendedor: VendedorRejilla, columna: Columna, presentacion: PresentacionRejilla) {
    if (enEdicion(columna, vendedor, edicion) && edicion) {
      if (!presentacion.activa) return <span className="text-muted-foreground">—</span>;
      return (
        <input
          type="text"
          inputMode="numeric"
          aria-label={`${vendedor.nombre} · ${presentacion.productoNombre} ${presentacion.volumen}`}
          value={edicion.borrador[presentacion.id] ?? ""}
          disabled={ocupado}
          onChange={(e) => props.onPiezas(presentacion.id, e.target.value)}
          className="w-full rounded border px-1 py-0.5 text-right tabular-nums"
        />
      );
    }
    if (columna.tipo !== "carga") return null;
    const piezas = piezasDe(columna.carga, presentacion.id);
    return piezas === null ? <span className="text-muted-foreground">—</span> : piezas;
  }

  function total(vendedor: VendedorRejilla, columna: Columna) {
    if (enEdicion(columna, vendedor, edicion) && edicion) return totalBorrador(edicion.borrador);
    return columna.tipo === "carga" ? totalPiezas(columna.carga.lineas) : null;
  }

  /** Una rechazada queda resaltada hasta que se edite (spec, portal). */
  function fondo(vendedor: VendedorRejilla, columna: Columna): string {
    return columna.tipo === "carga" &&
      columna.carga.estado === "rechazada" &&
      !enEdicion(columna, vendedor, edicion)
      ? "bg-red-50"
      : "";
  }

  return (
    <div className="max-h-[70vh] w-0 min-w-full overflow-auto rounded-md border">
      <table aria-label="Cargas del día" className="border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-20 bg-background">
          <tr>
            <th rowSpan={2} scope="col" className={`${FIJA} z-30 font-medium`}>
              Presentación
            </th>
            {grupos.map(({ vendedor, columnas }) => (
              <th key={vendedor.id} colSpan={columnas.length} scope="colgroup" className={`${TH} border-l`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate" title={vendedor.nombre}>
                    {vendedor.nombre}
                  </span>
                  {esHoy ? (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={!libre}
                      aria-label={`Nueva carga para ${vendedor.nombre}`}
                      onClick={() => props.onNueva(vendedor.id)}
                    >
                      Nueva carga
                    </Button>
                  ) : null}
                </div>
              </th>
            ))}
          </tr>
          <tr>
            {grupos.flatMap(({ vendedor, columnas }) =>
              columnas.map((columna) => (
                <th
                  key={claveDe(vendedor, columna)}
                  scope="col"
                  className={`${TH} w-28 min-w-28 border-l ${fondo(vendedor, columna)}`}
                >
                  {encabezado(vendedor, columna)}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {rejilla.presentaciones.map((presentacion) => (
            <tr key={presentacion.id}>
              <th scope="row" className={`${FIJA} font-normal`}>
                {presentacion.productoNombre} {presentacion.volumen}
                {presentacion.activa ? "" : <span className="text-muted-foreground"> (baja)</span>}
              </th>
              {grupos.flatMap(({ vendedor, columnas }) =>
                columnas.map((columna) => (
                  <td key={claveDe(vendedor, columna)} className={`${CELDA} ${fondo(vendedor, columna)}`}>
                    {celda(vendedor, columna, presentacion)}
                  </td>
                )),
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className={`${FIJA} font-medium`}>
              Total de piezas
            </th>
            {grupos.flatMap(({ vendedor, columnas }) =>
              columnas.map((columna) => (
                <td key={claveDe(vendedor, columna)} className={`${CELDA} font-medium ${fondo(vendedor, columna)}`}>
                  {total(vendedor, columna)}
                </td>
              )),
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
```

- [ ] **Paso 5: la pantalla y la página**

`apps/portal/src/components/produccion/pantalla-recarga.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mensajeDe } from "@/lib/api";
import {
  borradorDe,
  crearCarga,
  editarCarga,
  eliminarCarga,
  leerBorrador,
  obtenerRejilla,
  type CargaRejilla,
  type Rejilla,
} from "@/lib/cargas";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import { hoyEnTijuana } from "@/lib/ventas";
import { RejillaCargas, type Edicion } from "./rejilla-cargas";

/**
 * Producción › Recarga (T-27 pieza 1, D1): el almacenista registra la carga de la
 * mañana y cada recarga de cada vendedor; la carga baja a la tablet y el vendedor
 * la acepta o la rechaza (D2). Una rechazada se corrige con "Editar" y vuelve a
 * llegarle. Días anteriores, solo lectura (D8).
 */
export function PantallaRecarga({ sucursal }: { sucursal: string | null }) {
  const { puede, cargando: cargandoSesion, usuario } = useAuth();
  const permitido = puede("carga.gestionar");
  const propia = usuario?.sucursal?.id ?? null;

  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [fecha, setFecha] = useState(hoyEnTijuana);
  const [rejilla, setRejilla] = useState<Rejilla | null>(null);
  const [vuelta, setVuelta] = useState(0);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const hoy = hoyEnTijuana();
  const esHoy = fecha === hoy;

  useEffect(() => {
    if (!permitido) return;
    let vigente = true;
    listarSucursales(null)
      .then((lista) => {
        if (!vigente) return;
        // Un usuario atado recibe solo la suya; un General elige (el selector
        // global de la barra, si viene, manda al abrir).
        const activas = lista.filter((s) => s.activa);
        setSucursales(activas);
        setSucursalId((actual) => {
          if (actual !== "" && activas.some((s) => s.id === actual)) return actual;
          const delSelector = activas.find((s) => s.codigo === sucursal?.toUpperCase());
          const deUsuario = activas.find((s) => s.id === propia);
          return (delSelector ?? deUsuario ?? activas[0])?.id ?? "";
        });
      })
      .catch(() => {
        if (vigente) setError("No se pudieron cargar las sucursales.");
      });
    return () => {
      vigente = false;
    };
  }, [permitido, sucursal, propia]);

  useEffect(() => {
    if (sucursalId === "") return;
    let vigente = true;
    setCargando(true);
    setError(null);
    obtenerRejilla(fecha, sucursalId)
      .then((r) => {
        if (vigente) setRejilla(r);
      })
      .catch((err: unknown) => {
        if (vigente) {
          setRejilla(null);
          setError(mensajeDe(err, "No se pudo cargar la recarga."));
        }
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [sucursalId, fecha, vuelta]);

  async function guardar() {
    if (!edicion) return;
    const { lineas, error: errorBorrador } = leerBorrador(edicion.borrador);
    if (errorBorrador !== null) {
      setError(errorBorrador);
      return;
    }
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      if (edicion.carga) {
        await editarCarga(edicion.carga.id, { version: edicion.carga.version, lineas });
      } else {
        await crearCarga({ vendedorId: edicion.vendedorId, lineas });
      }
      setEdicion(null);
      setAviso("Carga guardada. Le llega al vendedor cuando sincronice.");
      setVuelta((n) => n + 1);
    } catch (err) {
      // Un 409 trae el motivo del servidor (aceptada, de otro dia, editada por otro).
      setError(mensajeDe(err, "No se pudo guardar la carga. Vuelve a intentar."));
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(vendedorNombre: string, carga: CargaRejilla) {
    if (!window.confirm(`¿Eliminar la carga n.º ${carga.numero} de ${vendedorNombre}?`)) return;
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      await eliminarCarga(carga.id, carga.version);
      setAviso("Carga eliminada.");
      setVuelta((n) => n + 1);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo eliminar la carga."));
    } finally {
      setGuardando(false);
    }
  }

  if (cargandoSesion || !permitido) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recarga</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {cargandoSesion ? "Cargando…" : "No tienes permiso para registrar cargas."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const bloqueado = edicion !== null || guardando;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recarga</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="recarga-sucursal" className="text-sm font-medium">
              Sucursal
            </label>
            <select
              id="recarga-sucursal"
              value={sucursalId}
              disabled={bloqueado || sucursales.length <= 1}
              onChange={(e) => setSucursalId(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            >
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.codigo} · {s.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="recarga-fecha" className="text-sm font-medium">
              Fecha
            </label>
            <input
              id="recarga-fecha"
              type="date"
              value={fecha}
              max={hoy}
              disabled={bloqueado}
              onChange={(e) => {
                if (e.target.value !== "") setFecha(e.target.value);
              }}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>

        {!esHoy ? (
          <p className="text-sm text-muted-foreground">
            Día anterior: solo lectura. Las cargas se capturan el día en que sale el producto.
          </p>
        ) : null}
        {aviso ? (
          <p role="status" className="text-sm text-muted-foreground">
            {aviso}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {cargando && rejilla === null ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : rejilla ? (
          <RejillaCargas
            rejilla={rejilla}
            esHoy={esHoy}
            edicion={edicion}
            ocupado={guardando}
            onNueva={(vendedorId) => {
              setAviso(null);
              setEdicion({ vendedorId, carga: null, borrador: borradorDe(null) });
            }}
            onEditar={(vendedorId, carga) => {
              setAviso(null);
              setEdicion({ vendedorId, carga, borrador: borradorDe(carga) });
            }}
            onEliminar={(vendedorNombre, carga) => void eliminar(vendedorNombre, carga)}
            onPiezas={(presentacionId, texto) =>
              setEdicion((actual) =>
                actual ? { ...actual, borrador: { ...actual.borrador, [presentacionId]: texto } } : actual,
              )
            }
            onGuardar={() => void guardar()}
            onCancelar={() => {
              setEdicion(null);
              setError(null);
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
```

`apps/portal/src/app/(portal)/produccion/recarga/page.tsx` (reemplaza el contenido):

```tsx
import { PantallaRecarga } from "@/components/produccion/pantalla-recarga";

// Server component delgado (mismo patrón que /operacion/ruta-diaria): lee el
// selector global de sucursal y lo baja; toda la interacción vive en el cliente.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaRecarga sucursal={sucursal ?? null} />;
}
```

`npm test --workspace=apps/portal -- pantalla-recarga lib/cargas` → verde.

- [ ] **Paso 6: la casilla de Catálogo › Sucursales**

`apps/portal/src/lib/sucursales.ts`: en `interface Sucursal` agrega

```ts
  /** T-27 (D7): "Control de inventario en la app". */
  controlInventario: boolean;
```

y `editarSucursal` recibe `cambios: { nombre?: string; activa?: boolean; controlInventario?: boolean }`.

`apps/portal/src/components/sucursales/formulario-sucursal.tsx`:

1. Después de `const [activa, setActiva] = …`:

```tsx
  const [controlInventario, setControlInventario] = useState(sucursal?.controlInventario ?? false);
```

2. En `alEnviar`, la edición manda `editarSucursal(sucursal.id, { nombre, activa, controlInventario })`.
3. Después del bloque `{!esAlta && ( <label …> … Activa </label> )}`, agrega:

```tsx
      {!esAlta && (
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={controlInventario}
              disabled={enviando}
              onChange={(e) => setControlInventario(e.target.checked)}
            />
            Control de inventario en la app
          </label>
          <span className="text-xs text-muted-foreground">
            Al prenderla, los vendedores de esta sucursal necesitan aceptar su carga para vender y no pueden vender
            más de lo que traen.
          </span>
        </div>
      )}
```

`apps/portal/src/components/sucursales/pantalla-sucursales.tsx` — en `columnas`, después de la de "Estado":

```tsx
        {
          encabezado: "Inventario en la app",
          celda: (s) =>
            s.controlInventario ? (
              "Prendido"
            ) : (
              <span className="text-muted-foreground">Apagado</span>
            ),
        },
```

`apps/portal/src/components/sucursales/pantalla-sucursales.test.tsx`:

1. `const TIJUANA: Sucursal = { id: "1", codigo: "TJ", nombre: "Tijuana", activa: true, controlInventario: false };`
2. En el `crearSucursal.mockResolvedValue({ … })` de varias líneas, agrega `controlInventario: false,` después de
   `activa: true,`.
3. La expectativa de "edita una sucursal existente…" queda
   `expect(editarSucursal).toHaveBeenCalledWith("1", { nombre: "Tijuana Centro", activa: true, controlInventario: false })`.
4. Agrega al final del `describe`:

```tsx
  it("T-27: prende el control de inventario desde la edicion", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarSucursales.mockResolvedValueOnce([TIJUANA]);
    editarSucursal.mockResolvedValue({ ...TIJUANA, controlInventario: true });
    listarSucursales.mockResolvedValueOnce([{ ...TIJUANA, controlInventario: true }]);

    render(<PantallaSucursales sucursal={null} />);
    expect(await screen.findByText("Apagado")).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Editar" }));
    expect(
      screen.getByText(/necesitan aceptar su carga para vender/),
    ).toBeInTheDocument();
    await usuario.click(screen.getByLabelText("Control de inventario en la app"));
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(editarSucursal).toHaveBeenCalledWith("1", {
        nombre: "Tijuana",
        activa: true,
        controlInventario: true,
      }),
    );
    expect(await screen.findByText("Prendido")).toBeInTheDocument();
  });
```

Los demás fixtures de `Sucursal` (una línea cada uno) ganan el campo con:

```bash
sed -i '' -E 's/activa: (true|false) \}/activa: \1, controlInventario: false }/g' \
  apps/portal/src/components/sucursales/pantalla-sucursales.test.tsx \
  apps/portal/src/components/vendedores/pantalla-vendedores.test.tsx \
  apps/portal/src/components/promociones/pantalla-promociones.test.tsx \
  apps/portal/src/components/promociones/formulario-promocion.test.tsx \
  apps/portal/src/components/tesoreria/pestana-cuentas.test.tsx \
  apps/portal/src/components/usuarios/pantalla-usuarios.test.tsx
git diff --stat
```

(El punto 1 de arriba lo cubre también el `sed`; si ya lo editaste a mano, el `sed` no lo toca dos veces porque el
patrón exige `activa: true }` seguido de la llave.)

- [ ] **Paso 7: typecheck, lint, pruebas**

```bash
npx tsc --noEmit -p apps/portal
npm run lint --workspace=apps/portal
npm test --workspace=apps/portal
```

Esperado: sin errores de tipos (si `tsc` señala otro objeto `Sucursal` sin `controlInventario`, agrégale
`controlInventario: false`), lint limpio y toda la suite del portal verde.

- [ ] **Paso 8: commit**

```bash
git add apps/portal/src/lib/cargas.ts apps/portal/src/lib/cargas.test.ts apps/portal/src/components/produccion "apps/portal/src/app/(portal)/produccion/recarga/page.tsx" apps/portal/src/lib/sucursales.ts apps/portal/src/components/sucursales apps/portal/src/components/vendedores/pantalla-vendedores.test.tsx apps/portal/src/components/promociones apps/portal/src/components/tesoreria/pestana-cuentas.test.tsx apps/portal/src/components/usuarios/pantalla-usuarios.test.tsx
git commit -m "T-27 (portal): Producción › Recarga con la rejilla de cargas y la casilla de control de inventario

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

> **Controlador (navegador, al final de la tarea):** con el backend de esta rama contra el Postgres **local** (nunca
> `sinmex dev`; si `.env.development` apunta a la nube, cambia `DATABASE_URL` a `127.0.0.1:54322` solo en la sesión
> de la prueba) y el portal en `npm run portal`, entra como General a *Producción › Recarga*, captura una carga nueva,
> edítala, elimínala y comprueba el 409 aceptando una desde la base. Mide a **1366 × 768**: la caja no debe empujar
> el `main` (sin scroll horizontal de la página); con 8+ subcolumnas la rejilla se desplaza dentro de su caja con la
> columna "Presentación" fija y el encabezado fijo. Prende la casilla en *Catálogo › Sucursales* y vuelve a apagarla.

---

### Tarea 5: Tablet, datos: migración 017, mezcla del pull, reglas puras del inventario y candados en `ventas.registrar` (datos y repositorio del spec, D3, D4, D7, D10)

**Files:**
- Create: `apps/tablet/src/datos/migraciones/017-cargas.ts`
- Test: `apps/tablet/src/datos/migraciones/017-cargas.spec.ts`
- Modify: `apps/tablet/src/datos/migraciones/index.ts`, `apps/tablet/src/datos/migraciones/016-firma-venta.spec.ts`
  (deja de ser la última)
- Modify: `apps/tablet/src/datos/tipos.ts` (`EstadoCarga`, `Carga`, `CargaDetalle`, `Vendedor.control_inventario`)
- Create: `apps/tablet/src/datos/inventario-reglas.ts`
- Test: `apps/tablet/src/datos/inventario-reglas.spec.ts`
- Create: `apps/tablet/src/datos/repositorios/cargas.ts`
- Test: `apps/tablet/src/datos/repositorios/cargas.spec.ts`
- Modify: `apps/tablet/src/datos/repositorios/catalogos.ts` (snapshot `cargas`, `vendedor.control_inventario`, upsert)
- Modify: `apps/tablet/src/datos/repositorios/ventas.ts` (bloqueo y faltantes dentro de la transacción)
- Test: `apps/tablet/src/datos/repositorios/ventas.spec.ts`
- Modify: `apps/tablet/src/sincronizacion/motor.ts` (`aSnapshot`), test en `apps/tablet/src/sincronizacion/motor.spec.ts`
- Modify: `apps/tablet/src/datos/pruebas-apoyo.ts` (`respuestaPullDePrueba`), `apps/tablet/src/datos/inicializar.ts`,
  `apps/tablet/src/datos/index.ts`

**Interfaces:**
- Consumes: `CargaPull`/`VendedorPull.control_inventario`/`RespuestaPull.cargas` del contrato de la tablet (Tarea 3);
  `enTransaccion`, `DepsRepositorio`, `RepositorioCatalogos.publicarCambio`.
- Produces:
  - Migración 017: tablas locales `carga (id, vendedor_id, fecha, numero, estado, motivo_rechazo, version,
    respondida_en, activo, actualizado_en)`, `carga_detalle (carga_id, presentacion_id, piezas)` y
    `vendedor.control_inventario integer not null default 0`.
  - `tipos.ts`: `type EstadoCarga`, `interface Carga`, `interface CargaDetalle`, `Vendedor.control_inventario: Booleano`.
  - `src/datos/inventario-reglas.ts`: `MOTIVO_CARGA_PENDIENTE = 'Tienes una carga por aceptar'`;
    `interface CargaInventario { id; fecha; numero; estado: EstadoCarga; activo: Booleano; lineas: readonly
    { presentacion_id; piezas }[] }`; `interface LineaVentaInventario { fecha; presentacion_id; cantidad;
    cantidad_promocion }`; `interface Existencia { cargado; vendido; regalado; existencia }`;
    `interface PiezasDePresentacion { presentacionId: string; cantidad: number }`;
    `interface Faltante { presentacionId: string; faltan: number }`;
    `existencias(cargas, ventas, hoy): Map<string, Existencia>`;
    `cargaPendiente<C>(cargas: readonly C[], hoy): C | null`;
    `bloqueoDeVenta({ controlInventario, cargas, hoy }): string | null`;
    `faltantesDeVenta({ controlInventario, existencias, lineas, regalos }): Faltante[]`;
    `textoFaltante(etiqueta: string, faltan: number): string`.
  - `repositorios/cargas.ts`: `interface FilaCargaPull` (estructural, = `CargaPull`), `interface CargaConLineas
    extends Carga { lineas: LineaCargaConEtiqueta[] }`, `interface FilaInventario extends Existencia { presentacionId;
    etiqueta }`, `interface InventarioParaVenta { controlInventario: boolean; bloqueo: string | null; existencias:
    Map<string, Existencia> }`; `aplicarSnapshotCargas(bd, filas, actualizadoEn): number`;
    `leerInventarioDelDia(bd, vendedorId, fecha): { controlInventario: boolean; cargas: CargaInventario[]; ventas:
    LineaVentaInventario[] }`; `crearRepositorioCargas(deps, { catalogos })` con `delDia(vendedorId, fecha?)`,
    `porId(id)`, `pendienteDeHoy(vendedorId)`, `controlInventario(vendedorId)`, `paraVenta(vendedorId)`,
    `filasInventario(vendedorId)`, `aplicarRespuesta(fila: FilaCargaPull): void`; `type RepositorioCargas`.
  - `CapaDatos.cargas: RepositorioCargas`; `SnapshotCatalogos.cargas?: FilaCargaPull[]`.
  - `ventas.registrar()` lanza `ErrorVenta` con `"Tienes una carga por aceptar. Acéptala en Inventario antes de
    vender."` o `"No te alcanza el producto: <etiqueta>: faltan N piezas; …."`, sin grabar ni quemar folio.

- [ ] **Paso 1: la prueba de la migración 017, que falla**

`apps/tablet/src/datos/migraciones/017-cargas.spec.ts`:

```ts
import type { BaseDatos } from '../base-datos';
import { depsDePrueba, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from '../repositorios/catalogos';
import { migraciones, versionEsquema } from './index';

/**
 * La 017 trae la carga del vendedor (T-27 pieza 1): `carga` y `carga_detalle`,
 * que solo escribe el pull (la tablet no crea cargas), y la casilla
 * `vendedor.control_inventario`.
 */

function baseAlDia(): BaseDatos {
  const deps = depsDePrueba();
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
  return deps.bd;
}

function insertarCarga(bd: BaseDatos, cambios: Record<string, string | number | null> = {}) {
  const fila: Record<string, string | number | null> = {
    id: 'carga-1',
    vendedor_id: 'ven-1',
    fecha: '2026-08-07',
    numero: 1,
    estado: 'pendiente',
    version: 1,
    actualizado_en: '2026-08-07T15:00:00.000Z',
    ...cambios,
  };
  const columnas = Object.keys(fila);
  bd.runSync(
    `insert into carga (${columnas.join(', ')}) values (${columnas.map((c) => `$${c}`).join(', ')})`,
    Object.fromEntries(columnas.map((c) => [`$${c}`, fila[c] ?? null])),
  );
}

describe('migracion 017: cargas (T-27)', () => {
  it('la 017 es la ultima y deja versionEsquema en 17', () => {
    expect(migraciones[16]?.nombre).toBe('cargas');
    expect(migraciones[16]?.version).toBe(17);
    expect(migraciones).toHaveLength(17);
    expect(versionEsquema(baseAlDia())).toBe(17);
  });

  it('el vendedor que ya estaba queda con el control apagado', () => {
    const bd = baseAlDia();
    expect(
      bd.getFirstSync('select control_inventario from vendedor where id = $id', { $id: 'ven-1' }),
    ).toEqual({ control_inventario: 0 });
    expect(() => bd.execSync("update vendedor set control_inventario = 2 where id = 'ven-1'")).toThrow(
      /CHECK/,
    );
  });

  it('una carga nace viva, sin motivo ni respuesta; un estado que el servidor agregue no tumba el pull', () => {
    const bd = baseAlDia();
    insertarCarga(bd);
    expect(
      bd.getFirstSync('select activo, motivo_rechazo, respondida_en from carga where id = $id', {
        $id: 'carga-1',
      }),
    ).toEqual({ activo: 1, motivo_rechazo: null, respondida_en: null });
    expect(() => insertarCarga(bd, { id: 'carga-2', estado: 'estado-futuro' })).not.toThrow();
    expect(() => insertarCarga(bd, { id: 'carga-3', activo: 2 })).toThrow(/CHECK/);
  });

  it('el detalle cuelga de su carga, con piezas mayores que cero y una vez por presentacion', () => {
    const bd = baseAlDia();
    insertarCarga(bd);
    const linea = (piezas: number, presentacion = 'pre-1') =>
      bd.runSync(
        'insert into carga_detalle (carga_id, presentacion_id, piezas) values ($c, $p, $n)',
        { $c: 'carga-1', $p: presentacion, $n: piezas },
      );
    linea(24);
    expect(() => linea(5)).toThrow(/UNIQUE|PRIMARY/);
    expect(() => linea(0, 'pre-2')).toThrow(/CHECK/);
    expect(() =>
      bd.runSync(
        "insert into carga_detalle (carga_id, presentacion_id, piezas) values ('no-existe', 'pre-1', 1)",
      ),
    ).toThrow(/FOREIGN KEY/);
  });
});
```

En `apps/tablet/src/datos/migraciones/016-firma-venta.spec.ts`, la primera prueba queda:

```ts
  it('la 016 es firma-venta y deja de ser la ultima con la 017 (T-27)', () => {
    expect(migraciones[15]?.nombre).toBe('firma-venta');
    expect(migraciones[15]?.version).toBe(16);
    expect(versionEsquema(baseAlDia())).toBe(migraciones.length);
  });
```

`npm test --workspace=apps/tablet -- 017-cargas` → falla (`migraciones[16]` no existe).

- [ ] **Paso 2: la migración 017**

`apps/tablet/src/datos/migraciones/017-cargas.ts`:

```ts
import type { Migracion } from './motor';

/**
 * La carga y las recargas del vendedor en la tablet (T-27 pieza 1).
 *
 * - `carga` y `carga_detalle` las escribe **solo el pull** (y la respuesta del
 *   servidor al aceptar o rechazar, que trae la carga con la misma forma). La
 *   tablet no crea cargas (D1). La baja viaja como bandera (`activo = 0`).
 * - `estado` va **sin check** a proposito: si el servidor agregara uno, un check
 *   aqui haria fallar el pull entero (mismo criterio que `campo_egreso.tipo`).
 * - `carga.vendedor_id` sin llave foranea: la fila del vendedor existe desde el
 *   login, pero si faltara, la llave revertiria el pull completo. El detalle si
 *   cuelga de su carga; `presentacion_id` no, por la misma razon (una
 *   presentacion que todavia no baja no debe tumbar la carga).
 * - `actualizado_en`: cuando la tablet escribio la fila (pull o respuesta).
 * - `vendedor.control_inventario` (D7): la casilla de su sucursal, 0/1; nace en
 *   0 para que una tablet recien actualizada venda como hoy hasta el pull.
 *
 * Tablas nuevas y un `add column` con default: no rehace nada.
 */
export const cargas: Migracion = {
  version: 17,
  nombre: 'cargas',
  sql: `
    create table carga (
      id              text primary key,          -- id del servidor
      vendedor_id     text not null,
      fecha           text not null,             -- AAAA-MM-DD, hoy en Tijuana al capturarla (D8)
      numero          integer not null,
      estado          text not null,             -- pendiente | aceptada | rechazada
      motivo_rechazo  text,
      version         integer not null,
      respondida_en   text,
      activo          integer not null default 1 check (activo in (0, 1)),
      actualizado_en  text not null
    );
    -- Inventario, aviso y venta leen "las de hoy" del vendedor.
    create index idx_carga_vendedor_fecha on carga (vendedor_id, fecha);

    create table carga_detalle (
      carga_id        text not null references carga(id),
      presentacion_id text not null,
      piezas          integer not null check (piezas > 0),
      primary key (carga_id, presentacion_id)
    );

    alter table vendedor add column control_inventario integer not null default 0
      check (control_inventario in (0, 1));
  `,
};
```

En `apps/tablet/src/datos/migraciones/index.ts`: `import { cargas } from './017-cargas';` y `cargas,` al final de
`migraciones` (después de `firmaVenta,`).

`npm test --workspace=apps/tablet -- migraciones` → verde.

- [ ] **Paso 3: tipos locales**

En `apps/tablet/src/datos/tipos.ts`:

1. En `interface Vendedor`, después de `folio_segmento`:

```ts
  /**
   * T-27 (D7): el control de inventario de su sucursal (0/1). Prendido, no se
   * vende con una carga pendiente de hoy ni se deja una presentacion en
   * negativo. Baja en el pull; el login sin red no lo pisa.
   */
  control_inventario: Booleano;
```

2. Al final del archivo:

```ts
/** Estado de una carga (T-27). Sin check en SQLite: ver la migracion 017. */
export type EstadoCarga = 'pendiente' | 'aceptada' | 'rechazada';

/**
 * Una carga (la de la manana o una recarga) que produccion registro en el
 * portal (T-27). La escribe el pull o la respuesta del servidor; la tablet no
 * crea cargas ni cambia sus lineas.
 */
export interface Carga {
  id: string;
  vendedor_id: string;
  fecha: FechaISO;
  numero: number;
  estado: EstadoCarga;
  motivo_rechazo: string | null;
  version: number;
  respondida_en: MomentoISO | null;
  activo: Booleano;
  /** Cuando la tablet escribio la fila (pull o respuesta). */
  actualizado_en: MomentoISO;
}

export interface CargaDetalle {
  carga_id: string;
  presentacion_id: string;
  piezas: number;
}
```

- [ ] **Paso 4: la prueba de las reglas puras, que falla**

`apps/tablet/src/datos/inventario-reglas.spec.ts`:

```ts
import {
  bloqueoDeVenta,
  cargaPendiente,
  existencias,
  faltantesDeVenta,
  MOTIVO_CARGA_PENDIENTE,
  textoFaltante,
  type CargaInventario,
  type LineaVentaInventario,
} from './inventario-reglas';

/**
 * El inventario del vendedor (T-27 pieza 1), sin SQLite: lo que trae
 * (cargas aceptadas de hoy) menos lo que vendio y regalo hoy.
 */

const HOY = '2026-10-22';

function carga(extra: Partial<CargaInventario> = {}): CargaInventario {
  return {
    id: 'c-1',
    fecha: HOY,
    numero: 1,
    estado: 'aceptada',
    activo: 1,
    lineas: [{ presentacion_id: 'horchata', piezas: 20 }],
    ...extra,
  };
}

function venta(extra: Partial<LineaVentaInventario> = {}): LineaVentaInventario {
  return { fecha: HOY, presentacion_id: 'horchata', cantidad: 5, cantidad_promocion: 1, ...extra };
}

describe('existencias', () => {
  it('cargado − vendido − regalado, solo con cargas aceptadas, vivas y de hoy', () => {
    const e = existencias(
      [
        carga(),
        carga({ id: 'c-2', numero: 2, lineas: [{ presentacion_id: 'horchata', piezas: 10 }, { presentacion_id: 'jamaica', piezas: 6 }] }),
        carga({ id: 'c-3', numero: 3, estado: 'pendiente' }),
        carga({ id: 'c-4', numero: 4, estado: 'rechazada' }),
        carga({ id: 'c-5', numero: 5, activo: 0 }),
        carga({ id: 'c-6', fecha: '2026-10-21' }),
      ],
      [venta(), venta({ cantidad: 3, cantidad_promocion: 0 }), venta({ fecha: '2026-10-21', cantidad: 50 })],
      HOY,
    );
    expect(e.get('horchata')).toEqual({ cargado: 30, vendido: 8, regalado: 1, existencia: 21 });
    expect(e.get('jamaica')).toEqual({ cargado: 6, vendido: 0, regalado: 0, existencia: 6 });
  });

  it('lo vendido sin carga queda en negativo (venta con el control apagado)', () => {
    expect(existencias([], [venta({ presentacion_id: 'tamarindo', cantidad: 4, cantidad_promocion: 0 })], HOY).get('tamarindo')).toEqual({
      cargado: 0,
      vendido: 4,
      regalado: 0,
      existencia: -4,
    });
  });
});

describe('cargaPendiente', () => {
  it('la pendiente viva de hoy de menor numero', () => {
    const pendientes = [
      carga({ id: 'c-3', numero: 3, estado: 'pendiente' }),
      carga({ id: 'c-2', numero: 2, estado: 'pendiente' }),
      carga({ id: 'c-1', numero: 1 }),
    ];
    expect(cargaPendiente(pendientes, HOY)?.id).toBe('c-2');
  });

  it('ni una dada de baja ni una de ayer cuentan', () => {
    expect(
      cargaPendiente(
        [
          carga({ estado: 'pendiente', activo: 0 }),
          carga({ id: 'c-2', estado: 'pendiente', fecha: '2026-10-21' }),
        ],
        HOY,
      ),
    ).toBeNull();
  });
});

describe('bloqueoDeVenta (D3)', () => {
  it('con el control prendido y una carga pendiente de hoy: "Tienes una carga por aceptar"', () => {
    expect(bloqueoDeVenta({ controlInventario: true, cargas: [carga({ estado: 'pendiente' })], hoy: HOY })).toBe(
      MOTIVO_CARGA_PENDIENTE,
    );
    expect(MOTIVO_CARGA_PENDIENTE).toBe('Tienes una carga por aceptar');
  });

  it('sin pendiente no bloquea', () => {
    expect(bloqueoDeVenta({ controlInventario: true, cargas: [carga()], hoy: HOY })).toBeNull();
  });
});

describe('faltantesDeVenta (D4, D10)', () => {
  const disponibles = existencias([carga()], [], HOY);

  it('cuentan las piezas vendidas MAS las regaladas', () => {
    expect(
      faltantesDeVenta({
        controlInventario: true,
        existencias: disponibles,
        lineas: [{ presentacionId: 'horchata', cantidad: 20 }],
        regalos: [{ presentacionId: 'horchata', cantidad: 2 }],
      }),
    ).toEqual([{ presentacionId: 'horchata', faltan: 2 }]);
  });

  it('lo que alcanza no falta; lo que no se cargo falta completo; una existencia negativa cuenta como 0', () => {
    const conNegativa = existencias([carga()], [venta({ presentacion_id: 'jamaica', cantidad: 3, cantidad_promocion: 0 })], HOY);
    expect(
      faltantesDeVenta({
        controlInventario: true,
        existencias: conNegativa,
        lineas: [
          { presentacionId: 'horchata', cantidad: 20 },
          { presentacionId: 'jamaica', cantidad: 1 },
          { presentacionId: 'tamarindo', cantidad: 0 },
        ],
        regalos: [{ presentacionId: 'limonada', cantidad: 2 }],
      }),
    ).toEqual([
      { presentacionId: 'jamaica', faltan: 1 },
      { presentacionId: 'limonada', faltan: 2 },
    ]);
  });

  it('una venta de solo regalo tambien necesita piezas (D10)', () => {
    expect(
      faltantesDeVenta({
        controlInventario: true,
        existencias: new Map(),
        lineas: [],
        regalos: [{ presentacionId: 'horchata', cantidad: 2 }],
      }),
    ).toEqual([{ presentacionId: 'horchata', faltan: 2 }]);
  });

  it('una cantidad ilegible (NaN) no cuenta como pedida', () => {
    expect(
      faltantesDeVenta({
        controlInventario: true,
        existencias: new Map(),
        lineas: [{ presentacionId: 'horchata', cantidad: Number.NaN }],
        regalos: [],
      }),
    ).toEqual([]);
  });

  it('textoFaltante, en singular y plural', () => {
    expect(textoFaltante('Horchata 1 L', 3)).toBe('Horchata 1 L: faltan 3 piezas');
    expect(textoFaltante('Horchata 1 L', 1)).toBe('Horchata 1 L: falta 1 pieza');
  });
});

describe('Review Focus 5: con el control apagado no hay bloqueo ni faltantes', () => {
  it('aunque haya una carga pendiente y la venta pase lo que trae', () => {
    expect(bloqueoDeVenta({ controlInventario: false, cargas: [carga({ estado: 'pendiente' })], hoy: HOY })).toBeNull();
    expect(
      faltantesDeVenta({
        controlInventario: false,
        existencias: new Map(),
        lineas: [{ presentacionId: 'horchata', cantidad: 500 }],
        regalos: [{ presentacionId: 'horchata', cantidad: 50 }],
      }),
    ).toEqual([]);
  });
});
```

`npm test --workspace=apps/tablet -- inventario-reglas` → falla al resolver `./inventario-reglas`.

- [ ] **Paso 5: las reglas puras**

`apps/tablet/src/datos/inventario-reglas.ts`:

```ts
import type { Booleano, EstadoCarga, FechaISO } from './tipos';

/**
 * El inventario del vendedor (T-27 pieza 1), sin SQLite ni React.
 *
 * Viven en `src/datos/` (como `ventas-reglas.ts`) porque el repositorio de
 * ventas las vuelve a calcular DENTRO de su transaccion, y `src/datos/` no
 * importa de `src/estado/`. `src/estado/inventario.ts` las reexporta para las
 * pantallas, junto con lo que solo es de pantalla.
 *
 * Todo en piezas (spec, proceso del negocio). Solo cuentan las cargas
 * **aceptadas** (D6: el servidor las confirmo) y lo de **hoy**.
 */

export const MOTIVO_CARGA_PENDIENTE = 'Tienes una carga por aceptar';

export interface LineaCargaInventario {
  presentacion_id: string;
  piezas: number;
}

/** Lo que el inventario necesita de una carga (una `CargaConLineas` sirve tal cual). */
export interface CargaInventario {
  id: string;
  fecha: FechaISO;
  numero: number;
  estado: EstadoCarga;
  activo: Booleano;
  lineas: readonly LineaCargaInventario[];
}

/** Una linea de venta con la fecha de su venta. */
export interface LineaVentaInventario {
  fecha: FechaISO;
  presentacion_id: string;
  cantidad: number;
  cantidad_promocion: number;
}

export interface Existencia {
  cargado: number;
  vendido: number;
  regalado: number;
  /** cargado − vendido − regalado. Puede ser negativa si se vendio con el control apagado. */
  existencia: number;
}

export interface PiezasDePresentacion {
  presentacionId: string;
  cantidad: number;
}

export interface Faltante {
  presentacionId: string;
  faltan: number;
}

/**
 * Por presentacion: lo cargado (cargas **aceptadas** y vivas de `hoy`) menos lo
 * vendido y lo regalado en las ventas de `hoy` (D10: el regalo tambien sale de
 * la camioneta).
 */
export function existencias(
  cargas: readonly CargaInventario[],
  ventas: readonly LineaVentaInventario[],
  hoy: FechaISO,
): Map<string, Existencia> {
  const mapa = new Map<string, Existencia>();
  const de = (presentacionId: string): Existencia => {
    let e = mapa.get(presentacionId);
    if (!e) {
      e = { cargado: 0, vendido: 0, regalado: 0, existencia: 0 };
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
  for (const e of mapa.values()) e.existencia = e.cargado - e.vendido - e.regalado;
  return mapa;
}

/** La carga pendiente y viva de `hoy` de menor numero (la que se acepta primero), o `null`. */
export function cargaPendiente<C extends Pick<CargaInventario, 'fecha' | 'numero' | 'estado' | 'activo'>>(
  cargas: readonly C[],
  hoy: FechaISO,
): C | null {
  let pendiente: C | null = null;
  for (const c of cargas) {
    if (c.estado !== 'pendiente' || c.activo !== 1 || c.fecha !== hoy) continue;
    if (pendiente === null || c.numero < pendiente.numero) pendiente = c;
  }
  return pendiente;
}

/**
 * D3: con el control prendido y una carga pendiente de hoy, no se vende.
 * Devuelve el motivo o `null`. Apagado (D7), nunca bloquea.
 */
export function bloqueoDeVenta({
  controlInventario,
  cargas,
  hoy,
}: {
  controlInventario: boolean;
  cargas: readonly Pick<CargaInventario, 'fecha' | 'numero' | 'estado' | 'activo'>[];
  hoy: FechaISO;
}): string | null {
  if (!controlInventario) return null;
  return cargaPendiente(cargas, hoy) === null ? null : MOTIVO_CARGA_PENDIENTE;
}

/**
 * D4: lo que le falta a una venta para no dejar ninguna presentacion en
 * negativo, contando piezas vendidas (`lineas`) MAS regaladas (`regalos`).
 * Una existencia negativa cuenta como 0. Vacio si el control esta apagado.
 * En el orden en que aparecen las presentaciones.
 */
export function faltantesDeVenta({
  controlInventario,
  existencias: disponibles,
  lineas,
  regalos,
}: {
  controlInventario: boolean;
  existencias: ReadonlyMap<string, Existencia>;
  lineas: readonly PiezasDePresentacion[];
  regalos: readonly PiezasDePresentacion[];
}): Faltante[] {
  if (!controlInventario) return [];
  const pedidas = new Map<string, number>();
  for (const p of [...lineas, ...regalos]) {
    // `!(x > 0)` y no `x <= 0`: una cantidad ilegible (NaN) no es un pedido.
    if (!(p.cantidad > 0)) continue;
    pedidas.set(p.presentacionId, (pedidas.get(p.presentacionId) ?? 0) + p.cantidad);
  }
  const faltantes: Faltante[] = [];
  for (const [presentacionId, pedido] of pedidas) {
    const hay = Math.max(0, disponibles.get(presentacionId)?.existencia ?? 0);
    if (pedido > hay) faltantes.push({ presentacionId, faltan: pedido - hay });
  }
  return faltantes;
}

/** "Horchata 1 L: faltan 3 piezas" (spec, revision de la venta). */
export function textoFaltante(etiqueta: string, faltan: number): string {
  return `${etiqueta}: ${faltan === 1 ? 'falta 1 pieza' : `faltan ${faltan} piezas`}`;
}
```

`npm test --workspace=apps/tablet -- inventario-reglas` → verde.

- [ ] **Paso 6: la prueba del repositorio de cargas, que falla**

`apps/tablet/src/datos/repositorios/cargas.spec.ts`:

```ts
import { depsDePrueba, FIRMA_DE_PRUEBA, MOMENTO, snapshotDePrueba } from '../pruebas-apoyo';
import type { Booleano, EstadoCarga } from '../tipos';
import { aplicarSnapshotCargas, crearRepositorioCargas, type FilaCargaPull } from './cargas';
import { crearRepositorioCatalogos } from './catalogos';
import { crearRepositorioFolios } from './folios';
import { crearRepositorioVentas } from './ventas';

/**
 * Las cargas en la tablet (T-27): la mezcla del pull, el inventario del dia y la
 * casilla del vendedor. `MOMENTO` es el 2026-08-07.
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
    cargas: crearRepositorioCargas(deps, { catalogos }),
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
  };
}

function fila(extra: Partial<FilaCargaPull> = {}): FilaCargaPull {
  const estado: EstadoCarga = extra.estado ?? 'pendiente';
  return {
    id: 'carga-1',
    vendedor_id: 'ven-1',
    fecha: HOY,
    numero: 1,
    estado,
    motivo_rechazo: estado === 'rechazada' ? 'Faltan cajas' : null,
    version: 1,
    respondida_en: estado === 'pendiente' ? null : MOMENTO,
    activo: 1 as Booleano,
    lineas: [
      { presentacion_id: 'pre-1', piezas: 24 },
      { presentacion_id: 'pre-2', piezas: 12 },
    ],
    ...extra,
  };
}

describe('aplicarSnapshotCargas (mezcla del pull)', () => {
  it('escribe la carga y sus lineas; la segunda vez reemplaza las lineas sin duplicar', () => {
    const { deps, cargas } = montar();
    expect(aplicarSnapshotCargas(deps.bd, [fila()], MOMENTO)).toBe(1);
    expect(cargas.porId('carga-1')).toMatchObject({
      estado: 'pendiente',
      version: 1,
      actualizado_en: MOMENTO,
      lineas: [
        { presentacion_id: 'pre-1', piezas: 24, etiqueta: 'Jamaica 1 L' },
        { presentacion_id: 'pre-2', piezas: 12, etiqueta: 'Jamaica 500 ml' },
      ],
    });

    aplicarSnapshotCargas(
      deps.bd,
      [fila({ version: 2, lineas: [{ presentacion_id: 'pre-2', piezas: 6 }] })],
      MOMENTO,
    );
    expect(cargas.porId('carga-1')?.lineas.map((l) => [l.presentacion_id, l.piezas])).toEqual([
      ['pre-2', 6],
    ]);
  });

  it('una presentacion que la tablet no conoce no tumba el pull', () => {
    const { deps, cargas } = montar();
    aplicarSnapshotCargas(deps.bd, [fila({ lineas: [{ presentacion_id: 'pre-nueva', piezas: 3 }] })], MOMENTO);
    expect(cargas.porId('carga-1')?.lineas[0]?.etiqueta).toBe('Producto fuera del catálogo');
  });

  it('un pull que salio antes de la respuesta no la deshace (misma version)', () => {
    const { deps, cargas } = montar();
    aplicarSnapshotCargas(deps.bd, [fila({ estado: 'aceptada' })], MOMENTO);
    expect(aplicarSnapshotCargas(deps.bd, [fila()], MOMENTO)).toBe(0);
    expect(cargas.porId('carga-1')?.estado).toBe('aceptada');
  });

  it('una version vieja no pisa a una nueva, y una baja es final', () => {
    const { deps, cargas } = montar();
    aplicarSnapshotCargas(deps.bd, [fila({ version: 2, lineas: [{ presentacion_id: 'pre-1', piezas: 30 }] })], MOMENTO);
    aplicarSnapshotCargas(deps.bd, [fila({ version: 1 })], MOMENTO);
    expect(cargas.porId('carga-1')?.version).toBe(2);

    aplicarSnapshotCargas(deps.bd, [fila({ version: 2, activo: 0 })], MOMENTO);
    aplicarSnapshotCargas(deps.bd, [fila({ version: 2 })], MOMENTO);
    expect(cargas.porId('carga-1')?.activo).toBe(0);
  });

  it('catalogos.guardarSnapshot aplica las cargas del pull y avisa del cambio', () => {
    const { catalogos, cargas } = montar();
    const antes = catalogos.version();
    catalogos.guardarSnapshot({ cargas: [fila()] });
    expect(catalogos.version()).toBe(antes + 1);
    expect(cargas.pendienteDeHoy('ven-1')?.id).toBe('carga-1');
  });
});

describe('el inventario del dia', () => {
  it('delDia: las vivas de hoy por numero; pendienteDeHoy: la de menor numero', () => {
    const { deps, cargas } = montar();
    aplicarSnapshotCargas(
      deps.bd,
      [
        fila({ id: 'c-2', numero: 2 }),
        fila({ id: 'c-1', numero: 1, estado: 'aceptada' }),
        fila({ id: 'c-3', numero: 3 }),
        fila({ id: 'c-ayer', fecha: '2026-08-06' }),
      ],
      MOMENTO,
    );
    expect(cargas.delDia('ven-1').map((c) => c.id)).toEqual(['c-1', 'c-2', 'c-3']);
    expect(cargas.pendienteDeHoy('ven-1')?.id).toBe('c-2');
  });

  it('Review Focus 4: una carga dada de baja sale del inventario y del aviso', () => {
    const { deps, cargas } = montar();
    aplicarSnapshotCargas(deps.bd, [fila(), fila({ id: 'c-ok', numero: 2, estado: 'aceptada' })], MOMENTO);
    expect(cargas.pendienteDeHoy('ven-1')?.id).toBe('carga-1');

    aplicarSnapshotCargas(deps.bd, [fila({ activo: 0 }), fila({ id: 'c-ok', numero: 2, estado: 'aceptada', activo: 0 })], MOMENTO);
    expect(cargas.pendienteDeHoy('ven-1')).toBeNull();
    expect(cargas.delDia('ven-1')).toEqual([]);
    expect(cargas.filasInventario('ven-1')).toEqual([]);
  });

  it('filasInventario: cargado − vendido − regalado por presentacion, con su nombre', () => {
    const { deps, cargas, ventas } = montar();
    aplicarSnapshotCargas(deps.bd, [fila({ estado: 'aceptada' })], MOMENTO);
    ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '',
      contadoCredito: 'contado',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 10, cantidadPromocion: 1 }],
      regalos: [{ promocionId: 'promo-general', presentacionId: 'pre-1', cantidad: 1, texto: 'Por cada 10 Jamaica, 1 Jamaica gratis' }],
      firma: FIRMA_DE_PRUEBA,
    });
    expect(cargas.filasInventario('ven-1')).toEqual([
      { presentacionId: 'pre-1', etiqueta: 'Jamaica 1 L', cargado: 24, vendido: 10, regalado: 1, existencia: 13 },
      { presentacionId: 'pre-2', etiqueta: 'Jamaica 500 ml', cargado: 12, vendido: 0, regalado: 0, existencia: 12 },
    ]);
  });

  it('paraVenta: control, bloqueo y existencias del momento', () => {
    const { deps, cargas } = montar();
    aplicarSnapshotCargas(deps.bd, [fila()], MOMENTO);
    expect(cargas.paraVenta('ven-1')).toEqual({ controlInventario: false, bloqueo: null, existencias: new Map() });

    deps.bd.runSync("update vendedor set control_inventario = 1 where id = 'ven-1'");
    expect(cargas.paraVenta('ven-1').bloqueo).toBe('Tienes una carga por aceptar');
  });

  it('aplicarRespuesta escribe la carga que contesto el servidor y avisa a las pantallas', () => {
    const { catalogos, cargas, deps } = montar();
    aplicarSnapshotCargas(deps.bd, [fila()], MOMENTO);
    const antes = catalogos.version();
    cargas.aplicarRespuesta(fila({ estado: 'aceptada' }));
    expect(cargas.porId('carga-1')?.estado).toBe('aceptada');
    expect(catalogos.version()).toBe(antes + 1);
  });
});

describe('vendedor.control_inventario (D7)', () => {
  it('baja en el pull y un login sin red (sin el campo) no lo apaga', () => {
    const { catalogos, cargas } = montar();
    expect(cargas.controlInventario('ven-1')).toBe(false);

    const yo = snapshotDePrueba().vendedores?.[0];
    if (!yo) throw new Error('El snapshot de prueba trae a ven-1.');
    catalogos.guardarSnapshot({ vendedores: [{ ...yo, control_inventario: 1 }] });
    expect(cargas.controlInventario('ven-1')).toBe(true);

    // El upsert de identidad del login sin red no conoce la casilla.
    catalogos.guardarSnapshot({
      vendedores: [{ id: 'ven-1', login: 'aperez', nombre: 'Abraham Perez', sucursal_id: 'suc-tj', activo: 1, folio_segmento: null }],
    });
    expect(cargas.controlInventario('ven-1')).toBe(true);
  });

  it('un vendedor nuevo sin la casilla nace con el control apagado', () => {
    const { catalogos, cargas } = montar();
    catalogos.guardarSnapshot({
      vendedores: [{ id: 'ven-9', login: 'nuevo', nombre: 'Nuevo', sucursal_id: 'suc-tj', activo: 1, folio_segmento: null }],
    });
    expect(cargas.controlInventario('ven-9')).toBe(false);
  });
});
```

`npm test --workspace=apps/tablet -- repositorios/cargas` → falla al resolver `./cargas`.

- [ ] **Paso 7: el repositorio de cargas**

`apps/tablet/src/datos/repositorios/cargas.ts`:

```ts
import type { BaseDatos } from '../base-datos';
import {
  bloqueoDeVenta,
  cargaPendiente,
  existencias,
  type CargaInventario,
  type Existencia,
  type LineaVentaInventario,
} from '../inventario-reglas';
import type { Booleano, Carga, CargaDetalle, EstadoCarga, FechaISO, MomentoISO } from '../tipos';
import type { RepositorioCatalogos } from './catalogos';
import type { DepsRepositorio } from './deps';
import { enTransaccion } from './deps';

/**
 * Una carga como la manda el pull (`CargaPull` del contrato) o la respuesta del
 * servidor al aceptar/rechazar. Estructural a proposito: la capa de datos no
 * importa el contrato, y `aSnapshot` le pasa las filas tal cual.
 */
export interface FilaCargaPull {
  id: string;
  vendedor_id: string;
  fecha: FechaISO;
  numero: number;
  estado: EstadoCarga;
  motivo_rechazo: string | null;
  version: number;
  respondida_en: MomentoISO | null;
  activo: Booleano;
  lineas: { presentacion_id: string; piezas: number }[];
}

export interface LineaCargaConEtiqueta extends CargaDetalle {
  /** "Jamaica 1 L", o `PRODUCTO_FUERA_DE_CATALOGO` si la presentacion aun no baja. */
  etiqueta: string;
}

export interface CargaConLineas extends Carga {
  lineas: LineaCargaConEtiqueta[];
}

/** Una fila de la tabla de Inventario: Cargado − Vendido − Regalado = Existencia. */
export interface FilaInventario extends Existencia {
  presentacionId: string;
  etiqueta: string;
}

/** Lo que la pantalla de venta lee al abrir (la red definitiva es `ventas.registrar`). */
export interface InventarioParaVenta {
  controlInventario: boolean;
  bloqueo: string | null;
  existencias: Map<string, Existencia>;
}

export const PRODUCTO_FUERA_DE_CATALOGO = 'Producto fuera del catálogo';

/**
 * ¿La fila que llega es mas vieja que la que ya hay? Entonces no se escribe:
 *
 * - Una baja es final: nada la revive (el portal no tiene "deshacer baja").
 * - La baja que llega siempre entra.
 * - Una version menor llega tarde: el portal ya la edito despues.
 * - Misma version, la local ya respondida y la que llega pendiente: es un pull
 *   que salio ANTES de que el vendedor aceptara o rechazara. Sin esto, la carga
 *   aceptada volveria a "por aceptar" hasta el pull siguiente.
 */
function llegaTarde(
  local: Pick<Carga, 'estado' | 'version' | 'activo'>,
  fila: FilaCargaPull,
): boolean {
  if (local.activo === 0) return true;
  if (fila.activo === 0) return false;
  if (fila.version < local.version) return true;
  return fila.version === local.version && fila.estado === 'pendiente' && local.estado !== 'pendiente';
}

/**
 * Aplica las cargas del pull (o la que contesto el servidor). Sin transaccion
 * propia: la llama `catalogos.guardarSnapshot` dentro de la suya (y
 * `aplicarRespuesta` abre una). Por cada fila: upsert por `id` y las lineas se
 * **reemplazan** (el servidor manda siempre la carga completa).
 *
 * @returns cuantas filas escribio (para que `guardarSnapshot` sepa si avisar).
 */
export function aplicarSnapshotCargas(
  bd: BaseDatos,
  filas: readonly FilaCargaPull[] | undefined,
  actualizadoEn: MomentoISO,
): number {
  if (!filas || filas.length === 0) return 0;
  let escritas = 0;
  for (const f of filas) {
    const local = bd.getFirstSync<Pick<Carga, 'estado' | 'version' | 'activo'>>(
      'select estado, version, activo from carga where id = $id',
      { $id: f.id },
    );
    if (local && llegaTarde(local, f)) continue;

    bd.runSync(
      `insert into carga (id, vendedor_id, fecha, numero, estado, motivo_rechazo, version,
                          respondida_en, activo, actualizado_en)
       values ($id, $vendedor_id, $fecha, $numero, $estado, $motivo_rechazo, $version,
               $respondida_en, $activo, $actualizado_en)
       on conflict(id) do update set
         vendedor_id = excluded.vendedor_id,
         fecha = excluded.fecha,
         numero = excluded.numero,
         estado = excluded.estado,
         motivo_rechazo = excluded.motivo_rechazo,
         version = excluded.version,
         respondida_en = excluded.respondida_en,
         activo = excluded.activo,
         actualizado_en = excluded.actualizado_en`,
      {
        $id: f.id,
        $vendedor_id: f.vendedor_id,
        $fecha: f.fecha,
        $numero: f.numero,
        $estado: f.estado,
        $motivo_rechazo: f.motivo_rechazo,
        $version: f.version,
        $respondida_en: f.respondida_en,
        $activo: f.activo,
        $actualizado_en: actualizadoEn,
      },
    );
    bd.runSync('delete from carga_detalle where carga_id = $id', { $id: f.id });
    for (const l of f.lineas) {
      bd.runSync(
        `insert into carga_detalle (carga_id, presentacion_id, piezas)
         values ($carga_id, $presentacion_id, $piezas)`,
        { $carga_id: f.id, $presentacion_id: l.presentacion_id, $piezas: l.piezas },
      );
    }
    escritas += 1;
  }
  return escritas;
}

/**
 * Lo que el inventario de hoy necesita, leido de SQLite: la casilla del
 * vendedor, sus cargas del dia (con lineas) y las lineas de sus ventas del dia.
 *
 * La usa `ventas.registrar` DENTRO de su transaccion (Review Focus 1: la
 * existencia que valida es la del momento de grabar) y este repositorio para
 * las pantallas.
 */
export function leerInventarioDelDia(
  bd: BaseDatos,
  vendedorId: string,
  fecha: FechaISO,
): { controlInventario: boolean; cargas: CargaInventario[]; ventas: LineaVentaInventario[] } {
  const vendedor = bd.getFirstSync<{ control_inventario: number }>(
    'select control_inventario from vendedor where id = $id',
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
  return {
    controlInventario: vendedor?.control_inventario === 1,
    cargas: cargas.map((c) => ({ ...c, lineas: detalle.filter((d) => d.carga_id === c.id) })),
    ventas,
  };
}

export type RepositorioCargas = ReturnType<typeof crearRepositorioCargas>;

/**
 * La carga y las recargas del vendedor en la tablet (T-27 pieza 1). Recibe el
 * MISMO `catalogos` de la capa de datos: es quien publica la version que
 * observan las pantallas (`aplicarRespuesta` avisa por el).
 */
export function crearRepositorioCargas(
  { bd, reloj }: DepsRepositorio,
  { catalogos }: { catalogos: RepositorioCatalogos },
) {
  /** "Producto volumen" de todo el catalogo local (es chico); tambien de las dadas de baja. */
  function etiquetasDelCatalogo(): Map<string, string> {
    const filas = bd.getAllSync<{ id: string; etiqueta: string }>(
      `select pr.id, p.nombre || ' ' || pr.volumen as etiqueta
         from presentacion pr
         join producto p on p.id = pr.producto_id`,
    );
    return new Map(filas.map((f) => [f.id, f.etiqueta]));
  }

  function conLineas(cargas: readonly Carga[]): CargaConLineas[] {
    if (cargas.length === 0) return [];
    const nombres = etiquetasDelCatalogo();
    return cargas.map((c) => ({
      ...c,
      lineas: bd
        .getAllSync<CargaDetalle>('select * from carga_detalle where carga_id = $id', { $id: c.id })
        .map((l) => ({ ...l, etiqueta: nombres.get(l.presentacion_id) ?? PRODUCTO_FUERA_DE_CATALOGO }))
        .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es')),
    }));
  }

  function delDia(vendedorId: string, fecha: FechaISO = reloj.hoy()): CargaConLineas[] {
    return conLineas(
      bd.getAllSync<Carga>(
        `select * from carga
          where vendedor_id = $vendedor_id and fecha = $fecha and activo = 1
          order by numero`,
        { $vendedor_id: vendedorId, $fecha: fecha },
      ),
    );
  }

  return {
    /** Las cargas vivas de hoy del vendedor, por numero, con sus lineas: la lista de Inventario. */
    delDia,

    /** Una carga por id, viva o no (el detalle dice "ya no existe" si se dio de baja). */
    porId(id: string): CargaConLineas | null {
      const carga = bd.getFirstSync<Carga>('select * from carga where id = $id', { $id: id });
      return carga ? (conLineas([carga])[0] ?? null) : null;
    },

    /** La que hay que aceptar primero: el aviso de la pantalla principal (con o sin control). */
    pendienteDeHoy(vendedorId: string): CargaConLineas | null {
      return cargaPendiente(delDia(vendedorId), reloj.hoy());
    },

    controlInventario(vendedorId: string): boolean {
      return leerInventarioDelDia(bd, vendedorId, reloj.hoy()).controlInventario;
    },

    /** Lo que la pantalla de venta pinta al abrir: bloqueo y "Te quedan N". */
    paraVenta(vendedorId: string): InventarioParaVenta {
      const hoy = reloj.hoy();
      const inventario = leerInventarioDelDia(bd, vendedorId, hoy);
      return {
        controlInventario: inventario.controlInventario,
        bloqueo: bloqueoDeVenta({
          controlInventario: inventario.controlInventario,
          cargas: inventario.cargas,
          hoy,
        }),
        existencias: existencias(inventario.cargas, inventario.ventas, hoy),
      };
    },

    /** La tabla de Inventario, por nombre de producto y volumen. */
    filasInventario(vendedorId: string): FilaInventario[] {
      const hoy = reloj.hoy();
      const inventario = leerInventarioDelDia(bd, vendedorId, hoy);
      const nombres = etiquetasDelCatalogo();
      return [...existencias(inventario.cargas, inventario.ventas, hoy)]
        .map(([presentacionId, e]) => ({
          presentacionId,
          etiqueta: nombres.get(presentacionId) ?? PRODUCTO_FUERA_DE_CATALOGO,
          ...e,
        }))
        .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
    },

    /**
     * Escribe la carga que contesto el servidor (200 o el cuerpo de un 409) y
     * avisa a las pantallas, despues del `commit`.
     */
    aplicarRespuesta(fila: FilaCargaPull): void {
      enTransaccion(bd, () => aplicarSnapshotCargas(bd, [fila], reloj.ahora()));
      catalogos.publicarCambio();
    },
  };
}
```

- [ ] **Paso 8: el snapshot del pull (`catalogos.ts`, `motor.ts`, `pruebas-apoyo.ts`)**

`apps/tablet/src/datos/repositorios/catalogos.ts`:

1. `import { aplicarSnapshotCargas, type FilaCargaPull } from './cargas';` junto al import de `./rutas`.
2. En `SnapshotCatalogos`, `vendedores` queda:

```ts
  /**
   * T-27: `control_inventario` es opcional aqui: un servidor anterior no lo manda
   * y el login sin red no lo conoce. Ausente, el upsert conserva lo que habia (0
   * en una fila nueva); ver NO_BORRAR_CON_NULO.
   */
  vendedores?: (Omit<Vendedor, 'sincronizado_en' | 'control_inventario'> &
    Partial<Pick<Vendedor, 'control_inventario'>>)[];
```

   y al final de la interfaz:

```ts
  /** T-27. La carga y las recargas del vendedor; regla propia (`aplicarSnapshotCargas`). */
  cargas?: FilaCargaPull[];
```

3. En `COLUMNAS.vendedor`, después de `'folio_segmento',` agrega:

```ts
    // T-27 (D7): la casilla de su sucursal. El login sin red no la pisa.
    'control_inventario',
```

4. Reemplaza la constante `NO_BORRAR_CON_NULO` (deja su comentario y agrégale el párrafo) por:

```ts
 * T-27: `vendedor.control_inventario` tiene el mismo problema y uno peor: es
 * `not null`. Un `null` del login sin red fallaria el `not null`, y un 0 apagaria
 * el control hasta el siguiente pull. Por eso cada columna lleva el valor (SQL
 * literal, de esta constante) con que nace una fila NUEVA que no lo trae.
 */
const NO_BORRAR_CON_NULO: Record<string, Record<string, string>> = {
  vendedor: { folio_segmento: 'null', control_inventario: '0' },
};
```

5. En `upsert`, reemplaza desde `const todas = …` hasta la construcción de `sql` por:

```ts
  const todas = [...columnas, 'sincronizado_en'];
  const conservar = NO_BORRAR_CON_NULO[tabla] ?? {};
  const seConserva = (c: string) => Object.prototype.hasOwnProperty.call(conservar, c);
  const marcadores = todas
    .map((c) => (seConserva(c) ? `coalesce($${c}, ${conservar[c] ?? 'null'})` : `$${c}`))
    .join(', ');
  const asignaciones = todas
    .filter((c) => c !== 'id')
    .map((c) =>
      seConserva(c)
        ? // Un valor de verdad gana; un null no borra lo que ya habia. Se lee el
          // PARAMETRO y no `excluded`: en `excluded` ya va el valor con que nace
          // una fila nueva, y ese tampoco debe pisar al que existia.
          `${c} = coalesce($${c}, ${tabla}.${c})`
        : `${c} = excluded.${c}`,
    )
    .join(', ');

  const sql =
    `insert into ${tabla} (${todas.join(', ')}) values (${marcadores}) ` +
    `on conflict(id) do update set ${asignaciones}`;
```

6. En `guardarSnapshot`, después de `upsert(bd, 'promocion', …) +`, agrega:

```ts
          // T-27: sin llaves foraneas hacia los catalogos (ver la 017); regla de
          // fusion propia en `cargas.ts` (una respuesta no se deshace).
          aplicarSnapshotCargas(bd, snapshot.cargas, ahora) +
```

`apps/tablet/src/sincronizacion/motor.ts`, en `aSnapshot`:

1. `vendedores: c.vendedores,` queda:

```ts
    // T-27: la casilla llega booleana y SQLite guarda 0/1. Un servidor anterior
    // no la manda: `undefined`, y el upsert conserva lo que habia.
    vendedores: c.vendedores.map(({ control_inventario, ...v }) => ({
      ...v,
      control_inventario:
        control_inventario === undefined ? undefined : control_inventario ? 1 : 0,
    })),
```

2. Después de `promociones: …,` agrega:

```ts
    // T-27: un servidor anterior no manda la coleccion; `undefined` no escribe nada.
    cargas: respuesta.cargas,
```

`apps/tablet/src/datos/pruebas-apoyo.ts`, en `respuestaPullDePrueba`, `vendedores: s.vendedores ?? [],` queda:

```ts
      // T-27: el snapshot guarda la casilla 0/1; el pull la manda booleana.
      vendedores: (s.vendedores ?? []).map(({ control_inventario, ...v }) => ({
        ...v,
        ...(control_inventario === undefined ? {} : { control_inventario: control_inventario === 1 }),
      })),
```

En `apps/tablet/src/sincronizacion/motor.spec.ts`, después de `describe('aSnapshot (T-72)', …)`:

```ts
describe('aSnapshot (T-27)', () => {
  it('pasa la casilla del vendedor a 0/1 y tolera un servidor que no la manda', () => {
    const respuesta = respuestaPullDePrueba();
    respuesta.catalogos.vendedores = respuesta.catalogos.vendedores.map((v, i) => ({
      ...v,
      control_inventario: i === 0,
    }));
    expect(aSnapshot(respuesta).vendedores?.map((v) => v.control_inventario)).toEqual([1, 0]);
    expect(aSnapshot(respuestaPullDePrueba()).vendedores?.map((v) => v.control_inventario)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('pasa las cargas y tolera un servidor que todavia no las manda', () => {
    const carga = {
      id: 'carga-1',
      vendedor_id: 'ven-1',
      fecha: '2026-08-07',
      numero: 1,
      estado: 'pendiente' as const,
      motivo_rechazo: null,
      version: 1,
      respondida_en: null,
      activo: 1 as const,
      lineas: [{ presentacion_id: 'pre-1', piezas: 24 }],
    };
    expect(aSnapshot(respuestaPullDePrueba({ cargas: [carga] })).cargas).toEqual([carga]);
    expect(aSnapshot(respuestaPullDePrueba()).cargas).toBeUndefined();
  });
});
```

- [ ] **Paso 9: los candados en `ventas.registrar` — la prueba, que falla**

En `apps/tablet/src/datos/repositorios/ventas.spec.ts`:

1. Agrega `import { aplicarSnapshotCargas } from './cargas';` y `import type { EstadoCarga } from '../tipos';`.
2. Al final del archivo:

```ts
describe('inventario del vendedor (T-27, D3, D4, D10)', () => {
  const HOY = '2026-08-07';

  function prenderControl(deps: DepsRepositorio) {
    deps.bd.runSync("update vendedor set control_inventario = 1 where id = 'ven-1'");
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

  it('Review Focus 5: con el control apagado vende aunque haya una carga pendiente', () => {
    const { deps, ventas } = montar();
    cargar(deps, 'carga-1', 1, 'pendiente', [{ presentacion_id: 'pre-1', piezas: 1 }]);
    expect(ventas.registrar(venta()).folio).toBe('TJ260807AP01');
  });

  it('con el control prendido y una carga pendiente no graba ni quema folio (D3)', () => {
    const { deps, ventas } = montar();
    prenderControl(deps);
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 100 }]);
    cargar(deps, 'carga-2', 2, 'pendiente', [{ presentacion_id: 'pre-1', piezas: 10 }]);
    expect(() => ventas.registrar(venta())).toThrow(ErrorVenta);
    expect(() => ventas.registrar(venta())).toThrow(
      'Tienes una carga por aceptar. Acéptala en Inventario antes de vender.',
    );
    expect(cuantas(deps, 'venta')).toBe(0);
    expect(cuantas(deps, 'folio_emitido')).toBe(0);
  });

  it('con el control prendido no vende mas de lo que trae, regalos incluidos, y no quema folio (D4)', () => {
    const { deps, ventas } = montar();
    prenderControl(deps);
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 20 }]);
    // 24 vendidas + 2 regaladas contra 20 cargadas.
    expect(() => ventas.registrar(venta())).toThrow(
      'No te alcanza el producto: Jamaica 1 L: faltan 6 piezas.',
    );
    expect(cuantas(deps, 'venta')).toBe(0);
    expect(cuantas(deps, 'folio_emitido')).toBe(0);
  });

  it('una venta de solo regalo tambien necesita piezas (D10)', () => {
    const { deps, ventas } = montar();
    prenderControl(deps);
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 20 }]);
    expect(() =>
      ventas.registrar(
        venta({
          lineas: [{ presentacionId: 'pre-2', cantidad: 0, cantidadPromocion: 3 }],
          regalos: [{ promocionId: 'promo-prospecto', presentacionId: 'pre-2', cantidad: 3, texto: 'Bienvenida' }],
        }),
      ),
    ).toThrow('Jamaica 500 ml: faltan 3 piezas');
  });

  it('Review Focus 1: valida con la existencia del momento de grabar', () => {
    const { deps, ventas } = montar();
    prenderControl(deps);
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 20 }]);
    // Al abrir la pantalla habia 20: la captura de 24 + 2 no alcanza.
    expect(() => ventas.registrar(venta())).toThrow('faltan 6 piezas');

    // A media captura se acepta una recarga (la escribe la respuesta o el pull)...
    cargar(deps, 'carga-2', 2, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 10 }]);
    // ...y el MISMO registrar valida con lo que hay al grabar: 30 alcanzan para 26.
    expect(ventas.registrar(venta()).folio).toBe('TJ260807AP01');

    // Y al reves: la venta grabada se llevo 26; lo que queda (4) no alcanza para 5.
    expect(() =>
      ventas.registrar(
        venta({
          lineas: [{ presentacionId: 'pre-1', cantidad: 5, cantidadPromocion: 0 }],
          regalos: [],
        }),
      ),
    ).toThrow('Jamaica 1 L: falta 1 pieza');
    expect(cuantas(deps, 'folio_emitido')).toBe(1);
  });
});
```

`npm test --workspace=apps/tablet -- repositorios/ventas` → las pruebas nuevas de D3, D4, D10 y Review Focus 1 fallan
(la venta se graba).

- [ ] **Paso 10: los candados en `ventas.registrar`**

En `apps/tablet/src/datos/repositorios/ventas.ts`:

1. Imports:

```ts
import { bloqueoDeVenta, existencias, faltantesDeVenta, textoFaltante } from '../inventario-reglas';
import { leerInventarioDelDia } from './cargas';
```

2. Agrega a la documentación de `registrar` (después de la lista de `@throws`… antes de `@throws`):

```ts
     * T-27 (D3, D4): con el control de inventario prendido, una carga pendiente
     * de hoy o una presentacion que quedaria en negativo (vendidas + regaladas)
     * detienen la venta. Se calcula DENTRO de la transaccion y antes de emitir
     * el folio: vale la existencia del momento de grabar (Review Focus 1), no la
     * que pinto la pantalla, y un rechazo no quema numero.
```

3. Dentro de `enTransaccion(bd, () => {`, **antes** de `const emitido = folios.emitir(…)`, agrega:

```ts
        // T-27 (D3, D4): la carga pendiente y la existencia se leen AQUI, con
        // la base tal como esta al grabar. La pantalla no es la unica defensa
        // (igual que el precio, D15). Un throw hace rollback: no hay folio.
        const inventario = leerInventarioDelDia(bd, datos.vendedorId, fecha);
        const bloqueo = bloqueoDeVenta({
          controlInventario: inventario.controlInventario,
          cargas: inventario.cargas,
          hoy: fecha,
        });
        if (bloqueo !== null) {
          throw new ErrorVenta(`${bloqueo}. Acéptala en Inventario antes de vender.`);
        }
        const faltantes = faltantesDeVenta({
          controlInventario: inventario.controlInventario,
          existencias: existencias(inventario.cargas, inventario.ventas, fecha),
          lineas: resumen.lineas.map((l) => ({ presentacionId: l.presentacionId, cantidad: l.cantidad })),
          regalos: regalos.map((r) => ({ presentacionId: r.presentacionId, cantidad: r.cantidad })),
        });
        if (faltantes.length > 0) {
          const etiquetas = new Map(lineas.map((l) => [l.presentacionId, l.etiqueta] as const));
          throw new ErrorVenta(
            `No te alcanza el producto: ${faltantes
              .map((f) => textoFaltante(etiquetas.get(f.presentacionId) ?? 'Un producto', f.faltan))
              .join('; ')}.`,
          );
        }
```

`npm test --workspace=apps/tablet -- repositorios/ventas repositorios/cargas` → verde.

- [ ] **Paso 11: la capa de datos expone las cargas**

`apps/tablet/src/datos/inicializar.ts`:

- `import { crearRepositorioCargas, type RepositorioCargas } from './repositorios/cargas';`
- En `CapaDatos`, después de `promociones`:

```ts
  /** La carga y las recargas del vendedor y su inventario del dia (T-27). */
  cargas: RepositorioCargas;
```

- En el objeto que devuelve `inicializarCapaDatos`, después de `promociones: …,`:

```ts
    // El MISMO `catalogos`: `aplicarRespuesta` publica por el la version que
    // observan Inventario, la pantalla principal y la venta.
    cargas: crearRepositorioCargas(deps, { catalogos }),
```

`apps/tablet/src/datos/index.ts`, al final:

```ts
export {
  aplicarSnapshotCargas,
  crearRepositorioCargas,
  PRODUCTO_FUERA_DE_CATALOGO,
} from './repositorios/cargas';
export type {
  CargaConLineas,
  FilaCargaPull,
  FilaInventario,
  InventarioParaVenta,
  LineaCargaConEtiqueta,
  RepositorioCargas,
} from './repositorios/cargas';
export {
  bloqueoDeVenta,
  cargaPendiente,
  existencias,
  faltantesDeVenta,
  MOTIVO_CARGA_PENDIENTE,
  textoFaltante,
} from './inventario-reglas';
export type {
  CargaInventario,
  Existencia,
  Faltante,
  LineaVentaInventario,
  PiezasDePresentacion,
} from './inventario-reglas';
```

- [ ] **Paso 12: typecheck, lint, toda la suite y commit**

```bash
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm test --workspace=apps/tablet
git add apps/tablet/src/datos apps/tablet/src/sincronizacion/motor.ts apps/tablet/src/sincronizacion/motor.spec.ts
git commit -m "T-27 (tablet): migración 017, la carga baja en el pull y la venta respeta el inventario dentro de su transacción

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Esperado: la suite completa verde (las ventas de las pruebas existentes no cambian: `ven-1` nace con el control
apagado). Si `typecheck` señala otro sitio que arma un `Vendedor` completo sin `control_inventario`, no lo
"arregles" con un 0: usa el tipo del snapshot (la casilla es opcional ahí).

> **Controlador (emulador, al final de la tarea):** instala esta rama en el emulador **sin borrar los datos de la app**
> (Metro de este worktree; nada de `pm clear`). Debe arrancar sin error de migración sobre la base 016 real; "Refrescar"
> contra el backend de esta rama (con el Postgres **local**) termina bien y, con la casilla **apagada**, una venta se
> graba como antes aunque exista una carga pendiente capturada en el portal (Review Focus 5 en la pantalla real).

---

### Tarea 6: Tablet: lógica de pantalla del inventario, cliente de la respuesta y entrada real del menú (lógica pura y respuesta del spec, D2, D6, D9)

**Files:**
- Create: `apps/tablet/src/sincronizacion/api-carga.ts`
- Test: `apps/tablet/src/sincronizacion/api-carga.spec.ts`
- Create: `apps/tablet/src/estado/inventario.ts`
- Test: `apps/tablet/src/estado/inventario.spec.ts`
- Modify: `apps/tablet/src/estado/proveedor-sesion.tsx` (`responderCarga`)
- Modify: `apps/tablet/src/estado/ruta-del-dia.ts` (Inventario deja de ser pendiente), test en
  `apps/tablet/src/estado/ruta-del-dia.spec.ts`

**Interfaces:**
- Consumes: `CargaPull`, `CuerpoRespuestaCarga` (contrato de la tablet, Tarea 3); `SinRedError`, `URL_API`
  (`src/sesion/api.ts`); las reglas de `src/datos/inventario-reglas.ts` y `FilaCargaPull` (Tarea 5).
- Produces:
  - `src/sincronizacion/api-carga.ts`: `type ResultadoApiCarga = { tipo: 'ok'; carga: CargaPull } | { tipo: 'cambio';
    carga: CargaPull | null } | { tipo: 'inexistente' } | { tipo: 'invalida'; mensaje: string } | { tipo: 'sesion' }`;
    `interface ClienteCargas { responder(tokenAcceso: string, cargaId: string, cuerpo: CuerpoRespuestaCarga):
    Promise<ResultadoApiCarga> }` (lanza `SinRedError` sin red o con 5xx); `crearClienteCargas(base?)`.
  - `src/estado/inventario.ts`: reexporta las reglas de `inventario-reglas.ts`; `LARGO_MAX_MOTIVO_RECHAZO = 300`;
    `MENSAJE_SIN_RED_CARGA`, `MENSAJE_CARGA_CAMBIO`, `MENSAJE_CARGA_ELIMINADA`, `MENSAJE_SESION_CARGA`,
    `NOTA_CONTROL_APAGADO`; `type AccionCarga = 'aceptar' | 'rechazar'`;
    `validarRespuesta(accion, motivo): string[]`; `cuerpoRespuesta(accion, motivo, version): CuerpoRespuestaCarga`;
    `puedeResponder(carga: { estado; activo; fecha }, hoy): boolean`;
    `pastillaCarga(estado): { texto: string; estado: 'pendiente' | 'listo' | 'error' }`;
    `totalPiezas(lineas: readonly { piezas: number }[]): number`;
    `textoTeQuedan(existencia: number, enEstaVenta: number): { texto: string; falta: boolean }`;
    `faltantesDeCaptura({ controlInventario, existencias, lineas, regalos }): string[]`;
    `interface PasosRespuestaCarga { responder(): Promise<ResultadoApiCarga>; aplicar(carga: CargaPull): void;
    sincronizar(): Promise<unknown> }`; `type ResultadoRespuestaCarga = { estado: 'respondida'; carga: CargaPull } |
    { estado: 'cambio' | 'eliminada' | 'sin-red' | 'invalida' | 'sin-sesion'; mensaje: string }`;
    `crearRespondedorCarga(): RespondedorCarga` con `responder(pasos): Promise<ResultadoRespuestaCarga | null>`
    (`null` = segundo toque ignorado).
  - `ContextoSesion.responderCarga(cargaId: string, cuerpo: CuerpoRespuestaCarga): Promise<ResultadoApiCarga>`.
  - Menú: la entrada "Inventario" abre `/(jornada)/inventario` (se habilita aunque el día esté cerrado: es consulta);
    `SECCIONES_PENDIENTES` se queda solo con `merma`.

- [ ] **Paso 1: la prueba del cliente HTTP, que falla**

`apps/tablet/src/sincronizacion/api-carga.spec.ts`:

```ts
/**
 * Como traduce el cliente de la respuesta a una carga (T-27) los codigos del
 * servidor. Lo que importa es el reparto: un 409 leido como "sin red" haria que
 * la tablet reintentara con la version vieja en vez de mostrar la nueva.
 */
import { SinRedError } from '@/sesion/api';

import { crearClienteCargas } from './api-carga';
import type { CargaPull } from './contrato';

const CARGA: CargaPull = {
  id: 'carga-1',
  vendedor_id: 'ven-1',
  fecha: '2026-10-22',
  numero: 1,
  estado: 'aceptada',
  motivo_rechazo: null,
  version: 1,
  respondida_en: '2026-10-22T15:00:00.000Z',
  activo: 1,
  lineas: [{ presentacion_id: 'pre-1', piezas: 24 }],
};

const fetchOriginal = globalThis.fetch;

function conRespuesta(status: number, cuerpo: unknown) {
  const fetchFalso = jest.fn((_url: string, _init: RequestInit) =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(cuerpo),
    } as unknown as Response),
  );
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
  return fetchFalso;
}

const responder = () =>
  crearClienteCargas('http://servidor').responder('token', 'carga-1', { version: 1, accion: 'aceptar' });

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe('cliente de la respuesta a una carga', () => {
  it('manda el cuerpo con el Bearer de siempre a /sync/cargas/:id/respuesta', async () => {
    const fetchFalso = conRespuesta(200, CARGA);
    await responder();
    const [url, init] = fetchFalso.mock.calls[0]!;
    expect(url).toBe('http://servidor/sync/cargas/carga-1/respuesta');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');
    expect(JSON.parse(init.body as string)).toEqual({ version: 1, accion: 'aceptar' });
  });

  it('200 es la carga respondida', async () => {
    conRespuesta(200, CARGA);
    await expect(responder()).resolves.toEqual({ tipo: 'ok', carga: CARGA });
  });

  it('Review Focus 2: 409 es "cambio" y trae la carga actual del cuerpo', async () => {
    const nueva = { ...CARGA, estado: 'pendiente' as const, version: 2, respondida_en: null };
    conRespuesta(409, { message: 'La carga cambió…', carga: nueva });
    await expect(responder()).resolves.toEqual({ tipo: 'cambio', carga: nueva });
  });

  it('409 sin carga legible sigue siendo "cambio"', async () => {
    conRespuesta(409, { message: 'otra cosa' });
    await expect(responder()).resolves.toEqual({ tipo: 'cambio', carga: null });
  });

  it('404 es "inexistente", 401 es "sesion" y 400 trae el mensaje', async () => {
    conRespuesta(404, { message: 'No existe esa carga.' });
    await expect(responder()).resolves.toEqual({ tipo: 'inexistente' });
    conRespuesta(401, {});
    await expect(responder()).resolves.toEqual({ tipo: 'sesion' });
    conRespuesta(400, { message: ['Para rechazar la carga escribe el motivo (hasta 300 caracteres).'] });
    await expect(responder()).resolves.toEqual({
      tipo: 'invalida',
      mensaje: 'Para rechazar la carga escribe el motivo (hasta 300 caracteres).',
    });
  });

  it('un 500 o la red caida son SinRedError', async () => {
    conRespuesta(500, {});
    await expect(responder()).rejects.toBeInstanceOf(SinRedError);
    globalThis.fetch = jest.fn(() => Promise.reject(new Error('sin wifi'))) as unknown as typeof fetch;
    await expect(responder()).rejects.toBeInstanceOf(SinRedError);
  });
});
```

`npm test --workspace=apps/tablet -- api-carga` → falla al resolver `./api-carga`.

- [ ] **Paso 2: el cliente HTTP**

`apps/tablet/src/sincronizacion/api-carga.ts`:

```ts
/**
 * Cliente de `POST /sync/cargas/:id/respuesta` (T-27, D6): aceptar o rechazar
 * la carga, con red y en el momento.
 *
 * Mismo transporte que `api.ts` (`Authorization: Bearer`, fallo de red =
 * `SinRedError`), pero devuelve los demas codigos como **resultado** y no como
 * error: cada uno lleva a la pantalla por un camino distinto (409 muestra la
 * carga nueva, 404 se resincroniza, 401 sincroniza para renovar). Este cliente
 * nunca renueva la sesion por su cuenta.
 */
import { SinRedError, URL_API } from '@/sesion/api';

import type { CargaPull, CuerpoRespuestaCarga } from './contrato';

export type ResultadoApiCarga =
  | { tipo: 'ok'; carga: CargaPull }
  /** 409: el portal la edito o ya tiene otra respuesta. `carga` = la actual, si vino. */
  | { tipo: 'cambio'; carga: CargaPull | null }
  /** 404: de otro vendedor, inexistente o eliminada. */
  | { tipo: 'inexistente' }
  | { tipo: 'invalida'; mensaje: string }
  /** 401: el token de acceso ya no vale. */
  | { tipo: 'sesion' };

export interface ClienteCargas {
  responder(
    tokenAcceso: string,
    cargaId: string,
    cuerpo: CuerpoRespuestaCarga,
  ): Promise<ResultadoApiCarga>;
}

/** Una peticion chica sobre el WiFi de la planta: 15 s bastan. */
const TIMEOUT_MS = 15_000;

async function leerCuerpo(respuesta: Response): Promise<unknown> {
  try {
    return await respuesta.json();
  } catch {
    return null;
  }
}

function mensajeDe(cuerpo: unknown, status: number): string {
  const mensaje = (cuerpo as { message?: unknown } | null)?.message;
  if (typeof mensaje === 'string') return mensaje;
  if (Array.isArray(mensaje)) return mensaje.filter((m) => typeof m === 'string').join(' ');
  return `El servidor respondio ${status}.`;
}

export function crearClienteCargas(base: string = URL_API): ClienteCargas {
  return {
    async responder(tokenAcceso, cargaId, cuerpo) {
      const control = new AbortController();
      const alarma = setTimeout(() => control.abort(), TIMEOUT_MS);
      let respuesta: Response;
      try {
        respuesta = await fetch(`${base}/sync/cargas/${encodeURIComponent(cargaId)}/respuesta`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenAcceso}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(cuerpo),
          signal: control.signal,
        });
      } catch (error) {
        throw new SinRedError(error);
      } finally {
        clearTimeout(alarma);
      }

      if (respuesta.ok) return { tipo: 'ok', carga: (await respuesta.json()) as CargaPull };
      if (respuesta.status === 401) return { tipo: 'sesion' };
      if (respuesta.status === 404) return { tipo: 'inexistente' };
      if (respuesta.status === 409) {
        const actual = (await leerCuerpo(respuesta)) as { carga?: CargaPull } | null;
        return { tipo: 'cambio', carga: actual?.carga ?? null };
      }
      if (respuesta.status === 400) {
        return { tipo: 'invalida', mensaje: mensajeDe(await leerCuerpo(respuesta), 400) };
      }
      // 5xx y lo demas: para el vendedor es lo mismo que sin red (reintentar).
      throw new SinRedError(new Error(`El servidor respondio ${respuesta.status}.`));
    },
  };
}
```

`npm test --workspace=apps/tablet -- api-carga` → verde.

- [ ] **Paso 3: la prueba de la lógica de pantalla, que falla**

`apps/tablet/src/estado/inventario.spec.ts`:

```ts
import { existencias as existenciasDatos } from '@/datos/inventario-reglas';
import type { ResultadoApiCarga } from '@/sincronizacion/api-carga';
import type { CargaPull } from '@/sincronizacion/contrato';

import {
  crearRespondedorCarga,
  cuerpoRespuesta,
  existencias,
  faltantesDeCaptura,
  MENSAJE_CARGA_CAMBIO,
  MENSAJE_CARGA_ELIMINADA,
  MENSAJE_SESION_CARGA,
  MENSAJE_SIN_RED_CARGA,
  pastillaCarga,
  puedeResponder,
  textoTeQuedan,
  totalPiezas,
  validarRespuesta,
  type PasosRespuestaCarga,
} from './inventario';

/**
 * Lo que las pantallas de inventario deciden sin React (T-27): la tablet no
 * tiene pruebas de componentes.
 */

const HOY = '2026-10-22';

const CARGA: CargaPull = {
  id: 'carga-1',
  vendedor_id: 'ven-1',
  fecha: HOY,
  numero: 1,
  estado: 'aceptada',
  motivo_rechazo: null,
  version: 1,
  respondida_en: '2026-10-22T15:00:00.000Z',
  activo: 1,
  lineas: [{ presentacion_id: 'pre-1', piezas: 24 }],
};

function pasos(respuestas: (ResultadoApiCarga | Error)[]) {
  const cola = [...respuestas];
  const p = {
    responder: jest.fn(async (): Promise<ResultadoApiCarga> => {
      const siguiente = cola.shift();
      if (!siguiente) throw new Error('sin mas respuestas');
      if (siguiente instanceof Error) throw siguiente;
      return siguiente;
    }),
    aplicar: jest.fn((_carga: CargaPull) => undefined),
    sincronizar: jest.fn(async () => undefined),
  };
  return p satisfies PasosRespuestaCarga;
}

describe('reexporta las reglas de la capa de datos', () => {
  it('existencias es la misma funcion', () => {
    expect(existencias).toBe(existenciasDatos);
  });
});

describe('la respuesta del vendedor (D2)', () => {
  it('aceptar no pide nada; rechazar pide motivo de hasta 300', () => {
    expect(validarRespuesta('aceptar', '')).toEqual([]);
    expect(validarRespuesta('rechazar', '   ')).toEqual(['Escribe por qué rechazas la carga.']);
    expect(validarRespuesta('rechazar', 'x'.repeat(301))).toEqual(['El motivo lleva hasta 300 caracteres.']);
    expect(validarRespuesta('rechazar', 'Faltan 2 cajas')).toEqual([]);
  });

  it('el cuerpo lleva la version que se VE y el motivo recortado solo al rechazar', () => {
    expect(cuerpoRespuesta('aceptar', 'lo que sea', 3)).toEqual({ version: 3, accion: 'aceptar' });
    expect(cuerpoRespuesta('rechazar', '  Faltan 2 cajas  ', 3)).toEqual({
      version: 3,
      accion: 'rechazar',
      motivo: 'Faltan 2 cajas',
    });
  });

  it('solo se responde una pendiente, viva y de hoy', () => {
    expect(puedeResponder({ estado: 'pendiente', activo: 1, fecha: HOY }, HOY)).toBe(true);
    expect(puedeResponder({ estado: 'aceptada', activo: 1, fecha: HOY }, HOY)).toBe(false);
    expect(puedeResponder({ estado: 'pendiente', activo: 0, fecha: HOY }, HOY)).toBe(false);
    expect(puedeResponder({ estado: 'pendiente', activo: 1, fecha: '2026-10-21' }, HOY)).toBe(false);
  });
});

describe('textos del inventario', () => {
  it('pastillaCarga y totalPiezas', () => {
    expect(pastillaCarga('pendiente')).toEqual({ texto: 'Por aceptar', estado: 'pendiente' });
    expect(pastillaCarga('aceptada')).toEqual({ texto: 'Aceptada', estado: 'listo' });
    expect(pastillaCarga('rechazada')).toEqual({ texto: 'Rechazada', estado: 'error' });
    expect(totalPiezas([{ piezas: 24 }, { piezas: 12 }])).toBe(36);
  });

  it('"Te quedan N" descuenta lo capturado en esta venta; si no alcanza, dice cuanto falta', () => {
    expect(textoTeQuedan(20, 0)).toEqual({ texto: 'Te quedan 20', falta: false });
    expect(textoTeQuedan(20, 20)).toEqual({ texto: 'Te quedan 0', falta: false });
    expect(textoTeQuedan(20, 21)).toEqual({ texto: 'Falta 1 pieza', falta: true });
    expect(textoTeQuedan(20, 26)).toEqual({ texto: 'Faltan 6 piezas', falta: true });
  });

  it('faltantesDeCaptura: textos para la revision, con regalos y sin los que no tienen presentacion', () => {
    const disponibles = existenciasDatos(
      [{ id: 'c', fecha: HOY, numero: 1, estado: 'aceptada', activo: 1, lineas: [{ presentacion_id: 'pre-1', piezas: 20 }] }],
      [],
      HOY,
    );
    expect(
      faltantesDeCaptura({
        controlInventario: true,
        existencias: disponibles,
        lineas: [
          { presentacionId: 'pre-1', etiqueta: 'Horchata 1 L', cantidad: 21 },
          { presentacionId: 'pre-2', etiqueta: 'Jamaica 500 ml', cantidad: Number.NaN },
        ],
        regalos: [
          { presentacionId: 'pre-1', cantidad: 2 },
          { presentacionId: null, cantidad: 5 },
        ],
      }),
    ).toEqual(['Horchata 1 L: faltan 3 piezas']);
    expect(
      faltantesDeCaptura({
        controlInventario: false,
        existencias: new Map(),
        lineas: [{ presentacionId: 'pre-1', etiqueta: 'Horchata 1 L', cantidad: 9 }],
        regalos: [],
      }),
    ).toEqual([]);
  });
});

describe('crearRespondedorCarga', () => {
  it('200: aplica la carga que contesto el servidor y el candado se queda cerrado', async () => {
    const respondedor = crearRespondedorCarga();
    const p = pasos([{ tipo: 'ok', carga: CARGA }]);
    await expect(respondedor.responder(p)).resolves.toEqual({ estado: 'respondida', carga: CARGA });
    expect(p.aplicar).toHaveBeenCalledWith(CARGA);
    expect(p.sincronizar).not.toHaveBeenCalled();
    await expect(respondedor.responder(pasos([{ tipo: 'ok', carga: CARGA }]))).resolves.toBeNull();
  });

  it('Review Focus 3: dos toques seguidos llaman una sola vez al servidor', async () => {
    const respondedor = crearRespondedorCarga();
    const p = pasos([{ tipo: 'ok', carga: CARGA }]);
    const [primero, segundo] = await Promise.all([respondedor.responder(p), respondedor.responder(p)]);
    expect(primero).toEqual({ estado: 'respondida', carga: CARGA });
    expect(segundo).toBeNull();
    expect(p.responder).toHaveBeenCalledTimes(1);
  });

  it('Review Focus 2: un 409 aplica la carga nueva, sincroniza y suelta el candado', async () => {
    const respondedor = crearRespondedorCarga();
    const nueva = { ...CARGA, estado: 'pendiente' as const, version: 2, respondida_en: null };
    const p = pasos([{ tipo: 'cambio', carga: nueva }]);
    await expect(respondedor.responder(p)).resolves.toEqual({ estado: 'cambio', mensaje: MENSAJE_CARGA_CAMBIO });
    expect(p.aplicar).toHaveBeenCalledWith(nueva);
    expect(p.sincronizar).toHaveBeenCalledTimes(1);
    // Revisa la nueva y vuelve a tocar: ahora si responde.
    const otra = pasos([{ tipo: 'ok', carga: { ...nueva, estado: 'aceptada' } }]);
    await expect(respondedor.responder(otra)).resolves.toMatchObject({ estado: 'respondida' });
  });

  it('Review Focus 4: un 404 sincroniza y avisa que se eliminó', async () => {
    const respondedor = crearRespondedorCarga();
    const p = pasos([{ tipo: 'inexistente' }]);
    await expect(respondedor.responder(p)).resolves.toEqual({
      estado: 'eliminada',
      mensaje: MENSAJE_CARGA_ELIMINADA,
    });
    expect(p.sincronizar).toHaveBeenCalledTimes(1);
    expect(p.aplicar).not.toHaveBeenCalled();
  });

  it('sin red: "Conéctate al WiFi para aceptar la carga." y se puede reintentar', async () => {
    const respondedor = crearRespondedorCarga();
    await expect(respondedor.responder(pasos([new Error('sin red')]))).resolves.toEqual({
      estado: 'sin-red',
      mensaje: MENSAJE_SIN_RED_CARGA,
    });
    expect(MENSAJE_SIN_RED_CARGA).toBe('Conéctate al WiFi para aceptar la carga.');
    await expect(respondedor.responder(pasos([{ tipo: 'ok', carga: CARGA }]))).resolves.toMatchObject({
      estado: 'respondida',
    });
  });

  it('401: sincroniza (que renueva por su camino normal) y reintenta UNA vez', async () => {
    const respondedor = crearRespondedorCarga();
    const p = pasos([{ tipo: 'sesion' }, { tipo: 'ok', carga: CARGA }]);
    await expect(respondedor.responder(p)).resolves.toMatchObject({ estado: 'respondida' });
    expect(p.sincronizar).toHaveBeenCalledTimes(1);
    expect(p.responder).toHaveBeenCalledTimes(2);

    const otro = crearRespondedorCarga();
    const sinSesion = pasos([{ tipo: 'sesion' }, { tipo: 'sesion' }]);
    await expect(otro.responder(sinSesion)).resolves.toEqual({
      estado: 'sin-sesion',
      mensaje: MENSAJE_SESION_CARGA,
    });
  });

  it('400: el mensaje del servidor', async () => {
    const respondedor = crearRespondedorCarga();
    await expect(
      respondedor.responder(pasos([{ tipo: 'invalida', mensaje: 'Aceptar una carga no lleva motivo.' }])),
    ).resolves.toEqual({ estado: 'invalida', mensaje: 'Aceptar una carga no lleva motivo.' });
  });
});
```

`npm test --workspace=apps/tablet -- estado/inventario` → falla al resolver `./inventario`.

- [ ] **Paso 4: la lógica de pantalla**

`apps/tablet/src/estado/inventario.ts`:

```ts
import { faltantesDeVenta, textoFaltante, type Existencia } from '@/datos/inventario-reglas';
import type { Booleano, EstadoCarga, FechaISO } from '@/datos/tipos';
import type { ResultadoApiCarga } from '@/sincronizacion/api-carga';
import type { CargaPull, CuerpoRespuestaCarga } from '@/sincronizacion/contrato';

/**
 * Inventario del vendedor en las pantallas (T-27 pieza 1), sin React: las
 * reglas de la capa de datos (reexportadas, son las mismas que usa
 * `ventas.registrar`) mas lo que solo es de pantalla: la respuesta a una carga
 * con su guardia de doble toque, los textos y los faltantes de la revision.
 */
export {
  bloqueoDeVenta,
  cargaPendiente,
  existencias,
  faltantesDeVenta,
  MOTIVO_CARGA_PENDIENTE,
  textoFaltante,
} from '@/datos/inventario-reglas';
export type {
  CargaInventario,
  Existencia,
  Faltante,
  LineaVentaInventario,
  PiezasDePresentacion,
} from '@/datos/inventario-reglas';

/** El mismo 300 del servidor (`reglas-carga.ts`) y del check de `carga.motivo_rechazo`. */
export const LARGO_MAX_MOTIVO_RECHAZO = 300;

export const MENSAJE_SIN_RED_CARGA = 'Conéctate al WiFi para aceptar la carga.';
export const MENSAJE_CARGA_CAMBIO = 'La carga cambió en el almacén; revísala de nuevo.';
export const MENSAJE_CARGA_ELIMINADA = 'El almacén eliminó esta carga.';
export const MENSAJE_SESION_CARGA =
  'Tu sesión ya no vale. Vuelve a entrar con el WiFi del negocio.';
export const NOTA_CONTROL_APAGADO = 'El control de inventario de tu sucursal está apagado';

export type AccionCarga = 'aceptar' | 'rechazar';

/** Errores de forma de la respuesta (D2: rechazar lleva motivo). */
export function validarRespuesta(accion: AccionCarga, motivo: string): string[] {
  if (accion === 'aceptar') return [];
  const texto = motivo.trim();
  if (texto === '') return ['Escribe por qué rechazas la carga.'];
  if (texto.length > LARGO_MAX_MOTIVO_RECHAZO) {
    return [`El motivo lleva hasta ${LARGO_MAX_MOTIVO_RECHAZO} caracteres.`];
  }
  return [];
}

/**
 * El cuerpo del endpoint. `version` es la de la carga QUE SE PINTO: si el
 * portal la cambio, el servidor contesta 409 y el vendedor nunca acepta lo que
 * no vio (Review Focus 2).
 */
export function cuerpoRespuesta(
  accion: AccionCarga,
  motivo: string,
  version: number,
): CuerpoRespuestaCarga {
  return accion === 'aceptar'
    ? { version, accion }
    : { version, accion, motivo: motivo.trim() };
}

/** Aceptar/Rechazar solo en una carga pendiente, viva y de hoy. */
export function puedeResponder(
  carga: { estado: EstadoCarga; activo: Booleano; fecha: FechaISO },
  hoy: FechaISO,
): boolean {
  return carga.estado === 'pendiente' && carga.activo === 1 && carga.fecha === hoy;
}

/** Subconjunto de `Estado` de `@/ui/pantalla` (un .tsx no corre en Jest). */
export function pastillaCarga(estado: EstadoCarga): {
  texto: string;
  estado: 'pendiente' | 'listo' | 'error';
} {
  if (estado === 'aceptada') return { texto: 'Aceptada', estado: 'listo' };
  if (estado === 'rechazada') return { texto: 'Rechazada', estado: 'error' };
  return { texto: 'Por aceptar', estado: 'pendiente' };
}

export function totalPiezas(lineas: readonly { piezas: number }[]): number {
  return lineas.reduce((total, l) => total + l.piezas, 0);
}

/**
 * "Te quedan N" bajo cada presentacion de la venta: la existencia menos lo que
 * ya va en esta captura (vendido + regalado). Si no alcanza, dice cuanto falta.
 */
export function textoTeQuedan(
  existencia: number,
  enEstaVenta: number,
): { texto: string; falta: boolean } {
  const quedan = existencia - enEstaVenta;
  if (quedan >= 0) return { texto: `Te quedan ${quedan}`, falta: false };
  const faltan = -quedan;
  return { texto: faltan === 1 ? 'Falta 1 pieza' : `Faltan ${faltan} piezas`, falta: true };
}

/**
 * Los faltantes de la captura como textos para la revision ("Horchata 1 L:
 * faltan 3 piezas"). La pantalla los calcula al tocar "Revisar" y los congela
 * (no se recalculan con la firma a medias); `ventas.registrar` vuelve a
 * comprobar al grabar. Un regalo sin presentacion elegida no cuenta todavia.
 */
export function faltantesDeCaptura({
  controlInventario,
  existencias: disponibles,
  lineas,
  regalos,
}: {
  controlInventario: boolean;
  existencias: ReadonlyMap<string, Existencia>;
  lineas: readonly { presentacionId: string; etiqueta: string; cantidad: number }[];
  regalos: readonly { presentacionId: string | null; cantidad: number }[];
}): string[] {
  const etiquetas = new Map(lineas.map((l) => [l.presentacionId, l.etiqueta] as const));
  return faltantesDeVenta({
    controlInventario,
    existencias: disponibles,
    lineas: lineas.map((l) => ({ presentacionId: l.presentacionId, cantidad: l.cantidad })),
    regalos: regalos.flatMap((r) =>
      r.presentacionId === null ? [] : [{ presentacionId: r.presentacionId, cantidad: r.cantidad }],
    ),
  }).map((f) => textoFaltante(etiquetas.get(f.presentacionId) ?? 'Un producto', f.faltan));
}

/** Los pasos de responder, inyectados para probar el orden y la guardia sin pantalla. */
export interface PasosRespuestaCarga {
  /** Llama al servidor. Lanza si no hay red. */
  responder(): Promise<ResultadoApiCarga>;
  /** Escribe en la `carga` local la carga que contesto el servidor. */
  aplicar(carga: CargaPull): void;
  /** La sincronizacion normal (pull + push; renueva la sesion como primer paso). */
  sincronizar(): Promise<unknown>;
}

export type ResultadoRespuestaCarga =
  | { estado: 'respondida'; carga: CargaPull }
  | { estado: 'cambio' | 'eliminada' | 'sin-red' | 'invalida' | 'sin-sesion'; mensaje: string };

export interface RespondedorCarga {
  /** `null` = se ignoro: ya hay una respuesta en curso (o ya se respondio). */
  responder(pasos: PasosRespuestaCarga): Promise<ResultadoRespuestaCarga | null>;
}

/** Una sincronizacion que falla no cambia lo que se le dice al vendedor. */
async function sincronizarSinFallar(pasos: PasosRespuestaCarga): Promise<void> {
  try {
    await pasos.sincronizar();
  } catch {
    // Sin red o sin sesion: la pantalla ya tiene su mensaje.
  }
}

async function intentar(pasos: PasosRespuestaCarga): Promise<ResultadoRespuestaCarga> {
  let resultado: ResultadoApiCarga;
  try {
    resultado = await pasos.responder();
    if (resultado.tipo === 'sesion') {
      // El token de acceso vencio: la sincronizacion lo renueva por su camino
      // normal (nunca se renueva desde aqui) y se reintenta una sola vez.
      await sincronizarSinFallar(pasos);
      resultado = await pasos.responder();
    }
  } catch {
    return { estado: 'sin-red', mensaje: MENSAJE_SIN_RED_CARGA };
  }

  switch (resultado.tipo) {
    case 'ok':
      pasos.aplicar(resultado.carga);
      return { estado: 'respondida', carga: resultado.carga };
    case 'cambio':
      if (resultado.carga) pasos.aplicar(resultado.carga);
      await sincronizarSinFallar(pasos);
      return { estado: 'cambio', mensaje: MENSAJE_CARGA_CAMBIO };
    case 'inexistente':
      await sincronizarSinFallar(pasos);
      return { estado: 'eliminada', mensaje: MENSAJE_CARGA_ELIMINADA };
    case 'invalida':
      return { estado: 'invalida', mensaje: resultado.mensaje };
    case 'sesion':
      return { estado: 'sin-sesion', mensaje: MENSAJE_SESION_CARGA };
  }
}

/**
 * Responder una carga con la **guardia de doble toque** dentro: la llamada es
 * asincrona y con red lenta un segundo toque no debe mandar otra respuesta
 * (Review Focus 3; el servidor ademas es idempotente). El candado se suelta si
 * algo impidio responder (para reintentar); tras responder se queda cerrado.
 * La pantalla lo guarda en un `useRef`.
 */
export function crearRespondedorCarga(): RespondedorCarga {
  let cerrado = false;
  return {
    async responder(pasos) {
      if (cerrado) return null;
      cerrado = true;
      const resultado = await intentar(pasos);
      if (resultado.estado !== 'respondida') cerrado = false;
      return resultado;
    },
  };
}
```

`npm test --workspace=apps/tablet -- estado/inventario api-carga` → verde.

- [ ] **Paso 5: `responderCarga` en la sesión**

En `apps/tablet/src/estado/proveedor-sesion.tsx`:

1. Imports:

```ts
import { crearClienteCargas, type ResultadoApiCarga } from '@/sincronizacion/api-carga';
import type { CuerpoRespuestaCarga } from '@/sincronizacion/contrato';
```

2. En `interface ContextoSesion`, después de `descargarFotoCliente`:

```ts
  /**
   * T-27 (D6): aceptar o rechazar una carga, con red y en el momento. Usa el
   * token de acceso actual y **nunca renueva la sesion** (como
   * `descargarFotoCliente`): un 401 vuelve como `{ tipo: 'sesion' }` y la
   * pantalla sincroniza, que renueva por su camino normal
   * (`crearRespondedorCarga`). Sin red lanza `SinRedError`.
   */
  responderCarga: (cargaId: string, cuerpo: CuerpoRespuestaCarga) => Promise<ResultadoApiCarga>;
```

3. Junto a los demás `useState` de clientes (después de `const [motor] = …`):

```ts
  const [clienteCargas] = useState(() => crearClienteCargas());
```

4. Antes de `const valor = useMemo…`:

```ts
  const responderCarga = useCallback(
    async (cargaId: string, cuerpo: CuerpoRespuestaCarga): Promise<ResultadoApiCarga> => {
      const token = gestor.sesionGuardada()?.tokenAcceso ?? null;
      if (token === null) return { tipo: 'sesion' };
      return clienteCargas.responder(token, cargaId, cuerpo);
    },
    [gestor, clienteCargas],
  );
```

5. Agrega `responderCarga` al objeto de `valor` y a sus dependencias.

- [ ] **Paso 6: la entrada real del menú**

`apps/tablet/src/estado/ruta-del-dia.spec.ts`, en `describe('menu hamburguesa (D9, D16)', …)`:

1. La lista esperada de la primera prueba cambia la fila de Inventario por
   `['Inventario', '/(jornada)/inventario'],`.
2. "con el dia cerrado se deshabilita solo lo que captura" espera `['gastos', 'merma']`.
3. Agrega:

```ts
  it('Inventario ya no es una seccion pendiente (T-27): abre su pantalla y se consulta con el dia cerrado', () => {
    expect(esSeccionPendiente('inventario')).toBe(false);
    const inventario = entradasMenu(true).find((e) => e.clave === 'inventario');
    expect(inventario).toMatchObject({
      titulo: 'Inventario',
      destino: '/(jornada)/inventario',
      deshabilitada: false,
    });
    expect(inventario?.descripcion).not.toMatch(/Pendiente/);
  });
```

`npm test --workspace=apps/tablet -- ruta-del-dia` → falla.

`apps/tablet/src/estado/ruta-del-dia.ts`:

1. `SECCIONES_PENDIENTES` queda solo con `merma` (borra la entrada `inventario`).
2. En `entradasMenu`, reemplaza el bloque `...(['inventario', 'merma'] as const).map(…)` por:

```ts
    {
      clave: 'inventario',
      titulo: 'Inventario',
      descripcion: 'Tu carga, tus recargas y lo que te queda',
      destino: '/(jornada)/inventario',
      // T-27: es consulta (y aceptar la carga de la manana); se ve con el dia cerrado.
      deshabilitada: false,
    },
    {
      clave: 'merma',
      titulo: SECCIONES_PENDIENTES.merma.titulo,
      descripcion: `Pendiente: ${SECCIONES_PENDIENTES.merma.ticket}`,
      destino: '/(jornada)/pendiente/merma',
      deshabilitada: diaCerrado,
    },
```

3. Actualiza el comentario de `entradasMenu`: "se deshabilita solo lo que captura (gastos, merma; T-30/T-31 dio a
   Gastos su pantalla y T-27 a Inventario)".

`npm test --workspace=apps/tablet -- ruta-del-dia` → verde. (La pantalla `/(jornada)/inventario` la crea la Tarea 7;
hasta entonces la entrada lleva a una ruta inexistente: no se publica nada entre tareas.)

- [ ] **Paso 7: typecheck, lint, pruebas y commit**

```bash
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm test --workspace=apps/tablet
git add apps/tablet/src/sincronizacion/api-carga.ts apps/tablet/src/sincronizacion/api-carga.spec.ts apps/tablet/src/estado/inventario.ts apps/tablet/src/estado/inventario.spec.ts apps/tablet/src/estado/proveedor-sesion.tsx apps/tablet/src/estado/ruta-del-dia.ts apps/tablet/src/estado/ruta-del-dia.spec.ts
git commit -m "T-27 (tablet): respuesta a la carga con guardia de doble toque, textos del inventario y entrada del menú

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

> **Controlador (emulador, al final de la tarea):** sin pantalla nueva todavía; comprueba que la app compila y abre
> (Metro de este worktree) y que el menú muestra "Inventario · Tu carga, tus recargas y lo que te queda". Tocarla aún
> da "ruta no encontrada": es esperado hasta la Tarea 7. La prueba real de la respuesta va al final de la Tarea 7.

---

### Tarea 7: Tablet, pantallas: Inventario, detalle de la carga, aviso en la ruta y venta con existencia — con la prueba en el emulador (pantallas del spec, D2, D3, D4, D6, D9)

**Files:**
- Create: `apps/tablet/app/(jornada)/inventario/index.tsx`
- Create: `apps/tablet/app/(jornada)/inventario/[cargaId].tsx`
- Modify: `apps/tablet/app/(jornada)/_layout.tsx` (dos `Stack.Screen`)
- Modify: `apps/tablet/app/(jornada)/index.tsx` (aviso "Tienes una carga por aceptar")
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx` (bloqueo, "Te quedan N", faltantes en la
  revisión)

**Interfaces:**
- Consumes: `datos.cargas` (`delDia`, `porId`, `pendienteDeHoy`, `controlInventario`, `paraVenta`,
  `filasInventario`, `aplicarRespuesta`) de la Tarea 5; `crearRespondedorCarga`, `cuerpoRespuesta`,
  `validarRespuesta`, `puedeResponder`, `pastillaCarga`, `totalPiezas`, `textoTeQuedan`, `faltantesDeCaptura`,
  `MOTIVO_CARGA_PENDIENTE`, `NOTA_CONTROL_APAGADO`, `LARGO_MAX_MOTIVO_RECHAZO` de `@/estado/inventario`;
  `useSesion().responderCarga`/`sincronizar` (Tarea 6); `Boton`, `Campo`, `Cifra`, `Pantalla`, `Pastilla`, `Tarjeta`.
- Produces: rutas `/(jornada)/inventario` y `/(jornada)/inventario/[cargaId]`. Sin lógica nueva: todo lo que se decide
  ya tiene prueba en las Tareas 5 y 6.

> El implementador (subagente) para después del Paso 6 (typecheck, lint, pruebas y commit) y **reporta**. El Paso 7 es
> del **controlador**, en el emulador y el navegador. La tarea no está terminada sin ese visto bueno.

- [ ] **Paso 1: las rutas en el layout**

En `apps/tablet/app/(jornada)/_layout.tsx`, después de `<Stack.Screen name="gastos/registrar" … />`:

```tsx
      <Stack.Screen name="inventario/index" options={{ title: 'Inventario' }} />
      <Stack.Screen name="inventario/[cargaId]" options={{ title: 'Carga' }} />
```

- [ ] **Paso 2: la pantalla Inventario**

`apps/tablet/app/(jornada)/inventario/index.tsx`:

```tsx
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';

import { NOTA_CONTROL_APAGADO, pastillaCarga, totalPiezas } from '@/estado/inventario';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { Boton } from '@/ui/boton';
import { Cifra } from '@/ui/cifra';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/**
 * Inventario (T-27 pieza 1, entrada del menu): las cargas de hoy con su estado y
 * total, y por presentacion Cargado − Vendido − Regalado = Existencia. Con el
 * control apagado se muestra igual, con la nota. Toda la cuenta vive en
 * `inventario-reglas.ts` (con pruebas); aqui solo se pinta.
 */
export default function Inventario() {
  const { datos, vendedor, versionCatalogos } = useJawa();
  const { ultimaSincronizacion } = useSesion();
  const { estilos } = useTema();

  // `versionCatalogos` sube cuando el pull o una respuesta escriben cargas, y
  // cuando una venta publica su cambio; al volver de vender ya esta al dia.
  const vista = useMemo(() => {
    void versionCatalogos;
    void ultimaSincronizacion;
    if (!vendedor) return { cargas: [], filas: [], control: false };
    return {
      cargas: datos.cargas.delDia(vendedor.id),
      filas: datos.cargas.filasInventario(vendedor.id),
      control: datos.cargas.controlInventario(vendedor.id),
    };
  }, [datos, vendedor, versionCatalogos, ultimaSincronizacion]);

  return (
    <Pantalla
      titulo="Inventario"
      subtitulo="Lo que traes hoy: tus cargas aceptadas menos lo que vendiste y regalaste."
    >
      {!vista.control ? (
        <Tarjeta estado="pendiente" etiqueta="Control apagado">
          <Text style={estilos.textoTarjeta}>{NOTA_CONTROL_APAGADO}.</Text>
          <Text style={estilos.textoSuave}>Puedes vender como siempre; el inventario se muestra igual.</Text>
        </Tarjeta>
      ) : null}

      <Text style={estilos.seccion}>Cargas de hoy</Text>
      {vista.cargas.length === 0 ? (
        <Tarjeta etiqueta="Sin cargas">
          <Text style={estilos.textoSuave}>
            El almacén todavía no te registra carga hoy. Cuando te la entreguen, toca Refrescar en la ruta.
          </Text>
        </Tarjeta>
      ) : (
        vista.cargas.map((c) => {
          const p = pastillaCarga(c.estado);
          return (
            <Tarjeta key={c.id} estado={p.estado} etiqueta={`Carga n.º ${c.numero}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: espacio.sm }}>
                <Pastilla texto={p.texto} estado={p.estado} />
                <Text style={estilos.textoSuave}>
                  <Cifra valor={totalPiezas(c.lineas)} tono="suave" /> piezas
                </Text>
              </View>
              {c.estado === 'rechazada' && c.motivo_rechazo ? (
                <Text style={estilos.error}>La rechazaste: {c.motivo_rechazo}</Text>
              ) : null}
              <Boton
                etiqueta={c.estado === 'pendiente' ? 'Revisar y aceptar' : 'Ver la carga'}
                tono={c.estado === 'pendiente' ? 'primaria' : 'neutra'}
                glifo="→"
                ancho="ajustado"
                onPress={() =>
                  router.push({ pathname: '/(jornada)/inventario/[cargaId]', params: { cargaId: c.id } })
                }
                estilo={{ marginTop: espacio.sm }}
              />
            </Tarjeta>
          );
        })
      )}

      <Text style={estilos.seccion}>Por presentación</Text>
      {vista.filas.length === 0 ? (
        <Tarjeta etiqueta="Sin producto">
          <Text style={estilos.textoSuave}>Acepta una carga para ver lo que traes.</Text>
        </Tarjeta>
      ) : (
        <Tarjeta etiqueta="Cargado − Vendido − Regalado = Existencia">
          {vista.filas.map((f) => (
            <View
              key={f.presentacionId}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: espacio.sm,
                marginBottom: espacio.xs,
              }}
            >
              <Text style={[estilos.textoTarjeta, { flexShrink: 1 }]}>{f.etiqueta}</Text>
              <Text style={estilos.textoSuave}>
                <Cifra valor={f.cargado} tono="suave" /> − <Cifra valor={f.vendido} tono="suave" /> −{' '}
                <Cifra valor={f.regalado} tono="suave" /> ={' '}
                <Cifra valor={f.existencia} tono={f.existencia <= 0 ? 'peligro' : 'tinta'} />
              </Text>
            </View>
          ))}
        </Tarjeta>
      )}
    </Pantalla>
  );
}
```

- [ ] **Paso 3: el detalle de una carga (Aceptar / Rechazar)**

`apps/tablet/app/(jornada)/inventario/[cargaId].tsx`:

```tsx
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import {
  crearRespondedorCarga,
  cuerpoRespuesta,
  LARGO_MAX_MOTIVO_RECHAZO,
  pastillaCarga,
  puedeResponder,
  totalPiezas,
  validarRespuesta,
  type AccionCarga,
} from '@/estado/inventario';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Cifra } from '@/ui/cifra';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/**
 * Una carga (T-27, D2/D6): sus lineas y, si esta pendiente, Aceptar o Rechazar
 * (con motivo). La respuesta viaja con red y con la version que se pinta: si el
 * almacen la cambio, el servidor contesta 409 y aqui se ve la nueva. Sin red no
 * se acepta.
 */
export default function DetalleCarga() {
  const { cargaId } = useLocalSearchParams<{ cargaId: string }>();
  const { datos, versionCatalogos } = useJawa();
  const { responderCarga, sincronizar } = useSesion();
  const { estilos } = useTema();
  const hoy = datos.deps.reloj.hoy();

  // `versionCatalogos`: la respuesta (200 o 409) y el pull reescriben la carga.
  const carga = useMemo(() => {
    void versionCatalogos;
    return datos.cargas.porId(cargaId);
  }, [datos, cargaId, versionCatalogos]);

  // Guardia de doble toque (Review Focus 3): UN respondedor por pantalla. El
  // argumento de `useRef` se evalua en cada render, pero solo el primero se queda.
  const respondedor = useRef(crearRespondedorCarga()).current;
  const [enviando, setEnviando] = useState<AccionCarga | null>(null);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [aviso, setAviso] = useState<{ texto: string; error: boolean } | null>(null);

  if (!carga) {
    return (
      <Pantalla titulo="Carga no encontrada" subtitulo="No está en esta tablet.">
        <Boton etiqueta="Volver al inventario" glifo="←" tono="neutra" onPress={() => router.back()} />
      </Pantalla>
    );
  }

  const respondible = puedeResponder(carga, hoy);
  const pastilla = pastillaCarga(carga.estado);

  async function responder(accion: AccionCarga, actual: NonNullable<typeof carga>) {
    const problemas = validarRespuesta(accion, motivo);
    if (problemas.length > 0) {
      setAviso({ texto: problemas.join(' '), error: true });
      return;
    }
    // La version de la carga QUE SE VE (Review Focus 2).
    const cuerpo = cuerpoRespuesta(accion, motivo, actual.version);
    setEnviando(accion);
    setAviso(null);
    const resultado = await respondedor.responder({
      responder: () => responderCarga(actual.id, cuerpo),
      aplicar: (respondida) => datos.cargas.aplicarRespuesta(respondida),
      sincronizar,
    });
    // Segundo toque mientras el primero corre: el primero se encarga de todo.
    if (resultado === null) return;
    setEnviando(null);
    if (resultado.estado === 'respondida') {
      setRechazando(false);
      setMotivo('');
      setAviso({
        texto:
          resultado.carga.estado === 'aceptada'
            ? 'Carga aceptada. Ya cuenta en tu inventario.'
            : 'Carga rechazada. El almacén la corregirá y te la volverá a mandar.',
        error: false,
      });
      return;
    }
    setAviso({ texto: resultado.mensaje, error: true });
  }

  return (
    <Pantalla
      titulo={`Carga n.º ${carga.numero}`}
      subtitulo={`${carga.fecha} · revisa las piezas con el almacenista`}
    >
      <View style={{ marginBottom: espacio.md }}>
        <Pastilla
          texto={carga.activo === 1 ? pastilla.texto : 'Eliminada'}
          estado={carga.activo === 1 ? pastilla.estado : 'error'}
        />
      </View>

      <Tarjeta etiqueta="Productos">
        {carga.lineas.map((l) => (
          <View
            key={l.presentacion_id}
            style={{ flexDirection: 'row', justifyContent: 'space-between', gap: espacio.sm, marginBottom: espacio.xs }}
          >
            <Text style={[estilos.textoTarjeta, { flexShrink: 1 }]}>{l.etiqueta}</Text>
            <Cifra valor={l.piezas} />
          </View>
        ))}
      </Tarjeta>

      <Tarjeta estado="accion" etiqueta="Total">
        <Cifra valor={totalPiezas(carga.lineas)} tamano="destacado" />
        <Text style={estilos.textoSuave}>piezas</Text>
      </Tarjeta>

      {carga.estado === 'rechazada' && carga.motivo_rechazo ? (
        <Text style={estilos.error}>La rechazaste: {carga.motivo_rechazo}</Text>
      ) : null}
      {carga.activo === 0 ? (
        <Text style={estilos.error}>El almacén eliminó esta carga: ya no cuenta en tu inventario.</Text>
      ) : null}
      {aviso ? <Text style={aviso.error ? estilos.error : estilos.textoTarjeta}>{aviso.texto}</Text> : null}

      {respondible && rechazando ? (
        <Tarjeta estado="error" etiqueta="Rechazar la carga">
          <Campo
            etiqueta="¿Por qué la rechazas?"
            value={motivo}
            onChangeText={setMotivo}
            maxLength={LARGO_MAX_MOTIVO_RECHAZO}
            multiline
            editable={enviando === null}
          />
          <View style={estilos.filaAcciones}>
            <Boton
              etiqueta="Volver"
              tono="neutra"
              glifo="←"
              deshabilitado={enviando !== null}
              onPress={() => {
                setRechazando(false);
                setAviso(null);
              }}
            />
            <Boton
              etiqueta="Enviar rechazo"
              tono="peligro"
              glifo="×"
              ocupado={enviando === 'rechazar'}
              onPress={() => void responder('rechazar', carga)}
            />
          </View>
        </Tarjeta>
      ) : null}

      {respondible && !rechazando ? (
        // Opuestas en tres ejes (sistema de diseño): Aceptar es confirmar con ✓;
        // Rechazar es peligro con ×.
        <View style={[estilos.filaAcciones, { marginTop: espacio.lg, marginBottom: espacio.xl }]}>
          <Boton
            etiqueta="Rechazar"
            tono="peligro"
            glifo="×"
            deshabilitado={enviando !== null}
            onPress={() => {
              setRechazando(true);
              setAviso(null);
            }}
          />
          <Boton
            etiqueta="Aceptar"
            tono="confirmar"
            glifo="✓"
            ocupado={enviando === 'aceptar'}
            onPress={() => void responder('aceptar', carga)}
          />
        </View>
      ) : null}

      {!respondible ? (
        <Boton
          etiqueta="Volver al inventario"
          tono="neutra"
          glifo="←"
          onPress={() => router.back()}
          estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
        />
      ) : null}
    </Pantalla>
  );
}
```

- [ ] **Paso 4: el aviso en la pantalla principal**

En `apps/tablet/app/(jornada)/index.tsx`:

1. Imports: `import { MOTIVO_CARGA_PENDIENTE, totalPiezas } from '@/estado/inventario';` y
   `import { Cifra } from '@/ui/cifra';`.
2. Después del `useMemo` de `pendientes`:

```tsx
  // T-27 (D9): sin notificaciones push, la pantalla principal avisa de la carga
  // por aceptar mientras exista una pendiente de hoy, con o sin control (el aviso
  // no bloquea nada por si mismo).
  const cargaPorAceptar = useMemo(() => {
    void vueltas;
    void versionCatalogos;
    void ultimaSincronizacion;
    return vendedor ? datos.cargas.pendienteDeHoy(vendedor.id) : null;
  }, [datos, vendedor, vueltas, versionCatalogos, ultimaSincronizacion]);
```

3. Dentro del `ScrollView`, justo después del bloque `{ultimaSincronizacion && !ultimaSincronizacion.ok ? … : null}`:

```tsx
          {cargaPorAceptar ? (
            <Tarjeta estado="accion" etiqueta="Carga por aceptar">
              <Text style={estilos.textoTarjeta}>{MOTIVO_CARGA_PENDIENTE}</Text>
              <Text style={estilos.textoSuave}>
                Carga n.º {cargaPorAceptar.numero} ·{' '}
                <Cifra valor={totalPiezas(cargaPorAceptar.lineas)} tono="suave" /> piezas
              </Text>
              <Boton
                etiqueta="Ver la carga"
                glifo="→"
                ancho="ajustado"
                onPress={() =>
                  router.push({
                    pathname: '/(jornada)/inventario/[cargaId]',
                    params: { cargaId: cargaPorAceptar.id },
                  })
                }
                estilo={{ marginTop: espacio.sm }}
              />
            </Tarjeta>
          ) : null}
```

- [ ] **Paso 5: la venta con existencia**

En `apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx`:

1. Import: `import { faltantesDeCaptura, textoTeQuedan } from '@/estado/inventario';`.
2. Después del `useMemo` de `promociones`:

```tsx
  // T-27 (D3, D4): bloqueo y existencias al abrir (y cuando el pull o una
  // respuesta escriben). Solo para pintar: `ventas.registrar` vuelve a calcular
  // al grabar, con la base de ese momento (Review Focus 1).
  const inventario = useMemo(() => {
    void versionCatalogos;
    return vendedor ? datos.cargas.paraVenta(vendedor.id) : null;
  }, [datos, vendedor, versionCatalogos]);
```

3. Después de `const [problemas, setProblemas] = …`:

```tsx
  /**
   * T-27 (D4): los faltantes que ve la revision. Se calculan al tocar "Revisar"
   * y se CONGELAN: nada de la revision cambia mientras el cliente firma
   * (leccion de T-73: re-renderizar a medio gesto corta el trazo).
   */
  const [faltantesRevision, setFaltantesRevision] = useState<string[]>([]);
```

4. `revisar` queda:

```tsx
  function revisar() {
    const encontrados = [
      ...problemasDeCaptura({ numNota, contadoCredito, comentarios, lineas }),
      ...problemasDeRegalos(regalos),
    ];
    setProblemas(encontrados);
    if (encontrados.length > 0) return;
    setFaltantesRevision(
      faltantesDeCaptura({
        controlInventario: inventario?.controlInventario ?? false,
        existencias: inventario?.existencias ?? new Map(),
        lineas: lineas.map((l) => ({
          presentacionId: l.presentacionId,
          etiqueta: l.etiqueta,
          cantidad: l.cantidad,
        })),
        regalos,
      }),
    );
    setPaso('revision');
  }
```

5. En `volverACaptura`, después de `setProblemas([]);`, agrega `setFaltantesRevision([]);`.
6. En la revisión, **antes** de la tarjeta "Firma del cliente":

```tsx
        {faltantesRevision.length > 0 ? (
          <Tarjeta estado="error" etiqueta="No te alcanza el producto">
            {faltantesRevision.map((f) => (
              <Text key={f} style={estilos.textoTarjeta}>
                {f}
              </Text>
            ))}
            <Text style={estilos.textoSuave}>Corrige las cantidades o acepta una recarga en Inventario.</Text>
          </Tarjeta>
        ) : null}
```

   y el `deshabilitado` de "Grabar venta" queda
   `deshabilitado={!puedeGrabarVenta({ contadoCredito, trazos: firma.trazos, grabando }) || faltantesRevision.length > 0}`.

7. Justo antes del comentario `/* 1. Captura */` (es decir, después de los `return` de "grabada" y "revision"):

```tsx
  // T-27 (D3): con el control prendido y una carga por aceptar, en lugar de la
  // captura va el motivo y el camino a Inventario. SOLO en la captura: si la
  // carga llega con la revision abierta (y la firma a medias), la pantalla no
  // cambia; `ventas.registrar` la rechaza al grabar.
  if (inventario?.bloqueo) {
    return (
      <Pantalla titulo={`Venta · ${nombreCliente}`} subtitulo="Antes de vender acepta tu carga.">
        <Tarjeta estado="pendiente" etiqueta="Carga por aceptar">
          <Text style={estilos.textoTarjeta}>{inventario.bloqueo}.</Text>
          <Text style={estilos.textoSuave}>
            Revisa las piezas con el almacenista y acéptala en Inventario; después podrás vender.
          </Text>
        </Tarjeta>
        <Boton
          etiqueta="Ir a Inventario"
          glifo="→"
          onPress={() => router.push('/(jornada)/inventario')}
          estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
        />
      </Pantalla>
    );
  }
```

8. En la captura, dentro de `presentaciones.map((p) => { … })`, después de `const sinPrecio = …`:

```tsx
          // T-27 (D4): lo que queda de esta presentacion si se graba lo capturado
          // (vendido + regalado en esta venta). Solo con el control prendido.
          const quedan = inventario?.controlInventario
            ? textoTeQuedan(
                inventario.existencias.get(p.presentacion_id)?.existencia ?? 0,
                (cantidad ?? 0) + (gratisPor.get(p.presentacion_id) ?? 0),
              )
            : null;
```

   y, después del bloque de `gratisPor.has(...)` (antes del `Campo`):

```tsx
              {quedan ? (
                <Text style={quedan.falta ? estilos.error : estilos.textoSuave}>{quedan.texto}</Text>
              ) : null}
```

- [ ] **Paso 6: typecheck, lint, pruebas, bundle y commit**

```bash
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm test --workspace=apps/tablet
npm run export --workspace=apps/tablet
git status --short
git add "apps/tablet/app/(jornada)/inventario" "apps/tablet/app/(jornada)/_layout.tsx" "apps/tablet/app/(jornada)/index.tsx" "apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx"
git commit -m "T-27 (tablet): Inventario, aceptar o rechazar la carga, aviso en la ruta y la venta respeta lo que trae

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Si `npm run export` deja una carpeta `dist/` u otros archivos sin rastrear, bórralos antes del commit (`git status`
limpio); si `expo` tocó `apps/tablet/package.json`/`tsconfig.json`/`app.json`, `git checkout -- <archivo>`.

- [ ] **Paso 7 (controlador): aceptación en la pantalla real**

En el emulador (Metro de **este** worktree; avisa antes porque el emulador es compartido con el clon de demo y otras
sesiones, y al terminar la app de demo se reinstala desde su clon) con el backend de esta rama contra el Postgres
**local**, y el portal de esta rama en el navegador:

1. *Catálogo › Sucursales*: prende "Control de inventario en la app" en la sucursal del vendedor de prueba.
2. *Producción › Recarga*: captura la carga n.º 1 (pocas piezas de una presentación, p. ej. 5).
3. Tablet: Refrescar → aparece "Tienes una carga por aceptar"; al intentar vender, la venta muestra el motivo y "Ir a
   Inventario" (D3). Abre la carga.
4. **Review Focus 2**: con el detalle abierto, edita la carga en el portal (cambia las piezas) y toca **Aceptar** con
   la versión vieja → "La carga cambió en el almacén; revísala de nuevo." y las piezas nuevas en pantalla; acepta
   ahora.
5. **Review Focus 3**: en otra carga, activa la red lenta del emulador (`adb emu network delay gprs`) y toca Aceptar
   dos veces seguidas → una sola respuesta (en la base, `respondida_en` no cambia en el segundo toque); restaura con
   `adb emu network delay none`.
6. Vende hasta agotar la presentación: la captura dice "Te quedan N" y "Faltan N piezas" en rojo al pasarse; la
   revisión lista "… : faltan N piezas" y "Grabar venta" queda deshabilitado; firmar con el dedo con esa tarjeta en
   pantalla no corta el trazo. Con lo justo, la venta se graba y la existencia queda en 0 (en rojo) en Inventario.
7. **Review Focus 1**: abre una venta, captura más de lo que hay, deja la pantalla abierta; en el portal captura una
   recarga y acéptala desde otra pantalla de la tablet (Inventario → la carga → Aceptar); vuelve a la venta: "Revisar"
   ya no marca faltantes y la venta se graba.
8. Rechaza una carga con motivo → el portal la muestra en rojo con el motivo; edítala en el portal → Refrescar en la
   tablet → vuelve como pendiente → acéptala.
9. Sin red (`adb shell cmd connectivity airplane-mode enable`; `adb reverse` no basta para simular la falta de red):
   Aceptar → "Conéctate al WiFi para aceptar la carga." Restaura la red.
10. **Review Focus 4**: captura una carga, Refrescar, elimínala en el portal, toca Aceptar → la tablet sincroniza y la
    carga desaparece del inventario y del aviso.
11. **Review Focus 5**: apaga la casilla, captura una carga pendiente, Refrescar → el aviso aparece pero la venta se
    graba sin bloqueo ni faltantes, e Inventario dice "El control de inventario de tu sucursal está apagado".
12. Navegador a 1366 px: la rejilla con las cargas del día cabe en su caja (paso del controlador de la Tarea 4).

---

### Tarea 8: Documentación del repo (CLAUDE.md y README de la tablet)

**Files:**
- Modify: `CLAUDE.md` (bloque nuevo después del de "Firma del cliente en la nota (T-73)" y antes de "Reportes y Excel")
- Modify: `apps/tablet/README.md` (sección nueva antes de "Pruebas"; estructura y "Pendiente")
- Modify: `docs/superpowers/specs/2026-10-22-t-27-carga-y-recarga-design.md` (solo si el controlador aprobó alguna
  interpretación de "Conflictos" que el spec dice distinto: se anota como enmienda con fecha bajo "Decisiones de
  producto")

**Interfaces:**
- Consumes: todo lo anterior. No produce código.

- [ ] **Paso 1: `CLAUDE.md`**

Después del bloque `- **Firma del cliente en la nota (T-73).** …` (su última viñeta termina en "…con el protocolo de
push (pre-flight: columnas nuevas con default; nada que contar).") y antes de `- **Reportes y Excel (T-50 / T-15).**`,
agrega:

```markdown
- **Carga y recarga del vendedor (T-27 pieza 1 / T-26).** Producción registra en el portal la carga de la mañana y cada
  recarga; la carga baja a la tablet, el vendedor la **acepta o la rechaza** con red y, con el control de inventario de
  su sucursal prendido, no vende con una carga pendiente ni deja una presentación en negativo. Spec:
  `docs/superpowers/specs/2026-10-22-t-27-carga-y-recarga-design.md`. Piezas 2 (movimientos del día) y 3 (corte de
  inventario) son otros PR.
  - **Servidor**: `sucursal.control_inventario` (apagada por defecto, D7), `carga` (numerada por vendedor y día;
    `uq_carga_vendedor_fecha_numero` parcial: una baja libera su número; `ck_carga_motivo`, `ck_carga_respondida`) y
    `carga_detalle` (piezas > 0). Permiso `carga.gestionar` (ya existía, grupo Produccion/Almacen). Backend en
    `modules/produccion/` (`/cargas`, reglas puras en `reglas-carga.ts`): solo cargas de **hoy en Tijuana** (D8);
    editar o eliminar solo pendiente/rechazada, de hoy y con la `version` (si no, 409 con la carga actual); editar la
    regresa a pendiente y sube la versión; una **aceptada no se toca** (D5). El número se calcula con la fila del
    vendedor bloqueada (`for no key update`); otra sucursal = 404.
  - **App**: `POST /sync/cargas/:id/respuesta` (`@SoloApp`, `sincronizacion/cargas-app.controller.ts` →
    `CargasService.responder`): `{ version, accion, motivo? }`; la misma respuesta otra vez es 200 sin reescribir; otra
    versión o ya respondida = 409 con la carga; de otro vendedor, inexistente o eliminada = 404. No renueva la sesión.
  - **Contrato** (aditivo, `CONTRATO_ACTUAL` sigue en 1): colección `cargas` en el pull (las del vendedor desde
    `current_date - 1`, baja con `activo: 0`) y `VendedorPull.control_inventario`. Cambiar la casilla toca
    `vendedor.updated_at` de esa sucursal (`SucursalesRepository.actualizar`).
  - **Portal**: *Producción › Recarga* (`components/produccion/`, `lib/cargas.ts`): rejilla presentaciones × vendedores
    con subcolumnas por carga (pastilla de estado, motivo del rechazo en rojo), "Nueva carga", "Editar", "Eliminar";
    días anteriores en solo lectura; caja con scroll propio a 1366 px. *Catálogo › Sucursales*: casilla "Control de
    inventario en la app".
  - **Tablet** (migración local 017): `carga`, `carga_detalle`, `vendedor.control_inventario` (el login sin red no la
    pisa: `NO_BORRAR_CON_NULO` ahora lleva el valor con que nace una fila nueva). La mezcla del pull
    (`repositorios/cargas.ts`) reemplaza las líneas y **no deja que un pull viejo deshaga una respuesta**. Reglas puras
    en `src/datos/inventario-reglas.ts` (`existencias`, `bloqueoDeVenta`, `faltantesDeVenta`), reexportadas en
    `src/estado/inventario.ts` con la respuesta (`crearRespondedorCarga`, guardia de doble toque; 409 aplica la nueva y
    sincroniza; 404 sincroniza; 401 sincroniza y reintenta una vez). **`ventas.registrar()` recalcula bloqueo y
    faltantes dentro de su transacción, antes del folio** (vale la existencia del momento de grabar). Pantallas:
    Inventario (menú), detalle con Aceptar/Rechazar, aviso "Tienes una carga por aceptar" en la ruta, y la venta con
    bloqueo, "Te quedan N" y faltantes congelados en la revisión.
  - **Nube**: `20261022120000_carga_vendedor.sql` se sube a `sinmex dev` después del merge, con el protocolo de push
    (pre-flight: tablas nuevas y una columna con default; nada que contar). Backend antes que la app. **No prender la
    casilla de una sucursal hasta que sus tablets tengan la versión nueva** y producción esté capturando cargas.
```

- [ ] **Paso 2: README de la tablet**

En `apps/tablet/README.md`:

1. En "Estructura", la línea de `pendiente/` queda
   `│       ├── pendiente/         # secciones del menu que aun no existen (merma)` y agrega antes de ella
   `│       ├── inventario/        # Inventario y el detalle de una carga (T-27)`.
2. En "Pendiente (otros tickets)", la viñeta de T-20/T-27/T-33/T-41 queda:
   `- **T-27 (piezas 2 y 3) / T-33 / T-41** — merma, movimientos del día y corte de inventario, Ruta y GPS. Los gastos
   (T-30/T-31) y la carga e Inventario (T-27 pieza 1) ya tienen pantalla.`
3. Después de la sección "Firma del cliente en la venta (T-73)" (antes de "Pruebas"), agrega una sección de nivel 2
   (dos `#`) titulada **Carga, recarga e Inventario (T-27 pieza 1)** y, debajo del título, este texto (el título va
   fuera del bloque aquí solo para que el extractor de tareas no lo confunda con una sección del plan):

```markdown
Spec: `docs/superpowers/specs/2026-10-22-t-27-carga-y-recarga-design.md`.

- **La tablet no crea cargas**: las captura producción en el portal y bajan en el pull (`cargas`). Migración 017:
  `carga` y `carga_detalle` (las escribe solo el pull o la respuesta del servidor) y `vendedor.control_inventario`.
- **Inventario** (`app/(jornada)/inventario/index.tsx`, entrada del menú): cargas de hoy con estado y total, y por
  presentación Cargado − Vendido − Regalado = Existencia (en rojo si es 0). Con el control apagado se ve igual, con la
  nota.
- **Detalle** (`inventario/[cargaId].tsx`): Aceptar (confirmar ✓) o Rechazar (peligro ×, con motivo ≤ 300). Llama a
  `POST /sync/cargas/:id/respuesta` con la versión que se pinta (`crearRespondedorCarga` en un `useRef`: un solo envío
  aunque se toque dos veces). Sin red: "Conéctate al WiFi para aceptar la carga."; 409: aplica la carga nueva,
  sincroniza y pide revisarla; 404: sincroniza (se eliminó en el portal).
- **Ruta del día**: aviso "Tienes una carga por aceptar" con botón a la carga mientras haya una pendiente de hoy (con o
  sin control; no bloquea por sí mismo).
- **Venta** (control prendido): con una carga pendiente, en lugar de la captura va el motivo y "Ir a Inventario"; cada
  presentación dice "Te quedan N"; la revisión lista los faltantes (calculados al tocar Revisar y congelados mientras
  se firma) y no deja grabar. `ventas.registrar()` vuelve a calcular todo **dentro de su transacción**, antes del folio.
- Lógica con pruebas: `src/datos/inventario-reglas.ts`, `src/estado/inventario.ts`, `src/datos/repositorios/cargas.ts`,
  `src/sincronizacion/api-carga.ts`.
```

- [ ] **Paso 3: el spec (solo si hace falta)**

Si el controlador aprobó alguna interpretación de "Conflictos para el controlador" que el spec dice distinto (p. ej. el
candado del número sobre la fila del vendedor, o las reglas puras partidas entre `src/datos/` y `src/estado/`),
anótala en el spec bajo "Decisiones de producto" como enmienda con fecha. Si no cambió nada, no toques el spec.

- [ ] **Paso 4: commit**

```bash
git add CLAUDE.md apps/tablet/README.md
# solo si el spec cambió:
# git add docs/superpowers/specs/2026-10-22-t-27-carga-y-recarga-design.md
git commit -m "T-27: documentación (CLAUDE.md y README de la tablet)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Conflictos para el controlador

1. **El candado del número no es `for update` sobre las cargas.** El spec dice "bloqueando las cargas vivas del
   vendedor y fecha (`for update`)". Postgres no admite `for update` con `max()` (error "FOR UPDATE is not allowed with
   aggregate functions") y, en la primera carga del día, no habría ninguna fila que bloquear. **Decidido (Tarea 2):** se
   bloquea la fila del vendedor con `for no key update` (el mismo candado de la ruta diaria, T-37) y el índice único
   parcial sigue siendo la red; si aun así choca (`23505`), 409 "vuelve a guardar". Recomiendo aceptarlo.
2. **Las reglas puras de la tablet viven partidas.** El spec pone `existencias`, `cargaPendiente`, `bloqueoDeVenta` y
   `faltantesDeVenta` en `src/estado/inventario.ts`, pero `ventas.registrar()` (en `src/datos/`) tiene que usarlas y
   `src/datos/` no importa de `src/estado/` (regla de la capa, como `reglas-firma.ts`). **Decidido (Tareas 5 y 6):** el
   núcleo vive en `src/datos/inventario-reglas.ts` (prueba `inventario-reglas.spec.ts`, donde están los casos que el
   spec pide para `inventario.spec.ts`: existencias, pendiente, bloqueo, faltantes con regalos, control apagado) y
   `src/estado/inventario.ts` lo reexporta y agrega `validarRespuesta`, los textos y el respondedor (prueba
   `inventario.spec.ts`). Recomiendo aceptarlo.
3. **`sucursal=<id>` y no el código.** El spec pide `GET /cargas?…&sucursal=<id>`; el resto del portal (selector global,
   gastos, reportes) habla en **códigos** con `resolverAlcance`, que además contesta 403 al pedir otra sucursal. El plan
   sigue al spec: id (uuid), un atado ve la suya sin pedirla, otra = **404**, un General sin sucursal = 400; la pantalla
   tiene su propio selector y toma el código del selector global solo para elegir la inicial. Recomiendo aceptarlo.
4. **Responder no sube `version`.** Si el vendedor **rechaza** mientras la oficina edita esa misma carga pendiente, el
   `PATCH` del portal entra (una rechazada es editable y la versión no cambió) y el motivo se pierde sin que la oficina
   lo haya visto. Una **aceptada** sí da 409 ("Una carga aceptada no se modifica: el vendedor ya la aceptó. Recarga la
   página."). El spec no pide subir la versión al responder. Recomiendo aceptarlo así (la corrección de una rechazada es
   justo lo que la oficina iba a hacer); si molesta, subir `version` en `escribirRespuesta` es un cambio de una línea en
   otro ticket.
5. **`PATCH`/`DELETE` de una carga de otro día también son 409 en el servidor** ("Solo se modifican las cargas de
   hoy."). El spec dice "días anteriores en solo lectura" para el portal; el plan lo aplica también en el backend para
   que la regla no dependa de la pantalla (D8). Recomiendo aceptarlo.
6. **La rejilla trae más que "activos".** Además de los vendedores activos y las presentaciones activas, trae a un
   vendedor **desactivado que tiene carga ese día** y una presentación **dada de baja que una carga del día trae**
   (marcada `activa: false`, no se captura). Sin eso, esas piezas desaparecerían de la pantalla. Recomiendo aceptarlo.
7. **Orden de la rejilla.** "Por presentación y luego por sabor (criterio de T-10)" no estaba implementado en ningún
   sitio (T-10 lo dejó para "la pantalla de Recarga"). El volumen es texto libre: el plan lo convierte a mililitros
   (`mililitros('1.5 L') = 1500`), ordena de menor a mayor y luego por producto; lo que no se entiende va al final.
8. **`CargaPull` lleva `vendedor_id`**, que el spec no lista (la tabla local sí lo tiene). Aditivo e inofensivo.
9. **Columna local `actualizado_en`** (como dice el spec) y no `sincronizado_en` (como las demás tablas del pull): es
   cuando la tablet escribió la fila, por pull o por respuesta.
10. **La mezcla del pull no deja que un pull viejo deshaga una respuesta.** Un pull que salió antes de que el vendedor
    aceptara (misma versión, local respondida y la que llega pendiente) no se escribe; una versión menor tampoco; una
    baja es final. El spec solo dice "llenadas por el pull"; sin esta regla la carga aceptada volvería a "por aceptar"
    un momento. Recomiendo aceptarlo.
11. **`control_inventario` y el login sin red.** El upsert de identidad del login sin red no conoce la casilla y la
    columna es `not null`: `NO_BORRAR_CON_NULO` pasa a llevar, por columna, el valor con que nace una fila nueva
    (`folio_segmento → null`, `control_inventario → 0`) y la actualización lee el parámetro en vez de `excluded`. El
    comportamiento de `folio_segmento` no cambia (lo cubre la prueba de `folios.spec.ts`).
12. **401 al responder.** "No renueva la sesión fuera de lo normal" se interpreta así: el endpoint usa el token de acceso
    actual; ante un 401 la pantalla corre la **sincronización normal** (que renueva como primer paso) y reintenta **una**
    vez. Nunca se llama a `renovar()` desde la respuesta.
13. **409 por "ya respondida con otra cosa"** usa el mismo texto que el de versión ("La carga cambió en el almacén;
    revísala de nuevo."). Solo puede pasar si dos tablets responden la misma carga o tras un reintento con otra acción.
14. **Inventario se habilita con el día cerrado** (es consulta). El spec no lo dice; el menú hoy deshabilita con el día
    cerrado "solo lo que captura". La prueba del menú cambia a `['gastos', 'merma']`.
15. **"Te quedan N" descuenta lo capturado en esta venta** (vendido + regalado) y, si no alcanza, dice "Faltan N
    piezas" en rojo. El spec dice "Te quedan N" sin precisar si es antes o después de lo capturado.
16. **Faltantes congelados en la revisión y bloqueo solo en la captura** (lección de T-73): se calculan al tocar
    "Revisar" y no se recalculan mientras el cliente firma; si una carga pendiente llega con la revisión abierta, la
    pantalla no cambia y `ventas.registrar()` la rechaza al grabar ("Tienes una carga por aceptar. Acéptala en
    Inventario antes de vender."). La red definitiva de D3/D4 es siempre el repositorio.
17. **`Sucursal.controlInventario` es obligatorio en el tipo del portal**, así que cinco pruebas ajenas (vendedores,
    promociones ×2, tesorería, usuarios) cambian sus fixtures (un `sed` en la Tarea 4). Sin lógica tocada.
18. **Mensajes 409 del portal**: vienen del servidor (`mensajeDe`). El de aceptada dice "Una carga aceptada no se
    modifica: el vendedor ya la aceptó. Recarga la página." (contiene la frase de D5 y la idea del spec "El vendedor ya
    respondió esta carga; recarga la página").
19. **Plan en 8 tareas y no 7**: la parte de datos de la tablet (migración, mezcla, reglas, candados de la venta) y la
    de lógica de pantalla + cliente HTTP se separaron (Tareas 5 y 6) porque juntas pasaban de 2 000 líneas y mezclaban
    dos capas que se prueban distinto.
20. **Supabase local compartido.** La Tarea 1 aplica una migración con `migration up --local` y regenera `schema.d.ts`;
    si otra sesión dejó migraciones de otra rama aplicadas, quedarse solo con las líneas de `Carga`, `CargaDetalle`,
    `Sucursal.control_inventario` y `DB`. Nunca `db reset`, nunca nada contra `sinmex dev`. El push a la nube lo hace
    quien mergee (migración → backend → app) y **la casilla no se prende** hasta que las tablets de esa sucursal tengan
    la versión nueva.
21. **El paso del emulador (Tarea 7)** usa el emulador compartido con el clon de demo (Metro de este worktree, sin
    `pm clear`, y la app de demo se reinstala después desde su clon). No hay dependencia nativa nueva: no hace falta APK.
22. **Vault** (`[[Inventario]]`, `[[App Tablet]]`, Estado del proyecto y bitácora): lo actualiza el controlador tras la
    revisión final, no un subagente.

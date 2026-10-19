# T-30 / T-31 · Gastos de la ruta y catálogo de campos de egreso — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la oficina administre los campos de egreso (T-30); que el vendedor registre sin red lo que paga de la
cobranza (hielo, gasolina, reparación, adelanto) con foto opcional del ticket; que ese gasto suba en el push como la
operación `gasto` (que deja de guardarse sin proyectar), se proyecte a la tabla `gasto` y reste en Tesorería de la
cuenta de efectivo de su sucursal; y que la oficina lo consulte en *Finanzas › Gastos*.

**Architecture:** el servidor gana el catálogo global `campo_egreso` (CRUD del portal con baja lógica bloqueada por
gastos del año en Tijuana; baja en el pull como `campos_egreso`) y la tabla `gasto`, cuyo `id` es la clave de la
operación (como la visita de T-39). `prepararGasto` valida la forma antes de la transacción y
`GastosService.registrarGasto` (módulo `compras-egresos`, ADR-0009) proyecta dentro de ella, copiando nombre y tipo
del campo; el servidor **no** revisa "se usa en la app". Tesorería **lee** los gastos (`GastosTesoreriaRepository`) y
`movimientosDeSaldo` los resta de la cuenta destino vigente de `(sucursal, 'efectivo')`, con su lista "sin cuenta" y
el evento `gasto-ruta`. El canal `POST /sync/foto/:clave` acepta gastos (`gasto-<id>.jpg`) y el portal la sirve en
`GET /gastos/:id/foto`. En la tablet, la migración local 015 trae `campo_egreso` y `gasto`; lo decidible vive en
funciones puras con prueba (`montoACentavos`, `validarGasto`, `camposParaGasto`) y la pantalla solo pinta.

**Tech Stack:** NestJS 11 + Kysely (backend), Postgres local vía Supabase (e2e, pgTAP), Next.js 15 + Vitest +
Testing Library (portal), Expo SDK 57 / React Native + SQLite + Jest en Node (tablet; sin pruebas de pantalla).

**Spec:** `docs/superpowers/specs/2026-10-20-t-30-31-gastos-de-ruta-design.md` — léelo antes de empezar. Sus
decisiones D1…D10 **no se renegocian**. Si este plan lo contradice, manda el spec: para y pregunta.

---

## Global Constraints

Copiadas del spec y del repo. Cada tarea las incluye:

- Rama `feature/t-30-31-gastos-ruta`. Todos los comandos **desde la raíz del worktree**
  (`/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-gastos`), con los scripts del workspace
  (`--workspace=apps/...`). **Nunca** entres a `../proyecto-sinmex` (clon de demo) ni a otro clon.
- **`CONTRATO_ACTUAL` sigue en 1.** Todo cambio del cable es aditivo (proyección de un tipo que ya existía, códigos de
  rechazo nuevos, colección nueva en el pull).
- **Los tipos del contrato están duplicados**: `apps/backend/src/modules/sincronizacion/contrato.ts` (normativo) y
  `apps/tablet/src/sincronizacion/contrato.ts`. Si una tarea toca uno, toca el otro **y**
  `docs/contrato-sincronizacion.md` **en el mismo commit**.
- La operación **`gasto`** ya existe en `TIPOS_OPERACION`: deja de guardarse sin proyectar (`prepararProyeccion` ya no
  devuelve `proyeccion: null` para ella; `merma` y `ruta` siguen igual). El sobre **no** lleva `cliente_id` ni folio;
  la clave **es** `gasto.id` (uuid).
- Códigos de rechazo nuevos, exactos: **`campo-egreso-inexistente`** (solo un id que nunca existió; **un campo dado de
  baja se acepta**) y **`gasto-id-ocupado`** (motivo **neutro**: no confirma qué ocupa el id). Toda falla de forma es
  `datos-invalidos` con un motivo que empieza por el campo.
- **El servidor no revisa `se_usa_en_app`**: la oficina puede cambiar la casilla mientras la tablet está sin red.
- El método del gasto de la ruta es fijo: **`metodo = 'efectivo_cobranza_dia'`**, `origen = 'app'`, `factura = 'N/A'`,
  `quien` = nombre del vendedor al proyectar, `capturo_usuario_id` nulo.
- **`gasto.fecha` = `fecha_operacion` del sobre**, tal cual; el servidor **nunca** la re-deriva de UTC (ni de
  `registrado_en`).
- **Tesorería lee la tabla `gasto`, nunca copia nada**: el gasto vivo de método `efectivo_cobranza_dia` resta de la
  cuenta destino vigente de `(sucursal del gasto, 'efectivo')` en su fecha (`destinoDe` de T-29). Sin destino va a
  `gastosSinCuenta` y la vista lo avisa. `armarVista` acepta `gastos` en `extras` sin romper a quien no lo pase.
- **Orden del push**: `jornadas → prospectos → ventas → cobranzas → visitas → gastos → rutas` (`fuentesDelPush`, con
  prueba).
- Baja del campo: lógica, y **409** si tiene gastos vivos con `fecha` en el año calendario en curso **de Tijuana**,
  con el texto exacto "Este campo tiene gastos este año; podrás darlo de baja el próximo año."
- Permisos nuevos: **`campo_egreso.gestionar`** (grupo `General`) y **`gasto.ver`** (grupo `Finanzas`). El pgTAP
  `93_permiso_sucursal_test.sql` pasa de 31 a **33** claves.
- **Sin RLS**: el alcance lo pone el backend (sucursal del token o del usuario, `resolverAlcance`), como en todo el
  repo. En `GET /gastos/:id/foto`, otra sucursal es **404**.
- ADR-0009: **una transacción por operación**; una operación rechazada **no deja fila** (ni buzón ni negocio).
- Base de datos: **nunca `db reset`**. Migraciones locales solo con `npm run supabase -- migration up --local` (con el
  `--`). Supabase local es **compartido entre sesiones**. **Nunca apuntes nada a la nube** (`sinmex dev`): `.env.test`
  va a `127.0.0.1:54322`; no se corre `db push` ni nada con `--db-url`. La migración del servidor es
  `supabase/migrations/20261020120000_gastos_ruta.sql` (timestamp único).
- Backend: lint **solo por archivo**: `npm exec --workspace=apps/backend -- prettier --write <archivos>` y
  `npm exec --workspace=apps/backend -- eslint <archivos>`. **Nunca** `npm run lint --workspace=apps/backend` (lleva
  `--fix` y reescribe archivos ajenos). Typecheck del backend = `npm run build --workspace=apps/backend`. Pruebas:
  `npm test --workspace=apps/backend -- <patrón>` y `npm run test:e2e --workspace=apps/backend -- <patrón>`.
- Los e2e **siembran lo que usan** con sufijo `${Date.now()}-${process.pid}` y lo borran en `afterAll` en orden
  inverso a las llaves foráneas; las pruebas de Tesorería usan fechas aisladas (2017-2018) para no cruzarse con las
  de T-29 (2019).
- Portal: `npm test --workspace=apps/portal -- <patrón>`, `npx tsc --noEmit -p apps/portal`,
  `npm run lint --workspace=apps/portal`. Tiene que caber en una ventana de **1366 px**.
- Tablet: `npm run typecheck --workspace=apps/tablet`, `npm run lint --workspace=apps/tablet`,
  `npm test --workspace=apps/tablet -- <patrón>`. Las pruebas son **solo** `src/**/*.spec.ts` en Node: nada de
  pantallas. **La lógica de la tablet vive en funciones puras con pruebas de Jest**; la pantalla solo la llama.
  Guardar lleva **guardia contra el doble toque** (`useRef`, como `visita-sin-venta.tsx`).
- Migraciones locales de la tablet: **nunca se edita una publicada** (001…014); la nueva es la **015** (la 014 es de
  T-72).
- Un gasto grabado **no se edita ni se borra** en la app. Con el día cerrado no se registra.
- Código en español, **identificadores sin acentos**, **textos al usuario en español con acentos** ("Gasto
  registrado", "Efectivo cobranza del día", "Campos de egreso"). Comentarios que explican *por qué*; sigue el estilo
  del archivo que tocas.
- **Nunca `git add -f`** de nada bajo `.superpowers/` (ni de ningún archivo ignorado). `git status` limpio al terminar
  cada tarea; un commit por tarea (o más si el implementador lo prefiere), con el trailer exacto en la última línea
  del mensaje: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Lo que el spec implica y ninguna prueba cubriría si no se añade aquí; cada línea se pinó en la tarea dueña:

1. **Gasto a una hora en que en UTC ya es otro día** (las 17:30 de Tijuana) → cuenta en `fecha_operacion`, en la tabla
   y en Tesorería. Tarea 3 (e2e: `fecha_operacion` 2018-04-10 con `registrado_en` 2018-04-11T01:30Z) y Tarea 5 (e2e
   de la vista).
2. **La oficina da de baja el campo o apaga "se usa en la app" con el formulario abierto o la tablet sin red** → la
   tablet guarda igual y el servidor lo acepta. Tarea 9 (`gastos.registrar` con campo inactivo) y Tarea 3 (e2e del
   campo dado de baja y del campo con la casilla apagada).
3. **La WiFi se cae después de aplicar** y la tablet reenvía el gasto y su foto → `duplicada`, una sola fila y un
   solo `gasto-<id>.jpg`. Tarea 3 (e2e del reenvío) y Tarea 4 (e2e de la foto dos veces).
4. **Montos como los teclea un vendedor** ("12.5", " 80 ", "0.29", "1.10", "12.345", "0", "-5", "1,250.50", "1e3",
   "abc") → centavos exactos sin errores de flotante, o rechazo. Tarea 10 (`montoACentavos`).
5. **Baja del campo en el borde del año de Tijuana** (el 31 de diciembre a las 23:30 locales ya es enero en UTC) y
   con un gasto borrado o del año pasado → solo bloquea un gasto **vivo** de **este** año de Tijuana. Tarea 2
   (`inicioDelAnioEnTijuana` y e2e de la baja).

---

### Tarea 1: Migración del servidor: `campo_egreso`, `gasto` y los dos permisos (D1, D2, D4)

**Files:**
- Create: `supabase/tests/99_gasto_test.sql`
- Create: `supabase/migrations/20261020120000_gastos_ruta.sql`
- Modify: `supabase/tests/93_permiso_sucursal_test.sql` (el conteo de permisos pasa de 31 a 33)
- Modify (generado): `apps/backend/src/database/schema.d.ts`

**Interfaces:**
- Consumes: tablas `sucursal`, `vendedor`, `usuario`, `permiso`; la función `set_actualizado_en()` (existe desde
  `20261018120000_visita_sin_venta.sql`, T-39: **no** se recrea); la semilla de sucursal `TJ`.
- Produces: tablas `campo_egreso` (`id, nombre, tipo, se_usa_en_app, deleted_at, creado_en, actualizado_en`) y
  `gasto` (`id, sucursal_id, vendedor_id, capturo_usuario_id, campo_egreso_id, campo_nombre, tipo, fecha,
  registrado_en, monto, metodo, quien, factura, comentario, foto_archivo, foto_subida_en, origen, deleted_at,
  creado_en`); índice `uq_campo_egreso_nombre`; checks `ck_campo_egreso_nombre`, `ck_campo_egreso_tipo`,
  `ck_gasto_tipo`, `ck_gasto_monto`, `ck_gasto_metodo`, `ck_gasto_comentario`, `ck_gasto_foto_completa`,
  `ck_gasto_origen`, `ck_gasto_app_con_vendedor`; índices `idx_gasto_sucursal_fecha`, `idx_gasto_vendedor_fecha`,
  `idx_gasto_campo_fecha`; permisos `campo_egreso.gestionar` (grupo `General`) y `gasto.ver` (grupo `Finanzas`);
  interfaces Kysely `CampoEgreso` y `Gasto` en `DB` (`'campo_egreso'`, `'gasto'`).

> `gasto.id` **no** tiene default a propósito: es la clave de la operación del push (D4, como `visita.id`). Las
> compras de oficina del siguiente ticket generarán su uuid en el servicio.

- [ ] **Paso 1: la prueba pgTAP que falla**

`supabase/tests/99_gasto_test.sql`:

```sql
begin;
select plan(20);

-- T-30/T-31: lo que la BASE garantiza del catalogo de campos de egreso y del
-- gasto aunque alguien escriba por debajo del servicio. Prefijo `ZZ-pgtap-T30`.

select has_table('campo_egreso', 'existe el catalogo de campos de egreso');
select has_table('gasto', 'existe la tabla de gastos');

select is(
  (select count(*)::int from campo_egreso
    where deleted_at is null
      and nombre in ('Envases', 'Celular', 'Gastos diversos', 'Ajustes x no cuadrar',
                     'Gasolina', 'Hielo', 'Reparación del vehículo', 'Adelanto de sueldo')),
  8, 'la semilla trae los ocho campos del cliente');

select is(
  (select count(*)::int from campo_egreso
    where deleted_at is null and se_usa_en_app
      and nombre in ('Gasolina', 'Hielo', 'Reparación del vehículo', 'Adelanto de sueldo')),
  4, 'gasolina, hielo, reparacion y adelanto se usan en la app');

select is(
  (select count(*)::int from campo_egreso
    where deleted_at is null and se_usa_en_app
      and nombre in ('Envases', 'Celular', 'Gastos diversos', 'Ajustes x no cuadrar')),
  0, 'los otros cuatro no se usan en la app');

select is(
  (select tipo from campo_egreso where nombre = 'Envases' and deleted_at is null),
  'produccion', 'Envases es de produccion; los demas de operacion');

select throws_ok(
  $$insert into campo_egreso (nombre, tipo) values ('  gasolina ', 'operacion')$$,
  '23505', null, 'el nombre es unico entre vivos sin importar mayusculas ni espacios');

select throws_ok(
  $$insert into campo_egreso (nombre, tipo) values ('   ', 'operacion')$$,
  '23514', null, 'el nombre no puede quedar vacio');

select throws_ok(
  $$insert into campo_egreso (nombre, tipo) values ('ZZ-pgtap-T30 Raro', 'nomina')$$,
  '23514', null, 'el tipo es uno de los tres fijos');

insert into campo_egreso (nombre, tipo) values ('ZZ-pgtap-T30 Campo', 'operacion');
update campo_egreso set deleted_at = now() where nombre = 'ZZ-pgtap-T30 Campo';

select lives_ok(
  $$insert into campo_egreso (nombre, tipo) values ('ZZ-pgtap-T30 Campo', 'financiero')$$,
  'dar de baja un campo libera su nombre');

select is(
  (select count(*)::int from permiso where clave = 'campo_egreso.gestionar' and grupo = 'General'),
  1, 'existe el permiso campo_egreso.gestionar en el grupo General');

select is(
  (select count(*)::int from permiso where clave = 'gasto.ver' and grupo = 'Finanzas'),
  1, 'existe el permiso gasto.ver en el grupo Finanzas');

-- Fixtures del gasto: un vendedor de TJ. Todo se va con el rollback.
insert into vendedor (login, nombre, password_hash, sucursal_id)
  values ('zz-pgtap-t30', 'Vendedor pgTAP T30', 'x', (select id from sucursal where codigo = 'TJ'));

create temporary table _t30 on commit drop as
select
  (select id from vendedor where login = 'zz-pgtap-t30') as vendedor,
  (select id from sucursal where codigo = 'TJ') as sucursal,
  (select id from campo_egreso where nombre = 'Hielo' and deleted_at is null) as campo;

select lives_ok(
  $$insert into gasto (id, sucursal_id, vendedor_id, campo_egreso_id, campo_nombre, tipo, fecha, registrado_en, monto, metodo, origen)
    select gen_random_uuid(), sucursal, vendedor, campo, 'Hielo', 'operacion', date '2026-10-20', now(), 80, 'efectivo_cobranza_dia', 'app' from _t30$$,
  'un gasto de la app con vendedor entra');

select is(
  (select factura from gasto where vendedor_id = (select vendedor from _t30) limit 1),
  'N/A', 'la factura nace en N/A');

select lives_ok(
  $$insert into gasto (id, sucursal_id, campo_egreso_id, campo_nombre, tipo, fecha, registrado_en, monto, metodo, origen)
    select gen_random_uuid(), sucursal, campo, 'Hielo', 'operacion', date '2026-10-20', now(), 80, 'efectivo_cobranza_dia', 'portal' from _t30$$,
  'un gasto del portal sin vendedor entra (compras de oficina, siguiente ticket)');

select throws_ok(
  $$insert into gasto (id, sucursal_id, campo_egreso_id, campo_nombre, tipo, fecha, registrado_en, monto, metodo, origen)
    select gen_random_uuid(), sucursal, campo, 'Hielo', 'operacion', date '2026-10-20', now(), 80, 'efectivo_cobranza_dia', 'app' from _t30$$,
  '23514', null, 'un gasto de la app exige vendedor');

select throws_ok(
  $$insert into gasto (id, sucursal_id, vendedor_id, campo_egreso_id, campo_nombre, tipo, fecha, registrado_en, monto, metodo, origen)
    select gen_random_uuid(), sucursal, vendedor, campo, 'Hielo', 'operacion', date '2026-10-20', now(), 0, 'efectivo_cobranza_dia', 'app' from _t30$$,
  '23514', null, 'el monto es mayor que cero');

select throws_ok(
  $$insert into gasto (id, sucursal_id, vendedor_id, campo_egreso_id, campo_nombre, tipo, fecha, registrado_en, monto, metodo, origen)
    select gen_random_uuid(), sucursal, vendedor, campo, 'Hielo', 'operacion', date '2026-10-20', now(), 80, 'transferencia', 'app' from _t30$$,
  '23514', null, 'por ahora el unico metodo es efectivo cobranza del dia');

select throws_ok(
  $$insert into gasto (id, sucursal_id, vendedor_id, campo_egreso_id, campo_nombre, tipo, fecha, registrado_en, monto, metodo, origen, comentario)
    select gen_random_uuid(), sucursal, vendedor, campo, 'Hielo', 'operacion', date '2026-10-20', now(), 80, 'efectivo_cobranza_dia', 'app', repeat('x', 201) from _t30$$,
  '23514', null, 'el comentario no pasa de 200 caracteres');

select throws_ok(
  $$insert into gasto (id, sucursal_id, vendedor_id, campo_egreso_id, campo_nombre, tipo, fecha, registrado_en, monto, metodo, origen, foto_archivo)
    select gen_random_uuid(), sucursal, vendedor, campo, 'Hielo', 'operacion', date '2026-10-20', now(), 80, 'efectivo_cobranza_dia', 'app', 'gasto-x.jpg' from _t30$$,
  '23514', null, 'la foto va completa: archivo y fecha juntos');

select * from finish();
rollback;
```

> Los 20 `select` de prueba son: 2 `has_table`, 4 de semilla, 4 del catálogo (unicidad, vacío, tipo, baja), 2 de
> permisos, 2 `lives_ok`/`is` del gasto de la app, 1 del portal y 5 `throws_ok` del gasto.

- [ ] **Paso 2: correr y ver fallar**

`npm run supabase -- test db --local` → `99_gasto_test.sql` falla en `has_table` (las tablas no existen). Las demás
suites siguen como estaban.

- [ ] **Paso 3: la migración**

`supabase/migrations/20261020120000_gastos_ruta.sql`:

```sql
-- T-30 / T-31 (parte de la ruta): catalogo de campos de egreso y gastos de la ruta.
-- Spec: docs/superpowers/specs/2026-10-20-t-30-31-gastos-de-ruta-design.md
--
-- Dos tablas nuevas y vacias (mas la semilla del catalogo): no hay filas que
-- violen nada, asi que no hace falta pre-flight contra la nube.
--
-- * `campo_egreso` es un catalogo GLOBAL (D2), como `motivo_visita`: la oficina
--   lo administra en el portal y baja en el pull como `campos_egreso`. Los tres
--   tipos de egreso son fijos (D1): un check, no una tabla.
-- * `gasto` guarda cada gasto que sube la tablet (D4). Su `id` es la clave de la
--   operacion del push (como `visita` en T-39), asi que la foto del ticket se
--   liga a ella sin ambiguedad. `vendedor_id` nulo queda para las compras de
--   oficina del siguiente ticket (el resto de T-31).
--
-- `set_actualizado_en()` ya existe (T-39); aqui solo se cuelga el trigger.

create table campo_egreso (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null
    constraint ck_campo_egreso_nombre check (btrim(nombre) <> ''),
  tipo           text not null
    constraint ck_campo_egreso_tipo check (tipo in ('produccion', 'operacion', 'financiero')),
  se_usa_en_app  boolean not null default false,
  deleted_at     timestamptz,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Mismo patron que `uq_motivo_visita_nombre`: "Hielo", "hielo" y " Hielo " son
-- el mismo campo, y dar uno de baja libera su nombre.
create unique index uq_campo_egreso_nombre
  on campo_egreso (lower(btrim(nombre))) where deleted_at is null;

create trigger trg_campo_egreso_actualizado before update on campo_egreso
  for each row execute function set_actualizado_en();

-- Semilla del cliente (spec D2). Los cuatro de la ruta llevan la casilla.
insert into campo_egreso (nombre, tipo, se_usa_en_app) values
  ('Envases',                 'produccion', false),
  ('Celular',                 'operacion',  false),
  ('Gastos diversos',         'operacion',  false),
  ('Ajustes x no cuadrar',    'operacion',  false),
  ('Gasolina',                'operacion',  true),
  ('Hielo',                   'operacion',  true),
  ('Reparación del vehículo', 'operacion',  true),
  ('Adelanto de sueldo',      'operacion',  true)
on conflict do nothing;

create table gasto (
  id                 uuid primary key,             -- = clave de la operacion (D4)
  sucursal_id        uuid not null references sucursal(id),
  vendedor_id        uuid references vendedor(id), -- null: compra de oficina (siguiente ticket)
  capturo_usuario_id uuid references usuario(id),  -- null por ahora
  campo_egreso_id    uuid not null references campo_egreso(id),
  campo_nombre       text not null,                -- copia al proyectar (D4)
  tipo               text not null
    constraint ck_gasto_tipo check (tipo in ('produccion', 'operacion', 'financiero')),
  fecha              date not null,                -- fecha_operacion del sobre: el dia al que cuenta
  registrado_en      timestamptz not null,
  monto              numeric(14,2) not null
    constraint ck_gasto_monto check (monto > 0),
  metodo             text not null
    constraint ck_gasto_metodo check (metodo in ('efectivo_cobranza_dia')),
  quien              text,
  factura            text not null default 'N/A',
  comentario         text
    constraint ck_gasto_comentario check (comentario is null or char_length(comentario) <= 200),
  foto_archivo       text,                         -- nombre dentro de FOTOS_DIR (gasto-<id>.jpg)
  foto_subida_en     timestamptz,
  origen             text not null
    constraint ck_gasto_origen check (origen in ('app', 'portal')),
  deleted_at         timestamptz,
  creado_en          timestamptz not null default now(),
  -- Igual que `ck_visita_foto_completa`: nombre y fecha se escriben juntos.
  constraint ck_gasto_foto_completa check ((foto_archivo is null) = (foto_subida_en is null)),
  -- Un gasto de la app siempre es de un vendedor.
  constraint ck_gasto_app_con_vendedor check (origen <> 'app' or vendedor_id is not null)
);

-- Tesoreria (T-29) y el corte (T-33) leen por sucursal y dia; la lista del
-- portal, por vendedor y por campo; la baja del campo busca por campo y fecha.
create index idx_gasto_sucursal_fecha on gasto (sucursal_id, fecha);
create index idx_gasto_vendedor_fecha on gasto (vendedor_id, fecha);
create index idx_gasto_campo_fecha on gasto (campo_egreso_id, fecha);

-- El perfil `Administrador General` los recibe solos (PERFIL_MAESTRO). Leer el
-- catalogo de campos solo pide sesion del portal (D3).
insert into permiso (clave, grupo, descripcion) values
  ('campo_egreso.gestionar', 'General',  'Campos de egreso: alta, edición y baja'),
  ('gasto.ver',              'Finanzas', 'Ver gastos')
on conflict (clave) do nothing;
```

- [ ] **Paso 4: el conteo de permisos**

En `supabase/tests/93_permiso_sucursal_test.sql`, sustituye el último bloque:

```sql
-- T-05 sembro 22 permisos desde el documento del cliente; T-08a agrego 23o
-- (sucursal.gestionar); T-18 agrego 24o (precio.gestionar); T-08b agrega 25o
-- (perfil.gestionar); T-13 agrega 26o (usuario.gestionar); T-19 agrega 27o
-- (venta.asignar_factura); T-22 agrega 28o (cuentas_cobrar.ver); T-28 agrega
-- 29o y 30o (tesoreria.ver y tesoreria.gestionar); T-39 agrega 31o
-- (motivo_visita.gestionar).
select is(
  (select count(*)::int from permiso where deleted_at is null),
  31,
  'el catalogo de permisos tiene 31 claves'
);
```

por:

```sql
-- T-05 sembro 22 permisos desde el documento del cliente; T-08a agrego 23o
-- (sucursal.gestionar); T-18 agrego 24o (precio.gestionar); T-08b agrega 25o
-- (perfil.gestionar); T-13 agrega 26o (usuario.gestionar); T-19 agrega 27o
-- (venta.asignar_factura); T-22 agrega 28o (cuentas_cobrar.ver); T-28 agrega
-- 29o y 30o (tesoreria.ver y tesoreria.gestionar); T-39 agrega 31o
-- (motivo_visita.gestionar); T-30/T-31 agrega 32o y 33o
-- (campo_egreso.gestionar y gasto.ver).
select is(
  (select count(*)::int from permiso where deleted_at is null),
  33,
  'el catalogo de permisos tiene 33 claves'
);
```

- [ ] **Paso 5: aplicar y ver pasar**

```bash
npm run supabase -- migration list --local     # 20261020120000 aparece sin aplicar
npm run supabase -- migration up --local       # aplica solo las pendientes; NUNCA db reset
npm run supabase -- test db --local            # 99_gasto_test.sql: 20/20; 93_permiso_sucursal_test.sql: 2/2
```

Si `migration list` muestra **otras** migraciones pendientes que no son de esta rama (otra sesión trabaja en el mismo
Supabase local), **para** y avisa al controlador antes de aplicar. Si otra rama ya sumó permisos en el Supabase
compartido, el 93 contará de más: no lo "arregles" a ese número; avisa.

- [ ] **Paso 6: regenerar los tipos de Kysely**

```bash
npm run db:types --workspace=apps/backend
git diff --stat apps/backend/src/database/schema.d.ts
```

El diff debe agregar **solo** `CampoEgreso`, `Gasto` y sus dos entradas en `DB` (`campo_egreso: CampoEgreso;`,
`gasto: Gasto;`). Debe verse así (orden alfabético del generador):

```ts
export interface CampoEgreso {
  actualizado_en: Generated<Timestamp>;
  creado_en: Generated<Timestamp>;
  deleted_at: Timestamp | null;
  id: Generated<string>;
  nombre: string;
  se_usa_en_app: Generated<boolean>;
  tipo: string;
}

export interface Gasto {
  campo_egreso_id: string;
  campo_nombre: string;
  capturo_usuario_id: string | null;
  comentario: string | null;
  creado_en: Generated<Timestamp>;
  deleted_at: Timestamp | null;
  factura: Generated<string>;
  fecha: Timestamp;
  foto_archivo: string | null;
  foto_subida_en: Timestamp | null;
  id: string;
  metodo: string;
  monto: Numeric;
  origen: string;
  quien: string | null;
  registrado_en: Timestamp;
  sucursal_id: string;
  tipo: string;
  vendedor_id: string | null;
}
```

Si aparecen tablas o columnas ajenas (migraciones de otra rama aplicadas al Supabase compartido), deja solo lo de
T-30/T-31 a mano en ese archivo.

- [ ] **Paso 7: typecheck y commit**

```bash
npm run build --workspace=apps/backend
git add supabase/migrations/20261020120000_gastos_ruta.sql supabase/tests/99_gasto_test.sql supabase/tests/93_permiso_sucursal_test.sql apps/backend/src/database/schema.d.ts
git commit -m "T-30/T-31: migración de campo_egreso, gasto y los permisos campo_egreso.gestionar y gasto.ver

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 2: Backend: catálogo Campos de egreso para el portal, con la regla del año (D1, D2, D3)

**Files:**
- Create: `apps/backend/src/modules/compras-egresos/tipos-egreso.ts`
- Create: `apps/backend/src/modules/compras-egresos/reglas-campo-egreso.ts`
- Create: `apps/backend/src/modules/compras-egresos/reglas-campo-egreso.spec.ts`
- Create: `apps/backend/src/modules/compras-egresos/dto/campo-egreso.dto.ts`
- Create: `apps/backend/src/modules/compras-egresos/campos-egreso.repository.ts`
- Create: `apps/backend/src/modules/compras-egresos/campos-egreso.service.ts`
- Create: `apps/backend/src/modules/compras-egresos/campos-egreso.service.spec.ts`
- Create: `apps/backend/src/modules/compras-egresos/campos-egreso.controller.ts`
- Modify: `apps/backend/src/modules/compras-egresos/compras-egresos.module.ts`
- Create: `apps/backend/test/campos-egreso.e2e-spec.ts`

**Interfaces:**
- Consumes: tablas `campo_egreso` y `gasto` (Tarea 1); `RequierePermiso`, `esViolacionUnicidad`,
  `hoyEnTijuana` (`sincronizacion/operaciones.ts`).
- Produces:
  - `tipos-egreso.ts`: `export const TIPOS_EGRESO = ['produccion', 'operacion', 'financiero'] as const;`
    `export type TipoEgreso = (typeof TIPOS_EGRESO)[number];` `export const METODO_GASTO_RUTA = 'efectivo_cobranza_dia' as const;`
  - `reglas-campo-egreso.ts`: `export function inicioDelAnioEnTijuana(ahora: Date): string` (`'AAAA-01-01'`).
  - `export interface CampoEgreso { id: string; nombre: string; tipo: TipoEgreso; seUsaEnApp: boolean }`
    (`campos-egreso.repository.ts`).
  - `CamposEgresoRepository`: `listarVivos(): Promise<CampoEgreso[]>`, `crear(nombre: string, tipo: TipoEgreso,
    seUsaEnApp: boolean): Promise<CampoEgreso>`, `editar(id: string, cambios: CambiosCampoEgreso):
    Promise<CampoEgreso | undefined>`, `tieneGastosDesde(id: string, fecha: string): Promise<boolean>`,
    `darDeBaja(id: string): Promise<boolean>`.
  - `CamposEgresoService`: `listar()`, `crear(dto)`, `editar(id, dto)`, `darDeBaja(id: string, ahora: Date = new Date())`.
  - `GET /campos-egreso` (sesión), `POST /campos-egreso`, `PATCH /campos-egreso/:id`, `DELETE /campos-egreso/:id`
    (los tres con `campo_egreso.gestionar`). Cuerpo `{ nombre, tipo, seUsaEnApp? }`; `DELETE` responde `{ id }`.
    Duplicado → 409 `Ya existe un campo de egreso llamado "<nombre>".`; inexistente o dado de baja → 404
    `No existe ese campo de egreso.`; `PATCH` sin campos → 400 `No hay nada que actualizar.`; baja con gastos vivos
    del año en curso de Tijuana → 409 `Este campo tiene gastos este año; podrás darlo de baja el próximo año.`
  - `ComprasEgresosModule` con `CamposEgresoController` y sus proveedores.

- [ ] **Paso 1: la regla del año (falla: no existe)**

`apps/backend/src/modules/compras-egresos/reglas-campo-egreso.spec.ts`:

```ts
import { inicioDelAnioEnTijuana } from './reglas-campo-egreso';

describe('inicioDelAnioEnTijuana (T-30, D2)', () => {
  it('a media tarde es el 1 de enero del mismo año', () => {
    expect(inicioDelAnioEnTijuana(new Date('2026-10-20T20:00:00Z'))).toBe(
      '2026-01-01',
    );
  });

  it('el 1 de enero a las 07:30 UTC en Tijuana todavia es 31 de diciembre', () => {
    // Tijuana en invierno es UTC-8: 2027-01-01T07:30Z = 2026-12-31 23:30.
    expect(inicioDelAnioEnTijuana(new Date('2027-01-01T07:30:00Z'))).toBe(
      '2026-01-01',
    );
  });

  it('una hora despues ya es el año nuevo en Tijuana', () => {
    expect(inicioDelAnioEnTijuana(new Date('2027-01-01T08:30:00Z'))).toBe(
      '2027-01-01',
    );
  });
});
```

`apps/backend/src/modules/compras-egresos/campos-egreso.service.spec.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CamposEgresoService } from './campos-egreso.service';
import type { CampoEgreso } from './campos-egreso.repository';

const HIELO: CampoEgreso = {
  id: 'b6a1f3c2-0000-4000-8000-000000000030',
  nombre: 'Hielo',
  tipo: 'operacion',
  seUsaEnApp: true,
};

/** El `23505` tal como lo adjunta el driver `pg`. */
const unicidad = () => Object.assign(new Error('duplicado'), { code: '23505' });

function montar() {
  const repo = {
    listarVivos: jest.fn().mockResolvedValue([HIELO]),
    crear: jest.fn().mockResolvedValue(HIELO),
    editar: jest.fn().mockResolvedValue(HIELO),
    tieneGastosDesde: jest.fn().mockResolvedValue(false),
    darDeBaja: jest.fn().mockResolvedValue(true),
  };
  return { servicio: new CamposEgresoService(repo as never), repo };
}

describe('CamposEgresoService (T-30, D2/D3)', () => {
  it('crear sin la casilla la deja en false', async () => {
    const { servicio, repo } = montar();
    await servicio.crear({ nombre: 'Hielo', tipo: 'operacion' });
    expect(repo.crear).toHaveBeenCalledWith('Hielo', 'operacion', false);
  });

  it('un nombre repetido entre vivos es 409 con un mensaje que lo dice', async () => {
    const { servicio, repo } = montar();
    repo.crear.mockRejectedValue(unicidad());
    const error = await servicio
      .crear({ nombre: 'Hielo', tipo: 'operacion' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(
      'Ya existe un campo de egreso llamado "Hielo".',
    );
  });

  it('editar traduce los nombres de campo del portal a columnas', async () => {
    const { servicio, repo } = montar();
    await servicio.editar(HIELO.id, { seUsaEnApp: false, tipo: 'produccion' });
    expect(repo.editar).toHaveBeenCalledWith(HIELO.id, {
      se_usa_en_app: false,
      tipo: 'produccion',
    });
  });

  it('editar sin ningun campo es 400', async () => {
    const { servicio, repo } = montar();
    await expect(servicio.editar(HIELO.id, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.editar).not.toHaveBeenCalled();
  });

  it('renombrar a uno que ya existe es 409', async () => {
    const { servicio, repo } = montar();
    repo.editar.mockRejectedValue(unicidad());
    await expect(
      servicio.editar(HIELO.id, { nombre: 'Gasolina' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('editar uno que no existe o ya esta dado de baja es 404', async () => {
    const { servicio, repo } = montar();
    repo.editar.mockResolvedValue(undefined);
    await expect(
      servicio.editar(HIELO.id, { seUsaEnApp: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('la baja busca gastos desde el 1 de enero del año de Tijuana', async () => {
    const { servicio, repo } = montar();
    await servicio.darDeBaja(HIELO.id, new Date('2027-01-01T07:30:00Z'));
    expect(repo.tieneGastosDesde).toHaveBeenCalledWith(HIELO.id, '2026-01-01');
    expect(repo.darDeBaja).toHaveBeenCalledWith(HIELO.id);
  });

  it('con gastos vivos este año la baja es 409 y no da de baja nada', async () => {
    const { servicio, repo } = montar();
    repo.tieneGastosDesde.mockResolvedValue(true);
    const error = await servicio
      .darDeBaja(HIELO.id, new Date('2026-10-20T20:00:00Z'))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(
      'Este campo tiene gastos este año; podrás darlo de baja el próximo año.',
    );
    expect(repo.darDeBaja).not.toHaveBeenCalled();
  });

  it('dar de baja uno que no existe es 404', async () => {
    const { servicio, repo } = montar();
    repo.darDeBaja.mockResolvedValue(false);
    await expect(servicio.darDeBaja(HIELO.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
```

- [ ] **Paso 2: correr y ver fallar**

`npm test --workspace=apps/backend -- campo-egreso campos-egreso` → FAIL: `Cannot find module './reglas-campo-egreso'`
y `Cannot find module './campos-egreso.service'`.

- [ ] **Paso 3: tipos, regla y DTO**

`apps/backend/src/modules/compras-egresos/tipos-egreso.ts`:

```ts
/**
 * Los tres tipos de egreso (T-30, D1). Fijos: el cliente dijo que "ya deben de
 * venir grabados", asi que no se crean desde la app ni el portal. En la base
 * son el check `ck_campo_egreso_tipo` (y `ck_gasto_tipo`), no una tabla.
 */
export const TIPOS_EGRESO = ['produccion', 'operacion', 'financiero'] as const;

export type TipoEgreso = (typeof TIPOS_EGRESO)[number];

/**
 * El unico metodo de un gasto de la ruta (D4): sale del efectivo que cobro el
 * vendedor ese dia. El siguiente ticket (compras de oficina) amplia el check.
 */
export const METODO_GASTO_RUTA = 'efectivo_cobranza_dia' as const;
```

`apps/backend/src/modules/compras-egresos/reglas-campo-egreso.ts`:

```ts
import { hoyEnTijuana } from '../sincronizacion/operaciones';

/**
 * El 1 de enero del año en curso **en Tijuana** (`AAAA-01-01`), para la regla
 * de baja del campo (T-30, D2): "no se puede eliminar hasta el siguiente año".
 *
 * El año sale del dia de Tijuana y no del de UTC: el 31 de diciembre a las
 * 23:30 de Tijuana en UTC ya es el año siguiente, y la baja se colaria un rato
 * antes de tiempo.
 */
export function inicioDelAnioEnTijuana(ahora: Date): string {
  return `${hoyEnTijuana(ahora).slice(0, 4)}-01-01`;
}
```

`apps/backend/src/modules/compras-egresos/dto/campo-egreso.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TIPOS_EGRESO, type TipoEgreso } from '../tipos-egreso';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const MENSAJE_TIPO =
  'El tipo tiene que ser Producción, Operación o Financiero.';

/** Alta de un campo de egreso (T-30, D3). La casilla nace en `false`, igual que en la base. */
export class CrearCampoEgresoDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del campo es obligatorio.' })
  // Mismo tope que los demas catalogos que se pintan en una lista.
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;

  @IsIn(TIPOS_EGRESO, { message: MENSAJE_TIPO })
  tipo!: TipoEgreso;

  @IsOptional()
  @IsBoolean({ message: '"Se usa en la app" tiene que ser sí o no.' })
  seUsaEnApp?: boolean;
}

/** Edicion parcial: el servicio rechaza con 400 un cuerpo sin ningun campo. */
export class EditarCampoEgresoDto {
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del campo es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre?: string;

  @IsOptional()
  @IsIn(TIPOS_EGRESO, { message: MENSAJE_TIPO })
  tipo?: TipoEgreso;

  @IsOptional()
  @IsBoolean({ message: '"Se usa en la app" tiene que ser sí o no.' })
  seUsaEnApp?: boolean;
}
```

- [ ] **Paso 4: repositorio, servicio y controlador**

`apps/backend/src/modules/compras-egresos/campos-egreso.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { TipoEgreso } from './tipos-egreso';

/** Un campo tal como lo ve el portal (camelCase). */
export interface CampoEgreso {
  id: string;
  nombre: string;
  tipo: TipoEgreso;
  seUsaEnApp: boolean;
}

/** Lo que se puede cambiar de un campo, ya con nombres de columna. */
export interface CambiosCampoEgreso {
  nombre?: string;
  tipo?: TipoEgreso;
  se_usa_en_app?: boolean;
}

interface FilaCampo {
  id: string;
  nombre: string;
  tipo: string;
  se_usa_en_app: boolean;
}

function aCampo(f: FilaCampo): CampoEgreso {
  return {
    id: f.id,
    nombre: f.nombre,
    // El check `ck_campo_egreso_tipo` garantiza uno de los tres.
    tipo: f.tipo as TipoEgreso,
    seUsaEnApp: f.se_usa_en_app,
  };
}

const COLUMNAS = ['id', 'nombre', 'tipo', 'se_usa_en_app'] as const;

/**
 * SQL del catalogo `campo_egreso` (T-30, D2/D3). Global, como `motivo_visita`.
 * La baja es logica y el trigger `set_actualizado_en` mueve `actualizado_en`
 * en cualquier update: es lo que hace bajar la baja en el pull incremental.
 */
@Injectable()
export class CamposEgresoRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async listarVivos(): Promise<CampoEgreso[]> {
    const filas = await this.db
      .selectFrom('campo_egreso')
      .select(COLUMNAS)
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .execute();
    return filas.map(aCampo);
  }

  /** Lanza el `23505` de `uq_campo_egreso_nombre` tal cual: lo traduce el servicio. */
  async crear(
    nombre: string,
    tipo: TipoEgreso,
    seUsaEnApp: boolean,
  ): Promise<CampoEgreso> {
    const fila = await this.db
      .insertInto('campo_egreso')
      .values({ nombre, tipo, se_usa_en_app: seUsaEnApp })
      .returning(COLUMNAS)
      .executeTakeFirstOrThrow();
    return aCampo(fila);
  }

  /** `undefined` si no existe o ya estaba dado de baja. */
  async editar(
    id: string,
    cambios: CambiosCampoEgreso,
  ): Promise<CampoEgreso | undefined> {
    const fila = await this.db
      .updateTable('campo_egreso')
      .set(cambios)
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning(COLUMNAS)
      .executeTakeFirst();
    return fila ? aCampo(fila) : undefined;
  }

  /**
   * ¿Tiene el campo algun gasto VIVO con `fecha >= fecha`? (D2: no se da de
   * baja con gastos del año en curso). Un gasto borrado no cuenta. Usa
   * `idx_gasto_campo_fecha`.
   */
  async tieneGastosDesde(id: string, fecha: string): Promise<boolean> {
    const fila = await this.db
      .selectFrom('gasto')
      .select('id')
      .where('campo_egreso_id', '=', id)
      .where('deleted_at', 'is', null)
      .where('fecha', '>=', fecha)
      .limit(1)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /** `false` si no existe o ya estaba dado de baja. */
  async darDeBaja(id: string): Promise<boolean> {
    const fila = await this.db
      .updateTable('campo_egreso')
      .set({ deleted_at: sql`now()` })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    return fila !== undefined;
  }
}
```

`apps/backend/src/modules/compras-egresos/campos-egreso.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { esViolacionUnicidad } from '../../database/errores-postgres';
import {
  CamposEgresoRepository,
  type CambiosCampoEgreso,
  type CampoEgreso,
} from './campos-egreso.repository';
import type {
  CrearCampoEgresoDto,
  EditarCampoEgresoDto,
} from './dto/campo-egreso.dto';
import { inicioDelAnioEnTijuana } from './reglas-campo-egreso';

const NO_EXISTE = 'No existe ese campo de egreso.';
const CON_GASTOS_ESTE_ANIO =
  'Este campo tiene gastos este año; podrás darlo de baja el próximo año.';

function duplicado(nombre: string): ConflictException {
  return new ConflictException(
    `Ya existe un campo de egreso llamado "${nombre}".`,
  );
}

/**
 * El catalogo de campos de egreso del portal (T-30, D2/D3). El duplicado lo
 * decide el indice unico de la base, no una consulta previa (criterio de
 * T-09/T-12). Editar siempre se puede: los gastos ya registrados guardan una
 * copia del nombre y del tipo (D4).
 */
@Injectable()
export class CamposEgresoService {
  constructor(private readonly repo: CamposEgresoRepository) {}

  listar(): Promise<CampoEgreso[]> {
    return this.repo.listarVivos();
  }

  async crear(dto: CrearCampoEgresoDto): Promise<CampoEgreso> {
    try {
      return await this.repo.crear(dto.nombre, dto.tipo, dto.seUsaEnApp ?? false);
    } catch (error) {
      if (esViolacionUnicidad(error)) throw duplicado(dto.nombre);
      throw error;
    }
  }

  async editar(id: string, dto: EditarCampoEgresoDto): Promise<CampoEgreso> {
    const cambios: CambiosCampoEgreso = {};
    if (dto.nombre !== undefined) cambios.nombre = dto.nombre;
    if (dto.tipo !== undefined) cambios.tipo = dto.tipo;
    if (dto.seUsaEnApp !== undefined) cambios.se_usa_en_app = dto.seUsaEnApp;
    if (Object.keys(cambios).length === 0) {
      throw new BadRequestException('No hay nada que actualizar.');
    }

    let campo: CampoEgreso | undefined;
    try {
      campo = await this.repo.editar(id, cambios);
    } catch (error) {
      if (esViolacionUnicidad(error)) throw duplicado(dto.nombre ?? '');
      throw error;
    }
    if (!campo) throw new NotFoundException(NO_EXISTE);
    return campo;
  }

  /**
   * Baja logica, salvo que el campo tenga gastos vivos del año en curso en
   * Tijuana (D2, regla del cliente: "no se puede eliminar hasta el siguiente
   * año"). Un gasto que entre entre la consulta y la baja no se pierde: el push
   * acepta un campo dado de baja (D5).
   */
  async darDeBaja(id: string, ahora: Date = new Date()): Promise<void> {
    if (await this.repo.tieneGastosDesde(id, inicioDelAnioEnTijuana(ahora))) {
      throw new ConflictException(CON_GASTOS_ESTE_ANIO);
    }
    if (!(await this.repo.darDeBaja(id))) throw new NotFoundException(NO_EXISTE);
  }
}
```

`apps/backend/src/modules/compras-egresos/campos-egreso.controller.ts`:

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
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import type { CampoEgreso } from './campos-egreso.repository';
import { CamposEgresoService } from './campos-egreso.service';
import {
  CrearCampoEgresoDto,
  EditarCampoEgresoDto,
} from './dto/campo-egreso.dto';

// T-30 (D3). Leer pide solo sesion del portal; escribir, `campo_egreso.gestionar`.
// La tablet no usa estos endpoints: el catalogo le baja en el pull.
@Controller('campos-egreso')
export class CamposEgresoController {
  constructor(private readonly campos: CamposEgresoService) {}

  @Get()
  listar(): Promise<CampoEgreso[]> {
    return this.campos.listar();
  }

  @Post()
  @RequierePermiso('campo_egreso.gestionar')
  crear(@Body() dto: CrearCampoEgresoDto): Promise<CampoEgreso> {
    return this.campos.crear(dto);
  }

  @Patch(':id')
  @RequierePermiso('campo_egreso.gestionar')
  editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarCampoEgresoDto,
  ): Promise<CampoEgreso> {
    return this.campos.editar(id, dto);
  }

  @Delete(':id')
  @RequierePermiso('campo_egreso.gestionar')
  async eliminar(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.campos.darDeBaja(id);
    return { id };
  }
}
```

`apps/backend/src/modules/compras-egresos/compras-egresos.module.ts` (reemplaza el archivo entero):

```ts
import { Module } from '@nestjs/common';
import { CamposEgresoController } from './campos-egreso.controller';
import { CamposEgresoRepository } from './campos-egreso.repository';
import { CamposEgresoService } from './campos-egreso.service';

// T-30/T-31: el catalogo de campos de egreso y los gastos viven aqui (slug del
// vault `compras-egresos`, ADR-0009).
@Module({
  controllers: [CamposEgresoController],
  providers: [CamposEgresoService, CamposEgresoRepository],
})
export class ComprasEgresosModule {}
```

- [ ] **Paso 5: las pruebas unitarias pasan**

`npm test --workspace=apps/backend -- campo-egreso campos-egreso` → PASS (3 + 9).

- [ ] **Paso 6: la prueba e2e del catálogo**

`apps/backend/test/campos-egreso.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
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
import { hoyEnTijuana } from './../src/modules/sincronizacion/operaciones';

interface CampoRespuesta {
  id: string;
  nombre: string;
  tipo: string;
  seUsaEnApp: boolean;
}

// El PID va pegado al timestamp porque Jest corre archivos en paralelo.
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN_GENERAL = `e2e-cegr-gen-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-cegr-sin-${SUFIJO}`;
const LOGIN_VENDEDOR = `e2e-cegr-vend-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const PREFIJO = `ZZ-cegr-${SUFIJO}`;

describe('Campos de egreso (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  let cookieGeneral: string;
  let cookieSinPermiso: string;
  let sucursalId: string;
  let vendedorId: string;

  const http = () => request(app.getHttpServer());

  const iniciarSesion = async (login: string): Promise<string> => {
    const res = await http()
      .post('/auth/login')
      .send({ login, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const acceso = cookies.find((c) => c.startsWith('jawa_access='));
    if (!acceso) throw new Error('El login no devolvio cookie de acceso.');
    return acceso.split(';')[0];
  };

  const crearUsuario = async (login: string, perfil: string): Promise<void> => {
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
        sucursal_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    usuarioIds.push(id);
  };

  const crearCampo = async (nombre: string): Promise<CampoRespuesta> =>
    (
      await http()
        .post('/campos-egreso')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} ${nombre}`, tipo: 'operacion' })
        .expect(201)
    ).body as CampoRespuesta;

  /** Un gasto sembrado por debajo del servicio, como lo dejaria el push. */
  const sembrarGasto = async (
    campoId: string,
    fecha: string,
    borrado = false,
  ): Promise<void> => {
    await db
      .insertInto('gasto')
      .values({
        id: randomUUID(),
        sucursal_id: sucursalId,
        vendedor_id: vendedorId,
        campo_egreso_id: campoId,
        campo_nombre: 'sembrado',
        tipo: 'operacion',
        fecha,
        registrado_en: new Date(),
        monto: '10.00',
        metodo: 'efectivo_cobranza_dia',
        origen: 'app',
        deleted_at: borrado ? new Date() : null,
      })
      .execute();
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    await crearUsuario(LOGIN_GENERAL, 'Administrador General');
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo');
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);

    sucursalId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;
    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN_VENDEDOR,
          nombre: 'Vendedor de gastos',
          password_hash: 'x',
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    // Orden inverso a las llaves foraneas.
    await db.deleteFrom('gasto').where('vendedor_id', '=', vendedorId).execute();
    await db
      .deleteFrom('campo_egreso')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
    if (usuarioIds.length > 0) {
      await db
        .deleteFrom('sesion_refresh')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await app.close();
  });

  describe('GET /campos-egreso', () => {
    it('lista los vivos con su tipo y casilla a cualquiera con sesion, semilla incluida', async () => {
      const res = await http()
        .get('/campos-egreso')
        .set('Cookie', cookieSinPermiso)
        .expect(200);
      const lista = res.body as CampoRespuesta[];
      expect(lista.find((c) => c.nombre === 'Gasolina')).toMatchObject({
        tipo: 'operacion',
        seUsaEnApp: true,
      });
      expect(lista.find((c) => c.nombre === 'Envases')).toMatchObject({
        tipo: 'produccion',
        seUsaEnApp: false,
      });
    });

    it('sin sesion es 401', async () => {
      await http().get('/campos-egreso').expect(401);
    });
  });

  describe('POST /campos-egreso', () => {
    it('crea un campo con su tipo y su casilla', async () => {
      const res = await http()
        .post('/campos-egreso')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Casetas`, tipo: 'operacion', seUsaEnApp: true })
        .expect(201);
      expect(res.body).toMatchObject({
        nombre: `${PREFIJO} Casetas`,
        tipo: 'operacion',
        seUsaEnApp: true,
      });
    });

    it('un nombre repetido (sin importar mayusculas ni espacios) es 409 y lo dice', async () => {
      await crearCampo('Llantas');
      const res = await http()
        .post('/campos-egreso')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `  ${PREFIJO} LLANTAS `, tipo: 'operacion' })
        .expect(409);
      expect((res.body as { message: string }).message).toBe(
        `Ya existe un campo de egreso llamado "${PREFIJO} LLANTAS".`,
      );
    });

    it('un tipo fuera de los tres es 400', async () => {
      await http()
        .post('/campos-egreso')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Nomina`, tipo: 'nomina' })
        .expect(400);
    });

    it('un nombre vacio es 400', async () => {
      await http()
        .post('/campos-egreso')
        .set('Cookie', cookieGeneral)
        .send({ nombre: '   ', tipo: 'operacion' })
        .expect(400);
    });

    it('sin campo_egreso.gestionar es 403', async () => {
      await http()
        .post('/campos-egreso')
        .set('Cookie', cookieSinPermiso)
        .send({ nombre: `${PREFIJO} X`, tipo: 'operacion' })
        .expect(403);
    });
  });

  describe('PATCH /campos-egreso/:id', () => {
    it('cambia el nombre, el tipo y la casilla', async () => {
      const { id } = await crearCampo('Agua');
      const res = await http()
        .patch(`/campos-egreso/${id}`)
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Garrafones`, tipo: 'produccion', seUsaEnApp: true })
        .expect(200);
      expect(res.body).toEqual({
        id,
        nombre: `${PREFIJO} Garrafones`,
        tipo: 'produccion',
        seUsaEnApp: true,
      });
    });

    it('editar siempre se puede, aunque tenga gastos este año', async () => {
      const { id } = await crearCampo('Editable');
      await sembrarGasto(id, hoyEnTijuana());
      await http()
        .patch(`/campos-egreso/${id}`)
        .set('Cookie', cookieGeneral)
        .send({ seUsaEnApp: true })
        .expect(200);
    });

    it('sin cuerpo es 400 y sin permiso es 403', async () => {
      const { id } = await crearCampo('Vacio');
      await http()
        .patch(`/campos-egreso/${id}`)
        .set('Cookie', cookieGeneral)
        .send({})
        .expect(400);
      await http()
        .patch(`/campos-egreso/${id}`)
        .set('Cookie', cookieSinPermiso)
        .send({ seUsaEnApp: true })
        .expect(403);
    });
  });

  describe('DELETE /campos-egreso/:id', () => {
    it('sin gastos se da de baja, sale de la lista y libera el nombre', async () => {
      const { id, nombre } = await crearCampo('Temporal');
      await http()
        .delete(`/campos-egreso/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(200, { id });
      const lista = (
        await http().get('/campos-egreso').set('Cookie', cookieGeneral).expect(200)
      ).body as CampoRespuesta[];
      expect(lista.some((c) => c.id === id)).toBe(false);
      await http()
        .post('/campos-egreso')
        .set('Cookie', cookieGeneral)
        .send({ nombre, tipo: 'financiero' })
        .expect(201);
      await http()
        .delete(`/campos-egreso/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(404);
    });

    it('con un gasto vivo de este año (Tijuana) es 409 con el motivo del cliente', async () => {
      const { id } = await crearCampo('Con gasto');
      await sembrarGasto(id, hoyEnTijuana());
      const res = await http()
        .delete(`/campos-egreso/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(409);
      expect((res.body as { message: string }).message).toBe(
        'Este campo tiene gastos este año; podrás darlo de baja el próximo año.',
      );
    });

    it('con gastos solo del año pasado se da de baja', async () => {
      const { id } = await crearCampo('Año pasado');
      const anio = Number(hoyEnTijuana().slice(0, 4));
      await sembrarGasto(id, `${anio - 1}-12-31`);
      await http()
        .delete(`/campos-egreso/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(200);
    });

    it('un gasto de este año dado de baja no bloquea', async () => {
      const { id } = await crearCampo('Gasto borrado');
      await sembrarGasto(id, hoyEnTijuana(), true);
      await http()
        .delete(`/campos-egreso/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(200);
    });

    it('sin permiso es 403', async () => {
      const { id } = await crearCampo('Protegido');
      await http()
        .delete(`/campos-egreso/${id}`)
        .set('Cookie', cookieSinPermiso)
        .expect(403);
    });
  });
});
```

- [ ] **Paso 7: correr el e2e**

`npm run test:e2e --workspace=apps/backend -- campos-egreso` → PASS (15).

- [ ] **Paso 8: lint por archivo, build y commit**

```bash
npm exec --workspace=apps/backend -- prettier --write src/modules/compras-egresos/tipos-egreso.ts src/modules/compras-egresos/reglas-campo-egreso.ts src/modules/compras-egresos/reglas-campo-egreso.spec.ts src/modules/compras-egresos/dto/campo-egreso.dto.ts src/modules/compras-egresos/campos-egreso.repository.ts src/modules/compras-egresos/campos-egreso.service.ts src/modules/compras-egresos/campos-egreso.service.spec.ts src/modules/compras-egresos/campos-egreso.controller.ts src/modules/compras-egresos/compras-egresos.module.ts test/campos-egreso.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/compras-egresos/tipos-egreso.ts src/modules/compras-egresos/reglas-campo-egreso.ts src/modules/compras-egresos/reglas-campo-egreso.spec.ts src/modules/compras-egresos/dto/campo-egreso.dto.ts src/modules/compras-egresos/campos-egreso.repository.ts src/modules/compras-egresos/campos-egreso.service.ts src/modules/compras-egresos/campos-egreso.service.spec.ts src/modules/compras-egresos/campos-egreso.controller.ts src/modules/compras-egresos/compras-egresos.module.ts test/campos-egreso.e2e-spec.ts
npm run build --workspace=apps/backend
git add apps/backend/src/modules/compras-egresos apps/backend/test/campos-egreso.e2e-spec.ts
git commit -m "T-30/T-31: catálogo Campos de egreso (CRUD, regla de baja del año en Tijuana)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Los paths de `prettier`/`eslint` son relativos a `apps/backend` porque `npm exec --workspace` corre ahí.)

---

### Tarea 3: Operación `gasto` en el push: contrato, forma y proyección (D4, D5)

**Files:**
- Create: `apps/backend/src/modules/compras-egresos/datos-gasto.ts`
- Create: `apps/backend/src/modules/compras-egresos/datos-gasto.spec.ts`
- Create: `apps/backend/src/modules/compras-egresos/gasto-rechazado.ts`
- Create: `apps/backend/src/modules/compras-egresos/gastos.repository.ts`
- Create: `apps/backend/src/modules/compras-egresos/gastos.service.ts`
- Create: `apps/backend/src/modules/compras-egresos/gastos.service.spec.ts`
- Modify: `apps/backend/src/modules/compras-egresos/compras-egresos.module.ts`
- Create: `apps/backend/src/modules/sincronizacion/despacho-gasto.ts`
- Create: `apps/backend/src/modules/sincronizacion/despacho-gasto.spec.ts`
- Modify: `apps/backend/src/modules/sincronizacion/despacho.ts`
- Modify: `apps/backend/src/modules/sincronizacion/despacho.spec.ts:39-49`
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.module.ts`
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts` (línea 67, `CODIGOS_RECHAZO`, `DatosGasto`)
- Modify: `apps/tablet/src/sincronizacion/contrato.ts` (`CODIGOS_RECHAZO`, `DatosGasto`)
- Modify: `docs/contrato-sincronizacion.md` (§6, tabla de rechazos, §7, §9)
- Modify: `apps/backend/test/sincronizacion.e2e-spec.ts:111-138` y `:1424-1458` (el sobre genérico pasa a `merma`)
- Create: `apps/backend/test/gasto.e2e-spec.ts`

**Interfaces:**
- Consumes: tabla `gasto` y `campo_egreso` (Tarea 1); `TipoEgreso`, `METODO_GASTO_RUTA` (`tipos-egreso.ts`, Tarea 2);
  `ComprasEgresosModule` (Tarea 2); `RE_UUID` (`rutas/datos-visita.ts`), `esInstante` (`rutas/datos-jornada.ts`),
  `aPesos` (`sincronizacion/dinero.ts`).
- Produces:
  - Contrato (backend y tablet): `export type DatosGasto = { campo_egreso_id: string; monto_centavos: number;
    registrado_en: string; comentario?: string | null }`; códigos `'campo-egreso-inexistente'` y `'gasto-id-ocupado'`.
  - `datos-gasto.ts`: `LARGO_MAX_COMENTARIO_GASTO = 200`, `MAX_MONTO_GASTO_CENTAVOS = 999_999_999_999`,
    `interface GastoNormalizado { campoEgresoId: string; montoCentavos: number; registradoEn: string; comentario:
    string | null }`, `normalizarDatosGasto(datos: Record<string, unknown>): ResultadoDatosGasto`.
  - `gasto-rechazado.ts`: `type RazonRechazoGasto = 'campo-egreso-inexistente' | 'gasto-id-ocupado'`,
    `class GastoRechazado extends Error { readonly razon: RazonRechazoGasto }`.
  - `GastosRepository`: `campoParaGasto(campoId: string, trx): Promise<{ nombre: string; tipo: TipoEgreso } |
    undefined>`, `nombreVendedor(vendedorId: string, trx): Promise<string | null>`, `insertar(nuevo: NuevoGasto, trx):
    Promise<string | null>`.
  - `GastosService.registrarGasto(gasto: GastoNormalizado, contexto: ContextoGasto, trx: Transaction<DB>):
    Promise<EntidadGasto>`; `interface ContextoGasto { id: string; sucursalId: string; vendedorId: string;
    fechaOperacion: string }`; `interface EntidadGasto { tabla: 'gasto'; id: string }`. Las Tareas 4 y 6 le agregan
    `existe`, `anotarFoto`, `listar` y `rutaFoto`.
  - `despacho-gasto.ts`: `prepararGasto(op: OperacionNormalizada): PreparacionGasto` (`{ ok: true; gasto:
    GastoNormalizado } | ({ ok: false } & Rechazo)`), `CODIGO_POR_RAZON_GASTO: Record<RazonRechazoGasto, CodigoRechazo>`.
  - `Proyeccion` gana `{ tipo: 'gasto'; gasto: GastoNormalizado }`. `ComprasEgresosModule` exporta `GastosService`;
    `SincronizacionModule` importa `ComprasEgresosModule`.

> Los rechazos del gasto se llaman `campo-egreso-inexistente` y `gasto-id-ocupado`, exactos. El servidor **no**
> revisa `se_usa_en_app` (D5): la oficina puede apagar la casilla mientras la tablet está sin red.

- [ ] **Paso 1: la forma de `datos` (falla: no existe)**

`apps/backend/src/modules/compras-egresos/datos-gasto.spec.ts`:

```ts
import { normalizarDatosGasto } from './datos-gasto';

const CAMPO = '5d1c9a7e-3b2f-4c8d-9e0a-1b2c3d4e5f30';

const datos = (extra: Record<string, unknown> = {}) => ({
  campo_egreso_id: CAMPO,
  monto_centavos: 25050,
  registrado_en: '2026-10-20T11:40:00-07:00',
  comentario: null,
  ...extra,
});

describe('normalizarDatosGasto (T-30/T-31, D5)', () => {
  it('normaliza un gasto valido: uuid en minusculas e instante en UTC', () => {
    expect(
      normalizarDatosGasto(datos({ campo_egreso_id: CAMPO.toUpperCase() })),
    ).toEqual({
      ok: true,
      gasto: {
        campoEgresoId: CAMPO,
        montoCentavos: 25050,
        registradoEn: '2026-10-20T18:40:00.000Z',
        comentario: null,
      },
    });
  });

  it('recorta el comentario; vacio o ausente es null', () => {
    const r1 = normalizarDatosGasto(datos({ comentario: '  Ticket roto  ' }));
    expect(r1.ok && r1.gasto.comentario).toBe('Ticket roto');
    const r2 = normalizarDatosGasto(datos({ comentario: '   ' }));
    expect(r2.ok && r2.gasto.comentario).toBeNull();
    const sinComentario: Record<string, unknown> = datos();
    delete sinComentario.comentario;
    const r3 = normalizarDatosGasto(sinComentario);
    expect(r3.ok && r3.gasto.comentario).toBeNull();
  });

  it('acepta el monto maximo y el comentario de 200', () => {
    expect(
      normalizarDatosGasto(
        datos({ monto_centavos: 999_999_999_999, comentario: 'x'.repeat(200) }),
      ).ok,
    ).toBe(true);
  });

  it.each([
    [{ campo_egreso_id: 'hielo' }, /^campo_egreso_id: /],
    [{ campo_egreso_id: undefined }, /^campo_egreso_id: /],
    [{ monto_centavos: 0 }, /^monto_centavos: /],
    [{ monto_centavos: -100 }, /^monto_centavos: /],
    [{ monto_centavos: 1234.5 }, /^monto_centavos: /],
    [{ monto_centavos: 1_000_000_000_000 }, /^monto_centavos: /],
    [{ monto_centavos: '25050' }, /^monto_centavos: /],
    [{ monto_centavos: Number.NaN }, /^monto_centavos: /],
    [{ registrado_en: '2026-10-20T11:40:00' }, /^registrado_en: /],
    [{ registrado_en: '2026-02-30T11:40:00Z' }, /^registrado_en: /],
    [{ comentario: 5 }, /^comentario: /],
    [{ comentario: 'x'.repeat(201) }, /^comentario: /],
  ])('%j es invalido y el motivo nombra el campo', (extra, motivo) => {
    const r = normalizarDatosGasto(datos(extra));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(motivo);
  });
});
```

`apps/backend/src/modules/sincronizacion/despacho-gasto.spec.ts`:

```ts
import { CODIGOS_RECHAZO } from './contrato';
import { CODIGO_POR_RAZON_GASTO, prepararGasto } from './despacho-gasto';
import type { OperacionNormalizada } from './operaciones';

const CAMPO = '5d1c9a7e-3b2f-4c8d-9e0a-1b2c3d4e5f30';

const op = (
  extra: Partial<OperacionNormalizada> = {},
): OperacionNormalizada => ({
  clave: 'c0ffee00-0000-4000-8000-000000000030',
  tipo: 'gasto',
  fechaOperacion: '2026-10-20',
  ocurridoEn: '2026-10-20T18:40:00.000Z',
  clienteId: null,
  folio: null,
  datos: {
    campo_egreso_id: CAMPO,
    monto_centavos: 8000,
    registrado_en: '2026-10-20T18:40:00.000Z',
    comentario: null,
  },
  ...extra,
});

describe('prepararGasto (T-30/T-31, D5)', () => {
  it('un gasto valido sale con sus datos normalizados', () => {
    expect(prepararGasto(op())).toEqual({
      ok: true,
      gasto: {
        campoEgresoId: CAMPO,
        montoCentavos: 8000,
        registradoEn: '2026-10-20T18:40:00.000Z',
        comentario: null,
      },
    });
  });

  it.each([
    [{ folio: 'TJ261020AP01' }, /^folio: /],
    [{ clienteId: '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b' }, /^cliente_id: /],
    [{ clave: 'gasto-123' }, /^clave: .*uuid/],
    [
      {
        datos: {
          campo_egreso_id: CAMPO,
          monto_centavos: 0,
          registrado_en: '2026-10-20T18:40:00.000Z',
        },
      },
      /^monto_centavos: /,
    ],
  ])('%j es datos-invalidos con un motivo que nombra el campo', (extra, motivo) => {
    const r = prepararGasto(op(extra));
    expect(r).toMatchObject({ ok: false, codigo: 'datos-invalidos' });
    if (!r.ok) expect(r.motivo).toMatch(motivo);
  });

  it('cada razon del dominio sale con un codigo que existe en el contrato', () => {
    for (const codigo of Object.values(CODIGO_POR_RAZON_GASTO)) {
      expect(CODIGOS_RECHAZO).toContain(codigo);
    }
    expect(CODIGO_POR_RAZON_GASTO).toEqual({
      'campo-egreso-inexistente': 'campo-egreso-inexistente',
      'gasto-id-ocupado': 'gasto-id-ocupado',
    });
  });
});
```

`apps/backend/src/modules/compras-egresos/gastos.service.spec.ts`:

```ts
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { GastoNormalizado } from './datos-gasto';
import { GastoRechazado } from './gasto-rechazado';
import { GastosService, type ContextoGasto } from './gastos.service';

const trx = {} as Transaction<DB>;

const contexto: ContextoGasto = {
  id: 'c0ffee00-0000-4000-8000-000000000030',
  sucursalId: 'sucursal-tj',
  vendedorId: 'vendedor-1',
  fechaOperacion: '2026-10-20',
};

const gasto: GastoNormalizado = {
  campoEgresoId: 'campo-hielo',
  montoCentavos: 8050,
  registradoEn: '2026-10-21T01:30:00.000Z',
  comentario: 'Dos bolsas',
};

function montar(
  opciones: {
    campo?: { nombre: string; tipo: 'operacion' } | undefined;
    idInsertado?: string | null;
  } = {},
) {
  const repo = {
    campoParaGasto: jest
      .fn()
      .mockResolvedValue(
        'campo' in opciones
          ? opciones.campo
          : { nombre: 'Hielo', tipo: 'operacion' },
      ),
    nombreVendedor: jest.fn().mockResolvedValue('Juan Pérez'),
    insertar: jest
      .fn()
      .mockResolvedValue(
        'idInsertado' in opciones ? opciones.idInsertado : contexto.id,
      ),
  };
  return { servicio: new GastosService(repo as never), repo };
}

describe('GastosService.registrarGasto (T-30/T-31, D4/D5)', () => {
  it('inserta con el id de la clave, el dia del sobre, la copia del campo y el metodo fijo', async () => {
    const { servicio, repo } = montar();
    await expect(servicio.registrarGasto(gasto, contexto, trx)).resolves.toEqual({
      tabla: 'gasto',
      id: contexto.id,
    });
    expect(repo.campoParaGasto).toHaveBeenCalledWith('campo-hielo', trx);
    expect(repo.nombreVendedor).toHaveBeenCalledWith('vendedor-1', trx);
    expect(repo.insertar).toHaveBeenCalledWith(
      {
        id: contexto.id,
        sucursalId: 'sucursal-tj',
        vendedorId: 'vendedor-1',
        campoEgresoId: 'campo-hielo',
        campoNombre: 'Hielo',
        tipo: 'operacion',
        // El dia del sobre tal cual, aunque en UTC `registradoEn` ya sea el 21.
        fecha: '2026-10-20',
        registradoEn: '2026-10-21T01:30:00.000Z',
        montoCentavos: 8050,
        metodo: 'efectivo_cobranza_dia',
        origen: 'app',
        quien: 'Juan Pérez',
        comentario: 'Dos bolsas',
      },
      trx,
    );
  });

  it('un campo que no existe es campo-egreso-inexistente y no inserta', async () => {
    const { servicio, repo } = montar({ campo: undefined });
    const error = await servicio
      .registrarGasto(gasto, contexto, trx)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GastoRechazado);
    expect((error as GastoRechazado).razon).toBe('campo-egreso-inexistente');
    expect(repo.insertar).not.toHaveBeenCalled();
  });

  it('un id ocupado es gasto-id-ocupado con un motivo neutro', async () => {
    const { servicio } = montar({ idInsertado: null });
    const error = await servicio
      .registrarGasto(gasto, contexto, trx)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GastoRechazado);
    expect((error as GastoRechazado).razon).toBe('gasto-id-ocupado');
    expect((error as Error).message).toBe(
      'El id de este gasto ya está ocupado. Avisa a la oficina.',
    );
  });
});
```

- [ ] **Paso 2: correr y ver fallar**

`npm test --workspace=apps/backend -- datos-gasto despacho-gasto gastos.service` → FAIL: no existen
`./datos-gasto`, `./despacho-gasto`, `./gastos.service`.

- [ ] **Paso 3: el contrato (los dos `contrato.ts` y el documento, en este commit)**

`apps/backend/src/modules/sincronizacion/contrato.ts`:

1. Sustituye la línea 67

```ts
 * TODO: T-27 — `gasto` (hielo, gasolina, reparacion, adelanto).
```

por

```ts
 * Hecho: T-30/T-31 — `gasto`, un gasto de la ruta pagado con el efectivo
 *        cobrado (ver {@link DatosGasto}); se proyecta a la tabla `gasto` con
 *        `id = clave`. El tipo ya existia: fijar su forma es aditivo y no sube
 *        la version.
```

2. Al final de `CODIGOS_RECHAZO`, después de `'visita-id-ocupado',`:

```ts
  /**
   * El `campo_egreso_id` de un gasto no existe en el catalogo. T-30/T-31. Un
   * campo **dado de baja si se acepta**, y tampoco se mira "se usa en la app":
   * la oficina pudo cambiarlo mientras la tablet estaba sin red. Esto solo cae
   * con un id que nunca existio (bug de la tablet).
   */
  'campo-egreso-inexistente',
  /**
   * El id del gasto (su clave) ya esta ocupado por otro registro. T-30/T-31. El
   * mismo vendedor con la misma clave es `duplicada`, no esto. Motivo neutro.
   */
  'gasto-id-ocupado',
```

3. Después de `DatosVisita` (antes de `export interface ResultadoOperacion`):

```ts
/**
 * `datos` de una operacion `tipo: "gasto"` (T-30/T-31): un gasto de la ruta
 * (hielo, gasolina, reparacion del vehiculo, adelanto de sueldo) que el
 * vendedor pago con el efectivo que cobro.
 *
 * El sobre **no** lleva `cliente_id` (un gasto no es de un cliente) ni folio.
 * La `clave` **es el id** de la fila `gasto`: debe ser uuid. El dia al que
 * cuenta es `fecha_operacion`, nunca re-derivado de `registrado_en`. El metodo
 * no viaja: en la app siempre es efectivo de la cobranza del dia.
 *
 * El servidor **no** revisa `se_usa_en_app` del campo, y uno dado de baja se
 * acepta.
 *
 * Es `type` y no `interface` por la misma razon que {@link DatosVenta}.
 */
export type DatosGasto = {
  /** uuid de `campo_egreso` (vivo o dado de baja). */
  campo_egreso_id: string;
  /** Entero, de 1 a 999_999_999_999. */
  monto_centavos: number;
  /** Instante ISO-8601 con zona en que el vendedor lo guardo. */
  registrado_en: string;
  /** Hasta 200 caracteres; se recorta y uno vacio es `null`. */
  comentario?: string | null;
};
```

`apps/tablet/src/sincronizacion/contrato.ts`:

1. Al final de `CODIGOS_RECHAZO`, después de `'visita-id-ocupado',`:

```ts
  /**
   * T-30/T-31: el campo del gasto no existe en el servidor (un id que nunca
   * existio; uno dado de baja se acepta). El gasto queda en `error`.
   */
  'campo-egreso-inexistente',
  /** T-30/T-31: el id del gasto ya lo ocupa otro registro. Motivo neutro. */
  'gasto-id-ocupado',
```

2. Después de `DatosVisita`:

```ts
/**
 * `datos` de una operacion `tipo: "gasto"` (T-30/T-31). Copia del tipo del
 * backend: sin `cliente_id` ni folio en el sobre; la clave es el id del gasto.
 */
export type DatosGasto = {
  /** uuid de `campo_egreso` (vivo o dado de baja). */
  campo_egreso_id: string;
  /** Entero, de 1 a 999_999_999_999. */
  monto_centavos: number;
  /** Instante ISO-8601 con zona en que el vendedor lo guardo. */
  registrado_en: string;
  /** Hasta 200 caracteres. */
  comentario?: string | null;
};
```

`docs/contrato-sincronizacion.md`:

1. §6, el párrafo de la línea ~468:

```markdown
`datos` lo fija el ticket de cada módulo, y fijarlo es un cambio **aditivo** que
no sube la versión del contrato. Hoy tienen forma fija **`venta`** (T-16),
**`prospecto`** (T-40), **`cobranza`** (T-20), **`jornada`** (T-38),
**`ruta-alta`** (T-37), **`visita`** (T-39) y **`gasto`** (T-30/T-31), los siete
abajo; merma y ruta (reservada, sin forma) siguen libres hasta T-33, y el servidor
las guarda tal cual.
```

2. En la sección de la visita, la viñeta del orden del push pasa a:

```markdown
- **Orden del push**: `jornadas → prospectos → ventas → cobranzas → visitas → gastos → rutas`. La visita a un prospecto
  capturado sin red necesita que su alta ya haya entrado en un lote anterior (el alcance se comprueba una vez por
  lote, como la venta de bienvenida de T-75).
```

3. Sección nueva entre la de la visita y "### Fotos: subida y descarga":

````markdown
### `datos` de un gasto de la ruta (T-30/T-31)

```jsonc
{
  "clave": "uuid de la fila local",     // ES el id del gasto en el servidor: debe ser uuid
  "tipo": "gasto",
  "fecha_operacion": "2026-10-20",      // el día al que cuenta el gasto (Tesorería y el corte)
  "ocurrido_en": "2026-10-20T18:40:00.000Z",
  // sin "cliente_id" y sin "folio": un gasto no es de un cliente ni es una nota
  "datos": {
    "campo_egreso_id": "uuid",          // del catálogo campos_egreso (vivo o dado de baja)
    "monto_centavos": 25050,            // entero, 1..999 999 999 999
    "registrado_en": "2026-10-20T11:40:00-07:00",
    "comentario": "Ticket de la gasolinera" // opcional, <= 200
  }
}
```

- La forma se valida **antes** de la transacción (`prepararGasto`): clave no uuid, folio o `cliente_id` en el
  sobre, o `datos` mal formado es `datos-invalidos` con un motivo que nombra el campo. El comentario se recorta y uno
  vacío se guarda como `null`.
- Dentro de la transacción (`GastosService.registrarGasto`, `modules/compras-egresos/`): un campo que no existe es
  `campo-egreso-inexistente`; **uno dado de baja sí se acepta**, y el servidor **no** revisa "se usa en la app". Un
  id que ya ocupa otro gasto es `gasto-id-ocupado`, con motivo neutro. La misma clave reenviada es `duplicada`.
- Se guarda en `gasto` con `id = clave`, `fecha = fecha_operacion` (nunca re-derivada de `registrado_en`),
  `metodo = 'efectivo_cobranza_dia'`, `origen = 'app'`, `quien` = el nombre del vendedor y una copia del nombre y
  el tipo del campo. El buzón apunta a esa fila (`entidad_tabla = 'gasto'`).
- Tesorería **lee** la tabla `gasto` (no copia nada) y resta el gasto de la cuenta de efectivo de la sucursal.
- **Orden del push**: `jornadas → prospectos → ventas → cobranzas → visitas → gastos → rutas`.
- Las operaciones `gasto` que llegaron antes de T-30/T-31 (ninguna tablet las mandaba) se quedan en el buzón sin
  proyectar y sin relleno.
````

4. En la tabla "### Códigos de rechazo", después de la fila de `visita-id-ocupado`:

```markdown
| `campo-egreso-inexistente` | El `campo_egreso_id` de un gasto no existe. Uno dado de baja **sí** se acepta y "se usa en la app" no se revisa. Se reintenta (T-30/T-31) |
| `gasto-id-ocupado` | El id (la clave) del gasto ya lo ocupa otro registro. Motivo neutro; avisar a la oficina (T-30/T-31) |
```

5. §7, "### Una transacción por operación": la frase inicial pasa a "(hoy `venta`, `cobranza`, `prospecto`,
   `jornada`, `ruta-alta`, `visita` y `gasto`)"; después de la viñeta de `VisitasService.registrarVisita` agrega:

```markdown
   - `GastosService.registrarGasto` (T-30/T-31) → comprueba que el campo exista (**aunque esté dado de baja**),
     copia su nombre y su tipo e inserta en `gasto` con `id = clave` y `on conflict (id) do nothing`; si no
     insertó, `gasto-id-ocupado`. La entidad es la fila de `gasto`.
```

   En la lista de rechazos del paso 3 agrega `campo-egreso-inexistente`, `gasto-id-ocupado` después de
   `visita-id-ocupado`, y la frase siguiente pasa a: "Los tipos sin módulo todavía (`merma`, `ruta`) se guardan en el
   buzón y quedan `aplicada` con `entidad_id` nulo, como hasta ahora."

6. §9, las dos filas de gasto/merma pasan a:

```markdown
| Forma de `datos` para merma (la de `ruta` sigue reservada sin forma; la visita es `visita` y el gasto `gasto`, §6) | **T-33** |
| Proyección de `merma` a su tabla de negocio (las de `venta`, `cobranza`, `jornada`, `ruta-alta`, `visita` y `gasto` ya existen, §7) | El mismo |
```

- [ ] **Paso 4: dominio del gasto (forma, rechazo, repositorio y servicio)**

`apps/backend/src/modules/compras-egresos/datos-gasto.ts`:

```ts
import { esInstante } from '../rutas/datos-jornada';
import { RE_UUID } from '../rutas/datos-visita';

/**
 * Validacion y normalizacion de `datos` de un gasto de la ruta (T-30/T-31, D5).
 *
 * Pura, sin base: decide la FORMA. Que el campo exista y que el id este libre
 * lo decide `GastosService` dentro de la transaccion. Comprueba lo que haria
 * reventar a Postgres (un uuid mal formado, un monto fuera de `numeric(14,2)`,
 * un instante que no existe): un 500 tumba el lote y la tablet reintentaria
 * para siempre.
 */

export const LARGO_MAX_COMENTARIO_GASTO = 200;
/** 9,999,999,999.99 pesos: lo que cabe en `numeric(14,2)` con margen, igual que la cobranza. */
export const MAX_MONTO_GASTO_CENTAVOS = 999_999_999_999;

/** El gasto ya validado. Id, vendedor, sucursal y fecha viajan en el contexto. */
export interface GastoNormalizado {
  /** uuid en minusculas. */
  campoEgresoId: string;
  montoCentavos: number;
  /** ISO-8601 en UTC (`toISOString`). */
  registradoEn: string;
  comentario: string | null;
}

export type ResultadoDatosGasto =
  | { ok: true; gasto: GastoNormalizado }
  /** El `motivo` empieza por el campo: es lo que guarda la tablet en `sync_error`. */
  | { ok: false; motivo: string };

/** Valida y normaliza `datos` de una operacion `gasto`. */
export function normalizarDatosGasto(
  datos: Record<string, unknown>,
): ResultadoDatosGasto {
  const campo = datos.campo_egreso_id;
  if (typeof campo !== 'string' || !RE_UUID.test(campo)) {
    return {
      ok: false,
      motivo:
        'campo_egreso_id: tiene que ser el uuid de un campo de egreso del catálogo.',
    };
  }

  const monto = datos.monto_centavos;
  if (
    typeof monto !== 'number' ||
    !Number.isInteger(monto) ||
    monto < 1 ||
    monto > MAX_MONTO_GASTO_CENTAVOS
  ) {
    return {
      ok: false,
      motivo: `monto_centavos: tiene que ser un entero de 1 a ${MAX_MONTO_GASTO_CENTAVOS} (centavos).`,
    };
  }

  const registradoEn = datos.registrado_en;
  if (!esInstante(registradoEn)) {
    return {
      ok: false,
      motivo:
        'registrado_en: tiene que ser un instante ISO-8601 con zona (por ejemplo 2026-10-20T18:40:00Z).',
    };
  }

  let comentario: string | null = null;
  const crudo = datos.comentario;
  if (crudo !== undefined && crudo !== null) {
    if (typeof crudo !== 'string') {
      return { ok: false, motivo: 'comentario: tiene que ser texto o null.' };
    }
    const limpio = crudo.trim();
    if (limpio.length > LARGO_MAX_COMENTARIO_GASTO) {
      return {
        ok: false,
        motivo: `comentario: no puede pasar de ${LARGO_MAX_COMENTARIO_GASTO} caracteres.`,
      };
    }
    comentario = limpio === '' ? null : limpio;
  }

  return {
    ok: true,
    gasto: {
      campoEgresoId: campo.toLowerCase(),
      montoCentavos: monto,
      registradoEn: new Date(registradoEn).toISOString(),
      comentario,
    },
  };
}
```

`apps/backend/src/modules/compras-egresos/gasto-rechazado.ts`:

```ts
/**
 * Un gasto que el DOMINIO no acepta (T-30/T-31). Igual que `VisitaRechazada`:
 * no importa nada del contrato; `push` la traduce a su codigo
 * (`sincronizacion/despacho-gasto.ts`). La forma de `datos` no esta aqui: se
 * rechaza antes de abrir la transaccion (`datos-gasto.ts`).
 */
export type RazonRechazoGasto =
  /** El `campo_egreso_id` no existe (uno dado de baja si se acepta, D5). */
  | 'campo-egreso-inexistente'
  /** El id (la clave) ya lo ocupa otro gasto. */
  | 'gasto-id-ocupado';

export interface RechazoGasto {
  razon: RazonRechazoGasto;
  /** En el espanol que leera quien tenga la tablet en la mano. */
  motivo: string;
}

export class GastoRechazado extends Error {
  readonly razon: RazonRechazoGasto;

  constructor({ razon, motivo }: RechazoGasto) {
    super(motivo);
    this.name = 'GastoRechazado';
    this.razon = razon;
  }
}
```

`apps/backend/src/modules/compras-egresos/gastos.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { aPesos } from '../sincronizacion/dinero';
import type { TipoEgreso } from './tipos-egreso';

/** Una fila de `gasto` lista para escribir. */
export interface NuevoGasto {
  id: string;
  sucursalId: string;
  vendedorId: string | null;
  campoEgresoId: string;
  campoNombre: string;
  tipo: TipoEgreso;
  /** `AAAA-MM-DD`: la `fecha_operacion` del sobre, tal cual. */
  fecha: string;
  registradoEn: string;
  montoCentavos: number;
  metodo: 'efectivo_cobranza_dia';
  origen: 'app' | 'portal';
  quien: string | null;
  comentario: string | null;
}

/**
 * SQL de los gastos (T-30/T-31). Lo del push recibe la `trx` y no abre la suya:
 * el gasto entra o sale junto con su fila del buzon (ADR-0009 §2.3).
 */
@Injectable()
export class GastosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * Nombre y tipo del campo, para copiarlos al gasto (D4). **Sin mirar
   * `deleted_at`** a proposito (D5): uno dado de baja despues de que el
   * vendedor lo eligio sin red se acepta.
   */
  async campoParaGasto(
    campoId: string,
    trx: Transaction<DB>,
  ): Promise<{ nombre: string; tipo: TipoEgreso } | undefined> {
    const fila = await trx
      .selectFrom('campo_egreso')
      .select(['nombre', 'tipo'])
      .where('id', '=', campoId)
      .executeTakeFirst();
    // El check `ck_campo_egreso_tipo` garantiza uno de los tres.
    return fila ? { nombre: fila.nombre, tipo: fila.tipo as TipoEgreso } : undefined;
  }

  /** El nombre del vendedor para `gasto.quien`; `null` si ya no existe. */
  async nombreVendedor(
    vendedorId: string,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .selectFrom('vendedor')
      .select('nombre')
      .where('id', '=', vendedorId)
      .executeTakeFirst();
    return fila?.nombre ?? null;
  }

  /**
   * Inserta el gasto, o devuelve `null` si su id ya estaba ocupado.
   *
   * `on conflict (id) do nothing` y no atrapar el `23505`: un unique_violation
   * aborta la transaccion entera de Postgres (T-16, D10).
   */
  async insertar(
    nuevo: NuevoGasto,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .insertInto('gasto')
      .values({
        id: nuevo.id,
        sucursal_id: nuevo.sucursalId,
        vendedor_id: nuevo.vendedorId,
        campo_egreso_id: nuevo.campoEgresoId,
        campo_nombre: nuevo.campoNombre,
        tipo: nuevo.tipo,
        // El 'AAAA-MM-DD' del sobre tal cual, sin pasar por Date/UTC.
        fecha: nuevo.fecha,
        registrado_en: nuevo.registradoEn,
        // Centavos enteros a texto exacto: nunca un flotante a `numeric`.
        monto: aPesos(nuevo.montoCentavos),
        metodo: nuevo.metodo,
        origen: nuevo.origen,
        quien: nuevo.quien,
        comentario: nuevo.comentario,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .returning('id')
      .executeTakeFirst();
    return fila?.id ?? null;
  }
}
```

`apps/backend/src/modules/compras-egresos/gastos.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { GastoNormalizado } from './datos-gasto';
import { GastoRechazado } from './gasto-rechazado';
import { GastosRepository } from './gastos.repository';
import { METODO_GASTO_RUTA } from './tipos-egreso';

/**
 * Quien, cual y cuando. Todo sale del token o del sobre, nunca de `datos`:
 * `id` es la clave de la operacion (uuid validado en `prepararGasto`),
 * `sucursalId`/`vendedorId` los del token y `fechaOperacion` la del sobre, sin
 * re-derivarla de UTC.
 */
export interface ContextoGasto {
  id: string;
  sucursalId: string;
  vendedorId: string;
  fechaOperacion: string;
}

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadGasto {
  tabla: 'gasto';
  id: string;
}

/**
 * Los gastos en el servidor (T-30/T-31). Proyecta el `tipo: 'gasto'` que sube
 * la tablet; vive en `compras-egresos/` (ADR-0009). El siguiente ticket le suma
 * las compras de oficina del portal sobre la misma tabla.
 *
 * **No revisa `se_usa_en_app`** (D5): la oficina puede cambiar la casilla
 * mientras la tablet esta sin red, y rechazar un gasto ya pagado por eso seria
 * perder el dinero de vista.
 */
@Injectable()
export class GastosService {
  constructor(private readonly repo: GastosRepository) {}

  /**
   * @throws {GastoRechazado} `campo-egreso-inexistente` o `gasto-id-ocupado`.
   * No escribe nada antes de lanzar.
   */
  async registrarGasto(
    gasto: GastoNormalizado,
    contexto: ContextoGasto,
    trx: Transaction<DB>,
  ): Promise<EntidadGasto> {
    const campo = await this.repo.campoParaGasto(gasto.campoEgresoId, trx);
    if (!campo) {
      throw new GastoRechazado({
        razon: 'campo-egreso-inexistente',
        motivo: `El campo de egreso ${gasto.campoEgresoId} no existe en el catálogo.`,
      });
    }
    const quien = await this.repo.nombreVendedor(contexto.vendedorId, trx);

    const id = await this.repo.insertar(
      {
        id: contexto.id,
        sucursalId: contexto.sucursalId,
        vendedorId: contexto.vendedorId,
        campoEgresoId: gasto.campoEgresoId,
        // Copia (D4): editar el campo despues no cambia lo ya registrado.
        campoNombre: campo.nombre,
        tipo: campo.tipo,
        fecha: contexto.fechaOperacion,
        registradoEn: gasto.registradoEn,
        montoCentavos: gasto.montoCentavos,
        metodo: METODO_GASTO_RUTA,
        origen: 'app',
        quien,
        comentario: gasto.comentario,
      },
      trx,
    );
    if (id === null) {
      // Neutro a proposito, como `visita-id-ocupado` (T-39).
      throw new GastoRechazado({
        razon: 'gasto-id-ocupado',
        motivo: 'El id de este gasto ya está ocupado. Avisa a la oficina.',
      });
    }
    return { tabla: 'gasto', id };
  }
}
```

`apps/backend/src/modules/compras-egresos/compras-egresos.module.ts` (reemplaza el archivo entero):

```ts
import { Module } from '@nestjs/common';
import { CamposEgresoController } from './campos-egreso.controller';
import { CamposEgresoRepository } from './campos-egreso.repository';
import { CamposEgresoService } from './campos-egreso.service';
import { GastosRepository } from './gastos.repository';
import { GastosService } from './gastos.service';

// T-30/T-31: el catalogo de campos de egreso y los gastos viven aqui (slug del
// vault `compras-egresos`, ADR-0009). `GastosService` se exporta para que
// sincronizacion/ proyecte el `tipo: 'gasto'` y anote su foto; la dependencia
// va de sincronizacion hacia aqui, nunca al reves.
@Module({
  controllers: [CamposEgresoController],
  providers: [
    CamposEgresoService,
    CamposEgresoRepository,
    GastosService,
    GastosRepository,
  ],
  exports: [GastosService],
})
export class ComprasEgresosModule {}
```

- [ ] **Paso 5: el despachador**

`apps/backend/src/modules/sincronizacion/despacho-gasto.ts`:

```ts
import {
  normalizarDatosGasto,
  type GastoNormalizado,
} from '../compras-egresos/datos-gasto';
import type { RazonRechazoGasto } from '../compras-egresos/gasto-rechazado';
import { RE_UUID } from '../rutas/datos-visita';
import type { CodigoRechazo } from './contrato';
import type { OperacionNormalizada, Rechazo } from './operaciones';

/**
 * La parte del despachador que es del gasto de la ruta (T-30/T-31), en su
 * propio archivo para que `despacho.ts` se quede en un `case` corto por tipo
 * (acuerdo de T-40). Puro, sin base.
 */

export type PreparacionGasto =
  | { ok: true; gasto: GastoNormalizado }
  | ({ ok: false } & Rechazo);

export function prepararGasto(op: OperacionNormalizada): PreparacionGasto {
  // Un gasto no es una nota que nadie firme: con folio ocuparia un numero de
  // la serie de ventas en `sync_operacion.folio` (mismo criterio que T-40/T-39).
  if (op.folio !== null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo: 'folio: un gasto no lleva folio; no es una nota que nadie firme.',
    };
  }

  // D5: un gasto no es de un cliente. Si la tablet manda uno es un bug.
  if (op.clienteId !== null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo: 'cliente_id: un gasto no es de un cliente; el sobre no lo lleva.',
    };
  }

  // La clave ES el id del gasto (D4, como la visita en T-39): la foto del
  // ticket se liga a ella. `gasto.id` es uuid, asi que la clave tiene que serlo.
  if (!RE_UUID.test(op.clave)) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'clave: la clave de un gasto debe ser un uuid; es el id con el que la tablet ya lo registró.',
    };
  }

  const r = normalizarDatosGasto(op.datos);
  if (!r.ok) return { ok: false, codigo: 'datos-invalidos', motivo: r.motivo };
  return { ok: true, gasto: r.gasto };
}

/** Razon del dominio a codigo del contrato. Un `Record`: una razon nueva no compila sin codigo. */
export const CODIGO_POR_RAZON_GASTO: Record<RazonRechazoGasto, CodigoRechazo> =
  {
    'campo-egreso-inexistente': 'campo-egreso-inexistente',
    'gasto-id-ocupado': 'gasto-id-ocupado',
  };
```

`apps/backend/src/modules/sincronizacion/despacho.ts`:

1. Imports: agrega `import type { GastoNormalizado } from '../compras-egresos/datos-gasto';` junto a los demás `import
   type` de dominio y `import { prepararGasto } from './despacho-gasto';` junto a los `prepararX`.
2. El comentario de `Proyeccion` pasa a:

```ts
 * Un `tipo` sin modulo todavia (`merma`, `ruta`) no tiene proyeccion:
 * se guarda en el buzon y queda `aplicada`, como desde T-07.
 * Orden acordado entre tickets: `venta`, `prospecto` (T-40), `cobranza` (T-20),
 * `jornada` (T-38), `ruta-alta` (T-37), `visita` (T-39), `gasto` (T-30/T-31).
```

3. Al final de la unión `Proyeccion`, después de la línea de `visita`:

```ts
  | { tipo: 'visita'; visita: VisitaNormalizada; clienteId: string }
  // T-30/T-31. La fila es de `gasto` con id = clave; sin cliente.
  | { tipo: 'gasto'; gasto: GastoNormalizado };
```

   (quita el `;` que cerraba la línea de `visita`).
4. En `prepararProyeccion`, sustituye

```ts
    case 'gasto':
    case 'merma':
    case 'ruta':
      return { ok: true, proyeccion: null };
```

por

```ts
    case 'gasto': {
      // T-30/T-31. La forma la revisa `despacho-gasto.ts`; el campo y el id
      // ocupado, `GastosService` dentro de la transaccion.
      const r = prepararGasto(op);
      if (!r.ok) return r;
      return { ok: true, proyeccion: { tipo: 'gasto', gasto: r.gasto } };
    }
    case 'merma':
    case 'ruta':
      return { ok: true, proyeccion: null };
```

`apps/backend/src/modules/sincronizacion/despacho.spec.ts`, sustituye el `it.each` de la línea 39:

```ts
  it.each(['gasto', 'merma', 'ruta'] as const)(
    '%s no tiene modulo que la proyecte todavia: va al buzon sin mirar datos',
```

por

```ts
  it.each(['merma', 'ruta'] as const)(
    '%s no tiene modulo que la proyecte todavia: va al buzon sin mirar datos',
```

y agrega después de ese bloque:

```ts
  it('un gasto pasa por prepararGasto y sale como proyeccion de gasto (T-30/T-31)', () => {
    const CAMPO = '5d1c9a7e-3b2f-4c8d-9e0a-1b2c3d4e5f30';
    const r = prepararProyeccion(
      op({
        tipo: 'gasto',
        clave: 'c0ffee00-0000-4000-8000-000000000030',
        folio: null,
        clienteId: null,
        datos: {
          campo_egreso_id: CAMPO,
          monto_centavos: 8000,
          registrado_en: '2026-10-20T18:40:00.000Z',
        },
      }),
    );
    expect(r).toEqual({
      ok: true,
      proyeccion: {
        tipo: 'gasto',
        gasto: {
          campoEgresoId: CAMPO,
          montoCentavos: 8000,
          registradoEn: '2026-10-20T18:40:00.000Z',
          comentario: null,
        },
      },
    });
  });

  it('un gasto con datos libres ya no entra al buzon: es datos-invalidos', () => {
    expect(
      prepararProyeccion(
        op({
          tipo: 'gasto',
          clave: 'c0ffee00-0000-4000-8000-000000000031',
          folio: null,
          clienteId: null,
          datos: { concepto: 'hielo', monto_centavos: 5000 },
        }),
      ),
    ).toMatchObject({ ok: false, codigo: 'datos-invalidos' });
  });
```

- [ ] **Paso 6: proyectar desde `SincronizacionService` y cablear el módulo**

`apps/backend/src/modules/sincronizacion/sincronizacion.module.ts`:

```ts
import { ComprasEgresosModule } from '../compras-egresos/compras-egresos.module';
```

y la lista de imports pasa a

```ts
  // T-30/T-31 suma Compras y Egresos: la duena de `gasto`.
  imports: [
    VentasCobranzaModule,
    CarteraClientesModule,
    RutasModule,
    ComprasEgresosModule,
  ],
```

`apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`:

1. Imports, junto a los de Rutas:

```ts
import { GastoRechazado } from '../compras-egresos/gasto-rechazado';
import { GastosService } from '../compras-egresos/gastos.service';
```

   y junto a `CODIGO_POR_RAZON_VISITA`:

```ts
import { CODIGO_POR_RAZON_GASTO } from './despacho-gasto';
```

2. En el constructor, después de `private readonly visitas: VisitasService,`:

```ts
    // T-30/T-31: Compras y Egresos es la duena del gasto de la ruta.
    private readonly gastos: GastosService,
```

3. En el `catch` de `aplicar`, después del bloque de `VisitaRechazada`:

```ts
      // T-30/T-31: el rollback ya dejo sin fila tanto el buzon como el gasto.
      if (error instanceof GastoRechazado) {
        return {
          clave: op.clave,
          tipo: op.tipo,
          estado: 'rechazada',
          codigo: CODIGO_POR_RAZON_GASTO[error.razon],
          motivo: error.message,
        };
      }
```

4. En `proyectar`, después del `case 'visita'`:

```ts
      case 'gasto':
        // La entidad del buzon es la fila de `gasto` (ADR-0009 §2.4, enmendado).
        return this.gastos.registrarGasto(
          proyeccion.gasto,
          {
            // T-30/T-31 (D4): la clave ES el id del gasto (uuid validado en prepararGasto).
            id: op.clave,
            // Del token, nunca del cuerpo.
            sucursalId: vendedor.sucursal_id,
            vendedorId: vendedor.id,
            // Tal cual lo mando la tablet: el servidor no re-deriva el dia de UTC.
            fechaOperacion: op.fechaOperacion,
          },
          trx,
        );
```

- [ ] **Paso 7: las unitarias pasan**

`npm test --workspace=apps/backend -- datos-gasto despacho-gasto gastos.service despacho.spec` → PASS.

- [ ] **Paso 8: el sobre genérico del e2e del buzón se muda a `merma`**

`gasto` ya tiene forma fija y se proyecta: el sobre genérico de `apps/backend/test/sincronizacion.e2e-spec.ts` (manda
varios en un lote, con datos libres) caería todo en `datos-invalidos`. Sustituye su comentario y su cuerpo
(líneas ~111-138):

```ts
  /**
   * Una operacion valida SIN modulo de dominio, con clave unica por defecto: el
   * sobre generico de las pruebas del buzon (idempotencia, push parcial,
   * alcance). Es una `merma` porque sigue sin proyeccion y sin forma fija de
   * `datos` hasta T-33.
   *
   * Hasta T-38 era una `jornada` y hasta T-30/T-31 un `gasto`. Ya no pueden
   * serlo: los dos se proyectan a su tabla y validan su forma. Cuando T-33
   * proyecte la merma, este sobre tendra que mudarse otra vez (a `ruta`, que
   * sigue reservado). Las pruebas del gasto viven en `gasto.e2e-spec.ts`.
   *
   * Generico a proposito: lo que trae `extra` (un `folio`, un `cliente_id`)
   * forma parte del tipo de retorno. Con `Record<string, unknown>` el objeto
   * real si llevaba el folio pero el tipo no, y cada `op.folio` era un error
   * de tipos que Jest no ve porque `isolatedModules` transpila sin comprobar.
   */
  const operacion = <E extends Record<string, unknown>>(
    extra: E = {} as E,
  ) => ({
    clave: `op-${SUFIJO}-${Math.random().toString(36).slice(2)}`,
    tipo: 'merma',
    fecha_operacion: new Date().toISOString().slice(0, 10),
    ocurrido_en: new Date().toISOString(),
    datos: { piezas: 3 },
    ...extra,
  });
```

En la prueba `'sube la operacion del dia y devuelve un id por operacion'` (~:1424), quita el elemento

```ts
        operacion({
          tipo: 'gasto',
          datos: { concepto: 'hielo', monto_centavos: 5000 },
        }),
```

y cambia los conteos: `recibidas: 5, aplicadas: 5`, y `expect(cuerpo.resultados).toHaveLength(5);`. El gasto de
punta a punta se prueba en `gasto.e2e-spec.ts`.

Antes de seguir, busca otros usos que dependieran del tipo: `grep -n "'gasto'" apps/backend/test/sincronizacion.e2e-spec.ts`
no debe devolver nada.

- [ ] **Paso 9: el e2e del gasto en el push**

`apps/backend/test/gasto.e2e-spec.ts`:

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
  type RespuestaPush,
} from './../src/modules/sincronizacion/contrato';

/**
 * T-30/T-31: el gasto de la ruta en el push, de punta a punta. Fija D4/D5 del
 * lado servidor: la clave es el id del gasto, la fecha es la del sobre (nunca
 * re-derivada de UTC), un campo dado de baja o sin "se usa en la app" se
 * acepta, uno inexistente no, un id ocupado se rechaza con motivo neutro y el
 * reenvio es `duplicada`. Fechas de 2018 para no cruzarse con otras suites.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN = `e2e-gasto-${SUFIJO}`;
const PASSWORD = 'contrasena-del-vendedor';
const PREFIJO = `ZZ-gasto-${SUFIJO}`;
const FECHA = '2018-04-10';

interface FilaGasto {
  id: string;
  sucursal_id: string;
  vendedor_id: string | null;
  capturo_usuario_id: string | null;
  campo_egreso_id: string;
  campo_nombre: string;
  tipo: string;
  fecha_texto: string;
  registrado_en: Date;
  monto: string;
  metodo: string;
  quien: string | null;
  factura: string;
  comentario: string | null;
  origen: string;
  foto_archivo: string | null;
}

describe('Gasto de la ruta en el push (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;

  let sucursalId: string;
  let vendedorId: string;
  let clienteId: string;
  let campoId: string;
  let campoBorradoId: string;
  let campoOficinaId: string;
  let bearer: string;
  const idsSembrados: string[] = [];

  const push = async (operaciones: unknown[]) => {
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ contrato: CONTRATO_ACTUAL, operaciones })
      .expect(200);
    return res.body as RespuestaPush;
  };

  const gasto = (
    datos: Record<string, unknown> = {},
    sobre: Record<string, unknown> = {},
  ) => ({
    clave: randomUUID(),
    tipo: 'gasto',
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T18:40:00.000Z`,
    datos: {
      campo_egreso_id: campoId,
      monto_centavos: 25050,
      registrado_en: `${FECHA}T18:40:00.000Z`,
      comentario: null,
      ...datos,
    },
    ...sobre,
  });

  const filaGasto = (id: string): Promise<FilaGasto | undefined> =>
    db
      .selectFrom('gasto')
      .select([
        'id',
        'sucursal_id',
        'vendedor_id',
        'capturo_usuario_id',
        'campo_egreso_id',
        'campo_nombre',
        'tipo',
        'registrado_en',
        'monto',
        'metodo',
        'quien',
        'factura',
        'comentario',
        'origen',
        'foto_archivo',
      ])
      .select(sql<string>`fecha::text`.as('fecha_texto'))
      .where('id', '=', id)
      .executeTakeFirst() as Promise<FilaGasto | undefined>;

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
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;

    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Vendedor de gastos',
          password_hash: await new PasswordService().hashear(PASSWORD),
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // Un cliente de la sucursal: pasa el alcance del lote y deja ver que el
    // gasto lo rechaza por llevarlo, no por estar fuera de alcance.
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    clienteId = (
      await db
        .insertInto('cliente')
        .values({
          nombre: `${PREFIJO} Abarrotes`,
          domicilio: 'Calle 1',
          telefono: '6640000000',
          tipo: 'cliente',
          lista_precio_id: lista.id,
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    campoId = (
      await db
        .insertInto('campo_egreso')
        .values({ nombre: `${PREFIJO} Hielo`, tipo: 'operacion', se_usa_en_app: true })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    campoBorradoId = (
      await db
        .insertInto('campo_egreso')
        .values({
          nombre: `${PREFIJO} Casetas`,
          tipo: 'operacion',
          se_usa_en_app: true,
          deleted_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    // Sin la casilla: el servidor igual no la revisa (D5).
    campoOficinaId = (
      await db
        .insertInto('campo_egreso')
        .values({ nombre: `${PREFIJO} Celular`, tipo: 'financiero', se_usa_en_app: false })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const login = await request(app.getHttpServer())
      .post('/auth/app/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);
    bearer = (login.body as { tokenAcceso: string }).tokenAcceso;
  });

  afterAll(async () => {
    // Orden inverso a las llaves foraneas.
    await db.deleteFrom('gasto').where('vendedor_id', '=', vendedorId).execute();
    if (idsSembrados.length > 0) {
      await db.deleteFrom('gasto').where('id', 'in', idsSembrados).execute();
    }
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('cliente').where('id', '=', clienteId).execute();
    await db
      .deleteFrom('campo_egreso')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
    await app.close();
  });

  it('entra con la clave como id, la fecha del sobre, la copia del campo y el metodo fijo', async () => {
    // A las 18:30 de Tijuana del 10 de abril en UTC ya es el 11: cuenta el 10.
    const op = gasto({
      registrado_en: '2018-04-11T01:30:00.000Z',
      comentario: '  Dos bolsas  ',
    });
    const r = (await push([op])).resultados[0];
    expect(r.estado).toBe('aplicada');

    const fila = await filaGasto(op.clave);
    expect(fila).toMatchObject({
      id: op.clave,
      sucursal_id: sucursalId,
      vendedor_id: vendedorId,
      capturo_usuario_id: null,
      campo_egreso_id: campoId,
      campo_nombre: `${PREFIJO} Hielo`,
      tipo: 'operacion',
      fecha_texto: '2018-04-10',
      monto: '250.50',
      metodo: 'efectivo_cobranza_dia',
      quien: 'Vendedor de gastos',
      factura: 'N/A',
      comentario: 'Dos bolsas',
      origen: 'app',
      foto_archivo: null,
    });
    expect(new Date(fila!.registrado_en).toISOString()).toBe(
      '2018-04-11T01:30:00.000Z',
    );
    expect(await buzon(op.clave)).toEqual({
      entidad_tabla: 'gasto',
      entidad_id: op.clave,
    });
  });

  it('un comentario vacio se guarda como null', async () => {
    const op = gasto({ comentario: '   ' });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
    expect((await filaGasto(op.clave))?.comentario).toBeNull();
  });

  it('un campo dado de baja se acepta: el vendedor lo eligio sin red', async () => {
    const op = gasto({ campo_egreso_id: campoBorradoId });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
    expect((await filaGasto(op.clave))?.campo_nombre).toBe(`${PREFIJO} Casetas`);
  });

  it('un campo sin "se usa en la app" se acepta: el servidor no revisa la casilla', async () => {
    const op = gasto({ campo_egreso_id: campoOficinaId });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
    expect((await filaGasto(op.clave))?.tipo).toBe('financiero');
  });

  it('el reenvio es duplicada: una sola fila y el mismo id del buzon', async () => {
    const op = gasto();
    const primero = (await push([op])).resultados[0];
    const segundo = (await push([op])).resultados[0];
    expect(primero.estado).toBe('aplicada');
    expect(segundo.estado).toBe('duplicada');
    expect(segundo.id_servidor).toBe(primero.id_servidor);
    const { n } = await db
      .selectFrom('gasto')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('id', '=', op.clave)
      .executeTakeFirstOrThrow();
    expect(Number(n)).toBe(1);
  });

  it('un campo que no existe es campo-egreso-inexistente y no deja fila ni buzon', async () => {
    const op = gasto({ campo_egreso_id: randomUUID() });
    const r = (await push([op])).resultados[0];
    expect(r).toMatchObject({
      estado: 'rechazada',
      codigo: 'campo-egreso-inexistente',
    });
    expect(await filaGasto(op.clave)).toBeUndefined();
    expect(await buzon(op.clave)).toBeUndefined();
  });

  it('un id ya ocupado es gasto-id-ocupado con un motivo neutro y no deja buzon', async () => {
    // Otro registro ya tiene ese id (aqui, una compra de oficina sembrada).
    const ocupado = randomUUID();
    idsSembrados.push(ocupado);
    await db
      .insertInto('gasto')
      .values({
        id: ocupado,
        sucursal_id: sucursalId,
        campo_egreso_id: campoId,
        campo_nombre: 'sembrado',
        tipo: 'operacion',
        fecha: FECHA,
        registrado_en: new Date(),
        monto: '1.00',
        metodo: 'efectivo_cobranza_dia',
        origen: 'portal',
      })
      .execute();

    const r = (await push([gasto({}, { clave: ocupado })])).resultados[0];
    expect(r).toMatchObject({
      estado: 'rechazada',
      codigo: 'gasto-id-ocupado',
      motivo: 'El id de este gasto ya está ocupado. Avisa a la oficina.',
    });
    expect(await buzon(ocupado)).toBeUndefined();
  });

  it.each([
    ['monto 0', { monto_centavos: 0 }, {}],
    ['monto con fraccion de centavo', { monto_centavos: 1234.5 }, {}],
    ['monto mayor al maximo', { monto_centavos: 1_000_000_000_000 }, {}],
    ['comentario de 201', { comentario: 'x'.repeat(201) }, {}],
    ['registrado_en sin zona', { registrado_en: '2018-04-10T11:40:00' }, {}],
    ['clave que no es uuid', {}, { clave: `gasto-${SUFIJO}` }],
  ])('%s es datos-invalidos y no deja fila', async (_caso, datos, sobre) => {
    const op = gasto(datos, sobre);
    const r = (await push([op])).resultados[0];
    expect(r).toMatchObject({ estado: 'rechazada', codigo: 'datos-invalidos' });
    expect(await buzon(op.clave)).toBeUndefined();
  });

  it('con cliente_id en el sobre es datos-invalidos (un gasto no es de un cliente)', async () => {
    const op = gasto({}, { cliente_id: clienteId });
    const r = (await push([op])).resultados[0];
    expect(r).toMatchObject({ estado: 'rechazada', codigo: 'datos-invalidos' });
    expect(r.motivo).toMatch(/^cliente_id: /);
    expect(await filaGasto(op.clave)).toBeUndefined();
  });
});
```

> El folio en el sobre de un gasto lo cubre `despacho-gasto.spec.ts`: en el e2e un folio de prueba caería antes en
> `folio-invalido` (el vendedor sembrado no tiene segmento), que no es lo que se quiere probar.

- [ ] **Paso 10: correr los e2e**

```bash
npm run test:e2e --workspace=apps/backend -- gasto.e2e-spec
npm run test:e2e --workspace=apps/backend -- sincronizacion.e2e-spec
npm run test:e2e --workspace=apps/backend -- visita.e2e-spec
```

Expected: PASS los tres (`gasto` 14; los otros sin regresiones).

- [ ] **Paso 11: lint por archivo, typecheck de los dos lados y commit**

```bash
npm exec --workspace=apps/backend -- prettier --write src/modules/compras-egresos/datos-gasto.ts src/modules/compras-egresos/datos-gasto.spec.ts src/modules/compras-egresos/gasto-rechazado.ts src/modules/compras-egresos/gastos.repository.ts src/modules/compras-egresos/gastos.service.ts src/modules/compras-egresos/gastos.service.spec.ts src/modules/compras-egresos/compras-egresos.module.ts src/modules/sincronizacion/despacho-gasto.ts src/modules/sincronizacion/despacho-gasto.spec.ts src/modules/sincronizacion/despacho.ts src/modules/sincronizacion/despacho.spec.ts src/modules/sincronizacion/sincronizacion.service.ts src/modules/sincronizacion/sincronizacion.module.ts src/modules/sincronizacion/contrato.ts test/sincronizacion.e2e-spec.ts test/gasto.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/compras-egresos/datos-gasto.ts src/modules/compras-egresos/datos-gasto.spec.ts src/modules/compras-egresos/gasto-rechazado.ts src/modules/compras-egresos/gastos.repository.ts src/modules/compras-egresos/gastos.service.ts src/modules/compras-egresos/gastos.service.spec.ts src/modules/compras-egresos/compras-egresos.module.ts src/modules/sincronizacion/despacho-gasto.ts src/modules/sincronizacion/despacho-gasto.spec.ts src/modules/sincronizacion/despacho.ts src/modules/sincronizacion/despacho.spec.ts src/modules/sincronizacion/sincronizacion.service.ts src/modules/sincronizacion/sincronizacion.module.ts src/modules/sincronizacion/contrato.ts test/sincronizacion.e2e-spec.ts test/gasto.e2e-spec.ts
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
git add apps/backend/src/modules/compras-egresos apps/backend/src/modules/sincronizacion apps/backend/test/sincronizacion.e2e-spec.ts apps/backend/test/gasto.e2e-spec.ts apps/tablet/src/sincronizacion/contrato.ts docs/contrato-sincronizacion.md
git commit -m "T-30/T-31: operación gasto en el push (forma, proyección a gasto y rechazos)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 4: El pull baja `campos_egreso` y el canal de fotos acepta gastos (D6, D8)

**Files:**
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts` (interfaz `CampoEgresoPull` y `catalogos.campos_egreso`)
- Modify: `apps/tablet/src/sincronizacion/contrato.ts` (la copia: `CampoEgresoPull` y `campos_egreso?`)
- Modify: `docs/contrato-sincronizacion.md` (§5 ejemplo y sección nueva; §6 "Fotos")
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts` (método `camposEgreso`)
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts` (`pull`)
- Modify: `apps/backend/src/modules/cartera-clientes/foto-prospecto.ts` (`EntidadFoto` gana `'gasto'`)
- Modify: `apps/backend/src/modules/compras-egresos/gastos.repository.ts` (`existe`, `anotarFoto`)
- Modify: `apps/backend/src/modules/compras-egresos/gastos.service.ts` (`existe`, `anotarFoto`)
- Modify: `apps/backend/src/modules/sincronizacion/foto.service.ts` (tipo `gasto`)
- Modify: `apps/backend/src/modules/sincronizacion/foto.controller.ts` (solo comentarios)
- Test: `apps/backend/src/modules/sincronizacion/foto.service.spec.ts`
- Test: `apps/backend/test/gasto-foto-pull.e2e-spec.ts` (nuevo)

**Interfaces:**
- Consumes (Tareas 1 y 3): tablas `campo_egreso` (`id, nombre, tipo, se_usa_en_app, deleted_at, actualizado_en`) y
  `gasto` (`foto_archivo`, `foto_subida_en`, `ck_gasto_foto_completa`); `GastosService` y `GastosRepository` de
  `modules/compras-egresos/`; la operación `gasto` ya proyecta a `gasto` con `id = clave` y deja en el buzón
  `entidad_tabla = 'gasto'`, `entidad_id = clave`; `SincronizacionModule` ya importa `ComprasEgresosModule`
  (Tarea 3) y `ComprasEgresosModule` exporta `GastosService`.
- Produces:
  - `export interface CampoEgresoPull extends FilaSincronizable { nombre: string; tipo: 'produccion' | 'operacion' | 'financiero'; se_usa_en_app: boolean }`
    en los dos `contrato.ts`; `RespuestaPull.catalogos.campos_egreso: CampoEgresoPull[]` (backend) y
    `campos_egreso?: CampoEgresoPull[]` (tablet, opcional como `motivos_visita`).
  - `SincronizacionRepository.camposEgreso(desde: Date | null): Promise<CampoEgresoPull[]>`.
  - `EntidadFoto = 'cliente' | 'visita' | 'gasto'`.
  - `GastosRepository.existe(id: string): Promise<boolean>`;
    `GastosRepository.anotarFoto(id: string, archivo: string, subidaEn: Date): Promise<boolean>`.
  - `GastosService.existe(id: string): Promise<boolean>`;
    `GastosService.anotarFoto(id: string, archivo: string, subidaEn: Date): Promise<boolean>`.
  - `FotoService` recibe un cuarto parámetro `gastos: GastosService`; `POST /sync/foto/:clave` acepta operaciones
    `gasto` y escribe `gasto-<id>.jpg`.

- [ ] **Paso 1: la prueba unitaria de la foto del gasto, que falla**

En `apps/backend/src/modules/sincronizacion/foto.service.spec.ts`, reemplaza `montar` por esta versión (gana
`gastos` y lo pasa como cuarto parámetro):

```ts
function montar(operaciones: OperacionParaFoto[] = [operacion()]) {
  const repo = {
    porClave: jest.fn().mockResolvedValue(operaciones),
    sucursalDeVendedor: jest.fn().mockResolvedValue('sucursal-tj'),
  };
  const fotos = {
    guardar: jest
      .fn()
      .mockResolvedValue({ archivo: `cliente-${CLAVE}.jpg`, subidaEn: SUBIDA }),
    validarFoto: jest.fn(),
    escribirArchivo: jest.fn().mockResolvedValue(undefined),
    rutaParaVendedor: jest.fn().mockResolvedValue('/fotos/cliente-x.jpg'),
  };
  const visitas = {
    existe: jest.fn().mockResolvedValue(true),
    anotarFoto: jest.fn().mockResolvedValue(true),
  };
  const gastos = {
    existe: jest.fn().mockResolvedValue(true),
    anotarFoto: jest.fn().mockResolvedValue(true),
  };
  const servicio = new FotoService(
    repo as never,
    fotos as never,
    visitas as never,
    gastos as never,
  );
  return { servicio, repo, fotos, visitas, gastos };
}
```

Y agrega, antes de `describe('FotoService.rutaDeCliente (T-39, D9)', …)`:

```ts
describe('FotoService.subir con gastos (T-30/T-31, D8)', () => {
  const deGasto = (extra: Partial<OperacionParaFoto> = {}) =>
    operacion({ tipo: 'gasto', entidadTabla: 'gasto', ...extra });

  it('un gasto valida, escribe gasto-<id>.jpg y anota la fila', async () => {
    const { servicio, fotos, gastos, visitas } = montar([deGasto()]);
    const r = await servicio.subir(VENDEDOR, CLAVE, JPEG);
    expect(fotos.validarFoto).toHaveBeenCalledWith(JPEG);
    expect(fotos.escribirArchivo).toHaveBeenCalledWith(
      `gasto-${CLAVE}.jpg`,
      JPEG,
    );
    expect(gastos.anotarFoto).toHaveBeenCalledWith(
      CLAVE,
      `gasto-${CLAVE}.jpg`,
      expect.any(Date),
    );
    expect(visitas.anotarFoto).not.toHaveBeenCalled();
    expect(r.clave).toBe(CLAVE);
  });

  it('un gasto sin proyectar es 409 y no escribe nada', async () => {
    const { servicio, fotos } = montar([
      deGasto({ entidadTabla: null, entidadId: null }),
    ]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(fotos.escribirArchivo).not.toHaveBeenCalled();
  });

  it('un gasto que ya no existe es 404 y no escribe nada', async () => {
    const { servicio, fotos, gastos } = montar([deGasto()]);
    gastos.existe.mockResolvedValue(false);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fotos.escribirArchivo).not.toHaveBeenCalled();
  });

  it('si la fila desaparece entre escribir y anotar, 404', async () => {
    const { servicio, gastos } = montar([deGasto()]);
    gastos.anotarFoto.mockResolvedValue(false);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('una foto que no pasa la validacion no toca el gasto', async () => {
    const { servicio, fotos, gastos } = montar([deGasto()]);
    fotos.validarFoto.mockImplementation(() => {
      throw new Error('415');
    });
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toThrow('415');
    expect(gastos.existe).not.toHaveBeenCalled();
    expect(gastos.anotarFoto).not.toHaveBeenCalled();
  });
});
```

- [ ] **Paso 2: correr y ver fallar**

`npm test --workspace=apps/backend -- foto.service` → los cinco casos nuevos fallan: un `gasto` cae hoy en el 409
"solo un prospecto o una visita lleva foto" (los dos primeros esperan otra cosa) y `gastos.existe`/`anotarFoto`
nunca se llaman.

- [ ] **Paso 3: el contrato del pull (los dos archivos y el documento, en el mismo commit)**

En `apps/backend/src/modules/sincronizacion/contrato.ts`, después de `MotivoVisitaPull`:

```ts
/**
 * Un campo de egreso (T-30, D6): el catalogo de la pantalla "Gastos" de la
 * tablet. Global (no cuelga de sucursal), como `motivos_visita`. Coleccion
 * nueva = aditiva. Incremental por `actualizado_en`; la baja logica viaja como
 * `activo: 0`.
 *
 * La tablet ofrece solo los que tienen `activo: 1` y `se_usa_en_app: true`. Un
 * gasto ya guardado con un campo que despues se apago o se dio de baja sube
 * igual: el servidor no revisa la casilla (D5).
 */
export interface CampoEgresoPull extends FilaSincronizable {
  nombre: string;
  tipo: 'produccion' | 'operacion' | 'financiero';
  /** "Se usa en la app": la tablet solo ofrece los que la tienen. */
  se_usa_en_app: boolean;
}
```

Y en `RespuestaPull.catalogos`, después de `motivos_visita`:

```ts
    /** T-30. Aditiva: una tablet vieja la ignora. */
    campos_egreso: CampoEgresoPull[];
```

En `apps/tablet/src/sincronizacion/contrato.ts`, después de `MotivoVisitaPull`:

```ts
/** Copia del backend (T-30). */
export interface CampoEgresoPull extends FilaSincronizable {
  nombre: string;
  tipo: 'produccion' | 'operacion' | 'financiero';
  se_usa_en_app: boolean;
}
```

Y en `catalogos`, después de `motivos_visita?: MotivoVisitaPull[];`:

```ts
    /**
     * T-30. **Opcional en la copia de la tablet, obligatoria en el servidor**,
     * por la misma razon que `tipos_negocio`: sin la coleccion la pantalla de
     * gastos dice que no hay catalogo y no deja registrar.
     */
    campos_egreso?: CampoEgresoPull[];
```

En `docs/contrato-sincronizacion.md`:

1. En el JSON de ejemplo del §5, después de la línea de `motivos_visita` (las dos líneas que terminan en
   `"exige_atendio": false, "activo": 1 }],`), agrega:

```
    "campos_egreso":  [{ "id": "…", "nombre": "Gasolina", "tipo": "operacion",
                         "se_usa_en_app": true, "activo": 1 }],
```

2. Después de la sección `### \`motivos_visita\`: el catálogo de la visita sin venta (T-39)`, agrega:

```markdown
### `campos_egreso`: el catálogo de los gastos de la ruta (T-30)

Colección **nueva** y aditiva (§3). Baja completa (no por sucursal: es un catálogo de la empresa, como
`motivos_visita`) e incremental por **`actualizado_en`** (un trigger la mueve en cualquier cambio, la baja lógica
incluida). La baja viaja como `activo: 0`. `tipo` es `produccion`, `operacion` o `financiero` (fijos, D1).

La tablet ofrece en "Registrar gasto" solo los campos con `activo: 1` **y** `se_usa_en_app: true`. Si la oficina
apaga la casilla o da de baja el campo mientras la tablet está sin red, el gasto ya capturado sube igual: el
servidor **no** revisa la casilla (§6, `gasto`), y el siguiente pull quita el campo de la lista.
```

3. En `### Fotos: subida y descarga (canal aparte del lote; T-40, T-39)`, cambia el título a
   `### Fotos: subida y descarga (canal aparte del lote; T-40, T-39, T-30)` y:
   - en la viñeta de `POST /sync/foto/:clave`, cambia "`prospecto` **o** `visita`" por "`prospecto`, `visita`
     **o** `gasto`";
   - en la viñeta "Nombre del archivo (T-78)", cambia "`cliente-<cliente.id>.jpg` y `visita-<visita.id>.jpg`" por
     "`cliente-<cliente.id>.jpg`, `visita-<visita.id>.jpg` y `gasto-<gasto.id>.jpg` (T-30)";
   - en la viñeta de dónde se anota, agrega al final: "; la del gasto (el ticket, opcional), en
     `gasto.foto_archivo/foto_subida_en`";
   - en la última viñeta, cambia "Las fotos de visitas **no** bajan." por "Las fotos de visitas y de gastos **no**
     bajan a la tablet; la del gasto la ve el portal en `GET /gastos/:id/foto`."

- [ ] **Paso 4: el repositorio y el servicio del pull**

En `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts`, agrega `CampoEgresoPull` a la lista de
tipos importados de `./contrato` (después de `MotivoVisitaPull,`) y, después del método `motivosVisita`:

```ts
  /** T-30 (D6): el catalogo de la pantalla de gastos. Global, como los motivos. */
  async camposEgreso(desde: Date | null): Promise<CampoEgresoPull[]> {
    let q = this.db
      .selectFrom('campo_egreso')
      .select(['id', 'nombre', 'tipo', 'se_usa_en_app', 'deleted_at']);
    if (desde) q = q.where('actualizado_en', '>', desde);

    return (await q.orderBy('nombre').execute()).map((f) => ({
      id: f.id,
      nombre: f.nombre,
      // El check `ck_campo_egreso_tipo` garantiza uno de los tres.
      tipo: f.tipo as CampoEgresoPull['tipo'],
      se_usa_en_app: f.se_usa_en_app,
      activo: bandera(true, f.deleted_at),
    }));
  }
```

En `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`, dentro de `pull`:

- en la desestructuración, después de `motivosVisita,` agrega `camposEgreso,`;
- en el `Promise.all`, después de `this.repo.motivosVisita(desde),` agrega:

```ts
      // T-30: el catalogo de la pantalla de gastos. No lleva sucursal.
      this.repo.camposEgreso(desde),
```

- en `catalogos`, después de `motivos_visita: motivosVisita,` agrega `campos_egreso: camposEgreso,`.

- [ ] **Paso 5: la foto del gasto en el dominio**

En `apps/backend/src/modules/cartera-clientes/foto-prospecto.ts`:

```ts
export type EntidadFoto = 'cliente' | 'visita' | 'gasto';
```

(Si el comentario de `nombreArchivoFoto` enumera los nombres posibles, agrega `gasto-<id>.jpg`.)

En `apps/backend/src/modules/compras-egresos/gastos.repository.ts`, agrega dentro de la clase `GastosRepository`
(usa `this.db`, que la clase ya recibe por `@Inject(DB_CONNECTION)`):

```ts
  /** ¿Sigue existiendo ese gasto (vivo)? Antes de escribir su foto en disco. */
  async existe(id: string): Promise<boolean> {
    const fila = await this.db
      .selectFrom('gasto')
      .select('id')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * Anota la foto del ticket (nombre y fecha juntos, `ck_gasto_foto_completa`).
   * `false` si la fila ya no estaba o se dio de baja.
   */
  async anotarFoto(
    id: string,
    archivo: string,
    subidaEn: Date,
  ): Promise<boolean> {
    const fila = await this.db
      .updateTable('gasto')
      .set({ foto_archivo: archivo, foto_subida_en: subidaEn })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    return fila !== undefined;
  }
```

En `apps/backend/src/modules/compras-egresos/gastos.service.ts`, agrega dentro de la clase `GastosService`:

```ts
  /** T-30 (D8): para el canal de fotos. */
  existe(id: string): Promise<boolean> {
    return this.repo.existe(id);
  }

  /** T-30 (D8): el archivo ya esta en disco; esto anota la columna. */
  anotarFoto(id: string, archivo: string, subidaEn: Date): Promise<boolean> {
    return this.repo.anotarFoto(id, archivo, subidaEn);
  }
```

- [ ] **Paso 6: el canal de fotos acepta el gasto**

En `apps/backend/src/modules/sincronizacion/foto.service.ts`:

1. Import nuevo, después del de `VisitasService`:

```ts
import { GastosService } from '../compras-egresos/gastos.service';
```

2. El constructor gana el cuarto parámetro:

```ts
    // T-39: Rutas es la duena de `visita` y de sus dos columnas de foto.
    private readonly visitas: VisitasService,
    // T-30: Compras y Egresos es la duena de `gasto` y de sus columnas de foto.
    private readonly gastos: GastosService,
  ) {}
```

3. Después del bloque `if (mia.tipo === 'visita') { … }` y antes del `throw new ConflictException(` final:

```ts
    if (mia.tipo === 'gasto') {
      // Mismo 409 que la visita: la tablet la deja pendiente y reintenta.
      if (mia.entidadTabla !== 'gasto' || mia.entidadId === null) {
        throw new ConflictException(
          'Ese gasto todavia no esta proyectado. Reintenta en la siguiente sincronizacion.',
        );
      }
      const subidaEn = await this.guardarDeGasto(mia.entidadId, cuerpo);
      return { clave, subida_en: subidaEn.toISOString() };
    }
```

4. El mensaje del 409 final pasa a:

```ts
    throw new ConflictException(
      `La operacion ${clave} es de tipo "${mia.tipo}", y solo un prospecto, una visita o un gasto lleva foto.`,
    );
```

5. Después de `guardarDeVisita`, el método nuevo:

```ts
  /**
   * La foto del ticket de un gasto (T-30, D8): las mismas reglas de bytes, el
   * mismo disco y el mismo orden que la de la visita — el archivo primero, la
   * columna despues. Reenviar escribe el mismo `gasto-<id>.jpg`.
   */
  private async guardarDeGasto(gastoId: string, cuerpo: Buffer): Promise<Date> {
    this.fotos.validarFoto(cuerpo);
    if (!(await this.gastos.existe(gastoId))) {
      throw new NotFoundException('Ese gasto ya no existe.');
    }
    const archivo = nombreArchivoFoto('gasto', gastoId);
    await this.fotos.escribirArchivo(archivo, cuerpo);
    const subidaEn = new Date();
    if (!(await this.gastos.anotarFoto(gastoId, archivo, subidaEn))) {
      throw new NotFoundException('Ese gasto ya no existe.');
    }
    return subidaEn;
  }
```

6. En el JSDoc de la clase cambia "(prospecto o visita, T-39)" por "(prospecto, visita o gasto; T-39, T-30)".
   En el 404 de "Nadie tiene esa clave" cambia el texto a
   `'No hay ninguna operacion con esa clave. Sincroniza el prospecto, la visita o el gasto antes de subir su foto.'`
   y en el 403 a
   `'Esa operacion no es tuya: la foto solo la puede subir el vendedor que registro el prospecto, la visita o el gasto.'`.

En `apps/backend/src/modules/sincronizacion/foto.controller.ts`, solo comentarios: el JSDoc de la clase dice "La
foto del prospecto (T-40), de la visita (T-39) o del gasto (T-30)"; el de `subir` enumera
"(`cliente-<id>.jpg`, `visita-<id>.jpg` o `gasto-<id>.jpg`, T-78/T-30)"; el de `fotoDeCliente`: "Las fotos de
las visitas y de los gastos NO bajan".

- [ ] **Paso 7: correr la unitaria y ver pasar**

`npm test --workspace=apps/backend -- foto.service` → todas en verde (las de visita y prospecto siguen igual).

- [ ] **Paso 8: el e2e del pull y de la foto**

`apps/backend/test/gasto-foto-pull.e2e-spec.ts`:

```ts
// PRIMER import, a proposito: pone FOTOS_DIR antes de que `app.module.ts` lea la configuracion.
import { FOTOS_DIR_PRUEBA } from './apoyo-fotos-dir';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
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
 * T-30/T-31: el catalogo de campos de egreso baja en el pull (D6) y la foto del
 * ticket sube por el canal de fotos como `gasto-<id>.jpg` (D8). El push del
 * gasto en si lo prueba `gasto.e2e-spec.ts` (Tarea 3).
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN = `e2e-gfoto-${SUFIJO}`;
const LOGIN_AJENO = `e2e-gfoto-a-${SUFIJO}`;
const PASSWORD = 'contrasena-del-vendedor';
const PREFIJO = `ZZ-gfoto-${SUFIJO}`;
const FECHA = '2026-10-20';

describe('Gastos: pull del catalogo y foto del ticket (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;

  let vendedorId: string;
  let vendedorAjenoId: string;
  let campoId: string;
  let campoBorradoId: string;
  let bearer: string;
  let bearerAjeno: string;

  const push = async (operaciones: unknown[], token = bearer) => {
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ contrato: CONTRATO_ACTUAL, operaciones })
      .expect(200);
    return res.body as RespuestaPush;
  };

  const pull = async (desde?: string) => {
    const params = new URLSearchParams({ contrato: String(CONTRATO_ACTUAL) });
    if (desde) params.set('desde', desde);
    const res = await request(app.getHttpServer())
      .get(`/sync/pull?${params.toString()}`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    return res.body as RespuestaPull;
  };

  const gasto = (datos: Record<string, unknown> = {}) => ({
    clave: randomUUID(),
    tipo: 'gasto',
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T18:40:00.000Z`,
    datos: {
      campo_egreso_id: campoId,
      monto_centavos: 8000,
      registrado_en: `${FECHA}T18:40:00.000Z`,
      comentario: null,
      ...datos,
    },
  });

  const jpeg = (relleno = 'ticket'): Buffer =>
    Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from(relleno, 'utf8'),
      Buffer.from([0xff, 0xd9]),
    ]);

  const subirFoto = (clave: string, cuerpo: Buffer, token = bearer) =>
    request(app.getHttpServer())
      .post(`/sync/foto/${clave}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'image/jpeg')
      .send(cuerpo);

  const archivos = async (id: string) =>
    (await fs.readdir(FOTOS_DIR_PRUEBA)).filter((n) => n.includes(id));

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
      .select('id')
      .where('deleted_at', 'is', null)
      .orderBy('codigo')
      .limit(2)
      .execute();
    expect(sucursales.length).toBeGreaterThanOrEqual(2);

    const hash = await new PasswordService().hashear(PASSWORD);
    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Vendedor de gastos',
          password_hash: hash,
          sucursal_id: sucursales[0].id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    vendedorAjenoId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN_AJENO,
          nombre: 'Vendedor de otra sucursal',
          password_hash: hash,
          sucursal_id: sucursales[1].id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    campoId = (
      await db
        .insertInto('campo_egreso')
        .values({
          nombre: `${PREFIJO} Hielo`,
          tipo: 'operacion',
          se_usa_en_app: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    campoBorradoId = (
      await db
        .insertInto('campo_egreso')
        .values({
          nombre: `${PREFIJO} Viejo`,
          tipo: 'financiero',
          deleted_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const login = await request(app.getHttpServer())
      .post('/auth/app/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);
    bearer = (login.body as { tokenAcceso: string }).tokenAcceso;
    const loginAjeno = await request(app.getHttpServer())
      .post('/auth/app/login')
      .send({ login: LOGIN_AJENO, password: PASSWORD })
      .expect(200);
    bearerAjeno = (loginAjeno.body as { tokenAcceso: string }).tokenAcceso;
  });

  afterAll(async () => {
    // Orden inverso a las llaves foraneas.
    await db
      .deleteFrom('gasto')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('campo_egreso')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('vendedor')
      .where('id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await app.close();
    await fs.rm(FOTOS_DIR_PRUEBA, { recursive: true, force: true });
  });

  describe('pull (D6)', () => {
    it('el pull completo trae la semilla con su tipo y casilla, y la baja como activo 0', async () => {
      const { catalogos } = await pull();
      const porNombre = new Map(
        catalogos.campos_egreso.map((c) => [c.nombre, c]),
      );
      expect(porNombre.get('Gasolina')).toMatchObject({
        tipo: 'operacion',
        se_usa_en_app: true,
        activo: 1,
      });
      expect(porNombre.get('Envases')).toMatchObject({
        tipo: 'produccion',
        se_usa_en_app: false,
        activo: 1,
      });
      expect(porNombre.get(`${PREFIJO} Hielo`)).toMatchObject({
        id: campoId,
        se_usa_en_app: true,
        activo: 1,
      });
      expect(porNombre.get(`${PREFIJO} Viejo`)).toMatchObject({
        id: campoBorradoId,
        tipo: 'financiero',
        activo: 0,
      });
    });

    it('apagar la casilla y dar de baja un campo bajan en el pull incremental', async () => {
      const { id } = await db
        .insertInto('campo_egreso')
        .values({
          nombre: `${PREFIJO} Casetas`,
          tipo: 'operacion',
          se_usa_en_app: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const { cursor } = await pull();

      // El trigger `set_actualizado_en` mueve la columna por la que corta el pull.
      await db
        .updateTable('campo_egreso')
        .set({ se_usa_en_app: false })
        .where('id', '=', id)
        .execute();
      const apagado = await pull(cursor);
      expect(
        apagado.catalogos.campos_egreso.find((c) => c.id === id),
      ).toMatchObject({ se_usa_en_app: false, activo: 1 });

      await db
        .updateTable('campo_egreso')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .execute();
      const baja = await pull(apagado.cursor);
      expect(
        baja.catalogos.campos_egreso.find((c) => c.id === id),
      ).toMatchObject({ activo: 0 });
    });
  });

  describe('foto del ticket (D8)', () => {
    it('la foto de un gasto aplicado se guarda como gasto-<id>.jpg y se anota en el gasto', async () => {
      const op = gasto();
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      const bytes = jpeg('ticket de hielo');

      const res = await subirFoto(op.clave, bytes).expect(200);
      expect(res.body).toMatchObject({ clave: op.clave });
      expect(await archivos(op.clave)).toEqual([`gasto-${op.clave}.jpg`]);
      expect(
        await fs.readFile(join(FOTOS_DIR_PRUEBA, `gasto-${op.clave}.jpg`)),
      ).toEqual(bytes);
      const fila = await db
        .selectFrom('gasto')
        .select(['foto_archivo', 'foto_subida_en'])
        .where('id', '=', op.clave)
        .executeTakeFirstOrThrow();
      expect(fila.foto_archivo).toBe(`gasto-${op.clave}.jpg`);
      expect(fila.foto_subida_en).not.toBeNull();
    });

    it('subir dos veces la foto del mismo gasto deja un solo archivo (Review Focus)', async () => {
      const op = gasto();
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      await subirFoto(op.clave, jpeg('primer intento')).expect(200);
      const segunda = jpeg('segundo intento');
      await subirFoto(op.clave, segunda).expect(200);
      expect(await archivos(op.clave)).toEqual([`gasto-${op.clave}.jpg`]);
      expect(
        await fs.readFile(join(FOTOS_DIR_PRUEBA, `gasto-${op.clave}.jpg`)),
      ).toEqual(segunda);
    });

    it('un gasto con un campo dado de baja entra y su foto tambien', async () => {
      const op = gasto({ campo_egreso_id: campoBorradoId });
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      await subirFoto(op.clave, jpeg()).expect(200);
      expect(await archivos(op.clave)).toEqual([`gasto-${op.clave}.jpg`]);
    });

    it('la foto de un gasto rechazado es 404 y no deja archivo', async () => {
      const op = gasto({ campo_egreso_id: randomUUID() });
      expect((await push([op])).resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'campo-egreso-inexistente',
      });
      await subirFoto(op.clave, jpeg()).expect(404);
      expect(await archivos(op.clave)).toEqual([]);
    });

    it('la foto del gasto de otro vendedor es 403 y no deja archivo', async () => {
      const op = gasto();
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      await subirFoto(op.clave, jpeg(), bearerAjeno).expect(403);
      expect(await archivos(op.clave)).toEqual([]);
    });

    it('algo que no es un JPEG completo es 415 y no toca el gasto', async () => {
      const op = gasto();
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      await subirFoto(op.clave, Buffer.from('no soy una foto')).expect(415);
      const fila = await db
        .selectFrom('gasto')
        .select('foto_archivo')
        .where('id', '=', op.clave)
        .executeTakeFirstOrThrow();
      expect(fila.foto_archivo).toBeNull();
    });
  });
});
```

- [ ] **Paso 9: correr el e2e y ver pasar**

```bash
npm run test:e2e --workspace=apps/backend -- gasto-foto-pull
npm run test:e2e --workspace=apps/backend -- visita sincronizacion
```

El primero, todo en verde. El segundo confirma que la visita, el prospecto y el resto del pull siguen igual.

- [ ] **Paso 10: tipos de la tablet, lint, build y commit**

```bash
npm run typecheck --workspace=apps/tablet
npm exec --workspace=apps/backend -- prettier --write src/modules/sincronizacion/contrato.ts src/modules/sincronizacion/sincronizacion.repository.ts src/modules/sincronizacion/sincronizacion.service.ts src/modules/sincronizacion/foto.service.ts src/modules/sincronizacion/foto.service.spec.ts src/modules/sincronizacion/foto.controller.ts src/modules/cartera-clientes/foto-prospecto.ts src/modules/compras-egresos/gastos.repository.ts src/modules/compras-egresos/gastos.service.ts test/gasto-foto-pull.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/sincronizacion/contrato.ts src/modules/sincronizacion/sincronizacion.repository.ts src/modules/sincronizacion/sincronizacion.service.ts src/modules/sincronizacion/foto.service.ts src/modules/sincronizacion/foto.service.spec.ts src/modules/sincronizacion/foto.controller.ts src/modules/cartera-clientes/foto-prospecto.ts src/modules/compras-egresos/gastos.repository.ts src/modules/compras-egresos/gastos.service.ts test/gasto-foto-pull.e2e-spec.ts
npm run build --workspace=apps/backend
git add apps/backend/src/modules/sincronizacion/contrato.ts apps/tablet/src/sincronizacion/contrato.ts docs/contrato-sincronizacion.md apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts apps/backend/src/modules/sincronizacion/sincronizacion.service.ts apps/backend/src/modules/sincronizacion/foto.service.ts apps/backend/src/modules/sincronizacion/foto.service.spec.ts apps/backend/src/modules/sincronizacion/foto.controller.ts apps/backend/src/modules/cartera-clientes/foto-prospecto.ts apps/backend/src/modules/compras-egresos/gastos.repository.ts apps/backend/src/modules/compras-egresos/gastos.service.ts apps/backend/test/gasto-foto-pull.e2e-spec.ts
git commit -m "T-30/T-31: campos_egreso en el pull y foto del ticket por el canal de fotos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

El typecheck de la tablet debe pasar sin tocar nada más: `campos_egreso` es opcional en su copia y nadie la lee
todavía (la Tarea 9 la aplica).

---

### Tarea 5: Tesorería: el gasto de la ruta resta del efectivo de su sucursal (D7)

**Files:**
- Modify: `apps/backend/src/modules/tesoreria/reglas-saldo.ts`
- Test: `apps/backend/src/modules/tesoreria/reglas-saldo.spec.ts`
- Create: `apps/backend/src/modules/tesoreria/gastos-tesoreria.repository.ts`
- Modify: `apps/backend/src/modules/tesoreria/tesoreria.service.ts`
- Modify: `apps/backend/src/modules/tesoreria/tesoreria.module.ts`
- Modify: `apps/backend/src/modules/tesoreria/tesoreria.service.spec.ts` (el constructor gana un parámetro)
- Test: `apps/backend/test/tesoreria-gastos.e2e-spec.ts` (nuevo)

**Interfaces:**
- Consumes: tabla `gasto` (Tarea 1: `sucursal_id`, `fecha`, `monto`, `metodo`, `deleted_at`); la operación `gasto`
  proyectada con `fecha = fecha_operacion` (Tarea 3); `destinoDe(sucursalId, metodo, fecha, destinos)` de
  `reglas-destino.ts`; `aCentavos` de `sincronizacion/dinero.ts`.
- Produces (en `reglas-saldo.ts`):
  - `export interface GastoDia { fecha: string; sucursalId: string; sucursalCodigo: string; cantidad: number; montoCentavos: number }` (monto positivo).
  - `movimientosDeSaldo(manuales: MovimientoManual[], cobranza: CobranzaDia[], destinos: DestinoCobranza[], gastos: GastoDia[] = []): { movimientos: MovimientoSaldo[]; sinDestino: CobranzaDia[]; gastosSinCuenta: GastoDia[] }`.
  - `ExtrasVista.gastos?: GastoDia[]`.
  - `VistaTesoreria.gastosSinCuenta: { sucursalCodigo: string; montoCentavos: number }[]`.
  - Miembro nuevo de `EventoTesoreria`:
    `{ tipo: 'gasto-ruta'; id: string; fecha: string; cuentaId: string; cuentaNombre: string; sucursalCodigo: string; cantidad: number; montoCentavos: number }`
    con `id = 'gasto-ruta:<fecha>:<cuentaId>:<sucursalId>'` y `montoCentavos` **positivo** (es una salida, como
    `retiro`).
  - `GastosTesoreriaRepository.porDia(hasta: string): Promise<GastoDia[]>`.
  - JSON de `GET /tesoreria`: gana `gastosSinCuenta` (siempre presente, `[]` si no hay) y eventos `tipo: 'gasto-ruta'`.

> El gasto se **lee** de la tabla `gasto` al consultar, como la cobranza de T-29: nada se copia a Tesorería, así
> que un gasto corregido o dado de baja desde el portal (siguiente ticket) se corrige solo. El spec nombra el evento
> `{ tipo, fecha, cuentaId, monto, sucursal }`; aquí se escribe con los nombres que ya usa el evento `cobranza`
> (`montoCentavos`, `sucursalCodigo`, `cuentaNombre`, `id`, `cantidad`) para que el portal pinte los dos igual.

- [ ] **Paso 1: las pruebas puras que fallan**

En `apps/backend/src/modules/tesoreria/reglas-saldo.spec.ts`, agrega `type GastoDia,` a la lista de imports de
`./reglas-saldo` y, después del helper `destino`, el helper:

```ts
const gasto = (
  fecha: string,
  montoCentavos: number,
  cantidad = 1,
  sucursal = 'tj',
): GastoDia => ({
  fecha,
  sucursalId: sucursal,
  sucursalCodigo: sucursal === 'tj' ? 'TJ' : 'MX',
  cantidad,
  montoCentavos,
});
```

Al final del archivo:

```ts
describe('movimientosDeSaldo con gastos de la ruta (T-30/T-31, D7)', () => {
  it('el gasto resta de la cuenta destino del EFECTIVO de su sucursal; el destino de cheque no cuenta', () => {
    const { movimientos, gastosSinCuenta } = movimientosDeSaldo(
      [],
      [],
      [
        destino('efectivo', 'a', '2026-10-01'),
        destino('cheque', 'b', '2026-10-01'),
      ],
      [gasto('2026-10-05', 33_050, 2)],
    );
    expect(movimientos).toEqual([
      { cuentaId: 'a', fecha: '2026-10-05', montoCentavos: -33_050 },
    ]);
    expect(gastosSinCuenta).toEqual([]);
  });

  it('sin destino de efectivo vigente, el gasto va a gastosSinCuenta y no se pierde', () => {
    const { movimientos, gastosSinCuenta } = movimientosDeSaldo(
      [],
      [],
      [destino('efectivo', 'a', '2026-10-10')],
      [gasto('2026-10-05', 1_234), gasto('2026-10-05', 500, 1, 'mx')],
    );
    expect(movimientos).toEqual([]);
    expect(gastosSinCuenta).toEqual([
      gasto('2026-10-05', 1_234),
      gasto('2026-10-05', 500, 1, 'mx'),
    ]);
  });

  it('varios dias y un cambio de destino: cada dia va a la cuenta vigente en su fecha', () => {
    const { movimientos } = movimientosDeSaldo(
      [],
      [],
      [
        destino('efectivo', 'a', '2026-10-01'),
        destino('efectivo', 'b', '2026-10-15'),
      ],
      [gasto('2026-10-14', 100), gasto('2026-10-15', 200)],
    );
    expect(movimientos).toEqual([
      { cuentaId: 'a', fecha: '2026-10-14', montoCentavos: -100 },
      { cuentaId: 'b', fecha: '2026-10-15', montoCentavos: -200 },
    ]);
  });

  it('sin el cuarto argumento se comporta como T-29', () => {
    const r = movimientosDeSaldo([], [], []);
    expect(r).toEqual({ movimientos: [], sinDestino: [], gastosSinCuenta: [] });
  });
});

describe('armarVista con gastos de la ruta (T-30/T-31, D7)', () => {
  const cuentas: CuentaEnAlcance[] = [
    {
      id: 'a',
      nombre: 'Efectivo TJ',
      sucursalId: 's-tj',
      sucursalCodigo: 'TJ',
    },
    { id: 'b', nombre: 'ScotiaFiscal', sucursalId: null, sucursalCodigo: null },
  ];
  const saldosBase = [
    fijado('s1', 'a', '2026-10-01', 100_000),
    fijado('s2', 'b', '2026-10-01', 500_000),
  ];

  it('el gasto es salida de la cuenta de efectivo, resta del saldo final y la cobranza sigue sumando', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, saldosBase, {
      cobranza: [cobranza('2026-10-05', 'efectivo', 50_000, 3)],
      destinos: [destino('efectivo', 'a', '2026-10-01')],
      gastos: [gasto('2026-10-05', 33_050, 2), gasto('2026-10-06', 1_000)],
    });
    expect(v.cuentas.find((c) => c.id === 'a')).toMatchObject({
      saldoInicioCentavos: 100_000,
      entradasCentavos: 50_000,
      salidasCentavos: 34_050,
      saldoFinalCentavos: 115_950,
    });
    expect(v.total).toMatchObject({
      entradasCentavos: 50_000,
      salidasCentavos: 34_050,
    });
    expect(v.gastosSinCuenta).toEqual([]);
  });

  it('un gasto anterior al rango cuenta en el saldo al inicio, no en las salidas', () => {
    const v = armarVista('2026-10-10', '2026-10-31', cuentas, saldosBase, {
      destinos: [destino('efectivo', 'a', '2026-10-01')],
      gastos: [gasto('2026-10-05', 20_000)],
    });
    expect(v.cuentas.find((c) => c.id === 'a')).toMatchObject({
      saldoInicioCentavos: 80_000,
      salidasCentavos: 0,
      saldoFinalCentavos: 80_000,
    });
    expect(v.eventos.some((e) => e.tipo === 'gasto-ruta')).toBe(false);
  });

  it('el evento "gasto-ruta" agrupa el dia y la sucursal, con monto positivo', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, saldosBase, {
      destinos: [destino('efectivo', 'a', '2026-10-01')],
      gastos: [gasto('2026-10-05', 33_050, 2)],
    });
    expect(v.eventos).toEqual([
      {
        tipo: 'gasto-ruta',
        id: 'gasto-ruta:2026-10-05:a:tj',
        fecha: '2026-10-05',
        cuentaId: 'a',
        cuentaNombre: 'Efectivo TJ',
        sucursalCodigo: 'TJ',
        cantidad: 2,
        montoCentavos: 33_050,
      },
    ]);
  });

  it('si la cuenta destino no esta en alcance no hay evento, pero tampoco es "sin cuenta"', () => {
    const v = armarVista('2026-10-02', '2026-10-31', [cuentas[1]], [saldosBase[1]], {
      destinos: [destino('efectivo', 'a', '2026-10-01')],
      gastos: [gasto('2026-10-05', 33_050, 2)],
    });
    expect(v.eventos).toEqual([]);
    expect(v.gastosSinCuenta).toEqual([]);
  });

  it('gastos sin cuenta: solo del rango y de sucursales en alcance, sumados por sucursal', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, saldosBase, {
      destinos: [],
      gastos: [
        gasto('2026-10-03', 25_050),
        gasto('2026-10-04', 8_000),
        gasto('2026-09-30', 999),
        gasto('2026-10-04', 1_234, 1, 'mx'),
      ],
      sucursalesEnAlcance: ['TJ'],
    });
    expect(v.gastosSinCuenta).toEqual([
      { sucursalCodigo: 'TJ', montoCentavos: 33_050 },
    ]);
    expect(v.cuentas.find((c) => c.id === 'a')?.salidasCentavos).toBe(0);
  });

  it('un General (sin filtro de sucursales) ve los gastos sin cuenta de todas, ordenados por codigo', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, saldosBase, {
      gastos: [gasto('2026-10-04', 1_234, 1, 'mx'), gasto('2026-10-04', 100)],
    });
    expect(v.gastosSinCuenta).toEqual([
      { sucursalCodigo: 'MX', montoCentavos: 1_234 },
      { sucursalCodigo: 'TJ', montoCentavos: 100 },
    ]);
  });

  it('sin gastos, gastosSinCuenta es [] y no hay eventos de gasto', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, saldosBase, {
      cobranza: [cobranza('2026-10-05', 'efectivo', 1_000)],
      destinos: [destino('efectivo', 'a', '2026-10-01')],
    });
    expect(v.gastosSinCuenta).toEqual([]);
    expect(v.eventos.map((e) => e.tipo)).toEqual(['cobranza']);
    expect(armarVista('2026-10-02', '2026-10-31', cuentas, saldosBase).gastosSinCuenta).toEqual([]);
  });
});
```

- [ ] **Paso 2: correr y ver fallar**

`npm test --workspace=apps/backend -- reglas-saldo` → los casos nuevos fallan (`gastosSinCuenta` es `undefined`,
no hay movimientos negativos ni eventos `gasto-ruta`). Los de T-28/T-29 siguen en verde.

- [ ] **Paso 3: la regla pura**

En `apps/backend/src/modules/tesoreria/reglas-saldo.ts`:

1. Después de la interfaz `MovimientoManual`:

```ts
/**
 * T-30/T-31 (D7): los gastos de la ruta de un dia y una sucursal, ya sumados.
 * Solo los de `metodo = 'efectivo_cobranza_dia'`: salen del efectivo que cobro
 * el vendedor, asi que restan de la MISMA cuenta a la que T-29 suma la cobranza
 * en efectivo de esa sucursal (la vigente de `(sucursal, 'efectivo')` en la
 * fecha del gasto).
 */
export interface GastoDia {
  /** `AAAA-MM-DD`: la `fecha_operacion` del gasto, nunca re-derivada de UTC. */
  fecha: string;
  sucursalId: string;
  sucursalCodigo: string;
  /** Cuantos gastos forman la suma. */
  cantidad: number;
  /** Positivo: el signo lo pone `movimientosDeSaldo`. */
  montoCentavos: number;
}
```

2. En `EventoTesoreria`, después del miembro `tipo: 'cobranza'`:

```ts
  | {
      /** T-30/T-31: el total de gastos de la ruta de un dia y una sucursal. */
      tipo: 'gasto-ruta';
      id: string;
      fecha: string;
      cuentaId: string;
      cuentaNombre: string;
      sucursalCodigo: string;
      cantidad: number;
      /** Positivo: es una salida, como el retiro. */
      montoCentavos: number;
    };
```

(quita el `;` que cerraba el miembro `cobranza`, para que la unión siga).

3. En `VistaTesoreria`, después de `sinCuenta`:

```ts
  /**
   * T-30/T-31: gastos de la ruta del rango cuya sucursal no tiene cuenta destino
   * de efectivo, de las sucursales en alcance. No restan de ninguna cuenta, pero
   * no se pierden: la vista los avisa como a la cobranza sin destino.
   */
  gastosSinCuenta: {
    sucursalCodigo: string;
    montoCentavos: number;
  }[];
```

4. En `ExtrasVista`, después de `destinos?`:

```ts
  /** T-30/T-31: gastos de la ruta agrupados por dia y sucursal. */
  gastos?: GastoDia[];
```

5. `movimientosDeSaldo` completo:

```ts
/**
 * Convierte movimientos manuales, cobranza y gastos de la ruta en el arreglo que
 * `saldoDeCuenta` suma (spec §3.4 de T-28/T-29; D7 de T-30/T-31): deposito +,
 * retiro −, traspaso − en la de salida y + en la de entrada, cobranza + en la
 * cuenta destino vigente en su fecha, gasto de la ruta − en la cuenta destino
 * del EFECTIVO de su sucursal vigente en su fecha.
 */
export function movimientosDeSaldo(
  manuales: MovimientoManual[],
  cobranza: CobranzaDia[],
  destinos: DestinoCobranza[],
  gastos: GastoDia[] = [],
): {
  movimientos: MovimientoSaldo[];
  sinDestino: CobranzaDia[];
  gastosSinCuenta: GastoDia[];
} {
  const movimientos: MovimientoSaldo[] = [];
  for (const m of manuales) {
    if (m.tipo === 'deposito') {
      movimientos.push({
        cuentaId: m.cuentaId,
        fecha: m.fecha,
        montoCentavos: m.montoCentavos,
      });
    } else if (m.tipo === 'retiro') {
      movimientos.push({
        cuentaId: m.cuentaId,
        fecha: m.fecha,
        montoCentavos: -m.montoCentavos,
      });
    } else if (m.cuentaDestinoId !== null) {
      movimientos.push({
        cuentaId: m.cuentaId,
        fecha: m.fecha,
        montoCentavos: -m.montoCentavos,
      });
      movimientos.push({
        cuentaId: m.cuentaDestinoId,
        fecha: m.fecha,
        montoCentavos: m.montoCentavos,
      });
    }
  }
  const sinDestino: CobranzaDia[] = [];
  for (const c of cobranza) {
    const d = destinoDe(c.sucursalId, c.metodo, c.fecha, destinos);
    if (d === null) sinDestino.push(c);
    else
      movimientos.push({
        cuentaId: d.cuentaId,
        fecha: c.fecha,
        montoCentavos: c.montoCentavos,
      });
  }
  const gastosSinCuenta: GastoDia[] = [];
  for (const g of gastos) {
    // "Efectivo cobranza del dia": la misma cuenta que recibe el efectivo.
    const d = destinoDe(g.sucursalId, 'efectivo', g.fecha, destinos);
    if (d === null) gastosSinCuenta.push(g);
    else
      movimientos.push({
        cuentaId: d.cuentaId,
        fecha: g.fecha,
        montoCentavos: -g.montoCentavos,
      });
  }
  return { movimientos, sinDestino, gastosSinCuenta };
}
```

6. En `armarVista`:

- el inicio pasa a:

```ts
  const manuales = extras.manuales ?? [];
  const cobranza = extras.cobranza ?? [];
  const destinos = extras.destinos ?? [];
  const gastos = extras.gastos ?? [];
  const { movimientos, sinDestino, gastosSinCuenta } = movimientosDeSaldo(
    manuales,
    cobranza,
    destinos,
    gastos,
  );
```

- después del bloque que arma `const sinCuenta = [...sinCuentaMapa.values()].sort(…);`:

```ts
  const gastosSinCuentaMapa = new Map<
    string,
    { sucursalCodigo: string; montoCentavos: number }
  >();
  for (const g of gastosSinCuenta) {
    if (!enRango(g.fecha)) continue;
    if (
      extras.sucursalesEnAlcance &&
      !extras.sucursalesEnAlcance.includes(g.sucursalCodigo)
    )
      continue;
    const actual = gastosSinCuentaMapa.get(g.sucursalCodigo) ?? {
      sucursalCodigo: g.sucursalCodigo,
      montoCentavos: 0,
    };
    actual.montoCentavos += g.montoCentavos;
    gastosSinCuentaMapa.set(g.sucursalCodigo, actual);
  }
  const gastosSinCuentaVista = [...gastosSinCuentaMapa.values()].sort((a, b) =>
    a.sucursalCodigo.localeCompare(b.sucursalCodigo),
  );
```

- después del `for (const c of cobranza) { … }` que empuja los eventos de cobranza y antes de `eventos.sort(`:

```ts
  for (const g of gastos) {
    if (!enRango(g.fecha)) continue;
    const d = destinoDe(g.sucursalId, 'efectivo', g.fecha, destinos);
    if (d === null || !visibles.has(d.cuentaId)) continue;
    eventos.push({
      tipo: 'gasto-ruta',
      id: `gasto-ruta:${g.fecha}:${d.cuentaId}:${g.sucursalId}`,
      fecha: g.fecha,
      cuentaId: d.cuentaId,
      cuentaNombre: d.cuentaNombre,
      sucursalCodigo: g.sucursalCodigo,
      cantidad: g.cantidad,
      montoCentavos: g.montoCentavos,
    });
  }
```

- el `return` final:

```ts
  return {
    desde,
    hasta,
    cuentas: filas,
    total,
    sinCuenta,
    gastosSinCuenta: gastosSinCuentaVista,
    eventos,
  };
```

7. En el comentario del encabezado del archivo, después de "(depositos, retiros, traspasos, cobranza)", agrega
   "; T-30/T-31, los gastos de la ruta (`GastoDia`)".

- [ ] **Paso 4: correr y ver pasar**

`npm test --workspace=apps/backend -- reglas-saldo` → todo en verde.

- [ ] **Paso 5: la lectura del gasto y el cableado**

`apps/backend/src/modules/tesoreria/gastos-tesoreria.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos } from '../sincronizacion/dinero';
import type { GastoDia } from './reglas-saldo';

/**
 * T-30/T-31 (D7): los gastos de la ruta que restan en Tesoreria, LEIDOS (no
 * copiados) de la tabla `gasto` de Compras y Egresos, agrupados por dia y
 * sucursal (la del GASTO, que es la del vendedor). Solo los vivos con
 * `metodo = 'efectivo_cobranza_dia'`: las compras de oficina con otro metodo
 * (siguiente ticket) no salen del efectivo de la cobranza. Un gasto dado de
 * baja deja de contar solo, igual que un cobro borrado en T-29.
 */
@Injectable()
export class GastosTesoreriaRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async porDia(hasta: string): Promise<GastoDia[]> {
    const r = await sql<{
      fecha: string;
      sucursal_id: string;
      codigo: string;
      cantidad: number;
      monto: string;
    }>`
      select to_char(g.fecha, 'YYYY-MM-DD') as fecha, g.sucursal_id, s.codigo,
             count(*)::int as cantidad, sum(g.monto)::text as monto
        from gasto g
        join sucursal s on s.id = g.sucursal_id
       where g.deleted_at is null
         and g.metodo = 'efectivo_cobranza_dia'
         and g.fecha <= ${hasta}::date
       group by 1, 2, 3
       order by 1, 3
    `.execute(this.db);
    return r.rows.map((f) => ({
      fecha: f.fecha,
      sucursalId: f.sucursal_id,
      sucursalCodigo: f.codigo,
      cantidad: Number(f.cantidad),
      montoCentavos: aCentavos(f.monto),
    }));
  }
}
```

En `apps/backend/src/modules/tesoreria/tesoreria.service.ts`:

- import, después del de `CobranzaTesoreriaRepository`:

```ts
import { GastosTesoreriaRepository } from './gastos-tesoreria.repository';
```

- el constructor gana el parámetro al final:

```ts
    private readonly cobranza: CobranzaTesoreriaRepository,
    // T-30/T-31: los gastos de la ruta se leen de `gasto`, como la cobranza.
    private readonly gastos: GastosTesoreriaRepository,
  ) {}
```

- en `vista`, el `Promise.all` y la llamada a `armarVista`:

```ts
    const [saldos, manuales, cobranza, destinos, gastos] = await Promise.all([
      this.repo.saldosDeCuentas(ids, q.hasta),
      this.movimientos.listar(ids, null, q.hasta),
      this.cobranza.porDia(q.hasta),
      this.destinos.listar(null),
      this.gastos.porDia(q.hasta),
    ]);
    return armarVista(q.desde, q.hasta, cuentas, saldos, {
      manuales,
      cobranza,
      destinos,
      gastos,
      sucursalesEnAlcance: codigo === null ? null : [codigo],
    });
```

- en el JSDoc de `vista`, después de "La cobranza se lee de TODAS las sucursales", agrega "(y los gastos de la ruta,
  T-30/T-31)"; y "`sinCuenta`" pasa a "`sinCuenta` y `gastosSinCuenta`".

En `apps/backend/src/modules/tesoreria/tesoreria.module.ts`: import
`import { GastosTesoreriaRepository } from './gastos-tesoreria.repository';`, agrega `GastosTesoreriaRepository`
al final de `providers` y cambia el comentario a
`// T-28: cuentas y saldos fijados. T-29: movimientos manuales (depositos, retiros, traspasos). T-30/T-31: gastos de la ruta (lectura).`

En `apps/backend/src/modules/tesoreria/tesoreria.service.spec.ts`: import
`import type { GastosTesoreriaRepository } from './gastos-tesoreria.repository';` y en `armar`, después de
`{} as unknown as CobranzaTesoreriaRepository,`:

```ts
    {} as unknown as GastosTesoreriaRepository,
```

- [ ] **Paso 6: unitarias y build**

```bash
npm test --workspace=apps/backend -- tesoreria
npm run build --workspace=apps/backend
```

Verde y sin errores de tipos.

- [ ] **Paso 7: el e2e de Tesorería con gastos**

`apps/backend/test/tesoreria-gastos.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
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
  type RespuestaPush,
} from './../src/modules/sincronizacion/contrato';

/**
 * T-30/T-31 (D7): Tesoreria resta el gasto de la ruta de la cuenta destino del
 * efectivo de la sucursal, leyendolo de `gasto`. Fechas de 2017-2018 a
 * proposito: ninguna otra suite tiene destinos ni movimientos ahi (las de T-29
 * usan 2019), y un destino de TJ desde 2018-07-01 queda tapado por los suyos,
 * mas recientes.
 */
interface Vista {
  cuentas: {
    id: string;
    saldoInicioCentavos: number | null;
    saldoFinalCentavos: number | null;
    entradasCentavos: number;
    salidasCentavos: number;
  }[];
  gastosSinCuenta: { sucursalCodigo: string; montoCentavos: number }[];
  eventos: {
    tipo: string;
    id: string;
    cuentaId: string;
    fecha: string;
    sucursalCodigo?: string;
    cantidad?: number;
    montoCentavos: number;
  }[];
}

const SUFIJO = `${Date.now()}-${process.pid}`;
const PREFIJO = `ZZ-e2e-tgas-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-tgas-gen-${SUFIJO}`;
const LOGIN_VENDEDOR = `e2e-tgas-v-${SUFIJO}`;

describe('Tesorería — gastos de la ruta (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let usuarioId: string;
  let general: string;
  let bearer: string;
  let idTijuana: string;
  let idMexicali: string;
  let vendedorTj: string;
  let vendedorMx: string;
  let campoId: string;
  let cuentaEfectivo: string;

  const http = () => request(app.getHttpServer());

  const vista = async (desde: string, hasta: string, sucursal: string) =>
    (
      await http()
        .get(`/tesoreria?desde=${desde}&hasta=${hasta}&sucursal=${sucursal}`)
        .set('Cookie', general)
        .expect(200)
    ).body as Vista;

  /** Un gasto vivo de la ruta, como lo deja `GastosService` al proyectar. */
  const sembrarGasto = async (
    vendedorId: string,
    sucursalId: string,
    fecha: string,
    monto: string,
  ): Promise<string> => {
    const id = randomUUID();
    await db
      .insertInto('gasto')
      .values({
        id,
        sucursal_id: sucursalId,
        vendedor_id: vendedorId,
        campo_egreso_id: campoId,
        campo_nombre: `${PREFIJO} Hielo`,
        tipo: 'operacion',
        fecha,
        registrado_en: `${fecha}T18:00:00.000Z`,
        monto,
        metodo: 'efectivo_cobranza_dia',
        origen: 'app',
      })
      .execute();
    return id;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    idTijuana = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;
    idMexicali = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'MX')
        .executeTakeFirstOrThrow()
    ).id;

    const passwords = app.get(PasswordService);
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
          password_hash: await passwords.hashear(PASSWORD),
          perfil_id: perfilId,
          sucursal_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const hashVendedor = await passwords.hashear(PASSWORD);
    vendedorTj = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN_VENDEDOR,
          nombre: 'Vendedor TJ de Tesorería',
          password_hash: hashVendedor,
          sucursal_id: idTijuana,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    vendedorMx = (
      await db
        .insertInto('vendedor')
        .values({
          login: `${LOGIN_VENDEDOR}-mx`,
          nombre: 'Vendedor MX de Tesorería',
          password_hash: hashVendedor,
          sucursal_id: idMexicali,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    campoId = (
      await db
        .insertInto('campo_egreso')
        .values({
          nombre: `${PREFIJO} Hielo`,
          tipo: 'operacion',
          se_usa_en_app: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // La cuenta de efectivo de TJ: saldo inicial y destino del efectivo desde julio de 2018.
    cuentaEfectivo = (
      await db
        .insertInto('tesoreria_cuenta')
        .values({ nombre: `${PREFIJO} Efectivo TJ`, sucursal_id: idTijuana })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await db
      .insertInto('tesoreria_saldo')
      .values({
        cuenta_id: cuentaEfectivo,
        fecha: '2018-07-01',
        monto: '1000.00',
        capturo_usuario_id: usuarioId,
      })
      .execute();

    const sesion = await http()
      .post('/auth/login')
      .send({ login: LOGIN_GENERAL, password: PASSWORD })
      .expect(200);
    const cookies = sesion.headers['set-cookie'] as unknown as string[];
    const acceso = cookies.find((c) => c.startsWith('jawa_access='));
    if (!acceso) throw new Error('El login no devolvio cookie de acceso.');
    general = acceso.split(';')[0];

    await http()
      .put('/tesoreria/destinos')
      .set('Cookie', general)
      .send({
        sucursalId: idTijuana,
        metodo: 'efectivo',
        cuentaId: cuentaEfectivo,
        desde: '2018-07-01',
      })
      .expect(200);

    const login = await http()
      .post('/auth/app/login')
      .send({ login: LOGIN_VENDEDOR, password: PASSWORD })
      .expect(200);
    bearer = (login.body as { tokenAcceso: string }).tokenAcceso;
  });

  afterAll(async () => {
    // Orden inverso a las llaves foraneas.
    await db
      .deleteFrom('gasto')
      .where('vendedor_id', 'in', [vendedorTj, vendedorMx])
      .execute();
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', 'in', [vendedorTj, vendedorMx])
      .execute();
    await db
      .deleteFrom('campo_egreso')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db
      .deleteFrom('tesoreria_destino_cobranza')
      .where('cuenta_id', '=', cuentaEfectivo)
      .execute();
    await db
      .deleteFrom('tesoreria_saldo')
      .where('cuenta_id', '=', cuentaEfectivo)
      .execute();
    await db
      .deleteFrom('tesoreria_cuenta')
      .where('id', '=', cuentaEfectivo)
      .execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', 'in', [vendedorTj, vendedorMx])
      .execute();
    await db
      .deleteFrom('vendedor')
      .where('id', 'in', [vendedorTj, vendedorMx])
      .execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', '=', usuarioId)
      .execute();
    await db.deleteFrom('usuario').where('id', '=', usuarioId).execute();
    await app.close();
  });

  it('los gastos del dia restan de la cuenta de efectivo de TJ y salen como un evento "gasto-ruta"', async () => {
    await sembrarGasto(vendedorTj, idTijuana, '2018-07-05', '250.50');
    await sembrarGasto(vendedorTj, idTijuana, '2018-07-05', '80.00');
    const borrado = await sembrarGasto(
      vendedorTj,
      idTijuana,
      '2018-07-05',
      '999.00',
    );
    await db
      .updateTable('gasto')
      .set({ deleted_at: new Date() })
      .where('id', '=', borrado)
      .execute();
    // Uno de MX el mismo dia no toca la cuenta de TJ.
    await sembrarGasto(vendedorMx, idMexicali, '2018-07-05', '10.00');

    const v = await vista('2018-07-05', '2018-07-05', 'TJ');
    expect(v.cuentas.find((c) => c.id === cuentaEfectivo)).toMatchObject({
      saldoInicioCentavos: 100_000,
      entradasCentavos: 0,
      salidasCentavos: 33_050,
      saldoFinalCentavos: 66_950,
    });
    expect(
      v.eventos.filter(
        (e) => e.cuentaId === cuentaEfectivo && e.tipo === 'gasto-ruta',
      ),
    ).toEqual([
      expect.objectContaining({
        fecha: '2018-07-05',
        sucursalCodigo: 'TJ',
        cantidad: 2,
        montoCentavos: 33_050,
      }),
    ]);
  });

  it('un gasto subido a una hora en que en UTC ya es otro dia cuenta en su fecha_operacion (Review Focus)', async () => {
    const clave = randomUUID();
    const res = await http()
      .post('/sync/push')
      .set('Authorization', `Bearer ${bearer}`)
      .send({
        contrato: CONTRATO_ACTUAL,
        operaciones: [
          {
            clave,
            tipo: 'gasto',
            fecha_operacion: '2018-07-10',
            // 18:30 del 10 en Tijuana = 01:30 del 11 en UTC.
            ocurrido_en: '2018-07-11T01:30:00.000Z',
            datos: {
              campo_egreso_id: campoId,
              monto_centavos: 4_500,
              registrado_en: '2018-07-11T01:30:00.000Z',
              comentario: null,
            },
          },
        ],
      })
      .expect(200);
    expect((res.body as RespuestaPush).resultados[0].estado).toBe('aplicada');

    const dia10 = await vista('2018-07-10', '2018-07-10', 'TJ');
    expect(
      dia10.cuentas.find((c) => c.id === cuentaEfectivo)?.salidasCentavos,
    ).toBe(4_500);
    expect(
      dia10.eventos.find(
        (e) => e.cuentaId === cuentaEfectivo && e.tipo === 'gasto-ruta',
      ),
    ).toMatchObject({ fecha: '2018-07-10', montoCentavos: 4_500 });

    const dia11 = await vista('2018-07-11', '2018-07-11', 'TJ');
    expect(
      dia11.cuentas.find((c) => c.id === cuentaEfectivo)?.salidasCentavos,
    ).toBe(0);
  });

  it('un gasto dado de baja deja de restar solo: no hay nada copiado en Tesorería', async () => {
    const id = await sembrarGasto(vendedorTj, idTijuana, '2018-07-15', '20.00');
    const antes = await vista('2018-07-15', '2018-07-15', 'TJ');
    expect(
      antes.cuentas.find((c) => c.id === cuentaEfectivo)?.salidasCentavos,
    ).toBe(2_000);

    await db
      .updateTable('gasto')
      .set({ deleted_at: new Date() })
      .where('id', '=', id)
      .execute();
    const despues = await vista('2018-07-15', '2018-07-15', 'TJ');
    expect(
      despues.cuentas.find((c) => c.id === cuentaEfectivo)?.salidasCentavos,
    ).toBe(0);
    expect(
      despues.eventos.some(
        (e) => e.cuentaId === cuentaEfectivo && e.tipo === 'gasto-ruta',
      ),
    ).toBe(false);
  });

  it('una sucursal sin cuenta de efectivo: el gasto sale en gastosSinCuenta y no se pierde (Review Focus)', async () => {
    // MX · efectivo en junio de 2017 no tiene destino en ninguna suite.
    await sembrarGasto(vendedorMx, idMexicali, '2017-06-10', '12.34');
    const mx = await vista('2017-06-10', '2017-06-10', 'MX');
    expect(mx.gastosSinCuenta).toEqual([
      { sucursalCodigo: 'MX', montoCentavos: 1_234 },
    ]);
    expect(mx.eventos.some((e) => e.tipo === 'gasto-ruta')).toBe(false);

    // Mirando TJ no se reporta lo de MX.
    const tj = await vista('2017-06-10', '2017-06-10', 'TJ');
    expect(tj.gastosSinCuenta.some((g) => g.sucursalCodigo === 'MX')).toBe(
      false,
    );
  });
});
```

- [ ] **Paso 8: correr el e2e y ver pasar**

```bash
npm run test:e2e --workspace=apps/backend -- tesoreria
```

`tesoreria-gastos` en verde; `tesoreria` y `tesoreria-movimientos` siguen en verde (su destino de TJ desde
2019-03-01 es más reciente que el de esta suite, así que no se pisan).

- [ ] **Paso 9: lint, build y commit**

```bash
npm exec --workspace=apps/backend -- prettier --write src/modules/tesoreria/reglas-saldo.ts src/modules/tesoreria/reglas-saldo.spec.ts src/modules/tesoreria/gastos-tesoreria.repository.ts src/modules/tesoreria/tesoreria.service.ts src/modules/tesoreria/tesoreria.module.ts src/modules/tesoreria/tesoreria.service.spec.ts test/tesoreria-gastos.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/tesoreria/reglas-saldo.ts src/modules/tesoreria/reglas-saldo.spec.ts src/modules/tesoreria/gastos-tesoreria.repository.ts src/modules/tesoreria/tesoreria.service.ts src/modules/tesoreria/tesoreria.module.ts src/modules/tesoreria/tesoreria.service.spec.ts test/tesoreria-gastos.e2e-spec.ts
npm run build --workspace=apps/backend
git add apps/backend/src/modules/tesoreria/reglas-saldo.ts apps/backend/src/modules/tesoreria/reglas-saldo.spec.ts apps/backend/src/modules/tesoreria/gastos-tesoreria.repository.ts apps/backend/src/modules/tesoreria/tesoreria.service.ts apps/backend/src/modules/tesoreria/tesoreria.module.ts apps/backend/src/modules/tesoreria/tesoreria.service.spec.ts apps/backend/test/tesoreria-gastos.e2e-spec.ts
git commit -m "T-30/T-31: Tesorería resta los gastos de la ruta del efectivo de su sucursal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 6: Backend: consulta de gastos para el portal (`GET /gastos` y la foto del ticket) (D10)

**Files:**
- Create: `apps/backend/src/modules/compras-egresos/dto/listar-gastos.dto.ts`
- Modify: `apps/backend/src/modules/compras-egresos/gastos.repository.ts` (`listar`, `fotoEnAlcance`, `buscarSucursalUsuario`)
- Modify: `apps/backend/src/modules/compras-egresos/gastos.service.ts` (`listar`, `rutaFoto`; constructor gana `FotosService`)
- Create: `apps/backend/src/modules/compras-egresos/gastos.controller.ts`
- Modify: `apps/backend/src/modules/compras-egresos/compras-egresos.module.ts`
- Modify: `apps/backend/src/modules/cartera-clientes/fotos.service.ts` (`rutaDeArchivo` público)
- Test: `apps/backend/src/modules/compras-egresos/gastos-consulta.service.spec.ts` (nuevo)
- Test: `apps/backend/test/gastos-portal.e2e-spec.ts` (nuevo)

**Interfaces:**
- Consumes: tabla `gasto` (Tarea 1) y permiso `gasto.ver` (grupo Finanzas); `GastosService`/`GastosRepository` de
  las Tareas 3 y 4; `CamposEgresoController`/`CamposEgresoService`/`CamposEgresoRepository` de la Tarea 2;
  `validarRango(desde, hasta): string | null` de `estadisticas/reglas-kilometraje.ts` (≤ 366 días);
  `resolverAlcance`/`normalizarSucursalPedida` de `sucursales/alcance-sucursal.ts`;
  `buscarSucursalUsuario(db, usuarioId)` de `sucursales/buscar-sucursal-usuario.ts`; `aCentavos` de
  `sincronizacion/dinero.ts`; `FotosService` (exportado por `CarteraClientesModule`).
- Produces:
  - `FotosService.rutaDeArchivo(archivo: string, mensaje404: string): Promise<string>`.
  - `export interface FiltroGastos { desde: string; hasta: string; codigoSucursal: string | null; vendedorId: string | null; campoEgresoId: string | null }`.
  - `export interface GastoListado { id: string; fecha: string; registradoEn: string; sucursalCodigo: string; vendedorId: string | null; vendedorNombre: string | null; campoEgresoId: string; campoNombre: string; tipo: TipoEgreso; montoCentavos: number; comentario: string | null; tieneFoto: boolean }`.
  - `export interface ListaGastos { desde: string; hasta: string; gastos: GastoListado[]; totalCentavos: number }`.
  - `GastosRepository.listar(f: FiltroGastos): Promise<GastoListado[]>`,
    `GastosRepository.fotoEnAlcance(id: string, codigoSucursal: string | null): Promise<string | null>`,
    `GastosRepository.buscarSucursalUsuario(usuarioId: string)`.
  - `GastosService.listar(usuarioId: string, q: ListarGastosDto): Promise<ListaGastos>`,
    `GastosService.rutaFoto(usuarioId: string, id: string): Promise<string>`.
  - `GET /gastos?desde&hasta&sucursal&vendedor&campo` → `ListaGastos` (camelCase); `GET /gastos/:id/foto` →
    `image/jpeg`. Los dos con `@RequierePermiso('gasto.ver')`.

> Reglas: rango por `validarRango` (formato AAAA-MM-DD en el DTO; día real, orden y tope de 366 días en el
> servicio, igual que el Reporte de Ventas). Sucursal por `resolverAlcance` (un usuario atado ve solo la suya y pedir
> otra por su código es 403, como en todo el portal). `vendedor` y `campo` son uuid; otra cosa es 400. Solo gastos
> vivos. Orden: `fecha`, `registrado_en`, `id`. `vendedorNombre` es el nombre actual del vendedor y, si la fila no
> tiene vendedor (compra de oficina del siguiente ticket), `quien`. La foto: otra sucursal, sin foto, inexistente o
> dada de baja → **404** "Ese gasto no tiene foto." (no 403: no confirma que exista), como `GET /sync/foto/cliente`.

- [ ] **Paso 1: la prueba unitaria del servicio, que falla**

`apps/backend/src/modules/compras-egresos/gastos-consulta.service.spec.ts`:

```ts
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { GastosService } from './gastos.service';
import type { GastoListado } from './gastos.repository';

const VENDEDOR = '6F9619FF-8B86-4011-B42D-00C04FC964FF';
const CAMPO = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const GASTO = 'b6a1f3c2-0000-4000-8000-000000000030';

const fila = (montoCentavos: number): GastoListado => ({
  id: GASTO,
  fecha: '2026-10-20',
  registradoEn: '2026-10-20T18:00:00.000Z',
  sucursalCodigo: 'TJ',
  vendedorId: VENDEDOR.toLowerCase(),
  vendedorNombre: 'Abraham',
  campoEgresoId: CAMPO,
  campoNombre: 'Hielo',
  tipo: 'operacion',
  montoCentavos,
  comentario: null,
  tieneFoto: false,
});

function montar(usuario: { id: string | null; codigo: string | null } | undefined) {
  const repo = {
    buscarSucursalUsuario: jest.fn().mockResolvedValue(usuario),
    listar: jest.fn().mockResolvedValue([fila(25_050), fila(8_000)]),
    fotoEnAlcance: jest.fn().mockResolvedValue(`gasto-${GASTO}.jpg`),
  };
  const fotos = {
    rutaDeArchivo: jest.fn().mockResolvedValue(`/fotos/gasto-${GASTO}.jpg`),
  };
  return {
    servicio: new GastosService(repo as never, fotos as never),
    repo,
    fotos,
  };
}

const GENERAL = { id: null, codigo: null };
const TIJUANA = { id: 'suc-tj', codigo: 'TJ' };

describe('GastosService.listar (T-30/T-31, D10)', () => {
  it('un General sin filtros ve todas las sucursales; el total suma los montos', async () => {
    const { servicio, repo } = montar(GENERAL);
    const r = await servicio.listar('u1', {
      desde: '2026-10-01',
      hasta: '2026-10-20',
    });
    expect(repo.listar).toHaveBeenCalledWith({
      desde: '2026-10-01',
      hasta: '2026-10-20',
      codigoSucursal: null,
      vendedorId: null,
      campoEgresoId: null,
    });
    expect(r).toEqual({
      desde: '2026-10-01',
      hasta: '2026-10-20',
      gastos: [fila(25_050), fila(8_000)],
      totalCentavos: 33_050,
    });
  });

  it('vendedor y campo viajan en minusculas; la sucursal pedida pasa por el alcance', async () => {
    const { servicio, repo } = montar(GENERAL);
    await servicio.listar('u1', {
      desde: '2026-10-20',
      hasta: '2026-10-20',
      sucursal: 'mx',
      vendedor: VENDEDOR,
      campo: ` ${CAMPO} `,
    });
    expect(repo.listar).toHaveBeenCalledWith(
      expect.objectContaining({
        codigoSucursal: 'MX',
        vendedorId: VENDEDOR.toLowerCase(),
        campoEgresoId: CAMPO,
      }),
    );
  });

  it('un usuario atado a TJ ve solo TJ aunque pida "todas"', async () => {
    const { servicio, repo } = montar(TIJUANA);
    await servicio.listar('u1', {
      desde: '2026-10-20',
      hasta: '2026-10-20',
      sucursal: 'todas',
    });
    expect(repo.listar).toHaveBeenCalledWith(
      expect.objectContaining({ codigoSucursal: 'TJ' }),
    );
  });

  it('un usuario atado a TJ que pide MX es 403', async () => {
    const { servicio, repo } = montar(TIJUANA);
    await expect(
      servicio.listar('u1', {
        desde: '2026-10-20',
        hasta: '2026-10-20',
        sucursal: 'MX',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.listar).not.toHaveBeenCalled();
  });

  it('un rango de mas de un año, al reves o con un dia que no existe es 400 y no consulta', async () => {
    const { servicio, repo } = montar(GENERAL);
    for (const [desde, hasta] of [
      ['2025-01-01', '2026-10-20'],
      ['2026-10-20', '2026-10-01'],
      ['2026-02-30', '2026-03-01'],
    ]) {
      await expect(
        servicio.listar('u1', { desde, hasta }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(repo.listar).not.toHaveBeenCalled();
  });

  it('un vendedor o un campo que no son uuid es 400 con su mensaje', async () => {
    const { servicio } = montar(GENERAL);
    await expect(
      servicio.listar('u1', {
        desde: '2026-10-20',
        hasta: '2026-10-20',
        vendedor: 'oficina',
      }),
    ).rejects.toThrow('El vendedor no es válido.');
    await expect(
      servicio.listar('u1', {
        desde: '2026-10-20',
        hasta: '2026-10-20',
        campo: 'hielo',
      }),
    ).rejects.toThrow('El campo no es válido.');
  });

  it('un usuario que ya no existe es 401', async () => {
    const { servicio } = montar(undefined);
    await expect(
      servicio.listar('u1', { desde: '2026-10-20', hasta: '2026-10-20' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('GastosService.rutaFoto (T-30/T-31, D10)', () => {
  it('busca la foto con el alcance del usuario y resuelve la ruta en disco', async () => {
    const { servicio, repo, fotos } = montar(TIJUANA);
    await expect(servicio.rutaFoto('u1', GASTO)).resolves.toBe(
      `/fotos/gasto-${GASTO}.jpg`,
    );
    expect(repo.fotoEnAlcance).toHaveBeenCalledWith(GASTO, 'TJ');
    expect(fotos.rutaDeArchivo).toHaveBeenCalledWith(
      `gasto-${GASTO}.jpg`,
      'Ese gasto no tiene foto.',
    );
  });

  it('un General busca sin filtro de sucursal', async () => {
    const { servicio, repo } = montar(GENERAL);
    await servicio.rutaFoto('u1', GASTO);
    expect(repo.fotoEnAlcance).toHaveBeenCalledWith(GASTO, null);
  });

  it('sin foto, de otra sucursal o inexistente es 404', async () => {
    const { servicio, repo, fotos } = montar(TIJUANA);
    repo.fotoEnAlcance.mockResolvedValue(null);
    await expect(servicio.rutaFoto('u1', GASTO)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fotos.rutaDeArchivo).not.toHaveBeenCalled();
  });
});
```

- [ ] **Paso 2: correr y ver fallar**

`npm test --workspace=apps/backend -- gastos-consulta` → falla al compilar/ejecutar: `GastoListado` no existe y
`GastosService` no tiene `listar` ni `rutaFoto`.

- [ ] **Paso 3: el DTO**

`apps/backend/src/modules/compras-egresos/dto/listar-gastos.dto.ts`:

```ts
import { IsOptional, IsString, Matches } from 'class-validator';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /gastos` (T-30/T-31, D10). El formato lo valida aqui; que el dia exista,
 * el orden y el tope de un año, `validarRango` (reglas-kilometraje.ts), como el
 * Reporte de Ventas. Vendedor y campo (uuid) los valida el servicio.
 */
export class ListarGastosDto {
  @Matches(RE_FECHA, {
    message: 'La fecha "desde" debe tener el formato AAAA-MM-DD.',
  })
  desde!: string;

  @Matches(RE_FECHA, {
    message: 'La fecha "hasta" debe tener el formato AAAA-MM-DD.',
  })
  hasta!: string;

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;

  /** Id del vendedor. */
  @IsOptional()
  @IsString()
  vendedor?: string;

  /** Id del campo de egreso. */
  @IsOptional()
  @IsString()
  campo?: string;
}
```

- [ ] **Paso 4: el repositorio**

En `apps/backend/src/modules/compras-egresos/gastos.repository.ts`:

1. Imports nuevos (junto a los que ya tiene; `sql` puede ya venir de `kysely`):

```ts
import { sql } from 'kysely';
import { aCentavos } from '../sincronizacion/dinero';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type { TipoEgreso } from './tipos-egreso';
```

2. Tipos exportados, antes de la clase:

```ts
/** Filtros de `GET /gastos`, ya validados por el servicio. */
export interface FiltroGastos {
  desde: string;
  hasta: string;
  /** `null` = todas las sucursales (usuario General sin filtro). */
  codigoSucursal: string | null;
  vendedorId: string | null;
  campoEgresoId: string | null;
}

/** Un gasto tal como lo ve el portal (camelCase, como el resto de los reportes). */
export interface GastoListado {
  id: string;
  /** `AAAA-MM-DD`: el dia al que cuenta (la `fecha_operacion` del sobre). */
  fecha: string;
  /** ISO: cuando lo grabo el vendedor. La hora de la tabla sale de aqui. */
  registradoEn: string;
  sucursalCodigo: string;
  vendedorId: string | null;
  vendedorNombre: string | null;
  campoEgresoId: string;
  /** La copia del nombre al proyectar (D4), aunque el campo se renombre despues. */
  campoNombre: string;
  tipo: TipoEgreso;
  montoCentavos: number;
  comentario: string | null;
  tieneFoto: boolean;
}
```

3. Métodos nuevos dentro de `GastosRepository`:

```ts
  buscarSucursalUsuario(usuarioId: string) {
    return buscarSucursalUsuario(this.db, usuarioId);
  }

  /**
   * Los gastos vivos del rango para el portal (D10). La sucursal es la del
   * GASTO (la del vendedor al proyectar), no la actual del vendedor.
   */
  async listar(f: FiltroGastos): Promise<GastoListado[]> {
    const condiciones = [
      sql`g.deleted_at is null`,
      sql`g.fecha between ${f.desde}::date and ${f.hasta}::date`,
    ];
    if (f.codigoSucursal !== null)
      condiciones.push(sql`s.codigo = ${f.codigoSucursal}`);
    if (f.vendedorId !== null)
      condiciones.push(sql`g.vendedor_id = ${f.vendedorId}::uuid`);
    if (f.campoEgresoId !== null)
      condiciones.push(sql`g.campo_egreso_id = ${f.campoEgresoId}::uuid`);

    const filas = await sql<{
      id: string;
      fecha: string;
      registrado_en: Date;
      codigo: string;
      vendedor_id: string | null;
      vendedor_nombre: string | null;
      campo_egreso_id: string;
      campo_nombre: string;
      tipo: string;
      monto: string;
      comentario: string | null;
      tiene_foto: boolean;
    }>`
      select g.id, to_char(g.fecha, 'YYYY-MM-DD') as fecha, g.registrado_en,
             s.codigo, g.vendedor_id,
             coalesce(v.nombre, g.quien) as vendedor_nombre,
             g.campo_egreso_id, g.campo_nombre, g.tipo,
             g.monto::text as monto, g.comentario,
             (g.foto_archivo is not null) as tiene_foto
        from gasto g
        join sucursal s on s.id = g.sucursal_id
        left join vendedor v on v.id = g.vendedor_id
       where ${sql.join(condiciones, sql` and `)}
       order by g.fecha, g.registrado_en, g.id
    `.execute(this.db);

    return filas.rows.map((r) => ({
      id: r.id,
      fecha: r.fecha,
      registradoEn: new Date(r.registrado_en).toISOString(),
      sucursalCodigo: r.codigo,
      vendedorId: r.vendedor_id,
      vendedorNombre: r.vendedor_nombre,
      campoEgresoId: r.campo_egreso_id,
      campoNombre: r.campo_nombre,
      // El check `ck_gasto_tipo` garantiza uno de los tres.
      tipo: r.tipo as TipoEgreso,
      montoCentavos: aCentavos(r.monto),
      comentario: r.comentario,
      tieneFoto: r.tiene_foto,
    }));
  }

  /**
   * El archivo de la foto del gasto si esta vivo, tiene foto y es de la
   * sucursal (`null` = General, cualquiera). `null` en todo lo demas: el
   * servicio lo vuelve un 404 sin decir cual de los casos fue.
   */
  async fotoEnAlcance(
    id: string,
    codigoSucursal: string | null,
  ): Promise<string | null> {
    let q = this.db
      .selectFrom('gasto as g')
      .innerJoin('sucursal as s', 's.id', 'g.sucursal_id')
      .select('g.foto_archivo')
      .where('g.id', '=', id)
      .where('g.deleted_at', 'is', null)
      .where('g.foto_archivo', 'is not', null);
    if (codigoSucursal !== null) q = q.where('s.codigo', '=', codigoSucursal);
    const fila = await q.executeTakeFirst();
    return fila?.foto_archivo ?? null;
  }
```

- [ ] **Paso 5: `FotosService.rutaDeArchivo`**

En `apps/backend/src/modules/cartera-clientes/fotos.service.ts`, reemplaza el método privado `rutaLegible` por:

```ts
  /** La ruta absoluta del archivo del cliente, o 404 si la columna apunta a algo que ya no esta en disco. */
  private rutaLegible(archivo: string, clienteId: string): Promise<string> {
    void clienteId; // el nombre del archivo ya lleva el id; el aviso del log lo muestra
    return this.rutaDeArchivo(archivo, 'Ese cliente no tiene foto.');
  }

  /**
   * La ruta absoluta de un archivo del disco de fotos, o 404 con `mensaje404`
   * si la columna apunta a algo que ya no esta.
   *
   * Publico desde T-30/T-31: la foto del ticket de un gasto vive en el mismo
   * disco (`gasto-<id>.jpg`) y su alcance lo decide Compras y Egresos, no este
   * modulo; aqui solo se resuelve el directorio y se comprueba que se pueda leer.
   */
  async rutaDeArchivo(archivo: string, mensaje404: string): Promise<string> {
    const ruta = join(this.directorio, archivo);
    try {
      await fs.access(ruta, FS.R_OK);
    } catch {
      // La columna dice que hay foto y el archivo no esta: el volumen se
      // reemplazo o se perdio. Un 404 es la verdad para quien pregunta, pero en
      // el log va como aviso porque significa que el disco y la base no
      // coinciden — exactamente lo que el respaldo pendiente del volumen
      // (`Despliegue y topologia`) predice.
      this.logger.warn(
        `foto_archivo apunta a ${ruta}, que no esta en el disco`,
      );
      throw new NotFoundException(mensaje404);
    }
    return ruta;
  }
```

Si el lint marca `void clienteId` como innecesario, quita el parámetro `clienteId` de `rutaLegible` y de sus dos
llamadas (`rutaParaPortal` y `rutaParaVendedor`): el nombre del archivo ya incluye el id, y el aviso lo muestra.

- [ ] **Paso 6: el servicio**

En `apps/backend/src/modules/compras-egresos/gastos.service.ts`:

1. Imports nuevos:

```ts
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { FotosService } from '../cartera-clientes/fotos.service';
import { validarRango } from '../estadisticas/reglas-kilometraje';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import type { ListarGastosDto } from './dto/listar-gastos.dto';
import type { GastoListado } from './gastos.repository';
```

(junta `Injectable` con los de `@nestjs/common` que ya importa el archivo).

2. Tipo de respuesta y helper, antes de la clase:

```ts
/** La respuesta de `GET /gastos` (D10). */
export interface ListaGastos {
  desde: string;
  hasta: string;
  gastos: GastoListado[];
  totalCentavos: number;
}

const SIN_FOTO = 'Ese gasto no tiene foto.';

/** `undefined`/vacio = sin filtro; un uuid en minusculas; otra cosa, 400. */
function filtroId(crudo: string | undefined, mensaje: string): string | null {
  const valor = crudo?.trim();
  if (!valor) return null;
  if (!isUUID(valor)) throw new BadRequestException(mensaje);
  return valor.toLowerCase();
}
```

3. El constructor gana `FotosService`:

```ts
  constructor(
    private readonly repo: GastosRepository,
    // T-30/T-31 (D10): la foto del ticket vive en el disco de fotos de Cartera.
    private readonly fotos: FotosService,
  ) {}
```

Si `gastos.service.spec.ts` (Tarea 3) construye `new GastosService(repo as never)`, cámbialo a
`new GastosService(repo as never, {} as never)`.

4. Métodos nuevos dentro de la clase:

```ts
  /**
   * `GET /gastos` (D10): los gastos vivos del rango, con el alcance de sucursal
   * del usuario. Valida antes de consultar: un rango malo no llega a la base.
   */
  async listar(usuarioId: string, q: ListarGastosDto): Promise<ListaGastos> {
    const error = validarRango(q.desde, q.hasta);
    if (error) throw new BadRequestException(error);
    const vendedorId = filtroId(q.vendedor, 'El vendedor no es válido.');
    const campoEgresoId = filtroId(q.campo, 'El campo no es válido.');
    const codigoSucursal = await this.codigoEnAlcance(usuarioId, q.sucursal);

    const gastos = await this.repo.listar({
      desde: q.desde,
      hasta: q.hasta,
      codigoSucursal,
      vendedorId,
      campoEgresoId,
    });
    const totalCentavos = gastos.reduce((s, g) => s + g.montoCentavos, 0);
    return { desde: q.desde, hasta: q.hasta, gastos, totalCentavos };
  }

  /**
   * `GET /gastos/:id/foto` (D10): la ruta del ticket si el gasto es de una
   * sucursal en alcance. Otra sucursal es 404, no 403: no confirma que exista.
   */
  async rutaFoto(usuarioId: string, id: string): Promise<string> {
    const codigoSucursal = await this.codigoEnAlcance(usuarioId, undefined);
    const archivo = await this.repo.fotoEnAlcance(id, codigoSucursal);
    if (archivo === null) throw new NotFoundException(SIN_FOTO);
    return this.fotos.rutaDeArchivo(archivo, SIN_FOTO);
  }

  /** `null` = todas; si no, el codigo de la unica sucursal visible. */
  private async codigoEnAlcance(
    usuarioId: string,
    sucursalPedida: string | undefined,
  ): Promise<string | null> {
    // El guard valido la firma del token, no que el usuario siga existiendo.
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(sucursalPedida),
    );
    return alcance.tipo === 'una' ? alcance.codigo : null;
  }
```

- [ ] **Paso 7: correr la unitaria y ver pasar**

`npm test --workspace=apps/backend -- gastos` → `gastos-consulta.service.spec.ts` en verde, y las pruebas de la
Tarea 3 siguen en verde.

- [ ] **Paso 8: el controller y el módulo**

`apps/backend/src/modules/compras-egresos/gastos.controller.ts`:

```ts
import { createReadStream } from 'node:fs';
import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { ListarGastosDto } from './dto/listar-gastos.dto';
import { GastosService, type ListaGastos } from './gastos.service';

// T-30/T-31 (D10). Finanzas › Gastos del portal: solo consulta. Capturar,
// editar y borrar compras de oficina es el siguiente ticket (el resto de T-31).
@Controller('gastos')
export class GastosController {
  constructor(private readonly gastos: GastosService) {}

  @Get()
  @RequierePermiso('gasto.ver')
  listar(
    @UsuarioActual() usuarioId: string,
    @Query() q: ListarGastosDto,
  ): Promise<ListaGastos> {
    return this.gastos.listar(usuarioId, q);
  }

  /**
   * La foto del ticket (opcional). Mismo patron que `GET /clientes/:id/foto`:
   * archivo privado, cache corto y no compartido; `rutaFoto` ya comprobo que el
   * archivo se puede leer, asi que el stream no falla a media respuesta.
   */
  @Get(':id/foto')
  @RequierePermiso('gasto.ver')
  @Header('Cache-Control', 'private, max-age=300')
  async foto(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const ruta = await this.gastos.rutaFoto(usuarioId, id.toLowerCase());
    return new StreamableFile(createReadStream(ruta), { type: 'image/jpeg' });
  }
}
```

`apps/backend/src/modules/compras-egresos/compras-egresos.module.ts` queda así (conserva los nombres que dejó la
Tarea 2 si difieren; lo nuevo es `CarteraClientesModule` en `imports` y `GastosController` en `controllers`):

```ts
import { Module } from '@nestjs/common';
import { CarteraClientesModule } from '../cartera-clientes/cartera-clientes.module';
import { CamposEgresoController } from './campos-egreso.controller';
import { CamposEgresoRepository } from './campos-egreso.repository';
import { CamposEgresoService } from './campos-egreso.service';
import { GastosController } from './gastos.controller';
import { GastosRepository } from './gastos.repository';
import { GastosService } from './gastos.service';

// T-30: el catalogo de campos de egreso. T-30/T-31: la tabla `gasto`; exporta
// `GastosService` para que sincronizacion/ proyecte el `tipo: 'gasto'` y suba la
// foto del ticket (ADR-0009). Importa Cartera de Clientes por `FotosService`: la
// foto del ticket vive en el mismo disco que la del cliente.
@Module({
  imports: [CarteraClientesModule],
  controllers: [CamposEgresoController, GastosController],
  providers: [
    CamposEgresoService,
    CamposEgresoRepository,
    GastosService,
    GastosRepository,
  ],
  exports: [GastosService],
})
export class ComprasEgresosModule {}
```

`npm run build --workspace=apps/backend` → sin errores.

- [ ] **Paso 9: el e2e**

`apps/backend/test/gastos-portal.e2e-spec.ts`:

```ts
// PRIMER import, a proposito: pone FOTOS_DIR antes de que `app.module.ts` lea la configuracion.
import { FOTOS_DIR_PRUEBA } from './apoyo-fotos-dir';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
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

/**
 * T-30/T-31 (D10): Finanzas › Gastos. Fechas de febrero de 2016 a proposito:
 * ninguna otra suite siembra gastos ahi, asi que el total se puede afirmar
 * exacto.
 */
interface Lista {
  desde: string;
  hasta: string;
  totalCentavos: number;
  gastos: {
    id: string;
    fecha: string;
    registradoEn: string;
    sucursalCodigo: string;
    vendedorId: string | null;
    vendedorNombre: string | null;
    campoEgresoId: string;
    campoNombre: string;
    tipo: string;
    montoCentavos: number;
    comentario: string | null;
    tieneFoto: boolean;
  }[];
}

const SUFIJO = `${Date.now()}-${process.pid}`;
const PREFIJO = `ZZ-e2e-gpor-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const RANGO = 'desde=2016-02-01&hasta=2016-02-29';

describe('Gastos — consulta del portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  let general: string;
  let tijuana: string;
  let sinPermiso: string;
  let soloVer: string;
  let vendedorTj: string;
  let vendedorMx: string;
  let campoA: string;
  let campoB: string;
  let gastoTjConFoto: string;
  let gastoTjSinFoto: string;
  let gastoMxConFoto: string;

  const http = () => request(app.getHttpServer());

  const iniciarSesion = async (login: string): Promise<string> => {
    const res = await http()
      .post('/auth/login')
      .send({ login, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const acceso = cookies.find((c) => c.startsWith('jawa_access='));
    if (!acceso) throw new Error('El login no devolvio cookie de acceso.');
    return acceso.split(';')[0];
  };

  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ): Promise<string> => {
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
        password_hash: await app.get(PasswordService).hashear(PASSWORD),
        perfil_id: perfilId,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    usuarioIds.push(id);
    return id;
  };

  const sembrarGasto = async (g: {
    vendedorId: string;
    sucursalId: string;
    campoId: string;
    campoNombre: string;
    fecha: string;
    registradoEn: string;
    monto: string;
    comentario?: string;
  }): Promise<string> => {
    const id = randomUUID();
    await db
      .insertInto('gasto')
      .values({
        id,
        sucursal_id: g.sucursalId,
        vendedor_id: g.vendedorId,
        campo_egreso_id: g.campoId,
        campo_nombre: g.campoNombre,
        tipo: 'operacion',
        fecha: g.fecha,
        registrado_en: g.registradoEn,
        monto: g.monto,
        metodo: 'efectivo_cobranza_dia',
        origen: 'app',
        comentario: g.comentario ?? null,
      })
      .execute();
    return id;
  };

  /** El archivo en disco y las dos columnas, como lo deja el canal de fotos. */
  const ponerFoto = async (id: string, bytes: Buffer) => {
    const archivo = `gasto-${id}.jpg`;
    await fs.writeFile(join(FOTOS_DIR_PRUEBA, archivo), bytes);
    await db
      .updateTable('gasto')
      .set({ foto_archivo: archivo, foto_subida_en: new Date() })
      .where('id', '=', id)
      .execute();
  };

  const bajarFoto = (id: string, cookie: string) =>
    http()
      .get(`/gastos/${id}/foto`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((res, fin) => {
        const partes: Buffer[] = [];
        res.on('data', (p: Buffer) => partes.push(p));
        res.on('end', () => fin(null, Buffer.concat(partes)));
      });

  const listar = async (query: string, cookie = general) =>
    (await http().get(`/gastos?${query}`).set('Cookie', cookie).expect(200))
      .body as Lista;

  const JPEG = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from('ticket de gasolina', 'utf8'),
    Buffer.from([0xff, 0xd9]),
  ]);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    const idTijuana = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;
    const idMexicali = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'MX')
        .executeTakeFirstOrThrow()
    ).id;

    await crearUsuario(`e2e-gpor-gen-${SUFIJO}`, 'Administrador General', null);
    await crearUsuario(
      `e2e-gpor-tj-${SUFIJO}`,
      'Administrador General',
      idTijuana,
    );
    await crearUsuario(
      `e2e-gpor-sin-${SUFIJO}`,
      'Auxiliar Administrativo',
      null,
    );
    const idSoloVer = await crearUsuario(
      `e2e-gpor-ver-${SUFIJO}`,
      'Auxiliar Administrativo',
      null,
    );
    const { id: permisoVer } = await db
      .selectFrom('permiso')
      .select('id')
      .where('clave', '=', 'gasto.ver')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('usuario_permiso')
      .values({ usuario_id: idSoloVer, permiso_id: permisoVer, habilitado: true })
      .execute();

    general = await iniciarSesion(`e2e-gpor-gen-${SUFIJO}`);
    tijuana = await iniciarSesion(`e2e-gpor-tj-${SUFIJO}`);
    sinPermiso = await iniciarSesion(`e2e-gpor-sin-${SUFIJO}`);
    soloVer = await iniciarSesion(`e2e-gpor-ver-${SUFIJO}`);

    const hash = await app.get(PasswordService).hashear(PASSWORD);
    vendedorTj = (
      await db
        .insertInto('vendedor')
        .values({
          login: `e2e-gpor-vtj-${SUFIJO}`,
          nombre: `${PREFIJO} Vendedor TJ`,
          password_hash: hash,
          sucursal_id: idTijuana,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    vendedorMx = (
      await db
        .insertInto('vendedor')
        .values({
          login: `e2e-gpor-vmx-${SUFIJO}`,
          nombre: `${PREFIJO} Vendedor MX`,
          password_hash: hash,
          sucursal_id: idMexicali,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    campoA = (
      await db
        .insertInto('campo_egreso')
        .values({ nombre: `${PREFIJO} Gasolina`, tipo: 'operacion', se_usa_en_app: true })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    campoB = (
      await db
        .insertInto('campo_egreso')
        .values({ nombre: `${PREFIJO} Hielo`, tipo: 'operacion', se_usa_en_app: true })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    gastoTjConFoto = await sembrarGasto({
      vendedorId: vendedorTj,
      sucursalId: idTijuana,
      campoId: campoA,
      campoNombre: `${PREFIJO} Gasolina`,
      fecha: '2016-02-03',
      registradoEn: '2016-02-03T17:00:00.000Z',
      monto: '100.00',
      comentario: 'Tanque lleno',
    });
    gastoMxConFoto = await sembrarGasto({
      vendedorId: vendedorMx,
      sucursalId: idMexicali,
      campoId: campoA,
      campoNombre: `${PREFIJO} Gasolina`,
      fecha: '2016-02-03',
      registradoEn: '2016-02-03T18:00:00.000Z',
      monto: '30.00',
    });
    gastoTjSinFoto = await sembrarGasto({
      vendedorId: vendedorTj,
      sucursalId: idTijuana,
      campoId: campoB,
      campoNombre: `${PREFIJO} Hielo`,
      fecha: '2016-02-04',
      registradoEn: '2016-02-04T16:00:00.000Z',
      monto: '50.25',
    });
    const borrado = await sembrarGasto({
      vendedorId: vendedorTj,
      sucursalId: idTijuana,
      campoId: campoA,
      campoNombre: `${PREFIJO} Gasolina`,
      fecha: '2016-02-03',
      registradoEn: '2016-02-03T19:00:00.000Z',
      monto: '999.00',
    });
    await db
      .updateTable('gasto')
      .set({ deleted_at: new Date() })
      .where('id', '=', borrado)
      .execute();
    // Fuera del rango.
    await sembrarGasto({
      vendedorId: vendedorTj,
      sucursalId: idTijuana,
      campoId: campoA,
      campoNombre: `${PREFIJO} Gasolina`,
      fecha: '2016-03-01',
      registradoEn: '2016-03-01T17:00:00.000Z',
      monto: '7.00',
    });

    await ponerFoto(gastoTjConFoto, JPEG);
    await ponerFoto(gastoMxConFoto, JPEG);
  });

  afterAll(async () => {
    // Orden inverso a las llaves foraneas.
    await db
      .deleteFrom('gasto')
      .where('vendedor_id', 'in', [vendedorTj, vendedorMx])
      .execute();
    await db
      .deleteFrom('campo_egreso')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db
      .deleteFrom('vendedor')
      .where('id', 'in', [vendedorTj, vendedorMx])
      .execute();
    if (usuarioIds.length > 0) {
      await db
        .deleteFrom('usuario_permiso')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db
        .deleteFrom('sesion_refresh')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await app.close();
    await fs.rm(FOTOS_DIR_PRUEBA, { recursive: true, force: true });
  });

  describe('GET /gastos', () => {
    it('un General ve los vivos del rango de todas las sucursales, en orden, con el total', async () => {
      const r = await listar(RANGO);
      expect(r.gastos.map((g) => g.id)).toEqual([
        gastoTjConFoto,
        gastoMxConFoto,
        gastoTjSinFoto,
      ]);
      expect(r.totalCentavos).toBe(18_025);
      expect(r.gastos[0]).toEqual({
        id: gastoTjConFoto,
        fecha: '2016-02-03',
        registradoEn: '2016-02-03T17:00:00.000Z',
        sucursalCodigo: 'TJ',
        vendedorId: vendedorTj,
        vendedorNombre: `${PREFIJO} Vendedor TJ`,
        campoEgresoId: campoA,
        campoNombre: `${PREFIJO} Gasolina`,
        tipo: 'operacion',
        montoCentavos: 10_000,
        comentario: 'Tanque lleno',
        tieneFoto: true,
      });
      expect(r.gastos[2]).toMatchObject({ tieneFoto: false, comentario: null });
    });

    it('filtra por sucursal, por vendedor y por campo', async () => {
      const tj = await listar(`${RANGO}&sucursal=TJ`);
      expect(tj.gastos.map((g) => g.id)).toEqual([
        gastoTjConFoto,
        gastoTjSinFoto,
      ]);
      expect(tj.totalCentavos).toBe(15_025);

      const mx = await listar(`${RANGO}&vendedor=${vendedorMx}`);
      expect(mx.gastos.map((g) => g.id)).toEqual([gastoMxConFoto]);

      const hielo = await listar(`${RANGO}&campo=${campoB}`);
      expect(hielo.gastos.map((g) => g.id)).toEqual([gastoTjSinFoto]);
      expect(hielo.totalCentavos).toBe(5_025);
    });

    it('un usuario atado a TJ ve solo TJ y pedir MX es 403', async () => {
      const r = await listar(RANGO, tijuana);
      expect(r.gastos.every((g) => g.sucursalCodigo === 'TJ')).toBe(true);
      expect(r.totalCentavos).toBe(15_025);
      await http()
        .get(`/gastos?${RANGO}&sucursal=MX`)
        .set('Cookie', tijuana)
        .expect(403);
    });

    it('un rango de mas de 366 dias, un formato malo o un vendedor que no es uuid es 400', async () => {
      await http()
        .get('/gastos?desde=2015-01-01&hasta=2016-02-29')
        .set('Cookie', general)
        .expect(400);
      await http()
        .get('/gastos?desde=01/02/2016&hasta=2016-02-29')
        .set('Cookie', general)
        .expect(400);
      const res = await http()
        .get(`/gastos?${RANGO}&vendedor=oficina`)
        .set('Cookie', general)
        .expect(400);
      expect((res.body as { message: string }).message).toBe(
        'El vendedor no es válido.',
      );
    });

    it('sin gasto.ver es 403; con solo ese permiso entra', async () => {
      await http().get(`/gastos?${RANGO}`).set('Cookie', sinPermiso).expect(403);
      const r = await listar(RANGO, soloVer);
      expect(r.totalCentavos).toBe(18_025);
    });

    it('sin sesion es 401', async () => {
      await http().get(`/gastos?${RANGO}`).expect(401);
    });
  });

  describe('GET /gastos/:id/foto', () => {
    it('sirve el JPEG del ticket con cache privado', async () => {
      const res = await bajarFoto(gastoTjConFoto, general).expect(200);
      expect(res.headers['content-type']).toMatch(/image\/jpeg/);
      expect(res.headers['cache-control']).toBe('private, max-age=300');
      expect(res.body).toEqual(JPEG);
    });

    it('la foto de un gasto de otra sucursal es 404, no 403', async () => {
      await bajarFoto(gastoMxConFoto, tijuana).expect(404);
      await bajarFoto(gastoTjConFoto, tijuana).expect(200);
    });

    it('un gasto sin foto o que no existe es 404', async () => {
      await bajarFoto(gastoTjSinFoto, general).expect(404);
      await bajarFoto(randomUUID(), general).expect(404);
    });

    it('sin gasto.ver es 403', async () => {
      await bajarFoto(gastoTjConFoto, sinPermiso).expect(403);
    });
  });
});
```

- [ ] **Paso 10: correr el e2e y ver pasar**

```bash
npm run test:e2e --workspace=apps/backend -- gastos-portal
npm run test:e2e --workspace=apps/backend -- clientes visita
```

El primero en verde. El segundo confirma que la foto del cliente (portal y tablet) sigue igual tras mover
`rutaLegible` a `rutaDeArchivo`.

- [ ] **Paso 11: lint, build y commit**

```bash
npm exec --workspace=apps/backend -- prettier --write src/modules/compras-egresos/dto/listar-gastos.dto.ts src/modules/compras-egresos/gastos.repository.ts src/modules/compras-egresos/gastos.service.ts src/modules/compras-egresos/gastos.controller.ts src/modules/compras-egresos/compras-egresos.module.ts src/modules/compras-egresos/gastos-consulta.service.spec.ts src/modules/compras-egresos/gastos.service.spec.ts src/modules/cartera-clientes/fotos.service.ts test/gastos-portal.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/compras-egresos/dto/listar-gastos.dto.ts src/modules/compras-egresos/gastos.repository.ts src/modules/compras-egresos/gastos.service.ts src/modules/compras-egresos/gastos.controller.ts src/modules/compras-egresos/compras-egresos.module.ts src/modules/compras-egresos/gastos-consulta.service.spec.ts src/modules/compras-egresos/gastos.service.spec.ts src/modules/cartera-clientes/fotos.service.ts test/gastos-portal.e2e-spec.ts
npm run build --workspace=apps/backend
npm test --workspace=apps/backend -- gastos fotos
git add apps/backend/src/modules/compras-egresos/dto/listar-gastos.dto.ts apps/backend/src/modules/compras-egresos/gastos.repository.ts apps/backend/src/modules/compras-egresos/gastos.service.ts apps/backend/src/modules/compras-egresos/gastos.controller.ts apps/backend/src/modules/compras-egresos/compras-egresos.module.ts apps/backend/src/modules/compras-egresos/gastos-consulta.service.spec.ts apps/backend/src/modules/compras-egresos/gastos.service.spec.ts apps/backend/src/modules/cartera-clientes/fotos.service.ts apps/backend/test/gastos-portal.e2e-spec.ts
git commit -m "T-30/T-31: GET /gastos y la foto del ticket para Finanzas › Gastos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Si `gastos.service.spec.ts` no cambió en el Paso 6, `git add` lo ignora sin error; si no existe con ese nombre,
quítalo de las tres listas.)

---

### Tarea 7: Portal: Catálogo › Campos de egreso (D3)

**Files:**
- Create: `apps/portal/src/lib/campos-egreso.ts`
- Create: `apps/portal/src/components/campos-egreso/formulario-campo-egreso.tsx`
- Create: `apps/portal/src/components/campos-egreso/pantalla-campos-egreso.tsx`
- Create: `apps/portal/src/components/campos-egreso/pantalla-campos-egreso.test.tsx`
- Create: `apps/portal/src/app/(portal)/catalogo/campos-de-egreso/page.tsx`
- Modify: `apps/portal/src/components/layout/nav-config.ts` (sección "Catálogo", después de "Motivos de visita")
- Modify: `apps/portal/src/components/usuarios/matriz-permisos-usuario.tsx` (`EXPLICACION_PERMISO`)

**Interfaces:**
- Consumes (Tarea 2): `GET /campos-egreso` (solo sesión) → `CampoEgreso[]` vivos ordenados por nombre;
  `POST /campos-egreso` y `PATCH /campos-egreso/:id` con `{ nombre, tipo, seUsaEnApp }` → `CampoEgreso`;
  `DELETE /campos-egreso/:id` → `{ id }`; los tres con `campo_egreso.gestionar`. 409 con el mensaje en español
  (`Ya existe un campo de egreso llamado "…".` o `Este campo tiene gastos este año; podrás darlo de baja el próximo
  año.`). `CampoEgreso = { id: string; nombre: string; tipo: 'produccion' | 'operacion' | 'financiero'; seUsaEnApp:
  boolean }`.
- Produces (la Tarea 8 lo usa): `apps/portal/src/lib/campos-egreso.ts` exporta `PERMISO_CAMPOS_EGRESO`,
  `TipoEgreso`, `TIPOS_EGRESO`, `ETIQUETA_TIPO_EGRESO: Record<TipoEgreso, string>`, `CampoEgreso`,
  `DatosCampoEgreso`, `listarCamposEgreso()`, `crearCampoEgreso(datos)`, `editarCampoEgreso(id, datos)`,
  `eliminarCampoEgreso(id)`. Componente `PantallaCamposEgreso`. Ruta `/catalogo/campos-de-egreso`.

> Mismo patrón que Catálogo › Motivos de visita (T-39): `useCatalogo` + `TablaCatalogo` + `useEnvioFormulario`, baja
> con `window.confirm` y el error de la acción en un `role="alert"`. Las pruebas siguen el patrón de T-65: se mockea
> la capa de red (`@/lib/campos-egreso`) y `useAuth`, nunca `fetch`.

- [ ] **Paso 1: la prueba de pantalla que falla**

`apps/portal/src/components/campos-egreso/pantalla-campos-egreso.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as lib from "@/lib/campos-egreso";
import { PantallaCamposEgreso } from "./pantalla-campos-egreso";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/campos-egreso", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/campos-egreso")>();
  return {
    ...real,
    listarCamposEgreso: vi.fn(),
    crearCampoEgreso: vi.fn(),
    editarCampoEgreso: vi.fn(),
    eliminarCampoEgreso: vi.fn(),
  };
});

const CAMPOS: lib.CampoEgreso[] = [
  { id: "c1", nombre: "Gasolina", tipo: "operacion", seUsaEnApp: true },
  { id: "c2", nombre: "Envases", tipo: "produccion", seUsaEnApp: false },
];

function sesion(puede: boolean) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: { sucursal: null, permisos: puede ? [lib.PERMISO_CAMPOS_EGRESO] : [] } as never,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: () => puede,
  });
}

describe("PantallaCamposEgreso", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lib.listarCamposEgreso).mockResolvedValue(CAMPOS);
  });

  it("lista nombre, tipo con su etiqueta y la casilla en Sí/No; con permiso, Editar y Eliminar", async () => {
    sesion(true);
    render(<PantallaCamposEgreso />);
    const tabla = (await screen.findByText("Gasolina")).closest("table")!;
    expect(within(tabla).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(
      expect.arrayContaining(["Nombre", "Tipo", "Se usa en la app"]),
    );
    const gasolina = within(tabla).getByText("Gasolina").closest("tr")!;
    expect(within(gasolina).getAllByRole("cell").map((c) => c.textContent)).toEqual(
      expect.arrayContaining(["Gasolina", "Operación", "Sí"]),
    );
    const envases = within(tabla).getByText("Envases").closest("tr")!;
    expect(within(envases).getAllByRole("cell").map((c) => c.textContent)).toEqual(
      expect.arrayContaining(["Envases", "Producción", "No"]),
    );
    expect(within(gasolina).getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(within(gasolina).getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo campo" })).toBeInTheDocument();
  });

  it("sin campo_egreso.gestionar solo se lee: sin alta ni botones por fila", async () => {
    sesion(false);
    render(<PantallaCamposEgreso />);
    const fila = (await screen.findByText("Gasolina")).closest("tr")!;
    expect(within(fila).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Nuevo campo" })).toBeNull();
  });

  it("el alta manda nombre, tipo y la casilla; el tipo arranca en Operación", async () => {
    sesion(true);
    vi.mocked(lib.crearCampoEgreso).mockResolvedValue({ id: "c3", nombre: "Renta", tipo: "financiero", seUsaEnApp: true });
    render(<PantallaCamposEgreso />);
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo campo" }));
    expect(screen.getByLabelText("Tipo")).toHaveValue("operacion");
    expect(within(screen.getByLabelText("Tipo")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Producción",
      "Operación",
      "Financiero",
    ]);
    await userEvent.type(screen.getByLabelText("Nombre del campo"), "Renta");
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "financiero");
    await userEvent.click(screen.getByLabelText("Se usa en la app"));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(lib.crearCampoEgreso).toHaveBeenCalledWith({ nombre: "Renta", tipo: "financiero", seUsaEnApp: true });
    await vi.waitFor(() => expect(lib.listarCamposEgreso).toHaveBeenCalledTimes(2));
  });

  it("editar precarga el campo y manda lo cambiado", async () => {
    sesion(true);
    vi.mocked(lib.editarCampoEgreso).mockResolvedValue({ ...CAMPOS[0], seUsaEnApp: false });
    render(<PantallaCamposEgreso />);
    const fila = (await screen.findByText("Gasolina")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Editar" }));
    expect(screen.getByLabelText("Nombre del campo")).toHaveValue("Gasolina");
    expect(screen.getByLabelText("Tipo")).toHaveValue("operacion");
    expect(screen.getByLabelText("Se usa en la app")).toBeChecked();
    await userEvent.click(screen.getByLabelText("Se usa en la app"));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(lib.editarCampoEgreso).toHaveBeenCalledWith("c1", { nombre: "Gasolina", tipo: "operacion", seUsaEnApp: false });
  });

  it("un nombre repetido muestra el mensaje del servidor (409)", async () => {
    sesion(true);
    vi.mocked(lib.crearCampoEgreso).mockRejectedValue(
      new ErrorApi("conflicto", 409, 'Ya existe un campo de egreso llamado "Gasolina".'),
    );
    render(<PantallaCamposEgreso />);
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo campo" }));
    await userEvent.type(screen.getByLabelText("Nombre del campo"), "gasolina");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('Ya existe un campo de egreso llamado "Gasolina".');
  });

  it("eliminar pide confirmación, da de baja y recarga", async () => {
    sesion(true);
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(lib.eliminarCampoEgreso).mockResolvedValue({ id: "c2" });
    render(<PantallaCamposEgreso />);
    const fila = (await screen.findByText("Envases")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Eliminar" }));
    expect(confirmar).toHaveBeenCalledWith(
      '¿Seguro que quieres eliminar el campo "Envases"? Los gastos ya registrados lo conservan, pero las tablets dejarán de ofrecerlo.',
    );
    expect(lib.eliminarCampoEgreso).toHaveBeenCalledWith("c2");
    expect(lib.listarCamposEgreso).toHaveBeenCalledTimes(2);
  });

  it("si el campo tiene gastos este año, la baja muestra el motivo del servidor (409) y no recarga", async () => {
    sesion(true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(lib.eliminarCampoEgreso).mockRejectedValue(
      new ErrorApi("conflicto", 409, "Este campo tiene gastos este año; podrás darlo de baja el próximo año."),
    );
    render(<PantallaCamposEgreso />);
    const fila = (await screen.findByText("Gasolina")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Eliminar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este campo tiene gastos este año; podrás darlo de baja el próximo año.",
    );
    expect(lib.listarCamposEgreso).toHaveBeenCalledTimes(1);
  });

  it("cancelar la confirmación no da de baja", async () => {
    sesion(true);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<PantallaCamposEgreso />);
    const fila = (await screen.findByText("Gasolina")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Eliminar" }));
    expect(lib.eliminarCampoEgreso).not.toHaveBeenCalled();
  });
});
```

- [ ] **Paso 2: correr y ver fallar**

`npm test --workspace=apps/portal -- pantalla-campos-egreso` → falla al resolver `@/lib/campos-egreso` y
`./pantalla-campos-egreso` (no existen).

- [ ] **Paso 3: la capa de red**

`apps/portal/src/lib/campos-egreso.ts`:

```ts
import { apiFetch } from "./api";

// Copia de `CampoEgreso` de apps/backend/src/modules/compras-egresos/campos-egreso.repository.ts
// (el portal no puede importar del backend). T-30, D2/D3.

export const PERMISO_CAMPOS_EGRESO = "campo_egreso.gestionar";

/** Los tres tipos fijos del cliente (D1): "ya deben de venir grabados". */
export const TIPOS_EGRESO = ["produccion", "operacion", "financiero"] as const;
export type TipoEgreso = (typeof TIPOS_EGRESO)[number];

export const ETIQUETA_TIPO_EGRESO: Record<TipoEgreso, string> = {
  produccion: "Producción",
  operacion: "Operación",
  financiero: "Financiero",
};

export interface CampoEgreso {
  id: string;
  nombre: string;
  tipo: TipoEgreso;
  /** El vendedor solo ve en la tablet los campos con esta casilla (respuesta 2 de Mario). */
  seUsaEnApp: boolean;
}

export type DatosCampoEgreso = Omit<CampoEgreso, "id">;

/** Solo los vivos: la baja lógica los saca de aquí (y del pull de la tablet). */
export function listarCamposEgreso(): Promise<CampoEgreso[]> {
  return apiFetch<CampoEgreso[]>("/campos-egreso");
}

export function crearCampoEgreso(datos: DatosCampoEgreso): Promise<CampoEgreso> {
  return apiFetch<CampoEgreso>("/campos-egreso", { method: "POST", body: JSON.stringify(datos) });
}

export function editarCampoEgreso(id: string, datos: DatosCampoEgreso): Promise<CampoEgreso> {
  return apiFetch<CampoEgreso>(`/campos-egreso/${id}`, { method: "PATCH", body: JSON.stringify(datos) });
}

/** 409 si el campo tiene gastos vivos en el año en curso (regla del cliente). */
export function eliminarCampoEgreso(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/campos-egreso/${id}`, { method: "DELETE" });
}
```

- [ ] **Paso 4: el formulario**

`apps/portal/src/components/campos-egreso/formulario-campo-egreso.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import {
  crearCampoEgreso,
  editarCampoEgreso,
  ETIQUETA_TIPO_EGRESO,
  TIPOS_EGRESO,
  type CampoEgreso,
  type TipoEgreso,
} from "@/lib/campos-egreso";

interface Props {
  campo: CampoEgreso | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

/** Alta y edición de un campo de egreso: nombre, tipo (de los tres fijos) y "Se usa en la app" (T-30, D3). */
export function FormularioCampoEgreso({ campo, alGuardar, alCancelar }: Props) {
  const [nombre, setNombre] = useState(campo?.nombre ?? "");
  // Siete de los ocho campos de la semilla son de Operación: es el valor más probable.
  const [tipo, setTipo] = useState<TipoEgreso>(campo?.tipo ?? "operacion");
  const [seUsaEnApp, setSeUsaEnApp] = useState(campo?.seUsaEnApp ?? false);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo guardar el campo.");

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = { nombre, tipo, seUsaEnApp };
    await enviar(() => (campo ? editarCampoEgreso(campo.id, datos) : crearCampoEgreso(datos)), alGuardar);
  }

  return (
    <form onSubmit={alEnviar} className="mb-6 flex flex-col gap-4 rounded-md border p-4">
      <h2 className="text-sm font-semibold">{campo ? `Editar ${campo.nombre}` : "Nuevo campo"}</h2>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="campo-egreso-nombre" className="text-sm font-medium">
          Nombre del campo
        </label>
        <input
          id="campo-egreso-nombre"
          required
          maxLength={80}
          disabled={enviando}
          placeholder="Gasolina, Hielo, Celular…"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="w-96 max-w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="campo-egreso-tipo" className="text-sm font-medium">
          Tipo
        </label>
        <select
          id="campo-egreso-tipo"
          disabled={enviando}
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TipoEgreso)}
          className="w-60 rounded-md border px-3 py-2 text-sm"
        >
          {TIPOS_EGRESO.map((t) => (
            <option key={t} value={t}>
              {ETIQUETA_TIPO_EGRESO[t]}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={seUsaEnApp}
          disabled={enviando}
          onChange={(e) => setSeUsaEnApp(e.target.checked)}
        />
        Se usa en la app
      </label>
      <p className="text-xs text-muted-foreground">
        El vendedor solo puede elegir en la tablet los campos con esta casilla. Si la cambias, los gastos ya capturados
        sin red suben igual. Cambiar el nombre o el tipo no toca los gastos ya registrados: guardan su copia.
      </p>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : "Guardar"}
        </Button>
        <Button type="button" variant="outline" disabled={enviando} onClick={alCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Paso 5: la pantalla y la página**

`apps/portal/src/components/campos-egreso/pantalla-campos-egreso.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { TablaCatalogo } from "@/components/catalogo/tabla-catalogo";
import { useCatalogo } from "@/components/catalogo/use-catalogo";
import { mensajeDe } from "@/lib/api";
import {
  eliminarCampoEgreso,
  ETIQUETA_TIPO_EGRESO,
  listarCamposEgreso,
  PERMISO_CAMPOS_EGRESO,
  type CampoEgreso,
} from "@/lib/campos-egreso";
import { FormularioCampoEgreso } from "./formulario-campo-egreso";

const siNo = (valor: boolean) => (valor ? "Sí" : "No");

/**
 * Catálogo › Campos de egreso (T-30, D3): en qué se gasta el dinero (gasolina, hielo, envases…). Leer pide
 * sesión; dar de alta, editar y dar de baja (lógica, con confirmación) pide `campo_egreso.gestionar`. Mismo
 * patrón que Motivos de visita (T-39). La baja la rechaza el servidor con 409 si el campo tiene gastos este
 * año; el motivo se muestra tal cual.
 */
export function PantallaCamposEgreso() {
  const { puede } = useAuth();
  const puedeGestionar = puede(PERMISO_CAMPOS_EGRESO);
  const catalogo = useCatalogo<CampoEgreso>(() => listarCamposEgreso(), {
    mensajeError: "No se pudieron cargar los campos de egreso.",
  });
  const [eliminando, setEliminando] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const ocupado = catalogo.edicion !== null || eliminando !== null;

  async function eliminar(c: CampoEgreso) {
    if (
      !window.confirm(
        `¿Seguro que quieres eliminar el campo "${c.nombre}"? Los gastos ya registrados lo conservan, pero las tablets dejarán de ofrecerlo.`,
      )
    )
      return;
    setEliminando(c.id);
    setErrorAccion(null);
    try {
      await eliminarCampoEgreso(c.id);
      void catalogo.recargar();
    } catch (err) {
      setErrorAccion(mensajeDe(err, "No se pudo eliminar el campo."));
    } finally {
      setEliminando(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Campos de egreso</CardTitle>
        {puedeGestionar && (
          <Button size="sm" disabled={ocupado} onClick={catalogo.abrirAlta}>
            Nuevo campo
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {catalogo.edicion !== null && (
          <div key={catalogo.edicion === "nueva" ? "nueva" : catalogo.edicion.id}>
            <FormularioCampoEgreso
              campo={catalogo.edicion === "nueva" ? null : catalogo.edicion}
              alGuardar={() => {
                catalogo.cerrar();
                void catalogo.recargar();
              }}
              alCancelar={catalogo.cerrar}
            />
          </div>
        )}

        {catalogo.cargando && <p className="text-muted-foreground">Cargando…</p>}
        {(catalogo.error || errorAccion) && (
          <p role="alert" className="text-sm text-destructive">
            {catalogo.error ?? errorAccion}
          </p>
        )}

        {!catalogo.cargando && !catalogo.error && (
          <TablaCatalogo
            items={catalogo.items}
            vacio="Todavía no hay campos de egreso. Da de alta el primero."
            columnas={[
              { encabezado: "Nombre", celda: (c) => c.nombre },
              { encabezado: "Tipo", celda: (c) => ETIQUETA_TIPO_EGRESO[c.tipo], className: "whitespace-nowrap" },
              { encabezado: "Se usa en la app", celda: (c) => siNo(c.seUsaEnApp), className: "whitespace-nowrap" },
            ]}
            acciones={
              puedeGestionar
                ? (c) => (
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" disabled={ocupado} onClick={() => catalogo.abrirEdicion(c)}>
                        Editar
                      </Button>
                      <Button variant="outline" size="sm" disabled={ocupado} onClick={() => void eliminar(c)}>
                        {eliminando === c.id ? "Eliminando…" : "Eliminar"}
                      </Button>
                    </div>
                  )
                : undefined
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
```

`apps/portal/src/app/(portal)/catalogo/campos-de-egreso/page.tsx`:

```tsx
import { PantallaCamposEgreso } from "@/components/campos-egreso/pantalla-campos-egreso";

// T-30 (D3). Catálogo global: no lee el filtro de sucursal.
export default function Page() {
  return <PantallaCamposEgreso />;
}
```

- [ ] **Paso 6: menú y explicación de los permisos**

En `apps/portal/src/components/layout/nav-config.ts`, sección "Catálogo":

```ts
      { label: "Motivos de visita", href: "/catalogo/motivos-de-visita" },
```

pasa a:

```ts
      { label: "Motivos de visita", href: "/catalogo/motivos-de-visita" },
      { label: "Campos de egreso", href: "/catalogo/campos-de-egreso" },
```

En `apps/portal/src/components/usuarios/matriz-permisos-usuario.tsx`, dentro de `EXPLICACION_PERMISO`, después de
la entrada `"motivo_visita.gestionar"`, agrega las dos claves de la migración (la de `gasto.ver` la usa la Tarea 8):

```ts
  "campo_egreso.gestionar":
    "Puede dar de alta, editar o dar de baja los campos de egreso (gasolina, hielo, envases…) y decidir cuáles usa el vendedor en la tablet.",
  "gasto.ver": "Puede consultar los gastos que registran los vendedores en la ruta, con su ticket.",
```

`catalogo/page.tsx` es un `Placeholder` sin tarjetas: no se toca.

- [ ] **Paso 7: correr y ver pasar; typecheck y lint**

```bash
npm test --workspace=apps/portal -- pantalla-campos-egreso
npx tsc --noEmit -p apps/portal
npm run lint --workspace=apps/portal
```

Esperado: 8/8 pruebas en verde, sin errores de tipos ni de lint.

- [ ] **Paso 8: commit**

```bash
git add apps/portal/src/lib/campos-egreso.ts apps/portal/src/components/campos-egreso "apps/portal/src/app/(portal)/catalogo/campos-de-egreso/page.tsx" apps/portal/src/components/layout/nav-config.ts apps/portal/src/components/usuarios/matriz-permisos-usuario.tsx
git commit -m "T-30/T-31: portal, Catálogo › Campos de egreso

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 8: Portal: Finanzas › Gastos y los gastos de ruta en Tesorería (D7, D10)

**Files:**
- Create: `apps/portal/src/lib/gastos.ts`
- Create: `apps/portal/src/lib/gastos.test.ts`
- Create: `apps/portal/src/components/gastos/tabla-gastos.tsx`
- Create: `apps/portal/src/components/gastos/pantalla-gastos.tsx`
- Create: `apps/portal/src/components/gastos/pantalla-gastos.test.tsx`
- Create: `apps/portal/src/app/(portal)/finanzas/gastos/page.tsx`
- Modify: `apps/portal/src/components/layout/nav-config.ts` (sección "Finanzas")
- Modify: `apps/portal/src/lib/tesoreria.ts` (`EventoTesoreria`, `VistaTesoreria`, `describirEvento`,
  `definicionExcelTesoreria`)
- Modify: `apps/portal/src/lib/tesoreria.test.ts`
- Modify: `apps/portal/src/components/tesoreria/pestana-vista.tsx`
- Modify: `apps/portal/src/components/tesoreria/pestana-vista.test.tsx`

**Interfaces:**
- Consumes (Tarea 6): `GET /gastos?desde&hasta&sucursal&vendedor&campo` (permiso `gasto.ver`) →
  `ListaGastos { desde; hasta; gastos: GastoListado[]; totalCentavos }`, con
  `GastoListado { id; fecha; registradoEn; sucursalCodigo; vendedorId: string | null; vendedorNombre: string | null;
  campoEgresoId; campoNombre; tipo; montoCentavos; comentario: string | null; tieneFoto: boolean }`, en orden de
  fecha y hora. `GET /gastos/:id/foto` → JPEG (404 si no tiene o es de otra sucursal).
- Consumes (Tarea 5): la vista de `GET /tesoreria` gana el evento
  `{ tipo: 'gasto-ruta'; id; fecha; cuentaId; cuentaNombre; sucursalCodigo; cantidad; montoCentavos }` (monto
  positivo: es salida) y `gastosSinCuenta: { sucursalCodigo: string; montoCentavos: number }[]`.
- Consumes (Tarea 7): `listarCamposEgreso`, `ETIQUETA_TIPO_EGRESO`, `TipoEgreso` de `@/lib/campos-egreso`.
- Consumes (existentes): `listarVendedores` (`@/lib/vendedores`), `formatearPesos`, `hoyEnTijuana`
  (`@/lib/ventas`), `formatearFecha` (`@/lib/reportes`), `apiFetch`, `apiFetchBlob`, `mensajeDe` (`@/lib/api`).
- Produces: `apps/portal/src/lib/gastos.ts` exporta `PERMISO_VER_GASTOS`, `GastoListado`, `ListaGastos`,
  `obtenerGastos(filtros)`, `descargarFotoGasto(id)`, `horaEnTijuana(iso)`, `etiquetaVendedorGasto(g)`.
  Componentes `PantallaGastos`, `TablaGastos`. Ruta `/finanzas/gastos`.

> La foto se baja con `apiFetchBlob` y se pinta con una URL de objeto, igual que `FotoProspecto`
> (`components/clientes/foto-prospecto.tsx`): un `<img src>` a la API no sabe refrescar la sesión. La tabla sigue a
> `tabla-reporte-ventas.tsx` (`table-fixed`, `colgroup`, `min-w`, scroll en su caja) para caber en 1366 px (≈1012 px
> de caja): Fecha 88 + Hora 56 + Sucursal 64 + Vendedor 128 + Campo 144 + Tipo 96 + Monto 104 + Ticket 56 = 736 px
> fijos, y Comentario se queda con el resto (truncado con `title`). Mide en el navegador antes de dar la tarea por
> buena (CLAUDE.md, bloque Reportes y Excel).

- [ ] **Paso 1: las pruebas de la capa de red y de Tesorería que fallan**

`apps/portal/src/lib/gastos.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { descargarFotoGasto, etiquetaVendedorGasto, horaEnTijuana, obtenerGastos } from "./gastos";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn(), apiFetchBlob: vi.fn() };
});

describe("obtenerGastos", () => {
  beforeEach(() => vi.clearAllMocks());

  it("arma la query con los filtros que vienen y omite los vacíos", async () => {
    vi.mocked(api.apiFetch).mockResolvedValue({ desde: "2026-10-20", hasta: "2026-10-20", gastos: [], totalCentavos: 0 });
    await obtenerGastos({ desde: "2026-10-01", hasta: "2026-10-20", sucursal: "TJ", vendedor: "v1", campo: null });
    expect(api.apiFetch).toHaveBeenCalledWith("/gastos?desde=2026-10-01&hasta=2026-10-20&sucursal=TJ&vendedor=v1");
    await obtenerGastos({ desde: "2026-10-01", hasta: "2026-10-01", sucursal: null, vendedor: null, campo: "c1" });
    expect(api.apiFetch).toHaveBeenLastCalledWith("/gastos?desde=2026-10-01&hasta=2026-10-01&campo=c1");
  });

  it("la foto se baja como blob de /gastos/:id/foto", async () => {
    vi.mocked(api.apiFetchBlob).mockResolvedValue(new Blob(["x"]));
    await descargarFotoGasto("g1");
    expect(api.apiFetchBlob).toHaveBeenCalledWith("/gastos/g1/foto");
  });
});

describe("horaEnTijuana", () => {
  it("pinta la hora de Tijuana, no la de UTC ni la del navegador", () => {
    // 01:30 UTC del 21 es 18:30 del 20 en Tijuana (horario de verano, UTC−7).
    expect(horaEnTijuana("2026-10-21T01:30:00.000Z")).toBe("18:30");
    // En noviembre ya es UTC−8.
    expect(horaEnTijuana("2026-11-20T16:05:00.000Z")).toBe("08:05");
  });
});

describe("etiquetaVendedorGasto", () => {
  it("un gasto sin vendedor es de la oficina", () => {
    expect(etiquetaVendedorGasto({ vendedorNombre: "Juan Pérez" })).toBe("Juan Pérez");
    expect(etiquetaVendedorGasto({ vendedorNombre: null })).toBe("Oficina");
  });
});
```

En `apps/portal/src/lib/tesoreria.test.ts`:

1. Dentro de `describe("describirEvento", …)`, al final del `it`, agrega:

```ts
    expect(
      describirEvento({ ...base, tipo: "gasto-ruta", sucursalCodigo: "TJ", cantidad: 2, montoCentavos: 33_050 }),
    ).toEqual({ concepto: "Gastos de ruta · 2 gastos · TJ", cuenta: "Efectivo TJ", signo: -1 });
    expect(
      describirEvento({ ...base, tipo: "gasto-ruta", sucursalCodigo: "MX", cantidad: 1, montoCentavos: 8_000 }),
    ).toEqual({ concepto: "Gastos de ruta · 1 gasto · MX", cuenta: "Efectivo TJ", signo: -1 });
```

2. En `describe("definicionExcelTesoreria", …)`, el objeto `vista` gana, después de `sinCuenta`:

```ts
    gastosSinCuenta: [{ sucursalCodigo: "MX", montoCentavos: 8_000 }],
```

   y su arreglo `eventos` gana como tercer elemento:

```ts
      { tipo: "gasto-ruta", id: "g", fecha: "2026-10-08", cuentaId: "a", cuentaNombre: "Efectivo TJ", sucursalCodigo: "TJ", cantidad: 2, montoCentavos: 33_050 },
```

3. En el `it("una hoja: …")`, el `expect(def.filas).toEqual([...])` queda así (bloque nuevo de gastos sin cuenta y
   la fila del evento):

```ts
    expect(def.filas).toEqual([
      { celdas: ["Efectivo TJ", "TJ", 10000, 200, 700, 9500, null] },
      { celdas: ["Total Tesorería", "1 cuentas", 10000, 200, 700, 9500, null], tipo: "total" },
      { celdas: ["Cobranza sin cuenta asignada", null, null, null, null, null, null], tipo: "grupo" },
      { celdas: ["MX · Transferencia", null, null, null, null, null, "$3,250.00 sin cuenta asignada"] },
      { celdas: ["Gastos de ruta sin cuenta de efectivo", null, null, null, null, null, null], tipo: "grupo" },
      { celdas: ["MX", null, null, null, null, null, "$80.00 sin cuenta de efectivo"] },
      { celdas: ["Movimientos del rango", "Fecha", "Concepto", "Entra", "Sale", null, "Comentario"], tipo: "grupo" },
      { celdas: ["Efectivo TJ", "06/10/2026", "Cobranza en efectivo · 2 cobros · TJ", 200, null, null, null] },
      { celdas: ["Efectivo TJ", "07/10/2026", "Retiro", null, 700, null, "Banco · Capturó: Ana"] },
      { celdas: ["Efectivo TJ", "08/10/2026", "Gastos de ruta · 2 gastos · TJ", null, 330.5, null, null] },
    ]);
```

4. En `it("sin eventos ni cobranza sin cuenta no hay bloques", …)`, la llamada pasa a
   `definicionExcelTesoreria({ ...vista, eventos: [], sinCuenta: [], gastosSinCuenta: [] }, { sucursal: "TJ" })`.

- [ ] **Paso 2: las pruebas de pantalla que fallan**

`apps/portal/src/components/gastos/pantalla-gastos.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as camposLib from "@/lib/campos-egreso";
import * as gastosLib from "@/lib/gastos";
import type { ListaGastos } from "@/lib/gastos";
import * as vendedoresLib from "@/lib/vendedores";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaGastos } from "./pantalla-gastos";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/gastos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/gastos")>();
  return { ...real, obtenerGastos: vi.fn(), descargarFotoGasto: vi.fn() };
});
vi.mock("@/lib/vendedores", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/vendedores")>();
  return { ...real, listarVendedores: vi.fn() };
});
vi.mock("@/lib/campos-egreso", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/campos-egreso")>();
  return { ...real, listarCamposEgreso: vi.fn() };
});

const obtener = vi.mocked(gastosLib.obtenerGastos);
const descargarFoto = vi.mocked(gastosLib.descargarFotoGasto);
const HOY = hoyEnTijuana();

const LISTA: ListaGastos = {
  desde: HOY,
  hasta: HOY,
  gastos: [
    {
      id: "g1",
      fecha: "2026-10-20",
      registradoEn: "2026-10-20T17:40:00.000Z",
      sucursalCodigo: "TJ",
      vendedorId: "v1",
      vendedorNombre: "Juan Pérez",
      campoEgresoId: "c1",
      campoNombre: "Gasolina",
      tipo: "operacion",
      montoCentavos: 25_050,
      comentario: "Pemex del bulevar",
      tieneFoto: true,
    },
    {
      id: "g2",
      fecha: "2026-10-20",
      registradoEn: "2026-10-20T18:05:00.000Z",
      sucursalCodigo: "TJ",
      vendedorId: "v1",
      vendedorNombre: "Juan Pérez",
      campoEgresoId: "c2",
      campoNombre: "Hielo",
      tipo: "operacion",
      montoCentavos: 8_000,
      comentario: null,
      tieneFoto: false,
    },
  ],
  totalCentavos: 33_050,
};

function sesion(puede: boolean) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: { sucursal: null, permisos: puede ? [gastosLib.PERMISO_VER_GASTOS] : [] } as never,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: () => puede,
  });
}

describe("PantallaGastos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    obtener.mockResolvedValue(LISTA);
    vi.mocked(vendedoresLib.listarVendedores).mockResolvedValue([
      { id: "v1", nombre: "Juan Pérez", login: "juan", sucursalId: "s1", sucursalCodigo: "TJ", folioSegmento: "JP", activo: true },
    ]);
    vi.mocked(camposLib.listarCamposEgreso).mockResolvedValue([
      { id: "c1", nombre: "Gasolina", tipo: "operacion", seUsaEnApp: true },
      { id: "c2", nombre: "Hielo", tipo: "operacion", seUsaEnApp: true },
    ]);
    URL.createObjectURL = vi.fn(() => "blob:ticket");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sin gasto.ver lo dice y no consulta", async () => {
    sesion(false);
    render(<PantallaGastos sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver los gastos")).toBeInTheDocument();
    expect(obtener).not.toHaveBeenCalled();
  });

  it("al abrir consulta hoy en Tijuana con la sucursal del filtro global", async () => {
    sesion(true);
    render(<PantallaGastos sucursal="TJ" />);
    await screen.findByText("Gasolina");
    expect(obtener).toHaveBeenCalledWith({ desde: HOY, hasta: HOY, sucursal: "TJ", vendedor: null, campo: null });
    expect(screen.getByLabelText("Desde")).toHaveValue(HOY);
    expect(screen.getByLabelText("Hasta")).toHaveValue(HOY);
  });

  it("pinta las columnas, la hora de Tijuana, el tipo con su etiqueta y el total", async () => {
    sesion(true);
    render(<PantallaGastos sucursal={null} />);
    const tabla = await screen.findByRole("table", { name: "Gastos" });
    expect(within(tabla).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Fecha", "Hora", "Sucursal", "Vendedor", "Campo", "Tipo", "Monto", "Comentario", "Ticket",
    ]);
    const fila = within(tabla).getByText("Gasolina").closest("tr")!;
    expect(within(fila).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "20/10/2026", "10:40", "TJ", "Juan Pérez", "Gasolina", "Operación", "$250.50", "Pemex del bulevar", "",
    ]);
    const sinFoto = within(tabla).getByText("Hielo").closest("tr")!;
    expect(within(sinFoto).queryByRole("button")).toBeNull();
    expect(within(sinFoto).getAllByRole("cell")[7]).toHaveTextContent("—");
    expect(screen.getByText("Total: $330.50 · 2 gastos")).toBeInTheDocument();
  });

  it("Mostrar manda los filtros de vendedor y campo", async () => {
    sesion(true);
    render(<PantallaGastos sucursal={null} />);
    await screen.findByText("Gasolina");
    await userEvent.selectOptions(screen.getByLabelText("Vendedor"), "v1");
    await userEvent.selectOptions(screen.getByLabelText("Campo"), "c2");
    await userEvent.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(obtener).toHaveBeenLastCalledWith({ desde: HOY, hasta: HOY, sucursal: null, vendedor: "v1", campo: "c2" });
  });

  it("desde posterior a hasta no consulta y lo dice", async () => {
    sesion(true);
    render(<PantallaGastos sucursal={null} />);
    await screen.findByText("Gasolina");
    // `fireEvent` y no `userEvent.type`: jsdom no teclea en un <input type="date">.
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2099-01-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La fecha inicial no puede ser posterior a la final.");
    expect(obtener).toHaveBeenCalledTimes(1);
  });

  it("el error del servidor (rango de más de un año) se muestra tal cual", async () => {
    sesion(true);
    obtener.mockRejectedValue(new ErrorApi("mal", 400, "El rango no puede pasar de un año."));
    render(<PantallaGastos sucursal={null} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("El rango no puede pasar de un año.");
  });

  it("sin gastos en el rango lo dice", async () => {
    sesion(true);
    obtener.mockResolvedValue({ desde: HOY, hasta: HOY, gastos: [], totalCentavos: 0 });
    render(<PantallaGastos sucursal={null} />);
    expect(await screen.findByText("No hay gastos en ese rango.")).toBeInTheDocument();
  });

  it("el ícono del ticket baja la foto y la abre; Cerrar la quita", async () => {
    sesion(true);
    descargarFoto.mockResolvedValue(new Blob(["jpeg"]));
    render(<PantallaGastos sucursal={null} />);
    await userEvent.click(await screen.findByRole("button", { name: "Ver el ticket de Gasolina" }));
    expect(descargarFoto).toHaveBeenCalledWith("g1");
    const dialogo = await screen.findByRole("dialog", { name: "Ticket de Gasolina" });
    expect(within(dialogo).getByAltText("Ticket de Gasolina")).toHaveAttribute("src", "blob:ticket");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("si la foto no baja, lo dice sin romper la tabla", async () => {
    sesion(true);
    descargarFoto.mockRejectedValue(new ErrorApi("no", 404, "Ese gasto no tiene foto."));
    render(<PantallaGastos sucursal={null} />);
    await userEvent.click(await screen.findByRole("button", { name: "Ver el ticket de Gasolina" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar el ticket.");
    expect(screen.getByRole("table", { name: "Gastos" })).toBeInTheDocument();
  });
});
```

En `apps/portal/src/components/tesoreria/pestana-vista.test.tsx`:

1. El `VISTA` de arriba gana `gastosSinCuenta: [],` después de `sinCuenta: [],`.
2. Agrega estas dos pruebas al final del `describe("PestanaVista", …)`:

```tsx
  it("los gastos de ruta salen como salida con su concepto y sin comentario ni capturó", async () => {
    vi.mocked(lib.obtenerTesoreria).mockResolvedValue({
      ...VISTA,
      eventos: [
        { tipo: "gasto-ruta", id: "g", fecha: HOY, cuentaId: "a", cuentaNombre: "Efectivo TJ", sucursalCodigo: "TJ", cantidad: 2, montoCentavos: 33_050 },
      ],
    });
    render(<PestanaVista sucursal={null} />);
    const tabla = await screen.findByRole("table", { name: "Movimientos del rango" });
    const fila = within(tabla).getByText("Gastos de ruta · 2 gastos · TJ").closest("tr")!;
    expect(within(fila).getByText("-$330.50")).toBeInTheDocument();
    expect(within(fila).getAllByRole("cell").slice(-2).map((c) => c.textContent)).toEqual(["—", "—"]);
  });

  it("avisa de los gastos de ruta sin cuenta de efectivo, aunque no haya cobranza sin cuenta", async () => {
    vi.mocked(lib.obtenerTesoreria).mockResolvedValue({
      ...VISTA,
      gastosSinCuenta: [{ sucursalCodigo: "TJ", montoCentavos: 33_050 }],
    });
    render(<PestanaVista sucursal={null} />);
    const aviso = await screen.findByRole("status");
    expect(aviso).toHaveTextContent("$330.50 de gastos de ruta de TJ sin cuenta de efectivo");
    expect(aviso).toHaveTextContent(
      "Los gastos de ruta salen de la cuenta que recibe la cobranza en efectivo de su sucursal: configúrala en Cuentas → ¿A qué cuenta entra la cobranza?",
    );
    expect(aviso).not.toHaveTextContent("de cobranza de");
  });
```

- [ ] **Paso 3: correr y ver fallar**

```bash
npm test --workspace=apps/portal -- gastos tesoreria pestana-vista
```

Esperado: `lib/gastos.test.ts` y `pantalla-gastos.test.tsx` fallan al resolver `./gastos` y `./pantalla-gastos`;
en `lib/tesoreria.test.ts`, `describirEvento` con `gasto-ruta` da `"Saldo fijado"` y el Excel no trae los bloques
nuevos; en `pestana-vista.test.tsx` las dos pruebas nuevas fallan (no hay aviso ni concepto de gastos).

- [ ] **Paso 4: la capa de red de Gastos**

`apps/portal/src/lib/gastos.ts`:

```ts
import { apiFetch, apiFetchBlob } from "./api";
import type { TipoEgreso } from "./campos-egreso";

/*
 * Finanzas › Gastos (T-30/T-31, D10). Misma forma que `ListaGastos` de
 * apps/backend/src/modules/compras-egresos/gastos.service.ts (el portal no puede
 * importar del backend). Dinero en centavos enteros.
 */

export const PERMISO_VER_GASTOS = "gasto.ver";

export interface GastoListado {
  id: string;
  /** `AAAA-MM-DD`: el día de Tijuana al que cuenta (el `fecha_operacion` de la tablet). */
  fecha: string;
  /** ISO: cuándo lo guardó el vendedor. La hora se pinta en Tijuana. */
  registradoEn: string;
  sucursalCodigo: string;
  /** `null` = compra de oficina (siguiente ticket). */
  vendedorId: string | null;
  vendedorNombre: string | null;
  campoEgresoId: string;
  /** Copia del nombre al registrarlo: si la oficina renombra el campo, el gasto conserva el suyo. */
  campoNombre: string;
  tipo: TipoEgreso;
  montoCentavos: number;
  comentario: string | null;
  tieneFoto: boolean;
}

export interface ListaGastos {
  desde: string;
  hasta: string;
  gastos: GastoListado[];
  totalCentavos: number;
}

export function obtenerGastos(f: {
  desde: string;
  hasta: string;
  /** Código, `todas`, o null: lo decide el servidor (`resolverAlcance`). */
  sucursal: string | null;
  /** Id de vendedor o null (todos). */
  vendedor: string | null;
  /** Id de campo de egreso o null (todos). */
  campo: string | null;
}): Promise<ListaGastos> {
  const q = new URLSearchParams({ desde: f.desde, hasta: f.hasta });
  if (f.sucursal) q.set("sucursal", f.sucursal);
  if (f.vendedor) q.set("vendedor", f.vendedor);
  if (f.campo) q.set("campo", f.campo);
  return apiFetch<ListaGastos>(`/gastos?${q.toString()}`);
}

/** Los bytes del ticket. Con `fetch` y no con `<img src>`: ver `FotoProspecto`. */
export function descargarFotoGasto(id: string): Promise<Blob> {
  return apiFetchBlob(`/gastos/${id}/foto`);
}

/** `HH:mm` en Tijuana: la oficina lee la hora del vendedor, no la de su navegador. */
export function horaEnTijuana(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Tijuana",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function etiquetaVendedorGasto(g: Pick<GastoListado, "vendedorNombre">): string {
  return g.vendedorNombre ?? "Oficina";
}
```

- [ ] **Paso 5: la tabla con el ticket**

`apps/portal/src/components/gastos/tabla-gastos.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { ETIQUETA_TIPO_EGRESO } from "@/lib/campos-egreso";
import { descargarFotoGasto, etiquetaVendedorGasto, horaEnTijuana, type GastoListado } from "@/lib/gastos";
import { formatearFecha } from "@/lib/reportes";
import { formatearPesos } from "@/lib/ventas";

/*
 * Una sola tabla `table-fixed` (como tabla-reporte-ventas.tsx) para caber desde
 * 1366 px: los anchos de `colgroup` suman 736 px fijos y Comentario se queda con
 * el resto. Toda celda lleva `px-2`; los números van a la derecha con `tabular-nums`.
 */
const TH = "sticky top-0 bg-background px-2 py-2 font-medium shadow-[inset_0_-1px_0_var(--border)]";
const TD = "px-2 py-1.5";
const NUM = "text-right tabular-nums";

export function TablaGastos({ gastos }: { gastos: GastoListado[] }) {
  const [abierto, setAbierto] = useState<GastoListado | null>(null);
  return (
    <>
      {/* `w-0 min-w-full`: la caja no aporta su ancho al `main`; la tabla se desplaza dentro. */}
      <div className="max-h-[70vh] w-0 min-w-full overflow-auto rounded-md border">
        <table aria-label="Gastos" className="w-full min-w-[60rem] table-fixed text-[13px]">
          <colgroup>
            <col className="w-22" />
            <col className="w-14" />
            <col className="w-16" />
            <col className="w-32" />
            <col className="w-36" />
            <col className="w-24" />
            <col className="w-26" />
            <col />
            <col className="w-14" />
          </colgroup>
          <thead className="text-left">
            <tr>
              <th className={TH}>Fecha</th>
              <th className={TH}>Hora</th>
              <th className={TH}>Sucursal</th>
              <th className={TH}>Vendedor</th>
              <th className={TH}>Campo</th>
              <th className={TH}>Tipo</th>
              <th className={`${TH} ${NUM}`}>Monto</th>
              <th className={TH}>Comentario</th>
              <th className={`${TH} text-center`}>Ticket</th>
            </tr>
          </thead>
          <tbody>
            {gastos.map((g) => (
              <tr key={g.id} className="border-t">
                <td className={TD}>{formatearFecha(g.fecha)}</td>
                <td className={`${TD} tabular-nums`}>{horaEnTijuana(g.registradoEn)}</td>
                <td className={TD}>{g.sucursalCodigo}</td>
                <td className={`${TD} truncate`} title={etiquetaVendedorGasto(g)}>
                  {etiquetaVendedorGasto(g)}
                </td>
                <td className={`${TD} truncate`} title={g.campoNombre}>
                  {g.campoNombre}
                </td>
                <td className={TD}>{ETIQUETA_TIPO_EGRESO[g.tipo]}</td>
                <td className={`${TD} ${NUM}`}>{formatearPesos(g.montoCentavos)}</td>
                <td className={`${TD} truncate`} title={g.comentario ?? undefined}>
                  {g.comentario ?? "—"}
                </td>
                <td className={`${TD} text-center`}>
                  {g.tieneFoto && (
                    <button
                      type="button"
                      onClick={() => setAbierto(g)}
                      aria-label={`Ver el ticket de ${g.campoNombre}`}
                      title="Ver el ticket"
                      className="inline-flex rounded p-1 hover:bg-muted"
                    >
                      <Receipt className="size-4" aria-hidden="true" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {abierto && <TicketGasto key={abierto.id} gasto={abierto} alCerrar={() => setAbierto(null)} />}
    </>
  );
}

/**
 * El ticket ampliado. Los bytes se piden con `fetch` (refresca la sesión) y se pintan
 * con una URL de objeto que se revoca al cerrar, como `FotoProspecto`. Un fallo no
 * rompe la tabla: lo dice en el mismo diálogo.
 */
function TicketGasto({ gasto, alCerrar }: { gasto: GastoListado; alCerrar: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let vigente = true;
    let creada: string | null = null;
    descargarFotoGasto(gasto.id)
      .then((blob) => {
        if (!vigente) return;
        creada = URL.createObjectURL(blob);
        setUrl(creada);
      })
      .catch(() => {
        if (vigente) setFallo(true);
      });
    return () => {
      vigente = false;
      if (creada) URL.revokeObjectURL(creada);
    };
  }, [gasto.id]);

  useEffect(() => {
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") alCerrar();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [alCerrar]);

  const titulo = `Ticket de ${gasto.campoNombre}`;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      {fallo && (
        <p role="alert" className="rounded-md bg-white px-3 py-2 text-sm text-black">
          No se pudo cargar el ticket.
        </p>
      )}
      {!fallo && url === null && <p className="text-sm text-white">Cargando el ticket…</p>}
      {url !== null && (
        // eslint-disable-next-line @next/next/no-img-element -- el src es un blob: del navegador; next/image no lo ve.
        <img src={url} alt={titulo} className="max-h-full max-w-full rounded" />
      )}
      <button
        type="button"
        onClick={alCerrar}
        className="absolute right-4 top-4 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black"
      >
        Cerrar
      </button>
    </div>
  );
}
```

- [ ] **Paso 6: la pantalla, la página y el menú**

`apps/portal/src/components/gastos/pantalla-gastos.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { mensajeDe } from "@/lib/api";
import { listarCamposEgreso, type CampoEgreso } from "@/lib/campos-egreso";
import { obtenerGastos, PERMISO_VER_GASTOS, type ListaGastos } from "@/lib/gastos";
import { formatearFecha } from "@/lib/reportes";
import { listarVendedores, type Vendedor } from "@/lib/vendedores";
import { formatearPesos, hoyEnTijuana } from "@/lib/ventas";
import { TablaGastos } from "./tabla-gastos";

/**
 * Finanzas › Gastos (T-30/T-31, D10): los gastos que registran los vendedores en la
 * ruta, con su ticket. Consulta al abrir con hoy en Tijuana (como Tesorería); la
 * página la monta con `key={sucursal}`: cambiar el filtro global empieza limpio.
 */
export function PantallaGastos({ sucursal }: { sucursal: string | null }) {
  const { puede, usuario, cargando: cargandoSesion } = useAuth();
  const permitido = puede(PERMISO_VER_GASTOS);
  const hoy = hoyEnTijuana();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [vendedor, setVendedor] = useState("");
  const [campo, setCampo] = useState("");
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [campos, setCampos] = useState<CampoEgreso[]>([]);
  const [lista, setLista] = useState<ListaGastos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Solo la última consulta escribe: una lenta que llega tarde no pisa a la nueva.
  const ultima = useRef(0);

  const consultar = useCallback(
    async (f: { desde: string; hasta: string; vendedor: string; campo: string }) => {
      setError(null);
      if (f.desde > f.hasta) {
        setError("La fecha inicial no puede ser posterior a la final.");
        return;
      }
      const esta = ++ultima.current;
      setCargando(true);
      try {
        const r = await obtenerGastos({
          desde: f.desde,
          hasta: f.hasta,
          sucursal,
          vendedor: f.vendedor || null,
          campo: f.campo || null,
        });
        if (esta === ultima.current) setLista(r);
      } catch (err) {
        if (esta !== ultima.current) return;
        setLista(null);
        setError(mensajeDe(err, "No se pudieron consultar los gastos."));
      } finally {
        if (esta === ultima.current) setCargando(false);
      }
    },
    [sucursal],
  );

  // "Por defecto, hoy en Tijuana" (D10): consulta al abrir.
  useEffect(() => {
    if (!permitido) return;
    void consultar({ desde: hoy, hasta: hoy, vendedor: "", campo: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permitido, consultar]);

  useEffect(() => {
    if (!permitido) return;
    let vigente = true;
    // Sin estas listas los filtros se quedan en "Todos": la consulta sigue sirviendo.
    listarVendedores(sucursal).then(
      (l) => {
        if (vigente) setVendedores(l);
      },
      () => undefined,
    );
    listarCamposEgreso().then(
      (l) => {
        if (vigente) setCampos(l);
      },
      () => undefined,
    );
    return () => {
      vigente = false;
    };
  }, [permitido, sucursal]);

  if (cargandoSesion || !permitido) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Gastos</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {cargandoSesion ? "Cargando…" : "No tienes permiso para ver los gastos"}
          </p>
        </CardContent>
      </Card>
    );
  }

  function alMostrar(e: FormEvent) {
    e.preventDefault();
    void consultar({ desde, hasta, vendedor, campo });
  }

  // Viendo todas las sucursales, dos vendedores pueden llamarse igual: se distingue con el código.
  const verTodas = !usuario?.sucursal && (sucursal === null || sucursal.toLowerCase() === "todas");
  const nombreVendedor = (v: Vendedor) => (verTodas ? `${v.nombre} · ${v.sucursalCodigo}` : v.nombre);
  const n = lista?.gastos.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gastos</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={alMostrar} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="gastos-desde" className="text-sm font-medium">
              Desde
            </label>
            <input
              id="gastos-desde"
              type="date"
              required
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="gastos-hasta" className="text-sm font-medium">
              Hasta
            </label>
            <input
              id="gastos-hasta"
              type="date"
              required
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="gastos-vendedor" className="text-sm font-medium">
              Vendedor
            </label>
            <select
              id="gastos-vendedor"
              value={vendedor}
              onChange={(e) => setVendedor(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <option value="">Todos</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.activo ? nombreVendedor(v) : `${nombreVendedor(v)} (inactivo)`}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="gastos-campo" className="text-sm font-medium">
              Campo
            </label>
            <select
              id="gastos-campo"
              value={campo}
              onChange={(e) => setCampo(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <option value="">Todos</option>
              {campos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit">Mostrar</Button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {cargando && !lista && <p className="text-sm text-muted-foreground">Cargando…</p>}

        {lista &&
          (n > 0 ? (
            <div aria-busy={cargando} className={`flex flex-col gap-3 ${cargando ? "opacity-60" : ""}`}>
              <p className="text-sm text-muted-foreground">
                {`Del ${formatearFecha(lista.desde)} al ${formatearFecha(lista.hasta)}`}
              </p>
              <TablaGastos gastos={lista.gastos} />
              <p className="text-sm font-semibold">
                {`Total: ${formatearPesos(lista.totalCentavos)} · ${n} ${n === 1 ? "gasto" : "gastos"}`}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No hay gastos en ese rango.</p>
          ))}
      </CardContent>
    </Card>
  );
}
```

`apps/portal/src/app/(portal)/finanzas/gastos/page.tsx`:

```tsx
import { PantallaGastos } from "@/components/gastos/pantalla-gastos";

// T-30/T-31 (D10). `key`: cambiar la sucursal del selector global vuelve a montar la
// pantalla, como /finanzas/tesoreria y /operacion/reporte-de-ventas.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaGastos key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
```

En `apps/portal/src/components/layout/nav-config.ts`, la sección "Finanzas":

```ts
    items: [{ label: "Tesorería", href: "/finanzas/tesoreria" }],
```

pasa a:

```ts
    items: [
      { label: "Tesorería", href: "/finanzas/tesoreria" },
      { label: "Gastos", href: "/finanzas/gastos" },
    ],
```

(El menú no filtra por permiso —ninguna entrada lo hace—; el candado es la pantalla, que sin `gasto.ver` dice "No
tienes permiso para ver los gastos", y el backend, que contesta 403.)

- [ ] **Paso 7: Tesorería, la capa de red**

En `apps/portal/src/lib/tesoreria.ts`:

1. Al final de la unión `EventoTesoreria`, después del miembro `"cobranza"`:

```ts
  | {
      // T-30/T-31 (D7): el total de gastos de la ruta de una sucursal en un día. Monto positivo: es salida.
      tipo: "gasto-ruta";
      id: string;
      fecha: string;
      cuentaId: string;
      cuentaNombre: string;
      sucursalCodigo: string;
      cantidad: number;
      montoCentavos: number;
    };
```

   (el `;` que cerraba el miembro `"cobranza"` pasa a quedar al final de este).

2. En `VistaTesoreria`, después de `sinCuenta`:

```ts
  /** T-30/T-31: gastos de la ruta del rango cuya sucursal no tiene cuenta destino de efectivo. */
  gastosSinCuenta: { sucursalCodigo: string; montoCentavos: number }[];
```

3. En `describirEvento`, antes del `default:`:

```ts
    case "gasto-ruta":
      return {
        concepto: `Gastos de ruta · ${e.cantidad} ${e.cantidad === 1 ? "gasto" : "gastos"} · ${e.sucursalCodigo}`,
        cuenta: e.cuentaNombre,
        signo: -1,
      };
```

4. En `definicionExcelTesoreria`, después del bloque `if (vista.sinCuenta.length > 0) { … }`:

```ts
  if (vista.gastosSinCuenta.length > 0) {
    filas.push({ celdas: ["Gastos de ruta sin cuenta de efectivo", null, null, null, null, null, null], tipo: "grupo" });
    for (const g of vista.gastosSinCuenta) {
      filas.push({ celdas: [g.sucursalCodigo, null, null, null, null, null, `${formatearPesos(g.montoCentavos)} sin cuenta de efectivo`] });
    }
  }
```

   y la línea del comentario del evento:

```ts
        e.tipo === "cobranza" ? null : e.comentario ? `${e.comentario} · Capturó: ${e.capturo}` : `Capturó: ${e.capturo}`;
```

   pasa a:

```ts
        e.tipo === "cobranza" || e.tipo === "gasto-ruta"
          ? null
          : e.comentario
            ? `${e.comentario} · Capturó: ${e.capturo}`
            : `Capturó: ${e.capturo}`;
```

- [ ] **Paso 8: Tesorería, la vista**

En `apps/portal/src/components/tesoreria/pestana-vista.tsx`:

1. El aviso de cobranza sin cuenta:

```tsx
          {vista.sinCuenta.length > 0 && (
            <div role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {vista.sinCuenta.map((s) => (
                <p key={`${s.sucursalCodigo}:${s.metodo}`}>
                  {formatearPesos(s.montoCentavos)} de cobranza de {s.sucursalCodigo} ({ETIQUETA_METODO[s.metodo].toLowerCase()}) sin cuenta asignada
                </p>
              ))}
              <p className="text-xs">Configúrala en Cuentas → ¿A qué cuenta entra la cobranza?</p>
            </div>
          )}
```

   pasa a un solo aviso para los dos casos (un único `role="status"`):

```tsx
          {(vista.sinCuenta.length > 0 || vista.gastosSinCuenta.length > 0) && (
            <div role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {vista.sinCuenta.map((s) => (
                <p key={`${s.sucursalCodigo}:${s.metodo}`}>
                  {formatearPesos(s.montoCentavos)} de cobranza de {s.sucursalCodigo} ({ETIQUETA_METODO[s.metodo].toLowerCase()}) sin cuenta asignada
                </p>
              ))}
              {vista.sinCuenta.length > 0 && (
                <p className="text-xs">Configúrala en Cuentas → ¿A qué cuenta entra la cobranza?</p>
              )}
              {vista.gastosSinCuenta.map((g) => (
                <p key={`gasto:${g.sucursalCodigo}`}>
                  {formatearPesos(g.montoCentavos)} de gastos de ruta de {g.sucursalCodigo} sin cuenta de efectivo
                </p>
              ))}
              {vista.gastosSinCuenta.length > 0 && (
                <p className="text-xs">
                  Los gastos de ruta salen de la cuenta que recibe la cobranza en efectivo de su sucursal: configúrala en
                  Cuentas → ¿A qué cuenta entra la cobranza?
                </p>
              )}
            </div>
          )}
```

2. Las dos últimas celdas de cada fila de "Movimientos del rango":

```tsx
                        <td className="py-2 pr-4">{e.tipo === "cobranza" ? "—" : (e.comentario ?? "—")}</td>
                        <td className="py-2">{e.tipo === "cobranza" ? "—" : e.capturo}</td>
```

   pasan a (el gasto de ruta, como la cobranza, es un total del día leído de otra tabla: no tiene comentario ni
   quien lo capturó):

```tsx
                        <td className="py-2 pr-4">
                          {e.tipo === "cobranza" || e.tipo === "gasto-ruta" ? "—" : (e.comentario ?? "—")}
                        </td>
                        <td className="py-2">{e.tipo === "cobranza" || e.tipo === "gasto-ruta" ? "—" : e.capturo}</td>
```

   La columna Monto ya pinta `-$330.50` en rojo porque `describirEvento` da `signo: -1`.

- [ ] **Paso 9: correr y ver pasar; typecheck y lint**

```bash
npm test --workspace=apps/portal -- gastos tesoreria pestana-vista
npm test --workspace=apps/portal
npx tsc --noEmit -p apps/portal
npm run lint --workspace=apps/portal
```

Esperado: todo en verde. Si `tsc` marca otro objeto `VistaTesoreria` sin `gastosSinCuenta` (alguna prueba que no
salió en este plan), agrégale `gastosSinCuenta: []`.

- [ ] **Paso 10: comprobar el ancho en el navegador**

Con el backend local (Tareas 1–6 aplicadas) y `npm run portal`, abre `/finanzas/gastos` en una ventana de **1366 px**
de ancho con un rango que traiga gastos con comentario largo: la página **no** se desplaza de lado y la tabla cabe en
su caja (el comentario se trunca y muestra el texto completo al pasar el ratón). Abre un ticket y ciérralo con
Escape. Si algo no cabe, ajusta los anchos del `colgroup`, no el `min-w` de la caja.

- [ ] **Paso 11: commit**

```bash
git add apps/portal/src/lib/gastos.ts apps/portal/src/lib/gastos.test.ts apps/portal/src/components/gastos "apps/portal/src/app/(portal)/finanzas/gastos/page.tsx" apps/portal/src/components/layout/nav-config.ts apps/portal/src/lib/tesoreria.ts apps/portal/src/lib/tesoreria.test.ts apps/portal/src/components/tesoreria/pestana-vista.tsx apps/portal/src/components/tesoreria/pestana-vista.test.tsx
git commit -m "T-30/T-31: portal, Finanzas › Gastos y gastos de ruta en Tesorería

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 9: Tablet: migración 015, catálogo de campos, repositorio de gastos, fuente del push, orden y cola de fotos (D6, D8)

**Files:**
- Create: `apps/tablet/src/datos/migraciones/015-gastos.ts`
- Create: `apps/tablet/src/datos/migraciones/015-gastos.spec.ts`
- Modify: `apps/tablet/src/datos/migraciones/index.ts`
- Modify: `apps/tablet/src/datos/migraciones/014-prospecto-domicilio.spec.ts` (su primera prueba decía "la 014 es la última")
- Modify: `apps/tablet/src/datos/tipos.ts` (`CampoEgreso`, `Gasto`)
- Modify: `apps/tablet/src/datos/repositorios/catalogos.ts` y `catalogos.spec.ts`
- Modify: `apps/tablet/src/datos/pruebas-apoyo.ts` (`snapshotDePrueba` gana `camposEgreso`)
- Create: `apps/tablet/src/datos/repositorios/gastos.ts`
- Create: `apps/tablet/src/datos/repositorios/gastos.spec.ts`
- Modify: `apps/tablet/src/datos/index.ts`, `apps/tablet/src/datos/inicializar.ts`
- Modify: `apps/tablet/src/sincronizacion/motor.ts` (`aSnapshot` y el comentario "Faltan gasto y merma") y `motor.spec.ts`
- Create: `apps/tablet/src/sincronizacion/fuente-gastos.ts`
- Create: `apps/tablet/src/sincronizacion/fuente-gastos.spec.ts`
- Modify: `apps/tablet/src/sincronizacion/fuentes.ts` y `fuentes.spec.ts`
- Modify: `apps/tablet/src/sincronizacion/pendientes.ts` y `pendientes.spec.ts`
- Modify: `apps/tablet/src/sincronizacion/fuente-fotos.ts` y `fuente-fotos.spec.ts`
- Modify: `apps/tablet/src/estado/proveedor-sesion.tsx` (la cola de fotos gana los gastos)
- Modify: `apps/tablet/src/fotos/expo.ts` (`DestinoFoto` gana `'gasto'`)

**Interfaces:**
- Consumes (Tareas 3 y 4, ya en `apps/tablet/src/sincronizacion/contrato.ts`):
  `DatosGasto = { campo_egreso_id: string; monto_centavos: number; registrado_en: string; comentario?: string | null }`;
  `CampoEgresoPull extends FilaSincronizable { nombre: string; tipo: 'produccion' | 'operacion' | 'financiero'; se_usa_en_app: boolean }`;
  `RespuestaPull.catalogos.campos_egreso?: CampoEgresoPull[]` (**opcional en la copia de la tablet**, como
  `motivos_visita`). Si la Tarea 4 la dejó obligatoria en la tablet, el `?.` de `aSnapshot` sigue compilando.
  `exigirJornadaAbierta` y `ErrorJornada` (`repositorios/jornadas.ts`), `enTransaccion` (`repositorios/deps.ts`).
- Produces:
  - Tablas locales `campo_egreso (id, nombre, tipo, se_usa_en_app, activo, sincronizado_en)` y
    `gasto (id, fecha, vendedor_id, sucursal_id, campo_egreso_id, campo_nombre, monto_centavos, comentario,
    registrado_en, foto_local, foto_subida_en, foto_error, foto_descartada, sync_estado, sync_error, sincronizado_en)`.
  - Tipos `CampoEgreso` y `Gasto` en `@/datos/tipos`.
  - `SnapshotCatalogos.camposEgreso?`; `catalogos.listarCamposEgreso(): CampoEgreso[]` (activos, por nombre, con y sin
    la casilla) y `catalogos.obtenerCampoEgreso(id): CampoEgreso | null` (activo o no).
  - `repositorios/gastos.ts`: `ErrorGasto`, `LARGO_MAX_COMENTARIO_GASTO = 200`,
    `MAX_MONTO_GASTO_CENTAVOS = 999_999_999_999`, `DatosRegistroGasto { vendedorId: string; campoEgresoId: string;
    montoCentavos: number; comentario: string | null; fotoUri: string | null }`,
    `crearRepositorioGastos(deps, { catalogos })` con `registrar(datos): Gasto`, `porId(id)`,
    `delDia(vendedorId, fecha?)`, `totalDelDia(vendedorId, fecha?): number`, `pendientesDeSincronizar()`,
    `marcarSincronizada(id)`, `marcarError(id, motivo)`, `pendientesDeSubirFoto()`, `marcarFotoSubida(id, subidaEn)`,
    `anotarErrorFoto(id, motivo)`, `descartarFoto(id, motivo)`; tipo `RepositorioGastos`.
  - `CapaDatos.gastos` y `FuentesConPendientes.gastos`.
  - `fuenteGastos(gastos): FuenteOperaciones` (tipo `'gasto'`) y `fuenteFotosGastos(gastos): FuenteFotos`.
  - `DestinoFoto = 'prospecto' | 'visita' | 'gasto'`.

> La foto del gasto usa el **mismo esquema derivado** que la de la visita (013): `foto_local` + `foto_subida_en` +
> `foto_error` + `foto_descartada`, sin `foto_estado`. Ninguna escritura de la foto toca `sync_estado`: una foto que
> falla no se lleva el gasto. `campo_egreso.tipo` va **sin check** local, como `cliente.ubicacion_origen` (T-72): si
> el servidor agregara un tipo, un check aquí tumbaría el upsert del snapshot entero.

- [ ] **Paso 1: la prueba de la migración que falla**

`apps/tablet/src/datos/migraciones/015-gastos.spec.ts`:

```ts
import { abrirBaseDatosNode } from '../driver-node';
import type { BaseDatos } from '../base-datos';
import { migraciones, versionEsquema } from './index';
import { ejecutarMigraciones } from './motor';

/**
 * La 015 trae los gastos de la ruta (T-30/T-31, D8): el catalogo de campos de
 * egreso que baja en el pull y el gasto local con su foto del ticket.
 */

const TS = "'2026-10-20T00:00:00.000Z'";

function baseAlDia(): BaseDatos {
  const bd = abrirBaseDatosNode();
  ejecutarMigraciones(bd, migraciones);
  bd.execSync(`
    insert into sucursal (id, codigo, nombre, sincronizado_en) values ('suc-tj', 'TJ', 'Tijuana', ${TS});
    insert into vendedor (id, login, nombre, sucursal_id, sincronizado_en)
      values ('ven-1', 'aperez', 'Abraham Perez', 'suc-tj', ${TS});
    insert into campo_egreso (id, nombre, tipo, se_usa_en_app, activo, sincronizado_en)
      values ('ce-1', 'Gasolina', 'operacion', 1, 1, ${TS});
  `);
  return bd;
}

function insertarGasto(bd: BaseDatos, cambios: Record<string, string | number | null>) {
  const fila: Record<string, string | number | null> = {
    id: 'gas-1',
    fecha: '2026-10-20',
    vendedor_id: 'ven-1',
    sucursal_id: 'suc-tj',
    campo_egreso_id: 'ce-1',
    campo_nombre: 'Gasolina',
    monto_centavos: 25050,
    registrado_en: '2026-10-20T18:40:00.000Z',
    ...cambios,
  };
  const columnas = Object.keys(fila);
  bd.runSync(
    `insert into gasto (${columnas.join(', ')}) values (${columnas.map((c) => `$${c}`).join(', ')})`,
    Object.fromEntries(columnas.map((c) => [`$${c}`, fila[c] ?? null])),
  );
}

describe('migracion 015: gastos (T-30/T-31)', () => {
  it('la 015 es la ultima y deja versionEsquema en 15', () => {
    expect(migraciones[14]?.nombre).toBe('gastos');
    expect(migraciones[14]?.version).toBe(15);
    expect(migraciones).toHaveLength(15);
    expect(versionEsquema(baseAlDia())).toBe(15);
  });

  it('un gasto entra pendiente, sin foto y no descartado', () => {
    const bd = baseAlDia();
    insertarGasto(bd, {});
    expect(
      bd.getFirstSync('select sync_estado, foto_local, foto_descartada, comentario from gasto where id = $id', {
        $id: 'gas-1',
      }),
    ).toEqual({ sync_estado: 'pendiente', foto_local: null, foto_descartada: 0, comentario: null });
  });

  it('el monto es mayor que 0', () => {
    const bd = baseAlDia();
    expect(() => insertarGasto(bd, { monto_centavos: 0 })).toThrow(/CHECK/);
    expect(() => insertarGasto(bd, { id: 'gas-2', monto_centavos: -100 })).toThrow(/CHECK/);
  });

  it('la casilla es 0/1, y un tipo que el servidor agregue no tumba el catalogo (sin check)', () => {
    const bd = baseAlDia();
    expect(() =>
      bd.execSync(
        `insert into campo_egreso (id, nombre, tipo, se_usa_en_app, activo, sincronizado_en)
           values ('ce-2', 'Otro', 'operacion', 2, 1, ${TS})`,
      ),
    ).toThrow(/CHECK/);
    expect(() =>
      bd.execSync(
        `insert into campo_egreso (id, nombre, tipo, se_usa_en_app, activo, sincronizado_en)
           values ('ce-3', 'Nuevo', 'tipo-futuro', 0, 1, ${TS})`,
      ),
    ).not.toThrow();
  });
});
```

En `apps/tablet/src/datos/migraciones/014-prospecto-domicilio.spec.ts`, la primera prueba deja de afirmar que la
014 es la última (mismo cambio que T-72 le hizo a la de la 013). Reemplaza:

```ts
  it('la 014 es la ultima y deja versionEsquema en 14', () => {
    expect(migraciones[13]?.nombre).toBe('prospecto-domicilio');
    expect(migraciones[13]?.version).toBe(14);
    expect(migraciones).toHaveLength(14);
    expect(versionEsquema(baseAlDia())).toBe(14);
  });
```

por:

```ts
  it('la 014 es prospecto-domicilio y deja de ser la ultima con la 015 (T-30/T-31)', () => {
    expect(migraciones[13]?.nombre).toBe('prospecto-domicilio');
    expect(migraciones[13]?.version).toBe(14);
    expect(versionEsquema(baseAlDia())).toBe(migraciones.length);
  });
```

- [ ] **Paso 2: correr y ver fallar**

Run: `npm test --workspace=apps/tablet -- migraciones/015`
Expected: FAIL (`migraciones[14]` es `undefined`; `no such table: campo_egreso`).

- [ ] **Paso 3: la migración 015 y su registro**

`apps/tablet/src/datos/migraciones/015-gastos.ts`:

```ts
import type { Migracion } from './motor';

/**
 * Los gastos de la ruta en la tablet (T-30/T-31, D8).
 *
 * - `campo_egreso`: el catalogo que baja en el pull (`campos_egreso`, upsert
 *   generico, baja como bandera). La pantalla Gastos ofrece solo los activos con
 *   `se_usa_en_app = 1` (`camposParaGasto`, `src/estado/gasto.ts`). `tipo` va sin
 *   check a proposito: si el servidor agrega uno, un check aqui haria fallar el
 *   upsert del snapshot entero (mismo criterio que `cliente.ubicacion_origen`).
 * - `gasto`: lo que el vendedor paga con la cobranza del dia. `id` = clave de
 *   idempotencia y, en el servidor, el id de la fila (D4). `campo_nombre` es una
 *   copia del nombre al guardar, para pintar sin join aunque la oficina lo
 *   renombre despues. No se edita ni se borra en la app (D9).
 * - La foto del ticket usa el **mismo esquema derivado** que la de la visita
 *   (013): `foto_local` + `foto_subida_en` + `foto_error` + `foto_descartada`.
 *   Ninguna toca `sync_estado`: una foto que falla no se lleva el gasto.
 */
export const gastos: Migracion = {
  version: 15,
  nombre: 'gastos',
  sql: `
    create table campo_egreso (
      id              text primary key,
      nombre          text not null,
      tipo            text not null,
      se_usa_en_app   integer not null default 0 check (se_usa_en_app in (0, 1)),
      activo          integer not null default 1,
      sincronizado_en text not null
    );

    create table gasto (
      id               text primary key,           -- = clave de idempotencia
      fecha            text not null,              -- dia de trabajo (fecha_operacion)
      vendedor_id      text not null references vendedor(id),
      sucursal_id      text not null references sucursal(id),
      campo_egreso_id  text not null references campo_egreso(id),
      campo_nombre     text not null,
      monto_centavos   integer not null check (monto_centavos > 0),
      comentario       text,
      registrado_en    text not null,              -- ISO; viaja como ocurrido_en
      foto_local       text,
      foto_subida_en   text,
      foto_error       text,
      foto_descartada  integer not null default 0 check (foto_descartada in (0, 1)),
      sync_estado      text not null default 'pendiente'
                         check (sync_estado in ('pendiente','enviando','sincronizado','error')),
      sync_error       text,
      sincronizado_en  text
    );

    -- Lo que falta por subir (mismo patron que idx_visita_sync).
    create index idx_gasto_sync on gasto (sync_estado) where sync_estado <> 'sincronizado';
    -- "Gastos de hoy" y su total.
    create index idx_gasto_vendedor_fecha on gasto (vendedor_id, fecha);
    -- La cola de fotos, como idx_visita_foto_pendiente (013).
    create index idx_gasto_foto_pendiente on gasto (sync_estado)
      where foto_local is not null and foto_subida_en is null and foto_descartada = 0;
  `,
};
```

En `apps/tablet/src/datos/migraciones/index.ts`, después de
`import { prospectoDomicilio } from './014-prospecto-domicilio';` agrega:

```ts
import { gastos } from './015-gastos';
```

y en el arreglo, después de `prospectoDomicilio,`:

```ts
  gastos,
```

- [ ] **Paso 4: correr y ver pasar**

Run: `npm test --workspace=apps/tablet -- migraciones`
Expected: PASS (013, 014 y 015 incluidas).

- [ ] **Paso 5: los tipos locales**

En `apps/tablet/src/datos/tipos.ts`, después de la interfaz `MotivoVisita` agrega:

```ts
/**
 * Un campo de egreso (T-30, D6): el catalogo de la pantalla Gastos. Baja en el
 * pull como `campos_egreso`; la baja viaja como `activo: 0`.
 */
export interface CampoEgreso {
  id: string;
  nombre: string;
  /** `produccion` | `operacion` | `financiero` (D1). Sin check local: ver la migracion 015. */
  tipo: string;
  /** `1` = la pantalla Gastos lo ofrece ("Se usa en la app"). */
  se_usa_en_app: Booleano;
  /** `0` = dado de baja en el portal: ya no se ofrece. */
  activo: Booleano;
  sincronizado_en: MomentoISO;
}
```

y después de la interfaz `Visita`:

```ts
/** Un gasto de la ruta (T-30/T-31, D8): lo que el vendedor pago con la cobranza del dia. */
export interface Gasto {
  id: string;
  /** Dia de trabajo (`reloj.hoy()`), el de `fecha_operacion`. */
  fecha: FechaISO;
  vendedor_id: string;
  sucursal_id: string;
  campo_egreso_id: string;
  /** Copia del nombre del campo al guardar: se pinta sin join. */
  campo_nombre: string;
  /** Entero > 0. */
  monto_centavos: number;
  comentario: string | null;
  /** Cuando lo guardo el vendedor. Viaja como `ocurrido_en` y `datos.registrado_en`. */
  registrado_en: MomentoISO;
  /** Ruta local de la foto del ticket ya comprimida, o `null`. */
  foto_local: string | null;
  /** Cuando la recibio el SERVIDOR. `null` = todavia no esta arriba. */
  foto_subida_en: MomentoISO | null;
  foto_error: string | null;
  /** `1` = no recuperable (413, 415, archivo perdido): no se reintenta. */
  foto_descartada: Booleano;
  sync_estado: SyncEstado;
  sync_error: string | null;
  sincronizado_en: MomentoISO | null;
}
```

- [ ] **Paso 6: la prueba del catálogo que falla**

En `apps/tablet/src/datos/pruebas-apoyo.ts`, dentro de `snapshotDePrueba()`, después del arreglo `motivosVisita`
agrega:

```ts
    camposEgreso: [
      { id: 'ce-gasolina', nombre: 'Gasolina', tipo: 'operacion', se_usa_en_app: 1, activo: 1 },
      { id: 'ce-hielo', nombre: 'Hielo', tipo: 'operacion', se_usa_en_app: 1, activo: 1 },
      // De la oficina: vivo pero sin "Se usa en la app"; la pantalla no lo ofrece.
      { id: 'ce-envases', nombre: 'Envases', tipo: 'produccion', se_usa_en_app: 0, activo: 1 },
      // Dado de baja en el portal: baja con la bandera.
      { id: 'ce-baja', nombre: 'Celular', tipo: 'operacion', se_usa_en_app: 1, activo: 0 },
    ],
```

Al final de `apps/tablet/src/datos/repositorios/catalogos.spec.ts` agrega:

```ts
describe('campos de egreso (T-30/T-31, D6)', () => {
  it('lista los activos por nombre, con y sin la casilla', () => {
    const { catalogos } = conCatalogos();
    expect(catalogos.listarCamposEgreso().map((c) => [c.nombre, c.se_usa_en_app])).toEqual([
      ['Envases', 0],
      ['Gasolina', 1],
      ['Hielo', 1],
    ]);
  });

  it('obtenerCampoEgreso encuentra tambien uno dado de baja (un gasto guardado lo nombra)', () => {
    const { catalogos } = conCatalogos();
    expect(catalogos.obtenerCampoEgreso('ce-baja')).toMatchObject({ nombre: 'Celular', activo: 0 });
    expect(catalogos.obtenerCampoEgreso('no-existe')).toBeNull();
  });

  it('la casilla y la baja llegan en el pull siguiente', () => {
    const { catalogos } = conCatalogos();
    catalogos.guardarSnapshot({
      camposEgreso: [
        { id: 'ce-hielo', nombre: 'Hielo', tipo: 'operacion', se_usa_en_app: 0, activo: 1 },
        { id: 'ce-gasolina', nombre: 'Gasolina', tipo: 'operacion', se_usa_en_app: 1, activo: 0 },
      ],
    });
    expect(catalogos.obtenerCampoEgreso('ce-hielo')?.se_usa_en_app).toBe(0);
    expect(catalogos.listarCamposEgreso().map((c) => c.id)).not.toContain('ce-gasolina');
  });
});
```

Run: `npm test --workspace=apps/tablet -- catalogos`
Expected: FAIL (`catalogos.listarCamposEgreso is not a function`; el typecheck de `ts-jest` también marca
`camposEgreso` como propiedad desconocida de `SnapshotCatalogos`).

- [ ] **Paso 7: el catálogo en el repositorio**

En `apps/tablet/src/datos/repositorios/catalogos.ts`:

1. En el `import type { … } from '../tipos'`, agrega `CampoEgreso,` (orden alfabético, antes de `Cliente,`).
2. En `SnapshotCatalogos`, después de `motivosVisita?: …;`:

```ts
  /** T-30/T-31. Coleccion nueva del pull: el catalogo de la pantalla Gastos. Baja como bandera. */
  camposEgreso?: Omit<CampoEgreso, 'sincronizado_en'>[];
```

3. En `COLUMNAS`, después de `motivo_visita: [...]`:

```ts
  campo_egreso: ['id', 'nombre', 'tipo', 'se_usa_en_app', 'activo'],
```

4. En `guardarSnapshot`, después de la línea del upsert de `motivo_visita`:

```ts
          // T-30/T-31: sin llaves foraneas hacia nadie; catalogo de empresa como motivo_visita.
          upsert(bd, 'campo_egreso', COLUMNAS.campo_egreso, snapshot.camposEgreso, ahora) +
```

5. Después del método `obtenerMotivoVisita`:

```ts
    /**
     * Campos de egreso **activos**, por nombre (T-30/T-31). Trae tambien los que
     * no tienen "Se usa en la app": filtrar es de `camposParaGasto`
     * (`src/estado/gasto.ts`), que es la regla con prueba.
     */
    listarCamposEgreso(): CampoEgreso[] {
      return bd.getAllSync<CampoEgreso>('select * from campo_egreso where activo = 1 order by nombre');
    },

    /**
     * Un campo por id, activo o no. Uno dado de baja (o sin la casilla) despues de
     * elegirlo sigue sirviendo para guardar el gasto (D5: el servidor lo acepta).
     */
    obtenerCampoEgreso(id: string): CampoEgreso | null {
      return bd.getFirstSync<CampoEgreso>('select * from campo_egreso where id = $id', { $id: id });
    },
```

Run: `npm test --workspace=apps/tablet -- catalogos`
Expected: PASS.

- [ ] **Paso 8: el pull baja `campos_egreso` (prueba y código)**

En `apps/tablet/src/sincronizacion/motor.spec.ts`, después del `describe('aSnapshot (T-39)', …)` agrega:

```ts
describe('aSnapshot (T-30/T-31)', () => {
  it('los campos de egreso bajan con la casilla booleana como 0/1 de SQLite', () => {
    const respuesta = respuestaPullDePrueba();
    respuesta.catalogos.campos_egreso = [
      { id: 'ce1', nombre: 'Hielo', tipo: 'operacion', se_usa_en_app: true, activo: 1 },
      { id: 'ce2', nombre: 'Envases', tipo: 'produccion', se_usa_en_app: false, activo: 0 },
    ];
    expect(aSnapshot(respuesta).camposEgreso).toEqual([
      { id: 'ce1', nombre: 'Hielo', tipo: 'operacion', se_usa_en_app: 1, activo: 1 },
      { id: 'ce2', nombre: 'Envases', tipo: 'produccion', se_usa_en_app: 0, activo: 0 },
    ]);
  });

  it('un servidor anterior no manda la coleccion: no se escribe nada', () => {
    expect(aSnapshot(respuestaPullDePrueba()).camposEgreso).toBeUndefined();
  });
});
```

Run: `npm test --workspace=apps/tablet -- sincronizacion/motor` → FAIL (`camposEgreso` es `undefined` en la primera).

En `apps/tablet/src/sincronizacion/motor.ts`, dentro de `aSnapshot`, después del bloque `motivosVisita: …,`:

```ts
    // T-30/T-31: un servidor anterior no manda la coleccion (`undefined` no
    // escribe nada: la pantalla Gastos dice que no hay catalogo). La casilla
    // llega booleana y SQLite guarda 0/1, como `exige_foto`.
    camposEgreso: c.campos_egreso?.map((ce) => ({
      ...ce,
      se_usa_en_app: ce.se_usa_en_app ? 1 : 0,
    })),
```

Y en el comentario de `FuenteOperaciones` (≈ línea 85), reemplaza:

```ts
 * la visita (T-39) y el alta de ruta (T-37), en
 * `proveedor-sesion.tsx`. Faltan gasto y merma (T-27/T-33).
```

por:

```ts
 * la visita (T-39), el gasto de la ruta (T-30/T-31) y el alta de ruta (T-37),
 * en `proveedor-sesion.tsx`. Falta la merma (T-33).
```

Run: `npm test --workspace=apps/tablet -- sincronizacion/motor` → PASS.

- [ ] **Paso 9: la prueba del repositorio de gastos que falla**

`apps/tablet/src/datos/repositorios/gastos.spec.ts`:

```ts
import { depsDePrueba, MOMENTO, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from './catalogos';
import {
  crearRepositorioGastos,
  ErrorGasto,
  MAX_MONTO_GASTO_CENTAVOS,
  type DatosRegistroGasto,
} from './gastos';
import { crearRepositorioJornadas, ErrorJornada } from './jornadas';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  return {
    deps,
    catalogos,
    jornadas: crearRepositorioJornadas(deps),
    gastos: crearRepositorioGastos(deps, { catalogos }),
  };
}

const captura = (cambios: Partial<DatosRegistroGasto> = {}): DatosRegistroGasto => ({
  vendedorId: 'ven-1',
  campoEgresoId: 'ce-gasolina',
  montoCentavos: 25050,
  comentario: null,
  fotoUri: 'file:///cache/ticket.jpg',
  ...cambios,
});

describe('repositorio de gastos (T-30/T-31, D8)', () => {
  it('registra el gasto pendiente de subir, con el dia, la hora, la sucursal y el nombre del campo', () => {
    const { gastos } = montar();
    const g = gastos.registrar(captura({ comentario: '  Pemex de la 5 ' }));
    expect(g).toMatchObject({
      fecha: '2026-08-07',
      vendedor_id: 'ven-1',
      sucursal_id: 'suc-tj',
      campo_egreso_id: 'ce-gasolina',
      campo_nombre: 'Gasolina',
      monto_centavos: 25050,
      comentario: 'Pemex de la 5',
      registrado_en: MOMENTO,
      foto_local: 'file:///cache/ticket.jpg',
      foto_subida_en: null,
      foto_descartada: 0,
      sync_estado: 'pendiente',
      sync_error: null,
    });
  });

  it('un comentario en blanco se guarda como null; uno de mas de 200 no se guarda', () => {
    const { gastos } = montar();
    expect(gastos.registrar(captura({ comentario: '   ' })).comentario).toBeNull();
    expect(gastos.registrar(captura({ comentario: 'x'.repeat(200) })).comentario).toHaveLength(200);
    expect(() => gastos.registrar(captura({ comentario: 'x'.repeat(201) }))).toThrow(ErrorGasto);
  });

  it('el monto es un entero de centavos mayor que 0 y dentro del tope', () => {
    const { gastos } = montar();
    expect(() => gastos.registrar(captura({ montoCentavos: 0 }))).toThrow(ErrorGasto);
    expect(() => gastos.registrar(captura({ montoCentavos: -500 }))).toThrow(ErrorGasto);
    expect(() => gastos.registrar(captura({ montoCentavos: 12.5 }))).toThrow(ErrorGasto);
    expect(() => gastos.registrar(captura({ montoCentavos: MAX_MONTO_GASTO_CENTAVOS + 1 }))).toThrow(ErrorGasto);
    expect(gastos.registrar(captura({ montoCentavos: MAX_MONTO_GASTO_CENTAVOS })).monto_centavos).toBe(
      MAX_MONTO_GASTO_CENTAVOS,
    );
  });

  it('un campo que el pull dio de baja o le quito la casilla con el formulario abierto SI se guarda (Review Focus)', () => {
    const { gastos, catalogos } = montar();
    // El vendedor eligio Hielo y Gasolina; mientras escribia el monto, el pull
    // le quito la casilla a Hielo y dio de baja Gasolina.
    catalogos.guardarSnapshot({
      camposEgreso: [
        { id: 'ce-hielo', nombre: 'Hielo', tipo: 'operacion', se_usa_en_app: 0, activo: 1 },
        { id: 'ce-gasolina', nombre: 'Gasolina', tipo: 'operacion', se_usa_en_app: 1, activo: 0 },
      ],
    });
    expect(gastos.registrar(captura({ campoEgresoId: 'ce-hielo' })).campo_nombre).toBe('Hielo');
    expect(gastos.registrar(captura({ campoEgresoId: 'ce-gasolina' })).campo_nombre).toBe('Gasolina');
    expect(gastos.registrar(captura({ campoEgresoId: 'ce-baja' })).campo_nombre).toBe('Celular');
  });

  it('un campo que la tablet no conoce no se guarda', () => {
    const { gastos } = montar();
    expect(() => gastos.registrar(captura({ campoEgresoId: 'no-existe' }))).toThrow(ErrorGasto);
  });

  it('con el dia cerrado no se registra (T-38) y no deja fila', () => {
    const { gastos, jornadas } = montar();
    const j = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    jornadas.cerrar(j.id, 20);
    expect(() => gastos.registrar(captura())).toThrow(ErrorJornada);
    expect(gastos.delDia('ven-1')).toEqual([]);
  });

  it('delDia trae los gastos del vendedor de ese dia en orden de captura', () => {
    const { gastos } = montar();
    const a = gastos.registrar(captura());
    const b = gastos.registrar(captura({ campoEgresoId: 'ce-hielo', montoCentavos: 8000 }));
    expect(gastos.delDia('ven-1').map((g) => g.id)).toEqual([a.id, b.id]);
    expect(gastos.delDia('ven-1', '2026-08-06')).toEqual([]);
    expect(gastos.delDia('ven-2')).toEqual([]);
  });

  it('totalDelDia suma TODOS los gastos del dia, subidos, por subir o rechazados (el efectivo ya salio)', () => {
    const { gastos } = montar();
    expect(gastos.totalDelDia('ven-1')).toBe(0);
    const a = gastos.registrar(captura({ montoCentavos: 25050 }));
    const b = gastos.registrar(captura({ campoEgresoId: 'ce-hielo', montoCentavos: 8000 }));
    gastos.registrar(captura({ montoCentavos: 1 }));
    gastos.marcarSincronizada(a.id);
    gastos.marcarError(b.id, 'campo-egreso-inexistente: El campo no existe.');
    expect(gastos.totalDelDia('ven-1')).toBe(33051);
    expect(gastos.totalDelDia('ven-1', '2026-08-06')).toBe(0);
  });

  it('la cola del push incluye los rechazados y saca los sincronizados', () => {
    const { gastos } = montar();
    const a = gastos.registrar(captura());
    const b = gastos.registrar(captura());
    gastos.marcarSincronizada(a.id);
    gastos.marcarError(b.id, 'gasto-id-ocupado: El id de este gasto ya está ocupado.');
    expect(gastos.pendientesDeSincronizar().map((g) => g.id)).toEqual([b.id]);
    expect(gastos.porId(b.id)).toMatchObject({
      sync_estado: 'error',
      sync_error: 'gasto-id-ocupado: El id de este gasto ya está ocupado.',
    });
    expect(gastos.porId(a.id)).toMatchObject({ sync_estado: 'sincronizado', sync_error: null, sincronizado_en: MOMENTO });
  });

  it('la foto solo se ofrece con el gasto ya sincronizado, y su fallo no toca sync_estado', () => {
    const { gastos } = montar();
    const g = gastos.registrar(captura());
    gastos.registrar(captura({ fotoUri: null }));
    expect(gastos.pendientesDeSubirFoto()).toEqual([]);
    gastos.marcarSincronizada(g.id);
    expect(gastos.pendientesDeSubirFoto().map((x) => x.id)).toEqual([g.id]);

    gastos.anotarErrorFoto(g.id, 'sin red');
    expect(gastos.porId(g.id)).toMatchObject({ sync_estado: 'sincronizado', foto_error: 'sin red' });
    gastos.marcarFotoSubida(g.id, '2026-08-07T16:00:00.000Z');
    expect(gastos.porId(g.id)).toMatchObject({ foto_subida_en: '2026-08-07T16:00:00.000Z', foto_error: null });
    expect(gastos.pendientesDeSubirFoto()).toEqual([]);
  });

  it('una foto descartada deja de ofrecerse y conserva la ruta local', () => {
    const { gastos } = montar();
    const g = gastos.registrar(captura());
    gastos.marcarSincronizada(g.id);
    gastos.descartarFoto(g.id, 'La foto pesa demasiado');
    expect(gastos.pendientesDeSubirFoto()).toEqual([]);
    expect(gastos.porId(g.id)).toMatchObject({ foto_descartada: 1, foto_local: 'file:///cache/ticket.jpg' });
  });

  it('grabar publica el cambio para que la lista se relea', () => {
    const { gastos, catalogos } = montar();
    const antes = catalogos.version();
    gastos.registrar(captura());
    expect(catalogos.version()).toBeGreaterThan(antes);
  });
});
```

Run: `npm test --workspace=apps/tablet -- repositorios/gastos`
Expected: FAIL (`Cannot find module './gastos'`).

- [ ] **Paso 10: el repositorio de gastos**

`apps/tablet/src/datos/repositorios/gastos.ts`:

```ts
import type { FechaISO, Gasto, MomentoISO } from '../tipos';
import type { RepositorioCatalogos } from './catalogos';
import { enTransaccion, type DepsRepositorio } from './deps';
import { exigirJornadaAbierta } from './jornadas';

/** Error de regla de negocio del gasto (no un fallo tecnico de SQLite). */
export class ErrorGasto extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorGasto';
  }
}

/** Los mismos topes que el servidor (`compras-egresos/datos-gasto.ts`). */
export const LARGO_MAX_COMENTARIO_GASTO = 200;
export const MAX_MONTO_GASTO_CENTAVOS = 999_999_999_999;

/** Lo que guarda la pantalla, ya validado por `validarGasto` (`src/estado/gasto.ts`). */
export interface DatosRegistroGasto {
  vendedorId: string;
  campoEgresoId: string;
  /** Entero, de 1 a {@link MAX_MONTO_GASTO_CENTAVOS}. */
  montoCentavos: number;
  comentario: string | null;
  /** Ruta local de la foto del ticket ya comprimida, o `null` (es opcional, D9). */
  fotoUri: string | null;
}

export type RepositorioGastos = ReturnType<typeof crearRepositorioGastos>;

/**
 * Los gastos de la ruta (T-30/T-31, D8): grabar, consultar el dia y las dos
 * colas (push y fotos). El metodo no se guarda: en la app siempre es
 * "Efectivo cobranza del día" y el servidor lo fija al proyectar.
 *
 * Un gasto grabado **no se edita ni se borra** en la app (D9): las correcciones
 * son del portal. Por eso no hay `editar` ni `eliminar` aqui.
 *
 * Recibe `catalogos` ya creado, como las visitas: es quien publica la version
 * que observan las pantallas y quien sabe que campos conoce la tablet.
 */
export function crearRepositorioGastos(
  { bd, reloj, generarId }: DepsRepositorio,
  { catalogos }: { catalogos: RepositorioCatalogos },
) {
  const repo = {
    /**
     * Graba un gasto en **una sola transaccion**, listo para subir.
     *
     * @throws {ErrorJornada} si el dia de hoy ya esta cerrado (T-38): primero el candado.
     * @throws {ErrorGasto} si la captura no se puede grabar.
     */
    registrar(datos: DatosRegistroGasto): Gasto {
      exigirJornadaAbierta({ bd, reloj }, datos.vendedorId);

      const vendedor = bd.getFirstSync<{ sucursal_id: string }>(
        'select sucursal_id from vendedor where id = $id',
        { $id: datos.vendedorId },
      );
      if (!vendedor) {
        throw new ErrorGasto('Este vendedor no está en la tablet. Sincroniza antes de registrar el gasto.');
      }

      // Activo o no, con casilla o sin ella: si el pull lo cambio con el
      // formulario abierto, el gasto se guarda igual (D5: el servidor tampoco
      // revisa "Se usa en la app"). Solo uno desconocido es un error.
      const campo = catalogos.obtenerCampoEgreso(datos.campoEgresoId);
      if (!campo) {
        throw new ErrorGasto('Ese campo no está en el catálogo de la tablet. Sincroniza y vuelve a elegirlo.');
      }

      if (
        !Number.isSafeInteger(datos.montoCentavos) ||
        datos.montoCentavos < 1 ||
        datos.montoCentavos > MAX_MONTO_GASTO_CENTAVOS
      ) {
        throw new ErrorGasto('El monto tiene que ser mayor que $0, con dos decimales a lo más.');
      }

      const comentario = recortar(datos.comentario);
      if (comentario !== null && comentario.length > LARGO_MAX_COMENTARIO_GASTO) {
        throw new ErrorGasto(
          `Las observaciones no pueden pasar de ${LARGO_MAX_COMENTARIO_GASTO} caracteres.`,
        );
      }

      const id = generarId();
      enTransaccion(bd, () => {
        bd.runSync(
          `insert into gasto (
             id, fecha, vendedor_id, sucursal_id, campo_egreso_id, campo_nombre,
             monto_centavos, comentario, registrado_en, foto_local, sync_estado
           ) values (
             $id, $fecha, $vendedor_id, $sucursal_id, $campo_egreso_id, $campo_nombre,
             $monto_centavos, $comentario, $registrado_en, $foto_local, 'pendiente'
           )`,
          {
            $id: id,
            // El dia de trabajo de la tablet (Tijuana): viaja como `fecha_operacion`
            // y el servidor nunca lo re-deriva de UTC.
            $fecha: reloj.hoy(),
            $vendedor_id: datos.vendedorId,
            $sucursal_id: vendedor.sucursal_id,
            $campo_egreso_id: campo.id,
            $campo_nombre: campo.nombre,
            $monto_centavos: datos.montoCentavos,
            $comentario: comentario,
            // La hora se toma al guardar.
            $registrado_en: reloj.ahora(),
            $foto_local: datos.fotoUri,
          },
        );
      });

      // Despues del commit: la lista de "Gastos de hoy" relee. Si un oyente
      // truena, el gasto ya esta grabado (mismo criterio que la visita).
      try {
        catalogos.publicarCambio();
      } catch {
        // Solo se pierde el refresco de pantallas abiertas.
      }

      const grabado = repo.porId(id);
      if (!grabado) throw new ErrorGasto('No se pudo leer el gasto recién grabado.');
      return grabado;
    },

    porId(id: string): Gasto | null {
      return bd.getFirstSync<Gasto>('select * from gasto where id = $id', { $id: id });
    },

    /** Gastos del vendedor en un dia, en orden de captura ("Gastos de hoy"). */
    delDia(vendedorId: string, fecha: FechaISO = reloj.hoy()): Gasto[] {
      return bd.getAllSync<Gasto>(
        `select * from gasto where vendedor_id = $vendedor_id and fecha = $fecha
          order by registrado_en, rowid`,
        { $vendedor_id: vendedorId, $fecha: fecha },
      );
    },

    /**
     * El total del dia, en centavos. Suma **todos** los gastos del dia, sin mirar
     * `sync_estado`: el efectivo ya salio de la bolsa del vendedor aunque el
     * servidor todavia no lo tenga, o lo haya rechazado.
     */
    totalDelDia(vendedorId: string, fecha: FechaISO = reloj.hoy()): number {
      const fila = bd.getFirstSync<{ total: number }>(
        `select coalesce(sum(monto_centavos), 0) as total from gasto
          where vendedor_id = $vendedor_id and fecha = $fecha`,
        { $vendedor_id: vendedorId, $fecha: fecha },
      );
      return fila?.total ?? 0;
    },

    /**
     * Lo que falta por subir, incluidos los rechazados (patron D19 de T-16):
     * se reintentan en la siguiente sincronizacion; la clave no cambia.
     */
    pendientesDeSincronizar(): Gasto[] {
      return bd.getAllSync<Gasto>(
        `select * from gasto where sync_estado in ('pendiente', 'error')
          order by fecha, registrado_en, rowid`,
      );
    },

    marcarSincronizada(id: string): void {
      bd.runSync(
        `update gasto set sync_estado = 'sincronizado', sincronizado_en = $en, sync_error = null
          where id = $id`,
        { $en: reloj.ahora(), $id: id },
      );
    },

    marcarError(id: string, motivo: string): void {
      bd.runSync(`update gasto set sync_estado = 'error', sync_error = $motivo where id = $id`, {
        $motivo: motivo,
        $id: id,
      });
    },

    // ----------------------------------------------------------------------
    // La foto del ticket (D8). Mismo reparto que la de la visita (`visitas.ts`):
    // estos `update` no mencionan `sync_estado` ni `sync_error`. Una foto que
    // falla no se lleva el gasto.
    // ----------------------------------------------------------------------

    /** Fotos por subir: de gastos ya sincronizados (antes no existe su fila arriba). */
    pendientesDeSubirFoto(): Gasto[] {
      return bd.getAllSync<Gasto>(
        `select * from gasto
          where sync_estado = 'sincronizado'
            and foto_local is not null
            and foto_subida_en is null
            and foto_descartada = 0
          order by fecha, registrado_en, rowid`,
      );
    },

    marcarFotoSubida(id: string, subidaEn: MomentoISO): void {
      bd.runSync(`update gasto set foto_subida_en = $en, foto_error = null where id = $id`, {
        $en: subidaEn,
        $id: id,
      });
    },

    anotarErrorFoto(id: string, motivo: string): void {
      bd.runSync(`update gasto set foto_error = $motivo where id = $id`, { $motivo: motivo, $id: id });
    },

    descartarFoto(id: string, motivo: string): void {
      bd.runSync(`update gasto set foto_descartada = 1, foto_error = $motivo where id = $id`, {
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

Run: `npm test --workspace=apps/tablet -- repositorios/gastos`
Expected: PASS (13 pruebas).

- [ ] **Paso 11: exportar y montar el repositorio**

En `apps/tablet/src/datos/index.ts`, después del bloque de exportaciones de `./repositorios/visitas` agrega:

```ts
export {
  crearRepositorioGastos,
  ErrorGasto,
  LARGO_MAX_COMENTARIO_GASTO,
  MAX_MONTO_GASTO_CENTAVOS,
} from './repositorios/gastos';
export type { DatosRegistroGasto, RepositorioGastos } from './repositorios/gastos';
```

En `apps/tablet/src/datos/inicializar.ts`:

1. Después de `import { crearRepositorioVisitas, type RepositorioVisitas } from './repositorios/visitas';`:

```ts
import { crearRepositorioGastos, type RepositorioGastos } from './repositorios/gastos';
```

2. En `CapaDatos`, después de `visitas: RepositorioVisitas;`:

```ts
  /** Gastos de la ruta capturados en la tablet (T-30/T-31). */
  gastos: RepositorioGastos;
```

3. En el objeto que devuelve `inicializarCapaDatos`, después de `visitas: crearRepositorioVisitas(deps, { catalogos }),`:

```ts
    gastos: crearRepositorioGastos(deps, { catalogos }),
```

- [ ] **Paso 12: la fuente del push (prueba que falla)**

`apps/tablet/src/sincronizacion/fuente-gastos.spec.ts`:

```ts
import { depsDePrueba, MOMENTO, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioGastos } from '@/datos/repositorios/gastos';

import { fuenteGastos } from './fuente-gastos';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const gastos = crearRepositorioGastos(deps, { catalogos });
  return { gastos, fuente: fuenteGastos(gastos) };
}

const captura = {
  vendedorId: 'ven-1',
  campoEgresoId: 'ce-hielo',
  montoCentavos: 8000,
  comentario: null,
  fotoUri: 'file:///cache/ticket.jpg',
};

describe('fuente de gastos (T-30/T-31, D5)', () => {
  it('sin gastos no hay nada que subir', () => {
    const { fuente } = montar();
    expect(fuente.tipo).toBe('gasto');
    expect(fuente.pendientes()).toEqual([]);
  });

  it('arma el sobre exacto del contrato: sin cliente_id, sin folio, la foto NO viaja', () => {
    const { gastos, fuente } = montar();
    const g = gastos.registrar({ ...captura, comentario: 'Bolsa de 5 kg' });
    const [op] = fuente.pendientes();
    expect(op).toEqual({
      clave: g.id,
      tipo: 'gasto',
      fecha_operacion: '2026-08-07',
      ocurrido_en: MOMENTO,
      datos: {
        campo_egreso_id: 'ce-hielo',
        monto_centavos: 8000,
        registrado_en: MOMENTO,
        comentario: 'Bolsa de 5 kg',
      },
    });
    expect(op).not.toHaveProperty('cliente_id');
    expect(op).not.toHaveProperty('folio');
  });

  it('aceptado sale de la cola; rechazado guarda el motivo y se reenvia con la misma clave', () => {
    const { gastos, fuente } = montar();
    const a = gastos.registrar(captura);
    const b = gastos.registrar(captura);
    fuente.marcarSincronizada(a.id);
    fuente.marcarError(b.id, 'campo-egreso-inexistente: El campo de egreso no existe en el catálogo.');
    expect(fuente.pendientes().map((o) => o.clave)).toEqual([b.id]);
    expect(gastos.porId(b.id)?.sync_estado).toBe('error');
  });
});
```

Run: `npm test --workspace=apps/tablet -- fuente-gastos` → FAIL (`Cannot find module './fuente-gastos'`).

- [ ] **Paso 13: la fuente del push**

`apps/tablet/src/sincronizacion/fuente-gastos.ts`:

```ts
import type { RepositorioGastos } from '@/datos/repositorios/gastos';

import type { DatosGasto, OperacionSaliente } from './contrato';
import type { FuenteOperaciones } from './motor';

/**
 * Los gastos de la ruta, como operaciones del push (T-30/T-31, D5).
 *
 * - **`clave`** es el `id` de la fila: no cambia, y en el servidor es el id del
 *   gasto (asi la foto del ticket se liga a el).
 * - **Sin `cliente_id` ni folio**: un gasto no es de un cliente ni una nota que
 *   nadie firme; el servidor rechaza el sobre que los traiga.
 * - `fecha_operacion` es el dia de trabajo de la tablet (`gasto.fecha`), nunca
 *   re-derivado de UTC: un gasto a las 17:30 de Tijuana cuenta ese dia.
 * - La foto **no** viaja aqui: sube despues por su canal (`fuente-fotos.ts`).
 *
 * Va despues de visitas y antes de rutas. Ver `fuentes.ts`.
 */
export function fuenteGastos(gastos: RepositorioGastos): FuenteOperaciones {
  return {
    tipo: 'gasto',

    pendientes(): OperacionSaliente[] {
      return gastos.pendientesDeSincronizar().map((g) => {
        const datos: DatosGasto = {
          campo_egreso_id: g.campo_egreso_id,
          monto_centavos: g.monto_centavos,
          registrado_en: g.registrado_en,
          comentario: g.comentario,
        };
        return {
          clave: g.id,
          tipo: 'gasto',
          fecha_operacion: g.fecha,
          ocurrido_en: g.registrado_en,
          datos,
        };
      });
    },

    marcarSincronizada: (clave) => gastos.marcarSincronizada(clave),
    marcarError: (clave, motivo) => gastos.marcarError(clave, motivo),
  };
}
```

Run: `npm test --workspace=apps/tablet -- fuente-gastos` → PASS.

- [ ] **Paso 14: orden del push y conteo de pendientes (pruebas que fallan)**

En `apps/tablet/src/sincronizacion/fuentes.spec.ts`:

1. Después de `import { crearRepositorioVisitas } from '@/datos/repositorios/visitas';` agrega
   `import { crearRepositorioGastos } from '@/datos/repositorios/gastos';`.
2. Cambia el comentario de `montar()` a `// Copia tal cual la funcion \`montar()\` de \`./pendientes.spec.ts\` (arma los siete repositorios).`
   y, en el objeto que devuelve, después de `visitas: crearRepositorioVisitas(deps, { catalogos }),` agrega
   `gastos: crearRepositorioGastos(deps, { catalogos }),`.
3. Reemplaza el `describe` entero por:

```ts
describe('fuentesDelPush (T-75, D3; T-30/T-31, D5)', () => {
  it('sube prospectos ANTES que ventas (T-75), visitas despues de cobranzas (T-39) y gastos despues de visitas (T-30/T-31)', () => {
    const datos = montar();
    expect(fuentesDelPush(datos).map((f) => f.tipo)).toEqual([
      'jornada',
      'prospecto',
      'venta',
      'cobranza',
      'visita',
      'gasto',
      'ruta-alta',
    ]);
  });
});
```

En `apps/tablet/src/sincronizacion/pendientes.spec.ts`:

1. Agrega `import { crearRepositorioGastos } from '@/datos/repositorios/gastos';` junto a los demás imports de
   repositorios, y en `montar()`, después de `visitas: …,`, `gastos: crearRepositorioGastos(deps, { catalogos }),`.
2. En la prueba grande, cambia el comentario de arriba a "Las 7 fuentes del push de hoy (T-07, T-16, T-40, T-20,
   T-39, T-30/T-31, T-37)", el título a `'suma jornada, venta, prospecto, cobranza, visita, gasto y alta de ruta pendientes'`,
   la desestructuración a `const { jornadas, ventas, prospectos, cobranzas, visitas, gastos, rutas } = fuentes;`, y
   después del `visitas.registrar({...});` agrega:

```ts
    gastos.registrar({
      vendedorId: 'ven-1',
      campoEgresoId: 'ce-gasolina',
      montoCentavos: 25050,
      comentario: null,
      fotoUri: null,
    });
```

3. Cambia `expect(contarPendientesDeSubir(fuentes)).toBe(6);` por `expect(contarPendientesDeSubir(fuentes)).toBe(7);`.

Run: `npm test --workspace=apps/tablet -- sincronizacion/fuentes sincronizacion/pendientes`
Expected: FAIL (falta `'gasto'` en el orden; el conteo da 6; `gastos` sobra en el tipo `FuentesConPendientes`).

- [ ] **Paso 15: orden del push y conteo de pendientes (código)**

En `apps/tablet/src/sincronizacion/pendientes.ts`:

1. Agrega `import type { RepositorioGastos } from '@/datos/repositorios/gastos';` (orden alfabético, después de
   `cobranzas`).
2. En `FuentesConPendientes`, después de `visitas: RepositorioVisitas;`:

```ts
  /** T-30/T-31: los gastos de la ruta. */
  gastos: RepositorioGastos;
```

3. Reemplaza el comentario y el cuerpo de `contarPendientesDeSubir`:

```ts
/**
 * Cuenta lo que falta por subir, sumando las 7 fuentes del push de hoy (T-07,
 * T-16, T-40, T-20, T-39, T-30/T-31, T-37): jornada, venta, prospecto, cobranza,
 * visita, gasto y alta de ruta.
 *
 * Si una fuente se queda fuera de esta suma, el menu de la jornada y "cerrar
 * el dia" pueden decir "listo" con datos todavia sin subir (I-1, PR #90) — por
 * eso vive en una sola funcion que usan las dos pantallas, en vez de que cada
 * una repita (y arriesgue olvidar) la lista de fuentes.
 */
export function contarPendientesDeSubir(datos: FuentesConPendientes): number {
  return (
    datos.jornadas.pendientesDeSincronizar().length +
    datos.ventas.pendientesDeSincronizar().length +
    datos.prospectos.pendientesDeSincronizar().length +
    datos.cobranzas.pendientesDeSincronizar().length +
    datos.visitas.pendientesDeSincronizar().length +
    datos.gastos.pendientesDeSincronizar().length +
    datos.rutas.pendientesDeSincronizar().length
  );
}
```

En `apps/tablet/src/sincronizacion/fuentes.ts`:

1. Agrega `import { fuenteGastos } from './fuente-gastos';` (orden alfabético, después de `fuente-cobranzas`).
2. En el comentario, después de la viñeta de visitas, agrega:

```ts
 * - Gastos despues de visitas (T-30/T-31, D5): no dependen de ningun cliente;
 *   van antes de las altas de ruta para que el orden del spec quede fijo.
```

3. En el arreglo, después de `fuenteVisitas(datos.visitas),` agrega `fuenteGastos(datos.gastos),`.

Run: `npm test --workspace=apps/tablet -- sincronizacion/fuentes sincronizacion/pendientes` → PASS.

- [ ] **Paso 16: la cola de fotos gana los gastos (prueba que falla)**

En `apps/tablet/src/sincronizacion/fuente-fotos.spec.ts`, cambia el import de `./fuente-fotos` a:

```ts
import {
  combinarFuentesFotos,
  fuenteFotosGastos,
  fuenteFotosProspectos,
  fuenteFotosVisitas,
} from './fuente-fotos';
```

agrega `import { crearRepositorioGastos } from '@/datos/repositorios/gastos';` junto a los otros repositorios y, al
final del archivo:

```ts
describe('fotos de gastos en la cola combinada (T-30/T-31, D8)', () => {
  function montarTres() {
    const deps = depsDePrueba();
    const catalogos = crearRepositorioCatalogos(deps);
    catalogos.guardarSnapshot(snapshotDePrueba());
    const visitas = crearRepositorioVisitas(deps, { catalogos });
    const gastos = crearRepositorioGastos(deps, { catalogos });
    const fuente = combinarFuentesFotos([
      fuenteFotosProspectos(crearRepositorioProspectos(deps, { catalogos })),
      fuenteFotosVisitas(visitas),
      fuenteFotosGastos(gastos),
    ]);
    return { visitas, gastos, fuente };
  }

  const gastoCon = (fotoUri: string | null) => ({
    vendedorId: 'ven-1',
    campoEgresoId: 'ce-gasolina',
    montoCentavos: 25050,
    comentario: null,
    fotoUri,
  });

  it('la foto del ticket sale solo cuando el gasto ya esta sincronizado; sin foto no aparece', () => {
    const { gastos, fuente } = montarTres();
    const g = gastos.registrar(gastoCon('file:///cache/ticket.jpg'));
    const sinFoto = gastos.registrar(gastoCon(null));
    expect(fuente.pendientes()).toEqual([]);
    gastos.marcarSincronizada(g.id);
    gastos.marcarSincronizada(sinFoto.id);
    expect(fuente.pendientes()).toEqual([{ clave: g.id, uri: 'file:///cache/ticket.jpg' }]);
  });

  it('visitas antes que gastos, y cada resultado vuelve a SU repositorio', () => {
    const { visitas, gastos, fuente } = montarTres();
    const v = visitas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      motivoVisitaId: 'mot-cerrado',
      observaciones: null,
      atendio: null,
      lat: 32.5,
      lng: -117,
      precisionM: null,
      direccionTexto: null,
      fotoUri: 'file:///cache/v.jpg',
    });
    visitas.marcarSincronizada(v.id);
    const g = gastos.registrar(gastoCon('file:///cache/ticket.jpg'));
    gastos.marcarSincronizada(g.id);

    expect(fuente.pendientes().map((f) => f.clave)).toEqual([v.id, g.id]);
    fuente.marcarSubida(g.id, '2026-08-07T16:00:00.000Z');
    fuente.anotarError(v.id, 'sin red');

    expect(gastos.porId(g.id)).toMatchObject({ foto_subida_en: '2026-08-07T16:00:00.000Z', sync_estado: 'sincronizado' });
    expect(visitas.porId(v.id)).toMatchObject({ foto_error: 'sin red', foto_subida_en: null });
    expect(gastos.porId(g.id)?.foto_error).toBeNull();
  });
});
```

Run: `npm test --workspace=apps/tablet -- fuente-fotos` → FAIL (`fuenteFotosGastos` no existe).

- [ ] **Paso 17: la fuente de fotos de gastos, la cola y el destino de la cámara**

En `apps/tablet/src/sincronizacion/fuente-fotos.ts`:

1. Agrega `import type { RepositorioGastos } from '@/datos/repositorios/gastos';` como primer import.
2. En el comentario de `FotoPorSubir.clave`, cambia "del prospecto **o de la visita**" por "del prospecto, de la
   visita **o del gasto**" y "(`cliente-<id>.jpg`, `visita-<id>.jpg`, T-78)" por
   "(`cliente-<id>.jpg`, `visita-<id>.jpg`, T-78; `gasto-<id>.jpg`, T-30/T-31)".
3. Después de `fuenteFotosVisitas` agrega:

```ts
/**
 * Las fotos de los tickets de gasto (T-30/T-31, D8). Opcionales: un gasto sin
 * foto nunca aparece. `pendientesDeSubirFoto()` ya exige
 * `sync_estado = 'sincronizado'`: antes de que el servidor acepte el gasto no
 * existe la fila a la que la foto pertenece (el canal responde 404/409).
 */
export function fuenteFotosGastos(gastos: RepositorioGastos): FuenteFotos {
  return {
    tipo: 'gasto',
    pendientes(): FotoPorSubir[] {
      return gastos
        .pendientesDeSubirFoto()
        .flatMap((g) => (g.foto_local === null ? [] : [{ clave: g.id, uri: g.foto_local }]));
    },
    marcarSubida: (clave, subidaEn) => gastos.marcarFotoSubida(clave, subidaEn),
    anotarError: (clave, motivo) => gastos.anotarErrorFoto(clave, motivo),
    descartar: (clave, motivo) => gastos.descartarFoto(clave, motivo),
  };
}
```

En `apps/tablet/src/estado/proveedor-sesion.tsx`:

1. El import de `@/sincronizacion/fuente-fotos` pasa a:

```ts
import {
  combinarFuentesFotos,
  fuenteFotosGastos,
  fuenteFotosProspectos,
  fuenteFotosVisitas,
} from '@/sincronizacion/fuente-fotos';
```

2. El bloque `fotos:` del motor pasa a:

```ts
      // T-40 / T-39 / T-30-31: el canal de la foto, aparte del lote del push. Corre
      // despues, y solo para prospectos, visitas y gastos que el servidor ya acepto
      // — antes no existe la fila a la que la foto pertenece. Una cola, varias fuentes.
      fotos: {
        fuente: combinarFuentesFotos([
          fuenteFotosProspectos(datos.prospectos),
          fuenteFotosVisitas(datos.visitas),
          fuenteFotosGastos(datos.gastos),
        ]),
        api: crearClienteFotosExpo(),
      },
```

En `apps/tablet/src/fotos/expo.ts`:

1. Reemplaza:

```ts
/** Para que es la foto: cambia el texto del fallo, no la compresion (T-39, D9). */
export type DestinoFoto = 'prospecto' | 'visita';
```

por:

```ts
/** Para que es la foto: cambia el texto del fallo, no la compresion (T-39, D9; T-30/T-31). */
export type DestinoFoto = 'prospecto' | 'visita' | 'gasto';

/** "No se pudo tomar la foto …" según el destino. */
const QUE_FOTO: Record<DestinoFoto, string> = {
  prospecto: 'del lugar',
  visita: 'de la visita',
  gasto: 'del ticket',
};
```

2. En el `catch` de `capturarFoto`, reemplaza
`` : `No se pudo tomar la foto ${destino === 'visita' ? 'de la visita' : 'del lugar'}: ${error instanceof Error ? error.message : String(error)}`, ``
por
`` : `No se pudo tomar la foto ${QUE_FOTO[destino]}: ${error instanceof Error ? error.message : String(error)}`, ``.

Run: `npm test --workspace=apps/tablet -- fuente-fotos` → PASS.

- [ ] **Paso 18: suite, typecheck, lint y commit**

```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
```

Expected: todo en verde. El typecheck falla si la Tarea 4 no dejó `campos_egreso` en `RespuestaPull.catalogos` de la
copia de la tablet o si la Tarea 3 no dejó `DatosGasto`: **para** y avisa al controlador (no las agregues aquí; viven
en el mismo commit que el contrato del backend y `docs/contrato-sincronizacion.md`).

```bash
git add apps/tablet/src/datos/migraciones/015-gastos.ts apps/tablet/src/datos/migraciones/015-gastos.spec.ts \
  apps/tablet/src/datos/migraciones/index.ts apps/tablet/src/datos/migraciones/014-prospecto-domicilio.spec.ts \
  apps/tablet/src/datos/tipos.ts apps/tablet/src/datos/repositorios/catalogos.ts \
  apps/tablet/src/datos/repositorios/catalogos.spec.ts apps/tablet/src/datos/pruebas-apoyo.ts \
  apps/tablet/src/datos/repositorios/gastos.ts apps/tablet/src/datos/repositorios/gastos.spec.ts \
  apps/tablet/src/datos/index.ts apps/tablet/src/datos/inicializar.ts \
  apps/tablet/src/sincronizacion/motor.ts apps/tablet/src/sincronizacion/motor.spec.ts \
  apps/tablet/src/sincronizacion/fuente-gastos.ts apps/tablet/src/sincronizacion/fuente-gastos.spec.ts \
  apps/tablet/src/sincronizacion/fuentes.ts apps/tablet/src/sincronizacion/fuentes.spec.ts \
  apps/tablet/src/sincronizacion/pendientes.ts apps/tablet/src/sincronizacion/pendientes.spec.ts \
  apps/tablet/src/sincronizacion/fuente-fotos.ts apps/tablet/src/sincronizacion/fuente-fotos.spec.ts \
  apps/tablet/src/estado/proveedor-sesion.tsx apps/tablet/src/fotos/expo.ts
git commit -m "T-30/T-31: tablet: migración 015, repositorio de gastos, fuente del push y cola de fotos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 10: Tablet: lógica pura del gasto y la entrada real del menú (D9)

**Files:**
- Create: `apps/tablet/src/estado/gasto.ts`
- Create: `apps/tablet/src/estado/gasto.spec.ts`
- Modify: `apps/tablet/src/estado/ruta-del-dia.ts` (`SECCIONES_PENDIENTES` pierde `gastos`; `entradasMenu` gana la
  entrada real)
- Modify: `apps/tablet/src/estado/ruta-del-dia.spec.ts`

**Interfaces:**
- Consumes (Tarea 9): `LARGO_MAX_COMENTARIO_GASTO`, `MAX_MONTO_GASTO_CENTAVOS`, `DatosRegistroGasto`
  (`@/datos/repositorios/gastos`); tipos `CampoEgreso`, `Gasto` (`@/datos/tipos`). `leerMontoCentavos`
  (`@/datos/cobranzas-reglas`, T-20: solo dígitos y punto, hasta 2 decimales, sin coma flotante).
  `motivoDeRechazo`, `EstadoPastilla` (`./ruta-del-dia`).
- Produces (los usa la Tarea 11):
  - `TEXTO_METODO_GASTO = 'Efectivo cobranza del día'`.
  - `montoACentavos(texto: string): number | null`.
  - `camposParaGasto(campos: readonly CampoEgreso[]): CampoEgreso[]`.
  - `EntradaGasto { campo: Pick<CampoEgreso, 'id'> | null; monto: string; comentario: string; fotoUri: string | null;
    diaCerrado: boolean }`, `ValidacionGasto { faltantes: string[]; montoCentavos: number | null;
    gasto: Omit<DatosRegistroGasto, 'vendedorId'> | null }`, `validarGasto(e: EntradaGasto): ValidacionGasto`.
  - `pastillaGasto(g: Pick<Gasto, 'sync_estado' | 'sync_error'>): { texto: string; estado: EstadoPastilla;
    detalle: string | null }`.
  - `entradasMenu(diaCerrado)` con la entrada `{ clave: 'gastos', titulo: 'Gastos', destino: '/(jornada)/gastos' }`.

> **".5" es `null`**, a propósito: `montoACentavos` reusa `leerMontoCentavos` de la cobranza (T-20), que exige al
> menos un dígito antes del punto. Así "monto" se lee igual en las dos pantallas de dinero de la tablet; el vendedor
> escribe "0.50". Tampoco se acepta la coma (ni como decimal ni como miles): "1,50" no puede volverse $150 ni $1.50 en
> silencio.

- [ ] **Paso 1: la prueba que falla**

`apps/tablet/src/estado/gasto.spec.ts`:

```ts
import type { CampoEgreso } from '@/datos/tipos';

import {
  camposParaGasto,
  montoACentavos,
  pastillaGasto,
  TEXTO_METODO_GASTO,
  validarGasto,
  type EntradaGasto,
} from './gasto';

describe('montoACentavos (T-30/T-31, D9; Review Focus)', () => {
  it.each<[string, number | null]>([
    ['12.5', 1250],
    ['12.50', 1250],
    ['250.50', 25050],
    ['80', 8000],
    [' 80 ', 8000],
    ['0.29', 29],
    ['1.10', 110],
    ['0.01', 1],
    ['9999999999.99', 999_999_999_999],
    ['10000000000', null],
    ['12.345', null],
    ['0', null],
    ['0.00', null],
    ['-5', null],
    ['abc', null],
    ['', null],
    ['   ', null],
    ['.5', null],
    ['12.', null],
    ['1e3', null],
    ['1,250.50', null],
    ['12,5', null],
    ['$80', null],
  ])('%p son %p centavos', (texto, esperado) => {
    expect(montoACentavos(texto)).toBe(esperado);
  });
});

const campo = (id: string, nombre: string, se_usa_en_app: 0 | 1, activo: 0 | 1 = 1): CampoEgreso => ({
  id,
  nombre,
  tipo: 'operacion',
  se_usa_en_app,
  activo,
  sincronizado_en: '2026-10-20T00:00:00.000Z',
});

describe('camposParaGasto (D9)', () => {
  it('solo los activos con "Se usa en la app", por nombre en español', () => {
    const lista = [
      campo('r', 'Reparación del vehículo', 1),
      campo('e', 'Envases', 0),
      campo('h', 'Hielo', 1),
      campo('c', 'Celular', 1, 0),
      campo('a', 'Adelanto de sueldo', 1),
      campo('g', 'gasolina', 1),
    ];
    expect(camposParaGasto(lista).map((c) => c.id)).toEqual(['a', 'g', 'h', 'r']);
  });

  it('sin campos con la casilla, la lista queda vacia (la pantalla dice que no hay catalogo)', () => {
    expect(camposParaGasto([campo('e', 'Envases', 0)])).toEqual([]);
  });
});

const entrada = (cambios: Partial<EntradaGasto> = {}): EntradaGasto => ({
  campo: { id: 'ce-hielo' },
  monto: '80',
  comentario: '',
  fotoUri: null,
  diaCerrado: false,
  ...cambios,
});

describe('validarGasto (D9)', () => {
  it('campo y monto bastan: la foto y las observaciones son opcionales', () => {
    const r = validarGasto(entrada({ comentario: '   ' }));
    expect(r.faltantes).toEqual([]);
    expect(r.montoCentavos).toBe(8000);
    expect(r.gasto).toEqual({ campoEgresoId: 'ce-hielo', montoCentavos: 8000, comentario: null, fotoUri: null });
  });

  it('recorta las observaciones y pasa la foto tal cual', () => {
    const r = validarGasto(entrada({ comentario: ' Bolsa de 5 kg ', fotoUri: 'file:///t.jpg' }));
    expect(r.gasto).toEqual({
      campoEgresoId: 'ce-hielo',
      montoCentavos: 8000,
      comentario: 'Bolsa de 5 kg',
      fotoUri: 'file:///t.jpg',
    });
  });

  it('sin campo no se guarda', () => {
    const r = validarGasto(entrada({ campo: null }));
    expect(r.gasto).toBeNull();
    expect(r.faltantes).toEqual(['Elige el campo del gasto.']);
  });

  it('sin monto lo pide; un monto invalido dice por que', () => {
    expect(validarGasto(entrada({ monto: '  ' })).faltantes).toEqual(['Escribe el monto en pesos.']);
    for (const malo of ['0', '12.345', '-5', 'abc']) {
      const r = validarGasto(entrada({ monto: malo }));
      expect(r.gasto).toBeNull();
      expect(r.montoCentavos).toBeNull();
      expect(r.faltantes).toEqual(['El monto tiene que ser mayor que $0, con dos decimales a lo más.']);
    }
  });

  it('observaciones de 200 caracteres pasan; de 201 no', () => {
    expect(validarGasto(entrada({ comentario: 'x'.repeat(200) })).gasto?.comentario).toHaveLength(200);
    expect(validarGasto(entrada({ comentario: 'x'.repeat(201) })).faltantes).toEqual([
      'Las observaciones no pueden pasar de 200 caracteres.',
    ]);
  });

  it('con el dia cerrado no se guarda aunque todo este bien', () => {
    const r = validarGasto(entrada({ diaCerrado: true }));
    expect(r.gasto).toBeNull();
    expect(r.faltantes).toEqual(['El día ya está cerrado: no se pueden registrar gastos.']);
  });

  it('junta todo lo que falta, en el orden de la pantalla', () => {
    expect(validarGasto(entrada({ campo: null, monto: '', comentario: 'x'.repeat(201) })).faltantes).toEqual([
      'Elige el campo del gasto.',
      'Escribe el monto en pesos.',
      'Las observaciones no pueden pasar de 200 caracteres.',
    ]);
  });

  it('el metodo que se muestra es fijo', () => {
    expect(TEXTO_METODO_GASTO).toBe('Efectivo cobranza del día');
  });
});

describe('pastillaGasto (D9)', () => {
  it('por subir, subido y rechazado con su motivo sin el prefijo del codigo', () => {
    expect(pastillaGasto({ sync_estado: 'pendiente', sync_error: null })).toEqual({
      texto: 'por subir',
      estado: 'pendiente',
      detalle: null,
    });
    expect(pastillaGasto({ sync_estado: 'enviando', sync_error: null }).texto).toBe('por subir');
    expect(pastillaGasto({ sync_estado: 'sincronizado', sync_error: null })).toEqual({
      texto: 'subido',
      estado: 'listo',
      detalle: null,
    });
    expect(
      pastillaGasto({
        sync_estado: 'error',
        sync_error: 'campo-egreso-inexistente: El campo de egreso x no existe en el catálogo.',
      }),
    ).toEqual({
      texto: 'rechazado',
      estado: 'error',
      detalle: 'El campo de egreso x no existe en el catálogo.',
    });
  });
});
```

Run: `npm test --workspace=apps/tablet -- estado/gasto`
Expected: FAIL (`Cannot find module './gasto'`).

> Antes de dar por buena la prueba de `pastillaGasto`, abre `motivoDeRechazo`/`sinPrefijoDeCodigo` en
> `src/estado/ruta-del-dia.ts` y confirma que quitan el prefijo `codigo: `; la misma expectativa existe para
> `pastillaVisita` en `visita.spec.ts`. Si el formato fuera otro, copia el de esa prueba.

- [ ] **Paso 2: la lógica pura**

`apps/tablet/src/estado/gasto.ts`:

```ts
import { leerMontoCentavos } from '@/datos/cobranzas-reglas';
import {
  LARGO_MAX_COMENTARIO_GASTO,
  MAX_MONTO_GASTO_CENTAVOS,
  type DatosRegistroGasto,
} from '@/datos/repositorios/gastos';
import type { CampoEgreso, Gasto } from '@/datos/tipos';

import { motivoDeRechazo, type EstadoPastilla } from './ruta-del-dia';

/**
 * Lo que decide la pantalla "Gastos" (T-30/T-31, D9), sin React: la tablet no
 * tiene pruebas de pantalla, asi que toda la validacion vive aqui y la pantalla
 * solo la pinta (mismo criterio que `visita.ts`).
 */

/** El metodo se muestra fijo: en la app siempre se paga con la cobranza del dia (D9). */
export const TEXTO_METODO_GASTO = 'Efectivo cobranza del día';

/**
 * El texto del campo "Monto" a centavos, **sin coma flotante**: "12.5" son 1250
 * y "0.29" son 29 (con `Math.round(0.29 * 100)` tambien, pero con
 * `0.29 * 100` serian 28.999…). Reusa `leerMontoCentavos` de la cobranza (T-20):
 * solo digitos y punto, hasta dos decimales, al menos un digito antes del punto
 * (".5" no; se escribe "0.50"), sin coma ni signo. Ademas exige mas de $0 y no
 * pasar del tope del servidor. `null` = no se entiende o no vale.
 */
export function montoACentavos(texto: string): number | null {
  const centavos = leerMontoCentavos(texto);
  if (centavos === null || centavos < 1 || centavos > MAX_MONTO_GASTO_CENTAVOS) return null;
  return centavos;
}

/**
 * Los campos que ofrece la pantalla: activos y con "Se usa en la app", por
 * nombre en español ("Adelanto" antes que "gasolina" sin importar mayusculas).
 */
export function camposParaGasto(campos: readonly CampoEgreso[]): CampoEgreso[] {
  return campos
    .filter((c) => c.activo === 1 && c.se_usa_en_app === 1)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
}

/** Lo que el vendedor lleva capturado, tal cual (los textos sin recortar). */
export interface EntradaGasto {
  /** El campo elegido, leido por id (activo o no: ver `gastos.registrar`). */
  campo: Pick<CampoEgreso, 'id'> | null;
  monto: string;
  comentario: string;
  fotoUri: string | null;
  /** La jornada de hoy ya esta cerrada (`estadoMenuJornada`). */
  diaCerrado: boolean;
}

export interface ValidacionGasto {
  /** Lo que falta, en el orden de la pantalla. Vacio = se puede guardar. */
  faltantes: string[];
  /** El monto ya convertido, o `null` si no se entiende. */
  montoCentavos: number | null;
  /** Listo para `gastos.registrar` (sin vendedor), o `null` si falta algo. */
  gasto: Omit<DatosRegistroGasto, 'vendedorId'> | null;
}

/** La validacion entera del gasto. Pura: misma entrada, misma salida. */
export function validarGasto(e: EntradaGasto): ValidacionGasto {
  const faltantes: string[] = [];
  const montoCentavos = montoACentavos(e.monto);
  const comentario = e.comentario.trim() === '' ? null : e.comentario.trim();

  if (e.campo === null) faltantes.push('Elige el campo del gasto.');
  if (e.monto.trim() === '') faltantes.push('Escribe el monto en pesos.');
  else if (montoCentavos === null) {
    faltantes.push('El monto tiene que ser mayor que $0, con dos decimales a lo más.');
  }
  if (comentario !== null && comentario.length > LARGO_MAX_COMENTARIO_GASTO) {
    faltantes.push(`Las observaciones no pueden pasar de ${LARGO_MAX_COMENTARIO_GASTO} caracteres.`);
  }
  if (e.diaCerrado) faltantes.push('El día ya está cerrado: no se pueden registrar gastos.');

  return {
    faltantes,
    montoCentavos,
    gasto:
      faltantes.length === 0 && e.campo !== null && montoCentavos !== null
        ? { campoEgresoId: e.campo.id, montoCentavos, comentario, fotoUri: e.fotoUri }
        : null,
  };
}

/** La pastilla de UN gasto en "Gastos de hoy". */
export function pastillaGasto(
  g: Pick<Gasto, 'sync_estado' | 'sync_error'>,
): { texto: string; estado: EstadoPastilla; detalle: string | null } {
  switch (g.sync_estado) {
    case 'pendiente':
    case 'enviando':
      return { texto: 'por subir', estado: 'pendiente', detalle: null };
    case 'sincronizado':
      return { texto: 'subido', estado: 'listo', detalle: null };
    case 'error':
      return { texto: 'rechazado', estado: 'error', detalle: motivoDeRechazo(g.sync_error) };
  }
}
```

Run: `npm test --workspace=apps/tablet -- estado/gasto`
Expected: PASS.

- [ ] **Paso 3: el menú (prueba que falla)**

En `apps/tablet/src/estado/ruta-del-dia.spec.ts`, en `describe('menu hamburguesa (D9, D16)'`:

1. En la primera prueba, reemplaza `['Gastos', '/(jornada)/pendiente/gastos'],` por `['Gastos', '/(jornada)/gastos'],`.
2. La segunda prueba (`deshabilitadas` = `['gastos', 'inventario', 'merma']`) **no cambia**: con el día cerrado la
   entrada real sigue deshabilitada como las demás (D9).
3. Al final del `describe`, agrega:

```ts
  it('Gastos ya no es una seccion pendiente (T-30/T-31): abre su pantalla', () => {
    expect(esSeccionPendiente('gastos')).toBe(false);
    const gastos = entradasMenu(false).find((e) => e.clave === 'gastos');
    expect(gastos).toMatchObject({ titulo: 'Gastos', destino: '/(jornada)/gastos', deshabilitada: false });
    expect(gastos?.descripcion).not.toMatch(/Pendiente/);
  });
```

Run: `npm test --workspace=apps/tablet -- ruta-del-dia`
Expected: FAIL (el destino sigue siendo `/(jornada)/pendiente/gastos`).

- [ ] **Paso 4: el menú (código)**

En `apps/tablet/src/estado/ruta-del-dia.ts`:

1. En `SECCIONES_PENDIENTES`, borra la entrada `gastos: { … },` entera (quedan `inventario` y `merma`).
2. En el comentario de `entradasMenu`, cambia "se deshabilita solo lo que captura (gastos, inventario, merma)" por
   "se deshabilita solo lo que captura (gastos, inventario, merma; T-30/T-31 dio a Gastos su pantalla)".
3. En `entradasMenu`, reemplaza:

```ts
    ...(['gastos', 'inventario', 'merma'] as const).map((clave) => ({
```

por:

```ts
    {
      clave: 'gastos',
      titulo: 'Gastos',
      descripcion: 'Lo que pagaste hoy con la cobranza',
      destino: '/(jornada)/gastos',
      deshabilitada: diaCerrado,
    },
    ...(['inventario', 'merma'] as const).map((clave) => ({
```

Run: `npm test --workspace=apps/tablet -- ruta-del-dia estado/gasto`
Expected: PASS.

- [ ] **Paso 5: typecheck, lint y commit**

```bash
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
git add apps/tablet/src/estado/gasto.ts apps/tablet/src/estado/gasto.spec.ts \
  apps/tablet/src/estado/ruta-del-dia.ts apps/tablet/src/estado/ruta-del-dia.spec.ts
git commit -m "T-30/T-31: tablet: validarGasto, montoACentavos y la entrada Gastos del menú

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: typecheck y lint sin errores (`app/(jornada)/pendiente/[seccion].tsx` sigue compilando: solo usa
`esSeccionPendiente` y `SECCIONES_PENDIENTES`).

---

### Tarea 11: Tablet: pantallas Gastos y Registrar gasto, ficha y README (D9)

**Files:**
- Create: `apps/tablet/app/(jornada)/gastos/index.tsx` (lista "Gastos de hoy" y total)
- Create: `apps/tablet/app/(jornada)/gastos/registrar.tsx` (formulario)
- Modify: `apps/tablet/app/(jornada)/_layout.tsx` (dos `Stack.Screen` y el título de `registros`)
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx` (texto del botón secundario)
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/registros.tsx` (título y ticket)
- Modify: `apps/tablet/README.md`

**Interfaces:**
- Consumes (Tareas 9 y 10): `datos.gastos` (`registrar`, `delDia`, `totalDelDia`), `datos.catalogos.listarCamposEgreso`,
  `datos.catalogos.obtenerCampoEgreso`, `ErrorGasto` y `ErrorJornada` (`@/datos`), `camposParaGasto`, `validarGasto`,
  `pastillaGasto`, `TEXTO_METODO_GASTO` (`@/estado/gasto`), `capturarFoto('gasto')` (`@/fotos/expo`),
  `estadoMenuJornada` (`@/estado/menu-jornada`), `useJawa`, `useSesion`, componentes de `@/ui/*` (los mismos de
  `visita-sin-venta.tsx`).
- Produces: rutas `/(jornada)/gastos` (la del menú) y `/(jornada)/gastos/registrar`. Sin código que otra tarea consuma.

> **Dos rutas y no una**: la lista y el formulario son pantallas distintas del Stack (como ficha → visita). Al guardar,
> el formulario hace `router.back()` y la lista se relee sola (`catalogos.publicarCambio()` mueve `versionCatalogos`,
> y además `useFocusEffect`). `app/(jornada)/gastos/index.tsx` responde a `/(jornada)/gastos`, el destino del menú.
> `pendiente/[seccion].tsx` se queda para Inventario y Merma.

- [ ] **Paso 1: la lista "Gastos de hoy"**

`apps/tablet/app/(jornada)/gastos/index.tsx`:

```tsx
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import type { CampoEgreso } from '@/datos/tipos';
import { camposParaGasto, pastillaGasto } from '@/estado/gasto';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { Boton } from '@/ui/boton';
import { Cifra, pesos } from '@/ui/cifra';
import { formatearHora } from '@/ui/momento';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/**
 * Gastos (T-30/T-31, D9): lo que el vendedor pago hoy con la cobranza (hielo,
 * gasolina, una reparacion, un adelanto). Arriba "Gastos de hoy" con su
 * subida; abajo el total del dia, que suma TODOS (el efectivo ya salio aunque
 * el servidor no lo tenga). Un gasto grabado no se edita ni se borra aqui: las
 * correcciones son del portal.
 */
export default function Gastos() {
  const { datos, vendedor, jornada, versionCatalogos } = useJawa();
  const { ultimaSincronizacion } = useSesion();
  const { estilos } = useTema();
  const menu = estadoMenuJornada(jornada);

  // Se relee al volver del formulario (`router.back()` no vuelve a montar).
  const [vueltas, setVueltas] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setVueltas((n) => n + 1);
    }, []),
  );

  const campos = useMemo<CampoEgreso[]>(() => {
    void versionCatalogos;
    return camposParaGasto(datos.catalogos.listarCamposEgreso());
  }, [datos, versionCatalogos]);

  const hoy = useMemo(() => {
    void vueltas;
    void ultimaSincronizacion;
    void versionCatalogos;
    if (!vendedor) return { gastos: [], total: 0 };
    return {
      gastos: datos.gastos.delDia(vendedor.id),
      total: datos.gastos.totalDelDia(vendedor.id),
    };
  }, [datos, vendedor, vueltas, ultimaSincronizacion, versionCatalogos]);

  const sinCatalogo = campos.length === 0;

  return (
    <Pantalla titulo="Gastos" subtitulo="Lo que pagaste hoy con la cobranza del día">
      <Tarjeta etiqueta="Gastos de hoy">
        {hoy.gastos.length === 0 ? (
          <Text style={estilos.textoSuave}>Todavía no registras gastos hoy.</Text>
        ) : (
          hoy.gastos.map((g) => {
            const p = pastillaGasto(g);
            return (
              <View key={g.id} style={{ gap: espacio.xs, marginBottom: espacio.sm }}>
                <Text style={estilos.textoTarjeta}>
                  {g.campo_nombre} · <Cifra valor={pesos(g.monto_centavos)} /> ·{' '}
                  <Cifra valor={formatearHora(g.registrado_en)} />
                </Text>
                {g.comentario ? <Text style={estilos.textoSuave}>{g.comentario}</Text> : null}
                <Pastilla texto={p.texto} estado={p.estado} />
                {p.detalle ? <Text style={estilos.error}>{p.detalle}</Text> : null}
              </View>
            );
          })
        )}
      </Tarjeta>

      <Tarjeta estado={hoy.total > 0 ? 'accion' : 'neutro'} etiqueta="Total del día">
        <Cifra valor={pesos(hoy.total)} tamano="destacado" />
      </Tarjeta>

      {sinCatalogo ? (
        // Sin campos con "Se usa en la app" (nunca ha sincronizado, o la oficina
        // no marco ninguno): lo dice y no deja registrar.
        <Tarjeta estado="pendiente" etiqueta="Sin catálogo de gastos">
          <Text style={estilos.textoTarjeta}>
            Los campos de gasto bajan del portal con la sincronización. Sincroniza para poder registrar un gasto.
          </Text>
        </Tarjeta>
      ) : null}
      {menu.avisoDiaCerrado ? <Text style={estilos.error}>{menu.avisoDiaCerrado}</Text> : null}

      <Boton
        etiqueta="Registrar gasto"
        glifo="+"
        deshabilitado={sinCatalogo || !menu.operacionesHabilitadas}
        onPress={() => router.push('/(jornada)/gastos/registrar')}
        estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
      />
    </Pantalla>
  );
}
```

> Si `Tarjeta` no acepta `estado="accion"` en algún tema (el tipo `Estado` sí lo incluye), usa `'neutro'`; no inventes
> otro valor.

- [ ] **Paso 2: el formulario "Registrar gasto"**

`apps/tablet/app/(jornada)/gastos/registrar.tsx`:

```tsx
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Linking, Platform, Text, ToastAndroid } from 'react-native';

import { ErrorGasto, ErrorJornada, LARGO_MAX_COMENTARIO_GASTO } from '@/datos';
import type { CampoEgreso } from '@/datos/tipos';
import { camposParaGasto, TEXTO_METODO_GASTO, validarGasto } from '@/estado/gasto';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import { useJawa } from '@/estado/proveedor-jawa';
import type { FotoComprimida } from '@/fotos/comprimir';
import { capturarFoto } from '@/fotos/expo';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Opcion } from '@/ui/opcion';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/** El aviso breve al volver a la lista (como "Visita registrada"). En otra plataforma, un Alert. */
function avisar(texto: string) {
  if (Platform.OS === 'android') ToastAndroid.show(texto, ToastAndroid.SHORT);
  else Alert.alert(texto);
}

/**
 * Registrar gasto (T-30/T-31, D9): campo (los activos con "Se usa en la app"),
 * monto en pesos, observaciones (opcionales, hasta 200) y foto del ticket
 * (opcional). El metodo se muestra fijo. Funciona sin red. Toda la validacion es
 * `validarGasto` (`src/estado/gasto.ts`, con pruebas); aqui solo se pinta.
 */
export default function RegistrarGasto() {
  const { datos, vendedor, jornada, versionCatalogos } = useJawa();
  const { estilos } = useTema();
  const menu = estadoMenuJornada(jornada);

  const campos = useMemo<CampoEgreso[]>(() => {
    void versionCatalogos;
    return camposParaGasto(datos.catalogos.listarCamposEgreso());
  }, [datos, versionCatalogos]);

  const [campoId, setCampoId] = useState<string | null>(null);
  const [monto, setMonto] = useState('');
  const [comentario, setComentario] = useState('');
  const [foto, setFoto] = useState<FotoComprimida | null>(null);
  const [avisoFoto, setAvisoFoto] = useState<string | null>(null);
  const [camaraNegada, setCamaraNegada] = useState(false);
  const [tomandoFoto, setTomandoFoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guardia contra doble toque (leccion de T-39): `registrar()` genera un id
  // nuevo cada vez y `router.back()` deja la pantalla montada durante la
  // transicion, asi que un segundo toque en cola grabaria otro gasto. El ref
  // corta en el mismo tick; el estado deshabilita el boton.
  const guardando = useRef(false);
  const [guardado, setGuardado] = useState(false);

  // El campo elegido se lee por id, activo o no: si el pull lo da de baja o le
  // quita la casilla con la pantalla abierta, el gasto se guarda igual (D5).
  const campo = useMemo(() => {
    void versionCatalogos;
    return campoId === null ? null : datos.catalogos.obtenerCampoEgreso(campoId);
  }, [datos, campoId, versionCatalogos]);

  const validacion = validarGasto({
    campo,
    monto,
    comentario,
    fotoUri: foto?.uri ?? null,
    diaCerrado: !menu.operacionesHabilitadas,
  });

  async function tomarFoto() {
    setAvisoFoto(null);
    setTomandoFoto(true);
    try {
      const r = await capturarFoto('gasto');
      if (r.estado === 'ok') {
        setFoto(r.foto);
        setCamaraNegada(false);
        if (!r.foto.objetivoAlcanzado) setAvisoFoto('La foto quedó más pesada de lo normal; va a subir igual.');
        return;
      }
      if (r.estado === 'cancelado') return;
      if (r.estado === 'permiso-negado') {
        setCamaraNegada(true);
        setAvisoFoto('Sin permiso de cámara. La foto es opcional: puedes guardar el gasto sin ella.');
        return;
      }
      setAvisoFoto('No se pudo preparar la foto. Vuelve a intentarlo.');
    } finally {
      setTomandoFoto(false);
    }
  }

  function guardar() {
    setError(null);
    if (!vendedor) {
      setError('No hay vendedor con sesión iniciada.');
      return;
    }
    if (validacion.gasto === null) return;
    if (guardando.current) return;
    guardando.current = true;
    setGuardado(true);
    try {
      datos.gastos.registrar({ vendedorId: vendedor.id, ...validacion.gasto });
      avisar('Gasto registrado');
      router.back();
    } catch (e) {
      guardando.current = false;
      setGuardado(false);
      setError(e instanceof ErrorGasto || e instanceof ErrorJornada ? e.message : 'No se pudo guardar el gasto.');
    }
  }

  // Lo que falta solo se lista cuando el vendedor ya empezo a capturar: al abrir
  // el formulario vacio no se le regaña.
  const empezo = campoId !== null || monto !== '' || comentario !== '';

  return (
    <Pantalla titulo="Registrar gasto" subtitulo="Se paga con la cobranza del día">
      {campos.length === 0 ? (
        <Tarjeta estado="pendiente" etiqueta="Sin catálogo de gastos">
          <Text style={estilos.textoTarjeta}>
            Los campos de gasto bajan del portal con la sincronización. Sincroniza para poder registrar un gasto.
          </Text>
        </Tarjeta>
      ) : (
        <>
          <Text style={estilos.etiqueta}>Campo</Text>
          {campos.map((c) => (
            <Opcion key={c.id} etiqueta={c.nombre} seleccionada={c.id === campoId} onPress={() => setCampoId(c.id)} />
          ))}

          <Campo
            etiqueta="Monto en pesos"
            value={monto}
            onChangeText={setMonto}
            placeholder="0.00"
            keyboardType="decimal-pad"
            invalido={monto.trim() !== '' && validacion.montoCentavos === null}
          />

          <Campo
            etiqueta="Observaciones (opcional)"
            value={comentario}
            onChangeText={setComentario}
            placeholder="Lo que haya que recordar"
            maxLength={LARGO_MAX_COMENTARIO_GASTO}
            multiline
          />

          <Tarjeta etiqueta="Método">
            <Text style={estilos.textoTarjeta}>{TEXTO_METODO_GASTO}</Text>
          </Tarjeta>

          <Tarjeta estado={foto ? 'listo' : 'neutro'} etiqueta="Foto del ticket (opcional)">
            {foto ? <Pastilla texto="foto tomada" estado="listo" /> : null}
            <Boton
              etiqueta={foto ? 'Volver a tomar' : 'Tomar foto del ticket'}
              tono="neutra"
              glifo="◉"
              onPress={() => void tomarFoto()}
              ocupado={tomandoFoto}
              estilo={{ marginTop: espacio.sm }}
            />
            {avisoFoto ? <Text style={estilos.textoSuave}>{avisoFoto}</Text> : null}
            {camaraNegada ? (
              <Boton
                etiqueta="Abrir ajustes"
                tono="neutra"
                ancho="ajustado"
                onPress={() => void Linking.openSettings()}
                estilo={{ marginTop: espacio.sm }}
              />
            ) : null}
          </Tarjeta>
        </>
      )}

      {empezo && validacion.faltantes.length > 0 && campos.length > 0 ? (
        <Text style={estilos.textoSuave}>{validacion.faltantes.join(' ')}</Text>
      ) : null}
      {menu.avisoDiaCerrado ? <Text style={estilos.error}>{menu.avisoDiaCerrado}</Text> : null}
      {error ? <Text style={estilos.error}>{error}</Text> : null}

      <Boton
        etiqueta="Guardar"
        glifo="✓"
        deshabilitado={validacion.gasto === null || campos.length === 0 || guardado}
        onPress={guardar}
        estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
      />
    </Pantalla>
  );
}
```

> `Campo` con `cifra` forzaría `number-pad` (sin punto); por eso el monto usa `keyboardType="decimal-pad"` sin
> `cifra`. Si `LARGO_MAX_COMENTARIO_GASTO` no quedó reexportado en `@/datos` (Tarea 9, Paso 11), impórtalo de
> `@/datos/repositorios/gastos`.

- [ ] **Paso 3: el Stack, la ficha y la pantalla pendiente de registros**

En `apps/tablet/app/(jornada)/_layout.tsx`:

1. Reemplaza:

```tsx
      <Stack.Screen
        name="operacion/[clienteId]/registros"
        options={{ title: 'Merma, promoción, consumo y gastos' }}
      />
```

por:

```tsx
      <Stack.Screen
        name="operacion/[clienteId]/registros"
        options={{ title: 'Merma, promoción y consumo' }}
      />
```

2. Después de `<Stack.Screen name="prospectos" options={{ title: 'Prospectos' }} />` agrega:

```tsx
      <Stack.Screen name="gastos/index" options={{ title: 'Gastos' }} />
      <Stack.Screen name="gastos/registrar" options={{ title: 'Registrar gasto' }} />
```

En `apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx`, reemplaza:

```tsx
      {/* Secundario: sigue aqui hasta que T-27/T-31 den a la entrada del menu una
          pantalla real (hoy abre un "pendiente"); entonces se quita. */}
      {esProspecto ? null : (
        <View style={[estilos.rejilla, { marginTop: espacio.sm }]}>
          <BotonMenu
            titulo="Merma, promoción, consumo y gasto"
```

por:

```tsx
      {/* Secundario: sigue aqui hasta que T-27 de a la entrada del menu una
          pantalla real (hoy abre un "pendiente"); entonces se quita. El gasto ya
          tiene su pantalla en el menu (T-30/T-31). */}
      {esProspecto ? null : (
        <View style={[estilos.rejilla, { marginTop: espacio.sm }]}>
          <BotonMenu
            titulo="Merma, promoción y consumo"
```

En `apps/tablet/app/(jornada)/operacion/[clienteId]/registros.tsx`, reemplaza:

```tsx
      titulo="Merma, promoción, consumo y gasto"
      ticket="T-27 / T-31"
```

por:

```tsx
      titulo="Merma, promoción y consumo"
      ticket="T-27"
```

- [ ] **Paso 4: README de la tablet**

En `apps/tablet/README.md`:

1. En "Estructura", reemplaza la línea
   `│       ├── pendiente/         # secciones del menu que aun no existen (gastos, inventario, merma)` por:

```
│       ├── gastos/            # Gastos de hoy y Registrar gasto (T-30/T-31)
│       ├── pendiente/         # secciones del menu que aun no existen (inventario, merma)
```

2. Después de la sección "Visita sin venta (T-39)" (antes de "Pruebas"), agrega una sección de nivel 2 (dos `#`)
   titulada **Gastos de la ruta (T-30/T-31)** y, debajo del título, este texto (el título va fuera del bloque aquí
   solo para que el extractor de tareas no lo confunda con una sección del plan):

```markdown
Spec: `docs/superpowers/specs/2026-10-20-t-30-31-gastos-de-ruta-design.md`. Pantallas:
`app/(jornada)/gastos/index.tsx` (entrada **Gastos** del menú) y `app/(jornada)/gastos/registrar.tsx`.

- **Lista**: "Gastos de hoy" con campo, monto, hora y pastilla (por subir, subido, rechazado con su motivo) y el
  **total del día**, que suma todos los gastos de hoy sin importar si ya subieron (`gastos.totalDelDia`).
- **Registrar** (sin red): campo (solo los activos con "Se usa en la app", `camposParaGasto`), monto en pesos
  (`montoACentavos`: "12.5" → 1250; "12.345", "0", ".5" y la coma no valen), observaciones (≤ 200) y foto del ticket
  opcional (`capturarFoto('gasto')`). El método se muestra fijo: "Efectivo cobranza del día". Toda la validación es
  `validarGasto` (`src/estado/gasto.ts`, con pruebas). Ignora el segundo toque mientras guarda. Con el día cerrado o
  sin catálogo no deja registrar.
- **Datos** (migración 015, `src/datos/repositorios/gastos.ts`): `campo_egreso` baja con el pull (`campos_egreso`,
  casilla como 0/1); el gasto nace `pendiente` con `campo_nombre` copiado. Un campo dado de baja o sin la casilla
  después de elegirlo se guarda y sube igual. **Un gasto grabado no se edita ni se borra en la app**: las
  correcciones son del portal.
- **Sincroniza**: `fuente-gastos.ts` sube la operación `gasto` (sin `cliente_id` ni folio; clave = id) **después de
  visitas y antes de rutas** (`fuentesDelPush`). La foto sube por la cola combinada de fotos (`fuenteFotosGastos`)
  cuando el gasto ya está sincronizado; el servidor la guarda como `gasto-<id>.jpg`.
```

3. En "Pendiente (otros tickets)", reemplaza la última viñeta por:

```markdown
- **T-20 / T-27 / T-33 / T-41** — módulos de la jornada que todavía son placeholders (inventario, merma, Ruta y
  GPS). Los gastos ya tienen pantalla (T-30/T-31).
```

- [ ] **Paso 5: typecheck, lint, suite y export**

```bash
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm test --workspace=apps/tablet
npm run export --workspace=apps/tablet
```

Expected: todo en verde; el `export` (bundle de Metro) resuelve las dos rutas nuevas. Si `expo` ensucia
`apps/tablet/package.json` o `tsconfig.json`, revierte con `git checkout` esos archivos antes del commit.

- [ ] **Paso 6: commit**

```bash
git add "apps/tablet/app/(jornada)/gastos/index.tsx" "apps/tablet/app/(jornada)/gastos/registrar.tsx" \
  "apps/tablet/app/(jornada)/_layout.tsx" "apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx" \
  "apps/tablet/app/(jornada)/operacion/[clienteId]/registros.tsx" apps/tablet/README.md
git commit -m "T-30/T-31: tablet: pantallas Gastos y Registrar gasto; la ficha queda en merma, promoción y consumo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 12: Documentación del repo (CLAUDE.md)

**Files:**
- Modify: `CLAUDE.md` (bloque nuevo después del de Geocodificación de prospectos (T-72); una viñeta en Tesorería
  (T-28/T-29); el orden del push en Visita sin venta (T-39))
- Modify: `docs/superpowers/specs/2026-10-20-t-30-31-gastos-de-ruta-design.md` (solo si la ejecución cambió algo:
  anota la enmienda bajo "Decisiones")

**Interfaces:**
- Consumes: todo lo anterior. No produce código.

- [ ] **Paso 1: `CLAUDE.md`**

1. En el bloque de Tesorería (T-28 / T-29), reemplaza la última viñeta
   "- Las compras (T-30/T-31) entrarán igual: otra fuente más del arreglo `movimientos` de `reglas-saldo.ts`." por:

```markdown
  - **Gastos de la ruta (T-30/T-31)**: se **leen** de `gasto` (`tesoreria/gastos-tesoreria.repository.ts`, vivos con
    `metodo = 'efectivo_cobranza_dia'`, por fecha y sucursal del gasto) y restan en la cuenta destino vigente de
    `(sucursal, 'efectivo')`, la misma de la cobranza en efectivo (`destinoDe`). Sin destino salen en
    `gastosSinCuenta`. Evento `gasto-ruta` ("Gastos de ruta"), un total por día, cuenta y sucursal. Las compras de
    oficina del resto de T-31 entrarán igual.
```

2. En el bloque de Visita sin venta (T-39), reemplaza
   "- **Orden del push**: `jornadas → prospectos → ventas → cobranzas → visitas → rutas` (`fuentesDelPush`, con"
   por "- **Orden del push**: `jornadas → prospectos → ventas → cobranzas → visitas → gastos → rutas` (`fuentesDelPush`, con"
   (los gastos entraron con T-30/T-31; el resto de la viñeta no cambia).

3. Después del bloque de Geocodificación de prospectos (T-72) y antes de "Reportes y Excel (T-50 / T-15)", agrega:

```markdown
- **Gastos de la ruta y campos de egreso (T-30 / T-31).** El vendedor registra, sin red, lo que paga con la cobranza
  (hielo, gasolina, reparación, adelanto); el gasto sube como operación `gasto`, resta en Tesorería y la oficina lo
  consulta en *Finanzas → Gastos*. Spec: `docs/superpowers/specs/2026-10-20-t-30-31-gastos-de-ruta-design.md`. Las
  compras de oficina desde el portal (cualquier método, días anteriores) son el resto de T-31, otro ticket.
  - **Catálogo `campo_egreso`** global, con `tipo` fijo (`produccion`/`operacion`/`financiero`, un check, no tabla) y
    la casilla `se_usa_en_app`; baja lógica, nombre único entre vivos (`uq_campo_egreso_nombre`) y
    `creado_en`/`actualizado_en` con `set_actualizado_en()`. La baja se **rechaza con 409** si el campo tiene gastos
    vivos en el año en curso de Tijuana ("podrás darlo de baja el próximo año"). Backend en `compras-egresos/`
    (`/campos-egreso`, permiso `campo_egreso.gestionar`, grupo General); portal *Catálogo → Campos de egreso*
    (`/catalogo/campos-de-egreso`). Baja en
    el pull como `campos_egreso`.
  - **Tabla `gasto`**: `id` = clave de la operación; copia `campo_nombre` y `tipo` al proyectar; `metodo` fijo
    `efectivo_cobranza_dia`, `origen = 'app'`, `quien` = nombre del vendedor, `fecha` = `fecha_operacion` del sobre
    (nunca re-derivada de UTC). `vendedor_id` nulo y `origen = 'portal'` quedan para las compras de oficina.
  - **Operación `gasto`** (ya estaba en `TIPOS_OPERACION`; dejó de guardarse sin proyectar), sin subir
    `CONTRATO_ACTUAL`. Sin `cliente_id` ni folio. `prepararGasto` (`sincronizacion/despacho-gasto.ts`) valida la forma
    y `compras-egresos/gastos.service.ts` proyecta. Rechazos nuevos: `campo-egreso-inexistente` (uno **dado de baja sí
    entra**) y `gasto-id-ocupado` (motivo neutro). **El servidor no revisa "Se usa en la app"**: lo filtra la tablet.
    Las operaciones `gasto` viejas del buzón se quedan sin proyectar (sin relleno).
  - **Fotos**: `POST /sync/foto/:clave` acepta gastos (`gasto-<id>.jpg`, opcional). El portal la sirve en
    `GET /gastos/:id/foto` (permiso `gasto.ver`; otra sucursal = 404).
  - **Portal** *Finanzas → Gastos* (`/finanzas/gastos`): `GET /gastos?desde&hasta&sucursal&vendedor&campo` (permiso `gasto.ver`, grupo
    Finanzas; alcance de sucursal; máximo 366 días), con total. Cabe en 1366 px.
  - **Tablet** (migración local 015): `campo_egreso` y `gasto` (foto con el esquema derivado de la visita). Pantallas
    `app/(jornada)/gastos/` (entrada Gastos del menú); la lógica vive en `src/estado/gasto.ts` (`validarGasto`,
    `montoACentavos`, `camposParaGasto`), con pruebas. Un gasto grabado no se edita ni se borra en la app. El botón de
    la ficha queda en "Merma, promoción y consumo" (T-27).
  - **Nube**: la migración `20261020120000_gastos_ruta.sql` se sube a `sinmex dev` después del merge, con el protocolo
    de push (pre-flight: solo tablas nuevas, semilla y dos permisos).
```

- [ ] **Paso 2: revisar el spec**

Si alguna tarea cambió una decisión del spec durante la ejecución (por ejemplo, el nombre de un campo de la
respuesta), anótalo en el spec bajo "Decisiones" como enmienda con fecha. Si no cambió nada, no toques el spec.

- [ ] **Paso 3: commit**

```bash
git add CLAUDE.md
# solo si el spec cambió:
# git add docs/superpowers/specs/2026-10-20-t-30-31-gastos-de-ruta-design.md
git commit -m "T-30/T-31: documentación (CLAUDE.md)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Conflictos para el controlador

- **Supabase local compartido.** La Tarea 1 aplica una migración con `migration up --local` y regenera `schema.d.ts`.
  Si otra sesión dejó migraciones de otra rama aplicadas, `db:types` las arrastra: hay que quedarse solo con
  `CampoEgreso`, `Gasto` y sus entradas en `DB`. Nunca `db reset`, nunca nada contra `sinmex dev`.
- **Destinos de Tesorería compartidos entre suites.** `tesoreria_destino_cobranza` es global por sucursal y método:
  las pruebas de la Tarea 5 usan 2017-2018 (T-29 usa 2019) y borran sus cuentas y destinos en `afterAll`. Si una
  suite paralela falla por un destino ajeno, revisa fechas antes de tocar código.
- **El push de la migración a la nube** lo hace quien mergee (protocolo de `CLAUDE.md`), no esta rama. Son dos tablas
  nuevas (con su semilla) y dos permisos: el pre-flight no tiene filas que contar, pero el `migration list`
  antes/después va al PR.
- **Operaciones `gasto` viejas en el buzón** (D5): se quedan sin proyectar y sin relleno. Antes del merge, en local:
  `select count(*) from sync_operacion where tipo = 'gasto' and entidad_id is null;` solo informa; no se migra nada.
- **Vault** (`[[Compras y Egresos]]` —"Efectivo cobranza del día" es la cuenta destino del efectivo de la sucursal—,
  `[[Tesorería]]`, `[[Corte de caja]]`, `[[App Tablet]]`, Estado del proyecto y bitácora): lo actualiza el
  controlador tras la revisión final, no un subagente.
- **Aceptación manual en el emulador** (spec, "Pruebas"): sin red, registrar "Gasolina $250.50" con foto y "Hielo
  $80" → la lista muestra el total $330.50 → sincronizar → en Postgres local las dos filas de `gasto` y el archivo
  `gasto-<id>.jpg` → *Finanzas › Gastos* las muestra y Tesorería resta $330.50 del efectivo de TJ. La hace el
  controlador, con capturas.

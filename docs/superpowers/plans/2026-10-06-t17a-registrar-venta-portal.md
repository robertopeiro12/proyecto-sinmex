# T-17 (parte 1) · Registrar venta desde el Portal — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la oficina registre ventas desde el Portal (a nombre de un vendedor o como venta de mostrador "Oficina"), con el precio de la lista del cliente vigente en la fecha de la venta, folio de oficina `OF` emitido por el servidor y # de nota único por sucursal (también para la tablet).

**Architecture:** Una migración (`20261006120000_venta_portal`) abre `venta_nota.vendedor_id` y `cobranza_abono.vendedor_id` a null, agrega `origen` y `capturo_usuario_id`, el contador `folio_oficina_contador`, el índice único del # de nota y el check que reserva `OF`. En el backend, `ventas-cobranza/` gana su primer controller (`VentasController` → `VentasPortalService`), que resuelve precios a la fecha, emite el folio OF dentro de la transacción y llama al **mismo** `VentasService.registrarVenta` que usa la tablet (que solo gana `origen`, `metodoPagoContado` y `vendedorId` nullable). El push de la tablet traduce el `23505` del # de nota al código nuevo `num-nota-duplicada`. En el portal, una pantalla nueva `/operacion/registrar-venta`.

**Tech Stack:** NestJS 11 · Kysely · Postgres 17 (Supabase local) · pgTAP · Jest 30 + supertest (backend) · Next.js 15 / React 19 · Vitest 3 + Testing Library (portal) · Expo/TS (tablet: solo el contrato)

**Spec:** `docs/superpowers/specs/2026-10-06-t17a-registrar-venta-portal-design.md` — se cita como §N. Donde el plan decide algo que el spec no fija, lo marca **Decisión del plan**.

## Global Constraints

- **Rama:** `feature/t-17a-registrar-venta`, en `/Users/robertopeiro/Dev/personal/proyecto-sinmex`. No se cambia de rama, no se hace `push` ni PR dentro de las tareas.
- **Comandos desde la raíz** del repo con `--workspace=`, nunca entrando a `apps/*` (CLAUDE.md).
- **Idioma:** identificadores, comentarios y mensajes en español; **sin acentos en identificadores ni en comentarios de código** del backend (sí en los textos que lee el usuario). Los comentarios explican *por qué*.
- **Supabase local con el `--`:** `npm run supabase -- migration up --local` (sin el `--`, npm se come `--local` y aplica al destino equivocado). Nunca `db reset` sin avisar al controlador. Nunca nada contra `sinmex dev` (`.env.development` / `SINMEX_DEV_DB_URL`) en las tareas: la nube refleja `main` y la migración la empuja Roberto al mergear (CLAUDE.md).
- **`psql` no está en el host:** `docker exec -i supabase_db_proyecto-sinmex psql -U postgres -At -c "…"`.
- **`schema.d.ts` nunca se edita a mano:** se regenera con `npm run db:types --workspace=apps/backend` después de aplicar la migración en local.
- **Contrato de sincronización (CLAUDE.md):** "Si tocas uno, toca el otro y el `docs/` en el mismo commit" — `apps/backend/src/modules/sincronizacion/contrato.ts`, `apps/tablet/src/sincronizacion/contrato.ts` y `docs/contrato-sincronizacion.md`. El cambio es aditivo: `CONTRATO_ACTUAL` sigue en 1.
- **La tablet no cambia de comportamiento** salvo el código de rechazo nuevo `num-nota-duplicada` (§4.5): sigue mandando `origen: 'app'` y cobrando el contado en `efectivo`.
- **Folios (CLAUDE.md, ADR-0001/0007):** el folio de la tablet sigue siendo de la tablet. El de oficina es `{sucursal}{AAMMDD de la venta}OF{01..99}` (§4.4), lo emite el servidor **dentro de la transacción de la venta**, y ningún vendedor puede tener el segmento `OF`.
- **Folio ≠ clave de idempotencia; al desempatar un `23505` del push, primero la clave** (CLAUDE.md, T-14). Vale igual para el # de nota (§4.5).
- **`fecha_operacion`/fecha de la venta nunca se re-deriva de UTC.** "Hoy" es `hoyEnTijuana()` en el servidor y en el portal; las fechas se comparan como texto `AAAA-MM-DD`.
- **Permisos:** `POST /ventas` lleva `@RequierePermiso('venta.registrar')` (la clave ya existe en la semilla). Las dos lecturas solo exigen sesión y validan alcance de sucursal (403 si es ajena).
- **Dinero:** centavos enteros en lógica y cable; `numeric(12,2)` en Postgres; frontera `aCentavos`/`aPesos` de `apps/backend/src/modules/sincronizacion/dinero.ts`.
- **E2e:** toda suite arranca con `iniciarEnLocal(app)` de `./apoyo-servidor`, nunca `app.init()`. Los datos de prueba llevan `SUFIJO = \`${Date.now()}-${process.pid}\`` y se borran en `afterAll`.
- **`npm run lint --workspace=apps/backend` corre con `--fix`:** después, `git status --short` solo puede mostrar archivos de la tarea.
- **Commits:** `T-17: <qué>` y terminan con una línea en blanco y `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **"Hoy" en el borde del día en Tijuana**: una venta grabada a las 23:30 de Tijuana (ya es mañana en UTC) debe aceptar la fecha de hoy y rechazar la de mañana; el portal debe proponer la fecha de Tijuana y no la UTC. → pruebas de `revisarFechaVenta` (Task 6) y de `hoyEnTijuana` del portal (Task 7).
2. **Cambiar la fecha (o el cliente) después de capturar cantidades**: una presentación que a la nueva fecha ya no tiene precio no puede viajar en el payload aunque conserve su cantidad tecleada. → prueba "cambiar la fecha recarga precios…" (Task 7).
3. **Doble clic en Grabar**: no debe registrar dos ventas (ni quemar dos folios). → prueba "doble clic graba una sola vez" (Task 7).
4. **Grabar sin ninguna línea con piezas** (p. ej. un prospecto sin lista, todo deshabilitado): mensaje claro sin llamar al servidor. → prueba "no manda nada sin productos" (Task 7).
5. **Cantidades no enteras o negativas tecleadas** (`2.5`, `-1`): se avisa, no se convierten en 0 en silencio. → pruebas de `leerPiezas` y "cantidad no entera" (Task 7).

---

## Antes de la Task 1 (no es una tarea: solo comprobar)

```bash
git branch --show-current            # feature/t-17a-registrar-venta
git status --short                   # vacío
docker context ls                    # el contexto con * (colima o desktop-linux) — no asumas cuál
npm run supabase -- status           # stack local arriba; si no: npm run supabase start
npm run supabase -- migration list --local   # la última aplicada en local es 20260929120000
```

Si algo no coincide, **detente** y avisa al controlador.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `supabase/migrations/20261006120000_venta_portal.sql` | Crear: columnas, checks, índice del # de nota, `folio_oficina_contador`, `OF` reservado | 1 |
| `supabase/tests/99_venta_portal_test.sql` | Crear: pgTAP de la migración | 1 |
| `apps/backend/src/database/schema.d.ts` | Regenerar con `db:types` | 1 |
| `apps/backend/test/sincronizacion.e2e-spec.ts` | Modificar: # de nota único por venta en los fixtures (1); e2e de `num-nota-duplicada` (5) | 1, 5 |
| `apps/backend/src/modules/sincronizacion/folio.ts` | Modificar: `SEGMENTO_OFICINA` | 2 |
| `apps/backend/src/modules/sincronizacion/segmento-vendedor.ts` (+ spec) | Modificar: `MOTIVO_SEGMENTO_RESERVADO`; `asignarSegmento` salta `OF` | 2 |
| `apps/backend/src/modules/nomina-comisiones/vendedores.service.ts` (+ spec nuevo) | Modificar: rechaza `OF` en el alta | 2 |
| `apps/backend/src/scripts/crear-vendedor.ts` | Modificar: rechaza `OF` | 2 |
| `apps/backend/test/vendedores.e2e-spec.ts` | Modificar: e2e del rechazo | 2 |
| `apps/backend/src/modules/ventas-cobranza/folio-oficina.ts` (+ spec) | Crear: `folioDeOficina`, `FoliosOficinaAgotados` — puro | 3 |
| `apps/backend/src/modules/ventas-cobranza/folios-oficina.repository.ts` | Crear: `FoliosOficinaRepository.emitir` con el contador, recibe `trx` | 3 |
| `apps/backend/test/folios-oficina.e2e-spec.ts` | Crear: integración del contador contra Postgres | 3 |
| `apps/backend/src/modules/ventas-cobranza/ventas.service.ts` (+ spec) | Modificar: `ContextoVenta` (`vendedorId` nullable, `origen`, `metodoPagoContado`, `folio: string`), devuelve monto y status | 4 |
| `apps/backend/src/modules/ventas-cobranza/ventas.repository.ts` | Modificar: escribe `origen` y `capturo_usuario_id` | 4 |
| `apps/backend/src/modules/ventas-cobranza/cobranzas.repository.ts` | Modificar: `NuevoAbono.vendedorId` nullable | 4 |
| `apps/backend/src/modules/ventas-cobranza/cobranzas.service.ts` | Modificar: `ContextoCobranza` propio (ya no alias de `ContextoVenta`) | 4 |
| `apps/backend/src/modules/sincronizacion/despacho.ts` (+ spec) | Modificar: la proyección de venta lleva su `folio` (4) | 4 |
| `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts` | Modificar: contexto de venta con `origen: 'app'` (4); `num-nota-duplicada` (5) | 4, 5 |
| `apps/backend/src/modules/ventas-cobranza/nota-duplicada.ts` (+ spec) | Crear: `esNotaDuplicada`, `motivoNotaDuplicada` | 5 |
| `apps/backend/src/modules/sincronizacion/contrato.ts`, `apps/tablet/src/sincronizacion/contrato.ts`, `docs/contrato-sincronizacion.md` | Modificar: `num-nota-duplicada` | 5 |
| `apps/backend/src/modules/ventas-cobranza/venta-portal.ts` (+ spec) | Crear: `armarVentaPortal`, `revisarFechaVenta` — puro | 6 |
| `apps/backend/src/modules/ventas-cobranza/dto/registrar-venta.dto.ts` | Crear: DTO de `POST /ventas` | 6 |
| `apps/backend/src/modules/ventas-cobranza/ventas-portal.repository.ts` | Crear: lecturas del portal | 6 |
| `apps/backend/src/modules/ventas-cobranza/ventas-portal.service.ts` | Crear: catálogo, repartidores, registrar | 6 |
| `apps/backend/src/modules/ventas-cobranza/ventas.controller.ts` | Crear: `GET /ventas/catalogo`, `GET /ventas/repartidores`, `POST /ventas` | 6 |
| `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts` | Modificar: controller y providers | 3, 6 |
| `apps/backend/test/ventas.e2e-spec.ts` | Crear: e2e de §7 | 6 |
| `apps/portal/src/lib/ventas.ts` (+ test) | Crear: API y utilidades (`hoyEnTijuana`, `leerPiezas`, `formatearPesos`) | 7 |
| `apps/portal/src/components/ventas/pantalla-registrar-venta.tsx` (+ test) | Crear: la pantalla | 7 |
| `apps/portal/src/app/(portal)/operacion/registrar-venta/page.tsx` | Crear: la ruta | 7 |
| `apps/portal/src/components/layout/nav-config.ts` | Modificar: entrada "Registrar venta" | 7 |
| `CLAUDE.md` | Modificar: nota del folio de oficina | 8 |

---

## Task 1: Migración `venta_portal` + pgTAP + `db:types` + fixtures del push

**Files:**
- Create: `supabase/tests/99_venta_portal_test.sql`
- Create: `supabase/migrations/20261006120000_venta_portal.sql`
- Modify (regenerado): `apps/backend/src/database/schema.d.ts`
- Modify: `apps/backend/test/sincronizacion.e2e-spec.ts` (fixtures: `datosVenta`, `clienteConNotas`, `notaId`, y los inserts de `venta_nota` con `'9999'` y `'901'`)

**Interfaces:**
- Consumes: nada.
- Produces (base de datos, la usan las Tasks 3–6):
  - `venta_nota.vendedor_id uuid null`; `venta_nota.origen text not null default 'app'` (`'app' | 'portal'`); `venta_nota.capturo_usuario_id uuid null references usuario(id)`; check `ck_venta_nota_origen_actores`.
  - índice único parcial `uq_venta_nota_num_nota_sucursal` sobre `(sucursal_id, lower(btrim(num_nota))) where deleted_at is null` — su nombre es el `error.constraint` del `23505`.
  - `cobranza_abono.vendedor_id uuid null`.
  - tabla `folio_oficina_contador (sucursal_id uuid, fecha date, ultimo integer >= 1)`, PK `(sucursal_id, fecha)`.
  - check `ck_vendedor_folio_segmento_no_oficina` (`folio_segmento is distinct from 'OF'`).
  - En `schema.d.ts`: `VentaNota.vendedor_id: string | null`, `VentaNota.origen: Generated<string>`, `VentaNota.capturo_usuario_id: string | null`, `CobranzaAbono.vendedor_id: string | null`, `FolioOficinaContador` y `DB.folio_oficina_contador`.
  - En la e2e del push: `siguienteNota(): string` (un # de nota único por llamada).

- [ ] **Step 1: Escribir el pgTAP que falla**

Crear `supabase/tests/99_venta_portal_test.sql`:

```sql
begin;
select plan(18);

-- Venta registrada desde el portal (T-17, parte 1) y # de nota unico por
-- sucursal (#95).
--
-- Lo que se prueba es lo que la BASE garantiza aunque un script o una carga
-- futura entren por debajo del servicio: quien puede faltar en una venta, que
-- el # de nota no se repita en la sucursal, que nadie use el segmento de folio
-- de la oficina, y el contador del folio OF.
--
-- Nombres con prefijo `zz-pgtap`/`ZZ-pgtap`; fechas del contador en 2001 para
-- no chocar con ventas de prueba manuales.

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-t17', 'Vendedor pgTAP T-17', 'x', id
    from sucursal where codigo = 'TJ';
insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-t17-portal', 'Usuario pgTAP T-17', 'x', p.id, null
    from perfil p order by p.nombre limit 1;
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values
    ('ZZ-pgtap-T17 Cliente TJ', 'Domicilio', '000', 'cliente',
     (select id from lista_precio where nombre = 'Lista 1'),
     (select id from sucursal where codigo = 'TJ')),
    ('ZZ-pgtap-T17 Cliente MX', 'Domicilio', '000', 'cliente',
     (select id from lista_precio where nombre = 'Lista 1'),
     (select id from sucursal where codigo = 'MX'));

create temporary table _t17 on commit drop as
select
  (select id from sucursal where codigo = 'TJ') as tj,
  (select id from sucursal where codigo = 'MX') as mx,
  (select id from vendedor where login = 'zz-pgtap-t17') as vendedor,
  (select id from usuario where login = 'zz-pgtap-t17-portal') as usuario,
  (select id from cliente where nombre = 'ZZ-pgtap-T17 Cliente TJ') as cliente_tj,
  (select id from cliente where nombre = 'ZZ-pgtap-T17 Cliente MX') as cliente_mx;

------------------------------------------------------------------
-- Estructura
------------------------------------------------------------------

select has_column('venta_nota', 'origen',
  'la venta dice si nacio en la tablet o en el portal');
select has_column('venta_nota', 'capturo_usuario_id',
  'la venta del portal guarda quien la capturo');
select col_is_null('venta_nota', 'vendedor_id',
  'vendedor_id admite null: la venta de Oficina no tiene vendedor');
select col_is_null('cobranza_abono', 'vendedor_id',
  'el cobro de contado de una venta de Oficina no tiene cobrador');
select has_pk('folio_oficina_contador',
  'el contador del folio de oficina tiene llave (sucursal, fecha)');

------------------------------------------------------------------
-- Quien puede faltar en una venta
------------------------------------------------------------------

select lives_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id, origen, capturo_usuario_id)
    select 'ZZPGTAPT1701', '2026-10-06', cliente_tj, null, 100.00, 'ab-17',
           'contado', 41, 10, 'pagada', tj, 'portal', usuario
      from _t17$$,
  'acepta una venta de Oficina del portal: sin vendedor y con quien la capturo'
);

select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id)
    select 'ZZPGTAPT1702', '2026-10-06', cliente_tj, null, 0, 'ab-18',
           'credito', 41, 10, 'pendiente', tj
      from _t17$$,
  '23514',
  null,
  'una venta de la tablet (origen app, el default) no puede ir sin vendedor'
);

select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id, capturo_usuario_id)
    select 'ZZPGTAPT1703', '2026-10-06', cliente_tj, vendedor, 0, 'ab-19',
           'credito', 41, 10, 'pendiente', tj, usuario
      from _t17$$,
  '23514',
  null,
  'una venta de la tablet no lleva usuario que la capturo'
);

select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id, origen)
    select 'ZZPGTAPT1704', '2026-10-06', cliente_tj, vendedor, 0, 'ab-20',
           'credito', 41, 10, 'pendiente', tj, 'portal'
      from _t17$$,
  '23514',
  null,
  'una venta del portal tiene que decir quien la capturo'
);

select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id, origen)
    select 'ZZPGTAPT1705', '2026-10-06', cliente_tj, vendedor, 0, 'ab-21',
           'credito', 41, 10, 'pendiente', tj, 'tablet'
      from _t17$$,
  '23514',
  null,
  'origen solo puede ser app o portal'
);

------------------------------------------------------------------
-- # de nota unico por sucursal (#95)
------------------------------------------------------------------

select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id)
    select 'ZZPGTAPT1706', '2026-10-06', cliente_tj, vendedor, 0, '  AB-17 ',
           'credito', 41, 10, 'pendiente', tj
      from _t17$$,
  '23505',
  null,
  'el # de nota no se repite en la sucursal, sin importar mayusculas ni espacios'
);

select lives_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id, origen, capturo_usuario_id)
    select 'ZZPGTAPT1707', '2026-10-06', cliente_mx, null, 0, 'ab-17',
           'credito', 41, 10, 'pendiente', mx, 'portal', usuario
      from _t17$$,
  'el mismo # de nota si se permite en otra sucursal'
);

-- Parte 2 de T-17 eliminara ventas: una nota borrada libera su numero.
update venta_nota set deleted_at = now() where folio = 'ZZPGTAPT1701';

select lives_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id)
    select 'ZZPGTAPT1708', '2026-10-06', cliente_tj, vendedor, 0, 'ab-17',
           'credito', 41, 10, 'pendiente', tj
      from _t17$$,
  'una nota borrada libera su numero en la sucursal'
);

------------------------------------------------------------------
-- El segmento OF es de la oficina
------------------------------------------------------------------

select throws_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id, folio_segmento)
    select 'zz-pgtap-t17-of', 'Oscar Flores', 'x', tj, 'OF' from _t17$$,
  '23514',
  null,
  'ningun vendedor puede tener el segmento OF: es el de los folios de oficina'
);

------------------------------------------------------------------
-- Contador del folio de oficina
------------------------------------------------------------------

insert into folio_oficina_contador (sucursal_id, fecha, ultimo)
  select tj, '2001-01-01', 1 from _t17
  on conflict (sucursal_id, fecha)
  do update set ultimo = folio_oficina_contador.ultimo + 1;
insert into folio_oficina_contador (sucursal_id, fecha, ultimo)
  select tj, '2001-01-01', 1 from _t17
  on conflict (sucursal_id, fecha)
  do update set ultimo = folio_oficina_contador.ultimo + 1;

select is(
  (select f.ultimo from folio_oficina_contador f join _t17 t on f.sucursal_id = t.tj
    where f.fecha = '2001-01-01'),
  2,
  'dos emisiones del mismo dia y sucursal dejan el contador en 2'
);

insert into folio_oficina_contador (sucursal_id, fecha, ultimo)
  select tj, '2001-01-02', 1 from _t17
  on conflict (sucursal_id, fecha)
  do update set ultimo = folio_oficina_contador.ultimo + 1;

select is(
  (select f.ultimo from folio_oficina_contador f join _t17 t on f.sucursal_id = t.tj
    where f.fecha = '2001-01-02'),
  1,
  'otro dia empieza su propio contador en 1'
);

select throws_ok(
  $$insert into folio_oficina_contador (sucursal_id, fecha, ultimo)
    select tj, '2001-01-01', 1 from _t17$$,
  '23505',
  null,
  'un solo contador por sucursal y dia'
);

select throws_ok(
  $$insert into folio_oficina_contador (sucursal_id, fecha, ultimo)
    select mx, '2001-01-03', 0 from _t17$$,
  '23514',
  null,
  'el contador nunca vale menos de 1'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr pgTAP para verlo fallar**

Run: `npm run supabase -- test db`
Expected: FAIL en `99_venta_portal_test.sql` (la columna `origen` no existe / `folio_oficina_contador` no existe). El resto de archivos sigue en verde.

- [ ] **Step 3: Escribir la migración**

Crear `supabase/migrations/20261006120000_venta_portal.sql`:

```sql
-- Venta registrada desde el portal (T-17, parte 1) y # de nota unico por
-- sucursal (#95). Spec: docs/superpowers/specs/2026-10-06-t17a-registrar-venta-portal-design.md
--
-- Pre-flight antes de empujar a `sinmex dev` (protocolo de CLAUDE.md), los
-- dos deben dar 0:
--   select count(*) from vendedor where folio_segmento = 'OF';
--   select count(*) from (select 1 from venta_nota where deleted_at is null
--     group by sucursal_id, lower(btrim(num_nota)) having count(*) > 1) d;
-- Los checks de `origen` son vacuos sobre las filas existentes: el default
-- 'app' las rellena y todas tienen vendedor.

-- La venta de mostrador ("Oficina") no tiene vendedor: no genera comision y en
-- reportes sale como Oficina (§2). Hoy nada lee esta columna.
alter table venta_nota alter column vendedor_id drop not null;

alter table venta_nota
  add column origen text not null default 'app',
  -- Quien la capturo en el portal. No sustituye al vendedor: una venta que la
  -- oficina captura "como si fuera el vendedor" lleva a los dos.
  add column capturo_usuario_id uuid references usuario(id),
  add constraint ck_venta_nota_origen
    check (origen in ('app', 'portal')),
  -- La venta sin vendedor solo existe si nacio en el portal, y toda venta del
  -- portal dice quien la capturo.
  add constraint ck_venta_nota_origen_actores check (
    (origen = 'app' and vendedor_id is not null and capturo_usuario_id is null)
    or (origen = 'portal' and capturo_usuario_id is not null)
  );

-- #95: el # de la nota fisica no se repite dentro de la sucursal. Insensible a
-- mayusculas y espacios porque es texto tecleado a mano. Parcial para que, en
-- la parte 2, una nota eliminada libere su numero. Su nombre es el que el
-- servicio reconoce en el `23505` (`nota-duplicada.ts`).
create unique index uq_venta_nota_num_nota_sucursal
  on venta_nota (sucursal_id, lower(btrim(num_nota)))
  where deleted_at is null;

-- El cobro automatico de una venta de contado de Oficina no tiene cobrador.
alter table cobranza_abono alter column vendedor_id drop not null;

-- Folio de oficina (§4.4): `{sucursal}{AAMMDD}OF{01..99}`, emitido por el
-- SERVIDOR. El contador se incrementa con `insert ... on conflict do update`
-- dentro de la transaccion de la venta: si la venta falla el numero no se
-- quema, y dos usuarios grabando a la vez esperan uno al otro en la fila.
-- La fecha es la de la VENTA, no la de captura.
create table folio_oficina_contador (
  sucursal_id uuid not null references sucursal(id),
  fecha       date not null,
  ultimo      integer not null check (ultimo >= 1),
  primary key (sucursal_id, fecha)
);

-- Ningun vendedor puede tener el segmento de la oficina: su folio chocaria con
-- los OF. `is distinct from` deja pasar el null (vendedor sin segmento).
alter table vendedor
  add constraint ck_vendedor_folio_segmento_no_oficina
  check (folio_segmento is distinct from 'OF');
```

- [ ] **Step 4: Pre-flight en la base LOCAL (solo `select`)**

```bash
docker exec -i supabase_db_proyecto-sinmex psql -U postgres -At -c "select count(*) from vendedor where folio_segmento = 'OF';"
docker exec -i supabase_db_proyecto-sinmex psql -U postgres -At -c "select count(*) from (select 1 from venta_nota where deleted_at is null group by sucursal_id, lower(btrim(num_nota)) having count(*) > 1) d;"
```

Expected: `0` y `0`. Si alguno no es 0, **detente** y reporta las filas al controlador: no borres datos para que la migración pase.

- [ ] **Step 5: Aplicar la migración en local y correr pgTAP**

```bash
npm run supabase -- migration up --local
npm run supabase -- test db
```

Expected: la migración `20261006120000` aplicada; pgTAP `Result: PASS` (incluye las 18 de `99_venta_portal_test.sql`).

- [ ] **Step 6: Regenerar los tipos**

```bash
npm run db:types --workspace=apps/backend
git diff --stat apps/backend/src/database/schema.d.ts
git diff apps/backend/src/database/schema.d.ts
```

Expected: el diff solo toca `CobranzaAbono.vendedor_id` (→ `string | null`), `VentaNota` (`capturo_usuario_id: string | null`, `origen: Generated<string>`, `vendedor_id: string | null`), agrega `export interface FolioOficinaContador { fecha: Timestamp; sucursal_id: string; ultimo: number; }` y `folio_oficina_contador: FolioOficinaContador;` en `DB`. Si aparece cualquier otro hunk, **detente** (la base local tiene deriva) y avisa.

- [ ] **Step 7: Hacer únicos los # de nota de los fixtures del push**

Con el índice nuevo, `sincronizacion.e2e-spec.ts` falla: todas sus ventas usan `num_nota: '2346'` en la misma sucursal. Correrla primero para confirmarlo:

Run: `npm run test:e2e --workspace=apps/backend -- sincronizacion.e2e-spec`
Expected: FAIL (500 en el push de la segunda venta con `'2346'`).

En `apps/backend/test/sincronizacion.e2e-spec.ts`, reemplazar:

```ts
  /** `datos` validos de una venta (contrato §6), con lo que se quiera cambiar encima. */
  const datosVenta = (extra: Record<string, unknown> = {}) => ({
    num_nota: '2346',
```

por:

```ts
  /**
   * Un # de nota distinto en cada llamada. Desde T-17 (#95) el # de nota no se
   * repite en la sucursal (`uq_venta_nota_num_nota_sucursal`), y las ventas de
   * este archivo comparten sucursal; el SUFIJO evita chocar con restos de una
   * corrida anterior que no limpio.
   */
  let ultimaNota = 0;
  const siguienteNota = () => `e2e-${SUFIJO}-${++ultimaNota}`;

  /** `datos` validos de una venta (contrato §6), con lo que se quiera cambiar encima. */
  const datosVenta = (extra: Record<string, unknown> = {}) => ({
    num_nota: siguienteNota(),
```

En `clienteConNotas`, reemplazar `num_nota: '900',` por `num_nota: siguienteNota(),`.

En el `beforeAll` (la nota `notaId`), reemplazar `num_nota: '1234',` por `num_nota: siguienteNota(),`.

En la prueba que inserta la nota con `num_nota: '9999',`, reemplazarlo por `num_nota: siguienteNota(),`. En la que inserta la nota ajena con `num_nota: '901',`, reemplazarlo por `num_nota: siguienteNota(),`.

En la primera prueba de `describe('ventas (T-16)'`, reemplazar:

```ts
    it('una venta valida entra a venta_nota con su detalle, y el buzon dice a que fila se convirtio', async () => {
      const op = ventaValida();
```

por:

```ts
    it('una venta valida entra a venta_nota con su detalle, y el buzon dice a que fila se convirtio', async () => {
      const nota = siguienteNota();
      const op = ventaValida({ datos: datosVenta({ num_nota: nota }) });
```

y, dentro de esa misma prueba, en el `toMatchObject` de la venta, reemplazar `        num_nota: '2346',` por `        num_nota: nota,`.

Comprobar que no queda ningún literal:

Run: `grep -n "num_nota: '" apps/backend/test/sincronizacion.e2e-spec.ts`
Expected: solo la línea de `num_nota: '   '` (la prueba de `datos-invalidos`).

- [ ] **Step 8: Verificar build, unit y la e2e del push**

```bash
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend -- sincronizacion.e2e-spec
```

Expected: build limpio; unit en verde; e2e del push en verde.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20261006120000_venta_portal.sql supabase/tests/99_venta_portal_test.sql apps/backend/src/database/schema.d.ts apps/backend/test/sincronizacion.e2e-spec.ts
git commit -m "$(cat <<'EOF'
T-17: migracion de venta del portal, # de nota unico y contador de folio OF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Segmento `OF` reservado para la oficina

**Files:**
- Modify: `apps/backend/src/modules/sincronizacion/folio.ts` (agregar `SEGMENTO_OFICINA` tras `MAX_OPERACIONES_POR_DIA`)
- Modify: `apps/backend/src/modules/sincronizacion/segmento-vendedor.ts` (`MOTIVO_SEGMENTO_RESERVADO`, `asignarSegmento`)
- Modify: `apps/backend/src/modules/sincronizacion/segmento-vendedor.spec.ts`
- Create: `apps/backend/src/modules/nomina-comisiones/vendedores.service.spec.ts`
- Modify: `apps/backend/src/modules/nomina-comisiones/vendedores.service.ts:61-101` (`crear`)
- Modify: `apps/backend/src/scripts/crear-vendedor.ts` (tras `const segmento = candidatosDeSegmento(nombre)[0];`)
- Modify: `apps/backend/test/vendedores.e2e-spec.ts`

**Interfaces:**
- Consumes: el check `ck_vendedor_folio_segmento_no_oficina` (Task 1).
- Produces:
  - `export const SEGMENTO_OFICINA = 'OF';` en `sincronizacion/folio.ts` (lo usa la Task 3).
  - `export const MOTIVO_SEGMENTO_RESERVADO = 'Esas iniciales están reservadas para ventas de oficina; ajusta el nombre.';` en `sincronizacion/segmento-vendedor.ts`.
  - `VendedoresService.crear()` lanza `ConflictException(MOTIVO_SEGMENTO_RESERVADO)` cuando el primer candidato es `OF`, antes de hashear y sin insertar.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `apps/backend/src/modules/nomina-comisiones/vendedores.service.spec.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import type { PasswordService } from '../auth/password.service';
import { MOTIVO_SEGMENTO_RESERVADO } from '../sincronizacion/segmento-vendedor';
import type { VendedoresRepository } from './vendedores.repository';
import { VendedoresService } from './vendedores.service';

function montar() {
  const repo = {
    buscarSucursalUsuario: jest
      .fn()
      .mockResolvedValue({ id: 'sucursal-tj', codigo: 'TJ' }),
    crear: jest.fn().mockResolvedValue({ id: 'vendedor-1' }),
  };
  const password = { hashear: jest.fn().mockResolvedValue('hash') };
  const servicio = new VendedoresService(
    repo as unknown as VendedoresRepository,
    password as unknown as PasswordService,
  );
  return { servicio, repo, password };
}

describe('VendedoresService.crear: el segmento OF es de la oficina (T-17)', () => {
  it('rechaza un nombre cuyas iniciales dan OF, sin hashear ni insertar', async () => {
    const { servicio, repo, password } = montar();

    const error: unknown = await servicio
      .crear('usuario-1', {
        nombre: 'Oscar Flores',
        login: 'oflores',
        contrasena: 'secreta',
      })
      .catch((e: unknown) => e);

    // Rechazar, no ceder (ADR-0007): asignarle OL en silencio cambiaria las
    // iniciales con que la oficina reconoce sus folios.
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toBe(
      MOTIVO_SEGMENTO_RESERVADO,
    );
    expect(password.hashear).not.toHaveBeenCalled();
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('cualquier otro nombre sigue usando su primer candidato', async () => {
    const { servicio, repo } = montar();

    await servicio.crear('usuario-1', {
      nombre: 'Ana Perez',
      login: 'aperez',
      contrasena: 'secreta',
    });

    expect(repo.crear).toHaveBeenCalledWith(
      expect.objectContaining({ folioSegmento: 'AP', sucursalId: 'sucursal-tj' }),
    );
  });
});
```

En `apps/backend/src/modules/sincronizacion/segmento-vendedor.spec.ts`, agregar al final del archivo:

```ts
describe('el segmento OF es de la oficina (T-17)', () => {
  it('candidatosDeSegmento no lo esconde: el alta tiene que poder rechazarlo', () => {
    expect(candidatosDeSegmento('Oscar Flores')[0]).toBe('OF');
  });

  it('asignarSegmento nunca lo entrega, aunque este libre', () => {
    expect(asignarSegmento('Oscar Flores', new Set())).toBe('OL');
  });
});
```

En `apps/backend/test/vendedores.e2e-spec.ts`, agregar dentro del `describe` del alta (`POST /vendedores`), después de la prueba `'un vendedor desactivado en la sucursal sigue bloqueando sus iniciales'`:

```ts
    // T-17: OF es el segmento de los folios de oficina (TJ261006OF01). Se
    // rechaza igual que unas iniciales tomadas: no se cede a otra combinacion.
    it('rechaza un nombre cuyas iniciales dan OF, reservadas para la oficina', async () => {
      const res = await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Oscar Flores`,
          login: `e2e-oficina-${SUFIJO}`,
          contrasena: 'x',
        })
        .expect(409);

      expect((res.body as { message: string }).message).toContain(
        'reservadas para ventas de oficina',
      );
    });
```

- [ ] **Step 2: Correr para verlas fallar**

Run: `npm test --workspace=apps/backend -- vendedores.service.spec segmento-vendedor.spec`
Expected: FAIL — `MOTIVO_SEGMENTO_RESERVADO` no existe (error de compilación de ts-jest).

- [ ] **Step 3: Implementar**

En `apps/backend/src/modules/sincronizacion/folio.ts`, después de `export const MAX_OPERACIONES_POR_DIA = 99;`:

```ts

/**
 * El 5o segmento de los folios que emite el SERVIDOR para las ventas del
 * portal (T-17, §4.4 del spec): `TJ261006OF01`. Ningun vendedor puede tenerlo
 * (`ck_vendedor_folio_segmento_no_oficina`), asi que un folio de oficina nunca
 * choca con uno de tablet.
 */
export const SEGMENTO_OFICINA = 'OF';
```

En `apps/backend/src/modules/sincronizacion/segmento-vendedor.ts`, agregar al inicio del archivo, antes del bloque de comentario `/**\n * El 5o segmento del [[Folios|folio]]`:

```ts
import { SEGMENTO_OFICINA } from './folio';

```

Y después de `const SIN_ACENTOS = …;`:

```ts

/**
 * Lo que lee quien da de alta un vendedor cuyas iniciales dan `OF` (T-17). Se
 * rechaza en vez de ceder a la siguiente combinacion, igual que unas iniciales
 * tomadas (ADR-0007).
 */
export const MOTIVO_SEGMENTO_RESERVADO =
  'Esas iniciales están reservadas para ventas de oficina; ajusta el nombre.';
```

Reemplazar el cuerpo de `asignarSegmento`:

```ts
  return candidatosDeSegmento(nombre).find((c) => !ocupados.has(c)) ?? null;
```

por:

```ts
  // `OF` es de la oficina (T-17): este camino si cede, asi que lo salta.
  return (
    candidatosDeSegmento(nombre).find(
      (c) => c !== SEGMENTO_OFICINA && !ocupados.has(c),
    ) ?? null
  );
```

En `apps/backend/src/modules/nomina-comisiones/vendedores.service.ts`, reemplazar:

```ts
import { candidatosDeSegmento } from '../sincronizacion/segmento-vendedor';
```

por:

```ts
import { SEGMENTO_OFICINA } from '../sincronizacion/folio';
import {
  MOTIVO_SEGMENTO_RESERVADO,
  candidatosDeSegmento,
} from '../sincronizacion/segmento-vendedor';
```

y en `crear()` reemplazar:

```ts
    const segmento = candidatosDeSegmento(dto.nombre)[0];
    const passwordHash = await this.password.hashear(dto.contrasena);
```

por:

```ts
    const segmento = candidatosDeSegmento(dto.nombre)[0];
    // T-17: `OF` es el segmento de los folios de oficina. Se rechaza antes de
    // hashear: la base tambien lo impide (`ck_vendedor_folio_segmento_no_oficina`),
    // pero su error seria un 500 sin explicacion.
    if (segmento === SEGMENTO_OFICINA) {
      throw new ConflictException(MOTIVO_SEGMENTO_RESERVADO);
    }
    const passwordHash = await this.password.hashear(dto.contrasena);
```

En `apps/backend/src/scripts/crear-vendedor.ts`, reemplazar:

```ts
import { candidatosDeSegmento } from '../modules/sincronizacion/segmento-vendedor';
```

por:

```ts
import { SEGMENTO_OFICINA } from '../modules/sincronizacion/folio';
import {
  MOTIVO_SEGMENTO_RESERVADO,
  candidatosDeSegmento,
} from '../modules/sincronizacion/segmento-vendedor';
```

y justo después de `    const segmento = candidatosDeSegmento(nombre)[0];`:

```ts
    // T-17: misma regla que el portal; OF es de los folios de oficina.
    if (segmento === SEGMENTO_OFICINA) {
      throw new Error(MOTIVO_SEGMENTO_RESERVADO);
    }
```

- [ ] **Step 4: Correr las pruebas**

```bash
npm test --workspace=apps/backend -- vendedores.service.spec segmento-vendedor.spec
npm run test:e2e --workspace=apps/backend -- vendedores.e2e-spec
```

Expected: PASS las dos.

- [ ] **Step 5: Lint, build y commit**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
git status --short
git add apps/backend/src/modules/sincronizacion/folio.ts apps/backend/src/modules/sincronizacion/segmento-vendedor.ts apps/backend/src/modules/sincronizacion/segmento-vendedor.spec.ts apps/backend/src/modules/nomina-comisiones/vendedores.service.ts apps/backend/src/modules/nomina-comisiones/vendedores.service.spec.ts apps/backend/src/scripts/crear-vendedor.ts apps/backend/test/vendedores.e2e-spec.ts
git commit -m "$(cat <<'EOF'
T-17: el segmento OF queda reservado para los folios de oficina

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Emisor del folio de oficina

**Files:**
- Create: `apps/backend/src/modules/ventas-cobranza/folio-oficina.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/folio-oficina.spec.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/folios-oficina.repository.ts`
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts`
- Create: `apps/backend/test/folios-oficina.e2e-spec.ts`

**Interfaces:**
- Consumes: `SEGMENTO_OFICINA`, `MAX_OPERACIONES_POR_DIA`, `formarFolio`, `partirFolio` de `sincronizacion/folio.ts` (Task 2); tabla `folio_oficina_contador` (Task 1).
- Produces:
  - `folioDeOficina(codigoSucursal: string, fecha: string, consecutivo: number): string` — lanza `RangeError` fuera de 1..99.
  - `class FoliosOficinaAgotados extends Error { readonly fecha: string }` — mensaje `Se alcanzó el máximo de 99 ventas de oficina para ese día.`
  - `@Injectable() class FoliosOficinaRepository { emitir(sucursal: { id: string; codigo: string }, fecha: string, trx: Transaction<DB>): Promise<string> }` — lanza `FoliosOficinaAgotados` si pasaría de 99 (y la transacción de quien llama hace rollback, así que el contador no avanza).

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `apps/backend/src/modules/ventas-cobranza/folio-oficina.spec.ts`:

```ts
import { RE_FOLIO, partirFolio } from '../sincronizacion/folio';
import { FoliosOficinaAgotados, folioDeOficina } from './folio-oficina';

describe('folio de oficina (T-17, §4.4)', () => {
  it('es el formato de ADR-0001 con OF en el segmento de vendedor', () => {
    expect(folioDeOficina('TJ', '2026-10-06', 1)).toBe('TJ261006OF01');
    expect(folioDeOficina('MX', '2026-10-06', 99)).toBe('MX261006OF99');
  });

  it('se lee con el mismo parser que los folios de tablet', () => {
    const folio = folioDeOficina('TJ', '2026-10-06', 7);
    expect(folio).toMatch(RE_FOLIO);
    expect(partirFolio(folio)).toMatchObject({
      sucursal: 'TJ',
      fecha: '2026-10-06',
      vendedor: 'OF',
      consecutivo: 7,
    });
  });

  it.each([0, 100, 1.5])(
    'un consecutivo %p es un bug de quien llama, no un folio',
    (consecutivo) => {
      expect(() => folioDeOficina('TJ', '2026-10-06', consecutivo)).toThrow(
        RangeError,
      );
    },
  );

  it('el tope de 99 por dia y sucursal se explica en espanol', () => {
    const error = new FoliosOficinaAgotados('2026-10-06');
    expect(error.message).toBe(
      'Se alcanzó el máximo de 99 ventas de oficina para ese día.',
    );
    expect(error.fecha).toBe('2026-10-06');
  });
});
```

Crear `apps/backend/test/folios-oficina.e2e-spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { FoliosOficinaAgotados } from './../src/modules/ventas-cobranza/folio-oficina';
import { FoliosOficinaRepository } from './../src/modules/ventas-cobranza/folios-oficina.repository';

/**
 * El contador del folio de oficina contra Postgres de verdad (T-17, §4.4).
 *
 * Lo que solo la base puede demostrar: que el numero no se quema si la venta
 * hace rollback y que dos transacciones a la vez no obtienen el mismo. Fechas
 * de 2024 en MX, exclusivas de este archivo; se limpian antes y despues.
 */
const FECHAS = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'];

/**
 * `fecha` como `AAAA-MM-DD`: Kysely tipa una columna `date` como `Date` al
 * comparar, y un `Date` de JS se corre de dia segun el huso del proceso.
 */
const fechaComoTexto = sql<string>`to_char(fecha, 'YYYY-MM-DD')`;

describe('FoliosOficinaRepository (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let repo: FoliosOficinaRepository;
  let sucursal: { id: string; codigo: string };

  const limpiar = () =>
    db
      .deleteFrom('folio_oficina_contador')
      .where('sucursal_id', '=', sucursal.id)
      .where(fechaComoTexto, 'in', FECHAS)
      .execute();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);
    repo = app.get(FoliosOficinaRepository);
    sucursal = await db
      .selectFrom('sucursal')
      .select(['id', 'codigo'])
      .where('codigo', '=', 'MX')
      .executeTakeFirstOrThrow();
    await limpiar();
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  it('emite 01, 02 en el mismo dia y vuelve a 01 en otro dia', async () => {
    const emitir = (fecha: string) =>
      db.transaction().execute((trx) => repo.emitir(sucursal, fecha, trx));

    expect(await emitir('2024-01-01')).toBe('MX240101OF01');
    expect(await emitir('2024-01-01')).toBe('MX240101OF02');
    expect(await emitir('2024-01-02')).toBe('MX240102OF01');
  });

  it('si la venta hace rollback, el numero no se quema', async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await repo.emitir(sucursal, '2024-01-03', trx);
        throw new Error('la venta fallo despues de emitir');
      }),
    ).rejects.toThrow('la venta fallo despues de emitir');

    const folio = await db
      .transaction()
      .execute((trx) => repo.emitir(sucursal, '2024-01-03', trx));
    expect(folio).toBe('MX240103OF01');
  });

  it('dos transacciones simultaneas no obtienen el mismo numero', async () => {
    let soltar!: () => void;
    const retenida = new Promise<void>((r) => {
      soltar = r;
    });
    let avisarEmitida!: () => void;
    const emitida = new Promise<void>((r) => {
      avisarEmitida = r;
    });

    // La primera emite y se queda con el candado de la fila sin hacer commit.
    const primera = db.transaction().execute(async (trx) => {
      const folio = await repo.emitir(sucursal, '2024-01-04', trx);
      avisarEmitida();
      await retenida;
      return folio;
    });
    await emitida;

    // La segunda tiene que esperar ese candado; se suelta la primera despues.
    const segunda = db
      .transaction()
      .execute((trx) => repo.emitir(sucursal, '2024-01-04', trx));
    setTimeout(soltar, 200);

    const folios = await Promise.all([primera, segunda]);
    expect(folios.sort()).toEqual(['MX240104OF01', 'MX240104OF02']);
  });

  it('pasado de 99 lanza FoliosOficinaAgotados y el contador no avanza', async () => {
    await db
      .insertInto('folio_oficina_contador')
      .values({ sucursal_id: sucursal.id, fecha: '2024-01-02', ultimo: 99 })
      .onConflict((oc) =>
        oc.columns(['sucursal_id', 'fecha']).doUpdateSet({ ultimo: 99 }),
      )
      .execute();

    await expect(
      db
        .transaction()
        .execute((trx) => repo.emitir(sucursal, '2024-01-02', trx)),
    ).rejects.toBeInstanceOf(FoliosOficinaAgotados);

    const fila = await db
      .selectFrom('folio_oficina_contador')
      .select('ultimo')
      .where('sucursal_id', '=', sucursal.id)
      .where(fechaComoTexto, '=', '2024-01-02')
      .executeTakeFirstOrThrow();
    expect(fila.ultimo).toBe(99);
  });
});
```

- [ ] **Step 2: Correr para verlas fallar**

Run: `npm test --workspace=apps/backend -- folio-oficina.spec`
Expected: FAIL — `Cannot find module './folio-oficina'`.

- [ ] **Step 3: Implementar**

Crear `apps/backend/src/modules/ventas-cobranza/folio-oficina.ts`:

```ts
import {
  MAX_OPERACIONES_POR_DIA,
  SEGMENTO_OFICINA,
  formarFolio,
} from '../sincronizacion/folio';

/**
 * El folio de una venta registrada en el portal (T-17, §4.4 del spec).
 *
 * > [!info] Enmienda a ADR-0001/0007 (ADR nuevo en el vault)
 * > Los folios de la tablet los sigue emitiendo la tablet, offline. Los del
 * > portal los emite el SERVIDOR, que si tiene red y una sola fuente de verdad
 * > (`folio_oficina_contador`). El segmento de vendedor es `OF` siempre, aunque
 * > la venta quede a nombre de un vendedor: el folio identifica quien la
 * > EMITIO, y la emitio la oficina.
 *
 * La fecha es la de la VENTA, no la de captura: una venta de la semana pasada
 * lleva la fecha de la semana pasada, con su propio contador.
 */
export function folioDeOficina(
  codigoSucursal: string,
  fecha: string,
  consecutivo: number,
): string {
  if (
    !Number.isInteger(consecutivo) ||
    consecutivo < 1 ||
    consecutivo > MAX_OPERACIONES_POR_DIA
  ) {
    throw new RangeError(
      `Consecutivo de folio de oficina fuera de 1..${MAX_OPERACIONES_POR_DIA}: ${consecutivo}`,
    );
  }
  return formarFolio(codigoSucursal, fecha, SEGMENTO_OFICINA, consecutivo);
}

/**
 * La sucursal ya emitio 99 folios de oficina para ese dia: el formato no tiene
 * un numero 100 (ADR-0001). Quien llama lo traduce a 409.
 */
export class FoliosOficinaAgotados extends Error {
  constructor(readonly fecha: string) {
    super(
      `Se alcanzó el máximo de ${MAX_OPERACIONES_POR_DIA} ventas de oficina para ese día.`,
    );
    this.name = 'FoliosOficinaAgotados';
  }
}
```

Crear `apps/backend/src/modules/ventas-cobranza/folios-oficina.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { MAX_OPERACIONES_POR_DIA } from '../sincronizacion/folio';
import { FoliosOficinaAgotados, folioDeOficina } from './folio-oficina';

/**
 * El contador del folio de oficina (T-17, §4.4).
 *
 * Como `VentasRepository`: recibe la `trx` y no abre la suya. **Tiene** que
 * correr dentro de la transaccion de la venta: si la venta falla despues, el
 * rollback deshace tambien el incremento y el numero no se quema.
 */
@Injectable()
export class FoliosOficinaRepository {
  /**
   * El siguiente folio de oficina de esa sucursal y ese dia.
   *
   * `insert ... on conflict do update ... returning`: una sola sentencia, sin
   * SELECT previo. La fila queda bloqueada hasta el commit, asi que una segunda
   * venta simultanea espera y luego ve el numero ya incrementado; no hay
   * ventana en la que dos obtengan el mismo.
   *
   * @throws {FoliosOficinaAgotados} si pasaria de 99. Quien llama deja que su
   * transaccion haga rollback, asi que el contador se queda en 99.
   */
  async emitir(
    sucursal: { id: string; codigo: string },
    fecha: string,
    trx: Transaction<DB>,
  ): Promise<string> {
    const resultado = await sql<{ ultimo: number }>`
      insert into folio_oficina_contador (sucursal_id, fecha, ultimo)
      values (${sucursal.id}, ${fecha}::date, 1)
      on conflict (sucursal_id, fecha)
      do update set ultimo = folio_oficina_contador.ultimo + 1
      returning ultimo
    `.execute(trx);

    const consecutivo = resultado.rows[0].ultimo;
    if (consecutivo > MAX_OPERACIONES_POR_DIA) {
      throw new FoliosOficinaAgotados(fecha);
    }
    return folioDeOficina(sucursal.codigo, fecha, consecutivo);
  }
}
```

En `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts`, agregar el import `import { FoliosOficinaRepository } from './folios-oficina.repository';` y `FoliosOficinaRepository,` a la lista de `providers` (después de `CobranzasRepository,`).

- [ ] **Step 4: Correr las pruebas**

```bash
npm test --workspace=apps/backend -- folio-oficina.spec
npm run test:e2e --workspace=apps/backend -- folios-oficina.e2e-spec
```

Expected: PASS (6 unit, 4 e2e).

- [ ] **Step 5: Lint, build y commit**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
git status --short
git add apps/backend/src/modules/ventas-cobranza/folio-oficina.ts apps/backend/src/modules/ventas-cobranza/folio-oficina.spec.ts apps/backend/src/modules/ventas-cobranza/folios-oficina.repository.ts apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts apps/backend/test/folios-oficina.e2e-spec.ts
git commit -m "$(cat <<'EOF'
T-17: emisor del folio de oficina OF dentro de la transaccion de la venta

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `VentasService.registrarVenta` compartido con el portal

**Files:**
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas.service.ts` (todo el archivo, abajo)
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas.service.spec.ts`
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas.repository.ts` (`NuevaVentaNota`, `insertarVenta`)
- Modify: `apps/backend/src/modules/ventas-cobranza/cobranzas.repository.ts:28-39` (`NuevoAbono`)
- Modify: `apps/backend/src/modules/ventas-cobranza/cobranzas.service.ts:13-20` (`ContextoCobranza`)
- Modify: `apps/backend/src/modules/sincronizacion/despacho.ts` (`Proyeccion`, `case 'venta'`)
- Modify: `apps/backend/src/modules/sincronizacion/despacho.spec.ts` (`'una venta valida se prepara para VentasService'`)
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts` (`proyectar`, `case 'venta'`)

**Interfaces:**
- Consumes: columnas `origen`, `capturo_usuario_id`, `vendedor_id` nullable (Task 1).
- Produces (las usa la Task 6):
  - `export type OrigenVenta = 'app' | 'portal';`
  - `export type MetodoPagoContado = 'efectivo' | 'transferencia';`
  - `export interface ContextoVenta { sucursalId: string; fechaOperacion: string; vendedorId: string | null; folio: string; usuarioId: string | null; origen: OrigenVenta; metodoPagoContado: MetodoPagoContado; }`
  - `export interface VentaRegistrada { id: string; montoCentavos: number; status: StatusInicial; }`
  - `VentasService.registrarVenta(venta: VentaNormalizada, contexto: ContextoVenta, trx: Transaction<DB>): Promise<VentaRegistrada>` — con `origen: 'app'` mide existencia de precio hasta hoy (como hoy); con `'portal'` exactamente a la fecha.
  - `Proyeccion` de venta: `{ tipo: 'venta'; venta: VentaNormalizada; folio: string }`.
  - `export interface ContextoCobranza { sucursalId: string; fechaOperacion: string; vendedorId: string; folio: string | null; usuarioId: string | null; }` (la cobranza de la tablet no cambia).

- [ ] **Step 1: Actualizar las pruebas (fallan)**

En `apps/backend/src/modules/ventas-cobranza/ventas.service.spec.ts`:

Reemplazar la fábrica `contexto`:

```ts
const contexto = (extra: Partial<ContextoVenta> = {}): ContextoVenta => ({
  sucursalId: 'sucursal-tj',
  fechaOperacion: '2026-09-14',
  vendedorId: 'vendedor-1',
  folio: 'TJ260914AP03',
  usuarioId: null,
  ...extra,
});
```

por:

```ts
const contexto = (extra: Partial<ContextoVenta> = {}): ContextoVenta => ({
  sucursalId: 'sucursal-tj',
  fechaOperacion: '2026-09-14',
  vendedorId: 'vendedor-1',
  folio: 'TJ260914AP03',
  usuarioId: null,
  origen: 'app',
  metodoPagoContado: 'efectivo',
  ...extra,
});

/** Lo que manda el portal (T-17): a la fecha, con quien capturo y el cobro por transferencia. */
const contextoPortal = (extra: Partial<ContextoVenta> = {}): ContextoVenta =>
  contexto({
    folio: 'TJ260914OF01',
    usuarioId: 'usuario-oficina',
    origen: 'portal',
    metodoPagoContado: 'transferencia',
    ...extra,
  });
```

En la primera prueba, reemplazar:

```ts
    ).resolves.toEqual({ id: 'venta-1' });
```

por:

```ts
    ).resolves.toEqual({ id: 'venta-1', montoCentavos: 32400, status: 'pendiente' });
```

y en el `toHaveBeenCalledWith` de `repo.insertarVenta` de esa misma prueba, reemplazar:

```ts
        status: 'pendiente',
        pctComision: '3.50',
      },
      trx,
    );
```

por:

```ts
        status: 'pendiente',
        pctComision: '3.50',
        origen: 'app',
        capturoUsuarioId: null,
      },
      trx,
    );
```

Reemplazar la última prueba (`'sin folio es un error de programacion, no un rechazo de negocio (lo decide T-17)'`, completa) por:

```ts
  describe('desde el portal (T-17)', () => {
    it('mide el precio exactamente a la fecha de la venta, no hasta hoy', async () => {
      const { servicio, precios } = montar();
      await servicio.registrarVenta(venta(), contextoPortal(), trx);
      expect(precios.presentacionesConPrecio).toHaveBeenCalledWith(
        CLIENTE,
        '2026-09-14',
        trx,
        { vigenteHastaHoy: false },
      );
    });

    it('guarda origen portal y quien la capturo', async () => {
      const { servicio, repo } = montar();
      await servicio.registrarVenta(venta(), contextoPortal(), trx);
      expect(repo.insertarVenta).toHaveBeenCalledWith(
        expect.objectContaining({
          folio: 'TJ260914OF01',
          vendedorId: 'vendedor-1',
          origen: 'portal',
          capturoUsuarioId: 'usuario-oficina',
        }),
        trx,
      );
    });

    it('una venta de Oficina va sin vendedor, y su cobro de contado tambien, con el metodo elegido', async () => {
      const { servicio, repo, cobranzas } = montar();
      await expect(
        servicio.registrarVenta(
          venta({ contadoCredito: 'contado' }),
          contextoPortal({ vendedorId: null }),
          trx,
        ),
      ).resolves.toEqual({ id: 'venta-1', montoCentavos: 32400, status: 'pagada' });

      expect(repo.insertarVenta).toHaveBeenCalledWith(
        expect.objectContaining({ vendedorId: null, status: 'pagada' }),
        trx,
      );
      expect(cobranzas.insertarAbono).toHaveBeenCalledWith(
        expect.objectContaining({
          vendedorId: null,
          metodoPago: 'transferencia',
          monto: '324.00',
          folio: 'TJ260914OF01',
          origen: 'venta_contado',
        }),
        trx,
      );
    });
  });
```

En `apps/backend/src/modules/sincronizacion/despacho.spec.ts`, en `'una venta valida se prepara para VentasService'`, reemplazar:

```ts
      proyeccion: {
        tipo: 'venta',
        venta: {
```

por:

```ts
      proyeccion: {
        tipo: 'venta',
        // T-17: el folio viaja con la proyeccion; `ContextoVenta.folio` ya no admite null.
        folio: 'TJ260914AP03',
        venta: {
```

- [ ] **Step 2: Correr para verlas fallar**

Run: `npm test --workspace=apps/backend -- ventas.service.spec despacho.spec`
Expected: FAIL — `origen`/`metodoPagoContado` no existen en `ContextoVenta` (error de tipos) y la proyección no trae `folio`.

- [ ] **Step 3: Implementar `VentasService`**

Reemplazar `apps/backend/src/modules/ventas-cobranza/ventas.service.ts` completo por:

```ts
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { PreciosRepository } from '../cartera-clientes/precios.repository';
import { aPesos } from '../sincronizacion/dinero';
import { CobranzasRepository } from './cobranzas.repository';
import type { VentaNormalizada } from './datos-venta';
import {
  mesDe,
  montoTotalCentavos,
  revisarLineas,
  semanaISO,
  statusInicial,
  type StatusInicial,
} from './reglas-venta';
import { VentaRechazada } from './venta-rechazada';
import { VentasRepository } from './ventas.repository';

/** De donde viene la venta (T-17). La base lo guarda en `venta_nota.origen`. */
export type OrigenVenta = 'app' | 'portal';

/** Como se cobra sola una venta de contado (T-17, §2). */
export type MetodoPagoContado = 'efectivo' | 'transferencia';

/**
 * Quien y cuando (ADR-0009 §2.2, con la enmienda de T-16: sin
 * `syncOperacionId`, la trazabilidad va en `sync_operacion.entidad_*`).
 */
export interface ContextoVenta {
  /** Sucursal de la operacion. Desde la tablet, la del vendedor del token; desde el portal, la del cliente. */
  sucursalId: string;
  /** Dia de trabajo `AAAA-MM-DD` tal cual llego: de aqui salen fecha, semana y mes, y desde aqui se mide la existencia de precio. */
  fechaOperacion: string;
  /**
   * El repartidor de la venta. `null` solo en una venta de **Oficina** (venta
   * de mostrador, T-17): no genera comision. La base lo exige con
   * `ck_venta_nota_origen_actores`: sin vendedor solo si `origen = 'portal'`.
   */
  vendedorId: string | null;
  /** Siempre llega: el de la tablet (offline) o el de oficina que emite el servidor (T-17). */
  folio: string;
  /** Quien la capturo en el portal (T-17). No sustituye a `vendedorId`. `null` desde la tablet. */
  usuarioId: string | null;
  /**
   * `app`: el precio lo pone la nota firmada y solo se comprueba que exista
   * alguno hasta hoy (D2, D12 enmendada). `portal`: los precios ya vienen
   * resueltos por el servidor a la fecha de la venta, y la existencia se mide
   * exactamente a esa fecha.
   */
  origen: OrigenVenta;
  /** El metodo del cobro automatico de una venta de contado. La tablet manda `efectivo`. */
  metodoPagoContado: MetodoPagoContado;
}

/** Lo que el portal muestra al grabar (T-17). La tablet solo usa el `id`. */
export interface VentaRegistrada {
  id: string;
  montoCentavos: number;
  status: StatusInicial;
}

/**
 * La venta (T-16): **una regla, un sitio** (ADR-0009). La tablet entra por el
 * `push` y el portal por `VentasPortalService` (T-17), los dos por aqui. Asi el
 * monto de una venta del portal se calcula igual que el de la tablet: es el
 * criterio del bug v2.0 de T-17.
 */
@Injectable()
export class VentasService {
  constructor(
    private readonly repo: VentasRepository,
    private readonly precios: PreciosRepository,
    // T-20 (D2): la venta de contado deja su cobro en la misma transaccion.
    private readonly cobranzas: CobranzasRepository,
  ) {}

  /**
   * Registra una venta cuya forma ya valido `normalizarDatosVenta`, dentro de
   * la transaccion de quien llama.
   *
   * No compara precios (D2): solo exige que cada presentacion se venda y que
   * las lineas con cantidad tengan algun precio para el cliente (ver
   * `ContextoVenta.origen`). El monto y el status los calcula aqui (D4, D14) y
   * congela el % de comision del cliente (D8).
   *
   * @throws {VentaRechazada} si el cliente no es de la sucursal, una
   * presentacion no se vende o falta precio. No escribe nada antes de lanzar.
   */
  async registrarVenta(
    venta: VentaNormalizada,
    contexto: ContextoVenta,
    trx: Transaction<DB>,
  ): Promise<VentaRegistrada> {
    const cliente = await this.repo.clienteParaVenta(
      venta.clienteId,
      contexto.sucursalId,
      trx,
    );
    if (!cliente) {
      throw new VentaRechazada({
        razon: 'cliente-fuera-de-alcance',
        motivo: `El cliente ${venta.clienteId} no existe o no es de esta sucursal.`,
      });
    }

    // Desde la tablet, existencia de precio hasta hoy, no solo a la fecha: el
    // portal asigna precios con vigencia desde hoy y el rechazo promete que
    // asignarlo recupera la venta (enmienda de D12). Desde el portal (T-17), a
    // la fecha exacta: la venta pasada mantiene el precio que tenia entonces.
    const precios = await this.precios.presentacionesConPrecio(
      venta.clienteId,
      contexto.fechaOperacion,
      trx,
      { vigenteHastaHoy: contexto.origen === 'app' },
    );
    const rechazo = revisarLineas(venta.lineas, precios);
    if (rechazo) throw new VentaRechazada(rechazo);

    const monto = montoTotalCentavos(venta.lineas);
    const status = statusInicial(venta.contadoCredito, monto);
    const id = await this.repo.insertarVenta(
      {
        folio: contexto.folio,
        fecha: contexto.fechaOperacion,
        clienteId: venta.clienteId,
        vendedorId: contexto.vendedorId,
        sucursalId: contexto.sucursalId,
        montoTotal: aPesos(monto),
        numNota: venta.numNota,
        contadoCredito: venta.contadoCredito,
        factura: venta.factura,
        comentarios: venta.comentarios,
        semana: semanaISO(contexto.fechaOperacion),
        mes: mesDe(contexto.fechaOperacion),
        status,
        pctComision: cliente.pctComision,
        origen: contexto.origen,
        capturoUsuarioId: contexto.usuarioId,
      },
      trx,
    );

    await this.repo.insertarDetalle(
      id,
      venta.lineas.map((l) => ({
        presentacionId: l.presentacionId,
        cantidad: l.cantidad,
        cantidadPromocion: l.cantidadPromocion,
        precio: aPesos(l.precioCentavos),
      })),
      trx,
    );

    // T-20 (D2): una venta de contado ya se cobro. Deja su fila en
    // `cobranza_abono` para que corte y tesoreria sumen una sola tabla, marcada
    // `venta_contado` para poder desglosarla. Una promocion ($0) no se cobra.
    // La venta no captura fecha de pago: es la de la operacion. El cobrador es
    // el vendedor de la venta, que en una venta de Oficina es null (T-17).
    if (venta.contadoCredito === 'contado' && monto > 0) {
      await this.cobranzas.insertarAbono(
        {
          ventaNotaId: id,
          vendedorId: contexto.vendedorId,
          fechaPago: contexto.fechaOperacion,
          fechaOperacion: contexto.fechaOperacion,
          monto: aPesos(monto),
          tipo: 'cobranza',
          saldoPendiente: aPesos(0),
          metodoPago: contexto.metodoPagoContado,
          folio: contexto.folio,
          origen: 'venta_contado',
        },
        trx,
      );
    }

    return { id, montoCentavos: monto, status };
  }
}
```

- [ ] **Step 4: Repositorios y cobranza**

En `apps/backend/src/modules/ventas-cobranza/ventas.repository.ts`:

Reemplazar la línea `import type { ContadoCredito, StatusInicial } from './reglas-venta';` por:

```ts
import type { ContadoCredito, StatusInicial } from './reglas-venta';
import type { OrigenVenta } from './ventas.service';
```

En `NuevaVentaNota`, reemplazar:

```ts
  vendedorId: string;
```

por:

```ts
  /** `null` en una venta de Oficina (T-17). */
  vendedorId: string | null;
```

y, después de `  pctComision: string | null;`, agregar:

```ts
  /** T-17: `app` o `portal`. */
  origen: OrigenVenta;
  /** T-17: quien la capturo en el portal; `null` desde la tablet. */
  capturoUsuarioId: string | null;
```

En `insertarVenta`, después de `        pct_comision: venta.pctComision,` agregar:

```ts
        origen: venta.origen,
        capturo_usuario_id: venta.capturoUsuarioId,
```

En `apps/backend/src/modules/ventas-cobranza/cobranzas.repository.ts`, en `NuevoAbono` reemplazar `  vendedorId: string;` (la primera aparición, dentro de `NuevoAbono`) por:

```ts
  /** `null` en el cobro de contado de una venta de Oficina (T-17). */
  vendedorId: string | null;
```

En `apps/backend/src/modules/ventas-cobranza/cobranzas.service.ts`, reemplazar:

```ts
import type { ContextoVenta } from './ventas.service';

/**
 * Quien y cuando: el mismo contexto que la venta (D13). Desde la tablet
 * `folio` viene emitido y `usuarioId` es null; el portal (T-21) los llenara al
 * reves.
 */
export type ContextoCobranza = ContextoVenta;
```

por:

```ts
/**
 * Quien y cuando (D13). Desde la tablet `folio` viene emitido y `usuarioId` es
 * null; el portal (T-21) los llenara al reves.
 *
 * Era un alias de `ContextoVenta` hasta T-17, que le agrego a la venta `origen`
 * y `metodoPagoContado` y le quito el null al folio. La cobranza no usa nada de
 * eso, asi que conserva su forma y la tablet no cambia.
 */
export interface ContextoCobranza {
  sucursalId: string;
  fechaOperacion: string;
  vendedorId: string;
  folio: string | null;
  usuarioId: string | null;
}
```

- [ ] **Step 5: El push sigue mandando lo mismo**

En `apps/backend/src/modules/sincronizacion/despacho.ts`, reemplazar:

```ts
  | { tipo: 'venta'; venta: VentaNormalizada }
```

por:

```ts
  // T-17: el folio viaja con la proyeccion. Aqui ya se comprobo que no es null,
  // y asi `ContextoVenta.folio` puede ser `string`.
  | { tipo: 'venta'; venta: VentaNormalizada; folio: string }
```

y en el `case 'venta'`, reemplazar:

```ts
      return { ok: true, proyeccion: { tipo: 'venta', venta: r.venta } };
```

por:

```ts
      return {
        ok: true,
        proyeccion: { tipo: 'venta', venta: r.venta, folio: op.folio },
      };
```

En `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`, en `proyectar`, reemplazar:

```ts
            vendedorId: vendedor.id,
            folio: op.folio,
            usuarioId: null,
          },
          trx,
        );
        return { tabla: 'venta_nota', id };
```

por:

```ts
            vendedorId: vendedor.id,
            folio: proyeccion.folio,
            usuarioId: null,
            // T-17: la tablet no cambia. Su venta de contado se sigue cobrando
            // en efectivo y su precio se mide hasta hoy, como desde T-16/T-20.
            origen: 'app',
            metodoPagoContado: 'efectivo',
          },
          trx,
        );
        return { tabla: 'venta_nota', id };
```

- [ ] **Step 6: Correr las pruebas**

```bash
npm test --workspace=apps/backend
npm run build --workspace=apps/backend
npm run test:e2e --workspace=apps/backend -- sincronizacion.e2e-spec
```

Expected: unit en verde (incluye las 3 nuevas de `ventas.service.spec`); build limpio; e2e del push en verde sin cambios (la tablet no cambió).

- [ ] **Step 7: Lint y commit**

```bash
npm run lint --workspace=apps/backend
git status --short
git add apps/backend/src/modules/ventas-cobranza/ventas.service.ts apps/backend/src/modules/ventas-cobranza/ventas.service.spec.ts apps/backend/src/modules/ventas-cobranza/ventas.repository.ts apps/backend/src/modules/ventas-cobranza/cobranzas.repository.ts apps/backend/src/modules/ventas-cobranza/cobranzas.service.ts apps/backend/src/modules/sincronizacion/despacho.ts apps/backend/src/modules/sincronizacion/despacho.spec.ts apps/backend/src/modules/sincronizacion/sincronizacion.service.ts
git commit -m "$(cat <<'EOF'
T-17: registrarVenta acepta origen portal, venta de Oficina y metodo del contado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: El push rechaza el # de nota repetido con `num-nota-duplicada`

**Files:**
- Create: `apps/backend/src/modules/ventas-cobranza/nota-duplicada.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/nota-duplicada.spec.ts`
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts` (`aplicar`, nuevo `clasificarNotaDuplicada`)
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts` (`CODIGOS_RECHAZO`)
- Modify: `apps/tablet/src/sincronizacion/contrato.ts` (`CODIGOS_RECHAZO`)
- Modify: `docs/contrato-sincronizacion.md` (§6 venta, tabla de códigos, §7)
- Modify: `apps/backend/test/sincronizacion.e2e-spec.ts`

**Interfaces:**
- Consumes: índice `uq_venta_nota_num_nota_sucursal` (Task 1); `siguienteNota`, `ventaValida`, `datosVenta`, `push`, `buzonDe`, `ventasConFolio` de la e2e (Task 1 / existentes); `Proyeccion` con `folio` (Task 4).
- Produces (la Task 6 usa los dos primeros):
  - `export const RESTRICCION_NUM_NOTA = 'uq_venta_nota_num_nota_sucursal';`
  - `export function esNotaDuplicada(error: unknown): boolean`
  - `export function motivoNotaDuplicada(numNota: string): string` → `Ya existe la nota ${numNota} en esta sucursal.`
  - Código de contrato `'num-nota-duplicada'` al final de `CODIGOS_RECHAZO` (backend y tablet).

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `apps/backend/src/modules/ventas-cobranza/nota-duplicada.spec.ts`:

```ts
import { esNotaDuplicada, motivoNotaDuplicada } from './nota-duplicada';

describe('# de nota duplicado (T-17, #95)', () => {
  it.each<[string, unknown, boolean]>([
    [
      'el unique del # de nota',
      { code: '23505', constraint: 'uq_venta_nota_num_nota_sucursal' },
      true,
    ],
    [
      'el unique del folio (otra cosa)',
      { code: '23505', constraint: 'venta_nota_folio_key' },
      false,
    ],
    [
      'un check violado',
      { code: '23514', constraint: 'uq_venta_nota_num_nota_sucursal' },
      false,
    ],
    ['algo que no es un error de Postgres', new Error('otra cosa'), false],
  ])('%s', (_caso, error, esperado) => {
    expect(esNotaDuplicada(error)).toBe(esperado);
  });

  it('el motivo dice que nota y donde', () => {
    expect(motivoNotaDuplicada('1234')).toBe(
      'Ya existe la nota 1234 en esta sucursal.',
    );
  });
});
```

En `apps/backend/test/sincronizacion.e2e-spec.ts`, agregar un `describe` nuevo justo después del cierre de `describe('ventas (T-16)', …)` (antes de `describe('ventas (T-16): reglas del dominio de punta a punta'`):

```ts
  describe('# de nota unico por sucursal (T-17, #95)', () => {
    it('una venta con un # de nota que ya existe en la sucursal es num-nota-duplicada y no deja fila', async () => {
      const nota = siguienteNota();
      const primera = ventaValida({ datos: datosVenta({ num_nota: nota }) });
      // Mismo numero tecleado distinto: mayusculas y espacios no lo hacen otro.
      const segunda = ventaValida({
        datos: datosVenta({ num_nota: `  ${nota.toUpperCase()} ` }),
      });
      const despues = operacion();

      const res = (
        await push({ operaciones: [primera, segunda, despues] }).expect(200)
      ).body as RespuestaPush;

      expect(res.resultados.map((r) => r.estado)).toEqual([
        'aplicada',
        'rechazada',
        'aplicada',
      ]);
      expect(res.resultados[1]).toMatchObject({
        codigo: 'num-nota-duplicada',
        motivo: `Ya existe la nota ${nota.toUpperCase()} en esta sucursal.`,
      });
      // Contrato §7: rechazada no deja fila, para corregir el # y reenviar.
      expect(await buzonDe(segunda.clave)).toBeUndefined();
      expect(await ventasConFolio(segunda.folio as string)).toHaveLength(0);
    });

    it('reenviar la MISMA venta (misma clave) sigue siendo duplicada, no num-nota-duplicada', async () => {
      const op = ventaValida();

      const primera = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      const segunda = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;

      expect(primera.resultados[0].estado).toBe('aplicada');
      expect(segunda.resultados[0]).toMatchObject({
        estado: 'duplicada',
        id_servidor: primera.resultados[0].id_servidor,
      });
      expect(segunda.resultados[0].codigo).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Correr para verlas fallar**

```bash
npm test --workspace=apps/backend -- nota-duplicada.spec
npm run test:e2e --workspace=apps/backend -- sincronizacion.e2e-spec
```

Expected: la unit FAIL (`Cannot find module './nota-duplicada'`); la e2e FAIL en la primera prueba nueva (el push responde 500 por el `23505` no clasificado).

- [ ] **Step 3: Implementar**

Crear `apps/backend/src/modules/ventas-cobranza/nota-duplicada.ts`:

```ts
import {
  esViolacionUnicidad,
  restriccionDelError,
} from '../../database/errores-postgres';

/**
 * El # de la nota fisica no se repite dentro de la sucursal (#95, T-17).
 *
 * Lo decide el indice de la base, no una consulta previa: entre un SELECT y el
 * INSERT cabria otra venta con el mismo numero. Aqui solo se reconoce su
 * `23505` para traducirlo: `num-nota-duplicada` en el push de la tablet, 409
 * en el portal. Vive en ventas-cobranza y no en sincronizacion porque la regla
 * es de la venta, venga de donde venga (ADR-0009).
 */
export const RESTRICCION_NUM_NOTA = 'uq_venta_nota_num_nota_sucursal';

export function esNotaDuplicada(error: unknown): boolean {
  return (
    esViolacionUnicidad(error) &&
    restriccionDelError(error) === RESTRICCION_NUM_NOTA
  );
}

/** El mismo texto para la tablet y para el portal. */
export function motivoNotaDuplicada(numNota: string): string {
  return `Ya existe la nota ${numNota} en esta sucursal.`;
}
```

En `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`:

Agregar el import junto a los de `../ventas-cobranza/…`:

```ts
import {
  esNotaDuplicada,
  motivoNotaDuplicada,
} from '../ventas-cobranza/nota-duplicada';
```

En el `catch` de `aplicar`, reemplazar:

```ts
      if (esColisionDeFolio(error)) {
        return this.clasificarColision(vendedor, op);
      }
```

por:

```ts
      // T-17 (#95): el `23505` del # de nota, clasificado igual que el folio:
      // despues del rollback y mirando primero la clave.
      if (esNotaDuplicada(error) && proyeccion?.tipo === 'venta') {
        return this.clasificarNotaDuplicada(
          vendedor,
          op,
          proyeccion.venta.numNota,
        );
      }
      if (esColisionDeFolio(error)) {
        return this.clasificarColision(vendedor, op);
      }
```

Y agregar este método justo después del cierre de `clasificarColision`:

```ts
  /**
   * **# de nota repetido en la sucursal** (T-17, #95), clasificado despues del
   * rollback por lo mismo que `clasificarColision`.
   *
   * > [!danger] Primero la clave
   * > Un reenvio legitimo trae la misma clave y el mismo # de nota. Si esa
   * > clave ya existe para el vendedor, era un reenvio: `duplicada`.
   */
  private async clasificarNotaDuplicada(
    vendedor: VendedorConSucursal,
    op: OperacionNormalizada,
    numNota: string,
  ): Promise<ResultadoOperacion> {
    const propia = await this.repo.buscarPorClave(vendedor.id, op.clave);
    if (propia) {
      return {
        clave: op.clave,
        tipo: op.tipo,
        estado: 'duplicada',
        id_servidor: propia.id,
      };
    }
    return {
      clave: op.clave,
      tipo: op.tipo,
      estado: 'rechazada',
      codigo: 'num-nota-duplicada',
      motivo: motivoNotaDuplicada(numNota),
    };
  }
```

En `apps/backend/src/modules/sincronizacion/contrato.ts`, dentro de `CODIGOS_RECHAZO`, reemplazar:

```ts
  'nota-no-encontrada',
] as const;
```

por:

```ts
  'nota-no-encontrada',
  /**
   * Otra venta viva de la misma sucursal —de esta tablet, de otra o capturada
   * en el portal— ya tiene ese `num_nota`, sin distinguir mayusculas ni
   * espacios. T-17 (#95).
   *
   * No se reintenta sola: el vendedor corrige el # de nota y la reenvia. Un
   * reenvio con la misma `clave` sigue siendo `duplicada`, no esto. Una tablet
   * que no conozca el codigo muestra el `motivo` igual.
   */
  'num-nota-duplicada',
] as const;
```

En `apps/tablet/src/sincronizacion/contrato.ts`, dentro de `CODIGOS_RECHAZO`, reemplazar:

```ts
  'nota-no-encontrada',
] as const;
```

por:

```ts
  'nota-no-encontrada',
  /**
   * T-17: otra venta de la misma sucursal (de otra tablet o del portal) ya
   * tiene ese # de nota. No se reintenta sola: se corrige el # y se reenvia.
   */
  'num-nota-duplicada',
] as const;
```

En `docs/contrato-sincronizacion.md`:

1. Reemplazar:

```
    "num_nota": "2346",              // obligatorio, ≤ 30, se recorta
```

por:

```
    "num_nota": "2346",              // obligatorio, ≤ 30, se recorta; único por sucursal (T-17)
```

2. Reemplazar:

```
- Cada venta se aplica en **su propia transacción** junto con su fila del buzón: si se rechaza,
  no queda ni la venta ni la operación (§7).
```

por:

```
- Cada venta se aplica en **su propia transacción** junto con su fila del buzón: si se rechaza,
  no queda ni la venta ni la operación (§7).
- **El # de nota no se repite en la sucursal** (T-17, #95). Lo garantiza el índice
  `uq_venta_nota_num_nota_sucursal` sobre `(sucursal_id, lower(btrim(num_nota)))` de las ventas
  vivas: `AB-1`, `ab-1` y ` AB-1 ` son la misma nota. Cuenta también las ventas que la oficina
  registra en el portal. Una venta con un # ya usado se rechaza **por operación** con
  `num-nota-duplicada`; un reenvío con la misma `clave` sigue siendo `duplicada`.
```

3. En la tabla de códigos, después de la fila que empieza con `` | `nota-no-encontrada` | ``, agregar:

```
| `num-nota-duplicada` | Otra venta viva de la misma sucursal —de esta tablet, de otra o capturada en el portal— ya tiene ese `num_nota` (sin distinguir mayúsculas ni espacios). **No se reintenta sola**: el vendedor corrige el # de nota y la reenvía. Una tablet que no conozca el código muestra el `motivo` igual (T-17) |
```

4. Reemplazar:

```
> `clave` para el vendedor? → `duplicada`; si no → `folio-duplicado`) corre **fuera**
> de la transacción, con la conexión normal.
```

por:

```
> `clave` para el vendedor? → `duplicada`; si no → `folio-duplicado`) corre **fuera**
> de la transacción, con la conexión normal.
>
> El `23505` del # de nota (`uq_venta_nota_num_nota_sucursal`, T-17) se desempata igual:
> primero la `clave` (→ `duplicada`); si no → `num-nota-duplicada`.
```

- [ ] **Step 4: Correr las pruebas**

```bash
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend -- sincronizacion.e2e-spec
npm run typecheck --workspace=apps/tablet
npm test --workspace=apps/tablet
```

Expected: todo en verde (la tablet solo ganó un literal).

- [ ] **Step 5: Lint y commit (contrato + docs en el MISMO commit)**

```bash
npm run lint --workspace=apps/backend
git status --short
git add apps/backend/src/modules/ventas-cobranza/nota-duplicada.ts apps/backend/src/modules/ventas-cobranza/nota-duplicada.spec.ts apps/backend/src/modules/sincronizacion/sincronizacion.service.ts apps/backend/src/modules/sincronizacion/contrato.ts apps/tablet/src/sincronizacion/contrato.ts docs/contrato-sincronizacion.md apps/backend/test/sincronizacion.e2e-spec.ts
git commit -m "$(cat <<'EOF'
T-17: el push rechaza un # de nota repetido en la sucursal con num-nota-duplicada

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Backend del portal — `GET /ventas/catalogo`, `GET /ventas/repartidores`, `POST /ventas`

**Files:**
- Create: `apps/backend/src/modules/ventas-cobranza/venta-portal.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/venta-portal.spec.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/dto/registrar-venta.dto.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/ventas-portal.repository.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/ventas-portal.service.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/ventas.controller.ts`
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts`
- Create: `apps/backend/test/ventas.e2e-spec.ts`

**Interfaces:**
- Consumes: `VentasService.registrarVenta` → `VentaRegistrada`, `ContextoVenta`, `MetodoPagoContado` (Task 4); `FoliosOficinaRepository.emitir`, `FoliosOficinaAgotados` (Task 3); `esNotaDuplicada`, `motivoNotaDuplicada` (Task 5); `PreciosRepository.presentacionesConPrecio(clienteId, fecha, conexion, opciones)`; `normalizarDatosVenta`, `VentaNormalizada`, `FacturaVenta` (`datos-venta.ts`); `revisarLineas`, `ContadoCredito` (`reglas-venta.ts`); `RechazoVenta`, `VentaRechazada`; `resolverAlcance`; `buscarSucursalUsuario`; `hoyEnTijuana` (`sincronizacion/operaciones.ts`).
- Produces (la Task 7 copia estas formas):
  - `GET /ventas/catalogo?clienteId=<uuid>&fecha=AAAA-MM-DD` → `PresentacionDeCatalogo[]` = `{ presentacionId: string; producto: string; volumen: string; precioCentavos: number | null }[]`, ordenado por producto y volumen.
  - `GET /ventas/repartidores?sucursalId=<uuid>` → `Repartidor[]` = `{ id: string; nombre: string }[]`.
  - `POST /ventas` (cuerpo `RegistrarVentaDto`: `fecha`, `clienteId`, `vendedorId: string | null`, `numNota`, `contadoCredito`, `metodoPago?: 'transferencia' | 'efectivo'`, `factura: 'N/A' | 'pendiente'`, `comentarios?`, `lineas: { presentacionId, cantidad, cantidadPromocion }[]`) → `201` `{ id: string; folio: string; montoCentavos: number; status: 'pagada' | 'pendiente' | 'promocion' }`.
  - Errores: fecha mal formada o futura → 400; cliente inexistente → 404; cliente/sucursal fuera de alcance → 403; repartidor que no es vendedor activo de la sucursal del cliente → 400; sin precio a la fecha / presentación inactiva → 409 (motivo); # de nota repetido → 409 `Ya existe la nota X en esta sucursal.`; 99 folios OF en el día → 409; sin permiso → 403.

- [ ] **Step 1: Escribir las pruebas puras que fallan**

Crear `apps/backend/src/modules/ventas-cobranza/venta-portal.spec.ts`:

```ts
import { armarVentaPortal, revisarFechaVenta } from './venta-portal';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
const PRE_A = '5f3c1a2b-7d8e-4f90-a1b2-c3d4e5f60718';
const PRE_B = '6a4d2b3c-8e9f-4a01-b2c3-d4e5f6071829';
const PRE_SIN = '7b5e3c4d-9fa0-4b12-83d4-e5f60718293a';

const precios = new Map<string, number | null>([
  [PRE_A, 1000],
  [PRE_B, 600],
  [PRE_SIN, null],
]);

const entrada = (lineas: { presentacionId: string; cantidad: number; cantidadPromocion: number }[]) => ({
  clienteId: CLIENTE,
  numNota: '1234',
  contadoCredito: 'credito' as const,
  factura: 'N/A' as const,
  comentarios: null,
  lineas,
});

describe('armarVentaPortal: lineas con el precio del servidor (T-17, §4.2)', () => {
  it('pone a cada linea el precio de la lista del cliente a la fecha', () => {
    const r = armarVentaPortal(
      entrada([
        { presentacionId: PRE_A, cantidad: 24, cantidadPromocion: 2 },
        { presentacionId: PRE_B, cantidad: 5, cantidadPromocion: 0 },
      ]),
      precios,
      '2025-02-10',
    );
    expect(r).toEqual({
      ok: true,
      venta: {
        clienteId: CLIENTE,
        numNota: '1234',
        contadoCredito: 'credito',
        factura: 'N/A',
        comentarios: null,
        lineas: [
          { presentacionId: PRE_A, cantidad: 24, cantidadPromocion: 2, precioCentavos: 1000 },
          { presentacionId: PRE_B, cantidad: 5, cantidadPromocion: 0, precioCentavos: 600 },
        ],
      },
    });
  });

  it('acepta el uuid en mayusculas: el mapa de precios va en minusculas', () => {
    const r = armarVentaPortal(
      entrada([{ presentacionId: PRE_A.toUpperCase(), cantidad: 1, cantidadPromocion: 0 }]),
      precios,
      '2025-02-10',
    );
    expect(r.ok && r.venta.lineas[0]).toEqual({
      presentacionId: PRE_A,
      cantidad: 1,
      cantidadPromocion: 0,
      precioCentavos: 1000,
    });
  });

  it('una linea de pura promocion sin precio entra a precio 0 (D13)', () => {
    const r = armarVentaPortal(
      entrada([{ presentacionId: PRE_SIN, cantidad: 0, cantidadPromocion: 3 }]),
      precios,
      '2025-02-10',
    );
    expect(r.ok && r.venta.lineas[0].precioCentavos).toBe(0);
  });

  it('una linea con piezas y sin precio a esa fecha es precio-no-asignado, con motivo para la oficina', () => {
    const r = armarVentaPortal(
      entrada([{ presentacionId: PRE_SIN, cantidad: 1, cantidadPromocion: 0 }]),
      precios,
      '2025-02-10',
    );
    expect(r).toEqual({
      ok: false,
      tipo: 'rechazo',
      rechazo: {
        razon: 'precio-no-asignado',
        motivo: 'Una de las presentaciones no tiene precio en la lista del cliente para el 2025-02-10.',
      },
    });
  });

  it('una presentacion que no se vende es presentacion-inactiva', () => {
    const r = armarVentaPortal(
      entrada([{ presentacionId: '8c6f4d5e-a0b1-4c23-94e5-f60718293a4b', cantidad: 1, cantidadPromocion: 0 }]),
      precios,
      '2025-02-10',
    );
    expect(r).toMatchObject({ ok: false, tipo: 'rechazo', rechazo: { razon: 'presentacion-inactiva' } });
  });

  it('reusa las reglas de forma de la tablet: presentacion repetida es invalida', () => {
    const r = armarVentaPortal(
      entrada([
        { presentacionId: PRE_A, cantidad: 1, cantidadPromocion: 0 },
        { presentacionId: PRE_A, cantidad: 2, cantidadPromocion: 0 },
      ]),
      precios,
      '2025-02-10',
    );
    expect(r).toMatchObject({ ok: false, tipo: 'invalido' });
    if (r.ok || r.tipo !== 'invalido') throw new Error('debia ser invalido');
    expect(r.motivo).toContain('lineas[1].presentacion_id');
  });

  it('reusa las reglas de forma de la tablet: una linea en 0 y 0 es invalida', () => {
    const r = armarVentaPortal(
      entrada([{ presentacionId: PRE_A, cantidad: 0, cantidadPromocion: 0 }]),
      precios,
      '2025-02-10',
    );
    expect(r).toMatchObject({ ok: false, tipo: 'invalido' });
  });
});

describe('revisarFechaVenta (T-17, §3)', () => {
  it.each(['2026-10-06', '2025-02-10'])('%s, hoy o pasada, se acepta', (fecha) => {
    expect(revisarFechaVenta(fecha, '2026-10-06')).toBeNull();
  });

  it('mañana se rechaza: "hoy" es el de Tijuana, aunque en UTC ya sea mañana', () => {
    expect(revisarFechaVenta('2026-10-07', '2026-10-06')).toBe(
      'La fecha de la venta no puede ser futura.',
    );
  });

  it.each(['', '06/10/2026', '2026-10-6'])('"%s" no tiene el formato', (fecha) => {
    expect(revisarFechaVenta(fecha, '2026-10-06')).toBe(
      'La fecha debe tener el formato AAAA-MM-DD.',
    );
  });

  it('una fecha que no existe se rechaza', () => {
    expect(revisarFechaVenta('2026-02-30', '2026-10-06')).toBe('Esa fecha no existe.');
  });
});
```

Run: `npm test --workspace=apps/backend -- venta-portal.spec`
Expected: FAIL — `Cannot find module './venta-portal'`.

- [ ] **Step 2: Implementar las funciones puras**

Crear `apps/backend/src/modules/ventas-cobranza/venta-portal.ts`:

```ts
import {
  normalizarDatosVenta,
  type FacturaVenta,
  type VentaNormalizada,
} from './datos-venta';
import { revisarLineas, type ContadoCredito } from './reglas-venta';
import type { RechazoVenta } from './venta-rechazada';

/**
 * Reglas puras de la venta que captura la oficina en el portal (T-17).
 *
 * Puras por el mismo criterio que `reglas-venta.ts`: deciden, y se prueban sin
 * Postgres. Las usa `VentasPortalService`.
 */

/** Lo que manda el portal, ya validado por el DTO. **No trae precios** (§4.2). */
export interface EntradaVentaPortal {
  clienteId: string;
  numNota: string;
  contadoCredito: ContadoCredito;
  factura: FacturaVenta;
  comentarios: string | null;
  lineas: { presentacionId: string; cantidad: number; cantidadPromocion: number }[];
}

export type ResultadoVentaPortal =
  | { ok: true; venta: VentaNormalizada }
  /** Regla de negocio: el servicio lo traduce a 409. */
  | { ok: false; tipo: 'rechazo'; rechazo: RechazoVenta }
  /** Forma: el servicio lo traduce a 400. */
  | { ok: false; tipo: 'invalido'; motivo: string };

/**
 * Arma la venta con el precio **del servidor**: el de la lista del cliente
 * (con su precio especial) vigente en `fecha` (§2). El cliente no teclea ni
 * manda precios.
 *
 * `precios` es lo que devuelve `presentacionesConPrecio(cliente, fecha)` sin
 * `vigenteHastaHoy`. Primero `revisarLineas` (presentacion que no se vende, o
 * linea con piezas sin precio a esa fecha), despues las MISMAS reglas de forma
 * que la tablet (`normalizarDatosVenta`: 1-50 lineas, sin presentacion
 * repetida, enteros, tope del monto). Una linea de pura promocion sin precio
 * entra a 0 (D13).
 */
export function armarVentaPortal(
  entrada: EntradaVentaPortal,
  precios: ReadonlyMap<string, number | null>,
  fecha: string,
): ResultadoVentaPortal {
  // El mapa viene en minusculas (uuid de Postgres); el DTO acepta mayusculas.
  const lineas = entrada.lineas.map((l) => ({
    ...l,
    presentacionId: l.presentacionId.toLowerCase(),
  }));

  const rechazo = revisarLineas(lineas, precios);
  if (rechazo) {
    return {
      ok: false,
      tipo: 'rechazo',
      // El motivo de `revisarLineas` le habla a la tablet ("vuelve a
      // sincronizar"); a la oficina se le dice que falta en la lista.
      rechazo:
        rechazo.razon === 'precio-no-asignado'
          ? {
              razon: rechazo.razon,
              motivo: `Una de las presentaciones no tiene precio en la lista del cliente para el ${fecha}.`,
            }
          : rechazo,
    };
  }

  const r = normalizarDatosVenta(entrada.clienteId, {
    num_nota: entrada.numNota,
    contado_credito: entrada.contadoCredito,
    factura: entrada.factura,
    comentarios: entrada.comentarios,
    lineas: lineas.map((l) => ({
      presentacion_id: l.presentacionId,
      cantidad: l.cantidad,
      cantidad_promocion: l.cantidadPromocion,
      precio_centavos: precios.get(l.presentacionId) ?? 0,
    })),
  });
  if (!r.ok) return { ok: false, tipo: 'invalido', motivo: r.motivo };
  return { ok: true, venta: r.venta };
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * La fecha de la venta: hoy o un dia pasado, nunca futura (§3).
 *
 * `hoy` es `hoyEnTijuana()`: a las 23:30 de Tijuana en UTC ya es manana, y
 * compararla con el reloj UTC dejaria pasar una venta de "manana". Se compara
 * como texto `AAAA-MM-DD`, que ordena igual que las fechas.
 *
 * @returns el motivo del rechazo, o `null` si la fecha vale.
 */
export function revisarFechaVenta(fecha: string, hoy: string): string | null {
  if (!RE_FECHA.test(fecha)) return 'La fecha debe tener el formato AAAA-MM-DD.';
  const comprobacion = new Date(`${fecha}T00:00:00Z`);
  if (
    Number.isNaN(comprobacion.getTime()) ||
    comprobacion.toISOString().slice(0, 10) !== fecha
  ) {
    return 'Esa fecha no existe.';
  }
  if (fecha > hoy) return 'La fecha de la venta no puede ser futura.';
  return null;
}
```

Run: `npm test --workspace=apps/backend -- venta-portal.spec`
Expected: PASS.

- [ ] **Step 3: Escribir la e2e que falla**

Crear `apps/backend/test/ventas.e2e-spec.ts`:

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
import { hoyEnTijuana } from './../src/modules/sincronizacion/operaciones';

/**
 * Registrar venta desde el portal (T-17, parte 1) de punta a punta: §7 del spec.
 *
 * Fechas de 2025 exclusivas de este archivo: el contador del folio OF es por
 * sucursal y dia, y las pruebas de consecutivos necesitan su dia limpio. Se
 * limpian antes (restos de una corrida que trono) y despues.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-vta-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-vta-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-vta-sin-${SUFIJO}`;

const FECHA_BASE = '2025-02-10'; // lunes, semana ISO 7
const FECHA_CONSECUTIVOS = '2025-02-11';
const FECHA_SIMULTANEAS = '2025-02-12';
const FECHA_TOPE = '2025-02-13';
const FECHA_SIN_QUEMA = '2025-02-14';
const FECHA_ANTES_DEL_CAMBIO = '2025-03-15';
const FECHA_DESPUES_DEL_CAMBIO = '2025-07-01';
const FECHA_SIN_PRECIOS = '2024-12-31';
const FECHAS = [
  FECHA_BASE,
  FECHA_CONSECUTIVOS,
  FECHA_SIMULTANEAS,
  FECHA_TOPE,
  FECHA_SIN_QUEMA,
  FECHA_ANTES_DEL_CAMBIO,
  FECHA_DESPUES_DEL_CAMBIO,
  FECHA_SIN_PRECIOS,
];

interface VentaRegistrada {
  id: string;
  folio: string;
  montoCentavos: number;
  status: string;
}

interface PresentacionDeCatalogo {
  presentacionId: string;
  producto: string;
  volumen: string;
  precioCentavos: number | null;
}

/**
 * `fecha` como `AAAA-MM-DD` para filtrar: Kysely tipa una columna `date` como
 * `Date` al comparar, y un `Date` de JS se corre de dia segun el huso.
 */
const fechaComoTexto = sql<string>`to_char(fecha, 'YYYY-MM-DD')`;

/** `date` de Postgres a `AAAA-MM-DD`, con los componentes locales que puso el driver. */
const fechaTexto = (valor: Date | string) =>
  valor instanceof Date
    ? `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, '0')}-${String(valor.getDate()).padStart(2, '0')}`
    : String(valor).slice(0, 10);

/** Manana en Tijuana, armado del texto (nunca de un Date local). */
const mananaEnTijuana = () => {
  const [a, m, d] = hoyEnTijuana().split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
};

describe('Ventas desde el portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;

  let tjId: string;
  let mxId: string;
  const usuarioIds: string[] = [];
  let usuarioGeneralId: string;
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;

  let productoId: string;
  let pre1: string; // 1 L: 10.00 desde 2025-01-01, 12.50 desde 2025-06-01 (TJ); 20.00 (MX)
  let pre2: string; // 500 ml: 7.25 en la lista, 6.00 precio especial del cliente TJ
  let preSinPrecio: string; // 2 L: sin precio
  const precioIds: string[] = [];
  let clientePrecioId: string;
  let clienteTj: string;
  let clienteMx: string;
  let vendedorTj: string;
  let vendedorTjInactivo: string;
  let vendedorMx: string;

  let notas = 0;
  /** Un # de nota unico por llamada (≤ 30): el indice de #95 no deja repetirlo. */
  const nota = () => `e2e${SUFIJO}-${++notas}`;

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

  /** `Administrador General` trae todos los permisos; `Auxiliar Administrativo` esta vacio (T-08b). */
  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ): Promise<string> => {
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
    return id;
  };

  const sembrarVendedor = async (
    nombre: string,
    sucursalId: string,
    activo = true,
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-vta-${nombre.toLowerCase().replace(/\s+/g, '-')}-${SUFIJO}`,
        nombre: `${nombre} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
        activo,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  const sembrarPrecio = async (
    presentacionId: string,
    sucursalId: string,
    precio: string,
    vigenteDesde: string,
  ) => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('precio')
      .values({
        presentacion_id: presentacionId,
        lista_precio_id: lista.id,
        sucursal_id: sucursalId,
        precio,
        vigente_desde: vigenteDesde,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    precioIds.push(id);
  };

  const sembrarCliente = async (
    nombre: string,
    sucursalId: string,
  ): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `${nombre} ${SUFIJO}`,
        domicilio: 'Calle 1',
        telefono: '6640000000',
        tipo: 'cliente',
        lista_precio_id: lista.id,
        pct_comision: '3.50',
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  /** Ventas, detalle y cobros de las fechas de este archivo, y su contador OF. */
  const limpiarVentas = async () => {
    const ventas = db
      .selectFrom('venta_nota')
      .select('id')
      .where('origen', '=', 'portal')
      .where(fechaComoTexto, 'in', FECHAS);
    await db.deleteFrom('cobranza_abono').where('venta_nota_id', 'in', ventas).execute();
    await db.deleteFrom('venta_nota_detalle').where('venta_nota_id', 'in', ventas).execute();
    await db
      .deleteFrom('venta_nota')
      .where('origen', '=', 'portal')
      .where(fechaComoTexto, 'in', FECHAS)
      .execute();
    await db
      .deleteFrom('folio_oficina_contador')
      .where('sucursal_id', 'in', [tjId, mxId])
      .where(fechaComoTexto, 'in', FECHAS)
      .execute();
  };

  /** Un cuerpo valido de POST /ventas: credito, a nombre del vendedor TJ, 24+2 de 1 L y 5 de 500 ml. */
  const cuerpo = (extra: Record<string, unknown> = {}) => ({
    fecha: FECHA_BASE,
    clienteId: clienteTj,
    vendedorId: vendedorTj,
    numNota: nota(),
    contadoCredito: 'credito',
    factura: 'N/A',
    lineas: [
      { presentacionId: pre1, cantidad: 24, cantidadPromocion: 2 },
      { presentacionId: pre2, cantidad: 5, cantidadPromocion: 0 },
    ],
    ...extra,
  });

  const registrar = (cookie: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/ventas').set('Cookie', cookie).send(body);

  const ventaPorId = (id: string) =>
    db.selectFrom('venta_nota').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  const detalleDe = (id: string) =>
    db
      .selectFrom('venta_nota_detalle')
      .select(['presentacion_id', 'cantidad', 'cantidad_promocion', 'precio'])
      .where('venta_nota_id', '=', id)
      .orderBy('precio', 'desc')
      .execute();

  const abonosDe = (id: string) =>
    db
      .selectFrom('cobranza_abono')
      .select(['monto', 'metodo_pago', 'vendedor_id', 'origen', 'folio'])
      .where('venta_nota_id', '=', id)
      .execute();

  const ventasConNota = (numNota: string) =>
    db.selectFrom('venta_nota').select('id').where('num_nota', '=', numNota).execute();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    tjId = (
      await db.selectFrom('sucursal').select('id').where('codigo', '=', 'TJ').executeTakeFirstOrThrow()
    ).id;
    mxId = (
      await db.selectFrom('sucursal').select('id').where('codigo', '=', 'MX').executeTakeFirstOrThrow()
    ).id;
    await limpiarVentas();

    usuarioGeneralId = await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', tjId);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);

    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: `Horchata e2e ${SUFIJO}` })
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
    pre1 = await presentacion('1 L');
    pre2 = await presentacion('500 ml');
    preSinPrecio = await presentacion('2 L');

    await sembrarPrecio(pre1, tjId, '10.00', '2025-01-01');
    await sembrarPrecio(pre1, tjId, '12.50', '2025-06-01');
    await sembrarPrecio(pre2, tjId, '7.25', '2025-01-01');
    await sembrarPrecio(pre1, mxId, '20.00', '2025-01-01');

    clienteTj = await sembrarCliente('Abarrotes TJ', tjId);
    clienteMx = await sembrarCliente('Abarrotes MX', mxId);
    clientePrecioId = (
      await db
        .insertInto('cliente_precio')
        .values({
          cliente_id: clienteTj,
          presentacion_id: pre2,
          precio: '6.00',
          vigente_desde: '2025-01-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    vendedorTj = await sembrarVendedor('Ana Activa', tjId);
    vendedorTjInactivo = await sembrarVendedor('Beto Inactivo', tjId, false);
    vendedorMx = await sembrarVendedor('Carla Mexicali', mxId);
  });

  afterAll(async () => {
    const ventas = db
      .selectFrom('venta_nota')
      .select('id')
      .where('cliente_id', 'in', [clienteTj, clienteMx]);
    await db.deleteFrom('cobranza_abono').where('venta_nota_id', 'in', ventas).execute();
    await db.deleteFrom('venta_nota_detalle').where('venta_nota_id', 'in', ventas).execute();
    await db.deleteFrom('venta_nota').where('cliente_id', 'in', [clienteTj, clienteMx]).execute();
    await limpiarVentas();
    await db.deleteFrom('cliente_precio').where('id', '=', clientePrecioId).execute();
    await db.deleteFrom('precio').where('id', 'in', precioIds).execute();
    await db.deleteFrom('cliente').where('id', 'in', [clienteTj, clienteMx]).execute();
    await db
      .deleteFrom('presentacion')
      .where('id', 'in', [pre1, pre2, preSinPrecio])
      .execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
    await db
      .deleteFrom('vendedor')
      .where('id', 'in', [vendedorTj, vendedorTjInactivo, vendedorMx])
      .execute();
    await db.deleteFrom('sesion_refresh').where('usuario_id', 'in', usuarioIds).execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  /* ================================================================ */

  describe('POST /ventas', () => {
    it('a nombre de un vendedor: monto = Σ cantidad × precio de la lista del cliente a esa fecha', async () => {
      const res = await registrar(cookieGeneral, cuerpo()).expect(201);
      const venta = res.body as VentaRegistrada;

      // 24 × 10.00 (lista) + 5 × 6.00 (precio especial); las 2 de promocion no suman.
      expect(venta).toMatchObject({ montoCentavos: 27000, status: 'pendiente' });
      expect(venta.folio).toMatch(/^TJ250210OF\d{2}$/);

      const fila = await ventaPorId(venta.id);
      expect(fila).toMatchObject({
        folio: venta.folio,
        cliente_id: clienteTj,
        vendedor_id: vendedorTj,
        sucursal_id: tjId,
        monto_total: '270.00',
        contado_credito: 'credito',
        factura: 'N/A',
        status: 'pendiente',
        semana: 7,
        mes: 2,
        pct_comision: '3.50',
        origen: 'portal',
        capturo_usuario_id: usuarioGeneralId,
      });
      expect(fechaTexto(fila.fecha)).toBe(FECHA_BASE);
      expect(await detalleDe(venta.id)).toEqual([
        { presentacion_id: pre1, cantidad: 24, cantidad_promocion: 2, precio: '10.00' },
        { presentacion_id: pre2, cantidad: 5, cantidad_promocion: 0, precio: '6.00' },
      ]);
      // Credito: no se cobra sola.
      expect(await abonosDe(venta.id)).toEqual([]);
    });

    it('ignora cualquier precio que mande el cliente', async () => {
      const res = await registrar(
        cookieGeneral,
        cuerpo({
          lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0, precioCentavos: 1 }],
        }),
      ).expect(201);
      const venta = res.body as VentaRegistrada;
      expect(venta.montoCentavos).toBe(1000);
      expect((await detalleDe(venta.id))[0].precio).toBe('10.00');
    });

    it('una venta de Oficina no lleva vendedor', async () => {
      const res = await registrar(cookieGeneral, cuerpo({ vendedorId: null })).expect(201);
      const venta = res.body as VentaRegistrada;
      expect(venta.folio).toMatch(/^TJ250210OF\d{2}$/);
      expect(await ventaPorId(venta.id)).toMatchObject({
        vendedor_id: null,
        origen: 'portal',
        monto_total: '270.00',
      });
    });

    it('una fecha pasada usa el precio que habia entonces', async () => {
      const lineas = [{ presentacionId: pre1, cantidad: 2, cantidadPromocion: 0 }];
      const antes = (
        await registrar(cookieGeneral, cuerpo({ fecha: FECHA_ANTES_DEL_CAMBIO, lineas })).expect(201)
      ).body as VentaRegistrada;
      const despues = (
        await registrar(cookieGeneral, cuerpo({ fecha: FECHA_DESPUES_DEL_CAMBIO, lineas })).expect(201)
      ).body as VentaRegistrada;

      expect(antes.montoCentavos).toBe(2000);
      expect(despues.montoCentavos).toBe(2500);
      expect(antes.folio).toMatch(/^TJ250315OF\d{2}$/);
    });

    it('una fecha futura es 400 y no escribe nada', async () => {
      const numNota = nota();
      const res = await registrar(
        cookieGeneral,
        cuerpo({ fecha: mananaEnTijuana(), numNota }),
      ).expect(400);
      expect((res.body as { message: string }).message).toBe(
        'La fecha de la venta no puede ser futura.',
      );
      expect(await ventasConNota(numNota)).toHaveLength(0);
    });

    it('una linea con piezas sin precio a esa fecha es 409 y no escribe nada', async () => {
      const numNota = nota();
      const res = await registrar(
        cookieGeneral,
        cuerpo({
          numNota,
          lineas: [{ presentacionId: preSinPrecio, cantidad: 1, cantidadPromocion: 0 }],
        }),
      ).expect(409);
      expect((res.body as { message: string }).message).toBe(
        `Una de las presentaciones no tiene precio en la lista del cliente para el ${FECHA_BASE}.`,
      );
      expect(await ventasConNota(numNota)).toHaveLength(0);

      // Antes de que el cliente tuviera lista vigente, tampoco hay precio.
      await registrar(
        cookieGeneral,
        cuerpo({
          fecha: FECHA_SIN_PRECIOS,
          lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
        }),
      ).expect(409);
    });

    it('sin el permiso venta.registrar es 403', async () => {
      await registrar(cookieSinPermiso, cuerpo()).expect(403);
    });

    it('un cliente de otra sucursal es 403', async () => {
      await registrar(
        cookieTijuana,
        cuerpo({
          clienteId: clienteMx,
          vendedorId: null,
          lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
        }),
      ).expect(403);
    });

    it('un vendedor de otra sucursal se rechaza con 400', async () => {
      const res = await registrar(cookieGeneral, cuerpo({ vendedorId: vendedorMx })).expect(400);
      expect((res.body as { message: string }).message).toBe(
        'El repartidor elegido no es un vendedor activo de la sucursal del cliente.',
      );
    });

    it('un vendedor inactivo se rechaza con 400', async () => {
      await registrar(cookieGeneral, cuerpo({ vendedorId: vendedorTjInactivo })).expect(400);
    });

    it('sin repartidor (ni vendedor ni Oficina) es 400', async () => {
      const body: Record<string, unknown> = cuerpo();
      delete body.vendedorId;
      await registrar(cookieGeneral, body).expect(400);
    });

    it('contado deja su cobro por transferencia por defecto (Oficina: sin cobrador)', async () => {
      const venta = (
        await registrar(
          cookieGeneral,
          cuerpo({ vendedorId: null, contadoCredito: 'contado' }),
        ).expect(201)
      ).body as VentaRegistrada;

      expect(venta.status).toBe('pagada');
      expect(await abonosDe(venta.id)).toEqual([
        {
          monto: '270.00',
          metodo_pago: 'transferencia',
          vendedor_id: null,
          origen: 'venta_contado',
          folio: venta.folio,
        },
      ]);
    });

    it('contado en efectivo, si se elige, con el vendedor como cobrador', async () => {
      const venta = (
        await registrar(
          cookieGeneral,
          cuerpo({ contadoCredito: 'contado', metodoPago: 'efectivo' }),
        ).expect(201)
      ).body as VentaRegistrada;

      expect(await abonosDe(venta.id)).toEqual([
        expect.objectContaining({ metodo_pago: 'efectivo', vendedor_id: vendedorTj }),
      ]);
    });

    it('un # de nota repetido en la sucursal es 409; en otra sucursal si entra', async () => {
      const numNota = nota();
      await registrar(cookieGeneral, cuerpo({ numNota })).expect(201);

      const repetida = await registrar(
        cookieGeneral,
        cuerpo({ numNota: `  ${numNota.toUpperCase()} ` }),
      ).expect(409);
      expect((repetida.body as { message: string }).message).toBe(
        `Ya existe la nota ${numNota.toUpperCase()} en esta sucursal.`,
      );

      await registrar(
        cookieGeneral,
        cuerpo({
          clienteId: clienteMx,
          vendedorId: null,
          numNota,
          lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
        }),
      ).expect(201);
    });

    it('los folios OF son consecutivos por dia y por sucursal', async () => {
      const tj1 = (
        await registrar(cookieGeneral, cuerpo({ fecha: FECHA_CONSECUTIVOS })).expect(201)
      ).body as VentaRegistrada;
      const tj2 = (
        await registrar(cookieGeneral, cuerpo({ fecha: FECHA_CONSECUTIVOS })).expect(201)
      ).body as VentaRegistrada;
      const mx1 = (
        await registrar(
          cookieGeneral,
          cuerpo({
            fecha: FECHA_CONSECUTIVOS,
            clienteId: clienteMx,
            vendedorId: null,
            lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
          }),
        ).expect(201)
      ).body as VentaRegistrada;

      expect([tj1.folio, tj2.folio, mx1.folio]).toEqual([
        'TJ250211OF01',
        'TJ250211OF02',
        'MX250211OF01',
      ]);
    });

    it('grabaciones simultaneas no repiten numero', async () => {
      const respuestas = await Promise.all(
        [1, 2, 3, 4].map(() =>
          registrar(cookieGeneral, cuerpo({ fecha: FECHA_SIMULTANEAS })),
        ),
      );
      for (const r of respuestas) expect(r.status).toBe(201);
      const folios = respuestas.map((r) => (r.body as VentaRegistrada).folio).sort();
      expect(folios).toEqual([
        'TJ250212OF01',
        'TJ250212OF02',
        'TJ250212OF03',
        'TJ250212OF04',
      ]);
    });

    it('pasado de 99 folios OF en el dia es 409 y el contador no avanza', async () => {
      await db
        .insertInto('folio_oficina_contador')
        .values({ sucursal_id: tjId, fecha: FECHA_TOPE, ultimo: 99 })
        .execute();

      const res = await registrar(cookieGeneral, cuerpo({ fecha: FECHA_TOPE })).expect(409);
      expect((res.body as { message: string }).message).toBe(
        'Se alcanzó el máximo de 99 ventas de oficina para ese día.',
      );
      const fila = await db
        .selectFrom('folio_oficina_contador')
        .select('ultimo')
        .where('sucursal_id', '=', tjId)
        .where(fechaComoTexto, '=', FECHA_TOPE)
        .executeTakeFirstOrThrow();
      expect(fila.ultimo).toBe(99);
    });

    it('un rechazo despues de emitir no quema el folio', async () => {
      const numNota = nota();
      const primera = (
        await registrar(cookieGeneral, cuerpo({ fecha: FECHA_SIN_QUEMA, numNota })).expect(201)
      ).body as VentaRegistrada;
      // El # de nota repetido truena DESPUES de emitir el folio: el rollback lo devuelve.
      await registrar(cookieGeneral, cuerpo({ fecha: FECHA_SIN_QUEMA, numNota })).expect(409);
      const tercera = (
        await registrar(cookieGeneral, cuerpo({ fecha: FECHA_SIN_QUEMA })).expect(201)
      ).body as VentaRegistrada;

      expect([primera.folio, tercera.folio]).toEqual(['TJ250214OF01', 'TJ250214OF02']);
    });
  });

  /* ================================================================ */

  describe('GET /ventas/catalogo', () => {
    const catalogo = (cookie: string, clienteId: string, fecha: string) =>
      request(app.getHttpServer())
        .get(`/ventas/catalogo?clienteId=${clienteId}&fecha=${fecha}`)
        .set('Cookie', cookie);

    const propias = (lista: PresentacionDeCatalogo[]) =>
      lista.filter((p) => [pre1, pre2, preSinPrecio].includes(p.presentacionId));

    it('da las presentaciones del cliente con su precio a esa fecha, y las sin precio en null', async () => {
      const antes = (await catalogo(cookieGeneral, clienteTj, FECHA_ANTES_DEL_CAMBIO).expect(200))
        .body as PresentacionDeCatalogo[];
      expect(propias(antes)).toEqual([
        { presentacionId: pre1, producto: `Horchata e2e ${SUFIJO}`, volumen: '1 L', precioCentavos: 1000 },
        { presentacionId: preSinPrecio, producto: `Horchata e2e ${SUFIJO}`, volumen: '2 L', precioCentavos: null },
        { presentacionId: pre2, producto: `Horchata e2e ${SUFIJO}`, volumen: '500 ml', precioCentavos: 600 },
      ]);

      const despues = (await catalogo(cookieGeneral, clienteTj, FECHA_DESPUES_DEL_CAMBIO).expect(200))
        .body as PresentacionDeCatalogo[];
      expect(propias(despues).find((p) => p.presentacionId === pre1)?.precioCentavos).toBe(1250);
    });

    it('basta la sesion: no exige venta.registrar', async () => {
      await catalogo(cookieSinPermiso, clienteTj, FECHA_BASE).expect(200);
    });

    it('un cliente de otra sucursal es 403', async () => {
      await catalogo(cookieTijuana, clienteMx, FECHA_BASE).expect(403);
    });

    it('una fecha futura es 400', async () => {
      await catalogo(cookieGeneral, clienteTj, mananaEnTijuana()).expect(400);
    });
  });

  describe('GET /ventas/repartidores', () => {
    const repartidores = (cookie: string, sucursalId: string) =>
      request(app.getHttpServer())
        .get(`/ventas/repartidores?sucursalId=${sucursalId}`)
        .set('Cookie', cookie);

    it('da los vendedores activos de la sucursal, sin inactivos ni de otra sucursal', async () => {
      const lista = (await repartidores(cookieGeneral, tjId).expect(200)).body as {
        id: string;
        nombre: string;
      }[];
      const ids = lista.map((r) => r.id);
      expect(ids).toContain(vendedorTj);
      expect(ids).not.toContain(vendedorTjInactivo);
      expect(ids).not.toContain(vendedorMx);
      expect(lista.find((r) => r.id === vendedorTj)).toEqual({
        id: vendedorTj,
        nombre: `Ana Activa ${SUFIJO}`,
      });
    });

    it('otra sucursal es 403', async () => {
      await repartidores(cookieTijuana, mxId).expect(403);
    });
  });
});
```

Run: `npm run test:e2e --workspace=apps/backend -- ventas.e2e-spec`
Expected: FAIL — `POST /ventas` responde 404 (no hay controller).

- [ ] **Step 4: DTO**

Crear `apps/backend/src/modules/ventas-cobranza/dto/registrar-venta.dto.ts`:

```ts
import { Transform, Type } from 'class-transformer';
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
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  LARGO_MAX_COMENTARIOS,
  LARGO_MAX_NUM_NOTA,
  MAX_LINEAS_VENTA,
} from '../datos-venta';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** `integer` de Postgres. */
const MAX_PIEZAS = 2_147_483_647;

/** Una linea de la venta. **Sin precio**: lo pone el servidor (§4.2). */
export class LineaVentaDto {
  @IsUUID(undefined, { message: 'Cada línea necesita una presentación.' })
  presentacionId!: string;

  @IsInt({ message: 'La cantidad debe ser un número entero de piezas.' })
  @Min(0, { message: 'La cantidad no puede ser negativa.' })
  @Max(MAX_PIEZAS)
  cantidad!: number;

  @IsInt({ message: 'Las piezas de promoción deben ser un número entero.' })
  @Min(0, { message: 'Las piezas de promoción no pueden ser negativas.' })
  @Max(MAX_PIEZAS)
  cantidadPromocion!: number;
}

/**
 * `POST /ventas` (T-17, §4.2). Las reglas de fondo (presentacion repetida,
 * linea en 0, precio a la fecha, fecha no futura) las decide el servicio con
 * las mismas funciones que la tablet; aqui solo la forma.
 */
export class RegistrarVentaDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener el formato AAAA-MM-DD.',
  })
  fecha!: string;

  @IsUUID(undefined, { message: 'Elige el cliente.' })
  clienteId!: string;

  // Obligatorio, pero puede ser `null`: null es "Oficina" (venta de
  // mostrador). Ausente no es lo mismo que Oficina, y se rechaza.
  @ValidateIf((o: RegistrarVentaDto) => o.vendedorId !== null)
  @IsUUID(undefined, {
    message: 'Elige el repartidor: un vendedor, u Oficina.',
  })
  vendedorId!: string | null;

  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El número de nota es obligatorio.' })
  @MaxLength(LARGO_MAX_NUM_NOTA, {
    message: `El número de nota no puede pasar de ${LARGO_MAX_NUM_NOTA} caracteres.`,
  })
  numNota!: string;

  @IsIn(['contado', 'credito'], {
    message: 'La venta debe ser de contado o de crédito.',
  })
  contadoCredito!: 'contado' | 'credito';

  /** Solo cuenta en contado; por default transferencia (§2). */
  @IsOptional()
  @IsIn(['transferencia', 'efectivo'], {
    message: 'El método de pago debe ser transferencia o efectivo.',
  })
  metodoPago?: 'transferencia' | 'efectivo';

  /** Asignar el numero de factura es T-19. */
  @IsIn(['N/A', 'pendiente'], {
    message: 'La factura solo puede ser N/A o pendiente.',
  })
  factura!: 'N/A' | 'pendiente';

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(LARGO_MAX_COMENTARIOS, {
    message: `Los comentarios no pueden pasar de ${LARGO_MAX_COMENTARIOS} caracteres.`,
  })
  comentarios?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Captura al menos un producto.' })
  @ArrayMaxSize(MAX_LINEAS_VENTA, {
    message: `Una venta no puede traer más de ${MAX_LINEAS_VENTA} productos.`,
  })
  @ValidateNested({ each: true })
  @Type(() => LineaVentaDto)
  lineas!: LineaVentaDto[];
}
```

- [ ] **Step 5: Repositorio del portal**

Crear `apps/backend/src/modules/ventas-cobranza/ventas-portal.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { buscarSucursalUsuario as buscarSucursalUsuarioCompartido } from '../sucursales/buscar-sucursal-usuario';

/** El cliente de la venta y la sucursal que la venta hereda (§4.2, paso 1). */
export interface ClienteDeVenta {
  id: string;
  sucursalId: string;
  sucursalCodigo: string;
}

/** Un vendedor que se puede elegir como repartidor (§4.1). */
export interface Repartidor {
  id: string;
  nombre: string;
}

/**
 * Lecturas que necesita la venta del portal (T-17). La escritura de la venta
 * sigue en `VentasRepository`, la misma que usa la tablet.
 */
@Injectable()
export class VentasPortalRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  buscarSucursalUsuario(usuarioId: string) {
    return buscarSucursalUsuarioCompartido(this.db, usuarioId);
  }

  /** La venta, el folio OF y el cobro de contado entran o salen juntos. */
  enTransaccion<T>(tarea: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(tarea);
  }

  /**
   * El cliente, vivo, con su sucursal. **Sin filtrar por `tipo`**: la tablet
   * tampoco prohibe venderle a un prospecto (§3).
   */
  async clienteDeVenta(
    clienteId: string,
    conexion: Database = this.db,
  ): Promise<ClienteDeVenta | undefined> {
    const fila = await conexion
      .selectFrom('cliente')
      .innerJoin('sucursal', 'sucursal.id', 'cliente.sucursal_id')
      .select([
        'cliente.id as id',
        'cliente.sucursal_id as sucursal_id',
        'sucursal.codigo as codigo',
      ])
      .where('cliente.id', '=', clienteId)
      .where('cliente.deleted_at', 'is', null)
      .executeTakeFirst();
    return fila
      ? { id: fila.id, sucursalId: fila.sucursal_id, sucursalCodigo: fila.codigo }
      : undefined;
  }

  async codigoDeSucursal(sucursalId: string): Promise<string | undefined> {
    const fila = await this.db
      .selectFrom('sucursal')
      .select('codigo')
      .where('id', '=', sucursalId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila?.codigo;
  }

  /** Activos y vivos: un vendedor desactivado no sale a repartir. */
  async repartidoresActivos(sucursalId: string): Promise<Repartidor[]> {
    return this.db
      .selectFrom('vendedor')
      .select(['id', 'nombre'])
      .where('sucursal_id', '=', sucursalId)
      .where('activo', '=', true)
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .execute();
  }

  async esRepartidorActivo(
    vendedorId: string,
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<boolean> {
    const fila = await trx
      .selectFrom('vendedor')
      .select('id')
      .where('id', '=', vendedorId)
      .where('sucursal_id', '=', sucursalId)
      .where('activo', '=', true)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /** Producto y volumen de cada presentacion, para pintar el catalogo. */
  async nombresDePresentaciones(
    ids: readonly string[],
    conexion: Database,
  ): Promise<Map<string, { producto: string; volumen: string }>> {
    if (ids.length === 0) return new Map();
    const filas = await conexion
      .selectFrom('presentacion as pr')
      .innerJoin('producto as p', 'p.id', 'pr.producto_id')
      .select(['pr.id as id', 'p.nombre as producto', 'pr.volumen as volumen'])
      .where('pr.id', 'in', ids)
      .execute();
    return new Map(
      filas.map((f) => [f.id, { producto: f.producto, volumen: f.volumen }]),
    );
  }
}
```

- [ ] **Step 6: Servicio del portal**

Crear `apps/backend/src/modules/ventas-cobranza/ventas-portal.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PreciosRepository } from '../cartera-clientes/precios.repository';
import { hoyEnTijuana } from '../sincronizacion/operaciones';
import { resolverAlcance } from '../sucursales/alcance-sucursal';
import type { RegistrarVentaDto } from './dto/registrar-venta.dto';
import { FoliosOficinaAgotados } from './folio-oficina';
import { FoliosOficinaRepository } from './folios-oficina.repository';
import { esNotaDuplicada, motivoNotaDuplicada } from './nota-duplicada';
import { armarVentaPortal, revisarFechaVenta } from './venta-portal';
import { VentaRechazada } from './venta-rechazada';
import {
  VentasPortalRepository,
  type Repartidor,
} from './ventas-portal.repository';
import { VentasService } from './ventas.service';
import type { StatusInicial } from './reglas-venta';

/** Una presentacion del cliente con su precio a la fecha; `null` = "sin precio en la lista" (§3). */
export interface PresentacionDeCatalogo {
  presentacionId: string;
  producto: string;
  volumen: string;
  precioCentavos: number | null;
}

/** Lo que el portal muestra al grabar (§3, paso 6). */
export interface VentaRegistradaPortal {
  id: string;
  folio: string;
  montoCentavos: number;
  status: StatusInicial;
}

/**
 * La venta que captura la oficina en el portal (T-17, §4).
 *
 * Valida lo que es propio del portal (alcance del usuario, repartidor, fecha,
 * precio del servidor), emite el folio OF y entra por el MISMO
 * `VentasService.registrarVenta` que la tablet: el monto se calcula en un solo
 * lugar.
 */
@Injectable()
export class VentasPortalService {
  constructor(
    private readonly repo: VentasPortalRepository,
    private readonly precios: PreciosRepository,
    private readonly ventas: VentasService,
    private readonly folios: FoliosOficinaRepository,
  ) {}

  async catalogo(
    usuarioId: string,
    clienteId: string,
    fecha: string | undefined,
  ): Promise<PresentacionDeCatalogo[]> {
    const dia = fecha ?? '';
    const errorFecha = revisarFechaVenta(dia, hoyEnTijuana());
    if (errorFecha) throw new BadRequestException(errorFecha);

    const cliente = await this.repo.clienteDeVenta(clienteId);
    if (!cliente) throw new NotFoundException('No existe ese cliente.');
    await this.exigirAlcance(usuarioId, cliente.sucursalCodigo);

    return this.repo.enTransaccion(async (trx) => {
      // Sin `vigenteHastaHoy`: el precio de ESA fecha, el mismo que cobrara POST.
      const precios = await this.precios.presentacionesConPrecio(clienteId, dia, trx);
      const nombres = await this.repo.nombresDePresentaciones([...precios.keys()], trx);
      return [...precios]
        .flatMap(([presentacionId, precioCentavos]) => {
          const nombre = nombres.get(presentacionId);
          return nombre ? [{ presentacionId, ...nombre, precioCentavos }] : [];
        })
        .sort(
          (a, b) =>
            a.producto.localeCompare(b.producto, 'es') ||
            a.volumen.localeCompare(b.volumen, 'es'),
        );
    });
  }

  /** "Oficina" lo agrega la pantalla, no el servidor (§4.1). */
  async repartidores(usuarioId: string, sucursalId: string): Promise<Repartidor[]> {
    const codigo = await this.repo.codigoDeSucursal(sucursalId);
    if (codigo === undefined) throw new NotFoundException('No existe esa sucursal.');
    await this.exigirAlcance(usuarioId, codigo);
    return this.repo.repartidoresActivos(sucursalId);
  }

  /** §4.2: todo en una transaccion; si algo falla, ni venta ni folio ni cobro. */
  async registrar(
    usuarioId: string,
    dto: RegistrarVentaDto,
  ): Promise<VentaRegistradaPortal> {
    const errorFecha = revisarFechaVenta(dto.fecha, hoyEnTijuana());
    if (errorFecha) throw new BadRequestException(errorFecha);

    try {
      return await this.repo.enTransaccion(async (trx) => {
        const cliente = await this.repo.clienteDeVenta(dto.clienteId, trx);
        if (!cliente) throw new NotFoundException('No existe ese cliente.');
        await this.exigirAlcance(usuarioId, cliente.sucursalCodigo);

        if (
          dto.vendedorId !== null &&
          !(await this.repo.esRepartidorActivo(dto.vendedorId, cliente.sucursalId, trx))
        ) {
          throw new BadRequestException(
            'El repartidor elegido no es un vendedor activo de la sucursal del cliente.',
          );
        }

        const precios = await this.precios.presentacionesConPrecio(
          dto.clienteId,
          dto.fecha,
          trx,
        );
        const armada = armarVentaPortal(
          {
            clienteId: dto.clienteId,
            numNota: dto.numNota,
            contadoCredito: dto.contadoCredito,
            factura: dto.factura,
            comentarios: dto.comentarios ?? null,
            lineas: dto.lineas,
          },
          precios,
          dto.fecha,
        );
        if (!armada.ok) {
          if (armada.tipo === 'rechazo') throw new VentaRechazada(armada.rechazo);
          throw new BadRequestException(armada.motivo);
        }

        // Despues de todas las validaciones y dentro de la transaccion: un
        // rechazo posterior (p. ej. el # de nota) hace rollback del contador.
        const folio = await this.folios.emitir(
          { id: cliente.sucursalId, codigo: cliente.sucursalCodigo },
          dto.fecha,
          trx,
        );

        const registrada = await this.ventas.registrarVenta(
          armada.venta,
          {
            sucursalId: cliente.sucursalId,
            fechaOperacion: dto.fecha,
            vendedorId: dto.vendedorId,
            folio,
            usuarioId,
            origen: 'portal',
            metodoPagoContado: dto.metodoPago ?? 'transferencia',
          },
          trx,
        );
        return {
          id: registrada.id,
          folio,
          montoCentavos: registrada.montoCentavos,
          status: registrada.status,
        };
      });
    } catch (error) {
      // Kysely ya hizo rollback: aqui solo se traduce a HTTP.
      if (error instanceof VentaRechazada) throw new ConflictException(error.message);
      if (error instanceof FoliosOficinaAgotados) throw new ConflictException(error.message);
      if (esNotaDuplicada(error)) {
        // El DTO ya recorto el # de nota: es el mismo texto que choco.
        throw new ConflictException(motivoNotaDuplicada(dto.numNota));
      }
      throw error;
    }
  }

  /** Misma doctrina que `ClientesService.obtener`: el alcance se compara con la sucursal YA LEIDA. */
  private async exigirAlcance(usuarioId: string, codigoSucursal: string): Promise<void> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) throw new UnauthorizedException('Sesion invalida.');
    const alcance = resolverAlcance(fila.codigo, null);
    if (alcance.tipo === 'una' && alcance.codigo !== codigoSucursal) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }
  }
}
```

- [ ] **Step 7: Controller y módulo**

Crear `apps/backend/src/modules/ventas-cobranza/ventas.controller.ts`:

```ts
import { Body, Controller, Get, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { RegistrarVentaDto } from './dto/registrar-venta.dto';
import type { Repartidor } from './ventas-portal.repository';
import {
  VentasPortalService,
  type PresentacionDeCatalogo,
  type VentaRegistradaPortal,
} from './ventas-portal.service';

// Primer controller de ventas-cobranza (T-17). Sin @Publico(): el guard global
// exige sesion de portal. Las lecturas solo validan alcance; el candado
// `venta.registrar` va en la escritura, como en los catalogos.
@Controller('ventas')
export class VentasController {
  constructor(private readonly ventas: VentasPortalService) {}

  @Get('catalogo')
  async catalogo(
    @UsuarioActual() usuarioId: string,
    @Query('clienteId', ParseUUIDPipe) clienteId: string,
    @Query('fecha') fecha?: string,
  ): Promise<PresentacionDeCatalogo[]> {
    return this.ventas.catalogo(usuarioId, clienteId, fecha);
  }

  @Get('repartidores')
  async repartidores(
    @UsuarioActual() usuarioId: string,
    @Query('sucursalId', ParseUUIDPipe) sucursalId: string,
  ): Promise<Repartidor[]> {
    return this.ventas.repartidores(usuarioId, sucursalId);
  }

  @Post()
  @RequierePermiso('venta.registrar')
  async registrar(
    @UsuarioActual() usuarioId: string,
    @Body() dto: RegistrarVentaDto,
  ): Promise<VentaRegistradaPortal> {
    return this.ventas.registrar(usuarioId, dto);
  }
}
```

Reemplazar `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts` completo por:

```ts
import { Module } from '@nestjs/common';
import { CarteraClientesModule } from '../cartera-clientes/cartera-clientes.module';
import { CobranzasRepository } from './cobranzas.repository';
import { CobranzasService } from './cobranzas.service';
import { FoliosOficinaRepository } from './folios-oficina.repository';
import { VentasController } from './ventas.controller';
import { VentasPortalRepository } from './ventas-portal.repository';
import { VentasPortalService } from './ventas-portal.service';
import { VentasRepository } from './ventas.repository';
import { VentasService } from './ventas.service';

// Ventas y Cobranza. Exporta `VentasService` (T-16) y `CobranzasService` (T-20)
// para que sincronizacion/ despache las operaciones de la tablet (ADR-0009); la
// dependencia va de sincronizacion hacia aqui, nunca al reves. Importa Cartera
// de Clientes porque es la duena de los precios.
//
// T-17: el portal registra ventas por `VentasController`, que entra por el
// mismo `VentasService` que la tablet.
@Module({
  imports: [CarteraClientesModule],
  controllers: [VentasController],
  providers: [
    VentasService,
    VentasRepository,
    CobranzasService,
    CobranzasRepository,
    FoliosOficinaRepository,
    VentasPortalService,
    VentasPortalRepository,
  ],
  exports: [VentasService, CobranzasService],
})
export class VentasCobranzaModule {}
```

- [ ] **Step 8: Correr las pruebas**

```bash
npm test --workspace=apps/backend -- venta-portal.spec
npm run test:e2e --workspace=apps/backend -- ventas.e2e-spec
```

Expected: PASS (unit de `venta-portal.spec` y las 24 de `ventas.e2e-spec`).

- [ ] **Step 9: Suite completa, lint, build y commit**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
git status --short
git add apps/backend/src/modules/ventas-cobranza/venta-portal.ts apps/backend/src/modules/ventas-cobranza/venta-portal.spec.ts apps/backend/src/modules/ventas-cobranza/dto/registrar-venta.dto.ts apps/backend/src/modules/ventas-cobranza/ventas-portal.repository.ts apps/backend/src/modules/ventas-cobranza/ventas-portal.service.ts apps/backend/src/modules/ventas-cobranza/ventas.controller.ts apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts apps/backend/test/ventas.e2e-spec.ts
git commit -m "$(cat <<'EOF'
T-17: endpoints del portal para registrar venta, catalogo a la fecha y repartidores

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Expected de la suite e2e completa: todo en verde. Si falla **solo** por el 401 intermitente conocido de `auth-vendedor.e2e-spec.ts`, repetirla una vez; si vuelve a fallar o falla otra cosa, detente.

---

## Task 7: Pantalla "Registrar venta" del portal

**Files:**
- Create: `apps/portal/src/lib/ventas.ts`
- Create: `apps/portal/src/lib/ventas.test.ts`
- Create: `apps/portal/src/components/ventas/pantalla-registrar-venta.tsx`
- Create: `apps/portal/src/components/ventas/pantalla-registrar-venta.test.tsx`
- Create: `apps/portal/src/app/(portal)/operacion/registrar-venta/page.tsx`
- Modify: `apps/portal/src/components/layout/nav-config.ts`

**Interfaces:**
- Consumes: las tres rutas de la Task 6 y sus formas; `listarClientes(sucursal, "todos")`, `obtenerCliente(id)` (→ `ClienteDetalle.sucursalId`) de `@/lib/clientes`; `useAuth().puede`; `useEnvioFormulario`; `ErrorApi`.
- Produces:
  - `lib/ventas.ts`: tipos `PresentacionDeCatalogo`, `Repartidor`, `NuevaVenta`, `VentaRegistrada`, `ContadoCredito`, `MetodoPagoContado`, `FacturaVenta`; funciones `obtenerCatalogoVenta(clienteId, fecha)`, `listarRepartidores(sucursalId)`, `registrarVenta(venta)`, `hoyEnTijuana(ahora?)`, `leerPiezas(texto): number | null`, `formatearPesos(centavos)`.
  - `<PantallaRegistrarVenta sucursal={string | null} />` en la ruta `/operacion/registrar-venta`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `apps/portal/src/lib/ventas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatearPesos, hoyEnTijuana, leerPiezas } from "./ventas";

describe("hoyEnTijuana", () => {
  it("a las 22:30 de Tijuana devuelve hoy, aunque en UTC ya sea mañana", () => {
    // 2026-10-07T05:30Z = 2026-10-06 22:30 en Tijuana (UTC-7, horario de verano).
    expect(hoyEnTijuana(new Date("2026-10-07T05:30:00Z"))).toBe("2026-10-06");
  });

  it("en invierno (UTC-8) tambien", () => {
    expect(hoyEnTijuana(new Date("2026-12-02T07:59:00Z"))).toBe("2026-12-01");
  });
});

describe("leerPiezas", () => {
  it.each([
    ["", 0],
    ["0", 0],
    ["24", 24],
    [" 5 ", 5],
  ])("%j son %i piezas", (texto, piezas) => {
    expect(leerPiezas(texto)).toBe(piezas);
  });

  it.each(["2.5", "-1", "abc", "1e3"])("%j no es un numero de piezas", (texto) => {
    expect(leerPiezas(texto)).toBeNull();
  });
});

describe("formatearPesos", () => {
  it("centavos a pesos con dos decimales", () => {
    expect(formatearPesos(27000)).toBe("$270.00");
    expect(formatearPesos(123456)).toBe("$1,234.56");
  });
});
```

Crear `apps/portal/src/components/ventas/pantalla-registrar-venta.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as clientesLib from "@/lib/clientes";
import type { ClienteDetalle, ClienteResumen } from "@/lib/clientes";
import * as ventasLib from "@/lib/ventas";
import type { PresentacionDeCatalogo, VentaRegistrada } from "@/lib/ventas";
import { PantallaRegistrarVenta } from "./pantalla-registrar-venta";

// Mismo limite que pantalla-clientes.test.tsx: se mockea la capa de red
// (lib/*.ts), no apiFetch. De lib/ventas se conservan las utilidades puras.
vi.mock("@/lib/clientes");
vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return {
    ...real,
    obtenerCatalogoVenta: vi.fn(),
    listarRepartidores: vi.fn(),
    registrarVenta: vi.fn(),
  };
});
vi.mock("@/components/auth/auth-provider");

const listarClientes = vi.mocked(clientesLib.listarClientes);
const obtenerCliente = vi.mocked(clientesLib.obtenerCliente);
const obtenerCatalogoVenta = vi.mocked(ventasLib.obtenerCatalogoVenta);
const listarRepartidores = vi.mocked(ventasLib.listarRepartidores);
const registrarVenta = vi.mocked(ventasLib.registrarVenta);

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: null,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede,
  });
}

const CLIENTE: ClienteResumen = {
  id: "c1",
  nombre: "Abarrotes Lupita",
  telefono: "664",
  tipo: "cliente",
  tipoNegocio: null,
  sucursalCodigo: "TJ",
};

const CATALOGO: PresentacionDeCatalogo[] = [
  { presentacionId: "p1", producto: "Horchata", volumen: "1 L", precioCentavos: 1000 },
  { presentacionId: "p2", producto: "Jamaica", volumen: "500 ml", precioCentavos: 600 },
  { presentacionId: "p3", producto: "Tamarindo", volumen: "2 L", precioCentavos: null },
];

const REGISTRADA: VentaRegistrada = {
  id: "v1",
  folio: "TJ261006OF01",
  montoCentavos: 27000,
  status: "pagada",
};

/** Renderiza, elige el cliente y espera a que carguen productos y repartidores. */
async function prepararPantalla() {
  const usuario = userEvent.setup();
  render(<PantallaRegistrarVenta sucursal={null} />);
  await usuario.type(screen.getByLabelText("Cliente"), "lupi");
  await usuario.click(await screen.findByRole("button", { name: /Abarrotes Lupita/ }));
  await screen.findByLabelText("Cantidad de Horchata 1 L");
  await screen.findByRole("option", { name: "Ana Pérez" });
  return usuario;
}

describe("PantallaRegistrarVenta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth(() => true);
    listarClientes.mockResolvedValue([CLIENTE]);
    obtenerCliente.mockResolvedValue({ id: "c1", sucursalId: "suc-tj" } as ClienteDetalle);
    listarRepartidores.mockResolvedValue([{ id: "v-ana", nombre: "Ana Pérez" }]);
    obtenerCatalogoVenta.mockResolvedValue(CATALOGO);
    registrarVenta.mockResolvedValue(REGISTRADA);
  });

  it("arma el payload sin precios, con el repartidor elegido, y muestra la venta creada", async () => {
    const usuario = await prepararPantalla();
    expect(obtenerCatalogoVenta).toHaveBeenCalledWith("c1", ventasLib.hoyEnTijuana());
    expect(listarRepartidores).toHaveBeenCalledWith("suc-tj");

    await usuario.selectOptions(screen.getByLabelText("Repartidor"), "v-ana");
    await usuario.type(screen.getByLabelText("Cantidad de Horchata 1 L"), "24");
    await usuario.type(screen.getByLabelText("Promoción de Horchata 1 L"), "2");
    await usuario.type(screen.getByLabelText("Cantidad de Jamaica 500 ml"), "5");
    await usuario.type(screen.getByLabelText("Número de nota"), "1234");

    expect(screen.getByText("Total: $270.00")).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Grabar" }));

    expect(registrarVenta).toHaveBeenCalledWith({
      fecha: ventasLib.hoyEnTijuana(),
      clienteId: "c1",
      vendedorId: "v-ana",
      numNota: "1234",
      contadoCredito: "contado",
      metodoPago: "transferencia",
      factura: "N/A",
      lineas: [
        { presentacionId: "p1", cantidad: 24, cantidadPromocion: 2 },
        { presentacionId: "p2", cantidad: 5, cantidadPromocion: 0 },
      ],
    });
    const resultado = await screen.findByRole("status");
    expect(resultado).toHaveTextContent("TJ261006OF01");
    expect(resultado).toHaveTextContent("$270.00");
    expect(resultado).toHaveTextContent("Pagada");
    expect(screen.getByRole("button", { name: "Registrar otra" })).toBeInTheDocument();
  });

  it("Oficina manda vendedorId null, y a crédito no manda método de pago", async () => {
    const usuario = await prepararPantalla();
    await usuario.selectOptions(screen.getByLabelText("Repartidor"), "oficina");
    await usuario.selectOptions(screen.getByLabelText("Contado o crédito"), "credito");
    await usuario.type(screen.getByLabelText("Cantidad de Horchata 1 L"), "1");
    await usuario.type(screen.getByLabelText("Número de nota"), "77");
    await usuario.click(screen.getByRole("button", { name: "Grabar" }));

    expect(registrarVenta).toHaveBeenCalledTimes(1);
    const enviada = registrarVenta.mock.calls[0][0];
    expect(enviada.vendedorId).toBeNull();
    expect(enviada.contadoCredito).toBe("credito");
    expect(enviada).not.toHaveProperty("metodoPago");
  });

  it("una presentación sin precio a esa fecha aparece deshabilitada", async () => {
    await prepararPantalla();
    expect(screen.getByLabelText("Cantidad de Tamarindo 2 L")).toBeDisabled();
    expect(screen.getByLabelText("Promoción de Tamarindo 2 L")).toBeDisabled();
    expect(screen.getByText("sin precio en la lista")).toBeInTheDocument();
  });

  it("muestra el mensaje del servidor", async () => {
    registrarVenta.mockRejectedValue(
      new ErrorApi("fallo", 409, "Ya existe la nota 1234 en esta sucursal."),
    );
    const usuario = await prepararPantalla();
    await usuario.selectOptions(screen.getByLabelText("Repartidor"), "oficina");
    await usuario.type(screen.getByLabelText("Cantidad de Horchata 1 L"), "1");
    await usuario.type(screen.getByLabelText("Número de nota"), "1234");
    await usuario.click(screen.getByRole("button", { name: "Grabar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya existe la nota 1234 en esta sucursal.",
    );
  });

  it("sin el permiso venta.registrar no aparece Grabar", async () => {
    mockAuth(() => false);
    await prepararPantalla();
    expect(screen.queryByRole("button", { name: "Grabar" })).not.toBeInTheDocument();
    expect(screen.getByText("No tienes permiso para registrar ventas.")).toBeInTheDocument();
  });

  // Review Focus 4
  it("no manda nada sin productos", async () => {
    const usuario = await prepararPantalla();
    await usuario.selectOptions(screen.getByLabelText("Repartidor"), "oficina");
    await usuario.type(screen.getByLabelText("Número de nota"), "1");
    await usuario.click(screen.getByRole("button", { name: "Grabar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Captura al menos un producto.");
    expect(registrarVenta).not.toHaveBeenCalled();
  });

  // Review Focus 5
  it("una cantidad no entera se avisa en vez de mandarse", async () => {
    const usuario = await prepararPantalla();
    await usuario.selectOptions(screen.getByLabelText("Repartidor"), "oficina");
    await usuario.type(screen.getByLabelText("Cantidad de Horchata 1 L"), "2.5");
    await usuario.type(screen.getByLabelText("Número de nota"), "1");
    await usuario.click(screen.getByRole("button", { name: "Grabar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Las cantidades deben ser números enteros de 0 en adelante.",
    );
    expect(registrarVenta).not.toHaveBeenCalled();
  });

  // Review Focus 3
  it("doble clic graba una sola vez", async () => {
    let terminar!: (v: VentaRegistrada) => void;
    registrarVenta.mockReturnValue(
      new Promise<VentaRegistrada>((r) => {
        terminar = r;
      }),
    );
    const usuario = await prepararPantalla();
    await usuario.selectOptions(screen.getByLabelText("Repartidor"), "oficina");
    await usuario.type(screen.getByLabelText("Cantidad de Horchata 1 L"), "1");
    await usuario.type(screen.getByLabelText("Número de nota"), "1");

    const grabar = screen.getByRole("button", { name: "Grabar" });
    await usuario.click(grabar);
    await usuario.click(screen.getByRole("button", { name: "Grabando…" }));

    expect(registrarVenta).toHaveBeenCalledTimes(1);
    terminar(REGISTRADA);
    await screen.findByRole("status");
  });

  // Review Focus 2
  it("cambiar la fecha recarga precios y no manda líneas que quedaron sin precio", async () => {
    const usuario = await prepararPantalla();
    await usuario.selectOptions(screen.getByLabelText("Repartidor"), "oficina");
    await usuario.type(screen.getByLabelText("Cantidad de Horchata 1 L"), "3");
    await usuario.type(screen.getByLabelText("Cantidad de Jamaica 500 ml"), "2");
    await usuario.type(screen.getByLabelText("Número de nota"), "9");

    // A esa fecha la Horchata todavia no tenia precio.
    obtenerCatalogoVenta.mockResolvedValue([
      { ...CATALOGO[0], precioCentavos: null },
      CATALOGO[1],
      CATALOGO[2],
    ]);
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-01-15" } });
    await waitFor(() =>
      expect(screen.getByLabelText("Cantidad de Horchata 1 L")).toBeDisabled(),
    );
    expect(obtenerCatalogoVenta).toHaveBeenLastCalledWith("c1", "2026-01-15");
    expect(screen.getByText("Total: $12.00")).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Grabar" }));
    expect(registrarVenta).toHaveBeenCalledWith(
      expect.objectContaining({
        fecha: "2026-01-15",
        lineas: [{ presentacionId: "p2", cantidad: 2, cantidadPromocion: 0 }],
      }),
    );
  });
});
```

Run: `npm test --workspace=apps/portal -- ventas`
Expected: FAIL — no existen `@/lib/ventas` ni `./pantalla-registrar-venta`.

- [ ] **Step 2: `lib/ventas.ts`**

Crear `apps/portal/src/lib/ventas.ts`:

```ts
import { apiFetch } from "./api";

// Copia normativa de las formas de
// apps/backend/src/modules/ventas-cobranza/ventas-portal.service.ts
// (`PresentacionDeCatalogo`, `VentaRegistradaPortal`), ventas-portal.repository.ts
// (`Repartidor`) y del cuerpo de dto/registrar-venta.dto.ts. Mismo trato que
// lib/precios.ts: no hay tipo compartido; un cambio de forma en un lado exige el
// equivalente en el otro.

/** Una presentación del cliente con su precio a la fecha; `null` = "sin precio en la lista". */
export interface PresentacionDeCatalogo {
  presentacionId: string;
  producto: string;
  volumen: string;
  precioCentavos: number | null;
}

export interface Repartidor {
  id: string;
  nombre: string;
}

export type ContadoCredito = "contado" | "credito";
export type MetodoPagoContado = "transferencia" | "efectivo";
export type FacturaVenta = "N/A" | "pendiente";

/** El cuerpo de `POST /ventas`. **Sin precios**: los pone el servidor. */
export interface NuevaVenta {
  fecha: string;
  clienteId: string;
  /** `null` = Oficina (venta de mostrador). */
  vendedorId: string | null;
  numNota: string;
  contadoCredito: ContadoCredito;
  /** Solo en contado. */
  metodoPago?: MetodoPagoContado;
  factura: FacturaVenta;
  comentarios?: string;
  lineas: { presentacionId: string; cantidad: number; cantidadPromocion: number }[];
}

export interface VentaRegistrada {
  id: string;
  folio: string;
  montoCentavos: number;
  status: "pagada" | "pendiente" | "promocion";
}

export function obtenerCatalogoVenta(
  clienteId: string,
  fecha: string,
): Promise<PresentacionDeCatalogo[]> {
  const params = new URLSearchParams({ clienteId, fecha });
  return apiFetch<PresentacionDeCatalogo[]>(`/ventas/catalogo?${params.toString()}`);
}

export function listarRepartidores(sucursalId: string): Promise<Repartidor[]> {
  return apiFetch<Repartidor[]>(
    `/ventas/repartidores?sucursalId=${encodeURIComponent(sucursalId)}`,
  );
}

export function registrarVenta(venta: NuevaVenta): Promise<VentaRegistrada> {
  return apiFetch<VentaRegistrada>("/ventas", {
    method: "POST",
    body: JSON.stringify(venta),
  });
}

/**
 * Hoy en Tijuana, `AAAA-MM-DD`. NUNCA `toISOString()` (UTC: a las 17:00 de
 * Tijuana ya es mañana) ni la fecha local del navegador (el equipo desarrolla
 * en Europe/Madrid). Es la misma regla que `hoyEnTijuana()` del backend, que es
 * quien decide si la fecha es futura.
 */
export function hoyEnTijuana(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Tijuana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

/** Piezas tecleadas: vacío es 0; un entero de 0 en adelante; cualquier otra cosa, `null`. */
export function leerPiezas(texto: string): number | null {
  const limpio = texto.trim();
  if (limpio === "") return 0;
  return /^\d+$/.test(limpio) ? Number(limpio) : null;
}

/** Centavos a `$1,234.56`. */
export function formatearPesos(centavos: number): string {
  return `$${(centavos / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
```

Run: `npm test --workspace=apps/portal -- lib/ventas`
Expected: PASS.

- [ ] **Step 3: La pantalla**

Crear `apps/portal/src/components/ventas/pantalla-registrar-venta.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { ErrorApi } from "@/lib/api";
import { listarClientes, obtenerCliente, type ClienteResumen } from "@/lib/clientes";
import {
  formatearPesos,
  hoyEnTijuana,
  leerPiezas,
  listarRepartidores,
  obtenerCatalogoVenta,
  registrarVenta,
  type ContadoCredito,
  type FacturaVenta,
  type MetodoPagoContado,
  type NuevaVenta,
  type PresentacionDeCatalogo,
  type Repartidor,
  type VentaRegistrada,
} from "@/lib/ventas";

/** Valor del desplegable para la venta de mostrador: viaja como `vendedorId: null`. */
const OFICINA = "oficina";

const ETIQUETA_STATUS: Record<VentaRegistrada["status"], string> = {
  pagada: "Pagada",
  pendiente: "Pendiente",
  promocion: "Promoción",
};

type Captura = Record<string, { cantidad: string; promocion: string }>;

/** Sin acentos ni mayúsculas, para buscar "jose" y encontrar "José". */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Registrar venta desde el portal (T-17, parte 1, §3 del spec).
 *
 * El precio no se teclea: sale del catálogo del cliente a la fecha
 * (`GET /ventas/catalogo`) y el servidor lo vuelve a resolver al grabar. El
 * total de aquí es solo una vista previa.
 */
export function PantallaRegistrarVenta({ sucursal }: { sucursal: string | null }) {
  const { puede } = useAuth();
  const puedeRegistrar = puede("venta.registrar");

  const [fecha, setFecha] = useState(() => hoyEnTijuana());
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [cliente, setCliente] = useState<ClienteResumen | null>(null);
  const [repartidores, setRepartidores] = useState<Repartidor[]>([]);
  const [repartidor, setRepartidor] = useState("");
  const [catalogo, setCatalogo] = useState<PresentacionDeCatalogo[]>([]);
  const [captura, setCaptura] = useState<Captura>({});
  const [numNota, setNumNota] = useState("");
  const [contadoCredito, setContadoCredito] = useState<ContadoCredito>("contado");
  const [metodoPago, setMetodoPago] = useState<MetodoPagoContado>("transferencia");
  const [factura, setFactura] = useState<FacturaVenta>("N/A");
  const [comentarios, setComentarios] = useState("");
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const [resultado, setResultado] = useState<VentaRegistrada | null>(null);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo registrar la venta.");

  // Clientes y prospectos del alcance (el backend acota por sucursal).
  useEffect(() => {
    let vigente = true;
    listarClientes(sucursal, "todos")
      .then((lista) => {
        if (vigente) setClientes(lista);
      })
      .catch(() => {
        if (vigente) setErrorCarga("No se pudieron cargar los clientes.");
      });
    return () => {
      vigente = false;
    };
  }, [sucursal]);

  // Repartidores: la sucursal sale del DETALLE (la fila de la lista solo trae el código).
  useEffect(() => {
    if (!cliente) return;
    let vigente = true;
    obtenerCliente(cliente.id)
      .then((detalle) => listarRepartidores(detalle.sucursalId))
      .then((lista) => {
        if (vigente) setRepartidores(lista);
      })
      .catch(() => {
        if (vigente) setErrorCarga("No se pudieron cargar los repartidores.");
      });
    return () => {
      vigente = false;
    };
  }, [cliente]);

  // Productos con el precio de ESA fecha. `vigente` descarta una respuesta vieja
  // si la fecha cambia antes de que llegue.
  useEffect(() => {
    if (!cliente || !fecha) return;
    let vigente = true;
    obtenerCatalogoVenta(cliente.id, fecha)
      .then((lista) => {
        if (vigente) setCatalogo(lista);
      })
      .catch((err: unknown) => {
        if (!vigente) return;
        setCatalogo([]);
        setErrorCarga(
          err instanceof ErrorApi && err.mensajeApi
            ? err.mensajeApi
            : "No se pudieron cargar los productos del cliente.",
        );
      });
    return () => {
      vigente = false;
    };
  }, [cliente, fecha]);

  const coincidencias = useMemo(() => {
    const q = normalizar(busqueda.trim());
    if (q === "") return [];
    return clientes.filter((c) => normalizar(c.nombre).includes(q)).slice(0, 10);
  }, [busqueda, clientes]);

  // Solo cuentan las presentaciones con precio: una deshabilitada nunca suma ni viaja.
  const totalCentavos = catalogo.reduce((total, p) => {
    if (p.precioCentavos === null) return total;
    const piezas = leerPiezas(captura[p.presentacionId]?.cantidad ?? "");
    return total + (piezas ?? 0) * p.precioCentavos;
  }, 0);

  function elegirCliente(elegido: ClienteResumen) {
    setCliente(elegido);
    setBusqueda("");
    setRepartidor("");
    setRepartidores([]);
    setCatalogo([]);
    setCaptura({});
    setErrorCarga(null);
  }

  /** Sin cliente no hay catalogo ni repartidores: nada viejo puede sumar al total. */
  function quitarCliente() {
    setCliente(null);
    setRepartidor("");
    setRepartidores([]);
    setCatalogo([]);
    setCaptura({});
  }

  function cambiarCaptura(presentacionId: string, campo: "cantidad" | "promocion", valor: string) {
    setCaptura((actual) => ({
      ...actual,
      [presentacionId]: {
        cantidad: actual[presentacionId]?.cantidad ?? "",
        promocion: actual[presentacionId]?.promocion ?? "",
        [campo]: valor,
      },
    }));
  }

  function registrarOtra() {
    setCliente(null);
    setBusqueda("");
    setRepartidores([]);
    setRepartidor("");
    setCatalogo([]);
    setCaptura({});
    setNumNota("");
    setContadoCredito("contado");
    setMetodoPago("transferencia");
    setFactura("N/A");
    setComentarios("");
    setErrorLocal(null);
    setResultado(null);
  }

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErrorLocal(null);
    if (!cliente) {
      setErrorLocal("Elige el cliente.");
      return;
    }
    if (repartidor === "") {
      setErrorLocal("Elige el repartidor, u Oficina.");
      return;
    }

    const lineas: NuevaVenta["lineas"] = [];
    for (const p of catalogo) {
      if (p.precioCentavos === null) continue;
      const cantidad = leerPiezas(captura[p.presentacionId]?.cantidad ?? "");
      const promocion = leerPiezas(captura[p.presentacionId]?.promocion ?? "");
      if (cantidad === null || promocion === null) {
        setErrorLocal("Las cantidades deben ser números enteros de 0 en adelante.");
        return;
      }
      if (cantidad + promocion > 0) {
        lineas.push({ presentacionId: p.presentacionId, cantidad, cantidadPromocion: promocion });
      }
    }
    if (lineas.length === 0) {
      setErrorLocal("Captura al menos un producto.");
      return;
    }

    const comentario = comentarios.trim();
    const venta: NuevaVenta = {
      fecha,
      clienteId: cliente.id,
      vendedorId: repartidor === OFICINA ? null : repartidor,
      numNota: numNota.trim(),
      contadoCredito,
      ...(contadoCredito === "contado" ? { metodoPago } : {}),
      factura,
      ...(comentario ? { comentarios: comentario } : {}),
      lineas,
    };
    await enviar(
      async () => {
        setResultado(await registrarVenta(venta));
      },
      () => {},
    );
  }

  if (resultado) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Registrar venta</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div role="status" className="rounded-md border p-4 text-sm">
            <p className="font-semibold">Venta registrada</p>
            <p>
              Folio <span className="font-mono">{resultado.folio}</span> ·{" "}
              {formatearPesos(resultado.montoCentavos)} · {ETIQUETA_STATUS[resultado.status]}
            </p>
            <p className="text-muted-foreground">
              Si hay nota de papel, anota el folio en ella.
            </p>
          </div>
          <div>
            <Button onClick={registrarOtra}>Registrar otra</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const mensajeError = errorLocal ?? error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registrar venta</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={alEnviar} className="flex flex-col gap-5">
          {errorCarga && (
            <p className="text-sm text-destructive">{errorCarga}</p>
          )}

          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="fecha" className="text-sm font-medium">
                Fecha
              </label>
              <input
                id="fecha"
                type="date"
                required
                max={hoyEnTijuana()}
                disabled={enviando}
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="rounded-md border px-3 py-2 text-sm"
              />
            </div>

            <div className="flex min-w-72 flex-1 flex-col gap-1.5">
              <label htmlFor="buscar-cliente" className="text-sm font-medium">
                Cliente
              </label>
              {cliente ? (
                <div className="flex items-center gap-2 text-sm">
                  <span>
                    {cliente.nombre} · {cliente.sucursalCodigo}
                    {cliente.tipo === "prospecto" ? " · Prospecto" : ""}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={enviando}
                    onClick={quitarCliente}
                  >
                    Cambiar
                  </Button>
                </div>
              ) : (
                <>
                  <input
                    id="buscar-cliente"
                    autoComplete="off"
                    placeholder="Escribe el nombre del cliente"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    className="rounded-md border px-3 py-2 text-sm"
                  />
                  {coincidencias.length > 0 && (
                    <ul className="flex flex-col rounded-md border">
                      {coincidencias.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => elegirCliente(c)}
                            className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                          >
                            {c.nombre} · {c.sucursalCodigo}
                            {c.tipo === "prospecto" ? " · Prospecto" : ""}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="repartidor" className="text-sm font-medium">
                Repartidor
              </label>
              <select
                id="repartidor"
                disabled={enviando || !cliente}
                value={repartidor}
                onChange={(e) => setRepartidor(e.target.value)}
                className="w-64 rounded-md border px-3 py-2 text-sm"
              >
                <option value="">Elige…</option>
                {repartidores.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nombre}
                  </option>
                ))}
                <option value={OFICINA}>Oficina</option>
              </select>
            </div>
          </div>

          {cliente && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 font-medium">Producto</th>
                  <th className="py-1 font-medium">Precio</th>
                  <th className="py-1 font-medium">Cantidad</th>
                  <th className="py-1 font-medium">Promoción</th>
                  <th className="py-1 text-right font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {catalogo.map((p) => {
                  const nombre = `${p.producto} ${p.volumen}`;
                  const sinPrecio = p.precioCentavos === null;
                  const piezas = leerPiezas(captura[p.presentacionId]?.cantidad ?? "") ?? 0;
                  return (
                    <tr key={p.presentacionId} className="border-t">
                      <td className="py-1.5">{nombre}</td>
                      <td className="py-1.5">
                        {sinPrecio ? (
                          <span className="text-muted-foreground">sin precio en la lista</span>
                        ) : (
                          formatearPesos(p.precioCentavos ?? 0)
                        )}
                      </td>
                      <td className="py-1.5">
                        <input
                          aria-label={`Cantidad de ${nombre}`}
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          disabled={sinPrecio || enviando}
                          value={captura[p.presentacionId]?.cantidad ?? ""}
                          onChange={(e) => cambiarCaptura(p.presentacionId, "cantidad", e.target.value)}
                          className="w-24 rounded-md border px-2 py-1"
                        />
                      </td>
                      <td className="py-1.5">
                        <input
                          aria-label={`Promoción de ${nombre}`}
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          disabled={sinPrecio || enviando}
                          value={captura[p.presentacionId]?.promocion ?? ""}
                          onChange={(e) => cambiarCaptura(p.presentacionId, "promocion", e.target.value)}
                          className="w-24 rounded-md border px-2 py-1"
                        />
                      </td>
                      <td className="py-1.5 text-right">
                        {sinPrecio ? "—" : formatearPesos(piezas * (p.precioCentavos ?? 0))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <p className="text-right text-base font-semibold">Total: {formatearPesos(totalCentavos)}</p>

          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="num-nota" className="text-sm font-medium">
                Número de nota
              </label>
              <input
                id="num-nota"
                required
                maxLength={30}
                disabled={enviando}
                value={numNota}
                onChange={(e) => setNumNota(e.target.value)}
                className="w-40 rounded-md border px-3 py-2 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="contado-credito" className="text-sm font-medium">
                Contado o crédito
              </label>
              <select
                id="contado-credito"
                disabled={enviando}
                value={contadoCredito}
                onChange={(e) => setContadoCredito(e.target.value as ContadoCredito)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                <option value="contado">Contado</option>
                <option value="credito">Crédito</option>
              </select>
            </div>

            {contadoCredito === "contado" && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="metodo-pago" className="text-sm font-medium">
                  Método de pago
                </label>
                <select
                  id="metodo-pago"
                  disabled={enviando}
                  value={metodoPago}
                  onChange={(e) => setMetodoPago(e.target.value as MetodoPagoContado)}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <option value="transferencia">Transferencia</option>
                  <option value="efectivo">Efectivo</option>
                </select>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="factura" className="text-sm font-medium">
                Factura
              </label>
              <select
                id="factura"
                disabled={enviando}
                value={factura}
                onChange={(e) => setFactura(e.target.value as FacturaVenta)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                <option value="N/A">N/A</option>
                <option value="pendiente">Pendiente</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="comentarios" className="text-sm font-medium">
              Comentarios
            </label>
            <textarea
              id="comentarios"
              maxLength={500}
              disabled={enviando}
              value={comentarios}
              onChange={(e) => setComentarios(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>

          {mensajeError && (
            <p role="alert" className="text-sm text-destructive">
              {mensajeError}
            </p>
          )}

          {puedeRegistrar ? (
            <div>
              <Button type="submit" disabled={enviando}>
                {enviando ? "Grabando…" : "Grabar"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No tienes permiso para registrar ventas.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
```

> Nota para el implementador: el `<p>` de `errorCarga` **no** lleva `role="alert"` a propósito, para que las pruebas que buscan *el* `alert` encuentren solo el error del envío.

Crear `apps/portal/src/app/(portal)/operacion/registrar-venta/page.tsx`:

```tsx
import { PantallaRegistrarVenta } from "@/components/ventas/pantalla-registrar-venta";

// Server component delgado (mismo patron que /catalogo/clientes): solo lee el
// filtro de sucursal; en Next 15 `searchParams` es una promesa.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaRegistrarVenta sucursal={sucursal ?? null} />;
}
```

En `apps/portal/src/components/layout/nav-config.ts`, reemplazar:

```ts
      { label: "Dashboard", href: "/operacion" },
```

por:

```ts
      { label: "Dashboard", href: "/operacion" },
      { label: "Registrar venta", href: "/operacion/registrar-venta" },
```

- [ ] **Step 4: Correr las pruebas**

```bash
npm test --workspace=apps/portal
```

Expected: PASS (todas, incluidas las 10 nuevas de la pantalla y las de `lib/ventas`).

- [ ] **Step 5: Lint, tipos y commit**

```bash
npm run lint --workspace=apps/portal
npx tsc --noEmit -p apps/portal/tsconfig.json
git status --short
git add apps/portal/src/lib/ventas.ts apps/portal/src/lib/ventas.test.ts apps/portal/src/components/ventas/pantalla-registrar-venta.tsx apps/portal/src/components/ventas/pantalla-registrar-venta.test.tsx "apps/portal/src/app/(portal)/operacion/registrar-venta/page.tsx" apps/portal/src/components/layout/nav-config.ts
git commit -m "$(cat <<'EOF'
T-17: pantalla Registrar venta del portal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Verificación manual en el navegador, docs y vault (la corre el controlador)

**Files:**
- Modify: `CLAUDE.md` (sección "Folios (T-14)")
- Vault (`../jawa-obsidian-memory`, repo aparte): ADR nuevo, notas de dominio, `00-Inicio/Estado del proyecto.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: evidencia de la verificación manual para el PR; CLAUDE.md y vault al día.

- [ ] **Step 1: Suites completas**

```bash
npm run supabase -- test db
npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm test --workspace=apps/portal && npm run lint --workspace=apps/portal
npm run typecheck --workspace=apps/tablet && npm test --workspace=apps/tablet
```

Expected: todo en verde.

- [ ] **Step 2: Levantar backend y portal contra el Postgres LOCAL**

El puerto 3000 está ocupado en esta máquina, y `npm run backend` apunta a `sinmex dev` por defecto: se sobrescribe `DATABASE_URL` con la de `.env.test` (las variables del proceso ganan a las del archivo).

```bash
# Terminal 1 — backend en 3010 contra la base local
DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" PORT=3010 npm run backend
# Terminal 2 — portal (3001) apuntando a ese backend
NEXT_PUBLIC_API_URL=http://localhost:3010 npm run portal
```

Comprobar: `curl -s http://localhost:3010/health` responde OK.

Si hace falta un usuario del portal en la base local (también con la URL local, **nunca** contra la nube):

```bash
DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" npm run crear-usuario --workspace=apps/backend
```

(perfil `Administrador General`, sin sucursal.)

- [ ] **Step 3: Recorrido en `http://localhost:3001/operacion/registrar-venta`**

Preparar desde el propio portal, si la base local no lo tiene: un producto con dos presentaciones, precios de "Lista 1" en TJ para una de ellas, un cliente "Clientes Varios" en TJ con Lista 1, y un vendedor activo en TJ.

Anotar el resultado de cada punto para el PR:

1. La entrada "Registrar venta" aparece en Operación; la fecha propuesta es la de hoy en Tijuana.
2. Buscar el cliente escribiendo parte del nombre; al elegirlo cargan productos y repartidores ("Oficina" al final).
3. La presentación sin precio aparece deshabilitada con "sin precio en la lista"; el total se recalcula al teclear.
4. Venta de **Oficina** de contado: al grabar, folio `TJ<AAMMDD>OF01`, monto y "Pagada". "Registrar otra" limpia el formulario.
5. Otra venta a nombre del vendedor, a crédito, con fecha de la semana pasada: folio con la fecha de esa venta y `OF01` (contador propio de ese día).
6. Repetir el # de nota de la venta 4 (con mayúsculas/espacios distintos): sale "Ya existe la nota … en esta sucursal."
7. Comprobar en la base:

```bash
docker exec -i supabase_db_proyecto-sinmex psql -U postgres -c "select folio, num_nota, vendedor_id, origen, capturo_usuario_id, monto_total, status from venta_nota where origen = 'portal' order by created_at desc limit 5;"
docker exec -i supabase_db_proyecto-sinmex psql -U postgres -c "select ca.metodo_pago, ca.vendedor_id, ca.origen, ca.monto from cobranza_abono ca join venta_nota vn on vn.id = ca.venta_nota_id where vn.origen = 'portal' order by ca.created_at desc limit 5;"
```

Expected: la venta de Oficina con `vendedor_id` vacío y su cobro `transferencia` / `venta_contado`; las dos con `origen = portal` y `capturo_usuario_id` lleno.

8. Con un usuario de perfil vacío (p. ej. `Auxiliar Administrativo`): la pantalla carga pero no muestra "Grabar".

- [ ] **Step 4: CLAUDE.md**

En `CLAUDE.md`, sección **Folios (T-14)**, agregar al final de su lista de viñetas (después de la de "El segmento de vendedor (5º) lo asigna el SERVIDOR…"):

```markdown
- **Excepción: la venta del portal (T-17).** La oficina registra ventas desde el portal y su folio
  lo emite el **servidor** con el segmento reservado **`OF`** (`TJ261006OF01`), dentro de la
  transacción de la venta (`folio_oficina_contador`, `ventas-cobranza/folios-oficina.repository.ts`).
  Ningún vendedor puede tener `OF` (check en la base + rechazo en el alta). Además el **# de nota
  no se repite por sucursal** (`uq_venta_nota_num_nota_sucursal`, #95): el push lo rechaza con
  `num-nota-duplicada`, desempatando primero por clave como el folio.
```

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
T-17: CLAUDE.md anota el folio de oficina OF y el # de nota unico

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Vault (`../jawa-obsidian-memory`, según su `AGENTS.md`)**

- Crear el ADR del folio de oficina y la venta sin vendedor con el **siguiente número libre** en `30-Decisiones/` (hoy existe `ADR-0010 Equipos personales del vendedor y PIN de arranque`, así que es **ADR-0011**), enmendando ADR-0001/0007 y reconciliando ADR-0009 §2.2; enlazarlo desde `_MOC Decisiones.md`.
- Actualizar las notas de dominio de Venta-Nota y Folios (venta de Oficina sin vendedor, folio OF, # de nota único por sucursal) y `00-Inicio/Estado del proyecto.md` (T-17 parte 1 implementada en la rama).
- Commit y push del vault según su `AGENTS.md`. Nunca editar `90-Fuentes/`.

- [ ] **Step 6: Notas para el PR (no se ejecutan aquí)**

Incluir en la descripción del PR:
- Aviso a Mario: la regla del # de nota único también aplica a su tablet de prueba; ventas pendientes con # repetido se rechazarán con `num-nota-duplicada` y un motivo claro (§8).
- Para quien mergee y empuje a `sinmex dev` (Roberto, protocolo de CLAUDE.md): los dos pre-flight de solo lectura que están en la cabecera de la migración deben dar 0 **antes** del push; anotar `migration list` antes y después en el comentario del PR mergeado.

---

## Discrepancias y decisiones del plan

- **ADR-0010 ya existe en el vault** (Equipos personales del vendedor y PIN de arranque). El spec dice "se registra como ADR-0010"; el plan usa el siguiente número libre, **ADR-0011** (Task 8).
- **`ContextoCobranza` era un alias de `ContextoVenta`.** Para que la cobranza de la tablet no cambie al endurecer `ContextoVenta` (`folio: string`, `origen`, `metodoPagoContado`), pasa a ser una interfaz propia con la forma de antes (Task 4).
- **El folio llega no-null a `registrarVenta`** viajando en la proyección del push (`Proyeccion.venta.folio`), donde `prepararProyeccion` ya lo exige; así se quita el `throw` sin moverlo (Task 4).
- **Fixtures de la e2e del push:** con el índice nuevo, sus ventas con `num_nota: '2346'` repetido truenan; se cambian por `siguienteNota()` en la misma Task 1 que crea el índice, para que la suite no quede roja entre tareas.
- **Códigos HTTP que el spec no fija:** repartidor inválido/inactivo → **400**; cliente inexistente → 404; el tope de 99 → 409; iniciales `OF` en el alta → **409** (como unas iniciales tomadas).
- **Repartidores por `sucursalId`:** como `ClienteResumen` no trae el id de sucursal, la pantalla lo toma de `obtenerCliente(id)` antes de pedir `GET /ventas/repartidores?sucursalId=` (así se respeta la firma del spec).
- **Defaults de la pantalla que el spec no fija:** contado/crédito arranca en **contado** (la venta de mostrador es lo más común, §1); el total del portal es solo vista previa — el servidor recalcula.
- **`crear-vendedor` (script) también rechaza `OF`**, con el mismo motivo, para que no haya un camino que pegue contra el check de la base con un error crudo.

# T-38 · Jornada y kilometraje — backend + candados de la tablet — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDO: usa superpowers:subagent-driven-development (recomendado) o
> superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que el kilometraje del día que ya sube la tablet (`tipo: 'jornada'`) quede guardado en una
tabla `jornada` de Postgres, con rechazos específicos, y que en la tablet cerrar el día cierre de verdad las
operaciones y el contador de pendientes deje de contar la jornada abierta.

**Arquitectura:** una migración crea `jornada` (D1). El contrato gana cuatro códigos de rechazo y el tipo
`DatosJornada` (D3). La forma de `datos` se valida pura, antes de la transacción, en
`rutas/datos-jornada.ts` + `sincronizacion/despacho-jornada.ts` (mismo reparto que la cobranza); el vehículo y
el día repetido los decide `rutas/JornadasService.cerrarJornada` **dentro** de la transacción de la operación,
que devuelve `{ tabla: 'jornada', id }` para el buzón (D2, ADR-0009 enmienda §2.4). En la tablet,
`pendientesDeSincronizar()` filtra `estado = 'cerrada'` (D7), un candado `exigirJornadaAbierta` bloquea
`ventas`/`cobranzas`/`prospectos.registrar` con el día cerrado (D6 capa 3), y las pantallas confirman el
cierre y deshabilitan el menú (D6 capas 1 y 2).

**Stack:** NestJS 11 + Kysely 0.28 (backend), Postgres/Supabase local + pgTAP (base), Expo/React Native +
SQLite + Jest con ts-jest en Node (tablet, solo TypeScript; sin pruebas de pantalla).

**Spec:** `docs/superpowers/specs/2026-10-10-t-38-jornada-backend-design.md` — léelo antes de empezar. Sus
decisiones D1…D7 **no se renegocian**. Si este plan lo contradice, manda el spec: para y pregunta. Lo que el
planificador encontró en el código que choca con el spec está al final, en *Conflictos para el controlador*.

---

## Restricciones globales

Copiadas del spec (§ "Restricciones globales"), más las del roadmap (§4) y las de esta sesión:

- Rama `feature/t-38-jornada`. Todos los comandos **desde la raíz del worktree**
  (`/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-t38`), con los scripts del workspace.
- Código en español, **identificadores sin acentos**, **mensajes al usuario con acentos**. Comentarios que
  explican *por qué*. Respuestas de la API en camelCase. Baja lógica; `deleted_at` nunca sale.
- Contrato **solo aditivo**; `CONTRATO_ACTUAL` **no sube**. Tipos en los **dos** archivos de contrato a la vez
  (`apps/backend/src/modules/sincronizacion/contrato.ts` y `apps/tablet/src/sincronizacion/contrato.ts`) y en
  `docs/contrato-sincronizacion.md`, en el mismo commit.
- ADR-0009 (vault): **una transacción por operación**; una rechazada **no deja fila** (ni buzón ni negocio);
  código **específico**, nunca genérico; trazabilidad por `sync_operacion.entidad_tabla` / `entidad_id`
  (enmienda §2.4: **sin** columna `sync_operacion_id`).
- `fecha_operacion` la manda la tablet; **el servidor no la re-deriva de UTC**. `jornada.fecha` = esa fecha.
- Supabase local es **compartido entre sesiones**: `npm run supabase -- migration up --local` (siempre con
  `--`). **Nunca `db reset`.** pgTAP: `npm run supabase -- test db --local`. Tipos:
  `npm run db:types --workspace=apps/backend`, y comprobar que `schema.d.ts` cambia **solo** por la tabla nueva.
- **Nunca apuntar a `sinmex dev`** (la nube). `.env.test` va a `127.0.0.1:54322`. El push de la migración a la
  nube lo hace Roberto al mergear.
- **Los conteos de pruebas se miden contra la línea base al inicio de cada tarea; no se escriben aquí.**
- **Los implementadores no despachan subagentes, no empujan, no mergean** (ni `git push`, ni `gh pr`).
- Flakiness de e2e que ya existía antes de tu tarea: se reporta como `DONE_WITH_CONCERNS`, no se reintenta a
  ciegas ni se arregla dentro de otra tarea.
- Backend: `npm run lint --workspace=apps/backend` lleva `--fix` y reescribe archivos ajenos. **No lo uses.**
  Formatea solo tus archivos y revisa sin arreglar:
  `npm exec --workspace=apps/backend -- prettier --write <archivos relativos a apps/backend>` y
  `npm exec --workspace=apps/backend -- eslint <los mismos archivos>`.
- Cada commit termina con la línea `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Puntos de revisión (Review Focus)

Entradas que el spec no nombra y que un vendedor real va a producir. Cada una tiene su prueba en la tarea
dueña del código:

1. **Rechazada por vehículo y reenviada después de que el portal lo arregla** → la misma clave entra como
   `aplicada` (la rechazada no consumió su clave). Prueba: Tarea 4, e2e "vehículo de otra sucursal".
2. **Kilometraje que no cabe en `numeric(10,1)`** (> 999 999 999.9) → `jornada-datos-invalidos`, nunca un
   `22003` de Postgres que saldría como 500 para todo el lote. Prueba: Tarea 3, `datos-jornada.spec.ts`.
3. **Instante sin zona o con una fecha imposible** (`2026-10-10T08:00:00`, `2026-02-30T08:00:00Z`) →
   `jornada-datos-invalidos`; sin zona Postgres lo correría horas y con fecha imposible reventaría (500).
   Prueba: Tarea 3, `datos-jornada.spec.ts`.
4. **Vehículo desactivado (`activo = false`) a media jornada** → la jornada **entra** (el km se recorrió); solo
   `deleted_at` o otra sucursal es `vehiculo-inexistente`. Prueba: Tarea 4, e2e "vehículo desactivado".
5. **Una jornada cerrada de ayer, o de otro vendedor, no bloquea las operaciones de hoy** (el candado mira
   vendedor **y** fecha). Prueba: Tarea 6, `candado-jornada.spec.ts`.

Fuera del spec y **sin** manejar a propósito (se anotan, no se implementan): `cerrada_en < abierta_en` se
acepta (rechazarla perdería kilometraje real por un reloj de tablet movido); un `vehiculo_id` en mayúsculas se
acepta y se guarda en minúsculas (Tarea 3 lo prueba); los km con más de una decimal se redondean a una al
guardar (`numeric(10,1)`; el redondeo es monótono, así que nunca invierte `km_final >= km_inicial`).

## Línea base (la corre el implementador de la Tarea 1 ANTES de tocar nada)

Anota en tu reporte el resultado de cada comando (pasan / fallan, y cuántas pruebas). Las tareas siguientes
comparan contra esto. **No** los escribas en el plan.

```bash
git status                                   # debe salir limpio, rama feature/t-38-jornada
docker context ls                            # Docker Desktop, no Colima
npm run supabase -- status                   # el stack local tiene que estar arriba (NO lo reinicies)
npm run supabase -- migration up --local     # al día con la rama; nunca db reset
npm run supabase -- test db --local          # pgTAP
npm test --workspace=apps/backend            # unitarias backend
npm run build --workspace=apps/backend       # compila
npm run test:e2e --workspace=apps/backend    # e2e backend (usa la base local)
npm test --workspace=apps/tablet             # jest tablet (Node)
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
```

Si `migration up --local` se queja de migraciones en la base que no están en esta rama (otra sesión aplicó
las suyas), **no** uses `repair`, `--include-all` ni `db reset`: reporta `BLOCKED` con el mensaje exacto.

## Mapa de archivos

| Archivo | Tarea | Qué |
|---|---|---|
| `supabase/migrations/20261010120000_jornada.sql` | 1 | Crear: tabla `jornada` (D1) |
| `supabase/tests/99_jornada_test.sql` | 1 | Crear: pgTAP |
| `apps/backend/src/database/schema.d.ts` | 1 | Generado: `Jornada` + `DB.jornada` |
| `apps/backend/src/modules/sincronizacion/contrato.ts` | 2 | 4 códigos, `DatosJornada`, comentario de tipos |
| `apps/tablet/src/sincronizacion/contrato.ts` | 2 | 4 códigos, `DatosJornada` |
| `docs/contrato-sincronizacion.md` | 2 | §6 datos de la jornada, tabla de códigos, §7, §9 |
| `apps/backend/src/modules/rutas/datos-jornada.ts` (+ `.spec.ts`) | 3 | Crear: forma de `datos` (pura) |
| `apps/backend/src/modules/rutas/jornada-rechazada.ts` | 3 | Crear: `JornadaRechazada` |
| `apps/backend/src/modules/sincronizacion/despacho-jornada.ts` (+ `.spec.ts`) | 3 | Crear: `prepararJornada`, `CODIGO_POR_RAZON_JORNADA` |
| `apps/backend/src/modules/rutas/jornadas.repository.ts` | 4 | Crear: SQL de la jornada (todo con `trx`) |
| `apps/backend/src/modules/rutas/jornadas.service.ts` (+ `.spec.ts`) | 4 | Crear: `cerrarJornada` |
| `apps/backend/src/modules/rutas/rutas.module.ts` | 4 | Provee y exporta `JornadasService` |
| `apps/backend/src/modules/sincronizacion/sincronizacion.module.ts` | 4 | Importa `RutasModule` |
| `apps/backend/src/modules/sincronizacion/despacho.ts` (+ `despacho.spec.ts`) | 4 | `Proyeccion` + `case 'jornada'` |
| `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts` | 4 | `proyectar()` + `catch` |
| `apps/backend/test/sincronizacion.e2e-spec.ts` | 4 | Helper genérico → `gasto`, `jornadaValida()`, pruebas T-38, `afterAll` |
| `apps/tablet/src/datos/repositorios/jornadas.ts` | 5, 6 | D7 (filtro) y D6 capa 3 (`exigirJornadaAbierta`) |
| `apps/tablet/src/datos/repositorios/jornadas.spec.ts` | 5 | Ajustes por D7 |
| `apps/tablet/src/sincronizacion/pendientes.spec.ts` | 5 | Ajuste + prueba D7 |
| `apps/tablet/src/sincronizacion/motor.spec.ts` | 5 | Una aserción que era el bug E3 |
| `apps/tablet/src/sincronizacion/fuente-jornadas.ts` | 5 | Solo comentario |
| `apps/tablet/src/datos/repositorios/{ventas,cobranzas,prospectos}.ts` | 6 | Llaman al candado |
| `apps/tablet/src/datos/repositorios/candado-jornada.spec.ts` | 6 | Crear: pruebas del candado |
| `apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx`, `cobranza.tsx`, `app/(jornada)/prospectos.tsx` | 6 | Muestran el mensaje de `ErrorJornada` |
| `apps/tablet/src/estado/menu-jornada.ts` (+ `.spec.ts`) | 7 | Crear: estado del menú y textos (puro) |
| `apps/tablet/src/ui/boton-menu.tsx` | 7 | Prop `deshabilitado` |
| `apps/tablet/app/(jornada)/index.tsx` | 7 | Menú con día cerrado |
| `apps/tablet/app/(jornada)/cerrar-dia.tsx` | 7 | Confirmación antes de cerrar |
| `apps/tablet/README.md`, `CLAUDE.md` | 8 | Documentación de cierre |

### Orden y modelos (roadmap §3.1)

| Tarea | Qué | Implementador | Revisor |
|---|---|---|---|
| 1 | Migración `jornada` + pgTAP + tipos | `haiku` | `sonnet` |
| 2 | Códigos de rechazo y `DatosJornada` en los dos contratos + docs | `haiku` | `sonnet` |
| 3 | Forma pura de la jornada (`datos-jornada`, `despacho-jornada`, `JornadaRechazada`) | `haiku` | `sonnet` |
| 4 | Proyección: repositorio, servicio, cableado en `push`, e2e | `sonnet` | **`opus`** |
| 5 | Tablet D7: el contador cuenta solo lo que viaja | `haiku` | `sonnet` |
| 6 | Tablet D6 capa 3: candado en los tres `registrar` | `sonnet` | `sonnet` |
| 7 | Tablet D6 capas 1 y 2: confirmación y menú | `sonnet` | `sonnet` |
| 8 | Cierre: documentación y verificación completa | `sonnet` | controlador |

**Por qué el orden difiere del brief (T1…T7 → 1…8):** la "T3" del brief se partió en dos. `despacho.ts`
declara el `Proyeccion` que `sincronizacion.service.ts#proyectar()` recorre con un `switch` exhaustivo de tipo
de retorno `Promise<EntidadProyectada>`: si se agrega `jornada` a la unión sin el `case` correspondiente, el
backend **no compila**. Por eso la Tarea 3 crea solo archivos nuevos y puros (transcripción, `haiku`) y la
Tarea 4 hace todo el cableado de una vez (el riesgo de transacción, revisor `opus`). Tarea 5 = T4 del brief,
6 = T5, 7 = T6, 8 = T7.

---

### Tarea 1: Migración `jornada`, pruebas de la base y tipos

**Implementador:** `haiku` · **Revisor:** `sonnet`

**Archivos:**
- Crear: `supabase/migrations/20261010120000_jornada.sql`
- Crear: `supabase/tests/99_jornada_test.sql`
- Modificar (generado): `apps/backend/src/database/schema.d.ts`

**Interfaces:**
- Consume: nada.
- Produce:
  - Tabla `jornada` con `id`, `created_at`, `updated_at`, `deleted_at`, `vendedor_id → vendedor`,
    `vehiculo_id → vehiculo`, `sucursal_id → sucursal`, `fecha date`, `km_inicial numeric(10,1)`,
    `km_final numeric(10,1)`, `abierta_en timestamptz`, `cerrada_en timestamptz` (todas `not null` salvo
    `deleted_at`).
  - Restricciones `ck_jornada_km_inicial` (`>= 0`), `ck_jornada_km_final` (`>= km_inicial`), índice único
    parcial `uq_jornada_vendedor_fecha (vendedor_id, fecha) where deleted_at is null`, índice
    `idx_jornada_sucursal_fecha (sucursal_id, fecha) where deleted_at is null`, trigger `trg_jornada_updated`.
  - En `schema.d.ts`: `interface Jornada` y `DB.jornada` (la Tarea 4 los usa con Kysely).

**Qué se copia y de dónde** (el spec pide "el mismo patrón que `cobranza_abono` / `venta_nota`"):
- Columnas de auditoría `id uuid primary key default gen_random_uuid()`, `created_at`/`updated_at
  timestamptz not null default now()`, `deleted_at timestamptz`: de `create table saldo_favor_movimiento` en
  `20260914160000_cobranza_saldo_favor.sql` (y de `venta_nota` en `20260803163400_transaccional.sql`).
- Trigger `create trigger trg_<tabla>_updated before update on <tabla> for each row execute function
  set_updated_at();`: de `trg_saldo_favor_movimiento_updated` (misma migración).
- Checks con nombre `ck_<tabla>_<regla>`: de `ck_saldo_favor_signo` / `ck_cobranza_abono_saldo_favor` en
  `20261007160000_cobranza_portal.sql`.
- Índices parciales `where deleted_at is null`: de `idx_saldo_favor_cliente` y `idx_cobranza_abono_nota`.
- **Grants y RLS: ninguna migración del repo los tiene** (`grep -i "row level security\|grant \|policy"
  supabase/migrations/*.sql` no devuelve nada; el backend entra con su propia conexión y `config.toml` deja la
  Data API sin exponer tablas nuevas). Copiar el patrón es **no** agregarlos. Ver *Conflictos*, punto 1.
- Prueba pgTAP: estructura de `supabase/tests/99_cobranza_portal_test.sql` (`begin; select plan(n);`, datos con
  prefijo `zz-pgtap-…`, tabla temporal `on commit drop`, `throws_ok(…, '23514', null, …)`, `finish();
  rollback;`) y las llamadas `col_type_is`/`col_not_null`/`has_index`/`has_trigger` de
  `91_sincronizacion_test.sql`.

- [ ] **Paso 1: Prueba pgTAP (falla)**

Crear `supabase/tests/99_jornada_test.sql`:

```sql
begin;
select plan(18);

-- T-38: la jornada cerrada que sube la tablet. Lo que la BASE garantiza aunque
-- alguien escriba por debajo del servicio. Prefijo `zz-pgtap-t38`.

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-t38', 'Vendedor pgTAP T-38', 'x', id
    from sucursal where codigo = 'TJ';
insert into vehiculo (nombre, sucursal_id, km_inicial)
  select 'ZZ-pgtap-T38 Camioneta', id, 1000
    from sucursal where codigo = 'TJ';

create temporary table _t38 on commit drop as
select
  (select id from vendedor where login = 'zz-pgtap-t38') as vendedor,
  (select id from vehiculo where nombre = 'ZZ-pgtap-T38 Camioneta') as vehiculo,
  (select id from sucursal where codigo = 'TJ') as sucursal;

select has_table('jornada');
select hasnt_column('jornada', 'sync_operacion_id',
  'sin sync_operacion_id: la trazabilidad va por entidad_tabla/entidad_id (ADR-0009 §2.4)');
select fk_ok('jornada', 'vendedor_id', 'vendedor', 'id',
  'la jornada es de un vendedor');
select fk_ok('jornada', 'vehiculo_id', 'vehiculo', 'id',
  'con el vehiculo que eligio al abrir el dia');
select fk_ok('jornada', 'sucursal_id', 'sucursal', 'id',
  'en la sucursal del vendedor (la usa el reporte de Kilometraje)');
select col_type_is('jornada', 'km_inicial', 'numeric(10,1)',
  'el odometro marca decimas');
select col_type_is('jornada', 'km_final', 'numeric(10,1)',
  'el km final tambien');
select col_not_null('jornada', 'km_final',
  'solo jornadas CERRADAS: el km final es obligatorio');
select col_not_null('jornada', 'cerrada_en',
  'solo jornadas CERRADAS: el cierre es obligatorio');
select has_trigger('jornada', 'trg_jornada_updated');
select has_index('jornada', 'uq_jornada_vendedor_fecha',
  'una jornada viva por vendedor y dia, espejo del SQLite de la tablet');
select has_index('jornada', 'idx_jornada_sucursal_fecha',
  'el reporte de Kilometraje busca por sucursal y rango de fechas');

select lives_ok(
  $$insert into jornada (vendedor_id, vehiculo_id, sucursal_id, fecha,
                         km_inicial, km_final, abierta_en, cerrada_en)
    select vendedor, vehiculo, sucursal, '2026-10-10', 128450, 128512,
           '2026-10-10T08:03:53-07:00', '2026-10-10T18:19:55-07:00'
      from _t38$$,
  'una jornada cerrada entra'
);

select throws_ok(
  $$insert into jornada (vendedor_id, vehiculo_id, sucursal_id, fecha,
                         km_inicial, km_final, abierta_en, cerrada_en)
    select vendedor, vehiculo, sucursal, '2026-10-10', 128600, 128700,
           '2026-10-10T08:00:00-07:00', '2026-10-10T18:00:00-07:00'
      from _t38$$,
  '23505', null,
  'una segunda jornada viva del mismo vendedor el mismo dia no entra'
);

select throws_ok(
  $$insert into jornada (vendedor_id, vehiculo_id, sucursal_id, fecha,
                         km_inicial, km_final, abierta_en, cerrada_en)
    select vendedor, vehiculo, sucursal, '2026-10-11', 128512, 128500,
           '2026-10-11T08:00:00-07:00', '2026-10-11T18:00:00-07:00'
      from _t38$$,
  '23514', null,
  'el odometro no retrocede: km_final menor a km_inicial no entra'
);

select throws_ok(
  $$insert into jornada (vendedor_id, vehiculo_id, sucursal_id, fecha,
                         km_inicial, km_final, abierta_en, cerrada_en)
    select vendedor, vehiculo, sucursal, '2026-10-12', -1, 0,
           '2026-10-12T08:00:00-07:00', '2026-10-12T18:00:00-07:00'
      from _t38$$,
  '23514', null,
  'un km inicial negativo no entra'
);

-- Baja logica de la primera: el indice es parcial, asi que el dia se libera.
update jornada set deleted_at = now()
 where vendedor_id = (select vendedor from _t38) and fecha = '2026-10-10';

select lives_ok(
  $$insert into jornada (vendedor_id, vehiculo_id, sucursal_id, fecha,
                         km_inicial, km_final, abierta_en, cerrada_en)
    select vendedor, vehiculo, sucursal, '2026-10-10', 128450, 128512,
           '2026-10-10T08:03:53-07:00', '2026-10-10T18:19:55-07:00'
      from _t38$$,
  'dar de baja una jornada libera su dia'
);

select lives_ok(
  $$insert into jornada (vendedor_id, vehiculo_id, sucursal_id, fecha,
                         km_inicial, km_final, abierta_en, cerrada_en)
    select vendedor, vehiculo, sucursal, '2026-10-11', 128512, 128512,
           '2026-10-11T08:00:00-07:00', '2026-10-11T18:00:00-07:00'
      from _t38$$,
  'un dia sin moverse: km final igual al inicial entra'
);

select * from finish();
rollback;
```

- [ ] **Paso 2: Correr pgTAP y ver que falla**

Run: `npm run supabase -- test db --local`
Expected: `99_jornada_test.sql` falla (`relation "jornada" does not exist`); los demás archivos siguen como en la
línea base.

- [ ] **Paso 3: La migración**

Crear `supabase/migrations/20261010120000_jornada.sql`:

```sql
-- T-38: la jornada del vendedor en Postgres (vehiculo + kilometraje del dia).
--
-- Hasta aqui la tablet subia la jornada cerrada como operacion `tipo: 'jornada'`
-- y el servidor la dejaba en `sync_operacion` sin proyectarla: el kilometraje
-- llegaba y nadie lo guardaba. Esta tabla es su proyeccion (ADR-0009): la
-- escribe `rutas/JornadasService.cerrarJornada` dentro de la transaccion de la
-- operacion. Ver docs/superpowers/specs/2026-10-10-t-38-jornada-backend-design.md (D1).
--
-- Solo jornadas CERRADAS: el buzon es de solo escritura hasta T-43 y la tablet
-- no sube las abiertas. Por eso km_final y cerrada_en son obligatorios.
--
-- Sin `sync_operacion_id`: la trazabilidad va por sync_operacion.entidad_tabla /
-- entidad_id (ADR-0009, enmienda §2.4).
--
-- Sin grants ni RLS: ninguna tabla de este esquema los tiene (el backend entra
-- con su propia conexion y la Data API no expone tablas nuevas). Se copia lo que
-- si es patron: columnas de auditoria, trigger set_updated_at, checks con nombre
-- e indices parciales por `deleted_at is null`.

create table jornada (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  vendedor_id  uuid not null references vendedor(id),
  vehiculo_id  uuid not null references vehiculo(id),
  sucursal_id  uuid not null references sucursal(id),
  -- El dia de trabajo tal cual lo mando la tablet (`fecha_operacion`). El
  -- servidor no lo re-deriva de UTC: a las 18:00 de Tijuana en UTC ya es manana.
  fecha        date not null,
  -- numeric(10,1): el odometro marca decimas; caben hasta 999,999,999.9 km.
  km_inicial   numeric(10,1) not null,
  km_final     numeric(10,1) not null,
  abierta_en   timestamptz not null,
  cerrada_en   timestamptz not null,
  constraint ck_jornada_km_inicial check (km_inicial >= 0),
  -- El odometro no retrocede. Defensa en profundidad: el push ya lo rechaza
  -- como `jornada-km-invalido` antes de abrir la transaccion.
  constraint ck_jornada_km_final check (km_final >= km_inicial)
);
create trigger trg_jornada_updated before update on jornada
  for each row execute function set_updated_at();

-- Una jornada viva por vendedor y dia: espejo del `unique (vendedor_id, fecha)`
-- del SQLite de la tablet. Parcial, como el resto del esquema: dar de baja una
-- jornada libera el dia. `JornadasService` lo usa con `on conflict ... do nothing`
-- para responder `jornada-duplicada` sin abortar la transaccion.
create unique index uq_jornada_vendedor_fecha
  on jornada (vendedor_id, fecha) where deleted_at is null;

-- El reporte de Kilometraje del portal busca por sucursal y rango de fechas (D5).
create index idx_jornada_sucursal_fecha
  on jornada (sucursal_id, fecha) where deleted_at is null;
```

- [ ] **Paso 4: Aplicar y correr pgTAP**

Run:
```bash
npm run supabase -- migration up --local
npm run supabase -- test db --local
```
Expected: la migración se aplica; `All tests successful` (o, si la línea base ya tenía fallos ajenos, los mismos
fallos y `99_jornada_test.sql` en verde con sus 18 pruebas).

- [ ] **Paso 5: Regenerar tipos y comprobar el diff**

Run:
```bash
npm run db:types --workspace=apps/backend
git diff --stat apps/backend/src/database/schema.d.ts
git diff apps/backend/src/database/schema.d.ts
```
Expected: el único cambio es esta interfaz (entre `FolioOficinaContador` y `ListaPrecio`) y la línea
`jornada: Jornada;` en `interface DB` (entre `folio_oficina_contador` y `lista_precio`):

```ts
export interface Jornada {
  abierta_en: Timestamp;
  cerrada_en: Timestamp;
  created_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
  fecha: Timestamp;
  id: Generated<string>;
  km_final: Numeric;
  km_inicial: Numeric;
  sucursal_id: string;
  updated_at: Generated<Timestamp>;
  vehiculo_id: string;
  vendedor_id: string;
}
```

Si el diff trae **otras** tablas o columnas (la base local es compartida y otra sesión pudo aplicar migraciones
de su rama): `git checkout apps/backend/src/database/schema.d.ts` y pega **a mano** solo el bloque de arriba y
la línea `jornada: Jornada;` en esos dos lugares. Anota en tu reporte que pasó.

- [ ] **Paso 6: Compila**

Run: `npm run build --workspace=apps/backend`
Expected: compila (nadie usa todavía `jornada`).

- [ ] **Paso 7: Commit**

```bash
git add supabase/migrations/20261010120000_jornada.sql supabase/tests/99_jornada_test.sql \
  apps/backend/src/database/schema.d.ts
git commit -m "T-38: migracion — tabla jornada (vendedor, vehiculo, fecha, km inicial/final)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 2: Códigos de rechazo y `DatosJornada` en los dos contratos y en `docs/`

**Implementador:** `haiku` · **Revisor:** `sonnet`

**Archivos:**
- Modificar: `apps/backend/src/modules/sincronizacion/contrato.ts`
- Modificar: `apps/tablet/src/sincronizacion/contrato.ts`
- Modificar: `docs/contrato-sincronizacion.md`

**Interfaces:**
- Consume: nada.
- Produce (en **los dos** contratos):
  - `CODIGOS_RECHAZO` gana, al final y en este orden: `'jornada-datos-invalidos'`, `'jornada-km-invalido'`,
    `'vehiculo-inexistente'`, `'jornada-duplicada'`. `CodigoRechazo` los incluye solo.
  - `export type DatosJornada = { vehiculo_id: string; km_inicial: number; km_final: number; abierta_en:
    string; cerrada_en: string }`.
  - `CONTRATO_ACTUAL` **sigue en 1**.

**Lo que el planificador comprobó en la tablet:** no hay un mapa de códigos a mensajes. `motor.ts:363` guarda el
rechazo tal cual en la fila (`fuente.marcarError(r.clave, \`${r.codigo ?? 'rechazada'}: ${r.motivo ?? ''}\`)`)
y `ResultadoOperacion.codigo` es `string` a propósito. Agregar los códigos al arreglo basta; no hay pantalla
que tocar.

- [ ] **Paso 1: Backend — comentario de `TIPOS_OPERACION`**

En `apps/backend/src/modules/sincronizacion/contrato.ts`, reemplazar:

```ts
 * TODO: T-XX — la jornada (vehiculo + kilometraje inicial/final) no tiene tabla
 *       propia en Postgres todavia; hoy solo se recibe y se guarda.
```

por:

```ts
 * Hecho: T-38 — `jornada` (vehiculo + kilometraje inicial/final del dia ya
 *        cerrado, ver {@link DatosJornada}); se proyecta a la tabla `jornada`.
```

- [ ] **Paso 2: Backend — los cuatro códigos**

En el mismo archivo, reemplazar el final de `CODIGOS_RECHAZO`:

```ts
  'nota-no-encontrada',
] as const;
```

por:

```ts
  'nota-no-encontrada',
  /**
   * `datos` de una jornada no tiene la forma de {@link DatosJornada}: falta un
   * campo, un km no es un numero entre 0 y 999 999 999.9, o un instante no es
   * ISO-8601 con zona. T-38. Es un bug de la tablet; el `motivo` nombra el campo.
   * Se rechaza antes de abrir la transaccion.
   */
  'jornada-datos-invalidos',
  /**
   * `km_final` es menor que `km_inicial`: el odometro no retrocede. T-38. La
   * tablet ya lo impide al cerrar el dia; si llega aqui, el dato se corrompio.
   */
  'jornada-km-invalido',
  /**
   * El vehiculo de la jornada no existe, esta dado de baja (`deleted_at`) o es
   * de otra sucursal que la del vendedor del token. T-38. Uno **desactivado**
   * (`activo = false`) si entra: el kilometraje se recorrio igual.
   *
   * No es un bug de la tablet: su catalogo pudo quedarse viejo. Se reintenta en
   * la siguiente sincronizacion, como `presentacion-inactiva`.
   */
  'vehiculo-inexistente',
  /**
   * Ya hay una jornada viva de ese vendedor en esa fecha, subida con **otra**
   * clave de idempotencia (otra tablet, o una fila local rehecha). T-38. Un
   * reenvio con la MISMA clave no cae aqui: el buzon lo resuelve antes como
   * `duplicada`.
   */
  'jornada-duplicada',
] as const;
```

- [ ] **Paso 3: Backend — `DatosJornada`**

En el mismo archivo, inmediatamente después del cierre del tipo `DatosCobranza`, es decir después de:

```ts
  /** `AAAA-MM-DD`, no posterior a `fecha_operacion`. Informativa: el corte cuenta por `fecha_operacion`. */
  fecha_pago: string;
};
```

agregar:

```ts

/**
 * `datos` de una operacion `tipo: "jornada"` (T-38): el dia ya CERRADO.
 *
 * Es el sobre que la tablet ya mandaba desde T-07 (`fuente-jornadas.ts`); T-38
 * solo lo fija y lo proyecta a la tabla `jornada`. La tablet solo sube jornadas
 * cerradas (el buzon es de solo escritura hasta T-43), asi que los cinco campos
 * van siempre. El sobre no lleva `folio` (no es una nota que nadie firme) ni
 * `cliente_id`. Cualquier otro campo dentro de `datos` se ignora.
 *
 * Es `type` y no `interface` por la misma razon que {@link DatosVenta}.
 */
export type DatosJornada = {
  /** uuid del vehiculo que eligio al abrir el dia; de la sucursal del vendedor. */
  vehiculo_id: string;
  /** Numero finito entre 0 y 999 999 999.9. Se guarda con una decima. */
  km_inicial: number;
  /** Igual que `km_inicial`, y no menor que el: el odometro no retrocede. */
  km_final: number;
  /** Instante ISO-8601 **con zona** en que abrio el dia. */
  abierta_en: string;
  /** Instante ISO-8601 **con zona** en que lo cerro. */
  cerrada_en: string;
};
```

- [ ] **Paso 4: Tablet — los cuatro códigos**

En `apps/tablet/src/sincronizacion/contrato.ts`, reemplazar:

```ts
  'nota-no-encontrada',
] as const;
```

por:

```ts
  'nota-no-encontrada',
  /** T-38: `datos` de la jornada no tiene la forma de {@link DatosJornada}. Bug de la tablet. */
  'jornada-datos-invalidos',
  /** T-38: `km_final` menor que `km_inicial`. */
  'jornada-km-invalido',
  /**
   * T-38: el vehiculo no existe en el servidor, esta dado de baja o es de otra
   * sucursal. Se reenvia en cada sincronizacion: el portal puede corregirlo.
   */
  'vehiculo-inexistente',
  /**
   * T-38: el servidor ya tiene una jornada de este vendedor ese dia, con otra
   * clave. Se queda en `error` con el motivo; no se resuelve sola.
   */
  'jornada-duplicada',
] as const;
```

- [ ] **Paso 5: Tablet — `DatosJornada`**

En el mismo archivo, inmediatamente después del cierre del tipo `DatosCobranza`, es decir después de:

```ts
  /** `AAAA-MM-DD`, no posterior a `fecha_operacion`. */
  fecha_pago: string;
};
```

agregar:

```ts

/**
 * `datos` de una operacion `tipo: "jornada"` (T-38): el dia ya cerrado. Copia
 * del tipo del backend. Solo se suben jornadas cerradas, asi que van los cinco.
 */
export type DatosJornada = {
  vehiculo_id: string;
  km_inicial: number;
  km_final: number;
  /** ISO-8601 con zona. */
  abierta_en: string;
  /** ISO-8601 con zona. */
  cerrada_en: string;
};
```

- [ ] **Paso 6: `docs/contrato-sincronizacion.md`**

6a. En el ejemplo de la petición del §6, reemplazar la línea:

```jsonc
      "datos": { "km_inicial": 120345, "km_final": 120589 }
```

por:

```jsonc
      "datos": { "vehiculo_id": "uuid", "km_inicial": 120345, "km_final": 120589,
                 "abierta_en": "2026-08-07T07:58:10.000-07:00",
                 "cerrada_en": "2026-08-07T18:40:02.000-07:00" }
```

6b. Reemplazar el párrafo:

```markdown
`datos` lo fija el ticket de cada módulo, y fijarlo es un cambio **aditivo** que
no sube la versión del contrato. Hoy tienen forma fija **`venta`** (T-16),
**`prospecto`** (T-40) y **`cobranza`** (T-20), los tres abajo; gastos, merma y
ruta siguen libres hasta T-27/T-33/T-39, y el servidor las guarda tal cual.
```

por:

```markdown
`datos` lo fija el ticket de cada módulo, y fijarlo es un cambio **aditivo** que
no sube la versión del contrato. Hoy tienen forma fija **`venta`** (T-16),
**`prospecto`** (T-40), **`cobranza`** (T-20) y **`jornada`** (T-38), los cuatro
abajo; gastos, merma y ruta siguen libres hasta T-27/T-33/T-39, y el servidor las
guarda tal cual.
```

6c. Inmediatamente **antes** de la línea `### Respuesta \`200\` — parcial y honesta`, insertar:

````markdown
### `datos` de una jornada (T-38)

```jsonc
{
  "clave": "uuid de la jornada local",
  "tipo": "jornada",
  "fecha_operacion": "2026-10-10",   // el día de la jornada en la tablet; se guarda tal cual
  "ocurrido_en": "2026-10-10T18:19:55.706Z",   // = cerrada_en
  // SIN "cliente_id" ni "folio": no se refiere a un cliente ni es una nota que nadie firme.
  "datos": {
    "vehiculo_id": "uuid",           // de la sucursal del vendedor, no dado de baja
    "km_inicial": 128450,            // número finito, 0..999999999.9
    "km_final": 128512,              // igual, y no menor que km_inicial
    "abierta_en": "2026-10-10T18:03:53.458Z",    // ISO-8601 CON zona
    "cerrada_en": "2026-10-10T18:19:55.706Z"     // ISO-8601 CON zona
  }
}
```

- Solo viajan jornadas **cerradas** (el buzón es de solo escritura hasta T-43, §7). Cualquier otro campo
  dentro de `datos` se ignora.
- La forma se valida **antes** de abrir la transacción: un campo que falta o con el tipo equivocado es
  `jornada-datos-invalidos` (el `motivo` nombra el campo); `km_final < km_inicial` es `jornada-km-invalido`.
- Dentro de la transacción: un vehículo que no existe, está dado de baja o es de otra sucursal es
  `vehiculo-inexistente` (uno **desactivado** sí entra: el kilometraje se recorrió); una segunda jornada viva
  del mismo vendedor en la misma `fecha_operacion` con **otra** clave es `jornada-duplicada`. La misma clave
  reenviada es `duplicada`, como cualquier operación.
- Se guarda en la tabla `jornada` (`fecha` = `fecha_operacion`, km con una décima) y el buzón apunta a esa fila
  (`entidad_tabla = 'jornada'`).
- Las jornadas que ya estaban en el buzón antes de T-38 **no** se reprocesan (sin backfill).

````

6d. En la tabla de "Códigos de rechazo", después de la fila de `nota-no-encontrada`, agregar:

```markdown
| `jornada-datos-invalidos` | `datos` de una jornada no tiene la forma del §6 (falta un campo, un km fuera de 0..999999999.9, un instante sin zona). El `motivo` nombra el campo. Bug de la tablet (T-38) |
| `jornada-km-invalido` | `km_final` menor que `km_inicial`: el odómetro no retrocede (T-38) |
| `vehiculo-inexistente` | El vehículo de la jornada no existe, está dado de baja o es de otra sucursal que la del vendedor. Uno desactivado sí entra. Se reintenta en la siguiente sincronización (T-38) |
| `jornada-duplicada` | Ya hay una jornada viva de ese vendedor en esa fecha subida con **otra** clave. La misma clave es `duplicada`, no esto (T-38) |
```

6e. En §7 "Una transacción por operación", reemplazar:

```markdown
Cuando un `tipo` tiene un módulo de dominio que lo proyecta (hoy `venta` y
`cobranza`), cada operación del lote se aplica **en su propia transacción**:
```

por:

```markdown
Cuando un `tipo` tiene un módulo de dominio que lo proyecta (hoy `venta`,
`cobranza`, `prospecto` y `jornada`), cada operación del lote se aplica **en su
propia transacción**:
```

6f. En la lista del punto 2 de esa misma sección, después del guion de `CobranzasService.registrarCobranza`
(el que termina en "es la primera fila `cobranza_abono` o, si todo quedó a favor, el movimiento."), agregar:

```markdown
   - `JornadasService.cerrarJornada` (T-38) → comprueba que el vehículo sea de la sucursal del vendedor y no
     esté dado de baja, e inserta en `jornada` con `on conflict (vendedor_id, fecha) where deleted_at is null
     do nothing`; si no insertó, `jornada-duplicada`. La entidad es la fila de `jornada`.
```

6g. Reemplazar:

```markdown
3. `commit` → `aplicada`. Si el dominio rechaza (`presentacion-inactiva`,
   `precio-no-asignado`, `nota-no-encontrada`), `rollback`: no queda **ni** la fila de negocio
   **ni** la del buzón.

Los tipos sin módulo todavía (`jornada`, `gasto`, `merma`, `ruta`) se
guardan en el buzón y quedan `aplicada` con `entidad_id` nulo, como hasta ahora.
```

por:

```markdown
3. `commit` → `aplicada`. Si el dominio rechaza (`presentacion-inactiva`,
   `precio-no-asignado`, `nota-no-encontrada`, `vehiculo-inexistente`, `jornada-duplicada`),
   `rollback`: no queda **ni** la fila de negocio **ni** la del buzón.

Los tipos sin módulo todavía (`gasto`, `merma`, `ruta`) se guardan en el buzón y
quedan `aplicada` con `entidad_id` nulo, como hasta ahora.
```

6h. En la tabla del §9, reemplazar las dos filas:

```markdown
| Forma de `datos` para gasto / merma / ruta (las de venta y cobranza ya están, §6) | **T-27 / T-33 / T-39** |
| Proyección de `gasto`, `merma`, `ruta` y `jornada` a sus tablas de negocio (las de `venta` y `cobranza` ya existen, §7) | Los mismos, y **T-38** para `jornada` |
```

por:

```markdown
| Forma de `datos` para gasto / merma / ruta (las de venta, cobranza y jornada ya están, §6) | **T-27 / T-33 / T-39** |
| Proyección de `gasto`, `merma` y `ruta` a sus tablas de negocio (las de `venta`, `cobranza` y `jornada` ya existen, §7) | Los mismos |
| Reporte de Kilometraje del portal (lee `jornada`) y reproceso de las jornadas que llegaron antes de T-38 | Portal (siguiente paso de T-38) |
```

- [ ] **Paso 7: Las dos listas de códigos son idénticas**

Run:
```bash
diff <(sed -n '/export const CODIGOS_RECHAZO/,/\] as const/p' apps/backend/src/modules/sincronizacion/contrato.ts | grep -oE "^  '[a-z-]+'") \
     <(sed -n '/export const CODIGOS_RECHAZO/,/\] as const/p' apps/tablet/src/sincronizacion/contrato.ts | grep -oE "^  '[a-z-]+'")
grep -n "CONTRATO_ACTUAL = " apps/backend/src/modules/sincronizacion/contrato.ts apps/tablet/src/sincronizacion/contrato.ts
```
Expected: `diff` sin salida; las dos líneas dicen `CONTRATO_ACTUAL = 1`.

- [ ] **Paso 8: Compila y nada se rompe**

Run:
```bash
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run typecheck --workspace=apps/tablet
npm test --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm exec --workspace=apps/backend -- prettier --check src/modules/sincronizacion/contrato.ts
```
Expected: todo como en la línea base (solo cambiaron tipos y comentarios).

- [ ] **Paso 9: Commit**

```bash
git add apps/backend/src/modules/sincronizacion/contrato.ts apps/tablet/src/sincronizacion/contrato.ts \
  docs/contrato-sincronizacion.md
git commit -m "T-38: contrato — codigos de rechazo de la jornada y forma de sus datos

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 3: La forma de la jornada, pura (`datos-jornada`, `despacho-jornada`, `JornadaRechazada`)

**Implementador:** `haiku` · **Revisor:** `sonnet`

**Archivos:**
- Crear: `apps/backend/src/modules/rutas/datos-jornada.ts`
- Crear: `apps/backend/src/modules/rutas/datos-jornada.spec.ts`
- Crear: `apps/backend/src/modules/rutas/jornada-rechazada.ts`
- Crear: `apps/backend/src/modules/sincronizacion/despacho-jornada.ts`
- Crear: `apps/backend/src/modules/sincronizacion/despacho-jornada.spec.ts`

**Interfaces:**
- Consume (Tarea 2): `CodigoRechazo` incluye `'jornada-datos-invalidos' | 'jornada-km-invalido' |
  'vehiculo-inexistente' | 'jornada-duplicada'`. `OperacionNormalizada` y `Rechazo` de
  `sincronizacion/operaciones.ts` (ya existen).
- Produce (los usa la Tarea 4):
  - `rutas/datos-jornada.ts`: `KM_MAXIMO = 999_999_999.9`; `interface JornadaNormalizada { vehiculoId: string;
    kmInicial: number; kmFinal: number; abiertaEn: string; cerradaEn: string }`;
    `normalizarDatosJornada(datos: Record<string, unknown>): ResultadoDatosJornada`.
  - `rutas/jornada-rechazada.ts`: `type RazonRechazoJornada = 'vehiculo-inexistente' | 'jornada-duplicada'`;
    `class JornadaRechazada extends Error { readonly razon: RazonRechazoJornada }` con constructor
    `({ razon, motivo }: RechazoJornada)`.
  - `sincronizacion/despacho-jornada.ts`: `prepararJornada(op: OperacionNormalizada): PreparacionJornada`
    (`{ ok: true; jornada: JornadaNormalizada } | ({ ok: false } & Rechazo)`) y
    `CODIGO_POR_RAZON_JORNADA: Record<RazonRechazoJornada, CodigoRechazo>`.

Mismo reparto que la cobranza: la regla de forma vive en el módulo dueño (`ventas-cobranza/datos-cobranza.ts`
↔ `rutas/datos-jornada.ts`), el traductor al contrato en `sincronizacion/` (`despacho-cobranza.ts` ↔
`despacho-jornada.ts`), y el error de dominio no importa nada del contrato (`cobranza-rechazada.ts` ↔
`jornada-rechazada.ts`). Nada de esto toca la base ni está cableado todavía: eso es la Tarea 4.

- [ ] **Paso 1: Prueba de la forma (falla)**

Crear `apps/backend/src/modules/rutas/datos-jornada.spec.ts`:

```ts
import { KM_MAXIMO, normalizarDatosJornada } from './datos-jornada';

const VEHICULO = '106c93f1-0c9a-4efc-b167-8c73eea9b023';

/** El sobre que manda hoy la tablet (`fuente-jornadas.ts`), con lo que se quiera cambiar encima. */
const datos = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  vehiculo_id: VEHICULO,
  km_inicial: 128450,
  km_final: 128512,
  abierta_en: '2026-10-10T18:03:53.458Z',
  cerrada_en: '2026-10-10T18:19:55.706Z',
  ...extra,
});

describe('normalizarDatosJornada (T-38)', () => {
  it('una jornada cerrada valida se normaliza', () => {
    expect(normalizarDatosJornada(datos())).toEqual({
      ok: true,
      jornada: {
        vehiculoId: VEHICULO,
        kmInicial: 128450,
        kmFinal: 128512,
        abiertaEn: '2026-10-10T18:03:53.458Z',
        cerradaEn: '2026-10-10T18:19:55.706Z',
      },
    });
  });

  it('el uuid del vehiculo se guarda en minusculas y los instantes en UTC', () => {
    const r = normalizarDatosJornada(
      datos({
        vehiculo_id: VEHICULO.toUpperCase(),
        abierta_en: '2026-10-10T08:03:53.458-07:00',
        cerrada_en: '2026-10-10T18:19:55-07:00',
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      jornada: {
        vehiculoId: VEHICULO,
        abiertaEn: '2026-10-10T15:03:53.458Z',
        cerradaEn: '2026-10-11T01:19:55.000Z',
      },
    });
  });

  it('acepta decimales, el km final igual al inicial y el tope de numeric(10,1)', () => {
    expect(
      normalizarDatosJornada(datos({ km_inicial: 128_712.5, km_final: 128_712.5 })),
    ).toMatchObject({ ok: true, jornada: { kmInicial: 128_712.5, kmFinal: 128_712.5 } });
    expect(
      normalizarDatosJornada(datos({ km_inicial: 0, km_final: KM_MAXIMO })),
    ).toMatchObject({ ok: true });
  });

  it('ignora cualquier otro campo (el buzon le agrega cliente_id: null)', () => {
    expect(
      normalizarDatosJornada(datos({ cliente_id: null, lo_que_sea: 1 })),
    ).toMatchObject({ ok: true });
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['sin vehiculo', { vehiculo_id: undefined }, 'vehiculo_id: '],
    ['vehiculo que no es uuid', { vehiculo_id: 'veh-1' }, 'vehiculo_id: '],
    ['km inicial como texto', { km_inicial: '128450' }, 'km_inicial: '],
    ['km inicial negativo', { km_inicial: -1 }, 'km_inicial: '],
    ['km inicial NaN', { km_inicial: Number.NaN }, 'km_inicial: '],
    ['sin km final', { km_final: undefined }, 'km_final: '],
    ['km final nulo', { km_final: null }, 'km_final: '],
    ['km final que no cabe en numeric(10,1)', { km_final: 1_000_000_000 }, 'km_final: '],
    ['km final infinito', { km_final: Number.POSITIVE_INFINITY }, 'km_final: '],
    ['apertura sin zona', { abierta_en: '2026-10-10T08:03:53' }, 'abierta_en: '],
    ['apertura que no es instante', { abierta_en: 'ayer' }, 'abierta_en: '],
    ['apertura en un dia que no existe', { abierta_en: '2026-02-30T08:00:00Z' }, 'abierta_en: '],
    ['sin cierre', { cerrada_en: null }, 'cerrada_en: '],
    ['cierre solo con fecha', { cerrada_en: '2026-10-10' }, 'cerrada_en: '],
  ])('%s es un problema de forma y nombra el campo', (_caso, extra, campo) => {
    const r = normalizarDatosJornada(datos(extra));
    expect(r).toMatchObject({ ok: false, falla: 'forma' });
    if (r.ok) throw new Error('debia rechazarse');
    expect(r.motivo.startsWith(campo)).toBe(true);
  });

  it('km final menor al inicial es una falla de km, no de forma', () => {
    const r = normalizarDatosJornada(datos({ km_inicial: 128512, km_final: 128450 }));
    expect(r).toMatchObject({ ok: false, falla: 'km' });
    if (r.ok) throw new Error('debia rechazarse');
    expect(r.motivo).toContain('km_final');
  });

  it('si la forma tambien esta mal, manda la forma: los km solo se comparan legibles', () => {
    expect(
      normalizarDatosJornada(
        datos({ km_inicial: 128512, km_final: 128450, cerrada_en: 'nunca' }),
      ),
    ).toMatchObject({ ok: false, falla: 'forma' });
  });
});
```

- [ ] **Paso 2: Prueba del traductor (falla)**

Crear `apps/backend/src/modules/sincronizacion/despacho-jornada.spec.ts`:

```ts
import { CODIGOS_RECHAZO } from './contrato';
import {
  CODIGO_POR_RAZON_JORNADA,
  prepararJornada,
} from './despacho-jornada';
import type { OperacionNormalizada } from './operaciones';

const VEHICULO = '106c93f1-0c9a-4efc-b167-8c73eea9b023';

const op = (
  datos: Record<string, unknown> = {},
): OperacionNormalizada => ({
  clave: 'c0ffee00-0000-4000-8000-000000000038',
  tipo: 'jornada',
  fechaOperacion: '2026-10-10',
  ocurridoEn: '2026-10-10T18:19:55.706Z',
  clienteId: null,
  folio: null,
  datos: {
    vehiculo_id: VEHICULO,
    km_inicial: 128450,
    km_final: 128512,
    abierta_en: '2026-10-10T18:03:53.458Z',
    cerrada_en: '2026-10-10T18:19:55.706Z',
    ...datos,
  },
});

describe('prepararJornada (T-38)', () => {
  it('una jornada valida se prepara para JornadasService', () => {
    expect(prepararJornada(op())).toEqual({
      ok: true,
      jornada: {
        vehiculoId: VEHICULO,
        kmInicial: 128450,
        kmFinal: 128512,
        abiertaEn: '2026-10-10T18:03:53.458Z',
        cerradaEn: '2026-10-10T18:19:55.706Z',
      },
    });
  });

  it('un problema de forma es jornada-datos-invalidos, no el generico datos-invalidos', () => {
    const r = prepararJornada(op({ vehiculo_id: undefined }));
    expect(r).toMatchObject({ ok: false, codigo: 'jornada-datos-invalidos' });
    if (r.ok) throw new Error('debia rechazarse');
    expect(r.motivo).toContain('vehiculo_id');
  });

  it('km final menor al inicial es jornada-km-invalido', () => {
    expect(
      prepararJornada(op({ km_inicial: 200, km_final: 100 })),
    ).toMatchObject({ ok: false, codigo: 'jornada-km-invalido' });
  });
});

describe('CODIGO_POR_RAZON_JORNADA', () => {
  it('cada razon del dominio sale con un codigo que existe en el contrato', () => {
    for (const codigo of Object.values(CODIGO_POR_RAZON_JORNADA)) {
      expect(CODIGOS_RECHAZO).toContain(codigo);
    }
    expect(CODIGO_POR_RAZON_JORNADA).toEqual({
      'vehiculo-inexistente': 'vehiculo-inexistente',
      'jornada-duplicada': 'jornada-duplicada',
    });
  });
});
```

- [ ] **Paso 3: Correr y ver que fallan**

Run: `npm test --workspace=apps/backend -- datos-jornada despacho-jornada`
Expected: FAIL, `Cannot find module './datos-jornada'` / `'./despacho-jornada'`.

- [ ] **Paso 4: `rutas/datos-jornada.ts`**

```ts
/**
 * Validacion y normalizacion de `datos` de una jornada cerrada (T-38, D2).
 *
 * Pura, sin base de datos: decide si la jornada tiene la FORMA correcta. Que el
 * vehiculo exista y sea de la sucursal del vendedor, y que el vendedor no tenga
 * ya otra jornada ese dia, lo decide `JornadasService` dentro de la transaccion.
 *
 * Recibe un objeto sin tipar y no un DTO por la regla de T-07: se rechaza por
 * operacion con un motivo, nunca se tumba el lote. Por eso tambien comprueba lo
 * que haria reventar a Postgres (un uuid mal formado, un km que no cabe en
 * `numeric(10,1)`, un instante que no existe): eso seria un 500 para todo el
 * lote, y la tablet traduce un 5xx a "sin red" y reintentaria para siempre.
 */

/** Lo que cabe en `jornada.km_*`, `numeric(10,1)`: nueve digitos enteros y una decima. */
export const KM_MAXIMO = 999_999_999.9;

/** La jornada ya validada. Vendedor, sucursal y fecha viajan en el `contexto`. */
export interface JornadaNormalizada {
  /** uuid en minusculas (Postgres los devuelve asi). */
  vehiculoId: string;
  kmInicial: number;
  kmFinal: number;
  /** ISO-8601 en UTC (`toISOString`). */
  abiertaEn: string;
  /** ISO-8601 en UTC (`toISOString`). */
  cerradaEn: string;
}

export type ResultadoDatosJornada =
  | { ok: true; jornada: JornadaNormalizada }
  | {
      ok: false;
      /**
       * `forma`: falta un campo o no tiene el tipo correcto (un bug de la
       * tablet). `km`: la forma es buena pero el km final es menor al inicial.
       * Son dos codigos distintos del contrato (D3).
       */
      falla: 'forma' | 'km';
      /** Empieza por el campo: es lo que guarda la tablet en `sync_error`. */
      motivo: string;
    };

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Instante ISO-8601 **con zona** (`Z` o `±hh:mm`). Sin zona, Postgres lo
 * leeria en la zona de su sesion y el instante se correria horas.
 */
const RE_INSTANTE =
  /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

function forma(campo: string, motivo: string): ResultadoDatosJornada {
  return { ok: false, falla: 'forma', motivo: `${campo}: ${motivo}` };
}

function esKm(valor: unknown): valor is number {
  return (
    typeof valor === 'number' &&
    Number.isFinite(valor) &&
    valor >= 0 &&
    valor <= KM_MAXIMO
  );
}

/**
 * `AAAA-MM-DD` que existe en el calendario. `Date.parse` no basta: convierte
 * un 30 de febrero en 2 de marzo, y Postgres lo rechazaria con un 500.
 * `Date.UTC` aqui solo comprueba el calendario; no deriva ningun dia de UTC.
 */
function esFechaReal(valor: string): boolean {
  const [anio, mes, dia] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

function esInstante(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false;
  const partes = RE_INSTANTE.exec(valor);
  return (
    partes !== null &&
    esFechaReal(partes[1]) &&
    !Number.isNaN(Date.parse(valor))
  );
}

/** Valida y normaliza `datos` de una operacion `jornada`. */
export function normalizarDatosJornada(
  datos: Record<string, unknown>,
): ResultadoDatosJornada {
  const vehiculoId = datos.vehiculo_id;
  if (typeof vehiculoId !== 'string' || !RE_UUID.test(vehiculoId)) {
    return forma(
      'vehiculo_id',
      'tiene que ser el uuid del vehículo con el que se abrió el día.',
    );
  }

  const kmInicial = datos.km_inicial;
  if (!esKm(kmInicial)) {
    return forma(
      'km_inicial',
      `tiene que ser un número entre 0 y ${KM_MAXIMO}.`,
    );
  }

  const kmFinal = datos.km_final;
  if (!esKm(kmFinal)) {
    return forma('km_final', `tiene que ser un número entre 0 y ${KM_MAXIMO}.`);
  }

  const abiertaEn = datos.abierta_en;
  if (!esInstante(abiertaEn)) {
    return forma(
      'abierta_en',
      'tiene que ser un instante ISO-8601 con zona (por ejemplo 2026-10-10T08:03:53Z).',
    );
  }

  const cerradaEn = datos.cerrada_en;
  if (!esInstante(cerradaEn)) {
    return forma(
      'cerrada_en',
      'tiene que ser un instante ISO-8601 con zona (por ejemplo 2026-10-10T18:19:55Z).',
    );
  }

  // Despues de la forma a proposito: los dos km solo se comparan si los dos son
  // legibles. El odometro no retrocede; la tablet ya lo impide al cerrar.
  if (kmFinal < kmInicial) {
    return {
      ok: false,
      falla: 'km',
      motivo: `km_final: ${kmFinal} es menor que km_inicial ${kmInicial}; el odómetro no retrocede.`,
    };
  }

  return {
    ok: true,
    jornada: {
      vehiculoId: vehiculoId.toLowerCase(),
      kmInicial,
      kmFinal,
      abiertaEn: new Date(abiertaEn).toISOString(),
      cerradaEn: new Date(cerradaEn).toISOString(),
    },
  };
}
```

- [ ] **Paso 5: `rutas/jornada-rechazada.ts`**

```ts
/**
 * Una jornada que el DOMINIO no acepta (T-38).
 *
 * Igual que `CobranzaRechazada`: no importa nada del contrato de
 * sincronizacion. `push` la traduce a su codigo
 * (`sincronizacion/despacho-jornada.ts`).
 *
 * La forma de `datos` y el orden de los km no estan aqui: se rechazan antes de
 * abrir la transaccion (`datos-jornada.ts`).
 */
export type RazonRechazoJornada =
  /**
   * El vehiculo no existe, esta dado de baja (`deleted_at`) o es de otra
   * sucursal que la del vendedor. Uno desactivado (`activo = false`) NO cae
   * aqui: el kilometraje se recorrio igual.
   */
  | 'vehiculo-inexistente'
  /** Ya hay una jornada viva de ese vendedor ese dia, subida con otra clave. */
  | 'jornada-duplicada';

export interface RechazoJornada {
  razon: RazonRechazoJornada;
  /** En el espanol que leera quien tenga la tablet en la mano. */
  motivo: string;
}

export class JornadaRechazada extends Error {
  readonly razon: RazonRechazoJornada;

  constructor({ razon, motivo }: RechazoJornada) {
    super(motivo);
    this.name = 'JornadaRechazada';
    this.razon = razon;
  }
}
```

- [ ] **Paso 6: `sincronizacion/despacho-jornada.ts`**

```ts
import {
  normalizarDatosJornada,
  type JornadaNormalizada,
} from '../rutas/datos-jornada';
import type { RazonRechazoJornada } from '../rutas/jornada-rechazada';
import type { CodigoRechazo } from './contrato';
import type { OperacionNormalizada, Rechazo } from './operaciones';

/**
 * La parte del despachador que es de la jornada (T-38), en su propio archivo
 * para que `despacho.ts` se quede en un `case` corto por tipo (acuerdo de
 * T-40). Puro, sin base.
 */

export type PreparacionJornada =
  { ok: true; jornada: JornadaNormalizada } | ({ ok: false } & Rechazo);

/**
 * Valida la FORMA de una jornada antes de abrir la transaccion. Un rechazo aqui
 * no toca la base.
 *
 * Sin comprobacion de folio ni de `cliente_id`: la tablet no los manda en la
 * jornada (`fuente-jornadas.ts`) y el spec no pide rechazarlos (D2).
 */
export function prepararJornada(op: OperacionNormalizada): PreparacionJornada {
  const r = normalizarDatosJornada(op.datos);
  if (!r.ok) {
    return {
      ok: false,
      // Dos codigos y no el generico `datos-invalidos` (D3): la tablet tiene
      // que poder distinguir un sobre mal armado de un odometro que retrocede.
      codigo:
        r.falla === 'km' ? 'jornada-km-invalido' : 'jornada-datos-invalidos',
      motivo: r.motivo,
    };
  }
  return { ok: true, jornada: r.jornada };
}

/**
 * Razon del dominio a codigo del contrato. Un `Record`: si `rutas` agrega una
 * razon, esto deja de compilar hasta asignarle codigo.
 */
export const CODIGO_POR_RAZON_JORNADA: Record<
  RazonRechazoJornada,
  CodigoRechazo
> = {
  'vehiculo-inexistente': 'vehiculo-inexistente',
  'jornada-duplicada': 'jornada-duplicada',
};
```

- [ ] **Paso 7: Correr y ver que pasan**

Run: `npm test --workspace=apps/backend -- datos-jornada despacho-jornada`
Expected: PASS, las dos suites.

- [ ] **Paso 8: Formato, lint, suite completa**

Run:
```bash
npm exec --workspace=apps/backend -- prettier --write src/modules/rutas/datos-jornada.ts \
  src/modules/rutas/datos-jornada.spec.ts src/modules/rutas/jornada-rechazada.ts \
  src/modules/sincronizacion/despacho-jornada.ts src/modules/sincronizacion/despacho-jornada.spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/rutas/datos-jornada.ts \
  src/modules/rutas/datos-jornada.spec.ts src/modules/rutas/jornada-rechazada.ts \
  src/modules/sincronizacion/despacho-jornada.ts src/modules/sincronizacion/despacho-jornada.spec.ts
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
```
Expected: sin errores de lint; compila; unitarias = línea base + las nuevas, todas en verde.

- [ ] **Paso 9: Commit**

```bash
git add apps/backend/src/modules/rutas/datos-jornada.ts apps/backend/src/modules/rutas/datos-jornada.spec.ts \
  apps/backend/src/modules/rutas/jornada-rechazada.ts \
  apps/backend/src/modules/sincronizacion/despacho-jornada.ts \
  apps/backend/src/modules/sincronizacion/despacho-jornada.spec.ts
git commit -m "T-38: forma de los datos de la jornada y su traduccion a codigos del contrato

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 4: Proyección de la jornada — repositorio, servicio, cableado en `push` y e2e

**Implementador:** `sonnet` · **Revisor:** **`opus`** (transacción por operación, rechazos sin fila, e2e del buzón)

**Archivos:**
- Crear: `apps/backend/src/modules/rutas/jornadas.repository.ts`
- Crear: `apps/backend/src/modules/rutas/jornadas.service.ts`
- Crear: `apps/backend/src/modules/rutas/jornadas.service.spec.ts`
- Modificar: `apps/backend/src/modules/rutas/rutas.module.ts`
- Modificar: `apps/backend/src/modules/sincronizacion/sincronizacion.module.ts`
- Modificar: `apps/backend/src/modules/sincronizacion/despacho.ts`
- Modificar: `apps/backend/src/modules/sincronizacion/despacho.spec.ts`
- Modificar: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`
- Modificar: `apps/backend/test/sincronizacion.e2e-spec.ts`

**Interfaces:**
- Consume: Tarea 1 (`DB.jornada` en `schema.d.ts`, `uq_jornada_vendedor_fecha`); Tarea 2 (códigos); Tarea 3
  (`JornadaNormalizada`, `JornadaRechazada`, `RazonRechazoJornada`, `prepararJornada`,
  `CODIGO_POR_RAZON_JORNADA`).
- Produce:
  - `JornadasRepository.vehiculoDeLaSucursal(vehiculoId: string, sucursalId: string, trx: Transaction<DB>):
    Promise<boolean>` y `JornadasRepository.insertar(nueva: NuevaJornada, trx): Promise<string | null>`
    (`null` = ya había una jornada viva ese día).
  - `JornadasService.cerrarJornada(jornada: JornadaNormalizada, contexto: ContextoJornada, trx:
    Transaction<DB>): Promise<EntidadJornada>` con `ContextoJornada { sucursalId: string; vendedorId: string;
    fechaOperacion: string }` y `EntidadJornada { tabla: 'jornada'; id: string }`. Lanza `JornadaRechazada`.
  - `RutasModule` exporta `JornadasService`; `SincronizacionModule` importa `RutasModule`.
  - `Proyeccion` gana `{ tipo: 'jornada'; jornada: JornadaNormalizada }`.

**Decisiones de esta tarea (ya tomadas; no las cambies sin preguntar):**

1. **`jornada-duplicada` con `on conflict ... do nothing`, no con un `select` previo ni atrapando el `23505`.**
   El insert lleva `on conflict (vendedor_id, fecha) where deleted_at is null do nothing returning id`; si no
   devuelve fila, el servicio lanza `JornadaRechazada('jornada-duplicada')` y la transacción hace rollback.
   - Un `select` antes del insert deja una ventana: dos tablets del mismo vendedor que cierran a la vez pasan
     las dos el `select`, y la segunda revienta con `23505`.
   - Atrapar el `23505` no se puede dentro de la transacción (Postgres la aborta entera, lección de T-16 D10),
     y fuera obligaría a una clasificación después del rollback como la del folio.
   - `on conflict do nothing` no aborta nada y espera a la otra transacción si está en vuelo: es el mismo
     mecanismo que ya usa `guardarOperacion` para la clave de idempotencia. Kysely 0.28 lo escribe con
     `oc.columns([...]).where('deleted_at', 'is', null).doNothing()` (el `where` es el predicado del índice
     parcial, obligatorio para que Postgres infiera `uq_jornada_vendedor_fecha`).
   - Un `23505` de `uq_jornada_vendedor_fecha` que llegara al `catch` de `aplicar()` saldría como 500:
     `esColisionDeFolio` solo reconoce sus dos restricciones, así que nunca se disfrazaría de
     `folio-duplicado`. Con `on conflict` no debería ocurrir.
   - La **misma clave** reenviada nunca llega al insert de la jornada: el buzón (`guardarOperacion`, `on
     conflict (vendedor_id, clave_idempotencia) do nothing`) la devuelve antes como `duplicada` y
     `aplicar()` no proyecta (`if (buzon.duplicada || proyeccion === null) return buzon;`).
2. **Vehículo**: vale si `id` = el de la jornada, `sucursal_id` = la del vendedor **del token** y `deleted_at
   is null`. **No** se mira `activo`: en este esquema "baja" es `deleted_at` y "desactivar" es `activo`
   (comentario de `uq_vehiculo_nombre_sucursal` en `20260823120000_vehiculo_unicidad.sql`), y una jornada
   cerrada con un vehículo que el portal desactivó a media tarde sí recorrió esos kilómetros (mismo criterio
   que la cobranza sobre una nota ya pagada, T-20 D9). Ver *Conflictos*, punto 4.
3. **`km_final < km_inicial`** ya se rechazó en `prepararJornada` (Tarea 3), antes de la transacción. El
   servicio no lo repite; el check `ck_jornada_km_final` es la defensa en profundidad.

- [ ] **Paso 1: Prueba del servicio (falla)**

Crear `apps/backend/src/modules/rutas/jornadas.service.spec.ts`:

```ts
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { JornadaNormalizada } from './datos-jornada';
import { JornadaRechazada } from './jornada-rechazada';
import { JornadasService, type ContextoJornada } from './jornadas.service';

const VEHICULO = '106c93f1-0c9a-4efc-b167-8c73eea9b023';

/** El servicio no usa la transaccion: solo la pasa a quien escribe. */
const trx = {} as Transaction<DB>;

const contexto: ContextoJornada = {
  sucursalId: 'sucursal-tj',
  vendedorId: 'vendedor-1',
  fechaOperacion: '2026-10-10',
};

const jornada: JornadaNormalizada = {
  vehiculoId: VEHICULO,
  kmInicial: 128450,
  kmFinal: 128512,
  abiertaEn: '2026-10-10T15:03:53.458Z',
  cerradaEn: '2026-10-11T01:19:55.706Z',
};

function montar(
  opciones: { vehiculoValido?: boolean; idInsertado?: string | null } = {},
) {
  const repo = {
    vehiculoDeLaSucursal: jest
      .fn()
      .mockResolvedValue(opciones.vehiculoValido ?? true),
    insertar: jest
      .fn()
      .mockResolvedValue(
        'idInsertado' in opciones ? opciones.idInsertado : 'jornada-1',
      ),
  };
  return { servicio: new JornadasService(repo), repo };
}

describe('JornadasService.cerrarJornada (T-38)', () => {
  it('inserta con el dia, el vendedor y la sucursal del contexto y devuelve la fila para el buzon', async () => {
    const { servicio, repo } = montar();

    await expect(
      servicio.cerrarJornada(jornada, contexto, trx),
    ).resolves.toEqual({ tabla: 'jornada', id: 'jornada-1' });

    expect(repo.vehiculoDeLaSucursal).toHaveBeenCalledWith(
      VEHICULO,
      'sucursal-tj',
      trx,
    );
    expect(repo.insertar).toHaveBeenCalledWith(
      {
        vendedorId: 'vendedor-1',
        vehiculoId: VEHICULO,
        sucursalId: 'sucursal-tj',
        fecha: '2026-10-10',
        kmInicial: 128450,
        kmFinal: 128512,
        abiertaEn: '2026-10-10T15:03:53.458Z',
        cerradaEn: '2026-10-11T01:19:55.706Z',
      },
      trx,
    );
  });

  it('un vehiculo que no es de la sucursal es vehiculo-inexistente y no inserta nada', async () => {
    const { servicio, repo } = montar({ vehiculoValido: false });

    const error = await servicio
      .cerrarJornada(jornada, contexto, trx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(JornadaRechazada);
    expect(error).toMatchObject({ razon: 'vehiculo-inexistente' });
    expect(repo.insertar).not.toHaveBeenCalled();
  });

  it('si ya habia una jornada viva ese dia es jornada-duplicada', async () => {
    const { servicio } = montar({ idInsertado: null });

    const error = await servicio
      .cerrarJornada(jornada, contexto, trx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(JornadaRechazada);
    expect(error).toMatchObject({ razon: 'jornada-duplicada' });
    expect((error as Error).message).toContain('2026-10-10');
  });
});
```

- [ ] **Paso 2: Ver que falla**

Run: `npm test --workspace=apps/backend -- jornadas.service`
Expected: FAIL, `Cannot find module './jornadas.service'`.

- [ ] **Paso 3: `rutas/jornadas.repository.ts`**

```ts
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';

/** Una fila de `jornada` lista para escribir. */
export interface NuevaJornada {
  vendedorId: string;
  vehiculoId: string;
  sucursalId: string;
  /** `AAAA-MM-DD`: la `fecha_operacion` del sobre, tal cual. */
  fecha: string;
  kmInicial: number;
  kmFinal: number;
  abiertaEn: string;
  cerradaEn: string;
}

/**
 * SQL de la jornada (T-38).
 *
 * Como `CobranzasRepository`: todo metodo recibe la `trx` y ninguno abre la
 * suya, porque la jornada entra o sale junto con su fila del buzon (ADR-0009
 * §2.3).
 */
@Injectable()
export class JornadasRepository {
  /**
   * ¿El vehiculo existe, no esta dado de baja y es de esa sucursal?
   *
   * No mira `activo` a proposito: un vehiculo desactivado a media jornada
   * igual recorrio esos kilometros (ver `JornadasService`).
   */
  async vehiculoDeLaSucursal(
    vehiculoId: string,
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<boolean> {
    const fila = await trx
      .selectFrom('vehiculo')
      .select('id')
      .where('id', '=', vehiculoId)
      .where('sucursal_id', '=', sucursalId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * Inserta la jornada, o devuelve `null` si el vendedor ya tiene una viva ese
   * dia (`uq_jornada_vendedor_fecha`).
   *
   * `on conflict ... do nothing` y no atrapar el `23505`: un `unique_violation`
   * aborta la transaccion entera de Postgres (T-16, D10), y con esto no hay
   * nada que abortar. Si otra transaccion esta insertando el mismo dia, Postgres
   * espera a que termine y despues decide. El `where` es el predicado del indice
   * parcial: sin el, Postgres no lo puede usar como arbitro.
   */
  async insertar(
    nueva: NuevaJornada,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .insertInto('jornada')
      .values({
        vendedor_id: nueva.vendedorId,
        vehiculo_id: nueva.vehiculoId,
        sucursal_id: nueva.sucursalId,
        fecha: nueva.fecha,
        km_inicial: nueva.kmInicial,
        km_final: nueva.kmFinal,
        abierta_en: nueva.abiertaEn,
        cerrada_en: nueva.cerradaEn,
      })
      .onConflict((oc) =>
        oc
          .columns(['vendedor_id', 'fecha'])
          .where('deleted_at', 'is', null)
          .doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    return fila?.id ?? null;
  }
}
```

- [ ] **Paso 4: `rutas/jornadas.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { JornadaNormalizada } from './datos-jornada';
import { JornadaRechazada } from './jornada-rechazada';
import { JornadasRepository } from './jornadas.repository';

/**
 * Quien y cuando. Todo sale del token o del sobre, nunca de `datos`:
 *
 * - `sucursalId` y `vendedorId`: los del vendedor del token (`vendedorEnAlcance`
 *   ya paso por `resolverAlcance()`).
 * - `fechaOperacion`: la del sobre, tal cual la calculo la tablet. El servidor
 *   no la re-deriva de UTC.
 */
export interface ContextoJornada {
  sucursalId: string;
  vendedorId: string;
  fechaOperacion: string;
}

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadJornada {
  tabla: 'jornada';
  id: string;
}

/**
 * La jornada del vendedor en el servidor (T-38): proyecta el `tipo: 'jornada'`
 * que sube la tablet a la tabla `jornada`, de donde leera el reporte de
 * Kilometraje del portal. Vive en `rutas/` porque `Vehículo.md` declara
 * `modulo: rutas` y ADR-0009 le asigna `JornadasService.cerrarJornada`.
 */
@Injectable()
export class JornadasService {
  constructor(private readonly repo: JornadasRepository) {}

  /**
   * Registra una jornada cerrada cuya forma ya valido `normalizarDatosJornada`,
   * dentro de la transaccion de quien llama.
   *
   * Un vehiculo **desactivado** (`activo = false`) se acepta: el portal pudo
   * desactivarlo despues de que el vendedor abrio el dia, y esos kilometros se
   * recorrieron igual. Solo el que no existe, esta dado de baja (`deleted_at`)
   * o es de otra sucursal se rechaza.
   *
   * @throws {JornadaRechazada} `vehiculo-inexistente` o `jornada-duplicada`.
   * No escribe nada antes de lanzar.
   */
  async cerrarJornada(
    jornada: JornadaNormalizada,
    contexto: ContextoJornada,
    trx: Transaction<DB>,
  ): Promise<EntidadJornada> {
    const vehiculoValido = await this.repo.vehiculoDeLaSucursal(
      jornada.vehiculoId,
      contexto.sucursalId,
      trx,
    );
    if (!vehiculoValido) {
      throw new JornadaRechazada({
        razon: 'vehiculo-inexistente',
        motivo: `El vehículo ${jornada.vehiculoId} no existe, está dado de baja o no es de tu sucursal.`,
      });
    }

    const id = await this.repo.insertar(
      {
        vendedorId: contexto.vendedorId,
        vehiculoId: jornada.vehiculoId,
        sucursalId: contexto.sucursalId,
        fecha: contexto.fechaOperacion,
        kmInicial: jornada.kmInicial,
        kmFinal: jornada.kmFinal,
        abiertaEn: jornada.abiertaEn,
        cerradaEn: jornada.cerradaEn,
      },
      trx,
    );
    if (id === null) {
      throw new JornadaRechazada({
        razon: 'jornada-duplicada',
        motivo: `Ya hay una jornada registrada para este vendedor el ${contexto.fechaOperacion}.`,
      });
    }

    return { tabla: 'jornada', id };
  }
}
```

- [ ] **Paso 5: Ver que la prueba del servicio pasa**

Run: `npm test --workspace=apps/backend -- jornadas.service`
Expected: PASS (3 pruebas).

- [ ] **Paso 6: Módulos**

`apps/backend/src/modules/rutas/rutas.module.ts` queda entero así:

```ts
import { Module } from '@nestjs/common';
import { JornadasRepository } from './jornadas.repository';
import { JornadasService } from './jornadas.service';
import { VehiculosController } from './vehiculos.controller';
import { VehiculosRepository } from './vehiculos.repository';
import { VehiculosService } from './vehiculos.service';

// Vehiculos vive aqui y no en un `modules/vehiculos/` nuevo: el CLAUDE.md fija
// que los modulos usan los slugs del vault, y `Vehículo.md` declara
// `modulo: rutas` (D1).
//
// T-38: exporta `JornadasService` para que sincronizacion/ proyecte la jornada
// que sube la tablet (ADR-0009); la dependencia va de sincronizacion hacia
// aqui, nunca al reves.
@Module({
  controllers: [VehiculosController],
  providers: [
    VehiculosService,
    VehiculosRepository,
    JornadasService,
    JornadasRepository,
  ],
  exports: [JornadasService],
})
export class RutasModule {}
```

En `apps/backend/src/modules/sincronizacion/sincronizacion.module.ts`:
- agregar `import { RutasModule } from '../rutas/rutas.module';` junto a los otros imports de módulos;
- reemplazar

```ts
  // T-40 suma Cartera de Clientes: es la duena de `cliente` y por tanto la que
  // proyecta el `tipo: 'prospecto'`.
  imports: [VentasCobranzaModule, CarteraClientesModule],
```

por

```ts
  // T-40 suma Cartera de Clientes: es la duena de `cliente` y por tanto la que
  // proyecta el `tipo: 'prospecto'`. T-38 suma Rutas: la duena de la jornada.
  imports: [VentasCobranzaModule, CarteraClientesModule, RutasModule],
```

- [ ] **Paso 7: `despacho.spec.ts` (falla)**

En `apps/backend/src/modules/sincronizacion/despacho.spec.ts`, reemplazar el `it.each` del principio de
`describe('prepararProyeccion', …)`:

```ts
  it.each(['jornada', 'gasto', 'merma', 'ruta'] as const)(
```

por:

```ts
  it.each(['gasto', 'merma', 'ruta'] as const)(
```

y, justo después del cierre de ese `it.each(…);`, agregar:

```ts

  it('una jornada pasa por prepararJornada y sale como proyeccion de jornada (T-38)', () => {
    const VEHICULO = '106c93f1-0c9a-4efc-b167-8c73eea9b023';
    const r = prepararProyeccion(
      op({
        tipo: 'jornada',
        folio: null,
        clienteId: null,
        datos: {
          vehiculo_id: VEHICULO,
          km_inicial: 128450,
          km_final: 128512,
          abierta_en: '2026-10-10T08:03:53.458-07:00',
          cerrada_en: '2026-10-10T18:19:55.706-07:00',
        },
      }),
    );
    expect(r).toEqual({
      ok: true,
      proyeccion: {
        tipo: 'jornada',
        jornada: {
          vehiculoId: VEHICULO,
          kmInicial: 128450,
          kmFinal: 128512,
          abiertaEn: '2026-10-10T15:03:53.458Z',
          cerradaEn: '2026-10-11T01:19:55.706Z',
        },
      },
    });
  });

  it('una jornada con datos de T-07 (sin vehiculo ni instantes) ya no va al buzon: jornada-datos-invalidos (T-38)', () => {
    expect(
      prepararProyeccion(
        op({
          tipo: 'jornada',
          folio: null,
          clienteId: null,
          datos: { km_inicial: 120345 },
        }),
      ),
    ).toMatchObject({ ok: false, codigo: 'jornada-datos-invalidos' });
  });
```

Run: `npm test --workspace=apps/backend -- despacho.spec`
Expected: FAIL (la jornada todavía devuelve `proyeccion: null`).

- [ ] **Paso 8: `despacho.ts`**

8a. Imports: agregar junto a los existentes

```ts
import type { JornadaNormalizada } from '../rutas/datos-jornada';
```

y

```ts
import { prepararJornada } from './despacho-jornada';
```

8b. Reemplazar el comentario del tipo:

```ts
 * Un `tipo` sin modulo todavia (`jornada`, `gasto`, `merma`, `ruta`) no tiene
 * proyeccion: se guarda en el buzon y queda `aplicada`, como desde T-07.
 * Orden acordado entre tickets: `venta`, `prospecto` (T-40), `cobranza` (T-20).
```

por:

```ts
 * Un `tipo` sin modulo todavia (`gasto`, `merma`, `ruta`) no tiene proyeccion:
 * se guarda en el buzon y queda `aplicada`, como desde T-07.
 * Orden acordado entre tickets: `venta`, `prospecto` (T-40), `cobranza` (T-20),
 * `jornada` (T-38).
```

8c. Reemplazar el final de la unión:

```ts
  | { tipo: 'prospecto'; prospecto: ProspectoNormalizado }
  | { tipo: 'cobranza'; cobranza: CobranzaNormalizada };
```

por:

```ts
  | { tipo: 'prospecto'; prospecto: ProspectoNormalizado }
  | { tipo: 'cobranza'; cobranza: CobranzaNormalizada }
  // T-38. La fila es de `jornada`; vendedor, sucursal y fecha van en el contexto.
  | { tipo: 'jornada'; jornada: JornadaNormalizada };
```

8d. En `prepararProyeccion`, reemplazar:

```ts
    case 'jornada':
    case 'gasto':
```

por:

```ts
    case 'jornada': {
      // T-38. La forma y el orden de los km los revisa `despacho-jornada.ts`;
      // el vehiculo y el dia repetido, `JornadasService` dentro de la transaccion.
      const r = prepararJornada(op);
      if (!r.ok) return r;
      return {
        ok: true,
        proyeccion: { tipo: 'jornada', jornada: r.jornada },
      };
    }
    case 'gasto':
```

**No compiles todavía**: `sincronizacion.service.ts#proyectar()` deja de cubrir la unión hasta el Paso 9.

- [ ] **Paso 9: `sincronizacion.service.ts`**

9a. Imports: agregar

```ts
import { JornadaRechazada } from '../rutas/jornada-rechazada';
import { JornadasService } from '../rutas/jornadas.service';
```

(junto a los de `../ventas-cobranza/…`) y

```ts
import { CODIGO_POR_RAZON_JORNADA } from './despacho-jornada';
```

(junto a `import { CODIGO_POR_RAZON_COBRANZA } from './despacho-cobranza';`).

9b. Constructor: reemplazar

```ts
    private readonly cobranzas: CobranzasService,
  ) {}
```

por

```ts
    private readonly cobranzas: CobranzasService,
    // T-38: Rutas es la duena de la jornada (vehiculo + kilometraje del dia).
    private readonly jornadas: JornadasService,
  ) {}
```

9c. En el `catch` de `aplicar()`, después del bloque `if (error instanceof CobranzaRechazada) { … }` y antes de
`if (esColisionDeFolio(error)) {`, agregar:

```ts
      // T-38: el rollback ya dejo sin fila tanto el buzon como la jornada, asi
      // que un reenvio corregido (el portal reactivo el vehiculo) vuelve a entrar.
      if (error instanceof JornadaRechazada) {
        return {
          clave: op.clave,
          tipo: op.tipo,
          estado: 'rechazada',
          codigo: CODIGO_POR_RAZON_JORNADA[error.razon],
          motivo: error.message,
        };
      }
```

9d. En `proyectar()`, después del `case 'cobranza':` (que termina en `trx,\n        );`) y antes de la llave
que cierra el `switch`, agregar:

```ts
      case 'jornada':
        // La entidad del buzon es la fila de `jornada` (ADR-0009 §2.4,
        // enmendado): sin columna `sync_operacion_id`.
        return this.jornadas.cerrarJornada(
          proyeccion.jornada,
          {
            // Del token, nunca del cuerpo: el vehiculo se coteja contra ella.
            sucursalId: vendedor.sucursal_id,
            vendedorId: vendedor.id,
            // Tal cual lo mando la tablet: el servidor no re-deriva el dia de UTC.
            fechaOperacion: op.fechaOperacion,
          },
          trx,
        );
```

Run:
```bash
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
```
Expected: compila; unitarias en verde (incluidas las dos nuevas de `despacho.spec.ts` y las de
`jornadas.service.spec.ts`).

- [ ] **Paso 10: e2e — el sobre genérico deja de ser una jornada**

**Por qué:** `operacion()` es una jornada con `datos: { km_inicial: 120345 }`. Con la proyección, esa forma es
`jornada-datos-invalidos`; y aunque se completara, `uq_jornada_vendedor_fecha` admite **una** jornada por
vendedor y día, y las pruebas del buzón mandan varias en el mismo lote (3 en "reenviar EL MISMO lote", 47 en
"con 3 malas de 50") con la fecha de hoy. `operacion()` aparece en 21 pruebas como sobre genérico; 16 de ellas
(más "sube la operacion del dia", que arma una jornada con datos parciales) dependen de que salga `aplicada`.
Solución: el sobre genérico pasa a `gasto` (sigue sin módulo y sin forma de `datos` hasta T-27) y las pruebas
que hablan de la jornada usan un helper nuevo, `jornadaValida()`, con un día propio por llamada.

En `apps/backend/test/sincronizacion.e2e-spec.ts`:

10a. Reemplazar el helper:

```ts
  /** Una operacion valida de jornada, con clave unica por defecto. */
  const operacion = (extra: Record<string, unknown> = {}) => ({
    clave: `op-${SUFIJO}-${Math.random().toString(36).slice(2)}`,
    tipo: 'jornada',
    fecha_operacion: new Date().toISOString().slice(0, 10),
    ocurrido_en: new Date().toISOString(),
    datos: { km_inicial: 120345 },
    ...extra,
  });
```

por:

```ts
  /**
   * Una operacion valida SIN modulo de dominio, con clave unica por defecto: el
   * sobre generico de las pruebas del buzon (idempotencia, push parcial,
   * alcance). Es un `gasto` porque sigue sin proyeccion y sin forma fija de
   * `datos` hasta T-27.
   *
   * Hasta T-38 era una `jornada`. Ya no puede serlo: la jornada se proyecta a su
   * tabla, que admite UNA por vendedor y dia, y estas pruebas mandan varias en el
   * mismo lote (hasta 47). Las pruebas de la jornada usan `jornadaValida()`.
   * Cuando T-27 proyecte el gasto, este sobre tendra que mudarse otra vez.
   */
  const operacion = (extra: Record<string, unknown> = {}) => ({
    clave: `op-${SUFIJO}-${Math.random().toString(36).slice(2)}`,
    tipo: 'gasto',
    fecha_operacion: new Date().toISOString().slice(0, 10),
    ocurrido_en: new Date().toISOString(),
    datos: { concepto: 'hielo', monto_centavos: 5000 },
    ...extra,
  });

  /* ---------------------------------------------------------------- */
  /* Jornadas (T-38)                                                   */
  /* ---------------------------------------------------------------- */

  const ABIERTA_EN = '2025-01-01T15:03:53.458Z';
  const CERRADA_EN = '2025-01-02T01:19:55.706Z';

  /** `datos` de una jornada cerrada (contrato §6), con lo que se quiera cambiar encima. */
  const datosJornada = (extra: Record<string, unknown> = {}) => ({
    vehiculo_id: vehiculoId,
    km_inicial: 128450,
    km_final: 128512,
    abierta_en: ABIERTA_EN,
    cerrada_en: CERRADA_EN,
    ...extra,
  });

  /**
   * Un dia distinto en cada llamada, desde 2025-01-01. `jornada` admite UNA viva
   * por vendedor y dia (`uq_jornada_vendedor_fecha`), asi que cada jornada de
   * prueba necesita el suyo. Ninguna otra prueba usa 2025, y entre corridas no
   * chocan porque el vendedor es nuevo en cada una (`SUFIJO`).
   */
  let ultimaFechaJornada = 0;
  const siguienteFechaJornada = () =>
    new Date(Date.UTC(2025, 0, 1) + ultimaFechaJornada++ * 86_400_000)
      .toISOString()
      .slice(0, 10);

  /** Una jornada cerrada que el servidor acepta, en su propio dia salvo que se pida otro. */
  const jornadaValida = (
    extra: Record<string, unknown> = {},
    fecha = siguienteFechaJornada(),
  ) =>
    operacion({
      tipo: 'jornada',
      fecha_operacion: fecha,
      ocurrido_en: `${fecha}T18:19:55.706-07:00`,
      datos: datosJornada(),
      ...extra,
    });

  /** Vehiculos que crean las pruebas de T-38; los borra el `afterAll`. */
  const vehiculosT38: string[] = [];
```

10b. `afterAll`: justo después del primer borrado (`await db.deleteFrom('sync_operacion')…execute();`), agregar:

```ts
    // T-38: las jornadas proyectadas apuntan a vendedor y vehiculo.
    await db
      .deleteFrom('jornada')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
```

y justo **antes** de `await db.deleteFrom('vehiculo').where('id', '=', vehiculoId).execute();`, agregar:

```ts
    if (vehiculosT38.length > 0) {
      await db.deleteFrom('vehiculo').where('id', 'in', vehiculosT38).execute();
    }
```

10c. En `it('sube la operacion del dia y devuelve un id por operacion', …)`, reemplazar:

```ts
        operacion({
          tipo: 'jornada',
          datos: { km_inicial: 100, km_final: 240 },
        }),
```

por:

```ts
        // T-38: la jornada ya se proyecta a `jornada`: necesita datos completos.
        jornadaValida({ datos: datosJornada({ km_inicial: 100, km_final: 240 }) }),
```

10d. En `it('un lote mixto entra parcial y en orden: jornada, venta buena, venta rechazada, jornada', …)`,
reemplazar `const jornada1 = operacion();` por `const jornada1 = jornadaValida();` y
`const jornada2 = operacion();` por `const jornada2 = jornadaValida();`.

10e. **Borrar** la prueba entera `it('la jornada sigue entrando solo al buzon, sin entidad proyectada', …)`:
su significado se invirtió y la reemplaza la primera prueba del `describe('jornada (T-38)')` del Paso 11.

10f. En `it('la jornada sigue subiendo SIN folio', …)`, reemplazar
`await push({ operaciones: [operacion(), operacion()] })` por
`await push({ operaciones: [jornadaValida(), jornadaValida()] })` (dos días distintos: las dos entran).

- [ ] **Paso 11: e2e — las pruebas de la jornada**

Al final del archivo, **dentro** del `describe('Sincronizacion pull/push (e2e)', …)` y después del último
`describe` que ya existe (el de folios), agregar:

```ts
  /* ================================================================ */
  /* Jornada (T-38): el kilometraje del dia llega a su tabla          */
  /* ================================================================ */

  describe('jornada (T-38)', () => {
    /** Las filas de `jornada` del vendedor de la prueba en ese dia. */
    const jornadasDel = async (fecha: string) =>
      (
        await db
          .selectFrom('jornada')
          .selectAll()
          .where('vendedor_id', '=', vendedorId)
          .execute()
      ).filter((j) => fechaTexto(j.fecha) === fecha);

    /** Un vehiculo de prueba de T-38 (lo borra el `afterAll`). */
    const crearVehiculo = async (valores: {
      nombre: string;
      sucursal_id: string;
      activo?: boolean;
      deleted_at?: Date;
    }) => {
      const id = (
        await db
          .insertInto('vehiculo')
          .values(valores)
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      vehiculosT38.push(id);
      return id;
    };

    it('una jornada cerrada entra a `jornada` y el buzon dice a que fila se convirtio', async () => {
      const fecha = siguienteFechaJornada();
      const op = jornadaValida({}, fecha);

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0].estado).toBe('aplicada');

      const filas = await jornadasDel(fecha);
      expect(filas).toHaveLength(1);
      const [jornada] = filas;
      expect(jornada).toMatchObject({
        vendedor_id: vendedorId,
        vehiculo_id: vehiculoId,
        sucursal_id: sucursalId,
        km_inicial: '128450.0',
        km_final: '128512.0',
        deleted_at: null,
      });
      expect(new Date(jornada.abierta_en).toISOString()).toBe(ABIERTA_EN);
      expect(new Date(jornada.cerrada_en).toISOString()).toBe(CERRADA_EN);

      // Trazabilidad (ADR-0009 §2.4, enmendado): el buzon apunta a la jornada.
      expect(await buzonDe(op.clave)).toEqual({
        id: res.resultados[0].id_servidor,
        entidad_tabla: 'jornada',
        entidad_id: jornada.id,
      });
    });

    it('km final menor al inicial es jornada-km-invalido y no deja fila', async () => {
      const fecha = siguienteFechaJornada();
      const op = jornadaValida(
        { datos: datosJornada({ km_inicial: 128512, km_final: 128450 }) },
        fecha,
      );

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;

      expect(res.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'jornada-km-invalido',
      });
      expect(res.resultados[0].motivo).toContain('km_final');
      expect(await buzonDe(op.clave)).toBeUndefined();
      expect(await jornadasDel(fecha)).toHaveLength(0);
    });

    it('datos sin vehiculo_id es jornada-datos-invalidos, antes de la transaccion', async () => {
      const fecha = siguienteFechaJornada();
      const op = jornadaValida(
        { datos: datosJornada({ vehiculo_id: undefined }) },
        fecha,
      );

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;

      expect(res.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'jornada-datos-invalidos',
      });
      expect(res.resultados[0].motivo).toContain('vehiculo_id');
      expect(await buzonDe(op.clave)).toBeUndefined();
      expect(await jornadasDel(fecha)).toHaveLength(0);
    });

    it('un vehiculo de otra sucursal es vehiculo-inexistente; corregido, la misma clave entra', async () => {
      const ajeno = await crearVehiculo({
        nombre: `Camioneta ajena T-38 ${SUFIJO}`,
        sucursal_id: sucursalAjenaId,
      });
      const fecha = siguienteFechaJornada();
      const op = jornadaValida(
        { datos: datosJornada({ vehiculo_id: ajeno }) },
        fecha,
      );

      const primero = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(primero.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'vehiculo-inexistente',
      });
      // Rechazada no deja fila (contrato §7): ni buzon ni jornada.
      expect(await buzonDe(op.clave)).toBeUndefined();
      expect(await jornadasDel(fecha)).toHaveLength(0);

      // La tablet la reenvia con la MISMA clave (su fila local no cambia) cuando
      // el dato ya esta bien: entra, porque el rechazo no consumio la clave.
      const segundo = (
        await push({
          operaciones: [{ ...op, datos: datosJornada() }],
        }).expect(200)
      ).body as RespuestaPush;
      expect(segundo.resultados[0].estado).toBe('aplicada');
      expect(await jornadasDel(fecha)).toHaveLength(1);
    });

    it('un vehiculo dado de baja es vehiculo-inexistente', async () => {
      const deBaja = await crearVehiculo({
        nombre: `Camioneta de baja T-38 ${SUFIJO}`,
        sucursal_id: sucursalId,
        deleted_at: new Date(),
      });
      const op = jornadaValida({
        datos: datosJornada({ vehiculo_id: deBaja }),
      });

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'vehiculo-inexistente',
      });
    });

    it('un vehiculo que no existe es vehiculo-inexistente', async () => {
      const op = jornadaValida({
        datos: datosJornada({ vehiculo_id: randomUUID() }),
      });

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'vehiculo-inexistente',
      });
    });

    it('un vehiculo desactivado SI entra: el kilometraje se recorrio igual', async () => {
      const inactivo = await crearVehiculo({
        nombre: `Camioneta inactiva T-38 ${SUFIJO}`,
        sucursal_id: sucursalId,
        activo: false,
      });
      const fecha = siguienteFechaJornada();
      const op = jornadaValida(
        { datos: datosJornada({ vehiculo_id: inactivo }) },
        fecha,
      );

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0].estado).toBe('aplicada');
      expect(await jornadasDel(fecha)).toMatchObject([
        { vehiculo_id: inactivo },
      ]);
    });

    it('una segunda jornada del mismo dia con OTRA clave es jornada-duplicada', async () => {
      const fecha = siguienteFechaJornada();
      const primera = jornadaValida({}, fecha);
      // Otra tablet (o una fila local rehecha): otra clave, mismo vendedor y dia.
      const segunda = jornadaValida(
        { datos: datosJornada({ km_inicial: 200000, km_final: 200100 }) },
        fecha,
      );

      const res = (
        await push({ operaciones: [primera, segunda] }).expect(200)
      ).body as RespuestaPush;

      expect(res.resultados.map((r) => r.estado)).toEqual([
        'aplicada',
        'rechazada',
      ]);
      expect(res.resultados[1].codigo).toBe('jornada-duplicada');
      expect(await buzonDe(segunda.clave)).toBeUndefined();
      expect(await jornadasDel(fecha)).toMatchObject([
        { km_inicial: '128450.0' },
      ]);
    });

    it('la MISMA clave reenviada es duplicada, con el mismo id y una sola fila', async () => {
      const fecha = siguienteFechaJornada();
      const op = jornadaValida({}, fecha);

      const primero = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      const segundo = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;

      expect(primero.resultados[0].estado).toBe('aplicada');
      expect(segundo.resultados[0]).toMatchObject({
        estado: 'duplicada',
        id_servidor: primero.resultados[0].id_servidor,
      });
      expect(await jornadasDel(fecha)).toHaveLength(1);
    });
  });
```

- [ ] **Paso 12: Correr el e2e**

Run: `npm run test:e2e --workspace=apps/backend`
Expected: `sincronizacion.e2e-spec.ts` en verde; total = línea base − 1 (la borrada en 10e) + 9 nuevas. Si una
prueba **genérica** que no tocaste falla con `jornada-…` o `vehiculo-…`, es que todavía usa una jornada: búscala
(`grep -n "tipo: 'jornada'" apps/backend/test/sincronizacion.e2e-spec.ts` solo debe mostrar `jornadaValida`) y
repórtalo antes de cambiar nada más.

- [ ] **Paso 13: Formato, lint, suites**

Run:
```bash
npm exec --workspace=apps/backend -- prettier --write src/modules/rutas/jornadas.repository.ts \
  src/modules/rutas/jornadas.service.ts src/modules/rutas/jornadas.service.spec.ts \
  src/modules/rutas/rutas.module.ts src/modules/sincronizacion/sincronizacion.module.ts \
  src/modules/sincronizacion/despacho.ts src/modules/sincronizacion/despacho.spec.ts \
  src/modules/sincronizacion/sincronizacion.service.ts test/sincronizacion.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/rutas/jornadas.repository.ts \
  src/modules/rutas/jornadas.service.ts src/modules/rutas/jornadas.service.spec.ts \
  src/modules/rutas/rutas.module.ts src/modules/sincronizacion/sincronizacion.module.ts \
  src/modules/sincronizacion/despacho.ts src/modules/sincronizacion/despacho.spec.ts \
  src/modules/sincronizacion/sincronizacion.service.ts test/sincronizacion.e2e-spec.ts
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm run supabase -- test db --local
```
Expected: todo en verde contra la línea base.

- [ ] **Paso 14: Commit**

```bash
git add apps/backend/src/modules/rutas/jornadas.repository.ts apps/backend/src/modules/rutas/jornadas.service.ts \
  apps/backend/src/modules/rutas/jornadas.service.spec.ts apps/backend/src/modules/rutas/rutas.module.ts \
  apps/backend/src/modules/sincronizacion/sincronizacion.module.ts \
  apps/backend/src/modules/sincronizacion/despacho.ts apps/backend/src/modules/sincronizacion/despacho.spec.ts \
  apps/backend/src/modules/sincronizacion/sincronizacion.service.ts apps/backend/test/sincronizacion.e2e-spec.ts
git commit -m "T-38: el push proyecta la jornada cerrada a la tabla jornada (ADR-0009)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 5: Tablet D7 — el contador cuenta solo lo que viaja

**Implementador:** `haiku` · **Revisor:** `sonnet`

**Archivos:**
- Modificar: `apps/tablet/src/datos/repositorios/jornadas.ts`
- Modificar: `apps/tablet/src/datos/repositorios/jornadas.spec.ts`
- Modificar: `apps/tablet/src/sincronizacion/pendientes.spec.ts` (ya existe)
- Modificar: `apps/tablet/src/sincronizacion/motor.spec.ts`
- Modificar: `apps/tablet/src/sincronizacion/fuente-jornadas.ts` (solo comentario)

**Interfaces:**
- Consume: nada de tareas anteriores.
- Produce: `jornadas.pendientesDeSincronizar()` devuelve solo jornadas con `estado = 'cerrada'` y `sync_estado
  in ('pendiente', 'error')`. Firma sin cambios.

**Pruebas existentes que D7 cambia a propósito** (cada una con su edición abajo; no son regresiones):
- `jornadas.spec.ts` "lo capturado nace pendiente de subir": esperaba la jornada **abierta** en la cola.
- `jornadas.spec.ts` "marcarError guarda el motivo y la deja para reintentar (T-07)": marca error sobre una
  abierta y espera verla en la cola.
- `jornadas.spec.ts` "marcarSincronizada la saca de la cola y sella el momento": seguiría pasando, pero ya no
  probaría nada (una abierta nunca está en la cola); se cierra antes para que vuelva a significar algo.
- `motor.spec.ts` "NO sube una jornada abierta…": su última aserción (`toHaveLength(1)`, "Y sigue contando como
  pendiente: la pantalla lo muestra honestamente") **es el bug E3** del spec.
- `pendientes.spec.ts` "suma jornada, venta, prospecto y cobranza pendientes": abre la jornada y espera 4.
  **Ojo con la Tarea 6:** la jornada se cierra **después** de registrar venta, prospecto y cobranza; si se
  cierra antes, el candado de la Tarea 6 los rechazará.
- `fuente-jornadas.spec.ts` (191 líneas) **no se toca** y tiene que seguir en verde.

- [ ] **Paso 1: Pruebas (fallan)**

1a. En `apps/tablet/src/datos/repositorios/jornadas.spec.ts`, reemplazar:

```ts
    it('lo capturado nace pendiente de subir', () => {
      const { jornadas } = conJornadas();
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });

      expect(jornadas.pendientesDeSincronizar().map((j) => j.id)).toEqual([abierta.id]);
    });

    it('marcarSincronizada la saca de la cola y sella el momento', () => {
      const { jornadas } = conJornadas();
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });

      jornadas.marcarSincronizada(abierta.id);
```

por:

```ts
    it('una jornada abierta NO esta en la cola: todavia no viaja (T-38, D7)', () => {
      // `fuente-jornadas.ts` solo sube las cerradas (el buzon es de solo
      // escritura hasta T-43). Contarla como pendiente dejaba la pantalla en
      // "1 registro por subir" todo el dia y "se subieron 0" al sincronizar.
      const { jornadas } = conJornadas();
      jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });

      expect(jornadas.pendientesDeSincronizar()).toEqual([]);
    });

    it('al cerrarla entra a la cola de subida', () => {
      const { jornadas } = conJornadas();
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });

      jornadas.cerrar(abierta.id, 80);

      expect(jornadas.pendientesDeSincronizar().map((j) => j.id)).toEqual([abierta.id]);
    });

    it('marcarSincronizada la saca de la cola y sella el momento', () => {
      const { jornadas } = conJornadas();
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
      jornadas.cerrar(abierta.id, 80);

      jornadas.marcarSincronizada(abierta.id);
```

1b. En el mismo archivo, en `it('marcarError guarda el motivo y la deja para reintentar (T-07)', …)`, reemplazar:

```ts
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });

      jornadas.marcarError(abierta.id, 'fecha-futura: revisa el reloj de la tablet.');
```

por:

```ts
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
      // Solo una cerrada viaja, asi que solo una cerrada puede volver rechazada.
      jornadas.cerrar(abierta.id, 80);

      jornadas.marcarError(abierta.id, 'fecha-futura: revisa el reloj de la tablet.');
```

1c. En `apps/tablet/src/sincronizacion/motor.spec.ts`, en `it('NO sube una jornada abierta: el buzon del servidor
es de solo escritura', …)`, reemplazar:

```ts
      // Y sigue contando como pendiente: la pantalla lo muestra honestamente.
      expect(jornadas.pendientesDeSincronizar()).toHaveLength(1);
```

por:

```ts
      // Y NO cuenta como pendiente (T-38, D7): lo que no viaja no puede decir
      // "1 registro por subir". Contarla era el bug de "se subieron 0".
      expect(jornadas.pendientesDeSincronizar()).toHaveLength(0);
```

1d. En `apps/tablet/src/sincronizacion/pendientes.spec.ts`, en `it('suma jornada, venta, prospecto y cobranza
pendientes', …)`, reemplazar:

```ts
    jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
```

por:

```ts
    const jornada = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
```

y reemplazar:

```ts
    expect(contarPendientesDeSubir(fuentes)).toBe(4);
  });
});
```

por:

```ts
    // La jornada cuenta solo cerrada (D7). Se cierra al final: con el dia
    // cerrado ya no se puede registrar nada (D6).
    jornadas.cerrar(jornada.id, 20);

    expect(contarPendientesDeSubir(fuentes)).toBe(4);
  });

  it('una jornada abierta no cuenta; al cerrarla, si (T-38, D7)', () => {
    const fuentes = montar();
    const jornada = fuentes.jornadas.abrir({
      vendedorId: 'ven-1',
      vehiculoId: 'veh-1',
      kmInicial: 10,
    });

    expect(contarPendientesDeSubir(fuentes)).toBe(0);

    fuentes.jornadas.cerrar(jornada.id, 20);

    expect(contarPendientesDeSubir(fuentes)).toBe(1);
  });
});
```

- [ ] **Paso 2: Ver que fallan**

Run: `npm test --workspace=apps/tablet -- jornadas.spec pendientes.spec motor.spec`
Expected: FAIL en "una jornada abierta NO esta en la cola", en la aserción de `motor.spec.ts` y en "una jornada
abierta no cuenta; al cerrarla, si".

- [ ] **Paso 3: El filtro**

En `apps/tablet/src/datos/repositorios/jornadas.ts`, reemplazar el método entero:

```ts
    /**
     * Jornadas que faltan por subir al portal.
     *
     * Incluye las que quedaron en `error`: un rechazo puede deberse a un dato
     * que el portal corrigio despues (un vehiculo que estaba de baja, por
     * ejemplo), asi que se vuelve a intentar. Reintentar es seguro porque el
     * `push` es idempotente: la clave es el `id` de la fila, que no cambia.
     */
    pendientesDeSincronizar(): Jornada[] {
      return bd.getAllSync<Jornada>(
        `select * from jornada
         where sync_estado in ('pendiente', 'error')
         order by fecha, abierta_en`,
      );
    },
```

por:

```ts
    /**
     * Jornadas que faltan por subir al portal: solo las **cerradas**.
     *
     * T-38 (D7): la abierta no viaja (`fuente-jornadas.ts`; el buzon es de solo
     * escritura hasta T-43), y contarla dejaba el menu en "1 registro por subir"
     * todo el dia y la alerta en "se subieron 0". Esta es la consulta que suma
     * `contarPendientesDeSubir`, asi que el filtro va aqui y no en la pantalla.
     *
     * Incluye las que quedaron en `error`: un rechazo puede deberse a un dato
     * que el portal corrigio despues (un vehiculo que estaba de baja, por
     * ejemplo), asi que se vuelve a intentar. Reintentar es seguro porque el
     * `push` es idempotente: la clave es el `id` de la fila, que no cambia.
     */
    pendientesDeSincronizar(): Jornada[] {
      return bd.getAllSync<Jornada>(
        `select * from jornada
         where estado = 'cerrada'
           and sync_estado in ('pendiente', 'error')
         order by fecha, abierta_en`,
      );
    },
```

- [ ] **Paso 4: El filtro de la fuente se queda, con su porqué**

En `apps/tablet/src/sincronizacion/fuente-jornadas.ts`, reemplazar:

```ts
      return jornadas
        .pendientesDeSincronizar()
        .filter((j) => j.estado === 'cerrada')
```

por:

```ts
      return jornadas
        .pendientesDeSincronizar()
        // Redundante desde T-38: `pendientesDeSincronizar()` ya solo devuelve
        // cerradas. Se queda como segunda llave: subir una abierta congelaria su
        // km inicial en el buzon y el final no llegaria nunca.
        .filter((j) => j.estado === 'cerrada')
```

- [ ] **Paso 5: Ver que pasan, y toda la suite**

Run:
```bash
npm test --workspace=apps/tablet -- jornadas.spec pendientes.spec motor.spec fuente-jornadas.spec
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
```
Expected: todo en verde; `fuente-jornadas.spec.ts` sin cambios y en verde; total = línea base + 2.

- [ ] **Paso 6: Commit**

```bash
git add apps/tablet/src/datos/repositorios/jornadas.ts apps/tablet/src/datos/repositorios/jornadas.spec.ts \
  apps/tablet/src/sincronizacion/pendientes.spec.ts apps/tablet/src/sincronizacion/motor.spec.ts \
  apps/tablet/src/sincronizacion/fuente-jornadas.ts
git commit -m "T-38: tablet — la jornada abierta deja de contar como registro por subir

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 6: Tablet D6 capa 3 — candado en `ventas`, `cobranzas` y `prospectos.registrar`

**Implementador:** `sonnet` · **Revisor:** `sonnet`

**Archivos:**
- Modificar: `apps/tablet/src/datos/repositorios/jornadas.ts`
- Modificar: `apps/tablet/src/datos/repositorios/ventas.ts`
- Modificar: `apps/tablet/src/datos/repositorios/cobranzas.ts`
- Modificar: `apps/tablet/src/datos/repositorios/prospectos.ts`
- Crear: `apps/tablet/src/datos/repositorios/candado-jornada.spec.ts`
- Modificar: `apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx`
- Modificar: `apps/tablet/app/(jornada)/operacion/[clienteId]/cobranza.tsx`
- Modificar: `apps/tablet/app/(jornada)/prospectos.tsx`

**Interfaces:**
- Consume: Tarea 5 (nada de firma; solo el orden de `pendientes.spec.ts`).
- Produce (en `src/datos/repositorios/jornadas.ts`):
  - `export const MENSAJE_DIA_CERRADO = 'El día ya está cerrado. No se pueden registrar operaciones hasta la
    siguiente jornada.'`
  - `export function exigirJornadaAbierta(deps: Pick<DepsRepositorio, 'bd' | 'reloj'>, vendedorId: string):
    void` — lanza `ErrorJornada(MENSAJE_DIA_CERRADO)` si la jornada **de hoy** de ese vendedor existe y está
    `cerrada`. Sin jornada, o con la de hoy abierta, no hace nada.

**Mecanismo elegido (el menos invasivo):** los tres repositorios ya reciben `{ bd, reloj, generarId }`
(`DepsRepositorio`, `src/datos/repositorios/deps.ts`) y ninguno recibe el repositorio de jornadas. En vez de
inyectarles `jornadas` (cambiaría las tres firmas `crearRepositorioX(deps, {…})`, `inicializar.ts` y todas sus
pruebas), una función libre en `jornadas.ts` lee la tabla `jornada` con el mismo `bd` y `reloj.hoy()` que usa
`jornadas.deHoy()`. Cada `registrar` la llama **en su primera línea**: antes que cualquier otra validación (el
vendedor ve el motivo real, no "este cliente ya no está en el catálogo") y antes de abrir la transacción o
emitir folio (no se quema un número). JavaScript es síncrono y la capa de datos también, así que entre la
comprobación y la transacción no se cuela nada.

**Por qué sin jornada no bloquea:** el spec pide el candado "cuando la jornada de hoy del vendedor está
`cerrada`", no cuando falta. Sin jornada, el guardia de `app/(jornada)/_layout.tsx` ya no deja entrar a las
pantallas, y las suites de `ventas.spec.ts`, `cobranzas.spec.ts` y `prospectos.spec.ts` registran sin abrir día:
exigir jornada abierta las rompería sin proteger nada nuevo.

**Lo que el spec da por hecho y no es cierto:** "las pantallas ya muestran `e.message` de los errores de
dominio" — cada pantalla solo muestra el de **su** clase (`venta.tsx`: `ErrorVenta || ErrorFolio`;
`cobranza.tsx`: `ErrorCobranza`; `prospectos.tsx`: `ErrorProspecto`). Un `ErrorJornada` caería al mensaje
genérico. Por eso esta tarea agrega `|| e instanceof ErrorJornada` en las tres (Paso 6). Ver *Conflictos*,
punto 3.

- [ ] **Paso 1: Pruebas (fallan)**

Crear `apps/tablet/src/datos/repositorios/candado-jornada.spec.ts`:

```ts
import { depsDePrueba, MOMENTO, snapshotDePrueba } from '../pruebas-apoyo';
import { relojFijo } from '../reloj';
import { crearRepositorioCatalogos } from './catalogos';
import { crearRepositorioCobranzas, type DatosRegistroCobranza } from './cobranzas';
import type { DepsRepositorio } from './deps';
import { crearRepositorioFolios } from './folios';
import {
  crearRepositorioJornadas,
  ErrorJornada,
  exigirJornadaAbierta,
  MENSAJE_DIA_CERRADO,
} from './jornadas';
import { crearRepositorioProspectos, type DatosRegistroProspecto } from './prospectos';
import { crearRepositorioVentas, type DatosRegistroVenta } from './ventas';

/**
 * T-38, D6 capa 3: cerrar el dia cierra las operaciones en la CAPA DE DATOS.
 *
 * Es el candado que vale aunque alguien llegue a una pantalla de captura por
 * una ruta profunda: la confirmacion y el menu deshabilitado (capas 1 y 2) son
 * de la interfaz y se pueden saltar; esto no.
 */

function montar(deps: DepsRepositorio = depsDePrueba()) {
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const folios = crearRepositorioFolios(deps);
  return {
    deps,
    jornadas: crearRepositorioJornadas(deps),
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
    cobranzas: crearRepositorioCobranzas(deps, { catalogos }),
    prospectos: crearRepositorioProspectos(deps, { catalogos }),
  };
}

const venta: DatosRegistroVenta = {
  vendedorId: 'ven-1',
  clienteId: 'cli-1',
  numNota: '1234',
  contadoCredito: 'credito',
  factura: 'N/A',
  comentarios: null,
  lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
};

const cobro: DatosRegistroCobranza = {
  vendedorId: 'ven-1',
  clienteId: 'cli-1',
  ventaNotaId: 'nota-1',
  montoCentavos: 5000,
  metodoPago: 'efectivo',
  fechaPago: '2026-08-07',
};

const prospecto: DatosRegistroProspecto = {
  vendedorId: 'ven-1',
  sucursalId: 'suc-tj',
  nombre: 'Tacos Aaron',
  telefono: '6641112233',
  encargado: 'Don Aaron',
  tipoNegocioId: null,
  comentarios: null,
  lat: null,
  lng: null,
};

const cuantas = (
  deps: DepsRepositorio,
  tabla: 'venta' | 'cobranza' | 'prospecto' | 'folio_emitido',
) => deps.bd.getFirstSync<{ n: number }>(`select count(*) as n from ${tabla}`)?.n;

/** Abre y cierra el dia de hoy de `ven-1`. */
function cerrarElDia(jornadas: ReturnType<typeof crearRepositorioJornadas>) {
  const j = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 100 });
  jornadas.cerrar(j.id, 180);
}

describe('candado del dia cerrado (T-38, D6 capa 3)', () => {
  it('con la jornada abierta se registra venta, cobranza y prospecto', () => {
    const m = montar();
    m.jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 100 });

    expect(() => m.ventas.registrar(venta)).not.toThrow();
    expect(() => m.cobranzas.registrar(cobro)).not.toThrow();
    expect(() => m.prospectos.registrar(prospecto)).not.toThrow();
  });

  it('sin jornada no bloquea: el guardia de navegacion ya exige abrir el dia', () => {
    const m = montar();

    expect(() => m.ventas.registrar(venta)).not.toThrow();
    expect(() => m.cobranzas.registrar(cobro)).not.toThrow();
    expect(() => m.prospectos.registrar(prospecto)).not.toThrow();
  });

  it('con el dia cerrado, una venta lanza ErrorJornada y no graba ni quema folio', () => {
    const m = montar();
    cerrarElDia(m.jornadas);

    expect(() => m.ventas.registrar(venta)).toThrow(ErrorJornada);
    expect(() => m.ventas.registrar(venta)).toThrow(MENSAJE_DIA_CERRADO);
    expect(cuantas(m.deps, 'venta')).toBe(0);
    expect(cuantas(m.deps, 'folio_emitido')).toBe(0);
  });

  it('con el dia cerrado, una cobranza lanza ErrorJornada y no graba', () => {
    const m = montar();
    cerrarElDia(m.jornadas);

    expect(() => m.cobranzas.registrar(cobro)).toThrow(MENSAJE_DIA_CERRADO);
    expect(cuantas(m.deps, 'cobranza')).toBe(0);
  });

  it('con el dia cerrado, un prospecto lanza ErrorJornada y no graba', () => {
    const m = montar();
    cerrarElDia(m.jornadas);

    expect(() => m.prospectos.registrar(prospecto)).toThrow(MENSAJE_DIA_CERRADO);
    expect(cuantas(m.deps, 'prospecto')).toBe(0);
  });

  it('el candado gana a las demas validaciones: el vendedor ve el motivo real', () => {
    const m = montar();
    cerrarElDia(m.jornadas);

    // Un cliente que no existe daria "ya no está en el catálogo"; con el dia
    // cerrado, lo que el vendedor tiene que leer es que el dia esta cerrado.
    expect(() => m.ventas.registrar({ ...venta, clienteId: 'cli-fantasma' })).toThrow(
      MENSAJE_DIA_CERRADO,
    );
  });

  it('la jornada cerrada de AYER no bloquea hoy', () => {
    const ayer = montar(depsDePrueba('2026-08-06T15:00:00.000Z'));
    cerrarElDia(ayer.jornadas);

    // Misma base, reloj de hoy (MOMENTO = 2026-08-07).
    const hoy = montar({ ...ayer.deps, reloj: relojFijo(MOMENTO) });

    expect(() => hoy.ventas.registrar(venta)).not.toThrow();
  });

  it('la jornada cerrada de OTRO vendedor no bloquea a este', () => {
    const m = montar();
    const ajena = m.jornadas.abrir({ vendedorId: 'ven-2', vehiculoId: 'veh-1', kmInicial: 5 });
    m.jornadas.cerrar(ajena.id, 9);

    expect(() => exigirJornadaAbierta(m.deps, 'ven-1')).not.toThrow();
    expect(() => exigirJornadaAbierta(m.deps, 'ven-2')).toThrow(ErrorJornada);
  });
});
```

Nota para el implementador: `montar({ ...ayer.deps, reloj: relojFijo(MOMENTO) })` vuelve a guardar el snapshot
de catálogos sobre la misma base; `guardarSnapshot` es upsert (así lo usa `catalogos.spec.ts` "refrescar
catalogos con la jornada abierta no rompe la llave foranea"), así que no choca.

- [ ] **Paso 2: Ver que falla**

Run: `npm test --workspace=apps/tablet -- candado-jornada`
Expected: FAIL (`exigirJornadaAbierta` y `MENSAJE_DIA_CERRADO` no existen).

- [ ] **Paso 3: El candado en `jornadas.ts`**

En `apps/tablet/src/datos/repositorios/jornadas.ts`, inmediatamente después de la clase `ErrorJornada` (es decir,
después de su llave de cierre `}` y antes de `export interface DatosAperturaJornada`), agregar:

```ts

/** El mensaje del candado del dia cerrado (T-38, D6). Lo comparten los tres repositorios y sus pruebas. */
export const MENSAJE_DIA_CERRADO =
  'El día ya está cerrado. No se pueden registrar operaciones hasta la siguiente jornada.';

/**
 * Candado de la capa de datos (T-38, D6 capa 3): con la jornada de HOY del
 * vendedor cerrada no se registra venta, cobranza ni prospecto. No hay reabrir.
 *
 * Es una funcion libre y no un metodo del repositorio a proposito: los tres
 * repositorios ya reciben `bd` y `reloj`, y pedirles el repositorio de jornadas
 * cambiaria sus firmas, `inicializar.ts` y todas sus pruebas por una consulta.
 * Lee lo mismo que `deHoy()`: vendedor y `reloj.hoy()` (fecha local).
 *
 * Sin jornada **no** lanza: el spec pide el candado con el dia cerrado, y sin
 * jornada el guardia de `(jornada)/_layout.tsx` ya no deja entrar a capturar.
 *
 * @throws {ErrorJornada} si la jornada de hoy existe y esta cerrada.
 */
export function exigirJornadaAbierta(
  { bd, reloj }: Pick<DepsRepositorio, 'bd' | 'reloj'>,
  vendedorId: string,
): void {
  const jornada = bd.getFirstSync<{ estado: string }>(
    'select estado from jornada where vendedor_id = $vendedor_id and fecha = $fecha',
    { $vendedor_id: vendedorId, $fecha: reloj.hoy() },
  );
  if (jornada?.estado === 'cerrada') {
    throw new ErrorJornada(MENSAJE_DIA_CERRADO);
  }
}
```

- [ ] **Paso 4: Los tres `registrar` lo llaman primero**

4a. `apps/tablet/src/datos/repositorios/ventas.ts`:
- agregar el import `import { exigirJornadaAbierta } from './jornadas';` (después de
  `import type { RepositorioFolios } from './folios';`);
- en el comentario de `registrar`, después de la línea ` * @throws {ErrorFolio} si el vendedor no tiene segmento o
  llego al tope del dia.`, agregar la línea ` * @throws {ErrorJornada} si el dia de hoy ya esta cerrado (T-38, D6).`;
- reemplazar

```ts
    registrar(datos: DatosRegistroVenta): Venta {
      const fecha = reloj.hoy();
```

por

```ts
    registrar(datos: DatosRegistroVenta): Venta {
      // T-38 (D6): primero el candado, antes de validar nada o emitir folio.
      exigirJornadaAbierta({ bd, reloj }, datos.vendedorId);

      const fecha = reloj.hoy();
```

4b. `apps/tablet/src/datos/repositorios/cobranzas.ts`:
- agregar `import { exigirJornadaAbierta } from './jornadas';` (después de `import { enTransaccion } from './deps';`);
- en el comentario de `registrar`, después de ` * @throws {ErrorCobranza} si la captura no se puede grabar.`,
  agregar ` * @throws {ErrorJornada} si el dia de hoy ya esta cerrado (T-38, D6).`;
- reemplazar

```ts
    registrar(datos: DatosRegistroCobranza): Cobranza {
      const hoy = reloj.hoy();
```

por

```ts
    registrar(datos: DatosRegistroCobranza): Cobranza {
      // T-38 (D6): primero el candado, antes de validar nada.
      exigirJornadaAbierta({ bd, reloj }, datos.vendedorId);

      const hoy = reloj.hoy();
```

4c. `apps/tablet/src/datos/repositorios/prospectos.ts`:
- agregar `import { exigirJornadaAbierta } from './jornadas';` (después de
  `import type { DepsRepositorio } from './deps';`);
- en el comentario de `registrar`, después de ` * @throws {ErrorProspecto} si la captura no se puede grabar.`,
  agregar ` * @throws {ErrorJornada} si el dia de hoy ya esta cerrado (T-38, D6).`;
- reemplazar

```ts
    registrar(datos: DatosRegistroProspecto): Prospecto {
      const nombre = recortar(datos.nombre);
```

por

```ts
    registrar(datos: DatosRegistroProspecto): Prospecto {
      // T-38 (D6): primero el candado, antes de validar nada.
      exigirJornadaAbierta({ bd, reloj }, datos.vendedorId);

      const nombre = recortar(datos.nombre);
```

(`prospectos.ts` ya desestructura `{ bd, reloj, generarId }` en `crearRepositorioProspectos`; si `reloj` no
estuviera en esa desestructuración, agrégalo.)

- [ ] **Paso 5: Ver que pasa, y toda la suite de la tablet**

Run:
```bash
npm test --workspace=apps/tablet -- candado-jornada
npm test --workspace=apps/tablet
```
Expected: PASS; el resto como después de la Tarea 5 (en particular `pendientes.spec.ts`, que cierra la jornada
**después** de registrar, y `ventas.spec.ts`/`cobranzas.spec.ts`/`prospectos.spec.ts`, que no abren jornada).

- [ ] **Paso 6: Las pantallas muestran el motivo del candado**

6a. `apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx`: en el `import { … } from '@/datos';` del
principio, agregar `ErrorJornada,` después de `ErrorFolio,`. Reemplazar:

```tsx
        e instanceof ErrorVenta || e instanceof ErrorFolio
```

por:

```tsx
        e instanceof ErrorVenta || e instanceof ErrorFolio || e instanceof ErrorJornada
```

6b. `apps/tablet/app/(jornada)/operacion/[clienteId]/cobranza.tsx`: en el `import { … } from '@/datos';`, agregar
`ErrorJornada,` después de `ErrorCobranza,`. Reemplazar:

```tsx
        e instanceof ErrorCobranza
          ? e.message
```

por:

```tsx
        e instanceof ErrorCobranza || e instanceof ErrorJornada
          ? e.message
```

6c. `apps/tablet/app/(jornada)/prospectos.tsx`: reemplazar `import { ErrorProspecto } from '@/datos';` por
`import { ErrorJornada, ErrorProspecto } from '@/datos';` y

```tsx
        e instanceof ErrorProspecto ? e.message : 'No se pudo guardar el prospecto.',
```

por:

```tsx
        e instanceof ErrorProspecto || e instanceof ErrorJornada
          ? e.message
          : 'No se pudo guardar el prospecto.',
```

(`ErrorJornada` ya lo exporta `src/datos/index.ts`.)

- [ ] **Paso 7: Typecheck y lint**

Run:
```bash
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
```
Expected: sin errores.

- [ ] **Paso 8: Commit**

```bash
git add apps/tablet/src/datos/repositorios/jornadas.ts apps/tablet/src/datos/repositorios/ventas.ts \
  apps/tablet/src/datos/repositorios/cobranzas.ts apps/tablet/src/datos/repositorios/prospectos.ts \
  apps/tablet/src/datos/repositorios/candado-jornada.spec.ts \
  "apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx" \
  "apps/tablet/app/(jornada)/operacion/[clienteId]/cobranza.tsx" \
  "apps/tablet/app/(jornada)/prospectos.tsx"
git commit -m "T-38: tablet — con el dia cerrado no se registra venta, cobranza ni prospecto

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 7: Tablet D6 capas 1 y 2 — confirmación al cerrar y menú con el día cerrado

**Implementador:** `sonnet` · **Revisor:** `sonnet`

**Archivos:**
- Crear: `apps/tablet/src/estado/menu-jornada.ts`
- Crear: `apps/tablet/src/estado/menu-jornada.spec.ts`
- Modificar: `apps/tablet/src/ui/boton-menu.tsx`
- Modificar: `apps/tablet/app/(jornada)/index.tsx`
- Modificar: `apps/tablet/app/(jornada)/cerrar-dia.tsx`

**Interfaces:**
- Consume: `Jornada` de `@/datos/tipos` (ya existe: `estado: 'abierta' | 'cerrada'`, `km_final: number | null`).
- Produce:
  - `estadoMenuJornada(jornada: Pick<Jornada, 'estado' | 'km_final'> | null): EstadoMenuJornada` con
    `EstadoMenuJornada { operacionesHabilitadas: boolean; avisoDiaCerrado: string | null }`.
  - `textoConfirmarCierre(kmFinal: number): string`.
  - `BotonMenu` gana `deshabilitado?: boolean` (default `false`).

**Pruebas de pantalla:** no existen en la tablet. `jest.config.js` tiene `roots: ['<rootDir>/src']` y `testMatch:
['**/*.spec.ts']` (sin `.tsx`, sin `app/`), y el README lo dice ("No hay pruebas de componentes ni de
navegacion"). Por eso la decisión del menú y los dos textos del spec se extraen a una función pura en `src/` y
se prueban ahí; el resto se verifica con `typecheck` + `lint`.

- [ ] **Paso 1: Prueba de la función pura (falla)**

Crear `apps/tablet/src/estado/menu-jornada.spec.ts`:

```ts
import { estadoMenuJornada, textoConfirmarCierre } from './menu-jornada';

describe('estadoMenuJornada (T-38, D6 capa 2)', () => {
  it('con la jornada abierta todo esta habilitado y no hay aviso', () => {
    expect(estadoMenuJornada({ estado: 'abierta', km_final: null })).toEqual({
      operacionesHabilitadas: true,
      avisoDiaCerrado: null,
    });
  });

  it('sin jornada no deshabilita nada: el guardia de navegacion ya redirige', () => {
    expect(estadoMenuJornada(null)).toEqual({
      operacionesHabilitadas: true,
      avisoDiaCerrado: null,
    });
  });

  it('con la jornada cerrada se deshabilitan las operaciones y aparece el aviso con el km final', () => {
    expect(estadoMenuJornada({ estado: 'cerrada', km_final: 128512 })).toEqual({
      operacionesHabilitadas: false,
      avisoDiaCerrado:
        'Día cerrado · km final 128512 · lo capturado sube con «Sincronizar ahora»',
    });
  });

  it('el km final con decimal se muestra tal cual', () => {
    expect(estadoMenuJornada({ estado: 'cerrada', km_final: 128712.5 }).avisoDiaCerrado).toContain(
      'km final 128712.5',
    );
  });
});

describe('textoConfirmarCierre (T-38, D6 capa 1)', () => {
  it('advierte que despues no se podra operar y repite el km final', () => {
    expect(textoConfirmarCierre(128512)).toBe(
      'Después de cerrar el día ya no podrás vender, cobrar ni registrar prospectos en esta tablet. ¿Cerrar el día con km final 128512?',
    );
  });
});
```

Run: `npm test --workspace=apps/tablet -- menu-jornada`
Expected: FAIL (`Cannot find module './menu-jornada'`).

- [ ] **Paso 2: `src/estado/menu-jornada.ts`**

```ts
import type { Jornada } from '@/datos/tipos';

/**
 * Lo que el menu de la jornada muestra segun el estado del dia (T-38, D6).
 *
 * Puro y fuera de la pantalla a proposito: la tablet no tiene pruebas de
 * componentes (ver `jest.config.js`), y esta es la decision que vale la pena
 * fijar con una prueba.
 */
export interface EstadoMenuJornada {
  /** *Operación por cliente*, *Prospectos* y *Ruta y GPS*. */
  operacionesHabilitadas: boolean;
  /** Texto de la tarjeta "Día cerrado", o `null` si el día sigue abierto. */
  avisoDiaCerrado: string | null;
}

/**
 * Con la jornada cerrada, las secciones que capturan quedan deshabilitadas: no
 * hay reabrir, y la capa de datos las rechazaria de todos modos
 * (`exigirJornadaAbierta`). *Cerrar el día* y *Sincronizar ahora* no se tocan:
 * el resumen se sigue viendo y lo capturado tiene que poder subir.
 */
export function estadoMenuJornada(
  jornada: Pick<Jornada, 'estado' | 'km_final'> | null,
): EstadoMenuJornada {
  if (jornada?.estado !== 'cerrada') {
    return { operacionesHabilitadas: true, avisoDiaCerrado: null };
  }
  return {
    operacionesHabilitadas: false,
    avisoDiaCerrado: `Día cerrado · km final ${jornada.km_final ?? 0} · lo capturado sube con «Sincronizar ahora»`,
  };
}

/** El texto de la confirmación antes de cerrar el día (D6 capa 1). */
export function textoConfirmarCierre(kmFinal: number): string {
  return `Después de cerrar el día ya no podrás vender, cobrar ni registrar prospectos en esta tablet. ¿Cerrar el día con km final ${kmFinal}?`;
}
```

Run: `npm test --workspace=apps/tablet -- menu-jornada`
Expected: PASS (5 pruebas).

- [ ] **Paso 3: `BotonMenu` admite `deshabilitado`**

En `apps/tablet/src/ui/boton-menu.tsx` (el archivo usa comillas dobles; respétalas):

3a. Reemplazar la desestructuración y el tipo de props:

```tsx
export function BotonMenu({
  titulo,
  descripcion,
  destino,
  nota,
  destacada = false,
}: {
  titulo: string;
  descripcion: string;
  destino: Href;
  /** Aviso corto que se pinta en el tono de accion. */
  nota?: string;
  /** La accion que la jornada espera ahora mismo. */
  destacada?: boolean;
}) {
```

por:

```tsx
export function BotonMenu({
  titulo,
  descripcion,
  destino,
  nota,
  destacada = false,
  deshabilitado = false,
}: {
  titulo: string;
  descripcion: string;
  destino: Href;
  /** Aviso corto que se pinta en el tono de accion. */
  nota?: string;
  /** La accion que la jornada espera ahora mismo. */
  destacada?: boolean;
  /**
   * La seccion no esta disponible ahora (T-38: el dia ya se cerro). No navega y
   * se atenua igual que un `Boton` inactivo (opacidad 0.35).
   */
  deshabilitado?: boolean;
}) {
```

3b. Reemplazar la apertura del `Pressable` hasta el cierre de su `style`:

```tsx
    <Pressable
      onPress={() => router.push(destino)}
      accessibilityRole="link"
      accessibilityLabel={`${titulo}. ${descripcion}`}
      style={({ pressed }) => [
        estilos.tarjeta,
        estilos.celdaRejilla,
        {
          borderWidth: grosor.fuerte,
          borderColor: destacada ? colores.primario : colores.bordeFuerte,
          minHeight: Math.max(dispositivo.tactil + espacio.xl, 104),
        },
        destacada && { backgroundColor: colores.primarioTenue },
        pressed && { transform: [{ translateY: grosor.fuerte }], opacity: 0.9 },
      ]}
    >
```

por:

```tsx
    <Pressable
      onPress={() => {
        if (!deshabilitado) router.push(destino);
      }}
      disabled={deshabilitado}
      accessibilityRole="link"
      accessibilityLabel={`${titulo}. ${descripcion}`}
      accessibilityState={{ disabled: deshabilitado }}
      style={({ pressed }) => [
        estilos.tarjeta,
        estilos.celdaRejilla,
        {
          borderWidth: grosor.fuerte,
          borderColor: destacada ? colores.primario : colores.bordeFuerte,
          minHeight: Math.max(dispositivo.tactil + espacio.xl, 104),
        },
        destacada && { backgroundColor: colores.primarioTenue },
        pressed && !deshabilitado && { transform: [{ translateY: grosor.fuerte }], opacity: 0.9 },
        // Mismo valor que `Boton` inactivo: al sol, menos que esto no se nota.
        deshabilitado && { opacity: 0.35 },
      ]}
    >
```

- [ ] **Paso 4: El menú (`app/(jornada)/index.tsx`)**

4a. Agregar el import `import { estadoMenuJornada } from '@/estado/menu-jornada';` después de
`import { useSesion } from '@/estado/proveedor-sesion';`.

4b. Después de la línea `const estadoSync = falloUltima ? 'error' : pendientes > 0 ? 'pendiente' : 'listo';`,
agregar:

```tsx

  // T-38 (D6 capa 2): con el dia cerrado, lo que captura queda deshabilitado.
  // La capa de datos lo rechazaria igual (`exigirJornadaAbierta`); esto evita
  // que el vendedor entre a capturar para enterarse al final.
  const menu = estadoMenuJornada(jornada);
```

4c. Reemplazar las tres primeras `BotonMenu` y abrir el aviso después de la rejilla:

```tsx
        <BotonMenu
          titulo="Operación por cliente"
          descripcion="Venta, cobranza, visita sin venta y registros de campo"
          destino="/(jornada)/operacion"
        />
        <BotonMenu
          titulo="Prospectos"
          descripcion="Alta de prospectos (el vendedor ya no da de alta clientes)"
          destino="/(jornada)/prospectos"
        />
        <BotonMenu
          titulo="Ruta y GPS"
          descripcion="Mapa de clientes del día y orden real de la ruta"
          destino="/(jornada)/ruta"
        />
```

por:

```tsx
        <BotonMenu
          titulo="Operación por cliente"
          descripcion="Venta, cobranza, visita sin venta y registros de campo"
          destino="/(jornada)/operacion"
          deshabilitado={!menu.operacionesHabilitadas}
        />
        <BotonMenu
          titulo="Prospectos"
          descripcion="Alta de prospectos (el vendedor ya no da de alta clientes)"
          destino="/(jornada)/prospectos"
          deshabilitado={!menu.operacionesHabilitadas}
        />
        <BotonMenu
          titulo="Ruta y GPS"
          descripcion="Mapa de clientes del día y orden real de la ruta"
          destino="/(jornada)/ruta"
          deshabilitado={!menu.operacionesHabilitadas}
        />
```

y reemplazar:

```tsx
      </View>

      <Tarjeta estado={estadoSync} etiqueta="Sincronización">
```

por:

```tsx
      </View>

      {menu.avisoDiaCerrado ? (
        <Tarjeta estado="listo" etiqueta="Día cerrado">
          <Text style={estilos.textoTarjeta}>{menu.avisoDiaCerrado}</Text>
        </Tarjeta>
      ) : null}

      <Tarjeta estado={estadoSync} etiqueta="Sincronización">
```

(*Cerrar el día* no se toca: sigue navegable y muestra el resumen. *Sincronizar ahora* tampoco.)

- [ ] **Paso 5: La confirmación (`app/(jornada)/cerrar-dia.tsx`)**

5a. Reemplazar `import { Text } from 'react-native';` por `import { Alert, Text } from 'react-native';` y agregar
`import { textoConfirmarCierre } from '@/estado/menu-jornada';` después de
`import { useJawa } from '@/estado/proveedor-jawa';`.

5b. Después de la función `cerrar()` (después de su llave de cierre, antes de
`if (jornada?.estado === 'cerrada') {`), agregar:

```tsx

  /**
   * T-38 (D6 capa 1): cerrar el dia cierra las operaciones de esta tablet y no
   * hay reabrir, asi que se confirma antes, como `confirmarSalida` en el menu.
   * El kilometraje lo sigue validando `jornadas.cerrar()`: si es menor al
   * inicial, el error aparece despues de confirmar, igual que antes.
   */
  function confirmarCierre() {
    setError(null);
    if (!jornada) return;
    Alert.alert('Cerrar el día', textoConfirmarCierre(kmNumero), [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar el día', style: 'destructive', onPress: cerrar },
    ]);
  }
```

5c. En el `Boton` del formulario, reemplazar `onPress={cerrar}` por `onPress={confirmarCierre}`.

- [ ] **Paso 6: Verificación**

Run:
```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
```
Expected: todo en verde; total = después de la Tarea 6 + 5.

Si el controlador tiene el emulador levantado **en este worktree** (nunca en `proyecto-sinmex`), una pasada a mano:
abrir el día → cerrar con un km → aparece la confirmación con el texto del spec → *Cancelar* no cierra →
*Cerrar el día* cierra → en el menú, las tres tarjetas atenuadas y sin navegar, la tarjeta "Día cerrado",
*Cerrar el día* y *Sincronizar ahora* funcionan. Si no hay emulador, se omite y se dice en el reporte.

- [ ] **Paso 7: Commit**

```bash
git add apps/tablet/src/estado/menu-jornada.ts apps/tablet/src/estado/menu-jornada.spec.ts \
  apps/tablet/src/ui/boton-menu.tsx "apps/tablet/app/(jornada)/index.tsx" "apps/tablet/app/(jornada)/cerrar-dia.tsx"
git commit -m "T-38: tablet — confirmar antes de cerrar el dia y menu con el dia cerrado

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 8: Cierre — documentación y verificación completa

**Implementador:** `sonnet` · **Revisor:** el controlador (después viene la revisión final de la rama, `opus`)

**Archivos:**
- Modificar: `apps/tablet/README.md`
- Modificar: `CLAUDE.md` (raíz del repo)
- **No** toca el vault de Obsidian (eso lo hace el controlador).

**Interfaces:** ninguna nueva.

Lo que el planificador comprobó: ni `apps/tablet/README.md` ni `apps/backend` (no tiene README propio) nombran a
`jornada` como "sin módulo"; eso solo estaba en `docs/contrato-sincronizacion.md`, que ya actualizó la Tarea 2.
El README de la tablet sí dice cosas viejas de la jornada y no menciona el cierre; `CLAUDE.md` lleva una viñeta
por regla que "se rompe en silencio" (como la de T-21).

- [ ] **Paso 1: `apps/tablet/README.md`**

Inmediatamente antes de la línea `## Pruebas`, insertar:

```markdown
## Jornada: cerrar el día cierra las operaciones (T-38)

- **Cerrar el día no tiene vuelta atrás.** `cerrar-dia.tsx` pide confirmación; con la jornada de hoy `cerrada`,
  el menú deshabilita *Operación por cliente*, *Prospectos* y *Ruta y GPS* (`src/estado/menu-jornada.ts`) y
  `ventas`/`cobranzas`/`prospectos.registrar` lanzan `ErrorJornada` (`exigirJornadaAbierta` en
  `src/datos/repositorios/jornadas.ts`). El candado de datos es el que vale: las pantallas se pueden saltar.
- **El contador de "registros por subir" cuenta solo lo que viaja.** La jornada abierta no se sube (el buzón
  del servidor es de solo escritura hasta T-43), así que `jornadas.pendientesDeSincronizar()` solo devuelve
  cerradas.
- En el servidor la jornada cerrada se guarda en la tabla `jornada` (`rutas/jornadas.service.ts`). Si el
  servidor la rechaza (`vehiculo-inexistente`, `jornada-duplicada`, …), la fila queda en `error` con el motivo
  y se reintenta en cada sincronización.

```

- [ ] **Paso 2: `CLAUDE.md`**

Después de la última sub-viñeta de **"Cobranza desde el portal (T-21)"** (la que termina en "Por eso la vista
previa.") y antes de la línea que empieza con `` `npm run supabase -- migration up --local` aplica migraciones``,
insertar:

```markdown
- **Jornada y kilometraje (T-38).** La jornada cerrada que sube la tablet (`tipo: 'jornada'`) se proyecta a la
  tabla `jornada` con `rutas/jornadas.service.ts` (`cerrarJornada`), dentro de la transacción de la operación.
  - Una **viva** por vendedor y día (`uq_jornada_vendedor_fecha`, parcial); el insert usa `on conflict … where
    deleted_at is null do nothing` y, si no insertó, rechaza `jornada-duplicada` (la misma clave es `duplicada`
    antes de llegar ahí).
  - El vehículo tiene que ser de la sucursal del vendedor del token y no estar dado de baja (`deleted_at`). Uno
    **desactivado** (`activo = false`) sí entra: el kilometraje se recorrió.
  - Forma y `km_final >= km_inicial` se validan **antes** de la transacción (`rutas/datos-jornada.ts`,
    `sincronizacion/despacho-jornada.ts`): `jornada-datos-invalidos`, `jornada-km-invalido`.
  - Solo jornadas **cerradas** hasta T-43. Las que llegaron antes de T-38 siguen en el buzón sin proyectar (sin
    backfill). El reporte de Kilometraje del portal todavía no existe.
  - En la tablet, con la jornada de hoy cerrada **no se registra** venta, cobranza ni prospecto
    (`exigirJornadaAbierta`); no hay reabrir.
```

- [ ] **Paso 3: Verificación completa de la rama**

Run:
```bash
npm run supabase -- migration up --local
npm run supabase -- test db --local
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
git status
git log --oneline origin/main..HEAD | head -20
```
Expected: todo en verde contra la línea base de la Tarea 1 (anota los totales nuevos); `git status` limpio; ocho
commits `T-38: …` encima de lo que ya traía la rama.

- [ ] **Paso 4: Commit**

```bash
git add apps/tablet/README.md CLAUDE.md
git commit -m "T-38: documentacion — jornada en el servidor y candados del dia cerrado

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Paso 5: Notas para el PR (texto para el controlador; no abras el PR)**

Incluye en tu reporte final, para que el controlador las ponga en el PR:
- **D4, sin backfill:** las operaciones `jornada` aplicadas antes de esta rama siguen en `sync_operacion` con
  `entidad_id` nulo; reprocesarlas sería un script aparte. Consulta para contarlas (solo lectura, en local):
  `select count(*) from sync_operacion where tipo = 'jornada' and entidad_id is null;`
- **D5, siguiente paso:** el reporte de Kilometraje del portal (`GET` por sucursal y rango) lee `jornada`
  (`idx_jornada_sucursal_fecha`); es del lado del portal.
- La migración `20261010120000_jornada.sql` la empuja a `sinmex dev` quien mergea (Roberto).

---

## Autorrevisión del plan (hecha al escribirlo)

**Cobertura del spec:**
- E1 / D1 (tabla) → Tarea 1. D2 (forma antes de la transacción, proyección dentro, entidad del buzón, rechazada
  sin fila) → Tareas 3 y 4. D3 (cuatro códigos en los dos contratos y `docs/`, sin subir `CONTRATO_ACTUAL`) →
  Tarea 2 (+ uso en 3 y 4). D4 y D5 (sin backfill, sin endpoint) → nada que implementar; anotados en el PR
  (Tarea 8, Paso 5) y en `docs/` §6 y §9. D6 capa 3 → Tarea 6; capas 1 y 2 → Tarea 7. D7 → Tarea 5.
- E2 (vender con el día cerrado) → Tareas 6 y 7. E3 ("1 registro por subir") → Tarea 5.
- Casos e2e pedidos por el brief: jornada completa → fila + `entidad_tabla`/`entidad_id`; `km_final <
  km_inicial` → `jornada-km-invalido` sin fila; vehículo de otra sucursal → `vehiculo-inexistente`; segunda
  jornada mismo día otra clave → `jornada-duplicada`; misma clave → `duplicada`; sin `vehiculo_id` →
  `jornada-datos-invalidos` sin buzón. Todos en la Tarea 4, Paso 11, más dado de baja, inexistente y
  desactivado.

**Placeholders:** ninguno; cada paso de código trae el código.

**Consistencia de nombres:** `JornadaNormalizada` (`vehiculoId`, `kmInicial`, `kmFinal`, `abiertaEn`,
`cerradaEn`), `normalizarDatosJornada` → `{ falla: 'forma' | 'km' }`, `prepararJornada`,
`CODIGO_POR_RAZON_JORNADA`, `RazonRechazoJornada = 'vehiculo-inexistente' | 'jornada-duplicada'`,
`JornadasRepository.vehiculoDeLaSucursal` / `insertar` → `string | null`, `JornadasService.cerrarJornada` →
`EntidadJornada { tabla: 'jornada'; id }`, `ContextoJornada { sucursalId, vendedorId, fechaOperacion }`,
`exigirJornadaAbierta({ bd, reloj }, vendedorId)`, `MENSAJE_DIA_CERRADO`, `estadoMenuJornada`,
`textoConfirmarCierre`, `BotonMenu.deshabilitado` — usados igual en todas las tareas.

**Review Focus:** las cinco entradas tienen prueba en su tarea (4, 3, 3, 4, 6).

---

## Conflictos para el controlador

Ninguno cambia D1…D7; el plan sigue el spec en todos. Son premisas del spec o del brief que el código no
sostiene, y cómo se resolvieron:

1. **"Grants y RLS con el mismo patrón que `cobranza_abono` / `venta_nota`" (D1): ese patrón no existe.**
   `grep -i "row level security\|grant \|policy" supabase/migrations/*.sql` no devuelve nada; ninguna tabla del
   esquema tiene RLS ni grants (el backend entra con su propia conexión; `supabase/config.toml` deja la Data API
   sin exponer tablas nuevas, `auto_expose_new_tables` sin activar). La Tarea 1 copia lo que sí es patrón
   (auditoría, `trg_*_updated`, `ck_*`, índices parciales) y **no** agrega grants ni RLS. Si Mario o Roberto
   quieren RLS en `jornada`, sería la primera tabla con RLS del proyecto: decisión aparte.

2. **El helper `operacion()` del e2e no puede volverse "una jornada completa"** (sugerencia del brief). D1 pone
   un único `(vendedor_id, fecha)` sobre filas vivas, y las pruebas del buzón mandan varias operaciones
   genéricas el mismo día en un solo lote (3 en "reenviar EL MISMO lote", 47 en "con 3 malas de 50"): todas
   menos la primera serían `jornada-duplicada`. `operacion()` se usa en 21 pruebas (32 llamadas) como sobre
   genérico; 16 de esas pruebas, más "sube la operacion del dia" (jornada con datos parciales), dependen de que
   salga `aplicada`. Resolución (Tarea 4, Paso 10): el sobre genérico pasa a `tipo: 'gasto'` (sin módulo ni
   forma hasta T-27) y las 4 pruebas que hablan de la jornada usan `jornadaValida()` con un día propio por
   llamada; la que afirmaba "la jornada sigue entrando solo al buzón" se borra y la reemplaza el caso positivo.
   **Costo conocido:** cuando T-27 proyecte el gasto, el sobre genérico tendrá que mudarse otra vez.

3. **"Las pantallas ya muestran `e.message` de los errores de dominio" (D6 capa 3) no es cierto para
   `ErrorJornada`.** `venta.tsx` muestra el mensaje solo de `ErrorVenta | ErrorFolio`, `cobranza.tsx` de
   `ErrorCobranza`, `prospectos.tsx` de `ErrorProspecto`; un `ErrorJornada` caería al genérico ("No se pudo
   grabar la venta…"). Se mantiene D6 tal cual (lanzar `ErrorJornada`) y la Tarea 6, Paso 6, agrega
   `|| e instanceof ErrorJornada` en las tres pantallas.

4. **"Vehículo … dado de baja" (D3) frente a `activo = false`.** En este repo "baja" es `deleted_at` y
   "desactivar" es `activo = false` (comentario de `uq_vehiculo_nombre_sucursal`, T-11 D4: "desactivar un
   vehículo NO libera su nombre"). El plan rechaza solo `deleted_at` u otra sucursal y **acepta** un vehículo
   desactivado, con prueba e2e: la jornada ya ocurrió y rechazarla perdería kilometraje real (mismo criterio que
   T-20 D9 con la nota pagada). Si el controlador lee "dado de baja" como "inactivo", es una línea en
   `JornadasRepository.vehiculoDeLaSucursal` (`.where('activo', '=', true)`) y voltear la prueba
   "un vehículo desactivado SÍ entra".

5. **Detalle del spec (E1):** el `datos` citado como "lo que la tablet ya manda" trae `cliente_id: null`, pero la
   tablet no lo manda (`fuente-jornadas.ts` arma cinco campos); lo agrega el servidor al guardar en el buzón
   (`guardarOperacion`: `datos: JSON.stringify({ ...op.datos, cliente_id: op.clienteId })`). Sin efecto: el
   normalizador ignora campos extra, y `DatosJornada` no declara `cliente_id`.

6. **Orden de tareas:** la "T3" del brief se partió en Tareas 3 (puro, `haiku`) y 4 (cableado, revisor `opus`)
   porque agregar `jornada` a `Proyeccion` sin el `case` de `proyectar()` rompe la compilación del backend. El
   resto se corre un número (brief T4 → 5, T5 → 6, T6 → 7, T7 → 8).

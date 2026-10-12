# T-37 · Ruta del día y pantalla principal de la tablet — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la oficina arme la ruta diaria de cada vendedor en el portal, que esa ruta baje a la tablet en el
pull, que el vendedor la complemente con altas que suben como operación `ruta-alta`, y que la jornada de la
tablet abra en la ruta del día (barra, lista reordenable, burbuja de notas, visitado derivado, menú hamburguesa y
ficha del cliente ampliada).

**Architecture:** una migración aditiva sobre `ruta` (columna `origen`, unicidad parcial, índice) es la base
(D11). El contrato gana la colección `rutas` del pull, el tipo `ruta-alta` y tres códigos (D12, D13). El pull
lee `ruta` por vendedor y ventana de fechas; el push valida la forma de `ruta-alta` antes de la transacción y la
proyecta con `RutasDiariasService.agregarAlDia` dentro de ella (ADR-0009). El portal escribe por
`GET/PUT /rutas/diaria` con semántica de reemplazo que conserva lo del vendedor (D14). En la tablet, una tabla
local `ruta` la escribe el pull (con regla de fusión) y otra `ruta_orden_local` solo el dedo del vendedor (D15);
la pantalla principal es una función de esos datos, con la lógica en funciones puras de `src/estado/` (D16). El
portal sustituye su marcador de posición por dos columnas editables que guardan con un solo `PUT` (D17).

**Tech Stack:** NestJS 11 + Kysely 0.29 (backend), Postgres/Supabase local + pgTAP (base), Expo SDK 57 / React
Native 0.86 + SQLite + Jest con ts-jest en Node (tablet, solo TypeScript; sin pruebas de pantalla), Next.js 15 +
Vitest + Testing Library (portal).

**Spec:** `docs/superpowers/specs/2026-10-12-t-37-ruta-del-dia-y-pantalla-principal-design.md` — léelo antes de
empezar. Sus decisiones D1…D17 **no se renegocian**. Si este plan lo contradice, manda el spec: para y pregunta.
Lo que el planificador encontró en el código que choca con el spec, y cómo se resolvió, está al final en
*Conflictos para el controlador*.

---

## Global Constraints

Copiadas del spec (§ "Restricciones globales"), más las del repo y las de esta sesión. Cada tarea las incluye:

- Rama `feature/t-37-ruta-diaria`. Todos los comandos **desde la raíz del worktree**
  (`/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-t37`), con los scripts del workspace
  (`--workspace=apps/...`). **Nunca** entres a `../proyecto-sinmex` (clon de demo).
- Código en español, **identificadores sin acentos**, **mensajes al usuario con acentos**. Comentarios que
  explican *por qué*.
- Las respuestas de la API del **portal** van en **camelCase** (`vendedorId`, `clienteNombre`), como todo
  `apps/portal/src/lib/*.ts`. El **contrato de sincronización** sigue en snake_case (`cliente_id`, `fecha`), como
  el resto del cable de la tablet. Ver *Conflictos*, punto 1.
- Contrato **aditivo**: `CONTRATO_ACTUAL` se queda en **1**; los dos `contrato.ts`
  (`apps/backend/src/modules/sincronizacion/contrato.ts` y `apps/tablet/src/sincronizacion/contrato.ts`) y
  `docs/contrato-sincronizacion.md` cambian **en la misma tarea** (Tarea 2).
- ADR-0009: **una transacción por operación**; una rechazada **no deja fila** (ni buzón ni negocio);
  trazabilidad por `sync_operacion.entidad_tabla` / `entidad_id`.
- `fecha_operacion` la manda la tablet; **el servidor no la re-deriva de UTC**. `ruta.fecha` de un alta = esa
  fecha.
- Nada de `db reset`. Migración local **011** nueva; nunca se renumera ni se edita una publicada.
- Supabase local es **compartido entre sesiones**: `npm run supabase -- migration up --local` (siempre con
  `--`). pgTAP: `npm run supabase -- test db --local`. Tipos: `npm run db:types --workspace=apps/backend`, y
  comprobar que `schema.d.ts` cambia **solo** por lo de esta rama.
- **Nunca apuntar a `sinmex dev`** (la nube). `.env.test` va a `127.0.0.1:54322`. El push de la migración a la
  nube lo hace quien mergea (Roberto), con el pre-flight de `CLAUDE.md`.
- `npm run typecheck`, `lint` y `test` de backend, tablet y portal en verde; `npm run test:e2e
  --workspace=apps/backend` contra el Postgres local.
- Backend: `npm run lint --workspace=apps/backend` lleva `--fix` y reescribe archivos ajenos. **No lo uses.**
  Formatea solo tus archivos y revisa sin arreglar:
  `npm exec --workspace=apps/backend -- prettier --write <archivos relativos a apps/backend>` y
  `npm exec --workspace=apps/backend -- eslint <los mismos archivos>`. El "typecheck" del backend es
  `npm run build --workspace=apps/backend`; el del portal, `npm exec --workspace=apps/portal -- tsc --noEmit`.
- Las pruebas de la tablet corren en Node con la base en memoria (`src/**/*.spec.ts`); **no hay pruebas de
  pantalla**: la lógica de pantalla va a funciones puras de `src/estado/`. Las pantallas se verifican con
  `typecheck`, `lint` y `npm run export --workspace=apps/tablet` (bundle de Metro).
- **Los conteos de pruebas se miden contra la línea base al inicio de cada tarea; no se escriben aquí.**
- **Los implementadores no despachan subagentes, no empujan, no mergean** (ni `git push`, ni `gh pr`).
- Flakiness de e2e que ya existía antes de tu tarea: se reporta como `DONE_WITH_CONCERNS`, no se reintenta a
  ciegas ni se arregla dentro de otra tarea.
- Un commit por tarea, mensaje en español con prefijo `T-37:`, y termina con la línea exacta
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

Entradas que el spec implica pero que ninguna prueba que el spec pide ejercita, y que un vendedor o un
administrador real van a producir. Cada una tiene su prueba en la tarea dueña del código:

1. **Una fila de ruta cuyo cliente todavía no está en el catálogo local de la tablet** (el pull incremental trae
   la ruta y el cliente no, o el cliente cambió de sucursal) → la fila se **omite** y el resto del snapshot entra;
   nunca un `FOREIGN KEY constraint failed` que revierta el pull entero y deje al vendedor sin refrescar.
   Prueba: Tarea 6, `rutas.spec.ts`, "una fila cuyo cliente no está en la tablet se omite…"; y Tarea 7,
   `catalogos` "el snapshot entero entra aunque una ruta apunte a un cliente desconocido".
2. **Un alta capturada ayer sin red y subida hoy** (`fecha_operacion` = ayer) → se guarda en la ruta **de ayer**,
   con el orden siguiente de ayer, y no choca con el mismo cliente asignado hoy por la oficina. Prueba: Tarea 4,
   e2e "un alta de AYER subida hoy cae en la ruta de ayer…".
3. **Una venta o un cobro de AYER no marca "visitado" hoy** (la palomita es por día, D5). Prueba: Tarea 6,
   `rutas.spec.ts`, "una venta de ayer no marca visitado hoy".
4. **"Copiar de ayer" sobre una ruta anterior con un cliente que desde entonces se dio de baja o es prospecto**
   → `GET …/anterior` lo omite, así que "Guardar ruta" no termina en un 400 que el usuario no entiende. Prueba:
   Tarea 5, e2e "anterior omite clientes dados de baja y prospectos".
5. **El buzón conserva el cliente del alta.** `cliente_id` de `ruta-alta` viaja en `datos` (D13), pero
   `guardarOperacion` lo pisaba con el `cliente_id` del sobre (`null`), dejando `sync_operacion.datos` sin cliente.
   Prueba: Tarea 4, e2e "el buzón conserva el cliente del alta en datos".

Fuera del spec y **sin** manejar a propósito (se anotan, no se implementan): un vendedor que comparte tablet con
otro ve la ruta local del anterior hasta el siguiente pull (la tabla local no lleva `vendedor_id`, como pide el
spec); las altas pendientes de más de 7 días **no** se purgan (se conservan hasta que suban: perderlas falsearía la
efectividad de T-46).

## Línea base (la corre el implementador de la Tarea 1 ANTES de tocar nada)

Anota en tu reporte el resultado de cada comando (pasan / fallan, y cuántas pruebas). Las tareas siguientes
comparan contra esto. **No** los escribas en el plan.

```bash
git status                                   # limpio, rama feature/t-37-ruta-diaria
docker context ls                            # cuál daemon está activo (Colima o Docker Desktop)
npm run supabase -- status                   # el stack local tiene que estar arriba (NO lo reinicies)
npm run supabase -- migration up --local     # al día con la rama; nunca db reset
npm run supabase -- test db --local          # pgTAP
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm test --workspace=apps/portal
npm run lint --workspace=apps/portal
npm exec --workspace=apps/portal -- tsc --noEmit
```

Si `migration up --local` se queja de migraciones en la base que no están en esta rama (otra sesión aplicó las
suyas), **no** uses `repair`, `--include-all` ni `db reset`: reporta `BLOCKED` con el mensaje exacto.

## Mapa de archivos

| Archivo | Tarea | Qué |
|---|---|---|
| `supabase/migrations/20261012120000_ruta_diaria.sql` | 1 | Crear: `origen`, unicidad parcial, índice (D11) |
| `supabase/tests/99_ruta_diaria_test.sql` | 1 | Crear: pgTAP |
| `apps/backend/src/database/schema.d.ts` | 1 | Generado: `Ruta.origen` |
| `apps/backend/src/modules/sincronizacion/contrato.ts` | 2 | `ruta-alta`, 3 códigos, `DatosRutaAlta`, `RutaPull`, `RespuestaPull.rutas` |
| `apps/tablet/src/sincronizacion/contrato.ts` | 2 | Lo mismo (con `rutas?` opcional) |
| `docs/contrato-sincronizacion.md` | 2 | §5 `rutas`, §6 `ruta-alta` y códigos, §7, §9 |
| `apps/backend/src/modules/sincronizacion/despacho.ts` | 2, 4 | `case 'ruta-alta'` (buzón en T2, proyección en T4) |
| `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts` | 2, 3, 4 | `rutas` en el pull; proyección y `catch` |
| `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts` | 3, 4 | `rutas(vendedorId, desde)`; `cliente_id` del buzón |
| `apps/backend/test/sincronizacion.e2e-spec.ts` | 3, 4 | e2e de pull y push de la ruta; `afterAll` |
| `apps/backend/src/modules/rutas/datos-ruta-alta.ts` (+ `.spec.ts`) | 4 | Crear: forma de `datos` (pura) |
| `apps/backend/src/modules/rutas/ruta-rechazada.ts` | 4 | Crear: `RutaRechazada` |
| `apps/backend/src/modules/sincronizacion/despacho-ruta-alta.ts` (+ `.spec.ts`) | 4 | Crear: `prepararRutaAlta`, `CODIGO_POR_RAZON_RUTA` |
| `apps/backend/src/modules/rutas/rutas-diarias.repository.ts` | 4, 5 | Crear: SQL de `ruta` |
| `apps/backend/src/modules/rutas/rutas-diarias.service.ts` (+ `.spec.ts`) | 4, 5 | Crear: `agregarAlDia`; portal |
| `apps/backend/src/modules/rutas/rutas.module.ts` | 4, 5 | Provee/exporta; controlador |
| `apps/backend/src/modules/sincronizacion/despacho.spec.ts` | 4 | Caso `ruta-alta` |
| `apps/backend/src/modules/rutas/reemplazo-ruta.ts` (+ `.spec.ts`) | 5 | Crear: `planearReemplazo` (puro) |
| `apps/backend/src/modules/rutas/dto/ruta-diaria.dto.ts` | 5 | Crear: DTOs |
| `apps/backend/src/modules/rutas/rutas-diarias.controller.ts` | 5 | Crear: `GET/PUT /rutas/diaria`, `GET …/anterior` |
| `apps/backend/test/rutas-diarias.e2e-spec.ts` | 5 | Crear: e2e del portal |
| `apps/tablet/src/datos/migraciones/011-ruta.ts` (+ `.spec.ts`), `index.ts` | 6 | Crear y registrar la 011 |
| `apps/tablet/src/datos/tipos.ts` | 6 | `Ruta`, `OrigenRuta`, `SyncEstadoRuta` |
| `apps/tablet/src/datos/repositorios/rutas.ts` (+ `.spec.ts`) | 6 | Crear: repositorio y `aplicarSnapshotRutas` |
| `apps/tablet/src/datos/repositorios/catalogos.ts` (+ `.spec.ts`) | 7 | `rutas` en el snapshot, después de `cliente` |
| `apps/tablet/src/sincronizacion/motor.ts` (+ `.spec.ts`) | 7 | `aSnapshot` pasa `rutas` |
| `apps/tablet/src/sincronizacion/fuente-rutas.ts` (+ `.spec.ts`) | 7 | Crear: fuente `ruta-alta` |
| `apps/tablet/src/sincronizacion/pendientes.ts` (+ `.spec.ts`) | 7 | Suma las altas de ruta |
| `apps/tablet/src/datos/inicializar.ts`, `src/datos/index.ts` | 7 | `rutas` en `CapaDatos`; exportaciones |
| `apps/tablet/src/estado/proveedor-sesion.tsx` | 7 | `fuenteRutas` en `fuentes` |
| `apps/tablet/src/estado/ruta-del-dia.ts` (+ `.spec.ts`) | 8 | Crear: funciones puras de pantalla |
| `apps/tablet/src/ui/lista-ruta.tsx` | 9 | Crear: lista con arrastre y subir/bajar |
| `apps/tablet/src/ui/menu-hoja.tsx` | 9 | Crear: menú hamburguesa en `Modal` |
| `apps/tablet/app/(jornada)/index.tsx` | 9 | Se reescribe: pantalla principal |
| `apps/tablet/app/(jornada)/pendiente/[seccion].tsx` | 9 | Crear: pantallas pendientes del menú |
| `apps/tablet/app/(jornada)/_layout.tsx` | 9, 10 | `Stack.Screen` nuevas |
| `apps/tablet/app/(jornada)/agregar-a-ruta.tsx` | 10 | Crear: "Agregar a mi ruta" |
| `apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx` | 10 | Ficha ampliada |
| `apps/tablet/src/datos/repositorios/prospectos.ts` (+ `.spec.ts`) | 10 | `fotoLocalDe` (D8) |
| `apps/tablet/app/abrir-dia.tsx` | 10 | Purga al abrir el día |
| `apps/portal/src/lib/rutas.ts` (+ `.test.ts`) | 11 | Crear: cliente de API y edición pura |
| `apps/portal/src/components/rutas/*` | 11 | Crear: cartera, lista, pantalla (+ pruebas) |
| `apps/portal/src/app/(portal)/operacion/ruta-diaria/page.tsx` | 11 | Sustituye el `Placeholder` |
| `apps/tablet/README.md`, `CLAUDE.md`, `docs/contrato-sincronizacion.md` | 12 | Documentación de cierre |

**Por qué este orden.** Cada tarea compila y prueba sola: la 2 deja `ruta-alta` en el buzón (sin proyección) para
que el `switch` exhaustivo de `prepararProyeccion` siga compilando, y responde `rutas: []` en el pull hasta que la
3 lo llena; la 4 sustituye las dos cosas. En la tablet, la 6 crea el repositorio con su propio
`aplicarSnapshot`; la 7 lo cablea al pull y al push. Las pantallas (9, 10) llegan cuando todo lo que leen ya tiene
pruebas (6, 7, 8).

---

### Tarea 1: Migración `ruta_diaria`, pgTAP y tipos (D11)

**Archivos:**
- Crear: `supabase/migrations/20261012120000_ruta_diaria.sql`
- Crear: `supabase/tests/99_ruta_diaria_test.sql`
- Modificar (generado): `apps/backend/src/database/schema.d.ts`

**Interfaces:**
- Consume: la tabla `ruta` de `20260803163400_transaccional.sql` (`id`, `created_at`, `updated_at`,
  `deleted_at`, `cliente_id`, `vendedor_id`, `fecha date`, `orden integer`, `tipo in ('diaria','semanal')`,
  trigger `trg_ruta_updated`).
- Produce:
  - Columna `ruta.origen text not null default 'oficina'` con `constraint ck_ruta_origen check (origen in
    ('oficina','vendedor'))`.
  - Índice único parcial `uq_ruta_diaria_vendedor_fecha_cliente on ruta (vendedor_id, fecha, cliente_id) where
    deleted_at is null and tipo = 'diaria'` (lo usan las Tareas 4 y 5 con `on conflict`).
  - Índice `idx_ruta_vendedor_fecha on ruta (vendedor_id, fecha) where deleted_at is null` (pull y portal).
  - En `schema.d.ts`: `Ruta.origen: Generated<string>`.

**Qué se copia y de dónde:** checks con nombre `ck_<tabla>_<regla>` e índices parciales `where deleted_at is null`
de `20261010120000_jornada.sql`. **Sin grants ni RLS**: ninguna tabla del repo los tiene (mismo criterio que
T-38). La ruta **semanal** (`tipo = 'semanal'`, T-36) no se toca: el índice único es solo de la diaria.

- [ ] **Paso 1: Prueba pgTAP (falla)**

Crear `supabase/tests/99_ruta_diaria_test.sql`:

```sql
begin;
select plan(14);

-- T-37: la ruta diaria. Lo que la BASE garantiza aunque alguien escriba por
-- debajo del servicio. Prefijo `zz-pgtap-t37`.

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-t37', 'Vendedor pgTAP T-37', 'x', id
    from sucursal where codigo = 'TJ';
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-T37 Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));

create temporary table _t37 on commit drop as
select
  (select id from vendedor where login = 'zz-pgtap-t37') as vendedor,
  (select id from cliente where nombre = 'ZZ-pgtap-T37 Cliente') as cliente;

select has_column('ruta', 'origen',
  'cada fila de la ruta dice quien la agrego (D11)');
select col_not_null('ruta', 'origen',
  'el origen es obligatorio');
select col_default_is('ruta', 'origen', 'oficina',
  'lo que ya existia y lo que escribe el portal es de la oficina');
select has_index('ruta', 'uq_ruta_diaria_vendedor_fecha_cliente',
  'un cliente una sola vez en la ruta diaria viva de un vendedor y un dia');
select has_index('ruta', 'idx_ruta_vendedor_fecha',
  'el pull y el portal leen por vendedor y fecha');

select lives_ok(
  $$insert into ruta (cliente_id, vendedor_id, fecha, orden, tipo)
    select cliente, vendedor, '2026-10-12', 1, 'diaria' from _t37$$,
  'una fila de la ruta diaria entra sin decir origen'
);

select is(
  (select origen from ruta
    where vendedor_id = (select vendedor from _t37) and fecha = '2026-10-12'
      and tipo = 'diaria' and deleted_at is null),
  'oficina',
  'sin origen explicito la fila es de la oficina'
);

select throws_ok(
  $$insert into ruta (cliente_id, vendedor_id, fecha, orden, tipo, origen)
    select cliente, vendedor, '2026-10-13', 1, 'diaria', 'portal' from _t37$$,
  '23514', null,
  'un origen que no es oficina ni vendedor no entra'
);

select throws_ok(
  $$insert into ruta (cliente_id, vendedor_id, fecha, orden, tipo, origen)
    select cliente, vendedor, '2026-10-12', 2, 'diaria', 'vendedor' from _t37$$,
  '23505', null,
  'el mismo cliente vivo dos veces en la ruta diaria del mismo dia no entra'
);

select lives_ok(
  $$insert into ruta (cliente_id, vendedor_id, fecha, orden, tipo, origen)
    select cliente, vendedor, '2026-10-14', 1, 'diaria', 'vendedor' from _t37$$,
  'el mismo cliente en otro dia si entra'
);

select lives_ok(
  $$insert into ruta (cliente_id, vendedor_id, fecha, orden, tipo)
    select cliente, vendedor, '2026-10-12', 1, 'semanal' from _t37$$,
  'la ruta semanal (T-36) no esta bajo la unicidad de la diaria'
);

-- La oficina quita al cliente (baja logica) y lo vuelve a poner: el indice es
-- parcial, asi que la fila nueva entra.
update ruta set deleted_at = now()
 where vendedor_id = (select vendedor from _t37) and fecha = '2026-10-12'
   and tipo = 'diaria' and deleted_at is null;

select lives_ok(
  $$insert into ruta (cliente_id, vendedor_id, fecha, orden, tipo, origen)
    select cliente, vendedor, '2026-10-12', 1, 'diaria', 'vendedor' from _t37$$,
  'dar de baja una fila libera al cliente en ese dia'
);

update ruta set deleted_at = now()
 where vendedor_id = (select vendedor from _t37) and fecha = '2026-10-12'
   and tipo = 'diaria' and deleted_at is null;

select is(
  (select count(*)::int from ruta
    where vendedor_id = (select vendedor from _t37) and fecha = '2026-10-12'
      and tipo = 'diaria' and deleted_at is not null),
  2,
  'dos filas dadas de baja del mismo vendedor, dia y cliente conviven'
);

select lives_ok(
  $$insert into ruta (cliente_id, vendedor_id, fecha, orden, tipo)
    select cliente, vendedor, '2026-10-12', 1, 'diaria' from _t37$$,
  'con dos bajas del mismo cliente, una fila viva nueva sigue entrando'
);

select * from finish();
rollback;
```

- [ ] **Paso 2: Correr pgTAP y ver que falla**

Run: `npm run supabase -- test db --local`
Expected: `99_ruta_diaria_test.sql` falla (`column "origen" … does not exist` o el plan no se cumple); los demás
archivos siguen como en la línea base.

- [ ] **Paso 3: La migración**

Crear `supabase/migrations/20261012120000_ruta_diaria.sql`:

```sql
-- T-37: la ruta diaria que arma la oficina y complementa el vendedor (D11).
--
-- La tabla `ruta` existe desde la migracion transaccional, pero nadie la
-- escribia ni la leia. Desde T-37 la escriben el portal (`PUT /rutas/diaria`)
-- y la proyeccion de `ruta-alta` (`RutasDiariasService.agregarAlDia`), y la
-- lee el pull de la tablet. Ver
-- docs/superpowers/specs/2026-10-12-t-37-ruta-del-dia-y-pantalla-principal-design.md.
--
-- Aditiva: no cambia ninguna columna existente. La ruta SEMANAL (`tipo =
-- 'semanal'`, T-36) no se toca: la unicidad de abajo es solo de la diaria.
--
-- Sin grants ni RLS: ninguna tabla de este esquema los tiene (mismo criterio
-- que `jornada`, T-38).

-- Quien puso al cliente en la ruta. El portal no puede quitar lo que agrego el
-- vendedor (D2, D14), y la efectividad (T-46) distingue lo asignado de lo que
-- el vendedor sumo. Las filas que ya existieran (no deberia haber) quedan como
-- de la oficina, que es lo unico que las pudo haber escrito.
alter table ruta
  add column origen text not null default 'oficina'
    constraint ck_ruta_origen check (origen in ('oficina', 'vendedor'));

-- Un cliente una sola vez en la ruta diaria VIVA de un vendedor y un dia.
-- Parcial, como el resto del esquema: la oficina puede quitar a un cliente y
-- volver a ponerlo (fila nueva). La usan, con `on conflict ... do nothing`,
-- la proyeccion de `ruta-alta` (para responder `ruta-duplicada` sin abortar la
-- transaccion) y el reemplazo del portal.
create unique index uq_ruta_diaria_vendedor_fecha_cliente
  on ruta (vendedor_id, fecha, cliente_id)
  where deleted_at is null and tipo = 'diaria';

-- El pull (ventana de fechas del vendedor) y el portal (un vendedor y un dia).
create index idx_ruta_vendedor_fecha
  on ruta (vendedor_id, fecha) where deleted_at is null;
```

- [ ] **Paso 4: Aplicar y correr pgTAP**

Run:
```bash
npm run supabase -- migration up --local
npm run supabase -- test db --local
```
Expected: la migración se aplica; `99_ruta_diaria_test.sql` en verde con sus 14 pruebas y el resto igual que la
línea base.

- [ ] **Paso 5: Regenerar tipos y comprobar el diff**

Run:
```bash
npm run db:types --workspace=apps/backend
git diff apps/backend/src/database/schema.d.ts
```
Expected: el único cambio es una línea dentro de `export interface Ruta`, entre `orden` y `tipo`:

```ts
export interface Ruta {
  cliente_id: string;
  created_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
  fecha: Timestamp;
  id: Generated<string>;
  orden: number;
  origen: Generated<string>;
  tipo: string;
  updated_at: Generated<Timestamp>;
  vendedor_id: string;
}
```

Si el diff trae algo más (tablas de otra sesión aplicadas en tu base local), **no** lo commitees: deja solo la
línea de `origen` (`git add -p`) y anótalo en tu reporte.

- [ ] **Paso 6: Compila**

Run: `npm run build --workspace=apps/backend`
Expected: compila sin errores.

- [ ] **Paso 7: Commit**

```bash
git add supabase/migrations/20261012120000_ruta_diaria.sql supabase/tests/99_ruta_diaria_test.sql \
  apps/backend/src/database/schema.d.ts
git commit -m "T-37: migracion de la ruta diaria — origen, unicidad parcial e indice

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 2: Contrato — `RutaPull`, `rutas`, `ruta-alta` y tres códigos, en los dos lados y en `docs/` (D12, D13)

**Archivos:**
- Modificar: `apps/backend/src/modules/sincronizacion/contrato.ts`
- Modificar: `apps/tablet/src/sincronizacion/contrato.ts`
- Modificar: `docs/contrato-sincronizacion.md`
- Modificar: `apps/backend/src/modules/sincronizacion/despacho.ts` (solo el `case`, para que compile)
- Modificar: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts` (solo `rutas: []`, para que
  compile)

**Interfaces:**
- Consume: nada.
- Produce (en **los dos** contratos):
  - Tipo de operación `'ruta-alta'`. En el backend se agrega al **arreglo** `TIPOS_OPERACION` (de él sale
    `TipoOperacion`); en la tablet no hay arreglo: se agrega `| 'ruta-alta'` a la **unión** `TipoOperacion`.
  - `CODIGOS_RECHAZO` gana, al final y en este orden: `'ruta-datos-invalidos'`, `'cliente-inexistente'`,
    `'ruta-duplicada'`.
  - `export type DatosRutaAlta = { cliente_id: string }`.
  - `export interface RutaPull extends FilaSincronizable { cliente_id: string; fecha: string; orden: number;
    origen: 'oficina' | 'vendedor' }`.
  - `RespuestaPull.rutas: RutaPull[]` (backend, obligatorio) / `rutas?: RutaPull[]` (tablet, opcional: puede
    hablar con un servidor que todavía no la manda, igual que `tipos_negocio?`). **Nivel superior**, junto a
    `notas_pendientes`, no dentro de `catalogos`.
  - `CONTRATO_ACTUAL` **sigue en 1**.
- Deja para la Tarea 3: `rutas: []` en el pull. Para la Tarea 4: `case 'ruta-alta'` sin proyección.

**Por qué esta tarea toca `despacho.ts` y el servicio:** `prepararProyeccion` es un `switch` exhaustivo sobre
`op.tipo` y `RespuestaPull.rutas` es obligatorio; sin estas dos líneas el backend no compila. Las dos se sustituyen
en las Tareas 3 y 4. No hay prueba propia: las trae la tarea siguiente.

- [ ] **Paso 1: Backend — `TIPOS_OPERACION`**

En `apps/backend/src/modules/sincronizacion/contrato.ts`, en el comentario de `TIPOS_OPERACION`, después de la línea
`* TODO: T-39 — \`ruta\` (visitas, orden real, tiempos y GPS).` agregar:

```ts
 * Hecho: T-37 — `ruta-alta`, un cliente que el vendedor agrego a su ruta del
 *        dia (ver {@link DatosRutaAlta}); se proyecta a la tabla `ruta` con
 *        `origen = 'vendedor'`. **No** reutiliza `ruta`, que queda reservado a
 *        la visita de T-39. Tipo nuevo = cambio aditivo: no sube la version.
```

y el arreglo queda:

```ts
export const TIPOS_OPERACION = [
  'jornada',
  'venta',
  'cobranza',
  'gasto',
  'merma',
  'ruta',
  'prospecto',
  'ruta-alta',
] as const;
```

- [ ] **Paso 2: Backend — los tres códigos**

Al final de `CODIGOS_RECHAZO`, después de `'jornada-duplicada',` y antes de `] as const;`:

```ts
  /**
   * `datos.cliente_id` de un alta de ruta falta o no es un uuid, o el sobre
   * trae un folio (un alta de ruta no es una nota que nadie firme). T-37. Bug
   * de la tablet. Se rechaza antes de abrir la transaccion.
   */
  'ruta-datos-invalidos',
  /**
   * El cliente de un alta de ruta no existe, esta dado de baja (`deleted_at`),
   * es de otra sucursal que la del vendedor del token, o es un prospecto (a un
   * prospecto no se le vende, D7). T-37. No es un bug: el catalogo de la tablet
   * pudo quedarse viejo. Se reintenta en la siguiente sincronizacion.
   */
  'cliente-inexistente',
  /**
   * Ya habia una fila viva de ese vendedor, fecha y cliente en la ruta,
   * subida con **otra** clave (la oficina y el vendedor agregaron al mismo
   * cliente). T-37. La misma clave es `duplicada`, no esto. **La tablet la
   * trata como aplicada**: no es un error del vendedor.
   */
  'ruta-duplicada',
```

- [ ] **Paso 3: Backend — `DatosRutaAlta`**

Después del bloque de `DatosJornada` (antes de `export interface ResultadoOperacion`):

```ts
/**
 * `datos` de una operacion `tipo: "ruta-alta"` (T-37): un cliente que el
 * vendedor agrego a mano a su ruta del dia.
 *
 * El cliente va en `datos` y **no** en el sobre a proposito: con el
 * `cliente_id` del sobre, el alcance generico del push responderia
 * `cliente-fuera-de-alcance` y la tablet no podria distinguir un prospecto (que
 * nunca entra a la ruta, D7) de un cliente que el portal movio de sucursal. El
 * dia de la ruta es `fecha_operacion`, tal cual la manda la tablet. Sin folio.
 *
 * El ORDEN no viaja: el que arrastra el vendedor se queda en la tablet (D4); el
 * servidor pone la fila al final de la ruta de ese dia.
 *
 * Es `type` y no `interface` por la misma razon que {@link DatosVenta}.
 */
export type DatosRutaAlta = {
  /** uuid de un `cliente` (no prospecto) de la sucursal del vendedor. */
  cliente_id: string;
};
```

- [ ] **Paso 4: Backend — `RutaPull` y `RespuestaPull.rutas`**

Después de `export interface NotaPendientePull … }` y antes de `export interface RespuestaPull`:

```ts
/**
 * Una fila de la ruta diaria del vendedor del token (T-37, D12).
 *
 * - Solo `tipo = 'diaria'` y solo del vendedor del token.
 * - Ventana de fechas por el reloj del servidor: de ayer a dentro de 7 dias.
 *   La tablet decide que dia mostrar con su reloj local (Tijuana); la ventana
 *   existe para que una ruta asignada el viernes para el lunes baje el viernes.
 * - Incremental por `updated_at` como las demas colecciones. Una fila que la
 *   oficina quito viaja con `activo: 0` (baja como bandera, nunca como
 *   ausencia); sin `desde` bajan solo las vivas.
 *
 * Coleccion nueva = cambio aditivo: no sube la version.
 */
export interface RutaPull extends FilaSincronizable {
  cliente_id: string;
  /** `AAAA-MM-DD`, el dia de la asignacion. */
  fecha: string;
  /** El orden de la oficina. La tablet lo usa solo si el vendedor no reordeno. */
  orden: number;
  origen: 'oficina' | 'vendedor';
}
```

y en `RespuestaPull`, después de `notas_pendientes: NotaPendientePull[];`:

```ts
  /** T-37. La ruta diaria del vendedor (ver {@link RutaPull}). Aditiva. */
  rutas: RutaPull[];
```

- [ ] **Paso 5: Backend — que siga compilando**

En `apps/backend/src/modules/sincronizacion/despacho.ts`, el último bloque del `switch` de `prepararProyeccion`
queda:

```ts
    case 'gasto':
    case 'merma':
    case 'ruta':
      return { ok: true, proyeccion: null };
    // T-37: buzon solo mientras la Tarea 4 no traiga su proyeccion.
    case 'ruta-alta':
      return { ok: true, proyeccion: null };
  }
```

En `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`, en el `return` de `pull`, después de
`notas_pendientes: notasPendientes,`:

```ts
      // T-37: la Tarea 3 la llena con `this.repo.rutas(...)`.
      rutas: [],
```

- [ ] **Paso 6: Tablet — tipo y códigos**

En `apps/tablet/src/sincronizacion/contrato.ts`, la unión queda:

```ts
export type TipoOperacion =
  | 'jornada'
  | 'venta'
  | 'cobranza'
  | 'gasto'
  | 'merma'
  | 'ruta'
  /** T-40. Un alta de prospecto: el servidor la proyecta a `cliente`. */
  | 'prospecto'
  /** T-37. Un cliente que el vendedor agrego a su ruta del dia. */
  | 'ruta-alta';
```

Al final de `CODIGOS_RECHAZO`, después de `'jornada-duplicada',`:

```ts
  /** T-37: `datos.cliente_id` del alta de ruta falta o no es uuid. Bug de la tablet. */
  'ruta-datos-invalidos',
  /**
   * T-37: el cliente del alta no existe en el servidor, esta dado de baja, es de
   * otra sucursal o es un prospecto. La fila queda en `error`; el vendedor la
   * puede quitar.
   */
  'cliente-inexistente',
  /**
   * T-37: la oficina ya tenia a ese cliente en la ruta de ese dia. **No es un
   * error**: `fuente-rutas.ts` la marca como sincronizada y el pull posterior la
   * funde con la fila del servidor.
   */
  'ruta-duplicada',
```

- [ ] **Paso 7: Tablet — `DatosRutaAlta`, `RutaPull` y `rutas?`**

Después de `export type DatosJornada = { … };`:

```ts
/**
 * `datos` de una operacion `tipo: "ruta-alta"` (T-37). Copia del tipo del
 * backend: el cliente va aqui y no en el sobre; el dia es `fecha_operacion`.
 */
export type DatosRutaAlta = {
  cliente_id: string;
};
```

Después de `export interface NotaPendientePull … }`:

```ts
/** Una fila de la ruta diaria del vendedor (T-37). Copia de la del backend. */
export interface RutaPull extends FilaSincronizable {
  cliente_id: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
  orden: number;
  origen: 'oficina' | 'vendedor';
}
```

Y en `RespuestaPull`, después de `notas_pendientes: NotaPendientePull[];`:

```ts
  /**
   * T-37. **Opcional en la copia de la tablet, obligatoria en el servidor**, por
   * la misma razon que `catalogos.tipos_negocio`: esta tablet puede hablar con
   * un servidor que todavia no la manda, y leer `undefined` no puede reventar la
   * sincronizacion. Sin la coleccion, la tablet funciona sin ruta asignada (D3).
   */
  rutas?: RutaPull[];
```

- [ ] **Paso 8: `docs/contrato-sincronizacion.md`**

a) En §5, en el bloque `jsonc` de "Respuesta `200`", la última propiedad deja de ser `notas_pendientes`; después
de su `}]` agregar (con la coma que corresponda en la línea anterior):

```jsonc
  "rutas": [{ "id": "…", "cliente_id": "…", "fecha": "2026-10-12", "orden": 1,
              "origen": "oficina", "activo": 1 }]
```

b) Después de la subsección `### Notas pendientes: saldo derivado, abonos y notas cerradas (T-20)` (antes de
`## 6. \`POST /sync/push\``), agregar:

```markdown
### `rutas`: la ruta diaria del vendedor (T-37)

Colección **nueva y de nivel superior** (junto a `notas_pendientes`, no dentro de `catalogos`). Aditiva: una
tablet vieja la ignora; la tablet nueva la trata como opcional.

- Solo filas del **vendedor del token** y de `tipo = 'diaria'` (la semanal de T-36 no viaja).
- **Ventana** por el reloj del servidor: `fecha between current_date - 1 and current_date + 7`. Postgres corre en
  UTC: el `- 1` es lo que mantiene "hoy en Tijuana" dentro de la ventana después de las 17:00 locales. La tablet
  decide qué día muestra con su reloj local.
- Incremental por `updated_at > desde`. Una fila que la oficina quitó viaja con `activo: 0`; sin `desde` bajan
  solo las vivas.
- `origen` dice quién puso al cliente: `oficina` (portal) o `vendedor` (un `ruta-alta` proyectado).
- El orden que el vendedor arrastra en la tablet **no sube** (D4): vive en la tabla local `ruta_orden_local` y
  ningún pull lo pisa.
```

c) En §6, en el bloque de la petición, la línea del tipo queda:

```jsonc
      "tipo": "jornada",                  // jornada|venta|cobranza|gasto|merma|ruta|prospecto|ruta-alta
```

d) En §6, el párrafo que empieza "`datos` lo fija el ticket de cada módulo" queda:

```markdown
`datos` lo fija el ticket de cada módulo, y fijarlo es un cambio **aditivo** que
no sube la versión del contrato. Hoy tienen forma fija **`venta`** (T-16),
**`prospecto`** (T-40), **`cobranza`** (T-20), **`jornada`** (T-38) y
**`ruta-alta`** (T-37), los cinco abajo; gastos, merma y ruta siguen libres hasta
T-27/T-33/T-39, y el servidor las guarda tal cual.
```

e) Después de la subsección `### \`datos\` de una jornada (T-38)` (antes de `### Respuesta \`200\` — parcial y
honesta`), agregar:

````markdown
### `datos` de un alta de ruta (T-37)

```jsonc
{
  "clave": "uuid de la fila local",
  "tipo": "ruta-alta",                 // NO "ruta": ese tipo queda para la visita de T-39
  "fecha_operacion": "2026-10-12",     // el día de la ruta; se guarda tal cual
  "ocurrido_en": "2026-10-12T16:05:00.000Z",
  // SIN "cliente_id" en el sobre y SIN "folio"
  "datos": { "cliente_id": "uuid" }    // un cliente (no prospecto) de la sucursal del vendedor
}
```

- La forma se valida **antes** de la transacción: sin `cliente_id` uuid, o con folio en el sobre, es
  `ruta-datos-invalidos`.
- Dentro de la transacción (`RutasDiariasService.agregarAlDia`): un cliente que no existe, está dado de baja, es de
  otra sucursal o es **prospecto** es `cliente-inexistente`. Si ya había una fila viva de ese vendedor, fecha y
  cliente subida con **otra** clave, es `ruta-duplicada` (la tablet la trata como aplicada). La misma clave
  reenviada es `duplicada`, como cualquier operación.
- Se guarda en `ruta` con `fecha = fecha_operacion`, `origen = 'vendedor'`, `tipo = 'diaria'` y `orden = max + 1`
  entre las vivas de ese vendedor y día. El buzón apunta a esa fila (`entidad_tabla = 'ruta'`) y conserva el
  `cliente_id` en su `datos`.
````

f) En la tabla de "Códigos de rechazo", después de la fila de `jornada-duplicada`:

```markdown
| `ruta-datos-invalidos` | `datos.cliente_id` de un `ruta-alta` falta o no es uuid, o el sobre trae folio. Bug de la tablet (T-37) |
| `cliente-inexistente` | El cliente de un `ruta-alta` no existe, está dado de baja, es de otra sucursal o es prospecto. Se reintenta; el vendedor puede quitar la fila (T-37) |
| `ruta-duplicada` | Ya había una fila viva de ese vendedor, fecha y cliente con **otra** clave. **La tablet la trata como aplicada** (T-37) |
```

g) En §7, "Una transacción por operación", el primer párrafo dice "(hoy `venta`, `cobranza`, `prospecto` y
`jornada`)": cámbialo a "(hoy `venta`, `cobranza`, `prospecto`, `jornada` y `ruta-alta`)". En la lista del paso 2,
después del punto de `JornadasService.cerrarJornada`, agregar:

```markdown
   - `RutasDiariasService.agregarAlDia` (T-37) → comprueba el cliente (vivo, de la sucursal, `tipo = 'cliente'`),
     bloquea la fila del vendedor (`for no key update`, para serializar con el portal), calcula el orden siguiente
     e inserta en `ruta` con `on conflict (vendedor_id, fecha, cliente_id) where deleted_at is null and tipo =
     'diaria' do nothing`; si no insertó, `ruta-duplicada`. La entidad es la fila de `ruta`.
```

y en el paso 3, la lista de rechazos del dominio suma `cliente-inexistente`, `ruta-duplicada`.

h) En §9, la fila "Resolución de conflictos" se queda; agregar una fila:

```markdown
| Subir el orden en que el vendedor arrastró su ruta (hoy se queda en la tablet, D4) | Futuro, aditivo |
```

- [ ] **Paso 9: Las dos listas de códigos son idénticas**

Run:
```bash
diff <(sed -n '/export const CODIGOS_RECHAZO/,/\] as const/p' apps/backend/src/modules/sincronizacion/contrato.ts | grep -oE "^  '[a-z-]+'") \
     <(sed -n '/export const CODIGOS_RECHAZO/,/\] as const/p' apps/tablet/src/sincronizacion/contrato.ts | grep -oE "^  '[a-z-]+'")
grep -n "CONTRATO_ACTUAL = " apps/backend/src/modules/sincronizacion/contrato.ts apps/tablet/src/sincronizacion/contrato.ts
grep -n "'ruta-alta'" apps/backend/src/modules/sincronizacion/contrato.ts apps/tablet/src/sincronizacion/contrato.ts
```
Expected: `diff` sin salida; las dos líneas dicen `CONTRATO_ACTUAL = 1`; `'ruta-alta'` aparece en los dos archivos.

- [ ] **Paso 10: Compila y nada se rompe**

Run:
```bash
npm exec --workspace=apps/backend -- prettier --write src/modules/sincronizacion/contrato.ts \
  src/modules/sincronizacion/despacho.ts src/modules/sincronizacion/sincronizacion.service.ts
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run typecheck --workspace=apps/tablet
npm test --workspace=apps/tablet
npm run lint --workspace=apps/tablet
```
Expected: todo como en la línea base (solo cambiaron tipos, comentarios y dos líneas de relleno).

- [ ] **Paso 11: Commit**

```bash
git add apps/backend/src/modules/sincronizacion/contrato.ts apps/tablet/src/sincronizacion/contrato.ts \
  docs/contrato-sincronizacion.md apps/backend/src/modules/sincronizacion/despacho.ts \
  apps/backend/src/modules/sincronizacion/sincronizacion.service.ts
git commit -m "T-37: contrato — coleccion rutas, operacion ruta-alta y sus codigos de rechazo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Tarea 3: Pull — `repository.rutas(vendedorId, desde)` con ventana y bandera (D12)

**Archivos:**
- Modificar: `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts`
- Modificar: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`
- Modificar: `apps/backend/test/sincronizacion.e2e-spec.ts`

**Interfaces:**
- Consume: Tarea 1 (`ruta.origen`, `idx_ruta_vendedor_fecha`); Tarea 2 (`RutaPull`, `RespuestaPull.rutas`).
- Produce:
  - `SincronizacionRepository.rutas(vendedorId: string, desde: Date | null): Promise<RutaPull[]>`.
  - El pull responde `rutas` con las filas de `ruta` del vendedor del token.
  - En el e2e: helpers `clientesRuta: string[]`, `clienteDeRuta(extra?)`, `sembrarRuta(...)`,
    `fechaServidor(dias)`, y el `afterAll` borra `ruta` antes que `cliente` y `vendedor` (la Tarea 4 los reutiliza).

**Decisiones de esta tarea:**
- `fecha` sale como texto con `to_char(fecha, 'YYYY-MM-DD')`: el driver devuelve un `date` como `Date` en hora local
  del proceso, y `RutaPull.fecha` es `AAAA-MM-DD` (mismo criterio que `notasPendientes`).
- Con `desde = null` solo vivas (`deleted_at is null`); con `desde`, todas las que cambiaron, y la baja viaja con
  `activo: 0` (`bandera(true, deleted_at)`): `ruta` no tiene columna `activo`.
- La ventana es `current_date - 1 .. current_date + 7` **en el reloj de Postgres (UTC)**, tal cual el spec. El
  comentario lo dice para que nadie lo "arregle".

- [ ] **Paso 1: e2e (falla)**

En `apps/backend/test/sincronizacion.e2e-spec.ts`:

a) Debajo de `const vehiculosT38: string[] = [];` agregar:

```ts
  /* ---------------------------------------------------------------- */
  /* Ruta diaria (T-37)                                                */
  /* ---------------------------------------------------------------- */

  /** Clientes que crean las pruebas de T-37; los borra el `afterAll`. */
  const clientesRuta: string[] = [];

  /** Un cliente nuevo de la sucursal del vendedor, para UNA prueba de ruta. */
  const clienteDeRuta = async (
    extra: {
      tipo?: 'cliente' | 'prospecto';
      sucursal_id?: string;
      deleted_at?: Date;
    } = {},
  ) => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const prospecto = extra.tipo === 'prospecto';
    const id = (
      await db
        .insertInto('cliente')
        .values({
          nombre: `Ruta ${SUFIJO} ${clientesRuta.length + 1}`,
          // Un prospecto de la app no trae domicilio ni lista (T-40).
          domicilio: prospecto ? null : 'Calle 9 #4',
          telefono: '6640000009',
          tipo: extra.tipo ?? 'cliente',
          lista_precio_id: prospecto ? null : lista.id,
          sucursal_id: extra.sucursal_id ?? sucursalId,
          deleted_at: extra.deleted_at ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    clientesRuta.push(id);
    return id;
  };

  /**
   * Una fila de `ruta` escrita por debajo del servicio. `dias` es relativo a
   * `current_date` de Postgres (el reloj con el que el pull calcula su ventana);
   * `fecha` fija un dia exacto en su lugar.
   */
  const sembrarRuta = async (valores: {
    cliente: string;
    vendedor?: string;
    dias?: number;
    fecha?: string;
    orden?: number;
    origen?: 'oficina' | 'vendedor';
    tipo?: 'diaria' | 'semanal';
    borrada?: boolean;
    actualizadaHace?: string;
  }) =>
    (
      await db
        .insertInto('ruta')
        .values({
          cliente_id: valores.cliente,
          vendedor_id: valores.vendedor ?? vendedorId,
          fecha:
            valores.fecha ?? sql<string>`current_date + ${valores.dias ?? 0}::int`,
          orden: valores.orden ?? 1,
          origen: valores.origen ?? 'oficina',
          tipo: valores.tipo ?? 'diaria',
          deleted_at: valores.borrada ? new Date() : null,
          // El trigger solo corre en UPDATE: en el INSERT se puede fechar hacia
          // atras, que es lo que necesita la prueba del pull incremental.
          ...(valores.actualizadaHace
            ? {
                updated_at: sql<Date>`now() - ${valores.actualizadaHace}::interval`,
              }
            : {}),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  /** `current_date + dias` de Postgres, como `AAAA-MM-DD`. */
  const fechaServidor = async (dias: number) =>
    (
      await sql<{
        f: string;
      }>`select to_char(current_date + ${dias}::int, 'YYYY-MM-DD') as f`.execute(
        db,
      )
    ).rows[0].f;
```

b) En el `afterAll`, justo después del `deleteFrom('sync_operacion')`:

```ts
    // T-37: la ruta diaria apunta a vendedor y cliente.
    await db
      .deleteFrom('ruta')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
```

y el borrado de clientes queda:

```ts
    await db
      .deleteFrom('cliente')
      .where('id', 'in', [
        clienteId,
        clienteAjenoId,
        ...clientesCobro,
        ...clientesRuta,
      ])
      .execute();
```

c) Al final del archivo, antes del `});` que cierra `describe('Sincronizacion pull/push (e2e)', …)`, agregar:

```ts
  describe('ruta diaria: pull (T-37)', () => {
    it('sin desde baja la ruta VIVA del vendedor, de ayer a dentro de 7 dias, con orden y origen', async () => {
      const c = await clienteDeRuta();
      const fueraAntes = await sembrarRuta({ cliente: c, dias: -2 });
      const ayer = await sembrarRuta({ cliente: c, dias: -1 });
      const hoy = await sembrarRuta({
        cliente: c,
        dias: 0,
        orden: 2,
        origen: 'vendedor',
      });
      const ultimoDia = await sembrarRuta({ cliente: c, dias: 7 });
      const fueraDespues = await sembrarRuta({ cliente: c, dias: 8 });
      const otro = await clienteDeRuta();
      const borrada = await sembrarRuta({ cliente: otro, dias: 0, borrada: true });
      const semanal = await sembrarRuta({ cliente: otro, dias: 0, tipo: 'semanal' });
      const ajena = await sembrarRuta({
        cliente: clienteAjenoId,
        vendedor: vendedorAjenoId,
        dias: 0,
      });

      const cuerpo = (await pull().expect(200)).body as RespuestaPull;
      const ids = new Set(cuerpo.rutas.map((r) => r.id));

      expect(ids.has(ayer)).toBe(true);
      expect(ids.has(hoy)).toBe(true);
      expect(ids.has(ultimoDia)).toBe(true);
      // Fuera de la ventana, dada de baja, semanal (T-36) o de otro vendedor: no.
      for (const id of [fueraAntes, fueraDespues, borrada, semanal, ajena]) {
        expect(ids.has(id)).toBe(false);
      }

      expect(cuerpo.rutas.find((r) => r.id === hoy)).toEqual({
        id: hoy,
        cliente_id: c,
        fecha: await fechaServidor(0),
        orden: 2,
        origen: 'vendedor',
        activo: 1,
      });
    });

    it('con desde baja solo lo que cambio, y una fila que la oficina quito viaja con activo 0', async () => {
      const c = await clienteDeRuta();
      const quieta = await sembrarRuta({
        cliente: c,
        dias: 0,
        actualizadaHace: '1 hour',
      });
      const otro = await clienteDeRuta();
      const quitada = await sembrarRuta({
        cliente: otro,
        dias: 0,
        actualizadaHace: '1 hour',
      });
      const desde = (
        await sql<{
          t: Date;
        }>`select now() - interval '1 minute' as t`.execute(db)
      ).rows[0].t.toISOString();

      // La oficina la quita desde el portal: baja logica, y el trigger mueve
      // `updated_at`, que es lo que la hace viajar en el pull incremental.
      await db
        .updateTable('ruta')
        .set({ deleted_at: new Date() })
        .where('id', '=', quitada)
        .execute();

      const cuerpo = (await pull({ desde }).expect(200)).body as RespuestaPull;

      expect(cuerpo.rutas.some((r) => r.id === quieta)).toBe(false);
      expect(cuerpo.rutas.find((r) => r.id === quitada)).toMatchObject({
        id: quitada,
        activo: 0,
      });
    });
  });
```

- [ ] **Paso 2: Ver que falla**

Run: `npm run test:e2e --workspace=apps/backend -- -t "ruta diaria: pull"`
Expected: FAIL; las dos pruebas fallan porque `cuerpo.rutas` es `[]` (relleno de la Tarea 2).

- [ ] **Paso 3: `rutas()` en el repositorio**

En `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts`, en el `import type { … } from
'./contrato'` agregar `RutaPull`, y después del método `notasPendientes` (antes del bloque `/* Push */`):

```ts
  /**
   * La ruta diaria del vendedor del token (T-37, D12).
   *
   * - **Solo la suya**: el alcance de T-09 dice que un vendedor jala lo suyo.
   * - Solo `tipo = 'diaria'`: la semanal (T-36) no viaja.
   * - **Ventana por el reloj de Postgres**: de ayer a dentro de 7 dias. La base
   *   corre en UTC; el `- 1` es lo que mantiene "hoy en Tijuana" dentro de la
   *   ventana despues de las 17:00 locales, cuando en UTC ya es manana. La
   *   tablet decide que dia muestra con su reloj local; el `+ 7` es para que una
   *   ruta asignada el viernes para el lunes baje el viernes. No lo "corrijas" a
   *   la zona de Tijuana: el spec la fija asi.
   * - Sin `desde`, solo las vivas. Con `desde`, todo lo que cambio: una fila que
   *   la oficina quito viaja con `activo: 0` (baja como bandera, nunca como
   *   ausencia; `ruta` no tiene columna `activo`).
   */
  async rutas(vendedorId: string, desde: Date | null): Promise<RutaPull[]> {
    let q = this.db
      .selectFrom('ruta')
      .select([
        'id',
        'cliente_id',
        // `date` -> texto en Postgres: el driver lo convertiria a Date en la
        // hora local del proceso.
        sql<string>`to_char(fecha, 'YYYY-MM-DD')`.as('fecha'),
        'orden',
        'origen',
        'deleted_at',
      ])
      .where('vendedor_id', '=', vendedorId)
      .where('tipo', '=', 'diaria')
      .where(sql<boolean>`fecha between current_date - 1 and current_date + 7`);
    if (desde) {
      q = q.where('updated_at', '>', desde);
    } else {
      q = q.where('deleted_at', 'is', null);
    }

    return (await q.orderBy('fecha').orderBy('orden').execute()).map((f) => ({
      id: f.id,
      cliente_id: f.cliente_id,
      fecha: f.fecha,
      orden: f.orden,
      origen: f.origen as 'oficina' | 'vendedor',
      activo: bandera(true, f.deleted_at),
    }));
  }
```

- [ ] **Paso 4: El servicio la manda**

En `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`, en `pull`, el `Promise.all` queda:

```ts
    const [
      sucursales,
      vendedores,
      vehiculos,
      productos,
      presentaciones,
      clientes,
      tiposNegocio,
      notasPendientes,
      rutas,
    ] = await Promise.all([
      this.repo.sucursales(vendedor.sucursal_id, desde),
      this.repo.vendedores(vendedor.id, desde),
      this.repo.vehiculos(vendedor.sucursal_id, desde),
      this.repo.productos(desde),
      this.repo.presentaciones(desde),
      this.repo.clientes(vendedor.sucursal_id, desde),
      // T-40: el desplegable de la pantalla de prospectos. No lleva sucursal.
      this.repo.tiposNegocio(desde),
      this.repo.notasPendientes(vendedor.sucursal_id, desde),
      // T-37: la ruta diaria. Por VENDEDOR, no por sucursal.
      this.repo.rutas(vendedor.id, desde),
    ]);
```

y en el `return`, la línea `rutas: [],` de la Tarea 2 (con su comentario) se sustituye por:

```ts
      rutas,
```

- [ ] **Paso 5: Ver que pasa**

Run: `npm run test:e2e --workspace=apps/backend -- -t "ruta diaria: pull"`
Expected: PASS, 2 pruebas.

- [ ] **Paso 6: Formato, lint, suites**

Run:
```bash
npm exec --workspace=apps/backend -- prettier --write src/modules/sincronizacion/sincronizacion.repository.ts \
  src/modules/sincronizacion/sincronizacion.service.ts test/sincronizacion.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/sincronizacion/sincronizacion.repository.ts \
  src/modules/sincronizacion/sincronizacion.service.ts test/sincronizacion.e2e-spec.ts
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
```
Expected: sin errores de lint; compila; unitarias igual que la línea base; e2e = línea base + 2, todas en verde.

- [ ] **Paso 7: Commit**

```bash
git add apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts \
  apps/backend/src/modules/sincronizacion/sincronizacion.service.ts apps/backend/test/sincronizacion.e2e-spec.ts
git commit -m "T-37: el pull baja la ruta diaria del vendedor con su ventana de fechas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 4: Proyección de `ruta-alta` — forma, servicio, cableado en `push` y e2e (D13)

**Archivos:**
- Crear: `apps/backend/src/modules/rutas/datos-ruta-alta.ts`, `apps/backend/src/modules/rutas/datos-ruta-alta.spec.ts`
- Crear: `apps/backend/src/modules/rutas/ruta-rechazada.ts`
- Crear: `apps/backend/src/modules/sincronizacion/despacho-ruta-alta.ts`,
  `apps/backend/src/modules/sincronizacion/despacho-ruta-alta.spec.ts`
- Crear: `apps/backend/src/modules/rutas/rutas-diarias.repository.ts`
- Crear: `apps/backend/src/modules/rutas/rutas-diarias.service.ts`,
  `apps/backend/src/modules/rutas/rutas-diarias.service.spec.ts`
- Modificar: `apps/backend/src/modules/rutas/rutas.module.ts`
- Modificar: `apps/backend/src/modules/sincronizacion/despacho.ts`, `despacho.spec.ts`
- Modificar: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`
- Modificar: `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts` (`guardarOperacion`)
- Modificar: `apps/backend/test/sincronizacion.e2e-spec.ts`

**Interfaces:**
- Consume: Tarea 1 (`uq_ruta_diaria_vendedor_fecha_cliente`); Tarea 2 (`'ruta-alta'`, códigos); Tarea 3 (helpers
  del e2e `clienteDeRuta`, `sembrarRuta`).
- Produce:
  - `normalizarDatosRutaAlta(datos: Record<string, unknown>): ResultadoDatosRutaAlta` con
    `RutaAltaNormalizada { clienteId: string }` (uuid en minúsculas).
  - `RazonRechazoRuta = 'cliente-inexistente' | 'ruta-duplicada'` y `class RutaRechazada extends Error { razon }`.
  - `prepararRutaAlta(op: OperacionNormalizada): PreparacionRutaAlta` y
    `CODIGO_POR_RAZON_RUTA: Record<RazonRechazoRuta, CodigoRechazo>`.
  - `RutasDiariasRepository` (con `@Inject(DB_CONNECTION) db`): `clienteParaRuta(clienteId, sucursalId, trx):
    Promise<boolean>`, `bloquearVendedor(vendedorId, trx): Promise<void>`, `siguienteOrden(vendedorId, fecha, trx):
    Promise<number>`, `insertarSiNoExiste(nueva: NuevaFilaRuta, trx): Promise<string | null>`. La Tarea 5 le suma
    los métodos del portal.
  - `RutasDiariasService.agregarAlDia(alta: RutaAltaNormalizada, contexto: ContextoRutaAlta, trx:
    Transaction<DB>): Promise<EntidadRuta>` con `ContextoRutaAlta { sucursalId; vendedorId; fechaOperacion }` y
    `EntidadRuta { tabla: 'ruta'; id: string }`. Lanza `RutaRechazada`.
  - `RutasModule` provee `RutasDiariasService` y `RutasDiariasRepository` y exporta `RutasDiariasService`.
  - `Proyeccion` gana `{ tipo: 'ruta-alta'; alta: RutaAltaNormalizada }`.

**Decisiones de esta tarea (ya tomadas; no las cambies sin preguntar):**

1. **El cliente va en `datos`, no en el sobre** (D13). Con el `cliente_id` del sobre, el paso 2 de `push`
   (`clientesEnAlcance`) respondería `cliente-fuera-de-alcance` antes de llegar al dominio, y el prospecto o el
   cliente borrado nunca saldrían como `cliente-inexistente`. Si una tablet manda **también** `cliente_id` en el
   sobre y no coincide con el de `datos`, es `ruta-datos-invalidos`.
2. **El buzón conserva el cliente.** `guardarOperacion` escribía `{ ...op.datos, cliente_id: op.clienteId }`, que
   con el sobre sin cliente pisaba `datos.cliente_id` con `null`. Ahora es `op.clienteId ?? op.datos.cliente_id ??
   null`: en `venta`/`cobranza` gana el del sobre (como siempre); en `jornada`/`prospecto`/`gasto`, `datos` no
   trae `cliente_id` y sigue quedando `null`. Review Focus 5.
3. **`ruta-duplicada` con `on conflict … do nothing`**, igual que `jornada-duplicada` (T-38): ni `select` previo
   (deja ventana) ni atrapar el `23505` (aborta la transacción). El predicado del índice parcial tiene dos partes;
   la de `tipo` se escribe **literal** (`sql\`tipo = 'diaria'\``) y no como parámetro, para que Postgres pueda
   inferir el índice árbitro sin depender del valor de un `$n`. Si el e2e falla con "there is no unique or
   exclusion constraint matching the ON CONFLICT specification", el problema está ahí.
4. **Bloqueo de la fila del vendedor** (`select … for no key update`) antes de calcular el orden siguiente.
   Serializa el alta con otra alta del mismo vendedor y con el `PUT` del portal (Tarea 5), que bloquea la misma
   fila: sin él, dos transacciones calculan el mismo `max(orden) + 1`, y un `PUT` que lee las vivas antes del
   commit de un alta revienta con `23505`. `no key update` y no `update`: no bloquea los inserts de otras tablas
   que solo referencian al vendedor por llave foránea (ventas, jornada).
5. **Prospecto, borrado u otra sucursal → `cliente-inexistente`** (D13); un cliente "inactivo" no existe como
   columna en `cliente` (su única baja es `deleted_at`), así que no hay caso aparte.
6. **Sin folio**: un `ruta-alta` con folio es `ruta-datos-invalidos` (ocuparía un número de la serie de ventas en
   `sync_operacion.folio`), igual que el prospecto.

- [ ] **Paso 1: Prueba de la forma (falla)**

Crear `apps/backend/src/modules/rutas/datos-ruta-alta.spec.ts`:

```ts
import { normalizarDatosRutaAlta } from './datos-ruta-alta';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';

describe('normalizarDatosRutaAlta (T-37)', () => {
  it('un cliente uuid entra, en minusculas', () => {
    expect(normalizarDatosRutaAlta({ cliente_id: CLIENTE.toUpperCase() })).toEqual({
      ok: true,
      alta: { clienteId: CLIENTE },
    });
  });

  it('ignora cualquier otro campo de datos', () => {
    expect(
      normalizarDatosRutaAlta({ cliente_id: CLIENTE, orden: 3, fecha: 'x' }),
    ).toEqual({ ok: true, alta: { clienteId: CLIENTE } });
  });

  it.each([
    ['sin cliente_id', {}],
    ['cliente_id null', { cliente_id: null }],
    ['cliente_id numero', { cliente_id: 7 }],
    ['cliente_id que no es uuid', { cliente_id: 'cli-1' }],
    ['uuid con espacios', { cliente_id: ` ${CLIENTE} ` }],
  ])('%s se rechaza nombrando el campo', (_caso, datos) => {
    const r = normalizarDatosRutaAlta(datos);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('debia rechazarse');
    expect(r.motivo).toContain('cliente_id');
  });
});
```

- [ ] **Paso 2: Prueba del traductor (falla)**

Crear `apps/backend/src/modules/sincronizacion/despacho-ruta-alta.spec.ts`:

```ts
import { CODIGOS_RECHAZO } from './contrato';
import { CODIGO_POR_RAZON_RUTA, prepararRutaAlta } from './despacho-ruta-alta';
import type { OperacionNormalizada } from './operaciones';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';

const op = (extra: Partial<OperacionNormalizada> = {}): OperacionNormalizada => ({
  clave: 'c0ffee00-0000-4000-8000-000000000037',
  tipo: 'ruta-alta',
  fechaOperacion: '2026-10-12',
  ocurridoEn: '2026-10-12T16:05:00.000Z',
  clienteId: null,
  folio: null,
  datos: { cliente_id: CLIENTE },
  ...extra,
});

describe('prepararRutaAlta (T-37)', () => {
  it('un alta valida se prepara para RutasDiariasService', () => {
    expect(prepararRutaAlta(op())).toEqual({
      ok: true,
      alta: { clienteId: CLIENTE },
    });
  });

  it('datos sin cliente es ruta-datos-invalidos, no el generico datos-invalidos', () => {
    const r = prepararRutaAlta(op({ datos: {} }));
    expect(r).toMatchObject({ ok: false, codigo: 'ruta-datos-invalidos' });
    if (r.ok) throw new Error('debia rechazarse');
    expect(r.motivo).toContain('cliente_id');
  });

  it('un alta con folio es ruta-datos-invalidos: no es una nota que nadie firme', () => {
    expect(prepararRutaAlta(op({ folio: 'TJ261012AP01' }))).toMatchObject({
      ok: false,
      codigo: 'ruta-datos-invalidos',
    });
  });

  it('un cliente en el sobre que no coincide con el de datos es ruta-datos-invalidos', () => {
    expect(
      prepararRutaAlta(op({ clienteId: '11111111-1111-4111-8111-111111111111' })),
    ).toMatchObject({ ok: false, codigo: 'ruta-datos-invalidos' });
  });

  it('el mismo cliente en el sobre y en datos se acepta', () => {
    expect(prepararRutaAlta(op({ clienteId: CLIENTE }))).toMatchObject({ ok: true });
  });

  it('cada razon del dominio sale con un codigo que existe en el contrato', () => {
    for (const codigo of Object.values(CODIGO_POR_RAZON_RUTA)) {
      expect(CODIGOS_RECHAZO).toContain(codigo);
    }
  });
});
```

- [ ] **Paso 3: Ver que fallan**

Run: `npm test --workspace=apps/backend -- ruta-alta`
Expected: FAIL, `Cannot find module './datos-ruta-alta'` y `Cannot find module './despacho-ruta-alta'`.

- [ ] **Paso 4: `rutas/datos-ruta-alta.ts`**

```ts
/**
 * Validacion y normalizacion de `datos` de un alta de ruta (T-37, D13).
 *
 * Pura, sin base de datos: decide si el alta tiene la FORMA correcta. Que el
 * cliente exista, sea de la sucursal del vendedor y no sea prospecto, y que no
 * este ya en la ruta de ese dia, lo decide `RutasDiariasService` dentro de la
 * transaccion.
 *
 * Comprueba el uuid ANTES de consultar por la misma razon que `operaciones.ts`:
 * `where id = 'no-soy-uuid'` hace que Postgres reviente con un 500 para todo el
 * lote, y la tablet traduce un 5xx a "sin red" y reintentaria para siempre.
 */

/** El alta ya validada. Vendedor, sucursal y fecha viajan en el `contexto`. */
export interface RutaAltaNormalizada {
  /** uuid en minusculas (Postgres los devuelve asi). */
  clienteId: string;
}

export type ResultadoDatosRutaAlta =
  | { ok: true; alta: RutaAltaNormalizada }
  /** El `motivo` empieza por el campo: es lo que guarda la tablet en `sync_error`. */
  | { ok: false; motivo: string };

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida y normaliza `datos` de una operacion `ruta-alta`. */
export function normalizarDatosRutaAlta(
  datos: Record<string, unknown>,
): ResultadoDatosRutaAlta {
  const clienteId = datos.cliente_id;
  if (typeof clienteId !== 'string' || !RE_UUID.test(clienteId)) {
    return {
      ok: false,
      motivo: 'cliente_id: tiene que ser el uuid de un cliente de tu sucursal.',
    };
  }
  return { ok: true, alta: { clienteId: clienteId.toLowerCase() } };
}
```

- [ ] **Paso 5: `rutas/ruta-rechazada.ts`**

```ts
/**
 * Un alta de ruta que el DOMINIO no acepta (T-37).
 *
 * Igual que `JornadaRechazada`: no importa nada del contrato de
 * sincronizacion. `push` la traduce a su codigo
 * (`sincronizacion/despacho-ruta-alta.ts`).
 *
 * La forma de `datos` no esta aqui: se rechaza antes de abrir la transaccion
 * (`datos-ruta-alta.ts`).
 */
export type RazonRechazoRuta =
  /**
   * El cliente no existe, esta dado de baja (`deleted_at`), es de otra sucursal
   * que la del vendedor, o es un prospecto (D7).
   */
  | 'cliente-inexistente'
  /** Ya hay una fila viva de ese vendedor, fecha y cliente, subida con otra clave. */
  | 'ruta-duplicada';

export interface RechazoRuta {
  razon: RazonRechazoRuta;
  /** En el espanol que leera quien tenga la tablet en la mano. */
  motivo: string;
}

export class RutaRechazada extends Error {
  readonly razon: RazonRechazoRuta;

  constructor({ razon, motivo }: RechazoRuta) {
    super(motivo);
    this.name = 'RutaRechazada';
    this.razon = razon;
  }
}
```

- [ ] **Paso 6: `sincronizacion/despacho-ruta-alta.ts`**

```ts
import {
  normalizarDatosRutaAlta,
  type RutaAltaNormalizada,
} from '../rutas/datos-ruta-alta';
import type { RazonRechazoRuta } from '../rutas/ruta-rechazada';
import type { CodigoRechazo } from './contrato';
import type { OperacionNormalizada, Rechazo } from './operaciones';

/**
 * La parte del despachador que es del alta de ruta (T-37), en su propio
 * archivo para que `despacho.ts` se quede en un `case` corto por tipo (acuerdo
 * de T-40). Puro, sin base.
 */

export type PreparacionRutaAlta =
  { ok: true; alta: RutaAltaNormalizada } | ({ ok: false } & Rechazo);

/**
 * Valida la FORMA de un alta de ruta antes de abrir la transaccion. Un rechazo
 * aqui no toca la base.
 */
export function prepararRutaAlta(op: OperacionNormalizada): PreparacionRutaAlta {
  // Un alta de ruta no es una nota que nadie firme. Si trajera folio, ocuparia
  // un numero de la serie de ventas en `sync_operacion.folio` (mismo criterio
  // que el prospecto, T-40).
  if (op.folio !== null) {
    return {
      ok: false,
      codigo: 'ruta-datos-invalidos',
      motivo: 'folio: un alta de ruta no lleva folio.',
    };
  }

  const r = normalizarDatosRutaAlta(op.datos);
  if (!r.ok) {
    // Codigo propio y no el generico `datos-invalidos`: la tablet distingue un
    // sobre mal armado de un cliente que ya no existe.
    return { ok: false, codigo: 'ruta-datos-invalidos', motivo: r.motivo };
  }

  // El cliente va en `datos` (contrato §6). Una tablet que lo mande tambien en
  // el sobre no se rechaza... salvo que sean dos clientes distintos.
  if (op.clienteId !== null && op.clienteId.toLowerCase() !== r.alta.clienteId) {
    return {
      ok: false,
      codigo: 'ruta-datos-invalidos',
      motivo: 'cliente_id: el del sobre y el de datos no coinciden.',
    };
  }

  return { ok: true, alta: r.alta };
}

/**
 * Razon del dominio a codigo del contrato. Un `Record`: si `rutas` agrega una
 * razon, esto deja de compilar hasta asignarle codigo.
 */
export const CODIGO_POR_RAZON_RUTA: Record<RazonRechazoRuta, CodigoRechazo> = {
  'cliente-inexistente': 'cliente-inexistente',
  'ruta-duplicada': 'ruta-duplicada',
};
```

- [ ] **Paso 7: Ver que las dos pruebas puras pasan**

Run: `npm test --workspace=apps/backend -- ruta-alta`
Expected: PASS (`datos-ruta-alta.spec.ts` y `despacho-ruta-alta.spec.ts`).

- [ ] **Paso 8: Prueba del servicio (falla)**

Crear `apps/backend/src/modules/rutas/rutas-diarias.service.spec.ts`:

```ts
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { RutaRechazada } from './ruta-rechazada';
import type { RutasDiariasRepository } from './rutas-diarias.repository';
import {
  RutasDiariasService,
  type ContextoRutaAlta,
} from './rutas-diarias.service';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';

/** El servicio no usa la transaccion: solo la pasa a quien escribe. */
const trx = {} as Transaction<DB>;

const contexto: ContextoRutaAlta = {
  sucursalId: 'sucursal-tj',
  vendedorId: 'vendedor-1',
  fechaOperacion: '2026-10-12',
};

function montar(
  opciones: {
    clienteValido?: boolean;
    siguiente?: number;
    idInsertado?: string | null;
  } = {},
) {
  const repo = {
    clienteParaRuta: jest
      .fn()
      .mockResolvedValue(opciones.clienteValido ?? true),
    bloquearVendedor: jest.fn().mockResolvedValue(undefined),
    siguienteOrden: jest.fn().mockResolvedValue(opciones.siguiente ?? 1),
    insertarSiNoExiste: jest
      .fn()
      .mockResolvedValue(
        'idInsertado' in opciones ? opciones.idInsertado : 'ruta-1',
      ),
  };
  return {
    servicio: new RutasDiariasService(
      repo as unknown as RutasDiariasRepository,
    ),
    repo,
  };
}

describe('RutasDiariasService.agregarAlDia (T-37)', () => {
  it('inserta al final de la ruta de ese dia, como del vendedor, y devuelve la fila para el buzon', async () => {
    const { servicio, repo } = montar({ siguiente: 6 });

    await expect(
      servicio.agregarAlDia({ clienteId: CLIENTE }, contexto, trx),
    ).resolves.toEqual({ tabla: 'ruta', id: 'ruta-1' });

    expect(repo.clienteParaRuta).toHaveBeenCalledWith(
      CLIENTE,
      'sucursal-tj',
      trx,
    );
    expect(repo.bloquearVendedor).toHaveBeenCalledWith('vendedor-1', trx);
    expect(repo.siguienteOrden).toHaveBeenCalledWith(
      'vendedor-1',
      '2026-10-12',
      trx,
    );
    expect(repo.insertarSiNoExiste).toHaveBeenCalledWith(
      {
        vendedorId: 'vendedor-1',
        clienteId: CLIENTE,
        fecha: '2026-10-12',
        orden: 6,
        origen: 'vendedor',
      },
      trx,
    );
  });

  it('el orden se calcula DESPUES de bloquear al vendedor', async () => {
    const { servicio, repo } = montar();
    await servicio.agregarAlDia({ clienteId: CLIENTE }, contexto, trx);

    const bloqueo = repo.bloquearVendedor.mock.invocationCallOrder[0];
    const orden = repo.siguienteOrden.mock.invocationCallOrder[0];
    expect(bloqueo).toBeLessThan(orden);
  });

  it('un cliente que no es de la sucursal, borrado o prospecto es cliente-inexistente y no escribe nada', async () => {
    const { servicio, repo } = montar({ clienteValido: false });

    const error = await servicio
      .agregarAlDia({ clienteId: CLIENTE }, contexto, trx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RutaRechazada);
    expect(error).toMatchObject({ razon: 'cliente-inexistente' });
    expect(repo.insertarSiNoExiste).not.toHaveBeenCalled();
  });

  it('si ya habia una fila viva de ese cliente ese dia es ruta-duplicada', async () => {
    const { servicio } = montar({ idInsertado: null });

    const error = await servicio
      .agregarAlDia({ clienteId: CLIENTE }, contexto, trx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RutaRechazada);
    expect(error).toMatchObject({ razon: 'ruta-duplicada' });
    expect((error as Error).message).toContain('2026-10-12');
  });
});
```

- [ ] **Paso 9: Ver que falla**

Run: `npm test --workspace=apps/backend -- rutas-diarias.service`
Expected: FAIL, `Cannot find module './rutas-diarias.service'`.

- [ ] **Paso 10: `rutas/rutas-diarias.repository.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';

export type OrigenRuta = 'oficina' | 'vendedor';

/** Una fila de `ruta` diaria lista para escribir. */
export interface NuevaFilaRuta {
  vendedorId: string;
  clienteId: string;
  /** `AAAA-MM-DD`. En un alta de la tablet, la `fecha_operacion` tal cual. */
  fecha: string;
  orden: number;
  origen: OrigenRuta;
}

/**
 * SQL de la ruta diaria (T-37).
 *
 * Los metodos del push reciben la `trx` de la operacion y ninguno abre la suya:
 * el alta entra o sale junto con su fila del buzon (ADR-0009 §2.3). Los del
 * portal (Tarea 5) usan `enTransaccion`.
 */
@Injectable()
export class RutasDiariasRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * ¿El cliente existe, no esta dado de baja, es de esa sucursal y es
   * `tipo = 'cliente'`? A un prospecto no se le vende (D7), asi que no entra a
   * la ruta.
   */
  async clienteParaRuta(
    clienteId: string,
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<boolean> {
    const fila = await trx
      .selectFrom('cliente')
      .select('id')
      .where('id', '=', clienteId)
      .where('sucursal_id', '=', sucursalId)
      .where('tipo', '=', 'cliente')
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * Bloquea la fila del vendedor hasta el fin de la transaccion.
   *
   * Es el candado comun del alta (push) y del reemplazo (portal) de la ruta de
   * ese vendedor: sin el, dos transacciones calculan el mismo orden siguiente, o
   * el portal lee las vivas antes de que un alta haga commit y revienta con
   * `23505`. `for no key update` y no `for update`: no bloquea los inserts de
   * otras tablas que solo referencian al vendedor (ventas, jornada).
   */
  async bloquearVendedor(
    vendedorId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .selectFrom('vendedor')
      .select('id')
      .where('id', '=', vendedorId)
      .forNoKeyUpdate()
      .execute();
  }

  /** `max(orden) + 1` entre las vivas de ese vendedor y dia, o `1` si no hay. */
  async siguienteOrden(
    vendedorId: string,
    fecha: string,
    trx: Transaction<DB>,
  ): Promise<number> {
    const fila = await trx
      .selectFrom('ruta')
      .select(sql<number>`coalesce(max(orden), 0) + 1`.as('siguiente'))
      .where('vendedor_id', '=', vendedorId)
      .where('fecha', '=', fecha)
      .where('tipo', '=', 'diaria')
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(fila.siguiente);
  }

  /**
   * Inserta la fila, o devuelve `null` si ese vendedor ya tenia a ese cliente
   * vivo en la ruta diaria de ese dia (`uq_ruta_diaria_vendedor_fecha_cliente`).
   *
   * `on conflict ... do nothing` y no atrapar el `23505`: un `unique_violation`
   * aborta la transaccion entera de Postgres (T-16, D10). El predicado del
   * indice parcial va entero para que Postgres lo pueda usar como arbitro, y el
   * `tipo = 'diaria'` va LITERAL (no como parametro `$n`): la inferencia del
   * indice compara contra constantes.
   */
  async insertarSiNoExiste(
    nueva: NuevaFilaRuta,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .insertInto('ruta')
      .values({
        vendedor_id: nueva.vendedorId,
        cliente_id: nueva.clienteId,
        fecha: nueva.fecha,
        orden: nueva.orden,
        origen: nueva.origen,
        tipo: 'diaria',
      })
      .onConflict((oc) =>
        oc
          .columns(['vendedor_id', 'fecha', 'cliente_id'])
          .where('deleted_at', 'is', null)
          .where(sql<boolean>`tipo = 'diaria'`)
          .doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    return fila?.id ?? null;
  }
}
```

- [ ] **Paso 11: `rutas/rutas-diarias.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { RutaAltaNormalizada } from './datos-ruta-alta';
import { RutaRechazada } from './ruta-rechazada';
import { RutasDiariasRepository } from './rutas-diarias.repository';

/**
 * Quien y cuando de un alta de ruta. Todo sale del token o del sobre:
 *
 * - `sucursalId` y `vendedorId`: los del vendedor del token.
 * - `fechaOperacion`: la del sobre, tal cual la calculo la tablet. El servidor
 *   no la re-deriva de UTC; un alta capturada ayer sin red y subida hoy cae en
 *   la ruta de AYER.
 */
export interface ContextoRutaAlta {
  sucursalId: string;
  vendedorId: string;
  fechaOperacion: string;
}

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadRuta {
  tabla: 'ruta';
  id: string;
}

/**
 * La ruta diaria en el servidor (T-37): la proyeccion de `ruta-alta` (aqui) y
 * la pantalla Ruta Diaria del portal (Tarea 5). Vive en `rutas/` porque es el
 * slug del vault para [[Rutas]].
 */
@Injectable()
export class RutasDiariasService {
  constructor(private readonly repo: RutasDiariasRepository) {}

  /**
   * Agrega al final de la ruta de ese dia un cliente que el vendedor sumo a
   * mano, dentro de la transaccion de quien llama (ADR-0009).
   *
   * @throws {RutaRechazada} `cliente-inexistente` o `ruta-duplicada`. No
   * escribe nada antes de lanzar.
   */
  async agregarAlDia(
    alta: RutaAltaNormalizada,
    contexto: ContextoRutaAlta,
    trx: Transaction<DB>,
  ): Promise<EntidadRuta> {
    const valido = await this.repo.clienteParaRuta(
      alta.clienteId,
      contexto.sucursalId,
      trx,
    );
    if (!valido) {
      throw new RutaRechazada({
        razon: 'cliente-inexistente',
        motivo: `El cliente ${alta.clienteId} no existe, está dado de baja, es un prospecto o no es de tu sucursal.`,
      });
    }

    // Antes de leer el orden: ver `bloquearVendedor`.
    await this.repo.bloquearVendedor(contexto.vendedorId, trx);
    const orden = await this.repo.siguienteOrden(
      contexto.vendedorId,
      contexto.fechaOperacion,
      trx,
    );

    const id = await this.repo.insertarSiNoExiste(
      {
        vendedorId: contexto.vendedorId,
        clienteId: alta.clienteId,
        fecha: contexto.fechaOperacion,
        orden,
        origen: 'vendedor',
      },
      trx,
    );
    if (id === null) {
      // La oficina (u otra tablet) ya lo tenia. La tablet lo trata como
      // aplicado (D15): no es un error del vendedor.
      throw new RutaRechazada({
        razon: 'ruta-duplicada',
        motivo: `El cliente ya está en tu ruta del ${contexto.fechaOperacion}.`,
      });
    }

    return { tabla: 'ruta', id };
  }
}
```

- [ ] **Paso 12: Ver que la prueba del servicio pasa**

Run: `npm test --workspace=apps/backend -- rutas-diarias.service`
Expected: PASS, 4 pruebas.

- [ ] **Paso 13: Módulo**

`apps/backend/src/modules/rutas/rutas.module.ts` queda:

```ts
import { Module } from '@nestjs/common';
import { JornadasRepository } from './jornadas.repository';
import { JornadasService } from './jornadas.service';
import { RutasDiariasRepository } from './rutas-diarias.repository';
import { RutasDiariasService } from './rutas-diarias.service';
import { VehiculosController } from './vehiculos.controller';
import { VehiculosRepository } from './vehiculos.repository';
import { VehiculosService } from './vehiculos.service';

// Vehiculos vive aqui y no en un `modules/vehiculos/` nuevo: el CLAUDE.md fija
// que los modulos usan los slugs del vault, y `Vehículo.md` declara
// `modulo: rutas` (D1).
//
// T-38: exporta `JornadasService` para que sincronizacion/ proyecte la jornada
// que sube la tablet (ADR-0009); la dependencia va de sincronizacion hacia
// aqui, nunca al reves. T-37 hace lo mismo con `RutasDiariasService` y el
// `ruta-alta`.
@Module({
  controllers: [VehiculosController],
  providers: [
    VehiculosService,
    VehiculosRepository,
    JornadasService,
    JornadasRepository,
    RutasDiariasService,
    RutasDiariasRepository,
  ],
  exports: [JornadasService, RutasDiariasService],
})
export class RutasModule {}
```

(`SincronizacionModule` ya importa `RutasModule` desde T-38: no se toca.)

- [ ] **Paso 14: `despacho.spec.ts` (falla)**

En `apps/backend/src/modules/sincronizacion/despacho.spec.ts`, después de la prueba `'una cobranza pasa por
prepararCobranza y sale como proyeccion de cobranza (T-20)'`, agregar:

```ts
  it('un alta de ruta pasa por prepararRutaAlta y sale como proyeccion de ruta-alta (T-37)', () => {
    expect(
      prepararProyeccion(
        op({
          tipo: 'ruta-alta',
          folio: null,
          clienteId: null,
          datos: { cliente_id: CLIENTE.toUpperCase() },
        }),
      ),
    ).toEqual({
      ok: true,
      proyeccion: { tipo: 'ruta-alta', alta: { clienteId: CLIENTE } },
    });
  });

  it('un alta de ruta sin cliente es ruta-datos-invalidos (T-37)', () => {
    expect(
      prepararProyeccion(
        op({ tipo: 'ruta-alta', folio: null, clienteId: null, datos: {} }),
      ),
    ).toMatchObject({ ok: false, codigo: 'ruta-datos-invalidos' });
  });
```

Run: `npm test --workspace=apps/backend -- despacho.spec`
Expected: FAIL en la primera (hoy sale `proyeccion: null`, el relleno de la Tarea 2).

- [ ] **Paso 15: `despacho.ts`**

En `apps/backend/src/modules/sincronizacion/despacho.ts`:

a) Imports, junto a los de jornada:

```ts
import type { RutaAltaNormalizada } from '../rutas/datos-ruta-alta';
import { prepararRutaAlta } from './despacho-ruta-alta';
```

b) `Proyeccion` gana, después de la línea de `jornada`:

```ts
  // T-37. La fila es de `ruta`; vendedor, sucursal y fecha van en el contexto.
  | { tipo: 'ruta-alta'; alta: RutaAltaNormalizada };
```

(quita el `;` final de la línea de `jornada` para que la unión siga).

c) El `case 'ruta-alta'` de relleno de la Tarea 2 se sustituye por:

```ts
    case 'ruta-alta': {
      // T-37. La forma la revisa `despacho-ruta-alta.ts`; el cliente y el dia
      // repetido, `RutasDiariasService` dentro de la transaccion.
      const r = prepararRutaAlta(op);
      if (!r.ok) return r;
      return { ok: true, proyeccion: { tipo: 'ruta-alta', alta: r.alta } };
    }
```

y el comentario de `Proyeccion` ("Orden acordado entre tickets: …") suma `` `ruta-alta` (T-37)``.

**No compiles todavía**: `sincronizacion.service.ts#proyectar()` deja de cubrir la unión hasta el Paso 16.

- [ ] **Paso 16: `sincronizacion.service.ts`**

a) Imports:

```ts
import { RutaRechazada } from '../rutas/ruta-rechazada';
import { RutasDiariasService } from '../rutas/rutas-diarias.service';
import { CODIGO_POR_RAZON_RUTA } from './despacho-ruta-alta';
```

b) Constructor, después de `private readonly jornadas: JornadasService,`:

```ts
    // T-37: Rutas tambien es la duena de la ruta diaria (`ruta-alta`).
    private readonly rutasDiarias: RutasDiariasService,
```

c) En `aplicar()`, en el `catch`, después del bloque de `JornadaRechazada`:

```ts
      // T-37: el rollback ya dejo sin fila tanto el buzon como la ruta. La
      // tablet trata `ruta-duplicada` como aplicada (D15).
      if (error instanceof RutaRechazada) {
        return {
          clave: op.clave,
          tipo: op.tipo,
          estado: 'rechazada',
          codigo: CODIGO_POR_RAZON_RUTA[error.razon],
          motivo: error.message,
        };
      }
```

d) En `proyectar()`, después del `case 'jornada'`:

```ts
      case 'ruta-alta':
        // La entidad del buzon es la fila de `ruta` (ADR-0009 §2.4, enmendado).
        return this.rutasDiarias.agregarAlDia(
          proyeccion.alta,
          {
            // Del token, nunca del cuerpo: el cliente se coteja contra ella.
            sucursalId: vendedor.sucursal_id,
            vendedorId: vendedor.id,
            // Tal cual lo mando la tablet: el servidor no re-deriva el dia de UTC.
            fechaOperacion: op.fechaOperacion,
          },
          trx,
        );
```

- [ ] **Paso 17: El buzón conserva el cliente (Review Focus 5)**

En `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts`, en `guardarOperacion`, la línea
`datos: JSON.stringify({ ...op.datos, cliente_id: op.clienteId }),` queda:

```ts
        // El `cliente_id` del sobre gana (venta, cobranza). Si el sobre no trae
        // uno, se conserva el de `datos`: un `ruta-alta` (T-37) lo lleva ahi, y
        // pisarlo con null dejaba el buzon sin saber de que cliente era.
        datos: JSON.stringify({
          ...op.datos,
          cliente_id: op.clienteId ?? op.datos.cliente_id ?? null,
        }),
```

- [ ] **Paso 18: e2e del push (falla si algo del cableado está mal)**

En `apps/backend/test/sincronizacion.e2e-spec.ts`, después del `describe('ruta diaria: pull (T-37)', …)`:

```ts
  describe('ruta diaria: push de ruta-alta (T-37)', () => {
    /** Un alta de ruta como la arma `fuente-rutas.ts`: el cliente va en `datos`. */
    const altaRuta = (
      cliente: string,
      fecha: string,
      extra: Record<string, unknown> = {},
    ) =>
      operacion({
        tipo: 'ruta-alta',
        fecha_operacion: fecha,
        ocurrido_en: `${fecha}T16:05:00.000-07:00`,
        datos: { cliente_id: cliente },
        ...extra,
      });

    /** Las filas de `ruta` del vendedor de la prueba para ese cliente. */
    const rutasDe = (cliente: string) =>
      db
        .selectFrom('ruta')
        .select([
          'id',
          'orden',
          'origen',
          'tipo',
          'deleted_at',
          sql<string>`to_char(fecha, 'YYYY-MM-DD')`.as('fecha'),
        ])
        .where('vendedor_id', '=', vendedorId)
        .where('cliente_id', '=', cliente)
        .orderBy('created_at')
        .execute();

    /** Un dia propio por prueba: la ruta del vendedor es nueva en cada corrida. */
    let ultimoDiaRuta = 0;
    const diaDeRuta = () =>
      new Date(Date.UTC(2024, 2, 1) + ultimoDiaRuta++ * 86_400_000)
        .toISOString()
        .slice(0, 10);

    it('un alta entra a `ruta` como del vendedor y el buzon dice a que fila se convirtio', async () => {
      const c = await clienteDeRuta();
      const fecha = diaDeRuta();
      const op = altaRuta(c, fecha);

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0].estado).toBe('aplicada');

      const filas = await rutasDe(c);
      expect(filas).toEqual([
        {
          id: expect.any(String) as string,
          orden: 1,
          origen: 'vendedor',
          tipo: 'diaria',
          deleted_at: null,
          fecha,
        },
      ]);
      expect(await buzonDe(op.clave)).toEqual({
        id: res.resultados[0].id_servidor,
        entidad_tabla: 'ruta',
        entidad_id: filas[0].id,
      });
    });

    it('el buzon conserva el cliente del alta en datos (Review Focus 5)', async () => {
      const c = await clienteDeRuta();
      const op = altaRuta(c, diaDeRuta());

      await push({ operaciones: [op] }).expect(200);

      const fila = await db
        .selectFrom('sync_operacion')
        .select(sql<string | null>`datos->>'cliente_id'`.as('cliente'))
        .where('vendedor_id', '=', vendedorId)
        .where('clave_idempotencia', '=', op.clave)
        .executeTakeFirstOrThrow();
      expect(fila.cliente).toBe(c);
    });

    it('va al final: orden siguiente a las vivas de ese vendedor y dia', async () => {
      const fecha = diaDeRuta();
      const deLaOficina = await clienteDeRuta();
      await sembrarRuta({ cliente: deLaOficina, fecha, orden: 5 });
      const quitado = await clienteDeRuta();
      // Una baja no cuenta para el orden.
      await sembrarRuta({ cliente: quitado, fecha, orden: 9, borrada: true });
      const c = await clienteDeRuta();

      const res = (await push({ operaciones: [altaRuta(c, fecha)] }).expect(200))
        .body as RespuestaPush;

      expect(res.resultados[0].estado).toBe('aplicada');
      expect(await rutasDe(c)).toMatchObject([{ orden: 6 }]);
    });

    it('un alta de AYER subida hoy cae en la ruta de ayer y no choca con la de hoy (Review Focus 2)', async () => {
      const hoy = hoyEnTijuana();
      const [a, m, d] = hoy.split('-').map(Number);
      const ayer = new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10);
      const c = await clienteDeRuta();
      // La oficina ya lo asigno para hoy.
      await sembrarRuta({ cliente: c, fecha: hoy, orden: 1 });

      const res = (await push({ operaciones: [altaRuta(c, ayer)] }).expect(200))
        .body as RespuestaPush;

      expect(res.resultados[0].estado).toBe('aplicada');
      const filas = await rutasDe(c);
      expect(filas.map((f) => [f.fecha, f.origen])).toEqual([
        [hoy, 'oficina'],
        [ayer, 'vendedor'],
      ]);
    });

    it('datos sin cliente es ruta-datos-invalidos, antes de la transaccion', async () => {
      const op = altaRuta('x', diaDeRuta(), { datos: {} });

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;

      expect(res.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'ruta-datos-invalidos',
      });
      expect(res.resultados[0].motivo).toContain('cliente_id');
      expect(await buzonDe(op.clave)).toBeUndefined();
    });

    it('un cliente de otra sucursal es cliente-inexistente y no deja fila', async () => {
      const op = altaRuta(clienteAjenoId, diaDeRuta());

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;

      expect(res.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'cliente-inexistente',
      });
      expect(await buzonDe(op.clave)).toBeUndefined();
      expect(await rutasDe(clienteAjenoId)).toHaveLength(0);
    });

    it('un prospecto es cliente-inexistente: a un prospecto no se le vende (D7)', async () => {
      const p = await clienteDeRuta({ tipo: 'prospecto' });
      const op = altaRuta(p, diaDeRuta());

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;

      expect(res.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'cliente-inexistente',
      });
      expect(await rutasDe(p)).toHaveLength(0);
    });

    it('un cliente dado de baja es cliente-inexistente', async () => {
      const borrado = await clienteDeRuta({ deleted_at: new Date() });
      const res = (
        await push({ operaciones: [altaRuta(borrado, diaDeRuta())] }).expect(200)
      ).body as RespuestaPush;

      expect(res.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'cliente-inexistente',
      });
    });

    it('el mismo cliente que la oficina ya asigno, con OTRA clave, es ruta-duplicada y no deja fila', async () => {
      const fecha = diaDeRuta();
      const c = await clienteDeRuta();
      await sembrarRuta({ cliente: c, fecha, orden: 1 });
      const op = altaRuta(c, fecha);

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;

      expect(res.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'ruta-duplicada',
      });
      expect(await buzonDe(op.clave)).toBeUndefined();
      expect(await rutasDe(c)).toMatchObject([{ origen: 'oficina' }]);
    });

    it('la MISMA clave reenviada es duplicada, con el mismo id y una sola fila', async () => {
      const c = await clienteDeRuta();
      const op = altaRuta(c, diaDeRuta());

      const primero = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      const segundo = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;

      expect(primero.resultados[0].estado).toBe('aplicada');
      expect(segundo.resultados[0]).toMatchObject({
        estado: 'duplicada',
        id_servidor: primero.resultados[0].id_servidor,
      });
      expect(await rutasDe(c)).toHaveLength(1);
    });
  });
```

- [ ] **Paso 19: Correr unitarias y e2e**

Run:
```bash
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend -- -t "ruta diaria"
```
Expected: compila; unitarias = línea base + las nuevas, en verde; las 2 de pull y las 10 de push en verde.

- [ ] **Paso 20: Formato, lint, suite e2e completa**

Run:
```bash
npm exec --workspace=apps/backend -- prettier --write src/modules/rutas/datos-ruta-alta.ts \
  src/modules/rutas/datos-ruta-alta.spec.ts src/modules/rutas/ruta-rechazada.ts \
  src/modules/rutas/rutas-diarias.repository.ts src/modules/rutas/rutas-diarias.service.ts \
  src/modules/rutas/rutas-diarias.service.spec.ts src/modules/rutas/rutas.module.ts \
  src/modules/sincronizacion/despacho-ruta-alta.ts src/modules/sincronizacion/despacho-ruta-alta.spec.ts \
  src/modules/sincronizacion/despacho.ts src/modules/sincronizacion/despacho.spec.ts \
  src/modules/sincronizacion/sincronizacion.service.ts src/modules/sincronizacion/sincronizacion.repository.ts \
  test/sincronizacion.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/rutas src/modules/sincronizacion \
  test/sincronizacion.e2e-spec.ts
npm run test:e2e --workspace=apps/backend
```
Expected: sin errores de lint; e2e completo = línea base + 12, en verde.

- [ ] **Paso 21: Commit**

```bash
git add apps/backend/src/modules/rutas apps/backend/src/modules/sincronizacion \
  apps/backend/test/sincronizacion.e2e-spec.ts
git commit -m "T-37: el push proyecta ruta-alta a la ruta diaria con sus rechazos

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Tarea 5: Endpoints del portal — `GET /rutas/diaria`, `PUT /rutas/diaria`, `GET /rutas/diaria/anterior` (D14)

**Archivos:**
- Crear: `apps/backend/src/modules/rutas/reemplazo-ruta.ts`, `apps/backend/src/modules/rutas/reemplazo-ruta.spec.ts`
- Crear: `apps/backend/src/modules/rutas/dto/ruta-diaria.dto.ts`
- Crear: `apps/backend/src/modules/rutas/rutas-diarias.controller.ts`
- Modificar: `apps/backend/src/modules/rutas/rutas-diarias.repository.ts`
- Modificar: `apps/backend/src/modules/rutas/rutas-diarias.service.ts`
- Modificar: `apps/backend/src/modules/rutas/rutas.module.ts`
- Crear: `apps/backend/test/rutas-diarias.e2e-spec.ts`

**Interfaces:**
- Consume: Tarea 1 (índices); Tarea 4 (`RutasDiariasRepository.bloquearVendedor`, `OrigenRuta`,
  `RutasDiariasService`).
- Produce (camelCase, ver *Conflictos* punto 1):
  - `GET /rutas/diaria?vendedorId=&fecha=` → `RutaDiaria { vendedor: { id; nombre; sucursalCodigo }; fecha:
    string; filas: FilaRutaDiaria[] }` con `FilaRutaDiaria { id; clienteId; clienteNombre; orden; origen }`, por
    `orden`. 404 si el vendedor no existe o no está en el alcance del usuario.
  - `PUT /rutas/diaria` con `{ vendedorId, fecha, clientes: string[] }` → el mismo cuerpo que el `GET`. 400 si un
    cliente se repite, no existe, está dado de baja, es prospecto o es de otra sucursal que la del vendedor.
  - `GET /rutas/diaria/anterior?vendedorId=&fecha=` → `RutaAnterior { fecha: string | null; clientes: string[] }`.
  - Los tres con `@RequierePermiso('ruta_diaria.gestionar')`.
  - `planearReemplazo(vivas: FilaViva[], clientes: string[]): PlanReemplazo` (puro).
  - La Tarea 11 (portal) consume estas formas tal cual.

**Decisiones de esta tarea:**
1. **404 y no 403 para un vendedor fuera del alcance** (spec D14): no se confirma que exista un vendedor de otra
   sucursal. Por eso la comprobación va escrita aquí y no con `exigirAlcanceSobre` (que responde 403).
2. **Reemplazo dentro de una transacción con la fila del vendedor bloqueada** (`bloquearVendedor`, el mismo
   candado que el alta de la Tarea 4): las vivas se leen después del candado, así que un alta que llegó un instante
   antes ya está confirmada y se adopta en vez de chocar con `23505`.
3. **El plan se calcula en una función pura** (`planearReemplazo`) con su prueba; el repositorio solo lo aplica.
   Una fila solo se actualiza si cambia su `orden` u `origen`: tocarla sin cambio movería `updated_at` y la haría
   bajar otra vez en el pull de cada tablet.
4. **Clientes válidos para la ruta**: vivos, `tipo = 'cliente'`, de la sucursal **del vendedor** (no la del
   usuario: un General arma rutas de cualquier sucursal). Mismo criterio que el alta de la tablet (D7). Los ids se
   comparan en minúsculas: `"A…"` y `"a…"` son el mismo cliente repetido.
5. **"Anterior"** busca la última fecha `< fecha` con filas vivas del vendedor y devuelve **solo** los clientes que
   siguen siendo válidos para la ruta (Review Focus 4): así "Copiar de ayer" + "Guardar" no termina en 400.

- [ ] **Paso 1: Prueba del plan de reemplazo (falla)**

Crear `apps/backend/src/modules/rutas/reemplazo-ruta.spec.ts`:

```ts
import { planearReemplazo, type FilaViva } from './reemplazo-ruta';

const fila = (
  id: string,
  clienteId: string,
  orden: number,
  origen: 'oficina' | 'vendedor' = 'oficina',
): FilaViva => ({ id, clienteId, orden, origen });

describe('planearReemplazo (T-37, D14)', () => {
  it('sin filas vivas inserta toda la lista en orden', () => {
    expect(planearReemplazo([], ['a', 'b'])).toEqual({
      actualizar: [],
      insertar: [
        { clienteId: 'a', orden: 1 },
        { clienteId: 'b', orden: 2 },
      ],
      borrar: [],
    });
  });

  it('una fila de la oficina que no viene se borra', () => {
    expect(
      planearReemplazo([fila('r1', 'a', 1), fila('r2', 'b', 2)], ['b']),
    ).toEqual({
      actualizar: [{ id: 'r2', orden: 1, origen: 'oficina' }],
      insertar: [],
      borrar: ['r1'],
    });
  });

  it('la fila del vendedor que viene en la lista se adopta: orden de la oficina y origen oficina', () => {
    expect(planearReemplazo([fila('r1', 'a', 1, 'vendedor')], ['b', 'a'])).toEqual({
      actualizar: [{ id: 'r1', orden: 2, origen: 'oficina' }],
      insertar: [{ clienteId: 'b', orden: 1 }],
      borrar: [],
    });
  });

  it('las del vendedor que no vienen se conservan al final, en su orden relativo', () => {
    const vivas = [
      fila('r1', 'a', 1),
      fila('r2', 'b', 2, 'vendedor'),
      fila('r3', 'd', 5, 'vendedor'),
    ];
    expect(planearReemplazo(vivas, ['c', 'a'])).toEqual({
      actualizar: [
        { id: 'r1', orden: 2, origen: 'oficina' },
        { id: 'r2', orden: 3, origen: 'vendedor' },
        { id: 'r3', orden: 4, origen: 'vendedor' },
      ],
      insertar: [{ clienteId: 'c', orden: 1 }],
      borrar: [],
    });
  });

  it('una fila que ya tiene el orden y el origen que le tocan no se toca', () => {
    expect(
      planearReemplazo(
        [fila('r1', 'a', 1), fila('r2', 'b', 2, 'vendedor')],
        ['a'],
      ),
    ).toEqual({ actualizar: [], insertar: [], borrar: [] });
  });

  it('una lista vacia quita las de la oficina y deja las del vendedor arriba', () => {
    expect(
      planearReemplazo(
        [fila('r1', 'a', 1), fila('r2', 'b', 2, 'vendedor')],
        [],
      ),
    ).toEqual({
      actualizar: [{ id: 'r2', orden: 1, origen: 'vendedor' }],
      insertar: [],
      borrar: ['r1'],
    });
  });
});
```

Run: `npm test --workspace=apps/backend -- reemplazo-ruta`
Expected: FAIL, `Cannot find module './reemplazo-ruta'`.

- [ ] **Paso 2: `rutas/reemplazo-ruta.ts`**

```ts
import type { OrigenRuta } from './rutas-diarias.repository';

/** Una fila viva de la ruta diaria de un vendedor y un dia, como la lee el reemplazo. */
export interface FilaViva {
  id: string;
  clienteId: string;
  orden: number;
  origen: OrigenRuta;
}

/** Lo que el `PUT` tiene que escribir. */
export interface PlanReemplazo {
  actualizar: { id: string; orden: number; origen: OrigenRuta }[];
  insertar: { clienteId: string; orden: number }[];
  /** Ids que se dan de baja (`deleted_at`). Solo filas de la oficina. */
  borrar: string[];
}

/**
 * El reemplazo de la ruta del portal (D14), sin base: la regla entera en una
 * funcion que se puede probar sola.
 *
 * - Cada cliente de la lista, en la posicion `i`, queda con `orden = i + 1` y
 *   `origen = 'oficina'`: si ya habia una fila viva (de cualquier origen) se
 *   actualiza esa; si no, se inserta. Asi la oficina **adopta** lo que el
 *   vendedor ya habia subido, sin crear otra fila.
 * - Las filas de la oficina que no vienen, se borran.
 * - Las del vendedor que no vienen **se conservan** y se renumeran al final en
 *   su orden relativo: el portal no puede quitar lo que agrego el vendedor (D2).
 *
 * Una fila que ya tiene el orden y el origen que le tocan no se toca: moveria
 * su `updated_at` y bajaria otra vez en el pull de la tablet sin haber cambiado.
 */
export function planearReemplazo(
  vivas: readonly FilaViva[],
  clientes: readonly string[],
): PlanReemplazo {
  const porCliente = new Map(vivas.map((f) => [f.clienteId, f]));
  const pedidos = new Set(clientes);
  const plan: PlanReemplazo = { actualizar: [], insertar: [], borrar: [] };

  const fijar = (fila: FilaViva, orden: number, origen: OrigenRuta) => {
    if (fila.orden !== orden || fila.origen !== origen) {
      plan.actualizar.push({ id: fila.id, orden, origen });
    }
  };

  clientes.forEach((clienteId, i) => {
    const fila = porCliente.get(clienteId);
    if (fila) fijar(fila, i + 1, 'oficina');
    else plan.insertar.push({ clienteId, orden: i + 1 });
  });

  const fuera = vivas
    .filter((f) => !pedidos.has(f.clienteId))
    .sort((a, b) => a.orden - b.orden);
  let siguiente = clientes.length;
  for (const f of fuera) {
    if (f.origen === 'oficina') plan.borrar.push(f.id);
    else fijar(f, ++siguiente, 'vendedor');
  }

  return plan;
}
```

Run: `npm test --workspace=apps/backend -- reemplazo-ruta`
Expected: PASS, 6 pruebas.

- [ ] **Paso 3: e2e del portal (falla)**

Crear `apps/backend/test/rutas-diarias.e2e-spec.ts`:

```ts
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
import type {
  RutaAnterior,
  RutaDiaria,
} from './../src/modules/rutas/rutas-diarias.service';

/**
 * Ruta Diaria desde el portal (T-37, D14), de punta a punta: permiso, alcance,
 * reemplazo que conserva lo del vendedor, renumeracion y "anterior".
 *
 * Fechas de JUNIO DE 2023, exclusivas de este archivo. Los vendedores son
 * nuevos en cada corrida (`SUFIJO`), asi que sus rutas tambien.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-ruta-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-ruta-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-ruta-sin-${SUFIJO}`;

describe('Ruta Diaria desde el portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let mxId: string;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  const vendedorIds: string[] = [];
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let vendedorTj: string;
  let vendedorMx: string;

  let clientes = 0;
  let dias = 0;
  /** Un dia propio por prueba, desde 2023-06-01. */
  const diaNuevo = () =>
    new Date(Date.UTC(2023, 5, 1) + dias++ * 86_400_000)
      .toISOString()
      .slice(0, 10);

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

  const sembrarVendedor = async (sucursalId: string): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-ruta-v${vendedorIds.length + 1}-${SUFIJO}`,
        nombre: `Vendedor ruta ${vendedorIds.length + 1} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  const sembrarCliente = async (
    sucursalId: string,
    extra: { tipo?: 'cliente' | 'prospecto'; borrado?: boolean } = {},
  ): Promise<{ id: string; nombre: string }> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const prospecto = extra.tipo === 'prospecto';
    const nombre = `Ruta portal ${++clientes} ${SUFIJO}`;
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre,
        domicilio: prospecto ? null : 'Calle 1',
        telefono: '6640000000',
        tipo: extra.tipo ?? 'cliente',
        lista_precio_id: prospecto ? null : lista.id,
        sucursal_id: sucursalId,
        deleted_at: extra.borrado ? new Date() : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return { id, nombre };
  };

  const sembrarRuta = async (valores: {
    vendedor: string;
    cliente: string;
    fecha: string;
    orden: number;
    origen?: 'oficina' | 'vendedor';
    borrada?: boolean;
  }) =>
    (
      await db
        .insertInto('ruta')
        .values({
          vendedor_id: valores.vendedor,
          cliente_id: valores.cliente,
          fecha: valores.fecha,
          orden: valores.orden,
          origen: valores.origen ?? 'oficina',
          tipo: 'diaria',
          deleted_at: valores.borrada ? new Date() : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  const obtener = (cookie: string, vendedorId: string, fecha: string) =>
    request(app.getHttpServer())
      .get(`/rutas/diaria?${new URLSearchParams({ vendedorId, fecha }).toString()}`)
      .set('Cookie', cookie);

  const anterior = (cookie: string, vendedorId: string, fecha: string) =>
    request(app.getHttpServer())
      .get(
        `/rutas/diaria/anterior?${new URLSearchParams({ vendedorId, fecha }).toString()}`,
      )
      .set('Cookie', cookie);

  const guardar = (
    cookie: string,
    cuerpo: { vendedorId: string; fecha: string; clientes: string[] },
  ) =>
    request(app.getHttpServer())
      .put('/rutas/diaria')
      .set('Cookie', cookie)
      .send(cuerpo);

  /** Todas las filas (vivas y borradas) de un vendedor y dia, por orden. */
  const filasDe = (vendedor: string, fecha: string) =>
    db
      .selectFrom('ruta')
      .select(['id', 'cliente_id', 'orden', 'origen', 'deleted_at'])
      .where('vendedor_id', '=', vendedor)
      .where('fecha', '=', fecha)
      .orderBy('orden')
      .execute();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    tjId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;
    mxId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'MX')
        .executeTakeFirstOrThrow()
    ).id;

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', tjId);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);

    vendedorTj = await sembrarVendedor(tjId);
    vendedorMx = await sembrarVendedor(mxId);
  });

  afterAll(async () => {
    await db.deleteFrom('ruta').where('vendedor_id', 'in', vendedorIds).execute();
    if (clienteIds.length > 0) {
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  describe('permiso y alcance', () => {
    it('sin ruta_diaria.gestionar todo es 403, lectura incluida', async () => {
      const fecha = diaNuevo();
      await obtener(cookieSinPermiso, vendedorTj, fecha).expect(403);
      await anterior(cookieSinPermiso, vendedorTj, fecha).expect(403);
      await guardar(cookieSinPermiso, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [],
      }).expect(403);
    });

    it('un usuario atado a TJ no ve al vendedor de MX: 404, no 403', async () => {
      const fecha = diaNuevo();
      await obtener(cookieTijuana, vendedorMx, fecha).expect(404);
      await guardar(cookieTijuana, {
        vendedorId: vendedorMx,
        fecha,
        clientes: [],
      }).expect(404);
    });

    it('el General ve a cualquiera; sin filas responde el vendedor con la lista vacia', async () => {
      const fecha = diaNuevo();
      const res = await obtener(cookieGeneral, vendedorMx, fecha).expect(200);
      expect(res.body).toEqual({
        vendedor: {
          id: vendedorMx,
          nombre: expect.stringContaining('Vendedor ruta') as string,
          sucursalCodigo: 'MX',
        },
        fecha,
        filas: [],
      });
    });

    it('fecha mal formada, fecha imposible o vendedor que no es uuid es 400', async () => {
      await obtener(cookieGeneral, vendedorTj, '12/06/2023').expect(400);
      await obtener(cookieGeneral, vendedorTj, '2023-02-30').expect(400);
      await obtener(cookieGeneral, 'no-soy-uuid', diaNuevo()).expect(400);
    });
  });

  describe('PUT: reemplazo', () => {
    it('guarda la lista en orden, como de la oficina, y responde como el GET', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const b = await sembrarCliente(tjId);

      const res = await guardar(cookieTijuana, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [b.id, a.id],
      }).expect(200);

      const cuerpo = res.body as RutaDiaria;
      expect(cuerpo.filas).toEqual([
        {
          id: expect.any(String) as string,
          clienteId: b.id,
          clienteNombre: b.nombre,
          orden: 1,
          origen: 'oficina',
        },
        {
          id: expect.any(String) as string,
          clienteId: a.id,
          clienteNombre: a.nombre,
          orden: 2,
          origen: 'oficina',
        },
      ]);
      expect(
        (await obtener(cookieTijuana, vendedorTj, fecha).expect(200)).body,
      ).toEqual(cuerpo);
    });

    it('conserva las del vendedor que no vienen y las renumera al final en su orden', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const b = await sembrarCliente(tjId);
      const c = await sembrarCliente(tjId);
      const d = await sembrarCliente(tjId);
      await sembrarRuta({ vendedor: vendedorTj, cliente: a.id, fecha, orden: 1 });
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: b.id,
        fecha,
        orden: 2,
        origen: 'vendedor',
      });
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: d.id,
        fecha,
        orden: 5,
        origen: 'vendedor',
      });

      const res = await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [c.id, a.id],
      }).expect(200);

      expect(
        (res.body as RutaDiaria).filas.map((f) => [f.clienteId, f.orden, f.origen]),
      ).toEqual([
        [c.id, 1, 'oficina'],
        [a.id, 2, 'oficina'],
        [b.id, 3, 'vendedor'],
        [d.id, 4, 'vendedor'],
      ]);
    });

    it('adopta la fila que subio el vendedor: la misma fila, con el orden y el origen de la oficina', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const id = await sembrarRuta({
        vendedor: vendedorTj,
        cliente: a.id,
        fecha,
        orden: 1,
        origen: 'vendedor',
      });

      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [a.id],
      }).expect(200);

      expect(await filasDe(vendedorTj, fecha)).toEqual([
        {
          id,
          cliente_id: a.id,
          orden: 1,
          origen: 'oficina',
          deleted_at: null,
        },
      ]);
    });

    it('da de baja (no borra) las de la oficina que ya no vienen', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const c = await sembrarCliente(tjId);
      const idA = await sembrarRuta({ vendedor: vendedorTj, cliente: a.id, fecha, orden: 1 });
      await sembrarRuta({ vendedor: vendedorTj, cliente: c.id, fecha, orden: 2 });

      const res = await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [c.id],
      }).expect(200);

      expect((res.body as RutaDiaria).filas.map((f) => f.clienteId)).toEqual([c.id]);
      const quitada = (await filasDe(vendedorTj, fecha)).find((f) => f.id === idA);
      expect(quitada?.deleted_at).not.toBeNull();
    });

    it('un cliente de otra sucursal es 400 y no cambia nada', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const ajeno = await sembrarCliente(mxId);
      await sembrarRuta({ vendedor: vendedorTj, cliente: a.id, fecha, orden: 1 });

      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [ajeno.id],
      }).expect(400);

      expect(await filasDe(vendedorTj, fecha)).toMatchObject([
        { cliente_id: a.id, deleted_at: null },
      ]);
    });

    it('un prospecto, un cliente dado de baja o un cliente repetido es 400', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const p = await sembrarCliente(tjId, { tipo: 'prospecto' });
      const z = await sembrarCliente(tjId, { borrado: true });

      await guardar(cookieGeneral, { vendedorId: vendedorTj, fecha, clientes: [p.id] }).expect(400);
      await guardar(cookieGeneral, { vendedorId: vendedorTj, fecha, clientes: [z.id] }).expect(400);
      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [a.id, a.id.toUpperCase()],
      }).expect(400);
      expect(await filasDe(vendedorTj, fecha)).toHaveLength(0);
    });
  });

  describe('GET anterior (Copiar de ayer)', () => {
    it('devuelve la ultima fecha anterior con filas vivas y sus clientes en orden', async () => {
      const f1 = diaNuevo();
      const f2 = diaNuevo();
      const f3 = diaNuevo();
      const a = await sembrarCliente(tjId);
      const b = await sembrarCliente(tjId);
      await sembrarRuta({ vendedor: vendedorTj, cliente: b.id, fecha: f1, orden: 1 });
      await sembrarRuta({ vendedor: vendedorTj, cliente: a.id, fecha: f1, orden: 2 });

      expect((await anterior(cookieGeneral, vendedorTj, f3).expect(200)).body).toEqual({
        fecha: f1,
        clientes: [b.id, a.id],
      });
      // `f2` no tiene filas: se salta.
      expect((await anterior(cookieGeneral, vendedorTj, f2).expect(200)).body).toEqual({
        fecha: f1,
        clientes: [b.id, a.id],
      });
    });

    it('sin ruta anterior responde fecha null y ninguna fila', async () => {
      const otro = await sembrarVendedor(tjId);
      expect(
        (await anterior(cookieGeneral, otro, diaNuevo()).expect(200)).body as RutaAnterior,
      ).toEqual({ fecha: null, clientes: [] });
    });

    it('un dia con solo filas dadas de baja no cuenta', async () => {
      const f1 = diaNuevo();
      const f2 = diaNuevo();
      const f3 = diaNuevo();
      const a = await sembrarCliente(tjId);
      await sembrarRuta({ vendedor: vendedorTj, cliente: a.id, fecha: f1, orden: 1 });
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: a.id,
        fecha: f2,
        orden: 1,
        borrada: true,
      });

      expect((await anterior(cookieGeneral, vendedorTj, f3).expect(200)).body).toEqual({
        fecha: f1,
        clientes: [a.id],
      });
    });

    it('omite clientes dados de baja y prospectos, para que copiar y guardar no termine en 400 (Review Focus 4)', async () => {
      const f1 = diaNuevo();
      const f2 = diaNuevo();
      const a = await sembrarCliente(tjId);
      const z = await sembrarCliente(tjId, { borrado: true });
      const p = await sembrarCliente(tjId, { tipo: 'prospecto' });
      await sembrarRuta({ vendedor: vendedorTj, cliente: z.id, fecha: f1, orden: 1 });
      await sembrarRuta({ vendedor: vendedorTj, cliente: a.id, fecha: f1, orden: 2 });
      await sembrarRuta({ vendedor: vendedorTj, cliente: p.id, fecha: f1, orden: 3 });

      const copia = (await anterior(cookieGeneral, vendedorTj, f2).expect(200))
        .body as RutaAnterior;
      expect(copia).toEqual({ fecha: f1, clientes: [a.id] });

      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha: f2,
        clientes: copia.clientes,
      }).expect(200);
    });
  });
});
```

Run: `npm run test:e2e --workspace=apps/backend -- rutas-diarias`
Expected: FAIL, todas con 404 (la ruta `/rutas/diaria` no existe todavía).

- [ ] **Paso 4: DTOs**

Crear `apps/backend/src/modules/rutas/dto/ruta-diaria.dto.ts`:

```ts
import {
  ArrayMaxSize,
  IsArray,
  IsUUID,
  Matches,
} from 'class-validator';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tope de clientes por ruta. Una ruta tiene decenas; el tope es para que un
 * cuerpo absurdo sea 400 y no una transaccion de miles de `update`.
 */
export const MAX_CLIENTES_RUTA = 300;

/** `GET /rutas/diaria` y `GET /rutas/diaria/anterior` (T-37, D14). */
export class ConsultaRutaDiariaDto {
  @IsUUID(undefined, { message: 'Elige el vendedor.' })
  vendedorId!: string;

  @Matches(RE_FECHA, { message: 'La fecha debe tener el formato AAAA-MM-DD.' })
  fecha!: string;
}

/**
 * `PUT /rutas/diaria`: la lista COMPLETA y ordenada de la ruta (semantica de
 * reemplazo, D14). Vacia es valida: quita lo de la oficina.
 */
export class GuardarRutaDiariaDto extends ConsultaRutaDiariaDto {
  @IsArray({ message: 'La ruta debe ser una lista de clientes.' })
  @ArrayMaxSize(MAX_CLIENTES_RUTA, {
    message: `Una ruta no puede pasar de ${MAX_CLIENTES_RUTA} clientes.`,
  })
  @IsUUID(undefined, {
    each: true,
    message: 'Uno de los clientes no es válido.',
  })
  clientes!: string[];
}
```

- [ ] **Paso 5: Repositorio — los métodos del portal**

En `apps/backend/src/modules/rutas/rutas-diarias.repository.ts`:

a) Imports adicionales:

```ts
import { buscarSucursalUsuario as buscarSucursalUsuarioCompartido } from '../sucursales/buscar-sucursal-usuario';
import type { FilaViva, PlanReemplazo } from './reemplazo-ruta';
```

b) Tipos, debajo de `NuevaFilaRuta`:

```ts
/** El vendedor de una ruta, con su sucursal (para el alcance y la cartera). */
export interface VendedorDeRuta {
  id: string;
  nombre: string;
  sucursalId: string;
  sucursalCodigo: string;
}

/** Una fila de la ruta como la pinta el portal. */
export interface FilaRutaDiaria {
  id: string;
  clienteId: string;
  clienteNombre: string;
  orden: number;
  origen: OrigenRuta;
}
```

c) Métodos, al final de la clase:

```ts
  /** Abre la transaccion del reemplazo del portal. */
  async enTransaccion<T>(
    tarea: (trx: Transaction<DB>) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction().execute(tarea);
  }

  buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuarioCompartido(this.db, usuarioId);
  }

  /** El vendedor vivo (sin `deleted_at`), activo o no. */
  async vendedorDeRuta(vendedorId: string): Promise<VendedorDeRuta | undefined> {
    return this.db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select([
        'vendedor.id as id',
        'vendedor.nombre as nombre',
        'vendedor.sucursal_id as sucursalId',
        'sucursal.codigo as sucursalCodigo',
      ])
      .where('vendedor.id', '=', vendedorId)
      .where('vendedor.deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /** Las filas vivas de la ruta diaria de un vendedor y dia, por orden, con el nombre del cliente. */
  async filasDelDia(
    vendedorId: string,
    fecha: string,
  ): Promise<FilaRutaDiaria[]> {
    const filas = await this.db
      .selectFrom('ruta')
      .innerJoin('cliente', 'cliente.id', 'ruta.cliente_id')
      .select([
        'ruta.id as id',
        'ruta.cliente_id as clienteId',
        'cliente.nombre as clienteNombre',
        'ruta.orden as orden',
        'ruta.origen as origen',
      ])
      .where('ruta.vendedor_id', '=', vendedorId)
      .where('ruta.fecha', '=', fecha)
      .where('ruta.tipo', '=', 'diaria')
      .where('ruta.deleted_at', 'is', null)
      .orderBy('ruta.orden')
      .orderBy('ruta.created_at')
      .execute();
    return filas.map((f) => ({ ...f, origen: f.origen as OrigenRuta }));
  }

  /** Lo mismo, dentro de la transaccion y sin nombre: lo que lee el reemplazo. */
  async filasVivas(
    vendedorId: string,
    fecha: string,
    trx: Transaction<DB>,
  ): Promise<FilaViva[]> {
    const filas = await trx
      .selectFrom('ruta')
      .select(['id', 'cliente_id', 'orden', 'origen'])
      .where('vendedor_id', '=', vendedorId)
      .where('fecha', '=', fecha)
      .where('tipo', '=', 'diaria')
      .where('deleted_at', 'is', null)
      .orderBy('orden')
      .execute();
    return filas.map((f) => ({
      id: f.id,
      clienteId: f.cliente_id,
      orden: f.orden,
      origen: f.origen as OrigenRuta,
    }));
  }

  /** De una lista de ids, cuales son clientes vivos, `tipo = 'cliente'`, de esa sucursal. */
  async clientesParaRuta(
    ids: readonly string[],
    sucursalId: string,
    trx: Transaction<DB>,
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const filas = await trx
      .selectFrom('cliente')
      .select('id')
      .where('id', 'in', [...ids])
      .where('sucursal_id', '=', sucursalId)
      .where('tipo', '=', 'cliente')
      .where('deleted_at', 'is', null)
      .execute();
    return new Set(filas.map((f) => f.id));
  }

  /**
   * Escribe el plan del reemplazo. La fila del vendedor ya esta bloqueada y las
   * vivas se leyeron despues del candado, asi que los inserts no pueden chocar
   * con la unicidad.
   */
  async aplicarReemplazo(
    vendedorId: string,
    fecha: string,
    plan: PlanReemplazo,
    trx: Transaction<DB>,
  ): Promise<void> {
    if (plan.borrar.length > 0) {
      await trx
        .updateTable('ruta')
        .set({ deleted_at: new Date() })
        .where('id', 'in', plan.borrar)
        .execute();
    }
    for (const fila of plan.actualizar) {
      await trx
        .updateTable('ruta')
        .set({ orden: fila.orden, origen: fila.origen })
        .where('id', '=', fila.id)
        .execute();
    }
    if (plan.insertar.length > 0) {
      await trx
        .insertInto('ruta')
        .values(
          plan.insertar.map((fila) => ({
            vendedor_id: vendedorId,
            cliente_id: fila.clienteId,
            fecha,
            orden: fila.orden,
            origen: 'oficina',
            tipo: 'diaria',
          })),
        )
        .execute();
    }
  }

  /** La ultima fecha ANTERIOR a `fecha` con filas vivas de ese vendedor, o `null`. */
  async fechaAnteriorConRuta(
    vendedorId: string,
    fecha: string,
  ): Promise<string | null> {
    const fila = await this.db
      .selectFrom('ruta')
      .select(sql<string | null>`to_char(max(fecha), 'YYYY-MM-DD')`.as('fecha'))
      .where('vendedor_id', '=', vendedorId)
      .where('tipo', '=', 'diaria')
      .where('deleted_at', 'is', null)
      .where('fecha', '<', fecha)
      .executeTakeFirst();
    return fila?.fecha ?? null;
  }

  /**
   * Los clientes de la ruta viva de ese dia, por orden, **solo** los que hoy
   * siguen siendo validos para una ruta (vivos, `tipo = 'cliente'`, de la
   * sucursal): lo que el `PUT` aceptaria.
   */
  async clientesValidosDeFecha(
    vendedorId: string,
    fecha: string,
    sucursalId: string,
  ): Promise<string[]> {
    const filas = await this.db
      .selectFrom('ruta')
      .innerJoin('cliente', 'cliente.id', 'ruta.cliente_id')
      .select('ruta.cliente_id as clienteId')
      .where('ruta.vendedor_id', '=', vendedorId)
      .where('ruta.fecha', '=', fecha)
      .where('ruta.tipo', '=', 'diaria')
      .where('ruta.deleted_at', 'is', null)
      .where('cliente.deleted_at', 'is', null)
      .where('cliente.tipo', '=', 'cliente')
      .where('cliente.sucursal_id', '=', sucursalId)
      .orderBy('ruta.orden')
      .execute();
    return filas.map((f) => f.clienteId);
  }
```

- [ ] **Paso 6: Servicio — los métodos del portal**

En `apps/backend/src/modules/rutas/rutas-diarias.service.ts`:

a) Imports, en lugar de `import { Injectable } from '@nestjs/common';`:

```ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { resolverAlcance } from '../sucursales/alcance-sucursal';
import type { GuardarRutaDiariaDto } from './dto/ruta-diaria.dto';
import { planearReemplazo } from './reemplazo-ruta';
```

y el import del repositorio queda:

```ts
import {
  RutasDiariasRepository,
  type FilaRutaDiaria,
  type VendedorDeRuta,
} from './rutas-diarias.repository';
```

b) Debajo de `EntidadRuta`:

```ts
export const MOTIVO_FECHA_INEXISTENTE = 'Esa fecha no existe.';
export const MOTIVO_VENDEDOR_INEXISTENTE = 'No existe ese vendedor.';
export const MOTIVO_CLIENTE_REPETIDO = 'Un cliente viene dos veces en la ruta.';
export const MOTIVO_CLIENTE_NO_VALIDO =
  'Uno de los clientes no existe, está dado de baja, es un prospecto o no es de la sucursal del vendedor.';

/** `GET`/`PUT /rutas/diaria` (D14). */
export interface RutaDiaria {
  vendedor: { id: string; nombre: string; sucursalCodigo: string };
  fecha: string;
  filas: FilaRutaDiaria[];
}

/** `GET /rutas/diaria/anterior`: lo que carga "Copiar de ayer" (D17). */
export interface RutaAnterior {
  fecha: string | null;
  clientes: string[];
}

/**
 * `AAAA-MM-DD` que existe en el calendario. El DTO ya comprobo el formato;
 * esto evita que un 30 de febrero llegue a Postgres y salga como 500.
 */
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
```

c) Métodos de la clase, después de `agregarAlDia`:

```ts
  /** `GET /rutas/diaria`. */
  async obtenerDiaria(
    usuarioId: string,
    vendedorId: string,
    fecha: string,
  ): Promise<RutaDiaria> {
    exigirFechaReal(fecha);
    const vendedor = await this.vendedorEnAlcance(usuarioId, vendedorId);
    return this.rutaDe(vendedor, fecha);
  }

  /**
   * `PUT /rutas/diaria`: reemplaza la ruta de ese vendedor y dia con la lista,
   * en UNA transaccion (un error no deja la ruta a medias). La regla esta en
   * `planearReemplazo`.
   */
  async reemplazarDiaria(
    usuarioId: string,
    dto: GuardarRutaDiariaDto,
  ): Promise<RutaDiaria> {
    exigirFechaReal(dto.fecha);
    const clientes = dto.clientes.map((c) => c.toLowerCase());
    if (new Set(clientes).size !== clientes.length) {
      throw new BadRequestException(MOTIVO_CLIENTE_REPETIDO);
    }
    const vendedor = await this.vendedorEnAlcance(usuarioId, dto.vendedorId);

    await this.repo.enTransaccion(async (trx) => {
      // El mismo candado que el alta de la tablet (`agregarAlDia`): las vivas
      // se leen DESPUES, asi que un alta que llego un instante antes se adopta
      // en vez de chocar con la unicidad.
      await this.repo.bloquearVendedor(vendedor.id, trx);
      const validos = await this.repo.clientesParaRuta(
        clientes,
        vendedor.sucursalId,
        trx,
      );
      if (validos.size !== clientes.length) {
        throw new BadRequestException(MOTIVO_CLIENTE_NO_VALIDO);
      }
      const vivas = await this.repo.filasVivas(vendedor.id, dto.fecha, trx);
      await this.repo.aplicarReemplazo(
        vendedor.id,
        dto.fecha,
        planearReemplazo(vivas, clientes),
        trx,
      );
    });

    return this.rutaDe(vendedor, dto.fecha);
  }

  /** `GET /rutas/diaria/anterior`: no escribe nada. */
  async anterior(
    usuarioId: string,
    vendedorId: string,
    fecha: string,
  ): Promise<RutaAnterior> {
    exigirFechaReal(fecha);
    const vendedor = await this.vendedorEnAlcance(usuarioId, vendedorId);
    const previa = await this.repo.fechaAnteriorConRuta(vendedor.id, fecha);
    if (previa === null) return { fecha: null, clientes: [] };
    return {
      fecha: previa,
      clientes: await this.repo.clientesValidosDeFecha(
        vendedor.id,
        previa,
        vendedor.sucursalId,
      ),
    };
  }

  private async rutaDe(
    vendedor: VendedorDeRuta,
    fecha: string,
  ): Promise<RutaDiaria> {
    return {
      vendedor: {
        id: vendedor.id,
        nombre: vendedor.nombre,
        sucursalCodigo: vendedor.sucursalCodigo,
      },
      fecha,
      filas: await this.repo.filasDelDia(vendedor.id, fecha),
    };
  }

  /**
   * El vendedor, si el usuario lo alcanza. **404 y no 403** (D14): a un
   * usuario de otra sucursal no se le confirma que el vendedor exista. Por eso
   * no se usa `exigirAlcanceSobre`, que responde 403.
   */
  private async vendedorEnAlcance(
    usuarioId: string,
    vendedorId: string,
  ): Promise<VendedorDeRuta> {
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');

    const vendedor = await this.repo.vendedorDeRuta(vendedorId.toLowerCase());
    const alcance = resolverAlcance(usuario.codigo, null);
    if (
      !vendedor ||
      (alcance.tipo === 'una' && alcance.codigo !== vendedor.sucursalCodigo)
    ) {
      throw new NotFoundException(MOTIVO_VENDEDOR_INEXISTENTE);
    }
    return vendedor;
  }
```

- [ ] **Paso 7: Controlador y módulo**

Crear `apps/backend/src/modules/rutas/rutas-diarias.controller.ts`:

```ts
import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  ConsultaRutaDiariaDto,
  GuardarRutaDiariaDto,
} from './dto/ruta-diaria.dto';
import {
  RutasDiariasService,
  type RutaAnterior,
  type RutaDiaria,
} from './rutas-diarias.service';

// T-37 (D14). Todo con `ruta_diaria.gestionar`, lectura incluida: es una
// pantalla de una sola tarea (mismo criterio que cobranza y facturas). El
// alcance por sucursal lo resuelve el servicio.
@Controller('rutas/diaria')
export class RutasDiariasController {
  constructor(private readonly rutas: RutasDiariasService) {}

  @Get()
  @RequierePermiso('ruta_diaria.gestionar')
  obtener(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaRutaDiariaDto,
  ): Promise<RutaDiaria> {
    return this.rutas.obtenerDiaria(usuarioId, q.vendedorId, q.fecha);
  }

  @Get('anterior')
  @RequierePermiso('ruta_diaria.gestionar')
  anterior(
    @UsuarioActual() usuarioId: string,
    @Query() q: ConsultaRutaDiariaDto,
  ): Promise<RutaAnterior> {
    return this.rutas.anterior(usuarioId, q.vendedorId, q.fecha);
  }

  @Put()
  @RequierePermiso('ruta_diaria.gestionar')
  guardar(
    @UsuarioActual() usuarioId: string,
    @Body() dto: GuardarRutaDiariaDto,
  ): Promise<RutaDiaria> {
    return this.rutas.reemplazarDiaria(usuarioId, dto);
  }
}
```

En `apps/backend/src/modules/rutas/rutas.module.ts`, agregar el import `import { RutasDiariasController } from
'./rutas-diarias.controller';` y la línea de controladores queda:

```ts
  controllers: [VehiculosController, RutasDiariasController],
```

- [ ] **Paso 8: Ver que el e2e pasa**

Run:
```bash
npm run build --workspace=apps/backend
npm run test:e2e --workspace=apps/backend -- rutas-diarias
```
Expected: compila; `rutas-diarias.e2e-spec.ts` en verde (14 pruebas).

- [ ] **Paso 9: Formato, lint, suites**

Run:
```bash
npm exec --workspace=apps/backend -- prettier --write src/modules/rutas test/rutas-diarias.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/rutas test/rutas-diarias.e2e-spec.ts
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
```
Expected: sin errores de lint; unitarias = línea base + las de las Tareas 4 y 5; e2e completo en verde.

- [ ] **Paso 10: Commit**

```bash
git add apps/backend/src/modules/rutas apps/backend/test/rutas-diarias.e2e-spec.ts
git commit -m "T-37: endpoints de Ruta Diaria para el portal — consultar, reemplazar y copiar de ayer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Tarea 6: Tablet — migración local 011, tipos y repositorio `rutas.ts` (D15)

**Archivos:**
- Crear: `apps/tablet/src/datos/migraciones/011-ruta.ts`, `apps/tablet/src/datos/migraciones/011-ruta.spec.ts`
- Modificar: `apps/tablet/src/datos/migraciones/index.ts`
- Modificar: `apps/tablet/src/datos/tipos.ts`
- Crear: `apps/tablet/src/datos/repositorios/rutas.ts`, `apps/tablet/src/datos/repositorios/rutas.spec.ts`

**Interfaces:**
- Consume: `DepsRepositorio`, `enTransaccion` (`deps.ts`), `exigirJornadaAbierta` (`jornadas.ts`),
  `RepositorioCatalogos.obtenerCliente` y `publicarCambio` (`catalogos.ts`).
- Produce:
  - Migración local **11** (`nombre: 'ruta'`): tablas `ruta` y `ruta_orden_local` exactamente como el spec.
  - En `tipos.ts`: `OrigenRuta = 'oficina' | 'vendedor'`, `SyncEstadoRuta = 'sincronizada' | 'pendiente' |
    'error'` e `interface Ruta`.
  - En `rutas.ts`:
    - `class ErrorRuta extends Error`.
    - `type FilaRutaPull = Pick<Ruta, 'id' | 'cliente_id' | 'fecha' | 'orden' | 'origen' | 'activo'>` (la forma de
      `RutaPull` del contrato, sin atar la capa de datos al contrato).
    - `aplicarSnapshotRutas(bd: BaseDatos, filas: readonly FilaRutaPull[] | undefined, sincronizadoEn:
      MomentoISO): number` — función libre, **sin transacción propia**: la llama `catalogos.guardarSnapshot`
      dentro de la suya (Tarea 7).
    - `interface FilaRutaDelDia` (fila + `nombre`, `domicilio`, `posicion`, `notas_pendientes`, `visitado`).
    - `interface ContextoAltaRuta { vendedorId: string; sucursalId: string }`.
    - `restarDias(fecha: FechaISO, dias: number): FechaISO`.
    - `crearRepositorioRutas(deps: DepsRepositorio, { catalogos }: { catalogos: RepositorioCatalogos })` →
      `RepositorioRutas` con `delDia(fecha?)`, `agregar(clienteId, contexto, fecha?)`, `reordenar(fecha,
      clienteIds)`, `aplicarSnapshot(filas, ahora?)`, `porId(id)`, `pendientesDeSincronizar()`,
      `marcarSincronizada(id)`, `marcarError(id, motivo)`, `quitarRechazada(id)`, `purgar(antesDe?)`.

**Decisiones de esta tarea:**
1. **`aplicarSnapshotRutas` escribe su propio SQL** en vez del `upsert` genérico de `catalogos.ts`: la regla de
   fusión necesita, por fila, borrar antes lo del mismo `(fecha, cliente)` con otro id (sin eso, la fila viva nueva
   choca con `uq_ruta_fecha_cliente`), y saltarse las filas cuyo cliente no está en la tablet (Review Focus 1). El
   `update` nunca toca `sync_estado` ni `clave`.
2. **`delDia` devuelve también las filas con `activo = 0`**: el spec dice que una baja "se queda en la tabla con
   la bandera y la pantalla decide" (D15/D16); quien decide es `agruparRuta` (Tarea 8). Ver *Conflictos*, punto 4.
3. **`visitado` y la burbuja se calculan en la misma consulta** (`exists` sobre `venta` y `cobranza` de esa
   fecha; `count` sobre `nota_pendiente` con `activo = 1 and saldo_centavos > 0`): es el mismo predicado que
   `ventas.delDia`/`cobranzas.delDia` y que pide el spec, en una sola lectura por pantalla.
4. **La clave de idempotencia es el id local** (`clave = id`), como en ventas y cobranzas: el id local no cambia
   nunca (la fusión borra la fila local, no la renombra). `clave` distingue además las altas locales (las del
   servidor la tienen `null`).
5. **En un alta local, `sincronizado_en` guarda el momento de la captura** (la columna es `not null` en el spec y
   todavía no se sincronizó nada); `fuente-rutas` lo manda como `ocurrido_en`. Al sincronizar se sobrescribe.
6. **`pendientesDeSincronizar` incluye las que quedaron en `error`** (patrón D19 de ventas): un
   `cliente-inexistente` se recupera si el portal corrige al cliente. El vendedor la puede quitar
   (`quitarRechazada`), que es el único caso en que se borra una fila de la ruta desde la tablet.
7. **`purgar` conserva las altas sin subir**, aunque sean viejas: borrarlas perdería datos que la oficina necesita
   (efectividad, T-46).

- [ ] **Paso 1: Prueba de la migración (falla)**

Crear `apps/tablet/src/datos/migraciones/011-ruta.spec.ts`:

```ts
import { abrirBaseDatosNode } from '../driver-node';
import type { BaseDatos } from '../base-datos';
import { migraciones, versionEsquema } from './index';
import { ejecutarMigraciones } from './motor';

/**
 * La 011 crea la ruta del dia (T-37, D15): `ruta` la escribe el pull,
 * `ruta_orden_local` solo el dedo del vendedor.
 */

const TS = "'2026-10-12T00:00:00.000Z'";

function baseAlDia(): BaseDatos {
  const bd = abrirBaseDatosNode();
  ejecutarMigraciones(bd, migraciones);
  bd.execSync(`
    insert into sucursal (id, codigo, nombre, sincronizado_en) values ('suc-tj', 'TJ', 'Tijuana', ${TS});
    insert into cliente (id, nombre, domicilio, telefono, tipo, promocion, sucursal_id, activo, sincronizado_en)
      values ('cli-1', 'Abarrotes La Esquina', 'Calle 5', '6641234567', 'cliente', 'ninguna', 'suc-tj', 1, ${TS});
  `);
  return bd;
}

function insertarRuta(
  bd: BaseDatos,
  id: string,
  extra: { activo?: number; origen?: string; cliente?: string } = {},
) {
  bd.runSync(
    `insert into ruta (id, cliente_id, fecha, orden, origen, activo, sincronizado_en)
     values ($id, $cliente, '2026-10-12', 1, $origen, $activo, ${TS})`,
    {
      $id: id,
      $cliente: extra.cliente ?? 'cli-1',
      $origen: extra.origen ?? 'oficina',
      $activo: extra.activo ?? 1,
    },
  );
}

describe('migracion 011: la ruta del dia (T-37)', () => {
  it('es la migracion 11 y deja la base al dia', () => {
    expect(migraciones[10]?.nombre).toBe('ruta');
    expect(migraciones[10]?.version).toBe(11);
    const bd = baseAlDia();
    expect(versionEsquema(bd)).toBe(migraciones.length);
  });

  it('una fila del servidor nace sincronizada y sin clave', () => {
    const bd = baseAlDia();
    insertarRuta(bd, 'srv-1');
    expect(
      bd.getFirstSync('select sync_estado, sync_error, clave from ruta where id = $id', {
        $id: 'srv-1',
      }),
    ).toEqual({ sync_estado: 'sincronizada', sync_error: null, clave: null });
  });

  it('el mismo cliente vivo dos veces el mismo dia no entra; una baja y una viva conviven', () => {
    const bd = baseAlDia();
    insertarRuta(bd, 'srv-1');
    expect(() => insertarRuta(bd, 'srv-2')).toThrow(/UNIQUE/);
    bd.runSync(`update ruta set activo = 0 where id = 'srv-1'`);
    expect(() => insertarRuta(bd, 'srv-2')).not.toThrow();
  });

  it('la llave foranea a cliente y el check de origen estan en pie', () => {
    const bd = baseAlDia();
    expect(() => insertarRuta(bd, 'srv-1', { cliente: 'no-existe' })).toThrow(/FOREIGN KEY/);
    expect(() => insertarRuta(bd, 'srv-2', { origen: 'portal' })).toThrow(/CHECK/);
  });

  it('ruta_orden_local guarda una posicion por (fecha, cliente)', () => {
    const bd = baseAlDia();
    const insertar = () =>
      bd.runSync(
        `insert into ruta_orden_local (fecha, cliente_id, posicion) values ('2026-10-12', 'cli-1', 1)`,
      );
    expect(insertar).not.toThrow();
    expect(insertar).toThrow(/UNIQUE|PRIMARY KEY/);
  });
});
```

Run: `npm test --workspace=apps/tablet -- 011-ruta`
Expected: FAIL (`migraciones[10]` es `undefined`).

- [ ] **Paso 2: La migración**

Crear `apps/tablet/src/datos/migraciones/011-ruta.ts`:

```ts
import type { Migracion } from './motor';

/**
 * La ruta del dia en la tablet (T-37, D15).
 *
 * ## Dos tablas a proposito
 *
 * - `ruta` la escribe el **pull** (y las altas locales del vendedor, que suben
 *   como `ruta-alta`). Es un espejo de las filas del servidor, con la baja como
 *   bandera (`activo = 0`), como los demas catalogos.
 * - `ruta_orden_local` la escribe **solo el dedo del vendedor** al arrastrar. Va
 *   por `(fecha, cliente_id)` y no por el id de la fila, asi que sobrevive a que
 *   el pull funda un alta local con la fila del servidor. Ningun snapshot la
 *   toca: el orden del vendedor no se pierde al refrescar (D4).
 *
 * `uq_ruta_fecha_cliente` es **parcial** (`where activo = 1`): una baja vieja
 * y la fila viva nueva del mismo cliente conviven hasta que el pull limpia la
 * vieja (la oficina lo quito y lo volvio a poner: en el servidor es otra fila).
 *
 * Tabla nueva: no rehace nada, asi que no apaga las llaves foraneas.
 */
export const ruta: Migracion = {
  version: 11,
  nombre: 'ruta',
  sql: `
    create table ruta (
      id              text primary key,          -- id del servidor, o uuid local mientras es alta pendiente
      cliente_id      text not null references cliente(id),
      fecha           text not null,             -- AAAA-MM-DD
      orden           integer not null,          -- el del servidor; en un alta local, el siguiente libre
      origen          text not null check (origen in ('oficina','vendedor')),
      activo          integer not null default 1,
      sync_estado     text not null default 'sincronizada'
                        check (sync_estado in ('sincronizada','pendiente','error')),
      sync_error      text,
      clave           text unique,               -- clave de idempotencia; solo en altas locales
      sincronizado_en text not null
    );
    create unique index uq_ruta_fecha_cliente on ruta (fecha, cliente_id) where activo = 1;

    create table ruta_orden_local (
      fecha      text not null,
      cliente_id text not null,
      posicion   integer not null,
      primary key (fecha, cliente_id)
    );
  `,
};
```

En `apps/tablet/src/datos/migraciones/index.ts`, agregar `import { ruta } from './011-ruta';` después del import de
`010-cobranza-sin-folio`, y `ruta,` al final del arreglo `migraciones` (después de `cobranzaSinFolio,`).

Run: `npm test --workspace=apps/tablet -- 011-ruta`
Expected: PASS, 5 pruebas.

- [ ] **Paso 3: Tipos**

En `apps/tablet/src/datos/tipos.ts`, después de `export interface VentaLinea { … }` (antes de la sección de
`Prospecto`), agregar:

```ts
/** Quien puso al cliente en la ruta (T-37): el portal o el vendedor. */
export type OrigenRuta = 'oficina' | 'vendedor';

/**
 * Estado de sincronizacion de una fila de `ruta`. Femenino a proposito, como
 * lo escribe el spec y la migracion 011 (las demas tablas dicen `sincronizado`).
 */
export type SyncEstadoRuta = 'sincronizada' | 'pendiente' | 'error';

/**
 * Una fila de la ruta del dia (T-37, D15). La escribe el pull; un alta local
 * del vendedor nace `pendiente`, con `clave` y `origen = 'vendedor'`.
 */
export interface Ruta {
  /** Id del servidor, o uuid local mientras es un alta pendiente. */
  id: string;
  cliente_id: string;
  fecha: FechaISO;
  /** El del servidor. Lo que el vendedor arrastra vive en `ruta_orden_local`. */
  orden: number;
  origen: OrigenRuta;
  /** `0` = la oficina lo quito de la ruta. La pantalla decide si se ve (D16). */
  activo: Booleano;
  sync_estado: SyncEstadoRuta;
  /** Motivo con el que el servidor la rechazo, si `sync_estado = 'error'`. */
  sync_error: string | null;
  /** Clave de idempotencia de un alta local (= su id); `null` en las del servidor. */
  clave: string | null;
  /** Cuando bajo. En un alta pendiente, cuando se capturo (va como `ocurrido_en`). */
  sincronizado_en: MomentoISO;
}
```

- [ ] **Paso 4: Prueba del repositorio (falla)**

Crear `apps/tablet/src/datos/repositorios/rutas.spec.ts`:

```ts
import { depsDePrueba, MOMENTO, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from './catalogos';
import { crearRepositorioCobranzas } from './cobranzas';
import { crearRepositorioFolios } from './folios';
import { crearRepositorioJornadas, ErrorJornada, MENSAJE_DIA_CERRADO } from './jornadas';
import { crearRepositorioRutas, ErrorRuta, type FilaRutaPull } from './rutas';
import { crearRepositorioVentas } from './ventas';

/**
 * La ruta del dia en la tablet (T-37, D15). Lo que hay que fijar: la regla de
 * fusion al refrescar (la tabla del spec, fila por fila), que el orden del
 * vendedor sobrevive a cualquier pull, y que "visitado" y la burbuja salen de
 * lo que paso HOY en esta tablet.
 */

const HOY = '2026-08-07';
const MANANA = '2026-08-08';
const CTX = { vendedorId: 'ven-1', sucursalId: 'suc-tj' };

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  const base = snapshotDePrueba();
  const plantilla = base.clientes![0];
  const cliente = (id: string, cambios: Partial<typeof plantilla> = {}) => ({
    ...plantilla,
    id,
    nombre: `Cliente ${id}`,
    ...cambios,
  });
  catalogos.guardarSnapshot({
    ...base,
    sucursales: [
      ...(base.sucursales ?? []),
      { id: 'suc-mx', codigo: 'MX', nombre: 'Mexicali', activa: 1 },
    ],
    clientes: [
      ...(base.clientes ?? []),
      cliente('cli-3'),
      cliente('cli-4', { domicilio: 'Av. Siempre Viva 742' }),
      cliente('cli-5', { activo: 0 }),
      cliente('cli-6', { sucursal_id: 'suc-mx' }),
    ],
  });
  return {
    deps,
    catalogos,
    rutas: crearRepositorioRutas(deps, { catalogos }),
    jornadas: crearRepositorioJornadas(deps),
    ventas: crearRepositorioVentas(deps, { catalogos, folios: crearRepositorioFolios(deps) }),
    cobranzas: crearRepositorioCobranzas(deps, { catalogos }),
  };
}

/** Una fila como la baja el pull. */
const delServidor = (extra: Partial<FilaRutaPull> = {}): FilaRutaPull => ({
  id: 'srv-1',
  cliente_id: 'cli-1',
  fecha: HOY,
  orden: 1,
  origen: 'oficina',
  activo: 1,
  ...extra,
});

function venderA(ventas: ReturnType<typeof montar>['ventas']) {
  return ventas.registrar({
    vendedorId: 'ven-1',
    clienteId: 'cli-1',
    numNota: '2346',
    contadoCredito: 'contado',
    factura: 'N/A',
    comentarios: null,
    lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
  });
}

const clientesDelDia = (rutas: ReturnType<typeof montar>['rutas'], fecha = HOY) =>
  rutas.delDia(fecha).map((f) => f.cliente_id);

describe('aplicarSnapshot: la regla de fusion al refrescar (D15)', () => {
  it('una fila nueva viva aparece al final, sin posicion local', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([
      delServidor({ id: 'srv-1', cliente_id: 'cli-1', orden: 1 }),
      delServidor({ id: 'srv-3', cliente_id: 'cli-3', orden: 2 }),
    ]);
    rutas.reordenar(HOY, ['cli-3', 'cli-1']);

    rutas.aplicarSnapshot([delServidor({ id: 'srv-4', cliente_id: 'cli-4', orden: 3 })]);

    expect(clientesDelDia(rutas)).toEqual(['cli-3', 'cli-1', 'cli-4']);
    expect(rutas.delDia().map((f) => f.posicion)).toEqual([1, 2, null]);
  });

  it('una fila conocida con otro orden se actualiza; sin posicion local manda el del servidor', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([
      delServidor({ id: 'srv-1', cliente_id: 'cli-1', orden: 1 }),
      delServidor({ id: 'srv-3', cliente_id: 'cli-3', orden: 2 }),
    ]);

    rutas.aplicarSnapshot([delServidor({ id: 'srv-1', cliente_id: 'cli-1', orden: 3 })]);

    expect(rutas.porId('srv-1')?.orden).toBe(3);
    expect(clientesDelDia(rutas)).toEqual(['cli-3', 'cli-1']);
  });

  it('una fila conocida con otro orden, con posicion local: manda la local', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([
      delServidor({ id: 'srv-1', cliente_id: 'cli-1', orden: 1 }),
      delServidor({ id: 'srv-3', cliente_id: 'cli-3', orden: 2 }),
    ]);
    rutas.reordenar(HOY, ['cli-1', 'cli-3']);

    rutas.aplicarSnapshot([delServidor({ id: 'srv-1', cliente_id: 'cli-1', orden: 5 })]);

    expect(rutas.porId('srv-1')?.orden).toBe(5);
    expect(clientesDelDia(rutas)).toEqual(['cli-1', 'cli-3']);
  });

  it('una baja de un cliente SIN actividad hoy queda con la bandera y sin visitar (la pantalla la oculta)', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([delServidor()]);

    rutas.aplicarSnapshot([delServidor({ activo: 0 })]);

    expect(rutas.delDia()).toMatchObject([{ id: 'srv-1', activo: 0, visitado: false }]);
  });

  it('una baja de un cliente CON actividad hoy se queda, visitada (fuera de ruta)', () => {
    const { rutas, ventas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    venderA(ventas);

    rutas.aplicarSnapshot([delServidor({ activo: 0 })]);

    expect(rutas.delDia()).toMatchObject([{ id: 'srv-1', activo: 0, visitado: true }]);
  });

  it('una fila viva del servidor funde el alta local del mismo cliente: queda la del servidor y la posicion sobrevive', () => {
    const { rutas } = montar();
    const alta = rutas.agregar('cli-3', CTX);
    rutas.reordenar(HOY, ['cli-3']);

    rutas.aplicarSnapshot([
      delServidor({ id: 'srv-9', cliente_id: 'cli-3', orden: 4, origen: 'vendedor' }),
    ]);

    expect(rutas.porId(alta.id)).toBeNull();
    expect(rutas.delDia()).toMatchObject([
      { id: 'srv-9', cliente_id: 'cli-3', posicion: 1, sync_estado: 'sincronizada' },
    ]);
    // Ya no hay nada que subir: si la operacion seguia pendiente, el servidor
    // la habria respondido `ruta-duplicada`.
    expect(rutas.pendientesDeSincronizar()).toEqual([]);
  });

  it('una fila viva del servidor borra la baja vieja del mismo cliente (la oficina lo quito y lo volvio a poner)', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([delServidor({ id: 'srv-1' })]);
    rutas.aplicarSnapshot([delServidor({ id: 'srv-1', activo: 0 })]);

    rutas.aplicarSnapshot([delServidor({ id: 'srv-2', orden: 2 })]);

    expect(rutas.porId('srv-1')).toBeNull();
    expect(rutas.delDia().map((f) => [f.id, f.activo])).toEqual([['srv-2', 1]]);
  });

  it('una fila cuyo cliente no esta en la tablet se omite y las demas entran (Review Focus 1)', () => {
    const { rutas } = montar();

    const escritas = rutas.aplicarSnapshot([
      delServidor({ id: 'srv-x', cliente_id: 'cli-que-no-bajo' }),
      delServidor({ id: 'srv-1', cliente_id: 'cli-1' }),
    ]);

    expect(escritas).toBe(1);
    expect(rutas.delDia().map((f) => f.id)).toEqual(['srv-1']);
  });

  it('un pull nunca toca el orden local', () => {
    const { rutas, deps } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    rutas.reordenar(HOY, ['cli-1']);

    rutas.aplicarSnapshot([delServidor({ orden: 7 }), delServidor({ activo: 0 })]);

    expect(
      deps.bd.getAllSync('select fecha, cliente_id, posicion from ruta_orden_local'),
    ).toEqual([{ fecha: HOY, cliente_id: 'cli-1', posicion: 1 }]);
  });
});

describe('delDia', () => {
  it('ordena por la posicion local y despues por el orden del servidor', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([
      delServidor({ id: 'srv-1', cliente_id: 'cli-1', orden: 1 }),
      delServidor({ id: 'srv-3', cliente_id: 'cli-3', orden: 2 }),
      delServidor({ id: 'srv-4', cliente_id: 'cli-4', orden: 3 }),
    ]);

    rutas.reordenar(HOY, ['cli-4']);

    expect(clientesDelDia(rutas)).toEqual(['cli-4', 'cli-1', 'cli-3']);
  });

  it('trae nombre y domicilio del cliente, y solo las filas de esa fecha', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([
      delServidor({ id: 'srv-4', cliente_id: 'cli-4' }),
      delServidor({ id: 'srv-m', cliente_id: 'cli-3', fecha: MANANA }),
    ]);

    expect(rutas.delDia()).toMatchObject([
      { id: 'srv-4', nombre: 'Cliente cli-4', domicilio: 'Av. Siempre Viva 742' },
    ]);
    expect(rutas.delDia(MANANA).map((f) => f.id)).toEqual(['srv-m']);
  });

  it('visitado sale de una venta de hoy y de un cobro de hoy', () => {
    const { rutas, ventas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    expect(rutas.delDia()[0].visitado).toBe(false);

    venderA(ventas);
    expect(rutas.delDia()[0].visitado).toBe(true);

    const otra = montar();
    otra.rutas.aplicarSnapshot([delServidor()]);
    otra.cobranzas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      ventaNotaId: 'nota-1',
      montoCentavos: 5000,
      metodoPago: 'efectivo',
      fechaPago: HOY,
    });
    expect(otra.rutas.delDia()[0].visitado).toBe(true);
  });

  it('una venta de AYER no marca visitado hoy (Review Focus 3)', () => {
    const { rutas, deps } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    deps.bd.runSync(
      `insert into venta (id, fecha, cliente_id, vendedor_id, sucursal_id, folio, num_nota,
         contado_credito, factura, comentarios, monto_total_centavos, grabada_en)
       values ('v-ayer', '2026-08-06', 'cli-1', 'ven-1', 'suc-tj', 'TJ260806AP01', null,
         'contado', 'N/A', null, 2800, '2026-08-06T20:00:00.000Z')`,
    );

    expect(rutas.delDia()[0].visitado).toBe(false);
  });

  it('la burbuja cuenta las notas con saldo y baja al cobrar sin red', () => {
    const { rutas, cobranzas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    expect(rutas.delDia()[0].notas_pendientes).toBe(2);

    // Liquidar la nota-2 (saldo 10000) la saca de las pendientes en la tablet.
    cobranzas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      ventaNotaId: 'nota-2',
      montoCentavos: 10000,
      metodoPago: 'efectivo',
      fechaPago: HOY,
    });

    expect(rutas.delDia()[0]).toMatchObject({ notas_pendientes: 1, visitado: true });
  });
});

describe('agregar', () => {
  it('agrega al final como alta pendiente del vendedor, con su clave', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([delServidor({ orden: 4 })]);

    const alta = rutas.agregar('cli-3', CTX);

    expect(alta).toEqual({
      id: 'id-1',
      cliente_id: 'cli-3',
      fecha: HOY,
      orden: 5,
      origen: 'vendedor',
      activo: 1,
      sync_estado: 'pendiente',
      sync_error: null,
      clave: 'id-1',
      sincronizado_en: MOMENTO,
    });
    expect(clientesDelDia(rutas)).toEqual(['cli-1', 'cli-3']);
  });

  it('rechaza un prospecto: a un prospecto no se le vende (D7)', () => {
    const { rutas } = montar();
    expect(() => rutas.agregar('cli-2', CTX)).toThrow(ErrorRuta);
    expect(() => rutas.agregar('cli-2', CTX)).toThrow(/prospecto/);
  });

  it('rechaza un cliente dado de baja, de otra sucursal o que no esta en la tablet', () => {
    const { rutas } = montar();
    expect(() => rutas.agregar('cli-5', CTX)).toThrow(ErrorRuta);
    expect(() => rutas.agregar('cli-6', CTX)).toThrow(ErrorRuta);
    expect(() => rutas.agregar('no-existe', CTX)).toThrow(ErrorRuta);
    expect(rutas.delDia()).toEqual([]);
  });

  it('rechaza un cliente que ya esta vivo en la ruta de ese dia', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    expect(() => rutas.agregar('cli-1', CTX)).toThrow('Ese cliente ya está en la ruta de hoy.');
  });

  it('con el dia cerrado lanza ErrorJornada y no escribe nada', () => {
    const { rutas, jornadas } = montar();
    const jornada = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    jornadas.cerrar(jornada.id, 20);

    expect(() => rutas.agregar('cli-3', CTX)).toThrow(ErrorJornada);
    expect(() => rutas.agregar('cli-3', CTX)).toThrow(MENSAJE_DIA_CERRADO);
    expect(rutas.delDia()).toEqual([]);
  });

  it('avisa a las pantallas que la ruta cambio', () => {
    const { rutas, catalogos } = montar();
    const antes = catalogos.version();
    rutas.agregar('cli-3', CTX);
    expect(catalogos.version()).toBeGreaterThan(antes);
  });
});

describe('reordenar', () => {
  it('reescribe el orden local de esa fecha y no toca las demas', () => {
    const { rutas, deps } = montar();
    rutas.reordenar(MANANA, ['cli-4']);
    rutas.reordenar(HOY, ['cli-3', 'cli-1']);
    rutas.reordenar(HOY, ['cli-1']);

    expect(
      deps.bd.getAllSync(
        'select fecha, cliente_id, posicion from ruta_orden_local order by fecha, posicion',
      ),
    ).toEqual([
      { fecha: HOY, cliente_id: 'cli-1', posicion: 1 },
      { fecha: MANANA, cliente_id: 'cli-4', posicion: 1 },
    ]);
  });

  it('es transaccional: si falla a la mitad, se queda el orden anterior', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([
      delServidor({ id: 'srv-1', cliente_id: 'cli-1', orden: 1 }),
      delServidor({ id: 'srv-3', cliente_id: 'cli-3', orden: 2 }),
    ]);
    rutas.reordenar(HOY, ['cli-3', 'cli-1']);

    // Un id repetido viola la llave primaria en el segundo insert.
    expect(() => rutas.reordenar(HOY, ['cli-1', 'cli-1'])).toThrow();

    expect(clientesDelDia(rutas)).toEqual(['cli-3', 'cli-1']);
  });
});

describe('la cola del push', () => {
  it('pendientesDeSincronizar trae las altas pendientes y con error, nunca las filas del servidor', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    const a = rutas.agregar('cli-3', CTX);
    const b = rutas.agregar('cli-4', CTX);
    rutas.marcarError(b.id, 'cliente-inexistente: x');

    expect(rutas.pendientesDeSincronizar().map((r) => r.id)).toEqual([a.id, b.id]);
  });

  it('marcarSincronizada la saca de la cola y limpia el error', () => {
    const { rutas } = montar();
    const a = rutas.agregar('cli-3', CTX);
    rutas.marcarError(a.id, 'cliente-inexistente: x');

    rutas.marcarSincronizada(a.id);

    expect(rutas.porId(a.id)).toMatchObject({ sync_estado: 'sincronizada', sync_error: null });
    expect(rutas.pendientesDeSincronizar()).toEqual([]);
  });

  it('quitarRechazada borra solo un alta del vendedor que el servidor rechazo', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    const a = rutas.agregar('cli-3', CTX);

    expect(() => rutas.quitarRechazada(a.id)).toThrow(ErrorRuta);
    expect(() => rutas.quitarRechazada('srv-1')).toThrow(ErrorRuta);

    rutas.marcarError(a.id, 'cliente-inexistente: x');
    rutas.quitarRechazada(a.id);

    expect(rutas.porId(a.id)).toBeNull();
    expect(clientesDelDia(rutas)).toEqual(['cli-1']);
  });
});

describe('purgar', () => {
  it('borra filas y orden local de antes de hoy - 7, pero conserva las altas sin subir', () => {
    const { rutas, deps } = montar();
    rutas.aplicarSnapshot([
      delServidor({ id: 'srv-viejo', fecha: '2026-07-30' }),
      delServidor({ id: 'srv-limite', fecha: '2026-07-31' }),
    ]);
    rutas.reordenar('2026-07-30', ['cli-1']);
    const altaVieja = rutas.agregar('cli-3', CTX, '2026-07-01');

    rutas.purgar();

    expect(rutas.porId('srv-viejo')).toBeNull();
    expect(rutas.porId('srv-limite')).not.toBeNull();
    expect(rutas.porId(altaVieja.id)).not.toBeNull();
    expect(deps.bd.getAllSync('select * from ruta_orden_local')).toEqual([]);
  });
});
```

Run: `npm test --workspace=apps/tablet -- repositorios/rutas`
Expected: FAIL, `Cannot find module './rutas'`.

- [ ] **Paso 5: `repositorios/rutas.ts`**

```ts
import type { BaseDatos } from '../base-datos';
import type {
  Booleano,
  FechaISO,
  MomentoISO,
  OrigenRuta,
  Ruta,
  SyncEstadoRuta,
} from '../tipos';
import type { RepositorioCatalogos } from './catalogos';
import type { DepsRepositorio } from './deps';
import { enTransaccion } from './deps';
import { exigirJornadaAbierta } from './jornadas';

/** Error de regla de negocio de la ruta (no un fallo tecnico de SQLite). */
export class ErrorRuta extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorRuta';
  }
}

/**
 * Una fila de ruta como la manda el pull (`RutaPull` del contrato). Estructural
 * a proposito: la capa de datos no importa el contrato, y `aSnapshot` le pasa
 * las filas del pull tal cual.
 */
export type FilaRutaPull = Pick<Ruta, 'id' | 'cliente_id' | 'fecha' | 'orden' | 'origen' | 'activo'>;

/** Una fila de la ruta del dia como la pinta la pantalla principal (D16). */
export interface FilaRutaDelDia {
  id: string;
  cliente_id: string;
  fecha: FechaISO;
  orden: number;
  origen: OrigenRuta;
  activo: Booleano;
  sync_estado: SyncEstadoRuta;
  sync_error: string | null;
  nombre: string;
  domicilio: string | null;
  /** La que puso el dedo del vendedor, o `null` si no ha reordenado a este cliente. */
  posicion: number | null;
  /** Notas con saldo del cliente: la burbuja. Baja al cobrar sin red. */
  notas_pendientes: number;
  /** Hoy tiene venta o cobro en esta tablet (D5). Se deriva, no se guarda. */
  visitado: boolean;
}

/** Quien agrega: el vendedor con sesion y su sucursal. */
export interface ContextoAltaRuta {
  vendedorId: string;
  sucursalId: string;
}

/** `AAAA-MM-DD` menos `dias`. `Date.UTC` solo para la aritmetica del calendario. */
export function restarDias(fecha: FechaISO, dias: number): FechaISO {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia - dias)).toISOString().slice(0, 10);
}

/**
 * Aplica la ruta que baja en el pull, con la **regla de fusion** del spec (D15).
 * Sin transaccion propia: la llama `catalogos.guardarSnapshot` dentro de la suya,
 * despues de `cliente` (una fila de ruta puede traer a un cliente que llego en
 * el mismo snapshot).
 *
 * Por cada fila:
 *
 * 1. **Si su cliente no esta en la tablet, se omite.** La llave foranea a
 *    `cliente` revertiria el pull ENTERO y el vendedor se quedaria sin refrescar
 *    nada; la fila vuelve a bajar cuando el cliente llegue (Review Focus 1).
 * 2. **Si viene viva, antes se borra cualquier fila del mismo `(fecha,
 *    cliente)` con otro id**: un alta local (se funde: queda la del servidor; si
 *    la operacion seguia pendiente, el servidor la respondera `ruta-duplicada`,
 *    que la tablet trata como aplicada) o una baja vieja (la oficina quito y
 *    volvio a poner al cliente: en el servidor es otra fila). Sin este paso la
 *    fila viva nueva chocaria con `uq_ruta_fecha_cliente`.
 * 3. Upsert por `id`. Nunca toca `sync_estado` ni `clave`, ni `ruta_orden_local`:
 *    la posicion va por `(fecha, cliente)` y sobrevive a la fusion.
 *
 * Una fila con `activo: 0` se queda con la bandera; la pantalla decide (D16).
 *
 * @returns cuantas filas escribio (para que `guardarSnapshot` sepa si avisar).
 */
export function aplicarSnapshotRutas(
  bd: BaseDatos,
  filas: readonly FilaRutaPull[] | undefined,
  sincronizadoEn: MomentoISO,
): number {
  if (!filas || filas.length === 0) return 0;
  let escritas = 0;

  for (const fila of filas) {
    const cliente = bd.getFirstSync<{ id: string }>('select id from cliente where id = $id', {
      $id: fila.cliente_id,
    });
    if (!cliente) continue;

    if (fila.activo === 1) {
      bd.runSync(
        `delete from ruta
          where fecha = $fecha and cliente_id = $cliente_id and id <> $id`,
        { $fecha: fila.fecha, $cliente_id: fila.cliente_id, $id: fila.id },
      );
    }

    bd.runSync(
      `insert into ruta (id, cliente_id, fecha, orden, origen, activo, sync_estado, sincronizado_en)
       values ($id, $cliente_id, $fecha, $orden, $origen, $activo, 'sincronizada', $sincronizado_en)
       on conflict(id) do update set
         cliente_id = excluded.cliente_id,
         fecha = excluded.fecha,
         orden = excluded.orden,
         origen = excluded.origen,
         activo = excluded.activo,
         sincronizado_en = excluded.sincronizado_en`,
      {
        $id: fila.id,
        $cliente_id: fila.cliente_id,
        $fecha: fila.fecha,
        $orden: fila.orden,
        $origen: fila.origen,
        $activo: fila.activo,
        $sincronizado_en: sincronizadoEn,
      },
    );
    escritas += 1;
  }

  return escritas;
}

export type RepositorioRutas = ReturnType<typeof crearRepositorioRutas>;

/**
 * La ruta del dia en la tablet (T-37, D15): lo que baja del portal, lo que el
 * vendedor agrega y el orden en que la recorre.
 *
 * Recibe `catalogos` para leer el cliente y para **publicar el cambio**: la
 * pantalla principal escucha `versionCatalogos`, y SQLite no avisa a nadie.
 */
export function crearRepositorioRutas(
  { bd, reloj, generarId }: DepsRepositorio,
  { catalogos }: { catalogos: RepositorioCatalogos },
) {
  const repo = {
    /**
     * La ruta de un dia, en el orden del vendedor: primero su posicion local y,
     * sin ella, el orden del servidor (al final). Trae tambien las filas que la
     * oficina quito (`activo = 0`): `agruparRuta` decide si se ven.
     *
     * `visitado` es el mismo predicado que `ventas.delDia(cliente).length > 0 ||
     * cobranzas.delDia(cliente).length > 0` (D5), en la misma consulta. La
     * burbuja es la misma consulta que `catalogos.notasPendientesDe` mas
     * `saldo_centavos > 0`.
     */
    delDia(fecha: FechaISO = reloj.hoy()): FilaRutaDelDia[] {
      const filas = bd.getAllSync<Omit<FilaRutaDelDia, 'visitado'> & { visitado: number }>(
        `select r.id, r.cliente_id, r.fecha, r.orden, r.origen, r.activo,
                r.sync_estado, r.sync_error,
                c.nombre, c.domicilio,
                o.posicion,
                (select count(*) from nota_pendiente n
                  where n.cliente_id = r.cliente_id
                    and n.activo = 1 and n.saldo_centavos > 0) as notas_pendientes,
                (exists (select 1 from venta v
                          where v.cliente_id = r.cliente_id and v.fecha = r.fecha)
                 or exists (select 1 from cobranza k
                             where k.cliente_id = r.cliente_id and k.fecha = r.fecha)) as visitado
           from ruta r
           join cliente c on c.id = r.cliente_id
           left join ruta_orden_local o
                  on o.fecha = r.fecha and o.cliente_id = r.cliente_id
          where r.fecha = $fecha
          order by coalesce(o.posicion, 1000000000 + r.orden), r.orden, c.nombre`,
        { $fecha: fecha },
      );
      return filas.map((f) => ({ ...f, visitado: f.visitado === 1 }));
    },

    /**
     * El vendedor agrega a mano un cliente existente a su ruta (D2, D7). Nace
     * `pendiente`: sube como `ruta-alta` en la siguiente sincronizacion.
     *
     * @throws {ErrorJornada} con el dia cerrado (T-38): primero el candado.
     * @throws {ErrorRuta} si el cliente no se puede agregar.
     */
    agregar(
      clienteId: string,
      { vendedorId, sucursalId }: ContextoAltaRuta,
      fecha: FechaISO = reloj.hoy(),
    ): Ruta {
      exigirJornadaAbierta({ bd, reloj }, vendedorId);

      const cliente = catalogos.obtenerCliente(clienteId);
      if (!cliente || cliente.activo !== 1 || cliente.sucursal_id !== sucursalId) {
        throw new ErrorRuta(
          'Ese cliente ya no está en el catálogo de la tablet. Sincroniza y vuelve a intentarlo.',
        );
      }
      if (cliente.tipo !== 'cliente') {
        throw new ErrorRuta(
          'A un prospecto no se le agrega a la ruta: primero la oficina lo convierte en cliente.',
        );
      }
      const yaEsta = bd.getFirstSync<{ id: string }>(
        'select id from ruta where fecha = $fecha and cliente_id = $cliente_id and activo = 1',
        { $fecha: fecha, $cliente_id: clienteId },
      );
      if (yaEsta) throw new ErrorRuta('Ese cliente ya está en la ruta de hoy.');

      const id = generarId();
      enTransaccion(bd, () => {
        const siguiente = bd.getFirstSync<{ siguiente: number }>(
          'select coalesce(max(orden), 0) + 1 as siguiente from ruta where fecha = $fecha and activo = 1',
          { $fecha: fecha },
        );
        bd.runSync(
          `insert into ruta (id, cliente_id, fecha, orden, origen, activo, sync_estado, clave, sincronizado_en)
           values ($id, $cliente_id, $fecha, $orden, 'vendedor', 1, 'pendiente', $clave, $ahora)`,
          {
            $id: id,
            $cliente_id: clienteId,
            $fecha: fecha,
            $orden: siguiente?.siguiente ?? 1,
            // La clave de idempotencia es el id local, que no cambia nunca.
            $clave: id,
            // Momento de la captura: viaja como `ocurrido_en` (fuente-rutas).
            $ahora: reloj.ahora(),
          },
        );
      });

      catalogos.publicarCambio();
      const creada = repo.porId(id);
      if (!creada) throw new ErrorRuta('No se pudo leer el cliente recién agregado.');
      return creada;
    },

    /**
     * Guarda el orden que el vendedor dejo con el dedo (D10), en UNA
     * transaccion: si algo falla, se queda el orden anterior entero. No sube
     * (D4) y ningun pull lo toca.
     */
    reordenar(fecha: FechaISO, clienteIds: readonly string[]): void {
      enTransaccion(bd, () => {
        bd.runSync('delete from ruta_orden_local where fecha = $fecha', { $fecha: fecha });
        clienteIds.forEach((clienteId, i) => {
          bd.runSync(
            `insert into ruta_orden_local (fecha, cliente_id, posicion)
             values ($fecha, $cliente_id, $posicion)`,
            { $fecha: fecha, $cliente_id: clienteId, $posicion: i + 1 },
          );
        });
      });
      catalogos.publicarCambio();
    },

    /** Aplica filas del pull en su propia transaccion (pruebas y usos sueltos). */
    aplicarSnapshot(filas: readonly FilaRutaPull[], ahora: MomentoISO = reloj.ahora()): number {
      const escritas = enTransaccion(bd, () => aplicarSnapshotRutas(bd, filas, ahora));
      if (escritas > 0) catalogos.publicarCambio();
      return escritas;
    },

    porId(id: string): Ruta | null {
      return bd.getFirstSync<Ruta>('select * from ruta where id = $id', { $id: id });
    },

    /**
     * Altas locales que faltan por subir, incluidas las rechazadas (patron D19 de
     * ventas): un `cliente-inexistente` se recupera si el portal corrige al
     * cliente. Las filas del servidor (`clave` nula) nunca suben.
     */
    pendientesDeSincronizar(): Ruta[] {
      return bd.getAllSync<Ruta>(
        `select * from ruta
          where clave is not null and sync_estado in ('pendiente', 'error')
          order by fecha, rowid`,
      );
    },

    /** Subida (o `ruta-duplicada`, ver `fuente-rutas.ts`): sale de la cola. */
    marcarSincronizada(id: string): void {
      bd.runSync(
        `update ruta set sync_estado = 'sincronizada', sync_error = null, sincronizado_en = $ahora
          where id = $id and clave is not null`,
        { $ahora: reloj.ahora(), $id: id },
      );
    },

    /** El servidor la rechazo: el motivo se pinta bajo la fila, en rojo. */
    marcarError(id: string, motivo: string): void {
      bd.runSync(
        `update ruta set sync_estado = 'error', sync_error = $motivo
          where id = $id and clave is not null`,
        { $motivo: motivo, $id: id },
      );
      catalogos.publicarCambio();
    },

    /**
     * Quita de la ruta un alta del vendedor que el servidor rechazo. Es el
     * **unico** caso en que se borra una fila desde la tablet: es suya y no
     * existe en el servidor.
     *
     * @throws {ErrorRuta} si la fila no es un alta rechazada.
     */
    quitarRechazada(id: string): void {
      const fila = repo.porId(id);
      if (!fila || fila.origen !== 'vendedor' || fila.sync_estado !== 'error' || fila.clave === null) {
        throw new ErrorRuta('Solo se puede quitar un cliente que agregaste tú y que el servidor rechazó.');
      }
      enTransaccion(bd, () => {
        bd.runSync('delete from ruta where id = $id', { $id: id });
        bd.runSync(
          'delete from ruta_orden_local where fecha = $fecha and cliente_id = $cliente_id',
          { $fecha: fila.fecha, $cliente_id: fila.cliente_id },
        );
      });
      catalogos.publicarCambio();
    },

    /**
     * Borra la ruta y el orden local de los dias anteriores a `antesDe` (por
     * defecto, hoy - 7). Lo llama "Abrir el dia". Las altas que todavia no suben
     * **se conservan**: borrarlas perderia lo que la oficina necesita saber.
     */
    purgar(antesDe: FechaISO = restarDias(reloj.hoy(), 7)): void {
      enTransaccion(bd, () => {
        bd.runSync('delete from ruta_orden_local where fecha < $antes', { $antes: antesDe });
        bd.runSync(
          `delete from ruta
            where fecha < $antes
              and not (clave is not null and sync_estado in ('pendiente', 'error'))`,
          { $antes: antesDe },
        );
      });
    },
  };

  return repo;
}
```

- [ ] **Paso 6: Ver que pasan**

Run: `npm test --workspace=apps/tablet -- repositorios/rutas 011-ruta`
Expected: PASS.

- [ ] **Paso 7: Suite, typecheck y lint**

Run:
```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
```
Expected: todo en verde; pruebas = línea base + las de esta tarea.

- [ ] **Paso 8: Commit**

```bash
git add apps/tablet/src/datos/migraciones/011-ruta.ts apps/tablet/src/datos/migraciones/011-ruta.spec.ts \
  apps/tablet/src/datos/migraciones/index.ts apps/tablet/src/datos/tipos.ts \
  apps/tablet/src/datos/repositorios/rutas.ts apps/tablet/src/datos/repositorios/rutas.spec.ts
git commit -m "T-37: tablet — tabla local de la ruta y repositorio con la regla de fusion

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 7: Tablet — la ruta en el pull y en el push (D15)

**Archivos:**
- Modificar: `apps/tablet/src/datos/repositorios/catalogos.ts`, `catalogos.spec.ts`
- Modificar: `apps/tablet/src/sincronizacion/motor.ts`, `motor.spec.ts`
- Crear: `apps/tablet/src/sincronizacion/fuente-rutas.ts`, `apps/tablet/src/sincronizacion/fuente-rutas.spec.ts`
- Modificar: `apps/tablet/src/sincronizacion/pendientes.ts`, `pendientes.spec.ts`
- Modificar: `apps/tablet/src/datos/inicializar.ts`, `apps/tablet/src/datos/index.ts`
- Modificar: `apps/tablet/src/estado/proveedor-sesion.tsx`

**Interfaces:**
- Consume: Tarea 2 (`RutaPull`, `RespuestaPull.rutas?`, `DatosRutaAlta`, `'ruta-alta'`); Tarea 6
  (`aplicarSnapshotRutas`, `FilaRutaPull`, `crearRepositorioRutas`, `RepositorioRutas`).
- Produce:
  - `SnapshotCatalogos.rutas?: FilaRutaPull[]`; `guardarSnapshot` la aplica **después de `cliente`**.
  - `aSnapshot(respuesta).rutas = respuesta.rutas` (`undefined` si el servidor no la manda).
  - `fuenteRutas(rutas: RepositorioRutas): FuenteOperaciones` con `tipo: 'ruta-alta'` y
    `CODIGO_RUTA_DUPLICADA = 'ruta-duplicada'`.
  - `CapaDatos.rutas: RepositorioRutas`; `FuentesConPendientes.rutas`; `contarPendientesDeSubir` suma las altas.
  - `@/datos` exporta `crearRepositorioRutas`, `ErrorRuta` y los tipos `RepositorioRutas`, `FilaRutaDelDia`,
    `ContextoAltaRuta`, `FilaRutaPull`.

- [ ] **Paso 1: Pruebas (fallan)**

a) En `apps/tablet/src/datos/repositorios/catalogos.spec.ts`, agregar el import
`import { crearRepositorioRutas } from './rutas';` y, al final del archivo:

```ts
describe('guardarSnapshot con la ruta del dia (T-37)', () => {
  const fila = {
    id: 'srv-1',
    cliente_id: 'cli-9',
    fecha: '2026-08-07',
    orden: 1,
    origen: 'oficina' as const,
    activo: 1 as const,
  };
  const clienteNuevo = () => ({
    ...snapshotDePrueba().clientes![0],
    id: 'cli-9',
    nombre: 'Cliente nuevo en el mismo pull',
  });

  it('aplica la ruta DESPUES de los clientes: un cliente nuevo y su fila pueden venir juntos', () => {
    const deps = depsDePrueba();
    const catalogos = crearRepositorioCatalogos(deps);
    const rutas = crearRepositorioRutas(deps, { catalogos });

    catalogos.guardarSnapshot({
      ...snapshotDePrueba(),
      clientes: [...(snapshotDePrueba().clientes ?? []), clienteNuevo()],
      rutas: [fila],
    });

    expect(rutas.delDia('2026-08-07').map((f) => f.id)).toEqual(['srv-1']);
  });

  it('el snapshot entero entra aunque una ruta apunte a un cliente desconocido (Review Focus 1)', () => {
    const deps = depsDePrueba();
    const catalogos = crearRepositorioCatalogos(deps);

    catalogos.guardarSnapshot({ ...snapshotDePrueba(), rutas: [fila] });

    expect(catalogos.obtenerCliente('cli-1')).not.toBeNull();
    expect(deps.bd.getAllSync('select id from ruta')).toEqual([]);
  });

  it('un pull que solo trae ruta avisa a las pantallas', () => {
    const { catalogos } = conCatalogos();
    const antes = catalogos.version();

    catalogos.guardarSnapshot({ rutas: [{ ...fila, cliente_id: 'cli-1' }] });

    expect(catalogos.version()).toBeGreaterThan(antes);
  });
});
```

b) En `apps/tablet/src/sincronizacion/motor.spec.ts`, después del `describe('aSnapshot (T-20)', …)`:

```ts
describe('aSnapshot (T-37)', () => {
  it('pasa la ruta del pull al snapshot y tolera un servidor que todavia no la manda', () => {
    const fila = {
      id: 'srv-1',
      cliente_id: 'cli-1',
      fecha: '2026-08-07',
      orden: 1,
      origen: 'oficina' as const,
      activo: 1 as const,
    };
    expect(aSnapshot(respuestaPullDePrueba({ rutas: [fila] })).rutas).toEqual([fila]);
    expect(aSnapshot(respuestaPullDePrueba()).rutas).toBeUndefined();
  });
});
```

c) Crear `apps/tablet/src/sincronizacion/fuente-rutas.spec.ts`:

```ts
import { depsDePrueba, MOMENTO, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioRutas } from '@/datos/repositorios/rutas';

import { fuenteRutas } from './fuente-rutas';

const CTX = { vendedorId: 'ven-1', sucursalId: 'suc-tj' };

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const rutas = crearRepositorioRutas(deps, { catalogos });
  return { rutas, fuente: fuenteRutas(rutas) };
}

describe('fuente de altas de ruta (T-37)', () => {
  it('sin altas no hay nada que subir', () => {
    const { fuente } = montar();
    expect(fuente.tipo).toBe('ruta-alta');
    expect(fuente.pendientes()).toEqual([]);
  });

  it('arma el sobre del contrato: el cliente va en datos, sin cliente ni folio en el sobre', () => {
    const { rutas, fuente } = montar();
    const alta = rutas.agregar('cli-1', CTX);

    expect(fuente.pendientes()).toEqual([
      {
        clave: alta.id,
        tipo: 'ruta-alta',
        fecha_operacion: '2026-08-07',
        ocurrido_en: MOMENTO,
        datos: { cliente_id: 'cli-1' },
      },
    ]);
  });

  it('un alta aceptada sale de la cola', () => {
    const { rutas, fuente } = montar();
    const alta = rutas.agregar('cli-1', CTX);
    fuente.marcarSincronizada(alta.id);
    expect(fuente.pendientes()).toEqual([]);
  });

  it('ruta-duplicada NO es un error: la fila queda sincronizada y sin motivo (D13)', () => {
    const { rutas, fuente } = montar();
    const alta = rutas.agregar('cli-1', CTX);

    // Asi lo arma `aplicarResultado` del motor: "<codigo>: <motivo>".
    fuente.marcarError(alta.id, 'ruta-duplicada: El cliente ya está en tu ruta del 2026-08-07.');

    expect(rutas.porId(alta.id)).toMatchObject({ sync_estado: 'sincronizada', sync_error: null });
    expect(fuente.pendientes()).toEqual([]);
  });

  it('cliente-inexistente se queda en error con el motivo y se vuelve a mandar', () => {
    const { rutas, fuente } = montar();
    const alta = rutas.agregar('cli-1', CTX);

    fuente.marcarError(alta.id, 'cliente-inexistente: El cliente … no existe.');

    expect(rutas.porId(alta.id)).toMatchObject({
      sync_estado: 'error',
      sync_error: 'cliente-inexistente: El cliente … no existe.',
    });
    expect(fuente.pendientes().map((o) => o.clave)).toEqual([alta.id]);
  });
});
```

d) En `apps/tablet/src/sincronizacion/pendientes.spec.ts`: agregar el import
`import { crearRepositorioRutas } from '@/datos/repositorios/rutas';`, en `montar()` agregar al objeto que
devuelve `rutas: crearRepositorioRutas(deps, { catalogos }),`, y la prueba de la suma queda:

```ts
  /**
   * Las 5 fuentes del push de hoy (T-07, T-16, T-40, T-20, T-37). Si se olvida
   * una aqui, el menu de la jornada y "cerrar el dia" dicen "listo" con datos
   * sin subir (I-1, PR #90).
   */
  it('suma jornada, venta, prospecto, cobranza y alta de ruta pendientes', () => {
    const fuentes = montar();
    const { jornadas, ventas, prospectos, cobranzas, rutas } = fuentes;

    const jornada = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '1234',
      contadoCredito: 'credito',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
    });
    prospectos.registrar({
      vendedorId: 'ven-1',
      sucursalId: 'suc-tj',
      nombre: 'Tacos Aaron',
      telefono: '6641112233',
      encargado: 'Don Aaron',
      tipoNegocioId: null,
      comentarios: null,
      lat: null,
      lng: null,
    });

    cobranzas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      ventaNotaId: 'nota-1',
      montoCentavos: 5000,
      metodoPago: 'efectivo',
      fechaPago: '2026-08-07',
    });
    rutas.agregar('cli-1', { vendedorId: 'ven-1', sucursalId: 'suc-tj' });

    // La jornada cuenta solo cerrada (D7). Se cierra al final: con el dia
    // cerrado ya no se puede registrar nada (D6).
    jornadas.cerrar(jornada.id, 20);

    expect(contarPendientesDeSubir(fuentes)).toBe(5);
  });
```

Run: `npm test --workspace=apps/tablet -- catalogos motor fuente-rutas pendientes`
Expected: FAIL (`rutas` no existe en `SnapshotCatalogos`/`FuentesConPendientes`; `./fuente-rutas` no existe).

- [ ] **Paso 2: `catalogos.ts`**

a) Imports: agregar

```ts
import { aplicarSnapshotRutas, type FilaRutaPull } from './rutas';
```

b) En `SnapshotCatalogos`, después de `notas?:`:

```ts
  /**
   * T-37. La ruta diaria del vendedor. Se aplica con su propia regla de fusion
   * (`aplicarSnapshotRutas`), no con el upsert generico.
   */
  rutas?: FilaRutaPull[];
```

c) En `guardarSnapshot`, la suma queda (la ruta después de `cliente`, como pide D15):

```ts
        return (
          upsert(bd, 'sucursal', COLUMNAS.sucursal, snapshot.sucursales, ahora) +
          upsert(bd, 'vendedor', COLUMNAS.vendedor, snapshot.vendedores, ahora) +
          upsert(bd, 'vehiculo', COLUMNAS.vehiculo, snapshot.vehiculos, ahora) +
          upsert(bd, 'producto', COLUMNAS.producto, snapshot.productos, ahora) +
          // Sin llaves foraneas hacia nadie, asi que su sitio en el orden es
          // indiferente; va junto a los demas catalogos de empresa.
          upsert(bd, 'tipo_negocio', COLUMNAS.tipo_negocio, snapshot.tiposNegocio, ahora) +
          upsert(bd, 'presentacion', COLUMNAS.presentacion, snapshot.presentaciones, ahora) +
          upsert(bd, 'cliente', COLUMNAS.cliente, snapshot.clientes, ahora) +
          // T-37: despues de `cliente`, porque la fila de ruta lo referencia y un
          // cliente nuevo puede venir en este mismo snapshot. Regla de fusion en
          // `rutas.ts`; omite filas de clientes que la tablet no tiene.
          aplicarSnapshotRutas(bd, snapshot.rutas, ahora) +
          upsert(bd, 'cliente_precio', COLUMNAS.cliente_precio, snapshot.precios, ahora) +
          upsert(bd, 'nota_pendiente', COLUMNAS.nota_pendiente, snapshot.notas, ahora)
        );
```

y el comentario de orden de llaves foráneas de encima suma `cliente -> ruta`.

- [ ] **Paso 3: `motor.ts`**

En `aSnapshot`, después de `notas: …,`:

```ts
    // T-37: un servidor anterior a este ticket no manda la coleccion. Se pasa
    // `undefined` y `guardarSnapshot` no escribe nada de la ruta: la tablet
    // funciona sin ruta asignada (D3).
    rutas: respuesta.rutas,
```

y en el comentario de `FuenteOperaciones` ("hoy jornada (T-04), venta (T-16), prospecto (T-40) y cobranza (T-20)")
agrega "y el alta de ruta (T-37)".

- [ ] **Paso 4: `fuente-rutas.ts`**

Crear `apps/tablet/src/sincronizacion/fuente-rutas.ts`:

```ts
import type { RepositorioRutas } from '@/datos/repositorios/rutas';

import type { DatosRutaAlta, OperacionSaliente } from './contrato';
import type { FuenteOperaciones } from './motor';

/** El codigo con el que el servidor dice "la oficina ya lo tenia". */
export const CODIGO_RUTA_DUPLICADA = 'ruta-duplicada';

/**
 * Las altas de ruta del vendedor, como operaciones del push (T-37, D13).
 *
 * - **`clave`** es el id local de la fila: no cambia, y reenviar no duplica.
 * - **`fecha_operacion`** es el dia de la ruta, no otra lectura del reloj.
 * - **`datos.cliente_id`** y no `cliente_id` en el sobre: ver `DatosRutaAlta`.
 * - El orden **no viaja** (D4).
 *
 * `ruta-duplicada` **no es un error del vendedor**: la oficina ya tenia a ese
 * cliente. Se marca sincronizada y el pull posterior la funde con la fila del
 * servidor (`aplicarSnapshotRutas`). Los demas rechazos se quedan en `error` y
 * se reenvian (patron D19).
 */
export function fuenteRutas(rutas: RepositorioRutas): FuenteOperaciones {
  return {
    tipo: 'ruta-alta',

    pendientes(): OperacionSaliente[] {
      return rutas.pendientesDeSincronizar().map((r) => {
        const datos: DatosRutaAlta = { cliente_id: r.cliente_id };
        return {
          clave: r.id,
          tipo: 'ruta-alta',
          fecha_operacion: r.fecha,
          // En un alta pendiente, `sincronizado_en` es el momento de la captura.
          ocurrido_en: r.sincronizado_en,
          datos,
        };
      });
    },

    marcarSincronizada: (clave) => rutas.marcarSincronizada(clave),

    marcarError: (clave, motivo) => {
      // El motor arma el motivo como "<codigo>: <texto>" (`aplicarResultado`).
      if (motivo.split(':')[0].trim() === CODIGO_RUTA_DUPLICADA) {
        rutas.marcarSincronizada(clave);
        return;
      }
      rutas.marcarError(clave, motivo);
    },
  };
}
```

- [ ] **Paso 5: `pendientes.ts`**

`apps/tablet/src/sincronizacion/pendientes.ts` queda:

```ts
import type { RepositorioCobranzas } from '@/datos/repositorios/cobranzas';
import type { RepositorioJornadas } from '@/datos/repositorios/jornadas';
import type { RepositorioProspectos } from '@/datos/repositorios/prospectos';
import type { RepositorioRutas } from '@/datos/repositorios/rutas';
import type { RepositorioVentas } from '@/datos/repositorios/ventas';

/**
 * Las fuentes del push cuyos pendientes cuentan como "registros por subir".
 *
 * Un subconjunto de `CapaDatos` (`@/datos/inicializar`) en vez del objeto
 * completo: asi la prueba en Node arma solo estos repositorios, sin pasar por
 * `inicializarCapaDatos()` (que abre SQLite con el driver de Expo). El tipo no
 * obliga a nadie a nada — cuando el siguiente ticket agregue otra fuente al
 * push, la disciplina de sumarla **aqui**, en el unico lugar que cuenta, sigue
 * siendo manual.
 */
export interface FuentesConPendientes {
  jornadas: RepositorioJornadas;
  ventas: RepositorioVentas;
  prospectos: RepositorioProspectos;
  cobranzas: RepositorioCobranzas;
  /** T-37: las altas de ruta del vendedor. */
  rutas: RepositorioRutas;
}

/**
 * Cuenta lo que falta por subir, sumando las 5 fuentes del push de hoy (T-07,
 * T-16, T-40, T-20, T-37): jornada, venta, prospecto, cobranza y alta de ruta.
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
    datos.rutas.pendientesDeSincronizar().length
  );
}
```

- [ ] **Paso 6: Capa de datos y proveedor**

a) `apps/tablet/src/datos/inicializar.ts`: import
`import { crearRepositorioRutas, type RepositorioRutas } from './repositorios/rutas';`; en `CapaDatos`, después de
`cobranzas`:

```ts
  /** La ruta del dia: lo que baja del portal y lo que agrega el vendedor (T-37). */
  rutas: RepositorioRutas;
```

y en el objeto que devuelve `inicializarCapaDatos`, después de `cobranzas: …,`:

```ts
    // El MISMO `catalogos`: es quien publica la version que observa la
    // pantalla principal, y la ruta se aplica dentro de su `guardarSnapshot`.
    rutas: crearRepositorioRutas(deps, { catalogos }),
```

b) `apps/tablet/src/datos/index.ts`, al final (antes de `export * from './tipos';`):

```ts
export {
  aplicarSnapshotRutas,
  crearRepositorioRutas,
  ErrorRuta,
  restarDias,
} from './repositorios/rutas';
export type {
  ContextoAltaRuta,
  FilaRutaDelDia,
  FilaRutaPull,
  RepositorioRutas,
} from './repositorios/rutas';
```

c) `apps/tablet/src/estado/proveedor-sesion.tsx`: import `import { fuenteRutas } from
'@/sincronizacion/fuente-rutas';` y la lista de fuentes queda:

```ts
      // T-16: las ventas del dia suben despues de la jornada; T-40 suma los
      // prospectos. Los cobros (T-20) van despues de las ventas, para no llegar
      // nunca antes que una venta del mismo dia. Las altas de ruta (T-37) no
      // dependen de nadie: van al final.
      fuentes: [
        fuenteJornadas(datos.jornadas),
        fuenteVentas(datos.ventas),
        fuenteProspectos(datos.prospectos),
        fuenteCobranzas(datos.cobranzas),
        fuenteRutas(datos.rutas),
      ],
```

- [ ] **Paso 7: Ver que pasan, suite completa, typecheck y lint**

Run:
```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
```
Expected: todo en verde; pruebas = línea base + Tareas 6 y 7.

- [ ] **Paso 8: Commit**

```bash
git add apps/tablet/src/datos/repositorios/catalogos.ts apps/tablet/src/datos/repositorios/catalogos.spec.ts \
  apps/tablet/src/sincronizacion/motor.ts apps/tablet/src/sincronizacion/motor.spec.ts \
  apps/tablet/src/sincronizacion/fuente-rutas.ts apps/tablet/src/sincronizacion/fuente-rutas.spec.ts \
  apps/tablet/src/sincronizacion/pendientes.ts apps/tablet/src/sincronizacion/pendientes.spec.ts \
  apps/tablet/src/datos/inicializar.ts apps/tablet/src/datos/index.ts apps/tablet/src/estado/proveedor-sesion.tsx
git commit -m "T-37: tablet — la ruta baja en el pull y las altas suben como ruta-alta

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Tarea 8: Tablet — funciones puras de la pantalla principal (D16)

**Archivos:**
- Crear: `apps/tablet/src/estado/ruta-del-dia.ts`, `apps/tablet/src/estado/ruta-del-dia.spec.ts`

**Interfaces:**
- Consume: `FilaRutaDelDia` (Tarea 6, solo tipo), `Cliente` (`tipos.ts`), `formatearMomento` (`ui/momento.ts`).
- Produce (las usan las Tareas 9 y 10):
  - `agruparRuta<T extends FilaAgrupable>(filas: readonly T[]): { enRuta: T[]; fueraDeRuta: T[] }`.
  - `textoAvisoSinRuta(ultimaSincronizacion: string | null): string`.
  - `primeraLineaDomicilio(domicilio: string | null): string`.
  - `urlMapa(cliente: Pick<Cliente, 'lat' | 'lng' | 'domicilio'>): string | null`.
  - `urlTelefono(telefono: string | null): string | null`.
  - `moverElemento<T>(lista: readonly T[], desde: number, hasta: number): T[]`.
  - `indiceDestino(desde: number, dy: number, altoFila: number, total: number): number`.
  - `textoAgregado(nombre: string): string`, `textoBurbuja(n: number): string`.
  - `filtrarParaAgregar(clientes, enRuta: ReadonlySet<string>, busqueda: string, limite?): T[]`.
  - `SECCIONES_PENDIENTES`, `type SeccionPendiente`, `esSeccionPendiente(s: string)`.
  - `interface EntradaMenu { clave; titulo; descripcion; destino: string; deshabilitada: boolean }` y
    `entradasMenu(diaCerrado: boolean): EntradaMenu[]`.

**Por qué puro y aquí:** la tablet no tiene pruebas de pantalla (solo `src/**/*.spec.ts` en Node). Todo lo que la
pantalla decide —qué filas se ven y dónde, a dónde manda cada toque, qué índice resulta de un arrastre— va aquí con
su prueba, como `menu-jornada.ts` de T-38. Sin imports de React Native ni de expo-router: este archivo corre en
Node.

- [ ] **Paso 1: Prueba (falla)**

Crear `apps/tablet/src/estado/ruta-del-dia.spec.ts`:

```ts
import {
  agruparRuta,
  entradasMenu,
  esSeccionPendiente,
  filtrarParaAgregar,
  indiceDestino,
  moverElemento,
  primeraLineaDomicilio,
  SECCIONES_PENDIENTES,
  textoAgregado,
  textoAvisoSinRuta,
  textoBurbuja,
  urlMapa,
  urlTelefono,
} from './ruta-del-dia';

const fila = (cliente_id: string, activo: 0 | 1, visitado: boolean) => ({
  cliente_id,
  activo,
  visitado,
});

describe('agruparRuta (D5, D16)', () => {
  it('las vivas van a la ruta, visitadas o no, en el orden que llegan', () => {
    const r = agruparRuta([fila('a', 1, true), fila('b', 1, false)]);
    expect(r.enRuta.map((f) => f.cliente_id)).toEqual(['a', 'b']);
    expect(r.fueraDeRuta).toEqual([]);
  });

  it('una baja SIN actividad hoy desaparece', () => {
    expect(agruparRuta([fila('a', 0, false)])).toEqual({ enRuta: [], fueraDeRuta: [] });
  });

  it('una baja CON actividad hoy va a "Fuera de ruta"', () => {
    const r = agruparRuta([fila('a', 1, false), fila('b', 0, true)]);
    expect(r.enRuta.map((f) => f.cliente_id)).toEqual(['a']);
    expect(r.fueraDeRuta.map((f) => f.cliente_id)).toEqual(['b']);
  });

  it('si el cliente quitado volvio a la ruta, no se pinta dos veces', () => {
    const r = agruparRuta([fila('a', 1, true), fila('a', 0, true)]);
    expect(r.enRuta).toHaveLength(1);
    expect(r.fueraDeRuta).toEqual([]);
  });
});

describe('textos', () => {
  it('el aviso sin ruta dice cuando fue la ultima sincronizacion (D3)', () => {
    expect(textoAvisoSinRuta(null)).toBe(
      'La oficina no ha asignado ruta para hoy. Última sincronización: nunca.',
    );
    expect(textoAvisoSinRuta('2026-10-12T18:02:54.922Z')).toMatch(
      /^La oficina no ha asignado ruta para hoy\. Última sincronización: 2026-10-1[123] \d{2}:\d{2}\.$/,
    );
  });

  it('la primera linea del domicilio, o "sin domicilio"', () => {
    expect(primeraLineaDomicilio('Calle 5 #12\nCol. Centro')).toBe('Calle 5 #12');
    expect(primeraLineaDomicilio('  \n  Av. Reforma 9 ')).toBe('Av. Reforma 9');
    expect(primeraLineaDomicilio(null)).toBe('sin domicilio');
    expect(primeraLineaDomicilio('   ')).toBe('sin domicilio');
  });

  it('el aviso al agregar y la etiqueta de la burbuja', () => {
    expect(textoAgregado('Abarrotes La Esquina')).toBe('Abarrotes La Esquina agregado al final');
    expect(textoBurbuja(1)).toBe('1 nota pendiente');
    expect(textoBurbuja(3)).toBe('3 notas pendientes');
  });
});

describe('urlMapa y urlTelefono (ficha del cliente)', () => {
  it('con coordenada, busca la coordenada', () => {
    expect(urlMapa({ lat: 32.5149, lng: -117.0382, domicilio: 'Calle 5' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=32.5149,-117.0382',
    );
  });

  it('sin coordenada, busca el domicilio codificado', () => {
    expect(urlMapa({ lat: null, lng: null, domicilio: 'Calle 5 #12, Tijuana' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Calle%205%20%2312%2C%20Tijuana',
    );
  });

  it('media coordenada no ubica nada: usa el domicilio; sin nada, null', () => {
    expect(urlMapa({ lat: 32.5, lng: null, domicilio: 'Calle 5' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Calle%205',
    );
    expect(urlMapa({ lat: null, lng: null, domicilio: null })).toBeNull();
  });

  it('el telefono se marca solo con digitos y +', () => {
    expect(urlTelefono('(664) 123-4567')).toBe('tel:6641234567');
    expect(urlTelefono('+52 664 123 4567')).toBe('tel:+526641234567');
    expect(urlTelefono('')).toBeNull();
    expect(urlTelefono(null)).toBeNull();
  });
});

describe('reordenar con el dedo (D10)', () => {
  it('moverElemento saca y vuelve a meter, sin mutar la lista', () => {
    const lista = ['a', 'b', 'c', 'd'];
    expect(moverElemento(lista, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moverElemento(lista, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moverElemento(lista, 1, 1)).toEqual(lista);
    expect(lista).toEqual(['a', 'b', 'c', 'd']);
  });

  it('moverElemento fuera de rango devuelve una copia igual', () => {
    expect(moverElemento(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
    expect(moverElemento(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });

  it('indiceDestino redondea el desplazamiento a filas y no se sale de la lista', () => {
    expect(indiceDestino(1, 0, 96, 5)).toBe(1);
    expect(indiceDestino(1, 50, 96, 5)).toBe(2);
    expect(indiceDestino(1, 40, 96, 5)).toBe(1);
    expect(indiceDestino(1, -100, 96, 5)).toBe(0);
    expect(indiceDestino(1, 1000, 96, 5)).toBe(4);
    expect(indiceDestino(0, 300, 0, 5)).toBe(0);
  });
});

describe('filtrarParaAgregar ("Agregar a mi ruta")', () => {
  const c = (id: string, nombre: string, extra: { tipo?: 'cliente' | 'prospecto'; activo?: 0 | 1 } = {}) => ({
    id,
    nombre,
    tipo: extra.tipo ?? ('cliente' as const),
    activo: extra.activo ?? (1 as const),
  });

  it('ofrece clientes activos que no estan en la ruta de hoy, buscando sin acentos ni mayusculas', () => {
    const clientes = [
      c('1', 'Abarrotes Doña Lupe'),
      c('2', 'Tienda La Esquina'),
      c('3', 'Abarrotes El Güero'),
      c('4', 'Abarrotes Prospecto', { tipo: 'prospecto' }),
      c('5', 'Abarrotes de baja', { activo: 0 }),
    ];
    expect(filtrarParaAgregar(clientes, new Set(['3']), 'abarrotes dona').map((x) => x.id)).toEqual([
      '1',
    ]);
    expect(filtrarParaAgregar(clientes, new Set(['3']), '').map((x) => x.id)).toEqual(['1', '2']);
  });

  it('corta en el limite', () => {
    const muchos = Array.from({ length: 80 }, (_, i) => c(String(i), `Cliente ${i}`));
    expect(filtrarParaAgregar(muchos, new Set(), '')).toHaveLength(50);
  });
});

describe('menu hamburguesa (D9, D16)', () => {
  it('las entradas del spec, en su orden, con destino', () => {
    expect(entradasMenu(false).map((e) => [e.titulo, e.destino])).toEqual([
      ['Todos los clientes', '/(jornada)/operacion'],
      ['Prospectos capturados', '/(jornada)/prospectos'],
      ['Gastos', '/(jornada)/pendiente/gastos'],
      ['Inventario', '/(jornada)/pendiente/inventario'],
      ['Merma, promoción y consumo', '/(jornada)/pendiente/merma'],
      ['Ruta y GPS', '/(jornada)/ruta'],
      ['Cerrar el día', '/(jornada)/cerrar-dia'],
    ]);
    expect(entradasMenu(false).every((e) => !e.deshabilitada)).toBe(true);
  });

  it('con el dia cerrado se deshabilita solo lo que captura', () => {
    const deshabilitadas = entradasMenu(true)
      .filter((e) => e.deshabilitada)
      .map((e) => e.clave);
    expect(deshabilitadas).toEqual(['gastos', 'inventario', 'merma']);
  });

  it('cada pendiente del menu tiene su seccion con ticket', () => {
    for (const e of entradasMenu(false)) {
      const seccion = e.destino.replace('/(jornada)/pendiente/', '');
      if (e.destino.startsWith('/(jornada)/pendiente/')) {
        expect(esSeccionPendiente(seccion)).toBe(true);
        expect(SECCIONES_PENDIENTES[seccion as keyof typeof SECCIONES_PENDIENTES].ticket).not.toBe('');
      }
    }
    expect(esSeccionPendiente('otra')).toBe(false);
  });
});
```

Run: `npm test --workspace=apps/tablet -- ruta-del-dia`
Expected: FAIL, `Cannot find module './ruta-del-dia'`.

- [ ] **Paso 2: `src/estado/ruta-del-dia.ts`**

```ts
import type { FilaRutaDelDia } from '@/datos/repositorios/rutas';
import type { Cliente } from '@/datos/tipos';
import { formatearMomento } from '@/ui/momento';

/**
 * Lo que la pantalla principal decide (T-37, D16), sin React: la tablet no tiene
 * pruebas de pantalla, asi que todo lo que se pueda fijar con una prueba vive
 * aqui (mismo criterio que `menu-jornada.ts`, T-38).
 */

/** Lo minimo que `agruparRuta` necesita de una fila. */
export type FilaAgrupable = Pick<FilaRutaDelDia, 'cliente_id' | 'activo' | 'visitado'>;

/**
 * Reparte las filas del dia (ya ordenadas por `rutas.delDia`) entre la ruta y
 * "Fuera de ruta" (D5, D16):
 *
 * - Viva → en la ruta, visitada o no (la palomita no la saca de la lista).
 * - Quitada por la oficina **con** actividad hoy → "Fuera de ruta": el vendedor
 *   fue, y eso es informacion para la efectividad.
 * - Quitada **sin** actividad → desaparece.
 * - Si el cliente quitado volvio a la ruta (otra fila viva), no se pinta dos veces.
 */
export function agruparRuta<T extends FilaAgrupable>(
  filas: readonly T[],
): { enRuta: T[]; fueraDeRuta: T[] } {
  const vivos = new Set(filas.filter((f) => f.activo === 1).map((f) => f.cliente_id));
  return {
    enRuta: filas.filter((f) => f.activo === 1),
    fueraDeRuta: filas.filter((f) => f.activo === 0 && f.visitado && !vivos.has(f.cliente_id)),
  };
}

/** El aviso de la lista vacia (D3), con la hora de la ultima sincronizacion. */
export function textoAvisoSinRuta(ultimaSincronizacion: string | null): string {
  return `La oficina no ha asignado ruta para hoy. Última sincronización: ${formatearMomento(ultimaSincronizacion)}.`;
}

/** La primera linea con texto del domicilio, o "sin domicilio" (un prospecto convertido sin el). */
export function primeraLineaDomicilio(domicilio: string | null): string {
  const linea = (domicilio ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return linea ?? 'sin domicilio';
}

const MAPS = 'https://www.google.com/maps/search/?api=1&query=';

/**
 * La direccion del cliente para Maps. Con coordenada (las dos), la coordenada;
 * si no, el domicilio codificado. Android abre la app de Maps si esta.
 */
export function urlMapa(cliente: Pick<Cliente, 'lat' | 'lng' | 'domicilio'>): string | null {
  if (cliente.lat !== null && cliente.lng !== null) {
    return `${MAPS}${cliente.lat},${cliente.lng}`;
  }
  const domicilio = cliente.domicilio?.trim();
  return domicilio ? `${MAPS}${encodeURIComponent(domicilio)}` : null;
}

/** `tel:` con solo digitos y `+`: el marcador no entiende parentesis ni guiones. */
export function urlTelefono(telefono: string | null): string | null {
  const limpio = (telefono ?? '').replace(/[^\d+]/g, '');
  return limpio.length > 0 ? `tel:${limpio}` : null;
}

/** El aviso breve al volver de "Agregar a mi ruta". */
export function textoAgregado(nombre: string): string {
  return `${nombre} agregado al final`;
}

/** Lo que lee el lector de pantalla en la burbuja. */
export function textoBurbuja(notas: number): string {
  return notas === 1 ? '1 nota pendiente' : `${notas} notas pendientes`;
}

/** Saca el elemento `desde` y lo mete en `hasta`. Fuera de rango, una copia igual. */
export function moverElemento<T>(lista: readonly T[], desde: number, hasta: number): T[] {
  const copia = [...lista];
  if (desde < 0 || desde >= copia.length || hasta < 0 || hasta >= copia.length) return copia;
  const [movido] = copia.splice(desde, 1);
  copia.splice(hasta, 0, movido);
  return copia;
}

/**
 * A que posicion cae una fila arrastrada `dy` puntos, con filas de alto fijo
 * (D10). Redondea al renglon mas cercano y nunca se sale de la lista.
 */
export function indiceDestino(desde: number, dy: number, altoFila: number, total: number): number {
  if (total <= 0 || altoFila <= 0) return desde;
  const destino = desde + Math.round(dy / altoFila);
  return Math.min(total - 1, Math.max(0, destino));
}

/** Sin acentos y en minusculas: "Doña" se encuentra escribiendo "dona". */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Los clientes que se pueden agregar a la ruta de hoy: activos, `tipo =
 * 'cliente'` (D7) y que no estan ya vivos en la ruta, filtrados por nombre.
 */
export function filtrarParaAgregar<T extends Pick<Cliente, 'id' | 'nombre' | 'tipo' | 'activo'>>(
  clientes: readonly T[],
  enRuta: ReadonlySet<string>,
  busqueda: string,
  limite = 50,
): T[] {
  const q = normalizar(busqueda);
  return clientes
    .filter((c) => c.tipo === 'cliente' && c.activo === 1 && !enRuta.has(c.id))
    .filter((c) => q === '' || normalizar(c.nombre).includes(q))
    .slice(0, limite);
}

/** Las secciones del menu que todavia no existen, con el ticket que las trae. */
export const SECCIONES_PENDIENTES = {
  gastos: {
    titulo: 'Gastos',
    ticket: 'pieza 6 del rediseño (T-30/T-31)',
    descripcion:
      'Gastos de la ruta con su tipo (catálogo del portal), monto y comprobante.',
  },
  inventario: {
    titulo: 'Inventario',
    ticket: 'T-27',
    descripcion: 'Recarga y devolución de producto a media jornada.',
  },
  merma: {
    titulo: 'Merma, promoción y consumo',
    ticket: 'T-27 / T-31',
    descripcion:
      'Registros que afectan el inventario y el corte. La promoción entrega producto a $0 y el consumo propio se registra antes de enviar el sobrante.',
  },
} as const;

export type SeccionPendiente = keyof typeof SECCIONES_PENDIENTES;

export function esSeccionPendiente(seccion: string): seccion is SeccionPendiente {
  return Object.prototype.hasOwnProperty.call(SECCIONES_PENDIENTES, seccion);
}

/** Una entrada del menu hamburguesa (D9). `destino` es una ruta de expo-router. */
export interface EntradaMenu {
  clave: string;
  titulo: string;
  descripcion: string;
  destino: string;
  deshabilitada: boolean;
}

/**
 * Las entradas del menu, en el orden del spec (D16). Con el dia cerrado se
 * deshabilita solo lo que captura (gastos, inventario, merma); lo que consulta
 * se sigue viendo. Ruta y GPS es la pantalla pendiente de T-41 que ya existe.
 */
export function entradasMenu(diaCerrado: boolean): EntradaMenu[] {
  return [
    {
      clave: 'clientes',
      titulo: 'Todos los clientes',
      descripcion: 'El catálogo completo de la sucursal',
      destino: '/(jornada)/operacion',
      deshabilitada: false,
    },
    {
      clave: 'prospectos',
      titulo: 'Prospectos capturados',
      descripcion: 'Los prospectos de hoy y su sincronización',
      destino: '/(jornada)/prospectos',
      deshabilitada: false,
    },
    ...(['gastos', 'inventario', 'merma'] as const).map((clave) => ({
      clave,
      titulo: SECCIONES_PENDIENTES[clave].titulo,
      descripcion: `Pendiente: ${SECCIONES_PENDIENTES[clave].ticket}`,
      destino: `/(jornada)/pendiente/${clave}`,
      deshabilitada: diaCerrado,
    })),
    {
      clave: 'ruta-gps',
      titulo: 'Ruta y GPS',
      descripcion: 'Pendiente: T-41',
      destino: '/(jornada)/ruta',
      deshabilitada: false,
    },
    {
      clave: 'cerrar-dia',
      titulo: 'Cerrar el día',
      descripcion: 'Kilometraje final',
      destino: '/(jornada)/cerrar-dia',
      deshabilitada: false,
    },
  ];
}
```

- [ ] **Paso 3: Ver que pasa, typecheck y lint**

Run:
```bash
npm test --workspace=apps/tablet -- ruta-del-dia
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
```
Expected: PASS; todo en verde.

- [ ] **Paso 4: Commit**

```bash
git add apps/tablet/src/estado/ruta-del-dia.ts apps/tablet/src/estado/ruta-del-dia.spec.ts
git commit -m "T-37: tablet — reglas puras de la pantalla principal (agrupar, mapa, arrastre, menu)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Tarea 9: Tablet — pantalla principal: barra, lista con arrastre, estados y menú hamburguesa (D9, D10, D16)

**Archivos:**
- Crear: `apps/tablet/src/ui/lista-ruta.tsx`
- Crear: `apps/tablet/src/ui/menu-hoja.tsx`
- Modificar (se reescribe): `apps/tablet/app/(jornada)/index.tsx`
- Crear: `apps/tablet/app/(jornada)/pendiente/[seccion].tsx`
- Modificar: `apps/tablet/app/(jornada)/_layout.tsx`
- Modificar: `apps/tablet/app/(jornada)/operacion/index.tsx` (pasa a ser "Todos los clientes")

**Interfaces:**
- Consume: Tarea 6 (`datos.rutas.delDia`, `reordenar`, `quitarRechazada`, `ErrorRuta`, `FilaRutaDelDia`); Tarea 7
  (`contarPendientesDeSubir` con rutas, `datos.sync.leerCursor()`); Tarea 8 (`agruparRuta`, `textoAvisoSinRuta`,
  `entradasMenu`, `EntradaMenu`, `indiceDestino`, `moverElemento`, `primeraLineaDomicilio`, `textoBurbuja`,
  `SECCIONES_PENDIENTES`, `esSeccionPendiente`); T-38 (`estadoMenuJornada`).
- Produce:
  - `ListaRuta({ filas, soloLectura, onTocar, onReordenar, onQuitar, onArrastrando })`, `FilaFueraDeRuta({ fila,
    onTocar })`, `ALTO_FILA`, `ARRASTRE_HABILITADO`.
  - `MenuHoja({ visible, entradas, onElegir, onCerrar, pie? })`.
  - La ruta `/(jornada)/pendiente/[seccion]`.
  - El botón "Agregar a mi ruta" navega a `/(jornada)/agregar-a-ruta`, que crea la Tarea 10 (hasta entonces esa
    navegación cae en la pantalla de "no encontrado" de expo-router; el commit compila y el resto funciona).

**Decisiones de esta tarea:**
1. **Arrastre con `PanResponder` por fila** (D10), sin librería: mantener presionado 350 ms "despega" la fila;
   mientras se arrastra, la pantalla apaga el scroll (`scrollEnabled={!arrastrando}`) y la fila no cede el gesto
   (`onPanResponderTerminationRequest`). Al soltar, `indiceDestino` (con el paso de una fila: `ALTO_FILA` + el hueco
   entre filas) decide el lugar y se guarda sin confirmar (`rutas.reordenar`). Un toque corto abre la ficha.
2. **El respaldo de D10 va siempre**: botones ▲/▼ por fila. Además de respaldo, son la vía accesible (un lector de
   pantalla no arrastra). Si el arrastre resulta frágil en el emulador, se apaga con `ARRASTRE_HABILITADO = false`
   y los botones siguen.
3. **Filas de alto fijo** (`ALTO_FILA`): la cuenta del destino depende de ello; por eso cada texto va en una sola
   línea (`numberOfLines={1}`).
4. **La pantalla no usa `<Pantalla>`**: ese componente es un `ScrollView` sin `scrollEnabled`, y el arrastre
   necesita apagarlo. Se repiten sus estilos (`estilos.pantalla`, `estilos.contenido`).
5. **"Cerrar sesión" pasa al pie del menú hamburguesa**, con la misma confirmación de antes: el spec no lo lista
   entre las entradas, pero no puede desaparecer.
6. **"Prospecto" y "Agregar a mi ruta" se deshabilitan con el día cerrado**; "Refrescar" nunca (lo capturado tiene
   que poder subir), igual que T-38.

- [ ] **Paso 1: `src/ui/lista-ruta.tsx`**

```tsx
import { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';

import type { FilaRutaDelDia } from '@/datos/repositorios/rutas';
import {
  indiceDestino,
  moverElemento,
  primeraLineaDomicilio,
  textoBurbuja,
} from '@/estado/ruta-del-dia';

import { useTema } from './tema';
import { colores, espacio, fuente, grosor, radio, tipo } from './tokens';

/**
 * Alto FIJO de cada fila (D10): el arrastre calcula a que renglon cae
 * dividiendo el desplazamiento entre el paso de una fila. Una fila mas alta
 * romperia la cuenta; por eso cada texto va en una sola linea.
 */
export const ALTO_FILA = 96;

/** Hueco entre filas. El paso del arrastre es `ALTO_FILA + HUECO`. */
const HUECO = espacio.sm;

/**
 * Interruptor del arrastre (D10). Si en el emulador o en la tablet resulta
 * fragil, se pone en `false`: quedan los botones subir/bajar, que estan siempre
 * (son el respaldo y la via accesible; un lector de pantalla no arrastra).
 */
export const ARRASTRE_HABILITADO = true;

/** Cuanto hay que mantener presionado para que la fila se "despegue". */
const ESPERA_ARRASTRE_MS = 350;

/** Movimiento maximo, en puntos, que todavia cuenta como toque. */
const TOLERANCIA_TOQUE = 8;

/**
 * La ruta del dia, reordenable (T-37, D10, D16). Muestra lo que le pasan, en
 * ese orden: quien decide que filas van aqui es `agruparRuta`.
 */
export function ListaRuta({
  filas,
  soloLectura,
  onTocar,
  onReordenar,
  onQuitar,
  onArrastrando,
}: {
  filas: readonly FilaRutaDelDia[];
  /** Dia cerrado: sin arrastre ni subir/bajar. */
  soloLectura: boolean;
  onTocar: (clienteId: string) => void;
  /** Recibe los `cliente_id` en el orden nuevo. Se guarda sin confirmar. */
  onReordenar: (clienteIds: string[]) => void;
  onQuitar: (id: string) => void;
  /** Mientras se arrastra, la pantalla apaga el scroll: si no, el scroll se lleva el gesto. */
  onArrastrando: (arrastrando: boolean) => void;
}) {
  const [arrastre, setArrastre] = useState<{ desde: number; dy: number } | null>(null);
  // La fila que se arrastra, tambien fuera del estado: `terminar` la necesita
  // en el mismo evento en que se suelta, sin esperar un render.
  const desdeRef = useRef<number | null>(null);
  const ids = useMemo(() => filas.map((f) => f.cliente_id), [filas]);

  const iniciar = useCallback(
    (desde: number) => {
      desdeRef.current = desde;
      setArrastre({ desde, dy: 0 });
      onArrastrando(true);
    },
    [onArrastrando],
  );

  const mover = useCallback((dy: number) => {
    setArrastre((a) => (a ? { ...a, dy } : a));
  }, []);

  /** `dy = null`: el sistema corto el gesto; se cancela sin mover nada. */
  const terminar = useCallback(
    (dy: number | null) => {
      const desde = desdeRef.current;
      desdeRef.current = null;
      setArrastre(null);
      onArrastrando(false);
      if (desde === null || dy === null) return;
      const hasta = indiceDestino(desde, dy, ALTO_FILA + HUECO, ids.length);
      if (hasta !== desde) onReordenar(moverElemento(ids, desde, hasta));
    },
    [ids, onArrastrando, onReordenar],
  );

  const destino =
    arrastre === null
      ? null
      : indiceDestino(arrastre.desde, arrastre.dy, ALTO_FILA + HUECO, ids.length);

  return (
    <View style={{ gap: HUECO }}>
      {filas.map((fila, indice) => {
        const esta = arrastre?.desde === indice;
        return (
          <FilaRuta
            key={fila.id}
            fila={fila}
            indice={indice}
            total={filas.length}
            soloLectura={soloLectura}
            desplazamiento={esta ? (arrastre?.dy ?? 0) : null}
            destino={esta ? destino : null}
            onTocar={onTocar}
            onIniciar={iniciar}
            onMover={mover}
            onSoltar={terminar}
            onSubir={() => onReordenar(moverElemento(ids, indice, indice - 1))}
            onBajar={() => onReordenar(moverElemento(ids, indice, indice + 1))}
            onQuitar={onQuitar}
          />
        );
      })}
    </View>
  );
}

function FilaRuta({
  fila,
  indice,
  total,
  soloLectura,
  desplazamiento,
  destino,
  onTocar,
  onIniciar,
  onMover,
  onSoltar,
  onSubir,
  onBajar,
  onQuitar,
}: {
  fila: FilaRutaDelDia;
  indice: number;
  total: number;
  soloLectura: boolean;
  /** `null` si esta fila no es la que se arrastra. */
  desplazamiento: number | null;
  destino: number | null;
  onTocar: (clienteId: string) => void;
  onIniciar: (indice: number) => void;
  onMover: (dy: number) => void;
  onSoltar: (dy: number | null) => void;
  onSubir: () => void;
  onBajar: () => void;
  onQuitar: (id: string) => void;
}) {
  const { t } = useTema();
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arrastrando = useRef(false);

  const responder = useMemo(() => {
    const cancelarEspera = () => {
      if (temporizador.current !== null) {
        clearTimeout(temporizador.current);
        temporizador.current = null;
      }
    };
    return PanResponder.create({
      // La fila toma el toque; los botones de dentro (subir, bajar, quitar) lo
      // reclaman antes porque son mas profundos.
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        arrastrando.current = false;
        if (soloLectura || !ARRASTRE_HABILITADO) return;
        temporizador.current = setTimeout(() => {
          temporizador.current = null;
          arrastrando.current = true;
          onIniciar(indice);
        }, ESPERA_ARRASTRE_MS);
      },
      onPanResponderMove: (_evento, gesto) => {
        if (arrastrando.current) {
          onMover(gesto.dy);
          return;
        }
        // Se movio antes de despegarse: es un scroll, no un arrastre.
        if (Math.abs(gesto.dx) > TOLERANCIA_TOQUE || Math.abs(gesto.dy) > TOLERANCIA_TOQUE) {
          cancelarEspera();
        }
      },
      // Mientras arrastra, nadie (ni el scroll) le quita el gesto.
      onPanResponderTerminationRequest: () => !arrastrando.current,
      onPanResponderRelease: (_evento, gesto) => {
        cancelarEspera();
        if (arrastrando.current) {
          arrastrando.current = false;
          onSoltar(gesto.dy);
          return;
        }
        if (Math.abs(gesto.dx) <= TOLERANCIA_TOQUE && Math.abs(gesto.dy) <= TOLERANCIA_TOQUE) {
          onTocar(fila.cliente_id);
        }
      },
      onPanResponderTerminate: () => {
        cancelarEspera();
        if (arrastrando.current) {
          arrastrando.current = false;
          onSoltar(null);
        }
      },
    });
  }, [fila.cliente_id, indice, soloLectura, onTocar, onIniciar, onMover, onSoltar]);

  const conError = fila.sync_estado === 'error';
  const arrastrada = desplazamiento !== null;

  return (
    <View
      {...responder.panHandlers}
      style={[
        {
          height: ALTO_FILA,
          flexDirection: 'row',
          alignItems: 'center',
          gap: espacio.md,
          paddingHorizontal: espacio.md,
          borderRadius: radio.medio,
          borderWidth: grosor.hairline,
          borderColor: colores.borde,
          backgroundColor: colores.superficie,
        },
        // Visitado: atenuado y con palomita, sin salir de la lista (D2, D5).
        fila.visitado && { opacity: 0.55 },
        arrastrada && {
          transform: [{ translateY: desplazamiento ?? 0 }],
          zIndex: 10,
          elevation: 6,
          opacity: 1,
          borderWidth: grosor.fuerte,
          borderColor: colores.primario,
        },
      ]}
    >
      <Text
        style={{
          width: 36,
          textAlign: 'right',
          fontFamily: fuente.cifraFuerte,
          fontSize: t(tipo.destacado),
          color: colores.tintaSuave,
        }}
      >
        {indice + 1}
      </Text>

      <View style={{ flex: 1, gap: espacio.xs }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.destacado), color: colores.tinta }}
        >
          {fila.visitado ? '✓ ' : ''}
          {fila.nombre}
        </Text>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fuente.cuerpo, fontSize: t(tipo.cuerpo), color: colores.tintaSuave }}
        >
          {primeraLineaDomicilio(fila.domicilio)}
        </Text>
        {conError ? (
          // Mismo tratamiento que una venta rechazada: texto rojo bajo la fila.
          <Text
            numberOfLines={1}
            style={{ fontFamily: fuente.cuerpoMedio, fontSize: t(tipo.menor), color: colores.peligro }}
          >
            Rechazado: {fila.sync_error}
          </Text>
        ) : destino !== null ? (
          <Text
            numberOfLines={1}
            style={{ fontFamily: fuente.cuerpoMedio, fontSize: t(tipo.menor), color: colores.primario }}
          >
            Suelta para dejarlo en el lugar {destino + 1}
          </Text>
        ) : fila.sync_estado === 'pendiente' ? (
          <Text
            numberOfLines={1}
            style={{ fontFamily: fuente.cuerpoMedio, fontSize: t(tipo.menor), color: colores.aviso }}
          >
            Por subir
          </Text>
        ) : null}
      </View>

      {fila.notas_pendientes > 0 ? <Burbuja notas={fila.notas_pendientes} /> : null}

      {conError ? (
        <BotonChico
          etiqueta="Quitar"
          etiquetaAccesible={`Quitar ${fila.nombre} de la ruta`}
          onPress={() => onQuitar(fila.id)}
        />
      ) : null}

      {soloLectura ? null : (
        <View style={{ gap: espacio.xs }}>
          <BotonChico
            etiqueta="▲"
            etiquetaAccesible={`Subir ${fila.nombre}`}
            deshabilitado={indice === 0}
            onPress={onSubir}
          />
          <BotonChico
            etiqueta="▼"
            etiquetaAccesible={`Bajar ${fila.nombre}`}
            deshabilitado={indice === total - 1}
            onPress={onBajar}
          />
        </View>
      )}
    </View>
  );
}

/** Un cliente que la oficina quito pero que hoy tuvo actividad: "Fuera de ruta" (D16). */
export function FilaFueraDeRuta({
  fila,
  onTocar,
}: {
  fila: FilaRutaDelDia;
  onTocar: (clienteId: string) => void;
}) {
  const { t } = useTema();
  return (
    <Pressable
      onPress={() => onTocar(fila.cliente_id)}
      accessibilityRole="button"
      accessibilityLabel={`${fila.nombre}, fuera de ruta, visitado`}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: espacio.md,
          padding: espacio.md,
          borderRadius: radio.medio,
          borderWidth: grosor.hairline,
          borderColor: colores.borde,
          backgroundColor: colores.superficieHundida,
          opacity: 0.75,
        },
        pressed && { opacity: 0.6 },
      ]}
    >
      <Text style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.destacado), color: colores.exito }}>
        ✓
      </Text>
      <View style={{ flex: 1, gap: espacio.xs }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.destacado), color: colores.tinta }}
        >
          {fila.nombre}
        </Text>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fuente.cuerpo, fontSize: t(tipo.cuerpo), color: colores.tintaSuave }}
        >
          {primeraLineaDomicilio(fila.domicilio)}
        </Text>
      </View>
      {fila.notas_pendientes > 0 ? <Burbuja notas={fila.notas_pendientes} /> : null}
    </Pressable>
  );
}

/** La burbuja: cuantas notas con saldo tiene el cliente. Solo si es mayor a cero. */
function Burbuja({ notas }: { notas: number }) {
  const { t } = useTema();
  return (
    <View
      accessible
      accessibilityLabel={textoBurbuja(notas)}
      style={{
        minWidth: 32,
        height: 32,
        paddingHorizontal: espacio.sm,
        borderRadius: radio.pastilla,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colores.primario,
      }}
    >
      <Text style={{ fontFamily: fuente.cifraFuerte, fontSize: t(tipo.cuerpo), color: colores.primarioTinta }}>
        {notas}
      </Text>
    </View>
  );
}

function BotonChico({
  etiqueta,
  etiquetaAccesible,
  onPress,
  deshabilitado = false,
}: {
  etiqueta: string;
  etiquetaAccesible: string;
  onPress: () => void;
  deshabilitado?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={deshabilitado}
      hitSlop={espacio.xs}
      accessibilityRole="button"
      accessibilityLabel={etiquetaAccesible}
      accessibilityState={{ disabled: deshabilitado }}
      style={({ pressed }) => [
        {
          minWidth: 40,
          height: 40,
          paddingHorizontal: espacio.sm,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radio.chico,
          borderWidth: grosor.fuerte,
          borderColor: colores.bordeFuerte,
          backgroundColor: colores.superficie,
        },
        pressed && !deshabilitado && { opacity: 0.7 },
        // Mismo valor que `Boton` inactivo: al sol, menos que esto no se nota.
        deshabilitado && { opacity: 0.35 },
      ]}
    >
      <Text style={{ fontFamily: fuente.cuerpoFuerte, color: colores.tinta }}>{etiqueta}</Text>
    </Pressable>
  );
}
```

- [ ] **Paso 2: `src/ui/menu-hoja.tsx`**

```tsx
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { EntradaMenu } from '@/estado/ruta-del-dia';

import { useTema } from './tema';
import { colores, espacio, fuente, grosor, radio, tipo } from './tokens';

/**
 * Menu hamburguesa como hoja modal desde arriba a la derecha (T-37, D9).
 *
 * `Modal` de React Native y no un cajon lateral: el cajon exigiria
 * `react-native-gesture-handler` y `react-native-reanimated`, que la app no
 * trae, y recompilar. Las entradas las decide `entradasMenu` (puro, con prueba).
 */
export function MenuHoja({
  visible,
  entradas,
  onElegir,
  onCerrar,
  pie,
}: {
  visible: boolean;
  entradas: readonly EntradaMenu[];
  onElegir: (entrada: EntradaMenu) => void;
  onCerrar: () => void;
  /** Lo que va al fondo de la hoja, separado (hoy: "Cerrar sesión"). */
  pie?: ReactNode;
}) {
  const { t } = useTema();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCerrar}>
      <View style={{ flex: 1 }}>
        {/* El fondo cierra el menu; la hoja va encima como hermana, no como hija. */}
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(25, 20, 16, 0.35)' }]}
          onPress={onCerrar}
          accessibilityRole="button"
          accessibilityLabel="Cerrar el menú"
        />
        <View
          style={{
            position: 'absolute',
            top: insets.top + espacio.md,
            right: espacio.md,
            width: 360,
            maxWidth: '90%',
            gap: espacio.xs,
            padding: espacio.md,
            borderRadius: radio.medio,
            borderWidth: grosor.fuerte,
            borderColor: colores.bordeFuerte,
            backgroundColor: colores.superficie,
          }}
        >
          {entradas.map((entrada) => (
            <Pressable
              key={entrada.clave}
              disabled={entrada.deshabilitada}
              onPress={() => onElegir(entrada)}
              accessibilityRole="link"
              accessibilityLabel={`${entrada.titulo}. ${entrada.descripcion}`}
              accessibilityState={{ disabled: entrada.deshabilitada }}
              style={({ pressed }) => [
                {
                  minHeight: 48,
                  justifyContent: 'center',
                  paddingVertical: espacio.sm,
                  paddingHorizontal: espacio.sm,
                  borderRadius: radio.chico,
                },
                pressed && !entrada.deshabilitada && { backgroundColor: colores.primarioTenue },
                entrada.deshabilitada && { opacity: 0.35 },
              ]}
            >
              <Text style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.destacado), color: colores.tinta }}>
                {entrada.titulo}
              </Text>
              <Text style={{ fontFamily: fuente.cuerpo, fontSize: t(tipo.menor), color: colores.tintaSuave }}>
                {entrada.descripcion}
              </Text>
            </Pressable>
          ))}
          {pie ? <View style={{ marginTop: espacio.md }}>{pie}</View> : null}
        </View>
      </View>
    </Modal>
  );
}
```

- [ ] **Paso 3: Pantallas pendientes del menú**

Crear `apps/tablet/app/(jornada)/pendiente/[seccion].tsx`:

```tsx
import { useLocalSearchParams } from 'expo-router';

import { esSeccionPendiente, SECCIONES_PENDIENTES } from '@/estado/ruta-del-dia';
import { PantallaPendiente } from '@/ui/pantalla-pendiente';

/**
 * Las entradas del menu hamburguesa que todavia no existen (T-37, D16): una
 * sola pantalla parametrica en vez de un archivo por seccion. El texto y el
 * ticket salen de `SECCIONES_PENDIENTES`.
 */
export default function SeccionPendiente() {
  const { seccion } = useLocalSearchParams<{ seccion: string }>();

  if (!esSeccionPendiente(seccion)) {
    return (
      <PantallaPendiente
        titulo="Sección no encontrada"
        ticket="—"
        descripcion="Esta sección del menú no existe."
      />
    );
  }

  const datos = SECCIONES_PENDIENTES[seccion];
  return (
    <PantallaPendiente titulo={datos.titulo} ticket={datos.ticket} descripcion={datos.descripcion} />
  );
}
```

- [ ] **Paso 4: La pantalla principal**

`apps/tablet/app/(jornada)/index.tsx` se reescribe entero:

```tsx
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { ErrorRuta } from '@/datos';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { agruparRuta, entradasMenu, textoAvisoSinRuta } from '@/estado/ruta-del-dia';
import type { MotivoAbandono } from '@/sincronizacion/motor';
import { contarPendientesDeSubir } from '@/sincronizacion/pendientes';
import { Boton } from '@/ui/boton';
import { FilaFueraDeRuta, ListaRuta } from '@/ui/lista-ruta';
import { MenuHoja } from '@/ui/menu-hoja';
import { formatearMomento } from '@/ui/momento';
import { Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio, fuente, grosor, radio, tipo } from '@/ui/tokens';

/**
 * Lo que se le dice al vendedor cuando la sincronizacion no sale.
 *
 * En su idioma y con la accion que le toca a el, no el motivo tecnico: en ruta
 * no puede hacer nada con un "409 contrato incompatible".
 */
const MENSAJE: Record<MotivoAbandono, string> = {
  'sin-sesion': 'Tu sesión ya no vale. Vuelve a entrar con el WiFi del negocio.',
  'sin-red': 'No hay conexión con el negocio. Lo capturado sigue guardado aquí.',
  contrato: 'Esta tablet y el servidor no coinciden de versión. Avisa a la oficina.',
  alcance: 'El servidor rechazó la petición. Avisa a la oficina.',
  'lote-grande':
    'Un envío salió demasiado grande. Avisa a la oficina; lo capturado sigue guardado aquí.',
};

/**
 * La jornada abre en la ruta del dia (T-37, D16): la que asigno la oficina mas
 * lo que agrego el vendedor, en el orden en que el la recorre.
 *
 * Todo lo que esta pantalla decide vive en funciones puras con prueba
 * (`src/estado/ruta-del-dia.ts`, `menu-jornada.ts`); aqui solo se pinta.
 */
export default function RutaDelDia() {
  const { jornada, datos, versionCatalogos } = useJawa();
  const { salir, sincronizar, ultimaSincronizacion } = useSesion();
  const { estilos, t } = useTema();
  const [sincronizando, setSincronizando] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);

  // Se relee al volver a esta pantalla (`useFocusEffect`): vender o cobrar en
  // la ficha no mueve `datos`, y esta pantalla sigue montada debajo.
  const [vueltas, setVueltas] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setVueltas((n) => n + 1);
    }, []),
  );

  // `versionCatalogos` sube cuando el pull escribe y cuando la ruta cambia
  // (agregar, reordenar, quitar publican el cambio).
  const filas = useMemo(() => {
    void vueltas;
    void versionCatalogos;
    void ultimaSincronizacion;
    return datos.rutas.delDia();
  }, [datos, vueltas, versionCatalogos, ultimaSincronizacion]);
  const { enRuta, fueraDeRuta } = agruparRuta(filas);

  // Suma las cinco fuentes del push, altas de ruta incluidas (T-37).
  const pendientes = useMemo(() => {
    void vueltas;
    void versionCatalogos;
    void ultimaSincronizacion;
    return contarPendientesDeSubir(datos);
  }, [datos, vueltas, versionCatalogos, ultimaSincronizacion]);

  // T-38 (D6 capa 2): con el dia cerrado, la lista queda en solo lectura.
  const menu = estadoMenuJornada(jornada);
  const soloLectura = !menu.operacionesHabilitadas;
  const sinRuta = enRuta.length === 0 && fueraDeRuta.length === 0;

  /**
   * "Refrescar" es el "Sincronizar ahora" de siempre (D6): pull, push, fotos y
   * pull posterior. No hay un segundo camino de red. Sin red, la lista no cambia.
   */
  async function refrescar() {
    setSincronizando(true);
    try {
      const r = await sincronizar();
      Alert.alert(
        r.ok ? 'Sincronización completa' : 'No se pudo terminar',
        r.ok
          ? `Se bajaron ${r.pull?.filas ?? 0} registro(s) y se subieron ${r.push?.aplicadas ?? 0}.` +
              (r.push?.rechazadas ? ` ${r.push.rechazadas} quedaron con error.` : '')
          : MENSAJE[r.motivo ?? 'sin-red'],
      );
    } finally {
      setSincronizando(false);
    }
  }

  const abrirCliente = useCallback((clienteId: string) => {
    router.push({ pathname: '/(jornada)/operacion/[clienteId]', params: { clienteId } });
  }, []);

  const reordenar = useCallback(
    (clienteIds: string[]) => {
      if (jornada) datos.rutas.reordenar(jornada.fecha, clienteIds);
    },
    [datos, jornada],
  );

  const quitar = useCallback(
    (id: string) => {
      try {
        datos.rutas.quitarRechazada(id);
      } catch (e) {
        Alert.alert('No se pudo quitar', e instanceof ErrorRuta ? e.message : 'Intenta de nuevo.');
      }
    },
    [datos],
  );

  /**
   * Cerrar sesion borra el material que permite entrar sin red (ver
   * `gestor.salir()`). En ruta eso deja al vendedor fuera hasta volver al WiFi
   * del negocio, asi que se confirma antes. Vive al pie del menu (T-37).
   */
  function confirmarSalida() {
    Alert.alert(
      'Cerrar sesión',
      'Se borrará tu sesión de esta tablet. Para volver a entrar necesitarás conectarte al WiFi del negocio. Lo capturado hoy NO se borra.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cerrar sesión', style: 'destructive', onPress: () => void salir() },
      ],
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colores.papel }}>
      <ScrollView
        style={estilos.pantalla}
        contentContainerStyle={estilos.contenido}
        scrollEnabled={!arrastrando}
        keyboardShouldPersistTaps="handled"
      >
        {/* Barra: tres acciones con icono y texto corto a la izquierda; menu a la derecha. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: espacio.sm,
            marginBottom: espacio.md,
          }}
        >
          <Boton
            etiqueta="Prospecto"
            glifo="+"
            tono="neutra"
            ancho="ajustado"
            deshabilitado={soloLectura}
            onPress={() => router.push('/(jornada)/prospectos')}
          />
          <Boton
            etiqueta={sincronizando ? 'Refrescando…' : 'Refrescar'}
            glifo="↻"
            tono="neutra"
            ancho="ajustado"
            ocupado={sincronizando}
            onPress={() => void refrescar()}
          />
          <Pastilla
            numero={pendientes}
            texto="por subir"
            estado={pendientes > 0 ? 'pendiente' : 'listo'}
          />
          <Boton
            etiqueta="Agregar a mi ruta"
            glifo="+"
            ancho="ajustado"
            deshabilitado={soloLectura}
            onPress={() => router.push('/(jornada)/agregar-a-ruta')}
          />
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => setMenuAbierto(true)}
            accessibilityRole="button"
            accessibilityLabel="Abrir el menú"
            hitSlop={espacio.xs}
            style={({ pressed }) => [
              {
                minWidth: 48,
                height: 48,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radio.chico,
                borderWidth: grosor.fuerte,
                borderColor: colores.bordeFuerte,
                backgroundColor: colores.superficie,
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.subtitulo), color: colores.tinta }}>
              ☰
            </Text>
          </Pressable>
        </View>

        <Text style={estilos.subtitulo}>
          Jornada del {jornada?.fecha} · Catálogos bajados:{' '}
          {formatearMomento(datos.catalogos.frescuraCatalogos())}
        </Text>

        {ultimaSincronizacion && !ultimaSincronizacion.ok ? (
          <Text style={estilos.error}>{MENSAJE[ultimaSincronizacion.motivo ?? 'sin-red']}</Text>
        ) : null}

        {menu.avisoDiaCerrado ? (
          <Tarjeta estado="listo" etiqueta="Día cerrado">
            <Text style={estilos.textoTarjeta}>{menu.avisoDiaCerrado}</Text>
          </Tarjeta>
        ) : null}

        {sinRuta ? (
          // D3: sin ruta asignada la tablet funciona igual.
          <Tarjeta estado="pendiente" etiqueta="Sin ruta">
            <Text style={estilos.textoTarjeta}>{textoAvisoSinRuta(datos.sync.leerCursor())}</Text>
            <View style={estilos.filaAcciones}>
              <Boton
                etiqueta={sincronizando ? 'Sincronizando…' : 'Sincronizar'}
                glifo="↻"
                tono="neutra"
                ancho="ajustado"
                ocupado={sincronizando}
                onPress={() => void refrescar()}
              />
              <Boton
                etiqueta="Agregar a mi ruta"
                glifo="+"
                ancho="ajustado"
                deshabilitado={soloLectura}
                onPress={() => router.push('/(jornada)/agregar-a-ruta')}
              />
            </View>
          </Tarjeta>
        ) : (
          <ListaRuta
            filas={enRuta}
            soloLectura={soloLectura}
            onTocar={abrirCliente}
            onReordenar={reordenar}
            onQuitar={quitar}
            onArrastrando={setArrastrando}
          />
        )}

        {fueraDeRuta.length > 0 ? (
          <View style={{ gap: espacio.sm, marginTop: espacio.lg }}>
            <Text style={estilos.seccion}>Fuera de ruta</Text>
            {fueraDeRuta.map((fila) => (
              <FilaFueraDeRuta key={fila.id} fila={fila} onTocar={abrirCliente} />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <MenuHoja
        visible={menuAbierto}
        entradas={entradasMenu(soloLectura)}
        onElegir={(entrada) => {
          setMenuAbierto(false);
          router.push(entrada.destino as Href);
        }}
        onCerrar={() => setMenuAbierto(false)}
        pie={
          <Boton
            etiqueta="Cerrar sesión"
            tono="peligro"
            glifo="×"
            onPress={() => {
              setMenuAbierto(false);
              confirmarSalida();
            }}
          />
        }
      />
    </View>
  );
}
```

- [ ] **Paso 5: Layout y "Todos los clientes"**

a) En `apps/tablet/app/(jornada)/_layout.tsx`, dentro del `<Stack>`:
- `<Stack.Screen name="index" options={{ title: 'Jornada' }} />` pasa a `options={{ title: 'Ruta del día' }}`.
- `<Stack.Screen name="operacion/index" options={{ title: 'Operación por cliente' }} />` pasa a
  `options={{ title: 'Todos los clientes' }}`.
- Después de `<Stack.Screen name="ruta" … />` agregar:

```tsx
      <Stack.Screen name="pendiente/[seccion]" options={{ title: 'Próximamente' }} />
```

b) En `apps/tablet/app/(jornada)/operacion/index.tsx`: el comentario de la función queda

```tsx
/**
 * Todos los clientes de la sucursal (T-37: sale del menu hamburguesa; el camino
 * principal es la ruta del dia). Se leen de SQLite, sin red.
 */
```

(se borra el `TODO: T-37`), y `titulo="Clientes de hoy"` pasa a `titulo="Todos los clientes"`.

- [ ] **Paso 6: Verificación**

Run:
```bash
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm test --workspace=apps/tablet
npm run export --workspace=apps/tablet
git status --short apps/tablet
```
Expected: sin errores; el bundle de Metro sale; si `expo export` ensució `apps/tablet/package.json` o
`tsconfig.json`, revierte con `git checkout -- <archivo>` (no es parte de la tarea) y borra la carpeta `dist/` que
genera si quedó sin ignorar.

Si tienes el emulador a mano (opcional en esta tarea; la aceptación manual completa es de la Tarea 12): mantén
presionada una fila, arrástrala dos lugares y suelta. Si el gesto no se despega o el scroll se lo lleva, pon
`ARRASTRE_HABILITADO = false` en `lista-ruta.tsx`, comprueba que ▲/▼ funcionan y repórtalo como
`DONE_WITH_CONCERNS`.

- [ ] **Paso 7: Commit**

```bash
git add apps/tablet/src/ui/lista-ruta.tsx apps/tablet/src/ui/menu-hoja.tsx "apps/tablet/app/(jornada)/index.tsx" \
  "apps/tablet/app/(jornada)/pendiente/[seccion].tsx" "apps/tablet/app/(jornada)/_layout.tsx" \
  "apps/tablet/app/(jornada)/operacion/index.tsx"
git commit -m "T-37: tablet — la jornada abre en la ruta del dia, con arrastre y menu hamburguesa

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 10: Tablet — "Agregar a mi ruta", ficha del cliente ampliada y purga al abrir el día (D8, D16)

**Archivos:**
- Modificar: `apps/tablet/src/datos/repositorios/prospectos.ts`, `prospectos.spec.ts`
- Crear: `apps/tablet/app/(jornada)/agregar-a-ruta.tsx`
- Modificar (se reescribe): `apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx`
- Modificar: `apps/tablet/app/(jornada)/_layout.tsx`
- Modificar: `apps/tablet/app/abrir-dia.tsx`

**Interfaces:**
- Consume: Tarea 6 (`rutas.agregar`, `rutas.delDia`, `rutas.purgar`, `ErrorRuta`); Tarea 8 (`filtrarParaAgregar`,
  `textoAgregado`, `urlMapa`, `urlTelefono`); `catalogos.listarClientes`, `notasPendientesDe`;
  `cobranzas.delDia`; `ventas.delDia`; `estadoMenuJornada`.
- Produce: `RepositorioProspectos.fotoLocalDe(cliente: Pick<Cliente, 'nombre' | 'telefono'>): string | null`.

**Decisiones de esta tarea:**
1. **"Ver foto" (D8) sin llave entre prospecto y cliente.** El servidor le da al cliente **otro** id que el
   prospecto local (`tipos.ts`, `Prospecto`), así que la tablet no sabe qué prospecto suyo es este cliente.
   `fotoLocalDe` busca el prospecto **de esta tablet** con el mismo nombre (sin mayúsculas ni espacios de más) y el
   mismo teléfono, que tenga `foto_uri`; si hay varios, el más reciente. Si no coincide, el botón no aparece (D8:
   "solo si existe"). Ver *Conflictos*, punto 5.
2. **El aviso "{nombre} agregado al final"** es un `ToastAndroid` (la app es Android); en otra plataforma, un
   `Alert`. La pantalla vuelve a la lista con `router.back()` y la lista se rehace sola (`publicarCambio`).
3. **La ficha conserva el candado del día cerrado** de T-38 (las capturas lanzan `ErrorJornada`) y además
   deshabilita Vender/Cobrar/Visita con `estadoMenuJornada`, como el menú.
4. **La purga corre después de abrir la jornada** (`abrir-dia`), una vez por día: es cuando la tablet está quieta.

- [ ] **Paso 1: Prueba de `fotoLocalDe` (falla)**

En `apps/tablet/src/datos/repositorios/prospectos.spec.ts`, al final del `describe('repositorio de prospectos', …)`
(antes de su `});` de cierre):

```ts
  describe('fotoLocalDe (T-37, D8)', () => {
    it('encuentra la foto del prospecto de esta tablet por nombre y telefono', () => {
      const { prospectos } = montar();
      prospectos.registrar(captura({ fotoUri: 'file:///cache/foto-1.jpg' }));

      expect(
        prospectos.fotoLocalDe({ nombre: '  tacos AARON ', telefono: '6641112233' }),
      ).toBe('file:///cache/foto-1.jpg');
    });

    it('sin foto, con otro telefono o con otro nombre no hay foto', () => {
      const { prospectos } = montar();
      prospectos.registrar(captura());
      prospectos.registrar(captura({ nombre: 'Otro', fotoUri: 'file:///cache/otro.jpg' }));

      expect(prospectos.fotoLocalDe({ nombre: 'Tacos Aaron', telefono: '6641112233' })).toBeNull();
      expect(prospectos.fotoLocalDe({ nombre: 'Otro', telefono: '0000000000' })).toBeNull();
    });
  });
```

Run: `npm test --workspace=apps/tablet -- prospectos`
Expected: FAIL, `prospectos.fotoLocalDe is not a function`.

- [ ] **Paso 2: `fotoLocalDe` en `prospectos.ts`**

En `apps/tablet/src/datos/repositorios/prospectos.ts`, agregar el import de tipo `Cliente` al `import type { … }
from '../tipos'` existente, y después del método `delDia` del repositorio:

```ts
    /**
     * La foto que ESTA tablet tomo del lugar, para "Ver foto" en la ficha del
     * cliente (T-37, D8). El servidor le da al cliente otro id que el del
     * prospecto local, asi que se reconoce por nombre (sin mayusculas ni
     * espacios de mas) y telefono. `null` si no hay: el boton no aparece.
     */
    fotoLocalDe(cliente: Pick<Cliente, 'nombre' | 'telefono'>): string | null {
      const fila = bd.getFirstSync<{ foto_uri: string }>(
        `select foto_uri from prospecto
          where foto_uri is not null
            and lower(trim(nombre)) = lower(trim($nombre))
            and trim(telefono) = trim($telefono)
          order by grabado_en desc, rowid desc
          limit 1`,
        { $nombre: cliente.nombre, $telefono: cliente.telefono },
      );
      return fila?.foto_uri ?? null;
    },
```

Run: `npm test --workspace=apps/tablet -- prospectos`
Expected: PASS.

- [ ] **Paso 3: "Agregar a mi ruta"**

Crear `apps/tablet/app/(jornada)/agregar-a-ruta.tsx`:

```tsx
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, Text, ToastAndroid, View } from 'react-native';

import { ErrorJornada, ErrorRuta } from '@/datos';
import type { Cliente } from '@/datos/tipos';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import { useJawa } from '@/estado/proveedor-jawa';
import { filtrarParaAgregar, primeraLineaDomicilio, textoAgregado } from '@/estado/ruta-del-dia';
import { Campo } from '@/ui/campo';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio, fuente, grosor, radio, tipo } from '@/ui/tokens';

/** El aviso breve al volver a la lista (D16). La app es Android; en otra plataforma, un Alert. */
function avisar(texto: string) {
  if (Platform.OS === 'android') ToastAndroid.show(texto, ToastAndroid.SHORT);
  else Alert.alert(texto);
}

/**
 * "Agregar a mi ruta" (T-37, D2, D7): clientes EXISTENTES de la sucursal que no
 * estan en la ruta de hoy. El vendedor no da de alta clientes; para eso esta
 * Prospecto. Tocar uno lo agrega al final y vuelve a la lista.
 */
export default function AgregarARuta() {
  const { datos, vendedor, sucursalId, jornada, versionCatalogos } = useJawa();
  const { estilos, t } = useTema();
  const [busqueda, setBusqueda] = useState('');
  const [error, setError] = useState<string | null>(null);
  const menu = estadoMenuJornada(jornada);

  const candidatos = useMemo<Cliente[]>(() => {
    void versionCatalogos;
    if (!sucursalId) return [];
    const enRuta = new Set(
      datos.rutas
        .delDia()
        .filter((f) => f.activo === 1)
        .map((f) => f.cliente_id),
    );
    return filtrarParaAgregar(datos.catalogos.listarClientes(sucursalId), enRuta, busqueda);
  }, [datos, sucursalId, busqueda, versionCatalogos]);

  function agregar(cliente: Cliente) {
    setError(null);
    if (!vendedor || !sucursalId) {
      setError('No hay vendedor con sesión iniciada.');
      return;
    }
    try {
      datos.rutas.agregar(cliente.id, { vendedorId: vendedor.id, sucursalId });
      avisar(textoAgregado(cliente.nombre));
      router.back();
    } catch (e) {
      setError(
        e instanceof ErrorRuta || e instanceof ErrorJornada
          ? e.message
          : 'No se pudo agregar el cliente a la ruta.',
      );
    }
  }

  return (
    <Pantalla
      titulo="Agregar a mi ruta"
      subtitulo="Clientes de tu sucursal que no están en la ruta de hoy. Se agregan al final."
    >
      {menu.avisoDiaCerrado ? (
        <Tarjeta estado="listo" etiqueta="Día cerrado">
          <Text style={estilos.textoTarjeta}>{menu.avisoDiaCerrado}</Text>
        </Tarjeta>
      ) : null}

      <Campo
        etiqueta="Buscar por nombre"
        value={busqueda}
        onChangeText={setBusqueda}
        placeholder="Escribe parte del nombre"
        autoCorrect={false}
      />

      {error ? <Text style={estilos.error}>{error}</Text> : null}

      {candidatos.length === 0 ? (
        <Text style={estilos.textoSuave}>
          {busqueda.trim() === ''
            ? 'Todos los clientes de la sucursal ya están en tu ruta de hoy.'
            : 'Ningún cliente coincide con esa búsqueda.'}
        </Text>
      ) : (
        <View style={{ gap: espacio.sm }}>
          {candidatos.map((cliente) => (
            <Pressable
              key={cliente.id}
              disabled={!menu.operacionesHabilitadas}
              onPress={() => agregar(cliente)}
              accessibilityRole="button"
              accessibilityLabel={`Agregar ${cliente.nombre} a mi ruta`}
              accessibilityState={{ disabled: !menu.operacionesHabilitadas }}
              style={({ pressed }) => [
                {
                  padding: espacio.md,
                  gap: espacio.xs,
                  borderRadius: radio.medio,
                  borderWidth: grosor.fuerte,
                  borderColor: colores.bordeFuerte,
                  backgroundColor: colores.superficie,
                },
                pressed && { backgroundColor: colores.primarioTenue },
                !menu.operacionesHabilitadas && { opacity: 0.35 },
              ]}
            >
              <Text style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.destacado), color: colores.tinta }}>
                {cliente.nombre}
              </Text>
              <Text style={estilos.textoSuave}>{primeraLineaDomicilio(cliente.domicilio)}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Pantalla>
  );
}
```

En `apps/tablet/app/(jornada)/_layout.tsx`, después de `<Stack.Screen name="prospectos" … />`:

```tsx
      <Stack.Screen name="agregar-a-ruta" options={{ title: 'Agregar a mi ruta' }} />
```

- [ ] **Paso 4: La ficha del cliente**

`apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx` se reescribe entero:

```tsx
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Image, Linking, Modal, Pressable, Text, View } from 'react-native';

import type { SyncEstado } from '@/datos/tipos';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { urlMapa, urlTelefono } from '@/estado/ruta-del-dia';
import { Boton } from '@/ui/boton';
import { BotonMenu } from '@/ui/boton-menu';
import { Cifra, pesos } from '@/ui/cifra';
import { Pantalla, Pastilla, Tarjeta, type Estado } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio, fuente, grosor, radio, tipo } from '@/ui/tokens';

/** Como se le dice al vendedor en que va cada venta. */
const ETIQUETA_SYNC: Record<SyncEstado, string> = {
  pendiente: 'Por subir',
  enviando: 'Subiendo',
  sincronizado: 'Sincronizada',
  error: 'Con error',
};

const ESTADO_SYNC: Record<SyncEstado, Estado> = {
  pendiente: 'pendiente',
  enviando: 'pendiente',
  sincronizado: 'listo',
  error: 'error',
};

/** Abre el marcador o Maps; si el equipo no puede, lo dice en vez de fallar callado. */
function abrir(url: string | null, queAbre: string) {
  if (!url) return;
  Linking.openURL(url).catch(() =>
    Alert.alert(`No se pudo abrir ${queAbre}`, 'Esta tablet no tiene una aplicación para eso.'),
  );
}

/**
 * Ficha del cliente (T-37, D16): sus datos tocables, las tres acciones del dia
 * y lo que debe y lo que ya paso hoy. "Merma, promocion, consumo y gasto" ya no
 * esta aqui: vive en el menu hamburguesa.
 */
export default function FichaCliente() {
  const { clienteId } = useLocalSearchParams<{ clienteId: string }>();
  const { datos, jornada, versionCatalogos } = useJawa();
  const { ultimaSincronizacion } = useSesion();
  const { estilos, t } = useTema();
  const [verFoto, setVerFoto] = useState(false);
  const menu = estadoMenuJornada(jornada);

  // Se relee al volver de vender o cobrar (`useFocusEffect`): grabar no mueve
  // `datos` y `router.back()` no vuelve a montar la pantalla.
  const [vueltas, setVueltas] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setVueltas((n) => n + 1);
    }, []),
  );

  const hoy = useMemo(() => {
    void vueltas;
    void ultimaSincronizacion;
    void versionCatalogos;
    return {
      ventas: datos.ventas.delDia(clienteId),
      cobros: datos.cobranzas.delDia(clienteId),
      notas: datos.catalogos.notasPendientesDe(clienteId).filter((n) => n.saldo_centavos > 0),
    };
  }, [datos, clienteId, vueltas, ultimaSincronizacion, versionCatalogos]);

  const cliente = datos.catalogos.obtenerCliente(clienteId);

  if (!cliente) {
    return (
      <Pantalla titulo="Cliente no encontrado" subtitulo="No está en el catálogo local de esta tablet.">
        <Text style={estilos.textoSuave}>
          Puede que lo hayan dado de alta después de tu última sincronización.
        </Text>
      </Pantalla>
    );
  }

  const telefono = urlTelefono(cliente.telefono);
  const mapa = urlMapa(cliente);
  // D8: solo la foto que tomo ESTA tablet; la del servidor llega en la pieza 3.
  const foto = datos.prospectos.fotoLocalDe(cliente);
  const params = { clienteId };

  // Lo mas grave manda: un error sobre "falta subir", y "falta subir" sobre "todo subido".
  const estadoVentas: Estado = hoy.ventas.some((v) => v.sync_estado === 'error')
    ? 'error'
    : hoy.ventas.some((v) => v.sync_estado !== 'sincronizado')
      ? 'pendiente'
      : hoy.ventas.length > 0
        ? 'listo'
        : 'neutro';

  const datoTocable = (etiqueta: string, valor: string, onPress: (() => void) | null) => (
    <Pressable
      key={etiqueta}
      disabled={onPress === null}
      onPress={onPress ?? undefined}
      accessibilityRole={onPress ? 'link' : 'text'}
      accessibilityLabel={`${etiqueta}: ${valor}`}
      style={({ pressed }) => [
        {
          flexGrow: 1,
          flexBasis: 220,
          padding: espacio.md,
          gap: espacio.xs,
          borderRadius: radio.medio,
          borderWidth: grosor.fuerte,
          borderColor: onPress ? colores.bordeFuerte : colores.borde,
          backgroundColor: colores.superficie,
        },
        pressed && { backgroundColor: colores.primarioTenue },
      ]}
    >
      <Text style={estilos.etiqueta}>{etiqueta}</Text>
      <Text
        numberOfLines={2}
        style={{
          fontFamily: fuente.cuerpoFuerte,
          fontSize: t(tipo.destacado),
          color: onPress ? colores.primario : colores.tintaSuave,
        }}
      >
        {valor}
      </Text>
    </Pressable>
  );

  return (
    <Pantalla
      titulo={cliente.nombre}
      subtitulo={cliente.encargado ? `Atiende ${cliente.encargado}` : 'Sin encargado registrado'}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm }}>
        {datoTocable(
          'Teléfono',
          cliente.telefono || 'sin teléfono',
          telefono ? () => abrir(telefono, 'el marcador') : null,
        )}
        {datoTocable(
          'Dirección',
          cliente.domicilio ?? (mapa ? 'Ver ubicación' : 'sin domicilio'),
          mapa ? () => abrir(mapa, 'Maps') : null,
        )}
        {foto ? datoTocable('Foto del lugar', 'Ver foto', () => setVerFoto(true)) : null}
      </View>

      <View style={[estilos.rejilla, { marginTop: espacio.md }]}>
        <BotonMenu
          titulo="Vender"
          descripcion="Capturar cantidades; el total se calcula con el precio del cliente"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/venta', params }}
          deshabilitado={!menu.operacionesHabilitadas}
          destacada
        />
        <BotonMenu
          titulo="Cobrar"
          descripcion="Cobrar o abonar una nota pendiente"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/cobranza', params }}
          deshabilitado={!menu.operacionesHabilitadas}
        />
        <BotonMenu
          titulo="Visita"
          descripcion="Visita sin venta (pendiente T-39)"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/visita-sin-venta', params }}
          deshabilitado={!menu.operacionesHabilitadas}
        />
      </View>

      {menu.avisoDiaCerrado ? (
        <Tarjeta estado="listo" etiqueta="Día cerrado">
          <Text style={estilos.textoTarjeta}>{menu.avisoDiaCerrado}</Text>
        </Tarjeta>
      ) : null}

      {/* T-20 (D5): se crea al cobrar de mas; usarlo es del portal. */}
      {cliente.saldo_favor_centavos > 0 ? (
        <Tarjeta estado="listo" etiqueta="Saldo a favor">
          <Cifra valor={pesos(cliente.saldo_favor_centavos)} tamano="destacado" tono="exito" />
          <Text style={estilos.textoSuave}>Lo aplica la oficina desde el portal.</Text>
        </Tarjeta>
      ) : null}

      <Tarjeta estado={hoy.notas.length > 0 ? 'pendiente' : 'neutro'} etiqueta="Notas pendientes">
        {hoy.notas.length === 0 ? (
          <Text style={estilos.textoSuave}>No debe nada.</Text>
        ) : (
          hoy.notas.map((n) => (
            <Text key={n.id} style={estilos.textoTarjeta}>
              <Cifra valor={n.folio} /> · {n.fecha} · debe <Cifra valor={pesos(n.saldo_centavos)} />
            </Text>
          ))
        )}
      </Tarjeta>

      <Tarjeta estado={estadoVentas} etiqueta="Ventas de hoy">
        {hoy.ventas.length === 0 ? (
          <Text style={estilos.textoSuave}>Todavía no le has vendido hoy.</Text>
        ) : (
          hoy.ventas.map((v) => (
            <View key={v.id} style={{ gap: espacio.xs, marginBottom: espacio.sm }}>
              <Text style={estilos.textoTarjeta}>
                <Cifra valor={v.folio} /> · <Cifra valor={pesos(v.monto_total_centavos)} /> ·{' '}
                {v.contado_credito === 'contado' ? 'contado' : 'crédito'}
              </Text>
              <Pastilla texto={ETIQUETA_SYNC[v.sync_estado]} estado={ESTADO_SYNC[v.sync_estado]} />
              {v.sync_estado === 'error' && v.sync_error ? (
                <Text style={estilos.error}>{v.sync_error}</Text>
              ) : null}
            </View>
          ))
        )}
      </Tarjeta>

      <Tarjeta etiqueta="Cobros de hoy">
        {hoy.cobros.length === 0 ? (
          <Text style={estilos.textoSuave}>Todavía no le has cobrado hoy.</Text>
        ) : (
          hoy.cobros.map((c) => (
            <View key={c.id} style={{ gap: espacio.xs, marginBottom: espacio.sm }}>
              <Text style={estilos.textoTarjeta}>
                <Cifra valor={pesos(c.monto_centavos)} /> · {c.metodo_pago}
              </Text>
              <Pastilla texto={ETIQUETA_SYNC[c.sync_estado]} estado={ESTADO_SYNC[c.sync_estado]} />
              {c.sync_estado === 'error' && c.sync_error ? (
                <Text style={estilos.error}>{c.sync_error}</Text>
              ) : null}
            </View>
          ))
        )}
      </Tarjeta>

      {foto ? (
        <Modal visible={verFoto} transparent animationType="fade" onRequestClose={() => setVerFoto(false)}>
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              padding: espacio.lg,
              gap: espacio.md,
              backgroundColor: 'rgba(25, 20, 16, 0.85)',
            }}
          >
            <Image
              source={{ uri: foto }}
              accessibilityLabel={`Foto del lugar de ${cliente.nombre}`}
              style={{ width: '100%', flex: 1, resizeMode: 'contain' }}
            />
            <Boton etiqueta="Cerrar" tono="neutra" ancho="ajustado" onPress={() => setVerFoto(false)} />
          </View>
        </Modal>
      ) : null}
    </Pantalla>
  );
}
```

- [ ] **Paso 5: Purga al abrir el día**

En `apps/tablet/app/abrir-dia.tsx`, dentro de `abrir()`, el bloque `try` queda:

```tsx
    try {
      datos.jornadas.abrir({ vendedorId: vendedor.id, vehiculoId, kmInicial: kmNumero });
      // T-37: la ruta de hace mas de 7 dias ya no sirve en la tablet (las altas
      // sin subir se conservan). Una vez al dia, con la tablet quieta.
      datos.rutas.purgar();
      refrescarJornada();
      router.replace('/(jornada)');
    } catch (e) {
      setError(e instanceof ErrorJornada ? e.message : 'No se pudo abrir el día.');
    }
```

- [ ] **Paso 6: Verificación**

Run:
```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm run export --workspace=apps/tablet
git status --short apps/tablet
```
Expected: todo en verde; el bundle sale. Revierte cualquier cambio que `expo` haya dejado en
`apps/tablet/package.json`/`tsconfig.json`.

- [ ] **Paso 7: Commit**

```bash
git add apps/tablet/src/datos/repositorios/prospectos.ts apps/tablet/src/datos/repositorios/prospectos.spec.ts \
  "apps/tablet/app/(jornada)/agregar-a-ruta.tsx" "apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx" \
  "apps/tablet/app/(jornada)/_layout.tsx" apps/tablet/app/abrir-dia.tsx
git commit -m "T-37: tablet — agregar a mi ruta, ficha del cliente ampliada y purga al abrir el dia

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Tarea 11: Portal — pantalla Ruta Diaria (D17)

**Archivos:**
- Crear: `apps/portal/src/lib/rutas.ts`, `apps/portal/src/lib/rutas.test.ts`
- Crear: `apps/portal/src/components/rutas/cartera-ruta.tsx`, `cartera-ruta.test.tsx`
- Crear: `apps/portal/src/components/rutas/lista-ruta-diaria.tsx`, `lista-ruta-diaria.test.tsx`
- Crear: `apps/portal/src/components/rutas/pantalla-ruta-diaria.tsx`, `pantalla-ruta-diaria.test.tsx`
- Modificar: `apps/portal/src/app/(portal)/operacion/ruta-diaria/page.tsx`

**Interfaces:**
- Consume: Tarea 5 (`GET/PUT /rutas/diaria`, `GET /rutas/diaria/anterior`, formas camelCase); `apiFetch`,
  `mensajeDe` (`lib/api.ts`); `listarClientes(sucursal, "cliente")` y `ClienteResumen` (`lib/clientes.ts`);
  `listarVendedores(sucursal)` y `Vendedor` (`lib/vendedores.ts`); `hoyEnTijuana`, `normalizarTexto`
  (`lib/ventas.ts`); `useAuth().puede` (`components/auth/auth-provider`).
- Produce: `lib/rutas.ts` con `OrigenRuta`, `FilaRutaDiaria`, `RutaDiaria`, `RutaAnterior`, `FilaEditable`,
  `obtenerRutaDiaria(vendedorId, fecha)`, `guardarRutaDiaria({ vendedorId, fecha, clientes })`,
  `obtenerRutaAnterior(vendedorId, fecha)`, y las funciones puras `aEditables`, `moverFila`, `quitarFila`,
  `agregarFila`, `cargarAnterior`, `hayCambios`, `armadaPorElVendedor`, `filtrarCartera`.

**Decisiones de esta tarea:**
1. **Nada se guarda al mover** (D17): la columna derecha es estado local; "Guardar ruta" manda la lista completa
   al `PUT`, que la aplica en una transacción. Un error de red deja la ruta del servidor como estaba y la pantalla
   con los cambios, para reintentar.
2. **La cartera se pide por la sucursal del vendedor elegido**, no por el selector global: un usuario General con
   "todas" elige un vendedor de cualquier sucursal y la cartera tiene que ser la de ese vendedor (el `PUT` rechaza
   otra). Los vendedores sí se filtran por el selector global, y solo los activos.
3. **Aviso de cambios sin guardar**: `window.confirm` al cambiar de vendedor o de fecha, y `beforeunload` mientras
   hay cambios (cerrar la pestaña o recargar).
4. **"Copiar de ayer"** reemplaza la columna derecha por la ruta anterior **sin guardar**; las filas del vendedor
   que no venían se quedan al final (no se pueden quitar, D14); un cliente que ya no está en la cartera se omite.

- [ ] **Paso 1: Pruebas de `lib/rutas.ts` (fallan)**

Crear `apps/portal/src/lib/rutas.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import type { ClienteResumen } from "./clientes";
import {
  aEditables,
  agregarFila,
  armadaPorElVendedor,
  cargarAnterior,
  filtrarCartera,
  guardarRutaDiaria,
  hayCambios,
  moverFila,
  obtenerRutaAnterior,
  obtenerRutaDiaria,
  quitarFila,
  type FilaEditable,
} from "./rutas";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

const fila = (clienteId: string, origen: "oficina" | "vendedor" = "oficina"): FilaEditable => ({
  clienteId,
  clienteNombre: `Cliente ${clienteId}`,
  origen,
});

const cliente = (id: string, nombre: string): ClienteResumen => ({
  id,
  nombre,
  telefono: "664",
  tipo: "cliente",
  tipoNegocio: null,
  sucursalCodigo: "TJ",
});

describe("lib/rutas: API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetch.mockResolvedValue({});
  });

  it("obtenerRutaDiaria y obtenerRutaAnterior piden por vendedor y fecha", async () => {
    await obtenerRutaDiaria("v1", "2026-10-12");
    expect(apiFetch).toHaveBeenLastCalledWith("/rutas/diaria?vendedorId=v1&fecha=2026-10-12");
    await obtenerRutaAnterior("v1", "2026-10-12");
    expect(apiFetch).toHaveBeenLastCalledWith("/rutas/diaria/anterior?vendedorId=v1&fecha=2026-10-12");
  });

  it("guardarRutaDiaria hace PUT con la lista completa", async () => {
    const cuerpo = { vendedorId: "v1", fecha: "2026-10-12", clientes: ["a", "b"] };
    await guardarRutaDiaria(cuerpo);
    expect(apiFetch).toHaveBeenLastCalledWith("/rutas/diaria", {
      method: "PUT",
      body: JSON.stringify(cuerpo),
    });
  });
});

describe("lib/rutas: edición local (D17)", () => {
  it("aEditables se queda con cliente, nombre y origen, en orden", () => {
    expect(
      aEditables({
        vendedor: { id: "v1", nombre: "Abraham", sucursalCodigo: "TJ" },
        fecha: "2026-10-12",
        filas: [
          { id: "r1", clienteId: "a", clienteNombre: "Cliente a", orden: 1, origen: "oficina" },
          { id: "r2", clienteId: "b", clienteNombre: "Cliente b", orden: 2, origen: "vendedor" },
        ],
      }),
    ).toEqual([fila("a"), fila("b", "vendedor")]);
  });

  it("moverFila sube y baja; fuera de rango no cambia nada", () => {
    const filas = [fila("a"), fila("b"), fila("c")];
    expect(moverFila(filas, 2, 1).map((f) => f.clienteId)).toEqual(["a", "c", "b"]);
    expect(moverFila(filas, 0, 1).map((f) => f.clienteId)).toEqual(["b", "a", "c"]);
    expect(moverFila(filas, 0, -1)).toBe(filas);
    expect(moverFila(filas, 2, 3)).toBe(filas);
  });

  it("quitarFila quita una de la oficina y nunca una del vendedor (D14)", () => {
    const filas = [fila("a"), fila("b", "vendedor")];
    expect(quitarFila(filas, 0).map((f) => f.clienteId)).toEqual(["b"]);
    expect(quitarFila(filas, 1)).toBe(filas);
  });

  it("agregarFila agrega al final como de la oficina y no repite", () => {
    const filas = [fila("a")];
    expect(agregarFila(filas, { id: "b", nombre: "Cliente b" })).toEqual([fila("a"), fila("b")]);
    expect(agregarFila(filas, { id: "a", nombre: "Cliente a" })).toBe(filas);
  });

  it("cargarAnterior pone la ruta copiada, deja al final las del vendedor y omite clientes que ya no están", () => {
    const actuales = [fila("x"), fila("v", "vendedor"), fila("w", "vendedor")];
    const cartera = [cliente("a", "Cliente a"), cliente("b", "Cliente b"), cliente("w", "Cliente w")];

    expect(cargarAnterior(actuales, ["b", "w", "borrado", "a"], cartera)).toEqual([
      fila("b"),
      fila("w", "vendedor"),
      fila("a"),
      fila("v", "vendedor"),
    ]);
  });

  it("hayCambios compara el orden de los clientes", () => {
    const filas = [fila("a"), fila("b")];
    expect(hayCambios(filas, [fila("a"), fila("b")])).toBe(false);
    expect(hayCambios(filas, [fila("b"), fila("a")])).toBe(true);
    expect(hayCambios(filas, [fila("a")])).toBe(true);
  });

  it("armadaPorElVendedor solo si hay filas y todas son del vendedor (D3)", () => {
    expect(armadaPorElVendedor([])).toBe(false);
    expect(armadaPorElVendedor([fila("a", "vendedor")])).toBe(true);
    expect(armadaPorElVendedor([fila("a", "vendedor"), fila("b")])).toBe(false);
  });

  it("filtrarCartera quita lo que ya está en la ruta y busca sin acentos", () => {
    const cartera = [cliente("1", "Abarrotes Doña Lupe"), cliente("2", "Tienda La Esquina"), cliente("3", "Abarrotes Güero")];
    expect(filtrarCartera(cartera, new Set(["3"]), "").map((c) => c.id)).toEqual(["1", "2"]);
    expect(filtrarCartera(cartera, new Set(), "dona").map((c) => c.id)).toEqual(["1"]);
  });
});
```

Run: `npm test --workspace=apps/portal -- src/lib/rutas.test.ts`
Expected: FAIL, no se resuelve `./rutas`.

- [ ] **Paso 2: `lib/rutas.ts`**

```ts
import { apiFetch } from "./api";
import type { ClienteResumen } from "./clientes";
import { normalizarTexto } from "./ventas";

// Copia normativa de las formas de
// apps/backend/src/modules/rutas/rutas-diarias.service.ts (`RutaDiaria`, `RutaAnterior`) y
// rutas-diarias.repository.ts (`FilaRutaDiaria`). Mismo trato que lib/cobranzas.ts: un cambio
// de forma en un lado exige el equivalente en el otro.

export type OrigenRuta = "oficina" | "vendedor";

export interface FilaRutaDiaria {
  id: string;
  clienteId: string;
  clienteNombre: string;
  orden: number;
  origen: OrigenRuta;
}

export interface RutaDiaria {
  vendedor: { id: string; nombre: string; sucursalCodigo: string };
  fecha: string;
  filas: FilaRutaDiaria[];
}

export interface RutaAnterior {
  /** `null` si el vendedor no tiene ninguna ruta antes de esa fecha. */
  fecha: string | null;
  clientes: string[];
}

/** Una fila de la columna derecha mientras se edita (sin guardar). */
export interface FilaEditable {
  clienteId: string;
  clienteNombre: string;
  origen: OrigenRuta;
}

export function obtenerRutaDiaria(vendedorId: string, fecha: string): Promise<RutaDiaria> {
  return apiFetch<RutaDiaria>(`/rutas/diaria?${new URLSearchParams({ vendedorId, fecha }).toString()}`);
}

export function obtenerRutaAnterior(vendedorId: string, fecha: string): Promise<RutaAnterior> {
  return apiFetch<RutaAnterior>(
    `/rutas/diaria/anterior?${new URLSearchParams({ vendedorId, fecha }).toString()}`,
  );
}

/** Semántica de reemplazo (D14): la lista COMPLETA y ordenada. */
export function guardarRutaDiaria(datos: {
  vendedorId: string;
  fecha: string;
  clientes: string[];
}): Promise<RutaDiaria> {
  return apiFetch<RutaDiaria>("/rutas/diaria", { method: "PUT", body: JSON.stringify(datos) });
}

export function aEditables(ruta: RutaDiaria): FilaEditable[] {
  return ruta.filas.map(({ clienteId, clienteNombre, origen }) => ({ clienteId, clienteNombre, origen }));
}

/** Mueve una fila. Fuera de rango devuelve la MISMA lista (React no repinta). */
export function moverFila(filas: FilaEditable[], desde: number, hasta: number): FilaEditable[] {
  if (desde < 0 || desde >= filas.length || hasta < 0 || hasta >= filas.length) return filas;
  const copia = [...filas];
  const [movida] = copia.splice(desde, 1);
  copia.splice(hasta, 0, movida);
  return copia;
}

/** El portal no puede quitar lo que agregó el vendedor (D2, D14): solo reordenarlo. */
export function quitarFila(filas: FilaEditable[], indice: number): FilaEditable[] {
  if (filas[indice]?.origen !== "oficina") return filas;
  return filas.filter((_, i) => i !== indice);
}

export function agregarFila(filas: FilaEditable[], cliente: { id: string; nombre: string }): FilaEditable[] {
  if (filas.some((f) => f.clienteId === cliente.id)) return filas;
  return [...filas, { clienteId: cliente.id, clienteNombre: cliente.nombre, origen: "oficina" }];
}

/**
 * "Copiar de ayer" (D17): la ruta anterior en su orden, sin guardar. Una fila que
 * ya estaba conserva su origen; un cliente que ya no está en la cartera se omite;
 * las del vendedor que no venían se quedan al final (no se pueden quitar).
 */
export function cargarAnterior(
  filas: FilaEditable[],
  anterior: string[],
  cartera: Pick<ClienteResumen, "id" | "nombre">[],
): FilaEditable[] {
  const actuales = new Map(filas.map((f) => [f.clienteId, f]));
  const nombres = new Map(cartera.map((c) => [c.id, c.nombre]));
  const copiadas: FilaEditable[] = [];
  for (const id of anterior) {
    const actual = actuales.get(id);
    const nombre = nombres.get(id);
    if (actual) copiadas.push(actual);
    else if (nombre !== undefined) copiadas.push({ clienteId: id, clienteNombre: nombre, origen: "oficina" });
  }
  const enCopia = new Set(copiadas.map((f) => f.clienteId));
  return [...copiadas, ...filas.filter((f) => f.origen === "vendedor" && !enCopia.has(f.clienteId))];
}

/** ¿La columna derecha ya no es lo que está guardado? Cuenta el orden. */
export function hayCambios(original: FilaEditable[], actual: FilaEditable[]): boolean {
  return original.length !== actual.length || original.some((f, i) => f.clienteId !== actual[i].clienteId);
}

/** Encabezado "Ruta armada por el vendedor" (D3). */
export function armadaPorElVendedor(filas: FilaEditable[]): boolean {
  return filas.length > 0 && filas.every((f) => f.origen === "vendedor");
}

/** La cartera que se ofrece: lo que no está ya en la ruta, buscando sin acentos. */
export function filtrarCartera(
  cartera: ClienteResumen[],
  enRuta: ReadonlySet<string>,
  busqueda: string,
): ClienteResumen[] {
  const q = normalizarTexto(busqueda.trim());
  return cartera.filter((c) => !enRuta.has(c.id) && (q === "" || normalizarTexto(c.nombre).includes(q)));
}
```

Run: `npm test --workspace=apps/portal -- src/lib/rutas.test.ts`
Expected: PASS.

- [ ] **Paso 3: Pruebas de los componentes (fallan)**

Crear `apps/portal/src/components/rutas/lista-ruta-diaria.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FilaEditable } from "@/lib/rutas";
import { ListaRutaDiaria } from "./lista-ruta-diaria";

const filas: FilaEditable[] = [
  { clienteId: "a", clienteNombre: "Abarrotes A", origen: "oficina" },
  { clienteId: "b", clienteNombre: "Tienda B", origen: "vendedor" },
];

describe("ListaRutaDiaria", () => {
  it("numera las filas y marca las que agregó el vendedor, sin botón de quitar", () => {
    render(<ListaRutaDiaria filas={filas} onMover={vi.fn()} onQuitar={vi.fn()} />);
    expect(screen.getByText("Ruta del día")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("1Abarrotes A"),
      expect.stringContaining("2Tienda B"),
    ]);
    expect(screen.getByText("agregada por el vendedor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar Abarrotes A" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quitar Tienda B" })).toBeNull();
  });

  it("subir, bajar y quitar avisan con el índice; los extremos no se mueven", async () => {
    const onMover = vi.fn();
    const onQuitar = vi.fn();
    const usuario = userEvent.setup();
    render(<ListaRutaDiaria filas={filas} onMover={onMover} onQuitar={onQuitar} />);

    expect(screen.getByRole("button", { name: "Subir Abarrotes A" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bajar Tienda B" })).toBeDisabled();
    await usuario.click(screen.getByRole("button", { name: "Subir Tienda B" }));
    expect(onMover).toHaveBeenCalledWith(1, 0);
    await usuario.click(screen.getByRole("button", { name: "Bajar Abarrotes A" }));
    expect(onMover).toHaveBeenCalledWith(0, 1);
    await usuario.click(screen.getByRole("button", { name: "Quitar Abarrotes A" }));
    expect(onQuitar).toHaveBeenCalledWith(0);
  });

  it("si todas son del vendedor, el encabezado lo dice (D3)", () => {
    render(<ListaRutaDiaria filas={[filas[1]]} onMover={vi.fn()} onQuitar={vi.fn()} />);
    expect(screen.getByText("Ruta armada por el vendedor")).toBeInTheDocument();
  });
});
```

Crear `apps/portal/src/components/rutas/cartera-ruta.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClienteResumen } from "@/lib/clientes";
import { CarteraRuta } from "./cartera-ruta";

const c = (id: string, nombre: string): ClienteResumen => ({
  id,
  nombre,
  telefono: "664",
  tipo: "cliente",
  tipoNegocio: null,
  sucursalCodigo: "TJ",
});
const cartera = [c("a", "Abarrotes Doña Lupe"), c("b", "Tienda La Esquina"), c("x", "Ya en ruta")];

describe("CarteraRuta", () => {
  it("ofrece lo que no está en la ruta y filtra por nombre", async () => {
    const usuario = userEvent.setup();
    render(<CarteraRuta cartera={cartera} enRuta={new Set(["x"])} onAgregar={vi.fn()} />);

    expect(screen.queryByText("Ya en ruta")).toBeNull();
    await usuario.type(screen.getByLabelText("Buscar cliente"), "dona");
    expect(screen.getByText("Abarrotes Doña Lupe")).toBeInTheDocument();
    expect(screen.queryByText("Tienda La Esquina")).toBeNull();
  });

  it("Agregar avisa con el cliente", async () => {
    const onAgregar = vi.fn();
    const usuario = userEvent.setup();
    render(<CarteraRuta cartera={cartera} enRuta={new Set()} onAgregar={onAgregar} />);

    await usuario.click(screen.getByRole("button", { name: "Agregar Tienda La Esquina" }));
    expect(onAgregar).toHaveBeenCalledWith(cartera[1]);
  });
});
```

Crear `apps/portal/src/components/rutas/pantalla-ruta-diaria.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as clientesLib from "@/lib/clientes";
import type { ClienteResumen } from "@/lib/clientes";
import * as rutasLib from "@/lib/rutas";
import type { RutaDiaria } from "@/lib/rutas";
import * as vendedoresLib from "@/lib/vendedores";
import type { Vendedor } from "@/lib/vendedores";
import { AVISO_CAMBIOS, PantallaRutaDiaria } from "./pantalla-ruta-diaria";

vi.mock("@/lib/clientes");
vi.mock("@/lib/vendedores");
vi.mock("@/lib/rutas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rutas")>();
  return {
    ...real,
    obtenerRutaDiaria: vi.fn(),
    guardarRutaDiaria: vi.fn(),
    obtenerRutaAnterior: vi.fn(),
  };
});
vi.mock("@/components/auth/auth-provider");

const VENDEDOR: Vendedor = {
  id: "v1",
  nombre: "Abraham Pérez",
  login: "aperez",
  sucursalId: "s-tj",
  sucursalCodigo: "TJ",
  folioSegmento: "AP",
  activo: true,
};
const cliente = (id: string, nombre: string): ClienteResumen => ({
  id,
  nombre,
  telefono: "664",
  tipo: "cliente",
  tipoNegocio: null,
  sucursalCodigo: "TJ",
});
const ruta = (filas: RutaDiaria["filas"]): RutaDiaria => ({
  vendedor: { id: "v1", nombre: "Abraham Pérez", sucursalCodigo: "TJ" },
  fecha: "2026-10-12",
  filas,
});
const FILA_A = { id: "r1", clienteId: "a", clienteNombre: "Abarrotes A", orden: 1, origen: "oficina" as const };

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede });
}

async function elegirVendedor(usuario: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("option", { name: /Abraham Pérez/ });
  await usuario.selectOptions(screen.getByLabelText("Vendedor"), "v1");
  await screen.findByText("Abarrotes A");
}

describe("PantallaRutaDiaria", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vendedoresLib.listarVendedores).mockResolvedValue([
      VENDEDOR,
      { ...VENDEDOR, id: "v2", nombre: "Inactivo", activo: false },
    ]);
    vi.mocked(clientesLib.listarClientes).mockResolvedValue([
      cliente("a", "Abarrotes A"),
      cliente("b", "Tienda B"),
    ]);
    vi.mocked(rutasLib.obtenerRutaDiaria).mockResolvedValue(ruta([FILA_A]));
  });

  it("sin ruta_diaria.gestionar lo dice y no pide nada", () => {
    mockAuth(() => false);
    render(<PantallaRutaDiaria sucursal={null} />);
    expect(screen.getByText("No tienes permiso para gestionar la ruta diaria")).toBeInTheDocument();
    expect(vendedoresLib.listarVendedores).not.toHaveBeenCalled();
  });

  it("solo ofrece vendedores activos; al elegir uno carga su ruta y la cartera de su sucursal", async () => {
    mockAuth(() => true);
    const usuario = userEvent.setup();
    render(<PantallaRutaDiaria sucursal="todas" />);

    await elegirVendedor(usuario);

    expect(screen.queryByRole("option", { name: /Inactivo/ })).toBeNull();
    expect(vendedoresLib.listarVendedores).toHaveBeenCalledWith("todas");
    expect(clientesLib.listarClientes).toHaveBeenCalledWith("TJ", "cliente");
    expect(rutasLib.obtenerRutaDiaria).toHaveBeenCalledWith("v1", expect.any(String));
  });

  it("agregar no guarda; Guardar ruta manda la lista completa y limpia el aviso", async () => {
    mockAuth(() => true);
    vi.mocked(rutasLib.guardarRutaDiaria).mockResolvedValue(
      ruta([FILA_A, { id: "r2", clienteId: "b", clienteNombre: "Tienda B", orden: 2, origen: "oficina" }]),
    );
    const usuario = userEvent.setup();
    render(<PantallaRutaDiaria sucursal={null} />);
    await elegirVendedor(usuario);

    await usuario.click(screen.getByRole("button", { name: "Agregar Tienda B" }));
    expect(screen.getByText("Cambios sin guardar")).toBeInTheDocument();
    expect(rutasLib.guardarRutaDiaria).not.toHaveBeenCalled();

    await usuario.click(screen.getByRole("button", { name: "Guardar ruta" }));

    expect(rutasLib.guardarRutaDiaria).toHaveBeenCalledWith({
      vendedorId: "v1",
      fecha: expect.any(String) as string,
      clientes: ["a", "b"],
    });
    expect(await screen.findByText("Ruta guardada.")).toBeInTheDocument();
    expect(screen.queryByText("Cambios sin guardar")).toBeNull();
  });

  it("Copiar de ayer carga la ruta anterior sin guardar", async () => {
    mockAuth(() => true);
    vi.mocked(rutasLib.obtenerRutaAnterior).mockResolvedValue({ fecha: "2026-10-11", clientes: ["b"] });
    const usuario = userEvent.setup();
    render(<PantallaRutaDiaria sucursal={null} />);
    await elegirVendedor(usuario);

    await usuario.click(screen.getByRole("button", { name: "Copiar de ayer" }));

    const lista = screen.getByRole("region", { name: "Ruta del día" });
    expect(await within(lista).findByText("Tienda B")).toBeInTheDocument();
    expect(within(lista).queryByText("Abarrotes A")).toBeNull();
    expect(screen.getByText("Se cargó la ruta del 2026-10-11. Revísala y guarda.")).toBeInTheDocument();
    expect(rutasLib.guardarRutaDiaria).not.toHaveBeenCalled();
  });

  it("con cambios sin guardar, cambiar la fecha pregunta; si cancela, se queda", async () => {
    mockAuth(() => true);
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    const usuario = userEvent.setup();
    render(<PantallaRutaDiaria sucursal={null} />);
    await elegirVendedor(usuario);
    await usuario.click(screen.getByRole("button", { name: "Agregar Tienda B" }));

    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2030-01-01" } });

    expect(confirmar).toHaveBeenCalledWith(AVISO_CAMBIOS);
    expect(rutasLib.obtenerRutaDiaria).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Cambios sin guardar")).toBeInTheDocument();
    confirmar.mockRestore();
  });
});
```

Run: `npm test --workspace=apps/portal -- src/components/rutas`
Expected: FAIL, no se resuelven los componentes.

- [ ] **Paso 4: `components/rutas/lista-ruta-diaria.tsx`**

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { armadaPorElVendedor, type FilaEditable } from "@/lib/rutas";

/**
 * La columna derecha de Ruta Diaria (D17): la ruta numerada, con subir / bajar /
 * quitar. Lo que agregó el vendedor lleva su etiqueta y NO se puede quitar
 * (D2, D14), solo reordenar.
 */
export function ListaRutaDiaria({
  filas,
  onMover,
  onQuitar,
}: {
  filas: FilaEditable[];
  onMover: (desde: number, hasta: number) => void;
  onQuitar: (indice: number) => void;
}) {
  return (
    <section aria-label="Ruta del día" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">
        {armadaPorElVendedor(filas) ? "Ruta armada por el vendedor" : "Ruta del día"}
      </h3>
      {filas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin clientes en la ruta. Agrégalos desde la cartera.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {filas.map((f, i) => (
            <li key={f.clienteId} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              <span className="w-6 text-right tabular-nums">{i + 1}</span>
              <span className="flex-1">{f.clienteNombre}</span>
              {f.origen === "vendedor" ? (
                <span className="rounded bg-muted px-2 py-0.5 text-xs">agregada por el vendedor</span>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Subir ${f.clienteNombre}`}
                disabled={i === 0}
                onClick={() => onMover(i, i - 1)}
              >
                ↑
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Bajar ${f.clienteNombre}`}
                disabled={i === filas.length - 1}
                onClick={() => onMover(i, i + 1)}
              >
                ↓
              </Button>
              {f.origen === "oficina" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Quitar ${f.clienteNombre}`}
                  onClick={() => onQuitar(i)}
                >
                  Quitar
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

- [ ] **Paso 5: `components/rutas/cartera-ruta.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ClienteResumen } from "@/lib/clientes";
import { filtrarCartera } from "@/lib/rutas";

/**
 * La columna izquierda de Ruta Diaria (D17): clientes activos de la sucursal del
 * vendedor que no están en la ruta, con buscador y "Agregar".
 */
export function CarteraRuta({
  cartera,
  enRuta,
  onAgregar,
}: {
  cartera: ClienteResumen[];
  enRuta: ReadonlySet<string>;
  onAgregar: (cliente: ClienteResumen) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const visibles = useMemo(() => filtrarCartera(cartera, enRuta, busqueda), [cartera, enRuta, busqueda]);

  return (
    <section aria-label="Cartera de clientes" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Cartera de clientes</h3>
      <label htmlFor="buscar-cartera" className="text-sm font-medium">
        Buscar cliente
      </label>
      <input
        id="buscar-cartera"
        autoComplete="off"
        placeholder="Escribe el nombre del cliente"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        className="rounded-md border px-3 py-2 text-sm"
      />
      {visibles.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ningún cliente disponible.</p>
      ) : (
        <ul className="flex max-h-[28rem] flex-col gap-1 overflow-y-auto">
          {visibles.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              <span className="flex-1">{c.nombre}</span>
              <Button type="button" size="sm" aria-label={`Agregar ${c.nombre}`} onClick={() => onAgregar(c)}>
                Agregar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Paso 6: `components/rutas/pantalla-ruta-diaria.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mensajeDe } from "@/lib/api";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import {
  aEditables,
  agregarFila,
  cargarAnterior,
  guardarRutaDiaria,
  hayCambios,
  moverFila,
  obtenerRutaAnterior,
  obtenerRutaDiaria,
  quitarFila,
  type FilaEditable,
} from "@/lib/rutas";
import { listarVendedores, type Vendedor } from "@/lib/vendedores";
import { hoyEnTijuana } from "@/lib/ventas";
import { CarteraRuta } from "./cartera-ruta";
import { ListaRutaDiaria } from "./lista-ruta-diaria";

export const AVISO_CAMBIOS = "Hay cambios sin guardar en la ruta. ¿Descartarlos?";

/**
 * Operación → Ruta Diaria (T-37, D17). La oficina arma la ruta de un vendedor
 * para un día: cartera a la izquierda, ruta a la derecha. Nada se guarda al
 * mover; "Guardar ruta" manda la lista completa (reemplazo, D14).
 *
 * Sin mapa, sin seguimiento de visitas, sin efectividad (T-41, pieza 3, T-46) y
 * sin ruta semanal (T-36).
 */
export function PantallaRutaDiaria({ sucursal }: { sucursal: string | null }) {
  const { puede } = useAuth();
  const permitido = puede("ruta_diaria.gestionar");

  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [vendedorId, setVendedorId] = useState("");
  const [fecha, setFecha] = useState(hoyEnTijuana);
  const [cartera, setCartera] = useState<ClienteResumen[]>([]);
  const [original, setOriginal] = useState<FilaEditable[]>([]);
  const [filas, setFilas] = useState<FilaEditable[]>([]);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const vendedor = vendedores.find((v) => v.id === vendedorId) ?? null;
  // La cartera es la de la sucursal DEL VENDEDOR: el PUT rechaza clientes de otra.
  const sucursalVendedor = vendedor?.sucursalCodigo ?? null;
  const sucio = hayCambios(original, filas);
  const enRuta = useMemo(() => new Set(filas.map((f) => f.clienteId)), [filas]);

  useEffect(() => {
    if (!permitido) return;
    let vigente = true;
    listarVendedores(sucursal)
      .then((lista) => {
        // Un vendedor desactivado no sale a repartir: no se le arma ruta.
        if (vigente) setVendedores(lista.filter((v) => v.activo));
      })
      .catch(() => {
        if (vigente) setError("No se pudieron cargar los vendedores.");
      });
    return () => {
      vigente = false;
    };
  }, [permitido, sucursal]);

  useEffect(() => {
    if (!vendedorId || !sucursalVendedor) return;
    let vigente = true;
    setCargando(true);
    setError(null);
    setAviso(null);
    setOriginal([]);
    setFilas([]);
    Promise.all([listarClientes(sucursalVendedor, "cliente"), obtenerRutaDiaria(vendedorId, fecha)])
      .then(([clientes, ruta]) => {
        if (!vigente) return;
        const editables = aEditables(ruta);
        setCartera(clientes);
        setOriginal(editables);
        setFilas(editables);
      })
      .catch((err: unknown) => {
        if (vigente) setError(mensajeDe(err, "No se pudo cargar la ruta."));
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [vendedorId, sucursalVendedor, fecha]);

  // Cerrar la pestaña o recargar con cambios sin guardar: el navegador pregunta.
  useEffect(() => {
    if (!sucio) return;
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sucio]);

  function puedeDescartar(): boolean {
    return !sucio || window.confirm(AVISO_CAMBIOS);
  }

  function cambiarVendedor(id: string) {
    if (id === vendedorId || !puedeDescartar()) return;
    setVendedorId(id);
  }

  function cambiarFecha(valor: string) {
    if (valor === "" || valor === fecha || !puedeDescartar()) return;
    setFecha(valor);
  }

  async function guardar() {
    if (!vendedor) return;
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const ruta = await guardarRutaDiaria({
        vendedorId: vendedor.id,
        fecha,
        clientes: filas.map((f) => f.clienteId),
      });
      const editables = aEditables(ruta);
      setOriginal(editables);
      setFilas(editables);
      setAviso("Ruta guardada.");
    } catch (err) {
      // El PUT es una transacción: si falló, la ruta del servidor no cambió.
      setError(mensajeDe(err, "No se pudo guardar la ruta. No se cambió nada; vuelve a intentar."));
    } finally {
      setGuardando(false);
    }
  }

  async function copiarDeAyer() {
    if (!vendedor) return;
    setError(null);
    setAviso(null);
    try {
      const anterior = await obtenerRutaAnterior(vendedor.id, fecha);
      if (anterior.fecha === null) {
        setAviso("Este vendedor no tiene una ruta anterior.");
        return;
      }
      setFilas((actuales) => cargarAnterior(actuales, anterior.clientes, cartera));
      setAviso(`Se cargó la ruta del ${anterior.fecha}. Revísala y guarda.`);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo leer la ruta anterior."));
    }
  }

  if (!permitido) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ruta Diaria</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No tienes permiso para gestionar la ruta diaria</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ruta Diaria</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ruta-vendedor" className="text-sm font-medium">
              Vendedor
            </label>
            <select
              id="ruta-vendedor"
              value={vendedorId}
              onChange={(e) => cambiarVendedor(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <option value="">Elige un vendedor</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nombre} · {v.sucursalCodigo}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ruta-fecha" className="text-sm font-medium">
              Fecha
            </label>
            <input
              id="ruta-fecha"
              type="date"
              value={fecha}
              onChange={(e) => cambiarFecha(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!vendedor || cargando || guardando}
              onClick={() => void copiarDeAyer()}
            >
              Copiar de ayer
            </Button>
            <Button type="button" disabled={!vendedor || !sucio || guardando} onClick={() => void guardar()}>
              {guardando ? "Guardando…" : "Guardar ruta"}
            </Button>
          </div>
        </div>

        {sucio ? <p className="text-sm font-medium text-amber-700">Cambios sin guardar</p> : null}
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

        {!vendedor ? (
          <p className="text-sm text-muted-foreground">Elige un vendedor para ver su ruta.</p>
        ) : cargando ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <CarteraRuta
              cartera={cartera}
              enRuta={enRuta}
              onAgregar={(c) => setFilas((actuales) => agregarFila(actuales, { id: c.id, nombre: c.nombre }))}
            />
            <ListaRutaDiaria
              filas={filas}
              onMover={(desde, hasta) => setFilas((actuales) => moverFila(actuales, desde, hasta))}
              onQuitar={(indice) => setFilas((actuales) => quitarFila(actuales, indice))}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Paso 7: La página**

`apps/portal/src/app/(portal)/operacion/ruta-diaria/page.tsx` queda:

```tsx
import { PantallaRutaDiaria } from "@/components/rutas/pantalla-ruta-diaria";

// Server component delgado (mismo patrón que /operacion/cobranza).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaRutaDiaria sucursal={sucursal ?? null} />;
}
```

- [ ] **Paso 8: Verificación**

Run:
```bash
npm test --workspace=apps/portal
npm run lint --workspace=apps/portal
npm exec --workspace=apps/portal -- tsc --noEmit
npm run build --workspace=apps/portal
```
Expected: pruebas = línea base + las de esta tarea, en verde; lint y tipos sin errores; el build de Next sale.

- [ ] **Paso 9: Commit**

```bash
git add apps/portal/src/lib/rutas.ts apps/portal/src/lib/rutas.test.ts apps/portal/src/components/rutas \
  "apps/portal/src/app/(portal)/operacion/ruta-diaria/page.tsx"
git commit -m "T-37: portal — pantalla Ruta Diaria con cartera, reorden, guardar y copiar de ayer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Tarea 12: Cierre — documentación, verificación completa y aceptación manual

**Archivos:**
- Modificar: `apps/tablet/README.md`
- Modificar: `CLAUDE.md`
- Revisar (y completar si falta algo): `docs/contrato-sincronizacion.md`

**Interfaces:**
- Consume: todo lo anterior.
- Produce: documentación; el reporte de la verificación completa y de la aceptación manual para el PR.

- [ ] **Paso 1: `apps/tablet/README.md`**

a) En el árbol de "Estructura", el bloque de `(jornada)/` queda:

```
│   └── (jornada)/             # todo lo que exige sesion + jornada abierta
│       ├── _layout.tsx        # guardia de sesion + del kilometraje inicial
│       ├── index.tsx          # la ruta del dia (pantalla principal, T-37)
│       ├── agregar-a-ruta.tsx # clientes existentes que el vendedor suma a su ruta
│       ├── operacion/         # todos los clientes -> ficha -> venta / cobranza / visita
│       ├── pendiente/         # secciones del menu que aun no existen (gastos, inventario, merma)
│       ├── prospectos.tsx
│       ├── ruta.tsx           # Ruta y GPS (T-41)
│       └── cerrar-dia.tsx     # km final (el corte es T-33)
```

b) Después de la sección `## Jornada: cerrar el día cierra las operaciones (T-38)`, agregar:

```markdown
## Ruta del día y pantalla principal (T-37)

- **La jornada abre en la ruta del día** (`app/(jornada)/index.tsx`): barra con *Prospecto*, *Refrescar* (es el
  "Sincronizar ahora" de siempre, con la pastilla de pendientes) y *Agregar a mi ruta*; menú hamburguesa en una
  hoja modal (`src/ui/menu-hoja.tsx`, sin cajón: la app no trae gesture-handler ni reanimated).
- **Dos tablas locales** (migración 011): `ruta` la escribe el pull con su regla de fusión
  (`aplicarSnapshotRutas` en `src/datos/repositorios/rutas.ts`) y `ruta_orden_local` solo el dedo del vendedor.
  Ningún pull toca el orden local, y el orden **no sube** al servidor.
- **Las altas del vendedor suben como `ruta-alta`** (`src/sincronizacion/fuente-rutas.ts`). `ruta-duplicada` no es
  error: la fila queda sincronizada y el pull posterior la funde con la del servidor. Un alta rechazada por otro
  motivo se ve en rojo bajo la fila y el vendedor la puede quitar (`quitarRechazada`).
- **"Visitado" se deriva** (venta o cobro de hoy en la tablet) y la **burbuja** cuenta las notas con saldo; los dos
  salen de `rutas.delDia()`. Una fila que la oficina quitó se queda en "Fuera de ruta" solo si hoy tuvo actividad.
- **Reordenar**: mantener presionado y arrastrar (`PanResponder`, `src/ui/lista-ruta.tsx`), con ▲/▼ siempre como
  respaldo. Si el arrastre resulta frágil en un equipo, `ARRASTRE_HABILITADO = false` deja solo los botones.
- La lógica de la pantalla vive en `src/estado/ruta-del-dia.ts` (puro, con pruebas). "Abrir el día" purga la ruta
  de hace más de 7 días (`rutas.purgar`), conservando las altas sin subir.
```

c) En "Pendiente (otros tickets)", la línea de los módulos de la jornada queda:

```markdown
- **T-20 / T-27 / T-31 / T-33 / T-39 / T-41** — módulos de la jornada que todavía son placeholders (gastos,
  inventario, merma, visita sin venta, Ruta y GPS).
```

- [ ] **Paso 2: `CLAUDE.md`**

Después del punto **Jornada y kilometraje (T-38)** (antes del párrafo que empieza `` `npm run supabase -- migration
up --local` aplica``), agregar:

```markdown
- **Ruta diaria (T-37).** La oficina arma la ruta del día en el portal (`PUT /rutas/diaria`, permiso
  `ruta_diaria.gestionar`) y el vendedor la complementa desde la tablet con la operación **`ruta-alta`** (no `ruta`,
  que queda para la visita de T-39). Todo en `rutas/rutas-diarias.*`.
  - `ruta.origen` (`oficina`/`vendedor`) y un único vivo por vendedor, fecha y cliente en la diaria
    (`uq_ruta_diaria_vendedor_fecha_cliente`, parcial; la semanal de T-36 no entra). El alta usa `on conflict … do
    nothing` y, si no insertó, rechaza `ruta-duplicada`, que **la tablet trata como aplicada**.
  - `cliente_id` de `ruta-alta` viaja en **`datos`**, no en el sobre (así un prospecto o un cliente borrado sale como
    `cliente-inexistente` y no como `cliente-fuera-de-alcance`); el buzón lo conserva (`guardarOperacion`).
  - El `PUT` del portal **reemplaza** la ruta en una transacción: adopta lo que subió el vendedor, da de baja lo de
    la oficina que no viene y **conserva** (renumerado al final) lo del vendedor. Alta y `PUT` se serializan
    bloqueando la fila del vendedor (`for no key update`). Respuestas en camelCase; vendedor fuera de alcance = 404.
  - El pull baja `rutas` del vendedor del token en la ventana `current_date - 1 .. + 7` del reloj de Postgres (UTC);
    la baja viaja con `activo: 0`. El orden que arrastra el vendedor **no sube** (vive en `ruta_orden_local`).
```

- [ ] **Paso 3: `docs/contrato-sincronizacion.md`**

Comprueba que la Tarea 2 dejó: `rutas` en el ejemplo de §5 y su subsección; `ruta-alta` en el comentario del tipo,
en el párrafo de "`datos` lo fija…" y en su subsección de §6; los tres códigos en la tabla; `RutasDiariasService` en
§7; la fila nueva de §9. Run:

```bash
grep -n "ruta-alta\|ruta-duplicada\|cliente-inexistente\|ruta-datos-invalidos\|\"rutas\"\|RutasDiariasService" \
  docs/contrato-sincronizacion.md
```
Expected: aparecen en §5, §6 (petición, subsección, tabla), §7 y el párrafo de tipos con forma fija. Si algo falta,
agrégalo con el texto de la Tarea 2, Paso 8.

- [ ] **Paso 4: Verificación completa de la rama**

Run:
```bash
npm run supabase -- migration up --local
npm run supabase -- test db --local
npm run db:types --workspace=apps/backend && git diff --exit-code apps/backend/src/database/schema.d.ts
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm run export --workspace=apps/tablet
npm test --workspace=apps/portal
npm run lint --workspace=apps/portal
npm exec --workspace=apps/portal -- tsc --noEmit
git status
git log --oneline origin/main..HEAD | head -20
```
Expected: todo en verde contra la línea base de la Tarea 1 (anota los totales nuevos); `schema.d.ts` sin diff;
`git status` limpio (revierte lo que `expo` haya ensuciado); doce commits `T-37: …` encima del commit del spec.

- [ ] **Paso 5: Commit de la documentación**

```bash
git add apps/tablet/README.md CLAUDE.md docs/contrato-sincronizacion.md
git commit -m "T-37: documentacion — ruta diaria en el servidor, la tablet y el portal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Paso 6: Aceptación manual en el emulador (lista de verificación del spec)**

Con la receta de `pruebas-manuales-emulador` (adb + uiautomator) y **todo contra el Postgres local**, nunca contra
`sinmex dev` (la migración de esta rama no está en la nube):

- Backend: `NODE_ENV=test npm run backend` (lee `.env.test`, que apunta a `127.0.0.1:54322`); compruébalo antes de
  seguir. Portal: `npm run portal`. Tablet: desde `apps/tablet` del worktree,
  `npx expo run:android --port 8082 --device Pixel_7`, y `adb reverse tcp:3000 tcp:3000`. Revierte después lo que
  `expo` ensucie en `apps/tablet/package.json`/`tsconfig.json`.
- SQL a mano: `docker exec -i supabase_db_proyecto-sinmex psql -U postgres -d postgres -c "…"`. Filas de la ruta del
  vendedor de prueba: `select r.fecha, c.nombre, r.orden, r.origen, r.deleted_at from ruta r join cliente c on c.id
  = r.cliente_id join vendedor v on v.id = r.vendedor_id where v.login = '<login>' order by r.fecha, r.orden;`
- SQLite de la tablet: `adb exec-out run-as mx.jawa.tablet cat files/SQLite/jawa.db` (+ `-wal`, `-shm`) y
  `select id, cliente_id, orden, origen, activo, sync_estado, sync_error from ruta;`.

Lista (copiada del spec, § "Aceptación manual en el emulador"); anota en el reporte captura + fila por punto:

- [ ] 1. Día abierto sin ruta en Postgres → aviso de D3 ("La oficina no ha asignado ruta para hoy…" con la hora de
  la última sincronización). Agregar dos clientes a mano → aparecen 1 y 2 con `sync_estado = 'pendiente'`.
- [ ] 2. Sincronizar → en Postgres dos filas `origen = 'vendedor'`; en la tablet las mismas con id del servidor y
  `sincronizada`.
- [ ] 3. Desde el portal asignar al vendedor: cliente A (uno de los dos) y cliente C (nuevo), guardar. En Postgres:
  A pasa a `oficina`, B sigue `vendedor`, C nuevo.
- [ ] 4. Arrastrar en la tablet para poner B primero. Sincronizar → la lista queda B, A, C (orden local de B
  respetado; C al final). Ninguna fila duplicada.
- [ ] 5. Cobrar a un cliente con dos notas pendientes **con el servidor apagado** (`adb reverse --remove tcp:3000`)
  → la burbuja pasa de 2 a 1 y la fila queda visitada.
- [ ] 6. Quitar A desde el portal y sincronizar: A ya tiene cobranza → se queda en "Fuera de ruta" visitado. Quitar
  C (sin actividad) → desaparece.
- [ ] 7. Teléfono abre el marcador; dirección abre Maps (en el emulador, el intent se ve en `logcat`).
- [ ] 8. Cerrar el día → lista en solo lectura y "Agregar a mi ruta" deshabilitado.

Si el arrastre (punto 4) resulta frágil, se cumple con ▲/▼ y se anota; si hubo que poner
`ARRASTRE_HABILITADO = false`, va en un commit aparte `T-37: arrastre apagado; quedan subir/bajar (D10)` con el
mismo trailer.

- [ ] **Paso 7: Notas para el PR (texto para el controlador; no abras el PR)**

Incluye en tu reporte final:
- **Migración** `20261012120000_ruta_diaria.sql`: la empuja a `sinmex dev` quien mergea. Pre-flight de solo lectura
  contra la nube (debe dar 0) para la unicidad nueva:
  `select vendedor_id, fecha, cliente_id, count(*) from ruta where deleted_at is null and tipo = 'diaria' group by
  1, 2, 3 having count(*) > 1;`
- **Contrato** aditivo, `CONTRATO_ACTUAL` sigue en 1: colección `rutas`, tipo `ruta-alta`, tres códigos.
- **Fuera de alcance** (spec): visita sin venta y fotos del servidor (pieza 3), geocodificación, gastos, firma,
  inventario y merma, mapa y GPS (T-41), ruta semanal (T-36), efectividad (T-46), subir el orden del vendedor.

---

## Modelo sugerido por tarea

| Tarea | Qué | Implementador | Revisor |
|---|---|---|---|
| 1 | Migración `ruta_diaria` + pgTAP + tipos | `haiku` | `sonnet` |
| 2 | Contrato en los dos lados + `docs/` | `haiku` | `sonnet` |
| 3 | Pull `rutas()` + e2e | `sonnet` | `sonnet` |
| 4 | Proyección `ruta-alta` (forma, servicio, cableado, buzón, e2e) | **`opus`** | **`opus`** |
| 5 | Endpoints del portal (`planearReemplazo`, candado, e2e) | `sonnet` | **`opus`** |
| 6 | Tablet: migración 011 + repositorio con la regla de fusión | `sonnet` | **`opus`** |
| 7 | Tablet: la ruta en pull, push y contador | `sonnet` | `sonnet` |
| 8 | Tablet: funciones puras de pantalla | `haiku` | `sonnet` |
| 9 | Tablet: pantalla principal con arrastre y menú | **`opus`** | `sonnet` |
| 10 | Tablet: "Agregar a mi ruta", ficha, purga | `sonnet` | `sonnet` |
| 11 | Portal: Ruta Diaria | `sonnet` | `sonnet` |
| 12 | Documentación, verificación y aceptación manual | `sonnet` | controlador |

`haiku` donde el plan trae el código completo y la tarea es transcribir; `sonnet` donde hay que integrar varios
archivos; `opus` en la proyección del servidor (transacción, rechazos sin fila, candado compartido con el portal),
en la revisión de los dos lugares donde un error pierde datos en silencio (el reemplazo del portal y la fusión de
la tablet) y en la pantalla con arrastre.

---

## Autorrevisión del plan (hecha al escribirlo)

**Cobertura del spec:**
- D1 (la oficina arma la ruta) → Tareas 5 y 11. D2 (reordenar y agregar, no quitar lo de la oficina) → 5
  (`planearReemplazo` conserva lo del vendedor), 6 (`agregar`; `quitarRechazada` solo altas propias rechazadas), 9
  (sin quitar en la lista), 11 (`quitarFila`). D3 (sin ruta) → 8 (`textoAvisoSinRuta`), 9 (estado "Sin ruta"), 11
  (`armadaPorElVendedor`). D4 (altas suben, orden local) → 6 (`ruta_orden_local`), 7 (`fuente-rutas` sin orden), 2
  (docs). D5 (visitado derivado) → 6 (`delDia`), 8 (`agruparRuta`). D6 (Refrescar = sincronizar) → 9. D7 (solo
  clientes existentes) → 4 (prospecto = `cliente-inexistente`), 5 (400), 6 (`agregar`), 8 (`filtrarParaAgregar`).
  D8 (foto local) → 10 (`fotoLocalDe`). D9 (hoja modal) → 9 (`MenuHoja`). D10 (arrastre sin librería + respaldo) →
  8 (`indiceDestino`, `moverElemento`), 9 (`ListaRuta`, ▲/▼, `ARRASTRE_HABILITADO`). D11 → 1. D12 → 2, 3. D13 → 2,
  4, 7 (`ruta-duplicada` = sincronizada). D14 → 5. D15 → 6, 7. D16 → 8, 9, 10. D17 → 11.
- "Errores al vendedor": sin red → 9 (mensaje del motor, la lista no cambia); `cliente-inexistente` /
  `ruta-datos-invalidos` → 6 (`error` + motivo) y 9 (texto rojo + Quitar); `ruta-duplicada` oculto → 7.
- Pruebas que pide el spec: pgTAP (1); unitarias del servicio (4) y del reemplazo (5); e2e de pull y push (3, 4) y
  `rutas-diarias.e2e-spec.ts` (5); tablet: los seis casos de la tabla de fusión, orden combinado, `agregar` (prospecto,
  inactivo, repetido, día cerrado), `reordenar` transaccional, visitado por venta y por cobro, burbuja antes y
  después de cobrar, `purgar` (6), `fuente-rutas` con `ruta-duplicada` y el contador (7); portal: `lib/rutas` y los
  componentes de lista y reorden (11). Aceptación manual → 12.

**Placeholders:** ninguno. Los dos rellenos de la Tarea 2 (`case 'ruta-alta'` sin proyección y `rutas: []`) son
código real que compila, con el paso exacto que los sustituye (Tarea 3 Paso 4, Tarea 4 Paso 15).

**Consistencia de nombres:** backend — `RutaPull`, `DatosRutaAlta`, `RespuestaPull.rutas`, `normalizarDatosRutaAlta`
→ `RutaAltaNormalizada { clienteId }`, `RutaRechazada`/`RazonRechazoRuta`, `prepararRutaAlta`,
`CODIGO_POR_RAZON_RUTA`, `RutasDiariasRepository` (`clienteParaRuta`, `bloquearVendedor`, `siguienteOrden`,
`insertarSiNoExiste`, `vendedorDeRuta`, `filasDelDia`, `filasVivas`, `clientesParaRuta`, `aplicarReemplazo`,
`fechaAnteriorConRuta`, `clientesValidosDeFecha`), `RutasDiariasService` (`agregarAlDia`, `obtenerDiaria`,
`reemplazarDiaria`, `anterior`), `planearReemplazo`/`FilaViva`/`PlanReemplazo`, `RutaDiaria`, `RutaAnterior`.
Tablet — `crearRepositorioRutas(deps, { catalogos })`, `RepositorioRutas`, `aplicarSnapshotRutas`, `FilaRutaPull`,
`FilaRutaDelDia`, `ContextoAltaRuta`, `ErrorRuta`, `restarDias`, `fuenteRutas`, `CODIGO_RUTA_DUPLICADA`,
`agruparRuta`, `entradasMenu`, `ListaRuta`, `MenuHoja`. Portal — `obtenerRutaDiaria`, `guardarRutaDiaria`,
`obtenerRutaAnterior`, `FilaEditable`, `CarteraRuta`, `ListaRutaDiaria`, `PantallaRutaDiaria`, `AVISO_CAMBIOS`.
Usados igual en todas las tareas.

**Review Focus:** las cinco entradas tienen prueba en su tarea dueña: 1 → Tareas 6 y 7; 2 → Tarea 4; 3 → Tarea 6;
4 → Tarea 5; 5 → Tarea 4.

---

## Conflictos para el controlador

Ninguno cambia D1…D17. Son premisas del spec que el código no sostiene tal cual, y cómo se resolvieron:

1. **Forma de los endpoints del portal en snake_case (D14) frente a la regla del repo (camelCase).** El spec
   escribe `vendedor_id`, `cliente_id`, `cliente_nombre` en `GET/PUT /rutas/diaria`; todo el portal (`lib/*.ts`) y
   los DTOs del backend usan camelCase (`clienteId`, `vendedorId`), y las restricciones de T-38 lo dicen. El plan
   usa **camelCase** en la API del portal (`?vendedorId=&fecha=`, `{ vendedorId, fecha, clientes }`, filas con
   `clienteId`/`clienteNombre`) y deja snake_case solo en el contrato de sincronización. Si Mario lo quiere como
   el spec, es renombrar campos en el DTO, el servicio, `lib/rutas.ts` y los dos e2e.
2. **`catalogos.aplicarSnapshot` no existe**: el método es `guardarSnapshot`. Y la ruta **no** usa el `upsert`
   genérico con `COLUMNAS.ruta` como sugiere el spec: la regla de fusión necesita borrar por `(fecha, cliente)` antes
   de cada fila viva y saltarse las de clientes que la tablet no tiene, así que `rutas.ts` exporta
   `aplicarSnapshotRutas(bd, filas, ahora)` y `guardarSnapshot` la llama después de `cliente`.
3. **El buzón perdía el cliente del alta.** `guardarOperacion` escribía `{ ...op.datos, cliente_id: op.clienteId }`
   y, como D13 pone el cliente en `datos` y no en el sobre, `sync_operacion.datos.cliente_id` quedaba `null`. La
   Tarea 4 lo cambia a `op.clienteId ?? op.datos.cliente_id ?? null` (sin efecto en venta/cobranza, que llevan el del
   sobre). Review Focus 5.
4. **`rutas.delDia` devuelve también las filas con `activo = 0`.** El spec dice "filas vivas" en `delDia` pero
   también que una baja "se queda en la tabla con la bandera y la pantalla decide", y "Fuera de ruta" necesita esas
   filas. Quien decide es `agruparRuta` (Tarea 8).
5. **"Ver foto" (D8) no tiene llave.** El servidor le da al cliente otro id que el del prospecto local, así que la
   tablet no sabe qué prospecto suyo es un cliente. `prospectos.fotoLocalDe` lo reconoce por nombre normalizado +
   teléfono; si no coincide, el botón no aparece. La solución de fondo (el servidor dice si hay foto y la sirve) es la
   pieza 3.
6. **404 y no 403 para un vendedor fuera de alcance**: el helper del repo (`exigirAlcanceSobre`) responde 403; el
   servicio escribe la comprobación a mano para cumplir D14.
7. **Candado no previsto en el spec**: el alta (`agregarAlDia`) y el `PUT` bloquean la fila del vendedor
   (`for no key update`). Sin él, un `PUT` y un alta simultáneos para el mismo cliente terminan en `23505` (500) o en
   dos filas con el mismo orden.
8. **Firmas ajustadas**: `crearRepositorioRutas(deps, { catalogos })` (necesita `generarId` para el uuid y `catalogos`
   para leer al cliente y publicar el cambio que repinta la pantalla) y `agregar(clienteId, { vendedorId, sucursalId
   }, fecha?)` (el candado de jornada necesita al vendedor, y la regla "de la sucursal", la sucursal). El servicio se
   llama `RutasDiariasService` (archivo `rutas-diarias.service.ts`), no `RutasService`: el módulo ya tiene
   `JornadasService` y `VehiculosService`.
9. **El `PUT` también rechaza prospectos** (400), además de clientes de otra sucursal: mismo criterio que el alta de
   la tablet (D7). El spec solo nombra "de la sucursal del vendedor".
10. **"Cerrar sesión"** no está en las entradas del menú del spec; vive al pie de la hoja modal, con la confirmación
    de siempre. "Prospectos capturados" sigue habilitado con el día cerrado (es consulta; el alta ya lo bloquea el
    candado de T-38); con el día cerrado se deshabilitan Gastos, Inventario y Merma.
11. La tabla de fusión del spec tiene **seis** filas aunque el texto dice "los cinco casos": la Tarea 6 prueba las seis.

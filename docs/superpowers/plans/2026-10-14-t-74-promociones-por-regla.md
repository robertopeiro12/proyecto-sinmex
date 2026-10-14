# T-74 · Promociones por regla — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la oficina defina promociones por regla ("por la compra de N piezas de X se regalan M de Y", para
un cliente, para todos los clientes de una sucursal o para prospectos en su primera venta), que bajen a la tablet
en el pull, que la pantalla de venta calcule los regalos y el vendedor solo pueda quitarlos, y que cada nota suba
con qué promoción regaló qué.

**Architecture:** una tabla `promocion` con la regla genérica (D1) y otra `venta_nota_promocion` con la
trazabilidad por nota y la frase congelada (D12) sustituyen al enum `cliente.promocion` y a
`cliente_promocion_producto`, que se eliminan con una guardia que impide perder datos (D10). El contrato gana la
colección `promociones` del pull, `primera_venta_en` en el cliente y `regalos` opcional en la venta (D13, D14,
D17). La regla de aplicación (D5, D6, D7, D16) vive **solo en la tablet**, en funciones puras de
`src/datos/promociones-reglas.ts`; el servidor valida la forma de `regalos` y guarda. El portal estrena la zona
*Operación › Promociones* y el formulario de cliente cambia su bloque de promoción por la lista de las suyas (D9
deja libre la venta del portal). La frase en lenguaje llano se calcula con la misma función pura, copiada a
propósito en backend, tablet y portal (como los límites de la venta).

**Tech Stack:** NestJS 11 + Kysely 0.29 (backend), Postgres/Supabase local + pgTAP (base), Expo SDK 57 / React
Native 0.86 + SQLite + Jest con ts-jest en Node (tablet, solo TypeScript; sin pruebas de pantalla), Next.js 15 +
Vitest + Testing Library (portal).

**Spec:** `docs/superpowers/specs/2026-10-14-t-74-promociones-por-regla-design.md` — léelo antes de empezar. Sus
decisiones D1…D20 **no se renegocian**. Si este plan lo contradice, manda el spec: para y pregunta. Lo que el
planificador encontró en el código que choca con el spec, y cómo se resolvió, está al final en *Conflictos para el
controlador*.

---

## Global Constraints

Copiadas del spec (§ "Restricciones globales"), más las del repo y las de esta sesión. Cada tarea las incluye:

- Rama `feature/t-74-promociones`. Todos los comandos **desde la raíz del worktree**
  (`/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-t74`), con los scripts del workspace
  (`--workspace=apps/...`). **Nunca** entres a `../proyecto-sinmex` (clon de demo).
- Código en español, **identificadores sin acentos**, **mensajes al usuario con acentos**. Comentarios que
  explican *por qué*.
- Las respuestas de la API del **portal** van en **camelCase** (`compraTipo`, `clienteNombre`), como todo
  `apps/portal/src/lib/*.ts`. El **contrato de sincronización** sigue en snake_case (`compra_tipo`,
  `cliente_id`), como el resto del cable de la tablet.
- Contrato aditivo **salvo D17** (`promocion` sale de `ClientePull`): `CONTRATO_ACTUAL` se queda en **1**; los dos
  `contrato.ts` (`apps/backend/src/modules/sincronizacion/contrato.ts` y
  `apps/tablet/src/sincronizacion/contrato.ts`) y `docs/contrato-sincronizacion.md` cambian **en la misma tarea**
  (Tarea 2; la Tarea 1 adelanta solo el `ClientePull` del backend porque la migración lo obliga a compilar).
- ADR-0009: **una transacción por operación**; una rechazada **no deja fila** (ni buzón ni negocio);
  trazabilidad por `sync_operacion.entidad_tabla` / `entidad_id`.
- `fecha_operacion` la manda la tablet; **el servidor no la re-deriva de UTC**.
- Nada de `db reset`. Migración de Postgres **`20261014130000_promociones.sql`** y migración local **012** nuevas;
  nunca se renumera ni se edita una publicada.
- Supabase local es **compartido entre sesiones**: `npm run supabase -- migration up --local` (siempre con
  `--`). pgTAP: `npm run supabase -- test db --local`. Tipos: `npm run db:types --workspace=apps/backend`, y
  comprobar que `schema.d.ts` cambia **solo** por lo de esta rama.
- **Nunca apuntar a `sinmex dev`** (la nube). `.env.test` va a `127.0.0.1:54322`. El push de la migración a la
  nube lo hace quien mergea (Roberto), con el pre-flight de `CLAUDE.md` **y el de D10** (`select count(*) from
  cliente where promocion <> 'ninguna'; select count(*) from cliente_promocion_producto;` → 0 y 0).
- `npm run typecheck`, `lint` y `test` de backend, tablet y portal en verde; `npm run test:e2e
  --workspace=apps/backend` contra el Postgres local.
- Backend: `npm run lint --workspace=apps/backend` lleva `--fix` y reescribe archivos ajenos. **No lo uses.**
  Formatea solo tus archivos y revisa sin arreglar:
  `npm exec --workspace=apps/backend -- prettier --write <archivos relativos a apps/backend>` y
  `npm exec --workspace=apps/backend -- eslint <los mismos archivos>`. El "typecheck" del backend es
  `npm run build --workspace=apps/backend`; el del portal, `npm exec --workspace=apps/portal -- tsc --noEmit`.
- Las pruebas de la tablet corren en Node con la base en memoria (`src/**/*.spec.ts`); **no hay pruebas de
  pantalla**: la lógica de pantalla va a funciones puras. Las pantallas se verifican con `typecheck`, `lint` y
  `npm run export --workspace=apps/tablet` (bundle de Metro).
- **Los conteos de pruebas se miden contra la línea base al inicio de cada tarea; no se escriben aquí.**
- **Los implementadores no despachan subagentes, no empujan, no mergean** (ni `git push`, ni `gh pr`).
- Flakiness de e2e que ya existía antes de tu tarea: se reporta como `DONE_WITH_CONCERNS`, no se reintenta a
  ciegas ni se arregla dentro de otra tarea.
- Un commit por tarea, mensaje en español con prefijo `T-74:`, y termina con la línea exacta
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (aunque tu harness sugiera otro modelo).

## Review Focus

Entradas que el spec implica pero que ninguna prueba que el spec pide ejercita, y que un vendedor o un
administrador real van a producir. Cada una tiene su prueba en la tarea dueña del código:

1. **Una cantidad ilegible en la captura** (`NaN` porque el vendedor pegó "1.5") no puede volverse una compra de
   0 piezas que apaga el regalo en silencio ni una que lo dispara: `calcularRegalos` trata `NaN` como 0 **y**
   `problemasDeCaptura` sigue señalando la fila. Prueba: Tarea 7, "una cantidad NaN cuenta como 0 y no revienta".
2. **Un regalo cuya presentación ya no está en el catálogo local** (la oficina desactivó la presentación después de
   crear la promoción) → el regalo **se omite**, la venta se puede grabar y nada truena por una llave que no
   existe. Prueba: Tarea 7, "un regalo a una presentación que no está en el catálogo se omite".
3. **Una venta local anterior a esta versión** (piezas de promoción escritas a mano, sin filas en
   `venta_promocion`) sube **sin** `regalos` y el servidor la acepta como antes: `fuente-ventas` omite la clave
   cuando no hay filas y `normalizarDatosVenta` no exige `regalos`. Pruebas: Tarea 8, "una venta sin regalos no
   manda la clave"; Tarea 5, "sin `regalos` la venta entra como antes".
4. **La oficina desactiva una promoción con la que ya se vendió** → la nota conserva su frase y sus filas
   (`venta_nota_promocion` no se toca; `promocion.deleted_at` nunca se usa para borrar). Prueba: Tarea 3, e2e
   "desactivar no borra la fila ni toca las notas"; Tarea 5, e2e "los regalos guardan la frase que mandó la
   tablet".
5. **Dos promociones generales regalan a la misma presentación** (una "por cada 10 Jawa, 1 Jawa" y una "por cada
   20 piezas de lo que sea, 1 Jawa 600 ml") → la línea suma los dos regalos y el servidor acepta porque la suma por
   presentación cuadra con `cantidad_promocion`. Pruebas: Tarea 7, "dos promociones a la misma presentación se
   suman"; Tarea 5, unit "varios regalos a la misma presentación cuadran si suman".

Fuera del spec y **sin** manejar a propósito (se anotan, no se implementan): un cliente que cambia de sucursal
después de tener promociones propias (quedan en la sucursal vieja hasta que la oficina las recree); una promoción
de prospecto en una tablet que no ha sincronizado desde que otra tablet le vendió al mismo prospecto (ventana
aceptada en D14).

## Línea base (la corre el implementador de la Tarea 1 ANTES de tocar nada)

Anota en tu reporte el resultado de cada comando (pasan / fallan, y cuántas pruebas). Las tareas siguientes
comparan contra esto. **No** los escribas en el plan.

```bash
git status                                   # limpio, rama feature/t-74-promociones
docker context ls                            # cuál daemon está activo (Colima o Docker Desktop)
npm run supabase -- status                   # el stack local tiene que estar arriba (NO lo reinicies)
npm run supabase -- migration list --local   # TODAS las de main aplicadas (la última: 20261014120000)
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
| `supabase/migrations/20261014130000_promociones.sql` | 1 | Crear: guardia D10, `promocion`, `venta_nota_promocion`, `cliente.primera_venta_en`, drops, permiso |
| `supabase/tests/99_promocion_test.sql` | 1 | Crear: pgTAP de los `check` |
| `apps/backend/src/database/schema.d.ts` | 1 | Generado |
| `apps/backend/src/modules/cartera-clientes/{clientes.repository,clientes.service}.ts`, `dto/{crear,editar}-cliente.dto.ts` | 1 | Fuera `promocion` y `productosPromocion`; entra `primeraVentaEn` en el detalle |
| `apps/backend/src/modules/cartera-clientes/reconciliar-promocion-productos.ts` (+ `.spec.ts`) | 1 | **Se eliminan** |
| `apps/backend/src/modules/sincronizacion/{contrato,sincronizacion.repository}.ts` | 1 | `ClientePull`: fuera `promocion`, entra `primera_venta_en` |
| `apps/backend/test/*.e2e-spec.ts` que siembran `cliente` con `promocion` | 1 | Quitar el campo de las semillas |
| `apps/backend/src/modules/sincronizacion/contrato.ts` | 2 | `PromocionPull`, `RespuestaPull.promociones`, `RegaloVenta`, `DatosVenta.regalos` |
| `apps/tablet/src/sincronizacion/contrato.ts` | 2 | Lo mismo (con `promociones?` opcional) + el cambio de `ClientePull` |
| `docs/contrato-sincronizacion.md` | 2 | §5 `promociones` y cliente; §6 `regalos` |
| `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts` | 2, 4 | `promociones: []` (T2) → `repo.promociones(...)` (T4) |
| `apps/backend/src/modules/cartera-clientes/promociones-texto.ts` (+ `.spec.ts`) | 3 | Crear: `textoPromocion` (pura) |
| `apps/backend/src/modules/cartera-clientes/reglas-promocion.ts` (+ `.spec.ts`) | 3 | Crear: `problemaDeRegla`, `coincidenEnProducto` (puras) |
| `apps/backend/src/modules/cartera-clientes/dto/promocion.dto.ts` | 3 | Crear: DTOs |
| `apps/backend/src/modules/cartera-clientes/promociones.{repository,service,controller}.ts` | 3 | Crear: CRUD con alcance |
| `apps/backend/src/modules/cartera-clientes/cartera-clientes.module.ts` | 3 | Registra el controlador y los providers |
| `apps/backend/test/promociones.e2e-spec.ts` | 3 | Crear: e2e del portal |
| `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts` | 4 | `promociones(sucursalId, desde)` |
| `apps/backend/test/promociones-sync.e2e-spec.ts` | 4, 5 | Crear: e2e del pull (T4) y del push con regalos (T5) |
| `apps/backend/src/modules/ventas-cobranza/datos-venta.ts` (+ `.spec.ts`) | 5 | `regalos` en la forma de la venta |
| `apps/backend/src/modules/ventas-cobranza/{ventas.repository,ventas.service,venta-portal}.ts` | 5 | `insertarRegalos`, `marcarPrimeraVenta`; `regalos: []` del portal |
| `apps/backend/src/modules/ventas-cobranza/{ventas-edicion.repository,ventas-edicion.service}.ts` | 5 | `borrarRegalos` al editar (D15) |
| `apps/tablet/src/datos/migraciones/012-promociones.ts` (+ `.spec.ts`), `index.ts` | 6 | Crear y registrar la 012 |
| `apps/tablet/src/datos/tipos.ts` | 6 | `Promocion`, `VentaPromocion`; `Cliente` sin `promocion`, con `primera_venta_en` |
| `apps/tablet/src/datos/repositorios/catalogos.ts` (+ `.spec.ts`), `pruebas-apoyo.ts` | 6 | `promociones` en el snapshot; columnas del cliente |
| `apps/tablet/src/sincronizacion/motor.ts` (+ `.spec.ts`) | 6 | `aSnapshot` pasa `promociones` |
| `apps/tablet/src/datos/promociones-reglas.ts` (+ `.spec.ts`) | 7 | Crear: texto, cobertura, aplicables, cálculo y aplicación de regalos (puras) |
| `apps/tablet/src/datos/repositorios/promociones.ts` (+ `.spec.ts`) | 8 | Crear: `catalogo()`, `aplicablesPara(clienteId)` |
| `apps/tablet/src/datos/repositorios/ventas.ts` (+ `.spec.ts`) | 8 | `regalos` al grabar, `regalosDe`, `hayAlgunaDe` |
| `apps/tablet/src/datos/ventas-reglas.ts` (+ `.spec.ts`) | 8 | Sin promoción manual; `problemasDeRegalos` |
| `apps/tablet/src/sincronizacion/fuente-ventas.ts` (+ `.spec.ts`) | 8 | Manda `regalos` cuando hay |
| `apps/tablet/src/datos/{inicializar,index}.ts` | 8 | `promociones` en `CapaDatos`; exportaciones |
| `apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx` | 9 | Tarjeta "Promociones" |
| `apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx` | 9 | Captura sin campo de promoción; regalos calculados |
| `apps/portal/src/lib/promociones.ts` (+ `.test.ts`) | 10 | Crear: tipos, llamadas, `textoPromocion`, `problemaDeRegla` |
| `apps/portal/src/components/promociones/{formulario-promocion,pantalla-promociones}.tsx` (+ pruebas) | 11 | Crear: la zona nueva |
| `apps/portal/src/app/(portal)/operacion/promociones/page.tsx`, `components/layout/nav-config.ts` | 11 | Página y entrada del menú |
| `apps/portal/src/components/usuarios/matriz-permisos-usuario.tsx` | 11 | Descripción del permiso |
| `apps/portal/src/components/clientes/promociones-de-cliente.tsx` (+ `.test.tsx`) | 12 | Crear: bloque del formulario de cliente |
| `apps/portal/src/components/clientes/{formulario-cliente,pantalla-clientes}.tsx` (+ pruebas), `lib/clientes.ts` | 12 | Fuera el enum; entra el bloque |
| `CLAUDE.md`, `apps/tablet/README.md`, `docs/contrato-sincronizacion.md` | 13 | Documentación de cierre |

**Por qué este orden.** La migración elimina columnas que el backend lee, así que la Tarea 1 lleva junta la
migración y la limpieza del modelo viejo (compila al terminar). La 2 fija los tipos del cable en los dos lados y
deja el pull respondiendo `promociones: []` para que la 4 solo tenga que llenar la consulta. La 3 (CRUD) y la 5
(push) son independientes entre sí; la 5 va después de la 3 porque su e2e crea promociones por la API. En la
tablet, la 6 crea tabla y snapshot, la 7 las reglas puras, la 8 los repositorios y el push, y la 9 las pantallas
cuando todo lo que leen ya tiene pruebas. El portal (10, 11, 12) solo depende del backend de la 3 y de la 1.

---

### Tarea 1: Migración `promociones`, pgTAP, tipos y adiós al modelo viejo del cliente (D10, D12, D14, D19)

**Files:**
- Create: `supabase/migrations/20261014130000_promociones.sql`
- Create: `supabase/tests/99_promocion_test.sql`
- Generated: `apps/backend/src/database/schema.d.ts`
- Delete: `apps/backend/src/modules/cartera-clientes/reconciliar-promocion-productos.ts`,
  `apps/backend/src/modules/cartera-clientes/reconciliar-promocion-productos.spec.ts`
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.repository.ts`,
  `apps/backend/src/modules/cartera-clientes/clientes.service.ts`,
  `apps/backend/src/modules/cartera-clientes/dto/crear-cliente.dto.ts`,
  `apps/backend/src/modules/cartera-clientes/dto/editar-cliente.dto.ts`,
  `apps/backend/src/modules/sincronizacion/contrato.ts` (solo `ClientePull`),
  `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts` (solo `clientes()`),
  y todo `apps/backend/test/*.e2e-spec.ts` o `src/**/*.spec.ts` que siembre `cliente` con `promocion` /
  `productosPromocion` (hoy: `clientes.e2e-spec.ts`, `sincronizacion.e2e-spec.ts`, `ventas.e2e-spec.ts`,
  `ventas-editar.e2e-spec.ts`, `cuentas-por-cobrar.e2e-spec.ts`, `reporte-ventas.e2e-spec.ts`; comprueba con
  `grep -rn "promocion" apps/backend/test apps/backend/src --include='*.ts' | grep -v cantidad_promocion |
  grep -v cantidadPromocion`).

**Interfaces:**
- Produces: tablas `promocion` y `venta_nota_promocion`, columna `cliente.primera_venta_en timestamptz`; en
  `ClientePull` **desaparece** `promocion` y **aparece** `primera_venta_en: string | null`; en `ClienteDetalle`
  del backend desaparecen `promocion` y `productosPromocion` y aparece `primeraVentaEn: string | null`.
- Consumes: nada de otras tareas.

- [ ] **Paso 1: Línea base** — corre la lista de arriba y anótala en tu reporte.

- [ ] **Paso 2: La migración**, exactamente este SQL:

```sql
-- T-74: promociones por regla (spec 2026-10-14, D1, D10, D12, D14, D19).
--
-- Sustituye al enum `cliente.promocion` (10+1 / 20+1) y a `cliente_promocion_producto`
-- por una tabla de reglas. No hay migracion de datos: medido el 2026-10-14,
-- cero clientes con promocion capturada en la nube y en local. La guardia de
-- abajo convierte "en blanco" en una decision explicita: si algun dia hay
-- datos, la migracion se niega y alguien los recaptura en Promociones.

do $$
begin
  if exists (select 1 from cliente where promocion <> 'ninguna')
     or exists (select 1 from cliente_promocion_producto) then
    raise exception 'T-74: hay promociones capturadas con el modelo viejo; recapturalas en Promociones antes de migrar';
  end if;
end $$;

create table promocion (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sucursal_id uuid not null references sucursal(id),
  activo boolean not null default true,
  audiencia text not null check (audiencia in ('todos','cliente','prospecto')),
  cliente_id uuid references cliente(id),
  compra_tipo text not null check (compra_tipo in ('cualquiera','producto','presentacion')),
  compra_producto_id uuid references producto(id),
  compra_presentacion_id uuid references presentacion(id),
  compra_cantidad integer not null check (compra_cantidad >= 0),
  regalo_tipo text not null check (regalo_tipo in ('mismo','producto','presentacion')),
  regalo_producto_id uuid references producto(id),
  regalo_presentacion_id uuid references presentacion(id),
  regalo_cantidad integer not null check (regalo_cantidad >= 1),
  se_repite boolean not null default true,
  constraint ck_promocion_audiencia check (
    (audiencia = 'cliente') = (cliente_id is not null)),
  constraint ck_promocion_compra check (
    (compra_tipo = 'cualquiera' and compra_producto_id is null and compra_presentacion_id is null) or
    (compra_tipo = 'producto' and compra_producto_id is not null and compra_presentacion_id is null) or
    (compra_tipo = 'presentacion' and compra_presentacion_id is not null and compra_producto_id is null)),
  constraint ck_promocion_regalo check (
    (regalo_tipo = 'mismo' and regalo_producto_id is null and regalo_presentacion_id is null and compra_tipo <> 'cualquiera') or
    (regalo_tipo = 'producto' and regalo_producto_id is not null and regalo_presentacion_id is null) or
    (regalo_tipo = 'presentacion' and regalo_presentacion_id is not null and regalo_producto_id is null)),
  -- Comprar 0 solo tiene sentido en el regalo de bienvenida al prospecto (D7).
  constraint ck_promocion_compra_cero check (compra_cantidad > 0 or audiencia = 'prospecto')
);
create trigger trg_promocion_updated before update on promocion
  for each row execute function set_updated_at();
create index idx_promocion_sucursal on promocion (sucursal_id) where deleted_at is null;
create index idx_promocion_cliente on promocion (cliente_id) where deleted_at is null and cliente_id is not null;

-- Trazabilidad por nota (D12). Sin `deleted_at`: cuando la oficina edita la
-- nota, las filas se BORRAN (D15); nunca se tocan por otra via.
create table venta_nota_promocion (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  venta_nota_id uuid not null references venta_nota(id),
  promocion_id uuid references promocion(id),          -- nulo si llego un id desconocido (D13)
  presentacion_id uuid not null references presentacion(id),
  cantidad integer not null check (cantidad >= 1),
  promocion_texto text not null                         -- la frase, congelada al vender
);
create index idx_venta_nota_promocion_nota on venta_nota_promocion (venta_nota_id);

-- D14: lo fija el servidor al proyectar la primera nota viva del cliente.
alter table cliente add column primera_venta_en timestamptz;
update cliente c set primera_venta_en = v.primera
  from (select cliente_id, min(created_at) as primera
          from venta_nota where deleted_at is null group by cliente_id) v
  where v.cliente_id = c.id;

drop table cliente_promocion_producto;
alter table cliente drop column promocion;

-- D19: el permiso ya sembrado cambia de descripcion; el consumo llegara con T-27.
update permiso set descripcion = 'Promociones: crear, editar y desactivar'
  where clave = 'promocion.gestionar';
```

- [ ] **Paso 3: Aplícala y regenera los tipos**

```bash
npm run supabase -- migration up --local
npm run db:types --workspace=apps/backend
git diff --stat apps/backend/src/database/schema.d.ts   # Promocion, VentaNotaPromocion, Cliente.primera_venta_en; fuera ClientePromocionProducto y Cliente.promocion
```

- [ ] **Paso 4: pgTAP** — `supabase/tests/99_promocion_test.sql`:

```sql
begin;
select plan(14);

-- T-74: lo que la BASE garantiza de una promocion aunque alguien escriba por
-- debajo del servicio. Prefijo `zz-pgtap-t74`.

insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-T74 Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));

create temporary table _t74 on commit drop as
select
  (select id from sucursal where codigo = 'TJ') as sucursal,
  (select id from cliente where nombre = 'ZZ-pgtap-T74 Cliente') as cliente,
  (select id from producto order by nombre limit 1) as producto,
  (select id from presentacion order by volumen limit 1) as presentacion;

select has_table('promocion', 'existe la tabla de reglas (D1)');
select has_table('venta_nota_promocion', 'existe la trazabilidad por nota (D12)');
select has_column('cliente', 'primera_venta_en', 'el cliente sabe cuando tuvo su primera nota (D14)');
select hasnt_column('cliente', 'promocion', 'el enum viejo se fue (D10)');
select hasnt_table('cliente_promocion_producto', 'la lista vieja de productos se fue (D10)');

select lives_ok(
  $$insert into promocion (sucursal_id, audiencia, compra_tipo, compra_producto_id, compra_cantidad, regalo_tipo, regalo_cantidad)
    select sucursal, 'todos', 'producto', producto, 10, 'mismo', 1 from _t74$$,
  'por cada 10 de un producto, 1 del mismo: entra');

select throws_ok(
  $$insert into promocion (sucursal_id, audiencia, compra_tipo, compra_cantidad, regalo_tipo, regalo_cantidad)
    select sucursal, 'todos', 'cualquiera', 10, 'mismo', 1 from _t74$$,
  '23514', null, '"del mismo" no cabe con "cualquier producto" (ck_promocion_regalo)');

select throws_ok(
  $$insert into promocion (sucursal_id, audiencia, compra_tipo, compra_producto_id, compra_cantidad, regalo_tipo, regalo_cantidad)
    select sucursal, 'todos', 'producto', producto, 0, 'mismo', 1 from _t74$$,
  '23514', null, 'comprar 0 solo vale para prospectos (ck_promocion_compra_cero)');

select lives_ok(
  $$insert into promocion (sucursal_id, audiencia, compra_tipo, compra_cantidad, regalo_tipo, regalo_presentacion_id, regalo_cantidad)
    select sucursal, 'prospecto', 'cualquiera', 0, 'presentacion', presentacion, 2 from _t74$$,
  'bienvenida al prospecto sin compra: entra (D7)');

select throws_ok(
  $$insert into promocion (sucursal_id, audiencia, compra_tipo, compra_cantidad, regalo_tipo, regalo_presentacion_id, regalo_cantidad)
    select sucursal, 'cliente', 'cualquiera', 1, 'presentacion', presentacion, 1 from _t74$$,
  '23514', null, 'audiencia cliente exige cliente_id (ck_promocion_audiencia)');

select throws_ok(
  $$insert into promocion (sucursal_id, audiencia, cliente_id, compra_tipo, compra_cantidad, regalo_tipo, regalo_presentacion_id, regalo_cantidad)
    select sucursal, 'todos', cliente, 'cualquiera', 1, 'presentacion', presentacion, 1 from _t74$$,
  '23514', null, 'audiencia todos no admite cliente_id (ck_promocion_audiencia)');

select throws_ok(
  $$insert into promocion (sucursal_id, audiencia, compra_tipo, compra_producto_id, compra_presentacion_id, compra_cantidad, regalo_tipo, regalo_cantidad)
    select sucursal, 'todos', 'producto', producto, presentacion, 1, 'mismo', 1 from _t74$$,
  '23514', null, 'compra por producto no lleva presentacion (ck_promocion_compra)');

select throws_ok(
  $$insert into promocion (sucursal_id, audiencia, compra_tipo, compra_producto_id, compra_cantidad, regalo_tipo, regalo_cantidad)
    select sucursal, 'todos', 'producto', producto, 1, 'mismo', 0 from _t74$$,
  '23514', null, 'se regala al menos 1 pieza');

select throws_ok(
  $$insert into venta_nota_promocion (venta_nota_id, presentacion_id, cantidad, promocion_texto)
    select gen_random_uuid(), presentacion, 0, 'x' from _t74$$,
  '23514', null, 'una fila de trazabilidad lleva al menos 1 pieza');

select * from finish();
rollback;
```

Si la base local no tiene `producto` o `presentacion` (semillas), el `select ... limit 1` da `null` y los
`lives_ok` fallan por `not null`: siembra uno con prefijo `zz-pgtap-t74` al principio y bórralo con el
`rollback` (ya lo hace). Ajusta `plan(N)` si cambias el número de aserciones.

- [ ] **Paso 5: Corre pgTAP**: `npm run supabase -- test db --local`. Esperado: en verde, con el archivo nuevo.

- [ ] **Paso 6: El backend compila otra vez.** En `cartera-clientes`:
  - Borra `reconciliar-promocion-productos.ts` y su spec.
  - `clientes.repository.ts`: quita el tipo `Promocion`, los campos `promocion` y `productosPromocion` de
    `ClienteDetalle`/`ClienteResumen` (si lo tiene) y de `aDetalle`/`obtener`, la lectura de
    `cliente_promocion_producto`, los parámetros `productosPromocion`/`planPromocion` de `crear` y
    `actualizar` y sus inserts/updates. Añade `primeraVentaEn: string | null` a `ClienteDetalle`, leído de
    `cliente.primera_venta_en` (como ISO: `fila.primera_venta_en?.toISOString() ?? null` si el driver da
    `Date`; comprueba cómo devuelve `pg` los `timestamptz` en este repo mirando `fotoSubidaEn`).
  - `clientes.service.ts`: fuera el `import` y las dos llamadas a `reconciliarPromocionProductos`, y los
    campos `promocion` de los objetos que pasan a `crear`/`actualizar`.
  - DTOs: fuera `promocion` y `productosPromocion` (y sus decoradores) de `CrearClienteDto` y
    `EditarClienteDto`.
  - `sincronizacion/contrato.ts` → `ClientePull`: sustituye la línea `promocion: 'ninguna' | '10+1' | '20+1';` por

```ts
  /**
   * T-74 (D14): cuando el servidor proyecto la primera nota viva de este
   * cliente (ISO), o `null` si nunca le han vendido. La tablet lo usa para la
   * promocion de prospecto, que solo aplica en su primera venta.
   *
   * > `promocion` ('ninguna' | '10+1' | '20+1') se QUITO aqui sin subir el
   * > contrato (D17): mismo criterio que `domicilio` arriba. Las promociones
   * > ahora bajan en la coleccion `promociones` (Tarea 2).
   */
  primera_venta_en: string | null;
```

  - `sincronizacion.repository.ts` → `clientes()`: en el `select`, `'promocion'` → `'primera_venta_en'`; en el
    `map` final, `promocion: f.promocion as ...` → `primera_venta_en: f.primera_venta_en ? new
    Date(f.primera_venta_en).toISOString() : null`.
  - Semillas de los e2e y specs: quita `promocion: 'ninguna'` (o `'10+1'`) y `productosPromocion: []` de cada
    `insertInto('cliente').values({...})` y de cada cuerpo de `POST/PATCH /clientes`; en `clientes.e2e-spec.ts`
    borra las pruebas que eran **solo** de la promoción vieja (asignar productos, "gana la última", etc.) y
    deja las que prueban otra cosa quitándoles el campo. Ninguna prueba nueva aquí: la cobertura del modelo
    nuevo llega en la Tarea 3.

- [ ] **Paso 7: Verifica**

```bash
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm exec --workspace=apps/backend -- prettier --write <tus archivos> && npm exec --workspace=apps/backend -- eslint <tus archivos>
```

Esperado: todo en verde; el conteo de unit baja por el spec borrado y el de e2e por las pruebas del enum.

- [ ] **Paso 8: Commit**

```bash
git add supabase/migrations/20261014130000_promociones.sql supabase/tests/99_promocion_test.sql apps/backend
git commit -m "T-74: migración promociones + pgTAP; fuera el enum de promoción del cliente, entra primera_venta_en

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 2: Contrato — `PromocionPull`, `promociones`, `regalos` y el cliente, en los dos lados y en `docs/` (D13, D14, D17)

**Files:**
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts`
- Modify: `apps/tablet/src/sincronizacion/contrato.ts`
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts` (`promociones: []`)
- Modify: `docs/contrato-sincronizacion.md`

**Interfaces:**
- Produces (idénticos en los dos `contrato.ts`): `AudienciaPromocion`, `CompraPromocion`, `RegaloPromocion`,
  `PromocionPull`, `RegaloVenta`, `DatosVenta.regalos?: RegaloVenta[]`, `RespuestaPull.promociones:
  PromocionPull[]` (en la tablet, `promociones?: PromocionPull[]`).
- Consumes: el `ClientePull` del backend ya cambiado en la Tarea 1.

- [ ] **Paso 1: Tipos nuevos en el backend**, debajo de `RutaPull`:

```ts
/* ------------------------------------------------------------------ */
/* T-74: promociones por regla                                         */
/* ------------------------------------------------------------------ */

export type AudienciaPromocion = 'todos' | 'cliente' | 'prospecto';
export type CompraPromocion = 'cualquiera' | 'producto' | 'presentacion';
export type RegaloPromocion = 'mismo' | 'producto' | 'presentacion';

/**
 * Una regla de promocion (T-74, D1): por la compra de `compra_cantidad` piezas
 * del objetivo de `compra_*` se regalan `regalo_cantidad` piezas del objetivo
 * de `regalo_*`. La regla de APLICACION vive en la tablet
 * (`src/datos/promociones-reglas.ts`); el servidor solo la transporta.
 *
 * - `audiencia`: `todos` (los clientes de la sucursal), `cliente` (uno:
 *   `cliente_id`) o `prospecto` (solo en la primera venta del prospecto, D7).
 * - `compra_cantidad` puede ser 0 solo con `prospecto` (regalo sin compra).
 * - `regalo_tipo = 'mismo'` nunca viene con `compra_tipo = 'cualquiera'`.
 * - `activo: 0` = desactivada o dada de baja: la tablet la conserva (una venta
 *   local puede referenciarla) pero no la aplica.
 */
export interface PromocionPull extends FilaSincronizable {
  audiencia: AudienciaPromocion;
  cliente_id: string | null;
  compra_tipo: CompraPromocion;
  compra_producto_id: string | null;
  compra_presentacion_id: string | null;
  compra_cantidad: number;
  regalo_tipo: RegaloPromocion;
  regalo_producto_id: string | null;
  regalo_presentacion_id: string | null;
  regalo_cantidad: number;
  se_repite: boolean;
}

/**
 * Un regalo de una venta (T-74, D12): que promocion dio cuantas piezas de que
 * presentacion. `texto` es la frase de la promocion tal como la vio el
 * vendedor; el servidor la congela en la nota aunque la oficina edite la
 * promocion despues.
 */
export type RegaloVenta = {
  promocion_id: string;
  presentacion_id: string;
  cantidad: number;
  texto: string;
};
```

  En `DatosVenta`, después de `lineas: LineaVenta[];`:

```ts
  /**
   * T-74 (D13). Opcional y aditivo: ausente en una tablet anterior y en la
   * venta del portal (D9). Si viene, por cada presentacion la suma de
   * `cantidad` de sus regalos tiene que ser igual a `cantidad_promocion` de la
   * linea; si no cuadra es `datos-invalidos`. El servidor NO rechaza por la
   * regla de negocio: las piezas ya se entregaron en la calle.
   */
  regalos?: RegaloVenta[];
```

  En `RespuestaPull`, después de `rutas: RutaPull[];`:

```ts
  /**
   * T-74. Las promociones de la sucursal del vendedor: las de `todos` y
   * `prospecto`, mas las de `cliente` de los clientes de esa sucursal (ver
   * {@link PromocionPull}). Aditiva: una tablet vieja la ignora.
   */
  promociones: PromocionPull[];
```

- [ ] **Paso 2: Lo mismo en la tablet** (`apps/tablet/src/sincronizacion/contrato.ts`): los tres `type`, la
  interfaz `PromocionPull`, `RegaloVenta`, `regalos?` en `DatosVenta`, y en `RespuestaPull` **opcional**:

```ts
  /**
   * T-74. Opcional: un servidor anterior a este ticket no la manda y la tablet
   * trabaja sin promociones (la ficha dice "Sin promoción").
   */
  promociones?: PromocionPull[];
```

  Y en el `ClientePull` de la tablet el **mismo cambio** que hizo la Tarea 1 en el backend: fuera
  `promocion`, entra `primera_venta_en: string | null` con el mismo comentario. (La tablet dejará de compilar
  hasta la Tarea 6, que quita `promocion` de `tipos.ts`; es esperado: la Tarea 2 no corre `typecheck` de la
  tablet. Anótalo en el reporte.)

- [ ] **Paso 3: El pull compila**: en `sincronizacion.service.ts`, en el objeto que devuelve `pull`, después de
  `rutas,` añade `promociones: [], // T-74: la consulta llega en la Tarea 4`.

- [ ] **Paso 4: `docs/contrato-sincronizacion.md`**:
  - En §5, después de la sección de `rutas`, una sección `### \`promociones\`: las reglas de regalo (T-74)`
    que diga: colección nueva de nivel superior, aditiva; qué filas bajan (sucursal del vendedor: `todos`,
    `prospecto` y las de `cliente` de esa sucursal); incremental por `updated_at > desde`; desactivada o
    borrada = `activo: 0` y la tablet la conserva; la regla de aplicación vive en la tablet (D5, D6, D7, D16 en
    una lista corta); y el bloque de ejemplo JSON de una fila.
  - En la sección `### \`domicilio\` puede venir \`null\`…` o justo después, un apartado
    `### \`primera_venta_en\` sustituye a \`promocion\` en el cliente (T-74)` con la justificación de D17 (no
    sube el contrato por el mismo motivo que `domicilio`).
  - En §6, dentro de `### \`datos\` de una venta (T-16)`, un apartado `#### \`regalos\` (T-74)` con el
    ejemplo y las reglas de forma: opcional; `promocion_id` y `presentacion_id` uuid; `cantidad >= 1`; `texto`
    de 1 a 200; la presentación tiene que estar en `lineas`; la suma por presentación = `cantidad_promocion`;
    un `promocion_id` desconocido **no** rechaza (se guarda con `promocion_id` nulo y el texto); el servidor
    marca `cliente.primera_venta_en` al proyectar la primera nota del cliente.

- [ ] **Paso 5: Verifica** `npm run build --workspace=apps/backend` y `npm test --workspace=apps/backend` en
  verde.

- [ ] **Paso 6: Commit**

```bash
git add apps/backend/src/modules/sincronizacion/contrato.ts apps/backend/src/modules/sincronizacion/sincronizacion.service.ts apps/tablet/src/sincronizacion/contrato.ts docs/contrato-sincronizacion.md
git commit -m "T-74: contrato — PromocionPull, promociones en el pull, regalos en la venta y primera_venta_en del cliente

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 3: Backend — la frase, las reglas puras y el CRUD de promociones del portal (D1–D5, D8, D19, D20)

**Files:**
- Create: `apps/backend/src/modules/cartera-clientes/promociones-texto.ts` (+ `.spec.ts`)
- Create: `apps/backend/src/modules/cartera-clientes/reglas-promocion.ts` (+ `.spec.ts`)
- Create: `apps/backend/src/modules/cartera-clientes/dto/promocion.dto.ts`
- Create: `apps/backend/src/modules/cartera-clientes/promociones.repository.ts`
- Create: `apps/backend/src/modules/cartera-clientes/promociones.service.ts`
- Create: `apps/backend/src/modules/cartera-clientes/promociones.controller.ts`
- Modify: `apps/backend/src/modules/cartera-clientes/cartera-clientes.module.ts`
- Create: `apps/backend/test/promociones.e2e-spec.ts`

**Interfaces:**
- Consumes: tablas de la Tarea 1; `resolverAlcance`, `normalizarSucursalPedida`, `buscarSucursalUsuario`,
  `RequierePermiso`, `UsuarioActual` (ya existen).
- Produces: `GET /promociones?sucursal=&clienteId=`, `POST /promociones`, `PATCH /promociones/:id`, todos con
  `promocion.gestionar`; la forma `Promocion` (camelCase) que copia el portal en la Tarea 10; `textoPromocion`
  y `problemaDeRegla` que la tablet (Tarea 7) y el portal (Tarea 10) **duplican** con las mismas pruebas.

- [ ] **Paso 1: Prueba de la frase** — `promociones-texto.spec.ts`:

```ts
import { textoPromocion } from './promociones-texto';

const nombres = { compra: 'Jawa', regalo: 'Horchata 1 L' };

describe('textoPromocion (T-74)', () => {
  it('por cada N de un producto, M del mismo, se repite', () => {
    expect(
      textoPromocion(
        { audiencia: 'todos', compraTipo: 'producto', compraCantidad: 10, regaloTipo: 'mismo', regaloCantidad: 1, seRepite: true },
        { compra: 'Jawa', regalo: null },
      ),
    ).toBe('Por cada 10 Jawa, 1 Jawa gratis');
  });

  it('al comprar N de una presentacion, M de la misma, una vez', () => {
    expect(
      textoPromocion(
        { audiencia: 'cliente', compraTipo: 'presentacion', compraCantidad: 10, regaloTipo: 'mismo', regaloCantidad: 1, seRepite: false },
        { compra: 'Jawa 600 ml', regalo: null },
      ),
    ).toBe('Al comprar 10 Jawa 600 ml, 1 Jawa 600 ml gratis (una vez)');
  });

  it('por cada N piezas de lo que sea, M de una presentacion', () => {
    expect(
      textoPromocion(
        { audiencia: 'todos', compraTipo: 'cualquiera', compraCantidad: 20, regaloTipo: 'presentacion', regaloCantidad: 1, seRepite: true },
        { compra: null, regalo: 'Jawa 1 L' },
      ),
    ).toBe('Por cada 20 piezas de lo que sea, 1 Jawa 1 L gratis');
  });

  it('por cada pieza (singular), M de un producto', () => {
    expect(
      textoPromocion(
        { audiencia: 'todos', compraTipo: 'cualquiera', compraCantidad: 1, regaloTipo: 'producto', regaloCantidad: 1, seRepite: true },
        { compra: null, regalo: 'Horchata' },
      ),
    ).toBe('Por cada pieza, 1 Horchata gratis');
  });

  it('bienvenida al prospecto sin compra', () => {
    expect(
      textoPromocion(
        { audiencia: 'prospecto', compraTipo: 'cualquiera', compraCantidad: 0, regaloTipo: 'presentacion', regaloCantidad: 2, seRepite: false },
        { compra: null, regalo: 'Jawa 600 ml' },
      ),
    ).toBe('Bienvenida al prospecto: 2 Jawa 600 ml gratis en su primera venta');
  });

  it('bienvenida al prospecto con compra', () => {
    expect(
      textoPromocion(
        { audiencia: 'prospecto', compraTipo: 'producto', compraCantidad: 5, regaloTipo: 'mismo', regaloCantidad: 1, seRepite: false },
        { compra: 'Jawa', regalo: null },
      ),
    ).toBe('Bienvenida al prospecto: al comprar 5 Jawa, 1 Jawa gratis en su primera venta');
  });

  it('sin nombre resuelto no revienta: deja un hueco visible', () => {
    expect(
      textoPromocion(
        { audiencia: 'todos', compraTipo: 'producto', compraCantidad: 10, regaloTipo: 'mismo', regaloCantidad: 1, seRepite: true },
        { compra: null, regalo: null },
      ),
    ).toBe('Por cada 10 (producto), 1 (producto) gratis');
  });

  void nombres;
});
```

- [ ] **Paso 2: Corre** `npm test --workspace=apps/backend -- promociones-texto` → falla (módulo inexistente).

- [ ] **Paso 3: `promociones-texto.ts`**

```ts
import type {
  AudienciaPromocion,
  CompraPromocion,
  RegaloPromocion,
} from '../sincronizacion/contrato';

/** La regla, ya en camelCase (como la devuelve la API del portal). */
export interface ReglaPromocion {
  audiencia: AudienciaPromocion;
  compraTipo: CompraPromocion;
  compraCantidad: number;
  regaloTipo: RegaloPromocion;
  regaloCantidad: number;
  seRepite: boolean;
}

/**
 * Los nombres ya resueltos: el del producto, o "producto volumen" de la
 * presentacion. `null` cuando no aplica (compra `cualquiera`, regalo `mismo`)
 * o cuando no se pudo resolver.
 */
export interface NombresPromocion {
  compra: string | null;
  regalo: string | null;
}

/**
 * La frase que ven la oficina y el vendedor, y la que se congela en la nota
 * (T-74, D11, D12). Una sola forma de decirlo en los tres lados: esta funcion
 * esta DUPLICADA a proposito en la tablet (`src/datos/promociones-reglas.ts`) y
 * en el portal (`lib/promociones.ts`), con las mismas pruebas, porque ninguno de
 * los dos puede importar del backend.
 *
 * - Se repite: "Por cada N X, M Y gratis". Una vez: "Al comprar N X, M Y gratis (una vez)".
 * - Compra `cualquiera`: "pieza" si N = 1, "N piezas de lo que sea" si no.
 * - Regalo `mismo`: el nombre de la compra.
 * - Prospecto: prefijo "Bienvenida al prospecto:" y sufijo "en su primera venta";
 *   con compra 0 no hay compra que nombrar.
 */
export function textoPromocion(regla: ReglaPromocion, nombres: NombresPromocion): string {
  const hueco = '(producto)';
  const compra =
    regla.compraTipo === 'cualquiera'
      ? regla.compraCantidad === 1
        ? 'pieza'
        : `${regla.compraCantidad} piezas de lo que sea`
      : `${regla.compraCantidad} ${nombres.compra ?? hueco}`;
  const regalo = `${regla.regaloCantidad} ${
    regla.regaloTipo === 'mismo' ? (nombres.compra ?? hueco) : (nombres.regalo ?? hueco)
  } gratis`;

  if (regla.audiencia === 'prospecto') {
    if (regla.compraCantidad === 0) {
      return `Bienvenida al prospecto: ${regalo} en su primera venta`;
    }
    return `Bienvenida al prospecto: al comprar ${compra}, ${regalo} en su primera venta`;
  }
  return regla.seRepite
    ? `Por cada ${compra}, ${regalo}`
    : `Al comprar ${compra}, ${regalo} (una vez)`;
}
```

- [ ] **Paso 4: Prueba de las reglas puras** — `reglas-promocion.spec.ts`:

```ts
import { coincidenEnProducto, problemaDeRegla, type ReglaCompleta } from './reglas-promocion';

const base: ReglaCompleta = {
  audiencia: 'todos',
  clienteId: null,
  compraTipo: 'producto',
  compraProductoId: 'p1',
  compraPresentacionId: null,
  compraCantidad: 10,
  regaloTipo: 'mismo',
  regaloProductoId: null,
  regaloPresentacionId: null,
  regaloCantidad: 1,
  seRepite: true,
};

describe('problemaDeRegla (T-74)', () => {
  it('una regla bien formada no tiene problema', () => {
    expect(problemaDeRegla(base)).toBeNull();
  });
  it('del mismo no cabe con cualquier producto', () => {
    expect(
      problemaDeRegla({ ...base, compraTipo: 'cualquiera', compraProductoId: null }),
    ).toBe('Si la compra es de cualquier producto, el regalo tiene que ser un producto o una presentación concretos.');
  });
  it('compra por producto exige el producto y no la presentacion', () => {
    expect(problemaDeRegla({ ...base, compraProductoId: null })).toBe('Elige el producto que se compra.');
    expect(problemaDeRegla({ ...base, compraPresentacionId: 'x' })).toBe('Elige el producto que se compra.');
  });
  it('compra por presentacion exige la presentacion', () => {
    expect(
      problemaDeRegla({ ...base, compraTipo: 'presentacion', compraProductoId: null }),
    ).toBe('Elige la presentación que se compra.');
  });
  it('regalo por producto / presentacion exige su id', () => {
    expect(problemaDeRegla({ ...base, regaloTipo: 'producto' })).toBe('Elige el producto que se regala.');
    expect(problemaDeRegla({ ...base, regaloTipo: 'presentacion' })).toBe('Elige la presentación que se regala.');
  });
  it('comprar 0 solo vale para prospectos', () => {
    expect(problemaDeRegla({ ...base, compraCantidad: 0 })).toBe(
      'La cantidad de compra debe ser al menos 1; solo la promoción de prospectos puede regalar sin compra.',
    );
    expect(
      problemaDeRegla({ ...base, audiencia: 'prospecto', compraCantidad: 0, compraTipo: 'cualquiera', compraProductoId: null, regaloTipo: 'producto', regaloProductoId: 'p2' }),
    ).toBeNull();
  });
  it('se regala al menos una pieza, enteras', () => {
    expect(problemaDeRegla({ ...base, regaloCantidad: 0 })).toBe('Se regala al menos 1 pieza.');
    expect(problemaDeRegla({ ...base, regaloCantidad: 1.5 })).toBe('Se regala al menos 1 pieza.');
  });
  it('audiencia cliente exige el cliente, y las demas no lo admiten', () => {
    expect(problemaDeRegla({ ...base, audiencia: 'cliente' })).toBe('Elige el cliente de la promoción.');
    expect(problemaDeRegla({ ...base, clienteId: 'c1' })).toBe('Solo una promoción de un cliente lleva cliente.');
  });
});

describe('coincidenEnProducto (D5)', () => {
  it('cualquiera coincide con todo', () => {
    expect(coincidenEnProducto('todos', new Set(['p1']))).toBe(true);
    expect(coincidenEnProducto(new Set(['p1']), 'todos')).toBe(true);
  });
  it('dos conjuntos coinciden si comparten un producto', () => {
    expect(coincidenEnProducto(new Set(['p1']), new Set(['p1']))).toBe(true);
    expect(coincidenEnProducto(new Set(['p1']), new Set(['p2']))).toBe(false);
  });
});
```

- [ ] **Paso 5: `reglas-promocion.ts`**

```ts
import type { AudienciaPromocion, CompraPromocion, RegaloPromocion } from '../sincronizacion/contrato';

/** La regla completa, como la manda el portal (DTO plano) o la guarda la base. */
export interface ReglaCompleta {
  audiencia: AudienciaPromocion;
  clienteId: string | null;
  compraTipo: CompraPromocion;
  compraProductoId: string | null;
  compraPresentacionId: string | null;
  compraCantidad: number;
  regaloTipo: RegaloPromocion;
  regaloProductoId: string | null;
  regaloPresentacionId: string | null;
  regaloCantidad: number;
  seRepite: boolean;
}

/** Los productos que cubre un objetivo: todos (`cualquiera`) o un conjunto de ids. */
export type Cobertura = 'todos' | ReadonlySet<string>;

/**
 * Lo que impide guardar la regla, en el espanol de la oficina, o `null`.
 * Espejo de los `check` de la migracion (ck_promocion_*), con mensaje: el 23514
 * de Postgres seria un 500 que nadie entiende. Duplicada en el portal
 * (`lib/promociones.ts`) para validar en vivo.
 */
export function problemaDeRegla(r: ReglaCompleta): string | null {
  if (r.audiencia === 'cliente' && !r.clienteId) return 'Elige el cliente de la promoción.';
  if (r.audiencia !== 'cliente' && r.clienteId) return 'Solo una promoción de un cliente lleva cliente.';

  if (r.compraTipo === 'cualquiera' && (r.compraProductoId || r.compraPresentacionId)) {
    return 'Una compra de cualquier producto no lleva producto ni presentación.';
  }
  if (r.compraTipo === 'producto' && (!r.compraProductoId || r.compraPresentacionId)) {
    return 'Elige el producto que se compra.';
  }
  if (r.compraTipo === 'presentacion' && (!r.compraPresentacionId || r.compraProductoId)) {
    return 'Elige la presentación que se compra.';
  }

  if (r.regaloTipo === 'mismo') {
    if (r.compraTipo === 'cualquiera') {
      return 'Si la compra es de cualquier producto, el regalo tiene que ser un producto o una presentación concretos.';
    }
    if (r.regaloProductoId || r.regaloPresentacionId) return 'Un regalo "del mismo" no lleva producto ni presentación.';
  }
  if (r.regaloTipo === 'producto' && (!r.regaloProductoId || r.regaloPresentacionId)) {
    return 'Elige el producto que se regala.';
  }
  if (r.regaloTipo === 'presentacion' && (!r.regaloPresentacionId || r.regaloProductoId)) {
    return 'Elige la presentación que se regala.';
  }

  if (!Number.isInteger(r.compraCantidad) || r.compraCantidad < 0) return 'La cantidad de compra son piezas enteras.';
  if (r.compraCantidad === 0 && r.audiencia !== 'prospecto') {
    return 'La cantidad de compra debe ser al menos 1; solo la promoción de prospectos puede regalar sin compra.';
  }
  if (!Number.isInteger(r.regaloCantidad) || r.regaloCantidad < 1) return 'Se regala al menos 1 pieza.';
  return null;
}

/** D5: una propia desplaza a una general si coinciden en al menos un producto. */
export function coincidenEnProducto(a: Cobertura, b: Cobertura): boolean {
  if (a === 'todos' || b === 'todos') return true;
  for (const p of a) if (b.has(p)) return true;
  return false;
}
```

- [ ] **Paso 6: Corre** las dos specs → pasan.

- [ ] **Paso 7: DTOs** — `dto/promocion.dto.ts`. Plano a propósito (ver *Conflictos*, punto 2):

```ts
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const AUDIENCIAS = ['todos', 'cliente', 'prospecto'] as const;
const COMPRAS = ['cualquiera', 'producto', 'presentacion'] as const;
const REGALOS = ['mismo', 'producto', 'presentacion'] as const;
/** `integer` de Postgres. */
const MAX_PIEZAS = 2_147_483_647;

/** `POST /promociones` (T-74). La coherencia entre campos la decide `problemaDeRegla`. */
export class CrearPromocionDto {
  /**
   * uuid de la sucursal, o `'todas'` (solo un General: crea una por sucursal).
   * Se ignora con `audiencia = 'cliente'` (manda la del cliente) y para un
   * usuario atado a una sucursal (manda la suya).
   */
  @IsOptional()
  @ValidateIf((o: CrearPromocionDto) => o.sucursalId !== 'todas')
  @IsUUID(undefined, { message: 'Elige la sucursal.' })
  sucursalId?: string;

  @IsIn(AUDIENCIAS, { message: 'Elige para quién es la promoción.' })
  audiencia!: (typeof AUDIENCIAS)[number];

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige el cliente de la promoción.' })
  clienteId?: string;

  @IsIn(COMPRAS, { message: 'Elige qué se compra.' })
  compraTipo!: (typeof COMPRAS)[number];

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige el producto que se compra.' })
  compraProductoId?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige la presentación que se compra.' })
  compraPresentacionId?: string;

  @IsInt({ message: 'La cantidad de compra son piezas enteras.' })
  @Min(0)
  @Max(MAX_PIEZAS)
  compraCantidad!: number;

  @IsIn(REGALOS, { message: 'Elige qué se regala.' })
  regaloTipo!: (typeof REGALOS)[number];

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige el producto que se regala.' })
  regaloProductoId?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige la presentación que se regala.' })
  regaloPresentacionId?: string;

  @IsInt({ message: 'Se regala al menos 1 pieza.' })
  @Min(1, { message: 'Se regala al menos 1 pieza.' })
  @Max(MAX_PIEZAS)
  regaloCantidad!: number;

  @IsBoolean()
  seRepite!: boolean;
}

/**
 * `PATCH /promociones/:id`: la regla completa otra vez (el formulario manda el
 * estado entero) mas `activo`. Para cambiar de audiencia, cliente o sucursal
 * se crea otra: esos tres no se editan.
 */
export class EditarPromocionDto {
  @IsIn(COMPRAS, { message: 'Elige qué se compra.' })
  compraTipo!: (typeof COMPRAS)[number];

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige el producto que se compra.' })
  compraProductoId?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige la presentación que se compra.' })
  compraPresentacionId?: string;

  @IsInt({ message: 'La cantidad de compra son piezas enteras.' })
  @Min(0)
  @Max(MAX_PIEZAS)
  compraCantidad!: number;

  @IsIn(REGALOS, { message: 'Elige qué se regala.' })
  regaloTipo!: (typeof REGALOS)[number];

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige el producto que se regala.' })
  regaloProductoId?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige la presentación que se regala.' })
  regaloPresentacionId?: string;

  @IsInt({ message: 'Se regala al menos 1 pieza.' })
  @Min(1, { message: 'Se regala al menos 1 pieza.' })
  @Max(MAX_PIEZAS)
  regaloCantidad!: number;

  @IsBoolean()
  seRepite!: boolean;

  @IsBoolean()
  activo!: boolean;
}
```

- [ ] **Paso 8: Repositorio** — `promociones.repository.ts`. Lo que devuelve a la API:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import type {
  AudienciaPromocion,
  CompraPromocion,
  RegaloPromocion,
} from '../sincronizacion/contrato';
import { buscarSucursalUsuario as buscarSucursalUsuarioCompartido } from '../sucursales/buscar-sucursal-usuario';
import type { ReglaCompleta } from './reglas-promocion';

/** Una promocion como la pinta el portal (camelCase). `texto` lo pone el servicio. */
export interface Promocion extends ReglaCompleta {
  id: string;
  sucursalId: string;
  sucursalCodigo: string;
  activo: boolean;
  clienteNombre: string | null;
  /** Nombre del producto, o "producto volumen"; `null` si no aplica. */
  compraNombre: string | null;
  regaloNombre: string | null;
  /** Producto que cubre la compra (el de la presentacion si es por presentacion); `null` = cualquiera. */
  compraProductoCubierto: string | null;
  texto: string;
  /** Solo en `GET ?clienteId=`: una general que una propia del cliente desplaza (D5). */
  desplazada?: boolean;
}

/** Fila lista para escribir. */
export interface NuevaPromocion extends ReglaCompleta {
  sucursalId: string;
}

type FilaPromocion = {
  id: string;
  sucursal_id: string;
  sucursal_codigo: string;
  activo: boolean;
  audiencia: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  compra_tipo: string;
  compra_producto_id: string | null;
  compra_presentacion_id: string | null;
  compra_cantidad: number;
  regalo_tipo: string;
  regalo_producto_id: string | null;
  regalo_presentacion_id: string | null;
  regalo_cantidad: number;
  se_repite: boolean;
  compra_producto_nombre: string | null;
  compra_pres_producto_nombre: string | null;
  compra_pres_volumen: string | null;
  compra_pres_producto_id: string | null;
  regalo_producto_nombre: string | null;
  regalo_pres_producto_nombre: string | null;
  regalo_pres_volumen: string | null;
};

function aPromocion(f: FilaPromocion): Omit<Promocion, 'texto'> {
  const compraNombre =
    f.compra_tipo === 'producto'
      ? f.compra_producto_nombre
      : f.compra_tipo === 'presentacion'
        ? `${f.compra_pres_producto_nombre ?? ''} ${f.compra_pres_volumen ?? ''}`.trim()
        : null;
  const regaloNombre =
    f.regalo_tipo === 'producto'
      ? f.regalo_producto_nombre
      : f.regalo_tipo === 'presentacion'
        ? `${f.regalo_pres_producto_nombre ?? ''} ${f.regalo_pres_volumen ?? ''}`.trim()
        : null;
  return {
    id: f.id,
    sucursalId: f.sucursal_id,
    sucursalCodigo: f.sucursal_codigo,
    activo: f.activo,
    audiencia: f.audiencia as AudienciaPromocion,
    clienteId: f.cliente_id,
    clienteNombre: f.cliente_nombre,
    compraTipo: f.compra_tipo as CompraPromocion,
    compraProductoId: f.compra_producto_id,
    compraPresentacionId: f.compra_presentacion_id,
    compraCantidad: f.compra_cantidad,
    regaloTipo: f.regalo_tipo as RegaloPromocion,
    regaloProductoId: f.regalo_producto_id,
    regaloPresentacionId: f.regalo_presentacion_id,
    regaloCantidad: f.regalo_cantidad,
    seRepite: f.se_repite,
    compraNombre,
    regaloNombre,
    compraProductoCubierto:
      f.compra_tipo === 'producto'
        ? f.compra_producto_id
        : f.compra_tipo === 'presentacion'
          ? f.compra_pres_producto_id
          : null,
  };
}

@Injectable()
export class PromocionesRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * La consulta base con los cuatro joins de nombres. Los `leftJoin` con alias
   * son necesarios porque compra y regalo pueden apuntar a productos y
   * presentaciones distintos.
   */
  private base() {
    return this.db
      .selectFrom('promocion as p')
      .innerJoin('sucursal as s', 's.id', 'p.sucursal_id')
      .leftJoin('cliente as c', 'c.id', 'p.cliente_id')
      .leftJoin('producto as cp', 'cp.id', 'p.compra_producto_id')
      .leftJoin('presentacion as cpr', 'cpr.id', 'p.compra_presentacion_id')
      .leftJoin('producto as cprp', 'cprp.id', 'cpr.producto_id')
      .leftJoin('producto as rp', 'rp.id', 'p.regalo_producto_id')
      .leftJoin('presentacion as rpr', 'rpr.id', 'p.regalo_presentacion_id')
      .leftJoin('producto as rprp', 'rprp.id', 'rpr.producto_id')
      .select([
        'p.id', 'p.sucursal_id', 's.codigo as sucursal_codigo', 'p.activo', 'p.audiencia',
        'p.cliente_id', 'c.nombre as cliente_nombre',
        'p.compra_tipo', 'p.compra_producto_id', 'p.compra_presentacion_id', 'p.compra_cantidad',
        'p.regalo_tipo', 'p.regalo_producto_id', 'p.regalo_presentacion_id', 'p.regalo_cantidad',
        'p.se_repite',
        'cp.nombre as compra_producto_nombre',
        'cprp.nombre as compra_pres_producto_nombre', 'cpr.volumen as compra_pres_volumen',
        'cpr.producto_id as compra_pres_producto_id',
        'rp.nombre as regalo_producto_nombre',
        'rprp.nombre as regalo_pres_producto_nombre', 'rpr.volumen as regalo_pres_volumen',
      ])
      .where('p.deleted_at', 'is', null);
  }

  /** Las de `todos` y `prospecto` de una sucursal (activas e inactivas: la pantalla reactiva). */
  async generales(sucursalId: string): Promise<Omit<Promocion, 'texto'>[]> {
    const filas = await this.base()
      .where('p.sucursal_id', '=', sucursalId)
      .where('p.audiencia', 'in', ['todos', 'prospecto'])
      .orderBy('p.audiencia')
      .orderBy('p.created_at')
      .execute();
    return filas.map((f) => aPromocion(f as FilaPromocion));
  }

  /** Las propias del cliente mas las de `todos` de su sucursal. */
  async deCliente(clienteId: string, sucursalId: string): Promise<Omit<Promocion, 'texto'>[]> {
    const filas = await this.base()
      .where((eb) =>
        eb.or([
          eb('p.cliente_id', '=', clienteId),
          eb.and([eb('p.sucursal_id', '=', sucursalId), eb('p.audiencia', '=', 'todos')]),
        ]),
      )
      .orderBy('p.audiencia')
      .orderBy('p.created_at')
      .execute();
    return filas.map((f) => aPromocion(f as FilaPromocion));
  }

  async buscar(id: string): Promise<Omit<Promocion, 'texto'> | undefined> {
    const fila = await this.base().where('p.id', '=', id).executeTakeFirst();
    return fila ? aPromocion(fila as FilaPromocion) : undefined;
  }

  async crear(filas: NuevaPromocion[], trx?: Transaction<DB>): Promise<string[]> {
    const q = (trx ?? this.db)
      .insertInto('promocion')
      .values(
        filas.map((n) => ({
          sucursal_id: n.sucursalId,
          audiencia: n.audiencia,
          cliente_id: n.clienteId,
          compra_tipo: n.compraTipo,
          compra_producto_id: n.compraProductoId,
          compra_presentacion_id: n.compraPresentacionId,
          compra_cantidad: n.compraCantidad,
          regalo_tipo: n.regaloTipo,
          regalo_producto_id: n.regaloProductoId,
          regalo_presentacion_id: n.regaloPresentacionId,
          regalo_cantidad: n.regaloCantidad,
          se_repite: n.seRepite,
        })),
      )
      .returning('id');
    return (await q.execute()).map((f) => f.id);
  }

  async actualizar(id: string, cambios: Omit<ReglaCompleta, 'audiencia' | 'clienteId'> & { activo: boolean }): Promise<void> {
    await this.db
      .updateTable('promocion')
      .set({
        compra_tipo: cambios.compraTipo,
        compra_producto_id: cambios.compraProductoId,
        compra_presentacion_id: cambios.compraPresentacionId,
        compra_cantidad: cambios.compraCantidad,
        regalo_tipo: cambios.regaloTipo,
        regalo_producto_id: cambios.regaloProductoId,
        regalo_presentacion_id: cambios.regaloPresentacionId,
        regalo_cantidad: cambios.regaloCantidad,
        se_repite: cambios.seRepite,
        activo: cambios.activo,
      })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
  }

  /** El cliente, si vive: su sucursal (id y codigo) para el alcance y la fila. */
  async clienteVivo(id: string): Promise<{ id: string; sucursalId: string; sucursalCodigo: string } | undefined> {
    const f = await this.db
      .selectFrom('cliente')
      .innerJoin('sucursal', 'sucursal.id', 'cliente.sucursal_id')
      .select(['cliente.id', 'cliente.sucursal_id', 'sucursal.codigo'])
      .where('cliente.id', '=', id)
      .where('cliente.deleted_at', 'is', null)
      .executeTakeFirst();
    return f ? { id: f.id, sucursalId: f.sucursal_id, sucursalCodigo: f.codigo } : undefined;
  }

  async productoVivo(id: string): Promise<boolean> {
    const f = await this.db.selectFrom('producto').select('id').where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    return f !== undefined;
  }

  async presentacionViva(id: string): Promise<boolean> {
    const f = await this.db.selectFrom('presentacion').select('id').where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    return f !== undefined;
  }

  /** Sucursales activas, todas o una por codigo. */
  async sucursalesActivas(codigo: string | null): Promise<{ id: string; codigo: string }[]> {
    let q = this.db.selectFrom('sucursal').select(['id', 'codigo']).where('activa', '=', true).where('deleted_at', 'is', null);
    if (codigo !== null) q = q.where('codigo', '=', codigo);
    return q.orderBy('codigo').execute();
  }

  buscarSucursalUsuario(usuarioId: string) {
    return buscarSucursalUsuarioCompartido(this.db, usuarioId);
  }

  enTransaccion<T>(tarea: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(tarea);
  }
}
```

  Comprueba contra `schema.d.ts` los nombres reales de columnas de `sucursal` (`activa`, `deleted_at`) y
  ajusta; si `sucursal` no tiene `deleted_at`, quita esa condición.

- [ ] **Paso 9: Servicio** — `promociones.service.ts`:

```ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { resolverAlcance, type Alcance } from '../sucursales/alcance-sucursal';
import type { CrearPromocionDto, EditarPromocionDto } from './dto/promocion.dto';
import { textoPromocion } from './promociones-texto';
import { PromocionesRepository, type Promocion } from './promociones.repository';
import { coincidenEnProducto, problemaDeRegla, type Cobertura, type ReglaCompleta } from './reglas-promocion';

export const MOTIVO_PROMOCION_INEXISTENTE = 'No existe esa promoción.';
export const MOTIVO_CLIENTE_INEXISTENTE = 'No existe ese cliente.';

function cobertura(p: Pick<Promocion, 'compraProductoCubierto'>): Cobertura {
  return p.compraProductoCubierto === null ? 'todos' : new Set([p.compraProductoCubierto]);
}

/** Promociones por regla (T-74). Toda lectura y escritura pasa por el alcance del usuario. */
@Injectable()
export class PromocionesService {
  constructor(private readonly repo: PromocionesRepository) {}

  /**
   * `GET /promociones`. Sin `clienteId`: las generales (todos + prospecto) de la
   * sucursal pedida (un General sin sucursal: 400, la pantalla siempre manda
   * una). Con `clienteId`: las propias del cliente y las de `todos` de su
   * sucursal, con `desplazada` (D5).
   */
  async listar(usuarioId: string, sucursalPedida: string | null, clienteId: string | null): Promise<Promocion[]> {
    const alcance = await this.alcanceDe(usuarioId, sucursalPedida);
    if (clienteId !== null) {
      const cliente = await this.repo.clienteVivo(clienteId);
      if (!cliente || (alcance.tipo === 'una' && alcance.codigo !== cliente.sucursalCodigo)) {
        throw new NotFoundException(MOTIVO_CLIENTE_INEXISTENTE);
      }
      const filas = (await this.repo.deCliente(cliente.id, cliente.sucursalId)).map((f) => this.conTexto(f));
      const propias = filas.filter((f) => f.audiencia === 'cliente' && f.activo);
      return filas.map((f) =>
        f.audiencia === 'todos'
          ? { ...f, desplazada: propias.some((p) => coincidenEnProducto(cobertura(p), cobertura(f))) }
          : f,
      );
    }
    if (alcance.tipo === 'todas') {
      throw new BadRequestException('Elige una sucursal para ver sus promociones.');
    }
    const [sucursal] = await this.repo.sucursalesActivas(alcance.codigo);
    if (!sucursal) throw new NotFoundException('No existe esa sucursal.');
    return (await this.repo.generales(sucursal.id)).map((f) => this.conTexto(f));
  }

  /** `POST /promociones`. Devuelve las creadas (una por sucursal con `'todas'`). */
  async crear(usuarioId: string, dto: CrearPromocionDto): Promise<Promocion[]> {
    const regla = this.aRegla(dto);
    const alcance = await this.alcanceDe(usuarioId, null);

    let sucursales: string[];
    if (regla.audiencia === 'cliente') {
      const cliente = await this.repo.clienteVivo(regla.clienteId as string);
      if (!cliente || (alcance.tipo === 'una' && alcance.codigo !== cliente.sucursalCodigo)) {
        throw new NotFoundException(MOTIVO_CLIENTE_INEXISTENTE);
      }
      sucursales = [cliente.sucursalId];
    } else if (dto.sucursalId === 'todas') {
      sucursales = (await this.repo.sucursalesActivas(alcance.tipo === 'una' ? alcance.codigo : null)).map((s) => s.id);
    } else {
      if (alcance.tipo === 'una') {
        const [propia] = await this.repo.sucursalesActivas(alcance.codigo);
        if (!propia) throw new NotFoundException('No existe esa sucursal.');
        sucursales = [propia.id];
      } else {
        if (!dto.sucursalId) throw new BadRequestException('Indica a qué sucursal pertenece la promoción.');
        sucursales = [dto.sucursalId];
      }
    }

    const ids = await this.repo.enTransaccion((trx) =>
      this.repo.crear(sucursales.map((sucursalId) => ({ ...regla, sucursalId })), trx),
    );
    return Promise.all(ids.map((id) => this.obtener(id)));
  }

  /** `PATCH /promociones/:id`: la regla completa y `activo`. Audiencia, cliente y sucursal no cambian. */
  async editar(usuarioId: string, id: string, dto: EditarPromocionDto): Promise<Promocion> {
    const actual = await this.repo.buscar(id);
    if (!actual) throw new NotFoundException(MOTIVO_PROMOCION_INEXISTENTE);
    const alcance = await this.alcanceDe(usuarioId, null);
    if (alcance.tipo === 'una' && alcance.codigo !== actual.sucursalCodigo) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }
    const regla = this.aRegla({ ...dto, audiencia: actual.audiencia, clienteId: actual.clienteId ?? undefined });
    await this.repo.actualizar(id, { ...regla, activo: dto.activo });
    return this.obtener(id);
  }

  private async obtener(id: string): Promise<Promocion> {
    const fila = await this.repo.buscar(id);
    if (!fila) throw new NotFoundException(MOTIVO_PROMOCION_INEXISTENTE);
    return this.conTexto(fila);
  }

  private conTexto(f: Omit<Promocion, 'texto'>): Promocion {
    return { ...f, texto: textoPromocion(f, { compra: f.compraNombre, regalo: f.regaloNombre }) };
  }

  /** Normaliza el DTO plano, valida la coherencia (400 con mensaje) y que los objetivos existan (404). */
  private aRegla(dto: Omit<CrearPromocionDto, 'sucursalId'>): ReglaCompleta {
    const regla: ReglaCompleta = {
      audiencia: dto.audiencia,
      clienteId: dto.clienteId ?? null,
      compraTipo: dto.compraTipo,
      compraProductoId: dto.compraProductoId ?? null,
      compraPresentacionId: dto.compraPresentacionId ?? null,
      compraCantidad: dto.compraCantidad,
      regaloTipo: dto.regaloTipo,
      regaloProductoId: dto.regaloProductoId ?? null,
      regaloPresentacionId: dto.regaloPresentacionId ?? null,
      regaloCantidad: dto.regaloCantidad,
      seRepite: dto.seRepite,
    };
    const problema = problemaDeRegla(regla);
    if (problema) throw new BadRequestException(problema);
    return regla;
  }

  /** Los productos y presentaciones de la regla tienen que existir (404 con mensaje). */
  private async exigirObjetivos(regla: ReglaCompleta): Promise<void> {
    for (const [id, que] of [
      [regla.compraProductoId, 'el producto que se compra'],
      [regla.regaloProductoId, 'el producto que se regala'],
    ] as const) {
      if (id && !(await this.repo.productoVivo(id))) throw new NotFoundException(`No existe ${que}.`);
    }
    for (const [id, que] of [
      [regla.compraPresentacionId, 'la presentación que se compra'],
      [regla.regaloPresentacionId, 'la presentación que se regala'],
    ] as const) {
      if (id && !(await this.repo.presentacionViva(id))) throw new NotFoundException(`No existe ${que}.`);
    }
  }

  private async alcanceDe(usuarioId: string, sucursalPedida: string | null): Promise<Alcance> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) throw new UnauthorizedException('Sesión inválida.');
    return resolverAlcance(fila.codigo, sucursalPedida);
  }
}
```

  Llama a `exigirObjetivos(regla)` en `crear` y en `editar` justo después de `aRegla` (está escrito aparte
  para que el 404 salga antes de abrir la transacción). Un General que crea con `sucursalId` uuid: comprueba
  que esa sucursal exista y esté activa (`sucursalesActivas(null)` la contiene) o responde 404
  `'No existe esa sucursal.'`.

- [ ] **Paso 10: Controlador** — `promociones.controller.ts`:

```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import { CrearPromocionDto, EditarPromocionDto } from './dto/promocion.dto';
import type { Promocion } from './promociones.repository';
import { PromocionesService } from './promociones.service';

// T-74 (D19). Todo con `promocion.gestionar`, lectura incluida: es una pantalla
// de una sola tarea, como Ruta Diaria. El bloque del formulario de cliente solo
// se pinta si el usuario tiene el permiso (portal, Tarea 12).
@Controller('promociones')
export class PromocionesController {
  constructor(private readonly promociones: PromocionesService) {}

  @Get()
  @RequierePermiso('promocion.gestionar')
  listar(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
    @Query('clienteId') clienteId?: string,
  ): Promise<Promocion[]> {
    return this.promociones.listar(usuarioId, normalizarSucursalPedida(sucursal), clienteId?.trim() || null);
  }

  @Post()
  @RequierePermiso('promocion.gestionar')
  crear(@UsuarioActual() usuarioId: string, @Body() dto: CrearPromocionDto): Promise<Promocion[]> {
    return this.promociones.crear(usuarioId, dto);
  }

  @Patch(':id')
  @RequierePermiso('promocion.gestionar')
  editar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarPromocionDto,
  ): Promise<Promocion> {
    return this.promociones.editar(usuarioId, id, dto);
  }
}
```

  Si `clienteId` llega y no es uuid, el servicio responderá 404 por `clienteVivo` (Postgres compararía un
  texto inválido con uuid y daría 500): valida con `RE_UUID` en el controlador y lanza `BadRequestException('El
  cliente no es válido.')`.

- [ ] **Paso 11: Módulo**: en `cartera-clientes.module.ts` añade `PromocionesController` a `controllers` y
  `PromocionesService`, `PromocionesRepository` a `providers`, con un comentario de una línea (T-74, D20).

- [ ] **Paso 12: e2e** — `apps/backend/test/promociones.e2e-spec.ts`, con la misma plomería que
  `rutas-diarias.e2e-spec.ts` (usuarios General / Tijuana / sin permiso, `SUFIJO`, siembra de clientes;
  productos y presentaciones de la semilla base: toma `(select id from producto order by nombre limit 2)` y
  una presentación de cada uno; si la base no tiene, siembra con prefijo `e2e-promo-${SUFIJO}` y borra en
  `afterAll`). Casos, cada uno un `it`:
  1. Sin permiso: `GET`, `POST`, `PATCH` → 403.
  2. General crea `audiencia: 'todos'`, `compra producto 10`, `regalo mismo 1`, `seRepite: true`,
     `sucursalId: 'todas'` → 201 con **una fila por sucursal activa**; cada una con `texto` `Por cada 10
     <producto>, 1 <producto> gratis` y `sucursalCodigo` distinto.
  3. Usuario de Tijuana crea con `sucursalId: 'todas'` → **solo** en TJ.
  4. Usuario de Tijuana crea `audiencia: 'cliente'` para un cliente de MX → 404; para uno de TJ → 201 con
     `sucursalCodigo: 'TJ'` y `clienteNombre`.
  5. 400 con mensaje: `regaloTipo: 'mismo'` + `compraTipo: 'cualquiera'`; `compraCantidad: 0` con `todos`;
     `audiencia: 'cliente'` sin `clienteId`.
  6. `audiencia: 'prospecto'`, `compraCantidad: 0`, `regalo presentacion 2` → 201 con texto `Bienvenida al
     prospecto: 2 <producto volumen> gratis en su primera venta`.
  7. 404 con mensaje si `compraProductoId` no existe.
  8. `GET ?sucursal=TJ` lista las de `todos` y `prospecto` de TJ, no las de MX; incluye las inactivas con
     `activo: false`.
  9. `GET ?clienteId=` de un cliente de TJ con una propia sobre el producto A: devuelve la propia y las
     generales de TJ, y la general sobre A viene `desplazada: true`, la general "cualquiera" **también**
     (`desplazada: true`), y una general sobre el producto B `desplazada: false`.
  10. `PATCH` cambia `compraCantidad` y `activo: false` → 200 con `activo: false` y el texto nuevo;
      `PATCH` de un usuario de MX sobre una de TJ → 403; `PATCH` de un id inexistente → 404.
  11. **Desactivar no borra la fila ni toca las notas** (Review Focus 4): tras `activo: false`, la fila sigue en
      `promocion` con `deleted_at` nulo; y una fila sembrada a mano en `venta_nota_promocion` que apunta a
      ella sigue intacta.
  12. `GET ?clienteId=` de un cliente de MX con cookie de Tijuana → 404 (no 403: no se confirma que exista).

- [ ] **Paso 13: Verifica**

```bash
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend -- promociones
npm run test:e2e --workspace=apps/backend
npm exec --workspace=apps/backend -- prettier --write <tus archivos> && npm exec --workspace=apps/backend -- eslint <tus archivos>
```

- [ ] **Paso 14: Commit**

```bash
git add apps/backend
git commit -m "T-74: promociones del portal — frase, reglas puras, CRUD con alcance y e2e

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 4: Pull — `repository.promociones(sucursalId, desde)` y su e2e (D14, D17)

**Files:**
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts`
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`
- Create: `apps/backend/test/promociones-sync.e2e-spec.ts` (la Tarea 5 lo amplía)

**Interfaces:**
- Consumes: `PromocionPull` (Tarea 2), tabla `promocion` (Tarea 1), `POST /promociones` (Tarea 3) para
  sembrar en el e2e.
- Produces: `RespuestaPull.promociones` con datos reales.

- [ ] **Paso 1: La consulta**, en `sincronizacion.repository.ts`, después de `rutas()`:

```ts
  /**
   * Las promociones que la tablet necesita (T-74): las vivas de la sucursal del
   * vendedor. Por sucursal y no por vendedor: las de `todos` y `prospecto` son
   * de la sucursal, y las de `cliente` se crean en la sucursal del cliente
   * (PromocionesService.crear), asi que un solo filtro las cubre.
   *
   * Incremental por `updated_at`. Desactivar (`activo = false`) o dar de baja
   * (`deleted_at`) viajan igual, como `activo: 0`: la tablet la conserva porque
   * una venta local puede referenciarla, pero deja de aplicarla.
   */
  async promociones(sucursalId: string, desde: Date | null): Promise<PromocionPull[]> {
    let q = this.db
      .selectFrom('promocion')
      .select([
        'id', 'audiencia', 'cliente_id',
        'compra_tipo', 'compra_producto_id', 'compra_presentacion_id', 'compra_cantidad',
        'regalo_tipo', 'regalo_producto_id', 'regalo_presentacion_id', 'regalo_cantidad',
        'se_repite', 'activo', 'deleted_at',
      ])
      .where('sucursal_id', '=', sucursalId);
    if (desde) {
      q = q.where('updated_at', '>', desde);
    } else {
      q = q.where('deleted_at', 'is', null).where('activo', '=', true);
    }
    return (await q.orderBy('created_at').execute()).map((f) => ({
      id: f.id,
      audiencia: f.audiencia as PromocionPull['audiencia'],
      cliente_id: f.cliente_id,
      compra_tipo: f.compra_tipo as PromocionPull['compra_tipo'],
      compra_producto_id: f.compra_producto_id,
      compra_presentacion_id: f.compra_presentacion_id,
      compra_cantidad: f.compra_cantidad,
      regalo_tipo: f.regalo_tipo as PromocionPull['regalo_tipo'],
      regalo_producto_id: f.regalo_producto_id,
      regalo_presentacion_id: f.regalo_presentacion_id,
      regalo_cantidad: f.regalo_cantidad,
      se_repite: f.se_repite,
      activo: bandera(f.activo, f.deleted_at),
    }));
  }
```

  Importa `PromocionPull` del contrato.

- [ ] **Paso 2: Cableado** en `sincronizacion.service.ts` → `pull`: añade `promociones` a la
  desestructuración y `this.repo.promociones(vendedor.sucursal_id, desde)` al `Promise.all` (comentario: `//
  T-74: por SUCURSAL, como los clientes.`); sustituye `promociones: []` por `promociones`.

- [ ] **Paso 3: e2e** — `apps/backend/test/promociones-sync.e2e-spec.ts`. Plomería: un vendedor de TJ con
  token (`/auth/app/login`, como `sincronizacion.e2e-spec.ts`) **y** un usuario General con cookie
  (`/auth/login`) para crear promociones por la API; una presentación de la semilla; dos clientes de TJ y uno
  de MX con prefijo `e2e-psync-${SUFIJO}`; `afterAll` borra `venta_nota_promocion`, `venta_nota_detalle`,
  `cobranza_abono`, `venta_nota`, `sync_operacion`, `promocion`, clientes, vendedor y usuario de la prueba
  (en ese orden). Casos del pull:
  1. **Vuelco completo**: tras crear por la API una de `todos` en TJ, una de `prospecto` en TJ, una propia del
     cliente 1 de TJ y una de `todos` en MX, `GET /sync/pull` sin `desde` trae **las tres de TJ** en
     `promociones` (con todos los campos del contrato, `se_repite` booleano, `activo: 1`) y **no** la de MX.
  2. **Incremental**: con el `cursor` del pull anterior, `PATCH` la de `todos` a `activo: false` → el pull con
     `desde` trae **solo esa**, con `activo: 0`.
  3. **El cliente ya no trae `promocion` y sí `primera_venta_en`**: en `catalogos.clientes` el cliente 1 viene
     con `primera_venta_en: null` y sin la clave `promocion` (`expect(c).not.toHaveProperty('promocion')`).

- [ ] **Paso 4: Verifica** `npm run build --workspace=apps/backend`, `npm run test:e2e --workspace=apps/backend
  -- promociones-sync`, después toda la e2e; prettier + eslint de tus archivos.

- [ ] **Paso 5: Commit**

```bash
git add apps/backend
git commit -m "T-74: pull — la colección promociones por sucursal, con baja como bandera, y su e2e

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 5: Push — `regalos` en la venta, trazabilidad, `primera_venta_en` y el borrado al editar (D12, D13, D14, D15)

**Files:**
- Modify: `apps/backend/src/modules/ventas-cobranza/datos-venta.ts` (+ `datos-venta.spec.ts`)
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas.repository.ts`
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas.service.ts` (+ `ventas.service.spec.ts`)
- Modify: `apps/backend/src/modules/ventas-cobranza/venta-portal.ts` (`regalos: []`)
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas-edicion.repository.ts`,
  `ventas-edicion.service.ts`
- Modify: `apps/backend/test/promociones-sync.e2e-spec.ts` (casos del push)

**Interfaces:**
- Consumes: `RegaloVenta` y `DatosVenta.regalos` (Tarea 2); tablas de la Tarea 1.
- Produces: `VentaNormalizada.regalos: RegaloNormalizado[]`; `VentasRepository.insertarRegalos`,
  `promocionesVivas`, `marcarPrimeraVenta`; `VentasEdicionRepository.borrarRegalos`.

- [ ] **Paso 1: Pruebas de la forma** — en `datos-venta.spec.ts`, un `describe('regalos (T-74)')` con los
  casos siguientes sobre `normalizarDatosVenta(clienteId, datos)` (usa los `datos` válidos que ya usa el
  archivo y añade `regalos`). Constantes: `P1` = la `presentacion_id` de la línea válida.

```ts
  const regalo = (extra: Record<string, unknown> = {}) => ({
    promocion_id: '11111111-1111-4111-8111-111111111111',
    presentacion_id: P1,
    cantidad: 2,
    texto: 'Por cada 10 Jawa, 1 Jawa gratis',
    ...extra,
  });

  it('sin regalos la venta entra como antes y regalos queda vacio', () => {
    const r = normalizarDatosVenta(CLIENTE, datosValidos());           // la linea trae cantidad_promocion 2
    expect(r.ok && r.venta.regalos).toEqual([]);
  });
  it('regalos que cuadran con cantidad_promocion entran, con ids en minusculas y texto recortado', () => {
    const r = normalizarDatosVenta(CLIENTE, { ...datosValidos(), regalos: [regalo({ texto: '  Por cada 10 Jawa, 1 Jawa gratis  ', promocion_id: '11111111-1111-4111-8111-111111111111'.toUpperCase() })] });
    expect(r.ok && r.venta.regalos).toEqual([{ promocionId: '11111111-1111-4111-8111-111111111111', presentacionId: P1, cantidad: 2, texto: 'Por cada 10 Jawa, 1 Jawa gratis' }]);
  });
  it('varios regalos a la misma presentacion cuadran si suman', () => {
    const r = normalizarDatosVenta(CLIENTE, { ...datosValidos(), regalos: [regalo({ cantidad: 1 }), regalo({ cantidad: 1, promocion_id: '22222222-2222-4222-8222-222222222222' })] });
    expect(r.ok).toBe(true);
  });
  it('si la suma por presentacion no cuadra con cantidad_promocion es invalido', () => {
    const r = normalizarDatosVenta(CLIENTE, { ...datosValidos(), regalos: [regalo({ cantidad: 1 })] });
    expect(r).toMatchObject({ ok: false, campo: 'regalos' });
  });
  it('una linea con cantidad_promocion y sin regalo es invalida cuando regalos viene', () => {
    const r = normalizarDatosVenta(CLIENTE, { ...datosValidos(), regalos: [] });
    expect(r).toMatchObject({ ok: false, campo: 'regalos' });
  });
  it('un regalo a una presentacion que no esta en las lineas es invalido', () => {
    const r = normalizarDatosVenta(CLIENTE, { ...datosValidos(), regalos: [regalo({ presentacion_id: '33333333-3333-4333-8333-333333333333' })] });
    expect(r).toMatchObject({ ok: false, campo: 'regalos[0].presentacion_id' });
  });
  it('cantidad 0, promocion_id que no es uuid y texto vacio o de mas de 200 son invalidos', () => {
    expect(normalizarDatosVenta(CLIENTE, { ...datosValidos(), regalos: [regalo({ cantidad: 0 })] })).toMatchObject({ ok: false, campo: 'regalos[0].cantidad' });
    expect(normalizarDatosVenta(CLIENTE, { ...datosValidos(), regalos: [regalo({ promocion_id: 'x' })] })).toMatchObject({ ok: false, campo: 'regalos[0].promocion_id' });
    expect(normalizarDatosVenta(CLIENTE, { ...datosValidos(), regalos: [regalo({ texto: '  ' })] })).toMatchObject({ ok: false, campo: 'regalos[0].texto' });
    expect(normalizarDatosVenta(CLIENTE, { ...datosValidos(), regalos: [regalo({ texto: 'x'.repeat(201) })] })).toMatchObject({ ok: false, campo: 'regalos[0].texto' });
  });
  it('regalos que no es lista es invalido', () => {
    expect(normalizarDatosVenta(CLIENTE, { ...datosValidos(), regalos: 'no' })).toMatchObject({ ok: false, campo: 'regalos' });
  });
```

- [ ] **Paso 2: Corre** `npm test --workspace=apps/backend -- datos-venta` → fallan los nuevos.

- [ ] **Paso 3: La forma**, en `datos-venta.ts`:
  - Tipos:

```ts
export interface RegaloNormalizado {
  promocionId: string;
  presentacionId: string;
  cantidad: number;
  texto: string;
}
export const MAX_REGALOS_VENTA = 50;
export const LARGO_MAX_TEXTO_PROMOCION = 200;
```

  y en `VentaNormalizada`: `/** T-74 (D13). Vacio si la tablet no mando regalos. */ regalos: RegaloNormalizado[];`.
  - Después del bucle de líneas y antes de `montoTotalCentavos`:

```ts
  // T-74 (D13): opcional y aditivo. Si viene, cada regalo apunta a una linea de
  // esta venta y, por presentacion, las piezas regaladas suman exactamente
  // `cantidad_promocion`: el servidor no decide si la promocion aplicaba (las
  // piezas ya se entregaron), pero si que la nota se describe a si misma.
  const regalos: RegaloNormalizado[] = [];
  const regalosCrudos = datos.regalos;
  if (regalosCrudos !== undefined && regalosCrudos !== null) {
    if (!Array.isArray(regalosCrudos)) return invalido('regalos', 'debe ser una lista.');
    if (regalosCrudos.length > MAX_REGALOS_VENTA) {
      return invalido('regalos', `no puede traer mas de ${MAX_REGALOS_VENTA} regalos.`);
    }
    for (const [indice, crudo] of (regalosCrudos as unknown[]).entries()) {
      const campo = `regalos[${indice}]`;
      if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) {
        return invalido(campo, 'debe ser un objeto.');
      }
      const r = crudo as Record<string, unknown>;
      if (typeof r.promocion_id !== 'string' || !RE_UUID.test(r.promocion_id)) {
        return invalido(`${campo}.promocion_id`, 'debe ser el identificador de una promocion.');
      }
      if (typeof r.presentacion_id !== 'string' || !presentacionesVistas.has(r.presentacion_id.toLowerCase())) {
        return invalido(`${campo}.presentacion_id`, 'debe ser una presentacion de las lineas de esta venta.');
      }
      const cantidad = enteroEnRango(r.cantidad, MAX_ENTERO_POSTGRES);
      if (cantidad === null || cantidad < 1) {
        return invalido(`${campo}.cantidad`, 'debe ser un entero de piezas mayor que 0.');
      }
      const texto = typeof r.texto === 'string' ? r.texto.trim() : '';
      if (texto.length === 0 || texto.length > LARGO_MAX_TEXTO_PROMOCION) {
        return invalido(`${campo}.texto`, `debe ser la frase de la promocion, de 1 a ${LARGO_MAX_TEXTO_PROMOCION} caracteres.`);
      }
      regalos.push({
        promocionId: r.promocion_id.toLowerCase(),
        presentacionId: r.presentacion_id.toLowerCase(),
        cantidad,
        texto,
      });
    }
    const regaladas = new Map<string, number>();
    for (const r of regalos) regaladas.set(r.presentacionId, (regaladas.get(r.presentacionId) ?? 0) + r.cantidad);
    for (const l of lineas) {
      if ((regaladas.get(l.presentacionId) ?? 0) !== l.cantidadPromocion) {
        return invalido('regalos', `las piezas regaladas de la presentacion ${l.presentacionId} no cuadran con cantidad_promocion.`);
      }
    }
  }
```

  y en el retorno `venta: { ..., lineas, regalos }`. En `venta-portal.ts`, donde arma la `VentaNormalizada`,
  añade `regalos: []` (D9: el portal no lleva trazabilidad).

- [ ] **Paso 4: Corre** las specs de `datos-venta` → pasan; `npm run build --workspace=apps/backend` → te
  dirá dónde más falta `regalos` (specs de `ventas.service`, `despacho`, `edicion-venta`…): añade `regalos: []`
  a los objetos literales de prueba.

- [ ] **Paso 5: Repositorio de ventas** — en `ventas.repository.ts`:

```ts
export interface NuevoRegaloVenta {
  /** `null` si la promocion no existe en el servidor (D13). */
  promocionId: string | null;
  presentacionId: string;
  cantidad: number;
  texto: string;
}

  /** De una lista de ids de promocion, cuales existen (vivas o no: la trazabilidad sobrevive a la baja). */
  async promocionesExistentes(ids: readonly string[], trx: Transaction<DB>): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const filas = await trx.selectFrom('promocion').select('id').where('id', 'in', [...ids]).execute();
    return new Set(filas.map((f) => f.id));
  }

  async insertarRegalos(ventaNotaId: string, regalos: readonly NuevoRegaloVenta[], trx: Transaction<DB>): Promise<void> {
    if (regalos.length === 0) return;
    await trx
      .insertInto('venta_nota_promocion')
      .values(regalos.map((r) => ({
        venta_nota_id: ventaNotaId,
        promocion_id: r.promocionId,
        presentacion_id: r.presentacionId,
        cantidad: r.cantidad,
        promocion_texto: r.texto,
      })))
      .execute();
  }

  /**
   * D14: la primera nota viva del cliente lo marca, y el trigger de `updated_at`
   * hace que el pull incremental lo vuelva a bajar. Idempotente: solo escribe
   * si aun no estaba marcado.
   */
  async marcarPrimeraVenta(clienteId: string, trx: Transaction<DB>): Promise<void> {
    await trx
      .updateTable('cliente')
      .set({ primera_venta_en: sql`now()` })
      .where('id', '=', clienteId)
      .where('primera_venta_en', 'is', null)
      .execute();
  }
```

  (importa `sql` de `kysely`).

- [ ] **Paso 6: Servicio** — en `VentasService.registrarVenta`, después de `insertarDetalle` y antes del
  cobro de contado:

```ts
    // T-74 (D12, D13): la trazabilidad de los regalos, con la frase congelada.
    // Un id de promocion que el servidor no conoce no rechaza la venta (las
    // piezas ya se dieron): se guarda sin promocion y con el texto.
    if (venta.regalos.length > 0) {
      const existentes = await this.repo.promocionesExistentes(venta.regalos.map((r) => r.promocionId), trx);
      await this.repo.insertarRegalos(
        id,
        venta.regalos.map((r) => ({
          promocionId: existentes.has(r.promocionId) ? r.promocionId : null,
          presentacionId: r.presentacionId,
          cantidad: r.cantidad,
          texto: r.texto,
        })),
        trx,
      );
    }
    // T-74 (D14): la primera nota del cliente, venga de la tablet o del portal.
    await this.repo.marcarPrimeraVenta(venta.clienteId, trx);
```

  Y en `ventas.service.spec.ts` (que ya tiene un repositorio falso): dos casos nuevos — "guarda los regalos
  con `promocionId` nulo cuando la promoción no existe" (falso `promocionesExistentes` devuelve un `Set` sin
  ese id → `insertarRegalos` recibe `promocionId: null` y el `texto`) y "marca la primera venta del cliente
  en toda venta" (`marcarPrimeraVenta` llamado con el `clienteId`, también sin regalos).

- [ ] **Paso 7: Editar borra la trazabilidad (D15)** — en `ventas-edicion.repository.ts`:

```ts
  /** D15 (T-74): la oficina tomo el control de las piezas de promocion; el detalle de la tablet ya no describe la nota. */
  async borrarRegalos(ventaNotaId: string, trx: Transaction<DB>): Promise<void> {
    await trx.deleteFrom('venta_nota_promocion').where('venta_nota_id', '=', ventaNotaId).execute();
  }
```

  y en `ventas-edicion.service.ts` → `editar`, justo después de `actualizarLineas`/`insertarDetalle`:
  `await this.repo.borrarRegalos(id, trx);`. (Solo al **editar**; eliminar la venta la deja con `deleted_at` y
  su trazabilidad intacta: una nota borrada no se consulta.)

- [ ] **Paso 8: e2e del push**, en `promociones-sync.e2e-spec.ts` (misma plomería de la Tarea 4; arma la
  venta como `ventaValida()` de `sincronizacion.e2e-spec.ts`: folio con `formarFolio`, `fecha_operacion` de
  un día propio de este archivo, p. ej. **mayo de 2023**, un cliente de TJ con precio para la presentación):
  1. **Venta con regalos**: `lineas: [{ presentacion_id: P1, cantidad: 10, cantidad_promocion: 1, precio_centavos }]`,
     `regalos: [{ promocion_id: <la de todos>, presentacion_id: P1, cantidad: 1, texto: 'Por cada 10 X, 1 X gratis' }]`
     → `aplicada`; en `venta_nota_promocion` hay 1 fila con ese `promocion_id`, `cantidad: 1` y
     `promocion_texto` igual al texto mandado; `cliente.primera_venta_en` dejó de ser nulo; un pull
     incremental con el `cursor` anterior vuelve a traer ese cliente con `primera_venta_en` no nulo.
  2. **Sumas que no cuadran** → `rechazada` con `codigo: 'datos-invalidos'` y `motivo` que empieza por
     `regalos`; **no** hay fila en `venta_nota` ni en el buzón.
  3. **Promoción desconocida**: `promocion_id` uuid al azar → `aplicada`, fila con `promocion_id: null` y el
     texto.
  4. **Sin `regalos`** (venta anterior a esta versión con `cantidad_promocion: 2`) → `aplicada`, sin filas de
     trazabilidad (Review Focus 3).
  5. **Los regalos guardan la frase que mandó la tablet** aunque después se desactive la promoción (`PATCH
     activo: false`): la fila sigue con el mismo `promocion_texto` (Review Focus 4).
  6. **Editar desde el portal borra la trazabilidad** (D15): `PATCH /ventas/:id` con la cookie General
     cambiando `cantidad` de la línea (cuerpo como en `ventas-editar.e2e-spec.ts`) → 200 y
     `venta_nota_promocion` de esa nota queda vacía.
  7. **Segunda venta del mismo cliente** no cambia `primera_venta_en` (se lee antes y después: igual).

- [ ] **Paso 9: Verifica**

```bash
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm exec --workspace=apps/backend -- prettier --write <tus archivos> && npm exec --workspace=apps/backend -- eslint <tus archivos>
```

- [ ] **Paso 10: Commit**

```bash
git add apps/backend
git commit -m "T-74: push — regalos en la venta, trazabilidad por nota, primera_venta_en y borrado al editar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 6: Tablet — migración local 012, tipos y las promociones en el snapshot (D14, D17)

**Files:**
- Create: `apps/tablet/src/datos/migraciones/012-promociones.ts` (+ `012-promociones.spec.ts`)
- Modify: `apps/tablet/src/datos/migraciones/index.ts`
- Modify: `apps/tablet/src/datos/tipos.ts`
- Modify: `apps/tablet/src/datos/repositorios/catalogos.ts` (+ `catalogos.spec.ts`)
- Modify: `apps/tablet/src/datos/pruebas-apoyo.ts`
- Modify: `apps/tablet/src/sincronizacion/motor.ts` (+ `motor.spec.ts`)
- Modify: lo que deje de compilar al quitar `Cliente.promocion` (`operacion/index.tsx` pinta `promoción
  ${cliente.promocion}` en la descripción: quita ese sufijo).

**Interfaces:**
- Consumes: `PromocionPull`, `RespuestaPull.promociones?` y el `ClientePull` nuevo (Tarea 2).
- Produces: tipos `Promocion`, `VentaPromocion`, `AudienciaPromocion`, `CompraPromocion`, `RegaloPromocion`;
  `Cliente.primera_venta_en: MomentoISO | null` (sin `promocion`); `SnapshotCatalogos.promociones?`; tablas
  locales `promocion` y `venta_promocion`.

- [ ] **Paso 1: Prueba de la migración** — `012-promociones.spec.ts` (misma plomería que `011-ruta.spec.ts`,
  `baseAlDia()` **sin** la columna `promocion` en el insert del cliente, que ya no hace falta):
  - "la 012 es la última y deja `versionEsquema` en 12".
  - "existe `promocion` con sus columnas" (`pragma table_info('promocion')` contiene `audiencia`,
    `compra_tipo`, `regalo_cantidad`, `se_repite`, `activo`, `sincronizado_en`).
  - "`venta_promocion` exige `cantidad >= 1`" (insertar una fila con `cantidad 0` lanza).
  - "`cliente.primera_venta_en` existe y admite nulo".
  - "la columna vieja `cliente.promocion` sigue existiendo con su default" (un insert de cliente **sin**
    `promocion` entra; `select promocion` da `'ninguna'`): es la prueba de que no hay que rehacer la tabla.

- [ ] **Paso 2: Corre** `npm test --workspace=apps/tablet -- 012` → falla.

- [ ] **Paso 3: La migración** — `012-promociones.ts`:

```ts
import type { Migracion } from './motor';

/**
 * Promociones por regla en la tablet (T-74).
 *
 * - `promocion` la escribe el pull (upsert generico, baja como bandera). La
 *   regla de APLICACION vive en `promociones-reglas.ts`.
 * - `venta_promocion`: que promocion regalo que presentacion en cada venta
 *   local, con la frase congelada; sube en `datos.regalos`.
 * - `cliente.primera_venta_en`: lo marca el servidor (D14) y baja en el pull.
 *
 * La columna `cliente.promocion` (001) se queda: SQLite no la quita sin rehacer
 * la tabla y tiene default, asi que el snapshot simplemente deja de escribirla.
 * Nada la lee desde esta version.
 */
export const promociones: Migracion = {
  version: 12,
  nombre: 'promociones',
  sql: `
    create table promocion (
      id                     text primary key,
      audiencia              text not null check (audiencia in ('todos','cliente','prospecto')),
      cliente_id             text,
      compra_tipo            text not null check (compra_tipo in ('cualquiera','producto','presentacion')),
      compra_producto_id     text,
      compra_presentacion_id text,
      compra_cantidad        integer not null check (compra_cantidad >= 0),
      regalo_tipo            text not null check (regalo_tipo in ('mismo','producto','presentacion')),
      regalo_producto_id     text,
      regalo_presentacion_id text,
      regalo_cantidad        integer not null check (regalo_cantidad >= 1),
      se_repite              integer not null default 1,
      activo                 integer not null default 1,
      sincronizado_en        text not null
    );
    create index idx_promocion_cliente on promocion (cliente_id);

    create table venta_promocion (
      id              text primary key,
      venta_id        text not null references venta(id),
      promocion_id    text not null,
      presentacion_id text not null,
      cantidad        integer not null check (cantidad >= 1),
      texto           text not null
    );
    create index idx_venta_promocion_venta on venta_promocion (venta_id);

    alter table cliente add column primera_venta_en text;
  `,
};
```

  Regístrala en `index.ts` (import + último elemento de `migraciones`).

- [ ] **Paso 4: Tipos**, en `tipos.ts`:
  - Borra `export type Promocion = 'ninguna' | '10+1' | '20+1';` y, en `Cliente`, la línea `promocion:
    Promocion;`. Añade a `Cliente`:

```ts
  /**
   * T-74 (D14): cuando el servidor proyecto su primera nota (ISO), o `null`.
   * Decide, con `tipo`, si le aplica la promocion de bienvenida al prospecto.
   */
  primera_venta_en: MomentoISO | null;
```

  - Después de `Ruta`:

```ts
/* T-74: promociones por regla. Espejo de `PromocionPull`, con `se_repite` como entero de SQLite. */
export type AudienciaPromocion = 'todos' | 'cliente' | 'prospecto';
export type CompraPromocion = 'cualquiera' | 'producto' | 'presentacion';
export type RegaloPromocion = 'mismo' | 'producto' | 'presentacion';

export interface Promocion {
  id: string;
  audiencia: AudienciaPromocion;
  cliente_id: string | null;
  compra_tipo: CompraPromocion;
  compra_producto_id: string | null;
  compra_presentacion_id: string | null;
  compra_cantidad: number;
  regalo_tipo: RegaloPromocion;
  regalo_producto_id: string | null;
  regalo_presentacion_id: string | null;
  regalo_cantidad: number;
  se_repite: Booleano;
  /** `0` = desactivada o dada de baja en el portal: se conserva, no se aplica. */
  activo: Booleano;
  sincronizado_en: MomentoISO;
}

/** Un regalo de una venta local (T-74, D12). Sube en `datos.regalos`. */
export interface VentaPromocion {
  id: string;
  venta_id: string;
  promocion_id: string;
  presentacion_id: string;
  cantidad: number;
  /** La frase tal como la vio el vendedor al vender. */
  texto: string;
}
```

- [ ] **Paso 5: Snapshot**, en `catalogos.ts`:
  - `SnapshotCatalogos`: `/** T-74. Coleccion nueva del pull; baja como bandera. */ promociones?:
    Omit<Promocion, 'sincronizado_en'>[];` (importa `Promocion` de `../tipos`).
  - `COLUMNAS.cliente`: sustituye `'promocion'` por `'primera_venta_en'` (después de `'plazo_credito_dias'`,
    el orden no importa).
  - `COLUMNAS.promocion`:

```ts
  promocion: [
    'id', 'audiencia', 'cliente_id',
    'compra_tipo', 'compra_producto_id', 'compra_presentacion_id', 'compra_cantidad',
    'regalo_tipo', 'regalo_producto_id', 'regalo_presentacion_id', 'regalo_cantidad',
    'se_repite', 'activo',
  ],
```

  - En `guardarSnapshot`, después de `aplicarSnapshotRutas(...)` y antes de `cliente_precio`:
    `upsert(bd, 'promocion', COLUMNAS.promocion, snapshot.promociones, ahora) +` con el comentario `// T-74:
    sin llaves foraneas; va aqui por orden de lectura.`
  - En `catalogos.spec.ts`: "escribe las promociones del snapshot y una baja llega como `activo: 0`" (dos
    filas, segundo snapshot con la primera `activo: 0`, `select activo from promocion`) y "el cliente ya no
    escribe `promocion` y sí `primera_venta_en`" (snapshot con `primera_venta_en: '2026-10-14T00:00:00.000Z'`;
    `select promocion, primera_venta_en` → `'ninguna'` y el ISO).

- [ ] **Paso 6: `aSnapshot`** en `motor.ts`: en `clientes`, el objeto mapeado ya hace `...cliente`; añade
  `primera_venta_en: cliente.primera_venta_en ?? null` (un servidor anterior no lo manda). Y:

```ts
    // T-74: un servidor anterior no manda la coleccion; `undefined` no escribe
    // nada y la ficha dice "Sin promoción". `se_repite` llega booleano y SQLite
    // guarda 0/1.
    promociones: respuesta.promociones?.map((p) => ({ ...p, se_repite: p.se_repite ? 1 : 0 }) as const),
```

  (tipa el resultado como `Omit<Promocion, 'sincronizado_en'>[] | undefined`). En `motor.spec.ts`, el caso
  "`aSnapshot` pasa las promociones con `se_repite` 0/1 y tolera que no vengan".

- [ ] **Paso 7: `pruebas-apoyo.ts`**: quita `promocion: '10+1'` (y cualquier `promocion:`) de los clientes del
  snapshot y añade `primera_venta_en: null` a cada uno; añade al snapshot de prueba una lista `promociones`
  con **dos** filas que las Tareas 7 y 8 reutilizan:

```ts
    promociones: [
      // Por cada 10 Jamaica (producto), 1 Jamaica gratis, se repite. General.
      {
        id: 'promo-general', audiencia: 'todos', cliente_id: null,
        compra_tipo: 'producto', compra_producto_id: 'pro-1', compra_presentacion_id: null, compra_cantidad: 10,
        regalo_tipo: 'mismo', regalo_producto_id: null, regalo_presentacion_id: null, regalo_cantidad: 1,
        se_repite: 1, activo: 1,
      },
      // Bienvenida al prospecto: 2 Jamaica 500 ml sin compra.
      {
        id: 'promo-prospecto', audiencia: 'prospecto', cliente_id: null,
        compra_tipo: 'cualquiera', compra_producto_id: null, compra_presentacion_id: null, compra_cantidad: 0,
        regalo_tipo: 'presentacion', regalo_producto_id: null, regalo_presentacion_id: 'pre-2', regalo_cantidad: 2,
        se_repite: 0, activo: 1,
      },
    ],
```

- [ ] **Paso 8: Verifica**

```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
```

  El `typecheck` te llevará a `operacion/index.tsx` (quita `· promoción ${cliente.promocion}` de la
  descripción) y a cualquier spec que construya un `Cliente` con `promocion`.

- [ ] **Paso 9: Commit**

```bash
git add apps/tablet
git commit -m "T-74: tablet — migración 012, tipos de promoción y la colección en el snapshot

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 7: Tablet — las reglas puras: frase, cobertura, aplicables, cálculo y aplicación de regalos (D5, D6, D7, D16, D18)

**Files:**
- Create: `apps/tablet/src/datos/promociones-reglas.ts`
- Create: `apps/tablet/src/datos/promociones-reglas.spec.ts`

**Interfaces:**
- Consumes: `Promocion`, `Cliente` (Tarea 6); `LineaCaptura` de `ventas-reglas.ts`.
- Produces (los usan las Tareas 8 y 9):

```ts
export interface CatalogoPromociones {
  /** presentacion_id -> producto y etiqueta "Producto volumen", en el orden del catalogo. */
  presentaciones: ReadonlyMap<string, { productoId: string; etiqueta: string }>;
  /** producto_id -> nombre. */
  productos: ReadonlyMap<string, string>;
}
export interface PromocionAplicable extends Promocion { texto: string }
export interface Regalo {
  promocionId: string;
  texto: string;
  productoId: string;
  /** `null` = falta que el vendedor elija la presentacion (D16). */
  presentacionId: string | null;
  cantidad: number;
}
export type Cobertura = 'todos' | ReadonlySet<string>;
export function textoPromocion(p: Promocion, catalogo: CatalogoPromociones): string;
export function cobertura(p: Promocion, catalogo: CatalogoPromociones): Cobertura;
export function coincidenEnProducto(a: Cobertura, b: Cobertura): boolean;
export function promocionesAplicables(args: {
  cliente: Pick<Cliente, 'id' | 'tipo' | 'primera_venta_en'>;
  tieneVentas: boolean;
  promociones: readonly Promocion[];
  catalogo: CatalogoPromociones;
}): PromocionAplicable[];
export function calcularRegalos(
  lineas: readonly LineaCaptura[],
  promociones: readonly PromocionAplicable[],
  catalogo: CatalogoPromociones,
  elecciones: ReadonlyMap<string, string>,
): Regalo[];
export function aplicarRegalos(
  lineas: readonly LineaCaptura[],
  regalos: readonly Regalo[],
  descartados: ReadonlySet<string>,
): { lineas: LineaCaptura[]; regalos: Regalo[] };
export function problemasDeRegalos(regalos: readonly Regalo[]): string[];
```

- [ ] **Paso 1: Las pruebas** — `promociones-reglas.spec.ts`. Catálogo de prueba: productos `pro-1` Jamaica
  (presentaciones `pre-1` "1 L", `pre-2` "500 ml") y `pro-2` Horchata (`pre-3` "1 L"); helper `promo(extra)` que
  parte de la general de `pruebas-apoyo` (`promo-general`, con `sincronizado_en`); helper `linea(presentacionId,
  cantidad)` que arma una `LineaCaptura` con `cantidadPromocion: 0` y `precioCentavos: 1000`. Casos:

  *textoPromocion* — los **mismos siete** casos de la Tarea 3 (Paso 1), resolviendo nombres por el catálogo
  (producto → nombre; presentación → "Jamaica 500 ml"); el séptimo con un `compra_producto_id` que no está
  en el catálogo → `(producto)`.

  *cobertura / coincidenEnProducto* — `cualquiera` → `'todos'`; producto → `{pro-1}`; presentación `pre-2` →
  `{pro-1}` (el producto de la presentación); `coincidenEnProducto` como en la Tarea 3.

  *promocionesAplicables* —
  - un cliente `tipo: 'cliente'` ve las de `todos` y sus propias, no la de prospecto;
  - una propia que coincide en producto **desplaza** a la general (D5); una propia de `pro-2` **no** desplaza
    la general de `pro-1`; una propia "cualquiera" desplaza **todas** las generales;
  - una propia **inactiva** no desplaza; una general inactiva no aparece; una propia de **otro** cliente no
    aparece;
  - un prospecto con `primera_venta_en: null` y `tieneVentas: false` ve la de bienvenida; con
    `primera_venta_en` lleno **no**; con `tieneVentas: true` **no**; un `tipo: 'cliente'` **no**;
  - el orden: propias, luego generales, luego prospecto; cada una con `texto`.

  *calcularRegalos* —
  - "por cada 10 Jamaica, 1 Jamaica, se repite" con 25 de `pre-1` → un regalo `{promocionId, productoId:
    'pro-1', presentacionId: 'pre-1', cantidad: 2}`; con 9 → ninguno; con `se_repite: 0` y 25 → cantidad 1;
  - **suma presentaciones del mismo producto**: 6 de `pre-1` + 4 de `pre-2` → 1 regalo, en `pre-1` (la que
    más compró); con 4 y 6 → en `pre-2`; **empate** (5 y 5) → `pre-1` (la primera en el orden del catálogo);
  - compra por **presentación** `pre-2` 10, regalo mismo → `pre-2`; las piezas de `pre-1` no cuentan;
  - compra **cualquiera** 20, regalo presentación `pre-3` 1: 12 de `pre-1` + 8 de `pre-3` → 1 regalo en
    `pre-3`; las piezas regaladas no cuentan como compradas (`cantidadPromocion` previo se ignora: D18);
  - regalo **producto completo** (`regalo_tipo: 'producto'`, `pro-1`) sin elección → `presentacionId: null`;
    con `elecciones.set(promocionId, 'pre-2')` → `pre-2`; si el producto tiene **una sola** presentación en el
    catálogo (`pro-2`) → esa, sin elección;
  - **dos promociones a la misma presentación se suman** (Review Focus 5): la general de `pro-1` y una
    "cualquiera 20 → 1 `pre-1`" con 20 de `pre-1` → dos regalos, ambos a `pre-1`;
  - **prospecto con compra 0** → regalo de 2 en `pre-2` aunque no haya líneas con cantidad; una sola vez;
  - **una cantidad NaN cuenta como 0 y no revienta** (Review Focus 1): línea con `cantidad: Number.NaN` → sin
    regalo, sin excepción;
  - **un regalo a una presentación que no está en el catálogo se omite** (Review Focus 2): regalo
    presentación `pre-9` → `[]`; compra por presentación `pre-9` → `[]`.

  *aplicarRegalos* —
  - rellena `cantidadPromocion` de la línea con la suma de sus regalos y devuelve solo los regalos aplicados;
  - un regalo en `descartados` no suma ni se devuelve (D6);
  - un regalo con `presentacionId: null` **no suma** (no se sabe a qué línea) pero **sí se devuelve** (la
    pantalla lo pide); una presentación regalada que no tiene línea de compra (prospecto, `pre-2` sin
    cantidad) **crea** la línea con `cantidad: 0` y `cantidadPromocion` del regalo, con `etiqueta` del
    catálogo y `precioCentavos: null` cuando no está entre las líneas base;
  - no muta las entradas.

  *problemasDeRegalos* — `[]` cuando todos tienen presentación; `['Elige la presentación del regalo de
  «Por cada …».']` por cada uno sin ella.

- [ ] **Paso 2: Corre** `npm test --workspace=apps/tablet -- promociones-reglas` → falla.

- [ ] **Paso 3: La implementación** — `promociones-reglas.ts`:

```ts
import type { Cliente, Promocion } from './tipos';
import type { LineaCaptura } from './ventas-reglas';

/* (interfaces de arriba: CatalogoPromociones, PromocionAplicable, Regalo, Cobertura) */

function nombreDe(p: Promocion, lado: 'compra' | 'regalo', catalogo: CatalogoPromociones): string | null {
  const tipo = lado === 'compra' ? p.compra_tipo : p.regalo_tipo;
  if (tipo === 'producto') {
    const id = lado === 'compra' ? p.compra_producto_id : p.regalo_producto_id;
    return (id && catalogo.productos.get(id)) ?? null;
  }
  if (tipo === 'presentacion') {
    const id = lado === 'compra' ? p.compra_presentacion_id : p.regalo_presentacion_id;
    return (id && catalogo.presentaciones.get(id)?.etiqueta) ?? null;
  }
  return null;
}

/**
 * La frase de la promocion. COPIA de `promociones-texto.ts` del backend (y de
 * `lib/promociones.ts` del portal): la tablet no puede importar del backend y
 * la frase tiene que ser la misma en los tres sitios, porque es la que se
 * congela en la nota.
 */
export function textoPromocion(p: Promocion, catalogo: CatalogoPromociones): string {
  const hueco = '(producto)';
  const nombreCompra = nombreDe(p, 'compra', catalogo);
  const compra =
    p.compra_tipo === 'cualquiera'
      ? p.compra_cantidad === 1
        ? 'pieza'
        : `${p.compra_cantidad} piezas de lo que sea`
      : `${p.compra_cantidad} ${nombreCompra ?? hueco}`;
  const regalo = `${p.regalo_cantidad} ${
    p.regalo_tipo === 'mismo' ? (nombreCompra ?? hueco) : (nombreDe(p, 'regalo', catalogo) ?? hueco)
  } gratis`;
  if (p.audiencia === 'prospecto') {
    return p.compra_cantidad === 0
      ? `Bienvenida al prospecto: ${regalo} en su primera venta`
      : `Bienvenida al prospecto: al comprar ${compra}, ${regalo} en su primera venta`;
  }
  return p.se_repite === 1 ? `Por cada ${compra}, ${regalo}` : `Al comprar ${compra}, ${regalo} (una vez)`;
}

/** Los productos que cubre la compra de una promocion (D5). */
export function cobertura(p: Promocion, catalogo: CatalogoPromociones): Cobertura {
  if (p.compra_tipo === 'cualquiera') return 'todos';
  if (p.compra_tipo === 'producto') return new Set(p.compra_producto_id ? [p.compra_producto_id] : []);
  const pres = p.compra_presentacion_id ? catalogo.presentaciones.get(p.compra_presentacion_id) : undefined;
  return new Set(pres ? [pres.productoId] : []);
}

export function coincidenEnProducto(a: Cobertura, b: Cobertura): boolean {
  if (a === 'todos' || b === 'todos') return true;
  for (const p of a) if (b.has(p)) return true;
  return false;
}

/**
 * Que promociones le tocan a este cliente hoy (D5, D7): sus propias, las
 * generales que ninguna propia desplaza, y la de bienvenida si es un prospecto
 * sin primera venta (ni en el servidor ni en esta tablet).
 */
export function promocionesAplicables({ cliente, tieneVentas, promociones, catalogo }: {
  cliente: Pick<Cliente, 'id' | 'tipo' | 'primera_venta_en'>;
  tieneVentas: boolean;
  promociones: readonly Promocion[];
  catalogo: CatalogoPromociones;
}): PromocionAplicable[] {
  const activas = promociones.filter((p) => p.activo === 1);
  const propias = activas.filter((p) => p.audiencia === 'cliente' && p.cliente_id === cliente.id);
  const generales = activas.filter(
    (p) => p.audiencia === 'todos' && !propias.some((q) => coincidenEnProducto(cobertura(q, catalogo), cobertura(p, catalogo))),
  );
  const esPrimeraVenta = cliente.tipo === 'prospecto' && cliente.primera_venta_en === null && !tieneVentas;
  const bienvenida = esPrimeraVenta ? activas.filter((p) => p.audiencia === 'prospecto') : [];
  return [...propias, ...generales, ...bienvenida].map((p) => ({ ...p, texto: textoPromocion(p, catalogo) }));
}

const piezas = (n: number) => (Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0);

/** Piezas compradas que cuentan para la promocion (los regalos no, D18). */
function compradas(p: Promocion, lineas: readonly LineaCaptura[], catalogo: CatalogoPromociones): number {
  let total = 0;
  for (const l of lineas) {
    const pres = catalogo.presentaciones.get(l.presentacionId);
    if (!pres) continue;
    const cuenta =
      p.compra_tipo === 'cualquiera' ||
      (p.compra_tipo === 'producto' && pres.productoId === p.compra_producto_id) ||
      (p.compra_tipo === 'presentacion' && l.presentacionId === p.compra_presentacion_id);
    if (cuenta) total += piezas(l.cantidad);
  }
  return total;
}

/** La presentacion del producto con mas piezas compradas; empate: la primera del catalogo (D16). */
function masComprada(productoId: string, lineas: readonly LineaCaptura[], catalogo: CatalogoPromociones): string | null {
  let mejor: { id: string; cantidad: number } | null = null;
  for (const [id, pres] of catalogo.presentaciones) {
    if (pres.productoId !== productoId) continue;
    const cantidad = piezas(lineas.find((l) => l.presentacionId === id)?.cantidad ?? 0);
    if (mejor === null || cantidad > mejor.cantidad) mejor = { id, cantidad };
  }
  return mejor?.id ?? null;
}

/** Las presentaciones de un producto en el catalogo, en su orden. */
function presentacionesDe(productoId: string, catalogo: CatalogoPromociones): string[] {
  return [...catalogo.presentaciones].filter(([, p]) => p.productoId === productoId).map(([id]) => id);
}

export function calcularRegalos(
  lineas: readonly LineaCaptura[],
  promociones: readonly PromocionAplicable[],
  catalogo: CatalogoPromociones,
  elecciones: ReadonlyMap<string, string>,
): Regalo[] {
  const regalos: Regalo[] = [];
  for (const p of promociones) {
    // Cuantos bloques (D2). Compra 0 (prospecto): un bloque sin mirar la compra.
    let bloques: number;
    if (p.compra_cantidad === 0) {
      bloques = 1;
    } else {
      const n = compradas(p, lineas, catalogo);
      bloques = p.se_repite === 1 ? Math.floor(n / p.compra_cantidad) : n >= p.compra_cantidad ? 1 : 0;
    }
    if (bloques === 0) continue;

    // Que se regala y en que presentacion (D16).
    let productoId: string | null = null;
    let presentacionId: string | null = null;
    if (p.regalo_tipo === 'presentacion') {
      const pres = p.regalo_presentacion_id ? catalogo.presentaciones.get(p.regalo_presentacion_id) : undefined;
      if (!pres) continue; // ya no esta en el catalogo: se omite
      productoId = pres.productoId;
      presentacionId = p.regalo_presentacion_id;
    } else if (p.regalo_tipo === 'producto') {
      productoId = p.regalo_producto_id;
      if (!productoId || !catalogo.productos.has(productoId)) continue;
      const opciones = presentacionesDe(productoId, catalogo);
      if (opciones.length === 0) continue;
      const elegida = elecciones.get(p.id);
      presentacionId = elegida && opciones.includes(elegida) ? elegida : opciones.length === 1 ? opciones[0] : null;
    } else {
      // 'mismo': el producto de la compra; la presentacion comprada o la que mas compro.
      if (p.compra_tipo === 'presentacion') {
        const pres = p.compra_presentacion_id ? catalogo.presentaciones.get(p.compra_presentacion_id) : undefined;
        if (!pres) continue;
        productoId = pres.productoId;
        presentacionId = p.compra_presentacion_id;
      } else {
        productoId = p.compra_producto_id;
        if (!productoId) continue;
        presentacionId = masComprada(productoId, lineas, catalogo);
        if (presentacionId === null) continue;
      }
    }
    regalos.push({ promocionId: p.id, texto: p.texto, productoId: productoId as string, presentacionId, cantidad: bloques * p.regalo_cantidad });
  }
  return regalos;
}

export function aplicarRegalos(
  lineas: readonly LineaCaptura[],
  regalos: readonly Regalo[],
  descartados: ReadonlySet<string>,
): { lineas: LineaCaptura[]; regalos: Regalo[] } {
  const aplicados = regalos.filter((r) => !descartados.has(r.promocionId));
  const porPresentacion = new Map<string, number>();
  for (const r of aplicados) {
    if (r.presentacionId === null) continue;
    porPresentacion.set(r.presentacionId, (porPresentacion.get(r.presentacionId) ?? 0) + r.cantidad);
  }
  const resultado = lineas.map((l) => ({ ...l, cantidadPromocion: porPresentacion.get(l.presentacionId) ?? 0 }));
  return { lineas: resultado, regalos: aplicados };
}

export function problemasDeRegalos(regalos: readonly Regalo[]): string[] {
  return regalos.filter((r) => r.presentacionId === null).map((r) => `Elige la presentación del regalo de «${r.texto}».`);
}
```

  Ojo con dos detalles que las pruebas exigen: (1) `aplicarRegalos` tiene que **crear** la línea de una
  presentación regalada que no está en `lineas` (el prospecto sin compra); hazlo con un segundo bucle sobre
  `porPresentacion` que añada `{ presentacionId, etiqueta: '', cantidad: 0, cantidadPromocion, precioCentavos:
  null }` para las que falten — la pantalla (Tarea 9) le pasa **todas** las presentaciones del catálogo como
  líneas base, así que en la práctica siempre existe, pero la función no puede depender de eso; (2)
  `elecciones` se consulta **solo** para `regalo_tipo = 'producto'`.

- [ ] **Paso 4: Corre** la spec → pasa. Luego `npm run typecheck --workspace=apps/tablet` y `npm run lint
  --workspace=apps/tablet`.

- [ ] **Paso 5: Commit**

```bash
git add apps/tablet/src/datos/promociones-reglas.ts apps/tablet/src/datos/promociones-reglas.spec.ts
git commit -m "T-74: tablet — reglas puras de promociones: frase, cobertura, aplicables, cálculo y aplicación de regalos

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 8: Tablet — repositorio de promociones, la venta graba y sube `regalos`, y la captura sin promoción manual (D6, D12, D13)

**Files:**
- Create: `apps/tablet/src/datos/repositorios/promociones.ts` (+ `promociones.spec.ts`)
- Modify: `apps/tablet/src/datos/repositorios/ventas.ts` (+ `ventas.spec.ts`)
- Modify: `apps/tablet/src/datos/ventas-reglas.ts` (+ `ventas-reglas.spec.ts`)
- Modify: `apps/tablet/src/sincronizacion/fuente-ventas.ts` (+ `fuente-ventas.spec.ts`)
- Modify: `apps/tablet/src/datos/inicializar.ts`, `apps/tablet/src/datos/index.ts`

**Interfaces:**
- Consumes: Tarea 7 entera; tabla `venta_promocion` (Tarea 6).
- Produces:

```ts
// repositorios/promociones.ts
export type RepositorioPromociones = ReturnType<typeof crearRepositorioPromociones>;
export function crearRepositorioPromociones(deps: DepsRepositorio, { catalogos }: { catalogos: RepositorioCatalogos }) {
  return {
    /** Nombres y productos de las presentaciones activas, en el orden del catalogo. */
    catalogo(): CatalogoPromociones;
    /** Las que le aplican hoy al cliente (D5, D7), con su frase. */
    aplicablesPara(clienteId: string): PromocionAplicable[];
  };
}
// repositorios/ventas.ts
export interface RegaloRegistroVenta { promocionId: string; presentacionId: string; cantidad: number; texto: string }
DatosRegistroVenta.regalos?: RegaloRegistroVenta[];
regalosDe(ventaId: string): VentaPromocion[];
hayAlgunaDe(clienteId: string): boolean;
// CapaDatos.promociones: RepositorioPromociones
```

- [ ] **Paso 1: Pruebas del repositorio** — `promociones.spec.ts` (`montar()` como en `ventas.spec.ts`,
  snapshot de `pruebas-apoyo` que ya trae `promo-general` y `promo-prospecto`):
  - "`catalogo()` trae las presentaciones activas con su producto y etiqueta, en orden" (`pre-1` →
    `{productoId: 'pro-1', etiqueta: 'Jamaica 1 L'}`; `productos.get('pro-1') === 'Jamaica'`).
  - "a un cliente le aplica la general con su frase y no la de prospecto" (`aplicablesPara('cli-1')` → una,
    `texto: 'Por cada 10 Jamaica, 1 Jamaica gratis'`).
  - "a un prospecto sin ventas le aplica la bienvenida" (añade al snapshot un cliente `cli-p` con `tipo:
    'prospecto'`, `primera_venta_en: null` → dos: general y bienvenida).
  - "con una venta local del prospecto ya no" (graba una venta con `crearRepositorioVentas` y vuelve a
    preguntar → solo la general).
  - "con `primera_venta_en` del servidor tampoco".
  - "una propia del cliente desplaza a la general" (snapshot con `promo-propia` de `cli-1` sobre `pro-1` →
    solo la propia).

- [ ] **Paso 2: Corre** → falla. **Paso 3: `promociones.ts`**:

```ts
import { promocionesAplicables, type CatalogoPromociones, type PromocionAplicable } from '../promociones-reglas';
import type { Promocion } from '../tipos';
import type { RepositorioCatalogos } from './catalogos';
import type { DepsRepositorio } from './deps';

export type RepositorioPromociones = ReturnType<typeof crearRepositorioPromociones>;

/**
 * Lectura de las promociones (T-74). La escritura la hace el pull en
 * `catalogos.guardarSnapshot`; aqui solo se decide cuales aplican hoy y como se
 * llaman. Recibe `catalogos` para leer el cliente con la misma instancia que
 * publica la version que observan las pantallas.
 */
export function crearRepositorioPromociones({ bd }: DepsRepositorio, { catalogos }: { catalogos: RepositorioCatalogos }) {
  return {
    catalogo(): CatalogoPromociones {
      const filas = bd.getAllSync<{ id: string; producto_id: string; producto_nombre: string; volumen: string }>(
        `select pr.id, pr.producto_id, p.nombre as producto_nombre, pr.volumen
           from presentacion pr join producto p on p.id = pr.producto_id
          where pr.activo = 1 and p.activo = 1
          order by p.nombre, pr.volumen`,
      );
      return {
        presentaciones: new Map(filas.map((f) => [f.id, { productoId: f.producto_id, etiqueta: `${f.producto_nombre} ${f.volumen}` }])),
        productos: new Map(filas.map((f) => [f.producto_id, f.producto_nombre])),
      };
    },

    aplicablesPara(clienteId: string): PromocionAplicable[] {
      const cliente = catalogos.obtenerCliente(clienteId);
      if (!cliente) return [];
      const promociones = bd.getAllSync<Promocion>(
        `select * from promocion where activo = 1 and (cliente_id is null or cliente_id = $cliente_id) order by rowid`,
        { $cliente_id: clienteId },
      );
      const tieneVentas =
        bd.getFirstSync<{ n: number }>('select count(*) as n from venta where cliente_id = $cliente_id', { $cliente_id: clienteId })?.n !== 0;
      return promocionesAplicables({ cliente, tieneVentas, promociones, catalogo: this.catalogo() });
    },
  };
}
```

  (`this.catalogo()` dentro de un objeto literal: usa una función interna `leerCatalogo()` y llámala desde
  los dos métodos para no depender de `this`.) El orden del catálogo (`p.nombre, pr.volumen`) es el mismo que
  `presentacionesParaVenta`: así "la primera en el orden del catálogo" de D16 coincide con la pantalla.

- [ ] **Paso 4: La venta graba los regalos** — en `ventas.ts`:
  - `DatosRegistroVenta.regalos?: RegaloRegistroVenta[]` con la interfaz de arriba (comentario: la pantalla
    manda los regalos ya aplicados; el repositorio **vuelve a comprobar** que por presentación suman
    `cantidadPromocion`, espejo de `datos-venta.ts` del servidor, y que ninguno viene sin presentación).
  - En `registrar`, después de `problemasDeCaptura` y antes de la transacción:

```ts
      const regalos = datos.regalos ?? [];
      const regaladas = new Map<string, number>();
      for (const r of regalos) {
        if (!Number.isInteger(r.cantidad) || r.cantidad < 1 || r.texto.trim() === '') {
          throw new ErrorVenta('Un regalo de promoción viene incompleto. Vuelve a capturar la venta.');
        }
        regaladas.set(r.presentacionId, (regaladas.get(r.presentacionId) ?? 0) + r.cantidad);
      }
      for (const l of resumen.lineas) {
        if ((regaladas.get(l.presentacionId) ?? 0) !== l.cantidadPromocion) {
          throw new ErrorVenta('Las piezas de promoción no cuadran con los regalos. Vuelve a capturar la venta.');
        }
      }
```

  (`resumen` ya está calculado unas líneas más abajo en el código actual: mueve `const resumen =
  resumirCaptura(lineas);` arriba de este bloque.) Dentro de la transacción, después del bucle de
  `venta_linea`:

```ts
        for (const r of regalos) {
          bd.runSync(
            `insert into venta_promocion (id, venta_id, promocion_id, presentacion_id, cantidad, texto)
             values ($id, $venta_id, $promocion_id, $presentacion_id, $cantidad, $texto)`,
            { $id: generarId(), $venta_id: id, $promocion_id: r.promocionId, $presentacion_id: r.presentacionId, $cantidad: r.cantidad, $texto: r.texto.trim() },
          );
        }
```

  - Métodos nuevos:

```ts
    /** Los regalos de una venta, en el orden en que se grabaron (T-74). */
    regalosDe(ventaId: string): VentaPromocion[] {
      return bd.getAllSync<VentaPromocion>('select * from venta_promocion where venta_id = $venta_id order by rowid', { $venta_id: ventaId });
    },

    /** ¿Le hemos vendido alguna vez desde esta tablet? Decide la bienvenida al prospecto (D7). */
    hayAlgunaDe(clienteId: string): boolean {
      return (bd.getFirstSync<{ n: number }>('select count(*) as n from venta where cliente_id = $cliente_id', { $cliente_id: clienteId })?.n ?? 0) > 0;
    },
```

  - En `ventas.spec.ts`: "graba los regalos y `regalosDe` los devuelve" (venta con `lineas: [{pre-1, 10,
    cantidadPromocion: 1}]` y `regalos: [{promocionId: 'promo-general', presentacionId: 'pre-1', cantidad: 1,
    texto: 'Por cada 10 Jamaica, 1 Jamaica gratis'}]`); "si los regalos no cuadran con las piezas de promoción,
    no graba ni quema folio" (`cuantas(deps, 'folio_emitido')` sigue igual); "una venta sin regalos sigue
    entrando" (compatibilidad con la captura vieja de las pruebas existentes: déjalas como están).

- [ ] **Paso 5: `ventas-reglas.ts`** — `problemasDeCaptura` no cambia de firma (el repositorio la sigue
  usando con `cantidadPromocion` ya calculada). Cambia solo el texto del problema de la fila sin precio:
  `'${etiqueta} no tiene precio para este cliente: solo puede ir como regalo de promoción.'` y el de "nada
  capturado": `'Captura al menos una cantidad.'` (ya no hay piezas de promoción a mano, D6). Actualiza las dos
  aserciones en `ventas-reglas.spec.ts`. Exporta `problemasDeRegalos` desde `promociones-reglas` (ya está) y
  reexporta en `datos/index.ts` junto con `calcularRegalos`, `aplicarRegalos`, `promocionesAplicables`,
  `textoPromocion` y los tipos `Regalo`, `PromocionAplicable`, `CatalogoPromociones`.

- [ ] **Paso 6: `fuente-ventas.ts`** — después de `lineas`:

```ts
        // T-74 (D13): solo cuando hay filas. Una venta anterior a la 012 llevaba
        // piezas de promocion a mano y ninguna fila: mandar `regalos: []` haria
        // que el servidor la rechazara por no cuadrar. Sin la clave, entra como
        // siempre.
        const regalos = ventas.regalosDe(v.id);
        const datos: DatosVenta = {
          ...,
          ...(regalos.length > 0
            ? { regalos: regalos.map((r) => ({ promocion_id: r.promocion_id, presentacion_id: r.presentacion_id, cantidad: r.cantidad, texto: r.texto })) }
            : {}),
        };
```

  En `fuente-ventas.spec.ts`: "manda `regalos` cuando la venta los tiene" y "una venta sin regalos no manda la
  clave" (`expect(op.datos).not.toHaveProperty('regalos')`).

- [ ] **Paso 7: Cableado** — `inicializar.ts`: `promociones: crearRepositorioPromociones(deps, { catalogos })`
  en `CapaDatos` (interfaz y objeto, con un comentario de una línea); `index.ts` exporta
  `crearRepositorioPromociones` y `RepositorioPromociones`, y los tipos/funciones del Paso 5.

- [ ] **Paso 8: Verifica** `npm test --workspace=apps/tablet`, `npm run typecheck --workspace=apps/tablet`,
  `npm run lint --workspace=apps/tablet`.

- [ ] **Paso 9: Commit**

```bash
git add apps/tablet
git commit -m "T-74: tablet — repositorio de promociones, regalos en la venta y en el push, captura sin promoción a mano

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 9: Tablet — la ficha muestra las promociones y la venta calcula los regalos (D6, D11, D16)

**Files:**
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx`
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx`

**Interfaces:**
- Consumes: `datos.promociones.aplicablesPara`, `datos.promociones.catalogo()`, `calcularRegalos`,
  `aplicarRegalos`, `problemasDeRegalos`, `DatosRegistroVenta.regalos` (Tareas 7 y 8); `Tarjeta`, `Opcion`,
  `Cifra`, `Boton`, `Campo` de `src/ui`.
- Produces: nada que otra tarea consuma. **Sin pruebas de pantalla**: se verifica con `typecheck`, `lint`,
  `export` y la aceptación manual de la Tarea 13.

- [ ] **Paso 1: Ficha** — en `index.tsx`, dentro del `useMemo` de `hoy` añade `promociones:
  datos.promociones.aplicablesPara(clienteId)` (se relee con las mismas dependencias: una venta recién grabada
  apaga la bienvenida). Después de la tarjeta "Saldo a favor":

```tsx
      {/* T-74 (D11): lo que le toca hoy, en lenguaje llano; la venta lo calcula sola. */}
      <Tarjeta estado={hoy.promociones.length > 0 ? 'listo' : 'neutro'} etiqueta="Promociones">
        {hoy.promociones.length === 0 ? (
          <Text style={estilos.textoSuave}>Sin promoción.</Text>
        ) : (
          hoy.promociones.map((p) => (
            <Text key={p.id} style={estilos.textoTarjeta}>
              {p.texto}
              {p.audiencia === 'prospecto' ? ' (primera venta)' : ''}
            </Text>
          ))
        )}
      </Tarjeta>
```

- [ ] **Paso 2: Venta — estado y cálculo**, en `venta.tsx`:
  - `CapturaTexto` pasa a `{ cantidad: string }` (fuera `promocion`); `capturar(presentacionId, valor)`.
  - Lecturas nuevas junto a `presentaciones`:

```tsx
  const catalogoPromos = useMemo(() => {
    void versionCatalogos;
    return datos.promociones.catalogo();
  }, [datos, versionCatalogos]);
  const promociones = useMemo(() => {
    void versionCatalogos;
    return datos.promociones.aplicablesPara(clienteId);
  }, [datos, clienteId, versionCatalogos]);
  const [descartados, setDescartados] = useState<Set<string>>(new Set());
  const [elecciones, setElecciones] = useState<Map<string, string>>(new Map());
```

  - `lineas` se renombra `lineasBase` (todas las presentaciones, `cantidadPromocion: 0`); después:

```tsx
  // D6: los regalos los calcula la app sobre lo capturado; el vendedor solo
  // puede quitarlos (`descartados`) o elegir presentacion (`elecciones`, D16).
  const regalosPosibles = useMemo(
    () => calcularRegalos(lineasBase, promociones, catalogoPromos, elecciones),
    [lineasBase, promociones, catalogoPromos, elecciones],
  );
  const { lineas, regalos } = useMemo(
    () => aplicarRegalos(lineasBase, regalosPosibles, descartados),
    [lineasBase, regalosPosibles, descartados],
  );
  const resumen = useMemo(() => resumirCaptura(lineas), [lineas]);
  /** Piezas gratis por presentacion, para el texto bajo cada fila. */
  const gratisPor = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of regalos) if (r.presentacionId) m.set(r.presentacionId, (m.get(r.presentacionId) ?? 0) + r.cantidad);
    return m;
  }, [regalos]);
```

  - `revisar()`: `const encontrados = [...problemasDeCaptura({ numNota, contadoCredito, comentarios, lineas }),
    ...problemasDeRegalos(regalos)];`.
  - `grabar()`: pasa `regalos: regalos.filter((r) => r.presentacionId !== null).map((r) => ({ promocionId:
    r.promocionId, presentacionId: r.presentacionId as string, cantidad: r.cantidad, texto: r.texto }))`.

- [ ] **Paso 3: Venta — captura**:
  - Arriba, antes de "Notas pendientes": la misma tarjeta "Promociones" de la ficha (con `promociones`), solo
    si hay alguna.
  - En cada fila: fuera el `Campo` "Promoción"; el `Campo` "Cantidad" ocupa la fila; debajo del precio, si
    `gratisPor.get(p.presentacion_id)`:

```tsx
                {gratisPor.has(p.presentacion_id) ? (
                  <Text style={estilos.textoTarjeta}>
                    +<Cifra valor={gratisPor.get(p.presentacion_id) ?? 0} /> gratis por promoción
                  </Text>
                ) : null}
```

    El texto "Sin precio para este cliente: solo promoción." pasa a "Sin precio para este cliente: solo puede
    ir como regalo." y la fila sin precio deshabilita el campo de cantidad (`editable={false}` o no lo pinta).
  - Después de las filas y antes de "Pago", la tarjeta **Regalos**, solo si `regalosPosibles.length > 0`:

```tsx
      <Tarjeta estado="listo" etiqueta="Regalos por promoción">
        {regalosPosibles.map((r) => {
          const descartado = descartados.has(r.promocionId);
          const opciones = [...catalogoPromos.presentaciones].filter(([, p]) => p.productoId === r.productoId);
          return (
            <View key={r.promocionId} style={{ marginBottom: espacio.sm, gap: espacio.xs }}>
              <Text style={[estilos.textoTarjeta, descartado && { textDecorationLine: 'line-through' }]}>
                <Cifra valor={r.cantidad} /> gratis · {r.texto}
              </Text>
              {!descartado && r.presentacionId === null ? (
                <View style={estilos.rejilla}>
                  {opciones.map(([id, p]) => (
                    <Opcion key={id} etiqueta={p.etiqueta} seleccionada={false} onPress={() => setElecciones((prev) => new Map(prev).set(r.promocionId, id))} />
                  ))}
                </View>
              ) : null}
              {!descartado && r.presentacionId !== null ? (
                <Text style={estilos.textoSuave}>{catalogoPromos.presentaciones.get(r.presentacionId)?.etiqueta}</Text>
              ) : null}
              <Boton
                etiqueta={descartado ? 'Volver a dar' : 'El cliente no lo quiso'}
                tono="neutra"
                ancho="ajustado"
                onPress={() =>
                  setDescartados((prev) => {
                    const s = new Set(prev);
                    if (s.has(r.promocionId)) s.delete(r.promocionId); else s.add(r.promocionId);
                    return s;
                  })
                }
              />
            </View>
          );
        })}
      </Tarjeta>
```

    (`Opcion` con `seleccionada={false}` para la elección pendiente; cuando ya hay elección la lista no se
    pinta y se muestra la etiqueta elegida. Si `Boton` no admite `ancho="ajustado"`, usa la prop que exista
    en `boton.tsx` para un botón no expandido.)
  - El total abajo sigue mostrando `pieza(s) · N de promoción`.

- [ ] **Paso 4: Venta — revisión**: después de la tarjeta "Productos", si `regalos.length > 0`, una tarjeta
  "Regalos" con `<Cifra valor={r.cantidad} /> × {etiqueta de la presentación} · {r.texto}` por regalo. Lo demás
  igual.

- [ ] **Paso 5: Verifica**

```bash
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm test --workspace=apps/tablet
npm run export --workspace=apps/tablet
```

  Si tienes emulador (`~/Library/Android/sdk/platform-tools/adb devices`), lanza la app contra el backend
  local y recorre: ficha de un cliente con promoción, venta con 25 piezas → "+2 gratis", descartar, grabar;
  anótalo en el reporte como hecho o como SIN VERIFICAR (la aceptación formal es la Tarea 13).

- [ ] **Paso 6: Commit**

```bash
git add "apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx" "apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx"
git commit -m "T-74: tablet — promociones en la ficha y regalos calculados en la venta; fuera el campo de promoción

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 10: Portal — `lib/promociones.ts`: tipos, llamadas, la frase y la validación en vivo

**Files:**
- Create: `apps/portal/src/lib/promociones.ts`
- Create: `apps/portal/src/lib/promociones.test.ts`

**Interfaces:**
- Consumes: la API de la Tarea 3 (`GET/POST/PATCH /promociones`), `apiFetch`, `Producto` de
  `lib/productos.ts`.
- Produces (los usan las Tareas 11 y 12):

```ts
export type AudienciaPromocion = "todos" | "cliente" | "prospecto";
export type CompraPromocion = "cualquiera" | "producto" | "presentacion";
export type RegaloPromocion = "mismo" | "producto" | "presentacion";
/** Copia normativa de `Promocion` de apps/backend/src/modules/cartera-clientes/promociones.repository.ts. */
export interface Promocion { id; sucursalId; sucursalCodigo; activo; audiencia; clienteId; clienteNombre; compraTipo; compraProductoId; compraPresentacionId; compraCantidad; regaloTipo; regaloProductoId; regaloPresentacionId; regaloCantidad; seRepite; compraNombre; regaloNombre; compraProductoCubierto; texto; desplazada?: boolean }
/** El cuerpo de `POST` (plano, como el DTO). */
export interface DatosPromocion { sucursalId?: string; audiencia; clienteId?: string; compraTipo; compraProductoId?: string; compraPresentacionId?: string; compraCantidad: number; regaloTipo; regaloProductoId?: string; regaloPresentacionId?: string; regaloCantidad: number; seRepite: boolean }
export function listarPromociones(filtro: { sucursal: string | null } | { clienteId: string }): Promise<Promocion[]>;
export function crearPromocion(datos: DatosPromocion): Promise<Promocion[]>;
export function editarPromocion(id: string, datos: Omit<DatosPromocion, "sucursalId" | "audiencia" | "clienteId"> & { activo: boolean }): Promise<Promocion>;
export function textoPromocion(regla: ReglaPromocion, nombres: NombresPromocion): string;   // copia de la del backend
export function problemaDeRegla(r: ReglaCompleta): string | null;                           // copia de la del backend
/** Resuelve los nombres de la regla a partir del catalogo de productos del portal. */
export function nombresDe(datos: Pick<DatosPromocion, "compraTipo" | "compraProductoId" | "compraPresentacionId" | "regaloTipo" | "regaloProductoId" | "regaloPresentacionId">, productos: Producto[]): NombresPromocion;
```

- [ ] **Paso 1: Pruebas** — `promociones.test.ts` (plantilla: `lib/rutas.test.ts`, con `apiFetch` mockeado):
  - `listarPromociones({ sucursal: "TJ" })` llama a `/promociones?sucursal=TJ`; `({ clienteId: "c1" })` a
    `/promociones?clienteId=c1`; `({ sucursal: null })` a `/promociones`.
  - `crearPromocion` hace `POST /promociones` con el cuerpo tal cual; `editarPromocion` hace `PATCH
    /promociones/<id>`.
  - `textoPromocion`: los **mismos siete casos** de la Tarea 3.
  - `problemaDeRegla`: los **mismos casos** de la Tarea 3.
  - `nombresDe`: con productos `[{id:"p1", nombre:"Jawa", activo:true, presentaciones:[{id:"pr1",
    volumen:"600 ml"}]}]`, compra producto `p1` → `compra: "Jawa"`; compra presentación `pr1` → `"Jawa 600
    ml"`; regalo `mismo` → `regalo: null`; ids desconocidos → `null`.

- [ ] **Paso 2: Corre** `npm test --workspace=apps/portal -- promociones` → falla.

- [ ] **Paso 3: `promociones.ts`** — las llamadas con `apiFetch` (como `lib/rutas.ts`), `textoPromocion` y
  `problemaDeRegla` **copiadas** del backend (Tarea 3, Pasos 3 y 5; cambia solo las comillas al estilo del
  portal y el `import type` por tipos locales), con el comentario de "copia normativa" que ya usa
  `lib/clientes.ts`; y:

```ts
export function nombresDe(datos, productos: Producto[]): NombresPromocion {
  const producto = (id?: string) => productos.find((p) => p.id === id)?.nombre ?? null;
  const presentacion = (id?: string) => {
    for (const p of productos) {
      const pr = p.presentaciones.find((x) => x.id === id);
      if (pr) return `${p.nombre} ${pr.volumen}`;
    }
    return null;
  };
  return {
    compra: datos.compraTipo === "producto" ? producto(datos.compraProductoId) : datos.compraTipo === "presentacion" ? presentacion(datos.compraPresentacionId) : null,
    regalo: datos.regaloTipo === "producto" ? producto(datos.regaloProductoId) : datos.regaloTipo === "presentacion" ? presentacion(datos.regaloPresentacionId) : null,
  };
}
```

- [ ] **Paso 4: Corre** las pruebas → pasan; `npm exec --workspace=apps/portal -- tsc --noEmit`; `npm run lint
  --workspace=apps/portal`.

- [ ] **Paso 5: Commit**

```bash
git add apps/portal/src/lib/promociones.ts apps/portal/src/lib/promociones.test.ts
git commit -m "T-74: portal — lib/promociones: llamadas, frase y validación en vivo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 11: Portal — zona Operación › Promociones: lista, formulario, página y menú (D4, D8, D11, D19)

**Files:**
- Create: `apps/portal/src/components/promociones/formulario-promocion.tsx` (+ `.test.tsx`)
- Create: `apps/portal/src/components/promociones/pantalla-promociones.tsx` (+ `.test.tsx`)
- Create: `apps/portal/src/app/(portal)/operacion/promociones/page.tsx`
- Modify: `apps/portal/src/components/layout/nav-config.ts`
- Modify: `apps/portal/src/components/usuarios/matriz-permisos-usuario.tsx`

**Interfaces:**
- Consumes: Tarea 10; `PantallaCatalogo`, `useEnvioFormulario`, `useAuth`, `listarProductos`,
  `listarSucursales`.
- Produces: `FormularioPromocion` con estas props (la Tarea 12 lo reutiliza desde el cliente):

```ts
interface Props {
  promocion: Promocion | null;                       // editar, o null para alta
  /** Desde la zona: la sucursal del selector global. Desde el cliente: el cliente (audiencia fija). */
  contexto: { tipo: "sucursal"; sucursal: string | null } | { tipo: "cliente"; clienteId: string; clienteNombre: string };
  alGuardar: () => void;
  alCancelar: () => void;
}
```

- [ ] **Paso 1: Pruebas del formulario** — `formulario-promocion.test.tsx` (mocks de `@/lib/promociones`,
  `@/lib/productos`, `@/lib/sucursales` y `@/components/auth/auth-provider`, como
  `pantalla-ruta-diaria.test.tsx`; productos: Jawa con 600 ml y 1 L, Horchata con 1 L):
  - "muestra la frase en vivo": elegir *Para todos*, compra *producto* Jawa, 10, regalo *del mismo*, 1, se
    repite → aparece el texto `Por cada 10 Jawa, 1 Jawa gratis`.
  - "bloquea Guardar y explica cuando la regla no cuadra": compra *cualquier producto* + regalo *del mismo*
    → el botón Guardar deshabilitado y el mensaje de `problemaDeRegla` visible.
  - "comprar 0 solo con prospectos": con *Para todos* y 0 → mensaje; con *Prospectos* y 0 → frase de
    bienvenida y Guardar habilitado.
  - "un General elige sucursal o todas; un usuario atado no ve el selector" (`usuario.sucursal === null` vs
    `{codigo:"TJ"}`).
  - "desde el cliente la audiencia es fija y manda `clienteId`": `contexto: {tipo:"cliente", clienteId:"c1",
    clienteNombre:"Abarrotes"}` → no hay radio de audiencia, se ve "Para Abarrotes", y al guardar
    `crearPromocion` recibe `{ audiencia: "cliente", clienteId: "c1", ... }` sin `sucursalId`.
  - "editar manda la regla completa y `activo`": con `promocion` existente, cambiar cantidad y desmarcar
    *Activa* → `editarPromocion(id, {..., activo: false})`.
  - "un error de la API se muestra tal cual" (`ErrorApi` con `mensajeApi`).

- [ ] **Paso 2: Pruebas de la pantalla** — `pantalla-promociones.test.tsx`:
  - "sin permiso no hay botón Nueva ni Editar"; "mientras carga la sesión dice Cargando…".
  - "lista por sucursal con frase, para quién y estado": dos promociones (`todos` activa, `prospecto`
    inactiva) → filas con `texto`, "Todos los clientes" / "Prospectos (primera venta)", "Activa" /
    "Inactiva" atenuada.
  - "Nueva promoción abre el formulario con la sucursal del selector".
  - "recarga al cambiar el selector global" (`deps=[sucursal]`).

- [ ] **Paso 3: Corre** → fallan. **Paso 4: Implementa.**
  - `pantalla-promociones.tsx`: `PantallaCatalogo<Promocion>` con `titulo="Promociones"`,
    `permiso="promocion.gestionar"`, `etiquetaAlta="Nueva promoción"`, `cargar={() =>
    listarPromociones({ sucursal })}`, `deps={[sucursal]}`, columnas *Promoción* (`texto`), *Para quién*
    (`audiencia === "todos" ? "Todos los clientes" : "Prospectos (primera venta)"`), *Sucursal*
    (`sucursalCodigo`, mono), *Estado* (como vehículos), y `formulario={(item, alGuardar, alCancelar) =>
    <FormularioPromocion promocion={item} contexto={{ tipo: "sucursal", sucursal }} alGuardar={alGuardar}
    alCancelar={alCancelar} />}`. Un General **sin** sucursal en el selector: `listarPromociones` devolverá 400
    ("Elige una sucursal…"): muestra ese mensaje (ya lo hace `useCatalogo` con `mensajeError` → usa
    `mensajeDe` si el hook lo permite; si no, un `<p>` previo: "Elige una sucursal en el selector de arriba
    para ver sus promociones." cuando `usuario.sucursal === null && !sucursal`, sin llamar a la API).
  - `formulario-promocion.tsx`: estado por campo (`audiencia`, `sucursalId` con `"todas"` como opción,
    `compraTipo`, `compraProductoId`, `compraPresentacionId`, `compraCantidad` texto, `regaloTipo`,
    `regaloProductoId`, `regaloPresentacionId`, `regaloCantidad` texto, `seRepite`, `activo`); carga
    `listarProductos()` (activos) y, si procede, `listarSucursales()` (activas); `regla` memoizada →
    `problema = problemaDeRegla(regla)`; `frase = problema ? null : textoPromocion(regla, nombresDe(regla,
    productos))`; `<p aria-live="polite">` con la frase o el problema; selects de producto y presentación
    (la de presentación lista "Producto · volumen" de todos los productos); `useEnvioFormulario("No se pudo
    guardar la promoción.")`; `alEnviar` → `crearPromocion` / `editarPromocion` con el cuerpo plano. Al
    editar: audiencia, cliente y sucursal se muestran como texto, no se editan; aparece la casilla *Activa*.
    Etiquetas: "Para quién" (Todos los clientes · Prospectos, solo en su primera venta · [Este cliente]),
    "Qué compra" (Cualquier producto · Un producto · Una presentación · Cantidad), "Qué regala" (Del mismo ·
    Un producto · Una presentación · Cantidad), "Se repite por bloques", "Sucursal" (… · Todas las sucursales
    — crea una por sucursal).
  - `page.tsx`: copia de `operacion/ruta-diaria/page.tsx` con `PantallaPromociones`.
  - `nav-config.ts`: `{ label: "Promociones", href: "/operacion/promociones" }` después de "Reporte de
    Ventas".
  - `matriz-permisos-usuario.tsx`: `"promocion.gestionar": "Puede crear, editar y desactivar las promociones
    (regalos por compra) para clientes, para todos o para prospectos."`.

- [ ] **Paso 5: Verifica** `npm test --workspace=apps/portal`, `npm exec --workspace=apps/portal -- tsc
  --noEmit`, `npm run lint --workspace=apps/portal`. Si puedes levantar el portal contra el backend local,
  revisa que la tabla quepa a 1366 px (regla del repo, CLAUDE.md "Reportes y Excel").

- [ ] **Paso 6: Commit**

```bash
git add apps/portal
git commit -m "T-74: portal — zona Promociones: lista por sucursal, formulario con frase en vivo, página y menú

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 12: Portal — el formulario de cliente: fuera el enum, dentro sus promociones (D5, D10)

**Files:**
- Create: `apps/portal/src/components/clientes/promociones-de-cliente.tsx` (+ `.test.tsx`)
- Modify: `apps/portal/src/components/clientes/formulario-cliente.tsx`
- Modify: `apps/portal/src/components/clientes/pantalla-clientes.tsx` (+ `pantalla-clientes.test.tsx`)
- Modify: `apps/portal/src/lib/clientes.ts`

**Interfaces:**
- Consumes: `listarPromociones({ clienteId })`, `editarPromocion`, `FormularioPromocion` (Tareas 10, 11);
  `ClienteDetalle` sin `promocion`/`productosPromocion` y con `primeraVentaEn` (Tarea 1).

- [ ] **Paso 1: Pruebas** — `promociones-de-cliente.test.tsx`:
  - "sin `promocion.gestionar` no se pinta nada".
  - "lista las propias con Editar y Desactivar, y las generales atenuadas con «(desplazada por una propia)»
    cuando `desplazada`".
  - "Desactivar llama a `editarPromocion` con la regla completa y `activo: false` y recarga".
  - "Nueva promoción para este cliente abre `FormularioPromocion` con `contexto.tipo === "cliente"`".
  Y en `pantalla-clientes.test.tsx` quita las aserciones del enum (select "Promoción", checkboxes de
  productos) y añade "al editar un cliente se ve el bloque Promociones de este cliente; al dar de alta no".

- [ ] **Paso 2: Corre** → fallan. **Paso 3: Implementa.**
  - `promociones-de-cliente.tsx` (`"use client"`): props `{ clienteId: string; clienteNombre: string }`;
    `useAuth().puede("promocion.gestionar")` → `null` si no; carga `listarPromociones({ clienteId })`; dos
    listas: *Promociones de este cliente* (`audiencia === "cliente"`: frase, estado, botones *Editar* y
    *Desactivar*/*Reactivar*) y *Generales de su sucursal* (`audiencia === "todos"`, `className` atenuada,
    sufijo "(desplazada por una propia)" si `desplazada`); botón *Nueva promoción para este cliente* que
    monta `FormularioPromocion` con `contexto: { tipo: "cliente", clienteId, clienteNombre }` y recarga al
    guardar; errores con `mensajeDe`.
  - `formulario-cliente.tsx`: fuera `Promocion`, `promocion`, `productosPromocion`, `alternarProducto`, el
    `<fieldset>` de promoción (deja % comisión y plazo de crédito en su bloque "Comisión y crédito"), y
    `promocion`/`productosPromocion` del `datos` que se envía. En **edición** (`cliente !== null`), después
    del bloque de precios: `<PromocionesDeCliente clienteId={cliente.id} clienteNombre={cliente.nombre} />`.
    Si `listarProductos` solo se usaba para la promoción, quítalo; si lo usan los overrides de precio,
    déjalo.
  - `lib/clientes.ts`: fuera `Promocion`, `promocion`, `productosPromocion` de `ClienteDetalle` y
    `DatosClienteFormulario`; dentro `primeraVentaEn: string | null` en `ClienteDetalle`.
  - `pantalla-clientes.tsx`: solo si algo pintaba la promoción en la tabla (comprueba con `grep -n promocion`).

- [ ] **Paso 4: Verifica** `npm test --workspace=apps/portal`, `tsc --noEmit`, `lint`.

- [ ] **Paso 5: Commit**

```bash
git add apps/portal
git commit -m "T-74: portal — el formulario de cliente cambia el enum de promoción por sus promociones por regla

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tarea 13: Cierre — documentación, verificación completa y aceptación manual

**Files:**
- Modify: `CLAUDE.md` (bloque **Promociones (T-74)** después de "Ruta diaria (T-37)")
- Modify: `apps/tablet/README.md` (migración 012, `promociones-reglas.ts`, la venta ya no acepta promoción a
  mano)
- Modify: `docs/contrato-sincronizacion.md` solo si algo de las Tareas 4–8 cambió lo escrito en la 2.

- [ ] **Paso 1: `CLAUDE.md`** — un bloque con el estilo de los anteriores (viñetas de una idea), que diga:
  tabla `promocion` y su regla (D1–D8 en una línea cada una), `venta_nota_promocion` con la frase congelada,
  `cliente.primera_venta_en` lo marca `VentasService` y toca `updated_at`, la regla de aplicación vive **solo
  en la tablet** (`src/datos/promociones-reglas.ts`), el servidor valida la forma de `regalos` y no la regla
  (D13), editar una nota desde el portal borra `venta_nota_promocion` (D15), el portal registra ventas con
  promoción libre (D9), la frase está copiada en tres sitios y las tres copias comparten pruebas, el permiso
  `promocion.gestionar`, y el pre-flight de D10 para quien empuje la migración.

- [ ] **Paso 2: `apps/tablet/README.md`** — donde liste migraciones y repositorios: la 012, el repositorio
  `promociones`, `venta_promocion`, y que el campo "Promoción" de la captura desapareció (D6).

- [ ] **Paso 3: Verificación completa** (la lista de *Línea base*, entera, más `npm run export
  --workspace=apps/tablet` y `npm run db:types --workspace=apps/backend` con `git diff --exit-code
  apps/backend/src/database/schema.d.ts`). Anota los conteos finales frente a la línea base.

- [ ] **Paso 4: Aceptación manual** (spec § "Aceptación manual en el emulador"), contra el Postgres local, con
  el backend en 3000 (`DATABASE_URL` del `.env.test`), el portal en 3001 si el puerto está libre (si no, los
  pasos del portal se hacen por `curl` con la cookie y se anotan como **SIN VERIFICAR en UI**) y la app en el
  emulador (`npx expo run:android --port 8082 --device Pixel_7`, `adb reverse tcp:3000 tcp:3000`; `adb` está en
  `~/Library/Android/sdk/platform-tools/`). Vendedor `demo`/`demo1234`; usuario de portal `t37admin` /
  `t37admin1234` (Administrador General) si sigue en la base, o crea uno con `crear-usuario`. **Antes de
  instalar la app, sincroniza** (migración 012). Los 9 pasos del spec, con esta corrección al **paso 5**: el
  prospecto capturado en la tablet **no es vendible hasta que sube y vuelve a bajar** como cliente `tipo =
  'prospecto'` (vive en la tabla local `prospecto` hasta entonces, ver *Conflictos* 1), así que: capturar el
  prospecto → sincronizar → abrir su ficha (ya con la bienvenida) → venta de solo regalo → segunda venta sin
  bienvenida → sincronizar → comprobar `primera_venta_en` y `venta_nota_promocion`. Anota por paso: OK / FALLA
  (con lo visto) / SIN VERIFICAR (con el motivo), y guarda capturas en el scratchpad de la sesión.

- [ ] **Paso 5: Commit**

```bash
git add CLAUDE.md apps/tablet/README.md docs/contrato-sincronizacion.md
git commit -m "T-74: documentación — bloque de promociones en CLAUDE.md, README de la tablet y contrato

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Modelo sugerido por tarea

| Tarea | Qué | Implementador | Revisor |
|---|---|---|---|
| 1 | Migración + pgTAP + tipos + limpieza del enum en el backend | `sonnet` | `sonnet` |
| 2 | Contrato en los dos lados + `docs/` | `haiku` | `sonnet` |
| 3 | Frase, reglas puras, CRUD con alcance, e2e | `sonnet` | **`opus`** |
| 4 | Pull `promociones()` + e2e | `sonnet` | `sonnet` |
| 5 | Push `regalos`, trazabilidad, `primera_venta_en`, borrado al editar | **`opus`** | **`opus`** |
| 6 | Tablet: migración 012, tipos, snapshot | `sonnet` | `sonnet` |
| 7 | Tablet: reglas puras (el corazón de D5/D6/D7/D16) | **`opus`** | **`opus`** |
| 8 | Tablet: repositorio, venta con regalos, push | `sonnet` | **`opus`** |
| 9 | Tablet: ficha y pantalla de venta | **`opus`** | `sonnet` |
| 10 | Portal: `lib/promociones.ts` | `haiku` | `sonnet` |
| 11 | Portal: zona Promociones | `sonnet` | `sonnet` |
| 12 | Portal: formulario de cliente | `sonnet` | `sonnet` |
| 13 | Documentación, verificación y aceptación manual | `sonnet` | controlador |

`haiku` donde el plan trae el código completo y la tarea es transcribir (2, 10); `sonnet` donde hay que
integrar varios archivos; `opus` en el cálculo de regalos (es la regla de negocio entera, con empates, NaN y
catálogos a medias), en la proyección del servidor (transacción, trazabilidad, `primera_venta_en`) y en la
pantalla de venta (estado derivado en cadena). Revisión `opus` además en el CRUD (alcance por sucursal con
`'todas'` y clientes ajenos) y en el repositorio de la tablet (lo que graba es lo que sube).

---

## Autorrevisión del plan (hecha al escribirlo)

1. **Cobertura del spec.** D1–D8 → Tareas 1, 3, 7; D9 → Tarea 5 (`regalos: []` del portal) y Tarea 12 (la venta
   del portal no se toca); D10 → Tarea 1 (guardia) y 12 (sin enum); D11 → Tarea 9; D12 → Tareas 1, 5, 8;
   D13 → Tareas 2, 5; D14 → Tareas 1, 4, 5, 7, 8; D15 → Tarea 5; D16 → Tareas 7, 9; D17 → Tareas 1, 2, 6; D18 →
   Tarea 7; D19 → Tareas 1, 3, 11; D20 → Tarea 3. Portal (zona, formulario, cliente) → 10, 11, 12. Aceptación →
   13. **Sin tarea**: ninguna. Lo que el spec deja a la pieza 3 (fotos del servidor) no entra.
2. **Marcadores.** Sin "TBD"/"TODO"/"similar a". Donde el plan dice "como en X" trae además el código o la
   lista exacta de casos.
3. **Consistencia de nombres.** `textoPromocion(regla, nombres)` en backend y portal; `textoPromocion(p,
   catalogo)` en la tablet (firma distinta a propósito: la tablet resuelve nombres por el catálogo local; las
   siete pruebas son las mismas). `problemaDeRegla` (backend, portal). `coincidenEnProducto(a, b)` igual en
   los tres. `Regalo`, `calcularRegalos`, `aplicarRegalos`, `problemasDeRegalos`, `promocionesAplicables`
   (Tarea 7) ↔ Tareas 8 y 9. `RegaloRegistroVenta` y `DatosRegistroVenta.regalos` (Tarea 8) ↔ Tarea 9.
   `regalosDe`, `hayAlgunaDe` (Tarea 8) ↔ `fuente-ventas` y `promociones.ts`. `RegaloVenta`/`regalos` del
   contrato (Tarea 2) ↔ Tareas 5 y 8. `PromocionPull.se_repite: boolean` ↔ `Promocion.se_repite: Booleano`
   con la conversión en `aSnapshot` (Tarea 6). `primera_venta_en` (snake, cable y SQLite) ↔ `primeraVentaEn`
   (API del portal).
4. **Review Focus.** Las cinco entradas tienen prueba: 1 y 2 y 5 en la Tarea 7; 3 en las Tareas 5 y 8; 4 en las
   Tareas 3 y 5.

---

## Conflictos para el controlador

Ninguno cambia D1…D20. Son premisas del spec que el código no sostiene tal cual, y cómo se resolvieron:

1. **El prospecto capturado en la tablet no es vendible hasta que sube y baja.** El spec (aceptación, paso 5)
   da a entender que tras capturar el prospecto se le puede vender de inmediato. En la app, un prospecto nuevo
   vive en la tabla local `prospecto` (T-40) y **no existe en `cliente`** hasta que el servidor lo acepta y el
   pull lo devuelve como `tipo = 'prospecto'`; la ficha y la venta leen `cliente`. La promoción de bienvenida
   funciona exactamente como dice D7, solo que **después de la primera sincronización**. El plan corrige el
   paso 5 de la aceptación (Tarea 13) y no toca D7. Si Mario quiere vender al prospecto antes de sincronizar,
   es otro ticket (la venta necesitaría un `cliente_id` que aún no existe).
2. **DTO plano en vez de anidado.** El spec dibuja el cuerpo del `POST` como `{ compra: {...}, regalo: {...} }`.
   El plan usa campos planos (`compraTipo`, `compraProductoId`, …) como todos los DTOs del repo
   (`class-validator` anidado exige `@ValidateNested` + `@Type` por campo y no aporta nada aquí). La forma de
   la **respuesta** también es plana. Es solo la forma del cuerpo: si Mario prefiere el anidado, es cambiar el
   DTO, el servicio y `lib/promociones.ts`.
3. **`PATCH /promociones/:id/activo` no existe**: `activo` va dentro de `PATCH /promociones/:id`, como en
   vehículos, para que la pantalla reutilice `PantallaCatalogo` (el formulario lleva la casilla *Activa*). Misma
   semántica (desactivar y reactivar), un endpoint menos.
4. **`GET /promociones` sin `clienteId` exige una sucursal.** El spec dice "selector de sucursal"; para un
   General sin sucursal en el selector global el backend responde 400 con mensaje y la pantalla lo explica en
   vez de listar "todas" (una promoción es de **una** sucursal y mezclarlas confundiría; el usuario atado nunca
   llega ahí).
5. **La ventana de dos tablets con el mismo prospecto** (D14) se acepta tal cual; además, la tablet consulta
   **sus** ventas locales (`hayAlgunaDe`) para no dar dos bienvenidas el mismo día antes de sincronizar.
6. **La columna local `cliente.promocion` se queda** (SQLite no la quita sin rehacer la tabla; tiene default).
   El snapshot deja de escribirla y nada la lee. El spec ya lo preveía ("la columna local se queda").

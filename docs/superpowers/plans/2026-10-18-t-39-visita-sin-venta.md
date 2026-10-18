# T-39 · Visita sin venta y motivo de no surtido — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el vendedor deje constancia, sin red, de por qué un cliente de la ruta no compró (motivo de un
catálogo de la oficina, hora, quién atendió, dónde estaba y foto cuando el motivo la exige); que la visita suba en
el push como operación nueva `visita`, se proyecte a la tabla `visita` y su foto llegue por el canal de fotos; que la
ruta del día mande al cliente visitado a "Visitados sin venta"; y que la ficha baje la foto del cliente del servidor.

**Architecture:** el servidor gana el catálogo global `motivo_visita` (CRUD del portal con baja lógica, baja en el
pull como `motivos_visita`) y la tabla `visita`, cuyo `id` es la clave de la operación (como el prospecto en T-75).
`prepararVisita` valida la forma antes de la transacción y `VisitasService.registrarVisita` (módulo `rutas`, ADR-0009)
proyecta dentro de ella; el servidor **no** revisa "exige foto/nombre". El canal `POST /sync/foto/:clave` acepta
prospectos y visitas, nombra los archivos por id (`cliente-<id>.jpg`, `visita-<id>.jpg`, T-78) y gana la descarga
`GET /sync/foto/cliente/:clienteId`. En la tablet, la migración local 013 trae `motivo_visita` y `visita`; todo lo
decidible vive en funciones puras con prueba (`validarVisita`, `agruparRuta`, `atendidosFueraDeRuta`, `fotoParaFicha`,
`combinarFuentesFotos`) y las pantallas solo pintan.

**Tech Stack:** NestJS 11 + Kysely (backend), Postgres local vía Supabase (e2e, pgTAP), Next.js 15 + Vitest +
Testing Library (portal), Expo SDK 57 / React Native + SQLite + Jest en Node (tablet; sin pruebas de pantalla).

**Spec:** `docs/superpowers/specs/2026-10-18-t-39-visita-sin-venta-design.md` — léelo antes de empezar. Sus
decisiones D1…D9 **no se renegocian**. Si este plan lo contradice, manda el spec: para y pregunta.

---

## Global Constraints

Copiadas del spec y del repo. Cada tarea las incluye:

- Rama `feature/t-39-visita-sin-venta`. Todos los comandos **desde la raíz del worktree**
  (`/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-t39`), con los scripts del workspace
  (`--workspace=apps/...`). **Nunca** entres a `../proyecto-sinmex` (clon de demo) ni a otro clon.
- **`CONTRATO_ACTUAL` sigue en 1.** Todo cambio del cable es aditivo (tipo nuevo, colección nueva, campo nuevo).
- **Los tipos del contrato están duplicados**: `apps/backend/src/modules/sincronizacion/contrato.ts` (normativo) y
  `apps/tablet/src/sincronizacion/contrato.ts`. Si una tarea toca uno, toca el otro **y**
  `docs/contrato-sincronizacion.md` **en el mismo commit**.
- El tipo de la operación nueva es **`visita`** (no `ruta`, que sigue reservado y guardado sin proyectar).
- Códigos de rechazo nuevos, exactos: **`motivo-visita-inexistente`** y **`visita-id-ocupado`**. El motivo de
  `visita-id-ocupado` es **neutro** (no confirma qué registro ocupa el id), como `id-ocupado` en T-75.
- **El servidor no revisa `exige_foto` ni `exige_atendio`**: lo exige la tablet al guardar (`validarVisita`).
- **Un motivo dado de baja se acepta** en el push (el vendedor lo eligió sin red cuando estaba vivo). Solo un id que
  no existe en `motivo_visita` se rechaza.
- **Orden del push**: `jornadas → prospectos → ventas → cobranzas → visitas → rutas` (`fuentesDelPush`, con prueba).
- **Sin RLS**: el alcance lo pone el backend (sucursal y vendedor del token), como en todo el repo.
- ADR-0009: **una transacción por operación**; una operación rechazada **no deja fila** (ni buzón ni negocio).
- `fecha_operacion` la manda la tablet; **el servidor no la re-deriva de UTC**.
- Base de datos: **nunca `db reset`**. Migraciones locales solo con `npm run supabase -- migration up --local` (con el
  `--`). Supabase local es **compartido entre sesiones**. **Nunca apuntes nada a la nube** (`sinmex dev`): `.env.test`
  va a `127.0.0.1:54322`; no se corre `db push` ni nada con `--db-url`.
- Backend: lint **solo por archivo**: `npm exec --workspace=apps/backend -- prettier --write <archivos>` y
  `npm exec --workspace=apps/backend -- eslint <archivos>`. **Nunca** `npm run lint --workspace=apps/backend` (lleva
  `--fix` y reescribe archivos ajenos). Typecheck del backend = `npm run build --workspace=apps/backend`. Pruebas:
  `npm test --workspace=apps/backend -- <patrón>` y `npm run test:e2e --workspace=apps/backend -- <patrón>`.
- Los e2e **siembran lo que usan** con sufijo `${Date.now()}-${process.pid}` y lo borran en `afterAll` en orden
  inverso a las llaves foráneas: el Postgres de CI no tiene catálogo propio.
- Portal: `npm test --workspace=apps/portal -- <patrón>`, `npx tsc --noEmit -p apps/portal`,
  `npm run lint --workspace=apps/portal`.
- Tablet: `npm run typecheck --workspace=apps/tablet`, `npm run lint --workspace=apps/tablet`,
  `npm test --workspace=apps/tablet -- <patrón>`. Las pruebas son **solo** `src/**/*.spec.ts` en Node: nada de
  pantallas. **La lógica de la tablet vive en funciones puras con pruebas de Jest**; la pantalla solo la llama.
- Migraciones locales de la tablet: **nunca se edita una publicada** (001…012); la nueva es la 013.
- Código en español, **identificadores sin acentos**, **textos al usuario en español con acentos** ("Visita
  registrada", "Buscando ubicación…"). Comentarios que explican *por qué*; sigue el estilo del archivo que tocas.
- `git status` limpio al terminar cada tarea; un commit por tarea (o más si el implementador lo prefiere), con el
  trailer exacto en la última línea del mensaje: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Lo que el spec implica y ninguna prueba cubriría si no se añade aquí; cada línea se pinó en la tarea dueña:

1. **El pull da de baja el motivo con la pantalla de visita abierta** → la visita se guarda igual en la tablet y el
   servidor la acepta. Tarea 8 (`visitas.registrar` con motivo inactivo) y Tarea 3 (e2e del motivo dado de baja).
2. **Sin GPS el vendedor escribe la dirección y después llega la ubicación** (botón "Volver a intentar") → se guardan
   las dos cosas, y el campo de dirección no desaparece. Tarea 9 (`validarVisita`).
3. **Cliente con visita y venta el mismo día** → sigue en la ruta con su palomita, no en "Visitados sin venta"; y si
   todos los de la ruta fueron visitados sin venta, la pantalla **no** dice "Sin ruta". Tarea 9 (`agruparRuta`,
   `sinRutaAsignada`, `rutas.delDia`).
4. **Dos visitas al mismo cliente el mismo día** → la fila de "Visitados sin venta" muestra la **última** (motivo y
   hora) y el estado de subida más grave de las dos. Tarea 9 (`rutas.delDia`).
5. **La WiFi se cae después de aplicar** y la tablet reenvía la visita y su foto → `duplicada`, una sola fila en
   `visita` y un solo archivo `visita-<id>.jpg`. Tarea 3 (e2e del reenvío) y Tarea 5 (e2e de la foto dos veces).

---

### Tarea 1: Migración del servidor: `motivo_visita`, `visita` y el permiso (D1, D2, D5)

**Files:**
- Create: `supabase/tests/99_visita_test.sql`
- Create: `supabase/migrations/20261018120000_visita_sin_venta.sql`
- Modify (generado): `apps/backend/src/database/schema.d.ts`

**Interfaces:**
- Consumes: tablas `vendedor`, `sucursal`, `cliente`, `permiso`; la semilla de sucursal `TJ`.
- Produces: tablas `motivo_visita` (`id, nombre, exige_foto, exige_atendio, deleted_at, creado_en, actualizado_en`)
  y `visita` (`id, vendedor_id, sucursal_id, cliente_id, motivo_visita_id, fecha, visitada_en, observaciones,
  atendio, lat, lng, precision_m, direccion_texto, foto_archivo, foto_subida_en, creado_en`); función
  `set_actualizado_en()`; índice `uq_motivo_visita_nombre`; permiso `motivo-visita.gestionar` (grupo `Catálogo`);
  interfaces Kysely `MotivoVisita` y `Visita` en `DB` (`'motivo_visita'`, `'visita'`).

> Las columnas de tiempo del catálogo se llaman `creado_en`/`actualizado_en` **porque así lo fija el spec (D1)**.
> El trigger genérico `set_updated_at()` escribe `updated_at`, así que la migración trae su gemelo
> `set_actualizado_en()`: así la baja lógica y cualquier edición mueven `actualizado_en` sin depender de que el
> repositorio se acuerde (el pull incremental de la Tarea 4 corta por esa columna).

- [ ] **Paso 1: la prueba pgTAP que falla**

`supabase/tests/99_visita_test.sql`:

```sql
begin;
select plan(16);

-- T-39: lo que la BASE garantiza del catalogo de motivos y de la visita aunque
-- alguien escriba por debajo del servicio. Prefijo `ZZ-pgtap-T39`.

select has_table('motivo_visita', 'existe el catalogo de motivos de visita');
select has_table('visita', 'existe la tabla de visitas');

select is(
  (select count(*)::int from motivo_visita
    where deleted_at is null
      and nombre in ('Tenía producto', 'Sin dinero', 'No estaba el encargado', 'Competencia', 'Cerrado')),
  5, 'la semilla trae los cinco motivos del cliente');

select is(
  (select exige_foto and exige_atendio from motivo_visita
    where nombre = 'No estaba el encargado' and deleted_at is null),
  true, '"No estaba el encargado" exige foto y nombre de quien atendio');

select is(
  (select exige_foto and not exige_atendio from motivo_visita
    where nombre = 'Cerrado' and deleted_at is null),
  true, '"Cerrado" exige foto y no nombre');

select is(
  (select count(*)::int from motivo_visita
    where deleted_at is null and (exige_foto or exige_atendio)
      and nombre in ('Tenía producto', 'Sin dinero', 'Competencia')),
  0, 'los otros tres motivos no exigen nada');

select throws_ok(
  $$insert into motivo_visita (nombre) values ('  cerrado ')$$,
  '23505', null, 'el nombre es unico entre vivos sin importar mayusculas ni espacios');

select throws_ok(
  $$insert into motivo_visita (nombre) values ('   ')$$,
  '23514', null, 'el nombre no puede quedar vacio');

insert into motivo_visita (nombre) values ('ZZ-pgtap-T39 Motivo');
update motivo_visita set deleted_at = now() where nombre = 'ZZ-pgtap-T39 Motivo';

select lives_ok(
  $$insert into motivo_visita (nombre) values ('ZZ-pgtap-T39 Motivo')$$,
  'dar de baja un motivo libera su nombre');

select is(
  (select count(*)::int from permiso where clave = 'motivo-visita.gestionar' and grupo = 'Catálogo'),
  1, 'existe el permiso motivo-visita.gestionar en el grupo Catálogo');

-- Fixtures propias de la visita: un vendedor y un prospecto de TJ (un prospecto
-- no exige domicilio ni lista de precios). Todo se va con el rollback.
insert into vendedor (login, nombre, password_hash, sucursal_id)
  values ('zz-pgtap-t39', 'Vendedor pgTAP T39', 'x', (select id from sucursal where codigo = 'TJ'));
insert into cliente (nombre, telefono, tipo, sucursal_id)
  values ('ZZ-pgtap-T39 Cliente', '6640000000', 'prospecto', (select id from sucursal where codigo = 'TJ'));

create temporary table _t39 on commit drop as
select
  (select id from vendedor where login = 'zz-pgtap-t39') as vendedor,
  (select id from sucursal where codigo = 'TJ') as sucursal,
  (select id from cliente where nombre = 'ZZ-pgtap-T39 Cliente') as cliente,
  (select id from motivo_visita where nombre = 'Cerrado' and deleted_at is null) as motivo;

select lives_ok(
  $$insert into visita (id, vendedor_id, sucursal_id, cliente_id, motivo_visita_id, fecha, visitada_en, lat, lng, precision_m)
    select gen_random_uuid(), vendedor, sucursal, cliente, motivo, date '2026-10-18', now(), 32.5149, -117.0382, 12 from _t39$$,
  'una visita con GPS entra');

select lives_ok(
  $$insert into visita (id, vendedor_id, sucursal_id, cliente_id, motivo_visita_id, fecha, visitada_en, direccion_texto)
    select gen_random_uuid(), vendedor, sucursal, cliente, motivo, date '2026-10-18', now(), 'Frente al parque' from _t39$$,
  'una visita sin GPS con direccion escrita entra');

select throws_ok(
  $$insert into visita (id, vendedor_id, sucursal_id, cliente_id, motivo_visita_id, fecha, visitada_en, direccion_texto)
    select gen_random_uuid(), vendedor, sucursal, cliente, motivo, date '2026-10-18', now(), '   ' from _t39$$,
  '23514', null, 'sin GPS y sin direccion no entra');

select throws_ok(
  $$insert into visita (id, vendedor_id, sucursal_id, cliente_id, motivo_visita_id, fecha, visitada_en, lat, direccion_texto)
    select gen_random_uuid(), vendedor, sucursal, cliente, motivo, date '2026-10-18', now(), 32.5, 'x' from _t39$$,
  '23514', null, 'lat y lng van juntas');

select throws_ok(
  $$insert into visita (id, vendedor_id, sucursal_id, cliente_id, motivo_visita_id, fecha, visitada_en, lat, lng)
    select gen_random_uuid(), vendedor, sucursal, cliente, motivo, date '2026-10-18', now(), 91, 0 from _t39$$,
  '23514', null, 'la latitud esta en rango');

select throws_ok(
  $$insert into visita (id, vendedor_id, sucursal_id, cliente_id, motivo_visita_id, fecha, visitada_en, direccion_texto, foto_archivo)
    select gen_random_uuid(), vendedor, sucursal, cliente, motivo, date '2026-10-18', now(), 'x', 'visita-x.jpg' from _t39$$,
  '23514', null, 'la foto va completa: archivo y fecha juntos');

select * from finish();
rollback;
```

- [ ] **Paso 2: correr y ver fallar**

`npm run supabase -- test db --local` → `99_visita_test.sql` falla en `has_table` (las tablas no existen). Las demás
suites siguen como estaban.

- [ ] **Paso 3: la migración**

`supabase/migrations/20261018120000_visita_sin_venta.sql`:

```sql
-- T-39: visita sin venta y motivo de no surtido.
-- Spec: docs/superpowers/specs/2026-10-18-t-39-visita-sin-venta-design.md
--
-- Dos tablas nuevas y vacias (mas la semilla del catalogo): no hay filas que
-- violen nada, asi que no hace falta pre-flight contra la nube.
--
-- * `motivo_visita` es un catalogo GLOBAL, como `tipo_negocio` (D1): la oficina
--   lo administra en el portal y baja en el pull como `motivos_visita`.
-- * `visita` guarda cada visita sin venta que sube la tablet (D2). Su `id` es la
--   clave de la operacion del push (como el prospecto en T-75), asi que la foto
--   se liga a ella sin ambiguedad. Sin FK a `jornada`: vendedor + fecha bastan.

-- Gemelo de `set_updated_at()` para las tablas que nombran sus tiempos
-- `creado_en`/`actualizado_en` (el spec de T-39 lo fija asi). El pull
-- incremental corta por `actualizado_en`, y la baja logica tiene que moverlo.
create or replace function set_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$;

create table motivo_visita (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null
    constraint ck_motivo_visita_nombre check (btrim(nombre) <> ''),
  exige_foto     boolean not null default false,
  exige_atendio  boolean not null default false,
  deleted_at     timestamptz,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Mismo patron que `uq_tesoreria_cuenta_nombre`: "Cerrado", "cerrado" y
-- " Cerrado " son el mismo motivo, y dar uno de baja libera su nombre.
create unique index uq_motivo_visita_nombre
  on motivo_visita (lower(btrim(nombre))) where deleted_at is null;

create trigger trg_motivo_visita_actualizado before update on motivo_visita
  for each row execute function set_actualizado_en();

-- Semilla del cliente (respuesta 3 de Mario, 2026-10-18).
insert into motivo_visita (nombre, exige_foto, exige_atendio) values
  ('Tenía producto',         false, false),
  ('Sin dinero',             false, false),
  ('No estaba el encargado', true,  true),
  ('Competencia',            false, false),
  ('Cerrado',                true,  false)
on conflict do nothing;

create table visita (
  id               uuid primary key,             -- = clave de la operacion (D2)
  vendedor_id      uuid not null references vendedor(id),
  sucursal_id      uuid not null references sucursal(id),
  cliente_id       uuid not null references cliente(id),
  motivo_visita_id uuid not null references motivo_visita(id),
  fecha            date not null,                -- fecha_operacion del sobre
  visitada_en      timestamptz not null,         -- cuando el vendedor la guardo
  observaciones    text,
  atendio          text,
  lat              numeric(9,6),
  lng              numeric(9,6),
  precision_m      numeric,
  direccion_texto  text,
  foto_archivo     text,                         -- nombre dentro de FOTOS_DIR
  foto_subida_en   timestamptz,
  creado_en        timestamptz not null default now(),
  constraint ck_visita_coordenadas check (
    (lat is null and lng is null)
    or (lat is not null and lng is not null
        and lat between -90 and 90 and lng between -180 and 180)),
  -- Sin GPS, la visita exige una direccion escrita (respuesta 2 de Mario).
  constraint ck_visita_ubicacion check (
    (lat is not null) or (btrim(coalesce(direccion_texto, '')) <> '')),
  constraint ck_visita_precision check (precision_m is null or precision_m >= 0),
  -- Igual que `ck_cliente_foto_completa`: nombre y fecha se escriben juntos.
  constraint ck_visita_foto_completa check ((foto_archivo is null) = (foto_subida_en is null))
);

-- Visita-Venta (T-55) cuenta visitas por cliente y dia; los reportes, por vendedor y dia.
create index idx_visita_cliente_fecha on visita (cliente_id, fecha);
create index idx_visita_vendedor_fecha on visita (vendedor_id, fecha);

-- El perfil `Administrador General` lo recibe solo (PERFIL_MAESTRO). Leer el
-- catalogo solo pide sesion del portal (D5).
insert into permiso (clave, grupo, descripcion) values
  ('motivo-visita.gestionar', 'Catálogo', 'Motivos de visita: alta, edición y baja')
on conflict (clave) do nothing;
```

- [ ] **Paso 4: aplicar y ver pasar**

```bash
npm run supabase -- migration list --local     # 20261018120000 aparece sin aplicar
npm run supabase -- migration up --local       # aplica solo las pendientes; NUNCA db reset
npm run supabase -- test db --local            # 99_visita_test.sql: 16/16
```

Si `migration list` muestra **otras** migraciones pendientes que no son de esta rama (otra sesión trabaja en el mismo
Supabase local), **para** y avisa al controlador antes de aplicar.

- [ ] **Paso 5: regenerar los tipos de Kysely**

```bash
npm run db:types --workspace=apps/backend
git diff --stat apps/backend/src/database/schema.d.ts
```

El diff debe agregar **solo** `MotivoVisita`, `Visita` y sus dos entradas en `DB`. Si aparecen tablas o columnas
ajenas (migraciones de otra rama aplicadas al Supabase compartido), deja solo lo de T-39 a mano en ese archivo.

- [ ] **Paso 6: typecheck y commit**

```bash
npm run build --workspace=apps/backend
git add supabase/migrations/20261018120000_visita_sin_venta.sql supabase/tests/99_visita_test.sql apps/backend/src/database/schema.d.ts
git commit -m "T-39: migración de motivo_visita, visita y el permiso motivo-visita.gestionar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 2: Backend: catálogo Motivos de visita para el portal (D5)

**Files:**
- Create: `apps/backend/src/modules/rutas/dto/motivo-visita.dto.ts`
- Create: `apps/backend/src/modules/rutas/motivos-visita.repository.ts`
- Create: `apps/backend/src/modules/rutas/motivos-visita.service.ts`
- Create: `apps/backend/src/modules/rutas/motivos-visita.service.spec.ts`
- Create: `apps/backend/src/modules/rutas/motivos-visita.controller.ts`
- Modify: `apps/backend/src/modules/rutas/rutas.module.ts`
- Create: `apps/backend/test/motivos-visita.e2e-spec.ts`

**Interfaces:**
- Consumes: tabla `motivo_visita` (Tarea 1); `RequierePermiso`, `esViolacionUnicidad`.
- Produces: `GET /motivos-visita` (sesión), `POST /motivos-visita`, `PATCH /motivos-visita/:id`,
  `DELETE /motivos-visita/:id` (los tres con `motivo-visita.gestionar`). Respuesta en camelCase:
  `interface MotivoVisita { id: string; nombre: string; exigeFoto: boolean; exigeAtendio: boolean }`. Cuerpo
  `{ nombre, exigeFoto?, exigeAtendio? }`; `DELETE` responde `{ id }`. Duplicado entre vivos → 409
  `Ya existe un motivo de visita llamado "<nombre>".`; inexistente o dado de baja → 404
  `No existe ese motivo de visita.`; `PATCH` sin campos → 400 `No hay nada que actualizar.`

- [ ] **Paso 1: prueba unitaria del servicio (falla: no existe)**

`apps/backend/src/modules/rutas/motivos-visita.service.spec.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MotivosVisitaService } from './motivos-visita.service';
import type { MotivoVisita } from './motivos-visita.repository';

const CERRADO: MotivoVisita = {
  id: 'b6a1f3c2-0000-4000-8000-000000000039',
  nombre: 'Cerrado',
  exigeFoto: true,
  exigeAtendio: false,
};

/** El `23505` tal como lo adjunta el driver `pg`. */
const unicidad = () => Object.assign(new Error('duplicado'), { code: '23505' });

function montar() {
  const repo = {
    listarVivos: jest.fn().mockResolvedValue([CERRADO]),
    crear: jest.fn().mockResolvedValue(CERRADO),
    editar: jest.fn().mockResolvedValue(CERRADO),
    darDeBaja: jest.fn().mockResolvedValue(true),
  };
  return { servicio: new MotivosVisitaService(repo as never), repo };
}

describe('MotivosVisitaService (T-39, D5)', () => {
  it('crear sin casillas las deja en false', async () => {
    const { servicio, repo } = montar();
    await servicio.crear({ nombre: 'Cerrado' });
    expect(repo.crear).toHaveBeenCalledWith('Cerrado', false, false);
  });

  it('un nombre repetido entre vivos es 409 con un mensaje que lo dice', async () => {
    const { servicio, repo } = montar();
    repo.crear.mockRejectedValue(unicidad());
    const error = await servicio.crear({ nombre: 'Cerrado' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe('Ya existe un motivo de visita llamado "Cerrado".');
  });

  it('editar traduce los nombres de campo del portal a columnas', async () => {
    const { servicio, repo } = montar();
    await servicio.editar(CERRADO.id, { exigeAtendio: true });
    expect(repo.editar).toHaveBeenCalledWith(CERRADO.id, { exige_atendio: true });
  });

  it('editar sin ningun campo es 400', async () => {
    const { servicio, repo } = montar();
    await expect(servicio.editar(CERRADO.id, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.editar).not.toHaveBeenCalled();
  });

  it('renombrar a uno que ya existe es 409', async () => {
    const { servicio, repo } = montar();
    repo.editar.mockRejectedValue(unicidad());
    await expect(
      servicio.editar(CERRADO.id, { nombre: 'Sin dinero' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('editar uno que no existe o ya esta dado de baja es 404', async () => {
    const { servicio, repo } = montar();
    repo.editar.mockResolvedValue(undefined);
    await expect(
      servicio.editar(CERRADO.id, { exigeFoto: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('dar de baja uno que no existe es 404', async () => {
    const { servicio, repo } = montar();
    repo.darDeBaja.mockResolvedValue(false);
    await expect(servicio.darDeBaja(CERRADO.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Paso 2: correr y ver fallar**

`npm test --workspace=apps/backend -- motivos-visita` → falla: no existe `./motivos-visita.service`.

- [ ] **Paso 3: DTO, repositorio y servicio**

`apps/backend/src/modules/rutas/dto/motivo-visita.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Alta de un motivo de visita (T-39, D5). Las dos casillas son opcionales y
 * nacen en `false`, igual que en la base.
 */
export class CrearMotivoVisitaDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del motivo es obligatorio.' })
  // La columna no tiene tope; el de aqui es el mismo de los demas catalogos
  // que se pintan en una lista (vehiculo, tipo de negocio).
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;

  @IsOptional()
  @IsBoolean({ message: '"Exige foto" tiene que ser sí o no.' })
  exigeFoto?: boolean;

  @IsOptional()
  @IsBoolean({ message: '"Exige nombre de quien atendió" tiene que ser sí o no.' })
  exigeAtendio?: boolean;
}

/** Edicion parcial: el servicio rechaza con 400 un cuerpo sin ningun campo. */
export class EditarMotivoVisitaDto {
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del motivo es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre?: string;

  @IsOptional()
  @IsBoolean({ message: '"Exige foto" tiene que ser sí o no.' })
  exigeFoto?: boolean;

  @IsOptional()
  @IsBoolean({ message: '"Exige nombre de quien atendió" tiene que ser sí o no.' })
  exigeAtendio?: boolean;
}
```

`apps/backend/src/modules/rutas/motivos-visita.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

/** Un motivo tal como lo ve el portal (camelCase, como el resto de `rutas/`). */
export interface MotivoVisita {
  id: string;
  nombre: string;
  exigeFoto: boolean;
  exigeAtendio: boolean;
}

/** Lo que se puede cambiar de un motivo, ya con nombres de columna. */
export interface CambiosMotivoVisita {
  nombre?: string;
  exige_foto?: boolean;
  exige_atendio?: boolean;
}

interface FilaMotivo {
  id: string;
  nombre: string;
  exige_foto: boolean;
  exige_atendio: boolean;
}

function aMotivo(f: FilaMotivo): MotivoVisita {
  return {
    id: f.id,
    nombre: f.nombre,
    exigeFoto: f.exige_foto,
    exigeAtendio: f.exige_atendio,
  };
}

/**
 * SQL del catalogo `motivo_visita` (T-39, D1/D5). Global: no cuelga de una
 * sucursal, igual que `tipo_negocio`. La baja es logica (`deleted_at`) y el
 * trigger `set_actualizado_en` mueve `actualizado_en` en cualquier update, que
 * es lo que hace bajar la baja en el pull incremental.
 */
@Injectable()
export class MotivosVisitaRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async listarVivos(): Promise<MotivoVisita[]> {
    const filas = await this.db
      .selectFrom('motivo_visita')
      .select(['id', 'nombre', 'exige_foto', 'exige_atendio'])
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .execute();
    return filas.map(aMotivo);
  }

  /** Lanza el `23505` de `uq_motivo_visita_nombre` tal cual: lo traduce el servicio. */
  async crear(
    nombre: string,
    exigeFoto: boolean,
    exigeAtendio: boolean,
  ): Promise<MotivoVisita> {
    const fila = await this.db
      .insertInto('motivo_visita')
      .values({ nombre, exige_foto: exigeFoto, exige_atendio: exigeAtendio })
      .returning(['id', 'nombre', 'exige_foto', 'exige_atendio'])
      .executeTakeFirstOrThrow();
    return aMotivo(fila);
  }

  /** `undefined` si no existe o ya estaba dado de baja. */
  async editar(
    id: string,
    cambios: CambiosMotivoVisita,
  ): Promise<MotivoVisita | undefined> {
    const fila = await this.db
      .updateTable('motivo_visita')
      .set(cambios)
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning(['id', 'nombre', 'exige_foto', 'exige_atendio'])
      .executeTakeFirst();
    return fila ? aMotivo(fila) : undefined;
  }

  /** `false` si no existe o ya estaba dado de baja. */
  async darDeBaja(id: string): Promise<boolean> {
    const fila = await this.db
      .updateTable('motivo_visita')
      .set({ deleted_at: sql`now()` })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    return fila !== undefined;
  }
}
```

`apps/backend/src/modules/rutas/motivos-visita.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { esViolacionUnicidad } from '../../database/errores-postgres';
import type {
  CrearMotivoVisitaDto,
  EditarMotivoVisitaDto,
} from './dto/motivo-visita.dto';
import {
  MotivosVisitaRepository,
  type CambiosMotivoVisita,
  type MotivoVisita,
} from './motivos-visita.repository';

const NO_EXISTE = 'No existe ese motivo de visita.';

function duplicado(nombre: string): ConflictException {
  return new ConflictException(
    `Ya existe un motivo de visita llamado "${nombre}".`,
  );
}

/**
 * El catalogo de motivos de visita del portal (T-39, D5). El duplicado lo
 * decide el indice unico de la base, no una consulta previa (mismo criterio que
 * T-09/T-12): entre el SELECT y el INSERT cabe otra peticion.
 */
@Injectable()
export class MotivosVisitaService {
  constructor(private readonly repo: MotivosVisitaRepository) {}

  listar(): Promise<MotivoVisita[]> {
    return this.repo.listarVivos();
  }

  async crear(dto: CrearMotivoVisitaDto): Promise<MotivoVisita> {
    try {
      return await this.repo.crear(
        dto.nombre,
        dto.exigeFoto ?? false,
        dto.exigeAtendio ?? false,
      );
    } catch (error) {
      if (esViolacionUnicidad(error)) throw duplicado(dto.nombre);
      throw error;
    }
  }

  async editar(id: string, dto: EditarMotivoVisitaDto): Promise<MotivoVisita> {
    const cambios: CambiosMotivoVisita = {};
    if (dto.nombre !== undefined) cambios.nombre = dto.nombre;
    if (dto.exigeFoto !== undefined) cambios.exige_foto = dto.exigeFoto;
    if (dto.exigeAtendio !== undefined) cambios.exige_atendio = dto.exigeAtendio;
    if (Object.keys(cambios).length === 0) {
      throw new BadRequestException('No hay nada que actualizar.');
    }

    let motivo: MotivoVisita | undefined;
    try {
      motivo = await this.repo.editar(id, cambios);
    } catch (error) {
      if (esViolacionUnicidad(error)) throw duplicado(dto.nombre ?? '');
      throw error;
    }
    if (!motivo) throw new NotFoundException(NO_EXISTE);
    return motivo;
  }

  /**
   * Baja logica. Las visitas ya registradas lo siguen referenciando y una
   * tablet sin red todavia puede subir una con el (D3: el push lo acepta).
   */
  async darDeBaja(id: string): Promise<void> {
    if (!(await this.repo.darDeBaja(id))) throw new NotFoundException(NO_EXISTE);
  }
}
```

- [ ] **Paso 4: correr y ver pasar**

`npm test --workspace=apps/backend -- motivos-visita` → 7/7.

- [ ] **Paso 5: controller y módulo**

`apps/backend/src/modules/rutas/motivos-visita.controller.ts`:

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
import {
  CrearMotivoVisitaDto,
  EditarMotivoVisitaDto,
} from './dto/motivo-visita.dto';
import type { MotivoVisita } from './motivos-visita.repository';
import { MotivosVisitaService } from './motivos-visita.service';

// T-39 (D5). Leer pide solo sesion del portal; escribir, `motivo-visita.gestionar`.
// La tablet no usa estos endpoints: el catalogo le baja en el pull.
@Controller('motivos-visita')
export class MotivosVisitaController {
  constructor(private readonly motivos: MotivosVisitaService) {}

  @Get()
  listar(): Promise<MotivoVisita[]> {
    return this.motivos.listar();
  }

  @Post()
  @RequierePermiso('motivo-visita.gestionar')
  crear(@Body() dto: CrearMotivoVisitaDto): Promise<MotivoVisita> {
    return this.motivos.crear(dto);
  }

  @Patch(':id')
  @RequierePermiso('motivo-visita.gestionar')
  editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarMotivoVisitaDto,
  ): Promise<MotivoVisita> {
    return this.motivos.editar(id, dto);
  }

  @Delete(':id')
  @RequierePermiso('motivo-visita.gestionar')
  async eliminar(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.motivos.darDeBaja(id);
    return { id };
  }
}
```

En `rutas.module.ts`: importa los tres; `controllers: [VehiculosController, RutasDiariasController,
MotivosVisitaController]`; agrega `MotivosVisitaService` y `MotivosVisitaRepository` a `providers`. Comentario sobre
el decorador: `// T-39: el catalogo de motivos de visita vive aqui porque la visita es de Rutas (ADR-0009).`

- [ ] **Paso 6: e2e del CRUD**

`apps/backend/test/motivos-visita.e2e-spec.ts`. Copia la estructura de `test/tipos-negocio.e2e-spec.ts` (mismos
imports, `iniciarSesion`, `crearUsuario`, usuarios `Administrador General` y `Auxiliar Administrativo`), con:

```ts
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN_GENERAL = `e2e-mvis-gen-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-mvis-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const PREFIJO = `ZZ-mvis-${SUFIJO}`;

interface MotivoRespuesta {
  id: string;
  nombre: string;
  exigeFoto: boolean;
  exigeAtendio: boolean;
}
```

`afterAll` borra `motivo_visita` con `nombre like ${PREFIJO}%` (ninguna visita los referencia en esta suite), luego
`sesion_refresh` y `usuario` como en tipos de negocio, y `app.close()`. Los casos (usa
`const http = () => request(app.getHttpServer());`):

```ts
describe('GET /motivos-visita', () => {
  it('lista los vivos con sus casillas a cualquiera con sesion, semilla incluida', async () => {
    const res = await http().get('/motivos-visita').set('Cookie', cookieSinPermiso).expect(200);
    const cerrado = (res.body as MotivoRespuesta[]).find((m) => m.nombre === 'Cerrado');
    expect(cerrado).toMatchObject({ exigeFoto: true, exigeAtendio: false });
  });

  it('sin sesion es 401', async () => {
    await http().get('/motivos-visita').expect(401);
  });
});

describe('POST /motivos-visita', () => {
  it('crea un motivo con sus casillas', async () => {
    const res = await http()
      .post('/motivos-visita')
      .set('Cookie', cookieGeneral)
      .send({ nombre: `${PREFIJO} Bodega`, exigeFoto: true })
      .expect(201);
    expect(res.body).toMatchObject({ nombre: `${PREFIJO} Bodega`, exigeFoto: true, exigeAtendio: false });
  });

  it('un nombre repetido (sin importar mayusculas ni espacios) es 409 y lo dice', async () => {
    await http().post('/motivos-visita').set('Cookie', cookieGeneral).send({ nombre: `${PREFIJO} Feria` }).expect(201);
    const res = await http()
      .post('/motivos-visita')
      .set('Cookie', cookieGeneral)
      .send({ nombre: `  ${PREFIJO} FERIA ` })
      .expect(409);
    expect((res.body as { message: string }).message).toContain('Ya existe un motivo de visita');
  });

  it('sin motivo-visita.gestionar es 403', async () => {
    await http().post('/motivos-visita').set('Cookie', cookieSinPermiso).send({ nombre: `${PREFIJO} X` }).expect(403);
  });

  it('un nombre vacio es 400', async () => {
    await http().post('/motivos-visita').set('Cookie', cookieGeneral).send({ nombre: '   ' }).expect(400);
  });
});

describe('PATCH /motivos-visita/:id', () => {
  it('cambia las casillas y el nombre', async () => {
    const { id } = (await http().post('/motivos-visita').set('Cookie', cookieGeneral)
      .send({ nombre: `${PREFIJO} Lluvia` }).expect(201)).body as MotivoRespuesta;
    const res = await http()
      .patch(`/motivos-visita/${id}`)
      .set('Cookie', cookieGeneral)
      .send({ nombre: `${PREFIJO} Llovía`, exigeAtendio: true })
      .expect(200);
    expect(res.body).toMatchObject({ id, nombre: `${PREFIJO} Llovía`, exigeFoto: false, exigeAtendio: true });
  });

  it('renombrar a uno que ya existe es 409', async () => {
    await http().post('/motivos-visita').set('Cookie', cookieGeneral).send({ nombre: `${PREFIJO} Uno` }).expect(201);
    const { id } = (await http().post('/motivos-visita').set('Cookie', cookieGeneral)
      .send({ nombre: `${PREFIJO} Dos` }).expect(201)).body as MotivoRespuesta;
    await http().patch(`/motivos-visita/${id}`).set('Cookie', cookieGeneral).send({ nombre: `${PREFIJO} Uno` }).expect(409);
  });

  it('un id que no existe es 404 y sin permiso es 403', async () => {
    const otro = '00000000-0000-4000-8000-000000000039';
    await http().patch(`/motivos-visita/${otro}`).set('Cookie', cookieGeneral).send({ exigeFoto: true }).expect(404);
    await http().patch(`/motivos-visita/${otro}`).set('Cookie', cookieSinPermiso).send({ exigeFoto: true }).expect(403);
  });
});

describe('DELETE /motivos-visita/:id', () => {
  it('lo da de baja: deja de listarse y su nombre se puede volver a usar', async () => {
    const nombre = `${PREFIJO} Vacaciones`;
    const { id } = (await http().post('/motivos-visita').set('Cookie', cookieGeneral)
      .send({ nombre }).expect(201)).body as MotivoRespuesta;

    await http().delete(`/motivos-visita/${id}`).set('Cookie', cookieSinPermiso).expect(403);
    expect((await http().delete(`/motivos-visita/${id}`).set('Cookie', cookieGeneral).expect(200)).body).toEqual({ id });

    const lista = (await http().get('/motivos-visita').set('Cookie', cookieGeneral).expect(200)).body as MotivoRespuesta[];
    expect(lista.map((m) => m.id)).not.toContain(id);
    await http().delete(`/motivos-visita/${id}`).set('Cookie', cookieGeneral).expect(404);
    await http().post('/motivos-visita').set('Cookie', cookieGeneral).send({ nombre }).expect(201);
  });
});
```

`npm run test:e2e --workspace=apps/backend -- motivos-visita` → verde.

- [ ] **Paso 7: lint por archivo, build y commit**

```bash
npm exec --workspace=apps/backend -- prettier --write src/modules/rutas/dto/motivo-visita.dto.ts src/modules/rutas/motivos-visita.*.ts src/modules/rutas/rutas.module.ts test/motivos-visita.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/rutas/dto/motivo-visita.dto.ts src/modules/rutas/motivos-visita.*.ts src/modules/rutas/rutas.module.ts test/motivos-visita.e2e-spec.ts
npm run build --workspace=apps/backend
git add apps/backend/src/modules/rutas apps/backend/test/motivos-visita.e2e-spec.ts
git commit -m "T-39: catálogo Motivos de visita en el backend (CRUD del portal, baja lógica)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Las rutas de `prettier`/`eslint` son relativas a `apps/backend` porque `npm exec --workspace` corre ahí.)

---

### Tarea 3: Operación `visita` en el push: contrato, forma y proyección (D2, D3)

**Files:**
- Modify: `apps/backend/src/modules/rutas/datos-jornada.ts` (exportar `esInstante`)
- Create: `apps/backend/src/modules/rutas/datos-visita.ts`
- Create: `apps/backend/src/modules/rutas/datos-visita.spec.ts`
- Create: `apps/backend/src/modules/rutas/visita-rechazada.ts`
- Create: `apps/backend/src/modules/rutas/visitas.repository.ts`
- Create: `apps/backend/src/modules/rutas/visitas.service.ts`
- Create: `apps/backend/src/modules/rutas/visitas.service.spec.ts`
- Modify: `apps/backend/src/modules/rutas/rutas.module.ts` (providers + `exports: [..., VisitasService]`)
- Create: `apps/backend/src/modules/sincronizacion/despacho-visita.ts`
- Create: `apps/backend/src/modules/sincronizacion/despacho-visita.spec.ts`
- Modify: `apps/backend/src/modules/sincronizacion/despacho.ts`
- Modify: `apps/backend/src/modules/sincronizacion/despacho.spec.ts`
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts`
- Modify: `apps/tablet/src/sincronizacion/contrato.ts`
- Modify: `docs/contrato-sincronizacion.md` (§6 y §7, §9)
- Create: `apps/backend/test/visita.e2e-spec.ts`

**Interfaces:**
- Consumes: tablas de la Tarea 1; `OperacionNormalizada`, `Rechazo` (`operaciones.ts`); el alcance por lote de
  `push` (el `cliente_id` del sobre ya pasó por `clientesEnAlcance`).
- Produces:
  - Contrato (los dos lados): `'visita'` en `TIPOS_OPERACION`/`TipoOperacion`; `'motivo-visita-inexistente'` y
    `'visita-id-ocupado'` en `CODIGOS_RECHAZO`; `type DatosVisita = { motivo_visita_id: string; visitada_en: string;
    observaciones?: string | null; atendio?: string | null; lat?: number | null; lng?: number | null;
    precision_m?: number | null; direccion_texto?: string | null }`.
  - `rutas/datos-visita.ts`: `interface VisitaNormalizada { motivoVisitaId: string; visitadaEn: string;
    observaciones: string | null; atendio: string | null; lat: number | null; lng: number | null;
    precisionM: number | null; direccionTexto: string | null }`, `normalizarDatosVisita(datos)`,
    `LARGO_MAX_OBSERVACIONES = 500`, `LARGO_MAX_ATENDIO = 120`, `LARGO_MAX_DIRECCION = 300`.
  - `rutas/visita-rechazada.ts`: `type RazonRechazoVisita = 'motivo-visita-inexistente' | 'visita-id-ocupado'`,
    `class VisitaRechazada`.
  - `rutas/visitas.service.ts`: `interface ContextoVisita { id; sucursalId; vendedorId; clienteId;
    fechaOperacion }`, `registrarVisita(visita, contexto, trx): Promise<{ tabla: 'visita'; id: string }>`.
  - `sincronizacion/despacho-visita.ts`: `prepararVisita(op)` y `CODIGO_POR_RAZON_VISITA`.
  - `Proyeccion` gana `{ tipo: 'visita'; visita: VisitaNormalizada; clienteId: string }`.

- [ ] **Paso 1: pruebas de la forma (fallan: no existe)**

En `datos-jornada.ts` cambia `function esInstante(` por `export function esInstante(` (sin más cambios; lo reusa la
visita para `visitada_en`).

`apps/backend/src/modules/rutas/datos-visita.spec.ts`:

```ts
import { normalizarDatosVisita } from './datos-visita';

const MOTIVO = '5d1c9a7e-3b2f-4c8d-9e0a-1b2c3d4e5f60';

const datos = (extra: Record<string, unknown> = {}) => ({
  motivo_visita_id: MOTIVO,
  visitada_en: '2026-10-17T11:40:00-07:00',
  observaciones: null,
  atendio: null,
  lat: 32.5149,
  lng: -117.0382,
  precision_m: 12.5,
  direccion_texto: null,
  ...extra,
});

function motivoDe(extra: Record<string, unknown>): string {
  const r = normalizarDatosVisita(datos(extra));
  if (r.ok) throw new Error('debia rechazarse');
  return r.motivo;
}

describe('normalizarDatosVisita (T-39, D3)', () => {
  it('una visita con GPS se normaliza: motivo en minusculas, instante en UTC', () => {
    expect(
      normalizarDatosVisita(datos({ motivo_visita_id: MOTIVO.toUpperCase() })),
    ).toEqual({
      ok: true,
      visita: {
        motivoVisitaId: MOTIVO,
        visitadaEn: '2026-10-17T18:40:00.000Z',
        observaciones: null,
        atendio: null,
        lat: 32.5149,
        lng: -117.0382,
        precisionM: 12.5,
        direccionTexto: null,
      },
    });
  });

  it('sin GPS con direccion escrita entra; los textos se recortan y el vacio es null', () => {
    const r = normalizarDatosVisita(
      datos({
        lat: null,
        lng: null,
        precision_m: null,
        direccion_texto: '  Frente al parque  ',
        observaciones: '   ',
        atendio: ' Doña Lupe ',
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      visita: { direccionTexto: 'Frente al parque', observaciones: null, atendio: 'Doña Lupe', lat: null },
    });
  });

  it('los opcionales pueden faltar del todo', () => {
    const r = normalizarDatosVisita({
      motivo_visita_id: MOTIVO,
      visitada_en: '2026-10-17T18:40:00Z',
      lat: 32.5,
      lng: -117,
    });
    expect(r).toMatchObject({ ok: true, visita: { observaciones: null, precisionM: null } });
  });

  it.each([
    [{ lat: null, lng: null, direccion_texto: null }, 'direccion_texto'],
    [{ lat: null, lng: null, direccion_texto: '    ' }, 'direccion_texto'],
    [{ lng: null }, 'lat'],
    [{ lat: 91 }, 'lat'],
    [{ lng: -181 }, 'lng'],
    [{ lat: Number.NaN }, 'lat'],
    [{ precision_m: -1 }, 'precision_m'],
    [{ precision_m: '12' }, 'precision_m'],
    [{ motivo_visita_id: 'cerrado' }, 'motivo_visita_id'],
    [{ visitada_en: '2026-10-17T18:40:00' }, 'visitada_en'],
    [{ visitada_en: '2026-02-30T18:40:00Z' }, 'visitada_en'],
    [{ observaciones: 'x'.repeat(501) }, 'observaciones'],
    [{ observaciones: 12 }, 'observaciones'],
    [{ atendio: 'x'.repeat(121) }, 'atendio'],
    [{ direccion_texto: 'x'.repeat(301) }, 'direccion_texto'],
  ])('%o se rechaza nombrando el campo %s', (extra, campo) => {
    expect(motivoDe(extra)).toMatch(new RegExp(`^${campo}: `));
  });
});
```

- [ ] **Paso 2: pruebas del despacho y del servicio (fallan: no existen)**

`apps/backend/src/modules/sincronizacion/despacho-visita.spec.ts`:

```ts
import { CODIGOS_RECHAZO } from './contrato';
import { CODIGO_POR_RAZON_VISITA, prepararVisita } from './despacho-visita';
import type { OperacionNormalizada } from './operaciones';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
const MOTIVO = '5d1c9a7e-3b2f-4c8d-9e0a-1b2c3d4e5f60';

const op = (extra: Partial<OperacionNormalizada> = {}): OperacionNormalizada => ({
  clave: 'c0ffee00-0000-4000-8000-000000000039',
  tipo: 'visita',
  fechaOperacion: '2026-10-17',
  ocurridoEn: '2026-10-17T18:40:00.000Z',
  clienteId: CLIENTE,
  folio: null,
  datos: {
    motivo_visita_id: MOTIVO,
    visitada_en: '2026-10-17T18:40:00.000Z',
    lat: null,
    lng: null,
    direccion_texto: 'Frente al parque',
  },
  ...extra,
});

describe('prepararVisita (T-39, D3)', () => {
  it('una visita valida sale con su cliente del sobre', () => {
    expect(prepararVisita(op())).toMatchObject({
      ok: true,
      clienteId: CLIENTE,
      visita: { motivoVisitaId: MOTIVO, direccionTexto: 'Frente al parque' },
    });
  });

  it.each([
    [{ folio: 'TJ261017AP01' }, /^folio: /],
    [{ clienteId: null }, /^cliente_id: /],
    [{ clave: 'visita-123' }, /^clave: .*uuid/],
    [{ datos: { motivo_visita_id: MOTIVO, visitada_en: '2026-10-17T18:40:00Z' } }, /^direccion_texto: /],
  ])('%o es datos-invalidos con un motivo que nombra el campo', (extra, motivo) => {
    const r = prepararVisita(op(extra as Partial<OperacionNormalizada>));
    expect(r).toMatchObject({ ok: false, codigo: 'datos-invalidos' });
    if (r.ok) return;
    expect(r.motivo).toMatch(motivo);
  });

  it('cada razon del dominio sale con un codigo que existe en el contrato', () => {
    for (const codigo of Object.values(CODIGO_POR_RAZON_VISITA)) {
      expect(CODIGOS_RECHAZO).toContain(codigo);
    }
  });
});
```

En `despacho.spec.ts`, dentro de `describe('prepararProyeccion')`, después del caso "un alta de ruta sin cliente…":

```ts
  it('una visita pasa por prepararVisita y sale como proyeccion de visita (T-39)', () => {
    const r = prepararProyeccion(
      op({
        tipo: 'visita',
        folio: null,
        datos: {
          motivo_visita_id: PRE_A,
          visitada_en: '2026-09-14T18:32:05.000Z',
          lat: 32.5,
          lng: -117,
        },
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      proyeccion: { tipo: 'visita', clienteId: CLIENTE, visita: { motivoVisitaId: PRE_A } },
    });
  });
```

(`PRE_A` es un uuid cualquiera ya definido en el archivo; aquí hace de id de motivo.)

`apps/backend/src/modules/rutas/visitas.service.spec.ts`:

```ts
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { VisitaNormalizada } from './datos-visita';
import { VisitaRechazada } from './visita-rechazada';
import { VisitasService, type ContextoVisita } from './visitas.service';

const trx = {} as Transaction<DB>;

const contexto: ContextoVisita = {
  id: 'c0ffee00-0000-4000-8000-000000000039',
  sucursalId: 'sucursal-tj',
  vendedorId: 'vendedor-1',
  clienteId: 'cliente-1',
  fechaOperacion: '2026-10-17',
};

const visita: VisitaNormalizada = {
  motivoVisitaId: 'motivo-cerrado',
  visitadaEn: '2026-10-17T18:40:00.000Z',
  observaciones: 'Cortina abajo',
  atendio: null,
  lat: null,
  lng: null,
  precisionM: null,
  direccionTexto: 'Frente al parque',
};

function montar(opciones: { motivoExiste?: boolean; idInsertado?: string | null } = {}) {
  const repo = {
    motivoExiste: jest.fn().mockResolvedValue(opciones.motivoExiste ?? true),
    insertar: jest
      .fn()
      .mockResolvedValue('idInsertado' in opciones ? opciones.idInsertado : contexto.id),
  };
  return { servicio: new VisitasService(repo as never), repo };
}

describe('VisitasService.registrarVisita (T-39, D3)', () => {
  it('inserta con el id de la clave, el dia del sobre y el alcance del token', async () => {
    const { servicio, repo } = montar();
    await expect(servicio.registrarVisita(visita, contexto, trx)).resolves.toEqual({
      tabla: 'visita',
      id: contexto.id,
    });
    expect(repo.motivoExiste).toHaveBeenCalledWith('motivo-cerrado', trx);
    expect(repo.insertar).toHaveBeenCalledWith(
      {
        id: contexto.id,
        vendedorId: 'vendedor-1',
        sucursalId: 'sucursal-tj',
        clienteId: 'cliente-1',
        motivoVisitaId: 'motivo-cerrado',
        fecha: '2026-10-17',
        visitadaEn: '2026-10-17T18:40:00.000Z',
        observaciones: 'Cortina abajo',
        atendio: null,
        lat: null,
        lng: null,
        precisionM: null,
        direccionTexto: 'Frente al parque',
      },
      trx,
    );
  });

  it('un motivo que no existe es motivo-visita-inexistente y no inserta', async () => {
    const { servicio, repo } = montar({ motivoExiste: false });
    const error = await servicio.registrarVisita(visita, contexto, trx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VisitaRechazada);
    expect(error).toMatchObject({ razon: 'motivo-visita-inexistente' });
    expect(repo.insertar).not.toHaveBeenCalled();
  });

  it('un id ocupado es visita-id-ocupado con un motivo neutro', async () => {
    const { servicio } = montar({ idInsertado: null });
    const error = await servicio.registrarVisita(visita, contexto, trx).catch((e: unknown) => e);
    expect(error).toMatchObject({ razon: 'visita-id-ocupado' });
    // Neutro: no dice de quien es ni que hay ahi (podria ser de otra sucursal).
    expect((error as Error).message).not.toMatch(/cliente|sucursal|vendedor/i);
  });
});
```

`npm test --workspace=apps/backend -- datos-visita despacho visitas.service` → fallan por los módulos que faltan.

- [ ] **Paso 3: el contrato, en los dos lados**

`apps/backend/src/modules/sincronizacion/contrato.ts`:

1. En el doc-comment de `TIPOS_OPERACION`, cambia la línea `TODO: T-39 — \`ruta\` (visitas, orden real, tiempos y GPS).`
   por:
   ```ts
    * Hecho: T-39 — `visita`, una visita sin venta con su motivo (ver
    *        {@link DatosVisita}); se proyecta a la tabla `visita` con `id = clave`.
    *        **No** reutiliza `ruta`, que sigue reservado y se guarda sin proyectar.
    *        Tipo nuevo = cambio aditivo: no sube la version.
   ```
2. Agrega `'visita',` al final del arreglo `TIPOS_OPERACION` (después de `'ruta-alta'`).
3. Al final de `CODIGOS_RECHAZO` (después de `'ruta-duplicada'`):
   ```ts
  /**
   * El `motivo_visita_id` de una visita no existe en el catalogo. T-39. Un
   * motivo **dado de baja si se acepta**: el vendedor lo eligio sin red cuando
   * estaba vivo. Esto solo cae con un id que nunca existio (bug de la tablet).
   */
  'motivo-visita-inexistente',
  /**
   * El id de la visita (su clave) ya esta ocupado por otro registro. T-39. El
   * mismo vendedor con la misma clave es `duplicada`, no esto. El motivo es
   * neutro a proposito: no confirma que hay detras del id.
   */
  'visita-id-ocupado',
   ```
4. Después de `DatosRutaAlta`:
   ```ts
/**
 * `datos` de una operacion `tipo: "visita"` (T-39): una visita sin venta.
 *
 * `cliente_id` va en el **sobre** (se comprueba con el alcance normal del
 * lote) y no lleva folio. La `clave` **es el id** de la fila `visita`: debe ser
 * uuid. Los textos se recortan y uno vacio se guarda como `null`.
 *
 * Ubicacion: `lat`/`lng` van las dos o ninguna; sin ellas, `direccion_texto` es
 * obligatoria (no vacia). El servidor **no** revisa si el motivo exige foto o
 * nombre: lo exige la tablet al guardar (la oficina pudo cambiar las casillas
 * mientras la tablet estaba sin red).
 *
 * Es `type` y no `interface` por la misma razon que {@link DatosVenta}.
 */
export type DatosVisita = {
  /** uuid de `motivo_visita` (vivo o dado de baja). */
  motivo_visita_id: string;
  /** Instante ISO-8601 con zona en que el vendedor la guardo. */
  visitada_en: string;
  /** Hasta 500 caracteres. */
  observaciones?: string | null;
  /** Quien atendio; hasta 120 caracteres. */
  atendio?: string | null;
  /** -90..90; las dos o ninguna. */
  lat?: number | null;
  /** -180..180. */
  lng?: number | null;
  /** Precision del GPS en metros, >= 0. */
  precision_m?: number | null;
  /** Hasta 300; obligatoria (no vacia) si no hay lat/lng. */
  direccion_texto?: string | null;
};
   ```

`apps/tablet/src/sincronizacion/contrato.ts`:

1. En `TipoOperacion`, después de `| 'ruta-alta'` (quita el `;` de esa línea):
   ```ts
  /** T-39. Una visita sin venta: el servidor la proyecta a `visita` con id = clave. */
  | 'visita';
   ```
2. Al final de `CODIGOS_RECHAZO`:
   ```ts
  /**
   * T-39: el motivo de la visita no existe en el servidor (un id que nunca
   * existio; uno dado de baja se acepta). La visita queda en `error` y se
   * reintenta.
   */
  'motivo-visita-inexistente',
  /** T-39: el id de la visita ya lo ocupa otro registro. Motivo neutro. */
  'visita-id-ocupado',
   ```
3. Después de `DatosRutaAlta`, la copia exacta de `DatosVisita` (mismo bloque de arriba, con el doc-comment
   abreviado a: `` `datos` de una operacion `tipo: "visita"` (T-39). Copia del tipo del backend. ``).

- [ ] **Paso 4: la forma y el despacho**

`apps/backend/src/modules/rutas/datos-visita.ts`:

```ts
import { esInstante } from './datos-jornada';

/**
 * Validacion y normalizacion de `datos` de una visita sin venta (T-39, D3).
 *
 * Pura, sin base de datos: decide la FORMA. Que el motivo exista y que el id
 * este libre lo decide `VisitasService` dentro de la transaccion. Comprueba lo
 * que haria reventar a Postgres (un uuid mal formado, una coordenada fuera de
 * `numeric(9,6)`, un instante que no existe) por la misma razon que
 * `datos-jornada.ts`: un 500 tumba el lote y la tablet reintentaria para siempre.
 */

export const LARGO_MAX_OBSERVACIONES = 500;
export const LARGO_MAX_ATENDIO = 120;
export const LARGO_MAX_DIRECCION = 300;

/** La visita ya validada. Id, vendedor, sucursal, cliente y fecha viajan en el contexto. */
export interface VisitaNormalizada {
  /** uuid en minusculas. */
  motivoVisitaId: string;
  /** ISO-8601 en UTC (`toISOString`). */
  visitadaEn: string;
  observaciones: string | null;
  atendio: string | null;
  lat: number | null;
  lng: number | null;
  precisionM: number | null;
  direccionTexto: string | null;
}

export type ResultadoDatosVisita =
  | { ok: true; visita: VisitaNormalizada }
  /** El `motivo` empieza por el campo: es lo que guarda la tablet en `sync_error`. */
  | { ok: false; motivo: string };

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Campo<T> = { ok: true; valor: T } | { ok: false; motivo: string };

/** Texto opcional: ausente o `null` es `null`; recortado; vacio es `null`. */
function textoOpcional(campo: string, valor: unknown, maximo: number): Campo<string | null> {
  if (valor === undefined || valor === null) return { ok: true, valor: null };
  if (typeof valor !== 'string') {
    return { ok: false, motivo: `${campo}: tiene que ser texto o null.` };
  }
  const limpio = valor.trim();
  if (limpio.length > maximo) {
    return { ok: false, motivo: `${campo}: no puede pasar de ${maximo} caracteres.` };
  }
  return { ok: true, valor: limpio === '' ? null : limpio };
}

/** Numero opcional y finito dentro de `[min, max]`; ausente o `null` es `null`. */
function numeroOpcional(
  campo: string,
  valor: unknown,
  min: number,
  max: number,
): Campo<number | null> {
  if (valor === undefined || valor === null) return { ok: true, valor: null };
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < min || valor > max) {
    return { ok: false, motivo: `${campo}: tiene que ser un número entre ${min} y ${max}, o null.` };
  }
  return { ok: true, valor };
}

/** Valida y normaliza `datos` de una operacion `visita`. */
export function normalizarDatosVisita(
  datos: Record<string, unknown>,
): ResultadoDatosVisita {
  const motivo = datos.motivo_visita_id;
  if (typeof motivo !== 'string' || !RE_UUID.test(motivo)) {
    return {
      ok: false,
      motivo: 'motivo_visita_id: tiene que ser el uuid de un motivo del catálogo.',
    };
  }

  const visitadaEn = datos.visitada_en;
  if (!esInstante(visitadaEn)) {
    return {
      ok: false,
      motivo: 'visitada_en: tiene que ser un instante ISO-8601 con zona (por ejemplo 2026-10-17T18:40:00Z).',
    };
  }

  const observaciones = textoOpcional('observaciones', datos.observaciones, LARGO_MAX_OBSERVACIONES);
  if (!observaciones.ok) return observaciones;
  const atendio = textoOpcional('atendio', datos.atendio, LARGO_MAX_ATENDIO);
  if (!atendio.ok) return atendio;
  const direccion = textoOpcional('direccion_texto', datos.direccion_texto, LARGO_MAX_DIRECCION);
  if (!direccion.ok) return direccion;

  const lat = numeroOpcional('lat', datos.lat, -90, 90);
  if (!lat.ok) return lat;
  const lng = numeroOpcional('lng', datos.lng, -180, 180);
  if (!lng.ok) return lng;
  // Media coordenada no ubica nada (mismo criterio que el prospecto, T-40).
  if ((lat.valor === null) !== (lng.valor === null)) {
    return { ok: false, motivo: 'lat: la ubicación va completa (lat y lng) o no va.' };
  }
  const precision = numeroOpcional('precision_m', datos.precision_m, 0, Number.MAX_SAFE_INTEGER);
  if (!precision.ok) return precision;

  // Sin GPS, la visita exige una direccion escrita (respuesta 2 de Mario).
  if (lat.valor === null && direccion.valor === null) {
    return {
      ok: false,
      motivo: 'direccion_texto: sin lat/lng la visita necesita la dirección o una referencia escrita.',
    };
  }

  return {
    ok: true,
    visita: {
      motivoVisitaId: motivo.toLowerCase(),
      visitadaEn: new Date(visitadaEn).toISOString(),
      observaciones: observaciones.valor,
      atendio: atendio.valor,
      lat: lat.valor,
      lng: lng.valor,
      precisionM: precision.valor,
      direccionTexto: direccion.valor,
    },
  };
}
```

`apps/backend/src/modules/rutas/visita-rechazada.ts`:

```ts
/**
 * Una visita que el DOMINIO no acepta (T-39). Igual que `RutaRechazada`: no
 * importa nada del contrato; `push` la traduce a su codigo
 * (`sincronizacion/despacho-visita.ts`). La forma de `datos` no esta aqui: se
 * rechaza antes de abrir la transaccion (`datos-visita.ts`).
 */
export type RazonRechazoVisita =
  /** El `motivo_visita_id` no existe (uno dado de baja si se acepta, D3). */
  | 'motivo-visita-inexistente'
  /** El id (la clave) ya lo ocupa otra visita. */
  | 'visita-id-ocupado';

export interface RechazoVisita {
  razon: RazonRechazoVisita;
  /** En el espanol que leera quien tenga la tablet en la mano. */
  motivo: string;
}

export class VisitaRechazada extends Error {
  readonly razon: RazonRechazoVisita;

  constructor({ razon, motivo }: RechazoVisita) {
    super(motivo);
    this.name = 'VisitaRechazada';
    this.razon = razon;
  }
}
```

`apps/backend/src/modules/sincronizacion/despacho-visita.ts`:

```ts
import {
  normalizarDatosVisita,
  type VisitaNormalizada,
} from '../rutas/datos-visita';
import type { RazonRechazoVisita } from '../rutas/visita-rechazada';
import type { CodigoRechazo } from './contrato';
import type { OperacionNormalizada, Rechazo } from './operaciones';

/**
 * La parte del despachador que es de la visita sin venta (T-39), en su propio
 * archivo para que `despacho.ts` se quede en un `case` corto por tipo (acuerdo
 * de T-40). Puro, sin base.
 */

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PreparacionVisita =
  | { ok: true; visita: VisitaNormalizada; clienteId: string }
  | ({ ok: false } & Rechazo);

export function prepararVisita(op: OperacionNormalizada): PreparacionVisita {
  // Una visita no es una nota que nadie firme: con folio ocuparia un numero de
  // la serie de ventas en `sync_operacion.folio` (mismo criterio que T-40).
  if (op.folio !== null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo: 'folio: una visita no lleva folio; no es una nota que el cliente firme.',
    };
  }

  // El cliente va en el sobre (D3): asi el alcance del lote ya lo comprobo.
  if (op.clienteId === null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo: 'cliente_id: una visita va en el sobre con el cliente visitado.',
    };
  }

  // La clave ES el id de la visita (D2, como el prospecto en T-75): la foto se
  // liga a ella. `visita.id` es uuid, asi que la clave tiene que serlo.
  if (!RE_UUID.test(op.clave)) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'clave: la clave de una visita debe ser un uuid; es el id con el que la tablet ya la registró.',
    };
  }

  const r = normalizarDatosVisita(op.datos);
  if (!r.ok) return { ok: false, codigo: 'datos-invalidos', motivo: r.motivo };
  return { ok: true, visita: r.visita, clienteId: op.clienteId };
}

/** Razon del dominio a codigo del contrato. Un `Record`: una razon nueva no compila sin codigo. */
export const CODIGO_POR_RAZON_VISITA: Record<RazonRechazoVisita, CodigoRechazo> = {
  'motivo-visita-inexistente': 'motivo-visita-inexistente',
  'visita-id-ocupado': 'visita-id-ocupado',
};
```

`despacho.ts`:

1. Imports: `import type { VisitaNormalizada } from '../rutas/datos-visita';` y
   `import { prepararVisita } from './despacho-visita';`.
2. En la unión `Proyeccion`, al final:
   ```ts
  // T-39. La fila es de `visita` con id = clave; el cliente es el del sobre.
  | { tipo: 'visita'; visita: VisitaNormalizada; clienteId: string };
   ```
   y actualiza el doc-comment del orden: `... \`ruta-alta\` (T-37), \`visita\` (T-39).`
3. En `prepararProyeccion`, después del `case 'ruta-alta'`:
   ```ts
    case 'visita': {
      // T-39. La forma la revisa `despacho-visita.ts`; el motivo y el id
      // ocupado, `VisitasService` dentro de la transaccion.
      const r = prepararVisita(op);
      if (!r.ok) return r;
      return {
        ok: true,
        proyeccion: { tipo: 'visita', visita: r.visita, clienteId: r.clienteId },
      };
    }
   ```
   y en el doc-comment de la función cambia "enumera los seis tipos" por "enumera todos los tipos".

- [ ] **Paso 5: repositorio y servicio de la visita**

`apps/backend/src/modules/rutas/visitas.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';

/** Una fila de `visita` lista para escribir. */
export interface NuevaVisita {
  id: string;
  vendedorId: string;
  sucursalId: string;
  clienteId: string;
  motivoVisitaId: string;
  /** `AAAA-MM-DD`: la `fecha_operacion` del sobre, tal cual. */
  fecha: string;
  visitadaEn: string;
  observaciones: string | null;
  atendio: string | null;
  lat: number | null;
  lng: number | null;
  precisionM: number | null;
  direccionTexto: string | null;
}

/**
 * SQL de la visita sin venta (T-39). Como `JornadasRepository`: lo del push
 * recibe la `trx` y no abre la suya, porque la visita entra o sale junto con su
 * fila del buzon (ADR-0009 §2.3).
 */
@Injectable()
export class VisitasRepository {
  /**
   * ¿Existe el motivo? **Sin mirar `deleted_at`** a proposito (D3): uno dado de
   * baja despues de que el vendedor lo eligio sin red se acepta.
   */
  async motivoExiste(motivoId: string, trx: Transaction<DB>): Promise<boolean> {
    const fila = await trx
      .selectFrom('motivo_visita')
      .select('id')
      .where('id', '=', motivoId)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * Inserta la visita, o devuelve `null` si su id ya estaba ocupado.
   *
   * `on conflict (id) do nothing` y no atrapar el `23505`: un unique_violation
   * aborta la transaccion entera de Postgres (T-16, D10).
   */
  async insertar(nueva: NuevaVisita, trx: Transaction<DB>): Promise<string | null> {
    const fila = await trx
      .insertInto('visita')
      .values({
        id: nueva.id,
        vendedor_id: nueva.vendedorId,
        sucursal_id: nueva.sucursalId,
        cliente_id: nueva.clienteId,
        motivo_visita_id: nueva.motivoVisitaId,
        fecha: nueva.fecha,
        visitada_en: nueva.visitadaEn,
        observaciones: nueva.observaciones,
        atendio: nueva.atendio,
        lat: nueva.lat,
        lng: nueva.lng,
        precision_m: nueva.precisionM,
        direccion_texto: nueva.direccionTexto,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .returning('id')
      .executeTakeFirst();
    return fila?.id ?? null;
  }
}
```

`apps/backend/src/modules/rutas/visitas.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { VisitaNormalizada } from './datos-visita';
import { VisitaRechazada } from './visita-rechazada';
import { VisitasRepository } from './visitas.repository';

/**
 * Quien, cual y cuando. Todo sale del token o del sobre, nunca de `datos`:
 * `id` es la clave de la operacion (uuid validado en `prepararVisita`),
 * `sucursalId`/`vendedorId` los del token, `clienteId` el del sobre (ya paso el
 * alcance del lote) y `fechaOperacion` la del sobre, sin re-derivarla de UTC.
 */
export interface ContextoVisita {
  id: string;
  sucursalId: string;
  vendedorId: string;
  clienteId: string;
  fechaOperacion: string;
}

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadVisita {
  tabla: 'visita';
  id: string;
}

/**
 * La visita sin venta en el servidor (T-39): proyecta el `tipo: 'visita'` que
 * sube la tablet. Vive en `rutas/` porque la visita es de Rutas (ADR-0009).
 *
 * **No revisa `exige_foto` ni `exige_atendio`** (D3): la oficina puede cambiar
 * las casillas mientras la tablet esta sin red, y rechazar una visita ya hecha
 * por un cambio posterior seria injusto. Lo exige la tablet al guardar.
 */
@Injectable()
export class VisitasService {
  constructor(private readonly repo: VisitasRepository) {}

  /**
   * @throws {VisitaRechazada} `motivo-visita-inexistente` o `visita-id-ocupado`.
   * No escribe nada antes de lanzar.
   */
  async registrarVisita(
    visita: VisitaNormalizada,
    contexto: ContextoVisita,
    trx: Transaction<DB>,
  ): Promise<EntidadVisita> {
    if (!(await this.repo.motivoExiste(visita.motivoVisitaId, trx))) {
      throw new VisitaRechazada({
        razon: 'motivo-visita-inexistente',
        motivo: `El motivo de visita ${visita.motivoVisitaId} no existe en el catálogo.`,
      });
    }

    const id = await this.repo.insertar(
      {
        id: contexto.id,
        vendedorId: contexto.vendedorId,
        sucursalId: contexto.sucursalId,
        clienteId: contexto.clienteId,
        motivoVisitaId: visita.motivoVisitaId,
        fecha: contexto.fechaOperacion,
        visitadaEn: visita.visitadaEn,
        observaciones: visita.observaciones,
        atendio: visita.atendio,
        lat: visita.lat,
        lng: visita.lng,
        precisionM: visita.precisionM,
        direccionTexto: visita.direccionTexto,
      },
      trx,
    );
    if (id === null) {
      // Neutro a proposito, como `id-ocupado` del prospecto (T-75): no confirma
      // que hay detras de ese id.
      throw new VisitaRechazada({
        razon: 'visita-id-ocupado',
        motivo: 'El id de esta visita ya está ocupado. Avisa a la oficina.',
      });
    }
    return { tabla: 'visita', id };
  }
}
```

`rutas.module.ts`: agrega `VisitasService` y `VisitasRepository` a `providers` y `VisitasService` a `exports`; amplía
el comentario de exports: `// T-39: \`VisitasService\` para que sincronizacion/ proyecte la visita.`

- [ ] **Paso 6: cablear el push**

`sincronizacion.service.ts`:

1. Imports: `import { VisitaRechazada } from '../rutas/visita-rechazada';`,
   `import { VisitasService } from '../rutas/visitas.service';`,
   `import { CODIGO_POR_RAZON_VISITA } from './despacho-visita';`.
2. Constructor, al final:
   ```ts
    // T-39: Rutas tambien es la duena de la visita sin venta.
    private readonly visitas: VisitasService,
   ```
3. En el `catch` de `aplicar`, después del bloque de `RutaRechazada`:
   ```ts
      // T-39: el rollback ya dejo sin fila tanto el buzon como la visita.
      if (error instanceof VisitaRechazada) {
        return {
          clave: op.clave,
          tipo: op.tipo,
          estado: 'rechazada',
          codigo: CODIGO_POR_RAZON_VISITA[error.razon],
          motivo: error.message,
        };
      }
   ```
4. En `proyectar`, después del `case 'ruta-alta'`:
   ```ts
      case 'visita':
        // La entidad del buzon es la fila de `visita` (ADR-0009 §2.4, enmendado).
        return this.visitas.registrarVisita(
          proyeccion.visita,
          {
            // T-39 (D2): la clave ES el id de la visita (uuid validado en prepararVisita).
            id: op.clave,
            sucursalId: vendedor.sucursal_id,
            vendedorId: vendedor.id,
            clienteId: proyeccion.clienteId,
            // Tal cual lo mando la tablet: el servidor no re-deriva el dia de UTC.
            fechaOperacion: op.fechaOperacion,
          },
          trx,
        );
   ```

`npm test --workspace=apps/backend -- datos-visita despacho visitas.service` → verde. `npm run build
--workspace=apps/backend` → verde (el `switch` de `prepararProyeccion` y el de `proyectar` siguen exhaustivos).

- [ ] **Paso 7: `docs/contrato-sincronizacion.md`**

1. §6 Petición: el comentario de `"tipo"` pasa a `// jornada|venta|cobranza|gasto|merma|ruta|prospecto|ruta-alta|visita`.
2. El párrafo "`datos` lo fija el ticket de cada módulo…" nombra también **`visita`** (T-39): "…**`ruta-alta`**
   (T-37) y **`visita`** (T-39), los seis abajo; gastos, merma y ruta siguen libres hasta T-27/T-33, y el servidor
   las guarda tal cual." (`ruta` ya no es "de T-39": queda reservado sin forma.)
3. En el sobre del alta de ruta, el comentario `// NO "ruta": ese tipo queda para la visita de T-39` pasa a
   `// NO "ruta": ese tipo sigue reservado (la visita de T-39 es "visita")`.
4. Nueva subsección después de "`datos` de un alta de ruta (T-37)":

   ````markdown
   ### `datos` de una visita sin venta (T-39)

   ```jsonc
   {
     "clave": "uuid de la fila local",     // ES el id de la visita en el servidor: debe ser uuid
     "tipo": "visita",
     "fecha_operacion": "2026-10-17",      // el día al que cuenta la visita
     "ocurrido_en": "2026-10-17T18:40:00.000Z",
     "cliente_id": "uuid",                 // en el SOBRE: pasa por el alcance del lote. Sin "folio"
     "datos": {
       "motivo_visita_id": "uuid",         // del catálogo motivos_visita (vivo o dado de baja)
       "visitada_en": "2026-10-17T11:40:00-07:00",
       "observaciones": "Cortina abajo",   // opcional, <= 500
       "atendio": null,                    // opcional, <= 120
       "lat": null, "lng": null,           // las dos o ninguna
       "precision_m": null,                // >= 0
       "direccion_texto": "Frente al parque" // <= 300; obligatoria si no hay lat/lng
     }
   }
   ```

   - La forma se valida **antes** de la transacción (`prepararVisita`): clave no uuid, folio en el sobre, sin
     `cliente_id`, o `datos` mal formado (incluida la falta de ubicación) es `datos-invalidos` con un motivo que
     nombra el campo. Los textos se recortan y un texto vacío se guarda como `null`.
   - Dentro de la transacción (`VisitasService.registrarVisita`): un motivo que no existe es
     `motivo-visita-inexistente`; **uno dado de baja sí se acepta** (el vendedor lo eligió sin red). Un id que ya
     ocupa otra visita es `visita-id-ocupado`, con motivo neutro. La misma clave reenviada es `duplicada`.
   - **El servidor no revisa "exige foto" ni "exige nombre"**: lo exige la tablet al guardar.
   - Se guarda en `visita` con `id = clave` y `fecha = fecha_operacion`; el buzón apunta a esa fila
     (`entidad_tabla = 'visita'`). Puede haber varias visitas al día por cliente, y se puede visitar a un prospecto.
   - **Orden del push**: `jornadas → prospectos → ventas → cobranzas → visitas → rutas`. La visita a un prospecto
     capturado sin red necesita que su alta ya haya entrado en un lote anterior (el alcance se comprueba una vez por
     lote, como la venta de bienvenida de T-75).
   ````
5. Tabla de códigos de rechazo, dos filas al final:
   ```markdown
   | `motivo-visita-inexistente` | El `motivo_visita_id` de una visita no existe. Uno dado de baja **sí** se acepta. Se reintenta (T-39) |
   | `visita-id-ocupado` | El id (la clave) de la visita ya lo ocupa otro registro. Motivo neutro; avisar a la oficina (T-39) |
   ```
6. §7 "Una transacción por operación": agrega `visita` a la lista de tipos con proyección.
7. §9: la fila de "Forma de `datos` para gasto / merma / ruta" pasa a "gasto / merma (la de `ruta` sigue reservada
   sin forma; la visita es `visita`, §6)" con tickets **T-27 / T-33**, y la de proyección deja de nombrar a `ruta`
   como pendiente de T-39.

- [ ] **Paso 8: e2e del push de la visita**

`apps/backend/test/visita.e2e-spec.ts` (la Tarea 4 y la Tarea 5 le agregan casos):

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
 * T-39: la visita sin venta de punta a punta. Fija D2/D3 del lado servidor:
 * la clave es el id de la visita, la ubicacion es obligatoria (GPS o direccion),
 * un motivo dado de baja se acepta, uno inexistente no, un id ocupado se rechaza
 * con motivo neutro, el reenvio es `duplicada` y el servidor NO revisa
 * "exige foto/nombre". La visita a un prospecto va en el lote siguiente al de su
 * alta (el alcance se comprueba una vez por lote).
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN = `e2e-visita-${SUFIJO}`;
const PASSWORD = 'contrasena-del-vendedor';
const PREFIJO = `ZZ-visita-${SUFIJO}`;
const FECHA = '2026-10-17';

interface FilaVisita {
  id: string;
  cliente_id: string;
  motivo_visita_id: string;
  fecha_texto: string;
  observaciones: string | null;
  atendio: string | null;
  lat: string | null;
  lng: string | null;
  precision_m: string | null;
  direccion_texto: string | null;
  foto_archivo: string | null;
}

describe('Visita sin venta (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;

  let sucursalId: string;
  let vendedorId: string;
  let clienteId: string;
  let tipoNegocioId: string;
  let motivoId: string;
  let motivoBorradoId: string;
  let bearer: string;

  const push = async (operaciones: unknown[], token = bearer) => {
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ contrato: CONTRATO_ACTUAL, operaciones })
      .expect(200);
    return res.body as RespuestaPush;
  };

  const visita = (
    datos: Record<string, unknown> = {},
    sobre: Record<string, unknown> = {},
  ) => ({
    clave: randomUUID(),
    tipo: 'visita',
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T18:40:00.000Z`,
    cliente_id: clienteId,
    datos: {
      motivo_visita_id: motivoId,
      visitada_en: `${FECHA}T18:40:00.000Z`,
      observaciones: null,
      atendio: null,
      lat: 32.5149,
      lng: -117.0382,
      precision_m: 12,
      direccion_texto: null,
      ...datos,
    },
    ...sobre,
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
      tipo_negocio_id: tipoNegocioId,
      comentarios: null,
      lat: null,
      lng: null,
      foto: null,
    },
  });

  const filaVisita = (id: string): Promise<FilaVisita | undefined> =>
    db
      .selectFrom('visita')
      .select([
        'id',
        'cliente_id',
        'motivo_visita_id',
        'observaciones',
        'atendio',
        'lat',
        'lng',
        'precision_m',
        'direccion_texto',
        'foto_archivo',
      ])
      .select(sql<string>`fecha::text`.as('fecha_texto'))
      .where('id', '=', id)
      .executeTakeFirst();

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
        .where('deleted_at', 'is', null)
        .orderBy('codigo')
        .executeTakeFirstOrThrow()
    ).id;

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

    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Vendedor de visitas',
          password_hash: await new PasswordService().hashear(PASSWORD),
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    tipoNegocioId = (
      await db
        .insertInto('tipo_negocio')
        .values({ nombre: `${PREFIJO} Taqueria` })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // Exige foto Y nombre: el servidor igual no lo revisa (D3).
    motivoId = (
      await db
        .insertInto('motivo_visita')
        .values({ nombre: `${PREFIJO} Cerrado`, exige_foto: true, exige_atendio: true })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    motivoBorradoId = (
      await db
        .insertInto('motivo_visita')
        .values({ nombre: `${PREFIJO} Vacaciones`, deleted_at: new Date() })
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
    await db.deleteFrom('visita').where('vendedor_id', '=', vendedorId).execute();
    await db.deleteFrom('sync_operacion').where('vendedor_id', '=', vendedorId).execute();
    await db.deleteFrom('cliente').where('nombre', 'like', `${PREFIJO}%`).execute();
    await db.deleteFrom('motivo_visita').where('nombre', 'like', `${PREFIJO}%`).execute();
    await db.deleteFrom('tipo_negocio').where('id', '=', tipoNegocioId).execute();
    await db.deleteFrom('sesion_vendedor').where('vendedor_id', '=', vendedorId).execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
    await app.close();
  });

  it('una visita con GPS entra con la clave como id y el dia del sobre', async () => {
    const op = visita({ observaciones: '  Cortina abajo  ' });
    const r = (await push([op])).resultados[0];
    expect(r.estado).toBe('aplicada');

    const fila = await filaVisita(op.clave);
    expect(fila).toMatchObject({
      cliente_id: clienteId,
      motivo_visita_id: motivoId,
      fecha_texto: FECHA,
      observaciones: 'Cortina abajo',
      direccion_texto: null,
    });
    expect(Number(fila?.lat)).toBeCloseTo(32.5149, 6);
    expect(Number(fila?.precision_m)).toBe(12);
    expect(await buzon(op.clave)).toEqual({ entidad_tabla: 'visita', entidad_id: op.clave });
  });

  it('sin GPS, con direccion escrita, tambien entra', async () => {
    const op = visita({ lat: null, lng: null, precision_m: null, direccion_texto: ' Frente al parque ' });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
    expect(await filaVisita(op.clave)).toMatchObject({ lat: null, direccion_texto: 'Frente al parque' });
  });

  it('sin GPS y sin direccion es datos-invalidos y no deja fila', async () => {
    const op = visita({ lat: null, lng: null, direccion_texto: '   ' });
    expect((await push([op])).resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'datos-invalidos',
    });
    expect(await filaVisita(op.clave)).toBeUndefined();
    expect(await buzon(op.clave)).toBeUndefined();
  });

  it('el servidor no exige foto ni nombre aunque el motivo los pida (D3)', async () => {
    // `motivoId` tiene exige_foto y exige_atendio en true; la visita no trae ninguno.
    const op = visita({ atendio: null });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
  });

  it('puede haber varias visitas al mismo cliente el mismo dia', async () => {
    const r = await push([visita(), visita()]);
    expect(r.resultados.map((x) => x.estado)).toEqual(['aplicada', 'aplicada']);
  });

  it('reenviar la misma visita es duplicada y no deja una segunda fila (Review Focus 5)', async () => {
    const op = visita();
    const primero = (await push([op])).resultados[0];
    const reenvio = (await push([op])).resultados[0];
    expect(reenvio).toMatchObject({ estado: 'duplicada', id_servidor: primero.id_servidor });
    const filas = await db.selectFrom('visita').select('id').where('id', '=', op.clave).execute();
    expect(filas).toHaveLength(1);
  });

  it('un motivo dado de baja se acepta: el vendedor lo eligio sin red cuando estaba vivo', async () => {
    const op = visita({ motivo_visita_id: motivoBorradoId });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
  });

  it('un motivo que no existe es motivo-visita-inexistente y no deja fila', async () => {
    const op = visita({ motivo_visita_id: randomUUID() });
    expect((await push([op])).resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'motivo-visita-inexistente',
    });
    expect(await buzon(op.clave)).toBeUndefined();
  });

  it('un id que ya ocupa otra visita es visita-id-ocupado, con motivo neutro, y no deja fila', async () => {
    const ocupado = randomUUID();
    await db
      .insertInto('visita')
      .values({
        id: ocupado,
        vendedor_id: vendedorId,
        sucursal_id: sucursalId,
        cliente_id: clienteId,
        motivo_visita_id: motivoId,
        fecha: FECHA,
        visitada_en: new Date(),
        direccion_texto: 'sembrada a mano',
      })
      .execute();

    const r = (await push([visita({}, { clave: ocupado })])).resultados[0];
    expect(r).toMatchObject({ estado: 'rechazada', codigo: 'visita-id-ocupado' });
    expect(r.motivo).not.toContain(clienteId);
    expect(await buzon(ocupado)).toBeUndefined();
  });

  it('visita a un prospecto: su alta en un lote y la visita en el siguiente, en la misma sincronizacion', async () => {
    const alta = altaProspecto();
    expect((await push([alta])).resultados[0].estado).toBe('aplicada');
    const op = visita({}, { cliente_id: alta.clave });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
    expect(await filaVisita(op.clave)).toMatchObject({ cliente_id: alta.clave });
  });

  it('alta y visita en el MISMO lote: la visita cae por alcance; por eso la tablet sube prospectos antes', async () => {
    const alta = altaProspecto();
    const op = visita({}, { cliente_id: alta.clave });
    const r = await push([alta, op]);
    expect(r.resultados[0].estado).toBe('aplicada');
    expect(r.resultados[1]).toMatchObject({ estado: 'rechazada', codigo: 'cliente-fuera-de-alcance' });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
  });
});
```

`npm run test:e2e --workspace=apps/backend -- visita` → verde (corre también `prospecto-venta` y
`foto-prospecto` si el patrón los toca: deben seguir verdes).

- [ ] **Paso 9: lint por archivo, tablet typecheck y commit**

```bash
ARCHIVOS="src/modules/rutas/datos-jornada.ts src/modules/rutas/datos-visita.ts src/modules/rutas/datos-visita.spec.ts src/modules/rutas/visita-rechazada.ts src/modules/rutas/visitas.repository.ts src/modules/rutas/visitas.service.ts src/modules/rutas/visitas.service.spec.ts src/modules/rutas/rutas.module.ts src/modules/sincronizacion/despacho-visita.ts src/modules/sincronizacion/despacho-visita.spec.ts src/modules/sincronizacion/despacho.ts src/modules/sincronizacion/despacho.spec.ts src/modules/sincronizacion/sincronizacion.service.ts src/modules/sincronizacion/contrato.ts test/visita.e2e-spec.ts"
npm exec --workspace=apps/backend -- prettier --write $ARCHIVOS
npm exec --workspace=apps/backend -- eslint $ARCHIVOS
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run typecheck --workspace=apps/tablet && npm test --workspace=apps/tablet
git add apps/backend docs/contrato-sincronizacion.md apps/tablet/src/sincronizacion/contrato.ts
git commit -m "T-39: operación visita en el push (contrato, forma, proyección a visita)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 4: El pull baja `motivos_visita` y `foto_subida_en` del cliente (D4, D9)

**Files:**
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts`
- Modify: `apps/tablet/src/sincronizacion/contrato.ts`
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts` (`motivosVisita`, `clientes`)
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts` (`pull`)
- Modify: `docs/contrato-sincronizacion.md` (§5)
- Modify: `apps/backend/test/visita.e2e-spec.ts`

**Interfaces:**
- Consumes: tabla `motivo_visita` y su trigger `set_actualizado_en` (Tarea 1); `cliente.foto_subida_en` (T-40).
- Produces (contrato, los dos lados): `interface MotivoVisitaPull extends FilaSincronizable { nombre: string;
  exige_foto: boolean; exige_atendio: boolean }`; `RespuestaPull.catalogos.motivos_visita: MotivoVisitaPull[]`
  (opcional `?` en la copia de la tablet, como `tipos_negocio`); `ClientePull.foto_subida_en: string | null`
  (opcional `?` en la copia de la tablet). Repositorio: `motivosVisita(desde: Date | null): Promise<MotivoVisitaPull[]>`.

- [ ] **Paso 1: el e2e que falla**

En `apps/backend/test/visita.e2e-spec.ts`: importa `type RespuestaPull` junto a `RespuestaPush` y agrega la ayuda
después de `push`:

```ts
  const pull = async (desde?: string) => {
    const params = new URLSearchParams({ contrato: String(CONTRATO_ACTUAL) });
    if (desde) params.set('desde', desde);
    const res = await request(app.getHttpServer())
      .get(`/sync/pull?${params.toString()}`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    return res.body as RespuestaPull;
  };
```

y al final del `describe`:

```ts
  describe('pull (D4)', () => {
    it('el pull completo trae los motivos con sus casillas, la semilla y la baja como activo 0', async () => {
      const { catalogos } = await pull();
      const porNombre = new Map(catalogos.motivos_visita.map((m) => [m.nombre, m]));
      expect(porNombre.get('Cerrado')).toMatchObject({ exige_foto: true, exige_atendio: false, activo: 1 });
      expect(porNombre.get(`${PREFIJO} Cerrado`)).toMatchObject({
        id: motivoId,
        exige_foto: true,
        exige_atendio: true,
        activo: 1,
      });
      expect(porNombre.get(`${PREFIJO} Vacaciones`)).toMatchObject({ id: motivoBorradoId, activo: 0 });
    });

    it('dar de baja un motivo lo hace bajar en el pull incremental con activo 0', async () => {
      const { id } = await db
        .insertInto('motivo_visita')
        .values({ nombre: `${PREFIJO} Remodelacion` })
        .returning('id')
        .executeTakeFirstOrThrow();
      const { cursor } = await pull();

      // El trigger `set_actualizado_en` mueve la columna por la que corta el pull.
      await db.updateTable('motivo_visita').set({ deleted_at: new Date() }).where('id', '=', id).execute();

      const incremental = await pull(cursor);
      expect(incremental.catalogos.motivos_visita.find((m) => m.id === id)).toMatchObject({ activo: 0 });
    });

    it('los clientes traen foto_subida_en: null sin foto', async () => {
      const { catalogos } = await pull();
      expect(catalogos.clientes.find((c) => c.id === clienteId)).toMatchObject({ foto_subida_en: null });
    });
  });
```

`npm run test:e2e --workspace=apps/backend -- visita` → falla (`motivos_visita` no existe en la respuesta; error de
tipos también, que se corrige en el Paso 2).

- [ ] **Paso 2: el contrato, en los dos lados**

Backend `contrato.ts`:

1. Después de `TipoNegocioPull`:
   ```ts
/**
 * Un motivo de visita sin venta (T-39, D4): el catalogo de la pantalla
 * "Visita sin venta". Global (no cuelga de sucursal), como `tipos_negocio`.
 * Coleccion nueva = aditiva. Incremental por `actualizado_en`; la baja logica
 * viaja como `activo: 0` y la tablet deja de ofrecerlo (una visita ya guardada
 * con el sigue subiendo: el push lo acepta).
 */
export interface MotivoVisitaPull extends FilaSincronizable {
  nombre: string;
  /** La tablet no deja guardar la visita sin foto. */
  exige_foto: boolean;
  /** La tablet no deja guardar la visita sin el nombre de quien atendio. */
  exige_atendio: boolean;
}
   ```
2. En `ClientePull`, después de `saldo_favor_centavos`:
   ```ts
  /**
   * T-39 (D9): cuando el servidor recibio la foto del cliente (ISO), o `null`
   * si no tiene. La ficha de la tablet la baja de `GET /sync/foto/cliente/:id`
   * cuando no la tiene o la tiene mas vieja. Aditivo: una tablet vieja lo ignora.
   */
  foto_subida_en: string | null;
   ```
3. En `RespuestaPull.catalogos`, después de `tipos_negocio`:
   ```ts
    /** T-39. Aditiva: una tablet vieja la ignora. */
    motivos_visita: MotivoVisitaPull[];
   ```

Tablet `contrato.ts`: la misma `MotivoVisitaPull` (doc abreviado: "Copia del backend (T-39)"); en `ClientePull`
`foto_subida_en?: string | null;` con el comentario "T-39. **Opcional en la copia de la tablet**: un servidor anterior
no lo manda (`aSnapshot` lo vuelve `null`)."; en `catalogos`, `motivos_visita?: MotivoVisitaPull[];` con el comentario
"T-39. **Opcional en la copia de la tablet, obligatoria en el servidor**, por la misma razón que `tipos_negocio`: sin
la colección la pantalla de visita dice que no hay catálogo y no deja guardar."

- [ ] **Paso 3: repositorio y servicio**

`sincronizacion.repository.ts`: importa `MotivoVisitaPull`; después de `tiposNegocio`:

```ts
  /**
   * Motivos de visita (T-39, D4): catalogo global, como los tipos de negocio.
   *
   * Corta por `actualizado_en` y no por `updated_at`: el spec de T-39 nombra asi
   * las columnas de tiempo, y el trigger `set_actualizado_en` la mueve en
   * cualquier update (la baja logica incluida). Sin `desde` bajan todas, las
   * dadas de baja con `activo: 0`, igual que `tipos_negocio`.
   */
  async motivosVisita(desde: Date | null): Promise<MotivoVisitaPull[]> {
    let q = this.db
      .selectFrom('motivo_visita')
      .select(['id', 'nombre', 'exige_foto', 'exige_atendio', 'deleted_at']);
    if (desde) q = q.where('actualizado_en', '>', desde);

    return (await q.orderBy('nombre').execute()).map((f) => ({
      id: f.id,
      nombre: f.nombre,
      exige_foto: f.exige_foto,
      exige_atendio: f.exige_atendio,
      activo: bandera(true, f.deleted_at),
    }));
  }
```

En `clientes`: agrega `'foto_subida_en'` a la lista del `select` y al objeto mapeado:

```ts
      // T-39 (D9): la ficha de la tablet decide con esto si baja la foto.
      foto_subida_en: f.foto_subida_en
        ? new Date(f.foto_subida_en).toISOString()
        : null,
```

`sincronizacion.service.ts`, en `pull`: agrega `motivosVisita` a la desestructuración (después de `tiposNegocio`) y
`this.repo.motivosVisita(desde),` en la misma posición del `Promise.all` con el comentario
`// T-39: el catalogo de la pantalla de visita. No lleva sucursal.`; en `catalogos` agrega
`motivos_visita: motivosVisita,` después de `tipos_negocio`.

- [ ] **Paso 4: `docs/contrato-sincronizacion.md` §5**

1. En el JSON de la respuesta, después de `"tipos_negocio"`:
   ```jsonc
    "motivos_visita": [{ "id": "…", "nombre": "Cerrado", "exige_foto": true,
                         "exige_atendio": false, "activo": 1 }],
   ```
   y en el cliente de ejemplo agrega `"foto_subida_en": null,` antes de `"activo": 1`.
2. Nueva subsección después de "`tipos_negocio`: el catálogo del desplegable de prospectos (T-40)":
   ```markdown
   ### `motivos_visita`: el catálogo de la visita sin venta (T-39)

   Colección **nueva** y aditiva (§3). Baja completa (no por sucursal: es un catálogo de la empresa, como
   `tipos_negocio`) e incremental por **`actualizado_en`** (así se llaman las columnas de tiempo de
   `motivo_visita`; un trigger la mueve en cualquier cambio, la baja lógica incluida). La baja viaja como
   `activo: 0`: la tablet deja de ofrecer el motivo, y una visita ya guardada con él sube igual (el push lo acepta,
   §6). `exige_foto` y `exige_atendio` son booleanos JSON; **los exige la tablet**, el servidor no los revisa.

   ### `foto_subida_en` del cliente (T-39)

   Campo **nuevo** y aditivo en `clientes`: cuándo recibió el servidor la foto del cliente o prospecto, o `null`.
   La ficha de la tablet lo compara con su copia en caché y, si no la tiene o es más vieja, la baja de
   `GET /sync/foto/cliente/:clienteId` (§6, "Fotos"). Subir una foto toca `cliente.updated_at`, así que el cliente
   vuelve a bajar en el pull incremental con el valor nuevo.
   ```

- [ ] **Paso 5: correr, lint, build, typecheck de la tablet y commit**

```bash
npm run test:e2e --workspace=apps/backend -- visita
npm exec --workspace=apps/backend -- prettier --write src/modules/sincronizacion/contrato.ts src/modules/sincronizacion/sincronizacion.repository.ts src/modules/sincronizacion/sincronizacion.service.ts test/visita.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/sincronizacion/contrato.ts src/modules/sincronizacion/sincronizacion.repository.ts src/modules/sincronizacion/sincronizacion.service.ts test/visita.e2e-spec.ts
npm run build --workspace=apps/backend
npm run typecheck --workspace=apps/tablet && npm test --workspace=apps/tablet
git add apps/backend docs/contrato-sincronizacion.md apps/tablet/src/sincronizacion/contrato.ts
git commit -m "T-39: el pull baja motivos_visita y foto_subida_en del cliente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`sincronizacion.e2e-spec.ts` compara colecciones del pull: si alguna aserción fija la lista exacta de claves de
`catalogos`, agrega `motivos_visita` ahí (búscalo con `grep -n "tipos_negocio" apps/backend/test/*.ts`).

---

### Tarea 5: Fotos: el canal acepta visitas, archivos por id (T-78) y descarga a la tablet (D9)

**Files:**
- Modify: `apps/backend/src/modules/cartera-clientes/foto-prospecto.ts` (+ `foto-prospecto.spec.ts`)
- Modify: `apps/backend/src/modules/cartera-clientes/fotos.service.ts`
- Modify: `apps/backend/src/modules/cartera-clientes/fotos.repository.ts`
- Modify: `apps/backend/src/modules/rutas/visitas.repository.ts` (`existe`, `anotarFoto`)
- Modify: `apps/backend/src/modules/rutas/visitas.service.ts` (`existe`, `anotarFoto`)
- Modify: `apps/backend/src/modules/sincronizacion/foto.repository.ts` (`sucursalDeVendedor`)
- Modify: `apps/backend/src/modules/sincronizacion/foto.service.ts`
- Create: `apps/backend/src/modules/sincronizacion/foto.service.spec.ts`
- Modify: `apps/backend/src/modules/sincronizacion/foto.controller.ts`
- Modify: `apps/backend/test/foto-prospecto.e2e-spec.ts`
- Modify: `apps/backend/test/visita.e2e-spec.ts`
- Modify: `docs/contrato-sincronizacion.md` (§6, subsección "Fotos")

**Interfaces:**
- Consumes: `VisitasService` exportado por `RutasModule` (Tarea 3); `FotosService` exportado por
  `CarteraClientesModule`; `sync_operacion.entidad_tabla/entidad_id`.
- Produces:
  - `type EntidadFoto = 'cliente' | 'visita'`; `nombreArchivoFoto(entidad: EntidadFoto, id: string): string` →
    `` `${entidad}-${id}.jpg` `` (lanza si `id` no es un uuid en minúsculas).
  - `FotosService.guardar(clienteId: string, cuerpo: Buffer): Promise<FotoGuardada>` (ya sin `clave`);
    `FotosService.validarFoto(cuerpo: Buffer): void` (413/415); `FotosService.escribirArchivo(archivo: string,
    cuerpo: Buffer): Promise<void>`; `FotosService.rutaParaVendedor(sucursalId: string, clienteId: string):
    Promise<string>` (404 si no tiene foto o no es de esa sucursal).
  - `VisitasService.existe(id): Promise<boolean>`, `VisitasService.anotarFoto(id, archivo, subidaEn: Date):
    Promise<boolean>`.
  - `FotoService.rutaDeCliente(vendedorId, clienteId): Promise<string>`.
  - `GET /sync/foto/cliente/:clienteId` (`@SoloApp`): 200 con el JPEG, 404 sin foto / fuera de alcance.

- [ ] **Paso 1: pruebas unitarias que fallan**

`foto-prospecto.spec.ts`, reemplaza el `describe('nombreArchivoFoto', …)` completo por:

```ts
describe('nombreArchivoFoto (T-78)', () => {
  const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  it('es <entidad>-<id>.jpg: el nombre sale del id de la fila, no de la clave del push', () => {
    // Reenviar escribe el MISMO nombre: no hay duplicado posible porque no hay
    // dos nombres posibles. Ni contador, ni tabla de control.
    expect(nombreArchivoFoto('cliente', id)).toBe(`cliente-${id}.jpg`);
    expect(nombreArchivoFoto('visita', id)).toBe(`visita-${id}.jpg`);
    expect(nombreArchivoFoto('visita', id)).toBe(nombreArchivoFoto('visita', id));
  });

  it.each([
    ['../../etc/passwd', 'sale del directorio'],
    ['..%2F..%2Fx', 'escapado'],
    ['sub/carpeta', 'una barra'],
    ['', 'vacia'],
    ['no-es-un-uuid', 'no tiene la forma'],
    ['3F2504E0-4F89-41D3-9A0C-0305E82C3301', 'en mayusculas'],
  ])('lanza con un id que %s', (malo) => {
    expect(() => nombreArchivoFoto('cliente', malo)).toThrow(/id no utilizable/);
  });

  it('no sanea: un id malo lanza en vez de convertirse en otro', () => {
    expect(claveNombrable('../' + id)).toBe(false);
  });
});
```

`apps/backend/src/modules/sincronizacion/foto.service.spec.ts`:

```ts
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FotoService } from './foto.service';
import type { OperacionParaFoto } from './foto.repository';

const VENDEDOR = 'vendedor-1';
const CLAVE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
const SUBIDA = new Date('2026-10-17T19:00:00.000Z');

const operacion = (extra: Partial<OperacionParaFoto> = {}): OperacionParaFoto => ({
  id: 'op-1',
  vendedorId: VENDEDOR,
  tipo: 'visita',
  entidadTabla: 'visita',
  entidadId: CLAVE,
  ...extra,
});

function montar(operaciones: OperacionParaFoto[] = [operacion()]) {
  const repo = {
    porClave: jest.fn().mockResolvedValue(operaciones),
    sucursalDeVendedor: jest.fn().mockResolvedValue('sucursal-tj'),
  };
  const fotos = {
    guardar: jest.fn().mockResolvedValue({ archivo: `cliente-${CLAVE}.jpg`, subidaEn: SUBIDA }),
    validarFoto: jest.fn(),
    escribirArchivo: jest.fn().mockResolvedValue(undefined),
    rutaParaVendedor: jest.fn().mockResolvedValue('/fotos/cliente-x.jpg'),
  };
  const visitas = {
    existe: jest.fn().mockResolvedValue(true),
    anotarFoto: jest.fn().mockResolvedValue(true),
  };
  const servicio = new FotoService(repo as never, fotos as never, visitas as never);
  return { servicio, repo, fotos, visitas };
}

describe('FotoService.subir (T-39, D9)', () => {
  it('una clave que nadie tiene es 404', async () => {
    const { servicio } = montar([]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('una clave de otro vendedor es 403', async () => {
    const { servicio } = montar([operacion({ vendedorId: 'otro' })]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('una venta (o cualquier tipo sin foto) es 409', async () => {
    const { servicio } = montar([operacion({ tipo: 'venta', entidadTabla: 'venta_nota' })]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(ConflictException);
  });

  it('un prospecto se guarda en su cliente', async () => {
    const { servicio, fotos } = montar([operacion({ tipo: 'prospecto', entidadTabla: 'cliente' })]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).resolves.toEqual({
      clave: CLAVE,
      subida_en: SUBIDA.toISOString(),
    });
    expect(fotos.guardar).toHaveBeenCalledWith(CLAVE, JPEG);
  });

  it('un prospecto sin proyectar es 409', async () => {
    const { servicio } = montar([operacion({ tipo: 'prospecto', entidadTabla: null, entidadId: null })]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(ConflictException);
  });

  it('una visita valida, escribe visita-<id>.jpg y anota la fila', async () => {
    const { servicio, fotos, visitas } = montar();
    const r = await servicio.subir(VENDEDOR, CLAVE, JPEG);
    expect(fotos.validarFoto).toHaveBeenCalledWith(JPEG);
    expect(fotos.escribirArchivo).toHaveBeenCalledWith(`visita-${CLAVE}.jpg`, JPEG);
    expect(visitas.anotarFoto).toHaveBeenCalledWith(CLAVE, `visita-${CLAVE}.jpg`, expect.any(Date));
    expect(r.clave).toBe(CLAVE);
  });

  it('una visita sin proyectar es 409 y no escribe nada', async () => {
    const { servicio, fotos } = montar([operacion({ entidadTabla: null, entidadId: null })]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(ConflictException);
    expect(fotos.escribirArchivo).not.toHaveBeenCalled();
  });

  it('una visita que ya no existe es 404 y no escribe nada', async () => {
    const { servicio, fotos, visitas } = montar();
    visitas.existe.mockResolvedValue(false);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(NotFoundException);
    expect(fotos.escribirArchivo).not.toHaveBeenCalled();
  });

  it('una foto que no pasa la validacion no toca la visita', async () => {
    const { servicio, fotos, visitas } = montar();
    fotos.validarFoto.mockImplementation(() => {
      throw new Error('415');
    });
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toThrow('415');
    expect(visitas.existe).not.toHaveBeenCalled();
    expect(visitas.anotarFoto).not.toHaveBeenCalled();
  });
});

describe('FotoService.rutaDeCliente (T-39, D9)', () => {
  it('resuelve con la sucursal del vendedor del token', async () => {
    const { servicio, fotos } = montar();
    await expect(servicio.rutaDeCliente(VENDEDOR, CLAVE)).resolves.toBe('/fotos/cliente-x.jpg');
    expect(fotos.rutaParaVendedor).toHaveBeenCalledWith('sucursal-tj', CLAVE);
  });

  it('un vendedor que ya no existe es 404', async () => {
    const { servicio, repo } = montar();
    repo.sucursalDeVendedor.mockResolvedValue(null);
    await expect(servicio.rutaDeCliente(VENDEDOR, CLAVE)).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

`npm test --workspace=apps/backend -- foto` → fallan.

- [ ] **Paso 2: nombre por id (`foto-prospecto.ts`)**

Reemplaza `nombreArchivoFoto` (y su doc-comment) por:

```ts
/** A que fila pertenece una foto. El prefijo del archivo lo dice (T-78). */
export type EntidadFoto = 'cliente' | 'visita';

/**
 * `<entidad>-<id>.jpg` (T-78).
 *
 * El nombre sale del **id de la fila** a la que pertenece la foto, nunca de la
 * clave de idempotencia: asi el archivo se encuentra por lo que es (la foto del
 * cliente X, la de la visita Y). Reenviar sigue escribiendo el mismo nombre, que
 * es toda la idempotencia que hace falta. Los archivos de antes de T-78
 * (`<clave>.jpg`) **no se migran**: `foto_archivo` guarda el nombre y el
 * servidor siempre lee por esa columna.
 *
 * Lanza si el id no es nombrable en vez de sanearlo: "saneado" significaria que
 * dos ids distintos pueden acabar en el mismo archivo.
 */
export function nombreArchivoFoto(entidad: EntidadFoto, id: string): string {
  if (!claveNombrable(id)) {
    throw new Error(`id no utilizable como nombre de archivo: ${JSON.stringify(id)}`);
  }
  return `${entidad}-${id}.jpg`;
}
```

Actualiza el doc de `RE_CLAVE`/`claveNombrable`: "El id que puede nombrar un archivo (el de `cliente` o `visita`, un
uuid en minúsculas)". `FotoDeCliente.archivo` en `fotos.repository.ts`: "Nombre dentro de `FOTOS_DIR`
(`cliente-<id>.jpg`, o `<clave>.jpg` si llegó antes de T-78)".

- [ ] **Paso 3: `FotosService` generalizado**

En `fotos.service.ts`:

1. `guardar` pierde el parámetro `clave`:
   ```ts
  async guardar(clienteId: string, cuerpo: Buffer): Promise<FotoGuardada> {
    this.validarFoto(cuerpo);

    // Antes de escribir: que el prospecto siga ahi. Un archivo para una fila que
    // no existe es basura que nadie va a buscar nunca.
    if (!(await this.repo.existe(clienteId))) {
      throw new NotFoundException('Ese prospecto ya no existe.');
    }

    // T-78: el archivo se llama por el id del cliente, no por la clave.
    const archivo = nombreArchivoFoto('cliente', clienteId);
    await this.escribirArchivo(archivo, cuerpo);

    const subidaEn = new Date();
    if (!(await this.repo.anotar(clienteId, archivo, subidaEn))) {
      throw new NotFoundException('Ese prospecto ya no existe.');
    }
    return { archivo, subidaEn };
  }
   ```
2. Los dos `if` de tamaño y formato que estaban al principio de `guardar` pasan, tal cual, a un método público:
   ```ts
  /**
   * 413 si pasa de 2 MB, 415 si el contenido no es un JPEG completo. Publico
   * porque la foto de la visita (T-39) pasa por las mismas reglas: lo llama
   * `sincronizacion/foto.service.ts` ANTES de tocar disco o base.
   */
  validarFoto(cuerpo: Buffer): void {
    if (cuerpo.length > TAMANO_MAX_FOTO_BYTES) {
      throw new PayloadTooLargeException(
        `La foto pesa ${cuerpo.length} bytes y el maximo es ${TAMANO_MAX_FOTO_BYTES}. Comprimela mas en el equipo antes de subirla.`,
      );
    }
    if (!esJpeg(cuerpo)) {
      throw new UnsupportedMediaTypeException(
        'El contenido no es un JPEG completo. Vuelve a tomar la foto: la anterior llego corrupta o a medias.',
      );
    }
  }
   ```
3. `escribirAtomico` se renombra `escribirArchivo` y pasa de `private` a público, con una línea más en su doc:
   "Público desde T-39: la foto de la visita usa el mismo disco y la misma escritura atómica; su fila la anota Rutas,
   no este módulo."
4. La comprobación de "el archivo está y se puede leer" de `rutaParaPortal` se extrae a un privado y se reusa:
   ```ts
  async rutaParaPortal(usuarioId: string, clienteId: string): Promise<string> {
    await this.clientes.obtener(usuarioId, clienteId);
    const foto = await this.repo.foto(clienteId);
    if (!foto) throw new NotFoundException('Ese cliente no tiene foto.');
    return this.rutaLegible(foto.archivo, clienteId);
  }

  /**
   * La foto de un cliente para la TABLET (T-39, D9): solo si es de la sucursal
   * del vendedor y no esta dado de baja. Fuera de alcance es 404 y no 403, a
   * proposito: la tablet no tiene por que saber si ese cliente existe.
   */
  async rutaParaVendedor(sucursalId: string, clienteId: string): Promise<string> {
    const foto = await this.repo.fotoEnSucursal(clienteId, sucursalId);
    if (!foto) throw new NotFoundException('Ese cliente no tiene foto.');
    return this.rutaLegible(foto.archivo, clienteId);
  }

  /** La ruta absoluta del archivo, o 404 si la columna apunta a algo que ya no esta en disco. */
  private async rutaLegible(archivo: string, clienteId: string): Promise<string> {
    const ruta = join(this.directorio, archivo);
    try {
      await fs.access(ruta, FS.R_OK);
    } catch {
      this.logger.warn(
        `cliente ${clienteId}: foto_archivo apunta a ${ruta}, que no esta en el disco`,
      );
      throw new NotFoundException('Ese cliente no tiene foto.');
    }
    return ruta;
  }
   ```
5. El log de `onModuleInit` dice `Fotos de prospectos y visitas en ${this.directorio}`.

`fotos.repository.ts`, después de `foto`:

```ts
  /** La foto de ese cliente si es de esa sucursal y esta vivo; si no, `null` (T-39). */
  async fotoEnSucursal(clienteId: string, sucursalId: string): Promise<FotoDeCliente | null> {
    const fila = await this.db
      .selectFrom('cliente')
      .select(['foto_archivo', 'foto_subida_en'])
      .where('id', '=', clienteId)
      .where('sucursal_id', '=', sucursalId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!fila?.foto_archivo) return null;
    return { archivo: fila.foto_archivo, subidaEn: fila.foto_subida_en ?? new Date(0) };
  }
```

- [ ] **Paso 4: la visita anota su foto (Rutas)**

`visitas.repository.ts`: el repositorio necesita la conexión normal para la foto (va fuera de la transacción del
push). Agrega el constructor `constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}` (imports
`Inject` y `DB_CONNECTION, type Database` de `../../database/database.tokens`) y:

```ts
  /** ¿Sigue existiendo esa visita? Antes de escribir su foto en disco. */
  async existe(id: string): Promise<boolean> {
    const fila = await this.db.selectFrom('visita').select('id').where('id', '=', id).executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * Anota la foto en la visita (nombre y fecha juntos, `ck_visita_foto_completa`).
   * `false` si la fila ya no estaba.
   */
  async anotarFoto(id: string, archivo: string, subidaEn: Date): Promise<boolean> {
    const fila = await this.db
      .updateTable('visita')
      .set({ foto_archivo: archivo, foto_subida_en: subidaEn })
      .where('id', '=', id)
      .returning('id')
      .executeTakeFirst();
    return fila !== undefined;
  }
```

`visitas.service.ts`:

```ts
  /** T-39 (D9): para el canal de fotos. */
  existe(id: string): Promise<boolean> {
    return this.repo.existe(id);
  }

  /** T-39 (D9): el archivo ya esta en disco; esto anota la columna. */
  anotarFoto(id: string, archivo: string, subidaEn: Date): Promise<boolean> {
    return this.repo.anotarFoto(id, archivo, subidaEn);
  }
```

En `visitas.service.spec.ts`, el `montar()` ya pasa un objeto con `motivoExiste` e `insertar`; no cambia.

- [ ] **Paso 5: el canal de fotos (`sincronizacion/`)**

`foto.repository.ts`, después de `porClave`:

```ts
  /** La sucursal del vendedor del token, para la descarga de fotos (T-39). `null` si no existe. */
  async sucursalDeVendedor(vendedorId: string): Promise<string | null> {
    const fila = await this.db
      .selectFrom('vendedor')
      .select('sucursal_id')
      .where('id', '=', vendedorId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila?.sucursal_id ?? null;
  }
```

`foto.service.ts`:

1. Import `import { VisitasService } from '../rutas/visitas.service';` y
   `import { nombreArchivoFoto } from '../cartera-clientes/foto-prospecto';`; constructor gana, al final,
   `// T-39: Rutas es la duena de \`visita\` y de sus dos columnas de foto.` + `private readonly visitas: VisitasService,`.
2. Desde `if (mia.tipo !== 'prospecto') {` hasta el `return` final, reemplaza por:
   ```ts
    if (mia.tipo === 'prospecto') {
      if (mia.entidadTabla !== 'cliente' || mia.entidadId === null) {
        throw new ConflictException(
          'Ese prospecto todavia no esta proyectado en la cartera. Reintenta en la siguiente sincronizacion.',
        );
      }
      const guardada = await this.fotos.guardar(mia.entidadId, cuerpo);
      return { clave, subida_en: guardada.subidaEn.toISOString() };
    }

    if (mia.tipo === 'visita') {
      // Mismo 409 que el prospecto: la tablet la deja pendiente y reintenta.
      if (mia.entidadTabla !== 'visita' || mia.entidadId === null) {
        throw new ConflictException(
          'Esa visita todavia no esta proyectada. Reintenta en la siguiente sincronizacion.',
        );
      }
      const subidaEn = await this.guardarDeVisita(mia.entidadId, cuerpo);
      return { clave, subida_en: subidaEn.toISOString() };
    }

    // Una venta (o cualquier otro tipo) no tiene foto. `409` y no `400`: la
    // peticion esta bien formada, lo que no encaja es el estado del servidor.
    throw new ConflictException(
      `La operacion ${clave} es de tipo "${mia.tipo}", y solo un prospecto o una visita lleva foto.`,
    );
  }

  /**
   * La foto de una visita (T-39): mismas reglas de bytes que la del prospecto
   * (`validarFoto`), el mismo disco (`escribirArchivo`) y el mismo orden — el
   * archivo primero, la columna despues (ver el aviso de `FotosService`).
   */
  private async guardarDeVisita(visitaId: string, cuerpo: Buffer): Promise<Date> {
    this.fotos.validarFoto(cuerpo);
    if (!(await this.visitas.existe(visitaId))) {
      throw new NotFoundException('Esa visita ya no existe.');
    }
    const archivo = nombreArchivoFoto('visita', visitaId);
    await this.fotos.escribirArchivo(archivo, cuerpo);
    const subidaEn = new Date();
    if (!(await this.visitas.anotarFoto(visitaId, archivo, subidaEn))) {
      throw new NotFoundException('Esa visita ya no existe.');
    }
    return subidaEn;
  }

  /**
   * `GET /sync/foto/cliente/:clienteId` (T-39, D9): la ruta del JPEG del
   * cliente o prospecto, si es de la sucursal del vendedor del token.
   */
  async rutaDeCliente(vendedorId: string, clienteId: string): Promise<string> {
    const sucursalId = await this.repo.sucursalDeVendedor(vendedorId);
    if (sucursalId === null) throw new NotFoundException('Ese cliente no tiene foto.');
    return this.fotos.rutaParaVendedor(sucursalId, clienteId);
  }
   ```
   (El cierre `}` de `subir` queda dentro del bloque de arriba; borra el que sobre.) Actualiza el doc de la clase:
   "`POST /sync/foto/:clave`: resolver la clave (prospecto o visita, T-39) y despachar al dueño de la fila."

`foto.controller.ts`: imports `createReadStream` de `node:fs` y `Get, Header, StreamableFile` de `@nestjs/common`;
el doc de `subir` cambia "de ahi sale el nombre del archivo (`<clave>.jpg`)" por "el archivo se nombra por el id de la
fila (`cliente-<id>.jpg` o `visita-<id>.jpg`, T-78), así que reenviar escribe el mismo nombre". Agrega:

```ts
  /**
   * `GET /sync/foto/cliente/:clienteId` (T-39, D9): la foto del cliente o
   * prospecto para la ficha de la tablet. 404 si no tiene foto o no es de la
   * sucursal del vendedor (no 403: no se confirma que exista).
   *
   * Las fotos de las visitas NO bajan: nadie las necesita en la tablet todavia.
   */
  @SoloApp()
  @Get('foto/cliente/:clienteId')
  @Header('Cache-Control', 'private, max-age=300')
  async fotoDeCliente(
    @VendedorActual() vendedorId: string,
    @Param('clienteId', ParseUUIDPipe) clienteId: string,
  ): Promise<StreamableFile> {
    const ruta = await this.foto.rutaDeCliente(vendedorId, clienteId.toLowerCase());
    return new StreamableFile(createReadStream(ruta), { type: 'image/jpeg' });
  }
```

`npm test --workspace=apps/backend -- foto` → verde.

- [ ] **Paso 6: e2e — prospecto con el nombre nuevo y visita con foto y descarga**

`test/foto-prospecto.e2e-spec.ts` (T-75: `cliente.id` == clave, así que el archivo es `cliente-<clave>.jpg`):

1. Reemplaza **todas** las apariciones de `` `${clave}.jpg` `` por `` `cliente-${clave}.jpg` ``:
   ```bash
   sed -i '' 's/`${clave}.jpg`/`cliente-${clave}.jpg`/g' apps/backend/test/foto-prospecto.e2e-spec.ts
   grep -n '\.jpg' apps/backend/test/foto-prospecto.e2e-spec.ts   # ninguna `${clave}.jpg` suelta
   ```
2. `archivosDe` filtra con `n.includes(clave)` en vez de `n.startsWith(clave)` (el doc: "Todo lo que hay en
   FOTOS_DIR cuyo nombre contenga esa clave").
3. En el doc de la suite, "como se nombra el archivo (`<clave>.jpg`)" → "como se nombra el archivo
   (`cliente-<id>.jpg`, T-78)".

`test/visita.e2e-spec.ts`:

1. **Primera línea del archivo**, antes de todo import (ver el aviso de `apoyo-fotos-dir.ts`):
   ```ts
// PRIMER import, a proposito: pone FOTOS_DIR antes de que `app.module.ts` lea la configuracion.
import { FOTOS_DIR_PRUEBA } from './apoyo-fotos-dir';
   ```
   y en los imports: `import { promises as fs } from 'node:fs';` y `import { join } from 'node:path';`.
2. Variables nuevas: `let sucursalAjenaId: string; let vendedorAjenoId: string; let bearerAjeno: string;` y
   `const LOGIN_AJENO = \`e2e-visita-a-${SUFIJO}\`;`. En `beforeAll`, toma las dos primeras sucursales vivas
   (`orderBy('codigo')`, `expect(...length).toBeGreaterThanOrEqual(2)`), crea el vendedor ajeno en la segunda con la
   misma contraseña y guarda su `tokenAcceso` en `bearerAjeno`. En `afterAll`, borra también su `sesion_vendedor` y su
   `vendedor` (con `where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])` y `where('id', 'in', [...])`) y al
   final `await fs.rm(FOTOS_DIR_PRUEBA, { recursive: true, force: true });`.
3. Ayudas:
   ```ts
  const jpeg = (relleno = 'foto'): Buffer =>
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(relleno, 'utf8'), Buffer.from([0xff, 0xd9])]);

  const subirFoto = (clave: string, cuerpo: Buffer, token = bearer) =>
    request(app.getHttpServer())
      .post(`/sync/foto/${clave}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'image/jpeg')
      .send(cuerpo);

  const bajarFoto = (clienteIdBuscado: string, token = bearer) =>
    request(app.getHttpServer())
      .get(`/sync/foto/cliente/${clienteIdBuscado}`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((res, fin) => {
        const partes: Buffer[] = [];
        res.on('data', (p: Buffer) => partes.push(p));
        res.on('end', () => fin(null, Buffer.concat(partes)));
      });

  const archivos = async (id: string) => (await fs.readdir(FOTOS_DIR_PRUEBA)).filter((n) => n.includes(id));
   ```
4. Casos nuevos al final del `describe`:
   ```ts
  describe('fotos (D9, T-78)', () => {
    it('la foto de una visita aplicada se guarda como visita-<id>.jpg y se anota en la visita', async () => {
      const op = visita();
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      const bytes = jpeg('cortina abajo');

      const res = await subirFoto(op.clave, bytes).expect(200);
      expect(res.body).toMatchObject({ clave: op.clave });
      expect(await archivos(op.clave)).toEqual([`visita-${op.clave}.jpg`]);
      expect(await fs.readFile(join(FOTOS_DIR_PRUEBA, `visita-${op.clave}.jpg`))).toEqual(bytes);
      const fila = await db.selectFrom('visita').select(['foto_archivo', 'foto_subida_en']).where('id', '=', op.clave).executeTakeFirstOrThrow();
      expect(fila.foto_archivo).toBe(`visita-${op.clave}.jpg`);
      expect(fila.foto_subida_en).not.toBeNull();
    });

    it('subir dos veces la foto de la misma visita deja un solo archivo (Review Focus 5)', async () => {
      const op = visita();
      await push([op]);
      await subirFoto(op.clave, jpeg('primer intento')).expect(200);
      const segunda = jpeg('segundo intento');
      await subirFoto(op.clave, segunda).expect(200);
      expect(await archivos(op.clave)).toEqual([`visita-${op.clave}.jpg`]);
      expect(await fs.readFile(join(FOTOS_DIR_PRUEBA, `visita-${op.clave}.jpg`))).toEqual(segunda);
    });

    it('la foto de una visita rechazada es 404 y no deja archivo', async () => {
      const op = visita({ motivo_visita_id: randomUUID() });
      expect((await push([op])).resultados[0].estado).toBe('rechazada');
      await subirFoto(op.clave, jpeg()).expect(404);
      expect(await archivos(op.clave)).toEqual([]);
    });

    it('la foto de un prospecto se llama cliente-<id>.jpg y la tablet la baja de su sucursal', async () => {
      const alta = altaProspecto();
      await push([alta]);
      const bytes = jpeg('la fachada');
      await subirFoto(alta.clave, bytes).expect(200);
      expect(await archivos(alta.clave)).toEqual([`cliente-${alta.clave}.jpg`]);

      const res = await bajarFoto(alta.clave).expect(200);
      expect(res.headers['content-type']).toMatch(/image\/jpeg/);
      expect(res.body).toEqual(bytes);
    });

    it('un cliente sin foto es 404', async () => {
      await bajarFoto(clienteId).expect(404);
    });

    it('un cliente de otra sucursal es 404, no 403: no se confirma que exista', async () => {
      const alta = altaProspecto();
      await push([alta]);
      await subirFoto(alta.clave, jpeg()).expect(200);
      await bajarFoto(alta.clave, bearerAjeno).expect(404);
    });

    it('la descarga sin token es 401', async () => {
      await request(app.getHttpServer()).get(`/sync/foto/cliente/${clienteId}`).expect(401);
    });
  });
   ```

`npm run test:e2e --workspace=apps/backend -- foto visita` → verde.

- [ ] **Paso 7: `docs/contrato-sincronizacion.md`, subsección "Fotos"**

Al final del §6 (antes de "Respuesta `200` — parcial y honesta"), nueva subsección:

```markdown
### Fotos: subida y descarga (canal aparte del lote; T-40, T-39)

La foto **no** viaja dentro de la operación: va por su propio request, sin `contrato` ni `resultados[]`, solo
códigos HTTP. Así una imagen pesada o cortada nunca rechaza la operación a la que pertenece.

- **`POST /sync/foto/:clave`** (`@SoloApp`, cuerpo = el JPEG crudo, máx. 2 MB). La `clave` es la de una operación
  `prospecto` **o** `visita` del vendedor del token. 404 si nadie tiene esa clave (o la operación se rechazó: no dejó
  fila); 403 si es de otro vendedor; 409 si es de otro tipo o aún no está proyectada; 413 si pesa de más; 415 si no es
  un JPEG completo. Responde `200 { clave, subida_en }` también la primera vez.
- **Nombre del archivo (T-78):** `cliente-<cliente.id>.jpg` y `visita-<visita.id>.jpg`, nunca la clave. Reenviar
  escribe el mismo nombre: un solo archivo. Los archivos de antes (`<clave>.jpg`) no se migran; el servidor siempre
  lee por `foto_archivo`.
- La foto del prospecto se anota en `cliente.foto_archivo/foto_subida_en`; la de la visita, en
  `visita.foto_archivo/foto_subida_en`.
- **`GET /sync/foto/cliente/:clienteId`** (`@SoloApp`): el JPEG de la foto del cliente o prospecto si es de la
  sucursal del vendedor y está vivo; **404** si no tiene foto o no está en su alcance (no 403: no confirma que
  exista). La tablet lo pide cuando `foto_subida_en` (§5) es más nuevo que su copia. Las fotos de visitas **no** bajan.
```

- [ ] **Paso 8: lint, build, pruebas completas y commit**

```bash
ARCHIVOS="src/modules/cartera-clientes/foto-prospecto.ts src/modules/cartera-clientes/foto-prospecto.spec.ts src/modules/cartera-clientes/fotos.service.ts src/modules/cartera-clientes/fotos.repository.ts src/modules/rutas/visitas.repository.ts src/modules/rutas/visitas.service.ts src/modules/sincronizacion/foto.repository.ts src/modules/sincronizacion/foto.service.ts src/modules/sincronizacion/foto.service.spec.ts src/modules/sincronizacion/foto.controller.ts test/foto-prospecto.e2e-spec.ts test/visita.e2e-spec.ts"
npm exec --workspace=apps/backend -- prettier --write $ARCHIVOS
npm exec --workspace=apps/backend -- eslint $ARCHIVOS
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
git add apps/backend docs/contrato-sincronizacion.md
git commit -m "T-39: fotos de visita, archivos por id (T-78) y descarga de la foto del cliente

Closes #129 (T-78): los archivos nuevos se llaman cliente-<id>.jpg y visita-<id>.jpg; los viejos no se migran.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 6: Portal: Catálogo › Motivos de visita (D5)

**Files:**
- Create: `apps/portal/src/lib/motivos-visita.ts`
- Create: `apps/portal/src/components/motivos-visita/formulario-motivo-visita.tsx`
- Create: `apps/portal/src/components/motivos-visita/pantalla-motivos-visita.tsx`
- Create: `apps/portal/src/components/motivos-visita/pantalla-motivos-visita.test.tsx`
- Create: `apps/portal/src/app/(portal)/catalogo/motivos-de-visita/page.tsx`
- Modify: `apps/portal/src/components/layout/nav-config.ts`

**Interfaces:**
- Consumes: los endpoints de la Tarea 2; `useCatalogo`, `TablaCatalogo`, `useEnvioFormulario`, `useAuth().puede`,
  `apiFetch`, `mensajeDe`, `ErrorApi`.
- Produces: `PERMISO_MOTIVOS_VISITA = "motivo-visita.gestionar"`; `interface MotivoVisita { id; nombre; exigeFoto;
  exigeAtendio }`; `listarMotivosVisita()`, `crearMotivoVisita(datos)`, `editarMotivoVisita(id, datos)`,
  `eliminarMotivoVisita(id)`; la página `/catalogo/motivos-de-visita`.

- [ ] **Paso 1: la prueba de pantalla que falla** (patrón de T-65: Testing Library, `lib` y `useAuth` simulados)

`apps/portal/src/components/motivos-visita/pantalla-motivos-visita.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as lib from "@/lib/motivos-visita";
import { PantallaMotivosVisita } from "./pantalla-motivos-visita";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/motivos-visita", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/motivos-visita")>();
  return {
    ...real,
    listarMotivosVisita: vi.fn(),
    crearMotivoVisita: vi.fn(),
    editarMotivoVisita: vi.fn(),
    eliminarMotivoVisita: vi.fn(),
  };
});

const MOTIVOS = [
  { id: "m1", nombre: "Cerrado", exigeFoto: true, exigeAtendio: false },
  { id: "m2", nombre: "No estaba el encargado", exigeFoto: true, exigeAtendio: true },
];

function sesion(puede: boolean) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: { sucursal: null, permisos: puede ? [lib.PERMISO_MOTIVOS_VISITA] : [] } as never,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: () => puede,
  });
}

describe("PantallaMotivosVisita", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lib.listarMotivosVisita).mockResolvedValue(MOTIVOS);
  });

  it("lista cada motivo con sus casillas en Sí/No y, con permiso, Editar y Eliminar", async () => {
    sesion(true);
    render(<PantallaMotivosVisita />);
    const fila = (await screen.findByText("Cerrado")).closest("tr")!;
    expect(within(fila).getAllByRole("cell").map((c) => c.textContent)).toEqual(
      expect.arrayContaining(["Cerrado", "Sí", "No"]),
    );
    expect(within(fila).getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(within(fila).getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo motivo" })).toBeInTheDocument();
  });

  it("sin motivo-visita.gestionar solo se lee: sin alta ni botones por fila", async () => {
    sesion(false);
    render(<PantallaMotivosVisita />);
    const fila = (await screen.findByText("Cerrado")).closest("tr")!;
    expect(within(fila).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Nuevo motivo" })).toBeNull();
  });

  it("el alta manda el nombre y las dos casillas", async () => {
    sesion(true);
    vi.mocked(lib.crearMotivoVisita).mockResolvedValue({ id: "m3", nombre: "Bodega", exigeFoto: true, exigeAtendio: false });
    render(<PantallaMotivosVisita />);
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo motivo" }));
    await userEvent.type(screen.getByLabelText("Nombre del motivo"), "Bodega");
    await userEvent.click(screen.getByLabelText("Exige foto"));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(lib.crearMotivoVisita).toHaveBeenCalledWith({ nombre: "Bodega", exigeFoto: true, exigeAtendio: false });
    await vi.waitFor(() => expect(lib.listarMotivosVisita).toHaveBeenCalledTimes(2));
  });

  it("editar precarga el motivo y manda lo cambiado", async () => {
    sesion(true);
    vi.mocked(lib.editarMotivoVisita).mockResolvedValue({ ...MOTIVOS[0], exigeAtendio: true });
    render(<PantallaMotivosVisita />);
    const fila = (await screen.findByText("Cerrado")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Editar" }));
    expect(screen.getByLabelText("Nombre del motivo")).toHaveValue("Cerrado");
    expect(screen.getByLabelText("Exige foto")).toBeChecked();
    await userEvent.click(screen.getByLabelText("Exige nombre de quien atendió"));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(lib.editarMotivoVisita).toHaveBeenCalledWith("m1", { nombre: "Cerrado", exigeFoto: true, exigeAtendio: true });
  });

  it("un nombre repetido muestra el mensaje del servidor (409)", async () => {
    sesion(true);
    vi.mocked(lib.crearMotivoVisita).mockRejectedValue(
      new ErrorApi("conflicto", 409, 'Ya existe un motivo de visita llamado "Cerrado".'),
    );
    render(<PantallaMotivosVisita />);
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo motivo" }));
    await userEvent.type(screen.getByLabelText("Nombre del motivo"), "cerrado");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('Ya existe un motivo de visita llamado "Cerrado".');
  });

  it("eliminar pide confirmación, da de baja y recarga", async () => {
    sesion(true);
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(lib.eliminarMotivoVisita).mockResolvedValue({ id: "m1" });
    render(<PantallaMotivosVisita />);
    const fila = (await screen.findByText("Cerrado")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Eliminar" }));
    expect(confirmar).toHaveBeenCalledWith(
      '¿Seguro que quieres eliminar el motivo "Cerrado"? Las visitas ya registradas lo conservan, pero las tablets dejarán de ofrecerlo.',
    );
    expect(lib.eliminarMotivoVisita).toHaveBeenCalledWith("m1");
    expect(lib.listarMotivosVisita).toHaveBeenCalledTimes(2);
  });
});
```

Antes de escribirla, confirma la firma de `ErrorApi` en `apps/portal/src/lib/api.ts` (`new ErrorApi(message,
status, mensajeApi)`) y la forma del valor de `useAuth()` en `pestana-cuentas.test.tsx`; si difieren, ajusta solo
esas dos líneas.

- [ ] **Paso 2: correr y ver fallar**

`npm test --workspace=apps/portal -- motivos-visita` → falla: no existe `./pantalla-motivos-visita`.

- [ ] **Paso 3: `lib`, formulario, pantalla, página y menú**

`apps/portal/src/lib/motivos-visita.ts`:

```ts
import { apiFetch } from "./api";

// Copia de `MotivoVisita` de apps/backend/src/modules/rutas/motivos-visita.repository.ts
// (el portal no puede importar del backend). T-39, D5.

export const PERMISO_MOTIVOS_VISITA = "motivo-visita.gestionar";

export interface MotivoVisita {
  id: string;
  nombre: string;
  /** La tablet no deja guardar la visita sin foto. */
  exigeFoto: boolean;
  /** La tablet no deja guardar la visita sin el nombre de quien atendió. */
  exigeAtendio: boolean;
}

export type DatosMotivoVisita = Omit<MotivoVisita, "id">;

/** Solo los vivos: la baja lógica los saca de aquí (y del pull de la tablet). */
export function listarMotivosVisita(): Promise<MotivoVisita[]> {
  return apiFetch<MotivoVisita[]>("/motivos-visita");
}

export function crearMotivoVisita(datos: DatosMotivoVisita): Promise<MotivoVisita> {
  return apiFetch<MotivoVisita>("/motivos-visita", { method: "POST", body: JSON.stringify(datos) });
}

export function editarMotivoVisita(id: string, datos: DatosMotivoVisita): Promise<MotivoVisita> {
  return apiFetch<MotivoVisita>(`/motivos-visita/${id}`, { method: "PATCH", body: JSON.stringify(datos) });
}

export function eliminarMotivoVisita(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/motivos-visita/${id}`, { method: "DELETE" });
}
```

`apps/portal/src/components/motivos-visita/formulario-motivo-visita.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { crearMotivoVisita, editarMotivoVisita, type MotivoVisita } from "@/lib/motivos-visita";

interface Props {
  motivo: MotivoVisita | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

/** Alta y edición de un motivo de visita: el nombre y las dos casillas (T-39, D5). */
export function FormularioMotivoVisita({ motivo, alGuardar, alCancelar }: Props) {
  const [nombre, setNombre] = useState(motivo?.nombre ?? "");
  const [exigeFoto, setExigeFoto] = useState(motivo?.exigeFoto ?? false);
  const [exigeAtendio, setExigeAtendio] = useState(motivo?.exigeAtendio ?? false);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo guardar el motivo.");

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = { nombre, exigeFoto, exigeAtendio };
    await enviar(() => (motivo ? editarMotivoVisita(motivo.id, datos) : crearMotivoVisita(datos)), alGuardar);
  }

  return (
    <form onSubmit={alEnviar} className="mb-6 flex flex-col gap-4 rounded-md border p-4">
      <h2 className="text-sm font-semibold">{motivo ? `Editar ${motivo.nombre}` : "Nuevo motivo"}</h2>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="motivo-nombre" className="text-sm font-medium">
          Nombre del motivo
        </label>
        <input
          id="motivo-nombre"
          required
          maxLength={80}
          disabled={enviando}
          placeholder="Cerrado, Sin dinero, Tenía producto…"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="w-96 max-w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={exigeFoto} disabled={enviando} onChange={(e) => setExigeFoto(e.target.checked)} />
        Exige foto
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={exigeAtendio}
          disabled={enviando}
          onChange={(e) => setExigeAtendio(e.target.checked)}
        />
        Exige nombre de quien atendió
      </label>
      <p className="text-xs text-muted-foreground">
        Las casillas las exige la tablet al guardar la visita. Si las cambias, las visitas ya capturadas sin red suben
        igual.
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

`apps/portal/src/components/motivos-visita/pantalla-motivos-visita.tsx`:

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
  eliminarMotivoVisita,
  listarMotivosVisita,
  PERMISO_MOTIVOS_VISITA,
  type MotivoVisita,
} from "@/lib/motivos-visita";
import { FormularioMotivoVisita } from "./formulario-motivo-visita";

const siNo = (valor: boolean) => (valor ? "Sí" : "No");

/**
 * Catálogo › Motivos de visita (T-39, D5): por qué un cliente no compró. Leer pide
 * sesión; dar de alta, editar y dar de baja (lógica, con confirmación) pide
 * `motivo-visita.gestionar`. Mismo patrón que la pestaña de cuentas de Tesorería.
 */
export function PantallaMotivosVisita() {
  const { puede } = useAuth();
  const puedeGestionar = puede(PERMISO_MOTIVOS_VISITA);
  const catalogo = useCatalogo<MotivoVisita>(() => listarMotivosVisita(), {
    mensajeError: "No se pudieron cargar los motivos de visita.",
  });
  const [eliminando, setEliminando] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const ocupado = catalogo.edicion !== null || eliminando !== null;

  async function eliminar(m: MotivoVisita) {
    if (
      !window.confirm(
        `¿Seguro que quieres eliminar el motivo "${m.nombre}"? Las visitas ya registradas lo conservan, pero las tablets dejarán de ofrecerlo.`,
      )
    )
      return;
    setEliminando(m.id);
    setErrorAccion(null);
    try {
      await eliminarMotivoVisita(m.id);
      void catalogo.recargar();
    } catch (err) {
      setErrorAccion(mensajeDe(err, "No se pudo eliminar el motivo."));
    } finally {
      setEliminando(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Motivos de visita</CardTitle>
        {puedeGestionar && (
          <Button size="sm" disabled={ocupado} onClick={catalogo.abrirAlta}>
            Nuevo motivo
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {catalogo.edicion !== null && (
          <div key={catalogo.edicion === "nueva" ? "nueva" : catalogo.edicion.id}>
            <FormularioMotivoVisita
              motivo={catalogo.edicion === "nueva" ? null : catalogo.edicion}
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
            vacio="Todavía no hay motivos de visita. Da de alta el primero."
            columnas={[
              { encabezado: "Motivo", celda: (m) => m.nombre },
              { encabezado: "Exige foto", celda: (m) => siNo(m.exigeFoto), className: "whitespace-nowrap" },
              { encabezado: "Exige nombre", celda: (m) => siNo(m.exigeAtendio), className: "whitespace-nowrap" },
            ]}
            acciones={
              puedeGestionar
                ? (m) => (
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" disabled={ocupado} onClick={() => catalogo.abrirEdicion(m)}>
                        Editar
                      </Button>
                      <Button variant="outline" size="sm" disabled={ocupado} onClick={() => void eliminar(m)}>
                        {eliminando === m.id ? "Eliminando…" : "Eliminar"}
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

`apps/portal/src/app/(portal)/catalogo/motivos-de-visita/page.tsx`:

```tsx
import { PantallaMotivosVisita } from "@/components/motivos-visita/pantalla-motivos-visita";

// T-39 (D5). Catálogo global: no lee el filtro de sucursal.
export default function Page() {
  return <PantallaMotivosVisita />;
}
```

`nav-config.ts`, en la sección `"Catálogo"`, después de `{ label: "Vehículos", href: "/catalogo/vehiculos" },`:

```ts
      { label: "Motivos de visita", href: "/catalogo/motivos-de-visita" },
```

- [ ] **Paso 4: correr y ver pasar**

`npm test --workspace=apps/portal -- motivos-visita` → 6/6. Luego `npm test --workspace=apps/portal`,
`npx tsc --noEmit -p apps/portal` y `npm run lint --workspace=apps/portal` en verde.

- [ ] **Paso 5: commit**

```bash
git add apps/portal
git commit -m "T-39: portal, Catálogo › Motivos de visita

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 7: Tablet: migración 013, tipos y el catálogo de motivos local (D4, D6, D9)

**Files:**
- Create: `apps/tablet/src/datos/migraciones/013-visitas.ts`
- Create: `apps/tablet/src/datos/migraciones/013-visitas.spec.ts`
- Modify: `apps/tablet/src/datos/migraciones/index.ts`
- Modify: `apps/tablet/src/datos/migraciones/012-promociones.spec.ts` (deja de afirmar que es la última)
- Modify: `apps/tablet/src/datos/tipos.ts`
- Modify: `apps/tablet/src/datos/repositorios/catalogos.ts`
- Modify: `apps/tablet/src/datos/repositorios/catalogos.spec.ts`
- Modify: `apps/tablet/src/datos/pruebas-apoyo.ts`
- Modify: `apps/tablet/src/sincronizacion/motor.ts` (`aSnapshot`)
- Modify: `apps/tablet/src/sincronizacion/motor.spec.ts`

**Interfaces:**
- Consumes: `MotivoVisitaPull`, `catalogos.motivos_visita?`, `ClientePull.foto_subida_en?` (Tarea 4, copia de la
  tablet).
- Produces:
  - Tablas locales `motivo_visita (id, nombre, exige_foto, exige_atendio, activo, sincronizado_en)` y `visita`
    (columnas en el Paso 3); columnas `cliente.foto_subida_en` y `cliente.foto_cache_subida_en`.
  - `tipos.ts`: `interface MotivoVisita { id; nombre; exige_foto: Booleano; exige_atendio: Booleano; activo:
    Booleano; sincronizado_en }`; `interface Visita` (Paso 3); `Cliente` gana `foto_subida_en: MomentoISO | null`
    y `foto_cache_subida_en: MomentoISO | null`.
  - `SnapshotCatalogos.motivosVisita?: Omit<MotivoVisita, 'sincronizado_en'>[]`.
  - `catalogos.listarMotivosVisita(): MotivoVisita[]` (activos, por nombre), `catalogos.obtenerMotivoVisita(id):
    MotivoVisita | null` (activo o no), `catalogos.marcarFotoDescargada(clienteId, subidaEn): void`.
  - `snapshotDePrueba()` trae `motivosVisita`: `mot-tenia` (Tenía producto, 0/0), `mot-cerrado` (Cerrado, 1/0),
    `mot-encargado` (No estaba el encargado, 1/1) y `mot-baja` (Vacaciones, activo 0).

- [ ] **Paso 1: la prueba de la migración (falla)**

`apps/tablet/src/datos/migraciones/013-visitas.spec.ts`:

```ts
import { abrirBaseDatosNode } from '../driver-node';
import type { BaseDatos } from '../base-datos';
import { migraciones, versionEsquema } from './index';
import { ejecutarMigraciones } from './motor';

/**
 * La 013 trae la visita sin venta (T-39): el catalogo de motivos que baja en el
 * pull, la visita local con su foto y la marca de la foto del cliente.
 */

const TS = "'2026-10-17T00:00:00.000Z'";

function baseAlDia(): BaseDatos {
  const bd = abrirBaseDatosNode();
  ejecutarMigraciones(bd, migraciones);
  bd.execSync(`
    insert into sucursal (id, codigo, nombre, sincronizado_en) values ('suc-tj', 'TJ', 'Tijuana', ${TS});
    insert into vendedor (id, login, nombre, sucursal_id, sincronizado_en)
      values ('ven-1', 'aperez', 'Abraham Perez', 'suc-tj', ${TS});
    insert into cliente (id, nombre, domicilio, telefono, tipo, sucursal_id, activo, sincronizado_en)
      values ('cli-1', 'Abarrotes La Esquina', 'Calle 5', '6641234567', 'cliente', 'suc-tj', 1, ${TS});
    insert into motivo_visita (id, nombre, exige_foto, exige_atendio, activo, sincronizado_en)
      values ('mot-1', 'Cerrado', 1, 0, 1, ${TS});
  `);
  return bd;
}

function insertarVisita(bd: BaseDatos, cambios: Record<string, string | number | null>) {
  const fila: Record<string, string | number | null> = {
    id: 'vis-1',
    fecha: '2026-10-17',
    cliente_id: 'cli-1',
    vendedor_id: 'ven-1',
    sucursal_id: 'suc-tj',
    motivo_visita_id: 'mot-1',
    motivo_nombre: 'Cerrado',
    visitada_en: '2026-10-17T18:40:00.000Z',
    lat: 32.5,
    lng: -117,
    direccion_texto: null,
    ...cambios,
  };
  const columnas = Object.keys(fila);
  bd.runSync(
    `insert into visita (${columnas.join(', ')}) values (${columnas.map((c) => `$${c}`).join(', ')})`,
    Object.fromEntries(columnas.map((c) => [`$${c}`, fila[c] ?? null])),
  );
}

describe('migracion 013: visitas (T-39)', () => {
  it('la 013 es la ultima y deja versionEsquema en 13', () => {
    expect(migraciones[12]?.nombre).toBe('visitas');
    expect(migraciones[12]?.version).toBe(13);
    expect(migraciones).toHaveLength(13);
    expect(versionEsquema(baseAlDia())).toBe(13);
  });

  it('una visita con GPS entra pendiente, sin foto y no descartada', () => {
    const bd = baseAlDia();
    insertarVisita(bd, {});
    expect(
      bd.getFirstSync('select sync_estado, foto_local, foto_descartada from visita where id = $id', { $id: 'vis-1' }),
    ).toEqual({ sync_estado: 'pendiente', foto_local: null, foto_descartada: 0 });
  });

  it('sin GPS exige la direccion escrita', () => {
    const bd = baseAlDia();
    expect(() => insertarVisita(bd, { lat: null, lng: null, direccion_texto: '   ' })).toThrow(/CHECK/);
    expect(() => insertarVisita(bd, { lat: null, lng: null, direccion_texto: 'Frente al parque' })).not.toThrow();
  });

  it('lat y lng van juntas', () => {
    const bd = baseAlDia();
    expect(() => insertarVisita(bd, { lng: null, direccion_texto: 'x' })).toThrow(/CHECK/);
  });

  it('el cliente gana foto_subida_en y foto_cache_subida_en, nulas', () => {
    const bd = baseAlDia();
    expect(
      bd.getFirstSync('select foto_subida_en, foto_cache_subida_en from cliente where id = $id', { $id: 'cli-1' }),
    ).toEqual({ foto_subida_en: null, foto_cache_subida_en: null });
  });
});
```

En `012-promociones.spec.ts`, el primer `it` pasa a:

```ts
  it('la 012 es promociones y deja de ser la ultima con la 013 (T-39)', () => {
    expect(migraciones[11]?.nombre).toBe('promociones');
    expect(migraciones[11]?.version).toBe(12);
  });
```

`npm test --workspace=apps/tablet -- 013-visitas` → falla (no hay 013).

- [ ] **Paso 2: la migración 013**

`apps/tablet/src/datos/migraciones/013-visitas.ts`:

```ts
import type { Migracion } from './motor';

/**
 * La visita sin venta en la tablet (T-39).
 *
 * - `motivo_visita`: el catalogo que baja en el pull (`motivos_visita`, upsert
 *   generico, baja como bandera). `exige_foto`/`exige_atendio` los aplica
 *   `validarVisita` al guardar; el servidor no los revisa.
 * - `visita`: lo que el vendedor captura. `id` = clave de idempotencia y, en el
 *   servidor, el id de la fila (D2). `motivo_nombre` es una copia del nombre al
 *   guardar, para pintar sin join aunque la oficina lo renombre despues. Sin
 *   GPS exige `direccion_texto` (el mismo CHECK que Postgres).
 * - La foto de la visita usa el **mismo esquema derivado** que la del prospecto
 *   (007): `foto_local` + `foto_subida_en` + `foto_error` + `foto_descartada`,
 *   sin una columna de estado que pueda contradecirlos. Ninguna toca
 *   `sync_estado`: una foto que falla no se lleva la visita.
 * - `cliente.foto_subida_en` baja en el pull (D9); `foto_cache_subida_en` es de
 *   la tablet: el `foto_subida_en` de la copia que ya bajo a su cache. El pull
 *   no la escribe (no esta en las columnas del upsert), asi que la conserva.
 */
export const visitas: Migracion = {
  version: 13,
  nombre: 'visitas',
  sql: `
    create table motivo_visita (
      id              text primary key,
      nombre          text not null,
      exige_foto      integer not null default 0 check (exige_foto in (0, 1)),
      exige_atendio   integer not null default 0 check (exige_atendio in (0, 1)),
      activo          integer not null default 1,
      sincronizado_en text not null
    );

    create table visita (
      id               text primary key,           -- = clave de idempotencia
      fecha            text not null,              -- dia de trabajo (fecha_operacion)
      cliente_id       text not null references cliente(id),
      vendedor_id      text not null references vendedor(id),
      sucursal_id      text not null references sucursal(id),
      motivo_visita_id text not null references motivo_visita(id),
      motivo_nombre    text not null,
      visitada_en      text not null,              -- ISO; viaja como ocurrido_en
      observaciones    text,
      atendio          text,
      lat              real,
      lng              real,
      precision_m      real,
      direccion_texto  text,
      foto_local       text,
      foto_subida_en   text,
      foto_error       text,
      foto_descartada  integer not null default 0 check (foto_descartada in (0, 1)),
      sync_estado      text not null default 'pendiente'
                         check (sync_estado in ('pendiente','enviando','sincronizado','error')),
      sync_error       text,
      sincronizado_en  text,
      check ((lat is null) = (lng is null)),
      check (lat is not null or trim(coalesce(direccion_texto, '')) <> '')
    );

    -- Lo que falta por subir (mismo patron que idx_cobranza_sync).
    create index idx_visita_sync on visita (sync_estado) where sync_estado <> 'sincronizado';
    -- "Visitas de hoy" de la ficha y la consulta de la ruta del dia.
    create index idx_visita_cliente_fecha on visita (cliente_id, fecha);
    -- "Atendidos fuera de ruta".
    create index idx_visita_vendedor_fecha on visita (vendedor_id, fecha);
    -- La cola de fotos, como idx_prospecto_foto_pendiente (007).
    create index idx_visita_foto_pendiente on visita (sync_estado)
      where foto_local is not null and foto_subida_en is null and foto_descartada = 0;

    alter table cliente add column foto_subida_en text;
    alter table cliente add column foto_cache_subida_en text;
  `,
};
```

`migraciones/index.ts`: `import { visitas } from './013-visitas';` y `visitas,` al final del arreglo.

- [ ] **Paso 3: tipos**

`apps/tablet/src/datos/tipos.ts`:

1. En `Cliente`, después de `saldo_favor_centavos`:
   ```ts
  /**
   * T-39 (D9): cuando el SERVIDOR recibio la foto del cliente, tal como baja en
   * el pull. `null` = no tiene foto (o el servidor es anterior a T-39).
   */
  foto_subida_en: MomentoISO | null;
  /**
   * El `foto_subida_en` de la copia que esta tablet ya bajo a su cache (no viene
   * del pull). Si es menor que `foto_subida_en`, la ficha la vuelve a bajar.
   */
  foto_cache_subida_en: MomentoISO | null;
   ```
2. Después de `TipoNegocio`:
   ```ts
/** Motivo de una visita sin venta. Catalogo global que baja del pull (T-39). */
export interface MotivoVisita {
  id: string;
  nombre: string;
  /** `1` = la tablet no deja guardar la visita sin foto. */
  exige_foto: Booleano;
  /** `1` = la tablet no deja guardar la visita sin el nombre de quien atendio. */
  exige_atendio: Booleano;
  /** `0` = dado de baja en el portal: ya no se ofrece. */
  activo: Booleano;
  sincronizado_en: MomentoISO;
}
   ```
3. Al final del archivo:
   ```ts
/**
 * Una visita sin venta grabada en la tablet (T-39). Ver `013-visitas.ts`.
 *
 * `id` es la clave de idempotencia y el id de la fila en el servidor. No se
 * edita ni se borra, igual que la venta: solo cambia su sincronizacion y su foto.
 */
export interface Visita {
  id: string;
  /** Dia de trabajo (`reloj.hoy()`), el de `fecha_operacion`. */
  fecha: FechaISO;
  cliente_id: string;
  vendedor_id: string;
  sucursal_id: string;
  motivo_visita_id: string;
  /** Copia del nombre del motivo al guardar: se pinta sin join. */
  motivo_nombre: string;
  /** Cuando la guardo el vendedor. Viaja como `ocurrido_en` y `datos.visitada_en`. */
  visitada_en: MomentoISO;
  observaciones: string | null;
  atendio: string | null;
  /** Las dos o ninguna. Sin ellas, `direccion_texto` no es nula. */
  lat: number | null;
  lng: number | null;
  precision_m: number | null;
  direccion_texto: string | null;
  /** Ruta local de la foto ya comprimida, o `null`. */
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

- [ ] **Paso 4: el catálogo local (prueba primero)**

`catalogos.spec.ts`, al final:

```ts
describe('motivos de visita (T-39)', () => {
  it('lista solo los activos, por nombre, con sus casillas', () => {
    const { catalogos } = conCatalogos();
    expect(catalogos.listarMotivosVisita().map((m) => [m.nombre, m.exige_foto, m.exige_atendio])).toEqual([
      ['Cerrado', 1, 0],
      ['No estaba el encargado', 1, 1],
      ['Tenía producto', 0, 0],
    ]);
  });

  it('obtenerMotivoVisita encuentra tambien uno dado de baja (una visita guardada lo nombra)', () => {
    const { catalogos } = conCatalogos();
    expect(catalogos.obtenerMotivoVisita('mot-baja')).toMatchObject({ nombre: 'Vacaciones', activo: 0 });
    expect(catalogos.obtenerMotivoVisita('no-existe')).toBeNull();
  });

  it('la baja llega como bandera: el pull siguiente lo deja de ofrecer', () => {
    const { catalogos } = conCatalogos();
    catalogos.guardarSnapshot({
      motivosVisita: [{ id: 'mot-cerrado', nombre: 'Cerrado', exige_foto: 1, exige_atendio: 0, activo: 0 }],
    });
    expect(catalogos.listarMotivosVisita().map((m) => m.id)).not.toContain('mot-cerrado');
  });
});

describe('foto del cliente (T-39, D9)', () => {
  it('el pull escribe foto_subida_en y no pisa la marca de la cache', () => {
    const { catalogos } = conCatalogos();
    const base = snapshotDePrueba().clientes![0]!;
    catalogos.guardarSnapshot({ clientes: [{ ...base, foto_subida_en: '2026-10-17T19:00:00.000Z' }] });
    catalogos.marcarFotoDescargada('cli-1', '2026-10-17T19:00:00.000Z');

    catalogos.guardarSnapshot({ clientes: [{ ...base, foto_subida_en: '2026-10-18T09:00:00.000Z' }] });
    expect(catalogos.obtenerCliente('cli-1')).toMatchObject({
      foto_subida_en: '2026-10-18T09:00:00.000Z',
      foto_cache_subida_en: '2026-10-17T19:00:00.000Z',
    });
  });

  it('un servidor anterior a T-39 no manda foto_subida_en: queda null', () => {
    const { catalogos } = conCatalogos();
    expect(catalogos.obtenerCliente('cli-1')?.foto_subida_en).toBeNull();
  });
});
```

En `pruebas-apoyo.ts`, dentro de `snapshotDePrueba()` después de `tiposNegocio`:

```ts
    motivosVisita: [
      { id: 'mot-tenia', nombre: 'Tenía producto', exige_foto: 0, exige_atendio: 0, activo: 1 },
      { id: 'mot-cerrado', nombre: 'Cerrado', exige_foto: 1, exige_atendio: 0, activo: 1 },
      { id: 'mot-encargado', nombre: 'No estaba el encargado', exige_foto: 1, exige_atendio: 1, activo: 1 },
      // Dado de baja en el portal: baja con la bandera y ya no se ofrece.
      { id: 'mot-baja', nombre: 'Vacaciones', exige_foto: 0, exige_atendio: 0, activo: 0 },
    ],
```

(`respuestaPullDePrueba` no cambia: la colección es opcional en la copia de la tablet.)

`npm test --workspace=apps/tablet -- catalogos` → falla (no existen los métodos ni la columna en el upsert).

- [ ] **Paso 5: implementar en `catalogos.ts`**

1. Importa `MotivoVisita` de `../tipos`.
2. `SnapshotCatalogos`:
   ```ts
  /**
   * `foto_subida_en` es opcional aqui (un servidor anterior a T-39 no lo manda;
   * el upsert escribe `null`) y `foto_cache_subida_en` no viene nunca del pull.
   */
  clientes?: (Omit<Cliente, 'sincronizado_en' | 'foto_subida_en' | 'foto_cache_subida_en'> &
    Partial<Pick<Cliente, 'foto_subida_en'>>)[];
   ```
   (reemplaza la línea actual de `clientes`) y, después de `tiposNegocio`:
   ```ts
  /** T-39. Coleccion nueva del pull: el catalogo de la pantalla de visita. Baja como bandera. */
  motivosVisita?: Omit<MotivoVisita, 'sincronizado_en'>[];
   ```
3. `COLUMNAS`: agrega `motivo_visita: ['id', 'nombre', 'exige_foto', 'exige_atendio', 'activo'],` y, en `cliente`,
   `'foto_subida_en',` después de `'saldo_favor_centavos'` con el comentario
   `// T-39 (D9): cuando el servidor recibio su foto. \`foto_cache_subida_en\` NO va: es de la tablet.`
4. En `guardarSnapshot`, después del `upsert` de `tipo_negocio`:
   ```ts
          // T-39: sin llaves foraneas hacia nadie; catalogo de empresa como tipo_negocio.
          upsert(bd, 'motivo_visita', COLUMNAS.motivo_visita, snapshot.motivosVisita, ahora) +
   ```
5. Métodos nuevos, después de `obtenerTipoNegocio`:
   ```ts
    /** Motivos de visita **activos**, por nombre: las opciones de la pantalla (T-39). */
    listarMotivosVisita(): MotivoVisita[] {
      return bd.getAllSync<MotivoVisita>(
        'select * from motivo_visita where activo = 1 order by nombre',
      );
    },

    /**
     * Un motivo por id, activo o no. Uno dado de baja despues de elegirlo sigue
     * sirviendo para guardar la visita (D3: el servidor lo acepta).
     */
    obtenerMotivoVisita(id: string): MotivoVisita | null {
      return bd.getFirstSync<MotivoVisita>('select * from motivo_visita where id = $id', { $id: id });
    },

    /**
     * La ficha ya bajo la foto del servidor a su cache (T-39, D9). Guarda el
     * `foto_subida_en` de esa copia: si el servidor recibe otra mas nueva, el
     * pull lo sube y la ficha vuelve a bajarla. No publica cambio: solo lo lee
     * la ficha que la bajo.
     */
    marcarFotoDescargada(clienteId: string, subidaEn: MomentoISO): void {
      bd.runSync('update cliente set foto_cache_subida_en = $subida where id = $id', {
        $subida: subidaEn,
        $id: clienteId,
      });
    },
   ```
   (importa `MomentoISO` de `../tipos` si no estaba.) Actualiza el comentario de "Es la **unica** escritura del
   repositorio" a "Es la única escritura del catálogo que publica la señal (`marcarFotoDescargada`, T-39, no cambia
   nada que otra pantalla lea)".

- [ ] **Paso 6: `aSnapshot` (prueba primero)**

`motor.spec.ts`, después de `describe('aSnapshot (T-37)', …)`:

```ts
describe('aSnapshot (T-39)', () => {
  it('los motivos bajan con sus casillas booleanas como 0/1 de SQLite', () => {
    const respuesta = respuestaPullDePrueba();
    respuesta.catalogos.motivos_visita = [
      { id: 'm1', nombre: 'Cerrado', exige_foto: true, exige_atendio: false, activo: 1 },
    ];
    expect(aSnapshot(respuesta).motivosVisita).toEqual([
      { id: 'm1', nombre: 'Cerrado', exige_foto: 1, exige_atendio: 0, activo: 1 },
    ]);
    expect(aSnapshot(respuestaPullDePrueba()).motivosVisita).toBeUndefined();
  });

  it('un cliente sin foto_subida_en (servidor anterior) llega como null', () => {
    const cliente = aSnapshot(respuestaPullDePrueba()).clientes?.[0];
    expect(cliente?.foto_subida_en).toBeNull();
  });
});
```

En `motor.ts`, `aSnapshot`: en el `map` de clientes agrega
`// T-39: un servidor anterior no lo manda.` + `foto_subida_en: cliente.foto_subida_en ?? null,`; después de
`tiposNegocio` agrega:

```ts
    // T-39: un servidor anterior no manda la coleccion (`undefined` no escribe
    // nada: la pantalla de visita dice que no hay catalogo). Las casillas llegan
    // booleanas y SQLite guarda 0/1, como `se_repite`.
    motivosVisita: c.motivos_visita?.map((m) => ({
      ...m,
      exige_foto: m.exige_foto ? 1 : 0,
      exige_atendio: m.exige_atendio ? 1 : 0,
    })),
```

- [ ] **Paso 7: correr todo, typecheck, lint y commit**

```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
git add apps/tablet/src
git commit -m "T-39: tablet, migración 013 (motivo_visita, visita, foto del cliente) y catálogo de motivos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Si alguna prueba existente cuenta filas de `snapshotDePrueba()` (p. ej. un total de `guardarSnapshot`), súmale las
cuatro de `motivosVisita` y anótalo en el commit.

---

### Tarea 8: Tablet: repositorio de visitas, fuente del push y orden (D3, D6)

**Files:**
- Create: `apps/tablet/src/datos/repositorios/visitas.ts`
- Create: `apps/tablet/src/datos/repositorios/visitas.spec.ts`
- Modify: `apps/tablet/src/datos/index.ts`
- Modify: `apps/tablet/src/datos/inicializar.ts`
- Create: `apps/tablet/src/sincronizacion/fuente-visitas.ts`
- Create: `apps/tablet/src/sincronizacion/fuente-visitas.spec.ts`
- Modify: `apps/tablet/src/sincronizacion/fuentes.ts`, `fuentes.spec.ts`
- Modify: `apps/tablet/src/sincronizacion/pendientes.ts`, `pendientes.spec.ts`
- Modify: `apps/tablet/src/sincronizacion/motor.ts` (solo el doc-comment de `FuenteOperaciones`)

**Interfaces:**
- Consumes: tablas y tipos de la Tarea 7 (`Visita`, `catalogos.obtenerMotivoVisita`); `DatosVisita` y
  `TipoOperacion` con `'visita'` (Tarea 3); `exigirJornadaAbierta`, `enTransaccion`.
- Produces:
  - `class ErrorVisita extends Error`; `LARGO_MAX_OBSERVACIONES_VISITA = 500`, `LARGO_MAX_ATENDIO = 120`,
    `LARGO_MAX_DIRECCION = 300`.
  - `interface DatosRegistroVisita { vendedorId; clienteId; motivoVisitaId; observaciones: string | null;
    atendio: string | null; lat: number | null; lng: number | null; precisionM: number | null;
    direccionTexto: string | null; fotoUri: string | null }`.
  - `crearRepositorioVisitas(deps, { catalogos })` → `{ registrar(datos): Visita; porId(id): Visita | null;
    delDia(clienteId, fecha?): Visita[]; delDiaDelVendedor(vendedorId, fecha?): Visita[];
    pendientesDeSincronizar(): Visita[]; marcarSincronizada(id); marcarError(id, motivo);
    pendientesDeSubirFoto(): Visita[]; marcarFotoSubida(id, subidaEn); anotarErrorFoto(id, motivo);
    descartarFoto(id, motivo) }`; `type RepositorioVisitas`.
  - `CapaDatos.visitas: RepositorioVisitas`; `FuentesConPendientes.visitas`.
  - `fuenteVisitas(visitas): FuenteOperaciones` (tipo `'visita'`).
  - `fuentesDelPush` en orden `jornada, prospecto, venta, cobranza, visita, ruta-alta`.

- [ ] **Paso 1: prueba del repositorio (falla)**

`apps/tablet/src/datos/repositorios/visitas.spec.ts`:

```ts
import { depsDePrueba, MOMENTO, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from './catalogos';
import { crearRepositorioJornadas, ErrorJornada } from './jornadas';
import { crearRepositorioVisitas, ErrorVisita, type DatosRegistroVisita } from './visitas';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  return {
    deps,
    catalogos,
    jornadas: crearRepositorioJornadas(deps),
    visitas: crearRepositorioVisitas(deps, { catalogos }),
  };
}

const captura = (cambios: Partial<DatosRegistroVisita> = {}): DatosRegistroVisita => ({
  vendedorId: 'ven-1',
  clienteId: 'cli-1',
  motivoVisitaId: 'mot-cerrado',
  observaciones: null,
  atendio: null,
  lat: 32.5149,
  lng: -117.0382,
  precisionM: 15,
  direccionTexto: null,
  fotoUri: 'file:///cache/visita.jpg',
  ...cambios,
});

describe('repositorio de visitas (T-39, D6)', () => {
  it('registra la visita pendiente de subir, con el dia, la hora y el nombre del motivo', () => {
    const { visitas } = montar();
    const v = visitas.registrar(captura({ observaciones: '  Cortina abajo ' }));
    expect(v).toMatchObject({
      fecha: '2026-08-07',
      cliente_id: 'cli-1',
      vendedor_id: 'ven-1',
      sucursal_id: 'suc-tj',
      motivo_visita_id: 'mot-cerrado',
      motivo_nombre: 'Cerrado',
      visitada_en: MOMENTO,
      observaciones: 'Cortina abajo',
      lat: 32.5149,
      precision_m: 15,
      foto_local: 'file:///cache/visita.jpg',
      foto_subida_en: null,
      foto_descartada: 0,
      sync_estado: 'pendiente',
    });
  });

  it('sin GPS guarda la direccion; sin GPS ni direccion no guarda nada', () => {
    const { visitas } = montar();
    expect(
      visitas.registrar(captura({ lat: null, lng: null, precisionM: null, direccionTexto: ' Frente al parque ' }))
        .direccion_texto,
    ).toBe('Frente al parque');
    expect(() => visitas.registrar(captura({ lat: null, lng: null, direccionTexto: '   ' }))).toThrow(ErrorVisita);
  });

  it('media coordenada no se guarda', () => {
    const { visitas } = montar();
    expect(() => visitas.registrar(captura({ lng: null }))).toThrow(ErrorVisita);
  });

  it('un motivo dado de baja despues de elegirlo SI se guarda (Review Focus 1)', () => {
    const { visitas } = montar();
    expect(visitas.registrar(captura({ motivoVisitaId: 'mot-baja' })).motivo_nombre).toBe('Vacaciones');
  });

  it('un motivo que la tablet no conoce no se guarda', () => {
    const { visitas } = montar();
    expect(() => visitas.registrar(captura({ motivoVisitaId: 'no-existe' }))).toThrow(ErrorVisita);
  });

  it('se puede visitar a un prospecto', () => {
    const { visitas } = montar();
    expect(visitas.registrar(captura({ clienteId: 'cli-2' })).cliente_id).toBe('cli-2');
  });

  it('con el dia cerrado no se registra (T-38)', () => {
    const { visitas, jornadas } = montar();
    const j = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    jornadas.cerrar(j.id, 20);
    expect(() => visitas.registrar(captura())).toThrow(ErrorJornada);
  });

  it('textos de mas no se guardan', () => {
    const { visitas } = montar();
    expect(() => visitas.registrar(captura({ observaciones: 'x'.repeat(501) }))).toThrow(ErrorVisita);
    expect(() => visitas.registrar(captura({ atendio: 'x'.repeat(121) }))).toThrow(ErrorVisita);
    expect(() => visitas.registrar(captura({ direccionTexto: 'x'.repeat(301) }))).toThrow(ErrorVisita);
  });

  it('delDia y delDiaDelVendedor traen las visitas de hoy en orden de captura', () => {
    const { visitas } = montar();
    const a = visitas.registrar(captura());
    const b = visitas.registrar(captura({ motivoVisitaId: 'mot-tenia' }));
    visitas.registrar(captura({ clienteId: 'cli-2' }));
    expect(visitas.delDia('cli-1').map((v) => v.id)).toEqual([a.id, b.id]);
    expect(visitas.delDiaDelVendedor('ven-1')).toHaveLength(3);
    expect(visitas.delDia('cli-1', '2026-08-06')).toEqual([]);
  });

  it('la cola del push incluye las rechazadas y saca las sincronizadas', () => {
    const { visitas } = montar();
    const a = visitas.registrar(captura());
    const b = visitas.registrar(captura());
    visitas.marcarSincronizada(a.id);
    visitas.marcarError(b.id, 'motivo-visita-inexistente: El motivo no existe.');
    expect(visitas.pendientesDeSincronizar().map((v) => v.id)).toEqual([b.id]);
    expect(visitas.porId(b.id)).toMatchObject({ sync_estado: 'error', sync_error: 'motivo-visita-inexistente: El motivo no existe.' });
  });

  it('la foto solo se ofrece cuando la visita ya esta sincronizada, y su fallo no toca sync_estado', () => {
    const { visitas } = montar();
    const v = visitas.registrar(captura());
    expect(visitas.pendientesDeSubirFoto()).toEqual([]);
    visitas.marcarSincronizada(v.id);
    expect(visitas.pendientesDeSubirFoto().map((x) => x.id)).toEqual([v.id]);

    visitas.anotarErrorFoto(v.id, 'sin red');
    expect(visitas.porId(v.id)).toMatchObject({ sync_estado: 'sincronizado', foto_error: 'sin red' });
    visitas.marcarFotoSubida(v.id, '2026-08-07T16:00:00.000Z');
    expect(visitas.porId(v.id)).toMatchObject({ foto_subida_en: '2026-08-07T16:00:00.000Z', foto_error: null });
    expect(visitas.pendientesDeSubirFoto()).toEqual([]);
  });

  it('una foto descartada deja de ofrecerse y conserva la ruta local', () => {
    const { visitas } = montar();
    const v = visitas.registrar(captura());
    visitas.marcarSincronizada(v.id);
    visitas.descartarFoto(v.id, 'La foto pesa demasiado');
    expect(visitas.pendientesDeSubirFoto()).toEqual([]);
    expect(visitas.porId(v.id)).toMatchObject({ foto_descartada: 1, foto_local: 'file:///cache/visita.jpg' });
  });
});
```

`npm test --workspace=apps/tablet -- repositorios/visitas` → falla (no existe).

- [ ] **Paso 2: el repositorio**

`apps/tablet/src/datos/repositorios/visitas.ts`:

```ts
import type { FechaISO, MomentoISO, Visita } from '../tipos';
import type { RepositorioCatalogos } from './catalogos';
import { enTransaccion, type DepsRepositorio } from './deps';
import { exigirJornadaAbierta } from './jornadas';

/** Error de regla de negocio de la visita (no un fallo tecnico de SQLite). */
export class ErrorVisita extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorVisita';
  }
}

/** Los mismos topes que el servidor (`rutas/datos-visita.ts`). */
export const LARGO_MAX_OBSERVACIONES_VISITA = 500;
export const LARGO_MAX_ATENDIO = 120;
export const LARGO_MAX_DIRECCION = 300;

/** Lo que guarda la pantalla, ya validado por `validarVisita` (`src/estado/visita.ts`). */
export interface DatosRegistroVisita {
  vendedorId: string;
  clienteId: string;
  motivoVisitaId: string;
  observaciones: string | null;
  atendio: string | null;
  /** Las dos o ninguna. Sin ellas, `direccionTexto` es obligatoria. */
  lat: number | null;
  lng: number | null;
  precisionM: number | null;
  direccionTexto: string | null;
  /** Ruta local de la foto ya comprimida, o `null`. */
  fotoUri: string | null;
}

export type RepositorioVisitas = ReturnType<typeof crearRepositorioVisitas>;

/**
 * La visita sin venta en ruta (T-39): grabar, consultar el dia y las dos colas
 * (push y fotos).
 *
 * Las casillas del motivo (`exige_foto`, `exige_atendio`) las aplica
 * `validarVisita` en la pantalla: este repositorio no las vuelve a revisar
 * porque la capa de datos no importa de `src/estado/`. Lo que si revisa son las
 * reglas que tambien tiene el servidor (ubicacion, topes, motivo conocido), para
 * que una captura imposible no llegue nunca al push.
 *
 * Recibe `catalogos` ya creado, como las ventas: es quien publica la version
 * que observan las pantallas.
 */
export function crearRepositorioVisitas(
  { bd, reloj, generarId }: DepsRepositorio,
  { catalogos }: { catalogos: RepositorioCatalogos },
) {
  const repo = {
    /**
     * Graba una visita en **una sola transaccion**, lista para subir.
     *
     * @throws {ErrorJornada} si el dia de hoy ya esta cerrado (T-38): primero el candado.
     * @throws {ErrorVisita} si la captura no se puede grabar.
     */
    registrar(datos: DatosRegistroVisita): Visita {
      exigirJornadaAbierta({ bd, reloj }, datos.vendedorId);

      const cliente = catalogos.obtenerCliente(datos.clienteId);
      if (!cliente || cliente.activo !== 1) {
        throw new ErrorVisita(
          'Este cliente ya no está en el catálogo de la tablet. Sincroniza antes de registrar la visita.',
        );
      }
      const vendedor = bd.getFirstSync<{ sucursal_id: string }>(
        'select sucursal_id from vendedor where id = $id',
        { $id: datos.vendedorId },
      );
      if (!vendedor) {
        throw new ErrorVisita('Este vendedor no está en la tablet. Sincroniza antes de registrar la visita.');
      }

      // Activo o no: uno dado de baja despues de elegirlo se guarda igual (D3,
      // el servidor tambien lo acepta). Solo uno desconocido es un error.
      const motivo = catalogos.obtenerMotivoVisita(datos.motivoVisitaId);
      if (!motivo) {
        throw new ErrorVisita('Ese motivo no está en el catálogo de la tablet. Sincroniza y vuelve a elegirlo.');
      }

      const observaciones = recortar(datos.observaciones);
      if (observaciones !== null && observaciones.length > LARGO_MAX_OBSERVACIONES_VISITA) {
        throw new ErrorVisita(
          `Las observaciones no pueden pasar de ${LARGO_MAX_OBSERVACIONES_VISITA} caracteres.`,
        );
      }
      const atendio = recortar(datos.atendio);
      if (atendio !== null && atendio.length > LARGO_MAX_ATENDIO) {
        throw new ErrorVisita(`El nombre de quien atendió no puede pasar de ${LARGO_MAX_ATENDIO} caracteres.`);
      }
      const direccionTexto = recortar(datos.direccionTexto);
      if (direccionTexto !== null && direccionTexto.length > LARGO_MAX_DIRECCION) {
        throw new ErrorVisita(`La dirección no puede pasar de ${LARGO_MAX_DIRECCION} caracteres.`);
      }
      if ((datos.lat === null) !== (datos.lng === null)) {
        throw new ErrorVisita('La ubicación va completa o no va: falta una de las dos coordenadas.');
      }
      if (datos.lat === null && direccionTexto === null) {
        throw new ErrorVisita('Sin ubicación GPS, escribe la dirección o una referencia del lugar.');
      }
      // La precision la da el aparato, no el vendedor: una rara se descarta en vez de bloquear.
      const precisionM =
        datos.precisionM !== null && Number.isFinite(datos.precisionM) && datos.precisionM >= 0
          ? datos.precisionM
          : null;

      const id = generarId();
      enTransaccion(bd, () => {
        bd.runSync(
          `insert into visita (
             id, fecha, cliente_id, vendedor_id, sucursal_id, motivo_visita_id, motivo_nombre,
             visitada_en, observaciones, atendio, lat, lng, precision_m, direccion_texto,
             foto_local, sync_estado
           ) values (
             $id, $fecha, $cliente_id, $vendedor_id, $sucursal_id, $motivo_visita_id, $motivo_nombre,
             $visitada_en, $observaciones, $atendio, $lat, $lng, $precision_m, $direccion_texto,
             $foto_local, 'pendiente'
           )`,
          {
            $id: id,
            // El dia de trabajo de la tablet (Tijuana): viaja como `fecha_operacion`.
            $fecha: reloj.hoy(),
            $cliente_id: datos.clienteId,
            $vendedor_id: datos.vendedorId,
            $sucursal_id: vendedor.sucursal_id,
            $motivo_visita_id: motivo.id,
            $motivo_nombre: motivo.nombre,
            // La hora se toma al guardar (D7).
            $visitada_en: reloj.ahora(),
            $observaciones: observaciones,
            $atendio: atendio,
            $lat: datos.lat,
            $lng: datos.lng,
            $precision_m: precisionM,
            $direccion_texto: direccionTexto,
            $foto_local: datos.fotoUri,
          },
        );
      });

      // Despues del commit: la ruta del dia y la ficha releen. Si un oyente
      // truena, la visita ya esta grabada (mismo criterio que la cobranza).
      try {
        catalogos.publicarCambio();
      } catch {
        // Solo se pierde el refresco de pantallas abiertas.
      }

      const grabada = repo.porId(id);
      if (!grabada) throw new ErrorVisita('No se pudo leer la visita recién grabada.');
      return grabada;
    },

    porId(id: string): Visita | null {
      return bd.getFirstSync<Visita>('select * from visita where id = $id', { $id: id });
    },

    /** Visitas de un cliente en un dia, en orden de captura ("Visitas de hoy" de la ficha). */
    delDia(clienteId: string, fecha: FechaISO = reloj.hoy()): Visita[] {
      return bd.getAllSync<Visita>(
        `select * from visita where cliente_id = $cliente_id and fecha = $fecha
          order by visitada_en, rowid`,
        { $cliente_id: clienteId, $fecha: fecha },
      );
    },

    /** Visitas del vendedor en un dia ("Atendidos fuera de ruta"). */
    delDiaDelVendedor(vendedorId: string, fecha: FechaISO = reloj.hoy()): Visita[] {
      return bd.getAllSync<Visita>(
        `select * from visita where vendedor_id = $vendedor_id and fecha = $fecha
          order by visitada_en, rowid`,
        { $vendedor_id: vendedorId, $fecha: fecha },
      );
    },

    /**
     * Lo que falta por subir, incluidas las rechazadas (patron D19 de T-16):
     * se reintentan en la siguiente sincronizacion; la clave no cambia.
     */
    pendientesDeSincronizar(): Visita[] {
      return bd.getAllSync<Visita>(
        `select * from visita where sync_estado in ('pendiente', 'error')
          order by fecha, visitada_en, rowid`,
      );
    },

    marcarSincronizada(id: string): void {
      bd.runSync(
        `update visita set sync_estado = 'sincronizado', sincronizado_en = $en, sync_error = null
          where id = $id`,
        { $en: reloj.ahora(), $id: id },
      );
    },

    marcarError(id: string, motivo: string): void {
      bd.runSync(`update visita set sync_estado = 'error', sync_error = $motivo where id = $id`, {
        $motivo: motivo,
        $id: id,
      });
    },

    // ----------------------------------------------------------------------
    // La foto (D9). Mismo reparto que la del prospecto (`prospectos.ts`): estos
    // `update` no mencionan `sync_estado` ni `sync_error`. Una foto que falla no
    // se lleva la visita.
    // ----------------------------------------------------------------------

    /** Fotos por subir: de visitas ya sincronizadas (antes no existe su fila arriba). */
    pendientesDeSubirFoto(): Visita[] {
      return bd.getAllSync<Visita>(
        `select * from visita
          where sync_estado = 'sincronizado'
            and foto_local is not null
            and foto_subida_en is null
            and foto_descartada = 0
          order by fecha, visitada_en, rowid`,
      );
    },

    marcarFotoSubida(id: string, subidaEn: MomentoISO): void {
      bd.runSync(`update visita set foto_subida_en = $en, foto_error = null where id = $id`, {
        $en: subidaEn,
        $id: id,
      });
    },

    anotarErrorFoto(id: string, motivo: string): void {
      bd.runSync(`update visita set foto_error = $motivo where id = $id`, { $motivo: motivo, $id: id });
    },

    descartarFoto(id: string, motivo: string): void {
      bd.runSync(`update visita set foto_descartada = 1, foto_error = $motivo where id = $id`, {
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

`datos/index.ts`, después del bloque de cobranzas:

```ts
export {
  crearRepositorioVisitas,
  ErrorVisita,
  LARGO_MAX_ATENDIO,
  LARGO_MAX_DIRECCION,
  LARGO_MAX_OBSERVACIONES_VISITA,
} from './repositorios/visitas';
export type { DatosRegistroVisita, RepositorioVisitas } from './repositorios/visitas';
```

`inicializar.ts`: importa `crearRepositorioVisitas, type RepositorioVisitas`; en `CapaDatos`,
`/** Visitas sin venta capturadas en ruta (T-39). */ visitas: RepositorioVisitas;`; en el `return`,
`visitas: crearRepositorioVisitas(deps, { catalogos }),` (el mismo `catalogos`).

`npm test --workspace=apps/tablet -- repositorios/visitas` → verde.

- [ ] **Paso 3: la fuente del push (prueba primero)**

`apps/tablet/src/sincronizacion/fuente-visitas.spec.ts`:

```ts
import { depsDePrueba, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioVisitas } from '@/datos/repositorios/visitas';

import { fuenteVisitas } from './fuente-visitas';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const visitas = crearRepositorioVisitas(deps, { catalogos });
  return { visitas, fuente: fuenteVisitas(visitas) };
}

const captura = {
  vendedorId: 'ven-1',
  clienteId: 'cli-1',
  motivoVisitaId: 'mot-cerrado',
  observaciones: 'Cortina abajo',
  atendio: null,
  lat: null,
  lng: null,
  precisionM: null,
  direccionTexto: 'Frente al parque',
  fotoUri: 'file:///cache/v.jpg',
};

describe('fuente de visitas (T-39)', () => {
  it('sin visitas no hay nada que subir', () => {
    const { fuente } = montar();
    expect(fuente.tipo).toBe('visita');
    expect(fuente.pendientes()).toEqual([]);
  });

  it('arma el sobre exacto del contrato: cliente en el sobre, sin folio, la foto NO viaja', () => {
    const { visitas, fuente } = montar();
    const v = visitas.registrar(captura);
    const [op] = fuente.pendientes();
    expect(op).toEqual({
      clave: v.id,
      tipo: 'visita',
      fecha_operacion: '2026-08-07',
      ocurrido_en: '2026-08-07T15:00:00.000Z',
      cliente_id: 'cli-1',
      datos: {
        motivo_visita_id: 'mot-cerrado',
        visitada_en: '2026-08-07T15:00:00.000Z',
        observaciones: 'Cortina abajo',
        atendio: null,
        lat: null,
        lng: null,
        precision_m: null,
        direccion_texto: 'Frente al parque',
      },
    });
    expect(op).not.toHaveProperty('folio');
  });

  it('aceptada sale de la cola; rechazada guarda el motivo y se reenvia', () => {
    const { visitas, fuente } = montar();
    const a = visitas.registrar(captura);
    const b = visitas.registrar(captura);
    fuente.marcarSincronizada(a.id);
    fuente.marcarError(b.id, 'visita-id-ocupado: El id de esta visita ya está ocupado.');
    expect(fuente.pendientes().map((o) => o.clave)).toEqual([b.id]);
    expect(visitas.porId(b.id)?.sync_error).toContain('visita-id-ocupado');
  });
});
```

`apps/tablet/src/sincronizacion/fuente-visitas.ts`:

```ts
import type { RepositorioVisitas } from '@/datos/repositorios/visitas';

import type { DatosVisita, OperacionSaliente } from './contrato';
import type { FuenteOperaciones } from './motor';

/**
 * Las visitas sin venta, como operaciones del push (T-39, D3).
 *
 * - **`clave`** es el `id` de la fila: no cambia, y en el servidor es el id de
 *   la visita (asi la foto se liga a ella).
 * - **`cliente_id`** va en el sobre: pasa por el alcance del lote. Sin folio.
 * - La foto **no** viaja aqui: sube despues por su canal (`fuente-fotos.ts`).
 *
 * Va DESPUES de prospectos (la visita a un prospecto recien capturado necesita
 * que su alta ya este arriba) y de ventas y cobranzas. Ver `fuentes.ts`.
 */
export function fuenteVisitas(visitas: RepositorioVisitas): FuenteOperaciones {
  return {
    tipo: 'visita',

    pendientes(): OperacionSaliente[] {
      return visitas.pendientesDeSincronizar().map((v) => {
        const datos: DatosVisita = {
          motivo_visita_id: v.motivo_visita_id,
          visitada_en: v.visitada_en,
          observaciones: v.observaciones,
          atendio: v.atendio,
          lat: v.lat,
          lng: v.lng,
          precision_m: v.precision_m,
          direccion_texto: v.direccion_texto,
        };
        return {
          clave: v.id,
          tipo: 'visita',
          fecha_operacion: v.fecha,
          ocurrido_en: v.visitada_en,
          cliente_id: v.cliente_id,
          datos,
        };
      });
    },

    marcarSincronizada: (clave) => visitas.marcarSincronizada(clave),
    marcarError: (clave, motivo) => visitas.marcarError(clave, motivo),
  };
}
```

- [ ] **Paso 4: el orden del push y la cuenta de pendientes (pruebas primero)**

`fuentes.spec.ts`: en `montar()` agrega `visitas: crearRepositorioVisitas(deps, { catalogos }),` (con su import) y
reemplaza el `it` por:

```ts
  it('sube prospectos ANTES que ventas (T-75) y visitas despues de cobranzas (T-39)', () => {
    const datos = montar();
    expect(fuentesDelPush(datos).map((f) => f.tipo)).toEqual([
      'jornada',
      'prospecto',
      'venta',
      'cobranza',
      'visita',
      'ruta-alta',
    ]);
  });
```

`pendientes.spec.ts`: en `montar()` agrega `visitas: crearRepositorioVisitas(deps, { catalogos }),`; en el caso
"suma jornada, venta, …", desestructura también `visitas`, registra una antes de cerrar la jornada:

```ts
    visitas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      motivoVisitaId: 'mot-tenia',
      observaciones: null,
      atendio: null,
      lat: 32.5,
      lng: -117,
      precisionM: null,
      direccionTexto: null,
      fotoUri: null,
    });
```

cambia el título a "suma jornada, venta, prospecto, cobranza, visita y alta de ruta pendientes" y el total esperado
a `6`.

`npm test --workspace=apps/tablet -- fuentes pendientes fuente-visitas` → fallan.

`fuentes.ts`: import `fuenteVisitas`; en la lista, después de `fuenteCobranzas(datos.cobranzas),` agrega
`fuenteVisitas(datos.visitas),`; en el doc agrega la viñeta:
`- Visitas después de cobranzas (T-39): la visita a un prospecto capturado sin red necesita su alta ya aplicada (el alcance se comprueba una vez por lote, como la venta de bienvenida de T-75).`

`pendientes.ts`: import `RepositorioVisitas`; `FuentesConPendientes` gana `/** T-39: las visitas sin venta. */
visitas: RepositorioVisitas;`; `contarPendientesDeSubir` suma `datos.visitas.pendientesDeSincronizar().length`; el doc
dice "las 6 fuentes del push (T-07, T-16, T-40, T-20, T-39, T-37)".

`motor.ts`: en el doc de `FuenteOperaciones`, "hoy jornada (T-04), venta (T-16), prospecto (T-40), cobranza (T-20),
la visita (T-39) y el alta de ruta (T-37) … Faltan gasto y merma (T-27/T-33)."

- [ ] **Paso 5: correr todo, typecheck, lint y commit**

```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
git add apps/tablet/src
git commit -m "T-39: tablet, repositorio de visitas y fuente del push (después de cobranzas)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 9: Tablet: lógica pura de la visita y de la ruta del día (D7, D8)

**Files:**
- Modify: `apps/tablet/src/ui/momento.ts`, `momento.spec.ts` (`formatearHora`)
- Create: `apps/tablet/src/estado/visita.ts`
- Create: `apps/tablet/src/estado/visita.spec.ts`
- Modify: `apps/tablet/src/estado/ruta-del-dia.ts`, `ruta-del-dia.spec.ts`
- Modify: `apps/tablet/src/datos/repositorios/rutas.ts` (`FilaRutaDelDia`, `delDia`), `rutas.spec.ts`
- Modify: `apps/tablet/app/(jornada)/index.tsx` (solo lo mínimo para que compile: ver Paso 6)

**Interfaces:**
- Consumes: `crearRepositorioVisitas`, `DatosRegistroVisita`, los `LARGO_MAX_*` (Tarea 8); `MotivoVisita` (Tarea 7).
- Produces:
  - `formatearHora(iso: string | null): string` → `HH:mm` local, o `--:--`.
  - `estado/visita.ts`: `type UbicacionVisita = { estado: 'buscando' } | { estado: 'ok'; lat: number; lng: number;
    precisionM: number | null } | { estado: 'fallo'; permisoNegado: boolean }`; `interface EntradaVisita { motivo:
    Pick<MotivoVisita, 'id' | 'exige_foto' | 'exige_atendio'> | null; observaciones: string; atendio: string;
    fotoUri: string | null; ubicacion: UbicacionVisita; direccionTexto: string }`; `interface ValidacionVisita {
    faltantes: string[]; atendioObligatorio: boolean; fotoObligatoria: boolean; pedirDireccion: boolean; visita:
    Omit<DatosRegistroVisita, 'vendedorId' | 'clienteId'> | null }`; `validarVisita(e): ValidacionVisita`;
    `textoUbicacionVisita(u): string`; `pastillaVisita(v: Pick<Visita, 'sync_estado' | 'sync_error'>): { texto:
    string; estado: EstadoPastilla; detalle: string | null }`; `textoEstadoVisitas(e: EstadoSubida): string`.
  - `ruta-del-dia.ts`: `FilaAgrupable` gana `visita_sin_venta`; `agruparRuta` devuelve `{ enRuta;
    visitadosSinVenta; fueraDeRuta }`; `sinRutaAsignada(grupos): boolean`; `AtendidoFueraDeRuta` gana `soloVisita:
    boolean`; `atendidosFueraDeRuta(filasRuta, ventas, visitas, cliente)`; `textoUltimaVisita(motivo, en): string`;
    `motivoDeRechazo(syncError: string | null): string`.
  - `FilaRutaDelDia` gana `visita_sin_venta: boolean`, `ultima_visita_motivo: string | null`, `ultima_visita_en:
    MomentoISO | null`, `visitas_estado: 'error' | 'pendiente' | 'listo' | null`, `visita_error: string | null`;
    `visitado` cuenta también las visitas.

- [ ] **Paso 1: `formatearHora` (prueba primero)**

`momento.spec.ts`, al final:

```ts
describe('formatearHora (T-39)', () => {
  it('es la hora LOCAL HH:mm', () => {
    expect(formatearHora(new Date(2026, 9, 17, 9, 5).toISOString())).toBe('09:05');
  });

  it('sin hora o con basura dice --:--', () => {
    expect(formatearHora(null)).toBe('--:--');
    expect(formatearHora('no es fecha')).toBe('--:--');
  });
});
```

(agrega `formatearHora` al import). En `momento.ts`:

```ts
/** Solo la hora LOCAL, `HH:mm`, para "Cerrado · 10:42" (T-39). `--:--` si no hay. */
export function formatearHora(iso: string | null): string {
  if (iso === null) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  const dos = (n: number) => `${n}`.padStart(2, '0');
  return `${dos(d.getHours())}:${dos(d.getMinutes())}`;
}
```

- [ ] **Paso 2: `validarVisita` y sus textos (prueba primero)**

`apps/tablet/src/estado/visita.spec.ts`:

```ts
import {
  pastillaVisita,
  textoEstadoVisitas,
  textoUbicacionVisita,
  validarVisita,
  type EntradaVisita,
} from './visita';

const CERRADO = { id: 'mot-cerrado', exige_foto: 1 as const, exige_atendio: 0 as const };
const ENCARGADO = { id: 'mot-encargado', exige_foto: 1 as const, exige_atendio: 1 as const };
const TENIA = { id: 'mot-tenia', exige_foto: 0 as const, exige_atendio: 0 as const };
const GPS = { estado: 'ok' as const, lat: 32.5149, lng: -117.0382, precisionM: 18.4 };

const entrada = (cambios: Partial<EntradaVisita> = {}): EntradaVisita => ({
  motivo: TENIA,
  observaciones: '',
  atendio: '',
  fotoUri: null,
  ubicacion: GPS,
  direccionTexto: '',
  ...cambios,
});

describe('validarVisita (T-39, D7)', () => {
  it('motivo sin exigencias y GPS: se puede guardar, con los textos vacios en null', () => {
    const r = validarVisita(entrada({ observaciones: '  ' }));
    expect(r.faltantes).toEqual([]);
    expect(r.visita).toEqual({
      motivoVisitaId: 'mot-tenia',
      observaciones: null,
      atendio: null,
      lat: 32.5149,
      lng: -117.0382,
      precisionM: 18.4,
      direccionTexto: null,
      fotoUri: null,
    });
  });

  it('sin motivo no se guarda', () => {
    const r = validarVisita(entrada({ motivo: null }));
    expect(r.visita).toBeNull();
    expect(r.faltantes).toContain('Elige el motivo de la visita.');
  });

  it('un motivo que exige foto no guarda sin foto, y si con ella', () => {
    expect(validarVisita(entrada({ motivo: CERRADO })).faltantes).toEqual([
      'Este motivo exige una foto: tómala antes de guardar.',
    ]);
    expect(validarVisita(entrada({ motivo: CERRADO })).fotoObligatoria).toBe(true);
    expect(validarVisita(entrada({ motivo: CERRADO, fotoUri: 'file:///f.jpg' })).visita?.fotoUri).toBe('file:///f.jpg');
  });

  it('un motivo que exige nombre no acepta solo espacios', () => {
    const r = validarVisita(entrada({ motivo: ENCARGADO, fotoUri: 'file:///f.jpg', atendio: '   ' }));
    expect(r.atendioObligatorio).toBe(true);
    expect(r.faltantes).toEqual(['Escribe el nombre de quien atendió.']);
    expect(validarVisita(entrada({ motivo: ENCARGADO, fotoUri: 'file:///f.jpg', atendio: ' Lupe ' })).visita?.atendio).toBe('Lupe');
  });

  it('sin exigencia, el nombre de quien atendio es opcional pero se guarda si se escribe', () => {
    const r = validarVisita(entrada({ atendio: 'Don Beto' }));
    expect(r.atendioObligatorio).toBe(false);
    expect(r.visita?.atendio).toBe('Don Beto');
  });

  it('mientras busca la ubicacion no se guarda y el campo de direccion no se pide', () => {
    const r = validarVisita(entrada({ ubicacion: { estado: 'buscando' } }));
    expect(r.pedirDireccion).toBe(false);
    expect(r.faltantes).toEqual(['Esperando la ubicación…']);
  });

  it('sin GPS aparece la direccion y es obligatoria; escrita, se guarda', () => {
    const fallo = { estado: 'fallo' as const, permisoNegado: true };
    const sinDireccion = validarVisita(entrada({ ubicacion: fallo }));
    expect(sinDireccion.pedirDireccion).toBe(true);
    expect(sinDireccion.faltantes).toEqual(['Sin GPS: escribe la dirección o una referencia del lugar.']);

    const conDireccion = validarVisita(entrada({ ubicacion: fallo, direccionTexto: ' Frente al parque ' }));
    expect(conDireccion.visita).toMatchObject({ lat: null, lng: null, precisionM: null, direccionTexto: 'Frente al parque' });
  });

  it('direccion escrita y despues llega el GPS: se guardan las dos y el campo sigue a la vista (Review Focus 2)', () => {
    const r = validarVisita(entrada({ ubicacion: GPS, direccionTexto: 'Frente al parque' }));
    expect(r.pedirDireccion).toBe(true);
    expect(r.visita).toMatchObject({ lat: 32.5149, lng: -117.0382, direccionTexto: 'Frente al parque' });
  });

  it('los topes de texto son los del servidor', () => {
    expect(validarVisita(entrada({ observaciones: 'x'.repeat(501) })).faltantes).toEqual([
      'Las observaciones no pueden pasar de 500 caracteres.',
    ]);
    expect(validarVisita(entrada({ atendio: 'x'.repeat(121) })).faltantes).toEqual([
      'El nombre de quien atendió no puede pasar de 120 caracteres.',
    ]);
    expect(validarVisita(entrada({ direccionTexto: 'x'.repeat(301) })).faltantes).toEqual([
      'La dirección no puede pasar de 300 caracteres.',
    ]);
  });
});

describe('textoUbicacionVisita', () => {
  it.each([
    [{ estado: 'buscando' as const }, 'Buscando ubicación…'],
    [GPS, 'Ubicación tomada (±18 m)'],
    [{ ...GPS, precisionM: null }, 'Ubicación tomada'],
    [{ estado: 'fallo' as const, permisoNegado: false }, 'No se pudo obtener la ubicación'],
  ])('%o → %s', (u, texto) => {
    expect(textoUbicacionVisita(u)).toBe(texto);
  });
});

describe('pastillaVisita y textoEstadoVisitas', () => {
  it('cada estado de subida con su palabra; la rechazada trae el motivo sin el codigo', () => {
    expect(pastillaVisita({ sync_estado: 'pendiente', sync_error: null })).toEqual({
      texto: 'por subir', estado: 'pendiente', detalle: null,
    });
    expect(pastillaVisita({ sync_estado: 'sincronizado', sync_error: null })).toEqual({
      texto: 'subida', estado: 'listo', detalle: null,
    });
    expect(
      pastillaVisita({ sync_estado: 'error', sync_error: 'motivo-visita-inexistente: El motivo no existe.' }),
    ).toEqual({ texto: 'rechazada', estado: 'error', detalle: 'El motivo no existe.' });
  });

  it('el estado agregado de las visitas de un cliente', () => {
    expect(textoEstadoVisitas('error')).toBe('rechazada');
    expect(textoEstadoVisitas('pendiente')).toBe('por subir');
    expect(textoEstadoVisitas('listo')).toBe('subida');
  });
});
```

`apps/tablet/src/estado/visita.ts`:

```ts
import {
  LARGO_MAX_ATENDIO,
  LARGO_MAX_DIRECCION,
  LARGO_MAX_OBSERVACIONES_VISITA,
  type DatosRegistroVisita,
} from '@/datos/repositorios/visitas';
import type { MotivoVisita, Visita } from '@/datos/tipos';

import { motivoDeRechazo, type EstadoPastilla, type EstadoSubida } from './ruta-del-dia';

/**
 * Lo que decide la pantalla "Visita sin venta" (T-39, D7), sin React: la tablet
 * no tiene pruebas de pantalla, asi que toda la validacion vive aqui y la
 * pantalla solo la pinta (mismo criterio que `ruta-del-dia.ts`).
 */

/** En que va la ubicacion de la pantalla. `fallo` cubre permiso negado y sin senal/tiempo agotado. */
export type UbicacionVisita =
  | { estado: 'buscando' }
  | { estado: 'ok'; lat: number; lng: number; precisionM: number | null }
  | { estado: 'fallo'; permisoNegado: boolean };

/** Lo que el vendedor lleva capturado, tal cual (los textos sin recortar). */
export interface EntradaVisita {
  motivo: Pick<MotivoVisita, 'id' | 'exige_foto' | 'exige_atendio'> | null;
  observaciones: string;
  atendio: string;
  fotoUri: string | null;
  ubicacion: UbicacionVisita;
  direccionTexto: string;
}

export interface ValidacionVisita {
  /** Lo que falta, en el orden de la pantalla. Vacio = se puede guardar. */
  faltantes: string[];
  /** El motivo exige el nombre de quien atendio. */
  atendioObligatorio: boolean;
  /** El motivo exige foto. */
  fotoObligatoria: boolean;
  /**
   * Se ve el campo "Dirección o referencia": sin GPS, o si ya se escribio algo
   * (para que no desaparezca si el GPS llega despues; se guardan las dos cosas).
   */
  pedirDireccion: boolean;
  /** Lista para `visitas.registrar` (sin vendedor ni cliente), o `null` si falta algo. */
  visita: Omit<DatosRegistroVisita, 'vendedorId' | 'clienteId'> | null;
}

function limpio(texto: string): string | null {
  const t = texto.trim();
  return t === '' ? null : t;
}

/** La validacion entera de la visita. Pura: misma entrada, misma salida. */
export function validarVisita(e: EntradaVisita): ValidacionVisita {
  const faltantes: string[] = [];
  const atendioObligatorio = e.motivo?.exige_atendio === 1;
  const fotoObligatoria = e.motivo?.exige_foto === 1;
  const observaciones = limpio(e.observaciones);
  const atendio = limpio(e.atendio);
  const direccion = limpio(e.direccionTexto);
  const gps = e.ubicacion.estado === 'ok' ? e.ubicacion : null;
  const pedirDireccion = e.ubicacion.estado === 'fallo' || direccion !== null;

  if (e.motivo === null) faltantes.push('Elige el motivo de la visita.');
  if (observaciones !== null && observaciones.length > LARGO_MAX_OBSERVACIONES_VISITA) {
    faltantes.push(`Las observaciones no pueden pasar de ${LARGO_MAX_OBSERVACIONES_VISITA} caracteres.`);
  }
  if (atendioObligatorio && atendio === null) faltantes.push('Escribe el nombre de quien atendió.');
  if (atendio !== null && atendio.length > LARGO_MAX_ATENDIO) {
    faltantes.push(`El nombre de quien atendió no puede pasar de ${LARGO_MAX_ATENDIO} caracteres.`);
  }
  if (fotoObligatoria && e.fotoUri === null) {
    faltantes.push('Este motivo exige una foto: tómala antes de guardar.');
  }
  if (direccion !== null && direccion.length > LARGO_MAX_DIRECCION) {
    faltantes.push(`La dirección no puede pasar de ${LARGO_MAX_DIRECCION} caracteres.`);
  }
  if (gps === null && direccion === null) {
    faltantes.push(
      e.ubicacion.estado === 'buscando'
        ? 'Esperando la ubicación…'
        : 'Sin GPS: escribe la dirección o una referencia del lugar.',
    );
  }

  return {
    faltantes,
    atendioObligatorio,
    fotoObligatoria,
    pedirDireccion,
    visita:
      faltantes.length === 0 && e.motivo !== null
        ? {
            motivoVisitaId: e.motivo.id,
            observaciones,
            atendio,
            lat: gps?.lat ?? null,
            lng: gps?.lng ?? null,
            precisionM: gps?.precisionM ?? null,
            direccionTexto: direccion,
            fotoUri: e.fotoUri,
          }
        : null,
  };
}

/** El estado de la ubicacion en palabras (D7). */
export function textoUbicacionVisita(u: UbicacionVisita): string {
  switch (u.estado) {
    case 'buscando':
      return 'Buscando ubicación…';
    case 'ok':
      return u.precisionM === null ? 'Ubicación tomada' : `Ubicación tomada (±${Math.round(u.precisionM)} m)`;
    case 'fallo':
      return 'No se pudo obtener la ubicación';
  }
}

/** La pastilla de UNA visita en la ficha ("Visitas de hoy"). */
export function pastillaVisita(
  v: Pick<Visita, 'sync_estado' | 'sync_error'>,
): { texto: string; estado: EstadoPastilla; detalle: string | null } {
  switch (v.sync_estado) {
    case 'pendiente':
    case 'enviando':
      return { texto: 'por subir', estado: 'pendiente', detalle: null };
    case 'sincronizado':
      return { texto: 'subida', estado: 'listo', detalle: null };
    case 'error':
      return { texto: 'rechazada', estado: 'error', detalle: motivoDeRechazo(v.sync_error) };
  }
}

/** La palabra del estado agregado de las visitas de un cliente ("Visitados sin venta"). */
export function textoEstadoVisitas(e: EstadoSubida): string {
  return { error: 'rechazada', pendiente: 'por subir', listo: 'subida' }[e];
}
```

`npm test --workspace=apps/tablet -- estado/visita` → falla hasta el Paso 4 (`motivoDeRechazo` aún no existe en
`ruta-del-dia.ts`); continúa.

- [ ] **Paso 3: la consulta de la ruta (prueba primero)**

`rutas.spec.ts`: en `montar()` agrega `visitas: crearRepositorioVisitas(deps, { catalogos }),` (import de
`./visitas`) y, al final del archivo:

```ts
function visitarA(
  visitas: ReturnType<typeof montar>['visitas'],
  motivoVisitaId = 'mot-tenia',
  clienteId = 'cli-1',
) {
  return visitas.registrar({
    vendedorId: 'ven-1',
    clienteId,
    motivoVisitaId,
    observaciones: null,
    atendio: null,
    lat: 32.5,
    lng: -117,
    precisionM: null,
    direccionTexto: null,
    fotoUri: null,
  });
}

describe('delDia con visitas (T-39, D8)', () => {
  it('una visita sin venta marca visitado y visita_sin_venta, con la ultima visita (Review Focus 4)', () => {
    const { rutas, visitas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    visitarA(visitas, 'mot-tenia');
    visitarA(visitas, 'mot-cerrado');

    expect(rutas.delDia()[0]).toMatchObject({
      visitado: true,
      visita_sin_venta: true,
      ultima_visita_motivo: 'Cerrado',
      ultima_visita_en: MOMENTO,
      visitas_estado: 'pendiente',
      visita_error: null,
    });
  });

  it('visita y venta el mismo dia: atendido gana, no es visita_sin_venta (Review Focus 3)', () => {
    const { rutas, visitas, ventas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    visitarA(visitas);
    venderA(ventas);
    expect(rutas.delDia()[0]).toMatchObject({ visitado: true, visita_sin_venta: false });
  });

  it('el estado de las visitas es el mas grave: error > pendiente > listo, con el motivo del error', () => {
    const { rutas, visitas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    const a = visitarA(visitas);
    const b = visitarA(visitas);
    visitas.marcarSincronizada(a.id);
    visitas.marcarSincronizada(b.id);
    expect(rutas.delDia()[0]!.visitas_estado).toBe('listo');

    visitas.marcarError(b.id, 'motivo-visita-inexistente: El motivo no existe.');
    expect(rutas.delDia()[0]).toMatchObject({
      visitas_estado: 'error',
      visita_error: 'motivo-visita-inexistente: El motivo no existe.',
    });
  });

  it('sin visitas: todo en null y false', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    expect(rutas.delDia()[0]).toMatchObject({
      visita_sin_venta: false,
      ultima_visita_motivo: null,
      ultima_visita_en: null,
      visitas_estado: null,
    });
  });

  it('una baja de la oficina que solo fue visitada cuenta como visitado (va a "Fuera de ruta")', () => {
    const { rutas, visitas } = montar();
    rutas.aplicarSnapshot([delServidor({ activo: 0 })]);
    visitarA(visitas);
    expect(rutas.delDia()).toMatchObject([{ activo: 0, visitado: true }]);
  });
});
```

`npm test --workspace=apps/tablet -- repositorios/rutas` → falla.

`rutas.ts`:

1. `FilaRutaDelDia`: el doc de `visitado` pasa a "Hoy tiene venta, cobro **o visita** en esta tablet (D5; T-39)."
   y agrega:
   ```ts
  /** T-39 (D8): hoy tiene visita y NO tiene venta ni cobro: va a "Visitados sin venta". */
  visita_sin_venta: boolean;
  /** Motivo de la ultima visita de hoy (la copia `motivo_nombre`), o `null`. */
  ultima_visita_motivo: string | null;
  /** Hora de la ultima visita de hoy, o `null`. */
  ultima_visita_en: MomentoISO | null;
  /**
   * Subida de las visitas de hoy, con la regla de las ventas (error > pendiente >
   * listo). Mismo vocabulario que `EstadoSubida` de `src/estado/ruta-del-dia.ts`
   * (la capa de datos no importa de ahi). `null` sin visitas.
   */
  visitas_estado: 'error' | 'pendiente' | 'listo' | null;
  /** `sync_error` de la ultima visita rechazada de hoy, o `null`. */
  visita_error: string | null;
   ```
2. `delDia` completo:
   ```ts
    delDia(fecha: FechaISO = reloj.hoy()): FilaRutaDelDia[] {
      type FilaCruda = Omit<FilaRutaDelDia, 'visitado' | 'visita_sin_venta'> & {
        atendido: number;
        con_visita: number;
      };
      const filas = bd.getAllSync<FilaCruda>(
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
                             where k.cliente_id = r.cliente_id and k.fecha = r.fecha)) as atendido,
                exists (select 1 from visita w
                         where w.cliente_id = r.cliente_id and w.fecha = r.fecha) as con_visita,
                (select w.motivo_nombre from visita w
                  where w.cliente_id = r.cliente_id and w.fecha = r.fecha
                  order by w.visitada_en desc, w.rowid desc limit 1) as ultima_visita_motivo,
                (select w.visitada_en from visita w
                  where w.cliente_id = r.cliente_id and w.fecha = r.fecha
                  order by w.visitada_en desc, w.rowid desc limit 1) as ultima_visita_en,
                case
                  when exists (select 1 from visita w
                                where w.cliente_id = r.cliente_id and w.fecha = r.fecha
                                  and w.sync_estado = 'error') then 'error'
                  when exists (select 1 from visita w
                                where w.cliente_id = r.cliente_id and w.fecha = r.fecha
                                  and w.sync_estado in ('pendiente', 'enviando')) then 'pendiente'
                  when exists (select 1 from visita w
                                where w.cliente_id = r.cliente_id and w.fecha = r.fecha) then 'listo'
                end as visitas_estado,
                (select w.sync_error from visita w
                  where w.cliente_id = r.cliente_id and w.fecha = r.fecha and w.sync_estado = 'error'
                  order by w.visitada_en desc, w.rowid desc limit 1) as visita_error
           from ruta r
           join cliente c on c.id = r.cliente_id
           left join ruta_orden_local o
                  on o.fecha = r.fecha and o.cliente_id = r.cliente_id
          where r.fecha = $fecha
          order by coalesce(o.posicion, 1000000000 + r.orden), r.orden, c.nombre`,
        { $fecha: fecha },
      );
      // Atendido (venta o cobro) gana a visitado (D8): con venta, sigue en la ruta.
      return filas.map(({ atendido, con_visita, ...f }) => ({
        ...f,
        visitado: atendido === 1 || con_visita === 1,
        visita_sin_venta: con_visita === 1 && atendido !== 1,
      }));
    },
   ```
   y en su doc-comment: "`visitado` es venta, cobro **o visita** de hoy (T-39); `visita_sin_venta` es visita sin venta
   ni cobro (D8). La última visita, su estado y su error salen de subconsultas con el mismo estilo."

- [ ] **Paso 4: `ruta-del-dia.ts` (pruebas primero)**

`ruta-del-dia.spec.ts`:

1. Importa también `sinRutaAsignada`, `textoUltimaVisita` y `motivoDeRechazo`.
2. Reemplaza el helper `fila` por:
   ```ts
const fila = (cliente_id: string, activo: 0 | 1, visitado: boolean, visita_sin_venta = false) => ({
  cliente_id,
  activo,
  visitado,
  visita_sin_venta,
});
   ```
3. En `describe('agruparRuta (D5, D16)')`: el caso "una baja SIN actividad hoy desaparece" espera
   `{ enRuta: [], visitadosSinVenta: [], fueraDeRuta: [] }`; agrega:
   ```ts
  it('T-39: la viva visitada sin venta sale de la lista y va a "Visitados sin venta", en su orden', () => {
    const r = agruparRuta([fila('a', 1, true, true), fila('b', 1, false), fila('c', 1, true, true)]);
    expect(r.enRuta.map((f) => f.cliente_id)).toEqual(['b']);
    expect(r.visitadosSinVenta.map((f) => f.cliente_id)).toEqual(['a', 'c']);
  });

  it('T-39: visitada CON venta sigue en la ruta con su palomita (Review Focus 3)', () => {
    const r = agruparRuta([fila('a', 1, true, false)]);
    expect(r.enRuta.map((f) => f.cliente_id)).toEqual(['a']);
    expect(r.visitadosSinVenta).toEqual([]);
  });

  it('T-39: una baja que solo fue visitada va a "Fuera de ruta"', () => {
    const r = agruparRuta([fila('a', 0, true, true)]);
    expect(r.fueraDeRuta.map((f) => f.cliente_id)).toEqual(['a']);
    expect(r.visitadosSinVenta).toEqual([]);
  });
   ```
4. Nuevo bloque:
   ```ts
describe('sinRutaAsignada (T-39)', () => {
  it('solo sin ninguna fila en las tres secciones', () => {
    expect(sinRutaAsignada({ enRuta: [], visitadosSinVenta: [], fueraDeRuta: [] })).toBe(true);
    // Todos visitados sin venta: hay ruta, aunque la lista quede vacia (Review Focus 3).
    expect(sinRutaAsignada({ enRuta: [], visitadosSinVenta: [fila('a', 1, true, true)], fueraDeRuta: [] })).toBe(false);
    expect(sinRutaAsignada({ enRuta: [], visitadosSinVenta: [], fueraDeRuta: [fila('b', 0, true)] })).toBe(false);
  });
});

describe('textoUltimaVisita y motivoDeRechazo (T-39)', () => {
  it('motivo y hora local', () => {
    expect(textoUltimaVisita('Cerrado', new Date(2026, 9, 17, 10, 42).toISOString())).toBe('Cerrado · 10:42');
    expect(textoUltimaVisita(null, null)).toBe('Visita · --:--');
  });

  it('el motivo sin el codigo tecnico', () => {
    expect(motivoDeRechazo('visita-id-ocupado: El id de esta visita ya está ocupado.')).toBe(
      'El id de esta visita ya está ocupado.',
    );
    expect(motivoDeRechazo('texto sin codigo')).toBe('texto sin codigo');
    expect(motivoDeRechazo(null)).toBe('El servidor la rechazó.');
  });
});
   ```
5. Reemplaza el `describe('atendidosFueraDeRuta (T-75, D7)', …)` completo por:
   ```ts
describe('atendidosFueraDeRuta (T-75, D7; T-39)', () => {
  const cliente = (id: string) =>
    ({
      a: { nombre: 'Abarrotes', tipo: 'cliente' as const },
      p: { nombre: 'Prospecto Z', tipo: 'prospecto' as const },
      z: { nombre: 'Zapateria', tipo: 'cliente' as const },
    })[id] ?? null;
  type Sync = 'pendiente' | 'enviando' | 'sincronizado' | 'error';
  const venta = (cliente_id: string, sync_estado: Sync = 'pendiente') => ({ cliente_id, sync_estado });
  const visita = venta;

  it('una venta a un cliente que no esta en la ruta lo lista; el prospecto va marcado', () => {
    const r = atendidosFueraDeRuta([], [venta('z', 'sincronizado'), venta('p')], [], cliente);
    expect(r).toEqual([
      { cliente_id: 'p', nombre: 'Prospecto Z', esProspecto: true, estado: 'pendiente', soloVisita: false },
      { cliente_id: 'z', nombre: 'Zapateria', esProspecto: false, estado: 'listo', soloVisita: false },
    ]);
  });

  it('en la ruta viva, o quitado con visita, NO sale: ya lo pinta la ruta (Review Focus 5 de T-75)', () => {
    const r = atendidosFueraDeRuta(
      [fila('a', 1, false), fila('z', 0, true)],
      [venta('a'), venta('z')],
      [visita('a'), visita('z')],
      cliente,
    );
    expect(r).toEqual([]);
  });

  it('quitado SIN visita y con venta local: sale (la ruta no lo pinta)', () => {
    const r = atendidosFueraDeRuta([fila('a', 0, false)], [venta('a')], [], cliente);
    expect(r.map((x) => x.cliente_id)).toEqual(['a']);
  });

  it('dos ventas al mismo cliente: una fila con el estado mas grave (Review Focus 4 de T-75)', () => {
    const r = atendidosFueraDeRuta([], [venta('a', 'sincronizado'), venta('a', 'error')], [], cliente);
    expect(r).toEqual([
      { cliente_id: 'a', nombre: 'Abarrotes', esProspecto: false, estado: 'error', soloVisita: false },
    ]);
  });

  it('un cliente que ya no esta en el catalogo local se omite sin tronar', () => {
    expect(atendidosFueraDeRuta([], [venta('fantasma')], [visita('fantasma')], cliente)).toEqual([]);
  });

  it('T-39: solo visitado fuera de ruta sale con soloVisita (la etiqueta "visita")', () => {
    const r = atendidosFueraDeRuta([], [], [visita('p', 'sincronizado')], cliente);
    expect(r).toEqual([
      { cliente_id: 'p', nombre: 'Prospecto Z', esProspecto: true, estado: 'listo', soloVisita: true },
    ]);
  });

  it('T-39: con venta y visita es una fila, sin soloVisita, con el estado mas grave de las dos', () => {
    const r = atendidosFueraDeRuta([], [venta('a', 'sincronizado')], [visita('a', 'error')], cliente);
    expect(r).toEqual([
      { cliente_id: 'a', nombre: 'Abarrotes', esProspecto: false, estado: 'error', soloVisita: false },
    ]);
  });
});
   ```

`ruta-del-dia.ts`:

1. Imports: `import type { Cliente, Prospecto, SyncEstado, Venta, Visita } from '@/datos/tipos';` y
   `import { formatearHora, formatearMomento } from '@/ui/momento';`.
2. `FilaAgrupable = Pick<FilaRutaDelDia, 'cliente_id' | 'activo' | 'visitado' | 'visita_sin_venta'>;`
3. `agruparRuta`:
   ```ts
/**
 * Reparte las filas del dia (ya ordenadas por `rutas.delDia`) entre la ruta,
 * "Visitados sin venta" y "Fuera de ruta" (D5, D16; T-39 D8):
 *
 * - Viva sin visita-sin-venta → en la ruta, visitada o no (la palomita no la saca).
 * - Viva con visita y SIN venta ni cobro → "Visitados sin venta". Si despues
 *   compra, `visita_sin_venta` pasa a `false` y regresa a la ruta con su palomita.
 * - Quitada por la oficina **con** actividad hoy (venta, cobro o visita) → "Fuera de ruta".
 * - Quitada **sin** actividad → desaparece.
 * - Si el cliente quitado volvio a la ruta (otra fila viva), no se pinta dos veces.
 */
export function agruparRuta<T extends FilaAgrupable>(
  filas: readonly T[],
): { enRuta: T[]; visitadosSinVenta: T[]; fueraDeRuta: T[] } {
  const vivos = new Set(filas.filter((f) => f.activo === 1).map((f) => f.cliente_id));
  return {
    enRuta: filas.filter((f) => f.activo === 1 && !f.visita_sin_venta),
    visitadosSinVenta: filas.filter((f) => f.activo === 1 && f.visita_sin_venta),
    fueraDeRuta: filas.filter((f) => f.activo === 0 && f.visitado && !vivos.has(f.cliente_id)),
  };
}

/**
 * ¿La oficina no asigno ruta hoy? Solo si las TRES secciones estan vacias: con
 * todos los clientes visitados sin venta la lista queda vacia, pero si hay ruta.
 */
export function sinRutaAsignada(grupos: {
  enRuta: readonly unknown[];
  visitadosSinVenta: readonly unknown[];
  fueraDeRuta: readonly unknown[];
}): boolean {
  return grupos.enRuta.length === 0 && grupos.visitadosSinVenta.length === 0 && grupos.fueraDeRuta.length === 0;
}

/** La linea de la fila de "Visitados sin venta": "Cerrado · 10:42". */
export function textoUltimaVisita(motivo: string | null, en: string | null): string {
  return `${motivo ?? 'Visita'} · ${formatearHora(en)}`;
}
   ```
4. `AtendidoFueraDeRuta` gana `/** T-39: solo se le visito (sin venta): la fila lleva la etiqueta "visita". */
   soloVisita: boolean;` y la función pasa a:
   ```ts
/**
 * Clientes y prospectos con venta **o visita** del dia en esta tablet que la
 * ruta NO pinta (T-75, D7; T-39 D8): ni vivos ni quitados-con-actividad (esos ya
 * salen en "Fuera de ruta" o "Visitados sin venta"). Uno por cliente, con el
 * estado mas grave de sus ventas y visitas; `soloVisita` si no tiene venta.
 */
export function atendidosFueraDeRuta(
  filasRuta: readonly FilaAgrupable[],
  ventas: readonly Pick<Venta, 'cliente_id' | 'sync_estado'>[],
  visitas: readonly Pick<Visita, 'cliente_id' | 'sync_estado'>[],
  cliente: (id: string) => Pick<Cliente, 'nombre' | 'tipo'> | null,
): AtendidoFueraDeRuta[] {
  const pintados = new Set(
    filasRuta.filter((f) => f.activo === 1 || f.visitado).map((f) => f.cliente_id),
  );
  const porCliente = new Map<string, { estados: SyncEstado[]; ventas: number }>();
  const anotar = (clienteId: string, estado: SyncEstado, esVenta: boolean) => {
    if (pintados.has(clienteId)) return;
    const actual = porCliente.get(clienteId) ?? { estados: [], ventas: 0 };
    porCliente.set(clienteId, {
      estados: [...actual.estados, estado],
      ventas: actual.ventas + (esVenta ? 1 : 0),
    });
  };
  for (const v of ventas) anotar(v.cliente_id, v.sync_estado, true);
  for (const w of visitas) anotar(w.cliente_id, w.sync_estado, false);

  const filas: AtendidoFueraDeRuta[] = [];
  for (const [cliente_id, { estados, ventas: cuantas }] of porCliente) {
    const c = cliente(cliente_id);
    if (!c) continue;
    const estado = estadoSubida(estados);
    if (!estado) continue;
    filas.push({
      cliente_id,
      nombre: c.nombre,
      esProspecto: c.tipo === 'prospecto',
      estado,
      soloVisita: cuantas === 0,
    });
  }
  return filas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}
   ```
5. Extrae el motivo sin código, que hoy vive dentro de `detalleDeAltaRechazada`:
   ```ts
/** El motivo de un rechazo sin el prefijo técnico `codigo: ` (T-39; lo usaba ya el alta de T-75). */
export function motivoDeRechazo(syncError: string | null): string {
  const m = syncError ? PREFIJO_CODIGO.exec(syncError) : null;
  const motivo = (m ? syncError!.slice(m[0].length) : syncError)?.trim();
  return motivo || 'El servidor la rechazó.';
}
   ```
   Ponla justo después de `const PREFIJO_CODIGO = …`. `detalleDeAltaRechazada` **no cambia** (su texto de respaldo es
   otro, "El servidor rechazó el alta."), así que las pruebas de `pastillaAlta` siguen igual.

- [ ] **Paso 5: correr**

`npm test --workspace=apps/tablet -- ruta-del-dia estado/visita repositorios/rutas momento` → verde.

- [ ] **Paso 6: `index.tsx`, lo mínimo para compilar**

`agruparRuta` ya devuelve `visitadosSinVenta` y `atendidosFueraDeRuta` pide las visitas: en `app/(jornada)/index.tsx`
cambia solo la llamada a
`atendidosFueraDeRuta(filas, datos.ventas.delDiaDelVendedor(vendedor.id), datos.visitas.delDiaDelVendedor(vendedor.id), (id) => datos.catalogos.obtenerCliente(id))`
y `const sinRuta = sinRutaAsignada({ enRuta, visitadosSinVenta, fueraDeRuta });` (con
`const { enRuta, visitadosSinVenta, fueraDeRuta } = useMemo(...)` e import de `sinRutaAsignada`). La sección nueva se
pinta en la Tarea 11.

- [ ] **Paso 7: typecheck, lint, todas las pruebas y commit**

```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
git add apps/tablet
git commit -m "T-39: tablet, validarVisita y la ruta del día con visitados sin venta (lógica pura)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 10: Tablet: fotos de la visita, cola de varias fuentes, precisión del GPS y descarga de la foto del cliente (D7, D9)

**Files:**
- Modify: `apps/tablet/src/ubicacion/obtener.ts`, `obtener.spec.ts` (`precisionM`)
- Modify: `apps/tablet/src/fotos/expo.ts` (`capturarFoto(destino)`, `bajarFotoExpo`, `rutaCacheFotoCliente`)
- Modify: `apps/tablet/app/(jornada)/prospectos.tsx` (usa `capturarFoto('prospecto')`)
- Create: `apps/tablet/src/fotos/descarga.ts`
- Create: `apps/tablet/src/fotos/descarga.spec.ts`
- Modify: `apps/tablet/src/sincronizacion/fuente-fotos.ts`, `fuente-fotos.spec.ts`
- Modify: `apps/tablet/src/estado/proveedor-sesion.tsx`

**Interfaces:**
- Consumes: `RepositorioVisitas` (`pendientesDeSubirFoto`, `marcarFotoSubida`, `anotarErrorFoto`, `descartarFoto`;
  Tarea 8); `catalogos.marcarFotoDescargada` (Tarea 7); `GET /sync/foto/cliente/:clienteId` (Tarea 5); `URL_API`.
- Produces:
  - `ResultadoUbicacion` `ok` gana `precisionM: number | null` (de `coords.accuracy`).
  - `type DestinoFoto = 'prospecto' | 'visita'`; `capturarFoto(destino: DestinoFoto): Promise<ResultadoCaptura>`
    (reemplaza a `capturarFotoProspecto`, misma compresión de 300 KB); `bajarFotoExpo: BajarFoto`;
    `rutaCacheFotoCliente(clienteId: string): string`.
  - `fotos/descarga.ts`: `fotoParaFicha(p: { fotoLocal: string | null; fotoSubidaEn: string | null; cacheSubidaEn:
    string | null; uriCache: string }): { uri: string | null; descargar: boolean }`; `type BajarFoto = (url: string,
    tokenAcceso: string, destino: string) => Promise<number>`; `descargarFotoCliente(p: { bajar: BajarFoto; base:
    string; tokenAcceso: string; clienteId: string; destino: string }): Promise<'ok' | 'sin-foto' | 'fallo'>`.
  - `fuenteFotosVisitas(visitas): FuenteFotos`; `combinarFuentesFotos(fuentes: readonly FuenteFotos[]):
    FuenteFotos`.
  - `ContextoSesion.descargarFotoCliente(clienteId: string, fotoSubidaEn: string): Promise<string | null>`.

- [ ] **Paso 1: precisión del GPS (prueba primero)**

`obtener.spec.ts`: el caso "devuelve las coordenadas cuando hay permiso y lectura" espera ahora
`{ estado: 'ok', lat: 32.5149, lng: -117.0382, precisionM: null }` (el mock no trae `accuracy`), y agrega:

```ts
  it('trae la precision del aparato en metros cuando la reporta (T-39)', async () => {
    pedirPermiso.mockResolvedValue({ granted: true });
    leerPosicion.mockResolvedValue({ coords: { latitude: 32.5, longitude: -117, accuracy: 18.4 } });
    await expect(obtenerUbicacion()).resolves.toMatchObject({ estado: 'ok', precisionM: 18.4 });
  });
```

`obtener.ts`: el tipo `ok` pasa a `| { estado: 'ok'; lat: number; lng: number; precisionM: number | null }` con el
comentario "`precisionM`: radio de error en metros que reporta el aparato (T-39 la guarda con la visita); `null` si
no lo da." y el `return` agrega `precisionM: posicion.coords.accuracy ?? null,`. `prospectos.tsx` no cambia por esto
(solo lee `lat`/`lng`).

- [ ] **Paso 2: la decisión de la foto de la ficha y la descarga (prueba primero)**

`apps/tablet/src/fotos/descarga.spec.ts`:

```ts
import { descargarFotoCliente, fotoParaFicha, type BajarFoto } from './descarga';

const CACHE = 'file:///docs/fotos-clientes/cli-1.jpg';
const AYER = '2026-10-16T19:00:00.000Z';
const HOY = '2026-10-17T19:00:00.000Z';

describe('fotoParaFicha (T-39, D9)', () => {
  it('la foto que tomo ESTA tablet gana y no se baja nada', () => {
    expect(fotoParaFicha({ fotoLocal: 'file:///cache/a.jpg', fotoSubidaEn: HOY, cacheSubidaEn: null, uriCache: CACHE }))
      .toEqual({ uri: 'file:///cache/a.jpg', descargar: false });
  });

  it('sin foto en el servidor: "sin foto", sin descarga', () => {
    expect(fotoParaFicha({ fotoLocal: null, fotoSubidaEn: null, cacheSubidaEn: null, uriCache: CACHE }))
      .toEqual({ uri: null, descargar: false });
  });

  it('con foto en el servidor y nada en cache: se baja (mientras tanto, sin foto)', () => {
    expect(fotoParaFicha({ fotoLocal: null, fotoSubidaEn: HOY, cacheSubidaEn: null, uriCache: CACHE }))
      .toEqual({ uri: null, descargar: true });
  });

  it('la cache al dia se pinta y no se vuelve a bajar', () => {
    expect(fotoParaFicha({ fotoLocal: null, fotoSubidaEn: HOY, cacheSubidaEn: HOY, uriCache: CACHE }))
      .toEqual({ uri: CACHE, descargar: false });
  });

  it('la cache mas vieja que foto_subida_en se pinta mientras baja la nueva', () => {
    expect(fotoParaFicha({ fotoLocal: null, fotoSubidaEn: HOY, cacheSubidaEn: AYER, uriCache: CACHE }))
      .toEqual({ uri: CACHE, descargar: true });
  });
});

describe('descargarFotoCliente (T-39, D9)', () => {
  const pedir = (bajar: BajarFoto) =>
    descargarFotoCliente({ bajar, base: 'http://srv', tokenAcceso: 'tok', clienteId: 'CLI-1', destino: CACHE });

  it('pide la URL del canal con el token y el destino de la cache', async () => {
    const bajar = jest.fn<Promise<number>, Parameters<BajarFoto>>().mockResolvedValue(200);
    await expect(pedir(bajar)).resolves.toBe('ok');
    expect(bajar).toHaveBeenCalledWith('http://srv/sync/foto/cliente/cli-1', 'tok', CACHE);
  });

  it('404 es "sin-foto"; otro codigo es "fallo"', async () => {
    await expect(pedir(async () => 404)).resolves.toBe('sin-foto');
    await expect(pedir(async () => 401)).resolves.toBe('fallo');
    await expect(pedir(async () => 503)).resolves.toBe('fallo');
  });

  it('sin red no lanza: es "fallo" y la ficha sigue diciendo "sin foto"', async () => {
    await expect(pedir(async () => { throw new Error('Network request failed'); })).resolves.toBe('fallo');
  });
});
```

`apps/tablet/src/fotos/descarga.ts`:

```ts
/**
 * La foto del cliente en la ficha (T-39, D9): cual pintar y si hay que bajarla
 * del servidor. Puro y probable en Node; el transporte nativo (fetch + disco)
 * esta en `expo.ts` y entra por {@link BajarFoto}.
 *
 * Las fotos de las visitas NO bajan: nadie las necesita en la tablet todavia.
 */

export interface FotoParaFicha {
  /** Que pintar ahora, o `null` ("sin foto"). */
  uri: string | null;
  /** Si hay que pedir la del servidor (una vez por apertura de la ficha). */
  descargar: boolean;
}

export function fotoParaFicha(p: {
  /** La que tomo ESTA tablet al capturar el prospecto (`prospectos.fotoLocalDe`). */
  fotoLocal: string | null;
  /** `cliente.foto_subida_en` (baja en el pull). */
  fotoSubidaEn: string | null;
  /** `cliente.foto_cache_subida_en`: la de la copia que ya esta en cache. */
  cacheSubidaEn: string | null;
  /** Donde vive (o viviria) la copia en cache. */
  uriCache: string;
}): FotoParaFicha {
  if (p.fotoLocal !== null) return { uri: p.fotoLocal, descargar: false };
  if (p.fotoSubidaEn === null) return { uri: null, descargar: false };
  const alDia = p.cacheSubidaEn !== null && Date.parse(p.cacheSubidaEn) >= Date.parse(p.fotoSubidaEn);
  if (alDia) return { uri: p.uriCache, descargar: false };
  // Mas vieja o ninguna: se pinta la vieja (si hay) mientras baja la nueva.
  return { uri: p.cacheSubidaEn !== null ? p.uriCache : null, descargar: true };
}

/**
 * Baja `url` con el token a `destino` y devuelve el `status`. Escribe el archivo
 * **solo** con un 2xx. Lanza solo si no hubo respuesta (sin red).
 */
export type BajarFoto = (url: string, tokenAcceso: string, destino: string) => Promise<number>;

export type ResultadoDescarga = 'ok' | 'sin-foto' | 'fallo';

/**
 * Pide la foto del cliente al servidor. **Nunca lanza**: sin red, sin sesion o
 * con el servidor caido la ficha sigue diciendo "sin foto", como antes de T-39.
 */
export async function descargarFotoCliente(p: {
  bajar: BajarFoto;
  base: string;
  tokenAcceso: string;
  clienteId: string;
  destino: string;
}): Promise<ResultadoDescarga> {
  try {
    const status = await p.bajar(
      `${p.base}/sync/foto/cliente/${encodeURIComponent(p.clienteId.toLowerCase())}`,
      p.tokenAcceso,
      p.destino,
    );
    if (status >= 200 && status < 300) return 'ok';
    if (status === 404) return 'sin-foto';
    return 'fallo';
  } catch {
    return 'fallo';
  }
}
```

`npm test --workspace=apps/tablet -- descarga` → verde.

- [ ] **Paso 3: la cola de fotos con varias fuentes (prueba primero)**

`fuente-fotos.spec.ts`, al final (imports nuevos: `crearRepositorioVisitas` y `combinarFuentesFotos,
fuenteFotosVisitas`):

```ts
describe('fotos de visitas y cola combinada (T-39, D9)', () => {
  function montarAmbas() {
    const deps = depsDePrueba();
    const catalogos = crearRepositorioCatalogos(deps);
    catalogos.guardarSnapshot(snapshotDePrueba());
    const prospectos = crearRepositorioProspectos(deps, { catalogos });
    const visitas = crearRepositorioVisitas(deps, { catalogos });
    const fuente = combinarFuentesFotos([fuenteFotosProspectos(prospectos), fuenteFotosVisitas(visitas)]);
    return { prospectos, visitas, fuente };
  }

  const visitaCon = (fotoUri: string | null) => ({
    vendedorId: 'ven-1',
    clienteId: 'cli-1',
    motivoVisitaId: 'mot-cerrado',
    observaciones: null,
    atendio: null,
    lat: 32.5,
    lng: -117,
    precisionM: null,
    direccionTexto: null,
    fotoUri,
  });

  it('la foto de una visita sale solo cuando la visita ya esta sincronizada', () => {
    const { visitas, fuente } = montarAmbas();
    const v = visitas.registrar(visitaCon('file:///cache/v.jpg'));
    expect(fuente.pendientes()).toEqual([]);
    visitas.marcarSincronizada(v.id);
    expect(fuente.pendientes()).toEqual([{ clave: v.id, uri: 'file:///cache/v.jpg' }]);
  });

  it('prospectos primero, visitas despues, y cada resultado vuelve a SU repositorio', () => {
    const { prospectos, visitas, fuente } = montarAmbas();
    const p = prospectos.registrar(captura('file:///cache/p.jpg'));
    prospectos.marcarSincronizado(p.id);
    const v = visitas.registrar(visitaCon('file:///cache/v.jpg'));
    visitas.marcarSincronizada(v.id);

    expect(fuente.pendientes().map((f) => f.clave)).toEqual([p.id, v.id]);
    fuente.marcarSubida(v.id, '2026-08-07T16:00:00.000Z');
    fuente.descartar(p.id, 'La foto pesa demasiado');

    expect(visitas.porId(v.id)?.foto_subida_en).toBe('2026-08-07T16:00:00.000Z');
    expect(prospectos.porId(p.id)).toMatchObject({ foto_descartada: 1, foto_subida_en: null });
    expect(visitas.porId(v.id)?.foto_descartada).toBe(0);
  });

  it('un resultado de una clave que no salio de pendientes() es un bug y truena', () => {
    const { fuente } = montarAmbas();
    expect(() => fuente.anotarError('nadie', 'x')).toThrow(/no salio de pendientes/);
  });
});
```

`npm test --workspace=apps/tablet -- fuente-fotos` → falla.

`fuente-fotos.ts`: import `type RepositorioVisitas`; actualiza el doc de `FotoPorSubir.clave` ("La clave de
idempotencia de la operación del prospecto **o de la visita** — el `id` de la fila; el servidor nombra el archivo por
ese id (`cliente-<id>.jpg`, `visita-<id>.jpg`, T-78)") y agrega al final:

```ts
/**
 * Las fotos de las visitas sin venta (T-39, D9). `pendientesDeSubirFoto()` ya
 * exige `sync_estado = 'sincronizado'`: antes de que el servidor acepte la
 * visita no existe la fila a la que la foto pertenece (el canal responde 404/409).
 */
export function fuenteFotosVisitas(visitas: RepositorioVisitas): FuenteFotos {
  return {
    tipo: 'visita',
    pendientes(): FotoPorSubir[] {
      return visitas
        .pendientesDeSubirFoto()
        .flatMap((v) => (v.foto_local === null ? [] : [{ clave: v.id, uri: v.foto_local }]));
    },
    marcarSubida: (clave, subidaEn) => visitas.marcarFotoSubida(clave, subidaEn),
    anotarError: (clave, motivo) => visitas.anotarErrorFoto(clave, motivo),
    descartar: (clave, motivo) => visitas.descartarFoto(clave, motivo),
  };
}

/**
 * Varias fuentes de fotos vistas como una sola (T-39): el motor sigue hablando
 * con UNA `FuenteFotos` y no cambia. `pendientes()` las concatena en el orden
 * recibido y recuerda de quien es cada clave, para que `marcarSubida`,
 * `anotarError` y `descartar` vuelvan a SU repositorio. Una clave que no salio
 * del ultimo `pendientes()` es un bug del llamador y truena en vez de anotarse
 * en el sitio equivocado.
 */
export function combinarFuentesFotos(fuentes: readonly FuenteFotos[]): FuenteFotos {
  const duenas = new Map<string, FuenteFotos>();
  const duenaDe = (clave: string): FuenteFotos => {
    const fuente = duenas.get(clave);
    if (!fuente) {
      throw new Error(`La foto ${clave} no salio de pendientes(): no se sabe de que fuente es.`);
    }
    return fuente;
  };
  return {
    tipo: fuentes.map((f) => f.tipo).join('+'),
    pendientes(): FotoPorSubir[] {
      duenas.clear();
      return fuentes.flatMap((fuente) =>
        fuente.pendientes().map((foto) => {
          duenas.set(foto.clave, fuente);
          return foto;
        }),
      );
    },
    marcarSubida: (clave, subidaEn) => duenaDe(clave).marcarSubida(clave, subidaEn),
    anotarError: (clave, motivo) => duenaDe(clave).anotarError(clave, motivo),
    descartar: (clave, motivo) => duenaDe(clave).descartar(clave, motivo),
  };
}
```

`npm test --workspace=apps/tablet -- fuente-fotos` → verde.

- [ ] **Paso 4: la captura generalizada y el transporte de la descarga (`expo.ts`)**

1. Imports: `import { Directory, File, Paths, UploadType } from 'expo-file-system';` y
   `import type { BajarFoto } from './descarga';`.
2. Reemplaza `export async function capturarFotoProspecto(): Promise<ResultadoCaptura> {` por:
   ```ts
/** Para que es la foto: cambia el texto del fallo, no la compresion (T-39, D9). */
export type DestinoFoto = 'prospecto' | 'visita';

export async function capturarFoto(destino: DestinoFoto): Promise<ResultadoCaptura> {
   ```
   y, dentro del `catch`, el texto genérico pasa a
   `` `No se pudo tomar la foto ${destino === 'visita' ? 'de la visita' : 'del lugar'}: ${error instanceof Error ? error.message : String(error)}` ``.
   El doc-comment de arriba dice "Pide una foto (del lugar del prospecto o de la visita, T-39) y la devuelve **ya
   comprimida**" y "Quien la llama es el alta del prospecto o la visita sin venta".
3. Al final del archivo:
   ```ts
/** Donde vive la copia en cache de la foto de un cliente: documentos, por id (T-39, D9). */
export function rutaCacheFotoCliente(clienteId: string): string {
  return new File(Paths.document, 'fotos-clientes', `${clienteId}.jpg`).uri;
}

/**
 * Baja la foto del cliente con `fetch` y la escribe en `destino` SOLO con un
 * 2xx (con un 404 no se toca la copia vieja). `fetch` y no `File.downloadFileAsync`
 * porque aqui hace falta el `status` exacto para distinguir "sin foto" de "fallo".
 * Si no hay respuesta, `fetch` lanza y `descargarFotoCliente` lo vuelve "fallo".
 */
export const bajarFotoExpo: BajarFoto = async (url, tokenAcceso, destino) => {
  const respuesta = await fetch(url, { headers: { Authorization: `Bearer ${tokenAcceso}` } });
  if (!respuesta.ok) return respuesta.status;
  const bytes = new Uint8Array(await respuesta.arrayBuffer());
  const archivo = new File(destino);
  new Directory(archivo.parentDirectory.uri).create({ intermediates: true, idempotent: true });
  archivo.write(bytes);
  return respuesta.status;
};
   ```
   Si `typecheck` marca alguna de estas APIs de `expo-file-system` (SDK 57: `File`, `Directory`, `Paths.document`,
   `File.parentDirectory`, `Directory.create({ intermediates, idempotent })`, `File.write(Uint8Array)`), ajústala a la
   firma que trae `node_modules/expo-file-system/build/` **sin** cambiar el contrato de `BajarFoto`.
4. `app/(jornada)/prospectos.tsx`: `import { capturarFoto } from '@/fotos/expo';` y `const r = await
   capturarFoto('prospecto');` (y el comentario que nombraba `capturarFotoProspecto`).

- [ ] **Paso 5: el proveedor de sesión**

`proveedor-sesion.tsx`:

1. Imports: `combinarFuentesFotos, fuenteFotosProspectos, fuenteFotosVisitas` de `@/sincronizacion/fuente-fotos`;
   `bajarFotoExpo, crearClienteFotosExpo, rutaCacheFotoCliente` de `@/fotos/expo`;
   `import { descargarFotoCliente as descargarFoto } from '@/fotos/descarga';`; `URL_API` junto a
   `crearClienteAuthApp` de `@/sesion/api`.
2. En el motor:
   ```ts
      // T-40 / T-39: el canal de la foto, aparte del lote del push. Corre despues,
      // y solo para prospectos y visitas que el servidor ya acepto — antes no existe
      // la fila a la que la foto pertenece. Una cola, varias fuentes.
      fotos: {
        fuente: combinarFuentesFotos([
          fuenteFotosProspectos(datos.prospectos),
          fuenteFotosVisitas(datos.visitas),
        ]),
        api: crearClienteFotosExpo(),
      },
   ```
3. `ContextoSesion` gana:
   ```ts
  /**
   * T-39 (D9): baja la foto del servidor de un cliente a la cache y devuelve su
   * ruta, o `null` sin red, sin sesion o sin foto. Nunca lanza.
   */
  descargarFotoCliente: (clienteId: string, fotoSubidaEn: string) => Promise<string | null>;
   ```
4. Implementación (antes de `const valor = useMemo`), y agrégala al objeto y a las dependencias del `useMemo`:
   ```ts
  const descargarFotoCliente = useCallback(
    async (clienteId: string, fotoSubidaEn: string): Promise<string | null> => {
      const token = gestor.sesionGuardada()?.tokenAcceso ?? null;
      if (token === null) return null;
      const destino = rutaCacheFotoCliente(clienteId);
      const r = await descargarFoto({ bajar: bajarFotoExpo, base: URL_API, tokenAcceso: token, clienteId, destino });
      if (r !== 'ok') return null;
      datos.catalogos.marcarFotoDescargada(clienteId, fotoSubidaEn);
      return destino;
    },
    [gestor, datos],
  );
   ```

- [ ] **Paso 6: typecheck, lint, pruebas y commit**

```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
git add apps/tablet
git commit -m "T-39: tablet, fotos de visita en la cola combinada, precisión del GPS y descarga de la foto del cliente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 11: Tablet: pantallas — Visita sin venta, "Visitados sin venta", ficha y "Atendidos fuera de ruta" (D7, D8, D9)

**Files:**
- Modify (reemplazo completo): `apps/tablet/app/(jornada)/operacion/[clienteId]/visita-sin-venta.tsx`
- Modify: `apps/tablet/src/ui/lista-ruta.tsx` (`FilaVisitadoSinVenta`; etiqueta "visita" en `FilaAtendidoFueraDeRuta`)
- Modify: `apps/tablet/app/(jornada)/index.tsx` (sección "Visitados sin venta")
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx` (ficha: "Visitas de hoy", botón Visita, foto
  descargada)

**Interfaces:**
- Consumes: `validarVisita`, `textoUbicacionVisita`, `pastillaVisita`, `textoEstadoVisitas`, `UbicacionVisita`
  (Tarea 9); `textoUltimaVisita`, `motivoDeRechazo`, `estadoSubida`, `sinRutaAsignada` (Tarea 9);
  `datos.visitas.registrar/delDia/delDiaDelVendedor`, `ErrorVisita` (Tarea 8); `catalogos.listarMotivosVisita`,
  `obtenerMotivoVisita` (Tarea 7); `capturarFoto`, `rutaCacheFotoCliente`, `fotoParaFicha`,
  `useSesion().descargarFotoCliente`, `obtenerUbicacion` con `precisionM` (Tarea 10); `formatearHora`.

No hay pruebas de pantalla: el criterio es `typecheck` + `lint` + revisión de lectura + la aceptación manual del
controlador (spec, "Aceptación en el emulador"). Una sola acción primaria por pantalla; estado con color + palabra.

- [ ] **Paso 1: la pantalla "Visita sin venta"**

Reemplaza `visita-sin-venta.tsx` por:

```tsx
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Platform, Text, ToastAndroid } from 'react-native';

import { ErrorJornada, ErrorVisita } from '@/datos';
import type { MotivoVisita } from '@/datos/tipos';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import { useJawa } from '@/estado/proveedor-jawa';
import { textoUbicacionVisita, validarVisita, type UbicacionVisita } from '@/estado/visita';
import type { FotoComprimida } from '@/fotos/comprimir';
import { capturarFoto } from '@/fotos/expo';
import { obtenerUbicacion } from '@/ubicacion/obtener';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Opcion } from '@/ui/opcion';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/** El aviso breve al volver a la ruta (como "Agregar a mi ruta"). En otra plataforma, un Alert. */
function avisar(texto: string) {
  if (Platform.OS === 'android') ToastAndroid.show(texto, ToastAndroid.SHORT);
  else Alert.alert(texto);
}

/**
 * Visita sin venta (T-39, D7): por que el cliente no compro. Motivo del catalogo
 * de la oficina, observaciones, quien atendio (obligatorio si el motivo lo exige),
 * foto (obligatoria si el motivo la exige) y ubicacion (GPS o, sin el, la
 * direccion escrita). Funciona sin red. Toda la validacion es `validarVisita`
 * (`src/estado/visita.ts`, con pruebas); aqui solo se pinta.
 */
export default function VisitaSinVenta() {
  const { clienteId } = useLocalSearchParams<{ clienteId: string }>();
  const { datos, vendedor, jornada, versionCatalogos } = useJawa();
  const { estilos } = useTema();
  const menu = estadoMenuJornada(jornada);

  const motivos = useMemo<MotivoVisita[]>(() => {
    void versionCatalogos;
    return datos.catalogos.listarMotivosVisita();
  }, [datos, versionCatalogos]);

  const [motivoId, setMotivoId] = useState<string | null>(null);
  const [observaciones, setObservaciones] = useState('');
  const [atendio, setAtendio] = useState('');
  const [direccion, setDireccion] = useState('');
  const [foto, setFoto] = useState<FotoComprimida | null>(null);
  const [avisoFoto, setAvisoFoto] = useState<string | null>(null);
  const [camaraNegada, setCamaraNegada] = useState(false);
  const [tomandoFoto, setTomandoFoto] = useState(false);
  const [ubicacion, setUbicacion] = useState<UbicacionVisita>({ estado: 'buscando' });
  const [error, setError] = useState<string | null>(null);
  const montada = useRef(true);

  // El motivo elegido se lee por id, activo o no: si el pull lo da de baja con la
  // pantalla abierta, la visita se guarda igual (D3, Review Focus 1).
  const motivo = useMemo(() => {
    void versionCatalogos;
    return motivoId === null ? null : datos.catalogos.obtenerMotivoVisita(motivoId);
  }, [datos, motivoId, versionCatalogos]);

  const validacion = validarVisita({
    motivo,
    observaciones,
    atendio,
    fotoUri: foto?.uri ?? null,
    ubicacion,
    direccionTexto: direccion,
  });

  // D7.1: al abrir empieza a pedir la ubicacion (10 s, nunca lanza), para que el
  // punto ya este listo al guardar.
  const buscarUbicacion = useCallback(async () => {
    setUbicacion({ estado: 'buscando' });
    const r = await obtenerUbicacion();
    if (!montada.current) return;
    setUbicacion(
      r.estado === 'ok'
        ? { estado: 'ok', lat: r.lat, lng: r.lng, precisionM: r.precisionM }
        : { estado: 'fallo', permisoNegado: r.estado === 'permiso-negado' },
    );
  }, []);

  useEffect(() => {
    montada.current = true;
    void buscarUbicacion();
    return () => {
      montada.current = false;
    };
  }, [buscarUbicacion]);

  async function tomarFoto() {
    setAvisoFoto(null);
    setTomandoFoto(true);
    try {
      const r = await capturarFoto('visita');
      if (r.estado === 'ok') {
        setFoto(r.foto);
        setCamaraNegada(false);
        if (!r.foto.objetivoAlcanzado) setAvisoFoto('La foto quedó más pesada de lo normal; va a subir igual.');
        return;
      }
      if (r.estado === 'cancelado') return;
      if (r.estado === 'permiso-negado') {
        setCamaraNegada(true);
        setAvisoFoto(
          validacion.fotoObligatoria
            ? 'Sin permiso de cámara. Este motivo exige foto: dale permiso en los ajustes para poder guardar.'
            : 'Sin permiso de cámara. La foto queda pendiente; puedes guardar sin ella.',
        );
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
    if (validacion.visita === null) return;
    try {
      datos.visitas.registrar({ vendedorId: vendedor.id, clienteId, ...validacion.visita });
      avisar('Visita registrada');
      // D7.7: regresa a la ruta del dia, donde el cliente ya sale en "Visitados sin venta".
      router.dismissTo('/(jornada)');
    } catch (e) {
      setError(e instanceof ErrorVisita || e instanceof ErrorJornada ? e.message : 'No se pudo guardar la visita.');
    }
  }

  const cliente = datos.catalogos.obtenerCliente(clienteId);
  if (!cliente) {
    return (
      <Pantalla titulo="Cliente no encontrado" subtitulo="No está en el catálogo local de esta tablet.">
        <Text style={estilos.textoSuave}>Sincroniza y vuelve a abrir su ficha.</Text>
      </Pantalla>
    );
  }

  return (
    <Pantalla titulo="Visita sin venta" subtitulo={`${cliente.nombre} · registra por qué no compró`}>
      {motivos.length === 0 ? (
        // Sin catalogo local (nunca ha sincronizado): lo dice y no deja guardar.
        <Tarjeta estado="pendiente" etiqueta="Sin catálogo de motivos">
          <Text style={estilos.textoTarjeta}>
            Los motivos bajan del portal con la sincronización. Sincroniza para poder registrar la visita.
          </Text>
        </Tarjeta>
      ) : (
        <>
          <Text style={estilos.etiqueta}>Motivo</Text>
          {motivos.map((m) => (
            <Opcion
              key={m.id}
              etiqueta={m.nombre}
              seleccionada={m.id === motivoId}
              onPress={() => setMotivoId(m.id)}
            />
          ))}

          <Campo
            etiqueta="Observaciones"
            value={observaciones}
            onChangeText={setObservaciones}
            placeholder="Lo que haya que recordar (opcional)"
            maxLength={500}
            multiline
          />

          <Campo
            etiqueta={validacion.atendioObligatorio ? 'Quién atendió (obligatorio)' : 'Quién atendió (opcional)'}
            value={atendio}
            onChangeText={setAtendio}
            placeholder="Nombre de quien atendió"
            maxLength={120}
            autoCapitalize="words"
            invalido={validacion.atendioObligatorio && atendio.trim() === ''}
          />

          <Tarjeta
            estado={foto ? 'listo' : validacion.fotoObligatoria ? 'pendiente' : 'neutro'}
            etiqueta={validacion.fotoObligatoria ? 'Foto (obligatoria)' : 'Foto (opcional)'}
          >
            {foto ? <Pastilla texto="foto tomada" estado="listo" /> : null}
            <Boton
              etiqueta={foto ? 'Volver a tomar' : 'Tomar foto'}
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

          <Tarjeta
            estado={ubicacion.estado === 'ok' ? 'listo' : ubicacion.estado === 'fallo' ? 'pendiente' : 'neutro'}
            etiqueta="Ubicación"
          >
            <Pastilla
              texto={textoUbicacionVisita(ubicacion)}
              estado={ubicacion.estado === 'ok' ? 'listo' : ubicacion.estado === 'fallo' ? 'pendiente' : 'neutro'}
            />
            {ubicacion.estado === 'fallo' ? (
              <Boton
                etiqueta="Volver a intentar"
                tono="neutra"
                glifo="⌖"
                ancho="ajustado"
                onPress={() => void buscarUbicacion()}
                estilo={{ marginTop: espacio.sm }}
              />
            ) : null}
            {validacion.pedirDireccion ? (
              <Campo
                etiqueta="Dirección o referencia"
                value={direccion}
                onChangeText={setDireccion}
                placeholder="Calle, número o una referencia del lugar"
                maxLength={300}
                invalido={ubicacion.estado !== 'ok' && direccion.trim() === ''}
              />
            ) : null}
          </Tarjeta>
        </>
      )}

      {validacion.faltantes.length > 0 && motivos.length > 0 ? (
        <Text style={estilos.textoSuave}>{validacion.faltantes.join(' ')}</Text>
      ) : null}
      {menu.avisoDiaCerrado ? <Text style={estilos.error}>{menu.avisoDiaCerrado}</Text> : null}
      {error ? <Text style={estilos.error}>{error}</Text> : null}

      <Boton
        etiqueta="Guardar visita"
        glifo="✓"
        deshabilitado={validacion.visita === null || !menu.operacionesHabilitadas}
        onPress={guardar}
        estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
      />
    </Pantalla>
  );
}
```

Notas para el implementador: si `Campo` no reenvía `maxLength`/`invalido` (son `TextInputProps` y una prop propia;
deberían), quita la prop que no compile. `router.dismissTo` existe en expo-router de SDK 57; si `typecheck` no lo
encuentra, usa `router.dismissAll()`: la ruta del día es la raíz del grupo `(jornada)`, así que vaciar la pila
regresa a ella.

- [ ] **Paso 2: filas de la lista (`lista-ruta.tsx`)**

1. Imports: agrega `motivoDeRechazo` y `textoUltimaVisita` a los de `@/estado/ruta-del-dia` y
   `import { textoEstadoVisitas } from '@/estado/visita';`.
2. En `FilaAtendidoFueraDeRuta`, el renglón de pastillas pasa a:
   ```tsx
        <View style={{ flexDirection: 'row', gap: espacio.xs }}>
          {fila.esProspecto ? <Pastilla texto="prospecto" estado="neutro" /> : null}
          {/* T-39 (D8): solo se le visito, sin venta. */}
          {fila.soloVisita ? <Pastilla texto="visita" estado="neutro" /> : null}
          <Pastilla texto={pastilla} estado={estado} />
        </View>
   ```
   y su `accessibilityLabel` agrega `${fila.soloVisita ? 'visita, ' : ''}` después del de prospecto.
3. Al final del archivo:
   ```tsx
/**
 * Un cliente de la ruta viva con visita hoy y sin venta ni cobro (T-39, D8):
 * nombre, motivo y hora de la ULTIMA visita, y la subida de sus visitas
 * (error > pendiente > listo). Tocarla abre la ficha, donde se le puede vender;
 * al vender regresa a la ruta con su palomita.
 */
export function FilaVisitadoSinVenta({
  fila,
  onTocar,
}: {
  fila: FilaRutaDelDia;
  onTocar: (clienteId: string) => void;
}) {
  const { t } = useTema();
  const estado = fila.visitas_estado;
  const textoEstado = estado ? textoEstadoVisitas(estado) : null;
  const linea = textoUltimaVisita(fila.ultima_visita_motivo, fila.ultima_visita_en);
  return (
    <Pressable
      onPress={() => onTocar(fila.cliente_id)}
      accessibilityRole="button"
      accessibilityLabel={`${fila.nombre}, visitado sin venta, ${linea}${textoEstado ? `, ${textoEstado}` : ''}`}
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
        },
        pressed && { opacity: 0.6 },
      ]}
    >
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
          {linea}
        </Text>
        {estado === 'error' && fila.visita_error ? (
          <Text numberOfLines={2} style={{ fontFamily: fuente.cuerpo, fontSize: t(tipo.cuerpo), color: colores.error }}>
            {motivoDeRechazo(fila.visita_error)}
          </Text>
        ) : null}
      </View>
      {estado && textoEstado ? <Pastilla texto={textoEstado} estado={estado} /> : null}
    </Pressable>
  );
}
   ```
   (Si `colores.error` no existe en `tokens.ts`, usa el color que ya usa `estilos.error`.)

- [ ] **Paso 3: la ruta del día (`index.tsx`)**

1. Import `FilaVisitadoSinVenta` de `@/ui/lista-ruta`.
2. Fuera del ternario de `sinRuta` (después de su cierre `)}`) y antes del bloque "Fuera de ruta":
   ```tsx
        {/* T-39 (D8): despues de la lista y antes de "Fuera de ruta". */}
        {visitadosSinVenta.length > 0 ? (
          <View style={{ gap: espacio.sm, marginTop: espacio.lg }}>
            <Text style={estilos.seccion}>Visitados sin venta</Text>
            {visitadosSinVenta.map((fila) => (
              <FilaVisitadoSinVenta key={fila.id} fila={fila} onTocar={abrirCliente} />
            ))}
          </View>
        ) : null}
   ```
3. El comentario de `pendientes` dice "Suma las seis fuentes del push (T-37, T-39)".

- [ ] **Paso 4: la ficha (`[clienteId]/index.tsx`)**

1. Imports: `useEffect` de `react`; `formatearHora` de `@/ui/momento`; `estadoSubida` de `@/estado/ruta-del-dia`;
   `pastillaVisita` de `@/estado/visita`; `fotoParaFicha` de `@/fotos/descarga`; `rutaCacheFotoCliente` de
   `@/fotos/expo`.
2. `const { ultimaSincronizacion, descargarFotoCliente } = useSesion();`
3. En el `useMemo` de `hoy`, agrega `visitas: datos.visitas.delDia(clienteId),`.
4. Mueve `const cliente = datos.catalogos.obtenerCliente(clienteId);` **antes** de los hooks nuevos y agrega, todavía
   antes del `if (!cliente)` (los hooks no pueden ir después de un `return`):
   ```tsx
  // T-39 (D9): la foto del servidor. La de ESTA tablet gana; si no, la copia en
  // cache, y si falta o es mas vieja que `foto_subida_en` se baja UNA vez por
  // apertura. Sin red sigue diciendo "sin foto", como antes.
  const fotoLocal = cliente ? datos.prospectos.fotoLocalDe(cliente) : null;
  const decision = fotoParaFicha({
    fotoLocal,
    fotoSubidaEn: cliente?.foto_subida_en ?? null,
    cacheSubidaEn: cliente?.foto_cache_subida_en ?? null,
    uriCache: rutaCacheFotoCliente(clienteId),
  });
  const [fotoBajada, setFotoBajada] = useState<string | null>(null);
  const subidaEnServidor = cliente?.foto_subida_en ?? null;
  useEffect(() => {
    if (!decision.descargar || subidaEnServidor === null) return;
    let vigente = true;
    void descargarFotoCliente(clienteId, subidaEnServidor).then((uri) => {
      if (vigente && uri) setFotoBajada(uri);
    });
    return () => {
      vigente = false;
    };
  }, [clienteId, subidaEnServidor, decision.descargar, descargarFotoCliente]);
   ```
   y reemplaza `const foto = datos.prospectos.fotoLocalDe(cliente);` (y su comentario "D8: solo la foto que tomo ESTA
   tablet…") por `const foto = fotoBajada ?? decision.uri;`.
5. El botón Visita:
   ```tsx
        <BotonMenu
          titulo="Visita"
          descripcion="Visita sin venta: por qué no compró, con hora y ubicación"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/visita-sin-venta', params }}
          deshabilitado={!menu.operacionesHabilitadas}
        />
   ```
6. Junto a `estadoVentas`, calcula el de las visitas (mismo patrón):
   ```tsx
  // Lo mas grave manda, como en "Ventas de hoy" (T-39, D8).
  const estadoVisitas: Estado = estadoSubida(hoy.visitas.map((v) => v.sync_estado)) ?? 'neutro';
   ```
   y, después de la tarjeta "Ventas de hoy":
   ```tsx
      {/* T-39 (D8): cada visita con su motivo, hora y subida. La rechazada trae su motivo. */}
      <Tarjeta estado={estadoVisitas} etiqueta="Visitas de hoy">
        {hoy.visitas.length === 0 ? (
          <Text style={estilos.textoSuave}>Sin visitas registradas hoy.</Text>
        ) : (
          hoy.visitas.map((v) => {
            const p = pastillaVisita(v);
            return (
              <View key={v.id} style={{ gap: espacio.xs, marginBottom: espacio.sm }}>
                <Text style={estilos.textoTarjeta}>
                  {v.motivo_nombre} · <Cifra valor={formatearHora(v.visitada_en)} />
                </Text>
                <Pastilla texto={p.texto} estado={p.estado} />
                {p.detalle ? <Text style={estilos.error}>{p.detalle}</Text> : null}
              </View>
            );
          })
        )}
      </Tarjeta>
   ```

- [ ] **Paso 5: typecheck, lint, pruebas y commit**

```bash
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm test --workspace=apps/tablet
git add apps/tablet
git commit -m "T-39: tablet, pantalla Visita sin venta, sección Visitados sin venta y Visitas de hoy en la ficha

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 12: Documentación del repo (CLAUDE.md, README de la tablet)

**Files:**
- Modify: `CLAUDE.md` (bloque nuevo después del de Tesorería T-28; una línea en el de Ruta diaria T-37)
- Modify: `apps/tablet/README.md`
- Modify: `docs/superpowers/specs/2026-10-18-t-39-visita-sin-venta-design.md` (solo si la ejecución cambió algo:
  anota la enmienda bajo "Decisiones")

**Interfaces:**
- Consumes: todo lo anterior. No produce código.

- [ ] **Paso 1: `CLAUDE.md`**

1. En el bloque de Ruta diaria (T-37), cambia "(no `ruta`, que queda para la visita de T-39)" por "(no `ruta`, que
   sigue reservado; la visita de T-39 es `visita`)".
2. Después del bloque de Tesorería (T-28), agrega:

```markdown
- **Visita sin venta (T-39).** El vendedor deja constancia, sin red, de por qué un cliente no compró: motivo del
  catálogo, hora, quién atendió, ubicación (GPS o dirección escrita) y foto si el motivo la exige. Spec:
  `docs/superpowers/specs/2026-10-18-t-39-visita-sin-venta-design.md`. Absorbe T-78 (#129).
  - **Catálogo `motivo_visita`** global (como `tipo_negocio`), con `exige_foto`/`exige_atendio`, baja lógica y nombre
    único entre vivos (`uq_motivo_visita_nombre`). Sus tiempos se llaman `creado_en`/`actualizado_en`; un trigger
    `set_actualizado_en()` mueve el segundo. Portal: *Catálogo → Motivos de visita* (`rutas/motivos-visita.*`,
    `/motivos-visita`, permiso `motivo-visita.gestionar`, grupo Catálogo). Baja en el pull como `motivos_visita`.
  - **Operación `visita`** en el push (no `ruta`), sin subir `CONTRATO_ACTUAL`. La clave **es** `visita.id` (uuid,
    como el prospecto de T-75); `cliente_id` va en el sobre. `prepararVisita` valida la forma (ubicación obligatoria)
    y `rutas/visitas.service.ts` proyecta. Rechazos nuevos: `motivo-visita-inexistente` (uno **dado de baja sí
    entra**) y `visita-id-ocupado` (motivo neutro). **El servidor no revisa "exige foto/nombre"**: lo exige la tablet
    (`src/estado/visita.ts`, `validarVisita`).
  - **Orden del push**: `jornadas → prospectos → ventas → cobranzas → visitas → rutas` (`fuentesDelPush`, con prueba).
  - **Fotos**: `POST /sync/foto/:clave` acepta prospectos y visitas; los archivos nuevos se llaman `cliente-<id>.jpg`
    y `visita-<id>.jpg` (T-78; los viejos `<clave>.jpg` no se migran, siempre se lee `foto_archivo`).
    `GET /sync/foto/cliente/:clienteId` (`@SoloApp`) baja la foto del cliente de la sucursal del vendedor (404 si no
    tiene o no es suya); la ficha de la tablet la cachea por `cliente.foto_subida_en`, que ahora baja en el pull.
  - **Tablet** (migración local 013): `motivo_visita`, `visita` (foto con el mismo esquema derivado que la del
    prospecto) y `cliente.foto_subida_en`/`foto_cache_subida_en`. El cliente de la ruta visitado sin venta pasa a
    **"Visitados sin venta"**; si después compra, regresa a la ruta con su palomita (atendido gana a visitado). La
    lógica vive en `src/estado/ruta-del-dia.ts` y `src/estado/visita.ts`, con pruebas. Sin pantalla de visitas en el
    portal (T-55 y reportes leen la tabla `visita`).
```

- [ ] **Paso 2: `apps/tablet/README.md`**

1. En "Ruta del día y pantalla principal (T-37)", la viñeta de "Visitado" pasa a: "**"Visitado" se deriva** (venta,
   cobro **o visita** de hoy en la tablet; T-39) …". Agrega una viñeta: "**"Visitados sin venta"** (T-39): el
   cliente de la ruta viva con visita hoy y sin venta ni cobro sale de la lista y aparece después de ella, con el
   motivo y la hora de la última visita y la subida de sus visitas (`agruparRuta`)."
2. Sección nueva después de la de Prospectos (T-75):

```markdown
## Visita sin venta (T-39)

Spec: `docs/superpowers/specs/2026-10-18-t-39-visita-sin-venta-design.md`.

- **Pantalla** `app/(jornada)/operacion/[clienteId]/visita-sin-venta.tsx` (botón *Visita* de la ficha): motivo del
  catálogo local (`motivo_visita`, baja en el pull), observaciones, quién atendió, foto (`capturarFoto('visita')`,
  300 KB) y ubicación (`obtenerUbicacion` al abrir; sin GPS pide "Dirección o referencia"). Toda la validación es
  `validarVisita` (`src/estado/visita.ts`, con pruebas). Guarda sin red y regresa a la ruta con "Visita registrada".
- **Datos** (migración 013, `src/datos/repositorios/visitas.ts`): la visita nace `pendiente` y sube como `visita`
  (`src/sincronizacion/fuente-visitas.ts`) después de cobranzas. Un motivo dado de baja después de elegirlo se guarda
  y sube igual. Con el día cerrado no se registra.
- **Foto**: sube por el canal de fotos cuando la visita ya está sincronizada; la cola junta prospectos y visitas
  (`combinarFuentesFotos`). Una foto que falla no toca la visita.
- **Ficha**: tarjeta "Visitas de hoy" (motivo, hora, pastilla; la rechazada con su motivo). La foto del cliente se
  baja del servidor cuando la tablet no la tiene o la tiene más vieja que `foto_subida_en`
  (`src/fotos/descarga.ts`, cache en documentos por id); sin red, "sin foto" como antes.
- **"Atendidos fuera de ruta"** incluye a los visitados que no están en la ruta de hoy, con la etiqueta "visita".
```

3. En "Pendiente (otros tickets)", quita `T-39` y "visita sin venta" de la lista de placeholders.

- [ ] **Paso 3: commit**

```bash
git add CLAUDE.md apps/tablet/README.md docs/superpowers/specs/2026-10-18-t-39-visita-sin-venta-design.md
git commit -m "T-39: documentación (CLAUDE.md, README de la tablet)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Conflictos para el controlador

- **PR #135 (menú lateral)** toca `app/(jornada)/index.tsx`, igual que las Tareas 9 y 11. Si #135 se mergea antes,
  trae `main` a la rama antes de la Tarea 9; si no, lo resuelve quien mergee después (spec, "Conflicto previsible").
- **Supabase local compartido.** La Tarea 1 aplica una migración con `migration up --local` y regenera `schema.d.ts`.
  Si otra sesión dejó migraciones de otra rama aplicadas, `db:types` las arrastra: hay que quedarse solo con lo de
  T-39 en el diff. Nunca `db reset`, nunca nada contra `sinmex dev`.
- **El push de la migración a la nube** lo hace quien mergee (protocolo de `CLAUDE.md`), no esta rama. Son tablas
  nuevas y un permiso: el pre-flight no tiene filas que contar, pero el `migration list` antes/después va igual al PR.
- **T-78 (#129)** se cierra con el commit de la Tarea 5 (o en el cuerpo del PR, si se prefiere no cerrarlo desde un
  commit de rama).
- **Vault** (`[[Rutas]]`, `[[Ruta]]`, `[[App Tablet]]`, ADR-0009 —la nota de que `ruta` estaba reservado para la
  visita—, Estado del proyecto y bitácora): lo actualiza el controlador tras la revisión final, no un subagente.
- **Aceptación manual en el emulador** (spec, "Pruebas"): visita "Cerrado" sin red con foto → "Visitados sin venta"
  → sincronizar y comprobar en Postgres local la fila de `visita` y el archivo `visita-<id>.jpg` → venderle y que
  regrese a la ruta → visita con la ubicación negada, que exige la dirección. La hace el controlador, con capturas.

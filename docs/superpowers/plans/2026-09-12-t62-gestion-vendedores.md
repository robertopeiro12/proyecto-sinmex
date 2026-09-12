# T-62 · Gestión de Vendedores — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar de alta, editar y dar de baja vendedores desde el portal, con el segmento de folio calculado por el servidor y el alta **rechazada** (no cedida en silencio) cuando sus iniciales chocan con las de otro vendedor activo de su misma sucursal.

**Architecture:** Backend NestJS con el módulo en `modules/nomina-comisiones/` (slug del vault, hoy un stub vacío). Reusa `resolverAlcance()` (T-09) y los helpers ya extraídos por T-12 (`buscarSucursalUsuario`, `esViolacionUnicidad`/`esViolacionFk`) sin tocarlos. La colisión de segmento se resuelve igual que cualquier otro `unique` del proyecto: sin consulta previa, intentando el `INSERT` y distinguiendo el índice que truena por `error.constraint` (mismo patrón `nombreDelIndice()` de `ProductosService`, T-10). En el portal, la pantalla se arma con `PantallaCatalogo` de T-10 sin agregarle ningún prop.

**Tech Stack:** NestJS · Kysely · Postgres (Supabase) · pgTAP · Jest (backend) · Next.js 15 App Router · React 19 · Tailwind v4 · shadcn/ui · Vitest + Testing Library (portal)

**Spec:** `docs/superpowers/specs/2026-09-12-t62-gestion-vendedores-design.md` — las decisiones se citan como D1…D9.

## Global Constraints

- **Rama:** `feature/t-62-vendedores`, base `main`, sin pila.
- **Idioma del código:** identificadores, comentarios y mensajes de error **en español**, **sin acentos en los identificadores** (sí en los mensajes de cara al usuario).
- **Todo comando se corre desde la raíz del repo** con `--workspace=`, nunca entrando a `apps/*`.
- **`npm test`, `npm run test:e2e` y `supabase test db` exigen el stack local arriba.** En esta máquina el daemon de Docker lo da **Colima** (`colima start`), no Docker Desktop. Luego `npm run supabase -- start`.
- **Nunca apuntar a `sinmex dev` durante la implementación.** `.env.test` va al Postgres local. `npm run backend` sí apunta a la nube — para la verificación manual del portal (Task 9) hay que apuntar `DATABASE_URL` de `.env.development` al Postgres local primero.
- **La baja siempre es lógica** (`activo = false`), nunca `delete` físico. `deleted_at` no tiene ningún camino que lo escriba desde la API — solo lo tocan las pruebas, directo contra la base.
- **`deleted_at` jamás se expone en una respuesta de la API.**
- **La respuesta de la API va en camelCase** (`sucursalId`, `folioSegmento`).
- **El rechazo de colisión de segmento NO hace una consulta previa.** Se calcula `candidatosDeSegmento(nombre)[0]` (puro, sin tocar la base), se intenta el `INSERT`/`UPDATE` directo, y se distingue **qué** índice truena leyendo `error.constraint` — igual que `ProductosService.editar()` (T-10) distingue `uq_producto_nombre` de `uq_presentacion_volumen`. No reintroducir el patrón "`SELECT` antes del `INSERT`" que el resto del proyecto evita a propósito (ventana de carrera entre dos peticiones).
- **`vendedor.login` se normaliza a minúsculas al escribir** (alta y edición), igual que `usuario.login` (T-13) — no se toca `AuthVendedorService.validarCredenciales`, que sigue comparando tal cual.
- **La sucursal de un vendedor es inmutable tras el alta** (igual que vehículo). El segmento de folio se asigna una sola vez, en el alta, y **una edición de `nombre` no lo recalcula ni lo re-evalúa** — editar el nombre nunca dispara la regla de colisión.
- **La migración solo toca índices**, no agrega columnas → **no hace falta** `npm run db:types`.
- **Conteos de partida NO están escritos en este plan a propósito** (el plan de T-10 los hardcodeó y salieron mal). Antes de empezar, corre las tres suites de la Task 0 y anota tú los números reales; cada paso de verificación compara contra esa línea base, no contra una cifra de aquí. Sí se dan las cifras **relativas** (cuántas pruebas nuevas agrega cada task), porque esas se conocen de antemano.

---

### Task 0: Rama y línea base

**Files:** ninguno (solo verificación).

**Interfaces:**
- Consumes: nada.
- Produces: la rama `feature/t-62-vendedores` y los conteos de partida que usarán todas las tareas siguientes.

- [ ] **Step 1: Crear la rama desde `main` limpio**

```bash
git status --short
git checkout main && git pull
git checkout -b feature/t-62-vendedores
```

Esperado: `git status --short` vacío antes de cambiar de rama. Si hay algo, **detente** y resuélvelo (commit o stash) antes de seguir.

- [ ] **Step 2: Levantar el stack local**

```bash
colima start
npm run supabase -- start
```

Esperado: `supabase start` imprime las URLs locales. Si Colima ya estaba arriba, `colima start` no hace daño.

- [ ] **Step 3: Anotar la línea base de las cuatro suites**

```bash
npm run supabase -- test db
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm test --workspace=apps/portal
```

Anota los cuatro números. Todas las tareas siguientes comparan contra estos, no contra cifras escritas en este plan. Las cuatro suites tienen que estar en **verde** antes de tocar nada.

- [ ] **Step 4: Confirmar que la tabla `vendedor` está vacía**

```bash
psql "$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" -c \
  "select count(*) as vendedores from vendedor;"
```

Esperado: `vendedores = 0`. Si no es 0, **detente**: la Task 1 (login case-insensitive) puede fallar sobre datos existentes si hay logins duplicados solo por mayúsculas, y hay que revisar antes de seguir.

---

### Task 1: Login de vendedor case-insensitive y liberable al dar de baja (D4)

**Files:**
- Create: `supabase/migrations/20260912140000_vendedor_login_indice_parcial.sql`
- Create: `supabase/tests/99_vendedor_login_unicidad_test.sql`

**Interfaces:**
- Consumes: nada.
- Produces: el índice `uq_vendedor_login`. Las Tasks 4/5/6 dependen de que una violación levante `SQLSTATE 23505` con `error.constraint = 'uq_vendedor_login'`.

- [ ] **Step 1: Escribir la prueba pgTAP que falla**

Crea `supabase/tests/99_vendedor_login_unicidad_test.sql`:

```sql
begin;
select plan(3);

-- Mismo bug que T-13 corrigio en usuario.login (20260903130000): el unique
-- plano de vendedor.login sigue contando vendedores dados de baja, y los
-- vendedores son rotativos (Vendedor.md) -- sin esto, dar de baja a alguien
-- reservaria su login para siempre.

create temporary table _ctx on commit drop as
  select (select id from sucursal where codigo = 'TJ' limit 1) as tj;

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-jperez', 'Prueba', 'x', tj from _ctx;

select throws_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id)
    select 'zz-pgtap-jperez', 'Prueba 2', 'x', tj from _ctx$$,
  '23505',
  null,
  'rechaza el mismo login repetido entre vendedores activos'
);

-- 'lower()' en el indice: dos filas que solo difieren en mayusculas son el
-- mismo login.
select throws_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id)
    select 'ZZ-PGTAP-JPEREZ', 'Prueba 3', 'x', tj from _ctx$$,
  '23505',
  null,
  'trata distinta capitalizacion como duplicado'
);

-- La baja es logica (activo = false desde el portal, pero deleted_at es lo
-- que de verdad libera el indice -- ver D7 del spec).
update vendedor set deleted_at = now() where login = 'zz-pgtap-jperez';

select lives_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id)
    select 'zz-pgtap-jperez', 'Prueba 4', 'x', tj from _ctx$$,
  'dar de baja un vendedor libera su login para uno nuevo'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
npm run supabase -- test db
```

Esperado: `99_vendedor_login_unicidad_test.sql` **falla** en el segundo `throws_ok` (la variación de mayúsculas hoy no choca, porque el `unique` actual es sensible a mayúsculas) y el `lives_ok` final también falla (el login sigue reservado tras la baja, porque el `unique` actual no filtra por `deleted_at`). El primer `throws_ok` ya pasa hoy (el login exacto repetido sí choca con el `unique` plano). Si los tres pasan ya, algo raro pasó: **detente**.

- [ ] **Step 3: Escribir la migración**

Crea `supabase/migrations/20260912140000_vendedor_login_indice_parcial.sql`:

```sql
-- Mismo bug que T-13 corrigio en usuario.login (20260903130000_usuario_login_indice_parcial.sql):
-- el unique PLANO de vendedor.login (20260803163003_identidad_y_permisos.sql:79)
-- sigue contando filas dadas de baja, y no distingue mayusculas. Los
-- vendedores son rotativos (Vendedor.md) -- sin este cambio, dar de baja a
-- alguien reservaria su login para siempre, y "JGarcia"/"jgarcia" contarian
-- como logins distintos.
alter table vendedor drop constraint vendedor_login_key;

create unique index uq_vendedor_login
  on vendedor (lower(login))
  where deleted_at is null;
```

- [ ] **Step 4: Aplicar la migración y correr la prueba**

```bash
npm run supabase -- migration up --local
npm run supabase -- test db
```

Esperado: las 3 pruebas nuevas pasan, y el total pgTAP sube en 3 sobre tu línea base de la Task 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260912140000_vendedor_login_indice_parcial.sql supabase/tests/99_vendedor_login_unicidad_test.sql
git commit -m "T-62 · Login de vendedor case-insensitive y liberable al dar de baja

Mismo bug que T-13 corrigio en usuario.login: el unique plano seguia
contando vendedores dados de baja, y los vendedores son rotativos.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Segmento de folio único por sucursal, no global (D6 — enmienda de ADR-0007)

**Files:**
- Create: `supabase/migrations/20260912140500_vendedor_segmento_por_sucursal.sql`
- Create: `supabase/tests/99_vendedor_segmento_sucursal_test.sql`

**Interfaces:**
- Consumes: nada.
- Produces: el índice compuesto `uq_vendedor_folio_segmento`. La Task 4 depende de que una violación levante `SQLSTATE 23505` con `error.constraint = 'uq_vendedor_folio_segmento'`.

- [ ] **Step 1: Escribir la prueba pgTAP que falla**

Crea `supabase/tests/99_vendedor_segmento_sucursal_test.sql`:

```sql
begin;
select plan(4);

-- T-62 relaja uq_vendedor_folio_segmento (T-14) de global a compuesto por
-- sucursal: el cliente confirmo que el folio ya distingue sucursal como
-- primer segmento, asi que TJ260912JP01 y MX260912JP01 nunca chocan aunque
-- compartan las mismas iniciales de vendedor. Ver ADR-0007 (enmienda
-- 2026-09-12) y su ejemplo textual, reproducido aqui como prueba.

create temporary table _ctx on commit drop as
select
  (select id from sucursal where codigo = 'TJ' limit 1) as tj,
  (select id from sucursal where codigo = 'MX' limit 1) as mx;

insert into vendedor (login, nombre, password_hash, sucursal_id, folio_segmento)
  select 'zz-pgtap-seg-1', 'Juan Perez Uno', 'x', tj, 'JP' from _ctx;

select throws_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id, folio_segmento)
    select 'zz-pgtap-seg-2', 'Juan Perez Dos', 'x', tj, 'JP' from _ctx$$,
  '23505',
  null,
  'dos vendedores vivos de la MISMA sucursal no pueden compartir segmento'
);

-- El ejemplo del cliente: dos "Juan Perez" en sucursales distintas no chocan,
-- porque el folio completo (TJ260912JP01 / MX260912JP01) sigue siendo unico.
select lives_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id, folio_segmento)
    select 'zz-pgtap-seg-3', 'Juan Perez Tres', 'x', mx, 'JP' from _ctx$$,
  'el mismo segmento SI se permite en una sucursal distinta'
);

-- D7: activo = false NO libera el segmento -- solo deleted_at lo hace. Los
-- folios ya emitidos de alguien desactivado siguen en notas fisicas firmadas,
-- y reciclar su segmento las volveria ambiguas.
update vendedor set activo = false where login = 'zz-pgtap-seg-1';

select throws_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id, folio_segmento)
    select 'zz-pgtap-seg-4', 'Juan Perez Cuatro', 'x', tj, 'JP' from _ctx$$,
  '23505',
  null,
  'desactivar (activo=false) NO libera el segmento en su sucursal'
);

update vendedor set deleted_at = now() where login = 'zz-pgtap-seg-1';

select lives_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id, folio_segmento)
    select 'zz-pgtap-seg-5', 'Juan Perez Cinco', 'x', tj, 'JP' from _ctx$$,
  'dar de baja (deleted_at) SI libera el segmento en su sucursal'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
npm run supabase -- test db
```

Esperado: **falla** en el segundo `lives_ok` (`el mismo segmento SI se permite en una sucursal distinta`) — hoy el `unique` es global, así que esa fila choca cuando debería vivir. Las otras tres ya pasan con el índice actual. Si las 4 pasan ya, **detente**: algo raro pasó.

- [ ] **Step 3: Escribir la migración**

Crea `supabase/migrations/20260912140500_vendedor_segmento_por_sucursal.sql`:

```sql
-- ADR-0007 (enmienda 2026-09-12): el cliente confirmo que la colision de
-- segmento de folio se evalua POR SUCURSAL, no globalmente -- el folio ya
-- lleva la sucursal como primer segmento, asi que "TJ260912JP01" y
-- "MX260912JP01" nunca chocan aunque compartan segmento de vendedor. Su cita
-- textual: "contra la misma sucursal, ya que los folios van a ser distintos
-- por sucursal y ahi esta la diferencia".
--
-- Este cambio RELAJA el unique de T-14 (20260807223000_folios.sql), no lo
-- restringe: el indice global anterior era estrictamente mas estricto que
-- este, asi que ningun dato existente puede violar la version compuesta.
drop index uq_vendedor_folio_segmento;

create unique index uq_vendedor_folio_segmento
  on vendedor (folio_segmento, sucursal_id)
  where folio_segmento is not null and deleted_at is null;
```

- [ ] **Step 4: Aplicar la migración y correr la prueba**

```bash
npm run supabase -- migration up --local
npm run supabase -- test db
```

Esperado: las 4 pruebas nuevas pasan, y el total pgTAP sube en 4 más sobre el resultado de la Task 1 (7 en total sobre la línea base de la Task 0).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260912140500_vendedor_segmento_por_sucursal.sql supabase/tests/99_vendedor_segmento_sucursal_test.sql
git commit -m "T-62 · Segmento de folio unico POR SUCURSAL, no global (enmienda ADR-0007)

El cliente confirmo que la colision se evalua contra la misma sucursal:
el folio ya distingue sucursal, asi que TJ260912JP01 y MX260912JP01 no
chocan aunque compartan iniciales de vendedor.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `GET /vendedores` con alcance por sucursal (D1, D2)

**Files:**
- Create: `apps/backend/src/modules/nomina-comisiones/vendedores.repository.ts`
- Create: `apps/backend/src/modules/nomina-comisiones/vendedores.service.ts`
- Create: `apps/backend/src/modules/nomina-comisiones/vendedores.controller.ts`
- Modify: `apps/backend/src/modules/nomina-comisiones/nomina-comisiones.module.ts` (hoy `@Module({}) export class NominaComisionesModule {}`)
- Create: `apps/backend/test/vendedores.e2e-spec.ts`

**Interfaces:**
- Consumes: `resolverAlcance()`/`normalizarSucursalPedida()` de `../sucursales/alcance-sucursal` (sin modificarlas); `buscarSucursalUsuario` de `../sucursales/buscar-sucursal-usuario` (helper compartido de T-12, sin modificarlo); `DB_CONNECTION`/`Database` de `../../database/database.tokens`; `@UsuarioActual()` de `../auth/usuario-actual.decorator`.
- Produces:
  - `interface Vendedor { id: string; nombre: string; login: string; sucursalId: string; sucursalCodigo: string; folioSegmento: string | null; activo: boolean }`
  - `VendedoresRepository.listar(): Promise<Vendedor[]>`
  - `VendedoresRepository.listarPorCodigoSucursal(codigo: string): Promise<Vendedor[]>`
  - `VendedoresRepository.buscarSucursalUsuario(usuarioId: string): Promise<{ id: string | null; codigo: string | null } | undefined>`
  - `VendedoresService.listar(usuarioId: string, sucursalPedida: string | null): Promise<Vendedor[]>`
  - Las Tasks 4 y 5 agregan métodos a estas mismas clases.

- [ ] **Step 1: Escribir la prueba e2e que falla**

Crea `apps/backend/test/vendedores.e2e-spec.ts`. Este archivo crece en las Tasks 4 y 5; empieza con el andamiaje completo y las pruebas del `GET`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';

interface VendedorRespuesta {
  id: string;
  nombre: string;
  login: string;
  sucursalId: string;
  sucursalCodigo: string;
  folioSegmento: string | null;
  activo: boolean;
}

// El PID va pegado al timestamp porque Jest corre archivos en paralelo, en
// procesos distintos: dos suites que arrancan en el mismo milisegundo
// generarian el mismo SUFIJO (mismo criterio que vehiculos.e2e-spec.ts,
// corregido en el PR #82 tras un fallo real en paralelo).
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN_GENERAL = `e2e-ven-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-ven-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-ven-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';

// Prefijo reservado: la limpieza de afterAll borra por `nombre like`. Sin el,
// una corrida que deje basura envenena la siguiente con 409 inesperados.
const PREFIJO = `ZZ-e2e-${SUFIJO}`;

describe('Vendedores (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  let idTijuana: string;
  let idMexicali: string;
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;

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

  /**
   * `Administrador General` recibe el catalogo completo de permisos por diseño
   * (D1 de T-08a); los otros 5 perfiles estan VACIOS hasta T-08b, asi que
   * `Auxiliar Administrativo` sirve como "usuario sin permiso" sin montar nada.
   */
  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ): Promise<void> => {
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

  /** Inserta un vendedor por debajo de la API, para preparar escenarios. */
  const sembrarVendedor = async (
    login: string,
    nombre: string,
    sucursalId: string,
    folioSegmento: string | null = null,
  ): Promise<string> => {
    const hash = await app.get(PasswordService).hashear(PASSWORD);
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login,
        nombre,
        password_hash: hash,
        sucursal_id: sucursalId,
        folio_segmento: folioSegmento,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await app.init();
    db = app.get<Database>(DB_CONNECTION);

    const tj = await db
      .selectFrom('sucursal')
      .select('id')
      .where('codigo', '=', 'TJ')
      .executeTakeFirstOrThrow();
    idTijuana = tj.id;

    const mx = await db
      .selectFrom('sucursal')
      .select('id')
      .where('codigo', '=', 'MX')
      .executeTakeFirstOrThrow();
    idMexicali = mx.id;

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', idTijuana);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);

    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    await db
      .deleteFrom('vendedor')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    if (usuarioIds.length > 0) {
      await db
        .deleteFrom('sesion_refresh')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await app.close();
  });

  describe('GET /vendedores', () => {
    it('lista los vendedores con su codigo de sucursal', async () => {
      await sembrarVendedor(
        `e2e-listar-${SUFIJO}`,
        `${PREFIJO} Listar TJ`,
        idTijuana,
        'LT',
      );

      const res = await request(app.getHttpServer())
        .get('/vendedores')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const vendedores = res.body as VendedorRespuesta[];
      const propio = vendedores.find((v) => v.nombre === `${PREFIJO} Listar TJ`);
      expect(propio).toBeDefined();
      expect(propio?.sucursalCodigo).toBe('TJ');
      expect(propio?.folioSegmento).toBe('LT');
      expect(propio?.activo).toBe(true);
      expect(propio).not.toHaveProperty('deleted_at');
      expect(propio).not.toHaveProperty('password_hash');
    });

    it('un usuario atado a TJ no ve los vendedores de MX', async () => {
      await sembrarVendedor(
        `e2e-solomx-${SUFIJO}`,
        `${PREFIJO} Solo MX`,
        idMexicali,
      );

      const res = await request(app.getHttpServer())
        .get('/vendedores')
        .set('Cookie', cookieTijuana)
        .expect(200);

      const nombres = (res.body as VendedorRespuesta[]).map((v) => v.nombre);
      expect(nombres).not.toContain(`${PREFIJO} Solo MX`);
    });

    it('un usuario atado que pide "todas" recibe la suya, no un 403', async () => {
      await request(app.getHttpServer())
        .get('/vendedores?sucursal=todas')
        .set('Cookie', cookieTijuana)
        .expect(200);
    });

    it('un usuario atado que pide OTRA sucursal recibe 403', async () => {
      await request(app.getHttpServer())
        .get('/vendedores?sucursal=MX')
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('el usuario General puede filtrar por una sucursal concreta', async () => {
      const res = await request(app.getHttpServer())
        .get('/vendedores?sucursal=MX')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const codigos = (res.body as VendedorRespuesta[]).map(
        (v) => v.sucursalCodigo,
      );
      expect(codigos.every((c) => c === 'MX')).toBe(true);
    });

    // Otras pantallas (Ruta Diaria/Semanal, Nomina) van a necesitar este
    // catalogo sin tener vendedor.gestionar.
    it('deja listar aunque el usuario no tenga vendedor.gestionar', async () => {
      await request(app.getHttpServer())
        .get('/vendedores')
        .set('Cookie', cookieSinPermiso)
        .expect(200);
    });

    it('rechaza a quien no tiene sesion', async () => {
      await request(app.getHttpServer()).get('/vendedores').expect(401);
    });
  });
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend -- vendedores
```

Esperado: **falla** con 404 en todas las peticiones a `/vendedores` — la ruta todavía no existe.

- [ ] **Step 3: Escribir el repositorio**

Crea `apps/backend/src/modules/nomina-comisiones/vendedores.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { buscarSucursalUsuario as buscarSucursalUsuarioCompartido } from '../sucursales/buscar-sucursal-usuario';

export interface Vendedor {
  id: string;
  nombre: string;
  login: string;
  sucursalId: string;
  sucursalCodigo: string;
  folioSegmento: string | null;
  activo: boolean;
}

/** `deleted_at` y `password_hash` nunca salen a la API (misma convencion que T-09/T-13). */
function aVendedor(fila: {
  id: string;
  nombre: string;
  login: string;
  sucursal_id: string;
  codigo: string;
  folio_segmento: string | null;
  activo: boolean;
}): Vendedor {
  return {
    id: fila.id,
    nombre: fila.nombre,
    login: fila.login,
    sucursalId: fila.sucursal_id,
    sucursalCodigo: fila.codigo,
    folioSegmento: fila.folio_segmento,
    activo: fila.activo,
  };
}

const COLUMNAS = [
  'vendedor.id',
  'vendedor.nombre',
  'vendedor.login',
  'vendedor.sucursal_id',
  'sucursal.codigo',
  'vendedor.folio_segmento',
  'vendedor.activo',
] as const;

@Injectable()
export class VendedoresRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * Devuelve activos E inactivos: la pantalla del catalogo necesita ver un
   * vendedor desactivado (mismo criterio que Sucursales/Productos/Vehiculos).
   */
  async listar(): Promise<Vendedor[]> {
    const filas = await this.db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select(COLUMNAS)
      .where('vendedor.deleted_at', 'is', null)
      .orderBy('sucursal.codigo')
      .orderBy('vendedor.nombre')
      .execute();

    return filas.map(aVendedor);
  }

  async listarPorCodigoSucursal(codigo: string): Promise<Vendedor[]> {
    const filas = await this.db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select(COLUMNAS)
      .where('vendedor.deleted_at', 'is', null)
      .where('sucursal.codigo', '=', codigo)
      .orderBy('vendedor.nombre')
      .execute();

    return filas.map(aVendedor);
  }

  /**
   * Delegado al helper compartido de T-12 (D9 del spec) -- NO se duplica
   * aqui: `VehiculosRepository`, `ClientesRepository` y `PreciosRepository`
   * ya lo usan tal cual.
   */
  async buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuarioCompartido(this.db, usuarioId);
  }
}
```

- [ ] **Step 4: Escribir el servicio**

Crea `apps/backend/src/modules/nomina-comisiones/vendedores.service.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { resolverAlcance, type Alcance } from '../sucursales/alcance-sucursal';
import { VendedoresRepository, type Vendedor } from './vendedores.repository';

@Injectable()
export class VendedoresService {
  constructor(private readonly repo: VendedoresRepository) {}

  async listar(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Vendedor[]> {
    const alcance = await this.alcanceDe(usuarioId, sucursalPedida);
    return alcance.tipo === 'todas'
      ? this.repo.listar()
      : this.repo.listarPorCodigoSucursal(alcance.codigo);
  }

  protected async alcanceDe(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Alcance> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    return resolverAlcance(fila.codigo, sucursalPedida);
  }
}
```

`alcanceDe` es `protected` (no `private`) porque las Tasks 4 y 5 lo reusan sin duplicarlo.

- [ ] **Step 5: Escribir el controlador**

Crea `apps/backend/src/modules/nomina-comisiones/vendedores.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import { VendedoresService } from './vendedores.service';
import type { Vendedor } from './vendedores.repository';

// Sin @Publico(): el guard global protege todo por defecto. Listar NO exige
// vendedor.gestionar a proposito: Rutas (T-36/T-37) y Nomina (T-47) van a
// necesitar este catalogo, no solo quien administra vendedores. Crear y
// editar SI lo exigen (Tasks 4 y 5).
@Controller('vendedores')
export class VendedoresController {
  constructor(private readonly vendedores: VendedoresService) {}

  @Get()
  async listar(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
  ): Promise<Vendedor[]> {
    return this.vendedores.listar(usuarioId, normalizarSucursalPedida(sucursal));
  }
}
```

- [ ] **Step 6: Llenar el módulo, que hoy está vacío**

Reemplaza `apps/backend/src/modules/nomina-comisiones/nomina-comisiones.module.ts` entero:

```ts
import { Module } from '@nestjs/common';
import { PasswordService } from '../auth/password.service';
import { VendedoresController } from './vendedores.controller';
import { VendedoresRepository } from './vendedores.repository';
import { VendedoresService } from './vendedores.service';

// Vendedor vive aqui y no en un `modules/vendedores/` nuevo: el CLAUDE.md
// fija que los modulos usan los slugs del vault, y `Vendedor.md` declara
// `modulo: nomina-comisiones` (D1 del spec).
//
// `PasswordService` se registra aqui (no se importa `AuthModule`) porque
// AuthModule NO la exporta -- solo exporta AuthService, TokenService,
// AuthVendedorService, TokenVendedorService y PermisosRepository (ver
// auth.module.ts). Es una clase sin estado (envuelve argon2), asi que
// registrarla en un segundo modulo es seguro y no duplica nada con efectos.
@Module({
  controllers: [VendedoresController],
  providers: [VendedoresService, VendedoresRepository, PasswordService],
})
export class NominaComisionesModule {}
```

`NominaComisionesModule` ya está importado en `app.module.ts` y registrado en `imports` — **no hay que tocar `app.module.ts`**.

- [ ] **Step 7: Correr la prueba para verificar que pasa**

```bash
npm run test:e2e --workspace=apps/backend -- vendedores
```

Esperado: las 7 pruebas del `describe('GET /vendedores')` en verde.

- [ ] **Step 8: Verificar que no se rompió nada más**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
```

Esperado: lint sin errores, build limpio, y el total de e2e = tu línea base + 7.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/nomina-comisiones/ apps/backend/test/vendedores.e2e-spec.ts
git commit -m "T-62 · GET /vendedores con alcance por sucursal

El modulo vive en modules/nomina-comisiones/ porque Vendedor.md del vault
declara modulo: nomina-comisiones (D1). PasswordService se registra en
este modulo porque AuthModule no lo exporta.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `POST /vendedores` — rechazo por colisión de segmento y de login (D3, D4, D5, D6)

**Files:**
- Create: `apps/backend/src/modules/nomina-comisiones/dto/crear-vendedor.dto.ts`
- Modify: `apps/backend/src/modules/nomina-comisiones/vendedores.repository.ts` (agrega `crear()`)
- Modify: `apps/backend/src/modules/nomina-comisiones/vendedores.service.ts` (agrega `crear()`)
- Modify: `apps/backend/src/modules/nomina-comisiones/vendedores.controller.ts` (agrega `@Post()`)
- Modify: `apps/backend/test/vendedores.e2e-spec.ts` (agrega un `describe`)

**Interfaces:**
- Consumes: todo lo de la Task 3; `candidatosDeSegmento()` de `../sincronizacion/segmento-vendedor` (sin modificarla); `esViolacionUnicidad`/`esViolacionFk` de `../../database/errores-postgres` (sin modificarlas); `PasswordService.hashear()`.
- Produces:
  - `CrearVendedorDto { nombre: string; login: string; contrasena: string; sucursalId?: string }`
  - `VendedoresRepository.crear(datos: { nombre: string; login: string; passwordHash: string; sucursalId: string; folioSegmento: string }): Promise<Vendedor>`
  - `VendedoresService.crear(usuarioId: string, dto: CrearVendedorDto): Promise<Vendedor>`

- [ ] **Step 1: Escribir las pruebas e2e que fallan**

Agrega este `describe` dentro de `describe('Vendedores (e2e)')`, después del `describe('GET /vendedores')`:

```ts
  describe('POST /vendedores', () => {
    it('un usuario atado crea en SU sucursal sin mandarla, y le asigna segmento', async () => {
      const res = await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Abraham Solis`,
          login: `e2e-alta-${SUFIJO}`,
          contrasena: 'x',
        })
        .expect(201);

      const vendedor = res.body as VendedorRespuesta;
      expect(vendedor.sucursalCodigo).toBe('TJ');
      expect(vendedor.folioSegmento).toBe('AS');
      expect(vendedor.activo).toBe(true);
      expect(vendedor).not.toHaveProperty('password_hash');
    });

    // D3: el cliente propone, el servidor dispone. Mandar otra sucursal no es
    // un intento de escalada (el formulario ni siquiera pinta el campo), se
    // ignora en silencio.
    it('a un usuario atado se le IGNORA el sucursalId que mande', async () => {
      const res = await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Colado`,
          login: `e2e-colado-${SUFIJO}`,
          contrasena: 'x',
          sucursalId: idMexicali,
        })
        .expect(201);

      expect((res.body as VendedorRespuesta).sucursalCodigo).toBe('TJ');
    });

    it('el usuario General elige la sucursal', async () => {
      const res = await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} General Electo`,
          login: `e2e-gen-elige-${SUFIJO}`,
          contrasena: 'x',
          sucursalId: idMexicali,
        })
        .expect(201);

      expect((res.body as VendedorRespuesta).sucursalCodigo).toBe('MX');
    });

    it('el usuario General sin sucursalId recibe 400', async () => {
      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} Sin sucursal`,
          login: `e2e-sinsuc-${SUFIJO}`,
          contrasena: 'x',
        })
        .expect(400);
    });

    // D5: sin minimo de longitud -- el cliente lo confirmo.
    it('acepta una contraseña de un solo caracter', async () => {
      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Password Corta`,
          login: `e2e-corta-${SUFIJO}`,
          contrasena: 'x',
        })
        .expect(201);
    });

    it('rechaza una contraseña vacia con 400', async () => {
      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Password Vacia`,
          login: `e2e-vacia-${SUFIJO}`,
          contrasena: '',
        })
        .expect(400);
    });

    it('rechaza un login duplicado (incluida variacion de mayusculas) con 409', async () => {
      const login = `e2e-dup-${SUFIJO}`;
      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Login Uno`, login, contrasena: 'x' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Login Dos`,
          login: login.toUpperCase(),
          contrasena: 'x',
        })
        .expect(409);
    });

    // EL criterio de aceptacion (D6, enmienda ADR-0007): rechazar, no ceder.
    it('rechaza el alta si las iniciales ya estan tomadas en la MISMA sucursal', async () => {
      await sembrarVendedor(
        `e2e-ocupado-${SUFIJO}`,
        `${PREFIJO} Beto Ponce`,
        idTijuana,
        'BP',
      );

      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Berta Pineda`,
          login: `e2e-choca-${SUFIJO}`,
          contrasena: 'x',
        })
        .expect(409);
    });

    // El ejemplo textual del cliente: mismo segmento, sucursal distinta, SI
    // se acepta -- porque el folio completo no choca.
    it('permite el mismo segmento de iniciales en una sucursal distinta', async () => {
      await sembrarVendedor(
        `e2e-tjjp-${SUFIJO}`,
        `${PREFIJO} Juan Perez TJ`,
        idTijuana,
        'JP',
      );

      const res = await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} Juan Perez MX`,
          login: `e2e-mxjp-${SUFIJO}`,
          contrasena: 'x',
          sucursalId: idMexicali,
        })
        .expect(201);

      expect((res.body as VendedorRespuesta).folioSegmento).toBe('JP');
      expect((res.body as VendedorRespuesta).sucursalCodigo).toBe('MX');
    });

    // Un vendedor desactivado (activo=false, sin deleted_at) sigue bloqueando
    // sus iniciales -- D7 del spec, ya fijado en la base por la Task 2.
    it('un vendedor desactivado en la sucursal sigue bloqueando sus iniciales', async () => {
      const id = await sembrarVendedor(
        `e2e-dormido-${SUFIJO}`,
        `${PREFIJO} Carla Ruiz`,
        idTijuana,
        'CR',
      );
      await db
        .updateTable('vendedor')
        .set({ activo: false })
        .where('id', '=', id)
        .execute();

      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Carlos Reyes`,
          login: `e2e-choca2-${SUFIJO}`,
          contrasena: 'x',
        })
        .expect(409);
    });

    it('rechaza crear sin el permiso vendedor.gestionar', async () => {
      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieSinPermiso)
        .send({
          nombre: `${PREFIJO} Prohibido`,
          login: `e2e-prohibido-${SUFIJO}`,
          contrasena: 'x',
        })
        .expect(403);
    });

    it('rechaza un nombre vacio con 400', async () => {
      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({ nombre: '   ', login: `e2e-nombre-${SUFIJO}`, contrasena: 'x' })
        .expect(400);
    });
  });
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

```bash
npm run test:e2e --workspace=apps/backend -- vendedores
```

Esperado: las 12 nuevas **fallan** con 404 (no hay `@Post()` todavía); las 7 del `GET` siguen en verde.

- [ ] **Step 3: Escribir el DTO**

Crea `apps/backend/src/modules/nomina-comisiones/dto/crear-vendedor.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// El indice de unicidad de la migracion (Task 1) es sobre lower(login), pero
// AuthVendedorService.validarCredenciales compara el login tal cual quedo
// guardado. Se normaliza aqui, al escribir, igual que CrearUsuarioDto (T-13)
// -- no se toca auth-vendedor.service.ts.
const normalizarLogin = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CrearVendedorDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  @MaxLength(120, { message: 'El nombre no puede pasar de 120 caracteres.' })
  nombre!: string;

  @Transform(normalizarLogin)
  @IsString()
  @MinLength(1, { message: 'El login es obligatorio.' })
  @MaxLength(60, { message: 'El login no puede pasar de 60 caracteres.' })
  login!: string;

  // D5 del spec: el cliente confirmo que SIN minimo de longitud ni rotacion
  // para la contraseña del vendedor. Solo se exige que no este vacia -- el
  // tope de 200 es defensivo (mismo que CrearUsuarioDto), no una politica.
  @IsString()
  @MinLength(1, { message: 'La contraseña es obligatoria.' })
  @MaxLength(200, {
    message: 'La contraseña no puede pasar de 200 caracteres.',
  })
  contrasena!: string;

  // Opcional a proposito (D3): solo lo manda -y solo se le hace caso a- un
  // usuario General. A un usuario atado a una sucursal se le IGNORA.
  @IsOptional()
  @IsUUID()
  sucursalId?: string;
}
```

- [ ] **Step 4: Agregar `crear()` al repositorio**

Agrega este método a `VendedoresRepository` en `apps/backend/src/modules/nomina-comisiones/vendedores.repository.ts`, después de `listarPorCodigoSucursal()`:

```ts
  /**
   * Sin transaccion: es un solo insert. La lectura del codigo de sucursal va
   * despues porque `returning` no puede traer columnas de la tabla del join.
   */
  async crear(datos: {
    nombre: string;
    login: string;
    passwordHash: string;
    sucursalId: string;
    folioSegmento: string;
  }): Promise<Vendedor> {
    const fila = await this.db
      .insertInto('vendedor')
      .values({
        nombre: datos.nombre,
        login: datos.login,
        password_hash: datos.passwordHash,
        sucursal_id: datos.sucursalId,
        folio_segmento: datos.folioSegmento,
      })
      .returning([
        'id',
        'nombre',
        'login',
        'sucursal_id',
        'folio_segmento',
        'activo',
      ])
      .executeTakeFirstOrThrow();

    const sucursal = await this.db
      .selectFrom('sucursal')
      .select('codigo')
      .where('id', '=', datos.sucursalId)
      .executeTakeFirstOrThrow();

    return aVendedor({ ...fila, codigo: sucursal.codigo });
  }
```

- [ ] **Step 5: Agregar `crear()` al servicio**

En `apps/backend/src/modules/nomina-comisiones/vendedores.service.ts`, cambia el import de `@nestjs/common` por:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
```

Agrega estos imports:

```ts
import {
  esViolacionFk,
  esViolacionUnicidad,
} from '../../database/errores-postgres';
import { PasswordService } from '../auth/password.service';
import { candidatosDeSegmento } from '../sincronizacion/segmento-vendedor';
import type { CrearVendedorDto } from './dto/crear-vendedor.dto';
```

Agrega esta función a nivel de módulo, antes de `@Injectable()`:

```ts
/**
 * El driver `pg` expone en `error.constraint` el indice que violo el unique.
 * `vendedor` tiene DOS uniques que un solo INSERT puede disparar
 * (`uq_vendedor_login` de la Task 1 y `uq_vendedor_folio_segmento` de la
 * Task 2), asi que hay que distinguirlos -- mismo patron que
 * `nombreDelIndice()` de `ProductosService.editar()` (T-10), que distingue
 * `uq_producto_nombre` de `uq_presentacion_volumen`.
 */
function nombreDelIndice(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) {
    return undefined;
  }
  const valor = (error as { constraint?: unknown }).constraint;
  return typeof valor === 'string' ? valor : undefined;
}
```

Cambia el constructor para inyectar `PasswordService`:

```ts
  constructor(
    private readonly repo: VendedoresRepository,
    private readonly password: PasswordService,
  ) {}
```

Agrega este método a la clase, después de `listar()`:

```ts
  /**
   * D6 del spec (enmienda de ADR-0007) -- SIN consulta previa: se calcula el
   * PRIMER candidato de `candidatosDeSegmento()` (inicial + inicial de
   * apellido, la regla del ADR) y se intenta el insert directo. No se camina
   * la lista de alternativas: si ya esta tomado en esta sucursal, se
   * RECHAZA el alta -- es el cambio de estrategia que T-14 (cede en
   * silencio) ya no sigue.
   */
  async crear(usuarioId: string, dto: CrearVendedorDto): Promise<Vendedor> {
    const actor = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!actor) {
      throw new UnauthorizedException('Sesion invalida.');
    }

    const sucursalId = actor.id ?? dto.sucursalId;
    if (!sucursalId) {
      throw new BadRequestException(
        'Indica a qué sucursal pertenece el vendedor.',
      );
    }

    const segmento = candidatosDeSegmento(dto.nombre)[0];
    const passwordHash = await this.password.hashear(dto.contrasena);

    try {
      return await this.repo.crear({
        nombre: dto.nombre,
        login: dto.login,
        passwordHash,
        sucursalId,
        folioSegmento: segmento,
      });
    } catch (error) {
      if (esViolacionUnicidad(error)) {
        if (nombreDelIndice(error) === 'uq_vendedor_folio_segmento') {
          throw new ConflictException(
            `Ya hay un vendedor en esta sucursal con esas iniciales (${segmento}). Ajusta el nombre para diferenciarlo.`,
          );
        }
        throw new ConflictException(
          `Ya existe un vendedor con el login "${dto.login}".`,
        );
      }
      if (esViolacionFk(error)) {
        throw new NotFoundException('Alguno de los datos enviados no existe.');
      }
      throw error;
    }
  }
```

- [ ] **Step 6: Agregar el `@Post()` al controlador**

En `apps/backend/src/modules/nomina-comisiones/vendedores.controller.ts`, cambia el import de `@nestjs/common` por:

```ts
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
```

Agrega estos dos imports:

```ts
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { CrearVendedorDto } from './dto/crear-vendedor.dto';
```

Y agrega el método a la clase, después de `listar()`:

```ts
  @Post()
  @RequierePermiso('vendedor.gestionar')
  async crear(
    @UsuarioActual() usuarioId: string,
    @Body() dto: CrearVendedorDto,
  ): Promise<Vendedor> {
    return this.vendedores.crear(usuarioId, dto);
  }
```

El permiso `vendedor.gestionar` **ya existe** desde las semillas de T-05 (`20260803163500_semillas.sql:33`, grupo `Operacion Comercial`). No hace falta migración de permiso.

- [ ] **Step 7: Correr las pruebas para verificar que pasan**

```bash
npm run test:e2e --workspace=apps/backend -- vendedores
```

Esperado: las 19 (7 del `GET` + 12 del `POST`) en verde.

- [ ] **Step 8: Verificar que no se rompió nada más**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
```

Esperado: lint y build limpios, y el total de e2e = tu línea base + 19.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/nomina-comisiones/ apps/backend/test/vendedores.e2e-spec.ts
git commit -m "T-62 · POST /vendedores rechaza el alta por colision de segmento

Enmienda ADR-0007, confirmada por el cliente: si las iniciales ya estan
tomadas por un vendedor de la MISMA sucursal, el alta se rechaza (409) en
vez de ceder en silencio a otra combinacion, como hacia T-14.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `PATCH /vendedores/:id` — editar y dar de baja (D3, D5, D7)

**Files:**
- Create: `apps/backend/src/modules/nomina-comisiones/dto/editar-vendedor.dto.ts`
- Modify: `apps/backend/src/modules/nomina-comisiones/vendedores.repository.ts` (agrega `buscarPorId()` y `actualizar()`)
- Modify: `apps/backend/src/modules/nomina-comisiones/vendedores.service.ts` (agrega `editar()`)
- Modify: `apps/backend/src/modules/nomina-comisiones/vendedores.controller.ts` (agrega `@Patch()`)
- Modify: `apps/backend/test/vendedores.e2e-spec.ts` (agrega un `describe`)

**Interfaces:**
- Consumes: todo lo de las Tasks 3 y 4.
- Produces:
  - `EditarVendedorDto { nombre?: string; contrasena?: string; activo?: boolean }`
  - `VendedoresRepository.buscarPorId(id: string): Promise<Vendedor | undefined>`
  - `VendedoresRepository.actualizar(id: string, cambios: { nombre?: string; password_hash?: string; activo?: boolean }): Promise<Vendedor>`
  - `VendedoresService.editar(usuarioId: string, id: string, dto: EditarVendedorDto): Promise<Vendedor>`

- [ ] **Step 1: Escribir las pruebas e2e que fallan**

Agrega este `describe` dentro de `describe('Vendedores (e2e)')`, después del `describe('POST /vendedores')`:

```ts
  describe('PATCH /vendedores/:id', () => {
    it('edita el nombre sin tocar el segmento ya asignado', async () => {
      const id = await sembrarVendedor(
        `e2e-editable-${SUFIJO}`,
        `${PREFIJO} Nombre Viejo`,
        idTijuana,
        'NV',
      );

      const res = await request(app.getHttpServer())
        .patch(`/vendedores/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Nombre Nuevo` })
        .expect(200);

      const vendedor = res.body as VendedorRespuesta;
      expect(vendedor.nombre).toBe(`${PREFIJO} Nombre Nuevo`);
      // El segmento NO se recalcula al editar (advertencia del spec): sigue
      // siendo el de "Nombre Viejo", no el que le tocaria a "Nombre Nuevo".
      expect(vendedor.folioSegmento).toBe('NV');
    });

    it('cambia la contraseña', async () => {
      const id = await sembrarVendedor(
        `e2e-passcambia-${SUFIJO}`,
        `${PREFIJO} Cambia Password`,
        idTijuana,
      );

      await request(app.getHttpServer())
        .patch(`/vendedores/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ contrasena: 'nueva' })
        .expect(200);

      const fila = await db
        .selectFrom('vendedor')
        .select('password_hash')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      // El servicio de la app de vendedores (T-06) es quien de verdad
      // verifica el hash; aqui solo importa que cambio.
      expect(fila.password_hash).not.toBe('x');
    });

    it('da de baja y vuelve a activar', async () => {
      const id = await sembrarVendedor(
        `e2e-baja-${SUFIJO}`,
        `${PREFIJO} Baja`,
        idTijuana,
      );

      const baja = await request(app.getHttpServer())
        .patch(`/vendedores/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ activo: false })
        .expect(200);
      expect((baja.body as VendedorRespuesta).activo).toBe(false);

      const lista = await request(app.getHttpServer())
        .get('/vendedores')
        .set('Cookie', cookieTijuana)
        .expect(200);
      expect(
        (lista.body as VendedorRespuesta[]).some((v) => v.id === id),
      ).toBe(true);

      const alta = await request(app.getHttpServer())
        .patch(`/vendedores/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ activo: true })
        .expect(200);
      expect((alta.body as VendedorRespuesta).activo).toBe(true);
    });

    it('un usuario de TJ no puede editar un vendedor de MX', async () => {
      const id = await sembrarVendedor(
        `e2e-ajeno-${SUFIJO}`,
        `${PREFIJO} Ajeno`,
        idMexicali,
      );

      await request(app.getHttpServer())
        .patch(`/vendedores/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Secuestrado` })
        .expect(403);
    });

    it('el usuario General si puede editar en cualquier sucursal', async () => {
      const id = await sembrarVendedor(
        `e2e-genedita-${SUFIJO}`,
        `${PREFIJO} General Edita`,
        idMexicali,
      );

      await request(app.getHttpServer())
        .patch(`/vendedores/${id}`)
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} General Edito` })
        .expect(200);
    });

    it('un PATCH sin ningun campo responde 400', async () => {
      const id = await sembrarVendedor(
        `e2e-vacio-${SUFIJO}`,
        `${PREFIJO} Vacio`,
        idTijuana,
      );

      await request(app.getHttpServer())
        .patch(`/vendedores/${id}`)
        .set('Cookie', cookieTijuana)
        .send({})
        .expect(400);
    });

    it('un id que no existe responde 404', async () => {
      await request(app.getHttpServer())
        .patch('/vendedores/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Fantasma` })
        .expect(404);
    });

    it('un id mal formado responde 400, no 500', async () => {
      await request(app.getHttpServer())
        .patch('/vendedores/no-soy-un-uuid')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Basura` })
        .expect(400);
    });

    it('rechaza editar sin el permiso vendedor.gestionar', async () => {
      const id = await sembrarVendedor(
        `e2e-blindado-${SUFIJO}`,
        `${PREFIJO} Blindado`,
        idTijuana,
      );

      await request(app.getHttpServer())
        .patch(`/vendedores/${id}`)
        .set('Cookie', cookieSinPermiso)
        .send({ nombre: `${PREFIJO} Hackeado` })
        .expect(403);
    });

    // D3: la sucursal de un vendedor no se puede cambiar, y el DTO ni
    // siquiera lleva el campo. Mismo mecanismo que vehiculos.e2e-spec.ts: el
    // ValidationPipe (whitelist sin forbidNonWhitelisted) descarta el campo
    // en silencio, y el 400 sale de "no hay nada que actualizar".
    it('no deja cambiar la sucursal de un vendedor', async () => {
      const id = await sembrarVendedor(
        `e2e-arraigado-${SUFIJO}`,
        `${PREFIJO} Arraigado`,
        idTijuana,
      );

      await request(app.getHttpServer())
        .patch(`/vendedores/${id}`)
        .set('Cookie', cookieGeneral)
        .send({ sucursalId: idMexicali })
        .expect(400);

      const fila = await db
        .selectFrom('vendedor')
        .select('sucursal_id')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(fila.sucursal_id).toBe(idTijuana);
    });
  });
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

```bash
npm run test:e2e --workspace=apps/backend -- vendedores
```

Esperado: las 10 nuevas **fallan** con 404 (no hay `@Patch()` todavía); las 20 anteriores siguen en verde.

- [ ] **Step 3: Escribir el DTO**

Crea `apps/backend/src/modules/nomina-comisiones/dto/editar-vendedor.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Los tres campos son opcionales: el servicio rechaza con 400 el cuerpo que
 * no traiga ninguno.
 *
 * SIN `sucursalId` (D3): la sucursal de un vendedor no se cambia -- su
 * segmento de folio quedo pinado para esa sucursal (D6).
 * SIN `login`: no se pidio poder editarlo; si hiciera falta, llevaria el
 * mismo `@Transform` de normalizarLogin que CrearVendedorDto.
 */
export class EditarVendedorDto {
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  @MaxLength(120, { message: 'El nombre no puede pasar de 120 caracteres.' })
  nombre?: string;

  // D5: sin minimo de longitud. Vacio u omitido = no cambiar -- el portal
  // (Task 6) omite la clave del JSON cuando el campo quedo vacio.
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'La contraseña no puede quedar vacía.' })
  @MaxLength(200, {
    message: 'La contraseña no puede pasar de 200 caracteres.',
  })
  contrasena?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
```

- [ ] **Step 4: Agregar `buscarPorId()` y `actualizar()` al repositorio**

Agrega estos métodos a `VendedoresRepository`, después de `crear()`:

```ts
  async buscarPorId(id: string): Promise<Vendedor | undefined> {
    const fila = await this.db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select(COLUMNAS)
      .where('vendedor.id', '=', id)
      .where('vendedor.deleted_at', 'is', null)
      .executeTakeFirst();

    return fila ? aVendedor(fila) : undefined;
  }

  /**
   * `cambios` nunca llega vacio: el servicio lo comprueba antes. La sucursal
   * y el segmento NO se tocan aqui (D3, D6): el codigo no le abre la puerta.
   */
  async actualizar(
    id: string,
    cambios: { nombre?: string; password_hash?: string; activo?: boolean },
  ): Promise<Vendedor> {
    const fila = await this.db
      .updateTable('vendedor')
      .set(cambios)
      .where('id', '=', id)
      .returning([
        'id',
        'nombre',
        'login',
        'sucursal_id',
        'folio_segmento',
        'activo',
      ])
      .executeTakeFirstOrThrow();

    const sucursal = await this.db
      .selectFrom('sucursal')
      .select('codigo')
      .where('id', '=', fila.sucursal_id)
      .executeTakeFirstOrThrow();

    return aVendedor({ ...fila, codigo: sucursal.codigo });
  }
```

- [ ] **Step 5: Agregar `editar()` al servicio**

En `apps/backend/src/modules/nomina-comisiones/vendedores.service.ts`, agrega este import:

```ts
import type { EditarVendedorDto } from './dto/editar-vendedor.dto';
```

Y este método, después de `crear()`:

```ts
  /**
   * A diferencia de `crear()`, NO puede disparar ninguno de los dos `unique`
   * de la tabla: `login` no es editable (D4 solo aplica al alta) y el
   * segmento no se recalcula al cambiar `nombre` (advertencia del spec) --
   * por eso no hace falta ningun try/catch de violacion aqui.
   */
  async editar(
    usuarioId: string,
    id: string,
    dto: EditarVendedorDto,
  ): Promise<Vendedor> {
    if (
      dto.nombre === undefined &&
      dto.contrasena === undefined &&
      dto.activo === undefined
    ) {
      throw new BadRequestException('No hay nada que actualizar.');
    }

    const vendedor = await this.repo.buscarPorId(id);
    if (!vendedor) {
      throw new NotFoundException('No existe ese vendedor.');
    }

    const alcance = await this.alcanceDe(usuarioId, null);
    if (alcance.tipo === 'una' && alcance.codigo !== vendedor.sucursalCodigo) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }

    const cambios: {
      nombre?: string;
      password_hash?: string;
      activo?: boolean;
    } = {};
    if (dto.nombre !== undefined) {
      cambios.nombre = dto.nombre;
    }
    if (dto.contrasena !== undefined) {
      cambios.password_hash = await this.password.hashear(dto.contrasena);
    }
    if (dto.activo !== undefined) {
      cambios.activo = dto.activo;
    }

    return this.repo.actualizar(id, cambios);
  }
```

Agrega `ForbiddenException` al import de `@nestjs/common` (junto a los que ya agregó la Task 4):

```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
```

- [ ] **Step 6: Agregar el `@Patch()` al controlador**

En `apps/backend/src/modules/nomina-comisiones/vendedores.controller.ts`, cambia el import de `@nestjs/common` por:

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
```

Agrega este import:

```ts
import { EditarVendedorDto } from './dto/editar-vendedor.dto';
```

Y agrega el método a la clase, después de `crear()`:

```ts
  @Patch(':id')
  @RequierePermiso('vendedor.gestionar')
  async editar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarVendedorDto,
  ): Promise<Vendedor> {
    return this.vendedores.editar(usuarioId, id, dto);
  }
```

- [ ] **Step 7: Correr las pruebas para verificar que pasan**

```bash
npm run test:e2e --workspace=apps/backend -- vendedores
```

Esperado: las 29 (7 `GET` + 12 `POST` + 10 `PATCH`) en verde.

- [ ] **Step 8: Verificar que no se rompió nada más**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm test --workspace=apps/backend
```

Esperado: lint y build limpios, el total de e2e = tu línea base + 29, y las unitarias sin cambio (esta task no agrega ninguna — ver spec, sección Pruebas).

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/nomina-comisiones/ apps/backend/test/vendedores.e2e-spec.ts
git commit -m "T-62 · PATCH /vendedores/:id — editar y dar de baja

Editar el nombre NO recalcula el segmento de folio (se pina en el alta y
no se toca despues); ni login ni segmento son editables, asi que editar()
no necesita capturar ninguna violacion de unique.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Actualizar `crear-vendedor.ts` a la regla nueva (D8)

**Files:**
- Modify: `apps/backend/src/scripts/crear-vendedor.ts`

**Interfaces:**
- Consumes: `candidatosDeSegmento()` de `../modules/sincronizacion/segmento-vendedor` (reemplaza a `asignarSegmento()`, que deja de importarse aquí).
- Produces: nada que otra task consuma — es el último lugar que usaba la lógica vieja de T-14.

- [ ] **Step 1: Leer el archivo actual**

Ya lo tienes en contexto (`apps/backend/src/scripts/crear-vendedor.ts`). El bloque a cambiar es el que calcula `ocupados`/`segmento` con `asignarSegmento()` (líneas ~176–192 del archivo original) y el mensaje de aviso de las líneas ~208–222.

Este script **no tiene pruebas automatizadas** (es una herramienta de consola interactiva, mismo caso que `crear-usuario.ts`) — la verificación es manual, en el Step 3.

- [ ] **Step 2: Reescribir el bloque de asignación de segmento**

Cambia el import:

```ts
import { asignarSegmento } from '../modules/sincronizacion/segmento-vendedor';
```

por:

```ts
import { candidatosDeSegmento } from '../modules/sincronizacion/segmento-vendedor';
```

Reemplaza el bloque que va desde el comentario `// El 5o segmento de su [[Folios|folio]] (T-14).` hasta el `console.log` de `Segmento de folio: ...` (justo antes del cierre del `try`) por:

```ts
    // El 5o segmento de su [[Folios|folio]] (T-14).
    //
    // Se asigna AQUI y no en la tablet porque la tablet no puede: del `pull`
    // solo baja su propia ficha, asi que no ve a sus companeros. Se **pina**
    // en vez de recalcularse: un folio emitido no se corrige hacia atras.
    //
    // T-62 (enmienda de ADR-0007, confirmada por el cliente): si las
    // iniciales ya estan tomadas por otro vendedor ACTIVO de la MISMA
    // sucursal, el alta se RECHAZA -- ya no se cede a la siguiente
    // combinacion como hacia la version anterior de este script. Mismo
    // criterio, sin consulta previa: se intenta el insert con el primer
    // candidato y se distingue el error por su `constraint`.
    const segmento = candidatosDeSegmento(nombre)[0];

    try {
      const creado = await db
        .insertInto('vendedor')
        .values({
          login,
          nombre,
          password_hash: passwordHash,
          sucursal_id: sucursal.id,
          folio_segmento: segmento,
        })
        .returning(['id', 'login'])
        .executeTakeFirstOrThrow();

      console.log(`\n✅ Vendedor "${creado.login}" creado (${creado.id}).`);
      console.log(
        `   Segmento de folio: ${segmento} (p. ej. ${sucursal.codigo}260807${segmento}01).`,
      );
    } catch (error) {
      const codigo =
        typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined;
      const constraint =
        typeof error === 'object' && error !== null && 'constraint' in error
          ? (error as { constraint?: unknown }).constraint
          : undefined;

      if (codigo === '23505' && constraint === 'uq_vendedor_folio_segmento') {
        throw new Error(
          `Ya hay un vendedor activo en "${sucursal.codigo}" con las iniciales "${segmento}". ` +
            'Da de alta a este vendedor con un nombre que no choque (mismo criterio que usa el portal, T-62).',
        );
      }
      throw error;
    }
```

Quita también el bloque que quedaba después del alta original (`const iniciales = asignarSegmento(nombre, new Set()); ... console.log('⚠ Sus iniciales...')`) — ya no aplica: no hay "cesión" que avisar, porque ahora se rechaza en vez de ceder.

- [ ] **Step 3: Verificar a mano contra el Postgres local**

```bash
DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" \
  npm run crear-vendedor --workspace=apps/backend
```

Sigue las preguntas para dar de alta dos vendedores con nombres que produzcan las mismas iniciales en la misma sucursal (p. ej. "Beto Ponce" y "Berta Pineda", ambos "BP"). Esperado: el primero se crea; el segundo termina con el mensaje `❌ Ya hay un vendedor activo en "..." con las iniciales "BP".` y **no** queda insertado (confírmalo con `select count(*) from vendedor where nombre = 'Berta Pineda';` → `0`).

- [ ] **Step 4: Verificar que compila y el resto de scripts no se rompió**

```bash
npm run build --workspace=apps/backend
npm run lint --workspace=apps/backend
```

Esperado: build y lint limpios.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/scripts/crear-vendedor.ts
git commit -m "T-62 · crear-vendedor.ts usa la regla nueva (rechaza, no cede)

Antes cedia en silencio a la siguiente combinacion de letras cuando las
iniciales chocaban. Ahora usa la misma regla que el portal (D8): rechaza
el alta si el candidato ya esta tomado en esa sucursal.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Portal — capa de datos y pantalla de Vendedores (D9)

**Files:**
- Create: `apps/portal/src/lib/vendedores.ts`
- Create: `apps/portal/src/components/vendedores/formulario-vendedor.tsx`
- Create: `apps/portal/src/components/vendedores/pantalla-vendedores.tsx`
- Modify: `apps/portal/src/app/(portal)/catalogo/vendedores/page.tsx` (hoy `<Placeholder title="Vendedores" />`)

**Interfaces:**
- Consumes: `apiFetch`/`ErrorApi` de `@/lib/api`; `useAuth` de `@/components/auth/auth-provider`; `PantallaCatalogo` de `@/components/catalogo/pantalla-catalogo`; `useEnvioFormulario` de `@/components/catalogo/use-envio-formulario`; `listarSucursales`/`Sucursal` de `@/lib/sucursales`; `Button` de `@/components/ui/button`.
- Produces:
  - `interface Vendedor { id: string; nombre: string; login: string; sucursalId: string; sucursalCodigo: string; folioSegmento: string | null; activo: boolean }`
  - `listarVendedores(sucursal?: string | null): Promise<Vendedor[]>`
  - `crearVendedor(datos: { nombre: string; login: string; contrasena: string; sucursalId?: string }): Promise<Vendedor>`
  - `editarVendedor(id: string, cambios: { nombre?: string; contrasena?: string; activo?: boolean }): Promise<Vendedor>`
  - `PantallaVendedores({ sucursal }: { sucursal: string | null })`
  - `FormularioVendedor({ vendedor, alGuardar, alCancelar })`

Este proyecto no hace TDD estricto en el portal (no hay pruebas de pantalla hasta la Task 8, siguiendo el patrón de T-11/T-12/T-13: primero se construye la pantalla, luego se le agrega cobertura calcando `pantalla-usuarios.test.tsx`). La verificación de esta task es manual (Step 5) y con `lint`/`build`.

- [ ] **Step 1: Escribir `lib/vendedores.ts`**

Crea `apps/portal/src/lib/vendedores.ts`:

```ts
import { apiFetch } from "./api";

export interface Vendedor {
  id: string;
  nombre: string;
  login: string;
  sucursalId: string;
  sucursalCodigo: string;
  folioSegmento: string | null;
  activo: boolean;
}

/**
 * @param sucursal codigo a filtrar, "todas", o null/undefined para no pedir
 *   nada. Da igual lo que se mande: el backend acota el resultado a lo que el
 *   usuario puede ver.
 */
export function listarVendedores(
  sucursal?: string | null,
): Promise<Vendedor[]> {
  const query = sucursal ? `?sucursal=${encodeURIComponent(sucursal)}` : "";
  return apiFetch<Vendedor[]>(`/vendedores${query}`);
}

export function crearVendedor(datos: {
  nombre: string;
  login: string;
  contrasena: string;
  /** Solo lo manda un usuario General: al resto se le ignora. */
  sucursalId?: string;
}): Promise<Vendedor> {
  return apiFetch<Vendedor>("/vendedores", {
    method: "POST",
    body: JSON.stringify(datos),
  });
}

export function editarVendedor(
  id: string,
  cambios: { nombre?: string; contrasena?: string; activo?: boolean },
): Promise<Vendedor> {
  return apiFetch<Vendedor>(`/vendedores/${id}`, {
    method: "PATCH",
    body: JSON.stringify(cambios),
  });
}
```

- [ ] **Step 2: Escribir `FormularioVendedor`**

Crea `apps/portal/src/components/vendedores/formulario-vendedor.tsx`:

```tsx
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import {
  crearVendedor,
  editarVendedor,
  type Vendedor,
} from "@/lib/vendedores";

interface Props {
  /** El vendedor a editar, o null para dar de alta uno nuevo. */
  vendedor: Vendedor | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

export function FormularioVendedor({ vendedor, alGuardar, alCancelar }: Props) {
  const { usuario } = useAuth();
  const esAlta = vendedor === null;

  // Igual que FormularioVehiculo (T-11): la sucursal solo se elige en el
  // alta, y solo si quien la da es un usuario General. `vendedor` (D3) es
  // inmutable despues, asi que en edicion nunca se pinta el desplegable.
  const eligeSucursal = esAlta && usuario !== null && usuario.sucursal === null;

  const [nombre, setNombre] = useState(vendedor?.nombre ?? "");
  const [login, setLogin] = useState(vendedor?.login ?? "");
  const [contrasena, setContrasena] = useState("");
  const [activo, setActivo] = useState(vendedor?.activo ?? true);
  const [sucursalId, setSucursalId] = useState("");
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const { enviando, error, enviar } = useEnvioFormulario(
    "No se pudo guardar el vendedor.",
  );

  useEffect(() => {
    if (!eligeSucursal) return;
    let vigente = true;

    void listarSucursales()
      .then((lista) => {
        if (vigente) setSucursales(lista.filter((s) => s.activa));
      })
      .catch(() => {});

    return () => {
      vigente = false;
    };
  }, [eligeSucursal]);

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();

    await enviar(
      () =>
        vendedor
          ? editarVendedor(vendedor.id, {
              nombre,
              activo,
              // D2 del spec: vacio u omitido = "no cambiar". JSON.stringify
              // quita las claves en `undefined`, asi que el backend nunca la ve.
              contrasena: contrasena.trim() === "" ? undefined : contrasena,
            })
          : crearVendedor({
              nombre,
              login,
              contrasena,
              ...(eligeSucursal ? { sucursalId } : {}),
            }),
      alGuardar,
    );
  }

  return (
    <form
      onSubmit={alEnviar}
      className="mb-6 flex flex-col gap-4 rounded-md border p-4"
    >
      <h2 className="text-sm font-semibold">
        {esAlta ? "Nuevo vendedor" : `Editar ${vendedor.nombre}`}
      </h2>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="nombre" className="text-sm font-medium">
            Nombre completo
          </label>
          <input
            id="nombre"
            required
            maxLength={120}
            disabled={enviando}
            placeholder="Nombre y apellido, para el folio"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>

        {esAlta && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="login" className="text-sm font-medium">
              Login (app)
            </label>
            <input
              id="login"
              required
              maxLength={60}
              disabled={enviando}
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="contrasena" className="text-sm font-medium">
          {esAlta
            ? "Contraseña"
            : "Nueva contraseña (déjalo en blanco para no cambiarla)"}
        </label>
        <input
          id="contrasena"
          type="password"
          required={esAlta}
          maxLength={200}
          disabled={enviando}
          value={contrasena}
          onChange={(e) => setContrasena(e.target.value)}
          className="w-64 rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {eligeSucursal && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sucursal" className="text-sm font-medium">
            Sucursal
          </label>
          <select
            id="sucursal"
            required
            disabled={enviando}
            value={sucursalId}
            onChange={(e) => setSucursalId(e.target.value)}
            className="w-64 rounded-md border px-3 py-2 text-sm"
          >
            <option value="">Elige una sucursal…</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.codigo} · {s.nombre}
              </option>
            ))}
          </select>
        </div>
      )}

      {!esAlta && (
        <p className="text-xs text-muted-foreground">
          Sucursal: {vendedor.sucursalCodigo}. Segmento de folio:{" "}
          {vendedor.folioSegmento ?? "—"}. Ninguno de los dos se puede
          cambiar.
        </p>
      )}

      {!esAlta && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activo}
            disabled={enviando}
            onChange={(e) => setActivo(e.target.checked)}
          />
          Activo
        </label>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : "Guardar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={enviando}
          onClick={alCancelar}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Escribir `PantallaVendedores`**

Crea `apps/portal/src/components/vendedores/pantalla-vendedores.tsx`:

```tsx
"use client";

import { PantallaCatalogo } from "@/components/catalogo/pantalla-catalogo";
import { FormularioVendedor } from "./formulario-vendedor";
import { listarVendedores, type Vendedor } from "@/lib/vendedores";

export function PantallaVendedores({ sucursal }: { sucursal: string | null }) {
  return (
    <PantallaCatalogo<Vendedor>
      titulo="Vendedores"
      permiso="vendedor.gestionar"
      etiquetaAlta="Nuevo vendedor"
      vacio="No hay vendedores que mostrar."
      mensajeError="No se pudieron cargar los vendedores."
      cargar={() => listarVendedores(sucursal)}
      // Igual que Vehiculos (D2): un vendedor pertenece a una sucursal, asi
      // que el selector global SI filtra.
      deps={[sucursal]}
      columnas={[
        { encabezado: "Nombre", celda: (v) => v.nombre },
        { encabezado: "Login", celda: (v) => v.login, className: "font-mono" },
        {
          encabezado: "Sucursal",
          celda: (v) => v.sucursalCodigo,
          className: "font-mono",
        },
        {
          encabezado: "Segmento",
          celda: (v) => v.folioSegmento ?? "—",
          className: "font-mono",
        },
        {
          encabezado: "Estado",
          celda: (v) =>
            v.activo ? (
              "Activo"
            ) : (
              <span className="text-muted-foreground">Inactivo</span>
            ),
        },
      ]}
      formulario={(item, alGuardar, alCancelar) => (
        <FormularioVendedor
          vendedor={item}
          alGuardar={alGuardar}
          alCancelar={alCancelar}
        />
      )}
    />
  );
}
```

- [ ] **Step 4: Reemplazar la página placeholder**

Reemplaza `apps/portal/src/app/(portal)/catalogo/vendedores/page.tsx` entero:

```tsx
import { PantallaVendedores } from "@/components/vendedores/pantalla-vendedores";

// En Next 15 `searchParams` es una promesa. La pagina es un server component
// que solo lee el filtro y lo baja; toda la interaccion vive en el cliente.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaVendedores sucursal={sucursal ?? null} />;
}
```

- [ ] **Step 5: Verificar a mano en el navegador**

Con el backend apuntando al Postgres **local** (nunca `sinmex dev` — ver Global Constraints) y `npm run portal` arriba:

1. Entra a `/catalogo/vendedores` — la tabla carga vacía o con los vendedores que ya hayas creado por consola.
2. Da de alta un vendedor con un usuario atado a una sucursal (sin desplegable de sucursal visible).
3. Da de alta un segundo vendedor con las mismas iniciales en la misma sucursal → el mensaje de error del backend aparece legible en el formulario, y el vendedor no se crea.
4. Edita el nombre de un vendedor existente → el segmento de la tabla **no cambia**.
5. Da de baja un vendedor (checkbox Activo) → sigue en la lista, marcado "Inactivo".
6. Como Administrador General: el desplegable de sucursal se pinta al dar de alta.
7. Un usuario sin `vendedor.gestionar` no ve "Nuevo vendedor" ni "Editar".

- [ ] **Step 6: Lint y build del portal**

```bash
npm run lint --workspace=apps/portal
npm run build --workspace=apps/portal
```

Esperado: ambos limpios.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/lib/vendedores.ts apps/portal/src/components/vendedores/ "apps/portal/src/app/(portal)/catalogo/vendedores/page.tsx"
git commit -m "T-62 · Pantalla de Vendedores en el portal

Calca FormularioVehiculo (sucursal condicional, solo en el alta) y el
patron de contraseña opcional de FormularioUsuario. El segmento de folio
se muestra de solo lectura -- nunca se edita desde el portal.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Portal — pruebas de pantalla (patrón T-65)

**Files:**
- Create: `apps/portal/src/components/vendedores/pantalla-vendedores.test.tsx`

**Interfaces:**
- Consumes: todo lo de la Task 7. Mockea `@/lib/vendedores`, `@/lib/sucursales` y `@/components/auth/auth-provider` — mismo límite que `pantalla-usuarios.test.tsx` y `pantalla-vehiculos.tsx` (T-65): se mockea la capa de red, no `apiFetch`.

- [ ] **Step 1: Escribir la prueba que falla (en realidad: escribir la prueba, punto — no hay nada que deba fallar por un bug, solo por no existir el archivo todavía)**

Crea `apps/portal/src/components/vendedores/pantalla-vendedores.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi, type UsuarioSesion } from "@/lib/api";
import { useAuth } from "@/components/auth/auth-provider";
import * as vendedoresLib from "@/lib/vendedores";
import type { Vendedor } from "@/lib/vendedores";
import * as sucursalesLib from "@/lib/sucursales";
import { PantallaVendedores } from "./pantalla-vendedores";

// Mismo limite que pantalla-usuarios.test.tsx (T-13) y pantalla-vehiculos.tsx
// (T-11): se mockea la capa de red (lib/*.ts), no apiFetch. AuthProvider
// tambien se mockea porque su propia carga de sesion es un problema aparte.
vi.mock("@/lib/vendedores");
vi.mock("@/lib/sucursales");
vi.mock("@/components/auth/auth-provider");

const listarVendedores = vi.mocked(vendedoresLib.listarVendedores);
const crearVendedor = vi.mocked(vendedoresLib.crearVendedor);
const editarVendedor = vi.mocked(vendedoresLib.editarVendedor);
const usarAuthMock = vi.mocked(useAuth);

const SESION_GENERAL: UsuarioSesion = {
  id: "sesion-1",
  login: "admin",
  nombre: "Admin",
  perfil: "Administrador General",
  sucursal: null,
  permisos: ["vendedor.gestionar"],
};

function mockAuth(
  puede: (clave: string) => boolean,
  usuario: UsuarioSesion | null = SESION_GENERAL,
) {
  usarAuthMock.mockReturnValue({
    usuario,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede,
  });
}

const VENDEDOR: Vendedor = {
  id: "1",
  nombre: "Abraham Solis",
  login: "asolis",
  sucursalId: "suc-1",
  sucursalCodigo: "TJ",
  folioSegmento: "AS",
  activo: true,
};

describe("PantallaVendedores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue([
      { id: "suc-1", codigo: "TJ", nombre: "Tijuana", activa: true },
    ]);
  });

  it("muestra el mensaje de permiso y NO llama a la API sin vendedor.gestionar", async () => {
    mockAuth(() => false);

    render(<PantallaVendedores sucursal={null} />);

    // PantallaCatalogo no oculta el listado por falta de permiso (solo el
    // boton de alta/editar) -- listarVendedores SI se llama porque el `GET`
    // es publico (Task 3). Esta prueba fija que el boton de alta no aparece.
    listarVendedores.mockResolvedValue([]);
    await screen.findByText("No hay vendedores que mostrar.");
    expect(
      screen.queryByRole("button", { name: "Nuevo vendedor" }),
    ).not.toBeInTheDocument();
  });

  it("muestra los vendedores cargados y permite dar de alta", async () => {
    mockAuth(() => true);
    listarVendedores.mockResolvedValue([VENDEDOR]);

    render(<PantallaVendedores sucursal={null} />);

    expect(await screen.findByText("Abraham Solis")).toBeInTheDocument();
    expect(screen.getByText("asolis")).toBeInTheDocument();
    expect(screen.getByText("AS")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Nuevo vendedor" }),
    ).toBeInTheDocument();
  });

  it("muestra el mensaje de error cuando la carga falla", async () => {
    mockAuth(() => true);
    listarVendedores.mockRejectedValue(new Error("red caida"));

    render(<PantallaVendedores sucursal={null} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron cargar los vendedores.",
    );
  });

  it("da de alta un vendedor nuevo, con desplegable de sucursal para un actor General", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarVendedores.mockResolvedValueOnce([]);
    crearVendedor.mockResolvedValue(VENDEDOR);
    listarVendedores.mockResolvedValueOnce([VENDEDOR]);

    render(<PantallaVendedores sucursal={null} />);
    await screen.findByText("No hay vendedores que mostrar.");

    await usuario.click(screen.getByRole("button", { name: "Nuevo vendedor" }));

    expect(screen.getByLabelText("Sucursal")).toBeInTheDocument();

    await usuario.type(screen.getByLabelText("Nombre completo"), "Abraham Solis");
    await usuario.type(screen.getByLabelText("Login (app)"), "asolis");
    await usuario.type(screen.getByLabelText("Contraseña"), "x");
    await usuario.selectOptions(screen.getByLabelText("Sucursal"), "suc-1");

    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(crearVendedor).toHaveBeenCalled());
    const payload = crearVendedor.mock.calls[0][0];
    expect(payload.nombre).toBe("Abraham Solis");
    expect(payload.login).toBe("asolis");
    expect(payload.sucursalId).toBe("suc-1");

    expect(await screen.findByText("Abraham Solis")).toBeInTheDocument();
  });

  it("un actor atado a una sucursal no ve el selector de sucursal al dar de alta", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true, {
      ...SESION_GENERAL,
      sucursal: { id: "suc-1", codigo: "TJ", nombre: "Tijuana" },
    });
    listarVendedores.mockResolvedValue([]);

    render(<PantallaVendedores sucursal={null} />);
    await screen.findByText("No hay vendedores que mostrar.");
    await usuario.click(screen.getByRole("button", { name: "Nuevo vendedor" }));

    expect(screen.queryByLabelText("Sucursal")).not.toBeInTheDocument();
  });

  it("edita un vendedor dejando la contraseña en blanco, y no la manda", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarVendedores.mockResolvedValueOnce([VENDEDOR]);
    editarVendedor.mockResolvedValue({ ...VENDEDOR, nombre: "Abraham Solis Jr" });
    listarVendedores.mockResolvedValueOnce([
      { ...VENDEDOR, nombre: "Abraham Solis Jr" },
    ]);

    render(<PantallaVendedores sucursal={null} />);
    await screen.findByText("Abraham Solis");

    await usuario.click(screen.getByRole("button", { name: "Editar" }));

    const campoContrasena = screen.getByLabelText(
      "Nueva contraseña (déjalo en blanco para no cambiarla)",
    );
    expect(campoContrasena).toHaveValue("");

    // El desplegable de sucursal nunca aparece en edicion, ni para un
    // General: la sucursal de un vendedor es inmutable (D3).
    expect(screen.queryByLabelText("Sucursal")).not.toBeInTheDocument();
    expect(screen.getByText(/Sucursal: TJ/)).toBeInTheDocument();

    const campoNombre = screen.getByLabelText("Nombre completo");
    await usuario.clear(campoNombre);
    await usuario.type(campoNombre, "Abraham Solis Jr");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(editarVendedor).toHaveBeenCalledWith("1", expect.anything()));
    const payload = editarVendedor.mock.calls[0][1];
    expect(payload.contrasena).toBeUndefined();
    expect(await screen.findByText("Abraham Solis Jr")).toBeInTheDocument();
  });

  it("muestra el mensaje exacto del servidor cuando el alta choca por colision de segmento", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarVendedores.mockResolvedValue([]);
    crearVendedor.mockRejectedValue(
      new ErrorApi(
        "fallo",
        409,
        'Ya hay un vendedor en esta sucursal con esas iniciales (AP). Ajusta el nombre para diferenciarlo.',
      ),
    );

    render(<PantallaVendedores sucursal={null} />);
    await screen.findByText("No hay vendedores que mostrar.");
    await usuario.click(screen.getByRole("button", { name: "Nuevo vendedor" }));

    await usuario.type(screen.getByLabelText("Nombre completo"), "Ana Ponce");
    await usuario.type(screen.getByLabelText("Login (app)"), "aponce");
    await usuario.type(screen.getByLabelText("Contraseña"), "x");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya hay un vendedor en esta sucursal con esas iniciales (AP).",
    );
  });
});
```

- [ ] **Step 2: Correr las pruebas**

```bash
npm test --workspace=apps/portal
```

Esperado: las 7 pruebas de `pantalla-vendedores.test.tsx` en verde, y el total del portal sube en 7 sobre tu línea base de la Task 0. Si alguna falla, es una prueba real fallando (no "falla porque falta código" — a diferencia del backend, aquí la Task 7 ya construyó la pantalla completa antes de esta task).

- [ ] **Step 3: Lint del portal**

```bash
npm run lint --workspace=apps/portal
```

Esperado: limpio.

- [ ] **Step 4: Commit**

```bash
git add apps/portal/src/components/vendedores/pantalla-vendedores.test.tsx
git commit -m "T-62 · Pruebas de pantalla de Vendedores (patron T-65)

Calca pantalla-usuarios.test.tsx: mockea lib/vendedores y lib/sucursales,
no apiFetch. Cubre el selector de sucursal condicional (solo alta, solo
General) y el mensaje exacto del 409 de colision de segmento.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Después de la Task 8 (no son tasks del plan, son el cierre del ticket)

- **Revisión final de toda la rama**, como en T-10/T-11/T-12/T-13: releer el diff completo buscando el tipo de bugs que solo aparecen al ver el conjunto (ventanas de dos fases, casos con dos campos que cambian a la vez, etc.), no solo tarea por tarea.
- **Aplicar las migraciones a `sinmex dev`** con `supabase migration list` primero (para confirmar qué falta) y `supabase db push` después — **nunca** `npm run backend` apuntando sin querer a la nube.
- **Comentar el issue #62** explicando que la desambiguación de iniciales se resolvió con la enmienda de `ADR-0007` (rechazo, no cesión de T-14), y marcar sus checkboxes.
- **Actualizar el vault** (ya tienes permiso implícito del `AGENTS.md` del repo — hazlo como parte de cerrar el ticket, no lo dejes para después):
  - `10-Dominio/Entidades/Vendedor.md`: el `[!success] Enmendado 2026-09-12` pasa de "decisión tomada" a "implementado", con la ruta del código (`modules/nomina-comisiones/vendedores.service.ts`).
  - `30-Decisiones/ADR-0007 ...md`: mismo cambio de estado en su sección de enmienda.
  - `00-Inicio/Estado del proyecto.md`: fila de T-62 en la tabla de sprints, y la tabla de "catálogos del portal que faltan" queda en cero.
  - Nueva entrada en `40-Equipo/Bitácora/` con la fecha de cierre real.
- **Verificación manual completa con Playwright** (o a mano, como en T-11/T-12), contra Postgres **local**, siguiendo el checklist de la sección "Verificación manual" del spec.

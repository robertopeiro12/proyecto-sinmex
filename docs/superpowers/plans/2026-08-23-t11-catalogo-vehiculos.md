# T-11 · Catálogo de Vehículos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar de alta, editar y dar de baja vehículos de reparto (nombre + kilometraje al alta + sucursal) desde el portal, respetando el alcance por sucursal de T-09.

**Architecture:** Backend NestJS con el módulo en `modules/rutas/` (slug del vault, hoy un stub vacío), reusando `resolverAlcance()` de T-09 sin tocarla. En el portal, la pantalla se arma con `PantallaCatalogo` de T-10 sin agregarle ni un prop: el único campo condicional (el desplegable de sucursal, que solo ve un usuario General) vive dentro del formulario, que es opaco para el envoltorio.

**Tech Stack:** NestJS · Kysely · Postgres (Supabase) · pgTAP · Jest (backend) · Next.js 15 App Router · React 19 · Tailwind v4 · shadcn/ui

**Spec:** `docs/superpowers/specs/2026-08-23-t11-catalogo-vehiculos-design.md` — las decisiones se citan como D1…D7.

## Global Constraints

- **Rama:** `feature/t-11-vehiculos`, base `main`, sin pila. El spec ya está commiteado en `main`.
- **Idioma del código:** identificadores, comentarios y mensajes de error **en español**, **sin acentos en los identificadores** (sí en los mensajes de cara al usuario). Los comentarios explican *por qué*, no *qué*.
- **Todo comando se corre desde la raíz del repo** con `--workspace=`, nunca entrando a `apps/*`.
- **`npm test`, `npm run test:e2e` y `supabase test db` exigen el stack local arriba.** En **esta** máquina el daemon de Docker lo da **Colima** (`colima start`), no Docker Desktop — no está instalado aquí. Luego `npm run supabase start`. (El plan de T-10 decía lo contrario; estaba equivocado y ya se corrigió en `CLAUDE.md`.)
- **Nunca apuntar a `sinmex dev` durante la implementación.** `.env.test` va al Postgres local. Ojo: `npm run backend` lee `.env.development`, que **sí** apunta a la nube — para la verificación manual del portal hay que apuntar `DATABASE_URL` de `.env.development` al Postgres local primero (ver Task 5).
- **La baja siempre es lógica** (`activo = false`), nunca `delete` físico.
- **`deleted_at` jamás se expone en una respuesta de la API** (convención de T-09).
- **La respuesta de la API va en camelCase** (`kmInicial`, `sucursalId`), como `tokenRefresh` de T-06. El snake_case es exclusivo del contrato de sincronización, que es un contrato de cable versionado.
- **La migración solo agrega un índice, no columnas** → **no** hace falta correr `npm run db:types`. `Vehiculo` ya está en `schema.d.ts:241`.
- **Conteos de partida: NO están escritos en este plan a propósito.** El plan de T-10 hardcodeó cifras estimadas con `grep` y salieron mal (+8/+7). Antes de empezar, corre las tres suites y **anota tú los números reales**; en cada paso de verificación compara contra tu propia línea base, no contra una cifra escrita aquí.

---

### Task 0: Rama y línea base

**Files:** ninguno (solo verificación).

**Interfaces:**
- Consumes: nada.
- Produces: la rama `feature/t-11-vehiculos` y los conteos de partida que usarán todas las tareas siguientes.

- [ ] **Step 1: Crear la rama desde `main` limpio**

```bash
git status --short
git checkout main && git pull
git checkout -b feature/t-11-vehiculos
```

Esperado: `git status --short` vacío antes de cambiar de rama. Si hay algo, **detente** y resuélvelo (commit o stash) antes de seguir.

- [ ] **Step 2: Levantar el stack local**

```bash
colima start
npm run supabase -- start
```

Esperado: `supabase start` imprime las URLs locales. Si Colima ya estaba arriba, `colima start` no hace daño.

- [ ] **Step 3: Anotar la línea base de las tres suites**

```bash
npm run supabase -- test db
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm test --workspace=apps/portal
```

Anota los cuatro números (`Tests: N passed` de Jest/Vitest, y el total de pgTAP). **Todas las tareas siguientes comparan contra estos números, no contra cifras escritas en este plan.** Las cuatro suites tienen que estar en **verde** antes de tocar nada; si alguna falla en `main`, no es culpa tuya y hay que resolverlo antes de empezar.

- [ ] **Step 4: Confirmar que la tabla `vehiculo` está vacía**

```bash
psql "$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" -c \
  "select count(*) as vehiculos from vehiculo;"
```

Esperado: `vehiculos = 0`. Si no es 0, **detente**: el índice único de la Task 1 puede fallar sobre datos existentes y hay que decidir qué hacer con los duplicados antes de seguir.

---

### Task 1: Índice único en la base (D4)

**Files:**
- Create: `supabase/migrations/20260823120000_vehiculo_unicidad.sql`
- Create: `supabase/tests/95_vehiculo_unicidad_test.sql`

**Interfaces:**
- Consumes: nada.
- Produces: el índice `uq_vehiculo_nombre_sucursal`. El servicio de la Task 3 depende de que una violación levante el `SQLSTATE 23505` con `error.constraint = 'uq_vehiculo_nombre_sucursal'`.

- [ ] **Step 1: Escribir la prueba pgTAP que falla**

Crea `supabase/tests/95_vehiculo_unicidad_test.sql`:

```sql
begin;
select plan(5);

-- Las sucursales TJ y MX vienen de las semillas de T-05. Se leen por codigo en
-- vez de cablear uuids: los ids se generan al aplicar la migracion.
create temporary table ref as
  select
    (select id from sucursal where codigo = 'TJ') as tj,
    (select id from sucursal where codigo = 'MX') as mx;

insert into vehiculo (nombre, sucursal_id, km_inicial)
  select 'Nissan de prueba', tj, 1000 from ref;

select throws_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial)
    select 'Nissan de prueba', tj, 2000 from ref$$,
  '23505',
  null,
  'rechaza el mismo nombre repetido dentro de una sucursal'
);

-- 'lower()' en el indice: dos filas que solo difieren en mayusculas son el
-- mismo vehiculo para quien lo elige en la tablet.
select throws_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial)
    select 'NISSAN DE PRUEBA', tj, 2000 from ref$$,
  '23505',
  null,
  'trata distinta capitalizacion como duplicado'
);

-- El unique es por (sucursal_id, nombre), no global: cada sucursal puede tener
-- su propio "Nissan 2019".
select lives_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial)
    select 'Nissan de prueba', mx, 3000 from ref$$,
  'acepta el mismo nombre en dos sucursales distintas'
);

-- D4: desactivar NO libera el nombre. La baja del portal es `activo = false`, y
-- el indice no filtra por `activo` a proposito: mientras la fila exista el
-- nombre sigue siendo suyo, y lo que se quiere es reactivarla, no duplicarla.
update vehiculo set activo = false
  where nombre = 'Nissan de prueba'
    and sucursal_id = (select tj from ref);

select throws_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial)
    select 'Nissan de prueba', tj, 4000 from ref$$,
  '23505',
  null,
  'un vehiculo desactivado NO libera su nombre'
);

-- El 'where deleted_at is null' del indice. Hoy ningun camino de la API pone
-- `deleted_at` en vehiculo, pero el indice se escribio filtrado por consistencia
-- con uq_producto_nombre, y esta prueba fija ese comportamiento por si algun dia
-- aparece un borrado real.
update vehiculo set deleted_at = now()
  where nombre = 'Nissan de prueba'
    and sucursal_id = (select tj from ref);

select lives_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial)
    select 'Nissan de prueba', tj, 5000 from ref$$,
  'una fila con deleted_at si libera el nombre'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
npm run supabase -- test db
```

Esperado: `95_vehiculo_unicidad_test.sql` **falla** — los cuatro `throws_ok` no ven ningún error porque el índice todavía no existe. Los `lives_ok` sí pasan. Si pasa entera, el índice ya existía y hay algo raro: **detente**.

- [ ] **Step 3: Escribir la migración**

Crea `supabase/migrations/20260823120000_vehiculo_unicidad.sql`:

```sql
-- T-05 creo `vehiculo` sin ninguna restriccion de unicidad, y la base aceptaba
-- dos "Nissan 2019" en la misma sucursal. Va en la base y no solo en el DTO por
-- la misma razon que el check del codigo de sucursal (T-09), uq_producto_nombre
-- (T-10) y el unique del folio (T-14): las semillas y los scripts de alta entran
-- por debajo de la API.
--
-- Un vehiculo duplicado no se queda quieto: baja a la tablet por el pull de T-07
-- y el vendedor no sabe cual de los dos esta eligiendo al abrir su jornada.

-- Por sucursal, no global: cada sucursal puede tener su propio "Nissan 2019".
-- `lower()`: "Nissan 2019" y "nissan 2019" son el mismo vehiculo.
-- `where deleted_at is null`: por consistencia con uq_producto_nombre y con el
-- resto del esquema, donde `deleted_at` significa "esta fila ya no cuenta". Ojo:
-- el indice NO filtra por `activo`, asi que desactivar un vehiculo NO libera su
-- nombre — es deliberado (D4), lo que se quiere en ese caso es reactivarlo.
create unique index uq_vehiculo_nombre_sucursal
  on vehiculo (sucursal_id, lower(nombre))
  where deleted_at is null;
```

- [ ] **Step 4: Aplicar la migración y correr la prueba**

```bash
npm run supabase -- migration up --local
npm run supabase -- test db
```

Esperado: las 5 pruebas nuevas pasan, y el total sube en 5 sobre tu línea base de la Task 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260823120000_vehiculo_unicidad.sql supabase/tests/95_vehiculo_unicidad_test.sql
git commit -m "T-11 · Indice unico de vehiculo por (sucursal, nombre)

El indice no filtra por \`activo\` a proposito: desactivar un vehiculo NO
libera su nombre, igual que una sucursal desactivada conserva su codigo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `GET /vehiculos` con alcance por sucursal (D1, D2, D7)

**Files:**
- Create: `apps/backend/src/modules/rutas/vehiculos.repository.ts`
- Create: `apps/backend/src/modules/rutas/vehiculos.service.ts`
- Create: `apps/backend/src/modules/rutas/vehiculos.controller.ts`
- Modify: `apps/backend/src/modules/rutas/rutas.module.ts` (hoy son 4 líneas vacías)
- Create: `apps/backend/test/vehiculos.e2e-spec.ts`

**Interfaces:**
- Consumes: `resolverAlcance()` y `normalizarSucursalPedida()` de `../sucursales/alcance-sucursal` (sin modificarlas); `aNumero()` de `../sincronizacion/dinero`; `DB_CONNECTION`/`Database` de `../../database/database.tokens`; `@UsuarioActual()` de `../auth/usuario-actual.decorator`.
- Produces:
  - `interface Vehiculo { id: string; nombre: string; kmInicial: number | null; sucursalId: string; sucursalCodigo: string; activo: boolean }`
  - `VehiculosRepository.listar(): Promise<Vehiculo[]>`
  - `VehiculosRepository.listarPorCodigoSucursal(codigo: string): Promise<Vehiculo[]>`
  - `VehiculosRepository.buscarSucursalUsuario(usuarioId: string): Promise<{ id: string | null; codigo: string | null } | undefined>`
  - `VehiculosService.listar(usuarioId: string, sucursalPedida: string | null): Promise<Vehiculo[]>`
  - Las Tasks 3 y 4 agregan métodos a estas mismas clases.

> [!warning] `km_inicial` es `numeric` y Postgres lo devuelve como **cadena**
> `schema.d.ts:24` declara `Numeric = ColumnType<string, number | string, number | string>`: al **leer**, el driver `pg` entrega `"1000.00"`, no `1000`. Sin convertir, el portal recibiría `"1000.00"` entre comillas y cualquier comparación numérica fallaría en silencio. Se convierte con `aNumero()` de `modules/sincronizacion/dinero.ts`, que ya existe y ya se usa para `lat`/`lng`. **Se importa en vez de duplicarse**: es una función pura, sin DI ni registro de módulo, y un segundo parser de números es exactamente lo que acaba divergiendo. (Que viva en un archivo llamado `dinero.ts` es un accidente de dónde nació; su propio comentario dice *"Para porcentajes y coordenadas, no dinero"*. Moverla a un lugar compartido es un ticket propio, no de aquí.)

- [ ] **Step 1: Escribir la prueba e2e que falla**

Crea `apps/backend/test/vehiculos.e2e-spec.ts`. Este archivo crece en las Tasks 3 y 4; empieza con el andamiaje completo y las pruebas del `GET`:

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

interface VehiculoRespuesta {
  id: string;
  nombre: string;
  kmInicial: number | null;
  sucursalId: string;
  sucursalCodigo: string;
  activo: boolean;
}

const SUFIJO = Date.now();
const LOGIN_GENERAL = `e2e-veh-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-veh-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-veh-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';

// Prefijo reservado: la limpieza de afterAll borra por `nombre like`. Sin el,
// una corrida que deje basura envenena la siguiente con 409 inesperados.
const PREFIJO = `ZZ-e2e-${SUFIJO}`;

describe('Vehiculos (e2e)', () => {
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

  /** Inserta un vehiculo por debajo de la API, para preparar escenarios. */
  const sembrarVehiculo = async (
    nombre: string,
    sucursalId: string,
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vehiculo')
      .values({ nombre, sucursal_id: sucursalId, km_inicial: 1000 })
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

    // Los DOS primeros usuarios son el corazon de la suite: con uno solo, la
    // regla de alcance (D2/D3) queda sin verificar de punta a punta.
    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', idTijuana);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);

    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    await db.deleteFrom('vehiculo').where('nombre', 'like', `${PREFIJO}%`).execute();
    if (usuarioIds.length > 0) {
      // `iniciarSesion` deja una fila en `sesion_refresh`: hay que borrarla
      // antes que el usuario o el FK truena (mismo orden que
      // sucursales.e2e-spec.ts).
      await db
        .deleteFrom('sesion_refresh')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await app.close();
  });

  describe('GET /vehiculos', () => {
    it('lista los vehiculos con su codigo de sucursal y el km como numero', async () => {
      await sembrarVehiculo(`${PREFIJO} Listar TJ`, idTijuana);

      const res = await request(app.getHttpServer())
        .get('/vehiculos')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const vehiculos = res.body as VehiculoRespuesta[];
      const propio = vehiculos.find((v) => v.nombre === `${PREFIJO} Listar TJ`);
      expect(propio).toBeDefined();
      expect(propio?.sucursalCodigo).toBe('TJ');
      expect(propio?.activo).toBe(true);
      // `numeric` de Postgres llega como cadena si nadie lo convierte. Esta
      // asercion es la red que atrapa esa regresion.
      expect(typeof propio?.kmInicial).toBe('number');
      expect(propio?.kmInicial).toBe(1000);
      expect(propio).not.toHaveProperty('deleted_at');
    });

    it('un usuario atado a TJ no ve los vehiculos de MX', async () => {
      await sembrarVehiculo(`${PREFIJO} Solo MX`, idMexicali);

      const res = await request(app.getHttpServer())
        .get('/vehiculos')
        .set('Cookie', cookieTijuana)
        .expect(200);

      const nombres = (res.body as VehiculoRespuesta[]).map((v) => v.nombre);
      expect(nombres).not.toContain(`${PREFIJO} Solo MX`);
    });

    it('un usuario atado que pide "todas" recibe la suya, no un 403', async () => {
      await request(app.getHttpServer())
        .get('/vehiculos?sucursal=todas')
        .set('Cookie', cookieTijuana)
        .expect(200);
    });

    it('un usuario atado que pide OTRA sucursal recibe 403', async () => {
      await request(app.getHttpServer())
        .get('/vehiculos?sucursal=MX')
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('el usuario General puede filtrar por una sucursal concreta', async () => {
      const res = await request(app.getHttpServer())
        .get('/vehiculos?sucursal=MX')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const codigos = (res.body as VehiculoRespuesta[]).map(
        (v) => v.sucursalCodigo,
      );
      expect(codigos.every((c) => c === 'MX')).toBe(true);
    });

    // Defiende D5 del spec: si alguien le pone el candado al GET, Rutas (T-38)
    // y los reportes se quedan sin catalogo de vehiculos.
    it('deja listar aunque el usuario no tenga vehiculo.gestionar', async () => {
      await request(app.getHttpServer())
        .get('/vehiculos')
        .set('Cookie', cookieSinPermiso)
        .expect(200);
    });

    it('rechaza a quien no tiene sesion', async () => {
      await request(app.getHttpServer()).get('/vehiculos').expect(401);
    });
  });
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend -- vehiculos
```

Esperado: **falla** con 404 en todas las peticiones a `/vehiculos` — la ruta todavía no existe.

- [ ] **Step 3: Escribir el repositorio**

Crea `apps/backend/src/modules/rutas/vehiculos.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aNumero } from '../sincronizacion/dinero';

export interface Vehiculo {
  id: string;
  nombre: string;
  kmInicial: number | null;
  sucursalId: string;
  sucursalCodigo: string;
  activo: boolean;
}

/**
 * `km_inicial` es `numeric`, y el driver `pg` lo devuelve como CADENA
 * ("1000.00"), no como numero -- ver `Numeric` en schema.d.ts. `aNumero()` es la
 * misma conversion que ya usa el pull de T-07 para lat/lng; se importa en vez de
 * duplicarse porque un segundo parser de numeros acaba divergiendo del primero.
 *
 * `deleted_at` no sale nunca a la API (convencion de T-09), asi que ni se
 * selecciona.
 */
function aVehiculo(fila: {
  id: string;
  nombre: string;
  km_inicial: string | null;
  sucursal_id: string;
  codigo: string;
  activo: boolean;
}): Vehiculo {
  return {
    id: fila.id,
    nombre: fila.nombre,
    kmInicial: aNumero(fila.km_inicial),
    sucursalId: fila.sucursal_id,
    sucursalCodigo: fila.codigo,
    activo: fila.activo,
  };
}

@Injectable()
export class VehiculosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * El join a `sucursal` trae el codigo junto al id: la tabla del portal pinta
   * el codigo, y sin el haria una segunda peticion solo para traducir uuid ->
   * codigo.
   *
   * Devuelve activos E inactivos a proposito: la pantalla del catalogo necesita
   * ver un vehiculo desactivado para poder reactivarlo (mismo criterio que
   * SucursalesRepository.listar de T-09 y ProductosRepository.listar de T-10).
   */
  async listar(): Promise<Vehiculo[]> {
    const filas = await this.db
      .selectFrom('vehiculo')
      .innerJoin('sucursal', 'sucursal.id', 'vehiculo.sucursal_id')
      .select([
        'vehiculo.id',
        'vehiculo.nombre',
        'vehiculo.km_inicial',
        'vehiculo.sucursal_id',
        'sucursal.codigo',
        'vehiculo.activo',
      ])
      .where('vehiculo.deleted_at', 'is', null)
      .orderBy('sucursal.codigo')
      .orderBy('vehiculo.nombre')
      .execute();

    return filas.map(aVehiculo);
  }

  async listarPorCodigoSucursal(codigo: string): Promise<Vehiculo[]> {
    const filas = await this.db
      .selectFrom('vehiculo')
      .innerJoin('sucursal', 'sucursal.id', 'vehiculo.sucursal_id')
      .select([
        'vehiculo.id',
        'vehiculo.nombre',
        'vehiculo.km_inicial',
        'vehiculo.sucursal_id',
        'sucursal.codigo',
        'vehiculo.activo',
      ])
      .where('vehiculo.deleted_at', 'is', null)
      .where('sucursal.codigo', '=', codigo)
      .orderBy('vehiculo.nombre')
      .execute();

    return filas.map(aVehiculo);
  }

  /**
   * La sucursal del usuario. Distingue tres casos que NO se pueden colapsar:
   *   - `undefined`                 -> el usuario no existe o esta dado de baja
   *   - `{ id: null, codigo: null }` -> existe y es General
   *   - `{ id: '…', codigo: 'TJ' }`  -> existe y esta atado a Tijuana
   * Devolver null para los dos primeros convertiria a un usuario borrado en uno
   * con acceso a todas las sucursales.
   *
   * Duplica ~10 lineas del repositorio de sucursales a proposito (D7): la
   * alternativa es una capa compartida de "repositorio con alcance" que hoy solo
   * usarian dos modulos. Se extrae cuando aparezca la tercera copia, no antes --
   * mismo criterio con el que T-10 dejo `esDuplicado()` triplicado.
   *
   * Diferencia con el de sucursales: este devuelve tambien el `id`, porque el
   * alta lo necesita para el insert (D3).
   */
  async buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return this.db
      .selectFrom('usuario')
      .leftJoin('sucursal', 'sucursal.id', 'usuario.sucursal_id')
      .select(['sucursal.id as id', 'sucursal.codigo as codigo'])
      .where('usuario.id', '=', usuarioId)
      .where('usuario.deleted_at', 'is', null)
      .executeTakeFirst();
  }
}
```

- [ ] **Step 4: Escribir el servicio**

Crea `apps/backend/src/modules/rutas/vehiculos.service.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  resolverAlcance,
  type Alcance,
} from '../sucursales/alcance-sucursal';
import { VehiculosRepository, type Vehiculo } from './vehiculos.repository';

@Injectable()
export class VehiculosService {
  constructor(private readonly repo: VehiculosRepository) {}

  async listar(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Vehiculo[]> {
    const alcance = await this.alcanceDe(usuarioId, sucursalPedida);
    return alcance.tipo === 'todas'
      ? this.repo.listar()
      : this.repo.listarPorCodigoSucursal(alcance.codigo);
  }

  /**
   * El JWT solo lleva `sub` y `tipo` (decision de T-06), asi que la sucursal del
   * usuario no viaja en el token y hay que consultarla. Misma forma que
   * SucursalesService.alcanceDe de T-09.
   */
  private async alcanceDe(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Alcance> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    // Un token vivo de alguien dado de baja llega hasta aqui.
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    return resolverAlcance(fila.codigo, sucursalPedida);
  }
}
```

- [ ] **Step 5: Escribir el controlador**

Crea `apps/backend/src/modules/rutas/vehiculos.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import { VehiculosService } from './vehiculos.service';
import type { Vehiculo } from './vehiculos.repository';

// Sin @Publico(): el guard global de app.module.ts protege todo por defecto.
// Listar NO exige `vehiculo.gestionar` a proposito: el catalogo lo van a
// necesitar Rutas (T-38) y los reportes de kilometraje, no solo quien lo
// administra. El alcance de lo que cada quien VE ya lo acota
// alcance-sucursal.ts. Crear y editar SI lo exigen (Tasks 3 y 4).
@Controller('vehiculos')
export class VehiculosController {
  constructor(private readonly vehiculos: VehiculosService) {}

  @Get()
  async listar(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
  ): Promise<Vehiculo[]> {
    return this.vehiculos.listar(usuarioId, normalizarSucursalPedida(sucursal));
  }
}
```

- [ ] **Step 6: Llenar el módulo, que hoy está vacío**

Reemplaza `apps/backend/src/modules/rutas/rutas.module.ts` entero:

```ts
import { Module } from '@nestjs/common';
import { VehiculosController } from './vehiculos.controller';
import { VehiculosRepository } from './vehiculos.repository';
import { VehiculosService } from './vehiculos.service';

// Vehiculos vive aqui y no en un `modules/vehiculos/` nuevo: el CLAUDE.md fija
// que los modulos usan los slugs del vault, y `Vehículo.md` declara
// `modulo: rutas` (D1).
@Module({
  controllers: [VehiculosController],
  providers: [VehiculosService, VehiculosRepository],
})
export class RutasModule {}
```

`RutasModule` ya está importado en `app.module.ts:21` y registrado en `imports` — **no hay que tocar `app.module.ts`**.

- [ ] **Step 7: Correr la prueba para verificar que pasa**

```bash
npm run test:e2e --workspace=apps/backend -- vehiculos
```

Esperado: las 7 pruebas del `describe('GET /vehiculos')` en verde.

- [ ] **Step 8: Verificar que no se rompió nada más**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
```

Esperado: lint sin errores, build limpio, y el total de e2e = tu línea base + 7.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/rutas/ apps/backend/test/vehiculos.e2e-spec.ts
git commit -m "T-11 · GET /vehiculos con alcance por sucursal

El modulo vive en modules/rutas/ porque Vehículo.md del vault declara
modulo: rutas (D1). RutasModule ya estaba registrado en app.module.ts.

km_inicial se convierte con aNumero(): \`numeric\` llega como cadena desde
el driver pg y sin convertir el portal recibiria \"1000.00\" entre comillas.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `POST /vehiculos` — el servidor decide la sucursal (D3, D4)

**Files:**
- Create: `apps/backend/src/modules/rutas/dto/crear-vehiculo.dto.ts`
- Modify: `apps/backend/src/modules/rutas/vehiculos.repository.ts` (agrega `crear()`)
- Modify: `apps/backend/src/modules/rutas/vehiculos.service.ts` (agrega `crear()` y `esDuplicado()`)
- Modify: `apps/backend/src/modules/rutas/vehiculos.controller.ts` (agrega `@Post()`)
- Modify: `apps/backend/test/vehiculos.e2e-spec.ts` (agrega un `describe`)

**Interfaces:**
- Consumes: todo lo que produjo la Task 2.
- Produces:
  - `CrearVehiculoDto { nombre: string; kmInicial: number; sucursalId?: string }`
  - `VehiculosRepository.crear(nombre: string, kmInicial: number, sucursalId: string): Promise<Vehiculo>`
  - `VehiculosService.crear(usuarioId: string, dto: CrearVehiculoDto): Promise<Vehiculo>`

- [ ] **Step 1: Escribir las pruebas e2e que fallan**

Agrega este `describe` dentro del `describe('Vehiculos (e2e)')` de `apps/backend/test/vehiculos.e2e-spec.ts`, después del `describe('GET /vehiculos')`:

```ts
  describe('POST /vehiculos', () => {
    it('un usuario atado crea en SU sucursal sin mandarla', async () => {
      const res = await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Nissan TJ`, kmInicial: 145230.5 })
        .expect(201);

      const vehiculo = res.body as VehiculoRespuesta;
      expect(vehiculo.sucursalCodigo).toBe('TJ');
      expect(vehiculo.kmInicial).toBe(145230.5);
      expect(vehiculo.activo).toBe(true);
    });

    // D3: el cliente propone, el servidor dispone. Mandar otra sucursal no es un
    // intento de escalada (el formulario ni siquiera pinta el campo para el), es
    // un cuerpo que sobra: se ignora en silencio, no se responde 403.
    it('a un usuario atado se le IGNORA el sucursalId que mande', async () => {
      const res = await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Colado`,
          kmInicial: 100,
          sucursalId: idMexicali,
        })
        .expect(201);

      expect((res.body as VehiculoRespuesta).sucursalCodigo).toBe('TJ');
    });

    it('el usuario General elige la sucursal', async () => {
      const res = await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} Nissan MX`,
          kmInicial: 200,
          sucursalId: idMexicali,
        })
        .expect(201);

      expect((res.body as VehiculoRespuesta).sucursalCodigo).toBe('MX');
    });

    it('el usuario General sin sucursalId recibe 400', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Sin sucursal`, kmInicial: 300 })
        .expect(400);
    });

    it('rechaza un nombre repetido en la misma sucursal con 409', async () => {
      const cuerpo = { nombre: `${PREFIJO} Repetido`, kmInicial: 400 };
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send(cuerpo)
        .expect(201);

      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send(cuerpo)
        .expect(409);
    });

    it('rechaza un nombre repetido que solo cambia en mayusculas', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Mayusculas`, kmInicial: 500 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} MAYUSCULAS`, kmInicial: 500 })
        .expect(409);
    });

    // D4: el indice no filtra por `activo`, asi que desactivar no libera el
    // nombre. Lo que se quiere en ese caso es reactivar, no duplicar.
    it('un vehiculo desactivado sigue reservando su nombre', async () => {
      const id = await sembrarVehiculo(`${PREFIJO} Dormido`, idTijuana);
      await db
        .updateTable('vehiculo')
        .set({ activo: false })
        .where('id', '=', id)
        .execute();

      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Dormido`, kmInicial: 600 })
        .expect(409);
    });

    it('acepta el mismo nombre en dos sucursales distintas', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} Compartido`,
          kmInicial: 700,
          sucursalId: idTijuana,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} Compartido`,
          kmInicial: 700,
          sucursalId: idMexicali,
        })
        .expect(201);
    });

    it('rechaza crear sin el permiso vehiculo.gestionar', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieSinPermiso)
        .send({ nombre: `${PREFIJO} Prohibido`, kmInicial: 800 })
        .expect(403);
    });

    it('rechaza un kilometraje negativo con 400', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Negativo`, kmInicial: -1 })
        .expect(400);
    });

    it('rechaza un nombre vacio con 400', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({ nombre: '   ', kmInicial: 900 })
        .expect(400);
    });
  });
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

```bash
npm run test:e2e --workspace=apps/backend -- vehiculos
```

Esperado: las 11 nuevas **fallan** con 404 (no hay `@Post()` todavía); las 7 del `GET` siguen en verde.

- [ ] **Step 3: Escribir el DTO**

Crea `apps/backend/src/modules/rutas/dto/crear-vehiculo.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Quita espacios sobrantes sin reventar si llega algo que no es cadena. */
const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CrearVehiculoDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del vehículo es obligatorio.' })
  // La columna es `text` (sin limite). El tope vive aqui porque un campo de
  // texto sin cota es una invitacion a meter un documento entero en un catalogo
  // que se pinta en una tabla. Mismo tope que sucursal y producto.
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;

  // La columna es `numeric(10,2)` y NULLABLE en la base, pero el alta lo exige:
  // un vehiculo sin km de partida deja el reporte de kilometraje sin origen. No
  // se cambia la columna a `not null` por un campo que la API ya obliga (ver el
  // spec, seccion Modelo de datos).
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El kilometraje debe ser un número con hasta 2 decimales.' },
  )
  @Min(0, { message: 'El kilometraje no puede ser negativo.' })
  kmInicial!: number;

  // Opcional a proposito (D3): solo lo manda —y solo se le hace caso a— un
  // usuario General. A un usuario atado a una sucursal se le IGNORA, no se le
  // responde 403: no esta intentando salirse de su alcance, esta mandando un
  // campo que su formulario ni siquiera pinta.
  @IsOptional()
  @IsUUID()
  sucursalId?: string;
}
```

- [ ] **Step 4: Agregar `crear()` al repositorio**

Agrega este método a `VehiculosRepository` en `apps/backend/src/modules/rutas/vehiculos.repository.ts`, después de `listarPorCodigoSucursal()`:

```ts
  /**
   * Sin transaccion: es un solo insert. La lectura del codigo de sucursal va
   * despues porque `returning` no puede traer columnas de la tabla del join.
   */
  async crear(
    nombre: string,
    kmInicial: number,
    sucursalId: string,
  ): Promise<Vehiculo> {
    const fila = await this.db
      .insertInto('vehiculo')
      .values({ nombre, km_inicial: kmInicial, sucursal_id: sucursalId })
      .returning(['id', 'nombre', 'km_inicial', 'sucursal_id', 'activo'])
      .executeTakeFirstOrThrow();

    const sucursal = await this.db
      .selectFrom('sucursal')
      .select('codigo')
      .where('id', '=', sucursalId)
      .executeTakeFirstOrThrow();

    return aVehiculo({ ...fila, codigo: sucursal.codigo });
  }
```

- [ ] **Step 5: Agregar `crear()` al servicio**

En `apps/backend/src/modules/rutas/vehiculos.service.ts`: agrega los imports, la función `esDuplicado()` a nivel de módulo, y el método `crear()`.

Cambia la línea de import de `@nestjs/common` por:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
```

Agrega el import del DTO junto a los demás:

```ts
import type { CrearVehiculoDto } from './dto/crear-vehiculo.dto';
```

Agrega antes de `@Injectable()`:

```ts
/**
 * `23505` es unique_violation. Se mira DESPUES del insert en vez de consultar
 * antes si el nombre existe: una consulta previa deja una ventana entre el
 * SELECT y el INSERT en la que otra peticion puede meter el mismo nombre, y el
 * unique de la base es quien de verdad decide. Mismo criterio que T-09 y T-10.
 *
 * Aqui no hace falta distinguir POR indice (como si hizo T-10 con
 * `nombreDelIndice`): `vehiculo` tiene un solo unique, asi que cualquier 23505
 * de esta tabla es el nombre repetido.
 */
function esDuplicado(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}
```

Agrega este método a la clase, después de `listar()`:

```ts
  /**
   * D3 — el cliente propone, el servidor dispone. La sucursal sale del alcance
   * del usuario, no del cuerpo de la peticion:
   *   - atado a una sucursal -> la suya, y el `sucursalId` que mande se IGNORA
   *   - General               -> tiene que mandarlo; si no llega, es 400
   */
  async crear(usuarioId: string, dto: CrearVehiculoDto): Promise<Vehiculo> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }

    const sucursalId = fila.id ?? dto.sucursalId;
    if (!sucursalId) {
      throw new BadRequestException(
        'Indica a qué sucursal pertenece el vehículo.',
      );
    }

    try {
      return await this.repo.crear(dto.nombre, dto.kmInicial, sucursalId);
    } catch (error) {
      if (esDuplicado(error)) {
        throw new ConflictException(
          `Ya existe un vehículo llamado "${dto.nombre}" en esa sucursal.`,
        );
      }
      throw error;
    }
  }
```

- [ ] **Step 6: Agregar el `@Post()` al controlador**

En `apps/backend/src/modules/rutas/vehiculos.controller.ts`, cambia el import de `@nestjs/common` por:

```ts
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
```

Agrega estos dos imports:

```ts
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { CrearVehiculoDto } from './dto/crear-vehiculo.dto';
```

Y agrega el método a la clase, después de `listar()`:

```ts
  @Post()
  @RequierePermiso('vehiculo.gestionar')
  async crear(
    @UsuarioActual() usuarioId: string,
    @Body() dto: CrearVehiculoDto,
  ): Promise<Vehiculo> {
    return this.vehiculos.crear(usuarioId, dto);
  }
```

El permiso `vehiculo.gestionar` **ya existe** desde las semillas de T-05 (`20260803163500_semillas.sql:34`, grupo `Operacion Comercial`). No hace falta la migración de permiso que T-08a sí necesitó para `sucursal.gestionar`.

- [ ] **Step 7: Correr las pruebas para verificar que pasan**

```bash
npm run test:e2e --workspace=apps/backend -- vehiculos
```

Esperado: las 18 (7 del `GET` + 11 del `POST`) en verde.

- [ ] **Step 8: Verificar que no se rompió nada más**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
```

Esperado: lint y build limpios, y el total de e2e = tu línea base + 18.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/rutas/ apps/backend/test/vehiculos.e2e-spec.ts
git commit -m "T-11 · POST /vehiculos, la sucursal la decide el alcance

A un usuario atado a una sucursal se le IGNORA el sucursalId que mande, no
se le responde 403: no intenta salirse de su alcance, manda un campo que su
formulario ni siquiera pinta. Un usuario General si tiene que mandarlo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `PATCH /vehiculos/:id` — editar y dar de baja (D3, D5, D6)

**Files:**
- Create: `apps/backend/src/modules/rutas/dto/editar-vehiculo.dto.ts`
- Modify: `apps/backend/src/modules/rutas/vehiculos.repository.ts` (agrega `buscarPorId()` y `actualizar()`)
- Modify: `apps/backend/src/modules/rutas/vehiculos.service.ts` (agrega `editar()`)
- Modify: `apps/backend/src/modules/rutas/vehiculos.controller.ts` (agrega `@Patch()`)
- Modify: `apps/backend/test/vehiculos.e2e-spec.ts` (agrega un `describe`)

**Interfaces:**
- Consumes: todo lo que produjeron las Tasks 2 y 3.
- Produces:
  - `EditarVehiculoDto { nombre?: string; kmInicial?: number; activo?: boolean }`
  - `VehiculosRepository.buscarPorId(id: string): Promise<Vehiculo | undefined>`
  - `VehiculosRepository.actualizar(id, cambios: { nombre?: string; km_inicial?: number; activo?: boolean }): Promise<Vehiculo>`
  - `VehiculosService.editar(usuarioId: string, id: string, dto: EditarVehiculoDto): Promise<Vehiculo>`

- [ ] **Step 1: Escribir las pruebas e2e que fallan**

Agrega este `describe` dentro del `describe('Vehiculos (e2e)')`, después del `describe('POST /vehiculos')`:

```ts
  describe('PATCH /vehiculos/:id', () => {
    it('edita el nombre y el kilometraje', async () => {
      const id = await sembrarVehiculo(`${PREFIJO} Editable`, idTijuana);

      const res = await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Editado`, kmInicial: 99999.99 })
        .expect(200);

      const vehiculo = res.body as VehiculoRespuesta;
      expect(vehiculo.nombre).toBe(`${PREFIJO} Editado`);
      // D6: el km al alta se puede corregir siempre. No es como el codigo de
      // sucursal ni el folio, que quedan escritos en documentos que no se pueden
      // corregir hacia atras.
      expect(vehiculo.kmInicial).toBe(99999.99);
    });

    it('da de baja y vuelve a activar', async () => {
      const id = await sembrarVehiculo(`${PREFIJO} Baja`, idTijuana);

      const baja = await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ activo: false })
        .expect(200);
      expect((baja.body as VehiculoRespuesta).activo).toBe(false);

      // Sigue apareciendo en la lista: la pantalla necesita verlo para poder
      // reactivarlo.
      const lista = await request(app.getHttpServer())
        .get('/vehiculos')
        .set('Cookie', cookieTijuana)
        .expect(200);
      expect(
        (lista.body as VehiculoRespuesta[]).some((v) => v.id === id),
      ).toBe(true);

      const alta = await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ activo: true })
        .expect(200);
      expect((alta.body as VehiculoRespuesta).activo).toBe(true);
    });

    // D3: el alcance manda igual en escritura que en lectura, y se compara
    // contra la sucursal del vehiculo YA LEIDO, no contra lo que diga el cliente.
    it('un usuario de TJ no puede editar un vehiculo de MX', async () => {
      const id = await sembrarVehiculo(`${PREFIJO} Ajeno`, idMexicali);

      await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Secuestrado` })
        .expect(403);
    });

    it('el usuario General si puede editar en cualquier sucursal', async () => {
      const id = await sembrarVehiculo(`${PREFIJO} General edita`, idMexicali);

      await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} General edito` })
        .expect(200);
    });

    it('un PATCH sin ningun campo responde 400', async () => {
      const id = await sembrarVehiculo(`${PREFIJO} Vacio`, idTijuana);

      await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieTijuana)
        .send({})
        .expect(400);
    });

    it('un id que no existe responde 404', async () => {
      await request(app.getHttpServer())
        .patch('/vehiculos/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Fantasma` })
        .expect(404);
    });

    // ParseUUIDPipe: sin el, la cadena llegaria a Postgres y saldria como 500.
    it('un id mal formado responde 400, no 500', async () => {
      await request(app.getHttpServer())
        .patch('/vehiculos/no-soy-un-uuid')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Basura` })
        .expect(400);
    });

    it('renombrar a un nombre ya tomado en la sucursal responde 409', async () => {
      await sembrarVehiculo(`${PREFIJO} Ocupado`, idTijuana);
      const id = await sembrarVehiculo(`${PREFIJO} Aspirante`, idTijuana);

      await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Ocupado` })
        .expect(409);
    });

    it('rechaza editar sin el permiso vehiculo.gestionar', async () => {
      const id = await sembrarVehiculo(`${PREFIJO} Blindado`, idTijuana);

      await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieSinPermiso)
        .send({ nombre: `${PREFIJO} Hackeado` })
        .expect(403);
    });

    // D3: la sucursal de un vehiculo no se puede cambiar, y el DTO ni siquiera
    // lleva el campo.
    //
    // El 400 NO sale de rechazar el campo: `configurar-app.ts:42` configura el
    // ValidationPipe con `whitelist: true` pero SIN `forbidNonWhitelisted`, asi
    // que `sucursalId` se descarta en SILENCIO. Lo que queda es un cuerpo vacio,
    // y el 400 lo produce el "No hay nada que actualizar" del servicio.
    //
    // El efecto visible es el correcto (la sucursal no cambia) y por eso la
    // prueba vale, pero el mensaje de error hablara de campos faltantes en vez
    // de decir "la sucursal no se puede cambiar". Agregar `forbidNonWhitelisted`
    // arreglaria el mensaje a costa de endurecer TODOS los endpoints del
    // proyecto de golpe: no es una decision de este ticket.
    it('no deja cambiar la sucursal de un vehiculo', async () => {
      const id = await sembrarVehiculo(`${PREFIJO} Arraigado`, idTijuana);

      await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieGeneral)
        .send({ sucursalId: idMexicali })
        .expect(400);

      // Lo que de verdad importa: la sucursal siguio siendo la misma.
      const fila = await db
        .selectFrom('vehiculo')
        .select('sucursal_id')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(fila.sucursal_id).toBe(idTijuana);
    });
  });
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

```bash
npm run test:e2e --workspace=apps/backend -- vehiculos
```

Esperado: las 10 nuevas **fallan** con 404 (no hay `@Patch()`); las 18 anteriores siguen en verde.

- [ ] **Step 3: Escribir el DTO**

Crea `apps/backend/src/modules/rutas/dto/editar-vehiculo.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Los tres campos son opcionales: el servicio rechaza con 400 el cuerpo que no
 * traiga ninguno.
 *
 * SIN `sucursalId` a proposito (D3): la sucursal de un vehiculo no se cambia.
 * Mover uno de sucursal cambiaria a que alcance pertenecen sus registros
 * historicos de kilometraje. Si el negocio de verdad reasigna vehiculos, es un
 * ticket propio con su propia regla para el historico.
 */
export class EditarVehiculoDto {
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del vehículo es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre?: string;

  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El kilometraje debe ser un número con hasta 2 decimales.' },
  )
  @Min(0, { message: 'El kilometraje no puede ser negativo.' })
  kmInicial?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
```

- [ ] **Step 4: Agregar `buscarPorId()` y `actualizar()` al repositorio**

Agrega estos dos métodos a `VehiculosRepository`, después de `crear()`:

```ts
  async buscarPorId(id: string): Promise<Vehiculo | undefined> {
    const fila = await this.db
      .selectFrom('vehiculo')
      .innerJoin('sucursal', 'sucursal.id', 'vehiculo.sucursal_id')
      .select([
        'vehiculo.id',
        'vehiculo.nombre',
        'vehiculo.km_inicial',
        'vehiculo.sucursal_id',
        'sucursal.codigo',
        'vehiculo.activo',
      ])
      .where('vehiculo.id', '=', id)
      .where('vehiculo.deleted_at', 'is', null)
      .executeTakeFirst();

    return fila ? aVehiculo(fila) : undefined;
  }

  /**
   * `cambios` nunca llega vacio: el servicio lo comprueba antes. Un `.set({})`
   * genera SQL invalido, asi que el chequeo no es cortesia, es necesario.
   *
   * La sucursal no se toca (D3), asi que el codigo se lee de la fila que ya
   * existe y no hace falta un segundo join en el `returning`.
   */
  async actualizar(
    id: string,
    cambios: { nombre?: string; km_inicial?: number; activo?: boolean },
  ): Promise<Vehiculo> {
    const fila = await this.db
      .updateTable('vehiculo')
      .set(cambios)
      .where('id', '=', id)
      .returning(['id', 'nombre', 'km_inicial', 'sucursal_id', 'activo'])
      .executeTakeFirstOrThrow();

    const sucursal = await this.db
      .selectFrom('sucursal')
      .select('codigo')
      .where('id', '=', fila.sucursal_id)
      .executeTakeFirstOrThrow();

    return aVehiculo({ ...fila, codigo: sucursal.codigo });
  }
```

- [ ] **Step 5: Agregar `editar()` al servicio**

Agrega el import del DTO junto al de `CrearVehiculoDto`:

```ts
import type { EditarVehiculoDto } from './dto/editar-vehiculo.dto';
```

Agrega `ForbiddenException` y `NotFoundException` al import de `@nestjs/common`, que queda así:

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

Y agrega este método a la clase, después de `crear()`:

```ts
  async editar(
    usuarioId: string,
    id: string,
    dto: EditarVehiculoDto,
  ): Promise<Vehiculo> {
    // El 400 va ANTES de tocar la base: un PATCH sin cambios no es un fallo del
    // servidor ni justifica una consulta, es un cuerpo mal armado.
    if (
      dto.nombre === undefined &&
      dto.kmInicial === undefined &&
      dto.activo === undefined
    ) {
      throw new BadRequestException('No hay nada que actualizar.');
    }

    const vehiculo = await this.repo.buscarPorId(id);
    if (!vehiculo) {
      throw new NotFoundException('No existe ese vehículo.');
    }

    // El alcance manda igual en escritura que en lectura (D3). Se compara contra
    // la sucursal del vehiculo YA LEIDO y no contra el query param: aqui el
    // objeto que se va a modificar es el hecho, no lo que el cliente diga.
    const alcance = await this.alcanceDe(usuarioId, null);
    if (
      alcance.tipo === 'una' &&
      alcance.codigo !== vehiculo.sucursalCodigo
    ) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }

    const cambios: { nombre?: string; km_inicial?: number; activo?: boolean } =
      {};
    if (dto.nombre !== undefined) {
      cambios.nombre = dto.nombre;
    }
    if (dto.kmInicial !== undefined) {
      cambios.km_inicial = dto.kmInicial;
    }
    if (dto.activo !== undefined) {
      cambios.activo = dto.activo;
    }

    try {
      return await this.repo.actualizar(id, cambios);
    } catch (error) {
      if (esDuplicado(error)) {
        throw new ConflictException(
          `Ya existe un vehículo llamado "${dto.nombre ?? vehiculo.nombre}" en esa sucursal.`,
        );
      }
      throw error;
    }
  }
```

- [ ] **Step 6: Agregar el `@Patch()` al controlador**

Cambia el import de `@nestjs/common` por:

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

Agrega el import del DTO:

```ts
import { EditarVehiculoDto } from './dto/editar-vehiculo.dto';
```

Y agrega el método a la clase, después de `crear()`:

```ts
  @Patch(':id')
  @RequierePermiso('vehiculo.gestionar')
  async editar(
    @UsuarioActual() usuarioId: string,
    // ParseUUIDPipe convierte un id mal formado en 400. Sin el, la cadena
    // llegaria a Postgres y saldria como 500 (mismo motivo que T-09 y T-10).
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarVehiculoDto,
  ): Promise<Vehiculo> {
    return this.vehiculos.editar(usuarioId, id, dto);
  }
```

- [ ] **Step 7: Correr las pruebas para verificar que pasan**

```bash
npm run test:e2e --workspace=apps/backend -- vehiculos
```

Esperado: las 28 (7 + 11 + 10) en verde.

- [ ] **Step 8: Verificar la suite completa del backend**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm run supabase -- test db
```

Esperado: lint y build limpios · unitarias **sin cambio** respecto a tu línea base (este ticket no agrega ninguna: `resolverAlcance()` ya tiene las suyas desde T-09 y no se tocó) · e2e = línea base + 28 · pgTAP = línea base + 5.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/rutas/ apps/backend/test/vehiculos.e2e-spec.ts
git commit -m "T-11 · PATCH /vehiculos/:id, editar y dar de baja

El km al alta se puede corregir siempre (D6): no es como el codigo de
sucursal ni el folio, que quedan escritos en documentos que no se pueden
corregir hacia atras. La sucursal en cambio NO se puede cambiar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: La pantalla del portal (D7)

**Files:**
- Create: `apps/portal/src/lib/vehiculos.ts`
- Create: `apps/portal/src/components/vehiculos/pantalla-vehiculos.tsx`
- Create: `apps/portal/src/components/vehiculos/formulario-vehiculo.tsx`
- Modify: `apps/portal/src/app/(portal)/catalogo/vehiculos/page.tsx` (hoy es un placeholder)

**Interfaces:**
- Consumes: la API de las Tasks 2–4; `PantallaCatalogo` de `@/components/catalogo/pantalla-catalogo`; `useEnvioFormulario` de `@/components/catalogo/use-envio-formulario`; `useAuth` de `@/components/auth/auth-provider`; `listarSucursales` de `@/lib/sucursales`.
- Produces: `interface Vehiculo` del lado del portal y las tres funciones de `lib/vehiculos.ts`. Nada más lo consume: es la punta del árbol.

**Sin pruebas automatizadas de pantalla**, igual que Sucursales y Productos: T-10 acotó las pruebas del portal a las piezas compartidas (`useCatalogo`, `TablaCatalogo`, `useEnvioFormulario`), que ya están cubiertas y son justo las que esta tarea reusa. La verificación es el checklist manual del Step 6.

- [ ] **Step 1: Escribir el cliente de la API**

Crea `apps/portal/src/lib/vehiculos.ts`:

```ts
import { apiFetch } from "./api";

export interface Vehiculo {
  id: string;
  nombre: string;
  kmInicial: number | null;
  sucursalId: string;
  sucursalCodigo: string;
  activo: boolean;
}

/**
 * @param sucursal codigo a filtrar, "todas", o null/undefined para no pedir
 *   nada. Da igual lo que se mande: el backend acota el resultado a lo que el
 *   usuario puede ver.
 */
export function listarVehiculos(
  sucursal?: string | null,
): Promise<Vehiculo[]> {
  const query = sucursal ? `?sucursal=${encodeURIComponent(sucursal)}` : "";
  return apiFetch<Vehiculo[]>(`/vehiculos${query}`);
}

export function crearVehiculo(datos: {
  nombre: string;
  kmInicial: number;
  /** Solo lo manda un usuario General: al resto se le ignora (D3). */
  sucursalId?: string;
}): Promise<Vehiculo> {
  return apiFetch<Vehiculo>("/vehiculos", {
    method: "POST",
    body: JSON.stringify(datos),
  });
}

export function editarVehiculo(
  id: string,
  cambios: { nombre?: string; kmInicial?: number; activo?: boolean },
): Promise<Vehiculo> {
  return apiFetch<Vehiculo>(`/vehiculos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(cambios),
  });
}
```

- [ ] **Step 2: Escribir el formulario**

Crea `apps/portal/src/components/vehiculos/formulario-vehiculo.tsx`:

```tsx
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import { crearVehiculo, editarVehiculo, type Vehiculo } from "@/lib/vehiculos";

interface Props {
  /** El vehiculo a editar, o null para dar de alta uno nuevo. */
  vehiculo: Vehiculo | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

export function FormularioVehiculo({
  vehiculo,
  alGuardar,
  alCancelar,
}: Props) {
  const { usuario } = useAuth();
  const esAlta = vehiculo === null;

  // `usuario.sucursal === null` = General (D3). Es el mismo dato que el backend
  // usa para resolver el alcance, asi que el formulario no puede discrepar de lo
  // que la API va a hacer: /auth/me ya lo devuelve desde T-06.
  //
  // `usuario` puede ser null mientras la sesion carga; ahi NO se pinta el
  // desplegable, que es lo conservador: el boton "Nuevo vehiculo" tampoco existe
  // todavia porque `puede()` devuelve false mientras carga, asi que este
  // formulario ni siquiera se puede abrir en ese estado.
  const eligeSucursal = esAlta && usuario !== null && usuario.sucursal === null;

  const [nombre, setNombre] = useState(vehiculo?.nombre ?? "");
  const [km, setKm] = useState(vehiculo?.kmInicial?.toString() ?? "");
  const [activo, setActivo] = useState(vehiculo?.activo ?? true);
  const [sucursalId, setSucursalId] = useState("");
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const { enviando, error, enviar } = useEnvioFormulario(
    "No se pudo guardar el vehículo.",
  );

  useEffect(() => {
    if (!eligeSucursal) return;
    let vigente = true;

    // Solo las activas: dar de alta un vehiculo en una sucursal desactivada no
    // tiene sentido. El fallo se ignora a proposito — el desplegable se queda
    // vacio, el boton Guardar deshabilitado, y el usuario ve que algo falta sin
    // un segundo mensaje de error compitiendo con el del formulario.
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
    const kmNumero = Number(km);

    await enviar(
      () =>
        vehiculo
          ? editarVehiculo(vehiculo.id, {
              nombre,
              kmInicial: kmNumero,
              activo,
            })
          : crearVehiculo({
              nombre,
              kmInicial: kmNumero,
              // Solo va cuando el usuario de verdad eligio una. A un usuario
              // atado el backend se lo ignoraria igual, pero mandarlo seria
              // mentir sobre lo que la pantalla hizo.
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
        {esAlta ? "Nuevo vehículo" : `Editar ${vehiculo.nombre}`}
      </h2>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="nombre" className="text-sm font-medium">
            Nombre del vehículo
          </label>
          <input
            id="nombre"
            name="nombre"
            required
            maxLength={80}
            disabled={enviando}
            placeholder="Nissan 2019"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="km" className="text-sm font-medium">
            Kilometraje {esAlta ? "al alta" : "de alta"}
          </label>
          <input
            id="km"
            name="km"
            type="number"
            required
            min={0}
            step="0.01"
            disabled={enviando}
            value={km}
            onChange={(e) => setKm(e.target.value)}
            className="w-40 rounded-md border px-3 py-2 text-sm"
          />
        </div>
      </div>

      {eligeSucursal && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sucursal" className="text-sm font-medium">
            Sucursal
          </label>
          <select
            id="sucursal"
            name="sucursal"
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
          Sucursal: {vehiculo.sucursalCodigo}. La sucursal de un vehículo no se
          puede cambiar.
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

- [ ] **Step 3: Escribir la pantalla**

Crea `apps/portal/src/components/vehiculos/pantalla-vehiculos.tsx`:

```tsx
"use client";

import { PantallaCatalogo } from "@/components/catalogo/pantalla-catalogo";
import { FormularioVehiculo } from "./formulario-vehiculo";
import { listarVehiculos, type Vehiculo } from "@/lib/vehiculos";

export function PantallaVehiculos({ sucursal }: { sucursal: string | null }) {
  return (
    <PantallaCatalogo<Vehiculo>
      titulo="Vehículos"
      permiso="vehiculo.gestionar"
      etiquetaAlta="Nuevo vehículo"
      vacio="No hay vehículos que mostrar."
      mensajeError="No se pudieron cargar los vehículos."
      cargar={() => listarVehiculos(sucursal)}
      // Vehiculos SI depende del selector global, como Sucursales y a diferencia
      // de Productos: un vehiculo pertenece fisicamente a una sucursal (D2).
      deps={[sucursal]}
      columnas={[
        { encabezado: "Nombre", celda: (v) => v.nombre },
        {
          encabezado: "Sucursal",
          celda: (v) => v.sucursalCodigo,
          className: "font-mono",
        },
        {
          encabezado: "Km al alta",
          // `toLocaleString` para que 145230.5 se lea "145,230.5" y no se
          // confunda con otro numero de un vistazo.
          celda: (v) => v.kmInicial?.toLocaleString("es-MX") ?? "—",
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
        <FormularioVehiculo
          vehiculo={item}
          alGuardar={alGuardar}
          alCancelar={alCancelar}
        />
      )}
    />
  );
}
```

- [ ] **Step 4: Reemplazar el placeholder de la página**

Reemplaza `apps/portal/src/app/(portal)/catalogo/vehiculos/page.tsx` entero:

```tsx
import { PantallaVehiculos } from "@/components/vehiculos/pantalla-vehiculos";

// En Next 15 `searchParams` es una promesa. La pagina es un server component
// que solo lee el filtro y lo baja; toda la interaccion vive en el cliente.
// A diferencia de la de Productos, esta SI lee el filtro (D2).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaVehiculos sucursal={sucursal ?? null} />;
}
```

- [ ] **Step 5: Verificar lint, build y las pruebas del portal**

```bash
npm run lint --workspace=apps/portal
npm run build --workspace=apps/portal
npm test --workspace=apps/portal
```

Esperado: los tres limpios, y el conteo de pruebas del portal **sin cambio** respecto a tu línea base (esta tarea no agrega ninguna, a propósito).

- [ ] **Step 6: Verificación manual con navegador real**

> [!danger] Apunta el backend al Postgres LOCAL antes de levantarlo
> `npm run backend` lee `.env.development`, que apunta a **`sinmex dev` en la nube**, la base compartida con el otro dev. Antes de levantarlo, cambia su `DATABASE_URL` al Postgres local (el mismo valor que tiene `.env.test`) y **déjalo apuntado ahí hasta terminar**. T-09 descubrió esto creando sin querer una sucursal de prueba en la nube.

```bash
# 1. Apunta .env.development al Postgres local (edítalo a mano).
# 2. Crea dos usuarios de prueba si no los tienes:
npm run crear-usuario --workspace=apps/backend   # uno General (sin sucursal)
npm run crear-usuario --workspace=apps/backend   # uno atado a TJ
# 3. Levanta las dos piezas en terminales separadas:
npm run backend
npm run portal
```

Checklist en `http://localhost:3001/catalogo/vehiculos` — anota el resultado de cada punto:

1. Como usuario **atado a TJ**: dar de alta un vehículo. El desplegable de sucursal **no** aparece.
2. El vehículo sale en la tabla con `TJ`, su km formateado y estado `Activo`.
3. Editar el nombre y el km; **cerrar y reabrir el formulario** y confirmar que el cambio quedó del lado del servidor, no solo en el estado local.
4. Desactivarlo → sigue en la lista como `Inactivo` → reactivarlo.
5. Intentar crear otro con el mismo nombre → mensaje legible de duplicado, no un 500. Repetirlo con el vehículo **desactivado** del paso 4 → también 409 (D4).
6. Con el selector "Por sucursal" del sidebar en **MX**, el vehículo de TJ no aparece.
7. Como usuario **General**: el desplegable de sucursal **sí** se pinta, y se puede crear un vehículo en MX.
8. Como usuario **sin** `vehiculo.gestionar` (perfil `Auxiliar Administrativo`): no ve el botón "Nuevo vehículo" ni los de "Editar", pero **sí** ve la lista.

Si algún punto falla, **arréglalo antes de commitear** y vuelve a correr el checklist entero.

- [ ] **Step 7: Restaurar `.env.development`**

Devuelve `DATABASE_URL` de `.env.development` a lo que apuntaba antes (`sinmex dev`). Es un archivo local que no se sube, pero dejarlo apuntado al Postgres local confundirá a quien lo use después.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/src/lib/vehiculos.ts apps/portal/src/components/vehiculos/ "apps/portal/src/app/(portal)/catalogo/vehiculos/page.tsx"
git commit -m "T-11 · Pantalla de Vehiculos en el portal

Tercera pantalla armada con PantallaCatalogo de T-10, sin agregarle ni un
prop: el unico campo condicional (el desplegable de sucursal, que solo ve un
usuario General) vive dentro del formulario, que es opaco para el envoltorio.
Es lo que T-10 predijo que debia pasar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Cierre — issue, vault y PR

**Files:**
- Modify: `../jawa-obsidian-memory/10-Dominio/Entidades/Vehículo.md`
- Modify: `../jawa-obsidian-memory/00-Inicio/Estado del proyecto.md`

**Interfaces:**
- Consumes: el trabajo de las Tasks 1–5.
- Produces: nada de código.

- [ ] **Step 1: Verificación final completa**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm run supabase -- test db
npm run lint --workspace=apps/portal
npm run build --workspace=apps/portal
npm test --workspace=apps/portal
```

Esperado, contra tu línea base de la Task 0: pgTAP **+5** · unitarias del backend **sin cambio** · e2e **+28** · portal **sin cambio**. Todo en verde. **No sigas si algo falla.**

- [ ] **Step 2: Actualizar `Vehículo.md` en el vault**

Abre `../jawa-obsidian-memory/10-Dominio/Entidades/Vehículo.md`. Su bloque `[!warning] Pendiente de confirmar` tiene dos puntos y **los dos quedan resueltos**. Reemplaza ese bloque por:

```markdown
> [!success] Confirmado en T-11 (2026-08-23)
> - La asignación a una **Sucursal** está confirmada e implementada: `vehiculo.sucursal_id` es
>   obligatorio, el catálogo del portal filtra por el selector "Por sucursal" y el alta la decide
>   el alcance del usuario, no el cliente. El nombre es **único por sucursal**
>   (`uq_vehiculo_nombre_sucursal`). La sucursal **no se puede cambiar** tras el alta.
> - Los kilometrajes inicial/final **del día** sí son registros diarios aparte, no campos de esta
>   ficha: pertenecen a la jornada y los captura la app ([[App Tablet]], T-38). Esta ficha solo
>   lleva el **kilometraje al alta**, que sí es editable.
```

Actualiza también el `actualizado:` del frontmatter a `2026-08-23`.

- [ ] **Step 3: Actualizar `Estado del proyecto.md` en el vault**

En `../jawa-obsidian-memory/00-Inicio/Estado del proyecto.md`:

1. En la tabla de issues, agrega la fila de T-11 como ✅ Hecho (2026-08-23) y quítalo de la fila `T-11/12/62`, que pasa a ser `T-12/62`.
2. En la tabla de "catálogos del portal que faltan", quita la fila de T-11 y deja T-62 y T-12 con sus dependencias.
3. Agrega una sección **"T-11 — detalle de lo hecho"** siguiendo el formato de las anteriores. Lo que merece quedar escrito:
   - Es el **primer catálogo que combina** el filtro por sucursal de T-09 con la baja vía `activo` de T-10.
   - **Sin migración de tabla ni de permiso**: `vehiculo` y `vehiculo.gestionar` ya existían desde T-05. Lo único nuevo en la base es `uq_vehiculo_nombre_sucursal`.
   - **`PantallaCatalogo` aguantó sin cambios** aunque el formulario tiene un campo condicional. Es la validación de lo que T-10 predijo: lo especial va en el formulario, no en el envoltorio.
   - **`numeric` de Postgres llega como cadena.** `km_inicial` es la primera columna `numeric` que lee un endpoint del portal; sin `aNumero()` el portal recibiría `"1000.00"` entre comillas. La conversión se importó de `modules/sincronizacion/dinero.ts` en vez de duplicarse. Anotado como candidato a mudarse a un lugar compartido cuando aparezca el tercer consumidor (T-18 va a leer `precio`, que también es `numeric`).
   - **Desactivar un vehículo NO libera su nombre** (el índice no filtra por `activo`), y es deliberado.
   - **La sucursal de un vehículo no se puede cambiar** tras el alta.
   - Conteos reales de pruebas, con la cifra de partida y la de llegada.
   - El aviso heredado: **el portal sigue sin pruebas automatizadas de pantalla**; la verificación fue manual con Playwright contra Postgres local.

- [ ] **Step 4: Commitear el vault**

```bash
cd ../jawa-obsidian-memory
git add "10-Dominio/Entidades/Vehículo.md" "00-Inicio/Estado del proyecto.md"
git commit -m "T-11 · Vehiculos: catalogo del portal hecho

Cierra los dos pendientes de confirmar de Vehículo.md: la asignacion a
sucursal y los kilometrajes diarios como registros aparte."
git push
cd -
```

- [ ] **Step 5: Abrir el PR**

```bash
git push -u origin feature/t-11-vehiculos
gh pr create --title "T-11 · Catálogo de Vehículos (alta con kilometraje inicial)" --body "$(cat <<'EOF'
Cierra #11.

Tercera pantalla de catálogo del portal, y la primera que combina el filtro por
sucursal de T-09 con la baja lógica vía `activo` de T-10.

## Qué trae

- **Base:** un solo índice, `uq_vehiculo_nombre_sucursal`. La tabla `vehiculo` y
  el permiso `vehiculo.gestionar` ya existían desde T-05.
- **Backend:** `modules/rutas/` deja de ser un stub vacío. `GET`/`POST`/`PATCH`
  de `/vehiculos`, con `resolverAlcance()` de T-09 reusada sin tocarla.
- **Portal:** `/catalogo/vehiculos` deja de ser un placeholder.

## Decisiones que conviene mirar en la revisión

- **La sucursal la decide el servidor, no el cliente.** A un usuario atado a una
  sucursal se le **ignora** el `sucursalId` que mande (no se le responde 403: no
  intenta escalar, manda un campo que su formulario ni pinta). Un usuario
  General sí tiene que mandarlo.
- **Desactivar un vehículo NO libera su nombre.** El índice único no filtra por
  `activo`, solo por `deleted_at`. Es deliberado: lo que se quiere en ese caso
  es reactivarlo, no crear un duplicado. Hay una prueba pgTAP que lo fija.
- **La sucursal de un vehículo no se puede cambiar** tras el alta. El DTO de
  edición ni siquiera lleva el campo.
- **`km_inicial` es `numeric` y el driver `pg` lo devuelve como cadena.** Se
  convierte con `aNumero()`, importada de `modules/sincronizacion/dinero.ts` en
  vez de duplicarse. Es un cruce de módulos, pero de una función pura.
- **`PantallaCatalogo` de T-10 no necesitó ni un prop nuevo** pese al campo
  condicional del formulario.

## Fuera de alcance, a propósito

El criterio 3 del issue ("disponible para precarga en la app, T-38") **ya lo
resolvió T-07**: `sincronizacion.repository.ts:136` ya sincroniza `vehiculo`
filtrado por la sucursal del vendedor y ya deriva la bandera con
`bandera(f.activo, f.deleted_at)`. No hubo nada que construir.

Los kilometrajes **del día** (inicial/final) no son de esta ficha: son de la
jornada y los captura la app (T-38).

## Verificación

- pgTAP +5 · e2e +28 · unitarias del backend y pruebas del portal sin cambio.
- El portal sigue sin pruebas automatizadas de pantalla (deuda heredada de
  T-03/T-09/T-10). Verificado a mano con Playwright contra Postgres **local**,
  8/8 puntos del checklist del plan.

Spec: `docs/superpowers/specs/2026-08-23-t11-catalogo-vehiculos-design.md`
Plan: `docs/superpowers/plans/2026-08-23-t11-catalogo-vehiculos.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Comentar el issue #11**

```bash
gh issue comment 11 --body "$(cat <<'EOF'
**Nota de alcance para cuando se cierre este issue.**

El criterio *"Disponible para precarga en la app (T-38)"* **no se implementó en
este PR porque ya estaba hecho desde T-07**: el pull de sincronización ya baja
`vehiculo` (id, nombre, sucursal_id, activo) filtrado por la sucursal del
vendedor, y ya deriva la bandera de baja con `bandera(f.activo, f.deleted_at)`.

Los otros dos criterios (alta/edición con km de alta, y vehículo asociado a
sucursal) sí son de este PR.

Queda anotado aquí para que no parezca que se hizo en T-11 ni que se olvidó.
EOF
)"
```

---

## Self-Review

**Cobertura del spec:**

| Sección del spec | Tarea que la implementa |
|---|---|
| D1 — módulo en `modules/rutas/` | Task 2, Step 6 |
| D2 — filtra por sucursal | Task 2 (backend), Task 5 Step 3 (`deps={[sucursal]}`) |
| D3 — la sucursal la decide el alcance | Task 3 (alta), Task 4 (edición y sucursal inmutable) |
| D4 — nombre único por sucursal | Task 1 |
| D5 — baja con `activo`, sync ya lo respeta | Task 4 (PATCH `activo`); la sync no se toca |
| D6 — `km_inicial` editable | Task 4 |
| D7 — sin abstracciones nuevas | Tasks 2 y 5 |
| Modelo de datos | Task 1 (solo el índice) |
| Endpoints (tabla) | Tasks 2, 3, 4 |
| Forma de la respuesta | Task 2 (`aVehiculo`) |
| Archivos (backend y portal) | Tasks 2–5 |
| Pruebas | Tasks 1–5 |
| Después del merge | Task 6 |

**Deuda conocida, deliberadamente no resuelta aquí:** el `ValidationPipe` global (`configurar-app.ts:42`) usa `whitelist: true` **sin** `forbidNonWhitelisted`, así que un campo que sobra se descarta en silencio en vez de rechazarse. El efecto visible es correcto en todos los casos de este ticket, pero los mensajes de error de un cuerpo mal armado son menos precisos de lo que podrían ser. Endurecerlo afectaría a **todos** los endpoints del proyecto de golpe y merece su propio ticket.

**Conteos esperados, todos relativos a la línea base de la Task 0:** pgTAP +5 · e2e +28 · unitarias del backend sin cambio · pruebas del portal sin cambio. No hay ninguna cifra absoluta escrita en este plan, a propósito (ver Global Constraints).

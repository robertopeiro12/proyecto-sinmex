# T-08b · Matriz de perfiles y permisos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un administrador pueda crear perfiles y configurar, celda por celda, qué permisos tiene cada uno desde `/catalogo/perfiles-y-permisos`, cerrando lo que T-08a dejó pendiente.

**Architecture:** Backend NestJS: cinco endpoints nuevos en `modules/auth/` (junto al guard/repositorio de permisos de T-08a, no un módulo nuevo — D1 del spec), sobre las tablas `perfil`/`permiso`/`perfil_permiso` que ya existen desde T-05. En el portal, una pantalla propia (`components/perfiles/`) con una tabla permisos×perfiles y checkbox por celda, mismo patrón de guardado por celda que `CeldaPrecio` de T-18 — no usa `PantallaCatalogo` (D6).

**Tech Stack:** NestJS · Kysely · Postgres (Supabase) · pgTAP · Jest (backend) · Next.js 15 App Router · React 19 · Tailwind v4 · shadcn/ui

**Spec:** `docs/superpowers/specs/2026-08-26-t08b-perfiles-permisos-design.md` — las decisiones se citan como D1…D7.

## Global Constraints

- **Rama:** `feature/t-08b-perfiles-permisos`, base `main`, sin pila.
- **Idioma del código:** identificadores, comentarios y mensajes de error **en español**, **sin acentos en los identificadores** (sí en los mensajes de cara al usuario).
- **Todo comando se corre desde la raíz del repo** con `--workspace=`, nunca entrando a `apps/*`.
- **`npm test`, `npm run test:e2e` y `supabase test db` exigen el stack local arriba**: `colima start` (no Docker Desktop — no está instalado en esta máquina) y luego `npm run supabase -- start`.
- **Nunca apuntar a `sinmex dev` durante la implementación.** `.env.test` va al Postgres local; `npm run backend` (para la verificación manual del portal) lee `.env.development`, que sí apunta a la nube — hay que apuntar su `DATABASE_URL` al Postgres local antes de la Task 8.
- **`perfil` NO tiene columna `activo`** (a diferencia de `vehiculo`/`producto`/`sucursal`) — solo `deleted_at`. La baja es `DELETE /perfiles/:id`, no un `PATCH { activo: false }`. Ver Modelo de datos del spec.
- **`deleted_at` jamás se expone en una respuesta de la API** (convención de T-09).
- **La respuesta de la API va en camelCase** (`perfilId`, `permisoId`), como el resto de los endpoints.
- **La migración solo agrega una fila a `permiso` (un `insert`)** → no hace falta `npm run db:types`. Las tablas `perfil`/`permiso`/`perfil_permiso` ya están en `schema.d.ts:92-107`.
- **Conteos de partida de las suites completas: NO están escritos en este plan a propósito** (T-10 hardcodeó cifras y salieron mal). Antes de empezar, corre las tres suites y anota tú los números reales; cada paso de verificación compara contra tu propia línea base. La única excepción es el conteo **local** de filas de `permiso` en la Task 1, que sí se fija a un número exacto porque es un catálogo cerrado, no una suite completa — si no arranca en 24, detente y revisa antes de seguir.

---

### Task 0: Rama y línea base

**Files:** ninguno (solo verificación).

**Interfaces:**
- Consumes: nada.
- Produces: la rama `feature/t-08b-perfiles-permisos` y los conteos de partida que usarán todas las tareas siguientes.

- [ ] **Step 1: Crear la rama desde `main` limpio**

```bash
git status --short
git checkout main && git pull
git checkout -b feature/t-08b-perfiles-permisos
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
```

Anota los números (`Tests: N passed` de Jest, y el total de pgTAP). Las tres suites tienen que estar en **verde** antes de tocar nada.

- [ ] **Step 4: Confirmar el conteo actual de `permiso`**

```bash
psql "$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" -c \
  "select count(*) as total from permiso where deleted_at is null;"
```

Esperado: `total = 24`. Si no es 24, **detente**: alguna migración de otra rama ya cambió el catálogo y la Task 1 de este plan necesita ajustarse antes de seguir.

---

### Task 1: Migración del permiso `perfil.gestionar` (D3, D5)

**Files:**
- Create: `supabase/migrations/20260826120000_permiso_perfil_gestionar.sql`
- Create: `supabase/tests/97_permiso_perfil_test.sql`
- Modify: `supabase/tests/93_permiso_sucursal_test.sql`

**Interfaces:**
- Consumes: nada.
- Produces: la fila `permiso` con `clave = 'perfil.gestionar'`. Las Tasks 2-6 la usan en `@RequierePermiso('perfil.gestionar')`.

- [ ] **Step 1: Escribir la prueba pgTAP que falla**

Crea `supabase/tests/97_permiso_perfil_test.sql`:

```sql
begin;
select plan(1);

select is(
  (select grupo from permiso where clave = 'perfil.gestionar' and deleted_at is null),
  'General',
  'perfil.gestionar existe y vive en el grupo General'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
npm run supabase -- test db
```

Esperado: `97_permiso_perfil_test.sql` falla — la clave todavía no existe (`grupo` sale `NULL`, no `'General'`). Si pasa, algo ya sembró esa fila: **detente**.

- [ ] **Step 3: Escribir la migración**

Crea `supabase/migrations/20260826120000_permiso_perfil_gestionar.sql`:

```sql
-- Mismo patron que T-08a (sucursal.gestionar) y T-18 (precio.gestionar): el
-- catalogo de permisos que sembro T-05 viene del documento del cliente y no
-- incluye ninguno para administrar la propia matriz de perfiles. Sin esta
-- fila, cualquier usuario con sesion podria ver y editar que puede hacer cada
-- perfil -- a diferencia de sucursales/productos/vehiculos/precios, aqui NI
-- SIQUIERA la lectura es publica (D3 del spec): es informacion de seguridad,
-- no un catalogo operativo.
insert into permiso (clave, grupo, descripcion) values
  ('perfil.gestionar', 'General', 'Crear perfiles y configurar su matriz de permisos')
on conflict (clave) do nothing;
```

- [ ] **Step 4: Aplicar la migración y correr la prueba nueva**

```bash
npm run supabase -- migration up --local
npm run supabase -- test db
```

Esperado: `97_permiso_perfil_test.sql` pasa. `93_permiso_sucursal_test.sql` ahora **falla** en su segunda aserción (esperaba 24, hay 25) — es el efecto esperado, se corrige en el siguiente paso.

- [ ] **Step 5: Actualizar el conteo total en `93_permiso_sucursal_test.sql`**

Edita `supabase/tests/93_permiso_sucursal_test.sql` (el archivo completo hoy dice 24):

```sql
begin;
select plan(2);

select is(
  (select grupo from permiso where clave = 'sucursal.gestionar' and deleted_at is null),
  'General',
  'sucursal.gestionar existe y vive en el grupo General'
);

-- T-05 sembro 22 permisos desde el documento del cliente; T-08a agrego 23o
-- (sucursal.gestionar); T-18 agrego 24o (precio.gestionar); T-08b agrega 25o
-- (perfil.gestionar).
select is(
  (select count(*)::int from permiso where deleted_at is null),
  25,
  'el catalogo de permisos tiene 25 claves'
);

select * from finish();
rollback;
```

- [ ] **Step 6: Correr toda la suite pgTAP**

```bash
npm run supabase -- test db
```

Esperado: todo en verde. El total de pruebas pgTAP sube en 1 sobre tu línea base de la Task 0: `97_permiso_perfil_test.sql` aporta 1 prueba nueva; `93_permiso_sucursal_test.sql` sigue teniendo 2 (una de sus aserciones cambió de valor esperado, pero el archivo no ganó ninguna prueba nueva).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260826120000_permiso_perfil_gestionar.sql \
  supabase/tests/97_permiso_perfil_test.sql \
  supabase/tests/93_permiso_sucursal_test.sql
git commit -m "T-08b · Sembrar el permiso perfil.gestionar

A diferencia de sucursal.gestionar/precio.gestionar, este protege
tambien la LECTURA (D3 del spec): la matriz completa es informacion
de seguridad, no un catalogo operativo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `GET /perfiles` — el módulo nace y la matriz se puede leer (D1, D3, D5)

**Files:**
- Create: `apps/backend/src/modules/auth/perfiles.repository.ts`
- Create: `apps/backend/src/modules/auth/perfiles.service.ts`
- Create: `apps/backend/src/modules/auth/perfiles.controller.ts`
- Modify: `apps/backend/src/modules/auth/auth.module.ts`
- Create: `apps/backend/test/perfiles.e2e-spec.ts`

**Interfaces:**
- Consumes: `esMaestro()` de `./permisos` (sin modificarla); `DB_CONNECTION`/`Database` de `../../database/database.tokens`; `RequierePermiso()` de `./requiere-permiso.decorator`.
- Produces:
  - `interface Permiso { id: string; clave: string; grupo: string; descripcion: string | null }`
  - `interface PerfilResumen { id: string; nombre: string }`
  - `interface Asignacion { perfilId: string; clave: string }`
  - `PerfilesRepository.catalogoPermisos(): Promise<Permiso[]>`
  - `PerfilesRepository.listarPerfiles(): Promise<PerfilResumen[]>`
  - `PerfilesRepository.listarAsignaciones(): Promise<Asignacion[]>`
  - `PerfilesRepository.buscarPorId(id: string): Promise<PerfilResumen | undefined>`
  - `interface PerfilConPermisos { id: string; nombre: string; esMaestro: boolean; permisos: string[] }`
  - `interface MatrizPerfiles { permisos: Permiso[]; perfiles: PerfilConPermisos[] }`
  - `PerfilesService.obtenerMatriz(): Promise<MatrizPerfiles>`
  - Las Tasks 3-6 agregan métodos a estas mismas clases y rutas a este mismo controlador.

> [!info] Orden de grupos fijo (D5)
> `ORDEN_GRUPOS` vive en `perfiles.repository.ts` porque es quien arma la respuesta que el portal pinta tal cual, sin reordenar. Los cuatro valores son datos de la tabla `permiso.grupo`, sin acentos (`'Operacion Comercial'`, `'Produccion/Almacen'`, `'Informacion'`) — mismo criterio que ya documentó T-08a.

- [ ] **Step 1: Escribir la prueba e2e que falla**

Crea `apps/backend/test/perfiles.e2e-spec.ts`. Este archivo crece en las Tasks 3-6; empieza con el andamiaje completo y las pruebas del `GET`:

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

interface PermisoRespuesta {
  id: string;
  clave: string;
  grupo: string;
  descripcion: string | null;
}

interface PerfilRespuesta {
  id: string;
  nombre: string;
  esMaestro: boolean;
  permisos: string[];
}

interface MatrizRespuesta {
  permisos: PermisoRespuesta[];
  perfiles: PerfilRespuesta[];
}

const SUFIJO = Date.now();
const LOGIN_CON_PERMISO = `e2e-perf-con-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-perf-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
// Prefijo reservado: la limpieza de afterAll borra por `nombre like`. Sin el,
// una corrida que deje basura envenena la siguiente con 409 inesperados.
const PREFIJO = `ZZ-e2e-perfiles-${SUFIJO}`;

describe('Perfiles (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const perfilIds: string[] = [];
  let idMaestro: string;
  let idPermisoGestionar: string;
  let cookieConPermiso: string;
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

  const crearUsuario = async (
    login: string,
    perfil: string,
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
        sucursal_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    usuarioIds.push(id);
  };

  /** Perfil de prueba, por debajo de la API. Se limpia en afterAll. */
  const sembrarPerfil = async (nombre: string): Promise<string> => {
    const { id } = await db
      .insertInto('perfil')
      .values({ nombre })
      .returning('id')
      .executeTakeFirstOrThrow();
    perfilIds.push(id);
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

    const maestro = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Administrador General')
      .executeTakeFirstOrThrow();
    idMaestro = maestro.id;

    const permisoGestionar = await db
      .selectFrom('permiso')
      .select('id')
      .where('clave', '=', 'perfil.gestionar')
      .executeTakeFirstOrThrow();
    idPermisoGestionar = permisoGestionar.id;

    // 'Administrador General' recibe el catalogo completo por diseño (D1 de
    // T-08a), asi que sirve como "usuario con perfil.gestionar" sin tener que
    // tocar perfil_permiso. 'Auxiliar Administrativo' sigue vacio (T-08b no
    // le asigna nada por defecto -- D7 del spec), asi que sirve como "usuario
    // sin el permiso" igual que en el resto de las suites e2e.
    await crearUsuario(LOGIN_CON_PERMISO, 'Administrador General');
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo');

    cookieConPermiso = await iniciarSesion(LOGIN_CON_PERMISO);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    if (perfilIds.length > 0) {
      // perfil_permiso.perfil_id no tiene ON DELETE: hay que borrar las
      // asignaciones antes que el perfil o el FK truena.
      await db
        .deleteFrom('perfil_permiso')
        .where('perfil_id', 'in', perfilIds)
        .execute();
      await db.deleteFrom('perfil').where('id', 'in', perfilIds).execute();
    }
    if (usuarioIds.length > 0) {
      await db
        .deleteFrom('sesion_refresh')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await app.close();
  });

  describe('GET /perfiles', () => {
    it('rechaza sin sesion', async () => {
      await request(app.getHttpServer()).get('/perfiles').expect(401);
    });

    it('rechaza a quien tiene sesion pero no perfil.gestionar', async () => {
      await request(app.getHttpServer())
        .get('/perfiles')
        .set('Cookie', cookieSinPermiso)
        .expect(403);
    });

    it('devuelve el catalogo de permisos y los perfiles, con el maestro marcado', async () => {
      const res = await request(app.getHttpServer())
        .get('/perfiles')
        .set('Cookie', cookieConPermiso)
        .expect(200);

      const cuerpo = res.body as MatrizRespuesta;
      const claves = cuerpo.permisos.map((p) => p.clave);
      expect(claves).toEqual(expect.arrayContaining(['perfil.gestionar']));

      const maestro = cuerpo.perfiles.find((p) => p.id === idMaestro);
      expect(maestro).toBeDefined();
      expect(maestro?.esMaestro).toBe(true);
      // El maestro recibe TODO el catalogo, no solo lo que haya en
      // perfil_permiso (que para el maestro esta vacio a proposito, D2).
      expect(maestro?.permisos).toEqual(expect.arrayContaining(claves));

      const auxiliar = cuerpo.perfiles.find((p) => p.nombre === 'Auxiliar Administrativo');
      expect(auxiliar).toBeDefined();
      expect(auxiliar?.esMaestro).toBe(false);
      expect(auxiliar?.permisos).toEqual([]);
    });

    it('un perfil de prueba con una asignacion la refleja en su lista', async () => {
      const perfilId = await sembrarPerfil(`${PREFIJO} Con permiso`);
      await db
        .insertInto('perfil_permiso')
        .values({ perfil_id: perfilId, permiso_id: idPermisoGestionar })
        .execute();

      const res = await request(app.getHttpServer())
        .get('/perfiles')
        .set('Cookie', cookieConPermiso)
        .expect(200);

      const propio = (res.body as MatrizRespuesta).perfiles.find(
        (p) => p.id === perfilId,
      );
      expect(propio?.permisos).toEqual(['perfil.gestionar']);
    });
  });
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: falla al compilar o al pedir `/perfiles` — el módulo, el controlador y la ruta todavía no existen (404, o un error de import si el archivo ni siquiera existe).

- [ ] **Step 3: Escribir el repositorio**

Crea `apps/backend/src/modules/auth/perfiles.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

export interface Permiso {
  id: string;
  clave: string;
  grupo: string;
  descripcion: string | null;
}

export interface PerfilResumen {
  id: string;
  nombre: string;
}

export interface Asignacion {
  perfilId: string;
  clave: string;
}

/**
 * Orden de las cuatro categorias en la matriz (D5 del spec). Son valores de
 * dato de `permiso.grupo`, no etiquetas de interfaz -- mismo criterio que ya
 * fijo T-08a para 'sucursal.gestionar'.
 */
const ORDEN_GRUPOS = [
  'General',
  'Operacion Comercial',
  'Produccion/Almacen',
  'Informacion',
];

@Injectable()
export class PerfilesRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** Ordenado por grupo (orden fijo de negocio) y luego por clave. */
  async catalogoPermisos(): Promise<Permiso[]> {
    const filas = await this.db
      .selectFrom('permiso')
      .select(['id', 'clave', 'grupo', 'descripcion'])
      .where('deleted_at', 'is', null)
      .execute();

    return filas.sort((a, b) => {
      const diferenciaGrupo =
        ORDEN_GRUPOS.indexOf(a.grupo) - ORDEN_GRUPOS.indexOf(b.grupo);
      return diferenciaGrupo !== 0
        ? diferenciaGrupo
        : a.clave.localeCompare(b.clave);
    });
  }

  async listarPerfiles(): Promise<PerfilResumen[]> {
    return this.db
      .selectFrom('perfil')
      .select(['id', 'nombre'])
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .execute();
  }

  /**
   * Todas las asignaciones activas de TODOS los perfiles en una sola
   * consulta -- evita un N+1 (una consulta por perfil) que la Task 2 tendria
   * que resolver de todos modos en cuanto hubiera mas de un perfil normal.
   */
  async listarAsignaciones(): Promise<Asignacion[]> {
    return this.db
      .selectFrom('perfil_permiso')
      .innerJoin('permiso', 'permiso.id', 'perfil_permiso.permiso_id')
      .select([
        'perfil_permiso.perfil_id as perfilId',
        'permiso.clave as clave',
      ])
      .where('perfil_permiso.deleted_at', 'is', null)
      .where('permiso.deleted_at', 'is', null)
      .execute();
  }

  async buscarPorId(id: string): Promise<PerfilResumen | undefined> {
    return this.db
      .selectFrom('perfil')
      .select(['id', 'nombre'])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }
}
```

- [ ] **Step 4: Escribir el servicio**

Crea `apps/backend/src/modules/auth/perfiles.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { esMaestro } from './permisos';
import {
  PerfilesRepository,
  type Permiso,
} from './perfiles.repository';

export interface PerfilConPermisos {
  id: string;
  nombre: string;
  esMaestro: boolean;
  permisos: string[];
}

export interface MatrizPerfiles {
  permisos: Permiso[];
  perfiles: PerfilConPermisos[];
}

@Injectable()
export class PerfilesService {
  constructor(private readonly repo: PerfilesRepository) {}

  /**
   * El maestro no consulta `perfil_permiso` (D2 del spec): sus filas ahi
   * siempre estarian vacias (permisos.repository.ts:43-44 corta antes de
   * llegar a esa tabla), asi que se le manda el catalogo completo -- misma
   * regla que `PermisosRepository.permisosDe()` ya aplica para la sesion.
   */
  async obtenerMatriz(): Promise<MatrizPerfiles> {
    const [permisos, perfiles, asignaciones] = await Promise.all([
      this.repo.catalogoPermisos(),
      this.repo.listarPerfiles(),
      this.repo.listarAsignaciones(),
    ]);

    const todasLasClaves = permisos.map((p) => p.clave);

    return {
      permisos,
      perfiles: perfiles.map((perfil) => {
        const maestro = esMaestro(perfil.nombre);
        return {
          id: perfil.id,
          nombre: perfil.nombre,
          esMaestro: maestro,
          permisos: maestro
            ? todasLasClaves
            : asignaciones
                .filter((a) => a.perfilId === perfil.id)
                .map((a) => a.clave),
        };
      }),
    };
  }
}
```

- [ ] **Step 5: Escribir el controlador**

Crea `apps/backend/src/modules/auth/perfiles.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { RequierePermiso } from './requiere-permiso.decorator';
import { PerfilesService, type MatrizPerfiles } from './perfiles.service';

// Sin @Publico(): el guard global de app.module.ts protege todo por defecto.
// A diferencia de sucursales/productos/vehiculos/precios, el decorador va a
// nivel de CLASE: los cinco endpoints de este controlador exigen
// perfil.gestionar sin excepcion (D3 del spec) -- la matriz completa es
// informacion de seguridad, no un catalogo operativo que otra pantalla
// necesite consultar sin el permiso. PermisosGuard lee metadata de clase Y de
// metodo (permisos.guard.ts:33-36), asi que esto ya funciona con el guard tal
// cual quedo en T-08a, sin tocarlo.
@Controller('perfiles')
@RequierePermiso('perfil.gestionar')
export class PerfilesController {
  constructor(private readonly perfiles: PerfilesService) {}

  @Get()
  async obtener(): Promise<MatrizPerfiles> {
    return this.perfiles.obtenerMatriz();
  }
}
```

- [ ] **Step 6: Registrar en `auth.module.ts`**

Modifica `apps/backend/src/modules/auth/auth.module.ts` — agrega los tres imports y regístralos en `controllers`/`providers` (sin exportarlos: a diferencia de `PermisosRepository`, nada fuera de este módulo los necesita):

```ts
import { PerfilesController } from './perfiles.controller';
import { PerfilesRepository } from './perfiles.repository';
import { PerfilesService } from './perfiles.service';
```

```ts
  controllers: [AuthController, AuthVendedorController, PerfilesController],
  providers: [
    AuthService,
    AuthVendedorService,
    PasswordService,
    TokenService,
    TokenVendedorService,
    SesionRepository,
    SesionVendedorRepository,
    PermisosRepository,
    PerfilesRepository,
    PerfilesService,
  ],
```

- [ ] **Step 7: Correr la prueba e2e**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: los 5 tests de `describe('GET /perfiles', ...)` pasan. El total de e2e sube sobre tu línea base de la Task 0.

- [ ] **Step 8: Correr lint y typecheck**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
```

Esperado: sin errores.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/auth/perfiles.repository.ts \
  apps/backend/src/modules/auth/perfiles.service.ts \
  apps/backend/src/modules/auth/perfiles.controller.ts \
  apps/backend/src/modules/auth/auth.module.ts \
  apps/backend/test/perfiles.e2e-spec.ts
git commit -m "T-08b · GET /perfiles: matriz de perfiles y permisos

Los cinco endpoints de este controlador exigen perfil.gestionar a
nivel de clase (D3): a diferencia del resto de catalogos del portal,
aqui ni la lectura es publica.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `POST /perfiles` — alta sin permisos (D7)

**Files:**
- Create: `apps/backend/src/modules/auth/dto/crear-perfil.dto.ts`
- Modify: `apps/backend/src/modules/auth/perfiles.repository.ts`
- Modify: `apps/backend/src/modules/auth/perfiles.service.ts`
- Modify: `apps/backend/src/modules/auth/perfiles.controller.ts`
- Modify: `apps/backend/test/perfiles.e2e-spec.ts`

**Interfaces:**
- Consumes: `PerfilResumen` de `./perfiles.repository` (Task 2).
- Produces:
  - `PerfilesRepository.crear(nombre: string): Promise<PerfilResumen>`
  - `PerfilesService.crear(nombre: string): Promise<PerfilResumen>`
  - Las Tasks 4-6 reusan el mismo patron de captura de `23505` (`esDuplicado`).

- [ ] **Step 1: Escribir las pruebas e2e que fallan**

Agrega dentro de `describe('Perfiles (e2e)', ...)` en `apps/backend/test/perfiles.e2e-spec.ts`, después del `describe('GET /perfiles', ...)`:

```ts
  describe('POST /perfiles', () => {
    it('rechaza sin perfil.gestionar', async () => {
      await request(app.getHttpServer())
        .post('/perfiles')
        .set('Cookie', cookieSinPermiso)
        .send({ nombre: `${PREFIJO} Sin permiso` })
        .expect(403);
    });

    it('crea un perfil sin ningun permiso asignado', async () => {
      const res = await request(app.getHttpServer())
        .post('/perfiles')
        .set('Cookie', cookieConPermiso)
        .send({ nombre: `${PREFIJO} Nuevo` })
        .expect(201);

      const creado = res.body as { id: string; nombre: string };
      perfilIds.push(creado.id);
      expect(creado.nombre).toBe(`${PREFIJO} Nuevo`);

      const enMatriz = await request(app.getHttpServer())
        .get('/perfiles')
        .set('Cookie', cookieConPermiso)
        .expect(200);
      const propio = (
        enMatriz.body as { perfiles: { id: string; permisos: string[] }[] }
      ).perfiles.find((p) => p.id === creado.id);
      expect(propio?.permisos).toEqual([]);
    });

    it('rechaza un nombre repetido', async () => {
      const nombre = `${PREFIJO} Repetido`;
      const primero = await request(app.getHttpServer())
        .post('/perfiles')
        .set('Cookie', cookieConPermiso)
        .send({ nombre })
        .expect(201);
      perfilIds.push((primero.body as { id: string }).id);

      await request(app.getHttpServer())
        .post('/perfiles')
        .set('Cookie', cookieConPermiso)
        .send({ nombre })
        .expect(409);
    });

    it('rechaza un nombre vacio', async () => {
      await request(app.getHttpServer())
        .post('/perfiles')
        .set('Cookie', cookieConPermiso)
        .send({ nombre: '   ' })
        .expect(400);
    });
  });
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: falla — no hay ruta `POST /perfiles` (404/`Cannot POST`).

- [ ] **Step 3: DTO de alta**

Crea `apps/backend/src/modules/auth/dto/crear-perfil.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CrearPerfilDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del perfil es obligatorio.' })
  // La columna es `text` (sin limite). El tope vive aqui por la misma razon
  // que sucursal/producto/vehiculo: sin cota, es una invitacion a meter un
  // texto largo en un catalogo que se pinta como columna de tabla.
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;
}
```

- [ ] **Step 4: Repositorio — `crear()`**

Agrega a `apps/backend/src/modules/auth/perfiles.repository.ts`, dentro de la clase:

```ts
  async crear(nombre: string): Promise<PerfilResumen> {
    return this.db
      .insertInto('perfil')
      .values({ nombre })
      .returning(['id', 'nombre'])
      .executeTakeFirstOrThrow();
  }
```

- [ ] **Step 5: Servicio — `crear()` con el 409 de nombre duplicado**

En `apps/backend/src/modules/auth/perfiles.service.ts`: cambia la línea de import de `@nestjs/common` por:

```ts
import { ConflictException, Injectable } from '@nestjs/common';
```

Agrega, después de los imports y antes de `PerfilConPermisos`, esta función a nivel de módulo:

```ts
/**
 * `23505` es unique_violation. Se mira DESPUES del insert en vez de consultar
 * antes si el nombre existe -- mismo criterio "la base decide" que T-09,
 * T-10, T-11 y T-18: una consulta previa deja una ventana entre el SELECT y
 * el INSERT en la que otra peticion puede meter el mismo nombre.
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

Agrega este método a la clase `PerfilesService`, después de `obtenerMatriz()`:

```ts
  async crear(nombre: string): Promise<PerfilResumen> {
    try {
      return await this.repo.crear(nombre);
    } catch (error) {
      if (esDuplicado(error)) {
        throw new ConflictException(`Ya existe un perfil llamado "${nombre}".`);
      }
      throw error;
    }
  }
```

Y agrega `PerfilResumen` al import de `./perfiles.repository` (hoy solo importa `Permiso`).

- [ ] **Step 6: Controlador — `POST /perfiles`**

En `apps/backend/src/modules/auth/perfiles.controller.ts`, cambia la línea de import de `@nestjs/common` por:

```ts
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
```

Agrega, después del import de `RequierePermiso`:

```ts
import { CrearPerfilDto } from './dto/crear-perfil.dto';
import type { PerfilResumen } from './perfiles.repository';
```

Agrega este método a la clase `PerfilesController`, después de `obtener()`:

```ts
  @Post()
  @HttpCode(201)
  async crear(@Body() dto: CrearPerfilDto): Promise<PerfilResumen> {
    return this.perfiles.crear(dto.nombre);
  }
```

- [ ] **Step 7: Correr la prueba e2e**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: los 4 tests de `describe('POST /perfiles', ...)` pasan.

- [ ] **Step 8: Lint y build**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
```

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/auth/dto/crear-perfil.dto.ts \
  apps/backend/src/modules/auth/perfiles.repository.ts \
  apps/backend/src/modules/auth/perfiles.service.ts \
  apps/backend/src/modules/auth/perfiles.controller.ts \
  apps/backend/test/perfiles.e2e-spec.ts
git commit -m "T-08b · POST /perfiles: alta sin permisos (D7)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `PATCH /perfiles/:id` — renombrar, con el maestro protegido (D2)

**Files:**
- Create: `apps/backend/src/modules/auth/dto/editar-perfil.dto.ts`
- Modify: `apps/backend/src/modules/auth/perfiles.repository.ts`
- Modify: `apps/backend/src/modules/auth/perfiles.service.ts`
- Modify: `apps/backend/src/modules/auth/perfiles.controller.ts`
- Modify: `apps/backend/test/perfiles.e2e-spec.ts`

**Interfaces:**
- Consumes: `esMaestro()` de `./permisos`; `esDuplicado()` de `./perfiles.service` (privada al archivo).
- Produces:
  - `PerfilesRepository.renombrar(id: string, nombre: string): Promise<PerfilResumen>`
  - `PerfilesService.renombrar(id: string, nombre: string): Promise<PerfilResumen>`
  - `PerfilesService.buscarActivoOFallar(id: string): Promise<PerfilResumen>` (privado) — las Tasks 5 y 6 lo reusan tal cual.

- [ ] **Step 1: Escribir las pruebas e2e que fallan**

Agrega dentro de `describe('Perfiles (e2e)', ...)`, después de `describe('POST /perfiles', ...)`:

```ts
  describe('PATCH /perfiles/:id', () => {
    it('rechaza sin perfil.gestionar', async () => {
      const id = await sembrarPerfil(`${PREFIJO} Renombrar sin permiso`);
      await request(app.getHttpServer())
        .patch(`/perfiles/${id}`)
        .set('Cookie', cookieSinPermiso)
        .send({ nombre: 'Otro nombre' })
        .expect(403);
    });

    it('renombra un perfil normal', async () => {
      const id = await sembrarPerfil(`${PREFIJO} Original`);
      const res = await request(app.getHttpServer())
        .patch(`/perfiles/${id}`)
        .set('Cookie', cookieConPermiso)
        .send({ nombre: `${PREFIJO} Renombrado` })
        .expect(200);

      expect((res.body as { nombre: string }).nombre).toBe(`${PREFIJO} Renombrado`);
    });

    it('rechaza renombrar al perfil maestro', async () => {
      await request(app.getHttpServer())
        .patch(`/perfiles/${idMaestro}`)
        .set('Cookie', cookieConPermiso)
        .send({ nombre: 'Ya no soy el maestro' })
        .expect(409);

      const fila = await db
        .selectFrom('perfil')
        .select('nombre')
        .where('id', '=', idMaestro)
        .executeTakeFirstOrThrow();
      expect(fila.nombre).toBe('Administrador General');
    });

    it('un id que no existe responde 404', async () => {
      await request(app.getHttpServer())
        .patch('/perfiles/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieConPermiso)
        .send({ nombre: 'Lo que sea' })
        .expect(404);
    });

    it('un id mal formado responde 400, no 500', async () => {
      await request(app.getHttpServer())
        .patch('/perfiles/no-soy-un-uuid')
        .set('Cookie', cookieConPermiso)
        .send({ nombre: 'Lo que sea' })
        .expect(400);
    });
  });
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: falla — no hay ruta `PATCH /perfiles/:id`.

- [ ] **Step 3: DTO de edición**

Crea `apps/backend/src/modules/auth/dto/editar-perfil.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// Un solo campo, y obligatorio: a diferencia de EditarVehiculoDto (que tiene
// varios campos opcionales), este PATCH solo renombra -- la baja es su
// propio DELETE (Task 5, porque `perfil` no tiene columna `activo`).
export class EditarPerfilDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del perfil es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;
}
```

- [ ] **Step 4: Repositorio — `renombrar()`**

Agrega a `apps/backend/src/modules/auth/perfiles.repository.ts`:

```ts
  async renombrar(id: string, nombre: string): Promise<PerfilResumen> {
    return this.db
      .updateTable('perfil')
      .set({ nombre })
      .where('id', '=', id)
      .returning(['id', 'nombre'])
      .executeTakeFirstOrThrow();
  }
```

- [ ] **Step 5: Servicio — `renombrar()` con la protección del maestro (D2)**

En `apps/backend/src/modules/auth/perfiles.service.ts`: cambia la línea de import de `@nestjs/common` por:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
```

(`esMaestro` de `./permisos` ya está importado desde la Task 2, no hace falta tocar esa línea.)

Agrega estos dos métodos a la clase `PerfilesService`, después de `crear()`:

```ts
  async renombrar(id: string, nombre: string): Promise<PerfilResumen> {
    const perfil = await this.buscarActivoOFallar(id);
    if (esMaestro(perfil.nombre)) {
      throw new ConflictException('El perfil maestro no se puede renombrar.');
    }
    try {
      return await this.repo.renombrar(id, nombre);
    } catch (error) {
      if (esDuplicado(error)) {
        throw new ConflictException(`Ya existe un perfil llamado "${nombre}".`);
      }
      throw error;
    }
  }

  /**
   * Compartido por renombrar/dar de baja/togglear (Tasks 4-6): las tres
   * operaciones necesitan el nombre ACTUAL del perfil para decidir si es el
   * maestro (D2), y las tres deben responder 404 igual si el id no existe.
   */
  private async buscarActivoOFallar(id: string): Promise<PerfilResumen> {
    const perfil = await this.repo.buscarPorId(id);
    if (!perfil) {
      throw new NotFoundException('No existe ese perfil.');
    }
    return perfil;
  }
```

- [ ] **Step 6: Controlador — `PATCH /perfiles/:id`**

En `apps/backend/src/modules/auth/perfiles.controller.ts`, cambia la línea de import de `@nestjs/common` por:

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
```

Agrega, después del import de `CrearPerfilDto`:

```ts
import { EditarPerfilDto } from './dto/editar-perfil.dto';
```

Agrega este método a la clase `PerfilesController`, después de `crear()`:

```ts
  @Patch(':id')
  async renombrar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarPerfilDto,
  ): Promise<PerfilResumen> {
    return this.perfiles.renombrar(id, dto.nombre);
  }
```

- [ ] **Step 7: Correr la prueba e2e**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: los 5 tests de `describe('PATCH /perfiles/:id', ...)` pasan.

- [ ] **Step 8: Lint y build**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
```

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/auth/dto/editar-perfil.dto.ts \
  apps/backend/src/modules/auth/perfiles.repository.ts \
  apps/backend/src/modules/auth/perfiles.service.ts \
  apps/backend/src/modules/auth/perfiles.controller.ts \
  apps/backend/test/perfiles.e2e-spec.ts
git commit -m "T-08b · PATCH /perfiles/:id: renombrar, maestro protegido (D2)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `DELETE /perfiles/:id` — baja lógica, maestro y usuarios activos bloquean (D2, D4)

**Files:**
- Modify: `apps/backend/src/modules/auth/perfiles.repository.ts`
- Modify: `apps/backend/src/modules/auth/perfiles.service.ts`
- Modify: `apps/backend/src/modules/auth/perfiles.controller.ts`
- Modify: `apps/backend/test/perfiles.e2e-spec.ts`

**Interfaces:**
- Consumes: `PerfilesService.buscarActivoOFallar()` (Task 4, privado).
- Produces:
  - `PerfilesRepository.contarUsuariosActivos(perfilId: string): Promise<number>`
  - `PerfilesRepository.darDeBaja(id: string): Promise<void>`
  - `PerfilesService.darDeBaja(id: string): Promise<void>`

- [ ] **Step 1: Escribir las pruebas e2e que fallan**

Agrega dentro de `describe('Perfiles (e2e)', ...)`, después de `describe('PATCH /perfiles/:id', ...)`:

```ts
  describe('DELETE /perfiles/:id', () => {
    it('rechaza sin perfil.gestionar', async () => {
      const id = await sembrarPerfil(`${PREFIJO} Baja sin permiso`);
      await request(app.getHttpServer())
        .delete(`/perfiles/${id}`)
        .set('Cookie', cookieSinPermiso)
        .expect(403);
    });

    it('da de baja un perfil sin usuarios asignados', async () => {
      const id = await sembrarPerfil(`${PREFIJO} Baja limpia`);
      await request(app.getHttpServer())
        .delete(`/perfiles/${id}`)
        .set('Cookie', cookieConPermiso)
        .expect(200);

      const enMatriz = await request(app.getHttpServer())
        .get('/perfiles')
        .set('Cookie', cookieConPermiso)
        .expect(200);
      const sigueAhi = (enMatriz.body as { perfiles: { id: string }[] }).perfiles.some(
        (p) => p.id === id,
      );
      expect(sigueAhi).toBe(false);
    });

    it('rechaza dar de baja al perfil maestro', async () => {
      await request(app.getHttpServer())
        .delete(`/perfiles/${idMaestro}`)
        .set('Cookie', cookieConPermiso)
        .expect(409);
    });

    it('rechaza la baja si hay un usuario activo con ese perfil, y la permite tras reasignarlo', async () => {
      const id = await sembrarPerfil(`${PREFIJO} Con usuario`);
      const loginUsuarioDePrueba = `e2e-perf-usr-${SUFIJO}`;
      const hash = await app.get(PasswordService).hashear(PASSWORD);
      const { id: usuarioDePruebaId } = await db
        .insertInto('usuario')
        .values({
          login: loginUsuarioDePrueba,
          nombre: loginUsuarioDePrueba,
          password_hash: hash,
          perfil_id: id,
          sucursal_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      usuarioIds.push(usuarioDePruebaId);

      await request(app.getHttpServer())
        .delete(`/perfiles/${id}`)
        .set('Cookie', cookieConPermiso)
        .expect(409);

      // Reasignar (a mano, como haria un admin sin pantalla de Usuarios
      // todavia -- T-13) y reintentar: ahora si pasa.
      await db
        .updateTable('usuario')
        .set({ perfil_id: idMaestro })
        .where('id', '=', usuarioDePruebaId)
        .execute();

      await request(app.getHttpServer())
        .delete(`/perfiles/${id}`)
        .set('Cookie', cookieConPermiso)
        .expect(200);
    });

    it('un id que no existe responde 404', async () => {
      await request(app.getHttpServer())
        .delete('/perfiles/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieConPermiso)
        .expect(404);
    });
  });
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: falla — no hay ruta `DELETE /perfiles/:id`.

- [ ] **Step 3: Repositorio — `contarUsuariosActivos()` y `darDeBaja()`**

Agrega a `apps/backend/src/modules/auth/perfiles.repository.ts`:

```ts
  async contarUsuariosActivos(perfilId: string): Promise<number> {
    const fila = await this.db
      .selectFrom('usuario')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('perfil_id', '=', perfilId)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(fila.total);
  }

  async darDeBaja(id: string): Promise<void> {
    await this.db
      .updateTable('perfil')
      .set({ deleted_at: new Date() })
      .where('id', '=', id)
      .execute();
  }
```

- [ ] **Step 4: Servicio — `darDeBaja()` con D2 y D4**

Agrega el método a `apps/backend/src/modules/auth/perfiles.service.ts` (dentro de la clase `PerfilesService`, después de `renombrar()`):

```ts
  async darDeBaja(id: string): Promise<void> {
    const perfil = await this.buscarActivoOFallar(id);
    if (esMaestro(perfil.nombre)) {
      throw new ConflictException('El perfil maestro no se puede dar de baja.');
    }
    const usuariosActivos = await this.repo.contarUsuariosActivos(id);
    if (usuariosActivos > 0) {
      throw new ConflictException(
        'Hay usuarios activos con este perfil. Reasígnalos antes de darlo de baja.',
      );
    }
    await this.repo.darDeBaja(id);
  }
```

- [ ] **Step 5: Controlador — `DELETE /perfiles/:id`**

Modifica `apps/backend/src/modules/auth/perfiles.controller.ts` — agrega el import de `Delete` y el método:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
```

```ts
  @Delete(':id')
  async darDeBaja(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.perfiles.darDeBaja(id);
    return { id };
  }
```

> [!info] Por qué devuelve `{ id }` y no un cuerpo vacío
> `apiFetch()` del portal (Task 7) siempre hace `res.json()` sobre la respuesta — un cuerpo vacío rompería esa llamada. Devolver el `id` es gratis y evita esa ambigüedad, sin inventar un `204 No Content` que ningún otro endpoint de este backend usa todavía.

- [ ] **Step 6: Correr la prueba e2e**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: los 5 tests de `describe('DELETE /perfiles/:id', ...)` pasan.

- [ ] **Step 7: Lint y build**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
```

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/modules/auth/perfiles.repository.ts \
  apps/backend/src/modules/auth/perfiles.service.ts \
  apps/backend/src/modules/auth/perfiles.controller.ts \
  apps/backend/test/perfiles.e2e-spec.ts
git commit -m "T-08b · DELETE /perfiles/:id: baja logica (D2, D4)

Bloquea sobre el maestro y sobre un perfil con usuarios activos
asignados -- permisos.repository.ts filtra perfil.deleted_at is null,
asi que sin este bloqueo esos usuarios se quedarian sin permisos en
silencio.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `PATCH /perfiles/:id/permisos` — togglear una celda (D2, D7)

**Files:**
- Create: `apps/backend/src/modules/auth/dto/actualizar-permiso-perfil.dto.ts`
- Modify: `apps/backend/src/modules/auth/perfiles.repository.ts`
- Modify: `apps/backend/src/modules/auth/perfiles.service.ts`
- Modify: `apps/backend/src/modules/auth/perfiles.controller.ts`
- Modify: `apps/backend/test/perfiles.e2e-spec.ts`

**Interfaces:**
- Consumes: `PerfilesService.buscarActivoOFallar()` (Task 4, privado).
- Produces:
  - `PerfilesRepository.existePermiso(id: string): Promise<boolean>`
  - `PerfilesRepository.togglePermiso(perfilId: string, permisoId: string, habilitado: boolean): Promise<void>`
  - `PerfilesService.togglePermiso(perfilId: string, permisoId: string, habilitado: boolean): Promise<void>`
  - El portal (Task 7) consume `PATCH /perfiles/:id/permisos` con body `{ permisoId, habilitado }`, respuesta `{ perfilId, permisoId, habilitado }`.

- [ ] **Step 1: Escribir las pruebas e2e que fallan**

Agrega dentro de `describe('Perfiles (e2e)', ...)`, después de `describe('DELETE /perfiles/:id', ...)`:

```ts
  describe('PATCH /perfiles/:id/permisos', () => {
    it('rechaza sin perfil.gestionar', async () => {
      const id = await sembrarPerfil(`${PREFIJO} Toggle sin permiso`);
      await request(app.getHttpServer())
        .patch(`/perfiles/${id}/permisos`)
        .set('Cookie', cookieSinPermiso)
        .send({ permisoId: idPermisoGestionar, habilitado: true })
        .expect(403);
    });

    it('habilita una celda y una segunda llamada la revierte', async () => {
      const id = await sembrarPerfil(`${PREFIJO} Toggle`);

      await request(app.getHttpServer())
        .patch(`/perfiles/${id}/permisos`)
        .set('Cookie', cookieConPermiso)
        .send({ permisoId: idPermisoGestionar, habilitado: true })
        .expect(200);

      let matriz = await request(app.getHttpServer())
        .get('/perfiles')
        .set('Cookie', cookieConPermiso)
        .expect(200);
      let propio = (matriz.body as { perfiles: { id: string; permisos: string[] }[] })
        .perfiles.find((p) => p.id === id);
      expect(propio?.permisos).toEqual(['perfil.gestionar']);

      await request(app.getHttpServer())
        .patch(`/perfiles/${id}/permisos`)
        .set('Cookie', cookieConPermiso)
        .send({ permisoId: idPermisoGestionar, habilitado: false })
        .expect(200);

      matriz = await request(app.getHttpServer())
        .get('/perfiles')
        .set('Cookie', cookieConPermiso)
        .expect(200);
      propio = (matriz.body as { perfiles: { id: string; permisos: string[] }[] })
        .perfiles.find((p) => p.id === id);
      expect(propio?.permisos).toEqual([]);
    });

    it('habilitar dos veces seguidas no duplica la fila', async () => {
      const id = await sembrarPerfil(`${PREFIJO} Doble toggle`);

      await request(app.getHttpServer())
        .patch(`/perfiles/${id}/permisos`)
        .set('Cookie', cookieConPermiso)
        .send({ permisoId: idPermisoGestionar, habilitado: true })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/perfiles/${id}/permisos`)
        .set('Cookie', cookieConPermiso)
        .send({ permisoId: idPermisoGestionar, habilitado: true })
        .expect(200);

      const filas = await db
        .selectFrom('perfil_permiso')
        .select('id')
        .where('perfil_id', '=', id)
        .where('permiso_id', '=', idPermisoGestionar)
        .execute();
      expect(filas).toHaveLength(1);
    });

    it('rechaza togglear una celda del maestro', async () => {
      await request(app.getHttpServer())
        .patch(`/perfiles/${idMaestro}/permisos`)
        .set('Cookie', cookieConPermiso)
        .send({ permisoId: idPermisoGestionar, habilitado: true })
        .expect(409);
    });

    it('un permisoId que no existe responde 404', async () => {
      const id = await sembrarPerfil(`${PREFIJO} Permiso inexistente`);
      await request(app.getHttpServer())
        .patch(`/perfiles/${id}/permisos`)
        .set('Cookie', cookieConPermiso)
        .send({
          permisoId: '00000000-0000-0000-0000-000000000000',
          habilitado: true,
        })
        .expect(404);
    });

    it('un permisoId mal formado responde 400, no 500', async () => {
      const id = await sembrarPerfil(`${PREFIJO} Id malformado`);
      await request(app.getHttpServer())
        .patch(`/perfiles/${id}/permisos`)
        .set('Cookie', cookieConPermiso)
        .send({ permisoId: 'no-soy-un-uuid', habilitado: true })
        .expect(400);
    });
  });
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: falla — no hay ruta `PATCH /perfiles/:id/permisos`.

- [ ] **Step 3: DTO**

Crea `apps/backend/src/modules/auth/dto/actualizar-permiso-perfil.dto.ts`:

```ts
import { IsBoolean, IsUUID } from 'class-validator';

export class ActualizarPermisoPerfilDto {
  @IsUUID()
  permisoId!: string;

  @IsBoolean()
  habilitado!: boolean;
}
```

- [ ] **Step 4: Repositorio — `existePermiso()` y `togglePermiso()`**

Agrega a `apps/backend/src/modules/auth/perfiles.repository.ts`:

```ts
  async existePermiso(id: string): Promise<boolean> {
    const fila = await this.db
      .selectFrom('permiso')
      .select('id')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return fila !== undefined;
  }

  /**
   * `habilitado: true` -> upsert sobre el unique `(perfil_id, permiso_id)`
   * (T-05): si la fila no existia, la crea; si existia dada de baja (D del
   * spec de T-18, mismo criterio), la revive limpiando `deleted_at`.
   * `habilitado: false` -> baja logica de la fila si existe; si nunca
   * existio, no hay nada que hacer (el permiso ya esta "apagado" por
   * ausencia, que es el mismo estado final).
   */
  async togglePermiso(
    perfilId: string,
    permisoId: string,
    habilitado: boolean,
  ): Promise<void> {
    if (habilitado) {
      await this.db
        .insertInto('perfil_permiso')
        .values({ perfil_id: perfilId, permiso_id: permisoId })
        .onConflict((oc) =>
          oc
            .columns(['perfil_id', 'permiso_id'])
            .doUpdateSet({ deleted_at: null }),
        )
        .execute();
    } else {
      await this.db
        .updateTable('perfil_permiso')
        .set({ deleted_at: new Date() })
        .where('perfil_id', '=', perfilId)
        .where('permiso_id', '=', permisoId)
        .execute();
    }
  }
```

- [ ] **Step 5: Servicio — `togglePermiso()` con D2**

Agrega el método a `apps/backend/src/modules/auth/perfiles.service.ts` (dentro de la clase, después de `darDeBaja()`; agrega `NotFoundException` al import si no está ya):

```ts
  async togglePermiso(
    perfilId: string,
    permisoId: string,
    habilitado: boolean,
  ): Promise<void> {
    const perfil = await this.buscarActivoOFallar(perfilId);
    if (esMaestro(perfil.nombre)) {
      throw new ConflictException(
        'El perfil maestro ya tiene todos los permisos; no se administra por celda.',
      );
    }
    if (!(await this.repo.existePermiso(permisoId))) {
      throw new NotFoundException('Ese permiso no existe.');
    }
    await this.repo.togglePermiso(perfilId, permisoId, habilitado);
  }
```

- [ ] **Step 6: Controlador — `PATCH /perfiles/:id/permisos`**

En `apps/backend/src/modules/auth/perfiles.controller.ts`, agrega el import del DTO y el método (`/perfiles/:id/permisos` tiene un segmento más que `/perfiles/:id`, así que no hay ambigüedad de rutas sin importar el orden en que se declaren; se agrega al final del archivo solo para mantenerlo en el mismo orden que la tabla de Endpoints del spec):

```ts
import { ActualizarPermisoPerfilDto } from './dto/actualizar-permiso-perfil.dto';
```

```ts
  @Patch(':id/permisos')
  async togglePermiso(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActualizarPermisoPerfilDto,
  ): Promise<{ perfilId: string; permisoId: string; habilitado: boolean }> {
    await this.perfiles.togglePermiso(id, dto.permisoId, dto.habilitado);
    return { perfilId: id, permisoId: dto.permisoId, habilitado: dto.habilitado };
  }
```

- [ ] **Step 7: Correr la prueba e2e completa del archivo**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: todos los tests de `perfiles.e2e-spec.ts` pasan (GET + POST + PATCH `:id` + DELETE + PATCH `:id/permisos`). Corre también la suite completa para confirmar que nada más se rompió:

```bash
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
```

Compara contra tu línea base de la Task 0: el total de e2e sube en 24 (4 de `GET` + 4 de `POST` + 5 de `PATCH /:id` + 5 de `DELETE` + 6 de `PATCH /:id/permisos`, contando los `it(...)` reales de `perfiles.e2e-spec.ts` — si tu conteo no cuadra con este, confía en tu propio conteo, no en esta cifra) y el de unitarias no cambia (no se agregó ninguna función pura nueva — D2/D4 se prueban solo por e2e, mismo criterio que `VehiculosService`, que tampoco tiene `.spec.ts` propio).

- [ ] **Step 8: Lint y build**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
```

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/auth/dto/actualizar-permiso-perfil.dto.ts \
  apps/backend/src/modules/auth/perfiles.repository.ts \
  apps/backend/src/modules/auth/perfiles.service.ts \
  apps/backend/src/modules/auth/perfiles.controller.ts \
  apps/backend/test/perfiles.e2e-spec.ts
git commit -m "T-08b · PATCH /perfiles/:id/permisos: togglear una celda

Backend completo: los cinco endpoints de la matriz quedan cerrados.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Portal — pantalla `/catalogo/perfiles-y-permisos`

**Files:**
- Create: `apps/portal/src/lib/perfiles.ts`
- Create: `apps/portal/src/components/perfiles/celda-permiso.tsx`
- Create: `apps/portal/src/components/perfiles/columna-perfil.tsx`
- Create: `apps/portal/src/components/perfiles/pantalla-perfiles.tsx`
- Modify: `apps/portal/src/app/(portal)/catalogo/perfiles-y-permisos/page.tsx`

**Interfaces:**
- Consumes: `apiFetch`/`ErrorApi` de `@/lib/api`; `useAuth` de `@/components/auth/auth-provider`; `useEnvioFormulario` de `@/components/catalogo/use-envio-formulario`; `Card`/`CardContent`/`CardHeader`/`CardTitle` de `@/components/ui/card`; los cinco endpoints de las Tasks 2-6.
- Produces: la pantalla completa. Nada más del portal depende de estos archivos todavía (T-13 los usará más adelante para el desplegable de perfil).

> [!info] El portal no tiene pruebas de pantalla propias
> Mismo gap conocido que el resto del portal (T-03/T-09/T-10/T-11/T-18): esta Task se verifica a mano en la Task 8, con Playwright contra Postgres **local**. No crea ningún `.test.tsx`.

- [ ] **Step 1: Cliente API**

Crea `apps/portal/src/lib/perfiles.ts`:

```ts
import { apiFetch } from "./api";

// Copia normativa de las formas que devuelve
// apps/backend/src/modules/auth/perfiles.repository.ts y perfiles.service.ts
// -- sin tipo compartido entre backend y portal, mismo trato que lib/precios.ts.
export interface Permiso {
  id: string;
  clave: string;
  grupo: string;
  descripcion: string | null;
}

export interface Perfil {
  id: string;
  nombre: string;
  esMaestro: boolean;
  permisos: string[];
}

export interface MatrizPerfiles {
  permisos: Permiso[];
  perfiles: Perfil[];
}

export function obtenerPerfiles(): Promise<MatrizPerfiles> {
  return apiFetch<MatrizPerfiles>("/perfiles");
}

export function crearPerfil(nombre: string): Promise<Perfil> {
  return apiFetch<Perfil>("/perfiles", {
    method: "POST",
    body: JSON.stringify({ nombre }),
  });
}

export function renombrarPerfil(id: string, nombre: string): Promise<Perfil> {
  return apiFetch<Perfil>(`/perfiles/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ nombre }),
  });
}

export function darDeBajaPerfil(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/perfiles/${id}`, { method: "DELETE" });
}

export function togglePermiso(
  perfilId: string,
  permisoId: string,
  habilitado: boolean,
): Promise<{ perfilId: string; permisoId: string; habilitado: boolean }> {
  return apiFetch(`/perfiles/${perfilId}/permisos`, {
    method: "PATCH",
    body: JSON.stringify({ permisoId, habilitado }),
  });
}
```

- [ ] **Step 2: `CeldaPermiso`**

Crea `apps/portal/src/components/perfiles/celda-permiso.tsx`:

```tsx
"use client";

import { useState } from "react";
import { togglePermiso as togglePermisoApi } from "@/lib/perfiles";

interface Props {
  perfilId: string;
  permisoId: string;
  habilitadoInicial: boolean;
  editable: boolean;
}

/**
 * Estado local propio, arranca de `habilitadoInicial` una sola vez -- mismo
 * criterio que CeldaPrecio (T-18). A diferencia de esa pantalla, aqui no hay
 * un selector que remonte la matriz entera; el checkbox guarda al momento
 * (onChange, no onBlur) y revierte si el PATCH falla.
 */
export function CeldaPermiso({
  perfilId,
  permisoId,
  habilitadoInicial,
  editable,
}: Props) {
  const [habilitado, setHabilitado] = useState(habilitadoInicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(false);

  async function alCambiar(nuevoValor: boolean) {
    setHabilitado(nuevoValor);
    setGuardando(true);
    setError(false);
    try {
      await togglePermisoApi(perfilId, permisoId, nuevoValor);
    } catch {
      setHabilitado(!nuevoValor);
      setError(true);
    } finally {
      setGuardando(false);
    }
  }

  if (!editable) {
    return (
      <input
        type="checkbox"
        checked={habilitado}
        disabled
        aria-label="Permiso (perfil maestro, siempre habilitado)"
      />
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="checkbox"
        aria-label="Permiso"
        checked={habilitado}
        disabled={guardando}
        onChange={(e) => void alCambiar(e.target.checked)}
      />
      {error && (
        <span role="alert" className="text-xs text-destructive">
          No se pudo guardar
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `ColumnaPerfil`**

Crea `apps/portal/src/components/perfiles/columna-perfil.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { renombrarPerfil, darDeBajaPerfil, type Perfil } from "@/lib/perfiles";

interface Props {
  perfil: Perfil;
  /** Recarga la matriz del padre: una baja quita la columna, un renombre le cambia el titulo. */
  alCambiar: () => void;
}

export function ColumnaPerfil({ perfil, alCambiar }: Props) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(perfil.nombre);
  const { enviando, error, enviar } = useEnvioFormulario(
    "No se pudo actualizar el perfil.",
  );

  if (perfil.esMaestro) {
    return <span>{perfil.nombre}</span>;
  }

  async function guardarNombre() {
    const recortado = nombre.trim();
    if (!recortado || recortado === perfil.nombre) {
      setEditando(false);
      setNombre(perfil.nombre);
      return;
    }
    await enviar(
      () => renombrarPerfil(perfil.id, recortado),
      () => {
        setEditando(false);
        alCambiar();
      },
    );
  }

  async function confirmarBaja() {
    if (!window.confirm(`¿Dar de baja el perfil "${perfil.nombre}"?`)) return;
    await enviar(() => darDeBajaPerfil(perfil.id), alCambiar);
  }

  if (editando) {
    return (
      <div className="flex flex-col gap-1">
        <input
          aria-label="Nombre del perfil"
          value={nombre}
          disabled={enviando}
          onChange={(e) => setNombre(e.target.value)}
          onBlur={() => void guardarNombre()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="w-32 rounded-md border px-2 py-1 text-sm font-normal"
        />
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setEditando(true)}
        className="text-left font-medium"
      >
        {perfil.nombre}
      </button>
      <button
        type="button"
        onClick={() => void confirmarBaja()}
        disabled={enviando}
        className="text-left text-xs font-normal text-destructive"
      >
        Dar de baja
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 4: `PantallaPerfiles`**

Crea `apps/portal/src/components/perfiles/pantalla-perfiles.tsx`:

```tsx
"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { obtenerPerfiles, crearPerfil, type MatrizPerfiles } from "@/lib/perfiles";
import { CeldaPermiso } from "./celda-permiso";
import { ColumnaPerfil } from "./columna-perfil";

// D5 del spec: mismo orden que ORDEN_GRUPOS en perfiles.repository.ts. Son
// valores de dato de `permiso.grupo`, no etiquetas de interfaz.
const ORDEN_GRUPOS = [
  "General",
  "Operacion Comercial",
  "Produccion/Almacen",
  "Informacion",
];

function TarjetaMensaje({ mensaje }: { mensaje: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfiles y Permisos</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">{mensaje}</p>
      </CardContent>
    </Card>
  );
}

export function PantallaPerfiles() {
  const { puede, cargando } = useAuth();

  // D3 del spec: ni siquiera se intenta el GET sin el permiso -- se sabe de
  // antemano que la API responderia 403. Se espera a que la sesion termine de
  // cargar antes de decidir (si no, `puede()` devuelve false de entrada para
  // TODOS mientras `usuario` sigue en null, y un usuario con el permiso veria
  // el mensaje de "no tienes permiso" un instante antes de la matriz real).
  if (cargando) {
    return <TarjetaMensaje mensaje="Cargando…" />;
  }
  if (!puede("perfil.gestionar")) {
    return <TarjetaMensaje mensaje="No tienes permiso para ver esta sección." />;
  }
  return <Matriz />;
}

function Matriz() {
  const [datos, setDatos] = useState<MatrizPerfiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const {
    enviando: creando,
    error: errorAlta,
    enviar: enviarAlta,
  } = useEnvioFormulario("No se pudo crear el perfil.");

  // useCallback con deps vacias: setDatos/setError son estables (React lo
  // garantiza) y obtenerPerfiles() no depende de ningun prop/estado. Sin
  // esto, cada render crearia una `cargar` nueva y el useEffect de abajo
  // tendria que omitirla de sus deps o dispararse en cada render.
  const cargar = useCallback(() => {
    return obtenerPerfiles()
      .then((d) => {
        setDatos(d);
        setError(null);
      })
      .catch(() => setError("No se pudieron cargar los perfiles."));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function altaPerfil() {
    const nombre = nombreNuevo.trim();
    if (!nombre) return;
    await enviarAlta(
      () => crearPerfil(nombre),
      () => {
        setNombreNuevo("");
        void cargar();
      },
    );
  }

  if (error) {
    return <TarjetaMensaje mensaje={error} />;
  }
  if (!datos) {
    return <TarjetaMensaje mensaje="Cargando…" />;
  }

  const grupos = ORDEN_GRUPOS.filter((g) => datos.permisos.some((p) => p.grupo === g));
  const columnas = datos.perfiles.length + 2; // Permiso + N perfiles + alta

  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfiles y Permisos</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th scope="col" className="py-2 font-medium">
                  Permiso
                </th>
                {datos.perfiles.map((perfil) => (
                  <th key={perfil.id} scope="col" className="py-2 font-medium">
                    <ColumnaPerfil perfil={perfil} alCambiar={() => void cargar()} />
                  </th>
                ))}
                <th scope="col" className="py-2 font-medium">
                  <input
                    aria-label="Nombre del nuevo perfil"
                    placeholder="Nuevo perfil…"
                    value={nombreNuevo}
                    disabled={creando}
                    onChange={(e) => setNombreNuevo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void altaPerfil();
                    }}
                    className="w-32 rounded-md border px-2 py-1 text-sm font-normal"
                  />
                  {errorAlta && (
                    <p role="alert" className="text-xs font-normal text-destructive">
                      {errorAlta}
                    </p>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((grupo) => (
                <Fragment key={grupo}>
                  <tr className="border-b bg-muted/50">
                    <td colSpan={columnas} className="py-1 font-medium">
                      {grupo}
                    </td>
                  </tr>
                  {datos.permisos
                    .filter((p) => p.grupo === grupo)
                    .map((permiso) => (
                      <tr key={permiso.id} className="border-b last:border-0">
                        <td className="py-2">{permiso.descripcion ?? permiso.clave}</td>
                        {datos.perfiles.map((perfil) => (
                          <td key={perfil.id} className="py-2">
                            <CeldaPermiso
                              perfilId={perfil.id}
                              permisoId={permiso.id}
                              habilitadoInicial={perfil.permisos.includes(permiso.clave)}
                              editable={!perfil.esMaestro}
                            />
                          </td>
                        ))}
                        <td />
                      </tr>
                    ))}
                </Fragment>
              ))}
              {datos.perfiles.length === 0 && (
                <tr>
                  <td colSpan={columnas} className="py-4 text-muted-foreground">
                    No hay perfiles.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Reemplazar el placeholder de la página**

Modifica `apps/portal/src/app/(portal)/catalogo/perfiles-y-permisos/page.tsx`:

```tsx
import { PantallaPerfiles } from "@/components/perfiles/pantalla-perfiles";

export default function Page() {
  return <PantallaPerfiles />;
}
```

- [ ] **Step 6: Typecheck y lint del portal**

```bash
npm run build --workspace=apps/portal
npm run lint --workspace=apps/portal
```

Esperado: sin errores. `nav-config.ts` ya tiene la entrada "Perfiles y Permisos" apuntando a esta ruta desde antes de este ticket — no hace falta tocarlo.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/lib/perfiles.ts \
  apps/portal/src/components/perfiles/ \
  "apps/portal/src/app/(portal)/catalogo/perfiles-y-permisos/page.tsx"
git commit -m "T-08b · Pantalla de Perfiles y Permisos en el portal

Matriz permisos x perfiles con checkbox por celda (D6 del spec, sin
PantallaCatalogo), alta y renombrado inline, baja con confirmacion.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Cierre — verificación manual, vault, issue

**Files:**
- Modify (vault, repo hermano): `../jawa-obsidian-memory/10-Dominio/Entidades/Perfil.md`
- Modify (vault, repo hermano): `../jawa-obsidian-memory/00-Inicio/Estado del proyecto.md`

**Interfaces:**
- Consumes: la pantalla completa (Task 7) y los cinco endpoints (Tasks 2-6).
- Produces: nada que otra tarea consuma — es el cierre.

- [ ] **Step 1: Apuntar el backend en modo dev al Postgres local**

Confirma en `.env.development` (raíz del repo) que `DATABASE_URL` apunta al Postgres **local**, no a `sinmex dev`, antes de arrancar el portal para la verificación manual (CLAUDE.md: `npm run backend` lee `.env.development`, que por default apunta a la nube compartida).

- [ ] **Step 2: Levantar backend y portal**

```bash
npm run backend
npm run portal
```

(en dos terminales, o con `run_in_background` si tu harness lo soporta)

- [ ] **Step 3: Checklist con Playwright — con permiso**

Como un usuario `Administrador General` (o cualquiera con `perfil.gestionar` asignado por excepción), en `http://localhost:3001/catalogo/perfiles-y-permisos`:

1. La matriz carga con los 6 perfiles semilla como columnas, agrupada en las 4 categorías (General, Operación Comercial, Producción/Almacén, Información).
2. La columna "Administrador General" aparece toda marcada, con los checkboxes deshabilitados.
3. Marcar una celda de un perfil normal (p. ej. "Jefe de Ventas" × "producto.gestionar") → refrescar la página (F5) → sigue marcada.
4. Desmarcarla → refrescar → sigue vacía.
5. Escribir un nombre en el campo "Nuevo perfil…" y Enter → aparece como columna nueva, sin ninguna celda marcada.
6. Click en el nombre de un perfil normal → se vuelve editable → cambiar el nombre y salir del campo (blur) → el encabezado se actualiza.
7. Intentar (si el navegador o un cliente HTTP lo permite forzar) renombrar "Administrador General" → confirmar que la API responde error y el nombre no cambia.
8. Click en "Dar de baja" de un perfil sin usuarios asignados, confirmar el diálogo → la columna desaparece.
9. Con `psql` contra el Postgres local: asignar (a mano) el perfil de prueba creado en el paso 5 a un usuario existente y ponerlo `deleted_at is null`; intentar darlo de baja desde el portal → error visible. Quitarle ese perfil al usuario (a mano) → reintentar → ahora sí se da de baja.

- [ ] **Step 4: Checklist con Playwright — sin permiso**

Como un usuario sin `perfil.gestionar` (p. ej. uno con perfil "Auxiliar Administrativo" sin excepciones):

10. Entrar a `/catalogo/perfiles-y-permisos` → ve el mensaje "No tienes permiso para ver esta sección", sin que la pestaña de red muestre ninguna llamada a `GET /perfiles`.

- [ ] **Step 5: Correr las cuatro suites completas una última vez**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm run lint --workspace=apps/portal
npm run build --workspace=apps/portal
```

Todo en verde, comparado contra la línea base de la Task 0.

- [ ] **Step 6: Actualizar el vault**

Si `../jawa-obsidian-memory` existe en esta máquina (si no, avísale al usuario en vez de saltarte este paso):

En `10-Dominio/Entidades/Perfil.md`, actualiza el bloque `[!info]` que hoy dice "Los 6 perfiles siguen sin permisos asignados a propósito... la configurará él en T-08b": T-08b entrega la **capacidad** de configurarlos desde el portal, pero no siembra ninguna asignación por sí sola — los 6 perfiles semilla siguen vacíos hasta que un administrador los marque a mano en la matriz. Anota también, junto al resto de notas de implementación, que el código de la matriz vive en `apps/backend/src/modules/auth/` (D1 del spec), no en `nomina-comisiones` (que sigue siendo la clasificación de negocio correcta en el frontmatter).

En `00-Inicio/Estado del proyecto.md`:
- Agrega la fila de T-08 con estado "✅ Hecho" (con la fecha real de cierre) en la tabla de sprints, y quita la nota "falta T-08b" de la fila de T-08a.
- En "Próximos pasos sugeridos", quita a T-13 de la lista de bloqueados por T-08b (ya no lo está) y agrega un detalle de T-08b siguiendo el formato de las secciones anteriores (T-09/T-10/T-11/T-18): qué se hizo, decisiones D1-D7, cabos sueltos (si quedó alguno).

- [ ] **Step 7: Marcar los checkboxes del issue #8 en GitHub**

```bash
gh issue view 8
```

Edita el cuerpo del issue marcando `[x]` en los 6 criterios de aceptación cumplidos (modelo RBAC, alta de perfiles, matriz de permisos agrupados, guards en la API, base para T-13, `sucursal.gestionar` sembrado). No cierres el issue todavía si el PR no está mergeado — eso lo decide el flujo normal de revisión cruzada del equipo (ver `CLAUDE.md`).

- [ ] **Step 8: Commit final del vault (si se tocó)**

```bash
cd ../jawa-obsidian-memory
git add "10-Dominio/Entidades/Perfil.md" "00-Inicio/Estado del proyecto.md"
git commit -m "T-08b · Matriz de perfiles y permisos entregada"
git push
cd -
```

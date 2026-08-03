# T-06 · Autenticación JWT del Portal Web — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar login real al Portal Web — un usuario de oficina entra con login/contraseña, obtiene una sesión que se renueva sola durante la jornada, y la API rechaza toda petición sin sesión válida.

**Architecture:** El backend estrena su capa de acceso a datos (Kysely sobre `pg`, tipos generados desde la BD real). Sobre ella, un módulo `auth` que emite dos cookies httpOnly: un JWT de acceso corto y un refresh token opaco que rota en cada uso y se guarda hasheado en la tabla nueva `sesion_refresh`. Un guard global protege todos los endpoints salvo los marcados `@Publico()`. El portal Next.js consume esa API con `credentials: 'include'` y reintenta una vez vía `/auth/refresh` ante un 401.

**Tech Stack:** NestJS 11, Kysely + `pg`, `@node-rs/argon2`, `@nestjs/jwt`, `cookie-parser`, `class-validator`; Next.js 15 (App Router) + Tailwind v4 + shadcn/ui; Postgres 17; Jest + supertest; pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-03-t06-auth-jwt-portal-design.md`

## Global Constraints

- **Idioma del código:** identificadores de dominio en español (`usuario`, `sesion_refresh`, `hashear`), igual que el resto del repo. Comentarios en español.
- **Convenciones de tabla** (heredadas de T-05): PK `uuid` con `default gen_random_uuid()`, `created_at`/`updated_at` `timestamptz not null default now()`, trigger `set_updated_at`. Nombres de tabla en **singular**.
- **Sin `deleted_at` en `sesion_refresh`** — una sesión se revoca, no se da de baja lógica.
- **Las migraciones son la fuente de verdad del esquema.** Kysely solo consulta; nunca genera ni modifica migraciones.
- **Los tipos generados se versionan** en `apps/backend/src/database/schema.d.ts`. Nunca se editan a mano.
- **Sin permisos en este ticket.** El JWT no lleva permisos y no hay guard por permiso — eso es T-08.
- **Solo el actor `usuario`.** No se toca la tabla `vendedor` ni se crea nada offline.
- **Node 22** en CI (igual que los workflows existentes).
- **Puertos:** backend 3000, portal 3001, Postgres local de Supabase 54322.
- **Nombres de cookie:** `jawa_access` y `jawa_refresh`.
- **Comandos desde la raíz del repo**, con `--workspace=apps/backend` o `--workspace=apps/portal`.

## Requisito previo (una sola vez, antes de la Task 1)

El stack local de Supabase debe estar arriba para generar tipos y correr tests:

```bash
colima start
npm run supabase start
```

Crear `apps/../.env.test` en la **raíz del repo** (está en `.gitignore` por el patrón `.env*`):

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
JWT_SECRET=secreto-solo-para-pruebas-locales
```

Jest fija `NODE_ENV=test`, y `app.module.ts` ya carga `../../.env.${NODE_ENV}` — así los tests
apuntan a la base **local**, nunca a `sinmex dev`.

## Estructura de archivos

```
supabase/
├── migrations/<ts>_sesiones.sql          # tabla sesion_refresh
└── tests/70_sesiones_test.sql            # pgTAP de la tabla

apps/backend/src/
├── database/
│   ├── schema.d.ts                       # GENERADO por kysely-codegen, versionado
│   ├── database.tokens.ts                # token de DI + alias de tipo Database
│   ├── database.module.ts                # @Global, provee Kysely, cierra el pool
│   └── database.module.spec.ts
├── modules/auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts                # login / refresh / logout / me
│   ├── auth.service.ts                   # credenciales + armado de la respuesta
│   ├── password.service.ts               # argon2id
│   ├── password.service.spec.ts
│   ├── sesion.repository.ts              # consultas Kysely sobre sesion_refresh
│   ├── token.service.ts                  # JWT de acceso + refresh opaco + rotación
│   ├── token.service.spec.ts
│   ├── cookies.ts                        # atributos de cookie desde config
│   ├── jwt-auth.guard.ts                 # guard global de sesión
│   ├── publico.decorator.ts              # @Publico()
│   ├── usuario-actual.decorator.ts       # @UsuarioActual()
│   └── dto/login.dto.ts
└── scripts/crear-usuario.ts              # alta del primer admin

apps/backend/test/auth.e2e-spec.ts        # flujo completo contra Postgres real

apps/portal/src/
├── middleware.ts                         # redirige a /login si no hay cookie
├── app/login/page.tsx                    # pantalla de login (sin sidebar)
├── app/(portal)/layout.tsx               # MODIFICAR: envolver con AuthProvider
├── components/auth/auth-provider.tsx     # contexto con el usuario + cerrar sesión
├── components/auth/formulario-login.tsx  # componente cliente del formulario
├── components/layout/barra-usuario.tsx   # nombre + sucursal + salir
└── lib/api.ts                            # fetch con credentials + reintento por refresh
```

---

### Task 1: Capa de acceso a datos (Kysely) + Postgres en CI

Primera vez que el backend habla con la base. Incluye el soporte de CI porque sin Postgres en el
runner los tests de esta misma tarea no pueden correr.

**Files:**
- Create: `apps/backend/src/database/database.tokens.ts`
- Create: `apps/backend/src/database/database.module.ts`
- Create: `apps/backend/src/database/schema.d.ts` (generado)
- Test: `apps/backend/src/database/database.module.spec.ts`
- Modify: `apps/backend/package.json` (dependencias + script `db:types`)
- Modify: `apps/backend/src/app.module.ts` (importar `DatabaseModule`)
- Modify: `.github/workflows/backend-ci.yml` (servicio Postgres + migraciones)
- Modify: `.env.example` (documentar que `DATABASE_URL` ya la usa el backend)

**Interfaces:**
- Consumes: nada (primera tarea).
- Produces:
  - `DB_CONNECTION: string` — token de inyección.
  - `type Database = Kysely<DB>` — el tipo que inyectan todos los repositorios posteriores.
  - `DatabaseModule` — `@Global()`, exporta `DB_CONNECTION`.

- [ ] **Step 1: Instalar dependencias**

```bash
npm install kysely pg --workspace=apps/backend
npm install -D @types/pg kysely-codegen --workspace=apps/backend
```

- [ ] **Step 2: Generar los tipos desde la base local**

Agregar a `apps/backend/package.json`, en `scripts`:

```json
"db:types": "kysely-codegen --dialect postgres --out-file src/database/schema.d.ts --env-file ../../.env.test"
```

Correr (con el stack de Supabase arriba):

```bash
npm run db:types --workspace=apps/backend
```

Verificar que `apps/backend/src/database/schema.d.ts` existe y exporta `interface DB` con las
tablas de T-05 (`usuario`, `perfil`, `sucursal`, `vendedor`, …). **No editarlo a mano.**

- [ ] **Step 3: Escribir el token de DI**

`apps/backend/src/database/database.tokens.ts`:

```ts
import type { Kysely } from 'kysely';
import type { DB } from './schema';

/** Token de inyección del cliente Kysely. */
export const DB_CONNECTION = 'DB_CONNECTION';

/** Tipo que inyectan los repositorios. */
export type Database = Kysely<DB>;
```

- [ ] **Step 4: Escribir el test que falla**

`apps/backend/src/database/database.module.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database.module';
import { DB_CONNECTION, type Database } from './database.tokens';

describe('DatabaseModule', () => {
  it('provee un cliente Kysely que consulta la base real', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['../../.env.test', '../../.env'],
        }),
        DatabaseModule,
      ],
    }).compile();

    const db = moduleRef.get<Database>(DB_CONNECTION);
    const perfiles = await db.selectFrom('perfil').selectAll().execute();

    // Las semillas de T-05 insertan 6 perfiles.
    expect(perfiles).toHaveLength(6);

    await moduleRef.close();
  });
});
```

- [ ] **Step 5: Correr el test y verificar que falla**

```bash
npm test --workspace=apps/backend -- database.module.spec
```

Esperado: FAIL — `Cannot find module './database.module'`.

- [ ] **Step 6: Implementar el módulo**

`apps/backend/src/database/database.module.ts`:

```ts
import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { DB_CONNECTION, type Database } from './database.tokens';
import type { DB } from './schema';

@Global()
@Module({
  providers: [
    {
      provide: DB_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Database => {
        const connectionString = config.get<string>('DATABASE_URL');
        if (!connectionString) {
          throw new Error('Falta DATABASE_URL: el backend no puede conectarse a Postgres.');
        }
        return new Kysely<DB>({
          dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
        });
      },
    },
  ],
  exports: [DB_CONNECTION],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** Cierra el pool para que Jest no quede colgado al terminar la suite. */
  async onModuleDestroy(): Promise<void> {
    await this.db.destroy();
  }
}
```

- [ ] **Step 7: Correr el test y verificar que pasa**

```bash
npm test --workspace=apps/backend -- database.module.spec
```

Esperado: PASS (1 test).

- [ ] **Step 8: Registrar el módulo en la app**

En `apps/backend/src/app.module.ts`, agregar el import y meterlo en `imports` justo después de
`ConfigModule.forRoot({...})`:

```ts
import { DatabaseModule } from './database/database.module';
```

```ts
    ConfigModule.forRoot({ /* ... sin cambios ... */ }),
    DatabaseModule,
    VentasCobranzaModule,
```

- [ ] **Step 9: Dar Postgres a CI**

En `.github/workflows/backend-ci.yml`, dentro de `jobs.lint-and-test`, agregar **antes** de `steps:`:

```yaml
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: jawa_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/jawa_test
      JWT_SECRET: secreto-de-ci
```

Y un step nuevo, **después** de `npm ci` y **antes** de `Lint`:

```yaml
      - name: Aplicar migraciones
        run: |
          for f in supabase/migrations/*.sql; do
            echo "→ $f"
            psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
          done
```

Las migraciones de T-05 son Postgres puro (ni siquiera usan extensiones), así que no hace falta la
CLI de Supabase en el runner. `DATABASE_URL` como variable de entorno del job gana sobre los
archivos `.env` — `@nestjs/config` no sobreescribe lo que ya está en `process.env`.

- [ ] **Step 10: Verificar la suite completa**

```bash
npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend && npm test --workspace=apps/backend
```

Esperado: lint limpio, build OK, todos los tests en verde.

- [ ] **Step 11: Commit**

```bash
git add apps/backend/package.json apps/backend/src/database apps/backend/src/app.module.ts \
        .github/workflows/backend-ci.yml package-lock.json
git commit -m "T-06 · Capa de acceso a datos con Kysely + Postgres en CI"
```

---

### Task 2: Migración `sesion_refresh` + pgTAP

**Files:**
- Create: `supabase/migrations/20260803180000_sesiones.sql`
- Test: `supabase/tests/70_sesiones_test.sql`

**Interfaces:**
- Consumes: la tabla `usuario` de T-05.
- Produces: tabla `sesion_refresh` con columnas `id`, `created_at`, `updated_at`, `usuario_id`,
  `token_hash` (único), `expira_en`, `revocada_en`, `reemplazada_por`.

- [ ] **Step 1: Escribir el test pgTAP que falla**

`supabase/tests/70_sesiones_test.sql`:

```sql
begin;
select plan(8);

select has_table('sesion_refresh');
select col_is_pk('sesion_refresh', 'id');
select fk_ok('sesion_refresh', 'usuario_id', 'usuario', 'id');
select col_is_unique('sesion_refresh', 'token_hash');
select col_is_null('sesion_refresh', 'revocada_en', 'revocada_en es null mientras la sesion vive');
select col_is_null('sesion_refresh', 'reemplazada_por', 'reemplazada_por es null hasta que rota');
select has_index('sesion_refresh', 'idx_sesion_refresh_usuario');
select has_trigger('sesion_refresh', 'trg_sesion_refresh_updated');

select * from finish();
rollback;
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
npm run supabase -- test db
```

Esperado: FAIL — `relation "sesion_refresh" does not exist`.

- [ ] **Step 3: Escribir la migración**

`supabase/migrations/20260803180000_sesiones.sql`:

```sql
-- Sesiones de refresh del portal (T-06).
-- El token se guarda hasheado: robar la base no entrega sesiones usables.
-- Sin deleted_at a proposito: una sesion se revoca, no se da de baja logica.

create table sesion_refresh (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  usuario_id uuid not null references usuario(id),
  token_hash text not null unique,
  expira_en timestamptz not null,
  revocada_en timestamptz,
  reemplazada_por uuid references sesion_refresh(id)
);

create index idx_sesion_refresh_usuario on sesion_refresh (usuario_id);

create trigger trg_sesion_refresh_updated before update on sesion_refresh
  for each row execute function set_updated_at();
```

- [ ] **Step 4: Aplicar y correr los tests**

```bash
npm run supabase -- db reset
npm run supabase -- test db
```

Esperado: PASS — 39 tests en total (31 de T-05 + 8 nuevos).

- [ ] **Step 5: Regenerar los tipos de Kysely**

```bash
npm run db:types --workspace=apps/backend
```

Verificar que `schema.d.ts` ahora incluye `SesionRefresh`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260803180000_sesiones.sql supabase/tests/70_sesiones_test.sql \
        apps/backend/src/database/schema.d.ts
git commit -m "T-06 · Tabla sesion_refresh + pruebas pgTAP"
```

---

### Task 3: Hashing de contraseñas (argon2id)

**Files:**
- Create: `apps/backend/src/modules/auth/password.service.ts`
- Test: `apps/backend/src/modules/auth/password.service.spec.ts`
- Modify: `apps/backend/package.json`

**Interfaces:**
- Consumes: nada.
- Produces: `PasswordService` con
  - `hashear(plano: string): Promise<string>`
  - `verificar(hashGuardado: string, plano: string): Promise<boolean>`

- [ ] **Step 1: Instalar argon2**

```bash
npm install @node-rs/argon2 --workspace=apps/backend
```

Trae binarios precompilados — CI no necesita `node-gyp`.

- [ ] **Step 2: Escribir el test que falla**

`apps/backend/src/modules/auth/password.service.spec.ts`:

```ts
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const servicio = new PasswordService();

  it('genera un hash distinto del texto plano', async () => {
    const hash = await servicio.hashear('contrasena-secreta');
    expect(hash).not.toContain('contrasena-secreta');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verifica la contrasena correcta', async () => {
    const hash = await servicio.hashear('contrasena-secreta');
    await expect(servicio.verificar(hash, 'contrasena-secreta')).resolves.toBe(true);
  });

  it('rechaza la contrasena incorrecta', async () => {
    const hash = await servicio.hashear('contrasena-secreta');
    await expect(servicio.verificar(hash, 'otra-cosa')).resolves.toBe(false);
  });

  it('devuelve false ante un hash corrupto en vez de reventar', async () => {
    await expect(servicio.verificar('no-es-un-hash', 'lo-que-sea')).resolves.toBe(false);
  });

  it('produce hashes distintos para la misma contrasena (sal aleatoria)', async () => {
    const a = await servicio.hashear('igual');
    const b = await servicio.hashear('igual');
    expect(a).not.toBe(b);
  });
});
```

El último test importa: si dos usuarios con la misma contraseña tuvieran el mismo hash, la base
filtraría esa información.

- [ ] **Step 3: Correr y verificar que falla**

```bash
npm test --workspace=apps/backend -- password.service.spec
```

Esperado: FAIL — `Cannot find module './password.service'`.

- [ ] **Step 4: Implementar**

`apps/backend/src/modules/auth/password.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Hashing de contrasenas con argon2id (recomendacion actual de OWASP).
 * Los parametros por defecto de @node-rs/argon2 ya son los recomendados.
 */
@Injectable()
export class PasswordService {
  hashear(plano: string): Promise<string> {
    return hash(plano);
  }

  async verificar(hashGuardado: string, plano: string): Promise<boolean> {
    try {
      return await verify(hashGuardado, plano);
    } catch {
      // Hash corrupto o con formato desconocido: no es una verificacion valida.
      return false;
    }
  }
}
```

- [ ] **Step 5: Correr y verificar que pasa**

```bash
npm test --workspace=apps/backend -- password.service.spec
```

Esperado: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/auth/password.service.ts \
        apps/backend/src/modules/auth/password.service.spec.ts \
        apps/backend/package.json package-lock.json
git commit -m "T-06 · Hashing de contrasenas con argon2id"
```

---

### Task 4: Script CLI para crear el primer usuario

Sin esto no hay con qué entrar: el CRUD de usuarios es T-13.

**Files:**
- Create: `apps/backend/src/scripts/crear-usuario.ts`
- Modify: `apps/backend/package.json` (script `crear-usuario`)

**Interfaces:**
- Consumes: `PasswordService` (Task 3), `DATABASE_URL`.
- Produces: comando `npm run crear-usuario --workspace=apps/backend`.

- [ ] **Step 1: Escribir el script**

`apps/backend/src/scripts/crear-usuario.ts`:

```ts
/**
 * Alta manual de un usuario del portal.
 * Existe porque el CRUD de usuarios es T-13; sirve tambien para altas de
 * emergencia en produccion. Uso:
 *   npm run crear-usuario --workspace=apps/backend
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { config as cargarEnv } from 'dotenv';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { PasswordService } from '../modules/auth/password.service';
import type { DB } from '../database/schema';

cargarEnv({ path: `../../.env.${process.env.NODE_ENV ?? 'development'}` });

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Falta DATABASE_URL.');
  }

  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
  });
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const perfiles = await db
      .selectFrom('perfil')
      .select(['id', 'nombre'])
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .execute();
    const sucursales = await db
      .selectFrom('sucursal')
      .select(['id', 'codigo', 'nombre'])
      .where('deleted_at', 'is', null)
      .orderBy('codigo')
      .execute();

    console.log('\nPerfiles:', perfiles.map((p) => p.nombre).join(' | '));
    console.log('Sucursales:', [...sucursales.map((s) => s.codigo), 'GENERAL'].join(' | '), '\n');

    const login = (await rl.question('Login: ')).trim();
    const nombre = (await rl.question('Nombre: ')).trim();
    const contrasena = (await rl.question('Contrasena: ')).trim();
    const nombrePerfil = (await rl.question('Perfil: ')).trim();
    const codigoSucursal = (await rl.question('Sucursal (o GENERAL): ')).trim().toUpperCase();

    if (!login || !nombre || !contrasena) {
      throw new Error('Login, nombre y contrasena son obligatorios.');
    }

    const perfil = perfiles.find((p) => p.nombre === nombrePerfil);
    if (!perfil) {
      throw new Error(`No existe el perfil "${nombrePerfil}".`);
    }

    let sucursalId: string | null = null;
    if (codigoSucursal !== 'GENERAL') {
      const sucursal = sucursales.find((s) => s.codigo === codigoSucursal);
      if (!sucursal) {
        throw new Error(`No existe la sucursal "${codigoSucursal}".`);
      }
      sucursalId = sucursal.id;
    }

    const yaExiste = await db
      .selectFrom('usuario')
      .select('id')
      .where('login', '=', login)
      .executeTakeFirst();
    if (yaExiste) {
      throw new Error(`Ya existe un usuario con login "${login}".`);
    }

    const passwordHash = await new PasswordService().hashear(contrasena);

    const creado = await db
      .insertInto('usuario')
      .values({
        login,
        nombre,
        password_hash: passwordHash,
        perfil_id: perfil.id,
        sucursal_id: sucursalId,
      })
      .returning(['id', 'login'])
      .executeTakeFirstOrThrow();

    console.log(`\n✅ Usuario "${creado.login}" creado (${creado.id}).`);
  } finally {
    rl.close();
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
```

- [ ] **Step 2: Registrar el script**

En `apps/backend/package.json`, en `scripts`:

```json
"crear-usuario": "ts-node -r tsconfig-paths/register src/scripts/crear-usuario.ts"
```

Instalar `dotenv` explícitamente (viene como transitiva de `@nestjs/config`, pero el script la
importa directo):

```bash
npm install dotenv --workspace=apps/backend
```

- [ ] **Step 3: Probarlo contra la base local**

```bash
NODE_ENV=test npm run crear-usuario --workspace=apps/backend
```

Crear un usuario `admin` con perfil `Administrador General` y sucursal `GENERAL`. Esperado: mensaje
de éxito con el uuid.

- [ ] **Step 4: Verificar que rechaza un duplicado**

Correr el mismo comando con el mismo login. Esperado: `❌ Ya existe un usuario con login "admin".`
y código de salida 1.

- [ ] **Step 5: Verificar lint y build**

```bash
npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/scripts/crear-usuario.ts apps/backend/package.json package-lock.json
git commit -m "T-06 · Script CLI para dar de alta usuarios del portal"
```

---

### Task 5: Sesiones y tokens (emisión, rotación, detección de reuso)

El corazón de la seguridad del ticket. Los tests van contra la base real porque la rotación y la
detección de reuso **son** comportamiento de base de datos.

**Files:**
- Create: `apps/backend/src/modules/auth/sesion.repository.ts`
- Create: `apps/backend/src/modules/auth/token.service.ts`
- Test: `apps/backend/src/modules/auth/token.service.spec.ts`
- Modify: `apps/backend/package.json`, `.env.example`

**Interfaces:**
- Consumes: `DB_CONNECTION`/`Database` (Task 1), tabla `sesion_refresh` (Task 2).
- Produces:
  - `SesionRepository` con `crear`, `buscarPorHash`, `revocar`, `revocarTodasDelUsuario`.
  - `TokenService` con:
    - `emitirAcceso(usuarioId: string): string`
    - `emitirRefresh(usuarioId: string): Promise<string>`
    - `rotarRefresh(tokenPlano: string): Promise<{ acceso: string; refresh: string; usuarioId: string }>`
    - `revocarRefresh(tokenPlano: string): Promise<void>`
    - `verificarAcceso(token: string): { sub: string; tipo: string }`
  - `TokenInvalidoError` — error de dominio que el controller traduce a 401.

- [ ] **Step 1: Instalar el JWT**

```bash
npm install @nestjs/jwt --workspace=apps/backend
```

- [ ] **Step 2: Documentar las variables nuevas**

Agregar al final de `.env.example`:

```
# Autenticacion (T-06). Genera el secreto con: openssl rand -base64 32
JWT_SECRET=
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_HORAS=12

# Cookies de sesion. En produccion portal y API deben compartir dominio padre:
# COOKIE_DOMAIN=.ejemplo.mx, COOKIE_SECURE=true
COOKIE_DOMAIN=
COOKIE_SECURE=false
COOKIE_SAMESITE=lax

# Origen del portal, para CORS con credenciales
PORTAL_URL=http://localhost:3001
```

- [ ] **Step 3: Escribir el test que falla**

`apps/backend/src/modules/auth/token.service.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../../database/database.module';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { PasswordService } from './password.service';
import { SesionRepository } from './sesion.repository';
import { TokenService, TokenInvalidoError } from './token.service';

describe('TokenService', () => {
  let moduleRef: TestingModule;
  let servicio: TokenService;
  let db: Database;
  let usuarioId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env.test', '../../.env'] }),
        DatabaseModule,
        JwtModule.register({ secret: process.env.JWT_SECRET ?? 'secreto-de-prueba' }),
      ],
      providers: [TokenService, SesionRepository, PasswordService],
    }).compile();

    servicio = moduleRef.get(TokenService);
    db = moduleRef.get<Database>(DB_CONNECTION);

    const perfil = await db
      .selectFrom('perfil')
      .select('id')
      .orderBy('nombre')
      .executeTakeFirstOrThrow();

    const usuario = await db
      .insertInto('usuario')
      .values({
        login: `prueba-tokens-${Date.now()}`,
        nombre: 'Usuario de prueba',
        password_hash: await new PasswordService().hashear('x'),
        perfil_id: perfil.id,
        sucursal_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    usuarioId = usuario.id;
  });

  afterAll(async () => {
    await db.deleteFrom('sesion_refresh').where('usuario_id', '=', usuarioId).execute();
    await db.deleteFrom('usuario').where('id', '=', usuarioId).execute();
    await moduleRef.close();
  });

  it('el token de acceso lleva el id del usuario y el tipo', () => {
    const token = servicio.emitirAcceso(usuarioId);
    const payload = servicio.verificarAcceso(token);
    expect(payload.sub).toBe(usuarioId);
    expect(payload.tipo).toBe('usuario');
  });

  it('rechaza un token de acceso manipulado', () => {
    expect(() => servicio.verificarAcceso('esto.no.es-un-jwt')).toThrow(TokenInvalidoError);
  });

  it('guarda el refresh token hasheado, nunca en claro', async () => {
    const refresh = await servicio.emitirRefresh(usuarioId);
    const filas = await db
      .selectFrom('sesion_refresh')
      .select('token_hash')
      .where('usuario_id', '=', usuarioId)
      .execute();
    expect(filas.some((f) => f.token_hash === refresh)).toBe(false);
  });

  it('al rotar emite un refresh nuevo y revoca el anterior', async () => {
    const original = await servicio.emitirRefresh(usuarioId);
    const rotado = await servicio.rotarRefresh(original);

    expect(rotado.refresh).not.toBe(original);
    expect(rotado.usuarioId).toBe(usuarioId);
    await expect(servicio.rotarRefresh(original)).rejects.toThrow(TokenInvalidoError);
  });

  it('reusar un refresh ya rotado revoca toda la cadena del usuario', async () => {
    const original = await servicio.emitirRefresh(usuarioId);
    const rotado = await servicio.rotarRefresh(original);

    // Un atacante intenta el token viejo...
    await expect(servicio.rotarRefresh(original)).rejects.toThrow(TokenInvalidoError);

    // ...y eso tambien invalida la sesion legitima.
    await expect(servicio.rotarRefresh(rotado.refresh)).rejects.toThrow(TokenInvalidoError);
  });

  it('rechaza un refresh vencido', async () => {
    const refresh = await servicio.emitirRefresh(usuarioId);
    await db
      .updateTable('sesion_refresh')
      .set({ expira_en: new Date(Date.now() - 1000) })
      .where('usuario_id', '=', usuarioId)
      .where('revocada_en', 'is', null)
      .execute();

    await expect(servicio.rotarRefresh(refresh)).rejects.toThrow(TokenInvalidoError);
  });

  it('revocar cierra la sesion', async () => {
    const refresh = await servicio.emitirRefresh(usuarioId);
    await servicio.revocarRefresh(refresh);
    await expect(servicio.rotarRefresh(refresh)).rejects.toThrow(TokenInvalidoError);
  });

  it('rechaza un refresh que nunca existio', async () => {
    await expect(servicio.rotarRefresh('token-inventado')).rejects.toThrow(TokenInvalidoError);
  });
});
```

- [ ] **Step 4: Correr y verificar que falla**

```bash
npm test --workspace=apps/backend -- token.service.spec
```

Esperado: FAIL — `Cannot find module './sesion.repository'`.

- [ ] **Step 5: Implementar el repositorio**

`apps/backend/src/modules/auth/sesion.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

export interface Sesion {
  id: string;
  usuario_id: string;
  expira_en: Date;
  revocada_en: Date | null;
}

@Injectable()
export class SesionRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async crear(usuarioId: string, tokenHash: string, expiraEn: Date): Promise<string> {
    const fila = await this.db
      .insertInto('sesion_refresh')
      .values({ usuario_id: usuarioId, token_hash: tokenHash, expira_en: expiraEn })
      .returning('id')
      .executeTakeFirstOrThrow();
    return fila.id;
  }

  async buscarPorHash(tokenHash: string): Promise<Sesion | undefined> {
    return this.db
      .selectFrom('sesion_refresh')
      .select(['id', 'usuario_id', 'expira_en', 'revocada_en'])
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();
  }

  async revocar(id: string, reemplazadaPor: string | null = null): Promise<void> {
    await this.db
      .updateTable('sesion_refresh')
      .set({ revocada_en: new Date(), reemplazada_por: reemplazadaPor })
      .where('id', '=', id)
      .execute();
  }

  /** Corta todas las sesiones vivas del usuario (reuso de token detectado, o logout total). */
  async revocarTodasDelUsuario(usuarioId: string): Promise<void> {
    await this.db
      .updateTable('sesion_refresh')
      .set({ revocada_en: new Date() })
      .where('usuario_id', '=', usuarioId)
      .where('revocada_en', 'is', null)
      .execute();
  }
}
```

- [ ] **Step 6: Implementar el servicio de tokens**

`apps/backend/src/modules/auth/token.service.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SesionRepository } from './sesion.repository';

/** Error de dominio; el controller lo traduce a 401. */
export class TokenInvalidoError extends Error {}

export interface PayloadAcceso {
  sub: string;
  tipo: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sesiones: SesionRepository,
  ) {}

  emitirAcceso(usuarioId: string): string {
    return this.jwt.sign(
      { sub: usuarioId, tipo: 'usuario' },
      { expiresIn: this.config.get<string>('ACCESS_TOKEN_TTL', '15m') },
    );
  }

  verificarAcceso(token: string): PayloadAcceso {
    try {
      return this.jwt.verify<PayloadAcceso>(token);
    } catch {
      throw new TokenInvalidoError('Token de acceso invalido o vencido.');
    }
  }

  async emitirRefresh(usuarioId: string): Promise<string> {
    const plano = randomBytes(32).toString('base64url');
    await this.sesiones.crear(usuarioId, this.hashear(plano), this.calcularVencimiento());
    return plano;
  }

  /**
   * Rota el refresh: revoca el usado y emite uno nuevo encadenado.
   * Si el token ya estaba revocado, alguien lo esta reusando: se cortan
   * TODAS las sesiones del usuario, incluida la legitima.
   */
  async rotarRefresh(
    tokenPlano: string,
  ): Promise<{ acceso: string; refresh: string; usuarioId: string }> {
    const sesion = await this.sesiones.buscarPorHash(this.hashear(tokenPlano));

    if (!sesion) {
      throw new TokenInvalidoError('Sesion inexistente.');
    }

    if (sesion.revocada_en !== null) {
      await this.sesiones.revocarTodasDelUsuario(sesion.usuario_id);
      throw new TokenInvalidoError('Token de refresh reusado; sesiones revocadas.');
    }

    if (sesion.expira_en.getTime() <= Date.now()) {
      throw new TokenInvalidoError('Sesion vencida.');
    }

    const nuevoPlano = randomBytes(32).toString('base64url');
    const nuevoId = await this.sesiones.crear(
      sesion.usuario_id,
      this.hashear(nuevoPlano),
      this.calcularVencimiento(),
    );
    await this.sesiones.revocar(sesion.id, nuevoId);

    return {
      acceso: this.emitirAcceso(sesion.usuario_id),
      refresh: nuevoPlano,
      usuarioId: sesion.usuario_id,
    };
  }

  async revocarRefresh(tokenPlano: string): Promise<void> {
    const sesion = await this.sesiones.buscarPorHash(this.hashear(tokenPlano));
    if (sesion && sesion.revocada_en === null) {
      await this.sesiones.revocar(sesion.id);
    }
  }

  /**
   * SHA-256, no argon2: el token ya son 32 bytes aleatorios (no hay entropia
   * baja que proteger) y la busqueda por igualdad debe ser barata.
   */
  private hashear(plano: string): string {
    return createHash('sha256').update(plano).digest('hex');
  }

  private calcularVencimiento(): Date {
    const horas = Number(this.config.get<string>('REFRESH_TOKEN_TTL_HORAS', '12'));
    return new Date(Date.now() + horas * 60 * 60 * 1000);
  }
}
```

- [ ] **Step 7: Correr y verificar que pasa**

```bash
npm test --workspace=apps/backend -- token.service.spec
```

Esperado: PASS (8 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/modules/auth/sesion.repository.ts \
        apps/backend/src/modules/auth/token.service.ts \
        apps/backend/src/modules/auth/token.service.spec.ts \
        apps/backend/package.json package-lock.json .env.example
git commit -m "T-06 · Emision, rotacion y deteccion de reuso de tokens"
```

---

### Task 6: Endpoints de autenticación + cookies + CORS

**Files:**
- Create: `apps/backend/src/modules/auth/dto/login.dto.ts`
- Create: `apps/backend/src/modules/auth/cookies.ts`
- Create: `apps/backend/src/modules/auth/auth.service.ts`
- Create: `apps/backend/src/modules/auth/auth.controller.ts`
- Create: `apps/backend/src/modules/auth/auth.module.ts`
- Modify: `apps/backend/src/main.ts` (cookie-parser, CORS, ValidationPipe)
- Modify: `apps/backend/src/app.module.ts` (registrar `AuthModule`)
- Modify: `apps/backend/package.json`

**Interfaces:**
- Consumes: `PasswordService` (Task 3), `TokenService`/`TokenInvalidoError` (Task 5), `Database` (Task 1).
- Produces:
  - `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`.
  - `AuthService.buscarUsuarioPorId(id): Promise<UsuarioSesion | undefined>` — la usa el guard/controller.
  - `interface UsuarioSesion { id, login, nombre, perfil, sucursal: { id, codigo, nombre } | null }`
  - Constantes `COOKIE_ACCESO = 'jawa_access'`, `COOKIE_REFRESH = 'jawa_refresh'`.

- [ ] **Step 1: Instalar dependencias**

```bash
npm install cookie-parser class-validator class-transformer --workspace=apps/backend
npm install -D @types/cookie-parser --workspace=apps/backend
```

- [ ] **Step 2: Escribir el DTO**

`apps/backend/src/modules/auth/dto/login.dto.ts`:

```ts
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1, { message: 'El login es obligatorio.' })
  login!: string;

  @IsString()
  @MinLength(1, { message: 'La contrasena es obligatoria.' })
  password!: string;
}
```

- [ ] **Step 3: Escribir el helper de cookies**

`apps/backend/src/modules/auth/cookies.ts`:

```ts
import type { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';

export const COOKIE_ACCESO = 'jawa_access';
export const COOKIE_REFRESH = 'jawa_refresh';

/**
 * httpOnly siempre: el JS del portal nunca debe poder leer estos valores.
 * En produccion portal y API deben compartir dominio padre (COOKIE_DOMAIN).
 */
export function opcionesCookie(config: ConfigService, maxAgeMs: number): CookieOptions {
  const dominio = config.get<string>('COOKIE_DOMAIN');
  return {
    httpOnly: true,
    secure: config.get<string>('COOKIE_SECURE', 'false') === 'true',
    sameSite: config.get<string>('COOKIE_SAMESITE', 'lax') as CookieOptions['sameSite'],
    domain: dominio && dominio.length > 0 ? dominio : undefined,
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function msDeHoras(horas: number): number {
  return horas * 60 * 60 * 1000;
}
```

- [ ] **Step 4: Escribir el servicio**

`apps/backend/src/modules/auth/auth.service.ts`:

```ts
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * Hash argon2id valido de una cadena arbitraria. Se verifica contra el cuando
 * el login no existe, para que la respuesta tarde lo mismo en ambos casos.
 */
const HASH_SENUELO =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsLXNlbnVlbG8tam9zZQ$rMSuJ2GH9m3GG4T5NqYUvJHDIZ2iBcCkzZBRQBRr6mY';

export interface UsuarioSesion {
  id: string;
  login: string;
  nombre: string;
  perfil: string;
  sucursal: { id: string; codigo: string; nombre: string } | null;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Un solo 401 para "no existe" y "contrasena incorrecta": distinguirlos
   * le confirmaria a un atacante que un login existe.
   */
  async validarCredenciales(
    login: string,
    password: string,
  ): Promise<{ acceso: string; refresh: string }> {
    const usuario = await this.db
      .selectFrom('usuario')
      .select(['id', 'password_hash'])
      .where('login', '=', login)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    // Se verifica siempre, incluso sin usuario, para no filtrar por tiempo de respuesta.
    const hash = usuario?.password_hash ?? HASH_SENUELO;
    const valida = await this.passwords.verificar(hash, password);

    if (!usuario || !valida) {
      throw new UnauthorizedException('Credenciales invalidas.');
    }

    return {
      acceso: this.tokens.emitirAcceso(usuario.id),
      refresh: await this.tokens.emitirRefresh(usuario.id),
    };
  }

  async buscarUsuarioPorId(id: string): Promise<UsuarioSesion | undefined> {
    const fila = await this.db
      .selectFrom('usuario')
      .innerJoin('perfil', 'perfil.id', 'usuario.perfil_id')
      .leftJoin('sucursal', 'sucursal.id', 'usuario.sucursal_id')
      .select([
        'usuario.id as id',
        'usuario.login as login',
        'usuario.nombre as nombre',
        'perfil.nombre as perfil',
        'sucursal.id as sucursal_id',
        'sucursal.codigo as sucursal_codigo',
        'sucursal.nombre as sucursal_nombre',
      ])
      .where('usuario.id', '=', id)
      .where('usuario.deleted_at', 'is', null)
      .executeTakeFirst();

    if (!fila) {
      return undefined;
    }

    return {
      id: fila.id,
      login: fila.login,
      nombre: fila.nombre,
      perfil: fila.perfil,
      sucursal:
        fila.sucursal_id && fila.sucursal_codigo && fila.sucursal_nombre
          ? { id: fila.sucursal_id, codigo: fila.sucursal_codigo, nombre: fila.sucursal_nombre }
          : null,
    };
  }
}
```

> Si el hash señuelo de arriba no es válido para tu versión de `@node-rs/argon2` (el test de
> "login inexistente" de la Task 8 lo detecta), genéralo con:
> `node -e "require('@node-rs/argon2').hash('senuelo').then(console.log)"` desde `apps/backend`.

- [ ] **Step 5: Escribir el controller**

`apps/backend/src/modules/auth/auth.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService, type UsuarioSesion } from './auth.service';
import { COOKIE_ACCESO, COOKIE_REFRESH, msDeHoras, opcionesCookie } from './cookies';
import { LoginDto } from './dto/login.dto';
import { Publico } from './publico.decorator';
import { UsuarioActual } from './usuario-actual.decorator';
import { TokenInvalidoError, TokenService } from './token.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}

  @Publico()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const { acceso, refresh } = await this.auth.validarCredenciales(dto.login, dto.password);
    this.ponerCookies(res, acceso, refresh);
    return { ok: true };
  }

  @Publico()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const actual = (req.cookies as Record<string, string> | undefined)?.[COOKIE_REFRESH];
    if (!actual) {
      throw new UnauthorizedException('Sin sesion.');
    }

    try {
      const { acceso, refresh } = await this.tokens.rotarRefresh(actual);
      this.ponerCookies(res, acceso, refresh);
      return { ok: true };
    } catch (error) {
      if (error instanceof TokenInvalidoError) {
        this.limpiarCookies(res);
        throw new UnauthorizedException('Sesion invalida.');
      }
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const actual = (req.cookies as Record<string, string> | undefined)?.[COOKIE_REFRESH];
    if (actual) {
      await this.tokens.revocarRefresh(actual);
    }
    this.limpiarCookies(res);
    return { ok: true };
  }

  @Get('me')
  async me(@UsuarioActual() usuarioId: string): Promise<UsuarioSesion> {
    const usuario = await this.auth.buscarUsuarioPorId(usuarioId);
    if (!usuario) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    return usuario;
  }

  private ponerCookies(res: Response, acceso: string, refresh: string): void {
    const horasRefresh = Number(this.config.get<string>('REFRESH_TOKEN_TTL_HORAS', '12'));
    res.cookie(COOKIE_ACCESO, acceso, opcionesCookie(this.config, msDeHoras(horasRefresh)));
    res.cookie(COOKIE_REFRESH, refresh, opcionesCookie(this.config, msDeHoras(horasRefresh)));
  }

  private limpiarCookies(res: Response): void {
    res.clearCookie(COOKIE_ACCESO, opcionesCookie(this.config, 0));
    res.clearCookie(COOKIE_REFRESH, opcionesCookie(this.config, 0));
  }
}
```

> La cookie de acceso vive lo mismo que el refresh (12 h) **a propósito**: quien manda es el
> `expiresIn` del JWT (15 min). Si la cookie muriera a los 15 min, el navegador la borraría y el
> portal no tendría cómo saber que solo hacía falta refrescar.

- [ ] **Step 6: Escribir el módulo**

`apps/backend/src/modules/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SesionRepository } from './sesion.repository';
import { TokenService } from './token.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret) {
          // Preferimos no arrancar a arrancar inseguro.
          throw new Error('Falta JWT_SECRET.');
        }
        return { secret };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, SesionRepository],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
```

- [ ] **Step 7: Configurar `main.ts`**

Reemplazar `apps/backend/src/main.ts` por:

```ts
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: config.get<string>('PORTAL_URL', 'http://localhost:3001'),
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
```

- [ ] **Step 8: Registrar el módulo y verificar**

En `apps/backend/src/app.module.ts`, agregar el import de `AuthModule` y meterlo en `imports`
justo después de `DatabaseModule`.

Nota: `AuthController` usa `@Publico()` y `@UsuarioActual()`, que se crean en la Task 7. **Crea
primero esos dos archivos** siguiendo los Steps 1 y 2 de la Task 7, o el build no compila.

```bash
npm run build --workspace=apps/backend && npm run lint --workspace=apps/backend
```

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/auth apps/backend/src/main.ts \
        apps/backend/src/app.module.ts apps/backend/package.json package-lock.json
git commit -m "T-06 · Endpoints de login, refresh, logout y me"
```

---

### Task 7: Guard global de sesión + limpieza del scaffold

**Files:**
- Create: `apps/backend/src/modules/auth/publico.decorator.ts`
- Create: `apps/backend/src/modules/auth/usuario-actual.decorator.ts`
- Create: `apps/backend/src/modules/auth/jwt-auth.guard.ts`
- Modify: `apps/backend/src/app.module.ts` (registrar `APP_GUARD`)
- Modify: `apps/backend/src/modules/health/health.controller.ts` (marcar público)
- Delete: `apps/backend/src/app.controller.ts`, `app.service.ts`, `app.controller.spec.ts`
- Modify: `apps/backend/test/app.e2e-spec.ts`

**Interfaces:**
- Consumes: `TokenService.verificarAcceso` (Task 5), `COOKIE_ACCESO` (Task 6).
- Produces:
  - `@Publico()` — exceptúa un endpoint del guard.
  - `@UsuarioActual()` — inyecta el `id` del usuario autenticado (`string`).
  - `JwtAuthGuard` registrado como `APP_GUARD`.

**Por qué se borra el scaffold:** `AppController` sirve `"Hello World!"` en `/` — sobra de
`nest new`. Con un guard global se volvería un endpoint protegido que devuelve un saludo. El
endpoint real de salud es `/health`.

- [ ] **Step 1: Escribir el decorador `@Publico()`**

`apps/backend/src/modules/auth/publico.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const ES_PUBLICO = 'es_publico';

/** Exceptua un endpoint del guard global de sesion. */
export const Publico = () => SetMetadata(ES_PUBLICO, true);
```

- [ ] **Step 2: Escribir el decorador `@UsuarioActual()`**

`apps/backend/src/modules/auth/usuario-actual.decorator.ts`:

```ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Inyecta el id del usuario autenticado, que puso JwtAuthGuard. */
export const UsuarioActual = createParamDecorator(
  (_datos: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request & { usuarioId?: string }>();
    return req.usuarioId ?? '';
  },
);
```

- [ ] **Step 3: Escribir el guard**

`apps/backend/src/modules/auth/jwt-auth.guard.ts`:

```ts
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { COOKIE_ACCESO } from './cookies';
import { ES_PUBLICO } from './publico.decorator';
import { TokenInvalidoError, TokenService } from './token.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const esPublico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (esPublico) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<Request & { usuarioId?: string }>();
    const token = (req.cookies as Record<string, string> | undefined)?.[COOKIE_ACCESO];
    if (!token) {
      throw new UnauthorizedException('Sin sesion.');
    }

    try {
      const payload = this.tokens.verificarAcceso(token);
      if (payload.tipo !== 'usuario') {
        // Un token emitido para la app no vale en el portal.
        throw new UnauthorizedException('Tipo de sesion no valido aqui.');
      }
      req.usuarioId = payload.sub;
      return true;
    } catch (error) {
      if (error instanceof TokenInvalidoError) {
        throw new UnauthorizedException('Sesion invalida o vencida.');
      }
      throw error;
    }
  }
}
```

- [ ] **Step 4: Marcar `/health` como público**

En `apps/backend/src/modules/health/health.controller.ts`, agregar el import y el decorador sobre
la clase:

```ts
import { Publico } from '../auth/publico.decorator';
```

```ts
@Publico()
@Controller('health')
export class HealthController {
```

- [ ] **Step 5: Registrar el guard como global**

En `apps/backend/src/app.module.ts`:

```ts
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
```

Cambiar `providers` (quitando `AppService`, que se borra en el paso siguiente):

```ts
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
```

Y quitar `controllers: [AppController]` junto con sus imports.

`JwtAuthGuard` inyecta `TokenService`, que exporta `AuthModule`; con `AuthModule` ya en `imports`
el guard global lo resuelve.

- [ ] **Step 6: Borrar el scaffold de `nest new`**

```bash
git rm apps/backend/src/app.controller.ts apps/backend/src/app.service.ts \
       apps/backend/src/app.controller.spec.ts
```

- [ ] **Step 7: Reescribir el e2e existente**

Reemplazar `apps/backend/test/app.e2e-spec.ts` por:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health responde sin sesion (endpoint publico)', () => {
    return request(app.getHttpServer()).get('/health').expect(200);
  });

  it('un endpoint inexistente sigue devolviendo 404, no 401', () => {
    return request(app.getHttpServer()).get('/no-existe').expect(404);
  });
});
```

- [ ] **Step 8: Verificar todo**

```bash
npm run lint --workspace=apps/backend && \
npm run build --workspace=apps/backend && \
npm test --workspace=apps/backend && \
npm run test:e2e --workspace=apps/backend
```

Esperado: todo en verde.

- [ ] **Step 9: Commit**

```bash
git add -A apps/backend
git commit -m "T-06 · Guard global de sesion y limpieza del scaffold de nest new"
```

---

### Task 8: Prueba e2e del flujo completo

**Files:**
- Create: `apps/backend/test/auth.e2e-spec.ts`
- Modify: `.github/workflows/backend-ci.yml` (correr los e2e)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: cobertura end-to-end de login → me → refresh → logout → 401.

- [ ] **Step 1: Escribir el e2e**

`apps/backend/test/auth.e2e-spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DB_CONNECTION, type Database } from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';

const LOGIN = `e2e-auth-${Date.now()}`;
const PASSWORD = 'contrasena-de-prueba';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let usuarioId: string;

  /** Extrae el valor de una cookie del header set-cookie. */
  const leerCookie = (headers: string[] | undefined, nombre: string): string | undefined =>
    headers
      ?.find((c) => c.startsWith(`${nombre}=`))
      ?.split(';')[0]
      ?.split('=')[1];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    db = app.get<Database>(DB_CONNECTION);

    const perfil = await db
      .selectFrom('perfil')
      .select('id')
      .orderBy('nombre')
      .executeTakeFirstOrThrow();

    const usuario = await db
      .insertInto('usuario')
      .values({
        login: LOGIN,
        nombre: 'Usuario e2e',
        password_hash: await new PasswordService().hashear(PASSWORD),
        perfil_id: perfil.id,
        sucursal_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    usuarioId = usuario.id;
  });

  afterAll(async () => {
    await db.deleteFrom('sesion_refresh').where('usuario_id', '=', usuarioId).execute();
    await db.deleteFrom('usuario').where('id', '=', usuarioId).execute();
    await app.close();
  });

  it('rechaza credenciales invalidas con 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN, password: 'incorrecta' })
      .expect(401);
  });

  it('rechaza un login inexistente con el mismo 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: 'nadie-con-este-login', password: 'lo-que-sea' })
      .expect(401);
  });

  it('rechaza un body sin password con 400', async () => {
    await request(app.getHttpServer()).post('/auth/login').send({ login: LOGIN }).expect(400);
  });

  it('/auth/me sin sesion devuelve 401', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('flujo completo: login -> me -> refresh -> logout -> 401', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);

    const cookies = login.headers['set-cookie'] as unknown as string[];
    const acceso = leerCookie(cookies, 'jawa_access');
    const refresh = leerCookie(cookies, 'jawa_refresh');
    expect(acceso).toBeDefined();
    expect(refresh).toBeDefined();

    // Las cookies deben ser httpOnly.
    expect(cookies.every((c) => c.includes('HttpOnly'))).toBe(true);

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', [`jawa_access=${acceso}`])
      .expect(200);

    expect(me.body).toMatchObject({ login: LOGIN, nombre: 'Usuario e2e', sucursal: null });
    expect(me.body).not.toHaveProperty('password_hash');

    const refrescado = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`jawa_refresh=${refresh}`])
      .expect(200);

    const nuevoRefresh = leerCookie(
      refrescado.headers['set-cookie'] as unknown as string[],
      'jawa_refresh',
    );
    expect(nuevoRefresh).toBeDefined();
    expect(nuevoRefresh).not.toBe(refresh);

    // Reusar el refresh viejo es 401 y tumba la sesion nueva tambien.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`jawa_refresh=${refresh}`])
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`jawa_refresh=${nuevoRefresh}`])
      .expect(401);
  });

  it('un usuario dado de baja no puede entrar', async () => {
    await db
      .updateTable('usuario')
      .set({ deleted_at: new Date() })
      .where('id', '=', usuarioId)
      .execute();

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(401);

    await db.updateTable('usuario').set({ deleted_at: null }).where('id', '=', usuarioId).execute();
  });
});
```

- [ ] **Step 2: Correr y verificar que pasa**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: PASS (los 6 de auth + los 2 de health).

- [ ] **Step 3: Correr los e2e en CI**

En `.github/workflows/backend-ci.yml`, después del step `Test`:

```yaml
      - name: Test e2e
        run: npm run test:e2e --workspace=apps/backend
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/test/auth.e2e-spec.ts .github/workflows/backend-ci.yml
git commit -m "T-06 · Prueba e2e del flujo de autenticacion"
```

---

### Task 9: Portal — cliente de API y pantalla de login

**Files:**
- Create: `apps/portal/src/lib/api.ts`
- Create: `apps/portal/src/components/auth/formulario-login.tsx`
- Create: `apps/portal/src/app/login/page.tsx`
- Create: `apps/portal/.env.example`
- Modify: `apps/portal/src/app/layout.tsx` (metadata correcta y `lang="es"`)

**Interfaces:**
- Consumes: `POST /auth/login`, `GET /auth/me` (Task 6).
- Produces:
  - `apiFetch<T>(ruta: string, init?: RequestInit): Promise<T>` — hace el reintento por refresh.
  - `ErrorApi` con `status: number`.
  - `interface UsuarioSesion` (espejo del backend).

- [ ] **Step 1: Escribir el cliente de API**

`apps/portal/src/lib/api.ts`:

```ts
export interface UsuarioSesion {
  id: string;
  login: string;
  nombre: string;
  perfil: string;
  sucursal: { id: string; codigo: string; nombre: string } | null;
}

export class ErrorApi extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

/**
 * Llama a la API con las cookies de sesion. Ante un 401 intenta refrescar
 * UNA vez y reintenta; si tampoco funciona, propaga el 401 para que quien
 * llame mande al login.
 */
export async function apiFetch<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  const enviar = () =>
    fetch(`${API}${ruta}`, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...init.headers },
    });

  let res = await enviar();

  if (res.status === 401 && ruta !== "/auth/refresh") {
    const refrescado = await fetch(`${API}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (refrescado.ok) {
      res = await enviar();
    }
  }

  if (!res.ok) {
    throw new ErrorApi(`La peticion a ${ruta} fallo`, res.status);
  }

  return (await res.json()) as T;
}
```

- [ ] **Step 2: Escribir el formulario**

`apps/portal/src/components/auth/formulario-login.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

export function FormularioLogin() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);

    try {
      await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ login, password }),
      });
      router.replace("/operacion");
      router.refresh();
    } catch {
      // Mensaje generico a proposito: no confirmamos si el login existe.
      setError("Usuario o contrasena incorrectos.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="login" className="text-sm font-medium">
          Usuario
        </label>
        <input
          id="login"
          name="login"
          autoComplete="username"
          required
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={enviando}>
        {enviando ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Escribir la página**

`apps/portal/src/app/login/page.tsx`:

```tsx
import type { Metadata } from "next";
import { FormularioLogin } from "@/components/auth/formulario-login";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Entrar · JAWA" };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">JAWA</CardTitle>
          <p className="text-sm text-muted-foreground">Portal de administración</p>
        </CardHeader>
        <CardContent>
          <FormularioLogin />
        </CardContent>
      </Card>
    </div>
  );
}
```

Está **fuera** del grupo `(portal)`, así que no hereda el sidebar.

- [ ] **Step 4: Documentar la variable del portal**

`apps/portal/.env.example`:

```
# URL del backend NestJS. Copia este archivo como .env.local si necesitas otra.
NEXT_PUBLIC_API_URL=http://localhost:3000
```

- [ ] **Step 5: Arreglar el metadata del scaffold**

En `apps/portal/src/app/layout.tsx`, cambiar `<html lang="en">` por `<html lang="es">` y:

```ts
export const metadata: Metadata = {
  title: "JAWA · Portal",
  description: "Portal de administración de JAWA",
};
```

(Sigue diciendo "Create Next App" del scaffold de T-03.)

- [ ] **Step 6: Probarlo a mano**

Con el backend arriba (`npm run backend`) y el portal (`npm run portal`):

1. Abrir `http://localhost:3001/login`.
2. Entrar con credenciales incorrectas → aparece "Usuario o contraseña incorrectos."
3. Entrar con el usuario creado en la Task 4 → redirige a `/operacion`.
4. En DevTools → Application → Cookies: `jawa_access` y `jawa_refresh` presentes y marcadas
   **HttpOnly**.

- [ ] **Step 7: Verificar lint y build**

```bash
npm run lint --workspace=apps/portal && npm run build --workspace=apps/portal
```

- [ ] **Step 8: Commit**

```bash
git add apps/portal/src/lib/api.ts apps/portal/src/components/auth \
        apps/portal/src/app/login apps/portal/src/app/layout.tsx apps/portal/.env.example
git commit -m "T-06 · Portal: cliente de API y pantalla de login"
```

---

### Task 10: Portal — protección de rutas y sesión visible

**Files:**
- Create: `apps/portal/src/middleware.ts`
- Create: `apps/portal/src/components/auth/auth-provider.tsx`
- Create: `apps/portal/src/components/layout/barra-usuario.tsx`
- Modify: `apps/portal/src/app/(portal)/layout.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `UsuarioSesion` (Task 9); `GET /auth/me`, `POST /auth/logout` (Task 6).
- Produces: `useAuth(): { usuario: UsuarioSesion | null; cargando: boolean; cerrarSesion: () => Promise<void> }`.

- [ ] **Step 1: Escribir el middleware**

`apps/portal/src/middleware.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

/**
 * Solo comprueba que EXISTA la cookie de sesion, no valida la firma: la
 * validacion real la hace la API. Asi no duplicamos el secreto en dos servicios.
 */
export function middleware(req: NextRequest) {
  const tieneSesion = req.cookies.has("jawa_access") || req.cookies.has("jawa_refresh");

  if (!tieneSesion) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Todo menos /login, los assets de Next y el favicon.
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 2: Escribir el proveedor de sesión**

`apps/portal/src/components/auth/auth-provider.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiFetch, ErrorApi, type UsuarioSesion } from "@/lib/api";

interface ContextoAuth {
  usuario: UsuarioSesion | null;
  cargando: boolean;
  cerrarSesion: () => Promise<void>;
}

const Contexto = createContext<ContextoAuth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vigente = true;

    apiFetch<UsuarioSesion>("/auth/me")
      .then((u) => {
        if (vigente) setUsuario(u);
      })
      .catch((error: unknown) => {
        // El middleware deja pasar con la cookie presente aunque este vencida;
        // aqui es donde nos enteramos de verdad. Solo rebotamos al login si la
        // API dijo 401: una caida de red no debe sacar al usuario de la sesion.
        if (error instanceof ErrorApi && error.status === 401) {
          router.replace("/login");
        }
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });

    return () => {
      vigente = false;
    };
  }, [router]);

  const cerrarSesion = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      setUsuario(null);
      router.replace("/login");
      router.refresh();
    }
  }, [router]);

  return (
    <Contexto.Provider value={{ usuario, cargando, cerrarSesion }}>{children}</Contexto.Provider>
  );
}

export function useAuth(): ContextoAuth {
  const contexto = useContext(Contexto);
  if (!contexto) {
    throw new Error("useAuth debe usarse dentro de AuthProvider.");
  }
  return contexto;
}
```

- [ ] **Step 3: Escribir la barra de usuario**

`apps/portal/src/components/layout/barra-usuario.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";

export function BarraUsuario() {
  const { usuario, cargando, cerrarSesion } = useAuth();

  if (cargando || !usuario) {
    return <div className="h-9" />;
  }

  return (
    <div className="flex items-center justify-end gap-3 border-b pb-3 text-sm">
      <span className="font-medium">{usuario.nombre}</span>
      <span className="text-muted-foreground">
        {usuario.perfil} · {usuario.sucursal?.codigo ?? "General"}
      </span>
      <Button variant="outline" size="sm" onClick={() => void cerrarSesion()}>
        Salir
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Envolver el layout del portal**

Reemplazar `apps/portal/src/app/(portal)/layout.tsx` por:

```tsx
import type { ReactNode } from "react";
import { AuthProvider } from "@/components/auth/auth-provider";
import { BarraUsuario } from "@/components/layout/barra-usuario";
import { SidebarNav } from "@/components/layout/sidebar-nav";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <div className="flex min-h-screen">
        <aside className="w-64 shrink-0 border-r bg-background p-4">
          <div className="mb-6 px-3 text-lg font-bold">JAWA</div>
          <SidebarNav />
        </aside>
        <main className="flex-1 p-8">
          <BarraUsuario />
          <div className="pt-6">{children}</div>
        </main>
      </div>
    </AuthProvider>
  );
}
```

- [ ] **Step 5: Verificar el flujo completo a mano**

Con backend y portal arriba:

1. Abrir `http://localhost:3001/operacion` **sin sesión** → redirige a `/login`.
2. Entrar → llega a `/operacion` y arriba a la derecha aparece nombre, perfil y sucursal.
3. Pulsar "Salir" → vuelve a `/login`.
4. Volver a `http://localhost:3001/operacion` → redirige a `/login` otra vez.
5. Entrar de nuevo, borrar solo la cookie `jawa_access` en DevTools y recargar → la página sigue
   funcionando (el reintento por refresh la recupera sola).

- [ ] **Step 6: Verificar lint y build**

```bash
npm run lint --workspace=apps/portal && npm run build --workspace=apps/portal
```

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/middleware.ts apps/portal/src/components/auth \
        apps/portal/src/components/layout/barra-usuario.tsx \
        "apps/portal/src/app/(portal)/layout.tsx"
git commit -m "T-06 · Portal: proteccion de rutas y sesion visible"
```

---

### Task 11: Documentación — README, vault y cierre parcial del issue

**Files:**
- Modify: `README.md`, `CLAUDE.md`
- Create (vault): `30-Decisiones/ADR-0003 Acceso a datos del backend.md`
- Modify (vault): `00-Inicio/Estado del proyecto.md`, `10-Dominio/Entidades/Usuario.md`,
  `30-Decisiones/ADR-0002 Stack tecnológico inicial.md`, `40-Equipo/Bitácora/2026-08-03.md`

**Interfaces:**
- Consumes: todo el trabajo anterior.
- Produces: memoria del proyecto al día.

- [ ] **Step 1: Documentar los comandos nuevos en `README.md` y `CLAUDE.md`**

Agregar a la lista de comandos:

```
npm run db:types --workspace=apps/backend      # regenera los tipos de Kysely desde la BD local
npm run crear-usuario --workspace=apps/backend # da de alta un usuario del portal
npm run test:e2e --workspace=apps/backend      # pruebas end-to-end (requieren Postgres)
```

Y una nota: los tests del backend necesitan el stack local de Supabase (`colima start` +
`npm run supabase start`) y un `.env.test` en la raíz con `DATABASE_URL` y `JWT_SECRET`.

- [ ] **Step 2: Escribir el ADR-0003 en el vault**

En `../jawa-obsidian-memory/30-Decisiones/ADR-0003 Acceso a datos del backend.md`, siguiendo
`99-Plantillas/Plantilla ADR`. Contenido:

- **Estado:** aceptado — implementado en T-06.
- **Contexto:** T-05 dejó el esquema en SQL versionado con la CLI de Supabase (7 migraciones,
  31 tests pgTAP) y difirió a propósito la decisión de ORM. T-06 es el primer ticket que lee datos.
- **Opciones:** Kysely *(elegida)*, Drizzle, Prisma, driver `pg` a secas, SDK de Supabase.
- **Decisión:** Kysely como query builder tipado; `kysely-codegen` genera los tipos leyendo la
  base y se versionan en `apps/backend/src/database/schema.d.ts`. **Las migraciones SQL siguen
  siendo la fuente de verdad del esquema.**
- **Consecuencias:** el `build` falla si una migración rompe una consulta; no hay riesgo de que un
  ORM pelee por las migraciones; a cambio, menos ecosistema y ejemplos que Drizzle/Prisma, y hay
  que acordarse de correr `db:types` tras cada migración.
- Enlazar con `[[ADR-0002 Stack tecnológico inicial]]`, `[[Modelo de datos]]`, `[[Stack tecnológico]]`.

- [ ] **Step 3: Actualizar `Estado del proyecto` en el vault**

- Tabla de sprints: T-06 → **🟡 Parcial** — "Portal hecho (login, argon2id, rotación de token);
  vendedor y sesión offline pendientes, se retoman con T-04".
- Agregar un bloque **"T-06 — detalle de lo hecho (2026-08-03)"** con: Kysely + ADR-0003, tabla
  `sesion_refresh` (8 tests pgTAP → 39 en total), cookies httpOnly con rotación y detección de
  reuso, guard global, script `crear-usuario`, login del portal, y Postgres + e2e en CI.
- En "Decisiones (ADRs)": ahora son 3 ADRs, ADR-0003 aceptado.
- En "Próximos pasos": T-06 ya no es el siguiente; el camino crítico pasa a **T-08** (permisos)
  y **T-07** (sincronización).
- Actualizar el campo `actualizado:` del frontmatter.

- [ ] **Step 4: Actualizar `Usuario` y `ADR-0002` en el vault**

- `10-Dominio/Entidades/Usuario.md` → en "Notas de implementación", agregar que las contraseñas se
  guardan con **argon2id** y la sesión del portal va en **cookies httpOnly** con refresh rotativo
  (enlazar `[[ADR-0003 Acceso a datos del backend]]`). Actualizar `actualizado:`.
- `30-Decisiones/ADR-0002 Stack tecnológico inicial.md` → en la tabla de Decisión, la fila
  **Autenticación** pasa de `⏳ propuesto` a `✅ confirmado 2026-08-03 (implementado en T-06 para
  el portal; falta el vendedor/offline)`. Igual la fila **Frontend Portal Web**, que ya se venía
  usando desde T-03.

- [ ] **Step 5: Añadir la entrada a la Bitácora**

En `../jawa-obsidian-memory/40-Equipo/Bitácora/2026-08-03.md`, agregar al final: T-06 parcial, la
decisión de Kysely (ADR-0003), y que el vendedor + sesión offline quedan pendientes para T-04.

- [ ] **Step 6: Commitear el vault**

```bash
cd ../jawa-obsidian-memory
git add -A
git commit -m "T-06 · ADR-0003 (Kysely), estado del proyecto y notas de auth"
git push
cd -
```

- [ ] **Step 7: Commit del repo de código**

```bash
git add README.md CLAUDE.md
git commit -m "T-06 · Documentar comandos de base de datos y auth"
```

- [ ] **Step 8: Abrir el PR**

```bash
git push -u origin feature/t-06-auth-portal
gh pr create --title "T-06 · Autenticación JWT del Portal Web (cierre parcial)" --body "$(cat <<'EOF'
Implementa la autenticación del **Portal Web**. Referencia: T-06 (no lo cierra, ver abajo).

## Qué trae

- **Capa de acceso a datos** del backend: Kysely sobre `pg`, con tipos generados desde la BD y
  versionados. Las migraciones SQL siguen siendo la fuente de verdad del esquema (ADR-0003).
- **Tabla `sesion_refresh`** (migración 8) + 8 pruebas pgTAP → 39 en total.
- **Auth**: `POST /auth/login`, `/auth/refresh`, `/auth/logout` y `GET /auth/me`.
  Contraseñas con argon2id; access JWT de 15 min + refresh opaco de 12 h, ambos en cookies
  httpOnly. El refresh **rota en cada uso** y reusar uno viejo revoca toda la cadena.
- **Guard global**: todos los endpoints nacen protegidos; se exceptúan con `@Publico()`.
- **Script `crear-usuario`** para dar de alta usuarios (el CRUD es T-13).
- **Portal**: pantalla de login, middleware que protege las rutas, barra con el usuario y salir,
  y cliente de API que reintenta una vez vía `/auth/refresh` ante un 401.
- **CI**: el workflow del backend ahora levanta Postgres, aplica migraciones y corre los e2e.

## Qué NO trae (a propósito)

- Autenticación del **vendedor** y **sesión offline** — dependen de `apps/tablet` (T-04).
- **Permisos granulares** — son T-08 completo. El JWT no lleva permisos.
- **Rate limiting** — endurecimiento, T-60.

Por eso **el issue #6 no se cierra con este PR.**

## Limpieza incluida

Se borró el `AppController`/`AppService` de `nest new` (servía "Hello World!" en `/`); con el guard
global se habría vuelto un endpoint protegido que devuelve un saludo. El endpoint real es `/health`.

## Nota de despliegue

Las cookies exigen que portal y API compartan dominio padre en producción
(`portal.ejemplo.mx` + `api.ejemplo.mx`, con `COOKIE_DOMAIN=.ejemplo.mx`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 9: Comentar en el issue #6 (sin cerrarlo)**

```bash
gh issue comment 6 --body "$(cat <<'EOF'
Avance parcial entregado en el PR de `feature/t-06-auth-portal`, acotado al **Portal Web**.

**Cubierto:**
- [x] Login del **Portal** emitiendo JWT propio.
- [x] Hashing de contraseñas (argon2id) y expiración/rotación de token (refresh rotativo de 12 h
      con detección de reuso).

**Pendiente:**
- [ ] Login de la **App** — requiere el actor `vendedor` y que exista `apps/tablet`.
- [ ] **Sesión válida offline** durante la jornada — no se puede construir ni verificar sin cliente.

Ambos dependen de **T-04**, así que se retoman junto con él. El issue queda abierto.

De paso, este trabajo decidió el acceso a datos del backend (Kysely) — ver ADR-0003 en el vault.
EOF
)"
```

**No cerrar el issue.**

---

## Notas de verificación final

Antes de mergear, con el stack local arriba:

```bash
npm run supabase -- test db                        # 39 tests pgTAP
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm test --workspace=apps/backend                  # unitarios + integración
npm run test:e2e --workspace=apps/backend          # flujo completo
npm run lint --workspace=apps/portal
npm run build --workspace=apps/portal
```

Y el CI del PR (backend + portal) debe quedar en verde antes de mergear, según el flujo del README.

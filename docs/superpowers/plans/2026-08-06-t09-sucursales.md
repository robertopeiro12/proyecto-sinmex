# T-09 · Catálogo de Sucursales + filtro global — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development` (recomendada)
> o `superpowers:executing-plans` para ejecutar este plan tarea por tarea. Los pasos usan casillas
> (`- [ ]`) para seguimiento.

**Objetivo:** Que el administrador dé de alta y edite sucursales desde el portal, y que exista un
selector "Por sucursal / todas" cuyo alcance el servidor hace cumplir según el usuario.

**Arquitectura:** El estado del filtro vive en el query param `?sucursal=<código>` de la URL. El
backend estrena un módulo `sucursales` (repositorio Kysely + servicio + controlador) cuya regla de
alcance es una función pura reutilizable por los catálogos siguientes. El portal estrena su primera
pantalla con datos reales, siguiendo el patrón ya establecido en `formulario-login.tsx`.

**Stack:** NestJS 11 + Kysely + Postgres (Supabase local) en el backend; Next.js 15 (App Router) +
Tailwind v4 en el portal; Jest + supertest para e2e; pgTAP para la base.

**Spec:** `docs/superpowers/specs/2026-08-06-t09-sucursales-design.md` — léelo antes de empezar.
Las decisiones se citan como D1…D7.

## Restricciones globales

- **Idioma del código:** identificadores, comentarios y mensajes de error en **español**, sin
  acentos en los identificadores. Es la convención de todo el repo.
- **Comentarios:** explican *por qué*, no *qué*. El repo tiene un estándar alto en esto (ver
  `sesion.repository.ts`, `configurar-app.ts`); mantenlo.
- **Nunca** editar el `codigo` de una sucursal después del alta (D5).
- **Nunca** escribir `deleted_at` en `sucursal` (D6).
- **No** agregar dependencias nuevas al portal. Se usa `<table>`, `<input>` y `<label>` de HTML con
  Tailwind, más `Button`/`Card` que ya existen.
- El valor reservado del query param es la cadena literal `todas`, en minúsculas.
- Los códigos de sucursal son exactamente **2 letras mayúsculas** (`^[A-Z]{2}$`).
- Todos los comandos se corren **desde la raíz del repo**, con los scripts del workspace.

### Requisitos de entorno (una sola vez, antes de la Tarea 1)

```bash
colima start
npm run supabase -- start
```

Y en la raíz debe existir `.env.test` con `DATABASE_URL` (al Postgres local) y `JWT_SECRET`.
Sin eso, `npm test` y `npm run test:e2e` fallan por conexión, no por el código.

## Estructura de archivos

**Base de datos**

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/20260806120000_sucursal_codigo_formato.sql` | Check de formato del código |
| `supabase/tests/80_sucursales_test.sql` | pgTAP del check |

**Backend** — todo bajo `apps/backend/src/modules/sucursales/`

| Archivo | Responsabilidad |
|---|---|
| `alcance-sucursal.ts` | Regla pura: qué sucursales puede ver un usuario (D2, D3) |
| `alcance-sucursal.spec.ts` | Pruebas unitarias de esa regla |
| `sucursales.repository.ts` | Acceso a datos con Kysely. Sin reglas de negocio |
| `sucursales.service.ts` | Reglas: alcance, 409 por duplicado, 404, validación de cambios |
| `sucursales.controller.ts` | Superficie HTTP |
| `sucursales.module.ts` | Cableado Nest |
| `dto/crear-sucursal.dto.ts` | Validación del alta |
| `dto/editar-sucursal.dto.ts` | Validación de la edición (sin `codigo` — así se aplica D5) |
| `apps/backend/src/app.module.ts` | *(modificar)* registrar el módulo |
| `apps/backend/test/sucursales.e2e-spec.ts` | e2e de los 3 endpoints |

**Portal** — bajo `apps/portal/src/`

| Archivo | Responsabilidad |
|---|---|
| `lib/api.ts` | *(modificar)* que `ErrorApi` cargue el mensaje de la API |
| `lib/sucursales.ts` | Tipo `Sucursal` + las 3 llamadas a la API |
| `app/(portal)/catalogo/sucursales/page.tsx` | Lee `searchParams`, delega |
| `components/sucursales/pantalla-sucursales.tsx` | Carga, estado, tabla |
| `components/sucursales/formulario-sucursal.tsx` | Alta y edición |
| `components/layout/selector-sucursal.tsx` | Selector "Por sucursal" |
| `components/layout/nav-config.ts` | *(modificar)* ruta nueva |
| `components/layout/sidebar-nav.tsx` | *(modificar)* preservar `?sucursal=` |
| `components/layout/barra-usuario.tsx` | *(modificar)* montar el selector |

---

## Tarea 1: Check de formato del código de sucursal

**Archivos:**
- Crear: `supabase/migrations/20260806120000_sucursal_codigo_formato.sql`
- Crear: `supabase/tests/80_sucursales_test.sql`

**Interfaces:**
- Consume: la tabla `sucursal` de `20260803163003_identidad_y_permisos.sql`
- Produce: la restricción `sucursal_codigo_formato`, de la que dependen las Tareas 4 y 5

Las semillas TJ/MX ya se verifican en `60_semillas_test.sql`; no las repitas aquí.

- [ ] **Paso 1: Escribir la prueba pgTAP que falla**

Crea `supabase/tests/80_sucursales_test.sql`:

```sql
begin;
select plan(5);

-- El codigo abre el folio de cada operacion (ADR-0001) y los folios ya
-- emitidos no se pueden corregir hacia atras. Por eso el formato se defiende
-- en la base y no solo en el DTO del backend: las semillas, el script
-- crear-usuario y cualquier carga futura entran por debajo de la API.
select throws_ok(
  $$insert into sucursal (codigo, nombre) values ('tj', 'Minusculas')$$,
  '23514',
  null,
  'rechaza un codigo en minusculas'
);

select throws_ok(
  $$insert into sucursal (codigo, nombre) values ('T', 'Una letra')$$,
  '23514',
  null,
  'rechaza un codigo de una letra'
);

select throws_ok(
  $$insert into sucursal (codigo, nombre) values ('TIJ', 'Tres letras')$$,
  '23514',
  null,
  'rechaza un codigo de tres letras'
);

select throws_ok(
  $$insert into sucursal (codigo, nombre) values ('T1', 'Con digito')$$,
  '23514',
  null,
  'rechaza un codigo con digito'
);

select lives_ok(
  $$insert into sucursal (codigo, nombre) values ('GD', 'Guadalajara')$$,
  'acepta un codigo nuevo de 2 letras mayusculas'
);

select * from finish();
rollback;
```

- [ ] **Paso 2: Correr la prueba y verificar que falla**

```bash
npm run supabase -- test db
```

Esperado: `80_sucursales_test.sql` falla. Los cuatro `throws_ok` reportan que el insert **no**
lanzó `23514` (sin el check, los cuatro inserts pasan). El `lives_ok` sí pasa.

Si en vez de eso ves un error de conexión, el stack local no está arriba — vuelve a
"Requisitos de entorno".

- [ ] **Paso 3: Escribir la migración**

Crea `supabase/migrations/20260806120000_sucursal_codigo_formato.sql`:

```sql
-- Las 2 letras del codigo son el primer segmento del folio de cada operacion
-- (ADR-0001, p. ej. TJ260322AP05). Un codigo con otro formato dejaria folios
-- historicos apuntando a algo que no existe, y esos folios ya no se pueden
-- corregir. La restriccion vive en la base porque las semillas, el script
-- crear-usuario y cualquier carga futura no pasan por el DTO del backend.
alter table sucursal
  add constraint sucursal_codigo_formato check (codigo ~ '^[A-Z]{2}$');
```

- [ ] **Paso 4: Aplicar la migración y correr las pruebas**

```bash
npm run supabase -- db reset
npm run supabase -- test db
```

Esperado: **44 pruebas en verde** (las 39 previas + las 5 nuevas).

`db reset` reconstruye la base desde cero aplicando todas las migraciones. Es seguro: la base local
es descartable y las semillas se vuelven a aplicar. **No** corras esto contra `sinmex dev`.

- [ ] **Paso 5: Commit**

```bash
git add supabase/migrations/20260806120000_sucursal_codigo_formato.sql supabase/tests/80_sucursales_test.sql
git commit -m "T-09 · Check de formato del codigo de sucursal

El codigo abre el folio de cada operacion (ADR-0001), asi que el formato
se defiende en la base: las semillas y crear-usuario no pasan por el DTO."
```

---

## Tarea 2: La regla de alcance (lógica pura)

**Archivos:**
- Crear: `apps/backend/src/modules/sucursales/alcance-sucursal.ts`
- Test: `apps/backend/src/modules/sucursales/alcance-sucursal.spec.ts`

**Interfaces:**
- Consume: nada (lógica pura, sin base de datos)
- Produce:
  - `const TODAS = 'todas'`
  - `type Alcance = { tipo: 'todas' } | { tipo: 'una'; codigo: string }`
  - `resolverAlcance(codigoDelUsuario: string | null, codigoPedido: string | null): Alcance`
  - `normalizarSucursalPedida(crudo: string | undefined): string | null`

Es la pieza que T-10, T-11, T-12, T-13 y T-62 van a reutilizar tal cual, y la única del ticket que
se puede probar exhaustivamente sin Postgres.

- [ ] **Paso 1: Escribir las pruebas que fallan**

Crea `apps/backend/src/modules/sucursales/alcance-sucursal.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import {
  normalizarSucursalPedida,
  resolverAlcance,
  TODAS,
} from './alcance-sucursal';

describe('resolverAlcance', () => {
  describe('usuario General (sucursal_id null en la base)', () => {
    it('sin pedir nada ve todas', () => {
      expect(resolverAlcance(null, null)).toEqual({ tipo: 'todas' });
    });

    it('pidiendo "todas" ve todas', () => {
      expect(resolverAlcance(null, TODAS)).toEqual({ tipo: 'todas' });
    });

    it('pidiendo una sucursal concreta ve solo esa', () => {
      expect(resolverAlcance(null, 'TJ')).toEqual({ tipo: 'una', codigo: 'TJ' });
    });
  });

  describe('usuario atado a una sucursal', () => {
    it('sin pedir nada ve la suya', () => {
      expect(resolverAlcance('TJ', null)).toEqual({ tipo: 'una', codigo: 'TJ' });
    });

    it('pidiendo la suya ve la suya', () => {
      expect(resolverAlcance('TJ', 'TJ')).toEqual({ tipo: 'una', codigo: 'TJ' });
    });

    // Pedir "todas" no nombra una sucursal ajena: es el selector que se quedo
    // en la URL al navegar, no un intento de escalar. Devolverle lo suyo es
    // correcto Y amable; un 403 aqui romperia la navegacion normal.
    it('pidiendo "todas" recibe la suya, no un 403', () => {
      expect(resolverAlcance('TJ', TODAS)).toEqual({ tipo: 'una', codigo: 'TJ' });
    });

    it('pidiendo otra sucursal recibe 403', () => {
      expect(() => resolverAlcance('TJ', 'MX')).toThrow(ForbiddenException);
    });
  });
});

describe('normalizarSucursalPedida', () => {
  it('trata el param ausente como null', () => {
    expect(normalizarSucursalPedida(undefined)).toBeNull();
  });

  // ?sucursal= (vacio) es lo que produce un formulario o un link mal armado.
  // Tratarlo como "" en vez de como ausente haria que resolverAlcance buscara
  // una sucursal con codigo vacio y devolviera una lista vacia sin explicar
  // por que.
  it('trata el param vacio como null', () => {
    expect(normalizarSucursalPedida('   ')).toBeNull();
  });

  it('sube el codigo a mayusculas', () => {
    expect(normalizarSucursalPedida('tj')).toBe('TJ');
  });

  it('reconoce "todas" sin importar como venga escrito', () => {
    expect(normalizarSucursalPedida('TODAS')).toBe(TODAS);
    expect(normalizarSucursalPedida('todas')).toBe(TODAS);
  });
});
```

- [ ] **Paso 2: Correr las pruebas y verificar que fallan**

```bash
npm test --workspace=apps/backend -- alcance-sucursal
```

Esperado: FAIL — `Cannot find module './alcance-sucursal'`.

- [ ] **Paso 3: Escribir la implementación**

Crea `apps/backend/src/modules/sucursales/alcance-sucursal.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';

/**
 * Valor reservado del query param para "todas las sucursales". No puede
 * chocar con ningun codigo real: los codigos son 2 letras MAYUSCULAS
 * (restriccion sucursal_codigo_formato) y este valor va en minusculas.
 */
export const TODAS = 'todas';

export type Alcance = { tipo: 'todas' } | { tipo: 'una'; codigo: string };

/**
 * Decide que sucursales puede ver el usuario. El query param es solo una
 * preferencia de UI: quien manda es la sucursal asignada al usuario, y por eso
 * esta funcion se llama SIEMPRE en el servidor, nunca se confia en el cliente.
 *
 * Es una funcion pura a proposito. La misma regla la van a necesitar los cinco
 * catalogos que siguen (T-10, T-11, T-12, T-13, T-62), y aislada de la base se
 * puede probar entera sin montar Postgres.
 *
 * @param codigoDelUsuario codigo de su sucursal, o null si es General
 * @param codigoPedido lo que pidio en la URL, ya normalizado
 */
export function resolverAlcance(
  codigoDelUsuario: string | null,
  codigoPedido: string | null,
): Alcance {
  // General: manda lo que pida.
  if (codigoDelUsuario === null) {
    if (codigoPedido === null || codigoPedido === TODAS) {
      return { tipo: 'todas' };
    }
    return { tipo: 'una', codigo: codigoPedido };
  }

  // Atado a una sucursal: siempre la suya. "todas" y "nada" NO son error —
  // ninguno nombra una sucursal ajena, y ambos son lo que produce navegar con
  // un selector que quedo puesto. Solo pedir OTRA sucursal por su nombre es
  // un intento de salirse del alcance.
  if (
    codigoPedido === null ||
    codigoPedido === TODAS ||
    codigoPedido === codigoDelUsuario
  ) {
    return { tipo: 'una', codigo: codigoDelUsuario };
  }

  throw new ForbiddenException('No tienes acceso a esa sucursal.');
}

/**
 * Normaliza el valor crudo del query param antes de pasarlo a resolverAlcance.
 *
 * Es permisiva con las mayusculas porque un codigo mal capitalizado en un link
 * escrito a mano no es un error que le importe a nadie, y el valor reservado
 * "todas" se compara aparte, asi que subir a mayusculas no lo puede pisar.
 */
export function normalizarSucursalPedida(
  crudo: string | undefined,
): string | null {
  const limpio = crudo?.trim();
  if (!limpio) {
    return null;
  }
  if (limpio.toLowerCase() === TODAS) {
    return TODAS;
  }
  return limpio.toUpperCase();
}
```

- [ ] **Paso 4: Correr las pruebas y verificar que pasan**

```bash
npm test --workspace=apps/backend -- alcance-sucursal
```

Esperado: PASS, 11 pruebas.

- [ ] **Paso 5: Commit**

```bash
git add apps/backend/src/modules/sucursales/alcance-sucursal.ts apps/backend/src/modules/sucursales/alcance-sucursal.spec.ts
git commit -m "T-09 · Regla de alcance por sucursal

Funcion pura: el query param propone, la sucursal del usuario dispone.
La reutilizan los cinco catalogos que siguen (T-10..T-62)."
```

---

## Tarea 3: Módulo backend y `GET /sucursales`

**Archivos:**
- Crear: `apps/backend/src/modules/sucursales/sucursales.repository.ts`
- Crear: `apps/backend/src/modules/sucursales/sucursales.service.ts`
- Crear: `apps/backend/src/modules/sucursales/sucursales.controller.ts`
- Crear: `apps/backend/src/modules/sucursales/sucursales.module.ts`
- Modificar: `apps/backend/src/app.module.ts`
- Test: `apps/backend/test/sucursales.e2e-spec.ts`

**Interfaces:**
- Consume: `resolverAlcance`, `normalizarSucursalPedida`, `TODAS` (Tarea 2);
  `DB_CONNECTION`/`Database` de `src/database/database.tokens`; `UsuarioActual` de
  `src/modules/auth/usuario-actual.decorator`
- Produce:
  - `interface Sucursal { id: string; codigo: string; nombre: string; activa: boolean }`
  - `SucursalesRepository.listar()`, `.listarPorCodigo(codigo)`,
    `.buscarSucursalDeUsuario(usuarioId)`
  - `SucursalesService.listar(usuarioId, sucursalPedida)`
  - `GET /sucursales?sucursal=<código|todas>`

- [ ] **Paso 1: Escribir el e2e que falla**

Crea `apps/backend/test/sucursales.e2e-spec.ts`:

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

interface SucursalRespuesta {
  id: string;
  codigo: string;
  nombre: string;
  activa: boolean;
}

const SUFIJO = Date.now();
const LOGIN_GENERAL = `e2e-suc-gral-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-suc-tj-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';

// Codigos reservados para las pruebas. Se limpian en afterAll: el espacio de
// codigos es minusculo (2 letras) y una corrida que deje basura envenenaria
// las siguientes con 409 inesperados. Nunca uses TJ ni MX aqui: son semillas
// reales y borrarlas romperia el resto de la suite.
const CODIGOS_DE_PRUEBA = ['ZA', 'ZB', 'ZC'];

describe('Sucursales (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let usuarioIds: string[] = [];
  let cookieGeneral: string;
  let cookieTijuana: string;
  let idMexicali: string;

  /** Inicia sesion y devuelve la cookie de acceso lista para `.set('Cookie', …)`. */
  const iniciarSesion = async (login: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const acceso = cookies
      .find((c) => c.startsWith('jawa_access='))
      ?.split(';')[0];
    if (!acceso) {
      throw new Error('El login no devolvio cookie de acceso.');
    }
    return acceso;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Misma configuracion que main.ts, por la razon explicada en
    // configurar-app.ts: una copia a mano podria divergir de produccion.
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await app.init();

    db = app.get<Database>(DB_CONNECTION);

    const perfil = await db
      .selectFrom('perfil')
      .select('id')
      .orderBy('nombre')
      .executeTakeFirstOrThrow();

    const tijuana = await db
      .selectFrom('sucursal')
      .select('id')
      .where('codigo', '=', 'TJ')
      .executeTakeFirstOrThrow();

    const mexicali = await db
      .selectFrom('sucursal')
      .select('id')
      .where('codigo', '=', 'MX')
      .executeTakeFirstOrThrow();
    idMexicali = mexicali.id;

    const hash = await new PasswordService().hashear(PASSWORD);

    // Los DOS usuarios son el corazon de esta suite: con uno solo, la regla de
    // alcance (D2/D3) queda sin verificar de punta a punta.
    const general = await db
      .insertInto('usuario')
      .values({
        login: LOGIN_GENERAL,
        nombre: 'Usuario General e2e',
        password_hash: hash,
        perfil_id: perfil.id,
        sucursal_id: null, // null = General
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const deTijuana = await db
      .insertInto('usuario')
      .values({
        login: LOGIN_TIJUANA,
        nombre: 'Usuario Tijuana e2e',
        password_hash: hash,
        perfil_id: perfil.id,
        sucursal_id: tijuana.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    usuarioIds = [general.id, deTijuana.id];

    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
  });

  afterAll(async () => {
    await db
      .deleteFrom('sucursal')
      .where('codigo', 'in', CODIGOS_DE_PRUEBA)
      .execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  describe('GET /sucursales', () => {
    it('sin sesion responde 401', async () => {
      await request(app.getHttpServer()).get('/sucursales').expect(401);
    });

    it('un usuario General ve todas las sucursales', async () => {
      const res = await request(app.getHttpServer())
        .get('/sucursales')
        .set('Cookie', [cookieGeneral])
        .expect(200);

      const codigos = (res.body as SucursalRespuesta[]).map((s) => s.codigo);
      expect(codigos).toEqual(expect.arrayContaining(['TJ', 'MX']));
    });

    it('un usuario General puede acotar a una sucursal', async () => {
      const res = await request(app.getHttpServer())
        .get('/sucursales?sucursal=TJ')
        .set('Cookie', [cookieGeneral])
        .expect(200);

      const codigos = (res.body as SucursalRespuesta[]).map((s) => s.codigo);
      expect(codigos).toEqual(['TJ']);
    });

    it('un usuario atado a Tijuana solo ve la suya, aunque no pida nada', async () => {
      const res = await request(app.getHttpServer())
        .get('/sucursales')
        .set('Cookie', [cookieTijuana])
        .expect(200);

      const codigos = (res.body as SucursalRespuesta[]).map((s) => s.codigo);
      expect(codigos).toEqual(['TJ']);
    });

    it('un usuario atado que pide "todas" recibe la suya, no un 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/sucursales?sucursal=todas')
        .set('Cookie', [cookieTijuana])
        .expect(200);

      const codigos = (res.body as SucursalRespuesta[]).map((s) => s.codigo);
      expect(codigos).toEqual(['TJ']);
    });

    it('un usuario atado que pide OTRA sucursal recibe 403', async () => {
      // Este es el caso que justifica los dos usuarios. Si el backend
      // confiara en el query param, aqui devolveria los datos de Mexicali con
      // un 200 y nadie se enteraria.
      await request(app.getHttpServer())
        .get('/sucursales?sucursal=MX')
        .set('Cookie', [cookieTijuana])
        .expect(403);
    });
  });
});
```

- [ ] **Paso 2: Correr el e2e y verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend -- sucursales
```

Esperado: FAIL — todos los casos de `GET` dan 404 (la ruta no existe todavía), salvo el de "sin
sesión", que ya pasa gracias al guard global.

- [ ] **Paso 3: Escribir el repositorio**

Crea `apps/backend/src/modules/sucursales/sucursales.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

export interface Sucursal {
  id: string;
  codigo: string;
  nombre: string;
  activa: boolean;
}

/** Las columnas que salen a la API. `deleted_at` nunca se expone (ver D6). */
const CAMPOS = ['id', 'codigo', 'nombre', 'activa'] as const;

@Injectable()
export class SucursalesRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * Devuelve activas E inactivas a proposito: la pantalla del catalogo
   * necesita ver una sucursal desactivada para poder reactivarla. Quien solo
   * quiera las activas (el selector) filtra por su cuenta.
   */
  async listar(): Promise<Sucursal[]> {
    return this.db
      .selectFrom('sucursal')
      .select(CAMPOS)
      .where('deleted_at', 'is', null)
      .orderBy('codigo')
      .execute();
  }

  async listarPorCodigo(codigo: string): Promise<Sucursal[]> {
    return this.db
      .selectFrom('sucursal')
      .select(CAMPOS)
      .where('deleted_at', 'is', null)
      .where('codigo', '=', codigo)
      .execute();
  }

  /**
   * El codigo de la sucursal del usuario. Distingue tres casos que NO se
   * pueden colapsar:
   *   - `undefined`      -> el usuario no existe o esta dado de baja
   *   - `{ codigo: null }` -> existe y es General
   *   - `{ codigo: 'TJ' }` -> existe y esta atado a Tijuana
   * Devolver `null` para los dos primeros convertiria a un usuario borrado en
   * uno con acceso a todas las sucursales.
   */
  async buscarSucursalDeUsuario(
    usuarioId: string,
  ): Promise<{ codigo: string | null } | undefined> {
    return this.db
      .selectFrom('usuario')
      .leftJoin('sucursal', 'sucursal.id', 'usuario.sucursal_id')
      .select('sucursal.codigo as codigo')
      .where('usuario.id', '=', usuarioId)
      .where('usuario.deleted_at', 'is', null)
      .executeTakeFirst();
  }
}
```

- [ ] **Paso 4: Escribir el servicio**

Crea `apps/backend/src/modules/sucursales/sucursales.service.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { resolverAlcance, type Alcance } from './alcance-sucursal';
import { SucursalesRepository, type Sucursal } from './sucursales.repository';

@Injectable()
export class SucursalesService {
  constructor(private readonly repo: SucursalesRepository) {}

  async listar(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Sucursal[]> {
    const alcance = await this.alcanceDe(usuarioId, sucursalPedida);
    return alcance.tipo === 'todas'
      ? this.repo.listar()
      : this.repo.listarPorCodigo(alcance.codigo);
  }

  /**
   * El JWT solo lleva `sub` y `tipo` (decision de T-06), asi que la sucursal
   * del usuario no viaja en el token y hay que consultarla. Es una lectura por
   * PK con un join; meterla en el token o cachearla corresponde a T-08, cuando
   * el guard tenga que cargar tambien los permisos y valga la pena resolver el
   * problema una sola vez para todo.
   */
  private async alcanceDe(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Alcance> {
    const fila = await this.repo.buscarSucursalDeUsuario(usuarioId);
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    // Un token vivo de alguien dado de baja llega hasta aqui.
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    return resolverAlcance(fila.codigo, sucursalPedida);
  }
}
```

- [ ] **Paso 5: Escribir el controlador y el módulo**

Crea `apps/backend/src/modules/sucursales/sucursales.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { normalizarSucursalPedida } from './alcance-sucursal';
import { SucursalesService } from './sucursales.service';
import type { Sucursal } from './sucursales.repository';

// Sin @Publico(): el guard global de app.module.ts protege todo por defecto.
// El permiso fino (`sucursal.gestionar`) llega con T-08.
@Controller('sucursales')
export class SucursalesController {
  constructor(private readonly sucursales: SucursalesService) {}

  @Get()
  async listar(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
  ): Promise<Sucursal[]> {
    return this.sucursales.listar(
      usuarioId,
      normalizarSucursalPedida(sucursal),
    );
  }
}
```

Crea `apps/backend/src/modules/sucursales/sucursales.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SucursalesController } from './sucursales.controller';
import { SucursalesRepository } from './sucursales.repository';
import { SucursalesService } from './sucursales.service';

@Module({
  controllers: [SucursalesController],
  providers: [SucursalesService, SucursalesRepository],
})
export class SucursalesModule {}
```

Modifica `apps/backend/src/app.module.ts`: agrega el import junto a los demás módulos

```ts
import { SucursalesModule } from './modules/sucursales/sucursales.module';
```

y añade `SucursalesModule,` al arreglo `imports`, justo después de `AuthModule,`.

- [ ] **Paso 6: Correr el e2e y verificar que pasa**

```bash
npm run test:e2e --workspace=apps/backend -- sucursales
```

Esperado: PASS, 6 pruebas.

- [ ] **Paso 7: Lint y build**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
```

Esperado: sin errores.

- [ ] **Paso 8: Commit**

```bash
git add apps/backend/src/modules/sucursales apps/backend/src/app.module.ts apps/backend/test/sucursales.e2e-spec.ts
git commit -m "T-09 · GET /sucursales con alcance por usuario

Modulo nuevo 'sucursales', fuera de los 12 slugs de dominio del vault
porque Sucursal los atraviesa todos (D7). El listado ya aplica el
alcance: un usuario atado recibe solo la suya."
```

---

## Tarea 4: `POST /sucursales`

**Archivos:**
- Crear: `apps/backend/src/modules/sucursales/dto/crear-sucursal.dto.ts`
- Modificar: `apps/backend/src/modules/sucursales/sucursales.repository.ts`
- Modificar: `apps/backend/src/modules/sucursales/sucursales.service.ts`
- Modificar: `apps/backend/src/modules/sucursales/sucursales.controller.ts`
- Test: `apps/backend/test/sucursales.e2e-spec.ts` *(agregar un `describe`)*

**Interfaces:**
- Consume: `SucursalesRepository`, `SucursalesService` de la Tarea 3
- Produce: `POST /sucursales` con cuerpo `{ codigo, nombre }` → `Sucursal`, 201

- [ ] **Paso 1: Escribir los e2e que fallan**

Agrega este `describe` dentro del `describe('Sucursales (e2e)')` de
`apps/backend/test/sucursales.e2e-spec.ts`, después del bloque de `GET`:

```ts
  describe('POST /sucursales', () => {
    it('sin sesion responde 401', async () => {
      await request(app.getHttpServer())
        .post('/sucursales')
        .send({ codigo: 'ZA', nombre: 'Zapopan' })
        .expect(401);
    });

    it('crea una sucursal y aparece en el listado', async () => {
      const res = await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', [cookieGeneral])
        .send({ codigo: 'ZA', nombre: 'Zapopan' })
        .expect(201);

      expect(res.body).toMatchObject({
        codigo: 'ZA',
        nombre: 'Zapopan',
        activa: true, // default de la tabla
      });

      const listado = await request(app.getHttpServer())
        .get('/sucursales')
        .set('Cookie', [cookieGeneral])
        .expect(200);

      const codigos = (listado.body as SucursalRespuesta[]).map((s) => s.codigo);
      expect(codigos).toContain('ZA');
    });

    it('rechaza un codigo repetido con 409 y un mensaje que nombra el codigo', async () => {
      // Depende de que el test anterior ya creo ZA. Se afirma el mensaje y no
      // solo el status porque el portal lo muestra tal cual junto al campo:
      // si degradara a un texto generico, la pantalla empeoraria en silencio.
      const res = await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', [cookieGeneral])
        .send({ codigo: 'ZA', nombre: 'Otro Zapopan' })
        .expect(409);

      expect((res.body as { message: string }).message).toContain('ZA');
    });

    it.each([
      ['Z', 'una letra'],
      ['ZAB', 'tres letras'],
      ['Z1', 'con digito'],
    ])('rechaza el codigo "%s" (%s) con 400', async (codigo) => {
      await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', [cookieGeneral])
        .send({ codigo, nombre: 'Invalida' })
        .expect(400);
    });

    it('acepta un codigo en minusculas y lo guarda en mayusculas', async () => {
      // La API la van a llamar tambien scripts y, mas adelante, la app tablet.
      // Rechazar 'zb' por la capitalizacion seria pedantico: el check de la
      // base exige mayusculas, asi que se normaliza antes de validar.
      const res = await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', [cookieGeneral])
        .send({ codigo: 'zb', nombre: 'Zamora' })
        .expect(201);

      expect((res.body as SucursalRespuesta).codigo).toBe('ZB');
    });

    it('rechaza un nombre vacio con 400', async () => {
      await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', [cookieGeneral])
        .send({ codigo: 'ZC', nombre: '   ' })
        .expect(400);
    });
  });
```

- [ ] **Paso 2: Correr el e2e y verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend -- sucursales
```

Esperado: FAIL — los `POST` dan 404 salvo el de "sin sesión" (401 del guard).

- [ ] **Paso 3: Escribir el DTO**

Crea `apps/backend/src/modules/sucursales/dto/crear-sucursal.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Quita espacios sobrantes sin reventar si llega algo que no es cadena. */
const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CrearSucursalDto {
  // Se normaliza ANTES de validar (@Transform corre primero) para que 'tj'
  // pase y se guarde como 'TJ'. La base solo acepta mayusculas
  // (sucursal_codigo_formato); esto evita un 400 por algo que no le importa a
  // nadie y que ademas terminaria en un 500 si llegara hasta el insert.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'El código de sucursal debe ser exactamente 2 letras.',
  })
  codigo!: string;

  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  // La columna es `text` (sin limite). El tope vive aqui porque un campo de
  // texto sin cota es una invitacion a meter un documento entero en un
  // catalogo que se pinta en una tabla.
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;
}
```

- [ ] **Paso 4: Agregar `crear` al repositorio**

Añade este método a `SucursalesRepository`:

```ts
  async crear(codigo: string, nombre: string): Promise<Sucursal> {
    return this.db
      .insertInto('sucursal')
      .values({ codigo, nombre })
      .returning(CAMPOS)
      .executeTakeFirstOrThrow();
  }
```

- [ ] **Paso 5: Agregar `crear` al servicio**

En `sucursales.service.ts`, añade el import y la función auxiliar arriba de la clase:

```ts
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CrearSucursalDto } from './dto/crear-sucursal.dto';
```

```ts
/**
 * `23505` es unique_violation en Postgres. Se mira el error DESPUES del insert
 * en vez de consultar antes si el codigo existe: una consulta previa deja una
 * ventana entre el SELECT y el INSERT en la que otra peticion puede meter el
 * mismo codigo, y el unique de la base es quien de verdad decide.
 */
function esCodigoDuplicado(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === '23505'
  );
}
```

Y este método a la clase:

```ts
  /**
   * Crear una sucursal no ocurre "dentro de" ninguna sucursal, asi que no hay
   * alcance que aplicar: hoy cualquier usuario con sesion puede hacerlo. Quien
   * deberia poder es cosa del permiso `sucursal.gestionar` en T-08 (ver el
   * spec, seccion Endpoints).
   */
  async crear(dto: CrearSucursalDto): Promise<Sucursal> {
    try {
      return await this.repo.crear(dto.codigo, dto.nombre);
    } catch (error) {
      if (esCodigoDuplicado(error)) {
        throw new ConflictException(
          `Ya existe una sucursal con el código ${dto.codigo}.`,
        );
      }
      throw error;
    }
  }
```

- [ ] **Paso 6: Agregar el endpoint al controlador**

En `sucursales.controller.ts`, añade `Body` y `Post` a los imports de `@nestjs/common`, importa el
DTO, y agrega:

```ts
  @Post()
  async crear(@Body() dto: CrearSucursalDto): Promise<Sucursal> {
    return this.sucursales.crear(dto);
  }
```

- [ ] **Paso 7: Correr el e2e y verificar que pasa**

```bash
npm run test:e2e --workspace=apps/backend -- sucursales
```

Esperado: PASS, 14 pruebas (6 de la Tarea 3 + 8 nuevas contando los tres casos de `it.each`).

- [ ] **Paso 8: Commit**

```bash
git add apps/backend/src/modules/sucursales apps/backend/test/sucursales.e2e-spec.ts
git commit -m "T-09 · POST /sucursales

El codigo duplicado sale como 409 con el codigo en el mensaje, para que
el portal lo pueda poner junto al campo. Se detecta el 23505 en vez de
consultar antes: consultar primero deja una carrera."
```

---

## Tarea 5: `PATCH /sucursales/:id`

**Archivos:**
- Crear: `apps/backend/src/modules/sucursales/dto/editar-sucursal.dto.ts`
- Modificar: `apps/backend/src/modules/sucursales/sucursales.repository.ts`
- Modificar: `apps/backend/src/modules/sucursales/sucursales.service.ts`
- Modificar: `apps/backend/src/modules/sucursales/sucursales.controller.ts`
- Test: `apps/backend/test/sucursales.e2e-spec.ts` *(agregar un `describe`)*

**Interfaces:**
- Consume: todo lo de las Tareas 3 y 4
- Produce: `PATCH /sucursales/:id` con cuerpo `{ nombre?, activa? }` → `Sucursal`

- [ ] **Paso 1: Escribir los e2e que fallan**

Agrega este `describe` al final de `describe('Sucursales (e2e)')`:

```ts
  describe('PATCH /sucursales/:id', () => {
    let idZacatecas: string;

    // La sucursal de trabajo se crea UNA vez aqui y no dentro del primer test.
    // Si cada test la buscara por codigo, quedarian encadenados en un orden
    // implicito: un fallo en el primero haria fallar a los demas por no
    // encontrarla, y el reporte senalaria al test equivocado.
    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', [cookieGeneral])
        .send({ codigo: 'ZC', nombre: 'Zacatecas' })
        .expect(201);
      idZacatecas = (res.body as SucursalRespuesta).id;
    });

    it('sin sesion responde 401', async () => {
      await request(app.getHttpServer())
        .patch(`/sucursales/${idZacatecas}`)
        .send({ nombre: 'Otro' })
        .expect(401);
    });

    it('cambia el nombre', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/sucursales/${idZacatecas}`)
        .set('Cookie', [cookieGeneral])
        .send({ nombre: 'Zacatecas Centro' })
        .expect(200);

      expect((res.body as SucursalRespuesta).nombre).toBe('Zacatecas Centro');
    });

    it('desactiva la sucursal sin sacarla del listado', async () => {
      await request(app.getHttpServer())
        .patch(`/sucursales/${idZacatecas}`)
        .set('Cookie', [cookieGeneral])
        .send({ activa: false })
        .expect(200);

      // Desactivar NO es borrar (D6): la sucursal tiene que seguir visible en
      // el catalogo para poder reactivarla, y sus ventas y folios historicos
      // siguen apuntando a ella.
      const listado = await request(app.getHttpServer())
        .get('/sucursales')
        .set('Cookie', [cookieGeneral])
        .expect(200);

      const zc = (listado.body as SucursalRespuesta[]).find(
        (s) => s.codigo === 'ZC',
      );
      expect(zc).toBeDefined();
      expect(zc?.activa).toBe(false);
    });

    it('ignora un intento de cambiar el codigo', async () => {
      // El codigo abre los folios historicos (D5). No esta en EditarSucursalDto,
      // asi que el ValidationPipe (whitelist: true) lo descarta antes de llegar
      // al servicio. Si alguien lo agregara al DTO por descuido, este test cae.
      const res = await request(app.getHttpServer())
        .patch(`/sucursales/${idZacatecas}`)
        .set('Cookie', [cookieGeneral])
        .send({ codigo: 'ZZ', nombre: 'Zacatecas Centro' })
        .expect(200);

      expect((res.body as SucursalRespuesta).codigo).toBe('ZC');
    });

    it('un id inexistente responde 404', async () => {
      await request(app.getHttpServer())
        .patch('/sucursales/00000000-0000-4000-8000-000000000000')
        .set('Cookie', [cookieGeneral])
        .send({ nombre: 'Fantasma' })
        .expect(404);
    });

    it('un id que no es uuid responde 400', async () => {
      // Sin ParseUUIDPipe esto llegaria a Postgres y reventaria como 500
      // (22P02, invalid input syntax for type uuid).
      await request(app.getHttpServer())
        .patch('/sucursales/no-soy-un-uuid')
        .set('Cookie', [cookieGeneral])
        .send({ nombre: 'Fantasma' })
        .expect(400);
    });

    it('un cuerpo sin ningun cambio responde 400', async () => {
      await request(app.getHttpServer())
        .patch(`/sucursales/${idZacatecas}`)
        .set('Cookie', [cookieGeneral])
        .send({})
        .expect(400);
    });

    it('un usuario de Tijuana no puede editar Mexicali', async () => {
      // La otra mitad de D3: el alcance no es solo de lectura.
      await request(app.getHttpServer())
        .patch(`/sucursales/${idMexicali}`)
        .set('Cookie', [cookieTijuana])
        .send({ nombre: 'Mexicali Secuestrada' })
        .expect(403);
    });
  });
```

- [ ] **Paso 2: Correr el e2e y verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend -- sucursales
```

Esperado: FAIL — los `PATCH` dan 404 de ruta inexistente.

- [ ] **Paso 3: Escribir el DTO**

Crea `apps/backend/src/modules/sucursales/dto/editar-sucursal.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * `codigo` NO esta aqui, y esa ausencia es la que aplica D5: con
 * `whitelist: true` en el ValidationPipe global, cualquier `codigo` que venga
 * en el cuerpo se descarta antes de llegar al servicio. No hace falta un
 * chequeo explicito — hace falta NO agregar el campo.
 */
export class EditarSucursalDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
```

- [ ] **Paso 4: Agregar `buscarPorId` y `actualizar` al repositorio**

```ts
  async buscarPorId(id: string): Promise<Sucursal | undefined> {
    return this.db
      .selectFrom('sucursal')
      .select(CAMPOS)
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /**
   * `cambios` nunca llega vacio: el servicio lo comprueba antes. Un `.set({})`
   * genera SQL invalido, asi que el chequeo no es cortesia, es necesario.
   */
  async actualizar(
    id: string,
    cambios: { nombre?: string; activa?: boolean },
  ): Promise<Sucursal> {
    return this.db
      .updateTable('sucursal')
      .set(cambios)
      .where('id', '=', id)
      .returning(CAMPOS)
      .executeTakeFirstOrThrow();
  }
```

- [ ] **Paso 5: Agregar `editar` al servicio**

Añade `BadRequestException`, `ForbiddenException` y `NotFoundException` a los imports de
`@nestjs/common`, más `import type { EditarSucursalDto } from './dto/editar-sucursal.dto';`, y este
método:

```ts
  async editar(
    usuarioId: string,
    id: string,
    dto: EditarSucursalDto,
  ): Promise<Sucursal> {
    // El 400 va ANTES de tocar la base: un PATCH sin cambios no es un fallo
    // del servidor ni justifica una consulta, es un cuerpo mal armado.
    if (dto.nombre === undefined && dto.activa === undefined) {
      throw new BadRequestException('No hay nada que actualizar.');
    }

    const sucursal = await this.repo.buscarPorId(id);
    if (!sucursal) {
      throw new NotFoundException('No existe esa sucursal.');
    }

    // El alcance manda igual en escritura que en lectura (D3). Se compara
    // contra la sucursal YA leida y no contra el query param: aqui el objeto
    // que se va a modificar es el hecho, no lo que el cliente diga.
    const alcance = await this.alcanceDe(usuarioId, null);
    if (alcance.tipo === 'una' && alcance.codigo !== sucursal.codigo) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }

    const cambios: { nombre?: string; activa?: boolean } = {};
    if (dto.nombre !== undefined) {
      cambios.nombre = dto.nombre;
    }
    if (dto.activa !== undefined) {
      cambios.activa = dto.activa;
    }

    return this.repo.actualizar(id, cambios);
  }
```

- [ ] **Paso 6: Agregar el endpoint al controlador**

Añade `Param`, `ParseUUIDPipe` y `Patch` a los imports de `@nestjs/common`, importa
`EditarSucursalDto`, y agrega:

```ts
  @Patch(':id')
  async editar(
    @UsuarioActual() usuarioId: string,
    // ParseUUIDPipe convierte un id mal formado en 400. Sin el, la cadena
    // llegaria a Postgres y saldria como 500.
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarSucursalDto,
  ): Promise<Sucursal> {
    return this.sucursales.editar(usuarioId, id, dto);
  }
```

- [ ] **Paso 7: Correr toda la suite del backend**

```bash
npm run test:e2e --workspace=apps/backend
npm test --workspace=apps/backend
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
```

Esperado: e2e en verde (22 de sucursales + las 13 previas de auth/app/configuración), unitarias en
verde (16 previas + 11 de la Tarea 2), lint y build sin errores.

- [ ] **Paso 8: Commit**

```bash
git add apps/backend/src/modules/sucursales apps/backend/test/sucursales.e2e-spec.ts
git commit -m "T-09 · PATCH /sucursales/:id

El codigo no se puede editar: no esta en el DTO y whitelist lo descarta
(D5). Desactivar no borra (D6). El alcance aplica igual en escritura."
```

---

## Tarea 6: Pantalla de Sucursales en el portal

**Archivos:**
- Modificar: `apps/portal/src/lib/api.ts`
- Crear: `apps/portal/src/lib/sucursales.ts`
- Crear: `apps/portal/src/app/(portal)/catalogo/sucursales/page.tsx`
- Crear: `apps/portal/src/components/sucursales/pantalla-sucursales.tsx`
- Crear: `apps/portal/src/components/sucursales/formulario-sucursal.tsx`
- Modificar: `apps/portal/src/components/layout/nav-config.ts`

**Interfaces:**
- Consume: `GET`/`POST`/`PATCH /sucursales` (Tareas 3–5); `apiFetch`, `ErrorApi` de `lib/api.ts`
- Produce: `interface Sucursal`, `listarSucursales`, `crearSucursal`, `editarSucursal` en
  `lib/sucursales.ts` — el selector de la Tarea 7 los usa

El portal no tiene pruebas automatizadas (decisión del spec). La verificación es manual, con
`npm run portal` y el backend arriba.

- [ ] **Paso 1: Hacer que `ErrorApi` cargue el mensaje de la API**

En `apps/portal/src/lib/api.ts`, reemplaza la clase `ErrorApi` por:

```ts
export class ErrorApi extends Error {
  constructor(
    message: string,
    readonly status: number,
    /**
     * El mensaje que mando la API, cuando trae uno legible. Existe porque hay
     * errores que SOLO el servidor sabe explicar — "ya existe una sucursal con
     * el codigo TJ" — y degradarlos a un texto generico obligaria al usuario a
     * adivinar que campo corregir.
     */
    readonly mensajeApi?: string,
  ) {
    super(message);
  }
}
```

Agrega esta función justo antes de `apiFetch`:

```ts
/**
 * Saca el mensaje de error del cuerpo. Nest manda `message` como cadena (las
 * excepciones normales) o como arreglo de cadenas (el ValidationPipe, una por
 * campo que fallo). Nunca lanza: si el cuerpo no es JSON, quien llama todavia
 * tiene el status, y un fallo leyendo el error no debe tapar el error.
 */
async function leerMensajeDeError(res: Response): Promise<string | undefined> {
  try {
    const cuerpo: unknown = await res.json();
    if (typeof cuerpo === "object" && cuerpo !== null && "message" in cuerpo) {
      const mensaje = (cuerpo as { message: unknown }).message;
      if (typeof mensaje === "string") {
        return mensaje;
      }
      if (Array.isArray(mensaje)) {
        return mensaje.filter((m): m is string => typeof m === "string").join(" ");
      }
    }
  } catch {
    // Cuerpo vacio o no-JSON: no hay nada que mostrar y no es un fallo.
  }
  return undefined;
}
```

Y cambia el bloque final de `apiFetch`:

```ts
  if (!res.ok) {
    throw new ErrorApi(
      `La peticion a ${ruta} fallo`,
      res.status,
      await leerMensajeDeError(res),
    );
  }
```

- [ ] **Paso 2: Escribir el cliente de la API**

Crea `apps/portal/src/lib/sucursales.ts`:

```ts
import { apiFetch } from "./api";

export interface Sucursal {
  id: string;
  codigo: string;
  nombre: string;
  activa: boolean;
}

/**
 * @param sucursal codigo a filtrar, "todas", o null/undefined para no pedir
 *   nada. Da igual lo que se mande: el backend acota el resultado a lo que el
 *   usuario puede ver.
 */
export function listarSucursales(sucursal?: string | null): Promise<Sucursal[]> {
  const query = sucursal ? `?sucursal=${encodeURIComponent(sucursal)}` : "";
  return apiFetch<Sucursal[]>(`/sucursales${query}`);
}

export function crearSucursal(datos: {
  codigo: string;
  nombre: string;
}): Promise<Sucursal> {
  return apiFetch<Sucursal>("/sucursales", {
    method: "POST",
    body: JSON.stringify(datos),
  });
}

export function editarSucursal(
  id: string,
  cambios: { nombre?: string; activa?: boolean },
): Promise<Sucursal> {
  return apiFetch<Sucursal>(`/sucursales/${id}`, {
    method: "PATCH",
    body: JSON.stringify(cambios),
  });
}
```

- [ ] **Paso 3: Escribir el formulario**

Crea `apps/portal/src/components/sucursales/formulario-sucursal.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ErrorApi } from "@/lib/api";
import { crearSucursal, editarSucursal, type Sucursal } from "@/lib/sucursales";

interface Props {
  /** La sucursal a editar, o null para dar de alta una nueva. */
  sucursal: Sucursal | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

export function FormularioSucursal({ sucursal, alGuardar, alCancelar }: Props) {
  const [codigo, setCodigo] = useState(sucursal?.codigo ?? "");
  const [nombre, setNombre] = useState(sucursal?.nombre ?? "");
  const [activa, setActiva] = useState(sucursal?.activa ?? true);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const esAlta = sucursal === null;

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);

    try {
      if (sucursal) {
        await editarSucursal(sucursal.id, { nombre, activa });
      } else {
        await crearSucursal({ codigo, nombre });
      }
      alGuardar();
    } catch (err) {
      // El mensaje del servidor se muestra tal cual cuando existe: el 409 dice
      // exactamente que codigo esta repetido y el 400 dice que campo fallo.
      setError(
        err instanceof ErrorApi
          ? (err.mensajeApi ?? "No se pudo guardar la sucursal.")
          : "No se pudo conectar con el servidor. Intenta de nuevo.",
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form
      onSubmit={alEnviar}
      className="mb-6 flex flex-col gap-4 rounded-md border p-4"
    >
      <h2 className="text-sm font-semibold">
        {esAlta ? "Nueva sucursal" : `Editar ${sucursal.codigo}`}
      </h2>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="codigo" className="text-sm font-medium">
            Código
          </label>
          <input
            id="codigo"
            name="codigo"
            required
            maxLength={2}
            // Solo lectura al editar: el codigo abre los folios historicos y
            // cambiarlo los dejaria apuntando a algo que ya no existe.
            readOnly={!esAlta}
            disabled={enviando}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            className="w-24 rounded-md border px-3 py-2 text-sm uppercase read-only:bg-muted read-only:text-muted-foreground"
          />
          {!esAlta && (
            <span className="text-xs text-muted-foreground">
              El código no se puede cambiar.
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="nombre" className="text-sm font-medium">
            Nombre
          </label>
          <input
            id="nombre"
            name="nombre"
            required
            maxLength={80}
            disabled={enviando}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
      </div>

      {!esAlta && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activa}
            disabled={enviando}
            onChange={(e) => setActiva(e.target.checked)}
          />
          Activa
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

- [ ] **Paso 4: Escribir la pantalla**

Crea `apps/portal/src/components/sucursales/pantalla-sucursales.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormularioSucursal } from "./formulario-sucursal";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";

/** null = formulario cerrado · "nueva" = alta · una Sucursal = edicion. */
type Edicion = Sucursal | "nueva" | null;

export function PantallaSucursales({ sucursal }: { sucursal: string | null }) {
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Edicion>(null);

  const recargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setSucursales(await listarSucursales(sucursal));
    } catch {
      // Un 401 aqui ya lo maneja apiFetch (refresca) y AuthProvider (rebota al
      // login). Lo que queda son fallos de red o 5xx, y para esos lo unico
      // honesto es decir que no se pudo cargar.
      setError("No se pudieron cargar las sucursales.");
    } finally {
      setCargando(false);
    }
  }, [sucursal]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Sucursales</CardTitle>
        {edicion === null && (
          <Button size="sm" onClick={() => setEdicion("nueva")}>
            Nueva sucursal
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {edicion !== null && (
          <FormularioSucursal
            sucursal={edicion === "nueva" ? null : edicion}
            alGuardar={() => {
              setEdicion(null);
              void recargar();
            }}
            alCancelar={() => setEdicion(null)}
          />
        )}

        {cargando && <p className="text-muted-foreground">Cargando…</p>}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {!cargando && !error && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 font-medium">Código</th>
                <th className="py-2 font-medium">Nombre</th>
                <th className="py-2 font-medium">Estado</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {sucursales.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="py-2 font-mono">{s.codigo}</td>
                  <td className="py-2">{s.nombre}</td>
                  <td className="py-2">
                    {s.activa ? (
                      "Activa"
                    ) : (
                      <span className="text-muted-foreground">Inactiva</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEdicion(s)}
                    >
                      Editar
                    </Button>
                  </td>
                </tr>
              ))}
              {sucursales.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-muted-foreground">
                    No hay sucursales que mostrar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Paso 5: Escribir la página y agregarla al menú**

Crea `apps/portal/src/app/(portal)/catalogo/sucursales/page.tsx`:

```tsx
import { PantallaSucursales } from "@/components/sucursales/pantalla-sucursales";

// En Next 15 `searchParams` es una promesa. La pagina es un server component
// que solo lee el filtro y lo baja; toda la interaccion vive en el cliente.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaSucursales sucursal={sucursal ?? null} />;
}
```

En `apps/portal/src/components/layout/nav-config.ts`, agrega Sucursales como **primer** ítem de
Catálogo:

```ts
      { label: "Sucursales", href: "/catalogo/sucursales" },
```

- [ ] **Paso 6: Verificar a mano**

En una terminal:

```bash
npm run backend
```

En otra:

```bash
npm run portal
```

Si aún no tienes usuarios de prueba, créalos (uno General y uno de Tijuana):

```bash
npm run crear-usuario --workspace=apps/backend
```

Entra a `http://localhost:3001/catalogo/sucursales` y comprueba:

1. Como usuario **General**: se ven Tijuana y Mexicali.
2. "Nueva sucursal" → código `ZA`, nombre `Zapopan` → aparece en la tabla.
3. Repetir el alta con `ZA` → sale "Ya existe una sucursal con el código ZA." **junto al
   formulario**, no un error genérico.
4. Editar `ZA`: el campo de código está en solo lectura; cambiar el nombre funciona.
5. Desmarcar "Activa" → la fila dice Inactiva y **sigue en la tabla**.
6. Como usuario **de Tijuana**: solo se ve Tijuana.
7. Con ese mismo usuario, entrar a mano a `/catalogo/sucursales?sucursal=MX` → la pantalla dice que
   no se pudieron cargar (el backend contestó 403).

Limpia lo que creaste: `ZA` se queda en la base local. Si estorba, `npm run supabase -- db reset`.

- [ ] **Paso 7: Lint y build del portal**

```bash
npm run lint --workspace=apps/portal
npm run build --workspace=apps/portal
```

Esperado: sin errores.

- [ ] **Paso 8: Commit**

```bash
git add apps/portal/src/lib apps/portal/src/app apps/portal/src/components
git commit -m "T-09 · Pantalla de Sucursales en el portal

Primera pantalla del portal con datos reales. Sigue el patron ya
establecido en formulario-login.tsx (HTML + Tailwind, sin dependencias
nuevas). ErrorApi ahora carga el mensaje del servidor para poder poner
el 409 junto al campo del codigo."
```

---

## Tarea 7: Selector "Por sucursal" y su preservación al navegar

**Archivos:**
- Crear: `apps/portal/src/components/layout/selector-sucursal.tsx`
- Modificar: `apps/portal/src/components/layout/barra-usuario.tsx`
- Modificar: `apps/portal/src/components/layout/sidebar-nav.tsx`

**Interfaces:**
- Consume: `listarSucursales`, `Sucursal` de `lib/sucursales.ts` (Tarea 6)
- Produce: el query param `?sucursal=<código>` que consume `page.tsx` (Tarea 6) y consumirán
  T-10, T-11, T-12, T-13 y T-62

- [ ] **Paso 1: Escribir el selector**

Crea `apps/portal/src/components/layout/selector-sucursal.tsx`:

```tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";

/** Mismo valor reservado que usa el backend en alcance-sucursal.ts. */
const TODAS = "todas";

export function SelectorSucursal() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);

  useEffect(() => {
    // Se piden SIN filtro a proposito: el selector necesita saber todo lo que
    // el usuario puede elegir, no lo que esta viendo ahora mismo. El backend
    // ya lo acota a lo que le toca.
    listarSucursales()
      .then(setSucursales)
      .catch(() => setSucursales([]));
  }, []);

  const activas = sucursales.filter((s) => s.activa);
  const seleccion = params.get("sucursal") ?? TODAS;

  // Un usuario atado a una sucursal recibe exactamente una, asi que no hay
  // nada que elegir y se muestra como texto. La distincion entre "General" y
  // "atado" no necesita logica propia aqui: sale de lo que devuelve la API.
  if (activas.length <= 1) {
    return (
      <span className="text-muted-foreground">{activas[0]?.nombre ?? "—"}</span>
    );
  }

  function cambiar(valor: string) {
    const nuevos = new URLSearchParams(params.toString());
    if (valor === TODAS) {
      // "todas" es el default, asi que se quita el param en vez de escribirlo:
      // deja la URL limpia y hace que ?sucursal= no aparezca nunca vacio.
      nuevos.delete("sucursal");
    } else {
      nuevos.set("sucursal", valor);
    }
    const query = nuevos.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <select
      aria-label="Filtrar por sucursal"
      value={seleccion}
      onChange={(e) => cambiar(e.target.value)}
      className="rounded-md border px-2 py-1 text-sm"
    >
      <option value={TODAS}>Todas las sucursales</option>
      {activas.map((s) => (
        <option key={s.id} value={s.codigo}>
          {s.nombre}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Paso 2: Montar el selector en la barra**

En `apps/portal/src/components/layout/barra-usuario.tsx`, agrega el import y el componente. El
`<Suspense>` no es opcional: `useSearchParams` obliga a Next a tener un límite de suspensión, y sin
él `next build` falla al prerenderizar.

```tsx
import { Suspense } from "react";
import { SelectorSucursal } from "./selector-sucursal";
```

Dentro del `<div>` que ya existe, antes de `<span className="font-medium">`:

```tsx
      <Suspense fallback={<span className="text-muted-foreground">…</span>}>
        <SelectorSucursal />
      </Suspense>
      <span className="mx-1 text-muted-foreground">|</span>
```

- [ ] **Paso 3: Preservar el filtro al navegar**

En `apps/portal/src/components/layout/sidebar-nav.tsx`, agrega `useSearchParams` al import de
`next/navigation` y, dentro del componente, antes del `return`:

```tsx
  const params = useSearchParams();
  const sucursal = params.get("sucursal");
```

Y cambia el `href` del `<Link>`:

```tsx
                <Link
                  href={
                    sucursal
                      ? `${item.href}?sucursal=${encodeURIComponent(sucursal)}`
                      : item.href
                  }
```

La comparación de la clase activa sigue siendo `pathname === item.href` y **no hay que tocarla**:
`pathname` no incluye el query string, así que el resaltado sigue funcionando con el filtro puesto.

Envuelve `<SidebarNav />` en `<Suspense>` dentro de `apps/portal/src/app/(portal)/layout.tsx`, por
la misma razón que en el paso 2:

```tsx
          <Suspense fallback={null}>
            <SidebarNav />
          </Suspense>
```

añadiendo `import { Suspense } from "react";` arriba.

- [ ] **Paso 4: Verificar a mano**

Con el backend y el portal arriba:

1. Como **General**: el selector muestra "Todas las sucursales", Tijuana y Mexicali.
2. Elegir Mexicali → la URL pasa a `?sucursal=MX` y la tabla muestra solo Mexicali.
3. Con el filtro puesto, navegar a Clientes desde el menú → la URL conserva `?sucursal=MX`.
4. Volver a "Todas las sucursales" → el param **desaparece** de la URL.
5. Recargar con `?sucursal=MX` → sigue filtrado.
6. Copiar la URL con `?sucursal=MX` y abrirla en otra pestaña → misma vista.
7. Como usuario **de Tijuana**: en vez del desplegable aparece el texto "Tijuana".

- [ ] **Paso 5: Lint y build**

```bash
npm run lint --workspace=apps/portal
npm run build --workspace=apps/portal
```

Esperado: sin errores. Si el build se queja de `useSearchParams` y un límite de suspensión que
falta, revisa que los dos `<Suspense>` de los pasos 2 y 3 estén puestos.

- [ ] **Paso 6: Commit**

```bash
git add apps/portal/src/components/layout apps/portal/src/app/\(portal\)/layout.tsx
git commit -m "T-09 · Selector Por sucursal en la URL

El filtro vive en ?sucursal= (D1): la vista queda enlazable y sobrevive
a recargas. El sidebar lo arrastra a los 24 destinos, si no se perderia
al cambiar de seccion."
```

---

## Tarea 8: Documentación y Pull Request

**Archivos:**
- Modificar: `CLAUDE.md`
- Modificar: `../jawa-obsidian-memory/10-Dominio/Reglas/Sucursales.md`
- Modificar: `../jawa-obsidian-memory/20-Arquitectura/Portal Web.md`
- Modificar: `../jawa-obsidian-memory/00-Inicio/Estado del proyecto.md`

**Interfaces:**
- Consume: todo lo construido en las Tareas 1–7
- Produce: nada de código

El vault es un repo git **separado** (`../jawa-obsidian-memory`). Sus cambios se commitean allá,
no aquí. Lee `../jawa-obsidian-memory/AGENTS.md` antes de tocarlo, y actualiza el campo
`actualizado:` del frontmatter de cada nota que modifiques.

- [ ] **Paso 1: Verificación completa antes de reclamar nada**

```bash
npm run supabase -- test db
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm run lint --workspace=apps/portal
npm run build --workspace=apps/portal
```

Los siete tienen que pasar. Si alguno falla, **no sigas** — arréglalo primero.

- [ ] **Paso 2: Anotar la excepción del módulo en `CLAUDE.md`**

En la sección "Estructura del repo", debajo de la descripción de `apps/backend`, agrega:

```
│   │                Excepción: `modules/sucursales/` no corresponde a un slug del vault —
│   │                Sucursal es transversal a los 12 módulos de dominio (T-09).
```

- [ ] **Paso 3: Actualizar el vault**

En `10-Dominio/Reglas/Sucursales.md`, agrega tras el bloque de definición:

```markdown
> [!success] Filtro implementado (T-09, 2026-08-06)
> El selector "Por sucursal" ya existe en el portal. Su estado vive en el query param
> `?sucursal=<código>` de la URL, y el **servidor** decide el alcance real a partir de la sucursal
> del usuario (`sucursal_id` nulo = General). Pedir una sucursal ajena responde 403. Las pantallas
> que todavía son placeholder consumirán el mismo param cuando tengan datos.
```

En `20-Arquitectura/Portal Web.md`, dentro de la sección Catálogo, agrega:

```markdown
- **Sucursales** — alta/edición del catálogo dinámico (código de 2 letras inmutable + nombre) y
  activar/desactivar. Implementado en T-09. Ver [[Sucursal]], [[Sucursales]].
```

En `00-Inicio/Estado del proyecto.md`:

1. En la tabla de issues, saca T-09 de la fila agrupada de catálogos y ponle la suya:

```markdown
| T-09 | Catálogo de Sucursales + filtro global "Por sucursal" | ✅ Hecho (2026-08-06, Roberto) |
```

2. Agrega este bloque después del de T-06:

```markdown
**T-09 — detalle de lo hecho (2026-08-06, Roberto):**
- **Migración 9:** `check (codigo ~ '^[A-Z]{2}$')` sobre `sucursal`. Va en la base y no solo en el
  DTO porque las semillas, `crear-usuario` y cualquier carga futura entran por debajo de la API, y
  el código abre el folio de cada operación ([[ADR-0001 Formato de folios]]) — un folio ya emitido
  no se puede corregir hacia atrás. +5 pruebas pgTAP → **44 en total**.
- **Módulo `sucursales`** en el backend, con `GET`/`POST`/`PATCH`. Es el **primer módulo que no
  corresponde a un slug de dominio del vault**: [[Sucursal]] atraviesa los 12 módulos en vez de
  pertenecer a uno. Anotado en el `CLAUDE.md` del repo.
- **Filtro "Por sucursal" en la URL** (`?sucursal=TJ` / ausente = todas). Se eligió la URL sobre una
  cookie para que la vista sea enlazable — "mándame este reporte" es un caso real en este portal. El
  sidebar arrastra el param a los 24 destinos.
- **El cliente propone, el servidor dispone:** la sucursal efectiva la decide `resolverAlcance()`, una
  función pura que compara lo pedido contra la sucursal del usuario. Pedir una sucursal ajena
  responde **403**, en lectura y en escritura; pedir "todas" desde un usuario atado devuelve la suya
  (no nombra una sucursal ajena, así que no es escalada). La reutilizan T-10, T-11, T-12, T-13 y T-62.
- **Perfil y sucursal son ejes independientes:** el alcance sale de `usuario.sucursal_id` (nulo =
  General), no del perfil. Un "Administrador General" atado a Tijuana puede todo, pero solo en
  Tijuana. Se descartó cablear "el perfil X siempre ve todo" — el cliente no lo pidió y cerraría la
  puerta a un administrador por sucursal.
- **El código de sucursal es inmutable** tras el alta y **la baja es desactivar, no borrar**: hay
  ventas y folios colgando de ambas cosas.
- **Portal:** pantalla `/catalogo/sucursales`, la primera con datos reales. Sin dependencias nuevas —
  sigue el patrón de `formulario-login.tsx` (HTML + Tailwind, solo `Button`/`Card` de shadcn).
- **Pruebas:** 44 pgTAP + 27 unitarias + 35 e2e. **El portal sigue sin pruebas automatizadas** (su CI
  es lint + build); montarle infraestructura de pruebas merece su propio ticket y no se metió aquí.
- **Esto desbloquea** T-62 (Vendedores) y T-12 (Clientes), que dependían de T-09.
```

3. En "Próximos pasos sugeridos", quita T-09 de la lista de catálogos desbloqueados (punto 2) y deja
   los que siguen pendientes: T-10, T-11, T-12, T-13, T-62.

Commitea el vault en su propio repo:

```bash
git -C ../jawa-obsidian-memory add -A
git -C ../jawa-obsidian-memory commit -m "T-09 hecho: catalogo de sucursales y filtro por sucursal"
```

- [ ] **Paso 4: Agregar `sucursal.gestionar` a los criterios de T-08**

```bash
gh issue view 8 --repo robertopeiro12/proyecto-sinmex
```

Edita el issue para añadir a los criterios de aceptación:

```
- [ ] Permiso `sucursal.gestionar` (grupo General): administrar el catálogo de sucursales.
      T-09 dejó esos endpoints solo tras autenticación, a la espera de este permiso.
```

- [ ] **Paso 5: Commit y Pull Request**

```bash
git add CLAUDE.md
git commit -m "T-09 · Documentar la excepcion del modulo sucursales"
git push -u origin feature/t-09-sucursales
gh pr create --base main --title "T-09 · Catálogo de Sucursales + filtro global por sucursal" --body "$(cat <<'EOF'
Cierra #9.

## Qué trae

- **Base:** check de formato del código de sucursal (2 letras mayúsculas) — abre los folios de operación, así que se defiende en la base y no solo en el DTO.
- **Backend:** módulo `sucursales` con `GET`/`POST`/`PATCH`. El alcance por usuario vive en una función pura (`resolverAlcance`) que reutilizarán T-10, T-11, T-12, T-13 y T-62.
- **Portal:** pantalla `/catalogo/sucursales` (primera con datos reales) y selector "Por sucursal" cuyo estado vive en la URL.

## Decisiones

El diseño completo está en `docs/superpowers/specs/2026-08-06-t09-sucursales-design.md`. Las que más conviene revisar:

- El query param **propone**, el servidor **dispone**: pedir una sucursal ajena da 403, no datos.
- El **código no se puede editar** tras el alta: está embebido en folios históricos que no se pueden corregir hacia atrás.
- **Dar de baja = desactivar**, nunca borrar: hay ventas y folios colgando.
- Perfil y sucursal son **ejes independientes** — el CEO ve todo por tener sucursal General, no por su perfil.

## Fuera de alcance

- Permisos finos (T-08). Hoy los endpoints solo exigen sesión; se agregó `sucursal.gestionar` a los criterios de ese ticket.
- Cablear el filtro a pantallas que aún son placeholders.
- Pruebas automatizadas del portal — **no tiene ninguna** todavía, y montar esa infraestructura merece su propio ticket. La pantalla se verificó a mano.

## Pruebas

44 pgTAP · 27 unitarias · 35 e2e, todas en verde.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Paso 6: Esperar el CI en verde**

```bash
gh pr checks --watch
```

Backend CI y Portal CI deben pasar. Solo entonces mergea.

---

## Notas para quien ejecute

**El orden importa.** Las Tareas 3, 4 y 5 comparten archivos y cada una construye sobre la
anterior; no las paralelices. La Tarea 7 usa `lib/sucursales.ts`, que crea la Tarea 6.

**Cuando algo falle, no adivines.** Este repo tiene una suite grande y honesta; si una prueba pasa a
rojo, es información. Usa `superpowers:systematic-debugging` antes de tocar nada.

**Las cuentas de pruebas.** Los totales que aparecen en los pasos de verificación (44 pgTAP, 27
unitarias, 35 e2e) salen de sumar lo existente más lo nuevo. Si no cuadran, algo se dejó a medias —
averígualo antes de seguir, no ajustes el número.

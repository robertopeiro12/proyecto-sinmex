# T-13 · Gestión de Usuarios — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un administrador pueda crear/editar usuarios del portal web (login, contraseña, nombre, perfil, sucursal o "General") y personalizar sus permisos por excepción sobre los del perfil, desde una pantalla nueva en `/catalogo/usuarios`.

**Architecture:** Backend NestJS en `modules/auth/` (junto a `perfiles.*`/`permisos.*`, mismo criterio que D1 de T-08b): `usuarios.{controller,service,repository}.ts` nuevos, reutilizando `PerfilesService.obtenerMatriz()`, `PermisosRepository.permisosDe()`, `PasswordService` y `resolverAlcance()` sin duplicarlos. Los permisos por excepción se calculan con una función pura (`calcularExcepciones`, inversa de `combinarPermisos`) a partir del **estado final marcado**, no de una lista de operaciones. Portal: pantalla propia (no `PantallaCatalogo`, mismo criterio que T-12/T-18) con un formulario por secciones y una matriz de checkboxes con tooltip nativo por permiso.

**Tech Stack:** NestJS · Kysely · Postgres (Supabase) · pgTAP · Jest (backend) · Next.js 15 App Router · React 19 · Tailwind v4 · shadcn/ui · Vitest + Testing Library (portal)

**Spec:** `docs/superpowers/specs/2026-09-03-t13-gestion-usuarios-design.md` — las decisiones se citan como D1…D10.

## Global Constraints

- **Rama:** `feature/t-13-gestion-usuarios`, base `main`, sin pila. El spec ya está commiteado en `main`.
- **Idioma del código:** identificadores, comentarios y mensajes de error **en español**, **sin acentos en los identificadores** (sí en los mensajes de cara al usuario). Los comentarios explican *por qué*, no *qué*.
- **Todo comando se corre desde la raíz del repo** con `--workspace=`, nunca entrando a `apps/*`.
- **`npm test`, `npm run test:e2e` y `supabase test db` exigen el stack local arriba.** En esta máquina el daemon de Docker lo da **Colima** (`colima start`), no Docker Desktop.
- **Nunca apuntar a `sinmex dev` durante la implementación.** `.env.test` va al Postgres local.
- **La baja siempre es lógica**, nunca `delete` físico.
- **`deleted_at` jamás se expone en una respuesta de la API.**
- **La respuesta de la API va en camelCase.**
- **Los permisos viajan por CLAVE** (`'cliente.gestionar'`, no un uuid) en `permisosMarcados` — `combinarPermisos`/`calcularExcepciones` (`permisos.ts`) ya operan sobre claves, y el catálogo es estático (ligado a `@RequierePermiso` en código), así que la clave es un identificador tan estable como el id.
- **Conteos de partida: NO están escritos en este plan a propósito** (T-10 hardcodeó cifras y salieron mal). Antes de empezar, corre las suites y **anota tú los números reales**; cada paso de verificación compara contra tu propia línea base.

---

### Task 0: Rama y línea base

**Files:** ninguno (solo verificación).

**Interfaces:**
- Consumes: nada.
- Produces: la rama `feature/t-13-gestion-usuarios` y los conteos de partida que usarán todas las tareas siguientes.

- [ ] **Step 1: Crear la rama desde `main` limpio**

```bash
git status --short
git checkout main && git pull
git checkout -b feature/t-13-gestion-usuarios
```

Esperado: `git status --short` vacío antes de cambiar de rama. Si hay algo, **detente** y resuélvelo (commit o stash) antes de seguir.

- [ ] **Step 2: Levantar el stack local**

```bash
colima start
npm run supabase -- start
```

- [ ] **Step 3: Anotar la línea base de las cuatro suites**

```bash
npm run supabase -- test db
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm test --workspace=apps/portal
```

Anota los cuatro números. **Todas las tareas siguientes comparan contra estos números**, no contra cifras escritas en este plan. Las cuatro suites tienen que estar en **verde** antes de tocar nada.

- [ ] **Step 4: Confirmar que no hay usuarios de prueba sueltos con el prefijo reservado**

```bash
psql "$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" -c \
  "select count(*) as usuarios_zz from usuario where login like 'zz-%' or login like 'e2e-usr-%';"
```

Esperado: **0**. Si no, detente: hay datos de una corrida manual anterior que conviene limpiar antes de agregar el índice de la Task 7.

---

### Task 1: Migración — permiso `usuario.gestionar` (D6 del spec)

**Files:**
- Create: `supabase/migrations/20260903120000_permiso_usuario_gestionar.sql`
- Create: `supabase/tests/99_permiso_usuario_test.sql`

**Interfaces:**
- Consumes: nada.
- Produces: la fila `permiso.clave = 'usuario.gestionar'`, de la que depende `@RequierePermiso('usuario.gestionar')` en `UsuariosController` (Task 3).

- [ ] **Step 1: Escribir la prueba pgTAP que falla**

Crea `supabase/tests/99_permiso_usuario_test.sql` (mismo patrón que `97_permiso_perfil_test.sql`, T-08b — el numerado de dos dígitos ya está agotado en 99, así que este archivo comparte prefijo con `99_cliente_precio_unicidad_test.sql`; el orden entre archivos del mismo número no importa, cada uno corre en su propia transacción):

```sql
begin;
select plan(1);

select is(
  (select grupo from permiso where clave = 'usuario.gestionar' and deleted_at is null),
  'General',
  'usuario.gestionar existe y vive en el grupo General'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
npm run supabase -- test db
```

Esperado: `99_permiso_usuario_test.sql` **falla** (`usuario.gestionar` no existe todavía, la subconsulta devuelve `null`).

- [ ] **Step 3: Escribir la migración**

Crea `supabase/migrations/20260903120000_permiso_usuario_gestionar.sql`:

```sql
-- Permiso nuevo para T-13 (Gestion de Usuarios), mismo patron que
-- sucursal.gestionar (T-08a) y perfil.gestionar (T-08b): gatea los seis
-- endpoints de UsuariosController, LECTURA INCLUIDA (D6 del spec) -- el
-- login y las excepciones de permisos de otros usuarios son informacion
-- sensible, y ningun otro catalogo del portal consume esta lista.
insert into permiso (clave, grupo, descripcion) values
  ('usuario.gestionar', 'General', 'Crear/editar/dar de baja usuarios del portal')
on conflict (clave) do nothing;
```

- [ ] **Step 4: Aplicar la migración y correr la prueba**

```bash
npm run supabase -- migration up --local
npm run supabase -- test db
```

Esperado: la prueba nueva pasa, y el total pgTAP sube en 1 sobre tu línea base de la Task 0.

- [ ] **Step 5: Confirmar que `db:types` no hace falta**

La migración solo inserta una fila, ninguna columna nueva: `schema.d.ts` no cambia. No corras `npm run db:types`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260903120000_permiso_usuario_gestionar.sql \
        supabase/tests/99_permiso_usuario_test.sql
git commit -m "$(cat <<'EOF'
T-13 · Permiso usuario.gestionar

Gatea los seis endpoints de UsuariosController (Tasks 3-7), lectura
incluida (D6 del spec) -- mismo criterio que perfil.gestionar en T-08b.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Vvvtzc2jmGPfo71vZDAeXW
EOF
)"
```

---

### Task 2: `calcular-excepciones.ts` — función pura, inversa de `combinarPermisos` (D3 del spec)

**Files:**
- Create: `apps/backend/src/modules/auth/calcular-excepciones.ts`
- Create: `apps/backend/src/modules/auth/calcular-excepciones.spec.ts`

**Interfaces:**
- Consumes: `type Excepcion` de `./permisos` (ya existe, T-08a: `{ clave: string; habilitado: boolean }`).
- Produces: `calcularExcepciones(marcados: Set<string>, delPerfil: string[]): Excepcion[]`, consumida por `UsuariosService` (Tasks 5-6).

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `apps/backend/src/modules/auth/calcular-excepciones.spec.ts`:

```typescript
import { calcularExcepciones } from './calcular-excepciones';

describe('calcularExcepciones', () => {
  it('sin marcados y sin perfil, no hay excepciones', () => {
    expect(calcularExcepciones(new Set(), [])).toEqual([]);
  });

  it('lo que el perfil ya da y sigue marcado no genera excepcion', () => {
    const marcados = new Set(['cliente.gestionar']);
    expect(calcularExcepciones(marcados, ['cliente.gestionar'])).toEqual([]);
  });

  it('lo que el perfil NO da y sigue sin marcar no genera excepcion', () => {
    const marcados = new Set<string>();
    expect(calcularExcepciones(marcados, ['cliente.gestionar'])).toEqual([]);
  });

  it('marcado que el perfil NO da genera una excepcion habilitado=true', () => {
    const marcados = new Set(['vendedor.gestionar']);
    expect(calcularExcepciones(marcados, ['cliente.gestionar'])).toEqual([
      { clave: 'vendedor.gestionar', habilitado: true },
    ]);
  });

  it('desmarcado que el perfil SI da genera una excepcion habilitado=false', () => {
    const marcados = new Set<string>();
    expect(calcularExcepciones(marcados, ['cliente.gestionar'])).toEqual([
      { clave: 'cliente.gestionar', habilitado: false },
    ]);
  });

  it('combina varias excepciones de los dos sentidos a la vez', () => {
    const marcados = new Set(['cliente.gestionar', 'vendedor.gestionar']);
    const delPerfil = ['cliente.gestionar', 'producto.gestionar'];
    const resultado = calcularExcepciones(marcados, delPerfil);

    expect(resultado).toHaveLength(2);
    expect(resultado).toContainEqual({ clave: 'vendedor.gestionar', habilitado: true });
    expect(resultado).toContainEqual({ clave: 'producto.gestionar', habilitado: false });
  });

  it('es la inversa exacta de combinarPermisos: aplicar el resultado reproduce "marcados"', () => {
    const delPerfil = ['cliente.gestionar', 'producto.gestionar'];
    const marcados = new Set(['cliente.gestionar', 'vendedor.gestionar']);
    const excepciones = calcularExcepciones(marcados, delPerfil);

    const efectivos = new Set(delPerfil);
    for (const { clave, habilitado } of excepciones) {
      if (habilitado) efectivos.add(clave);
      else efectivos.delete(clave);
    }

    expect(efectivos).toEqual(marcados);
  });
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

```bash
npm test --workspace=apps/backend -- calcular-excepciones
```

Esperado: FAIL — `Cannot find module './calcular-excepciones'`.

- [ ] **Step 3: Escribir la implementación**

Crea `apps/backend/src/modules/auth/calcular-excepciones.ts`:

```typescript
import type { Excepcion } from './permisos';

/**
 * Inversa de `combinarPermisos` (permisos.ts): esa funcion aplica el perfil +
 * las excepciones para llegar a los permisos EFECTIVOS; esta parte de los
 * permisos efectivos que el administrador acaba de marcar en el formulario
 * (D3 del spec -- "estado final marcado", no una lista de excepciones) y
 * calcula que filas de `usuario_permiso` hacen falta para reproducirlos.
 *
 * Una clave es una excepcion cuando NO coincide con lo que el perfil ya da:
 * marcada + el perfil no la da -> habilitado: true (la excepcion la concede).
 * desmarcada + el perfil si la da -> habilitado: false (la excepcion la quita).
 * En cualquier otro caso coincide con el perfil y no aparece en el resultado
 * -- si antes existia una excepcion ahi, quien llama debe borrarla (no es
 * responsabilidad de esta funcion pura, que no conoce el estado guardado).
 */
export function calcularExcepciones(
  marcados: Set<string>,
  delPerfil: string[],
): Excepcion[] {
  const delPerfilSet = new Set(delPerfil);
  const todasLasClaves = new Set([...marcados, ...delPerfilSet]);
  const excepciones: Excepcion[] = [];

  for (const clave of todasLasClaves) {
    const marcado = marcados.has(clave);
    const enPerfil = delPerfilSet.has(clave);
    if (marcado !== enPerfil) {
      excepciones.push({ clave, habilitado: marcado });
    }
  }

  return excepciones;
}
```

- [ ] **Step 4: Correr las pruebas para verificar que pasan**

```bash
npm test --workspace=apps/backend -- calcular-excepciones
```

Esperado: PASS, 7 pruebas.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/auth/calcular-excepciones.ts \
        apps/backend/src/modules/auth/calcular-excepciones.spec.ts
git commit -m "$(cat <<'EOF'
T-13 · calcularExcepciones: funcion pura inversa de combinarPermisos

D3 del spec: el formulario manda el estado final marcado, no una lista
de excepciones. Esta funcion calcula el diff contra lo que da el
perfil elegido, sin base de datos -- mismo criterio que permisos.spec.ts.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Vvvtzc2jmGPfo71vZDAeXW
EOF
)"
```

---

### Task 3: Backend — el módulo nace: `GET /usuarios/catalogo-perfiles` (D5 del spec)

**Files:**
- Create: `apps/backend/src/modules/auth/usuarios.service.ts`
- Create: `apps/backend/src/modules/auth/usuarios.controller.ts`
- Modify: `apps/backend/src/modules/auth/auth.module.ts`
- Create: `apps/backend/test/usuarios.e2e-spec.ts`

**Interfaces:**
- Consumes: `PerfilesService.obtenerMatriz()` (T-08b, ya existe) y su tipo `MatrizPerfiles`; `RequierePermiso` de `./requiere-permiso.decorator`.
- Produces: `UsuariosController` en `/usuarios` con `@RequierePermiso('usuario.gestionar')` a nivel de CLASE (D6) — las Tasks 4-7 le agregan métodos sin tocar el decorador de clase. `UsuariosService`, que las Tasks 4-7 extienden con más métodos.

**Nota de esta tarea:** el archivo `usuarios.e2e-spec.ts` nace aquí con el `beforeAll`/`afterAll` y los tres usuarios de prueba (General, atado a Tijuana, sin permiso) que las Tasks 4-7 van a reutilizar sin duplicar — aunque esta tarea, por sí sola, solo necesita dos de los tres.

- [ ] **Step 1: Escribir el e2e que falla**

Crea `apps/backend/test/usuarios.e2e-spec.ts`:

```typescript
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

interface MatrizPerfilesRespuesta {
  permisos: { id: string; clave: string; grupo: string; descripcion: string | null }[];
  perfiles: { id: string; nombre: string; esMaestro: boolean; permisos: string[] }[];
}

const SUFIJO = Date.now();
const LOGIN_GENERAL = `e2e-usr-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-usr-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-usr-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const PREFIJO = `zz-e2e-${SUFIJO}`;

describe('Usuarios (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  let idTijuana: string;
  let idMexicali: string;
  let idPerfilMaestro: string;
  let idPerfilAuxiliar: string;
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

  /** Fixture de prueba: inserta un usuario DIRECTO en la base, por debajo de la API. */
  const crearUsuarioFixture = async (
    login: string,
    perfilId: string,
    sucursalId: string | null,
  ): Promise<string> => {
    const hash = await app.get(PasswordService).hashear(PASSWORD);
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

    const maestro = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Administrador General')
      .executeTakeFirstOrThrow();
    idPerfilMaestro = maestro.id;

    const auxiliar = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Auxiliar Administrativo')
      .executeTakeFirstOrThrow();
    idPerfilAuxiliar = auxiliar.id;

    await crearUsuarioFixture(LOGIN_GENERAL, idPerfilMaestro, null);
    await crearUsuarioFixture(LOGIN_TIJUANA, idPerfilMaestro, idTijuana);
    await crearUsuarioFixture(LOGIN_SIN_PERMISO, idPerfilAuxiliar, null);

    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    if (usuarioIds.length > 0) {
      await db
        .deleteFrom('usuario_permiso')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db
        .deleteFrom('sesion_refresh')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await db.deleteFrom('usuario').where('login', 'like', `${PREFIJO}%`).execute();
    await app.close();
  });

  describe('GET /usuarios/catalogo-perfiles', () => {
    it('devuelve perfiles con sus permisos y el catalogo completo', async () => {
      const res = await request(app.getHttpServer())
        .get('/usuarios/catalogo-perfiles')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const cuerpo = res.body as MatrizPerfilesRespuesta;
      expect(Array.isArray(cuerpo.permisos)).toBe(true);
      expect(cuerpo.permisos.length).toBeGreaterThan(0);
      const maestro = cuerpo.perfiles.find((p) => p.nombre === 'Administrador General');
      expect(maestro?.esMaestro).toBe(true);
      expect(maestro?.permisos.length).toBe(cuerpo.permisos.length);
    });

    it('rechaza sin usuario.gestionar (D6: la lectura tambien esta gateada)', async () => {
      await request(app.getHttpServer())
        .get('/usuarios/catalogo-perfiles')
        .set('Cookie', cookieSinPermiso)
        .expect(403);
    });

    it('rechaza a quien no tiene sesion', async () => {
      await request(app.getHttpServer())
        .get('/usuarios/catalogo-perfiles')
        .expect(401);
    });
  });
});
```

- [ ] **Step 2: Correr el e2e para verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend -- usuarios.e2e-spec
```

Esperado: FAIL — `Cannot GET /usuarios/catalogo-perfiles` (404, la ruta no existe).

- [ ] **Step 3: Escribir el servicio**

Crea `apps/backend/src/modules/auth/usuarios.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PerfilesService, type MatrizPerfiles } from './perfiles.service';

@Injectable()
export class UsuariosService {
  constructor(private readonly perfiles: PerfilesService) {}

  /**
   * D5 del spec: NO se expone GET /perfiles a quien administra usuarios
   * (ese endpoint exige perfil.gestionar, D3 de T-08b, a proposito). Se
   * reutiliza DIRECTO obtenerMatriz() -- ya trae exactamente lo que el
   * formulario de Usuarios necesita para precargar la matriz (D3): cada
   * perfil con su lista de claves efectivas, el maestro ya expandido al
   * catalogo completo.
   */
  async catalogoPerfiles(): Promise<MatrizPerfiles> {
    return this.perfiles.obtenerMatriz();
  }
}
```

- [ ] **Step 4: Escribir el controller**

Crea `apps/backend/src/modules/auth/usuarios.controller.ts`:

```typescript
import { Controller, Get } from '@nestjs/common';
import { RequierePermiso } from './requiere-permiso.decorator';
import { UsuariosService } from './usuarios.service';
import type { MatrizPerfiles } from './perfiles.service';

// Sin @Publico(): el guard global protege todo por defecto. Igual que
// PerfilesController (T-08b): el decorador va a nivel de CLASE -- los seis
// endpoints de este controlador exigen usuario.gestionar sin excepcion,
// lectura incluida (D6 del spec).
//
// GET 'catalogo-perfiles' se declara ANTES que GET ':id' (Task 4): Nest
// resuelve rutas en orden de declaracion dentro del controlador, y si
// ':id' fuera primero, "catalogo-perfiles" caeria ahi como si fuera un uuid
// y ParseUUIDPipe lo rechazaria con 400 en vez de llegar a este metodo.
@Controller('usuarios')
@RequierePermiso('usuario.gestionar')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get('catalogo-perfiles')
  async catalogoPerfiles(): Promise<MatrizPerfiles> {
    return this.usuarios.catalogoPerfiles();
  }
}
```

- [ ] **Step 5: Registrar en `auth.module.ts`**

Modifica `apps/backend/src/modules/auth/auth.module.ts`. Agrega los imports:

```typescript
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';
```

Agrega `UsuariosController` al arreglo `controllers` (junto a `PerfilesController`) y `UsuariosService` al arreglo `providers` (junto a `PerfilesService`). No hace falta exportarlo — nadie fuera de `AuthModule` lo necesita, igual que `PerfilesService`.

- [ ] **Step 6: Correr el e2e para verificar que pasa**

```bash
npm run test:e2e --workspace=apps/backend -- usuarios.e2e-spec
```

Esperado: PASS, 3 pruebas.

- [ ] **Step 7: Correr la suite e2e completa**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: tu línea base de la Task 0 + 3.

- [ ] **Step 8: Lint y build**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
```

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/auth/usuarios.service.ts \
        apps/backend/src/modules/auth/usuarios.controller.ts \
        apps/backend/src/modules/auth/auth.module.ts \
        apps/backend/test/usuarios.e2e-spec.ts
git commit -m "$(cat <<'EOF'
T-13 · GET /usuarios/catalogo-perfiles (D5)

Reutiliza PerfilesService.obtenerMatriz() directo en vez de recomponer
desde PerfilesRepository -- ya trae la forma exacta que el formulario
de Usuarios necesita, sin exigir perfil.gestionar (D3 de T-08b sigue
intacto, D5 de este spec agrega esta puerta alterna).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Vvvtzc2jmGPfo71vZDAeXW
EOF
)"
```

---

### Task 4: Backend — `GET /usuarios` y `GET /usuarios/:id` (D6, D8 del spec)

**Files:**
- Create: `apps/backend/src/modules/auth/usuarios.repository.ts`
- Modify: `apps/backend/src/modules/auth/usuarios.service.ts`
- Modify: `apps/backend/src/modules/auth/usuarios.controller.ts`
- Modify: `apps/backend/src/modules/auth/auth.module.ts`
- Modify: `apps/backend/test/usuarios.e2e-spec.ts`

**Interfaces:**
- Consumes: `resolverAlcance()`/`normalizarSucursalPedida()` de `../sucursales/alcance-sucursal`; `buscarSucursalUsuario()` de `../sucursales/buscar-sucursal-usuario` (T-12); `PermisosRepository.permisosDe()` (T-08a, ya exportado por `AuthModule`); `@UsuarioActual()` de `./usuario-actual.decorator`.
- Produces: `UsuarioResumen`, `UsuarioBase`, `UsuarioDetalle` (exportados de `usuarios.repository.ts`), consumidos por `UsuariosService`/`UsuariosController` (esta tarea, y Tasks 5-7) y por el portal (`lib/usuarios.ts`, Task 8).

**Nota de esta tarea:** solo lectura. Las Tasks 5-7 agregan `crear`/`editar`/`eliminar` sobre los mismos archivos.

- [ ] **Step 1: Escribir el e2e que falla (solo lectura)**

Agrega a `apps/backend/test/usuarios.e2e-spec.ts`, dentro de `describe('Usuarios (e2e)', ...)`, después de `describe('GET /usuarios/catalogo-perfiles', ...)`:

```typescript
  describe('GET /usuarios', () => {
    it('lista los usuarios con su perfil y codigo de sucursal', async () => {
      const res = await request(app.getHttpServer())
        .get('/usuarios')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const usuarios = res.body as { login: string; perfil: string; sucursalCodigo: string | null }[];
      const propio = usuarios.find((u) => u.login === LOGIN_TIJUANA);
      expect(propio).toBeDefined();
      expect(propio?.perfil).toBe('Administrador General');
      expect(propio?.sucursalCodigo).toBe('TJ');
      expect(propio).not.toHaveProperty('deleted_at');
      expect(propio).not.toHaveProperty('password_hash');
    });

    it('un usuario atado a TJ no ve los usuarios de MX ni los General', async () => {
      const res = await request(app.getHttpServer())
        .get('/usuarios')
        .set('Cookie', cookieTijuana)
        .expect(200);

      const logins = (res.body as { login: string }[]).map((u) => u.login);
      expect(logins).not.toContain(LOGIN_GENERAL);
    });

    it('un usuario atado que pide OTRA sucursal recibe 403', async () => {
      await request(app.getHttpServer())
        .get('/usuarios?sucursal=MX')
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('rechaza sin usuario.gestionar', async () => {
      await request(app.getHttpServer())
        .get('/usuarios')
        .set('Cookie', cookieSinPermiso)
        .expect(403);
    });

    it('rechaza a quien no tiene sesion', async () => {
      await request(app.getHttpServer()).get('/usuarios').expect(401);
    });
  });

  describe('GET /usuarios/:id', () => {
    it('devuelve el detalle con los permisos efectivos del perfil maestro', async () => {
      const id = await crearUsuarioFixture(`${PREFIJO}-detalle-maestro`, idPerfilMaestro, idTijuana);

      const res = await request(app.getHttpServer())
        .get(`/usuarios/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(200);

      const detalle = res.body as {
        login: string;
        sucursalId: string | null;
        permisosEfectivos: string[];
      };
      expect(detalle.login).toBe(`${PREFIJO}-detalle-maestro`);
      expect(detalle.sucursalId).toBe(idTijuana);
      expect(detalle.permisosEfectivos.length).toBeGreaterThan(0);
    });

    it('responde 404 para un id que no existe', async () => {
      await request(app.getHttpServer())
        .get('/usuarios/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieGeneral)
        .expect(404);
    });

    it('un usuario atado a TJ no puede leer el detalle de un usuario de MX', async () => {
      const id = await crearUsuarioFixture(`${PREFIJO}-detalle-mx`, idPerfilAuxiliar, idMexicali);

      await request(app.getHttpServer())
        .get(`/usuarios/${id}`)
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('responde 400 para un id mal formado', async () => {
      await request(app.getHttpServer())
        .get('/usuarios/no-es-un-uuid')
        .set('Cookie', cookieGeneral)
        .expect(400);
    });
  });
```

- [ ] **Step 2: Correr el e2e para verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend -- usuarios.e2e-spec
```

Esperado: FAIL — `Cannot GET /usuarios` (404, la ruta no existe).

- [ ] **Step 3: Escribir el repositorio (lectura)**

Crea `apps/backend/src/modules/auth/usuarios.repository.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';

export interface UsuarioResumen {
  id: string;
  login: string;
  nombre: string;
  perfil: string;
  perfilId: string;
  sucursalCodigo: string | null;
}

/** Lo mismo que UsuarioResumen, mas el id de sucursal (crudo, para el formulario). */
export interface UsuarioBase extends UsuarioResumen {
  sucursalId: string | null;
}

export interface UsuarioDetalle extends UsuarioBase {
  /** Perfil + excepciones ya combinados (D3 del spec) -- precarga la matriz del formulario de edicion. */
  permisosEfectivos: string[];
}

interface FilaUsuario {
  id: string;
  login: string;
  nombre: string;
  perfil_id: string;
  perfil_nombre: string;
  sucursal_id: string | null;
  sucursal_codigo: string | null;
}

function aBase(fila: FilaUsuario): UsuarioBase {
  return {
    id: fila.id,
    login: fila.login,
    nombre: fila.nombre,
    perfil: fila.perfil_nombre,
    perfilId: fila.perfil_id,
    sucursalId: fila.sucursal_id,
    sucursalCodigo: fila.sucursal_codigo,
  };
}

@Injectable()
export class UsuariosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  private consultaBase() {
    return this.db
      .selectFrom('usuario')
      .innerJoin('perfil', 'perfil.id', 'usuario.perfil_id')
      .leftJoin('sucursal', 'sucursal.id', 'usuario.sucursal_id')
      .select([
        'usuario.id as id',
        'usuario.login as login',
        'usuario.nombre as nombre',
        'usuario.perfil_id as perfil_id',
        'perfil.nombre as perfil_nombre',
        'usuario.sucursal_id as sucursal_id',
        'sucursal.codigo as sucursal_codigo',
      ])
      .where('usuario.deleted_at', 'is', null);
  }

  async listar(): Promise<UsuarioResumen[]> {
    const filas = await this.consultaBase().orderBy('usuario.nombre').execute();
    return filas.map(aBase);
  }

  async listarPorCodigoSucursal(codigo: string): Promise<UsuarioResumen[]> {
    const filas = await this.consultaBase()
      .where('sucursal.codigo', '=', codigo)
      .orderBy('usuario.nombre')
      .execute();
    return filas.map(aBase);
  }

  async obtener(id: string): Promise<UsuarioBase | undefined> {
    const fila = await this.consultaBase()
      .where('usuario.id', '=', id)
      .executeTakeFirst();
    return fila ? aBase(fila) : undefined;
  }

  /** Delegado al helper compartido (D9 del plan de T-12). */
  async buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuario(this.db, usuarioId);
  }
}
```

- [ ] **Step 4: Escribir el servicio (lectura + alcance)**

Reemplaza `apps/backend/src/modules/auth/usuarios.service.ts` completo:

```typescript
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { resolverAlcance, type Alcance } from '../sucursales/alcance-sucursal';
import { PerfilesService, type MatrizPerfiles } from './perfiles.service';
import { PermisosRepository } from './permisos.repository';
import {
  UsuariosRepository,
  type UsuarioBase,
  type UsuarioDetalle,
  type UsuarioResumen,
} from './usuarios.repository';

@Injectable()
export class UsuariosService {
  constructor(
    private readonly repo: UsuariosRepository,
    private readonly perfiles: PerfilesService,
    private readonly permisosRepo: PermisosRepository,
  ) {}

  async catalogoPerfiles(): Promise<MatrizPerfiles> {
    return this.perfiles.obtenerMatriz();
  }

  async listar(usuarioId: string, sucursalPedida: string | null): Promise<UsuarioResumen[]> {
    const alcance = await this.alcanceDe(usuarioId, sucursalPedida);
    return alcance.tipo === 'todas'
      ? this.repo.listar()
      : this.repo.listarPorCodigoSucursal(alcance.codigo);
  }

  async obtener(usuarioId: string, id: string): Promise<UsuarioDetalle> {
    const usuario = await this.repo.obtener(id);
    if (!usuario) {
      throw new NotFoundException('No existe ese usuario.');
    }
    await this.exigirAlcanceSobre(usuarioId, usuario.sucursalCodigo);
    return this.aDetalle(usuario);
  }

  /** Compartido con Tasks 5-7: agrega los permisos efectivos a un UsuarioBase ya resuelto. */
  protected async aDetalle(base: UsuarioBase): Promise<UsuarioDetalle> {
    const permisos = await this.permisosRepo.permisosDe(base.id);
    return { ...base, permisosEfectivos: [...permisos] };
  }

  /** La fila cruda de sucursal del actor -- Tasks 5-7 la necesitan para D8 (resolver destino). */
  protected async filaActor(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null }> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    return fila;
  }

  private async alcanceDe(usuarioId: string, sucursalPedida: string | null): Promise<Alcance> {
    const fila = await this.filaActor(usuarioId);
    return resolverAlcance(fila.codigo, sucursalPedida);
  }

  protected exigirAlcanceSobreCodigo(alcance: Alcance, codigo: string | null): void {
    if (alcance.tipo === 'una' && alcance.codigo !== codigo) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }
  }

  private async exigirAlcanceSobre(usuarioId: string, codigo: string | null): Promise<void> {
    const alcance = await this.alcanceDe(usuarioId, null);
    this.exigirAlcanceSobreCodigo(alcance, codigo);
  }
}
```

> [!info] Por qué `protected` en vez de `private`
> `aDetalle`, `filaActor` y `exigirAlcanceSobreCodigo` se usan en esta misma clase, pero las Tasks 5-7 agregan métodos a la MISMA clase (no una subclase) — en NestJS con inyección de dependencias no hay razón para dividir esto en subclases. `protected` es solo para dejar constancia de que estos métodos son plomería interna, no parte de la interfaz pública del servicio; funcionalmente aquí se comporta igual que `private`. Si al implementar te resulta más simple, usa `private` sin problema — no cambia ningún test.

- [ ] **Step 5: Escribir el controller (lectura)**

Reemplaza `apps/backend/src/modules/auth/usuarios.controller.ts` completo:

```typescript
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { UsuarioActual } from './usuario-actual.decorator';
import { RequierePermiso } from './requiere-permiso.decorator';
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import { UsuariosService } from './usuarios.service';
import type { MatrizPerfiles } from './perfiles.service';
import type { UsuarioDetalle, UsuarioResumen } from './usuarios.repository';

@Controller('usuarios')
@RequierePermiso('usuario.gestionar')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get('catalogo-perfiles')
  async catalogoPerfiles(): Promise<MatrizPerfiles> {
    return this.usuarios.catalogoPerfiles();
  }

  @Get()
  async listar(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
  ): Promise<UsuarioResumen[]> {
    return this.usuarios.listar(usuarioId, normalizarSucursalPedida(sucursal));
  }

  @Get(':id')
  async obtener(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UsuarioDetalle> {
    return this.usuarios.obtener(usuarioId, id);
  }
}
```

- [ ] **Step 6: Registrar `UsuariosRepository` en `auth.module.ts`**

Agrega el import `import { UsuariosRepository } from './usuarios.repository';` y agrégalo al arreglo `providers`, junto a `UsuariosService`.

- [ ] **Step 7: Correr el e2e para verificar que pasa**

```bash
npm run test:e2e --workspace=apps/backend -- usuarios.e2e-spec
```

Esperado: PASS, 12 pruebas (3 de la Task 3 + 9 nuevas).

- [ ] **Step 8: Correr la suite e2e completa**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: tu línea base de la Task 0 + 12.

- [ ] **Step 9: Lint y build**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
```

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/modules/auth/usuarios.repository.ts \
        apps/backend/src/modules/auth/usuarios.service.ts \
        apps/backend/src/modules/auth/usuarios.controller.ts \
        apps/backend/src/modules/auth/auth.module.ts \
        apps/backend/test/usuarios.e2e-spec.ts
git commit -m "$(cat <<'EOF'
T-13 · GET /usuarios y GET /usuarios/:id (D6, D8)

Lectura acotada por resolverAlcance() (T-09), igual que Clientes/
Vehiculos/Productos, pero gateada por usuario.gestionar tambien en el
GET (D6 -- a diferencia de esos tres catalogos). El detalle trae los
permisos efectivos (perfil + excepciones ya combinados por
PermisosRepository.permisosDe(), T-08a) para precargar la matriz del
formulario de edicion (D3).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Vvvtzc2jmGPfo71vZDAeXW
EOF
)"
```

---

### Task 5: Backend — `POST /usuarios` (alta) (D2, D3, D4, D8, D10 del spec)

**Files:**
- Create: `apps/backend/src/modules/auth/dto/crear-usuario.dto.ts`
- Modify: `apps/backend/src/modules/auth/usuarios.repository.ts`
- Modify: `apps/backend/src/modules/auth/usuarios.service.ts`
- Modify: `apps/backend/src/modules/auth/usuarios.controller.ts`
- Modify: `apps/backend/test/usuarios.e2e-spec.ts`

**Interfaces:**
- Consumes: `calcularExcepciones()` de `./calcular-excepciones` (Task 2); `PasswordService.hashear()` (T-06, ya existe); `esViolacionUnicidad()`/`esViolacionFk()` de `../../database/errores-postgres` (T-12).
- Produces: `UsuariosRepository.crear(...)`, `UsuariosService.crear(...)`, consumidos por el portal (`lib/usuarios.ts`, Task 8).

- [ ] **Step 1: Escribir el e2e que falla**

Agrega a `apps/backend/test/usuarios.e2e-spec.ts`, después de `describe('GET /usuarios/:id', ...)`:

```typescript
  describe('POST /usuarios', () => {
    it('da de alta un usuario con permisos por excepcion sobre su perfil', async () => {
      const catalogo = (
        await request(app.getHttpServer())
          .get('/usuarios/catalogo-perfiles')
          .set('Cookie', cookieGeneral)
          .expect(200)
      ).body as {
        permisos: { clave: string }[];
        perfiles: { id: string; nombre: string; permisos: string[] }[];
      };
      const auxiliar = catalogo.perfiles.find((p) => p.nombre === 'Auxiliar Administrativo')!;
      // Desmarca el primer permiso que el perfil SI da, marca uno que NO da.
      const permisoQueDa = auxiliar.permisos[0];
      const permisoQueNoDa = catalogo.permisos.find((p) => !auxiliar.permisos.includes(p.clave))!.clave;
      const marcados = auxiliar.permisos.filter((c) => c !== permisoQueDa).concat(permisoQueNoDa);

      const res = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-alta`,
          nombre: 'Usuario de prueba',
          contrasena: 'una-contrasena-larga',
          perfilId: auxiliar.id,
          permisosMarcados: marcados,
        })
        .expect(201);

      const creado = res.body as { id: string; permisosEfectivos: string[] };
      usuarioIds.push(creado.id);
      expect(creado.permisosEfectivos).toContain(permisoQueNoDa);
      expect(creado.permisosEfectivos).not.toContain(permisoQueDa);
    });

    it('el perfil maestro ignora permisosMarcados: siempre recibe el catalogo completo', async () => {
      const res = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-alta-maestro`,
          nombre: 'Maestro de prueba',
          contrasena: 'una-contrasena-larga',
          perfilId: idPerfilMaestro,
          permisosMarcados: [],
        })
        .expect(201);

      const creado = res.body as { id: string; permisosEfectivos: string[] };
      usuarioIds.push(creado.id);
      expect(creado.permisosEfectivos.length).toBeGreaterThan(0);
    });

    it('rechaza un login duplicado con 409', async () => {
      await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieGeneral)
        .send({
          login: LOGIN_SIN_PERMISO,
          nombre: 'Repetido',
          contrasena: 'una-contrasena-larga',
          perfilId: idPerfilAuxiliar,
          permisosMarcados: [],
        })
        .expect(409);
    });

    it('a un usuario atado se le ignora el sucursalId que mande (D8): se le asigna la suya', async () => {
      const res = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieTijuana)
        .send({
          login: `${PREFIJO}-alta-atado`,
          nombre: 'Atado de prueba',
          contrasena: 'una-contrasena-larga',
          perfilId: idPerfilAuxiliar,
          sucursalId: idMexicali,
          permisosMarcados: [],
        })
        .expect(201);

      const creado = res.body as { id: string; sucursalId: string };
      usuarioIds.push(creado.id);
      expect(creado.sucursalId).toBe(idTijuana);
    });

    it('rechaza sin usuario.gestionar', async () => {
      await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieSinPermiso)
        .send({
          login: `${PREFIJO}-sin-permiso`,
          nombre: 'X',
          contrasena: 'una-contrasena-larga',
          perfilId: idPerfilAuxiliar,
          permisosMarcados: [],
        })
        .expect(403);
    });

    it('rechaza una contrasena corta con 400', async () => {
      await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-corta`,
          nombre: 'X',
          contrasena: '123',
          perfilId: idPerfilAuxiliar,
          permisosMarcados: [],
        })
        .expect(400);
    });

    it('rechaza un perfilId que no existe con 404', async () => {
      await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-perfil-inexistente`,
          nombre: 'X',
          contrasena: 'una-contrasena-larga',
          perfilId: '00000000-0000-0000-0000-000000000000',
          permisosMarcados: [],
        })
        .expect(404);
    });
  });
```

- [ ] **Step 2: Correr el e2e para verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend -- usuarios.e2e-spec
```

Esperado: FAIL — `Cannot POST /usuarios` (404, la ruta no existe).

- [ ] **Step 3: Escribir el DTO**

Crea `apps/backend/src/modules/auth/dto/crear-usuario.dto.ts`:

```typescript
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CrearUsuarioDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El login es obligatorio.' })
  @MaxLength(60, { message: 'El login no puede pasar de 60 caracteres.' })
  login!: string;

  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  @MaxLength(120, { message: 'El nombre no puede pasar de 120 caracteres.' })
  nombre!: string;

  // D2 del spec: obligatoria en el alta. argon2id produce un hash de tamano
  // fijo sin importar la longitud de entrada -- solo se acota el minimo,
  // mismo umbral que OWASP recomienda para contrasenas sin gestor.
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(200, { message: 'La contraseña no puede pasar de 200 caracteres.' })
  contrasena!: string;

  @IsUUID()
  perfilId!: string;

  // Solo lo manda -y solo se le hace caso- un usuario General (D8, mismo
  // criterio que sucursalId en CrearClienteDto de T-12). A un usuario atado
  // se le ignora: su formulario ni siquiera pinta el campo.
  @IsOptional()
  @IsUUID()
  sucursalId?: string;

  // Estado final marcado (D3), no una lista de excepciones -- el backend
  // calcula la diferencia contra lo que da el perfil elegido. Por CLAVE, no
  // por id: combinarPermisos/calcularExcepciones (permisos.ts) ya operan
  // sobre claves. Siempre presente (puede ser []), igual que
  // `productosPromocion` en CrearClienteDto de T-12.
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  permisosMarcados!: string[];
}
```

- [ ] **Step 4: Repositorio — `crear()` y el helper de excepciones**

Agrega a `apps/backend/src/modules/auth/usuarios.repository.ts` (la interfaz `ExcepcionConId` va junto a las demás interfaces, el resto dentro de la clase):

```typescript
export interface ExcepcionConId {
  permiso_id: string;
  habilitado: boolean;
}

export interface DatosUsuarioBase {
  login: string;
  nombre: string;
  perfil_id: string;
  sucursal_id: string | null;
}
```

Y agrega el import de `Transaction`/`DB` y los métodos a la clase (después de `obtener()`):

```typescript
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
```

```typescript
  async crear(
    datos: DatosUsuarioBase & { password_hash: string },
    excepciones: ExcepcionConId[],
  ): Promise<UsuarioBase> {
    const id = await this.db.transaction().execute(async (trx) => {
      const usuario = await trx
        .insertInto('usuario')
        .values({
          login: datos.login,
          nombre: datos.nombre,
          password_hash: datos.password_hash,
          perfil_id: datos.perfil_id,
          sucursal_id: datos.sucursal_id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await this.reemplazarExcepciones(trx, usuario.id, excepciones);
      return usuario.id;
    });

    return (await this.obtener(id))!;
  }

  /**
   * Reconcilia usuario_permiso contra el estado final que ya trae resuelto
   * el servicio (D3 del spec): da de baja toda excepcion vigente que ya NO
   * este en la lista nueva, y hace upsert de cada una que si -- mismo
   * patron de "on conflict … do update set deleted_at = null" que
   * PerfilesRepository.togglePermiso() (T-08b) usa para perfil_permiso,
   * fila por fila porque el catalogo de permisos es chico (~25 filas) y ya
   * es el mismo criterio que ClientesRepository.actualizar() (T-12) sigue
   * para sus overrides de precio.
   */
  private async reemplazarExcepciones(
    trx: Transaction<DB>,
    usuarioId: string,
    excepciones: ExcepcionConId[],
  ): Promise<void> {
    const idsVigentes = excepciones.map((e) => e.permiso_id);
    const baja = trx
      .updateTable('usuario_permiso')
      .set({ deleted_at: new Date() })
      .where('usuario_id', '=', usuarioId)
      .where('deleted_at', 'is', null);
    await (idsVigentes.length > 0 ? baja.where('permiso_id', 'not in', idsVigentes) : baja).execute();

    for (const excepcion of excepciones) {
      await trx
        .insertInto('usuario_permiso')
        .values({
          usuario_id: usuarioId,
          permiso_id: excepcion.permiso_id,
          habilitado: excepcion.habilitado,
        })
        .onConflict((oc) =>
          oc.columns(['usuario_id', 'permiso_id']).doUpdateSet({
            habilitado: excepcion.habilitado,
            deleted_at: null,
          }),
        )
        .execute();
    }
  }
```

- [ ] **Step 5: Servicio — `crear()` con D3/D4/D8**

Agrega a `apps/backend/src/modules/auth/usuarios.service.ts`. Import nuevo:

```typescript
import { ConflictException, NotFoundException } from '@nestjs/common';
import { esViolacionFk, esViolacionUnicidad } from '../../database/errores-postgres';
import { PasswordService } from './password.service';
import { calcularExcepciones } from './calcular-excepciones';
import type { CrearUsuarioDto } from './dto/crear-usuario.dto';
import type { ExcepcionConId } from './usuarios.repository';
```

(Nota: `ForbiddenException`/`NotFoundException`/`UnauthorizedException` ya estaban importados desde la Task 4 — agrega solo `ConflictException` a ese mismo import.)

Constructor: agrega `private readonly password: PasswordService` a los parámetros.

Método nuevo, y el helper privado que lo acompaña:

```typescript
  async crear(usuarioId: string, dto: CrearUsuarioDto): Promise<UsuarioDetalle> {
    const actor = await this.filaActor(usuarioId);
    // D8: si esta atado, la sucursal sale del alcance -- se ignora lo que
    // mande el body, mismo criterio que D6 de CrearClienteDto (T-12).
    const sucursalId = actor.id ?? dto.sucursalId ?? null;

    const matriz = await this.perfiles.obtenerMatriz();
    const perfil = matriz.perfiles.find((p) => p.id === dto.perfilId);
    if (!perfil) {
      throw new NotFoundException('No existe ese perfil.');
    }

    const excepciones = this.excepcionesConId(dto.permisosMarcados, perfil, matriz);
    const hash = await this.password.hashear(dto.contrasena);

    try {
      const creado = await this.repo.crear(
        {
          login: dto.login,
          nombre: dto.nombre,
          password_hash: hash,
          perfil_id: dto.perfilId,
          sucursal_id: sucursalId,
        },
        excepciones,
      );
      return this.aDetalle(creado);
    } catch (error) {
      if (esViolacionUnicidad(error)) {
        throw new ConflictException(`Ya existe un usuario con el login "${dto.login}".`);
      }
      if (esViolacionFk(error)) {
        throw new NotFoundException('Alguno de los datos enviados no existe.');
      }
      throw error;
    }
  }

  /**
   * D4 del spec: el perfil maestro no consulta usuario_permiso
   * (permisos.repository.ts:43 corta antes) -- si el formulario de todos
   * modos manda permisosMarcados para un usuario con ese perfil, se ignora
   * en vez de escribir excepciones muertas.
   */
  protected excepcionesConId(
    marcados: string[],
    perfil: { esMaestro: boolean; permisos: string[] },
    matriz: MatrizPerfiles,
  ): ExcepcionConId[] {
    if (perfil.esMaestro) {
      return [];
    }
    const claveAId = new Map(matriz.permisos.map((p) => [p.clave, p.id]));
    const excepciones = calcularExcepciones(new Set(marcados), perfil.permisos);
    return excepciones
      .map((e) => ({ permiso_id: claveAId.get(e.clave), habilitado: e.habilitado }))
      .filter((e): e is ExcepcionConId => e.permiso_id !== undefined);
  }
```

- [ ] **Step 6: Controller — `POST /usuarios`**

Agrega a `apps/backend/src/modules/auth/usuarios.controller.ts`. Import nuevo:

```typescript
import { Body, HttpCode, Post } from '@nestjs/common';
import { UsuarioActual } from './usuario-actual.decorator';
import { CrearUsuarioDto } from './dto/crear-usuario.dto';
import type { UsuarioDetalle } from './usuarios.repository';
```

(Fusiona con los imports ya existentes de `@nestjs/common` en una sola línea; `UsuarioActual` ya estaba importado desde la Task 4.)

Método:

```typescript
  @Post()
  @HttpCode(201)
  async crear(
    @UsuarioActual() usuarioId: string,
    @Body() dto: CrearUsuarioDto,
  ): Promise<UsuarioDetalle> {
    return this.usuarios.crear(usuarioId, dto);
  }
```

- [ ] **Step 7: Correr el e2e para verificar que pasa**

```bash
npm run test:e2e --workspace=apps/backend -- usuarios.e2e-spec
```

Esperado: PASS, 19 pruebas (12 de las Tasks 3-4 + 7 nuevas).

- [ ] **Step 8: Correr la suite e2e completa**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: tu línea base de la Task 0 + 19.

- [ ] **Step 9: Lint y build**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
```

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/modules/auth/dto/crear-usuario.dto.ts \
        apps/backend/src/modules/auth/usuarios.repository.ts \
        apps/backend/src/modules/auth/usuarios.service.ts \
        apps/backend/src/modules/auth/usuarios.controller.ts \
        apps/backend/test/usuarios.e2e-spec.ts
git commit -m "$(cat <<'EOF'
T-13 · POST /usuarios (alta) (D2, D3, D4, D8, D10)

Contrasena obligatoria (D2). Excepciones de permisos calculadas con
calcularExcepciones() a partir del estado final marcado (D3), sin
escritura para el perfil maestro (D4). Sucursal sale del alcance para
un usuario atado, ignorando lo que mande el body (D8). Todo en una
transaccion (D10).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Vvvtzc2jmGPfo71vZDAeXW
EOF
)"
```

---

### Task 6: Backend — `PATCH /usuarios/:id` (edición) (D2, D3, D4, D7 mitad, D8 del spec)

**Files:**
- Create: `apps/backend/src/modules/auth/dto/editar-usuario.dto.ts`
- Modify: `apps/backend/src/modules/auth/usuarios.repository.ts`
- Modify: `apps/backend/src/modules/auth/usuarios.service.ts`
- Modify: `apps/backend/src/modules/auth/usuarios.controller.ts`
- Modify: `apps/backend/test/usuarios.e2e-spec.ts`

**Interfaces:**
- Consumes: `esMaestro()` de `./permisos` (T-08a, ya existe).
- Produces: `UsuariosRepository.actualizar(...)`, `contarActivosConPerfil(...)`; `UsuariosService.editar(...)`, consumidos por el portal (Task 8) y por `UsuariosService.eliminar()` (Task 7, que reutiliza `contarActivosConPerfil`).

- [ ] **Step 1: Escribir el e2e que falla**

Agrega a `apps/backend/test/usuarios.e2e-spec.ts`, después de `describe('POST /usuarios', ...)`:

```typescript
  describe('PATCH /usuarios/:id', () => {
    it('edita datos basicos sin tocar la contrasena si el campo no viene', async () => {
      const id = await crearUsuarioFixture(`${PREFIJO}-editar-sin-pass`, idPerfilAuxiliar, idTijuana);
      const cookieEditado = await iniciarSesion(`${PREFIJO}-editar-sin-pass`);

      await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-editar-sin-pass`,
          nombre: 'Nombre editado',
          perfilId: idPerfilAuxiliar,
          sucursalId: idTijuana,
          permisosMarcados: [],
        })
        .expect(200);

      // La sesion vieja de este usuario sigue viva: si el PATCH hubiera
      // tocado la contrasena sin que el campo viniera, el login de abajo
      // fallaria.
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login: `${PREFIJO}-editar-sin-pass`, password: PASSWORD })
        .expect(200);
      void cookieEditado;
    });

    it('cambia la contrasena cuando el campo si viene', async () => {
      const id = await crearUsuarioFixture(`${PREFIJO}-editar-con-pass`, idPerfilAuxiliar, idTijuana);

      await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-editar-con-pass`,
          nombre: 'X',
          contrasena: 'una-contrasena-nueva',
          perfilId: idPerfilAuxiliar,
          sucursalId: idTijuana,
          permisosMarcados: [],
        })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login: `${PREFIJO}-editar-con-pass`, password: 'una-contrasena-nueva' })
        .expect(200);
    });

    it('recalcula las excepciones al cambiar de perfil: lo que sobra se borra', async () => {
      const catalogo = (
        await request(app.getHttpServer())
          .get('/usuarios/catalogo-perfiles')
          .set('Cookie', cookieGeneral)
          .expect(200)
      ).body as { perfiles: { id: string; nombre: string; permisos: string[] }[] };
      const auxiliar = catalogo.perfiles.find((p) => p.nombre === 'Auxiliar Administrativo')!;
      const jefeVentas = catalogo.perfiles.find((p) => p.nombre === 'Jefe de Ventas')!;

      const id = await crearUsuarioFixture(`${PREFIJO}-recalcula`, idPerfilAuxiliar, idTijuana);
      const extra = jefeVentas.permisos.find((c) => !auxiliar.permisos.includes(c))!;

      // Se le da de alta con una excepcion propia del perfil de Jefe de
      // Ventas, encima de su perfil de Auxiliar.
      await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-recalcula`,
          nombre: 'X',
          perfilId: auxiliar.id,
          sucursalId: idTijuana,
          permisosMarcados: [...auxiliar.permisos, extra],
        })
        .expect(200);

      // Cambia a Jefe de Ventas SIN marcar `extra` explicitamente en la
      // lista nueva -- si `extra` ya lo da el perfil nuevo, no hace falta
      // repetirlo; la prueba real es que la excepcion vieja (atada al
      // permiso_id) no sobrevive fantasma con un habilitado obsoleto.
      const res = await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-recalcula`,
          nombre: 'X',
          perfilId: jefeVentas.id,
          sucursalId: idTijuana,
          permisosMarcados: jefeVentas.permisos,
        })
        .expect(200);

      const detalle = res.body as { permisosEfectivos: string[] };
      expect(detalle.permisosEfectivos.sort()).toEqual([...jefeVentas.permisos].sort());
    });

    it('rechaza cambiarle el perfil al ultimo Administrador General activo (D7)', async () => {
      const idUnico = await crearUsuarioFixture(`${PREFIJO}-unico-admin`, idPerfilMaestro, null);
      const cookieUnico = await iniciarSesion(`${PREFIJO}-unico-admin`);

      // Ventana angosta a proposito: D7 es la primera regla de negocio de
      // este backend que depende de un conteo GLOBAL sobre un perfil que
      // no se puede crear desechable (esMaestro() compara por nombre
      // fijo, a diferencia de sembrarPerfil() en T-08b). `test:e2e` no fija
      // --runInBand, asi que puede haber Administrador General activos de
      // OTROS archivos de e2e corriendo en paralelo -- se bajan
      // TEMPORALMENTE (nunca al propio `idUnico`, que hace la peticion con
      // su propia sesion), se hace la asercion, y se restauran de
      // inmediato en el `finally`. Riesgo residual: si otro worker crea o
      // borra un Administrador General en esta misma ventana de
      // milisegundos, esta prueba puede fallar de forma intermitente.
      const otrosMaestrosActivos = await db
        .selectFrom('usuario')
        .select('id')
        .where('perfil_id', '=', idPerfilMaestro)
        .where('deleted_at', 'is', null)
        .where('id', '!=', idUnico)
        .execute();
      const idsOtros = otrosMaestrosActivos.map((f) => f.id);

      try {
        if (idsOtros.length > 0) {
          await db
            .updateTable('usuario')
            .set({ perfil_id: idPerfilAuxiliar })
            .where('id', 'in', idsOtros)
            .execute();
        }

        await request(app.getHttpServer())
          .patch(`/usuarios/${idUnico}`)
          .set('Cookie', cookieUnico)
          .send({
            login: `${PREFIJO}-unico-admin`,
            nombre: 'X',
            perfilId: idPerfilAuxiliar,
            permisosMarcados: [],
          })
          .expect(409);
      } finally {
        if (idsOtros.length > 0) {
          await db
            .updateTable('usuario')
            .set({ perfil_id: idPerfilMaestro })
            .where('id', 'in', idsOtros)
            .execute();
        }
      }
    });

    it('un usuario atado a TJ no puede editar un usuario de MX', async () => {
      const id = await crearUsuarioFixture(`${PREFIJO}-editar-mx`, idPerfilAuxiliar, idMexicali);

      await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ login: `${PREFIJO}-editar-mx`, nombre: 'X', perfilId: idPerfilAuxiliar, permisosMarcados: [] })
        .expect(403);
    });

    it('un usuario atado a TJ no puede mover a un usuario a MX (D8)', async () => {
      const id = await crearUsuarioFixture(`${PREFIJO}-mover-mx`, idPerfilAuxiliar, idTijuana);

      await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookieTijuana)
        .send({
          login: `${PREFIJO}-mover-mx`,
          nombre: 'X',
          perfilId: idPerfilAuxiliar,
          sucursalId: idMexicali,
          permisosMarcados: [],
        })
        .expect(403);
    });

    it('un usuario General si puede mover a otro entre sucursales', async () => {
      const id = await crearUsuarioFixture(`${PREFIJO}-mover-general`, idPerfilAuxiliar, idTijuana);

      const res = await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-mover-general`,
          nombre: 'X',
          perfilId: idPerfilAuxiliar,
          sucursalId: idMexicali,
          permisosMarcados: [],
        })
        .expect(200);

      expect((res.body as { sucursalId: string }).sucursalId).toBe(idMexicali);
    });

    it('responde 404 para un id que no existe', async () => {
      await request(app.getHttpServer())
        .patch('/usuarios/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieGeneral)
        .send({ login: 'x', nombre: 'x', perfilId: idPerfilAuxiliar, permisosMarcados: [] })
        .expect(404);
    });

    it('rechaza sin usuario.gestionar', async () => {
      const id = await crearUsuarioFixture(`${PREFIJO}-editar-sin-permiso`, idPerfilAuxiliar, null);

      await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookieSinPermiso)
        .send({ login: `${PREFIJO}-editar-sin-permiso`, nombre: 'X', perfilId: idPerfilAuxiliar, permisosMarcados: [] })
        .expect(403);
    });
  });
```

- [ ] **Step 2: Correr el e2e para verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend -- usuarios.e2e-spec
```

Esperado: FAIL — `Cannot PATCH /usuarios/:id` (404, la ruta no existe).

- [ ] **Step 3: Repositorio — `actualizar()` y `contarActivosConPerfil()`**

Agrega a `apps/backend/src/modules/auth/usuarios.repository.ts`, después de `crear()`:

```typescript
  async actualizar(
    id: string,
    datos: DatosUsuarioBase & { password_hash?: string },
    excepciones: ExcepcionConId[],
  ): Promise<UsuarioBase> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('usuario')
        .set({
          login: datos.login,
          nombre: datos.nombre,
          perfil_id: datos.perfil_id,
          sucursal_id: datos.sucursal_id,
          ...(datos.password_hash ? { password_hash: datos.password_hash } : {}),
        })
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

      await this.reemplazarExcepciones(trx, id, excepciones);
    });

    return (await this.obtener(id))!;
  }

  /** D7 del spec: cuenta cuantos usuarios activos tienen un perfil dado (mismo patron que PerfilesRepository.contarUsuariosActivos, T-08b). */
  async contarActivosConPerfil(perfilId: string): Promise<number> {
    const fila = await this.db
      .selectFrom('usuario')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('perfil_id', '=', perfilId)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(fila.total);
  }
```

- [ ] **Step 4: Escribir el DTO**

Crea `apps/backend/src/modules/auth/dto/editar-usuario.dto.ts`:

```typescript
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Mismos campos que CrearUsuarioDto, con dos diferencias (D2, D8 del spec):
 * `contrasena` es OPCIONAL -- ausente o `undefined` significa "no cambiar".
 * El cliente (lib/usuarios.ts, Task 8) omite la clave del JSON cuando el
 * campo del formulario quedo vacio; NO manda una cadena vacia, que si
 * pasaria @MinLength(8) y volveria 400 sin que el usuario entienda por que.
 * `sucursalId` SI sigue presente y editable (a diferencia de
 * EditarClienteDto de T-12): la sucursal de un Usuario no es inmutable
 * (D8).
 */
export class EditarUsuarioDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El login es obligatorio.' })
  @MaxLength(60, { message: 'El login no puede pasar de 60 caracteres.' })
  login!: string;

  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  @MaxLength(120, { message: 'El nombre no puede pasar de 120 caracteres.' })
  nombre!: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(200, { message: 'La contraseña no puede pasar de 200 caracteres.' })
  contrasena?: string;

  @IsUUID()
  perfilId!: string;

  @IsOptional()
  @IsUUID()
  sucursalId?: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  permisosMarcados!: string[];
}
```

- [ ] **Step 5: Servicio — `editar()` con D2/D3/D4/D7/D8**

Agrega a `apps/backend/src/modules/auth/usuarios.service.ts`. Import nuevo:

```typescript
import { esMaestro } from './permisos';
import type { EditarUsuarioDto } from './dto/editar-usuario.dto';
```

Método:

```typescript
  async editar(usuarioId: string, id: string, dto: EditarUsuarioDto): Promise<UsuarioDetalle> {
    const actual = await this.repo.obtener(id);
    if (!actual) {
      throw new NotFoundException('No existe ese usuario.');
    }

    const actor = await this.filaActor(usuarioId);
    const alcance = resolverAlcance(actor.codigo, null);
    // D8: la sucursal ACTUAL del editado tiene que estar dentro del
    // alcance de quien edita, igual que ClientesService.editar() (T-12).
    this.exigirAlcanceSobreCodigo(alcance, actual.sucursalCodigo);

    let sucursalId: string | null;
    if (actor.id === null) {
      // General: puede mover a cualquiera, incluida "General" (null).
      sucursalId = dto.sucursalId ?? null;
    } else {
      // Atado: el DESTINO tambien tiene que ser su propia sucursal (D8) --
      // variacion propia de T-13 sobre ClientesService, que ahi ni siquiera
      // deja mandar el campo (sucursal inmutable, T-12 D6).
      if (dto.sucursalId !== undefined && dto.sucursalId !== actor.id) {
        throw new ForbiddenException('No tienes acceso a esa sucursal.');
      }
      sucursalId = actor.id;
    }

    const matriz = await this.perfiles.obtenerMatriz();
    const perfilNuevo = matriz.perfiles.find((p) => p.id === dto.perfilId);
    if (!perfilNuevo) {
      throw new NotFoundException('No existe ese perfil.');
    }

    // D7 (mitad de PATCH): no dejar sin ningun Administrador General
    // activo. Solo aplica si el perfil ACTUAL es el maestro y el nuevo NO
    // lo es -- cualquier otro cambio de perfil no puede vaciar la cuenta.
    if (esMaestro(actual.perfil) && !perfilNuevo.esMaestro) {
      const activos = await this.repo.contarActivosConPerfil(actual.perfilId);
      if (activos <= 1) {
        throw new ConflictException('Debe quedar al menos un Administrador General activo.');
      }
    }

    const excepciones = this.excepcionesConId(dto.permisosMarcados, perfilNuevo, matriz);
    const hash = dto.contrasena ? await this.password.hashear(dto.contrasena) : undefined;

    try {
      const actualizado = await this.repo.actualizar(
        id,
        {
          login: dto.login,
          nombre: dto.nombre,
          perfil_id: dto.perfilId,
          sucursal_id: sucursalId,
          password_hash: hash,
        },
        excepciones,
      );
      return this.aDetalle(actualizado);
    } catch (error) {
      if (esViolacionUnicidad(error)) {
        throw new ConflictException(`Ya existe un usuario con el login "${dto.login}".`);
      }
      if (esViolacionFk(error)) {
        throw new NotFoundException('Alguno de los datos enviados no existe.');
      }
      throw error;
    }
  }
```

- [ ] **Step 6: Controller — `PATCH /usuarios/:id`**

Agrega a `apps/backend/src/modules/auth/usuarios.controller.ts`. Import nuevo:

```typescript
import { Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { EditarUsuarioDto } from './dto/editar-usuario.dto';
```

(Fusiona con los imports ya existentes de `@nestjs/common`; `Param`/`ParseUUIDPipe` ya estaban desde la Task 4.)

Método:

```typescript
  @Patch(':id')
  async editar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarUsuarioDto,
  ): Promise<UsuarioDetalle> {
    return this.usuarios.editar(usuarioId, id, dto);
  }
```

- [ ] **Step 7: Correr el e2e para verificar que pasa**

```bash
npm run test:e2e --workspace=apps/backend -- usuarios.e2e-spec
```

Esperado: PASS, 28 pruebas (19 de las Tasks 3-5 + 9 nuevas).

- [ ] **Step 8: Correr la suite e2e completa**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: tu línea base de la Task 0 + 28.

- [ ] **Step 9: Lint y build**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
```

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/modules/auth/dto/editar-usuario.dto.ts \
        apps/backend/src/modules/auth/usuarios.repository.ts \
        apps/backend/src/modules/auth/usuarios.service.ts \
        apps/backend/src/modules/auth/usuarios.controller.ts \
        apps/backend/test/usuarios.e2e-spec.ts
git commit -m "$(cat <<'EOF'
T-13 · PATCH /usuarios/:id (edicion) (D2, D3, D4, D7 mitad, D8)

Contrasena opcional -- ausente significa "no cambiar" (D2). Bloquea
con 409 el cambio de perfil que dejaria sin ningun Administrador
General activo (D7). La sucursal SI es editable (a diferencia de
Cliente/Vehiculo): actual y destino deben caer en el alcance de quien
edita (D8).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Vvvtzc2jmGPfo71vZDAeXW
EOF
)"
```

---

### Task 7: Backend — `DELETE /usuarios/:id` + migración de `usuario.login` (D1, D7 del spec)

**Files:**
- Create: `supabase/migrations/20260903130000_usuario_login_indice_parcial.sql`
- Create: `supabase/tests/99_usuario_login_unicidad_test.sql`
- Modify: `apps/backend/src/modules/auth/usuarios.repository.ts`
- Modify: `apps/backend/src/modules/auth/usuarios.service.ts`
- Modify: `apps/backend/src/modules/auth/usuarios.controller.ts`
- Modify: `apps/backend/test/usuarios.e2e-spec.ts`

**Interfaces:**
- Consumes: `UsuariosRepository.contarActivosConPerfil()` (Task 6).
- Produces: `UsuariosRepository.darDeBaja(id)`, `UsuariosService.eliminar(...)`, consumidos por el portal (Task 8).

**Nota de esta tarea:** T-13 es el primer ticket que le da baja lógica a un `usuario` — hasta ahora nadie había disparado el bug del `unique` plano de `usuario.login` (mismo problema que `20260826130000_perfil_nombre_baja_libera_nombre.sql` corrigió en `perfil.nombre`, T-08b). Por eso la migración vive en esta tarea, junto al primer `DELETE`, y no antes.

- [ ] **Step 1: Escribir la prueba pgTAP que falla**

Crea `supabase/tests/99_usuario_login_unicidad_test.sql` (mismo patrón que `98_perfil_baja_libera_nombre_test.sql`, T-08b):

```sql
begin;
select plan(3);

-- Nombres desechables con prefijo reservado, para no chocar con ningun
-- usuario real. `perfil_id` sale de un perfil sembrado real (T-05):
-- usuario.perfil_id es NOT NULL con referencia, no hay perfil desechable
-- como el 'ZZ-pgtap-Repartidor' de la prueba de perfil.
insert into usuario (login, password_hash, nombre, perfil_id)
  select 'zz-pgtap-jgarcia', 'x', 'Prueba', id
  from perfil where nombre = 'Auxiliar Administrativo';

select throws_ok(
  $$insert into usuario (login, password_hash, nombre, perfil_id)
    select 'zz-pgtap-jgarcia', 'x', 'Prueba 2', id
    from perfil where nombre = 'Auxiliar Administrativo'$$,
  '23505',
  null,
  'rechaza el mismo login repetido entre usuarios activos'
);

-- 'lower()' en el indice: dos filas que solo difieren en mayusculas son el
-- mismo login.
select throws_ok(
  $$insert into usuario (login, password_hash, nombre, perfil_id)
    select 'ZZ-PGTAP-JGARCIA', 'x', 'Prueba 3', id
    from perfil where nombre = 'Auxiliar Administrativo'$$,
  '23505',
  null,
  'trata distinta capitalizacion como duplicado'
);

-- La baja es logica (DELETE /usuarios/:id pone deleted_at, no borra la
-- fila). Sin el filtro 'where deleted_at is null' del indice, esto seguiria
-- lanzando 23505 y el login quedaria reservado para siempre.
update usuario set deleted_at = now() where login = 'zz-pgtap-jgarcia';

select lives_ok(
  $$insert into usuario (login, password_hash, nombre, perfil_id)
    select 'zz-pgtap-jgarcia', 'x', 'Prueba 4', id
    from perfil where nombre = 'Auxiliar Administrativo'$$,
  'dar de baja un usuario libera su login para uno nuevo'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
npm run supabase -- test db
```

Esperado: `99_usuario_login_unicidad_test.sql` **falla** en el segundo `throws_ok` (la capitalización distinta no choca todavía, porque hoy el `unique` es exacto, sin `lower()`) y en cualquier caso el índice nuevo no existe.

- [ ] **Step 3: Escribir la migración**

Crea `supabase/migrations/20260903130000_usuario_login_indice_parcial.sql`:

```sql
-- T-13 es el primer ticket que le da baja logica a un `usuario`
-- (DELETE /usuarios/:id). Mismo bug que 20260826130000 encontro y
-- corrigio en `perfil.nombre` (T-08b): un `unique` PLANO sigue contando
-- filas dadas de baja, asi que sin este cambio dar de baja a alguien con
-- login "jgarcia" reservaria ese login para siempre -- no hay ningun
-- camino en la UI para deshacerlo.
alter table usuario drop constraint usuario_login_key;

create unique index uq_usuario_login
  on usuario (lower(login))
  where deleted_at is null;
```

- [ ] **Step 4: Aplicar la migración y correr la prueba**

```bash
npm run supabase -- migration up --local
npm run supabase -- test db
```

Esperado: las 3 pruebas nuevas pasan, y el total pgTAP sube en 3 sobre tu total tras la Task 1.

- [ ] **Step 5: Confirmar que `db:types` no hace falta**

La migración solo cambia un `constraint` por un `index`, ninguna columna: `schema.d.ts` no cambia.

- [ ] **Step 6: Escribir el e2e que falla**

Agrega a `apps/backend/test/usuarios.e2e-spec.ts`, después de `describe('PATCH /usuarios/:id', ...)`:

```typescript
  describe('DELETE /usuarios/:id', () => {
    it('da de baja un usuario y libera su login (D1)', async () => {
      const login = `${PREFIJO}-baja`;
      const id = await crearUsuarioFixture(login, idPerfilAuxiliar, idTijuana);

      await request(app.getHttpServer())
        .delete(`/usuarios/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(200);

      const listado = await request(app.getHttpServer())
        .get('/usuarios')
        .set('Cookie', cookieGeneral)
        .expect(200);
      expect((listado.body as { id: string }[]).some((u) => u.id === id)).toBe(false);

      // D1: el login queda libre de inmediato para un alta nueva.
      const res = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieGeneral)
        .send({
          login,
          nombre: 'Reusa el login',
          contrasena: 'una-contrasena-larga',
          perfilId: idPerfilAuxiliar,
          sucursalId: idTijuana,
          permisosMarcados: [],
        })
        .expect(201);
      usuarioIds.push((res.body as { id: string }).id);
    });

    it('rechaza que un usuario se de de baja a si mismo', async () => {
      const login = `${PREFIJO}-autobaja`;
      const id = await crearUsuarioFixture(login, idPerfilAuxiliar, null);
      const cookiePropia = await iniciarSesion(login);

      await request(app.getHttpServer())
        .delete(`/usuarios/${id}`)
        .set('Cookie', cookiePropia)
        .expect(409);
    });

    it('rechaza dar de baja al ultimo Administrador General activo (D7)', async () => {
      const idUnico = await crearUsuarioFixture(`${PREFIJO}-unico-baja`, idPerfilMaestro, null);
      const cookieUnico = await iniciarSesion(`${PREFIJO}-unico-baja`);

      // Misma tecnica de ventana angosta que la prueba equivalente de
      // PATCH (D7): ver el comentario ahi.
      const otrosMaestrosActivos = await db
        .selectFrom('usuario')
        .select('id')
        .where('perfil_id', '=', idPerfilMaestro)
        .where('deleted_at', 'is', null)
        .where('id', '!=', idUnico)
        .execute();
      const idsOtros = otrosMaestrosActivos.map((f) => f.id);

      try {
        if (idsOtros.length > 0) {
          await db
            .updateTable('usuario')
            .set({ perfil_id: idPerfilAuxiliar })
            .where('id', 'in', idsOtros)
            .execute();
        }

        // La baja la pide OTRO usuario (cookieGeneral quedo temporalmente
        // sin perfil maestro): usa una cookie sin usuario.gestionar seria
        // 403 antes de llegar al 409, asi que se crea un tercer fixture
        // maestro exclusivo para hacer la peticion.
        const idSolicitante = await crearUsuarioFixture(
          `${PREFIJO}-solicitante-baja`,
          idPerfilMaestro,
          null,
        );
        const cookieSolicitante = await iniciarSesion(`${PREFIJO}-solicitante-baja`);
        idsOtros.push(idSolicitante);

        await request(app.getHttpServer())
          .delete(`/usuarios/${idUnico}`)
          .set('Cookie', cookieSolicitante)
          .expect(409);
        void cookieUnico;
      } finally {
        await db
          .updateTable('usuario')
          .set({ perfil_id: idPerfilMaestro })
          .where('id', 'in', idsOtros)
          .execute();
      }
    });

    it('un usuario atado a TJ no puede dar de baja a un usuario de MX', async () => {
      const id = await crearUsuarioFixture(`${PREFIJO}-baja-mx`, idPerfilAuxiliar, idMexicali);

      await request(app.getHttpServer())
        .delete(`/usuarios/${id}`)
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('responde 404 para un id que no existe', async () => {
      await request(app.getHttpServer())
        .delete('/usuarios/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieGeneral)
        .expect(404);
    });

    it('rechaza sin usuario.gestionar', async () => {
      const id = await crearUsuarioFixture(`${PREFIJO}-baja-sin-permiso`, idPerfilAuxiliar, null);

      await request(app.getHttpServer())
        .delete(`/usuarios/${id}`)
        .set('Cookie', cookieSinPermiso)
        .expect(403);
    });
  });
```

- [ ] **Step 7: Correr el e2e para verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend -- usuarios.e2e-spec
```

Esperado: FAIL — `Cannot DELETE /usuarios/:id` (404, la ruta no existe).

- [ ] **Step 8: Repositorio — `darDeBaja()`**

Agrega a `apps/backend/src/modules/auth/usuarios.repository.ts`, después de `contarActivosConPerfil()`:

```typescript
  async darDeBaja(id: string): Promise<void> {
    await this.db
      .updateTable('usuario')
      .set({ deleted_at: new Date() })
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  }
```

- [ ] **Step 9: Servicio — `eliminar()` con D7 completo**

Agrega a `apps/backend/src/modules/auth/usuarios.service.ts`:

```typescript
  async eliminar(usuarioId: string, id: string): Promise<void> {
    // D7: sin auto-baja, comprobado ANTES de tocar la base -- comparar
    // solo los ids evita una consulta de mas para el caso mas comun (nadie
    // se da de baja a si mismo por accidente sin intentarlo).
    if (id === usuarioId) {
      throw new ConflictException('No puedes dar de baja tu propio usuario.');
    }

    const actual = await this.repo.obtener(id);
    if (!actual) {
      throw new NotFoundException('No existe ese usuario.');
    }

    const alcance = await (async () => {
      const actor = await this.filaActor(usuarioId);
      return resolverAlcance(actor.codigo, null);
    })();
    this.exigirAlcanceSobreCodigo(alcance, actual.sucursalCodigo);

    if (esMaestro(actual.perfil)) {
      const activos = await this.repo.contarActivosConPerfil(actual.perfilId);
      if (activos <= 1) {
        throw new ConflictException('Debe quedar al menos un Administrador General activo.');
      }
    }

    await this.repo.darDeBaja(id);
  }
```

- [ ] **Step 10: Controller — `DELETE /usuarios/:id`**

Agrega a `apps/backend/src/modules/auth/usuarios.controller.ts`. Import nuevo:

```typescript
import { Delete } from '@nestjs/common';
```

(Fusiona con los imports ya existentes de `@nestjs/common`.)

Método:

```typescript
  @Delete(':id')
  async eliminar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.usuarios.eliminar(usuarioId, id);
    return { id };
  }
```

- [ ] **Step 11: Correr el e2e para verificar que pasa**

```bash
npm run test:e2e --workspace=apps/backend -- usuarios.e2e-spec
```

Esperado: PASS, 34 pruebas (28 de las Tasks 3-6 + 6 nuevas).

- [ ] **Step 12: Correr las cuatro suites completas**

```bash
npm run supabase -- test db
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
```

Esperado: pgTAP en tu línea base de la Task 0 + 4 (1 de la Task 1 + 3 de esta); e2e en tu línea base + 34; unit tests en tu línea base + 7 (`calcular-excepciones.spec.ts`, Task 2); lint y build limpios.

- [ ] **Step 13: Commit**

```bash
git add supabase/migrations/20260903130000_usuario_login_indice_parcial.sql \
        supabase/tests/99_usuario_login_unicidad_test.sql \
        apps/backend/src/modules/auth/usuarios.repository.ts \
        apps/backend/src/modules/auth/usuarios.service.ts \
        apps/backend/src/modules/auth/usuarios.controller.ts \
        apps/backend/test/usuarios.e2e-spec.ts
git commit -m "$(cat <<'EOF'
T-13 · DELETE /usuarios/:id + indice parcial de login (D1, D7)

Baja logica con las dos protecciones de D7: sin auto-baja, sin dejar
cero Administrador General activos. Descubierto al implementar el
primer DELETE de usuario: unique(login) era plano (T-05), mismo bug
que 20260826130000 corrigio en perfil.nombre -- sin el indice parcial,
dar de baja a alguien reservaria su login para siempre.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Vvvtzc2jmGPfo71vZDAeXW
EOF
)"
```

---

### Task 8: Portal — capa de datos (`lib/usuarios.ts`)

**Files:**
- Create: `apps/portal/src/lib/usuarios.ts`

**Interfaces:**
- Consumes: `apiFetch()` de `./api`.
- Produces: `UsuarioResumen`, `UsuarioDetalle`, `Permiso`, `PerfilConPermisos`, `CatalogoPerfiles`, `DatosUsuarioFormulario`, `listarUsuarios`, `obtenerUsuario`, `obtenerCatalogoPerfiles`, `crearUsuario`, `editarUsuario`, `eliminarUsuario` — consumidos por Tasks 9-11.

**Nota:** esta capa no tiene pruebas propias — mismo criterio que `lib/vehiculos.ts`/`lib/clientes.ts` (son "una copia normativa" del backend, sin lógica que valga la pena aislar; la cobertura real llega con las pruebas de pantalla de la Task 12, que mockean este módulo).

- [ ] **Step 1: Escribir `lib/usuarios.ts`**

Crea `apps/portal/src/lib/usuarios.ts`:

```typescript
import { apiFetch } from "./api";

// Copia normativa de las formas que devuelve
// apps/backend/src/modules/auth/usuarios.repository.ts y
// perfiles.service.ts (MatrizPerfiles) -- mismo trato que el resto de
// `lib/*.ts` (ver CLAUDE.md, T-07).
export interface UsuarioResumen {
  id: string;
  login: string;
  nombre: string;
  perfil: string;
  perfilId: string;
  sucursalCodigo: string | null;
}

export interface UsuarioDetalle extends UsuarioResumen {
  sucursalId: string | null;
  permisosEfectivos: string[];
}

export interface Permiso {
  id: string;
  clave: string;
  grupo: string;
  descripcion: string | null;
}

export interface PerfilConPermisos {
  id: string;
  nombre: string;
  esMaestro: boolean;
  permisos: string[];
}

export interface CatalogoPerfiles {
  permisos: Permiso[];
  perfiles: PerfilConPermisos[];
}

export function listarUsuarios(sucursal: string | null): Promise<UsuarioResumen[]> {
  const query = sucursal ? `?sucursal=${encodeURIComponent(sucursal)}` : "";
  return apiFetch<UsuarioResumen[]>(`/usuarios${query}`);
}

export function obtenerUsuario(id: string): Promise<UsuarioDetalle> {
  return apiFetch<UsuarioDetalle>(`/usuarios/${id}`);
}

export function obtenerCatalogoPerfiles(): Promise<CatalogoPerfiles> {
  return apiFetch<CatalogoPerfiles>("/usuarios/catalogo-perfiles");
}

/** Lo que arma el formulario de Usuario (Task 10), antes de decidir alta o edición. */
export interface DatosUsuarioFormulario {
  login: string;
  nombre: string;
  /**
   * D2 del spec: ausente = "no cambiar" en edición. `editarUsuario()` NO
   * debe recibir una cadena vacía aquí -- el formulario ya la convierte a
   * `undefined`, que `JSON.stringify` quita del cuerpo por completo.
   */
  contrasena?: string;
  perfilId: string;
  /** Solo presente cuando quien guarda es un actor General (D8). */
  sucursalId?: string;
  permisosMarcados: string[];
}

export function crearUsuario(
  datos: DatosUsuarioFormulario & { contrasena: string },
): Promise<UsuarioDetalle> {
  return apiFetch<UsuarioDetalle>("/usuarios", {
    method: "POST",
    body: JSON.stringify(datos),
  });
}

export function editarUsuario(
  id: string,
  datos: DatosUsuarioFormulario,
): Promise<UsuarioDetalle> {
  return apiFetch<UsuarioDetalle>(`/usuarios/${id}`, {
    method: "PATCH",
    body: JSON.stringify(datos),
  });
}

export function eliminarUsuario(id: string): Promise<void> {
  return apiFetch<void>(`/usuarios/${id}`, { method: "DELETE" });
}
```

- [ ] **Step 2: Verificar tipos**

```bash
npm run build --workspace=apps/portal
```

Esperado: build en verde — todavía no hay nada que importe este módulo, así que solo confirma que compila solo.

- [ ] **Step 3: Commit**

```bash
git add apps/portal/src/lib/usuarios.ts
git commit -m "$(cat <<'EOF'
T-13 · Capa de datos del portal para Usuarios

Copia normativa de las formas del backend, mismo trato que
lib/clientes.ts y lib/perfiles.ts. DatosUsuarioFormulario documenta
por que contrasena debe llegar como undefined (no "") cuando el
campo se deja en blanco al editar (D2).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Vvvtzc2jmGPfo71vZDAeXW
EOF
)"
```

---

### Task 9: Portal — `MatrizPermisosUsuario` (D3, D4, D9 del spec)

**Files:**
- Create: `apps/portal/src/components/usuarios/matriz-permisos-usuario.tsx`

**Interfaces:**
- Consumes: `type Permiso` de `@/lib/usuarios` (Task 8).
- Produces: `<MatrizPermisosUsuario catalogo marcados onCambiar disabled />`, consumido por `FormularioUsuario` (Task 10).

Sin pruebas propias — se cubre integrada dentro de la pantalla completa en la Task 12, mismo orden que T-09/T-10/T-11 siguieron antes de que existiera el patrón de pruebas de pantalla (T-65).

- [ ] **Step 1: Escribir el componente**

Crea `apps/portal/src/components/usuarios/matriz-permisos-usuario.tsx`:

```tsx
"use client";

import type { Permiso } from "@/lib/usuarios";

interface Props {
  /** Ya viene ordenado por grupo desde el backend (PerfilesRepository.catalogoPermisos, T-08b). */
  catalogo: Permiso[];
  marcados: Set<string>;
  onCambiar: (clave: string, marcado: boolean) => void;
  /** D4: perfil maestro elegido -- todo aparece marcado y sin poder tocarse. */
  disabled: boolean;
}

/**
 * D3 del spec: cada checkbox nace precargado con lo que da el perfil
 * elegido (el padre inicializa `marcados` así) y el administrador lo
 * cambia como cualquier checkbox normal -- sin un tercer estado "Hereda"
 * visible (decisión explícita de Roberto: un tercer estado confundiría).
 *
 * Etiqueta = clave (compacta -- unas ~25 filas en una lista dentro de un
 * formulario no tienen el espacio de columnas que sí tiene la tabla de
 * Perfiles y Permisos, T-08b) + ícono (i) con `descripcion` en el atributo
 * `title` nativo del navegador (D9): sin dependencia nueva de tooltip.
 */
export function MatrizPermisosUsuario({ catalogo, marcados, onCambiar, disabled }: Props) {
  // Set preserva el orden de insercion: como `catalogo` ya viene agrupado
  // por `grupo` desde el backend, esto no reordena nada, solo enumera los
  // grupos una vez cada uno.
  const grupos = [...new Set(catalogo.map((p) => p.grupo))];

  return (
    <div className="flex flex-col gap-4">
      {grupos.map((grupo) => (
        <div key={grupo}>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">{grupo}</p>
          <div className="flex flex-col gap-1">
            {catalogo
              .filter((p) => p.grupo === grupo)
              .map((permiso) => (
                <label key={permiso.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={disabled ? true : marcados.has(permiso.clave)}
                    onChange={(e) => onCambiar(permiso.clave, e.target.checked)}
                  />
                  <span className="font-mono">{permiso.clave}</span>
                  {permiso.descripcion && (
                    <span
                      title={permiso.descripcion}
                      aria-label={permiso.descripcion}
                      className="cursor-help text-muted-foreground"
                    >
                      ⓘ
                    </span>
                  )}
                </label>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

```bash
npm run build --workspace=apps/portal
```

Esperado: build en verde. El componente no está montado en ninguna pantalla todavía (llega en la Task 10), así que esto solo confirma que compila.

- [ ] **Step 3: Commit**

```bash
git add apps/portal/src/components/usuarios/matriz-permisos-usuario.tsx
git commit -m "$(cat <<'EOF'
T-13 · MatrizPermisosUsuario: checkboxes con tooltip nativo (D3, D9)

Checkbox normal por permiso, precargado desde fuera segun el perfil
elegido -- sin un tercer estado "Hereda" (decision explicita: confundiria
al administrador). Icono con `title` nativo para la descripcion, sin
dependencia nueva de tooltip.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Vvvtzc2jmGPfo71vZDAeXW
EOF
)"
```

---

### Task 10: Portal — `FormularioUsuario` (todas las secciones) (D2, D3, D4, D8 del spec)

**Files:**
- Create: `apps/portal/src/components/usuarios/formulario-usuario.tsx`

**Interfaces:**
- Consumes: `MatrizPermisosUsuario` (Task 9); `useEnvioFormulario` de `@/components/catalogo/use-envio-formulario`; `useAuth` de `@/components/auth/auth-provider`; `listarSucursales`/`type Sucursal` de `@/lib/sucursales`; `crearUsuario`/`editarUsuario`/`obtenerCatalogoPerfiles`/tipos de `@/lib/usuarios` (Task 8).
- Produces: `<FormularioUsuario usuario alGuardar alCancelar />`, consumido por `PantallaUsuarios` (Task 11).

Esta tarea no escribe pruebas propias (la pantalla completa se prueba en la Task 12, montando este formulario dentro).

- [ ] **Step 1: Escribir el componente**

Crea `apps/portal/src/components/usuarios/formulario-usuario.tsx`:

```tsx
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import {
  crearUsuario,
  editarUsuario,
  obtenerCatalogoPerfiles,
  type CatalogoPerfiles,
  type UsuarioDetalle,
} from "@/lib/usuarios";
import { MatrizPermisosUsuario } from "./matriz-permisos-usuario";

interface Props {
  /** El usuario a editar, o null para dar de alta uno nuevo. */
  usuario: UsuarioDetalle | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

export function FormularioUsuario({ usuario, alGuardar, alCancelar }: Props) {
  const { usuario: sesion } = useAuth();
  const esAlta = usuario === null;

  // D8 del spec: a diferencia de FormularioCliente (T-12, D6) y
  // FormularioVehiculo (T-11, D3), aqui el selector de sucursal aplica
  // TAMBIEN en edicion -- la sucursal de un Usuario no es inmutable.
  const eligeSucursal = sesion !== null && sesion.sucursal === null;

  const [login, setLogin] = useState(usuario?.login ?? "");
  const [nombre, setNombre] = useState(usuario?.nombre ?? "");
  const [contrasena, setContrasena] = useState("");
  const [perfilId, setPerfilId] = useState(usuario?.perfilId ?? "");
  const [sucursalId, setSucursalId] = useState(usuario?.sucursalId ?? "");
  const [marcados, setMarcados] = useState<Set<string>>(
    () => new Set(usuario?.permisosEfectivos ?? []),
  );

  const [catalogo, setCatalogo] = useState<CatalogoPerfiles | null>(null);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo guardar el usuario.");

  useEffect(() => {
    let vigente = true;
    obtenerCatalogoPerfiles()
      .then((c) => {
        if (vigente) setCatalogo(c);
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, []);

  useEffect(() => {
    if (!eligeSucursal) return;
    let vigente = true;
    listarSucursales()
      .then((lista) => {
        if (vigente) setSucursales(lista.filter((s) => s.activa));
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [eligeSucursal]);

  const perfilElegido = catalogo?.perfiles.find((p) => p.id === perfilId) ?? null;

  /**
   * D3 del spec: cambiar de perfil reinicia la matriz a lo que ESE perfil
   * da por default -- pisa `marcados` solo cuando el administrador de
   * verdad elige un perfil distinto (no en cada render: `marcados` nace ya
   * inicializado desde `usuario.permisosEfectivos` en edicion).
   */
  function alElegirPerfil(nuevoId: string) {
    setPerfilId(nuevoId);
    const nuevo = catalogo?.perfiles.find((p) => p.id === nuevoId);
    if (nuevo) {
      setMarcados(new Set(nuevo.permisos));
    }
  }

  function alCambiarPermiso(clave: string, marcado: boolean) {
    setMarcados((previos) => {
      const copia = new Set(previos);
      if (marcado) {
        copia.add(clave);
      } else {
        copia.delete(clave);
      }
      return copia;
    });
  }

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();

    const datos = {
      login,
      nombre,
      perfilId,
      permisosMarcados: Array.from(marcados),
      ...(eligeSucursal ? { sucursalId: sucursalId === "" ? undefined : sucursalId } : {}),
    };

    await enviar(
      () =>
        usuario
          ? editarUsuario(usuario.id, {
              ...datos,
              // D2: vacio u omitido = "no cambiar" -- JSON.stringify quita
              // las claves en `undefined`, asi que el backend nunca la ve.
              contrasena: contrasena.trim() === "" ? undefined : contrasena,
            })
          : crearUsuario({ ...datos, contrasena }),
      alGuardar,
    );
  }

  if (!catalogo) {
    return <p className="text-muted-foreground">Cargando…</p>;
  }

  return (
    <form onSubmit={alEnviar} className="mb-6 flex flex-col gap-6 rounded-md border p-4">
      <h2 className="text-sm font-semibold">
        {esAlta ? "Nuevo usuario" : `Editar ${usuario.nombre}`}
      </h2>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Datos básicos
        </legend>
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="login" className="text-sm font-medium">
              Login
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
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="nombre" className="text-sm font-medium">
              Nombre
            </label>
            <input
              id="nombre"
              required
              maxLength={120}
              disabled={enviando}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Contraseña
        </legend>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="contrasena" className="text-sm font-medium">
            {esAlta ? "Contraseña" : "Nueva contraseña (déjalo en blanco para no cambiarla)"}
          </label>
          <input
            id="contrasena"
            type="password"
            required={esAlta}
            minLength={8}
            maxLength={200}
            disabled={enviando}
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
            className="w-64 rounded-md border px-3 py-2 text-sm"
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Perfil y sucursal
        </legend>
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="perfil" className="text-sm font-medium">
              Perfil
            </label>
            <select
              id="perfil"
              required
              disabled={enviando}
              value={perfilId}
              onChange={(e) => alElegirPerfil(e.target.value)}
              className="w-56 rounded-md border px-3 py-2 text-sm"
            >
              <option value="">Elige un perfil…</option>
              {catalogo.perfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
          {eligeSucursal ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sucursal" className="text-sm font-medium">
                Sucursal
              </label>
              <select
                id="sucursal"
                disabled={enviando}
                value={sucursalId}
                onChange={(e) => setSucursalId(e.target.value)}
                className="w-48 rounded-md border px-3 py-2 text-sm"
              >
                <option value="">General (todas)</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.codigo} — {s.nombre}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="self-end text-sm text-muted-foreground">
              Sucursal: {sesion?.sucursal?.codigo ?? "General"}
            </p>
          )}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Permisos
        </legend>
        {perfilElegido ? (
          <MatrizPermisosUsuario
            catalogo={catalogo.permisos}
            marcados={marcados}
            onCambiar={alCambiarPermiso}
            disabled={perfilElegido.esMaestro}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Elige un perfil para configurar sus permisos.
          </p>
        )}
      </fieldset>

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

- [ ] **Step 2: Verificar tipos**

```bash
npm run build --workspace=apps/portal
```

Esperado: build en verde. El componente no está montado en ninguna pantalla todavía (llega en la Task 11), así que esto solo confirma que compila.

- [ ] **Step 3: Commit**

```bash
git add apps/portal/src/components/usuarios/formulario-usuario.tsx
git commit -m "$(cat <<'EOF'
T-13 · FormularioUsuario: secciones + matriz de permisos (D2, D3, D4, D8)

Contrasena obligatoria en alta, opcional en edicion (D2). Elegir un
perfil nuevo reinicia la matriz a sus permisos por default (D3); el
perfil maestro la deja fija y sin editar (D4). Selector de sucursal
solo para un actor General, en alta Y edicion (D8, a diferencia de
Cliente/Vehiculo).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Vvvtzc2jmGPfo71vZDAeXW
EOF
)"
```

---

### Task 11: Portal — `PantallaUsuarios` + `page.tsx` (D6 del spec)

**Files:**
- Create: `apps/portal/src/components/usuarios/pantalla-usuarios.tsx`
- Modify: `apps/portal/src/app/(portal)/catalogo/usuarios/page.tsx`

**Interfaces:**
- Consumes: `FormularioUsuario` (Task 10); `useAuth` de `@/components/auth/auth-provider`; `useCatalogo` de `@/components/catalogo/use-catalogo`; `TablaCatalogo` de `@/components/catalogo/tabla-catalogo`; `ErrorApi` de `@/lib/api`; `listarUsuarios`/`obtenerUsuario`/`eliminarUsuario`/tipos de `@/lib/usuarios` (Task 8).
- Produces: `<PantallaUsuarios sucursal />`, montado por `page.tsx`.

Esta tarea no escribe pruebas propias — llegan en la Task 12.

- [ ] **Step 1: Escribir `PantallaUsuarios`**

Crea `apps/portal/src/components/usuarios/pantalla-usuarios.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { useCatalogo } from "@/components/catalogo/use-catalogo";
import { TablaCatalogo } from "@/components/catalogo/tabla-catalogo";
import { ErrorApi } from "@/lib/api";
import {
  eliminarUsuario,
  listarUsuarios,
  obtenerUsuario,
  type UsuarioDetalle,
  type UsuarioResumen,
} from "@/lib/usuarios";
import { FormularioUsuario } from "./formulario-usuario";

type Edicion = "nueva" | UsuarioDetalle | null;

function TarjetaMensaje({ mensaje }: { mensaje: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usuarios</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">{mensaje}</p>
      </CardContent>
    </Card>
  );
}

/**
 * D6 del spec: usuario.gestionar gatea tambien la LECTURA, igual que
 * PantallaPerfiles (T-08b) -- ni siquiera se intenta el GET sin el
 * permiso, se espera a que la sesion termine de cargar antes de decidir
 * (mismo motivo documentado ahi: `puede()` da `false` de entrada mientras
 * `usuario` sigue en null).
 */
export function PantallaUsuarios({ sucursal }: { sucursal: string | null }) {
  const { puede, cargando: cargandoSesion } = useAuth();

  if (cargandoSesion) {
    return <TarjetaMensaje mensaje="Cargando…" />;
  }
  if (!puede("usuario.gestionar")) {
    return <TarjetaMensaje mensaje="No tienes permiso para ver esta sección." />;
  }
  return <Tabla sucursal={sucursal} />;
}

/**
 * Sin `puede()` por boton (a diferencia de PantallaClientes): la pantalla
 * ENTERA ya exige usuario.gestionar arriba, asi que si `Tabla` se esta
 * renderizando es porque quien mira ya puede gestionar -- mismo criterio
 * que PantallaPerfiles (T-08b).
 */
function Tabla({ sucursal }: { sucursal: string | null }) {
  const catalogo = useCatalogo<UsuarioResumen>(() => listarUsuarios(sucursal), {
    mensajeError: "No se pudieron cargar los usuarios.",
    deps: [sucursal],
  });

  const [edicion, setEdicion] = useState<Edicion>(null);
  const [cargandoDetalleId, setCargandoDetalleId] = useState<string | null>(null);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);
  const enCurso = edicion !== null || cargandoDetalleId !== null || eliminandoId !== null;

  async function abrirEdicion(resumen: UsuarioResumen) {
    setCargandoDetalleId(resumen.id);
    setErrorDetalle(null);
    try {
      setEdicion(await obtenerUsuario(resumen.id));
    } catch {
      setErrorDetalle("No se pudo cargar el detalle de ese usuario.");
    } finally {
      setCargandoDetalleId(null);
    }
  }

  function cerrar() {
    setEdicion(null);
  }

  function alGuardar() {
    cerrar();
    void catalogo.recargar();
  }

  async function eliminar(item: UsuarioResumen) {
    if (!window.confirm(`¿Dar de baja a "${item.nombre}"?`)) return;
    setEliminandoId(item.id);
    setErrorDetalle(null);
    try {
      await eliminarUsuario(item.id);
      void catalogo.recargar();
    } catch (err) {
      // A diferencia de PantallaClientes: aqui SI vale la pena mostrar el
      // mensaje exacto del servidor (ErrorApi.mensajeApi) -- las dos
      // protecciones de D7 ("no puedes dar de baja tu propio usuario",
      // "debe quedar al menos un Administrador General activo") son
      // exactamente el tipo de error que solo el servidor sabe explicar
      // (doc de ErrorApi en lib/api.ts).
      setErrorDetalle(
        err instanceof ErrorApi && err.mensajeApi
          ? err.mensajeApi
          : "No se pudo dar de baja ese usuario.",
      );
    } finally {
      setEliminandoId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Usuarios</CardTitle>
        <Button size="sm" disabled={enCurso} onClick={() => setEdicion("nueva")}>
          Nuevo usuario
        </Button>
      </CardHeader>

      <CardContent>
        {edicion !== null && (
          <div key={edicion === "nueva" ? "nueva" : edicion.id}>
            <FormularioUsuario
              usuario={edicion === "nueva" ? null : edicion}
              alGuardar={alGuardar}
              alCancelar={cerrar}
            />
          </div>
        )}

        {errorDetalle && (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {errorDetalle}
          </p>
        )}

        {catalogo.cargando && <p className="text-muted-foreground">Cargando…</p>}
        {catalogo.error && (
          <p role="alert" className="text-sm text-destructive">
            {catalogo.error}
          </p>
        )}

        {!catalogo.cargando && !catalogo.error && (
          <TablaCatalogo
            items={catalogo.items}
            vacio="No hay usuarios que mostrar."
            columnas={[
              { encabezado: "Login", celda: (u) => u.login },
              { encabezado: "Nombre", celda: (u) => u.nombre },
              { encabezado: "Perfil", celda: (u) => u.perfil },
              {
                encabezado: "Sucursal",
                celda: (u) => u.sucursalCodigo ?? "General",
                className: "font-mono",
              },
            ]}
            acciones={(u) => (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={enCurso}
                  onClick={() => void abrirEdicion(u)}
                >
                  {cargandoDetalleId === u.id ? "Cargando…" : "Editar"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={enCurso}
                  onClick={() => void eliminar(u)}
                >
                  {eliminandoId === u.id ? "Eliminando…" : "Eliminar"}
                </Button>
              </div>
            )}
          />
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Reemplazar el placeholder de `page.tsx`**

Reemplaza `apps/portal/src/app/(portal)/catalogo/usuarios/page.tsx` completo:

```tsx
import { PantallaUsuarios } from "@/components/usuarios/pantalla-usuarios";

// Next 15: `searchParams` es una promesa (mismo patron que T-11/T-12).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaUsuarios sucursal={sucursal ?? null} />;
}
```

- [ ] **Step 3: Verificar tipos y build**

```bash
npm run build --workspace=apps/portal
```

Esperado: build en verde.

- [ ] **Step 4: Verificación manual (Playwright, Postgres local)**

Con el backend apuntando a Postgres **local** (nunca `sinmex dev`), navega a `/catalogo/usuarios` con una sesión con `usuario.gestionar` y confirma: la tabla carga, "Nuevo usuario" abre el formulario, el desplegable de Perfil trae los 6 perfiles semilla, elegir uno pinta la matriz de permisos ya marcada según ese perfil, y elegir "Administrador General" la deja fija con todo marcado.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/components/usuarios/pantalla-usuarios.tsx \
        "apps/portal/src/app/(portal)/catalogo/usuarios/page.tsx"
git commit -m "$(cat <<'EOF'
T-13 · PantallaUsuarios + page.tsx (D6)

La pantalla completa exige usuario.gestionar ANTES del primer GET,
igual que PantallaPerfiles (T-08b) -- ni la tabla ni los botones de
accion aparecen sin el permiso. La baja usa ErrorApi.mensajeApi para
mostrar el motivo exacto de un 409 (autobaja, ultimo Administrador
General), a diferencia de PantallaClientes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Vvvtzc2jmGPfo71vZDAeXW
EOF
)"
```

---

### Task 12: Portal — pruebas de pantalla (patrón T-65)

**Files:**
- Create: `apps/portal/src/components/usuarios/pantalla-usuarios.test.tsx`

**Interfaces:**
- Consumes: todo lo de las Tasks 8-11.
- Produces: nada — es la hoja del árbol de este plan.

- [ ] **Step 1: Escribir las pruebas**

Crea `apps/portal/src/components/usuarios/pantalla-usuarios.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi, type UsuarioSesion } from "@/lib/api";
import { useAuth } from "@/components/auth/auth-provider";
import * as usuariosLib from "@/lib/usuarios";
import type { CatalogoPerfiles, UsuarioDetalle, UsuarioResumen } from "@/lib/usuarios";
import * as sucursalesLib from "@/lib/sucursales";
import { PantallaUsuarios } from "./pantalla-usuarios";

// Mismo limite que pantalla-clientes.test.tsx (T-12) y pantalla-sucursales.test.tsx
// (T-65): se mockea la capa de red (lib/*.ts), no apiFetch. AuthProvider
// tambien se mockea porque su propia carga de sesion es un problema aparte
// de esta pantalla.
vi.mock("@/lib/usuarios");
vi.mock("@/lib/sucursales");
vi.mock("@/components/auth/auth-provider");

const listarUsuarios = vi.mocked(usuariosLib.listarUsuarios);
const obtenerUsuario = vi.mocked(usuariosLib.obtenerUsuario);
const obtenerCatalogoPerfiles = vi.mocked(usuariosLib.obtenerCatalogoPerfiles);
const crearUsuario = vi.mocked(usuariosLib.crearUsuario);
const editarUsuario = vi.mocked(usuariosLib.editarUsuario);
const eliminarUsuario = vi.mocked(usuariosLib.eliminarUsuario);
const usarAuthMock = vi.mocked(useAuth);

const SESION_GENERAL: UsuarioSesion = {
  id: "sesion-1",
  login: "admin",
  nombre: "Admin",
  perfil: "Administrador General",
  sucursal: null,
  permisos: ["usuario.gestionar"],
};

function mockAuth(puede: (clave: string) => boolean, usuario: UsuarioSesion | null = SESION_GENERAL) {
  usarAuthMock.mockReturnValue({
    usuario,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede,
  });
}

const AUXILIAR_ID = "perfil-auxiliar";
const MAESTRO_ID = "perfil-maestro";

const CATALOGO: CatalogoPerfiles = {
  permisos: [
    { id: "p1", clave: "cliente.gestionar", grupo: "Operacion Comercial", descripcion: "Registrar/editar/eliminar clientes" },
    { id: "p2", clave: "vendedor.gestionar", grupo: "Operacion Comercial", descripcion: "Registrar/editar/eliminar vendedores" },
  ],
  perfiles: [
    { id: AUXILIAR_ID, nombre: "Auxiliar Administrativo", esMaestro: false, permisos: ["cliente.gestionar"] },
    { id: MAESTRO_ID, nombre: "Administrador General", esMaestro: true, permisos: ["cliente.gestionar", "vendedor.gestionar"] },
  ],
};

const RESUMEN: UsuarioResumen = {
  id: "1",
  login: "jgarcia",
  nombre: "Juan García",
  perfil: "Auxiliar Administrativo",
  perfilId: AUXILIAR_ID,
  sucursalCodigo: "TJ",
};

const DETALLE: UsuarioDetalle = {
  ...RESUMEN,
  sucursalId: "suc-1",
  permisosEfectivos: ["cliente.gestionar"],
};

describe("PantallaUsuarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    obtenerCatalogoPerfiles.mockResolvedValue(CATALOGO);
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue([
      { id: "suc-1", codigo: "TJ", nombre: "Tijuana", activa: true },
    ]);
  });

  it("muestra el mensaje de permiso y NO llama a la API sin usuario.gestionar (D6)", async () => {
    mockAuth(() => false);

    render(<PantallaUsuarios sucursal={null} />);

    expect(
      await screen.findByText("No tienes permiso para ver esta sección."),
    ).toBeInTheDocument();
    expect(listarUsuarios).not.toHaveBeenCalled();
  });

  it("muestra los usuarios cargados y permite dar de alta cuando el usuario puede gestionar", async () => {
    mockAuth(() => true);
    listarUsuarios.mockResolvedValue([RESUMEN]);

    render(<PantallaUsuarios sucursal={null} />);

    expect(await screen.findByText("jgarcia")).toBeInTheDocument();
    expect(screen.getByText("Auxiliar Administrativo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo usuario" })).toBeInTheDocument();
  });

  it("muestra el mensaje de error cuando la carga falla", async () => {
    mockAuth(() => true);
    listarUsuarios.mockRejectedValue(new Error("red caida"));

    render(<PantallaUsuarios sucursal={null} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron cargar los usuarios.",
    );
  });

  it("da de alta un usuario nuevo con permisos marcados segun el perfil elegido", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarUsuarios.mockResolvedValueOnce([]);
    crearUsuario.mockResolvedValue(DETALLE);
    listarUsuarios.mockResolvedValueOnce([RESUMEN]);

    render(<PantallaUsuarios sucursal={null} />);
    await screen.findByText("No hay usuarios que mostrar.");

    await usuario.click(screen.getByRole("button", { name: "Nuevo usuario" }));
    await usuario.type(screen.getByLabelText("Login"), "jgarcia");
    await usuario.type(screen.getByLabelText("Nombre"), "Juan García");
    await usuario.type(screen.getByLabelText("Contraseña"), "una-contrasena-larga");
    await usuario.selectOptions(screen.getByLabelText("Perfil"), AUXILIAR_ID);

    // El perfil Auxiliar solo da cliente.gestionar (CATALOGO): esa casilla
    // nace marcada, vendedor.gestionar no.
    expect(screen.getByRole("checkbox", { name: /cliente\.gestionar/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /vendedor\.gestionar/ })).not.toBeChecked();

    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(crearUsuario).toHaveBeenCalled());
    const payload = crearUsuario.mock.calls[0][0];
    expect(payload.login).toBe("jgarcia");
    expect(payload.perfilId).toBe(AUXILIAR_ID);
    expect(payload.permisosMarcados).toEqual(["cliente.gestionar"]);

    expect(await screen.findByText("jgarcia")).toBeInTheDocument();
  });

  it("elegir el perfil maestro deja la matriz marcada por completo y deshabilitada (D4)", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarUsuarios.mockResolvedValue([]);

    render(<PantallaUsuarios sucursal={null} />);
    await screen.findByText("No hay usuarios que mostrar.");
    await usuario.click(screen.getByRole("button", { name: "Nuevo usuario" }));

    await usuario.selectOptions(screen.getByLabelText("Perfil"), MAESTRO_ID);

    const casillaCliente = screen.getByRole("checkbox", { name: /cliente\.gestionar/ });
    const casillaVendedor = screen.getByRole("checkbox", { name: /vendedor\.gestionar/ });
    expect(casillaCliente).toBeChecked();
    expect(casillaVendedor).toBeChecked();
    expect(casillaCliente).toBeDisabled();
    expect(casillaVendedor).toBeDisabled();
  });

  it("edita un usuario existente precargando su detalle y sus permisos efectivos", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarUsuarios.mockResolvedValueOnce([RESUMEN]);
    obtenerUsuario.mockResolvedValue(DETALLE);
    editarUsuario.mockResolvedValue({ ...DETALLE, nombre: "Juan García López" });
    listarUsuarios.mockResolvedValueOnce([{ ...RESUMEN, nombre: "Juan García López" }]);

    render(<PantallaUsuarios sucursal={null} />);
    await screen.findByText("jgarcia");

    await usuario.click(screen.getByRole("button", { name: "Editar" }));
    await waitFor(() => expect(obtenerUsuario).toHaveBeenCalledWith("1"));

    // permisosEfectivos de DETALLE es solo ["cliente.gestionar"]: la
    // matriz se precarga con eso, no con lo que da el perfil.
    expect(await screen.findByRole("checkbox", { name: /cliente\.gestionar/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /vendedor\.gestionar/ })).not.toBeChecked();

    // El campo de contrasena existe pero se deja vacio -- no debe viajar.
    const campoContrasena = screen.getByLabelText(
      "Nueva contraseña (déjalo en blanco para no cambiarla)",
    );
    expect(campoContrasena).toHaveValue("");

    const campoNombre = screen.getByLabelText("Nombre");
    await usuario.clear(campoNombre);
    await usuario.type(campoNombre, "Juan García López");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(editarUsuario).toHaveBeenCalledWith("1", expect.anything()));
    const payload = editarUsuario.mock.calls[0][1];
    expect(payload.contrasena).toBeUndefined();
    expect(await screen.findByText("Juan García López")).toBeInTheDocument();
  });

  it("da de baja un usuario tras confirmar, y recarga la lista", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    listarUsuarios.mockResolvedValueOnce([RESUMEN]);
    eliminarUsuario.mockResolvedValue(undefined);
    listarUsuarios.mockResolvedValueOnce([]);

    render(<PantallaUsuarios sucursal={null} />);
    await screen.findByText("jgarcia");

    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(eliminarUsuario).toHaveBeenCalledWith("1"));
    expect(await screen.findByText("No hay usuarios que mostrar.")).toBeInTheDocument();
  });

  it("no llama a eliminarUsuario si el usuario cancela la confirmacion", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    listarUsuarios.mockResolvedValue([RESUMEN]);

    render(<PantallaUsuarios sucursal={null} />);
    await screen.findByText("jgarcia");

    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(eliminarUsuario).not.toHaveBeenCalled();
  });

  it("muestra el mensaje exacto del servidor cuando la baja choca con una proteccion de D7", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    listarUsuarios.mockResolvedValue([RESUMEN]);
    eliminarUsuario.mockRejectedValue(
      new ErrorApi("fallo", 409, "Debe quedar al menos un Administrador General activo."),
    );

    render(<PantallaUsuarios sucursal={null} />);
    await screen.findByText("jgarcia");

    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Debe quedar al menos un Administrador General activo.",
    );
  });

  it("un actor atado a una sucursal no ve el selector de sucursal en el formulario (D8)", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true, {
      ...SESION_GENERAL,
      sucursal: { id: "suc-1", codigo: "TJ", nombre: "Tijuana" },
    });
    listarUsuarios.mockResolvedValue([]);

    render(<PantallaUsuarios sucursal={null} />);
    await screen.findByText("No hay usuarios que mostrar.");
    await usuario.click(screen.getByRole("button", { name: "Nuevo usuario" }));

    expect(screen.queryByLabelText("Sucursal")).not.toBeInTheDocument();
    expect(screen.getByText("Sucursal: TJ")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr las pruebas para verificar que pasan**

```bash
npm test --workspace=apps/portal -- pantalla-usuarios
```

Esperado: PASS, 10 pruebas.

- [ ] **Step 3: Correr la suite completa del portal**

```bash
npm test --workspace=apps/portal
```

Esperado: tu línea base de la Task 0 + 10.

- [ ] **Step 4: Lint y build**

```bash
npm run lint --workspace=apps/portal
npm run build --workspace=apps/portal
```

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/components/usuarios/pantalla-usuarios.test.tsx
git commit -m "$(cat <<'EOF'
T-13 · Pruebas de pantalla de Usuarios (patron T-65)

Cubre D6 (sin permiso no llama a la API), D3/D4 (la matriz se
precarga segun el perfil elegido o los permisos efectivos en
edicion, y el maestro la deja fija), D2 (la contrasena vacia no
viaja en la edicion) y D8 (sin selector de sucursal para un actor
atado). El 409 de D7 se prueba en la pantalla mostrando el mensaje
exacto del servidor.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Vvvtzc2jmGPfo71vZDAeXW
EOF
)"
```

---

### Task 13: Cierre — vault y PR

**Files:**
- Modify (en `../jawa-obsidian-memory`): `10-Dominio/Entidades/Usuario.md`, `00-Inicio/Estado del proyecto.md`

**Interfaces:** ninguna — tarea de documentación y entrega.

- [ ] **Step 1: Aplicar las migraciones a `sinmex dev` (verificado, no supuesto)**

Mismo protocolo que T-10/T-11/T-12/T-18: confirmar el estado remoto con `supabase migration list` antes de asumir nada.

```bash
npm run supabase -- migration list
```

Si `20260903120000_permiso_usuario_gestionar` o `20260903130000_usuario_login_indice_parcial` no aparecen en la columna `remote`:

```bash
npm run supabase -- db push
npm run supabase -- migration list
```

Esperado: las dos migraciones aparecen en `local` y `remote` por igual.

- [ ] **Step 2: Correr las cuatro suites una última vez, todas contra el mismo commit**

```bash
npm run supabase -- test db
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm test --workspace=apps/portal
npm run lint --workspace=apps/backend
npm run lint --workspace=apps/portal
npm run build --workspace=apps/backend
npm run build --workspace=apps/portal
```

Esperado: las ocho en verde.

- [ ] **Step 3: Actualizar `10-Dominio/Entidades/Usuario.md` en el vault**

Abre `../jawa-obsidian-memory/10-Dominio/Entidades/Usuario.md` y, en la sección "Notas de implementación", agrega (sin borrar lo existente, que sigue siendo cierto):

```markdown
> [!success] Implementado en T-13 (2026-09-03)
> - **CRUD completo desde `/catalogo/usuarios`**: login, nombre, contraseña
>   (obligatoria en el alta, opcional al editar — vacío significa "no
>   cambiarla"), perfil, sucursal (o "General") y overrides de permisos por
>   excepción.
> - **El override se representa en la interfaz como un checkbox normal**,
>   precargado con lo que da el perfil elegido — sin un tercer estado
>   "Hereda" visible. El backend calcula la diferencia contra el perfil y
>   solo guarda en `usuario_permiso` lo que quedó distinto.
> - **`usuario.gestionar` gatea también la lectura** (a diferencia de
>   Productos/Vehículos/Clientes): el login y los permisos de otros
>   usuarios son información sensible.
> - **Protecciones**: nadie puede darse de baja a sí mismo, y no se puede
>   quedar el sistema sin ningún `Administrador General` activo (bloquea
>   tanto la baja como el cambio de perfil).
> - **Bug corregido**: `usuario.login` tenía un `unique` plano que no
>   liberaba el login al dar de baja a alguien (mismo problema que
>   `perfil.nombre` tuvo hasta T-08b) — ahora es un índice parcial.

> [!info] Vendedores siguen aparte
> Esta pantalla es solo para el `Usuario` del portal. El alta de
> `Vendedor` es T-62, con su propia decisión pendiente (desambiguación de
> iniciales del folio, `ADR-0007`).
```

Actualiza también `actualizado:` en el frontmatter a `2026-09-03`, y quita el bloque `[!warning] Sin comprobación de permisos todavía` si sigue ahí (quedó obsoleto desde T-08a/T-08b).

- [ ] **Step 4: Actualizar `00-Inicio/Estado del proyecto.md`**

En la tabla de issues, cambia la fila de T-13 a:

```markdown
| T-13 | Gestión de Usuarios (CRUD + asignación de permisos) | ✅ Hecho (2026-09-03) — PR abierto, ver detalle abajo |
```

Agrega un bloque de detalle "T-13 — detalle de lo hecho" siguiendo el formato de los bloques de T-10/T-11/T-12/T-18 ya existentes: qué se construyó, el hallazgo del `unique` plano de `usuario.login` (D1), la decisión de representar los overrides como checkbox de estado final sin un tercer estado (D3), y los conteos reales de pruebas que anotaste en cada tarea de este plan (no los que aparecen en este documento — este plan no los hardcodeó a propósito, ver Global Constraints).

Actualiza `actualizado:` a `2026-09-03` y revisa la fila de "Próximos pasos": con T-13 hecho, T-62 (Vendedores) sigue siendo el único catálogo del portal que falta, y sigue esperando la misma decisión pendiente de siempre (`ADR-0007`) — sin relación con este ticket.

- [ ] **Step 5: Commit del vault**

```bash
cd ../jawa-obsidian-memory
git add "10-Dominio/Entidades/Usuario.md" "00-Inicio/Estado del proyecto.md"
git commit -m "T-13: Gestión de Usuarios implementada — actualiza Usuario.md y Estado del proyecto"
git push
cd -
```

- [ ] **Step 6: Push y Pull Request del código**

```bash
git push -u origin feature/t-13-gestion-usuarios
gh pr create --title "T-13 · Gestión de Usuarios (CRUD + asignación de permisos)" --body "$(cat <<'EOF'
## Resumen
- CRUD completo de usuarios del portal: login, contraseña (obligatoria en alta, opcional en edición), perfil, sucursal (o "General") y overrides de permisos por excepción.
- Los overrides se editan como checkboxes de estado final, precargados según el perfil elegido — sin un tercer estado "Hereda" visible; el backend calcula la diferencia.
- `usuario.gestionar` gatea los seis endpoints, lectura incluida.
- Protecciones: sin auto-baja, y no se puede dejar el sistema sin ningún Administrador General activo (bloquea baja y cambio de perfil).

## Decisiones (ver el spec para el detalle)
- D1: `usuario.login` pasa de `unique` plano a índice parcial (bug descubierto al implementar el primer `DELETE` de usuario).
- D2: contraseña obligatoria en alta, opcional en edición.
- D3: overrides como checkbox de estado final, no una lista de excepciones.
- D4: el perfil maestro deja la matriz fija, sin escritura.
- D5: `GET /usuarios/catalogo-perfiles` reutiliza `PerfilesService.obtenerMatriz()` sin exigir `perfil.gestionar`.
- D6: `usuario.gestionar` gatea también la lectura.
- D7: protecciones de auto-baja y último Administrador General activo.
- D8: la sucursal de un Usuario SÍ es editable (a diferencia de Cliente/Vehículo).

## Test plan
- [ ] `npm run supabase -- test db`
- [ ] `npm test --workspace=apps/backend`
- [ ] `npm run test:e2e --workspace=apps/backend`
- [ ] `npm test --workspace=apps/portal`
- [ ] Verificación manual en el navegador (checklist de la Task 11), contra Postgres local

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Vvvtzc2jmGPfo71vZDAeXW
EOF
)"
```

- [ ] **Step 7: Marcar los checkboxes del issue #13**

```bash
gh issue view 13 --repo robertopeiro12/proyecto-sinmex --json body -q .body > /tmp/issue-13-body.md
```

Edita `/tmp/issue-13-body.md` marcando `[x]` cada criterio de aceptación ya cumplido, y:

```bash
gh issue edit 13 --repo robertopeiro12/proyecto-sinmex --body-file /tmp/issue-13-body.md
```

---

## Qué trae

- `GET/POST/PATCH/DELETE /usuarios` + `GET /usuarios/catalogo-perfiles` en `modules/auth/`.
- Migraciones: permiso `usuario.gestionar`; índice parcial `uq_usuario_login`.
- Función pura `calcular-excepciones.ts`, inversa de `combinarPermisos` (T-08a).
- Pantalla `/catalogo/usuarios` completa: formulario por secciones (datos básicos, contraseña, perfil/sucursal, matriz de permisos con tooltip).
- Pruebas de pantalla (Testing Library), continuando el patrón de T-65.

## Decisiones que conviene mirar en la revisión

- **D7 y el conteo global sobre el perfil maestro** — es la primera regla de negocio de este backend que depende de un conteo GLOBAL sobre un perfil que no se puede crear desechable (`esMaestro()` compara por nombre fijo, a diferencia de `sembrarPerfil()` en T-08b). Los e2e de la Task 6/7 usan una técnica de "ventana angosta" (demota temporalmente y restaura en un `finally`) para poder probarlo sin `--runInBand`; vale la pena que el otro dev la revise con cuidado — es nueva en este backend y tiene un riesgo residual documentado en el propio comentario del test.
- **D5**: `GET /usuarios/catalogo-perfiles` como puerta alterna a `GET /perfiles` (T-08b), en vez de relajar el permiso de ese endpoint. Confirmar que el criterio (dos permisos separados a propósito) sigue siendo lo que el negocio quiere.
- **`FormularioUsuario` no usa `PantallaCatalogo`**: mismo criterio que Clientes/Precios, pero aquí además hay lógica no trivial (D3: cambiar de perfil reinicia la matriz) que vale una segunda mirada.

## Fuera de alcance, a propósito

| Qué | Por qué |
|---|---|
| Pantalla de "cambiar mi propia contraseña" | El admin la escribe directo en el formulario de alta/edición. |
| Vendedores | T-62, entidad separada, con su propia decisión pendiente (`ADR-0007`). |
| Alta/edición del catálogo de `permiso` | Cada clave está ligada a un `@RequierePermiso` real en el código. |
| Reasignación masiva al dar de baja un perfil | Sigue siendo D4 de T-08b; esta pantalla permite hacerlo uno por uno si hiciera falta. |

## Verificación

Checklist manual completo en la Task 11, Step 4. Recuerda: **nunca contra `sinmex dev`** durante el desarrollo — apunta `DATABASE_URL` de `.env.development` al Postgres local mientras verificas.

## Self-Review

- **Cobertura del spec:** D1 → Task 7; D2 → Tasks 5, 6, 10; D3 → Tasks 2, 5, 6, 9, 10; D4 → Tasks 5, 9, 10; D5 → Task 3; D6 → Tasks 3-7, 11; D7 → Tasks 6, 7; D8 → Tasks 4, 5, 6, 10; D9 → Task 9; D10 → Tasks 5, 6. Los seis endpoints de la tabla del spec están en Tasks 3-7. Las dos filas de la tabla "Archivos" del spec (backend y portal) están cubiertas: backend en Tasks 1-7, portal en Tasks 8-12.
- **Placeholders:** ninguno — cada paso de código trae el archivo completo o el fragmento exacto a insertar, sin "TODO" ni "similar a la Task N" sin el código repetido.
- **Consistencia de tipos:** `UsuarioResumen`/`UsuarioBase`/`UsuarioDetalle`/`ExcepcionConId`/`DatosUsuarioBase` se definen una sola vez en `usuarios.repository.ts` (Tasks 4-7) y se reutilizan sin cambios en servicio, controller y DTOs; `lib/usuarios.ts` (Task 8) los copia manualmente (mismo trato que el resto de `lib/*.ts`, sin tipo compartido — ver CLAUDE.md). `Excepcion` (de `permisos.ts`, T-08a) es el tipo que `calcularExcepciones` (Task 2) devuelve y que `excepcionesConId()` (Task 5) traduce a `ExcepcionConId` antes de pasarlo al repositorio.
- **Hallazgo agregado durante la planeación (no estaba en el spec):** la reutilización directa de `PerfilesService.obtenerMatriz()` en vez de recomponer desde `PerfilesRepository` (ya corregido en el propio spec antes de escribir este plan) y la técnica de "ventana angosta" para probar D7 sin depender de `--runInBand`. Ambos quedaron documentados en el PR y en este plan para que la revisión cruzada los vea explícitamente.

# T-08a · Guard de permisos granulares — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un endpoint de la API pueda exigir un permiso concreto, que el portal esconda lo que el usuario no puede hacer, y cerrar la deuda de T-09 (hoy cualquier usuario con sesión crea o edita sucursales).

**Architecture:** Un guard global (`PermisosGuard`) corre después del `JwtAuthGuard` que ya existe y lee la metadata que deja el decorador `@RequierePermiso('...')`. Para resolver qué puede el usuario, consulta la base en cada petición a través de `PermisosRepository`. La lógica sutil (mezclar los permisos del perfil con las excepciones por usuario) vive en un módulo **puro** y sin base de datos, `permisos.ts`, siguiendo el mismo patrón que `alcance-sucursal.ts` de T-09: lógica pura probada con pruebas unitarias, acceso a datos probado end-to-end.

**Tech Stack:** NestJS · Kysely (sin ORM, ADR-0003) · Postgres/Supabase · Jest + supertest · pgTAP · Next.js 15 (App Router) en el portal.

**Spec:** `docs/superpowers/specs/2026-08-11-t08a-guard-permisos-design.md` — las decisiones se citan abajo como D1…D6.

## Global Constraints

- **Los comentarios y nombres del código backend van en español SIN acentos** (`sesion`, `proposito`, `codigo`). Es la convención vigente en todo `apps/backend/src`. Los documentos en `docs/` sí llevan acentos.
- **Sin ORM.** Todo acceso a datos con Kysely, contra los tipos de `apps/backend/src/database/schema.d.ts` (ADR-0003).
- **Baja lógica en todas las consultas:** cualquier `select` sobre `permiso`, `perfil`, `perfil_permiso`, `usuario_permiso` o `usuario` filtra `deleted_at is null`.
- **Los comandos se corren desde la raíz del repo**, nunca entrando a `apps/backend` a mano.
- `npm test --workspace=apps/backend` y `npm run test:e2e --workspace=apps/backend` usan **`.env.test` → Postgres local**, que necesita el stack de Supabase arriba (`colima start` + `npm run supabase start`).
- **`sucursal.gestionar` es la clave exacta** del permiso, grupo `General` (sin acento, igual que los otros grupos sembrados: `Operacion Comercial`, `Produccion/Almacen`, `Informacion`).
- **`Administrador General` es el nombre exacto** del perfil maestro sembrado en T-05.
- Commits en español, sin acentos en el asunto, terminando con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/20260811120000_permiso_sucursal_gestionar.sql` | **Crear.** Siembra el permiso que falta. |
| `supabase/tests/91_permiso_sucursal_test.sql` | **Crear.** pgTAP: el permiso existe y está en el grupo correcto. |
| `apps/backend/src/modules/auth/permisos.ts` | **Crear.** Núcleo **puro**: mezcla perfil + excepciones, y define quién es el perfil maestro. Sin base de datos, sin Nest. |
| `apps/backend/src/modules/auth/permisos.spec.ts` | **Crear.** Pruebas unitarias del núcleo puro. |
| `apps/backend/src/modules/auth/permisos.repository.ts` | **Crear.** Acceso a datos: trae perfil, permisos del perfil y excepciones, y delega la mezcla al núcleo puro. |
| `apps/backend/src/modules/auth/requiere-permiso.decorator.ts` | **Crear.** `@RequierePermiso('clave')`, mismo molde que `solo-app.decorator.ts`. |
| `apps/backend/src/modules/auth/permisos.guard.ts` | **Crear.** El guard global. |
| `apps/backend/src/modules/auth/permisos.guard.spec.ts` | **Crear.** Pruebas unitarias del guard, con dobles de `Reflector` y del repositorio. |
| `apps/backend/src/modules/auth/auth.module.ts` | **Modificar.** Registrar y **exportar** `PermisosRepository` (el guard global se resuelve fuera del módulo). |
| `apps/backend/src/app.module.ts` | **Modificar.** Registrar `PermisosGuard` como segundo `APP_GUARD`. |
| `apps/backend/src/modules/sucursales/sucursales.controller.ts` | **Modificar.** `@RequierePermiso` en `POST` y `PATCH`. |
| `apps/backend/src/modules/auth/auth.controller.ts` | **Modificar.** `GET /auth/me` devuelve `permisos`. |
| `apps/backend/test/sucursales.e2e-spec.ts` | **Modificar.** Fijar el perfil maestro y añadir los casos de 403 / excepción. |
| `apps/backend/test/auth.e2e-spec.ts` | **Modificar.** `/auth/me` trae `permisos`. |
| `apps/portal/src/lib/api.ts` | **Modificar.** `UsuarioSesion` gana `permisos: string[]`. |
| `apps/portal/src/components/auth/auth-provider.tsx` | **Modificar.** Expone `puede(clave)`. |
| `apps/portal/src/components/sucursales/pantalla-sucursales.tsx` | **Modificar.** Esconde "Nueva sucursal" y "Editar". |
| `CLAUDE.md` | **Modificar.** Sección corta de permisos. |

**Por qué `permisos.ts` va separado del repositorio:** es la decisión de diseño que hace testeable la parte que se puede equivocar. La mezcla "perfil + excepción que concede + excepción que niega" tiene reglas de precedencia; el acceso a datos no tiene ninguna. Separarlos deja la lógica cubierta por pruebas unitarias rápidas (el patrón que ya usa `alcance-sucursal.ts` / `alcance-sucursal.spec.ts` de T-09) en vez de exigir Postgres para probar una precedencia.

---

## Task 1: Sembrar el permiso `sucursal.gestionar`

**Files:**
- Create: `supabase/migrations/20260811120000_permiso_sucursal_gestionar.sql`
- Test: `supabase/tests/91_permiso_sucursal_test.sql`

**Interfaces:**
- Consumes: nada.
- Produces: la fila `permiso.clave = 'sucursal.gestionar'`, grupo `General`. Todas las tareas siguientes la dan por existente.

- [ ] **Step 1: Escribir la prueba pgTAP que falla**

Crear `supabase/tests/91_permiso_sucursal_test.sql`:

```sql
begin;
select plan(2);

select is(
  (select grupo from permiso where clave = 'sucursal.gestionar' and deleted_at is null),
  'General',
  'sucursal.gestionar existe y vive en el grupo General'
);

-- T-05 sembro 22 permisos desde el documento del cliente; este es el 23o y el
-- unico que NO sale de ahi (el cliente nunca menciono administrar sucursales).
select is(
  (select count(*)::int from permiso where deleted_at is null),
  23,
  'el catalogo de permisos tiene 23 claves'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correrla y verificar que falla**

```bash
npm run supabase -- test db
```

Esperado: FALLA — `sucursal.gestionar` no existe todavía, así que la primera aserción devuelve `NULL` en vez de `General` y el conteo da 22.

- [ ] **Step 3: Escribir la migración**

Crear `supabase/migrations/20260811120000_permiso_sucursal_gestionar.sql`:

```sql
-- T-09 dejo /sucursales solo detras de autenticacion: el catalogo de permisos
-- que sembro T-05 viene del documento del cliente y NO incluye ninguno para
-- administrar sucursales. Sin esta fila, cualquier usuario con sesion puede
-- crear o editar sucursales.
--
-- El grupo va sin acento igual que los demas ('Operacion Comercial',
-- 'Produccion/Almacen', 'Informacion'): son valores de datos, no etiquetas de
-- interfaz, y mezclar dos ortografias rompe cualquier agrupacion por texto.
insert into permiso (clave, grupo, descripcion) values
  ('sucursal.gestionar', 'General', 'Registrar/editar sucursales')
on conflict (clave) do nothing;
```

**No se siembra ningún `perfil_permiso`.** El cliente nunca dijo qué permisos lleva cada perfil (ver "Fuera, a propósito" en el spec); esa matriz la configurará él en T-08b. Los perfiles se quedan vacíos a propósito y el acceso del administrador viene del camino maestro (D1).

- [ ] **Step 4: Aplicar la migración y verificar que la prueba pasa**

```bash
npm run supabase -- migration up --local
npm run supabase -- test db
```

Esperado: PASA, incluidas las 31 pruebas que ya existían.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260811120000_permiso_sucursal_gestionar.sql supabase/tests/91_permiso_sucursal_test.sql
git commit -m "T-08a · Sembrar el permiso sucursal.gestionar que faltaba"
```

---

## Task 2: Núcleo puro de permisos

**Files:**
- Create: `apps/backend/src/modules/auth/permisos.ts`
- Test: `apps/backend/src/modules/auth/permisos.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `PERFIL_MAESTRO: string` (= `'Administrador General'`)
  - `esMaestro(perfil: string): boolean`
  - `interface Excepcion { clave: string; habilitado: boolean }`
  - `combinarPermisos(delPerfil: string[], excepciones: Excepcion[]): Set<string>`

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `apps/backend/src/modules/auth/permisos.spec.ts`:

```ts
import { combinarPermisos, esMaestro, PERFIL_MAESTRO } from './permisos';

describe('esMaestro', () => {
  it('reconoce al perfil maestro', () => {
    expect(esMaestro(PERFIL_MAESTRO)).toBe(true);
  });

  // 'Administrador' y 'Administrador General' son perfiles DISTINTOS de la
  // semilla de T-05. Comparar por prefijo le daria acceso total al primero.
  it('no confunde a "Administrador" con "Administrador General"', () => {
    expect(esMaestro('Administrador')).toBe(false);
  });
});

describe('combinarPermisos', () => {
  it('sin excepciones devuelve lo del perfil', () => {
    expect(combinarPermisos(['venta.registrar', 'cliente.gestionar'], [])).toEqual(
      new Set(['venta.registrar', 'cliente.gestionar']),
    );
  });

  it('una excepcion habilitada concede lo que el perfil no da', () => {
    const efectivos = combinarPermisos(
      ['venta.registrar'],
      [{ clave: 'sucursal.gestionar', habilitado: true }],
    );
    expect(efectivos).toEqual(new Set(['venta.registrar', 'sucursal.gestionar']));
  });

  it('una excepcion deshabilitada quita lo que el perfil si da', () => {
    const efectivos = combinarPermisos(
      ['venta.registrar', 'venta.editar_eliminar'],
      [{ clave: 'venta.editar_eliminar', habilitado: false }],
    );
    expect(efectivos).toEqual(new Set(['venta.registrar']));
  });

  // El caso que decide la precedencia (D3): la excepcion gana, no el perfil.
  it('la excepcion gana sobre el perfil en los dos sentidos', () => {
    const efectivos = combinarPermisos(
      ['venta.registrar'],
      [
        { clave: 'venta.registrar', habilitado: false },
        { clave: 'cobranza.registrar', habilitado: true },
      ],
    );
    expect(efectivos).toEqual(new Set(['cobranza.registrar']));
  });

  it('negar algo que el perfil tampoco daba no truena', () => {
    expect(
      combinarPermisos([], [{ clave: 'venta.registrar', habilitado: false }]),
    ).toEqual(new Set());
  });

  // Los 6 perfiles sembrados en T-05 estan VACIOS hasta T-08b: este es el caso
  // normal hoy, no un caso raro.
  it('un perfil sin permisos y sin excepciones no da nada', () => {
    expect(combinarPermisos([], [])).toEqual(new Set());
  });
});
```

- [ ] **Step 2: Correrlas y verificar que fallan**

```bash
npm test --workspace=apps/backend -- permisos.spec
```

Esperado: FALLA con `Cannot find module './permisos'`.

- [ ] **Step 3: Escribir el núcleo**

Crear `apps/backend/src/modules/auth/permisos.ts`:

```ts
/**
 * Nucleo de permisos: puro, sin base de datos y sin Nest.
 *
 * Vive separado de PermisosRepository a proposito. La precedencia entre el
 * perfil y las excepciones por usuario es la unica parte que se puede razonar
 * mal; el acceso a datos no tiene reglas. Separandolos, la regla se prueba con
 * pruebas unitarias que corren en milisegundos, sin Postgres. Mismo patron que
 * alcance-sucursal.ts en T-09.
 */

/**
 * El perfil "usuario maestro" sembrado en T-05. Quien lo tiene recibe el
 * catalogo COMPLETO de permisos (ver D1 del spec).
 *
 * La comparacion es por igualdad exacta, no por prefijo: 'Administrador' es
 * otro perfil de la misma semilla, y un `startsWith` le regalaria acceso total.
 */
export const PERFIL_MAESTRO = 'Administrador General';

export function esMaestro(perfil: string): boolean {
  return perfil === PERFIL_MAESTRO;
}

/** Una fila de `usuario_permiso`: `habilitado` concede (true) o quita (false). */
export interface Excepcion {
  clave: string;
  habilitado: boolean;
}

/**
 * Permisos efectivos = los del perfil, con las excepciones del usuario
 * aplicadas encima. La excepcion SIEMPRE gana sobre el perfil, en los dos
 * sentidos (D3): el negocio pide tanto "a este usuario dale un permiso extra"
 * como "a este quitaselo", y la tabla de T-05 ya soporta ambos.
 */
export function combinarPermisos(
  delPerfil: string[],
  excepciones: Excepcion[],
): Set<string> {
  const efectivos = new Set(delPerfil);
  for (const { clave, habilitado } of excepciones) {
    if (habilitado) {
      efectivos.add(clave);
    } else {
      efectivos.delete(clave);
    }
  }
  return efectivos;
}
```

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

```bash
npm test --workspace=apps/backend -- permisos.spec
```

Esperado: PASA, 7 pruebas.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/auth/permisos.ts apps/backend/src/modules/auth/permisos.spec.ts
git commit -m "T-08a · Nucleo puro de permisos: perfil + excepciones"
```

---

## Task 3: Repositorio, decorador y guard

**Files:**
- Create: `apps/backend/src/modules/auth/permisos.repository.ts`
- Create: `apps/backend/src/modules/auth/requiere-permiso.decorator.ts`
- Create: `apps/backend/src/modules/auth/permisos.guard.ts`
- Test: `apps/backend/src/modules/auth/permisos.guard.spec.ts`
- Modify: `apps/backend/src/modules/auth/auth.module.ts`
- Modify: `apps/backend/src/app.module.ts:54`

**Interfaces:**
- Consumes: `esMaestro`, `combinarPermisos`, `Excepcion` (Task 2); `ES_APP` de `solo-app.decorator.ts`; `DB_CONNECTION`, `Database` de `../../database/database.tokens`.
- Produces:
  - `PermisosRepository.permisosDe(usuarioId: string): Promise<Set<string>>`
  - `RequierePermiso(clave: string)` y la constante `PERMISO_REQUERIDO`
  - `PermisosGuard` registrado globalmente

- [ ] **Step 1: Escribir las pruebas del guard**

Crear `apps/backend/src/modules/auth/permisos.guard.spec.ts`:

```ts
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PermisosGuard } from './permisos.guard';
import type { PermisosRepository } from './permisos.repository';
import { PERMISO_REQUERIDO } from './requiere-permiso.decorator';
import { ES_APP } from './solo-app.decorator';

/** Doble del Reflector: devuelve lo que se le ponga por clave de metadata. */
const reflectorCon = (valores: Record<string, unknown>): Reflector =>
  ({
    getAllAndOverride: (clave: string) => valores[clave],
  }) as unknown as Reflector;

const contextoCon = (req: object): ExecutionContext =>
  ({
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const repositorioCon = (permisos: string[]): PermisosRepository =>
  ({
    permisosDe: () => Promise.resolve(new Set(permisos)),
  }) as unknown as PermisosRepository;

describe('PermisosGuard', () => {
  it('deja pasar un endpoint sin @RequierePermiso', async () => {
    const guard = new PermisosGuard(reflectorCon({}), repositorioCon([]));
    await expect(
      guard.canActivate(contextoCon({ usuarioId: 'u1' })),
    ).resolves.toBe(true);
  });

  it('deja pasar a quien tiene el permiso', async () => {
    const guard = new PermisosGuard(
      reflectorCon({ [PERMISO_REQUERIDO]: 'sucursal.gestionar' }),
      repositorioCon(['sucursal.gestionar']),
    );
    await expect(
      guard.canActivate(contextoCon({ usuarioId: 'u1' })),
    ).resolves.toBe(true);
  });

  // 403 y no 401: el usuario SI esta identificado (D5). Con un 401 el portal
  // intentaria refrescar la sesion y acabaria mandando al login a alguien que
  // tiene sesion valida.
  it('responde 403 a quien no lo tiene', async () => {
    const guard = new PermisosGuard(
      reflectorCon({ [PERMISO_REQUERIDO]: 'sucursal.gestionar' }),
      repositorioCon(['venta.registrar']),
    );
    await expect(
      guard.canActivate(contextoCon({ usuarioId: 'u1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // D6: un vendedor no tiene perfil ni permisos, asi que esa combinacion solo
  // puede ser una equivocacion nuestra. Truena en vez de negar en silencio,
  // que dejaria un endpoint de la tablet colgado de un permiso inalcanzable.
  it('truena si el endpoint es @SoloApp()', async () => {
    const guard = new PermisosGuard(
      reflectorCon({
        [PERMISO_REQUERIDO]: 'sucursal.gestionar',
        [ES_APP]: true,
      }),
      repositorioCon([]),
    );
    await expect(
      guard.canActivate(contextoCon({ vendedorId: 'v1' })),
    ).rejects.toThrow(/SoloApp/);
  });

  it('truena si corre sin usuarioId (guards mal ordenados)', async () => {
    const guard = new PermisosGuard(
      reflectorCon({ [PERMISO_REQUERIDO]: 'sucursal.gestionar' }),
      repositorioCon(['sucursal.gestionar']),
    );
    await expect(guard.canActivate(contextoCon({}))).rejects.toThrow(
      /usuarioId/,
    );
  });
});
```

- [ ] **Step 2: Correrlas y verificar que fallan**

```bash
npm test --workspace=apps/backend -- permisos.guard.spec
```

Esperado: FALLA con `Cannot find module './permisos.guard'`.

- [ ] **Step 3: Escribir el decorador**

Crear `apps/backend/src/modules/auth/requiere-permiso.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const PERMISO_REQUERIDO = 'permiso_requerido';

/**
 * Exige un permiso concreto en un endpoint del portal:
 *
 *     @Post()
 *     @RequierePermiso('sucursal.gestionar')
 *     async crear(...)
 *
 * Un endpoint SIN este decorador sigue exigiendo solo sesion valida, como
 * hasta T-08a. Es a proposito: el guard no puede adivinar que permiso le
 * tocaria a cada endpoint, y negar por defecto dejaria la API entera muerta
 * mientras los perfiles esten vacios (lo estan hasta T-08b).
 *
 * La `clave` debe existir en la tabla `permiso`. No hay comprobacion en
 * tiempo de compilacion: una clave mal escrita se comporta como un permiso que
 * nadie tiene, o sea un 403 permanente. Cada ticket que agregue un permiso
 * agrega tambien su prueba e2e, que es donde se caza ese error.
 */
export const RequierePermiso = (clave: string) =>
  SetMetadata(PERMISO_REQUERIDO, clave);
```

- [ ] **Step 4: Escribir el repositorio**

Crear `apps/backend/src/modules/auth/permisos.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { combinarPermisos, esMaestro, type Excepcion } from './permisos';

/**
 * Resuelve los permisos efectivos de un [[Usuario]] del portal.
 *
 * Consulta la base en CADA peticion, no al hacer login (D2): meter el set en
 * el JWT ahorraria consultas, pero un cambio de permisos tardaria hasta 15
 * minutos en surtir efecto — justo cuando uno quita un permiso porque hay un
 * problema en curso.
 *
 * Es el UNICO lugar donde se resuelve esto. Lo usan el PermisosGuard (para
 * decidir si deja pasar) y GET /auth/me (para decirle al portal que botones
 * pintar). Que ambos pregunten aqui es lo que hace imposible que el backend
 * permita algo que la interfaz esconde, o al reves.
 */
@Injectable()
export class PermisosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async permisosDe(usuarioId: string): Promise<Set<string>> {
    const usuario = await this.db
      .selectFrom('usuario')
      .innerJoin('perfil', 'perfil.id', 'usuario.perfil_id')
      .select(['usuario.perfil_id as perfilId', 'perfil.nombre as perfil'])
      .where('usuario.id', '=', usuarioId)
      .where('usuario.deleted_at', 'is', null)
      .where('perfil.deleted_at', 'is', null)
      .executeTakeFirst();

    // Usuario inexistente o dado de baja -> CERO permisos. La misma trampa que
    // documenta buscarSucursalDeUsuario en sucursales.repository.ts: colapsar
    // "no existe" con cualquier otro caso convertiria a un usuario borrado en
    // uno con acceso.
    if (!usuario) {
      return new Set();
    }

    // D1: la excepcion del perfil maestro vive AQUI, en el resolutor, no en el
    // guard. Si viviera en el guard, /auth/me tendria que repetirla y las dos
    // copias se separarian tarde o temprano.
    if (esMaestro(usuario.perfil)) {
      return new Set(await this.catalogoCompleto());
    }

    const [delPerfil, excepciones] = await Promise.all([
      this.clavesDelPerfil(usuario.perfilId),
      this.excepcionesDe(usuarioId),
    ]);
    return combinarPermisos(delPerfil, excepciones);
  }

  private async catalogoCompleto(): Promise<string[]> {
    const filas = await this.db
      .selectFrom('permiso')
      .select('clave')
      .where('deleted_at', 'is', null)
      .execute();
    return filas.map((f) => f.clave);
  }

  private async clavesDelPerfil(perfilId: string): Promise<string[]> {
    const filas = await this.db
      .selectFrom('perfil_permiso')
      .innerJoin('permiso', 'permiso.id', 'perfil_permiso.permiso_id')
      .select('permiso.clave as clave')
      .where('perfil_permiso.perfil_id', '=', perfilId)
      .where('perfil_permiso.deleted_at', 'is', null)
      .where('permiso.deleted_at', 'is', null)
      .execute();
    return filas.map((f) => f.clave);
  }

  private async excepcionesDe(usuarioId: string): Promise<Excepcion[]> {
    return this.db
      .selectFrom('usuario_permiso')
      .innerJoin('permiso', 'permiso.id', 'usuario_permiso.permiso_id')
      .select([
        'permiso.clave as clave',
        'usuario_permiso.habilitado as habilitado',
      ])
      .where('usuario_permiso.usuario_id', '=', usuarioId)
      .where('usuario_permiso.deleted_at', 'is', null)
      .where('permiso.deleted_at', 'is', null)
      .execute();
  }
}
```

- [ ] **Step 5: Escribir el guard**

Crear `apps/backend/src/modules/auth/permisos.guard.ts`:

```ts
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PermisosRepository } from './permisos.repository';
import { PERMISO_REQUERIDO } from './requiere-permiso.decorator';
import { ES_APP } from './solo-app.decorator';

/**
 * Segundo guard global. Corre DESPUES de JwtAuthGuard porque depende del
 * `req.usuarioId` que aquel deja puesto — el orden lo fija la lista de
 * providers de app.module.ts.
 *
 * Reparto de casos:
 *
 * - endpoint sin `@RequierePermiso` -> pasa (sigue exigiendo solo sesion).
 * - tiene el permiso                -> pasa.
 * - no lo tiene                     -> 403 (D5: esta identificado, no le toca).
 * - `@SoloApp()` + `@RequierePermiso` -> error de programacion (D6).
 */
@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permisos: PermisosRepository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const requerido = this.reflector.getAllAndOverride<string | undefined>(
      PERMISO_REQUERIDO,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!requerido) {
      return true;
    }

    const esApp = this.reflector.getAllAndOverride<boolean | undefined>(
      ES_APP,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (esApp) {
      // Un vendedor no tiene perfil ni permisos: este permiso no se podria
      // cumplir NUNCA. Se rompe ruidosamente en vez de responder 403 para
      // siempre, que se veria como un bug de datos y no de codigo.
      throw new Error(
        `@RequierePermiso('${requerido}') sobre un endpoint @SoloApp(): los vendedores no tienen permisos.`,
      );
    }

    const req = ctx
      .switchToHttp()
      .getRequest<Request & { usuarioId?: string }>();
    if (!req.usuarioId) {
      // Solo puede pasar si JwtAuthGuard no corrio antes (orden de providers
      // en app.module.ts) o si el endpoint es @Publico() y ademas exige
      // permiso, que es contradictorio.
      throw new Error(
        'PermisosGuard corrio sin usuarioId: revisa el orden de los guards en app.module.ts.',
      );
    }

    const efectivos = await this.permisos.permisosDe(req.usuarioId);
    if (!efectivos.has(requerido)) {
      throw new ForbiddenException('No tienes permiso para esta accion.');
    }
    return true;
  }
}
```

- [ ] **Step 6: Registrar el repositorio en AuthModule**

En `apps/backend/src/modules/auth/auth.module.ts`, agregar el import y sumar `PermisosRepository` a `providers` y a `exports`. El comentario que ya existe sobre por qué se exporta `TokenVendedorService` aplica igual; ampliarlo:

```ts
  // TokenVendedorService y PermisosRepository se exportan porque los inyectan
  // los guards que app.module.ts registra como APP_GUARD, y por tanto se
  // resuelven fuera de este modulo. Sin exportarlos, la app no arranca.
  exports: [
    AuthService,
    TokenService,
    AuthVendedorService,
    TokenVendedorService,
    PermisosRepository,
  ],
```

- [ ] **Step 7: Registrar el guard en AppModule**

En `apps/backend/src/app.module.ts:54`, reemplazar la línea de `providers`:

```ts
  // El ORDEN importa: Nest corre los APP_GUARD en el orden en que se declaran.
  // PermisosGuard depende del req.usuarioId que deja JwtAuthGuard, asi que va
  // segundo. Invertirlos hace que todo endpoint con @RequierePermiso truene.
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermisosGuard },
  ],
```

Agregar el import: `import { PermisosGuard } from './modules/auth/permisos.guard';`

- [ ] **Step 8: Correr las pruebas y el build**

```bash
npm test --workspace=apps/backend -- permisos
npm run build --workspace=apps/backend
npm run lint --workspace=apps/backend
```

Esperado: PASA todo. El build es la comprobación de que el cableado de módulos compila.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/auth/permisos.repository.ts \
        apps/backend/src/modules/auth/requiere-permiso.decorator.ts \
        apps/backend/src/modules/auth/permisos.guard.ts \
        apps/backend/src/modules/auth/permisos.guard.spec.ts \
        apps/backend/src/modules/auth/auth.module.ts \
        apps/backend/src/app.module.ts
git commit -m "T-08a · Decorador @RequierePermiso y guard global de permisos"
```

---

## Task 4: Aplicar el permiso a Sucursales

**Files:**
- Modify: `apps/backend/src/modules/sucursales/sucursales.controller.ts:18-42`
- Test: `apps/backend/test/sucursales.e2e-spec.ts`

**Interfaces:**
- Consumes: `RequierePermiso` (Task 3), el permiso sembrado (Task 1).
- Produces: `POST /sucursales` y `PATCH /sucursales/:id` exigen `sucursal.gestionar`; `GET /sucursales` no.

> **Ojo — esta tarea ROMPE pruebas que hoy pasan.** El `beforeAll` de `sucursales.e2e-spec.ts:68-72` elige el perfil con `orderBy('nombre')` y toma el primero, que alfabéticamente es **`Administrador`**, no `Administrador General`. Como los perfiles están vacíos, esos usuarios se quedan sin permisos y los `POST`/`PATCH` que hoy dan 201/200 pasarían a dar 403. Hay que fijar el perfil por nombre, no por orden.

- [ ] **Step 1: Arreglar el setup del e2e y escribir los casos nuevos**

En `apps/backend/test/sucursales.e2e-spec.ts`, reemplazar la búsqueda del perfil:

```ts
    // Explicito, no "el primero alfabeticamente": desde T-08a el perfil decide
    // los permisos, y 'Administrador' (que es el primero por orden) esta VACIO
    // como los otros cinco. Solo el maestro pasa el guard (D1).
    const perfil = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Administrador General')
      .executeTakeFirstOrThrow();

    const perfilSinPermisos = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Auxiliar Administrativo')
      .executeTakeFirstOrThrow();
```

Añadir las constantes junto a las que ya existen arriba del `describe`:

```ts
const LOGIN_SIN_PERMISO = `e2e-suc-sin-${SUFIJO}`;
const LOGIN_CON_EXCEPCION = `e2e-suc-exc-${SUFIJO}`;
const LOGIN_EXCEPCION_BORRADA = `e2e-suc-exb-${SUFIJO}`;
```

Añadir `'ZD'` a `CODIGOS_DE_PRUEBA` (hoy es `['ZA', 'ZB', 'ZC']`), porque la última prueba intenta crearlo.

Y declarar sus cookies junto a las otras: `let cookieSinPermiso: string;`, `let cookieConExcepcion: string;` y `let cookieExcepcionBorrada: string;`

Crear los dos usuarios en el `beforeAll`, después de los que ya existen:

```ts
    // Auxiliar Administrativo: perfil vacio, o sea sin sucursal.gestionar.
    const sinPermiso = await db
      .insertInto('usuario')
      .values({
        login: LOGIN_SIN_PERMISO,
        nombre: 'Usuario sin permiso e2e',
        password_hash: hash,
        perfil_id: perfilSinPermisos.id,
        sucursal_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Mismo perfil vacio, pero con el permiso concedido POR EXCEPCION. Es el
    // camino no-maestro de D3 probado de punta a punta: sin este usuario, la
    // unica forma de pasar el guard en toda la suite seria el bypass del
    // maestro, y la mezcla perfil+excepcion quedaria sin verificar contra la
    // base de verdad.
    const conExcepcion = await db
      .insertInto('usuario')
      .values({
        login: LOGIN_CON_EXCEPCION,
        nombre: 'Usuario con excepcion e2e',
        password_hash: hash,
        perfil_id: perfilSinPermisos.id,
        sucursal_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const permisoSucursal = await db
      .selectFrom('permiso')
      .select('id')
      .where('clave', '=', 'sucursal.gestionar')
      .executeTakeFirstOrThrow();

    // Mismo caso, pero con la excepcion dada de BAJA: debe comportarse como si
    // no existiera.
    const excepcionBorrada = await db
      .insertInto('usuario')
      .values({
        login: LOGIN_EXCEPCION_BORRADA,
        nombre: 'Usuario con excepcion borrada e2e',
        password_hash: hash,
        perfil_id: perfilSinPermisos.id,
        sucursal_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('usuario_permiso')
      .values([
        {
          usuario_id: conExcepcion.id,
          permiso_id: permisoSucursal.id,
          habilitado: true,
        },
        {
          usuario_id: excepcionBorrada.id,
          permiso_id: permisoSucursal.id,
          habilitado: true,
          deleted_at: new Date(),
        },
      ])
      .execute();

    usuarioIds = [
      general.id,
      deTijuana.id,
      sinPermiso.id,
      conExcepcion.id,
      excepcionBorrada.id,
    ];

    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
    cookieConExcepcion = await iniciarSesion(LOGIN_CON_EXCEPCION);
    cookieExcepcionBorrada = await iniciarSesion(LOGIN_EXCEPCION_BORRADA);
```

En el `afterAll`, borrar las excepciones **antes** que los usuarios (hay llave foránea de `usuario_permiso` a `usuario`), justo antes del borrado de `usuario` que ya existe:

```ts
    await db
      .deleteFrom('usuario_permiso')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
```

Agregar el bloque de pruebas nuevo:

```ts
  describe('permiso sucursal.gestionar (T-08a)', () => {
    it('sin el permiso, crear responde 403', async () => {
      await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', cookieSinPermiso)
        .send({ codigo: 'ZC', nombre: 'Sucursal sin permiso' })
        .expect(403);
    });

    it('sin el permiso, editar responde 403', async () => {
      await request(app.getHttpServer())
        .patch(`/sucursales/${idMexicali}`)
        .set('Cookie', cookieSinPermiso)
        .send({ nombre: 'Mexicali editada sin permiso' })
        .expect(403);
    });

    // La prueba que defiende D4. El selector "Por sucursal" de T-09 vive en la
    // barra lateral de TODAS las paginas y se pinta con este GET: ponerle el
    // permiso romperia el filtro global para casi todos los usuarios. Si
    // alguien le cuelga un @RequierePermiso por descuido, esto se cae primero.
    it('sin el permiso, listar sigue respondiendo 200', async () => {
      await request(app.getHttpServer())
        .get('/sucursales')
        .set('Cookie', cookieSinPermiso)
        .expect(200);
    });

    it('con el permiso concedido por excepcion, crear responde 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', cookieConExcepcion)
        .send({ codigo: 'ZC', nombre: 'Sucursal por excepcion' })
        .expect(201);
      expect((res.body as SucursalRespuesta).codigo).toBe('ZC');
    });

    // Baja logica: una excepcion con deleted_at ya no cuenta. Sin esta prueba,
    // olvidar un `where deleted_at is null` en excepcionesDe() pasaria
    // inadvertido — y el sintoma seria que revocar un permiso no revoca nada.
    it('una excepcion dada de baja no concede el permiso', async () => {
      await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', cookieExcepcionBorrada)
        .send({ codigo: 'ZD', nombre: 'Sucursal con excepcion borrada' })
        .expect(403);
    });
  });
```

- [ ] **Step 2: Correr el e2e y verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend -- sucursales
```

Esperado: FALLAN las **tres** pruebas que esperan 403 (hoy responden 201/200, porque el permiso todavía no se exige). Las demás pasan, incluidas las de 200 y 201.

- [ ] **Step 3: Poner el decorador en el controller**

En `apps/backend/src/modules/sucursales/sucursales.controller.ts`, reemplazar el comentario de la línea 18:

```ts
// Sin @Publico(): el guard global de app.module.ts protege todo por defecto.
// Ademas, crear y editar exigen `sucursal.gestionar` (T-08a). Listar NO lo
// exige a proposito: el selector "Por sucursal" de T-09 vive en la barra
// lateral de todas las paginas y lo usa cualquier usuario para trabajar. El
// alcance de lo que cada quien VE ya lo acota alcance-sucursal.ts.
```

Agregar el import y los decoradores:

```ts
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
```

```ts
  @Post()
  @RequierePermiso('sucursal.gestionar')
  async crear(@Body() dto: CrearSucursalDto): Promise<Sucursal> {
```

```ts
  @Patch(':id')
  @RequierePermiso('sucursal.gestionar')
  async editar(
```

- [ ] **Step 4: Correr el e2e completo y verificar que pasa**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: PASA toda la suite e2e, incluidas las de auth y sincronización (que no declaran permisos y por tanto no cambian).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/sucursales/sucursales.controller.ts apps/backend/test/sucursales.e2e-spec.ts
git commit -m "T-08a · Crear y editar sucursales exigen sucursal.gestionar"
```

---

## Task 5: `GET /auth/me` devuelve los permisos

**Files:**
- Modify: `apps/backend/src/modules/auth/auth.controller.ts:96-103`
- Test: `apps/backend/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `PermisosRepository.permisosDe` (Task 3).
- Produces: `GET /auth/me` responde `UsuarioSesion & { permisos: string[] }`, ordenado alfabéticamente. Task 6 (portal) depende de este contrato.

- [ ] **Step 1: Fijar el perfil del e2e de auth y escribir la prueba que falla**

`apps/backend/test/auth.e2e-spec.ts:57-61` tiene el **mismo** problema que Task 4: elige el perfil con `orderBy('nombre')`, que da `Administrador` — un perfil vacío. Reemplazarlo:

```ts
    // Explicito, no "el primero alfabeticamente": desde T-08a el perfil decide
    // los permisos, y solo el maestro recibe el catalogo completo (D1).
    const perfil = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Administrador General')
      .executeTakeFirstOrThrow();
```

Ninguna prueba de ese archivo afirma nada sobre el nombre del perfil, así que el cambio no rompe las que ya existen.

Agregar la prueba dentro del `describe('Auth (e2e)')`. Se hace su propio login porque en ese archivo las cookies se obtienen dentro de cada prueba, no en una variable compartida:

```ts
  it('GET /auth/me devuelve los permisos efectivos del usuario', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const acceso = leerCookie(cookies, 'jawa_access');

    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', acceso)
      .expect(200);

    const cuerpo = res.body as { permisos: string[] };
    // Es Administrador General, asi que recibe el catalogo completo (D1),
    // incluido el permiso que sembro T-08a.
    expect(cuerpo.permisos).toContain('sucursal.gestionar');
    expect(cuerpo.permisos).toContain('venta.registrar');

    // Ordenado y estable entre peticiones.
    expect(cuerpo.permisos).toEqual([...cuerpo.permisos].sort());
  });
```

> Verificar cómo devuelve `leerCookie` su valor en ese archivo (`auth.e2e-spec.ts:31`) y usarlo igual que las pruebas vecinas: si ya devuelve el par `nombre=valor` recortado, va directo a `.set('Cookie', acceso)`.

- [ ] **Step 2: Correrla y verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend -- auth.e2e
```

Esperado: FALLA — `cuerpo.permisos` es `undefined`.

- [ ] **Step 3: Modificar el controller**

En `apps/backend/src/modules/auth/auth.controller.ts`, agregar el import, inyectar el repositorio en el constructor y cambiar el handler:

```ts
import { PermisosRepository } from './permisos.repository';
import type { UsuarioSesion } from './auth.service';

/** Lo que ve el portal al arrancar: quien eres y que puedes hacer. */
export type SesionConPermisos = UsuarioSesion & { permisos: string[] };
```

```ts
  @Get('me')
  async me(@UsuarioActual() usuarioId: string): Promise<SesionConPermisos> {
    const usuario = await this.auth.buscarUsuarioPorId(usuarioId);
    if (!usuario) {
      throw new UnauthorizedException('Sesion invalida.');
    }

    // Del MISMO resolutor que usa el guard (D1). Que ambos pregunten aqui es
    // lo que impide que el portal esconda un boton que la API si permite, o
    // peor, que muestre uno que va a rebotar con 403.
    const permisos = await this.permisos.permisosDe(usuarioId);

    // Ordenado para que la respuesta sea estable entre peticiones: un orden
    // que baila hace que cualquier comparacion o cache del portal falle sin
    // motivo aparente.
    return { ...usuario, permisos: [...permisos].sort() };
  }
```

- [ ] **Step 4: Correr el e2e y verificar que pasa**

```bash
npm run test:e2e --workspace=apps/backend -- auth.e2e
```

Esperado: PASA.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/auth/auth.controller.ts apps/backend/test/auth.e2e-spec.ts
git commit -m "T-08a · /auth/me devuelve los permisos efectivos"
```

---

## Task 6: El portal esconde lo que no se puede hacer

**Files:**
- Modify: `apps/portal/src/lib/api.ts:1-7`
- Modify: `apps/portal/src/components/auth/auth-provider.tsx`
- Modify: `apps/portal/src/components/sucursales/pantalla-sucursales.tsx:41-47,100-107`

**Interfaces:**
- Consumes: el contrato de `/auth/me` de Task 5.
- Produces: `useAuth().puede(clave: string): boolean`.

**Sin pruebas automatizadas:** el portal sigue sin infraestructura de pruebas (su CI corre solo lint + build), igual que en T-09. Montarla es un ticket propio. La verificación aquí es manual, en el Step 4.

- [ ] **Step 1: Agregar `permisos` al tipo de sesión**

En `apps/portal/src/lib/api.ts`, dentro de `UsuarioSesion`:

```ts
export interface UsuarioSesion {
  id: string;
  login: string;
  nombre: string;
  perfil: string;
  sucursal: { id: string; codigo: string; nombre: string } | null;
  /** Claves de permiso efectivas, ya resueltas por el backend (perfil + excepciones). */
  permisos: string[];
}
```

- [ ] **Step 2: Exponer `puede` en el AuthProvider**

En `apps/portal/src/components/auth/auth-provider.tsx`, ampliar la interfaz del contexto:

```ts
interface ContextoAuth {
  usuario: UsuarioSesion | null;
  cargando: boolean;
  cerrarSesion: () => Promise<void>;
  puede: (clave: string) => boolean;
}
```

Definir el helper junto a `cerrarSesion` y pasarlo en el `value`:

```ts
  /**
   * El backend ya resolvio la lista (incluido el caso del Administrador
   * General, que recibe el catalogo completo), asi que aqui no hay ninguna
   * regla que replicar — solo consultarla.
   *
   * Devuelve false mientras la sesion carga: es preferible que un boton
   * aparezca un instante despues a que parpadee y desaparezca.
   */
  const puede = useCallback(
    (clave: string) => usuario?.permisos.includes(clave) ?? false,
    [usuario],
  );
```

```tsx
    <Contexto.Provider value={{ usuario, cargando, cerrarSesion, puede }}>
      {children}
    </Contexto.Provider>
```

- [ ] **Step 3: Esconder los botones de Sucursales**

En `apps/portal/src/components/sucursales/pantalla-sucursales.tsx`, importar `useAuth` y calcular el permiso una vez:

```tsx
import { useAuth } from "@/components/auth/auth-provider";
```

Dentro del componente, junto al resto del estado:

```tsx
  const { puede } = useAuth();
  const puedeGestionar = puede("sucursal.gestionar");
```

Envolver el botón de alta (línea ~41) y el de editar (línea ~100):

```tsx
        {puedeGestionar && (
          <Button
            size="sm"
            disabled={edicion !== null}
            onClick={() => setEdicion("nueva")}
          >
            Nueva sucursal
          </Button>
        )}
```

```tsx
                    {puedeGestionar && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={edicion !== null}
                        onClick={() => setEdicion(s)}
                      >
                        Editar
                      </Button>
                    )}
```

**Esto es comodidad, no seguridad.** Quien edite el HTML o llame a la API a mano se topa igual con el 403 del guard. La autoridad es el backend; el portal solo evita ofrecer algo que va a rebotar.

- [ ] **Step 4: Verificar a mano**

```bash
npm run lint --workspace=apps/portal
npm run build --workspace=apps/portal
```

Luego, con el backend y el portal levantados (`npm run backend`, `npm run portal`) **apuntando al Postgres local**, no a `sinmex dev`:

1. Entrar con un usuario `Administrador General` → se ven "Nueva sucursal" y "Editar".
2. Crear un usuario con perfil `Auxiliar Administrativo` (`npm run crear-usuario --workspace=apps/backend`), entrar con él → **no** aparecen esos botones, pero el selector de sucursales de la barra lateral **sí** se puebla.

El punto 2 es la comprobación de D4 en la interfaz real.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/lib/api.ts \
        apps/portal/src/components/auth/auth-provider.tsx \
        apps/portal/src/components/sucursales/pantalla-sucursales.tsx
git commit -m "T-08a · El portal esconde las acciones sin permiso"
```

---

## Task 7: Cierre — verificación real, nube, memoria y issue

**Files:**
- Modify: `CLAUDE.md`
- Modify (vault): `../jawa-obsidian-memory/00-Inicio/Estado del proyecto.md`
- Modify (vault): `../jawa-obsidian-memory/10-Dominio/Entidades/Perfil.md`

- [ ] **Step 1: Verificar el perfil del usuario de Roberto en `sinmex dev`**

Es el riesgo que el spec marcó como "verificar con una consulta, no de memoria". Roberto cree que su usuario quedó como `Administrador General`; si no lo es, al aplicar la migración en la nube se queda sin poder administrar sucursales.

Consultar la base `sinmex dev` (la de `.env.development`):

```sql
select u.login, p.nombre as perfil
from usuario u join perfil p on p.id = u.perfil_id
where u.deleted_at is null;
```

Si algún usuario que deba administrar no es `Administrador General`, arreglarlo antes de seguir — moviéndole el perfil, o concediéndole el permiso por excepción en `usuario_permiso`.

- [ ] **Step 2: Aplicar la migración a `sinmex dev`**

```bash
npm run supabase -- db push
npm run supabase -- migration list
```

`migration list` debe mostrar la nueva migración con `local` y `remote` coincidiendo. El vault deja anotado que **este comando es la única fuente confiable** del estado remoto — no basta con asumir que el push funcionó.

- [ ] **Step 3: Verificación completa**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm run supabase -- test db
npm run lint --workspace=apps/portal
npm run build --workspace=apps/portal
```

Los siete en verde. Ninguna afirmación de "listo" antes de ver esta salida.

- [ ] **Step 4: Documentar en `CLAUDE.md`**

Agregar una sección después de la de autenticación (las "dos autenticaciones"):

```markdown
**Permisos del portal (T-08a) — el candado no es automatico:**

Un endpoint del portal nace exigiendo **solo sesion**. Para exigir un permiso concreto hay que
marcarlo: `@RequierePermiso('producto.gestionar')` sobre el handler. Sin esa marca, cualquier
usuario con sesion pasa.

- **Los 6 perfiles sembrados estan VACIOS** y siguen asi hasta T-08b: el cliente nunca dijo que
  permisos lleva cada uno, y la matriz la va a configurar el. Hoy el unico camino que pasa un
  `@RequierePermiso` es el perfil **`Administrador General`**, que recibe el catalogo completo, o
  una excepcion en `usuario_permiso`.
- **`usuario_permiso.habilitado` va en los dos sentidos:** `true` concede un permiso que el perfil
  no da, `false` quita uno que si da. La excepcion gana sobre el perfil.
- **Todo se resuelve en `permisos.repository.ts`**, y lo consultan tanto el guard como
  `GET /auth/me`. Si agregas una regla nueva de permisos, va ahi — no en el guard, o el portal y
  la API acabaran discrepando.
- **Los permisos aplican al portal, no a la tablet.** Un `@RequierePermiso` sobre un endpoint
  `@SoloApp()` truena a proposito: el vendedor no tiene perfil.
```

- [ ] **Step 5: Actualizar el vault**

En `00-Inicio/Estado del proyecto.md`, agregar la fila a la tabla de issues y actualizar `actualizado:`:

```markdown
| T-08a | Guard de permisos granulares (mitad de T-08) | ✅ Hecho (2026-08-11, Roberto) — falta T-08b (matriz de perfiles), va con T-13 |
```

En `10-Dominio/Entidades/Perfil.md`, **sustituir** el bloque `> [!warning] Permiso pendiente de sembrar: sucursal.gestionar` por uno que refleje la realidad nueva:

```markdown
> [!info] `sucursal.gestionar` sembrado en T-08a (2026-08-11)
> Ya existe en el catálogo (grupo **General**) y lo exigen `POST /sucursales` y
> `PATCH /sucursales/:id`. **Listar NO lo exige**: el selector global de T-09 vive en la barra
> lateral de todas las páginas y lo usa cualquier usuario.
>
> Los 6 perfiles siguen **sin permisos asignados** a propósito — el cliente nunca especificó la
> matriz, y la configurará él en T-08b. Hoy el acceso viene del perfil **Administrador General**,
> que recibe el catálogo completo por diseño.
```

Actualizar el campo `actualizado:` de ambas notas a `2026-08-11`.

- [ ] **Step 6: Acordar la partición del issue con Mario**

T-08 lo escribió Mario. Antes de cerrar nada, comentar en el issue #8 qué quedó hecho y qué migra a T-08b, para que los criterios pendientes no se pierdan:

```bash
gh issue comment 8 --body "T-08a (guard de permisos) queda hecho en el PR de esta rama: modelo RBAC cableado, decorador @RequierePermiso, guard global, sucursal.gestionar sembrado y aplicado a crear/editar, y /auth/me devolviendo permisos.

Falta T-08b, que propongo llevar junto con T-13 (Usuarios) porque es donde se consume: alta de perfiles nuevos, matriz de permisos por perfil y edicion de excepciones por usuario. Mario, dime si te parece partirlo asi o prefieres que quede todo en este issue."
```

**No cerrar el issue #8** hasta que Mario responda: sus criterios de aceptación incluyen la matriz, que no está hecha.

- [ ] **Step 7: Commit y PR**

```bash
git add CLAUDE.md
git commit -m "T-08a · Documentar los permisos en CLAUDE.md"
git push -u origin feature/t-08a-guard-permisos
gh pr create --title "T-08a · Guard de permisos granulares" --body "$(cat <<'CUERPO'
Primera mitad de T-08: el mecanismo de permisos. La matriz de perfiles queda para T-08b, que
propongo llevar junto con T-13 (Usuarios) — ver el comentario en el issue #8.

## Que trae

- `@RequierePermiso('clave')` + `PermisosGuard` global, corriendo despues del guard de sesion.
- `permisos.ts` (nucleo puro: perfil + excepciones) y `permisos.repository.ts` (acceso a datos).
- Migracion que siembra `sucursal.gestionar`, que el catalogo de T-05 no traia.
- `POST` y `PATCH` de `/sucursales` lo exigen. **`GET` no**: el selector global de T-09 vive en la
  barra lateral de todas las paginas y lo usa cualquier usuario.
- `GET /auth/me` devuelve los permisos efectivos; el portal esconde lo que no se puede hacer.

## Decisiones que conviene mirar al revisar

- El bypass del perfil `Administrador General` vive en el **resolutor**, no en el guard, para que
  el guard y `/auth/me` no puedan discrepar.
- Los permisos se resuelven contra la base en **cada peticion**, no en el JWT: un cambio de
  permisos no puede tardar 15 min en aplicar.
- Los 6 perfiles quedan **vacios a proposito**. El cliente nunca dijo que permisos lleva cada uno;
  la matriz la configurara el en T-08b.

Detalle completo en `docs/superpowers/specs/2026-08-11-t08a-guard-permisos-design.md`.

Closes nothing todavia: el issue #8 sigue abierto hasta acordar la particion con @brg8607.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
CUERPO
)"
```

El vault es un repo aparte: commitear y empujar sus cambios por separado, desde `../jawa-obsidian-memory`.

---

## Notas para quien ejecute

**El orden importa.** Task 4 rompe pruebas que hoy pasan (el perfil elegido alfabéticamente); hacerla antes de Task 3 deja la suite roja sin manera de arreglarla.

**Si una prueba e2e falla con 403 inesperado**, lo primero que hay que mirar es el perfil del usuario que crea ese `beforeAll`. Los perfiles están vacíos, así que cualquier usuario que no sea `Administrador General` no tiene ningún permiso — y eso es correcto, no un bug.

**Si el backend no arranca con un error de inyección**, es que falta exportar `PermisosRepository` en `auth.module.ts`. El guard global se resuelve fuera del módulo; es exactamente la trampa que el comentario existente sobre `TokenVendedorService` ya documentaba.

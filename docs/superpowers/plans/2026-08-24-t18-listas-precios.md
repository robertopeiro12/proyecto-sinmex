# T-18 · Listas de precios por sucursal — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que administración pueda fijar y editar, desde el portal, el precio de cada presentación de producto por lista (Lista 1–4) y por sucursal, con historial ("de la fecha en adelante"), dejando el catálogo listo para que T-12 (Cartera de Clientes) asigne una lista a cada cliente.

**Architecture:** Backend NestJS en `modules/cartera-clientes/` (hoy un stub vacío), reusando `resolverAlcance()` de T-09 sin tocarla. Historización vía upsert (`INSERT ... ON CONFLICT`) sobre un `unique` nuevo en la base, respaldado por la fecha local que calcula el **navegador** (no el servidor, por el mismo riesgo de zona horaria que `fecha_operacion` de folios). En el portal, una pantalla propia con una matriz editable (presentación × lista), **no** una variante de `PantallaCatalogo`: T-10 ya anticipó que un caso así no encajaría en el envoltorio de catálogo.

**Tech Stack:** NestJS · Kysely · Postgres (Supabase) · pgTAP · Jest (backend) · Next.js 15 App Router · React 19 · Tailwind v4 · shadcn/ui

**Spec:** `docs/superpowers/specs/2026-08-24-t18-listas-precios-design.md` — las decisiones se citan como D1…D7.

## Global Constraints

- **Rama:** `feature/t-18-listas-precios`, base `main`, sin pila. El spec ya está commiteado en `main`.
- **Idioma del código:** identificadores, comentarios y mensajes de error **en español**, **sin acentos en los identificadores** (sí en los mensajes de cara al usuario). Los comentarios explican *por qué*, no *qué*.
- **Todo comando se corre desde la raíz del repo** con `--workspace=`, nunca entrando a `apps/*`.
- **`npm test`, `npm run test:e2e` y `supabase test db` exigen el stack local arriba.** En esta máquina el daemon de Docker lo da **Colima** (`colima start`), no Docker Desktop.
- **Nunca apuntar a `sinmex dev` durante la implementación.** `.env.test` va al Postgres local. `npm run backend` lee `.env.development`, que **sí** apunta a la nube — para la verificación manual del portal hay que apuntar `DATABASE_URL` de `.env.development` al Postgres local primero (ver Task 4).
- **La baja siempre es lógica**, nunca `delete` físico — la migración de la Task 1 da de baja `'Especial'` con `deleted_at`, no la borra.
- **`deleted_at` jamás se expone en una respuesta de la API.**
- **La respuesta de la API va en camelCase** (`presentacionId`, `vigenteDesde`).
- **`vigente_desde` lo calcula el NAVEGADOR** (fecha local, no `toISOString()` que es UTC), nunca el servidor — ver el `[!warning]` de D3 en el spec. El backend lo recibe como parte del cuerpo del `PATCH` y lo usa tal cual.
- **Conteos de partida: NO están escritos en este plan a propósito** (T-10 hardcodeó cifras estimadas y salieron mal). Antes de empezar, corre las tres suites y **anota tú los números reales**; cada paso de verificación compara contra tu propia línea base.

---

### Task 0: Rama y línea base

**Files:** ninguno (solo verificación).

**Interfaces:**
- Consumes: nada.
- Produces: la rama `feature/t-18-listas-precios` y los conteos de partida que usarán todas las tareas siguientes.

- [ ] **Step 1: Crear la rama desde `main` limpio**

```bash
git status --short
git checkout main && git pull
git checkout -b feature/t-18-listas-precios
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

Anota los cuatro números. **Todas las tareas siguientes comparan contra estos números**, no contra cifras escritas en este plan. Las cuatro suites tienen que estar en **verde** antes de tocar nada.

- [ ] **Step 4: Confirmar el estado de partida de `lista_precio` y `precio`**

```bash
psql "$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" -c \
  "select nombre, deleted_at is null as activa from lista_precio order by nombre;"
psql "$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" -c \
  "select count(*) as precios from precio;"
```

Esperado: **5** filas en `lista_precio` (incluida `Especial`, todavía activa — la Task 1 la da de baja) y `precios = 0`. Si `precios` no es 0, **detente**: hay datos de una prueba manual anterior que conviene entender antes de agregar el `unique` de la Task 1.

---

### Task 1: Migraciones — baja de 'Especial', unicidad de vigencia y permiso (D4, D5, modelo de datos)

**Files:**
- Create: `supabase/migrations/20260824120000_lista_precio_baja_especial.sql`
- Create: `supabase/migrations/20260824120100_precio_unicidad_vigencia.sql`
- Create: `supabase/migrations/20260824120200_permiso_precio_gestionar.sql`
- Create: `supabase/tests/96_precios_t18_test.sql`

**Interfaces:**
- Consumes: nada.
- Produces: exactamente 4 filas activas en `lista_precio`; el constraint `uq_precio_vigencia` sobre `precio(presentacion_id, lista_precio_id, sucursal_id, vigente_desde)`, del que depende el `ON CONFLICT` de `PreciosRepository.upsert()` en la Task 2; el permiso `precio.gestionar`, del que depende `@RequierePermiso` en `PreciosController.actualizar()`, también Task 2.

- [ ] **Step 1: Escribir la prueba pgTAP que falla**

Crea `supabase/tests/96_precios_t18_test.sql`:

```sql
begin;
select plan(6);

-- La baja logica de 'Especial' (confirmado en el vault 2026-08-23): no es una
-- lista de precio, es el override manual por cliente (tabla `cliente_precio`,
-- ya existe desde T-05). T-05 la sembro por error junto con las 4 reales.
select is(
  (select count(*)::int from lista_precio where deleted_at is null),
  4,
  'quedan exactamente 4 listas de precio activas'
);
select is(
  (select count(*)::int from lista_precio where nombre = 'Especial' and deleted_at is null),
  0,
  'Especial no aparece entre las listas activas'
);

-- Mismo patron que T-08a con sucursal.gestionar: el catalogo de permisos que
-- sembro T-05 no incluye ninguno para precios.
select is(
  (select count(*)::int from permiso where clave = 'precio.gestionar'),
  1,
  'existe el permiso precio.gestionar'
);

-- uq_precio_vigencia: producto/presentacion propios de la prueba (T-05 no
-- siembra ninguno), sucursal y lista de las semillas de T-05.
insert into producto (nombre) values ('Producto de prueba T-18');
create temporary table ref as
  select
    (select id from producto where nombre = 'Producto de prueba T-18') as producto,
    (select id from sucursal where codigo = 'TJ') as tj,
    (select id from sucursal where codigo = 'MX') as mx,
    (select id from lista_precio where nombre = 'Lista 1') as lista;

insert into presentacion (producto_id, volumen)
  select producto, '500 ml' from ref;
create temporary table ref2 as
  select
    (select id from presentacion where producto_id = (select producto from ref)) as presentacion;

insert into precio (presentacion_id, lista_precio_id, sucursal_id, precio, vigente_desde)
  select presentacion, lista, tj, 10.50, current_date from ref2, ref;

select throws_ok(
  $$insert into precio (presentacion_id, lista_precio_id, sucursal_id, precio, vigente_desde)
    select presentacion, lista, tj, 11.00, current_date from ref2, ref$$,
  '23505',
  null,
  'rechaza dos precios de la misma combinacion el mismo dia'
);

select lives_ok(
  $$insert into precio (presentacion_id, lista_precio_id, sucursal_id, precio, vigente_desde)
    select presentacion, lista, tj, 11.00, current_date + 1 from ref2, ref$$,
  'permite una vigencia en una fecha distinta para la misma combinacion'
);

select lives_ok(
  $$insert into precio (presentacion_id, lista_precio_id, sucursal_id, precio, vigente_desde)
    select presentacion, lista, mx, 12.00, current_date from ref2, ref$$,
  'permite la misma combinacion en otra sucursal el mismo dia'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
npm run supabase -- test db
```

Esperado: `96_precios_t18_test.sql` **falla** — los dos `is` de conteo dan 5 y 0 en vez de 4 y 1 (ninguna migración aplicada todavía), y el `throws_ok` no ve ningún error porque el `unique` no existe. Los `lives_ok` sí pasan. Si pasa entera, algo ya estaba aplicado: **detente**.

- [ ] **Step 3: Escribir las tres migraciones**

Crea `supabase/migrations/20260824120000_lista_precio_baja_especial.sql`:

```sql
-- El vault confirmo el 2026-08-23 que 'Especial' NO es una lista de precio:
-- es el override manual por cliente (tabla `cliente_precio`, ya existe desde
-- T-05). La semilla original de T-05 sembro 5 filas por error, contradiciendo
-- esa decision. Baja logica y no `delete`: si algun dia algo llegara a
-- referenciar esta fila no se rompe una referencia (hoy nada la usa -- no hay
-- pantalla de cliente todavia).
update lista_precio set deleted_at = now() where nombre = 'Especial';
```

Crea `supabase/migrations/20260824120100_precio_unicidad_vigencia.sql`:

```sql
-- T-05 creo `precio` sin ninguna restriccion de unicidad. Sin este unique, dos
-- ediciones del mismo dia para la misma combinacion (presentacion, lista,
-- sucursal) abren dos filas de historial en vez de corregir una, y la lectura
-- del precio VIGENTE (la fila mas reciente por combinacion) queda ambigua
-- entre las dos. Va en la base y no solo en el service por la misma razon que
-- el resto del esquema (T-09, T-10, T-11, T-14): las semillas y cualquier
-- carga futura entran por debajo de la API.
--
-- Este mismo constraint es lo que hace posible el upsert de T-18 sin un
-- SELECT previo: el service inserta con `ON CONFLICT ON CONSTRAINT
-- uq_precio_vigencia DO UPDATE`.
alter table precio
  add constraint uq_precio_vigencia
  unique (presentacion_id, lista_precio_id, sucursal_id, vigente_desde);
```

Crea `supabase/migrations/20260824120200_permiso_precio_gestionar.sql`:

```sql
-- Mismo patron que T-08a con sucursal.gestionar: el catalogo de permisos que
-- sembro T-05 viene del documento del cliente y no incluye ninguno para
-- administrar precios. Sin esta fila, cualquier usuario con sesion podria
-- editar precios.
insert into permiso (clave, grupo, descripcion) values
  ('precio.gestionar', 'General', 'Editar precios por lista y sucursal')
on conflict (clave) do nothing;
```

- [ ] **Step 4: Aplicar las migraciones y correr la prueba**

```bash
npm run supabase -- migration up --local
npm run supabase -- test db
```

Esperado: las 6 pruebas nuevas pasan, y el total pgTAP sube en 6 sobre tu línea base de la Task 0.

- [ ] **Step 5: Confirmar que `db:types` no hace falta**

Las tres migraciones no agregan columnas, solo un `update`, un `constraint` y una fila sembrada: `schema.d.ts` no cambia. No corras `npm run db:types`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260824120000_lista_precio_baja_especial.sql \
        supabase/migrations/20260824120100_precio_unicidad_vigencia.sql \
        supabase/migrations/20260824120200_permiso_precio_gestionar.sql \
        supabase/tests/96_precios_t18_test.sql
git commit -m "T-18 · Baja de 'Especial', unicidad de vigencia y permiso precio.gestionar

'Especial' no es una lista de precio (confirmado en el vault): es el
override manual por cliente. uq_precio_vigencia es lo que hace posible
el upsert del service sin un SELECT previo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FzJdFvymLvnh6sj1Ri33ds"
```

---

### Task 2: `GET /listas-precio` y `GET /precios` con alcance por sucursal (D1, D2, D3, D6)

**Files:**
- Create: `apps/backend/src/modules/cartera-clientes/precios.repository.ts`
- Create: `apps/backend/src/modules/cartera-clientes/precios.service.ts`
- Create: `apps/backend/src/modules/cartera-clientes/precios.controller.ts`
- Create: `apps/backend/src/modules/cartera-clientes/listas-precio.controller.ts`
- Modify: `apps/backend/src/modules/cartera-clientes/cartera-clientes.module.ts` (hoy `@Module({})` vacío)
- Create: `apps/backend/test/precios.e2e-spec.ts`

**Interfaces:**
- Consumes: `resolverAlcance()` y `normalizarSucursalPedida()` de `../sucursales/alcance-sucursal` (sin modificarlas); `aNumero()` de `../sincronizacion/dinero`; `DB_CONNECTION`/`Database` de `../../database/database.tokens`; `@UsuarioActual()` de `../auth/usuario-actual.decorator`.
- Produces: `interface ListaPrecio { id: string; nombre: string }` y `interface PrecioVigente { presentacionId: string; listaPrecioId: string; precio: number; vigenteDesde: string }` de `precios.repository.ts`. `PreciosRepository.buscarSucursalUsuario()` lo consume también la Task 3.

- [ ] **Step 1: Escribir el repositorio**

Crea `apps/backend/src/modules/cartera-clientes/precios.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aNumero } from '../sincronizacion/dinero';

export interface ListaPrecio {
  id: string;
  nombre: string;
}

export interface PrecioVigente {
  presentacionId: string;
  listaPrecioId: string;
  precio: number;
  vigenteDesde: string;
}

interface FilaVigente {
  presentacion_id: string;
  lista_precio_id: string;
  precio: string;
  vigente_desde: string;
}

function aPrecioVigente(fila: FilaVigente): PrecioVigente {
  return {
    presentacionId: fila.presentacion_id,
    listaPrecioId: fila.lista_precio_id,
    // `numeric` de Postgres llega como cadena, no numero (mismo motivo que
    // `km_inicial` de vehiculo en T-11). `aNumero()` se importa de
    // sincronizacion/dinero.ts en vez de duplicarse.
    precio: aNumero(fila.precio) ?? 0,
    vigenteDesde: fila.vigente_desde,
  };
}

@Injectable()
export class PreciosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async listarListas(): Promise<ListaPrecio[]> {
    return this.db
      .selectFrom('lista_precio')
      .select(['id', 'nombre'])
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .execute();
  }

  /**
   * El precio VIGENTE por presentacion x lista, para una sucursal: la fila con
   * `vigente_desde` mas reciente que no pase de hoy (D3 del spec). `DISTINCT
   * ON` de Postgres resuelve "la ultima fila por grupo" en una sola consulta,
   * sin traer el historial completo para filtrarlo en memoria -- Kysely no
   * tiene un helper propio para esto, asi que va en `sql` plano.
   *
   * Compara contra `current_date` de la BASE, no contra una fecha que calcule
   * el servidor de la app: es una comparacion `<=` tolerante, y Tijuana/
   * Mexicali estan detras de UTC, asi que la fecha local del navegador (la que
   * escribio el PATCH de la Task 3) nunca queda por delante de la fecha UTC
   * del servidor en el mismo instante.
   *
   * `p.vigente_desde::text`: sin el cast, el driver `pg` parsea una columna
   * `date` como un `Date` de JS a la medianoche LOCAL del proceso de Node, no
   * UTC. Volver a convertir ese `Date` a texto con `toISOString()` (que SI es
   * UTC) corre la fecha un dia hacia atras en cualquier maquina cuyo huso
   * horario este ADELANTE de UTC -- el entorno de desarrollo de este equipo
   * (Europe/Madrid) es exactamente ese caso. Mismo espiritu que `aNumero()`
   * en dinero.ts: no confiar en el parseo de tipos de `pg`, quedarse con el
   * texto que Postgres ya formateo bien.
   */
  async listarVigentes(sucursalCodigo: string): Promise<PrecioVigente[]> {
    const filas = await sql<FilaVigente>`
      select distinct on (p.presentacion_id, p.lista_precio_id)
        p.presentacion_id, p.lista_precio_id, p.precio,
        p.vigente_desde::text as vigente_desde
      from precio p
      join sucursal s on s.id = p.sucursal_id
      where s.codigo = ${sucursalCodigo}
        and p.deleted_at is null
        and p.vigente_desde <= current_date
      order by p.presentacion_id, p.lista_precio_id, p.vigente_desde desc
    `.execute(this.db);

    return filas.rows.map(aPrecioVigente);
  }

  /**
   * Upsert sobre `uq_precio_vigencia` (Task 1): si el admin ya edito esta
   * combinacion en la fecha que trae `datos.vigenteDesde`, corrige esa fila;
   * si no, abre un tramo nuevo de historia. El constraint es lo que hace esto
   * atomico sin un SELECT previo.
   *
   * Sin `.returning()`: no hace falta leer de vuelta lo que la base acaba de
   * guardar, porque ya lo conocemos -- son los mismos `datos` que mandamos.
   * Evita ademas tener que re-convertir un `vigente_desde` que volviera como
   * `Date` (ver el comentario de `listarVigentes` sobre el riesgo de huso
   * horario de `toISOString()`); aqui ese riesgo ni siquiera puede aparecer.
   */
  async upsert(datos: {
    presentacionId: string;
    listaPrecioId: string;
    sucursalId: string;
    precio: number;
    vigenteDesde: string;
  }): Promise<PrecioVigente> {
    await this.db
      .insertInto('precio')
      .values({
        presentacion_id: datos.presentacionId,
        lista_precio_id: datos.listaPrecioId,
        sucursal_id: datos.sucursalId,
        precio: datos.precio.toString(),
        vigente_desde: datos.vigenteDesde,
      })
      .onConflict((oc) =>
        oc
          .constraint('uq_precio_vigencia')
          .doUpdateSet({ precio: datos.precio.toString() }),
      )
      .executeTakeFirstOrThrow();

    return {
      presentacionId: datos.presentacionId,
      listaPrecioId: datos.listaPrecioId,
      precio: datos.precio,
      vigenteDesde: datos.vigenteDesde,
    };
  }

  /**
   * La sucursal del usuario. Duplica ~10 lineas de VehiculosRepository de
   * T-11 a proposito (D7 de ese spec, mismo criterio aqui): la alternativa es
   * una capa compartida de "repositorio con alcance" que hoy usarian tres
   * modulos. Se extrae cuando el patron este claro con una cuarta copia, no
   * antes.
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

- [ ] **Step 2: Escribir el servicio**

Crea `apps/backend/src/modules/cartera-clientes/precios.service.ts`:

```ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { resolverAlcance } from '../sucursales/alcance-sucursal';
import {
  PreciosRepository,
  type ListaPrecio,
  type PrecioVigente,
} from './precios.repository';
import type { ActualizarPrecioDto } from './dto/actualizar-precio.dto';

/** `23503` es foreign_key_violation: presentacionId, listaPrecioId o sucursalId no existen. */
function esViolacionFk(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23503'
  );
}

@Injectable()
export class PreciosService {
  constructor(private readonly repo: PreciosRepository) {}

  async listarListas(): Promise<ListaPrecio[]> {
    return this.repo.listarListas();
  }

  async listarVigentes(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<PrecioVigente[]> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    const alcance = resolverAlcance(fila.codigo, sucursalPedida);
    // A diferencia de vehiculos (que puede listar "todas" en una tabla
    // plana con columna Sucursal), la matriz de precios pinta UNA sucursal a
    // la vez (D7 del spec): no hay una forma sensata de responder "todas".
    if (alcance.tipo === 'todas') {
      throw new BadRequestException(
        'Elige una sucursal: el precio varía por sucursal.',
      );
    }
    return this.repo.listarVigentes(alcance.codigo);
  }

  /**
   * A diferencia de la edicion de vehiculo (T-11), aqui no hay una fila
   * existente que leer para comparar sucursales: el cuerpo del PATCH siempre
   * trae un `sucursalId` concreto (D del spec, tabla de Endpoints), y lo que
   * se valida es que ese id sea el que le toca al usuario -- comparando ids
   * directamente, sin pasar por `resolverAlcance()` (aqui no hay "todas" que
   * resolver).
   */
  async actualizar(
    usuarioId: string,
    dto: ActualizarPrecioDto,
  ): Promise<PrecioVigente> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    if (fila.id !== null && fila.id !== dto.sucursalId) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }

    try {
      return await this.repo.upsert(dto);
    } catch (error) {
      if (esViolacionFk(error)) {
        throw new NotFoundException('Alguno de los datos enviados no existe.');
      }
      throw error;
    }
  }
}
```

> [!info] El método `actualizar` referencia el DTO de la Task 3
> `precios.service.ts` importa `ActualizarPrecioDto` de `./dto/actualizar-precio.dto`, que todavía no existe en este paso. Está bien: TypeScript no compila hasta que la Task 3 cree ese archivo. El `GET` de esta tarea no depende de él; el `PATCH` completo (controller + DTO) llega en la Task 3.

- [ ] **Step 3: Escribir los controllers**

Crea `apps/backend/src/modules/cartera-clientes/listas-precio.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { PreciosService } from './precios.service';
import type { ListaPrecio } from './precios.repository';

// Sin @RequierePermiso(): cualquier pantalla que hable de precios lo va a
// necesitar (T-12, y mas adelante Ventas), no solo quien los administra.
// Mismo criterio que GET /productos (T-10) y GET /vehiculos (T-11).
@Controller('listas-precio')
export class ListasPrecioController {
  constructor(private readonly precios: PreciosService) {}

  @Get()
  async listar(): Promise<ListaPrecio[]> {
    return this.precios.listarListas();
  }
}
```

Crea `apps/backend/src/modules/cartera-clientes/precios.controller.ts`:

```ts
import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import { PreciosService } from './precios.service';
import { ActualizarPrecioDto } from './dto/actualizar-precio.dto';
import type { PrecioVigente } from './precios.repository';

@Controller('precios')
export class PreciosController {
  constructor(private readonly precios: PreciosService) {}

  @Get()
  async listar(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
  ): Promise<PrecioVigente[]> {
    return this.precios.listarVigentes(
      usuarioId,
      normalizarSucursalPedida(sucursal),
    );
  }

  @Patch()
  @RequierePermiso('precio.gestionar')
  async actualizar(
    @UsuarioActual() usuarioId: string,
    @Body() dto: ActualizarPrecioDto,
  ): Promise<PrecioVigente> {
    return this.precios.actualizar(usuarioId, dto);
  }
}
```

`PreciosController` importa `ActualizarPrecioDto`, que la Task 3 todavía no ha creado — el build no va a compilar hasta el final de la Task 3. Es esperado: los dos controllers y el DTO se completan en la misma corrida antes de verificar.

- [ ] **Step 4: Registrar el módulo**

Reemplaza `apps/backend/src/modules/cartera-clientes/cartera-clientes.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ListasPrecioController } from './listas-precio.controller';
import { PreciosController } from './precios.controller';
import { PreciosRepository } from './precios.repository';
import { PreciosService } from './precios.service';

// Cartera de Clientes es el modulo de dominio del vault que agrupa Cliente y
// Lista de precios (Lista de precios.md declara `modulo: cartera-clientes`).
// Precios es lo primero que lo llena; Cliente llega con T-12.
@Module({
  controllers: [ListasPrecioController, PreciosController],
  providers: [PreciosService, PreciosRepository],
})
export class CarteraClientesModule {}
```

No hace falta tocar `app.module.ts`: `CarteraClientesModule` ya está importado ahí desde que el stub se creó.

- [ ] **Step 5: Crear el DTO mínimo para poder compilar (se completa en la Task 3)**

Crea `apps/backend/src/modules/cartera-clientes/dto/actualizar-precio.dto.ts` con el contenido final (la Task 3 no lo vuelve a tocar, solo lo consume en sus pruebas):

```ts
import { IsNumber, IsUUID, Matches, Max, Min } from 'class-validator';

export class ActualizarPrecioDto {
  @IsUUID()
  presentacionId!: string;

  @IsUUID()
  listaPrecioId!: string;

  @IsUUID()
  sucursalId!: string;

  // La columna es `numeric(12,2)`: 10 digitos enteros + 2 decimales. Sin este
  // tope, Postgres levanta un 22003 (numeric field overflow) que nadie mapea
  // y el usuario recibe un 500 por un digito de mas (mismo motivo que
  // km_inicial en T-11).
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El precio debe ser un número con hasta 2 decimales.' },
  )
  @Min(0.01, { message: 'El precio debe ser mayor que cero.' })
  @Max(9999999999.99, {
    message: 'El precio no puede pasar de 9,999,999,999.99.',
  })
  precio!: number;

  // Fecha LOCAL del navegador (D3 del spec), NUNCA algo que el servidor
  // derive. `@Matches` en vez de `@IsDateString()`: este ultimo acepta
  // datetimes ISO completos, y aqui solo interesa la fecha.
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener el formato AAAA-MM-DD.',
  })
  vigenteDesde!: string;
}
```

- [ ] **Step 6: Verificar que compila**

```bash
npm run build --workspace=apps/backend
```

Esperado: compila sin errores. Si `precios.controller.ts` o `precios.service.ts` truenan por el DTO, revisa la ruta del import (`./dto/actualizar-precio.dto`).

- [ ] **Step 7: Escribir las pruebas e2e de los `GET`**

Crea `apps/backend/test/precios.e2e-spec.ts`:

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

interface ListaPrecioRespuesta {
  id: string;
  nombre: string;
}

interface PrecioRespuesta {
  presentacionId: string;
  listaPrecioId: string;
  precio: number;
  vigenteDesde: string;
}

const SUFIJO = Date.now();
const LOGIN_GENERAL = `e2e-pre-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-pre-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-pre-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const PREFIJO = `ZZ-e2e-precios-${SUFIJO}`;
// Fecha LOCAL del navegador en produccion (D3); aqui basta con la fecha del
// runner de CI, que es UTC, para probar la plomeria -- no hay logica de
// zona horaria que probar del lado del cliente en este archivo.
const HOY = new Date().toISOString().slice(0, 10);

describe('Precios (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const productoIds: string[] = [];
  let idTijuana: string;
  let idMexicali: string;
  let idLista1: string;
  let idLista2: string;
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

  /** Producto + presentacion propios de esta suite, por debajo de la API. */
  const sembrarPresentacion = async (
    nombreProducto: string,
    volumen: string,
  ): Promise<string> => {
    const { id: productoId } = await db
      .insertInto('producto')
      .values({ nombre: nombreProducto })
      .returning('id')
      .executeTakeFirstOrThrow();
    productoIds.push(productoId);
    const { id: presentacionId } = await db
      .insertInto('presentacion')
      .values({ producto_id: productoId, volumen })
      .returning('id')
      .executeTakeFirstOrThrow();
    return presentacionId;
  };

  /** Inserta un precio directo, sin pasar por el upsert del servicio. */
  const sembrarPrecio = async (datos: {
    presentacionId: string;
    listaPrecioId: string;
    sucursalId: string;
    precio: number;
    vigenteDesde: string;
  }): Promise<void> => {
    await db
      .insertInto('precio')
      .values({
        presentacion_id: datos.presentacionId,
        lista_precio_id: datos.listaPrecioId,
        sucursal_id: datos.sucursalId,
        precio: datos.precio.toString(),
        vigente_desde: datos.vigenteDesde,
      })
      .execute();
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

    const lista1 = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    idLista1 = lista1.id;

    const lista2 = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 2')
      .executeTakeFirstOrThrow();
    idLista2 = lista2.id;

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', idTijuana);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);

    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    if (productoIds.length > 0) {
      await db
        .deleteFrom('precio')
        .where(
          'presentacion_id',
          'in',
          db
            .selectFrom('presentacion')
            .select('id')
            .where('producto_id', 'in', productoIds),
        )
        .execute();
      await db
        .deleteFrom('presentacion')
        .where('producto_id', 'in', productoIds)
        .execute();
      await db.deleteFrom('producto').where('id', 'in', productoIds).execute();
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

  describe('GET /listas-precio', () => {
    it('devuelve exactamente las 4 listas activas, sin Especial', async () => {
      const res = await request(app.getHttpServer())
        .get('/listas-precio')
        .set('Cookie', cookieSinPermiso)
        .expect(200);

      const nombres = (res.body as ListaPrecioRespuesta[])
        .map((l) => l.nombre)
        .sort();
      expect(nombres).toEqual(['Lista 1', 'Lista 2', 'Lista 3', 'Lista 4']);
    });

    it('rechaza a quien no tiene sesion', async () => {
      await request(app.getHttpServer()).get('/listas-precio').expect(401);
    });
  });

  describe('GET /precios', () => {
    it('un usuario General sin sucursal recibe 400', async () => {
      await request(app.getHttpServer())
        .get('/precios')
        .set('Cookie', cookieGeneral)
        .expect(400);
    });

    it('devuelve el precio vigente por presentacion y lista', async () => {
      const presentacionId = await sembrarPresentacion(
        `${PREFIJO} Producto`,
        '500 ml',
      );
      await sembrarPrecio({
        presentacionId,
        listaPrecioId: idLista1,
        sucursalId: idTijuana,
        precio: 10.5,
        vigenteDesde: '2026-01-01',
      });

      const res = await request(app.getHttpServer())
        .get('/precios?sucursal=TJ')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const fila = (res.body as PrecioRespuesta[]).find(
        (p) => p.presentacionId === presentacionId,
      );
      expect(fila).toBeDefined();
      expect(fila?.precio).toBe(10.5);
    });

    it('cuando hay dos vigencias, gana la mas reciente que no pase de hoy', async () => {
      const presentacionId = await sembrarPresentacion(
        `${PREFIJO} Historial`,
        '1 L',
      );
      await sembrarPrecio({
        presentacionId,
        listaPrecioId: idLista1,
        sucursalId: idTijuana,
        precio: 10,
        vigenteDesde: '2026-01-01',
      });
      await sembrarPrecio({
        presentacionId,
        listaPrecioId: idLista1,
        sucursalId: idTijuana,
        precio: 20,
        vigenteDesde: '2026-06-01',
      });

      const res = await request(app.getHttpServer())
        .get('/precios?sucursal=TJ')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const fila = (res.body as PrecioRespuesta[]).find(
        (p) => p.presentacionId === presentacionId,
      );
      expect(fila?.precio).toBe(20);
    });

    it('una vigencia futura todavia no se ve', async () => {
      const presentacionId = await sembrarPresentacion(
        `${PREFIJO} Futuro`,
        '2 L',
      );
      const enUnAnio = new Date();
      enUnAnio.setFullYear(enUnAnio.getFullYear() + 1);
      await sembrarPrecio({
        presentacionId,
        listaPrecioId: idLista1,
        sucursalId: idTijuana,
        precio: 99,
        vigenteDesde: enUnAnio.toISOString().slice(0, 10),
      });

      const res = await request(app.getHttpServer())
        .get('/precios?sucursal=TJ')
        .set('Cookie', cookieGeneral)
        .expect(200);

      expect(
        (res.body as PrecioRespuesta[]).some(
          (p) => p.presentacionId === presentacionId,
        ),
      ).toBe(false);
    });

    it('una presentacion sin ningun precio no aparece (no truena)', async () => {
      const presentacionId = await sembrarPresentacion(
        `${PREFIJO} SinPrecio`,
        '3 L',
      );

      const res = await request(app.getHttpServer())
        .get('/precios?sucursal=TJ')
        .set('Cookie', cookieGeneral)
        .expect(200);

      expect(
        (res.body as PrecioRespuesta[]).some(
          (p) => p.presentacionId === presentacionId,
        ),
      ).toBe(false);
    });

    it('un usuario atado a TJ ve sus precios sin mandar el query param', async () => {
      const presentacionId = await sembrarPresentacion(
        `${PREFIJO} Atado`,
        '500 ml',
      );
      await sembrarPrecio({
        presentacionId,
        listaPrecioId: idLista2,
        sucursalId: idTijuana,
        precio: 7,
        vigenteDesde: '2026-01-01',
      });

      const res = await request(app.getHttpServer())
        .get('/precios')
        .set('Cookie', cookieTijuana)
        .expect(200);

      expect(
        (res.body as PrecioRespuesta[]).some(
          (p) => p.presentacionId === presentacionId,
        ),
      ).toBe(true);
    });

    it('un usuario atado a TJ no puede pedir los precios de MX', async () => {
      await request(app.getHttpServer())
        .get('/precios?sucursal=MX')
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('deja consultar aunque el usuario no tenga precio.gestionar', async () => {
      await request(app.getHttpServer())
        .get('/precios?sucursal=TJ')
        .set('Cookie', cookieSinPermiso)
        .expect(200);
    });

    it('rechaza a quien no tiene sesion', async () => {
      await request(app.getHttpServer())
        .get('/precios?sucursal=TJ')
        .expect(401);
    });
  });
});
```

- [ ] **Step 8: Correr las pruebas e2e**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: `precios.e2e-spec.ts` pasa entero (11 pruebas nuevas), sin afectar las demás suites. Si `un usuario General sin sucursal recibe 400` falla, revisa que `PreciosService.listarVigentes` rechace `alcance.tipo === 'todas'` **antes** de llamar al repositorio.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/cartera-clientes/ apps/backend/test/precios.e2e-spec.ts
git commit -m "T-18 · GET /listas-precio y GET /precios con alcance por sucursal

La matriz de precios pinta UNA sucursal a la vez (D7 del spec): a
diferencia de vehiculos, un usuario General sin seleccion recibe 400 en
vez de 'todas mezcladas'.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FzJdFvymLvnh6sj1Ri33ds"
```

---

### Task 3: `PATCH /precios` — upsert sobre la vigencia del navegador (D3, D4)

**Files:**
- Modify: `apps/backend/test/precios.e2e-spec.ts` (agrega el `describe('PATCH /precios', ...)`)

El DTO, el controller y el servicio ya quedaron completos en la Task 2 (se necesitaban ahí para que el build compilara). Esta tarea solo agrega su cobertura e2e.

**Interfaces:**
- Consumes: `PreciosService.actualizar()`, `ActualizarPrecioDto` y `PrecioVigente` de la Task 2.
- Produces: nada nuevo — cierra la cobertura de lo que la Task 2 ya escribió.

- [ ] **Step 1: Escribir las pruebas del `PATCH`**

Agrega este bloque **dentro de `describe('Precios (e2e)', ...)`**, después del `describe('GET /precios', ...)` de `apps/backend/test/precios.e2e-spec.ts`:

```ts
  describe('PATCH /precios', () => {
    it('crea un precio nuevo cuando no existia ninguno', async () => {
      const presentacionId = await sembrarPresentacion(
        `${PREFIJO} Alta`,
        '500 ml',
      );

      const res = await request(app.getHttpServer())
        .patch('/precios')
        .set('Cookie', cookieGeneral)
        .send({
          presentacionId,
          listaPrecioId: idLista1,
          sucursalId: idTijuana,
          precio: 12.5,
          vigenteDesde: HOY,
        })
        .expect(200);

      expect((res.body as PrecioRespuesta).precio).toBe(12.5);

      const filas = await db
        .selectFrom('precio')
        .select('id')
        .where('presentacion_id', '=', presentacionId)
        .where('lista_precio_id', '=', idLista1)
        .where('sucursal_id', '=', idTijuana)
        .execute();
      expect(filas).toHaveLength(1);
    });

    it('editar la misma vigencia corrige la fila, no la duplica', async () => {
      const presentacionId = await sembrarPresentacion(
        `${PREFIJO} Corrige`,
        '1 L',
      );
      const cuerpo = {
        presentacionId,
        listaPrecioId: idLista1,
        sucursalId: idTijuana,
        vigenteDesde: HOY,
      };

      await request(app.getHttpServer())
        .patch('/precios')
        .set('Cookie', cookieGeneral)
        .send({ ...cuerpo, precio: 10 })
        .expect(200);

      const segunda = await request(app.getHttpServer())
        .patch('/precios')
        .set('Cookie', cookieGeneral)
        .send({ ...cuerpo, precio: 15 })
        .expect(200);

      expect((segunda.body as PrecioRespuesta).precio).toBe(15);

      const filas = await db
        .selectFrom('precio')
        .select('precio')
        .where('presentacion_id', '=', presentacionId)
        .where('lista_precio_id', '=', idLista1)
        .where('sucursal_id', '=', idTijuana)
        .execute();
      expect(filas).toHaveLength(1);
      expect(Number(filas[0].precio)).toBe(15);
    });

    it('un usuario de TJ edita en TJ sin problema', async () => {
      const presentacionId = await sembrarPresentacion(
        `${PREFIJO} PropioTJ`,
        '500 ml',
      );

      await request(app.getHttpServer())
        .patch('/precios')
        .set('Cookie', cookieTijuana)
        .send({
          presentacionId,
          listaPrecioId: idLista1,
          sucursalId: idTijuana,
          precio: 9,
          vigenteDesde: HOY,
        })
        .expect(200);
    });

    it('un usuario de TJ no puede editar un precio de MX', async () => {
      const presentacionId = await sembrarPresentacion(
        `${PREFIJO} AjenoMX`,
        '500 ml',
      );

      await request(app.getHttpServer())
        .patch('/precios')
        .set('Cookie', cookieTijuana)
        .send({
          presentacionId,
          listaPrecioId: idLista1,
          sucursalId: idMexicali,
          precio: 9,
          vigenteDesde: HOY,
        })
        .expect(403);
    });

    it('el usuario General puede editar en cualquier sucursal', async () => {
      const presentacionId = await sembrarPresentacion(
        `${PREFIJO} GeneralMX`,
        '500 ml',
      );

      await request(app.getHttpServer())
        .patch('/precios')
        .set('Cookie', cookieGeneral)
        .send({
          presentacionId,
          listaPrecioId: idLista1,
          sucursalId: idMexicali,
          precio: 9,
          vigenteDesde: HOY,
        })
        .expect(200);
    });

    it('rechaza sin el permiso precio.gestionar', async () => {
      const presentacionId = await sembrarPresentacion(
        `${PREFIJO} SinPermiso`,
        '500 ml',
      );

      await request(app.getHttpServer())
        .patch('/precios')
        .set('Cookie', cookieSinPermiso)
        .send({
          presentacionId,
          listaPrecioId: idLista1,
          sucursalId: idTijuana,
          precio: 9,
          vigenteDesde: HOY,
        })
        .expect(403);
    });

    it('rechaza sin sesion', async () => {
      await request(app.getHttpServer())
        .patch('/precios')
        .send({
          presentacionId: idLista1,
          listaPrecioId: idLista1,
          sucursalId: idTijuana,
          precio: 9,
          vigenteDesde: HOY,
        })
        .expect(401);
    });

    it('rechaza un precio en cero o negativo', async () => {
      const presentacionId = await sembrarPresentacion(
        `${PREFIJO} Cero`,
        '500 ml',
      );
      const base = {
        presentacionId,
        listaPrecioId: idLista1,
        sucursalId: idTijuana,
        vigenteDesde: HOY,
      };

      await request(app.getHttpServer())
        .patch('/precios')
        .set('Cookie', cookieGeneral)
        .send({ ...base, precio: 0 })
        .expect(400);

      await request(app.getHttpServer())
        .patch('/precios')
        .set('Cookie', cookieGeneral)
        .send({ ...base, precio: -5 })
        .expect(400);
    });

    it('rechaza mas de 2 decimales', async () => {
      const presentacionId = await sembrarPresentacion(
        `${PREFIJO} Decimales`,
        '500 ml',
      );

      await request(app.getHttpServer())
        .patch('/precios')
        .set('Cookie', cookieGeneral)
        .send({
          presentacionId,
          listaPrecioId: idLista1,
          sucursalId: idTijuana,
          precio: 10.123,
          vigenteDesde: HOY,
        })
        .expect(400);
    });

    it('una presentacion que no existe responde 404', async () => {
      await request(app.getHttpServer())
        .patch('/precios')
        .set('Cookie', cookieGeneral)
        .send({
          presentacionId: '00000000-0000-0000-0000-000000000000',
          listaPrecioId: idLista1,
          sucursalId: idTijuana,
          precio: 9,
          vigenteDesde: HOY,
        })
        .expect(404);
    });

    it('un id mal formado responde 400, no 500', async () => {
      const presentacionId = await sembrarPresentacion(
        `${PREFIJO} Malformado`,
        '500 ml',
      );

      await request(app.getHttpServer())
        .patch('/precios')
        .set('Cookie', cookieGeneral)
        .send({
          presentacionId,
          listaPrecioId: 'no-soy-un-uuid',
          sucursalId: idTijuana,
          precio: 9,
          vigenteDesde: HOY,
        })
        .expect(400);
    });

    it('una fecha con formato invalido responde 400', async () => {
      const presentacionId = await sembrarPresentacion(
        `${PREFIJO} FechaMala`,
        '500 ml',
      );

      await request(app.getHttpServer())
        .patch('/precios')
        .set('Cookie', cookieGeneral)
        .send({
          presentacionId,
          listaPrecioId: idLista1,
          sucursalId: idTijuana,
          precio: 9,
          vigenteDesde: '24-08-2026',
        })
        .expect(400);
    });
  });
```

- [ ] **Step 2: Correr las pruebas e2e**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: `precios.e2e-spec.ts` pasa entero. Contando desde la Task 2, este archivo sube en 12 pruebas nuevas (11 + 12 = 23 en total en el archivo). Compara el total de la suite e2e contra tu línea base de la Task 0.

- [ ] **Step 3: Confirmar en la base que el upsert no dejó basura**

```bash
psql "$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" -c \
  "select count(*) from precio where sucursal_id = (select id from sucursal where codigo='TJ') and presentacion_id in (select id from presentacion where producto_id in (select id from producto where nombre like 'ZZ-e2e-precios-%Corrige'));"
```

Esperado: `1` (la prueba de "editar la misma vigencia corrige la fila" no dejó una fila duplicada de verdad, no solo en la aserción de Jest).

- [ ] **Step 4: Commit**

```bash
git add apps/backend/test/precios.e2e-spec.ts
git commit -m "T-18 · Cobertura e2e de PATCH /precios

Cubre el upsert sobre uq_precio_vigencia (corrige, no duplica), el
alcance por sucursal comparando ids directamente (sin 'todas' que
resolver) y los 404 por FK inexistente.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FzJdFvymLvnh6sj1Ri33ds"
```

---

### Task 4: La pantalla del portal (D6, D7)

**Files:**
- Create: `apps/portal/src/lib/precios.ts`
- Create: `apps/portal/src/components/precios/celda-precio.tsx`
- Create: `apps/portal/src/components/precios/pantalla-precios.tsx`
- Create: `apps/portal/src/app/(portal)/catalogo/precios/page.tsx`
- Modify: `apps/portal/src/components/layout/nav-config.ts`

**Interfaces:**
- Consumes: `apiFetch`/`ErrorApi` de `@/lib/api`; `Producto`/`listarProductos` de `@/lib/productos`; `Sucursal`/`listarSucursales` de `@/lib/sucursales`; `useAuth` de `@/components/auth/auth-provider`; `useEnvioFormulario` de `@/components/catalogo/use-envio-formulario`; los endpoints de las Tasks 2 y 3.
- Produces: `interface ListaPrecio`, `interface Precio`, `listarListasPrecio()`, `listarPrecios()`, `actualizarPrecio()` de `lib/precios.ts`. Nada más los consume: es la punta del árbol.

**Sin pruebas automatizadas de pantalla**, mismo gap conocido que el resto del portal (T-03/T-09/T-10/T-11 lo dejaron anotado). La verificación es el checklist manual del Step 6.

- [ ] **Step 1: Escribir el cliente de la API**

Crea `apps/portal/src/lib/precios.ts`:

```ts
import { apiFetch } from "./api";

export interface ListaPrecio {
  id: string;
  nombre: string;
}

export interface Precio {
  presentacionId: string;
  listaPrecioId: string;
  precio: number;
  vigenteDesde: string;
}

export function listarListasPrecio(): Promise<ListaPrecio[]> {
  return apiFetch<ListaPrecio[]>("/listas-precio");
}

/** @param sucursal codigo de la sucursal (nunca vacio: la pantalla no llama esto sin uno). */
export function listarPrecios(sucursal: string): Promise<Precio[]> {
  return apiFetch<Precio[]>(`/precios?sucursal=${encodeURIComponent(sucursal)}`);
}

/**
 * Fecha LOCAL del navegador, NUNCA `toISOString()` (que es UTC). Mismo riesgo
 * de zona horaria que `fecha_operacion` de folios (CLAUDE.md): Tijuana y
 * Mexicali estan detras de UTC, y el backend usa esta fecha tal cual para
 * `vigente_desde` (D3 del spec de T-18).
 */
function hoyLocalIso(): string {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const dia = String(ahora.getDate()).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

export function actualizarPrecio(datos: {
  presentacionId: string;
  listaPrecioId: string;
  sucursalId: string;
  precio: number;
}): Promise<Precio> {
  return apiFetch<Precio>("/precios", {
    method: "PATCH",
    body: JSON.stringify({ ...datos, vigenteDesde: hoyLocalIso() }),
  });
}
```

- [ ] **Step 2: Escribir la celda editable**

Crea `apps/portal/src/components/precios/celda-precio.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { actualizarPrecio } from "@/lib/precios";

interface Props {
  presentacionId: string;
  listaPrecioId: string;
  sucursalId: string;
  /** null = todavia no tiene precio para esta combinacion (D6 del spec). */
  precioInicial: number | null;
  editable: boolean;
  alGuardar: (precio: number) => void;
}

const aTexto = (precio: number | null): string =>
  precio === null ? "" : precio.toString();

/**
 * Una celda de la matriz. El estado local arranca de `precioInicial` UNA sola
 * vez: `PantallaPrecios` remonta la matriz entera con `key={sucursalId}` al
 * cambiar de sucursal, asi que esta celda nunca necesita resincronizarse con
 * un prop que cambio por debajo -- evita el efecto que sincronizaria estado
 * con props, que perderia lo que el usuario esta tecleando si el padre
 * recargara por cualquier otro motivo.
 */
export function CeldaPrecio({
  presentacionId,
  listaPrecioId,
  sucursalId,
  precioInicial,
  editable,
  alGuardar,
}: Props) {
  const [valor, setValor] = useState(aTexto(precioInicial));
  const { enviando, error, enviar } = useEnvioFormulario(
    "No se pudo guardar el precio.",
  );

  async function guardar() {
    const texto = valor.trim();
    const numero = Number(texto);

    // Vacio, no numero, o sin cambio real: no hay nada que mandar. Restaura
    // el valor mostrado al ultimo precio conocido en vez de dejar la celda a
    // medio escribir.
    if (texto === "" || Number.isNaN(numero) || numero <= 0) {
      setValor(aTexto(precioInicial));
      return;
    }
    if (numero === precioInicial) {
      return;
    }

    await enviar(async () => {
      const actualizado = await actualizarPrecio({
        presentacionId,
        listaPrecioId,
        sucursalId,
        precio: numero,
      });
      alGuardar(actualizado.precio);
    }, () => {});
  }

  if (!editable) {
    return (
      <span>{precioInicial === null ? "—" : precioInicial.toFixed(2)}</span>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <input
        type="number"
        min={0.01}
        step="0.01"
        placeholder="Sin precio"
        disabled={enviando}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onBlur={() => void guardar()}
        className="w-24 rounded-md border px-2 py-1 text-sm"
      />
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 3: Escribir la pantalla**

Crea `apps/portal/src/components/precios/pantalla-precios.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { listarProductos, type Producto } from "@/lib/productos";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import {
  listarListasPrecio,
  listarPrecios,
  type ListaPrecio,
} from "@/lib/precios";
import { CeldaPrecio } from "./celda-precio";

interface PrecioCelda {
  presentacionId: string;
  listaPrecioId: string;
  precio: number;
}

export function PantallaPrecios({ sucursal }: { sucursal: string | null }) {
  const { usuario, puede } = useAuth();
  const puedeGestionar = puede("precio.gestionar");

  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  useEffect(() => {
    listarSucursales()
      .then(setSucursales)
      .catch(() => setSucursales([]));
  }, []);

  // Atado: siempre la suya, sin importar el filtro global (el selector ni
  // siquiera le pinta un <select>, ver selector-sucursal.tsx). General: la
  // que elija el selector, o ninguna hasta que elija -- la matriz pinta UNA
  // sucursal a la vez (D7 del spec), a diferencia de Vehiculos.
  const sucursalActual =
    usuario?.sucursal ?? sucursales.find((s) => s.codigo === sucursal) ?? null;

  if (usuario !== null && usuario.sucursal === null && !sucursal) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Listas de Precios</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Elige una sucursal en el filtro para ver y editar sus precios.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!sucursalActual) {
    // Sesion o lista de sucursales todavia cargando.
    return null;
  }

  return (
    <MatrizPrecios
      key={sucursalActual.id}
      sucursalId={sucursalActual.id}
      sucursalCodigo={sucursalActual.codigo}
      puedeGestionar={puedeGestionar}
    />
  );
}

function MatrizPrecios({
  sucursalId,
  sucursalCodigo,
  puedeGestionar,
}: {
  sucursalId: string;
  sucursalCodigo: string;
  puedeGestionar: boolean;
}) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [listas, setListas] = useState<ListaPrecio[]>([]);
  const [precios, setPrecios] = useState<PrecioCelda[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError(null);
    Promise.all([
      listarProductos(),
      listarListasPrecio(),
      listarPrecios(sucursalCodigo),
    ])
      .then(([p, l, pr]) => {
        if (!vigente) return;
        setProductos(p);
        setListas(l);
        setPrecios(
          pr.map(({ presentacionId, listaPrecioId, precio }) => ({
            presentacionId,
            listaPrecioId,
            precio,
          })),
        );
      })
      .catch(() => {
        if (vigente) setError("No se pudieron cargar los precios.");
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [sucursalCodigo]);

  function precioDe(presentacionId: string, listaPrecioId: string): number | null {
    return (
      precios.find(
        (p) =>
          p.presentacionId === presentacionId &&
          p.listaPrecioId === listaPrecioId,
      )?.precio ?? null
    );
  }

  function alGuardarCelda(
    presentacionId: string,
    listaPrecioId: string,
    precio: number,
  ) {
    setPrecios((previos) => [
      ...previos.filter(
        (p) =>
          !(
            p.presentacionId === presentacionId &&
            p.listaPrecioId === listaPrecioId
          ),
      ),
      { presentacionId, listaPrecioId, precio },
    ]);
  }

  if (cargando) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Listas de Precios</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Cargando…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Listas de Precios</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 font-medium">Producto</th>
                <th className="py-2 font-medium">Presentación</th>
                {listas.map((lista) => (
                  <th key={lista.id} className="py-2 font-medium">
                    {lista.nombre}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {productos.flatMap((producto) =>
                producto.presentaciones.map((presentacion) => (
                  <tr key={presentacion.id} className="border-b last:border-0">
                    <td className="py-2">{producto.nombre}</td>
                    <td className="py-2">{presentacion.volumen}</td>
                    {listas.map((lista) => (
                      <td key={lista.id} className="py-2">
                        <CeldaPrecio
                          presentacionId={presentacion.id}
                          listaPrecioId={lista.id}
                          sucursalId={sucursalId}
                          precioInicial={precioDe(presentacion.id, lista.id)}
                          editable={puedeGestionar}
                          alGuardar={(precio) =>
                            alGuardarCelda(presentacion.id, lista.id, precio)
                          }
                        />
                      </td>
                    ))}
                  </tr>
                )),
              )}
              {productos.length === 0 && (
                <tr>
                  <td
                    colSpan={2 + listas.length}
                    className="py-4 text-muted-foreground"
                  >
                    No hay productos en el catálogo.
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

- [ ] **Step 4: Escribir la página y el link del sidebar**

Crea `apps/portal/src/app/(portal)/catalogo/precios/page.tsx`:

```tsx
import { PantallaPrecios } from "@/components/precios/pantalla-precios";

// En Next 15 `searchParams` es una promesa. Igual que Vehiculos (D2 de su
// spec), esta pantalla SI lee el filtro de sucursal.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaPrecios sucursal={sucursal ?? null} />;
}
```

En `apps/portal/src/components/layout/nav-config.ts`, agrega la entrada dentro de la sección `"Catálogo"`, después de `"Productos"`:

```ts
      { label: "Productos", href: "/catalogo/productos" },
      { label: "Listas de Precios", href: "/catalogo/precios" },
      { label: "Usuarios", href: "/catalogo/usuarios" },
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
> `npm run backend` lee `.env.development`, que apunta a **`sinmex dev` en la nube**. Antes de levantarlo, cambia su `DATABASE_URL` al Postgres local (el mismo valor que `.env.test`) y déjalo apuntado ahí hasta terminar.

```bash
# 1. Apunta .env.development al Postgres local (edítalo a mano).
# 2. Necesitas un producto con presentaciones para ver algo en la matriz:
#    crea uno desde /catalogo/productos si no tienes ninguno en local.
# 3. Crea dos usuarios de prueba si no los tienes:
npm run crear-usuario --workspace=apps/backend   # uno General (sin sucursal)
npm run crear-usuario --workspace=apps/backend   # uno atado a TJ
# 4. Levanta las dos piezas en terminales separadas:
npm run backend
npm run portal
```

Checklist en `http://localhost:3001/catalogo/precios` — anota el resultado de cada punto:

1. Como usuario **General**, sin sucursal seleccionada: la pantalla pide elegir una sucursal, sin intentar cargar la matriz.
2. Elige **TJ** en el selector del sidebar: aparece la matriz con una fila por presentación y una columna por Lista 1–4. Todas las celdas están vacías ("Sin precio") si es la primera vez.
3. Captura un precio en una celda (`onBlur` la guarda) → refresca la página → sigue ahí.
4. Corrige ese mismo precio en la misma sesión (mismo día) → confirma en la base que sigue siendo **una** fila para esa combinación, no dos:
   ```bash
   psql "$(grep '^DATABASE_URL=' .env.development | cut -d= -f2-)" -c "select count(*) from precio;"
   ```
5. Cambia el selector a **MX**: la matriz se remonta (los campos no arrastran el valor de TJ) y muestra precios independientes.
6. Como usuario **atado a TJ**: abre `/catalogo/precios` sin ningún `?sucursal=` en la URL — ve directo la matriz de TJ, sin el mensaje de "elige una sucursal".
7. Como usuario **sin** `precio.gestionar` (perfil `Auxiliar Administrativo`): ve la matriz pero las celdas no son inputs, son texto de solo lectura.
8. Escribe un precio inválido (0, texto) y sal del campo (`blur`): el campo vuelve al valor anterior sin mandar nada al servidor.

Si algún punto falla, **arréglalo antes de commitear** y vuelve a correr el checklist entero.

- [ ] **Step 7: Restaurar `.env.development`**

Devuelve `DATABASE_URL` de `.env.development` a lo que apuntaba antes (`sinmex dev`).

- [ ] **Step 8: Commit**

```bash
git add apps/portal/src/lib/precios.ts apps/portal/src/components/precios/ \
        "apps/portal/src/app/(portal)/catalogo/precios/page.tsx" \
        apps/portal/src/components/layout/nav-config.ts
git commit -m "T-18 · Pantalla de Listas de Precios en el portal

Matriz propia (presentacion x lista), no una variante de PantallaCatalogo:
T-10 ya habia anticipado que un caso asi no encajaria en el envoltorio de
catalogo. Cada cambio de sucursal remonta la matriz entera (key=sucursalId)
en vez de sincronizar props con un efecto.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FzJdFvymLvnh6sj1Ri33ds"
```

---

### Task 5: Cierre — vault y PR

**Files:**
- Modify: `../jawa-obsidian-memory/10-Dominio/Entidades/Producto.md`
- Modify: `../jawa-obsidian-memory/00-Inicio/Estado del proyecto.md`

**Interfaces:**
- Consumes: el trabajo de las Tasks 1–4.
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

Esperado, contra tu línea base de la Task 0: pgTAP **+6** · unitarias del backend **sin cambio** · e2e **+23** · portal **sin cambio**. Todo en verde. **No sigas si algo falla.**

- [ ] **Step 2: Actualizar `Producto.md` en el vault**

Abre `../jawa-obsidian-memory/10-Dominio/Entidades/Producto.md`. Busca el bloque de advertencia sobre si "Especial" es una lista o el override manual, y reemplázalo por:

```markdown
> [!success] Confirmado en T-18 (2026-08-24)
> "Especial" **no** es una lista de precio: ya está resuelto en [[Lista de precios]] (confirmado
> 2026-08-23) y ahora también implementado — la semilla que T-05 sembró por error se dio de baja
> lógica en la migración de T-18. El único mecanismo de precio especial sigue siendo el override
> manual por cliente (`cliente_precio`, T-12).
>
> El caso de una presentación "recreada" (quitar + agregar en vez de editar el texto) también queda
> cerrado: no pierde ningún vínculo de precio, porque no había ninguno que perder — es una
> presentación nueva y su matriz de precios empieza vacía como la de cualquier otra, sin error ni
> `$0` engañoso (D6 del spec de T-18).
```

Actualiza también el `actualizado:` del frontmatter a `2026-08-24`.

- [ ] **Step 3: Actualizar `Estado del proyecto.md` en el vault**

En `../jawa-obsidian-memory/00-Inicio/Estado del proyecto.md`:

1. En la tabla de issues, agrega la fila de T-18 como ✅ Hecho (2026-08-24).
2. En la fila `T-12/62`, actualiza la nota: T-12 ya no espera a T-18 (queda solo pendiente de nada, salvo su propio trabajo).
3. Agrega una sección **"T-18 — detalle de lo hecho"** siguiendo el formato de las anteriores. Lo que merece quedar escrito:
   - **Desbloquea T-12**, que llevaba desde T-11 marcado como a la espera de este ticket.
   - **Corrige una semilla de T-05**: `lista_precio` tenía 5 filas por error (incluida `Especial`); quedan 4.
   - **El historial de precios se resuelve con un upsert sobre un `unique` nuevo** (`uq_precio_vigencia`), no con una consulta previa — mismo criterio de "la base decide" que T-09/T-10/T-11/T-14.
   - **`vigente_desde` lo calcula el navegador, no el servidor** — mismo cuidado de zona horaria que `fecha_operacion` de folios (T-14), documentado explícitamente en el spec para que no se repita el error en un ticket futuro que también necesite "la fecha de hoy".
   - **La matriz de precios es la primera pantalla del portal que NO usa `PantallaCatalogo`.** T-10 ya había anticipado que un caso con una grilla de edición no encajaría; T-18 es la confirmación.
   - Conteos reales de pruebas, con la cifra de partida y la de llegada.
   - El aviso heredado: el portal sigue sin pruebas automatizadas de pantalla.

- [ ] **Step 4: Commitear el vault**

```bash
cd ../jawa-obsidian-memory
git add "10-Dominio/Entidades/Producto.md" "00-Inicio/Estado del proyecto.md"
git commit -m "T-18 · Listas de precios: catalogo del portal hecho

Cierra la advertencia pendiente de Producto.md sobre 'Especial' y
desbloquea T-12, que esperaba este ticket desde T-11."
git push
cd -
```

- [ ] **Step 5: Abrir el PR**

```bash
git push -u origin feature/t-18-listas-precios
gh pr create --title "T-18 · Listas de precios por sucursal + asignación a cliente" --body "$(cat <<'EOF'
Cierra #18 (parcialmente — ver "Fuera de alcance" abajo).

Desbloquea T-12: el catálogo de clientes dependía de que existiera esta pantalla.

## Qué trae

- **Base:** baja lógica de la fila `'Especial'` que T-05 sembró por error
  (no es una lista, ver el vault); `uq_precio_vigencia`, el `unique` que hace
  posible el upsert sin un `SELECT` previo; el permiso `precio.gestionar`.
- **Backend:** `modules/cartera-clientes/` deja de ser un stub vacío.
  `GET /listas-precio`, `GET /precios` y `PATCH /precios`, reusando
  `resolverAlcance()` de T-09 sin tocarla.
- **Portal:** `/catalogo/precios`, una matriz editable (presentación × lista),
  acotada por el filtro global "Por sucursal" (T-09).

## Decisiones que conviene mirar en la revisión

- **`vigente_desde` lo calcula el navegador, no el servidor.** Mismo riesgo
  de zona horaria que `fecha_operacion` de folios (T-14, ver `CLAUDE.md`):
  derivar "hoy" de UTC en el servidor puede desalinearse de la fecha local de
  Tijuana/Mexicali. Sigue sin haber un selector de fecha visible — el
  navegador lo calcula solo.
- **El historial se resuelve con `INSERT ... ON CONFLICT`, no con un `SELECT`
  previo.** Editar dos veces el mismo precio el mismo día corrige la fila en
  vez de duplicarla, respaldado por `uq_precio_vigencia` en la base.
- **Un usuario General sin sucursal seleccionada recibe 400 en `GET
  /precios`**, a diferencia de Vehículos (T-11) que puede listar "todas" en
  una tabla plana. La matriz de precios pinta una sucursal a la vez y no hay
  una forma sensata de mezclar varias.
- **Presentación sin precio → celda vacía, no error ni `$0`.** Investigado a
  fondo si esto requería tocar `reconciliar-presentaciones.ts` de T-10 — no
  hace falta: el formulario de productos ya manda el `id` correcto al editar
  texto, y una presentación "recreada" es legítimamente una presentación
  nueva sin precio, igual que cualquier otra.
- **La matriz NO usa `PantallaCatalogo`.** Es la primera pantalla que T-10 ya
  había anticipado que no encajaría ahí (una grilla de edición, no un
  alta/edición de una entidad por fila).

## Fuera de alcance, a propósito

- **Alta/baja de listas de precio**: son 4 fijas, sembradas por migración. El
  vault deja margen para una 5ª si el negocio la pide, pero no la pide hoy.
- **Pantalla de cliente y asignación de lista/override a un cliente
  concreto**: es T-12. Las columnas ya existen desde T-05
  (`cliente.lista_precio_id`, `cliente_precio`); este PR solo deja las listas
  y sus precios listos para que T-12 las consuma.
- **Promoción 10+1/20+1**: también T-12 (`cliente_promocion_producto`).
- **Cálculo del precio de una línea de venta**: T-16, sin ticket de
  implementación todavía.

## Verificación

- pgTAP +6 · e2e +23 · unitarias del backend y pruebas del portal sin cambio.
- El portal sigue sin pruebas automatizadas de pantalla (deuda heredada).
  Verificado a mano con Playwright/navegador contra Postgres **local**, 8/8
  puntos del checklist del plan.

Spec: \`docs/superpowers/specs/2026-08-24-t18-listas-precios-design.md\`
Plan: \`docs/superpowers/plans/2026-08-24-t18-listas-precios.md\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Comentar el issue #18 con el alcance real**

```bash
gh issue comment 18 --body "$(cat <<'EOF'
**Nota de alcance para cuando se cierre este issue.**

Este PR cubre el catálogo de listas de precio y su matriz de precios por
presentación × sucursal, con historial. Los criterios que hablan de
**asignar** una lista (y su override) a un **cliente concreto** quedan para
T-12, que no tenía todavía ni tabla de pantalla propia — las columnas
(`cliente.lista_precio_id`, `cliente_precio`) ya existían desde T-05 y este
PR no las toca, solo deja el catálogo de listas listo para que T-12 las
consuma.

Queda anotado aquí para que no parezca que la asignación a cliente se hizo
en T-18 ni que se olvidó.
EOF
)"
```

---

## Self-Review

**Cobertura del spec:**

| Sección del spec | Tarea que la implementa |
|---|---|
| Alcance — baja de 'Especial' | Task 1 |
| Alcance — GET/PATCH del backend | Task 2, Task 3 |
| Alcance — pantalla del portal | Task 4 |
| D1 — módulo en `cartera-clientes/` | Task 2, Step 4 |
| D2 — filtra por sucursal, reusa `resolverAlcance()` | Task 2 (`listarVigentes`), Task 4 (`sucursalActual`) |
| D3 — historización, "hoy" del navegador | Task 2 (repositorio/servicio), Task 3 (pruebas), Task 4 (`hoyLocalIso`) |
| D4 — unique en la base, upsert sin `SELECT` previo | Task 1 (migración), Task 2 (`upsert`), Task 3 (prueba "corrige, no duplica") |
| D5 — listas fijas, `GET /listas-precio` sin permiso | Task 1 (semillas ya existían), Task 2 (`ListasPrecioController`) |
| D6 — presentación sin precio → celda vacía | Task 2 (`listarVigentes` simplemente omite la fila), Task 4 (`CeldaPrecio` con `precioInicial: null`) |
| D7 — pantalla propia, no `PantallaCatalogo` | Task 4 |
| Fuera de alcance — no tocar T-10 | Verificado en el propio spec (investigación previa), sin tarea de código |
| Después del merge — vault | Task 5 |

**Placeholder scan:** sin `TBD`/`TODO` en ningún paso; cada bloque de código de este plan es el contenido final del archivo, no un resumen de lo que iría.

**Consistencia de tipos:** `ListaPrecio { id, nombre }` y `PrecioVigente { presentacionId, listaPrecioId, precio, vigenteDesde }` se definen una vez en `precios.repository.ts` (Task 2) y se reusan sin cambiar de forma en `precios.service.ts`, los dos controllers, y — ya renombrados a `Precio`/`ListaPrecio` del lado del portal — en `lib/precios.ts` (Task 4). `ActualizarPrecioDto` se define una vez (Task 2, Step 5) y ni la Task 3 ni la Task 4 la redefinen, solo la consumen.

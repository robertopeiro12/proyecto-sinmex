# T-12 · Cartera de Clientes — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que administración pueda dar de alta, editar y dar de baja clientes/prospectos desde el portal, con lista de precios + override especial por presentación, promoción (10+1/20+1) sobre productos seleccionados, plazo de crédito, %comisión y ubicación.

**Architecture:** Backend NestJS en `modules/cartera-clientes/` (ya tiene `precios.*`/`listas-precio.*` de T-18), sumando `clientes.*` y `tipos-negocio.*`. Alta/edición son una transacción Kysely que reconcilia datos base + overrides de precio (historizados igual que T-18) + productos de promoción (función pura, igual que T-10). Portal: pantalla propia (no `PantallaCatalogo`) con filtro de sucursal + un filtro de tipo propio.

**Tech Stack:** NestJS · Kysely · Postgres (Supabase) · pgTAP · Jest (backend) · Next.js 15 App Router · React 19 · Tailwind v4 · shadcn/ui · Vitest + Testing Library (portal)

**Spec:** `docs/superpowers/specs/2026-08-31-t12-cartera-clientes-design.md` — las decisiones se citan como D1…D8. Este plan añade **D9** (extracción de dos helpers compartidos, ver Task 2), justificada abajo.

## Global Constraints

- **Rama:** `feature/t-12-cartera-clientes`, base `main`, sin pila. El spec ya está commiteado en `main`.
- **Idioma del código:** identificadores, comentarios y mensajes de error **en español**, **sin acentos en los identificadores** (sí en los mensajes de cara al usuario). Los comentarios explican *por qué*, no *qué*.
- **Todo comando se corre desde la raíz del repo** con `--workspace=`, nunca entrando a `apps/*`.
- **`npm test`, `npm run test:e2e` y `supabase test db` exigen el stack local arriba.** En esta máquina el daemon de Docker lo da **Colima** (`colima start`), no Docker Desktop.
- **Nunca apuntar a `sinmex dev` durante la implementación.** `.env.test` va al Postgres local.
- **La baja siempre es lógica**, nunca `delete` físico.
- **`deleted_at` jamás se expone en una respuesta de la API.**
- **La respuesta de la API va en camelCase.**
- **`vigenteDesde` lo calcula el NAVEGADOR** (fecha local, no `toISOString()` que es UTC), nunca el servidor — mismo riesgo que D5 del spec y D3 de T-18.
- **Conteos de partida: NO están escritos en este plan a propósito** (T-10 hardcodeó cifras y salieron mal). Antes de empezar, corre las suites y **anota tú los números reales**; cada paso de verificación compara contra tu propia línea base.

---

### Task 0: Rama y línea base

**Files:** ninguno (solo verificación).

**Interfaces:**
- Consumes: nada.
- Produces: la rama `feature/t-12-cartera-clientes` y los conteos de partida que usarán todas las tareas siguientes.

- [ ] **Step 1: Crear la rama desde `main` limpio**

```bash
git status --short
git checkout main && git pull
git checkout -b feature/t-12-cartera-clientes
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

- [ ] **Step 4: Confirmar el estado de partida de `cliente` y `tipo_negocio`**

```bash
psql "$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" -c \
  "select count(*) as clientes from cliente;"
psql "$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" -c \
  "select count(*) as tipos_negocio from tipo_negocio;"
```

Esperado: ambas en **0** (ninguna pantalla los ha usado todavía). Si no, **detente**: hay datos de una prueba manual anterior que conviene entender antes de agregar el `unique` de la Task 1.

---

### Task 1: Migración — unicidad de vigencia sobre `cliente_precio` (D5 del spec)

**Files:**
- Create: `supabase/migrations/20260831120000_cliente_precio_unicidad_vigencia.sql`
- Create: `supabase/tests/99_cliente_precio_unicidad_test.sql`

**Interfaces:**
- Consumes: nada.
- Produces: el constraint `uq_cliente_precio_vigencia` sobre `cliente_precio(cliente_id, presentacion_id, vigente_desde)`, del que depende el `ON CONFLICT` de `ClientesRepository.actualizar()` (Task 7).

- [ ] **Step 1: Escribir la prueba pgTAP que falla**

Crea `supabase/tests/99_cliente_precio_unicidad_test.sql`:

```sql
begin;
select plan(3);

-- uq_cliente_precio_vigencia (D5 del spec de T-12): mismo patron que
-- uq_precio_vigencia de T-18, pero sin sucursal_id -- el cliente ya
-- pertenece a una sucursal fija (D6), asi que el override no necesita
-- repetirla.
insert into sucursal (codigo, nombre) values ('ZZ', 'Test T-12');
insert into lista_precio (nombre) values ('Lista Test T-12');
insert into producto (nombre) values ('Producto Test T-12');
insert into presentacion (producto_id, volumen)
  select id, '500 ml' from producto where nombre = 'Producto Test T-12';
insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id)
  values (
    'Cliente Test T-12', 'Domicilio', '000', false, 'cliente',
    (select id from lista_precio where nombre = 'Lista Test T-12'),
    (select id from sucursal where codigo = 'ZZ')
  );

create temporary table ref as
  select
    (select id from cliente where nombre = 'Cliente Test T-12') as cliente,
    (select id from presentacion where producto_id =
      (select id from producto where nombre = 'Producto Test T-12')) as presentacion;

insert into cliente_precio (cliente_id, presentacion_id, precio, vigente_desde)
  select cliente, presentacion, 18.50, current_date from ref;

select throws_ok(
  $$insert into cliente_precio (cliente_id, presentacion_id, precio, vigente_desde)
    select cliente, presentacion, 20.00, current_date from ref$$,
  '23505',
  null,
  'rechaza dos overrides del mismo cliente/presentacion el mismo dia'
);

select lives_ok(
  $$insert into cliente_precio (cliente_id, presentacion_id, precio, vigente_desde)
    select cliente, presentacion, 20.00, current_date + 1 from ref$$,
  'permite una vigencia en una fecha distinta para la misma combinacion'
);

select lives_ok(
  $$insert into cliente_precio (cliente_id, presentacion_id, precio, vigente_desde)
    select cliente, presentacion, 21.00, current_date - 1 from ref$$,
  'permite una vigencia pasada distinta para la misma combinacion'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
npm run supabase -- test db
```

Esperado: `99_cliente_precio_unicidad_test.sql` **falla** en `throws_ok` (el `unique` no existe todavía, así que el segundo insert no revienta). Si pasa entera, algo ya estaba aplicado: **detente**.

- [ ] **Step 3: Escribir la migración**

Crea `supabase/migrations/20260831120000_cliente_precio_unicidad_vigencia.sql`:

```sql
-- T-05 creo `cliente_precio` sin ninguna restriccion de unicidad. Sin este
-- unique, dos ediciones del mismo dia para el mismo cliente/presentacion
-- abren dos filas de historial en vez de corregir una (mismo problema que
-- `precio` tenia antes de T-18). Va en la base y no solo en el service por la
-- misma razon que el resto del esquema: las semillas y cualquier carga
-- futura entran por debajo de la API.
--
-- Sin sucursal_id a diferencia de uq_precio_vigencia (T-18): el cliente ya
-- pertenece a una sola sucursal fija (D6 del spec de T-12), asi que
-- repetirla aqui seria redundante.
--
-- Este mismo constraint es lo que hace posible el upsert de
-- ClientesRepository.actualizar() sin un SELECT previo: usa
-- `ON CONFLICT ON CONSTRAINT uq_cliente_precio_vigencia DO UPDATE`.
alter table cliente_precio
  add constraint uq_cliente_precio_vigencia
  unique (cliente_id, presentacion_id, vigente_desde);
```

- [ ] **Step 4: Aplicar la migración y correr la prueba**

```bash
npm run supabase -- migration up --local
npm run supabase -- test db
```

Esperado: las 3 pruebas nuevas pasan, y el total pgTAP sube en 3 sobre tu línea base de la Task 0.

- [ ] **Step 5: Confirmar que `db:types` no hace falta**

La migración solo agrega un `constraint`, ninguna columna: `schema.d.ts` no cambia. No corras `npm run db:types`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260831120000_cliente_precio_unicidad_vigencia.sql \
        supabase/tests/99_cliente_precio_unicidad_test.sql
git commit -m "$(cat <<'EOF'
T-12 · Unicidad de vigencia sobre cliente_precio

uq_cliente_precio_vigencia es lo que hace posible el upsert del
repositorio de Clientes sin un SELECT previo (mismo patron que
uq_precio_vigencia de T-18, sin sucursal_id porque el cliente ya
pertenece a una sola sucursal).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WjmEJNSj7BxSriQx3nb4GG
EOF
)"
```

---

### Task 2: Extraer dos helpers compartidos antes de la cuarta copia (D9)

**Contexto (no está en el spec, es un hallazgo de planeación):** `VehiculosRepository.buscarSucursalUsuario` (T-11) y `PreciosRepository.buscarSucursalUsuario` (T-18) duplican la misma consulta a propósito, y el comentario de T-18 dice explícitamente *"se extrae cuando el patrón esté claro con una CUARTA copia, no antes"*. `ClientesRepository` (Task 5) sería esa cuarta copia. Mismo razonamiento para `esDuplicado()`/`esViolacionFk()` (duplicadas en `perfiles.service.ts`, `productos.service.ts`, `vehiculos.service.ts`): T-10 dejó anotado que el candidato a extraerse era "cuando T-16/T-18 sumen una cuarta y quinta copia" — T-18 no sumó copia nueva (su `PATCH` nunca dispara `23505`), así que `TiposNegocioService` (Task 4) sería la cuarta.

Esta tarea **solo agrega archivos nuevos y los usa desde los dos módulos existentes que hoy duplican la consulta de sucursal** (Vehículos, Precios) — no toca `esDuplicado()` en `perfiles.service.ts`/`productos.service.ts`/`vehiculos.service.ts`, esos tres siguen intactos; el código nuevo de Clientes/Tipos de Negocio simplemente **no duplica una cuarta y quinta vez**, usa el helper compartido desde el principio.

**Files:**
- Create: `apps/backend/src/modules/sucursales/buscar-sucursal-usuario.ts`
- Create: `apps/backend/src/modules/sucursales/buscar-sucursal-usuario.spec.ts`
- Create: `apps/backend/src/database/errores-postgres.ts`
- Create: `apps/backend/src/database/errores-postgres.spec.ts`
- Modify: `apps/backend/src/modules/rutas/vehiculos.repository.ts`
- Modify: `apps/backend/src/modules/cartera-clientes/precios.repository.ts`

**Interfaces:**
- Produces: `buscarSucursalUsuario(db: Database, usuarioId: string): Promise<{ id: string | null; codigo: string | null } | undefined>`, consumida por `VehiculosRepository`/`PreciosRepository` (esta tarea) y por `ClientesRepository` (Task 5). `esViolacionUnicidad(error: unknown): boolean` y `esViolacionFk(error: unknown): boolean`, consumidas por `TiposNegocioService` (Task 4) y `ClientesService` (Tasks 6-7).

- [ ] **Step 1: Escribir las pruebas unitarias que fallan**

Crea `apps/backend/src/database/errores-postgres.spec.ts`:

```typescript
import { esViolacionFk, esViolacionUnicidad } from './errores-postgres';

describe('esViolacionUnicidad', () => {
  it('reconoce el codigo 23505', () => {
    expect(esViolacionUnicidad({ code: '23505' })).toBe(true);
  });

  it('rechaza otros codigos', () => {
    expect(esViolacionUnicidad({ code: '23503' })).toBe(false);
  });

  it('rechaza un error sin codigo', () => {
    expect(esViolacionUnicidad(new Error('algo'))).toBe(false);
    expect(esViolacionUnicidad(null)).toBe(false);
    expect(esViolacionUnicidad('texto')).toBe(false);
  });
});

describe('esViolacionFk', () => {
  it('reconoce el codigo 23503', () => {
    expect(esViolacionFk({ code: '23503' })).toBe(true);
  });

  it('rechaza otros codigos', () => {
    expect(esViolacionFk({ code: '23505' })).toBe(false);
  });
});
```

Crea `apps/backend/src/modules/sucursales/buscar-sucursal-usuario.spec.ts`:

```typescript
import { buscarSucursalUsuario } from './buscar-sucursal-usuario';

describe('buscarSucursalUsuario', () => {
  it('arma la consulta esperada contra la tabla usuario', async () => {
    const ejecutar = jest.fn().mockResolvedValue({ id: '1', codigo: 'TJ' });
    const builder = {
      selectFrom: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      executeTakeFirst: ejecutar,
    };
    const db = builder as unknown as Parameters<typeof buscarSucursalUsuario>[0];

    const resultado = await buscarSucursalUsuario(db, 'usuario-1');

    expect(builder.selectFrom).toHaveBeenCalledWith('usuario');
    expect(builder.leftJoin).toHaveBeenCalledWith(
      'sucursal',
      'sucursal.id',
      'usuario.sucursal_id',
    );
    expect(builder.where).toHaveBeenCalledWith('usuario.id', '=', 'usuario-1');
    expect(builder.where).toHaveBeenCalledWith('usuario.deleted_at', 'is', null);
    expect(resultado).toEqual({ id: '1', codigo: 'TJ' });
  });
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

```bash
npm test --workspace=apps/backend -- errores-postgres buscar-sucursal-usuario
```

Esperado: FAIL — `Cannot find module './errores-postgres'` y `Cannot find module './buscar-sucursal-usuario'`.

- [ ] **Step 3: Escribir `errores-postgres.ts`**

Crea `apps/backend/src/database/errores-postgres.ts`:

```typescript
/**
 * El driver `pg` adjunta el codigo de error de Postgres en `error.code`
 * cuando la base rechaza una escritura. Se mira DESPUES del insert/update en
 * vez de consultar antes (por ejemplo, si un nombre ya existe): una consulta
 * previa deja una ventana entre el SELECT y el INSERT en la que otra
 * peticion puede meter lo mismo, y el constraint de la base es quien de
 * verdad decide (mismo criterio que T-09, T-10, T-11, T-14, T-18).
 *
 * Extraido en T-12 porque `TiposNegocioService` (unique de nombre) y
 * `ClientesService` (llaves foraneas de tipo_negocio/lista_precio) iban a
 * ser la cuarta y quinta copia de esta funcion -- T-10 ya habia anotado ese
 * umbral como el momento de extraerla. Los tres servicios que ya la tenian
 * duplicada (`perfiles.service.ts`, `productos.service.ts`,
 * `vehiculos.service.ts`) no se tocan aqui: solo el codigo nuevo la usa.
 */
function codigoDeError(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const valor = (error as { code?: unknown }).code;
  return typeof valor === 'string' ? valor : undefined;
}

/** `23505` es unique_violation. */
export function esViolacionUnicidad(error: unknown): boolean {
  return codigoDeError(error) === '23505';
}

/** `23503` es foreign_key_violation. */
export function esViolacionFk(error: unknown): boolean {
  return codigoDeError(error) === '23503';
}
```

- [ ] **Step 4: Escribir `buscar-sucursal-usuario.ts`**

Crea `apps/backend/src/modules/sucursales/buscar-sucursal-usuario.ts`:

```typescript
import type { Database } from '../../database/database.tokens';

/**
 * La sucursal del usuario. Distingue tres casos que NO se pueden colapsar:
 *   - `undefined`                  -> el usuario no existe o esta dado de baja
 *   - `{ id: null, codigo: null }` -> existe y es General
 *   - `{ id: '…', codigo: 'TJ' }`  -> existe y esta atado a Tijuana
 * Devolver null para los dos primeros convertiria a un usuario borrado en
 * uno con acceso a todas las sucursales.
 *
 * Extraida en T-12 (D9 del plan): vivia duplicada en `VehiculosRepository`
 * (T-11) y `PreciosRepository` (T-18), cada una con su propio comentario
 * anotando que la duplicacion era a proposito "hasta la cuarta copia".
 * `ClientesRepository` (Task 5 de este plan) es esa cuarta copia, asi que se
 * extrae ahora en vez de triplicarla y luego cuadruplicarla el mismo dia.
 *
 * Es una funcion plana (no un servicio de Nest inyectable) porque no tiene
 * estado propio: recibe la conexion como parametro, igual que `aNumero()` de
 * `sincronizacion/dinero.ts`.
 */
export async function buscarSucursalUsuario(
  db: Database,
  usuarioId: string,
): Promise<{ id: string | null; codigo: string | null } | undefined> {
  return db
    .selectFrom('usuario')
    .leftJoin('sucursal', 'sucursal.id', 'usuario.sucursal_id')
    .select(['sucursal.id as id', 'sucursal.codigo as codigo'])
    .where('usuario.id', '=', usuarioId)
    .where('usuario.deleted_at', 'is', null)
    .executeTakeFirst();
}
```

- [ ] **Step 5: Correr las pruebas para verificar que pasan**

```bash
npm test --workspace=apps/backend -- errores-postgres buscar-sucursal-usuario
```

Esperado: PASS, 6 pruebas nuevas.

- [ ] **Step 6: Actualizar `VehiculosRepository` para usar el helper**

En `apps/backend/src/modules/rutas/vehiculos.repository.ts`, agrega el import:

```typescript
import { buscarSucursalUsuario as buscarSucursalUsuarioCompartido } from '../sucursales/buscar-sucursal-usuario';
```

Reemplaza el cuerpo del método existente `buscarSucursalUsuario` (el bloque completo, comentario incluido) por:

```typescript
  /**
   * Delegado al helper compartido (D9 de T-12) -- el metodo se conserva para
   * no tocar `VehiculosService`, que sigue llamando `this.repo.buscarSucursalUsuario(...)`.
   */
  async buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuarioCompartido(this.db, usuarioId);
  }
```

- [ ] **Step 7: Actualizar `PreciosRepository` de la misma forma**

En `apps/backend/src/modules/cartera-clientes/precios.repository.ts`, mismo cambio: importa `buscarSucursalUsuario as buscarSucursalUsuarioCompartido` de `'../sucursales/buscar-sucursal-usuario'` y reemplaza el cuerpo de su `buscarSucursalUsuario` por el mismo `return buscarSucursalUsuarioCompartido(this.db, usuarioId);` (con el mismo comentario del Step 6).

- [ ] **Step 8: Confirmar que Vehículos y Precios siguen en verde**

```bash
npm test --workspace=apps/backend -- vehiculos precios
npm run test:e2e --workspace=apps/backend -- vehiculos precios
```

Esperado: mismos números que tu línea base de la Task 0 — el refactor no cambia comportamiento, solo de dónde sale la consulta.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/database/errores-postgres.ts \
        apps/backend/src/database/errores-postgres.spec.ts \
        apps/backend/src/modules/sucursales/buscar-sucursal-usuario.ts \
        apps/backend/src/modules/sucursales/buscar-sucursal-usuario.spec.ts \
        apps/backend/src/modules/rutas/vehiculos.repository.ts \
        apps/backend/src/modules/cartera-clientes/precios.repository.ts
git commit -m "$(cat <<'EOF'
T-12 · Extraer buscarSucursalUsuario y detectores de error de Postgres

Vehiculos (T-11) y Precios (T-18) ya anotaban que la cuarta copia de
buscarSucursalUsuario debia extraerse; Clientes (siguiente tarea) es
esa cuarta copia. Mismo criterio para esDuplicado/esViolacionFk antes
de que Tipos de Negocio y Clientes las tripliquen y cuatripliquen.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WjmEJNSj7BxSriQx3nb4GG
EOF
)"
```

---

### Task 3: `reconciliar-promocion-productos.ts` — función pura (D4 del spec)

**Files:**
- Create: `apps/backend/src/modules/cartera-clientes/reconciliar-promocion-productos.ts`
- Create: `apps/backend/src/modules/cartera-clientes/reconciliar-promocion-productos.spec.ts`

**Interfaces:**
- Produces: `reconciliarPromocionProductos(promocion, existentes, pedidos): PlanPromocionProductos` con `PlanPromocionProductos = { insertar: string[]; eliminar: string[] }`, consumida por `ClientesService.crear()` (Task 6) y `ClientesService.editar()` (Task 7).

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `apps/backend/src/modules/cartera-clientes/reconciliar-promocion-productos.spec.ts`:

```typescript
import { reconciliarPromocionProductos } from './reconciliar-promocion-productos';

describe('reconciliarPromocionProductos', () => {
  it('en un alta (sin existentes), inserta todos los pedidos si hay promocion', () => {
    const plan = reconciliarPromocionProductos('10+1', [], ['p1', 'p2']);
    expect(plan).toEqual({ insertar: ['p1', 'p2'], eliminar: [] });
  });

  it('con promocion "ninguna", ignora los pedidos aunque manden ids (D4 del spec)', () => {
    const plan = reconciliarPromocionProductos('ninguna', [], ['p1', 'p2']);
    expect(plan).toEqual({ insertar: [], eliminar: [] });
  });

  it('con promocion "ninguna" y productos existentes, los da de baja', () => {
    const plan = reconciliarPromocionProductos('ninguna', ['p1', 'p2'], ['p1', 'p2']);
    expect(plan).toEqual({ insertar: [], eliminar: ['p1', 'p2'] });
  });

  it('inserta los nuevos y da de baja los que ya no vienen', () => {
    const plan = reconciliarPromocionProductos('20+1', ['p1', 'p2'], ['p2', 'p3']);
    expect(plan.insertar).toEqual(['p3']);
    expect(plan.eliminar).toEqual(['p1']);
  });

  it('no repite un producto en insertar si ya estaba entre los existentes', () => {
    const plan = reconciliarPromocionProductos('10+1', ['p1'], ['p1']);
    expect(plan).toEqual({ insertar: [], eliminar: [] });
  });

  it('deduplica ids repetidos en los pedidos', () => {
    const plan = reconciliarPromocionProductos('10+1', [], ['p1', 'p1', 'p2']);
    expect(plan.insertar.sort()).toEqual(['p1', 'p2']);
  });
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

```bash
npm test --workspace=apps/backend -- reconciliar-promocion-productos
```

Esperado: FAIL — `Cannot find module './reconciliar-promocion-productos'`.

- [ ] **Step 3: Escribir la implementación**

Crea `apps/backend/src/modules/cartera-clientes/reconciliar-promocion-productos.ts`:

```typescript
/**
 * El PATCH/POST de cliente recibe el estado COMPLETO de la promocion (D4 del
 * spec), no una secuencia de operaciones: que promocion tiene y que
 * productos selecciono. Esta funcion compara eso contra lo que hay guardado
 * y devuelve el plan a ejecutar contra `cliente_promocion_producto`.
 *
 * Es pura a proposito, igual que `reconciliar-presentaciones.ts` de T-10: no
 * necesita base de datos para probarse.
 */

export type Promocion = 'ninguna' | '10+1' | '20+1';

export interface PlanPromocionProductos {
  insertar: string[];
  eliminar: string[];
}

export function reconciliarPromocionProductos(
  promocion: Promocion,
  existentes: string[],
  pedidos: string[],
): PlanPromocionProductos {
  // Sin promocion, el formulario puede seguir mandando ids sueltos de un
  // guardado anterior (el usuario cambio el desplegable pero no toco los
  // checkboxes) -- se ignoran (D4): la promocion "ninguna" nunca deja
  // productos asociados.
  const efectivos = promocion === 'ninguna' ? [] : Array.from(new Set(pedidos));

  const existentesSet = new Set(existentes);
  const efectivosSet = new Set(efectivos);

  return {
    insertar: efectivos.filter((id) => !existentesSet.has(id)),
    eliminar: existentes.filter((id) => !efectivosSet.has(id)),
  };
}
```

- [ ] **Step 4: Correr las pruebas para verificar que pasan**

```bash
npm test --workspace=apps/backend -- reconciliar-promocion-productos
```

Esperado: PASS, 6 pruebas.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/cartera-clientes/reconciliar-promocion-productos.ts \
        apps/backend/src/modules/cartera-clientes/reconciliar-promocion-productos.spec.ts
git commit -m "$(cat <<'EOF'
T-12 · Funcion pura de reconciliacion de productos con promocion

Misma forma que reconciliar-presentaciones.ts de T-10: el PATCH manda
el estado completo, esta funcion calcula el plan de insertar/eliminar
contra cliente_promocion_producto. Promocion 'ninguna' siempre vacia
la lista, aunque el cuerpo mande productos (D4 del spec).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WjmEJNSj7BxSriQx3nb4GG
EOF
)"
```

---

### Task 4: Backend — Tipos de Negocio: `GET`/`POST /tipos-negocio` (D1 del spec)

**Files:**
- Create: `apps/backend/src/modules/cartera-clientes/tipos-negocio.repository.ts`
- Create: `apps/backend/src/modules/cartera-clientes/tipos-negocio.service.ts`
- Create: `apps/backend/src/modules/cartera-clientes/tipos-negocio.controller.ts`
- Create: `apps/backend/src/modules/cartera-clientes/dto/crear-tipo-negocio.dto.ts`
- Modify: `apps/backend/src/modules/cartera-clientes/cartera-clientes.module.ts`
- Create: `apps/backend/test/tipos-negocio.e2e-spec.ts`

**Interfaces:**
- Consumes: `esViolacionUnicidad()` de `../../database/errores-postgres` (Task 2); `@RequierePermiso` de `../auth/requiere-permiso.decorator`.
- Produces: `TipoNegocio { id: string; nombre: string }`, consumida por `ClientesRepository.obtener()` (Task 5, vía join) y por el portal (`lib/tipos-negocio.ts`, Task 8).

- [ ] **Step 1: Escribir el e2e que falla**

Crea `apps/backend/test/tipos-negocio.e2e-spec.ts`:

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

interface TipoNegocioRespuesta {
  id: string;
  nombre: string;
}

const SUFIJO = Date.now();
const LOGIN_GENERAL = `e2e-tneg-gen-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-tneg-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const PREFIJO = `ZZ-e2e-${SUFIJO}`;

describe('Tipos de Negocio (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  let cookieGeneral: string;
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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await app.init();
    db = app.get<Database>(DB_CONNECTION);

    await crearUsuario(LOGIN_GENERAL, 'Administrador General');
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo');

    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    await db
      .deleteFrom('tipo_negocio')
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

  describe('GET /tipos-negocio', () => {
    it('lista los tipos de negocio sin exigir cliente.gestionar', async () => {
      const res = await request(app.getHttpServer())
        .get('/tipos-negocio')
        .set('Cookie', cookieSinPermiso)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('rechaza a quien no tiene sesion', async () => {
      await request(app.getHttpServer()).get('/tipos-negocio').expect(401);
    });
  });

  describe('POST /tipos-negocio', () => {
    it('crea un tipo de negocio', async () => {
      const res = await request(app.getHttpServer())
        .post('/tipos-negocio')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Restaurante` })
        .expect(201);

      const cuerpo = res.body as TipoNegocioRespuesta;
      expect(cuerpo.nombre).toBe(`${PREFIJO} Restaurante`);
      expect(cuerpo.id).toBeDefined();
    });

    it('rechaza un nombre duplicado con 409', async () => {
      await request(app.getHttpServer())
        .post('/tipos-negocio')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Tienda` })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/tipos-negocio')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Tienda` })
        .expect(409);

      expect((res.body as { message: string }).message).toContain('Ya existe');
    });

    it('rechaza sin cliente.gestionar con 403', async () => {
      await request(app.getHttpServer())
        .post('/tipos-negocio')
        .set('Cookie', cookieSinPermiso)
        .send({ nombre: `${PREFIJO} Sin permiso` })
        .expect(403);
    });

    it('rechaza un nombre vacio con 400', async () => {
      await request(app.getHttpServer())
        .post('/tipos-negocio')
        .set('Cookie', cookieGeneral)
        .send({ nombre: '  ' })
        .expect(400);
    });
  });
});
```

- [ ] **Step 2: Correr el e2e para verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend -- tipos-negocio
```

Esperado: FAIL — `Cannot GET /tipos-negocio` (404, la ruta no existe).

- [ ] **Step 3: Escribir el DTO**

Crea `apps/backend/src/modules/cartera-clientes/dto/crear-tipo-negocio.dto.ts`:

```typescript
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CrearTipoNegocioDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  // Mismo tope que sucursal/producto/vehiculo (T-09/T-10/T-11): un campo de
  // texto sin cota es una invitacion a meter un documento entero en un
  // catalogo que se pinta en un desplegable.
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;
}
```

- [ ] **Step 4: Escribir el repositorio**

Crea `apps/backend/src/modules/cartera-clientes/tipos-negocio.repository.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

export interface TipoNegocio {
  id: string;
  nombre: string;
}

@Injectable()
export class TiposNegocioRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async listar(): Promise<TipoNegocio[]> {
    return this.db
      .selectFrom('tipo_negocio')
      .select(['id', 'nombre'])
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .execute();
  }

  async crear(nombre: string): Promise<TipoNegocio> {
    return this.db
      .insertInto('tipo_negocio')
      .values({ nombre })
      .returning(['id', 'nombre'])
      .executeTakeFirstOrThrow();
  }
}
```

- [ ] **Step 5: Escribir el servicio**

Crea `apps/backend/src/modules/cartera-clientes/tipos-negocio.service.ts`:

```typescript
import { ConflictException, Injectable } from '@nestjs/common';
import { esViolacionUnicidad } from '../../database/errores-postgres';
import {
  TiposNegocioRepository,
  type TipoNegocio,
} from './tipos-negocio.repository';

@Injectable()
export class TiposNegocioService {
  constructor(private readonly repo: TiposNegocioRepository) {}

  async listar(): Promise<TipoNegocio[]> {
    return this.repo.listar();
  }

  async crear(nombre: string): Promise<TipoNegocio> {
    try {
      return await this.repo.crear(nombre);
    } catch (error) {
      if (esViolacionUnicidad(error)) {
        throw new ConflictException(
          `Ya existe un tipo de negocio llamado "${nombre}".`,
        );
      }
      throw error;
    }
  }
}
```

- [ ] **Step 6: Escribir el controller**

Crea `apps/backend/src/modules/cartera-clientes/tipos-negocio.controller.ts`:

```typescript
import { Body, Controller, Get, Post } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { TiposNegocioService } from './tipos-negocio.service';
import { CrearTipoNegocioDto } from './dto/crear-tipo-negocio.dto';
import type { TipoNegocio } from './tipos-negocio.repository';

// Sin permiso en el listado (D del spec, "GET /tipos-negocio"): lo necesita
// el desplegable del formulario de Cliente para cualquiera con sesion, igual
// que GET /productos (T-10) y GET /vehiculos (T-11).
@Controller('tipos-negocio')
export class TiposNegocioController {
  constructor(private readonly tiposNegocio: TiposNegocioService) {}

  @Get()
  async listar(): Promise<TipoNegocio[]> {
    return this.tiposNegocio.listar();
  }

  @Post()
  @RequierePermiso('cliente.gestionar')
  async crear(@Body() dto: CrearTipoNegocioDto): Promise<TipoNegocio> {
    return this.tiposNegocio.crear(dto.nombre);
  }
}
```

- [ ] **Step 7: Registrar en el módulo**

En `apps/backend/src/modules/cartera-clientes/cartera-clientes.module.ts`, reemplaza el archivo completo:

```typescript
import { Module } from '@nestjs/common';
import { ListasPrecioController } from './listas-precio.controller';
import { PreciosController } from './precios.controller';
import { PreciosRepository } from './precios.repository';
import { PreciosService } from './precios.service';
import { TiposNegocioController } from './tipos-negocio.controller';
import { TiposNegocioRepository } from './tipos-negocio.repository';
import { TiposNegocioService } from './tipos-negocio.service';

// Cartera de Clientes es el modulo de dominio del vault que agrupa Cliente y
// Lista de precios (Lista de precios.md declara `modulo: cartera-clientes`).
// Precios lo lleno T-18; Tipos de Negocio y Cliente llegan con T-12 (esta
// tarea agrega Tipos de Negocio; Clientes se registra en la Task 5).
@Module({
  controllers: [
    ListasPrecioController,
    PreciosController,
    TiposNegocioController,
  ],
  providers: [PreciosService, PreciosRepository, TiposNegocioService, TiposNegocioRepository],
})
export class CarteraClientesModule {}
```

- [ ] **Step 8: Correr el e2e para verificar que pasa**

```bash
npm run test:e2e --workspace=apps/backend -- tipos-negocio
```

Esperado: PASS, 6 pruebas.

- [ ] **Step 9: Correr la suite e2e completa**

```bash
npm run test:e2e --workspace=apps/backend
```

Esperado: tu línea base de la Task 0 + 6.

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/modules/cartera-clientes/tipos-negocio.repository.ts \
        apps/backend/src/modules/cartera-clientes/tipos-negocio.service.ts \
        apps/backend/src/modules/cartera-clientes/tipos-negocio.controller.ts \
        apps/backend/src/modules/cartera-clientes/dto/crear-tipo-negocio.dto.ts \
        apps/backend/src/modules/cartera-clientes/cartera-clientes.module.ts \
        apps/backend/test/tipos-negocio.e2e-spec.ts
git commit -m "$(cat <<'EOF'
T-12 · GET/POST /tipos-negocio

Catalogo minimo sin pantalla propia (D1 del spec): la tabla existia
vacia desde T-05 sin lista del cliente. El formulario de Cliente la
llena al vuelo desde un combobox con alta inline (Task 9).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WjmEJNSj7BxSriQx3nb4GG
EOF
)"
```

---

### Task 5: Backend — `GET /clientes` y `GET /clientes/:id` (D6, D7 del spec)

**Files:**
- Create: `apps/backend/src/modules/cartera-clientes/clientes.repository.ts`
- Create: `apps/backend/src/modules/cartera-clientes/clientes.service.ts`
- Create: `apps/backend/src/modules/cartera-clientes/clientes.controller.ts`
- Modify: `apps/backend/src/modules/cartera-clientes/cartera-clientes.module.ts`
- Create: `apps/backend/test/clientes.e2e-spec.ts`

**Interfaces:**
- Consumes: `resolverAlcance()`/`normalizarSucursalPedida()` de `../sucursales/alcance-sucursal`; `buscarSucursalUsuario()` de `../sucursales/buscar-sucursal-usuario` (Task 2); `aNumero()` de `../sincronizacion/dinero`; `@UsuarioActual()`/`@RequierePermiso()` de `../auth/*`.
- Produces: `ClienteResumen`, `ClienteDetalle`, `OverridePrecio`, `TipoFiltro` (exportados de `clientes.repository.ts`), consumidos por `ClientesService`/`ClientesController` (esta tarea, y Tasks 6-7) y por el portal (`lib/clientes.ts`, Task 8).

**Nota de esta tarea:** solo lectura. Las Tasks 6 y 7 agregan `crear`/`editar`/`eliminar` sobre los mismos archivos.

- [ ] **Step 1: Escribir el e2e que falla (solo lectura)**

Crea `apps/backend/test/clientes.e2e-spec.ts`. Este archivo crece en las Tasks 6 y 7; aquí solo el bloque de lectura y el `beforeAll`/`afterAll`/helpers que las tres tareas comparten.

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

interface ClienteResumenRespuesta {
  id: string;
  nombre: string;
  telefono: string;
  tipo: 'cliente' | 'prospecto';
  tipoNegocio: string | null;
  sucursalCodigo: string;
}

interface ClienteDetalleRespuesta extends ClienteResumenRespuesta {
  domicilio: string;
  encargado: string | null;
  factura: boolean;
  tipoNegocioId: string | null;
  listaPrecioId: string;
  pctComision: number | null;
  promocion: 'ninguna' | '10+1' | '20+1';
  plazoCreditoDias: number | null;
  lat: number | null;
  lng: number | null;
  comentarios: string | null;
  sucursalId: string;
  overridesPrecio: { presentacionId: string; precio: number; vigenteDesde: string }[];
  productosPromocion: string[];
}

const SUFIJO = Date.now();
const LOGIN_GENERAL = `e2e-cli-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-cli-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-cli-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const PREFIJO = `ZZ-e2e-${SUFIJO}`;

describe('Clientes (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  let idTijuana: string;
  let idMexicali: string;
  let listaId: string;
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

  /** Inserta un cliente por debajo de la API, para preparar escenarios de lectura. */
  const sembrarCliente = async (
    nombre: string,
    sucursalId: string,
    tipo: 'cliente' | 'prospecto' = 'cliente',
  ): Promise<string> => {
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre,
        domicilio: 'Domicilio de prueba',
        telefono: '000',
        factura: false,
        tipo,
        lista_precio_id: listaId,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
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

    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    listaId = lista.id;

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', idTijuana);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);

    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    if (clienteIds.length > 0) {
      await db
        .deleteFrom('cliente_promocion_producto')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await db
        .deleteFrom('cliente_precio')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    await db
      .deleteFrom('producto')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db
      .deleteFrom('tipo_negocio')
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

  describe('GET /clientes', () => {
    it('lista los clientes con su tipo de negocio y codigo de sucursal', async () => {
      await sembrarCliente(`${PREFIJO} Listar TJ`, idTijuana);

      const res = await request(app.getHttpServer())
        .get('/clientes')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const clientes = res.body as ClienteResumenRespuesta[];
      const propio = clientes.find((c) => c.nombre === `${PREFIJO} Listar TJ`);
      expect(propio).toBeDefined();
      expect(propio?.sucursalCodigo).toBe('TJ');
      expect(propio?.tipo).toBe('cliente');
      expect(propio).not.toHaveProperty('deleted_at');
    });

    it('un usuario atado a TJ no ve los clientes de MX', async () => {
      await sembrarCliente(`${PREFIJO} Solo MX`, idMexicali);

      const res = await request(app.getHttpServer())
        .get('/clientes')
        .set('Cookie', cookieTijuana)
        .expect(200);

      const nombres = (res.body as ClienteResumenRespuesta[]).map((c) => c.nombre);
      expect(nombres).not.toContain(`${PREFIJO} Solo MX`);
    });

    it('un usuario atado que pide OTRA sucursal recibe 403', async () => {
      await request(app.getHttpServer())
        .get('/clientes?sucursal=MX')
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('filtra por tipo=prospecto', async () => {
      await sembrarCliente(`${PREFIJO} Prospecto`, idTijuana, 'prospecto');

      const res = await request(app.getHttpServer())
        .get('/clientes?tipo=prospecto')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const clientes = res.body as ClienteResumenRespuesta[];
      expect(clientes.every((c) => c.tipo === 'prospecto')).toBe(true);
      expect(clientes.some((c) => c.nombre === `${PREFIJO} Prospecto`)).toBe(true);
    });

    it('deja listar aunque el usuario no tenga cliente.gestionar', async () => {
      await request(app.getHttpServer())
        .get('/clientes')
        .set('Cookie', cookieSinPermiso)
        .expect(200);
    });

    it('rechaza a quien no tiene sesion', async () => {
      await request(app.getHttpServer()).get('/clientes').expect(401);
    });
  });

  describe('GET /clientes/:id', () => {
    it('devuelve el detalle completo, con arreglos vacios si no hay overrides ni promocion', async () => {
      const id = await sembrarCliente(`${PREFIJO} Detalle`, idTijuana);

      const res = await request(app.getHttpServer())
        .get(`/clientes/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(200);

      const cliente = res.body as ClienteDetalleRespuesta;
      expect(cliente.nombre).toBe(`${PREFIJO} Detalle`);
      expect(cliente.sucursalCodigo).toBe('TJ');
      expect(cliente.overridesPrecio).toEqual([]);
      expect(cliente.productosPromocion).toEqual([]);
      expect(cliente.promocion).toBe('ninguna');
    });

    it('responde 404 para un id que no existe', async () => {
      await request(app.getHttpServer())
        .get('/clientes/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieGeneral)
        .expect(404);
    });

    it('un usuario atado a TJ no puede leer el detalle de un cliente de MX', async () => {
      const id = await sembrarCliente(`${PREFIJO} Detalle MX`, idMexicali);

      await request(app.getHttpServer())
        .get(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('responde 400 para un id mal formado', async () => {
      await request(app.getHttpServer())
        .get('/clientes/no-es-un-uuid')
        .set('Cookie', cookieGeneral)
        .expect(400);
    });
  });
});
```

- [ ] **Step 2: Correr el e2e para verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend -- clientes.e2e-spec
```

Esperado: FAIL — `Cannot GET /clientes` (404, la ruta no existe).

- [ ] **Step 3: Escribir el repositorio (lectura)**

Crea `apps/backend/src/modules/cartera-clientes/clientes.repository.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import { aNumero } from '../sincronizacion/dinero';

export type TipoCliente = 'cliente' | 'prospecto';
export type TipoFiltro = TipoCliente | 'todos';
export type Promocion = 'ninguna' | '10+1' | '20+1';

export interface ClienteResumen {
  id: string;
  nombre: string;
  telefono: string;
  tipo: TipoCliente;
  tipoNegocio: string | null;
  sucursalCodigo: string;
}

export interface OverridePrecio {
  presentacionId: string;
  precio: number;
  vigenteDesde: string;
}

export interface ClienteDetalle {
  id: string;
  nombre: string;
  domicilio: string;
  telefono: string;
  encargado: string | null;
  factura: boolean;
  tipo: TipoCliente;
  tipoNegocioId: string | null;
  listaPrecioId: string;
  pctComision: number | null;
  promocion: Promocion;
  plazoCreditoDias: number | null;
  lat: number | null;
  lng: number | null;
  comentarios: string | null;
  sucursalId: string;
  sucursalCodigo: string;
  overridesPrecio: OverridePrecio[];
  productosPromocion: string[];
}

/** Los campos de `cliente` que Task 6/7 escriben, en snake_case (columnas). */
export interface DatosClienteBase {
  nombre: string;
  domicilio: string;
  telefono: string;
  encargado: string | null;
  factura: boolean;
  tipo_negocio_id: string | null;
  lista_precio_id: string;
  pct_comision: number | null;
  promocion: Promocion;
  plazo_credito_dias: number | null;
  lat: number | null;
  lng: number | null;
  comentarios: string | null;
}

interface FilaResumen {
  id: string;
  nombre: string;
  telefono: string;
  tipo: string;
  tipo_negocio_nombre: string | null;
  codigo: string;
}

function aResumen(fila: FilaResumen): ClienteResumen {
  return {
    id: fila.id,
    nombre: fila.nombre,
    telefono: fila.telefono,
    tipo: fila.tipo as TipoCliente,
    tipoNegocio: fila.tipo_negocio_nombre,
    sucursalCodigo: fila.codigo,
  };
}

interface FilaDetalle {
  id: string;
  nombre: string;
  domicilio: string;
  telefono: string;
  encargado: string | null;
  factura: boolean;
  tipo: string;
  tipo_negocio_id: string | null;
  lista_precio_id: string;
  pct_comision: string | null;
  promocion: string;
  plazo_credito_dias: number | null;
  lat: string | null;
  lng: string | null;
  comentarios: string | null;
  sucursal_id: string;
  codigo: string;
}

interface FilaOverride {
  presentacion_id: string;
  precio: string;
  vigente_desde: string;
}

function aDetalle(
  fila: FilaDetalle,
  overrides: FilaOverride[],
  productosPromocion: string[],
): ClienteDetalle {
  return {
    id: fila.id,
    nombre: fila.nombre,
    domicilio: fila.domicilio,
    telefono: fila.telefono,
    encargado: fila.encargado,
    factura: fila.factura,
    tipo: fila.tipo as TipoCliente,
    tipoNegocioId: fila.tipo_negocio_id,
    listaPrecioId: fila.lista_precio_id,
    pctComision: aNumero(fila.pct_comision),
    promocion: fila.promocion as Promocion,
    plazoCreditoDias: fila.plazo_credito_dias,
    lat: aNumero(fila.lat),
    lng: aNumero(fila.lng),
    comentarios: fila.comentarios,
    sucursalId: fila.sucursal_id,
    sucursalCodigo: fila.codigo,
    overridesPrecio: overrides.map((o) => ({
      presentacionId: o.presentacion_id,
      precio: aNumero(o.precio) ?? 0,
      vigenteDesde: o.vigente_desde,
    })),
    productosPromocion,
  };
}

const COLUMNAS_RESUMEN = [
  'cliente.id',
  'cliente.nombre',
  'cliente.telefono',
  'cliente.tipo',
  'tipo_negocio.nombre as tipo_negocio_nombre',
  'sucursal.codigo',
] as const;

const COLUMNAS_DETALLE = [
  'cliente.id',
  'cliente.nombre',
  'cliente.domicilio',
  'cliente.telefono',
  'cliente.encargado',
  'cliente.factura',
  'cliente.tipo',
  'cliente.tipo_negocio_id',
  'cliente.lista_precio_id',
  'cliente.pct_comision',
  'cliente.promocion',
  'cliente.plazo_credito_dias',
  'cliente.lat',
  'cliente.lng',
  'cliente.comentarios',
  'cliente.sucursal_id',
  'sucursal.codigo',
] as const;

@Injectable()
export class ClientesRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async listar(tipo: TipoFiltro): Promise<ClienteResumen[]> {
    let query = this.db
      .selectFrom('cliente')
      .innerJoin('sucursal', 'sucursal.id', 'cliente.sucursal_id')
      .leftJoin('tipo_negocio', 'tipo_negocio.id', 'cliente.tipo_negocio_id')
      .select(COLUMNAS_RESUMEN)
      .where('cliente.deleted_at', 'is', null);
    if (tipo !== 'todos') {
      query = query.where('cliente.tipo', '=', tipo);
    }
    const filas = await query
      .orderBy('sucursal.codigo')
      .orderBy('cliente.nombre')
      .execute();
    return filas.map(aResumen);
  }

  async listarPorCodigoSucursal(
    codigo: string,
    tipo: TipoFiltro,
  ): Promise<ClienteResumen[]> {
    let query = this.db
      .selectFrom('cliente')
      .innerJoin('sucursal', 'sucursal.id', 'cliente.sucursal_id')
      .leftJoin('tipo_negocio', 'tipo_negocio.id', 'cliente.tipo_negocio_id')
      .select(COLUMNAS_RESUMEN)
      .where('cliente.deleted_at', 'is', null)
      .where('sucursal.codigo', '=', codigo);
    if (tipo !== 'todos') {
      query = query.where('cliente.tipo', '=', tipo);
    }
    const filas = await query.orderBy('cliente.nombre').execute();
    return filas.map(aResumen);
  }

  /**
   * El detalle completo: campos base + overrides VIGENTES (mismo `DISTINCT
   * ON` que `PreciosRepository.listarVigentes` de T-18, sin `sucursal_id`
   * porque el cliente ya pertenece a una sola) + productos de promocion.
   * Tres consultas en vez de un solo `LEFT JOIN` gigante: los overrides y la
   * promocion son colecciones (0..N filas), y mezclarlas con la fila de
   * `cliente` en un solo `SELECT` obligaria a deduplicar en memoria.
   */
  async obtener(id: string): Promise<ClienteDetalle | undefined> {
    const fila = await this.db
      .selectFrom('cliente')
      .innerJoin('sucursal', 'sucursal.id', 'cliente.sucursal_id')
      .select(COLUMNAS_DETALLE)
      .where('cliente.id', '=', id)
      .where('cliente.deleted_at', 'is', null)
      .executeTakeFirst();

    if (!fila) return undefined;

    const overrides = await sql<FilaOverride>`
      select distinct on (presentacion_id)
        presentacion_id, precio, vigente_desde::text as vigente_desde
      from cliente_precio
      where cliente_id = ${id}
        and deleted_at is null
        and vigente_desde <= current_date
      order by presentacion_id, vigente_desde desc
    `.execute(this.db);

    const productos = await this.db
      .selectFrom('cliente_promocion_producto')
      .select('producto_id')
      .where('cliente_id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();

    return aDetalle(
      fila,
      overrides.rows,
      productos.map((p) => p.producto_id),
    );
  }

  /** Delegado al helper compartido (D9 del plan, Task 2). */
  async buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuario(this.db, usuarioId);
  }
}
```

- [ ] **Step 4: Escribir el servicio (lectura)**

Crea `apps/backend/src/modules/cartera-clientes/clientes.service.ts`:

```typescript
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { resolverAlcance, type Alcance } from '../sucursales/alcance-sucursal';
import {
  ClientesRepository,
  type ClienteDetalle,
  type ClienteResumen,
  type TipoFiltro,
} from './clientes.repository';

/** Cualquier valor que no sea 'cliente'/'prospecto' se trata como "todos" (D7 del spec): es un filtro de exhibicion, sin implicacion de seguridad. */
export function normalizarTipoPedido(crudo: string | undefined): TipoFiltro {
  return crudo === 'cliente' || crudo === 'prospecto' ? crudo : 'todos';
}

@Injectable()
export class ClientesService {
  constructor(private readonly repo: ClientesRepository) {}

  async listar(
    usuarioId: string,
    sucursalPedida: string | null,
    tipo: TipoFiltro,
  ): Promise<ClienteResumen[]> {
    const alcance = await this.alcanceDe(usuarioId, sucursalPedida);
    return alcance.tipo === 'todas'
      ? this.repo.listar(tipo)
      : this.repo.listarPorCodigoSucursal(alcance.codigo, tipo);
  }

  async obtener(usuarioId: string, id: string): Promise<ClienteDetalle> {
    const cliente = await this.repo.obtener(id);
    if (!cliente) {
      throw new NotFoundException('No existe ese cliente.');
    }

    // Misma doctrina que VehiculosService.editar (T-11): el alcance se
    // compara contra la sucursal del cliente YA LEIDO, no contra un query
    // param -- aqui el hecho es lo que ya existe en la base.
    const alcance = await this.alcanceDe(usuarioId, null);
    if (alcance.tipo === 'una' && alcance.codigo !== cliente.sucursalCodigo) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }

    return cliente;
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

- [ ] **Step 5: Escribir el controller (lectura)**

Crea `apps/backend/src/modules/cartera-clientes/clientes.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import { ClientesService, normalizarTipoPedido } from './clientes.service';
import type { ClienteDetalle, ClienteResumen } from './clientes.repository';

// Sin @Publico(): el guard global protege todo por defecto. Ni listar ni
// leer el detalle exigen cliente.gestionar (D2 del spec): el candado va
// solo en escritura (Task 6/7), igual que Vehiculos (T-11) y Productos (T-10).
@Controller('clientes')
export class ClientesController {
  constructor(private readonly clientes: ClientesService) {}

  @Get()
  async listar(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
    @Query('tipo') tipo?: string,
  ): Promise<ClienteResumen[]> {
    return this.clientes.listar(
      usuarioId,
      normalizarSucursalPedida(sucursal),
      normalizarTipoPedido(tipo),
    );
  }

  @Get(':id')
  async obtener(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClienteDetalle> {
    return this.clientes.obtener(usuarioId, id);
  }
}
```

- [ ] **Step 6: Registrar en el módulo**

En `apps/backend/src/modules/cartera-clientes/cartera-clientes.module.ts`, agrega `ClientesController`/`ClientesService`/`ClientesRepository`:

```typescript
import { Module } from '@nestjs/common';
import { ClientesController } from './clientes.controller';
import { ClientesRepository } from './clientes.repository';
import { ClientesService } from './clientes.service';
import { ListasPrecioController } from './listas-precio.controller';
import { PreciosController } from './precios.controller';
import { PreciosRepository } from './precios.repository';
import { PreciosService } from './precios.service';
import { TiposNegocioController } from './tipos-negocio.controller';
import { TiposNegocioRepository } from './tipos-negocio.repository';
import { TiposNegocioService } from './tipos-negocio.service';

@Module({
  controllers: [
    ClientesController,
    ListasPrecioController,
    PreciosController,
    TiposNegocioController,
  ],
  providers: [
    ClientesService,
    ClientesRepository,
    PreciosService,
    PreciosRepository,
    TiposNegocioService,
    TiposNegocioRepository,
  ],
})
export class CarteraClientesModule {}
```

- [ ] **Step 7: Correr el e2e para verificar que pasa**

```bash
npm run test:e2e --workspace=apps/backend -- clientes.e2e-spec
```

Esperado: PASS, las 10 pruebas de esta tarea (5 de `GET /clientes` + 4 de `GET /clientes/:id`... cuenta la tuya, este plan no las hardcodea).

- [ ] **Step 8: `db:types` no hace falta**

Ninguna tabla ni columna cambió en esta tarea (Task 1 ya se aplicó). No corras `npm run db:types`.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/cartera-clientes/clientes.repository.ts \
        apps/backend/src/modules/cartera-clientes/clientes.service.ts \
        apps/backend/src/modules/cartera-clientes/clientes.controller.ts \
        apps/backend/src/modules/cartera-clientes/cartera-clientes.module.ts \
        apps/backend/test/clientes.e2e-spec.ts
git commit -m "$(cat <<'EOF'
T-12 · GET /clientes y GET /clientes/:id

Lectura del catalogo de clientes: lista acotada por sucursal (D6) y
tipo (D7), y el detalle completo con overrides de precio vigentes y
productos de promocion. Escritura llega en las siguientes dos tareas.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WjmEJNSj7BxSriQx3nb4GG
EOF
)"
```

---

### Task 6: Backend — `POST /clientes` (alta) (D4, D5, D6 del spec)

**Files:**
- Create: `apps/backend/src/modules/cartera-clientes/dto/override-precio.dto.ts`
- Create: `apps/backend/src/modules/cartera-clientes/dto/crear-cliente.dto.ts`
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.repository.ts` (agrega `crear`)
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.service.ts` (agrega `crear`)
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.controller.ts` (agrega `POST`)
- Modify: `apps/backend/test/clientes.e2e-spec.ts` (agrega `describe('POST /clientes', …)`)

**Interfaces:**
- Consumes: `reconciliarPromocionProductos()` de `./reconciliar-promocion-productos` (Task 3); `esViolacionFk()` de `../../database/errores-postgres` (Task 2); `ClienteDetalle`, `DatosClienteBase`, `TipoCliente` de `./clientes.repository` (Task 5).
- Produces: `ClientesRepository.crear(...)`, consumida solo por `ClientesService.crear()` de esta tarea.

- [ ] **Step 1: Escribir el DTO del override anidado**

Crea `apps/backend/src/modules/cartera-clientes/dto/override-precio.dto.ts`:

```typescript
import { IsNumber, IsUUID, Max, Min, ValidateIf } from 'class-validator';

/**
 * `precio: null` significa "usa el precio de lista, sin override" (D5 del
 * spec) -- Sin `@IsOptional()` a proposito: eso tambien aceptaria
 * `undefined`, y el campo SIEMPRE tiene que venir explicito (numero o
 * null), nunca faltar. `@ValidateIf` deja pasar `null` sin correr los
 * validadores numericos, pero si el valor es `undefined` la condicion sigue
 * siendo verdadera y `@IsNumber` lo rechaza -- es la combinacion que exige
 * "numero o null, nunca ausente".
 */
export class OverridePrecioDto {
  @IsUUID()
  presentacionId!: string;

  @ValidateIf((o: OverridePrecioDto) => o.precio !== null)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El precio debe ser un número con hasta 2 decimales.' },
  )
  @Min(0.01, { message: 'El precio debe ser mayor que cero.' })
  // Mismo tope que `precio.dto` de T-18: la columna es `numeric(12,2)`.
  @Max(9999999999.99, {
    message: 'El precio no puede pasar de 9,999,999,999.99.',
  })
  precio!: number | null;
}
```

- [ ] **Step 2: Escribir el DTO de alta**

Crea `apps/backend/src/modules/cartera-clientes/dto/crear-cliente.dto.ts`:

```typescript
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OverridePrecioDto } from './override-precio.dto';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CrearClienteDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  @MaxLength(120, { message: 'El nombre no puede pasar de 120 caracteres.' })
  nombre!: string;

  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El domicilio es obligatorio.' })
  @MaxLength(200, { message: 'El domicilio no puede pasar de 200 caracteres.' })
  domicilio!: string;

  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El teléfono es obligatorio.' })
  @MaxLength(30, { message: 'El teléfono no puede pasar de 30 caracteres.' })
  telefono!: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(120, { message: 'El nombre del encargado no puede pasar de 120 caracteres.' })
  encargado?: string;

  @IsBoolean()
  factura!: boolean;

  @IsIn(['cliente', 'prospecto'], {
    message: 'El tipo debe ser "cliente" o "prospecto".',
  })
  tipo!: 'cliente' | 'prospecto';

  @IsOptional()
  @IsUUID()
  tipoNegocioId?: string;

  @IsUUID()
  listaPrecioId!: string;

  // La columna es `numeric(5,2)`: hasta 999.99, pero un porcentaje de
  // comision no tiene sentido de negocio fuera de 0-100.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'El % de comisión no puede ser negativo.' })
  @Max(100, { message: 'El % de comisión no puede pasar de 100.' })
  pctComision?: number;

  @IsIn(['ninguna', '10+1', '20+1'], {
    message: 'La promoción debe ser "ninguna", "10+1" o "20+1".',
  })
  promocion!: 'ninguna' | '10+1' | '20+1';

  // Siempre presente (puede ser []), no opcional: el formulario manda el
  // estado completo (D4 del spec), igual que `presentaciones` en
  // EditarProductoDto de T-10.
  @IsArray()
  @IsUUID('4', { each: true })
  productosPromocion!: string[];

  @IsOptional()
  @IsInt()
  @Min(0, { message: 'El plazo de crédito no puede ser negativo.' })
  plazoCreditoDias?: number;

  // numeric(9,6): hasta 6 decimales, y el rango geografico real de una
  // latitud/longitud es mas estrecho que lo que la columna permitiria.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(2000, { message: 'Los comentarios no pueden pasar de 2000 caracteres.' })
  comentarios?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OverridePrecioDto)
  overridesPrecio!: OverridePrecioDto[];

  // Fecha LOCAL del navegador (D5 del spec), NUNCA algo que el servidor
  // derive -- mismo `@Matches` que `ActualizarPrecioDto` de T-18 en vez de
  // `@IsDateString()`, que aceptaria un datetime ISO completo.
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener el formato AAAA-MM-DD.',
  })
  vigenteDesde!: string;

  // Solo lo manda —y solo se le hace caso a— un usuario General (D6). A un
  // usuario atado se le ignora, no se le responde 403: no intenta salirse de
  // su alcance, su formulario ni siquiera pinta el campo.
  @IsOptional()
  @IsUUID()
  sucursalId?: string;
}
```

- [ ] **Step 3: Extender el e2e con el bloque de alta**

En `apps/backend/test/clientes.e2e-spec.ts`, agrega este `describe` **dentro** del `describe('Clientes (e2e)', ...)` existente, después del bloque `GET /clientes/:id`. Primero agrega este helper junto a `sembrarCliente`, para poder verificar y limpiar el catálogo de productos que usan los overrides/promoción:

```typescript
  /** Producto con una presentacion, para las pruebas de override y promocion. */
  const sembrarProducto = async (
    nombre: string,
  ): Promise<{ productoId: string; presentacionId: string }> => {
    const producto = await db
      .insertInto('producto')
      .values({ nombre })
      .returning('id')
      .executeTakeFirstOrThrow();
    const presentacion = await db
      .insertInto('presentacion')
      .values({ producto_id: producto.id, volumen: '500 ml' })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { productoId: producto.id, presentacionId: presentacion.id };
  };
```

Y este `describe`:

```typescript
  describe('POST /clientes', () => {
    const datosMinimos = (extra: Record<string, unknown> = {}) => ({
      nombre: `${PREFIJO} Alta`,
      domicilio: 'Domicilio',
      telefono: '000',
      factura: false,
      tipo: 'cliente',
      listaPrecioId: listaId,
      promocion: 'ninguna',
      productosPromocion: [],
      overridesPrecio: [],
      vigenteDesde: '2026-08-31',
      ...extra,
    });

    it('da de alta un cliente completo con override y promocion', async () => {
      const { productoId, presentacionId } = await sembrarProducto(
        `${PREFIJO} Producto Alta`,
      );

      const res = await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieTijuana)
        .send(
          datosMinimos({
            nombre: `${PREFIJO} Completo`,
            promocion: '10+1',
            productosPromocion: [productoId],
            overridesPrecio: [{ presentacionId, precio: 18.5 }],
          }),
        )
        .expect(201);

      const cliente = res.body as ClienteDetalleRespuesta;
      clienteIds.push(cliente.id);
      expect(cliente.sucursalCodigo).toBe('TJ');
      expect(cliente.promocion).toBe('10+1');
      expect(cliente.productosPromocion).toEqual([productoId]);
      expect(cliente.overridesPrecio).toEqual([
        { presentacionId, precio: 18.5, vigenteDesde: '2026-08-31' },
      ]);
    });

    it('promocion "ninguna" ignora productosPromocion aunque se manden ids (D4)', async () => {
      const { productoId } = await sembrarProducto(`${PREFIJO} Producto Ignorado`);

      const res = await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieTijuana)
        .send(datosMinimos({ productosPromocion: [productoId] }))
        .expect(201);

      const cliente = res.body as ClienteDetalleRespuesta;
      clienteIds.push(cliente.id);
      expect(cliente.productosPromocion).toEqual([]);
    });

    it('un usuario atado a TJ no puede mandar sucursalId de MX: se ignora, no 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieTijuana)
        .send(datosMinimos({ sucursalId: idMexicali }))
        .expect(201);

      const cliente = res.body as ClienteDetalleRespuesta;
      clienteIds.push(cliente.id);
      expect(cliente.sucursalCodigo).toBe('TJ');
    });

    it('un usuario General sin sucursalId recibe 400', async () => {
      await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieGeneral)
        .send(datosMinimos())
        .expect(400);
    });

    it('un usuario General con sucursalId da de alta en esa sucursal', async () => {
      const res = await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieGeneral)
        .send(datosMinimos({ sucursalId: idMexicali }))
        .expect(201);

      const cliente = res.body as ClienteDetalleRespuesta;
      clienteIds.push(cliente.id);
      expect(cliente.sucursalCodigo).toBe('MX');
    });

    it('responde 404 si listaPrecioId no existe', async () => {
      await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieTijuana)
        .send(
          datosMinimos({
            listaPrecioId: '00000000-0000-0000-0000-000000000000',
          }),
        )
        .expect(404);
    });

    it('responde 400 si falta un campo obligatorio', async () => {
      const { nombre: _nombre, ...sinNombre } = datosMinimos();
      await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieTijuana)
        .send(sinNombre)
        .expect(400);
    });

    it('rechaza sin cliente.gestionar con 403', async () => {
      await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieSinPermiso)
        .send(datosMinimos())
        .expect(403);
    });
  });
```

- [ ] **Step 4: Correr el e2e para verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend -- clientes.e2e-spec
```

Esperado: FAIL en el nuevo `describe('POST /clientes', …)` — `Cannot POST /clientes` (404). El bloque de `GET` de la Task 5 sigue en verde.

- [ ] **Step 5: Agregar `crear` al repositorio**

En `apps/backend/src/modules/cartera-clientes/clientes.repository.ts`, agrega el import de `Database` transaccional (ya está importado `Database`) y este método a la clase `ClientesRepository`, después de `obtener`:

```typescript
  /**
   * Alta: cliente, productos de promocion y overrides de precio en una sola
   * transaccion (D4 del spec) -- mismo criterio que
   * `ProductosRepository.crear` de T-10 (producto + presentaciones juntos).
   * `cliente_id` es nuevo en esta transaccion, asi que ni el unique de
   * `cliente_promocion_producto` ni `uq_cliente_precio_vigencia` pueden
   * chocar todavia: a diferencia de `actualizar()` (Task 7), aqui no hace
   * falta `on conflict`.
   */
  async crear(
    datos: DatosClienteBase & { tipo: TipoCliente; sucursal_id: string },
    productosPromocion: string[],
    overridesPrecio: { presentacionId: string; precio: number }[],
    vigenteDesde: string,
  ): Promise<ClienteDetalle> {
    const id = await this.db.transaction().execute(async (trx) => {
      const cliente = await trx
        .insertInto('cliente')
        .values({
          nombre: datos.nombre,
          domicilio: datos.domicilio,
          telefono: datos.telefono,
          encargado: datos.encargado,
          factura: datos.factura,
          tipo: datos.tipo,
          tipo_negocio_id: datos.tipo_negocio_id,
          lista_precio_id: datos.lista_precio_id,
          pct_comision: datos.pct_comision?.toString() ?? null,
          promocion: datos.promocion,
          plazo_credito_dias: datos.plazo_credito_dias,
          lat: datos.lat?.toString() ?? null,
          lng: datos.lng?.toString() ?? null,
          comentarios: datos.comentarios,
          sucursal_id: datos.sucursal_id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      if (productosPromocion.length > 0) {
        await trx
          .insertInto('cliente_promocion_producto')
          .values(
            productosPromocion.map((producto_id) => ({
              cliente_id: cliente.id,
              producto_id,
            })),
          )
          .execute();
      }

      if (overridesPrecio.length > 0) {
        await trx
          .insertInto('cliente_precio')
          .values(
            overridesPrecio.map((o) => ({
              cliente_id: cliente.id,
              presentacion_id: o.presentacionId,
              precio: o.precio.toString(),
              vigente_desde: vigenteDesde,
            })),
          )
          .execute();
      }

      return cliente.id;
    });

    // Fuera de la transaccion: `obtener()` ya sabe leer overrides+promocion,
    // y reusarlo evita duplicar esa lectura dentro de la transaccion.
    return (await this.obtener(id))!;
  }
```

- [ ] **Step 6: Agregar `crear` al servicio**

En `apps/backend/src/modules/cartera-clientes/clientes.service.ts`, agrega los imports:

```typescript
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { esViolacionFk } from '../../database/errores-postgres';
import { reconciliarPromocionProductos } from './reconciliar-promocion-productos';
import type { CrearClienteDto } from './dto/crear-cliente.dto';
```

Y este método a la clase, después de `obtener`:

```typescript
  async crear(usuarioId: string, dto: CrearClienteDto): Promise<ClienteDetalle> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) {
      throw new UnauthorizedException('Sesion invalida.');
    }

    // D6: la sucursal sale del alcance, no del cuerpo.
    const sucursalId = fila.id ?? dto.sucursalId;
    if (!sucursalId) {
      throw new BadRequestException('Indica a qué sucursal pertenece el cliente.');
    }

    const plan = reconciliarPromocionProductos(dto.promocion, [], dto.productosPromocion);

    try {
      return await this.repo.crear(
        {
          nombre: dto.nombre,
          domicilio: dto.domicilio,
          telefono: dto.telefono,
          encargado: dto.encargado ?? null,
          factura: dto.factura,
          tipo: dto.tipo,
          tipo_negocio_id: dto.tipoNegocioId ?? null,
          lista_precio_id: dto.listaPrecioId,
          pct_comision: dto.pctComision ?? null,
          promocion: dto.promocion,
          plazo_credito_dias: dto.plazoCreditoDias ?? null,
          lat: dto.lat ?? null,
          lng: dto.lng ?? null,
          comentarios: dto.comentarios ?? null,
          sucursal_id: sucursalId,
        },
        plan.insertar,
        // En el alta, un override con `precio: null` no tiene nada que
        // limpiar (no hay fila previa) -- se descarta antes de llegar al
        // repositorio.
        dto.overridesPrecio.filter(
          (o): o is { presentacionId: string; precio: number } => o.precio !== null,
        ),
        dto.vigenteDesde,
      );
    } catch (error) {
      if (esViolacionFk(error)) {
        throw new NotFoundException('Alguno de los datos enviados no existe.');
      }
      throw error;
    }
  }
```

- [ ] **Step 7: Agregar `POST` al controller**

En `apps/backend/src/modules/cartera-clientes/clientes.controller.ts`, agrega los imports:

```typescript
import { Body, Post } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { CrearClienteDto } from './dto/crear-cliente.dto';
```

(`Controller`, `Get`, `Param`, `ParseUUIDPipe`, `Query` ya estaban importados de `@nestjs/common`; añade `Body` y `Post` a esa misma línea de import en vez de una nueva.)

Y este método a la clase, después de `obtener`:

```typescript
  @Post()
  @RequierePermiso('cliente.gestionar')
  async crear(
    @UsuarioActual() usuarioId: string,
    @Body() dto: CrearClienteDto,
  ): Promise<ClienteDetalle> {
    return this.clientes.crear(usuarioId, dto);
  }
```

- [ ] **Step 8: Correr el e2e para verificar que pasa**

```bash
npm run test:e2e --workspace=apps/backend -- clientes.e2e-spec
```

Esperado: PASS, todo el archivo (bloques de `GET` de la Task 5 + `POST` de esta tarea).

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/cartera-clientes/dto/override-precio.dto.ts \
        apps/backend/src/modules/cartera-clientes/dto/crear-cliente.dto.ts \
        apps/backend/src/modules/cartera-clientes/clientes.repository.ts \
        apps/backend/src/modules/cartera-clientes/clientes.service.ts \
        apps/backend/src/modules/cartera-clientes/clientes.controller.ts \
        apps/backend/test/clientes.e2e-spec.ts
git commit -m "$(cat <<'EOF'
T-12 · POST /clientes (alta)

Un solo payload reconcilia datos base, productos de promocion
(reconciliarPromocionProductos, D4) y overrides de precio (D5) en una
transaccion. La sucursal sale del alcance del usuario, nunca del
cuerpo salvo que sea General (D6).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WjmEJNSj7BxSriQx3nb4GG
EOF
)"
```

---

### Task 7: Backend — `PATCH /clientes/:id` y `DELETE /clientes/:id` (D4, D5, D6 del spec)

**Files:**
- Create: `apps/backend/src/modules/cartera-clientes/dto/editar-cliente.dto.ts`
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.repository.ts` (agrega `actualizar`, `eliminar`)
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.service.ts` (agrega `editar`, `eliminar`)
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.controller.ts` (agrega `PATCH`, `DELETE`)
- Modify: `apps/backend/test/clientes.e2e-spec.ts` (agrega `describe('PATCH /clientes/:id', …)` y `describe('DELETE /clientes/:id', …)`)

**Interfaces:**
- Consumes: todo lo de la Task 6, más `PlanPromocionProductos` de `./reconciliar-promocion-productos`.
- Produces: `ClientesRepository.actualizar(...)`/`eliminar(...)`, consumidas solo por `ClientesService`.

**Hallazgo técnico de esta tarea (no está en el spec):** el `unique (cliente_id, producto_id)` de `cliente_promocion_producto` (T-05) **no excluye `deleted_at`** — a diferencia de `uq_vehiculo_nombre_sucursal` (T-11), que sí lo hace. Eso significa que un producto que se quitó de la promoción de un cliente (baja lógica) **bloquea permanentemente** volver a agregarlo: un `INSERT` liso chocaría con `23505` contra la fila dada de baja. El `Step 5` de esta tarea usa `ON CONFLICT ... DO UPDATE SET deleted_at = null` para revivir la fila en vez de insertar una nueva — es la única forma correcta con el esquema actual, y la prueba del `Step 3` (quitar y volver a agregar el mismo producto) es la que expone el problema si se implementa como un `INSERT` normal.

- [ ] **Step 1: Escribir el DTO de edición**

Crea `apps/backend/src/modules/cartera-clientes/dto/editar-cliente.dto.ts`:

```typescript
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OverridePrecioDto } from './override-precio.dto';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Mismos campos que `CrearClienteDto`, MENOS `tipo` y `sucursalId` (D6 del
 * spec): la sucursal de un cliente no se cambia, y reclasificar
 * Cliente<->Prospecto no lo pide el issue. El resto de los campos base son
 * obligatorios y no opcionales -- el formulario manda el estado COMPLETO en
 * cada guardado (mismo criterio que `EditarProductoDto` de T-10, a
 * diferencia de `EditarVehiculoDto` de T-11, que sí es un PATCH parcial de
 * campos independientes).
 */
export class EditarClienteDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  @MaxLength(120, { message: 'El nombre no puede pasar de 120 caracteres.' })
  nombre!: string;

  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El domicilio es obligatorio.' })
  @MaxLength(200, { message: 'El domicilio no puede pasar de 200 caracteres.' })
  domicilio!: string;

  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El teléfono es obligatorio.' })
  @MaxLength(30, { message: 'El teléfono no puede pasar de 30 caracteres.' })
  telefono!: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(120, { message: 'El nombre del encargado no puede pasar de 120 caracteres.' })
  encargado?: string;

  @IsBoolean()
  factura!: boolean;

  @IsOptional()
  @IsUUID()
  tipoNegocioId?: string;

  @IsUUID()
  listaPrecioId!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'El % de comisión no puede ser negativo.' })
  @Max(100, { message: 'El % de comisión no puede pasar de 100.' })
  pctComision?: number;

  @IsIn(['ninguna', '10+1', '20+1'], {
    message: 'La promoción debe ser "ninguna", "10+1" o "20+1".',
  })
  promocion!: 'ninguna' | '10+1' | '20+1';

  @IsArray()
  @IsUUID('4', { each: true })
  productosPromocion!: string[];

  @IsOptional()
  @IsInt()
  @Min(0, { message: 'El plazo de crédito no puede ser negativo.' })
  plazoCreditoDias?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(2000, { message: 'Los comentarios no pueden pasar de 2000 caracteres.' })
  comentarios?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OverridePrecioDto)
  overridesPrecio!: OverridePrecioDto[];

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener el formato AAAA-MM-DD.',
  })
  vigenteDesde!: string;
}
```

- [ ] **Step 2: Extender el e2e con los bloques de edición y baja**

En `apps/backend/test/clientes.e2e-spec.ts`, agrega, después del `describe('POST /clientes', …)`:

```typescript
  describe('PATCH /clientes/:id', () => {
    const cambios = (extra: Record<string, unknown> = {}) => ({
      nombre: `${PREFIJO} Editado`,
      domicilio: 'Domicilio editado',
      telefono: '111',
      factura: true,
      listaPrecioId: listaId,
      promocion: 'ninguna',
      productosPromocion: [],
      overridesPrecio: [],
      vigenteDesde: '2026-08-31',
      ...extra,
    });

    it('edita los datos base de un cliente', async () => {
      const id = await sembrarCliente(`${PREFIJO} Editar`, idTijuana);

      const res = await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios())
        .expect(200);

      const cliente = res.body as ClienteDetalleRespuesta;
      expect(cliente.nombre).toBe(`${PREFIJO} Editado`);
      expect(cliente.telefono).toBe('111');
      expect(cliente.factura).toBe(true);
      expect(cliente.sucursalCodigo).toBe('TJ');
    });

    it('corrige el mismo override el mismo dia en vez de duplicarlo', async () => {
      const id = await sembrarCliente(`${PREFIJO} Override`, idTijuana);
      const { presentacionId } = await sembrarProducto(`${PREFIJO} Producto Override`);

      await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ overridesPrecio: [{ presentacionId, precio: 15 }] }))
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ overridesPrecio: [{ presentacionId, precio: 16 }] }))
        .expect(200);

      const cliente = res.body as ClienteDetalleRespuesta;
      expect(cliente.overridesPrecio).toEqual([
        { presentacionId, precio: 16, vigenteDesde: '2026-08-31' },
      ]);

      const filas = await db
        .selectFrom('cliente_precio')
        .select('id')
        .where('cliente_id', '=', id)
        .where('presentacion_id', '=', presentacionId)
        .execute();
      expect(filas).toHaveLength(1);
    });

    it('precio: null quita el override del dia (D5)', async () => {
      const id = await sembrarCliente(`${PREFIJO} Quitar Override`, idTijuana);
      const { presentacionId } = await sembrarProducto(`${PREFIJO} Producto Quitar`);

      await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ overridesPrecio: [{ presentacionId, precio: 15 }] }))
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ overridesPrecio: [{ presentacionId, precio: null }] }))
        .expect(200);

      const cliente = res.body as ClienteDetalleRespuesta;
      expect(cliente.overridesPrecio).toEqual([]);
    });

    it('quitar y volver a agregar el mismo producto de promocion no revienta con 23505', async () => {
      const id = await sembrarCliente(`${PREFIJO} Promo Vuelta`, idTijuana);
      const { productoId } = await sembrarProducto(`${PREFIJO} Producto Vuelta`);

      await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ promocion: '10+1', productosPromocion: [productoId] }))
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ promocion: 'ninguna', productosPromocion: [] }))
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ promocion: '20+1', productosPromocion: [productoId] }))
        .expect(200);

      const cliente = res.body as ClienteDetalleRespuesta;
      expect(cliente.productosPromocion).toEqual([productoId]);
    });

    it('un usuario atado a TJ no puede editar un cliente de MX', async () => {
      const id = await sembrarCliente(`${PREFIJO} Editar MX`, idMexicali);

      await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios())
        .expect(403);
    });

    it('responde 404 para un id que no existe', async () => {
      await request(app.getHttpServer())
        .patch('/clientes/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieTijuana)
        .send(cambios())
        .expect(404);
    });

    it('rechaza sin cliente.gestionar con 403', async () => {
      const id = await sembrarCliente(`${PREFIJO} Sin Permiso Editar`, idTijuana);

      await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieSinPermiso)
        .send(cambios())
        .expect(403);
    });
  });

  describe('DELETE /clientes/:id', () => {
    it('da de baja logica: desaparece del listado pero sigue en la base', async () => {
      const id = await sembrarCliente(`${PREFIJO} Baja`, idTijuana);

      await request(app.getHttpServer())
        .delete(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/clientes')
        .set('Cookie', cookieTijuana)
        .expect(200);
      const nombres = (res.body as ClienteResumenRespuesta[]).map((c) => c.nombre);
      expect(nombres).not.toContain(`${PREFIJO} Baja`);

      const fila = await db
        .selectFrom('cliente')
        .select('deleted_at')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(fila.deleted_at).not.toBeNull();
    });

    it('un usuario atado a TJ no puede dar de baja un cliente de MX', async () => {
      const id = await sembrarCliente(`${PREFIJO} Baja MX`, idMexicali);

      await request(app.getHttpServer())
        .delete(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('responde 404 para un id que no existe', async () => {
      await request(app.getHttpServer())
        .delete('/clientes/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieTijuana)
        .expect(404);
    });

    it('rechaza sin cliente.gestionar con 403', async () => {
      const id = await sembrarCliente(`${PREFIJO} Sin Permiso Baja`, idTijuana);

      await request(app.getHttpServer())
        .delete(`/clientes/${id}`)
        .set('Cookie', cookieSinPermiso)
        .expect(403);
    });
  });
```

- [ ] **Step 3: Correr el e2e para verificar que falla**

```bash
npm run test:e2e --workspace=apps/backend -- clientes.e2e-spec
```

Esperado: FAIL en los dos `describe` nuevos — `Cannot PATCH /clientes/:id` y `Cannot DELETE /clientes/:id` (404). Los bloques de `GET`/`POST` de las Tasks 5-6 siguen en verde.

- [ ] **Step 4: Agregar `actualizar` y `eliminar` al repositorio**

En `apps/backend/src/modules/cartera-clientes/clientes.repository.ts`, agrega el import de `PlanPromocionProductos`:

```typescript
import type { PlanPromocionProductos } from './reconciliar-promocion-productos';
```

Y estos dos métodos a la clase, después de `crear` (de la Task 6):

```typescript
  /**
   * Edición: datos base + productos de promocion + overrides, todo en una
   * transaccion. A diferencia de `crear()`, aqui SI puede haber conflicto
   * (el cliente ya existe), asi que las dos colecciones usan `on conflict`
   * en vez de un `insert` liso.
   */
  async actualizar(
    id: string,
    cambios: DatosClienteBase,
    planPromocion: PlanPromocionProductos,
    overridesPrecio: { presentacionId: string; precio: number | null }[],
    vigenteDesde: string,
  ): Promise<ClienteDetalle> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('cliente')
        .set({
          nombre: cambios.nombre,
          domicilio: cambios.domicilio,
          telefono: cambios.telefono,
          encargado: cambios.encargado,
          factura: cambios.factura,
          tipo_negocio_id: cambios.tipo_negocio_id,
          lista_precio_id: cambios.lista_precio_id,
          pct_comision: cambios.pct_comision?.toString() ?? null,
          promocion: cambios.promocion,
          plazo_credito_dias: cambios.plazo_credito_dias,
          lat: cambios.lat?.toString() ?? null,
          lng: cambios.lng?.toString() ?? null,
          comentarios: cambios.comentarios,
        })
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

      if (planPromocion.eliminar.length > 0) {
        await trx
          .updateTable('cliente_promocion_producto')
          .set({ deleted_at: new Date() })
          .where('cliente_id', '=', id)
          .where('producto_id', 'in', planPromocion.eliminar)
          .execute();
      }

      if (planPromocion.insertar.length > 0) {
        // El unique (cliente_id, producto_id) de T-05 NO excluye
        // `deleted_at` (a diferencia de uq_vehiculo_nombre_sucursal de
        // T-11): una fila dada de baja sigue ocupando la combinacion. Un
        // `insert` liso chocaria con 23505 al volver a agregar un producto
        // que antes se habia quitado de la promocion -- revivir la fila con
        // `on conflict ... do update` es obligatorio, no una optimizacion.
        await trx
          .insertInto('cliente_promocion_producto')
          .values(
            planPromocion.insertar.map((producto_id) => ({
              cliente_id: id,
              producto_id,
            })),
          )
          .onConflict((oc) =>
            oc.columns(['cliente_id', 'producto_id']).doUpdateSet({ deleted_at: null }),
          )
          .execute();
      }

      for (const override of overridesPrecio) {
        if (override.precio === null) {
          // Solo borra la fila de HOY si existe (D5): no hay nada que
          // limpiar de un override que nunca se guardo en esta fecha.
          await trx
            .updateTable('cliente_precio')
            .set({ deleted_at: new Date() })
            .where('cliente_id', '=', id)
            .where('presentacion_id', '=', override.presentacionId)
            .where('vigente_desde', '=', vigenteDesde)
            .execute();
          continue;
        }

        await trx
          .insertInto('cliente_precio')
          .values({
            cliente_id: id,
            presentacion_id: override.presentacionId,
            precio: override.precio.toString(),
            vigente_desde: vigenteDesde,
          })
          .onConflict((oc) =>
            oc
              .constraint('uq_cliente_precio_vigencia')
              .doUpdateSet({ precio: (override.precio as number).toString() }),
          )
          .execute();
      }
    });

    return (await this.obtener(id))!;
  }

  async eliminar(id: string): Promise<void> {
    await this.db
      .updateTable('cliente')
      .set({ deleted_at: new Date() })
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  }
```

- [ ] **Step 5: Agregar `editar` y `eliminar` al servicio**

En `apps/backend/src/modules/cartera-clientes/clientes.service.ts`, agrega el import:

```typescript
import type { EditarClienteDto } from './dto/editar-cliente.dto';
```

Y estos dos métodos a la clase, después de `crear` (de la Task 6):

```typescript
  async editar(
    usuarioId: string,
    id: string,
    dto: EditarClienteDto,
  ): Promise<ClienteDetalle> {
    const cliente = await this.repo.obtener(id);
    if (!cliente) {
      throw new NotFoundException('No existe ese cliente.');
    }

    const alcance = await this.alcanceDe(usuarioId, null);
    if (alcance.tipo === 'una' && alcance.codigo !== cliente.sucursalCodigo) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }

    const plan = reconciliarPromocionProductos(
      dto.promocion,
      cliente.productosPromocion,
      dto.productosPromocion,
    );

    try {
      return await this.repo.actualizar(
        id,
        {
          nombre: dto.nombre,
          domicilio: dto.domicilio,
          telefono: dto.telefono,
          encargado: dto.encargado ?? null,
          factura: dto.factura,
          tipo_negocio_id: dto.tipoNegocioId ?? null,
          lista_precio_id: dto.listaPrecioId,
          pct_comision: dto.pctComision ?? null,
          promocion: dto.promocion,
          plazo_credito_dias: dto.plazoCreditoDias ?? null,
          lat: dto.lat ?? null,
          lng: dto.lng ?? null,
          comentarios: dto.comentarios ?? null,
        },
        plan,
        dto.overridesPrecio,
        dto.vigenteDesde,
      );
    } catch (error) {
      if (esViolacionFk(error)) {
        throw new NotFoundException('Alguno de los datos enviados no existe.');
      }
      throw error;
    }
  }

  async eliminar(usuarioId: string, id: string): Promise<void> {
    const cliente = await this.repo.obtener(id);
    if (!cliente) {
      throw new NotFoundException('No existe ese cliente.');
    }

    const alcance = await this.alcanceDe(usuarioId, null);
    if (alcance.tipo === 'una' && alcance.codigo !== cliente.sucursalCodigo) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }

    await this.repo.eliminar(id);
  }
```

También cambia `protected async alcanceDe` por `private async alcanceDe` — con `crear`/`editar`/`eliminar` ya en la misma clase no hace falta que una subclase la use, y `private` es más estricto (queda igual que `VehiculosService`/`PreciosService`).

- [ ] **Step 6: Agregar `PATCH` y `DELETE` al controller**

En `apps/backend/src/modules/cartera-clientes/clientes.controller.ts`, agrega los imports:

```typescript
import { Delete, Patch } from '@nestjs/common';
import { EditarClienteDto } from './dto/editar-cliente.dto';
```

(añade `Delete` y `Patch` a la línea de import existente de `@nestjs/common` en vez de una nueva).

Y estos dos métodos a la clase, después de `crear`:

```typescript
  @Patch(':id')
  @RequierePermiso('cliente.gestionar')
  async editar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarClienteDto,
  ): Promise<ClienteDetalle> {
    return this.clientes.editar(usuarioId, id, dto);
  }

  @Delete(':id')
  @RequierePermiso('cliente.gestionar')
  async eliminar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.clientes.eliminar(usuarioId, id);
    return { id };
  }
```

- [ ] **Step 7: Correr el e2e completo para verificar que pasa**

```bash
npm run test:e2e --workspace=apps/backend -- clientes.e2e-spec
```

Esperado: PASS, el archivo completo (`GET`, `POST`, `PATCH`, `DELETE`).

- [ ] **Step 8: Correr toda la suite del backend**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm run supabase -- test db
```

Esperado: lint y build sin errores; las cuatro suites en verde, cada una con más pruebas que la línea base de la Task 0 (exactamente cuántas más, según lo que anotaste en cada tarea).

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/cartera-clientes/dto/editar-cliente.dto.ts \
        apps/backend/src/modules/cartera-clientes/clientes.repository.ts \
        apps/backend/src/modules/cartera-clientes/clientes.service.ts \
        apps/backend/src/modules/cartera-clientes/clientes.controller.ts \
        apps/backend/test/clientes.e2e-spec.ts
git commit -m "$(cat <<'EOF'
T-12 · PATCH/DELETE /clientes/:id

Edicion completa (datos base + overrides + promocion, todo
reconciliado) y baja logica. Revive con on conflict...do update una
fila de cliente_promocion_producto dada de baja: su unique no excluye
deleted_at, asi que un insert liso chocaria con 23505 al volver a
agregar un producto quitado antes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WjmEJNSj7BxSriQx3nb4GG
EOF
)"
```

Con esta tarea el backend queda completo. Las Tasks 8-12 son el portal.

---

### Task 8: Portal — capa de datos (`lib/clientes.ts` + `lib/tipos-negocio.ts`)

**Files:**
- Create: `apps/portal/src/lib/tipos-negocio.ts`
- Create: `apps/portal/src/lib/clientes.ts`

**Interfaces:**
- Consumes: `apiFetch()`/`ErrorApi` de `./api`.
- Produces: `ClienteResumen`, `ClienteDetalle`, `OverridePrecio`, `TipoFiltro`, `DatosClienteFormulario`, `listarClientes`, `obtenerCliente`, `crearCliente`, `editarCliente`, `eliminarCliente` (consumidos por Tasks 9-11); `TipoNegocio`, `listarTiposNegocio`, `crearTipoNegocio` (consumidos por Task 9).

**Nota:** esta capa no tiene pruebas propias — mismo criterio que `lib/vehiculos.ts` y `lib/precios.ts` (son "una copia normativa" del backend, sin lógica que valga la pena aislar; la cobertura real llega con las pruebas de pantalla de la Task 12, que mockean estos módulos).

- [ ] **Step 1: Escribir `lib/tipos-negocio.ts`**

Crea `apps/portal/src/lib/tipos-negocio.ts`:

```typescript
import { apiFetch } from "./api";

// Copia normativa de `TipoNegocio` en
// apps/backend/src/modules/cartera-clientes/tipos-negocio.repository.ts —
// mismo trato que el resto de `lib/*.ts` (ver CLAUDE.md, T-07).
export interface TipoNegocio {
  id: string;
  nombre: string;
}

export function listarTiposNegocio(): Promise<TipoNegocio[]> {
  return apiFetch<TipoNegocio[]>("/tipos-negocio");
}

export function crearTipoNegocio(nombre: string): Promise<TipoNegocio> {
  return apiFetch<TipoNegocio>("/tipos-negocio", {
    method: "POST",
    body: JSON.stringify({ nombre }),
  });
}
```

- [ ] **Step 2: Escribir `lib/clientes.ts`**

Crea `apps/portal/src/lib/clientes.ts`:

```typescript
import { apiFetch } from "./api";

// Copia normativa de las formas que devuelve
// apps/backend/src/modules/cartera-clientes/clientes.repository.ts
// (interfaces `ClienteResumen`, `ClienteDetalle`, `OverridePrecio`,
// `TipoFiltro` de ese archivo).
export type TipoCliente = "cliente" | "prospecto";
export type TipoFiltro = TipoCliente | "todos";
export type Promocion = "ninguna" | "10+1" | "20+1";

export interface ClienteResumen {
  id: string;
  nombre: string;
  telefono: string;
  tipo: TipoCliente;
  tipoNegocio: string | null;
  sucursalCodigo: string;
}

export interface OverridePrecio {
  presentacionId: string;
  precio: number;
  vigenteDesde: string;
}

export interface ClienteDetalle {
  id: string;
  nombre: string;
  domicilio: string;
  telefono: string;
  encargado: string | null;
  factura: boolean;
  tipo: TipoCliente;
  tipoNegocioId: string | null;
  listaPrecioId: string;
  pctComision: number | null;
  promocion: Promocion;
  plazoCreditoDias: number | null;
  lat: number | null;
  lng: number | null;
  comentarios: string | null;
  sucursalId: string;
  sucursalCodigo: string;
  overridesPrecio: OverridePrecio[];
  productosPromocion: string[];
}

export function listarClientes(
  sucursal: string | null,
  tipo: TipoFiltro,
): Promise<ClienteResumen[]> {
  const params = new URLSearchParams();
  if (sucursal) params.set("sucursal", sucursal);
  if (tipo !== "todos") params.set("tipo", tipo);
  const query = params.toString();
  return apiFetch<ClienteResumen[]>(`/clientes${query ? `?${query}` : ""}`);
}

export function obtenerCliente(id: string): Promise<ClienteDetalle> {
  return apiFetch<ClienteDetalle>(`/clientes/${id}`);
}

/**
 * Fecha LOCAL del navegador, NUNCA `toISOString()` (que es UTC) — mismo
 * riesgo de zona horaria que `hoyLocalIso()` de `lib/precios.ts` (T-18) y
 * `fecha_operacion` de folios (CLAUDE.md). Es la SEGUNDA copia de esta
 * función en el portal (la primera es la de precios): se duplica a
 * propósito, no se extrae todavía — mismo criterio que
 * `buscarSucursalUsuario` en el backend antes de su cuarta copia (D9 del
 * plan), aquí apenas la segunda.
 */
function hoyLocalIso(): string {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const dia = String(ahora.getDate()).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

/** Lo que arma el formulario de Cliente (Task 10), antes de decidir alta o edición. */
export interface DatosClienteFormulario {
  nombre: string;
  domicilio: string;
  telefono: string;
  encargado?: string;
  factura: boolean;
  tipoNegocioId?: string;
  listaPrecioId: string;
  pctComision?: number;
  promocion: Promocion;
  productosPromocion: string[];
  plazoCreditoDias?: number;
  lat?: number;
  lng?: number;
  comentarios?: string;
  overridesPrecio: { presentacionId: string; precio: number | null }[];
}

export function crearCliente(
  datos: DatosClienteFormulario & { tipo: TipoCliente; sucursalId?: string },
): Promise<ClienteDetalle> {
  return apiFetch<ClienteDetalle>("/clientes", {
    method: "POST",
    body: JSON.stringify({ ...datos, vigenteDesde: hoyLocalIso() }),
  });
}

export function editarCliente(
  id: string,
  datos: DatosClienteFormulario,
): Promise<ClienteDetalle> {
  return apiFetch<ClienteDetalle>(`/clientes/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ ...datos, vigenteDesde: hoyLocalIso() }),
  });
}

export function eliminarCliente(id: string): Promise<void> {
  return apiFetch<void>(`/clientes/${id}`, { method: "DELETE" });
}
```

- [ ] **Step 3: Verificar tipos**

```bash
npm run build --workspace=apps/portal
```

Esperado: build en verde — todavía no hay nada que importe estos módulos, así que solo confirma que compilan solos.

- [ ] **Step 4: Commit**

```bash
git add apps/portal/src/lib/tipos-negocio.ts apps/portal/src/lib/clientes.ts
git commit -m "$(cat <<'EOF'
T-12 · Capa de datos del portal para Clientes y Tipos de Negocio

Copia normativa de las formas del backend, mismo trato que
lib/vehiculos.ts y lib/precios.ts. hoyLocalIso() se duplica de
lib/precios.ts a proposito (segunda copia, no amerita extraerse
todavia).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WjmEJNSj7BxSriQx3nb4GG
EOF
)"
```

---

### Task 9: Portal — `SelectorTipoNegocio` (D1 del spec)

**Files:**
- Create: `apps/portal/src/components/clientes/selector-tipo-negocio.tsx`

**Interfaces:**
- Consumes: `listarTiposNegocio()`, `crearTipoNegocio()`, `type TipoNegocio` de `@/lib/tipos-negocio` (Task 8).
- Produces: `<SelectorTipoNegocio value onChange disabled />`, consumido por `FormularioCliente` (Task 10).

Sin dependencia nueva (ninguna librería de combobox instalada en el portal, ver el spec): un `<select>` con un valor centinela `"__nuevo__"` que revela un input + botón "Crear" en el momento, mismo espíritu artesanal que el resto de formularios del portal.

- [ ] **Step 1: Escribir el componente**

Crea `apps/portal/src/components/clientes/selector-tipo-negocio.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  crearTipoNegocio,
  listarTiposNegocio,
  type TipoNegocio,
} from "@/lib/tipos-negocio";

const NUEVO = "__nuevo__";

interface Props {
  /** "" = sin tipo de negocio asignado. */
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

export function SelectorTipoNegocio({ value, onChange, disabled }: Props) {
  const [tipos, setTipos] = useState<TipoNegocio[]>([]);
  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    listarTiposNegocio()
      .then((lista) => {
        if (vigente) setTipos(lista);
      })
      .catch(() => {
        // El desplegable se queda vacio salvo "+ Nuevo…": el usuario sigue
        // pudiendo crear uno, que es el camino que mas importa cubrir.
      });
    return () => {
      vigente = false;
    };
  }, []);

  function alCambiarSelect(id: string) {
    if (id === NUEVO) {
      setCreando(true);
      return;
    }
    onChange(id);
  }

  async function crear() {
    const nombre = nombreNuevo.trim();
    if (!nombre) return;
    setGuardando(true);
    setError(null);
    try {
      const tipo = await crearTipoNegocio(nombre);
      setTipos((previos) =>
        [...previos, tipo].sort((a, b) => a.nombre.localeCompare(b.nombre)),
      );
      onChange(tipo.id);
      setCreando(false);
      setNombreNuevo("");
    } catch {
      setError("No se pudo crear el tipo de negocio.");
    } finally {
      setGuardando(false);
    }
  }

  if (creando) {
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tipo-negocio-nuevo" className="text-sm font-medium">
          Nuevo tipo de negocio
        </label>
        <div className="flex gap-2">
          <input
            id="tipo-negocio-nuevo"
            autoFocus
            disabled={guardando}
            value={nombreNuevo}
            onChange={(e) => setNombreNuevo(e.target.value)}
            className="flex-1 rounded-md border px-3 py-2 text-sm"
            placeholder="Restaurante, tienda, ..."
          />
          <Button
            type="button"
            size="sm"
            disabled={guardando || !nombreNuevo.trim()}
            onClick={() => void crear()}
          >
            {guardando ? "Creando…" : "Crear"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={guardando}
            onClick={() => {
              setCreando(false);
              setNombreNuevo("");
            }}
          >
            Cancelar
          </Button>
        </div>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="tipo-negocio" className="text-sm font-medium">
        Tipo de negocio
      </label>
      <select
        id="tipo-negocio"
        disabled={disabled}
        value={value}
        onChange={(e) => alCambiarSelect(e.target.value)}
        className="w-64 rounded-md border px-3 py-2 text-sm"
      >
        <option value="">Sin especificar</option>
        {tipos.map((t) => (
          <option key={t.id} value={t.id}>
            {t.nombre}
          </option>
        ))}
        <option value={NUEVO}>+ Nuevo tipo de negocio…</option>
      </select>
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
git add apps/portal/src/components/clientes/selector-tipo-negocio.tsx
git commit -m "$(cat <<'EOF'
T-12 · SelectorTipoNegocio con alta inline (D1)

Combobox artesanal (select + input condicional), sin dependencia
nueva: la tabla tipo_negocio existia vacia desde T-05 sin lista del
cliente, y una pantalla de catalogo aparte para eso seria
especulativo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WjmEJNSj7BxSriQx3nb4GG
EOF
)"
```

---

### Task 10: Portal — `FormularioCliente` (todas las secciones)

**Files:**
- Create: `apps/portal/src/components/clientes/formulario-cliente.tsx`

**Interfaces:**
- Consumes: `SelectorTipoNegocio` (Task 9); `useEnvioFormulario` de `@/components/catalogo/use-envio-formulario`; `useAuth` de `@/components/auth/auth-provider`; `listarSucursales`/`type Sucursal` de `@/lib/sucursales`; `listarProductos`/`type Producto` de `@/lib/productos`; `listarListasPrecio`/`type ListaPrecio` de `@/lib/precios`; `crearCliente`/`editarCliente`/`type ClienteDetalle` de `@/lib/clientes` (Task 8).
- Produces: `<FormularioCliente cliente alGuardar alCancelar />`, consumido por `PantallaClientes` (Task 11).

Esta tarea no escribe pruebas propias (la pantalla completa se prueba en la Task 12, montando este formulario dentro — mismo orden que T-09/T-10/T-11 siguieron antes de que existiera el patrón de pruebas de pantalla).

- [ ] **Step 1: Escribir el componente**

Crea `apps/portal/src/components/clientes/formulario-cliente.tsx`:

```tsx
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import { listarProductos, type Producto } from "@/lib/productos";
import { listarListasPrecio, type ListaPrecio } from "@/lib/precios";
import {
  crearCliente,
  editarCliente,
  type ClienteDetalle,
  type Promocion,
} from "@/lib/clientes";
import { SelectorTipoNegocio } from "./selector-tipo-negocio";

interface Props {
  /** El cliente a editar, o null para dar de alta uno nuevo. */
  cliente: ClienteDetalle | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

export function FormularioCliente({ cliente, alGuardar, alCancelar }: Props) {
  const { usuario } = useAuth();
  const esAlta = cliente === null;

  // Mismo criterio que FormularioVehiculo (T-11, D3): solo un General elige
  // sucursal, y solo al dar de alta.
  const eligeSucursal = esAlta && usuario !== null && usuario.sucursal === null;

  const [nombre, setNombre] = useState(cliente?.nombre ?? "");
  const [domicilio, setDomicilio] = useState(cliente?.domicilio ?? "");
  const [telefono, setTelefono] = useState(cliente?.telefono ?? "");
  const [encargado, setEncargado] = useState(cliente?.encargado ?? "");
  const [factura, setFactura] = useState(cliente?.factura ?? false);
  const [tipo, setTipo] = useState<"cliente" | "prospecto">(cliente?.tipo ?? "cliente");
  const [tipoNegocioId, setTipoNegocioId] = useState(cliente?.tipoNegocioId ?? "");
  const [listaPrecioId, setListaPrecioId] = useState(cliente?.listaPrecioId ?? "");
  const [pctComision, setPctComision] = useState(
    cliente?.pctComision?.toString() ?? "",
  );
  const [promocion, setPromocion] = useState<Promocion>(cliente?.promocion ?? "ninguna");
  const [productosPromocion, setProductosPromocion] = useState<string[]>(
    cliente?.productosPromocion ?? [],
  );
  const [plazoCreditoDias, setPlazoCreditoDias] = useState(
    cliente?.plazoCreditoDias?.toString() ?? "",
  );
  const [lat, setLat] = useState(cliente?.lat?.toString() ?? "");
  const [lng, setLng] = useState(cliente?.lng?.toString() ?? "");
  const [comentarios, setComentarios] = useState(cliente?.comentarios ?? "");
  const [sucursalId, setSucursalId] = useState("");

  // Punto de partida de los overrides: presentacionId -> texto del input.
  // Se calcula UNA vez (no en un efecto) porque PantallaClientes remonta
  // este formulario con `key={cliente.id}` al cambiar de fila (mismo motivo
  // que documenta CeldaPrecio en T-18), asi que nunca hace falta
  // resincronizar con un prop que cambio por debajo.
  const [overridesIniciales] = useState(
    () =>
      new Map((cliente?.overridesPrecio ?? []).map((o) => [o.presentacionId, o.precio.toString()])),
  );
  const [overrides, setOverrides] = useState<Map<string, string>>(
    () => new Map(overridesIniciales),
  );

  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [listas, setListas] = useState<ListaPrecio[]>([]);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo guardar el cliente.");

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

  useEffect(() => {
    let vigente = true;
    Promise.all([listarProductos(), listarListasPrecio()])
      .then(([p, l]) => {
        if (vigente) {
          setProductos(p);
          setListas(l);
        }
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, []);

  function alternarProducto(id: string) {
    setProductosPromocion((previos) =>
      previos.includes(id) ? previos.filter((p) => p !== id) : [...previos, id],
    );
  }

  function cambiarOverride(presentacionId: string, texto: string) {
    setOverrides((previos) => {
      const copia = new Map(previos);
      if (texto.trim() === "") {
        copia.delete(presentacionId);
      } else {
        copia.set(presentacionId, texto);
      }
      return copia;
    });
  }

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();

    // Un override que existia al abrir el formulario y ya no aparece en
    // `overrides` (el usuario lo vacio) viaja como `precio: null` para que
    // el backend lo borre (D5 del spec); uno que sigue o es nuevo viaja con
    // su número.
    const overridesPrecio = Array.from(overridesIniciales.keys())
      .filter((id) => !overrides.has(id))
      .map((presentacionId) => ({ presentacionId, precio: null as number | null }))
      .concat(
        Array.from(overrides.entries()).map(([presentacionId, texto]) => ({
          presentacionId,
          precio: Number(texto),
        })),
      );

    const datos = {
      nombre,
      domicilio,
      telefono,
      encargado: encargado.trim() === "" ? undefined : encargado,
      factura,
      tipoNegocioId: tipoNegocioId === "" ? undefined : tipoNegocioId,
      listaPrecioId,
      pctComision: pctComision.trim() === "" ? undefined : Number(pctComision),
      promocion,
      productosPromocion,
      plazoCreditoDias:
        plazoCreditoDias.trim() === "" ? undefined : Number(plazoCreditoDias),
      lat: lat.trim() === "" ? undefined : Number(lat),
      lng: lng.trim() === "" ? undefined : Number(lng),
      comentarios: comentarios.trim() === "" ? undefined : comentarios,
      overridesPrecio,
    };

    await enviar(
      () =>
        cliente
          ? editarCliente(cliente.id, datos)
          : crearCliente({
              ...datos,
              tipo,
              ...(eligeSucursal ? { sucursalId } : {}),
            }),
      alGuardar,
    );
  }

  return (
    <form onSubmit={alEnviar} className="mb-6 flex flex-col gap-6 rounded-md border p-4">
      <h2 className="text-sm font-semibold">
        {esAlta ? "Nuevo cliente" : `Editar ${cliente.nombre}`}
      </h2>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Datos básicos
        </legend>
        <div className="flex flex-wrap gap-4">
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
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="domicilio" className="text-sm font-medium">
              Domicilio / referencia
            </label>
            <input
              id="domicilio"
              required
              maxLength={200}
              disabled={enviando}
              value={domicilio}
              onChange={(e) => setDomicilio(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="telefono" className="text-sm font-medium">
              Teléfono
            </label>
            <input
              id="telefono"
              required
              maxLength={30}
              disabled={enviando}
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              className="w-48 rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="encargado" className="text-sm font-medium">
              Encargado
            </label>
            <input
              id="encargado"
              maxLength={120}
              disabled={enviando}
              value={encargado}
              onChange={(e) => setEncargado(e.target.value)}
              className="w-48 rounded-md border px-3 py-2 text-sm"
            />
          </div>
          {esAlta && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="tipo" className="text-sm font-medium">
                Tipo
              </label>
              <select
                id="tipo"
                disabled={enviando}
                value={tipo}
                onChange={(e) => setTipo(e.target.value as "cliente" | "prospecto")}
                className="w-40 rounded-md border px-3 py-2 text-sm"
              >
                <option value="cliente">Cliente</option>
                <option value="prospecto">Prospecto</option>
              </select>
            </div>
          )}
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={factura}
              disabled={enviando}
              onChange={(e) => setFactura(e.target.checked)}
            />
            ¿Requiere factura?
          </label>
        </div>
        <SelectorTipoNegocio
          value={tipoNegocioId}
          onChange={setTipoNegocioId}
          disabled={enviando}
        />
        {!esAlta && (
          <p className="text-xs text-muted-foreground">
            Sucursal: {cliente.sucursalCodigo}. La sucursal de un cliente no se
            puede cambiar.
          </p>
        )}
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
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Precio
        </legend>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lista" className="text-sm font-medium">
            Lista de precios
          </label>
          <select
            id="lista"
            required
            disabled={enviando}
            value={listaPrecioId}
            onChange={(e) => setListaPrecioId(e.target.value)}
            className="w-64 rounded-md border px-3 py-2 text-sm"
          >
            <option value="">Elige una lista…</option>
            {listas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nombre}
              </option>
            ))}
          </select>
        </div>
        {productos.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">
              Precio especial (override), opcional por presentación
            </p>
            <div className="flex flex-col gap-2">
              {productos.flatMap((producto) =>
                producto.presentaciones.map((presentacion) => (
                  <div key={presentacion.id} className="flex items-center gap-2 text-sm">
                    <span className="w-56">
                      {producto.nombre} · {presentacion.volumen}
                    </span>
                    <input
                      type="number"
                      min={0.01}
                      step="0.01"
                      placeholder="Usa la lista"
                      aria-label={`Precio especial ${producto.nombre} ${presentacion.volumen}`}
                      disabled={enviando}
                      value={overrides.get(presentacion.id) ?? ""}
                      onChange={(e) => cambiarOverride(presentacion.id, e.target.value)}
                      className="w-32 rounded-md border px-2 py-1"
                    />
                  </div>
                )),
              )}
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Promoción y crédito
        </legend>
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="promocion" className="text-sm font-medium">
              Promoción
            </label>
            <select
              id="promocion"
              disabled={enviando}
              value={promocion}
              onChange={(e) => setPromocion(e.target.value as Promocion)}
              className="w-40 rounded-md border px-3 py-2 text-sm"
            >
              <option value="ninguna">Ninguna</option>
              <option value="10+1">10+1</option>
              <option value="20+1">20+1</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="comision" className="text-sm font-medium">
              % Comisión
            </label>
            <input
              id="comision"
              type="number"
              min={0}
              max={100}
              step="0.01"
              disabled={enviando}
              value={pctComision}
              onChange={(e) => setPctComision(e.target.value)}
              className="w-32 rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="credito" className="text-sm font-medium">
              Plazo de crédito (días)
            </label>
            <input
              id="credito"
              type="number"
              min={0}
              step="1"
              disabled={enviando}
              value={plazoCreditoDias}
              onChange={(e) => setPlazoCreditoDias(e.target.value)}
              className="w-32 rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>
        {promocion !== "ninguna" && (
          <div>
            <p className="mb-2 text-sm font-medium">Productos Jawa con promoción</p>
            <div className="flex flex-wrap gap-3">
              {productos.map((producto) => (
                <label key={producto.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    disabled={enviando}
                    checked={productosPromocion.includes(producto.id)}
                    onChange={() => alternarProducto(producto.id)}
                  />
                  {producto.nombre}
                </label>
              ))}
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Ubicación y notas
        </legend>
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lat" className="text-sm font-medium">
              Latitud
            </label>
            <input
              id="lat"
              type="number"
              step="0.000001"
              min={-90}
              max={90}
              disabled={enviando}
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className="w-40 rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lng" className="text-sm font-medium">
              Longitud
            </label>
            <input
              id="lng"
              type="number"
              step="0.000001"
              min={-180}
              max={180}
              disabled={enviando}
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              className="w-40 rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="comentarios" className="text-sm font-medium">
            Comentarios
          </label>
          <textarea
            id="comentarios"
            maxLength={2000}
            disabled={enviando}
            rows={3}
            value={comentarios}
            onChange={(e) => setComentarios(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
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

Esperado: build en verde. El formulario todavía no está montado en ninguna pantalla (llega en la Task 11).

- [ ] **Step 3: Commit**

```bash
git add apps/portal/src/components/clientes/formulario-cliente.tsx
git commit -m "$(cat <<'EOF'
T-12 · FormularioCliente con todas las secciones

Datos basicos, precio + overrides por presentacion, promocion +
productos, credito y ubicacion. No usa PantallaCatalogo (D3 del spec):
demasiadas secciones para el envoltorio de alta/edicion de una fila
simple, misma razon por la que T-18 tampoco lo uso.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WjmEJNSj7BxSriQx3nb4GG
EOF
)"
```

---

### Task 11: Portal — `PantallaClientes` + `FiltroTipo` + `page.tsx` (D3, D7 del spec)

**Files:**
- Create: `apps/portal/src/components/clientes/filtro-tipo.tsx`
- Create: `apps/portal/src/components/clientes/pantalla-clientes.tsx`
- Modify: `apps/portal/src/app/(portal)/catalogo/clientes/page.tsx` (deja de ser placeholder)

**Interfaces:**
- Consumes: `useCatalogo` de `@/components/catalogo/use-catalogo`; `TablaCatalogo` de `@/components/catalogo/tabla-catalogo`; `useAuth` de `@/components/auth/auth-provider`; `listarClientes`/`obtenerCliente`/`eliminarCliente`/`type ClienteResumen`/`type ClienteDetalle`/`type TipoFiltro` de `@/lib/clientes` (Task 8); `FormularioCliente` (Task 10).
- Produces: `<PantallaClientes sucursal tipo />`, montado por `page.tsx`.

`nav-config.ts` **no cambia** — la entrada "Clientes" → `/catalogo/clientes` ya existe desde T-03.

- [ ] **Step 1: Escribir `FiltroTipo`**

Crea `apps/portal/src/components/clientes/filtro-tipo.tsx`:

```tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { TipoFiltro } from "@/lib/clientes";

/**
 * Mismo patron que SelectorSucursal (T-09): lee/escribe el query param, sin
 * estado propio. A diferencia de aquel, este filtro es local a la pantalla
 * de Clientes (no vive en el sidebar) — el resto de catalogos no tiene
 * columna "tipo".
 */
export function FiltroTipo({ valor }: { valor: TipoFiltro }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function cambiar(nuevo: TipoFiltro) {
    const nuevos = new URLSearchParams(params.toString());
    if (nuevo === "todos") {
      // "todos" es el default: se quita el param en vez de escribirlo,
      // mismo criterio que SelectorSucursal con "todas".
      nuevos.delete("tipo");
    } else {
      nuevos.set("tipo", nuevo);
    }
    const query = nuevos.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <select
      aria-label="Filtrar por tipo"
      value={valor}
      onChange={(e) => cambiar(e.target.value as TipoFiltro)}
      className="rounded-md border px-2 py-1 text-sm"
    >
      <option value="todos">Todos</option>
      <option value="cliente">Clientes</option>
      <option value="prospecto">Prospectos</option>
    </select>
  );
}
```

- [ ] **Step 2: Escribir `PantallaClientes`**

Crea `apps/portal/src/components/clientes/pantalla-clientes.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { useCatalogo } from "@/components/catalogo/use-catalogo";
import { TablaCatalogo } from "@/components/catalogo/tabla-catalogo";
import {
  eliminarCliente,
  listarClientes,
  obtenerCliente,
  type ClienteDetalle,
  type ClienteResumen,
  type TipoFiltro,
} from "@/lib/clientes";
import { FormularioCliente } from "./formulario-cliente";
import { FiltroTipo } from "./filtro-tipo";

type Edicion = "nueva" | ClienteDetalle | null;

/**
 * No usa PantallaCatalogo (D3 del spec): editar necesita el DETALLE completo
 * (overrides + promocion), que no viaja en la fila de la lista -- se pide
 * aparte con `obtenerCliente()` al abrir el formulario. `PantallaCatalogo`
 * asume que el item de la lista y el item del formulario son el mismo tipo.
 */
export function PantallaClientes({
  sucursal,
  tipo,
}: {
  sucursal: string | null;
  tipo: TipoFiltro;
}) {
  const { puede } = useAuth();
  const puedeGestionar = puede("cliente.gestionar");
  const catalogo = useCatalogo<ClienteResumen>(
    () => listarClientes(sucursal, tipo),
    { mensajeError: "No se pudieron cargar los clientes.", deps: [sucursal, tipo] },
  );

  const [edicion, setEdicion] = useState<Edicion>(null);
  const [cargandoDetalleId, setCargandoDetalleId] = useState<string | null>(null);
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);

  async function abrirEdicion(resumen: ClienteResumen) {
    setCargandoDetalleId(resumen.id);
    setErrorDetalle(null);
    try {
      setEdicion(await obtenerCliente(resumen.id));
    } catch {
      setErrorDetalle("No se pudo cargar el detalle de ese cliente.");
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

  async function eliminar(item: ClienteResumen) {
    if (!window.confirm(`¿Dar de baja a "${item.nombre}"? Se conserva su historial.`)) {
      return;
    }
    await eliminarCliente(item.id);
    void catalogo.recargar();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <CardTitle>Clientes</CardTitle>
          <FiltroTipo valor={tipo} />
        </div>
        {puedeGestionar && (
          <Button size="sm" disabled={edicion !== null} onClick={() => setEdicion("nueva")}>
            Nuevo cliente
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {edicion !== null && (
          <div key={edicion === "nueva" ? "nueva" : edicion.id}>
            <FormularioCliente
              cliente={edicion === "nueva" ? null : edicion}
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
            vacio="No hay clientes que mostrar."
            columnas={[
              { encabezado: "Nombre", celda: (c) => c.nombre },
              { encabezado: "Teléfono", celda: (c) => c.telefono },
              {
                encabezado: "Tipo",
                celda: (c) => (c.tipo === "cliente" ? "Cliente" : "Prospecto"),
              },
              { encabezado: "Tipo de negocio", celda: (c) => c.tipoNegocio ?? "—" },
              {
                encabezado: "Sucursal",
                celda: (c) => c.sucursalCodigo,
                className: "font-mono",
              },
            ]}
            acciones={
              puedeGestionar
                ? (c) => (
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={edicion !== null || cargandoDetalleId === c.id}
                        onClick={() => void abrirEdicion(c)}
                      >
                        {cargandoDetalleId === c.id ? "Cargando…" : "Editar"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={edicion !== null}
                        onClick={() => void eliminar(c)}
                      >
                        Eliminar
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

- [ ] **Step 3: Reemplazar el placeholder de la página**

Reemplaza `apps/portal/src/app/(portal)/catalogo/clientes/page.tsx` completo:

```tsx
import { PantallaClientes } from "@/components/clientes/pantalla-clientes";
import type { TipoFiltro } from "@/lib/clientes";

function normalizarTipo(crudo: string | undefined): TipoFiltro {
  return crudo === "cliente" || crudo === "prospecto" ? crudo : "todos";
}

// En Next 15 `searchParams` es una promesa (mismo patron que la pagina de
// Vehiculos, T-11): server component delgado que solo lee los filtros.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string; tipo?: string }>;
}) {
  const { sucursal, tipo } = await searchParams;
  return <PantallaClientes sucursal={sucursal ?? null} tipo={normalizarTipo(tipo)} />;
}
```

- [ ] **Step 4: Verificar manualmente en el navegador**

```bash
colima start
npm run supabase -- start
# Apunta DATABASE_URL de .env.development al Postgres local antes de levantar el backend (CLAUDE.md).
npm run backend
npm run portal
```

Checklist:
1. Entra a `/catalogo/clientes` con un usuario `Administrador General`: la tabla carga vacía, con el filtro de Tipo y el botón "Nuevo cliente".
2. Da de alta un cliente completo (con al menos un producto y un override) → aparece en la tabla.
3. Cambia el filtro a "Prospectos" → la lista se filtra sin recargar la página completa (revisa la URL: debe llevar `?tipo=prospecto`).
4. Edita ese cliente → el formulario precarga todos sus campos, incluido el override y el producto de promoción marcado.
5. Quita el override (vacía el input) y guarda → el override desaparece.

- [ ] **Step 5: Verificar tipos y build**

```bash
npm run build --workspace=apps/portal
```

Esperado: build en verde.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/components/clientes/filtro-tipo.tsx \
        apps/portal/src/components/clientes/pantalla-clientes.tsx \
        "apps/portal/src/app/(portal)/catalogo/clientes/page.tsx"
git commit -m "$(cat <<'EOF'
T-12 · Pantalla de Clientes (filtro de tipo + sucursal)

PantallaClientes propia (D3): edita a partir del detalle completo,
no de la fila de la lista. FiltroTipo replica el patron de
SelectorSucursal (T-09) para el filtro ?tipo= de esta pantalla.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WjmEJNSj7BxSriQx3nb4GG
EOF
)"
```

---

### Task 12: Portal — pruebas de pantalla (patrón T-65)

**Files:**
- Create: `apps/portal/src/components/clientes/pantalla-clientes.test.tsx`

**Interfaces:**
- Consumes: todo lo de las Tasks 8-11. Mockea `@/lib/clientes`, `@/lib/tipos-negocio`, `@/lib/productos`, `@/lib/precios`, `@/lib/sucursales`, `@/components/auth/auth-provider` y `next/navigation` (por `FiltroTipo`) — mismo límite que `pantalla-sucursales.test.tsx` (T-65): se mockea la capa de red, no `apiFetch`.

- [ ] **Step 1: Escribir las pruebas**

Crea `apps/portal/src/components/clientes/pantalla-clientes.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as clientesLib from "@/lib/clientes";
import type { ClienteDetalle, ClienteResumen } from "@/lib/clientes";
import * as tiposNegocioLib from "@/lib/tipos-negocio";
import * as productosLib from "@/lib/productos";
import * as preciosLib from "@/lib/precios";
import * as sucursalesLib from "@/lib/sucursales";
import { PantallaClientes } from "./pantalla-clientes";

// Mismo limite que pantalla-sucursales.test.tsx (T-65): se mockea la capa de
// red (lib/*.ts), no apiFetch. AuthProvider tambien se mockea porque su
// propia carga de sesion es un problema aparte de esta pantalla.
// next/navigation se mockea porque FiltroTipo (D7 del spec) usa
// useRouter/usePathname/useSearchParams, y jsdom no trae App Router.
vi.mock("@/lib/clientes");
vi.mock("@/lib/tipos-negocio");
vi.mock("@/lib/productos");
vi.mock("@/lib/precios");
vi.mock("@/lib/sucursales");
vi.mock("@/components/auth/auth-provider");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/catalogo/clientes",
  useSearchParams: () => new URLSearchParams(),
}));

const listarClientes = vi.mocked(clientesLib.listarClientes);
const obtenerCliente = vi.mocked(clientesLib.obtenerCliente);
const crearCliente = vi.mocked(clientesLib.crearCliente);
const editarCliente = vi.mocked(clientesLib.editarCliente);
const eliminarCliente = vi.mocked(clientesLib.eliminarCliente);
const usarAuthMock = vi.mocked(useAuth);

function mockAuth(puede: (clave: string) => boolean) {
  usarAuthMock.mockReturnValue({
    usuario: null,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede,
  });
}

const RESUMEN: ClienteResumen = {
  id: "1",
  nombre: "Abarrotes Lupita",
  telefono: "664-000-0000",
  tipo: "cliente",
  tipoNegocio: null,
  sucursalCodigo: "TJ",
};

const DETALLE: ClienteDetalle = {
  id: "1",
  nombre: "Abarrotes Lupita",
  domicilio: "Calle Falsa 123",
  telefono: "664-000-0000",
  encargado: null,
  factura: false,
  tipo: "cliente",
  tipoNegocioId: null,
  listaPrecioId: "lista-1",
  pctComision: null,
  promocion: "ninguna",
  plazoCreditoDias: null,
  lat: null,
  lng: null,
  comentarios: null,
  sucursalId: "suc-1",
  sucursalCodigo: "TJ",
  overridesPrecio: [],
  productosPromocion: [],
};

describe("PantallaClientes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tiposNegocioLib.listarTiposNegocio).mockResolvedValue([]);
    vi.mocked(productosLib.listarProductos).mockResolvedValue([]);
    vi.mocked(preciosLib.listarListasPrecio).mockResolvedValue([
      { id: "lista-1", nombre: "Lista 1" },
    ]);
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue([]);
  });

  it("muestra los clientes cargados y permite dar de alta cuando el usuario puede gestionar", async () => {
    mockAuth(() => true);
    listarClientes.mockResolvedValue([RESUMEN]);

    render(<PantallaClientes sucursal={null} tipo="todos" />);

    expect(await screen.findByText("Abarrotes Lupita")).toBeInTheDocument();
    expect(screen.getByText("664-000-0000")).toBeInTheDocument();
    expect(screen.getByText("Cliente")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo cliente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
  });

  it("oculta el alta, la edicion y la baja cuando el usuario no puede gestionar", async () => {
    mockAuth(() => false);
    listarClientes.mockResolvedValue([RESUMEN]);

    render(<PantallaClientes sucursal={null} tipo="todos" />);
    await screen.findByText("Abarrotes Lupita");

    expect(screen.queryByRole("button", { name: "Nuevo cliente" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
  });

  it("muestra el mensaje de error cuando la carga falla", async () => {
    mockAuth(() => true);
    listarClientes.mockRejectedValue(new Error("red caida"));

    render(<PantallaClientes sucursal={null} tipo="todos" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron cargar los clientes.",
    );
  });

  it("da de alta un cliente nuevo y recarga la lista", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarClientes.mockResolvedValueOnce([]);
    crearCliente.mockResolvedValue(DETALLE);
    listarClientes.mockResolvedValueOnce([RESUMEN]);

    render(<PantallaClientes sucursal={null} tipo="todos" />);
    await screen.findByText("No hay clientes que mostrar.");

    await usuario.click(screen.getByRole("button", { name: "Nuevo cliente" }));
    await usuario.type(screen.getByLabelText("Nombre"), "Abarrotes Lupita");
    await usuario.type(screen.getByLabelText("Domicilio / referencia"), "Calle Falsa 123");
    await usuario.type(screen.getByLabelText("Teléfono"), "664-000-0000");
    await usuario.selectOptions(screen.getByLabelText("Lista de precios"), "lista-1");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(crearCliente).toHaveBeenCalled());
    const payload = crearCliente.mock.calls[0][0];
    expect(payload.nombre).toBe("Abarrotes Lupita");
    expect(payload.listaPrecioId).toBe("lista-1");
    expect(payload.overridesPrecio).toEqual([]);
    expect(payload.productosPromocion).toEqual([]);

    expect(await screen.findByText("Abarrotes Lupita")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Nuevo cliente" })).not.toBeInTheDocument();
  });

  it("edita un cliente existente precargando su detalle completo", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarClientes.mockResolvedValueOnce([RESUMEN]);
    obtenerCliente.mockResolvedValue(DETALLE);
    editarCliente.mockResolvedValue({ ...DETALLE, nombre: "Abarrotes Lupita 2" });
    listarClientes.mockResolvedValueOnce([
      { ...RESUMEN, nombre: "Abarrotes Lupita 2" },
    ]);

    render(<PantallaClientes sucursal={null} tipo="todos" />);
    await screen.findByText("Abarrotes Lupita");

    await usuario.click(screen.getByRole("button", { name: "Editar" }));
    await waitFor(() => expect(obtenerCliente).toHaveBeenCalledWith("1"));

    const campoNombre = (await screen.findByLabelText("Nombre")) as HTMLInputElement;
    expect(campoNombre.value).toBe("Abarrotes Lupita");

    await usuario.clear(campoNombre);
    await usuario.type(campoNombre, "Abarrotes Lupita 2");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(editarCliente).toHaveBeenCalledWith("1", expect.anything()));
    expect(await screen.findByText("Abarrotes Lupita 2")).toBeInTheDocument();
  });

  it("da de baja un cliente tras confirmar, y recarga la lista", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    listarClientes.mockResolvedValueOnce([RESUMEN]);
    eliminarCliente.mockResolvedValue(undefined);
    listarClientes.mockResolvedValueOnce([]);

    render(<PantallaClientes sucursal={null} tipo="todos" />);
    await screen.findByText("Abarrotes Lupita");

    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(eliminarCliente).toHaveBeenCalledWith("1"));
    expect(await screen.findByText("No hay clientes que mostrar.")).toBeInTheDocument();
  });

  it("no llama a eliminarCliente si el usuario cancela la confirmacion", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    listarClientes.mockResolvedValue([RESUMEN]);

    render(<PantallaClientes sucursal={null} tipo="todos" />);
    await screen.findByText("Abarrotes Lupita");

    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(eliminarCliente).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr las pruebas**

```bash
npm test --workspace=apps/portal -- pantalla-clientes
```

Esperado: **puede que no pasen a la primera** — esto es lo normal en TDD contra componentes ya escritos: ajusta selectores (`getByLabelText`, `getByRole`) si algún `label`/`aria-label` de `FormularioCliente` (Task 10) no coincide exactamente con lo que la prueba espera, en vez de cambiar el componente para que le convenga a la prueba. Itera hasta que las 8 pruebas pasen.

- [ ] **Step 3: Correr toda la suite del portal**

```bash
npm run lint --workspace=apps/portal
npm run build --workspace=apps/portal
npm test --workspace=apps/portal
```

Esperado: lint y build sin errores; la suite en verde, con 8 pruebas más que tu línea base de la Task 0.

- [ ] **Step 4: Commit**

```bash
git add apps/portal/src/components/clientes/pantalla-clientes.test.tsx
git commit -m "$(cat <<'EOF'
T-12 · Pruebas de pantalla de Clientes (patron T-65)

Testing Library de integracion, copiando pantalla-sucursales.test.tsx:
carga con/sin permiso, error de red, alta, edicion (precargando el
detalle completo via obtenerCliente), baja con y sin confirmacion.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WjmEJNSj7BxSriQx3nb4GG
EOF
)"
```

---

### Task 13: Cierre — vault y PR

**Files:**
- Modify (en `../jawa-obsidian-memory`): `10-Dominio/Entidades/Cliente.md`, `00-Inicio/Estado del proyecto.md`

**Interfaces:** ninguna — tarea de documentación y entrega.

- [ ] **Step 1: Aplicar la migración a `sinmex dev` (verificado, no supuesto)**

Sigue el mismo protocolo que T-10/T-11/T-18: confirmar el estado remoto con `supabase migration list` antes de asumir nada.

```bash
npm run supabase -- migration list
```

Si `20260831120000_cliente_precio_unicidad_vigencia` no aparece en la columna `remote`:

```bash
npm run supabase -- db push
npm run supabase -- migration list
```

Esperado: la migración aparece en `local` y `remote` por igual.

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

- [ ] **Step 3: Actualizar `10-Dominio/Entidades/Cliente.md` en el vault**

Abre `../jawa-obsidian-memory/10-Dominio/Entidades/Cliente.md` y, en la sección "Notas de implementación", agrega (sin borrar lo existente, que sigue siendo cierto):

```markdown
> [!success] Implementado en T-12 (2026-08-31)
> - **Tipo de Negocio se resuelve con alta inline** desde el propio formulario
>   de Cliente (combobox "+ Nuevo tipo de negocio…"), no con una pantalla de
>   catálogo aparte — la tabla `tipo_negocio` seguía vacía, sin lista del
>   cliente.
> - **Un solo permiso, `cliente.gestionar`**, gatea alta/edición/baja de
>   cualquier fila del portal, sea Cliente o Prospecto. `prospecto.gestionar`
>   (sembrado desde T-05) sigue sin consumidor: es para cuando el Vendedor dé
>   de alta prospectos desde la tablet.
> - **Override de precio y promoción se guardan en la misma transacción** que
>   los datos base, con la misma historización no retroactiva que las listas
>   de precio (T-18): cada cambio abre o corrige la fila de "hoy" (fecha
>   local del navegador), nunca una futura.
```

Actualiza también `actualizado:` en el frontmatter a `2026-08-31`.

- [ ] **Step 4: Actualizar `00-Inicio/Estado del proyecto.md`**

En la tabla de issues, cambia la fila de T-12 a:

```markdown
| T-12/62 | Catálogos del portal que faltan (clientes, vendedores) | T-12 ✅ Hecho (2026-08-31) — PR abierto, ver detalle abajo. T-62 sigue pendiente |
```

Y agrega un bloque de detalle "T-12 — detalle de lo hecho" siguiendo el formato de los bloques de T-10/T-11/T-18 ya existentes en esa nota: qué se construyó, la decisión de D9 (extracción de `buscarSucursalUsuario`/`errores-postgres`), el hallazgo del `unique` de `cliente_promocion_producto` sin excluir `deleted_at`, y los conteos reales de pruebas que anotaste en cada tarea de este plan (no los que aparecen en este documento — este plan no los hardcodeó a propósito).

Actualiza `actualizado:` a `2026-08-31` y revisa si la fila "Próximos pasos sugeridos" debe mencionar que T-62 (Vendedores) sigue pendiente de la decisión de desambiguación de iniciales (ver `ADR-0007`), sin relación con este ticket.

- [ ] **Step 5: Commit del vault**

```bash
cd ../jawa-obsidian-memory
git add "10-Dominio/Entidades/Cliente.md" "00-Inicio/Estado del proyecto.md"
git commit -m "T-12: Cartera de Clientes implementada — actualiza Cliente.md y Estado del proyecto"
git push
cd -
```

- [ ] **Step 6: Push y Pull Request del código**

```bash
git push -u origin feature/t-12-cartera-clientes
gh pr create --title "T-12 · Cartera de Clientes (alta/modificación/baja, %comisión, tipos, filtro)" --body "$(cat <<'EOF'
## Resumen
- Catálogo de Clientes/Prospectos completo: datos básicos, lista de precios + override especial por presentación, promoción (10+1/20+1) sobre productos seleccionados, plazo de crédito, %comisión y ubicación.
- Catálogo mínimo de Tipos de Negocio (GET/POST), con alta inline desde el formulario de Cliente.
- Dos helpers compartidos extraídos antes de su cuarta copia: `buscarSucursalUsuario` y los detectores de error de Postgres (`esViolacionUnicidad`/`esViolacionFk`).

## Decisiones (ver el spec para el detalle)
- D1: Tipo de Negocio se crea inline, sin pantalla de catálogo aparte.
- D2: un solo permiso (`cliente.gestionar`) gatea toda la pantalla.
- D3: pantalla propia, no `PantallaCatalogo` — edita a partir del detalle completo.
- D4/D5: alta y edición reconcilian datos base + promoción + overrides en una transacción, con historización no retroactiva igual que T-18.
- D6: sucursal inmutable tras el alta.

## Hallazgo técnico
El `unique (cliente_id, producto_id)` de `cliente_promocion_producto` (T-05) no excluye `deleted_at`: quitar y volver a agregar el mismo producto de una promoción exige revivir la fila con `ON CONFLICT ... DO UPDATE`, no un `INSERT` liso.

## Test plan
- [ ] `npm run supabase -- test db`
- [ ] `npm test --workspace=apps/backend`
- [ ] `npm run test:e2e --workspace=apps/backend`
- [ ] `npm test --workspace=apps/portal`
- [ ] Verificación manual en el navegador (checklist de la Task 11), contra Postgres local

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01WjmEJNSj7BxSriQx3nb4GG
EOF
)"
```

- [ ] **Step 7: Marcar los checkboxes del issue #12**

```bash
gh issue view 12 --repo robertopeiro12/proyecto-sinmex --json body -q .body > /tmp/issue-12-body.md
```

Edita `/tmp/issue-12-body.md` marcando `[x]` cada criterio de aceptación ya cumplido, y:

```bash
gh issue edit 12 --repo robertopeiro12/proyecto-sinmex --body-file /tmp/issue-12-body.md
```

---

## Qué trae

- `GET/POST /tipos-negocio`, `GET/POST/PATCH/DELETE /clientes` en `modules/cartera-clientes/`.
- Migración `uq_cliente_precio_vigencia`.
- Dos helpers compartidos: `buscar-sucursal-usuario.ts`, `errores-postgres.ts`.
- Función pura `reconciliar-promocion-productos.ts`.
- Pantalla `/catalogo/clientes` completa: filtro de sucursal + tipo, formulario por secciones, combobox de Tipo de Negocio con alta inline.
- Pruebas de pantalla (Testing Library), continuando el patrón de T-65.

## Decisiones que conviene mirar en la revisión

- **D9 (nueva, no estaba en el spec):** extracción de `buscarSucursalUsuario` y `esViolacionUnicidad`/`esViolacionFk` a helpers compartidos, justo en su "cuarta copia" — el propio código de T-11/T-18 ya anotaba ese umbral. Vale la pena que el otro dev confirme que el refactor de Vehículos/Precios (Task 2) no cambió comportamiento.
- El `ON CONFLICT ... DO UPDATE SET deleted_at = null` de `cliente_promocion_producto` (Task 7) — el `unique` de esa tabla no excluye `deleted_at`, a diferencia de `uq_vehiculo_nombre_sucursal`.
- `FormularioCliente` no usa `PantallaCatalogo`: es la pantalla más grande del portal hasta ahora, vale la pena una segunda mirada a la organización en `fieldset`.

## Fuera de alcance, a propósito

| Qué | Por qué |
|---|---|
| Notificación de nota vencida por crédito | T-54. |
| Mapa interactivo para coordenadas | Inputs numéricos lat/lng, sin dependencia nueva. |
| Búsqueda/paginación en servidor | Mismo patrón que Productos/Vehículos: cargar todo y filtrar en cliente. |
| Pantalla propia de Tipos de Negocio | Alta inline (D1) cubre el criterio sin construir un catálogo especulativo. |
| Cálculo del precio de una línea de venta con el override aplicado | T-16, sin ticket de implementación todavía. |
| Migrar `esDuplicado()` de Perfiles/Productos/Vehículos al nuevo `errores-postgres.ts` | Fuera de alcance de este ticket (D9 solo evita sumar una cuarta/quinta copia, no reescribe las tres que ya existían). |

## Verificación

Checklist manual completo en la Task 11, Step 4. Recuerda: **nunca contra `sinmex dev`** durante el desarrollo — apunta `DATABASE_URL` de `.env.development` al Postgres local mientras verificas.

## Self-Review

- **Cobertura del spec:** D1 → Task 9; D2 → Tasks 5-7 (`@RequierePermiso` solo en escritura); D3 → Task 11; D4 → Tasks 3, 6, 7; D5 → Tasks 1, 6, 7; D6 → Tasks 6, 7 (sucursal fija, DTO de edición sin el campo); D7 → Tasks 5, 11; D8 (`aNumero()` para `pct_comision`) → Task 5. Los ocho endpoints de la tabla del spec están en Tasks 4-7. Las cinco filas de la tabla "Archivos" del spec están cubiertas (backend: Tasks 4-7; portal: Tasks 8-11).
- **Placeholders:** ninguno — cada paso de código trae el archivo completo o el fragmento exacto a insertar, sin "TODO" ni "similar a la Task N" sin el código repetido.
- **Consistencia de tipos:** `ClienteResumen`/`ClienteDetalle`/`OverridePrecio`/`TipoFiltro`/`DatosClienteBase` se definen una sola vez en `clientes.repository.ts` (Task 5) y se re-exportan/importan tal cual en servicio, controller y DTOs de las Tasks 6-7; `lib/clientes.ts` (Task 8) los copia manualmente (mismo trato que el resto de `lib/*.ts`, sin tipo compartido — ver CLAUDE.md). `PlanPromocionProductos` se define en la Task 3 y se usa sin cambios en Tasks 6-7 y en `ClientesRepository.actualizar`.
- **Hallazgo agregado durante la planeación (no estaba en el spec):** el `unique` de `cliente_promocion_producto` sin excluir `deleted_at` (Task 7) y la extracción D9 (Task 2). Ambos quedaron documentados en el PR y en el vault (Task 13) para que la revisión cruzada los vea explícitamente.

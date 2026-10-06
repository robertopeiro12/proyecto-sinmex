# T-68 · Placas obligatorias en el alta de Vehículo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir el campo **Placas** al alta y edición de [[Vehículo]] en el Portal Web: obligatorio al dar de alta, único globalmente, y visible en el catálogo.

**Architecture:** Mismo criterio que `vehiculo.km_inicial` (T-11): la columna `placas` se agrega **nullable** en Postgres (no se rompe ningún vehículo existente sin el dato), y la obligatoriedad la exige el DTO de alta del Portal, no la base. La unicidad **sí** vive en la base (doctrina "la base decide" ya usada por `uq_vehiculo_nombre_sucursal`), pero es **global** (no por sucursal): una placa física no puede pertenecer a dos vehículos aunque estén en sucursales distintas.

**Tech Stack:** NestJS + Kysely + Postgres (backend), Next.js + Tailwind (portal), pgTAP + Jest/Supertest (pruebas).

**Spec:** GitHub issue [T-68 (#98)](https://github.com/robertopeiro12/proyecto-sinmex/issues/98). Confirmado verbalmente por el cliente en junta con Roberto el 2026-09-29 — sin formato de placa confirmado, por lo que se captura como texto libre, sin inventar una validación de patrón.

## Global Constraints

- La columna `vehiculo.placas` es `text`, **nullable** en Postgres — nunca se agrega `not null`.
- El unique de placas es **global** (no `(sucursal_id, placas)` como el de nombre).
- `placas` es **obligatoria** en `CrearVehiculoDto` y **opcional** en `EditarVehiculoDto` (mismo patrón PATCH-parcial que ya usan `nombre`, `kmInicial` y `activo` en ese DTO).
- No se toca `apps/tablet/` ni `apps/backend/src/modules/sincronizacion/`: el vehículo se administra solo desde el Portal (T-11) y la app solo lo selecciona por nombre al abrir el día. No se pidió mostrar la placa en la app.
- Tope de longitud: 20 caracteres (generoso; no hay formato de placa mexicana confirmado por el cliente que justifique uno más estricto).
- Comparación de unicidad insensible a mayúsculas y espacios (`lower(btrim(placas))`), mismo criterio que `uq_vehiculo_nombre_sucursal` y `uq_producto_nombre`.

## Review Focus

- Un vehículo **ya existente** sin placas (sembrado antes de este ticket) no debe bloquear ni al listarlo ni al editar otro campo suyo (PATCH parcial, `placas` sigue opcional ahí).
- Dos vehículos con la misma placa **en sucursales distintas** deben chocar igual (409) — es la diferencia deliberada frente al unique de `nombre`, que sí es por sucursal, y el caso más fácil de copiar mal por analogía.
- Un `PATCH` que solo cambia `activo` o `kmInicial` (sin tocar `placas`) debe seguir funcionando exactamente igual que hoy.
- El mensaje de error de un `23505` en el alta debe distinguir "nombre repetido" de "placas repetidas" — sin eso, un administrador ve "ya existe un vehículo llamado X" cuando el problema real es la placa, y edita el campo equivocado.
- La migración debe ser segura de aplicar sobre datos ya existentes en `sinmex dev` (vehículos de T-11 sin placas) — columna nullable, no un `alter ... not null` a ciegas.

---

## Task 1: Migración de base de datos + pgTAP

**Files:**
- Create: `supabase/migrations/20260929120000_vehiculo_placas.sql`
- Create: `supabase/tests/99_vehiculo_placas_test.sql`

**Interfaces:**
- Produces: columna `vehiculo.placas` (`text`, nullable) e índice único `uq_vehiculo_placas` sobre `lower(btrim(placas)) where deleted_at is null`. Las tareas siguientes leen y escriben esta columna.

- [ ] **Step 1: Escribir la migración**

```sql
-- supabase/migrations/20260929120000_vehiculo_placas.sql

-- T-68: el alta de Vehiculo (T-11) nunca pidio placas -- el documento de julio
-- 2026 no las mencionaba, y el cliente senalo la omision en junta el
-- 2026-09-29. Sin formato de placa confirmado por el cliente: texto libre, sin
-- inventar una validacion de patron.
--
-- Nullable en la base, igual que `km_inicial` (T-11): ya hay vehiculos dados
-- de alta sin este dato y no se les va a inventar uno. La obligatoriedad la
-- exige el DTO del alta del Portal (CrearVehiculoDto), no esta columna --
-- mismo comentario que ya lleva `km_inicial` en crear-vehiculo.dto.ts.
alter table vehiculo add column placas text;

-- El unique SI vive en la base (misma doctrina que uq_vehiculo_nombre_sucursal
-- de T-11): una placa fisica no puede pertenecer a dos vehiculos, y eso tiene
-- que sostenerse aunque alguien entre por debajo de la API (semillas, scripts).
--
-- GLOBAL y no por sucursal, a diferencia del nombre ("Nissan 2019" SI puede
-- repetirse entre TJ y MX): la placa identifica la unidad fisica sin importar
-- en que sucursal este dada de alta.
--
-- `lower(btrim(...))`: mismo criterio que uq_vehiculo_nombre_sucursal y
-- uq_producto_nombre. Los NULL no chocan entre si (semantica estandar de
-- Postgres), asi que dos vehiculos viejos sin placas conviven sin problema y
-- no hace falta un `where placas is not null` explicito.
create unique index uq_vehiculo_placas
  on vehiculo (lower(btrim(placas)))
  where deleted_at is null;
```

- [ ] **Step 2: Aplicar la migración al Postgres local**

Run: `npm run supabase start` (si el stack no está arriba), luego:
`npm run supabase -- migration up --local` (con el `--`, o se come el flag en silencio — ver `CLAUDE.md`).

Expected: la migración `20260929120000_vehiculo_placas` aparece aplicada. Verificar con `npm run supabase -- migration list --local`.

- [ ] **Step 3: Escribir el pgTAP**

```sql
-- supabase/tests/99_vehiculo_placas_test.sql
begin;
select plan(5);

-- Las sucursales TJ y MX vienen de las semillas de T-05.
create temporary table ref as
  select
    (select id from sucursal where codigo = 'TJ') as tj,
    (select id from sucursal where codigo = 'MX') as mx;

insert into vehiculo (nombre, sucursal_id, km_inicial, placas)
  select 'Nissan de placas', tj, 1000, 'ABC-123' from ref;

select throws_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial, placas)
    select 'Otro nombre', tj, 2000, 'ABC-123' from ref$$,
  '23505',
  null,
  'rechaza la misma placa repetida'
);

-- GLOBAL y no por sucursal: a diferencia de uq_vehiculo_nombre_sucursal, ni
-- siquiera cambiando de sucursal se libera la placa.
select throws_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial, placas)
    select 'Otro nombre MX', mx, 2000, 'ABC-123' from ref$$,
  '23505',
  null,
  'la placa es unica GLOBAL, no por sucursal'
);

-- lower()/btrim() en el indice: mismo criterio que uq_vehiculo_nombre_sucursal.
select throws_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial, placas)
    select 'Mayusculas', tj, 2000, ' abc-123 ' from ref$$,
  '23505',
  null,
  'trata distinta capitalizacion y espacios como la misma placa'
);

-- Los NULL no chocan entre si: dos vehiculos "viejos" sin placa (como los que
-- ya existen de T-11) pueden coexistir sin romper nada.
select lives_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial)
    select 'Sin placas 1', tj, 500 from ref$$,
  'un vehiculo sin placas no choca con nada'
);

select lives_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial)
    select 'Sin placas 2', mx, 500 from ref$$,
  'un segundo vehiculo sin placas tampoco choca (NULL no es igual a NULL)'
);

select * from finish();
rollback;
```

- [ ] **Step 4: Correr el pgTAP**

Run: `npm run supabase -- test db` (requiere el stack local arriba).
Expected: `99_vehiculo_placas_test.sql` en verde, 5/5.

- [ ] **Step 5: Regenerar los tipos del backend**

Run: `npm run db:types --workspace=apps/backend`

Expected: `apps/backend/src/database/schema.d.ts` cambia — la interfaz `Vehiculo` gana `placas: string | null;` (orden alfabético, entre `nombre` y `sucursal_id`). No editar este archivo a mano; es generado. Revisar con `git diff apps/backend/src/database/schema.d.ts` que sea el único cambio.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260929120000_vehiculo_placas.sql supabase/tests/99_vehiculo_placas_test.sql apps/backend/src/database/schema.d.ts
git commit -m "T-68: columna vehiculo.placas (nullable) + unique global"
```

---

## Task 2: Backend — DTOs, repositorio y servicio

**Files:**
- Modify: `apps/backend/src/modules/rutas/dto/crear-vehiculo.dto.ts`
- Modify: `apps/backend/src/modules/rutas/dto/editar-vehiculo.dto.ts`
- Modify: `apps/backend/src/modules/rutas/vehiculos.repository.ts`
- Modify: `apps/backend/src/modules/rutas/vehiculos.service.ts`

**Interfaces:**
- Consumes: columna `vehiculo.placas` (Task 1).
- Produces: `Vehiculo.placas: string | null` (repositorio), `CrearVehiculoDto.placas: string` (obligatorio), `EditarVehiculoDto.placas?: string` (opcional). El portal (Task 3) consume estas formas.

- [ ] **Step 1: `CrearVehiculoDto` — placas obligatorias**

Modify `apps/backend/src/modules/rutas/dto/crear-vehiculo.dto.ts`, agregar después de `nombre`:

```ts
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'Las placas son obligatorias.' })
  // Sin formato confirmado por el cliente (junta 2026-09-29): texto libre, sin
  // inventar una validacion de patron de placa mexicana.
  @MaxLength(20, { message: 'Las placas no pueden pasar de 20 caracteres.' })
  placas!: string;
```

- [ ] **Step 2: `EditarVehiculoDto` — placas opcionales (PATCH parcial)**

Modify `apps/backend/src/modules/rutas/dto/editar-vehiculo.dto.ts`, agregar después de `nombre?`:

```ts
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'Las placas son obligatorias.' })
  @MaxLength(20, { message: 'Las placas no pueden pasar de 20 caracteres.' })
  placas?: string;
```

- [ ] **Step 3: `VehiculosRepository` — leer y escribir `placas`**

Modify `apps/backend/src/modules/rutas/vehiculos.repository.ts`:

En la interfaz `Vehiculo`, después de `nombre: string;`:

```ts
  placas: string | null;
```

En `aVehiculo()`, el parámetro `fila` gana `placas: string | null;` y el `return` gana `placas: fila.placas,` (después de `nombre`).

En `listar()`, `listarPorCodigoSucursal()` y `buscarPorId()`, agregar `'vehiculo.placas'` al arreglo de `.select([...])` (después de `'vehiculo.nombre'`).

`crear()` cambia de firma — antes:

```ts
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
```

después:

```ts
  async crear(
    nombre: string,
    placas: string,
    kmInicial: number,
    sucursalId: string,
  ): Promise<Vehiculo> {
    const fila = await this.db
      .insertInto('vehiculo')
      .values({ nombre, placas, km_inicial: kmInicial, sucursal_id: sucursalId })
      .returning(['id', 'nombre', 'placas', 'km_inicial', 'sucursal_id', 'activo'])
      .executeTakeFirstOrThrow();
```

`actualizar()` cambia el tipo de `cambios` — antes:

```ts
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
```

después:

```ts
  async actualizar(
    id: string,
    cambios: {
      nombre?: string;
      placas?: string;
      km_inicial?: number;
      activo?: boolean;
    },
  ): Promise<Vehiculo> {
    const fila = await this.db
      .updateTable('vehiculo')
      .set(cambios)
      .where('id', '=', id)
      .returning(['id', 'nombre', 'placas', 'km_inicial', 'sucursal_id', 'activo'])
      .executeTakeFirstOrThrow();
```

- [ ] **Step 4: `VehiculosService` — distinguir el 23505 de nombre del de placas**

Modify `apps/backend/src/modules/rutas/vehiculos.service.ts`. Agregar, junto a `esDuplicado()`, el mismo helper que ya usa `productos.service.ts` (T-10) para este caso — no se migra a `errores-postgres.ts` compartido: los otros tres servicios que ya duplicaban `esDuplicado()` (perfiles, productos, vehiculos) se dejaron así a propósito en T-12 (ver el comentario de ese archivo), y tocar solo `vehiculos.service.ts` aquí mantiene el diff acotado al ticket.

```ts
/**
 * El driver `pg` expone en `error.constraint` el nombre del indice que violo
 * el unique. Antes de T-68 `vehiculo` tenia un solo unique
 * (`uq_vehiculo_nombre_sucursal`); ahora tambien puede chocar
 * `uq_vehiculo_placas`, y sin distinguirlos el administrador veria "ya existe
 * un vehiculo llamado X" cuando el problema real son las placas repetidas.
 * Mismo patron que `nombreDelIndice` en `productos.service.ts` (T-10).
 */
function nombreDelIndice(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) {
    return undefined;
  }
  const valor = (error as { constraint?: unknown }).constraint;
  return typeof valor === 'string' ? valor : undefined;
}
```

En `crear()`, el `try/catch` pasa de:

```ts
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
```

a:

```ts
    try {
      return await this.repo.crear(dto.nombre, dto.placas, dto.kmInicial, sucursalId);
    } catch (error) {
      if (esDuplicado(error)) {
        if (nombreDelIndice(error) === 'uq_vehiculo_placas') {
          throw new ConflictException(
            `Ya existe un vehículo con las placas "${dto.placas}".`,
          );
        }
        throw new ConflictException(
          `Ya existe un vehículo llamado "${dto.nombre}" en esa sucursal.`,
        );
      }
      throw error;
    }
```

En `editar()`, agregar tras el bloque de `kmInicial`:

```ts
    if (dto.placas !== undefined) {
      cambios.placas = dto.placas;
    }
```

y actualizar la comprobación de "no hay nada que actualizar" (al inicio del método) para incluir `placas`:

```ts
    if (
      dto.nombre === undefined &&
      dto.placas === undefined &&
      dto.kmInicial === undefined &&
      dto.activo === undefined
    ) {
      throw new BadRequestException('No hay nada que actualizar.');
    }
```

y el `catch` de `editar()` pasa de:

```ts
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
```

a:

```ts
    try {
      return await this.repo.actualizar(id, cambios);
    } catch (error) {
      if (esDuplicado(error)) {
        if (nombreDelIndice(error) === 'uq_vehiculo_placas') {
          throw new ConflictException(
            `Ya existe un vehículo con las placas "${dto.placas ?? vehiculo.placas}".`,
          );
        }
        throw new ConflictException(
          `Ya existe un vehículo llamado "${dto.nombre ?? vehiculo.nombre}" en esa sucursal.`,
        );
      }
      throw error;
    }
```

- [ ] **Step 5: Compilar y correr lint**

Run: `npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend`
Expected: sin errores. Si `crear()` o `actualizar()` tienen otros llamadores en el repo (no los hay fuera de `VehiculosService`), el compilador los señalaría aquí.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/rutas/
git commit -m "T-68: placas obligatorias en el alta de Vehiculo (backend)"
```

---

## Task 3: Backend — pruebas e2e

**Files:**
- Modify: `apps/backend/test/vehiculos.e2e-spec.ts`

**Interfaces:**
- Consumes: `POST /vehiculos`, `PATCH /vehiculos/:id` con el campo `placas` (Task 2).

- [ ] **Step 1: Ampliar la interfaz de respuesta**

En `apps/backend/test/vehiculos.e2e-spec.ts`, la interfaz `VehiculoRespuesta` (líneas 13-20) gana un campo, después de `nombre`:

```ts
interface VehiculoRespuesta {
  id: string;
  nombre: string;
  placas: string | null;
  kmInicial: number | null;
  sucursalId: string;
  sucursalCodigo: string;
  activo: boolean;
}
```

- [ ] **Step 2: `sembrarVehiculo` acepta placas opcionales**

El helper (líneas 88-98) pasa de:

```ts
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
```

a:

```ts
  /** Un vehiculo con `placas: undefined` se siembra SIN placa — asi se prueban
   * los vehiculos "viejos" que ya existian antes de T-68. */
  const sembrarVehiculo = async (
    nombre: string,
    sucursalId: string,
    placas?: string,
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vehiculo')
      .values({
        nombre,
        sucursal_id: sucursalId,
        km_inicial: 1000,
        ...(placas !== undefined ? { placas } : {}),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };
```

- [ ] **Step 3: Añadir `placas` a cada `POST /vehiculos` existente que hoy espera 201**

Todos los `.send({...})` de la sección `describe('POST /vehiculos', ...)` que hoy esperan `201` necesitan un `placas` **único** (el índice es global: si dos tests reutilizan la misma placa, uno de los dos fallaría con 409 sin que sea lo que ese test verifica). Los que ya esperan `400`/`409`/`403` por otra razón (sucursal, nombre repetido, kilometraje inválido, permiso) también necesitan `placas` para no fallar por el campo nuevo que ahora sí se valida, salvo que el propio test sea justamente sobre placas faltantes.

Reemplazar el bloque completo `describe('POST /vehiculos', ...)` (lo que hoy son las líneas 226-378) por:

```ts
  describe('POST /vehiculos', () => {
    it('un usuario atado crea en SU sucursal sin mandarla', async () => {
      const res = await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Nissan TJ`,
          placas: `${PREFIJO}-001`,
          kmInicial: 145230.5,
        })
        .expect(201);

      const vehiculo = res.body as VehiculoRespuesta;
      expect(vehiculo.sucursalCodigo).toBe('TJ');
      expect(vehiculo.placas).toBe(`${PREFIJO}-001`);
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
          placas: `${PREFIJO}-002`,
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
          placas: `${PREFIJO}-003`,
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
        .send({
          nombre: `${PREFIJO} Sin sucursal`,
          placas: `${PREFIJO}-004`,
          kmInicial: 300,
        })
        .expect(400);
    });

    it('rechaza un nombre repetido en la misma sucursal con 409', async () => {
      const cuerpo = {
        nombre: `${PREFIJO} Repetido`,
        placas: `${PREFIJO}-005`,
        kmInicial: 400,
      };
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send(cuerpo)
        .expect(201);

      // Mismo nombre, placa DISTINTA: lo que se prueba aqui es el unique de
      // nombre, no el de placas (Task 1 ya lo cubre por separado).
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({ ...cuerpo, placas: `${PREFIJO}-005b` })
        .expect(409);
    });

    it('rechaza un nombre repetido que solo cambia en mayusculas', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Mayusculas`,
          placas: `${PREFIJO}-006`,
          kmInicial: 500,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} MAYUSCULAS`,
          placas: `${PREFIJO}-006b`,
          kmInicial: 500,
        })
        .expect(409);
    });

    // D4: el indice no filtra por `activo`, asi que desactivar no libera el
    // nombre. Lo que se quiere en ese caso es reactivar, no duplicar.
    it('un vehiculo desactivado sigue reservando su nombre', async () => {
      const id = await sembrarVehiculo(
        `${PREFIJO} Dormido`,
        idTijuana,
        `${PREFIJO}-007`,
      );
      await db
        .updateTable('vehiculo')
        .set({ activo: false })
        .where('id', '=', id)
        .execute();

      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Dormido`,
          placas: `${PREFIJO}-007b`,
          kmInicial: 600,
        })
        .expect(409);
    });

    it('acepta el mismo nombre en dos sucursales distintas', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} Compartido`,
          placas: `${PREFIJO}-008a`,
          kmInicial: 700,
          sucursalId: idTijuana,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} Compartido`,
          placas: `${PREFIJO}-008b`,
          kmInicial: 700,
          sucursalId: idMexicali,
        })
        .expect(201);
    });

    it('rechaza crear sin el permiso vehiculo.gestionar', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieSinPermiso)
        .send({
          nombre: `${PREFIJO} Prohibido`,
          placas: `${PREFIJO}-009`,
          kmInicial: 800,
        })
        .expect(403);
    });

    it('rechaza un kilometraje negativo con 400', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Negativo`,
          placas: `${PREFIJO}-010`,
          kmInicial: -1,
        })
        .expect(400);
    });

    it('rechaza un kilometraje que excede numeric(10,2) con 400', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Excedido`,
          placas: `${PREFIJO}-011`,
          kmInicial: 100000000,
        })
        .expect(400);
    });

    it('rechaza un nombre vacio con 400', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({ nombre: '   ', placas: `${PREFIJO}-012`, kmInicial: 900 })
        .expect(400);
    });

    it('rechaza un alta sin placas con 400', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Sin placas`, kmInicial: 950 })
        .expect(400);
    });

    it('rechaza placas vacias con 400', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Placas vacias`, placas: '   ', kmInicial: 960 })
        .expect(400);
    });

    it('rechaza placas repetidas, incluso en otra sucursal, con 409', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Placa TJ`,
          placas: `${PREFIJO}-DUP`,
          kmInicial: 100,
        })
        .expect(201);

      // Nombre DISTINTO y sucursal DISTINTA: lo unico que choca es la placa.
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} Placa MX`,
          placas: `${PREFIJO}-DUP`,
          kmInicial: 200,
          sucursalId: idMexicali,
        })
        .expect(409);
    });
  });
```

- [ ] **Step 4: Ampliar `describe('PATCH /vehiculos/:id', ...)`**

Después del test existente `'edita el nombre y el kilometraje'` (que no necesita cambios: `sembrarVehiculo` sigue aceptando dos argumentos porque el tercero es opcional), agregar dos tests nuevos, justo antes del cierre del `describe`:

```ts
    it('edita las placas', async () => {
      const id = await sembrarVehiculo(
        `${PREFIJO} Con placas`,
        idTijuana,
        `${PREFIJO}-OLD`,
      );

      const res = await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ placas: `${PREFIJO}-NEW` })
        .expect(200);

      expect((res.body as VehiculoRespuesta).placas).toBe(`${PREFIJO}-NEW`);
    });

    it('cambiar a unas placas ya tomadas responde 409', async () => {
      await sembrarVehiculo(
        `${PREFIJO} Placas ocupadas`,
        idTijuana,
        `${PREFIJO}-OCUPADA`,
      );
      const id = await sembrarVehiculo(
        `${PREFIJO} Aspirante placas`,
        idMexicali,
        `${PREFIJO}-LIBRE`,
      );

      await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieGeneral)
        .send({ placas: `${PREFIJO}-OCUPADA` })
        .expect(409);
    });

    // Un vehiculo sembrado SIN placas (como los que ya existian antes de
    // T-68) sigue editable en cualquier otro campo, sin que la falta de
    // placas bloquee nada — es el punto central del diseno (Review Focus).
    it('un vehiculo sin placas se puede editar en otro campo sin problema', async () => {
      const id = await sembrarVehiculo(`${PREFIJO} Vehiculo viejo`, idTijuana);

      const res = await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ activo: false })
        .expect(200);

      expect((res.body as VehiculoRespuesta).placas).toBeNull();
      expect((res.body as VehiculoRespuesta).activo).toBe(false);
    });
```

- [ ] **Step 5: Correr la suite completa**

Run: `npm run test:e2e --workspace=apps/backend -- vehiculos.e2e-spec.ts`
Expected: todos los tests en verde, incluyendo los 5 nuevos.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/test/vehiculos.e2e-spec.ts
git commit -m "T-68: pruebas e2e de placas en Vehiculo"
```

---

## Task 4: Portal Web — formulario y catálogo

**Files:**
- Modify: `apps/portal/src/lib/vehiculos.ts`
- Modify: `apps/portal/src/components/vehiculos/formulario-vehiculo.tsx`
- Modify: `apps/portal/src/components/vehiculos/pantalla-vehiculos.tsx`

**Interfaces:**
- Consumes: `POST /vehiculos` y `PATCH /vehiculos/:id` con `placas` (Task 2).

- [ ] **Step 1: `lib/vehiculos.ts` — tipos y funciones**

```ts
export interface Vehiculo {
  id: string;
  nombre: string;
  placas: string | null;
  kmInicial: number | null;
  sucursalId: string;
  sucursalCodigo: string;
  activo: boolean;
}

export function crearVehiculo(datos: {
  nombre: string;
  placas: string;
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
  cambios: {
    nombre?: string;
    placas?: string;
    kmInicial?: number;
    activo?: boolean;
  },
): Promise<Vehiculo> {
  return apiFetch<Vehiculo>(`/vehiculos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(cambios),
  });
}
```

(`listarVehiculos` no cambia.)

- [ ] **Step 2: `formulario-vehiculo.tsx` — campo Placas**

Agregar el estado, después de `const [nombre, ...]`:

```tsx
  const [placas, setPlacas] = useState(vehiculo?.placas ?? "");
```

En `alEnviar`, incluir `placas` en ambas ramas:

```tsx
    await enviar(
      () =>
        vehiculo
          ? editarVehiculo(vehiculo.id, {
              nombre,
              placas,
              kmInicial: kmNumero,
              activo,
            })
          : crearVehiculo({
              nombre,
              placas,
              kmInicial: kmNumero,
              ...(eligeSucursal ? { sucursalId } : {}),
            }),
      alGuardar,
    );
```

En el JSX, agregar el campo junto a "Nombre del vehículo" (dentro del mismo `<div className="flex flex-wrap gap-4">`, antes del campo "Kilometraje"):

```tsx
        <div className="flex flex-col gap-1.5">
          <label htmlFor="placas" className="text-sm font-medium">
            Placas
          </label>
          <input
            id="placas"
            name="placas"
            required
            maxLength={20}
            disabled={enviando}
            placeholder="ABC-123"
            value={placas}
            onChange={(e) => setPlacas(e.target.value)}
            className="w-40 rounded-md border px-3 py-2 text-sm"
          />
        </div>
```

- [ ] **Step 3: `pantalla-vehiculos.tsx` — columna Placas en la lista**

En el arreglo `columnas`, agregar después de la columna "Nombre":

```tsx
        {
          encabezado: "Placas",
          celda: (v) => v.placas ?? "—",
          className: "font-mono",
        },
```

- [ ] **Step 4: Verificar tipos y build del portal**

Run: `npm run build --workspace=apps/portal`
Expected: sin errores de TypeScript (el campo `placas` es obligatorio en `crearVehiculo`, así que cualquier otro llamador tendría que actualizarse — no hay ninguno fuera de `formulario-vehiculo.tsx`).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/lib/vehiculos.ts apps/portal/src/components/vehiculos/
git commit -m "T-68: campo Placas en el formulario y catalogo de Vehiculos"
```

---

## Task 5: Verificación manual en el Portal

**Files:** (ninguno — verificación con navegador)

- [ ] **Step 1: Levantar el backend y el portal**

Run: `npm run backend` (en una terminal) y `npm run portal` (en otra). Requiere `.env.development` con `JWT_SECRET` — ver `CLAUDE.md`.

- [ ] **Step 2: Probar el alta**

En `http://localhost:3001/catalogo/vehiculos`:
1. Clic en "Nuevo vehículo" sin llenar Placas → el navegador bloquea el envío (`required`).
2. Llenar Nombre, Placas y Kilometraje → Guardar → aparece en la lista con su columna Placas.
3. Repetir con las mismas Placas en otro vehículo (otra sucursal si el usuario es General) → el formulario muestra el 409 ("Ya existe un vehículo con las placas...").

- [ ] **Step 3: Probar la edición de un vehículo sembrado antes de este cambio**

Si hay vehículos de T-11 en la base local sin placas, abrir uno para editar: el campo Placas aparece vacío (no bloquea guardar otro cambio, como `Activo`) — confirma el Review Focus de este plan.

- [ ] **Step 4: Reportar el resultado**

Si algo del checklist falla, no marcar la tarea como completa — volver a Task 2, 3 o 4 según corresponda.

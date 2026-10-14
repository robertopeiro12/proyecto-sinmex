# T-51 · Reporte de Clientes nuevos (Portal) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Información → Reportes → Clientes nuevos: los clientes dados de alta (o convertidos de prospecto) en un rango, con el Usuario que los dio de alta, filtro de sucursal y Excel; y empezar a guardar ese usuario y esa fecha.

**Architecture:** Migración con dos columnas nulas en `cliente` (`alta_cliente_en`, `alta_cliente_usuario_id`) que el alta del portal y la conversión de prospecto llenan. Nuevo handler `GET /reportes/clientes-nuevos` en el `ReportesController` de `modules/estadisticas/` (fecha de alta = `coalesce(alta_cliente_en, created_at)` en hora de Tijuana). Pantalla nueva junto a Kilometraje, con tabla que cabe desde 1366 px y Excel de T-15.

**Tech Stack:** Postgres/Supabase + pgTAP; NestJS + Kysely + Jest/supertest; Next.js 15 + Vitest + Testing Library; `exceljs` vía `apps/portal/src/lib/excel/`.

**Spec:** `docs/superpowers/specs/2026-10-14-t51-clientes-nuevos-design.md`

## Global Constraints

- Migración `supabase/migrations/20261014140000_cliente_alta.sql`: `alta_cliente_en timestamptz`, `alta_cliente_usuario_id uuid references usuario(id) on delete set null`, `ck_cliente_alta_usuario_con_fecha check (alta_cliente_usuario_id is null or alta_cliente_en is not null)`. **No rellena datos.**
- Se llenan **solo** al dar de alta con `tipo = 'cliente'` en el portal y al convertir un prospecto: `alta_cliente_en = now()`, `alta_cliente_usuario_id = usuario de la sesión`.
- Fecha de alta del reporte = `(coalesce(alta_cliente_en, created_at) at time zone 'America/Tijuana')::date`.
- Universo: `cliente.tipo = 'cliente'`, incluidos los dados de baja (`deleted_at` no nulo → `dadoDeBaja: true`). Sucursal = la del cliente.
- Permiso `reportes.ver`. Rango con `validarRango` de `apps/backend/src/modules/estadisticas/reglas-kilometraje.ts`.
- Orden: fecha de alta asc, luego nombre `localeCompare(…, 'es')`.
- Portal: una sola tabla `table-fixed`, `text-[13px]`, toda celda con `px-2`, encabezado `sticky top-0` con `shadow-[inset_0_-1px_0_var(--border)]`, `min-w-[60rem]`; debe caber sin scroll desde 1366 px (lo verifica el controlador en el navegador).
- Reutilizar `rangoSemana`, `rangoMes` (`lib/reporte-ventas.ts`) y `formatearFecha`, `etiquetaSucursal`, `primerDiaDelMes` (`lib/reportes.ts`); no copiarlas.
- Respuestas camelCase; textos de pantalla en español con acentos; comentarios backend sin acentos.
- **No se toca `apps/tablet`.** Comandos desde la raíz con `--workspace=…`. Nunca contra la base en la nube.

## Review Focus

1. **Alta a las 23:30 de Tijuana** (06:30 UTC del día siguiente) → cuenta el día de Tijuana (e2e Tarea 3).
2. **Prospecto creado hace días y convertido hoy** → cuenta hoy, con el usuario que lo convirtió (e2e Tareas 2 y 3).
3. **Cliente que ya existía (sin `alta_cliente_en`)** → usa `created_at` y Usuario "—" (e2e Tarea 3, pantalla Tarea 5).
4. **Usuario que dio de alta y luego fue borrado** → el cliente sigue en el reporte con Usuario "—" (pgTAP Tarea 1).
5. **Consulta lenta superada por otra** → no pisa la nueva (pantalla Tarea 5, RED probado una vez).

---

### Tarea 1: Migración `cliente_alta` (+ pgTAP + tipos)

**Files:**
- Create: `supabase/migrations/20261014140000_cliente_alta.sql`
- Create: `supabase/tests/99_cliente_alta_test.sql`
- Modify: `apps/backend/src/database/schema.d.ts` (regenerado)

**Interfaces:**
- Produces: columnas `cliente.alta_cliente_en`, `cliente.alta_cliente_usuario_id` (y sus tipos en `schema.d.ts`), usadas por las Tareas 2 y 3.

- [ ] **Step 1: Escribir la prueba pgTAP (falla)**

`supabase/tests/99_cliente_alta_test.sql`:

```sql
begin;
select plan(6);

select has_column('cliente', 'alta_cliente_en', 'cliente tiene alta_cliente_en (T-51)');
select has_column('cliente', 'alta_cliente_usuario_id', 'cliente tiene alta_cliente_usuario_id (T-51)');
select col_is_null('cliente', 'alta_cliente_en', 'alta_cliente_en es nulable (clientes viejos y prospectos)');

-- Datos minimos para probar el check y la FK.
insert into usuario (id, login, nombre, password_hash, perfil_id)
values ('00000000-0000-0000-0000-0000000000a1', 'pgtap-alta', 'pgtap alta', 'x',
        (select id from perfil where nombre = 'Administrador General'));
insert into cliente (id, nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id, encargado)
values ('00000000-0000-0000-0000-0000000000c1', 'pgtap cliente', 'Calle', '000', 'cliente',
        (select id from lista_precio where nombre = 'Lista 1'),
        (select id from sucursal where codigo = 'TJ'), 'Enc');

select throws_ok(
  $$update cliente set alta_cliente_usuario_id = '00000000-0000-0000-0000-0000000000a1'
     where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '23514', null,
  'usuario de alta sin fecha de alta se rechaza (ck_cliente_alta_usuario_con_fecha)'
);

update cliente set alta_cliente_en = now(), alta_cliente_usuario_id = '00000000-0000-0000-0000-0000000000a1'
 where id = '00000000-0000-0000-0000-0000000000c1';
delete from usuario where id = '00000000-0000-0000-0000-0000000000a1';

select is(
  (select alta_cliente_usuario_id from cliente where id = '00000000-0000-0000-0000-0000000000c1'),
  null,
  'borrar al usuario deja el cliente sin usuario de alta (on delete set null)'
);
select isnt(
  (select alta_cliente_en from cliente where id = '00000000-0000-0000-0000-0000000000c1'),
  null,
  'la fecha de alta se conserva'
);

select * from finish();
rollback;
```

(Si el insert de `cliente` o `usuario` exige otra columna obligatoria, cópiala de otra prueba pgTAP de `supabase/tests/` que siembre esas tablas y anótalo.)

- [ ] **Step 2: Correr y ver que falla**

Run: `npm run supabase -- test db`
Expected: FAIL en `99_cliente_alta_test.sql` (columnas inexistentes).

- [ ] **Step 3: Migración**

`supabase/migrations/20261014140000_cliente_alta.sql`:

```sql
-- T-51: Reporte de Clientes nuevos. Empieza a guardar CUANDO quedo como
-- cliente y QUE usuario del portal lo dio de alta (alta directa o conversion
-- de prospecto). No rellena datos: el reporte usa
-- coalesce(alta_cliente_en, created_at) y, sin usuario, muestra "—".
-- `on delete set null`: el portal da de baja usuarios con deleted_at, pero si
-- uno se borra de verdad (p. ej. las suites e2e) el cliente solo pierde el dato.
alter table cliente
  add column alta_cliente_en timestamptz,
  add column alta_cliente_usuario_id uuid references usuario(id) on delete set null,
  add constraint ck_cliente_alta_usuario_con_fecha
    check (alta_cliente_usuario_id is null or alta_cliente_en is not null);
```

- [ ] **Step 4: Aplicar, correr y regenerar tipos**

Run: `npm run supabase -- migration up --local && npm run supabase -- test db`
Expected: todo pgTAP en verde.

Run: `npm run db:types --workspace=apps/backend && git diff --stat apps/backend/src/database/schema.d.ts`
Expected: `schema.d.ts` cambia solo en `Cliente` (dos campos nuevos).

Run: `npm run build --workspace=apps/backend`
Expected: compila.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261014140000_cliente_alta.sql supabase/tests/99_cliente_alta_test.sql apps/backend/src/database/schema.d.ts
git commit -m "T-51: cliente guarda fecha y usuario de alta (migración + pgTAP)"
```

---

### Tarea 2: El alta del portal y la conversión llenan fecha y usuario

**Files:**
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.repository.ts` (`crear`, `convertirACliente`)
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.service.ts` (`crear`, `convertirACliente`)
- Modify (si algún spec unitario afirma los argumentos exactos de `repo.crear` / `repo.convertirACliente`): `apps/backend/src/modules/cartera-clientes/*.spec.ts`
- Test: `apps/backend/test/clientes.e2e-spec.ts` (agregar casos)

**Interfaces:**
- Consumes: columnas de la Tarea 1.
- Produces: `ClientesRepository.crear(datos & { tipo; sucursal_id; altaUsuarioId: string }, …)` y `ClientesRepository.convertirACliente(id: string, usuarioId: string)`.

- [ ] **Step 1: Escribir las pruebas e2e (fallan)**

En `apps/backend/test/clientes.e2e-spec.ts`:

1. Dentro del `describe` de `POST /clientes` (donde vive `datosMinimos`), agregar:

```ts
    it('T-51: un alta de tipo cliente guarda fecha y usuario de alta; un prospecto no', async () => {
      const { id: usuarioTj } = await db
        .selectFrom('usuario')
        .select('id')
        .where('login', '=', LOGIN_TIJUANA)
        .executeTakeFirstOrThrow();

      const antes = Date.now();
      const cliente = (
        await request(app.getHttpServer())
          .post('/clientes')
          .set('Cookie', cookieTijuana)
          .send(datosMinimos({ nombre: `${PREFIJO} Alta T51` }))
          .expect(201)
      ).body as ClienteDetalleRespuesta;
      clienteIds.push(cliente.id);

      const fila = await db
        .selectFrom('cliente')
        .select(['alta_cliente_en', 'alta_cliente_usuario_id'])
        .where('id', '=', cliente.id)
        .executeTakeFirstOrThrow();
      expect(fila.alta_cliente_usuario_id).toBe(usuarioTj);
      expect(new Date(fila.alta_cliente_en as unknown as string).getTime()).toBeGreaterThanOrEqual(antes - 5000);

      const prospecto = (
        await request(app.getHttpServer())
          .post('/clientes')
          .set('Cookie', cookieTijuana)
          .send(datosMinimos({ nombre: `${PREFIJO} Prospecto T51`, tipo: 'prospecto' }))
          .expect(201)
      ).body as ClienteDetalleRespuesta;
      clienteIds.push(prospecto.id);
      const filaP = await db
        .selectFrom('cliente')
        .select(['alta_cliente_en', 'alta_cliente_usuario_id'])
        .where('id', '=', prospecto.id)
        .executeTakeFirstOrThrow();
      expect(filaP).toEqual({ alta_cliente_en: null, alta_cliente_usuario_id: null });
    });
```

2. Dentro del `describe('POST /clientes/:id/convertir-a-cliente')`, agregar:

```ts
    it('T-51: convertir guarda la fecha de conversion y el usuario que convirtio', async () => {
      const id = await sembrarCliente(`${PREFIJO} Convertir T51`, idTijuana, 'prospecto');
      // El prospecto se "creo" hace 10 dias: la fecha de alta debe ser la de la conversion.
      await db
        .updateTable('cliente')
        .set({ created_at: new Date(Date.now() - 10 * 24 * 3600 * 1000) })
        .where('id', '=', id)
        .execute();
      const { id: usuarioTj } = await db
        .selectFrom('usuario')
        .select('id')
        .where('login', '=', LOGIN_TIJUANA)
        .executeTakeFirstOrThrow();

      const antes = Date.now();
      await request(app.getHttpServer())
        .post(`/clientes/${id}/convertir-a-cliente`)
        .set('Cookie', cookieTijuana)
        .expect(201);

      const fila = await db
        .selectFrom('cliente')
        .select(['alta_cliente_en', 'alta_cliente_usuario_id'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(fila.alta_cliente_usuario_id).toBe(usuarioTj);
      expect(new Date(fila.alta_cliente_en as unknown as string).getTime()).toBeGreaterThanOrEqual(antes - 5000);
    });
```

(Si `LOGIN_TIJUANA`, `sembrarCliente`, `idTijuana`, `clienteIds` o `ClienteDetalleRespuesta` tienen otro nombre o alcance en el archivo, usa los reales y anótalo.)

- [ ] **Step 2: Correr y ver que falla**

Run: `npm run test:e2e --workspace=apps/backend -- clientes.e2e`
Expected: FAIL en los dos casos nuevos (`alta_cliente_usuario_id` es `null`).

- [ ] **Step 3: Implementar**

`clientes.repository.ts`, en `crear`: el tipo del primer parámetro suma `altaUsuarioId: string`, y el `insertInto('cliente').values({...})` agrega:

```ts
          // T-51: solo un CLIENTE tiene alta; un prospecto la tendra al convertirse.
          alta_cliente_en: datos.tipo === 'cliente' ? sql<Date>`now()` : null,
          alta_cliente_usuario_id: datos.tipo === 'cliente' ? datos.altaUsuarioId : null,
```

(importar `sql` de `kysely` si el archivo no lo importa ya).

`clientes.repository.ts`, `convertirACliente`:

```ts
  async convertirACliente(id: string, usuarioId: string): Promise<ClienteDetalle> {
    await this.db
      .updateTable('cliente')
      // T-51: la fecha de alta como cliente es la de la conversion, no la del prospecto.
      .set({ tipo: 'cliente', alta_cliente_en: sql<Date>`now()`, alta_cliente_usuario_id: usuarioId })
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

    return (await this.obtener(id))!;
  }
```

`clientes.service.ts`:
- En `crear`, en el objeto que se pasa a `this.repo.crear({...})`, agregar `altaUsuarioId: usuarioId,`.
- En `convertirACliente`, cambiar `this.repo.convertirACliente(id)` por `this.repo.convertirACliente(id, usuarioId)`.

Si algún `*.spec.ts` unitario de `cartera-clientes` falla porque afirma los argumentos exactos, actualízalo a los nuevos (sin debilitarlo).

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm run test:e2e --workspace=apps/backend -- clientes.e2e && npm test --workspace=apps/backend && npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend`
Expected: todo en verde.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/cartera-clientes apps/backend/test/clientes.e2e-spec.ts
git commit -m "T-51: el alta de cliente y la conversión de prospecto guardan fecha y usuario"
```

---

### Tarea 3: Endpoint `GET /reportes/clientes-nuevos` (reglas + e2e)

**Files:**
- Create: `apps/backend/src/modules/estadisticas/reglas-clientes-nuevos.ts` (+ `reglas-clientes-nuevos.spec.ts`)
- Create: `apps/backend/src/modules/estadisticas/dto/reporte-clientes-nuevos.dto.ts`
- Create: `apps/backend/src/modules/estadisticas/reporte-clientes-nuevos.repository.ts`
- Create: `apps/backend/src/modules/estadisticas/reporte-clientes-nuevos.service.ts`
- Modify: `apps/backend/src/modules/estadisticas/reporte-kilometraje.controller.ts` (nuevo handler + inyección)
- Modify: `apps/backend/src/modules/estadisticas/estadisticas.module.ts`
- Test: `apps/backend/test/reporte-clientes-nuevos.e2e-spec.ts`

**Interfaces:**
- Consumes: columnas de la Tarea 1; `validarRango`; `buscarSucursalUsuario`; `resolverAlcance`, `normalizarSucursalPedida`.
- Produces (Tarea 4 copia estas formas):

```ts
export interface ClienteNuevo { id: string; fechaAlta: string; nombre: string; sucursalCodigo: string; tipoNegocio: string | null; listaPrecio: string | null; telefono: string; encargado: string | null; usuario: string | null; dadoDeBaja: boolean }
export interface ReporteClientesNuevos { desde: string; hasta: string; clientes: ClienteNuevo[]; total: number }
export function armarReporteClientesNuevos(desde: string, hasta: string, filas: ClienteNuevo[]): ReporteClientesNuevos
```
`GET /reportes/clientes-nuevos?desde&hasta&sucursal` → `ReporteClientesNuevos`; permiso `reportes.ver`.

- [ ] **Step 1: Pruebas unitarias de las reglas (fallan)**

`reglas-clientes-nuevos.spec.ts`:

```ts
import { armarReporteClientesNuevos, type ClienteNuevo } from './reglas-clientes-nuevos';

const c = (extra: Partial<ClienteNuevo>): ClienteNuevo => ({
  id: 'c', fechaAlta: '2026-10-05', nombre: 'Cobach', sucursalCodigo: 'TJ', tipoNegocio: null,
  listaPrecio: 'Lista 1', telefono: '664', encargado: null, usuario: null, dadoDeBaja: false, ...extra,
});

describe('armarReporteClientesNuevos', () => {
  it('vacío', () => {
    expect(armarReporteClientesNuevos('2026-10-01', '2026-10-14', [])).toEqual({
      desde: '2026-10-01', hasta: '2026-10-14', clientes: [], total: 0,
    });
  });

  it('ordena por fecha y luego por nombre en español; total', () => {
    const r = armarReporteClientesNuevos('2026-10-01', '2026-10-14', [
      c({ id: '3', fechaAlta: '2026-10-09', nombre: 'Zeta' }),
      c({ id: '2', fechaAlta: '2026-10-05', nombre: 'Beta' }),
      c({ id: '1', fechaAlta: '2026-10-05', nombre: 'Ámbar' }),
    ]);
    expect(r.clientes.map((x) => x.id)).toEqual(['1', '2', '3']);
    expect(r.total).toBe(3);
  });

  it('no muta la entrada', () => {
    const filas = [c({ id: 'b', nombre: 'B' }), c({ id: 'a', nombre: 'A' })];
    armarReporteClientesNuevos('2026-10-01', '2026-10-14', filas);
    expect(filas.map((x) => x.id)).toEqual(['b', 'a']);
  });
});
```

Run: `npm test --workspace=apps/backend -- reglas-clientes-nuevos` → FAIL (módulo inexistente).

- [ ] **Step 2: Reglas**

`reglas-clientes-nuevos.ts`:

```ts
/*
 * Reporte de Clientes nuevos (T-51): las reglas sin base de datos. El SQL ya
 * trae la fecha de alta en hora de Tijuana; aqui solo se ordena y se cuenta.
 * El portal copia estas formas en `lib/reporte-clientes-nuevos.ts`.
 */

export interface ClienteNuevo {
  id: string;
  /** `AAAA-MM-DD` de Tijuana: coalesce(alta_cliente_en, created_at). */
  fechaAlta: string;
  nombre: string;
  sucursalCodigo: string;
  tipoNegocio: string | null;
  listaPrecio: string | null;
  telefono: string;
  encargado: string | null;
  /** Usuario del portal que lo dio de alta; `null` = no se sabe. */
  usuario: string | null;
  dadoDeBaja: boolean;
}

export interface ReporteClientesNuevos {
  desde: string;
  hasta: string;
  clientes: ClienteNuevo[];
  total: number;
}

export function armarReporteClientesNuevos(
  desde: string,
  hasta: string,
  filas: ClienteNuevo[],
): ReporteClientesNuevos {
  const clientes = [...filas].sort(
    (a, b) =>
      (a.fechaAlta < b.fechaAlta ? -1 : a.fechaAlta > b.fechaAlta ? 1 : 0) ||
      a.nombre.localeCompare(b.nombre, 'es'),
  );
  return { desde, hasta, clientes, total: clientes.length };
}
```

Run: `npm test --workspace=apps/backend -- reglas-clientes-nuevos` → PASS.

- [ ] **Step 3: e2e del endpoint (falla)**

`apps/backend/test/reporte-clientes-nuevos.e2e-spec.ts`. Sucursal propia **`ZN`** (ordena después de TJ; `ZA`–`ZH`, `ZQ` y `ZV` ya están en uso). Copia el arranque, `iniciarSesion` y `crearUsuario` de `test/reporte-ventas.e2e-spec.ts`. Fechas fijas de **mayo de 2018**.

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import { DB_CONNECTION, type Database } from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';
import type { ReporteClientesNuevos } from './../src/modules/estadisticas/reglas-clientes-nuevos';

const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const CODIGO = 'ZN';
const DESDE = '2018-05-01';
const HASTA = '2018-05-31';

describe('Reporte de Clientes nuevos (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  let idZn: string;
  let idTijuana: string;
  let altaId: string;
  let cookieGeneral: string;
  let cookieZn: string;
  let cookieSinPermiso: string;
  const ids: Record<string, string> = {};

  // iniciarSesion y crearUsuario: copiar de test/reporte-ventas.e2e-spec.ts (crearUsuario devuelve el id).

  const sembrar = async (c: {
    nombre: string;
    sucursalId?: string;
    tipo?: 'cliente' | 'prospecto';
    creado: string;            // ISO con zona
    alta?: string | null;      // ISO con zona; null = sin alta guardada
    usuarioAlta?: string | null;
    baja?: boolean;
  }): Promise<string> => {
    const lista = await db.selectFrom('lista_precio').select('id').where('nombre', '=', 'Lista 1').executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `${c.nombre} ${SUFIJO}`, domicilio: 'Calle 1', telefono: '6640000000', encargado: 'Enc',
        tipo: c.tipo ?? 'cliente', lista_precio_id: lista.id, sucursal_id: c.sucursalId ?? idZn,
        created_at: new Date(c.creado),
        alta_cliente_en: c.alta ? new Date(c.alta) : null,
        alta_cliente_usuario_id: c.usuarioAlta ?? null,
        deleted_at: c.baja ? new Date() : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return id;
  };

  const pedir = (cookie: string, q: Record<string, string>) =>
    request(app.getHttpServer()).get(`/reportes/clientes-nuevos?${new URLSearchParams(q).toString()}`).set('Cookie', cookie);
  const deZn = async (): Promise<ReporteClientesNuevos> =>
    (await pedir(cookieGeneral, { desde: DESDE, hasta: HASTA, sucursal: CODIGO }).expect(200)).body as ReporteClientesNuevos;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    idZn = (
      await db.insertInto('sucursal').values({ codigo: CODIGO, nombre: 'Prueba Clientes nuevos' })
        .onConflict((oc) => oc.column('codigo').doUpdateSet({ deleted_at: null }))
        .returning('id').executeTakeFirstOrThrow()
    ).id;
    idTijuana = (await db.selectFrom('sucursal').select('id').where('codigo', '=', 'TJ').executeTakeFirstOrThrow()).id;

    await crearUsuario(`e2e-cn-gen-${SUFIJO}`, 'Administrador General', null);
    await crearUsuario(`e2e-cn-zn-${SUFIJO}`, 'Administrador General', idZn);
    await crearUsuario(`e2e-cn-sin-${SUFIJO}`, 'Auxiliar Administrativo', null);
    altaId = await crearUsuario(`e2e-cn-alta-${SUFIJO}`, 'Administrador General', null);
    await db.updateTable('usuario').set({ nombre: `Lupita ${SUFIJO}` }).where('id', '=', altaId).execute();
    cookieGeneral = await iniciarSesion(`e2e-cn-gen-${SUFIJO}`);
    cookieZn = await iniciarSesion(`e2e-cn-zn-${SUFIJO}`);
    cookieSinPermiso = await iniciarSesion(`e2e-cn-sin-${SUFIJO}`);

    // Con alta guardada, a media manana de Tijuana (17:00 UTC).
    ids.conAlta = await sembrar({ nombre: 'Con alta', creado: '2018-05-03T17:00:00Z', alta: '2018-05-03T17:00:00Z', usuarioAlta: altaId });
    // Cliente viejo sin alta guardada: usa created_at; usuario null.
    ids.viejo = await sembrar({ nombre: 'Viejo', creado: '2018-05-04T17:00:00Z' });
    // Prospecto creado en abril y convertido el 10 de mayo: cuenta el 10.
    ids.convertido = await sembrar({ nombre: 'Convertido', creado: '2018-04-20T17:00:00Z', alta: '2018-05-10T17:00:00Z', usuarioAlta: altaId });
    // Prospecto sin convertir: no aparece.
    ids.prospecto = await sembrar({ nombre: 'Prospecto', tipo: 'prospecto', creado: '2018-05-05T17:00:00Z' });
    // Dado de baja despues: aparece marcado.
    ids.baja = await sembrar({ nombre: 'De baja', creado: '2018-05-06T17:00:00Z', alta: '2018-05-06T17:00:00Z', usuarioAlta: altaId, baja: true });
    // 23:30 del 31 de mayo en Tijuana (PDT, UTC-7) = 06:30 UTC del 1 de junio: cuenta el 31 (Review Focus 1).
    ids.medianoche = await sembrar({ nombre: 'Medianoche', creado: '2018-06-01T06:30:00Z', alta: '2018-06-01T06:30:00Z' });
    // 00:30 del 1 de mayo en Tijuana = 07:30 UTC del 1 de mayo: cuenta el 1 (dentro).
    ids.inicio = await sembrar({ nombre: 'Inicio', creado: '2018-05-01T07:30:00Z', alta: '2018-05-01T07:30:00Z' });
    // 23:30 del 30 de abril en Tijuana = 06:30 UTC del 1 de mayo: cuenta el 30 de abril (fuera).
    ids.abril = await sembrar({ nombre: 'Abril', creado: '2018-05-01T06:30:00Z', alta: '2018-05-01T06:30:00Z' });
    // Otra sucursal.
    ids.tj = await sembrar({ nombre: 'Tijuana', sucursalId: idTijuana, creado: '2018-05-03T17:00:00Z', alta: '2018-05-03T17:00:00Z' });
  });

  afterAll(async () => {
    await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    await db.deleteFrom('sesion_refresh').where('usuario_id', 'in', usuarioIds).execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await db.deleteFrom('sucursal').where('codigo', '=', CODIGO).execute();
    await app.close();
  });

  it('sin sesion 401; sin reportes.ver 403; rango invalido, invertido o > 1 ano 400', async () => {
    await request(app.getHttpServer()).get(`/reportes/clientes-nuevos?desde=${DESDE}&hasta=${HASTA}`).expect(401);
    await pedir(cookieSinPermiso, { desde: DESDE, hasta: HASTA }).expect(403);
    await pedir(cookieGeneral, { desde: '2018-02-30', hasta: HASTA }).expect(400);
    await pedir(cookieGeneral, { desde: HASTA, hasta: DESDE }).expect(400);
    await pedir(cookieGeneral, { desde: '2017-01-01', hasta: HASTA }).expect(400);
  });

  it('atado a ZN: "todas" o nada le da ZN; pedir TJ es 403', async () => {
    for (const q of [{}, { sucursal: 'todas' }]) {
      const r = (await pedir(cookieZn, { desde: DESDE, hasta: HASTA, ...q }).expect(200)).body as ReporteClientesNuevos;
      const ids2 = r.clientes.map((x) => x.id);
      expect(ids2).toContain(ids.conAlta);
      expect(ids2).not.toContain(ids.tj);
    }
    await pedir(cookieZn, { desde: DESDE, hasta: HASTA, sucursal: 'TJ' }).expect(403);
  });

  it('universo, fecha de Tijuana, usuario y baja (Review Focus 1-3)', async () => {
    const r = await deZn();
    const porId = new Map(r.clientes.map((x) => [x.id, x]));
    expect([...porId.keys()].sort()).toEqual([ids.conAlta, ids.viejo, ids.convertido, ids.baja, ids.medianoche, ids.inicio].sort());
    expect(r.total).toBe(6);
    expect(porId.get(ids.conAlta)).toMatchObject({ fechaAlta: '2018-05-03', usuario: `Lupita ${SUFIJO}`, dadoDeBaja: false, sucursalCodigo: CODIGO, listaPrecio: 'Lista 1', telefono: '6640000000', encargado: 'Enc', tipoNegocio: null });
    expect(porId.get(ids.viejo)).toMatchObject({ fechaAlta: '2018-05-04', usuario: null });
    expect(porId.get(ids.convertido)).toMatchObject({ fechaAlta: '2018-05-10', usuario: `Lupita ${SUFIJO}` });
    expect(porId.get(ids.baja)).toMatchObject({ dadoDeBaja: true });
    expect(porId.get(ids.medianoche)?.fechaAlta).toBe('2018-05-31');
    expect(porId.get(ids.inicio)?.fechaAlta).toBe('2018-05-01');
    expect(r.clientes.map((x) => x.fechaAlta)).toEqual([...r.clientes.map((x) => x.fechaAlta)].sort());
  });
});
```

Run: `npm run test:e2e --workspace=apps/backend -- reporte-clientes-nuevos` → FAIL (404).

- [ ] **Step 4: DTO, repositorio, servicio, controlador y módulo**

`dto/reporte-clientes-nuevos.dto.ts`:

```ts
import { IsOptional, IsString, Matches } from 'class-validator';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** `GET /reportes/clientes-nuevos` (T-51). El rango lo termina de validar `validarRango`. */
export class ReporteClientesNuevosDto {
  @Matches(RE_FECHA, { message: 'La fecha "desde" debe tener el formato AAAA-MM-DD.' })
  desde!: string;

  @Matches(RE_FECHA, { message: 'La fecha "hasta" debe tener el formato AAAA-MM-DD.' })
  hasta!: string;

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;
}
```

`reporte-clientes-nuevos.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type { ClienteNuevo } from './reglas-clientes-nuevos';

@Injectable()
export class ReporteClientesNuevosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  buscarSucursalUsuario(usuarioId: string) {
    return buscarSucursalUsuario(this.db, usuarioId);
  }

  /**
   * Clientes (no prospectos) cuya fecha de alta, en hora de Tijuana, cae en el
   * rango. Los clientes anteriores a T-51 no tienen `alta_cliente_en`: usan
   * `created_at`. Los dados de baja despues SI entran (fueron nuevos).
   */
  async clientes(f: { desde: string; hasta: string; codigoSucursal: string | null }): Promise<ClienteNuevo[]> {
    const filas = await sql<{
      id: string;
      fecha_alta: string;
      nombre: string;
      sucursal_codigo: string;
      tipo_negocio: string | null;
      lista_precio: string | null;
      telefono: string;
      encargado: string | null;
      usuario: string | null;
      dado_de_baja: boolean;
    }>`
      select * from (
        select c.id,
               to_char((coalesce(c.alta_cliente_en, c.created_at) at time zone 'America/Tijuana')::date,
                       'YYYY-MM-DD') as fecha_alta,
               c.nombre, s.codigo as sucursal_codigo,
               tn.nombre as tipo_negocio, lp.nombre as lista_precio,
               c.telefono, c.encargado, u.nombre as usuario,
               c.deleted_at is not null as dado_de_baja
          from cliente c
          join sucursal s on s.id = c.sucursal_id
          left join tipo_negocio tn on tn.id = c.tipo_negocio_id
          left join lista_precio lp on lp.id = c.lista_precio_id
          left join usuario u on u.id = c.alta_cliente_usuario_id
         where c.tipo = 'cliente'
           and (${f.codigoSucursal}::text is null or s.codigo = ${f.codigoSucursal}::text)
      ) x
      where x.fecha_alta between ${f.desde} and ${f.hasta}
    `.execute(this.db);

    return filas.rows.map((r) => ({
      id: r.id,
      fechaAlta: r.fecha_alta,
      nombre: r.nombre,
      sucursalCodigo: r.sucursal_codigo,
      tipoNegocio: r.tipo_negocio,
      listaPrecio: r.lista_precio,
      telefono: r.telefono,
      encargado: r.encargado,
      usuario: r.usuario,
      dadoDeBaja: r.dado_de_baja,
    }));
  }
}
```

(`fecha_alta` es texto `AAAA-MM-DD`, así que `between` de texto ordena igual que de fecha.)

`reporte-clientes-nuevos.service.ts`:

```ts
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { normalizarSucursalPedida, resolverAlcance } from '../sucursales/alcance-sucursal';
import type { ReporteClientesNuevosDto } from './dto/reporte-clientes-nuevos.dto';
import { validarRango } from './reglas-kilometraje';
import { armarReporteClientesNuevos, type ReporteClientesNuevos } from './reglas-clientes-nuevos';
import { ReporteClientesNuevosRepository } from './reporte-clientes-nuevos.repository';

@Injectable()
export class ReporteClientesNuevosService {
  constructor(private readonly repo: ReporteClientesNuevosRepository) {}

  async clientesNuevos(usuarioId: string, q: ReporteClientesNuevosDto): Promise<ReporteClientesNuevos> {
    const error = validarRango(q.desde, q.hasta);
    if (error) throw new BadRequestException(error);

    // El guard valido la firma del token, no que el usuario siga existiendo.
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    const alcance = resolverAlcance(usuario.codigo, normalizarSucursalPedida(q.sucursal));

    const filas = await this.repo.clientes({
      desde: q.desde,
      hasta: q.hasta,
      codigoSucursal: alcance.tipo === 'una' ? alcance.codigo : null,
    });
    return armarReporteClientesNuevos(q.desde, q.hasta, filas);
  }
}
```

`reporte-kilometraje.controller.ts`: inyectar `private readonly clientesNuevosSrv: ReporteClientesNuevosService` en el constructor y agregar:

```ts
  // T-51. Seccion Informacion -> Reportes: `reportes.ver`, como Kilometraje.
  @Get('clientes-nuevos')
  @RequierePermiso('reportes.ver')
  reporteClientesNuevos(
    @UsuarioActual() usuarioId: string,
    @Query() q: ReporteClientesNuevosDto,
  ): Promise<ReporteClientesNuevos> {
    return this.clientesNuevosSrv.clientesNuevos(usuarioId, q);
  }
```

`estadisticas.module.ts`: agregar `ReporteClientesNuevosService` y `ReporteClientesNuevosRepository` a `providers` y actualizar el comentario ("T-51, Clientes nuevos (lee `cliente`)").

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm run test:e2e --workspace=apps/backend -- reporte-clientes-nuevos` → PASS.
Run: `npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend && npm test --workspace=apps/backend && npm run test:e2e --workspace=apps/backend` → todo en verde.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/estadisticas apps/backend/test/reporte-clientes-nuevos.e2e-spec.ts
git commit -m "T-51: GET /reportes/clientes-nuevos (fecha de Tijuana, usuario, dados de baja)"
```

---

### Tarea 4: Cliente HTTP y Excel del portal

**Files:**
- Create: `apps/portal/src/lib/reporte-clientes-nuevos.ts`
- Test: `apps/portal/src/lib/reporte-clientes-nuevos.test.ts`

**Interfaces:**
- Consumes: `apiFetch`; `formatearFecha` (`./reportes`); `DefinicionExcel`, `FilaExcel`.
- Produces (Tarea 5):

```ts
export interface ClienteNuevo { id; fechaAlta; nombre; sucursalCodigo; tipoNegocio: string | null; listaPrecio: string | null; telefono; encargado: string | null; usuario: string | null; dadoDeBaja: boolean }
export interface ReporteClientesNuevos { desde; hasta; clientes: ClienteNuevo[]; total: number }
export function obtenerReporteClientesNuevos(f: { desde: string; hasta: string; sucursal: string | null }): Promise<ReporteClientesNuevos>
export function nombreConBaja(c: { nombre: string; dadoDeBaja: boolean }): string   // "X (dado de baja)"
export function textoTotalClientes(n: number): string                                // "1 cliente nuevo" / "N clientes nuevos"
export function definicionExcelClientesNuevos(r: ReporteClientesNuevos, filtros: { sucursal: string }): DefinicionExcel
```

- [ ] **Step 1: Pruebas (fallan)**

`reporte-clientes-nuevos.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  definicionExcelClientesNuevos,
  nombreConBaja,
  obtenerReporteClientesNuevos,
  textoTotalClientes,
  type ReporteClientesNuevos,
} from "./reporte-clientes-nuevos";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

const REPORTE: ReporteClientesNuevos = {
  desde: "2026-10-01",
  hasta: "2026-10-14",
  clientes: [
    { id: "1", fechaAlta: "2026-10-03", nombre: "Cobach XXI", sucursalCodigo: "TJ", tipoNegocio: "Escuela", listaPrecio: "Lista 1", telefono: "6640000001", encargado: "Lupita", usuario: "Ana Admin", dadoDeBaja: false },
    { id: "2", fechaAlta: "2026-10-09", nombre: "Abarrotes Cerrado", sucursalCodigo: "TJ", tipoNegocio: null, listaPrecio: null, telefono: "6640000002", encargado: null, usuario: null, dadoDeBaja: true },
  ],
  total: 2,
};

describe("obtenerReporteClientesNuevos", () => {
  beforeEach(() => apiFetch.mockReset());
  it("manda rango y sucursal si hay", async () => {
    apiFetch.mockResolvedValue(REPORTE);
    await obtenerReporteClientesNuevos({ desde: "2026-10-01", hasta: "2026-10-14", sucursal: null });
    expect(apiFetch).toHaveBeenLastCalledWith("/reportes/clientes-nuevos?desde=2026-10-01&hasta=2026-10-14");
    await obtenerReporteClientesNuevos({ desde: "2026-10-01", hasta: "2026-10-14", sucursal: "TJ" });
    expect(apiFetch).toHaveBeenLastCalledWith("/reportes/clientes-nuevos?desde=2026-10-01&hasta=2026-10-14&sucursal=TJ");
  });
});

describe("textos", () => {
  it("nombreConBaja y textoTotalClientes", () => {
    expect(nombreConBaja({ nombre: "X", dadoDeBaja: false })).toBe("X");
    expect(nombreConBaja({ nombre: "X", dadoDeBaja: true })).toBe("X (dado de baja)");
    expect(textoTotalClientes(0)).toBe("0 clientes nuevos");
    expect(textoTotalClientes(1)).toBe("1 cliente nuevo");
    expect(textoTotalClientes(12)).toBe("12 clientes nuevos");
  });
});

describe("definicionExcelClientesNuevos", () => {
  it("8 columnas, — para vacíos, total al final", () => {
    const def = definicionExcelClientesNuevos(REPORTE, { sucursal: "TJ" });
    expect(def.titulo).toBe("Clientes nuevos");
    expect(def.filtros).toEqual([["Rango", "01/10/2026 a 14/10/2026"], ["Sucursal", "TJ"]]);
    expect(def.columnas.map((c) => c.encabezado)).toEqual([
      "Fecha de alta", "Cliente", "Sucursal", "Tipo de negocio", "Lista de precios", "Teléfono", "Encargado", "Usuario",
    ]);
    expect(def.columnas[0].tipo).toBe("fecha");
    expect(def.filas).toEqual([
      { celdas: ["2026-10-03", "Cobach XXI", "TJ", "Escuela", "Lista 1", "6640000001", "Lupita", "Ana Admin"] },
      { celdas: ["2026-10-09", "Abarrotes Cerrado (dado de baja)", "TJ", "—", "—", "6640000002", "—", "—"] },
      { tipo: "total", celdas: ["Total: 2 clientes nuevos", null, null, null, null, null, null, null] },
    ]);
    expect(def.nombreArchivo).toBe("clientes-nuevos_2026-10-01_a_2026-10-14");
  });
});
```

Run: `npm test --workspace=apps/portal -- reporte-clientes-nuevos` → FAIL.

- [ ] **Step 2: Implementar**

`apps/portal/src/lib/reporte-clientes-nuevos.ts`:

```ts
import { apiFetch } from "./api";
import type { DefinicionExcel, FilaExcel } from "./excel/definicion";
import { formatearFecha } from "./reportes";

/*
 * Reporte de Clientes nuevos (T-51). Misma forma que
 * apps/backend/src/modules/estadisticas/reglas-clientes-nuevos.ts.
 */

export interface ClienteNuevo {
  id: string;
  /** `AAAA-MM-DD` de Tijuana. */
  fechaAlta: string;
  nombre: string;
  sucursalCodigo: string;
  tipoNegocio: string | null;
  listaPrecio: string | null;
  telefono: string;
  encargado: string | null;
  /** `null` = no se sabe (clientes anteriores a T-51). */
  usuario: string | null;
  dadoDeBaja: boolean;
}

export interface ReporteClientesNuevos {
  desde: string;
  hasta: string;
  clientes: ClienteNuevo[];
  total: number;
}

export function obtenerReporteClientesNuevos(f: {
  desde: string;
  hasta: string;
  sucursal: string | null;
}): Promise<ReporteClientesNuevos> {
  const q = new URLSearchParams({ desde: f.desde, hasta: f.hasta });
  if (f.sucursal) q.set("sucursal", f.sucursal);
  return apiFetch<ReporteClientesNuevos>(`/reportes/clientes-nuevos?${q.toString()}`);
}

export function nombreConBaja(c: { nombre: string; dadoDeBaja: boolean }): string {
  return c.dadoDeBaja ? `${c.nombre} (dado de baja)` : c.nombre;
}

export function textoTotalClientes(n: number): string {
  return n === 1 ? "1 cliente nuevo" : `${n} clientes nuevos`;
}

const oGuion = (v: string | null): string => v ?? "—";

/** Lo consultado como hoja de Excel. `filtros` son los APLICADOS. */
export function definicionExcelClientesNuevos(
  r: ReporteClientesNuevos,
  filtros: { sucursal: string },
): DefinicionExcel {
  const filas: FilaExcel[] = r.clientes.map((c) => ({
    celdas: [
      c.fechaAlta,
      nombreConBaja(c),
      c.sucursalCodigo,
      oGuion(c.tipoNegocio),
      oGuion(c.listaPrecio),
      c.telefono,
      oGuion(c.encargado),
      oGuion(c.usuario),
    ],
  }));
  filas.push({ tipo: "total", celdas: [`Total: ${textoTotalClientes(r.total)}`, null, null, null, null, null, null, null] });

  return {
    titulo: "Clientes nuevos",
    filtros: [
      ["Rango", `${formatearFecha(r.desde)} a ${formatearFecha(r.hasta)}`],
      ["Sucursal", filtros.sucursal],
    ],
    columnas: [
      { encabezado: "Fecha de alta", tipo: "fecha", ancho: 14 },
      { encabezado: "Cliente", tipo: "texto", ancho: 36 },
      { encabezado: "Sucursal", tipo: "texto", ancho: 10 },
      { encabezado: "Tipo de negocio", tipo: "texto", ancho: 20 },
      { encabezado: "Lista de precios", tipo: "texto", ancho: 18 },
      { encabezado: "Teléfono", tipo: "texto", ancho: 14 },
      { encabezado: "Encargado", tipo: "texto", ancho: 22 },
      { encabezado: "Usuario", tipo: "texto", ancho: 22 },
    ],
    filas,
    nombreArchivo: `clientes-nuevos_${r.desde}_a_${r.hasta}`,
  };
}
```

- [ ] **Step 3: Correr y commit**

Run: `npm test --workspace=apps/portal -- reporte-clientes-nuevos && npm run lint --workspace=apps/portal` → PASS.

```bash
git add apps/portal/src/lib/reporte-clientes-nuevos.ts apps/portal/src/lib/reporte-clientes-nuevos.test.ts
git commit -m "T-51: portal — cliente del Reporte de Clientes nuevos y Excel"
```

---

### Tarea 5: Pantalla Información → Reportes → Clientes nuevos

**Files:**
- Create: `apps/portal/src/components/reportes/pantalla-clientes-nuevos.tsx`
- Create: `apps/portal/src/components/reportes/tabla-clientes-nuevos.tsx`
- Create: `apps/portal/src/app/(portal)/informacion/reportes/clientes-nuevos/page.tsx`
- Modify: `apps/portal/src/components/reportes/lista-reportes.tsx` (+ su test si cuenta enlaces)
- Test: `apps/portal/src/components/reportes/pantalla-clientes-nuevos.test.tsx`

**Interfaces:**
- Consumes: Tarea 4; `rangoSemana`, `rangoMes` (`@/lib/reporte-ventas`); `formatearFecha`, `etiquetaSucursal`, `primerDiaDelMes` (`@/lib/reportes`); `hoyEnTijuana` (`@/lib/ventas`); `useAuth`; `mensajeDe`; `exportarExcel`; `Button`, `Card*`.
- Produces: `PantallaClientesNuevos({ sucursal })`; ruta `/informacion/reportes/clientes-nuevos`.

- [ ] **Step 1: Pruebas (fallan)**

`pantalla-clientes-nuevos.test.tsx` (patrón de `pantalla-reporte-ventas.test.tsx`; `ErrorApi(message, status, mensajeApi?)`):

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as excel from "@/lib/excel/exportar";
import * as rcn from "@/lib/reporte-clientes-nuevos";
import type { ReporteClientesNuevos } from "@/lib/reporte-clientes-nuevos";
import { rangoMes, rangoSemana } from "@/lib/reporte-ventas";
import { primerDiaDelMes } from "@/lib/reportes";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaClientesNuevos } from "./pantalla-clientes-nuevos";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/reporte-clientes-nuevos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/reporte-clientes-nuevos")>();
  return { ...real, obtenerReporteClientesNuevos: vi.fn() };
});
vi.mock("@/lib/excel/exportar", () => ({ exportarExcel: vi.fn() }));

const obtener = vi.mocked(rcn.obtenerReporteClientesNuevos);
const exportarExcel = vi.mocked(excel.exportarExcel);

const REPORTE: ReporteClientesNuevos = {
  desde: "2026-10-01",
  hasta: "2026-10-14",
  clientes: [
    { id: "1", fechaAlta: "2026-10-03", nombre: "Cobach XXI", sucursalCodigo: "TJ", tipoNegocio: "Escuela", listaPrecio: "Lista 1", telefono: "6640000001", encargado: "Lupita", usuario: "Ana Admin", dadoDeBaja: false },
    { id: "2", fechaAlta: "2026-10-09", nombre: "Abarrotes Cerrado", sucursalCodigo: "TJ", tipoNegocio: null, listaPrecio: null, telefono: "6640000002", encargado: null, usuario: null, dadoDeBaja: true },
  ],
  total: 2,
};

function mockAuth(permisos: string[], codigoSucursal: string | null = null) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: { id: "u1", login: "ana", nombre: "Ana", perfil: "Administrador General", sucursal: codigoSucursal ? { id: "s", codigo: codigoSucursal, nombre: codigoSucursal } : null, permisos },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (clave: string) => permisos.includes(clave),
  });
}
const PERMISO = "reportes.ver";

describe("PantallaClientesNuevos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    obtener.mockResolvedValue(REPORTE);
    exportarExcel.mockResolvedValue(undefined);
  });

  it("sesión cargando → Cargando…", () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: true, cerrarSesion: vi.fn(), puede: () => false });
    render(<PantallaClientesNuevos sucursal={null} />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByText(/No tienes permiso/)).not.toBeInTheDocument();
  });

  it("sin reportes.ver lo dice y no pide nada", () => {
    mockAuth([]);
    render(<PantallaClientesNuevos sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver reportes")).toBeInTheDocument();
    expect(obtener).not.toHaveBeenCalled();
  });

  it("no consulta al abrir; fechas por defecto del día 1 a hoy; atajos solo llenan", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaClientesNuevos sucursal="TJ" />);
    const hoy = hoyEnTijuana();
    expect(obtener).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Desde")).toHaveValue(primerDiaDelMes(hoy));
    expect(screen.getByLabelText("Hasta")).toHaveValue(hoy);
    await u.click(screen.getByRole("button", { name: "Esta semana" }));
    expect(screen.getByLabelText("Desde")).toHaveValue(rangoSemana(hoy).desde);
    await u.click(screen.getByRole("button", { name: "Este mes" }));
    expect(screen.getByLabelText("Hasta")).toHaveValue(rangoMes(hoy).hasta);
    await u.click(screen.getByRole("button", { name: "Hoy" }));
    expect(screen.getByLabelText("Desde")).toHaveValue(hoy);
    expect(obtener).not.toHaveBeenCalled();
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(obtener).toHaveBeenCalledWith({ desde: hoy, hasta: hoy, sucursal: "TJ" });
  });

  it("fechas invertidas: aviso y no consulta", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaClientesNuevos sucursal={null} />);
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-01" } });
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("La fecha inicial no puede ser posterior a la final.");
    expect(obtener).not.toHaveBeenCalled();
  });

  it("pinta filas, — , (dado de baja), rango consultado y total", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaClientesNuevos sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    const tabla = await screen.findByRole("table", { name: "Clientes nuevos" });
    const fila1 = within(tabla).getByText("Cobach XXI").closest("tr")!;
    expect(within(fila1).getByText("03/10/2026")).toBeInTheDocument();
    expect(within(fila1).getByText("Ana Admin")).toBeInTheDocument();
    const fila2 = within(tabla).getByText("Abarrotes Cerrado (dado de baja)").closest("tr")!;
    expect(within(fila2).getAllByText("—")).toHaveLength(4);
    expect(screen.getByText("Del 01/10/2026 al 14/10/2026 · Sucursal: Todas")).toBeInTheDocument();
    expect(screen.getByText("2 clientes nuevos")).toBeInTheDocument();
  });

  it("tabla alineada: table-fixed, px-2 en toda celda, 8 columnas por fila", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaClientesNuevos sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    const tabla = await screen.findByRole("table", { name: "Clientes nuevos" });
    expect(tabla).toHaveClass("table-fixed");
    expect(tabla).toHaveClass("min-w-[60rem]");
    expect(tabla.querySelectorAll("col")).toHaveLength(8);
    for (const celda of [...within(tabla).getAllByRole("cell"), ...within(tabla).getAllByRole("columnheader")]) {
      expect(celda).toHaveClass("px-2");
    }
    for (const fila of within(tabla).getAllByRole("row")) {
      expect(fila.children).toHaveLength(8);
    }
    expect(within(tabla).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Fecha de alta", "Cliente", "Sucursal", "Tipo de negocio", "Lista de precios", "Teléfono", "Encargado", "Usuario",
    ]);
  });

  it("sin resultados lo dice y Excel deshabilitado; error del servidor en alert", async () => {
    mockAuth([PERMISO]);
    obtener.mockResolvedValueOnce({ ...REPORTE, clientes: [], total: 0 });
    const u = userEvent.setup();
    render(<PantallaClientesNuevos sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(await screen.findByText("No hay clientes nuevos en ese rango.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar a Excel" })).toBeDisabled();
    obtener.mockRejectedValueOnce(new ErrorApi("Bad Request", 400, "El rango no puede pasar de un año."));
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El rango no puede pasar de un año.");
  });

  it("una consulta vieja no pisa a la nueva; Actualizando… (Review Focus 5)", async () => {
    mockAuth([PERMISO]);
    let soltarVieja: (r: ReporteClientesNuevos) => void = () => {};
    let soltarNueva: (r: ReporteClientesNuevos) => void = () => {};
    obtener
      .mockResolvedValueOnce(REPORTE)
      .mockImplementationOnce(() => new Promise((r) => { soltarVieja = r; }))
      .mockImplementationOnce(() => new Promise((r) => { soltarNueva = r; }));
    const u = userEvent.setup();
    render(<PantallaClientesNuevos sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    await screen.findByRole("table", { name: "Clientes nuevos" });
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByText("Actualizando…")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    await act(async () => { soltarNueva({ ...REPORTE, clientes: [REPORTE.clientes[0]], total: 1 }); });
    await act(async () => { soltarVieja(REPORTE); });
    expect(screen.getByText("1 cliente nuevo")).toBeInTheDocument();
    expect(screen.queryByText("Abarrotes Cerrado (dado de baja)")).not.toBeInTheDocument();
    expect(screen.queryByText("Actualizando…")).not.toBeInTheDocument();
  });

  it("exporta lo consultado con la sucursal del usuario atado", async () => {
    mockAuth([PERMISO], "TJ");
    const u = userEvent.setup();
    render(<PantallaClientesNuevos sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    await screen.findByRole("table", { name: "Clientes nuevos" });
    await u.click(screen.getByRole("button", { name: "Exportar a Excel" }));
    expect(exportarExcel).toHaveBeenCalledWith(rcn.definicionExcelClientesNuevos(REPORTE, { sucursal: "TJ" }));
  });
});
```

Run: `npm test --workspace=apps/portal -- pantalla-clientes-nuevos` → FAIL.

- [ ] **Step 2: Tabla**

`tabla-clientes-nuevos.tsx`:

```tsx
import { formatearFecha } from "@/lib/reportes";
import { nombreConBaja, type ClienteNuevo } from "@/lib/reporte-clientes-nuevos";

/*
 * Una sola tabla `table-fixed` (T-51), con lo aprendido en T-49: letra de 13 px,
 * el mismo relleno en toda celda y anchos que caben desde 1366 px de ventana
 * (Cliente es la columna flexible). Textos largos se cortan con `title`.
 */
const TH = "sticky top-0 bg-background px-2 py-2 font-medium shadow-[inset_0_-1px_0_var(--border)]";
const TD = "px-2 py-1.5";

function Texto({ valor }: { valor: string | null }) {
  const texto = valor ?? "—";
  return (
    <td className={`${TD} truncate`} title={valor ?? undefined}>
      {texto}
    </td>
  );
}

export function TablaClientesNuevos({ clientes }: { clientes: ClienteNuevo[] }) {
  return (
    <div className="w-0 min-w-full max-h-[70vh] overflow-auto rounded-md border">
      <table aria-label="Clientes nuevos" className="w-full min-w-[60rem] table-fixed text-[13px]">
        <colgroup>
          <col className="w-26" />
          <col />
          <col className="w-18" />
          <col className="w-32" />
          <col className="w-30" />
          <col className="w-28" />
          <col className="w-36" />
          <col className="w-36" />
        </colgroup>
        <thead className="text-left">
          <tr>
            <th className={TH}>Fecha de alta</th>
            <th className={TH}>Cliente</th>
            <th className={TH}>Sucursal</th>
            <th className={TH}>Tipo de negocio</th>
            <th className={TH}>Lista de precios</th>
            <th className={TH}>Teléfono</th>
            <th className={TH}>Encargado</th>
            <th className={TH}>Usuario</th>
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => (
            <tr key={c.id} className="border-t">
              <td className={TD}>{formatearFecha(c.fechaAlta)}</td>
              <Texto valor={nombreConBaja(c)} />
              <td className={TD}>{c.sucursalCodigo}</td>
              <Texto valor={c.tipoNegocio} />
              <Texto valor={c.listaPrecio} />
              <td className={TD}>{c.telefono}</td>
              <Texto valor={c.encargado} />
              <Texto valor={c.usuario} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

(Los anchos son provisionales: el controlador los mide en el navegador en la Tarea 6 y, si hace falta, ajusta.)

- [ ] **Step 3: Pantalla, página y lista de reportes**

`pantalla-clientes-nuevos.tsx`:

```tsx
"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { mensajeDe } from "@/lib/api";
import { exportarExcel } from "@/lib/excel/exportar";
import {
  definicionExcelClientesNuevos,
  obtenerReporteClientesNuevos,
  textoTotalClientes,
  type ReporteClientesNuevos,
} from "@/lib/reporte-clientes-nuevos";
import { rangoMes, rangoSemana } from "@/lib/reporte-ventas";
import { etiquetaSucursal, formatearFecha, primerDiaDelMes } from "@/lib/reportes";
import { hoyEnTijuana } from "@/lib/ventas";
import { TablaClientesNuevos } from "./tabla-clientes-nuevos";

interface Consultado {
  reporte: ReporteClientesNuevos;
  sucursal: string;
}

/**
 * Información → Reportes → Clientes nuevos (T-51). La página la monta con
 * `key={sucursal}`: cambiar la sucursal empieza limpio.
 */
export function PantallaClientesNuevos({ sucursal }: { sucursal: string | null }) {
  const { puede, usuario, cargando: cargandoSesion } = useAuth();
  const [desde, setDesde] = useState(() => primerDiaDelMes(hoyEnTijuana()));
  const [hasta, setHasta] = useState(() => hoyEnTijuana());
  const [consultado, setConsultado] = useState<Consultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Solo la última consulta escribe.
  const ultima = useRef(0);

  const titulo = (
    <CardHeader>
      <CardTitle>Clientes nuevos</CardTitle>
    </CardHeader>
  );

  if (cargandoSesion) {
    return (
      <Card>
        {titulo}
        <CardContent>
          <p className="text-sm text-muted-foreground">Cargando…</p>
        </CardContent>
      </Card>
    );
  }

  if (!puede("reportes.ver")) {
    return (
      <Card>
        {titulo}
        <CardContent>
          <p className="text-sm text-muted-foreground">No tienes permiso para ver reportes</p>
        </CardContent>
      </Card>
    );
  }

  function aplicar(r: { desde: string; hasta: string }) {
    setDesde(r.desde);
    setHasta(r.hasta);
  }

  async function alMostrar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (desde > hasta) {
      setError("La fecha inicial no puede ser posterior a la final.");
      return;
    }
    const esta = ++ultima.current;
    setCargando(true);
    try {
      const reporte = await obtenerReporteClientesNuevos({ desde, hasta, sucursal });
      if (esta !== ultima.current) return;
      setConsultado({ reporte, sucursal: etiquetaSucursal(usuario?.sucursal?.codigo ?? null, sucursal) });
    } catch (err) {
      if (esta !== ultima.current) return;
      setConsultado(null);
      setError(mensajeDe(err, "No se pudo consultar el reporte."));
    } finally {
      if (esta === ultima.current) setCargando(false);
    }
  }

  async function alExportar() {
    if (!consultado) return;
    setError(null);
    setExportando(true);
    try {
      await exportarExcel(definicionExcelClientesNuevos(consultado.reporte, { sucursal: consultado.sucursal }));
    } catch {
      setError("No se pudo generar el Excel.");
    } finally {
      setExportando(false);
    }
  }

  const hoy = hoyEnTijuana();
  const reporte = consultado?.reporte ?? null;
  const hayClientes = reporte !== null && reporte.clientes.length > 0;
  const actualizando = cargando && consultado !== null;

  return (
    <Card>
      {titulo}
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={alMostrar} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cn-desde" className="text-sm font-medium">Desde</label>
            <input id="cn-desde" type="date" required value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-md border px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cn-hasta" className="text-sm font-medium">Hasta</label>
            <input id="cn-hasta" type="date" required value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-md border px-3 py-2 text-sm" />
          </div>
          <div className="flex items-end gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => aplicar({ desde: hoy, hasta: hoy })}>Hoy</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => aplicar(rangoSemana(hoy))}>Esta semana</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => aplicar(rangoMes(hoy))}>Este mes</Button>
          </div>
          {/* Siempre activo: la guarda `ultima` descarta lo viejo. */}
          <Button type="submit">Mostrar</Button>
          <Button type="button" variant="outline" disabled={!hayClientes || exportando || cargando} onClick={() => void alExportar()}>
            Exportar a Excel
          </Button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        )}

        {cargando && !consultado && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {actualizando && <p className="text-sm text-muted-foreground">Actualizando…</p>}

        {consultado && reporte &&
          (hayClientes ? (
            <div aria-busy={actualizando} className={`flex flex-col gap-3 ${actualizando ? "opacity-60" : ""}`}>
              <p className="text-sm text-muted-foreground">
                {`Del ${formatearFecha(reporte.desde)} al ${formatearFecha(reporte.hasta)} · Sucursal: ${consultado.sucursal}`}
              </p>
              <p className="text-sm font-medium">{textoTotalClientes(reporte.total)}</p>
              <TablaClientesNuevos clientes={reporte.clientes} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No hay clientes nuevos en ese rango.</p>
          ))}
      </CardContent>
    </Card>
  );
}
```

`app/(portal)/informacion/reportes/clientes-nuevos/page.tsx`:

```tsx
import { PantallaClientesNuevos } from "@/components/reportes/pantalla-clientes-nuevos";

// `key`: cambiar la sucursal del selector global vuelve a montar la pantalla.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaClientesNuevos key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
```

`components/reportes/lista-reportes.tsx`: agregar, después del `<li>` de Kilometraje:

```tsx
            <li>
              <Link href={`/informacion/reportes/clientes-nuevos${consulta}`} className="font-medium underline">
                Clientes nuevos
              </Link>
              <p className="text-sm text-muted-foreground">
                Clientes dados de alta (o convertidos de prospecto) en un rango, con el usuario que los dio de alta. Exportable a Excel.
              </p>
            </li>
```

y actualizar el comentario de cabecera de ese archivo (ya hay Kilometraje y Clientes nuevos). Si `lista-reportes.test.tsx` cuenta enlaces, agrega la aserción del nuevo.

- [ ] **Step 4: Correr, probar RED de la guarda y commit**

Run: `npm test --workspace=apps/portal -- pantalla-clientes-nuevos lista-reportes` → PASS.

Comenta temporalmente las dos líneas `if (esta !== ultima.current) return;` (con `python3` o un editor, no `sed` de macOS), confirma que la prueba de la consulta vieja **falla**, restáuralas y confirma verde. Anota ambas salidas. No hagas commit de la versión rota.

Run: `npm test --workspace=apps/portal && npm run lint --workspace=apps/portal && npm run build --workspace=apps/portal` → todo en verde, salida limpia.

```bash
git add apps/portal/src/components/reportes "apps/portal/src/app/(portal)/informacion/reportes/clientes-nuevos"
git commit -m "T-51: pantalla Información → Reportes → Clientes nuevos"
```

---

### Tarea 6: Verificación completa y prueba a mano (controlador)

- [ ] **Step 1:** Desde la raíz: pgTAP, lint + build + unit + e2e del backend, lint + build + test del portal. Todo en verde; anotar conteos.
- [ ] **Step 2:** Navegador contra la base **local** (backend `PORT=3010` con `DATABASE_URL` de `.env.test`; portal con `NEXT_PUBLIC_API_URL=http://localhost:3010`): dar de alta un cliente desde el portal y convertir un prospecto (ver su Usuario en el reporte), un cliente dado de baja, nombres largos; **medir la tabla a 1366 y 1440 px** (sin scroll lateral, sin celdas desbordadas) y ajustar anchos si hace falta; Excel abierto con `exceljs`; usuario sin `reportes.ver`. Capturas.

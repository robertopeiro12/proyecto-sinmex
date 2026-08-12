# T-10 · Catálogo de Productos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar de alta, editar y dar de baja productos con sus presentaciones desde el portal, y extraer de paso los componentes de catálogo que van a reutilizar T-11, T-62 y T-12.

**Architecture:** Backend NestJS con módulo en `modules/inventario/` (slug del vault), guardado atómico con `Kysely.transaction()`, y la lógica de reconciliación de presentaciones aislada en una **función pura** para poder probarla sin base de datos —igual que `alcance-sucursal.ts` de T-09—. En el portal, piezas compartidas (hook + tabla + plomería de formulario) más un envoltorio `<PantallaCatalogo>`; Sucursales se reescribe encima como validación de que la abstracción sirve.

**Tech Stack:** NestJS · Kysely · Postgres (Supabase) · pgTAP · Jest (backend) · Next.js 15 App Router · React 19 · Tailwind v4 · shadcn/ui · **Vitest + Testing Library (nuevo en el portal)**

**Spec:** `docs/superpowers/specs/2026-08-11-t10-catalogo-productos-design.md` — las decisiones se citan como D1…D10.

## Global Constraints

- **Rama:** `feature/t-10-productos` (ya creada, con el spec commiteado). Base `main`, sin pila.
- **Idioma del código:** identificadores, comentarios y mensajes de error **en español**, sin acentos en los identificadores. Los comentarios explican *por qué*, no *qué*.
- **Todo comando se corre desde la raíz del repo** con `--workspace=`, nunca entrando a `apps/*`.
- **`npm test`, `npm run test:e2e` y `supabase test db` exigen el stack local arriba:** Docker Desktop corriendo + `npm run supabase start`. En esta máquina **no hay Colima**.
- **Nunca apuntar a `sinmex dev` durante la implementación.** `.env.test` va al Postgres local.
- **La baja siempre es lógica**, nunca `delete` físico (D1).
- **`deleted_at` jamás se expone en una respuesta de la API** (convención de T-09).
- **Conteo de pruebas de partida, verificado corriendo la suite en la línea base del worktree (2026-08-11):** **83 pgTAP · 116 unitarias · 128 e2e · 0 en el portal.** Este es el conteo real (`Tests: N passed, N total` de Jest) — un `grep` anterior de este mismo plan había estimado 108/121 y se quedó corto porque no captura `it.each` ni bloques `describe` anidados. **Los conteos "esperados" que aparecen en los pasos de las tareas siguientes heredan ese error de +8/+7 y no son fiables.** Verifica cada paso con el número real que reporte Jest/pgTAP en tu propia corrida, no con la cifra escrita en el paso.
- **La migración solo agrega índices, no columnas** → **no** hace falta correr `npm run db:types`.

---

### Task 1: Índices únicos en la base (D2)

**Files:**
- Create: `supabase/migrations/20260811170000_producto_unicidad.sql`
- Test: `supabase/tests/94_producto_unicidad_test.sql`

**Interfaces:**
- Consumes: nada.
- Produces: los índices `uq_producto_nombre` y `uq_presentacion_volumen`. El servicio de la Task 3 depende de que una violación levante el `SQLSTATE 23505`.

- [ ] **Step 1: Verificar que la tabla está vacía antes de tocarla**

```bash
npm run supabase -- start
npm run supabase -- db reset --local
psql "$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" -c \
  "select count(*) as productos from producto;"
```

Esperado: `productos = 0`. Si no es 0, **detente**: la migración puede fallar sobre datos existentes y hay que decidir qué hacer con los duplicados antes de seguir.

- [ ] **Step 2: Escribir la prueba pgTAP que falla**

Crea `supabase/tests/94_producto_unicidad_test.sql`:

```sql
begin;
select plan(5);

-- Producto de referencia para las pruebas de presentacion.
insert into producto (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Jamaica de prueba');

select throws_ok(
  $$insert into producto (nombre) values ('Jamaica de prueba')$$,
  '23505',
  null,
  'rechaza un producto con el mismo nombre'
);

-- 'lower()' en el indice: dos filas que solo difieren en mayusculas son el
-- mismo sabor para cualquier persona que mire el catalogo.
select throws_ok(
  $$insert into producto (nombre) values ('JAMAICA DE PRUEBA')$$,
  '23505',
  null,
  'trata distinta capitalizacion como duplicado'
);

insert into presentacion (producto_id, volumen)
  values ('11111111-1111-1111-1111-111111111111', '500 ml');

select throws_ok(
  $$insert into presentacion (producto_id, volumen)
    values ('11111111-1111-1111-1111-111111111111', '500 ml')$$,
  '23505',
  null,
  'rechaza el mismo volumen repetido dentro de un producto'
);

-- El unique es por (producto_id, volumen), no global: casi todos los sabores
-- se venden en 500 ml.
insert into producto (id, nombre) values
  ('22222222-2222-2222-2222-222222222222', 'Horchata de prueba');

select lives_ok(
  $$insert into presentacion (producto_id, volumen)
    values ('22222222-2222-2222-2222-222222222222', '500 ml')$$,
  'acepta el mismo volumen en dos productos distintos'
);

-- El 'where deleted_at is null' del indice: sin el, dar de baja un volumen lo
-- bloquearia para siempre y el catalogo no se podria reactivar.
update presentacion set deleted_at = now()
  where producto_id = '11111111-1111-1111-1111-111111111111'
    and volumen = '500 ml';

select lives_ok(
  $$insert into presentacion (producto_id, volumen)
    values ('11111111-1111-1111-1111-111111111111', '500 ml')$$,
  'acepta recrear un volumen que se dio de baja'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Correrla y verificar que falla**

```bash
npm run supabase -- test db
```

Esperado: las 3 pruebas de `throws_ok` fallan (`23505` nunca se levanta porque todavía no hay índices). Las 2 de `lives_ok` pasan por accidente — eso está bien, son las que protegen contra pasarse de restrictivo.

- [ ] **Step 4: Escribir la migración**

Crea `supabase/migrations/20260811170000_producto_unicidad.sql`:

```sql
-- T-05 creo `producto` y `presentacion` sin ninguna restriccion de unicidad, y
-- la base aceptaba dos "Jamaica" o dos "500 ml" del mismo producto. Va en la
-- base y no solo en el DTO por la misma razon que el check del codigo de
-- sucursal (T-09) y el unique del folio (T-14): las semillas y los scripts de
-- alta entran por debajo de la API. Un producto duplicado no se queda quieto,
-- se propaga a la tablet por el pull de T-07 y al inventario.

-- `lower()`: "Jamaica" y "jamaica" son el mismo sabor.
-- `where deleted_at is null`: la baja es logica (ver ADR/spec D1). Sin este
-- filtro, dar de baja un producto reservaria su nombre para siempre.
create unique index uq_producto_nombre
  on producto (lower(nombre))
  where deleted_at is null;

-- Por producto, no global: casi todos los sabores existen en 500 ml.
create unique index uq_presentacion_volumen
  on presentacion (producto_id, lower(volumen))
  where deleted_at is null;
```

- [ ] **Step 5: Aplicarla y verificar que las 5 pruebas pasan**

```bash
npm run supabase -- db reset --local
npm run supabase -- test db
```

Esperado: **88 pruebas en verde** (83 previas + 5). Si alguna de las dos `lives_ok` se cayó, el índice quedó de más (te faltó el `where` o el `producto_id`).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260811170000_producto_unicidad.sql \
        supabase/tests/94_producto_unicidad_test.sql
git commit -m "T-10 · Unicidad de producto y presentacion en la base"
```

---

### Task 2: `reconciliarPresentaciones()` — función pura (D6, D8)

Aislar la lógica del `PATCH` en una función sin base de datos, igual que T-09 hizo con `resolverAlcance()`. Es donde está toda la sutileza, y así se prueba en milisegundos sin Postgres.

**Files:**
- Create: `apps/backend/src/modules/inventario/reconciliar-presentaciones.ts`
- Test: `apps/backend/src/modules/inventario/reconciliar-presentaciones.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  ```ts
  export interface PresentacionExistente { id: string; volumen: string }
  export interface PresentacionPedida { id?: string; volumen: string }
  export interface PlanPresentaciones {
    insertar: { volumen: string }[];
    actualizar: { id: string; volumen: string }[];
    darDeBaja: string[];
  }
  export class ReconciliacionInvalida extends Error {}
  export function reconciliarPresentaciones(
    existentes: PresentacionExistente[],
    pedidas: PresentacionPedida[],
  ): PlanPresentaciones
  ```
  La Task 4 la usa dentro de la transacción del `PATCH`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `apps/backend/src/modules/inventario/reconciliar-presentaciones.spec.ts`:

```ts
import {
  ReconciliacionInvalida,
  reconciliarPresentaciones,
} from './reconciliar-presentaciones';

const EXISTENTE_A = { id: 'aaaaaaaa-0000-0000-0000-000000000001', volumen: '500 ml' };
const EXISTENTE_B = { id: 'bbbbbbbb-0000-0000-0000-000000000002', volumen: '1 Litro' };

describe('reconciliarPresentaciones', () => {
  it('inserta las filas que llegan sin id', () => {
    const plan = reconciliarPresentaciones([], [{ volumen: '500 ml' }]);

    expect(plan.insertar).toEqual([{ volumen: '500 ml' }]);
    expect(plan.actualizar).toEqual([]);
    expect(plan.darDeBaja).toEqual([]);
  });

  it('actualiza las filas que llegan con id conocido', () => {
    const plan = reconciliarPresentaciones(
      [EXISTENTE_A],
      [{ id: EXISTENTE_A.id, volumen: '600 ml' }],
    );

    expect(plan.actualizar).toEqual([{ id: EXISTENTE_A.id, volumen: '600 ml' }]);
    expect(plan.insertar).toEqual([]);
    expect(plan.darDeBaja).toEqual([]);
  });

  it('da de baja las existentes que el payload no menciona', () => {
    const plan = reconciliarPresentaciones(
      [EXISTENTE_A, EXISTENTE_B],
      [{ id: EXISTENTE_A.id, volumen: '500 ml' }],
    );

    expect(plan.darDeBaja).toEqual([EXISTENTE_B.id]);
  });

  it('no marca como actualizacion una fila cuyo volumen no cambio', () => {
    const plan = reconciliarPresentaciones(
      [EXISTENTE_A],
      [{ id: EXISTENTE_A.id, volumen: '500 ml' }],
    );

    // Un update que no cambia nada mueve `updated_at`, y el pull de T-07 es
    // incremental: la tablet se bajaria la fila entera sin motivo.
    expect(plan.actualizar).toEqual([]);
  });

  it('combina alta, edicion y baja en una sola pasada', () => {
    const plan = reconciliarPresentaciones(
      [EXISTENTE_A, EXISTENTE_B],
      [{ id: EXISTENTE_A.id, volumen: '600 ml' }, { volumen: '2 Litros' }],
    );

    expect(plan.actualizar).toEqual([{ id: EXISTENTE_A.id, volumen: '600 ml' }]);
    expect(plan.insertar).toEqual([{ volumen: '2 Litros' }]);
    expect(plan.darDeBaja).toEqual([EXISTENTE_B.id]);
  });

  it('rechaza un id que no pertenece a este producto', () => {
    // Sin esta comprobacion el update no encontraria la fila y el PATCH
    // respondería 200 habiendo ignorado en silencio lo que le pidieron.
    expect(() =>
      reconciliarPresentaciones([EXISTENTE_A], [{ id: EXISTENTE_B.id, volumen: 'x' }]),
    ).toThrow(ReconciliacionInvalida);
  });

  it('rechaza dos volumenes iguales dentro del mismo payload', () => {
    // El unique de la base tambien lo atraparia, pero como 23505 generico. Aqui
    // se puede decir cual es el volumen repetido.
    expect(() =>
      reconciliarPresentaciones([], [{ volumen: '500 ml' }, { volumen: '500 ml' }]),
    ).toThrow(ReconciliacionInvalida);
  });

  it('trata distinta capitalizacion y espacios como el mismo volumen', () => {
    expect(() =>
      reconciliarPresentaciones([], [{ volumen: '500 ML' }, { volumen: ' 500 ml ' }]),
    ).toThrow(ReconciliacionInvalida);
  });

  it('rechaza quedarse sin ninguna presentacion', () => {
    expect(() => reconciliarPresentaciones([EXISTENTE_A], [])).toThrow(
      ReconciliacionInvalida,
    );
  });

  it('permite reusar un volumen que la misma peticion da de baja', () => {
    // Quitar "500 ml" y agregarlo de nuevo en el mismo guardado: el volumen
    // libre no debe chocar consigo mismo. Ojo: sale con id NUEVO, y eso es
    // justo el cabo suelto que el spec le deja anotado a T-18.
    const plan = reconciliarPresentaciones([EXISTENTE_A], [{ volumen: '500 ml' }]);

    expect(plan.darDeBaja).toEqual([EXISTENTE_A.id]);
    expect(plan.insertar).toEqual([{ volumen: '500 ml' }]);
  });
});
```

- [ ] **Step 2: Correrlas y verificar que fallan**

```bash
npm test --workspace=apps/backend -- reconciliar-presentaciones
```

Esperado: FAIL — `Cannot find module './reconciliar-presentaciones'`.

- [ ] **Step 3: Implementar la función**

Crea `apps/backend/src/modules/inventario/reconciliar-presentaciones.ts`:

```ts
/**
 * El PATCH de un producto recibe la lista COMPLETA de presentaciones que el
 * usuario quiere (D6), no una secuencia de operaciones. Esta funcion compara
 * esa lista contra lo que hay guardado y devuelve el plan a ejecutar.
 *
 * Es pura a proposito: aqui esta toda la sutileza del ticket y no necesita
 * base de datos para probarse, igual que `alcance-sucursal.ts` de T-09.
 */

export interface PresentacionExistente {
  id: string;
  volumen: string;
}

export interface PresentacionPedida {
  id?: string;
  volumen: string;
}

export interface PlanPresentaciones {
  insertar: { volumen: string }[];
  actualizar: { id: string; volumen: string }[];
  /** Ids a los que se les pone `deleted_at`. Nunca se borra fisico (D1). */
  darDeBaja: string[];
}

/** El servicio la traduce a 400: es culpa del cuerpo que mandaron. */
export class ReconciliacionInvalida extends Error {}

/**
 * Misma normalizacion que el indice unico de la base
 * (`lower(volumen)`), mas el recorte de espacios que hace el DTO. Si las dos
 * normalizaciones se separan, la base rechazaria con un 23505 generico algo
 * que esta funcion dejo pasar.
 */
const normalizar = (volumen: string): string => volumen.trim().toLowerCase();

export function reconciliarPresentaciones(
  existentes: PresentacionExistente[],
  pedidas: PresentacionPedida[],
): PlanPresentaciones {
  if (pedidas.length === 0) {
    throw new ReconciliacionInvalida(
      'El producto debe tener al menos una presentación.',
    );
  }

  const vistos = new Set<string>();
  for (const pedida of pedidas) {
    const clave = normalizar(pedida.volumen);
    if (vistos.has(clave)) {
      throw new ReconciliacionInvalida(
        `La presentación "${pedida.volumen.trim()}" está repetida.`,
      );
    }
    vistos.add(clave);
  }

  const porId = new Map(existentes.map((e) => [e.id, e]));
  const plan: PlanPresentaciones = {
    insertar: [],
    actualizar: [],
    darDeBaja: [],
  };
  const conservados = new Set<string>();

  for (const pedida of pedidas) {
    const volumen = pedida.volumen.trim();

    if (pedida.id === undefined) {
      plan.insertar.push({ volumen });
      continue;
    }

    const existente = porId.get(pedida.id);
    if (!existente) {
      throw new ReconciliacionInvalida(
        'Una de las presentaciones no pertenece a este producto.',
      );
    }

    conservados.add(existente.id);
    // Un update que no cambia nada mueve `updated_at`, y el pull de T-07 es
    // incremental: la tablet se bajaria la fila sin motivo.
    if (normalizar(existente.volumen) !== normalizar(volumen)) {
      plan.actualizar.push({ id: existente.id, volumen });
    }
  }

  for (const existente of existentes) {
    if (!conservados.has(existente.id)) {
      plan.darDeBaja.push(existente.id);
    }
  }

  return plan;
}
```

- [ ] **Step 4: Correrlas y verificar que pasan**

```bash
npm test --workspace=apps/backend -- reconciliar-presentaciones
```

Esperado: **10 pruebas en verde**.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/inventario/reconciliar-presentaciones.ts \
        apps/backend/src/modules/inventario/reconciliar-presentaciones.spec.ts
git commit -m "T-10 · Reconciliacion de presentaciones como funcion pura"
```

---

### Task 3: `GET` y `POST /productos` (D3, D4, D5, D7)

**Files:**
- Modify: `apps/backend/src/modules/inventario/inventario.module.ts`
- Create: `apps/backend/src/modules/inventario/productos.repository.ts`
- Create: `apps/backend/src/modules/inventario/productos.service.ts`
- Create: `apps/backend/src/modules/inventario/productos.controller.ts`
- Create: `apps/backend/src/modules/inventario/dto/crear-producto.dto.ts`
- Test: `apps/backend/test/productos.e2e-spec.ts`

**Interfaces:**
- Consumes: `DB_CONNECTION`/`Database` de `src/database/database.tokens`, `@RequierePermiso` de `src/modules/auth/requiere-permiso.decorator`, y `reconciliarPresentaciones` / `ReconciliacionInvalida` de la Task 2 (el alta es su caso degenerado: nada existente, todo se inserta).
- Produces:
  ```ts
  export interface Presentacion { id: string; volumen: string }
  export interface Producto {
    id: string; nombre: string; activo: boolean; presentaciones: Presentacion[];
  }
  class ProductosRepository {
    listar(): Promise<Producto[]>
    buscarPorId(id: string): Promise<Producto | undefined>
    crear(nombre: string, volumenes: string[]): Promise<Producto>
  }
  ```
  La Task 4 le agrega `actualizar()`. La Task 7 consume la forma JSON de `Producto`.

- [ ] **Step 1: Escribir las pruebas e2e que fallan**

Crea `apps/backend/test/productos.e2e-spec.ts`. Sigue el molde de `sucursales.e2e-spec.ts`: sufijo con `Date.now()` en los logins y limpieza en `afterAll`, porque la suite corre contra un Postgres compartido entre archivos.

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { DB_CONNECTION, type Database } from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';

interface PresentacionRespuesta {
  id: string;
  volumen: string;
}
interface ProductoRespuesta {
  id: string;
  nombre: string;
  activo: boolean;
  presentaciones: PresentacionRespuesta[];
}

const SUFIJO = Date.now();
const LOGIN_ADMIN = `e2e-prod-adm-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-prod-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';

// Prefijo reservado: la limpieza de afterAll borra por `nombre like`. Sin el,
// una corrida que deje basura envenena la siguiente con 409 inesperados.
const PREFIJO = `ZZ-e2e-${SUFIJO}`;

describe('Productos (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let usuarioIds: string[] = [];
  let cookieAdmin: string;
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
   * Crea un usuario con el perfil indicado. `Administrador General` recibe el
   * catalogo completo de permisos por diseño (D1 de T-08a); los otros 5
   * perfiles estan VACIOS hasta T-08b, asi que sirven como "usuario sin
   * permiso" sin tener que montar nada.
   */
  const crearUsuario = async (login: string, perfil: string): Promise<void> => {
    const hash = await app.get(PasswordService).hashear(PASSWORD);
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', perfil)
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('usuario')
      .values({ login, nombre: login, password_hash: hash, perfil_id: perfilId })
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

    await crearUsuario(LOGIN_ADMIN, 'Administrador General');
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo');
    cookieAdmin = await iniciarSesion(LOGIN_ADMIN);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    const ids = await db
      .selectFrom('producto')
      .select('id')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    const productoIds = ids.map((f) => f.id);
    if (productoIds.length > 0) {
      await db.deleteFrom('presentacion').where('producto_id', 'in', productoIds).execute();
      await db.deleteFrom('producto').where('id', 'in', productoIds).execute();
    }
    if (usuarioIds.length > 0) {
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await app.close();
  });

  it('crea un producto con sus presentaciones', async () => {
    const res = await request(app.getHttpServer())
      .post('/productos')
      .set('Cookie', cookieAdmin)
      .send({
        nombre: `${PREFIJO} Jamaica`,
        presentaciones: [{ volumen: '500 ml' }, { volumen: '1 Litro' }],
      })
      .expect(201);

    const producto = res.body as ProductoRespuesta;
    expect(producto.nombre).toBe(`${PREFIJO} Jamaica`);
    expect(producto.activo).toBe(true);
    expect(producto.presentaciones.map((p) => p.volumen).sort()).toEqual([
      '1 Litro',
      '500 ml',
    ]);
    expect(producto).not.toHaveProperty('deleted_at');
  });

  it('lista los productos con sus presentaciones', async () => {
    await request(app.getHttpServer())
      .post('/productos')
      .set('Cookie', cookieAdmin)
      .send({ nombre: `${PREFIJO} Horchata`, presentaciones: [{ volumen: '355 ml' }] })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/productos')
      .set('Cookie', cookieAdmin)
      .expect(200);

    const productos = res.body as ProductoRespuesta[];
    const horchata = productos.find((p) => p.nombre === `${PREFIJO} Horchata`);
    expect(horchata?.presentaciones).toHaveLength(1);
  });

  // Defiende D5: si alguien le pone el candado al GET, Ventas e Inventario se
  // quedan sin catalogo.
  it('deja listar aunque el usuario no tenga producto.gestionar', async () => {
    await request(app.getHttpServer())
      .get('/productos')
      .set('Cookie', cookieSinPermiso)
      .expect(200);
  });

  it('rechaza crear sin el permiso producto.gestionar', async () => {
    await request(app.getHttpServer())
      .post('/productos')
      .set('Cookie', cookieSinPermiso)
      .send({ nombre: `${PREFIJO} Prohibida`, presentaciones: [{ volumen: '500 ml' }] })
      .expect(403);
  });

  it('rechaza un nombre duplicado con 409', async () => {
    const cuerpo = {
      nombre: `${PREFIJO} Tamarindo`,
      presentaciones: [{ volumen: '500 ml' }],
    };
    await request(app.getHttpServer())
      .post('/productos').set('Cookie', cookieAdmin).send(cuerpo).expect(201);

    await request(app.getHttpServer())
      .post('/productos').set('Cookie', cookieAdmin).send(cuerpo).expect(409);
  });

  it('rechaza un nombre duplicado que solo cambia en mayusculas', async () => {
    await request(app.getHttpServer())
      .post('/productos')
      .set('Cookie', cookieAdmin)
      .send({ nombre: `${PREFIJO} Limonada`, presentaciones: [{ volumen: '500 ml' }] })
      .expect(201);

    await request(app.getHttpServer())
      .post('/productos')
      .set('Cookie', cookieAdmin)
      .send({ nombre: `${PREFIJO} LIMONADA`, presentaciones: [{ volumen: '500 ml' }] })
      .expect(409);
  });

  it('rechaza un producto sin presentaciones con 400', async () => {
    await request(app.getHttpServer())
      .post('/productos')
      .set('Cookie', cookieAdmin)
      .send({ nombre: `${PREFIJO} Vacia`, presentaciones: [] })
      .expect(400);
  });

  // El volumen repetido se atrapa en el servicio, ANTES de tocar la base, asi
  // que esta prueba no ejercita la transaccion: comprueba que un 400 no deja
  // rastro. La transaccion (D7) sigue haciendo falta como ultima linea —el
  // unique de la base es quien de verdad decide y dos peticiones concurrentes
  // pueden colarse por la ventana entre la validacion y el insert— pero eso no
  // se puede provocar desde una prueba e2e secuencial, y fingir que si seria
  // peor que no probarlo.
  it('un alta rechazada no deja el producto a medias', async () => {
    await request(app.getHttpServer())
      .post('/productos')
      .set('Cookie', cookieAdmin)
      .send({
        nombre: `${PREFIJO} Atomica`,
        presentaciones: [{ volumen: '500 ml' }, { volumen: '500 ml' }],
      })
      .expect(400);

    const res = await request(app.getHttpServer())
      .get('/productos').set('Cookie', cookieAdmin).expect(200);
    const productos = res.body as ProductoRespuesta[];
    expect(productos.find((p) => p.nombre === `${PREFIJO} Atomica`)).toBeUndefined();
  });

  it('rechaza un token de la app de tablet', async () => {
    await request(app.getHttpServer())
      .get('/productos')
      .set('Authorization', 'Bearer no-soy-un-token-del-portal')
      .expect(401);
  });
});
```

- [ ] **Step 2: Correrlas y verificar que fallan**

```bash
npm run test:e2e --workspace=apps/backend -- productos
```

Esperado: FAIL — todas con 404, la ruta `/productos` no existe.

- [ ] **Step 3: Escribir el repositorio**

Crea `apps/backend/src/modules/inventario/productos.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

export interface Presentacion {
  id: string;
  volumen: string;
}

export interface Producto {
  id: string;
  nombre: string;
  activo: boolean;
  presentaciones: Presentacion[];
}

@Injectable()
export class ProductosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * Devuelve productos activos E inactivos: la pantalla del catalogo necesita
   * ver uno desactivado para poder reactivarlo (mismo criterio que
   * SucursalesRepository.listar de T-09). Las presentaciones dadas de baja NO
   * vuelven: su baja es `deleted_at` y esa si es definitiva (D1).
   *
   * Sin filtro por sucursal a proposito: el catalogo de sabores es de la
   * empresa, lo que varia por sucursal es el precio (D4).
   */
  async listar(): Promise<Producto[]> {
    const productos = await this.db
      .selectFrom('producto')
      .select(['id', 'nombre', 'activo'])
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .execute();

    if (productos.length === 0) return [];

    const presentaciones = await this.db
      .selectFrom('presentacion')
      .select(['id', 'producto_id', 'volumen'])
      .where('deleted_at', 'is', null)
      .where(
        'producto_id',
        'in',
        productos.map((p) => p.id),
      )
      .orderBy('volumen')
      .execute();

    // Una sola consulta para todas las presentaciones y se agrupan en memoria:
    // son decenas de filas, no vale la pena una consulta por producto.
    const porProducto = new Map<string, Presentacion[]>();
    for (const fila of presentaciones) {
      const lista = porProducto.get(fila.producto_id) ?? [];
      lista.push({ id: fila.id, volumen: fila.volumen });
      porProducto.set(fila.producto_id, lista);
    }

    return productos.map((p) => ({
      ...p,
      presentaciones: porProducto.get(p.id) ?? [],
    }));
  }

  async buscarPorId(id: string): Promise<Producto | undefined> {
    const producto = await this.db
      .selectFrom('producto')
      .select(['id', 'nombre', 'activo'])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (!producto) return undefined;

    const presentaciones = await this.db
      .selectFrom('presentacion')
      .select(['id', 'volumen'])
      .where('producto_id', '=', id)
      .where('deleted_at', 'is', null)
      .orderBy('volumen')
      .execute();

    return { ...producto, presentaciones };
  }

  /**
   * Primera transaccion del backend. El producto y sus presentaciones entran
   * juntos o no entra ninguno: un producto sin presentaciones no se puede
   * vender ni poner precio (D7, D8).
   */
  async crear(nombre: string, volumenes: string[]): Promise<Producto> {
    return this.db.transaction().execute(async (trx) => {
      const producto = await trx
        .insertInto('producto')
        .values({ nombre })
        .returning(['id', 'nombre', 'activo'])
        .executeTakeFirstOrThrow();

      const presentaciones = await trx
        .insertInto('presentacion')
        .values(volumenes.map((volumen) => ({ producto_id: producto.id, volumen })))
        .returning(['id', 'volumen'])
        .execute();

      return { ...producto, presentaciones };
    });
  }
}
```

- [ ] **Step 4: Escribir el servicio**

Crea `apps/backend/src/modules/inventario/productos.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  ReconciliacionInvalida,
  reconciliarPresentaciones,
} from './reconciliar-presentaciones';
import { ProductosRepository, type Producto } from './productos.repository';
import type { CrearProductoDto } from './dto/crear-producto.dto';

/**
 * `23505` es unique_violation. Se mira DESPUES del insert en vez de consultar
 * antes si el nombre existe: una consulta previa deja una ventana entre el
 * SELECT y el INSERT, y el unique de la base es quien de verdad decide. Mismo
 * criterio que SucursalesService (T-09).
 */
function esDuplicado(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

@Injectable()
export class ProductosService {
  constructor(private readonly repo: ProductosRepository) {}

  async listar(): Promise<Producto[]> {
    return this.repo.listar();
  }

  async crear(dto: CrearProductoDto): Promise<Producto> {
    // El alta es el caso degenerado de la reconciliacion: no hay nada
    // existente, asi que todo lo pedido es un alta. Se reusa la misma funcion
    // en vez de escribir una segunda validacion de volumenes repetidos, que es
    // como las dos acaban divergiendo.
    let plan;
    try {
      plan = reconciliarPresentaciones([], dto.presentaciones);
    } catch (error) {
      if (error instanceof ReconciliacionInvalida) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    try {
      return await this.repo.crear(
        dto.nombre,
        plan.insertar.map((p) => p.volumen),
      );
    } catch (error) {
      if (esDuplicado(error)) {
        throw new ConflictException(
          `Ya existe un producto llamado "${dto.nombre}".`,
        );
      }
      throw error;
    }
  }
}
```

- [ ] **Step 5: Escribir el DTO**

Crea `apps/backend/src/modules/inventario/dto/crear-producto.dto.ts`:

```ts
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class PresentacionDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'La descripción del volumen es obligatoria.' })
  // La columna es `text` (sin limite). El tope vive aqui por la misma razon
  // que en CrearSucursalDto: un campo sin cota en algo que se pinta en una
  // tabla es una invitacion a meter un documento entero.
  @MaxLength(40, { message: 'El volumen no puede pasar de 40 caracteres.' })
  volumen!: string;
}

export class CrearProductoDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del producto es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;

  // `ArrayMinSize(1)` es donde vive D8 para el alta: un producto sin
  // presentaciones no se puede vender ni poner precio. En el PATCH la misma
  // regla la hace cumplir `reconciliarPresentaciones`.
  @IsArray()
  @ArrayMinSize(1, {
    message: 'El producto debe tener al menos una presentación.',
  })
  @ValidateNested({ each: true })
  @Type(() => PresentacionDto)
  presentaciones!: PresentacionDto[];
}
```

- [ ] **Step 6: Escribir el controller**

Crea `apps/backend/src/modules/inventario/productos.controller.ts`:

```ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { CrearProductoDto } from './dto/crear-producto.dto';
import { ProductosService } from './productos.service';
import type { Producto } from './productos.repository';

// Sin @Publico(): el guard global protege todo por defecto. Crear exige
// `producto.gestionar` (sembrado desde T-05, grupo General). Listar NO lo
// exige a proposito: el catalogo de sabores lo van a necesitar Ventas,
// Inventario y Cartera, no solo quien administra el catalogo (D5).
//
// Tampoco lleva `?sucursal=`: el catalogo es de la empresa y `resolverAlcance()`
// no aplica (D4). No es un olvido.
@Controller('productos')
export class ProductosController {
  constructor(private readonly productos: ProductosService) {}

  @Get()
  async listar(): Promise<Producto[]> {
    return this.productos.listar();
  }

  @Post()
  @RequierePermiso('producto.gestionar')
  async crear(@Body() dto: CrearProductoDto): Promise<Producto> {
    return this.productos.crear(dto);
  }
}
```

- [ ] **Step 7: Llenar el módulo**

Reemplaza `apps/backend/src/modules/inventario/inventario.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ProductosController } from './productos.controller';
import { ProductosRepository } from './productos.repository';
import { ProductosService } from './productos.service';

// Productos vive aqui y no en un `modules/productos/` nuevo: el CLAUDE.md fija
// que los modulos usan los slugs del vault, y `Producto.md` declara
// `modulo: inventario` (D3).
@Module({
  controllers: [ProductosController],
  providers: [ProductosService, ProductosRepository],
})
export class InventarioModule {}
```

`InventarioModule` **ya está registrado** en `app.module.ts` desde T-02. No hay que tocarlo.

- [ ] **Step 8: Correr las e2e y verificar que pasan**

```bash
npm run test:e2e --workspace=apps/backend -- productos
```

Esperado: **10 pruebas en verde**.

- [ ] **Step 9: Correr la suite completa para no haber roto nada**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
```

Esperado: lint 0 errores · build limpio · 118 unitarias · 131 e2e.

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/modules/inventario apps/backend/test/productos.e2e-spec.ts
git commit -m "T-10 · GET y POST /productos con guardado atomico"
```

---

### Task 4: `PATCH /productos/:id` (D6, D8)

**Files:**
- Modify: `apps/backend/src/modules/inventario/productos.repository.ts`
- Modify: `apps/backend/src/modules/inventario/productos.service.ts`
- Modify: `apps/backend/src/modules/inventario/productos.controller.ts`
- Create: `apps/backend/src/modules/inventario/dto/editar-producto.dto.ts`
- Test: `apps/backend/test/productos.e2e-spec.ts` (agregar casos)

**Interfaces:**
- Consumes: `reconciliarPresentaciones()` de la Task 2, `ProductosRepository` de la Task 3.
- Produces: `ProductosRepository.actualizar(id, cambios, plan): Promise<Producto>`.

- [ ] **Step 1: Agregar las pruebas e2e que fallan**

Añade dentro del `describe` de `apps/backend/test/productos.e2e-spec.ts`:

```ts
  describe('PATCH', () => {
    /** Crea un producto y devuelve su cuerpo, para no repetirlo en cada caso. */
    const crearProducto = async (
      nombre: string,
      volumenes: string[],
    ): Promise<ProductoRespuesta> => {
      const res = await request(app.getHttpServer())
        .post('/productos')
        .set('Cookie', cookieAdmin)
        .send({ nombre, presentaciones: volumenes.map((volumen) => ({ volumen })) })
        .expect(201);
      return res.body as ProductoRespuesta;
    };

    it('cambia el nombre y conserva las presentaciones', async () => {
      const producto = await crearProducto(`${PREFIJO} Pat1`, ['500 ml']);

      const res = await request(app.getHttpServer())
        .patch(`/productos/${producto.id}`)
        .set('Cookie', cookieAdmin)
        .send({
          nombre: `${PREFIJO} Pat1 renombrada`,
          presentaciones: producto.presentaciones.map((p) => ({
            id: p.id,
            volumen: p.volumen,
          })),
        })
        .expect(200);

      const actualizado = res.body as ProductoRespuesta;
      expect(actualizado.nombre).toBe(`${PREFIJO} Pat1 renombrada`);
      expect(actualizado.presentaciones).toHaveLength(1);
    });

    it('agrega una presentacion nueva sin tocar las existentes', async () => {
      const producto = await crearProducto(`${PREFIJO} Pat2`, ['500 ml']);

      const res = await request(app.getHttpServer())
        .patch(`/productos/${producto.id}`)
        .set('Cookie', cookieAdmin)
        .send({
          nombre: producto.nombre,
          presentaciones: [
            { id: producto.presentaciones[0].id, volumen: '500 ml' },
            { volumen: '1 Litro' },
          ],
        })
        .expect(200);

      const actualizado = res.body as ProductoRespuesta;
      expect(actualizado.presentaciones.map((p) => p.volumen).sort()).toEqual([
        '1 Litro',
        '500 ml',
      ]);
      // La existente conserva su id: no se recreo.
      expect(actualizado.presentaciones.some((p) => p.id === producto.presentaciones[0].id))
        .toBe(true);
    });

    it('da de baja la presentacion que el payload omite', async () => {
      const producto = await crearProducto(`${PREFIJO} Pat3`, ['500 ml', '1 Litro']);
      const sobrevive = producto.presentaciones.find((p) => p.volumen === '500 ml')!;

      const res = await request(app.getHttpServer())
        .patch(`/productos/${producto.id}`)
        .set('Cookie', cookieAdmin)
        .send({
          nombre: producto.nombre,
          presentaciones: [{ id: sobrevive.id, volumen: '500 ml' }],
        })
        .expect(200);

      expect((res.body as ProductoRespuesta).presentaciones).toHaveLength(1);
    });

    // D1: la baja es logica. Un borrado fisico haria que la fila desaparezca
    // del pull incremental de T-07 y la tablet se la quedaria para siempre.
    it('la baja de una presentacion es logica, no fisica', async () => {
      const producto = await crearProducto(`${PREFIJO} Pat4`, ['500 ml', '1 Litro']);
      const sobrevive = producto.presentaciones.find((p) => p.volumen === '500 ml')!;
      const quitada = producto.presentaciones.find((p) => p.volumen === '1 Litro')!;

      await request(app.getHttpServer())
        .patch(`/productos/${producto.id}`)
        .set('Cookie', cookieAdmin)
        .send({
          nombre: producto.nombre,
          presentaciones: [{ id: sobrevive.id, volumen: '500 ml' }],
        })
        .expect(200);

      const fila = await db
        .selectFrom('presentacion')
        .select(['id', 'deleted_at'])
        .where('id', '=', quitada.id)
        .executeTakeFirst();

      expect(fila).toBeDefined();
      expect(fila?.deleted_at).not.toBeNull();
    });

    it('desactiva un producto sin tocar sus presentaciones', async () => {
      const producto = await crearProducto(`${PREFIJO} Pat5`, ['500 ml']);

      const res = await request(app.getHttpServer())
        .patch(`/productos/${producto.id}`)
        .set('Cookie', cookieAdmin)
        .send({
          nombre: producto.nombre,
          activo: false,
          presentaciones: [
            { id: producto.presentaciones[0].id, volumen: '500 ml' },
          ],
        })
        .expect(200);

      const actualizado = res.body as ProductoRespuesta;
      expect(actualizado.activo).toBe(false);
      expect(actualizado.presentaciones).toHaveLength(1);
    });

    it('rechaza quedarse sin presentaciones con 400', async () => {
      const producto = await crearProducto(`${PREFIJO} Pat6`, ['500 ml']);

      await request(app.getHttpServer())
        .patch(`/productos/${producto.id}`)
        .set('Cookie', cookieAdmin)
        .send({ nombre: producto.nombre, presentaciones: [] })
        .expect(400);
    });

    it('rechaza una presentacion de otro producto con 400', async () => {
      const uno = await crearProducto(`${PREFIJO} Pat7a`, ['500 ml']);
      const otro = await crearProducto(`${PREFIJO} Pat7b`, ['1 Litro']);

      await request(app.getHttpServer())
        .patch(`/productos/${uno.id}`)
        .set('Cookie', cookieAdmin)
        .send({
          nombre: uno.nombre,
          presentaciones: [{ id: otro.presentaciones[0].id, volumen: '1 Litro' }],
        })
        .expect(400);
    });

    it('rechaza renombrar a un nombre que ya existe con 409', async () => {
      await crearProducto(`${PREFIJO} Pat8a`, ['500 ml']);
      const otro = await crearProducto(`${PREFIJO} Pat8b`, ['500 ml']);

      await request(app.getHttpServer())
        .patch(`/productos/${otro.id}`)
        .set('Cookie', cookieAdmin)
        .send({
          nombre: `${PREFIJO} Pat8a`,
          presentaciones: [{ id: otro.presentaciones[0].id, volumen: '500 ml' }],
        })
        .expect(409);
    });

    it('rechaza editar sin el permiso producto.gestionar', async () => {
      const producto = await crearProducto(`${PREFIJO} Pat9`, ['500 ml']);

      await request(app.getHttpServer())
        .patch(`/productos/${producto.id}`)
        .set('Cookie', cookieSinPermiso)
        .send({
          nombre: `${PREFIJO} Pat9 hackeada`,
          presentaciones: [{ id: producto.presentaciones[0].id, volumen: '500 ml' }],
        })
        .expect(403);
    });

    it('responde 404 con un id que no existe', async () => {
      await request(app.getHttpServer())
        .patch('/productos/99999999-9999-9999-9999-999999999999')
        .set('Cookie', cookieAdmin)
        .send({ nombre: `${PREFIJO} Fantasma`, presentaciones: [{ volumen: '500 ml' }] })
        .expect(404);
    });

    it('responde 400 con un id mal formado', async () => {
      await request(app.getHttpServer())
        .patch('/productos/no-soy-un-uuid')
        .set('Cookie', cookieAdmin)
        .send({ nombre: `${PREFIJO} Malformada`, presentaciones: [{ volumen: '500 ml' }] })
        .expect(400);
    });
  });
```

- [ ] **Step 2: Correrlas y verificar que fallan**

```bash
npm run test:e2e --workspace=apps/backend -- productos
```

Esperado: los 11 casos nuevos fallan con 404 (no hay handler de `PATCH`).

- [ ] **Step 3: Escribir el DTO de edición**

Crea `apps/backend/src/modules/inventario/dto/editar-producto.dto.ts`:

```ts
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class PresentacionEditadaDto {
  // Sin id = alta. Con id = la fila que ya existe. Quien no aparezca en la
  // lista se da de baja (D6).
  @IsOptional()
  @IsUUID()
  id?: string;

  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'La descripción del volumen es obligatoria.' })
  @MaxLength(40, { message: 'El volumen no puede pasar de 40 caracteres.' })
  volumen!: string;
}

export class EditarProductoDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del producto es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  // Sin `ArrayMinSize` aqui a proposito: la lista vacia tiene que llegar a
  // `reconciliarPresentaciones` para que el mensaje de error sea el mismo que
  // el de "te quedaste sin presentaciones", en vez de dos textos distintos
  // segun por donde entres.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PresentacionEditadaDto)
  presentaciones!: PresentacionEditadaDto[];
}
```

- [ ] **Step 4: Agregar `actualizar()` al repositorio**

Añade a `apps/backend/src/modules/inventario/productos.repository.ts` (importa `PlanPresentaciones` de `./reconciliar-presentaciones`):

```ts
  /**
   * Aplica el plan que calculo `reconciliarPresentaciones` mas los cambios del
   * producto, todo en una transaccion (D7): si una presentacion revienta por
   * el unique, no puede quedar el nombre cambiado y las filas a medias.
   */
  async actualizar(
    id: string,
    cambios: { nombre: string; activo?: boolean },
    plan: PlanPresentaciones,
  ): Promise<Producto> {
    return this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('producto')
        .set(cambios)
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

      for (const fila of plan.actualizar) {
        await trx
          .updateTable('presentacion')
          .set({ volumen: fila.volumen })
          .where('id', '=', fila.id)
          .execute();
      }

      if (plan.darDeBaja.length > 0) {
        // Baja logica, nunca `delete` (D1): un borrado fisico desaparece del
        // pull incremental y la tablet se queda la fila para siempre.
        await trx
          .updateTable('presentacion')
          .set({ deleted_at: new Date() })
          .where('id', 'in', plan.darDeBaja)
          .execute();
      }

      if (plan.insertar.length > 0) {
        await trx
          .insertInto('presentacion')
          .values(plan.insertar.map((p) => ({ producto_id: id, volumen: p.volumen })))
          .execute();
      }

      const producto = await trx
        .selectFrom('producto')
        .select(['id', 'nombre', 'activo'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

      const presentaciones = await trx
        .selectFrom('presentacion')
        .select(['id', 'volumen'])
        .where('producto_id', '=', id)
        .where('deleted_at', 'is', null)
        .orderBy('volumen')
        .execute();

      return { ...producto, presentaciones };
    });
  }
```

> El orden importa: **primero las bajas, después las altas**. Al revés, reusar en el mismo guardado un volumen que se está quitando choca contra el índice único, que solo ignora las filas con `deleted_at`.

- [ ] **Step 5: Agregar `editar()` al servicio**

Añade a `apps/backend/src/modules/inventario/productos.service.ts` (importa `NotFoundException`, `reconciliarPresentaciones` y `EditarProductoDto`):

```ts
  async editar(id: string, dto: EditarProductoDto): Promise<Producto> {
    const producto = await this.repo.buscarPorId(id);
    if (!producto) {
      throw new NotFoundException('No existe ese producto.');
    }

    let plan;
    try {
      plan = reconciliarPresentaciones(producto.presentaciones, dto.presentaciones);
    } catch (error) {
      // Lista vacia, id ajeno o volumen repetido: los tres son un cuerpo mal
      // armado, no un choque con lo que ya existe. 400, no 409.
      if (error instanceof ReconciliacionInvalida) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const cambios: { nombre: string; activo?: boolean } = { nombre: dto.nombre };
    if (dto.activo !== undefined) {
      cambios.activo = dto.activo;
    }

    try {
      return await this.repo.actualizar(id, cambios, plan);
    } catch (error) {
      if (esDuplicado(error)) {
        throw new ConflictException(
          `Ya existe un producto llamado "${dto.nombre}".`,
        );
      }
      throw error;
    }
  }
```

- [ ] **Step 6: Agregar el handler al controller**

Añade a `apps/backend/src/modules/inventario/productos.controller.ts` (importa `Param`, `ParseUUIDPipe`, `Patch` y `EditarProductoDto`):

```ts
  @Patch(':id')
  @RequierePermiso('producto.gestionar')
  async editar(
    // ParseUUIDPipe convierte un id mal formado en 400. Sin el, la cadena
    // llegaria a Postgres y saldria como 500 (mismo motivo que en T-09).
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarProductoDto,
  ): Promise<Producto> {
    return this.productos.editar(id, dto);
  }
```

- [ ] **Step 7: Correr las e2e y verificar que pasan**

```bash
npm run test:e2e --workspace=apps/backend -- productos
```

Esperado: **21 pruebas en verde** (10 de la Task 3 + 11 nuevas).

- [ ] **Step 8: Correr todo el backend**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
```

Esperado: 118 unitarias · 142 e2e · lint y build limpios.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/inventario apps/backend/test/productos.e2e-spec.ts
git commit -m "T-10 · PATCH /productos con reconciliacion de presentaciones"
```

---

### Task 5: Piezas compartidas del catálogo + infraestructura de pruebas del portal (D9)

**Files:**
- Modify: `apps/portal/package.json`
- Create: `apps/portal/vitest.config.ts`
- Create: `apps/portal/vitest.setup.ts`
- Create: `apps/portal/src/components/catalogo/use-catalogo.ts`
- Create: `apps/portal/src/components/catalogo/tabla-catalogo.tsx`
- Create: `apps/portal/src/components/catalogo/use-envio-formulario.ts`
- Modify: `.github/workflows/portal-ci.yml`
- Test: `apps/portal/src/components/catalogo/use-catalogo.test.tsx`
- Test: `apps/portal/src/components/catalogo/tabla-catalogo.test.tsx`
- Test: `apps/portal/src/components/catalogo/use-envio-formulario.test.tsx`

**Interfaces:**
- Consumes: `ErrorApi` de `@/lib/api`.
- Produces:
  ```ts
  export type Edicion<T> = T | "nueva" | null;
  export function useCatalogo<T>(
    cargar: () => Promise<T[]>,
    opciones: { mensajeError: string; deps?: unknown[] },
  ): {
    items: T[]; cargando: boolean; error: string | null; edicion: Edicion<T>;
    abrirAlta: () => void; abrirEdicion: (item: T) => void; cerrar: () => void;
    recargar: () => Promise<void>;
  };

  export interface Columna<T> { encabezado: string; celda: (item: T) => ReactNode; className?: string }
  export function TablaCatalogo<T extends { id: string }>(props: {
    items: T[]; columnas: Columna<T>[]; vacio: string; acciones?: (item: T) => ReactNode;
  }): JSX.Element;

  export function useEnvioFormulario(mensajeFallback: string): {
    enviando: boolean; error: string | null;
    enviar: (accion: () => Promise<unknown>, alTerminar: () => void) => Promise<void>;
  };
  ```
  Las Tasks 6 y 7 las consumen.

- [ ] **Step 1: Instalar las dependencias de prueba**

```bash
npm install --workspace=apps/portal --save-dev \
  vitest@^3 @vitejs/plugin-react@^5 jsdom@^26 \
  @testing-library/react@^16 @testing-library/dom@^10 \
  @testing-library/jest-dom@^6 @testing-library/user-event@^14
```

- [ ] **Step 2: Configurar Vitest**

Crea `apps/portal/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Solo lo compartido: las pantallas concretas no tienen pruebas todavia
    // (ver el spec, "Fuera, a proposito").
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
```

Crea `apps/portal/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Añade el script a `apps/portal/package.json`:

```jsonc
"scripts": {
  "dev": "next dev --turbopack -p 3001",
  "build": "next build --turbopack",
  "start": "next start -p 3001",
  "lint": "eslint",
  "test": "vitest run"
}
```

- [ ] **Step 3: Escribir las pruebas de `useCatalogo` que fallan**

Crea `apps/portal/src/components/catalogo/use-catalogo.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCatalogo } from "./use-catalogo";

interface Fila {
  id: string;
  nombre: string;
}

const UNA_FILA: Fila[] = [{ id: "1", nombre: "Jamaica" }];

describe("useCatalogo", () => {
  it("carga los items al montar", async () => {
    const cargar = vi.fn().mockResolvedValue(UNA_FILA);

    const { result } = renderHook(() =>
      useCatalogo<Fila>(cargar, { mensajeError: "No se pudo." }),
    );

    expect(result.current.cargando).toBe(true);
    await waitFor(() => expect(result.current.cargando).toBe(false));
    expect(result.current.items).toEqual(UNA_FILA);
    expect(result.current.error).toBeNull();
  });

  it("expone el mensaje de error cuando la carga falla", async () => {
    const cargar = vi.fn().mockRejectedValue(new Error("red caida"));

    const { result } = renderHook(() =>
      useCatalogo<Fila>(cargar, { mensajeError: "No se pudieron cargar." }),
    );

    await waitFor(() => expect(result.current.error).toBe("No se pudieron cargar."));
    expect(result.current.items).toEqual([]);
    expect(result.current.cargando).toBe(false);
  });

  /**
   * El trampa que se lleva por delante a cualquiera que use el hook: si
   * `cargar` va inline (`() => listarProductos()`), cambia de identidad en cada
   * render. Metido tal cual en las deps del useEffect, eso es un bucle
   * infinito de peticiones. El hook lo guarda en un ref.
   */
  it("no recarga cuando `cargar` cambia de identidad en cada render", async () => {
    const espia = vi.fn().mockResolvedValue(UNA_FILA);

    const { result, rerender } = renderHook(() =>
      useCatalogo<Fila>(() => espia(), { mensajeError: "No se pudo." }),
    );

    await waitFor(() => expect(result.current.cargando).toBe(false));
    rerender();
    rerender();

    expect(espia).toHaveBeenCalledTimes(1);
  });

  it("recarga cuando cambia algo de `deps`", async () => {
    const espia = vi.fn().mockResolvedValue(UNA_FILA);
    let sucursal = "TJ";

    const { result, rerender } = renderHook(() =>
      useCatalogo<Fila>(() => espia(sucursal), {
        mensajeError: "No se pudo.",
        deps: [sucursal],
      }),
    );

    await waitFor(() => expect(result.current.cargando).toBe(false));
    sucursal = "MX";
    rerender();

    await waitFor(() => expect(espia).toHaveBeenCalledTimes(2));
    expect(espia).toHaveBeenLastCalledWith("MX");
  });

  it("abre y cierra el formulario de alta y de edicion", async () => {
    const cargar = vi.fn().mockResolvedValue(UNA_FILA);
    const { result } = renderHook(() =>
      useCatalogo<Fila>(cargar, { mensajeError: "No se pudo." }),
    );
    await waitFor(() => expect(result.current.cargando).toBe(false));

    expect(result.current.edicion).toBeNull();

    act(() => result.current.abrirAlta());
    expect(result.current.edicion).toBe("nueva");

    act(() => result.current.abrirEdicion(UNA_FILA[0]));
    expect(result.current.edicion).toEqual(UNA_FILA[0]);

    act(() => result.current.cerrar());
    expect(result.current.edicion).toBeNull();
  });

  it("limpia el error de una carga fallida al recargar con exito", async () => {
    const cargar = vi
      .fn()
      .mockRejectedValueOnce(new Error("red caida"))
      .mockResolvedValueOnce(UNA_FILA);

    const { result } = renderHook(() =>
      useCatalogo<Fila>(cargar, { mensajeError: "No se pudo." }),
    );
    await waitFor(() => expect(result.current.error).toBe("No se pudo."));

    await act(async () => {
      await result.current.recargar();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.items).toEqual(UNA_FILA);
  });
});
```

- [ ] **Step 4: Correrlas y verificar que fallan**

```bash
npm test --workspace=apps/portal
```

Esperado: FAIL — no existe `./use-catalogo`.

- [ ] **Step 5: Implementar `useCatalogo`**

Crea `apps/portal/src/components/catalogo/use-catalogo.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** null = formulario cerrado · "nueva" = alta · un item = edicion. */
export type Edicion<T> = T | "nueva" | null;

export interface Catalogo<T> {
  items: T[];
  cargando: boolean;
  error: string | null;
  edicion: Edicion<T>;
  abrirAlta: () => void;
  abrirEdicion: (item: T) => void;
  cerrar: () => void;
  recargar: () => Promise<void>;
}

/**
 * El estado que comparten todas las pantallas de catalogo del portal: cargar,
 * mostrar el fallo, y saber si el formulario esta abierto y sobre que.
 *
 * `cargar` se guarda en un ref y NO va en las dependencias del efecto. Casi
 * todos los llamadores la pasan inline (`() => listarProductos()`), que cambia
 * de identidad en cada render; metida en las deps eso es un bucle infinito de
 * peticiones. Para recargar cuando cambie algo de verdad, usa `deps`.
 */
export function useCatalogo<T>(
  cargar: () => Promise<T[]>,
  { mensajeError, deps = [] }: { mensajeError: string; deps?: unknown[] },
): Catalogo<T> {
  const [items, setItems] = useState<T[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Edicion<T>>(null);

  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;

  const recargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setItems(await cargarRef.current());
    } catch {
      // Un 401 aqui ya lo maneja apiFetch (refresca) y AuthProvider (rebota al
      // login). Lo que queda son fallos de red o 5xx, y para esos lo unico
      // honesto es decir que no se pudo cargar.
      setError(mensajeError);
    } finally {
      setCargando(false);
    }
  }, [mensajeError]);

  useEffect(() => {
    void recargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recargar, ...deps]);

  return {
    items,
    cargando,
    error,
    edicion,
    abrirAlta: useCallback(() => setEdicion("nueva"), []),
    abrirEdicion: useCallback((item: T) => setEdicion(item), []),
    cerrar: useCallback(() => setEdicion(null), []),
    recargar,
  };
}
```

- [ ] **Step 6: Correr y verificar que pasan**

```bash
npm test --workspace=apps/portal
```

Esperado: **6 pruebas en verde**.

- [ ] **Step 7: Escribir las pruebas de `TablaCatalogo` que fallan**

Crea `apps/portal/src/components/catalogo/tabla-catalogo.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TablaCatalogo } from "./tabla-catalogo";

interface Fila {
  id: string;
  nombre: string;
  activo: boolean;
}

const FILAS: Fila[] = [
  { id: "1", nombre: "Jamaica", activo: true },
  { id: "2", nombre: "Horchata", activo: false },
];

const COLUMNAS = [
  { encabezado: "Nombre", celda: (f: Fila) => f.nombre },
  { encabezado: "Estado", celda: (f: Fila) => (f.activo ? "Activo" : "Inactivo") },
];

describe("TablaCatalogo", () => {
  it("pinta un encabezado por columna", () => {
    render(<TablaCatalogo items={FILAS} columnas={COLUMNAS} vacio="Nada." />);

    expect(screen.getByRole("columnheader", { name: "Nombre" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Estado" })).toBeInTheDocument();
  });

  it("pinta una fila por item, con la celda que define cada columna", () => {
    render(<TablaCatalogo items={FILAS} columnas={COLUMNAS} vacio="Nada." />);

    expect(screen.getByText("Jamaica")).toBeInTheDocument();
    expect(screen.getByText("Inactivo")).toBeInTheDocument();
    // +1 por la fila de encabezados.
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("muestra el mensaje de vacio cuando no hay items", () => {
    render(<TablaCatalogo items={[]} columnas={COLUMNAS} vacio="No hay productos." />);

    expect(screen.getByText("No hay productos.")).toBeInTheDocument();
  });

  it("pinta la columna de acciones solo cuando se le pasa", () => {
    const { rerender } = render(
      <TablaCatalogo items={FILAS} columnas={COLUMNAS} vacio="Nada." />,
    );
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();

    rerender(
      <TablaCatalogo
        items={FILAS}
        columnas={COLUMNAS}
        vacio="Nada."
        acciones={() => <button>Editar</button>}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Editar" })).toHaveLength(2);
  });
});
```

- [ ] **Step 8: Correrlas, verificar que fallan, e implementar `TablaCatalogo`**

```bash
npm test --workspace=apps/portal
```

Esperado: FAIL — no existe `./tabla-catalogo`.

Crea `apps/portal/src/components/catalogo/tabla-catalogo.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";

export interface Columna<T> {
  encabezado: string;
  celda: (item: T) => ReactNode;
  className?: string;
}

interface Props<T> {
  items: T[];
  columnas: Columna<T>[];
  /** Que decir cuando no hay nada. Cada catalogo lo dice a su manera. */
  vacio: string;
  /** Los botones por fila. Se omite cuando el usuario no puede gestionar. */
  acciones?: (item: T) => ReactNode;
}

/**
 * La tabla que comparten las pantallas de catalogo. Generica sobre `T` para
 * que `celda` reciba el item ya tipado y no un `any`.
 */
export function TablaCatalogo<T extends { id: string }>({
  items,
  columnas,
  vacio,
  acciones,
}: Props<T>) {
  const totalColumnas = columnas.length + (acciones ? 1 : 0);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          {columnas.map((columna) => (
            <th key={columna.encabezado} className="py-2 font-medium">
              {columna.encabezado}
            </th>
          ))}
          {acciones && <th className="py-2" />}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-b last:border-0">
            {columnas.map((columna) => (
              <td key={columna.encabezado} className={`py-2 ${columna.className ?? ""}`}>
                {columna.celda(item)}
              </td>
            ))}
            {acciones && <td className="py-2 text-right">{acciones(item)}</td>}
          </tr>
        ))}
        {items.length === 0 && (
          <tr>
            <td colSpan={totalColumnas} className="py-4 text-muted-foreground">
              {vacio}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 9: Escribir las pruebas de `useEnvioFormulario` que fallan**

Crea `apps/portal/src/components/catalogo/use-envio-formulario.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { ErrorApi } from "@/lib/api";
import { useEnvioFormulario } from "./use-envio-formulario";

describe("useEnvioFormulario", () => {
  it("llama a alTerminar cuando la accion sale bien", async () => {
    const { result } = renderHook(() => useEnvioFormulario("No se pudo guardar."));
    const alTerminar = vi.fn();

    await act(async () => {
      await result.current.enviar(() => Promise.resolve(), alTerminar);
    });

    expect(alTerminar).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    expect(result.current.enviando).toBe(false);
  });

  /**
   * El mensaje del servidor se muestra tal cual cuando existe: el 409 dice
   * exactamente que nombre esta repetido y el 400 dice que campo fallo. Es
   * mucho mas util que un texto generico.
   */
  it("muestra el mensaje del servidor cuando llega un ErrorApi", async () => {
    const { result } = renderHook(() => useEnvioFormulario("No se pudo guardar."));

    await act(async () => {
      await result.current.enviar(
        () =>
          Promise.reject(
            // Firma real: ErrorApi(message, status, mensajeApi?).
            new ErrorApi(
              "La peticion a /productos fallo",
              409,
              'Ya existe un producto llamado "Jamaica".',
            ),
          ),
        vi.fn(),
      );
    });

    expect(result.current.error).toBe('Ya existe un producto llamado "Jamaica".');
  });

  it("cae al mensaje de respaldo si el ErrorApi no trae mensajeApi", async () => {
    const { result } = renderHook(() => useEnvioFormulario("No se pudo guardar."));

    await act(async () => {
      await result.current.enviar(
        () => Promise.reject(new ErrorApi("La peticion fallo", 500)),
        vi.fn(),
      );
    });

    // Un 500 no trae cuerpo legible: ahi si toca el texto generico del catalogo.
    expect(result.current.error).toBe("No se pudo guardar.");
  });

  it("usa el mensaje de respaldo cuando el fallo no es del servidor", async () => {
    const { result } = renderHook(() => useEnvioFormulario("No se pudo guardar."));

    await act(async () => {
      await result.current.enviar(() => Promise.reject(new TypeError("fetch failed")), vi.fn());
    });

    expect(result.current.error).toBe(
      "No se pudo conectar con el servidor. Intenta de nuevo.",
    );
  });

  it("no llama a alTerminar cuando la accion falla", async () => {
    const { result } = renderHook(() => useEnvioFormulario("No se pudo guardar."));
    const alTerminar = vi.fn();

    await act(async () => {
      await result.current.enviar(() => Promise.reject(new Error("x")), alTerminar);
    });

    expect(alTerminar).not.toHaveBeenCalled();
  });

  it("marca enviando mientras la accion esta en vuelo", async () => {
    const { result } = renderHook(() => useEnvioFormulario("No se pudo guardar."));
    let resolver: () => void = () => {};
    const enVuelo = new Promise<void>((r) => {
      resolver = r;
    });

    act(() => {
      void result.current.enviar(() => enVuelo, vi.fn());
    });

    await waitFor(() => expect(result.current.enviando).toBe(true));

    await act(async () => {
      resolver();
      await enVuelo;
    });

    expect(result.current.enviando).toBe(false);
  });
});
```

> La firma de `ErrorApi` está verificada contra `apps/portal/src/lib/api.ts:11`:
> `constructor(message: string, status: number, mensajeApi?: string)`. **No cambies `api.ts`.**

- [ ] **Step 10: Implementar `useEnvioFormulario`**

Crea `apps/portal/src/components/catalogo/use-envio-formulario.ts`:

```ts
"use client";

import { useCallback, useState } from "react";
import { ErrorApi } from "@/lib/api";

/**
 * La plomeria que rodea a los campos de cualquier formulario de catalogo:
 * el "Guardando…", el mensaje de error y la traduccion de ErrorApi.
 *
 * Los CAMPOS no se abstraen (D9): sucursal tiene un codigo de 2 letras de solo
 * lectura y producto una lista dinamica de presentaciones. Un motor generico de
 * formularios seria peor que copiar.
 */
export function useEnvioFormulario(mensajeFallback: string) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = useCallback(
    async (accion: () => Promise<unknown>, alTerminar: () => void) => {
      setError(null);
      setEnviando(true);
      try {
        await accion();
        alTerminar();
      } catch (err) {
        // El mensaje del servidor se muestra tal cual cuando existe: el 409
        // dice exactamente que esta repetido y el 400 que campo fallo.
        setError(
          err instanceof ErrorApi
            ? (err.mensajeApi ?? mensajeFallback)
            : "No se pudo conectar con el servidor. Intenta de nuevo.",
        );
      } finally {
        setEnviando(false);
      }
    },
    [mensajeFallback],
  );

  return { enviando, error, enviar };
}
```

- [ ] **Step 11: Correr todas las pruebas del portal**

```bash
npm test --workspace=apps/portal
npm run lint --workspace=apps/portal
npm run build --workspace=apps/portal
```

Esperado: **16 pruebas en verde** (6 de `useCatalogo` + 4 de `TablaCatalogo` + 6 de `useEnvioFormulario`), lint y build limpios.

- [ ] **Step 12: Agregar el paso de pruebas al CI del portal**

Modifica `.github/workflows/portal-ci.yml`, después del paso `Lint`:

```yaml
      - name: Test
        run: npm test --workspace=apps/portal
```

- [ ] **Step 13: Commit**

```bash
git add apps/portal/package.json apps/portal/vitest.config.ts \
        apps/portal/vitest.setup.ts apps/portal/src/components/catalogo \
        .github/workflows/portal-ci.yml package-lock.json
git commit -m "T-10 · Piezas compartidas de catalogo y pruebas en el portal"
```

---

### Task 6: `<PantallaCatalogo>` y Sucursales reescrita encima (D9, D10)

La reescritura de Sucursales no es limpieza: es la prueba de que la abstracción sirve. Si no cabe, la abstracción cambia **aquí**, antes de que Productos y T-11 dependan de ella.

**Files:**
- Create: `apps/portal/src/components/catalogo/pantalla-catalogo.tsx`
- Modify: `apps/portal/src/components/sucursales/pantalla-sucursales.tsx`
- Modify: `apps/portal/src/components/sucursales/formulario-sucursal.tsx`

**Interfaces:**
- Consumes: `useCatalogo`, `TablaCatalogo`, `Columna<T>` de la Task 5.
- Produces:
  ```ts
  export function PantallaCatalogo<T extends { id: string }>(props: {
    titulo: string;
    permiso: string;
    etiquetaAlta: string;
    vacio: string;
    mensajeError: string;
    cargar: () => Promise<T[]>;
    columnas: Columna<T>[];
    formulario: (item: T | null, alGuardar: () => void, alCancelar: () => void) => ReactNode;
    deps?: unknown[];
  }): JSX.Element;
  ```
  La Task 7 la consume.

- [ ] **Step 1: Escribir `PantallaCatalogo`**

Crea `apps/portal/src/components/catalogo/pantalla-catalogo.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { TablaCatalogo, type Columna } from "./tabla-catalogo";
import { useCatalogo } from "./use-catalogo";

interface Props<T> {
  titulo: string;
  /** Clave que habilita alta y edicion, p.ej. "producto.gestionar". */
  permiso: string;
  etiquetaAlta: string;
  vacio: string;
  mensajeError: string;
  cargar: () => Promise<T[]>;
  columnas: Columna<T>[];
  formulario: (
    item: T | null,
    alGuardar: () => void,
    alCancelar: () => void,
  ) => ReactNode;
  /** Recarga cuando algo de aqui cambie. Ver useCatalogo. */
  deps?: unknown[];
}

/**
 * El envoltorio que arma una pantalla de catalogo entera. Por dentro son
 * piezas sueltas (useCatalogo + TablaCatalogo) a proposito: T-12 Clientes
 * probablemente no quepa aqui —lleva filtros, lista de precios, promocion y
 * credito— y cuando pase, baja al hook sin tener que inflar este componente
 * con props que solo usa el, ni duplicar la logica (D9).
 */
export function PantallaCatalogo<T extends { id: string }>({
  titulo,
  permiso,
  etiquetaAlta,
  vacio,
  mensajeError,
  cargar,
  columnas,
  formulario,
  deps = [],
}: Props<T>) {
  const { puede } = useAuth();
  const puedeGestionar = puede(permiso);
  const catalogo = useCatalogo<T>(cargar, { mensajeError, deps });

  const alGuardar = () => {
    catalogo.cerrar();
    void catalogo.recargar();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{titulo}</CardTitle>
        {puedeGestionar && (
          <Button
            size="sm"
            disabled={catalogo.edicion !== null}
            onClick={catalogo.abrirAlta}
          >
            {etiquetaAlta}
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {catalogo.edicion !== null && (
          <div
            // Sin `key` React reutiliza la misma instancia del formulario al
            // pasar de "editar A" a "editar B": sus useState solo leen el prop
            // en el primer montaje, asi que los campos se quedarian con los
            // valores viejos de A. Lo descubrio T-09 y aqui se hereda para las
            // cuatro pantallas.
            key={catalogo.edicion === "nueva" ? "nueva" : catalogo.edicion.id}
          >
            {formulario(
              catalogo.edicion === "nueva" ? null : catalogo.edicion,
              alGuardar,
              catalogo.cerrar,
            )}
          </div>
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
            columnas={columnas}
            vacio={vacio}
            acciones={
              puedeGestionar
                ? (item) => (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={catalogo.edicion !== null}
                      onClick={() => catalogo.abrirEdicion(item)}
                    >
                      Editar
                    </Button>
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

- [ ] **Step 2: Reescribir `pantalla-sucursales.tsx` encima**

Reemplaza el contenido completo de `apps/portal/src/components/sucursales/pantalla-sucursales.tsx`:

```tsx
"use client";

import { PantallaCatalogo } from "@/components/catalogo/pantalla-catalogo";
import { FormularioSucursal } from "./formulario-sucursal";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";

export function PantallaSucursales({ sucursal }: { sucursal: string | null }) {
  return (
    <PantallaCatalogo<Sucursal>
      titulo="Sucursales"
      permiso="sucursal.gestionar"
      etiquetaAlta="Nueva sucursal"
      vacio="No hay sucursales que mostrar."
      mensajeError="No se pudieron cargar las sucursales."
      cargar={() => listarSucursales(sucursal)}
      // Sucursales SI depende del selector global; Productos no lo usara (D4).
      deps={[sucursal]}
      columnas={[
        { encabezado: "Código", celda: (s) => s.codigo, className: "font-mono" },
        { encabezado: "Nombre", celda: (s) => s.nombre },
        {
          encabezado: "Estado",
          celda: (s) =>
            s.activa ? (
              "Activa"
            ) : (
              <span className="text-muted-foreground">Inactiva</span>
            ),
        },
      ]}
      formulario={(item, alGuardar, alCancelar) => (
        <FormularioSucursal
          sucursal={item}
          alGuardar={alGuardar}
          alCancelar={alCancelar}
        />
      )}
    />
  );
}
```

De 131 líneas a ~35. Si algo de Sucursales **no** cabe, para y ajusta `PantallaCatalogo` — es exactamente para lo que sirve este paso.

- [ ] **Step 3: Pasar `formulario-sucursal.tsx` a `useEnvioFormulario`**

En `apps/portal/src/components/sucursales/formulario-sucursal.tsx`, sustituye los `useState` de `error`/`enviando` y el `try/catch` de `alEnviar` por el hook. El resto del archivo (los campos) **no se toca**:

```tsx
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";

// …dentro del componente, en lugar de los useState de error y enviando:
const { enviando, error, enviar } = useEnvioFormulario(
  "No se pudo guardar la sucursal.",
);

async function alEnviar(evento: FormEvent<HTMLFormElement>) {
  evento.preventDefault();
  await enviar(
    () =>
      sucursal
        ? editarSucursal(sucursal.id, { nombre, activa })
        : crearSucursal({ codigo, nombre }),
    alGuardar,
  );
}
```

Quedan sin usar los imports de `ErrorApi` y el `useState` de esos dos campos: quítalos o el lint se queja.

- [ ] **Step 4: Verificar que el portal compila y las pruebas siguen verdes**

```bash
npm test --workspace=apps/portal
npm run lint --workspace=apps/portal
npm run build --workspace=apps/portal
```

Esperado: 16 pruebas en verde, lint y build limpios. Las de `useEnvioFormulario` cubren ahora también a Sucursales, que antes no tenía ninguna.

- [ ] **Step 5: Verificación manual de Sucursales (obligatoria)**

Sucursales **no tiene pruebas automatizadas** (deuda de T-09), así que la reescritura hay que verla funcionar. Con el backend y el portal levantados:

```bash
npm run backend   # en una terminal
npm run portal    # en otra
```

> **Ojo:** `npm run backend` usa `.env.development`, que apunta a **`sinmex dev` en la nube**, no a la base local. Lo que crees aquí se queda en la base compartida con Mario. Para trastear sin ensuciar, apunta `DATABASE_URL` de `.env.development` al Postgres local mientras tanto.

En `http://localhost:3001/catalogo/sucursales`, comprobar:
- [ ] la lista carga y muestra código, nombre y estado
- [ ] "Nueva sucursal" abre el formulario y da de alta
- [ ] "Editar" abre el formulario con los datos correctos
- [ ] **editar A, cancelar, y editar B muestra los datos de B** (es el bug del `key`)
- [ ] desactivar una sucursal y verla como "Inactiva"
- [ ] un código duplicado muestra el mensaje del 409
- [ ] el selector "Por sucursal" de la barra lateral sigue filtrando la lista

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/components
git commit -m "T-10 · PantallaCatalogo, con Sucursales reescrita encima"
```

---

### Task 7: Pantalla de Productos

**Files:**
- Create: `apps/portal/src/lib/productos.ts`
- Create: `apps/portal/src/components/productos/formulario-producto.tsx`
- Create: `apps/portal/src/components/productos/pantalla-productos.tsx`
- Modify: `apps/portal/src/app/(portal)/catalogo/productos/page.tsx`

**Interfaces:**
- Consumes: `PantallaCatalogo` (Task 6), `useEnvioFormulario` (Task 5), `apiFetch`/`ErrorApi` de `@/lib/api`, y la forma JSON de `Producto` de la Task 3.
- Produces: la ruta `/catalogo/productos` funcionando.

- [ ] **Step 1: Escribir la capa de datos**

Crea `apps/portal/src/lib/productos.ts`, siguiendo el molde de `lib/sucursales.ts`:

```ts
import { apiFetch } from "./api";

export interface Presentacion {
  id: string;
  volumen: string;
}

export interface Producto {
  id: string;
  nombre: string;
  activo: boolean;
  presentaciones: Presentacion[];
}

/**
 * Sin parametro de sucursal: el catalogo de sabores es de la empresa, lo que
 * varia por sucursal es el precio (T-18). No es un olvido.
 */
export function listarProductos(): Promise<Producto[]> {
  return apiFetch<Producto[]>("/productos");
}

export function crearProducto(datos: {
  nombre: string;
  presentaciones: { volumen: string }[];
}): Promise<Producto> {
  return apiFetch<Producto>("/productos", {
    method: "POST",
    body: JSON.stringify(datos),
  });
}

/**
 * `presentaciones` es la lista COMPLETA que debe quedar: las que llevan `id`
 * se conservan, las que no lo llevan se dan de alta, y las que no aparecen se
 * dan de baja. El servidor reconcilia (ver el contrato en el spec, D6).
 */
export function editarProducto(
  id: string,
  datos: {
    nombre: string;
    activo?: boolean;
    presentaciones: { id?: string; volumen: string }[];
  },
): Promise<Producto> {
  return apiFetch<Producto>(`/productos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(datos),
  });
}
```

- [ ] **Step 2: Escribir el formulario**

Crea `apps/portal/src/components/productos/formulario-producto.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { crearProducto, editarProducto, type Producto } from "@/lib/productos";

interface Props {
  producto: Producto | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

/** Una fila del editor. `id` ausente = presentacion nueva. */
interface FilaPresentacion {
  id?: string;
  volumen: string;
  /** Clave estable de React: las filas nuevas no tienen id de base todavia. */
  clave: string;
}

const filaVacia = (): FilaPresentacion => ({
  volumen: "",
  clave: crypto.randomUUID(),
});

export function FormularioProducto({ producto, alGuardar, alCancelar }: Props) {
  const esAlta = producto === null;
  const [nombre, setNombre] = useState(producto?.nombre ?? "");
  const [activo, setActivo] = useState(producto?.activo ?? true);
  const [filas, setFilas] = useState<FilaPresentacion[]>(
    producto?.presentaciones.map((p) => ({
      id: p.id,
      volumen: p.volumen,
      clave: p.id,
    })) ?? [filaVacia()],
  );
  const { enviando, error, enviar } = useEnvioFormulario(
    "No se pudo guardar el producto.",
  );

  const cambiarVolumen = (clave: string, volumen: string) =>
    setFilas((previas) =>
      previas.map((f) => (f.clave === clave ? { ...f, volumen } : f)),
    );

  const quitarFila = (clave: string) =>
    setFilas((previas) => previas.filter((f) => f.clave !== clave));

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();

    // Las filas en blanco se descartan en vez de mandarse: son ruido de una
    // fila recien agregada que el usuario no lleno, no un error suyo.
    const presentaciones = filas
      .map((f) => ({ id: f.id, volumen: f.volumen.trim() }))
      .filter((p) => p.volumen !== "");

    await enviar(
      () =>
        producto
          ? editarProducto(producto.id, { nombre, activo, presentaciones })
          : crearProducto({
              nombre,
              presentaciones: presentaciones.map(({ volumen }) => ({ volumen })),
            }),
      alGuardar,
    );
  }

  // El navegador no puede exigir "al menos una presentacion con texto" con
  // `required`, asi que el boton se desactiva. El servidor lo vuelve a exigir
  // igual (D8): esto es comodidad, no la regla.
  const hayAlgunVolumen = filas.some((f) => f.volumen.trim() !== "");

  return (
    <form
      onSubmit={alEnviar}
      className="mb-6 flex flex-col gap-4 rounded-md border p-4"
    >
      <h2 className="text-sm font-semibold">
        {esAlta ? "Nuevo producto" : `Editar ${producto.nombre}`}
      </h2>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="nombre" className="text-sm font-medium">
          Nombre del producto
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

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Presentaciones</legend>
        {filas.map((fila) => (
          <div key={fila.clave} className="flex items-center gap-2">
            <input
              aria-label="Descripción del volumen"
              maxLength={40}
              disabled={enviando}
              placeholder="500 ml"
              value={fila.volumen}
              onChange={(e) => cambiarVolumen(fila.clave, e.target.value)}
              className="flex-1 rounded-md border px-3 py-2 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              // Nunca dejar cero filas: el usuario se quedaria sin dónde
              // escribir y el formulario sin salida.
              disabled={enviando || filas.length === 1}
              onClick={() => quitarFila(fila.clave)}
            >
              Quitar
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={enviando}
            onClick={() => setFilas((previas) => [...previas, filaVacia()])}
          >
            Agregar presentación
          </Button>
        </div>
      </fieldset>

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
        <Button type="submit" disabled={enviando || !hayAlgunVolumen}>
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

Crea `apps/portal/src/components/productos/pantalla-productos.tsx`:

```tsx
"use client";

import { PantallaCatalogo } from "@/components/catalogo/pantalla-catalogo";
import { FormularioProducto } from "./formulario-producto";
import { listarProductos, type Producto } from "@/lib/productos";

export function PantallaProductos() {
  return (
    <PantallaCatalogo<Producto>
      titulo="Productos"
      permiso="producto.gestionar"
      etiquetaAlta="Nuevo producto"
      vacio="No hay productos que mostrar."
      mensajeError="No se pudieron cargar los productos."
      cargar={listarProductos}
      columnas={[
        { encabezado: "Nombre del producto", celda: (p) => p.nombre },
        {
          encabezado: "Presentaciones",
          celda: (p) => p.presentaciones.map((x) => x.volumen).join(", "),
        },
        {
          encabezado: "Estado",
          celda: (p) =>
            p.activo ? (
              "Activo"
            ) : (
              <span className="text-muted-foreground">Inactivo</span>
            ),
        },
      ]}
      formulario={(item, alGuardar, alCancelar) => (
        <FormularioProducto
          producto={item}
          alGuardar={alGuardar}
          alCancelar={alCancelar}
        />
      )}
    />
  );
}
```

- [ ] **Step 4: Conectar la página**

Reemplaza el contenido de `apps/portal/src/app/(portal)/catalogo/productos/page.tsx`:

```tsx
import { PantallaProductos } from "@/components/productos/pantalla-productos";

// A diferencia de la de Sucursales, esta pagina NO lee `searchParams`: el
// catalogo de sabores es de la empresa y el selector "Por sucursal" de la
// barra lateral no le aplica (D4). No es un olvido.
export default function Page() {
  return <PantallaProductos />;
}
```

(La de Sucursales sí es `async` y espera `searchParams: Promise<{ sucursal?: string }>`, porque en Next 15 esa prop es una promesa. Aquí no hace falta.)

- [ ] **Step 5: Verificar que compila**

```bash
npm run lint --workspace=apps/portal
npm run build --workspace=apps/portal
npm test --workspace=apps/portal
```

- [ ] **Step 6: Verificación manual de Productos**

Con el backend y el portal levantados, en `http://localhost:3001/catalogo/productos`:
- [ ] alta de "Jamaica" con dos presentaciones ("500 ml", "1 Litro")
- [ ] la tabla muestra las dos presentaciones separadas por coma
- [ ] editar y **agregar** una tercera presentación
- [ ] editar y **quitar** una presentación; al reabrir, ya no está
- [ ] el botón "Quitar" está deshabilitado cuando solo queda una fila
- [ ] desactivar el producto y verlo como "Inactivo"
- [ ] intentar un nombre duplicado → sale el mensaje del 409
- [ ] intentar dos veces el mismo volumen → sale el mensaje del 400
- [ ] con un usuario **sin** `producto.gestionar`, la lista se ve pero no hay botones

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/lib/productos.ts apps/portal/src/components/productos \
        "apps/portal/src/app/(portal)/catalogo/productos/page.tsx"
git commit -m "T-10 · Pantalla de Productos en el portal"
```

---

### Task 8: Cierre — verificación completa, vault e issue

**Files:**
- Modify: `../jawa-obsidian-memory/00-Inicio/Estado del proyecto.md`
- Modify: `../jawa-obsidian-memory/10-Dominio/Entidades/Producto.md`
- Create: `../jawa-obsidian-memory/40-Equipo/Bitácora/<fecha>.md`

- [ ] **Step 1: Verificación completa, de cero**

```bash
npm ci
npm run supabase -- db reset --local
npm run supabase -- test db
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm run lint --workspace=apps/portal
npm test --workspace=apps/portal
npm run build --workspace=apps/portal
```

**Apunta los números reales que salgan.** No los copies de este plan: son estimaciones, y el vault ya se quemó una vez publicando conteos que nadie verificó.

- [ ] **Step 2: Aplicar la migración a `sinmex dev`**

Primero comprobar que la tabla está vacía también allá (si no, la migración falla y hay que decidir qué hacer con los duplicados):

```bash
npm run supabase -- migration list
npm run supabase -- db push
npm run supabase -- migration list
```

`migration list` es la **única fuente confiable** del estado remoto — el vault lo dejó anotado tras T-09.

- [ ] **Step 3: Actualizar el vault**

En `Estado del proyecto.md`: fila de T-10 a ✅ con la fecha, un bloque "T-10 — detalle de lo hecho" siguiendo el formato de los anteriores, y quitar T-10 de "Próximos pasos" (T-11 y T-62 quedan desbloqueados y ahora son baratos).

En `Producto.md`: registrar que el catálogo existe, que la baja de una presentación es `deleted_at`, y el aviso de los precios huérfanos para T-18.

Bitácora del día con lo aprendido.

- [ ] **Step 4: Abrir el PR y comentar el issue #10**

El comentario del issue tiene que decir a dónde se fueron los dos criterios que no se cumplieron (precio → T-18, promoción $0 → T-16, orden por presentación → tablet). Sin eso se pierden al cerrarlo.

- [ ] **Step 5: Commit del vault**

```bash
cd ../jawa-obsidian-memory
git add -A && git commit -m "T-10 hecho: catalogo de productos y componentes de catalogo"
```

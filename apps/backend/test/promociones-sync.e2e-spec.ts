import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';
import type { Promocion } from './../src/modules/cartera-clientes/promociones.repository';
import {
  CONTRATO_ACTUAL,
  type RespuestaPull,
} from './../src/modules/sincronizacion/contrato';

/**
 * Promociones por regla (T-74) en el contrato de sincronizacion: el pull las
 * baja por sucursal y la baja viaja como bandera. La Tarea 5 amplia este
 * archivo con el push (regalos de la venta).
 *
 * Las promociones se crean por rama (TJ y MX por uuid), nunca con `todas`:
 * `sucursales.e2e-spec.ts` crea y borra sucursales en paralelo y una promocion
 * no debe caer en una sucursal transitoria.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_VENDEDOR = `e2e-psync-v-${SUFIJO}`;
const LOGIN_GENERAL = `e2e-psync-gen-${SUFIJO}`;
const PREFIJO_CLIENTE = `e2e-psync-${SUFIJO}`;
// Mayor que RETRASO_CURSOR_MS (5 s) del servicio: el cursor del pull se
// atrasa, y sin esperar, lo recien creado volveria en el pull incremental.
const ESPERA_CURSOR_MS = 5_500;

type Cuerpo = Record<string, unknown>;

describe('Promociones en la sincronizacion (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let mxId: string;
  let vendedorId: string;
  let usuarioId: string;
  let bearer: string;
  let cookieGeneral: string;
  let productoA: { id: string };
  let presentacionA: { id: string };
  // Dos de TJ y uno de MX; la Tarea 5 usa el segundo de TJ y el de MX en el push.
  let clienteTj1: string;
  let clientes: { tj2: string; mx: string };
  const promocionIds: string[] = [];

  const pull = (query: Record<string, string | number> = {}) => {
    const params = new URLSearchParams({
      contrato: String(CONTRATO_ACTUAL),
      ...Object.fromEntries(
        Object.entries(query).map(([k, v]) => [k, String(v)]),
      ),
    });
    return request(app.getHttpServer())
      .get(`/sync/pull?${params.toString()}`)
      .set('Authorization', `Bearer ${bearer}`);
  };

  const regla = (extra: Cuerpo = {}): Cuerpo => ({
    audiencia: 'todos',
    compraTipo: 'producto',
    compraProductoId: productoA.id,
    compraCantidad: 10,
    regaloTipo: 'mismo',
    regaloCantidad: 1,
    seRepite: true,
    ...extra,
  });

  const crear = async (cuerpo: Cuerpo): Promise<Promocion> => {
    const res = await request(app.getHttpServer())
      .post('/promociones')
      .set('Cookie', cookieGeneral)
      .send(cuerpo)
      .expect(201);
    const [promocion] = res.body as Promocion[];
    promocionIds.push(promocion.id);
    return promocion;
  };

  const sembrarCliente = async (
    sucursalId: string,
    n: number,
  ): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `${PREFIJO_CLIENTE}-${n}`,
        domicilio: 'Calle 1',
        telefono: '6640000000',
        tipo: 'cliente',
        lista_precio_id: lista.id,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  /** Solo las filas sembradas por esta prueba: otras suites tambien crean en TJ. */
  const mias = <T extends { id: string }>(filas: T[]): T[] =>
    filas.filter((f) => promocionIds.includes(f.id));

  // Estado compartido entre los casos, que van en orden.
  let cursor: string;
  let idTodos: string;
  let idProspecto: string;
  let idCliente: string;
  let idMexicali: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    const sucursal = async (codigo: string) =>
      (
        await db
          .selectFrom('sucursal')
          .select('id')
          .where('codigo', '=', codigo)
          .executeTakeFirstOrThrow()
      ).id;
    tjId = await sucursal('TJ');
    mxId = await sucursal('MX');

    productoA = await db
      .selectFrom('producto')
      .select('id')
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .limit(1)
      .executeTakeFirstOrThrow();
    presentacionA = await db
      .selectFrom('presentacion')
      .select('id')
      .where('producto_id', '=', productoA.id)
      .where('deleted_at', 'is', null)
      .orderBy('volumen')
      .limit(1)
      .executeTakeFirstOrThrow();

    const hash = await app.get(PasswordService).hashear(PASSWORD);
    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN_VENDEDOR,
          nombre: 'Vendedor promo sync',
          password_hash: hash,
          sucursal_id: tjId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Administrador General')
      .executeTakeFirstOrThrow();
    usuarioId = (
      await db
        .insertInto('usuario')
        .values({
          login: LOGIN_GENERAL,
          nombre: LOGIN_GENERAL,
          password_hash: hash,
          perfil_id: perfilId,
          sucursal_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const app_ = await request(app.getHttpServer())
      .post('/auth/app/login')
      .send({ login: LOGIN_VENDEDOR, password: PASSWORD })
      .expect(200);
    bearer = (app_.body as { tokenAcceso: string }).tokenAcceso;
    const portal = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN_GENERAL, password: PASSWORD })
      .expect(200);
    const cookies = portal.headers['set-cookie'] as unknown as string[];
    const acceso = cookies.find((c) => c.startsWith('jawa_access='));
    if (!acceso) throw new Error('El login no devolvio cookie de acceso.');
    cookieGeneral = acceso.split(';')[0];

    clienteTj1 = await sembrarCliente(tjId, 1);
    clientes = {
      tj2: await sembrarCliente(tjId, 2),
      mx: await sembrarCliente(mxId, 3),
    };
  });

  afterAll(async () => {
    const clientes = await db
      .selectFrom('cliente')
      .select('id')
      .where('nombre', 'like', `${PREFIJO_CLIENTE}-%`)
      .execute();
    const clienteIds = clientes.map((c) => c.id);
    const notas = db
      .selectFrom('venta_nota')
      .select('id')
      .where('vendedor_id', '=', vendedorId);
    // Orden inverso a las llaves foraneas.
    await db
      .deleteFrom('venta_nota_promocion')
      .where('venta_nota_id', 'in', notas)
      .execute();
    await db
      .deleteFrom('venta_nota_detalle')
      .where('venta_nota_id', 'in', notas)
      .execute();
    await db
      .deleteFrom('cobranza_abono')
      .where('venta_nota_id', 'in', notas)
      .execute();
    await db
      .deleteFrom('venta_nota')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    if (promocionIds.length > 0) {
      await db
        .deleteFrom('promocion')
        .where('id', 'in', promocionIds)
        .execute();
    }
    if (clienteIds.length > 0) {
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', '=', usuarioId)
      .execute();
    await db.deleteFrom('usuario').where('id', '=', usuarioId).execute();
    await app.close();
  });

  it('el vuelco completo trae las promociones de la sucursal del vendedor y no las de otra', async () => {
    idTodos = (await crear(regla({ sucursalId: tjId }))).id;
    idProspecto = (
      await crear(
        regla({
          sucursalId: tjId,
          audiencia: 'prospecto',
          compraTipo: 'presentacion',
          compraProductoId: undefined,
          compraPresentacionId: presentacionA.id,
          regaloTipo: 'presentacion',
          regaloPresentacionId: presentacionA.id,
          seRepite: false,
        }),
      )
    ).id;
    idCliente = (
      await crear(
        regla({
          sucursalId: tjId,
          audiencia: 'cliente',
          clienteId: clienteTj1,
        }),
      )
    ).id;
    idMexicali = (await crear(regla({ sucursalId: mxId }))).id;
    // Una propia de un cliente de MX tampoco baja al vendedor de TJ.
    const idClienteMx = (
      await crear(
        regla({
          sucursalId: mxId,
          audiencia: 'cliente',
          clienteId: clientes.mx,
        }),
      )
    ).id;

    await new Promise((r) => setTimeout(r, ESPERA_CURSOR_MS));
    const res = await pull().expect(200);
    const cuerpo = res.body as RespuestaPull;
    cursor = cuerpo.cursor;

    const propias = mias(cuerpo.promociones);
    expect(propias.map((p) => p.id).sort()).toEqual(
      [idTodos, idProspecto, idCliente].sort(),
    );
    expect(propias.map((p) => p.id)).not.toContain(idMexicali);
    expect(propias.map((p) => p.id)).not.toContain(idClienteMx);

    const todos = propias.find((p) => p.id === idTodos);
    expect(todos).toEqual({
      id: idTodos,
      audiencia: 'todos',
      cliente_id: null,
      compra_tipo: 'producto',
      compra_producto_id: productoA.id,
      compra_presentacion_id: null,
      compra_cantidad: 10,
      regalo_tipo: 'mismo',
      regalo_producto_id: null,
      regalo_presentacion_id: null,
      regalo_cantidad: 1,
      se_repite: true,
      activo: 1,
    });
    const prospecto = propias.find((p) => p.id === idProspecto);
    expect(prospecto).toMatchObject({
      audiencia: 'prospecto',
      compra_tipo: 'presentacion',
      compra_presentacion_id: presentacionA.id,
      regalo_tipo: 'presentacion',
      regalo_presentacion_id: presentacionA.id,
      se_repite: false,
      activo: 1,
    });
    expect(propias.find((p) => p.id === idCliente)).toMatchObject({
      audiencia: 'cliente',
      cliente_id: clienteTj1,
      activo: 1,
    });
  }, 30_000);

  it('el pull incremental trae solo la que cambio, desactivada con activo: 0', async () => {
    await request(app.getHttpServer())
      .patch(`/promociones/${idTodos}`)
      .set('Cookie', cookieGeneral)
      .send({
        compraTipo: 'producto',
        compraProductoId: productoA.id,
        compraCantidad: 10,
        regaloTipo: 'mismo',
        regaloCantidad: 1,
        seRepite: true,
        activo: false,
      })
      .expect(200);

    const res = await pull({ desde: cursor }).expect(200);
    const cuerpo = res.body as RespuestaPull;
    expect(cuerpo.completo).toBe(false);
    const propias = mias(cuerpo.promociones);
    expect(propias).toHaveLength(1);
    expect(propias[0]).toMatchObject({ id: idTodos, activo: 0 });
  });

  it('el cliente ya no trae `promocion` y trae `primera_venta_en`', async () => {
    const res = await pull().expect(200);
    const cuerpo = res.body as RespuestaPull;
    const c = cuerpo.catalogos.clientes.find((x) => x.id === clienteTj1);
    expect(c).toBeDefined();
    expect(c).toHaveProperty('primera_venta_en', null);
    expect(c).not.toHaveProperty('promocion');
  });
});

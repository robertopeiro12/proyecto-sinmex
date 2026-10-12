import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
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
import type {
  RutaAnterior,
  RutaDiaria,
} from './../src/modules/rutas/rutas-diarias.service';

/**
 * Ruta Diaria desde el portal (T-37, D14), de punta a punta: permiso, alcance,
 * reemplazo que conserva lo del vendedor, renumeracion y "anterior".
 *
 * Fechas de JUNIO DE 2023, exclusivas de este archivo. Los vendedores son
 * nuevos en cada corrida (`SUFIJO`), asi que sus rutas tambien.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-ruta-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-ruta-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-ruta-sin-${SUFIJO}`;

describe('Ruta Diaria desde el portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let mxId: string;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  const vendedorIds: string[] = [];
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let vendedorTj: string;
  let vendedorMx: string;

  let clientes = 0;
  let dias = 0;
  /** Un dia propio por prueba, desde 2023-06-01. */
  const diaNuevo = () =>
    new Date(Date.UTC(2023, 5, 1) + dias++ * 86_400_000)
      .toISOString()
      .slice(0, 10);

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

  /** `Administrador General` trae todos los permisos; `Auxiliar Administrativo` esta vacio. */
  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ) => {
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

  const sembrarVendedor = async (sucursalId: string): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-ruta-v${vendedorIds.length + 1}-${SUFIJO}`,
        nombre: `Vendedor ruta ${vendedorIds.length + 1} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  const sembrarCliente = async (
    sucursalId: string,
    extra: { tipo?: 'cliente' | 'prospecto'; borrado?: boolean } = {},
  ): Promise<{ id: string; nombre: string }> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const prospecto = extra.tipo === 'prospecto';
    const nombre = `Ruta portal ${++clientes} ${SUFIJO}`;
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre,
        domicilio: prospecto ? null : 'Calle 1',
        telefono: '6640000000',
        tipo: extra.tipo ?? 'cliente',
        lista_precio_id: prospecto ? null : lista.id,
        sucursal_id: sucursalId,
        deleted_at: extra.borrado ? new Date() : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return { id, nombre };
  };

  const sembrarRuta = async (valores: {
    vendedor: string;
    cliente: string;
    fecha: string;
    orden: number;
    origen?: 'oficina' | 'vendedor';
    borrada?: boolean;
  }) =>
    (
      await db
        .insertInto('ruta')
        .values({
          vendedor_id: valores.vendedor,
          cliente_id: valores.cliente,
          fecha: valores.fecha,
          orden: valores.orden,
          origen: valores.origen ?? 'oficina',
          tipo: 'diaria',
          deleted_at: valores.borrada ? new Date() : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  const obtener = (cookie: string, vendedorId: string, fecha: string) =>
    request(app.getHttpServer())
      .get(
        `/rutas/diaria?${new URLSearchParams({ vendedorId, fecha }).toString()}`,
      )
      .set('Cookie', cookie);

  const anterior = (cookie: string, vendedorId: string, fecha: string) =>
    request(app.getHttpServer())
      .get(
        `/rutas/diaria/anterior?${new URLSearchParams({ vendedorId, fecha }).toString()}`,
      )
      .set('Cookie', cookie);

  const guardar = (
    cookie: string,
    cuerpo: { vendedorId: string; fecha: string; clientes: string[] },
  ) =>
    request(app.getHttpServer())
      .put('/rutas/diaria')
      .set('Cookie', cookie)
      .send(cuerpo);

  /** Todas las filas (vivas y borradas) de un vendedor y dia, por orden. */
  const filasDe = (vendedor: string, fecha: string) =>
    db
      .selectFrom('ruta')
      .select(['id', 'cliente_id', 'orden', 'origen', 'deleted_at'])
      .where('vendedor_id', '=', vendedor)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .orderBy('orden')
      .execute();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    tjId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;
    mxId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'MX')
        .executeTakeFirstOrThrow()
    ).id;

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', tjId);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);

    vendedorTj = await sembrarVendedor(tjId);
    vendedorMx = await sembrarVendedor(mxId);
  });

  afterAll(async () => {
    await db
      .deleteFrom('ruta')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    if (clienteIds.length > 0) {
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  describe('permiso y alcance', () => {
    it('sin ruta_diaria.gestionar todo es 403, lectura incluida', async () => {
      const fecha = diaNuevo();
      await obtener(cookieSinPermiso, vendedorTj, fecha).expect(403);
      await anterior(cookieSinPermiso, vendedorTj, fecha).expect(403);
      await guardar(cookieSinPermiso, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [],
      }).expect(403);
    });

    it('un usuario atado a TJ no ve al vendedor de MX: 404, no 403', async () => {
      const fecha = diaNuevo();
      await obtener(cookieTijuana, vendedorMx, fecha).expect(404);
      await guardar(cookieTijuana, {
        vendedorId: vendedorMx,
        fecha,
        clientes: [],
      }).expect(404);
    });

    it('el General ve a cualquiera; sin filas responde el vendedor con la lista vacia', async () => {
      const fecha = diaNuevo();
      const res = await obtener(cookieGeneral, vendedorMx, fecha).expect(200);
      expect(res.body).toEqual({
        vendedor: {
          id: vendedorMx,
          nombre: expect.stringContaining('Vendedor ruta') as string,
          sucursalCodigo: 'MX',
        },
        fecha,
        filas: [],
      });
    });

    it('fecha mal formada, fecha imposible o vendedor que no es uuid es 400', async () => {
      await obtener(cookieGeneral, vendedorTj, '12/06/2023').expect(400);
      await obtener(cookieGeneral, vendedorTj, '2023-02-30').expect(400);
      await obtener(cookieGeneral, 'no-soy-uuid', diaNuevo()).expect(400);
    });
  });

  describe('PUT: reemplazo', () => {
    it('guarda la lista en orden, como de la oficina, y responde como el GET', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const b = await sembrarCliente(tjId);

      const res = await guardar(cookieTijuana, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [b.id, a.id],
      }).expect(200);

      const cuerpo = res.body as RutaDiaria;
      expect(cuerpo.filas).toEqual([
        {
          id: expect.any(String) as string,
          clienteId: b.id,
          clienteNombre: b.nombre,
          orden: 1,
          origen: 'oficina',
        },
        {
          id: expect.any(String) as string,
          clienteId: a.id,
          clienteNombre: a.nombre,
          orden: 2,
          origen: 'oficina',
        },
      ]);
      expect(
        (await obtener(cookieTijuana, vendedorTj, fecha).expect(200)).body,
      ).toEqual(cuerpo);
    });

    it('conserva las del vendedor que no vienen y las renumera al final en su orden', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const b = await sembrarCliente(tjId);
      const c = await sembrarCliente(tjId);
      const d = await sembrarCliente(tjId);
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: a.id,
        fecha,
        orden: 1,
      });
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: b.id,
        fecha,
        orden: 2,
        origen: 'vendedor',
      });
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: d.id,
        fecha,
        orden: 5,
        origen: 'vendedor',
      });

      const res = await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [c.id, a.id],
      }).expect(200);

      expect(
        (res.body as RutaDiaria).filas.map((f) => [
          f.clienteId,
          f.orden,
          f.origen,
        ]),
      ).toEqual([
        [c.id, 1, 'oficina'],
        [a.id, 2, 'oficina'],
        [b.id, 3, 'vendedor'],
        [d.id, 4, 'vendedor'],
      ]);
    });

    it('adopta la fila que subio el vendedor: la misma fila, con el orden y el origen de la oficina', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const id = await sembrarRuta({
        vendedor: vendedorTj,
        cliente: a.id,
        fecha,
        orden: 1,
        origen: 'vendedor',
      });

      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [a.id],
      }).expect(200);

      expect(await filasDe(vendedorTj, fecha)).toEqual([
        {
          id,
          cliente_id: a.id,
          orden: 1,
          origen: 'oficina',
          deleted_at: null,
        },
      ]);
    });

    it('da de baja (no borra) las de la oficina que ya no vienen', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const c = await sembrarCliente(tjId);
      const idA = await sembrarRuta({
        vendedor: vendedorTj,
        cliente: a.id,
        fecha,
        orden: 1,
      });
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: c.id,
        fecha,
        orden: 2,
      });

      const res = await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [c.id],
      }).expect(200);

      expect((res.body as RutaDiaria).filas.map((f) => f.clienteId)).toEqual([
        c.id,
      ]);
      const quitada = (await filasDe(vendedorTj, fecha)).find(
        (f) => f.id === idA,
      );
      expect(quitada?.deleted_at).not.toBeNull();
    });

    it('un cliente de otra sucursal es 400 y no cambia nada', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const ajeno = await sembrarCliente(mxId);
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: a.id,
        fecha,
        orden: 1,
      });

      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [ajeno.id],
      }).expect(400);

      expect(await filasDe(vendedorTj, fecha)).toMatchObject([
        { cliente_id: a.id, deleted_at: null },
      ]);
    });

    it('un prospecto, un cliente dado de baja o un cliente repetido es 400', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const p = await sembrarCliente(tjId, { tipo: 'prospecto' });
      const z = await sembrarCliente(tjId, { borrado: true });

      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [p.id],
      }).expect(400);
      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [z.id],
      }).expect(400);
      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [a.id, a.id.toUpperCase()],
      }).expect(400);
      expect(await filasDe(vendedorTj, fecha)).toHaveLength(0);
    });
  });

  describe('GET anterior (Copiar de ayer)', () => {
    it('devuelve la ultima fecha anterior con filas vivas y sus clientes en orden', async () => {
      const f1 = diaNuevo();
      const f2 = diaNuevo();
      const f3 = diaNuevo();
      const a = await sembrarCliente(tjId);
      const b = await sembrarCliente(tjId);
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: b.id,
        fecha: f1,
        orden: 1,
      });
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: a.id,
        fecha: f1,
        orden: 2,
      });

      expect(
        (await anterior(cookieGeneral, vendedorTj, f3).expect(200)).body,
      ).toEqual({
        fecha: f1,
        clientes: [b.id, a.id],
      });
      // `f2` no tiene filas: se salta.
      expect(
        (await anterior(cookieGeneral, vendedorTj, f2).expect(200)).body,
      ).toEqual({
        fecha: f1,
        clientes: [b.id, a.id],
      });
    });

    it('sin ruta anterior responde fecha null y ninguna fila', async () => {
      const otro = await sembrarVendedor(tjId);
      expect(
        (await anterior(cookieGeneral, otro, diaNuevo()).expect(200))
          .body as RutaAnterior,
      ).toEqual({ fecha: null, clientes: [] });
    });

    it('un dia con solo filas dadas de baja no cuenta', async () => {
      const f1 = diaNuevo();
      const f2 = diaNuevo();
      const f3 = diaNuevo();
      const a = await sembrarCliente(tjId);
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: a.id,
        fecha: f1,
        orden: 1,
      });
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: a.id,
        fecha: f2,
        orden: 1,
        borrada: true,
      });

      expect(
        (await anterior(cookieGeneral, vendedorTj, f3).expect(200)).body,
      ).toEqual({
        fecha: f1,
        clientes: [a.id],
      });
    });

    it('omite clientes dados de baja y prospectos, para que copiar y guardar no termine en 400 (Review Focus 4)', async () => {
      const f1 = diaNuevo();
      const f2 = diaNuevo();
      const a = await sembrarCliente(tjId);
      const z = await sembrarCliente(tjId, { borrado: true });
      const p = await sembrarCliente(tjId, { tipo: 'prospecto' });
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: z.id,
        fecha: f1,
        orden: 1,
      });
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: a.id,
        fecha: f1,
        orden: 2,
      });
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: p.id,
        fecha: f1,
        orden: 3,
      });

      const copia = (await anterior(cookieGeneral, vendedorTj, f2).expect(200))
        .body as RutaAnterior;
      expect(copia).toEqual({ fecha: f1, clientes: [a.id] });

      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha: f2,
        clientes: copia.clientes,
      }).expect(200);
    });
  });
});

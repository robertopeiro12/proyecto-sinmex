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
  overridesPrecio: {
    presentacionId: string;
    precio: number;
    vigenteDesde: string;
  }[];
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

      const nombres = (res.body as ClienteResumenRespuesta[]).map(
        (c) => c.nombre,
      );
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
      expect(clientes.some((c) => c.nombre === `${PREFIJO} Prospecto`)).toBe(
        true,
      );
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

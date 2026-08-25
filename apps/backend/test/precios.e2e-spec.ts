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
// Sin uso todavia: queda lista para las pruebas del PATCH que agrega la
// Task 3 al mismo archivo (mismo motivo que `idMexicali` mas abajo).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const HOY = new Date().toISOString().slice(0, 10);

describe('Precios (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const productoIds: string[] = [];
  let idTijuana: string;
  // Sin uso todavia: la Task 3 agrega al PATCH pruebas de sucursal cruzada
  // (TJ vs MX) al mismo archivo y la va a necesitar.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

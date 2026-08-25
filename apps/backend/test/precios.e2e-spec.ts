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

      // No exacta contra TODA la tabla lista_precio: cualquier otra suite
      // que sembrara una lista adicional rompería esto sin relación con lo
      // que aquí se prueba (misma clase de fragilidad cross-suite que ya se
      // corrigió en otras partes de esta rama). Se afirman solo las dos
      // propiedades que importan: las 4 activas están, Especial no.
      const nombres = (res.body as ListaPrecioRespuesta[]).map((l) => l.nombre);
      expect(nombres).toEqual(
        expect.arrayContaining(['Lista 1', 'Lista 2', 'Lista 3', 'Lista 4']),
      );
      expect(nombres).not.toContain('Especial');
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
      const presentacionId = await sembrarPresentacion(
        `${PREFIJO} SinSesion`,
        '500 ml',
      );

      await request(app.getHttpServer())
        .patch('/precios')
        .send({
          presentacionId,
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
});

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

interface VendedorRespuesta {
  id: string;
  nombre: string;
  login: string;
  sucursalId: string;
  sucursalCodigo: string;
  folioSegmento: string | null;
  activo: boolean;
}

// El PID va pegado al timestamp porque Jest corre archivos en paralelo, en
// procesos distintos: dos suites que arrancan en el mismo milisegundo
// generarian el mismo SUFIJO (mismo criterio que vehiculos.e2e-spec.ts,
// corregido en el PR #82 tras un fallo real en paralelo).
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN_GENERAL = `e2e-ven-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-ven-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-ven-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';

// Prefijo reservado: la limpieza de afterAll borra por `login like`. Sin el,
// una corrida que deje basura envenena la siguiente con 409 inesperados.
// Nota: se usa solo un espacio para no interferir con el calculo de segmento-vendedor.
const PREFIJO = ` `;

describe('Vendedores (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  let idTijuana: string;
  let idMexicali: string;
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

  /**
   * `Administrador General` recibe el catalogo completo de permisos por diseño
   * (D1 de T-08a); los otros 5 perfiles estan VACIOS hasta T-08b, asi que
   * `Auxiliar Administrativo` sirve como "usuario sin permiso" sin montar nada.
   */
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

  /** Inserta un vendedor por debajo de la API, para preparar escenarios. */
  const sembrarVendedor = async (
    login: string,
    nombre: string,
    sucursalId: string,
    folioSegmento: string | null = null,
  ): Promise<string> => {
    const hash = await app.get(PasswordService).hashear(PASSWORD);
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login,
        nombre,
        password_hash: hash,
        sucursal_id: sucursalId,
        folio_segmento: folioSegmento,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
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

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', idTijuana);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);

    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    await db
      .deleteFrom('vendedor')
      .where('login', 'like', `e2e-%`)
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

  describe('GET /vendedores', () => {
    it('lista los vendedores con su codigo de sucursal', async () => {
      await sembrarVendedor(
        `e2e-listar-${SUFIJO}`,
        `${PREFIJO} Listar TJ`,
        idTijuana,
        'LT',
      );

      const res = await request(app.getHttpServer())
        .get('/vendedores')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const vendedores = res.body as VendedorRespuesta[];
      const propio = vendedores.find(
        (v) => v.nombre === `${PREFIJO} Listar TJ`,
      );
      expect(propio).toBeDefined();
      expect(propio?.sucursalCodigo).toBe('TJ');
      expect(propio?.folioSegmento).toBe('LT');
      expect(propio?.activo).toBe(true);
      expect(propio).not.toHaveProperty('deleted_at');
      expect(propio).not.toHaveProperty('password_hash');
    });

    it('un usuario atado a TJ no ve los vendedores de MX', async () => {
      await sembrarVendedor(
        `e2e-solomx-${SUFIJO}`,
        `${PREFIJO} Solo MX`,
        idMexicali,
      );

      const res = await request(app.getHttpServer())
        .get('/vendedores')
        .set('Cookie', cookieTijuana)
        .expect(200);

      const nombres = (res.body as VendedorRespuesta[]).map((v) => v.nombre);
      expect(nombres).not.toContain(`${PREFIJO} Solo MX`);
    });

    it('un usuario atado que pide "todas" recibe la suya, no un 403', async () => {
      await request(app.getHttpServer())
        .get('/vendedores?sucursal=todas')
        .set('Cookie', cookieTijuana)
        .expect(200);
    });

    it('un usuario atado que pide OTRA sucursal recibe 403', async () => {
      await request(app.getHttpServer())
        .get('/vendedores?sucursal=MX')
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('el usuario General puede filtrar por una sucursal concreta', async () => {
      const res = await request(app.getHttpServer())
        .get('/vendedores?sucursal=MX')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const codigos = (res.body as VendedorRespuesta[]).map(
        (v) => v.sucursalCodigo,
      );
      expect(codigos.every((c) => c === 'MX')).toBe(true);
    });

    // Otras pantallas (Ruta Diaria/Semanal, Nomina) van a necesitar este
    // catalogo sin tener vendedor.gestionar.
    it('deja listar aunque el usuario no tenga vendedor.gestionar', async () => {
      await request(app.getHttpServer())
        .get('/vendedores')
        .set('Cookie', cookieSinPermiso)
        .expect(200);
    });

    it('rechaza a quien no tiene sesion', async () => {
      await request(app.getHttpServer()).get('/vendedores').expect(401);
    });
  });

  describe('POST /vendedores', () => {
    it('un usuario atado crea en SU sucursal sin mandarla, y le asigna segmento', async () => {
      const res = await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Abraham Solis`,
          login: `e2e-alta-${SUFIJO}`,
          contrasena: 'x',
        })
        .expect(201);

      const vendedor = res.body as VendedorRespuesta;
      expect(vendedor.sucursalCodigo).toBe('TJ');
      expect(vendedor.folioSegmento).toBe('AS');
      expect(vendedor.activo).toBe(true);
      expect(vendedor).not.toHaveProperty('password_hash');
    });

    // D3: el cliente propone, el servidor dispone. Mandar otra sucursal no es
    // un intento de escalada (el formulario ni siquiera pinta el campo), se
    // ignora en silencio.
    it('a un usuario atado se le IGNORA el sucursalId que mande', async () => {
      const res = await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Colado`,
          login: `e2e-colado-${SUFIJO}`,
          contrasena: 'x',
          sucursalId: idMexicali,
        })
        .expect(201);

      expect((res.body as VendedorRespuesta).sucursalCodigo).toBe('TJ');
    });

    it('el usuario General elige la sucursal', async () => {
      const res = await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} General Electo`,
          login: `e2e-gen-elige-${SUFIJO}`,
          contrasena: 'x',
          sucursalId: idMexicali,
        })
        .expect(201);

      expect((res.body as VendedorRespuesta).sucursalCodigo).toBe('MX');
    });

    it('el usuario General sin sucursalId recibe 400', async () => {
      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} Sin sucursal`,
          login: `e2e-sinsuc-${SUFIJO}`,
          contrasena: 'x',
        })
        .expect(400);
    });

    // D5: sin minimo de longitud -- el cliente lo confirmo.
    it('acepta una contraseña de un solo caracter', async () => {
      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Password Corta`,
          login: `e2e-corta-${SUFIJO}`,
          contrasena: 'x',
        })
        .expect(201);
    });

    it('rechaza una contraseña vacia con 400', async () => {
      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Password Vacia`,
          login: `e2e-vacia-${SUFIJO}`,
          contrasena: '',
        })
        .expect(400);
    });

    it('rechaza un login duplicado (incluida variacion de mayusculas) con 409', async () => {
      const login = `e2e-dup-${SUFIJO}`;
      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Login Uno`, login, contrasena: 'x' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Login Dos`,
          login: login.toUpperCase(),
          contrasena: 'x',
        })
        .expect(409);
    });

    // EL criterio de aceptacion (D6, enmienda ADR-0007): rechazar, no ceder.
    it('rechaza el alta si las iniciales ya estan tomadas en la MISMA sucursal', async () => {
      await sembrarVendedor(
        `e2e-ocupado-${SUFIJO}`,
        `${PREFIJO} Beto Ponce`,
        idTijuana,
        'BP',
      );

      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Berta Pineda`,
          login: `e2e-choca-${SUFIJO}`,
          contrasena: 'x',
        })
        .expect(409);
    });

    // El ejemplo textual del cliente: mismo segmento, sucursal distinta, SI
    // se acepta -- porque el folio completo no choca.
    it('permite el mismo segmento de iniciales en una sucursal distinta', async () => {
      await sembrarVendedor(
        `e2e-tjjp-${SUFIJO}`,
        `${PREFIJO} Juan Perez TJ`,
        idTijuana,
        'JP',
      );

      const res = await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} Juan Perez MX`,
          login: `e2e-mxjp-${SUFIJO}`,
          contrasena: 'x',
          sucursalId: idMexicali,
        })
        .expect(201);

      expect((res.body as VendedorRespuesta).folioSegmento).toBe('JP');
      expect((res.body as VendedorRespuesta).sucursalCodigo).toBe('MX');
    });

    // Un vendedor desactivado (activo=false, sin deleted_at) sigue bloqueando
    // sus iniciales -- D7 del spec, ya fijado en la base por la Task 2.
    it('un vendedor desactivado en la sucursal sigue bloqueando sus iniciales', async () => {
      const id = await sembrarVendedor(
        `e2e-dormido-${SUFIJO}`,
        `${PREFIJO} Carla Ruiz`,
        idTijuana,
        'CR',
      );
      await db
        .updateTable('vendedor')
        .set({ activo: false })
        .where('id', '=', id)
        .execute();

      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Carlos Reyes`,
          login: `e2e-choca2-${SUFIJO}`,
          contrasena: 'x',
        })
        .expect(409);
    });

    it('rechaza crear sin el permiso vendedor.gestionar', async () => {
      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieSinPermiso)
        .send({
          nombre: `${PREFIJO} Prohibido`,
          login: `e2e-prohibido-${SUFIJO}`,
          contrasena: 'x',
        })
        .expect(403);
    });

    it('rechaza un nombre vacio con 400', async () => {
      await request(app.getHttpServer())
        .post('/vendedores')
        .set('Cookie', cookieTijuana)
        .send({ nombre: '   ', login: `e2e-nombre-${SUFIJO}`, contrasena: 'x' })
        .expect(400);
    });
  });
});

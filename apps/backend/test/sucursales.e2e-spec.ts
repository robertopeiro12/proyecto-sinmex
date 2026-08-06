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

interface SucursalRespuesta {
  id: string;
  codigo: string;
  nombre: string;
  activa: boolean;
}

const SUFIJO = Date.now();
const LOGIN_GENERAL = `e2e-suc-gral-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-suc-tj-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';

// Codigos reservados para las pruebas. Se limpian en afterAll: el espacio de
// codigos es minusculo (2 letras) y una corrida que deje basura envenenaria
// las siguientes con 409 inesperados. Nunca uses TJ ni MX aqui: son semillas
// reales y borrarlas romperia el resto de la suite.
const CODIGOS_DE_PRUEBA = ['ZA', 'ZB', 'ZC'];

describe('Sucursales (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let usuarioIds: string[] = [];
  let cookieGeneral: string;
  let cookieTijuana: string;

  /** Inicia sesion y devuelve la cookie de acceso lista para `.set('Cookie', …)`. */
  const iniciarSesion = async (login: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const acceso = cookies
      .find((c) => c.startsWith('jawa_access='))
      ?.split(';')[0];
    if (!acceso) {
      throw new Error('El login no devolvio cookie de acceso.');
    }
    return acceso;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Misma configuracion que main.ts, por la razon explicada en
    // configurar-app.ts: una copia a mano podria divergir de produccion.
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await app.init();

    db = app.get<Database>(DB_CONNECTION);

    const perfil = await db
      .selectFrom('perfil')
      .select('id')
      .orderBy('nombre')
      .executeTakeFirstOrThrow();

    const tijuana = await db
      .selectFrom('sucursal')
      .select('id')
      .where('codigo', '=', 'TJ')
      .executeTakeFirstOrThrow();

    const hash = await new PasswordService().hashear(PASSWORD);

    // Los DOS usuarios son el corazon de esta suite: con uno solo, la regla de
    // alcance (D2/D3) queda sin verificar de punta a punta.
    const general = await db
      .insertInto('usuario')
      .values({
        login: LOGIN_GENERAL,
        nombre: 'Usuario General e2e',
        password_hash: hash,
        perfil_id: perfil.id,
        sucursal_id: null, // null = General
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const deTijuana = await db
      .insertInto('usuario')
      .values({
        login: LOGIN_TIJUANA,
        nombre: 'Usuario Tijuana e2e',
        password_hash: hash,
        perfil_id: perfil.id,
        sucursal_id: tijuana.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    usuarioIds = [general.id, deTijuana.id];

    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
  });

  afterAll(async () => {
    await db
      .deleteFrom('sucursal')
      .where('codigo', 'in', CODIGOS_DE_PRUEBA)
      .execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  describe('GET /sucursales', () => {
    it('sin sesion responde 401', async () => {
      await request(app.getHttpServer()).get('/sucursales').expect(401);
    });

    it('un usuario General ve todas las sucursales', async () => {
      const res = await request(app.getHttpServer())
        .get('/sucursales')
        .set('Cookie', [cookieGeneral])
        .expect(200);

      const codigos = (res.body as SucursalRespuesta[]).map((s) => s.codigo);
      expect(codigos).toEqual(expect.arrayContaining(['TJ', 'MX']));
    });

    it('un usuario General puede acotar a una sucursal', async () => {
      const res = await request(app.getHttpServer())
        .get('/sucursales?sucursal=TJ')
        .set('Cookie', [cookieGeneral])
        .expect(200);

      const codigos = (res.body as SucursalRespuesta[]).map((s) => s.codigo);
      expect(codigos).toEqual(['TJ']);
    });

    it('un usuario atado a Tijuana solo ve la suya, aunque no pida nada', async () => {
      const res = await request(app.getHttpServer())
        .get('/sucursales')
        .set('Cookie', [cookieTijuana])
        .expect(200);

      const codigos = (res.body as SucursalRespuesta[]).map((s) => s.codigo);
      expect(codigos).toEqual(['TJ']);
    });

    it('un usuario atado que pide "todas" recibe la suya, no un 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/sucursales?sucursal=todas')
        .set('Cookie', [cookieTijuana])
        .expect(200);

      const codigos = (res.body as SucursalRespuesta[]).map((s) => s.codigo);
      expect(codigos).toEqual(['TJ']);
    });

    it('un usuario atado que pide OTRA sucursal recibe 403', async () => {
      // Este es el caso que justifica los dos usuarios. Si el backend
      // confiara en el query param, aqui devolveria los datos de Mexicali con
      // un 200 y nadie se enteraria.
      await request(app.getHttpServer())
        .get('/sucursales?sucursal=MX')
        .set('Cookie', [cookieTijuana])
        .expect(403);
    });
  });
});

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

interface TipoNegocioRespuesta {
  id: string;
  nombre: string;
}

// El PID va pegado al timestamp porque Jest corre archivos en paralelo, en
// procesos distintos: dos suites que arrancan en el mismo milisegundo
// generarian el mismo PREFIJO, y el afterAll de una borraria filas que la
// otra todavia necesita (foreign key violation cruzada entre suites).
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN_GENERAL = `e2e-tneg-gen-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-tneg-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const PREFIJO = `ZZ-e2e-${SUFIJO}`;

describe('Tipos de Negocio (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  let cookieGeneral: string;
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

  const crearUsuario = async (login: string, perfil: string): Promise<void> => {
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
        sucursal_id: null,
      })
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

    await crearUsuario(LOGIN_GENERAL, 'Administrador General');
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo');

    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
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

  describe('GET /tipos-negocio', () => {
    it('lista los tipos de negocio sin exigir cliente.gestionar', async () => {
      const res = await request(app.getHttpServer())
        .get('/tipos-negocio')
        .set('Cookie', cookieSinPermiso)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('rechaza a quien no tiene sesion', async () => {
      await request(app.getHttpServer()).get('/tipos-negocio').expect(401);
    });
  });

  describe('POST /tipos-negocio', () => {
    it('crea un tipo de negocio', async () => {
      const res = await request(app.getHttpServer())
        .post('/tipos-negocio')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Restaurante` })
        .expect(201);

      const cuerpo = res.body as TipoNegocioRespuesta;
      expect(cuerpo.nombre).toBe(`${PREFIJO} Restaurante`);
      expect(cuerpo.id).toBeDefined();
    });

    it('rechaza un nombre duplicado con 409', async () => {
      await request(app.getHttpServer())
        .post('/tipos-negocio')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Tienda` })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/tipos-negocio')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Tienda` })
        .expect(409);

      expect((res.body as { message: string }).message).toContain('Ya existe');
    });

    it('rechaza sin cliente.gestionar con 403', async () => {
      await request(app.getHttpServer())
        .post('/tipos-negocio')
        .set('Cookie', cookieSinPermiso)
        .send({ nombre: `${PREFIJO} Sin permiso` })
        .expect(403);
    });

    it('rechaza un nombre vacio con 400', async () => {
      await request(app.getHttpServer())
        .post('/tipos-negocio')
        .set('Cookie', cookieGeneral)
        .send({ nombre: '  ' })
        .expect(400);
    });
  });
});

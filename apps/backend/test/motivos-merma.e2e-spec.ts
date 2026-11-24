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

interface MotivoRespuesta {
  id: string;
  nombre: string;
  aplicaAlmacen: boolean;
  aplicaCliente: boolean;
  aplicaVehiculo: boolean;
  activo: boolean;
}

// El PID va pegado al timestamp porque Jest corre archivos en paralelo, en
// procesos distintos (ver tipos-negocio.e2e-spec.ts).
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN_GENERAL = `e2e-mmer-gen-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-mmer-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const PREFIJO = `ZZ-mmer-${SUFIJO}`;

describe('Motivos de merma (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  let cookieGeneral: string;
  let cookieSinPermiso: string;

  const http = () => request(app.getHttpServer());

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
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    await crearUsuario(LOGIN_GENERAL, 'Administrador General');
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo');

    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    await db
      .deleteFrom('motivo_merma')
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

  describe('GET /motivos-merma', () => {
    it('lista los vivos con sus casillas a cualquiera con sesion, semilla incluida', async () => {
      const res = await http()
        .get('/motivos-merma')
        .set('Cookie', cookieSinPermiso)
        .expect(200);
      const m = (res.body as MotivoRespuesta[]).find(
        (x) => x.nombre === 'Caducado por fecha',
      );
      expect(m).toMatchObject({
        aplicaAlmacen: true,
        aplicaCliente: true,
        aplicaVehiculo: true,
        activo: true,
      });
    });

    it('sin sesion es 401', async () => {
      await http().get('/motivos-merma').expect(401);
    });

    it('?aplica=almacen deja solo los vivos con esa casilla', async () => {
      const sin = (
        await http()
          .post('/motivos-merma')
          .set('Cookie', cookieGeneral)
          .send({ nombre: `${PREFIJO} SoloCliente`, aplicaAlmacen: false })
          .expect(201)
      ).body as MotivoRespuesta;
      const con = (
        await http()
          .post('/motivos-merma')
          .set('Cookie', cookieGeneral)
          .send({ nombre: `${PREFIJO} ConAlmacen` })
          .expect(201)
      ).body as MotivoRespuesta;
      const lista = (
        await http()
          .get('/motivos-merma?aplica=almacen')
          .set('Cookie', cookieSinPermiso)
          .expect(200)
      ).body as MotivoRespuesta[];
      const ids = lista.map((m) => m.id);
      expect(ids).toContain(con.id);
      expect(ids).not.toContain(sin.id);
      await http()
        .get('/motivos-merma?aplica=x')
        .set('Cookie', cookieSinPermiso)
        .expect(400);
    });
  });

  describe('POST /motivos-merma', () => {
    it('crea un motivo con sus casillas', async () => {
      const res = await http()
        .post('/motivos-merma')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Bodega`, aplicaCliente: false })
        .expect(201);
      expect(res.body).toMatchObject({
        nombre: `${PREFIJO} Bodega`,
        aplicaAlmacen: true,
        aplicaCliente: false,
        aplicaVehiculo: true,
        activo: true,
      });
    });

    it('un nombre repetido (sin importar mayusculas ni espacios) es 409 y lo dice', async () => {
      await http()
        .post('/motivos-merma')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Feria` })
        .expect(201);
      const res = await http()
        .post('/motivos-merma')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `  ${PREFIJO} FERIA ` })
        .expect(409);
      expect((res.body as { message: string }).message).toContain(
        'Ya existe un motivo de merma',
      );
    });

    it('sin motivo_merma.gestionar es 403', async () => {
      await http()
        .post('/motivos-merma')
        .set('Cookie', cookieSinPermiso)
        .send({ nombre: `${PREFIJO} X` })
        .expect(403);
    });

    it('sin ninguna casilla prendida es 400', async () => {
      await http()
        .post('/motivos-merma')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} Nada`,
          aplicaAlmacen: false,
          aplicaCliente: false,
          aplicaVehiculo: false,
        })
        .expect(400);
    });

    it('un nombre vacio es 400', async () => {
      await http()
        .post('/motivos-merma')
        .set('Cookie', cookieGeneral)
        .send({ nombre: '   ' })
        .expect(400);
    });
  });

  describe('PATCH /motivos-merma/:id', () => {
    it('cambia las casillas y el nombre', async () => {
      const { id } = (
        await http()
          .post('/motivos-merma')
          .set('Cookie', cookieGeneral)
          .send({ nombre: `${PREFIJO} Lluvia` })
          .expect(201)
      ).body as MotivoRespuesta;
      const res = await http()
        .patch(`/motivos-merma/${id}`)
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Llovía`, aplicaVehiculo: false })
        .expect(200);
      expect(res.body).toMatchObject({
        id,
        nombre: `${PREFIJO} Llovía`,
        aplicaAlmacen: true,
        aplicaVehiculo: false,
      });
    });

    it('apagar todas las casillas (juntando lo guardado) es 400', async () => {
      const { id } = (
        await http()
          .post('/motivos-merma')
          .set('Cookie', cookieGeneral)
          .send({
            nombre: `${PREFIJO} Una`,
            aplicaCliente: false,
            aplicaVehiculo: false,
          })
          .expect(201)
      ).body as MotivoRespuesta;
      await http()
        .patch(`/motivos-merma/${id}`)
        .set('Cookie', cookieGeneral)
        .send({ aplicaAlmacen: false })
        .expect(400);
    });

    it('renombrar a uno que ya existe es 409', async () => {
      await http()
        .post('/motivos-merma')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Uno` })
        .expect(201);
      const { id } = (
        await http()
          .post('/motivos-merma')
          .set('Cookie', cookieGeneral)
          .send({ nombre: `${PREFIJO} Dos` })
          .expect(201)
      ).body as MotivoRespuesta;
      await http()
        .patch(`/motivos-merma/${id}`)
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Uno` })
        .expect(409);
    });

    it('un id que no existe es 404 y sin permiso es 403', async () => {
      const otro = '00000000-0000-4000-8000-000000000039';
      await http()
        .patch(`/motivos-merma/${otro}`)
        .set('Cookie', cookieGeneral)
        .send({ aplicaCliente: true })
        .expect(404);
      await http()
        .patch(`/motivos-merma/${otro}`)
        .set('Cookie', cookieSinPermiso)
        .send({ aplicaCliente: true })
        .expect(403);
    });
  });

  describe('DELETE /motivos-merma/:id', () => {
    it('lo da de baja: deja de listarse y su nombre se puede volver a usar', async () => {
      const nombre = `${PREFIJO} Vacaciones`;
      const { id } = (
        await http()
          .post('/motivos-merma')
          .set('Cookie', cookieGeneral)
          .send({ nombre })
          .expect(201)
      ).body as MotivoRespuesta;

      await http()
        .delete(`/motivos-merma/${id}`)
        .set('Cookie', cookieSinPermiso)
        .expect(403);
      expect(
        (
          await http()
            .delete(`/motivos-merma/${id}`)
            .set('Cookie', cookieGeneral)
            .expect(200)
        ).body,
      ).toEqual({ id });

      const lista = (
        await http()
          .get('/motivos-merma')
          .set('Cookie', cookieGeneral)
          .expect(200)
      ).body as MotivoRespuesta[];
      expect(lista.map((m) => m.id)).not.toContain(id);
      await http()
        .delete(`/motivos-merma/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(404);
      await http()
        .post('/motivos-merma')
        .set('Cookie', cookieGeneral)
        .send({ nombre })
        .expect(201);
    });
  });
});

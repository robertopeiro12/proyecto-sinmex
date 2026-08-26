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

interface PermisoRespuesta {
  id: string;
  clave: string;
  grupo: string;
  descripcion: string | null;
}

interface PerfilRespuesta {
  id: string;
  nombre: string;
  esMaestro: boolean;
  permisos: string[];
}

interface MatrizRespuesta {
  permisos: PermisoRespuesta[];
  perfiles: PerfilRespuesta[];
}

const SUFIJO = Date.now();
const LOGIN_CON_PERMISO = `e2e-perf-con-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-perf-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
// Prefijo reservado: la limpieza de afterAll borra por `nombre like`. Sin el,
// una corrida que deje basura envenena la siguiente con 409 inesperados.
const PREFIJO = `ZZ-e2e-perfiles-${SUFIJO}`;

describe('Perfiles (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const perfilIds: string[] = [];
  let idMaestro: string;
  let idPermisoGestionar: string;
  let cookieConPermiso: string;
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

  /** Perfil de prueba, por debajo de la API. Se limpia en afterAll. */
  const sembrarPerfil = async (nombre: string): Promise<string> => {
    const { id } = await db
      .insertInto('perfil')
      .values({ nombre })
      .returning('id')
      .executeTakeFirstOrThrow();
    perfilIds.push(id);
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

    const maestro = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Administrador General')
      .executeTakeFirstOrThrow();
    idMaestro = maestro.id;

    const permisoGestionar = await db
      .selectFrom('permiso')
      .select('id')
      .where('clave', '=', 'perfil.gestionar')
      .executeTakeFirstOrThrow();
    idPermisoGestionar = permisoGestionar.id;

    // 'Administrador General' recibe el catalogo completo por diseño (D1 de
    // T-08a), asi que sirve como "usuario con perfil.gestionar" sin tener que
    // tocar perfil_permiso. 'Auxiliar Administrativo' sigue vacio (T-08b no
    // le asigna nada por defecto -- D7 del spec), asi que sirve como "usuario
    // sin el permiso" igual que en el resto de las suites e2e.
    await crearUsuario(LOGIN_CON_PERMISO, 'Administrador General');
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo');

    cookieConPermiso = await iniciarSesion(LOGIN_CON_PERMISO);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    if (perfilIds.length > 0) {
      // perfil_permiso.perfil_id no tiene ON DELETE: hay que borrar las
      // asignaciones antes que el perfil o el FK truena.
      await db
        .deleteFrom('perfil_permiso')
        .where('perfil_id', 'in', perfilIds)
        .execute();
      await db.deleteFrom('perfil').where('id', 'in', perfilIds).execute();
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

  describe('GET /perfiles', () => {
    it('rechaza sin sesion', async () => {
      await request(app.getHttpServer()).get('/perfiles').expect(401);
    });

    it('rechaza a quien tiene sesion pero no perfil.gestionar', async () => {
      await request(app.getHttpServer())
        .get('/perfiles')
        .set('Cookie', cookieSinPermiso)
        .expect(403);
    });

    it('devuelve el catalogo de permisos y los perfiles, con el maestro marcado', async () => {
      const res = await request(app.getHttpServer())
        .get('/perfiles')
        .set('Cookie', cookieConPermiso)
        .expect(200);

      const cuerpo = res.body as MatrizRespuesta;
      const claves = cuerpo.permisos.map((p) => p.clave);
      expect(claves).toEqual(expect.arrayContaining(['perfil.gestionar']));

      const maestro = cuerpo.perfiles.find((p) => p.id === idMaestro);
      expect(maestro).toBeDefined();
      expect(maestro?.esMaestro).toBe(true);
      // El maestro recibe TODO el catalogo, no solo lo que haya en
      // perfil_permiso (que para el maestro esta vacio a proposito, D2).
      expect(maestro?.permisos).toEqual(expect.arrayContaining(claves));

      const auxiliar = cuerpo.perfiles.find(
        (p) => p.nombre === 'Auxiliar Administrativo',
      );
      expect(auxiliar).toBeDefined();
      expect(auxiliar?.esMaestro).toBe(false);
      expect(auxiliar?.permisos).toEqual([]);
    });

    it('un perfil de prueba con una asignacion la refleja en su lista', async () => {
      const perfilId = await sembrarPerfil(`${PREFIJO} Con permiso`);
      await db
        .insertInto('perfil_permiso')
        .values({ perfil_id: perfilId, permiso_id: idPermisoGestionar })
        .execute();

      const res = await request(app.getHttpServer())
        .get('/perfiles')
        .set('Cookie', cookieConPermiso)
        .expect(200);

      const propio = (res.body as MatrizRespuesta).perfiles.find(
        (p) => p.id === perfilId,
      );
      expect(propio?.permisos).toEqual(['perfil.gestionar']);
    });
  });

  describe('POST /perfiles', () => {
    it('rechaza sin perfil.gestionar', async () => {
      await request(app.getHttpServer())
        .post('/perfiles')
        .set('Cookie', cookieSinPermiso)
        .send({ nombre: `${PREFIJO} Sin permiso` })
        .expect(403);
    });

    it('crea un perfil sin ningun permiso asignado', async () => {
      const res = await request(app.getHttpServer())
        .post('/perfiles')
        .set('Cookie', cookieConPermiso)
        .send({ nombre: `${PREFIJO} Nuevo` })
        .expect(201);

      const creado = res.body as { id: string; nombre: string };
      perfilIds.push(creado.id);
      expect(creado.nombre).toBe(`${PREFIJO} Nuevo`);

      const enMatriz = await request(app.getHttpServer())
        .get('/perfiles')
        .set('Cookie', cookieConPermiso)
        .expect(200);
      const propio = (
        enMatriz.body as { perfiles: { id: string; permisos: string[] }[] }
      ).perfiles.find((p) => p.id === creado.id);
      expect(propio?.permisos).toEqual([]);
    });

    it('rechaza un nombre repetido', async () => {
      const nombre = `${PREFIJO} Repetido`;
      const primero = await request(app.getHttpServer())
        .post('/perfiles')
        .set('Cookie', cookieConPermiso)
        .send({ nombre })
        .expect(201);
      perfilIds.push((primero.body as { id: string }).id);

      await request(app.getHttpServer())
        .post('/perfiles')
        .set('Cookie', cookieConPermiso)
        .send({ nombre })
        .expect(409);
    });

    it('rechaza un nombre vacio', async () => {
      await request(app.getHttpServer())
        .post('/perfiles')
        .set('Cookie', cookieConPermiso)
        .send({ nombre: '   ' })
        .expect(400);
    });
  });

  describe('PATCH /perfiles/:id', () => {
    it('rechaza sin perfil.gestionar', async () => {
      const id = await sembrarPerfil(`${PREFIJO} Renombrar sin permiso`);
      await request(app.getHttpServer())
        .patch(`/perfiles/${id}`)
        .set('Cookie', cookieSinPermiso)
        .send({ nombre: 'Otro nombre' })
        .expect(403);
    });

    it('renombra un perfil normal', async () => {
      const id = await sembrarPerfil(`${PREFIJO} Original`);
      const res = await request(app.getHttpServer())
        .patch(`/perfiles/${id}`)
        .set('Cookie', cookieConPermiso)
        .send({ nombre: `${PREFIJO} Renombrado` })
        .expect(200);

      expect((res.body as { nombre: string }).nombre).toBe(
        `${PREFIJO} Renombrado`,
      );
    });

    it('rechaza renombrar al perfil maestro', async () => {
      await request(app.getHttpServer())
        .patch(`/perfiles/${idMaestro}`)
        .set('Cookie', cookieConPermiso)
        .send({ nombre: 'Ya no soy el maestro' })
        .expect(409);

      const fila = await db
        .selectFrom('perfil')
        .select('nombre')
        .where('id', '=', idMaestro)
        .executeTakeFirstOrThrow();
      expect(fila.nombre).toBe('Administrador General');
    });

    it('un id que no existe responde 404', async () => {
      await request(app.getHttpServer())
        .patch('/perfiles/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieConPermiso)
        .send({ nombre: 'Lo que sea' })
        .expect(404);
    });

    it('un id mal formado responde 400, no 500', async () => {
      await request(app.getHttpServer())
        .patch('/perfiles/no-soy-un-uuid')
        .set('Cookie', cookieConPermiso)
        .send({ nombre: 'Lo que sea' })
        .expect(400);
    });
  });
});

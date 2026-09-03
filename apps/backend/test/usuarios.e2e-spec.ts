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

interface MatrizPerfilesRespuesta {
  permisos: {
    id: string;
    clave: string;
    grupo: string;
    descripcion: string | null;
  }[];
  perfiles: {
    id: string;
    nombre: string;
    esMaestro: boolean;
    permisos: string[];
  }[];
}

const SUFIJO = Date.now();
const LOGIN_GENERAL = `e2e-usr-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-usr-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-usr-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const PREFIJO = `zz-e2e-${SUFIJO}`;

describe('Usuarios (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const perfilIds: string[] = [];
  let idTijuana: string;
  // Consumida por las Tasks 4-7, no por esta tarea.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let idMexicali: string;
  let idPerfilMaestro: string;
  let idPerfilAuxiliar: string;
  let cookieGeneral: string;
  // Consumida por las Tasks 4-7, no por esta tarea.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  /** Fixture de prueba: inserta un usuario DIRECTO en la base, por debajo de la API. */
  const crearUsuarioFixture = async (
    login: string,
    perfilId: string,
    sucursalId: string | null,
  ): Promise<string> => {
    const hash = await app.get(PasswordService).hashear(PASSWORD);
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
    return id;
  };

  /**
   * Perfil DESECHABLE con exactamente un permiso -- para las Tasks 5-6, que
   * necesitan un caso determinista de "el perfil SI da este permiso, no da
   * este otro". Los 6 perfiles sembrados (Auxiliar Administrativo, Jefe de
   * Ventas, ...) nacen SIN ninguna fila en `perfil_permiso` (CLAUDE.md) y su
   * estado real depende de que otro archivo de e2e los haya tocado en esta
   * misma corrida -- leerlos en vivo seria no determinista. Mismo criterio
   * que `sembrarPerfil()` en `perfiles.e2e-spec.ts` (T-08b), un paso mas
   * lejos (ese no necesitaba asignarle ningun permiso).
   *
   * Consumida por las Tasks 5-6, no por esta tarea.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const sembrarPerfilConPermiso = async (
    nombre: string,
    clavePermiso: string,
  ): Promise<{ id: string; clave: string }> => {
    const permiso = await db
      .selectFrom('permiso')
      .select('id')
      .where('clave', '=', clavePermiso)
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('perfil')
      .values({ nombre })
      .returning('id')
      .executeTakeFirstOrThrow();
    perfilIds.push(id);
    await db
      .insertInto('perfil_permiso')
      .values({ perfil_id: id, permiso_id: permiso.id })
      .execute();
    return { id, clave: clavePermiso };
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

    const maestro = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Administrador General')
      .executeTakeFirstOrThrow();
    idPerfilMaestro = maestro.id;

    const auxiliar = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Auxiliar Administrativo')
      .executeTakeFirstOrThrow();
    idPerfilAuxiliar = auxiliar.id;

    await crearUsuarioFixture(LOGIN_GENERAL, idPerfilMaestro, null);
    await crearUsuarioFixture(LOGIN_TIJUANA, idPerfilMaestro, idTijuana);
    await crearUsuarioFixture(LOGIN_SIN_PERMISO, idPerfilAuxiliar, null);

    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    if (usuarioIds.length > 0) {
      await db
        .deleteFrom('usuario_permiso')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db
        .deleteFrom('sesion_refresh')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await db
      .deleteFrom('usuario')
      .where('login', 'like', `${PREFIJO}%`)
      .execute();
    // Despues de los usuarios (usuario.perfil_id los referencia, sin cascade):
    // borrar un perfil desechable con usuarios activos violaria la FK.
    if (perfilIds.length > 0) {
      await db
        .deleteFrom('perfil_permiso')
        .where('perfil_id', 'in', perfilIds)
        .execute();
      await db.deleteFrom('perfil').where('id', 'in', perfilIds).execute();
    }
    await app.close();
  });

  describe('GET /usuarios/catalogo-perfiles', () => {
    it('devuelve perfiles con sus permisos y el catalogo completo', async () => {
      const res = await request(app.getHttpServer())
        .get('/usuarios/catalogo-perfiles')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const cuerpo = res.body as MatrizPerfilesRespuesta;
      expect(Array.isArray(cuerpo.permisos)).toBe(true);
      expect(cuerpo.permisos.length).toBeGreaterThan(0);
      const maestro = cuerpo.perfiles.find(
        (p) => p.nombre === 'Administrador General',
      );
      expect(maestro?.esMaestro).toBe(true);
      expect(maestro?.permisos.length).toBe(cuerpo.permisos.length);
    });

    it('rechaza sin usuario.gestionar (D6: la lectura tambien esta gateada)', async () => {
      await request(app.getHttpServer())
        .get('/usuarios/catalogo-perfiles')
        .set('Cookie', cookieSinPermiso)
        .expect(403);
    });

    it('rechaza a quien no tiene sesion', async () => {
      await request(app.getHttpServer())
        .get('/usuarios/catalogo-perfiles')
        .expect(401);
    });
  });
});

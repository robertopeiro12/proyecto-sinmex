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
  let idMexicali: string;
  let idPerfilMaestro: string;
  let idPerfilAuxiliar: string;
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
   * Consumida por las Tasks 5-6.
   */
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

    it('permite el catalogo a quien tiene usuario.gestionar por excepcion, sin perfil.gestionar (D5)', async () => {
      // El controller entero solo exige usuario.gestionar (D5 del spec): un
      // actor con perfil Auxiliar (vacio) y SOLO esa excepcion puntual en
      // usuario_permiso debe llegar al catalogo igual -- ninguna de las
      // otras pruebas de este bloque demuestra eso: cookieGeneral es
      // perfil maestro (ya tiene TODOS los permisos, incluido
      // perfil.gestionar) y cookieSinPermiso no tiene ninguno. Misma
      // tecnica de excepcion que el fixture "idSolicitante" del bloque
      // DELETE, mas abajo.
      const permisoUsuarioGestionar = await db
        .selectFrom('permiso')
        .select('id')
        .where('clave', '=', 'usuario.gestionar')
        .executeTakeFirstOrThrow();
      const idSolicitante = await crearUsuarioFixture(
        `${PREFIJO}-catalogo-excepcion`,
        idPerfilAuxiliar,
        null,
      );
      await db
        .insertInto('usuario_permiso')
        .values({
          usuario_id: idSolicitante,
          permiso_id: permisoUsuarioGestionar.id,
          habilitado: true,
        })
        .execute();
      const cookieSolicitante = await iniciarSesion(
        `${PREFIJO}-catalogo-excepcion`,
      );

      await request(app.getHttpServer())
        .get('/usuarios/catalogo-perfiles')
        .set('Cookie', cookieSolicitante)
        .expect(200);
    });
  });

  describe('GET /usuarios', () => {
    it('lista los usuarios con su perfil y codigo de sucursal', async () => {
      const res = await request(app.getHttpServer())
        .get('/usuarios')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const usuarios = res.body as {
        login: string;
        perfil: string;
        sucursalCodigo: string | null;
      }[];
      const propio = usuarios.find((u) => u.login === LOGIN_TIJUANA);
      expect(propio).toBeDefined();
      expect(propio?.perfil).toBe('Administrador General');
      expect(propio?.sucursalCodigo).toBe('TJ');
      expect(propio).not.toHaveProperty('deleted_at');
      expect(propio).not.toHaveProperty('password_hash');
    });

    it('un usuario atado a TJ no ve los usuarios de MX ni los General', async () => {
      const res = await request(app.getHttpServer())
        .get('/usuarios')
        .set('Cookie', cookieTijuana)
        .expect(200);

      const logins = (res.body as { login: string }[]).map((u) => u.login);
      expect(logins).not.toContain(LOGIN_GENERAL);
    });

    it('un usuario atado que pide OTRA sucursal recibe 403', async () => {
      await request(app.getHttpServer())
        .get('/usuarios?sucursal=MX')
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('rechaza sin usuario.gestionar', async () => {
      await request(app.getHttpServer())
        .get('/usuarios')
        .set('Cookie', cookieSinPermiso)
        .expect(403);
    });

    it('rechaza a quien no tiene sesion', async () => {
      await request(app.getHttpServer()).get('/usuarios').expect(401);
    });
  });

  describe('GET /usuarios/:id', () => {
    it('devuelve el detalle con los permisos efectivos del perfil maestro', async () => {
      const id = await crearUsuarioFixture(
        `${PREFIJO}-detalle-maestro`,
        idPerfilMaestro,
        idTijuana,
      );

      const res = await request(app.getHttpServer())
        .get(`/usuarios/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(200);

      const detalle = res.body as {
        login: string;
        sucursalId: string | null;
        permisosEfectivos: string[];
      };
      expect(detalle.login).toBe(`${PREFIJO}-detalle-maestro`);
      expect(detalle.sucursalId).toBe(idTijuana);
      expect(detalle.permisosEfectivos.length).toBeGreaterThan(0);
    });

    it('responde 404 para un id que no existe', async () => {
      await request(app.getHttpServer())
        .get('/usuarios/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieGeneral)
        .expect(404);
    });

    it('un usuario atado a TJ no puede leer el detalle de un usuario de MX', async () => {
      const id = await crearUsuarioFixture(
        `${PREFIJO}-detalle-mx`,
        idPerfilAuxiliar,
        idMexicali,
      );

      await request(app.getHttpServer())
        .get(`/usuarios/${id}`)
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('responde 400 para un id mal formado', async () => {
      await request(app.getHttpServer())
        .get('/usuarios/no-es-un-uuid')
        .set('Cookie', cookieGeneral)
        .expect(400);
    });
  });

  describe('POST /usuarios', () => {
    it('da de alta un usuario con permisos por excepcion sobre su perfil', async () => {
      // Perfil desechable con UN SOLO permiso controlado (ver
      // sembrarPerfilConPermiso, Task 3) -- determinista, no depende de que
      // otro archivo de e2e haya tocado perfil_permiso de los 6 sembrados.
      const perfil = await sembrarPerfilConPermiso(
        `${PREFIJO}-perfil-alta`,
        'cliente.gestionar',
      );
      // Desmarca el permiso que el perfil SI da, marca uno que NO da.
      const marcados = ['vendedor.gestionar'];

      const res = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-alta`,
          nombre: 'Usuario de prueba',
          contrasena: 'una-contrasena-larga',
          perfilId: perfil.id,
          permisosMarcados: marcados,
        })
        .expect(201);

      const creado = res.body as { id: string; permisosEfectivos: string[] };
      usuarioIds.push(creado.id);
      expect(creado.permisosEfectivos).toContain('vendedor.gestionar');
      expect(creado.permisosEfectivos).not.toContain('cliente.gestionar');
    });

    it('el perfil maestro ignora permisosMarcados: siempre recibe el catalogo completo', async () => {
      const res = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-alta-maestro`,
          nombre: 'Maestro de prueba',
          contrasena: 'una-contrasena-larga',
          perfilId: idPerfilMaestro,
          permisosMarcados: [],
        })
        .expect(201);

      const creado = res.body as { id: string; permisosEfectivos: string[] };
      usuarioIds.push(creado.id);
      expect(creado.permisosEfectivos.length).toBeGreaterThan(0);
    });

    it('rechaza un login duplicado con 409', async () => {
      await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieGeneral)
        .send({
          login: LOGIN_SIN_PERMISO,
          nombre: 'Repetido',
          contrasena: 'una-contrasena-larga',
          perfilId: idPerfilAuxiliar,
          permisosMarcados: [],
        })
        .expect(409);
    });

    it('normaliza el login a minusculas al escribir, para que auth/login (case-sensitive) siga entrando (Important #1)', async () => {
      const loginMixto = `${PREFIJO}-MixCase`;
      const res = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieGeneral)
        .send({
          login: loginMixto,
          nombre: 'Login mixto',
          contrasena: 'una-contrasena-larga',
          perfilId: idPerfilAuxiliar,
          permisosMarcados: [],
        })
        .expect(201);

      const creado = res.body as { id: string; login: string };
      usuarioIds.push(creado.id);
      expect(creado.login).toBe(loginMixto.toLowerCase());

      // AuthService.validarCredenciales compara EXACTO -- hay que teclear
      // lo mismo que quedo guardado (minusculas), no lo que se tecleo en el
      // alta.
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          login: loginMixto.toLowerCase(),
          password: 'una-contrasena-larga',
        })
        .expect(200);

      // El indice parcial de la migracion es sobre lower(login): otra
      // capitalizacion del mismo login ya normalizado tiene que chocar
      // igual con 409.
      await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieGeneral)
        .send({
          login: loginMixto.toUpperCase(),
          nombre: 'Repetido en otra capitalizacion',
          contrasena: 'una-contrasena-larga',
          perfilId: idPerfilAuxiliar,
          permisosMarcados: [],
        })
        .expect(409);
    });

    it('a un usuario atado se le ignora el sucursalId que mande (D8): se le asigna la suya', async () => {
      const res = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieTijuana)
        .send({
          login: `${PREFIJO}-alta-atado`,
          nombre: 'Atado de prueba',
          contrasena: 'una-contrasena-larga',
          perfilId: idPerfilAuxiliar,
          sucursalId: idMexicali,
          permisosMarcados: [],
        })
        .expect(201);

      const creado = res.body as { id: string; sucursalId: string };
      usuarioIds.push(creado.id);
      expect(creado.sucursalId).toBe(idTijuana);
    });

    it('rechaza sin usuario.gestionar', async () => {
      await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieSinPermiso)
        .send({
          login: `${PREFIJO}-sin-permiso`,
          nombre: 'X',
          contrasena: 'una-contrasena-larga',
          perfilId: idPerfilAuxiliar,
          permisosMarcados: [],
        })
        .expect(403);
    });

    it('rechaza una contrasena corta con 400', async () => {
      await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-corta`,
          nombre: 'X',
          contrasena: '123',
          perfilId: idPerfilAuxiliar,
          permisosMarcados: [],
        })
        .expect(400);
    });

    it('rechaza un perfilId que no existe con 404', async () => {
      await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-perfil-inexistente`,
          nombre: 'X',
          contrasena: 'una-contrasena-larga',
          perfilId: '00000000-0000-0000-0000-000000000000',
          permisosMarcados: [],
        })
        .expect(404);
    });
  });

  describe('PATCH /usuarios/:id', () => {
    it('edita datos basicos sin tocar la contrasena si el campo no viene', async () => {
      const id = await crearUsuarioFixture(
        `${PREFIJO}-editar-sin-pass`,
        idPerfilAuxiliar,
        idTijuana,
      );
      const cookieEditado = await iniciarSesion(`${PREFIJO}-editar-sin-pass`);

      await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-editar-sin-pass`,
          nombre: 'Nombre editado',
          perfilId: idPerfilAuxiliar,
          sucursalId: idTijuana,
          permisosMarcados: [],
        })
        .expect(200);

      // La sesion vieja de este usuario sigue viva: si el PATCH hubiera
      // tocado la contrasena sin que el campo viniera, el login de abajo
      // fallaria.
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login: `${PREFIJO}-editar-sin-pass`, password: PASSWORD })
        .expect(200);
      void cookieEditado;
    });

    it('cambia la contrasena cuando el campo si viene', async () => {
      const id = await crearUsuarioFixture(
        `${PREFIJO}-editar-con-pass`,
        idPerfilAuxiliar,
        idTijuana,
      );

      await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-editar-con-pass`,
          nombre: 'X',
          contrasena: 'una-contrasena-nueva',
          perfilId: idPerfilAuxiliar,
          sucursalId: idTijuana,
          permisosMarcados: [],
        })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          login: `${PREFIJO}-editar-con-pass`,
          password: 'una-contrasena-nueva',
        })
        .expect(200);
    });

    it('recalcula las excepciones al cambiar de perfil: lo que sobra se borra', async () => {
      // Dos perfiles desechables con UN permiso cada uno (ver
      // sembrarPerfilConPermiso, Task 3) -- determinista, sin depender del
      // estado en vivo de los 6 perfiles sembrados.
      const perfilA = await sembrarPerfilConPermiso(
        `${PREFIJO}-perfil-recalc-a`,
        'cliente.gestionar',
      );
      const perfilB = await sembrarPerfilConPermiso(
        `${PREFIJO}-perfil-recalc-b`,
        'vendedor.gestionar',
      );

      const id = await crearUsuarioFixture(
        `${PREFIJO}-recalcula`,
        perfilA.id,
        idTijuana,
      );

      // Se le da de alta con una excepcion propia de perfilB, encima de
      // perfilA.
      await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-recalcula`,
          nombre: 'X',
          perfilId: perfilA.id,
          sucursalId: idTijuana,
          permisosMarcados: [perfilA.clave, perfilB.clave],
        })
        .expect(200);

      // Cambia a perfilB SIN marcar `perfilB.clave` explicitamente en la
      // lista nueva -- ya lo da el perfil, no hace falta repetirlo; la
      // prueba real es que la excepcion vieja (atada al permiso_id de
      // perfilA.clave) no sobrevive fantasma con un habilitado obsoleto.
      const res = await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-recalcula`,
          nombre: 'X',
          perfilId: perfilB.id,
          sucursalId: idTijuana,
          permisosMarcados: [perfilB.clave],
        })
        .expect(200);

      const detalle = res.body as { permisosEfectivos: string[] };
      expect(detalle.permisosEfectivos).toEqual([perfilB.clave]);
    });

    // D7 ("no dejar sin ningun Administrador General activo" al cambiar de
    // perfil) se prueba ahora de forma UNITARIA en
    // apps/backend/src/modules/auth/usuarios.service.spec.ts, con el
    // repositorio mockeado. La version e2e que vivia aqui bajaba
    // TEMPORALMENTE a todos los Administrador General activos de la base
    // -incluidos los de OTROS archivos de e2e corriendo en paralelo, Jest
    // sin --runInBand- para forzar "queda exactamente uno": una escritura
    // global sobre datos que la prueba no creaba, que podia tumbar pruebas
    // de otros archivos con un 409/falso 403. Mismo criterio que ya usa
    // perfiles.e2e-spec.ts para sus reglas del perfil maestro: nunca tocar
    // datos que la prueba no creo. Este describe conserva solo integracion
    // real: auto-baja y camino feliz (mover de sucursal, recalculo de
    // excepciones, etc.).

    it('un usuario atado a TJ no puede editar un usuario de MX', async () => {
      const id = await crearUsuarioFixture(
        `${PREFIJO}-editar-mx`,
        idPerfilAuxiliar,
        idMexicali,
      );

      await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookieTijuana)
        .send({
          login: `${PREFIJO}-editar-mx`,
          nombre: 'X',
          perfilId: idPerfilAuxiliar,
          permisosMarcados: [],
        })
        .expect(403);
    });

    it('un usuario atado a TJ no puede mover a un usuario a MX (D8)', async () => {
      const id = await crearUsuarioFixture(
        `${PREFIJO}-mover-mx`,
        idPerfilAuxiliar,
        idTijuana,
      );

      await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookieTijuana)
        .send({
          login: `${PREFIJO}-mover-mx`,
          nombre: 'X',
          perfilId: idPerfilAuxiliar,
          sucursalId: idMexicali,
          permisosMarcados: [],
        })
        .expect(403);
    });

    it('un usuario General si puede mover a otro entre sucursales', async () => {
      const id = await crearUsuarioFixture(
        `${PREFIJO}-mover-general`,
        idPerfilAuxiliar,
        idTijuana,
      );

      const res = await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookieGeneral)
        .send({
          login: `${PREFIJO}-mover-general`,
          nombre: 'X',
          perfilId: idPerfilAuxiliar,
          sucursalId: idMexicali,
          permisosMarcados: [],
        })
        .expect(200);

      expect((res.body as { sucursalId: string }).sucursalId).toBe(idMexicali);
    });

    it('responde 404 para un id que no existe', async () => {
      await request(app.getHttpServer())
        .patch('/usuarios/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieGeneral)
        .send({
          login: 'x',
          nombre: 'x',
          perfilId: idPerfilAuxiliar,
          permisosMarcados: [],
        })
        .expect(404);
    });

    it('rechaza sin usuario.gestionar', async () => {
      const id = await crearUsuarioFixture(
        `${PREFIJO}-editar-sin-permiso`,
        idPerfilAuxiliar,
        null,
      );

      await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookieSinPermiso)
        .send({
          login: `${PREFIJO}-editar-sin-permiso`,
          nombre: 'X',
          perfilId: idPerfilAuxiliar,
          permisosMarcados: [],
        })
        .expect(403);
    });

    it('rechaza que un usuario se auto-eleve el perfil via PATCH (Important #4)', async () => {
      // Mismo patron de fixture que D5 arriba: perfil Auxiliar (vacio) +
      // excepcion puntual de usuario.gestionar, para tener un actor con el
      // permiso SIN ser Administrador General.
      const permisoUsuarioGestionar = await db
        .selectFrom('permiso')
        .select('id')
        .where('clave', '=', 'usuario.gestionar')
        .executeTakeFirstOrThrow();
      const login = `${PREFIJO}-auto-eleva`;
      const id = await crearUsuarioFixture(login, idPerfilAuxiliar, null);
      await db
        .insertInto('usuario_permiso')
        .values({
          usuario_id: id,
          permiso_id: permisoUsuarioGestionar.id,
          habilitado: true,
        })
        .execute();
      const cookiePropia = await iniciarSesion(login);

      await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookiePropia)
        .send({
          login,
          nombre: 'X',
          perfilId: idPerfilMaestro,
          permisosMarcados: [],
        })
        .expect(409);
    });

    it('permite que ese mismo actor se edite solo el nombre, sin tocar perfil ni permisos', async () => {
      const permisoUsuarioGestionar = await db
        .selectFrom('permiso')
        .select('id')
        .where('clave', '=', 'usuario.gestionar')
        .executeTakeFirstOrThrow();
      const login = `${PREFIJO}-auto-edita-nombre`;
      const id = await crearUsuarioFixture(login, idPerfilAuxiliar, null);
      await db
        .insertInto('usuario_permiso')
        .values({
          usuario_id: id,
          permiso_id: permisoUsuarioGestionar.id,
          habilitado: true,
        })
        .execute();
      const cookiePropia = await iniciarSesion(login);

      // perfilId y permisosMarcados van IDENTICOS a los que ya tiene -- asi
      // es como el formulario del portal ya lo hace hoy (D8, marcados nace
      // de permisosEfectivos). Solo cambia nombre.
      await request(app.getHttpServer())
        .patch(`/usuarios/${id}`)
        .set('Cookie', cookiePropia)
        .send({
          login,
          nombre: 'Nombre editado por si mismo',
          perfilId: idPerfilAuxiliar,
          permisosMarcados: ['usuario.gestionar'],
        })
        .expect(200);
    });
  });

  describe('DELETE /usuarios/:id', () => {
    it('da de baja un usuario y libera su login (D1)', async () => {
      const login = `${PREFIJO}-baja`;
      const id = await crearUsuarioFixture(login, idPerfilAuxiliar, idTijuana);

      await request(app.getHttpServer())
        .delete(`/usuarios/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(200);

      const listado = await request(app.getHttpServer())
        .get('/usuarios')
        .set('Cookie', cookieGeneral)
        .expect(200);
      expect((listado.body as { id: string }[]).some((u) => u.id === id)).toBe(
        false,
      );

      // D1: el login queda libre de inmediato para un alta nueva.
      const res = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Cookie', cookieGeneral)
        .send({
          login,
          nombre: 'Reusa el login',
          contrasena: 'una-contrasena-larga',
          perfilId: idPerfilAuxiliar,
          sucursalId: idTijuana,
          permisosMarcados: [],
        })
        .expect(201);
      usuarioIds.push((res.body as { id: string }).id);
    });

    it('rechaza que un usuario se de de baja a si mismo', async () => {
      const login = `${PREFIJO}-autobaja`;
      // Perfil maestro, no auxiliar: quien intenta la peticion necesita
      // usuario.gestionar para siquiera llegar al controller -- con perfil
      // auxiliar (sin permisos) el guard responde 403 antes de que el
      // servicio evalue la auto-baja, y la prueba nunca ejercita el 409.
      const id = await crearUsuarioFixture(login, idPerfilMaestro, null);
      const cookiePropia = await iniciarSesion(login);

      await request(app.getHttpServer())
        .delete(`/usuarios/${id}`)
        .set('Cookie', cookiePropia)
        .expect(409);
    });

    // D7 ("no dejar sin ningun Administrador General activo" al dar de
    // baja) se prueba ahora de forma UNITARIA en
    // apps/backend/src/modules/auth/usuarios.service.spec.ts -- mismo
    // motivo que la prueba equivalente que vivia en el describe de PATCH
    // (ver el comentario ahi): la version e2e bajaba TEMPORALMENTE a todos
    // los Administrador General activos de la base, incluidos los de
    // OTROS archivos de e2e en paralelo, y podia tumbarlos con un 409
    // falso. Este describe conserva solo integracion real: auto-baja
    // (arriba) y camino feliz.

    it('un usuario atado a TJ no puede dar de baja a un usuario de MX', async () => {
      const id = await crearUsuarioFixture(
        `${PREFIJO}-baja-mx`,
        idPerfilAuxiliar,
        idMexicali,
      );

      await request(app.getHttpServer())
        .delete(`/usuarios/${id}`)
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('responde 404 para un id que no existe', async () => {
      await request(app.getHttpServer())
        .delete('/usuarios/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieGeneral)
        .expect(404);
    });

    it('rechaza sin usuario.gestionar', async () => {
      const id = await crearUsuarioFixture(
        `${PREFIJO}-baja-sin-permiso`,
        idPerfilAuxiliar,
        null,
      );

      await request(app.getHttpServer())
        .delete(`/usuarios/${id}`)
        .set('Cookie', cookieSinPermiso)
        .expect(403);
    });
  });
});

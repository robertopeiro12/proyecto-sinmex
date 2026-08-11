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
const LOGIN_SIN_PERMISO = `e2e-suc-sin-${SUFIJO}`;
const LOGIN_CON_EXCEPCION = `e2e-suc-exc-${SUFIJO}`;
const LOGIN_EXCEPCION_BORRADA = `e2e-suc-exb-${SUFIJO}`;
const LOGIN_PERFIL_GRANT = `e2e-suc-pfg-${SUFIJO}`;
const LOGIN_PERFIL_REVOCADO = `e2e-suc-pfr-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';

// Codigos reservados para las pruebas. Se limpian en afterAll: el espacio de
// codigos es minusculo (2 letras) y una corrida que deje basura envenenaria
// las siguientes con 409 inesperados. Nunca uses TJ ni MX aqui: son semillas
// reales y borrarlas romperia el resto de la suite.
const CODIGOS_DE_PRUEBA = ['ZA', 'ZB', 'ZC', 'ZD', 'ZE', 'ZF', 'ZG', 'ZH'];

describe('Sucursales (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let usuarioIds: string[] = [];
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let cookieConExcepcion: string;
  let cookieExcepcionBorrada: string;
  let cookiePerfilGrant: string;
  let cookiePerfilRevocado: string;
  let idMexicali: string;
  let idConExcepcion: string;
  let perfilAuxiliarId: string;
  let permisoSucursalId: string;

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

    // Explicito, no "el primero alfabeticamente": desde T-08a el perfil decide
    // los permisos, y 'Administrador' (que es el primero por orden) esta VACIO
    // como los otros cinco. Solo el maestro pasa el guard (D1).
    const perfil = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Administrador General')
      .executeTakeFirstOrThrow();

    const perfilSinPermisos = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Auxiliar Administrativo')
      .executeTakeFirstOrThrow();
    perfilAuxiliarId = perfilSinPermisos.id;

    const tijuana = await db
      .selectFrom('sucursal')
      .select('id')
      .where('codigo', '=', 'TJ')
      .executeTakeFirstOrThrow();

    const mexicali = await db
      .selectFrom('sucursal')
      .select('id')
      .where('codigo', '=', 'MX')
      .executeTakeFirstOrThrow();
    idMexicali = mexicali.id;

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

    // Auxiliar Administrativo: perfil vacio, o sea sin sucursal.gestionar.
    const sinPermiso = await db
      .insertInto('usuario')
      .values({
        login: LOGIN_SIN_PERMISO,
        nombre: 'Usuario sin permiso e2e',
        password_hash: hash,
        perfil_id: perfilSinPermisos.id,
        sucursal_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Mismo perfil vacio, pero con el permiso concedido POR EXCEPCION. Es el
    // camino no-maestro de D3 probado de punta a punta: sin este usuario, la
    // unica forma de pasar el guard en toda la suite seria el bypass del
    // maestro, y la mezcla perfil+excepcion quedaria sin verificar contra la
    // base de verdad.
    const conExcepcion = await db
      .insertInto('usuario')
      .values({
        login: LOGIN_CON_EXCEPCION,
        nombre: 'Usuario con excepcion e2e',
        password_hash: hash,
        perfil_id: perfilSinPermisos.id,
        sucursal_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    idConExcepcion = conExcepcion.id;

    const permisoSucursal = await db
      .selectFrom('permiso')
      .select('id')
      .where('clave', '=', 'sucursal.gestionar')
      .executeTakeFirstOrThrow();
    permisoSucursalId = permisoSucursal.id;

    // Mismo caso, pero con la excepcion dada de BAJA: debe comportarse como si
    // no existiera.
    const excepcionBorrada = await db
      .insertInto('usuario')
      .values({
        login: LOGIN_EXCEPCION_BORRADA,
        nombre: 'Usuario con excepcion borrada e2e',
        password_hash: hash,
        perfil_id: perfilSinPermisos.id,
        sucursal_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Concedido por el PERFIL (no por excepcion): ejercita clavesDelPerfil()
    // contra Postgres de verdad. Hallazgo 1 del review final de T-08a. El
    // perfil sigue vacio hasta que el describe de abajo le agrega la fila de
    // perfil_permiso — insertarla aqui romperia 'sin el permiso, crear
    // responde 403' de mas arriba, que corre con este mismo perfil vacio.
    const conPermisoDePerfil = await db
      .insertInto('usuario')
      .values({
        login: LOGIN_PERFIL_GRANT,
        nombre: 'Usuario con permiso por perfil e2e',
        password_hash: hash,
        perfil_id: perfilSinPermisos.id,
        sucursal_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Mismo permiso concedido por el perfil, pero con una excepcion
    // habilitado:false encima. Prueba el otro sentido de D3 contra la base de
    // verdad: la excepcion gana aunque el perfil SI conceda el permiso, no
    // solo cuando el perfil calla (ese caso ya lo cubre excepcionBorrada).
    const perfilConExcepcionRevocada = await db
      .insertInto('usuario')
      .values({
        login: LOGIN_PERFIL_REVOCADO,
        nombre: 'Usuario con permiso por perfil revocado por excepcion e2e',
        password_hash: hash,
        perfil_id: perfilSinPermisos.id,
        sucursal_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('usuario_permiso')
      .values([
        {
          usuario_id: conExcepcion.id,
          permiso_id: permisoSucursal.id,
          habilitado: true,
        },
        {
          usuario_id: excepcionBorrada.id,
          permiso_id: permisoSucursal.id,
          habilitado: true,
          deleted_at: new Date(),
        },
        {
          usuario_id: perfilConExcepcionRevocada.id,
          permiso_id: permisoSucursal.id,
          habilitado: false,
        },
      ])
      .execute();

    usuarioIds = [
      general.id,
      deTijuana.id,
      sinPermiso.id,
      conExcepcion.id,
      excepcionBorrada.id,
      conPermisoDePerfil.id,
      perfilConExcepcionRevocada.id,
    ];

    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
    cookieConExcepcion = await iniciarSesion(LOGIN_CON_EXCEPCION);
    cookieExcepcionBorrada = await iniciarSesion(LOGIN_EXCEPCION_BORRADA);
    cookiePerfilGrant = await iniciarSesion(LOGIN_PERFIL_GRANT);
    cookiePerfilRevocado = await iniciarSesion(LOGIN_PERFIL_REVOCADO);
  });

  afterAll(async () => {
    await db
      .deleteFrom('sucursal')
      .where('codigo', 'in', CODIGOS_DE_PRUEBA)
      .execute();
    // El perfil 'Auxiliar Administrativo' es semilla compartida, no algo que
    // esta suite cree y borre por test: la fila de perfil_permiso agregada en
    // el describe de mas abajo tiene que quitarse aqui o el perfil quedaria
    // con sucursal.gestionar para siempre, envenenando cualquier corrida
    // posterior de esta u otra suite que use el mismo perfil.
    await db
      .deleteFrom('perfil_permiso')
      .where('perfil_id', '=', perfilAuxiliarId)
      .where('permiso_id', '=', permisoSucursalId)
      .execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db
      .deleteFrom('usuario_permiso')
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

  describe('POST /sucursales', () => {
    it('sin sesion responde 401', async () => {
      await request(app.getHttpServer())
        .post('/sucursales')
        .send({ codigo: 'ZA', nombre: 'Zapopan' })
        .expect(401);
    });

    it('crea una sucursal y aparece en el listado', async () => {
      const res = await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', [cookieGeneral])
        .send({ codigo: 'ZA', nombre: 'Zapopan' })
        .expect(201);

      expect(res.body).toMatchObject({
        codigo: 'ZA',
        nombre: 'Zapopan',
        activa: true, // default de la tabla
      });

      const listado = await request(app.getHttpServer())
        .get('/sucursales')
        .set('Cookie', [cookieGeneral])
        .expect(200);

      const codigos = (listado.body as SucursalRespuesta[]).map(
        (s) => s.codigo,
      );
      expect(codigos).toContain('ZA');
    });

    it('rechaza un codigo repetido con 409 y un mensaje que nombra el codigo', async () => {
      // Depende de que el test anterior ya creo ZA. Se afirma el mensaje y no
      // solo el status porque el portal lo muestra tal cual junto al campo:
      // si degradara a un texto generico, la pantalla empeoraria en silencio.
      const res = await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', [cookieGeneral])
        .send({ codigo: 'ZA', nombre: 'Otro Zapopan' })
        .expect(409);

      expect((res.body as { message: string }).message).toContain('ZA');
    });

    it.each([
      ['Z', 'una letra'],
      ['ZAB', 'tres letras'],
      ['Z1', 'con digito'],
    ])('rechaza el codigo "%s" (%s) con 400', async (codigo) => {
      await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', [cookieGeneral])
        .send({ codigo, nombre: 'Invalida' })
        .expect(400);
    });

    it('acepta un codigo en minusculas y lo guarda en mayusculas', async () => {
      // La API la van a llamar tambien scripts y, mas adelante, la app tablet.
      // Rechazar 'zb' por la capitalizacion seria pedantico: el check de la
      // base exige mayusculas, asi que se normaliza antes de validar.
      const res = await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', [cookieGeneral])
        .send({ codigo: 'zb', nombre: 'Zamora' })
        .expect(201);

      expect((res.body as SucursalRespuesta).codigo).toBe('ZB');
    });

    it('rechaza un nombre vacio con 400', async () => {
      await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', [cookieGeneral])
        .send({ codigo: 'ZC', nombre: '   ' })
        .expect(400);
    });
  });

  describe('PATCH /sucursales/:id', () => {
    let idZacatecas: string;

    // La sucursal de trabajo se crea UNA vez aqui y no dentro del primer test.
    // Si cada test la buscara por codigo, quedarian encadenados en un orden
    // implicito: un fallo en el primero haria fallar a los demas por no
    // encontrarla, y el reporte senalaria al test equivocado.
    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', [cookieGeneral])
        .send({ codigo: 'ZC', nombre: 'Zacatecas' })
        .expect(201);
      idZacatecas = (res.body as SucursalRespuesta).id;
    });

    it('sin sesion responde 401', async () => {
      await request(app.getHttpServer())
        .patch(`/sucursales/${idZacatecas}`)
        .send({ nombre: 'Otro' })
        .expect(401);
    });

    it('cambia el nombre', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/sucursales/${idZacatecas}`)
        .set('Cookie', [cookieGeneral])
        .send({ nombre: 'Zacatecas Centro' })
        .expect(200);

      expect((res.body as SucursalRespuesta).nombre).toBe('Zacatecas Centro');
    });

    it('desactiva la sucursal sin sacarla del listado', async () => {
      await request(app.getHttpServer())
        .patch(`/sucursales/${idZacatecas}`)
        .set('Cookie', [cookieGeneral])
        .send({ activa: false })
        .expect(200);

      // Desactivar NO es borrar (D6): la sucursal tiene que seguir visible en
      // el catalogo para poder reactivarla, y sus ventas y folios historicos
      // siguen apuntando a ella.
      const listado = await request(app.getHttpServer())
        .get('/sucursales')
        .set('Cookie', [cookieGeneral])
        .expect(200);

      const zc = (listado.body as SucursalRespuesta[]).find(
        (s) => s.codigo === 'ZC',
      );
      expect(zc).toBeDefined();
      expect(zc?.activa).toBe(false);
    });

    it('ignora un intento de cambiar el codigo', async () => {
      // El codigo abre los folios historicos (D5). No esta en EditarSucursalDto,
      // asi que el ValidationPipe (whitelist: true) lo descarta antes de llegar
      // al servicio. Si alguien lo agregara al DTO por descuido, este test cae.
      const res = await request(app.getHttpServer())
        .patch(`/sucursales/${idZacatecas}`)
        .set('Cookie', [cookieGeneral])
        .send({ codigo: 'ZZ', nombre: 'Zacatecas Centro' })
        .expect(200);

      expect((res.body as SucursalRespuesta).codigo).toBe('ZC');
    });

    it('un id inexistente responde 404', async () => {
      await request(app.getHttpServer())
        .patch('/sucursales/00000000-0000-4000-8000-000000000000')
        .set('Cookie', [cookieGeneral])
        .send({ nombre: 'Fantasma' })
        .expect(404);
    });

    it('un id que no es uuid responde 400', async () => {
      // Sin ParseUUIDPipe esto llegaria a Postgres y reventaria como 500
      // (22P02, invalid input syntax for type uuid).
      await request(app.getHttpServer())
        .patch('/sucursales/no-soy-un-uuid')
        .set('Cookie', [cookieGeneral])
        .send({ nombre: 'Fantasma' })
        .expect(400);
    });

    it('un cuerpo sin ningun cambio responde 400', async () => {
      await request(app.getHttpServer())
        .patch(`/sucursales/${idZacatecas}`)
        .set('Cookie', [cookieGeneral])
        .send({})
        .expect(400);
    });

    it('un usuario de Tijuana no puede editar Mexicali', async () => {
      // La otra mitad de D3: el alcance no es solo de lectura.
      await request(app.getHttpServer())
        .patch(`/sucursales/${idMexicali}`)
        .set('Cookie', [cookieTijuana])
        .send({ nombre: 'Mexicali Secuestrada' })
        .expect(403);
    });
  });

  describe('permiso sucursal.gestionar (T-08a)', () => {
    it('sin el permiso, crear responde 403', async () => {
      await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', cookieSinPermiso)
        .send({ codigo: 'ZC', nombre: 'Sucursal sin permiso' })
        .expect(403);
    });

    it('sin el permiso, editar responde 403', async () => {
      await request(app.getHttpServer())
        .patch(`/sucursales/${idMexicali}`)
        .set('Cookie', cookieSinPermiso)
        .send({ nombre: 'Mexicali editada sin permiso' })
        .expect(403);
    });

    // La prueba que defiende D4. El selector "Por sucursal" de T-09 vive en la
    // barra lateral de TODAS las paginas y se pinta con este GET: ponerle el
    // permiso romperia el filtro global para casi todos los usuarios. Si
    // alguien le cuelga un @RequierePermiso por descuido, esto se cae primero.
    it('sin el permiso, listar sigue respondiendo 200', async () => {
      await request(app.getHttpServer())
        .get('/sucursales')
        .set('Cookie', cookieSinPermiso)
        .expect(200);
    });

    it('con el permiso concedido por excepcion, crear responde 201', async () => {
      // 'ZD' y no 'ZC': 'ZC' ya quedo creado (y activo) por el beforeAll de
      // PATCH /sucursales/:id mas arriba en este mismo archivo, asi que
      // reusarlo aqui chocaria con el unique de la base (409) sin que tenga
      // nada que ver con el permiso bajo prueba.
      const res = await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', cookieConExcepcion)
        .send({ codigo: 'ZD', nombre: 'Sucursal por excepcion' })
        .expect(201);
      expect((res.body as SucursalRespuesta).codigo).toBe('ZD');
    });

    // Baja logica: una excepcion con deleted_at ya no cuenta. Sin esta prueba,
    // olvidar un `where deleted_at is null` en excepcionesDe() pasaria
    // inadvertido — y el sintoma seria que revocar un permiso no revoca nada.
    it('una excepcion dada de baja no concede el permiso', async () => {
      await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', cookieExcepcionBorrada)
        .send({ codigo: 'ZD', nombre: 'Sucursal con excepcion borrada' })
        .expect(403);
    });

    // D2: el guard consulta la base en CADA peticion, no solo al hacer login.
    // Toda otra prueba de esta suite resuelve los permisos ANTES del login, asi
    // que ninguna notaria una regresion que empezara a leer los permisos del
    // JWT en vez de volver a consultar la base. Esta si: la MISMA cookie pasa
    // de 201 a 403 sin volver a iniciar sesion, solo porque la excepcion que la
    // sostenia se borro a mitad de sesion.
    //
    // Va AL FINAL de ESTE describe, y no del que sigue, por diseno: el
    // describe de abajo le concede sucursal.gestionar al perfil 'Auxiliar
    // Administrativo' completo (perfil_permiso), el mismo perfil de
    // cookieConExcepcion. Si esta prueba corriera despues de esa concesion, la
    // excepcion revocada dejaria de importar -- el perfil ya cubriria el
    // permiso por su cuenta -- y la prueba dejaria de probar D2.
    it('revocar la excepcion a mitad de sesion tumba el permiso en la siguiente peticion, con la MISMA cookie', async () => {
      const antes = await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', cookieConExcepcion)
        .send({ codigo: 'ZF', nombre: 'Antes de revocar' })
        .expect(201);
      expect((antes.body as SucursalRespuesta).codigo).toBe('ZF');

      await db
        .updateTable('usuario_permiso')
        .set({ deleted_at: new Date() })
        .where('usuario_id', '=', idConExcepcion)
        .where('permiso_id', '=', permisoSucursalId)
        .execute();

      await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', cookieConExcepcion)
        .send({ codigo: 'ZG', nombre: 'Despues de revocar' })
        .expect(403);
    });
  });

  // Hallazgo 1 del review final de T-08a. Va DESPUES del describe de arriba a
  // proposito: su beforeAll le concede sucursal.gestionar al perfil 'Auxiliar
  // Administrativo' completo (perfil_permiso, no usuario_permiso), y ese
  // perfil es el mismo que usan cookieSinPermiso/cookieConExcepcion/
  // cookieExcepcionBorrada de arriba. Si este describe corriera antes, esos
  // usuarios dejarian de estar "sin permiso" y las pruebas de mas arriba (que
  // esperan 403, incluida la de D2) fallarian por una razon que no tiene nada
  // que ver con lo que prueban.
  describe('permiso sucursal.gestionar via perfil (T-08a)', () => {
    beforeAll(async () => {
      // Ejercita clavesDelPerfil() (perfil_permiso -> permiso) contra Postgres
      // de verdad: hasta este punto los 6 perfiles sembrados estan vacios y
      // nadie no-maestro habia pasado el guard por esta via, solo por
      // excepcion.
      await db
        .insertInto('perfil_permiso')
        .values({
          perfil_id: perfilAuxiliarId,
          permiso_id: permisoSucursalId,
        })
        .execute();
    });

    it('con el permiso concedido por el perfil (sin excepcion), crear responde 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', cookiePerfilGrant)
        .send({ codigo: 'ZE', nombre: 'Sucursal por perfil' })
        .expect(201);

      expect((res.body as SucursalRespuesta).codigo).toBe('ZE');
    });

    // La otra mitad de D3 contra la base de verdad: la excepcion gana aunque
    // el perfil SI conceda el permiso, no solo cuando el perfil calla.
    it('una excepcion habilitado:false revoca un permiso que SI concede el perfil', async () => {
      await request(app.getHttpServer())
        .post('/sucursales')
        .set('Cookie', cookiePerfilRevocado)
        .send({
          codigo: 'ZH',
          nombre: 'Sucursal perfil revocado por excepcion',
        })
        .expect(403);
    });
  });
});

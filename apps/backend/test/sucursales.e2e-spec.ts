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
  let idMexicali: string;

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
});

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

interface VehiculoRespuesta {
  id: string;
  nombre: string;
  kmInicial: number | null;
  sucursalId: string;
  sucursalCodigo: string;
  activo: boolean;
}

const SUFIJO = Date.now();
const LOGIN_GENERAL = `e2e-veh-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-veh-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-veh-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';

// Prefijo reservado: la limpieza de afterAll borra por `nombre like`. Sin el,
// una corrida que deje basura envenena la siguiente con 409 inesperados.
const PREFIJO = `ZZ-e2e-${SUFIJO}`;

describe('Vehiculos (e2e)', () => {
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

  /** Inserta un vehiculo por debajo de la API, para preparar escenarios. */
  const sembrarVehiculo = async (
    nombre: string,
    sucursalId: string,
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vehiculo')
      .values({ nombre, sucursal_id: sucursalId, km_inicial: 1000 })
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

    // Los DOS primeros usuarios son el corazon de la suite: con uno solo, la
    // regla de alcance (D2/D3) queda sin verificar de punta a punta.
    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', idTijuana);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);

    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    await db
      .deleteFrom('vehiculo')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    if (usuarioIds.length > 0) {
      // `iniciarSesion` deja una fila en `sesion_refresh`: hay que borrarla
      // antes que el usuario o el FK truena (mismo orden que
      // sucursales.e2e-spec.ts).
      await db
        .deleteFrom('sesion_refresh')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await app.close();
  });

  describe('GET /vehiculos', () => {
    it('lista los vehiculos con su codigo de sucursal y el km como numero', async () => {
      await sembrarVehiculo(`${PREFIJO} Listar TJ`, idTijuana);

      const res = await request(app.getHttpServer())
        .get('/vehiculos')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const vehiculos = res.body as VehiculoRespuesta[];
      const propio = vehiculos.find((v) => v.nombre === `${PREFIJO} Listar TJ`);
      expect(propio).toBeDefined();
      expect(propio?.sucursalCodigo).toBe('TJ');
      expect(propio?.activo).toBe(true);
      // `numeric` de Postgres llega como cadena si nadie lo convierte. Esta
      // asercion es la red que atrapa esa regresion.
      expect(typeof propio?.kmInicial).toBe('number');
      expect(propio?.kmInicial).toBe(1000);
      expect(propio).not.toHaveProperty('deleted_at');
    });

    it('un usuario atado a TJ no ve los vehiculos de MX', async () => {
      await sembrarVehiculo(`${PREFIJO} Solo MX`, idMexicali);

      const res = await request(app.getHttpServer())
        .get('/vehiculos')
        .set('Cookie', cookieTijuana)
        .expect(200);

      const nombres = (res.body as VehiculoRespuesta[]).map((v) => v.nombre);
      expect(nombres).not.toContain(`${PREFIJO} Solo MX`);
    });

    it('un usuario atado que pide "todas" recibe la suya, no un 403', async () => {
      await request(app.getHttpServer())
        .get('/vehiculos?sucursal=todas')
        .set('Cookie', cookieTijuana)
        .expect(200);
    });

    it('un usuario atado que pide OTRA sucursal recibe 403', async () => {
      await request(app.getHttpServer())
        .get('/vehiculos?sucursal=MX')
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('el usuario General puede filtrar por una sucursal concreta', async () => {
      const res = await request(app.getHttpServer())
        .get('/vehiculos?sucursal=MX')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const codigos = (res.body as VehiculoRespuesta[]).map(
        (v) => v.sucursalCodigo,
      );
      expect(codigos.every((c) => c === 'MX')).toBe(true);
    });

    // Defiende D5 del spec: si alguien le pone el candado al GET, Rutas (T-38)
    // y los reportes se quedan sin catalogo de vehiculos.
    it('deja listar aunque el usuario no tenga vehiculo.gestionar', async () => {
      await request(app.getHttpServer())
        .get('/vehiculos')
        .set('Cookie', cookieSinPermiso)
        .expect(200);
    });

    it('rechaza a quien no tiene sesion', async () => {
      await request(app.getHttpServer()).get('/vehiculos').expect(401);
    });
  });

  describe('POST /vehiculos', () => {
    it('un usuario atado crea en SU sucursal sin mandarla', async () => {
      const res = await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Nissan TJ`, kmInicial: 145230.5 })
        .expect(201);

      const vehiculo = res.body as VehiculoRespuesta;
      expect(vehiculo.sucursalCodigo).toBe('TJ');
      expect(vehiculo.kmInicial).toBe(145230.5);
      expect(vehiculo.activo).toBe(true);
    });

    // D3: el cliente propone, el servidor dispone. Mandar otra sucursal no es un
    // intento de escalada (el formulario ni siquiera pinta el campo para el), es
    // un cuerpo que sobra: se ignora en silencio, no se responde 403.
    it('a un usuario atado se le IGNORA el sucursalId que mande', async () => {
      const res = await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({
          nombre: `${PREFIJO} Colado`,
          kmInicial: 100,
          sucursalId: idMexicali,
        })
        .expect(201);

      expect((res.body as VehiculoRespuesta).sucursalCodigo).toBe('TJ');
    });

    it('el usuario General elige la sucursal', async () => {
      const res = await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} Nissan MX`,
          kmInicial: 200,
          sucursalId: idMexicali,
        })
        .expect(201);

      expect((res.body as VehiculoRespuesta).sucursalCodigo).toBe('MX');
    });

    it('el usuario General sin sucursalId recibe 400', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Sin sucursal`, kmInicial: 300 })
        .expect(400);
    });

    it('rechaza un nombre repetido en la misma sucursal con 409', async () => {
      const cuerpo = { nombre: `${PREFIJO} Repetido`, kmInicial: 400 };
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send(cuerpo)
        .expect(201);

      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send(cuerpo)
        .expect(409);
    });

    it('rechaza un nombre repetido que solo cambia en mayusculas', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Mayusculas`, kmInicial: 500 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} MAYUSCULAS`, kmInicial: 500 })
        .expect(409);
    });

    // D4: el indice no filtra por `activo`, asi que desactivar no libera el
    // nombre. Lo que se quiere en ese caso es reactivar, no duplicar.
    it('un vehiculo desactivado sigue reservando su nombre', async () => {
      const id = await sembrarVehiculo(`${PREFIJO} Dormido`, idTijuana);
      await db
        .updateTable('vehiculo')
        .set({ activo: false })
        .where('id', '=', id)
        .execute();

      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Dormido`, kmInicial: 600 })
        .expect(409);
    });

    it('acepta el mismo nombre en dos sucursales distintas', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} Compartido`,
          kmInicial: 700,
          sucursalId: idTijuana,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} Compartido`,
          kmInicial: 700,
          sucursalId: idMexicali,
        })
        .expect(201);
    });

    it('rechaza crear sin el permiso vehiculo.gestionar', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieSinPermiso)
        .send({ nombre: `${PREFIJO} Prohibido`, kmInicial: 800 })
        .expect(403);
    });

    it('rechaza un kilometraje negativo con 400', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Negativo`, kmInicial: -1 })
        .expect(400);
    });

    it('rechaza un nombre vacio con 400', async () => {
      await request(app.getHttpServer())
        .post('/vehiculos')
        .set('Cookie', cookieTijuana)
        .send({ nombre: '   ', kmInicial: 900 })
        .expect(400);
    });
  });

  describe('PATCH /vehiculos/:id', () => {
    it('edita el nombre y el kilometraje', async () => {
      const id = await sembrarVehiculo(`${PREFIJO} Editable`, idTijuana);

      const res = await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Editado`, kmInicial: 99999.99 })
        .expect(200);

      const vehiculo = res.body as VehiculoRespuesta;
      expect(vehiculo.nombre).toBe(`${PREFIJO} Editado`);
      // D6: el km al alta se puede corregir siempre. No es como el codigo de
      // sucursal ni el folio, que quedan escritos en documentos que no se pueden
      // corregir hacia atras.
      expect(vehiculo.kmInicial).toBe(99999.99);
    });

    it('da de baja y vuelve a activar', async () => {
      const id = await sembrarVehiculo(`${PREFIJO} Baja`, idTijuana);

      const baja = await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ activo: false })
        .expect(200);
      expect((baja.body as VehiculoRespuesta).activo).toBe(false);

      // Sigue apareciendo en la lista: la pantalla necesita verlo para poder
      // reactivarlo.
      const lista = await request(app.getHttpServer())
        .get('/vehiculos')
        .set('Cookie', cookieTijuana)
        .expect(200);
      expect((lista.body as VehiculoRespuesta[]).some((v) => v.id === id)).toBe(
        true,
      );

      const alta = await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ activo: true })
        .expect(200);
      expect((alta.body as VehiculoRespuesta).activo).toBe(true);
    });

    // D3: el alcance manda igual en escritura que en lectura, y se compara
    // contra la sucursal del vehiculo YA LEIDO, no contra lo que diga el cliente.
    it('un usuario de TJ no puede editar un vehiculo de MX', async () => {
      const id = await sembrarVehiculo(`${PREFIJO} Ajeno`, idMexicali);

      await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Secuestrado` })
        .expect(403);
    });

    it('el usuario General si puede editar en cualquier sucursal', async () => {
      const id = await sembrarVehiculo(`${PREFIJO} General edita`, idMexicali);

      await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} General edito` })
        .expect(200);
    });

    it('un PATCH sin ningun campo responde 400', async () => {
      const id = await sembrarVehiculo(`${PREFIJO} Vacio`, idTijuana);

      await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieTijuana)
        .send({})
        .expect(400);
    });

    it('un id que no existe responde 404', async () => {
      await request(app.getHttpServer())
        .patch('/vehiculos/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Fantasma` })
        .expect(404);
    });

    // ParseUUIDPipe: sin el, la cadena llegaria a Postgres y saldria como 500.
    it('un id mal formado responde 400, no 500', async () => {
      await request(app.getHttpServer())
        .patch('/vehiculos/no-soy-un-uuid')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Basura` })
        .expect(400);
    });

    it('renombrar a un nombre ya tomado en la sucursal responde 409', async () => {
      await sembrarVehiculo(`${PREFIJO} Ocupado`, idTijuana);
      const id = await sembrarVehiculo(`${PREFIJO} Aspirante`, idTijuana);

      await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieTijuana)
        .send({ nombre: `${PREFIJO} Ocupado` })
        .expect(409);
    });

    it('rechaza editar sin el permiso vehiculo.gestionar', async () => {
      const id = await sembrarVehiculo(`${PREFIJO} Blindado`, idTijuana);

      await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieSinPermiso)
        .send({ nombre: `${PREFIJO} Hackeado` })
        .expect(403);
    });

    // D3: la sucursal de un vehiculo no se puede cambiar, y el DTO ni siquiera
    // lleva el campo.
    //
    // El 400 NO sale de rechazar el campo: `configurar-app.ts:42` configura el
    // ValidationPipe con `whitelist: true` pero SIN `forbidNonWhitelisted`, asi
    // que `sucursalId` se descarta en SILENCIO. Lo que queda es un cuerpo vacio,
    // y el 400 lo produce el "No hay nada que actualizar" del servicio.
    //
    // El efecto visible es el correcto (la sucursal no cambia) y por eso la
    // prueba vale, pero el mensaje de error hablara de campos faltantes en vez
    // de decir "la sucursal no se puede cambiar". Agregar `forbidNonWhitelisted`
    // arreglaria el mensaje a costa de endurecer TODOS los endpoints del
    // proyecto de golpe: no es una decision de este ticket.
    it('no deja cambiar la sucursal de un vehiculo', async () => {
      const id = await sembrarVehiculo(`${PREFIJO} Arraigado`, idTijuana);

      await request(app.getHttpServer())
        .patch(`/vehiculos/${id}`)
        .set('Cookie', cookieGeneral)
        .send({ sucursalId: idMexicali })
        .expect(400);

      // Lo que de verdad importa: la sucursal siguio siendo la misma.
      const fila = await db
        .selectFrom('vehiculo')
        .select('sucursal_id')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(fila.sucursal_id).toBe(idTijuana);
    });
  });
});

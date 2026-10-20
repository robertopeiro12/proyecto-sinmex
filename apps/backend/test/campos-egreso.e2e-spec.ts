import { randomUUID } from 'node:crypto';
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
import { hoyEnTijuana } from './../src/modules/sincronizacion/operaciones';

interface CampoRespuesta {
  id: string;
  nombre: string;
  tipo: string;
  seUsaEnApp: boolean;
}

// El PID va pegado al timestamp porque Jest corre archivos en paralelo.
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN_GENERAL = `e2e-cegr-gen-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-cegr-sin-${SUFIJO}`;
const LOGIN_VENDEDOR = `e2e-cegr-vend-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const PREFIJO = `ZZ-cegr-${SUFIJO}`;

describe('Campos de egreso (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  let cookieGeneral: string;
  let cookieSinPermiso: string;
  let sucursalId: string;
  let vendedorId: string;

  const http = () => request(app.getHttpServer());

  const iniciarSesion = async (login: string): Promise<string> => {
    const res = await http()
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

  const crearCampo = async (nombre: string): Promise<CampoRespuesta> =>
    (
      await http()
        .post('/campos-egreso')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} ${nombre}`, tipo: 'operacion' })
        .expect(201)
    ).body as CampoRespuesta;

  /** Un gasto sembrado por debajo del servicio, como lo dejaria el push. */
  const sembrarGasto = async (
    campoId: string,
    fecha: string,
    borrado = false,
  ): Promise<void> => {
    await db
      .insertInto('gasto')
      .values({
        id: randomUUID(),
        sucursal_id: sucursalId,
        vendedor_id: vendedorId,
        campo_egreso_id: campoId,
        campo_nombre: 'sembrado',
        tipo: 'operacion',
        fecha,
        registrado_en: new Date(),
        monto: '10.00',
        metodo: 'efectivo_cobranza_dia',
        origen: 'app',
        deleted_at: borrado ? new Date() : null,
      })
      .execute();
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

    sucursalId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;
    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN_VENDEDOR,
          nombre: 'Vendedor de gastos',
          password_hash: 'x',
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    // Orden inverso a las llaves foraneas.
    await db
      .deleteFrom('gasto')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db
      .deleteFrom('campo_egreso')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
    if (usuarioIds.length > 0) {
      await db
        .deleteFrom('sesion_refresh')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await app.close();
  });

  describe('GET /campos-egreso', () => {
    it('lista los vivos con su tipo y casilla a cualquiera con sesion, semilla incluida', async () => {
      const res = await http()
        .get('/campos-egreso')
        .set('Cookie', cookieSinPermiso)
        .expect(200);
      const lista = res.body as CampoRespuesta[];
      expect(lista.find((c) => c.nombre === 'Gasolina')).toMatchObject({
        tipo: 'operacion',
        seUsaEnApp: true,
      });
      expect(lista.find((c) => c.nombre === 'Envases')).toMatchObject({
        tipo: 'produccion',
        seUsaEnApp: false,
      });
    });

    it('sin sesion es 401', async () => {
      await http().get('/campos-egreso').expect(401);
    });
  });

  describe('POST /campos-egreso', () => {
    it('crea un campo con su tipo y su casilla', async () => {
      const res = await http()
        .post('/campos-egreso')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} Casetas`,
          tipo: 'operacion',
          seUsaEnApp: true,
        })
        .expect(201);
      expect(res.body).toMatchObject({
        nombre: `${PREFIJO} Casetas`,
        tipo: 'operacion',
        seUsaEnApp: true,
      });
    });

    it('un nombre repetido (sin importar mayusculas ni espacios) es 409 y lo dice', async () => {
      await crearCampo('Llantas');
      const res = await http()
        .post('/campos-egreso')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `  ${PREFIJO} LLANTAS `, tipo: 'operacion' })
        .expect(409);
      expect((res.body as { message: string }).message).toBe(
        `Ya existe un campo de egreso llamado "${PREFIJO} LLANTAS".`,
      );
    });

    it('un tipo fuera de los tres es 400', async () => {
      await http()
        .post('/campos-egreso')
        .set('Cookie', cookieGeneral)
        .send({ nombre: `${PREFIJO} Nomina`, tipo: 'nomina' })
        .expect(400);
    });

    it('un nombre vacio es 400', async () => {
      await http()
        .post('/campos-egreso')
        .set('Cookie', cookieGeneral)
        .send({ nombre: '   ', tipo: 'operacion' })
        .expect(400);
    });

    it('sin campo_egreso.gestionar es 403', async () => {
      await http()
        .post('/campos-egreso')
        .set('Cookie', cookieSinPermiso)
        .send({ nombre: `${PREFIJO} X`, tipo: 'operacion' })
        .expect(403);
    });
  });

  describe('PATCH /campos-egreso/:id', () => {
    it('cambia el nombre, el tipo y la casilla', async () => {
      const { id } = await crearCampo('Agua');
      const res = await http()
        .patch(`/campos-egreso/${id}`)
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} Garrafones`,
          tipo: 'produccion',
          seUsaEnApp: true,
        })
        .expect(200);
      expect(res.body).toEqual({
        id,
        nombre: `${PREFIJO} Garrafones`,
        tipo: 'produccion',
        seUsaEnApp: true,
      });
    });

    it('editar siempre se puede, aunque tenga gastos este año', async () => {
      const { id } = await crearCampo('Editable');
      await sembrarGasto(id, hoyEnTijuana());
      await http()
        .patch(`/campos-egreso/${id}`)
        .set('Cookie', cookieGeneral)
        .send({ seUsaEnApp: true })
        .expect(200);
    });

    it('sin cuerpo es 400 y sin permiso es 403', async () => {
      const { id } = await crearCampo('Vacio');
      await http()
        .patch(`/campos-egreso/${id}`)
        .set('Cookie', cookieGeneral)
        .send({})
        .expect(400);
      await http()
        .patch(`/campos-egreso/${id}`)
        .set('Cookie', cookieSinPermiso)
        .send({ seUsaEnApp: true })
        .expect(403);
    });
  });

  describe('DELETE /campos-egreso/:id', () => {
    it('sin gastos se da de baja, sale de la lista y libera el nombre', async () => {
      const { id, nombre } = await crearCampo('Temporal');
      await http()
        .delete(`/campos-egreso/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(200, { id });
      const lista = (
        await http()
          .get('/campos-egreso')
          .set('Cookie', cookieGeneral)
          .expect(200)
      ).body as CampoRespuesta[];
      expect(lista.some((c) => c.id === id)).toBe(false);
      await http()
        .post('/campos-egreso')
        .set('Cookie', cookieGeneral)
        .send({ nombre, tipo: 'financiero' })
        .expect(201);
      await http()
        .delete(`/campos-egreso/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(404);
    });

    it('con un gasto vivo de este año (Tijuana) es 409 con el motivo del cliente', async () => {
      const { id } = await crearCampo('Con gasto');
      await sembrarGasto(id, hoyEnTijuana());
      const res = await http()
        .delete(`/campos-egreso/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(409);
      expect((res.body as { message: string }).message).toBe(
        'Este campo tiene gastos este año; podrás darlo de baja el próximo año.',
      );
    });

    it('con gastos solo del año pasado se da de baja', async () => {
      const { id } = await crearCampo('Año pasado');
      const anio = Number(hoyEnTijuana().slice(0, 4));
      await sembrarGasto(id, `${anio - 1}-12-31`);
      await http()
        .delete(`/campos-egreso/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(200);
    });

    it('un gasto de este año dado de baja no bloquea', async () => {
      const { id } = await crearCampo('Gasto borrado');
      await sembrarGasto(id, hoyEnTijuana(), true);
      await http()
        .delete(`/campos-egreso/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(200);
    });

    it('sin permiso es 403', async () => {
      const { id } = await crearCampo('Protegido');
      await http()
        .delete(`/campos-egreso/${id}`)
        .set('Cookie', cookieSinPermiso)
        .expect(403);
    });
  });
});

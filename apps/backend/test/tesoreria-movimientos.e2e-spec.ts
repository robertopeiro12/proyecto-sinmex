import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import { borrarCobrosDe } from './apoyo-cobros';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';

interface Movimiento {
  id: string;
  tipo: 'deposito' | 'retiro' | 'traspaso';
  fecha: string;
  montoCentavos: number;
  cuentaId: string;
  cuentaNombre: string;
  cuentaDestinoId: string | null;
  cuentaDestinoNombre: string | null;
  comentario: string | null;
  capturo: string;
}

const SUFIJO = `${Date.now()}-${process.pid}`;
const PREFIJO = `ZZ-e2e-t29-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-t29-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-t29-tj-${SUFIJO}`;
const LOGIN_MEXICALI = `e2e-t29-mx-${SUFIJO}`;
const LOGIN_SOLO_VER = `e2e-t29-ver-${SUFIJO}`;

describe('Tesorería — movimientos, destinos y cobranza (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  let idTijuana: string;
  let idMexicali: string;
  let general: string;
  let tijuana: string;
  let mexicali: string;
  let soloVer: string;

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

  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ): Promise<string> => {
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
    return id;
  };

  const sembrarCuenta = async (
    nombre: string,
    sucursalId: string | null,
  ): Promise<string> => {
    const { id } = await db
      .insertInto('tesoreria_cuenta')
      .values({ nombre: `${PREFIJO} ${nombre}`, sucursal_id: sucursalId })
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
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    idTijuana = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;
    idMexicali = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'MX')
        .executeTakeFirstOrThrow()
    ).id;

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', idTijuana);
    await crearUsuario(LOGIN_MEXICALI, 'Administrador General', idMexicali);
    const idSoloVer = await crearUsuario(
      LOGIN_SOLO_VER,
      'Auxiliar Administrativo',
      null,
    );
    const { id: permisoVer } = await db
      .selectFrom('permiso')
      .select('id')
      .where('clave', '=', 'tesoreria.ver')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('usuario_permiso')
      .values({
        usuario_id: idSoloVer,
        permiso_id: permisoVer,
        habilitado: true,
      })
      .execute();

    general = await iniciarSesion(LOGIN_GENERAL);
    tijuana = await iniciarSesion(LOGIN_TIJUANA);
    mexicali = await iniciarSesion(LOGIN_MEXICALI);
    soloVer = await iniciarSesion(LOGIN_SOLO_VER);
  });

  afterAll(async () => {
    const cuentas = db
      .selectFrom('tesoreria_cuenta')
      .select('id')
      .where('nombre', 'like', `${PREFIJO}%`);
    await db
      .deleteFrom('tesoreria_movimiento')
      .where('cuenta_id', 'in', cuentas)
      .execute();
    await db
      .deleteFrom('tesoreria_movimiento')
      .where('cuenta_destino_id', 'in', cuentas)
      .execute();
    await db
      .deleteFrom('tesoreria_destino_cobranza')
      .where('cuenta_id', 'in', cuentas)
      .execute();
    await db
      .deleteFrom('tesoreria_saldo')
      .where('cuenta_id', 'in', cuentas)
      .execute();
    await db
      .deleteFrom('tesoreria_cuenta')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    if (clienteIds.length > 0) {
      await db
        .deleteFrom('cobranza_abono')
        .where(
          'venta_nota_id',
          'in',
          db
            .selectFrom('venta_nota')
            .select('id')
            .where('cliente_id', 'in', clienteIds),
        )
        .execute();
      await borrarCobrosDe(db, clienteIds);
      await db
        .deleteFrom('venta_nota')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
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
    await app.close();
  });

  describe('movimientos', () => {
    it('depósito, retiro y traspaso: alta con sus nombres y el comentario recortado', async () => {
      const a = await sembrarCuenta('Mov A', idTijuana);
      const b = await sembrarCuenta('Mov B', null);
      const dep = await http()
        .post('/tesoreria/movimientos')
        .set('Cookie', general)
        .send({
          tipo: 'deposito',
          fecha: '2026-10-01',
          montoCentavos: 150_050,
          cuentaId: a,
          comentario: ' Venta de envases ',
        })
        .expect(201);
      expect(dep.body as Movimiento).toMatchObject({
        tipo: 'deposito',
        fecha: '2026-10-01',
        montoCentavos: 150_050,
        cuentaId: a,
        cuentaNombre: `${PREFIJO} Mov A`,
        cuentaDestinoId: null,
        comentario: 'Venta de envases',
        capturo: LOGIN_GENERAL,
      });
      const tr = await http()
        .post('/tesoreria/movimientos')
        .set('Cookie', general)
        .send({
          tipo: 'traspaso',
          fecha: '2026-10-02',
          montoCentavos: 100_000,
          cuentaId: a,
          cuentaDestinoId: b,
        })
        .expect(201);
      expect(tr.body as Movimiento).toMatchObject({
        tipo: 'traspaso',
        cuentaDestinoId: b,
        cuentaDestinoNombre: `${PREFIJO} Mov B`,
        comentario: null,
      });
      await http()
        .post('/tesoreria/movimientos')
        .set('Cookie', general)
        .send({
          tipo: 'retiro',
          fecha: '2026-10-03',
          montoCentavos: 1,
          cuentaId: b,
        })
        .expect(201);
    });

    it('reglas de forma: monto 0, decimales, fecha futura, traspaso sin destino o a la misma cuenta, depósito con destino → 400', async () => {
      const a = await sembrarCuenta('Forma A', idTijuana);
      const b = await sembrarCuenta('Forma B', idTijuana);
      const casos = [
        {
          tipo: 'deposito',
          fecha: '2026-10-01',
          montoCentavos: 0,
          cuentaId: a,
        },
        {
          tipo: 'deposito',
          fecha: '2026-10-01',
          montoCentavos: 10.5,
          cuentaId: a,
        },
        {
          tipo: 'deposito',
          fecha: '2999-01-01',
          montoCentavos: 10,
          cuentaId: a,
        },
        {
          tipo: 'traspaso',
          fecha: '2026-10-01',
          montoCentavos: 10,
          cuentaId: a,
        },
        {
          tipo: 'traspaso',
          fecha: '2026-10-01',
          montoCentavos: 10,
          cuentaId: a,
          cuentaDestinoId: a,
        },
        {
          tipo: 'deposito',
          fecha: '2026-10-01',
          montoCentavos: 10,
          cuentaId: a,
          cuentaDestinoId: b,
        },
        { tipo: 'otro', fecha: '2026-10-01', montoCentavos: 10, cuentaId: a },
      ];
      for (const cuerpo of casos) {
        await http()
          .post('/tesoreria/movimientos')
          .set('Cookie', general)
          .send(cuerpo)
          .expect(400);
      }
      const futura = await http()
        .post('/tesoreria/movimientos')
        .set('Cookie', general)
        .send({
          tipo: 'deposito',
          fecha: '2999-01-01',
          montoCentavos: 10,
          cuentaId: a,
        })
        .expect(400);
      expect((futura.body as { message: string }).message).toBe(
        'No se puede registrar un movimiento en una fecha futura.',
      );
    });

    it('Tijuana: traspaso de su efectivo a una general sí; a una cuenta de Mexicali 404', async () => {
      const tj = await sembrarCuenta('Alc TJ', idTijuana);
      const gen = await sembrarCuenta('Alc General', null);
      const mx = await sembrarCuenta('Alc MX', idMexicali);
      await http()
        .post('/tesoreria/movimientos')
        .set('Cookie', tijuana)
        .send({
          tipo: 'traspaso',
          fecha: '2026-10-05',
          montoCentavos: 5_000,
          cuentaId: tj,
          cuentaDestinoId: gen,
        })
        .expect(201);
      await http()
        .post('/tesoreria/movimientos')
        .set('Cookie', tijuana)
        .send({
          tipo: 'traspaso',
          fecha: '2026-10-05',
          montoCentavos: 5_000,
          cuentaId: tj,
          cuentaDestinoId: mx,
        })
        .expect(404);
      await http()
        .post('/tesoreria/movimientos')
        .set('Cookie', tijuana)
        .send({
          tipo: 'deposito',
          fecha: '2026-10-05',
          montoCentavos: 5_000,
          cuentaId: mx,
        })
        .expect(404);
    });

    it('Mexicali ve en su lista el traspaso de TJ a la general (toca una cuenta que ve), con ambos nombres', async () => {
      const tj = await sembrarCuenta('Ver TJ', idTijuana);
      const gen = await sembrarCuenta('Ver General', null);
      const creado = await http()
        .post('/tesoreria/movimientos')
        .set('Cookie', tijuana)
        .send({
          tipo: 'traspaso',
          fecha: '2026-10-06',
          montoCentavos: 7_000,
          cuentaId: tj,
          cuentaDestinoId: gen,
        })
        .expect(201);
      const body = creado.body as Movimiento;
      const lista = await http()
        .get('/tesoreria/movimientos?desde=2026-10-06&hasta=2026-10-06')
        .set('Cookie', mexicali)
        .expect(200);
      const visto = (lista.body as Movimiento[]).find((m) => m.id === body.id);
      expect(visto).toMatchObject({
        cuentaNombre: `${PREFIJO} Ver TJ`,
        cuentaDestinoNombre: `${PREFIJO} Ver General`,
      });
      // …pero no puede corregirlo ni eliminarlo: no ve la cuenta de salida.
      await http()
        .delete(`/tesoreria/movimientos/${body.id}`)
        .set('Cookie', mexicali)
        .expect(404);
    });

    it('corregir y eliminar; el tipo no cambia', async () => {
      const a = await sembrarCuenta('Edit A', idTijuana);
      const b = await sembrarCuenta('Edit B', idTijuana);
      const creado = await http()
        .post('/tesoreria/movimientos')
        .set('Cookie', tijuana)
        .send({
          tipo: 'retiro',
          fecha: '2026-10-07',
          montoCentavos: 900,
          cuentaId: a,
          comentario: 'Gasolina',
        })
        .expect(201);
      const body = creado.body as Movimiento;
      const id = body.id;
      const r = await http()
        .patch(`/tesoreria/movimientos/${id}`)
        .set('Cookie', tijuana)
        .send({
          montoCentavos: 950,
          fecha: '2026-10-08',
          cuentaId: b,
          comentario: '',
        })
        .expect(200);
      expect(r.body as Movimiento).toMatchObject({
        tipo: 'retiro',
        montoCentavos: 950,
        fecha: '2026-10-08',
        cuentaId: b,
        comentario: null,
      });
      await http()
        .patch(`/tesoreria/movimientos/${id}`)
        .set('Cookie', tijuana)
        .send({ tipo: 'deposito' })
        .expect(400);
      await http()
        .patch(`/tesoreria/movimientos/${id}`)
        .set('Cookie', tijuana)
        .send({})
        .expect(400);
      await http()
        .delete(`/tesoreria/movimientos/${id}`)
        .set('Cookie', tijuana)
        .expect(200, { id });
      await http()
        .delete(`/tesoreria/movimientos/${id}`)
        .set('Cookie', tijuana)
        .expect(404);
    });

    it('lista del rango: rango obligatorio y máximo un año; sin gestionar es 403', async () => {
      await http()
        .get('/tesoreria/movimientos?desde=2026-10-01')
        .set('Cookie', general)
        .expect(400);
      await http()
        .get('/tesoreria/movimientos?desde=2025-01-01&hasta=2026-10-01')
        .set('Cookie', general)
        .expect(400);
      await http()
        .get('/tesoreria/movimientos?desde=2026-10-01&hasta=2026-10-31')
        .set('Cookie', soloVer)
        .expect(403);
    });
  });
});

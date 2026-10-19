import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import { borrarCobrosDe, sembrarCobro } from './apoyo-cobros';
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

    it('PATCH: comentario null lo borra; destino en depósito o igual a la cuenta en traspaso → 400', async () => {
      const a = await sembrarCuenta('Patch A', idTijuana);
      const b = await sembrarCuenta('Patch B', idTijuana);
      const dep = await http()
        .post('/tesoreria/movimientos')
        .set('Cookie', tijuana)
        .send({
          tipo: 'deposito',
          fecha: '2026-10-07',
          montoCentavos: 100,
          cuentaId: a,
          comentario: 'Hola',
        })
        .expect(201);
      const idDep = (dep.body as Movimiento).id;
      const r = await http()
        .patch(`/tesoreria/movimientos/${idDep}`)
        .set('Cookie', tijuana)
        .send({ comentario: null })
        .expect(200);
      expect((r.body as Movimiento).comentario).toBeNull();
      await http()
        .patch(`/tesoreria/movimientos/${idDep}`)
        .set('Cookie', tijuana)
        .send({ cuentaDestinoId: b })
        .expect(400);
      const tr = await http()
        .post('/tesoreria/movimientos')
        .set('Cookie', tijuana)
        .send({
          tipo: 'traspaso',
          fecha: '2026-10-07',
          montoCentavos: 100,
          cuentaId: a,
          cuentaDestinoId: b,
        })
        .expect(201);
      await http()
        .patch(`/tesoreria/movimientos/${(tr.body as Movimiento).id}`)
        .set('Cookie', tijuana)
        .send({ cuentaDestinoId: a })
        .expect(400);
    });

    it('PATCH recorta el comentario antes de validar su largo', async () => {
      const a = await sembrarCuenta('Trim A', idTijuana);
      const dep = await http()
        .post('/tesoreria/movimientos')
        .set('Cookie', tijuana)
        .send({
          tipo: 'deposito',
          fecha: '2026-10-07',
          montoCentavos: 100,
          cuentaId: a,
        })
        .expect(201);
      const r = await http()
        .patch(`/tesoreria/movimientos/${(dep.body as Movimiento).id}`)
        .set('Cookie', tijuana)
        .send({ comentario: '  ' + 'x'.repeat(200) + '  ' })
        .expect(200);
      expect((r.body as Movimiento).comentario).toBe('x'.repeat(200));
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

  describe('destinos', () => {
    interface Destino {
      sucursalCodigo: string;
      metodo: string;
      cuentaId: string;
      desde: string;
    }
    interface DestinosSucursal {
      sucursalCodigo: string;
      vigentes: Record<string, Destino | null>;
      historial: Destino[];
    }

    it('un General configura TJ; la vigencia nueva no borra la anterior y la misma desde la corrige', async () => {
      const ef = await sembrarCuenta('Dest Ef TJ', idTijuana);
      const caja = await sembrarCuenta('Dest Caja TJ', idTijuana);
      await http()
        .put('/tesoreria/destinos')
        .set('Cookie', general)
        .send({
          sucursalId: idTijuana,
          metodo: 'cheque',
          cuentaId: ef,
          desde: '2019-02-01',
        })
        .expect(200);
      await http()
        .put('/tesoreria/destinos')
        .set('Cookie', general)
        .send({
          sucursalId: idTijuana,
          metodo: 'cheque',
          cuentaId: caja,
          desde: '2019-02-10',
        })
        .expect(200);
      await http()
        .put('/tesoreria/destinos')
        .set('Cookie', general)
        .send({
          sucursalId: idTijuana,
          metodo: 'cheque',
          cuentaId: ef,
          desde: '2019-02-10',
        })
        .expect(200);
      const r = await http()
        .get('/tesoreria/destinos?sucursal=TJ')
        .set('Cookie', general)
        .expect(200);
      const tj = (r.body as DestinosSucursal[]).find(
        (s) => s.sucursalCodigo === 'TJ',
      )!;
      const cheques = tj.historial.filter(
        (d) =>
          d.metodo === 'cheque' && (d.cuentaId === ef || d.cuentaId === caja),
      );
      expect(cheques.map((d) => [d.desde, d.cuentaId])).toEqual([
        ['2019-02-10', ef],
        ['2019-02-01', ef],
      ]);
    });

    it('reglas: desde futura 400; método inválido 400; cuenta de otra sucursal 400; cuenta borrada 404', async () => {
      const ef = await sembrarCuenta('Dest Reglas TJ', idTijuana);
      const mx = await sembrarCuenta('Dest Reglas MX', idMexicali);
      await http()
        .put('/tesoreria/destinos')
        .set('Cookie', general)
        .send({
          sucursalId: idTijuana,
          metodo: 'efectivo',
          cuentaId: ef,
          desde: '2999-01-01',
        })
        .expect(400);
      await http()
        .put('/tesoreria/destinos')
        .set('Cookie', general)
        .send({
          sucursalId: idTijuana,
          metodo: 'saldo_favor',
          cuentaId: ef,
          desde: '2019-01-01',
        })
        .expect(400);
      const otra = await http()
        .put('/tesoreria/destinos')
        .set('Cookie', general)
        .send({
          sucursalId: idTijuana,
          metodo: 'efectivo',
          cuentaId: mx,
          desde: '2019-01-01',
        })
        .expect(400);
      expect((otra.body as { message: string }).message).toBe(
        'La cuenta tiene que ser de esa sucursal o general.',
      );
      await db
        .updateTable('tesoreria_cuenta')
        .set({ deleted_at: new Date() })
        .where('id', '=', ef)
        .execute();
      await http()
        .put('/tesoreria/destinos')
        .set('Cookie', general)
        .send({
          sucursalId: idTijuana,
          metodo: 'efectivo',
          cuentaId: ef,
          desde: '2019-01-01',
        })
        .expect(404);
    });

    it('Tijuana configura su sucursal con una cuenta general, pero no Mexicali (403); y solo ve TJ', async () => {
      const gen = await sembrarCuenta('Dest General', null);
      await http()
        .put('/tesoreria/destinos')
        .set('Cookie', tijuana)
        .send({
          sucursalId: idTijuana,
          metodo: 'transferencia',
          cuentaId: gen,
          desde: '2019-01-05',
        })
        .expect(200);
      await http()
        .put('/tesoreria/destinos')
        .set('Cookie', tijuana)
        .send({
          sucursalId: idMexicali,
          metodo: 'transferencia',
          cuentaId: gen,
          desde: '2019-01-05',
        })
        .expect(403);
      const r = await http()
        .get('/tesoreria/destinos')
        .set('Cookie', tijuana)
        .expect(200);
      expect(
        (r.body as DestinosSucursal[]).map((s) => s.sucursalCodigo),
      ).toEqual(['TJ']);
    });

    it('eliminar una cuenta que hoy recibe la cobranza: 409; si solo fue destino en el pasado, se elimina', async () => {
      const vieja = await sembrarCuenta('Dest Vieja MX', idMexicali);
      const nueva = await sembrarCuenta('Dest Nueva MX', idMexicali);
      await http()
        .put('/tesoreria/destinos')
        .set('Cookie', general)
        .send({
          sucursalId: idMexicali,
          metodo: 'cheque',
          cuentaId: vieja,
          desde: '2019-03-01',
        })
        .expect(200);
      const r = await http()
        .delete(`/tesoreria/cuentas/${vieja}`)
        .set('Cookie', general)
        .expect(409);
      expect((r.body as { message: string }).message).toBe(
        'Esta cuenta recibe la cobranza de MX (cheque). Cambia ese destino antes de eliminarla.',
      );
      await http()
        .put('/tesoreria/destinos')
        .set('Cookie', general)
        .send({
          sucursalId: idMexicali,
          metodo: 'cheque',
          cuentaId: nueva,
          desde: '2019-03-02',
        })
        .expect(200);
      await http()
        .delete(`/tesoreria/cuentas/${vieja}`)
        .set('Cookie', general)
        .expect(200);
    });

    it('sin gestionar, destinos es 403', async () => {
      await http()
        .get('/tesoreria/destinos')
        .set('Cookie', soloVer)
        .expect(403);
    });
  });

  describe('vista con cobranza', () => {
    interface Vista {
      cuentas: {
        id: string;
        saldoInicioCentavos: number | null;
        saldoFinalCentavos: number | null;
        entradasCentavos: number;
        salidasCentavos: number;
        saldoFijadoEnRango: string | null;
      }[];
      sinCuenta: {
        sucursalCodigo: string;
        metodo: string;
        montoCentavos: number;
      }[];
      eventos: {
        tipo: string;
        cuentaId: string;
        metodo?: string;
        cantidad?: number;
        montoCentavos: number;
        fecha: string;
      }[];
    }

    /** Un cliente propio de la suite en esa sucursal. */
    const sembrarCliente = async (
      nombre: string,
      sucursalId: string,
    ): Promise<string> => {
      const { id: listaId } = await db
        .selectFrom('lista_precio')
        .select('id')
        .where('nombre', '=', 'Lista 1')
        .executeTakeFirstOrThrow();
      const { id } = await db
        .insertInto('cliente')
        .values({
          nombre: `${PREFIJO} ${nombre}`,
          domicilio: 'Domicilio',
          telefono: '000',
          tipo: 'cliente',
          lista_precio_id: listaId,
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      clienteIds.push(id);
      return id;
    };

    /** Una venta de contado viva con su abono de contado (como la deja VentasService). */
    const sembrarContado = async (
      clienteId: string,
      sucursalId: string,
      fecha: string,
      monto: string,
      metodo: 'efectivo' | 'transferencia' | 'cheque' = 'efectivo',
    ): Promise<string> => {
      const { id } = await db
        .insertInto('venta_nota')
        .values({
          folio: `ZZT29${Math.random().toString(36).slice(2, 9)}`.slice(0, 30),
          fecha,
          cliente_id: clienteId,
          vendedor_id: null,
          monto_total: monto,
          num_nota: null,
          contado_credito: 'contado',
          semana: 1,
          mes: 1,
          status: 'pagada',
          sucursal_id: sucursalId,
          origen: 'portal',
          capturo_usuario_id: usuarioIds[0],
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('cobranza_abono')
        .values({
          venta_nota_id: id,
          fecha_pago: fecha,
          fecha_operacion: fecha,
          vendedor_id: null,
          monto,
          tipo: 'cobranza',
          saldo_pendiente: '0',
          metodo_pago: metodo,
          origen: 'venta_contado',
          capturo_usuario_id: usuarioIds[0],
        })
        .execute();
      return id;
    };

    it('cobros y contado suman a la cuenta destino; saldo a favor no; un cobro borrado deja de sumar', async () => {
      const cuenta = await sembrarCuenta('Vista Ef TJ', idTijuana);
      await db
        .insertInto('tesoreria_saldo')
        .values({
          cuenta_id: cuenta,
          fecha: '2019-03-01',
          monto: '1000.00',
          capturo_usuario_id: usuarioIds[0],
        })
        .execute();
      await http()
        .put('/tesoreria/destinos')
        .set('Cookie', general)
        .send({
          sucursalId: idTijuana,
          metodo: 'efectivo',
          cuentaId: cuenta,
          desde: '2019-03-01',
        })
        .expect(200);
      const cliente = await sembrarCliente('Cliente vista', idTijuana);
      await sembrarCobro(db, {
        clienteId: cliente,
        vendedorId: null,
        monto: '200.00',
        fecha: '2019-03-05',
        metodoPago: 'efectivo',
      });
      const borrado = await sembrarCobro(db, {
        clienteId: cliente,
        vendedorId: null,
        monto: '50.00',
        fecha: '2019-03-05',
        metodoPago: 'efectivo',
      });
      await db
        .updateTable('cobro')
        .set({ deleted_at: new Date() })
        .where('id', '=', borrado)
        .execute();
      await sembrarCobro(db, {
        clienteId: cliente,
        vendedorId: null,
        monto: '75.00',
        fecha: '2019-03-05',
        metodoPago: 'saldo_favor',
      });
      await sembrarContado(cliente, idTijuana, '2019-03-05', '30.00');

      const v = (
        await http()
          .get('/tesoreria?desde=2019-03-02&hasta=2019-03-31&sucursal=TJ')
          .set('Cookie', soloVer)
          .expect(200)
      ).body as Vista;
      const fila = v.cuentas.find((c) => c.id === cuenta)!;
      expect(fila).toMatchObject({
        saldoInicioCentavos: 100_000,
        entradasCentavos: 23_000,
        salidasCentavos: 0,
        saldoFinalCentavos: 123_000,
      });
      const ev = v.eventos.filter(
        (e) => e.cuentaId === cuenta && e.tipo === 'cobranza',
      );
      expect(ev).toEqual([
        expect.objectContaining({
          fecha: '2019-03-05',
          metodo: 'efectivo',
          cantidad: 2,
          montoCentavos: 23_000,
        }),
      ]);
    });

    it('una venta de contado eliminada deja de sumar', async () => {
      const cuenta = await sembrarCuenta('Vista Contado TJ', idTijuana);
      await db
        .insertInto('tesoreria_saldo')
        .values({
          cuenta_id: cuenta,
          fecha: '2019-03-01',
          monto: '0',
          capturo_usuario_id: usuarioIds[0],
        })
        .execute();
      await http()
        .put('/tesoreria/destinos')
        .set('Cookie', general)
        .send({
          sucursalId: idTijuana,
          metodo: 'cheque',
          cuentaId: cuenta,
          desde: '2019-03-01',
        })
        .expect(200);
      const cliente = await sembrarCliente('Cliente contado', idTijuana);
      const venta = await sembrarContado(
        cliente,
        idTijuana,
        '2019-03-06',
        '40.00',
        'cheque',
      );
      const antes = (
        await http()
          .get('/tesoreria?desde=2019-03-06&hasta=2019-03-06&sucursal=TJ')
          .set('Cookie', general)
          .expect(200)
      ).body as Vista;
      expect(antes.cuentas.find((c) => c.id === cuenta)?.entradasCentavos).toBe(
        4_000,
      );
      await db
        .updateTable('venta_nota')
        .set({ deleted_at: new Date() })
        .where('id', '=', venta)
        .execute();
      const despues = (
        await http()
          .get('/tesoreria?desde=2019-03-06&hasta=2019-03-06&sucursal=TJ')
          .set('Cookie', general)
          .expect(200)
      ).body as Vista;
      expect(
        despues.cuentas.find((c) => c.id === cuenta)?.entradasCentavos,
      ).toBe(0);
    });

    it('cambiar el destino con desde no mueve lo anterior', async () => {
      const vieja = await sembrarCuenta('Vista Vieja MX', idMexicali);
      const nueva = await sembrarCuenta('Vista Nueva MX', idMexicali);
      await http()
        .put('/tesoreria/destinos')
        .set('Cookie', general)
        .send({
          sucursalId: idMexicali,
          metodo: 'transferencia',
          cuentaId: vieja,
          desde: '2019-03-01',
        })
        .expect(200);
      await http()
        .put('/tesoreria/destinos')
        .set('Cookie', general)
        .send({
          sucursalId: idMexicali,
          metodo: 'transferencia',
          cuentaId: nueva,
          desde: '2019-03-15',
        })
        .expect(200);
      const cliente = await sembrarCliente('Cliente destino', idMexicali);
      await sembrarCobro(db, {
        clienteId: cliente,
        vendedorId: null,
        monto: '10.00',
        fecha: '2019-03-14',
        metodoPago: 'transferencia',
      });
      await sembrarCobro(db, {
        clienteId: cliente,
        vendedorId: null,
        monto: '20.00',
        fecha: '2019-03-15',
        metodoPago: 'transferencia',
      });
      const v = (
        await http()
          .get('/tesoreria?desde=2019-03-14&hasta=2019-03-15&sucursal=MX')
          .set('Cookie', general)
          .expect(200)
      ).body as Vista;
      expect(v.cuentas.find((c) => c.id === vieja)?.entradasCentavos).toBe(
        1_000,
      );
      expect(v.cuentas.find((c) => c.id === nueva)?.entradasCentavos).toBe(
        2_000,
      );
    });

    it('cobranza sin destino sale en sinCuenta de su sucursal y no suma a ninguna cuenta', async () => {
      // MX · efectivo en marzo de 2019 no tiene destino en esta suite.
      const cliente = await sembrarCliente('Cliente sin destino', idMexicali);
      await sembrarCobro(db, {
        clienteId: cliente,
        vendedorId: null,
        monto: '12.34',
        fecha: '2019-03-20',
        metodoPago: 'efectivo',
      });
      const v = (
        await http()
          .get('/tesoreria?desde=2019-03-20&hasta=2019-03-20&sucursal=MX')
          .set('Cookie', general)
          .expect(200)
      ).body as Vista;
      expect(v.sinCuenta).toEqual(
        expect.arrayContaining([
          { sucursalCodigo: 'MX', metodo: 'efectivo', montoCentavos: 1_234 },
        ]),
      );
      const tj = (
        await http()
          .get('/tesoreria?desde=2019-03-20&hasta=2019-03-20&sucursal=TJ')
          .set('Cookie', general)
          .expect(200)
      ).body as Vista;
      expect(tj.sinCuenta.some((s) => s.sucursalCodigo === 'MX')).toBe(false);
    });

    it('depósito, retiro y traspaso en la vista: entradas, salidas y marca de saldo fijado en el rango', async () => {
      const a = await sembrarCuenta('Vista Man A', idTijuana);
      const b = await sembrarCuenta('Vista Man B', null);
      await db
        .insertInto('tesoreria_saldo')
        .values([
          {
            cuenta_id: a,
            fecha: '2019-03-01',
            monto: '100.00',
            capturo_usuario_id: usuarioIds[0],
          },
          {
            cuenta_id: b,
            fecha: '2019-03-01',
            monto: '0',
            capturo_usuario_id: usuarioIds[0],
          },
          {
            cuenta_id: a,
            fecha: '2019-03-25',
            monto: '500.00',
            capturo_usuario_id: usuarioIds[0],
          },
        ])
        .execute();
      for (const cuerpo of [
        {
          tipo: 'deposito',
          fecha: '2019-03-21',
          montoCentavos: 1_000,
          cuentaId: a,
        },
        {
          tipo: 'traspaso',
          fecha: '2019-03-22',
          montoCentavos: 3_000,
          cuentaId: a,
          cuentaDestinoId: b,
        },
        {
          tipo: 'retiro',
          fecha: '2019-03-26',
          montoCentavos: 500,
          cuentaId: a,
        },
      ]) {
        await http()
          .post('/tesoreria/movimientos')
          .set('Cookie', general)
          .send(cuerpo)
          .expect(201);
      }
      const v = (
        await http()
          .get('/tesoreria?desde=2019-03-20&hasta=2019-03-31&sucursal=TJ')
          .set('Cookie', general)
          .expect(200)
      ).body as Vista;
      expect(v.cuentas.find((c) => c.id === a)).toMatchObject({
        saldoInicioCentavos: 10_000,
        entradasCentavos: 0,
        salidasCentavos: 500,
        saldoFinalCentavos: 49_500,
        saldoFijadoEnRango: '2019-03-25',
      });
      expect(v.cuentas.find((c) => c.id === b)).toMatchObject({
        entradasCentavos: 3_000,
        saldoFinalCentavos: 3_000,
      });
      expect(
        v.eventos.filter((e) => e.cuentaId === a).map((e) => e.tipo),
      ).toEqual(['deposito', 'traspaso', 'saldo-fijado', 'retiro']);
    });
  });
});

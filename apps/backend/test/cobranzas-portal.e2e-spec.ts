import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
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
import {
  CONTRATO_ACTUAL,
  type RespuestaPull,
} from './../src/modules/sincronizacion/contrato';
import { hoyEnTijuana } from './../src/modules/sincronizacion/operaciones';
import { MOTIVO_CON_COBROS } from './../src/modules/ventas-cobranza/acciones-venta';
import type { NotaPorCobrar } from './../src/modules/ventas-cobranza/cobranzas-portal.repository';
import type {
  ClientePorCobrar,
  CobroRegistrado,
} from './../src/modules/ventas-cobranza/cobranzas-portal.service';
import type { PlanDeCobro } from './../src/modules/ventas-cobranza/cobranzas.service';
import type { VentaDetalle } from './../src/modules/ventas-cobranza/ventas-consulta.service';

/**
 * Cobranza desde el portal (T-21): §6 del spec, de punta a punta.
 *
 * Fechas de MAYO DE 2023 exclusivas de este archivo. El cobro del portal se
 * registra con `fecha_operacion` = hoy en Tijuana: la pone el servidor.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-cob-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-cob-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-cob-sin-${SUFIJO}`;
const LOGIN_APP = `e2e-cob-app-${SUFIJO}`;

const F1 = '2023-05-01';
const F2 = '2023-05-02';
const F3 = '2023-05-03';
const F_BUSQUEDA = '2023-05-20';
const PAGO = '2023-05-10';

const ESPERA_MAX_BLOQUEO_MS = 3000;
const MENSAJE_MONTO =
  'El monto debe ser mayor a $0 y tener a lo más 2 decimales.';

/** Manana en Tijuana, armado del texto (nunca de un Date local). */
const mananaEnTijuana = () => {
  const [a, m, d] = hoyEnTijuana().split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
};

const mensaje = (res: request.Response) =>
  (res.body as { message: string }).message;

describe('Cobranza desde el portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let mxId: string;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  const vendedorIds: string[] = [];
  let usuarioGeneralId: string;
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let repartidorTj: string;
  let repartidorTjInactivo: string;
  let repartidorMx: string;
  let vendedorApp: string;
  let bearerApp: string;

  let folios = 0;
  let clientes = 0;
  let vendedores = 0;

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

  /** `Administrador General` trae todos los permisos; `Auxiliar Administrativo` esta vacio. */
  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ) => {
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

  const sembrarCliente = async (sucursalId: string): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `Cobranza ${++clientes} ${SUFIJO}`,
        domicilio: 'Calle 1',
        telefono: '6640000000',
        tipo: 'cliente',
        lista_precio_id: lista.id,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return id;
  };

  /** Una venta a credito de oficina; `pendiente` y viva salvo que se diga otra cosa. */
  const sembrarNota = async (
    clienteId: string,
    monto: string,
    fecha: string,
    extra: { status?: string; numNota?: string; borrada?: boolean } = {},
  ) => {
    const cliente = await db
      .selectFrom('cliente')
      .select('sucursal_id')
      .where('id', '=', clienteId)
      .executeTakeFirstOrThrow();
    return db
      .insertInto('venta_nota')
      .values({
        folio: `ZZC${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha,
        cliente_id: clienteId,
        vendedor_id: null,
        monto_total: monto,
        num_nota: extra.numNota ?? null,
        contado_credito: 'credito',
        semana: 18,
        mes: 5,
        status: extra.status ?? 'pendiente',
        sucursal_id: cliente.sucursal_id,
        origen: 'portal',
        capturo_usuario_id: usuarioGeneralId,
        deleted_at: extra.borrada ? new Date() : null,
      })
      .returning(['id', 'folio'])
      .executeTakeFirstOrThrow();
  };

  /** Un repartidor; `acceso` solo para el de la tablet, que entra por /auth/app/login. */
  const sembrarVendedor = async (
    sucursalId: string,
    activo = true,
    acceso: { login: string; passwordHash: string } | null = null,
  ): Promise<string> => {
    const n = ++vendedores;
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: acceso?.login ?? `e2e-cob-v${n}-${SUFIJO}`,
        nombre: `Repartidor ${n} ${SUFIJO}`,
        password_hash: acceso?.passwordHash ?? 'x',
        sucursal_id: sucursalId,
        activo,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  const darSaldoFavor = (clienteId: string, monto: string) =>
    db
      .insertInto('saldo_favor_movimiento')
      .values({
        cliente_id: clienteId,
        vendedor_id: null,
        monto,
        origen: 'excedente_cobro',
        fecha_operacion: F1,
      })
      .execute();

  const porCobrar = (cookie: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/cobranzas/por-cobrar?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const cobrar = (cookie: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/cobranzas')
      .set('Cookie', cookie)
      .send(cuerpo);

  const vistaPrevia = (cookie: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/cobranzas/vista-previa')
      .set('Cookie', cookie)
      .send(cuerpo);

  const aplicarSaldo = (cookie: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/cobranzas/saldo-favor')
      .set('Cookie', cookie)
      .send(cuerpo);

  /** Un pago valido; transferencia de Oficina por default, como la pantalla. */
  const pago = (
    clienteId: string,
    notaIds: string[],
    extra: Record<string, unknown> = {},
  ) => ({
    clienteId,
    notaIds,
    montoCentavos: 10000,
    fechaPago: PAGO,
    metodoPago: 'transferencia',
    vendedorId: null,
    ...extra,
  });

  const pull = (query: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .get(
        `/sync/pull?${new URLSearchParams({ contrato: String(CONTRATO_ACTUAL), ...query }).toString()}`,
      )
      .set('Authorization', `Bearer ${bearerApp}`);

  /** Los abonos vivos de una nota, en el orden en que se escribieron. */
  const abonosDe = (notaId: string) =>
    db
      .selectFrom('cobranza_abono')
      .select([
        'monto',
        'tipo',
        'saldo_pendiente',
        'metodo_pago',
        'origen',
        'vendedor_id',
        'capturo_usuario_id',
        sql<string>`to_char(fecha_pago, 'YYYY-MM-DD')`.as('fecha_pago'),
        sql<string>`to_char(fecha_operacion, 'YYYY-MM-DD')`.as(
          'fecha_operacion',
        ),
      ])
      .where('venta_nota_id', '=', notaId)
      .where('deleted_at', 'is', null)
      .orderBy('created_at')
      .execute();

  const statusDe = async (id: string) =>
    (
      await db
        .selectFrom('venta_nota')
        .select('status')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).status;

  const movimientosDe = (clienteId: string) =>
    db
      .selectFrom('saldo_favor_movimiento')
      .select(['monto', 'origen', 'vendedor_id', 'capturo_usuario_id'])
      .where('cliente_id', '=', clienteId)
      .orderBy('created_at')
      .execute();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    tjId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;
    mxId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'MX')
        .executeTakeFirstOrThrow()
    ).id;

    usuarioGeneralId = await crearUsuario(
      LOGIN_GENERAL,
      'Administrador General',
      null,
    );
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', tjId);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);

    repartidorTj = await sembrarVendedor(tjId);
    repartidorTjInactivo = await sembrarVendedor(tjId, false);
    repartidorMx = await sembrarVendedor(mxId);
    // El de la tablet: con contrasena, para entrar por /auth/app/login y hacer pull.
    vendedorApp = await sembrarVendedor(tjId, true, {
      login: LOGIN_APP,
      passwordHash: await app.get(PasswordService).hashear(PASSWORD),
    });
    bearerApp = (
      (
        await request(app.getHttpServer())
          .post('/auth/app/login')
          .send({ login: LOGIN_APP, password: PASSWORD })
          .expect(200)
      ).body as { tokenAcceso: string }
    ).tokenAcceso;
  });

  afterAll(async () => {
    if (clienteIds.length > 0) {
      const notas = db
        .selectFrom('venta_nota')
        .select('id')
        .where('cliente_id', 'in', clienteIds);
      await db
        .deleteFrom('cobranza_abono')
        .where('venta_nota_id', 'in', notas)
        .execute();
      await db
        .deleteFrom('saldo_favor_movimiento')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await db
        .deleteFrom('venta_nota')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  /* ================================================================ */

  describe('permiso y alcance', () => {
    it('sin cobranza.registrar todo es 403, lectura incluida', async () => {
      const cli = await sembrarCliente(tjId);
      const n = await sembrarNota(cli, '100.00', F1);
      await porCobrar(cookieSinPermiso, { clienteId: cli }).expect(403);
      await cobrar(cookieSinPermiso, pago(cli, [n.id])).expect(403);
      await aplicarSaldo(cookieSinPermiso, {
        clienteId: cli,
        notaIds: [n.id],
        montoCentavos: 100,
      }).expect(403);
      expect(await abonosDe(n.id)).toEqual([]);
    });

    it('un usuario de TJ no ve ni cobra a un cliente de MX', async () => {
      const cli = await sembrarCliente(mxId);
      const n = await sembrarNota(cli, '100.00', F1);
      await porCobrar(cookieTijuana, { clienteId: cli }).expect(403);
      await cobrar(cookieTijuana, pago(cli, [n.id])).expect(403);
      await aplicarSaldo(cookieTijuana, {
        clienteId: cli,
        notaIds: [n.id],
        montoCentavos: 100,
      }).expect(403);
      expect(await abonosDe(n.id)).toEqual([]);
    });

    it('por fecha, un usuario de TJ solo ve las notas de TJ; el General, las de las dos', async () => {
      const tj = await sembrarCliente(tjId);
      const mx = await sembrarCliente(mxId);
      const nTj = await sembrarNota(tj, '10.00', F_BUSQUEDA);
      const nMx = await sembrarNota(mx, '10.00', F_BUSQUEDA);

      const deTj = (
        (await porCobrar(cookieTijuana, { fecha: F_BUSQUEDA }).expect(200))
          .body as NotaPorCobrar[]
      ).map((n) => n.id);
      expect(deTj).toContain(nTj.id);
      expect(deTj).not.toContain(nMx.id);

      const todas = (
        (await porCobrar(cookieGeneral, { fecha: F_BUSQUEDA }).expect(200))
          .body as NotaPorCobrar[]
      ).map((n) => n.id);
      expect(todas).toEqual(expect.arrayContaining([nTj.id, nMx.id]));
    });
  });

  describe('por cobrar', () => {
    it('por cliente: sus notas por cobrar de la mas vieja a la mas nueva, con saldo, abonos y saldo a favor', async () => {
      const cli = await sembrarCliente(tjId);
      const nueva = await sembrarNota(cli, '80.00', F2);
      const vieja = await sembrarNota(cli, '100.00', F1, { status: 'abonado' });
      await sembrarNota(cli, '50.00', F1, { status: 'pagada' });
      await sembrarNota(cli, '50.00', F1, { status: 'cuenta_perdida' });
      await sembrarNota(cli, '50.00', F1, { borrada: true });
      await db
        .insertInto('cobranza_abono')
        .values({
          venta_nota_id: vieja.id,
          vendedor_id: null,
          fecha_pago: F2,
          fecha_operacion: F2,
          monto: '30.00',
          tipo: 'abono',
          saldo_pendiente: '70.00',
          metodo_pago: 'cheque',
          origen: 'cobro',
        })
        .execute();
      await darSaldoFavor(cli, '12.50');

      const cuerpo = (
        await porCobrar(cookieGeneral, { clienteId: cli }).expect(200)
      ).body as ClientePorCobrar;
      expect(cuerpo).toMatchObject({
        id: cli,
        sucursalId: tjId,
        sucursalCodigo: 'TJ',
        saldoFavorCentavos: 1250,
      });
      expect(cuerpo.notas.map((n) => n.id)).toEqual([vieja.id, nueva.id]);
      expect(cuerpo.notas[0]).toMatchObject({
        folio: vieja.folio,
        fecha: F1,
        montoCentavos: 10000,
        saldoCentavos: 7000,
        status: 'abonado',
        abonos: [
          {
            fechaPago: F2,
            montoCentavos: 3000,
            metodoPago: 'cheque',
            origen: 'cobro',
          },
        ],
      });
    });

    it('por # de nota: exacto, sin mayusculas ni espacios, de cualquier cliente del alcance', async () => {
      const a = await sembrarCliente(tjId);
      const b = await sembrarCliente(tjId);
      const numNota = `Nota-${SUFIJO}`.slice(0, 30);
      const na = await sembrarNota(a, '10.00', F3, { numNota });
      const nb = await sembrarNota(b, '20.00', F3, {
        numNota: numNota.toLowerCase(),
      });

      const res = (
        await porCobrar(cookieGeneral, {
          numNota: `  ${numNota.toUpperCase()} `,
        }).expect(200)
      ).body as NotaPorCobrar[];
      expect(res.map((n) => n.id).sort()).toEqual([na.id, nb.id].sort());
      expect(res.find((n) => n.id === nb.id)?.clienteId).toBe(b);
    });

    it('sin filtro, o con dos, es 400', async () => {
      const res = await porCobrar(cookieGeneral, {}).expect(400);
      expect(mensaje(res)).toBe(
        'Busca por cliente, fecha o # de nota (uno solo).',
      );
      await porCobrar(cookieGeneral, { fecha: F1, numNota: 'x' }).expect(400);
    });
  });

  describe('registrar pago', () => {
    it('varias palomeadas: primero la mas vieja, la ultima abonada; Oficina, quien capturo y hoy', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const n3 = await sembrarNota(cli, '50.00', F3);

      const cobro = (
        await cobrar(
          cookieGeneral,
          pago(cli, [n3.id, n2.id], { montoCentavos: 12000 }),
        ).expect(201)
      ).body as CobroRegistrado;

      expect(cobro).toMatchObject({
        montoCentavos: 12000,
        saldoFavorCentavos: 0,
      });
      expect(cobro.cliente).toMatch(/^Cobranza /);
      expect(
        cobro.aplicaciones.map((a) => [
          a.folio,
          a.montoCentavos,
          a.saldoDespuesCentavos,
          a.palomeada,
        ]),
      ).toEqual([
        [n2.folio, 8000, 0, true],
        [n3.folio, 4000, 1000, true],
      ]);
      expect(await statusDe(n2.id)).toBe('pagada');
      expect(await statusDe(n3.id)).toBe('abonado');
      expect(await statusDe(n1.id)).toBe('pendiente');
      expect(await abonosDe(n1.id)).toEqual([]);
      expect(await abonosDe(n2.id)).toEqual([
        {
          monto: '80.00',
          tipo: 'cobranza',
          saldo_pendiente: '0.00',
          metodo_pago: 'transferencia',
          origen: 'cobro',
          vendedor_id: null,
          capturo_usuario_id: usuarioGeneralId,
          fecha_pago: PAGO,
          fecha_operacion: hoyEnTijuana(),
        },
      ]);
    });

    it('el excedente va a las demas notas (de la mas vieja) y lo que sobra a saldo a favor', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const n3 = await sembrarNota(cli, '50.00', F3);

      const cobro = (
        await cobrar(
          cookieGeneral,
          pago(cli, [n2.id], { montoCentavos: 30000 }),
        ).expect(201)
      ).body as CobroRegistrado;

      expect(
        cobro.aplicaciones.map((a) => [a.folio, a.montoCentavos, a.palomeada]),
      ).toEqual([
        [n2.folio, 8000, true],
        [n1.folio, 10000, false],
        [n3.folio, 5000, false],
      ]);
      expect(cobro.saldoFavorCentavos).toBe(7000);
      expect(await movimientosDe(cli)).toEqual([
        {
          monto: '70.00',
          origen: 'excedente_cobro',
          vendedor_id: null,
          capturo_usuario_id: usuarioGeneralId,
        },
      ]);
      const cuerpo = (
        await porCobrar(cookieGeneral, { clienteId: cli }).expect(200)
      ).body as ClientePorCobrar;
      expect(cuerpo).toMatchObject({ saldoFavorCentavos: 7000, notas: [] });
    });

    it('con un repartidor como cobrador el abono es suyo; uno inactivo o de otra sucursal es 400', async () => {
      const cli = await sembrarCliente(tjId);
      const n = await sembrarNota(cli, '100.00', F1);

      await cobrar(
        cookieGeneral,
        pago(cli, [n.id], { montoCentavos: 1000, vendedorId: repartidorTj }),
      ).expect(201);
      expect((await abonosDe(n.id))[0]).toMatchObject({
        vendedor_id: repartidorTj,
      });

      for (const otro of [repartidorTjInactivo, repartidorMx]) {
        const res = await cobrar(
          cookieGeneral,
          pago(cli, [n.id], { montoCentavos: 1000, vendedorId: otro }),
        ).expect(400);
        expect(mensaje(res)).toBe(
          'El cobrador no es un repartidor activo de la sucursal del cliente.',
        );
      }
      expect(await abonosDe(n.id)).toHaveLength(1);
    });

    it('el cobro no lleva folio ni consume el contador OF', async () => {
      const cli = await sembrarCliente(tjId);
      const n = await sembrarNota(cli, '100.00', F1);
      const contador = () =>
        db
          .selectFrom('folio_oficina_contador')
          .select('ultimo')
          .where('sucursal_id', '=', tjId)
          .where(sql<string>`to_char(fecha, 'YYYY-MM-DD')`, '=', hoyEnTijuana())
          .executeTakeFirst();

      const antes = await contador();
      await cobrar(cookieGeneral, pago(cli, [n.id])).expect(201);
      expect(await contador()).toEqual(antes);

      const columnas = await sql<{ column_name: string }>`
        select column_name from information_schema.columns
         where table_name = 'cobranza_abono'
      `.execute(db);
      expect(columnas.rows.map((c) => c.column_name)).not.toContain('folio');
      expect(
        await db
          .selectFrom('venta_nota')
          .select('id')
          .where('cliente_id', '=', cli)
          .execute(),
      ).toHaveLength(1);
    });

    it('Review Focus 1: una palomeada que se pago mientras la pantalla estaba abierta es 409 y no se graba nada', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      // Otro cobro (la tablet) la liquido despues de que la oficina cargo la lista.
      await db
        .insertInto('cobranza_abono')
        .values({
          venta_nota_id: n2.id,
          vendedor_id: vendedorApp,
          fecha_pago: F2,
          fecha_operacion: F2,
          monto: '80.00',
          tipo: 'cobranza',
          saldo_pendiente: '0.00',
          metodo_pago: 'efectivo',
          origen: 'cobro',
        })
        .execute();
      await db
        .updateTable('venta_nota')
        .set({ status: 'pagada' })
        .where('id', '=', n2.id)
        .execute();

      const res = await cobrar(
        cookieGeneral,
        pago(cli, [n1.id, n2.id], { montoCentavos: 18000 }),
      ).expect(409);
      expect(mensaje(res)).toBe(
        `La nota ${n2.folio} ya no tiene saldo; vuelve a cargar.`,
      );
      expect(await abonosDe(n1.id)).toEqual([]);
      expect(await statusDe(n1.id)).toBe('pendiente');
      expect(await movimientosDe(cli)).toEqual([]);
    });

    it('una nota de otro cliente es 409', async () => {
      const cli = await sembrarCliente(tjId);
      const otro = await sembrarCliente(tjId);
      const n = await sembrarNota(cli, '100.00', F1);
      const ajena = await sembrarNota(otro, '100.00', F1);
      const res = await cobrar(
        cookieGeneral,
        pago(cli, [n.id, ajena.id]),
      ).expect(409);
      expect(mensaje(res)).toBe(
        'Una de las notas marcadas no es de este cliente o ya no existe; vuelve a cargar.',
      );
      expect(await abonosDe(n.id)).toEqual([]);
      expect(await abonosDe(ajena.id)).toEqual([]);
    });

    it('Review Focus 2: una fecha anterior a la palomeada mas vieja, o futura, es 400', async () => {
      const cli = await sembrarCliente(tjId);
      const n = await sembrarNota(cli, '100.00', F2);

      const anterior = await cobrar(
        cookieGeneral,
        pago(cli, [n.id], { fechaPago: F1 }),
      ).expect(400);
      expect(mensaje(anterior)).toBe(
        `La fecha del pago no puede ser anterior a la nota más vieja que marcaste (${F2}).`,
      );

      const futura = await cobrar(
        cookieGeneral,
        pago(cli, [n.id], { fechaPago: mananaEnTijuana() }),
      ).expect(400);
      expect(mensaje(futura)).toBe('La fecha del pago no puede ser futura.');
      expect(await abonosDe(n.id)).toEqual([]);
    });

    it('Review Focus 4: el monto viaja en centavos enteros; con decimales, como texto, en cero o negativo es 400', async () => {
      const cli = await sembrarCliente(tjId);
      const n = await sembrarNota(cli, '100.00', F1);
      for (const montoCentavos of [150050.5, '15000', 0, -100]) {
        const res = await cobrar(
          cookieGeneral,
          pago(cli, [n.id], { montoCentavos }),
        ).expect(400);
        expect(res.body).toMatchObject({
          message: expect.arrayContaining([MENSAJE_MONTO]) as unknown,
        });
      }
      expect(await abonosDe(n.id)).toEqual([]);
    });

    it('la vista previa da el reparto y no escribe nada', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);

      const plan = (
        await vistaPrevia(cookieGeneral, {
          clienteId: cli,
          notaIds: [n2.id],
          montoCentavos: 20000,
          modo: 'pago',
        }).expect(200)
      ).body as PlanDeCobro;

      expect(plan.aplicaciones.map((a) => [a.folio, a.montoCentavos])).toEqual([
        [n2.folio, 8000],
        [n1.folio, 10000],
      ]);
      expect(plan.saldoFavorCentavos).toBe(2000);
      expect(await abonosDe(n1.id)).toEqual([]);
      expect(await abonosDe(n2.id)).toEqual([]);
      expect(await statusDe(n2.id)).toBe('pendiente');
      expect(await movimientosDe(cli)).toEqual([]);
    });
  });

  /**
   * Sincronizacion por bloqueos, no por tiempos (como facturas.e2e-spec.ts): la
   * transaccion A —lo que hace la tablet al proyectar— bloquea la nota, la paga
   * y NO confirma; la peticion del portal arranca y se espera hasta que
   * `pg_blocking_pids` diga que esta bloqueada por A; entonces A confirma.
   */
  describe('carrera con un cobro de la tablet en vuelo', () => {
    it('Review Focus 1: el cobro del portal espera el candado, ve la nota ya pagada y responde 409', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      let pendiente: Promise<request.Response> | undefined;

      await db
        .transaction()
        .execute(async (trx) => {
          await sql`select id from venta_nota where id = ${n2.id} for update`.execute(
            trx,
          );
          await trx
            .insertInto('cobranza_abono')
            .values({
              venta_nota_id: n2.id,
              vendedor_id: vendedorApp,
              fecha_pago: F2,
              fecha_operacion: F2,
              monto: '80.00',
              tipo: 'cobranza',
              saldo_pendiente: '0.00',
              metodo_pago: 'efectivo',
              origen: 'cobro',
            })
            .execute();
          await trx
            .updateTable('venta_nota')
            .set({ status: 'pagada' })
            .where('id', '=', n2.id)
            .execute();
          const pidA = (
            await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(
              trx,
            )
          ).rows[0].pid;

          // `.then` dispara la peticion de supertest.
          pendiente = cobrar(
            cookieGeneral,
            pago(cli, [n1.id, n2.id], { montoCentavos: 18000 }),
          ).then((r) => r);
          // Tope menor que el timeout de Jest (5 s): si la peticion nunca se
          // bloquea, el error claro sale antes y el rollback libera al portal.
          const limite = Date.now() + ESPERA_MAX_BLOQUEO_MS;
          for (;;) {
            const { rows } = await sql<{ n: number }>`
              select count(*)::int as n from pg_stat_activity
               where ${pidA}::int = any(pg_blocking_pids(pid))
            `.execute(db);
            if (rows[0].n > 0) break;
            if (Date.now() > limite)
              throw new Error('el cobro del portal nunca se bloqueo');
            await new Promise((r) => setTimeout(r, 25));
          }
        })
        .catch(async (error: unknown) => {
          // El rollback ya solto la peticion: se espera para no dejarla colgada.
          await pendiente?.catch(() => undefined);
          throw error;
        });

      const res = await pendiente!;
      expect(res.status).toBe(409);
      expect(mensaje(res)).toBe(
        `La nota ${n2.folio} ya no tiene saldo; vuelve a cargar.`,
      );
      expect(await abonosDe(n1.id)).toEqual([]);
      expect(await abonosDe(n2.id)).toHaveLength(1);
    });
  });

  describe('aplicar saldo a favor', () => {
    it('lo reparte entre las palomeadas, sin cobrador ni dinero nuevo, y deja el movimiento negativo', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const n3 = await sembrarNota(cli, '50.00', F3);
      await darSaldoFavor(cli, '150.00');

      const r = (
        await aplicarSaldo(cookieGeneral, {
          clienteId: cli,
          notaIds: [n2.id, n1.id],
          montoCentavos: 12000,
        }).expect(201)
      ).body as CobroRegistrado;

      expect(
        r.aplicaciones.map((a) => [a.folio, a.montoCentavos, a.status]),
      ).toEqual([
        [n1.folio, 10000, 'pagada'],
        [n2.folio, 2000, 'abonado'],
      ]);
      expect(await abonosDe(n1.id)).toEqual([
        {
          monto: '100.00',
          tipo: 'cobranza',
          saldo_pendiente: '0.00',
          metodo_pago: 'saldo_favor',
          origen: 'saldo_favor',
          vendedor_id: null,
          capturo_usuario_id: usuarioGeneralId,
          fecha_pago: hoyEnTijuana(),
          fecha_operacion: hoyEnTijuana(),
        },
      ]);
      expect(await abonosDe(n3.id)).toEqual([]);
      expect(
        (await movimientosDe(cli)).map((m) => [m.monto, m.origen]),
      ).toEqual([
        ['150.00', 'excedente_cobro'],
        ['-120.00', 'aplicacion'],
      ]);
      const cuerpo = (
        await porCobrar(cookieGeneral, { clienteId: cli }).expect(200)
      ).body as ClientePorCobrar;
      expect(cuerpo.saldoFavorCentavos).toBe(3000);
    });

    it('Review Focus 3: mas del saldo a favor que hay, o mas de lo que deben las palomeadas, es 409 y no graba nada', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      await darSaldoFavor(cli, '150.00');

      const deMas = await aplicarSaldo(cookieGeneral, {
        clienteId: cli,
        notaIds: [n1.id, n2.id],
        montoCentavos: 16000,
      }).expect(409);
      expect(mensaje(deMas)).toBe(
        'El cliente solo tiene $150.00 de saldo a favor.',
      );

      const masQueLaDeuda = await aplicarSaldo(cookieGeneral, {
        clienteId: cli,
        notaIds: [n2.id],
        montoCentavos: 9000,
      }).expect(409);
      expect(mensaje(masQueLaDeuda)).toBe(
        'Las notas marcadas solo deben $80.00: no se puede aplicar más saldo a favor que eso.',
      );

      expect(await abonosDe(n1.id)).toEqual([]);
      expect(await abonosDe(n2.id)).toEqual([]);
      expect(await movimientosDe(cli)).toHaveLength(1);
    });

    it('la vista previa del saldo a favor da el reparto y tambien rechaza lo que excede', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      await darSaldoFavor(cli, '40.00');

      const plan = (
        await vistaPrevia(cookieGeneral, {
          clienteId: cli,
          notaIds: [n1.id],
          montoCentavos: 4000,
          modo: 'saldo_favor',
        }).expect(200)
      ).body as PlanDeCobro;
      expect(plan).toMatchObject({
        saldoFavorCentavos: 0,
        aplicaciones: [
          { folio: n1.folio, montoCentavos: 4000, saldoDespuesCentavos: 6000 },
        ],
      });

      await vistaPrevia(cookieGeneral, {
        clienteId: cli,
        notaIds: [n1.id],
        montoCentavos: 5000,
        modo: 'saldo_favor',
      }).expect(409);
      expect(await abonosDe(n1.id)).toEqual([]);
    });

    it('una venta pagada con saldo a favor ya no se edita ni se elimina', async () => {
      const cli = await sembrarCliente(tjId);
      const n = await sembrarNota(cli, '100.00', F1);
      await darSaldoFavor(cli, '100.00');
      await aplicarSaldo(cookieGeneral, {
        clienteId: cli,
        notaIds: [n.id],
        montoCentavos: 10000,
      }).expect(201);

      const detalle = (
        await request(app.getHttpServer())
          .get(`/ventas/${n.id}`)
          .set('Cookie', cookieGeneral)
          .expect(200)
      ).body as VentaDetalle;
      expect(detalle).toMatchObject({
        status: 'pagada',
        editable: false,
        motivoNoEditable: MOTIVO_CON_COBROS,
      });
      expect(detalle.cobros).toEqual([
        expect.objectContaining({
          metodoPago: 'saldo_favor',
          origen: 'saldo_favor',
        }),
      ]);

      const res = await request(app.getHttpServer())
        .delete(`/ventas/${n.id}`)
        .set('Cookie', cookieGeneral)
        .expect(409);
      expect(mensaje(res)).toBe(
        'Tiene cobros registrados: no se puede eliminar.',
      );
    });
  });

  describe('la tablet ve lo que cobro la oficina', () => {
    it('el pull baja la nota cobrada desde el portal, su abono y el saldo a favor nuevo', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const corte = ((await pull().expect(200)).body as RespuestaPull)
        .servidor_en;

      // 200 = 100 (n1) + 80 (n2) + 20 a saldo a favor.
      await cobrar(
        cookieGeneral,
        pago(cli, [n1.id], { montoCentavos: 20000 }),
      ).expect(201);

      const primero = (await pull({ desde: corte }).expect(200))
        .body as RespuestaPull;
      expect(
        primero.notas_pendientes.find((n) => n.id === n1.id),
      ).toMatchObject({
        activo: 0,
        saldo_centavos: 0,
        abonos: [
          {
            fecha_pago: PAGO,
            monto_centavos: 10000,
            metodo_pago: 'transferencia',
          },
        ],
      });
      expect(
        primero.notas_pendientes.find((n) => n.id === n2.id),
      ).toMatchObject({ activo: 0, saldo_centavos: 0 });
      expect(
        primero.catalogos.clientes.find((c) => c.id === cli)
          ?.saldo_favor_centavos,
      ).toBe(2000);

      // Y la aplicacion del saldo a favor baja como abono `saldo_favor`.
      const n3 = await sembrarNota(cli, '50.00', F3);
      const corte2 = ((await pull().expect(200)).body as RespuestaPull)
        .servidor_en;
      await aplicarSaldo(cookieGeneral, {
        clienteId: cli,
        notaIds: [n3.id],
        montoCentavos: 2000,
      }).expect(201);

      const segundo = (await pull({ desde: corte2 }).expect(200))
        .body as RespuestaPull;
      expect(
        segundo.notas_pendientes.find((n) => n.id === n3.id),
      ).toMatchObject({
        activo: 1,
        saldo_centavos: 3000,
        abonos: [
          {
            fecha_pago: hoyEnTijuana(),
            monto_centavos: 2000,
            metodo_pago: 'saldo_favor',
          },
        ],
      });
      expect(
        segundo.catalogos.clientes.find((c) => c.id === cli)
          ?.saldo_favor_centavos,
      ).toBe(0);
    });
  });
});

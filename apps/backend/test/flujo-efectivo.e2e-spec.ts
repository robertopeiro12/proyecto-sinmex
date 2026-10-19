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
import type { FlujoEfectivo } from './../src/modules/flujo-efectivo/flujo-efectivo.service';

const SUFIJO = `${Date.now()}-${process.pid}`;
const PREFIJO = `ZZ-e2e-t32-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-t32-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-t32-tj-${SUFIJO}`;
const LOGIN_SIN = `e2e-t32-sin-${SUFIJO}`;

describe('Flujo de Efectivo (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  const vendedorIds: string[] = [];
  let idTijuana: string;
  let vendedorId: string;
  let general: string;
  let tijuana: string;
  let sin: string;

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

  /** Venta de portal; si es de contado, con su abono `venta_contado` en efectivo. */
  const sembrarVenta = async (
    clienteId: string,
    sucursalId: string,
    fecha: string,
    monto: string,
    o: {
      contado?: boolean;
      vendedorId?: string | null;
      comentarios?: string;
    } = {},
  ): Promise<string> => {
    const vendedor = o.vendedorId ?? null;
    const { id } = await db
      .insertInto('venta_nota')
      .values({
        folio: `ZZT32${Math.random().toString(36).slice(2, 9)}`.slice(0, 30),
        fecha,
        cliente_id: clienteId,
        vendedor_id: vendedor,
        monto_total: monto,
        num_nota: null,
        contado_credito: o.contado ? 'contado' : 'credito',
        semana: 1,
        mes: 1,
        status: o.contado ? 'pagada' : 'pendiente',
        sucursal_id: sucursalId,
        origen: vendedor ? 'app' : 'portal',
        capturo_usuario_id: vendedor ? null : usuarioIds[0],
        comentarios: o.comentarios ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (o.contado) {
      await db
        .insertInto('cobranza_abono')
        .values({
          venta_nota_id: id,
          fecha_pago: fecha,
          fecha_operacion: fecha,
          vendedor_id: vendedor,
          monto,
          tipo: 'cobranza',
          saldo_pendiente: '0',
          metodo_pago: 'efectivo',
          origen: 'venta_contado',
          capturo_usuario_id: vendedor ? null : usuarioIds[0],
        })
        .execute();
    }
    return id;
  };

  const flujo = async (
    cookie: string,
    desde: string,
    hasta: string,
    sucursal = 'TJ',
  ): Promise<FlujoEfectivo> =>
    (
      await http()
        .get(
          `/flujo-efectivo?desde=${desde}&hasta=${hasta}&sucursal=${sucursal}`,
        )
        .set('Cookie', cookie)
        .expect(200)
    ).body as FlujoEfectivo;

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

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', idTijuana);
    await crearUsuario(LOGIN_SIN, 'Auxiliar Administrativo', null);

    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-t32-v-${SUFIJO}`,
        nombre: `Vendedor ${PREFIJO}`,
        password_hash: 'x',
        sucursal_id: idTijuana,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorId = id;
    vendedorIds.push(id);

    general = await iniciarSesion(LOGIN_GENERAL);
    tijuana = await iniciarSesion(LOGIN_TIJUANA);
    sin = await iniciarSesion(LOGIN_SIN);
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
    if (vendedorIds.length > 0) {
      await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
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

  it('separa lo cobrado por repartidor y por oficina; incluye el contado', async () => {
    const dia = '2018-11-05';
    const antes = await flujo(general, dia, dia);
    const cliente = await sembrarCliente('Cliente caso 1', idTijuana);
    await sembrarVenta(cliente, idTijuana, dia, '1000.00');
    await sembrarCobro(db, {
      clienteId: cliente,
      vendedorId,
      monto: '300.00',
      fecha: dia,
    });
    await sembrarCobro(db, {
      clienteId: cliente,
      vendedorId: null,
      monto: '200.00',
      fecha: dia,
    });
    await sembrarVenta(cliente, idTijuana, dia, '150.00', {
      contado: true,
      vendedorId,
    });
    await sembrarVenta(cliente, idTijuana, dia, '50.00', { contado: true });

    const despues = await flujo(general, dia, dia);
    expect(
      despues.cobradoRepartidorCentavos - antes.cobradoRepartidorCentavos,
    ).toBe(45_000);
    expect(despues.cobradoOficinaCentavos - antes.cobradoOficinaCentavos).toBe(
      25_000,
    );
    expect(despues.ventasTotalesCentavos - antes.ventasTotalesCentavos).toBe(
      120_000,
    );
    const d = despues.dias.find((x) => x.fecha === dia);
    expect(d?.ventasCentavos).toBeGreaterThan(0);
    expect(d?.porcentajeCobro).toBe(
      Math.round(
        ((d!.cobradoRepartidorCentavos + d!.cobradoOficinaCentavos) * 1000) /
          d!.ventasCentavos,
      ) / 10,
    );
    expect(despues.gastosDisponibles).toBe(false);
    expect(despues.dias.map((d) => d.fecha)).toContain(dia);
  });

  it('un abono parcial suma; saldo a favor y pagos borrados no', async () => {
    const dia = '2018-11-06';
    const antes = await flujo(general, dia, dia);
    const cliente = await sembrarCliente('Cliente caso 2', idTijuana);
    await sembrarVenta(cliente, idTijuana, dia, '1000.00');
    await sembrarCobro(db, {
      clienteId: cliente,
      vendedorId: null,
      monto: '100.00',
      fecha: dia,
    });
    await sembrarCobro(db, {
      clienteId: cliente,
      vendedorId: null,
      monto: '70.00',
      fecha: dia,
      metodoPago: 'saldo_favor',
    });
    const borrado = await sembrarCobro(db, {
      clienteId: cliente,
      vendedorId: null,
      monto: '40.00',
      fecha: dia,
    });
    await db
      .updateTable('cobro')
      .set({ deleted_at: new Date() })
      .where('id', '=', borrado)
      .execute();

    const despues = await flujo(general, dia, dia);
    expect(despues.cobradoOficinaCentavos - antes.cobradoOficinaCentavos).toBe(
      10_000,
    );
    expect(
      despues.cobradoRepartidorCentavos - antes.cobradoRepartidorCentavos,
    ).toBe(0);
    expect(despues.ventasTotalesCentavos - antes.ventasTotalesCentavos).toBe(
      100_000,
    );
  });

  it('comentarios: ventas con comentario en ingresos; retiros con comentario en egresos', async () => {
    const dia = '2018-11-07';
    const cliente = await sembrarCliente('Cliente caso 3', idTijuana);
    await sembrarVenta(cliente, idTijuana, dia, '10.00', {
      comentarios: 'Pidió factura',
    });
    await sembrarVenta(cliente, idTijuana, dia, '20.00');
    const { id: cuentaId } = await db
      .insertInto('tesoreria_cuenta')
      .values({ nombre: `${PREFIJO} Cuenta`, sucursal_id: idTijuana })
      .returning('id')
      .executeTakeFirstOrThrow();
    await http()
      .post('/tesoreria/movimientos')
      .set('Cookie', general)
      .send({
        tipo: 'retiro',
        fecha: dia,
        montoCentavos: 5_000,
        cuentaId,
        comentario: 'Pago de gasolina',
      })
      .expect(201);

    const r = await flujo(general, dia, dia);
    const ingreso = r.comentarios.ingresos.find(
      (i) => i.cliente === `${PREFIJO} Cliente caso 3`,
    );
    expect(ingreso).toMatchObject({
      fecha: dia,
      comentario: 'Pidió factura',
    });
    expect(ingreso?.folio).toMatch(/^ZZT32/);
    expect(
      r.comentarios.ingresos.filter(
        (i) => i.cliente === `${PREFIJO} Cliente caso 3`,
      ),
    ).toHaveLength(1);
    expect(r.comentarios.egresos).toContainEqual({
      fecha: dia,
      concepto: 'Retiro',
      cuenta: `${PREFIJO} Cuenta`,
      montoCentavos: 5_000,
      comentario: 'Pago de gasolina',
    });
  });

  it('Total Tesorería coincide con GET /tesoreria', async () => {
    type Total = {
      saldoFinalCentavos: number;
      cuentasConSaldoFinal: number;
      cuentas: number;
    };
    // Rango de 2000: ninguna suite escribe saldos ni movimientos ahí. La LISTA
    // de cuentas no depende de la fecha y tesoreria.e2e crea y borra cuentas en
    // paralelo, así que el número total de cuentas solo se compara por forma;
    // una cuenta nueva o borrada no tiene saldo en 2000 y no mueve lo demás.
    const r = await flujo(general, '2000-01-01', '2000-01-31');
    const { total } = (
      await http()
        .get('/tesoreria?desde=2000-01-01&hasta=2000-01-31&sucursal=TJ')
        .set('Cookie', general)
        .expect(200)
    ).body as { total: Total };
    expect(r.totalTesoreriaCentavos).toBe(total.saldoFinalCentavos);
    expect(r.tesoreriaCuentasConSaldo).toBe(total.cuentasConSaldoFinal);
    expect(r.tesoreriaCuentas).toBeGreaterThanOrEqual(
      r.tesoreriaCuentasConSaldo,
    );
    expect(r.tesoreriaCuentas).toBeGreaterThan(0);
  });

  it('errores: sin hasta 400, rango de más de un año 400, sin permiso 403, otra sucursal 403', async () => {
    await http()
      .get('/flujo-efectivo?desde=2018-11-01')
      .set('Cookie', general)
      .expect(400);
    await http()
      .get('/flujo-efectivo?desde=2017-01-01&hasta=2018-11-30')
      .set('Cookie', general)
      .expect(400);
    await http()
      .get('/flujo-efectivo?desde=2018-11-01&hasta=2018-11-30')
      .set('Cookie', sin)
      .expect(403);
    await http()
      .get('/flujo-efectivo?desde=2018-11-01&hasta=2018-11-30&sucursal=MX')
      .set('Cookie', tijuana)
      .expect(403);
    await http()
      .get('/flujo-efectivo?desde=2018-11-01&hasta=2018-11-30&sucursal=MX')
      .expect(401);
  });
});

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
import {
  CONTRATO_ACTUAL,
  type RespuestaPush,
} from './../src/modules/sincronizacion/contrato';

/**
 * T-30/T-31 (D7): Tesoreria resta el gasto de la ruta de la cuenta destino del
 * efectivo de la sucursal, leyendolo de `gasto`. Fechas de 2017-2018 a
 * proposito: ninguna otra suite tiene destinos ni movimientos ahi (las de T-29
 * usan 2019), y un destino de TJ desde 2018-07-01 queda tapado por los suyos,
 * mas recientes.
 */
interface Vista {
  cuentas: {
    id: string;
    saldoInicioCentavos: number | null;
    saldoFinalCentavos: number | null;
    entradasCentavos: number;
    salidasCentavos: number;
  }[];
  gastosSinCuenta: { sucursalCodigo: string; montoCentavos: number }[];
  eventos: {
    tipo: string;
    id: string;
    cuentaId: string;
    fecha: string;
    sucursalCodigo?: string;
    cantidad?: number;
    montoCentavos: number;
  }[];
}

const SUFIJO = `${Date.now()}-${process.pid}`;
const PREFIJO = `ZZ-e2e-tgas-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-tgas-gen-${SUFIJO}`;
const LOGIN_VENDEDOR = `e2e-tgas-v-${SUFIJO}`;

describe('Tesorería — gastos de la ruta (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let usuarioId: string;
  let general: string;
  let bearer: string;
  let idTijuana: string;
  let idMexicali: string;
  let vendedorTj: string;
  let vendedorMx: string;
  let campoId: string;
  let cuentaEfectivo: string;

  const http = () => request(app.getHttpServer());

  const vista = async (desde: string, hasta: string, sucursal: string) =>
    (
      await http()
        .get(`/tesoreria?desde=${desde}&hasta=${hasta}&sucursal=${sucursal}`)
        .set('Cookie', general)
        .expect(200)
    ).body as Vista;

  /** Un gasto vivo de la ruta, como lo deja `GastosService` al proyectar. */
  const sembrarGasto = async (
    vendedorId: string,
    sucursalId: string,
    fecha: string,
    monto: string,
  ): Promise<string> => {
    const id = randomUUID();
    await db
      .insertInto('gasto')
      .values({
        id,
        sucursal_id: sucursalId,
        vendedor_id: vendedorId,
        campo_egreso_id: campoId,
        campo_nombre: `${PREFIJO} Hielo`,
        tipo: 'operacion',
        fecha,
        registrado_en: `${fecha}T18:00:00.000Z`,
        monto,
        metodo: 'efectivo_cobranza_dia',
        origen: 'app',
      })
      .execute();
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

    const passwords = app.get(PasswordService);
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Administrador General')
      .executeTakeFirstOrThrow();
    usuarioId = (
      await db
        .insertInto('usuario')
        .values({
          login: LOGIN_GENERAL,
          nombre: LOGIN_GENERAL,
          password_hash: await passwords.hashear(PASSWORD),
          perfil_id: perfilId,
          sucursal_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const hashVendedor = await passwords.hashear(PASSWORD);
    vendedorTj = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN_VENDEDOR,
          nombre: 'Vendedor TJ de Tesorería',
          password_hash: hashVendedor,
          sucursal_id: idTijuana,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    vendedorMx = (
      await db
        .insertInto('vendedor')
        .values({
          login: `${LOGIN_VENDEDOR}-mx`,
          nombre: 'Vendedor MX de Tesorería',
          password_hash: hashVendedor,
          sucursal_id: idMexicali,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    campoId = (
      await db
        .insertInto('campo_egreso')
        .values({
          nombre: `${PREFIJO} Hielo`,
          tipo: 'operacion',
          se_usa_en_app: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // La cuenta de efectivo de TJ: saldo inicial y destino del efectivo desde julio de 2018.
    cuentaEfectivo = (
      await db
        .insertInto('tesoreria_cuenta')
        .values({ nombre: `${PREFIJO} Efectivo TJ`, sucursal_id: idTijuana })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await db
      .insertInto('tesoreria_saldo')
      .values({
        cuenta_id: cuentaEfectivo,
        fecha: '2018-07-01',
        monto: '1000.00',
        capturo_usuario_id: usuarioId,
      })
      .execute();

    const sesion = await http()
      .post('/auth/login')
      .send({ login: LOGIN_GENERAL, password: PASSWORD })
      .expect(200);
    const cookies = sesion.headers['set-cookie'] as unknown as string[];
    const acceso = cookies.find((c) => c.startsWith('jawa_access='));
    if (!acceso) throw new Error('El login no devolvio cookie de acceso.');
    general = acceso.split(';')[0];

    await http()
      .put('/tesoreria/destinos')
      .set('Cookie', general)
      .send({
        sucursalId: idTijuana,
        metodo: 'efectivo',
        cuentaId: cuentaEfectivo,
        desde: '2018-07-01',
      })
      .expect(200);

    const login = await http()
      .post('/auth/app/login')
      .send({ login: LOGIN_VENDEDOR, password: PASSWORD })
      .expect(200);
    bearer = (login.body as { tokenAcceso: string }).tokenAcceso;
  });

  afterAll(async () => {
    // Orden inverso a las llaves foraneas.
    await db
      .deleteFrom('gasto')
      .where('vendedor_id', 'in', [vendedorTj, vendedorMx])
      .execute();
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', 'in', [vendedorTj, vendedorMx])
      .execute();
    await db
      .deleteFrom('campo_egreso')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db
      .deleteFrom('tesoreria_destino_cobranza')
      .where('cuenta_id', '=', cuentaEfectivo)
      .execute();
    await db
      .deleteFrom('tesoreria_saldo')
      .where('cuenta_id', '=', cuentaEfectivo)
      .execute();
    await db
      .deleteFrom('tesoreria_cuenta')
      .where('id', '=', cuentaEfectivo)
      .execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', 'in', [vendedorTj, vendedorMx])
      .execute();
    await db
      .deleteFrom('vendedor')
      .where('id', 'in', [vendedorTj, vendedorMx])
      .execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', '=', usuarioId)
      .execute();
    await db.deleteFrom('usuario').where('id', '=', usuarioId).execute();
    await app.close();
  });

  it('los gastos del dia restan de la cuenta de efectivo de TJ y salen como un evento "gasto-ruta"', async () => {
    await sembrarGasto(vendedorTj, idTijuana, '2018-07-05', '250.50');
    await sembrarGasto(vendedorTj, idTijuana, '2018-07-05', '80.00');
    const borrado = await sembrarGasto(
      vendedorTj,
      idTijuana,
      '2018-07-05',
      '999.00',
    );
    await db
      .updateTable('gasto')
      .set({ deleted_at: new Date() })
      .where('id', '=', borrado)
      .execute();
    // Uno de MX el mismo dia no toca la cuenta de TJ.
    await sembrarGasto(vendedorMx, idMexicali, '2018-07-05', '10.00');

    const v = await vista('2018-07-05', '2018-07-05', 'TJ');
    expect(v.cuentas.find((c) => c.id === cuentaEfectivo)).toMatchObject({
      saldoInicioCentavos: 100_000,
      entradasCentavos: 0,
      salidasCentavos: 33_050,
      saldoFinalCentavos: 66_950,
    });
    expect(
      v.eventos.filter(
        (e) => e.cuentaId === cuentaEfectivo && e.tipo === 'gasto-ruta',
      ),
    ).toEqual([
      expect.objectContaining({
        fecha: '2018-07-05',
        sucursalCodigo: 'TJ',
        cantidad: 2,
        montoCentavos: 33_050,
      }),
    ]);
  });

  it('un gasto subido a una hora en que en UTC ya es otro dia cuenta en su fecha_operacion (Review Focus)', async () => {
    const clave = randomUUID();
    const res = await http()
      .post('/sync/push')
      .set('Authorization', `Bearer ${bearer}`)
      .send({
        contrato: CONTRATO_ACTUAL,
        operaciones: [
          {
            clave,
            tipo: 'gasto',
            fecha_operacion: '2018-07-10',
            // 18:30 del 10 en Tijuana = 01:30 del 11 en UTC.
            ocurrido_en: '2018-07-11T01:30:00.000Z',
            datos: {
              campo_egreso_id: campoId,
              monto_centavos: 4_500,
              registrado_en: '2018-07-11T01:30:00.000Z',
              comentario: null,
            },
          },
        ],
      })
      .expect(200);
    expect((res.body as RespuestaPush).resultados[0].estado).toBe('aplicada');

    const dia10 = await vista('2018-07-10', '2018-07-10', 'TJ');
    expect(
      dia10.cuentas.find((c) => c.id === cuentaEfectivo)?.salidasCentavos,
    ).toBe(4_500);
    expect(
      dia10.eventos.find(
        (e) => e.cuentaId === cuentaEfectivo && e.tipo === 'gasto-ruta',
      ),
    ).toMatchObject({ fecha: '2018-07-10', montoCentavos: 4_500 });

    const dia11 = await vista('2018-07-11', '2018-07-11', 'TJ');
    expect(
      dia11.cuentas.find((c) => c.id === cuentaEfectivo)?.salidasCentavos,
    ).toBe(0);
  });

  it('un gasto dado de baja deja de restar solo: no hay nada copiado en Tesorería', async () => {
    const id = await sembrarGasto(vendedorTj, idTijuana, '2018-07-15', '20.00');
    const antes = await vista('2018-07-15', '2018-07-15', 'TJ');
    expect(
      antes.cuentas.find((c) => c.id === cuentaEfectivo)?.salidasCentavos,
    ).toBe(2_000);

    await db
      .updateTable('gasto')
      .set({ deleted_at: new Date() })
      .where('id', '=', id)
      .execute();
    const despues = await vista('2018-07-15', '2018-07-15', 'TJ');
    expect(
      despues.cuentas.find((c) => c.id === cuentaEfectivo)?.salidasCentavos,
    ).toBe(0);
    expect(
      despues.eventos.some(
        (e) => e.cuentaId === cuentaEfectivo && e.tipo === 'gasto-ruta',
      ),
    ).toBe(false);
  });

  it('una sucursal sin cuenta de efectivo: el gasto sale en gastosSinCuenta y no se pierde (Review Focus)', async () => {
    // MX · efectivo en junio de 2017 no tiene destino en ninguna suite.
    await sembrarGasto(vendedorMx, idMexicali, '2017-06-10', '12.34');
    const mx = await vista('2017-06-10', '2017-06-10', 'MX');
    expect(mx.gastosSinCuenta).toEqual([
      { sucursalCodigo: 'MX', montoCentavos: 1_234 },
    ]);
    expect(mx.eventos.some((e) => e.tipo === 'gasto-ruta')).toBe(false);

    // Mirando TJ no se reporta lo de MX.
    const tj = await vista('2017-06-10', '2017-06-10', 'TJ');
    expect(tj.gastosSinCuenta.some((g) => g.sucursalCodigo === 'MX')).toBe(
      false,
    );
  });
});

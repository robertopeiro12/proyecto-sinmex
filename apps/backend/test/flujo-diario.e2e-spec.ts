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
import type {
  FlujoDiario,
  ResumenVendedorDia,
} from './../src/modules/estadisticas/reglas-flujo-diario';
import { borrarCobrosDe, sembrarCobro } from './apoyo-cobros';

const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
// Codigo propio (las otras suites usan ZV y otros) y fechas de 2018.
const CODIGO = 'FD';
const DESDE = '2018-05-01';
const HASTA = '2018-05-31';

describe('Flujo diario (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  const vendedorIds: string[] = [];
  let idFd: string;
  let generalId: string;
  let cookieGeneral: string;
  let cookieFd: string;
  let cookieSinPermiso: string;
  let cookieConExcepcion: string;
  let productoId: string;
  let presentacionId: string;
  let motivoId: string;
  let campoId: string;
  let vehiculoId: string;
  let ana: string;
  let beto: string;
  let carla: string;
  let dani: string;
  let folios = 0;

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

  const sembrarCliente = async (nombre: string): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `${nombre} ${SUFIJO}`,
        domicilio: 'Calle 1',
        telefono: '6640000000',
        tipo: 'cliente',
        lista_precio_id: lista.id,
        sucursal_id: idFd,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return id;
  };

  const sembrarVendedor = async (nombre: string): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-fd-${vendedorIds.length + 1}-${SUFIJO}`,
        nombre: `${nombre} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: idFd,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  const sembrarVenta = async (v: {
    clienteId: string;
    fecha: string;
    vendedor: string | null;
    monto: string;
    contado?: boolean;
    borrada?: boolean;
    lineas?: { cantidad: number; promo?: number; borrada?: boolean }[];
  }): Promise<string> => {
    const { id } = await db
      .insertInto('venta_nota')
      .values({
        folio: `ZFD${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha: v.fecha,
        cliente_id: v.clienteId,
        vendedor_id: v.vendedor,
        monto_total: v.monto,
        contado_credito: v.contado === false ? 'credito' : 'contado',
        semana: 18,
        mes: 5,
        status: v.contado === false ? 'pendiente' : 'pagada',
        sucursal_id: idFd,
        origen: 'portal',
        capturo_usuario_id: generalId,
        deleted_at: v.borrada ? new Date() : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const l of v.lineas ?? []) {
      await db
        .insertInto('venta_nota_detalle')
        .values({
          venta_nota_id: id,
          presentacion_id: presentacionId,
          cantidad: l.cantidad,
          cantidad_promocion: l.promo ?? 0,
          precio: '6.50',
          deleted_at: l.borrada ? new Date() : null,
        })
        .execute();
    }
    return id;
  };

  const sembrarAbono = async (a: {
    ventaId: string;
    vendedor: string | null;
    fecha: string;
    monto: string;
    origen: 'venta_contado' | 'cobro' | 'saldo_favor';
    cobroId?: string | null;
    borrado?: boolean;
  }): Promise<void> => {
    await db
      .insertInto('cobranza_abono')
      .values({
        venta_nota_id: a.ventaId,
        vendedor_id: a.vendedor,
        fecha_pago: a.fecha,
        fecha_operacion: a.fecha,
        monto: a.monto,
        tipo: 'abono',
        saldo_pendiente: '0.00',
        metodo_pago: a.origen === 'saldo_favor' ? 'saldo_favor' : 'efectivo',
        origen: a.origen,
        cobro_id: a.cobroId ?? null,
        deleted_at: a.borrado ? new Date() : null,
      })
      .execute();
  };

  const sembrarRuta = async (
    vendedor: string,
    fecha: string,
    clientes: string[],
  ): Promise<void> => {
    let orden = 1;
    for (const clienteId of clientes) {
      await db
        .insertInto('ruta')
        .values({
          vendedor_id: vendedor,
          cliente_id: clienteId,
          fecha,
          tipo: 'diaria',
          orden: orden++,
        })
        .execute();
    }
  };

  const pedir = (cookie: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/reportes/flujo-diario?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const deFd = async (
    extra: Record<string, string> = {},
  ): Promise<FlujoDiario> =>
    (
      await pedir(cookieGeneral, {
        desde: DESDE,
        hasta: HASTA,
        sucursal: CODIGO,
        ...extra,
      }).expect(200)
    ).body as FlujoDiario;

  const renglon = (
    r: FlujoDiario,
    vendedorId: string,
    fecha: string,
  ): ResumenVendedorDia | undefined =>
    r.porVendedor.find((x) => x.vendedorId === vendedorId && x.fecha === fecha);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    idFd = (
      await db
        .insertInto('sucursal')
        .values({ codigo: CODIGO, nombre: 'Prueba Flujo Diario' })
        .onConflict((oc) =>
          oc.column('codigo').doUpdateSet({ deleted_at: null }),
        )
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    generalId = await crearUsuario(
      `e2e-fd-gen-${SUFIJO}`,
      'Administrador General',
      null,
    );
    await crearUsuario(`e2e-fd-fd-${SUFIJO}`, 'Administrador General', idFd);
    await crearUsuario(`e2e-fd-sin-${SUFIJO}`, 'Auxiliar Administrativo', null);
    const conExcepcion = await crearUsuario(
      `e2e-fd-exc-${SUFIJO}`,
      'Auxiliar Administrativo',
      null,
    );
    const { id: permisoId } = await db
      .selectFrom('permiso')
      .select('id')
      .where('clave', '=', 'reporte_ventas.ver')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('usuario_permiso')
      .values({
        usuario_id: conExcepcion,
        permiso_id: permisoId,
        habilitado: true,
      })
      .execute();
    cookieGeneral = await iniciarSesion(`e2e-fd-gen-${SUFIJO}`);
    cookieFd = await iniciarSesion(`e2e-fd-fd-${SUFIJO}`);
    cookieSinPermiso = await iniciarSesion(`e2e-fd-sin-${SUFIJO}`);
    cookieConExcepcion = await iniciarSesion(`e2e-fd-exc-${SUFIJO}`);

    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: `Horchata fd ${SUFIJO}` })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    presentacionId = (
      await db
        .insertInto('presentacion')
        .values({ producto_id: productoId, volumen: '1 L' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    motivoId = (
      await db
        .insertInto('motivo_visita')
        .values({ nombre: `fd ${SUFIJO} Cerrado` })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    campoId = (
      await db
        .insertInto('campo_egreso')
        .values({
          nombre: `fd ${SUFIJO} Hielo`,
          tipo: 'operacion',
          se_usa_en_app: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    vehiculoId = (
      await db
        .insertInto('vehiculo')
        .values({ nombre: `Camioneta fd ${SUFIJO}`, sucursal_id: idFd })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    ana = await sembrarVendedor('Ana');
    beto = await sembrarVendedor('Beto');
    carla = await sembrarVendedor('Carla');
    dani = await sembrarVendedor('Dani');
    const c1 = await sembrarCliente('Cliente 1');
    const c2 = await sembrarCliente('Cliente 2');
    const c3 = await sembrarCliente('Cliente 3');
    const c4 = await sembrarCliente('Cliente 4');

    // Ana, 05-07: ruta de 3, venta de contado a c1 (una linea borrada), visita a c2.
    await sembrarRuta(ana, '2018-05-07', [c1, c2, c3]);
    const ventaAna = await sembrarVenta({
      clienteId: c1,
      fecha: '2018-05-07',
      vendedor: ana,
      monto: '130.00',
      lineas: [
        { cantidad: 20, promo: 2 },
        { cantidad: 99, borrada: true },
      ],
    });
    await sembrarAbono({
      ventaId: ventaAna,
      vendedor: ana,
      fecha: '2018-05-07',
      monto: '130.00',
      origen: 'venta_contado',
    });
    await db
      .insertInto('visita')
      .values({
        id: randomUUID(),
        vendedor_id: ana,
        sucursal_id: idFd,
        cliente_id: c2,
        motivo_visita_id: motivoId,
        fecha: '2018-05-07',
        visitada_en: new Date(),
        direccion_texto: 'sembrada',
      })
      .execute();

    // Beto, 05-07: solo ruta.
    await sembrarRuta(beto, '2018-05-07', [c3]);

    // Carla: nota a credito del 05-01 de c4 (150); el 05-08 cobra 200 (150 + 50 a favor).
    const notaCarla = await sembrarVenta({
      clienteId: c4,
      fecha: '2018-05-01',
      vendedor: carla,
      monto: '150.00',
      contado: false,
      lineas: [{ cantidad: 10 }],
    });
    const cobroCarla = await sembrarCobro(db, {
      clienteId: c4,
      vendedorId: carla,
      monto: '200.00',
      fecha: '2018-05-08',
    });
    await sembrarAbono({
      ventaId: notaCarla,
      vendedor: carla,
      fecha: '2018-05-08',
      monto: '150.00',
      origen: 'cobro',
      cobroId: cobroCarla,
    });
    // Mismo dia que el cobro vivo (05-08): un cobro borrado con su abono, una venta
    // eliminada con su abono de contado vivo y un pago de saldo a favor con vendedor.
    // Ninguno debe mover contado, anteriores ni aFavor.
    const cobroBorrado = await sembrarCobro(db, {
      clienteId: c4,
      vendedorId: carla,
      monto: '99.00',
      fecha: '2018-05-08',
    });
    await db
      .updateTable('cobro')
      .set({ deleted_at: new Date() })
      .where('id', '=', cobroBorrado)
      .execute();
    await sembrarAbono({
      ventaId: notaCarla,
      vendedor: carla,
      fecha: '2018-05-08',
      monto: '99.00',
      origen: 'cobro',
      cobroId: cobroBorrado,
      borrado: true,
    });
    const ventaEliminada = await sembrarVenta({
      clienteId: c4,
      fecha: '2018-05-08',
      vendedor: carla,
      monto: '77.00',
      borrada: true,
      lineas: [{ cantidad: 5 }],
    });
    await sembrarAbono({
      ventaId: ventaEliminada,
      vendedor: carla,
      fecha: '2018-05-08',
      monto: '77.00',
      origen: 'venta_contado',
    });
    const cobroSaldoCarla = await db
      .insertInto('cobro')
      .values({
        cliente_id: c4,
        vendedor_id: carla,
        origen: 'saldo_favor',
        metodo_pago: 'saldo_favor',
        monto: '33.00',
        fecha_pago: '2018-05-08',
        fecha_operacion: '2018-05-08',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await sembrarAbono({
      ventaId: notaCarla,
      vendedor: carla,
      fecha: '2018-05-08',
      monto: '33.00',
      origen: 'saldo_favor',
      cobroId: cobroSaldoCarla.id,
    });

    // Oficina, 05-08: cobro sin vendedor de 80, un saldo a favor aplicado y una venta de mostrador de contado.
    const cobroOficina = await sembrarCobro(db, {
      clienteId: c4,
      vendedorId: null,
      monto: '80.00',
      fecha: '2018-05-08',
    });
    await sembrarAbono({
      ventaId: notaCarla,
      vendedor: null,
      fecha: '2018-05-08',
      monto: '80.00',
      origen: 'cobro',
      cobroId: cobroOficina,
    });
    const cobroSaldo = await sembrarCobro(db, {
      clienteId: c4,
      vendedorId: null,
      monto: '25.00',
      fecha: '2018-05-08',
      metodoPago: 'saldo_favor',
    });
    await sembrarAbono({
      ventaId: notaCarla,
      vendedor: null,
      fecha: '2018-05-08',
      monto: '25.00',
      origen: 'saldo_favor',
      cobroId: cobroSaldo,
    });
    const mostrador = await sembrarVenta({
      clienteId: c4,
      fecha: '2018-05-08',
      vendedor: null,
      monto: '40.00',
      lineas: [{ cantidad: 4 }],
    });
    await sembrarAbono({
      ventaId: mostrador,
      vendedor: null,
      fecha: '2018-05-08',
      monto: '40.00',
      origen: 'venta_contado',
    });

    // Dani, 05-09: gasto y jornada cerrada.
    await db
      .insertInto('gasto')
      .values({
        id: randomUUID(),
        sucursal_id: idFd,
        vendedor_id: dani,
        campo_egreso_id: campoId,
        campo_nombre: `fd ${SUFIJO} Hielo`,
        tipo: 'operacion',
        fecha: '2018-05-09',
        registrado_en: '2018-05-09T18:00:00.000Z',
        monto: '45.00',
        metodo: 'efectivo_cobranza_dia',
        origen: 'app',
      })
      .execute();
    await db
      .insertInto('jornada')
      .values({
        vendedor_id: dani,
        vehiculo_id: vehiculoId,
        sucursal_id: idFd,
        fecha: '2018-05-09',
        km_inicial: 100,
        km_final: 150,
        abierta_en: '2018-05-09T15:00:00Z',
        cerrada_en: '2018-05-09T22:00:00Z',
      })
      .execute();
  });

  afterAll(async () => {
    const porVendedor = <T extends 'gasto' | 'visita' | 'jornada' | 'ruta'>(
      t: T,
    ) =>
      db
        .deleteFrom(t as 'gasto')
        .where('vendedor_id', 'in', vendedorIds)
        .execute();
    await porVendedor('gasto');
    await porVendedor('visita');
    await porVendedor('jornada');
    await porVendedor('ruta');
    if (clienteIds.length > 0) {
      const notas = db
        .selectFrom('venta_nota')
        .select('id')
        .where('cliente_id', 'in', clienteIds);
      await db
        .deleteFrom('cobranza_abono')
        .where('venta_nota_id', 'in', notas)
        .execute();
      await borrarCobrosDe(db, clienteIds);
      await db
        .deleteFrom('venta_nota_detalle')
        .where('venta_nota_id', 'in', notas)
        .execute();
      await db
        .deleteFrom('venta_nota')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    await db.deleteFrom('vehiculo').where('id', '=', vehiculoId).execute();
    await db.deleteFrom('campo_egreso').where('id', '=', campoId).execute();
    await db.deleteFrom('motivo_visita').where('id', '=', motivoId).execute();
    await db
      .deleteFrom('presentacion')
      .where('producto_id', '=', productoId)
      .execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
    await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
    await db
      .deleteFrom('usuario_permiso')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await db.deleteFrom('sucursal').where('codigo', '=', CODIGO).execute();
    await app.close();
  });

  /* ================================================================ */

  describe('permiso, alcance y validacion', () => {
    it('sin sesion 401; sin reporte_ventas.ver 403; con la excepcion 200', async () => {
      await request(app.getHttpServer())
        .get(`/reportes/flujo-diario?desde=${DESDE}&hasta=${HASTA}`)
        .expect(401);
      await pedir(cookieSinPermiso, { desde: DESDE, hasta: HASTA }).expect(403);
      await pedir(cookieConExcepcion, {
        desde: DESDE,
        hasta: HASTA,
        sucursal: CODIGO,
      }).expect(200);
    });

    it('rango invalido o de mas de un ano es 400; vendedor que no es uuid es 400', async () => {
      await pedir(cookieGeneral, { desde: '2018-02-30', hasta: HASTA }).expect(
        400,
      );
      await pedir(cookieGeneral, { desde: HASTA, hasta: DESDE }).expect(400);
      const largo = await pedir(cookieGeneral, {
        desde: '2017-01-01',
        hasta: HASTA,
      }).expect(400);
      expect(JSON.stringify(largo.body)).toContain('un año');
      await pedir(cookieGeneral, { hasta: HASTA }).expect(400);
      const malo = await pedir(cookieGeneral, {
        desde: DESDE,
        hasta: HASTA,
        vendedor: 'ana',
      }).expect(400);
      expect(JSON.stringify(malo.body)).toContain('El vendedor no es válido.');
    });

    it('atado a FD: "todas" o nada le da FD; pedir otra sucursal es 403', async () => {
      for (const q of [{}, { sucursal: 'todas' }]) {
        const r = (
          await pedir(cookieFd, { desde: DESDE, hasta: HASTA, ...q }).expect(
            200,
          )
        ).body as FlujoDiario;
        expect(new Set(r.porVendedor.map((x) => x.sucursalCodigo))).toEqual(
          new Set([CODIGO]),
        );
        expect(renglon(r, ana, '2018-05-07')).toBeDefined();
      }
      await pedir(cookieFd, {
        desde: DESDE,
        hasta: HASTA,
        sucursal: 'TJ',
      }).expect(403);
    });
  });

  describe('contenido', () => {
    it('Ana: ruta de 3, venta de contado y visita (lineas borradas no cuentan)', async () => {
      const r = await deFd();
      expect(renglon(r, ana, '2018-05-07')).toMatchObject({
        sucursalCodigo: CODIGO,
        clientesEnRuta: 3,
        atendidosEnRuta: 2,
        piezas: 20,
        montoCentavos: 13000,
        contadoCentavos: 13000,
        anterioresCentavos: 0,
        aFavorCentavos: 0,
        cobranzaCentavos: 13000,
        gastoCentavos: 0,
        tesoreriaCentavos: 13000,
        estatus: 'en_ruta',
        vehiculo: null,
      });
    });

    it('Beto: solo ruta, aparece con ceros y en_ruta', async () => {
      const r = await deFd();
      expect(renglon(r, beto, '2018-05-07')).toMatchObject({
        clientesEnRuta: 1,
        atendidosEnRuta: 0,
        piezas: 0,
        montoCentavos: 0,
        cobranzaCentavos: 0,
        estatus: 'en_ruta',
      });
    });

    it('Carla: cobro que paga una nota anterior y deja sobrante a favor', async () => {
      const r = await deFd();
      expect(renglon(r, carla, '2018-05-08')).toMatchObject({
        clientesEnRuta: 0,
        piezas: 0,
        contadoCentavos: 0,
        anterioresCentavos: 15000,
        aFavorCentavos: 5000,
        cobranzaCentavos: 20000,
        tesoreriaCentavos: 20000,
      });
      // La venta a credito del 05-01 la cuenta en su dia.
      expect(renglon(r, carla, '2018-05-01')).toMatchObject({
        piezas: 10,
        montoCentavos: 15000,
        cobranzaCentavos: 0,
      });
    });

    it('cobro borrado, venta eliminada y saldo a favor del mismo dia no mueven las sumas', async () => {
      const r = await deFd();
      expect(renglon(r, carla, '2018-05-08')).toMatchObject({
        contadoCentavos: 0,
        anterioresCentavos: 15000,
        aFavorCentavos: 5000,
        piezas: 0,
        montoCentavos: 0,
        cobranzaCentavos: 20000,
      });
    });

    it('Dani: gasto y jornada cerrada dan terminado y el vehiculo', async () => {
      const r = await deFd();
      expect(renglon(r, dani, '2018-05-09')).toMatchObject({
        gastoCentavos: 4500,
        cobranzaCentavos: 0,
        tesoreriaCentavos: -4500,
        estatus: 'terminado',
        vehiculo: `Camioneta fd ${SUFIJO}`,
      });
    });

    it('la oficina suma en el dia y no en ningun renglon de vendedor; ni saldo a favor ni mostrador cuentan', async () => {
      const r = await deFd();
      const dia = r.porDia.find((d) => d.fecha === '2018-05-08');
      expect(dia).toMatchObject({
        sucursalCodigo: CODIGO,
        oficinaCentavos: 8000,
      });
      // Carla (200) + oficina (80).
      expect(dia?.totales.cobranzaCentavos).toBe(28000);
      for (const x of r.porVendedor) {
        if (x.fecha === '2018-05-08') expect(x.vendedorId).toBe(carla);
      }
      expect(r.porDia.map((d) => d.fecha)).toEqual([
        '2018-05-09',
        '2018-05-08',
        '2018-05-07',
        '2018-05-01',
      ]);
    });

    it('con vendedor elegido, "Por dia" no trae la cobranza de la oficina', async () => {
      const r = await deFd({ vendedor: carla });
      expect(r.porVendedor.map((x) => x.vendedorId)).toEqual([carla, carla]);
      const dia = r.porDia.find((d) => d.fecha === '2018-05-08');
      expect(dia?.oficinaCentavos).toBe(0);
      expect(dia?.totales.cobranzaCentavos).toBe(20000);
    });
  });
});

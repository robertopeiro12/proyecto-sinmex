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
  DetalleDia,
  DetalleVendedorDia,
} from './../src/modules/estadisticas/reglas-detalle';
import type {
  FlujoDiario,
  ResumenVendedorDia,
} from './../src/modules/estadisticas/reglas-flujo-diario';
import { borrarCobrosDe, sembrarCobro } from './apoyo-cobros';

const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
// Codigo propio (las otras suites usan ZV y otros; ZR/ZS no los usa nadie) y fechas de 2018.
// Codigos que ordenan despues de TJ: varias suites toman "la primera sucursal por
// codigo" y, si fuera la nuestra, le meterian vendedores que rompen la limpieza.
const CODIGO = 'ZR';
const CODIGO_OTRA = 'ZS';
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
  let presentacionMediaId: string;
  let motivoId: string;
  let campoId: string;
  let vehiculoId: string;
  let ana: string;
  let beto: string;
  let carla: string;
  let dani: string;
  let eva: string;
  let vendedorOtra: string;
  let idOtra: string;
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
    lineas?: {
      cantidad: number;
      promo?: number;
      borrada?: boolean;
      media?: boolean;
    }[];
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
          presentacion_id: l.media ? presentacionMediaId : presentacionId,
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
    saldo?: string;
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
        saldo_pendiente: a.saldo ?? '0.00',
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
    presentacionMediaId = (
      await db
        .insertInto('presentacion')
        .values({ producto_id: productoId, volumen: '500 ml' })
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
    eva = await sembrarVendedor('Eva');
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

    // Eva, 05-14 (detalle): contado a c1 con 2 lineas y una promocion, un venta
    // eliminada, cobro de 130 a c4 (100 a la nota de Carla, que queda en 50, y 30 a
    // favor), cobro de oficina de 40, gasto con comentario, visita sin venta y jornada.
    const ventaEva = await sembrarVenta({
      clienteId: c1,
      fecha: '2018-05-14',
      vendedor: eva,
      monto: '130.00',
      lineas: [{ cantidad: 12 }, { cantidad: 8, media: true }],
    });
    await sembrarAbono({
      ventaId: ventaEva,
      vendedor: eva,
      fecha: '2018-05-14',
      monto: '130.00',
      origen: 'venta_contado',
    });
    await db
      .insertInto('venta_nota_promocion')
      .values({
        venta_nota_id: ventaEva,
        presentacion_id: presentacionId,
        cantidad: 2,
        promocion_texto: 'Lleva 10 y regalo 2',
      })
      .execute();
    const ventaEvaBorrada = await sembrarVenta({
      clienteId: c1,
      fecha: '2018-05-14',
      vendedor: eva,
      monto: '66.00',
      borrada: true,
      lineas: [{ cantidad: 9 }],
    });
    await sembrarAbono({
      ventaId: ventaEvaBorrada,
      vendedor: eva,
      fecha: '2018-05-14',
      monto: '66.00',
      origen: 'venta_contado',
    });
    const cobroEva = await sembrarCobro(db, {
      clienteId: c4,
      vendedorId: eva,
      monto: '130.00',
      fecha: '2018-05-14',
    });
    await sembrarAbono({
      ventaId: notaCarla,
      vendedor: eva,
      fecha: '2018-05-14',
      monto: '100.00',
      origen: 'cobro',
      cobroId: cobroEva,
      saldo: '50.00',
    });
    const cobroOficinaEva = await sembrarCobro(db, {
      clienteId: c4,
      vendedorId: null,
      monto: '40.00',
      fecha: '2018-05-14',
    });
    await sembrarAbono({
      ventaId: notaCarla,
      vendedor: null,
      fecha: '2018-05-14',
      monto: '40.00',
      origen: 'cobro',
      cobroId: cobroOficinaEva,
      saldo: '10.00',
    });
    await db
      .insertInto('gasto')
      .values({
        id: randomUUID(),
        sucursal_id: idFd,
        vendedor_id: eva,
        campo_egreso_id: campoId,
        campo_nombre: `fd ${SUFIJO} Hielo`,
        comentario: 'Bolsas grandes',
        tipo: 'operacion',
        fecha: '2018-05-14',
        registrado_en: '2018-05-14T18:00:00.000Z',
        monto: '45.00',
        metodo: 'efectivo_cobranza_dia',
        origen: 'app',
      })
      .execute();
    await db
      .insertInto('visita')
      .values({
        id: randomUUID(),
        vendedor_id: eva,
        sucursal_id: idFd,
        cliente_id: c2,
        motivo_visita_id: motivoId,
        fecha: '2018-05-14',
        visitada_en: '2018-05-14T16:15:00.000Z',
        atendio: 'La encargada',
        observaciones: 'Volver el jueves',
        direccion_texto: 'sembrada',
      })
      .execute();
    await db
      .insertInto('jornada')
      .values({
        vendedor_id: eva,
        vehiculo_id: vehiculoId,
        sucursal_id: idFd,
        fecha: '2018-05-14',
        km_inicial: 10,
        km_final: 20,
        abierta_en: '2018-05-14T15:00:00Z',
        cerrada_en: '2018-05-14T22:00:00Z',
      })
      .execute();

    // Vendedor de otra sucursal.
    idOtra = (
      await db
        .insertInto('sucursal')
        .values({ codigo: CODIGO_OTRA, nombre: 'Prueba Flujo Diario Otra' })
        .onConflict((oc) =>
          oc.column('codigo').doUpdateSet({ deleted_at: null }),
        )
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    vendedorOtra = (
      await db
        .insertInto('vendedor')
        .values({
          login: `e2e-fd-otra-${SUFIJO}`,
          nombre: `Otra ${SUFIJO}`,
          password_hash: 'x',
          sucursal_id: idOtra,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    vendedorIds.push(vendedorOtra);
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
        .deleteFrom('venta_nota_promocion')
        .where('venta_nota_id', 'in', notas)
        .execute();
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
    await db.deleteFrom('sucursal').where('codigo', '=', CODIGO_OTRA).execute();
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

    it('atado a ZR: "todas" o nada le da ZR; pedir otra sucursal es 403', async () => {
      for (const q of [{}, { sucursal: 'todas' }] as Record<string, string>[]) {
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
        '2018-05-14',
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

  describe('detalle', () => {
    const detalleVendedor = (cookie: string, q: Record<string, string>) =>
      request(app.getHttpServer())
        .get(
          `/reportes/flujo-diario/vendedor?${new URLSearchParams(q).toString()}`,
        )
        .set('Cookie', cookie);
    const detalleDia = (cookie: string, q: Record<string, string>) =>
      request(app.getHttpServer())
        .get(`/reportes/flujo-diario/dia?${new URLSearchParams(q).toString()}`)
        .set('Cookie', cookie);

    it('vendedor-dia: ventas con lineas, pagos, a favor, gasto con comentario, visitas, promociones y corte', async () => {
      const d = (
        await detalleVendedor(cookieGeneral, {
          fecha: '2018-05-14',
          vendedor: eva,
        }).expect(200)
      ).body as DetalleVendedorDia;
      expect(d.vendedorId).toBe(eva);
      expect(d.notas).toHaveLength(1);
      expect(d.notas[0]).toMatchObject({
        contadoCredito: 'contado',
        piezas: 20,
        totalCentavos: 13000,
        pendienteCentavos: 0,
      });
      expect(d.notas[0].lineas).toEqual([
        {
          producto: `Horchata fd ${SUFIJO} 1 L`,
          cantidad: 12,
          precioCentavos: 650,
        },
        {
          producto: `Horchata fd ${SUFIJO} 500 ml`,
          cantidad: 8,
          precioCentavos: 650,
        },
      ]);
      expect(d.porProducto).toEqual([
        {
          presentacion: '500 ml',
          producto: `Horchata fd ${SUFIJO} 500 ml`,
          piezas: 8,
        },
        {
          presentacion: '1 L',
          producto: `Horchata fd ${SUFIJO} 1 L`,
          piezas: 12,
        },
      ]);
      expect(d.cobranza.contado).toHaveLength(1);
      expect(d.cobranza.contado[0]).toMatchObject({
        montoCentavos: 13000,
        metodo: 'efectivo',
        liquidada: true,
      });
      expect(d.cobranza.anteriores).toHaveLength(1);
      expect(d.cobranza.anteriores[0]).toMatchObject({
        montoCentavos: 10000,
        saldoPendienteCentavos: 5000,
        liquidada: false,
      });
      expect(d.cobranza.aFavor).toEqual([
        { cliente: `Cliente 4 ${SUFIJO}`, montoCentavos: 3000 },
      ]);
      expect(d.gastos).toEqual([
        {
          descripcion: `fd ${SUFIJO} Hielo · Bolsas grandes`,
          montoCentavos: 4500,
        },
      ]);
      expect(d.notasCredito).toEqual([]);
      expect(d.promociones).toEqual([
        {
          cliente: `Cliente 1 ${SUFIJO}`,
          producto: `Horchata fd ${SUFIJO} 1 L`,
          cantidad: 2,
        },
      ]);
      // La visita sin venta (9:15 de Tijuana = 16:15Z) sale antes que la venta.
      expect(d.visitas[0]).toEqual({
        cliente: `Cliente 2 ${SUFIJO}`,
        vendio: false,
        hora: '2018-05-14T16:15:00.000Z',
        motivo: `fd ${SUFIJO} Cerrado`,
        atendio: 'La encargada',
        comentario: 'Volver el jueves',
      });
      expect(d.visitas.some((v) => v.vendio)).toBe(true);
      expect(d.visitas).toHaveLength(2);
      expect(d.corte).toEqual({
        contadoCentavos: 13000,
        anterioresCentavos: 10000,
        aFavorCentavos: 3000,
        gastoCentavos: 4500,
        tesoreriaCentavos: 21500,
      });
    });

    it('el corte y las listas suman lo mismo que el renglon del reporte', async () => {
      const d = (
        await detalleVendedor(cookieGeneral, {
          fecha: '2018-05-14',
          vendedor: eva,
        }).expect(200)
      ).body as DetalleVendedorDia;
      const r = renglon(await deFd(), eva, '2018-05-14');
      const suma = (xs: { montoCentavos: number }[]) =>
        xs.reduce((s, x) => s + x.montoCentavos, 0);
      expect(suma(d.cobranza.contado)).toBe(r?.contadoCentavos);
      expect(suma(d.cobranza.anteriores)).toBe(r?.anterioresCentavos);
      expect(suma(d.cobranza.aFavor)).toBe(r?.aFavorCentavos);
      expect(suma(d.gastos)).toBe(r?.gastoCentavos);
      expect(d.corte?.tesoreriaCentavos).toBe(r?.tesoreriaCentavos);
      expect(d.porProducto.reduce((s, p) => s + p.piezas, 0)).toBe(r?.piezas);
      // Lo mismo para Carla (sin jornada: corte null, listas igual).
      const c = (
        await detalleVendedor(cookieGeneral, {
          fecha: '2018-05-08',
          vendedor: carla,
        }).expect(200)
      ).body as DetalleVendedorDia;
      const rc = renglon(await deFd(), carla, '2018-05-08');
      expect(c.corte).toBeNull();
      expect(suma(c.cobranza.anteriores)).toBe(rc?.anterioresCentavos);
      expect(suma(c.cobranza.aFavor)).toBe(rc?.aFavorCentavos);
      expect(suma(c.cobranza.contado)).toBe(rc?.contadoCentavos);
    });

    it('venta a credito aparece en notasCredito con su pendiente; la venta eliminada en ninguna lista', async () => {
      const c = (
        await detalleVendedor(cookieGeneral, {
          fecha: '2018-05-01',
          vendedor: carla,
        }).expect(200)
      ).body as DetalleVendedorDia;
      expect(c.notasCredito).toHaveLength(1);
      expect(c.notasCredito[0]).toMatchObject({ totalCentavos: 15000 });
      const e = (
        await detalleVendedor(cookieGeneral, {
          fecha: '2018-05-08',
          vendedor: carla,
        }).expect(200)
      ).body as DetalleVendedorDia;
      expect(e.notas).toEqual([]);
      expect(e.cobranza.contado).toEqual([]);
      expect(e.porProducto).toEqual([]);
      const eva14 = (
        await detalleVendedor(cookieGeneral, {
          fecha: '2018-05-14',
          vendedor: eva,
        }).expect(200)
      ).body as DetalleVendedorDia;
      expect(eva14.notas.map((n) => n.totalCentavos)).toEqual([13000]);
      expect(eva14.notas).toHaveLength(1);
    });

    it('vendedor de otra sucursal, inexistente o fuera del alcance es 404; uuid malo 400', async () => {
      const q = { fecha: '2018-05-14', vendedor: vendedorOtra };
      const r = await detalleVendedor(cookieFd, q).expect(404);
      expect(JSON.stringify(r.body)).toContain('No encontramos ese vendedor.');
      await detalleVendedor(cookieFd, {
        fecha: '2018-05-14',
        vendedor: randomUUID(),
      }).expect(404);
      await detalleVendedor(cookieGeneral, {
        fecha: '2018-05-14',
        vendedor: eva,
        sucursal: CODIGO_OTRA,
      }).expect(404);
      await detalleVendedor(cookieFd, {
        fecha: '2018-05-14',
        vendedor: eva,
        sucursal: CODIGO_OTRA,
      }).expect(403);
      await detalleVendedor(cookieGeneral, q).expect(200);
      await detalleVendedor(cookieGeneral, {
        fecha: '2018-05-14',
        vendedor: 'eva',
      }).expect(400);
      await detalleVendedor(cookieSinPermiso, {
        fecha: '2018-05-14',
        vendedor: eva,
      }).expect(403);
    });

    it('dia de sucursal: por presentacion, cobranza con oficina (cobrador null), a favor, gastos, visitas', async () => {
      const d = (
        await detalleDia(cookieGeneral, {
          fecha: '2018-05-14',
          sucursal: CODIGO,
        }).expect(200)
      ).body as DetalleDia;
      expect(d.sucursalCodigo).toBe(CODIGO);
      expect(d.porPresentacion).toEqual([
        { presentacion: '500 ml', piezas: 8 },
        { presentacion: '1 L', piezas: 12 },
      ]);
      expect(d.porVendedor).toEqual([
        { vendedor: `Eva ${SUFIJO}`, presentacion: '500 ml', piezas: 8 },
        { vendedor: `Eva ${SUFIJO}`, presentacion: '1 L', piezas: 12 },
      ]);
      expect(d.porCliente).toEqual([
        { cliente: `Cliente 1 ${SUFIJO}`, presentacion: '500 ml', piezas: 8 },
        { cliente: `Cliente 1 ${SUFIJO}`, presentacion: '1 L', piezas: 12 },
      ]);
      const oficina = d.cobranza.filter((p) => p.cobrador === null);
      expect(oficina).toHaveLength(1);
      expect(oficina[0]).toMatchObject({
        montoCentavos: 4000,
        saldoPendienteCentavos: 1000,
      });
      expect(d.cobranza.map((p) => p.cobrador)).toEqual([
        `Eva ${SUFIJO}`,
        `Eva ${SUFIJO}`,
        null,
      ]);
      expect(d.aFavor).toEqual([
        {
          cobrador: `Eva ${SUFIJO}`,
          cliente: `Cliente 4 ${SUFIJO}`,
          montoCentavos: 3000,
        },
      ]);
      expect(d.gastos).toEqual([
        {
          vendedor: `Eva ${SUFIJO}`,
          descripcion: `fd ${SUFIJO} Hielo · Bolsas grandes`,
          montoCentavos: 4500,
        },
      ]);
      expect(d.visitas).toHaveLength(2);
      expect(d.promociones).toEqual([
        { producto: `Horchata fd ${SUFIJO} 1 L`, cantidad: 2 },
      ]);
      // Cuadra con el renglon "Por dia" (cobranza = vendedores + oficina).
      const dia = (await deFd()).porDia.find((x) => x.fecha === '2018-05-14');
      const total =
        d.cobranza.reduce((s, p) => s + p.montoCentavos, 0) +
        d.aFavor.reduce((s, p) => s + p.montoCentavos, 0);
      // Ventas de contado de Eva (13000) + anteriores 10000 + a favor 3000 + oficina 4000.
      expect(total).toBe(dia?.totales.cobranzaCentavos);
    });

    it('dia con vendedor: solo lo suyo, sin la oficina; cuadra con su renglon "Por dia"', async () => {
      const d = (
        await detalleDia(cookieGeneral, {
          fecha: '2018-05-08',
          sucursal: CODIGO,
          vendedor: carla,
        }).expect(200)
      ).body as DetalleDia;
      expect(d.cobranza.every((p) => p.cobrador === `Carla ${SUFIJO}`)).toBe(
        true,
      );
      expect(d.aFavor.every((p) => p.cobrador === `Carla ${SUFIJO}`)).toBe(
        true,
      );
      const dia = (await deFd({ vendedor: carla })).porDia.find(
        (x) => x.fecha === '2018-05-08',
      );
      const total =
        d.cobranza.reduce((s, p) => s + p.montoCentavos, 0) +
        d.aFavor.reduce((s, p) => s + p.montoCentavos, 0);
      expect(total).toBe(dia?.totales.cobranzaCentavos);
      expect(total).toBe(20000);

      // Eva el 14: sin el cobro de la oficina (40), con sus gastos y visitas.
      const e = (
        await detalleDia(cookieGeneral, {
          fecha: '2018-05-14',
          sucursal: CODIGO,
          vendedor: eva,
        }).expect(200)
      ).body as DetalleDia;
      expect(e.cobranza.map((p) => p.cobrador)).toEqual([
        `Eva ${SUFIJO}`,
        `Eva ${SUFIJO}`,
      ]);
      expect(e.gastos).toHaveLength(1);
      expect(e.visitas).toHaveLength(2);
      expect(e.promociones).toHaveLength(1);
    });

    it('dia con vendedor: uuid malo 400; de otra sucursal o inexistente 404', async () => {
      await detalleDia(cookieGeneral, {
        fecha: '2018-05-14',
        sucursal: CODIGO,
        vendedor: 'eva',
      }).expect(400);
      const r = await detalleDia(cookieGeneral, {
        fecha: '2018-05-14',
        sucursal: CODIGO,
        vendedor: vendedorOtra,
      }).expect(404);
      expect(JSON.stringify(r.body)).toContain('No encontramos ese vendedor.');
      await detalleDia(cookieFd, {
        fecha: '2018-05-14',
        sucursal: CODIGO,
        vendedor: randomUUID(),
      }).expect(404);
    });

    it('un vendedor dado de baja con historia se puede abrir', async () => {
      await db
        .updateTable('vendedor')
        .set({ deleted_at: new Date() })
        .where('id', '=', dani)
        .execute();
      try {
        const d = (
          await detalleVendedor(cookieGeneral, {
            fecha: '2018-05-09',
            vendedor: dani,
          }).expect(200)
        ).body as DetalleVendedorDia;
        expect(d.gastos).toHaveLength(1);
      } finally {
        await db
          .updateTable('vendedor')
          .set({ deleted_at: null })
          .where('id', '=', dani)
          .execute();
      }
    });

    it('dia: sucursal fuera del alcance 403, "todas" 400, codigo desconocido 404, atado a ZR con su sucursal 200', async () => {
      await detalleDia(cookieFd, {
        fecha: '2018-05-14',
        sucursal: CODIGO_OTRA,
      }).expect(403);
      await detalleDia(cookieGeneral, {
        fecha: '2018-05-14',
        sucursal: 'todas',
      }).expect(400);
      await detalleDia(cookieGeneral, {
        fecha: '2018-05-14',
        sucursal: 'QQ',
      }).expect(404);
      await detalleDia(cookieGeneral, { fecha: '2018-05-14' }).expect(400);
      await detalleDia(cookieGeneral, { sucursal: CODIGO }).expect(400);
      await detalleDia(cookieFd, {
        fecha: '2018-05-14',
        sucursal: CODIGO,
      }).expect(200);
    });
  });
});

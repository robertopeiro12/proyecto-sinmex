import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
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
  type RespuestaPush,
} from './../src/modules/sincronizacion/contrato';
import { formarFolio } from './../src/modules/sincronizacion/folio';
import { asignarSegmento } from './../src/modules/sincronizacion/segmento-vendedor';
import { MOTIVO_CON_COBROS } from './../src/modules/ventas-cobranza/acciones-venta';
import type {
  ResultadoBusquedaVentas,
  VentaDetalle,
} from './../src/modules/ventas-cobranza/ventas-consulta.service';

/**
 * Buscar, editar y eliminar ventas desde el portal (T-17, parte 2): §7 del
 * spec, de punta a punta.
 *
 * Fechas de MARZO DE 2024 exclusivas de este archivo: Jest corre las suites en
 * paralelo y el contador del folio OF es por sucursal y dia. Las ventas del
 * portal de estas fechas (y su contador) se limpian antes (restos de una
 * corrida que trono) y despues.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-ved-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-ved-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-ved-sin-${SUFIJO}`;
const LOGIN_APP = `e2e-ved-app-${SUFIJO}`;

const FECHA_A = '2024-03-04';
const FECHA_B = '2024-03-05';
const FECHA_EDICION = '2024-03-06';
const FECHA_TOPE = '2024-03-07';
const FECHA_TABLET = '2024-03-08';
const FECHA_BORRADO = '2024-03-11';
const FECHA_PERDIDA = '2024-03-12';
const FECHA_CAMBIO_LISTA = '2024-03-13';
const FECHAS = [
  FECHA_A,
  FECHA_B,
  FECHA_EDICION,
  FECHA_TOPE,
  FECHA_TABLET,
  FECHA_BORRADO,
  FECHA_PERDIDA,
  FECHA_CAMBIO_LISTA,
];
/** Desde aqui tiene precio el 2 L: una venta anterior no puede agregarlo. */
const PRE3_CON_PRECIO_DESDE = FECHA_TOPE;

interface VentaCreada {
  id: string;
  folio: string;
  numNota: string;
  montoCentavos: number;
  status: string;
}

const fechaComoTexto = sql<string>`to_char(fecha, 'YYYY-MM-DD')`;

describe('Buscar, editar y eliminar ventas desde el portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;

  let tjId: string;
  let mxId: string;
  const usuarioIds: string[] = [];
  let usuarioGeneralId: string;
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;

  let productoId: string;
  let pre1: string; // 1 L: 10.00 (TJ) desde 2024-01-01; 20.00 (MX)
  let pre2: string; // 500 ml: 7.25 en la lista; 6.00 precio especial de clienteTj
  let pre3: string; // 2 L: 15.00 (TJ) solo desde PRE3_CON_PRECIO_DESDE
  let preSinPrecio: string; // 3 L: sin precio
  const precioIds: string[] = [];
  let clientePrecioId: string;
  let clienteTj: string;
  let clienteTj2: string;
  let clienteMx: string;
  let vendedorTj: string;
  let vendedorTj2: string;
  let vendedorTjInactivo: string;
  let vendedorMx: string;
  let vendedorApp: string;
  let segmentoApp: string;
  let bearerApp: string;

  let notas = 0;
  /** Un # de nota unico por llamada (≤ 30): el indice de #95 no deja repetirlo. */
  const nota = () => `ved${SUFIJO}-${++notas}`;

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

  /** `Administrador General` trae todos los permisos; `Auxiliar Administrativo` esta vacio (T-08b). */
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

  const sembrarVendedor = async (
    nombre: string,
    sucursalId: string,
    activo = true,
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-ved-${nombre.toLowerCase().replace(/\s+/g, '-')}-${SUFIJO}`,
        nombre: `${nombre} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
        activo,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  /** Precio de "Lista 1". Se borra en `afterAll`: `30_precios_test.sql` cuenta los que quedan. */
  const sembrarPrecio = async (
    presentacionId: string,
    sucursalId: string,
    precio: string,
    vigenteDesde: string,
  ): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('precio')
      .values({
        presentacion_id: presentacionId,
        lista_precio_id: lista.id,
        sucursal_id: sucursalId,
        precio,
        vigente_desde: vigenteDesde,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    precioIds.push(id);
    return id;
  };

  const sembrarCliente = async (
    nombre: string,
    sucursalId: string,
  ): Promise<string> => {
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
        pct_comision: '3.50',
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  /** Ventas del PORTAL de las fechas de este archivo (de cualquier cliente), sus cobros, lineas y contador OF. */
  const limpiarVentas = async () => {
    const ventas = db
      .selectFrom('venta_nota')
      .select('id')
      .where('origen', '=', 'portal')
      .where(fechaComoTexto, 'in', FECHAS);
    await db
      .deleteFrom('cobranza_abono')
      .where('venta_nota_id', 'in', ventas)
      .execute();
    await db
      .deleteFrom('venta_nota_detalle')
      .where('venta_nota_id', 'in', ventas)
      .execute();
    await db
      .deleteFrom('venta_nota')
      .where('origen', '=', 'portal')
      .where(fechaComoTexto, 'in', FECHAS)
      .execute();
    await db
      .deleteFrom('folio_oficina_contador')
      .where('sucursal_id', 'in', [tjId, mxId])
      .where(fechaComoTexto, 'in', FECHAS)
      .execute();
  };

  /**
   * Registra por el endpoint de la parte 1. Por default: FECHA_A, clienteTj,
   * vendedorTj, credito, 24+2 de 1 L (10.00) y 5 de 500 ml (6.00) = 270.00.
   */
  const registrar = async (
    extra: Record<string, unknown> = {},
  ): Promise<VentaCreada> => {
    const cuerpo = {
      fecha: FECHA_A,
      clienteId: clienteTj,
      vendedorId: vendedorTj,
      numNota: nota(),
      contadoCredito: 'credito',
      factura: 'N/A',
      lineas: [
        { presentacionId: pre1, cantidad: 24, cantidadPromocion: 2 },
        { presentacionId: pre2, cantidad: 5, cantidadPromocion: 0 },
      ],
      ...extra,
    };
    const res = await request(app.getHttpServer())
      .post('/ventas')
      .set('Cookie', cookieGeneral)
      .send(cuerpo)
      .expect(201);
    return {
      ...(res.body as Omit<VentaCreada, 'numNota'>),
      numNota: cuerpo.numNota,
    };
  };

  const buscar = (cookie: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/ventas?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const detalle = (cookie: string, id: string) =>
    request(app.getHttpServer()).get(`/ventas/${id}`).set('Cookie', cookie);

  const ventaPorId = (id: string) =>
    db
      .selectFrom('venta_nota')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  /** Un abono de COBRANZA (como el que deja un cobro de la tablet, T-20) y el status que le toca. */
  const abonar = async (ventaId: string, monto: string) => {
    await db
      .insertInto('cobranza_abono')
      .values({
        venta_nota_id: ventaId,
        vendedor_id: vendedorTj,
        fecha_pago: FECHA_A,
        fecha_operacion: FECHA_A,
        monto,
        tipo: 'abono',
        saldo_pendiente: '0.00',
        metodo_pago: 'efectivo',
        folio: null,
        origen: 'cobro',
      })
      .execute();
    await db
      .updateTable('venta_nota')
      .set({ status: 'abonado' })
      .where('id', '=', ventaId)
      .execute();
  };

  /** Todas las lineas de la venta, vivas y borradas, en orden de alta. */
  const lineasDe = (id: string) =>
    db
      .selectFrom('venta_nota_detalle')
      .select([
        'presentacion_id',
        'cantidad',
        'cantidad_promocion',
        'precio',
        'deleted_at',
      ])
      .where('venta_nota_id', '=', id)
      .orderBy('created_at')
      .execute();

  /** Todos los abonos de la venta, vivos y borrados, en orden de alta. */
  const cobrosDe = (id: string) =>
    db
      .selectFrom('cobranza_abono')
      .select([
        'monto',
        'metodo_pago',
        'vendedor_id',
        'origen',
        'folio',
        'deleted_at',
        sql<string>`to_char(fecha_pago, 'YYYY-MM-DD')`.as('fecha_pago'),
      ])
      .where('venta_nota_id', '=', id)
      .orderBy('created_at')
      .execute();

  const vivas = <T extends { deleted_at: Date | null }>(filas: T[]) =>
    filas.filter((f) => f.deleted_at === null);

  let consecutivoTablet = 0;
  /**
   * Una venta capturada en la TABLET y subida por el push (T-16): 10 de 1 L a
   * 9.00, el precio de la nota firmada, distinto del 10.00 de la lista.
   */
  const ventaDeTablet = async (
    contadoCredito: 'contado' | 'credito' = 'credito',
  ): Promise<{ id: string; folio: string; numNota: string }> => {
    consecutivoTablet += 1;
    const folio = formarFolio(
      'TJ',
      FECHA_TABLET,
      segmentoApp,
      consecutivoTablet,
    );
    const numNota = nota();
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${bearerApp}`)
      .send({
        contrato: CONTRATO_ACTUAL,
        operaciones: [
          {
            clave: `ved-${SUFIJO}-${consecutivoTablet}`,
            tipo: 'venta',
            cliente_id: clienteTj,
            fecha_operacion: FECHA_TABLET,
            ocurrido_en: `${FECHA_TABLET}T14:03:22.000-07:00`,
            folio,
            datos: {
              num_nota: numNota,
              contado_credito: contadoCredito,
              factura: 'N/A',
              comentarios: null,
              lineas: [
                {
                  presentacion_id: pre1,
                  cantidad: 10,
                  cantidad_promocion: 0,
                  precio_centavos: 900,
                },
              ],
            },
          },
        ],
      })
      .expect(200);
    expect((res.body as RespuestaPush).resultados[0].estado).toBe('aplicada');
    const { id } = await db
      .selectFrom('venta_nota')
      .select('id')
      .where('folio', '=', folio)
      .executeTakeFirstOrThrow();
    return { id, folio, numNota };
  };

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
    await limpiarVentas();

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

    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: `Horchata e2e ${SUFIJO}` })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const presentacion = async (volumen: string) =>
      (
        await db
          .insertInto('presentacion')
          .values({ producto_id: productoId, volumen })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    pre1 = await presentacion('1 L');
    pre2 = await presentacion('500 ml');
    pre3 = await presentacion('2 L');
    preSinPrecio = await presentacion('3 L');

    await sembrarPrecio(pre1, tjId, '10.00', '2024-01-01');
    await sembrarPrecio(pre2, tjId, '7.25', '2024-01-01');
    await sembrarPrecio(pre3, tjId, '15.00', PRE3_CON_PRECIO_DESDE);
    await sembrarPrecio(pre1, mxId, '20.00', '2024-01-01');

    clienteTj = await sembrarCliente('Abarrotes TJ', tjId);
    clienteTj2 = await sembrarCliente('Tienda Dos TJ', tjId);
    clienteMx = await sembrarCliente('Abarrotes MX', mxId);
    clientePrecioId = (
      await db
        .insertInto('cliente_precio')
        .values({
          cliente_id: clienteTj,
          presentacion_id: pre2,
          precio: '6.00',
          vigente_desde: '2024-01-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    vendedorTj = await sembrarVendedor('Ana Activa', tjId);
    vendedorTj2 = await sembrarVendedor('Dora Dos', tjId);
    vendedorTjInactivo = await sembrarVendedor('Beto Inactivo', tjId, false);
    vendedorMx = await sembrarVendedor('Carla Mexicali', mxId);

    // El vendedor de la tablet: con contrasena (entra por /auth/app/login) y
    // segmento de folio libre. Consulta GLOBAL de ocupados, como la e2e de
    // sincronizacion: mas estricta de lo necesario, pero segura.
    const ocupados = new Set(
      (
        await db
          .selectFrom('vendedor')
          .select('folio_segmento')
          .where('folio_segmento', 'is not', null)
          .where('deleted_at', 'is', null)
          .execute()
      ).map((f) => f.folio_segmento as string),
    );
    segmentoApp = asignarSegmento('Zacarias Quintero', ocupados) as string;
    vendedorApp = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN_APP,
          nombre: `Zacarias App ${SUFIJO}`,
          password_hash: await app.get(PasswordService).hashear(PASSWORD),
          sucursal_id: tjId,
          folio_segmento: segmentoApp,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
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
    const clientes = [clienteTj, clienteTj2, clienteMx];
    const ventas = db
      .selectFrom('venta_nota')
      .select('id')
      .where('cliente_id', 'in', clientes);
    await db
      .deleteFrom('cobranza_abono')
      .where('venta_nota_id', 'in', ventas)
      .execute();
    await db
      .deleteFrom('venta_nota_detalle')
      .where('venta_nota_id', 'in', ventas)
      .execute();
    await db
      .deleteFrom('venta_nota')
      .where('cliente_id', 'in', clientes)
      .execute();
    await limpiarVentas();
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', '=', vendedorApp)
      .execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', '=', vendedorApp)
      .execute();
    await db
      .deleteFrom('cliente_precio')
      .where('id', '=', clientePrecioId)
      .execute();
    await db.deleteFrom('precio').where('id', 'in', precioIds).execute();
    await db.deleteFrom('cliente').where('id', 'in', clientes).execute();
    await db
      .deleteFrom('presentacion')
      .where('id', 'in', [pre1, pre2, pre3, preSinPrecio])
      .execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
    await db
      .deleteFrom('vendedor')
      .where('id', 'in', [
        vendedorTj,
        vendedorTj2,
        vendedorTjInactivo,
        vendedorMx,
        vendedorApp,
      ])
      .execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  /* ================================================================ */

  describe('GET /ventas (búsqueda, §3.1)', () => {
    it('por rango de fechas: la fila trae lo que pinta la tabla, por fecha descendente', async () => {
      const a = await registrar();
      const b = await registrar({ fecha: FECHA_B });

      const soloA = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_A,
          clienteId: clienteTj,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(soloA.hayMas).toBe(false);
      const idsA = soloA.ventas.map((v) => v.id);
      expect(idsA).toContain(a.id);
      expect(idsA).not.toContain(b.id);
      expect(soloA.ventas.find((v) => v.id === a.id)).toEqual({
        id: a.id,
        folio: a.folio,
        fecha: FECHA_A,
        clienteId: clienteTj,
        cliente: `Abarrotes TJ ${SUFIJO}`,
        repartidor: `Ana Activa ${SUFIJO}`,
        numNota: a.numNota,
        montoCentavos: 27000,
        status: 'pendiente',
        origen: 'portal',
        saldoCentavos: 27000,
      });

      const ambas = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_B,
          clienteId: clienteTj,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      const ids = ambas.ventas.map((v) => v.id);
      expect(ids.indexOf(b.id)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    });

    it('una venta de Oficina de contado sale sin repartidor y con saldo 0', async () => {
      const v = await registrar({
        vendedorId: null,
        contadoCredito: 'contado',
      });
      const res = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_A,
          clienteId: clienteTj,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(res.ventas.find((f) => f.id === v.id)).toMatchObject({
        repartidor: null,
        status: 'pagada',
        montoCentavos: 27000,
        saldoCentavos: 0,
      });
    });

    it('por cliente', async () => {
      const otra = await registrar({ clienteId: clienteTj2 });
      const delPrimero = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_A,
          clienteId: clienteTj,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(delPrimero.ventas.map((v) => v.id)).not.toContain(otra.id);

      const delSegundo = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_A,
          clienteId: clienteTj2,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(delSegundo.ventas.map((v) => v.id)).toContain(otra.id);
    });

    it('por # de nota: sin distinguir mayúsculas ni espacios, y coincidencia exacta', async () => {
      const numNota = `NX${SUFIJO}`;
      const v = await registrar({ numNota });

      const exacta = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_A,
          numNota: `  ${numNota.toLowerCase()}  `,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(exacta.ventas.map((f) => f.id)).toEqual([v.id]);

      const parcial = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_A,
          numNota: numNota.slice(0, -1),
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(parcial.ventas).toEqual([]);
    });

    it('respeta el alcance: Tijuana no ve Mexicali, y pedir MX es 403', async () => {
      const mx = await registrar({
        clienteId: clienteMx,
        vendedorId: vendedorMx,
        lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
      });
      const tj = await registrar();

      const deTijuana = (
        await buscar(cookieTijuana, {
          desde: FECHA_A,
          hasta: FECHA_A,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      const idsTj = deTijuana.ventas.map((v) => v.id);
      expect(idsTj).toContain(tj.id);
      expect(idsTj).not.toContain(mx.id);

      await buscar(cookieTijuana, {
        desde: FECHA_A,
        hasta: FECHA_A,
        sucursal: 'MX',
      }).expect(403);

      const generalEnMx = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_A,
          sucursal: 'MX',
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      const idsMx = generalEnMx.ventas.map((v) => v.id);
      expect(idsMx).toContain(mx.id);
      expect(idsMx).not.toContain(tj.id);
    });

    it('no incluye ventas eliminadas', async () => {
      const v = await registrar();
      await db
        .updateTable('venta_nota')
        .set({ deleted_at: sql`now()` })
        .where('id', '=', v.id)
        .execute();
      expect((await ventaPorId(v.id)).deleted_at).not.toBeNull();

      const res = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_A,
          clienteId: clienteTj,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(res.ventas.map((f) => f.id)).not.toContain(v.id);
    });

    it('tope de 200 filas, y avisa que hay más', async () => {
      // 201 ventas sembradas directo en la base: por el endpoint tardaria demasiado.
      const ids = (
        await db
          .insertInto('venta_nota')
          .values(
            Array.from({ length: 201 }, (_, i) => ({
              folio: `ZZ${SUFIJO}-${i}`,
              fecha: FECHA_TOPE,
              cliente_id: clienteTj2,
              vendedor_id: null,
              monto_total: '1.00',
              num_nota: `t${SUFIJO}-${i}`,
              contado_credito: 'credito',
              semana: 10,
              mes: 3,
              status: 'pendiente',
              sucursal_id: tjId,
              origen: 'portal',
              capturo_usuario_id: usuarioGeneralId,
            })),
          )
          .returning('id')
          .execute()
      ).map((f) => f.id);
      try {
        const res = (
          await buscar(cookieGeneral, {
            desde: FECHA_TOPE,
            hasta: FECHA_TOPE,
            clienteId: clienteTj2,
          }).expect(200)
        ).body as ResultadoBusquedaVentas;
        expect(res.ventas).toHaveLength(200);
        expect(res.hayMas).toBe(true);
      } finally {
        await db.deleteFrom('venta_nota').where('id', 'in', ids).execute();
      }
    });

    it('fechas inválidas son 400, no 500', async () => {
      await buscar(cookieGeneral, { desde: FECHA_B, hasta: FECHA_A }).expect(
        400,
      );
      await buscar(cookieGeneral, {
        desde: '2024-02-30',
        hasta: FECHA_A,
      }).expect(400);
      await buscar(cookieGeneral, { desde: '04/03/2024' }).expect(400);
    });

    it('basta la sesión: no exige venta.editar_eliminar', async () => {
      await buscar(cookieSinPermiso, { desde: FECHA_A, hasta: FECHA_A }).expect(
        200,
      );
    });

    it('una venta de la tablet sale con origen app y su vendedor', async () => {
      const t = await ventaDeTablet();
      const res = (
        await buscar(cookieGeneral, {
          desde: FECHA_TABLET,
          hasta: FECHA_TABLET,
          clienteId: clienteTj,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(res.ventas.find((v) => v.id === t.id)).toMatchObject({
        folio: t.folio,
        origen: 'app',
        repartidor: `Zacarias App ${SUFIJO}`,
        montoCentavos: 9000,
      });
    });
  });

  describe('GET /ventas/:id (detalle, §3.2)', () => {
    it('cabecera, líneas con su precio, cobros y banderas', async () => {
      const v = await registrar({
        contadoCredito: 'contado',
        metodoPago: 'efectivo',
        comentarios: 'Entregar temprano',
      });
      const venta = (await detalle(cookieGeneral, v.id).expect(200))
        .body as VentaDetalle;
      expect(venta).toEqual({
        id: v.id,
        folio: v.folio,
        fecha: FECHA_A,
        clienteId: clienteTj,
        cliente: `Abarrotes TJ ${SUFIJO}`,
        sucursalId: tjId,
        sucursalCodigo: 'TJ',
        vendedorId: vendedorTj,
        repartidor: `Ana Activa ${SUFIJO}`,
        numNota: v.numNota,
        contadoCredito: 'contado',
        factura: 'N/A',
        comentarios: 'Entregar temprano',
        montoCentavos: 27000,
        status: 'pagada',
        origen: 'portal',
        saldoCentavos: 0,
        lineas: [
          {
            presentacionId: pre1,
            producto: `Horchata e2e ${SUFIJO}`,
            volumen: '1 L',
            cantidad: 24,
            cantidadPromocion: 2,
            precioCentavos: 1000,
            subtotalCentavos: 24000,
          },
          {
            presentacionId: pre2,
            producto: `Horchata e2e ${SUFIJO}`,
            volumen: '500 ml',
            cantidad: 5,
            cantidadPromocion: 0,
            precioCentavos: 600,
            subtotalCentavos: 3000,
          },
        ],
        cobros: [
          {
            id: expect.any(String) as string,
            fechaPago: FECHA_A,
            metodoPago: 'efectivo',
            montoCentavos: 27000,
            origen: 'venta_contado',
          },
        ],
        editable: true,
        motivoNoEditable: null,
        puedeMarcarPerdida: false,
      });
    });

    it('a crédito y sin cobros: editable y se puede marcar como cuenta perdida', async () => {
      const v = await registrar();
      const venta = (await detalle(cookieGeneral, v.id).expect(200))
        .body as VentaDetalle;
      expect(venta).toMatchObject({
        status: 'pendiente',
        saldoCentavos: 27000,
        cobros: [],
        editable: true,
        motivoNoEditable: null,
        puedeMarcarPerdida: true,
      });
    });

    it('con un abono de cobranza: no editable, con el motivo, y sí se puede marcar perdida', async () => {
      const v = await registrar();
      await abonar(v.id, '100.00');
      const venta = (await detalle(cookieGeneral, v.id).expect(200))
        .body as VentaDetalle;
      expect(venta).toMatchObject({
        status: 'abonado',
        saldoCentavos: 17000,
        editable: false,
        motivoNoEditable: MOTIVO_CON_COBROS,
        puedeMarcarPerdida: true,
      });
      expect(venta.cobros).toEqual([
        expect.objectContaining({
          montoCentavos: 10000,
          origen: 'cobro',
          metodoPago: 'efectivo',
        }),
      ]);
    });

    it('eliminada o inexistente: 404', async () => {
      const v = await registrar();
      await db
        .updateTable('venta_nota')
        .set({ deleted_at: sql`now()` })
        .where('id', '=', v.id)
        .execute();
      await detalle(cookieGeneral, v.id).expect(404);
      await detalle(cookieGeneral, randomUUID()).expect(404);
    });

    it('de otra sucursal: 403', async () => {
      const mx = await registrar({
        clienteId: clienteMx,
        vendedorId: vendedorMx,
        lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
      });
      await detalle(cookieTijuana, mx.id).expect(403);
    });

    it('basta la sesión', async () => {
      const v = await registrar();
      await detalle(cookieSinPermiso, v.id).expect(200);
    });
  });

  describe('PATCH /ventas/:id (editar, §4.2)', () => {
    const editar = (
      id: string,
      cuerpo: Record<string, unknown>,
      cookie = cookieGeneral,
    ) =>
      request(app.getHttpServer())
        .patch(`/ventas/${id}`)
        .set('Cookie', cookie)
        .send(cuerpo);

    /** El estado completo de lo editable, como lo manda la pantalla. */
    const cambios = (numNota: string, extra: Record<string, unknown> = {}) => ({
      vendedorId: vendedorTj,
      numNota,
      contadoCredito: 'credito',
      factura: 'N/A',
      lineas: [
        { presentacionId: pre1, cantidad: 24, cantidadPromocion: 2 },
        { presentacionId: pre2, cantidad: 5, cantidadPromocion: 0 },
      ],
      ...extra,
    });

    const pctDelCliente = (pct: string) =>
      db
        .updateTable('cliente')
        .set({ pct_comision: pct })
        .where('id', '=', clienteTj)
        .execute();

    it('cambia cantidades: recalcula monto y status, conserva lo fijo y deja quién editó', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      const res = await editar(
        v.id,
        cambios(v.numNota, {
          lineas: [
            { presentacionId: pre1, cantidad: 10, cantidadPromocion: 0 },
          ],
        }),
      ).expect(200);
      const venta = res.body as VentaDetalle;
      expect(venta).toMatchObject({
        id: v.id,
        folio: v.folio,
        fecha: FECHA_EDICION,
        clienteId: clienteTj,
        montoCentavos: 10000,
        status: 'pendiente',
        editable: true,
      });
      expect(venta.lineas).toEqual([
        expect.objectContaining({
          presentacionId: pre1,
          cantidad: 10,
          cantidadPromocion: 0,
          precioCentavos: 1000,
        }),
      ]);

      const fila = await ventaPorId(v.id);
      expect(fila).toMatchObject({
        folio: v.folio,
        cliente_id: clienteTj,
        sucursal_id: tjId,
        origen: 'portal',
        capturo_usuario_id: usuarioGeneralId,
        actualizado_por_usuario_id: usuarioGeneralId,
        monto_total: '100.00',
        status: 'pendiente',
      });
      // La linea que ya no viene queda borrada, no desaparece.
      const lineas = await lineasDe(v.id);
      expect(lineas).toHaveLength(2);
      expect(vivas(lineas).map((l) => l.presentacion_id)).toEqual([pre1]);
    });

    it('solo piezas de promoción: monto 0 y status promoción', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      const venta = (
        await editar(
          v.id,
          cambios(v.numNota, {
            lineas: [
              { presentacionId: pre1, cantidad: 0, cantidadPromocion: 3 },
            ],
          }),
        ).expect(200)
      ).body as VentaDetalle;
      expect(venta).toMatchObject({ montoCentavos: 0, status: 'promocion' });
    });

    it('conserva el precio de una línea aunque la lista cambie; una nueva toma la lista a la fecha', async () => {
      const v = await registrar({
        fecha: FECHA_CAMBIO_LISTA,
        lineas: [{ presentacionId: pre1, cantidad: 2, cantidadPromocion: 0 }],
      });
      // La lista del 1 L sube ESE MISMO dia, despues de grabada la venta.
      const subida = await sembrarPrecio(
        pre1,
        tjId,
        '11.00',
        FECHA_CAMBIO_LISTA,
      );
      try {
        const venta = (
          await editar(
            v.id,
            cambios(v.numNota, {
              lineas: [
                { presentacionId: pre1, cantidad: 3, cantidadPromocion: 0 },
                { presentacionId: pre2, cantidad: 4, cantidadPromocion: 0 },
              ],
            }),
          ).expect(200)
        ).body as VentaDetalle;
        // 3 × 10.00 (guardado) + 4 × 6.00 (precio especial del cliente a la fecha).
        expect(venta.montoCentavos).toBe(5400);
        expect(
          venta.lineas.map((l) => [l.presentacionId, l.precioCentavos]),
        ).toEqual([
          [pre1, 1000],
          [pre2, 600],
        ]);
      } finally {
        await db.deleteFrom('precio').where('id', '=', subida).execute();
      }
    });

    it('una presentación nueva sin precio A LA FECHA de la venta es 409 aunque hoy sí tenga', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      const res = await editar(
        v.id,
        cambios(v.numNota, {
          lineas: [{ presentacionId: pre3, cantidad: 1, cantidadPromocion: 0 }],
        }),
      ).expect(409);
      expect((res.body as { message: string }).message).toContain(
        FECHA_EDICION,
      );
      expect((await ventaPorId(v.id)).monto_total).toBe('270.00');
    });

    it('una presentación nueva de pura promoción entra aunque no tenga precio', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      const venta = (
        await editar(
          v.id,
          cambios(v.numNota, {
            lineas: [
              { presentacionId: pre1, cantidad: 24, cantidadPromocion: 2 },
              {
                presentacionId: preSinPrecio,
                cantidad: 0,
                cantidadPromocion: 2,
              },
            ],
          }),
        ).expect(200)
      ).body as VentaDetalle;
      expect(
        venta.lineas.find((l) => l.presentacionId === preSinPrecio),
      ).toMatchObject({ precioCentavos: 0, cantidadPromocion: 2 });
    });

    it('quitar una presentación y volver a agregarla', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      await editar(
        v.id,
        cambios(v.numNota, {
          lineas: [
            { presentacionId: pre1, cantidad: 24, cantidadPromocion: 2 },
          ],
        }),
      ).expect(200);
      await editar(
        v.id,
        cambios(v.numNota, {
          lineas: [
            { presentacionId: pre1, cantidad: 24, cantidadPromocion: 2 },
            { presentacionId: pre2, cantidad: 7, cantidadPromocion: 0 },
          ],
        }),
      ).expect(200);

      const lineas = await lineasDe(v.id);
      expect(lineas.filter((l) => l.presentacion_id === pre2)).toHaveLength(2);
      expect(
        vivas(lineas).find((l) => l.presentacion_id === pre2),
      ).toMatchObject({
        cantidad: 7,
        precio: '6.00',
      });
    });

    it('un precio en el cuerpo se ignora: el servidor pone el suyo', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      const venta = (
        await editar(
          v.id,
          cambios(v.numNota, {
            lineas: [
              {
                presentacionId: pre1,
                cantidad: 1,
                cantidadPromocion: 0,
                precioCentavos: 1,
              },
            ],
          }),
        ).expect(200)
      ).body as VentaDetalle;
      expect(venta.lineas[0].precioCentavos).toBe(1000);
    });

    it('contado → crédito quita el cobro de contado', async () => {
      const v = await registrar({
        fecha: FECHA_EDICION,
        contadoCredito: 'contado',
        metodoPago: 'efectivo',
      });
      const venta = (await editar(v.id, cambios(v.numNota)).expect(200))
        .body as VentaDetalle;
      expect(venta).toMatchObject({
        status: 'pendiente',
        saldoCentavos: 27000,
        cobros: [],
      });
      const cobros = await cobrosDe(v.id);
      expect(cobros).toHaveLength(1);
      expect(vivas(cobros)).toEqual([]);
    });

    it('crédito → contado lo crea con el método elegido, la fecha de la venta y el repartidor', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      const venta = (
        await editar(
          v.id,
          cambios(v.numNota, {
            contadoCredito: 'contado',
            metodoPago: 'efectivo',
          }),
        ).expect(200)
      ).body as VentaDetalle;
      expect(venta).toMatchObject({ status: 'pagada', saldoCentavos: 0 });
      expect(vivas(await cobrosDe(v.id))).toEqual([
        {
          monto: '270.00',
          metodo_pago: 'efectivo',
          vendedor_id: vendedorTj,
          origen: 'venta_contado',
          folio: v.folio,
          deleted_at: null,
          fecha_pago: FECHA_EDICION,
        },
      ]);
    });

    it('contado → contado reescribe el cobro con el monto nuevo y, sin método, conserva el anterior', async () => {
      const v = await registrar({
        fecha: FECHA_EDICION,
        contadoCredito: 'contado',
        metodoPago: 'efectivo',
      });
      await editar(
        v.id,
        cambios(v.numNota, {
          contadoCredito: 'contado',
          lineas: [{ presentacionId: pre1, cantidad: 3, cantidadPromocion: 0 }],
        }),
      ).expect(200);
      const cobros = await cobrosDe(v.id);
      expect(cobros).toHaveLength(2);
      expect(vivas(cobros)).toEqual([
        expect.objectContaining({ monto: '30.00', metodo_pago: 'efectivo' }),
      ]);
    });

    it('una venta de contado que queda en $0 no deja cobro', async () => {
      const v = await registrar({
        fecha: FECHA_EDICION,
        contadoCredito: 'contado',
      });
      const venta = (
        await editar(
          v.id,
          cambios(v.numNota, {
            contadoCredito: 'contado',
            lineas: [
              { presentacionId: pre1, cantidad: 0, cantidadPromocion: 4 },
            ],
          }),
        ).expect(200)
      ).body as VentaDetalle;
      expect(venta.status).toBe('promocion');
      expect(vivas(await cobrosDe(v.id))).toEqual([]);
    });

    it('Oficina → vendedor congela el % ACTUAL del cliente', async () => {
      const v = await registrar({ fecha: FECHA_EDICION, vendedorId: null });
      expect((await ventaPorId(v.id)).pct_comision).toBeNull();
      await pctDelCliente('4.25');
      try {
        await editar(v.id, cambios(v.numNota)).expect(200);
        expect((await ventaPorId(v.id)).pct_comision).toBe('4.25');
      } finally {
        await pctDelCliente('3.50');
      }
    });

    it('mismo vendedor conserva el % congelado aunque el cliente haya cambiado', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      await pctDelCliente('4.25');
      try {
        await editar(v.id, cambios(v.numNota)).expect(200);
        expect((await ventaPorId(v.id)).pct_comision).toBe('3.50');
      } finally {
        await pctDelCliente('3.50');
      }
    });

    it('de un vendedor a otro congela el % actual del cliente', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      await pctDelCliente('4.25');
      try {
        await editar(
          v.id,
          cambios(v.numNota, { vendedorId: vendedorTj2 }),
        ).expect(200);
        expect(await ventaPorId(v.id)).toMatchObject({
          vendedor_id: vendedorTj2,
          pct_comision: '4.25',
        });
      } finally {
        await pctDelCliente('3.50');
      }
    });

    it('vendedor → Oficina: % en null y el cobro de contado sin cobrador', async () => {
      const v = await registrar({
        fecha: FECHA_EDICION,
        contadoCredito: 'contado',
      });
      await editar(
        v.id,
        cambios(v.numNota, { vendedorId: null, contadoCredito: 'contado' }),
      ).expect(200);
      expect(await ventaPorId(v.id)).toMatchObject({
        vendedor_id: null,
        pct_comision: null,
      });
      expect(vivas(await cobrosDe(v.id))).toEqual([
        expect.objectContaining({
          vendedor_id: null,
          metodo_pago: 'transferencia',
        }),
      ]);
    });

    it('un repartidor inactivo o de otra sucursal es 400', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      await editar(
        v.id,
        cambios(v.numNota, { vendedorId: vendedorTjInactivo }),
      ).expect(400);
      await editar(v.id, cambios(v.numNota, { vendedorId: vendedorMx })).expect(
        400,
      );
    });

    // Review Focus 2
    it('si el repartidor no cambia no se vuelve a validar, aunque ya esté inactivo', async () => {
      const v = await registrar({
        fecha: FECHA_EDICION,
        vendedorId: vendedorTj2,
      });
      await db
        .updateTable('vendedor')
        .set({ activo: false })
        .where('id', '=', vendedorTj2)
        .execute();
      try {
        await editar(
          v.id,
          cambios(v.numNota, { vendedorId: vendedorTj2 }),
        ).expect(200);
      } finally {
        await db
          .updateTable('vendedor')
          .set({ activo: true })
          .where('id', '=', vendedorTj2)
          .execute();
      }
    });

    it('el # de nota repetido en la sucursal es 409', async () => {
      const otra = await registrar({
        fecha: FECHA_EDICION,
        numNota: `NR${SUFIJO}`,
      });
      const v = await registrar({ fecha: FECHA_EDICION });
      const res = await editar(v.id, cambios(` nr${SUFIJO} `)).expect(409);
      expect((res.body as { message: string }).message).toBe(
        `Ya existe la nota nr${SUFIJO} en esta sucursal.`,
      );
      expect(otra.id).not.toBe(v.id);
    });

    // Review Focus 4
    it('conservar el propio # de nota (con otras mayúsculas o espacios) no es duplicado', async () => {
      const v = await registrar({
        fecha: FECHA_EDICION,
        numNota: `PN${SUFIJO}`,
      });
      await editar(v.id, cambios(`  pn${SUFIJO}  `)).expect(200);
      expect((await ventaPorId(v.id)).num_nota).toBe(`pn${SUFIJO}`);
    });

    it('con abonos de cobranza es 409 y no cambia nada', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      await abonar(v.id, '50.00');
      const res = await editar(
        v.id,
        cambios(v.numNota, {
          lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
        }),
      ).expect(409);
      expect((res.body as { message: string }).message).toBe(
        'Tiene cobros registrados: no se puede editar.',
      );
      expect((await ventaPorId(v.id)).monto_total).toBe('270.00');
    });

    it('una venta marcada como cuenta perdida no se edita', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      await db
        .updateTable('venta_nota')
        .set({ status: 'cuenta_perdida' })
        .where('id', '=', v.id)
        .execute();
      await editar(v.id, cambios(v.numNota)).expect(409);
    });

    it('sin permiso 403; otra sucursal 403; inexistente o eliminada 404', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      await editar(v.id, cambios(v.numNota), cookieSinPermiso).expect(403);

      const mx = await registrar({
        fecha: FECHA_EDICION,
        clienteId: clienteMx,
        vendedorId: vendedorMx,
        lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
      });
      await editar(
        mx.id,
        cambios(mx.numNota, {
          vendedorId: vendedorMx,
          lineas: [{ presentacionId: pre1, cantidad: 2, cantidadPromocion: 0 }],
        }),
        cookieTijuana,
      ).expect(403);

      await editar(randomUUID(), cambios(nota())).expect(404);
      await db
        .updateTable('venta_nota')
        .set({ deleted_at: sql`now()` })
        .where('id', '=', v.id)
        .execute();
      await editar(v.id, cambios(v.numNota)).expect(404);
    });

    it('una venta de la tablet: conserva su precio, no acepta Oficina y sigue siendo de la tablet', async () => {
      const t = await ventaDeTablet();
      const res = await editar(
        t.id,
        cambios(t.numNota, {
          vendedorId: null,
          lineas: [
            { presentacionId: pre1, cantidad: 12, cantidadPromocion: 0 },
          ],
        }),
      ).expect(400);
      expect((res.body as { message: string }).message).toBe(
        'Una venta de tablet debe tener vendedor.',
      );

      const venta = (
        await editar(
          t.id,
          cambios(t.numNota, {
            vendedorId: vendedorApp,
            lineas: [
              { presentacionId: pre1, cantidad: 12, cantidadPromocion: 0 },
            ],
          }),
        ).expect(200)
      ).body as VentaDetalle;
      // 12 × 9.00: el precio de la nota firmada, no el 10.00 de la lista.
      expect(venta).toMatchObject({ montoCentavos: 10800, origen: 'app' });
      expect(await ventaPorId(t.id)).toMatchObject({
        origen: 'app',
        vendedor_id: vendedorApp,
        capturo_usuario_id: null,
        actualizado_por_usuario_id: usuarioGeneralId,
        folio: t.folio,
      });
    });
  });

  /**
   * Las notas por cobrar que baja la tablet de Tijuana (§4.5). Una nota sale de
   * su lista cuando ya no viaja con `activo: 1`: en el vuelco completo no
   * aparece o aparece con `activo: 0`, y en el incremental viaja con `activo: 0`.
   */
  const notasDeLaTablet = async (desde?: string) => {
    const params = new URLSearchParams({ contrato: String(CONTRATO_ACTUAL) });
    if (desde) params.set('desde', desde);
    const res = await request(app.getHttpServer())
      .get(`/sync/pull?${params.toString()}`)
      .set('Authorization', `Bearer ${bearerApp}`)
      .expect(200);
    return res.body as RespuestaPull;
  };
  const porCobrar = (pull: RespuestaPull, id: string) =>
    pull.notas_pendientes.some((n) => n.id === id && n.activo === 1);

  describe('DELETE /ventas/:id (eliminar, §4.3)', () => {
    const eliminar = (id: string, cookie = cookieGeneral) =>
      request(app.getHttpServer())
        .delete(`/ventas/${id}`)
        .set('Cookie', cookie);

    it('borra la venta, sus líneas y su cobro de contado, y deja quién la eliminó', async () => {
      const v = await registrar({
        fecha: FECHA_BORRADO,
        contadoCredito: 'contado',
      });
      const res = await eliminar(v.id).expect(200);
      expect(res.body).toEqual({ id: v.id });

      const fila = await ventaPorId(v.id);
      expect(fila.deleted_at).not.toBeNull();
      expect(fila.eliminado_por_usuario_id).toBe(usuarioGeneralId);
      expect(vivas(await lineasDe(v.id))).toEqual([]);
      expect(await lineasDe(v.id)).toHaveLength(2);
      expect(vivas(await cobrosDe(v.id))).toEqual([]);
      expect(await cobrosDe(v.id)).toHaveLength(1);

      await detalle(cookieGeneral, v.id).expect(404);
      const busqueda = (
        await buscar(cookieGeneral, {
          desde: FECHA_BORRADO,
          hasta: FECHA_BORRADO,
          clienteId: clienteTj,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(busqueda.ventas.map((f) => f.id)).not.toContain(v.id);
    });

    it('libera el # de nota y no reutiliza el folio', async () => {
      const v = await registrar({ fecha: FECHA_BORRADO });
      await eliminar(v.id).expect(200);
      const otra = await registrar({
        fecha: FECHA_BORRADO,
        numNota: v.numNota,
      });
      expect(otra.folio).not.toBe(v.folio);
    });

    it('con abonos de cobranza es 409 y la venta sigue viva', async () => {
      const v = await registrar({ fecha: FECHA_BORRADO });
      await abonar(v.id, '20.00');
      const res = await eliminar(v.id).expect(409);
      expect((res.body as { message: string }).message).toBe(
        'Tiene cobros registrados: no se puede eliminar.',
      );
      expect((await ventaPorId(v.id)).deleted_at).toBeNull();
    });

    it('sin permiso 403; otra sucursal 403; dos veces 404', async () => {
      const v = await registrar({ fecha: FECHA_BORRADO });
      await eliminar(v.id, cookieSinPermiso).expect(403);
      const mx = await registrar({
        fecha: FECHA_BORRADO,
        clienteId: clienteMx,
        vendedorId: vendedorMx,
        lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
      });
      await eliminar(mx.id, cookieTijuana).expect(403);
      await eliminar(v.id).expect(200);
      await eliminar(v.id).expect(404);
    });

    it('una venta de la tablet se elimina desde el portal', async () => {
      const t = await ventaDeTablet();
      await eliminar(t.id).expect(200);
      expect(await ventaPorId(t.id)).toMatchObject({
        origen: 'app',
        eliminado_por_usuario_id: usuarioGeneralId,
      });
      expect((await ventaPorId(t.id)).deleted_at).not.toBeNull();
    });

    it('una venta a crédito eliminada deja de estar por cobrar en la tablet', async () => {
      const v = await registrar({ fecha: FECHA_BORRADO });
      expect(porCobrar(await notasDeLaTablet(), v.id)).toBe(true);
      await eliminar(v.id).expect(200);
      expect(porCobrar(await notasDeLaTablet(), v.id)).toBe(false);
    });
  });

  describe('POST /ventas/:id/cuenta-perdida (§4.4)', () => {
    const perdida = (id: string, cookie = cookieGeneral) =>
      request(app.getHttpServer())
        .post(`/ventas/${id}/cuenta-perdida`)
        .set('Cookie', cookie);

    it('desde pendiente: cuenta perdida sin tocar líneas ni monto, y deja quién', async () => {
      const v = await registrar({ fecha: FECHA_PERDIDA });
      const venta = (await perdida(v.id).expect(201)).body as VentaDetalle;
      expect(venta).toMatchObject({
        id: v.id,
        status: 'cuenta_perdida',
        montoCentavos: 27000,
        editable: false,
        puedeMarcarPerdida: false,
      });
      expect(venta.lineas).toHaveLength(2);
      expect(await ventaPorId(v.id)).toMatchObject({
        status: 'cuenta_perdida',
        monto_total: '270.00',
        actualizado_por_usuario_id: usuarioGeneralId,
      });
    });

    it('desde abonado, con abonos: los abonos siguen vivos', async () => {
      const v = await registrar({ fecha: FECHA_PERDIDA });
      await abonar(v.id, '70.00');
      await perdida(v.id).expect(201);
      expect(vivas(await cobrosDe(v.id))).toEqual([
        expect.objectContaining({ monto: '70.00', origen: 'cobro' }),
      ]);
    });

    it('desde pagada es 409, y marcarla dos veces también', async () => {
      const pagada = await registrar({
        fecha: FECHA_PERDIDA,
        contadoCredito: 'contado',
      });
      const res = await perdida(pagada.id).expect(409);
      expect((res.body as { message: string }).message).toBe(
        'Solo una venta pendiente o abonada se puede marcar como cuenta perdida.',
      );
      const v = await registrar({ fecha: FECHA_PERDIDA });
      await perdida(v.id).expect(201);
      await perdida(v.id).expect(409);
    });

    it('después ya no se edita ni se elimina', async () => {
      const v = await registrar({ fecha: FECHA_PERDIDA });
      await perdida(v.id).expect(201);
      await request(app.getHttpServer())
        .patch(`/ventas/${v.id}`)
        .set('Cookie', cookieGeneral)
        .send({
          vendedorId: vendedorTj,
          numNota: v.numNota,
          contadoCredito: 'credito',
          factura: 'N/A',
          lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
        })
        .expect(409);
      await request(app.getHttpServer())
        .delete(`/ventas/${v.id}`)
        .set('Cookie', cookieGeneral)
        .expect(409);
    });

    it('sin permiso 403; otra sucursal 403; inexistente 404', async () => {
      const v = await registrar({ fecha: FECHA_PERDIDA });
      await perdida(v.id, cookieSinPermiso).expect(403);
      const mx = await registrar({
        fecha: FECHA_PERDIDA,
        clienteId: clienteMx,
        vendedorId: vendedorMx,
        lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
      });
      await perdida(mx.id, cookieTijuana).expect(403);
      await perdida(randomUUID()).expect(404);
    });

    it('la nota deja de salir por cobrar en la tablet (vuelco completo e incremental)', async () => {
      const v = await registrar({ fecha: FECHA_PERDIDA });
      const antes = await notasDeLaTablet();
      expect(porCobrar(antes, v.id)).toBe(true);

      await perdida(v.id).expect(201);

      expect(porCobrar(await notasDeLaTablet(), v.id)).toBe(false);
      const incremental = await notasDeLaTablet(antes.cursor);
      expect(
        incremental.notas_pendientes.find((n) => n.id === v.id),
      ).toMatchObject({
        activo: 0,
      });
    });
  });
});

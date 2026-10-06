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
import { hoyEnTijuana } from './../src/modules/sincronizacion/operaciones';

/**
 * Registrar venta desde el portal (T-17, parte 1) de punta a punta: §7 del spec.
 *
 * Fechas de 2025 exclusivas de este archivo: el contador del folio OF es por
 * sucursal y dia, y las pruebas de consecutivos necesitan su dia limpio. Se
 * limpian antes (restos de una corrida que trono) y despues.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-vta-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-vta-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-vta-sin-${SUFIJO}`;

const FECHA_BASE = '2025-02-10'; // lunes, semana ISO 7
const FECHA_CONSECUTIVOS = '2025-02-11';
const FECHA_SIMULTANEAS = '2025-02-12';
const FECHA_TOPE = '2025-02-13';
const FECHA_SIN_QUEMA = '2025-02-14';
const FECHA_ANTES_DEL_CAMBIO = '2025-03-15';
const FECHA_DESPUES_DEL_CAMBIO = '2025-07-01';
const FECHA_SIN_PRECIOS = '2024-12-31';
const FECHAS = [
  FECHA_BASE,
  FECHA_CONSECUTIVOS,
  FECHA_SIMULTANEAS,
  FECHA_TOPE,
  FECHA_SIN_QUEMA,
  FECHA_ANTES_DEL_CAMBIO,
  FECHA_DESPUES_DEL_CAMBIO,
  FECHA_SIN_PRECIOS,
];

interface VentaRegistrada {
  id: string;
  folio: string;
  montoCentavos: number;
  status: string;
}

interface PresentacionDeCatalogo {
  presentacionId: string;
  producto: string;
  volumen: string;
  precioCentavos: number | null;
}

/**
 * `fecha` como `AAAA-MM-DD` para filtrar: Kysely tipa una columna `date` como
 * `Date` al comparar, y un `Date` de JS se corre de dia segun el huso.
 */
const fechaComoTexto = sql<string>`to_char(fecha, 'YYYY-MM-DD')`;

/** `date` de Postgres a `AAAA-MM-DD`, con los componentes locales que puso el driver. */
const fechaTexto = (valor: Date | string) =>
  valor instanceof Date
    ? `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, '0')}-${String(valor.getDate()).padStart(2, '0')}`
    : String(valor).slice(0, 10);

/** Manana en Tijuana, armado del texto (nunca de un Date local). */
const mananaEnTijuana = () => {
  const [a, m, d] = hoyEnTijuana().split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
};

describe('Ventas desde el portal (e2e)', () => {
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
  let pre1: string; // 1 L: 10.00 desde 2025-01-01, 12.50 desde 2025-06-01 (TJ); 20.00 (MX)
  let pre2: string; // 500 ml: 7.25 en la lista, 6.00 precio especial del cliente TJ
  let preSinPrecio: string; // 2 L: sin precio
  const precioIds: string[] = [];
  let clientePrecioId: string;
  let clienteTj: string;
  let clienteMx: string;
  let vendedorTj: string;
  let vendedorTjInactivo: string;
  let vendedorMx: string;

  let notas = 0;
  /** Un # de nota unico por llamada (≤ 30): el indice de #95 no deja repetirlo. */
  const nota = () => `e2e${SUFIJO}-${++notas}`;

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
        login: `e2e-vta-${nombre.toLowerCase().replace(/\s+/g, '-')}-${SUFIJO}`,
        nombre: `${nombre} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
        activo,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  const sembrarPrecio = async (
    presentacionId: string,
    sucursalId: string,
    precio: string,
    vigenteDesde: string,
  ) => {
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

  /** Ventas, detalle y cobros de las fechas de este archivo, y su contador OF. */
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

  /** Un cuerpo valido de POST /ventas: credito, a nombre del vendedor TJ, 24+2 de 1 L y 5 de 500 ml. */
  const cuerpo = (extra: Record<string, unknown> = {}) => ({
    fecha: FECHA_BASE,
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
  });

  const registrar = (cookie: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/ventas')
      .set('Cookie', cookie)
      .send(body);

  const ventaPorId = (id: string) =>
    db
      .selectFrom('venta_nota')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  const detalleDe = (id: string) =>
    db
      .selectFrom('venta_nota_detalle')
      .select(['presentacion_id', 'cantidad', 'cantidad_promocion', 'precio'])
      .where('venta_nota_id', '=', id)
      .orderBy('precio', 'desc')
      .execute();

  const abonosDe = (id: string) =>
    db
      .selectFrom('cobranza_abono')
      .select(['monto', 'metodo_pago', 'vendedor_id', 'origen', 'folio'])
      .where('venta_nota_id', '=', id)
      .execute();

  const ventasConNota = (numNota: string) =>
    db
      .selectFrom('venta_nota')
      .select('id')
      .where('num_nota', '=', numNota)
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
    preSinPrecio = await presentacion('2 L');

    await sembrarPrecio(pre1, tjId, '10.00', '2025-01-01');
    await sembrarPrecio(pre1, tjId, '12.50', '2025-06-01');
    await sembrarPrecio(pre2, tjId, '7.25', '2025-01-01');
    await sembrarPrecio(pre1, mxId, '20.00', '2025-01-01');

    clienteTj = await sembrarCliente('Abarrotes TJ', tjId);
    clienteMx = await sembrarCliente('Abarrotes MX', mxId);
    clientePrecioId = (
      await db
        .insertInto('cliente_precio')
        .values({
          cliente_id: clienteTj,
          presentacion_id: pre2,
          precio: '6.00',
          vigente_desde: '2025-01-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    vendedorTj = await sembrarVendedor('Ana Activa', tjId);
    vendedorTjInactivo = await sembrarVendedor('Beto Inactivo', tjId, false);
    vendedorMx = await sembrarVendedor('Carla Mexicali', mxId);
  });

  afterAll(async () => {
    const ventas = db
      .selectFrom('venta_nota')
      .select('id')
      .where('cliente_id', 'in', [clienteTj, clienteMx]);
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
      .where('cliente_id', 'in', [clienteTj, clienteMx])
      .execute();
    await limpiarVentas();
    await db
      .deleteFrom('cliente_precio')
      .where('id', '=', clientePrecioId)
      .execute();
    await db.deleteFrom('precio').where('id', 'in', precioIds).execute();
    await db
      .deleteFrom('cliente')
      .where('id', 'in', [clienteTj, clienteMx])
      .execute();
    await db
      .deleteFrom('presentacion')
      .where('id', 'in', [pre1, pre2, preSinPrecio])
      .execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
    await db
      .deleteFrom('vendedor')
      .where('id', 'in', [vendedorTj, vendedorTjInactivo, vendedorMx])
      .execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  /* ================================================================ */

  describe('POST /ventas', () => {
    it('a nombre de un vendedor: monto = Σ cantidad × precio de la lista del cliente a esa fecha', async () => {
      const res = await registrar(cookieGeneral, cuerpo()).expect(201);
      const venta = res.body as VentaRegistrada;

      // 24 × 10.00 (lista) + 5 × 6.00 (precio especial); las 2 de promocion no suman.
      expect(venta).toMatchObject({
        montoCentavos: 27000,
        status: 'pendiente',
      });
      expect(venta.folio).toMatch(/^TJ250210OF\d{2}$/);

      const fila = await ventaPorId(venta.id);
      expect(fila).toMatchObject({
        folio: venta.folio,
        cliente_id: clienteTj,
        vendedor_id: vendedorTj,
        sucursal_id: tjId,
        monto_total: '270.00',
        contado_credito: 'credito',
        factura: 'N/A',
        status: 'pendiente',
        semana: 7,
        mes: 2,
        pct_comision: '3.50',
        origen: 'portal',
        capturo_usuario_id: usuarioGeneralId,
      });
      expect(fechaTexto(fila.fecha)).toBe(FECHA_BASE);
      expect(await detalleDe(venta.id)).toEqual([
        {
          presentacion_id: pre1,
          cantidad: 24,
          cantidad_promocion: 2,
          precio: '10.00',
        },
        {
          presentacion_id: pre2,
          cantidad: 5,
          cantidad_promocion: 0,
          precio: '6.00',
        },
      ]);
      // Credito: no se cobra sola.
      expect(await abonosDe(venta.id)).toEqual([]);
    });

    it('ignora cualquier precio que mande el cliente', async () => {
      const res = await registrar(
        cookieGeneral,
        cuerpo({
          lineas: [
            {
              presentacionId: pre1,
              cantidad: 1,
              cantidadPromocion: 0,
              precioCentavos: 1,
            },
          ],
        }),
      ).expect(201);
      const venta = res.body as VentaRegistrada;
      expect(venta.montoCentavos).toBe(1000);
      expect((await detalleDe(venta.id))[0].precio).toBe('10.00');
    });

    it('una venta de Oficina no lleva vendedor', async () => {
      const res = await registrar(
        cookieGeneral,
        cuerpo({ vendedorId: null }),
      ).expect(201);
      const venta = res.body as VentaRegistrada;
      expect(venta.folio).toMatch(/^TJ250210OF\d{2}$/);
      expect(await ventaPorId(venta.id)).toMatchObject({
        vendedor_id: null,
        origen: 'portal',
        monto_total: '270.00',
      });
    });

    it('una fecha pasada usa el precio que habia entonces', async () => {
      const lineas = [
        { presentacionId: pre1, cantidad: 2, cantidadPromocion: 0 },
      ];
      const antes = (
        await registrar(
          cookieGeneral,
          cuerpo({ fecha: FECHA_ANTES_DEL_CAMBIO, lineas }),
        ).expect(201)
      ).body as VentaRegistrada;
      const despues = (
        await registrar(
          cookieGeneral,
          cuerpo({ fecha: FECHA_DESPUES_DEL_CAMBIO, lineas }),
        ).expect(201)
      ).body as VentaRegistrada;

      expect(antes.montoCentavos).toBe(2000);
      expect(despues.montoCentavos).toBe(2500);
      expect(antes.folio).toMatch(/^TJ250315OF\d{2}$/);
    });

    it('una fecha futura es 400 y no escribe nada', async () => {
      const numNota = nota();
      const res = await registrar(
        cookieGeneral,
        cuerpo({ fecha: mananaEnTijuana(), numNota }),
      ).expect(400);
      expect((res.body as { message: string }).message).toBe(
        'La fecha de la venta no puede ser futura.',
      );
      expect(await ventasConNota(numNota)).toHaveLength(0);
    });

    it('una linea con piezas sin precio a esa fecha es 409 y no escribe nada', async () => {
      const numNota = nota();
      const res = await registrar(
        cookieGeneral,
        cuerpo({
          numNota,
          lineas: [
            { presentacionId: preSinPrecio, cantidad: 1, cantidadPromocion: 0 },
          ],
        }),
      ).expect(409);
      expect((res.body as { message: string }).message).toBe(
        `Una de las presentaciones no tiene precio en la lista del cliente para el ${FECHA_BASE}.`,
      );
      expect(await ventasConNota(numNota)).toHaveLength(0);

      // Antes de que el cliente tuviera lista vigente, tampoco hay precio.
      await registrar(
        cookieGeneral,
        cuerpo({
          fecha: FECHA_SIN_PRECIOS,
          lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
        }),
      ).expect(409);
    });

    it('sin el permiso venta.registrar es 403', async () => {
      await registrar(cookieSinPermiso, cuerpo()).expect(403);
    });

    it('un cliente de otra sucursal es 403', async () => {
      await registrar(
        cookieTijuana,
        cuerpo({
          clienteId: clienteMx,
          vendedorId: null,
          lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
        }),
      ).expect(403);
    });

    it('un vendedor de otra sucursal se rechaza con 400', async () => {
      const res = await registrar(
        cookieGeneral,
        cuerpo({ vendedorId: vendedorMx }),
      ).expect(400);
      expect((res.body as { message: string }).message).toBe(
        'El repartidor elegido no es un vendedor activo de la sucursal del cliente.',
      );
    });

    it('un vendedor inactivo se rechaza con 400', async () => {
      await registrar(
        cookieGeneral,
        cuerpo({ vendedorId: vendedorTjInactivo }),
      ).expect(400);
    });

    it('sin repartidor (ni vendedor ni Oficina) es 400', async () => {
      const body: Record<string, unknown> = cuerpo();
      delete body.vendedorId;
      await registrar(cookieGeneral, body).expect(400);
    });

    it('contado deja su cobro por transferencia por defecto (Oficina: sin cobrador)', async () => {
      const venta = (
        await registrar(
          cookieGeneral,
          cuerpo({ vendedorId: null, contadoCredito: 'contado' }),
        ).expect(201)
      ).body as VentaRegistrada;

      expect(venta.status).toBe('pagada');
      expect(await abonosDe(venta.id)).toEqual([
        {
          monto: '270.00',
          metodo_pago: 'transferencia',
          vendedor_id: null,
          origen: 'venta_contado',
          folio: venta.folio,
        },
      ]);
    });

    it('contado en efectivo, si se elige, con el vendedor como cobrador', async () => {
      const venta = (
        await registrar(
          cookieGeneral,
          cuerpo({ contadoCredito: 'contado', metodoPago: 'efectivo' }),
        ).expect(201)
      ).body as VentaRegistrada;

      expect(await abonosDe(venta.id)).toEqual([
        expect.objectContaining({
          metodo_pago: 'efectivo',
          vendedor_id: vendedorTj,
        }),
      ]);
    });

    it('un # de nota repetido en la sucursal es 409; en otra sucursal si entra', async () => {
      const numNota = nota();
      await registrar(cookieGeneral, cuerpo({ numNota })).expect(201);

      const repetida = await registrar(
        cookieGeneral,
        cuerpo({ numNota: `  ${numNota.toUpperCase()} ` }),
      ).expect(409);
      expect((repetida.body as { message: string }).message).toBe(
        `Ya existe la nota ${numNota.toUpperCase()} en esta sucursal.`,
      );

      await registrar(
        cookieGeneral,
        cuerpo({
          clienteId: clienteMx,
          vendedorId: null,
          numNota,
          lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
        }),
      ).expect(201);
    });

    it('los folios OF son consecutivos por dia y por sucursal', async () => {
      const tj1 = (
        await registrar(
          cookieGeneral,
          cuerpo({ fecha: FECHA_CONSECUTIVOS }),
        ).expect(201)
      ).body as VentaRegistrada;
      const tj2 = (
        await registrar(
          cookieGeneral,
          cuerpo({ fecha: FECHA_CONSECUTIVOS }),
        ).expect(201)
      ).body as VentaRegistrada;
      const mx1 = (
        await registrar(
          cookieGeneral,
          cuerpo({
            fecha: FECHA_CONSECUTIVOS,
            clienteId: clienteMx,
            vendedorId: null,
            lineas: [
              { presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 },
            ],
          }),
        ).expect(201)
      ).body as VentaRegistrada;

      expect([tj1.folio, tj2.folio, mx1.folio]).toEqual([
        'TJ250211OF01',
        'TJ250211OF02',
        'MX250211OF01',
      ]);
    });

    it('grabaciones simultaneas no repiten numero', async () => {
      const respuestas = await Promise.all(
        [1, 2, 3, 4].map(() =>
          registrar(cookieGeneral, cuerpo({ fecha: FECHA_SIMULTANEAS })),
        ),
      );
      for (const r of respuestas) expect(r.status).toBe(201);
      const folios = respuestas
        .map((r) => (r.body as VentaRegistrada).folio)
        .sort();
      expect(folios).toEqual([
        'TJ250212OF01',
        'TJ250212OF02',
        'TJ250212OF03',
        'TJ250212OF04',
      ]);
    });

    it('pasado de 99 folios OF en el dia es 409 y el contador no avanza', async () => {
      await db
        .insertInto('folio_oficina_contador')
        .values({ sucursal_id: tjId, fecha: FECHA_TOPE, ultimo: 99 })
        .execute();

      const res = await registrar(
        cookieGeneral,
        cuerpo({ fecha: FECHA_TOPE }),
      ).expect(409);
      expect((res.body as { message: string }).message).toBe(
        'Se alcanzó el máximo de 99 ventas de oficina para ese día.',
      );
      const fila = await db
        .selectFrom('folio_oficina_contador')
        .select('ultimo')
        .where('sucursal_id', '=', tjId)
        .where(fechaComoTexto, '=', FECHA_TOPE)
        .executeTakeFirstOrThrow();
      expect(fila.ultimo).toBe(99);
    });

    it('un rechazo despues de emitir no quema el folio', async () => {
      const numNota = nota();
      const primera = (
        await registrar(
          cookieGeneral,
          cuerpo({ fecha: FECHA_SIN_QUEMA, numNota }),
        ).expect(201)
      ).body as VentaRegistrada;
      // El # de nota repetido truena DESPUES de emitir el folio: el rollback lo devuelve.
      await registrar(
        cookieGeneral,
        cuerpo({ fecha: FECHA_SIN_QUEMA, numNota }),
      ).expect(409);
      const tercera = (
        await registrar(
          cookieGeneral,
          cuerpo({ fecha: FECHA_SIN_QUEMA }),
        ).expect(201)
      ).body as VentaRegistrada;

      expect([primera.folio, tercera.folio]).toEqual([
        'TJ250214OF01',
        'TJ250214OF02',
      ]);
    });
  });

  /* ================================================================ */

  describe('GET /ventas/catalogo', () => {
    const catalogo = (cookie: string, clienteId: string, fecha: string) =>
      request(app.getHttpServer())
        .get(`/ventas/catalogo?clienteId=${clienteId}&fecha=${fecha}`)
        .set('Cookie', cookie);

    const propias = (lista: PresentacionDeCatalogo[]) =>
      lista.filter((p) =>
        [pre1, pre2, preSinPrecio].includes(p.presentacionId),
      );

    it('da las presentaciones del cliente con su precio a esa fecha, y las sin precio en null', async () => {
      const antes = (
        await catalogo(cookieGeneral, clienteTj, FECHA_ANTES_DEL_CAMBIO).expect(
          200,
        )
      ).body as PresentacionDeCatalogo[];
      expect(propias(antes)).toEqual([
        {
          presentacionId: pre1,
          producto: `Horchata e2e ${SUFIJO}`,
          volumen: '1 L',
          precioCentavos: 1000,
        },
        {
          presentacionId: preSinPrecio,
          producto: `Horchata e2e ${SUFIJO}`,
          volumen: '2 L',
          precioCentavos: null,
        },
        {
          presentacionId: pre2,
          producto: `Horchata e2e ${SUFIJO}`,
          volumen: '500 ml',
          precioCentavos: 600,
        },
      ]);

      const despues = (
        await catalogo(
          cookieGeneral,
          clienteTj,
          FECHA_DESPUES_DEL_CAMBIO,
        ).expect(200)
      ).body as PresentacionDeCatalogo[];
      expect(
        propias(despues).find((p) => p.presentacionId === pre1)?.precioCentavos,
      ).toBe(1250);
    });

    it('basta la sesion: no exige venta.registrar', async () => {
      await catalogo(cookieSinPermiso, clienteTj, FECHA_BASE).expect(200);
    });

    it('un cliente de otra sucursal es 403', async () => {
      await catalogo(cookieTijuana, clienteMx, FECHA_BASE).expect(403);
    });

    it('una fecha futura es 400', async () => {
      await catalogo(cookieGeneral, clienteTj, mananaEnTijuana()).expect(400);
    });
  });

  describe('GET /ventas/repartidores', () => {
    const repartidores = (cookie: string, sucursalId: string) =>
      request(app.getHttpServer())
        .get(`/ventas/repartidores?sucursalId=${sucursalId}`)
        .set('Cookie', cookie);

    it('da los vendedores activos de la sucursal, sin inactivos ni de otra sucursal', async () => {
      const lista = (await repartidores(cookieGeneral, tjId).expect(200))
        .body as {
        id: string;
        nombre: string;
      }[];
      const ids = lista.map((r) => r.id);
      expect(ids).toContain(vendedorTj);
      expect(ids).not.toContain(vendedorTjInactivo);
      expect(ids).not.toContain(vendedorMx);
      expect(lista.find((r) => r.id === vendedorTj)).toEqual({
        id: vendedorTj,
        nombre: `Ana Activa ${SUFIJO}`,
      });
    });

    it('otra sucursal es 403', async () => {
      await repartidores(cookieTijuana, mxId).expect(403);
    });
  });
});

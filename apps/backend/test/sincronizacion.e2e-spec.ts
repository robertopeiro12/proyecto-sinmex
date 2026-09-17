import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';
import { PreciosRepository } from './../src/modules/cartera-clientes/precios.repository';
import { CONTRATO_ACTUAL } from './../src/modules/sincronizacion/contrato';
import { formarFolio } from './../src/modules/sincronizacion/folio';
import { hoyEnTijuana } from './../src/modules/sincronizacion/operaciones';
import { asignarSegmento } from './../src/modules/sincronizacion/segmento-vendedor';
import type {
  RespuestaPull,
  RespuestaPush,
} from './../src/modules/sincronizacion/contrato';

/**
 * Contrato de sincronizacion (T-07) de punta a punta.
 *
 * Es lo mas valioso que se puede verificar **sin una tablet**: idempotencia del
 * push, push parcial honesto, alcance ajeno, separacion de actores y pull
 * incremental. Nada de esto necesita Android; todo esto se rompe en silencio si
 * no se prueba.
 */

const SUFIJO = Date.now();
const LOGIN = `e2e-sync-${SUFIJO}`;
const LOGIN_AJENO = `e2e-sync-ajeno-${SUFIJO}`;
const LOGIN_PORTAL = `e2e-sync-portal-${SUFIJO}`;
const PASSWORD = 'contrasena-del-vendedor';

interface RespuestaError {
  message: string | string[];
  codigo?: string;
}

interface Tokens {
  tokenAcceso: string;
  tokenRefresh: string;
}

describe('Sincronizacion pull/push (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;

  // Sucursal propia (la primera por codigo: MX) y ajena (TJ), ambas semilla.
  let sucursalId: string;
  let sucursalCodigo: string;
  let sucursalAjenaId: string;
  let sucursalAjenaCodigo: string;

  let vendedorId: string;
  let vendedorAjenoId: string;
  /** El 5o segmento del folio de cada uno. Lo asigna el servidor (T-14). */
  let segmento: string;
  let segmentoAjeno: string;
  let usuarioPortalId: string;

  let clienteId: string;
  let clienteAjenoId: string;
  let productoId: string;
  let presentacionId: string;
  let vehiculoId: string;
  let notaId: string;
  let precioId: string;
  let clientePrecioId: string;

  // T-16: presentaciones de prueba para lo que se vende y lo que no.
  let presentacionSinPrecioId: string;
  let presentacionBorradaId: string;
  let productoInactivoId: string;
  let presentacionInactivaId: string;
  let precioInactivaId: string;

  let bearer: string;

  const entrar = async (login = LOGIN): Promise<Tokens> => {
    const res = await request(app.getHttpServer())
      .post('/auth/app/login')
      .send({ login, password: PASSWORD })
      .expect(200);
    return res.body as Tokens;
  };

  const pull = (query: Record<string, string | number> = {}) => {
    const params = new URLSearchParams({
      contrato: String(CONTRATO_ACTUAL),
      ...Object.fromEntries(
        Object.entries(query).map(([k, v]) => [k, String(v)]),
      ),
    });
    return request(app.getHttpServer())
      .get(`/sync/pull?${params.toString()}`)
      .set('Authorization', `Bearer ${bearer}`);
  };

  const push = (cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ contrato: CONTRATO_ACTUAL, ...cuerpo });

  /** Una operacion valida de jornada, con clave unica por defecto. */
  const operacion = (extra: Record<string, unknown> = {}) => ({
    clave: `op-${SUFIJO}-${Math.random().toString(36).slice(2)}`,
    tipo: 'jornada',
    fecha_operacion: new Date().toISOString().slice(0, 10),
    ocurrido_en: new Date().toISOString(),
    datos: { km_inicial: 120345 },
    ...extra,
  });

  /* ---------------------------------------------------------------- */
  /* Ventas (T-16)                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Dia de las ventas de prueba que no fijan su propia fecha.
   *
   * Desde T-16 una `venta` necesita `datos` validos, `cliente_id` y un folio
   * coherente con su dia, su sucursal y su vendedor, y el folio es unico en toda
   * la base. Las pruebas de folios usan `2026-08-07` con consecutivos escritos a
   * mano; este dia queda para `ventaValida()`, que reparte consecutivos sola y
   * no puede chocar con aquellas.
   */
  const FECHA_VENTAS = '2026-08-08';
  let ultimoConsecutivo = 0;
  const siguienteConsecutivo = () => ++ultimoConsecutivo;

  /** `datos` validos de una venta (contrato §6), con lo que se quiera cambiar encima. */
  const datosVenta = (extra: Record<string, unknown> = {}) => ({
    num_nota: '2346',
    contado_credito: 'credito',
    factura: 'N/A',
    comentarios: null,
    // 24 piezas a 8.00 (el override del cliente) + 2 de promocion = 192.00.
    lineas: [
      {
        presentacion_id: presentacionId,
        cantidad: 24,
        cantidad_promocion: 2,
        precio_centavos: 800,
      },
    ],
    ...extra,
  });

  /**
   * Una venta que el servidor acepta (D20). Sustituye a `operacion({ tipo:
   * 'venta' })`, que servia de sobre generico mientras `datos` era libre.
   *
   * El folio se arma para el dia de la venta, salvo que `extra` traiga uno.
   */
  const ventaValida = (
    extra: Record<string, unknown> = {},
    fecha = FECHA_VENTAS,
    consecutivo?: number,
  ) =>
    operacion({
      tipo: 'venta',
      cliente_id: clienteId,
      fecha_operacion: fecha,
      ocurrido_en: `${fecha}T14:03:22.000-07:00`,
      folio:
        'folio' in extra
          ? extra.folio
          : formarFolio(
              sucursalCodigo,
              fecha,
              segmento,
              consecutivo ?? siguienteConsecutivo(),
            ),
      datos: datosVenta(),
      ...extra,
    });

  /** Las `venta_nota` con ese folio (0 o 1: el folio es unique). */
  const ventasConFolio = (folio: string) =>
    db
      .selectFrom('venta_nota')
      .selectAll()
      .where('folio', '=', folio)
      .execute();

  /** La fila del buzon de esa clave para el vendedor de la prueba, si quedo. */
  const buzonDe = (clave: string) =>
    db
      .selectFrom('sync_operacion')
      .select(['id', 'entidad_tabla', 'entidad_id'])
      .where('vendedor_id', '=', vendedorId)
      .where('clave_idempotencia', '=', clave)
      .executeTakeFirst();

  /** `date` de Postgres a `AAAA-MM-DD`, con los componentes locales que puso el driver. */
  const fechaTexto = (valor: Date | string) =>
    valor instanceof Date
      ? `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, '0')}-${String(valor.getDate()).padStart(2, '0')}`
      : String(valor).slice(0, 10);

  /* ---------------------------------------------------------------- */
  /* Cobranzas (T-20)                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Dia de los cobros de prueba. Distinto de `FECHA_VENTAS` para que los cobros
   * tengan su propio contador de folios y no se coman los 99 del dia de ventas.
   */
  const FECHA_COBROS = '2026-08-09';
  let ultimoConsecutivoCobro = 0;
  let ultimaNotaDeCobro = 0;

  /** Clientes creados por `clienteConNotas`; los borra el `afterAll`. */
  const clientesCobro: string[] = [];

  /**
   * Un cliente propio de la sucursal con sus notas a credito, para UNA prueba
   * de cobranza. Cada prueba arma su mundo: un reparto sobre `clienteId`
   * dependeria de cuantas ventas le dejaron las pruebas de T-16.
   *
   * `abonos` inserta filas vivas en `cobranza_abono` con la fecha de la nota y
   * una foto de `saldo_pendiente` en 0 **a proposito**: el servidor nunca la lee
   * como fuente (D7).
   */
  const clienteConNotas = async (
    notas: {
      monto: string;
      fecha: string;
      status?: 'pendiente' | 'abonado' | 'pagada' | 'cuenta_perdida';
      abonos?: string[];
    }[],
  ) => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();

    const cliente = (
      await db
        .insertInto('cliente')
        .values({
          nombre: `Cobros ${SUFIJO} ${clientesCobro.length + 1}`,
          domicilio: 'Calle 7 #3',
          telefono: '6640000000',
          tipo: 'cliente',
          lista_precio_id: lista.id,
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    clientesCobro.push(cliente);

    const ids: string[] = [];
    for (const n of notas) {
      const id = (
        await db
          .insertInto('venta_nota')
          .values({
            folio: `EC${SUFIJO}${++ultimaNotaDeCobro}`.slice(0, 20),
            fecha: n.fecha,
            cliente_id: cliente,
            vendedor_id: vendedorId,
            monto_total: n.monto,
            num_nota: '900',
            contado_credito: 'credito',
            semana: 32,
            mes: 8,
            status: n.status ?? 'pendiente',
            sucursal_id: sucursalId,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      for (const monto of n.abonos ?? []) {
        await db
          .insertInto('cobranza_abono')
          .values({
            venta_nota_id: id,
            fecha_pago: n.fecha,
            fecha_operacion: n.fecha,
            vendedor_id: vendedorId,
            monto,
            tipo: 'abono',
            saldo_pendiente: '0.00',
            metodo_pago: 'efectivo',
          })
          .execute();
      }
      ids.push(id);
    }
    return { clienteId: cliente, notas: ids };
  };

  /** Una cobranza que el servidor acepta (contrato §6), con su folio del dia de cobros. */
  const cobranzaValida = (
    cliente: string,
    ventaNotaId: string,
    datos: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ) =>
    operacion({
      tipo: 'cobranza',
      cliente_id: cliente,
      fecha_operacion: FECHA_COBROS,
      ocurrido_en: `${FECHA_COBROS}T16:20:00.000-07:00`,
      folio: formarFolio(
        sucursalCodigo,
        FECHA_COBROS,
        segmento,
        ++ultimoConsecutivoCobro,
      ),
      datos: {
        venta_nota_id: ventaNotaId,
        monto_centavos: 5000,
        metodo_pago: 'efectivo',
        fecha_pago: FECHA_COBROS,
        ...datos,
      },
      ...extra,
    });

  /** Las filas de `cobranza_abono` de una nota, en el orden en que se escribieron. */
  const abonosDe = (ventaNotaId: string) =>
    db
      .selectFrom('cobranza_abono')
      .select([
        'id',
        'monto',
        'tipo',
        'saldo_pendiente',
        'metodo_pago',
        'origen',
        'folio',
        'vendedor_id',
        'fecha_pago',
        'fecha_operacion',
      ])
      .where('venta_nota_id', '=', ventaNotaId)
      .orderBy('created_at')
      .execute();

  /** El status actual de una nota. */
  const statusDe = async (ventaNotaId: string) =>
    (
      await db
        .selectFrom('venta_nota')
        .select('status')
        .where('id', '=', ventaNotaId)
        .executeTakeFirstOrThrow()
    ).status;

  /** Los movimientos de saldo a favor de un cliente. */
  const saldoFavorDe = (cliente: string) =>
    db
      .selectFrom('saldo_favor_movimiento')
      .select([
        'id',
        'monto',
        'origen',
        'folio',
        'vendedor_id',
        'fecha_operacion',
      ])
      .where('cliente_id', '=', cliente)
      .orderBy('created_at')
      .execute();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await app.init();
    db = app.get<Database>(DB_CONNECTION);

    // --- Sucursales: la semilla de T-05 dejo TJ y MX. Se usan las dos, para
    // poder probar de verdad "otra sucursal" y no una inventada.
    const sucursales = await db
      .selectFrom('sucursal')
      .select(['id', 'codigo'])
      .where('deleted_at', 'is', null)
      .orderBy('codigo')
      .execute();
    expect(sucursales.length).toBeGreaterThanOrEqual(2);
    sucursalId = sucursales[0].id;
    sucursalCodigo = sucursales[0].codigo;
    sucursalAjenaId = sucursales[1].id;
    sucursalAjenaCodigo = sucursales[1].codigo;

    const passwordHash = await new PasswordService().hashear(PASSWORD);

    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Vendedor sync',
          password_hash: passwordHash,
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    vendedorAjenoId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN_AJENO,
          nombre: 'Vendedor de la otra sucursal',
          password_hash: passwordHash,
          sucursal_id: sucursalAjenaId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // --- Segmento del folio (T-14).
    //
    // Se asigna con la misma funcion que usaba el alta real antes de T-62.
    // Consulta GLOBAL a proposito (mas estricta de lo necesario desde T-62,
    // que hizo el unique de folio_segmento por sucursal): sigue siendo
    // segura, y no acopla esta prueba a la sucursal de estos vendedores. Una
    // corrida anterior que no limpiara podria tener el suyo tomado.
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

    segmento = asignarSegmento('Vendedor Sync', ocupados) as string;
    ocupados.add(segmento);
    segmentoAjeno = asignarSegmento('Otro Ajeno', ocupados) as string;

    await db
      .updateTable('vendedor')
      .set({ folio_segmento: segmento })
      .where('id', '=', vendedorId)
      .execute();
    await db
      .updateTable('vendedor')
      .set({ folio_segmento: segmentoAjeno })
      .where('id', '=', vendedorAjenoId)
      .execute();

    const perfil = await db
      .selectFrom('perfil')
      .select('id')
      .orderBy('nombre')
      .executeTakeFirstOrThrow();

    usuarioPortalId = (
      await db
        .insertInto('usuario')
        .values({
          login: LOGIN_PORTAL,
          nombre: 'Usuario de portal para el cruce',
          password_hash: passwordHash,
          perfil_id: perfil.id,
          sucursal_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // --- Catalogos
    vehiculoId = (
      await db
        .insertInto('vehiculo')
        .values({ nombre: `Camioneta ${SUFIJO}`, sucursal_id: sucursalId })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: `Jamaica ${SUFIJO}` })
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

    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();

    // 10.10 a proposito: es el importe que delata una conversion con coma
    // flotante (10.10 * 100 = 1010.0000000000001).
    precioId = (
      await db
        .insertInto('precio')
        .values({
          presentacion_id: presentacionId,
          lista_precio_id: lista.id,
          sucursal_id: sucursalId,
          precio: '10.10',
          vigente_desde: '2026-01-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    clienteId = (
      await db
        .insertInto('cliente')
        .values({
          nombre: `Abarrotes sync ${SUFIJO}`,
          domicilio: 'Calle 5 #12',
          telefono: '6641234567',
          tipo: 'cliente',
          lista_precio_id: lista.id,
          pct_comision: '3.50',
          promocion: '10+1',
          plazo_credito_dias: 7,
          lat: '32.514900',
          lng: '-117.038200',
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    clienteAjenoId = (
      await db
        .insertInto('cliente')
        .values({
          nombre: `Cliente de otra sucursal ${SUFIJO}`,
          domicilio: 'Otra calle',
          telefono: '6860000000',
          tipo: 'cliente',
          lista_precio_id: lista.id,
          sucursal_id: sucursalAjenaId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // Override especial de ese cliente: debe ganarle a la lista.
    clientePrecioId = (
      await db
        .insertInto('cliente_precio')
        .values({
          cliente_id: clienteId,
          presentacion_id: presentacionId,
          precio: '8.00',
          vigente_desde: '2026-02-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // --- T-16: lo que se puede vender y lo que no.
    //
    // Una presentacion activa SIN ningun precio (ni de lista ni override): se
    // ofrece para regalar como promocion, pero no para vender.
    presentacionSinPrecioId = (
      await db
        .insertInto('presentacion')
        .values({ producto_id: productoId, volumen: '500 ml' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // Una presentacion dada de baja en el portal (baja logica).
    presentacionBorradaId = (
      await db
        .insertInto('presentacion')
        .values({
          producto_id: productoId,
          volumen: '2 L',
          deleted_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // Un producto desactivado CON precio en la lista del cliente: demuestra que
    // lo que lo saca de la venta es el producto, no la falta de precio.
    productoInactivoId = (
      await db
        .insertInto('producto')
        .values({ nombre: `Tamarindo inactivo ${SUFIJO}`, activo: false })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    presentacionInactivaId = (
      await db
        .insertInto('presentacion')
        .values({ producto_id: productoInactivoId, volumen: '1 L' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    precioInactivaId = (
      await db
        .insertInto('precio')
        .values({
          presentacion_id: presentacionInactivaId,
          lista_precio_id: lista.id,
          sucursal_id: sucursalId,
          precio: '9.50',
          vigente_desde: '2026-01-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // --- Una nota pendiente por cobrar, con un abono parcial.
    notaId = (
      await db
        .insertInto('venta_nota')
        .values({
          folio: `E2E${SUFIJO}`.slice(0, 20),
          fecha: '2026-08-01',
          cliente_id: clienteId,
          vendedor_id: vendedorId,
          monto_total: '250.00',
          num_nota: '1234',
          contado_credito: 'credito',
          semana: 31,
          mes: 8,
          status: 'abonado',
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    await db
      .insertInto('cobranza_abono')
      .values({
        venta_nota_id: notaId,
        fecha_pago: '2026-08-03',
        // T-20: obligatoria desde 20260914160000 (D3).
        fecha_operacion: '2026-08-03',
        vendedor_id: vendedorId,
        monto: '100.00',
        tipo: 'abono',
        saldo_pendiente: '150.00',
        metodo_pago: 'efectivo',
      })
      .execute();

    bearer = (await entrar()).tokenAcceso;
  });

  afterAll(async () => {
    // Orden inverso a las llaves foraneas.
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    // T-20: los cobros de TODAS las notas de las pruebas (una venta de contado
    // deja el suyo), antes que las notas.
    await db
      .deleteFrom('cobranza_abono')
      .where(
        'venta_nota_id',
        'in',
        db
          .selectFrom('venta_nota')
          .select('id')
          .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId]),
      )
      .execute();
    // T-20: el saldo a favor de los clientes de las pruebas de cobranza.
    if (clientesCobro.length > 0) {
      await db
        .deleteFrom('saldo_favor_movimiento')
        .where('cliente_id', 'in', clientesCobro)
        .execute();
    }
    // T-16: las ventas que proyecto el push, ademas de `notaId`. Detalle antes
    // que cabecera, y las dos antes que cliente, presentacion y vendedor.
    await db
      .deleteFrom('venta_nota_detalle')
      .where(
        'venta_nota_id',
        'in',
        db
          .selectFrom('venta_nota')
          .select('id')
          .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId]),
      )
      .execute();
    await db
      .deleteFrom('venta_nota')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('cliente_precio')
      .where('id', '=', clientePrecioId)
      .execute();
    await db
      .deleteFrom('precio')
      .where('id', 'in', [precioId, precioInactivaId])
      .execute();
    await db
      .deleteFrom('cliente')
      .where('id', 'in', [clienteId, clienteAjenoId, ...clientesCobro])
      .execute();
    await db
      .deleteFrom('presentacion')
      .where('id', 'in', [
        presentacionId,
        presentacionSinPrecioId,
        presentacionBorradaId,
        presentacionInactivaId,
      ])
      .execute();
    await db
      .deleteFrom('producto')
      .where('id', 'in', [productoId, productoInactivoId])
      .execute();
    await db.deleteFrom('vehiculo').where('id', '=', vehiculoId).execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('vendedor')
      .where('id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', '=', usuarioPortalId)
      .execute();
    await db.deleteFrom('usuario').where('id', '=', usuarioPortalId).execute();
    await app.close();
  });

  /* ================================================================ */
  /* Autenticacion: son endpoints de la APP, no del portal            */
  /* ================================================================ */

  describe('solo entra la app', () => {
    it('sin encabezado Authorization, 401', async () => {
      await request(app.getHttpServer())
        .get(`/sync/pull?contrato=${CONTRATO_ACTUAL}`)
        .expect(401);
      await request(app.getHttpServer())
        .post('/sync/push')
        .send({ contrato: CONTRATO_ACTUAL, operaciones: [operacion()] })
        .expect(401);
    });

    it('un token del PORTAL no entra ni al pull ni al push', async () => {
      // El caso real que esto impide: un administrador con sesion en el portal
      // (o un XSS en el portal) empujando operaciones como si fuera una tablet.
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login: LOGIN_PORTAL, password: PASSWORD })
        .expect(200);

      const cookies = login.headers['set-cookie'] as unknown as string[];
      const acceso = cookies
        .find((c) => c.startsWith('jawa_access='))
        ?.split(';')[0]
        ?.split('=')[1];
      expect(acceso).toBeDefined();

      // Como cookie: el endpoint de la app ni la mira.
      await request(app.getHttpServer())
        .get(`/sync/pull?contrato=${CONTRATO_ACTUAL}`)
        .set('Cookie', [`jawa_access=${acceso}`])
        .expect(401);

      // Como Bearer: lo lee, pero el claim `tipo` es 'usuario'.
      const comoBearer = await request(app.getHttpServer())
        .get(`/sync/pull?contrato=${CONTRATO_ACTUAL}`)
        .set('Authorization', `Bearer ${acceso}`)
        .expect(401);
      expect((comoBearer.body as RespuestaError).message).toBe(
        'Sesion invalida o vencida.',
      );

      await request(app.getHttpServer())
        .post('/sync/push')
        .set('Authorization', `Bearer ${acceso}`)
        .send({ contrato: CONTRATO_ACTUAL, operaciones: [operacion()] })
        .expect(401);
    });

    it('un vendedor desactivado con token vivo no sincroniza', async () => {
      // El guard valida la firma del token, no que el vendedor siga existiendo.
      await db
        .updateTable('vendedor')
        .set({ activo: false })
        .where('id', '=', vendedorId)
        .execute();
      try {
        await pull().expect(401);
      } finally {
        await db
          .updateTable('vendedor')
          .set({ activo: true })
          .where('id', '=', vendedorId)
          .execute();
      }
      await pull().expect(200);
    });
  });

  /* ================================================================ */
  /* Version del contrato                                             */
  /* ================================================================ */

  describe('version del contrato', () => {
    it('una tablet mas nueva que el servidor recibe 409, no un error confuso', async () => {
      const res = await pull({ contrato: CONTRATO_ACTUAL + 1 }).expect(409);
      const cuerpo = res.body as RespuestaError;
      expect(cuerpo.codigo).toBe('contrato-incompatible');
      expect(String(cuerpo.message)).toContain('Actualiza el servidor');
    });

    it('el push tambien exige el contrato', async () => {
      const res = await push({
        contrato: CONTRATO_ACTUAL + 5,
        operaciones: [operacion()],
      }).expect(409);
      expect((res.body as RespuestaError).codigo).toBe('contrato-incompatible');
    });

    it('sin contrato es 400: no se asume una version', async () => {
      await request(app.getHttpServer())
        .get('/sync/pull')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(400);
    });

    it('toda respuesta dice con que contrato se genero', async () => {
      const res = await pull().expect(200);
      expect((res.body as RespuestaPull).contrato).toBe(CONTRATO_ACTUAL);

      const p = await push({ operaciones: [operacion()] }).expect(200);
      expect((p.body as RespuestaPush).contrato).toBe(CONTRATO_ACTUAL);
    });
  });

  /* ================================================================ */
  /* PULL                                                             */
  /* ================================================================ */

  describe('pull', () => {
    it('baja los catalogos de SU sucursal, los precios resueltos y las notas pendientes', async () => {
      const res = await pull().expect(200);
      const cuerpo = res.body as RespuestaPull;

      expect(cuerpo.completo).toBe(true);
      expect(cuerpo.desde).toBeNull();
      expect(cuerpo.sucursal.codigo).toBe(sucursalCodigo);
      expect(cuerpo.vendedor.id).toBe(vendedorId);

      // Catalogo de clientes: con precio, % comision y coordenadas, que es lo
      // que pide el criterio de aceptacion del ticket.
      const cliente = cuerpo.catalogos.clientes.find((c) => c.id === clienteId);
      expect(cliente).toBeDefined();
      expect(cliente?.pct_comision).toBe(3.5);
      expect(cliente?.lat).toBeCloseTo(32.5149, 4);
      expect(cliente?.lng).toBeCloseTo(-117.0382, 4);
      expect(cliente?.promocion).toBe('10+1');
      expect(cliente?.plazo_credito_dias).toBe(7);
      expect(cliente?.activo).toBe(1);
      // T-20: sin movimientos, el saldo a favor es 0.
      expect(cliente?.saldo_favor_centavos).toBe(0);

      // Productos y vehiculos.
      expect(cuerpo.catalogos.productos.some((p) => p.id === productoId)).toBe(
        true,
      );
      expect(
        cuerpo.catalogos.presentaciones.some((p) => p.id === presentacionId),
      ).toBe(true);
      expect(cuerpo.catalogos.vehiculos.some((v) => v.id === vehiculoId)).toBe(
        true,
      );

      // Notas pendientes, en centavos, con el saldo derivado (T-20, D7) y sus abonos.
      const nota = cuerpo.notas_pendientes.find((n) => n.id === notaId);
      expect(nota).toBeDefined();
      expect(nota?.status).toBe('abonado');
      expect(nota?.monto_total_centavos).toBe(25000);
      expect(nota?.saldo_centavos).toBe(15000);
      expect(nota?.cliente_id).toBe(clienteId);
      expect(nota?.abonos).toEqual([
        {
          fecha_pago: '2026-08-03',
          monto_centavos: 10000,
          metodo_pago: 'efectivo',
        },
      ]);
    });

    it('NO baja clientes de otra sucursal', async () => {
      const res = await pull().expect(200);
      const cuerpo = res.body as RespuestaPull;
      expect(
        cuerpo.catalogos.clientes.some((c) => c.id === clienteAjenoId),
      ).toBe(false);
    });

    it('solo baja SU propia ficha de vendedor, no la de sus companeros', async () => {
      const res = await pull().expect(200);
      const cuerpo = res.body as RespuestaPull;
      expect(cuerpo.catalogos.vendedores.map((v) => v.id)).toEqual([
        vendedorId,
      ]);
    });

    it('el precio llega YA RESUELTO, en centavos, con el override ganandole a la lista', async () => {
      // La lista dice 10.10 y el cliente tiene un especial de 8.00: la tablet
      // no resuelve listas en campo, recibe el precio que aplica. Ver
      // [[Lista de precios]].
      const res = await pull().expect(200);
      const cuerpo = res.body as RespuestaPull;

      const precio = cuerpo.catalogos.precios.find(
        (p) =>
          p.cliente_id === clienteId && p.presentacion_id === presentacionId,
      );
      expect(precio).toBeDefined();
      expect(precio?.precio_centavos).toBe(800);
      // Y el id es sintetico: si fuera el de la fila de origen, dos clientes de
      // la misma lista chocarian en la llave primaria de la tablet.
      expect(precio?.id).toBe(`${clienteId}:${presentacionId}`);
    });

    it('sin override, el precio sale de la lista sin perder centavos', async () => {
      // 10.10 es el caso que delata `Number(x) * 100`.
      await db
        .updateTable('cliente_precio')
        .set({ deleted_at: new Date() })
        .where('id', '=', clientePrecioId)
        .execute();
      try {
        const res = await pull().expect(200);
        const precio = (res.body as RespuestaPull).catalogos.precios.find(
          (p) =>
            p.cliente_id === clienteId && p.presentacion_id === presentacionId,
        );
        expect(precio?.precio_centavos).toBe(1010);
      } finally {
        await db
          .updateTable('cliente_precio')
          .set({ deleted_at: null })
          .where('id', '=', clientePrecioId)
          .execute();
      }
    });

    it('un `desde` ilegible es 400, no un vuelco completo silencioso', async () => {
      await pull({ desde: 'ayer por la tarde' }).expect(400);
    });

    describe('incremental', () => {
      it('con `desde` solo bajan las filas que cambiaron', async () => {
        const primero = (await pull().expect(200)).body as RespuestaPull;

        // Se usa `servidor_en` y no `cursor` A PROPOSITO: el cursor va unos
        // segundos por detras para no perder transacciones sin commit, asi que
        // reenvia de mas — y aqui hay que medir la incrementalidad, no el
        // margen de seguridad. La tablet si usa `cursor`; ver el contrato.
        const corte = primero.servidor_en;

        const vacio = (await pull({ desde: corte }).expect(200))
          .body as RespuestaPull;
        expect(vacio.completo).toBe(false);
        expect(vacio.catalogos.clientes.some((c) => c.id === clienteId)).toBe(
          false,
        );
        expect(vacio.catalogos.vehiculos.some((v) => v.id === vehiculoId)).toBe(
          false,
        );

        // Ahora se toca UNA fila.
        await db
          .updateTable('vehiculo')
          .set({ nombre: `Camioneta renombrada ${SUFIJO}` })
          .where('id', '=', vehiculoId)
          .execute();

        const despues = (await pull({ desde: corte }).expect(200))
          .body as RespuestaPull;
        const vehiculo = despues.catalogos.vehiculos.find(
          (v) => v.id === vehiculoId,
        );
        expect(vehiculo?.nombre).toBe(`Camioneta renombrada ${SUFIJO}`);
        // Y lo que no se toco sigue sin bajar.
        expect(despues.catalogos.clientes.some((c) => c.id === clienteId)).toBe(
          false,
        );
      });

      it('el cursor va por detras del reloj del servidor, a proposito', async () => {
        // Es lo que evita perder una transaccion que fijo su updated_at pero
        // aun no habia hecho commit al leer. Si alguien "arreglara" esto
        // igualandolos, esta prueba lo detiene.
        const cuerpo = (await pull().expect(200)).body as RespuestaPull;
        expect(Date.parse(cuerpo.cursor)).toBeLessThan(
          Date.parse(cuerpo.servidor_en),
        );
      });

      it('una BAJA en el portal viaja como bandera `activo: 0`, no como ausencia', async () => {
        // Es la politica de purga que [[Sincronizacion offline]] dejo abierta:
        // la tablet aplica upsert (no puede borrar filas que su jornada
        // referencia), asi que si la baja llegara como ausencia, el cliente
        // dado de baja se quedaria ahi para siempre.
        const corte = ((await pull().expect(200)).body as RespuestaPull)
          .servidor_en;

        await db
          .updateTable('cliente')
          .set({ deleted_at: new Date() })
          .where('id', '=', clienteId)
          .execute();

        try {
          const res = (await pull({ desde: corte }).expect(200))
            .body as RespuestaPull;
          const cliente = res.catalogos.clientes.find(
            (c) => c.id === clienteId,
          );
          expect(cliente).toBeDefined();
          expect(cliente?.activo).toBe(0);
        } finally {
          await db
            .updateTable('cliente')
            .set({ deleted_at: null })
            .where('id', '=', clienteId)
            .execute();
        }
      });

      it('desactivar un vehiculo tambien viaja como bandera', async () => {
        const corte = ((await pull().expect(200)).body as RespuestaPull)
          .servidor_en;
        await db
          .updateTable('vehiculo')
          .set({ activo: false })
          .where('id', '=', vehiculoId)
          .execute();
        try {
          const res = (await pull({ desde: corte }).expect(200))
            .body as RespuestaPull;
          expect(
            res.catalogos.vehiculos.find((v) => v.id === vehiculoId)?.activo,
          ).toBe(0);
        } finally {
          await db
            .updateTable('vehiculo')
            .set({ activo: true })
            .where('id', '=', vehiculoId)
            .execute();
        }
      });
    });

    describe('alcance', () => {
      it('pedir su propia sucursal por su codigo es correcto', async () => {
        const res = await pull({ sucursal: sucursalCodigo }).expect(200);
        expect((res.body as RespuestaPull).sucursal.codigo).toBe(
          sucursalCodigo,
        );
      });

      it('pedir OTRA sucursal responde 403', async () => {
        const res = await pull({ sucursal: sucursalAjenaCodigo }).expect(403);
        expect((res.body as RespuestaError).message).toBe(
          'No tienes acceso a esa sucursal.',
        );
      });

      it('pedir "todas" devuelve la suya, no un error', async () => {
        // No nombra una sucursal ajena, asi que no es escalada: es el selector
        // que quedo puesto. Mismo criterio que T-09.
        const res = await pull({ sucursal: 'todas' }).expect(200);
        expect((res.body as RespuestaPull).sucursal.codigo).toBe(
          sucursalCodigo,
        );
      });
    });
  });

  /* ================================================================ */
  /* Precios para vender (T-16)                                       */
  /* ================================================================ */

  /**
   * `presentacionesConPrecio` es con lo que el servidor decide si una venta de
   * la tablet se puede aplicar. Tiene que dar **el mismo precio que baja en el
   * pull**: si no, la tablet cobraria con un precio que el servidor no reconoce
   * y la venta se rechazaria con `precio-no-asignado` sin que nadie se hubiera
   * equivocado.
   *
   * Se compara solo contra las presentaciones de este archivo: otros e2e
   * escriben precios de la misma lista en paralelo, y comparar el catalogo
   * entero volveria la prueba intermitente.
   */
  describe('precios para vender (T-16)', () => {
    let precios: PreciosRepository;

    beforeAll(() => {
      precios = app.get(PreciosRepository);
    });

    /** Los precios de `clienteId` que baja el pull, por presentacion. */
    const preciosDelPull = async () => {
      const cuerpo = (await pull().expect(200)).body as RespuestaPull;
      return new Map<string, number>(
        cuerpo.catalogos.precios
          .filter((p) => p.cliente_id === clienteId)
          .map((p): [string, number] => [p.presentacion_id, p.precio_centavos]),
      );
    };

    it('el override del cliente gana, igual que en el pull', async () => {
      const paraVender = await precios.presentacionesConPrecio(
        clienteId,
        hoyEnTijuana(),
        db,
      );
      expect(paraVender.get(presentacionId)).toBe(800);
      expect((await preciosDelPull()).get(presentacionId)).toBe(800);
    });

    it('sin override, sale de la lista sin perder centavos, igual que en el pull', async () => {
      await db
        .updateTable('cliente_precio')
        .set({ deleted_at: new Date() })
        .where('id', '=', clientePrecioId)
        .execute();
      try {
        const paraVender = await precios.presentacionesConPrecio(
          clienteId,
          hoyEnTijuana(),
          db,
        );
        expect(paraVender.get(presentacionId)).toBe(1010);
        expect((await preciosDelPull()).get(presentacionId)).toBe(1010);
      } finally {
        await db
          .updateTable('cliente_precio')
          .set({ deleted_at: null })
          .where('id', '=', clientePrecioId)
          .execute();
      }
    });

    it('una presentacion activa sin ningun precio se ofrece con null (se puede regalar, no vender)', async () => {
      const paraVender = await precios.presentacionesConPrecio(
        clienteId,
        hoyEnTijuana(),
        db,
      );
      expect(paraVender.has(presentacionSinPrecioId)).toBe(true);
      expect(paraVender.get(presentacionSinPrecioId)).toBeNull();
      expect((await preciosDelPull()).has(presentacionSinPrecioId)).toBe(false);
    });

    it('no ofrece una presentacion dada de baja ni la de un producto inactivo, aunque tenga precio', async () => {
      const paraVender = await precios.presentacionesConPrecio(
        clienteId,
        hoyEnTijuana(),
        db,
      );
      expect(paraVender.has(presentacionBorradaId)).toBe(false);
      expect(paraVender.has(presentacionInactivaId)).toBe(false);
    });

    it('el precio es el vigente en la fecha pedida, no el de hoy', async () => {
      // Lista desde 2026-01-01 (10.10) y override desde 2026-02-01 (8.00).
      const enero = await precios.presentacionesConPrecio(
        clienteId,
        '2026-01-15',
        db,
      );
      expect(enero.get(presentacionId)).toBe(1010);

      const antes = await precios.presentacionesConPrecio(
        clienteId,
        '2025-12-31',
        db,
      );
      expect(antes.get(presentacionId)).toBeNull();
    });

    it('lee dentro de la transaccion que le pasen (la de push)', async () => {
      const dentro = await db
        .transaction()
        .execute((trx) =>
          precios.presentacionesConPrecio(clienteId, hoyEnTijuana(), trx),
        );
      expect(dentro.get(presentacionId)).toBe(800);
    });
  });

  /* ================================================================ */
  /* PUSH                                                             */
  /* ================================================================ */

  describe('push', () => {
    it('sube la operacion del dia y devuelve un id por operacion', async () => {
      // T-20: una cobranza ya no es un sobre generico; necesita una nota real.
      const cobro = await clienteConNotas([
        { monto: '300.00', fecha: '2026-08-02' },
      ]);
      const ops = [
        operacion({
          tipo: 'jornada',
          datos: { km_inicial: 100, km_final: 240 },
        }),
        // T-16: una venta ya no es un sobre generico; necesita datos validos.
        ventaValida(),
        cobranzaValida(cobro.clienteId, cobro.notas[0], {
          monto_centavos: 15000,
        }),
        operacion({
          tipo: 'gasto',
          datos: { concepto: 'hielo', monto_centavos: 5000 },
        }),
        operacion({ tipo: 'merma', datos: { piezas: 3 } }),
        operacion({ tipo: 'ruta', datos: { visitas: [] } }),
      ];

      const res = await push({ operaciones: ops }).expect(200);
      const cuerpo = res.body as RespuestaPush;

      expect(cuerpo.resumen).toEqual({
        recibidas: 6,
        aplicadas: 6,
        duplicadas: 0,
        rechazadas: 0,
      });
      expect(cuerpo.resultados).toHaveLength(6);
      for (const r of cuerpo.resultados) {
        expect(r.estado).toBe('aplicada');
        expect(r.id_servidor).toBeTruthy();
      }
    });

    describe('idempotencia', () => {
      it('reenviar EL MISMO lote no duplica nada y devuelve los mismos ids', async () => {
        // Es el caso real: la WiFi del negocio se cae a media subida y la
        // tablet reintenta. Reenviar no puede cobrar dos veces.
        const ops = [operacion(), operacion(), operacion()];

        const primero = (await push({ operaciones: ops }).expect(200))
          .body as RespuestaPush;
        expect(primero.resumen.aplicadas).toBe(3);

        const segundo = (await push({ operaciones: ops }).expect(200))
          .body as RespuestaPush;
        expect(segundo.resumen).toEqual({
          recibidas: 3,
          aplicadas: 0,
          duplicadas: 3,
          rechazadas: 0,
        });

        // Y el id devuelto es EL MISMO. Es lo que hace que, cuando T-14 emita
        // el folio al proyectar, un reenvio devuelva ese mismo folio en vez de
        // emitir uno nuevo.
        expect(segundo.resultados.map((r) => r.id_servidor)).toEqual(
          primero.resultados.map((r) => r.id_servidor),
        );

        // Y en la base hay UNA fila por clave, no dos.
        const filas = await db
          .selectFrom('sync_operacion')
          .select('id')
          .where('vendedor_id', '=', vendedorId)
          .where(
            'clave_idempotencia',
            'in',
            ops.map((o) => o.clave),
          )
          .execute();
        expect(filas).toHaveLength(3);
      });

      it('un lote parcialmente reenviado aplica solo lo nuevo', async () => {
        const vieja = operacion();
        await push({ operaciones: [vieja] }).expect(200);

        const nueva = operacion();
        const res = (await push({ operaciones: [vieja, nueva] }).expect(200))
          .body as RespuestaPush;

        expect(res.resumen).toEqual({
          recibidas: 2,
          aplicadas: 1,
          duplicadas: 1,
          rechazadas: 0,
        });
        expect(res.resultados[0].estado).toBe('duplicada');
        expect(res.resultados[1].estado).toBe('aplicada');
      });

      it('la misma clave de OTRO vendedor no colisiona', async () => {
        // El unique es (vendedor_id, clave): dos tablets no comparten espacio
        // de nombres. Si el unique fuera solo por clave, una tablet podria
        // bloquear las operaciones de otra.
        const compartida = operacion({ clave: `compartida-${SUFIJO}` });
        await push({ operaciones: [compartida] }).expect(200);

        const otro = await entrar(LOGIN_AJENO);
        const res = await request(app.getHttpServer())
          .post('/sync/push')
          .set('Authorization', `Bearer ${otro.tokenAcceso}`)
          .send({ contrato: CONTRATO_ACTUAL, operaciones: [compartida] })
          .expect(200);

        expect((res.body as RespuestaPush).resultados[0].estado).toBe(
          'aplicada',
        );
      });

      it('dos operaciones con la misma clave EN EL MISMO lote: la segunda se rechaza', async () => {
        // No es un reintento, es un bug del cliente. Llamarlo "duplicada" lo
        // escondería.
        const repetida = operacion();
        const res = (
          await push({ operaciones: [repetida, { ...repetida }] }).expect(200)
        ).body as RespuestaPush;

        expect(res.resultados[0].estado).toBe('aplicada');
        expect(res.resultados[1].estado).toBe('rechazada');
        expect(res.resultados[1].codigo).toBe('clave-repetida-en-el-lote');
      });
    });

    describe('push parcial y honesto', () => {
      it('con 3 malas de 50, entran 47 y la respuesta dice cuales fallaron y por que', async () => {
        const buenas = Array.from({ length: 47 }, () => operacion());
        const malas = [
          operacion({ tipo: 'consumo-personal' }), // tipo que este servidor no conoce
          operacion({ fecha_operacion: '2027-01-01' }), // reloj de la tablet mal puesto
          operacion({ cliente_id: clienteAjenoId }), // cliente de otra sucursal
        ];
        const lote = [
          ...buenas.slice(0, 20),
          malas[0],
          ...buenas.slice(20, 40),
          malas[1],
          ...buenas.slice(40),
          malas[2],
        ];

        const res = (await push({ operaciones: lote }).expect(200))
          .body as RespuestaPush;

        expect(res.resumen).toEqual({
          recibidas: 50,
          aplicadas: 47,
          duplicadas: 0,
          rechazadas: 3,
        });

        const rechazadas = res.resultados.filter(
          (r) => r.estado === 'rechazada',
        );
        expect(rechazadas.map((r) => r.codigo).sort()).toEqual([
          'cliente-fuera-de-alcance',
          'fecha-futura',
          'tipo-desconocido',
        ]);
        // Cada rechazo trae su motivo legible ademas del codigo.
        for (const r of rechazadas) {
          expect(r.motivo).toBeTruthy();
          expect(r.id_servidor).toBeUndefined();
        }

        // El orden de los resultados es el del lote: la tablet los empareja por
        // posicion sin tener que buscar.
        expect(res.resultados).toHaveLength(50);
        expect(res.resultados[20].codigo).toBe('tipo-desconocido');
        expect(res.resultados[49].codigo).toBe('cliente-fuera-de-alcance');

        // Y lo aplicado esta de verdad en la base.
        const guardadas = await db
          .selectFrom('sync_operacion')
          .select('id')
          .where('vendedor_id', '=', vendedorId)
          .where(
            'clave_idempotencia',
            'in',
            buenas.map((o) => o.clave),
          )
          .execute();
        expect(guardadas).toHaveLength(47);
      });

      it('una operacion RECHAZADA no consume su clave: se puede corregir y reenviar', async () => {
        // Si el rechazo dejara fila, esa fila local quedaria rechazada para
        // siempre y el vendedor no podria corregir un dato mal capturado.
        const clave = `corregible-${SUFIJO}`;
        const mala = operacion({ clave, fecha_operacion: '2027-06-01' });

        const primero = (await push({ operaciones: [mala] }).expect(200))
          .body as RespuestaPush;
        expect(primero.resultados[0].estado).toBe('rechazada');

        const corregida = operacion({ clave });
        const segundo = (await push({ operaciones: [corregida] }).expect(200))
          .body as RespuestaPush;
        expect(segundo.resultados[0].estado).toBe('aplicada');
      });

      it('un lote vacio es 400: no hay nada honesto que responder', async () => {
        await push({ operaciones: [] }).expect(400);
      });

      it('un cliente_id que no es uuid se rechaza solo, sin reventar el lote', async () => {
        // Sin la validacion de formato, ese valor llega a `where id in (...)` y
        // Postgres tumba la peticion entera con "invalid input syntax for type
        // uuid" -> 500 para las 3 operaciones. Y la tablet traduce un 5xx a
        // "sin red", asi que reintentaria ese lote para siempre, en silencio.
        const buena1 = operacion();
        const corrupta = operacion({
          tipo: 'venta',
          cliente_id: 'no-soy-uuid',
        });
        // `corrupta` no cambia: el uuid se rechaza antes de mirar `datos`.
        const buena2 = ventaValida();

        const res = (
          await push({ operaciones: [buena1, corrupta, buena2] }).expect(200)
        ).body as RespuestaPush;

        expect(res.resumen).toEqual({
          recibidas: 3,
          aplicadas: 2,
          duplicadas: 0,
          rechazadas: 1,
        });
        expect(res.resultados[1].codigo).toBe('cliente-fuera-de-alcance');
        expect(res.resultados[0].estado).toBe('aplicada');
        expect(res.resultados[2].estado).toBe('aplicada');
      });

      it('una operacion ilegible se rechaza sola, sin tumbar el lote', async () => {
        const res = (
          await push({
            operaciones: ['no soy una operacion', operacion()],
          }).expect(200)
        ).body as RespuestaPush;
        expect(res.resultados[0].estado).toBe('rechazada');
        expect(res.resultados[0].codigo).toBe('datos-invalidos');
        expect(res.resultados[1].estado).toBe('aplicada');
      });
    });

    describe('alcance', () => {
      it('atribuir una operacion a OTRO vendedor responde 403 y no guarda nada', async () => {
        const buena = operacion();
        const ajena = operacion({ vendedor_id: vendedorAjenoId });

        const res = await push({ operaciones: [buena, ajena] }).expect(403);
        expect((res.body as RespuestaError).message).toBe(
          'No puedes sincronizar operaciones de otro vendedor.',
        );

        // Ni siquiera la buena entro: el lote se valida entero antes de escribir.
        const filas = await db
          .selectFrom('sync_operacion')
          .select('id')
          .where('vendedor_id', '=', vendedorId)
          .where('clave_idempotencia', '=', buena.clave)
          .execute();
        expect(filas).toHaveLength(0);
      });

      it('empujar contra OTRA sucursal responde 403', async () => {
        await push({
          sucursal: sucursalAjenaCodigo,
          operaciones: [operacion()],
        }).expect(403);
      });

      it('una operacion sobre un cliente de otra sucursal se rechaza (no es 403)', async () => {
        // Es un snapshot viejo, no un ataque: el portal pudo mover o dar de
        // baja al cliente mientras el vendedor estaba en ruta.
        const res = (await push({
          operaciones: [ventaValida({ cliente_id: clienteAjenoId })],
        }).expect(200)) as { body: RespuestaPush };
        expect(res.body.resultados[0].codigo).toBe('cliente-fuera-de-alcance');
      });

      it('la operacion se guarda a nombre del vendedor del TOKEN, no del cuerpo', async () => {
        const op = operacion();
        await push({ operaciones: [op] }).expect(200);

        const fila = await db
          .selectFrom('sync_operacion')
          .select(['vendedor_id', 'sucursal_id', 'tipo', 'contrato'])
          .where('clave_idempotencia', '=', op.clave)
          .where('vendedor_id', '=', vendedorId)
          .executeTakeFirstOrThrow();

        expect(fila.vendedor_id).toBe(vendedorId);
        expect(fila.sucursal_id).toBe(sucursalId);
        expect(fila.contrato).toBe(CONTRATO_ACTUAL);
      });
    });

    it('guarda el dia de trabajo tal cual lo mando la tablet, sin re-derivarlo de UTC', async () => {
      // 2026-08-08T01:00Z son las 18:00 del dia 7 en Tijuana. El dia de trabajo
      // es el 7; derivarlo del instante en UTC daria el 8 y partiria la jornada.
      const op = operacion({
        fecha_operacion: '2026-08-07',
        ocurrido_en: '2026-08-08T01:00:00.000Z',
      });
      await push({ operaciones: [op] }).expect(200);

      const fila = await db
        .selectFrom('sync_operacion')
        .select(['fecha_operacion', 'ocurrido_en'])
        .where('vendedor_id', '=', vendedorId)
        .where('clave_idempotencia', '=', op.clave)
        .executeTakeFirstOrThrow();

      const fecha =
        fila.fecha_operacion instanceof Date
          ? `${fila.fecha_operacion.getFullYear()}-${String(fila.fecha_operacion.getMonth() + 1).padStart(2, '0')}-${String(fila.fecha_operacion.getDate()).padStart(2, '0')}`
          : String(fila.fecha_operacion).slice(0, 10);
      expect(fecha).toBe('2026-08-07');
      expect(new Date(fila.ocurrido_en).toISOString()).toBe(
        '2026-08-08T01:00:00.000Z',
      );
    });
  });
  /* ================================================================ */
  /* Ventas (T-16): la base de ADR-0009 en el push                    */
  /* ================================================================ */

  describe('ventas (T-16)', () => {
    it('una venta valida entra a venta_nota con su detalle, y el buzon dice a que fila se convirtio', async () => {
      const op = ventaValida();
      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0].estado).toBe('aplicada');

      const [venta] = await ventasConFolio(op.folio as string);
      expect(venta).toMatchObject({
        cliente_id: clienteId,
        vendedor_id: vendedorId,
        sucursal_id: sucursalId,
        monto_total: '192.00',
        num_nota: '2346',
        contado_credito: 'credito',
        factura: 'N/A',
        comentarios: null,
        semana: 32,
        mes: 8,
        status: 'pendiente',
        pct_comision: '3.50',
      });
      expect(fechaTexto(venta.fecha)).toBe(FECHA_VENTAS);

      const detalle = await db
        .selectFrom('venta_nota_detalle')
        .select(['presentacion_id', 'cantidad', 'cantidad_promocion', 'precio'])
        .where('venta_nota_id', '=', venta.id)
        .execute();
      expect(detalle).toEqual([
        {
          presentacion_id: presentacionId,
          cantidad: 24,
          cantidad_promocion: 2,
          precio: '8.00',
        },
      ]);

      // Trazabilidad (enmienda a ADR-0009 §2.4): el buzon apunta a la venta.
      expect(await buzonDe(op.clave)).toEqual({
        id: res.resultados[0].id_servidor,
        entidad_tabla: 'venta_nota',
        entidad_id: venta.id,
      });
    });

    it('una venta que el dominio rechaza no deja fila ni en el buzon ni en venta_nota', async () => {
      const op = ventaValida({
        datos: datosVenta({
          lineas: [
            {
              presentacion_id: presentacionInactivaId,
              cantidad: 5,
              cantidad_promocion: 0,
              precio_centavos: 900,
            },
          ],
        }),
      });
      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;

      expect(res.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'presentacion-inactiva',
      });
      expect(res.resultados[0].id_servidor).toBeUndefined();
      // Contrato §7: rechazada no deja fila, para que se pueda corregir y reenviar.
      expect(await buzonDe(op.clave)).toBeUndefined();
      expect(await ventasConFolio(op.folio as string)).toHaveLength(0);
    });

    it('una venta con datos invalidos es datos-invalidos, nombra el campo y no deja fila', async () => {
      const op = ventaValida({ datos: datosVenta({ num_nota: '   ' }) });
      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;

      expect(res.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'datos-invalidos',
      });
      expect(res.resultados[0].motivo).toContain('num_nota');
      expect(await buzonDe(op.clave)).toBeUndefined();
    });

    it('una colision de folio se clasifica fuera de la transaccion y el resto del lote sigue entrando', async () => {
      // El 23505 aborta la transaccion entera de Postgres. Si la clasificacion
      // consultara con esa misma transaccion, esto seria un 500 para todo el
      // lote en vez de un rechazo de UNA operacion (D10).
      const folio = formarFolio(
        sucursalCodigo,
        FECHA_VENTAS,
        segmento,
        siguienteConsecutivo(),
      );
      const primera = ventaValida({ folio });
      const choca = ventaValida({ folio });
      const despues = operacion();

      const res = (
        await push({ operaciones: [primera, choca, despues] }).expect(200)
      ).body as RespuestaPush;

      expect(res.resultados.map((r) => r.estado)).toEqual([
        'aplicada',
        'rechazada',
        'aplicada',
      ]);
      expect(res.resultados[1].codigo).toBe('folio-duplicado');
      expect(await buzonDe(choca.clave)).toBeUndefined();
      expect(await ventasConFolio(folio)).toHaveLength(1);
    });
  });

  describe('ventas (T-16): reglas del dominio de punta a punta', () => {
    let prospectoId: string;
    // T-16: segunda presentacion vendible, con su propio precio de lista, para
    // poder armar una venta con dos lineas VENDIDAS a distinto precio (la
    // unica otra presentacion vendible del archivo es `presentacionId`, y una
    // venta no puede repetir presentacion en dos lineas).
    let presentacion2Id: string;
    let precio2Id: string;
    let listaId: string;

    beforeAll(async () => {
      const lista = await db
        .selectFrom('lista_precio')
        .select('id')
        .where('nombre', '=', 'Lista 1')
        .executeTakeFirstOrThrow();
      listaId = lista.id;

      prospectoId = (
        await db
          .insertInto('cliente')
          .values({
            nombre: `Prospecto sync ${SUFIJO}`,
            domicilio: 'Av. Reforma 9',
            telefono: '6647654321',
            tipo: 'prospecto',
            lista_precio_id: lista.id,
            sucursal_id: sucursalId,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;

      presentacion2Id = (
        await db
          .insertInto('presentacion')
          .values({ producto_id: productoId, volumen: '3 L' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;

      precio2Id = (
        await db
          .insertInto('precio')
          .values({
            presentacion_id: presentacion2Id,
            lista_precio_id: lista.id,
            sucursal_id: sucursalId,
            precio: '20.00',
            vigente_desde: '2026-01-01',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    });

    afterAll(async () => {
      // Corre antes que el afterAll de arriba. La venta del prospecto le tiene
      // llave foranea al cliente, que se borra aqui: primero detalle, luego
      // cabecera, luego cliente. T-20: y los cobros de esas notas antes que
      // ellas, por si una venta de contado al prospecto dejo el suyo.
      await db
        .deleteFrom('cobranza_abono')
        .where(
          'venta_nota_id',
          'in',
          db
            .selectFrom('venta_nota')
            .select('id')
            .where('cliente_id', '=', prospectoId),
        )
        .execute();
      await db
        .deleteFrom('venta_nota_detalle')
        .where(
          'venta_nota_id',
          'in',
          db
            .selectFrom('venta_nota')
            .select('id')
            .where('cliente_id', '=', prospectoId),
        )
        .execute();
      await db
        .deleteFrom('venta_nota')
        .where('cliente_id', '=', prospectoId)
        .execute();
      await db.deleteFrom('cliente').where('id', '=', prospectoId).execute();

      // El detalle de `presentacion2Id` es de una venta de `clienteId`: la
      // cabecera la limpia el afterAll de mas arriba (por `vendedor_id`), pero
      // esta fila tiene que irse antes para no dejar la llave foranea colgada.
      await db
        .deleteFrom('venta_nota_detalle')
        .where('presentacion_id', '=', presentacion2Id)
        .execute();
      await db.deleteFrom('precio').where('id', '=', precio2Id).execute();
      await db
        .deleteFrom('presentacion')
        .where('id', '=', presentacion2Id)
        .execute();
    });

    const detalleDe = (ventaNotaId: string) =>
      db
        .selectFrom('venta_nota_detalle')
        .select(['presentacion_id', 'cantidad', 'cantidad_promocion', 'precio'])
        .where('venta_nota_id', '=', ventaNotaId)
        .execute();

    it('reenviar una venta devuelve duplicada con el mismo id y no crea una segunda venta', async () => {
      const op = ventaValida();
      const primero = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      const segundo = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;

      expect(primero.resultados[0].estado).toBe('aplicada');
      expect(segundo.resultados[0]).toMatchObject({
        estado: 'duplicada',
        id_servidor: primero.resultados[0].id_servidor,
      });

      const ventas = await ventasConFolio(op.folio as string);
      expect(ventas).toHaveLength(1);
      expect(await detalleDe(ventas[0].id)).toHaveLength(1);
    });

    it('una linea con cantidad y sin precio para el cliente es precio-no-asignado y no deja fila', async () => {
      const op = ventaValida({
        datos: datosVenta({
          lineas: [
            {
              presentacion_id: presentacionSinPrecioId,
              cantidad: 3,
              cantidad_promocion: 0,
              precio_centavos: 500,
            },
          ],
        }),
      });
      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;

      expect(res.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'precio-no-asignado',
      });
      expect(await buzonDe(op.clave)).toBeUndefined();
      expect(await ventasConFolio(op.folio as string)).toHaveLength(0);
    });

    /**
     * La promesa del rechazo: "asignalo en el portal y vuelve a sincronizar".
     * El portal da de alta el precio con `vigente_desde` = hoy, asi que una venta
     * de un dia anterior solo se recupera si la existencia cuenta los precios
     * asignados despues de `fecha_operacion`, hasta hoy (enmienda de D12).
     *
     * Las fechas del precio las pone Postgres (`current_date`), no Node: el
     * reloj de la maquina puede ir en otro huso y otro dia.
     */
    const conPrecioDesde = async (
      vigenteDesde: RawBuilder<string>,
      prueba: () => Promise<void>,
    ) => {
      const { id } = await db
        .insertInto('precio')
        .values({
          presentacion_id: presentacionSinPrecioId,
          lista_precio_id: listaId,
          sucursal_id: sucursalId,
          precio: '7.00',
          vigente_desde: vigenteDesde,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      try {
        await prueba();
      } finally {
        // El detalle de una venta aplicada lo limpia el afterAll de arriba (por
        // vendedor); el precio tiene que irse ya: otras pruebas cuentan con que
        // esta presentacion no tenga ninguno.
        await db.deleteFrom('precio').where('id', '=', id).execute();
      }
    };

    const ventaSinPrecioDeLista = () =>
      ventaValida({
        datos: datosVenta({
          lineas: [
            {
              presentacion_id: presentacionSinPrecioId,
              cantidad: 3,
              cantidad_promocion: 0,
              precio_centavos: 500,
            },
          ],
        }),
      });

    it('una venta de un dia anterior se aplica si el precio se asigno despues, hasta hoy', async () => {
      await conPrecioDesde(sql<string>`current_date`, async () => {
        const op = ventaSinPrecioDeLista();
        const res = (await push({ operaciones: [op] }).expect(200))
          .body as RespuestaPush;

        expect(res.resultados[0].estado).toBe('aplicada');
        const [venta] = await ventasConFolio(op.folio as string);
        // La fecha de la venta no se mueve: sigue siendo la de la operacion.
        expect(fechaTexto(venta.fecha as Date | string)).toBe(FECHA_VENTAS);
        // Se guarda el precio de la tablet (D2), no el 7.00 del portal.
        expect(await detalleDe(venta.id)).toEqual([
          expect.objectContaining({
            presentacion_id: presentacionSinPrecioId,
            precio: '5.00',
          }),
        ]);

        // El pull sigue resolviendo a la fecha pedida: a esa fecha no habia precio.
        const aLaFecha = await app
          .get(PreciosRepository)
          .presentacionesConPrecio(clienteId, FECHA_VENTAS, db);
        expect(aLaFecha.get(presentacionSinPrecioId)).toBeNull();
      });
    });

    it('un precio que empieza despues de hoy no cuenta: sigue siendo precio-no-asignado', async () => {
      await conPrecioDesde(sql<string>`current_date + 1`, async () => {
        const op = ventaSinPrecioDeLista();
        const res = (await push({ operaciones: [op] }).expect(200))
          .body as RespuestaPush;

        expect(res.resultados[0]).toMatchObject({
          estado: 'rechazada',
          codigo: 'precio-no-asignado',
        });
        expect(await buzonDe(op.clave)).toBeUndefined();
        expect(await ventasConFolio(op.folio as string)).toHaveLength(0);
      });
    });

    it('una presentacion borrada rechaza la venta entera, aunque las otras lineas sean buenas', async () => {
      const op = ventaValida({
        datos: datosVenta({
          lineas: [
            {
              presentacion_id: presentacionId,
              cantidad: 24,
              cantidad_promocion: 0,
              precio_centavos: 800,
            },
            {
              presentacion_id: presentacionBorradaId,
              cantidad: 2,
              cantidad_promocion: 0,
              precio_centavos: 800,
            },
          ],
        }),
      });
      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;

      expect(res.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'presentacion-inactiva',
      });
      // Ni media venta: la linea buena tampoco quedo.
      expect(await ventasConFolio(op.folio as string)).toHaveLength(0);
      expect(await buzonDe(op.clave)).toBeUndefined();
    });

    it('tras una colision con OTRA clave, el reintento legitimo de la primera sigue siendo duplicada', async () => {
      const folio = formarFolio(
        sucursalCodigo,
        FECHA_VENTAS,
        segmento,
        siguienteConsecutivo(),
      );
      const legitima = ventaValida({ folio });
      const otra = ventaValida({ folio });

      const r1 = (await push({ operaciones: [legitima] }).expect(200))
        .body as RespuestaPush;
      const r2 = (await push({ operaciones: [otra] }).expect(200))
        .body as RespuestaPush;
      const r3 = (await push({ operaciones: [legitima] }).expect(200))
        .body as RespuestaPush;

      expect(r1.resultados[0].estado).toBe('aplicada');
      expect(r2.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'folio-duplicado',
      });
      expect(r3.resultados[0]).toMatchObject({
        estado: 'duplicada',
        id_servidor: r1.resultados[0].id_servidor,
      });
      expect(await ventasConFolio(folio)).toHaveLength(1);
    });

    it('un folio que ya existe en venta_nota pero SIN operacion en el buzon tambien colisiona (venta_nota_folio_key)', async () => {
      // El caso que describe el comentario de `RESTRICCIONES_DE_FOLIO`
      // (despacho.ts): una nota que no nacio del push (T-17, el portal) deja
      // fila en `venta_nota` sin ninguna fila hermana en `sync_operacion`. El
      // 23505 de ESE unique tiene que clasificarse igual que el del buzon.
      const folio = formarFolio(
        sucursalCodigo,
        FECHA_VENTAS,
        segmento,
        siguienteConsecutivo(),
      );
      const notaAjenaAlPushId = (
        await db
          .insertInto('venta_nota')
          .values({
            folio,
            fecha: FECHA_VENTAS,
            cliente_id: clienteId,
            vendedor_id: vendedorId,
            monto_total: '50.00',
            num_nota: '9999',
            contado_credito: 'contado',
            semana: 32,
            mes: 8,
            status: 'pagada',
            sucursal_id: sucursalId,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;

      try {
        const op = ventaValida({ folio });
        const res = (await push({ operaciones: [op] }).expect(200))
          .body as RespuestaPush;

        expect(res.resultados[0]).toMatchObject({
          estado: 'rechazada',
          codigo: 'folio-duplicado',
        });
        expect(await buzonDe(op.clave)).toBeUndefined();
        expect(await ventasConFolio(folio)).toHaveLength(1);
      } finally {
        await db
          .deleteFrom('venta_nota')
          .where('id', '=', notaAjenaAlPushId)
          .execute();
      }
    });

    it('regalar piezas a un prospecto sin lista de precios entra como promocion de $0 (D13)', async () => {
      const op = ventaValida({
        cliente_id: prospectoId,
        datos: datosVenta({
          contado_credito: 'contado',
          lineas: [
            {
              presentacion_id: presentacionSinPrecioId,
              cantidad: 0,
              cantidad_promocion: 3,
              precio_centavos: 0,
            },
          ],
        }),
      });
      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0].estado).toBe('aplicada');

      const [venta] = await ventasConFolio(op.folio as string);
      expect(venta).toMatchObject({
        cliente_id: prospectoId,
        monto_total: '0.00',
        status: 'promocion',
        pct_comision: null,
      });
      expect(await detalleDe(venta.id)).toEqual([
        {
          presentacion_id: presentacionSinPrecioId,
          cantidad: 0,
          cantidad_promocion: 3,
          precio: '0.00',
        },
      ]);
    });

    it('una venta de contado nace pagada', async () => {
      const op = ventaValida({
        datos: datosVenta({ contado_credito: 'contado' }),
      });
      await push({ operaciones: [op] }).expect(200);

      const [venta] = await ventasConFolio(op.folio as string);
      expect(venta).toMatchObject({ status: 'pagada', monto_total: '192.00' });

      // T-20 (D2): su cobro, distinguible de un cobro capturado.
      const cobros = await db
        .selectFrom('cobranza_abono')
        .select([
          'monto',
          'tipo',
          'saldo_pendiente',
          'metodo_pago',
          'origen',
          'folio',
          'vendedor_id',
          'fecha_pago',
          'fecha_operacion',
        ])
        .where('venta_nota_id', '=', venta.id)
        .execute();
      expect(cobros).toHaveLength(1);
      expect(cobros[0]).toMatchObject({
        monto: '192.00',
        tipo: 'cobranza',
        saldo_pendiente: '0.00',
        metodo_pago: 'efectivo',
        origen: 'venta_contado',
        folio: op.folio as string,
        vendedor_id: vendedorId,
      });
      expect(fechaTexto(cobros[0].fecha_pago)).toBe(FECHA_VENTAS);
      expect(fechaTexto(cobros[0].fecha_operacion)).toBe(FECHA_VENTAS);
    });

    it('una venta a credito no deja cobro (T-20)', async () => {
      const op = ventaValida();
      await push({ operaciones: [op] }).expect(200);

      const [venta] = await ventasConFolio(op.folio as string);
      const cobros = await db
        .selectFrom('cobranza_abono')
        .select('id')
        .where('venta_nota_id', '=', venta.id)
        .execute();
      expect(cobros).toEqual([]);
    });

    it('un lote mixto entra parcial y en orden: jornada, venta buena, venta rechazada, jornada', async () => {
      const jornada1 = operacion();
      const buena = ventaValida();
      const mala = ventaValida({
        datos: datosVenta({
          lineas: [
            {
              presentacion_id: presentacionSinPrecioId,
              cantidad: 1,
              cantidad_promocion: 0,
              precio_centavos: 100,
            },
          ],
        }),
      });
      const jornada2 = operacion();

      const res = (
        await push({ operaciones: [jornada1, buena, mala, jornada2] }).expect(
          200,
        )
      ).body as RespuestaPush;

      expect(res.resumen).toEqual({
        recibidas: 4,
        aplicadas: 3,
        duplicadas: 0,
        rechazadas: 1,
      });
      expect(res.resultados.map((r) => r.estado)).toEqual([
        'aplicada',
        'aplicada',
        'rechazada',
        'aplicada',
      ]);
      expect(res.resultados[2].codigo).toBe('precio-no-asignado');
      expect(await ventasConFolio(buena.folio as string)).toHaveLength(1);
      expect(await ventasConFolio(mala.folio as string)).toHaveLength(0);
    });

    it('la jornada sigue entrando solo al buzon, sin entidad proyectada', async () => {
      const op = operacion();
      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;

      expect(res.resultados[0].estado).toBe('aplicada');
      expect(await buzonDe(op.clave)).toMatchObject({
        entidad_tabla: null,
        entidad_id: null,
      });
    });

    it('semana y mes salen de fecha_operacion tal cual llego, no de ocurrido_en en UTC', async () => {
      // 2026-06-01T02:00Z son las 19:00 del domingo 31 de mayo en Tijuana. El dia
      // de trabajo es el 31 (semana ISO 22, mes 5); derivarlo del instante en
      // UTC daria el lunes 1 de junio (semana 23, mes 6).
      const op = ventaValida(
        { ocurrido_en: '2026-06-01T02:00:00.000Z' },
        '2026-05-31',
        1,
      );
      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0].estado).toBe('aplicada');

      const [venta] = await ventasConFolio(op.folio as string);
      expect(venta).toMatchObject({ semana: 22, mes: 5 });
      expect(fechaTexto(venta.fecha)).toBe('2026-05-31');
    });

    it('guarda el precio de la nota firmada aunque el catalogo diga otro (D2)', async () => {
      // El override del cliente es 8.00; la tablet vendio a 7.50.
      const op = ventaValida({
        datos: datosVenta({
          lineas: [
            {
              presentacion_id: presentacionId,
              cantidad: 10,
              cantidad_promocion: 0,
              precio_centavos: 750,
            },
          ],
        }),
      });
      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0].estado).toBe('aplicada');

      const [venta] = await ventasConFolio(op.folio as string);
      expect(venta.monto_total).toBe('75.00');
      expect(await detalleDe(venta.id)).toEqual([
        {
          presentacion_id: presentacionId,
          cantidad: 10,
          cantidad_promocion: 0,
          precio: '7.50',
        },
      ]);
    });

    it('varias lineas: dos vendidas a distinto precio y una de pura promocion suman el monto correcto y guardan cada renglon (D14)', async () => {
      // 10 x 10.00 + 8 x 28.00 + 0 (promocion) = 324.00. La cantidad_promocion
      // de la tercera linea NO suma al monto (reglas-venta.ts).
      const op = ventaValida({
        datos: datosVenta({
          lineas: [
            {
              presentacion_id: presentacionId,
              cantidad: 10,
              cantidad_promocion: 0,
              precio_centavos: 1000,
            },
            {
              presentacion_id: presentacion2Id,
              cantidad: 8,
              cantidad_promocion: 0,
              precio_centavos: 2800,
            },
            {
              presentacion_id: presentacionSinPrecioId,
              cantidad: 0,
              cantidad_promocion: 4,
              precio_centavos: 0,
            },
          ],
        }),
      });
      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0].estado).toBe('aplicada');

      const [venta] = await ventasConFolio(op.folio as string);
      expect(venta.monto_total).toBe('324.00');

      const detalle = await detalleDe(venta.id);
      expect(detalle).toHaveLength(3);
      const porPresentacion = new Map(
        detalle.map((d) => [d.presentacion_id, d]),
      );
      expect(porPresentacion.get(presentacionId)).toMatchObject({
        cantidad: 10,
        cantidad_promocion: 0,
        precio: '10.00',
      });
      expect(porPresentacion.get(presentacion2Id)).toMatchObject({
        cantidad: 8,
        cantidad_promocion: 0,
        precio: '28.00',
      });
      expect(porPresentacion.get(presentacionSinPrecioId)).toMatchObject({
        cantidad: 0,
        cantidad_promocion: 4,
        precio: '0.00',
      });
    });

    it('guarda la factura pendiente y los comentarios recortados', async () => {
      const op = ventaValida({
        datos: datosVenta({
          factura: 'pendiente',
          comentarios: '  Entregar en la bodega de atras  ',
        }),
      });
      await push({ operaciones: [op] }).expect(200);

      const [venta] = await ventasConFolio(op.folio as string);
      expect(venta).toMatchObject({
        factura: 'pendiente',
        comentarios: 'Entregar en la bodega de atras',
      });
    });
  });

  /* ================================================================ */
  /* Cobranzas (T-20): la cobranza entra por el despachador            */
  /* ================================================================ */

  describe('cobranzas (T-20)', () => {
    it('una cobranza valida entra a cobranza_abono y el buzon apunta a la fila', async () => {
      const { clienteId: cli, notas } = await clienteConNotas([
        { monto: '250.00', fecha: '2026-08-02' },
      ]);
      const op = cobranzaValida(cli, notas[0], { fecha_pago: '2026-08-05' });

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0].estado).toBe('aplicada');

      const abonos = await abonosDe(notas[0]);
      expect(abonos).toHaveLength(1);
      expect(abonos[0]).toMatchObject({
        monto: '50.00',
        tipo: 'abono',
        saldo_pendiente: '200.00',
        metodo_pago: 'efectivo',
        origen: 'cobro',
        folio: op.folio as string,
        vendedor_id: vendedorId,
      });
      expect(fechaTexto(abonos[0].fecha_pago)).toBe('2026-08-05');
      expect(fechaTexto(abonos[0].fecha_operacion)).toBe(FECHA_COBROS);
      expect(await statusDe(notas[0])).toBe('abonado');

      expect(await buzonDe(op.clave)).toEqual({
        id: res.resultados[0].id_servidor,
        entidad_tabla: 'cobranza_abono',
        entidad_id: abonos[0].id,
      });
    });

    it('reenviar la misma cobranza es duplicada y no cobra dos veces', async () => {
      const { clienteId: cli, notas } = await clienteConNotas([
        { monto: '250.00', fecha: '2026-08-02' },
      ]);
      const op = cobranzaValida(cli, notas[0]);

      const primero = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      const segundo = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;

      expect(segundo.resultados[0]).toMatchObject({
        estado: 'duplicada',
        id_servidor: primero.resultados[0].id_servidor,
      });
      expect(await abonosDe(notas[0])).toHaveLength(1);
    });

    it('una nota que no existe es nota-no-encontrada y no deja fila en ningun lado', async () => {
      const { clienteId: cli } = await clienteConNotas([]);
      const op = cobranzaValida(cli, randomUUID());

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'nota-no-encontrada',
      });
      expect(await buzonDe(op.clave)).toBeUndefined();
      expect(await saldoFavorDe(cli)).toEqual([]);
    });

    it('una cobranza sin folio es datos-invalidos', async () => {
      const { clienteId: cli, notas } = await clienteConNotas([
        { monto: '250.00', fecha: '2026-08-02' },
      ]);
      const op = cobranzaValida(cli, notas[0], {}, { folio: undefined });

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'datos-invalidos',
      });
      expect(res.resultados[0].motivo).toMatch(/^folio: /);
      expect(await abonosDe(notas[0])).toEqual([]);
    });

    describe('reglas del reparto de punta a punta', () => {
      it('dos abonos seguidos: cada fila guarda la foto de su saldo y la nota queda abonado', async () => {
        const { clienteId: cli, notas } = await clienteConNotas([
          { monto: '250.00', fecha: '2026-08-02' },
        ]);
        await push({
          operaciones: [
            cobranzaValida(cli, notas[0], { monto_centavos: 10000 }),
          ],
        }).expect(200);
        await push({
          operaciones: [
            cobranzaValida(cli, notas[0], { monto_centavos: 5000 }),
          ],
        }).expect(200);

        const abonos = await abonosDe(notas[0]);
        expect(abonos.map((a) => [a.monto, a.tipo, a.saldo_pendiente])).toEqual(
          [
            ['100.00', 'abono', '150.00'],
            ['50.00', 'abono', '100.00'],
          ],
        );
        expect(await statusDe(notas[0])).toBe('abonado');
      });

      it('liquidar exacto deja la nota pagada y la fila es tipo cobranza', async () => {
        const { clienteId: cli, notas } = await clienteConNotas([
          {
            monto: '250.00',
            fecha: '2026-08-02',
            status: 'abonado',
            abonos: ['100.00'],
          },
        ]);
        const op = cobranzaValida(cli, notas[0], {
          monto_centavos: 15000,
          metodo_pago: 'transferencia',
        });
        await push({ operaciones: [op] }).expect(200);

        const abonos = await abonosDe(notas[0]);
        expect(abonos[abonos.length - 1]).toMatchObject({
          monto: '150.00',
          tipo: 'cobranza',
          saldo_pendiente: '0.00',
          metodo_pago: 'transferencia',
          folio: op.folio as string,
        });
        expect(await statusDe(notas[0])).toBe('pagada');
        expect(await saldoFavorDe(cli)).toEqual([]);
      });

      it('el excedente va a las otras notas de la mas vieja a la mas nueva, con el mismo folio (D1)', async () => {
        const { clienteId: cli, notas } = await clienteConNotas([
          { monto: '100.00', fecha: '2026-08-05' }, // la elegida
          { monto: '50.00', fecha: '2026-08-01' },
          { monto: '80.00', fecha: '2026-08-03' },
        ]);
        const [elegida, vieja, media] = notas;
        const op = cobranzaValida(cli, elegida, { monto_centavos: 20000 });
        const res = (await push({ operaciones: [op] }).expect(200))
          .body as RespuestaPush;
        expect(res.resultados[0].estado).toBe('aplicada');

        const [aElegida] = await abonosDe(elegida);
        const [aVieja] = await abonosDe(vieja);
        const [aMedia] = await abonosDe(media);
        expect([aElegida.monto, aElegida.tipo, aElegida.folio]).toEqual([
          '100.00',
          'cobranza',
          op.folio as string,
        ]);
        expect([aVieja.monto, aVieja.tipo, aVieja.folio]).toEqual([
          '50.00',
          'cobranza',
          op.folio as string,
        ]);
        expect([
          aMedia.monto,
          aMedia.tipo,
          aMedia.saldo_pendiente,
          aMedia.folio,
        ]).toEqual(['50.00', 'abono', '30.00', op.folio as string]);
        expect(await statusDe(elegida)).toBe('pagada');
        expect(await statusDe(vieja)).toBe('pagada');
        expect(await statusDe(media)).toBe('abonado');
        expect(await saldoFavorDe(cli)).toEqual([]);

        // El buzon apunta a la primera fila: la de la nota elegida.
        expect(await buzonDe(op.clave)).toMatchObject({
          entidad_tabla: 'cobranza_abono',
          entidad_id: aElegida.id,
        });
      });

      it('lo que sobra de todas las notas queda como saldo a favor del cliente', async () => {
        const { clienteId: cli, notas } = await clienteConNotas([
          { monto: '100.00', fecha: '2026-08-02' },
        ]);
        const op = cobranzaValida(cli, notas[0], { monto_centavos: 13050 });
        await push({ operaciones: [op] }).expect(200);

        expect(await statusDe(notas[0])).toBe('pagada');
        const favor = await saldoFavorDe(cli);
        expect(favor).toHaveLength(1);
        expect(favor[0]).toMatchObject({
          monto: '30.50',
          origen: 'excedente_cobro',
          folio: op.folio as string,
          vendedor_id: vendedorId,
        });
        expect(fechaTexto(favor[0].fecha_operacion)).toBe(FECHA_COBROS);
      });

      it('una nota ya pagada en el servidor no rechaza el cobro: el dinero va a las otras y a favor (D9)', async () => {
        const { clienteId: cli, notas } = await clienteConNotas([
          {
            monto: '100.00',
            fecha: '2026-08-01',
            status: 'pagada',
            abonos: ['100.00'],
          },
          { monto: '60.00', fecha: '2026-08-02' },
        ]);
        const [pagada, otra] = notas;
        const op = cobranzaValida(cli, pagada, { monto_centavos: 10000 });
        const res = (await push({ operaciones: [op] }).expect(200))
          .body as RespuestaPush;
        expect(res.resultados[0].estado).toBe('aplicada');

        expect(await abonosDe(pagada)).toHaveLength(1); // solo el abono previo
        const [aOtra] = await abonosDe(otra);
        expect([aOtra.monto, aOtra.tipo]).toEqual(['60.00', 'cobranza']);
        expect(await statusDe(otra)).toBe('pagada');
        expect((await saldoFavorDe(cli)).map((f) => f.monto)).toEqual([
          '40.00',
        ]);
        expect(await buzonDe(op.clave)).toMatchObject({
          entidad_tabla: 'cobranza_abono',
          entidad_id: aOtra.id,
        });
      });

      it('si no hay nota que reciba dinero, el buzon apunta al movimiento de saldo a favor', async () => {
        const { clienteId: cli, notas } = await clienteConNotas([
          {
            monto: '100.00',
            fecha: '2026-08-01',
            status: 'pagada',
            abonos: ['100.00'],
          },
        ]);
        const op = cobranzaValida(cli, notas[0], { monto_centavos: 5000 });
        await push({ operaciones: [op] }).expect(200);

        const favor = await saldoFavorDe(cli);
        expect(favor.map((f) => f.monto)).toEqual(['50.00']);
        expect(await buzonDe(op.clave)).toMatchObject({
          entidad_tabla: 'saldo_favor_movimiento',
          entidad_id: favor[0].id,
        });
      });

      it('una nota de otra sucursal es nota-no-encontrada y no deja fila', async () => {
        const { clienteId: cli } = await clienteConNotas([]);
        const notaAjena = (
          await db
            .insertInto('venta_nota')
            .values({
              folio: `EA${SUFIJO}`.slice(0, 20),
              fecha: '2026-08-02',
              cliente_id: clienteAjenoId,
              vendedor_id: vendedorAjenoId,
              monto_total: '90.00',
              num_nota: '901',
              contado_credito: 'credito',
              semana: 32,
              mes: 8,
              status: 'pendiente',
              sucursal_id: sucursalAjenaId,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;

        const op = cobranzaValida(cli, notaAjena);
        const res = (await push({ operaciones: [op] }).expect(200))
          .body as RespuestaPush;
        expect(res.resultados[0]).toMatchObject({
          estado: 'rechazada',
          codigo: 'nota-no-encontrada',
        });
        expect(await buzonDe(op.clave)).toBeUndefined();
        expect(await abonosDe(notaAjena)).toEqual([]);
        expect(await statusDe(notaAjena)).toBe('pendiente');
      });

      it('una nota de otro cliente de la misma sucursal es nota-no-encontrada', async () => {
        const uno = await clienteConNotas([]);
        const otro = await clienteConNotas([
          { monto: '90.00', fecha: '2026-08-02' },
        ]);

        const op = cobranzaValida(uno.clienteId, otro.notas[0]);
        const res = (await push({ operaciones: [op] }).expect(200))
          .body as RespuestaPush;
        expect(res.resultados[0]).toMatchObject({
          estado: 'rechazada',
          codigo: 'nota-no-encontrada',
        });
        expect(await buzonDe(op.clave)).toBeUndefined();
        expect(await abonosDe(otro.notas[0])).toEqual([]);
      });

      it('una fecha de pago posterior a la fecha de operacion es datos-invalidos', async () => {
        const { clienteId: cli, notas } = await clienteConNotas([
          { monto: '90.00', fecha: '2026-08-02' },
        ]);
        const op = cobranzaValida(cli, notas[0], { fecha_pago: '2026-08-10' });
        const res = (await push({ operaciones: [op] }).expect(200))
          .body as RespuestaPush;
        expect(res.resultados[0]).toMatchObject({
          estado: 'rechazada',
          codigo: 'datos-invalidos',
        });
        expect(res.resultados[0].motivo).toMatch(/^fecha_pago: /);
      });

      it('una cobranza sobre una venta que subio en un lote anterior se aplica', async () => {
        // Es el orden real: el motor de la tablet sube por fuente, primero las
        // ventas y despues las cobranzas, en lotes distintos.
        const { clienteId: cli } = await clienteConNotas([]);
        const venta = ventaValida({ cliente_id: cli });
        await push({ operaciones: [venta] }).expect(200);
        const [nota] = await ventasConFolio(venta.folio as string);
        expect(nota.monto_total).toBe('192.00');

        const op = cobranzaValida(cli, nota.id, { monto_centavos: 19200 });
        const res = (await push({ operaciones: [op] }).expect(200))
          .body as RespuestaPush;
        expect(res.resultados[0].estado).toBe('aplicada');
        expect(await statusDe(nota.id)).toBe('pagada');
      });

      it('dos cobros simultaneos sobre la misma nota no reparten el mismo saldo (D13)', async () => {
        const { clienteId: cli, notas } = await clienteConNotas([
          { monto: '100.00', fecha: '2026-08-03' },
        ]);
        const a = cobranzaValida(cli, notas[0], { monto_centavos: 10000 });
        const b = cobranzaValida(cli, notas[0], { monto_centavos: 10000 });

        const [ra, rb] = await Promise.all([
          push({ operaciones: [a] }).expect(200),
          push({ operaciones: [b] }).expect(200),
        ]);
        expect((ra.body as RespuestaPush).resultados[0].estado).toBe(
          'aplicada',
        );
        expect((rb.body as RespuestaPush).resultados[0].estado).toBe(
          'aplicada',
        );

        // Gane quien gane el candado: una liquida la nota y la otra queda a favor.
        expect((await abonosDe(notas[0])).map((x) => x.monto)).toEqual([
          '100.00',
        ]);
        expect((await saldoFavorDe(cli)).map((f) => f.monto)).toEqual([
          '100.00',
        ]);
        expect(await statusDe(notas[0])).toBe('pagada');
      });
    });
  });

  /* ================================================================ */
  /* Pull (T-20): saldo derivado, abonos, saldo a favor               */
  /* ================================================================ */

  describe('pull (T-20)', () => {
    it('el saldo es derivado de los abonos vivos, no de la foto saldo_pendiente', async () => {
      const { notas } = await clienteConNotas([
        {
          monto: '300.00',
          fecha: '2026-08-02',
          status: 'abonado',
          abonos: ['100.00', '50.00'],
        },
      ]);
      // Un abono borrado no cuenta.
      await db
        .insertInto('cobranza_abono')
        .values({
          venta_nota_id: notas[0],
          fecha_pago: '2026-08-02',
          fecha_operacion: '2026-08-02',
          vendedor_id: vendedorId,
          monto: '25.00',
          tipo: 'abono',
          saldo_pendiente: '0.00',
          metodo_pago: 'cheque',
          deleted_at: new Date(),
        })
        .execute();

      const cuerpo = (await pull().expect(200)).body as RespuestaPull;
      const nota = cuerpo.notas_pendientes.find((n) => n.id === notas[0]);
      expect(nota).toMatchObject({
        status: 'abonado',
        monto_total_centavos: 30000,
        saldo_centavos: 15000,
        activo: 1,
      });
      expect(nota?.abonos).toEqual([
        {
          fecha_pago: '2026-08-02',
          monto_centavos: 10000,
          metodo_pago: 'efectivo',
        },
        {
          fecha_pago: '2026-08-02',
          monto_centavos: 5000,
          metodo_pago: 'efectivo',
        },
      ]);
    });

    it('el cliente baja con su saldo a favor: la suma de sus movimientos vivos', async () => {
      const { clienteId: cli } = await clienteConNotas([]);
      await db
        .insertInto('saldo_favor_movimiento')
        .values([
          {
            cliente_id: cli,
            vendedor_id: vendedorId,
            monto: '120.50',
            origen: 'excedente_cobro',
            fecha_operacion: FECHA_COBROS,
          },
          {
            cliente_id: cli,
            vendedor_id: vendedorId,
            monto: '30.00',
            origen: 'excedente_cobro',
            fecha_operacion: FECHA_COBROS,
          },
          {
            cliente_id: cli,
            vendedor_id: vendedorId,
            monto: '99.00',
            origen: 'excedente_cobro',
            fecha_operacion: FECHA_COBROS,
            deleted_at: new Date(),
          },
        ])
        .execute();

      const cuerpo = (await pull().expect(200)).body as RespuestaPull;
      const cliente = cuerpo.catalogos.clientes.find((c) => c.id === cli);
      expect(cliente?.saldo_favor_centavos).toBe(15050);
    });

    it('con desde, una nota liquidada o cancelada baja con activo 0 y un status que una tablet vieja acepta', async () => {
      const { clienteId: cli, notas } = await clienteConNotas([
        { monto: '100.00', fecha: '2026-08-03' },
        { monto: '70.00', fecha: '2026-08-04' },
      ]);
      const corte = ((await pull().expect(200)).body as RespuestaPull)
        .servidor_en;

      await push({
        operaciones: [cobranzaValida(cli, notas[0], { monto_centavos: 10000 })],
      }).expect(200);
      await db
        .updateTable('venta_nota')
        .set({ status: 'cuenta_perdida' })
        .where('id', '=', notas[1])
        .execute();

      const cuerpo = (await pull({ desde: corte }).expect(200))
        .body as RespuestaPull;
      const liquidada = cuerpo.notas_pendientes.find((n) => n.id === notas[0]);
      const perdida = cuerpo.notas_pendientes.find((n) => n.id === notas[1]);

      expect(liquidada).toMatchObject({
        activo: 0,
        status: 'abonado',
        saldo_centavos: 0,
      });
      expect(liquidada?.abonos).toEqual([
        {
          fecha_pago: FECHA_COBROS,
          monto_centavos: 10000,
          metodo_pago: 'efectivo',
        },
      ]);
      expect(perdida).toMatchObject({
        activo: 0,
        status: 'pendiente',
        saldo_centavos: 7000,
        abonos: [],
      });
    });

    it('con desde, el cliente baja cuando un cobro le deja saldo a favor', async () => {
      const { clienteId: cli, notas } = await clienteConNotas([
        { monto: '100.00', fecha: '2026-08-03' },
      ]);
      const corte = ((await pull().expect(200)).body as RespuestaPull)
        .servidor_en;

      await push({
        operaciones: [cobranzaValida(cli, notas[0], { monto_centavos: 15000 })],
      }).expect(200);

      const cuerpo = (await pull({ desde: corte }).expect(200))
        .body as RespuestaPull;
      const cliente = cuerpo.catalogos.clientes.find((c) => c.id === cli);
      expect(cliente?.saldo_favor_centavos).toBe(5000);
    });

    it('sin desde, las notas cerradas no bajan', async () => {
      const { notas } = await clienteConNotas([
        { monto: '80.00', fecha: '2026-08-03', status: 'pagada' },
      ]);
      const cuerpo = (await pull().expect(200)).body as RespuestaPull;
      expect(cuerpo.notas_pendientes.some((n) => n.id === notas[0])).toBe(
        false,
      );
    });
  });

  /* ================================================================ */
  /* Folios (T-14)                                                    */
  /* ================================================================ */

  /**
   * El folio lo emite la **tablet, offline** (ADR-0001 descarta generarlo en el
   * servidor: se escribe en la nota fisica que el cliente firma, en campo). Lo
   * que el servidor hace es **no aceptarlo en silencio**: comprueba que sea
   * coherente con la operacion y deja que un unique de la base detecte las
   * colisiones.
   */
  describe('folios', () => {
    /**
     * Una venta con folio bien emitido para este vendedor y este dia.
     *
     * Desde T-16 es una venta de verdad (`ventaValida`): con `datos` libres, el
     * servidor ya la rechazaria como `datos-invalidos` antes de mirar su folio.
     */
    const conFolio = (
      extra: Record<string, unknown> = {},
      fecha = '2026-08-07',
      consecutivo = 1,
    ) => ventaValida(extra, fecha, consecutivo);

    const filasConFolio = async (folio: string) =>
      db
        .selectFrom('sync_operacion')
        .select(['id', 'vendedor_id', 'clave_idempotencia'])
        .where('folio', '=', folio)
        .execute();

    it('el pull manda el segmento de vendedor: la tablet no lo deriva sola', async () => {
      // Es la pieza que hace posible emitir offline SIN ambiguedad. La tablet
      // solo baja su propia ficha, asi que no puede saber si comparte
      // iniciales con un companero; el servidor se lo dice.
      const res = await pull().expect(200);
      const cuerpo = res.body as RespuestaPull;

      expect(cuerpo.vendedor.folio_segmento).toBe(segmento);
      expect(cuerpo.catalogos.vendedores[0].folio_segmento).toBe(segmento);
      expect(segmento).toMatch(/^[A-Z]{2}$/);
    });

    it('acepta una operacion con folio y lo guarda tal cual', async () => {
      const op = conFolio({}, '2026-08-07', 11);
      const res = await push({ operaciones: [op] }).expect(200);

      expect((res.body as RespuestaPush).resultados[0]).toMatchObject({
        estado: 'aplicada',
      });

      const fila = await db
        .selectFrom('sync_operacion')
        .select('folio')
        .where('vendedor_id', '=', vendedorId)
        .where('clave_idempotencia', '=', op.clave)
        .executeTakeFirstOrThrow();
      expect(fila.folio).toBe(op.folio);
    });

    it('la jornada sigue subiendo SIN folio', async () => {
      // No es una nota que nadie firme: no lleva folio, y el indice unico es
      // parcial justo para que varias operaciones sin folio convivan.
      await push({ operaciones: [operacion(), operacion()] })
        .expect(200)
        .expect((r) => {
          expect((r.body as RespuestaPush).resumen.aplicadas).toBe(2);
        });
    });

    /* ---------------------------------------------------------------- */

    describe('deteccion de colision', () => {
      it('DOS TABLETS del mismo vendedor emiten el mismo folio: la segunda se rechaza', async () => {
        // El caso real: al vendedor le dan una tablet de repuesto y entra con
        // su mismo login. Cada tablet lleva su propio contador local en SQLite,
        // las dos arrancan el dia en 01 y las dos emiten el mismo folio — con
        // claves de idempotencia distintas, porque son filas locales distintas.
        //
        // Esto NO es un reintento: son dos hechos de negocio que dicen tener el
        // mismo identificador. Aceptarlo haria imposible cotejar las notas
        // fisicas para siempre.
        const folio = formarFolio(sucursalCodigo, '2026-08-07', segmento, 21);

        const primera = await push({
          operaciones: [conFolio({ folio }, '2026-08-07')],
        }).expect(200);
        expect((primera.body as RespuestaPush).resultados[0].estado).toBe(
          'aplicada',
        );

        const segunda = await push({
          operaciones: [conFolio({ folio }, '2026-08-07')],
        }).expect(200);
        expect((segunda.body as RespuestaPush).resultados[0]).toMatchObject({
          estado: 'rechazada',
          codigo: 'folio-duplicado',
        });

        // Y en la base quedo UNA sola fila con ese folio.
        expect(await filasConFolio(folio)).toHaveLength(1);
      });

      it('el rechazo por colision NO deja fila: la operacion se puede corregir y reenviar', async () => {
        // Misma doctrina que el resto de rechazos de T-07. Si la fila quedara,
        // consumiria su clave y esa operacion local quedaria rechazada para
        // siempre — el vendedor no podria mandarla con un folio corregido.
        const folio = formarFolio(sucursalCodigo, '2026-08-07', segmento, 22);
        await push({ operaciones: [conFolio({ folio })] }).expect(200);

        const rechazada = conFolio({ folio });
        await push({ operaciones: [rechazada] }).expect(200);

        const sinFila = await db
          .selectFrom('sync_operacion')
          .select('id')
          .where('vendedor_id', '=', vendedorId)
          .where('clave_idempotencia', '=', rechazada.clave)
          .executeTakeFirst();
        expect(sinFila).toBeUndefined();

        // Corregido el folio, la MISMA fila local entra.
        const corregida = {
          ...rechazada,
          folio: formarFolio(sucursalCodigo, '2026-08-07', segmento, 23),
        };
        const res = await push({ operaciones: [corregida] }).expect(200);
        expect((res.body as RespuestaPush).resultados[0].estado).toBe(
          'aplicada',
        );
      });

      it('la colision se detecta tambien dentro del mismo lote', async () => {
        const folio = formarFolio(sucursalCodigo, '2026-08-07', segmento, 24);
        const res = await push({
          operaciones: [conFolio({ folio }), conFolio({ folio })],
        }).expect(200);

        const cuerpo = res.body as RespuestaPush;
        expect(cuerpo.resultados[0].estado).toBe('aplicada');
        expect(cuerpo.resultados[1]).toMatchObject({
          estado: 'rechazada',
          codigo: 'folio-duplicado',
        });
        expect(await filasConFolio(folio)).toHaveLength(1);
      });
    });

    /* ---------------------------------------------------------------- */

    describe('la idempotencia sigue mandando por encima del folio', () => {
      it('REENVIAR el mismo lote con folio devuelve `duplicada`, NO una colision', async () => {
        // Un reenvio trae la MISMA clave y el MISMO folio, asi que choca
        // contra los dos uniques a la vez. Tiene que resolverse como
        // `duplicada` y no como colision: si se reportara como colision, los
        // reintentos normales (la WiFi que se cae a media subida) dejarian la
        // operacion en error y la tablet los repetiria para siempre.
        //
        // La clave identifica el TRANSPORTE, el folio el HECHO DE NEGOCIO
        // (T-07/ADR-0006). Mismo transporte = duplicada.
        //
        // En secuencial esto lo resuelve el `on conflict (vendedor_id,
        // clave_idempotencia) do nothing`: el indice arbitro se comprueba
        // primero y el insert ni se intenta, asi que el unique del folio nunca
        // llega a dispararse. El caso en el que si se dispara es concurrente,
        // y va en la prueba de abajo.
        const op = conFolio({}, '2026-08-07', 31);

        const primera = await push({ operaciones: [op] }).expect(200);
        const segunda = await push({ operaciones: [op] }).expect(200);
        const tercera = await push({ operaciones: [op] }).expect(200);

        const r1 = (primera.body as RespuestaPush).resultados[0];
        const r2 = (segunda.body as RespuestaPush).resultados[0];
        const r3 = (tercera.body as RespuestaPush).resultados[0];

        expect(r1.estado).toBe('aplicada');
        expect(r2.estado).toBe('duplicada');
        expect(r3.estado).toBe('duplicada');

        // Y el MISMO id de servidor las tres veces: la identidad de la
        // operacion no cambia entre intentos, que es lo que hace que reenviar
        // sea seguro de punta a punta.
        expect(r2.id_servidor).toBe(r1.id_servidor);
        expect(r3.id_servidor).toBe(r1.id_servidor);

        expect(await filasConFolio(op.folio as string)).toHaveLength(1);
      });

      it('dos reintentos SIMULTANEOS del mismo lote: uno aplica, el otro duplica', async () => {
        // La WiFi del negocio va y viene y la tablet reintenta; nada impide que
        // dos peticiones identicas se solapen en el servidor.
        //
        // Lo que esta prueba garantiza: pase lo que pase con el solape, las
        // dos peticiones convergen en UNA fila y **ninguna** se reporta como
        // colision de folio.
        //
        // Que camino toman por dentro depende de si las transacciones llegan a
        // solaparse, y eso no se puede forzar desde aqui. En la practica gana
        // el `on conflict ... do nothing`. El desempate por clave, para cuando
        // no gana, vive en `SincronizacionService.clasificarColision`
        // (`buscarPorClave` antes que `duenoDelFolio`) — rama defensiva que
        // esta prueba no puede forzar a tomar.
        //
        // A veces Postgres resuelve el choque de las dos inserciones (clave y
        // folio a la vez) con un deadlock (`40P01`) en vez de hacer esperar a
        // una. La transaccion victima se repite (`reintentarAnteConflicto`,
        // T-16) y en el reintento ya ve la fila confirmada: cae en uno de los
        // dos caminos de arriba, no en un 500.
        const op = conFolio({}, '2026-08-07', 32);

        const respuestas = await Promise.all([
          push({ operaciones: [op] }),
          push({ operaciones: [op] }),
        ]);

        const estados = respuestas.map(
          (r) => (r.body as RespuestaPush).resultados[0],
        );

        // Ninguna de las dos puede acabar como colision de folio.
        for (const r of estados) {
          expect(r.codigo).toBeUndefined();
          expect(['aplicada', 'duplicada']).toContain(r.estado);
        }

        // Y las dos apuntan a la MISMA fila del servidor.
        expect(estados[0].id_servidor).toBe(estados[1].id_servidor);
        expect(await filasConFolio(op.folio as string)).toHaveLength(1);
      });
    });

    /* ---------------------------------------------------------------- */

    describe('coherencia: el folio no puede contradecir a su operacion', () => {
      it('rechaza un folio de otra sucursal', async () => {
        // La sucursal la decide el servidor desde el token (T-09).
        const op = conFolio({
          folio: formarFolio(sucursalAjenaCodigo, '2026-08-07', segmento, 41),
        });
        const res = await push({ operaciones: [op] }).expect(200);
        expect((res.body as RespuestaPush).resultados[0]).toMatchObject({
          estado: 'rechazada',
          codigo: 'folio-invalido',
        });
      });

      it('rechaza un folio cuya fecha contradice a `fecha_operacion`', async () => {
        const op = operacion({
          tipo: 'venta',
          fecha_operacion: '2026-08-07',
          ocurrido_en: '2026-08-07T14:03:22.000-07:00',
          folio: formarFolio(sucursalCodigo, '2026-08-06', segmento, 42),
        });
        const res = await push({ operaciones: [op] }).expect(200);
        expect((res.body as RespuestaPush).resultados[0]).toMatchObject({
          estado: 'rechazada',
          codigo: 'folio-invalido',
        });
      });

      it('rechaza un folio con el segmento de OTRO vendedor', async () => {
        // Esto es lo que impide que una tablet se invente las iniciales por su
        // cuenta en vez de usar las que le mando el pull. Sin esta
        // comprobacion, la ambiguedad de iniciales volveria en silencio.
        const op = conFolio({
          folio: formarFolio(sucursalCodigo, '2026-08-07', segmentoAjeno, 43),
        });
        const res = await push({ operaciones: [op] }).expect(200);
        expect((res.body as RespuestaPush).resultados[0]).toMatchObject({
          estado: 'rechazada',
          codigo: 'folio-invalido',
        });
      });

      it.each([
        ['TJ260807AP', 'demasiado corto'],
        ['tj260807ap01', 'minusculas'],
        ['TJ261332AP01', 'una fecha que no existe'],
        ['no-es-un-folio', 'cualquier cosa'],
      ])('rechaza %p (%s)', async (folio) => {
        const res = await push({
          operaciones: [conFolio({ folio })],
        }).expect(200);
        expect((res.body as RespuestaPush).resultados[0]).toMatchObject({
          estado: 'rechazada',
          codigo: 'folio-invalido',
        });
      });

      it('un folio malo rechaza SU operacion, no el lote', async () => {
        // La promesa de T-07: 200 y detalle por operacion. Un dedazo en un
        // folio no le puede costar el dia entero al vendedor.
        const res = await push({
          operaciones: [
            operacion(),
            conFolio({ folio: 'no-es-un-folio' }),
            conFolio({}, '2026-08-07', 51),
          ],
        }).expect(200);

        const cuerpo = res.body as RespuestaPush;
        expect(cuerpo.resumen).toMatchObject({
          recibidas: 3,
          aplicadas: 2,
          rechazadas: 1,
        });
        expect(cuerpo.resultados.map((r) => r.estado)).toEqual([
          'aplicada',
          'rechazada',
          'aplicada',
        ]);
      });
    });
  });
});

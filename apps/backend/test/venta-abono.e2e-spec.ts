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
  type RespuestaPull,
  type RespuestaPush,
} from './../src/modules/sincronizacion/contrato';
import { formarFolio } from './../src/modules/sincronizacion/folio';
import { asignarSegmento } from './../src/modules/sincronizacion/segmento-vendedor';
import type { VentaDetalle } from './../src/modules/ventas-cobranza/ventas-consulta.service';

/**
 * Rediseno, pieza 2: la venta de la tablet lleva quien atendio (`atendio`) y el
 * abono al vender (`abono_centavos`). Push → proyeccion → pull → edicion y
 * borrado en el portal (Review Focus 1-3 del plan).
 *
 * Fecha 2015-07-20: ninguna otra suite vende ese dia y el folio es unico en
 * toda la base. 40 piezas a $20.10 = $804.00 (80400 centavos).
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN = `e2e-abono-v-${SUFIJO}`;
const LOGIN_GENERAL = `e2e-abono-gen-${SUFIJO}`;
const PREFIJO = `ZZ-e2e-abono-${SUFIJO}`;
const FECHA = '2015-07-20';

describe('Venta con quien atendio y abono al vender (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let vendedorId: string;
  let bearer: string;
  let productoId: string;
  let presentacionId: string;
  let clienteId: string;
  let segmento: string;
  let usuarioGeneralId: string;
  let cookieGeneral: string;
  let consecutivo = 0;

  const http = () => request(app.getHttpServer());

  const push = async (operaciones: unknown[]) => {
    const res = await http()
      .post('/sync/push')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ contrato: CONTRATO_ACTUAL, operaciones })
      .expect(200);
    return res.body as RespuestaPush;
  };

  const pull = async (desde?: string) => {
    const params = new URLSearchParams({ contrato: String(CONTRATO_ACTUAL) });
    if (desde) params.set('desde', desde);
    const res = await http()
      .get(`/sync/pull?${params.toString()}`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    return res.body as RespuestaPull;
  };

  /** Una venta de la tablet a credito por $804.00, con lo que se quiera cambiar en `datos`. */
  const venta = (datos: Record<string, unknown> = {}) => ({
    clave: randomUUID(),
    tipo: 'venta',
    cliente_id: clienteId,
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T14:03:22.000-07:00`,
    folio: formarFolio('TJ', FECHA, segmento, ++consecutivo),
    datos: {
      num_nota: null,
      contado_credito: 'credito',
      factura: 'N/A',
      comentarios: null,
      lineas: [
        {
          presentacion_id: presentacionId,
          cantidad: 40,
          cantidad_promocion: 0,
          precio_centavos: 2010,
        },
      ],
      ...datos,
    },
  });

  const notaPorFolio = (folio: string) =>
    db
      .selectFrom('venta_nota')
      .select(['id', 'status', 'monto_total', 'atendio_nombre', 'deleted_at'])
      .where('folio', '=', folio)
      .executeTakeFirst();

  const abonos = (ventaNotaId: string) =>
    db
      .selectFrom('cobranza_abono')
      .select([
        'monto',
        'tipo',
        'origen',
        'cobro_id',
        'metodo_pago',
        'saldo_pendiente',
        'vendedor_id',
        'deleted_at',
      ])
      .select((eb) =>
        eb
          .fn<string>('to_char', [eb.ref('fecha_pago'), eb.val('YYYY-MM-DD')])
          .as('fecha'),
      )
      .where('venta_nota_id', '=', ventaNotaId)
      .orderBy('created_at')
      .execute();

  const vivos = <T extends { deleted_at: Date | null }>(filas: T[]) =>
    filas.filter((f) => f.deleted_at === null);

  /** Empuja una venta abonada (30000 sobre 80400) y devuelve el id de su nota. */
  const ventaAbonada = async (extra: Record<string, unknown> = {}) => {
    const op = venta({ abono_centavos: 30000, ...extra });
    const [r] = (await push([op])).resultados;
    expect(r.estado).toBe('aplicada');
    const nota = await notaPorFolio(op.folio);
    if (!nota) throw new Error('La venta no se proyecto.');
    return nota.id;
  };

  /** El estado completo de lo editable, como lo manda el portal. */
  const editar = (id: string, cantidad: number, extra = {}) =>
    http()
      .patch(`/ventas/${id}`)
      .set('Cookie', cookieGeneral)
      .send({
        vendedorId,
        numNota: null,
        contadoCredito: 'credito',
        factura: 'N/A',
        lineas: [{ presentacionId, cantidad, cantidadPromocion: 0 }],
        ...extra,
      });

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

    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: `${PREFIJO} Jamaica` })
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
    await db
      .insertInto('precio')
      .values({
        presentacion_id: presentacionId,
        lista_precio_id: lista.id,
        sucursal_id: tjId,
        precio: '20.10',
        vigente_desde: '2015-01-01',
      })
      .execute();
    clienteId = (
      await db
        .insertInto('cliente')
        .values({
          nombre: `${PREFIJO} Abarrotes Lupita`,
          domicilio: 'Calle 1',
          telefono: '6640000000',
          tipo: 'cliente',
          lista_precio_id: lista.id,
          sucursal_id: tjId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

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
    segmento = asignarSegmento('Abono Venta', ocupados) as string;
    const passwordHash = await app.get(PasswordService).hashear(PASSWORD);
    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Abono Venta',
          password_hash: passwordHash,
          sucursal_id: tjId,
          folio_segmento: segmento,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const login = await http()
      .post('/auth/app/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);
    bearer = (login.body as { tokenAcceso: string }).tokenAcceso;

    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Administrador General')
      .executeTakeFirstOrThrow();
    usuarioGeneralId = (
      await db
        .insertInto('usuario')
        .values({
          login: LOGIN_GENERAL,
          nombre: LOGIN_GENERAL,
          password_hash: passwordHash,
          perfil_id: perfilId,
          sucursal_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const res = await http()
      .post('/auth/login')
      .send({ login: LOGIN_GENERAL, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const acceso = cookies.find((c) => c.startsWith('jawa_access='));
    if (!acceso) throw new Error('El login no devolvio cookie de acceso.');
    cookieGeneral = acceso.split(';')[0];
  });

  afterAll(async () => {
    const notas = db
      .selectFrom('venta_nota')
      .select('id')
      .where('vendedor_id', '=', vendedorId);
    await db
      .deleteFrom('venta_nota_detalle')
      .where('venta_nota_id', 'in', notas)
      .execute();
    await db
      .deleteFrom('cobranza_abono')
      .where('venta_nota_id', 'in', notas)
      .execute();
    await db
      .deleteFrom('venta_nota')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('cliente').where('id', '=', clienteId).execute();
    await db
      .deleteFrom('precio')
      .where('presentacion_id', '=', presentacionId)
      .execute();
    await db
      .deleteFrom('presentacion')
      .where('id', '=', presentacionId)
      .execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', '=', usuarioGeneralId)
      .execute();
    await db.deleteFrom('usuario').where('id', '=', usuarioGeneralId).execute();
    await app.close();
  });

  describe('push', () => {
    it('una venta sin atendio ni abono (tablet anterior) entra como hoy: pendiente y sin abono', async () => {
      const op = venta();
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      const nota = await notaPorFolio(op.folio);
      expect(nota).toMatchObject({
        status: 'pendiente',
        monto_total: '804.00',
        atendio_nombre: null,
      });
      expect(await abonos(nota?.id ?? '')).toEqual([]);
    });

    it('guarda atendio recortado y el detalle del portal lo trae', async () => {
      const op = venta({ atendio: '  Doña Lupe  ' });
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      const nota = await notaPorFolio(op.folio);
      expect(nota?.atendio_nombre).toBe('Doña Lupe');
      const d = (
        await http()
          .get(`/ventas/${nota?.id}`)
          .set('Cookie', cookieGeneral)
          .expect(200)
      ).body as VentaDetalle;
      expect(d.atendio).toBe('Doña Lupe');
    });

    it('a credito con abono: abonado, un abono venta_contado vivo por el monto, y el pull la baja con saldo', async () => {
      const id = await ventaAbonada();
      const nota = await db
        .selectFrom('venta_nota')
        .select(['status', 'monto_total'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(nota).toEqual({ status: 'abonado', monto_total: '804.00' });
      expect(await abonos(id)).toEqual([
        {
          monto: '300.00',
          tipo: 'abono',
          origen: 'venta_contado',
          cobro_id: null,
          metodo_pago: 'efectivo',
          saldo_pendiente: '504.00',
          vendedor_id: vendedorId,
          deleted_at: null,
          fecha: FECHA,
        },
      ]);

      const cuerpo = await pull();
      expect(cuerpo.notas_pendientes.find((n) => n.id === id)).toEqual(
        expect.objectContaining({
          activo: 1,
          status: 'abonado',
          monto_total_centavos: 80400,
          saldo_centavos: 50400,
          abonos: [
            {
              fecha_pago: FECHA,
              monto_centavos: 30000,
              metodo_pago: 'efectivo',
            },
          ],
        }),
      );
    });

    it.each([
      ['igual al total', { abono_centavos: 80400 }],
      ['mayor al total', { abono_centavos: 90000 }],
      ['con contado', { abono_centavos: 30000, contado_credito: 'contado' }],
      ['en cero', { abono_centavos: 0 }],
    ])('un abono %s es datos-invalidos, sin fila ni 500', async (_, extra) => {
      const op = venta(extra);
      const [r] = (await push([op])).resultados;
      expect(r).toMatchObject({
        estado: 'rechazada',
        codigo: 'datos-invalidos',
      });
      expect(r.motivo).toMatch(/^abono_centavos: /);
      expect(await notaPorFolio(op.folio)).toBeUndefined();
    });

    it('un atendio de mas de 80 caracteres es datos-invalidos', async () => {
      const op = venta({ atendio: 'x'.repeat(81) });
      const [r] = (await push([op])).resultados;
      expect(r).toMatchObject({
        estado: 'rechazada',
        codigo: 'datos-invalidos',
      });
      expect(r.motivo).toMatch(/^atendio: /);
    });
  });

  describe('portal: editar y eliminar una venta abonada (T-17)', () => {
    it('cambiar una cantidad conserva el abono y recalcula status y saldo, tambien en el pull', async () => {
      const id = await ventaAbonada();
      const corte = (await pull()).servidor_en;

      // 30 x $20.10 = $603.00; saldo 603 - 300 = 303.
      const d = (await editar(id, 30).expect(200)).body as VentaDetalle;
      expect(d).toMatchObject({
        montoCentavos: 60300,
        status: 'abonado',
        saldoCentavos: 30300,
        editable: true,
      });
      const vivosTras = vivos(await abonos(id));
      expect(vivosTras).toEqual([
        expect.objectContaining({
          monto: '300.00',
          tipo: 'abono',
          origen: 'venta_contado',
          cobro_id: null,
          metodo_pago: 'efectivo',
          saldo_pendiente: '303.00',
          fecha: FECHA,
        }),
      ]);

      const cuerpo = await pull(corte);
      expect(cuerpo.notas_pendientes.find((n) => n.id === id)).toEqual(
        expect.objectContaining({
          activo: 1,
          status: 'abonado',
          saldo_centavos: 30300,
          abonos: [
            {
              fecha_pago: FECHA,
              monto_centavos: 30000,
              metodo_pago: 'efectivo',
            },
          ],
        }),
      );
    });

    it('un total nuevo menor o igual al abono es 409 y no cambia nada', async () => {
      const id = await ventaAbonada();
      // 10 x $20.10 = $201.00 < $300.00 de abono.
      const res = await editar(id, 10).expect(409);
      expect((res.body as { message: string }).message).toMatch(/abono/);
      const nota = await db
        .selectFrom('venta_nota')
        .select(['status', 'monto_total'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(nota).toEqual({ status: 'abonado', monto_total: '804.00' });
      expect(vivos(await abonos(id))).toHaveLength(1);
    });

    it('pasarla a contado reemplaza el abono por el cobro de contado del total', async () => {
      const id = await ventaAbonada();
      const d = (
        await editar(id, 40, { contadoCredito: 'contado' }).expect(200)
      ).body as VentaDetalle;
      expect(d).toMatchObject({ status: 'pagada', saldoCentavos: 0 });
      expect(vivos(await abonos(id))).toEqual([
        expect.objectContaining({
          monto: '804.00',
          tipo: 'cobranza',
          origen: 'venta_contado',
          metodo_pago: 'efectivo',
        }),
      ]);
    });

    it('eliminarla da de baja el abono y el pull la saca de la tablet', async () => {
      const id = await ventaAbonada();
      const corte = (await pull()).servidor_en;
      await http()
        .delete(`/ventas/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(200);
      expect(vivos(await abonos(id))).toEqual([]);
      expect(await abonos(id)).toHaveLength(1);
      const cuerpo = await pull(corte);
      expect(cuerpo.notas_pendientes.find((n) => n.id === id)).toMatchObject({
        activo: 0,
      });
    });
  });
});

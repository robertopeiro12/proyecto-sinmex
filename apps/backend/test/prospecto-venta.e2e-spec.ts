import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
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
  type RespuestaPush,
} from './../src/modules/sincronizacion/contrato';
import { formarFolio } from './../src/modules/sincronizacion/folio';
import { asignarSegmento } from './../src/modules/sincronizacion/segmento-vendedor';

/**
 * T-75 (D3, D4): el prospecto se captura y se le vende sin red; al subir, el
 * alta va en un lote y la venta de bienvenida (solo regalo) en otro, porque el
 * alcance de los clientes se comprueba UNA vez por lote. Fija:
 *
 * 1. Lote 1 `prospecto` (clave = id) → aplicada; lote 2 `venta` a ese id con
 *    una linea de 0 vendidas y N regaladas → aplicada, nota en $0,
 *    `cliente.primera_venta_en` puesto.
 * 2. Las dos en el MISMO lote → la venta cae `cliente-fuera-de-alcance` y el
 *    alta entra; el reenvio de la venta sola entra (D4: se reintenta).
 * 3. Un alta rechazada (tipo de negocio de baja) + su venta → las dos
 *    rechazadas; corregida el alta, el reenvio de ambas (en dos lotes) entra.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN = `e2e-pvta-${SUFIJO}`;
const PASSWORD = 'contrasena-del-vendedor';
const PREFIJO = `ZZ-pvta-${SUFIJO}`;
const FECHA = '2026-10-15';

describe('Prospecto y venta de bienvenida en dos lotes (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;

  let sucursalCodigo: string;
  let vendedorId: string;
  let segmento: string;
  let tipoNegocioId: string;
  let tipoNegocioBorradoId: string;
  let productoId: string;
  let presentacionId: string;
  let bearer: string;
  let consecutivo = 0;

  const push = async (cuerpo: Record<string, unknown>) => {
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ contrato: CONTRATO_ACTUAL, ...cuerpo })
      .expect(200);
    return res.body as RespuestaPush;
  };

  const altaProspecto = (extra: Record<string, unknown> = {}) => ({
    clave: randomUUID(),
    tipo: 'prospecto',
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T18:03:22.000Z`,
    datos: {
      nombre: `${PREFIJO} Bienvenida ${Math.random().toString(36).slice(2)}`,
      telefono: '6641112233',
      encargado: 'Don Aaron',
      tipo_negocio_id: tipoNegocioId,
      comentarios: null,
      lat: null,
      lng: null,
      foto: null,
    },
    ...extra,
  });

  /** Venta de solo regalo (bienvenida): 0 vendidas, 2 regaladas, a $0. */
  const ventaRegalo = (clienteId: string) => ({
    clave: randomUUID(),
    tipo: 'venta',
    cliente_id: clienteId,
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T18:10:00.000Z`,
    folio: formarFolio(sucursalCodigo, FECHA, segmento, ++consecutivo),
    datos: {
      num_nota: null,
      contado_credito: 'contado',
      factura: 'N/A',
      comentarios: null,
      lineas: [
        {
          presentacion_id: presentacionId,
          cantidad: 0,
          cantidad_promocion: 2,
          precio_centavos: 0,
        },
      ],
    },
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    const sucursal = await db
      .selectFrom('sucursal')
      .select(['id', 'codigo'])
      .where('deleted_at', 'is', null)
      .orderBy('codigo')
      .executeTakeFirstOrThrow();
    sucursalCodigo = sucursal.codigo;

    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: `${PREFIJO} producto` })
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
        sucursal_id: sucursal.id,
        precio: '10.00',
        vigente_desde: '2023-01-01',
      })
      .execute();

    const passwordHash = await new PasswordService().hashear(PASSWORD);
    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Vendedor prospecto venta',
          password_hash: passwordHash,
          sucursal_id: sucursal.id,
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
    segmento = asignarSegmento('Prospecto Venta', ocupados) as string;
    await db
      .updateTable('vendedor')
      .set({ folio_segmento: segmento })
      .where('id', '=', vendedorId)
      .execute();

    tipoNegocioId = (
      await db
        .insertInto('tipo_negocio')
        .values({ nombre: `${PREFIJO} Taqueria` })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    tipoNegocioBorradoId = (
      await db
        .insertInto('tipo_negocio')
        .values({ nombre: `${PREFIJO} Ciber`, deleted_at: new Date() })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const login = await request(app.getHttpServer())
      .post('/auth/app/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);
    bearer = (login.body as { tokenAcceso: string }).tokenAcceso;
  });

  afterAll(async () => {
    const notas = db
      .selectFrom('venta_nota')
      .select('id')
      .where('vendedor_id', '=', vendedorId);
    // Orden inverso a las llaves foraneas.
    await db
      .deleteFrom('venta_nota_promocion')
      .where('venta_nota_id', 'in', notas)
      .execute();
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
    await db
      .deleteFrom('cliente')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
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
      .deleteFrom('tipo_negocio')
      .where('id', 'in', [tipoNegocioId, tipoNegocioBorradoId])
      .execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
    await app.close();
  });

  it('alta en un lote y venta de bienvenida en el siguiente: las dos entran y marca la primera venta', async () => {
    const alta = altaProspecto();
    const r1 = (await push({ operaciones: [alta] })).resultados[0];
    expect(r1.estado).toBe('aplicada');

    const venta = ventaRegalo(alta.clave);
    const r2 = (await push({ operaciones: [venta] })).resultados[0];
    expect(r2).toMatchObject({ estado: 'aplicada' });

    const nota = await db
      .selectFrom('venta_nota')
      .selectAll()
      .where('folio', '=', venta.folio)
      .executeTakeFirstOrThrow();
    expect(nota.cliente_id).toBe(alta.clave);
    expect(Number(nota.monto_total)).toBe(0); // `numeric` llega como cadena desde `pg`
    const cliente = await db
      .selectFrom('cliente')
      .select(['tipo', 'primera_venta_en'])
      .where('id', '=', alta.clave)
      .executeTakeFirstOrThrow();
    expect(cliente.tipo).toBe('prospecto');
    expect(cliente.primera_venta_en).not.toBeNull();
  });

  it('alta y venta en el MISMO lote: la venta cae por alcance y entra al reenviarla sola (D3, D4)', async () => {
    const alta = altaProspecto();
    const venta = ventaRegalo(alta.clave);
    const r = await push({ operaciones: [alta, venta] });
    expect(r.resultados[0].estado).toBe('aplicada');
    expect(r.resultados[1]).toMatchObject({
      estado: 'rechazada',
      codigo: 'cliente-fuera-de-alcance',
    });

    const reenvio = (await push({ operaciones: [venta] })).resultados[0];
    expect(reenvio.estado).toBe('aplicada');
  });

  it('alta rechazada: su venta tambien cae; corregida el alta, las dos entran en dos lotes', async () => {
    const alta = altaProspecto({
      datos: {
        ...altaProspecto().datos,
        tipo_negocio_id: tipoNegocioBorradoId,
      },
    });
    const venta = ventaRegalo(alta.clave);
    expect((await push({ operaciones: [alta] })).resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'tipo-negocio-inexistente',
    });
    expect((await push({ operaciones: [venta] })).resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'cliente-fuera-de-alcance',
    });

    const corregida = {
      ...alta,
      datos: { ...alta.datos, tipo_negocio_id: tipoNegocioId },
    };
    expect(
      (await push({ operaciones: [corregida] })).resultados[0].estado,
    ).toBe('aplicada');
    expect((await push({ operaciones: [venta] })).resultados[0].estado).toBe(
      'aplicada',
    );
    expect(
      await db
        .selectFrom('cliente')
        .select('id')
        .where('id', '=', alta.clave)
        .execute(),
    ).toHaveLength(1);
  });
});

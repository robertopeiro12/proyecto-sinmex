// PRIMER import, a proposito: pone FOTOS_DIR antes de que `app.module.ts` lea la configuracion.
import { FOTOS_DIR_PRUEBA } from './apoyo-fotos-dir';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
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
import { formarFolio } from './../src/modules/sincronizacion/folio';
import { asignarSegmento } from './../src/modules/sincronizacion/segmento-vendedor';

/**
 * T-73: la firma del cliente en la venta. Esta suite prueba el push (la
 * operacion `venta` con y sin `firma`); la Tarea 4 le suma la subida de la
 * imagen por el canal de fotos y la lectura del portal.
 *
 * Fecha 2015-06-15: ninguna otra suite vende ese dia y el folio es unico en
 * toda la base.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN = `e2e-firma-v-${SUFIJO}`;
const PREFIJO = `ZZ-e2e-firma-${SUFIJO}`;
const FECHA = '2015-06-15';

describe('Firma del cliente en la venta (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let vendedorId: string;
  let bearer: string;
  let productoId: string;
  let presentacionId: string;
  let clienteId: string;
  let segmento: string;
  let consecutivo = 0;

  const push = async (operaciones: unknown[], token = bearer) => {
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ contrato: CONTRATO_ACTUAL, operaciones })
      .expect(200);
    return res.body as RespuestaPush;
  };

  /** Una venta de la tablet, con lo que se quiera cambiar en `datos`. */
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
          cantidad: 2,
          cantidad_promocion: 0,
          precio_centavos: 1500,
        },
      ],
      ...datos,
    },
  });

  const notaPorFolio = (folio: string) =>
    db
      .selectFrom('venta_nota')
      .select([
        'id',
        'firma_esperada',
        'firma_nombre',
        'firma_archivo',
        'firma_subida_en',
      ])
      .where('folio', '=', folio)
      .executeTakeFirst();

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

    // Catalogo propio: la base de CI no trae productos. La venta de la tablet
    // exige algun precio para la presentacion (D12 de T-16).
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
        precio: '15.00',
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

    // El folio lleva el segmento del vendedor (T-14), que asigna el servidor.
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
    segmento = asignarSegmento('Firma Venta', ocupados) as string;
    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Firma Venta',
          password_hash: await app.get(PasswordService).hashear(PASSWORD),
          sucursal_id: tjId,
          folio_segmento: segmento,
        })
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
    // Orden inverso a las llaves foraneas.
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
    await app.close();
    await fs.rm(FOTOS_DIR_PRUEBA, { recursive: true, force: true });
  });

  describe('push (contrato)', () => {
    it('una venta con firma la espera y guarda el nombre recortado', async () => {
      const op = venta({ firma: { nombre: '  Doña Lupe  ' } });
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      expect(await notaPorFolio(op.folio)).toMatchObject({
        firma_esperada: true,
        firma_nombre: 'Doña Lupe',
        firma_archivo: null,
        firma_subida_en: null,
      });
    });

    it('una firma sin nombre la espera igual', async () => {
      const op = venta({ firma: { nombre: null } });
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      expect(await notaPorFolio(op.folio)).toMatchObject({
        firma_esperada: true,
        firma_nombre: null,
      });
    });

    it('una venta sin firma (app anterior a T-73) entra y no la espera', async () => {
      const op = venta();
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      expect(await notaPorFolio(op.folio)).toMatchObject({
        firma_esperada: false,
        firma_nombre: null,
      });
    });

    it('un nombre de mas de 80 caracteres rechaza la venta entera y no deja fila', async () => {
      const op = venta({ firma: { nombre: 'x'.repeat(81) } });
      const [r] = (await push([op])).resultados;
      expect(r).toMatchObject({
        estado: 'rechazada',
        codigo: 'datos-invalidos',
      });
      expect(r.motivo).toMatch(/^firma\.nombre/);
      expect(await notaPorFolio(op.folio)).toBeUndefined();
      const buzon = await db
        .selectFrom('sync_operacion')
        .select('id')
        .where('clave_idempotencia', '=', op.clave)
        .execute();
      expect(buzon).toEqual([]);
    });
  });
});

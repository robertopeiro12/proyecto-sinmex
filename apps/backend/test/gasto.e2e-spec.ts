import { randomUUID } from 'node:crypto';
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
import {
  CONTRATO_ACTUAL,
  type RespuestaPush,
} from './../src/modules/sincronizacion/contrato';

/**
 * T-30/T-31: el gasto de la ruta en el push, de punta a punta. Fija D4/D5 del
 * lado servidor: la clave es el id del gasto, la fecha es la del sobre (nunca
 * re-derivada de UTC), un campo dado de baja o sin "se usa en la app" se
 * acepta, uno inexistente no, un id ocupado se rechaza con motivo neutro y el
 * reenvio es `duplicada`. Fechas de 2018 para no cruzarse con otras suites.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN = `e2e-gasto-${SUFIJO}`;
const PASSWORD = 'contrasena-del-vendedor';
const PREFIJO = `ZZ-gasto-${SUFIJO}`;
const FECHA = '2018-04-10';

interface FilaGasto {
  id: string;
  sucursal_id: string;
  vendedor_id: string | null;
  capturo_usuario_id: string | null;
  campo_egreso_id: string;
  campo_nombre: string;
  tipo: string;
  fecha_texto: string;
  registrado_en: Date;
  monto: string;
  metodo: string;
  quien: string | null;
  factura: string;
  comentario: string | null;
  origen: string;
  foto_archivo: string | null;
}

describe('Gasto de la ruta en el push (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;

  let sucursalId: string;
  let vendedorId: string;
  let clienteId: string;
  let campoId: string;
  let campoBorradoId: string;
  let campoOficinaId: string;
  let bearer: string;
  const idsSembrados: string[] = [];

  const push = async (operaciones: unknown[]) => {
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ contrato: CONTRATO_ACTUAL, operaciones })
      .expect(200);
    return res.body as RespuestaPush;
  };

  const gasto = (
    datos: Record<string, unknown> = {},
    sobre: Record<string, unknown> = {},
  ) => ({
    clave: randomUUID(),
    tipo: 'gasto',
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T18:40:00.000Z`,
    datos: {
      campo_egreso_id: campoId,
      monto_centavos: 25050,
      registrado_en: `${FECHA}T18:40:00.000Z`,
      comentario: null,
      ...datos,
    },
    ...sobre,
  });

  const filaGasto = (id: string): Promise<FilaGasto | undefined> =>
    db
      .selectFrom('gasto')
      .select([
        'id',
        'sucursal_id',
        'vendedor_id',
        'capturo_usuario_id',
        'campo_egreso_id',
        'campo_nombre',
        'tipo',
        'registrado_en',
        'monto',
        'metodo',
        'quien',
        'factura',
        'comentario',
        'origen',
        'foto_archivo',
      ])
      .select(sql<string>`fecha::text`.as('fecha_texto'))
      .where('id', '=', id)
      .executeTakeFirst();

  const buzon = (clave: string) =>
    db
      .selectFrom('sync_operacion')
      .select(['entidad_tabla', 'entidad_id'])
      .where('vendedor_id', '=', vendedorId)
      .where('clave_idempotencia', '=', clave)
      .executeTakeFirst();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    sucursalId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;

    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Vendedor de gastos',
          password_hash: await new PasswordService().hashear(PASSWORD),
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // Un cliente de la sucursal: pasa el alcance del lote y deja ver que el
    // gasto lo rechaza por llevarlo, no por estar fuera de alcance.
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    clienteId = (
      await db
        .insertInto('cliente')
        .values({
          nombre: `${PREFIJO} Abarrotes`,
          domicilio: 'Calle 1',
          telefono: '6640000000',
          tipo: 'cliente',
          lista_precio_id: lista.id,
          sucursal_id: sucursalId,
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
    campoBorradoId = (
      await db
        .insertInto('campo_egreso')
        .values({
          nombre: `${PREFIJO} Casetas`,
          tipo: 'operacion',
          se_usa_en_app: true,
          deleted_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    // Sin la casilla: el servidor igual no la revisa (D5).
    campoOficinaId = (
      await db
        .insertInto('campo_egreso')
        .values({
          nombre: `${PREFIJO} Celular`,
          tipo: 'financiero',
          se_usa_en_app: false,
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
    await db
      .deleteFrom('gasto')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    if (idsSembrados.length > 0) {
      await db.deleteFrom('gasto').where('id', 'in', idsSembrados).execute();
    }
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('cliente').where('id', '=', clienteId).execute();
    await db
      .deleteFrom('campo_egreso')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
    await app.close();
  });

  it('entra con la clave como id, la fecha del sobre, la copia del campo y el metodo fijo', async () => {
    // A las 18:30 de Tijuana del 10 de abril en UTC ya es el 11: cuenta el 10.
    const op = gasto({
      registrado_en: '2018-04-11T01:30:00.000Z',
      comentario: '  Dos bolsas  ',
    });
    const r = (await push([op])).resultados[0];
    expect(r.estado).toBe('aplicada');

    const fila = await filaGasto(op.clave);
    expect(fila).toMatchObject({
      id: op.clave,
      sucursal_id: sucursalId,
      vendedor_id: vendedorId,
      capturo_usuario_id: null,
      campo_egreso_id: campoId,
      campo_nombre: `${PREFIJO} Hielo`,
      tipo: 'operacion',
      fecha_texto: '2018-04-10',
      monto: '250.50',
      metodo: 'efectivo_cobranza_dia',
      quien: 'Vendedor de gastos',
      factura: 'N/A',
      comentario: 'Dos bolsas',
      origen: 'app',
      foto_archivo: null,
    });
    expect(new Date(fila!.registrado_en).toISOString()).toBe(
      '2018-04-11T01:30:00.000Z',
    );
    expect(await buzon(op.clave)).toEqual({
      entidad_tabla: 'gasto',
      entidad_id: op.clave,
    });
  });

  it('un comentario vacio se guarda como null', async () => {
    const op = gasto({ comentario: '   ' });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
    expect((await filaGasto(op.clave))?.comentario).toBeNull();
  });

  it('un campo dado de baja se acepta: el vendedor lo eligio sin red', async () => {
    const op = gasto({ campo_egreso_id: campoBorradoId });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
    expect((await filaGasto(op.clave))?.campo_nombre).toBe(
      `${PREFIJO} Casetas`,
    );
  });

  it('un campo sin "se usa en la app" se acepta: el servidor no revisa la casilla', async () => {
    const op = gasto({ campo_egreso_id: campoOficinaId });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
    expect((await filaGasto(op.clave))?.tipo).toBe('financiero');
  });

  it('el reenvio es duplicada: una sola fila y el mismo id del buzon', async () => {
    const op = gasto();
    const primero = (await push([op])).resultados[0];
    const segundo = (await push([op])).resultados[0];
    expect(primero.estado).toBe('aplicada');
    expect(segundo.estado).toBe('duplicada');
    expect(segundo.id_servidor).toBe(primero.id_servidor);
    const { n } = await db
      .selectFrom('gasto')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('id', '=', op.clave)
      .executeTakeFirstOrThrow();
    expect(Number(n)).toBe(1);
  });

  it('un campo que no existe es campo-egreso-inexistente y no deja fila ni buzon', async () => {
    const op = gasto({ campo_egreso_id: randomUUID() });
    const r = (await push([op])).resultados[0];
    expect(r).toMatchObject({
      estado: 'rechazada',
      codigo: 'campo-egreso-inexistente',
    });
    expect(await filaGasto(op.clave)).toBeUndefined();
    expect(await buzon(op.clave)).toBeUndefined();
  });

  it('un id ya ocupado es gasto-id-ocupado con un motivo neutro y no deja buzon', async () => {
    // Otro registro ya tiene ese id (aqui, una compra de oficina sembrada).
    const ocupado = randomUUID();
    idsSembrados.push(ocupado);
    await db
      .insertInto('gasto')
      .values({
        id: ocupado,
        sucursal_id: sucursalId,
        campo_egreso_id: campoId,
        campo_nombre: 'sembrado',
        tipo: 'operacion',
        fecha: FECHA,
        registrado_en: new Date(),
        monto: '1.00',
        metodo: 'efectivo_cobranza_dia',
        origen: 'portal',
      })
      .execute();

    const r = (await push([gasto({}, { clave: ocupado })])).resultados[0];
    expect(r).toMatchObject({
      estado: 'rechazada',
      codigo: 'gasto-id-ocupado',
      motivo: 'El id de este gasto ya está ocupado. Avisa a la oficina.',
    });
    expect(await buzon(ocupado)).toBeUndefined();
  });

  it.each([
    ['monto 0', { monto_centavos: 0 }, {}],
    ['monto con fraccion de centavo', { monto_centavos: 1234.5 }, {}],
    ['monto mayor al maximo', { monto_centavos: 1_000_000_000_000 }, {}],
    ['comentario de 201', { comentario: 'x'.repeat(201) }, {}],
    ['registrado_en sin zona', { registrado_en: '2018-04-10T11:40:00' }, {}],
    ['clave que no es uuid', {}, { clave: `gasto-${SUFIJO}` }],
  ])('%s es datos-invalidos y no deja fila', async (_caso, datos, sobre) => {
    const op = gasto(datos, sobre);
    const r = (await push([op])).resultados[0];
    expect(r).toMatchObject({ estado: 'rechazada', codigo: 'datos-invalidos' });
    expect(await buzon(op.clave)).toBeUndefined();
  });

  it('con cliente_id en el sobre es datos-invalidos (un gasto no es de un cliente)', async () => {
    const op = gasto({}, { cliente_id: clienteId });
    const r = (await push([op])).resultados[0];
    expect(r).toMatchObject({ estado: 'rechazada', codigo: 'datos-invalidos' });
    expect(r.motivo).toMatch(/^cliente_id: /);
    expect(await filaGasto(op.clave)).toBeUndefined();
  });
});

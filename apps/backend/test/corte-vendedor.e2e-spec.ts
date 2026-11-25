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
 * Rediseño pieza 6: el corte del vendedor en el push, de punta a punta. La
 * clave es el id de `corte_vendedor`, la fecha es la del sobre, uno vivo por
 * vendedor y dia (otro con otra clave = `corte-duplicado`, la misma clave =
 * `duplicada`), un rechazo no deja ni fila ni buzon, y un lote sin corte (una
 * tablet sin el tipo) entra como siempre. Fechas de 2017 para no cruzarse con
 * otras suites.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN = `e2e-corte-vendedor-${SUFIJO}`;
const PASSWORD = 'contrasena-del-vendedor';
const PRE = '5d1c9a7e-3b2f-4c8d-9e0a-1b2c3d4e5f01';

describe('Corte del vendedor en el push (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;

  let sucursalId: string;
  let vendedorId: string;
  let bearer: string;

  const push = async (operaciones: unknown[]) => {
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ contrato: CONTRATO_ACTUAL, operaciones })
      .expect(200);
    return res.body as RespuestaPush;
  };

  const corte = (
    fecha: string,
    datos: Record<string, unknown> = {},
    sobre: Record<string, unknown> = {},
  ) => ({
    clave: randomUUID(),
    tipo: 'corte',
    fecha_operacion: fecha,
    ocurrido_en: `${fecha}T23:30:00.000Z`,
    datos: {
      efectivo: { esperado_centavos: 432500, traido_centavos: 430000 },
      notas: [
        { folio: 'TJ170310AP01', traida: true, saldo_centavos: 30000 },
        { folio: 'TJ170310AP02', traida: false, saldo_centavos: 12000 },
      ],
      inventario: [{ presentacion_id: PRE, sistema: 8, contado: 7 }],
      merma: { sistema: 5, contado: 4 },
      enviado_en: `${fecha}T23:30:00.000Z`,
      ...datos,
    },
    ...sobre,
  });

  const fila = (id: string) =>
    db
      .selectFrom('corte_vendedor')
      .select([
        'id',
        'vendedor_id',
        'sucursal_id',
        'efectivo',
        'notas',
        'inventario',
        'enviado_en',
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

  const cortesDelVendedor = async () =>
    Number(
      (
        await db
          .selectFrom('corte_vendedor')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('vendedor_id', '=', vendedorId)
          .executeTakeFirstOrThrow()
      ).n,
    );

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
          nombre: 'Vendedor del corte',
          password_hash: await new PasswordService().hashear(PASSWORD),
          sucursal_id: sucursalId,
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
      .deleteFrom('corte_vendedor')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
    await app.close();
  });

  it('guarda la fila con la clave como id, la fecha del sobre y lo capturado en el formato del contrato', async () => {
    // A las 15:30 de Tijuana del 10 de marzo en UTC ya es el 10 a las 23:30;
    // con un enviado_en del dia 11 en UTC el dia sigue siendo el del sobre.
    const op = corte('2017-03-10', { enviado_en: '2017-03-11T02:30:00.000Z' });
    const r = (await push([op])).resultados[0];
    expect(r.estado).toBe('aplicada');

    const guardado = await fila(op.clave);
    expect(guardado).toMatchObject({
      id: op.clave,
      vendedor_id: vendedorId,
      sucursal_id: sucursalId,
      fecha_texto: '2017-03-10',
      efectivo: { esperado_centavos: 432500, traido_centavos: 430000 },
      notas: [
        { folio: 'TJ170310AP01', traida: true, saldo_centavos: 30000 },
        { folio: 'TJ170310AP02', traida: false, saldo_centavos: 12000 },
      ],
      inventario: {
        renglones: [{ presentacion_id: PRE, sistema: 8, contado: 7 }],
        merma: { sistema: 5, contado: 4 },
      },
    });
    expect(new Date(guardado!.enviado_en).toISOString()).toBe(
      '2017-03-11T02:30:00.000Z',
    );
    expect(await buzon(op.clave)).toEqual({
      entidad_tabla: 'corte_vendedor',
      entidad_id: op.clave,
    });
  });

  it('el reenvio es duplicada: una sola fila y el mismo id del buzon', async () => {
    const op = corte('2017-03-11');
    const primero = (await push([op])).resultados[0];
    const segundo = (await push([op])).resultados[0];
    expect(primero.estado).toBe('aplicada');
    expect(segundo.estado).toBe('duplicada');
    expect(segundo.id_servidor).toBe(primero.id_servidor);
  });

  it('un segundo corte del mismo dia con otra clave es corte-duplicado y no deja fila ni buzon', async () => {
    const primero = corte('2017-03-12');
    expect((await push([primero])).resultados[0].estado).toBe('aplicada');

    const segundo = corte('2017-03-12', {
      efectivo: { esperado_centavos: 1, traido_centavos: 1 },
    });
    const r = (await push([segundo])).resultados[0];
    expect(r).toMatchObject({ estado: 'rechazada', codigo: 'corte-duplicado' });
    expect(r.motivo).toContain('2017-03-12');
    expect(await fila(segundo.clave)).toBeUndefined();
    expect(await buzon(segundo.clave)).toBeUndefined();
    // El primero no cambio.
    expect((await fila(primero.clave))?.efectivo).toEqual({
      esperado_centavos: 432500,
      traido_centavos: 430000,
    });
  });

  it('el efectivo esperado negativo y las listas vacias se aceptan', async () => {
    const op = corte('2017-03-13', {
      efectivo: { esperado_centavos: -2500, traido_centavos: 0 },
      notas: [],
      inventario: [],
    });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
    expect(await fila(op.clave)).toMatchObject({
      efectivo: { esperado_centavos: -2500, traido_centavos: 0 },
      notas: [],
      inventario: { renglones: [], merma: { sistema: 5, contado: 4 } },
    });
  });

  it('una forma mala es datos-invalidos con el campo en el motivo y no deja fila ni buzon', async () => {
    const op = corte('2017-03-14', {
      inventario: [{ presentacion_id: PRE, sistema: 8, contado: -1 }],
    });
    const r = (await push([op])).resultados[0];
    expect(r).toMatchObject({ estado: 'rechazada', codigo: 'datos-invalidos' });
    expect(r.motivo).toMatch(/^inventario\[0\]\.contado: /);
    expect(await fila(op.clave)).toBeUndefined();
    expect(await buzon(op.clave)).toBeUndefined();
  });

  it('un corte con folio se rechaza y no deja buzon', async () => {
    // El sobre revisa antes el formato del folio (`folio-invalido`); uno que
    // pasara llegaria a `prepararCorte` y seria `datos-invalidos` (unitaria).
    const conFolio = corte('2017-03-15', {}, { folio: 'TJ170315AP01' });
    const r = (await push([conFolio])).resultados[0];
    expect(r.estado).toBe('rechazada');
    expect(await buzon(conFolio.clave)).toBeUndefined();
  });

  it('un lote sin corte (una tablet sin el tipo) entra como siempre y no crea cortes', async () => {
    const antes = await cortesDelVendedor();
    const r = await push([
      {
        clave: randomUUID(),
        tipo: 'merma',
        fecha_operacion: '2017-03-16',
        ocurrido_en: '2017-03-16T20:00:00.000Z',
        datos: { libre: true },
      },
    ]);
    expect(r.resultados[0].estado).toBe('aplicada');
    expect(await cortesDelVendedor()).toBe(antes);
  });
});

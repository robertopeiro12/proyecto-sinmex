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
 * T-39: la visita sin venta de punta a punta. Fija D2/D3 del lado servidor:
 * la clave es el id de la visita, la ubicacion es obligatoria (GPS o direccion),
 * un motivo dado de baja se acepta, uno inexistente no, un id ocupado se rechaza
 * con motivo neutro, el reenvio es `duplicada` y el servidor NO revisa
 * "exige foto/nombre". La visita a un prospecto va en el lote siguiente al de su
 * alta (el alcance se comprueba una vez por lote).
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN = `e2e-visita-${SUFIJO}`;
const PASSWORD = 'contrasena-del-vendedor';
const PREFIJO = `ZZ-visita-${SUFIJO}`;
const FECHA = '2026-10-17';

interface FilaVisita {
  id: string;
  cliente_id: string;
  motivo_visita_id: string;
  fecha_texto: string;
  observaciones: string | null;
  atendio: string | null;
  lat: string | null;
  lng: string | null;
  precision_m: string | null;
  direccion_texto: string | null;
  foto_archivo: string | null;
}

describe('Visita sin venta (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;

  let sucursalId: string;
  let vendedorId: string;
  let clienteId: string;
  let tipoNegocioId: string;
  let motivoId: string;
  let motivoBorradoId: string;
  let bearer: string;

  const push = async (operaciones: unknown[], token = bearer) => {
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ contrato: CONTRATO_ACTUAL, operaciones })
      .expect(200);
    return res.body as RespuestaPush;
  };

  const visita = (
    datos: Record<string, unknown> = {},
    sobre: Record<string, unknown> = {},
  ) => ({
    clave: randomUUID(),
    tipo: 'visita',
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T18:40:00.000Z`,
    cliente_id: clienteId,
    datos: {
      motivo_visita_id: motivoId,
      visitada_en: `${FECHA}T18:40:00.000Z`,
      observaciones: null,
      atendio: null,
      lat: 32.5149,
      lng: -117.0382,
      precision_m: 12,
      direccion_texto: null,
      ...datos,
    },
    ...sobre,
  });

  const altaProspecto = () => ({
    clave: randomUUID(),
    tipo: 'prospecto',
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T18:03:22.000Z`,
    datos: {
      nombre: `${PREFIJO} Prospecto ${Math.random().toString(36).slice(2)}`,
      telefono: '6641112233',
      encargado: 'Don Aaron',
      tipo_negocio_id: tipoNegocioId,
      comentarios: null,
      lat: null,
      lng: null,
      foto: null,
    },
  });

  const filaVisita = (id: string): Promise<FilaVisita | undefined> =>
    db
      .selectFrom('visita')
      .select([
        'id',
        'cliente_id',
        'motivo_visita_id',
        'observaciones',
        'atendio',
        'lat',
        'lng',
        'precision_m',
        'direccion_texto',
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
        .where('deleted_at', 'is', null)
        .orderBy('codigo')
        .executeTakeFirstOrThrow()
    ).id;

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

    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Vendedor de visitas',
          password_hash: await new PasswordService().hashear(PASSWORD),
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    tipoNegocioId = (
      await db
        .insertInto('tipo_negocio')
        .values({ nombre: `${PREFIJO} Taqueria` })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // Exige foto Y nombre: el servidor igual no lo revisa (D3).
    motivoId = (
      await db
        .insertInto('motivo_visita')
        .values({
          nombre: `${PREFIJO} Cerrado`,
          exige_foto: true,
          exige_atendio: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    motivoBorradoId = (
      await db
        .insertInto('motivo_visita')
        .values({ nombre: `${PREFIJO} Vacaciones`, deleted_at: new Date() })
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
      .deleteFrom('visita')
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
      .deleteFrom('motivo_visita')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db
      .deleteFrom('tipo_negocio')
      .where('id', '=', tipoNegocioId)
      .execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
    await app.close();
  });

  it('una visita con GPS entra con la clave como id y el dia del sobre', async () => {
    const op = visita({ observaciones: '  Cortina abajo  ' });
    const r = (await push([op])).resultados[0];
    expect(r.estado).toBe('aplicada');

    const fila = await filaVisita(op.clave);
    expect(fila).toMatchObject({
      cliente_id: clienteId,
      motivo_visita_id: motivoId,
      fecha_texto: FECHA,
      observaciones: 'Cortina abajo',
      direccion_texto: null,
    });
    expect(Number(fila?.lat)).toBeCloseTo(32.5149, 6);
    expect(Number(fila?.precision_m)).toBe(12);
    expect(await buzon(op.clave)).toEqual({
      entidad_tabla: 'visita',
      entidad_id: op.clave,
    });
  });

  it('sin GPS, con direccion escrita, tambien entra', async () => {
    const op = visita({
      lat: null,
      lng: null,
      precision_m: null,
      direccion_texto: ' Frente al parque ',
    });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
    expect(await filaVisita(op.clave)).toMatchObject({
      lat: null,
      direccion_texto: 'Frente al parque',
    });
  });

  it('sin GPS y sin direccion es datos-invalidos y no deja fila', async () => {
    const op = visita({ lat: null, lng: null, direccion_texto: '   ' });
    expect((await push([op])).resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'datos-invalidos',
    });
    expect(await filaVisita(op.clave)).toBeUndefined();
    expect(await buzon(op.clave)).toBeUndefined();
  });

  it('el servidor no exige foto ni nombre aunque el motivo los pida (D3)', async () => {
    // `motivoId` tiene exige_foto y exige_atendio en true; la visita no trae ninguno.
    const op = visita({ atendio: null });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
  });

  it('puede haber varias visitas al mismo cliente el mismo dia', async () => {
    const r = await push([visita(), visita()]);
    expect(r.resultados.map((x) => x.estado)).toEqual(['aplicada', 'aplicada']);
  });

  it('reenviar la misma visita es duplicada y no deja una segunda fila (Review Focus 5)', async () => {
    const op = visita();
    const primero = (await push([op])).resultados[0];
    const reenvio = (await push([op])).resultados[0];
    expect(reenvio).toMatchObject({
      estado: 'duplicada',
      id_servidor: primero.id_servidor,
    });
    const filas = await db
      .selectFrom('visita')
      .select('id')
      .where('id', '=', op.clave)
      .execute();
    expect(filas).toHaveLength(1);
  });

  it('un motivo dado de baja se acepta: el vendedor lo eligio sin red cuando estaba vivo', async () => {
    const op = visita({ motivo_visita_id: motivoBorradoId });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
  });

  it('un motivo que no existe es motivo-visita-inexistente y no deja fila', async () => {
    const op = visita({ motivo_visita_id: randomUUID() });
    expect((await push([op])).resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'motivo-visita-inexistente',
    });
    expect(await buzon(op.clave)).toBeUndefined();
  });

  it('un id que ya ocupa otra visita es visita-id-ocupado, con motivo neutro, y no deja fila', async () => {
    const ocupado = randomUUID();
    await db
      .insertInto('visita')
      .values({
        id: ocupado,
        vendedor_id: vendedorId,
        sucursal_id: sucursalId,
        cliente_id: clienteId,
        motivo_visita_id: motivoId,
        fecha: FECHA,
        visitada_en: new Date(),
        direccion_texto: 'sembrada a mano',
      })
      .execute();

    const r = (await push([visita({}, { clave: ocupado })])).resultados[0];
    expect(r).toMatchObject({
      estado: 'rechazada',
      codigo: 'visita-id-ocupado',
    });
    expect(r.motivo).not.toContain(clienteId);
    expect(await buzon(ocupado)).toBeUndefined();
  });

  it('visita a un prospecto: su alta en un lote y la visita en el siguiente, en la misma sincronizacion', async () => {
    const alta = altaProspecto();
    expect((await push([alta])).resultados[0].estado).toBe('aplicada');
    const op = visita({}, { cliente_id: alta.clave });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
    expect(await filaVisita(op.clave)).toMatchObject({
      cliente_id: alta.clave,
    });
  });

  it('alta y visita en el MISMO lote: la visita cae por alcance; por eso la tablet sube prospectos antes', async () => {
    const alta = altaProspecto();
    const op = visita({}, { cliente_id: alta.clave });
    const r = await push([alta, op]);
    expect(r.resultados[0].estado).toBe('aplicada');
    expect(r.resultados[1]).toMatchObject({
      estado: 'rechazada',
      codigo: 'cliente-fuera-de-alcance',
    });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
  });
});

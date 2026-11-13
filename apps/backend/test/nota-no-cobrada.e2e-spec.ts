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
 * El comentario "no cobre" de una nota asignada, de punta a punta por
 * `POST /sync/push`. Fija: la clave es el id, la fecha es la del sobre, entra
 * aunque la nota no este (o ya no este) asignada al vendedor, una nota de otro
 * cliente es `nota-no-encontrada`, el reenvio es `duplicada` y la misma clave
 * de otro vendedor es `nota-no-cobrada-id-ocupado`.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN = `e2e-nnc-${SUFIJO}`;
const LOGIN_B = `e2e-nnc-b-${SUFIJO}`;
const PASSWORD = 'contrasena-del-vendedor';
const PREFIJO = `ZZ-nnc-${SUFIJO}`;
const FECHA = '2026-11-13';

describe('Nota no cobrada (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;

  let sucursalId: string;
  let sucursalAjenaId: string;
  let vendedorId: string;
  let vendedorBId: string;
  let clienteId: string;
  let otroClienteId: string;
  let clienteAjenoId: string;
  let usuarioId: string;
  let bearer: string;
  let bearerB: string;
  let folios = 0;

  const push = async (operaciones: unknown[], token = bearer) => {
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ contrato: CONTRATO_ACTUAL, operaciones })
      .expect(200);
    return res.body as RespuestaPush;
  };

  const sembrarCliente = async (
    nombre: string,
    sucursal: string,
  ): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    return (
      await db
        .insertInto('cliente')
        .values({
          nombre: `${PREFIJO} ${nombre}`,
          domicilio: 'Calle 1',
          telefono: '6640000000',
          tipo: 'cliente',
          lista_precio_id: lista.id,
          sucursal_id: sucursal,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  };

  const sembrarNota = async (
    cliente: string,
    opciones: { borrada?: boolean } = {},
  ): Promise<string> =>
    (
      await db
        .insertInto('venta_nota')
        .values({
          folio: `ZZN${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(
            0,
            30,
          ),
          fecha: '2026-11-01',
          cliente_id: cliente,
          vendedor_id: vendedorId,
          monto_total: '100.00',
          num_nota: null,
          contado_credito: 'credito',
          semana: 1,
          mes: 11,
          status: 'pendiente',
          deleted_at: opciones.borrada ? new Date() : null,
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  const asignar = (ventaNotaId: string, vendedor: string) =>
    db
      .insertInto('nota_asignada')
      .values({
        venta_nota_id: ventaNotaId,
        vendedor_id: vendedor,
        fecha: FECHA,
        asignada_por_usuario_id: usuarioId,
      })
      .execute();

  const op = (
    ventaNotaId: string,
    datos: Record<string, unknown> = {},
    sobre: Record<string, unknown> = {},
  ) => ({
    clave: randomUUID(),
    tipo: 'nota-no-cobrada',
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T18:40:00.000Z`,
    cliente_id: clienteId,
    datos: {
      venta_nota_id: ventaNotaId,
      comentario: 'No estaba el encargado',
      registrado_en: `${FECHA}T18:40:00.000Z`,
      ...datos,
    },
    ...sobre,
  });

  const fila = (id: string) =>
    db
      .selectFrom('nota_no_cobrada')
      .select([
        'id',
        'venta_nota_id',
        'vendedor_id',
        'sucursal_id',
        'comentario',
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

  const entrar = async (login: string) => {
    const r = await request(app.getHttpServer())
      .post('/auth/app/login')
      .send({ login, password: PASSWORD })
      .expect(200);
    return (r.body as { tokenAcceso: string }).tokenAcceso;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    const sucursales = await db
      .selectFrom('sucursal')
      .select('id')
      .where('deleted_at', 'is', null)
      .orderBy('codigo')
      .limit(2)
      .execute();
    expect(sucursales.length).toBeGreaterThanOrEqual(2);
    sucursalId = sucursales[0].id;
    sucursalAjenaId = sucursales[1].id;

    const hash = await new PasswordService().hashear(PASSWORD);

    // Usuario propio (quien asigna): la base limpia de CI no trae ninguno.
    const perfil = await db
      .selectFrom('perfil')
      .select('id')
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .limit(1)
      .executeTakeFirstOrThrow();
    usuarioId = (
      await db
        .insertInto('usuario')
        .values({
          login: `e2e-nnc-u-${SUFIJO}`,
          nombre: 'Oficina nota no cobrada',
          password_hash: hash,
          perfil_id: perfil.id,
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const vendedor = async (login: string) =>
      (
        await db
          .insertInto('vendedor')
          .values({
            login,
            nombre: 'Vendedor de notas',
            password_hash: hash,
            sucursal_id: sucursalId,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    vendedorId = await vendedor(LOGIN);
    vendedorBId = await vendedor(LOGIN_B);

    clienteId = await sembrarCliente('Abarrotes', sucursalId);
    otroClienteId = await sembrarCliente('Otro', sucursalId);
    clienteAjenoId = await sembrarCliente('Ajeno', sucursalAjenaId);

    bearer = await entrar(LOGIN);
    bearerB = await entrar(LOGIN_B);
  });

  afterAll(async () => {
    const vendedores = [vendedorId, vendedorBId];
    await db
      .deleteFrom('nota_no_cobrada')
      .where('vendedor_id', 'in', vendedores)
      .execute();
    await db
      .deleteFrom('nota_asignada')
      .where('vendedor_id', 'in', vendedores)
      .execute();
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', 'in', vendedores)
      .execute();
    await db
      .deleteFrom('venta_nota')
      .where('cliente_id', 'in', [clienteId, otroClienteId, clienteAjenoId])
      .execute();
    await db
      .deleteFrom('cliente')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', 'in', vendedores)
      .execute();
    await db.deleteFrom('vendedor').where('id', 'in', vendedores).execute();
    await db.deleteFrom('usuario').where('id', '=', usuarioId).execute();
    await app.close();
  });

  it('un comentario entra con la clave como id y la fecha del sobre', async () => {
    const nota = await sembrarNota(clienteId);
    await asignar(nota, vendedorId);
    const o = op(nota, { comentario: '  No estaba el encargado  ' });
    expect((await push([o])).resultados[0].estado).toBe('aplicada');

    expect(await fila(o.clave)).toMatchObject({
      venta_nota_id: nota,
      vendedor_id: vendedorId,
      sucursal_id: sucursalId,
      comentario: 'No estaba el encargado',
      fecha_texto: FECHA,
    });
    expect(await buzon(o.clave)).toEqual({
      entidad_tabla: 'nota_no_cobrada',
      entidad_id: o.clave,
    });
  });

  it('entra aunque la nota no esté asignada o se la hayan pasado a otro', async () => {
    const sinAsignar = await sembrarNota(clienteId);
    const pasada = await sembrarNota(clienteId);
    await asignar(pasada, vendedorBId);
    const borrada = await sembrarNota(clienteId, { borrada: true });

    const ops = [op(sinAsignar), op(pasada), op(borrada)];
    const r = await push(ops);
    expect(r.resultados.map((x) => x.estado)).toEqual([
      'aplicada',
      'aplicada',
      'aplicada',
    ]);
    for (const o of ops) expect(await fila(o.clave)).toBeDefined();
  });

  it('nota de otro cliente es nota-no-encontrada y no deja fila; cliente ajeno es cliente-fuera-de-alcance', async () => {
    const deOtroCliente = await sembrarNota(otroClienteId);
    const o1 = op(deOtroCliente);
    const r1 = (await push([o1])).resultados[0];
    expect(r1).toMatchObject({
      estado: 'rechazada',
      codigo: 'nota-no-encontrada',
    });
    expect(r1.motivo).not.toContain(otroClienteId);
    expect(await fila(o1.clave)).toBeUndefined();
    expect(await buzon(o1.clave)).toBeUndefined();

    const inexistente = op(randomUUID());
    expect((await push([inexistente])).resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'nota-no-encontrada',
    });

    const deAjeno = await sembrarNota(clienteAjenoId);
    const o2 = op(deAjeno, {}, { cliente_id: clienteAjenoId });
    expect((await push([o2])).resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'cliente-fuera-de-alcance',
    });
    expect(await fila(o2.clave)).toBeUndefined();
  });

  it('reenviar la misma clave es duplicada; la misma clave de otro vendedor es nota-no-cobrada-id-ocupado', async () => {
    const nota = await sembrarNota(clienteId);
    const o = op(nota);
    const primero = (await push([o])).resultados[0];
    const reenvio = (await push([o])).resultados[0];
    expect(reenvio).toMatchObject({
      estado: 'duplicada',
      id_servidor: primero.id_servidor,
    });
    const filas = await db
      .selectFrom('nota_no_cobrada')
      .select('id')
      .where('id', '=', o.clave)
      .execute();
    expect(filas).toHaveLength(1);

    const r = (await push([o], bearerB)).resultados[0];
    expect(r).toMatchObject({
      estado: 'rechazada',
      codigo: 'nota-no-cobrada-id-ocupado',
    });
    expect(
      await db
        .selectFrom('sync_operacion')
        .select('id')
        .where('vendedor_id', '=', vendedorBId)
        .where('clave_idempotencia', '=', o.clave)
        .executeTakeFirst(),
    ).toBeUndefined();
  });

  it('comentario vacío es datos-invalidos', async () => {
    const nota = await sembrarNota(clienteId);
    const o = op(nota, { comentario: '   ' });
    const r = (await push([o])).resultados[0];
    expect(r).toMatchObject({ estado: 'rechazada', codigo: 'datos-invalidos' });
    expect(r.motivo).toMatch(/^comentario: /);
    expect(await fila(o.clave)).toBeUndefined();
  });
});

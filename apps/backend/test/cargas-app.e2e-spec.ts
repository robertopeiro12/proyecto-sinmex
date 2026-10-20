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
import type { CargaRejilla } from './../src/modules/produccion/reglas-carga';
import {
  CONTRATO_ACTUAL,
  type CargaPull,
  type RespuestaPull,
} from './../src/modules/sincronizacion/contrato';

/**
 * La carga en la app (T-27 pieza 1): baja en el pull, el vendedor la responde con
 * red (`POST /sync/cargas/:id/respuesta`) y `control_inventario` baja al cambiar
 * la casilla de su sucursal.
 *
 * Sucursal propia `ZK` (exclusiva de esta suite): prender su casilla no afecta a
 * TJ ni a MX. Las cargas se crean por el portal (Tarea 2), de HOY.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const CODIGO = 'ZK';
const PASSWORD = 'contrasena-del-vendedor';
const LOGIN = `e2e-carga-app-${SUFIJO}`;
const LOGIN_AJENO = `e2e-carga-app-a-${SUFIJO}`;
const LOGIN_GENERAL = `e2e-carga-app-gen-${SUFIJO}`;
const PRODUCTO = `ZZ-carga-app-${SUFIJO}`;

type Cuerpo = Record<string, unknown>;

describe('La carga en la app (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sucursalId: string;
  let usuarioId: string;
  let cookieGeneral: string;
  let vendedorId: string;
  let vendedorAjenoId: string;
  let bearer: string;
  let bearerAjeno: string;
  let productoId: string;
  let litro: string;
  let medio: string;
  let hoy: string;

  const entrar = async (login: string): Promise<string> =>
    (
      (
        await request(app.getHttpServer())
          .post('/auth/app/login')
          .send({ login, password: PASSWORD })
          .expect(200)
      ).body as { tokenAcceso: string }
    ).tokenAcceso;

  const pull = async (
    token: string,
    desde?: string,
  ): Promise<RespuestaPull> => {
    const params = new URLSearchParams({ contrato: String(CONTRATO_ACTUAL) });
    if (desde) params.set('desde', desde);
    const res = await request(app.getHttpServer())
      .get(`/sync/pull?${params.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as RespuestaPull;
  };

  const responder = (token: string, id: string, cuerpo: Cuerpo) =>
    request(app.getHttpServer())
      .post(`/sync/cargas/${id}/respuesta`)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo);

  const nuevaCarga = async (vendedor = vendedorId): Promise<CargaRejilla> =>
    (
      await request(app.getHttpServer())
        .post('/cargas')
        .set('Cookie', cookieGeneral)
        .send({
          vendedorId: vendedor,
          lineas: [{ presentacionId: litro, piezas: 24 }],
        })
        .expect(201)
    ).body as CargaRejilla;

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
        .insertInto('sucursal')
        .values({ codigo: CODIGO, nombre: 'Prueba carga app' })
        .onConflict((oc) =>
          oc
            .column('codigo')
            .doUpdateSet({ deleted_at: null, control_inventario: false }),
        )
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    hoy = (
      await sql<{ hoy: string }>`
        select to_char((now() at time zone 'America/Tijuana')::date, 'YYYY-MM-DD') as hoy
      `.execute(db)
    ).rows[0].hoy;

    const hash = await app.get(PasswordService).hashear(PASSWORD);
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Administrador General')
      .executeTakeFirstOrThrow();
    usuarioId = (
      await db
        .insertInto('usuario')
        .values({
          login: LOGIN_GENERAL,
          nombre: LOGIN_GENERAL,
          password_hash: hash,
          perfil_id: perfilId,
          sucursal_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN_GENERAL, password: PASSWORD })
      .expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    cookieGeneral = cookies
      .find((c) => c.startsWith('jawa_access='))!
      .split(';')[0];

    const vendedor = async (loginVendedor: string, nombre: string) =>
      (
        await db
          .insertInto('vendedor')
          .values({
            login: loginVendedor,
            nombre,
            password_hash: hash,
            sucursal_id: sucursalId,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    vendedorId = await vendedor(LOGIN, 'Vendedor carga app');
    vendedorAjenoId = await vendedor(LOGIN_AJENO, 'Otro vendedor carga app');

    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: PRODUCTO })
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
    litro = await presentacion('1 L');
    medio = await presentacion('500 ml');

    bearer = await entrar(LOGIN);
    bearerAjeno = await entrar(LOGIN_AJENO);
  });

  afterAll(async () => {
    const vendedores = [vendedorId, vendedorAjenoId];
    const cargas = db
      .selectFrom('carga')
      .select('id')
      .where('vendedor_id', 'in', vendedores);
    await db
      .deleteFrom('carga_detalle')
      .where('carga_id', 'in', cargas)
      .execute();
    await db
      .deleteFrom('carga')
      .where('vendedor_id', 'in', vendedores)
      .execute();
    await db
      .deleteFrom('presentacion')
      .where('producto_id', '=', productoId)
      .execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', 'in', vendedores)
      .execute();
    await db.deleteFrom('vendedor').where('id', 'in', vendedores).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', '=', usuarioId)
      .execute();
    await db.deleteFrom('usuario').where('id', '=', usuarioId).execute();
    await db.deleteFrom('sucursal').where('codigo', '=', CODIGO).execute();
    await app.close();
  });

  it('el pull completo trae solo sus cargas, con lineas, y control_inventario apagado', async () => {
    const carga = await nuevaCarga();
    const ajena = await nuevaCarga(vendedorAjenoId);
    const cuerpo = await pull(bearer);
    expect(cuerpo.cargas.find((c) => c.id === carga.id)).toEqual({
      id: carga.id,
      vendedor_id: vendedorId,
      fecha: hoy,
      numero: carga.numero,
      estado: 'pendiente',
      motivo_rechazo: null,
      version: 1,
      respondida_en: null,
      activo: 1,
      lineas: [{ presentacion_id: litro, piezas: 24 }],
    });
    expect(cuerpo.cargas.some((c) => c.id === ajena.id)).toBe(false);
    expect(cuerpo.catalogos.vendedores).toEqual([
      expect.objectContaining({ id: vendedorId, control_inventario: false }),
    ]);
  });

  it('aceptar escribe la respuesta; Review Focus 3: repetir la misma respuesta es 200 y no la reescribe', async () => {
    const carga = await nuevaCarga();
    const primera = (
      await responder(bearer, carga.id, {
        version: 1,
        accion: 'aceptar',
      }).expect(200)
    ).body as CargaPull;
    expect(primera).toMatchObject({
      id: carga.id,
      estado: 'aceptada',
      motivo_rechazo: null,
      version: 1,
      activo: 1,
    });
    expect(primera.respondida_en).not.toBeNull();

    const segunda = (
      await responder(bearer, carga.id, {
        version: 1,
        accion: 'aceptar',
      }).expect(200)
    ).body as CargaPull;
    expect(segunda.respondida_en).toBe(primera.respondida_en);
  });

  it('rechazar exige motivo (recortado) y aceptar no lleva motivo: 400', async () => {
    const carga = await nuevaCarga();
    for (const cuerpo of [
      { version: 1, accion: 'rechazar' },
      { version: 1, accion: 'rechazar', motivo: '   ' },
      { version: 1, accion: 'rechazar', motivo: 'x'.repeat(301) },
      { version: 1, accion: 'aceptar', motivo: 'Todo bien' },
      { version: 1, accion: 'devolver' },
      { accion: 'aceptar' },
    ]) {
      await responder(bearer, carga.id, cuerpo).expect(400);
    }
    const res = await responder(bearer, carga.id, {
      version: 1,
      accion: 'rechazar',
      motivo: '  Faltan 2 cajas de horchata  ',
    }).expect(200);
    expect(res.body as CargaPull).toMatchObject({
      estado: 'rechazada',
      motivo_rechazo: 'Faltan 2 cajas de horchata',
    });
  });

  it('Review Focus 2: aceptar con la versión vieja es 409 con la carga actual', async () => {
    const carga = await nuevaCarga();
    await request(app.getHttpServer())
      .patch(`/cargas/${carga.id}`)
      .set('Cookie', cookieGeneral)
      .send({ version: 1, lineas: [{ presentacionId: medio, piezas: 12 }] })
      .expect(200);

    const vieja = await responder(bearer, carga.id, {
      version: 1,
      accion: 'aceptar',
    }).expect(409);
    expect((vieja.body as { carga: CargaPull }).carga).toMatchObject({
      id: carga.id,
      version: 2,
      estado: 'pendiente',
      lineas: [{ presentacion_id: medio, piezas: 12 }],
    });
    const fila = await db
      .selectFrom('carga')
      .select('estado')
      .where('id', '=', carga.id)
      .executeTakeFirstOrThrow();
    expect(fila.estado).toBe('pendiente');

    await responder(bearer, carga.id, { version: 2, accion: 'aceptar' }).expect(
      200,
    );
  });

  it('una carga ya respondida no cambia de respuesta: 409', async () => {
    const carga = await nuevaCarga();
    await responder(bearer, carga.id, {
      version: 1,
      accion: 'rechazar',
      motivo: 'Faltan cajas',
    }).expect(200);
    await responder(bearer, carga.id, { version: 1, accion: 'aceptar' }).expect(
      409,
    );
  });

  it('la carga de otro vendedor o una que no existe es 404 (y no se toca)', async () => {
    const ajena = await nuevaCarga(vendedorAjenoId);
    await responder(bearer, ajena.id, { version: 1, accion: 'aceptar' }).expect(
      404,
    );
    await responder(bearer, '00000000-0000-4000-8000-000000000000', {
      version: 1,
      accion: 'aceptar',
    }).expect(404);
    const fila = await db
      .selectFrom('carga')
      .select('estado')
      .where('id', '=', ajena.id)
      .executeTakeFirstOrThrow();
    expect(fila.estado).toBe('pendiente');
    // Su dueño si puede.
    await responder(bearerAjeno, ajena.id, {
      version: 1,
      accion: 'aceptar',
    }).expect(200);
  });

  it('Review Focus 4: una carga eliminada baja con activo 0 y responderla es 404', async () => {
    const carga = await nuevaCarga();
    const antes = (await pull(bearer)).servidor_en;
    await request(app.getHttpServer())
      .delete(`/cargas/${carga.id}`)
      .set('Cookie', cookieGeneral)
      .send({ version: 1 })
      .expect(200);

    const incremental = await pull(bearer, antes);
    expect(incremental.cargas.find((c) => c.id === carga.id)).toMatchObject({
      activo: 0,
    });
    expect((await pull(bearer)).cargas.some((c) => c.id === carga.id)).toBe(
      false,
    );
    await responder(bearer, carga.id, { version: 1, accion: 'aceptar' }).expect(
      404,
    );
  });

  it('el pull incremental baja la respuesta', async () => {
    const carga = await nuevaCarga();
    const antes = (await pull(bearer)).servidor_en;
    await responder(bearer, carga.id, { version: 1, accion: 'aceptar' }).expect(
      200,
    );
    const incremental = await pull(bearer, antes);
    expect(incremental.cargas.find((c) => c.id === carga.id)).toMatchObject({
      estado: 'aceptada',
      version: 1,
    });
  });

  it('control_inventario baja en el pull incremental al cambiar la casilla de su sucursal', async () => {
    const antes = (await pull(bearer)).servidor_en;
    await request(app.getHttpServer())
      .patch(`/sucursales/${sucursalId}`)
      .set('Cookie', cookieGeneral)
      .send({ controlInventario: true })
      .expect(200);
    const incremental = await pull(bearer, antes);
    expect(incremental.catalogos.vendedores).toEqual([
      expect.objectContaining({ id: vendedorId, control_inventario: true }),
    ]);
  });

  it('una cookie del portal no entra al endpoint de la app: 401', async () => {
    const carga = await nuevaCarga();
    await request(app.getHttpServer())
      .post(`/sync/cargas/${carga.id}/respuesta`)
      .set('Cookie', cookieGeneral)
      .send({ version: 1, accion: 'aceptar' })
      .expect(401);
  });
});

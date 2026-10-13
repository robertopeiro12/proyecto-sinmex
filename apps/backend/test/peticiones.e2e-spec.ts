import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import { borrarCobrosDe } from './apoyo-cobros';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';
import {
  CONTRATO_ACTUAL,
  type RespuestaPull,
} from './../src/modules/sincronizacion/contrato';
import type { VistaBorrado } from './../src/modules/ventas-cobranza/cobros-borrado.service';
import type { PeticionEnBandeja } from './../src/modules/ventas-cobranza/peticiones.repository';
import { MOTIVO_SALDO_FAVOR_APLICADO } from './../src/modules/ventas-cobranza/reglas-borrado-cobro';
import type { VentaDetalle } from './../src/modules/ventas-cobranza/ventas-consulta.service';

/**
 * Peticiones: borrar un pago con autorizacion (T-34), §6 del spec.
 *
 * Fechas de JUNIO DE 2023 exclusivas de este archivo. Los pagos se crean por
 * la puerta real (`POST /cobranzas`, T-21), asi que nacen con su `cobro`.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-pet-gen-${SUFIJO}`;
const LOGIN_OTRO = `e2e-pet-otro-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-pet-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-pet-sin-${SUFIJO}`;
const LOGIN_SOLO_PIDE = `e2e-pet-pide-${SUFIJO}`;
const LOGIN_APP = `e2e-pet-app-${SUFIJO}`;

const F1 = '2023-06-01';
const F2 = '2023-06-02';
const PAGO = '2023-06-10';

const mensaje = (res: request.Response) =>
  (res.body as { message: string }).message;

describe('Peticiones: borrar un cobro (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let mxId: string;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  let vendedorApp: string;
  let usuarioGeneralId: string;
  let usuarioOtroId: string;
  let cookieGeneral: string;
  let cookieOtro: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let cookieSoloPide: string;
  let bearerApp: string;
  let folios = 0;
  let clientes = 0;

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

  /** `Administrador General` trae todos los permisos; `Auxiliar Administrativo` esta vacio. */
  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ) => {
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

  const sembrarCliente = async (sucursalId: string): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `Peticiones ${++clientes} ${SUFIJO}`,
        domicilio: 'Calle 1',
        telefono: '6640000000',
        tipo: 'cliente',
        lista_precio_id: lista.id,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return id;
  };

  /** Una venta a credito de oficina, `pendiente`. */
  const sembrarNota = async (
    clienteId: string,
    monto: string,
    fecha: string,
  ) => {
    const cliente = await db
      .selectFrom('cliente')
      .select('sucursal_id')
      .where('id', '=', clienteId)
      .executeTakeFirstOrThrow();
    return db
      .insertInto('venta_nota')
      .values({
        folio: `ZZP${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha,
        cliente_id: clienteId,
        vendedor_id: null,
        monto_total: monto,
        num_nota: null,
        contado_credito: 'credito',
        semana: 22,
        mes: 6,
        status: 'pendiente',
        sucursal_id: cliente.sucursal_id,
        origen: 'portal',
        capturo_usuario_id: usuarioGeneralId,
      })
      .returning(['id', 'folio'])
      .executeTakeFirstOrThrow();
  };

  /** Un pago real del portal (transferencia de Oficina); devuelve el id de su `cobro`. */
  const cobrar = async (
    clienteId: string,
    notaIds: string[],
    montoCentavos: number,
  ): Promise<string> => {
    await request(app.getHttpServer())
      .post('/cobranzas')
      .set('Cookie', cookieGeneral)
      .send({
        clienteId,
        notaIds,
        montoCentavos,
        fechaPago: PAGO,
        metodoPago: 'transferencia',
        vendedorId: null,
      })
      .expect(201);
    return ultimoCobro(clienteId);
  };

  const aplicarSaldo = async (
    clienteId: string,
    notaIds: string[],
    montoCentavos: number,
  ): Promise<string> => {
    await request(app.getHttpServer())
      .post('/cobranzas/saldo-favor')
      .set('Cookie', cookieGeneral)
      .send({ clienteId, notaIds, montoCentavos })
      .expect(201);
    return ultimoCobro(clienteId);
  };

  const ultimoCobro = async (clienteId: string): Promise<string> =>
    (
      await db
        .selectFrom('cobro')
        .select('id')
        .where('cliente_id', '=', clienteId)
        .orderBy('created_at', 'desc')
        .executeTakeFirstOrThrow()
    ).id;

  const pedir = (cookie: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/peticiones/eliminar-cobro')
      .set('Cookie', cookie)
      .send(cuerpo);

  const autorizar = (cookie: string, id: string) =>
    request(app.getHttpServer())
      .post(`/peticiones/${id}/autorizar`)
      .set('Cookie', cookie);

  const denegar = (
    cookie: string,
    id: string,
    cuerpo: Record<string, unknown> = {},
  ) =>
    request(app.getHttpServer())
      .post(`/peticiones/${id}/denegar`)
      .set('Cookie', cookie)
      .send(cuerpo);

  const bandeja = (cookie: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/peticiones?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const vistaBorrado = (cookie: string, cobroId: string) =>
    request(app.getHttpServer())
      .get(`/cobros/${cobroId}/vista-borrado`)
      .set('Cookie', cookie);

  /** Pide el borrado y devuelve la peticion creada. */
  const pedirOk = async (cobroId: string, cookie = cookieGeneral) =>
    (await pedir(cookie, { cobroId, motivo: 'Era de credito' }).expect(201))
      .body as PeticionEnBandeja;

  const statusDe = async (id: string) =>
    (
      await db
        .selectFrom('venta_nota')
        .select('status')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).status;

  /** La suma de los movimientos vivos, texto: `'0'` si no queda ninguno, `'20.00'` si hay. */
  const saldoFavorDe = async (clienteId: string) =>
    (
      await db
        .selectFrom('saldo_favor_movimiento')
        .select(sql<string>`coalesce(sum(monto), 0)::text`.as('total'))
        .where('cliente_id', '=', clienteId)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow()
    ).total;

  const abonosVivos = (notaId: string) =>
    db
      .selectFrom('cobranza_abono')
      .select(['monto', 'cobro_id'])
      .where('venta_nota_id', '=', notaId)
      .where('deleted_at', 'is', null)
      .execute();

  const pull = (query: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .get(
        `/sync/pull?${new URLSearchParams({ contrato: String(CONTRATO_ACTUAL), ...query }).toString()}`,
      )
      .set('Authorization', `Bearer ${bearerApp}`);

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

    usuarioGeneralId = await crearUsuario(
      LOGIN_GENERAL,
      'Administrador General',
      null,
    );
    usuarioOtroId = await crearUsuario(
      LOGIN_OTRO,
      'Administrador General',
      null,
    );
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', tjId);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    // Solo puede PEDIR: perfil vacio + la excepcion cobranza.editar_eliminar (T-08a).
    const soloPide = await crearUsuario(
      LOGIN_SOLO_PIDE,
      'Auxiliar Administrativo',
      null,
    );
    const { id: permisoPedir } = await db
      .selectFrom('permiso')
      .select('id')
      .where('clave', '=', 'cobranza.editar_eliminar')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('usuario_permiso')
      .values({
        usuario_id: soloPide,
        permiso_id: permisoPedir,
        habilitado: true,
      })
      .execute();

    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieOtro = await iniciarSesion(LOGIN_OTRO);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
    cookieSoloPide = await iniciarSesion(LOGIN_SOLO_PIDE);

    // El de la tablet de TJ: para comprobar lo que baja en el pull.
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: LOGIN_APP,
        nombre: `Vendedor peticiones ${SUFIJO}`,
        password_hash: await app.get(PasswordService).hashear(PASSWORD),
        sucursal_id: tjId,
        activo: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorApp = id;
    bearerApp = (
      (
        await request(app.getHttpServer())
          .post('/auth/app/login')
          .send({ login: LOGIN_APP, password: PASSWORD })
          .expect(200)
      ).body as { tokenAcceso: string }
    ).tokenAcceso;
  });

  afterAll(async () => {
    if (clienteIds.length > 0) {
      const notas = db
        .selectFrom('venta_nota')
        .select('id')
        .where('cliente_id', 'in', clienteIds);
      await db
        .deleteFrom('cobranza_abono')
        .where('venta_nota_id', 'in', notas)
        .execute();
      await db
        .deleteFrom('saldo_favor_movimiento')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await borrarCobrosDe(db, clienteIds);
      await db
        .deleteFrom('venta_nota')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', '=', vendedorApp)
      .execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorApp).execute();
    await db
      .deleteFrom('usuario_permiso')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  /* ================================================================ */

  describe('pedir el borrado', () => {
    it('crea la peticion pendiente con el pago, sus folios, quien pidio y el motivo recortado', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const cobroId = await cobrar(cli, [n1.id, n2.id], 20000);

      const p = (
        await pedir(cookieGeneral, {
          cobroId,
          motivo: '  Era de credito  ',
        }).expect(201)
      ).body as PeticionEnBandeja;

      expect(p).toMatchObject({
        tipo: 'eliminar_cobro',
        status: 'pendiente',
        sucursalCodigo: 'TJ',
        motivo: 'Era de credito',
        solicito: LOGIN_GENERAL,
        resolvio: null,
        resueltaEn: null,
        comentario: null,
        cobro: {
          id: cobroId,
          clienteId: cli,
          montoCentavos: 20000,
          metodoPago: 'transferencia',
          origen: 'cobro',
          fechaPago: PAGO,
          cobrador: null,
          folios: [n1.folio, n2.folio],
        },
      });
      expect(p.creadaEn).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      // Pedir no cambia nada: el pago sigue vivo.
      expect(await statusDe(n1.id)).toBe('pagada');
    });

    it('motivo vacio o de mas de 500 caracteres es 400', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);

      expect(
        mensaje(
          await pedir(cookieGeneral, { cobroId, motivo: '   ' }).expect(400),
        ),
      ).toBe('Escribe el motivo de la petición.');
      expect(
        mensaje(await pedir(cookieGeneral, { cobroId }).expect(400)),
      ).toEqual(expect.arrayContaining(['Escribe el motivo de la petición.']));
      expect(
        mensaje(
          await pedir(cookieGeneral, {
            cobroId,
            motivo: 'x'.repeat(501),
          }).expect(400),
        ),
      ).toBe('El motivo no puede pasar de 500 caracteres.');
    });

    it('un pago que no existe es 404 y un id mal formado es 400', async () => {
      expect(
        mensaje(
          await pedir(cookieGeneral, {
            cobroId: '00000000-0000-4000-8000-000000000000',
            motivo: 'x',
          }).expect(404),
        ),
      ).toBe('No existe ese cobro.');
      await pedir(cookieGeneral, { cobroId: 'no-es-uuid', motivo: 'x' }).expect(
        400,
      );
    });

    it('Review Focus 5: una segunda peticion pendiente sobre el mismo pago es 409', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      await pedirOk(cobroId);

      expect(
        mensaje(
          await pedir(cookieOtro, { cobroId, motivo: 'Otra vez' }).expect(409),
        ),
      ).toBe('Este cobro ya tiene una petición de borrado pendiente.');
    });

    it('pedir mientras otra transaccion borra el pago espera su candado y ve el pago borrado (409)', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);

      // Simula un "autorizar" a medias: el `for update` del pago y su
      // `deleted_at` escritos, sin confirmar todavia.
      let respuesta: Promise<request.Response> | undefined;
      await db.transaction().execute(async (trx) => {
        await sql`select id from cobro where id = ${cobroId} for update`.execute(
          trx,
        );
        await trx
          .updateTable('cobro')
          .set({
            deleted_at: sql`now()`,
            eliminado_por_usuario_id: usuarioOtroId,
          })
          .where('id', '=', cobroId)
          .execute();
        const { pid } = (
          await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(
            trx,
          )
        ).rows[0];

        respuesta = pedir(cookieGeneral, { cobroId, motivo: 'A la vez' }).then(
          (r) => r,
        );
        // Hasta que la peticion este esperando el candado de ESTA transaccion.
        for (let i = 0; i < 100; i++) {
          const { esperando } = (
            await sql<{ esperando: number }>`
              select count(*)::int as esperando from pg_stat_activity
               where ${pid}::int = any(pg_blocking_pids(pid))`.execute(db)
          ).rows[0];
          if (esperando > 0) return;
          await new Promise((listo) => setTimeout(listo, 50));
        }
        throw new Error('La peticion nunca espero el candado del pago.');
      });

      const r = await respuesta!;
      expect(r.status).toBe(409);
      expect(mensaje(r)).toBe('Este cobro ya se borró.');
      const pendientes = await db
        .selectFrom('peticion')
        .select('id')
        .where('cobro_id', '=', cobroId)
        .execute();
      expect(pendientes).toEqual([]);
    });

    it('Review Focus 5: un pago ya borrado es 409', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      const p = await pedirOk(cobroId);
      await autorizar(cookieGeneral, p.id).expect(200);

      expect(
        mensaje(
          await pedir(cookieGeneral, { cobroId, motivo: 'x' }).expect(409),
        ),
      ).toBe('Este cobro ya se borró.');
    });
  });

  describe('permisos y alcance', () => {
    it('sin permisos todo es 403', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      const p = await pedirOk(cobroId);

      await bandeja(cookieSinPermiso, { status: 'pendiente' }).expect(403);
      await pedir(cookieSinPermiso, { cobroId, motivo: 'x' }).expect(403);
      await vistaBorrado(cookieSinPermiso, cobroId).expect(403);
      await autorizar(cookieSinPermiso, p.id).expect(403);
      await denegar(cookieSinPermiso, p.id).expect(403);
    });

    it('con solo cobranza.editar_eliminar se pide y se ve la vista previa, pero no se ve la bandeja ni se autoriza', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);

      await vistaBorrado(cookieSoloPide, cobroId).expect(200);
      const p = await pedirOk(cobroId, cookieSoloPide);
      await bandeja(cookieSoloPide, { status: 'pendiente' }).expect(403);
      await autorizar(cookieSoloPide, p.id).expect(403);
      await request(app.getHttpServer())
        .get(`/peticiones/${p.id}/vista-previa`)
        .set('Cookie', cookieSoloPide)
        .expect(403);
    });

    it('Review Focus 4: un usuario de TJ no ve, no pide ni resuelve nada de MX, aunque este borrado o resuelto', async () => {
      const cli = await sembrarCliente(mxId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      const pendiente = await pedirOk(cobroId);

      await vistaBorrado(cookieTijuana, cobroId).expect(403);
      await pedir(cookieTijuana, { cobroId, motivo: 'x' }).expect(403);
      await autorizar(cookieTijuana, pendiente.id).expect(403);
      await denegar(cookieTijuana, pendiente.id).expect(403);
      await bandeja(cookieTijuana, {
        status: 'pendiente',
        sucursal: 'MX',
      }).expect(403);
      const suya = (
        await bandeja(cookieTijuana, { status: 'pendiente' }).expect(200)
      ).body as PeticionEnBandeja[];
      expect(suya.find((x) => x.id === pendiente.id)).toBeUndefined();

      // Ya resuelta y con el pago borrado: sigue siendo 403, no 409.
      await autorizar(cookieGeneral, pendiente.id).expect(200);
      await autorizar(cookieTijuana, pendiente.id).expect(403);
      await vistaBorrado(cookieTijuana, cobroId).expect(403);
    });
  });

  describe('autorizar', () => {
    it('borra el pago completo: filas, status recalculados, saldo a favor y quien lo borro', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      // 200 = 100 (n1) + 80 (n2) + 20 a saldo a favor.
      const cobroId = await cobrar(cli, [n1.id, n2.id], 20000);
      expect(await saldoFavorDe(cli)).toBe('20.00');
      const p = await pedirOk(cobroId);

      const resuelta = (await autorizar(cookieOtro, p.id).expect(200))
        .body as PeticionEnBandeja;

      expect(resuelta).toMatchObject({
        status: 'autorizada',
        resolvio: LOGIN_OTRO,
        comentario: null,
      });
      expect(resuelta.resueltaEn).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      expect(await abonosVivos(n1.id)).toEqual([]);
      expect(await abonosVivos(n2.id)).toEqual([]);
      expect(await statusDe(n1.id)).toBe('pendiente');
      expect(await statusDe(n2.id)).toBe('pendiente');
      expect(await saldoFavorDe(cli)).toBe('0');
      const pago = await db
        .selectFrom('cobro')
        .select(['deleted_at', 'eliminado_por_usuario_id'])
        .where('id', '=', cobroId)
        .executeTakeFirstOrThrow();
      expect(pago.deleted_at).not.toBeNull();
      expect(pago.eliminado_por_usuario_id).toBe(usuarioOtroId);
    });

    it('la misma persona que pidio puede autorizar', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      const p = await pedirOk(cobroId, cookieGeneral);
      await autorizar(cookieGeneral, p.id).expect(200);
      expect(await statusDe(n1.id)).toBe('pendiente');
    });

    it('Review Focus 3: con otro pago vivo la nota queda abonada; una en cuenta perdida no cambia', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const primero = await cobrar(cli, [n1.id], 3000); // n1 abonada con $30
      await cobrar(cli, [n1.id], 2000); // y otro pago vivo de $20
      const deN2 = await cobrar(cli, [n2.id], 1000);
      await db
        .updateTable('venta_nota')
        .set({ status: 'cuenta_perdida' })
        .where('id', '=', n2.id)
        .execute();

      await autorizar(cookieGeneral, (await pedirOk(primero)).id).expect(200);
      expect(await statusDe(n1.id)).toBe('abonado');
      expect((await abonosVivos(n1.id)).map((a) => a.monto)).toEqual(['20.00']);

      await autorizar(cookieGeneral, (await pedirOk(deN2)).id).expect(200);
      expect(await statusDe(n2.id)).toBe('cuenta_perdida');
      expect(await abonosVivos(n2.id)).toEqual([]);
    });

    it('Review Focus 1: si el saldo a favor que dejo el pago ya se aplico, 409 y nada cambia; borrando antes la aplicacion, si se puede', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      // Sin otras notas abiertas, lo que sobra va a saldo a favor: 100 a n1 y 50 a favor.
      const conExcedente = await cobrar(cli, [n1.id], 15000);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const aplicacion = await aplicarSaldo(cli, [n2.id], 5000); // usa los 50
      expect(await saldoFavorDe(cli)).toBe('0.00');

      const p = await pedirOk(conExcedente);
      const vista = (
        await vistaBorrado(cookieGeneral, conExcedente).expect(200)
      ).body as VistaBorrado;
      expect(vista.bloqueo).toEqual({
        codigo: 'saldo-favor-aplicado',
        motivo: MOTIVO_SALDO_FAVOR_APLICADO,
      });

      expect(mensaje(await autorizar(cookieGeneral, p.id).expect(409))).toBe(
        MOTIVO_SALDO_FAVOR_APLICADO,
      );
      expect(await statusDe(n1.id)).toBe('pagada');
      expect(
        (await bandeja(cookieGeneral, { status: 'pendiente' }).expect(200))
          .body,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: p.id, status: 'pendiente' }),
        ]),
      );

      // Primero la aplicacion (devuelve el saldo), luego el pago con excedente.
      await autorizar(cookieGeneral, (await pedirOk(aplicacion)).id).expect(
        200,
      );
      expect(await saldoFavorDe(cli)).toBe('50.00');
      expect(await statusDe(n2.id)).toBe('pendiente');
      await autorizar(cookieGeneral, p.id).expect(200);
      expect(await saldoFavorDe(cli)).toBe('0'); // ya no queda ningun movimiento vivo
      expect(await statusDe(n1.id)).toBe('pendiente');
    });

    it('Review Focus 2: dos autorizaciones a la vez — una gana, la otra ve la peticion resuelta', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      const p = await pedirOk(cobroId);

      const [a, b] = await Promise.all([
        autorizar(cookieGeneral, p.id),
        autorizar(cookieOtro, p.id),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(mensaje(a.status === 409 ? a : b)).toBe(
        'Esta petición ya fue resuelta.',
      );

      // El pago se borro UNA vez, por quien gano, y la peticion lo dice igual.
      const ganador = a.status === 200 ? usuarioGeneralId : usuarioOtroId;
      const pago = await db
        .selectFrom('cobro')
        .select(['deleted_at', 'eliminado_por_usuario_id'])
        .where('id', '=', cobroId)
        .executeTakeFirstOrThrow();
      expect(pago.deleted_at).not.toBeNull();
      expect(pago.eliminado_por_usuario_id).toBe(ganador);
      const resuelta = await db
        .selectFrom('peticion')
        .select(['status', 'resuelta_por_usuario_id'])
        .where('id', '=', p.id)
        .executeTakeFirstOrThrow();
      expect(resuelta).toEqual({
        status: 'autorizada',
        resuelta_por_usuario_id: ganador,
      });
      expect(
        (await abonosVivos(n1.id)).filter((x) => x.cobro_id === cobroId),
      ).toEqual([]);
      expect(await statusDe(n1.id)).toBe('pendiente');
    });

    it('Review Focus 2: autorizar y denegar a la vez — solo una resolucion queda', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      const p = await pedirOk(cobroId);

      const [a, d] = await Promise.all([
        autorizar(cookieGeneral, p.id),
        denegar(cookieOtro, p.id),
      ]);
      expect([a.status, d.status].sort()).toEqual([200, 409]);
      const final = await db
        .selectFrom('peticion')
        .select('status')
        .where('id', '=', p.id)
        .executeTakeFirstOrThrow();
      const borrado = await db
        .selectFrom('cobro')
        .select('deleted_at')
        .where('id', '=', cobroId)
        .executeTakeFirstOrThrow();
      expect(final.status === 'autorizada').toBe(borrado.deleted_at !== null);
    });

    it('tras borrar el pago la venta se vuelve a poder editar', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      const antes = (
        await request(app.getHttpServer())
          .get(`/ventas/${n1.id}`)
          .set('Cookie', cookieGeneral)
          .expect(200)
      ).body as VentaDetalle;
      expect(antes.editable).toBe(false);

      await autorizar(cookieGeneral, (await pedirOk(cobroId)).id).expect(200);

      const despues = (
        await request(app.getHttpServer())
          .get(`/ventas/${n1.id}`)
          .set('Cookie', cookieGeneral)
          .expect(200)
      ).body as VentaDetalle;
      expect(despues.editable).toBe(true);
      expect(despues.cobros).toEqual([]);
    });

    it('la tablet: el pull incremental baja la nota otra vez pendiente, sin el abono borrado, y el saldo a favor nuevo', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const cobroId = await cobrar(cli, [n1.id, n2.id], 20000);
      const p = await pedirOk(cobroId);
      const corte = ((await pull().expect(200)).body as RespuestaPull)
        .servidor_en;

      await autorizar(cookieGeneral, p.id).expect(200);

      const cuerpo = (await pull({ desde: corte }).expect(200))
        .body as RespuestaPull;
      expect(cuerpo.notas_pendientes.find((n) => n.id === n1.id)).toMatchObject(
        {
          activo: 1,
          status: 'pendiente',
          saldo_centavos: 10000,
          abonos: [],
        },
      );
      expect(cuerpo.notas_pendientes.find((n) => n.id === n2.id)).toMatchObject(
        {
          activo: 1,
          saldo_centavos: 8000,
        },
      );
      expect(
        cuerpo.catalogos.clientes.find((c) => c.id === cli)
          ?.saldo_favor_centavos,
      ).toBe(0);
    });
  });

  describe('denegar', () => {
    it('con comentario: el pago no cambia y se puede volver a pedir', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      const p = await pedirOk(cobroId);

      const r = (
        await denegar(cookieOtro, p.id, {
          comentario: '  No procede  ',
        }).expect(200)
      ).body as PeticionEnBandeja;
      expect(r).toMatchObject({
        status: 'denegada',
        resolvio: LOGIN_OTRO,
        comentario: 'No procede',
      });
      expect(await statusDe(n1.id)).toBe('abonado');
      await pedirOk(cobroId);
    });

    it('sin comentario queda null; con mas de 500 es 400; resuelta ya no se deniega', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const p = await pedirOk(await cobrar(cli, [n1.id], 5000));

      expect(
        mensaje(
          await denegar(cookieGeneral, p.id, {
            comentario: 'x'.repeat(501),
          }).expect(400),
        ),
      ).toBe('El comentario no puede pasar de 500 caracteres.');
      const r = (await denegar(cookieGeneral, p.id).expect(200))
        .body as PeticionEnBandeja;
      expect(r.comentario).toBeNull();
      expect(mensaje(await denegar(cookieGeneral, p.id).expect(409))).toBe(
        'Esta petición ya fue resuelta.',
      );
    });

    it('una peticion que no existe es 404', async () => {
      expect(
        mensaje(
          await denegar(
            cookieGeneral,
            '00000000-0000-4000-8000-000000000000',
          ).expect(404),
        ),
      ).toBe('No existe esa petición.');
    });
  });

  describe('bandeja y vista previa', () => {
    it('pendientes (de la mas vieja) e historial (de la mas reciente), con filtro por sucursal', async () => {
      const cliTj = await sembrarCliente(tjId);
      const cliMx = await sembrarCliente(mxId);
      const nTj = await sembrarNota(cliTj, '100.00', F1);
      const nMx = await sembrarNota(cliMx, '100.00', F1);
      const pTj = await pedirOk(await cobrar(cliTj, [nTj.id], 1000));
      const pMx = await pedirOk(await cobrar(cliMx, [nMx.id], 1000));

      const todas = (
        await bandeja(cookieGeneral, { status: 'pendiente' }).expect(200)
      ).body as PeticionEnBandeja[];
      const ids = todas.map((x) => x.id);
      expect(ids.indexOf(pTj.id)).toBeLessThan(ids.indexOf(pMx.id));

      const soloMx = (
        await bandeja(cookieGeneral, {
          status: 'pendiente',
          sucursal: 'MX',
        }).expect(200)
      ).body as PeticionEnBandeja[];
      expect(soloMx.every((x) => x.sucursalCodigo === 'MX')).toBe(true);
      expect(soloMx.map((x) => x.id)).toContain(pMx.id);

      await denegar(cookieGeneral, pTj.id, { comentario: 'No' }).expect(200);
      await autorizar(cookieGeneral, pMx.id).expect(200);
      const historial = (
        await bandeja(cookieGeneral, { status: 'historial' }).expect(200)
      ).body as PeticionEnBandeja[];
      const hIds = historial.map((x) => x.id);
      expect(hIds.indexOf(pMx.id)).toBeLessThan(hIds.indexOf(pTj.id));
      expect(historial.find((x) => x.id === pTj.id)).toMatchObject({
        status: 'denegada',
        comentario: 'No',
      });
      expect(historial.find((x) => x.id === pMx.id)?.cobro.folios).toEqual([
        nMx.folio,
      ]);
    });

    it('un status que no es pendiente ni historial es 400', async () => {
      expect(
        mensaje(await bandeja(cookieGeneral, { status: 'todas' }).expect(400)),
      ).toEqual(expect.arrayContaining(['Elige pendientes o historial.']));
    });

    it('la vista previa de la peticion es la misma que la del cobro, recalculada', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const cobroId = await cobrar(cli, [n1.id, n2.id], 12000);
      const p = await pedirOk(cobroId);

      const porCobro = (await vistaBorrado(cookieGeneral, cobroId).expect(200))
        .body as VistaBorrado;
      const porPeticion = (
        await request(app.getHttpServer())
          .get(`/peticiones/${p.id}/vista-previa`)
          .set('Cookie', cookieGeneral)
          .expect(200)
      ).body as VistaBorrado;
      expect(porPeticion).toEqual(porCobro);
      expect(porCobro).toMatchObject({
        cobro: {
          id: cobroId,
          montoCentavos: 12000,
          metodoPago: 'transferencia',
          cobrador: null,
        },
        notas: [
          {
            notaId: n1.id,
            delPagoCentavos: 10000,
            saldoAntesCentavos: 0,
            saldoDespuesCentavos: 10000,
            statusDespues: 'pendiente',
          },
          {
            notaId: n2.id,
            delPagoCentavos: 2000,
            saldoAntesCentavos: 6000,
            saldoDespuesCentavos: 8000,
            statusDespues: 'pendiente',
          },
        ],
        saldoFavorAntesCentavos: 0,
        saldoFavorDespuesCentavos: 0,
        movimientoSaldoFavorCentavos: 0,
        bloqueo: null,
      });
    });
  });
});

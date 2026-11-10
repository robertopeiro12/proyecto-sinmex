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
import { RELOJ_RUTAS } from './../src/modules/rutas/reloj';
import type {
  RutaSemanalDetalle,
  RutaSemanalResumen,
} from './../src/modules/rutas/rutas-semanales.service';

/**
 * Ruta Semanal desde el portal: alta, nombre unico por dia, alcance,
 * propagacion a las rutas del dia ya armadas y baja.
 *
 * Fechas de 2099 (desde el lunes 2099-01-05), exclusivas de este archivo. Las
 * rutas del dia asignadas se insertan directo en la base: el `PUT` de la ruta
 * diaria que las asigna es de la Tarea 5.
 *
 * El reloj de "hoy" es el real, salvo en la prueba de medianoche, que lo fija
 * con `RELOJ_RUTAS`.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-rsem-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-rsem-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-rsem-sin-${SUFIJO}`;

describe('Ruta Semanal desde el portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let mxId: string;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  const vendedorIds: string[] = [];
  const rutaIds: string[] = [];
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  /** `null` = el reloj real. */
  let ahoraFijo: Date | null = null;

  let clientes = 0;
  let folios = 0;
  let rutas = 0;
  /** Un nombre de ruta que no choca con otra corrida. */
  const nombreNuevo = () => `Ruta ${++rutas} ${SUFIJO}`;

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
  };

  const sembrarVendedor = async (
    sucursalId: string,
  ): Promise<{ id: string; nombre: string }> => {
    const nombre = `Vendedor rsem ${vendedorIds.length + 1} ${SUFIJO}`;
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-rsem-v${vendedorIds.length + 1}-${SUFIJO}`,
        nombre,
        password_hash: 'x',
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return { id, nombre };
  };

  const sembrarCliente = async (
    sucursalId: string,
    extra: { tipo?: 'cliente' | 'prospecto' } = {},
  ): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const prospecto = extra.tipo === 'prospecto';
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `Ruta semanal ${++clientes} ${SUFIJO}`,
        domicilio: prospecto ? null : 'Calle 1',
        telefono: '6640000000',
        tipo: extra.tipo ?? 'cliente',
        lista_precio_id: prospecto ? null : lista.id,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return id;
  };

  /** Asigna la ruta a un vendedor ese dia, como lo dejara el PUT de la Tarea 5. */
  const sembrarRutaDia = async (valores: {
    vendedor: string;
    fecha: string;
    rutaSemanalId: string;
    nombreRuta: string;
  }) => {
    await db
      .insertInto('ruta_dia')
      .values({
        vendedor_id: valores.vendedor,
        fecha: valores.fecha,
        ruta_semanal_id: valores.rutaSemanalId,
        nombre_ruta: valores.nombreRuta,
      })
      .execute();
  };

  const sembrarFila = async (valores: {
    vendedor: string;
    cliente: string;
    fecha: string;
    orden: number;
    origen: 'oficina' | 'vendedor' | 'semanal';
    quitadoPor?: 'oficina' | 'cambio_ruta';
  }) => {
    await db
      .insertInto('ruta')
      .values({
        vendedor_id: valores.vendedor,
        cliente_id: valores.cliente,
        fecha: valores.fecha,
        orden: valores.orden,
        origen: valores.origen,
        tipo: 'diaria',
        quitado_por: valores.quitadoPor ?? null,
        deleted_at: valores.quitadoPor ? new Date() : null,
      })
      .execute();
  };

  const sembrarNotaAsignada = async (
    clienteId: string,
    vendedorId: string,
    fecha: string,
  ): Promise<string> => {
    const { id: notaId } = await db
      .insertInto('venta_nota')
      .values({
        folio: `ZZS${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha: '2099-01-01',
        cliente_id: clienteId,
        vendedor_id: null,
        monto_total: '100.00',
        num_nota: null,
        contado_credito: 'credito',
        semana: 1,
        mes: 1,
        status: 'pendiente',
        sucursal_id: tjId,
        origen: 'portal',
        capturo_usuario_id: usuarioIds[0],
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('nota_asignada')
      .values({
        venta_nota_id: notaId,
        vendedor_id: vendedorId,
        fecha,
        asignada_por_usuario_id: usuarioIds[0],
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  const servidor = () => request(app.getHttpServer());

  const crear = (
    cookie: string,
    cuerpo: { sucursal?: string; diaSemana?: number; nombre?: string },
  ) => servidor().post('/rutas/semanales').set('Cookie', cookie).send(cuerpo);

  /** Crea una ruta de TJ ese dia y la deja lista para limpiar. */
  const crearRuta = async (
    diaSemana: number,
    nombre = nombreNuevo(),
  ): Promise<RutaSemanalDetalle> => {
    const res = await crear(cookieGeneral, {
      sucursal: 'TJ',
      diaSemana,
      nombre,
    }).expect(201);
    const ruta = res.body as RutaSemanalDetalle;
    rutaIds.push(ruta.id);
    return ruta;
  };

  const guardarClientes = (cookie: string, id: string, lista: string[]) =>
    servidor()
      .put(`/rutas/semanales/${id}/clientes`)
      .set('Cookie', cookie)
      .send({ clientes: lista });

  /** Las filas vivas de la ruta del dia, por orden. */
  const vivasDe = (vendedor: string, fecha: string) =>
    db
      .selectFrom('ruta')
      .select(['cliente_id', 'orden', 'origen'])
      .where('vendedor_id', '=', vendedor)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .where('deleted_at', 'is', null)
      .orderBy('orden')
      .execute();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RELOJ_RUTAS)
      .useValue(() => ahoraFijo ?? new Date())
      .compile();
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

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', tjId);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterEach(() => {
    ahoraFijo = null;
  });

  afterAll(async () => {
    if (vendedorIds.length > 0) {
      await db
        .deleteFrom('nota_asignada')
        .where('vendedor_id', 'in', vendedorIds)
        .execute();
      await db
        .deleteFrom('ruta')
        .where('vendedor_id', 'in', vendedorIds)
        .execute();
      await db
        .deleteFrom('ruta_dia')
        .where('vendedor_id', 'in', vendedorIds)
        .execute();
    }
    if (rutaIds.length > 0) {
      await db
        .deleteFrom('ruta_semanal_cliente')
        .where('ruta_semanal_id', 'in', rutaIds)
        .execute();
      await db.deleteFrom('ruta_semanal').where('id', 'in', rutaIds).execute();
    }
    if (clienteIds.length > 0) {
      await db
        .deleteFrom('venta_nota')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    if (vendedorIds.length > 0) {
      await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
    }
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  it('crea, lista y renombra', async () => {
    const nombre = nombreNuevo();
    const res = await crear(cookieGeneral, {
      sucursal: 'TJ',
      diaSemana: 1,
      nombre: `  ${nombre}  `,
    }).expect(201);
    const ruta = res.body as RutaSemanalDetalle;
    rutaIds.push(ruta.id);
    expect(ruta).toMatchObject({
      diaSemana: 1,
      nombre,
      clientes: 0,
      sucursalCodigo: 'TJ',
      lista: [],
    });

    const lista = await servidor()
      .get('/rutas/semanales?sucursal=TJ')
      .set('Cookie', cookieGeneral)
      .expect(200);
    expect(lista.body as RutaSemanalResumen[]).toContainEqual({
      id: ruta.id,
      diaSemana: 1,
      nombre,
      clientes: 0,
      sucursalCodigo: 'TJ',
    });

    const renombrada = await servidor()
      .patch(`/rutas/semanales/${ruta.id}`)
      .set('Cookie', cookieGeneral)
      .send({ nombre: `${nombre} bis` })
      .expect(200);
    expect((renombrada.body as RutaSemanalDetalle).nombre).toBe(
      `${nombre} bis`,
    );
  });

  it('con "Todas" un usuario general tiene que elegir sucursal', async () => {
    const res = await servidor()
      .get('/rutas/semanales')
      .set('Cookie', cookieGeneral)
      .expect(400);
    expect((res.body as { message: string }).message).toBe(
      'Elige una sucursal.',
    );
    await crear(cookieGeneral, {
      sucursal: 'todas',
      diaSemana: 1,
      nombre: nombreNuevo(),
    }).expect(400);
  });

  it('valida el cuerpo del alta: dia de 1 a 6 y nombre de 1 a 80', async () => {
    await crear(cookieGeneral, {
      sucursal: 'TJ',
      diaSemana: 7,
      nombre: nombreNuevo(),
    }).expect(400);
    await crear(cookieGeneral, {
      sucursal: 'TJ',
      diaSemana: 1,
      nombre: '   ',
    }).expect(400);
    await crear(cookieGeneral, {
      sucursal: 'TJ',
      diaSemana: 1,
      nombre: 'x'.repeat(81),
    }).expect(400);
  });

  it('renombrar cambia el nombre de las rutas del dia de hoy en adelante', async () => {
    const ruta = await crearRuta(2);
    const pasado = await sembrarVendedor(tjId);
    const futuro = await sembrarVendedor(tjId);
    await sembrarRutaDia({
      vendedor: pasado.id,
      fecha: '2020-01-07',
      rutaSemanalId: ruta.id,
      nombreRuta: ruta.nombre,
    });
    await sembrarRutaDia({
      vendedor: futuro.id,
      fecha: '2099-01-06',
      rutaSemanalId: ruta.id,
      nombreRuta: ruta.nombre,
    });

    await servidor()
      .patch(`/rutas/semanales/${ruta.id}`)
      .set('Cookie', cookieGeneral)
      .send({ nombre: `${ruta.nombre} nueva` })
      .expect(200);

    const filas = await db
      .selectFrom('ruta_dia')
      .select(['vendedor_id', 'nombre_ruta'])
      .where('ruta_semanal_id', '=', ruta.id)
      .execute();
    expect(filas).toEqual(
      expect.arrayContaining([
        { vendedor_id: pasado.id, nombre_ruta: ruta.nombre },
        { vendedor_id: futuro.id, nombre_ruta: `${ruta.nombre} nueva` },
      ]),
    );
  });

  it('nombre repetido el mismo dia = 409; otro dia = 201', async () => {
    const nombre = nombreNuevo();
    await crearRuta(3, nombre);
    const res = await crear(cookieGeneral, {
      sucursal: 'TJ',
      diaSemana: 3,
      nombre: `  ${nombre.toUpperCase()} `,
    }).expect(409);
    expect((res.body as { message: string }).message).toBe(
      'Ya hay una ruta con ese nombre el miércoles.',
    );
    await crearRuta(4, nombre);

    // Renombrar a un nombre ocupado ese dia tambien es 409.
    const otra = await crearRuta(3);
    await servidor()
      .patch(`/rutas/semanales/${otra.id}`)
      .set('Cookie', cookieGeneral)
      .send({ nombre })
      .expect(409);
  });

  it('sin permiso = 403; usuario de TJ sobre una de MX = 404', async () => {
    const tj = await crearRuta(1);
    await servidor()
      .get('/rutas/semanales?sucursal=TJ')
      .set('Cookie', cookieSinPermiso)
      .expect(403);
    await servidor()
      .get(`/rutas/semanales/${tj.id}`)
      .set('Cookie', cookieSinPermiso)
      .expect(403);
    await crear(cookieSinPermiso, {
      sucursal: 'TJ',
      diaSemana: 1,
      nombre: nombreNuevo(),
    }).expect(403);

    const resMx = await crear(cookieGeneral, {
      sucursal: 'MX',
      diaSemana: 1,
      nombre: nombreNuevo(),
    }).expect(201);
    const mx = resMx.body as RutaSemanalDetalle;
    rutaIds.push(mx.id);

    for (const peticion of [
      servidor().get(`/rutas/semanales/${mx.id}`),
      servidor().patch(`/rutas/semanales/${mx.id}`).send({ nombre: 'Otra' }),
      servidor().put(`/rutas/semanales/${mx.id}/clientes`).send({
        clientes: [],
      }),
      servidor().delete(`/rutas/semanales/${mx.id}`),
    ]) {
      const res = await peticion.set('Cookie', cookieTijuana).expect(404);
      expect((res.body as { message: string }).message).toBe(
        'No existe esa ruta.',
      );
    }

    // El de TJ solo ve las suyas aunque no mande sucursal; pedir MX es 403.
    const lista = await servidor()
      .get('/rutas/semanales')
      .set('Cookie', cookieTijuana)
      .expect(200);
    const ids = (lista.body as RutaSemanalResumen[]).map((r) => r.id);
    expect(ids).toContain(tj.id);
    expect(ids).not.toContain(mx.id);
    await servidor()
      .get('/rutas/semanales?sucursal=MX')
      .set('Cookie', cookieTijuana)
      .expect(403);
  });

  it('guarda los clientes en orden y rechaza los que no valen nombrandolos', async () => {
    const ruta = await crearRuta(5);
    const a = await sembrarCliente(tjId);
    const b = await sembrarCliente(tjId);
    const deMx = await sembrarCliente(mxId);

    const res = await guardarClientes(cookieGeneral, ruta.id, [b, a]).expect(
      200,
    );
    const detalle = res.body as RutaSemanalDetalle;
    expect(detalle.clientes).toBe(2);
    expect(detalle.lista.map((c) => c.clienteId)).toEqual([b, a]);

    await guardarClientes(cookieGeneral, ruta.id, [a, a]).expect(400);
    const malo = await guardarClientes(cookieGeneral, ruta.id, [
      a,
      deMx,
    ]).expect(400);
    // El de otra sucursal se nombra por id: su nombre no se revela.
    expect((malo.body as { message: string }).message).toContain(deMx);

    // Nada cambio con el rechazo.
    const despues = await servidor()
      .get(`/rutas/semanales/${ruta.id}`)
      .set('Cookie', cookieGeneral)
      .expect(200);
    expect(
      (despues.body as RutaSemanalDetalle).lista.map((c) => c.clienteId),
    ).toEqual([b, a]);
  });

  it.todo(
    'propaga sin deshacer lo quitado a mano: semanal martes [A, B], asignada el 2099-01-06 con el PUT de la diaria ' +
      '(Tarea 5) y B quitado a mano; PUT de la semanal [A, B, C] → la ruta del dia queda [A, C], C con origen semanal',
  );

  it('propaga a las rutas del dia de hoy en adelante sin tocar lo puesto a mano', async () => {
    const ruta = await crearRuta(2);
    const [a, b, c, d] = [
      await sembrarCliente(tjId),
      await sembrarCliente(tjId),
      await sembrarCliente(tjId),
      await sembrarCliente(tjId),
    ];
    await guardarClientes(cookieGeneral, ruta.id, [a, b]).expect(200);

    const vendedor = await sembrarVendedor(tjId);
    const vendedorPasado = await sembrarVendedor(tjId);
    const fecha = '2099-01-13';
    await sembrarRutaDia({
      vendedor: vendedor.id,
      fecha,
      rutaSemanalId: ruta.id,
      nombreRuta: ruta.nombre,
    });
    // Como la dejaria la Tarea 5: A de la semanal, B quitado a mano por la
    // oficina y D agregado a mano.
    await sembrarFila({
      vendedor: vendedor.id,
      cliente: a,
      fecha,
      orden: 1,
      origen: 'semanal',
    });
    await sembrarFila({
      vendedor: vendedor.id,
      cliente: b,
      fecha,
      orden: 2,
      origen: 'semanal',
      quitadoPor: 'oficina',
    });
    await sembrarFila({
      vendedor: vendedor.id,
      cliente: d,
      fecha,
      orden: 2,
      origen: 'oficina',
    });
    const notaDeA = await sembrarNotaAsignada(a, vendedor.id, fecha);
    const notaDeD = await sembrarNotaAsignada(d, vendedor.id, fecha);

    // Una ruta del dia PASADA de la misma semanal nunca cambia.
    const pasada = '2020-01-07';
    await sembrarRutaDia({
      vendedor: vendedorPasado.id,
      fecha: pasada,
      rutaSemanalId: ruta.id,
      nombreRuta: ruta.nombre,
    });
    await sembrarFila({
      vendedor: vendedorPasado.id,
      cliente: a,
      fecha: pasada,
      orden: 1,
      origen: 'semanal',
    });

    // Agregar C y D: C entra al final; B (quitado a mano) no vuelve; D ya estaba.
    await guardarClientes(cookieGeneral, ruta.id, [a, b, c, d]).expect(200);
    expect(await vivasDe(vendedor.id, fecha)).toEqual([
      { cliente_id: a, orden: 1, origen: 'semanal' },
      { cliente_id: d, orden: 2, origen: 'oficina' },
      { cliente_id: c, orden: 3, origen: 'semanal' },
    ]);
    expect(await vivasDe(vendedorPasado.id, pasada)).toEqual([
      { cliente_id: a, orden: 1, origen: 'semanal' },
    ]);

    // Quitar A y D de la semanal: A (vino de la semanal) sale con su nota; D
    // (a mano) se queda con la suya.
    await guardarClientes(cookieGeneral, ruta.id, [b, c]).expect(200);
    expect(await vivasDe(vendedor.id, fecha)).toEqual([
      { cliente_id: d, orden: 2, origen: 'oficina' },
      { cliente_id: c, orden: 3, origen: 'semanal' },
    ]);
    const filaA = await db
      .selectFrom('ruta')
      .select('quitado_por')
      .where('vendedor_id', '=', vendedor.id)
      .where('cliente_id', '=', a)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .executeTakeFirstOrThrow();
    expect(filaA.quitado_por).toBe('cambio_ruta');

    const notas = await db
      .selectFrom('nota_asignada')
      .select(['id', 'deleted_at', 'quitada_por_usuario_id'])
      .where('id', 'in', [notaDeA, notaDeD])
      .execute();
    const porId = new Map(notas.map((n) => [n.id, n]));
    expect(porId.get(notaDeA)?.deleted_at).not.toBeNull();
    expect(porId.get(notaDeA)?.quitada_por_usuario_id).toBe(usuarioIds[0]);
    expect(porId.get(notaDeD)?.deleted_at).toBeNull();

    // La pasada sigue igual.
    expect(await vivasDe(vendedorPasado.id, pasada)).toEqual([
      { cliente_id: a, orden: 1, origen: 'semanal' },
    ]);
  });

  it('borrar una ruta asignada hoy o despues = 409; sin asignaciones futuras = 204', async () => {
    const asignada = await crearRuta(1);
    const vendedor = await sembrarVendedor(tjId);
    await sembrarRutaDia({
      vendedor: vendedor.id,
      fecha: '2099-01-05',
      rutaSemanalId: asignada.id,
      nombreRuta: asignada.nombre,
    });
    const res = await servidor()
      .delete(`/rutas/semanales/${asignada.id}`)
      .set('Cookie', cookieGeneral)
      .expect(409);
    expect((res.body as { message: string }).message).toBe(
      `Esta ruta está asignada a ${vendedor.nombre} el lunes 5 de enero.`,
    );

    const libre = await crearRuta(1);
    // Asignada solo en el pasado: se puede borrar.
    await sembrarRutaDia({
      vendedor: vendedor.id,
      fecha: '2020-01-06',
      rutaSemanalId: libre.id,
      nombreRuta: libre.nombre,
    });
    await servidor()
      .delete(`/rutas/semanales/${libre.id}`)
      .set('Cookie', cookieGeneral)
      .expect(204);

    const lista = await servidor()
      .get('/rutas/semanales?sucursal=TJ')
      .set('Cookie', cookieGeneral)
      .expect(200);
    const ids = (lista.body as RutaSemanalResumen[]).map((r) => r.id);
    expect(ids).toContain(asignada.id);
    expect(ids).not.toContain(libre.id);
    await servidor()
      .get(`/rutas/semanales/${libre.id}`)
      .set('Cookie', cookieGeneral)
      .expect(404);
  });

  it('a las 23:30 de Tijuana (ya es manana en UTC) "hoy" sigue siendo el de Tijuana', async () => {
    // 2099-01-07 07:30 UTC = martes 2099-01-06 23:30 en Tijuana (UTC-8).
    ahoraFijo = new Date('2099-01-07T07:30:00Z');
    const vendedor = await sembrarVendedor(tjId);

    // Asignada AYER (lunes 5): ya no cuenta como "hoy o futura".
    const deAyer = await crearRuta(1);
    await sembrarRutaDia({
      vendedor: vendedor.id,
      fecha: '2099-01-05',
      rutaSemanalId: deAyer.id,
      nombreRuta: deAyer.nombre,
    });
    await servidor()
      .delete(`/rutas/semanales/${deAyer.id}`)
      .set('Cookie', cookieGeneral)
      .expect(204);

    // Asignada HOY (martes 6): en UTC ya seria ayer, pero en Tijuana es hoy.
    const deHoy = await crearRuta(2);
    await sembrarRutaDia({
      vendedor: vendedor.id,
      fecha: '2099-01-06',
      rutaSemanalId: deHoy.id,
      nombreRuta: deHoy.nombre,
    });
    await servidor()
      .delete(`/rutas/semanales/${deHoy.id}`)
      .set('Cookie', cookieGeneral)
      .expect(409);
  });

  it('cliente dado de baja, prospecto o de otra sucursal sale con valido:false', async () => {
    const ruta = await crearRuta(6);
    const vivo = await sembrarCliente(tjId);
    const baja = await sembrarCliente(tjId);
    const vuelto = await sembrarCliente(tjId);
    await guardarClientes(cookieGeneral, ruta.id, [vivo, baja, vuelto]).expect(
      200,
    );
    await db
      .updateTable('cliente')
      .set({ deleted_at: new Date() })
      .where('id', '=', baja)
      .execute();
    await db
      .updateTable('cliente')
      .set({ tipo: 'prospecto' })
      .where('id', '=', vuelto)
      .execute();

    const res = await servidor()
      .get(`/rutas/semanales/${ruta.id}`)
      .set('Cookie', cookieGeneral)
      .expect(200);
    const detalle = res.body as RutaSemanalDetalle;
    expect(detalle.lista.map((c) => [c.clienteId, c.valido])).toEqual([
      [vivo, true],
      [baja, false],
      [vuelto, false],
    ]);

    // Guardar otra vez con los que ya no valen no falla: no son nuevos.
    await guardarClientes(cookieGeneral, ruta.id, [vivo, baja, vuelto]).expect(
      200,
    );
  });
});

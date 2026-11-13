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
import { diaSemanaDe } from './../src/modules/rutas/reglas-ruta-semanal';
import type { NotasDeRuta } from './../src/modules/rutas/reglas-notas-ruta';
import { RELOJ_RUTAS } from './../src/modules/rutas/reloj';

/**
 * Notas por cobrar asignadas desde el portal (Tarea 6; spec §5.4): asignar,
 * pasar y quitar, con permiso, alcance y candados.
 *
 * Fechas desde 2099-08-01 (futuras: un dia pasado es de solo lectura),
 * exclusivas de este archivo.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-nasig-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-nasig-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-nasig-sin-${SUFIJO}`;

describe('Notas asignadas (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let mxId: string;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  const vendedorIds: string[] = [];
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let vendedorA: string;
  let vendedorB: string;
  let vendedorMx: string;
  let clientes = 0;
  let dias = 0;
  let folios = 0;
  let ahora = new Date();

  const diaNuevo = (): string => {
    const fecha = new Date(Date.UTC(2099, 7, 1) + dias++ * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return diaSemanaDe(fecha) === null ? diaNuevo() : fecha;
  };

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
    extra: { nombre?: string; activo?: boolean } = {},
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-nasig-v${vendedorIds.length + 1}-${SUFIJO}`,
        nombre:
          extra.nombre ?? `Vendedor nasig ${vendedorIds.length + 1} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
        activo: extra.activo ?? true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  /** Una nota a credito del cliente, `pendiente` por omision. */
  const sembrarNota = async (
    clienteId: string,
    sucursalId: string,
    status: 'pendiente' | 'pagada' = 'pendiente',
    extra: { contado?: boolean } = {},
  ): Promise<string> =>
    (
      await db
        .insertInto('venta_nota')
        .values({
          folio: `ZZN${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(
            0,
            30,
          ),
          fecha: '2099-01-01',
          cliente_id: clienteId,
          vendedor_id: null,
          monto_total: '100.00',
          num_nota: null,
          contado_credito: extra.contado ? 'contado' : 'credito',
          semana: 1,
          mes: 1,
          status,
          sucursal_id: sucursalId,
          origen: 'portal',
          capturo_usuario_id: usuarioIds[0],
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  const sembrarCliente = async (
    sucursalId: string,
    extra: { tipo?: 'cliente' | 'prospecto'; borrado?: boolean } = {},
  ): Promise<{ id: string; nombre: string }> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const prospecto = extra.tipo === 'prospecto';
    const nombre = `Nasig cliente ${++clientes} ${SUFIJO}`;
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre,
        domicilio: prospecto ? null : 'Calle 1',
        telefono: '6640000000',
        tipo: extra.tipo ?? 'cliente',
        lista_precio_id: prospecto ? null : lista.id,
        sucursal_id: sucursalId,
        deleted_at: extra.borrado ? new Date() : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return { id, nombre };
  };

  const sembrarRuta = async (valores: {
    vendedor: string;
    cliente: string;
    fecha: string;
    orden: number;
    origen?: 'oficina' | 'vendedor' | 'semanal';
    borrada?: boolean;
  }) =>
    (
      await db
        .insertInto('ruta')
        .values({
          vendedor_id: valores.vendedor,
          cliente_id: valores.cliente,
          fecha: valores.fecha,
          orden: valores.orden,
          origen: valores.origen ?? 'oficina',
          tipo: 'diaria',
          deleted_at: valores.borrada ? new Date() : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  const verNotas = (cookie: string, vendedorId: string, fecha: string) =>
    request(app.getHttpServer())
      .get(
        `/rutas/diaria/notas?${new URLSearchParams({ vendedorId, fecha }).toString()}`,
      )
      .set('Cookie', cookie);

  const asignar = (
    cookie: string,
    ventaNotaId: string,
    vendedorId: string,
    fecha: string,
    condicionVenta?: string,
  ) =>
    request(app.getHttpServer())
      .put(`/rutas/diaria/notas/${ventaNotaId}`)
      .set('Cookie', cookie)
      .send(
        condicionVenta === undefined
          ? { vendedorId, fecha }
          : { vendedorId, fecha, condicionVenta },
      );

  const quitar = (
    cookie: string,
    ventaNotaId: string,
    vendedorId: string,
    fecha: string,
  ) =>
    request(app.getHttpServer())
      .delete(
        `/rutas/diaria/notas/${ventaNotaId}?${new URLSearchParams({ vendedorId, fecha }).toString()}`,
      )
      .set('Cookie', cookie);

  const mensaje = (res: { body: unknown }) =>
    (res.body as { message: string | string[] }).message;

  const vivas = (ventaNotaId: string, fecha: string) =>
    db
      .selectFrom('nota_asignada')
      .select(['vendedor_id', 'deleted_at', 'quitada_por_usuario_id'])
      .where('venta_nota_id', '=', ventaNotaId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .orderBy('created_at')
      .execute();

  const condiciones = (ventaNotaId: string, fecha: string) =>
    db
      .selectFrom('nota_asignada')
      .select(['vendedor_id', 'condicion_venta', 'deleted_at', 'updated_at'])
      .where('venta_nota_id', '=', ventaNotaId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .orderBy('created_at')
      .execute();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RELOJ_RUTAS)
      .useValue(() => ahora)
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

    vendedorA = await sembrarVendedor(tjId, { nombre: `Ana ${SUFIJO}` });
    vendedorB = await sembrarVendedor(tjId, { nombre: `Beto ${SUFIJO}` });
    vendedorMx = await sembrarVendedor(mxId);
  });

  afterAll(async () => {
    await db
      .deleteFrom('nota_asignada')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    await db
      .deleteFrom('ruta')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    if (clienteIds.length > 0) {
      await db
        .deleteFrom('venta_nota')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  it('sin ruta_diaria.gestionar todo es 403', async () => {
    const fecha = diaNuevo();
    const id = '00000000-0000-4000-8000-000000000001';
    await verNotas(cookieSinPermiso, vendedorA, fecha).expect(403);
    await asignar(cookieSinPermiso, id, vendedorA, fecha).expect(403);
    await quitar(cookieSinPermiso, id, vendedorA, fecha).expect(403);
  });

  it('asigna una nota: sale en asignadas, con asignadaA, y en pendientes', async () => {
    const fecha = diaNuevo();
    const c = await sembrarCliente(tjId);
    await sembrarRuta({ vendedor: vendedorA, cliente: c.id, fecha, orden: 1 });
    const nota = await sembrarNota(c.id, tjId);

    const antes = (await verNotas(cookieGeneral, vendedorA, fecha).expect(200))
      .body as NotasDeRuta;
    expect(antes.pendientes.map((n) => n.ventaNotaId)).toEqual([nota]);
    expect(antes.pendientes[0].asignadaA).toBeNull();
    expect(antes.pendientes[0]).toMatchObject({
      clienteId: c.id,
      cliente: c.nombre,
      saldoCentavos: 10_000,
    });
    expect(antes.asignadas).toEqual([]);

    const res = await asignar(cookieGeneral, nota, vendedorA, fecha).expect(
      200,
    );
    const cuerpo = res.body as NotasDeRuta;
    expect(cuerpo.asignadas.map((n) => n.ventaNotaId)).toEqual([nota]);
    expect(cuerpo.asignadas[0].asignadaA).toMatchObject({
      vendedorId: vendedorA,
    });
    expect(cuerpo.pendientes[0].asignadaA?.vendedorId).toBe(vendedorA);
  });

  it("asignar sin condicionVenta guarda 'ninguna' y la respuesta trae asignadaA.condicionVenta = 'ninguna'", async () => {
    const fecha = diaNuevo();
    const c = await sembrarCliente(tjId);
    await sembrarRuta({ vendedor: vendedorA, cliente: c.id, fecha, orden: 1 });
    const nota = await sembrarNota(c.id, tjId);
    const res = await asignar(cookieGeneral, nota, vendedorA, fecha).expect(
      200,
    );
    expect(
      (res.body as NotasDeRuta).asignadas[0].asignadaA?.condicionVenta,
    ).toBe('ninguna');
    expect((await condiciones(nota, fecha))[0].condicion_venta).toBe('ninguna');
  });

  it("asignar con condicionVenta 'liquidar' la guarda", async () => {
    const fecha = diaNuevo();
    const c = await sembrarCliente(tjId);
    await sembrarRuta({ vendedor: vendedorA, cliente: c.id, fecha, orden: 1 });
    const nota = await sembrarNota(c.id, tjId);
    const res = await asignar(
      cookieGeneral,
      nota,
      vendedorA,
      fecha,
      'liquidar',
    ).expect(200);
    expect(
      (res.body as NotasDeRuta).asignadas[0].asignadaA?.condicionVenta,
    ).toBe('liquidar');
    expect((await condiciones(nota, fecha))[0].condicion_venta).toBe(
      'liquidar',
    );
  });

  it("condicionVenta 'otra' es 400 con 'La condición de venta no es válida.'", async () => {
    const fecha = diaNuevo();
    const c = await sembrarCliente(tjId);
    await sembrarRuta({ vendedor: vendedorA, cliente: c.id, fecha, orden: 1 });
    const nota = await sembrarNota(c.id, tjId);
    const res = await asignar(
      cookieGeneral,
      nota,
      vendedorA,
      fecha,
      'otra',
    ).expect(400);
    expect(mensaje(res)).toContain('La condición de venta no es válida.');
    expect(await condiciones(nota, fecha)).toEqual([]);
  });

  it('el mismo vendedor con otra condición no cambia nada', async () => {
    const fecha = diaNuevo();
    const c = await sembrarCliente(tjId);
    await sembrarRuta({ vendedor: vendedorA, cliente: c.id, fecha, orden: 1 });
    const nota = await sembrarNota(c.id, tjId);
    await asignar(cookieGeneral, nota, vendedorA, fecha, 'abonar').expect(200);
    const [antes] = await condiciones(nota, fecha);
    await asignar(cookieGeneral, nota, vendedorA, fecha, 'liquidar').expect(
      200,
    );
    const filas = await condiciones(nota, fecha);
    expect(filas).toHaveLength(1);
    expect(filas[0].condicion_venta).toBe('abonar');
    expect(filas[0].deleted_at).toBeNull();
    expect(filas[0].updated_at).toEqual(antes.updated_at);
  });

  it("pasar a otro vendedor con 'abonar': la de A conserva 'liquidar'", async () => {
    const fecha = diaNuevo();
    const c = await sembrarCliente(tjId);
    await sembrarRuta({ vendedor: vendedorA, cliente: c.id, fecha, orden: 1 });
    await sembrarRuta({ vendedor: vendedorB, cliente: c.id, fecha, orden: 1 });
    const nota = await sembrarNota(c.id, tjId);
    await asignar(cookieGeneral, nota, vendedorA, fecha, 'liquidar').expect(
      200,
    );
    await asignar(cookieGeneral, nota, vendedorB, fecha, 'abonar').expect(200);
    const filas = await condiciones(nota, fecha);
    expect(filas).toHaveLength(2);
    expect(filas[0].vendedor_id).toBe(vendedorA);
    expect(filas[0].deleted_at).not.toBeNull();
    expect(filas[0].condicion_venta).toBe('liquidar');
    expect(filas[1].vendedor_id).toBe(vendedorB);
    expect(filas[1].deleted_at).toBeNull();
    expect(filas[1].condicion_venta).toBe('abonar');
  });

  it('misma nota y mismo vendedor: 200 sin escribir', async () => {
    const fecha = diaNuevo();
    const c = await sembrarCliente(tjId);
    await sembrarRuta({ vendedor: vendedorA, cliente: c.id, fecha, orden: 1 });
    const nota = await sembrarNota(c.id, tjId);
    await asignar(cookieGeneral, nota, vendedorA, fecha).expect(200);
    const [antes] = await vivas(nota, fecha);
    await asignar(cookieGeneral, nota, vendedorA, fecha).expect(200);
    const filas = await vivas(nota, fecha);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toEqual(antes);
  });

  it('pasarla de A a B: A ya no la tiene y queda quien la quito', async () => {
    const fecha = diaNuevo();
    const c = await sembrarCliente(tjId);
    await sembrarRuta({ vendedor: vendedorA, cliente: c.id, fecha, orden: 1 });
    await sembrarRuta({ vendedor: vendedorB, cliente: c.id, fecha, orden: 1 });
    const nota = await sembrarNota(c.id, tjId);
    await asignar(cookieGeneral, nota, vendedorA, fecha).expect(200);

    const res = await asignar(cookieGeneral, nota, vendedorB, fecha).expect(
      200,
    );
    const deB = res.body as NotasDeRuta;
    expect(deB.asignadas.map((n) => n.ventaNotaId)).toEqual([nota]);

    const deA = (await verNotas(cookieGeneral, vendedorA, fecha).expect(200))
      .body as NotasDeRuta;
    expect(deA.asignadas).toEqual([]);
    expect(deA.pendientes[0].asignadaA?.vendedorId).toBe(vendedorB);

    const filas = await vivas(nota, fecha);
    expect(filas).toHaveLength(2);
    expect(filas[0].vendedor_id).toBe(vendedorA);
    expect(filas[0].deleted_at).not.toBeNull();
    expect(filas[0].quitada_por_usuario_id).toBe(usuarioIds[0]);
    expect(filas[1].vendedor_id).toBe(vendedorB);
    expect(filas[1].deleted_at).toBeNull();
  });

  it('pasarla a B cuando su cliente no esta en la ruta de B: 400 y A la conserva', async () => {
    const fecha = diaNuevo();
    const c = await sembrarCliente(tjId);
    await sembrarRuta({ vendedor: vendedorA, cliente: c.id, fecha, orden: 1 });
    const nota = await sembrarNota(c.id, tjId);
    await asignar(cookieGeneral, nota, vendedorA, fecha).expect(200);

    const res = await asignar(cookieGeneral, nota, vendedorB, fecha).expect(
      400,
    );
    expect(mensaje(res)).toBe(`Primero agrega a ${c.nombre} a la ruta.`);
    const filas = await vivas(nota, fecha);
    expect(filas).toHaveLength(1);
    expect(filas[0].vendedor_id).toBe(vendedorA);
    expect(filas[0].deleted_at).toBeNull();
  });

  it('quitarla desde A cuando ya la trae B no toca la de B', async () => {
    const fecha = diaNuevo();
    const c = await sembrarCliente(tjId);
    await sembrarRuta({ vendedor: vendedorA, cliente: c.id, fecha, orden: 1 });
    await sembrarRuta({ vendedor: vendedorB, cliente: c.id, fecha, orden: 1 });
    const nota = await sembrarNota(c.id, tjId);
    await asignar(cookieGeneral, nota, vendedorB, fecha).expect(200);

    await quitar(cookieGeneral, nota, vendedorA, fecha).expect(200);
    const filas = await vivas(nota, fecha);
    expect(filas).toHaveLength(1);
    expect(filas[0].vendedor_id).toBe(vendedorB);
    expect(filas[0].deleted_at).toBeNull();
  });

  it('quitarla: deja de estar asignada y vuelve a pendientes libre', async () => {
    const fecha = diaNuevo();
    const c = await sembrarCliente(tjId);
    await sembrarRuta({ vendedor: vendedorA, cliente: c.id, fecha, orden: 1 });
    const nota = await sembrarNota(c.id, tjId);
    await asignar(cookieGeneral, nota, vendedorA, fecha).expect(200);

    const res = await quitar(cookieGeneral, nota, vendedorA, fecha).expect(200);
    const cuerpo = res.body as NotasDeRuta;
    expect(cuerpo.asignadas).toEqual([]);
    expect(cuerpo.pendientes[0].asignadaA).toBeNull();
    const [fila] = await vivas(nota, fecha);
    expect(fila.deleted_at).not.toBeNull();
    expect(fila.quitada_por_usuario_id).toBe(usuarioIds[0]);

    // Quitar lo que no esta asignada es inofensivo.
    await quitar(cookieGeneral, nota, vendedorA, fecha).expect(200);
  });

  it('un cliente fuera de la ruta de ese dia: 400 con su nombre', async () => {
    const fecha = diaNuevo();
    const c = await sembrarCliente(tjId);
    const nota = await sembrarNota(c.id, tjId);
    const res = await asignar(cookieGeneral, nota, vendedorA, fecha).expect(
      400,
    );
    expect(mensaje(res)).toBe(`Primero agrega a ${c.nombre} a la ruta.`);
    expect(await vivas(nota, fecha)).toEqual([]);
  });

  it('una nota sin saldo: 409', async () => {
    const fecha = diaNuevo();
    const c = await sembrarCliente(tjId);
    await sembrarRuta({ vendedor: vendedorA, cliente: c.id, fecha, orden: 1 });
    const pagada = await sembrarNota(c.id, tjId, 'pagada');
    const contado = await sembrarNota(c.id, tjId, 'pendiente', {
      contado: true,
    });
    const r1 = await asignar(cookieGeneral, pagada, vendedorA, fecha).expect(
      409,
    );
    expect(mensaje(r1)).toBe('Esa nota ya no tiene saldo.');
    await asignar(cookieGeneral, contado, vendedorA, fecha).expect(409);
  });

  it('una nota pagada despues de asignarla sale de pendientes pero sigue en asignadas', async () => {
    const fecha = diaNuevo();
    const c = await sembrarCliente(tjId);
    await sembrarRuta({ vendedor: vendedorA, cliente: c.id, fecha, orden: 1 });
    const nota = await sembrarNota(c.id, tjId);
    await asignar(cookieGeneral, nota, vendedorA, fecha).expect(200);
    await db
      .updateTable('venta_nota')
      .set({ status: 'pagada' })
      .where('id', '=', nota)
      .execute();

    const cuerpo = (await verNotas(cookieGeneral, vendedorA, fecha).expect(200))
      .body as NotasDeRuta;
    expect(cuerpo.pendientes).toEqual([]);
    expect(cuerpo.asignadas.map((n) => n.ventaNotaId)).toEqual([nota]);
    expect(cuerpo.asignadas[0].saldoCentavos).toBe(0);
  });

  it('una venta eliminada despues de asignarla ya no sale en asignadas', async () => {
    const fecha = diaNuevo();
    const c = await sembrarCliente(tjId);
    await sembrarRuta({ vendedor: vendedorA, cliente: c.id, fecha, orden: 1 });
    const nota = await sembrarNota(c.id, tjId);
    await asignar(cookieGeneral, nota, vendedorA, fecha).expect(200);
    await db
      .updateTable('venta_nota')
      .set({ deleted_at: new Date() })
      .where('id', '=', nota)
      .execute();
    const cuerpo = (await verNotas(cookieGeneral, vendedorA, fecha).expect(200))
      .body as NotasDeRuta;
    expect(cuerpo.asignadas).toEqual([]);
  });

  it('una nota del mismo dia (hoy) se puede asignar', async () => {
    const hoyReal = new Date();
    const hoy = hoyReal.toISOString().slice(0, 10);
    ahora = new Date(`${hoy}T20:00:00Z`);
    try {
      const c = await sembrarCliente(tjId);
      await sembrarRuta({
        vendedor: vendedorA,
        cliente: c.id,
        fecha: hoy,
        orden: 1,
      });
      const nota = await sembrarNota(c.id, tjId);
      await db
        .updateTable('venta_nota')
        .set({ fecha: hoy })
        .where('id', '=', nota)
        .execute();
      const res = await asignar(cookieGeneral, nota, vendedorA, hoy).expect(
        200,
      );
      expect((res.body as NotasDeRuta).asignadas).toHaveLength(1);
    } finally {
      ahora = new Date();
    }
  });

  it('un dia pasado es de solo lectura: 400', async () => {
    const c = await sembrarCliente(tjId);
    const nota = await sembrarNota(c.id, tjId);
    const res = await asignar(
      cookieGeneral,
      nota,
      vendedorA,
      '2000-01-03',
    ).expect(400);
    expect(mensaje(res)).toBe('Ese día ya pasó; solo se puede consultar.');
    await quitar(cookieGeneral, nota, vendedorA, '2000-01-03').expect(400);
  });

  it('otra sucursal es 404: el vendedor, o la nota', async () => {
    const fecha = diaNuevo();
    const c = await sembrarCliente(tjId);
    const nota = await sembrarNota(c.id, tjId);
    await verNotas(cookieTijuana, vendedorMx, fecha).expect(404);
    await asignar(cookieTijuana, nota, vendedorMx, fecha).expect(404);
    await quitar(cookieTijuana, nota, vendedorMx, fecha).expect(404);

    // Una nota de un cliente de MX con un vendedor de TJ.
    const cMx = await sembrarCliente(mxId);
    const notaMx = await sembrarNota(cMx.id, mxId);
    await asignar(cookieGeneral, notaMx, vendedorA, fecha).expect(404);
    // Una nota que no existe.
    await asignar(
      cookieGeneral,
      '00000000-0000-4000-8000-000000000002',
      vendedorA,
      fecha,
    ).expect(404);
  });

  it('dos asignaciones a la vez de la misma nota: una sola queda viva', async () => {
    const fecha = diaNuevo();
    const c = await sembrarCliente(tjId);
    await sembrarRuta({ vendedor: vendedorA, cliente: c.id, fecha, orden: 1 });
    await sembrarRuta({ vendedor: vendedorB, cliente: c.id, fecha, orden: 1 });
    const nota = await sembrarNota(c.id, tjId);
    const [r1, r2] = await Promise.all([
      asignar(cookieGeneral, nota, vendedorA, fecha),
      asignar(cookieGeneral, nota, vendedorB, fecha),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const filas = await vivas(nota, fecha);
    expect(filas.filter((f) => f.deleted_at === null)).toHaveLength(1);
  });
});

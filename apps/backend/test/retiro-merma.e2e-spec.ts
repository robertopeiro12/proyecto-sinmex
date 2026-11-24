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
import type {
  OperacionAlmacen,
  OperacionesDelDia,
} from './../src/modules/produccion/operaciones-almacen.service';

/**
 * Retiro de merma con autorizacion (Registro de Operacion, parte 2), de punta a
 * punta: pedir/corregir/eliminar con `operacion.retiro_merma`; autorizar y
 * rechazar con `peticiones.gestionar`; transiciones; carreras; alcance.
 * Sucursales (ZQ, ZR), usuarios y presentaciones son de esta corrida.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const K = 'ZQ';
const L = 'ZR';
const PRODUCTO = `ZZ-retm-${SUFIJO}`;

interface Retiros {
  retiros: OperacionAlmacen[];
}

describe('Retiro de merma (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let hoy: string;
  const usuarioIds: string[] = [];
  const productoIds: string[] = [];
  const sucursalIds: string[] = [];
  let kId: string;
  let lId: string;
  let litro: string;
  let medio: string;

  let cookieGeneral: string;
  let cookiePide: string; // atado a K: solo operacion.retiro_merma
  let cookieAdminK: string; // atado a K: solo peticiones.gestionar
  let cookieAdminL: string; // atado a L: solo peticiones.gestionar
  let cookieSin: string; // atado a K: sin permisos

  const http = () => request(app.getHttpServer());

  const iniciarSesion = async (login: string): Promise<string> => {
    const res = await http()
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
    permisos: string[] = [],
  ): Promise<string> => {
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
    for (const clave of permisos) {
      const { id: permisoId } = await db
        .selectFrom('permiso')
        .select('id')
        .where('clave', '=', clave)
        .executeTakeFirstOrThrow();
      await db
        .insertInto('usuario_permiso')
        .values({ usuario_id: id, permiso_id: permisoId, habilitado: true })
        .execute();
    }
    return id;
  };

  const crearSucursal = async (codigo: string): Promise<string> => {
    const { id } = await db
      .insertInto('sucursal')
      .values({ codigo, nombre: `Prueba ${codigo} ${SUFIJO}` })
      .returning('id')
      .executeTakeFirstOrThrow();
    sucursalIds.push(id);
    return id;
  };

  const crearPresentacion = async (volumen: string): Promise<string> => {
    let productoId = productoIds[0];
    if (!productoId) {
      productoId = (
        await db
          .insertInto('producto')
          .values({ nombre: PRODUCTO, activo: true })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      productoIds.push(productoId);
    }
    return (
      await db
        .insertInto('presentacion')
        .values({ producto_id: productoId, volumen })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  };

  const cuerpo = (
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    tipo: 'retiro_merma',
    sucursal: K,
    fecha: hoy,
    lineas: [
      { presentacionId: litro, piezas: 10 },
      { presentacionId: medio, piezas: 5 },
    ],
    ...extra,
  });

  const crear = async (
    extra: Record<string, unknown> = {},
    cookie = cookiePide,
  ): Promise<OperacionAlmacen> =>
    (
      await http()
        .post('/operaciones-almacen')
        .set('Cookie', cookie)
        .send(cuerpo(extra))
        .expect(201)
    ).body as OperacionAlmacen;

  const cuerpoEdicion = (extra: Record<string, unknown> = {}) => ({
    fecha: hoy,
    lineas: [{ presentacionId: litro, piezas: 7 }],
    ...extra,
  });

  const autorizar = (id: string, cookie = cookieAdminK) =>
    http().post(`/operaciones-almacen/${id}/autorizar`).set('Cookie', cookie);
  const rechazar = (id: string, motivo: unknown, cookie = cookieAdminK) =>
    http()
      .post(`/operaciones-almacen/${id}/rechazar`)
      .set('Cookie', cookie)
      .send({ motivo });
  const editar = (id: string, extra = {}, cookie = cookiePide) =>
    http()
      .put(`/operaciones-almacen/${id}`)
      .set('Cookie', cookie)
      .send(cuerpoEdicion(extra));
  const pendientes = async (cookie: string, sucursal?: string) =>
    (
      await http()
        .get('/operaciones-almacen/retiros-pendientes')
        .query(sucursal ? { sucursal } : {})
        .set('Cookie', cookie)
        .expect(200)
    ).body as Retiros;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    hoy = (
      await sql<{
        hoy: string;
      }>`select to_char((now() at time zone 'America/Tijuana')::date, 'YYYY-MM-DD') as hoy`.execute(
        db,
      )
    ).rows[0].hoy;

    kId = await crearSucursal(K);
    lId = await crearSucursal(L);
    litro = await crearPresentacion('1 L');
    medio = await crearPresentacion('500 ml');

    await crearUsuario(`e2e-retm-gen-${SUFIJO}`, 'Administrador General', null);
    await crearUsuario(`e2e-retm-p-${SUFIJO}`, 'Auxiliar Administrativo', kId, [
      'operacion.retiro_merma',
    ]);
    await crearUsuario(
      `e2e-retm-ak-${SUFIJO}`,
      'Auxiliar Administrativo',
      kId,
      ['peticiones.gestionar'],
    );
    await crearUsuario(
      `e2e-retm-al-${SUFIJO}`,
      'Auxiliar Administrativo',
      lId,
      ['peticiones.gestionar'],
    );
    await crearUsuario(
      `e2e-retm-sin-${SUFIJO}`,
      'Auxiliar Administrativo',
      kId,
    );

    cookieGeneral = await iniciarSesion(`e2e-retm-gen-${SUFIJO}`);
    cookiePide = await iniciarSesion(`e2e-retm-p-${SUFIJO}`);
    cookieAdminK = await iniciarSesion(`e2e-retm-ak-${SUFIJO}`);
    cookieAdminL = await iniciarSesion(`e2e-retm-al-${SUFIJO}`);
    cookieSin = await iniciarSesion(`e2e-retm-sin-${SUFIJO}`);
  });

  afterAll(async () => {
    const ops = db
      .selectFrom('operacion_almacen')
      .select('id')
      .where('sucursal_id', 'in', sucursalIds);
    await db
      .deleteFrom('operacion_almacen_linea')
      .where('operacion_id', 'in', ops)
      .execute();
    await db
      .deleteFrom('operacion_almacen')
      .where('sucursal_id', 'in', sucursalIds)
      .execute();
    await db
      .deleteFrom('presentacion')
      .where('producto_id', 'in', productoIds)
      .execute();
    await db.deleteFrom('producto').where('id', 'in', productoIds).execute();
    await db
      .deleteFrom('usuario_permiso')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await db.deleteFrom('sucursal').where('id', 'in', sucursalIds).execute();
    await app.close();
  });

  describe('pedir, corregir y eliminar', () => {
    it('nace pendiente, sin resolucion, y sale en la lista del dia', async () => {
      const r = await crear({ comentario: 'Se rompieron en el camión' });
      expect(r).toMatchObject({
        tipo: 'retiro_merma',
        estado: 'pendiente',
        resolucion: null,
        editable: true,
        piezas: 15,
        origen: null,
        destino: null,
        motivo: null,
        trabajador: null,
        comentario: 'Se rompieron en el camión',
      });
      const lista = (
        await http()
          .get('/operaciones-almacen')
          .query({ sucursal: K, fecha: hoy, tipo: 'retiro_merma' })
          .set('Cookie', cookiePide)
          .expect(200)
      ).body as OperacionesDelDia;
      expect(lista.operaciones.map((o) => o.id)).toContain(r.id);
    });

    it('sin operacion.retiro_merma: 403 al pedir, listar, corregir y eliminar', async () => {
      await http()
        .post('/operaciones-almacen')
        .set('Cookie', cookieSin)
        .send(cuerpo())
        .expect(403);
      await http()
        .get('/operaciones-almacen')
        .query({ fecha: hoy, tipo: 'retiro_merma' })
        .set('Cookie', cookieSin)
        .expect(403);
      const r = await crear();
      await editar(r.id, {}, cookieSin).expect(403);
      await http()
        .delete(`/operaciones-almacen/${r.id}`)
        .set('Cookie', cookieSin)
        .expect(403);
      // quien solo autoriza tampoco puede pedir
      await http()
        .post('/operaciones-almacen')
        .set('Cookie', cookieAdminK)
        .send(cuerpo())
        .expect(403);
    });

    it('fecha futura = 400; un dia anterior entra', async () => {
      await http()
        .post('/operaciones-almacen')
        .set('Cookie', cookiePide)
        .send(cuerpo({ fecha: '2999-01-01' }))
        .expect(400);
      const r = await crear({ fecha: '2026-01-05' });
      expect(r.fecha).toBe('2026-01-05');
    });

    it('un pendiente se corrige y se elimina', async () => {
      const r = await crear();
      const corregido = (await editar(r.id).expect(200))
        .body as OperacionAlmacen;
      expect(corregido).toMatchObject({ estado: 'pendiente', piezas: 7 });
      await http()
        .delete(`/operaciones-almacen/${r.id}`)
        .set('Cookie', cookiePide)
        .expect(204);
      await http()
        .get(`/operaciones-almacen/${r.id}`)
        .set('Cookie', cookiePide)
        .expect(404);
    });
  });

  describe('autorizar y rechazar', () => {
    it('autorizar: queda autorizado con quien y cuando, y ya no se toca', async () => {
      const r = await crear();
      const a = (await autorizar(r.id).expect(200)).body as OperacionAlmacen;
      expect(a.estado).toBe('autorizado');
      expect(a.editable).toBe(false);
      expect(a.resolucion).toMatchObject({
        por: `e2e-retm-ak-${SUFIJO}`,
        motivo: null,
      });
      expect(a.resolucion!.en).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      await editar(r.id).expect(409);
      await http()
        .delete(`/operaciones-almacen/${r.id}`)
        .set('Cookie', cookiePide)
        .expect(409);
      await autorizar(r.id).expect(409);
      await rechazar(r.id, 'tarde').expect(409);
    });

    it('rechazar: guarda el motivo; editar lo regresa a pendiente y limpia la resolucion', async () => {
      const r = await crear();
      const x = (
        await rechazar(r.id, '  No coincide con lo contado  ').expect(200)
      ).body as OperacionAlmacen;
      expect(x).toMatchObject({
        estado: 'rechazado',
        editable: true,
        resolucion: {
          por: `e2e-retm-ak-${SUFIJO}`,
          motivo: 'No coincide con lo contado',
        },
      });
      // un rechazado no se vuelve a autorizar ni a rechazar
      await autorizar(r.id).expect(409);
      await rechazar(r.id, 'otra vez').expect(409);

      const e = (await editar(r.id).expect(200)).body as OperacionAlmacen;
      expect(e).toMatchObject({
        estado: 'pendiente',
        resolucion: null,
        piezas: 7,
      });
      const fila = await db
        .selectFrom('operacion_almacen')
        .select(['motivo_rechazo', 'resuelto_por_usuario_id', 'resuelto_en'])
        .where('id', '=', r.id)
        .executeTakeFirstOrThrow();
      expect(fila).toEqual({
        motivo_rechazo: null,
        resuelto_por_usuario_id: null,
        resuelto_en: null,
      });
      // vuelve a salir en la bandeja de pendientes (Review Focus 4)
      expect(
        (await pendientes(cookieAdminK)).retiros.map((x) => x.id),
      ).toContain(r.id);
      // y un rechazado tambien se puede eliminar
      const r2 = await crear();
      await rechazar(r2.id, 'mal').expect(200);
      await http()
        .delete(`/operaciones-almacen/${r2.id}`)
        .set('Cookie', cookiePide)
        .expect(204);
    });

    it('rechazar sin motivo o con motivo de mas de 300 = 400; 300 entra', async () => {
      const r = await crear();
      await rechazar(r.id, undefined).expect(400);
      await rechazar(r.id, '   ').expect(400);
      await rechazar(r.id, 'x'.repeat(301)).expect(400);
      expect(
        (
          (await rechazar(r.id, 'x'.repeat(300)).expect(200))
            .body as OperacionAlmacen
        ).estado,
      ).toBe('rechazado');
    });

    it('sin peticiones.gestionar: 403 al autorizar, rechazar y ver pendientes', async () => {
      const r = await crear();
      await autorizar(r.id, cookiePide).expect(403);
      await rechazar(r.id, 'x', cookiePide).expect(403);
      await http()
        .get('/operaciones-almacen/retiros-pendientes')
        .set('Cookie', cookiePide)
        .expect(403);
      await http()
        .get('/operaciones-almacen/retiros-pendientes')
        .set('Cookie', cookieSin)
        .expect(403);
      expect(
        (
          (
            await http()
              .get(`/operaciones-almacen/${r.id}`)
              .set('Cookie', cookiePide)
              .expect(200)
          ).body as OperacionAlmacen
        ).estado,
      ).toBe('pendiente');
    });

    it('autorizar una operacion que no es retiro, o inexistente = 404', async () => {
      await autorizar('3f2504e0-4f89-41d3-9a0c-0305e82c3301').expect(404);
      const { id } = await db
        .insertInto('operacion_almacen')
        .values({
          sucursal_id: kId,
          tipo: 'consumo',
          fecha: sql<Date>`${hoy}::date`,
          capturo_usuario_id: usuarioIds[0],
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await autorizar(id).expect(404);
      await rechazar(id, 'x').expect(404);
    });
  });

  describe('carreras (Review Focus 1 y 2)', () => {
    it('autorizar dos veces a la vez: una gana, la otra 409', async () => {
      const r = await crear();
      const [a, b] = await Promise.all([
        autorizar(r.id, cookieAdminK),
        autorizar(r.id, cookieGeneral),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
    });

    it('autorizar y rechazar a la vez: una gana, la otra 409', async () => {
      const r = await crear();
      const [a, b] = await Promise.all([autorizar(r.id), rechazar(r.id, 'no')]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
    });

    it('editar y autorizar a la vez: el que llega despues ve el estado nuevo', async () => {
      for (let i = 0; i < 4; i++) {
        const r = await crear();
        const [e, a] = await Promise.all([editar(r.id), autorizar(r.id)]);
        // Autorizar siempre se aplica (el pendiente sigue pendiente tras editar);
        // editar gana o pierde con un 409 segun quien tomo el candado primero.
        expect(a.status).toBe(200);
        expect([200, 409]).toContain(e.status);
        const fila = await db
          .selectFrom('operacion_almacen')
          .select('estado')
          .where('id', '=', r.id)
          .executeTakeFirstOrThrow();
        expect(fila.estado).toBe('autorizado');
        if (e.status === 200)
          expect((e.body as OperacionAlmacen).estado).toBe('pendiente');
      }
    });
  });

  describe('alcance de sucursal (Review Focus 3)', () => {
    it('el pendiente de otra sucursal ni se ve ni se autoriza', async () => {
      const deK = await crear();
      const deL = await crear({ sucursal: L }, cookieGeneral);

      const k = (await pendientes(cookieAdminK)).retiros.map((x) => x.id);
      expect(k).toContain(deK.id);
      expect(k).not.toContain(deL.id);
      const l = (await pendientes(cookieAdminL)).retiros.map((x) => x.id);
      expect(l).toContain(deL.id);
      expect(l).not.toContain(deK.id);

      await autorizar(deL.id, cookieAdminK).expect(404);
      await rechazar(deL.id, 'x', cookieAdminK).expect(404);
      await autorizar(deK.id, cookieAdminL).expect(404);

      // pedir otra sucursal por nombre = 403
      await http()
        .get('/operaciones-almacen/retiros-pendientes')
        .query({ sucursal: L })
        .set('Cookie', cookieAdminK)
        .expect(403);
      // "todas" para un atado = la suya
      const todasK = (await pendientes(cookieAdminK, 'todas')).retiros.map(
        (x) => x.id,
      );
      expect(todasK).not.toContain(deL.id);

      // el General ve todas, una sola, o las dos
      const g = (await pendientes(cookieGeneral, 'todas')).retiros.map(
        (x) => x.id,
      );
      expect(g).toEqual(expect.arrayContaining([deK.id, deL.id]));
      const soloL = (await pendientes(cookieGeneral, L)).retiros.map(
        (x) => x.id,
      );
      expect(soloL).toContain(deL.id);
      expect(soloL).not.toContain(deK.id);
      await autorizar(deL.id, cookieGeneral).expect(200);
    });

    it('la bandeja solo trae pendientes, en el orden en que se pidieron', async () => {
      const a = await crear();
      const b = await crear();
      const c = await crear();
      await autorizar(b.id).expect(200);
      const ids = (await pendientes(cookieAdminK, K)).retiros.map((x) => x.id);
      expect(ids).not.toContain(b.id);
      expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(c.id));
      const una = (await pendientes(cookieAdminK, K)).retiros.find(
        (x) => x.id === a.id,
      )!;
      expect(una).toMatchObject({
        estado: 'pendiente',
        sucursal: { codigo: K },
        piezas: 15,
      });
    });
  });
});

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
  CargaRejilla,
  Rejilla,
} from './../src/modules/produccion/reglas-carga';

/**
 * Produccion › Recarga (T-27 pieza 1), de punta a punta: permiso, alcance (otra
 * sucursal = 404), numeracion, edicion con version y baja logica.
 *
 * El POST crea la carga de HOY en Tijuana (D8). Los vendedores son nuevos en cada
 * corrida (`SUFIJO`), asi que su numeracion empieza en 1.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-carga-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-carga-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-carga-sin-${SUFIJO}`;
const PRODUCTO = `ZZ-carga-${SUFIJO}`;

type Cuerpo = Record<string, unknown>;

describe('Recarga desde el portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let mxId: string;
  let hoy: string;
  const usuarioIds: string[] = [];
  const vendedorIds: string[] = [];
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let vendedorTj: string;
  let vendedorTjInactivo: string;
  let vendedorMx: string;
  let productoId: string;
  let litro: string;
  let medio: string;
  let borrada: string;

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
    nombre: string,
    activo = true,
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-carga-v${vendedorIds.length + 1}-${SUFIJO}`,
        nombre: `${nombre} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
        activo,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  const rejilla = (cookie: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/cargas?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const crear = (cookie: string, cuerpo: Cuerpo) =>
    request(app.getHttpServer())
      .post('/cargas')
      .set('Cookie', cookie)
      .send(cuerpo);

  const editar = (cookie: string, id: string, cuerpo: Cuerpo) =>
    request(app.getHttpServer())
      .patch(`/cargas/${id}`)
      .set('Cookie', cookie)
      .send(cuerpo);

  const eliminar = (cookie: string, id: string, cuerpo: Cuerpo) =>
    request(app.getHttpServer())
      .delete(`/cargas/${id}`)
      .set('Cookie', cookie)
      .send(cuerpo);

  /** Una carga nueva de `vendedor` con `piezas` de 1 L; devuelve la respuesta. */
  const cargaDe = async (
    vendedor: string,
    piezas = 24,
  ): Promise<CargaRejilla> =>
    (
      await crear(cookieGeneral, {
        vendedorId: vendedor,
        lineas: [{ presentacionId: litro, piezas }],
      }).expect(201)
    ).body as CargaRejilla;

  /** Pone una carga en un estado de respuesta, como lo haria la Tarea 3. */
  const responderEnBase = (id: string, estado: 'aceptada' | 'rechazada') =>
    db
      .updateTable('carga')
      .set({
        estado,
        motivo_rechazo: estado === 'rechazada' ? 'Faltan 2 cajas' : null,
        respondida_en: new Date(),
      })
      .where('id', '=', id)
      .execute();

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
      .select(['id', 'codigo'])
      .where('codigo', 'in', ['TJ', 'MX'])
      .execute();
    tjId = sucursales.find((s) => s.codigo === 'TJ')!.id;
    mxId = sucursales.find((s) => s.codigo === 'MX')!.id;
    hoy = (
      await sql<{ hoy: string }>`
        select to_char((now() at time zone 'America/Tijuana')::date, 'YYYY-MM-DD') as hoy
      `.execute(db)
    ).rows[0].hoy;

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', tjId);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);

    vendedorTj = await sembrarVendedor(tjId, 'Berta Carga');
    vendedorTjInactivo = await sembrarVendedor(tjId, 'Inactivo Carga', false);
    vendedorMx = await sembrarVendedor(mxId, 'Mario Carga');

    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: PRODUCTO })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const presentacion = async (volumen: string, borradaYa = false) =>
      (
        await db
          .insertInto('presentacion')
          .values({
            producto_id: productoId,
            volumen,
            deleted_at: borradaYa ? new Date() : null,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    litro = await presentacion('1 L');
    medio = await presentacion('500 ml');
    borrada = await presentacion('2 L', true);
  });

  afterAll(async () => {
    const cargas = db
      .selectFrom('carga')
      .select('id')
      .where('vendedor_id', 'in', vendedorIds);
    await db
      .deleteFrom('carga_detalle')
      .where('carga_id', 'in', cargas)
      .execute();
    await db
      .deleteFrom('carga')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    await db
      .deleteFrom('presentacion')
      .where('producto_id', '=', productoId)
      .execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
    await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  describe('permiso y alcance', () => {
    it('sin carga.gestionar todo es 403, lectura incluida', async () => {
      const id = '00000000-0000-4000-8000-000000000000';
      await rejilla(cookieSinPermiso, { fecha: hoy, sucursal: tjId }).expect(
        403,
      );
      await crear(cookieSinPermiso, {
        vendedorId: vendedorTj,
        lineas: [{ presentacionId: litro, piezas: 1 }],
      }).expect(403);
      await editar(cookieSinPermiso, id, {
        version: 1,
        lineas: [{ presentacionId: litro, piezas: 1 }],
      }).expect(403);
      await eliminar(cookieSinPermiso, id, { version: 1 }).expect(403);
    });

    it('un usuario atado a TJ ve la suya sin pedirla; pedir MX es 404, no 403', async () => {
      const res = await rejilla(cookieTijuana, { fecha: hoy }).expect(200);
      expect((res.body as Rejilla).sucursal.codigo).toBe('TJ');
      await rejilla(cookieTijuana, { fecha: hoy, sucursal: mxId }).expect(404);
    });

    it('un General tiene que elegir la sucursal; una inexistente es 404', async () => {
      await rejilla(cookieGeneral, { fecha: hoy }).expect(400);
      await rejilla(cookieGeneral, {
        fecha: hoy,
        sucursal: '00000000-0000-4000-8000-000000000000',
      }).expect(404);
    });

    it('un usuario de TJ no captura ni toca cargas de un vendedor de MX: 404', async () => {
      await crear(cookieTijuana, {
        vendedorId: vendedorMx,
        lineas: [{ presentacionId: litro, piezas: 5 }],
      }).expect(404);
      const ajena = await cargaDe(vendedorMx);
      await editar(cookieTijuana, ajena.id, {
        version: 1,
        lineas: [{ presentacionId: litro, piezas: 6 }],
      }).expect(404);
      await eliminar(cookieTijuana, ajena.id, { version: 1 }).expect(404);
    });
  });

  describe('POST /cargas', () => {
    it('numera 1, 2, 3 y una baja libera el ultimo numero', async () => {
      const vendedor = await sembrarVendedor(tjId, 'Numeracion Carga');
      const uno = await cargaDe(vendedor);
      const dos = await cargaDe(vendedor);
      const tres = await cargaDe(vendedor);
      expect([uno.numero, dos.numero, tres.numero]).toEqual([1, 2, 3]);
      expect(uno).toMatchObject({
        estado: 'pendiente',
        version: 1,
        motivoRechazo: null,
        respondidaEn: null,
        lineas: [{ presentacionId: litro, piezas: 24 }],
      });

      await eliminar(cookieGeneral, tres.id, { version: 1 }).expect(200);
      expect((await cargaDe(vendedor)).numero).toBe(3);
    });

    it('la carga es de hoy en Tijuana y guarda quien la capturo', async () => {
      const carga = await cargaDe(vendedorTj);
      const fila = await db
        .selectFrom('carga')
        .select([
          sql<string>`to_char(fecha, 'YYYY-MM-DD')`.as('fecha'),
          'capturo_usuario_id',
          'sucursal_id',
        ])
        .where('id', '=', carga.id)
        .executeTakeFirstOrThrow();
      expect(fila).toEqual({
        fecha: hoy,
        capturo_usuario_id: usuarioIds[0],
        sucursal_id: tjId,
      });
    });

    it('valida las lineas: vacias, repetidas, dada de baja y piezas fuera de rango', async () => {
      const base = { vendedorId: vendedorTj };
      await crear(cookieGeneral, { ...base, lineas: [] }).expect(400);
      const repetida = await crear(cookieGeneral, {
        ...base,
        lineas: [
          { presentacionId: litro, piezas: 1 },
          { presentacionId: litro, piezas: 2 },
        ],
      }).expect(400);
      expect((repetida.body as { message: string }).message).toBe(
        'Un producto viene dos veces en la carga.',
      );
      await crear(cookieGeneral, {
        ...base,
        lineas: [{ presentacionId: borrada, piezas: 1 }],
      }).expect(400);
      for (const piezas of [0, 100_000, 1.5]) {
        await crear(cookieGeneral, {
          ...base,
          lineas: [{ presentacionId: litro, piezas }],
        }).expect(400);
      }
    });

    it('a un vendedor desactivado no se le captura: 400', async () => {
      await crear(cookieGeneral, {
        vendedorId: vendedorTjInactivo,
        lineas: [{ presentacionId: litro, piezas: 1 }],
      }).expect(400);
    });
  });

  describe('GET /cargas', () => {
    it('la rejilla trae las presentaciones activas en su orden y las cargas del vendedor', async () => {
      const vendedor = await sembrarVendedor(tjId, 'Aaron Rejilla');
      const carga = (
        await crear(cookieGeneral, {
          vendedorId: vendedor,
          lineas: [
            { presentacionId: litro, piezas: 24 },
            { presentacionId: medio, piezas: 12 },
          ],
        }).expect(201)
      ).body as CargaRejilla;

      const r = (
        await rejilla(cookieGeneral, { fecha: hoy, sucursal: tjId }).expect(200)
      ).body as Rejilla;
      const mias = r.presentaciones.filter(
        (p) => p.productoNombre === PRODUCTO,
      );
      // 500 ml antes que 1 L; la dada de baja no sale (ninguna carga la trae).
      expect(mias.map((p) => p.id)).toEqual([medio, litro]);
      const columna = r.vendedores.find((v) => v.id === vendedor);
      expect(columna?.cargas.map((c) => c.id)).toEqual([carga.id]);
      expect(r.vendedores.some((v) => v.id === vendedorTjInactivo)).toBe(false);
      expect(r.vendedores.some((v) => v.id === vendedorMx)).toBe(false);
    });

    it('una fecha que no existe es 400', async () => {
      await rejilla(cookieGeneral, {
        fecha: '2026-02-30',
        sucursal: tjId,
      }).expect(400);
    });
  });

  describe('PATCH y DELETE (D5)', () => {
    it('editar una pendiente reemplaza las lineas y sube la version', async () => {
      const carga = await cargaDe(vendedorTj);
      const res = await editar(cookieGeneral, carga.id, {
        version: 1,
        lineas: [{ presentacionId: medio, piezas: 6 }],
      }).expect(200);
      expect(res.body as CargaRejilla).toMatchObject({
        id: carga.id,
        version: 2,
        estado: 'pendiente',
        lineas: [{ presentacionId: medio, piezas: 6 }],
      });
    });

    it('con la version vieja es 409 y trae la carga actual', async () => {
      const carga = await cargaDe(vendedorTj);
      await editar(cookieGeneral, carga.id, {
        version: 1,
        lineas: [{ presentacionId: litro, piezas: 30 }],
      }).expect(200);
      const viejo = await editar(cookieGeneral, carga.id, {
        version: 1,
        lineas: [{ presentacionId: litro, piezas: 31 }],
      }).expect(409);
      const cuerpo = viejo.body as { message: string; carga: CargaRejilla };
      expect(cuerpo.message).toBe(
        'La carga cambió mientras la editabas; recarga la página.',
      );
      expect(cuerpo.carga.version).toBe(2);
      await eliminar(cookieGeneral, carga.id, { version: 1 }).expect(409);
    });

    it('editar una rechazada la regresa a pendiente y limpia motivo y respuesta', async () => {
      const carga = await cargaDe(vendedorTj);
      await responderEnBase(carga.id, 'rechazada');
      const res = await editar(cookieGeneral, carga.id, {
        version: 1,
        lineas: [{ presentacionId: litro, piezas: 26 }],
      }).expect(200);
      expect(res.body as CargaRejilla).toMatchObject({
        estado: 'pendiente',
        motivoRechazo: null,
        respondidaEn: null,
        version: 2,
      });
    });

    it('una aceptada no se edita ni se elimina: 409', async () => {
      const carga = await cargaDe(vendedorTj);
      await responderEnBase(carga.id, 'aceptada');
      const res = await editar(cookieGeneral, carga.id, {
        version: 1,
        lineas: [{ presentacionId: litro, piezas: 1 }],
      }).expect(409);
      expect((res.body as { message: string }).message).toContain(
        'Una carga aceptada no se modifica',
      );
      await eliminar(cookieGeneral, carga.id, { version: 1 }).expect(409);
    });

    it('una carga de otro dia es de solo lectura (D8): 409', async () => {
      const { id } = await db
        .insertInto('carga')
        .values({
          sucursal_id: tjId,
          vendedor_id: vendedorTj,
          fecha: '2015-06-15',
          numero: 1,
          capturo_usuario_id: usuarioIds[0],
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const res = await eliminar(cookieGeneral, id, { version: 1 }).expect(409);
      expect((res.body as { message: string }).message).toBe(
        'Solo se modifican las cargas de hoy.',
      );
    });

    it('eliminar es baja logica: desaparece de la rejilla y la segunda vez es 404', async () => {
      const carga = await cargaDe(vendedorTj);
      await eliminar(cookieGeneral, carga.id, { version: 1 }).expect(200);
      const fila = await db
        .selectFrom('carga')
        .select('deleted_at')
        .where('id', '=', carga.id)
        .executeTakeFirstOrThrow();
      expect(fila.deleted_at).not.toBeNull();
      const r = (
        await rejilla(cookieGeneral, { fecha: hoy, sucursal: tjId }).expect(200)
      ).body as Rejilla;
      const columna = r.vendedores.find((v) => v.id === vendedorTj);
      expect(columna?.cargas.some((c) => c.id === carga.id)).toBe(false);
      await eliminar(cookieGeneral, carga.id, { version: 1 }).expect(404);
    });
  });
});

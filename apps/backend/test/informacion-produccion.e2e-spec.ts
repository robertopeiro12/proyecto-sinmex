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
  DetalleInformacionProduccion,
  InformacionProduccion,
} from './../src/modules/produccion/informacion-produccion.service';

/**
 * Informacion de Produccion: solo las entradas vivas (produccion y compra) en
 * su columna, bordes del rango, nada de envios ni otros tipos ni operaciones
 * borradas, Todas suma, presentaciones dadas de baja, el detalle por captura,
 * validaciones, permiso y alcance.
 *
 * Sucursales YG y YH, todo de esta corrida y limpiado por id al final.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const K = 'YG';
const L = 'YH';
/** Sucursal que se da de baja despues de capturar: su historia sigue contando con Todas. */
const B = 'YI';
const PRODUCTO = `ZZ-inf-${SUFIJO}`;

function restarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - dias)).toISOString().slice(0, 10);
}

describe('Información de Producción (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let hoy: string;
  let desde: string;
  let hasta: string;
  const usuarioIds: string[] = [];
  const productoIds: string[] = [];
  const sucursalIds: string[] = [];
  let generalId: string;
  let kId: string;
  let lId: string;
  let bId: string;
  let producto: string;
  let otro: string;
  let litro: string;
  let medio: string;
  let baja: string;
  let motivoMerma: string;

  let cookieGeneral: string;
  let cookieKVer: string; // atado a YG, solo informacion_produccion.ver
  let cookieKSin: string; // atado a YG, sin permisos

  const GENERAL = `e2e-inf-gen-${SUFIJO}`;

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

  const crearProducto = async (nombre: string): Promise<string> => {
    const { id } = await db
      .insertInto('producto')
      .values({ nombre, activo: true })
      .returning('id')
      .executeTakeFirstOrThrow();
    productoIds.push(id);
    return id;
  };

  const crearPresentacion = async (
    productoId: string,
    volumen: string,
    baja = false,
  ): Promise<string> =>
    (
      await db
        .insertInto('presentacion')
        .values({
          producto_id: productoId,
          volumen,
          deleted_at: baja ? sql<Date>`now()` : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  /** Una operacion del Registro, directo a la base (los checks la validan). */
  const crearOperacion = async (o: {
    tipo: string;
    fecha: string;
    sucursalId?: string;
    origen?: 'produccion' | 'compra';
    lineas: { presentacionId: string; piezas: number }[];
    hora?: string;
    comentario?: string;
    destinoId?: string;
    borrada?: boolean;
  }): Promise<void> => {
    const { id } = await db
      .insertInto('operacion_almacen')
      .values({
        sucursal_id: o.sucursalId ?? kId,
        tipo: o.tipo,
        fecha: sql<Date>`${o.fecha}::date`,
        origen: o.tipo === 'entrada' ? (o.origen ?? 'produccion') : null,
        sucursal_destino_id: o.tipo === 'envio' ? (o.destinoId ?? lId) : null,
        motivo_merma_id: o.tipo === 'merma' ? motivoMerma : null,
        trabajador: o.tipo === 'descuento' ? 'Juan' : null,
        estado: o.tipo === 'retiro_merma' ? 'pendiente' : null,
        comentario: o.comentario ?? null,
        capturo_usuario_id: generalId,
        created_at: sql<Date>`(${o.fecha}::date + ${o.hora ?? '12:00'}::time) at time zone 'America/Tijuana'`,
        deleted_at: o.borrada ? sql<Date>`now()` : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('operacion_almacen_linea')
      .values(
        o.lineas.map((l) => ({
          operacion_id: id,
          presentacion_id: l.presentacionId,
          piezas: l.piezas,
        })),
      )
      .execute();
  };

  const leer = async (
    q: Record<string, string>,
    cookie = cookieGeneral,
  ): Promise<InformacionProduccion> =>
    (
      await http()
        .get('/informacion-produccion')
        .query({ desde, hasta, ...q })
        .set('Cookie', cookie)
        .expect(200)
    ).body as InformacionProduccion;

  const detalle = async (
    q: Record<string, string>,
    cookie = cookieGeneral,
  ): Promise<DetalleInformacionProduccion> =>
    (
      await http()
        .get('/informacion-produccion/detalle')
        .query({ desde, hasta, ...q })
        .set('Cookie', cookie)
        .expect(200)
    ).body as DetalleInformacionProduccion;

  const renglon = (r: InformacionProduccion, id: string) =>
    r.renglones.find((x) => x.presentacionId === id);

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
    desde = restarDias(hoy, 10);
    hasta = restarDias(hoy, 3);

    kId = await crearSucursal(K);
    lId = await crearSucursal(L);
    producto = await crearProducto(PRODUCTO);
    litro = await crearPresentacion(producto, '1 L');
    medio = await crearPresentacion(producto, '500 ml');
    otro = await crearProducto(`${PRODUCTO}-b`);
    baja = await crearPresentacion(otro, '5 L', true);
    motivoMerma = (
      await db
        .selectFrom('motivo_merma')
        .select('id')
        .where('aplica_almacen', '=', true)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow()
    ).id;

    generalId = await crearUsuario(GENERAL, 'Administrador General', null);
    await crearUsuario(`e2e-inf-kv-${SUFIJO}`, 'Auxiliar Administrativo', kId, [
      'informacion_produccion.ver',
    ]);
    await crearUsuario(`e2e-inf-ks-${SUFIJO}`, 'Auxiliar Administrativo', kId);
    cookieGeneral = await iniciarSesion(GENERAL);
    cookieKVer = await iniciarSesion(`e2e-inf-kv-${SUFIJO}`);
    cookieKSin = await iniciarSesion(`e2e-inf-ks-${SUFIJO}`);

    // --- YG, litro ---
    // Borde `desde`: produccion 10 (hora 08:00).
    await crearOperacion({
      tipo: 'entrada',
      fecha: desde,
      hora: '08:00',
      comentario: 'Primera',
      lineas: [{ presentacionId: litro, piezas: 10 }],
    });
    // Borde `hasta`: compra 4.
    await crearOperacion({
      tipo: 'entrada',
      origen: 'compra',
      fecha: hasta,
      hora: '17:45',
      lineas: [{ presentacionId: litro, piezas: 4 }],
    });
    // Un dia antes de `desde`: no cuenta. Un dia despues de `hasta`: no cuenta.
    await crearOperacion({
      tipo: 'entrada',
      fecha: restarDias(desde, 1),
      lineas: [{ presentacionId: litro, piezas: 100 }],
    });
    await crearOperacion({
      tipo: 'entrada',
      fecha: restarDias(hasta, -1),
      lineas: [{ presentacionId: litro, piezas: 100 }],
    });
    // Eliminada (baja logica) dentro del rango: no cuenta.
    await crearOperacion({
      tipo: 'entrada',
      fecha: restarDias(desde, -2),
      lineas: [{ presentacionId: litro, piezas: 50 }],
      borrada: true,
    });
    // Otros tipos dentro del rango: no cuentan.
    await crearOperacion({
      tipo: 'merma',
      fecha: restarDias(desde, -2),
      lineas: [{ presentacionId: litro, piezas: 7 }],
    });
    await crearOperacion({
      tipo: 'consumo',
      fecha: restarDias(desde, -2),
      lineas: [{ presentacionId: litro, piezas: 8 }],
    });
    await crearOperacion({
      tipo: 'descuento',
      fecha: restarDias(desde, -2),
      lineas: [{ presentacionId: litro, piezas: 9 }],
    });
    await crearOperacion({
      tipo: 'retiro_merma',
      fecha: restarDias(desde, -2),
      lineas: [{ presentacionId: litro, piezas: 11 }],
    });
    // YI captura 5 litros y despues se da de baja: con Todas sigue contando (es historia).
    bId = await crearSucursal(B);
    await crearOperacion({
      tipo: 'entrada',
      fecha: restarDias(desde, -2),
      sucursalId: bId,
      lineas: [{ presentacionId: litro, piezas: 5 }],
    });
    await db
      .updateTable('sucursal')
      .set({ deleted_at: sql<Date>`now()` })
      .where('id', '=', bId)
      .execute();
    // Envio YG -> YH: no cuenta ni en YG (sale) ni en YH (llega), ni con Todas.
    await crearOperacion({
      tipo: 'envio',
      fecha: restarDias(desde, -2),
      lineas: [{ presentacionId: litro, piezas: 6 }],
    });
    // Una captura con dos presentaciones del mismo producto (RF 4).
    await crearOperacion({
      tipo: 'entrada',
      fecha: restarDias(desde, -1),
      hora: '10:30',
      comentario: 'Mixta',
      lineas: [
        { presentacionId: litro, piezas: 2 },
        { presentacionId: medio, piezas: 5 },
      ],
    });
    await crearOperacion({
      tipo: 'entrada',
      fecha: restarDias(desde, -3),
      lineas: [{ presentacionId: medio, piezas: 3 }],
    });
    // Presentacion dada de baja con compra: sale.
    await crearOperacion({
      tipo: 'entrada',
      origen: 'compra',
      fecha: restarDias(desde, -4),
      lineas: [{ presentacionId: baja, piezas: 8 }],
    });
    // --- YH ---
    await crearOperacion({
      tipo: 'entrada',
      sucursalId: lId,
      fecha: restarDias(desde, -2),
      lineas: [{ presentacionId: litro, piezas: 20 }],
    });
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

  describe('la tabla', () => {
    it('litro de YG: produccion y compra en su columna, bordes incluidos, sin envios ni otros tipos ni borradas', async () => {
      const r = await leer({ sucursal: K });
      expect(r.desde).toBe(desde);
      expect(r.hasta).toBe(hasta);
      expect(r.hoyEnTijuana).toBe(hoy);
      expect(renglon(r, litro)).toEqual({
        presentacionId: litro,
        productoId: producto,
        producto: PRODUCTO,
        volumen: '1 L',
        produccion: 12,
        compras: 4,
        total: 16,
      });
    });

    it('medio de YG suma sus dos capturas', async () => {
      expect(renglon(await leer({ sucursal: K }), medio)).toMatchObject({
        produccion: 8,
        compras: 0,
        total: 8,
      });
    });

    it('la presentacion dada de baja con una compra sale', async () => {
      expect(renglon(await leer({ sucursal: K }), baja)).toMatchObject({
        produccion: 0,
        compras: 8,
        total: 8,
      });
    });

    it('el envio no aparece en YH: solo su propia entrada', async () => {
      expect(renglon(await leer({ sucursal: L }), litro)).toMatchObject({
        produccion: 20,
        compras: 0,
        total: 20,
      });
    });

    it('Todas suma las sucursales, tambien la dada de baja (sin el envio)', async () => {
      expect(renglon(await leer({ sucursal: 'todas' }), litro)).toMatchObject({
        produccion: 37,
        compras: 4,
        total: 41,
      });
    });

    it('sin sucursal un General ve todas', async () => {
      expect(renglon(await leer({}), litro)).toMatchObject({ total: 41 });
    });

    it('orden por tamano: 500 ml antes de 1 L antes de 5 L', async () => {
      const r = await leer({ sucursal: K });
      const ids = r.renglones.map((x) => x.presentacionId);
      expect(ids).toEqual([medio, litro, baja]);
    });

    it('por producto: una fila por producto con la suma, sin presentacion', async () => {
      const r = await leer({ sucursal: K, vista: 'producto' });
      expect(r.renglones).toEqual([
        {
          presentacionId: null,
          productoId: producto,
          producto: PRODUCTO,
          volumen: '',
          produccion: 20,
          compras: 4,
          total: 24,
        },
        {
          presentacionId: null,
          productoId: otro,
          producto: `${PRODUCTO}-b`,
          volumen: '',
          produccion: 0,
          compras: 8,
          total: 8,
        },
      ]);
    });

    it('un rango sin entradas da renglones vacios', async () => {
      const r = await leer({
        sucursal: K,
        desde: restarDias(desde, 200),
        hasta: restarDias(desde, 190),
      });
      expect(r.renglones.filter((x) => x.productoId === producto)).toEqual([]);
    });
  });

  describe('el detalle', () => {
    it('por presentacion: una fila por captura, de la mas vieja a la mas nueva', async () => {
      const r = await detalle({ presentacion: litro, sucursal: K });
      expect(r.detalle).toEqual([
        {
          fecha: desde,
          hora: '08:00',
          sucursal: K,
          origen: 'produccion',
          capturo: GENERAL,
          piezas: 10,
          comentario: 'Primera',
        },
        {
          fecha: restarDias(desde, -1),
          hora: '10:30',
          sucursal: K,
          origen: 'produccion',
          capturo: GENERAL,
          piezas: 2,
          comentario: 'Mixta',
        },
        {
          fecha: hasta,
          hora: '17:45',
          sucursal: K,
          origen: 'compra',
          capturo: GENERAL,
          piezas: 4,
          comentario: null,
        },
      ]);
    });

    it('por producto: la captura con dos presentaciones es UNA fila con la suma', async () => {
      const r = await detalle({ producto, sucursal: K });
      const mixta = r.detalle.filter((f) => f.comentario === 'Mixta');
      expect(mixta).toHaveLength(1);
      expect(mixta[0].piezas).toBe(7);
      expect(r.detalle.reduce((s, f) => s + f.piezas, 0)).toBe(24);
    });

    it('con Todas trae las dos sucursales', async () => {
      const r = await detalle({ presentacion: litro, sucursal: 'todas' });
      expect(new Set(r.detalle.map((f) => f.sucursal))).toEqual(
        new Set([K, L, B]),
      );
    });

    it('una presentacion sin entradas da lista vacia', async () => {
      const r = await detalle({ presentacion: medio, sucursal: L });
      expect(r.detalle).toEqual([]);
    });
  });

  describe('validaciones', () => {
    const pedir = (q: Record<string, string>, ruta = '') =>
      http()
        .get(`/informacion-produccion${ruta}`)
        .query(q)
        .set('Cookie', cookieGeneral);

    it('hasta futura = 400 con hoyEnTijuana', async () => {
      const res = await pedir({ desde, hasta: restarDias(hoy, -1) }).expect(
        400,
      );
      expect(res.body).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: ['La fecha no puede ser posterior a hoy.'],
        hoyEnTijuana: hoy,
      });
    });

    it('rango invertido = 400', async () => {
      const res = await pedir({ desde: hasta, hasta: desde }).expect(400);
      expect(JSON.stringify(res.body)).toContain(
        'La fecha inicial no puede ser posterior a la final.',
      );
    });

    it('367 dias = 400; 366 dias = 200', async () => {
      const res = await pedir({
        desde: restarDias(hoy, 366),
        hasta: hoy,
      }).expect(400);
      expect(JSON.stringify(res.body)).toContain(
        'El rango no puede pasar de un año.',
      );
      await pedir({ desde: restarDias(hoy, 365), hasta: hoy }).expect(200);
    });

    it('fecha inexistente o con mal formato = 400', async () => {
      await pedir({ desde: '2026-02-30', hasta }).expect(400);
      await pedir({ desde: 'ayer', hasta }).expect(400);
    });

    it('vista invalida = 400', async () => {
      await pedir({ desde, hasta, vista: 'otra' }).expect(400);
    });

    it('detalle sin presentacion ni producto, o con los dos = 400', async () => {
      await pedir({ desde, hasta }, '/detalle').expect(400);
      await pedir(
        { desde, hasta, presentacion: litro, producto },
        '/detalle',
      ).expect(400);
    });

    it('detalle de una presentacion o producto inexistente = 404', async () => {
      const nada = '00000000-0000-4000-8000-000000000000';
      await pedir({ desde, hasta, presentacion: nada }, '/detalle').expect(404);
      await pedir({ desde, hasta, producto: nada }, '/detalle').expect(404);
    });

    it('sucursal inexistente = 404', async () => {
      await pedir({ desde, hasta, sucursal: 'QQ' }).expect(404);
    });
  });

  describe('permiso y alcance', () => {
    it('sin informacion_produccion.ver = 403 en los dos GET', async () => {
      await http()
        .get('/informacion-produccion')
        .query({ desde, hasta })
        .set('Cookie', cookieKSin)
        .expect(403);
      await http()
        .get('/informacion-produccion/detalle')
        .query({ desde, hasta, presentacion: litro })
        .set('Cookie', cookieKSin)
        .expect(403);
    });

    it('atado a su sucursal con el permiso ve la suya', async () => {
      const r = await leer({ sucursal: K }, cookieKVer);
      expect(renglon(r, litro)?.total).toBe(16);
      const d = await detalle({ presentacion: litro }, cookieKVer);
      expect(d.detalle).toHaveLength(3);
    });

    it('atado a otra sucursal = 403, tambien en el detalle', async () => {
      await http()
        .get('/informacion-produccion')
        .query({ desde, hasta, sucursal: L })
        .set('Cookie', cookieKVer)
        .expect(403);
      await http()
        .get('/informacion-produccion/detalle')
        .query({ presentacion: litro, desde, hasta, sucursal: L })
        .set('Cookie', cookieKVer)
        .expect(403);
    });

    it('sin sesion = 401', async () => {
      await http()
        .get('/informacion-produccion')
        .query({ desde, hasta })
        .expect(401);
    });
  });
});

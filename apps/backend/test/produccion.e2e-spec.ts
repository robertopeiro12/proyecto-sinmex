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
import type { DiaProduccion } from './../src/modules/produccion/produccion.service';
import { MENSAJE_FECHA_FUTURA } from './../src/modules/produccion/reglas-produccion';

/**
 * Produccion por dia (T-25), de punta a punta: permiso, alcance (otra sucursal =
 * 404), el dia vacio, capturar, corregir, poner en 0 (baja), recapturar, la
 * presentacion desactivada con piezas y la fecha futura.
 *
 * El GET trae todas las presentaciones activas del catalogo (tambien las de otras
 * pruebas), asi que las aserciones miran solo las de este producto. Cada corrida
 * usa un dia del pasado distinto para que el total del dia sea solo suyo.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-prod-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-prod-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-prod-sin-${SUFIJO}`;
const PRODUCTO = `ZZ-prod-${SUFIJO}`;
const PRODUCTO_INACTIVO = `ZZ-prod-inactivo-${SUFIJO}`;

/** Dias del pasado (2000–2024) que dependen de la corrida: el total no se mezcla. */
const DIA_BASE = Date.now() % 9000;
function diaDeLaCorrida(desplazamiento: number): string {
  const dias = (DIA_BASE + desplazamiento) % 9000;
  return new Date(Date.UTC(2000, 0, 1) + dias * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

type Linea = DiaProduccion['lineas'][number];

describe('Produccion por dia desde el portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let hoy: string;
  let manana: string;
  const usuarioIds: string[] = [];
  const productoIds: string[] = [];
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let generalId: string;
  let tijuanaId: string;
  let litro: string;
  let medio: string;
  let inactiva: string;

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
    return id;
  };

  const crearPresentacion = async (
    producto: string,
    volumen: string,
    activo = true,
  ): Promise<string> => {
    const { id: productoId } = await db
      .insertInto('producto')
      .values({ nombre: producto, activo })
      .returning('id')
      .executeTakeFirstOrThrow();
    productoIds.push(productoId);
    return (
      await db
        .insertInto('presentacion')
        .values({ producto_id: productoId, volumen })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  };

  const leer = (cookie: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/produccion?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const guardar = (cookie: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .put('/produccion')
      .set('Cookie', cookie)
      .send(cuerpo);

  /** Solo las lineas de las presentaciones de esta prueba. */
  const mias = (dia: DiaProduccion): Linea[] =>
    dia.lineas.filter((l) =>
      [litro, medio, inactiva].includes(l.presentacionId),
    );

  const linea = (dia: DiaProduccion, presentacionId: string) =>
    dia.lineas.find((l) => l.presentacionId === presentacionId);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    const tjId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;
    const fechas = (
      await sql<{ hoy: string; manana: string }>`
        select to_char((now() at time zone 'America/Tijuana')::date, 'YYYY-MM-DD') as hoy,
               to_char((now() at time zone 'America/Tijuana')::date + 1, 'YYYY-MM-DD') as manana
      `.execute(db)
    ).rows[0];
    hoy = fechas.hoy;
    manana = fechas.manana;

    generalId = await crearUsuario(
      LOGIN_GENERAL,
      'Administrador General',
      null,
    );
    tijuanaId = await crearUsuario(
      LOGIN_TIJUANA,
      'Administrador General',
      tjId,
    );
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);

    litro = await crearPresentacion(PRODUCTO, '1 L');
    medio = await crearPresentacion(`${PRODUCTO}-b`, '500 ml');
    inactiva = await crearPresentacion(PRODUCTO_INACTIVO, '1 L');
  });

  afterAll(async () => {
    const presentaciones = db
      .selectFrom('presentacion')
      .select('id')
      .where('producto_id', 'in', productoIds);
    await db
      .deleteFrom('produccion')
      .where('presentacion_id', 'in', presentaciones)
      .execute();
    await db
      .deleteFrom('presentacion')
      .where('producto_id', 'in', productoIds)
      .execute();
    await db.deleteFrom('producto').where('id', 'in', productoIds).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  describe('permiso y alcance', () => {
    it('sin almacen_general.gestionar el GET y el PUT son 403', async () => {
      await leer(cookieSinPermiso, { fecha: hoy, sucursal: 'TJ' }).expect(403);
      await guardar(cookieSinPermiso, {
        fecha: hoy,
        sucursal: 'TJ',
        lineas: [{ presentacionId: litro, piezas: 1 }],
      }).expect(403);
    });

    it('un usuario atado a TJ ve la suya sin pedirla; pedir MX es 404', async () => {
      const res = await leer(cookieTijuana, { fecha: hoy }).expect(200);
      expect((res.body as DiaProduccion).sucursal.codigo).toBe('TJ');
      await leer(cookieTijuana, { fecha: hoy, sucursal: 'MX' }).expect(404);
      await guardar(cookieTijuana, {
        fecha: hoy,
        sucursal: 'MX',
        lineas: [{ presentacionId: litro, piezas: 1 }],
      }).expect(404);
    });

    it('un General tiene que elegir la sucursal; una inexistente es 404', async () => {
      await leer(cookieGeneral, { fecha: hoy }).expect(400);
      await leer(cookieGeneral, { fecha: hoy, sucursal: 'ZZ' }).expect(404);
    });
  });

  describe('capturar y corregir un dia', () => {
    const dia = diaDeLaCorrida(0);

    it('un dia vacio trae las presentaciones activas en 0, en orden de catalogo, y total 0', async () => {
      const res = await leer(cookieGeneral, { fecha: dia, sucursal: 'TJ' });
      expect(res.status).toBe(200);
      const cuerpo = res.body as DiaProduccion;
      expect(cuerpo.fecha).toBe(dia);
      expect(cuerpo.totalPiezas).toBe(0);
      expect(cuerpo.actualizadoEn).toBeNull();
      expect(mias(cuerpo)).toEqual([
        {
          presentacionId: litro,
          producto: PRODUCTO,
          presentacion: '1 L',
          activa: true,
          piezas: 0,
        },
        {
          presentacionId: medio,
          producto: `${PRODUCTO}-b`,
          presentacion: '500 ml',
          activa: true,
          piezas: 0,
        },
        // Aun activa: se desactiva en la prueba del Punto 4.
        {
          presentacionId: inactiva,
          producto: PRODUCTO_INACTIVO,
          presentacion: '1 L',
          activa: true,
          piezas: 0,
        },
      ]);
    });

    it('el PUT crea y el GET lo refleja con el total', async () => {
      const res = await guardar(cookieGeneral, {
        fecha: dia,
        sucursal: 'TJ',
        lineas: [
          { presentacionId: litro, piezas: 120 },
          { presentacionId: medio, piezas: 30 },
        ],
      });
      expect(res.status).toBe(200);
      const puesto = res.body as DiaProduccion;
      expect(puesto.totalPiezas).toBe(150);
      expect(puesto.actualizadoEn).not.toBeNull();

      const leido = (
        await leer(cookieGeneral, { fecha: dia, sucursal: 'TJ' }).expect(200)
      ).body as DiaProduccion;
      expect(leido).toEqual(puesto);
      expect(linea(leido, litro)?.piezas).toBe(120);
      expect(linea(leido, medio)?.piezas).toBe(30);

      const filas = await db
        .selectFrom('produccion')
        .select(['capturo_usuario_id', 'actualizado_por_usuario_id'])
        .where('presentacion_id', '=', litro)
        .execute();
      expect(filas).toEqual([
        { capturo_usuario_id: generalId, actualizado_por_usuario_id: null },
      ]);
    });

    it('corregir actualiza la fila y guarda quien corrigio', async () => {
      const res = await guardar(cookieTijuana, {
        fecha: dia,
        sucursal: 'TJ',
        lineas: [
          { presentacionId: litro, piezas: 100 },
          { presentacionId: medio, piezas: 30 },
        ],
      }).expect(200);
      expect((res.body as DiaProduccion).totalPiezas).toBe(130);

      const filas = await db
        .selectFrom('produccion')
        .select([
          'piezas',
          'capturo_usuario_id',
          'actualizado_por_usuario_id',
          'deleted_at',
        ])
        .where('presentacion_id', '=', litro)
        .execute();
      expect(filas).toEqual([
        {
          piezas: 100,
          capturo_usuario_id: generalId,
          actualizado_por_usuario_id: tijuanaId,
          deleted_at: null,
        },
      ]);
    });

    it('poner en 0 da de baja la fila, no deja una con 0 (Punto 1)', async () => {
      const res = await guardar(cookieGeneral, {
        fecha: dia,
        sucursal: 'TJ',
        lineas: [
          { presentacionId: litro, piezas: 100 },
          { presentacionId: medio, piezas: 0 },
        ],
      }).expect(200);
      const cuerpo = res.body as DiaProduccion;
      expect(cuerpo.totalPiezas).toBe(100);
      expect(linea(cuerpo, medio)?.piezas).toBe(0);

      const filas = await db
        .selectFrom('produccion')
        .select(['piezas', 'deleted_at'])
        .where('presentacion_id', '=', medio)
        .execute();
      expect(filas).toHaveLength(1);
      expect(filas[0].piezas).toBe(30);
      expect(filas[0].deleted_at).not.toBeNull();
    });

    it('volver a capturar la presentacion dada de baja entra (Punto 2)', async () => {
      const res = await guardar(cookieGeneral, {
        fecha: dia,
        sucursal: 'TJ',
        lineas: [
          { presentacionId: litro, piezas: 100 },
          { presentacionId: medio, piezas: 12 },
        ],
      }).expect(200);
      expect((res.body as DiaProduccion).totalPiezas).toBe(112);

      const vivas = await db
        .selectFrom('produccion')
        .select('piezas')
        .where('presentacion_id', '=', medio)
        .where('deleted_at', 'is', null)
        .execute();
      expect(vivas).toEqual([{ piezas: 12 }]);
    });

    it('lo que no viene en el PUT se da de baja', async () => {
      const res = await guardar(cookieGeneral, {
        fecha: dia,
        sucursal: 'TJ',
        lineas: [{ presentacionId: litro, piezas: 100 }],
      }).expect(200);
      expect((res.body as DiaProduccion).totalPiezas).toBe(100);
      expect(linea(res.body as DiaProduccion, medio)?.piezas).toBe(0);
    });
  });

  describe('presentaciones desactivadas', () => {
    const dia = diaDeLaCorrida(1);

    it('una desactivada con piezas ese dia sigue en el GET con activa: false (Punto 4)', async () => {
      // Se captura mientras esta activa y luego se desactiva el producto.
      await guardar(cookieGeneral, {
        fecha: dia,
        sucursal: 'TJ',
        lineas: [{ presentacionId: inactiva, piezas: 7 }],
      }).expect(200);
      await db
        .updateTable('producto')
        .set({ activo: false })
        .where('nombre', '=', PRODUCTO_INACTIVO)
        .execute();

      const conPiezas = (
        await leer(cookieGeneral, { fecha: dia, sucursal: 'TJ' }).expect(200)
      ).body as DiaProduccion;
      expect(linea(conPiezas, inactiva)).toEqual({
        presentacionId: inactiva,
        producto: PRODUCTO_INACTIVO,
        presentacion: '1 L',
        activa: false,
        piezas: 7,
      });
      expect(conPiezas.totalPiezas).toBe(7);

      // Otro dia sin piezas: la desactivada no aparece.
      const vacio = (
        await leer(cookieGeneral, {
          fecha: diaDeLaCorrida(2),
          sucursal: 'TJ',
        }).expect(200)
      ).body as DiaProduccion;
      expect(linea(vacio, inactiva)).toBeUndefined();

      // Guardar el dia tal como lo devuelve el GET (con la desactivada) se puede.
      const res = await guardar(cookieGeneral, {
        fecha: dia,
        sucursal: 'TJ',
        lineas: [{ presentacionId: inactiva, piezas: 8 }],
      }).expect(200);
      expect(linea(res.body as DiaProduccion, inactiva)?.piezas).toBe(8);
    });
  });

  describe('validacion', () => {
    it('fecha futura en Tijuana es 400 con el mensaje de las reglas', async () => {
      const res = await guardar(cookieGeneral, {
        fecha: manana,
        sucursal: 'TJ',
        lineas: [{ presentacionId: litro, piezas: 5 }],
      }).expect(400);
      expect(JSON.stringify(res.body)).toContain(MENSAJE_FECHA_FUTURA);
    });

    it('piezas negativas, no enteras o fuera del rango de la columna son 400', async () => {
      for (const piezas of [-1, 1.5, 2_147_483_648, '3']) {
        await guardar(cookieGeneral, {
          fecha: hoy,
          sucursal: 'TJ',
          lineas: [{ presentacionId: litro, piezas }],
        }).expect(400);
      }
    });

    it('presentacion repetida, inexistente o con id no uuid es 400', async () => {
      await guardar(cookieGeneral, {
        fecha: hoy,
        sucursal: 'TJ',
        lineas: [
          { presentacionId: litro, piezas: 1 },
          { presentacionId: litro, piezas: 2 },
        ],
      }).expect(400);
      await guardar(cookieGeneral, {
        fecha: hoy,
        sucursal: 'TJ',
        lineas: [
          {
            presentacionId: '00000000-0000-4000-8000-000000000000',
            piezas: 1,
          },
        ],
      }).expect(400);
      await guardar(cookieGeneral, {
        fecha: hoy,
        sucursal: 'TJ',
        lineas: [{ presentacionId: 'no-es-uuid', piezas: 1 }],
      }).expect(400);
    });

    it('lineas que no son lista u objetos, o fecha/sucursal que no son texto, son 400', async () => {
      await guardar(cookieGeneral, {
        fecha: hoy,
        sucursal: 'TJ',
        lineas: 'nada',
      }).expect(400);
      await guardar(cookieGeneral, {
        fecha: hoy,
        sucursal: 'TJ',
        lineas: [5],
      }).expect(400);
      await guardar(cookieGeneral, {
        fecha: 20260101,
        sucursal: 'TJ',
        lineas: [],
      }).expect(400);
      await guardar(cookieGeneral, {
        fecha: hoy,
        sucursal: 7,
        lineas: [],
      }).expect(400);
    });
  });
});

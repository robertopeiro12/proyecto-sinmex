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
import type { DiaRetorno } from './../src/modules/produccion/retornos.service';
import {
  MENSAJE_FECHA_FUTURA,
  MOTIVO_GUARDADO_SIMULTANEO,
} from './../src/modules/produccion/reglas-produccion';

/**
 * Retorno del vendedor, de punta a punta: permiso, alcance (vendedor de otra
 * sucursal o inexistente = 404), el dia vacio con `cargadas` (solo cargas
 * aceptadas), capturar, corregir, 0 da de baja, vendedor sin cargas, fecha
 * futura, guardados simultaneos y la forma del cuerpo.
 *
 * Los vendedores son de esta corrida, asi que sus filas no chocan con otras
 * pruebas; aun asi los dias son de 1980–1987 (ninguna otra suite los usa) y se
 * limpian en `beforeAll`. El GET trae todas las presentaciones activas del
 * catalogo: las aserciones miran solo las de esta prueba.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-ret-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-ret-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-ret-sin-${SUFIJO}`;
const PRODUCTO = `ZZ-ret-${SUFIJO}`;
const PRODUCTO_INACTIVO = `ZZ-ret-inactivo-${SUFIJO}`;

const DIAS_DE_LA_CORRIDA = 6;
/** Dias de 1980–1987 que dependen de la corrida; se limpian antes de empezar. */
const DIA_BASE = Date.now() % 2900;
function diaDeLaCorrida(desplazamiento: number): string {
  return new Date(
    Date.UTC(1980, 0, 1) + (DIA_BASE + desplazamiento) * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
}
const DIAS_PRUEBA = Array.from({ length: DIAS_DE_LA_CORRIDA }, (_, i) =>
  diaDeLaCorrida(i),
);

type Linea = DiaRetorno['lineas'][number];

describe('Retorno del vendedor desde el portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let hoy: string;
  let manana: string;
  const usuarioIds: string[] = [];
  const productoIds: string[] = [];
  const vendedorIds: string[] = [];
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let generalId: string;
  let tijuanaId: string;
  let tjId: string;
  let mxId: string;
  let litro: string;
  let medio: string;
  let vendedorTj: string;
  let vendedorTj2: string;
  let vendedorSinCargas: string;
  let vendedorMx: string;

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

  const crearVendedor = async (
    nombre: string,
    sucursalId: string,
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-ret-v${vendedorIds.length + 1}-${SUFIJO}`,
        nombre: `${nombre} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  const crearPresentacion = async (
    producto: string,
    volumen: string,
  ): Promise<string> => {
    const { id: productoId } = await db
      .insertInto('producto')
      .values({ nombre: producto, activo: true })
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

  /** Una carga escrita directo en la tabla (el servicio solo captura hoy). */
  let numeroCarga = 0;
  const crearCarga = async (opciones: {
    vendedorId: string;
    sucursalId: string;
    fecha: string;
    estado: 'pendiente' | 'aceptada' | 'rechazada';
    eliminada?: boolean;
    lineas: { presentacionId: string; piezas: number }[];
  }): Promise<void> => {
    numeroCarga++;
    const { id } = await db
      .insertInto('carga')
      .values({
        vendedor_id: opciones.vendedorId,
        sucursal_id: opciones.sucursalId,
        fecha: sql<Date>`${opciones.fecha}::date`,
        numero: numeroCarga,
        estado: opciones.estado,
        motivo_rechazo: opciones.estado === 'rechazada' ? 'No coincide' : null,
        respondida_en:
          opciones.estado === 'pendiente' ? null : sql<Date>`now()`,
        deleted_at: opciones.eliminada ? sql<Date>`now()` : null,
        capturo_usuario_id: generalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('carga_detalle')
      .values(
        opciones.lineas.map((l) => ({
          carga_id: id,
          presentacion_id: l.presentacionId,
          piezas: l.piezas,
        })),
      )
      .execute();
  };

  const leer = (cookie: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/retornos?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const guardar = (cookie: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .put('/retornos')
      .set('Cookie', cookie)
      .send(cuerpo);

  const mias = (dia: DiaRetorno): Linea[] =>
    dia.lineas.filter((l) => [litro, medio].includes(l.presentacionId));

  const linea = (dia: DiaRetorno, presentacionId: string) =>
    dia.lineas.find((l) => l.presentacionId === presentacionId);

  /** Espera a que `n` conexiones esten detenidas en un candado con `fragmento` (sin `sleep`). */
  const esperarDetenidas = async (
    n: number,
    fragmento: string,
  ): Promise<void> => {
    for (let intento = 0; intento < 100; intento++) {
      const r = await sql<{ detenidas: number }>`
        select count(*)::int as detenidas
          from pg_stat_activity
         where wait_event_type = 'Lock'
           and pid <> pg_backend_pid()
           and position(${fragmento} in query) > 0
      `.execute(db);
      if (r.rows[0].detenidas >= n) return;
      await new Promise((listo) => setTimeout(listo, 50));
    }
    throw new Error(
      `Nunca hubo ${n} consultas detenidas en un candado con ${fragmento}.`,
    );
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    const sucursal = async (codigo: string) =>
      (
        await db
          .selectFrom('sucursal')
          .select('id')
          .where('codigo', '=', codigo)
          .executeTakeFirstOrThrow()
      ).id;
    tjId = await sucursal('TJ');
    mxId = await sucursal('MX');
    const fechas = (
      await sql<{ hoy: string; manana: string }>`
        select to_char((now() at time zone 'America/Tijuana')::date, 'YYYY-MM-DD') as hoy,
               to_char((now() at time zone 'America/Tijuana')::date + 1, 'YYYY-MM-DD') as manana
      `.execute(db)
    ).rows[0];
    hoy = fechas.hoy;
    manana = fechas.manana;

    await db
      .deleteFrom('retorno')
      .where(sql<boolean>`fecha = any(${DIAS_PRUEBA}::date[])`)
      .execute();

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
    vendedorTj = await crearVendedor('Ret TJ', tjId);
    vendedorTj2 = await crearVendedor('Ret TJ dos', tjId);
    vendedorSinCargas = await crearVendedor('Ret sin cargas', tjId);
    vendedorMx = await crearVendedor('Ret MX', mxId);
  });

  afterAll(async () => {
    await db
      .deleteFrom('retorno')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
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
    await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
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
    it('sin retorno.gestionar el GET y el PUT son 403', async () => {
      await leer(cookieSinPermiso, { fecha: hoy, vendedor: vendedorTj }).expect(
        403,
      );
      await guardar(cookieSinPermiso, {
        fecha: hoy,
        vendedor: vendedorTj,
        lineas: [{ presentacionId: litro, piezas: 1 }],
      }).expect(403);
    });

    it('un usuario atado a TJ no alcanza a un vendedor de MX: 404 (Punto 3)', async () => {
      await leer(cookieTijuana, { fecha: hoy, vendedor: vendedorMx }).expect(
        404,
      );
      await guardar(cookieTijuana, {
        fecha: diaDeLaCorrida(5),
        vendedor: vendedorMx,
        lineas: [{ presentacionId: litro, piezas: 1 }],
      }).expect(404);
      const filas = await db
        .selectFrom('retorno')
        .select('id')
        .where('vendedor_id', '=', vendedorMx)
        .execute();
      expect(filas).toEqual([]);
      // El General si lo alcanza.
      const res = await leer(cookieGeneral, {
        fecha: hoy,
        vendedor: vendedorMx,
      }).expect(200);
      expect((res.body as DiaRetorno).sucursal).toEqual({
        id: mxId,
        codigo: 'MX',
      });
    });

    it('un vendedor inexistente es 404', async () => {
      const otro = '00000000-0000-4000-8000-000000000000';
      await leer(cookieGeneral, { fecha: hoy, vendedor: otro }).expect(404);
      await guardar(cookieGeneral, {
        fecha: hoy,
        vendedor: otro,
        lineas: [],
      }).expect(404);
    });
  });

  describe('capturar y corregir un dia', () => {
    const dia = diaDeLaCorrida(0);

    it('un dia vacio trae las presentaciones activas en 0 y cargadas solo de cargas aceptadas (Punto 1)', async () => {
      // Suman: dos aceptadas del vendedor ese dia.
      await crearCarga({
        vendedorId: vendedorTj,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [
          { presentacionId: litro, piezas: 50 },
          { presentacionId: medio, piezas: 4 },
        ],
      });
      await crearCarga({
        vendedorId: vendedorTj,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [{ presentacionId: litro, piezas: 10 }],
      });
      // No suman: pendiente, rechazada, aceptada borrada, de otro vendedor, de otro dia.
      for (const estado of ['pendiente', 'rechazada'] as const) {
        await crearCarga({
          vendedorId: vendedorTj,
          sucursalId: tjId,
          fecha: dia,
          estado,
          lineas: [{ presentacionId: medio, piezas: 7 }],
        });
      }
      await crearCarga({
        vendedorId: vendedorTj,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        eliminada: true,
        lineas: [{ presentacionId: medio, piezas: 9 }],
      });
      await crearCarga({
        vendedorId: vendedorTj2,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [{ presentacionId: medio, piezas: 11 }],
      });
      await crearCarga({
        vendedorId: vendedorTj,
        sucursalId: tjId,
        fecha: diaDeLaCorrida(1),
        estado: 'aceptada',
        lineas: [{ presentacionId: medio, piezas: 13 }],
      });

      const res = await leer(cookieTijuana, {
        fecha: dia,
        vendedor: vendedorTj,
      });
      expect(res.status).toBe(200);
      const cuerpo = res.body as DiaRetorno;
      expect(cuerpo.fecha).toBe(dia);
      expect(cuerpo.vendedor).toEqual({
        id: vendedorTj,
        nombre: `Ret TJ ${SUFIJO}`,
      });
      expect(cuerpo.sucursal).toEqual({ id: tjId, codigo: 'TJ' });
      expect(cuerpo.totalPiezas).toBe(0);
      expect(cuerpo.actualizadoEn).toBeNull();
      expect(mias(cuerpo)).toEqual([
        {
          presentacionId: litro,
          producto: PRODUCTO,
          presentacion: '1 L',
          activa: true,
          piezas: 0,
          cargadas: 60,
        },
        {
          presentacionId: medio,
          producto: `${PRODUCTO}-b`,
          presentacion: '500 ml',
          activa: true,
          piezas: 0,
          cargadas: 4,
        },
      ]);
    });

    it('el PUT crea con la sucursal del vendedor y el GET lo refleja', async () => {
      const res = await guardar(cookieGeneral, {
        fecha: dia,
        vendedor: vendedorTj,
        lineas: [
          { presentacionId: litro, piezas: 12 },
          { presentacionId: medio, piezas: 3 },
        ],
      });
      expect(res.status).toBe(200);
      const puesto = res.body as DiaRetorno;
      expect(puesto.totalPiezas).toBe(15);
      expect(puesto.actualizadoEn).not.toBeNull();
      expect(linea(puesto, litro)).toMatchObject({ piezas: 12, cargadas: 60 });

      const leido = (
        await leer(cookieGeneral, { fecha: dia, vendedor: vendedorTj }).expect(
          200,
        )
      ).body as DiaRetorno;
      expect(leido).toEqual(puesto);

      const filas = await db
        .selectFrom('retorno')
        .select([
          'sucursal_id',
          'capturo_usuario_id',
          'actualizado_por_usuario_id',
        ])
        .where('vendedor_id', '=', vendedorTj)
        .where('presentacion_id', '=', litro)
        .execute();
      // La sucursal la pone el servicio (la del vendedor), nunca el cuerpo.
      expect(filas).toEqual([
        {
          sucursal_id: tjId,
          capturo_usuario_id: generalId,
          actualizado_por_usuario_id: null,
        },
      ]);
    });

    it('una sucursal en el cuerpo se ignora: la fila lleva la del vendedor', async () => {
      const otroDia = diaDeLaCorrida(4);
      await guardar(cookieGeneral, {
        fecha: otroDia,
        vendedor: vendedorMx,
        sucursal: 'TJ',
        sucursalId: tjId,
        lineas: [{ presentacionId: litro, piezas: 2 }],
      }).expect(200);
      const filas = await db
        .selectFrom('retorno')
        .select('sucursal_id')
        .where('vendedor_id', '=', vendedorMx)
        .where(sql<boolean>`fecha = ${otroDia}::date`)
        .execute();
      expect(filas).toEqual([{ sucursal_id: mxId }]);
    });

    it('corregir actualiza la fila y guarda quien corrigio', async () => {
      const res = await guardar(cookieTijuana, {
        fecha: dia,
        vendedor: vendedorTj,
        lineas: [
          { presentacionId: litro, piezas: 9 },
          { presentacionId: medio, piezas: 3 },
        ],
      }).expect(200);
      expect((res.body as DiaRetorno).totalPiezas).toBe(12);

      const filas = await db
        .selectFrom('retorno')
        .select([
          'piezas',
          'capturo_usuario_id',
          'actualizado_por_usuario_id',
          'deleted_at',
        ])
        .where('vendedor_id', '=', vendedorTj)
        .where('presentacion_id', '=', litro)
        .execute();
      expect(filas).toEqual([
        {
          piezas: 9,
          capturo_usuario_id: generalId,
          actualizado_por_usuario_id: tijuanaId,
          deleted_at: null,
        },
      ]);
    });

    it('poner en 0 da de baja la fila, y volver a capturar entra', async () => {
      const res = await guardar(cookieGeneral, {
        fecha: dia,
        vendedor: vendedorTj,
        lineas: [
          { presentacionId: litro, piezas: 9 },
          { presentacionId: medio, piezas: 0 },
        ],
      }).expect(200);
      expect((res.body as DiaRetorno).totalPiezas).toBe(9);
      expect(linea(res.body as DiaRetorno, medio)?.piezas).toBe(0);

      const filas = await db
        .selectFrom('retorno')
        .select(['piezas', 'deleted_at'])
        .where('vendedor_id', '=', vendedorTj)
        .where('presentacion_id', '=', medio)
        .execute();
      expect(filas).toHaveLength(1);
      expect(filas[0].piezas).toBe(3);
      expect(filas[0].deleted_at).not.toBeNull();

      await guardar(cookieGeneral, {
        fecha: dia,
        vendedor: vendedorTj,
        lineas: [
          { presentacionId: litro, piezas: 9 },
          { presentacionId: medio, piezas: 1 },
        ],
      }).expect(200);
      const vivas = await db
        .selectFrom('retorno')
        .select('piezas')
        .where('vendedor_id', '=', vendedorTj)
        .where('presentacion_id', '=', medio)
        .where('deleted_at', 'is', null)
        .execute();
      expect(vivas).toEqual([{ piezas: 1 }]);
    });

    it('un vendedor sin cargas ese dia captura igual, con cargadas en 0 (Punto 5)', async () => {
      const res = await guardar(cookieTijuana, {
        fecha: dia,
        vendedor: vendedorSinCargas,
        lineas: [{ presentacionId: medio, piezas: 5 }],
      }).expect(200);
      const cuerpo = res.body as DiaRetorno;
      expect(linea(cuerpo, medio)).toMatchObject({ piezas: 5, cargadas: 0 });
      expect(linea(cuerpo, litro)).toMatchObject({ piezas: 0, cargadas: 0 });
      expect(cuerpo.totalPiezas).toBe(5);
    });
  });

  describe('presentaciones desactivadas', () => {
    it('una desactivada con carga aceptada ese dia sale con activa: false y se le captura retorno', async () => {
      const dia = diaDeLaCorrida(2);
      const inactiva = await crearPresentacion(PRODUCTO_INACTIVO, '1 L');
      await crearCarga({
        vendedorId: vendedorTj2,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [{ presentacionId: inactiva, piezas: 6 }],
      });
      await db
        .updateTable('producto')
        .set({ activo: false })
        .where('nombre', '=', PRODUCTO_INACTIVO)
        .execute();

      const leido = (
        await leer(cookieGeneral, { fecha: dia, vendedor: vendedorTj2 }).expect(
          200,
        )
      ).body as DiaRetorno;
      expect(linea(leido, inactiva)).toEqual({
        presentacionId: inactiva,
        producto: PRODUCTO_INACTIVO,
        presentacion: '1 L',
        activa: false,
        piezas: 0,
        cargadas: 6,
      });

      const res = await guardar(cookieGeneral, {
        fecha: dia,
        vendedor: vendedorTj2,
        lineas: [{ presentacionId: inactiva, piezas: 2 }],
      }).expect(200);
      expect(linea(res.body as DiaRetorno, inactiva)?.piezas).toBe(2);

      // Otro vendedor ese dia (sin esa carga): la desactivada no aparece.
      const otro = (
        await leer(cookieGeneral, { fecha: dia, vendedor: vendedorTj }).expect(
          200,
        )
      ).body as DiaRetorno;
      expect(linea(otro, inactiva)).toBeUndefined();
    });
  });

  describe('presentaciones dadas de baja', () => {
    it('una dada de baja (ella o su producto) que venia en una carga aceptada ese dia se muestra y se le captura retorno; sin carga es 400', async () => {
      const dia = diaDeLaCorrida(5);
      const bajaPresentacion = await crearPresentacion(
        `${PRODUCTO}-baja-pr`,
        '1 L',
      );
      const bajaProducto = await crearPresentacion(
        `${PRODUCTO}-baja-prod`,
        '1 L',
      );
      const bajaSinCarga = await crearPresentacion(
        `${PRODUCTO}-baja-sin`,
        '1 L',
      );
      await crearCarga({
        vendedorId: vendedorTj2,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [
          { presentacionId: bajaPresentacion, piezas: 4 },
          { presentacionId: bajaProducto, piezas: 5 },
        ],
      });
      await db
        .updateTable('presentacion')
        .set({ deleted_at: sql<Date>`now()` })
        .where('id', 'in', [bajaPresentacion, bajaSinCarga])
        .execute();
      await db
        .updateTable('producto')
        .set({ deleted_at: sql<Date>`now()` })
        .where('nombre', '=', `${PRODUCTO}-baja-prod`)
        .execute();

      const leido = (
        await leer(cookieGeneral, { fecha: dia, vendedor: vendedorTj2 }).expect(
          200,
        )
      ).body as DiaRetorno;
      expect(linea(leido, bajaPresentacion)?.cargadas).toBe(4);
      expect(linea(leido, bajaProducto)?.cargadas).toBe(5);
      expect(linea(leido, bajaSinCarga)).toBeUndefined();

      const res = await guardar(cookieGeneral, {
        fecha: dia,
        vendedor: vendedorTj2,
        lineas: [
          { presentacionId: bajaPresentacion, piezas: 1 },
          { presentacionId: bajaProducto, piezas: 2 },
        ],
      }).expect(200);
      expect(linea(res.body as DiaRetorno, bajaPresentacion)?.piezas).toBe(1);
      expect(linea(res.body as DiaRetorno, bajaProducto)?.piezas).toBe(2);

      await guardar(cookieGeneral, {
        fecha: dia,
        vendedor: vendedorTj2,
        lineas: [{ presentacionId: bajaSinCarga, piezas: 1 }],
      }).expect(400);
    });
  });

  describe('guardados simultaneos', () => {
    it('dos PUT del mismo vendedor y dia se serializan: el dia queda como el ultimo, sin mezcla (Punto 2)', async () => {
      const dia = diaDeLaCorrida(3);
      const cuerpoA = {
        fecha: dia,
        vendedor: vendedorTj2,
        lineas: [{ presentacionId: litro, piezas: 10 }],
      };
      const cuerpoB = {
        fecha: dia,
        vendedor: vendedorTj2,
        lineas: [{ presentacionId: medio, piezas: 20 }],
      };

      // La prueba tiene la fila del vendedor mientras salen los dos PUT.
      let pendientes!: Promise<request.Response[]>;
      await db.transaction().execute(async (trx) => {
        await sql`select id from vendedor where id = ${vendedorTj2} for no key update`.execute(
          trx,
        );
        pendientes = Promise.all([
          guardar(cookieGeneral, cuerpoA),
          guardar(cookieGeneral, cuerpoB),
        ]);
        await esperarDetenidas(2, 'from "vendedor"');
      });
      const [resA, resB] = await pendientes;
      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      const final = (
        await leer(cookieGeneral, { fecha: dia, vendedor: vendedorTj2 }).expect(
          200,
        )
      ).body as DiaRetorno;
      const piezas = mias(final).map((l) => l.piezas);
      const deA = mias(resA.body as DiaRetorno).map((l) => l.piezas);
      const deB = mias(resB.body as DiaRetorno).map((l) => l.piezas);
      expect([
        [10, 0],
        [0, 20],
      ]).toContainEqual(piezas);
      expect([deA, deB]).toContainEqual(piezas);

      const vivas = await db
        .selectFrom('retorno')
        .select('id')
        .where('vendedor_id', '=', vendedorTj2)
        .where(sql<boolean>`fecha = ${dia}::date`)
        .where('deleted_at', 'is', null)
        .execute();
      expect(vivas).toHaveLength(1);
    });

    it('una fila viva escrita sin el candado del vendedor hace que el indice unico de 409 (red de seguridad)', async () => {
      const dia = diaDeLaCorrida(5);
      let pendiente!: Promise<request.Response>;
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('retorno')
          .values({
            fecha: sql<Date>`${dia}::date`,
            vendedor_id: vendedorSinCargas,
            sucursal_id: tjId,
            presentacion_id: litro,
            piezas: 5,
            capturo_usuario_id: generalId,
          })
          .execute();
        pendiente = Promise.resolve(
          guardar(cookieGeneral, {
            fecha: dia,
            vendedor: vendedorSinCargas,
            lineas: [{ presentacionId: litro, piezas: 9 }],
          }),
        );
        await esperarDetenidas(1, 'insert into "retorno"');
      });
      const res = await pendiente;
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).toContain(MOTIVO_GUARDADO_SIMULTANEO);
    });
  });

  describe('validacion', () => {
    it('fecha futura en Tijuana es 400 con el mensaje de las reglas', async () => {
      const res = await guardar(cookieGeneral, {
        fecha: manana,
        vendedor: vendedorTj,
        lineas: [{ presentacionId: litro, piezas: 5 }],
      }).expect(400);
      expect(JSON.stringify(res.body)).toContain(MENSAJE_FECHA_FUTURA);
    });

    it('GET con fecha que no existe o sin formato, o vendedor no uuid, es 400', async () => {
      await leer(cookieGeneral, {
        fecha: '2026-02-30',
        vendedor: vendedorTj,
      }).expect(400);
      await leer(cookieGeneral, { fecha: 'hoy', vendedor: vendedorTj }).expect(
        400,
      );
      await leer(cookieGeneral, { fecha: hoy, vendedor: 'nadie' }).expect(400);
      await leer(cookieGeneral, { fecha: hoy }).expect(400);
    });

    it('piezas negativas, no enteras o fuera del rango de la columna son 400', async () => {
      for (const piezas of [-1, 1.5, 2_147_483_648, '3']) {
        await guardar(cookieGeneral, {
          fecha: hoy,
          vendedor: vendedorTj,
          lineas: [{ presentacionId: litro, piezas }],
        }).expect(400);
      }
    });

    it('presentacion repetida, inexistente o con id no uuid es 400', async () => {
      await guardar(cookieGeneral, {
        fecha: hoy,
        vendedor: vendedorTj,
        lineas: [
          { presentacionId: litro, piezas: 1 },
          { presentacionId: litro, piezas: 2 },
        ],
      }).expect(400);
      await guardar(cookieGeneral, {
        fecha: hoy,
        vendedor: vendedorTj,
        lineas: [
          {
            presentacionId: '00000000-0000-4000-8000-000000000000',
            piezas: 1,
          },
        ],
      }).expect(400);
      await guardar(cookieGeneral, {
        fecha: hoy,
        vendedor: vendedorTj,
        lineas: [{ presentacionId: 'no-es-uuid', piezas: 1 }],
      }).expect(400);
    });

    it('vendedor no uuid, mas de 500 lineas o lineas que no son lista son 400', async () => {
      await guardar(cookieGeneral, {
        fecha: hoy,
        vendedor: 'nadie',
        lineas: [],
      }).expect(400);
      await guardar(cookieGeneral, {
        fecha: hoy,
        vendedor: vendedorTj,
        lineas: Array.from({ length: 501 }, () => ({
          presentacionId: litro,
          piezas: 0,
        })),
      }).expect(400);
      await guardar(cookieGeneral, {
        fecha: hoy,
        vendedor: vendedorTj,
        lineas: 'nada',
      }).expect(400);
      await guardar(cookieGeneral, {
        fecha: 20260101,
        vendedor: vendedorTj,
        lineas: [],
      }).expect(400);
    });
  });
});

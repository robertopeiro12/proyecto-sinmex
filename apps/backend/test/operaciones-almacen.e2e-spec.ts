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
 * Registro de Operacion (parte 1), de punta a punta: los cinco tipos con alta,
 * edicion y baja; el permiso del tipo en todas las rutas; el envio visto en
 * Entradas del destino; la regla de fecha del envio (hoy o ayer) tambien al
 * corregir y dar de baja; el motivo de merma; alcance y topes.
 *
 * Sucursales (ZO, ZP), usuarios y presentaciones son de esta corrida: no toca
 * los datos de nadie mas. Como el envio solo admite hoy o ayer, las fechas son
 * las reales de Tijuana; todo se limpia por id al final.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const K = 'ZO';
const L = 'ZP';
const PRODUCTO = `ZZ-opal-${SUFIJO}`;
const PREFIJO_MOTIVO = `ZZ-opal-${SUFIJO}`;

const TIPOS = ['entrada', 'envio', 'merma', 'consumo', 'descuento'] as const;

function restarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - dias)).toISOString().slice(0, 10);
}

describe('Registro de Operacion (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let hoy: string;
  let ayer: string;
  let antier: string;
  let manana: string;
  const usuarioIds: string[] = [];
  const productoIds: string[] = [];
  const sucursalIds: string[] = [];
  const motivoIds: string[] = [];
  let kId: string;
  let lId: string;
  let litro: string;
  let medio: string;
  let galon: string;
  let motivoOk: string;

  let cookieGeneral: string;
  let cookieK: string; // atado a ZO con los cinco permisos
  let cookieKConsumo: string; // atado a ZO solo con operacion.consumo
  let cookieLEntrada: string; // atado a ZP solo con operacion.entrada
  let cookieSin: string; // sin ningun permiso

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

  /** `Auxiliar Administrativo` esta vacio: los permisos entran por excepcion. */
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

  const crearMotivo = async (
    nombre: string,
    opciones: { almacen?: boolean; baja?: boolean } = {},
  ): Promise<string> => {
    const { id } = await db
      .insertInto('motivo_merma')
      .values({
        nombre: `${PREFIJO_MOTIVO} ${nombre}`,
        aplica_almacen: opciones.almacen ?? true,
        aplica_cliente: true,
        aplica_vehiculo: true,
        deleted_at: opciones.baja ? sql<Date>`now()` : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    motivoIds.push(id);
    return id;
  };

  /** El cuerpo minimo valido de cada tipo; `extra` lo pisa. */
  const cuerpo = (
    tipo: (typeof TIPOS)[number],
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      tipo,
      sucursal: K,
      fecha: hoy,
      lineas: [
        { presentacionId: litro, piezas: 10 },
        { presentacionId: medio, piezas: 5 },
      ],
    };
    if (tipo === 'entrada') base.origen = 'compra';
    if (tipo === 'envio') base.destino = L;
    if (tipo === 'merma') base.motivoId = motivoOk;
    if (tipo === 'descuento') base.trabajador = 'Ana Pérez';
    return { ...base, ...extra };
  };

  const crear = async (
    tipo: (typeof TIPOS)[number],
    extra: Record<string, unknown> = {},
    cookie = cookieK,
  ): Promise<OperacionAlmacen> =>
    (
      await http()
        .post('/operaciones-almacen')
        .set('Cookie', cookie)
        .send(cuerpo(tipo, extra))
        .expect(201)
    ).body as OperacionAlmacen;

  const mensajes = (cuerpoRespuesta: unknown): string[] => {
    const m = (cuerpoRespuesta as { message: string | string[] }).message;
    return Array.isArray(m) ? m : [m];
  };

  /** Una operacion escrita directo en la tabla (para fechas que el servicio no deja). */
  const sembrar = async (
    tipo: 'envio' | 'entrada',
    fecha: string,
  ): Promise<string> => {
    const { id } = await db
      .insertInto('operacion_almacen')
      .values({
        sucursal_id: kId,
        tipo,
        fecha: sql<Date>`${fecha}::date`,
        origen: tipo === 'entrada' ? 'compra' : null,
        sucursal_destino_id: tipo === 'envio' ? lId : null,
        capturo_usuario_id: usuarioIds[0],
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('operacion_almacen_linea')
      .values({ operacion_id: id, presentacion_id: litro, piezas: 3 })
      .execute();
    return id;
  };

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
    ayer = restarDias(hoy, 1);
    antier = restarDias(hoy, 2);
    manana = restarDias(hoy, -1);

    kId = await crearSucursal(K);
    lId = await crearSucursal(L);
    litro = await crearPresentacion('1 L');
    medio = await crearPresentacion('500 ml');
    galon = await crearPresentacion('1 gal');
    motivoOk = await crearMotivo('Bueno');

    await crearUsuario(`e2e-opal-gen-${SUFIJO}`, 'Administrador General', null);
    await crearUsuario(
      `e2e-opal-k-${SUFIJO}`,
      'Auxiliar Administrativo',
      kId,
      TIPOS.map((t) => `operacion.${t}`),
    );
    await crearUsuario(
      `e2e-opal-kc-${SUFIJO}`,
      'Auxiliar Administrativo',
      kId,
      ['operacion.consumo'],
    );
    await crearUsuario(
      `e2e-opal-le-${SUFIJO}`,
      'Auxiliar Administrativo',
      lId,
      ['operacion.entrada'],
    );
    await crearUsuario(
      `e2e-opal-sin-${SUFIJO}`,
      'Auxiliar Administrativo',
      kId,
    );

    cookieGeneral = await iniciarSesion(`e2e-opal-gen-${SUFIJO}`);
    cookieK = await iniciarSesion(`e2e-opal-k-${SUFIJO}`);
    cookieKConsumo = await iniciarSesion(`e2e-opal-kc-${SUFIJO}`);
    cookieLEntrada = await iniciarSesion(`e2e-opal-le-${SUFIJO}`);
    cookieSin = await iniciarSesion(`e2e-opal-sin-${SUFIJO}`);
  });

  afterAll(async () => {
    const ops = db
      .selectFrom('operacion_almacen')
      .select('id')
      .where((eb) =>
        eb.or([
          eb('sucursal_id', 'in', sucursalIds),
          eb('sucursal_destino_id', 'in', sucursalIds),
        ]),
      );
    await db
      .deleteFrom('operacion_almacen_linea')
      .where('operacion_id', 'in', ops)
      .execute();
    await db
      .deleteFrom('operacion_almacen')
      .where((eb) =>
        eb.or([
          eb('sucursal_id', 'in', sucursalIds),
          eb('sucursal_destino_id', 'in', sucursalIds),
        ]),
      )
      .execute();
    if (motivoIds.length > 0)
      await db
        .deleteFrom('motivo_merma')
        .where('id', 'in', motivoIds)
        .execute();
    if (productoIds.length > 0) {
      await db
        .deleteFrom('presentacion')
        .where('producto_id', 'in', productoIds)
        .execute();
      await db.deleteFrom('producto').where('id', 'in', productoIds).execute();
    }
    if (usuarioIds.length > 0) {
      await db
        .deleteFrom('usuario_permiso')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db
        .deleteFrom('sesion_refresh')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await db.deleteFrom('sucursal').where('id', 'in', sucursalIds).execute();
    await app.close();
  });

  describe('los cinco tipos: alta, edicion y baja', () => {
    for (const tipo of TIPOS) {
      it(`${tipo}: se captura, se lista, se corrige y se da de baja`, async () => {
        const creada = await crear(tipo);
        expect(creada).toMatchObject({
          tipo,
          sucursal: { id: kId, codigo: K },
          fecha: hoy,
          piezas: 15,
          editable: true,
          envio: null,
        });
        expect(creada.hora).toMatch(/^\d{2}:\d{2}$/);
        expect(creada.lineas.map((l) => l.piezas).sort()).toEqual([10, 5]);
        if (tipo === 'entrada') expect(creada.origen).toBe('compra');
        if (tipo === 'envio')
          expect(creada.destino).toMatchObject({ id: lId, codigo: L });
        if (tipo === 'merma')
          expect(creada.motivo).toMatchObject({ id: motivoOk });
        if (tipo === 'descuento') expect(creada.trabajador).toBe('Ana Pérez');

        const lista = (
          await http()
            .get('/operaciones-almacen')
            .query({ sucursal: K, fecha: hoy, tipo })
            .set('Cookie', cookieK)
            .expect(200)
        ).body as OperacionesDelDia;
        expect(lista.hoy).toBe(hoy);
        expect(lista.operaciones.map((o) => o.id)).toContain(creada.id);

        // Corregir: cambia datos y lineas (una se queda con otras piezas, una
        // sale y una nueva entra).
        const cambios: Record<string, unknown> = {
          fecha: ayer,
          comentario: '  Corregida  ',
          lineas: [
            { presentacionId: litro, piezas: 7 },
            { presentacionId: galon, piezas: 2 },
          ],
        };
        if (tipo === 'entrada') cambios.origen = 'produccion';
        if (tipo === 'envio') cambios.destino = L;
        if (tipo === 'merma') cambios.motivoId = motivoOk;
        if (tipo === 'descuento') cambios.trabajador = 'Luis';
        const editada = (
          await http()
            .put(`/operaciones-almacen/${creada.id}`)
            .set('Cookie', cookieK)
            .send(cambios)
            .expect(200)
        ).body as OperacionAlmacen;
        expect(editada).toMatchObject({
          id: creada.id,
          fecha: ayer,
          comentario: 'Corregida',
          piezas: 9,
        });
        expect(editada.lineas.map((l) => l.presentacionId).sort()).toEqual(
          [litro, galon].sort(),
        );
        if (tipo === 'entrada') expect(editada.origen).toBe('produccion');
        if (tipo === 'descuento') expect(editada.trabajador).toBe('Luis');
        const fila = await db
          .selectFrom('operacion_almacen')
          .select('actualizado_por_usuario_id')
          .where('id', '=', creada.id)
          .executeTakeFirstOrThrow();
        expect(fila.actualizado_por_usuario_id).not.toBeNull();

        const leida = (
          await http()
            .get(`/operaciones-almacen/${creada.id}`)
            .set('Cookie', cookieK)
            .expect(200)
        ).body as OperacionAlmacen;
        expect(leida.piezas).toBe(9);

        await http()
          .delete(`/operaciones-almacen/${creada.id}`)
          .set('Cookie', cookieK)
          .expect(204);
        await http()
          .get(`/operaciones-almacen/${creada.id}`)
          .set('Cookie', cookieK)
          .expect(404);
        const despues = (
          await http()
            .get('/operaciones-almacen')
            .query({ sucursal: K, fecha: ayer, tipo })
            .set('Cookie', cookieK)
            .expect(200)
        ).body as OperacionesDelDia;
        expect(despues.operaciones.map((o) => o.id)).not.toContain(creada.id);
        // Dar de baja es logico.
        const viva = await db
          .selectFrom('operacion_almacen')
          .select('deleted_at')
          .where('id', '=', creada.id)
          .executeTakeFirstOrThrow();
        expect(viva.deleted_at).not.toBeNull();
      });
    }

    it('un General elige la sucursal en el cuerpo y la registra ahi', async () => {
      const o = await crear('consumo', { sucursal: L }, cookieGeneral);
      expect(o.sucursal.codigo).toBe(L);
    });
  });

  describe('Review Focus 1: el envio se ve en Entradas del destino', () => {
    it('un usuario de ZP con operacion.entrada lo ve, de solo lectura, sin alcanzar ZO', async () => {
      const envio = await crear('envio');
      const lista = (
        await http()
          .get('/operaciones-almacen')
          .query({ sucursal: L, fecha: hoy, tipo: 'entrada' })
          .set('Cookie', cookieLEntrada)
          .expect(200)
      ).body as OperacionesDelDia;
      const visto = lista.operaciones.find((o) => o.id === envio.id);
      expect(visto).toMatchObject({
        tipo: 'entrada',
        sucursal: { codigo: L },
        piezas: 15,
        editable: false,
        envio: { origen: { id: kId, codigo: K } },
      });

      // Ni editarlo ni borrarlo: es de ZO (404 para quien no la alcanza).
      await http()
        .put(`/operaciones-almacen/${envio.id}`)
        .set('Cookie', cookieLEntrada)
        .send({
          fecha: hoy,
          destino: L,
          lineas: [{ presentacionId: litro, piezas: 1 }],
        })
        .expect(404);
      await http()
        .delete(`/operaciones-almacen/${envio.id}`)
        .set('Cookie', cookieLEntrada)
        .expect(404);
      const sigue = await db
        .selectFrom('operacion_almacen')
        .select('deleted_at')
        .where('id', '=', envio.id)
        .executeTakeFirstOrThrow();
      expect(sigue.deleted_at).toBeNull();
    });

    it('no aparece en las Entradas del origen ni en Envios del destino', async () => {
      const envio = await crear('envio');
      const entradasK = (
        await http()
          .get('/operaciones-almacen')
          .query({ sucursal: K, fecha: hoy, tipo: 'entrada' })
          .set('Cookie', cookieK)
          .expect(200)
      ).body as OperacionesDelDia;
      expect(entradasK.operaciones.map((o) => o.id)).not.toContain(envio.id);
      const enviosL = (
        await http()
          .get('/operaciones-almacen')
          .query({ sucursal: L, fecha: hoy, tipo: 'envio' })
          .set('Cookie', cookieGeneral)
          .expect(200)
      ).body as OperacionesDelDia;
      expect(enviosL.operaciones.map((o) => o.id)).not.toContain(envio.id);
    });

    it('sin operacion.entrada el destino no lo ve: 403', async () => {
      await http()
        .get('/operaciones-almacen')
        .query({ sucursal: L, fecha: hoy, tipo: 'entrada' })
        .set('Cookie', cookieSin)
        .expect(403);
    });
  });

  describe('Review Focus 2: el permiso del tipo en todas las rutas', () => {
    it('con solo operacion.consumo, una entrada da 403 al crear, editar, ver, listar y dar de baja', async () => {
      const entrada = await crear('entrada');
      await http()
        .post('/operaciones-almacen')
        .set('Cookie', cookieKConsumo)
        .send(cuerpo('entrada'))
        .expect(403);
      await http()
        .put(`/operaciones-almacen/${entrada.id}`)
        .set('Cookie', cookieKConsumo)
        .send({
          fecha: hoy,
          origen: 'compra',
          lineas: [{ presentacionId: litro, piezas: 1 }],
        })
        .expect(403);
      await http()
        .get(`/operaciones-almacen/${entrada.id}`)
        .set('Cookie', cookieKConsumo)
        .expect(403);
      await http()
        .get('/operaciones-almacen')
        .query({ sucursal: K, fecha: hoy, tipo: 'entrada' })
        .set('Cookie', cookieKConsumo)
        .expect(403);
      await http()
        .delete(`/operaciones-almacen/${entrada.id}`)
        .set('Cookie', cookieKConsumo)
        .expect(403);
      // Y lo suyo si puede.
      await http()
        .post('/operaciones-almacen')
        .set('Cookie', cookieKConsumo)
        .send(cuerpo('consumo'))
        .expect(201);
      await http()
        .get('/operaciones-almacen')
        .query({ sucursal: K, fecha: hoy, tipo: 'consumo' })
        .set('Cookie', cookieKConsumo)
        .expect(200);
    });

    it('sin ningun permiso: 403 en todos los tipos; sin sesion, 401', async () => {
      for (const tipo of TIPOS) {
        await http()
          .post('/operaciones-almacen')
          .set('Cookie', cookieSin)
          .send(cuerpo(tipo))
          .expect(403);
      }
      await http()
        .get('/operaciones-almacen')
        .query({ sucursal: K, fecha: hoy, tipo: 'consumo' })
        .expect(401);
    });
  });

  describe('Review Focus 3: la regla de fecha del envio', () => {
    it('un envio de antier no se puede crear, corregir ni dar de baja (400); uno de ayer si', async () => {
      await http()
        .post('/operaciones-almacen')
        .set('Cookie', cookieK)
        .send(cuerpo('envio', { fecha: antier }))
        .expect(400);
      const ayerOk = await crear('envio', { fecha: ayer });
      expect(ayerOk.editable).toBe(true);

      const viejo = await sembrar('envio', antier);
      const leido = (
        await http()
          .get(`/operaciones-almacen/${viejo}`)
          .set('Cookie', cookieK)
          .expect(200)
      ).body as OperacionAlmacen;
      expect(leido.editable).toBe(false);
      const put = await http()
        .put(`/operaciones-almacen/${viejo}`)
        .set('Cookie', cookieK)
        .send({
          fecha: hoy,
          destino: L,
          lineas: [{ presentacionId: litro, piezas: 1 }],
        })
        .expect(400);
      expect(JSON.stringify(mensajes(put.body))).toContain('envío');
      await http()
        .delete(`/operaciones-almacen/${viejo}`)
        .set('Cookie', cookieK)
        .expect(400);
      const intacta = await db
        .selectFrom('operacion_almacen')
        .select('deleted_at')
        .where('id', '=', viejo)
        .executeTakeFirstOrThrow();
      expect(intacta.deleted_at).toBeNull();
    });

    it('corregir un envio de hoy hacia antier es 400', async () => {
      const e = await crear('envio');
      await http()
        .put(`/operaciones-almacen/${e.id}`)
        .set('Cookie', cookieK)
        .send({
          fecha: antier,
          destino: L,
          lineas: [{ presentacionId: litro, piezas: 1 }],
        })
        .expect(400);
    });

    it('los otros tipos aceptan cualquier dia hasta hoy, y nunca el futuro', async () => {
      for (const tipo of [
        'entrada',
        'merma',
        'consumo',
        'descuento',
      ] as const) {
        await crear(tipo, { fecha: '2020-03-01' });
        const res = await http()
          .post('/operaciones-almacen')
          .set('Cookie', cookieK)
          .send(cuerpo(tipo, { fecha: manana }))
          .expect(400);
        expect(mensajes(res.body)).toContain(
          'La fecha no puede ser posterior a hoy.',
        );
      }
      await http()
        .post('/operaciones-almacen')
        .set('Cookie', cookieK)
        .send(cuerpo('envio', { fecha: manana }))
        .expect(400);
      const vieja = await sembrar('entrada', '2020-03-02');
      await http()
        .delete(`/operaciones-almacen/${vieja}`)
        .set('Cookie', cookieK)
        .expect(204);
    });

    it('listar un dia futuro o inexistente es 400', async () => {
      await http()
        .get('/operaciones-almacen')
        .query({ sucursal: K, fecha: manana, tipo: 'consumo' })
        .set('Cookie', cookieK)
        .expect(400);
      await http()
        .get('/operaciones-almacen')
        .query({ sucursal: K, fecha: '2026-02-30', tipo: 'consumo' })
        .set('Cookie', cookieK)
        .expect(400);
    });
  });

  describe('Review Focus 4: el motivo de la merma', () => {
    it('un motivo dado de baja, sin "almacen" o inexistente no se acepta en una merma nueva', async () => {
      const baja = await crearMotivo('Baja', { baja: true });
      const sinAlmacen = await crearMotivo('Sin almacen', { almacen: false });
      for (const motivoId of [
        baja,
        sinAlmacen,
        '3f2504e0-4f89-41d3-9a0c-0305e82c3399',
      ]) {
        const res = await http()
          .post('/operaciones-almacen')
          .set('Cookie', cookieK)
          .send(cuerpo('merma', { motivoId }))
          .expect(400);
        expect(mensajes(res.body)[0]).toContain('motivo');
      }
      await http()
        .post('/operaciones-almacen')
        .set('Cookie', cookieK)
        .send(cuerpo('merma', { motivoId: undefined }))
        .expect(400);
    });

    it('una merma existente conserva su motivo al editar aunque se de de baja, pero no se cambia a uno invalido', async () => {
      const motivo = await crearMotivo('Se dara de baja');
      const merma = await crear('merma', { motivoId: motivo });
      await db
        .updateTable('motivo_merma')
        .set({ deleted_at: sql<Date>`now()` })
        .where('id', '=', motivo)
        .execute();
      const editada = (
        await http()
          .put(`/operaciones-almacen/${merma.id}`)
          .set('Cookie', cookieK)
          .send({
            fecha: hoy,
            motivoId: motivo,
            comentario: 'Se corrige solo el comentario',
            lineas: [{ presentacionId: litro, piezas: 4 }],
          })
          .expect(200)
      ).body as OperacionAlmacen;
      expect(editada.motivo?.id).toBe(motivo);
      expect(editada.piezas).toBe(4);

      const otroBaja = await crearMotivo('Otro de baja', { baja: true });
      await http()
        .put(`/operaciones-almacen/${merma.id}`)
        .set('Cookie', cookieK)
        .send({
          fecha: hoy,
          motivoId: otroBaja,
          lineas: [{ presentacionId: litro, piezas: 4 }],
        })
        .expect(400);
      const leida = (
        await http()
          .get(`/operaciones-almacen/${merma.id}`)
          .set('Cookie', cookieK)
          .expect(200)
      ).body as OperacionAlmacen;
      expect(leida.motivo?.id).toBe(motivo);
    });
  });

  describe('alcance de sucursal', () => {
    it('atado: pedir otra sucursal al listar o crear es 403; "todas" o nada le da la suya', async () => {
      await http()
        .get('/operaciones-almacen')
        .query({ sucursal: L, fecha: hoy, tipo: 'consumo' })
        .set('Cookie', cookieK)
        .expect(403);
      await http()
        .post('/operaciones-almacen')
        .set('Cookie', cookieK)
        .send(cuerpo('consumo', { sucursal: L }))
        .expect(403);
      const propia = await crear('consumo');
      for (const sucursal of ['todas', undefined]) {
        const lista = (
          await http()
            .get('/operaciones-almacen')
            .query({ sucursal, fecha: hoy, tipo: 'consumo' })
            .set('Cookie', cookieK)
            .expect(200)
        ).body as OperacionesDelDia;
        expect(lista.operaciones.map((o) => o.id)).toContain(propia.id);
      }
    });

    it('una operacion de otra sucursal es 404 al ver, editar o dar de baja', async () => {
      const ajena = await crear('consumo', { sucursal: L }, cookieGeneral);
      await http()
        .get(`/operaciones-almacen/${ajena.id}`)
        .set('Cookie', cookieK)
        .expect(404);
      await http()
        .put(`/operaciones-almacen/${ajena.id}`)
        .set('Cookie', cookieK)
        .send({ fecha: hoy, lineas: [{ presentacionId: litro, piezas: 1 }] })
        .expect(404);
      await http()
        .delete(`/operaciones-almacen/${ajena.id}`)
        .set('Cookie', cookieK)
        .expect(404);
    });

    it('un General con "todas" o sin sucursal debe elegir una (400)', async () => {
      for (const sucursal of ['todas', undefined]) {
        const res = await http()
          .get('/operaciones-almacen')
          .query({ sucursal, fecha: hoy, tipo: 'consumo' })
          .set('Cookie', cookieGeneral)
          .expect(400);
        expect(mensajes(res.body)).toContain('Elige una sucursal.');
      }
      const res = await http()
        .post('/operaciones-almacen')
        .set('Cookie', cookieGeneral)
        .send(cuerpo('consumo', { sucursal: 'todas' }))
        .expect(400);
      expect(mensajes(res.body)).toContain('Elige una sucursal.');
    });

    it('una sucursal que no existe es 404; un id mal formado, 400; una operacion inexistente, 404', async () => {
      await http()
        .get('/operaciones-almacen')
        .query({ sucursal: 'QQ', fecha: hoy, tipo: 'consumo' })
        .set('Cookie', cookieGeneral)
        .expect(404);
      await http()
        .get('/operaciones-almacen/no-es-uuid')
        .set('Cookie', cookieGeneral)
        .expect(400);
      await http()
        .get('/operaciones-almacen/3f2504e0-4f89-41d3-9a0c-0305e82c3399')
        .set('Cookie', cookieGeneral)
        .expect(404);
    });
  });

  describe('validacion y topes', () => {
    const rechaza = async (
      extra: Record<string, unknown>,
      tipo: (typeof TIPOS)[number],
      texto: string,
    ) => {
      const res = await http()
        .post('/operaciones-almacen')
        .set('Cookie', cookieK)
        .send(cuerpo(tipo, extra))
        .expect(400);
      expect(mensajes(res.body).join(' | ')).toContain(texto);
    };

    it('mas de 200 presentaciones es 400; 200 pasan', async () => {
      const lineas = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
          presentacionId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          piezas: 1,
        }));
      await rechaza({ lineas: lineas(201) }, 'consumo', 'más de 200');
    });

    it('piezas fuera de 1..100000, sin lineas, repetidas', async () => {
      await rechaza(
        { lineas: [{ presentacionId: litro, piezas: 100001 }] },
        'consumo',
        'entre 1 y 100000',
      );
      await rechaza(
        { lineas: [{ presentacionId: litro, piezas: 0 }] },
        'consumo',
        'entre 1 y 100000',
      );
      await rechaza({ lineas: [] }, 'consumo', 'al menos una');
      await rechaza(
        {
          lineas: [
            { presentacionId: litro, piezas: 1 },
            { presentacionId: litro, piezas: 2 },
          ],
        },
        'consumo',
        'repetida',
      );
      const tope = await crear('consumo', {
        lineas: [{ presentacionId: litro, piezas: 100000 }],
      });
      expect(tope.piezas).toBe(100000);
    });

    it('una presentacion inexistente o dada de baja es 400 y no deja nada a medias', async () => {
      const antes = await db
        .selectFrom('operacion_almacen')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('sucursal_id', '=', kId)
        .executeTakeFirstOrThrow();
      await rechaza(
        {
          lineas: [
            { presentacionId: litro, piezas: 1 },
            {
              presentacionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3399',
              piezas: 1,
            },
          ],
        },
        'consumo',
        'presentaciones no existe',
      );
      const baja = await crearPresentacion('baja');
      await db
        .updateTable('presentacion')
        .set({ deleted_at: sql<Date>`now()` })
        .where('id', '=', baja)
        .execute();
      await rechaza(
        { lineas: [{ presentacionId: baja, piezas: 1 }] },
        'consumo',
        'presentaciones no existe',
      );
      const despues = await db
        .selectFrom('operacion_almacen')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('sucursal_id', '=', kId)
        .executeTakeFirstOrThrow();
      expect(despues.n).toBe(antes.n);
    });

    it('datos propios de cada tipo', async () => {
      await rechaza({ origen: undefined }, 'entrada', 'producción o de compra');
      await rechaza({ origen: 'regalo' }, 'entrada', 'producción o de compra');
      await rechaza({ destino: undefined }, 'envio', 'destino');
      await rechaza({ destino: K }, 'envio', 'otra sucursal');
      await rechaza({ destino: 'QQ' }, 'envio', 'destino');
      await rechaza({ trabajador: '   ' }, 'descuento', 'trabajador');
      await rechaza(
        { trabajador: 'x'.repeat(121) },
        'descuento',
        'no puede pasar de 120',
      );
      await rechaza({ comentario: 'x'.repeat(301) }, 'consumo', '300');
      await http()
        .post('/operaciones-almacen')
        .set('Cookie', cookieK)
        .send(cuerpo('consumo', { tipo: 'retiro_merma' }))
        .expect(400);
    });

    it('el trabajador se guarda recortado y lo que no es del tipo se ignora', async () => {
      const d = await crear('descuento', {
        trabajador: '  Mario  ',
        origen: 'compra',
        destino: L,
        motivoId: motivoOk,
      });
      expect(d).toMatchObject({
        trabajador: 'Mario',
        origen: null,
        destino: null,
        motivo: null,
      });
    });
  });

  describe('/produccion se retiro', () => {
    it('GET y PUT /produccion ya no existen (404)', async () => {
      await http()
        .get('/produccion')
        .query({ fecha: hoy, sucursal: K })
        .set('Cookie', cookieGeneral)
        .expect(404);
      await http()
        .put('/produccion')
        .set('Cookie', cookieGeneral)
        .send({ fecha: hoy, sucursal: K, lineas: [] })
        .expect(404);
    });
  });
});

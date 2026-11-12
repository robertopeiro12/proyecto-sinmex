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
import {
  diaSemanaDe,
  nombreDia,
} from './../src/modules/rutas/reglas-ruta-semanal';
import type {
  ListaDelDia,
  OpcionesDia,
  RutaDiaria,
} from './../src/modules/rutas/rutas-diarias.service';
import type { RutaSemanalDetalle } from './../src/modules/rutas/rutas-semanales.service';

/**
 * Ruta Diaria desde el portal (T-37, D14; spec §5), de punta a punta: permiso,
 * alcance, reemplazo que conserva lo del vendedor, renumeracion, ruta semanal,
 * vehiculo, recados, "Quitar ruta" y la lista del dia.
 *
 * Fechas desde JUNIO DE 2099 (futuras: un dia pasado es de solo lectura),
 * exclusivas de este archivo. Los vendedores son nuevos en cada corrida
 * (`SUFIJO`), asi que sus rutas tambien.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-ruta-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-ruta-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-ruta-sin-${SUFIJO}`;
const LOGIN_SOLO_DIARIA = `e2e-ruta-solo-${SUFIJO}`;

describe('Ruta Diaria desde el portal (e2e)', () => {
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
  /** Perfil vacio + la excepcion `ruta_diaria.gestionar`: sin `ruta_semanal.gestionar`. */
  let cookieSoloDiaria: string;
  let vendedorTj: string;
  let vendedorMx: string;

  const rutaIds: string[] = [];
  const vehiculoIds: string[] = [];
  let clientes = 0;
  let dias = 0;
  let folios = 0;
  /** Un dia propio por prueba, desde 2099-06-01, sin domingos (no tienen ruta semanal). */
  const diaNuevo = (): string => {
    const fecha = new Date(Date.UTC(2099, 5, 1) + dias++ * 86_400_000)
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

  const sembrarVendedor = async (
    sucursalId: string,
    extra: { nombre?: string; activo?: boolean } = {},
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-ruta-v${vendedorIds.length + 1}-${SUFIJO}`,
        nombre:
          extra.nombre ?? `Vendedor ruta ${vendedorIds.length + 1} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
        activo: extra.activo ?? true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  const sembrarVehiculo = async (
    sucursalId: string,
  ): Promise<{ id: string; nombre: string }> => {
    const nombre = `Camioneta ${vehiculoIds.length + 1} ${SUFIJO}`;
    const { id } = await db
      .insertInto('vehiculo')
      .values({ nombre, sucursal_id: sucursalId })
      .returning('id')
      .executeTakeFirstOrThrow();
    vehiculoIds.push(id);
    return { id, nombre };
  };

  /** Una nota a credito del cliente, `pendiente` por omision. */
  const sembrarNota = async (
    clienteId: string,
    status: 'pendiente' | 'pagada' = 'pendiente',
    extra: { contado?: boolean; borrada?: boolean } = {},
  ): Promise<string> =>
    (
      await db
        .insertInto('venta_nota')
        .values({
          folio: `ZZD${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(
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
          deleted_at: extra.borrada ? new Date() : null,
          sucursal_id: tjId,
          origen: 'portal',
          capturo_usuario_id: usuarioIds[0],
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  const asignarNota = async (
    ventaNotaId: string,
    vendedorId: string,
    fecha: string,
  ): Promise<string> =>
    (
      await db
        .insertInto('nota_asignada')
        .values({
          venta_nota_id: ventaNotaId,
          vendedor_id: vendedorId,
          fecha,
          asignada_por_usuario_id: usuarioIds[0],
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  /** Crea una ruta semanal de TJ del dia de la semana de `fecha`, con esa lista. */
  const crearSemanal = async (
    fecha: string,
    lista: string[],
    diaSemana = diaSemanaDe(fecha)!,
  ): Promise<RutaSemanalDetalle> => {
    const res = await request(app.getHttpServer())
      .post('/rutas/semanales')
      .set('Cookie', cookieGeneral)
      .send({
        sucursal: 'TJ',
        diaSemana,
        nombre: `Ruta ${rutaIds.length + 1} ${SUFIJO}`,
      })
      .expect(201);
    const ruta = res.body as RutaSemanalDetalle;
    rutaIds.push(ruta.id);
    await request(app.getHttpServer())
      .put(`/rutas/semanales/${ruta.id}/clientes`)
      .set('Cookie', cookieGeneral)
      .send({ clientes: lista })
      .expect(200);
    return ruta;
  };

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
    const nombre = `Ruta portal ${++clientes} ${SUFIJO}`;
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

  const obtener = (cookie: string, vendedorId: string, fecha: string) =>
    request(app.getHttpServer())
      .get(
        `/rutas/diaria?${new URLSearchParams({ vendedorId, fecha }).toString()}`,
      )
      .set('Cookie', cookie);

  /** `clientes`: un id solo (sin recado) o `{ clienteId, recado }`. */
  const guardar = (
    cookie: string,
    cuerpo: {
      vendedorId: string;
      fecha: string;
      rutaSemanalId?: string | null;
      vehiculoId?: string | null;
      clientes: (string | { clienteId: string; recado?: string | null })[];
    },
  ) =>
    request(app.getHttpServer())
      .put('/rutas/diaria')
      .set('Cookie', cookie)
      .send({
        ...cuerpo,
        clientes: cuerpo.clientes.map((c) =>
          typeof c === 'string' ? { clienteId: c } : c,
        ),
      });

  const quitar = (cookie: string, vendedorId: string, fecha: string) =>
    request(app.getHttpServer())
      .delete(
        `/rutas/diaria?${new URLSearchParams({ vendedorId, fecha }).toString()}`,
      )
      .set('Cookie', cookie);

  const listaDelDia = (cookie: string, consulta: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/rutas/diaria/dia?${new URLSearchParams(consulta).toString()}`)
      .set('Cookie', cookie);

  const opciones = (cookie: string, vendedorId: string, fecha: string) =>
    request(app.getHttpServer())
      .get(
        `/rutas/diaria/opciones?${new URLSearchParams({ vendedorId, fecha }).toString()}`,
      )
      .set('Cookie', cookie);

  const mensaje = (res: { body: unknown }) =>
    (res.body as { message: string | string[] }).message;

  /** Todas las filas (vivas y borradas) de un vendedor y dia, por orden. */
  const filasDe = (vendedor: string, fecha: string) =>
    db
      .selectFrom('ruta')
      .select(['id', 'cliente_id', 'orden', 'origen', 'deleted_at'])
      .where('vendedor_id', '=', vendedor)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .orderBy('orden')
      .execute();

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

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', tjId);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    const soloDiaria = await crearUsuario(
      LOGIN_SOLO_DIARIA,
      'Auxiliar Administrativo',
      tjId,
    );
    const { id: permisoDiaria } = await db
      .selectFrom('permiso')
      .select('id')
      .where('clave', '=', 'ruta_diaria.gestionar')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('usuario_permiso')
      .values({
        usuario_id: soloDiaria,
        permiso_id: permisoDiaria,
        habilitado: true,
      })
      .execute();
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
    cookieSoloDiaria = await iniciarSesion(LOGIN_SOLO_DIARIA);

    vendedorTj = await sembrarVendedor(tjId);
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
    await db
      .deleteFrom('ruta_dia')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    if (rutaIds.length > 0) {
      await db
        .deleteFrom('ruta_semanal_cliente')
        .where('ruta_semanal_id', 'in', rutaIds)
        .execute();
      await db.deleteFrom('ruta_semanal').where('id', 'in', rutaIds).execute();
    }
    if (vehiculoIds.length > 0) {
      await db.deleteFrom('vehiculo').where('id', 'in', vehiculoIds).execute();
    }
    if (clienteIds.length > 0) {
      await db
        .deleteFrom('venta_nota')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
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

  describe('permiso y alcance', () => {
    it('sin ruta_diaria.gestionar todo es 403, lectura incluida', async () => {
      const fecha = diaNuevo();
      await obtener(cookieSinPermiso, vendedorTj, fecha).expect(403);
      await opciones(cookieSinPermiso, vendedorTj, fecha).expect(403);
      await listaDelDia(cookieSinPermiso, { fecha, sucursal: 'TJ' }).expect(
        403,
      );
      await quitar(cookieSinPermiso, vendedorTj, fecha).expect(403);
      await guardar(cookieSinPermiso, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [],
      }).expect(403);
    });

    it('un usuario atado a TJ no ve al vendedor de MX: 404, no 403', async () => {
      const fecha = diaNuevo();
      await obtener(cookieTijuana, vendedorMx, fecha).expect(404);
      await guardar(cookieTijuana, {
        vendedorId: vendedorMx,
        fecha,
        clientes: [],
      }).expect(404);
      await opciones(cookieTijuana, vendedorMx, fecha).expect(404);
      await quitar(cookieTijuana, vendedorMx, fecha).expect(404);
    });

    it('el General ve a cualquiera; sin filas responde el vendedor con la lista vacia', async () => {
      const fecha = diaNuevo();
      const res = await obtener(cookieGeneral, vendedorMx, fecha).expect(200);
      expect(res.body).toEqual({
        vendedor: {
          id: vendedorMx,
          nombre: expect.stringContaining('Vendedor ruta') as string,
          sucursalCodigo: 'MX',
        },
        fecha,
        editable: true,
        rutaSemanal: null,
        vehiculo: null,
        filas: [],
      });
    });

    it('fecha mal formada, fecha imposible o vendedor que no es uuid es 400', async () => {
      await obtener(cookieGeneral, vendedorTj, '12/06/2099').expect(400);
      await obtener(cookieGeneral, vendedorTj, '2099-02-30').expect(400);
      await obtener(cookieGeneral, 'no-soy-uuid', diaNuevo()).expect(400);
    });
  });

  describe('PUT: reemplazo', () => {
    it('guarda la lista en orden, como de la oficina, y responde como el GET', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const b = await sembrarCliente(tjId);

      const res = await guardar(cookieTijuana, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [b.id, a.id],
      }).expect(200);

      const cuerpo = res.body as RutaDiaria;
      expect(cuerpo.filas).toEqual([
        {
          id: expect.any(String) as string,
          clienteId: b.id,
          clienteNombre: b.nombre,
          orden: 1,
          origen: 'oficina',
          recado: null,
          notasAsignadas: 0,
        },
        {
          id: expect.any(String) as string,
          clienteId: a.id,
          clienteNombre: a.nombre,
          orden: 2,
          origen: 'oficina',
          recado: null,
          notasAsignadas: 0,
        },
      ]);
      expect(
        (await obtener(cookieTijuana, vendedorTj, fecha).expect(200)).body,
      ).toEqual(cuerpo);
    });

    it('conserva las del vendedor que no vienen y las renumera al final en su orden', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const b = await sembrarCliente(tjId);
      const c = await sembrarCliente(tjId);
      const d = await sembrarCliente(tjId);
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: a.id,
        fecha,
        orden: 1,
      });
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: b.id,
        fecha,
        orden: 2,
        origen: 'vendedor',
      });
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: d.id,
        fecha,
        orden: 5,
        origen: 'vendedor',
      });

      const res = await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [c.id, a.id],
      }).expect(200);

      expect(
        (res.body as RutaDiaria).filas.map((f) => [
          f.clienteId,
          f.orden,
          f.origen,
        ]),
      ).toEqual([
        [c.id, 1, 'oficina'],
        [a.id, 2, 'oficina'],
        [b.id, 3, 'vendedor'],
        [d.id, 4, 'vendedor'],
      ]);
    });

    it('la fila que subio el vendedor y la oficina incluye sigue siendo la misma fila y conserva su origen', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const id = await sembrarRuta({
        vendedor: vendedorTj,
        cliente: a.id,
        fecha,
        orden: 1,
        origen: 'vendedor',
      });

      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [a.id],
      }).expect(200);

      expect(await filasDe(vendedorTj, fecha)).toEqual([
        {
          id,
          cliente_id: a.id,
          orden: 1,
          origen: 'vendedor',
          deleted_at: null,
        },
      ]);
    });

    it('da de baja (no borra) las de la oficina que ya no vienen', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const c = await sembrarCliente(tjId);
      const idA = await sembrarRuta({
        vendedor: vendedorTj,
        cliente: a.id,
        fecha,
        orden: 1,
      });
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: c.id,
        fecha,
        orden: 2,
      });

      const res = await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [c.id],
      }).expect(200);

      expect((res.body as RutaDiaria).filas.map((f) => f.clienteId)).toEqual([
        c.id,
      ]);
      const quitada = (await filasDe(vendedorTj, fecha)).find(
        (f) => f.id === idA,
      );
      expect(quitada?.deleted_at).not.toBeNull();
    });

    it('un cliente de otra sucursal es 400 y no cambia nada', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const ajeno = await sembrarCliente(mxId);
      await sembrarRuta({
        vendedor: vendedorTj,
        cliente: a.id,
        fecha,
        orden: 1,
      });

      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [ajeno.id],
      }).expect(400);

      expect(await filasDe(vendedorTj, fecha)).toMatchObject([
        { cliente_id: a.id, deleted_at: null },
      ]);
    });

    it('un prospecto, un cliente dado de baja o un cliente repetido es 400', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const p = await sembrarCliente(tjId, { tipo: 'prospecto' });
      const z = await sembrarCliente(tjId, { borrado: true });

      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [p.id],
      }).expect(400);
      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [z.id],
      }).expect(400);
      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [a.id, a.id.toUpperCase()],
      }).expect(400);
      expect(await filasDe(vendedorTj, fecha)).toHaveLength(0);
    });

    it('guardar conserva una fila del vendedor cuyo cliente ya se borro', async () => {
      // El portal no deja quitar las filas del vendedor: si se revalidara su
      // cliente, todo guardado de ese dia seria 400 y la oficina quedaria
      // bloqueada.
      const fecha = diaNuevo();
      const delVendedor = await sembrarCliente(tjId);
      const otro = await sembrarCliente(tjId);
      const idVendedor = await sembrarRuta({
        vendedor: vendedorTj,
        cliente: delVendedor.id,
        fecha,
        orden: 1,
        origen: 'vendedor',
      });
      await db
        .updateTable('cliente')
        .set({ deleted_at: new Date() })
        .where('id', '=', delVendedor.id)
        .execute();

      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [delVendedor.id, otro.id],
      }).expect(200);

      expect(
        (await filasDe(vendedorTj, fecha)).filter((f) => f.deleted_at === null),
      ).toMatchObject([
        { id: idVendedor, cliente_id: delVendedor.id, orden: 1 },
        { cliente_id: otro.id, orden: 2, origen: 'oficina' },
      ]);
    });

    it('un cliente de otra sucursal se rechaza por su id, sin revelar su nombre', async () => {
      const fecha = diaNuevo();
      const ajeno = await sembrarCliente(mxId);

      const res = await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [ajeno.id],
      }).expect(400);

      const { message } = res.body as { message: string };
      expect(message).toContain(ajeno.id);
      expect(message).not.toContain(ajeno.nombre);
    });

    it('un cliente nuevo invalido se rechaza nombrandolo', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const p = await sembrarCliente(tjId, { tipo: 'prospecto' });

      const res = await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [a.id, p.id],
      }).expect(400);

      const { message } = res.body as { message: string };
      expect(message).toContain(p.nombre);
      expect(message).not.toContain(a.nombre);
      expect(await filasDe(vendedorTj, fecha)).toHaveLength(0);
    });
  });

  describe('PUT: ruta semanal, vehiculo y recados', () => {
    it('asigna una ruta semanal y copia sus clientes en orden', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const b = await sembrarCliente(tjId);
      const z = await sembrarCliente(tjId);
      const aMano = await sembrarCliente(tjId);
      const semanal = await crearSemanal(fecha, [b.id, z.id, a.id]);
      // Z se dio de baja despues de entrar a la semanal: asignar la ruta no
      // falla, Z se salta.
      await db
        .updateTable('cliente')
        .set({ deleted_at: new Date() })
        .where('id', '=', z.id)
        .execute();

      const res = await guardar(cookieTijuana, {
        vendedorId: vendedorTj,
        fecha,
        rutaSemanalId: semanal.id,
        clientes: [b.id, z.id, a.id, aMano.id],
      }).expect(200);

      const cuerpo = res.body as RutaDiaria;
      expect(cuerpo.rutaSemanal).toEqual({
        id: semanal.id,
        nombre: semanal.nombre,
      });
      expect(cuerpo.filas.map((f) => [f.clienteId, f.orden, f.origen])).toEqual(
        [
          [b.id, 1, 'semanal'],
          [a.id, 2, 'semanal'],
          [aMano.id, 3, 'oficina'],
        ],
      );
      expect(
        (await obtener(cookieTijuana, vendedorTj, fecha).expect(200)).body,
      ).toEqual(cuerpo);

      // Un cliente dado de baja agregado A MANO (no esta en la semanal) sigue siendo 400.
      const otroDeBaja = await sembrarCliente(tjId, { borrado: true });
      await guardar(cookieTijuana, {
        vendedorId: vendedorTj,
        fecha,
        rutaSemanalId: semanal.id,
        clientes: [b.id, a.id, otroDeBaja.id],
      }).expect(400);
    });

    it('la misma ruta a otro vendedor el mismo dia = 409', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const semanal = await crearSemanal(fecha, [a.id]);
      const juan = await sembrarVendedor(tjId, {
        nombre: `Juan ${SUFIJO}`,
      });
      const ricardo = await sembrarVendedor(tjId);
      await guardar(cookieGeneral, {
        vendedorId: juan,
        fecha,
        rutaSemanalId: semanal.id,
        clientes: [a.id],
      }).expect(200);

      const res = await guardar(cookieGeneral, {
        vendedorId: ricardo,
        fecha,
        rutaSemanalId: semanal.id,
        clientes: [a.id],
      }).expect(409);
      expect(mensaje(res)).toBe(`Esa ruta ya la trae Juan ${SUFIJO} ese día.`);
      expect(await filasDe(ricardo, fecha)).toHaveLength(0);

      // Las opciones de Ricardo la marcan ocupada; las de Juan no.
      const deRicardo = (
        await opciones(cookieGeneral, ricardo, fecha).expect(200)
      ).body as OpcionesDia;
      expect(deRicardo.rutas).toContainEqual({
        id: semanal.id,
        nombre: semanal.nombre,
        ocupadaPor: `Juan ${SUFIJO}`,
        clientes: [{ clienteId: a.id, nombre: a.nombre, valido: true }],
      });
      const deJuan = (await opciones(cookieGeneral, juan, fecha).expect(200))
        .body as OpcionesDia;
      expect(deJuan.rutas).toContainEqual({
        id: semanal.id,
        nombre: semanal.nombre,
        ocupadaPor: null,
        clientes: [{ clienteId: a.id, nombre: a.nombre, valido: true }],
      });

      // Juan la puede volver a guardar (es suya).
      await guardar(cookieGeneral, {
        vendedorId: juan,
        fecha,
        rutaSemanalId: semanal.id,
        clientes: [a.id],
      }).expect(200);
    });

    it('ruta de otro dia de la semana = 400', async () => {
      const fecha = diaNuevo();
      const dia = diaSemanaDe(fecha)!;
      const otroDia = (dia % 6) + 1;
      const semanal = await crearSemanal(fecha, [], otroDia);

      const res = await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        rutaSemanalId: semanal.id,
        clientes: [],
      }).expect(400);
      expect(mensaje(res)).toBe(`Esa ruta no es del ${nombreDia(dia)}.`);
      expect(
        (
          (await opciones(cookieGeneral, vendedorTj, fecha).expect(200))
            .body as OpcionesDia
        ).rutas.map((r) => r.id),
      ).not.toContain(semanal.id);
    });

    it('una ruta dada de baja o que no existe = 400 "Esa ruta ya no existe."; una de otra sucursal, como de otro dia', async () => {
      const fecha = diaNuevo();
      const dia = diaSemanaDe(fecha)!;
      const deBaja = await crearSemanal(fecha, []);
      await request(app.getHttpServer())
        .delete(`/rutas/semanales/${deBaja.id}`)
        .set('Cookie', cookieGeneral)
        .expect(204);
      const pedir = (rutaSemanalId: string) =>
        guardar(cookieGeneral, {
          vendedorId: vendedorTj,
          fecha,
          rutaSemanalId,
          clientes: [],
        }).expect(400);

      expect(mensaje(await pedir(deBaja.id))).toBe('Esa ruta ya no existe.');
      expect(mensaje(await pedir('00000000-0000-4000-8000-0000000000aa'))).toBe(
        'Esa ruta ya no existe.',
      );

      const deMx = (
        await request(app.getHttpServer())
          .post('/rutas/semanales')
          .set('Cookie', cookieGeneral)
          .send({
            sucursal: 'MX',
            diaSemana: dia,
            nombre: `Ruta MX ${rutaIds.length + 1} ${SUFIJO}`,
          })
          .expect(201)
      ).body as RutaSemanalDetalle;
      rutaIds.push(deMx.id);
      expect(mensaje(await pedir(deMx.id))).toBe(
        `Esa ruta no es del ${nombreDia(dia)}.`,
      );
      expect(await filasDe(vendedorTj, fecha)).toHaveLength(0);
    });

    it('fecha pasada = 400 en PUT y DELETE; el GET responde editable:false', async () => {
      const pasada = '2020-01-06';
      const put = await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha: pasada,
        clientes: [],
      }).expect(400);
      expect(mensaje(put)).toBe('Ese día ya pasó; solo se puede consultar.');
      const del = await quitar(cookieGeneral, vendedorTj, pasada).expect(400);
      expect(mensaje(del)).toBe('Ese día ya pasó; solo se puede consultar.');

      const get = await obtener(cookieGeneral, vendedorTj, pasada).expect(200);
      expect((get.body as RutaDiaria).editable).toBe(false);
      const dia = await listaDelDia(cookieGeneral, {
        fecha: pasada,
        sucursal: 'TJ',
      }).expect(200);
      expect((dia.body as ListaDelDia).editable).toBe(false);
    });

    it('guarda vehiculo y recado', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const b = await sembrarCliente(tjId);
      const vehiculo = await sembrarVehiculo(tjId);

      const res = await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        vehiculoId: vehiculo.id,
        clientes: [
          { clienteId: a.id, recado: '  Vender solo de contado  ' },
          { clienteId: b.id, recado: '   ' },
        ],
      }).expect(200);

      const cuerpo = res.body as RutaDiaria;
      expect(cuerpo.vehiculo).toEqual(vehiculo);
      expect(cuerpo.rutaSemanal).toBeNull();
      expect(cuerpo.filas.map((f) => [f.clienteId, f.recado])).toEqual([
        [a.id, 'Vender solo de contado'],
        [b.id, null],
      ]);

      // Otro vendedor ve el vehiculo ocupado, pero lo puede escoger.
      const otro = await sembrarVendedor(tjId);
      const ops = (await opciones(cookieGeneral, otro, fecha).expect(200))
        .body as OpcionesDia;
      expect(ops.vehiculos).toContainEqual({
        ...vehiculo,
        ocupadoPor: cuerpo.vendedor.nombre,
      });
      await guardar(cookieGeneral, {
        vendedorId: otro,
        fecha,
        vehiculoId: vehiculo.id,
        clientes: [],
      }).expect(200);

      // Recado de mas de 200 caracteres = 400.
      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [{ clienteId: a.id, recado: 'x'.repeat(201) }],
      }).expect(400);
    });

    it('vehiculo de otra sucursal = 400', async () => {
      const fecha = diaNuevo();
      const deMx = await sembrarVehiculo(mxId);
      const res = await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        vehiculoId: deMx.id,
        clientes: [],
      }).expect(400);
      expect(mensaje(res)).toBe('Ese vehículo no es de la sucursal.');
    });

    it('quitar un cliente con notas asignadas les da de baja', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const b = await sembrarCliente(tjId);
      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [a.id, b.id],
      }).expect(200);
      const notaA = await asignarNota(
        await sembrarNota(a.id),
        vendedorTj,
        fecha,
      );
      const notaB = await asignarNota(
        await sembrarNota(b.id),
        vendedorTj,
        fecha,
      );

      const antes = (
        await obtener(cookieGeneral, vendedorTj, fecha).expect(200)
      ).body as RutaDiaria;
      expect(antes.filas.map((f) => f.notasAsignadas)).toEqual([1, 1]);

      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        clientes: [b.id],
      }).expect(200);

      const notas = await db
        .selectFrom('nota_asignada')
        .select(['id', 'deleted_at', 'quitada_por_usuario_id'])
        .where('id', 'in', [notaA, notaB])
        .execute();
      const porId = new Map(notas.map((n) => [n.id, n]));
      expect(porId.get(notaA)?.deleted_at).not.toBeNull();
      expect(porId.get(notaA)?.quitada_por_usuario_id).toBe(usuarioIds[0]);
      expect(porId.get(notaB)?.deleted_at).toBeNull();

      const quitada = await db
        .selectFrom('ruta')
        .select('quitado_por')
        .where('vendedor_id', '=', vendedorTj)
        .where('cliente_id', '=', a.id)
        .where(sql<boolean>`fecha = ${fecha}::date`)
        .executeTakeFirstOrThrow();
      expect(quitada.quitado_por).toBe('oficina');
    });

    it('cambiar de ruta semanal saca lo de la anterior como cambio_ruta y conserva lo agregado a mano', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const b = await sembrarCliente(tjId);
      const aMano = await sembrarCliente(tjId);
      const vieja = await crearSemanal(fecha, [a.id]);
      const nueva = await crearSemanal(fecha, [b.id]);
      const vendedor = await sembrarVendedor(tjId);
      await guardar(cookieGeneral, {
        vendedorId: vendedor,
        fecha,
        rutaSemanalId: vieja.id,
        clientes: [a.id, aMano.id],
      }).expect(200);

      const res = await guardar(cookieGeneral, {
        vendedorId: vendedor,
        fecha,
        rutaSemanalId: nueva.id,
        clientes: [b.id, aMano.id],
      }).expect(200);
      expect((res.body as RutaDiaria).rutaSemanal?.id).toBe(nueva.id);
      expect(
        (res.body as RutaDiaria).filas.map((f) => [f.clienteId, f.origen]),
      ).toEqual([
        [b.id, 'semanal'],
        [aMano.id, 'oficina'],
      ]);
      const filaA = (await filasDe(vendedor, fecha)).find(
        (f) => f.cliente_id === a.id,
      );
      expect(filaA?.deleted_at).not.toBeNull();
      const { quitado_por } = await db
        .selectFrom('ruta')
        .select('quitado_por')
        .where('id', '=', filaA!.id)
        .executeTakeFirstOrThrow();
      expect(quitado_por).toBe('cambio_ruta');

      // La vieja quedo libre ese dia.
      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        rutaSemanalId: vieja.id,
        clientes: [a.id],
      }).expect(200);
    });
  });

  describe('PUT: ronda de arreglos 1', () => {
    it('una asignada de una venta eliminada no cuenta en las filas', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const vendedor = await sembrarVendedor(tjId);
      await guardar(cookieGeneral, {
        vendedorId: vendedor,
        fecha,
        clientes: [a.id],
      }).expect(200);
      await asignarNota(await sembrarNota(a.id), vendedor, fecha);
      await asignarNota(
        await sembrarNota(a.id, 'pendiente', { borrada: true }),
        vendedor,
        fecha,
      );

      const ruta = (await obtener(cookieGeneral, vendedor, fecha).expect(200))
        .body as RutaDiaria;
      expect(ruta.filas.map((f) => f.notasAsignadas)).toEqual([1]);
    });

    it('un PUT sin semanal, sin vehiculo y sin clientes no deja encabezado; si habia uno, lo da de baja', async () => {
      const fecha = diaNuevo();
      const vehiculo = await sembrarVehiculo(tjId);
      const vendedor = await sembrarVendedor(tjId);
      const encabezados = () =>
        db
          .selectFrom('ruta_dia')
          .select(['id', 'deleted_at'])
          .where('vendedor_id', '=', vendedor)
          .where(sql<boolean>`fecha = ${fecha}::date`)
          .execute();
      const renglon = async () =>
        (
          (
            await listaDelDia(cookieGeneral, { fecha, sucursal: 'TJ' }).expect(
              200,
            )
          ).body as ListaDelDia
        ).renglones.find((r) => r.vendedorId === vendedor);

      await guardar(cookieGeneral, {
        vendedorId: vendedor,
        fecha,
        clientes: [],
      }).expect(200);
      expect(await encabezados()).toHaveLength(0);
      expect((await renglon())?.tieneRuta).toBe(false);

      await guardar(cookieGeneral, {
        vendedorId: vendedor,
        fecha,
        vehiculoId: vehiculo.id,
        clientes: [],
      }).expect(200);
      expect((await renglon())?.tieneRuta).toBe(true);

      await guardar(cookieGeneral, {
        vendedorId: vendedor,
        fecha,
        clientes: [],
      }).expect(200);
      const despues = await encabezados();
      expect(despues).toHaveLength(1);
      expect(despues[0].deleted_at).not.toBeNull();
      expect((await renglon())?.tieneRuta).toBe(false);
    });

    it('reenviar el vehiculo ya asignado aunque se haya desactivado no es 400; uno nuevo desactivado si', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const asignado = await sembrarVehiculo(tjId);
      const otro = await sembrarVehiculo(tjId);
      const vendedor = await sembrarVendedor(tjId);
      await guardar(cookieGeneral, {
        vendedorId: vendedor,
        fecha,
        vehiculoId: asignado.id,
        clientes: [a.id],
      }).expect(200);
      await db
        .updateTable('vehiculo')
        .set({ activo: false })
        .where('id', 'in', [asignado.id, otro.id])
        .execute();

      const res = await guardar(cookieGeneral, {
        vendedorId: vendedor,
        fecha,
        vehiculoId: asignado.id,
        clientes: [{ clienteId: a.id, recado: 'Solo cobrar' }],
      }).expect(200);
      expect((res.body as RutaDiaria).vehiculo).toEqual(asignado);

      const malo = await guardar(cookieGeneral, {
        vendedorId: vendedor,
        fecha,
        vehiculoId: otro.id,
        clientes: [a.id],
      }).expect(400);
      expect(mensaje(malo)).toBe('Ese vehículo no es de la sucursal.');
    });
  });

  describe('DELETE: quitar ruta', () => {
    it('DELETE conserva lo del vendedor', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const b = await sembrarCliente(tjId);
      const delVendedor = await sembrarCliente(tjId);
      const vehiculo = await sembrarVehiculo(tjId);
      const semanal = await crearSemanal(fecha, [a.id]);
      const vendedor = await sembrarVendedor(tjId);
      const idVendedor = await sembrarRuta({
        vendedor,
        cliente: delVendedor.id,
        fecha,
        orden: 1,
        origen: 'vendedor',
      });
      await guardar(cookieGeneral, {
        vendedorId: vendedor,
        fecha,
        rutaSemanalId: semanal.id,
        vehiculoId: vehiculo.id,
        clientes: [a.id, b.id, delVendedor.id],
      }).expect(200);
      const nota = await asignarNota(await sembrarNota(a.id), vendedor, fecha);

      await quitar(cookieGeneral, vendedor, fecha).expect(204);

      const ruta = (await obtener(cookieGeneral, vendedor, fecha).expect(200))
        .body as RutaDiaria;
      expect(ruta.rutaSemanal).toBeNull();
      expect(ruta.vehiculo).toBeNull();
      expect(ruta.filas.map((f) => [f.id, f.origen])).toEqual([
        [idVendedor, 'vendedor'],
      ]);
      const quitadas = await db
        .selectFrom('ruta')
        .select('quitado_por')
        .where('vendedor_id', '=', vendedor)
        .where(sql<boolean>`fecha = ${fecha}::date`)
        .where('deleted_at', 'is not', null)
        .execute();
      expect(quitadas.map((q) => q.quitado_por)).toEqual([
        'cambio_ruta',
        'cambio_ruta',
      ]);
      const { deleted_at } = await db
        .selectFrom('nota_asignada')
        .select('deleted_at')
        .where('id', '=', nota)
        .executeTakeFirstOrThrow();
      expect(deleted_at).not.toBeNull();

      // La semanal quedo libre ese dia; quitar otra vez no falla.
      await guardar(cookieGeneral, {
        vendedorId: vendedorTj,
        fecha,
        rutaSemanalId: semanal.id,
        clientes: [a.id],
      }).expect(200);
      await quitar(cookieGeneral, vendedor, fecha).expect(204);
    });
  });

  describe('GET /dia: la lista del dia', () => {
    it('GET /dia lista a los vendedores activos con su ruta y conteos', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const b = await sembrarCliente(tjId);
      const vehiculo = await sembrarVehiculo(tjId);
      const semanal = await crearSemanal(fecha, [a.id, b.id]);
      const conRuta = await sembrarVendedor(tjId, {
        nombre: `AAA con ruta ${SUFIJO}`,
      });
      const sinRuta = await sembrarVendedor(tjId, {
        nombre: `AAB sin ruta ${SUFIJO}`,
      });
      const inactivo = await sembrarVendedor(tjId, {
        nombre: `AAC inactivo ${SUFIJO}`,
        activo: false,
      });
      await guardar(cookieGeneral, {
        vendedorId: conRuta,
        fecha,
        rutaSemanalId: semanal.id,
        vehiculoId: vehiculo.id,
        clientes: [a.id, b.id],
      }).expect(200);
      // A: dos notas con saldo (una asignada); B: una pagada, no cuenta.
      const notaA1 = await sembrarNota(a.id);
      await sembrarNota(a.id);
      await sembrarNota(b.id, 'pagada');
      // Una de CONTADO pendiente no es nota por cobrar (spec §5.4).
      await sembrarNota(b.id, 'pendiente', { contado: true });
      await asignarNota(notaA1, conRuta, fecha);
      // Una asignada de una venta que despues se elimino ya no cuenta.
      await asignarNota(
        await sembrarNota(a.id, 'pendiente', { borrada: true }),
        conRuta,
        fecha,
      );

      const res = await listaDelDia(cookieTijuana, { fecha }).expect(200);
      const cuerpo = res.body as ListaDelDia;
      expect(cuerpo.fecha).toBe(fecha);
      expect(cuerpo.editable).toBe(true);
      const nuestros = cuerpo.renglones.filter((r) =>
        [conRuta, sinRuta, inactivo].includes(r.vendedorId),
      );
      expect(nuestros).toEqual([
        {
          vendedorId: conRuta,
          vendedor: `AAA con ruta ${SUFIJO}`,
          sucursalCodigo: 'TJ',
          rutaNombre: semanal.nombre,
          clientes: 2,
          notasPendientes: 2,
          notasAsignadas: 1,
          vehiculo: vehiculo.nombre,
          tieneRuta: true,
        },
        {
          vendedorId: sinRuta,
          vendedor: `AAB sin ruta ${SUFIJO}`,
          sucursalCodigo: 'TJ',
          rutaNombre: null,
          clientes: 0,
          notasPendientes: 0,
          notasAsignadas: 0,
          vehiculo: null,
          tieneRuta: false,
        },
      ]);
      expect(cuerpo.renglones.every((r) => r.sucursalCodigo === 'TJ')).toBe(
        true,
      );
    });

    it('sin sucursal el General tiene que elegir; uno atado no ve otra', async () => {
      const fecha = diaNuevo();
      const res = await listaDelDia(cookieGeneral, { fecha }).expect(400);
      expect(mensaje(res)).toBe('Elige una sucursal.');
      await listaDelDia(cookieTijuana, { fecha, sucursal: 'MX' }).expect(403);
      await listaDelDia(cookieGeneral, {
        fecha: '2099-02-30',
        sucursal: 'TJ',
      }).expect(400);
    });
  });

  describe('con SOLO ruta_diaria.gestionar (sin ruta_semanal.gestionar)', () => {
    it('lee el dia y las opciones con los clientes de cada ruta, guarda la ruta con su semanal y asigna una nota', async () => {
      const fecha = diaNuevo();
      const a = await sembrarCliente(tjId);
      const deBaja = await sembrarCliente(tjId);
      const b = await sembrarCliente(tjId);
      const semanal = await crearSemanal(fecha, [a.id, deBaja.id, b.id]);
      await db
        .updateTable('cliente')
        .set({ deleted_at: new Date() })
        .where('id', '=', deBaja.id)
        .execute();
      const vendedor = await sembrarVendedor(tjId);

      // La Ruta Semanal no es suya: por eso las opciones traen los clientes.
      await request(app.getHttpServer())
        .get(`/rutas/semanales/${semanal.id}`)
        .set('Cookie', cookieSoloDiaria)
        .expect(403);

      const dia = (
        await listaDelDia(cookieSoloDiaria, { fecha, sucursal: 'TJ' }).expect(
          200,
        )
      ).body as ListaDelDia;
      expect(dia.renglones.map((r) => r.vendedorId)).toContain(vendedor);

      const ops = (
        await opciones(cookieSoloDiaria, vendedor, fecha).expect(200)
      ).body as OpcionesDia;
      expect(ops.rutas.find((r) => r.id === semanal.id)).toEqual({
        id: semanal.id,
        nombre: semanal.nombre,
        ocupadaPor: null,
        clientes: [
          { clienteId: a.id, nombre: a.nombre, valido: true },
          { clienteId: deBaja.id, nombre: deBaja.nombre, valido: false },
          { clienteId: b.id, nombre: b.nombre, valido: true },
        ],
      });

      const ruta = (
        await guardar(cookieSoloDiaria, {
          vendedorId: vendedor,
          fecha,
          rutaSemanalId: semanal.id,
          clientes: [a.id, b.id],
        }).expect(200)
      ).body as RutaDiaria;
      expect(ruta.rutaSemanal).toEqual({
        id: semanal.id,
        nombre: semanal.nombre,
      });
      expect(ruta.filas.map((f) => [f.clienteId, f.origen])).toEqual([
        [a.id, 'semanal'],
        [b.id, 'semanal'],
      ]);

      const nota = await sembrarNota(a.id);
      await request(app.getHttpServer())
        .put(`/rutas/diaria/notas/${nota}`)
        .set('Cookie', cookieSoloDiaria)
        .send({ vendedorId: vendedor, fecha })
        .expect(200);
      const asignada = await db
        .selectFrom('nota_asignada')
        .select(['vendedor_id', 'deleted_at'])
        .where('venta_nota_id', '=', nota)
        .executeTakeFirstOrThrow();
      expect(asignada).toEqual({ vendedor_id: vendedor, deleted_at: null });
    });
  });
});

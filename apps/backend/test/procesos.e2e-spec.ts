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
  Proceso,
  ProcesosDelDia,
} from './../src/modules/inventario/procesos.service';

/**
 * Operacion -> Procesos (PR A), de punta a punta: los cinco tipos con alta,
 * lista, edicion y baja; el permiso del tipo; cliente y vendedor de otra
 * sucursal o dados de baja (400); el cuadre de merma de cliente en el servidor;
 * fecha futura, `todas` y otra sucursal.
 *
 * Sucursales (ZT, ZU), usuarios, clientes, vendedores y presentaciones son de
 * esta corrida; todo se limpia por id al final.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const K = 'ZT';
const L = 'ZU';
const PRODUCTO = `ZZ-proc-${SUFIJO}`;

const TIPOS = ['merma', 'cambio', 'consumo', 'promocion', 'descuento'] as const;
type Tipo = (typeof TIPOS)[number];

function restarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - dias)).toISOString().slice(0, 10);
}

describe('Procesos (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let hoy: string;
  let ayer: string;
  let manana: string;
  const usuarioIds: string[] = [];
  const productoIds: string[] = [];
  const sucursalIds: string[] = [];
  const clienteIds: string[] = [];
  const vendedorIds: string[] = [];
  let kId: string;
  let litro: string;
  let medio: string;
  let galon: string;
  let cliente: string;
  let cliente2: string;
  let prospecto: string;
  let clienteOtra: string;
  let clienteBaja: string;
  let vendedor: string;
  let vendedor2: string;
  let vendedorInactivo: string;
  let vendedorOtra: string;
  let vendedorBaja: string;

  let cookieGeneral: string;
  let cookieK: string; // atado a ZT con los cinco permisos
  let cookieKConsumo: string; // atado a ZT solo con proceso.consumo
  let cookieL: string; // atado a ZU con los cinco permisos

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

  const crearCliente = async (
    sucursalId: string,
    opciones: { tipo?: 'cliente' | 'prospecto'; baja?: boolean } = {},
  ): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const tipo = opciones.tipo ?? 'cliente';
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `Cliente proc ${clienteIds.length + 1} ${SUFIJO}`,
        domicilio: 'Calle 1',
        telefono: '6640000000',
        tipo,
        lista_precio_id: tipo === 'cliente' ? lista.id : null,
        sucursal_id: sucursalId,
        deleted_at: opciones.baja ? sql<Date>`now()` : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return id;
  };

  const crearVendedor = async (
    sucursalId: string,
    opciones: { activo?: boolean; baja?: boolean } = {},
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-proc-v${vendedorIds.length + 1}-${SUFIJO}`,
        nombre: `Vendedor proc ${vendedorIds.length + 1} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
        activo: opciones.activo ?? true,
        deleted_at: opciones.baja ? sql<Date>`now()` : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  /** El cuerpo minimo valido de cada tipo; `extra` lo pisa. */
  const cuerpo = (
    tipo: Tipo,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      tipo,
      sucursal: K,
      fecha: hoy,
      clienteId: null,
      vendedorId: null,
      mermaDe: null,
      comentario: null,
      lineas: [
        { presentacionId: litro, sentido: 'entregado', piezas: 4 },
        { presentacionId: medio, sentido: 'entregado', piezas: 1 },
      ],
    };
    if (tipo === 'merma' || tipo === 'cambio') {
      base.clienteId = cliente;
      base.lineas = [
        { presentacionId: litro, sentido: 'recibido', piezas: 5 },
        { presentacionId: medio, sentido: 'entregado', piezas: 5 },
      ];
      if (tipo === 'merma') base.mermaDe = 'cliente';
    }
    if (tipo === 'promocion') base.clienteId = cliente;
    if (tipo === 'descuento') base.vendedorId = vendedor;
    return { ...base, ...extra };
  };

  const crear = async (
    tipo: Tipo,
    extra: Record<string, unknown> = {},
    cookie = cookieK,
  ): Promise<Proceso> =>
    (
      await http()
        .post('/procesos')
        .set('Cookie', cookie)
        .send(cuerpo(tipo, extra))
        .expect(201)
    ).body as Proceso;

  const mensajes = (cuerpoRespuesta: unknown): string => {
    const m = (cuerpoRespuesta as { message: string | string[] }).message;
    return Array.isArray(m) ? m.join(' | ') : m;
  };

  const contarProcesos = async (): Promise<number> =>
    (
      await db
        .selectFrom('proceso_oficina')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('sucursal_id', '=', kId)
        .executeTakeFirstOrThrow()
    ).n;

  /** POST que debe dar 400 con ese texto y no guardar nada. */
  const rechaza = async (
    tipo: Tipo,
    extra: Record<string, unknown>,
    texto: string,
  ): Promise<void> => {
    const antes = await contarProcesos();
    const res = await http()
      .post('/procesos')
      .set('Cookie', cookieK)
      .send(cuerpo(tipo, extra))
      .expect(400);
    expect(mensajes(res.body)).toContain(texto);
    expect(await contarProcesos()).toBe(antes);
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
    manana = restarDias(hoy, -1);

    kId = await crearSucursal(K);
    const lId = await crearSucursal(L);
    litro = await crearPresentacion('1 L');
    medio = await crearPresentacion('500 ml');
    galon = await crearPresentacion('1 gal');
    cliente = await crearCliente(kId);
    cliente2 = await crearCliente(kId);
    prospecto = await crearCliente(kId, { tipo: 'prospecto' });
    clienteOtra = await crearCliente(lId);
    clienteBaja = await crearCliente(kId, { baja: true });
    vendedor = await crearVendedor(kId);
    vendedor2 = await crearVendedor(kId);
    vendedorInactivo = await crearVendedor(kId, { activo: false });
    vendedorOtra = await crearVendedor(lId);
    vendedorBaja = await crearVendedor(kId, { baja: true });

    await crearUsuario(`e2e-proc-gen-${SUFIJO}`, 'Administrador General', null);
    await crearUsuario(
      `e2e-proc-k-${SUFIJO}`,
      'Auxiliar Administrativo',
      kId,
      TIPOS.map((t) => `proceso.${t}`),
    );
    await crearUsuario(
      `e2e-proc-kc-${SUFIJO}`,
      'Auxiliar Administrativo',
      kId,
      ['proceso.consumo'],
    );
    await crearUsuario(
      `e2e-proc-l-${SUFIJO}`,
      'Auxiliar Administrativo',
      lId,
      TIPOS.map((t) => `proceso.${t}`),
    );

    cookieGeneral = await iniciarSesion(`e2e-proc-gen-${SUFIJO}`);
    cookieK = await iniciarSesion(`e2e-proc-k-${SUFIJO}`);
    cookieKConsumo = await iniciarSesion(`e2e-proc-kc-${SUFIJO}`);
    cookieL = await iniciarSesion(`e2e-proc-l-${SUFIJO}`);
  });

  afterAll(async () => {
    const procesos = db
      .selectFrom('proceso_oficina')
      .select('id')
      .where('sucursal_id', 'in', sucursalIds);
    await db
      .deleteFrom('proceso_oficina_linea')
      .where('proceso_id', 'in', procesos)
      .execute();
    await db
      .deleteFrom('proceso_oficina')
      .where('sucursal_id', 'in', sucursalIds)
      .execute();
    if (clienteIds.length > 0)
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    if (vendedorIds.length > 0)
      await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
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

  describe('los cinco tipos: alta, lista, edicion y baja', () => {
    for (const tipo of TIPOS) {
      it(`${tipo}: se captura, se lista, se corrige y se da de baja`, async () => {
        const creado = await crear(tipo, { comentario: '  Primero \n' });
        expect(creado).toMatchObject({
          tipo,
          fecha: hoy,
          comentario: 'Primero',
          capturo: `e2e-proc-k-${SUFIJO}`,
        });
        expect(creado.hora).toMatch(/^\d{2}:\d{2}$/);
        expect(creado.actualizadoEn).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/,
        );
        expect(creado.lineas.length).toBe(2);
        expect(creado.lineas[0].nombre).toContain(PRODUCTO);
        if (tipo === 'merma') expect(creado.mermaDe).toBe('cliente');
        else expect(creado.mermaDe).toBeNull();
        if (tipo === 'descuento')
          expect(creado.vendedor).toMatchObject({ id: vendedor });
        else expect(creado.vendedor).toBeNull();
        if (tipo === 'consumo' || tipo === 'descuento')
          expect(creado.cliente).toBeNull();
        else
          expect(creado.cliente).toMatchObject({
            id: cliente,
            nombre: expect.stringContaining('Cliente proc') as string,
          });

        const lista = (
          await http()
            .get('/procesos')
            .query({ sucursal: K, fecha: hoy, tipo })
            .set('Cookie', cookieK)
            .expect(200)
        ).body as ProcesosDelDia;
        expect(lista).toMatchObject({ fecha: hoy, hoy });
        expect(lista.procesos.map((p) => p.id)).toContain(creado.id);

        // Corregir: fecha, vendedor, comentario y lineas (se reemplazan).
        const cambios: Record<string, unknown> = {
          fecha: ayer,
          comentario: '',
          vendedorId: tipo === 'descuento' ? vendedor2 : vendedor,
          clienteId:
            tipo === 'consumo' || tipo === 'descuento' ? null : cliente2,
          mermaDe: tipo === 'merma' ? 'cliente' : null,
          lineas:
            tipo === 'merma' || tipo === 'cambio'
              ? [
                  { presentacionId: galon, sentido: 'recibido', piezas: 2 },
                  { presentacionId: litro, sentido: 'entregado', piezas: 2 },
                ]
              : [{ presentacionId: galon, sentido: 'entregado', piezas: 2 }],
          // Lo que no se puede cambiar se ignora.
          tipo: 'consumo',
          sucursal: L,
        };
        const editado = (
          await http()
            .patch(`/procesos/${creado.id}`)
            .set('Cookie', cookieK)
            .send(cambios)
            .expect(200)
        ).body as Proceso;
        expect(editado).toMatchObject({
          id: creado.id,
          tipo,
          fecha: ayer,
          comentario: null,
          vendedor: { id: tipo === 'descuento' ? vendedor2 : vendedor },
        });
        if (tipo !== 'consumo' && tipo !== 'descuento')
          expect(editado.cliente?.id).toBe(cliente2);
        expect(editado.lineas.map((l) => l.presentacionId)).toContain(galon);
        expect(editado.lineas.map((l) => l.presentacionId)).not.toContain(
          medio,
        );
        expect(editado.actualizadoEn).not.toBe(creado.actualizadoEn);
        const fila = await db
          .selectFrom('proceso_oficina')
          .select(['actualizado_por_usuario_id', 'sucursal_id'])
          .where('id', '=', creado.id)
          .executeTakeFirstOrThrow();
        expect(fila.actualizado_por_usuario_id).not.toBeNull();
        expect(fila.sucursal_id).toBe(kId);

        await http()
          .delete(`/procesos/${creado.id}`)
          .set('Cookie', cookieK)
          .expect(204);
        const despues = (
          await http()
            .get('/procesos')
            .query({ sucursal: K, fecha: ayer, tipo })
            .set('Cookie', cookieK)
            .expect(200)
        ).body as ProcesosDelDia;
        expect(despues.procesos.map((p) => p.id)).not.toContain(creado.id);
        // Editar o borrar uno dado de baja = 404.
        await http()
          .delete(`/procesos/${creado.id}`)
          .set('Cookie', cookieK)
          .expect(404);
        await http()
          .patch(`/procesos/${creado.id}`)
          .set('Cookie', cookieK)
          .send(cambios)
          .expect(404);
      });
    }

    it('merma de almacen: sin cliente, solo recibido', async () => {
      const p = await crear('merma', {
        mermaDe: 'almacen',
        clienteId: null,
        lineas: [{ presentacionId: litro, sentido: 'recibido', piezas: 3 }],
      });
      expect(p).toMatchObject({ mermaDe: 'almacen', cliente: null });
    });
  });

  describe('lista', () => {
    it('con `cliente` filtra; sin el, todo el tipo; merma trae cliente y almacen; orden por hora', async () => {
      const fecha = restarDias(hoy, 3);
      const a = await crear('merma', { fecha });
      const b = await crear('merma', { fecha, clienteId: cliente2 });
      const c = await crear('merma', {
        fecha,
        mermaDe: 'almacen',
        clienteId: null,
        lineas: [{ presentacionId: litro, sentido: 'recibido', piezas: 1 }],
      });
      const todos = (
        await http()
          .get('/procesos')
          .query({ sucursal: K, fecha, tipo: 'merma' })
          .set('Cookie', cookieK)
          .expect(200)
      ).body as ProcesosDelDia;
      expect(todos.procesos.map((p) => p.id)).toEqual([a.id, b.id, c.id]);
      const delCliente = (
        await http()
          .get('/procesos')
          .query({ sucursal: K, fecha, tipo: 'merma', cliente: cliente2 })
          .set('Cookie', cookieK)
          .expect(200)
      ).body as ProcesosDelDia;
      expect(delCliente.procesos.map((p) => p.id)).toEqual([b.id]);
      // Otro tipo no se mezcla.
      const cambios = (
        await http()
          .get('/procesos')
          .query({ sucursal: K, fecha, tipo: 'cambio' })
          .set('Cookie', cookieK)
          .expect(200)
      ).body as ProcesosDelDia;
      expect(cambios.procesos).toEqual([]);
    });
  });

  describe('permisos y alcance', () => {
    it('sin el permiso del tipo = 403 al listar, crear, editar y borrar', async () => {
      await http()
        .get('/procesos')
        .query({ sucursal: K, fecha: hoy, tipo: 'merma' })
        .set('Cookie', cookieKConsumo)
        .expect(403);
      await http()
        .get('/procesos')
        .query({ sucursal: K, fecha: hoy, tipo: 'consumo' })
        .set('Cookie', cookieKConsumo)
        .expect(200);
      await http()
        .post('/procesos')
        .set('Cookie', cookieKConsumo)
        .send(cuerpo('promocion'))
        .expect(403);
      const p = await crear('promocion');
      await http()
        .patch(`/procesos/${p.id}`)
        .set('Cookie', cookieKConsumo)
        .send(cuerpo('promocion'))
        .expect(403);
      await http()
        .delete(`/procesos/${p.id}`)
        .set('Cookie', cookieKConsumo)
        .expect(403);
      await crear('consumo', {}, cookieKConsumo);
    });

    it('General con `todas` = 400 "Elige una sucursal."; con una, entra', async () => {
      const res = await http()
        .get('/procesos')
        .query({ sucursal: 'todas', fecha: hoy, tipo: 'consumo' })
        .set('Cookie', cookieGeneral)
        .expect(400);
      expect(mensajes(res.body)).toContain('Elige una sucursal.');
      await http()
        .post('/procesos')
        .set('Cookie', cookieGeneral)
        .send(cuerpo('consumo', { sucursal: 'todas' }))
        .expect(400);
      await crear('consumo', {}, cookieGeneral);
    });

    it('atado a otra sucursal: 403 al listar y crear; 404 al editar y borrar', async () => {
      await http()
        .get('/procesos')
        .query({ sucursal: K, fecha: hoy, tipo: 'consumo' })
        .set('Cookie', cookieL)
        .expect(403);
      await http()
        .post('/procesos')
        .set('Cookie', cookieL)
        .send(cuerpo('consumo'))
        .expect(403);
      const p = await crear('consumo');
      await http()
        .patch(`/procesos/${p.id}`)
        .set('Cookie', cookieL)
        .send(cuerpo('consumo'))
        .expect(404);
      await http()
        .delete(`/procesos/${p.id}`)
        .set('Cookie', cookieL)
        .expect(404);
    });

    it('un id que no existe = 404', async () => {
      await http()
        .delete('/procesos/3f2504e0-4f89-41d3-9a0c-0305e82c3301')
        .set('Cookie', cookieK)
        .expect(404);
    });
  });

  describe('validaciones', () => {
    it('fecha futura = 400 (al crear, editar y listar)', async () => {
      await rechaza(
        'consumo',
        { fecha: manana },
        'La fecha no puede ser posterior a hoy.',
      );
      const p = await crear('consumo');
      await http()
        .patch(`/procesos/${p.id}`)
        .set('Cookie', cookieK)
        .send(cuerpo('consumo', { fecha: manana }))
        .expect(400);
      await http()
        .get('/procesos')
        .query({ sucursal: K, fecha: manana, tipo: 'consumo' })
        .set('Cookie', cookieK)
        .expect(400);
    });

    it('descuento sin vendedor = 400', async () => {
      await rechaza(
        'descuento',
        { vendedorId: null },
        'Un descuento tiene que ser de un vendedor.',
      );
    });

    it('merma de cliente que no cuadra (5 recibidas, 3 entregadas) = 400', async () => {
      await rechaza(
        'merma',
        {
          lineas: [
            { presentacionId: litro, sentido: 'recibido', piezas: 5 },
            { presentacionId: medio, sentido: 'entregado', piezas: 3 },
          ],
        },
        'Lo entregado (3) no cuadra con lo recibido (5).',
      );
      const p = await crear('cambio');
      const res = await http()
        .patch(`/procesos/${p.id}`)
        .set('Cookie', cookieK)
        .send(
          cuerpo('cambio', {
            lineas: [
              { presentacionId: litro, sentido: 'recibido', piezas: 5 },
              { presentacionId: medio, sentido: 'entregado', piezas: 3 },
            ],
          }),
        )
        .expect(400);
      expect(mensajes(res.body)).toContain(
        'Lo entregado (3) no cuadra con lo recibido (5).',
      );
    });

    it('cliente de otra sucursal o dado de baja = 400; un prospecto si entra', async () => {
      await rechaza(
        'promocion',
        { clienteId: clienteOtra },
        'El cliente no existe o no es de esta sucursal.',
      );
      await rechaza(
        'promocion',
        { clienteId: clienteBaja },
        'El cliente no existe o no es de esta sucursal.',
      );
      const p = await crear('promocion', { clienteId: prospecto });
      expect(p.cliente?.id).toBe(prospecto);
      // Tampoco al editar.
      await http()
        .patch(`/procesos/${p.id}`)
        .set('Cookie', cookieK)
        .send(cuerpo('promocion', { clienteId: clienteOtra }))
        .expect(400);
    });

    it('vendedor de otra sucursal o dado de baja = 400; uno inactivo si entra', async () => {
      await rechaza(
        'descuento',
        { vendedorId: vendedorOtra },
        'El vendedor no existe o no es de esta sucursal.',
      );
      await rechaza(
        'consumo',
        { vendedorId: vendedorBaja },
        'El vendedor no existe o no es de esta sucursal.',
      );
      const p = await crear('descuento', { vendedorId: vendedorInactivo });
      expect(p.vendedor?.id).toBe(vendedorInactivo);
      await http()
        .patch(`/procesos/${p.id}`)
        .set('Cookie', cookieK)
        .send(cuerpo('descuento', { vendedorId: vendedorOtra }))
        .expect(400);
    });

    it('sentidos y topes', async () => {
      await rechaza(
        'consumo',
        {
          lineas: [{ presentacionId: litro, sentido: 'recibido', piezas: 1 }],
        },
        'Un consumo solo lleva piezas entregadas.',
      );
      await rechaza(
        'merma',
        { mermaDe: null },
        'Elige si la merma es de un cliente o del almacén.',
      );
      await rechaza('cambio', { clienteId: null }, 'Elige un cliente.');
      await rechaza(
        'consumo',
        { comentario: 'x'.repeat(301) },
        'El comentario no puede pasar de 300 caracteres.',
      );
      await rechaza(
        'consumo',
        {
          lineas: [{ presentacionId: litro, sentido: 'entregado', piezas: 0 }],
        },
        'Las piezas deben ser un número entero entre 1 y 100000.',
      );
      await http()
        .post('/procesos')
        .set('Cookie', cookieK)
        .send(cuerpo('consumo', { tipo: 'robo' }))
        .expect(400);
    });

    it('presentacion: nueva tiene que estar viva y activa; al editar se conserva la que ya estaba', async () => {
      const inactiva = await crearPresentacion('2 L');
      const p = await crear('consumo', {
        lineas: [{ presentacionId: inactiva, sentido: 'entregado', piezas: 2 }],
      });
      // El producto se desactiva despues de capturar.
      const otroProducto = (
        await db
          .insertInto('producto')
          .values({ nombre: `${PRODUCTO}-inactivo`, activo: false })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      productoIds.push(otroProducto);
      await db
        .updateTable('presentacion')
        .set({ producto_id: otroProducto })
        .where('id', '=', inactiva)
        .execute();

      await rechaza(
        'consumo',
        {
          lineas: [
            { presentacionId: inactiva, sentido: 'entregado', piezas: 1 },
          ],
        },
        'Una de las presentaciones no existe.',
      );
      // La que ya estaba se conserva al editar.
      const editado = (
        await http()
          .patch(`/procesos/${p.id}`)
          .set('Cookie', cookieK)
          .send(
            cuerpo('consumo', {
              lineas: [
                { presentacionId: inactiva, sentido: 'entregado', piezas: 3 },
              ],
            }),
          )
          .expect(200)
      ).body as Proceso;
      expect(editado.lineas).toEqual([
        expect.objectContaining({ presentacionId: inactiva, piezas: 3 }),
      ]);

      const baja = await crearPresentacion('baja');
      await db
        .updateTable('presentacion')
        .set({ deleted_at: sql<Date>`now()` })
        .where('id', '=', baja)
        .execute();
      await rechaza(
        'consumo',
        {
          lineas: [{ presentacionId: baja, sentido: 'entregado', piezas: 1 }],
        },
        'Una de las presentaciones no existe.',
      );
    });
  });
});

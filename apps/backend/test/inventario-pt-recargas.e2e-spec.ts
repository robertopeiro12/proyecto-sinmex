import { randomUUID } from 'node:crypto';
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
import type { InventarioPt } from './../src/modules/produccion/inventario-pt.service';
import type {
  DetallePtRecargas,
  InventarioPtRecargas,
} from './../src/modules/produccion/inventario-pt-recargas.service';

/**
 * Inventario de PT con Recargas: cada columna con su fuente (D2, con los
 * cambios del tío del 2026-11-25: solo recargas ACEPTADAS; sin merma, consumo
 * ni descuentos), la carga de otra sucursal y la de ayer no cuentan,
 * presentaciones dadas de baja con movimiento hoy, "a quién" de recargas,
 * permisos y alcance.
 *
 * Sucursales YE y YF, todo de esta corrida y limpiado por id al final.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const K = 'YE';
const L = 'YF';
const PRODUCTO = `ZZ-ptr-${SUFIJO}`;

function restarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - dias)).toISOString().slice(0, 10);
}

describe('Inventario de PT con Recargas (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let hoy: string;
  let ayer: string;
  const usuarioIds: string[] = [];
  const productoIds: string[] = [];
  const sucursalIds: string[] = [];
  const vendedorIds: string[] = [];
  const clienteIds: string[] = [];
  let generalId: string;
  let kId: string;
  let lId: string;
  let producto: string;
  let litro: string;
  let medio: string;
  let enviada: string;
  let vieja: string;
  let muerta: string;
  let conAjuste: string;
  let vendedorA: string;
  let vendedorBaja: string;
  let vendedorL: string;
  let motivoMerma: string;
  let cliente: string;

  let cookieGeneral: string;
  let cookieKVer: string; // atado a YE, solo inventario_pt_recargas.ver
  let cookieKSin: string; // atado a YE, sin permisos

  const nombreA = `Vendedor ptr A ${SUFIJO}`;
  const nombreBaja = `Vendedor ptr Baja ${SUFIJO}`;
  const nombreL = `Vendedor ptr L ${SUFIJO}`;
  const JUAN = `Juan ptr ${SUFIJO}`;
  const PEDRO = `Pedro ptr ${SUFIJO}`;

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

  const crearVendedor = async (
    nombre: string,
    sucursalId: string,
    baja = false,
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-ptr-v${vendedorIds.length + 1}-${SUFIJO}`,
        nombre,
        password_hash: 'x',
        sucursal_id: sucursalId,
        activo: !baja,
        deleted_at: baja ? sql<Date>`now()` : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  const crearCliente = async (sucursalId: string): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `Cliente ptr ${SUFIJO}`,
        domicilio: 'Calle 1',
        telefono: '6640000000',
        tipo: 'cliente',
        lista_precio_id: lista.id,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return id;
  };

  /** Una carga escrita directo en la tabla (el servicio solo captura hoy). */
  const crearCarga = async (o: {
    vendedorId: string;
    sucursalId?: string;
    fecha?: string;
    numero: number;
    estado: 'pendiente' | 'aceptada' | 'rechazada';
    borrada?: boolean;
    lineas: {
      presentacionId: string;
      piezas: number;
      aceptada?: boolean | null;
    }[];
  }): Promise<void> => {
    const { id } = await db
      .insertInto('carga')
      .values({
        vendedor_id: o.vendedorId,
        sucursal_id: o.sucursalId ?? kId,
        fecha: sql<Date>`${o.fecha ?? hoy}::date`,
        numero: o.numero,
        estado: o.estado,
        motivo_rechazo: o.estado === 'rechazada' ? 'No coincide' : null,
        respondida_en: o.estado === 'pendiente' ? null : sql<Date>`now()`,
        capturo_usuario_id: generalId,
        deleted_at: o.borrada ? sql<Date>`now()` : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('carga_detalle')
      .values(
        o.lineas.map((l) => ({
          carga_id: id,
          presentacion_id: l.presentacionId,
          piezas: l.piezas,
          aceptada: l.aceptada ?? null,
        })),
      )
      .execute();
  };

  /** Una operacion del Registro, directo a la base (los checks la validan). */
  const crearOperacion = async (o: {
    tipo: string;
    fecha?: string;
    sucursalId?: string;
    lineas: { presentacionId: string; piezas: number }[];
    destinoId?: string;
    trabajador?: string;
    estado?: 'pendiente' | 'autorizado';
    borrada?: boolean;
  }): Promise<void> => {
    const resuelto = o.estado === 'autorizado';
    const { id } = await db
      .insertInto('operacion_almacen')
      .values({
        sucursal_id: o.sucursalId ?? kId,
        tipo: o.tipo,
        fecha: sql<Date>`${o.fecha ?? hoy}::date`,
        origen: o.tipo === 'entrada' ? 'produccion' : null,
        sucursal_destino_id: o.tipo === 'envio' ? (o.destinoId ?? lId) : null,
        motivo_merma_id: o.tipo === 'merma' ? motivoMerma : null,
        trabajador: o.tipo === 'descuento' ? (o.trabajador ?? JUAN) : null,
        estado: o.tipo === 'retiro_merma' ? (o.estado ?? 'pendiente') : null,
        resuelto_por_usuario_id: resuelto ? generalId : null,
        resuelto_en: resuelto ? sql<Date>`now()` : null,
        capturo_usuario_id: generalId,
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

  /** Un proceso de Oficina, directo a la base. */
  const crearProceso = async (p: {
    tipo: 'merma' | 'consumo' | 'descuento';
    vendedorId: string | null;
    mermaDe?: 'almacen';
    sentido: 'recibido' | 'entregado';
    piezas: number;
  }): Promise<void> => {
    const { id } = await db
      .insertInto('proceso_oficina')
      .values({
        tipo: p.tipo,
        sucursal_id: kId,
        fecha: sql<Date>`${hoy}::date`,
        cliente_id: null,
        vendedor_id: p.vendedorId,
        merma_de: p.mermaDe ?? null,
        capturo_usuario_id: generalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('proceso_oficina_linea')
      .values({
        proceso_id: id,
        presentacion_id: litro,
        sentido: p.sentido,
        piezas: p.piezas,
      })
      .execute();
  };

  /** Un movimiento de la tablet, directo a la base. */
  const crearMovimiento = async (
    tipo: 'merma_trayecto' | 'consumo',
    piezas: number,
  ): Promise<void> => {
    const id = randomUUID();
    await db
      .insertInto('movimiento_inventario')
      .values({
        id,
        sucursal_id: kId,
        vendedor_id: vendedorA,
        cliente_id: null,
        tipo,
        fecha: sql<Date>`${hoy}::date`,
        registrado_en: sql<Date>`now()`,
      })
      .execute();
    await db
      .insertInto('movimiento_inventario_linea')
      .values({
        movimiento_id: id,
        presentacion_id: litro,
        sentido: 'entregado',
        piezas,
      })
      .execute();
  };

  let folios = 0;
  const crearVenta = async (
    fecha: string,
    presentacionId: string,
    cantidad: number,
  ): Promise<void> => {
    const { id } = await db
      .insertInto('venta_nota')
      .values({
        folio: `ZPR${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha: sql<Date>`${fecha}::date`,
        cliente_id: cliente,
        vendedor_id: null,
        monto_total: '100',
        contado_credito: 'contado',
        semana: 10,
        mes: 3,
        status: 'pagada',
        sucursal_id: kId,
        origen: 'portal',
        capturo_usuario_id: generalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('venta_nota_detalle')
      .values({
        venta_nota_id: id,
        presentacion_id: presentacionId,
        cantidad,
        cantidad_promocion: 0,
        precio: '10',
      })
      .execute();
  };

  const ajuste = (
    sucursalId: string,
    presentacionId: string,
    fecha: string,
    inicial: number,
  ) =>
    db
      .insertInto('inventario_pt_ajuste')
      .values({
        sucursal_id: sucursalId,
        presentacion_id: presentacionId,
        fecha: sql<Date>`${fecha}::date`,
        inventario_inicial: inicial,
        merma_acumulada_inicial: 0,
        capturo_usuario_id: generalId,
      })
      .execute();

  const leer = async (
    q: Record<string, string>,
    cookie = cookieGeneral,
  ): Promise<InventarioPtRecargas> =>
    (
      await http()
        .get('/inventario-pt/recargas')
        .query(q)
        .set('Cookie', cookie)
        .expect(200)
    ).body as InventarioPtRecargas;

  const detalle = async (
    q: Record<string, string>,
    cookie = cookieGeneral,
  ): Promise<DetallePtRecargas> =>
    (
      await http()
        .get('/inventario-pt/recargas/detalle')
        .query(q)
        .set('Cookie', cookie)
        .expect(200)
    ).body as DetallePtRecargas;

  const renglon = (r: InventarioPtRecargas, presentacionId: string) =>
    r.renglones.find((x) => x.presentacionId === presentacionId);

  const leerPt = async (fecha: string, sucursal: string) =>
    (
      await http()
        .get('/inventario-pt')
        .query({ fecha, sucursal })
        .set('Cookie', cookieGeneral)
        .expect(200)
    ).body as InventarioPt;

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

    kId = await crearSucursal(K);
    lId = await crearSucursal(L);
    producto = await crearProducto(PRODUCTO);
    litro = await crearPresentacion(producto, '1 L');
    medio = await crearPresentacion(producto, '500 ml');
    enviada = await crearPresentacion(producto, '2 L');
    // Otro producto: dadas de baja (una con recarga hoy, otra sin nada).
    const otro = await crearProducto(`${PRODUCTO}-b`);
    vieja = await crearPresentacion(otro, '5 L', true);
    muerta = await crearPresentacion(otro, '4 L', true);
    conAjuste = await crearPresentacion(otro, '3 L', true);
    cliente = await crearCliente(kId);
    vendedorA = await crearVendedor(nombreA, kId);
    vendedorBaja = await crearVendedor(nombreBaja, kId, true);
    vendedorL = await crearVendedor(nombreL, lId);
    motivoMerma = (
      await db
        .selectFrom('motivo_merma')
        .select('id')
        .where('aplica_almacen', '=', true)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow()
    ).id;

    generalId = await crearUsuario(
      `e2e-ptr-gen-${SUFIJO}`,
      'Administrador General',
      null,
    );
    await crearUsuario(`e2e-ptr-kv-${SUFIJO}`, 'Auxiliar Administrativo', kId, [
      'inventario_pt_recargas.ver',
    ]);
    await crearUsuario(`e2e-ptr-ks-${SUFIJO}`, 'Auxiliar Administrativo', kId);
    cookieGeneral = await iniciarSesion(`e2e-ptr-gen-${SUFIJO}`);
    cookieKVer = await iniciarSesion(`e2e-ptr-kv-${SUFIJO}`);
    cookieKSin = await iniciarSesion(`e2e-ptr-ks-${SUFIJO}`);

    // --- AYER (solo para el Inicial de hoy, via PT con Ventas) ---
    // Litro YE: ajuste 500, venta 10, entrada 30 → Final de ayer 520.
    await ajuste(kId, litro, ayer, 500);
    // Dada de baja, con ajuste vivo ayer y sin movimiento hoy: sigue saliendo.
    await ajuste(kId, conAjuste, ayer, 40);
    await crearVenta(ayer, litro, 10);
    await crearOperacion({
      tipo: 'entrada',
      fecha: ayer,
      lineas: [{ presentacionId: litro, piezas: 30 }],
    });
    // Ni la carga ni el Registro de ayer son movimientos de hoy.
    await crearCarga({
      vendedorId: vendedorA,
      fecha: ayer,
      numero: 1,
      estado: 'aceptada',
      lineas: [{ presentacionId: litro, piezas: 33 }],
    });
    // Enviada: ajustada en las dos sucursales.
    await ajuste(kId, enviada, ayer, 100);
    await ajuste(lId, enviada, ayer, 20);

    // --- HOY ---
    // Medio YE: ajuste de hoy (RF 3).
    await ajuste(kId, medio, hoy, 300);

    // Recargas de litro en YE (tío 2026-11-25: solo lo aceptado): pendiente
    // 10 NO cuenta; aceptada con litro aceptado 20 y medio rechazado 7;
    // aceptada de antes (null) 5; rechazada 99 y eliminada 50 no cuentan;
    // vendedor dado de baja 2 sí.
    await crearCarga({
      vendedorId: vendedorA,
      numero: 1,
      estado: 'pendiente',
      lineas: [{ presentacionId: litro, piezas: 10 }],
    });
    await crearCarga({
      vendedorId: vendedorA,
      numero: 2,
      estado: 'aceptada',
      lineas: [
        { presentacionId: litro, piezas: 20, aceptada: true },
        { presentacionId: medio, piezas: 7, aceptada: false },
      ],
    });
    await crearCarga({
      vendedorId: vendedorA,
      numero: 3,
      estado: 'aceptada',
      lineas: [
        { presentacionId: litro, piezas: 5 },
        { presentacionId: enviada, piezas: 1 },
      ],
    });
    await crearCarga({
      vendedorId: vendedorA,
      numero: 4,
      estado: 'rechazada',
      lineas: [{ presentacionId: litro, piezas: 99 }],
    });
    await crearCarga({
      vendedorId: vendedorA,
      numero: 5,
      estado: 'pendiente',
      borrada: true,
      lineas: [{ presentacionId: litro, piezas: 50 }],
    });
    await crearCarga({
      vendedorId: vendedorBaja,
      numero: 1,
      estado: 'aceptada',
      lineas: [
        { presentacionId: litro, piezas: 2 },
        { presentacionId: vieja, piezas: 3 },
      ],
    });
    // Carga de YF: cuenta en YF, no en YE.
    await crearCarga({
      vendedorId: vendedorL,
      sucursalId: lId,
      numero: 1,
      estado: 'aceptada',
      lineas: [{ presentacionId: litro, piezas: 8 }],
    });

    // Registro de Operación de hoy, litro YE.
    await crearOperacion({
      tipo: 'entrada',
      lineas: [{ presentacionId: litro, piezas: 100 }],
    });
    await crearOperacion({
      tipo: 'entrada',
      borrada: true,
      lineas: [{ presentacionId: litro, piezas: 70 }],
    });
    await crearOperacion({
      tipo: 'envio',
      lineas: [
        { presentacionId: litro, piezas: 6 },
        { presentacionId: enviada, piezas: 6 },
      ],
    });
    await crearOperacion({
      tipo: 'merma',
      lineas: [{ presentacionId: litro, piezas: 2 }],
    });
    await crearOperacion({
      tipo: 'consumo',
      lineas: [{ presentacionId: litro, piezas: 3 }],
    });
    await crearOperacion({
      tipo: 'descuento',
      trabajador: JUAN,
      lineas: [{ presentacionId: litro, piezas: 4 }],
    });
    await crearOperacion({
      tipo: 'descuento',
      trabajador: PEDRO,
      lineas: [
        { presentacionId: litro, piezas: 1 },
        { presentacionId: medio, piezas: 2 },
      ],
    });
    await crearOperacion({
      tipo: 'retiro_merma',
      estado: 'autorizado',
      lineas: [{ presentacionId: litro, piezas: 1 }],
    });

    // Merma, consumo y descuentos (Registro, app y Procesos) NO entran aquí
    // (sí en PT con Ventas).
    await crearMovimiento('consumo', 9);
    await crearMovimiento('merma_trayecto', 9);
    await crearProceso({
      tipo: 'consumo',
      vendedorId: vendedorA,
      sentido: 'entregado',
      piezas: 4,
    });
    await crearProceso({
      tipo: 'consumo',
      vendedorId: null,
      sentido: 'entregado',
      piezas: 4,
    });
    await crearProceso({
      tipo: 'merma',
      mermaDe: 'almacen',
      vendedorId: null,
      sentido: 'recibido',
      piezas: 5,
    });
    await crearProceso({
      tipo: 'merma',
      mermaDe: 'almacen',
      vendedorId: vendedorA,
      sentido: 'recibido',
      piezas: 5,
    });
    await crearProceso({
      tipo: 'descuento',
      vendedorId: vendedorA,
      sentido: 'entregado',
      piezas: 7,
    });
    await crearVenta(hoy, litro, 11);
  });

  afterAll(async () => {
    await db
      .deleteFrom('inventario_pt_ajuste')
      .where('sucursal_id', 'in', sucursalIds)
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
    const movs = db
      .selectFrom('movimiento_inventario')
      .select('id')
      .where('vendedor_id', 'in', vendedorIds);
    await db
      .deleteFrom('movimiento_inventario_linea')
      .where('movimiento_id', 'in', movs)
      .execute();
    await db
      .deleteFrom('movimiento_inventario')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    const notas = db
      .selectFrom('venta_nota')
      .select('id')
      .where('sucursal_id', 'in', sucursalIds);
    await db
      .deleteFrom('venta_nota_detalle')
      .where('venta_nota_id', 'in', notas)
      .execute();
    await db
      .deleteFrom('venta_nota')
      .where('sucursal_id', 'in', sucursalIds)
      .execute();
    await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
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

  // Litro de YE hoy: Inicial 520 (Final de ayer).
  const RECARGAS_LITRO_K = 20 + 5 + 2;
  const ACTUAL_LITRO_K = 520 - RECARGAS_LITRO_K - 6 + 100;

  describe('cada columna con su fuente (D2)', () => {
    it('hoy de Tijuana, con la hora de la consulta', async () => {
      const r = await leer({ sucursal: K });
      expect(r.fecha).toBe(hoy);
      expect(r.hoyEnTijuana).toBe(hoy);
      expect(r.consultadoEn).toMatch(/^\d{2}:\d{2}$/);
    });

    it('litro de YE: Actual = Inicial − Recargas − Envíos + Entradas', async () => {
      expect(renglon(await leer({ sucursal: K }), litro)).toEqual({
        presentacionId: litro,
        productoId: producto,
        producto: PRODUCTO,
        volumen: '1 L',
        inicial: 520,
        recargas: RECARGAS_LITRO_K,
        envios: 6,
        entradas: 100,
        actual: ACTUAL_LITRO_K,
      });
    });

    it('RF 1: renglón rechazado de una carga aceptada no cuenta', async () => {
      expect(renglon(await leer({ sucursal: K }), medio)).toMatchObject({
        recargas: 0,
      });
    });

    it('una recarga pendiente no resta hasta que el vendedor la acepta', async () => {
      const r = await detalle({ presentacion: litro, sucursal: K });
      expect(r.detalle.find((f) => f.quien === nombreA && f.carga === 1)).toBe(
        undefined,
      );
    });

    it('merma, consumo y descuentos no cambian esta pantalla, pero sí PT con Ventas', async () => {
      const pt = (await leerPt(hoy, K)).renglones.find(
        (x) => x.presentacionId === litro,
      );
      // PT con Ventas sí ve el consumo de la app y de Procesos, y su merma.
      expect(pt?.consumo).toBe(3 + 9 + 4 + 4);
      expect(pt?.merma).toBeGreaterThan(2);
      expect(pt?.descuentos).toBe(5 + 7);
      expect(pt?.ventas).toBe(11);
      const r = renglon(await leer({ sucursal: K }), litro);
      expect(r).not.toHaveProperty('merma');
      expect(r).not.toHaveProperty('consumo');
      expect(r).not.toHaveProperty('descuentos');
      expect(r?.actual).toBe(ACTUAL_LITRO_K);
    });

    it('RF 3: sin ajuste hoy, el Inicial = Final de ayer de PT con Ventas', async () => {
      const pt = (await leerPt(ayer, K)).renglones.find(
        (x) => x.presentacionId === litro,
      );
      expect(pt?.final).toBe(520);
      expect(renglon(await leer({ sucursal: K }), litro)?.inicial).toBe(
        pt?.final,
      );
    });

    it('RF 3: con ajuste hoy (capturado en PT con Ventas), el Inicial es el del ajuste, sin marca', async () => {
      const r = renglon(await leer({ sucursal: K }), medio);
      expect(r).toMatchObject({ inicial: 300, actual: 300 });
      expect(r).not.toHaveProperty('ajustado');
    });

    it('la carga de otra sucursal cuenta en la suya; YF sin inicial = vacío', async () => {
      expect(renglon(await leer({ sucursal: L }), litro)).toMatchObject({
        recargas: 8,
        entradas: 6,
        inicial: null,
        actual: null,
      });
    });

    it('RF 4: envío YE→YF resta en YE, suma en YF y con Todas se compensa', async () => {
      const k = renglon(await leer({ sucursal: K }), enviada);
      const l = renglon(await leer({ sucursal: L }), enviada);
      const t = renglon(await leer({ sucursal: 'todas' }), enviada);
      expect(k).toMatchObject({
        inicial: 100,
        recargas: 1,
        envios: 6,
        entradas: 0,
        actual: 93,
      });
      expect(l).toMatchObject({ inicial: 20, entradas: 6, actual: 26 });
      expect(t).toMatchObject({
        inicial: 120,
        recargas: 1,
        envios: 6,
        entradas: 6,
        actual: 119,
      });
    });

    it('Todas: movimientos sumados; sin inicial en una sucursal con movimiento → vacío', async () => {
      expect(renglon(await leer({ sucursal: 'todas' }), litro)).toMatchObject({
        recargas: RECARGAS_LITRO_K + 8,
        envios: 6,
        entradas: 106,
        inicial: null,
        actual: null,
      });
    });

    it('dada de baja: sale solo con movimiento hoy', async () => {
      const r = await leer({ sucursal: K });
      expect(renglon(r, vieja)).toMatchObject({
        recargas: 3,
        inicial: null,
        actual: null,
      });
      expect(renglon(r, muerta)).toBeUndefined();
    });

    it('M1: dada de baja con ajuste vivo y sin movimiento hoy sigue saliendo', async () => {
      const r = await leer({ sucursal: K });
      expect(renglon(r, conAjuste)).toMatchObject({
        recargas: 0,
        inicial: 40,
        actual: 40,
      });
      // Sin ajuste ni movimiento, no.
      expect(renglon(r, muerta)).toBeUndefined();
    });

    it('vivas aunque estén en 0 (sin movimiento hoy)', async () => {
      const r = await leer({ sucursal: L });
      expect(renglon(r, medio)).toMatchObject({
        recargas: 0,
        inicial: null,
        actual: null,
      });
    });

    it('por producto: suma sus presentaciones', async () => {
      const r = await leer({ sucursal: K, vista: 'producto' });
      const p = r.renglones.find((x) => x.productoId === producto);
      expect(p).toMatchObject({
        presentacionId: null,
        volumen: '',
        inicial: 520 + 300 + 100,
        recargas: RECARGAS_LITRO_K + 1,
        envios: 12,
        actual: ACTUAL_LITRO_K + 300 + 93,
      });
    });
  });

  describe('a quién (D5)', () => {
    it('recargas de litro en YE: vendedor, carga y piezas aceptadas', async () => {
      const r = await detalle({ presentacion: litro, sucursal: K });
      expect(r.detalle).toEqual([
        { quien: nombreA, carga: 2, piezas: 20 },
        { quien: nombreA, carga: 3, piezas: 5 },
        { quien: nombreBaja, carga: 1, piezas: 2 },
      ]);
    });

    it('renglón rechazado: sin filas', async () => {
      const r = await detalle({ presentacion: medio, sucursal: K });
      expect(r.detalle).toEqual([]);
    });

    it('por producto: suma las presentaciones de cada carga', async () => {
      const r = await detalle({ producto, sucursal: K });
      expect(r.detalle).toEqual([
        { quien: nombreA, carga: 2, piezas: 20 },
        { quien: nombreA, carga: 3, piezas: 6 },
        { quien: nombreBaja, carga: 1, piezas: 2 },
      ]);
    });

    it('Todas: también las de YF', async () => {
      const r = await detalle({ presentacion: litro, sucursal: 'todas' });
      expect(r.detalle).toContainEqual({ quien: nombreL, carga: 1, piezas: 8 });
      expect(r.detalle.reduce((t, f) => t + f.piezas, 0)).toBe(
        RECARGAS_LITRO_K + 8,
      );
    });

    it('validación: una presentación o un producto', async () => {
      const pedir = (q: Record<string, string>) =>
        http()
          .get('/inventario-pt/recargas/detalle')
          .query(q)
          .set('Cookie', cookieGeneral);
      await pedir({ sucursal: K }).expect(400);
      await pedir({ presentacion: litro, producto, sucursal: K }).expect(400);
      await pedir({ presentacion: randomUUID(), sucursal: K }).expect(404);
    });
  });

  describe('permisos y alcance (D6)', () => {
    it('RF 5: con solo inventario_pt_recargas.ver funciona la pantalla y sus detalles', async () => {
      const r = await leer({ sucursal: K }, cookieKVer);
      expect(renglon(r, litro)?.actual).toBe(ACTUAL_LITRO_K);
      await detalle({ presentacion: litro, sucursal: K }, cookieKVer);
      // Y no abre PT con Ventas.
      await http()
        .get('/inventario-pt')
        .query({ fecha: hoy, sucursal: K })
        .set('Cookie', cookieKVer)
        .expect(403);
    });

    it('sin inventario_pt_recargas.ver: 403', async () => {
      await http()
        .get('/inventario-pt/recargas')
        .query({ sucursal: K })
        .set('Cookie', cookieKSin)
        .expect(403);
      await http()
        .get('/inventario-pt/recargas/detalle')
        .query({ presentacion: litro, sucursal: K })
        .set('Cookie', cookieKSin)
        .expect(403);
    });

    it('atado a YE: otra sucursal 403; todas = la suya', async () => {
      await http()
        .get('/inventario-pt/recargas')
        .query({ sucursal: L })
        .set('Cookie', cookieKVer)
        .expect(403);
      await http()
        .get('/inventario-pt/recargas/detalle')
        .query({ presentacion: litro, sucursal: L })
        .set('Cookie', cookieKVer)
        .expect(403);
      const propia = await leer({ sucursal: 'todas' }, cookieKVer);
      expect(renglon(propia, litro)?.actual).toBe(ACTUAL_LITRO_K);
    });

    it('sucursal inexistente = 404, como PT con Ventas; vista inválida = 400', async () => {
      await http()
        .get('/inventario-pt/recargas')
        .query({ sucursal: 'QY' })
        .set('Cookie', cookieGeneral)
        .expect(404);
      await http()
        .get('/inventario-pt/recargas')
        .query({ sucursal: K, vista: 'otra' })
        .set('Cookie', cookieGeneral)
        .expect(400);
    });
  });
});

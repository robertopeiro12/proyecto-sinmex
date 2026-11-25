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
import type {
  AjustesPt,
  DescuentosPt,
  HistorialPt,
  InventarioPt,
} from './../src/modules/produccion/inventario-pt.service';
import type { RenglonPt } from './../src/modules/produccion/reglas-inventario-pt';

/**
 * Inventario de PT con Ventas (Tarea 2): cada columna con su fuente (D2), el
 * envio entre sucursales (Review Focus 1), la merma contada vs teorica de los
 * vendedores (RF 3), lo dado de baja no cuenta (RF 4), Todas, por producto,
 * historial, a quien (descuentos), ajustes y su efecto, permisos y alcance.
 *
 * Sucursales YC y YD, todo de esta corrida y limpiado por id al final.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const K = 'YC';
const L = 'YD';
const PRODUCTO = `ZZ-pt-${SUFIJO}`;
const TRABAJADOR = `Juan Pt ${SUFIJO}`;

function restarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - dias)).toISOString().slice(0, 10);
}

describe('Inventario de PT con Ventas (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let hoy: string;
  let ayer: string;
  let antier: string;
  const usuarioIds: string[] = [];
  const productoIds: string[] = [];
  const sucursalIds: string[] = [];
  const clienteIds: string[] = [];
  const vendedorIds: string[] = [];
  let generalId: string;
  let kId: string;
  let lId: string;
  let litro: string;
  let medio: string;
  let cliente: string;
  let vendedorA: string;
  let vendedorB: string;
  let nombreA: string;
  let motivoMerma: string;

  let cookieGeneral: string;
  let cookieKVer: string; // atado a YC, solo inventario_pt.ver
  let cookieKAjustar: string; // atado a YC, ver y ajustar
  let cookieKSin: string; // atado a YC, sin permisos

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
    if (productoIds.length === 0) {
      const { id } = await db
        .insertInto('producto')
        .values({ nombre: PRODUCTO, activo: true })
        .returning('id')
        .executeTakeFirstOrThrow();
      productoIds.push(id);
    }
    return (
      await db
        .insertInto('presentacion')
        .values({ producto_id: productoIds[0], volumen })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
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
        nombre: `Cliente pt ${clienteIds.length + 1} ${SUFIJO}`,
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

  const crearVendedor = async (sucursalId: string): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-pt-v${vendedorIds.length + 1}-${SUFIJO}`,
        nombre: `Vendedor pt ${vendedorIds.length + 1} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
        activo: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  let folios = 0;
  const crearVenta = async (opciones: {
    fecha: string;
    lineas: {
      presentacionId: string;
      cantidad: number;
      promo?: number;
      borrada?: boolean;
    }[];
    borrada?: boolean;
  }): Promise<string> => {
    const { id } = await db
      .insertInto('venta_nota')
      .values({
        folio: `ZPT${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha: sql<Date>`${opciones.fecha}::date`,
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
        deleted_at: opciones.borrada ? sql<Date>`now()` : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('venta_nota_detalle')
      .values(
        opciones.lineas.map((l) => ({
          venta_nota_id: id,
          presentacion_id: l.presentacionId,
          cantidad: l.cantidad,
          cantidad_promocion: l.promo ?? 0,
          precio: '10',
          deleted_at: l.borrada ? sql<Date>`now()` : null,
        })),
      )
      .execute();
    return id;
  };

  /** Una operacion del Registro, directo a la base (los checks la validan). */
  const crearOperacion = async (o: {
    tipo: string;
    fecha: string;
    sucursalId?: string;
    lineas: { presentacionId: string; piezas: number }[];
    destinoId?: string;
    trabajador?: string;
    estado?: 'pendiente' | 'autorizado';
    borrada?: boolean;
  }): Promise<string> => {
    const resuelto = o.estado === 'autorizado';
    const { id } = await db
      .insertInto('operacion_almacen')
      .values({
        sucursal_id: o.sucursalId ?? kId,
        tipo: o.tipo,
        fecha: sql<Date>`${o.fecha}::date`,
        origen: o.tipo === 'entrada' ? 'produccion' : null,
        sucursal_destino_id: o.tipo === 'envio' ? (o.destinoId ?? lId) : null,
        motivo_merma_id: o.tipo === 'merma' ? motivoMerma : null,
        trabajador:
          o.tipo === 'descuento' ? (o.trabajador ?? TRABAJADOR) : null,
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
    return id;
  };

  /** Un movimiento de la tablet, directo a la base. */
  const crearMovimiento = async (m: {
    tipo: 'merma_cliente' | 'merma_trayecto' | 'consumo';
    vendedorId: string;
    fecha: string;
    lineas: {
      presentacionId: string;
      sentido: 'recibido' | 'entregado';
      piezas: number;
    }[];
  }): Promise<void> => {
    const id = randomUUID();
    await db
      .insertInto('movimiento_inventario')
      .values({
        id,
        sucursal_id: kId,
        vendedor_id: m.vendedorId,
        cliente_id: m.tipo === 'merma_cliente' ? cliente : null,
        tipo: m.tipo,
        fecha: sql<Date>`${m.fecha}::date`,
        registrado_en: sql<Date>`now()`,
      })
      .execute();
    await db
      .insertInto('movimiento_inventario_linea')
      .values(
        m.lineas.map((l) => ({
          movimiento_id: id,
          presentacion_id: l.presentacionId,
          sentido: l.sentido,
          piezas: l.piezas,
        })),
      )
      .execute();
  };

  const crearProceso = async (
    cuerpo: Record<string, unknown>,
  ): Promise<{ id: string }> =>
    (
      await http()
        .post('/procesos')
        .set('Cookie', cookieGeneral)
        .send({
          sucursal: K,
          fecha: ayer,
          clienteId: null,
          vendedorId: null,
          mermaDe: null,
          comentario: null,
          ...cuerpo,
        })
        .expect(201)
    ).body as { id: string };

  const leer = async (
    q: Record<string, string>,
    cookie = cookieGeneral,
  ): Promise<InventarioPt> =>
    (
      await http()
        .get('/inventario-pt')
        .query(q)
        .set('Cookie', cookie)
        .expect(200)
    ).body as InventarioPt;

  const renglon = (r: InventarioPt, presentacionId: string) =>
    r.renglones.find((x) => x.presentacionId === presentacionId);

  const ajustar = (cuerpo: Record<string, unknown>, cookie = cookieGeneral) =>
    http().put('/inventario-pt/ajustes').set('Cookie', cookie).send(cuerpo);

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

    kId = await crearSucursal(K);
    lId = await crearSucursal(L);
    litro = await crearPresentacion('1 L');
    medio = await crearPresentacion('500 ml');
    cliente = await crearCliente(kId);
    vendedorA = await crearVendedor(kId);
    vendedorB = await crearVendedor(kId);
    nombreA = `Vendedor pt 1 ${SUFIJO}`;
    motivoMerma = (
      await db
        .selectFrom('motivo_merma')
        .select('id')
        .where('aplica_almacen', '=', true)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow()
    ).id;

    generalId = await crearUsuario(
      `e2e-pt-gen-${SUFIJO}`,
      'Administrador General',
      null,
    );
    await crearUsuario(`e2e-pt-kv-${SUFIJO}`, 'Auxiliar Administrativo', kId, [
      'inventario_pt.ver',
    ]);
    await crearUsuario(`e2e-pt-ka-${SUFIJO}`, 'Auxiliar Administrativo', kId, [
      'inventario_pt.ver',
      'inventario_pt.ajustar',
    ]);
    await crearUsuario(`e2e-pt-ks-${SUFIJO}`, 'Auxiliar Administrativo', kId);
    cookieGeneral = await iniciarSesion(`e2e-pt-gen-${SUFIJO}`);
    cookieKVer = await iniciarSesion(`e2e-pt-kv-${SUFIJO}`);
    cookieKAjustar = await iniciarSesion(`e2e-pt-ka-${SUFIJO}`);
    cookieKSin = await iniciarSesion(`e2e-pt-ks-${SUFIJO}`);

    // --- Movimientos de AYER en YC (litro salvo que se diga) ---
    // Ventas (mostrador): 5 vendidas + 1 de promo. Lo borrado no cuenta.
    await crearVenta({
      fecha: ayer,
      lineas: [
        { presentacionId: litro, cantidad: 5, promo: 1 },
        { presentacionId: medio, cantidad: 40, borrada: true },
      ],
    });
    await crearVenta({
      fecha: ayer,
      lineas: [{ presentacionId: litro, cantidad: 50 }],
      borrada: true,
    });
    // Registro de Operacion.
    await crearOperacion({
      tipo: 'entrada',
      fecha: ayer,
      lineas: [{ presentacionId: litro, piezas: 100 }],
    });
    await crearOperacion({
      tipo: 'entrada',
      fecha: ayer,
      lineas: [{ presentacionId: litro, piezas: 70 }],
      borrada: true,
    });
    await crearOperacion({
      tipo: 'merma',
      fecha: ayer,
      lineas: [{ presentacionId: litro, piezas: 2 }],
    });
    await crearOperacion({
      tipo: 'consumo',
      fecha: ayer,
      lineas: [{ presentacionId: litro, piezas: 3 }],
    });
    await crearOperacion({
      tipo: 'descuento',
      fecha: ayer,
      lineas: [{ presentacionId: litro, piezas: 4 }],
    });
    await crearOperacion({
      tipo: 'envio',
      fecha: ayer,
      lineas: [{ presentacionId: litro, piezas: 6 }],
    });
    await crearOperacion({
      tipo: 'retiro_merma',
      fecha: ayer,
      estado: 'autorizado',
      lineas: [{ presentacionId: litro, piezas: 1 }],
    });
    await crearOperacion({
      tipo: 'retiro_merma',
      fecha: ayer,
      estado: 'pendiente',
      lineas: [{ presentacionId: litro, piezas: 9 }],
    });
    // Procesos de Oficina.
    await crearProceso({
      tipo: 'merma',
      mermaDe: 'cliente',
      clienteId: cliente,
      lineas: [
        { presentacionId: litro, sentido: 'recibido', piezas: 2 },
        { presentacionId: medio, sentido: 'entregado', piezas: 2 },
      ],
    });
    await crearProceso({
      tipo: 'merma',
      mermaDe: 'almacen',
      lineas: [{ presentacionId: litro, sentido: 'recibido', piezas: 1 }],
    });
    await crearProceso({
      tipo: 'consumo',
      lineas: [{ presentacionId: litro, sentido: 'entregado', piezas: 1 }],
    });
    await crearProceso({
      tipo: 'promocion',
      clienteId: cliente,
      lineas: [{ presentacionId: litro, sentido: 'entregado', piezas: 2 }],
    });
    await crearProceso({
      tipo: 'descuento',
      vendedorId: vendedorA,
      lineas: [{ presentacionId: litro, sentido: 'entregado', piezas: 3 }],
    });
    await crearProceso({
      tipo: 'cambio',
      clienteId: cliente,
      lineas: [
        { presentacionId: litro, sentido: 'recibido', piezas: 2 },
        { presentacionId: medio, sentido: 'entregado', piezas: 2 },
      ],
    });
    const borrado = await crearProceso({
      tipo: 'consumo',
      lineas: [{ presentacionId: litro, sentido: 'entregado', piezas: 30 }],
    });
    await http()
      .delete(`/procesos/${borrado.id}`)
      .set('Cookie', cookieGeneral)
      .expect(204);
    // Consumo de la app.
    await crearMovimiento({
      tipo: 'consumo',
      vendedorId: vendedorA,
      fecha: ayer,
      lineas: [{ presentacionId: litro, sentido: 'entregado', piezas: 1 }],
    });
    // Vendedor A, corte HECHO: teorica 4 (app) + 2 (Procesos con vendedor) = 6, contada 3.
    await crearMovimiento({
      tipo: 'merma_cliente',
      vendedorId: vendedorA,
      fecha: ayer,
      lineas: [{ presentacionId: litro, sentido: 'recibido', piezas: 4 }],
    });
    await crearProceso({
      tipo: 'merma',
      mermaDe: 'almacen',
      vendedorId: vendedorA,
      lineas: [{ presentacionId: litro, sentido: 'recibido', piezas: 2 }],
    });
    await http()
      .put('/cortes/vendedor')
      .set('Cookie', cookieGeneral)
      .send({
        fecha: ayer,
        vendedor: vendedorA,
        lineas: [{ presentacionId: litro, buenas: 0, merma: 3 }],
      })
      .expect(200);
    // Vendedor B, SIN corte: teorica 2 (app) + 1 (Procesos con vendedor) = 3.
    await crearMovimiento({
      tipo: 'merma_trayecto',
      vendedorId: vendedorB,
      fecha: ayer,
      lineas: [{ presentacionId: litro, sentido: 'recibido', piezas: 2 }],
    });
    await crearProceso({
      tipo: 'merma',
      mermaDe: 'almacen',
      vendedorId: vendedorB,
      lineas: [{ presentacionId: litro, sentido: 'recibido', piezas: 1 }],
    });

    // Arranque: ajuste de antier en YC para el litro (inicial 50, merma 10).
    await db
      .insertInto('inventario_pt_ajuste')
      .values({
        sucursal_id: kId,
        presentacion_id: litro,
        fecha: sql<Date>`${antier}::date`,
        inventario_inicial: 50,
        merma_acumulada_inicial: 10,
        capturo_usuario_id: generalId,
      })
      .execute();
  });

  afterAll(async () => {
    await db
      .deleteFrom('inventario_pt_ajuste')
      .where('sucursal_id', 'in', sucursalIds)
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
    await db
      .deleteFrom('retorno')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    await db
      .deleteFrom('corte_mercancia')
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

  // Litro de YC ayer, de cada fuente.
  const MERMA = 2 + 3 + 3 + (2 + 1); // Registro + A contada + B teorica + Oficina
  const AYER: Partial<RenglonPt> = {
    ventas: 5,
    promo: 1 + 2,
    merma: MERMA,
    consumo: 3 + 1 + 1,
    descuentos: 4 + 3,
    cambios: 2,
    entradas: 100,
    envios: 6,
    retiroMerma: 1,
  };
  const FINAL_AYER = 50 - 5 - MERMA - 5 - 3 - 7 + 2 + 100 - 6;
  const MERMA_AYER = 10 + MERMA - 1;

  describe('cada columna con su fuente (D2)', () => {
    it('ayer en YC: cada columna, lo borrado no cuenta (RF 4) y la merma de vendedores contada/teorica (RF 3)', async () => {
      const r = await leer({ fecha: ayer, sucursal: K });
      expect(r.fecha).toBe(ayer);
      expect(r.hoyEnTijuana).toBe(hoy);
      expect(renglon(r, litro)).toEqual({
        presentacionId: litro,
        productoId: productoIds[0],
        producto: PRODUCTO,
        volumen: '1 L',
        ventas: 5,
        promo: 3,
        merma: MERMA,
        consumo: 5,
        descuentos: 7,
        cambios: 2,
        entradas: 100,
        envios: 6,
        retiroMerma: 1,
        inicial: 50,
        final: FINAL_AYER,
        mermaAcumulada: MERMA_AYER,
        ajustado: false,
      });
    });

    it('medio sin ajuste: muestra sus movimientos con Inicial/Final/Merma acumulada null (RF 5)', async () => {
      const r = await leer({ fecha: ayer, sucursal: K });
      expect(renglon(r, medio)).toMatchObject({
        ventas: 0,
        cambios: -2,
        merma: 0,
        inicial: null,
        final: null,
        mermaAcumulada: null,
      });
    });

    it('el ajuste de antier: Inicial del ajuste y marca Ajustado; hoy encadena desde ayer', async () => {
      const a = await leer({ fecha: antier, sucursal: K });
      expect(renglon(a, litro)).toMatchObject({
        inicial: 50,
        final: 50,
        mermaAcumulada: 10,
        ajustado: true,
      });
      const h = await leer({ fecha: hoy, sucursal: K });
      expect(renglon(h, litro)).toMatchObject({
        inicial: FINAL_AYER,
        final: FINAL_AYER,
        mermaAcumulada: MERMA_AYER,
        ajustado: false,
      });
    });

    it('RF 1: el envío resta en YC (Envíos) y suma en YD (Entradas); con Todas se compensa', async () => {
      const l = await leer({ fecha: ayer, sucursal: L });
      expect(renglon(l, litro)).toMatchObject({
        entradas: 6,
        envios: 0,
        inicial: null,
        final: null,
      });
      const todas = await leer({ fecha: ayer, sucursal: 'todas' });
      const t = renglon(todas, litro);
      expect(t).toMatchObject({ entradas: 106, envios: 6, ventas: 5 });
      // Lo que entra en YD es lo que sale de YC: el neto de Todas no cambia.
      expect((t?.entradas ?? 0) - (t?.envios ?? 0)).toBe(100);
      // YD (y las demas sucursales) sin ajuste: Todas no tiene inventario inicial.
      expect(t?.final).toBeNull();
    });

    it('por producto: un renglón que suma sus presentaciones; sin ajuste en una, null', async () => {
      const r = await leer({ fecha: ayer, sucursal: K, vista: 'producto' });
      const p = r.renglones.find((x) => x.productoId === productoIds[0]);
      expect(p).toMatchObject({
        presentacionId: null,
        volumen: '',
        producto: PRODUCTO,
        ventas: 5,
        cambios: 0,
        final: null,
      });
    });

    it('presentaciones vivas aunque estén en 0; vista por presentación ordenada por tamaño', async () => {
      const r = await leer({ fecha: antier, sucursal: K });
      const nuestras = r.renglones.filter(
        (x) => x.productoId === productoIds[0],
      );
      expect(nuestras.map((x) => x.volumen)).toEqual(['500 ml', '1 L']);
      expect(renglon(r, medio)).toMatchObject({ ventas: 0, final: null });
    });
  });

  describe('historial y a quién', () => {
    it('historial: los días del rango encadenados', async () => {
      const res = await http()
        .get('/inventario-pt/historial')
        .query({ presentacion: litro, desde: antier, hasta: hoy, sucursal: K })
        .set('Cookie', cookieKVer)
        .expect(200);
      const h = res.body as HistorialPt;
      expect(
        h.dias.map((d) => [d.fecha, d.inicial, d.final, d.ajustado]),
      ).toEqual([
        [antier, 50, 50, true],
        [ayer, 50, FINAL_AYER, false],
        [hoy, FINAL_AYER, FINAL_AYER, false],
      ]);
      expect(h.dias[1]).toMatchObject(AYER);
      expect(h.dias[1]).toMatchObject({
        presentacionId: litro,
        volumen: '1 L',
      });
    });

    it('historial por producto suma sus presentaciones', async () => {
      const res = await http()
        .get('/inventario-pt/historial')
        .query({
          producto: productoIds[0],
          desde: ayer,
          hasta: ayer,
          sucursal: K,
        })
        .set('Cookie', cookieGeneral)
        .expect(200);
      const h = res.body as HistorialPt;
      expect(h.dias).toHaveLength(1);
      expect(h.dias[0]).toMatchObject({
        fecha: ayer,
        presentacionId: null,
        cambios: 0,
        final: null,
      });
    });

    it('historial: más de 62 días, desde > hasta, futuro o sin presentación = 400', async () => {
      const pedir = (q: Record<string, string>) =>
        http()
          .get('/inventario-pt/historial')
          .query(q)
          .set('Cookie', cookieGeneral);
      await pedir({
        presentacion: litro,
        desde: restarDias(hoy, 62),
        hasta: hoy,
        sucursal: K,
      }).expect(400);
      await pedir({
        presentacion: litro,
        desde: restarDias(hoy, 61),
        hasta: hoy,
        sucursal: K,
      }).expect(200);
      await pedir({
        presentacion: litro,
        desde: hoy,
        hasta: ayer,
        sucursal: K,
      }).expect(400);
      await pedir({
        presentacion: litro,
        desde: ayer,
        hasta: restarDias(hoy, -1),
        sucursal: K,
      }).expect(400);
      await pedir({ desde: ayer, hasta: hoy, sucursal: K }).expect(400);
      await pedir({
        presentacion: randomUUID(),
        desde: ayer,
        hasta: hoy,
        sucursal: K,
      }).expect(404);
    });

    it('descuentos: a quién (Nómina del Registro, Faltante del corte de Procesos)', async () => {
      const res = await http()
        .get('/inventario-pt/descuentos')
        .query({ presentacion: litro, fecha: ayer, sucursal: K })
        .set('Cookie', cookieKVer)
        .expect(200);
      const d = res.body as DescuentosPt;
      expect(d.detalle).toEqual(
        expect.arrayContaining([
          { quien: TRABAJADOR, origen: 'nomina', piezas: 4 },
          { quien: nombreA, origen: 'corte', piezas: 3 },
        ]),
      );
      expect(d.detalle).toHaveLength(2);
      const todas = (
        await http()
          .get('/inventario-pt/descuentos')
          .query({ producto: productoIds[0], fecha: ayer, sucursal: 'todas' })
          .set('Cookie', cookieGeneral)
          .expect(200)
      ).body as DescuentosPt;
      expect(todas.detalle).toHaveLength(2);
    });
  });

  describe('ajustes (D3)', () => {
    it('GET precarga con lo calculado; PUT guarda y el día queda Ajustado; el día anterior no cambia', async () => {
      const pre = (
        await http()
          .get('/inventario-pt/ajustes')
          .query({ fecha: hoy, sucursal: K })
          .set('Cookie', cookieKAjustar)
          .expect(200)
      ).body as AjustesPt;
      expect(
        pre.renglones.find((x) => x.presentacionId === litro),
      ).toMatchObject({
        inventarioInicial: FINAL_AYER,
        mermaAcumuladaInicial: MERMA_AYER,
        ajustado: false,
        producto: PRODUCTO,
        volumen: '1 L',
      });
      expect(
        pre.renglones.find((x) => x.presentacionId === medio),
      ).toMatchObject({
        inventarioInicial: null,
        mermaAcumuladaInicial: null,
        ajustado: false,
      });

      await ajustar(
        {
          fecha: hoy,
          sucursal: K,
          comentario: '  Conteo físico  ',
          renglones: [
            {
              presentacionId: litro,
              inventarioInicial: 120,
              mermaAcumuladaInicial: 18,
            },
            {
              presentacionId: medio,
              inventarioInicial: 7,
              mermaAcumuladaInicial: 0,
            },
          ],
        },
        cookieKAjustar,
      ).expect(204);
      // Corregir el mismo dia actualiza, no duplica.
      await ajustar(
        {
          fecha: hoy,
          sucursal: K,
          renglones: [
            {
              presentacionId: litro,
              inventarioInicial: 121,
              mermaAcumuladaInicial: 18,
            },
          ],
        },
        cookieKAjustar,
      ).expect(204);
      const filas = await db
        .selectFrom('inventario_pt_ajuste')
        .select([
          'inventario_inicial',
          'comentario',
          'actualizado_por_usuario_id',
        ])
        .where('presentacion_id', '=', litro)
        .where(sql<boolean>`fecha = ${hoy}::date`)
        .where('deleted_at', 'is', null)
        .execute();
      expect(filas).toHaveLength(1);
      expect(filas[0].inventario_inicial).toBe(121);
      expect(filas[0].actualizado_por_usuario_id).not.toBeNull();
      const medioFila = await db
        .selectFrom('inventario_pt_ajuste')
        .select('comentario')
        .where('presentacion_id', '=', medio)
        .executeTakeFirstOrThrow();
      expect(medioFila.comentario).toBe('Conteo físico');

      const h = await leer({ fecha: hoy, sucursal: K });
      expect(renglon(h, litro)).toMatchObject({
        inicial: 121,
        final: 121,
        mermaAcumulada: 18,
        ajustado: true,
      });
      expect(renglon(h, medio)).toMatchObject({ inicial: 7, ajustado: true });
      const a = await leer({ fecha: ayer, sucursal: K });
      expect(renglon(a, litro)).toMatchObject({
        inicial: 50,
        final: FINAL_AYER,
      });

      const post = (
        await http()
          .get('/inventario-pt/ajustes')
          .query({ fecha: hoy, sucursal: K })
          .set('Cookie', cookieGeneral)
          .expect(200)
      ).body as AjustesPt;
      expect(
        post.renglones.find((x) => x.presentacionId === litro),
      ).toMatchObject({
        inventarioInicial: 121,
        mermaAcumuladaInicial: 18,
        ajustado: true,
      });
    });

    it('PUT rechaza fecha futura, negativos, repetidos, presentación inexistente, Todas y sin renglones', async () => {
      const r = [
        {
          presentacionId: litro,
          inventarioInicial: 1,
          mermaAcumuladaInicial: 0,
        },
      ];
      await ajustar({
        fecha: restarDias(hoy, -1),
        sucursal: K,
        renglones: r,
      }).expect(400);
      await ajustar({ fecha: hoy, sucursal: K, renglones: [] }).expect(400);
      await ajustar({
        fecha: hoy,
        sucursal: K,
        renglones: [
          {
            presentacionId: litro,
            inventarioInicial: -1,
            mermaAcumuladaInicial: 0,
          },
        ],
      }).expect(400);
      await ajustar({
        fecha: hoy,
        sucursal: K,
        renglones: [...r, ...r],
      }).expect(400);
      await ajustar({
        fecha: hoy,
        sucursal: K,
        renglones: [
          {
            presentacionId: randomUUID(),
            inventarioInicial: 1,
            mermaAcumuladaInicial: 0,
          },
        ],
      }).expect(400);
      await ajustar({ fecha: hoy, sucursal: 'todas', renglones: r }).expect(
        400,
      );
      await ajustar({ fecha: hoy, renglones: r }).expect(400);
      await http()
        .get('/inventario-pt/ajustes')
        .query({ fecha: hoy, sucursal: 'todas' })
        .set('Cookie', cookieGeneral)
        .expect(400);
    });
  });

  describe('permisos y alcance (D5)', () => {
    it('sin inventario_pt.ver: 403 en todo', async () => {
      for (const [ruta, q] of [
        ['/inventario-pt', { fecha: ayer }],
        [
          '/inventario-pt/historial',
          { presentacion: litro, desde: ayer, hasta: ayer },
        ],
        ['/inventario-pt/descuentos', { presentacion: litro, fecha: ayer }],
      ] as const)
        await http().get(ruta).query(q).set('Cookie', cookieKSin).expect(403);
    });

    it('sin inventario_pt.ajustar: GET y PUT de ajustes 403', async () => {
      await http()
        .get('/inventario-pt/ajustes')
        .query({ fecha: hoy, sucursal: K })
        .set('Cookie', cookieKVer)
        .expect(403);
      await ajustar(
        {
          fecha: hoy,
          sucursal: K,
          renglones: [
            {
              presentacionId: litro,
              inventarioInicial: 1,
              mermaAcumuladaInicial: 0,
            },
          ],
        },
        cookieKVer,
      ).expect(403);
    });

    it('atado a YC: otra sucursal 403; todas o nada = la suya', async () => {
      await http()
        .get('/inventario-pt')
        .query({ fecha: ayer, sucursal: L })
        .set('Cookie', cookieKVer)
        .expect(403);
      const propia = await leer({ fecha: ayer, sucursal: 'todas' }, cookieKVer);
      expect(renglon(propia, litro)).toMatchObject({
        entradas: 100,
        final: FINAL_AYER,
      });
      await ajustar(
        {
          fecha: hoy,
          sucursal: L,
          renglones: [
            {
              presentacionId: litro,
              inventarioInicial: 1,
              mermaAcumuladaInicial: 0,
            },
          ],
        },
        cookieKAjustar,
      ).expect(403);
    });

    it('fecha futura = 400 con hoyEnTijuana; sucursal inexistente = 404', async () => {
      const res = await http()
        .get('/inventario-pt')
        .query({ fecha: restarDias(hoy, -1), sucursal: K })
        .set('Cookie', cookieGeneral)
        .expect(400);
      expect((res.body as { hoyEnTijuana: string }).hoyEnTijuana).toBe(hoy);
      await http()
        .get('/inventario-pt')
        .query({ fecha: ayer, sucursal: 'QZ' })
        .set('Cookie', cookieGeneral)
        .expect(404);
    });
  });
});

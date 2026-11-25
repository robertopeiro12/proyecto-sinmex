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
import type { InventarioVendedor } from './../src/modules/produccion/inventario-vendedor.service';
import { MENSAJE_FECHA_FUTURA } from './../src/modules/produccion/reglas-comunes';

/**
 * Inventario por vendedor (GET /inventario-vendedor): un vendedor, "todos",
 * recargas con sus tres estados, alcance, permiso y fecha. Los vendedores,
 * clientes y presentaciones son de esta corrida; los dias son de 1980-1987
 * (lejos de los datos de ejemplo) y no chocan con otras suites por el vendedor.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-inv-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-inv-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-inv-sin-${SUFIJO}`;
const PRODUCTO = `ZZ-inv-${SUFIJO}`;

const DIA_BASE = Date.now() % 2900;
function diaDeLaCorrida(desplazamiento: number): string {
  return new Date(
    Date.UTC(1980, 0, 1) + (DIA_BASE + desplazamiento) * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
}

describe('Inventario por vendedor (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let hoy: string;
  let manana: string;
  const usuarioIds: string[] = [];
  const productoIds: string[] = [];
  const vendedorIds: string[] = [];
  const clienteIds: string[] = [];
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let generalId: string;
  let tjId: string;
  let mxId: string;
  let litro: string;
  let medio: string;
  let clienteTj: string;

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
        login: `e2e-inv-v${vendedorIds.length + 1}-${SUFIJO}`,
        nombre: `${nombre} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
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
        nombre: `Cliente inv ${clienteIds.length + 1} ${SUFIJO}`,
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
    lineas: {
      presentacionId: string;
      piezas: number;
      /** Respuesta por renglon (pieza 3); sin ella, `null` como una carga de antes. */
      aceptada?: boolean | null;
    }[];
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
          aceptada: l.aceptada ?? null,
        })),
      )
      .execute();
  };

  /** Una venta escrita directo en la tabla, con lineas (vivas o borradas). */
  let folios = 0;
  const crearVenta = async (opciones: {
    vendedorId: string | null;
    clienteId: string;
    sucursalId: string;
    fecha: string;
    borrada?: boolean;
    lineas: {
      presentacionId: string;
      cantidad: number;
      promo?: number;
      borrada?: boolean;
    }[];
  }): Promise<void> => {
    const { id } = await db
      .insertInto('venta_nota')
      .values({
        folio: `ZZI${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha: sql<Date>`${opciones.fecha}::date`,
        cliente_id: opciones.clienteId,
        vendedor_id: opciones.vendedorId,
        monto_total: '10.00',
        contado_credito: 'contado',
        semana: 10,
        mes: 3,
        status: 'pagada',
        sucursal_id: opciones.sucursalId,
        origen: 'portal',
        capturo_usuario_id: generalId,
        deleted_at: opciones.borrada ? sql<Date>`now()` : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const l of opciones.lineas) {
      await db
        .insertInto('venta_nota_detalle')
        .values({
          venta_nota_id: id,
          presentacion_id: l.presentacionId,
          cantidad: l.cantidad,
          cantidad_promocion: l.promo ?? 0,
          precio: '1.00',
          deleted_at: l.borrada ? sql<Date>`now()` : null,
        })
        .execute();
    }
  };

  /** Un movimiento de la tablet (merma o consumo) escrito directo en las tablas. */
  const crearMovimiento = async (opciones: {
    vendedorId: string;
    sucursalId: string;
    fecha: string;
    tipo: 'merma_cliente' | 'merma_trayecto' | 'consumo' | 'cambio';
    clienteId?: string;
    borrado?: boolean;
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
        sucursal_id: opciones.sucursalId,
        vendedor_id: opciones.vendedorId,
        cliente_id:
          opciones.tipo === 'merma_cliente' || opciones.tipo === 'cambio'
            ? (opciones.clienteId ?? clienteTj)
            : null,
        tipo: opciones.tipo,
        fecha: sql<Date>`${opciones.fecha}::date`,
        registrado_en: sql<Date>`now()`,
        deleted_at: opciones.borrado ? sql<Date>`now()` : null,
      })
      .execute();
    await db
      .insertInto('movimiento_inventario_linea')
      .values(
        opciones.lineas.map((l) => ({
          movimiento_id: id,
          presentacion_id: l.presentacionId,
          sentido: l.sentido,
          piezas: l.piezas,
        })),
      )
      .execute();
  };

  const consultar = (cookie: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/inventario-vendedor?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const marcarCorte = async (
    vendedorId: string,
    sucursalId: string,
    fecha: string,
    conteo: { presentacionId: string; buenas: number; merma: number }[],
  ) => {
    for (const c of conteo) {
      await db
        .insertInto('retorno')
        .values({
          fecha: sql<Date>`${fecha}::date`,
          vendedor_id: vendedorId,
          sucursal_id: sucursalId,
          presentacion_id: c.presentacionId,
          piezas: c.buenas,
          piezas_merma: c.merma,
          capturo_usuario_id: generalId,
        })
        .execute();
    }
    await db
      .insertInto('corte_mercancia')
      .values({
        fecha: sql<Date>`${fecha}::date`,
        vendedor_id: vendedorId,
        sucursal_id: sucursalId,
        hecho_por_usuario_id: generalId,
      })
      .execute();
  };

  const linea = (r: InventarioVendedor, presentacionId: string) =>
    r.lineas.find((l) => l.presentacionId === presentacionId);

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

    generalId = await crearUsuario(
      LOGIN_GENERAL,
      'Administrador General',
      null,
    );
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', tjId);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);

    litro = await crearPresentacion(PRODUCTO, '1 L');
    medio = await crearPresentacion(`${PRODUCTO}-b`, '500 ml');
    clienteTj = await crearCliente(tjId);
  });

  afterAll(async () => {
    await db
      .deleteFrom('retorno')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    await db
      .deleteFrom('corte_mercancia')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    await db
      .deleteFrom('movimiento_inventario_linea')
      .where(
        'movimiento_id',
        'in',
        db
          .selectFrom('movimiento_inventario')
          .select('id')
          .where('vendedor_id', 'in', vendedorIds),
      )
      .execute();
    await db
      .deleteFrom('movimiento_inventario')
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
    const notas = db
      .selectFrom('venta_nota')
      .select('id')
      .where('cliente_id', 'in', clienteIds);
    await db
      .deleteFrom('venta_nota_detalle')
      .where('venta_nota_id', 'in', notas)
      .execute();
    await db
      .deleteFrom('venta_nota')
      .where('cliente_id', 'in', clienteIds)
      .execute();
    await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
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

  describe('un vendedor', () => {
    it('trae las lineas del corte de ese vendedor, su estado y sus faltantes', async () => {
      const dia = diaDeLaCorrida(0);
      const v = await crearVendedor('Inv uno', tjId);
      await crearCarga({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [
          { presentacionId: litro, piezas: 10 },
          { presentacionId: medio, piezas: 6 },
        ],
      });
      await crearVenta({
        vendedorId: v,
        clienteId: clienteTj,
        sucursalId: tjId,
        fecha: dia,
        lineas: [{ presentacionId: litro, cantidad: 4, promo: 1 }],
      });
      await crearMovimiento({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        tipo: 'merma_cliente',
        lineas: [
          { presentacionId: litro, sentido: 'recibido', piezas: 2 },
          { presentacionId: litro, sentido: 'entregado', piezas: 1 },
        ],
      });
      await crearMovimiento({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        tipo: 'consumo',
        lineas: [{ presentacionId: medio, sentido: 'entregado', piezas: 1 }],
      });

      // Sin corte: resultados vacios.
      const sin = (
        await consultar(cookieGeneral, {
          fecha: dia,
          sucursal: 'TJ',
          vendedor: v,
        }).expect(200)
      ).body as InventarioVendedor;
      expect(sin.corte).toEqual({
        estado: 'sin_corte',
        piezasFaltantes: null,
        mermaFaltante: null,
      });
      expect(sin.vendedor?.id).toBe(v);
      expect(sin.sucursal.codigo).toBe('TJ');
      expect(sin.hoy).toBe(hoy);
      expect(sin.vendedoresSinCorte).toBe(0);
      expect(linea(sin, litro)).toMatchObject({
        cargadas: 10,
        vendidas: 4,
        regaladas: 1,
        mermaEntregada: 1,
        mermaRecibida: 2,
        deberiaRegresar: 4,
        mermaTeorica: 2,
        buenas: null,
        merma: null,
        faltante: null,
        resultadoMerma: null,
      });

      await marcarCorte(v, tjId, dia, [
        { presentacionId: litro, buenas: 3, merma: 1 },
        { presentacionId: medio, buenas: 6, merma: 0 },
      ]);
      const con = (
        await consultar(cookieGeneral, {
          fecha: dia,
          sucursal: 'TJ',
          vendedor: v,
        }).expect(200)
      ).body as InventarioVendedor;
      expect(linea(con, litro)).toMatchObject({
        buenas: 3,
        merma: 1,
        faltante: 1,
        resultadoMerma: 1,
      });
      expect(linea(con, medio)).toMatchObject({
        deberiaRegresar: 5,
        buenas: 6,
        faltante: -1,
      });
      // Por tamano: 1 L falta 1; 500 ml sobra 1 (no compensa).
      expect(con.corte).toEqual({
        estado: 'con_faltante',
        piezasFaltantes: 1,
        mermaFaltante: 1,
      });
      expect(con.totales.faltante).toBe(1);
    });

    it('muestra los cambios: lo recibido sube la teorica, lo entregado la baja y la merma teorica no cambia', async () => {
      const dia = diaDeLaCorrida(6);
      const v = await crearVendedor('Inv cambio', tjId);
      await crearCarga({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [
          { presentacionId: litro, piezas: 10 },
          { presentacionId: medio, piezas: 6 },
        ],
      });
      await crearMovimiento({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        tipo: 'cambio',
        lineas: [
          { presentacionId: medio, sentido: 'recibido', piezas: 3 },
          { presentacionId: litro, sentido: 'entregado', piezas: 2 },
        ],
      });

      const r = (
        await consultar(cookieGeneral, {
          fecha: dia,
          sucursal: 'TJ',
          vendedor: v,
        }).expect(200)
      ).body as InventarioVendedor;
      expect(linea(r, medio)).toMatchObject({
        cambiosRecibidos: 3,
        cambiosEntregados: 0,
        mermaRecibida: 0,
        deberiaRegresar: 9,
        mermaTeorica: 0,
      });
      expect(linea(r, litro)).toMatchObject({
        cambiosRecibidos: 0,
        cambiosEntregados: 2,
        mermaEntregada: 0,
        deberiaRegresar: 8,
        mermaTeorica: 0,
      });
      expect(r.totales).toMatchObject({
        cambiosRecibidos: 3,
        cambiosEntregados: 2,
        deberiaRegresar: 17,
      });
    });

    it('un vendedor sin movimiento ese dia da lineas vacias, sin error', async () => {
      const v = await crearVendedor('Inv vacio', tjId);
      const r = (
        await consultar(cookieGeneral, {
          fecha: diaDeLaCorrida(1),
          sucursal: 'TJ',
          vendedor: v,
        }).expect(200)
      ).body as InventarioVendedor;
      expect(r.lineas).toEqual([]);
      expect(r.recargas).toEqual([]);
      expect(r.corte?.estado).toBe('sin_corte');
    });
  });

  describe('todos', () => {
    it('suma por presentacion a los vendedores de la sucursal y respeta a quien no tiene corte', async () => {
      const dia = diaDeLaCorrida(2);
      const a = await crearVendedor('Inv todos A', tjId);
      const b = await crearVendedor('Inv todos B', tjId);
      const c = await crearVendedor('Inv todos C sin corte', tjId);
      const otraSucursal = await crearVendedor('Inv todos MX', mxId);
      for (const [v, piezas] of [
        [a, 10],
        [b, 5],
        [c, 7],
      ] as const) {
        await crearCarga({
          vendedorId: v,
          sucursalId: tjId,
          fecha: dia,
          estado: 'aceptada',
          lineas: [{ presentacionId: litro, piezas }],
        });
      }
      await crearCarga({
        vendedorId: otraSucursal,
        sucursalId: mxId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [{ presentacionId: litro, piezas: 100 }],
      });
      // A: falta 2; B: sobra 1; C: sin corte.
      await marcarCorte(a, tjId, dia, [
        { presentacionId: litro, buenas: 8, merma: 0 },
      ]);
      await marcarCorte(b, tjId, dia, [
        { presentacionId: litro, buenas: 6, merma: 0 },
      ]);

      const r = (
        await consultar(cookieGeneral, {
          fecha: dia,
          sucursal: 'TJ',
          vendedor: 'todos',
        }).expect(200)
      ).body as InventarioVendedor;
      expect(r.vendedor).toBeNull();
      expect(r.corte).toBeNull();
      expect(r.vendedoresSinCorte).toBe(1);
      expect(r.lineas).toHaveLength(1);
      expect(linea(r, litro)).toMatchObject({
        cargadas: 22,
        // La validacion por almacen solo cuenta a A y B (con corte).
        deberiaRegresar: 15,
        buenas: 14,
        faltante: 1,
      });
      expect(r.totales.cargadas).toBe(22);
      // Pie: lo que le sobra a B no compensa lo que le falta a A.
      expect(r.totales.faltante).toBe(2);
    });

    it('si ninguno tiene corte, los resultados salen vacios (no 0)', async () => {
      const dia = diaDeLaCorrida(3);
      const a = await crearVendedor('Inv sc A', tjId);
      await crearCarga({
        vendedorId: a,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [{ presentacionId: litro, piezas: 3 }],
      });
      const r = (
        await consultar(cookieGeneral, {
          fecha: dia,
          sucursal: 'TJ',
          vendedor: 'todos',
        }).expect(200)
      ).body as InventarioVendedor;
      expect(linea(r, litro)).toMatchObject({
        cargadas: 3,
        deberiaRegresar: null,
        mermaTeorica: null,
        buenas: null,
        faltante: null,
        resultadoMerma: null,
      });
      expect(r.totales.faltante).toBeNull();
      expect(r.vendedoresSinCorte).toBe(1);
    });

    it('sucursal=todas con "todos" es 400 "Elige una sucursal."', async () => {
      const res = await consultar(cookieGeneral, {
        fecha: hoy,
        sucursal: 'todas',
        vendedor: 'todos',
      }).expect(400);
      expect(JSON.stringify(res.body)).toContain('Elige una sucursal.');
      await consultar(cookieGeneral, { fecha: hoy, vendedor: 'todos' }).expect(
        400,
      );
    });
  });

  describe('recargas', () => {
    it('salen las tres con su estado y motivo; solo la aceptada suma en el inventario', async () => {
      const dia = diaDeLaCorrida(4);
      const v = await crearVendedor('Inv recargas', tjId);
      const w = await crearVendedor('Inv recargas W', tjId);
      await crearCarga({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [{ presentacionId: litro, piezas: 10 }],
      });
      await crearCarga({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        estado: 'pendiente',
        lineas: [{ presentacionId: litro, piezas: 20 }],
      });
      await crearCarga({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        estado: 'rechazada',
        lineas: [{ presentacionId: medio, piezas: 30 }],
      });
      await crearCarga({
        vendedorId: w,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [{ presentacionId: litro, piezas: 1 }],
      });

      const uno = (
        await consultar(cookieGeneral, {
          fecha: dia,
          sucursal: 'TJ',
          vendedor: v,
        }).expect(200)
      ).body as InventarioVendedor;
      expect(uno.recargas).toHaveLength(3);
      expect(uno.recargas.map((r) => r.estado).sort()).toEqual([
        'aceptada',
        'pendiente',
        'rechazada',
      ]);
      const rechazada = uno.recargas.find((r) => r.estado === 'rechazada');
      expect(rechazada).toMatchObject({
        motivoRechazo: 'No coincide',
        piezas: 30,
        presentacionId: medio,
        vendedorId: v,
        capturo: LOGIN_GENERAL,
      });
      expect(rechazada?.hora).toMatch(/^\d{2}:\d{2}$/);
      expect(uno.recargas.find((r) => r.estado === 'aceptada')).toMatchObject({
        motivoRechazo: null,
        piezas: 10,
      });
      expect(linea(uno, litro)?.cargadas).toBe(10);
      expect(linea(uno, medio)?.cargadas ?? 0).toBe(0);

      const todos = (
        await consultar(cookieGeneral, {
          fecha: dia,
          sucursal: 'TJ',
          vendedor: 'todos',
        }).expect(200)
      ).body as InventarioVendedor;
      expect(todos.recargas).toHaveLength(4);
      expect(new Set(todos.recargas.map((r) => r.vendedorId))).toEqual(
        new Set([v, w]),
      );
      expect(linea(todos, litro)?.cargadas).toBe(11);
    });
    it('una carga aceptada 2 de 3: cada renglon trae si se acepto y la carga cuantos; solo los aceptados suman', async () => {
      const dia = diaDeLaCorrida(5);
      const v = await crearVendedor('Inv renglones', tjId);
      const tercio = await crearPresentacion(`${PRODUCTO}-r`, '355 ml');
      await crearCarga({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [
          { presentacionId: litro, piezas: 10, aceptada: true },
          { presentacionId: medio, piezas: 7, aceptada: false },
          { presentacionId: tercio, piezas: 3, aceptada: true },
        ],
      });
      // Aceptada antes de la pieza 3 (renglones null): cuenta completa.
      await crearCarga({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [{ presentacionId: litro, piezas: 5 }],
      });
      await crearCarga({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        estado: 'pendiente',
        lineas: [{ presentacionId: medio, piezas: 2 }],
      });
      await crearCarga({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        estado: 'rechazada',
        lineas: [{ presentacionId: medio, piezas: 4 }],
      });

      const r = (
        await consultar(cookieGeneral, {
          fecha: dia,
          sucursal: 'TJ',
          vendedor: v,
        }).expect(200)
      ).body as InventarioVendedor;
      const deLaCarga = (piezas: number, presentacionId: string) =>
        r.recargas.find(
          (x) => x.piezas === piezas && x.presentacionId === presentacionId,
        );
      expect(deLaCarga(10, litro)).toMatchObject({
        estado: 'aceptada',
        aceptada: true,
        renglones: 3,
        renglonesAceptados: 2,
      });
      expect(deLaCarga(7, medio)).toMatchObject({
        estado: 'aceptada',
        aceptada: false,
        renglones: 3,
        renglonesAceptados: 2,
      });
      expect(deLaCarga(3, tercio)).toMatchObject({
        aceptada: true,
        renglones: 3,
        renglonesAceptados: 2,
      });
      expect(deLaCarga(5, litro)).toMatchObject({
        estado: 'aceptada',
        aceptada: true,
        renglones: 1,
        renglonesAceptados: 1,
      });
      expect(deLaCarga(2, medio)).toMatchObject({
        estado: 'pendiente',
        aceptada: null,
        renglones: 1,
        renglonesAceptados: null,
      });
      expect(deLaCarga(4, medio)).toMatchObject({
        estado: 'rechazada',
        aceptada: false,
        renglones: 1,
        renglonesAceptados: 0,
      });
      expect(linea(r, litro)?.cargadas).toBe(15);
      expect(linea(r, medio)?.cargadas ?? 0).toBe(0);
      expect(linea(r, tercio)?.cargadas).toBe(3);
    });
  });

  describe('permiso, alcance y fecha', () => {
    it('sin inventario.ver es 403', async () => {
      await consultar(cookieSinPermiso, {
        fecha: hoy,
        sucursal: 'TJ',
        vendedor: 'todos',
      }).expect(403);
    });

    it('un usuario de TJ no pide MX (403) ni alcanza a un vendedor de MX (404)', async () => {
      const mx = await crearVendedor('Inv MX', mxId);
      await consultar(cookieTijuana, {
        fecha: hoy,
        sucursal: 'MX',
        vendedor: 'todos',
      }).expect(403);
      await consultar(cookieTijuana, {
        fecha: hoy,
        sucursal: 'TJ',
        vendedor: mx,
      }).expect(404);
      await consultar(cookieGeneral, {
        fecha: hoy,
        sucursal: 'TJ',
        vendedor: '3f2504e0-4f89-41d3-9a0c-0305e82c3399',
      }).expect(404);
    });

    it('un vendedor dado de baja es 404', async () => {
      const v = await crearVendedor('Inv baja', tjId);
      await db
        .updateTable('vendedor')
        .set({ deleted_at: sql`now()` })
        .where('id', '=', v)
        .execute();
      await consultar(cookieGeneral, {
        fecha: hoy,
        sucursal: 'TJ',
        vendedor: v,
      }).expect(404);
    });

    it('un vendedor que no es uuid ni "todos" es 400, no 500', async () => {
      const res = await consultar(cookieGeneral, {
        fecha: hoy,
        sucursal: 'TJ',
        vendedor: 'no-es-uuid',
      }).expect(400);
      expect(JSON.stringify(res.body)).toContain('Elige un vendedor válido.');
    });

    it('fecha futura es 400 con hoyEnTijuana; fecha inválida también', async () => {
      const res = await consultar(cookieGeneral, {
        fecha: manana,
        sucursal: 'TJ',
        vendedor: 'todos',
      }).expect(400);
      const cuerpo = res.body as { hoyEnTijuana: string; message: string[] };
      expect(cuerpo.hoyEnTijuana).toBe(hoy);
      expect(cuerpo.message).toContain(MENSAJE_FECHA_FUTURA);
      await consultar(cookieGeneral, {
        fecha: '2026-02-30',
        sucursal: 'TJ',
        vendedor: 'todos',
      }).expect(400);
    });
  });
});

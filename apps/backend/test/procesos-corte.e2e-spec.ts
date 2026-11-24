import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import { borrarCobrosDe, sembrarCobro } from './apoyo-cobros';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';
import type { CorteVendedor } from './../src/modules/produccion/cortes.service';
import type {
  PrecargaDescuentos,
  Proceso,
  ResumenCliente,
} from './../src/modules/inventario/procesos.service';

/**
 * Operacion -> Procesos (PR A), Tarea 3: los procesos con vendedor cuentan en
 * su corte (cada tipo en su campo; Oficina y descuento no cuentan), editar el
 * vendedor mueve las piezas de un corte a otro, la precarga de descuentos lee
 * los faltantes del corte y el resumen del cliente (deuda, notas, ultima compra,
 * promociones).
 *
 * Sucursales YA y YB, todo de esta corrida y limpiado por id al final.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const K = 'YA';
const L = 'YB';
const PRODUCTO = `ZZ-pcorte-${SUFIJO}`;
const TIPOS = ['merma', 'cambio', 'consumo', 'promocion', 'descuento'] as const;

function restarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - dias)).toISOString().slice(0, 10);
}

describe('Procesos en el corte, precarga y resumen (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let hoy: string;
  let ayer: string;
  const usuarioIds: string[] = [];
  const productoIds: string[] = [];
  const sucursalIds: string[] = [];
  const clienteIds: string[] = [];
  const vendedorIds: string[] = [];
  const tipoNegocioIds: string[] = [];
  let generalId: string;
  let kId: string;
  let lId: string;
  let litro: string;
  let medio: string;
  let cliente: string;
  let prospecto: string;
  let clienteOtra: string;
  let clienteBaja: string;
  let vendedorA: string;
  let vendedorB: string;
  let vendedorC: string;
  let vendedorSinCorte: string;
  let vendedorOtra: string;
  let vendedorBaja: string;

  let cookieGeneral: string;
  let cookieK: string; // atado a YA con los cinco permisos
  let cookieKConsumo: string; // atado a YA solo con proceso.consumo
  let cookieKSin: string; // atado a YA sin permisos de procesos

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
    opciones: {
      tipo?: 'cliente' | 'prospecto';
      baja?: boolean;
      tipoNegocioId?: string;
      plazo?: number;
    } = {},
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
        nombre: `Cliente pcorte ${clienteIds.length + 1} ${SUFIJO}`,
        domicilio: 'Calle 1',
        telefono: '6640000000',
        tipo,
        lista_precio_id: tipo === 'cliente' ? lista.id : null,
        sucursal_id: sucursalId,
        tipo_negocio_id: opciones.tipoNegocioId ?? null,
        plazo_credito_dias: opciones.plazo ?? null,
        deleted_at: opciones.baja ? sql<Date>`now()` : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return id;
  };

  const crearVendedor = async (
    sucursalId: string,
    opciones: { baja?: boolean } = {},
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-pcorte-v${vendedorIds.length + 1}-${SUFIJO}`,
        nombre: `Vendedor pcorte ${vendedorIds.length + 1} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
        activo: true,
        deleted_at: opciones.baja ? sql<Date>`now()` : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  let numeroCarga = 0;
  const crearCargaAceptada = async (
    vendedorId: string,
    fecha: string,
    lineas: { presentacionId: string; piezas: number }[],
  ): Promise<void> => {
    numeroCarga++;
    const { id } = await db
      .insertInto('carga')
      .values({
        vendedor_id: vendedorId,
        sucursal_id: kId,
        fecha: sql<Date>`${fecha}::date`,
        numero: numeroCarga,
        estado: 'aceptada',
        respondida_en: sql<Date>`now()`,
        capturo_usuario_id: generalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('carga_detalle')
      .values(
        lineas.map((l) => ({
          carga_id: id,
          presentacion_id: l.presentacionId,
          piezas: l.piezas,
        })),
      )
      .execute();
  };

  let folios = 0;
  const crearVenta = async (opciones: {
    clienteId: string;
    fecha: string;
    monto: string;
    credito: boolean;
    status: 'pagada' | 'pendiente' | 'abonado' | 'cuenta_perdida';
    borrada?: boolean;
  }): Promise<string> => {
    const { id } = await db
      .insertInto('venta_nota')
      .values({
        folio: `ZZP${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha: sql<Date>`${opciones.fecha}::date`,
        cliente_id: opciones.clienteId,
        vendedor_id: null,
        monto_total: opciones.monto,
        contado_credito: opciones.credito ? 'credito' : 'contado',
        semana: 10,
        mes: 3,
        status: opciones.status,
        sucursal_id: kId,
        origen: 'portal',
        capturo_usuario_id: generalId,
        deleted_at: opciones.borrada ? sql<Date>`now()` : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  const crearPromocion = async (valores: {
    sucursalId: string;
    audiencia: 'todos' | 'cliente' | 'prospecto';
    clienteId?: string;
    compraTipo: 'cualquiera' | 'producto' | 'presentacion';
    compraProductoId?: string;
    compraPresentacionId?: string;
    compraCantidad: number;
    regaloTipo: 'mismo' | 'producto' | 'presentacion';
    regaloPresentacionId?: string;
    regaloCantidad: number;
    seRepite: boolean;
    activo?: boolean;
    borrada?: boolean;
  }): Promise<void> => {
    await db
      .insertInto('promocion')
      .values({
        sucursal_id: valores.sucursalId,
        audiencia: valores.audiencia,
        cliente_id: valores.clienteId ?? null,
        compra_tipo: valores.compraTipo,
        compra_producto_id: valores.compraProductoId ?? null,
        compra_presentacion_id: valores.compraPresentacionId ?? null,
        compra_cantidad: valores.compraCantidad,
        regalo_tipo: valores.regaloTipo,
        regalo_producto_id: null,
        regalo_presentacion_id: valores.regaloPresentacionId ?? null,
        regalo_cantidad: valores.regaloCantidad,
        se_repite: valores.seRepite,
        activo: valores.activo ?? true,
        deleted_at: valores.borrada ? sql<Date>`now()` : null,
      })
      .execute();
  };

  const crearProceso = async (
    cuerpo: Record<string, unknown>,
  ): Promise<Proceso> =>
    (
      await http()
        .post('/procesos')
        .set('Cookie', cookieGeneral)
        .send({
          sucursal: K,
          fecha: hoy,
          clienteId: null,
          vendedorId: null,
          mermaDe: null,
          comentario: null,
          ...cuerpo,
        })
        .expect(201)
    ).body as Proceso;

  const corte = async (
    vendedorId: string,
    fecha: string,
  ): Promise<CorteVendedor> =>
    (
      await http()
        .get('/cortes/vendedor')
        .query({ vendedor: vendedorId, fecha })
        .set('Cookie', cookieGeneral)
        .expect(200)
    ).body as CorteVendedor;

  const linea = (c: CorteVendedor, presentacionId: string) =>
    c.lineas.find((l) => l.presentacionId === presentacionId);

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
    litro = await crearPresentacion('1 L');
    medio = await crearPresentacion('500 ml');

    const { id: tipoNegocio } = await db
      .insertInto('tipo_negocio')
      .values({ nombre: `Abarrotes pcorte ${SUFIJO}` })
      .returning('id')
      .executeTakeFirstOrThrow();
    tipoNegocioIds.push(tipoNegocio);

    cliente = await crearCliente(kId, {
      tipoNegocioId: tipoNegocio,
      plazo: 15,
    });
    prospecto = await crearCliente(kId, { tipo: 'prospecto' });
    clienteOtra = await crearCliente(lId);
    clienteBaja = await crearCliente(kId, { baja: true });
    vendedorA = await crearVendedor(kId);
    vendedorB = await crearVendedor(kId);
    vendedorC = await crearVendedor(kId);
    vendedorSinCorte = await crearVendedor(kId);
    vendedorOtra = await crearVendedor(lId);
    vendedorBaja = await crearVendedor(kId, { baja: true });

    generalId = await crearUsuario(
      `e2e-pcorte-gen-${SUFIJO}`,
      'Administrador General',
      null,
    );
    await crearUsuario(
      `e2e-pcorte-k-${SUFIJO}`,
      'Auxiliar Administrativo',
      kId,
      TIPOS.map((t) => `proceso.${t}`),
    );
    await crearUsuario(
      `e2e-pcorte-kc-${SUFIJO}`,
      'Auxiliar Administrativo',
      kId,
      ['proceso.consumo'],
    );
    await crearUsuario(
      `e2e-pcorte-ks-${SUFIJO}`,
      'Auxiliar Administrativo',
      kId,
      [],
    );

    cookieGeneral = await iniciarSesion(`e2e-pcorte-gen-${SUFIJO}`);
    cookieK = await iniciarSesion(`e2e-pcorte-k-${SUFIJO}`);
    cookieKConsumo = await iniciarSesion(`e2e-pcorte-kc-${SUFIJO}`);
    cookieKSin = await iniciarSesion(`e2e-pcorte-ks-${SUFIJO}`);
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
    await db
      .deleteFrom('retorno')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    await db
      .deleteFrom('corte_mercancia')
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
      .deleteFrom('cobranza_abono')
      .where('venta_nota_id', 'in', notas)
      .execute();
    await borrarCobrosDe(db, clienteIds);
    await db
      .deleteFrom('venta_nota')
      .where('cliente_id', 'in', clienteIds)
      .execute();
    await db
      .deleteFrom('promocion')
      .where('sucursal_id', 'in', sucursalIds)
      .execute();
    await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
    await db
      .deleteFrom('tipo_negocio')
      .where('id', 'in', tipoNegocioIds)
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

  describe('cuentan en el corte del vendedor (D4)', () => {
    it('cada tipo suma en su campo; Oficina y descuento no cuentan', async () => {
      await crearCargaAceptada(vendedorA, hoy, [
        { presentacionId: litro, piezas: 20 },
        { presentacionId: medio, piezas: 20 },
      ]);
      const antes = await corte(vendedorA, hoy);
      expect(linea(antes, litro)?.deberiaRegresar).toBe(20);

      await crearProceso({
        tipo: 'merma',
        mermaDe: 'cliente',
        clienteId: cliente,
        vendedorId: vendedorA,
        lineas: [
          { presentacionId: litro, sentido: 'recibido', piezas: 3 },
          { presentacionId: medio, sentido: 'entregado', piezas: 3 },
        ],
      });
      await crearProceso({
        tipo: 'merma',
        mermaDe: 'almacen',
        vendedorId: vendedorA,
        lineas: [{ presentacionId: litro, sentido: 'recibido', piezas: 2 }],
      });
      await crearProceso({
        tipo: 'cambio',
        clienteId: cliente,
        vendedorId: vendedorA,
        lineas: [
          { presentacionId: medio, sentido: 'recibido', piezas: 4 },
          { presentacionId: litro, sentido: 'entregado', piezas: 4 },
        ],
      });
      await crearProceso({
        tipo: 'consumo',
        vendedorId: vendedorA,
        lineas: [{ presentacionId: litro, sentido: 'entregado', piezas: 1 }],
      });
      await crearProceso({
        tipo: 'promocion',
        clienteId: cliente,
        vendedorId: vendedorA,
        lineas: [{ presentacionId: medio, sentido: 'entregado', piezas: 2 }],
      });
      // Descuento: es la consecuencia del faltante, no mueve la cuenta.
      await crearProceso({
        tipo: 'descuento',
        vendedorId: vendedorA,
        lineas: [{ presentacionId: litro, sentido: 'entregado', piezas: 5 }],
      });
      // Oficina (sin vendedor): no es de ninguna camioneta.
      await crearProceso({
        tipo: 'consumo',
        lineas: [{ presentacionId: litro, sentido: 'entregado', piezas: 7 }],
      });
      await crearProceso({
        tipo: 'merma',
        mermaDe: 'almacen',
        lineas: [{ presentacionId: medio, sentido: 'recibido', piezas: 7 }],
      });
      // Uno dado de baja no cuenta.
      const borrado = await crearProceso({
        tipo: 'consumo',
        vendedorId: vendedorA,
        lineas: [{ presentacionId: medio, sentido: 'entregado', piezas: 9 }],
      });
      await http()
        .delete(`/procesos/${borrado.id}`)
        .set('Cookie', cookieGeneral)
        .expect(204);

      const despues = await corte(vendedorA, hoy);
      expect(linea(despues, litro)).toMatchObject({
        cargadas: 20,
        vendidas: 0,
        regaladas: 0,
        mermaEntregada: 0,
        mermaRecibida: 3,
        mermaAlmacen: 2,
        consumo: 1,
        cambiosEntregados: 4,
        cambiosRecibidos: 0,
        deberiaRegresar: 20 - 2 - 1 - 4,
        mermaTeorica: 3 + 2,
      });
      expect(linea(despues, medio)).toMatchObject({
        cargadas: 20,
        regaladas: 2,
        mermaEntregada: 3,
        mermaRecibida: 0,
        mermaAlmacen: 0,
        consumo: 0,
        cambiosEntregados: 0,
        cambiosRecibidos: 4,
        deberiaRegresar: 20 - 2 - 3 + 4,
        mermaTeorica: 0,
      });
      expect(despues.totales).toMatchObject({
        cambiosEntregados: 4,
        cambiosRecibidos: 4,
      });
    });

    it('editar el vendedor mueve las piezas de un corte a otro; eliminar las quita (Review Focus 1)', async () => {
      const p = await crearProceso({
        tipo: 'consumo',
        fecha: ayer,
        vendedorId: vendedorB,
        lineas: [{ presentacionId: litro, sentido: 'entregado', piezas: 6 }],
      });
      expect(linea(await corte(vendedorB, ayer), litro)?.consumo).toBe(6);
      expect(linea(await corte(vendedorC, ayer), litro)).toBeUndefined();

      await http()
        .patch(`/procesos/${p.id}`)
        .set('Cookie', cookieGeneral)
        .send({
          fecha: ayer,
          vendedorId: vendedorC,
          lineas: [{ presentacionId: litro, sentido: 'entregado', piezas: 6 }],
        })
        .expect(200);
      expect(linea(await corte(vendedorB, ayer), litro)).toBeUndefined();
      expect(linea(await corte(vendedorC, ayer), litro)?.consumo).toBe(6);

      // A Oficina: tampoco cuenta.
      await http()
        .patch(`/procesos/${p.id}`)
        .set('Cookie', cookieGeneral)
        .send({
          fecha: ayer,
          vendedorId: null,
          lineas: [{ presentacionId: litro, sentido: 'entregado', piezas: 6 }],
        })
        .expect(200);
      expect(linea(await corte(vendedorC, ayer), litro)).toBeUndefined();

      await http()
        .patch(`/procesos/${p.id}`)
        .set('Cookie', cookieGeneral)
        .send({
          fecha: ayer,
          vendedorId: vendedorC,
          lineas: [{ presentacionId: litro, sentido: 'entregado', piezas: 6 }],
        })
        .expect(200);
      expect(linea(await corte(vendedorC, ayer), litro)?.consumo).toBe(6);
      await http()
        .delete(`/procesos/${p.id}`)
        .set('Cookie', cookieGeneral)
        .expect(204);
      expect(linea(await corte(vendedorC, ayer), litro)).toBeUndefined();
    });
  });

  describe('GET /procesos/descuentos/precarga (Review Focus 4)', () => {
    const precarga = (cookie: string, vendedor: string, fecha: string) =>
      http()
        .get('/procesos/descuentos/precarga')
        .query({ vendedor, fecha })
        .set('Cookie', cookie);

    it('sin corte hecho: corteHecho false y sin lineas', async () => {
      await crearCargaAceptada(vendedorSinCorte, hoy, [
        { presentacionId: litro, piezas: 10 },
      ]);
      const res = await precarga(cookieK, vendedorSinCorte, hoy).expect(200);
      expect(res.body as PrecargaDescuentos).toEqual({
        corteHecho: false,
        lineas: [],
      });
    });

    it('con corte hecho: solo los faltantes positivos de piezas por presentacion', async () => {
      // Del primer caso: teorica litro 13, medio 19; merma teorica litro 5.
      await http()
        .put('/cortes/vendedor')
        .set('Cookie', cookieGeneral)
        .send({
          vendedor: vendedorA,
          fecha: hoy,
          lineas: [
            { presentacionId: litro, buenas: 10, merma: 1 },
            { presentacionId: medio, buenas: 21, merma: 0 },
          ],
        })
        .expect(200);
      const res = await precarga(cookieK, vendedorA, hoy).expect(200);
      expect(res.body as PrecargaDescuentos).toEqual({
        corteHecho: true,
        lineas: [
          {
            presentacionId: litro,
            nombre: `${PRODUCTO} 1 L`,
            piezas: 3,
          },
        ],
      });
    });

    it('vendedor de otra sucursal o dado de baja = 404; sin permiso de descuento = 403', async () => {
      await precarga(cookieK, vendedorOtra, hoy).expect(404);
      await precarga(cookieK, vendedorBaja, hoy).expect(404);
      await precarga(cookieGeneral, vendedorBaja, hoy).expect(404);
      await precarga(cookieKConsumo, vendedorA, hoy).expect(403);
      await precarga(cookieK, 'no-es-uuid', hoy).expect(400);
      await precarga(cookieK, vendedorA, restarDias(hoy, -1)).expect(400);
    });
  });

  describe('GET /procesos/cliente/:id', () => {
    const resumen = (cookie: string, id: string) =>
      http().get(`/procesos/cliente/${id}`).set('Cookie', cookie);

    it('deuda, notas con saldo, ultima compra y promociones vigentes', async () => {
      // Con saldo: 100 pendiente + (50 − 20) abonada = 130 en 2 notas.
      await crearVenta({
        clienteId: cliente,
        fecha: restarDias(hoy, 5),
        monto: '100.00',
        credito: true,
        status: 'pendiente',
      });
      const abonada = await crearVenta({
        clienteId: cliente,
        fecha: restarDias(hoy, 4),
        monto: '50.00',
        credito: true,
        status: 'abonado',
      });
      await db
        .insertInto('cobranza_abono')
        .values({
          venta_nota_id: abonada,
          vendedor_id: null,
          fecha_pago: restarDias(hoy, 4),
          fecha_operacion: restarDias(hoy, 4),
          monto: '20.00',
          tipo: 'abono',
          saldo_pendiente: '30.00',
          metodo_pago: 'efectivo',
          origen: 'cobro',
          cobro_id: await sembrarCobro(db, {
            clienteId: cliente,
            vendedorId: null,
            monto: '20.00',
            fecha: restarDias(hoy, 4),
          }),
        })
        .execute();
      // No cuentan: pagada, cuenta perdida, contado.
      await crearVenta({
        clienteId: cliente,
        fecha: restarDias(hoy, 6),
        monto: '40.00',
        credito: true,
        status: 'pagada',
      });
      await crearVenta({
        clienteId: cliente,
        fecha: restarDias(hoy, 6),
        monto: '70.00',
        credito: true,
        status: 'cuenta_perdida',
      });
      await crearVenta({
        clienteId: cliente,
        fecha: restarDias(hoy, 2),
        monto: '15.00',
        credito: false,
        status: 'pagada',
      });
      // Una borrada mas reciente no es la ultima compra.
      await crearVenta({
        clienteId: cliente,
        fecha: hoy,
        monto: '15.00',
        credito: false,
        status: 'pagada',
        borrada: true,
      });

      // Promociones: la propia y la general "de lo que sea" aplican; la
      // general del mismo producto la desplaza la propia; inactiva, borrada,
      // de prospecto y de otra sucursal no.
      await crearPromocion({
        sucursalId: kId,
        audiencia: 'cliente',
        clienteId: cliente,
        compraTipo: 'presentacion',
        compraPresentacionId: litro,
        compraCantidad: 10,
        regaloTipo: 'mismo',
        regaloCantidad: 1,
        seRepite: true,
      });
      await crearPromocion({
        sucursalId: kId,
        audiencia: 'todos',
        compraTipo: 'cualquiera',
        compraCantidad: 20,
        regaloTipo: 'presentacion',
        regaloPresentacionId: medio,
        regaloCantidad: 2,
        seRepite: false,
      });
      await crearPromocion({
        sucursalId: kId,
        audiencia: 'todos',
        compraTipo: 'producto',
        compraProductoId: productoIds[0],
        compraCantidad: 3,
        regaloTipo: 'mismo',
        regaloCantidad: 1,
        seRepite: true,
      });
      await crearPromocion({
        sucursalId: kId,
        audiencia: 'todos',
        compraTipo: 'cualquiera',
        compraCantidad: 99,
        regaloTipo: 'presentacion',
        regaloPresentacionId: medio,
        regaloCantidad: 9,
        seRepite: true,
        activo: false,
      });
      await crearPromocion({
        sucursalId: kId,
        audiencia: 'todos',
        compraTipo: 'cualquiera',
        compraCantidad: 98,
        regaloTipo: 'presentacion',
        regaloPresentacionId: medio,
        regaloCantidad: 9,
        seRepite: true,
        borrada: true,
      });
      await crearPromocion({
        sucursalId: kId,
        audiencia: 'prospecto',
        compraTipo: 'cualquiera',
        compraCantidad: 0,
        regaloTipo: 'presentacion',
        regaloPresentacionId: medio,
        regaloCantidad: 1,
        seRepite: false,
      });
      await crearPromocion({
        sucursalId: lId,
        audiencia: 'todos',
        compraTipo: 'cualquiera',
        compraCantidad: 5,
        regaloTipo: 'presentacion',
        regaloPresentacionId: medio,
        regaloCantidad: 1,
        seRepite: true,
      });

      // Cualquiera de los cinco permisos basta.
      const res = await resumen(cookieKConsumo, cliente).expect(200);
      expect(res.body as ResumenCliente).toEqual({
        id: cliente,
        nombre: expect.stringContaining('Cliente pcorte') as string,
        tipo: 'cliente',
        tipoNegocio: `Abarrotes pcorte ${SUFIJO}`,
        diasCredito: 15,
        deudaCentavos: 13000,
        notasConSaldo: 2,
        ultimaCompra: restarDias(hoy, 2),
        promociones: [
          `Por cada 10 ${PRODUCTO} 1 L, 1 ${PRODUCTO} 1 L gratis`,
          `Al comprar 20 piezas de lo que sea, 2 ${PRODUCTO} 500 ml gratis (una vez)`,
        ],
      });
    });

    it('prospecto sin compras: sin deuda, sin ultima compra y con la de bienvenida', async () => {
      const res = await resumen(cookieK, prospecto).expect(200);
      expect(res.body as ResumenCliente).toMatchObject({
        id: prospecto,
        tipo: 'prospecto',
        tipoNegocio: null,
        diasCredito: null,
        deudaCentavos: 0,
        notasConSaldo: 0,
        ultimaCompra: null,
      });
      expect((res.body as ResumenCliente).promociones).toContain(
        `Bienvenida al prospecto: 1 ${PRODUCTO} 500 ml gratis en su primera venta`,
      );
    });

    it('otra sucursal, dado de baja o inexistente = 404; sin permisos de procesos = 403', async () => {
      await resumen(cookieK, clienteOtra).expect(404);
      await resumen(cookieK, clienteBaja).expect(404);
      await resumen(cookieK, '00000000-0000-4000-8000-000000000000').expect(
        404,
      );
      await resumen(cookieGeneral, clienteOtra).expect(200);
      await resumen(cookieKSin, cliente).expect(403);
      await resumen(cookieK, 'no-es-uuid').expect(400);
    });
  });
});

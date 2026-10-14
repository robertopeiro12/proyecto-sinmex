import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
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
import type { ReporteVentas } from './../src/modules/estadisticas/reglas-reporte-ventas';

const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const CODIGO = 'ZV';
const DESDE = '2018-03-01';
const HASTA = '2018-03-31';

describe('Reporte de Ventas (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  const vendedorIds: string[] = [];
  let productoId: string;
  let idZv: string;
  let idTijuana: string;
  let generalId: string;
  let cookieGeneral: string;
  let cookieZv: string;
  let cookieSinPermiso: string;
  let cookieConExcepcion: string;
  let juan: string;
  let pedro: string;
  let pre1: string;
  let pre2: string;
  let folios = 0;
  const ids: Record<string, string> = {};

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

  const sembrarCliente = async (
    nombre: string,
    sucursalId: string,
  ): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `${nombre} ${SUFIJO}`,
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

  const sembrarVendedor = async (nombre: string): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-rv-${vendedorIds.length + 1}-${SUFIJO}`,
        nombre: `${nombre} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: idZv,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  /** Venta de portal; `vendedor` null = mostrador. Devuelve el id. */
  const sembrarVenta = async (v: {
    clienteId: string;
    fecha: string;
    vendedor: string | null;
    monto: string;
    status?: string;
    numNota?: string;
    borrada?: boolean;
    semana?: number;
    lineas?: {
      presentacion: string;
      cantidad: number;
      promo?: number;
      borrada?: boolean;
    }[];
  }): Promise<string> => {
    const cliente = await db
      .selectFrom('cliente')
      .select('sucursal_id')
      .where('id', '=', v.clienteId)
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('venta_nota')
      .values({
        folio: `ZZV${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha: v.fecha,
        cliente_id: v.clienteId,
        vendedor_id: v.vendedor,
        monto_total: v.monto,
        num_nota: v.numNota ?? null,
        contado_credito: 'contado',
        semana: v.semana ?? 10,
        mes: 3,
        status: v.status ?? 'pagada',
        sucursal_id: cliente.sucursal_id,
        origen: 'portal',
        capturo_usuario_id: generalId,
        deleted_at: v.borrada ? new Date() : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const l of v.lineas ?? []) {
      await db
        .insertInto('venta_nota_detalle')
        .values({
          venta_nota_id: id,
          presentacion_id: l.presentacion,
          cantidad: l.cantidad,
          cantidad_promocion: l.promo ?? 0,
          precio: '6.50',
          deleted_at: l.borrada ? new Date() : null,
        })
        .execute();
    }
    return id;
  };

  const pedir = (cookie: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/reportes/ventas?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const deZv = async (
    extra: Record<string, string> = {},
  ): Promise<ReporteVentas> =>
    (
      await pedir(cookieGeneral, {
        desde: DESDE,
        hasta: HASTA,
        sucursal: CODIGO,
        ...extra,
      }).expect(200)
    ).body as ReporteVentas;

  const todas = (r: ReporteVentas) => r.dias.flatMap((d) => d.ventas);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    idZv = (
      await db
        .insertInto('sucursal')
        .values({ codigo: CODIGO, nombre: 'Prueba Reporte de Ventas' })
        .onConflict((oc) =>
          oc.column('codigo').doUpdateSet({ deleted_at: null }),
        )
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    idTijuana = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;

    generalId = await crearUsuario(
      `e2e-rv-gen-${SUFIJO}`,
      'Administrador General',
      null,
    );
    await crearUsuario(`e2e-rv-zv-${SUFIJO}`, 'Administrador General', idZv);
    await crearUsuario(`e2e-rv-sin-${SUFIJO}`, 'Auxiliar Administrativo', null);
    const conExcepcion = await crearUsuario(
      `e2e-rv-exc-${SUFIJO}`,
      'Auxiliar Administrativo',
      null,
    );
    const { id: permisoId } = await db
      .selectFrom('permiso')
      .select('id')
      .where('clave', '=', 'reporte_ventas.ver')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('usuario_permiso')
      .values({
        usuario_id: conExcepcion,
        permiso_id: permisoId,
        habilitado: true,
      })
      .execute();
    cookieGeneral = await iniciarSesion(`e2e-rv-gen-${SUFIJO}`);
    cookieZv = await iniciarSesion(`e2e-rv-zv-${SUFIJO}`);
    cookieSinPermiso = await iniciarSesion(`e2e-rv-sin-${SUFIJO}`);
    cookieConExcepcion = await iniciarSesion(`e2e-rv-exc-${SUFIJO}`);

    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: `Horchata rv ${SUFIJO}` })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    pre1 = (
      await db
        .insertInto('presentacion')
        .values({ producto_id: productoId, volumen: '1 L' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    pre2 = (
      await db
        .insertInto('presentacion')
        .values({ producto_id: productoId, volumen: '500 ml' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    juan = await sembrarVendedor('Juan');
    pedro = await sembrarVendedor('Pedro');
    const cobach = await sembrarCliente('Cobach', idZv);
    const moreno = await sembrarCliente('Moreno', idZv);
    const tienda = await sembrarCliente('Tienda TJ', idTijuana);

    ids.v1 = await sembrarVenta({
      clienteId: cobach,
      fecha: '2018-03-05',
      vendedor: juan,
      monto: '130.00',
      lineas: [{ presentacion: pre1, cantidad: 20, promo: 2 }],
    });
    ids.v2 = await sembrarVenta({
      clienteId: moreno,
      fecha: '2018-03-05',
      vendedor: null,
      monto: '78.00',
      status: 'pendiente',
      numNota: '345',
      lineas: [{ presentacion: pre1, cantidad: 12 }],
    });
    ids.v3 = await sembrarVenta({
      clienteId: cobach,
      fecha: '2018-03-06',
      vendedor: pedro,
      monto: '195.00',
      status: 'abonado',
      lineas: [
        { presentacion: pre1, cantidad: 30 },
        { presentacion: pre2, cantidad: 99, borrada: true },
      ],
    });
    ids.v4 = await sembrarVenta({
      clienteId: moreno,
      fecha: '2018-03-06',
      vendedor: juan,
      monto: '0.00',
      status: 'promocion',
      lineas: [{ presentacion: pre2, cantidad: 0, promo: 5 }],
    });
    ids.v5 = await sembrarVenta({
      clienteId: cobach,
      fecha: '2018-03-07',
      vendedor: juan,
      monto: '50.00',
      status: 'cuenta_perdida',
      lineas: [{ presentacion: pre1, cantidad: 7, borrada: true }],
    });
    ids.borrada = await sembrarVenta({
      clienteId: cobach,
      fecha: '2018-03-07',
      vendedor: pedro,
      monto: '999.00',
      borrada: true,
      lineas: [{ presentacion: pre1, cantidad: 1 }],
    });
    ids.v7 = await sembrarVenta({
      clienteId: moreno,
      fecha: '2018-03-08',
      vendedor: pedro,
      monto: '65.00',
      lineas: [{ presentacion: pre1, cantidad: 10 }],
    });
    ids.fuera = await sembrarVenta({
      clienteId: cobach,
      fecha: '2018-02-28',
      vendedor: juan,
      monto: '10.00',
      lineas: [{ presentacion: pre1, cantidad: 1 }],
    });
    ids.tj = await sembrarVenta({
      clienteId: tienda,
      fecha: '2018-03-05',
      vendedor: null,
      monto: '40.00',
      lineas: [{ presentacion: pre1, cantidad: 4 }],
    });

    // v7 facturada (T-19): la factura es del mismo cliente.
    const { id: facturaId } = await db
      .insertInto('factura')
      .values({
        numero: `a780${SUFIJO}`.slice(0, 30),
        cliente_id: moreno,
        creado_por_usuario_id: generalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .updateTable('venta_nota')
      .set({ factura: 'facturada', factura_id: facturaId })
      .where('id', '=', ids.v7)
      .execute();
    await db
      .updateTable('venta_nota')
      .set({ factura: 'pendiente' })
      .where('id', '=', ids.v1)
      .execute();
  });

  afterAll(async () => {
    if (clienteIds.length > 0) {
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
      await db
        .deleteFrom('factura')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    await db
      .deleteFrom('presentacion')
      .where('producto_id', '=', productoId)
      .execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
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
    await db.deleteFrom('sucursal').where('codigo', '=', CODIGO).execute();
    await app.close();
  });

  /* ================================================================ */

  describe('permiso, alcance y validacion', () => {
    it('sin sesion 401; sin reporte_ventas.ver 403; con la excepcion 200', async () => {
      await request(app.getHttpServer())
        .get(`/reportes/ventas?desde=${DESDE}&hasta=${HASTA}`)
        .expect(401);
      await pedir(cookieSinPermiso, { desde: DESDE, hasta: HASTA }).expect(403);
      await pedir(cookieConExcepcion, {
        desde: DESDE,
        hasta: HASTA,
        sucursal: CODIGO,
      }).expect(200);
    });

    it('rango invalido, invertido o de mas de un ano es 400', async () => {
      await pedir(cookieGeneral, { desde: '2018-02-30', hasta: HASTA }).expect(
        400,
      );
      await pedir(cookieGeneral, { desde: HASTA, hasta: DESDE }).expect(400);
      await pedir(cookieGeneral, { desde: '2017-01-01', hasta: HASTA }).expect(
        400,
      );
      await pedir(cookieGeneral, { hasta: HASTA }).expect(400);
    });

    it('repartidor que no es uuid ni "oficina" es 400', async () => {
      await pedir(cookieGeneral, {
        desde: DESDE,
        hasta: HASTA,
        repartidor: 'juan',
      }).expect(400);
    });

    it('atado a ZV: "todas" o nada le da ZV; pedir TJ es 403', async () => {
      for (const q of [{}, { sucursal: 'todas' }]) {
        const r = (
          await pedir(cookieZv, { desde: DESDE, hasta: HASTA, ...q }).expect(
            200,
          )
        ).body as ReporteVentas;
        expect(todas(r).map((v) => v.id)).not.toContain(ids.tj);
        expect(todas(r).map((v) => v.id)).toContain(ids.v1);
      }
      await pedir(cookieZv, {
        desde: DESDE,
        hasta: HASTA,
        sucursal: 'TJ',
      }).expect(403);
    });
  });

  describe('contenido', () => {
    it('entran todos los status vivos del rango; fuera borradas, fuera de rango y otra sucursal', async () => {
      const r = await deZv();
      expect(
        todas(r)
          .map((v) => v.id)
          .sort(),
      ).toEqual([ids.v1, ids.v2, ids.v3, ids.v4, ids.v5, ids.v7].sort());
      expect(new Set(todas(r).map((v) => v.status))).toEqual(
        new Set([
          'pagada',
          'pendiente',
          'abonado',
          'promocion',
          'cuenta_perdida',
        ]),
      );
    });

    it('piezas solo de lineas vivas; venta sin lineas vivas da 0 (Review Focus 1)', async () => {
      const r = await deZv();
      const v = (id: string) => todas(r).find((x) => x.id === id)!;
      expect(v(ids.v1)).toMatchObject({
        cantidad: 20,
        promocion: 2,
        montoCentavos: 13000,
      });
      expect(v(ids.v3)).toMatchObject({
        cantidad: 30,
        promocion: 0,
        montoCentavos: 19500,
      });
      expect(v(ids.v4)).toMatchObject({
        cantidad: 0,
        promocion: 5,
        montoCentavos: 0,
      });
      expect(v(ids.v5)).toMatchObject({
        cantidad: 0,
        promocion: 0,
        montoCentavos: 5000,
      });
    });

    it('repartidor, factura, # nota y semana', async () => {
      const r = await deZv();
      const v = (id: string) => todas(r).find((x) => x.id === id)!;
      expect(v(ids.v1).repartidor).toBe(`Juan ${SUFIJO}`);
      expect(v(ids.v2)).toMatchObject({
        repartidor: null,
        numNota: '345',
        factura: 'N/A',
        semana: 10,
      });
      expect(v(ids.v1).factura).toBe('Pendiente');
      expect(v(ids.v7).factura).toBe(`a780${SUFIJO}`.slice(0, 30));
    });

    it('dias, subtotales, total y resumen por repartidor', async () => {
      const r = await deZv();
      expect(r.desde).toBe(DESDE);
      expect(r.hasta).toBe(HASTA);
      expect(r.dias.map((d) => d.fecha)).toEqual([
        '2018-03-05',
        '2018-03-06',
        '2018-03-07',
        '2018-03-08',
      ]);
      expect(r.dias[0].subtotal).toEqual({
        ventas: 2,
        cantidad: 32,
        promocion: 2,
        montoCentavos: 20800,
      });
      expect(r.total).toEqual({
        ventas: 6,
        cantidad: 72,
        promocion: 7,
        montoCentavos: 51800,
      });
      const rep = (id: string | null) =>
        r.porRepartidor.find((p) => p.vendedorId === id)!;
      expect(rep(pedro)).toMatchObject({
        ventas: 2,
        cantidad: 40,
        promocion: 0,
        montoCentavos: 26000,
      });
      expect(rep(juan)).toMatchObject({
        ventas: 3,
        cantidad: 20,
        promocion: 7,
        montoCentavos: 18000,
      });
      expect(rep(null)).toMatchObject({
        repartidor: null,
        ventas: 1,
        cantidad: 12,
        montoCentavos: 7800,
      });
      expect(r.porRepartidor.map((p) => p.vendedorId)).toEqual([
        pedro,
        juan,
        null,
      ]);
    });

    it('filtro por vendedor y por oficina', async () => {
      const soloJuan = await deZv({ repartidor: juan });
      expect(
        todas(soloJuan)
          .map((v) => v.id)
          .sort(),
      ).toEqual([ids.v1, ids.v4, ids.v5].sort());
      expect(soloJuan.porRepartidor).toHaveLength(1);
      const oficina = await deZv({ repartidor: 'oficina' });
      expect(todas(oficina).map((v) => v.id)).toEqual([ids.v2]);
      expect(oficina.total.montoCentavos).toBe(7800);
    });
  });
});

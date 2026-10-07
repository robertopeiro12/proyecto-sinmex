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
import type { FacturaConVentas } from './../src/modules/ventas-cobranza/facturas.repository';

/** Asignar factura a notas de ventas (T-19): §7 del spec, de punta a punta. */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-fac-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-fac-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-fac-sin-${SUFIJO}`;

describe('Facturas (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let mxId: string;
  const usuarioIds: string[] = [];
  let usuarioGeneralId: string;
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  const clienteIds: string[] = [];
  let clienteA: string; // TJ
  let clienteB: string; // TJ
  let clienteMx: string;

  let folios = 0;
  let numeros = 0;
  /** Un numero de factura unico por llamada (≤ 30). */
  const numero = () => `F${++numeros}-${SUFIJO}`.slice(0, 30);

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
  ) => {
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

  const sembrarCliente = async (nombre: string, sucursalId: string) => {
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

  /** Venta de oficina viva, a credito, con factura `pendiente` salvo que se diga otra cosa. */
  const sembrarVenta = async (
    clienteId: string,
    extra: {
      monto?: string;
      status?: string;
      factura?: string;
      fecha?: string;
    } = {},
  ) => {
    const cliente = await db
      .selectFrom('cliente')
      .select('sucursal_id')
      .where('id', '=', clienteId)
      .executeTakeFirstOrThrow();
    const { id, folio } = await db
      .insertInto('venta_nota')
      .values({
        folio: `ZZF${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha: extra.fecha ?? '2024-04-01',
        cliente_id: clienteId,
        vendedor_id: null,
        monto_total: extra.monto ?? '100.00',
        num_nota: null,
        contado_credito: 'credito',
        semana: 14,
        mes: 4,
        status: extra.status ?? 'pendiente',
        sucursal_id: cliente.sucursal_id,
        origen: 'portal',
        capturo_usuario_id: usuarioGeneralId,
        factura: extra.factura ?? 'pendiente',
      })
      .returning(['id', 'folio'])
      .executeTakeFirstOrThrow();
    return { id, folio };
  };

  const asignar = (cookie: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/facturas/asignar')
      .set('Cookie', cookie)
      .send(cuerpo);

  const ventaPorId = (id: string) =>
    db
      .selectFrom('venta_nota')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

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

    usuarioGeneralId = await crearUsuario(
      LOGIN_GENERAL,
      'Administrador General',
      null,
    );
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', tjId);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);

    clienteA = await sembrarCliente('Cobach A', tjId);
    clienteB = await sembrarCliente('Tienda B', tjId);
    clienteMx = await sembrarCliente('Abarrotes MX', mxId);
  });

  afterAll(async () => {
    await db
      .updateTable('venta_nota')
      .set({
        factura: 'N/A',
        factura_id: null,
        factura_asignada_por_usuario_id: null,
      })
      .where('cliente_id', 'in', clienteIds)
      .execute();
    await db
      .deleteFrom('factura')
      .where('cliente_id', 'in', clienteIds)
      .execute();
    await db
      .deleteFrom('venta_nota')
      .where('cliente_id', 'in', clienteIds)
      .execute();
    await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  describe('por facturar', () => {
    it('lista las pendientes del cliente; con incluirNA tambien las N/A; nunca promociones ni eliminadas', async () => {
      const cliente = await sembrarCliente('Lista', tjId);
      const pendiente = await sembrarVenta(cliente);
      const na = await sembrarVenta(cliente, { factura: 'N/A' });
      await sembrarVenta(cliente, { status: 'promocion', monto: '0.00' });
      const eliminada = await sembrarVenta(cliente);
      await db
        .updateTable('venta_nota')
        .set({ deleted_at: new Date() })
        .where('id', '=', eliminada.id)
        .execute();

      const solo = await request(app.getHttpServer())
        .get(`/facturas/por-facturar?clienteId=${cliente}`)
        .set('Cookie', cookieGeneral)
        .expect(200);
      expect((solo.body as { id: string }[]).map((v) => v.id)).toEqual([
        pendiente.id,
      ]);

      const conNA = await request(app.getHttpServer())
        .get(`/facturas/por-facturar?clienteId=${cliente}&incluirNA=true`)
        .set('Cookie', cookieGeneral)
        .expect(200);
      expect((conNA.body as { id: string }[]).map((v) => v.id).sort()).toEqual(
        [pendiente.id, na.id].sort(),
      );
    });
  });

  describe('asignar', () => {
    it('asigna varias de un jalon y devuelve la factura con su total', async () => {
      const v1 = await sembrarVenta(clienteA, { monto: '100.00' });
      const v2 = await sembrarVenta(clienteA, { monto: '50.50' });
      const n = numero();
      const res = await asignar(cookieGeneral, {
        clienteId: clienteA,
        numero: n,
        ventaIds: [v1.id, v2.id],
      }).expect(201);
      const factura = res.body as FacturaConVentas;
      expect(factura).toMatchObject({
        numero: n,
        clienteId: clienteA,
        totalCentavos: 15050,
      });
      expect(factura.ventas.map((v) => v.id).sort()).toEqual(
        [v1.id, v2.id].sort(),
      );
      const fila = await ventaPorId(v1.id);
      expect(fila.factura).toBe('facturada');
      expect(fila.factura_id).toBe(factura.id);
      expect(fila.factura_asignada_por_usuario_id).toBe(usuarioGeneralId);
    });

    it('Review Focus 1: el mismo numero con otra capitalizacion y espacios se suma a la misma factura', async () => {
      const v1 = await sembrarVenta(clienteA);
      const v2 = await sembrarVenta(clienteA);
      const n = numero();
      const primera = (
        await asignar(cookieGeneral, {
          clienteId: clienteA,
          numero: n,
          ventaIds: [v1.id],
        }).expect(201)
      ).body as FacturaConVentas;
      const segunda = (
        await asignar(cookieGeneral, {
          clienteId: clienteA,
          numero: `  ${n.toLowerCase()} `,
          ventaIds: [v2.id],
        }).expect(201)
      ).body as FacturaConVentas;
      expect(segunda.id).toBe(primera.id);
      expect(segunda.ventas).toHaveLength(2);
    });

    it('Review Focus 3: ids repetidos cuentan una vez', async () => {
      const v = await sembrarVenta(clienteA);
      const res = await asignar(cookieGeneral, {
        clienteId: clienteA,
        numero: numero(),
        ventaIds: [v.id, v.id],
      }).expect(201);
      expect((res.body as FacturaConVentas).ventas).toHaveLength(1);
    });

    it('Review Focus 5: una venta N/A se puede asignar', async () => {
      const v = await sembrarVenta(clienteA, { factura: 'N/A' });
      await asignar(cookieGeneral, {
        clienteId: clienteA,
        numero: numero(),
        ventaIds: [v.id],
      }).expect(201);
      expect((await ventaPorId(v.id)).factura).toBe('facturada');
    });

    it('un numero que ya es de otro cliente es 409 y no asigna nada', async () => {
      const deA = await sembrarVenta(clienteA);
      const deB = await sembrarVenta(clienteB);
      const n = numero();
      await asignar(cookieGeneral, {
        clienteId: clienteA,
        numero: n,
        ventaIds: [deA.id],
      }).expect(201);
      const res = await asignar(cookieGeneral, {
        clienteId: clienteB,
        numero: n,
        ventaIds: [deB.id],
      }).expect(409);
      expect((res.body as { message: string }).message).toBe(
        `La factura ${n} ya está asignada a Cobach A ${SUFIJO}.`,
      );
      expect((await ventaPorId(deB.id)).factura).toBe('pendiente');
    });

    it.each([
      ['ya facturada', 'ya está en la factura'],
      ['de promocion', 'es de promoción ($0): no se factura.'],
      ['de otro cliente', 'no es de este cliente.'],
      ['eliminada', 'ya no existe o fue eliminada'],
    ])(
      'si una de las ventas esta %s es 409 y NINGUNA queda asignada',
      async (caso, mensaje) => {
        const buena = await sembrarVenta(clienteA);
        let mala: { id: string };
        if (caso === 'ya facturada') {
          mala = await sembrarVenta(clienteA);
          await asignar(cookieGeneral, {
            clienteId: clienteA,
            numero: numero(),
            ventaIds: [mala.id],
          }).expect(201);
        } else if (caso === 'de promocion') {
          mala = await sembrarVenta(clienteA, {
            status: 'promocion',
            monto: '0.00',
          });
        } else if (caso === 'de otro cliente') {
          mala = await sembrarVenta(clienteB);
        } else {
          mala = await sembrarVenta(clienteA);
          await db
            .updateTable('venta_nota')
            .set({ deleted_at: new Date() })
            .where('id', '=', mala.id)
            .execute();
        }
        const res = await asignar(cookieGeneral, {
          clienteId: clienteA,
          numero: numero(),
          ventaIds: [buena.id, mala.id],
        }).expect(409);
        expect((res.body as { message: string }).message).toContain(mensaje);
        expect((await ventaPorId(buena.id)).factura).toBe('pendiente');
      },
    );

    it('un numero en blanco es 400', async () => {
      const v = await sembrarVenta(clienteA);
      await asignar(cookieGeneral, {
        clienteId: clienteA,
        numero: '   ',
        ventaIds: [v.id],
      }).expect(400);
    });

    it('sin el permiso es 403', async () => {
      const v = await sembrarVenta(clienteA);
      await asignar(cookieSinPermiso, {
        clienteId: clienteA,
        numero: numero(),
        ventaIds: [v.id],
      }).expect(403);
    });

    it('Review Focus 4: un usuario de TJ no factura a un cliente de MX', async () => {
      const v = await sembrarVenta(clienteMx);
      await asignar(cookieTijuana, {
        clienteId: clienteMx,
        numero: numero(),
        ventaIds: [v.id],
      }).expect(403);
    });
  });

  /**
   * Hallazgo de la revision final: tras ESPERAR el bloqueo, Postgres relee solo
   * la fila bloqueada, no un `join` a `factura`. Se decide por `vn.factura_id`.
   *
   * Sincronizacion por bloqueos, no por tiempos: la transaccion A factura la
   * venta y NO confirma; la peticion arranca y se espera hasta que
   * `pg_blocking_pids` diga que esta bloqueada por A; entonces A confirma.
   */
  describe('carreras con una asignacion en vuelo', () => {
    const facturarSinConfirmarYCorrer = async (
      ventaId: string,
      peticion: () => Promise<request.Response>,
    ): Promise<{ res: request.Response; numeroA: string }> => {
      const numeroA = numero();
      let pendiente: Promise<request.Response> | undefined;
      await db.transaction().execute(async (trx) => {
        const { id: facturaA } = await trx
          .insertInto('factura')
          .values({
            numero: numeroA,
            cliente_id: clienteA,
            creado_por_usuario_id: usuarioGeneralId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .updateTable('venta_nota')
          .set({
            factura: 'facturada',
            factura_id: facturaA,
            factura_asignada_por_usuario_id: usuarioGeneralId,
          })
          .where('id', '=', ventaId)
          .execute();
        const pidA = (
          await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(
            trx,
          )
        ).rows[0].pid;

        // `.then` dispara la peticion de supertest.
        pendiente = peticion().then((r) => r);
        for (let i = 0; ; i++) {
          const { rows } = await sql<{ n: number }>`
            select count(*)::int as n from pg_stat_activity
             where ${pidA}::int = any(pg_blocking_pids(pid))
          `.execute(db);
          if (rows[0].n > 0) break;
          if (i > 400)
            throw new Error('La peticion nunca espero el bloqueo de A.');
          await new Promise((r) => setTimeout(r, 25));
        }
      });
      return { res: await pendiente!, numeroA };
    };

    it('asignar contra asignar: la segunda ve la factura de la primera (409)', async () => {
      const v = await sembrarVenta(clienteA);
      const nB = numero();
      const { res, numeroA } = await facturarSinConfirmarYCorrer(v.id, () =>
        asignar(cookieGeneral, {
          clienteId: clienteA,
          numero: nB,
          ventaIds: [v.id],
        }),
      );
      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toBe(
        `La venta ${v.folio} ya está en la factura ${numeroA}.`,
      );
      expect(
        await db
          .selectFrom('factura')
          .select('id')
          .where('numero', '=', nB)
          .executeTakeFirst(),
      ).toBeUndefined();
    });

    it('eliminar contra asignar: no borra una venta recien facturada (409)', async () => {
      const v = await sembrarVenta(clienteA);
      const { res, numeroA } = await facturarSinConfirmarYCorrer(v.id, () =>
        request(app.getHttpServer())
          .delete(`/ventas/${v.id}`)
          .set('Cookie', cookieGeneral),
      );
      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toBe(
        `Está en la factura ${numeroA}: quítala primero de la factura.`,
      );
      expect((await ventaPorId(v.id)).deleted_at).toBeNull();
    });
  });

  describe('renombrar', () => {
    const crear = async (clienteId: string) => {
      const v = await sembrarVenta(clienteId);
      return (
        await asignar(cookieGeneral, {
          clienteId,
          numero: numero(),
          ventaIds: [v.id],
        }).expect(201)
      ).body as FacturaConVentas;
    };
    const renombrar = (cookie: string, id: string, n: string) =>
      request(app.getHttpServer())
        .patch(`/facturas/${id}`)
        .set('Cookie', cookie)
        .send({ numero: n });

    it('cambia el numero y se ve en todas sus ventas', async () => {
      const f = await crear(clienteA);
      const n = numero();
      const res = await renombrar(cookieGeneral, f.id, n).expect(200);
      expect((res.body as FacturaConVentas).numero).toBe(n);
      const fila = await db
        .selectFrom('factura')
        .selectAll()
        .where('id', '=', f.id)
        .executeTakeFirstOrThrow();
      expect(fila.actualizado_por_usuario_id).toBe(usuarioGeneralId);
    });

    it('Review Focus 2: a si misma con otra capitalizacion se guarda', async () => {
      const f = await crear(clienteA);
      await renombrar(cookieGeneral, f.id, f.numero.toLowerCase()).expect(200);
    });

    it('a un numero de otro cliente es 409', async () => {
      const deA = await crear(clienteA);
      const deB = await crear(clienteB);
      const res = await renombrar(cookieGeneral, deB.id, deA.numero).expect(
        409,
      );
      expect((res.body as { message: string }).message).toBe(
        `La factura ${deA.numero} ya está asignada a Cobach A ${SUFIJO}.`,
      );
    });

    it('a otro numero del mismo cliente es 409', async () => {
      const f1 = await crear(clienteA);
      const f2 = await crear(clienteA);
      const res = await renombrar(cookieGeneral, f2.id, f1.numero).expect(409);
      expect((res.body as { message: string }).message).toBe(
        `El cliente ya tiene la factura ${f1.numero}: quita estas ventas y asígnalas a esa.`,
      );
    });

    it('Review Focus 4: un usuario de TJ no renombra una factura de MX', async () => {
      const f = await crear(clienteMx);
      await renombrar(cookieTijuana, f.id, numero()).expect(403);
    });
  });

  describe('quitar', () => {
    const quitar = (cookie: string, id: string, ventaIds: string[]) =>
      request(app.getHttpServer())
        .post(`/facturas/${id}/quitar`)
        .set('Cookie', cookie)
        .send({ ventaIds });

    it('quitar algunas las regresa a pendiente y la factura sigue', async () => {
      const v1 = await sembrarVenta(clienteA);
      const v2 = await sembrarVenta(clienteA);
      const f = (
        await asignar(cookieGeneral, {
          clienteId: clienteA,
          numero: numero(),
          ventaIds: [v1.id, v2.id],
        }).expect(201)
      ).body as FacturaConVentas;
      const res = await quitar(cookieGeneral, f.id, [v1.id]).expect(200);
      expect(
        (res.body as { factura: FacturaConVentas }).factura.ventas.map(
          (v) => v.id,
        ),
      ).toEqual([v2.id]);
      const fila = await ventaPorId(v1.id);
      expect(fila).toMatchObject({
        factura: 'pendiente',
        factura_id: null,
        factura_asignada_por_usuario_id: null,
      });
    });

    it('quitar todas borra la factura', async () => {
      const v = await sembrarVenta(clienteA);
      const f = (
        await asignar(cookieGeneral, {
          clienteId: clienteA,
          numero: numero(),
          ventaIds: [v.id],
        }).expect(201)
      ).body as FacturaConVentas;
      const res = await quitar(cookieGeneral, f.id, [v.id]).expect(200);
      expect(res.body).toEqual({ factura: null });
      expect(
        await db
          .selectFrom('factura')
          .select('id')
          .where('id', '=', f.id)
          .executeTakeFirst(),
      ).toBeUndefined();
    });

    it('una venta que no es de esa factura es 409 y nada cambia', async () => {
      const v1 = await sembrarVenta(clienteA);
      const v2 = await sembrarVenta(clienteA);
      const f = (
        await asignar(cookieGeneral, {
          clienteId: clienteA,
          numero: numero(),
          ventaIds: [v1.id],
        }).expect(201)
      ).body as FacturaConVentas;
      const res = await quitar(cookieGeneral, f.id, [v1.id, v2.id]).expect(409);
      expect((res.body as { message: string }).message).toContain(
        'no está en la factura',
      );
      expect((await ventaPorId(v1.id)).factura).toBe('facturada');
    });

    it('Review Focus 4: un usuario de TJ no quita ventas de una factura de MX', async () => {
      const v = await sembrarVenta(clienteMx);
      const f = (
        await asignar(cookieGeneral, {
          clienteId: clienteMx,
          numero: numero(),
          ventaIds: [v.id],
        }).expect(201)
      ).body as FacturaConVentas;
      await quitar(cookieTijuana, f.id, [v.id]).expect(403);
    });
  });

  describe('buscar', () => {
    it('por numero (sin mayusculas ni espacios) y por cliente', async () => {
      const v = await sembrarVenta(clienteB);
      const n = numero();
      const f = (
        await asignar(cookieGeneral, {
          clienteId: clienteB,
          numero: n,
          ventaIds: [v.id],
        }).expect(201)
      ).body as FacturaConVentas;
      const porNumero = await request(app.getHttpServer())
        .get(`/facturas?numero=${encodeURIComponent(` ${n.toLowerCase()} `)}`)
        .set('Cookie', cookieGeneral)
        .expect(200);
      expect((porNumero.body as FacturaConVentas[]).map((x) => x.id)).toEqual([
        f.id,
      ]);
      const porCliente = await request(app.getHttpServer())
        .get(`/facturas?clienteId=${clienteB}`)
        .set('Cookie', cookieGeneral)
        .expect(200);
      expect(
        (porCliente.body as FacturaConVentas[]).map((x) => x.id),
      ).toContain(f.id);
    });

    it('sin numero ni cliente es 400', async () => {
      await request(app.getHttpServer())
        .get('/facturas')
        .set('Cookie', cookieGeneral)
        .expect(400);
    });

    it('Review Focus 4: un usuario de TJ no ve facturas de MX', async () => {
      const v = await sembrarVenta(clienteMx);
      const n = numero();
      await asignar(cookieGeneral, {
        clienteId: clienteMx,
        numero: n,
        ventaIds: [v.id],
      }).expect(201);
      const res = await request(app.getHttpServer())
        .get(`/facturas?numero=${encodeURIComponent(n)}`)
        .set('Cookie', cookieTijuana)
        .expect(200);
      expect(res.body).toEqual([]);
    });
  });
});

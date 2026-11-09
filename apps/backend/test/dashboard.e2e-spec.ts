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
import { DashboardService } from './../src/modules/estadisticas/dashboard.service';
import type { Dashboard } from './../src/modules/estadisticas/reglas-flujo-diario';
import type { DetalleVendedorDia } from './../src/modules/estadisticas/reglas-detalle';
import { hoyEnTijuana } from './../src/modules/sincronizacion/operaciones';

const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
// Codigos que ordenan despues de TJ: varias suites toman "la primera sucursal por
// codigo" (auth-vendedor, prospectos, visita...) y, si fuera la nuestra, le meterian
// vendedores que rompen nuestra limpieza (FK de vendedor).
const CODIGO = 'ZW';
const CODIGO_OTRA = 'ZX';

describe('Dashboard (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  const vendedorIds: string[] = [];
  let idDb: string;
  let idOtra: string;
  let cookieGeneral: string;
  let cookieDb: string;
  let cookieOtra: string;
  let cookieSinPermiso: string;
  let generalId: string;
  let clienteId: string;
  let ana: string;
  let ajeno: string;

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

  const sucursal = async (codigo: string, nombre: string): Promise<string> =>
    (
      await db
        .insertInto('sucursal')
        .values({ codigo, nombre })
        .onConflict((oc) =>
          oc.column('codigo').doUpdateSet({ deleted_at: null }),
        )
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  const vendedor = async (nombre: string, sucursalId: string) => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-db-${vendedorIds.length + 1}-${SUFIJO}`,
        nombre: `${nombre} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  const venta = async (fecha: string, vendedorId: string, monto: string) => {
    const { id } = await db
      .insertInto('venta_nota')
      .values({
        folio:
          `ZDB${vendedorIds.length}${Math.random().toString(36).slice(2, 8)}${SUFIJO}`.slice(
            0,
            30,
          ),
        fecha,
        cliente_id: clienteId,
        vendedor_id: vendedorId,
        monto_total: monto,
        contado_credito: 'contado',
        semana: 1,
        mes: 1,
        status: 'pagada',
        sucursal_id: idDb,
        origen: 'portal',
        capturo_usuario_id: generalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('cobranza_abono')
      .values({
        venta_nota_id: id,
        vendedor_id: vendedorId,
        fecha_pago: fecha,
        fecha_operacion: fecha,
        monto,
        tipo: 'abono',
        saldo_pendiente: '0.00',
        metodo_pago: 'efectivo',
        origen: 'venta_contado',
      })
      .execute();
  };

  const pedir = (
    cookie: string,
    ruta: string,
    q: Record<string, string> = {},
  ) =>
    request(app.getHttpServer())
      .get(`/dashboard${ruta}?${new URLSearchParams(q).toString()}`)
      .set('Cookie', cookie);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    idDb = await sucursal(CODIGO, 'Prueba Dashboard');
    idOtra = await sucursal(CODIGO_OTRA, 'Prueba Dashboard Otra');
    generalId = await crearUsuario(
      `e2e-db-gen-${SUFIJO}`,
      'Administrador General',
      null,
    );
    await crearUsuario(`e2e-db-db-${SUFIJO}`, 'Administrador General', idDb);
    await crearUsuario(
      `e2e-db-otra-${SUFIJO}`,
      'Administrador General',
      idOtra,
    );
    await crearUsuario(`e2e-db-sin-${SUFIJO}`, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(`e2e-db-gen-${SUFIJO}`);
    cookieDb = await iniciarSesion(`e2e-db-db-${SUFIJO}`);
    cookieOtra = await iniciarSesion(`e2e-db-otra-${SUFIJO}`);
    cookieSinPermiso = await iniciarSesion(`e2e-db-sin-${SUFIJO}`);

    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    clienteId = (
      await db
        .insertInto('cliente')
        .values({
          nombre: `Cliente db ${SUFIJO}`,
          domicilio: 'Calle 1',
          telefono: '6640000000',
          tipo: 'cliente',
          lista_precio_id: lista.id,
          sucursal_id: idDb,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    clienteIds.push(clienteId);

    ana = await vendedor('Ana', idDb);
    ajeno = await vendedor('Ajeno', idOtra);
    // Ana: venta de hoy y una de mañana (la de mañana no cuenta hoy).
    await venta(hoyEnTijuana(), ana, '130.00');
    await venta('2099-01-01', ana, '999.00');
    // Ana tambien tiene un dia viejo que no debe salir.
    await venta('2018-05-01', ana, '77.00');
  });

  afterAll(async () => {
    await db
      .deleteFrom('ruta')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    await db
      .deleteFrom('cobranza_abono')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    await db
      .deleteFrom('venta_nota')
      .where('cliente_id', 'in', clienteIds)
      .execute();
    await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
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
    await db
      .deleteFrom('sucursal')
      .where('codigo', 'in', [CODIGO, CODIGO_OTRA])
      .execute();
    await app.close();
  });

  it('sin sesion 401; sin dashboard.ver 403; con el permiso 200 y fecha de hoy', async () => {
    await request(app.getHttpServer()).get('/dashboard').expect(401);
    await pedir(cookieSinPermiso, '').expect(403);
    await pedir(cookieSinPermiso, '/vendedor', { vendedor: ana }).expect(403);
    const r = (await pedir(cookieGeneral, '', { sucursal: CODIGO }).expect(200))
      .body as Dashboard;
    expect(r.fecha).toBe(hoyEnTijuana());
    expect(r.vendedores).toHaveLength(1);
    expect(r.vendedores[0]).toMatchObject({
      vendedorId: ana,
      montoCentavos: 13000,
      cobranzaCentavos: 13000,
      estatus: 'en_ruta',
    });
    expect(r.total).toMatchObject({ rutas: 1, enRuta: 1, terminaron: 0 });
  });

  it('el cliente no manda fecha: se ignora', async () => {
    const r = (
      await pedir(cookieGeneral, '', {
        sucursal: CODIGO,
        fecha: '2018-05-01',
      }).expect(200)
    ).body as Dashboard;
    expect(r.fecha).toBe(hoyEnTijuana());
  });

  it('atado a otra sucursal: pedir ZW es 403; sin parametro ve la suya', async () => {
    await pedir(cookieOtra, '', { sucursal: CODIGO }).expect(403);
    const r = (await pedir(cookieDb, '').expect(200)).body as Dashboard;
    expect(r.vendedores.map((v) => v.vendedorId)).toEqual([ana]);
  });

  it('detalle del vendedor de hoy; uno ajeno es 404', async () => {
    const r = (
      await pedir(cookieGeneral, '/vendedor', {
        vendedor: ana,
        sucursal: CODIGO,
      }).expect(200)
    ).body as DetalleVendedorDia;
    expect(r.fecha).toBe(hoyEnTijuana());
    expect(r.vendedorId).toBe(ana);
    await pedir(cookieDb, '/vendedor', { vendedor: ajeno }).expect(404);
    await pedir(cookieGeneral, '/vendedor', { vendedor: 'ana' }).expect(400);
  });

  it('servicio con ahora a las 23:30 del 15 en Tijuana: hoy es el 15', async () => {
    const ahora = new Date('2030-06-16T06:30:00Z');
    const dia15 = '2030-06-15';
    await venta(dia15, ana, '50.00');
    await venta('2030-06-16', ana, '70.00');
    const d = await app
      .get(DashboardService)
      .dashboard(generalId, { sucursal: CODIGO }, ahora);
    expect(d.fecha).toBe(dia15);
    expect(d.vendedores).toHaveLength(1);
    expect(d.vendedores[0].montoCentavos).toBe(5000);
    const det = await app
      .get(DashboardService)
      .detalle(generalId, { vendedor: ana, sucursal: CODIGO }, ahora);
    expect(det.fecha).toBe(dia15);
  });

  it('detalle con fecha: hoy y ayer valen; otro dia es 400', async () => {
    const ayer = new Date(`${hoyEnTijuana()}T12:00:00Z`);
    ayer.setUTCDate(ayer.getUTCDate() - 1);
    const fechaAyer = ayer.toISOString().slice(0, 10);
    const r = (
      await pedir(cookieGeneral, '/vendedor', {
        vendedor: ana,
        sucursal: CODIGO,
        fecha: fechaAyer,
      }).expect(200)
    ).body as DetalleVendedorDia;
    expect(r.fecha).toBe(fechaAyer);
    const h = (
      await pedir(cookieGeneral, '/vendedor', {
        vendedor: ana,
        sucursal: CODIGO,
        fecha: hoyEnTijuana(),
      }).expect(200)
    ).body as DetalleVendedorDia;
    expect(h.fecha).toBe(hoyEnTijuana());
    const malo = await pedir(cookieGeneral, '/vendedor', {
      vendedor: ana,
      sucursal: CODIGO,
      fecha: '2018-05-01',
    }).expect(400);
    expect(JSON.stringify(malo.body)).toContain(
      'La fecha no es válida para el Dashboard.',
    );
  });

  it('servicio a las 00:10 del 16: el detalle con la fecha del renglon (15) sigue siendo el 15', async () => {
    const ahora = new Date('2030-06-16T07:10:00Z');
    const det = await app
      .get(DashboardService)
      .detalle(
        generalId,
        { vendedor: ana, sucursal: CODIGO, fecha: '2030-06-15' },
        ahora,
      );
    expect(det.fecha).toBe('2030-06-15');
    expect(det.notas.map((n) => n.totalCentavos)).toEqual([5000]);
  });

  it('un vendedor inactivo o dado de baja con solo ruta hoy no sale; con una venta hoy, si', async () => {
    const hoy = hoyEnTijuana();
    const inactivo = await vendedor('Inactivo', idDb);
    const baja = await vendedor('Baja', idDb);
    await db
      .updateTable('vendedor')
      .set({ activo: false })
      .where('id', '=', inactivo)
      .execute();
    await db
      .updateTable('vendedor')
      .set({ deleted_at: new Date() })
      .where('id', '=', baja)
      .execute();
    for (const v of [inactivo, baja])
      await db
        .insertInto('ruta')
        .values({
          vendedor_id: v,
          cliente_id: clienteId,
          fecha: hoy,
          tipo: 'diaria',
          orden: 1,
        })
        .execute();

    const sinVenta = (
      await pedir(cookieGeneral, '', { sucursal: CODIGO }).expect(200)
    ).body as Dashboard;
    expect(sinVenta.vendedores.map((v) => v.vendedorId)).toEqual([ana]);

    // El Flujo diario (historia) si los muestra.
    const flujo = await request(app.getHttpServer())
      .get(
        `/reportes/flujo-diario?${new URLSearchParams({ desde: hoy, hasta: hoy, sucursal: CODIGO }).toString()}`,
      )
      .set('Cookie', cookieGeneral)
      .expect(200);
    const ids = (
      flujo.body as { porVendedor: { vendedorId: string }[] }
    ).porVendedor.map((v) => v.vendedorId);
    expect(ids).toEqual(expect.arrayContaining([inactivo, baja]));

    await venta(hoy, inactivo, '20.00');
    const conVenta = (
      await pedir(cookieGeneral, '', { sucursal: CODIGO }).expect(200)
    ).body as Dashboard;
    const fila = conVenta.vendedores.find((v) => v.vendedorId === inactivo);
    expect(fila).toMatchObject({ montoCentavos: 2000, clientesEnRuta: 1 });
    expect(conVenta.vendedores.map((v) => v.vendedorId)).not.toContain(baja);
  });

  describe('notas de papel entregadas', () => {
    let beto: string;
    const hoy = () => hoyEnTijuana();
    const menos = (dias: number) => {
      const d = new Date(`${hoyEnTijuana()}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - dias);
      return d.toISOString().slice(0, 10);
    };
    let nHoy: { id: string; folio: string };
    let nAyer: { id: string; folio: string };
    let nViejaFalsa: { id: string; folio: string };
    let nViejaPagada: { id: string; folio: string };
    let nViejaSinRevisar: { id: string; folio: string };
    let nContado: { id: string; folio: string };
    let nAjena: { id: string; folio: string };
    let nBorrada: { id: string; folio: string };
    let nFutura: { id: string; folio: string };

    const credito = async (
      fecha: string,
      vendedorId: string,
      monto: string,
      opciones: {
        abono?: string;
        contado?: boolean;
        papel?: boolean;
        borrada?: boolean;
        sucursalId?: string;
      } = {},
    ) => {
      const folio =
        `ZPE${Math.random().toString(36).slice(2, 8)}${SUFIJO}`.slice(0, 30);
      const { id } = await db
        .insertInto('venta_nota')
        .values({
          folio,
          fecha,
          cliente_id: clienteId,
          vendedor_id: vendedorId,
          monto_total: monto,
          contado_credito: opciones.contado ? 'contado' : 'credito',
          semana: 1,
          mes: 1,
          status: opciones.contado ? 'pagada' : 'pendiente',
          sucursal_id: opciones.sucursalId ?? idDb,
          origen: 'portal',
          capturo_usuario_id: generalId,
          deleted_at: opciones.borrada ? new Date() : null,
          ...(opciones.papel === undefined
            ? {}
            : {
                papel_entregado: opciones.papel,
                papel_revisado_en: new Date(),
              }),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (opciones.abono)
        await db
          .insertInto('cobranza_abono')
          .values({
            venta_nota_id: id,
            vendedor_id: vendedorId,
            fecha_pago: fecha,
            fecha_operacion: fecha,
            monto: opciones.abono,
            tipo: 'abono',
            saldo_pendiente: '0.00',
            metodo_pago: 'efectivo',
            origen: 'venta_contado',
          })
          .execute();
      return { id, folio };
    };

    const guardar = (cookie: string, body: unknown) =>
      request(app.getHttpServer())
        .put('/dashboard/notas-entregadas')
        .set('Cookie', cookie)
        .send(body as object);

    const papel = (id: string) =>
      db
        .selectFrom('venta_nota')
        .select([
          'papel_entregado',
          'papel_revisado_en',
          'papel_revisado_por_usuario_id',
          'updated_at',
        ])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

    beforeAll(async () => {
      beto = await vendedor('Beto', idDb);
      nHoy = await credito(hoy(), beto, '100.00');
      nAyer = await credito(menos(1), beto, '80.00', { abono: '30.00' });
      nViejaFalsa = await credito(menos(3), beto, '60.00', {
        papel: false,
        abono: '10.00',
      });
      nViejaPagada = await credito(menos(2), beto, '40.00', {
        papel: false,
        abono: '40.00',
      });
      nViejaSinRevisar = await credito(menos(2), beto, '45.00');
      nContado = await credito(hoy(), beto, '20.00', { contado: true });
      nBorrada = await credito(hoy(), beto, '25.00', { borrada: true });
      nFutura = await credito('2099-02-02', beto, '25.00');
      nAjena = await credito(hoy(), ajeno, '50.00', { sucursalId: idOtra });
    });

    it('sin nota_papel.revisar es 403', async () => {
      await guardar(cookieSinPermiso, {
        vendedor: beto,
        notas: [{ folio: nHoy.folio, entregada: true }],
      }).expect(403);
    });

    it('vendedor de otra sucursal es 404; vendedor invalido o sin notas es 400', async () => {
      await guardar(cookieDb, {
        vendedor: ajeno,
        notas: [{ folio: nAjena.folio, entregada: true }],
      }).expect(404);
      await guardar(cookieGeneral, {
        vendedor: 'beto',
        notas: [{ folio: nHoy.folio, entregada: true }],
      }).expect(400);
      await guardar(cookieGeneral, { vendedor: beto, notas: [] }).expect(400);
    });

    it.each([
      ['ajena', () => nAjena],
      ['de contado', () => nContado],
      ['borrada', () => nBorrada],
      ['de un dia futuro', () => nFutura],
    ])('una nota %s es 400 y no se guarda nada', async (_n, nota) => {
      const r = await guardar(cookieGeneral, {
        vendedor: beto,
        notas: [
          { folio: nHoy.folio, entregada: true },
          { folio: nota().folio, entregada: true },
        ],
      }).expect(400);
      expect(JSON.stringify(r.body)).toContain(
        `La nota ${nota().folio} no se puede revisar.`,
      );
      expect((await papel(nHoy.id)).papel_entregado).toBeNull();
    });

    it('guarda true y false sin tocar updated_at, y el detalle lo refleja', async () => {
      const antes = await papel(nHoy.id);
      const antesAyer = await papel(nAyer.id);
      await guardar(cookieGeneral, {
        vendedor: beto,
        notas: [
          { folio: nHoy.folio, entregada: true },
          { folio: nAyer.folio, entregada: false },
        ],
      }).expect(204);
      const despues = await papel(nHoy.id);
      expect(despues.papel_entregado).toBe(true);
      expect(despues.papel_revisado_en).not.toBeNull();
      expect(despues.papel_revisado_por_usuario_id).toBe(generalId);
      expect(despues.updated_at).toEqual(antes.updated_at);
      const ayer = await papel(nAyer.id);
      expect(ayer.papel_entregado).toBe(false);
      expect(ayer.updated_at).toEqual(antesAyer.updated_at);

      const d = (
        await pedir(cookieGeneral, '/vendedor', { vendedor: beto }).expect(200)
      ).body as DetalleVendedorDia;
      expect(d.notasCredito).toEqual([
        expect.objectContaining({ folio: nHoy.folio, entregada: true }),
      ]);
      const dAyer = (
        await pedir(cookieGeneral, '/vendedor', {
          vendedor: beto,
          fecha: menos(1),
        }).expect(200)
      ).body as DetalleVendedorDia;
      expect(dAyer.notasCredito).toEqual([
        expect.objectContaining({ folio: nAyer.folio, entregada: false }),
      ]);
    });

    it('una nota sin revisar sale con entregada null; se puede volver a marcar', async () => {
      const d = (
        await request(app.getHttpServer())
          .get(
            `/reportes/flujo-diario/vendedor?${new URLSearchParams({ fecha: menos(2), vendedor: beto }).toString()}`,
          )
          .set('Cookie', cookieGeneral)
          .expect(200)
      ).body as DetalleVendedorDia;
      const sin = d.notasCredito.find(
        (n) => n.folio === nViejaSinRevisar.folio,
      );
      expect(sin?.entregada).toBeNull();
      await guardar(cookieGeneral, {
        vendedor: beto,
        notas: [{ folio: nAyer.folio, entregada: true }],
      }).expect(204);
      expect((await papel(nAyer.id)).papel_entregado).toBe(true);
      // Se regresa a false para la prueba de abajo.
      await guardar(cookieGeneral, {
        vendedor: beto,
        notas: [{ folio: nAyer.folio, entregada: false }],
      }).expect(204);
    });

    it('guardar otra vez con los mismos valores no reescribe quien ni cuando; un cambio si', async () => {
      await guardar(cookieGeneral, {
        vendedor: beto,
        notas: [{ folio: nHoy.folio, entregada: true }],
      }).expect(204);
      const primera = await papel(nHoy.id);
      expect(primera.papel_entregado).toBe(true);
      // Otro usuario con el permiso guarda la misma revision.
      await guardar(cookieDb, {
        vendedor: beto,
        notas: [{ folio: nHoy.folio, entregada: true }],
      }).expect(204);
      const segunda = await papel(nHoy.id);
      expect(segunda.papel_revisado_en).toEqual(primera.papel_revisado_en);
      expect(segunda.papel_revisado_por_usuario_id).toBe(
        primera.papel_revisado_por_usuario_id,
      );
      // Cambiar el valor si registra a quien lo cambio.
      await guardar(cookieDb, {
        vendedor: beto,
        notas: [{ folio: nHoy.folio, entregada: false }],
      }).expect(204);
      const tercera = await papel(nHoy.id);
      expect(tercera.papel_entregado).toBe(false);
      expect(tercera.papel_revisado_por_usuario_id).not.toBe(
        primera.papel_revisado_por_usuario_id,
      );
      expect(tercera.updated_at).toEqual(primera.updated_at);
      // Se deja como estaba.
      await guardar(cookieGeneral, {
        vendedor: beto,
        notas: [{ folio: nHoy.folio, entregada: true }],
      }).expect(204);
    });

    it('notasNoEntregadas: a credito, de dias anteriores, entregada false y con pendiente, por fecha', async () => {
      const d = (
        await pedir(cookieGeneral, '/vendedor', { vendedor: beto }).expect(200)
      ).body as DetalleVendedorDia;
      expect(d.notasNoEntregadas).toEqual([
        {
          folio: nViejaFalsa.folio,
          cliente: `Cliente db ${SUFIJO}`,
          fecha: menos(3),
          totalCentavos: 6000,
          pendienteCentavos: 5000,
        },
        {
          folio: nAyer.folio,
          cliente: `Cliente db ${SUFIJO}`,
          fecha: menos(1),
          totalCentavos: 8000,
          pendienteCentavos: 5000,
        },
      ]);
      // Ni la pagada, ni la sin revisar, ni la de hoy.
      const folios = d.notasNoEntregadas.map((n) => n.folio);
      expect(folios).not.toContain(nViejaPagada.folio);
      expect(folios).not.toContain(nViejaSinRevisar.folio);
      expect(folios).not.toContain(nHoy.folio);
    });
  });
});

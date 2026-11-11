import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import { borrarCobrosDe, cobroParaNota } from './apoyo-cobros';
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
      .deleteFrom('nota_asignada')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    await db
      .deleteFrom('cobranza_abono')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    await borrarCobrosDe(db, clienteIds);
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

  describe('revision de notas en la tarde (Ruta Diaria parte 2)', () => {
    let ceci: string;
    let dora: string;
    const menos = (dias: number) => {
      const d = new Date(`${hoyEnTijuana()}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - dias);
      return d.toISOString().slice(0, 10);
    };
    type Nota = { id: string; folio: string };
    let asigCobrada: Nota;
    let asigAbonada: Nota;
    let asigSinPago: Nota;
    let nuevaHoy: Nota;
    let nuevaPagadaPorOtro: Nota;
    let nuevaYAsignada: Nota;
    let nuevaAyer: Nota;
    let asigAyer: Nota;
    let nuevaAntier: Nota;
    let asigAntier: Nota;
    let asigDeDora: Nota;
    let nuevaPerdida: Nota;
    let asigPerdida: Nota;
    let asigPerdidaHoy: Nota;

    /** Venta a credito viva de `vendedorId` en `fecha`, con un abono opcional. */
    const credito = async (
      fecha: string,
      vendedorId: string,
      monto: string,
      abono?: { monto: string; cobrador: string; fecha: string },
    ): Promise<Nota> => {
      const folio =
        `ZRN${Math.random().toString(36).slice(2, 8)}${SUFIJO}`.slice(0, 30);
      const { id } = await db
        .insertInto('venta_nota')
        .values({
          folio,
          fecha,
          cliente_id: clienteId,
          vendedor_id: vendedorId,
          monto_total: monto,
          contado_credito: 'credito',
          semana: 1,
          mes: 1,
          status: 'pendiente',
          sucursal_id: idDb,
          origen: 'portal',
          capturo_usuario_id: generalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (abono) {
        const cobroId = await cobroParaNota(db, id, {
          vendedorId: abono.cobrador,
          monto: abono.monto,
          fecha: abono.fecha,
        });
        const pendiente = (Number(monto) - Number(abono.monto)).toFixed(2);
        await db
          .insertInto('cobranza_abono')
          .values({
            venta_nota_id: id,
            cobro_id: cobroId,
            vendedor_id: abono.cobrador,
            fecha_pago: abono.fecha,
            fecha_operacion: abono.fecha,
            monto: abono.monto,
            tipo: 'abono',
            saldo_pendiente: pendiente,
            metodo_pago: 'efectivo',
            origen: 'cobro',
          })
          .execute();
        await db
          .updateTable('venta_nota')
          .set({ status: pendiente === '0.00' ? 'pagada' : 'abonado' })
          .where('id', '=', id)
          .execute();
      }
      return { id, folio };
    };

    /** Un pago posterior que deja la nota en 0. */
    const liquidar = async (nota: Nota, monto: string, cobrador: string) => {
      const fecha = hoyEnTijuana();
      const cobroId = await cobroParaNota(db, nota.id, {
        vendedorId: cobrador,
        monto,
        fecha,
      });
      await db
        .insertInto('cobranza_abono')
        .values({
          venta_nota_id: nota.id,
          cobro_id: cobroId,
          vendedor_id: cobrador,
          fecha_pago: fecha,
          fecha_operacion: fecha,
          monto,
          tipo: 'abono',
          saldo_pendiente: '0.00',
          metodo_pago: 'efectivo',
          origen: 'cobro',
        })
        .execute();
      await db
        .updateTable('venta_nota')
        .set({ status: 'pagada' })
        .where('id', '=', nota.id)
        .execute();
    };

    const perdida = (nota: Nota) =>
      db
        .updateTable('venta_nota')
        .set({ status: 'cuenta_perdida' })
        .where('id', '=', nota.id)
        .execute();

    const asignar = (nota: Nota, vendedorId: string, fecha: string) =>
      db
        .insertInto('nota_asignada')
        .values({
          venta_nota_id: nota.id,
          vendedor_id: vendedorId,
          fecha,
          asignada_por_usuario_id: generalId,
        })
        .execute();

    const papelAsignada = (nota: Nota, fecha: string) =>
      db
        .selectFrom('nota_asignada')
        .select([
          'papel_entregado',
          'papel_revisado_en',
          'papel_revisado_por_usuario_id',
        ])
        .where('venta_nota_id', '=', nota.id)
        .where('fecha', '=', fecha)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow();

    const papelVenta = async (nota: Nota) =>
      (
        await db
          .selectFrom('venta_nota')
          .select('papel_entregado')
          .where('id', '=', nota.id)
          .executeTakeFirstOrThrow()
      ).papel_entregado;

    const guardar = (cookie: string, body: unknown) =>
      request(app.getHttpServer())
        .put('/dashboard/notas-entregadas')
        .set('Cookie', cookie)
        .send(body as object);

    const detalle = async (fecha: string) =>
      (
        await pedir(cookieGeneral, '/vendedor', {
          vendedor: ceci,
          fecha,
        }).expect(200)
      ).body as DetalleVendedorDia;

    /** La columna "Notas de ventas" del renglon de Ceci en el Flujo diario. */
    const noEntregadasFlujo = async (fecha: string) => {
      const r = await request(app.getHttpServer())
        .get(
          `/reportes/flujo-diario?${new URLSearchParams({ desde: fecha, hasta: fecha, sucursal: CODIGO }).toString()}`,
        )
        .set('Cookie', cookieGeneral)
        .expect(200);
      const fila = (
        r.body as {
          porVendedor: {
            vendedorId: string;
            notasNoEntregadas: number | null;
          }[];
        }
      ).porVendedor.find((v) => v.vendedorId === ceci);
      if (!fila) throw new Error(`Ceci no tiene renglon el ${fecha}.`);
      return fila.notasNoEntregadas;
    };

    const ids = (ns: { ventaNotaId: string }[]) =>
      ns.map((n) => n.ventaNotaId).sort();

    beforeAll(async () => {
      ceci = await vendedor('Ceci', idDb);
      dora = await vendedor('Dora', idDb);
      const hoy = hoyEnTijuana();
      // Asignadas hoy a Ceci: una que ya se pago, una abonada y una sin pago.
      asigCobrada = await credito(menos(10), dora, '100.00', {
        monto: '100.00',
        cobrador: ceci,
        fecha: hoy,
      });
      asigAbonada = await credito(menos(10), dora, '90.00', {
        monto: '30.00',
        cobrador: ceci,
        fecha: hoy,
      });
      asigSinPago = await credito(menos(9), dora, '70.00');
      for (const n of [asigCobrada, asigAbonada, asigSinPago])
        await asignar(n, ceci, hoy);
      // Ventas a credito de Ceci hoy: una con saldo, una que pago Dora el mismo
      // dia y una que ademas le asignaron hoy (sale solo como asignada).
      nuevaHoy = await credito(hoy, ceci, '50.00');
      nuevaPagadaPorOtro = await credito(hoy, ceci, '40.00', {
        monto: '40.00',
        cobrador: dora,
        fecha: hoy,
      });
      nuevaYAsignada = await credito(hoy, ceci, '60.00');
      await asignar(nuevaYAsignada, ceci, hoy);
      // Ayer y antier.
      nuevaAyer = await credito(menos(1), ceci, '20.00');
      asigAyer = await credito(menos(12), dora, '25.00');
      await asignar(asigAyer, ceci, menos(1));
      nuevaAntier = await credito(menos(2), ceci, '35.00');
      asigAntier = await credito(menos(12), dora, '45.00');
      await asignar(asigAntier, ceci, menos(2));
      // Una asignada hoy a otra vendedora.
      asigDeDora = await credito(menos(12), ceci, '15.00');
      await asignar(asigDeDora, dora, hoy);
      // Cuenta perdida con saldo: no se pide (ni hoy ni hace 3 dias).
      asigPerdidaHoy = await credito(menos(12), dora, '55.00');
      await perdida(asigPerdidaHoy);
      await asignar(asigPerdidaHoy, ceci, hoy);
      nuevaPerdida = await credito(menos(3), ceci, '65.00');
      await perdida(nuevaPerdida);
      asigPerdida = await credito(menos(12), dora, '75.00');
      await perdida(asigPerdida);
      await asignar(asigPerdida, ceci, menos(3));
    });

    it('el detalle trae las tres listas: cobradas, por entregar (con abonadas) y nuevas con saldo', async () => {
      const d = await detalle(hoyEnTijuana());
      expect(d.asignadasCobradas).toEqual([
        {
          ventaNotaId: asigCobrada.id,
          folio: asigCobrada.folio,
          cliente: `Cliente db ${SUFIJO}`,
          totalCentavos: 10000,
          pendienteCentavos: 0,
          entregada: null,
        },
      ]);
      expect(ids(d.asignadasPorEntregar)).toEqual(
        [asigAbonada.id, asigSinPago.id, nuevaYAsignada.id].sort(),
      );
      expect(
        d.asignadasPorEntregar.find((n) => n.ventaNotaId === asigAbonada.id),
      ).toMatchObject({ pendienteCentavos: 6000, entregada: null });
      // Ni la que pago otro vendedor, ni la que tambien es asignada.
      expect(d.notasCredito).toEqual([
        {
          ventaNotaId: nuevaHoy.id,
          folio: nuevaHoy.folio,
          cliente: `Cliente db ${SUFIJO}`,
          totalCentavos: 5000,
          pendienteCentavos: 5000,
          entregada: null,
        },
      ]);
      expect(d.notasCredito.map((n) => n.folio)).not.toContain(
        nuevaPagadaPorOtro.folio,
      );
      // La asignada en cuenta perdida no sale en ninguna lista.
      const todas = [...d.asignadasCobradas, ...d.asignadasPorEntregar];
      expect(todas.map((n) => n.ventaNotaId)).not.toContain(asigPerdidaHoy.id);
    });

    it('cuenta perdida con saldo (asignada o nueva) no se pide y no vuelve null la columna', async () => {
      // Hace 3 dias: el Dashboard ya no lo da, el Flujo diario si.
      const d = (
        await request(app.getHttpServer())
          .get(
            `/reportes/flujo-diario/vendedor?${new URLSearchParams({ fecha: menos(3), vendedor: ceci }).toString()}`,
          )
          .set('Cookie', cookieGeneral)
          .expect(200)
      ).body as DetalleVendedorDia;
      expect(d.asignadasCobradas).toEqual([]);
      expect(d.asignadasPorEntregar).toEqual([]);
      expect(d.notasCredito).toEqual([]);
      expect(await noEntregadasFlujo(menos(3))).toBeNull();
    });

    it('sin revisar, la columna del Flujo diario y del Dashboard es null', async () => {
      expect(await noEntregadasFlujo(hoyEnTijuana())).toBeNull();
      const r = (
        await pedir(cookieGeneral, '', { sucursal: CODIGO }).expect(200)
      ).body as Dashboard;
      expect(
        r.vendedores.find((v) => v.vendedorId === ceci)?.notasNoEntregadas,
      ).toBeNull();
    });

    it('guarda asignadas y nuevas de hoy en una sola revision', async () => {
      await guardar(cookieGeneral, {
        vendedor: ceci,
        fecha: hoyEnTijuana(),
        notas: [{ folio: nuevaHoy.folio, entregada: false }],
        asignadas: [
          { ventaNotaId: asigAbonada.id, entregada: true },
          { ventaNotaId: asigSinPago.id, entregada: false },
          { ventaNotaId: nuevaYAsignada.id, entregada: true },
        ],
      }).expect(204);
      const sinPago = await papelAsignada(asigSinPago, hoyEnTijuana());
      expect(sinPago.papel_entregado).toBe(false);
      expect(sinPago.papel_revisado_en).not.toBeNull();
      expect(sinPago.papel_revisado_por_usuario_id).toBe(generalId);
      expect(
        (await papelAsignada(asigAbonada, hoyEnTijuana())).papel_entregado,
      ).toBe(true);
      expect(await papelVenta(nuevaHoy)).toBe(false);
      // La marca de la asignada no toca el papel de la venta.
      expect(await papelVenta(nuevaYAsignada)).toBeNull();

      const d = await detalle(hoyEnTijuana());
      expect(
        d.asignadasPorEntregar.map((n) => [n.ventaNotaId, n.entregada]).sort(),
      ).toEqual(
        [
          [asigAbonada.id, true],
          [asigSinPago.id, false],
          [nuevaYAsignada.id, true],
        ].sort(),
      );
      expect(d.notasCredito[0].entregada).toBe(false);
      // No entregadas: la nueva y una asignada.
      expect(await noEntregadasFlujo(hoyEnTijuana())).toBe(2);
      const r = (
        await pedir(cookieGeneral, '', { sucursal: CODIGO }).expect(200)
      ).body as Dashboard;
      expect(
        r.vendedores.find((v) => v.vendedorId === ceci)?.notasNoEntregadas,
      ).toBe(2);
    });

    it('todo o nada: una asignada de otra vendedora o de otro dia es 400 y no guarda', async () => {
      for (const ventaNotaId of [asigDeDora.id, asigAyer.id]) {
        await guardar(cookieGeneral, {
          vendedor: ceci,
          fecha: hoyEnTijuana(),
          notas: [{ folio: nuevaHoy.folio, entregada: true }],
          asignadas: [
            { ventaNotaId: asigSinPago.id, entregada: true },
            { ventaNotaId, entregada: true },
          ],
        }).expect(400);
      }
      expect(await papelVenta(nuevaHoy)).toBe(false);
      expect(
        (await papelAsignada(asigSinPago, hoyEnTijuana())).papel_entregado,
      ).toBe(false);
    });

    it('la asignada que no vale dice su folio en el 400', async () => {
      const r = await guardar(cookieGeneral, {
        vendedor: ceci,
        fecha: hoyEnTijuana(),
        notas: [],
        asignadas: [{ ventaNotaId: asigDeDora.id, entregada: true }],
      }).expect(400);
      expect(JSON.stringify(r.body)).toContain(
        `La nota ${asigDeDora.folio} no se puede revisar.`,
      );
    });

    it('una fecha vacia o con otro formato es 400 (no se toma como hoy)', async () => {
      for (const fecha of ['', '2026/11/11', '11-11-2026'])
        await guardar(cookieGeneral, {
          vendedor: ceci,
          fecha,
          notas: [{ folio: nuevaHoy.folio, entregada: true }],
        }).expect(400);
      expect(await papelVenta(nuevaHoy)).toBe(false);
    });

    it('con fecha, una nota nueva de otro dia es 400 (sin fecha se acepta, como antes)', async () => {
      const r = await guardar(cookieGeneral, {
        vendedor: ceci,
        fecha: hoyEnTijuana(),
        notas: [{ folio: nuevaAyer.folio, entregada: true }],
      }).expect(400);
      expect(JSON.stringify(r.body)).toContain(
        `La nota ${nuevaAyer.folio} no se puede revisar.`,
      );
      expect(await papelVenta(nuevaAyer)).toBeNull();
    });

    it('al dia siguiente se corrige lo de ayer; antier ya no (400)', async () => {
      await guardar(cookieGeneral, {
        vendedor: ceci,
        fecha: menos(1),
        notas: [{ folio: nuevaAyer.folio, entregada: true }],
        asignadas: [{ ventaNotaId: asigAyer.id, entregada: false }],
      }).expect(204);
      expect(await papelVenta(nuevaAyer)).toBe(true);
      expect((await papelAsignada(asigAyer, menos(1))).papel_entregado).toBe(
        false,
      );
      expect(await noEntregadasFlujo(menos(1))).toBe(1);
      const dAyer = await detalle(menos(1));
      expect(dAyer.asignadasPorEntregar).toEqual([
        expect.objectContaining({ ventaNotaId: asigAyer.id, entregada: false }),
      ]);
      expect(dAyer.notasCredito).toEqual([
        expect.objectContaining({ ventaNotaId: nuevaAyer.id, entregada: true }),
      ]);
      // Se corrige: ahora si la entrego.
      await guardar(cookieGeneral, {
        vendedor: ceci,
        fecha: menos(1),
        notas: [],
        asignadas: [{ ventaNotaId: asigAyer.id, entregada: true }],
      }).expect(204);
      expect(await noEntregadasFlujo(menos(1))).toBe(0);

      const r = await guardar(cookieGeneral, {
        vendedor: ceci,
        fecha: menos(2),
        notas: [{ folio: nuevaAntier.folio, entregada: true }],
        asignadas: [{ ventaNotaId: asigAntier.id, entregada: true }],
      }).expect(400);
      expect(JSON.stringify(r.body)).toContain(
        'Ese día ya no se puede revisar.',
      );
      expect(await papelVenta(nuevaAntier)).toBeNull();
      expect(
        (await papelAsignada(asigAntier, menos(2))).papel_entregado,
      ).toBeNull();
      // Antier quedo sin revisar.
      expect(await noEntregadasFlujo(menos(2))).toBeNull();
    });

    it('sin ninguna nota es 400; vendedor de otra sucursal es 404', async () => {
      await guardar(cookieGeneral, {
        vendedor: ceci,
        fecha: hoyEnTijuana(),
        notas: [],
        asignadas: [],
      }).expect(400);
      await guardar(cookieOtra, {
        vendedor: ceci,
        fecha: hoyEnTijuana(),
        notas: [],
        asignadas: [{ ventaNotaId: asigSinPago.id, entregada: true }],
      }).expect(404);
    });

    it('lo revisado como no entregado y pagado despues sigue en su lista y sigue contando', async () => {
      // De la revision de hoy: nuevaHoy y asigSinPago quedaron en "no".
      await liquidar(nuevaHoy, '50.00', dora);
      await liquidar(asigSinPago, '70.00', ceci);
      const d = await detalle(hoyEnTijuana());
      expect(d.notasCredito).toEqual([
        expect.objectContaining({
          ventaNotaId: nuevaHoy.id,
          pendienteCentavos: 0,
          entregada: false,
        }),
      ]);
      expect(d.asignadasCobradas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ventaNotaId: asigSinPago.id,
            pendienteCentavos: 0,
            entregada: false,
          }),
        ]),
      );
      expect(ids(d.asignadasPorEntregar)).not.toContain(asigSinPago.id);
      expect(await noEntregadasFlujo(hoyEnTijuana())).toBe(2);
    });
  });
});

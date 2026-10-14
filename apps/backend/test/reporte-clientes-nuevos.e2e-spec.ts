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
import type { ReporteClientesNuevos } from './../src/modules/estadisticas/reglas-clientes-nuevos';

const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const CODIGO = 'ZN';
const DESDE = '2018-05-01';
const HASTA = '2018-05-31';

describe('Reporte de Clientes nuevos (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  let idZn: string;
  let idTijuana: string;
  let altaId: string;
  let cookieGeneral: string;
  let cookieZn: string;
  let cookieSinPermiso: string;
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

  const sembrar = async (c: {
    nombre: string;
    sucursalId?: string;
    tipo?: 'cliente' | 'prospecto';
    creado: string; // ISO con zona
    alta?: string | null; // ISO con zona; null = sin alta guardada
    usuarioAlta?: string | null;
    baja?: boolean;
  }): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `${c.nombre} ${SUFIJO}`,
        domicilio: 'Calle 1',
        telefono: '6640000000',
        encargado: 'Enc',
        tipo: c.tipo ?? 'cliente',
        lista_precio_id: lista.id,
        sucursal_id: c.sucursalId ?? idZn,
        created_at: new Date(c.creado),
        alta_cliente_en: c.alta ? new Date(c.alta) : null,
        alta_cliente_usuario_id: c.usuarioAlta ?? null,
        deleted_at: c.baja ? new Date() : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return id;
  };

  const pedir = (cookie: string, q: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/reportes/clientes-nuevos?${new URLSearchParams(q).toString()}`)
      .set('Cookie', cookie);
  const deZn = async (): Promise<ReporteClientesNuevos> =>
    (
      await pedir(cookieGeneral, {
        desde: DESDE,
        hasta: HASTA,
        sucursal: CODIGO,
      }).expect(200)
    ).body as ReporteClientesNuevos;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    idZn = (
      await db
        .insertInto('sucursal')
        .values({ codigo: CODIGO, nombre: 'Prueba Clientes nuevos' })
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

    await crearUsuario(`e2e-cn-gen-${SUFIJO}`, 'Administrador General', null);
    await crearUsuario(`e2e-cn-zn-${SUFIJO}`, 'Administrador General', idZn);
    await crearUsuario(`e2e-cn-sin-${SUFIJO}`, 'Auxiliar Administrativo', null);
    altaId = await crearUsuario(
      `e2e-cn-alta-${SUFIJO}`,
      'Administrador General',
      null,
    );
    await db
      .updateTable('usuario')
      .set({ nombre: `Lupita ${SUFIJO}` })
      .where('id', '=', altaId)
      .execute();
    cookieGeneral = await iniciarSesion(`e2e-cn-gen-${SUFIJO}`);
    cookieZn = await iniciarSesion(`e2e-cn-zn-${SUFIJO}`);
    cookieSinPermiso = await iniciarSesion(`e2e-cn-sin-${SUFIJO}`);

    // Con alta guardada, a media manana de Tijuana (17:00 UTC).
    ids.conAlta = await sembrar({
      nombre: 'Con alta',
      creado: '2018-05-03T17:00:00Z',
      alta: '2018-05-03T17:00:00Z',
      usuarioAlta: altaId,
    });
    // Cliente viejo sin alta guardada: usa created_at; usuario null.
    ids.viejo = await sembrar({
      nombre: 'Viejo',
      creado: '2018-05-04T17:00:00Z',
    });
    // Prospecto creado en abril y convertido el 10 de mayo: cuenta el 10.
    ids.convertido = await sembrar({
      nombre: 'Convertido',
      creado: '2018-04-20T17:00:00Z',
      alta: '2018-05-10T17:00:00Z',
      usuarioAlta: altaId,
    });
    // Prospecto sin convertir: no aparece.
    ids.prospecto = await sembrar({
      nombre: 'Prospecto',
      tipo: 'prospecto',
      creado: '2018-05-05T17:00:00Z',
    });
    // Dado de baja despues: aparece marcado.
    ids.baja = await sembrar({
      nombre: 'De baja',
      creado: '2018-05-06T17:00:00Z',
      alta: '2018-05-06T17:00:00Z',
      usuarioAlta: altaId,
      baja: true,
    });
    // 23:30 del 31 de mayo en Tijuana (PDT, UTC-7) = 06:30 UTC del 1 de junio: cuenta el 31 (Review Focus 1).
    ids.medianoche = await sembrar({
      nombre: 'Medianoche',
      creado: '2018-06-01T06:30:00Z',
      alta: '2018-06-01T06:30:00Z',
    });
    // 00:30 del 1 de mayo en Tijuana = 07:30 UTC del 1 de mayo: cuenta el 1 (dentro).
    ids.inicio = await sembrar({
      nombre: 'Inicio',
      creado: '2018-05-01T07:30:00Z',
      alta: '2018-05-01T07:30:00Z',
    });
    // 23:30 del 30 de abril en Tijuana = 06:30 UTC del 1 de mayo: cuenta el 30 de abril (fuera).
    ids.abril = await sembrar({
      nombre: 'Abril',
      creado: '2018-05-01T06:30:00Z',
      alta: '2018-05-01T06:30:00Z',
    });
    // Otra sucursal.
    ids.tj = await sembrar({
      nombre: 'Tijuana',
      sucursalId: idTijuana,
      creado: '2018-05-03T17:00:00Z',
      alta: '2018-05-03T17:00:00Z',
    });
  });

  afterAll(async () => {
    await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await db.deleteFrom('sucursal').where('codigo', '=', CODIGO).execute();
    await app.close();
  });

  it('sin sesion 401; sin reportes.ver 403; rango invalido, invertido o > 1 ano 400', async () => {
    await request(app.getHttpServer())
      .get(`/reportes/clientes-nuevos?desde=${DESDE}&hasta=${HASTA}`)
      .expect(401);
    await pedir(cookieSinPermiso, { desde: DESDE, hasta: HASTA }).expect(403);
    await pedir(cookieGeneral, { desde: '2018-02-30', hasta: HASTA }).expect(
      400,
    );
    await pedir(cookieGeneral, { desde: HASTA, hasta: DESDE }).expect(400);
    await pedir(cookieGeneral, { desde: '2017-01-01', hasta: HASTA }).expect(
      400,
    );
  });

  it('atado a ZN: "todas" o nada le da ZN; pedir TJ es 403', async () => {
    for (const q of [{}, { sucursal: 'todas' }]) {
      const r = (
        await pedir(cookieZn, { desde: DESDE, hasta: HASTA, ...q }).expect(200)
      ).body as ReporteClientesNuevos;
      const ids2 = r.clientes.map((x) => x.id);
      expect(ids2).toContain(ids.conAlta);
      expect(ids2).not.toContain(ids.tj);
    }
    await pedir(cookieZn, {
      desde: DESDE,
      hasta: HASTA,
      sucursal: 'TJ',
    }).expect(403);
  });

  it('universo, fecha de Tijuana, usuario y baja (Review Focus 1-3)', async () => {
    const r = await deZn();
    const porId = new Map(r.clientes.map((x) => [x.id, x]));
    expect([...porId.keys()].sort()).toEqual(
      [
        ids.conAlta,
        ids.viejo,
        ids.convertido,
        ids.baja,
        ids.medianoche,
        ids.inicio,
      ].sort(),
    );
    expect(r.total).toBe(6);
    expect(porId.get(ids.conAlta)).toMatchObject({
      fechaAlta: '2018-05-03',
      usuario: `Lupita ${SUFIJO}`,
      dadoDeBaja: false,
      sucursalCodigo: CODIGO,
      listaPrecio: 'Lista 1',
      telefono: '6640000000',
      encargado: 'Enc',
      tipoNegocio: null,
    });
    expect(porId.get(ids.viejo)).toMatchObject({
      fechaAlta: '2018-05-04',
      usuario: null,
    });
    expect(porId.get(ids.convertido)).toMatchObject({
      fechaAlta: '2018-05-10',
      usuario: `Lupita ${SUFIJO}`,
    });
    expect(porId.get(ids.baja)).toMatchObject({ dadoDeBaja: true });
    expect(porId.get(ids.medianoche)?.fechaAlta).toBe('2018-05-31');
    expect(porId.get(ids.inicio)?.fechaAlta).toBe('2018-05-01');
    expect(r.clientes.map((x) => x.fechaAlta)).toEqual(
      [...r.clientes.map((x) => x.fechaAlta)].sort(),
    );
  });
});

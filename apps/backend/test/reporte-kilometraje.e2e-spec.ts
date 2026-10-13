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
import type { ReporteKilometraje } from './../src/modules/estadisticas/reglas-kilometraje';

// Mismo patron que vehiculos.e2e-spec.ts: SUFIJO con PID para que las suites
// en paralelo no se pisen.
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const PREFIJO = `ZZ-e2e-km-${SUFIJO}`;
const PLACA = `K${(Date.now() % 36 ** 5).toString(36)}${process.pid.toString(36)}`;

// Fechas de 2019: ninguna otra suite siembra jornadas ahi. Aun asi, las
// aserciones filtran por los vehiculos de esta suite (o piden `vehiculo=`),
// porque el reporte es por sucursal y otra suite podria sembrar en TJ.
describe('Reporte de kilometraje (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const vendedorIds: string[] = [];
  const vehiculoIds: string[] = [];
  let idTijuana: string;
  let idMexicali: string;
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let vehA: string; // TJ, activo
  let vehB: string; // TJ, desactivado
  let vehMx: string; // MX
  let vehC: string; // TJ, dos jornadas el mismo dia
  let juan: string;
  let pedro: string;
  let ana: string; // MX

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

  /** `Auxiliar Administrativo` esta vacio de permisos: sirve como "sin reportes.ver". */
  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ): Promise<void> => {
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
  };

  const sembrarVendedor = async (
    nombre: string,
    sucursalId: string,
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-km-${vendedorIds.length + 1}-${SUFIJO}`,
        nombre,
        password_hash: 'x',
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  const sembrarVehiculo = async (
    nombre: string,
    sucursalId: string,
    activo = true,
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vehiculo')
      .values({
        nombre: `${PREFIJO} ${nombre}`,
        placas: `${PLACA}${vehiculoIds.length}`,
        sucursal_id: sucursalId,
        km_inicial: 0,
        activo,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vehiculoIds.push(id);
    return id;
  };

  /** Una jornada cerrada a las 22:00 UTC de su dia (14:00 de Tijuana). */
  const sembrarJornada = async (j: {
    vendedorId: string;
    vehiculoId: string;
    sucursalId: string;
    fecha: string;
    kmInicial: number;
    kmFinal: number;
    borrada?: boolean;
    /** Instante de cierre; por omision, las 22:00 UTC de su dia. */
    cerradaEn?: string;
    /** Id fijo, para forzar un orden por id distinto al de cierre. */
    id?: string;
  }): Promise<void> => {
    await db
      .insertInto('jornada')
      .values({
        ...(j.id ? { id: j.id } : {}),
        vendedor_id: j.vendedorId,
        vehiculo_id: j.vehiculoId,
        sucursal_id: j.sucursalId,
        fecha: j.fecha,
        km_inicial: j.kmInicial,
        km_final: j.kmFinal,
        abierta_en: `${j.fecha}T15:00:00Z`,
        cerrada_en: j.cerradaEn ?? `${j.fecha}T22:00:00Z`,
        ...(j.borrada ? { deleted_at: `${j.fecha}T23:00:00Z` } : {}),
      })
      .execute();
  };

  const pedirReporte = (cookie: string, query: string) =>
    request(app.getHttpServer())
      .get(`/reportes/kilometraje?${query}`)
      .set('Cookie', cookie);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    idTijuana = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;
    idMexicali = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'MX')
        .executeTakeFirstOrThrow()
    ).id;

    await crearUsuario(`e2e-km-gen-${SUFIJO}`, 'Administrador General', null);
    await crearUsuario(
      `e2e-km-tj-${SUFIJO}`,
      'Administrador General',
      idTijuana,
    );
    await crearUsuario(`e2e-km-sin-${SUFIJO}`, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(`e2e-km-gen-${SUFIJO}`);
    cookieTijuana = await iniciarSesion(`e2e-km-tj-${SUFIJO}`);
    cookieSinPermiso = await iniciarSesion(`e2e-km-sin-${SUFIJO}`);

    juan = await sembrarVendedor(`Juan ${SUFIJO}`, idTijuana);
    pedro = await sembrarVendedor(`Pedro ${SUFIJO}`, idTijuana);
    ana = await sembrarVendedor(`Ana ${SUFIJO}`, idMexicali);
    vehA = await sembrarVehiculo('A', idTijuana);
    vehB = await sembrarVehiculo('B', idTijuana, false);
    vehMx = await sembrarVehiculo('MX', idMexicali);
    vehC = await sembrarVehiculo('C', idTijuana);

    // Vehiculo A: 01/03 fuera del rango que se consulta (desde 05/03),
    // 03/03 BORRADA (Review Focus 2: no cuenta como anterior), 05/03 con salto
    // contra la del 01/03, 06/03 sin salto.
    await sembrarJornada({
      vendedorId: juan,
      vehiculoId: vehA,
      sucursalId: idTijuana,
      fecha: '2019-03-01',
      kmInicial: 10000,
      kmFinal: 10250.5,
    });
    await sembrarJornada({
      vendedorId: pedro,
      vehiculoId: vehA,
      sucursalId: idTijuana,
      fecha: '2019-03-03',
      kmInicial: 10300,
      kmFinal: 10399,
      borrada: true,
    });
    await sembrarJornada({
      vendedorId: pedro,
      vehiculoId: vehA,
      sucursalId: idTijuana,
      fecha: '2019-03-05',
      kmInicial: 10400,
      kmFinal: 10520,
    });
    await sembrarJornada({
      vendedorId: juan,
      vehiculoId: vehA,
      sucursalId: idTijuana,
      fecha: '2019-03-06',
      kmInicial: 10520,
      kmFinal: 10600,
    });
    // Vehiculo C: EMPATE de fecha. Se siembra primero la que cerro DESPUES, para
    // que el orden por id (fijado aqui: el de Pedro, que cierra despues, tiene el id menor) no sea el de cierre y la prueba distinga.
    await sembrarJornada({
      vendedorId: pedro,
      vehiculoId: vehC,
      sucursalId: idTijuana,
      fecha: '2019-04-02',
      kmInicial: 300,
      kmFinal: 340,
      cerradaEn: '2019-04-02T23:00:00Z',
      id: '00000000-0000-4000-8000-0000000000c1',
    });
    await sembrarJornada({
      vendedorId: juan,
      vehiculoId: vehC,
      sucursalId: idTijuana,
      fecha: '2019-04-02',
      kmInicial: 100,
      kmFinal: 150,
      cerradaEn: '2019-04-02T20:00:00Z',
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffc2',
    });
    // Vehiculo B (desactivado): una jornada.
    await sembrarJornada({
      vendedorId: juan,
      vehiculoId: vehB,
      sucursalId: idTijuana,
      fecha: '2019-03-10',
      kmInicial: 500,
      kmFinal: 560,
    });
    // Vehiculo de MX.
    await sembrarJornada({
      vendedorId: ana,
      vehiculoId: vehMx,
      sucursalId: idMexicali,
      fecha: '2019-03-07',
      kmInicial: 2000,
      kmFinal: 2100,
    });
  });

  afterAll(async () => {
    if (vehiculoIds.length > 0) {
      await db
        .deleteFrom('jornada')
        .where('vehiculo_id', 'in', vehiculoIds)
        .execute();
      await db.deleteFrom('vehiculo').where('id', 'in', vehiculoIds).execute();
    }
    if (vendedorIds.length > 0) {
      await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
    }
    if (usuarioIds.length > 0) {
      await db
        .deleteFrom('sesion_refresh')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await app.close();
  });

  it('sin reportes.ver responde 403', async () => {
    await pedirReporte(
      cookieSinPermiso,
      'desde=2019-03-01&hasta=2019-03-31',
    ).expect(403);
  });

  it('agrupa por vehiculo, en decimas, con el salto contra la anterior fuera del rango y sin contar la borrada', async () => {
    const res = await pedirReporte(
      cookieGeneral,
      `desde=2019-03-05&hasta=2019-03-31&vehiculo=${vehA}`,
    ).expect(200);
    const reporte = res.body as ReporteKilometraje;

    expect(reporte.vehiculos).toHaveLength(1);
    const [v] = reporte.vehiculos;
    expect(v).toMatchObject({
      vehiculoId: vehA,
      nombre: `${PREFIJO} A`,
      activo: true,
    });
    expect(v.jornadas).toEqual([
      {
        jornadaId: expect.any(String) as string,
        fecha: '2019-03-05',
        vendedor: `Pedro ${SUFIJO}`,
        kmInicialDecimas: 104000,
        kmFinalDecimas: 105200,
        kilometrosDecimas: 1200,
        // 10,400.0 − 10,250.5 = 149.5 km: contra el 01/03, no contra la borrada del 03/03.
        saltoDecimas: 1495,
        fechaAnterior: '2019-03-01',
      },
      {
        jornadaId: expect.any(String) as string,
        fecha: '2019-03-06',
        vendedor: `Juan ${SUFIJO}`,
        kmInicialDecimas: 105200,
        kmFinalDecimas: 106000,
        kilometrosDecimas: 800,
        saltoDecimas: 0,
        fechaAnterior: '2019-03-05',
      },
    ]);
    expect(v.totalKilometrosDecimas).toBe(2000);
    expect(v.totalSaltoDecimas).toBe(1495);
    expect(reporte.totalKilometrosDecimas).toBe(2000);
  });

  it('la primera jornada de un vehiculo no tiene salto y un vehiculo desactivado aparece', async () => {
    const res = await pedirReporte(
      cookieGeneral,
      'desde=2019-03-01&hasta=2019-03-31&sucursal=TJ',
    ).expect(200);
    const reporte = res.body as ReporteKilometraje;
    const a = reporte.vehiculos.find((v) => v.vehiculoId === vehA);
    const b = reporte.vehiculos.find((v) => v.vehiculoId === vehB);
    expect(a?.jornadas.map((j) => j.fecha)).toEqual([
      '2019-03-01',
      '2019-03-05',
      '2019-03-06',
    ]);
    expect(a?.jornadas[0].saltoDecimas).toBeNull();
    expect(a?.jornadas[0].kmFinalDecimas).toBe(102505);
    expect(b).toMatchObject({ activo: false, totalKilometrosDecimas: 600 });
    expect(reporte.vehiculos.some((v) => v.vehiculoId === vehMx)).toBe(false);
  });

  it('General con sucursal=MX ve solo MX; un usuario de TJ no ve MX ni puede pedirla', async () => {
    const mx = (
      await pedirReporte(
        cookieGeneral,
        'desde=2019-03-01&hasta=2019-03-31&sucursal=MX',
      ).expect(200)
    ).body as ReporteKilometraje;
    expect(mx.vehiculos.some((v) => v.vehiculoId === vehMx)).toBe(true);
    expect(mx.vehiculos.some((v) => v.vehiculoId === vehA)).toBe(false);

    const tj = (
      await pedirReporte(
        cookieTijuana,
        'desde=2019-03-01&hasta=2019-03-31',
      ).expect(200)
    ).body as ReporteKilometraje;
    expect(tj.vehiculos.some((v) => v.vehiculoId === vehA)).toBe(true);
    expect(tj.vehiculos.some((v) => v.vehiculoId === vehMx)).toBe(false);

    // Pedir el vehiculo de MX por id desde TJ no revela nada.
    const ajeno = (
      await pedirReporte(
        cookieTijuana,
        `desde=2019-03-01&hasta=2019-03-31&vehiculo=${vehMx}`,
      ).expect(200)
    ).body as ReporteKilometraje;
    expect(ajeno.vehiculos).toEqual([]);

    await pedirReporte(
      cookieTijuana,
      'desde=2019-03-01&hasta=2019-03-31&sucursal=MX',
    ).expect(403);
  });

  it('con dos jornadas el mismo dia ordena por cerrada_en y el salto va contra la que cerro antes', async () => {
    const res = await pedirReporte(
      cookieGeneral,
      `desde=2019-04-01&hasta=2019-04-30&vehiculo=${vehC}`,
    ).expect(200);
    const [v] = (res.body as ReporteKilometraje).vehiculos;
    expect(v.jornadas.map((j) => j.vendedor)).toEqual([
      `Juan ${SUFIJO}`,
      `Pedro ${SUFIJO}`,
    ]);
    expect(v.jornadas[0].saltoDecimas).toBeNull();
    // 300.0 - 150.0 = 150.0 km contra la de Juan (cerro 20:00), no al reves.
    expect(v.jornadas[1]).toMatchObject({
      saltoDecimas: 1500,
      fechaAnterior: '2019-04-02',
    });
  });

  it.each([
    [
      'desde=2019-3-1&hasta=2019-03-31',
      'La fecha "desde" debe tener el formato AAAA-MM-DD.',
    ],
    ['hasta=2019-03-31', 'La fecha "desde" debe tener el formato AAAA-MM-DD.'],
    [
      'desde=2019-02-30&hasta=2019-03-31',
      'La fecha "desde" no es una fecha válida.',
    ],
    [
      'desde=2019-03-31&hasta=2019-03-01',
      'La fecha "desde" no puede ser posterior a "hasta".',
    ],
    ['desde=2019-01-01&hasta=2020-01-02', 'El rango no puede pasar de un año.'],
    [
      'desde=2019-03-01&hasta=2019-03-31&vehiculo=no-es-uuid',
      'El vehículo no es válido.',
    ],
  ])('400 con %s', async (query, mensaje) => {
    const res = await pedirReporte(cookieGeneral, query).expect(400);
    const cuerpo = res.body as { message: string | string[] };
    const mensajes = Array.isArray(cuerpo.message)
      ? cuerpo.message
      : [cuerpo.message];
    expect(mensajes).toContain(mensaje);
  });

  it('un año exacto pasa (Review Focus 4)', async () => {
    await pedirReporte(
      cookieGeneral,
      'desde=2019-01-01&hasta=2020-01-01',
    ).expect(200);
  });
});

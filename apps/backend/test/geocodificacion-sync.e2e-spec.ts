import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
import { GEOCODIFICADOR } from './../src/modules/integraciones/geocodificacion/geocodificador';
import {
  CONTRATO_ACTUAL,
  type RespuestaPull,
  type RespuestaPush,
} from './../src/modules/sincronizacion/contrato';
import {
  COORDENADA_FALSA,
  GeocodificadorDePrueba,
  esperarHasta,
  pausa,
} from './apoyo-geocodificador';

/**
 * T-72 (D2, D3, D5) por el cable: el alta de prospecto con `domicilio` y sin
 * GPS se geocodifica DESPUES del commit, sin que el push espere, y la
 * coordenada baja en el pull. Geocodificador FALSO: ninguna prueba llama a
 * Google.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN = `e2e-geo-${SUFIJO}`;
const PASSWORD = 'contrasena-del-vendedor';
const PREFIJO = `ZZ-geo-${SUFIJO}`;
const FECHA = '2026-10-19';

interface FilaCliente {
  domicilio: string | null;
  lat: string | null;
  lng: string | null;
  ubicacion_origen: string | null;
}

describe('Geocodificación de prospectos por el push (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const falso = new GeocodificadorDePrueba();
  let vendedorId: string;
  let tipoNegocioBorradoId: string;
  let bearer: string;
  let consecutivo = 0;

  const direccion = (nombre: string) => `${PREFIJO} ${nombre} ${++consecutivo}`;

  const push = async (operaciones: unknown[]): Promise<RespuestaPush> => {
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ contrato: CONTRATO_ACTUAL, operaciones })
      .expect(200);
    return res.body as RespuestaPush;
  };

  const pull = async (): Promise<RespuestaPull> => {
    const res = await request(app.getHttpServer())
      .get(`/sync/pull?contrato=${CONTRATO_ACTUAL}`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    return res.body as RespuestaPull;
  };

  /** Un alta de prospecto; `datos` pisa los de por defecto. */
  const alta = (datos: Record<string, unknown> = {}) => ({
    clave: randomUUID(),
    tipo: 'prospecto',
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T18:03:22.000Z`,
    datos: {
      nombre: `${PREFIJO} prospecto ${++consecutivo}`,
      telefono: '6641112233',
      encargado: 'Don Aaron',
      tipo_negocio_id: null,
      comentarios: null,
      lat: null,
      lng: null,
      foto: null,
      ...datos,
    },
  });

  const fila = (id: string): Promise<FilaCliente> =>
    db
      .selectFrom('cliente')
      .select(['domicilio', 'lat', 'lng', 'ubicacion_origen'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GEOCODIFICADOR)
      .useValue(falso)
      .compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    const sucursal = await db
      .selectFrom('sucursal')
      .select('id')
      .where('codigo', '=', 'TJ')
      .executeTakeFirstOrThrow();
    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Vendedor geocodificacion',
          password_hash: await new PasswordService().hashear(PASSWORD),
          sucursal_id: sucursal.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    tipoNegocioBorradoId = (
      await db
        .insertInto('tipo_negocio')
        .values({ nombre: `${PREFIJO} Ciber`, deleted_at: new Date() })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const login = await request(app.getHttpServer())
      .post('/auth/app/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);
    bearer = (login.body as { tokenAcceso: string }).tokenAcceso;
  });

  afterAll(async () => {
    // Que ningun intento en segundo plano escriba despues del borrado.
    await pausa(300);
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db
      .deleteFrom('cliente')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db
      .deleteFrom('tipo_negocio')
      .where('id', '=', tipoNegocioBorradoId)
      .execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
    await app.close();
  });

  it('con domicilio y sin GPS: se guarda la direccion, se geocodifica y el pull la baja', async () => {
    const domicilio = direccion('Av. Revolución');
    const op = alta({ domicilio: `  ${domicilio}  ` });

    const r = await push([op]);
    expect(r.resultados[0]).toMatchObject({ estado: 'aplicada' });

    const f = await esperarHasta(
      () => fila(op.clave),
      (x) => x.lat !== null,
    );
    expect(f.domicilio).toBe(domicilio);
    expect(Number(f.lat)).toBe(COORDENADA_FALSA.lat);
    expect(Number(f.lng)).toBe(COORDENADA_FALSA.lng);
    expect(f.ubicacion_origen).toBe('geocodificada');
    expect(falso.vecesCon(domicilio)).toBe(1);

    const cliente = (await pull()).catalogos.clientes.find(
      (c) => c.id === op.clave,
    );
    expect(cliente).toMatchObject({
      domicilio,
      lat: COORDENADA_FALSA.lat,
      lng: COORDENADA_FALSA.lng,
      ubicacion_origen: 'geocodificada',
    });
  });

  it('el push responde sin esperar a Google', async () => {
    const domicilio = direccion('Calle lenta');
    const liberar = falso.retener(domicilio, {
      estado: 'ok',
      ...COORDENADA_FALSA,
    });
    const op = alta({ domicilio });

    // El falso no contesta hasta que se libere: si el push esperara a Google,
    // esta llamada no volveria (y la prueba caeria por tiempo).
    const r = await push([op]);

    expect(r.resultados[0]).toMatchObject({ estado: 'aplicada' });
    await esperarHasta(
      () => Promise.resolve(falso.vecesCon(domicilio)),
      (veces) => veces === 1,
    );
    expect((await fila(op.clave)).lat).toBeNull();

    liberar();
    const despues = await esperarHasta(
      () => fila(op.clave),
      (x) => x.lat !== null,
    );
    expect(despues.ubicacion_origen).toBe('geocodificada');
  });

  it('con GPS no se llama al geocodificador y el origen es gps', async () => {
    const domicilio = direccion('Con GPS');
    const op = alta({ domicilio, lat: 32.5149, lng: -117.0382 });

    await push([op]);
    await pausa(300);

    const f = await fila(op.clave);
    expect(f.domicilio).toBe(domicilio);
    expect(f.ubicacion_origen).toBe('gps');
    expect(falso.vecesCon(domicilio)).toBe(0);
    const cliente = (await pull()).catalogos.clientes.find(
      (c) => c.id === op.clave,
    );
    expect(cliente?.ubicacion_origen).toBe('gps');
  });

  it('un reenvio duplicada no vuelve a intentar', async () => {
    const domicilio = direccion('Reenviada');
    // Sin coordenada tras el primer intento: si el reenvio volviera a disparar
    // el hook, el servicio de fondo NO lo frenaria por `lat` y el falso veria
    // una segunda llamada. Asi la prueba fija la guarda `!duplicada`.
    falso.responder(domicilio, { estado: 'no-encontrada' });
    const op = alta({ domicilio });
    await push([op]);
    await esperarHasta(
      () => Promise.resolve(falso.vecesCon(domicilio)),
      (veces) => veces === 1,
    );

    const r = await push([op]);
    await pausa(300);

    expect(r.resultados[0]).toMatchObject({ estado: 'duplicada' });
    expect(falso.vecesCon(domicilio)).toBe(1);
  });

  it('un alta rechazada no dispara intento', async () => {
    const domicilio = direccion('Rechazada');
    const op = alta({ domicilio, tipo_negocio_id: tipoNegocioBorradoId });

    const r = await push([op]);
    await pausa(300);

    expect(r.resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'tipo-negocio-inexistente',
    });
    expect(falso.vecesCon(domicilio)).toBe(0);
  });

  it('un domicilio de 301 caracteres es datos-invalidos con su motivo', async () => {
    const op = alta({ domicilio: 'x'.repeat(301) });
    const r = await push([op]);
    expect(r.resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'datos-invalidos',
      motivo: 'domicilio: no puede pasar de 300 caracteres.',
    });
  });

  it('una tablet anterior que no manda domicilio entra igual, sin intento', async () => {
    const op = alta();
    delete (op.datos as Record<string, unknown>).domicilio;
    const antes = falso.llamadas.length;

    const r = await push([op]);
    await pausa(300);

    expect(r.resultados[0]).toMatchObject({ estado: 'aplicada' });
    const f = await fila(op.clave);
    expect(f.domicilio).toBeNull();
    expect(f.lat).toBeNull();
    expect(f.ubicacion_origen).toBeNull();
    expect(falso.llamadas.length).toBe(antes);
  });
});

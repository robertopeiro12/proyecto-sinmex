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
import { ClientesRepository } from './../src/modules/cartera-clientes/clientes.repository';
import { MOTIVOS_UBICAR } from './../src/modules/cartera-clientes/ubicacion-clientes.service';
import {
  GEOCODIFICADOR,
  type ResultadoGeocodificacion,
} from './../src/modules/integraciones/geocodificacion/geocodificador';
import {
  COORDENADA_FALSA,
  GeocodificadorDePrueba,
  esperarHasta,
  pausa,
} from './apoyo-geocodificador';

/**
 * T-72 (D3, D5) desde el portal: el boton "Ubicar con la dirección", el intento
 * al guardar y el origen de la coordenada. Con un geocodificador FALSO: ninguna
 * prueba llama a Google.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN_GENERAL = `e2e-ubi-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-ubi-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-ubi-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const PREFIJO = `ZZ-ubi-${SUFIJO}`;

interface FilaUbicacion {
  domicilio: string | null;
  lat: string | null;
  lng: string | null;
  ubicacion_origen: string | null;
  updated_at: Date;
}

describe('Ubicación de clientes desde el portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const falso = new GeocodificadorDePrueba();
  const usuarioIds: string[] = [];
  let idTijuana: string;
  let idMexicali: string;
  let listaId: string;
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let consecutivo = 0;

  /** Una direccion que ninguna otra prueba usa. */
  const direccion = (nombre: string) => `${PREFIJO} ${nombre} ${++consecutivo}`;

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

  /** Un cliente sembrado por debajo de la API (no dispara intentos). */
  const sembrar = async ({
    domicilio = direccion('Calle'),
    coordenada = null,
    sucursalId = idTijuana,
    deLaApp = false,
  }: {
    domicilio?: string | null;
    coordenada?: { lat: number; lng: number; origen: string } | null;
    sucursalId?: string;
    deLaApp?: boolean;
  } = {}): Promise<string> => {
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `${PREFIJO} cliente ${++consecutivo}`,
        domicilio,
        encargado: 'Encargado de prueba',
        telefono: '000',
        factura: false,
        tipo: deLaApp ? 'prospecto' : 'cliente',
        lista_precio_id: deLaApp ? null : listaId,
        lat: coordenada?.lat.toString() ?? null,
        lng: coordenada?.lng.toString() ?? null,
        ubicacion_origen: coordenada?.origen ?? null,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  const fila = (id: string): Promise<FilaUbicacion> =>
    db
      .selectFrom('cliente')
      .select(['domicilio', 'lat', 'lng', 'ubicacion_origen', 'updated_at'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  const ubicar = (id: string, cookie = cookieGeneral) =>
    request(app.getHttpServer())
      .post(`/clientes/${id}/ubicar`)
      .set('Cookie', cookie);

  /** El cuerpo completo que manda el formulario al editar. */
  const edicion = (domicilio: string, extra: Record<string, unknown> = {}) => ({
    nombre: `${PREFIJO} editado`,
    domicilio,
    telefono: '000',
    factura: false,
    listaPrecioId: listaId,
    overridesPrecio: [],
    vigenteDesde: '2026-10-19',
    ...extra,
  });

  const editar = (id: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/clientes/${id}`)
      .set('Cookie', cookieGeneral)
      .send(cuerpo)
      .expect(200);

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
    listaId = (
      await db
        .selectFrom('lista_precio')
        .select('id')
        .where('nombre', '=', 'Lista 1')
        .executeTakeFirstOrThrow()
    ).id;

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', idTijuana);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    // Que ningun intento en segundo plano escriba despues del borrado.
    await pausa(300);
    await db
      .deleteFrom('cliente')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    if (usuarioIds.length > 0) {
      await db
        .deleteFrom('sesion_refresh')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await app.close();
  });

  describe('POST /clientes/:id/ubicar', () => {
    it('200: guarda la coordenada de Google, con su origen, y toca updated_at', async () => {
      const id = await sembrar();
      const antes = await fila(id);

      const res = await ubicar(id).expect(200);

      expect(res.body).toEqual({
        lat: COORDENADA_FALSA.lat,
        lng: COORDENADA_FALSA.lng,
        ubicacionOrigen: 'geocodificada',
      });
      const despues = await fila(id);
      expect(Number(despues.lat)).toBe(COORDENADA_FALSA.lat);
      expect(Number(despues.lng)).toBe(COORDENADA_FALSA.lng);
      expect(despues.ubicacion_origen).toBe('geocodificada');
      expect(despues.updated_at.getTime()).toBeGreaterThan(
        antes.updated_at.getTime(),
      );
      // La ficha del portal ve el origen.
      const ficha = await request(app.getHttpServer())
        .get(`/clientes/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(200);
      expect((ficha.body as { ubicacionOrigen: string }).ubicacionOrigen).toBe(
        'geocodificada',
      );
    });

    it('409 si no tiene domicilio (un prospecto de la app sin direccion)', async () => {
      const id = await sembrar({ domicilio: null, deLaApp: true });
      const res = await ubicar(id).expect(409);
      expect((res.body as { message: string }).message).toBe(
        MOTIVOS_UBICAR.sinDomicilio,
      );
    });

    it('409 si ya tiene coordenada, sin llamar a Google', async () => {
      const domicilio = direccion('Con coordenada');
      const id = await sembrar({
        domicilio,
        coordenada: { lat: 32.5, lng: -117, origen: 'manual' },
      });
      const res = await ubicar(id).expect(409);
      expect((res.body as { message: string }).message).toBe(
        MOTIVOS_UBICAR.yaTiene,
      );
      expect(falso.vecesCon(domicilio)).toBe(0);
    });

    it.each<[string, ResultadoGeocodificacion, string]>([
      ['imprecisa', { estado: 'imprecisa' }, MOTIVOS_UBICAR.imprecisa],
      [
        'no encontrada',
        { estado: 'no-encontrada' },
        MOTIVOS_UBICAR.noEncontrada,
      ],
      ['sin clave', { estado: 'sin-configurar' }, MOTIVOS_UBICAR.sinConfigurar],
    ])(
      '409 %s, con su motivo y sin guardar',
      async (nombre, resultado, motivo) => {
        const domicilio = direccion(nombre);
        falso.responder(domicilio, resultado);
        const id = await sembrar({ domicilio });

        const res = await ubicar(id).expect(409);

        expect((res.body as { message: string }).message).toBe(motivo);
        expect((await fila(id)).lat).toBeNull();
      },
    );

    it('502 si Google no respondio', async () => {
      const domicilio = direccion('Caido');
      falso.responder(domicilio, {
        estado: 'error',
        detalle: 'Google respondió HTTP 503.',
      });
      const id = await sembrar({ domicilio });
      const res = await ubicar(id).expect(502);
      expect((res.body as { message: string }).message).toBe(
        MOTIVOS_UBICAR.error,
      );
    });

    it('403 sin cliente.gestionar', async () => {
      const id = await sembrar();
      await ubicar(id, cookieSinPermiso).expect(403);
      expect((await fila(id)).lat).toBeNull();
    });

    it('404 para un usuario de otra sucursal', async () => {
      const id = await sembrar({ sucursalId: idMexicali });
      await ubicar(id, cookieTijuana).expect(404);
      expect((await fila(id)).lat).toBeNull();
    });

    it('404 si el cliente no existe', async () => {
      await ubicar(randomUUID()).expect(404);
    });
  });

  describe('guardar desde el portal', () => {
    it('editar el domicilio sin coordenada dispara el intento, sin esperarlo', async () => {
      const id = await sembrar();
      const nuevo = direccion('Domicilio nuevo');
      const liberar = falso.retener(nuevo, {
        estado: 'ok',
        ...COORDENADA_FALSA,
      });

      // El guardado responde aunque Google siga sin contestar.
      await editar(id, edicion(nuevo));
      const mientras = await fila(id);
      expect(mientras.domicilio).toBe(nuevo);
      expect(mientras.lat).toBeNull();

      await esperarHasta(
        () => Promise.resolve(falso.vecesCon(nuevo)),
        (veces) => veces >= 1,
      );
      expect((await fila(id)).lat).toBeNull();
      liberar();

      const despues = await esperarHasta(
        () => fila(id),
        (f) => f.lat !== null,
      );
      expect(despues.ubicacion_origen).toBe('geocodificada');
      expect(falso.vecesCon(nuevo)).toBe(1);
    });

    it('guardar con el mismo domicilio no vuelve a intentar', async () => {
      const domicilio = direccion('Mismo');
      const id = await sembrar({ domicilio });
      await editar(id, edicion(domicilio));
      await pausa(300);
      expect(falso.vecesCon(domicilio)).toBe(0);
    });

    it('un alta sin coordenada dispara el intento', async () => {
      const domicilio = direccion('Alta');
      const res = await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} alta`,
          domicilio,
          telefono: '000',
          encargado: 'Lupita',
          factura: false,
          tipo: 'cliente',
          listaPrecioId: listaId,
          overridesPrecio: [],
          vigenteDesde: '2026-10-19',
          sucursalId: idTijuana,
        })
        .expect(201);
      const id = (res.body as { id: string }).id;
      const despues = await esperarHasta(
        () => fila(id),
        (f) => f.lat !== null,
      );
      expect(despues.ubicacion_origen).toBe('geocodificada');
    });

    it('una coordenada capturada a mano queda como manual, y no se geocodifica', async () => {
      const domicilio = direccion('A mano');
      const id = await sembrar();
      await editar(id, edicion(domicilio, { lat: 32.51, lng: -117.03 }));
      const f = await fila(id);
      expect(f.ubicacion_origen).toBe('manual');
      await pausa(300);
      expect(falso.vecesCon(domicilio)).toBe(0);
    });

    it('reenviar la misma coordenada conserva el origen; cambiarla la vuelve manual; borrarla, nula', async () => {
      const domicilio = direccion('Ubicada');
      const id = await sembrar({
        domicilio,
        coordenada: { lat: 32.5251, lng: -117.0213, origen: 'geocodificada' },
      });

      await editar(id, edicion(domicilio, { lat: 32.5251, lng: -117.0213 }));
      expect((await fila(id)).ubicacion_origen).toBe('geocodificada');

      await editar(id, edicion(domicilio, { lat: 32.53, lng: -117.0213 }));
      expect((await fila(id)).ubicacion_origen).toBe('manual');

      await editar(id, edicion(domicilio, { lat: null, lng: null }));
      const f = await fila(id);
      expect(f.lat).toBeNull();
      expect(f.ubicacion_origen).toBeNull();
    });

    it('un guardado sin lat ni lng no toca la coordenada (formulario abierto antes de que Google respondiera)', async () => {
      const domicilio = direccion('Sin tocar');
      const id = await sembrar({
        domicilio,
        coordenada: { lat: 32.5251, lng: -117.0213, origen: 'geocodificada' },
      });

      await editar(id, edicion(domicilio));
      const f = await fila(id);
      expect(f.domicilio).toBe(domicilio);
      expect(Number(f.lat)).toBe(32.5251);
      expect(Number(f.lng)).toBe(-117.0213);
      expect(f.ubicacion_origen).toBe('geocodificada');
    });

    it('acepta un domicilio de 300 caracteres (el de la tablet) y rechaza uno de 301', async () => {
      const id = await sembrar({
        coordenada: { lat: 32.5, lng: -117, origen: 'manual' },
      });
      const largo = `${PREFIJO} `.padEnd(300, 'x');
      await editar(id, edicion(largo, { lat: 32.5, lng: -117 }));
      await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieGeneral)
        .send(edicion(`${largo}x`, { lat: 32.5, lng: -117 }))
        .expect(400);
    });
  });

  describe('la oficina captura una coordenada mientras Google responde', () => {
    const capturarAMano = (id: string) =>
      db
        .updateTable('cliente')
        .set({ lat: '32.6', lng: '-117.1', ubicacion_origen: 'manual' })
        .where('id', '=', id)
        .execute();

    it('ubicar: gana la coordenada de la oficina, 409 y la fila intacta', async () => {
      const domicilio = direccion('Carrera ubicar');
      const liberar = falso.retener(domicilio, {
        estado: 'ok',
        lat: 1,
        lng: 2,
      });
      const id = await sembrar({ domicilio });

      const respuesta = ubicar(id).then((r) => r);
      // Google ya fue consultado y sigue "pensando": ahora la oficina captura.
      await esperarHasta(
        () => Promise.resolve(falso.vecesCon(domicilio)),
        (veces) => veces >= 1,
      );
      expect(falso.vecesCon(domicilio)).toBe(1);
      await capturarAMano(id);
      liberar();
      const res = await respuesta;

      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toBe(
        MOTIVOS_UBICAR.yaTiene,
      );
      const f = await fila(id);
      expect(Number(f.lat)).toBe(32.6);
      expect(Number(f.lng)).toBe(-117.1);
      expect(f.ubicacion_origen).toBe('manual');
    });

    it('al guardar (segundo plano): el intento no pisa la coordenada de la oficina', async () => {
      const id = await sembrar();
      const nuevo = direccion('Carrera guardar');
      const liberar = falso.retener(nuevo, { estado: 'ok', lat: 1, lng: 2 });
      const espia = jest.spyOn(
        app.get(ClientesRepository),
        'guardarGeocodificada',
      );

      try {
        await editar(id, edicion(nuevo));
        await esperarHasta(
          () => Promise.resolve(falso.vecesCon(nuevo)),
          (veces) => veces >= 1,
        );
        expect(falso.vecesCon(nuevo)).toBe(1);
        await capturarAMano(id);
        liberar();
        await esperarHasta(
          () => Promise.resolve(espia.mock.calls.length),
          (veces) => veces >= 1,
        );
        // El intento llego a escribir y el `where lat is null` lo rechazo.
        expect(espia).toHaveBeenCalledTimes(1);
        await expect(espia.mock.results[0].value).resolves.toBe(false);
      } finally {
        espia.mockRestore();
      }

      const f = await fila(id);
      expect(Number(f.lat)).toBe(32.6);
      expect(f.ubicacion_origen).toBe('manual');
    });
  });

  describe('ClientesRepository.guardarGeocodificada', () => {
    it('no pisa una coordenada que la oficina capturo mientras tanto', async () => {
      const id = await sembrar({
        coordenada: { lat: 32.5, lng: -117, origen: 'manual' },
      });
      const repo = app.get(ClientesRepository);

      await expect(repo.guardarGeocodificada(id, 32.6, -117.1)).resolves.toBe(
        false,
      );

      const f = await fila(id);
      expect(Number(f.lat)).toBe(32.5);
      expect(f.ubicacion_origen).toBe('manual');
    });
  });
});

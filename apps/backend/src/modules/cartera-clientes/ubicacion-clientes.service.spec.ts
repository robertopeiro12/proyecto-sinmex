import {
  BadGatewayException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ResultadoGeocodificacion } from '../integraciones/geocodificacion/geocodificador';
import type { ClientesRepository } from './clientes.repository';
import {
  MOTIVOS_UBICAR,
  UbicacionClientesService,
} from './ubicacion-clientes.service';

const ID = '7f2c0000-0000-4000-8000-000000000001';
const DOMICILIO = 'Av. Revolución 1234, Zona Centro';
const OK: ResultadoGeocodificacion = {
  estado: 'ok',
  lat: 32.5251,
  lng: -117.0213,
};

interface ClienteUbicable {
  domicilio: string | null;
  lat: number | null;
  sucursalCodigo: string;
}

function montar({
  existe = true,
  cliente = {
    domicilio: DOMICILIO,
    lat: null,
    sucursalCodigo: 'TJ',
  },
  resultado = OK,
  guardada = true,
  codigoUsuario = null,
}: {
  existe?: boolean;
  cliente?: ClienteUbicable;
  resultado?: ResultadoGeocodificacion | Error;
  guardada?: boolean;
  codigoUsuario?: string | null;
} = {}) {
  const repo = {
    ubicacionDe: jest.fn().mockResolvedValue(existe ? cliente : undefined),
    guardarGeocodificada: jest.fn().mockResolvedValue(guardada),
    buscarSucursalUsuario: jest
      .fn()
      .mockResolvedValue({ id: null, codigo: codigoUsuario }),
  };
  const geocodificador = {
    geocodificar: jest.fn(() =>
      resultado instanceof Error
        ? Promise.reject(resultado)
        : Promise.resolve(resultado),
    ),
  };
  const servicio = new UbicacionClientesService(
    repo as unknown as ClientesRepository,
    geocodificador,
  );
  return { servicio, repo, geocodificador };
}

let avisos: jest.SpyInstance;
beforeEach(() => {
  avisos = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
});
afterEach(() => avisos.mockRestore());

describe('MOTIVOS_UBICAR (T-72, D5)', () => {
  it('son los textos exactos del spec', () => {
    expect(MOTIVOS_UBICAR).toEqual({
      sinDomicilio: 'El cliente no tiene domicilio.',
      yaTiene: 'Ya tiene ubicación; bórrala primero para volver a ubicarlo.',
      imprecisa:
        'Google solo encontró la colonia o la ciudad: agrega calle y número.',
      noEncontrada: 'Google no encontró esa dirección.',
      sinConfigurar: 'Falta configurar la clave de Google en el servidor.',
      error: 'Google no respondió; intenta en un momento.',
    });
  });
});

describe('geocodificarEnSegundoPlano (T-72, D5)', () => {
  it('con domicilio y sin coordenada, geocodifica el domicilio recortado y guarda', async () => {
    const { servicio, repo, geocodificador } = montar({
      cliente: {
        domicilio: `  ${DOMICILIO}  `,
        lat: null,
        sucursalCodigo: 'TJ',
      },
    });
    await servicio.geocodificarEnSegundoPlano(ID);
    expect(geocodificador.geocodificar).toHaveBeenCalledWith(DOMICILIO);
    expect(repo.guardarGeocodificada).toHaveBeenCalledWith(
      ID,
      32.5251,
      -117.0213,
    );
  });

  it('si ya tiene coordenada no llama a Google', async () => {
    const { servicio, geocodificador, repo } = montar({
      cliente: { domicilio: DOMICILIO, lat: 32.5, sucursalCodigo: 'TJ' },
    });
    await servicio.geocodificarEnSegundoPlano(ID);
    expect(geocodificador.geocodificar).not.toHaveBeenCalled();
    expect(repo.guardarGeocodificada).not.toHaveBeenCalled();
  });

  it.each([null, '', '   '])(
    'sin domicilio util (%p) no llama a Google',
    async (domicilio) => {
      const { servicio, geocodificador } = montar({
        cliente: { domicilio, lat: null, sucursalCodigo: 'TJ' },
      });
      await servicio.geocodificarEnSegundoPlano(ID);
      expect(geocodificador.geocodificar).not.toHaveBeenCalled();
    },
  );

  it('un cliente que ya no existe no hace nada', async () => {
    const { servicio, geocodificador } = montar({ existe: false });
    await servicio.geocodificarEnSegundoPlano(ID);
    expect(geocodificador.geocodificar).not.toHaveBeenCalled();
  });

  it.each<ResultadoGeocodificacion>([
    { estado: 'imprecisa' },
    { estado: 'no-encontrada' },
    { estado: 'error', detalle: 'Google respondió REQUEST_DENIED.' },
  ])('un resultado $estado solo se loguea, sin guardar', async (resultado) => {
    const { servicio, repo } = montar({ resultado });
    await servicio.geocodificarEnSegundoPlano(ID);
    expect(repo.guardarGeocodificada).not.toHaveBeenCalled();
    expect(avisos).toHaveBeenCalledTimes(1);
  });

  it('el error se loguea con su detalle (el status de Google)', async () => {
    const { servicio } = montar({
      resultado: {
        estado: 'error',
        detalle: 'Google respondió REQUEST_DENIED.',
      },
    });
    await servicio.geocodificarEnSegundoPlano(ID);
    expect(String((avisos.mock.calls as unknown[][])[0][0])).toContain(
      'Google respondió REQUEST_DENIED.',
    );
  });

  it('sin clave se avisa UNA vez por arranque', async () => {
    const { servicio } = montar({ resultado: { estado: 'sin-configurar' } });
    await servicio.geocodificarEnSegundoPlano(ID);
    await servicio.geocodificarEnSegundoPlano(ID);
    expect(avisos).toHaveBeenCalledTimes(1);
    expect(String((avisos.mock.calls as unknown[][])[0][0])).toContain(
      'GOOGLE_MAPS_API_KEY',
    );
  });

  it('nunca rechaza: un fallo inesperado solo se loguea', async () => {
    const { servicio } = montar({ resultado: new Error('se cayo la base') });
    await expect(
      servicio.geocodificarEnSegundoPlano(ID),
    ).resolves.toBeUndefined();
    expect(avisos).toHaveBeenCalledTimes(1);
  });
});

describe('ubicar (T-72, D5)', () => {
  /** El error que lanza `ubicar`, para revisar clase y mensaje con una sola llamada. */
  const errorDe = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  it('ok: guarda y responde la coordenada con su origen', async () => {
    const { servicio, repo } = montar();
    await expect(servicio.ubicar('usuario-1', ID)).resolves.toEqual({
      lat: 32.5251,
      lng: -117.0213,
      ubicacionOrigen: 'geocodificada',
    });
    expect(repo.guardarGeocodificada).toHaveBeenCalledWith(
      ID,
      32.5251,
      -117.0213,
    );
  });

  it('si la oficina capturo una coordenada mientras Google respondia, 409 y no la pisa', async () => {
    const { servicio } = montar({ guardada: false });
    const error = await errorDe(servicio.ubicar('usuario-1', ID));
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(MOTIVOS_UBICAR.yaTiene);
  });

  it('un cliente que no existe es 404', async () => {
    const { servicio } = montar({ existe: false });
    expect(await errorDe(servicio.ubicar('usuario-1', ID))).toBeInstanceOf(
      NotFoundException,
    );
  });

  it('un cliente de otra sucursal es 404, y no llama a Google', async () => {
    const { servicio, geocodificador } = montar({
      codigoUsuario: 'TJ',
      cliente: { domicilio: DOMICILIO, lat: null, sucursalCodigo: 'MX' },
    });
    expect(await errorDe(servicio.ubicar('usuario-1', ID))).toBeInstanceOf(
      NotFoundException,
    );
    expect(geocodificador.geocodificar).not.toHaveBeenCalled();
  });

  it('un usuario atado a la sucursal del cliente si puede', async () => {
    const { servicio } = montar({ codigoUsuario: 'TJ' });
    await expect(servicio.ubicar('usuario-1', ID)).resolves.toMatchObject({
      ubicacionOrigen: 'geocodificada',
    });
  });

  it.each([null, '  '])('sin domicilio (%p) es 409', async (domicilio) => {
    const { servicio, geocodificador } = montar({
      cliente: { domicilio, lat: null, sucursalCodigo: 'TJ' },
    });
    const error = await errorDe(servicio.ubicar('usuario-1', ID));
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(MOTIVOS_UBICAR.sinDomicilio);
    expect(geocodificador.geocodificar).not.toHaveBeenCalled();
  });

  it('con coordenada es 409 y no llama a Google', async () => {
    const { servicio, geocodificador } = montar({
      cliente: { domicilio: DOMICILIO, lat: 32.5, sucursalCodigo: 'TJ' },
    });
    const error = await errorDe(servicio.ubicar('usuario-1', ID));
    expect((error as Error).message).toBe(MOTIVOS_UBICAR.yaTiene);
    expect(geocodificador.geocodificar).not.toHaveBeenCalled();
  });

  it.each<[ResultadoGeocodificacion, string]>([
    [{ estado: 'imprecisa' }, MOTIVOS_UBICAR.imprecisa],
    [{ estado: 'no-encontrada' }, MOTIVOS_UBICAR.noEncontrada],
    [{ estado: 'sin-configurar' }, MOTIVOS_UBICAR.sinConfigurar],
  ])('%o es 409 con su motivo, sin guardar', async (resultado, motivo) => {
    const { servicio, repo } = montar({ resultado });
    const error = await errorDe(servicio.ubicar('usuario-1', ID));
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(motivo);
    expect(repo.guardarGeocodificada).not.toHaveBeenCalled();
  });

  it('error de Google es 502 con su motivo', async () => {
    const { servicio } = montar({
      resultado: { estado: 'error', detalle: 'Google respondió HTTP 503.' },
    });
    const error = await errorDe(servicio.ubicar('usuario-1', ID));
    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as Error).message).toBe(MOTIVOS_UBICAR.error);
  });
});

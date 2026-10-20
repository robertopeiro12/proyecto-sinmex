import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  COORDENADA_DE_DESARROLLO,
  GeocodificadorFalso,
} from './geocodificador-falso';
import { crearGeocodificador } from './geocodificacion.module';
import { GeocodificadorGoogle } from './google';

const config = (valores: Record<string, string | undefined>) =>
  ({ get: (clave: string) => valores[clave] }) as unknown as ConfigService;

describe('crearGeocodificador (T-72)', () => {
  let avisos: jest.SpyInstance;
  beforeEach(() => {
    avisos = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => avisos.mockRestore());

  it('por defecto es el de Google', () => {
    expect(crearGeocodificador(config({}))).toBeInstanceOf(
      GeocodificadorGoogle,
    );
    expect(
      crearGeocodificador(config({ GEOCODIFICADOR_FALSO: '0' })),
    ).toBeInstanceOf(GeocodificadorGoogle);
    expect(avisos).not.toHaveBeenCalled();
  });

  it('GEOCODIFICADOR_FALSO=1 da el falso de desarrollo, y lo avisa en el log', async () => {
    const g = crearGeocodificador(
      config({ NODE_ENV: 'development', GEOCODIFICADOR_FALSO: '1' }),
    );
    expect(g).toBeInstanceOf(GeocodificadorFalso);
    await expect(g.geocodificar('cualquier cosa')).resolves.toEqual({
      estado: 'ok',
      ...COORDENADA_DE_DESARROLLO,
    });
    expect(avisos).toHaveBeenCalledTimes(1);
  });

  it('en producción GEOCODIFICADOR_FALSO=1 se ignora: Google y un warn', () => {
    const g = crearGeocodificador(
      config({
        NODE_ENV: 'production',
        GEOCODIFICADOR_FALSO: '1',
        GOOGLE_MAPS_API_KEY: 'AIzaClaveSecreta',
      }),
    );
    expect(g).toBeInstanceOf(GeocodificadorGoogle);
    expect(g).not.toBeInstanceOf(GeocodificadorFalso);
    expect(avisos).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(avisos.mock.calls)).not.toContain('AIzaClaveSecreta');
  });

  it('en producción sin clave y con el falso pedido responde sin-configurar', async () => {
    const g = crearGeocodificador(
      config({ NODE_ENV: 'production', GEOCODIFICADOR_FALSO: '1' }),
    );
    await expect(g.geocodificar('Calle 1')).resolves.toEqual({
      estado: 'sin-configurar',
    });
  });

  it('en test siempre responde sin-configurar, con clave o con falso pedido', async () => {
    const original = globalThis.fetch;
    const espia = jest.fn();
    globalThis.fetch = espia;
    try {
      for (const extra of [
        { GOOGLE_MAPS_API_KEY: 'AIzaClaveSecreta' },
        { GEOCODIFICADOR_FALSO: '1' },
        {},
      ]) {
        const g = crearGeocodificador(config({ NODE_ENV: 'test', ...extra }));
        await expect(g.geocodificar('Calle 1')).resolves.toEqual({
          estado: 'sin-configurar',
        });
      }
      expect(espia).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});

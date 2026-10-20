import type { ConfigService } from '@nestjs/config';
import {
  GeocodificadorGoogle,
  TIEMPO_MAX_MS,
  URL_GEOCODING,
  geocodificarConGoogle,
} from './google';

const CLAVE = 'AIzaClaveSecretaDePrueba123';

const ROOFTOP = {
  status: 'OK',
  results: [
    {
      geometry: {
        location: { lat: 32.5251, lng: -117.0213 },
        location_type: 'ROOFTOP',
      },
    },
  ],
};

/** Un `fetch` falso que responde siempre lo mismo y anota las URL. */
function fetchQueResponde(cuerpo: unknown, status = 200) {
  const urls: string[] = [];
  const fn = jest.fn((url: string) => {
    urls.push(url);
    return Promise.resolve(
      new Response(
        typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
        { status, headers: { 'content-type': 'application/json' } },
      ),
    );
  });
  return { fetch: fn as unknown as typeof fetch, espia: fn, urls };
}

const opciones = (
  fetch: typeof globalThis.fetch,
  extra: Partial<{ clave: string | null; tiempoMaxMs: number }> = {},
) => ({ clave: CLAVE, fetch, tiempoMaxMs: 1000, ...extra });

describe('geocodificarConGoogle (T-72, D4)', () => {
  it('el tiempo maximo de produccion es de 5 s', () => {
    expect(TIEMPO_MAX_MS).toBe(5_000);
  });

  it('sin clave no toca la red: sin-configurar', async () => {
    const { fetch, espia } = fetchQueResponde(ROOFTOP);
    await expect(
      geocodificarConGoogle('Calle 1', opciones(fetch, { clave: null })),
    ).resolves.toEqual({ estado: 'sin-configurar' });
    expect(espia).not.toHaveBeenCalled();
  });

  it('pide la direccion en Mexico y en espanol, con la clave', async () => {
    const { fetch, urls } = fetchQueResponde(ROOFTOP);
    await expect(
      geocodificarConGoogle(
        'Av. Revolución 1234, Zona Centro',
        opciones(fetch),
      ),
    ).resolves.toEqual({ estado: 'ok', lat: 32.5251, lng: -117.0213 });

    const url = new URL(urls[0]);
    expect(`${url.origin}${url.pathname}`).toBe(URL_GEOCODING);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      address: 'Av. Revolución 1234, Zona Centro',
      region: 'mx',
      components: 'country:MX',
      language: 'es',
      key: CLAVE,
    });
  });

  it('un 5xx es error con el codigo HTTP', async () => {
    const { fetch } = fetchQueResponde('caido', 503);
    await expect(
      geocodificarConGoogle('Calle 1', opciones(fetch)),
    ).resolves.toEqual({
      estado: 'error',
      detalle: 'Google respondió HTTP 503.',
    });
  });

  it('un JSON roto es error', async () => {
    const { fetch } = fetchQueResponde('{no es json', 200);
    await expect(
      geocodificarConGoogle('Calle 1', opciones(fetch)),
    ).resolves.toEqual({
      estado: 'error',
      detalle: 'Google respondió un JSON roto.',
    });
  });

  it('sin red es error', async () => {
    const fetch = jest
      .fn()
      .mockRejectedValue(
        new TypeError('fetch failed'),
      ) as unknown as typeof globalThis.fetch;
    await expect(
      geocodificarConGoogle('Calle 1', opciones(fetch)),
    ).resolves.toEqual({
      estado: 'error',
      detalle: 'No hubo conexión con Google.',
    });
  });

  it('se rinde al tiempo maximo: el AbortController corta la peticion', async () => {
    const fetch = jest.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolver, rechazar) => {
          init?.signal?.addEventListener('abort', () =>
            rechazar(new DOMException('aborted', 'AbortError')),
          );
        }),
    ) as unknown as typeof globalThis.fetch;

    const inicio = Date.now();
    await expect(
      geocodificarConGoogle('Calle 1', opciones(fetch, { tiempoMaxMs: 30 })),
    ).resolves.toEqual({
      estado: 'error',
      detalle: 'Google no respondió a tiempo (30 ms).',
    });
    expect(Date.now() - inicio).toBeLessThan(1_000);
  });

  it('ningun detalle de error lleva la clave ni la URL', async () => {
    const casos: (typeof globalThis.fetch)[] = [
      fetchQueResponde({
        status: 'REQUEST_DENIED',
        error_message: `bad ${CLAVE}`,
      }).fetch,
      fetchQueResponde('x', 500).fetch,
      fetchQueResponde('{roto', 200).fetch,
      jest
        .fn()
        .mockRejectedValue(
          new TypeError(`fetch failed ${URL_GEOCODING}?key=${CLAVE}`),
        ),
    ];
    for (const fetch of casos) {
      const r = await geocodificarConGoogle('Calle 1', opciones(fetch));
      expect(r.estado).toBe('error');
      expect(JSON.stringify(r)).not.toContain(CLAVE);
      expect(JSON.stringify(r)).not.toContain('maps.googleapis.com');
    }
  });
});

describe('GeocodificadorGoogle', () => {
  const config = (valores: Record<string, string | undefined>) =>
    ({ get: (clave: string) => valores[clave] }) as unknown as ConfigService;

  it.each([undefined, '', '   '])(
    'sin una clave util (%p) es sin-configurar y no toca la red',
    async (clave) => {
      const original = globalThis.fetch;
      const espia = jest.fn();
      globalThis.fetch = espia;
      try {
        await expect(
          new GeocodificadorGoogle(
            config({ GOOGLE_MAPS_API_KEY: clave }),
          ).geocodificar('Calle 1'),
        ).resolves.toEqual({ estado: 'sin-configurar' });
        expect(espia).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = original;
      }
    },
  );
});

import type { ConfigService } from '@nestjs/config';
import type {
  Geocodificador,
  ResultadoGeocodificacion,
} from './geocodificador';
import { interpretarRespuestaGoogle } from './respuesta-google';

export const URL_GEOCODING =
  'https://maps.googleapis.com/maps/api/geocode/json';

/** D4: como mucho 5 s. El boton del portal espera esto; el push nunca. */
export const TIEMPO_MAX_MS = 5_000;

export interface OpcionesGoogle {
  /** `null` = sin configurar: no se toca la red. */
  clave: string | null;
  /** Inyectable para las pruebas; en produccion, el `fetch` nativo de Node. */
  fetch: typeof globalThis.fetch;
  tiempoMaxMs: number;
}

/**
 * Una consulta a la Geocoding API (T-72, D4). **Nunca lanza**: todo fallo es
 * un resultado `error`, porque quien llama decide (el intento en segundo plano
 * solo loguea; el portal responde 502).
 *
 * > [!danger] La URL lleva la clave
 * > Por eso ningun `detalle` incluye la URL ni el mensaje del error de `fetch`
 * > (que en algunas versiones de Node la repite): solo el `status` de Google,
 * > el codigo HTTP o una frase fija.
 */
export async function geocodificarConGoogle(
  direccion: string,
  opciones: OpcionesGoogle,
): Promise<ResultadoGeocodificacion> {
  if (opciones.clave === null) return { estado: 'sin-configurar' };

  const parametros = new URLSearchParams({
    address: direccion,
    region: 'mx',
    components: 'country:MX',
    language: 'es',
    key: opciones.clave,
  });
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), opciones.tiempoMaxMs);
  try {
    const res = await opciones.fetch(
      `${URL_GEOCODING}?${parametros.toString()}`,
      { signal: control.signal },
    );
    if (!res.ok) {
      return {
        estado: 'error',
        detalle: `Google respondió HTTP ${res.status}.`,
      };
    }
    // Aparte del resto: un fallo aqui es un cuerpo ilegible, no una red caida
    // (y no depende de `instanceof SyntaxError`, que falla entre realms).
    let cuerpo: unknown;
    try {
      cuerpo = await res.json();
    } catch {
      if (control.signal.aborted) throw new Error('abortado');
      return { estado: 'error', detalle: 'Google respondió un JSON roto.' };
    }
    return interpretarRespuestaGoogle(cuerpo);
  } catch {
    if (control.signal.aborted) {
      return {
        estado: 'error',
        detalle: `Google no respondió a tiempo (${opciones.tiempoMaxMs} ms).`,
      };
    }
    return { estado: 'error', detalle: 'No hubo conexión con Google.' };
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * El geocodificador de produccion. La clave sale del entorno
 * (`GOOGLE_MAPS_API_KEY`) y no sale de esta clase: ni logs ni respuestas.
 * Una clave en blanco cuenta como "sin configurar".
 */
export class GeocodificadorGoogle implements Geocodificador {
  private readonly clave: string | null;

  constructor(config: ConfigService) {
    const clave = config.get<string>('GOOGLE_MAPS_API_KEY')?.trim();
    this.clave = clave ? clave : null;
  }

  geocodificar(direccion: string): Promise<ResultadoGeocodificacion> {
    return geocodificarConGoogle(direccion, {
      clave: this.clave,
      // Se lee al llamar, no al construir: las pruebas sustituyen el global.
      fetch: (entrada: string | URL | Request, init?: RequestInit) =>
        globalThis.fetch(entrada, init),
      tiempoMaxMs: TIEMPO_MAX_MS,
    });
  }
}

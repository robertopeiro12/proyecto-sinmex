import type {
  Geocodificador,
  ResultadoGeocodificacion,
} from '../src/modules/integraciones/geocodificacion/geocodificador';

/** Lo que responde el falso cuando no se le dijo otra cosa. */
export const COORDENADA_FALSA = { lat: 32.5251, lng: -117.0213 } as const;

/**
 * Geocodificador de los e2e (T-72): **ninguna prueba llama a Google**. Se
 * inyecta con `.overrideProvider(GEOCODIFICADOR).useValue(falso)`.
 *
 * Responde por direccion: cada prueba usa direcciones unicas, asi que un intento
 * en segundo plano de otra prueba no le roba la respuesta. Anota cada llamada.
 */
export class GeocodificadorDePrueba implements Geocodificador {
  readonly llamadas: string[] = [];
  private readonly respuestas = new Map<
    string,
    { resultado: ResultadoGeocodificacion; demoraMs: number }
  >();

  responder(
    direccion: string,
    resultado: ResultadoGeocodificacion,
    demoraMs = 0,
  ): void {
    this.respuestas.set(direccion, { resultado, demoraMs });
  }

  vecesCon(direccion: string): number {
    return this.llamadas.filter((d) => d === direccion).length;
  }

  geocodificar(direccion: string): Promise<ResultadoGeocodificacion> {
    this.llamadas.push(direccion);
    const r = this.respuestas.get(direccion);
    const resultado: ResultadoGeocodificacion = r?.resultado ?? {
      estado: 'ok',
      ...COORDENADA_FALSA,
    };
    return new Promise((resolver) =>
      setTimeout(() => resolver(resultado), r?.demoraMs ?? 0),
    );
  }
}

export const pausa = (ms: number): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, ms));

/**
 * Lee hasta que `listo` se cumpla o pasen `ms` (el intento corre en segundo
 * plano). Devuelve la ultima lectura: la prueba afirma sobre ella.
 */
export async function esperarHasta<T>(
  leer: () => Promise<T>,
  listo: (valor: T) => boolean,
  ms = 3_000,
): Promise<T> {
  const limite = Date.now() + ms;
  for (;;) {
    const valor = await leer();
    if (listo(valor) || Date.now() >= limite) return valor;
    await pausa(50);
  }
}

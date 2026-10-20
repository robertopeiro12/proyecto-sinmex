/**
 * Convertir una direccion en coordenada (T-72, D4).
 *
 * Interfaz y token, sin implementacion: `cartera-clientes` depende de esto y no
 * de Google, y las pruebas inyectan un falso (`overrideProvider(GEOCODIFICADOR)`).
 * Ninguna prueba ni e2e llama a Google.
 */
export type ResultadoGeocodificacion =
  | { estado: 'ok'; lat: number; lng: number }
  /** No hay `GOOGLE_MAPS_API_KEY`: nada falla, el cliente se queda sin coordenada. */
  | { estado: 'sin-configurar' }
  /** Google solo encontro algo aproximado (colonia o ciudad). */
  | { estado: 'imprecisa' }
  /** `ZERO_RESULTS`. */
  | { estado: 'no-encontrada' }
  /**
   * Red, cuota, `REQUEST_DENIED`, 5xx o tiempo agotado. `detalle` es para el
   * log: lleva el `status` de Google o el codigo HTTP, **nunca** la URL ni la
   * clave.
   */
  | { estado: 'error'; detalle: string };

export interface Geocodificador {
  geocodificar(direccion: string): Promise<ResultadoGeocodificacion>;
}

/** Token de Nest del geocodificador. */
export const GEOCODIFICADOR = Symbol('GEOCODIFICADOR');

import type {
  Geocodificador,
  ResultadoGeocodificacion,
} from './geocodificador';

/** Centro de Tijuana. */
export const COORDENADA_DE_DESARROLLO = { lat: 32.514947, lng: -117.038247 };

/**
 * **Solo desarrollo** (`GEOCODIFICADOR_FALSO=1`): toda direccion se "ubica" en
 * el centro de Tijuana sin llamar a Google. Existe para la aceptacion en el
 * emulador (spec, "Pruebas") mientras no haya clave. Los e2e NO lo usan: traen
 * su propio falso (`test/apoyo-geocodificador.ts`).
 */
export class GeocodificadorFalso implements Geocodificador {
  geocodificar(): Promise<ResultadoGeocodificacion> {
    return Promise.resolve({ estado: 'ok', ...COORDENADA_DE_DESARROLLO });
  }
}

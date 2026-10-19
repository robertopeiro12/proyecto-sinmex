import type { ResultadoGeocodificacion } from './geocodificador';

/**
 * Lo que se acepta de Google como coordenada buena (D4). `APPROXIMATE` (nivel
 * colonia o ciudad) no: para rutear, una coordenada mala es peor que ninguna.
 */
export const TIPOS_PRECISOS: readonly string[] = [
  'ROOFTOP',
  'RANGE_INTERPOLATED',
  'GEOMETRIC_CENTER',
];

interface GeometriaGoogle {
  location?: { lat?: unknown; lng?: unknown };
  location_type?: unknown;
}

/** `numeric(9,6)`: se guarda con 6 decimales, asi que se responde igual. */
function redondear6(valor: number): number {
  return Math.round(valor * 1e6) / 1e6;
}

function enRango(valor: unknown, maximo: number): valor is number {
  return (
    typeof valor === 'number' &&
    Number.isFinite(valor) &&
    valor >= -maximo &&
    valor <= maximo
  );
}

/**
 * El cuerpo JSON de la Geocoding API, a un resultado del dominio. Puro: se
 * prueba con JSON de ejemplo.
 *
 * Nunca copia `error_message` de Google al `detalle`: el `detalle` acaba en el
 * log y lo unico que hace falta ahi es el `status`.
 */
export function interpretarRespuestaGoogle(
  cuerpo: unknown,
): ResultadoGeocodificacion {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
    return {
      estado: 'error',
      detalle:
        'Google respondió algo que no es una respuesta de geocodificación.',
    };
  }
  const { status, results } = cuerpo as { status?: unknown; results?: unknown };

  if (status === 'ZERO_RESULTS') return { estado: 'no-encontrada' };
  if (typeof status !== 'string') {
    return { estado: 'error', detalle: 'Google respondió sin status.' };
  }
  if (status !== 'OK') {
    return { estado: 'error', detalle: `Google respondió ${status}.` };
  }

  const primero: unknown = Array.isArray(results) ? results[0] : undefined;
  const geometria = (primero as { geometry?: GeometriaGoogle } | undefined)
    ?.geometry;
  const lat = geometria?.location?.lat;
  const lng = geometria?.location?.lng;
  if (!enRango(lat, 90) || !enRango(lng, 180)) {
    return {
      estado: 'error',
      detalle: 'Google respondió OK sin una coordenada legible.',
    };
  }

  const tipo = geometria?.location_type;
  if (tipo === 'APPROXIMATE') return { estado: 'imprecisa' };
  if (typeof tipo !== 'string' || !TIPOS_PRECISOS.includes(tipo)) {
    return {
      estado: 'error',
      detalle: 'Google respondió un location_type desconocido.',
    };
  }
  return { estado: 'ok', lat: redondear6(lat), lng: redondear6(lng) };
}

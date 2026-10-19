import { esInstante } from './datos-jornada';

/**
 * Validacion y normalizacion de `datos` de una visita sin venta (T-39, D3).
 *
 * Pura, sin base de datos: decide la FORMA. Que el motivo exista y que el id
 * este libre lo decide `VisitasService` dentro de la transaccion. Comprueba lo
 * que haria reventar a Postgres (un uuid mal formado, una coordenada fuera de
 * `numeric(9,6)`, un instante que no existe) por la misma razon que
 * `datos-jornada.ts`: un 500 tumba el lote y la tablet reintentaria para siempre.
 */

export const LARGO_MAX_OBSERVACIONES = 500;
export const LARGO_MAX_ATENDIO = 120;
export const LARGO_MAX_DIRECCION = 300;

/** La visita ya validada. Id, vendedor, sucursal, cliente y fecha viajan en el contexto. */
export interface VisitaNormalizada {
  /** uuid en minusculas. */
  motivoVisitaId: string;
  /** ISO-8601 en UTC (`toISOString`). */
  visitadaEn: string;
  observaciones: string | null;
  atendio: string | null;
  lat: number | null;
  lng: number | null;
  precisionM: number | null;
  direccionTexto: string | null;
}

export type ResultadoDatosVisita =
  | { ok: true; visita: VisitaNormalizada }
  /** El `motivo` empieza por el campo: es lo que guarda la tablet en `sync_error`. */
  | { ok: false; motivo: string };

/** Exportada para que `despacho-visita.ts` valide la clave sin copiar la regex. */
export const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Campo<T> = { ok: true; valor: T } | { ok: false; motivo: string };

/** Texto opcional: ausente o `null` es `null`; recortado; vacio es `null`. */
function textoOpcional(
  campo: string,
  valor: unknown,
  maximo: number,
): Campo<string | null> {
  if (valor === undefined || valor === null) return { ok: true, valor: null };
  if (typeof valor !== 'string') {
    return { ok: false, motivo: `${campo}: tiene que ser texto o null.` };
  }
  const limpio = valor.trim();
  if (limpio.length > maximo) {
    return {
      ok: false,
      motivo: `${campo}: no puede pasar de ${maximo} caracteres.`,
    };
  }
  return { ok: true, valor: limpio === '' ? null : limpio };
}

/** Numero opcional y finito dentro de `[min, max]`; ausente o `null` es `null`. */
function numeroOpcional(
  campo: string,
  valor: unknown,
  min: number,
  max: number,
): Campo<number | null> {
  if (valor === undefined || valor === null) return { ok: true, valor: null };
  if (
    typeof valor !== 'number' ||
    !Number.isFinite(valor) ||
    valor < min ||
    valor > max
  ) {
    return {
      ok: false,
      motivo: `${campo}: tiene que ser un número entre ${min} y ${max}, o null.`,
    };
  }
  return { ok: true, valor };
}

/** Valida y normaliza `datos` de una operacion `visita`. */
export function normalizarDatosVisita(
  datos: Record<string, unknown>,
): ResultadoDatosVisita {
  const motivo = datos.motivo_visita_id;
  if (typeof motivo !== 'string' || !RE_UUID.test(motivo)) {
    return {
      ok: false,
      motivo:
        'motivo_visita_id: tiene que ser el uuid de un motivo del catálogo.',
    };
  }

  const visitadaEn = datos.visitada_en;
  if (!esInstante(visitadaEn)) {
    return {
      ok: false,
      motivo:
        'visitada_en: tiene que ser un instante ISO-8601 con zona (por ejemplo 2026-10-17T18:40:00Z).',
    };
  }

  const observaciones = textoOpcional(
    'observaciones',
    datos.observaciones,
    LARGO_MAX_OBSERVACIONES,
  );
  if (!observaciones.ok) return observaciones;
  const atendio = textoOpcional('atendio', datos.atendio, LARGO_MAX_ATENDIO);
  if (!atendio.ok) return atendio;
  const direccion = textoOpcional(
    'direccion_texto',
    datos.direccion_texto,
    LARGO_MAX_DIRECCION,
  );
  if (!direccion.ok) return direccion;

  const lat = numeroOpcional('lat', datos.lat, -90, 90);
  if (!lat.ok) return lat;
  const lng = numeroOpcional('lng', datos.lng, -180, 180);
  if (!lng.ok) return lng;
  // Media coordenada no ubica nada (mismo criterio que el prospecto, T-40).
  if ((lat.valor === null) !== (lng.valor === null)) {
    return {
      ok: false,
      motivo: 'lat: la ubicación va completa (lat y lng) o no va.',
    };
  }
  const precision = numeroOpcional(
    'precision_m',
    datos.precision_m,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (!precision.ok) return precision;

  // Sin GPS, la visita exige una direccion escrita (respuesta 2 de Mario).
  if (lat.valor === null && direccion.valor === null) {
    return {
      ok: false,
      motivo:
        'direccion_texto: sin lat/lng la visita necesita la dirección o una referencia escrita.',
    };
  }

  return {
    ok: true,
    visita: {
      motivoVisitaId: motivo.toLowerCase(),
      visitadaEn: new Date(visitadaEn).toISOString(),
      observaciones: observaciones.valor,
      atendio: atendio.valor,
      lat: lat.valor,
      lng: lng.valor,
      precisionM: precision.valor,
      direccionTexto: direccion.valor,
    },
  };
}

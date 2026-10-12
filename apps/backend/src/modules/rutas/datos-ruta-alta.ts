/**
 * Validacion y normalizacion de `datos` de un alta de ruta (T-37, D13).
 *
 * Pura, sin base de datos: decide si el alta tiene la FORMA correcta. Que el
 * cliente exista, sea de la sucursal del vendedor y no sea prospecto, y que no
 * este ya en la ruta de ese dia, lo decide `RutasDiariasService` dentro de la
 * transaccion.
 *
 * Comprueba el uuid ANTES de consultar por la misma razon que `operaciones.ts`:
 * `where id = 'no-soy-uuid'` hace que Postgres reviente con un 500 para todo el
 * lote, y la tablet traduce un 5xx a "sin red" y reintentaria para siempre.
 */

/** El alta ya validada. Vendedor, sucursal y fecha viajan en el `contexto`. */
export interface RutaAltaNormalizada {
  /** uuid en minusculas (Postgres los devuelve asi). */
  clienteId: string;
}

export type ResultadoDatosRutaAlta =
  | { ok: true; alta: RutaAltaNormalizada }
  /** El `motivo` empieza por el campo: es lo que guarda la tablet en `sync_error`. */
  | { ok: false; motivo: string };

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida y normaliza `datos` de una operacion `ruta-alta`. */
export function normalizarDatosRutaAlta(
  datos: Record<string, unknown>,
): ResultadoDatosRutaAlta {
  const clienteId = datos.cliente_id;
  if (typeof clienteId !== 'string' || !RE_UUID.test(clienteId)) {
    return {
      ok: false,
      motivo: 'cliente_id: tiene que ser el uuid de un cliente de tu sucursal.',
    };
  }
  return { ok: true, alta: { clienteId: clienteId.toLowerCase() } };
}

import { esInstante } from '../rutas/datos-jornada';
import { RE_UUID } from '../rutas/datos-visita';

/**
 * Validacion y normalizacion de `datos` de un gasto de la ruta (T-30/T-31, D5).
 *
 * Pura, sin base: decide la FORMA. Que el campo exista y que el id este libre
 * lo decide `GastosService` dentro de la transaccion. Comprueba lo que haria
 * reventar a Postgres (un uuid mal formado, un monto fuera de `numeric(14,2)`,
 * un instante que no existe): un 500 tumba el lote y la tablet reintentaria
 * para siempre.
 */

export const LARGO_MAX_COMENTARIO_GASTO = 200;
/** 9,999,999,999.99 pesos: lo que cabe en `numeric(14,2)` con margen, igual que la cobranza. */
export const MAX_MONTO_GASTO_CENTAVOS = 999_999_999_999;

/** El gasto ya validado. Id, vendedor, sucursal y fecha viajan en el contexto. */
export interface GastoNormalizado {
  /** uuid en minusculas. */
  campoEgresoId: string;
  montoCentavos: number;
  /** ISO-8601 en UTC (`toISOString`). */
  registradoEn: string;
  comentario: string | null;
}

export type ResultadoDatosGasto =
  | { ok: true; gasto: GastoNormalizado }
  /** El `motivo` empieza por el campo: es lo que guarda la tablet en `sync_error`. */
  | { ok: false; motivo: string };

/** Valida y normaliza `datos` de una operacion `gasto`. */
export function normalizarDatosGasto(
  datos: Record<string, unknown>,
): ResultadoDatosGasto {
  const campo = datos.campo_egreso_id;
  if (typeof campo !== 'string' || !RE_UUID.test(campo)) {
    return {
      ok: false,
      motivo:
        'campo_egreso_id: tiene que ser el uuid de un campo de egreso del catálogo.',
    };
  }

  const monto = datos.monto_centavos;
  if (
    typeof monto !== 'number' ||
    !Number.isInteger(monto) ||
    monto < 1 ||
    monto > MAX_MONTO_GASTO_CENTAVOS
  ) {
    return {
      ok: false,
      motivo: `monto_centavos: tiene que ser un entero de 1 a ${MAX_MONTO_GASTO_CENTAVOS} (centavos).`,
    };
  }

  const registradoEn = datos.registrado_en;
  if (!esInstante(registradoEn)) {
    return {
      ok: false,
      motivo:
        'registrado_en: tiene que ser un instante ISO-8601 con zona (por ejemplo 2026-10-20T18:40:00Z).',
    };
  }

  let comentario: string | null = null;
  const crudo = datos.comentario;
  if (crudo !== undefined && crudo !== null) {
    if (typeof crudo !== 'string') {
      return { ok: false, motivo: 'comentario: tiene que ser texto o null.' };
    }
    const limpio = crudo.trim();
    if (limpio.length > LARGO_MAX_COMENTARIO_GASTO) {
      return {
        ok: false,
        motivo: `comentario: no puede pasar de ${LARGO_MAX_COMENTARIO_GASTO} caracteres.`,
      };
    }
    comentario = limpio === '' ? null : limpio;
  }

  return {
    ok: true,
    gasto: {
      campoEgresoId: campo.toLowerCase(),
      montoCentavos: monto,
      registradoEn: new Date(registradoEn).toISOString(),
      comentario,
    },
  };
}

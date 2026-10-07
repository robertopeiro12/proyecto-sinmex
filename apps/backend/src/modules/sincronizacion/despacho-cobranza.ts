import type { RazonRechazoCobranza } from '../ventas-cobranza/cobranza-rechazada';
import {
  normalizarDatosCobranza,
  type CobranzaNormalizada,
} from '../ventas-cobranza/datos-cobranza';
import type { CodigoRechazo } from './contrato';
import type { OperacionNormalizada, Rechazo } from './operaciones';

/**
 * La parte del despachador que es de la cobranza (T-20), en su propio archivo
 * para que `despacho.ts` se quede en un `case` de tres lineas por tipo (acuerdo
 * con T-40). Puro, sin base.
 */

export type PreparacionCobranza =
  { ok: true; cobranza: CobranzaNormalizada } | ({ ok: false } & Rechazo);

/**
 * Valida la FORMA de una cobranza antes de abrir la transaccion. Un rechazo
 * aqui no toca la base.
 */
export function prepararCobranza(
  op: OperacionNormalizada,
): PreparacionCobranza {
  // T-21: sin comprobacion de folio. La cobranza no lleva folio, y el que
  // mande una tablet sin actualizar ya lo descarto `normalizarOperacion`.
  const r = normalizarDatosCobranza(op.clienteId, op.fechaOperacion, op.datos);
  if (!r.ok) {
    return { ok: false, codigo: 'datos-invalidos', motivo: r.motivo };
  }
  return { ok: true, cobranza: r.cobranza };
}

/**
 * Razon del dominio a codigo del contrato. Un `Record`: si ventas-cobranza
 * agrega una razon, esto deja de compilar hasta asignarle codigo.
 */
export const CODIGO_POR_RAZON_COBRANZA: Record<
  RazonRechazoCobranza,
  CodigoRechazo
> = {
  'nota-no-encontrada': 'nota-no-encontrada',
};

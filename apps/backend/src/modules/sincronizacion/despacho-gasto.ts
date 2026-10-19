import {
  normalizarDatosGasto,
  type GastoNormalizado,
} from '../compras-egresos/datos-gasto';
import type { RazonRechazoGasto } from '../compras-egresos/gasto-rechazado';
import { RE_UUID } from '../rutas/datos-visita';
import type { CodigoRechazo } from './contrato';
import type { OperacionNormalizada, Rechazo } from './operaciones';

/**
 * La parte del despachador que es del gasto de la ruta (T-30/T-31), en su
 * propio archivo para que `despacho.ts` se quede en un `case` corto por tipo
 * (acuerdo de T-40). Puro, sin base.
 */

export type PreparacionGasto =
  { ok: true; gasto: GastoNormalizado } | ({ ok: false } & Rechazo);

export function prepararGasto(op: OperacionNormalizada): PreparacionGasto {
  // Un gasto no es una nota que nadie firme: con folio ocuparia un numero de
  // la serie de ventas en `sync_operacion.folio` (mismo criterio que T-40/T-39).
  if (op.folio !== null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo: 'folio: un gasto no lleva folio; no es una nota que nadie firme.',
    };
  }

  // D5: un gasto no es de un cliente. Si la tablet manda uno es un bug.
  if (op.clienteId !== null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo: 'cliente_id: un gasto no es de un cliente; el sobre no lo lleva.',
    };
  }

  // La clave ES el id del gasto (D4, como la visita en T-39): la foto del
  // ticket se liga a ella. `gasto.id` es uuid, asi que la clave tiene que serlo.
  if (!RE_UUID.test(op.clave)) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'clave: la clave de un gasto debe ser un uuid; es el id con el que la tablet ya lo registró.',
    };
  }

  const r = normalizarDatosGasto(op.datos);
  if (!r.ok) return { ok: false, codigo: 'datos-invalidos', motivo: r.motivo };
  return { ok: true, gasto: r.gasto };
}

/** Razon del dominio a codigo del contrato. Un `Record`: una razon nueva no compila sin codigo. */
export const CODIGO_POR_RAZON_GASTO: Record<RazonRechazoGasto, CodigoRechazo> =
  {
    'campo-egreso-inexistente': 'campo-egreso-inexistente',
    'gasto-id-ocupado': 'gasto-id-ocupado',
  };

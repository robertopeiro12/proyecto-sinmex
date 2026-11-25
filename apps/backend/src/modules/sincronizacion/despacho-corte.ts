import type { RazonRechazoCorte } from '../rutas/corte-rechazado';
import {
  normalizarDatosCorte,
  type CorteNormalizado,
} from '../rutas/datos-corte';
import { RE_UUID } from '../rutas/datos-visita';
import type { CodigoRechazo } from './contrato';
import type { OperacionNormalizada, Rechazo } from './operaciones';

/**
 * La parte del despachador que es del corte del vendedor (rediseño pieza 6), en
 * su propio archivo para que `despacho.ts` se quede en un `case` corto por tipo
 * (acuerdo de T-40). Puro, sin base.
 */

export type PreparacionCorte =
  { ok: true; corte: CorteNormalizado } | ({ ok: false } & Rechazo);

export function prepararCorte(op: OperacionNormalizada): PreparacionCorte {
  // El corte no es una nota que nadie firme: con folio ocuparia un numero de la
  // serie de ventas en `sync_operacion.folio` (mismo criterio que gasto y visita).
  if (op.folio !== null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo: 'folio: un corte no lleva folio; no es una nota que nadie firme.',
    };
  }
  if (op.clienteId !== null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo: 'cliente_id: un corte no es de un cliente; el sobre no lo lleva.',
    };
  }
  // La clave ES el id de `corte_vendedor` (uuid), como el gasto y el movimiento.
  if (!RE_UUID.test(op.clave)) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'clave: la clave de un corte debe ser un uuid; es el id con el que la tablet ya lo registró.',
    };
  }

  const r = normalizarDatosCorte(op.datos);
  if (!r.ok) return { ok: false, codigo: 'datos-invalidos', motivo: r.motivo };
  return { ok: true, corte: r.corte };
}

/** Razon del dominio a codigo del contrato. Un `Record`: una razon nueva no compila sin codigo. */
export const CODIGO_POR_RAZON_CORTE: Record<RazonRechazoCorte, CodigoRechazo> =
  {
    'corte-duplicado': 'corte-duplicado',
    // Neutro, como el `id-ocupado` del prospecto (T-75): no confirma que exista nada.
    'id-ocupado': 'datos-invalidos',
  };

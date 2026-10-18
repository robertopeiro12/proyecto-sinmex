import {
  normalizarDatosVisita,
  RE_UUID,
  type VisitaNormalizada,
} from '../rutas/datos-visita';
import type { RazonRechazoVisita } from '../rutas/visita-rechazada';
import type { CodigoRechazo } from './contrato';
import type { OperacionNormalizada, Rechazo } from './operaciones';

/**
 * La parte del despachador que es de la visita sin venta (T-39), en su propio
 * archivo para que `despacho.ts` se quede en un `case` corto por tipo (acuerdo
 * de T-40). Puro, sin base.
 */

export type PreparacionVisita =
  | { ok: true; visita: VisitaNormalizada; clienteId: string }
  | ({ ok: false } & Rechazo);

export function prepararVisita(op: OperacionNormalizada): PreparacionVisita {
  // Una visita no es una nota que nadie firme: con folio ocuparia un numero de
  // la serie de ventas en `sync_operacion.folio` (mismo criterio que T-40).
  if (op.folio !== null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'folio: una visita no lleva folio; no es una nota que el cliente firme.',
    };
  }

  // El cliente va en el sobre (D3): asi el alcance del lote ya lo comprobo.
  if (op.clienteId === null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo: 'cliente_id: una visita va en el sobre con el cliente visitado.',
    };
  }

  // La clave ES el id de la visita (D2, como el prospecto en T-75): la foto se
  // liga a ella. `visita.id` es uuid, asi que la clave tiene que serlo.
  if (!RE_UUID.test(op.clave)) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'clave: la clave de una visita debe ser un uuid; es el id con el que la tablet ya la registró.',
    };
  }

  const r = normalizarDatosVisita(op.datos);
  if (!r.ok) return { ok: false, codigo: 'datos-invalidos', motivo: r.motivo };
  return { ok: true, visita: r.visita, clienteId: op.clienteId };
}

/** Razon del dominio a codigo del contrato. Un `Record`: una razon nueva no compila sin codigo. */
export const CODIGO_POR_RAZON_VISITA: Record<
  RazonRechazoVisita,
  CodigoRechazo
> = {
  'motivo-visita-inexistente': 'motivo-visita-inexistente',
  'visita-id-ocupado': 'visita-id-ocupado',
};

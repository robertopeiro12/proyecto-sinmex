import {
  normalizarDatosNotaNoCobrada,
  type NotaNoCobradaNormalizada,
} from '../rutas/datos-nota-no-cobrada';
import { RE_UUID } from '../rutas/datos-visita';
import type { RazonRechazoNotaNoCobrada } from '../rutas/nota-no-cobrada-rechazada';
import type { CodigoRechazo } from './contrato';
import type { OperacionNormalizada, Rechazo } from './operaciones';

/**
 * La parte del despachador que es del comentario "no cobre" de una nota
 * asignada, en su propio archivo como `despacho-visita.ts`. Puro, sin base.
 */

export type PreparacionNotaNoCobrada =
  | { ok: true; nota: NotaNoCobradaNormalizada; clienteId: string }
  | ({ ok: false } & Rechazo);

export function prepararNotaNoCobrada(
  op: OperacionNormalizada,
): PreparacionNotaNoCobrada {
  // Un comentario no es una nota que nadie firme: con folio ocuparia un numero
  // de la serie de ventas en `sync_operacion.folio`.
  if (op.folio !== null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'folio: un comentario de nota no cobrada no lleva folio; no es una nota que el cliente firme.',
    };
  }

  // El cliente va en el sobre: asi el alcance del lote ya lo comprobo.
  if (op.clienteId === null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'cliente_id: un comentario de nota no cobrada va en el sobre con el cliente de la nota.',
    };
  }

  // La clave ES el id de la fila (como la visita): tiene que ser uuid.
  if (!RE_UUID.test(op.clave)) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'clave: la clave de un comentario de nota no cobrada debe ser un uuid; es el id con el que la tablet ya lo registró.',
    };
  }

  const r = normalizarDatosNotaNoCobrada(op.datos);
  if (!r.ok) return { ok: false, codigo: 'datos-invalidos', motivo: r.motivo };
  return { ok: true, nota: r.nota, clienteId: op.clienteId };
}

/** Razon del dominio a codigo del contrato. Un `Record`: una razon nueva no compila sin codigo. */
export const CODIGO_POR_RAZON_NOTA_NO_COBRADA: Record<
  RazonRechazoNotaNoCobrada,
  CodigoRechazo
> = {
  'nota-no-encontrada': 'nota-no-encontrada',
  'nota-no-cobrada-id-ocupado': 'nota-no-cobrada-id-ocupado',
};

import {
  normalizarDatosMovimiento,
  type MovimientoNormalizado,
} from '../inventario/datos-movimiento';
import type { RazonRechazoMovimiento } from '../inventario/movimiento-rechazado';
import { RE_UUID } from '../rutas/datos-visita';
import type { CodigoRechazo } from './contrato';
import type { OperacionNormalizada, Rechazo } from './operaciones';

/**
 * La parte del despachador que es del movimiento de inventario (T-27 pieza 2),
 * en su propio archivo para que `despacho.ts` se quede en un `case` corto por
 * tipo (acuerdo de T-40). Puro, sin base.
 */

export type PreparacionMovimiento =
  | {
      ok: true;
      movimiento: MovimientoNormalizado;
      /** El del sobre: solo en la merma del cliente (ya paso por el alcance del lote). */
      clienteId: string | null;
    }
  | ({ ok: false } & Rechazo);

export function prepararMovimiento(
  op: OperacionNormalizada,
): PreparacionMovimiento {
  // Con folio ocuparia un numero de la serie de ventas en `sync_operacion.folio`
  // (mismo criterio que T-40/T-39/T-30).
  if (op.folio !== null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'folio: un movimiento no lleva folio; no es una nota que nadie firme.',
    };
  }

  // La clave ES el id del movimiento (como la visita y el gasto).
  if (!RE_UUID.test(op.clave)) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'clave: la clave de un movimiento debe ser un uuid; es el id con el que la tablet ya lo registró.',
    };
  }

  const r = normalizarDatosMovimiento(op.datos);
  if (!r.ok) return { ok: false, codigo: 'datos-invalidos', motivo: r.motivo };

  // Solo la merma del cliente es de un cliente (`ck_movimiento_cliente`).
  const esDelCliente = r.movimiento.tipo === 'merma_cliente';
  if (esDelCliente && op.clienteId === null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'cliente_id: una merma del cliente va en el sobre con el cliente que devolvió el producto.',
    };
  }
  if (!esDelCliente && op.clienteId !== null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'cliente_id: la merma del trayecto y el consumo no son de un cliente; el sobre no lo lleva.',
    };
  }

  return { ok: true, movimiento: r.movimiento, clienteId: op.clienteId };
}

/**
 * Razon del dominio a codigo del contrato. Un `Record`: una razon nueva no
 * compila sin codigo. La presentacion inexistente es un bug de la tablet:
 * `datos-invalidos` (spec), con el motivo que nombra `lineas`.
 */
export const CODIGO_POR_RAZON_MOVIMIENTO: Record<
  RazonRechazoMovimiento,
  CodigoRechazo
> = {
  'presentacion-inexistente': 'datos-invalidos',
  'movimiento-id-ocupado': 'movimiento-id-ocupado',
};

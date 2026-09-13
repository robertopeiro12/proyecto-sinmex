import { esViolacionUnicidad } from '../../database/errores-postgres';
import {
  normalizarDatosVenta,
  type VentaNormalizada,
} from '../ventas-cobranza/datos-venta';
import type { RazonRechazoVenta } from '../ventas-cobranza/venta-rechazada';
import type { CodigoRechazo } from './contrato';
import type { OperacionNormalizada, Rechazo } from './operaciones';

/**
 * El despachador de `push` (T-16, ADR-0009 §2.1), en la parte que no toca la
 * base: que hay que proyectar por cada `tipo`, como se traduce un rechazo del
 * dominio y que error es una colision de folio. Puro, para poder probarse sin
 * Postgres.
 */

/**
 * Lo que un modulo de dominio tiene que proyectar para una operacion.
 *
 * Un `tipo` sin modulo todavia (`jornada`, `cobranza`, `gasto`, `merma`, `ruta`)
 * no tiene proyeccion: se guarda en el buzon y queda `aplicada`, como desde
 * T-07. T-20 agregara aqui `{ tipo: 'cobranza'; ... }`.
 */
export type Proyeccion = { tipo: 'venta'; venta: VentaNormalizada };

export type ResultadoPreparacion =
  { ok: true; proyeccion: Proyeccion | null } | ({ ok: false } & Rechazo);

/**
 * Valida la FORMA de `datos` segun el `tipo`, antes de abrir la transaccion.
 *
 * Un rechazo aqui no toca la base. El `switch` enumera los seis tipos a
 * proposito: cuando el contrato sume uno, TypeScript obliga a decidir aqui si
 * tiene proyeccion.
 */
export function prepararProyeccion(
  op: OperacionNormalizada,
): ResultadoPreparacion {
  switch (op.tipo) {
    case 'venta': {
      // El folio es opcional en el sobre (la jornada no lo lleva), pero una
      // venta sin folio no se puede cotejar contra su nota fisica.
      if (op.folio === null) {
        return {
          ok: false,
          codigo: 'datos-invalidos',
          motivo:
            'folio: una venta necesita el folio que la tablet emitio para su nota fisica.',
        };
      }
      const r = normalizarDatosVenta(op.clienteId, op.datos);
      if (!r.ok) {
        return { ok: false, codigo: 'datos-invalidos', motivo: r.motivo };
      }
      return { ok: true, proyeccion: { tipo: 'venta', venta: r.venta } };
    }
    // T-40: el tipo ya viaja en el contrato, pero su proyeccion
    // (`ClientesService.crearProspecto`) llega mas adelante en esta misma rama.
    // Hasta entonces se guarda en el buzon y queda `aplicada`, como cualquier
    // tipo que todavia no tiene modulo de dominio.
    case 'prospecto':
    case 'jornada':
    case 'cobranza':
    case 'gasto':
    case 'merma':
    case 'ruta':
      return { ok: true, proyeccion: null };
  }
}

/**
 * Razon del dominio a codigo del contrato (D12).
 *
 * Un `Record` y no un `switch`: si ventas-cobranza agrega una razon, esto deja
 * de compilar hasta que alguien le asigne su codigo.
 */
export const CODIGO_POR_RAZON: Record<RazonRechazoVenta, CodigoRechazo> = {
  'cliente-fuera-de-alcance': 'cliente-fuera-de-alcance',
  'presentacion-inactiva': 'presentacion-inactiva',
  'precio-no-asignado': 'precio-no-asignado',
};

/**
 * Los unique cuyo `23505` significa "ese folio ya lo tiene otra operacion": el
 * del buzon (T-14) y el de `venta_nota` (T-05). El del buzon salta primero,
 * porque la fila del buzon se escribe antes que la venta; el de `venta_nota`
 * cubre una venta que no nacio del push (el portal, T-17).
 */
const RESTRICCIONES_DE_FOLIO: readonly string[] = [
  'uq_sync_operacion_folio',
  'venta_nota_folio_key',
];

/**
 * ¿Este error es una colision de folio?
 *
 * Solo esas dos restricciones. Cualquier otro `23505` dentro de la transaccion
 * es un bug (la forma de `datos` ya descarto, por ejemplo, la presentacion
 * repetida) y tiene que salir como 500, no disfrazarse de `folio-duplicado`.
 * El `unique (vendedor_id, clave_idempotencia)` nunca llega aqui: lo absorbe el
 * `on conflict do nothing`.
 */
export function esColisionDeFolio(error: unknown): boolean {
  if (!esViolacionUnicidad(error)) return false;
  const restriccion = (error as { constraint?: unknown }).constraint;
  return (
    typeof restriccion === 'string' &&
    RESTRICCIONES_DE_FOLIO.includes(restriccion)
  );
}

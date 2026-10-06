import {
  esViolacionUnicidad,
  restriccionDelError,
} from '../../database/errores-postgres';

/**
 * El # de la nota fisica no se repite dentro de la sucursal (#95, T-17).
 *
 * Lo decide el indice de la base, no una consulta previa: entre un SELECT y el
 * INSERT cabria otra venta con el mismo numero. Aqui solo se reconoce su
 * `23505` para traducirlo: `num-nota-duplicada` en el push de la tablet, 409
 * en el portal. Vive en ventas-cobranza y no en sincronizacion porque la regla
 * es de la venta, venga de donde venga (ADR-0009).
 */
export const RESTRICCION_NUM_NOTA = 'uq_venta_nota_num_nota_sucursal';

export function esNotaDuplicada(error: unknown): boolean {
  return (
    esViolacionUnicidad(error) &&
    restriccionDelError(error) === RESTRICCION_NUM_NOTA
  );
}

/** El mismo texto para la tablet y para el portal. */
export function motivoNotaDuplicada(numNota: string): string {
  return `Ya existe la nota ${numNota} en esta sucursal.`;
}

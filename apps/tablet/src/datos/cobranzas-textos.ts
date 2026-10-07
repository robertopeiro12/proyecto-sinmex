import type { Reparto } from './cobranzas-reglas';
import type { MetodoPagoAbono } from './tipos';

/**
 * Como se le dice al vendedor el metodo de un abono (T-20, T-21).
 *
 * Los del cobro van en minusculas porque se leen dentro de una frase ("en
 * efectivo"). `saldo_favor` lo introdujo T-21: la oficina aplico saldo a favor
 * a esa nota desde el portal; la tablet solo lo muestra.
 */
export const NOMBRE_METODO: Record<MetodoPagoAbono, string> = {
  efectivo: 'efectivo',
  transferencia: 'transferencia',
  cheque: 'cheque',
  saldo_favor: 'Saldo a favor',
};

/** Una nota que recibio dinero de un cobro, lista para pintarse. */
export interface LineaDeCobro {
  notaId: string;
  folio: string;
  montoCentavos: number;
  saldoDespuesCentavos: number;
}

/**
 * El reparto con el folio de cada nota (T-21: la vista final del cobro muestra
 * el monto y como quedaron las notas, ya no un folio del cobro).
 *
 * Hay que calcularlo ANTES de grabar: una nota que queda en 0 sale de las
 * pendientes (`activo = 0`) y despues ya no se encontraria su folio.
 */
export function lineasDelCobro(
  reparto: Reparto,
  notas: readonly { id: string; folio: string }[],
): LineaDeCobro[] {
  const folios = new Map(notas.map((n) => [n.id, n.folio]));
  return reparto.aplicaciones.map((a) => ({
    notaId: a.notaId,
    folio: folios.get(a.notaId) ?? a.notaId,
    montoCentavos: a.montoCentavos,
    saldoDespuesCentavos: a.saldoDespuesCentavos,
  }));
}

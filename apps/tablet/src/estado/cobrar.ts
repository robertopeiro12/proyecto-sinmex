/** Reglas puras de la pantalla Cobrar (rediseño, pieza 2). */
import type { NotaAsignadaDeHoy } from '@/datos/notas-asignadas-reglas';
import type { NotaPendiente } from '@/datos/tipos';

import { montoACentavos } from './gasto';
import { notaParaCobrar } from './notas-asignadas';

/** La pedida si esta; si no, la que deja la asignacion; si no, la mas antigua. */
export function notaAlFrente(
  notas: readonly NotaPendiente[],
  asignadas: NotaAsignadaDeHoy[],
  notaIdPedida: string | null,
): NotaPendiente | null {
  const pedida = notaIdPedida ? notas.find((n) => n.id === notaIdPedida) : undefined;
  if (pedida) return pedida;
  const idAsignada = notaParaCobrar(asignadas);
  const asignada = idAsignada ? notas.find((n) => n.id === idAsignada) : undefined;
  if (asignada) return asignada;
  return [...notas].sort((a, b) => a.fecha.localeCompare(b.fecha))[0] ?? null;
}

export type OpcionCobro = 'liquidar' | 'abonar';

export function validarCobro({
  opcion,
  montoTexto,
  saldoCentavos,
}: {
  opcion: OpcionCobro;
  montoTexto: string;
  saldoCentavos: number;
}): { problemas: string[]; montoCentavos: number | null } {
  if (opcion === 'liquidar') return { problemas: [], montoCentavos: saldoCentavos };
  const monto = montoACentavos(montoTexto);
  if (monto === null) return { problemas: ['Escribe cuánto abona el cliente.'], montoCentavos: null };
  if (monto >= saldoCentavos) {
    return {
      problemas: ['El abono tiene que ser menor al saldo; si paga todo, elige Liquidar.'],
      montoCentavos: null,
    };
  }
  return { problemas: [], montoCentavos: monto };
}

export function textoOtrasNotas(n: number): string {
  return `Otras notas pendientes · ${n}`;
}

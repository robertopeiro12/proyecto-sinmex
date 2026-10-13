import { saldoDerivadoCentavos } from './reglas-cobranza';

/**
 * Reglas puras de borrar un pago (T-34), sin base de datos ni Nest.
 *
 * Se borra el pago COMPLETO (decision de Roberto, 2026-10-13): todas sus filas
 * en notas y su movimiento de saldo a favor. Esta regla no decide nada de
 * candados ni de permisos: con lo que hay hoy dice como quedaria cada nota y
 * el saldo a favor, y si algo lo impide. La vista previa y el borrado la llaman
 * sobre lo bloqueado (`CobrosBorradoService.planear`).
 */

export const MOTIVO_SALDO_FAVOR_APLICADO =
  'El saldo a favor que dejó este pago ya se aplicó a otras notas. Primero borra el pago que lo aplicó.';

export type StatusNota = 'pendiente' | 'abonado' | 'pagada' | 'cuenta_perdida';

/** Una nota que recibio dinero de este pago, como esta hoy. */
export interface NotaDelPago {
  id: string;
  folio: string;
  numNota: string | null;
  /** `AAAA-MM-DD`. */
  fecha: string;
  /** El status de hoy, leido de la base. */
  status: string;
  montoTotalCentavos: number;
  /** Todo lo abonado vivo hoy, este pago incluido. */
  abonadoVivoCentavos: number;
  /** Lo que este pago le abono (sus filas vivas). */
  delPagoCentavos: number;
}

export interface EntradaBorrado {
  notas: NotaDelPago[];
  /** La suma de los movimientos vivos de saldo a favor del cliente, el del pago incluido. */
  saldoFavorVivoCentavos: number;
  /** El movimiento del pago: + excedente, - aplicacion, 0 si no movio saldo a favor. */
  movimientoDelPagoCentavos: number;
}

/** Como quedaria una nota del pago. */
export interface NotaTrasBorrar {
  notaId: string;
  folio: string;
  numNota: string | null;
  fecha: string;
  delPagoCentavos: number;
  saldoAntesCentavos: number;
  saldoDespuesCentavos: number;
  statusDespues: StatusNota;
}

export interface BloqueoBorrado {
  codigo: 'saldo-favor-aplicado';
  motivo: string;
}

export interface PlanBorrado {
  /** Por fecha y luego folio, como el resto de la cobranza. */
  notas: NotaTrasBorrar[];
  saldoFavorAntesCentavos: number;
  saldoFavorDespuesCentavos: number;
  /** `null` si se puede borrar. */
  bloqueo: BloqueoBorrado | null;
}

/**
 * El status de una nota sin las filas del pago. `cuenta_perdida` se queda: la
 * nota ya se dio por perdida y quitarle un cobro solo agranda lo perdido. Lo
 * demas sale de lo que le queda abonado vivo.
 */
export function statusTrasBorrar(
  statusActual: string,
  montoTotalCentavos: number,
  abonadoRestanteCentavos: number,
): StatusNota {
  if (statusActual === 'cuenta_perdida') return 'cuenta_perdida';
  if (abonadoRestanteCentavos <= 0) return 'pendiente';
  if (abonadoRestanteCentavos >= montoTotalCentavos) return 'pagada';
  return 'abonado';
}

function porFechaYFolio(a: NotaDelPago, b: NotaDelPago): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  if (a.folio !== b.folio) return a.folio < b.folio ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Que pasa si se borra el pago. Bloquea si el saldo a favor del cliente
 * quedaria negativo: el excedente que dejo este pago ya se uso en otra
 * aplicacion, y borrarlo seria regalar ese dinero dos veces.
 */
export function planearBorrado(entrada: EntradaBorrado): PlanBorrado {
  const notas = [...entrada.notas].sort(porFechaYFolio).map((n) => {
    const restante = n.abonadoVivoCentavos - n.delPagoCentavos;
    return {
      notaId: n.id,
      folio: n.folio,
      numNota: n.numNota,
      fecha: n.fecha,
      delPagoCentavos: n.delPagoCentavos,
      saldoAntesCentavos: saldoDerivadoCentavos(
        n.montoTotalCentavos,
        n.abonadoVivoCentavos,
      ),
      saldoDespuesCentavos: saldoDerivadoCentavos(
        n.montoTotalCentavos,
        restante,
      ),
      statusDespues: statusTrasBorrar(n.status, n.montoTotalCentavos, restante),
    };
  });

  const saldoFavorDespuesCentavos =
    entrada.saldoFavorVivoCentavos - entrada.movimientoDelPagoCentavos;

  return {
    notas,
    saldoFavorAntesCentavos: entrada.saldoFavorVivoCentavos,
    saldoFavorDespuesCentavos,
    bloqueo:
      saldoFavorDespuesCentavos < 0
        ? {
            codigo: 'saldo-favor-aplicado',
            motivo: MOTIVO_SALDO_FAVOR_APLICADO,
          }
        : null,
  };
}

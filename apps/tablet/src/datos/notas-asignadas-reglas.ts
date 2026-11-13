import type { CondicionVenta, FechaISO } from './tipos';

/**
 * Reglas puras de las notas asignadas (spec 2026-11-13, §2 reglas 9-11 y 15-17).
 * El repositorio (`repositorios/notas-asignadas.ts`) arma las filas; las
 * pantallas solo llaman a estas funciones.
 */

/** Una nota asignada hoy a un cliente, con lo que hace falta para decidir. */
export interface NotaAsignadaDeHoy {
  asignacionId: string;
  ventaNotaId: string;
  clienteId: string;
  folio: string;
  /** Fecha de la nota (no de la asignacion). */
  fecha: FechaISO;
  /** Saldo local de `nota_pendiente`; puede ser 0 (ya no se pide ni bloquea). */
  saldoCentavos: number;
  diasAtraso: number;
  condicion: CondicionVenta;
  /** Un cobro de hoy (`cobranza.fecha` = hoy) la toco en su `reparto_json`. */
  tocadaHoy: boolean;
  /**
   * Un cobro de hoy la dejo en saldo 0 (`saldo_despues_centavos` de su
   * `reparto_json`). Cumple `liquidar` aunque un pull que corrio antes del push
   * haya reescrito `nota_pendiente` con el saldo viejo. Implica `tocadaHoy`.
   */
  liquidadaHoy: boolean;
  /** Hoy se dejo al menos un "Continuar sin cobrar" sobre ella. */
  comentadaHoy: boolean;
}

export const MOTIVO_BLOQUEO_LIQUIDAR = 'Tiene una nota asignada que debe liquidar antes de venderle';
export const MOTIVO_BLOQUEO_ABONAR = 'Tiene una nota asignada que debe abonar antes de venderle';

/** Como se nombra la condicion en pantalla; `ninguna` no dice nada. */
export const ETIQUETA_CONDICION: Record<CondicionVenta, string | null> = {
  ninguna: null,
  liquidar: 'Debe liquidar',
  abonar: 'Debe abonar',
};

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Dias de una fecha `AAAA-MM-DD` contados en UTC (sin horario de verano). */
function diaNumero(fecha: string): number {
  const [a, m, d] = fecha.split('-').map(Number);
  return Math.round(Date.UTC(a ?? 0, (m ?? 1) - 1, d ?? 1) / MS_POR_DIA);
}

/** Dias vencidos: `max(0, hoy - (fecha + plazo))`; sin plazo, vence el dia de la nota. */
export function diasDeAtraso(fechaNota: string, plazoDias: number | null, hoy: string): number {
  return Math.max(0, diaNumero(hoy) - (diaNumero(fechaNota) + (plazoDias ?? 0)));
}

/**
 * Si la nota ya no detiene la venta. `liquidar` pide saldo 0 (o que un cobro
 * de hoy la haya dejado en 0); `abonar`, un
 * cobro de hoy que la toque (o saldo 0). El comentario nunca cumple.
 */
export function cumpleCondicion(n: NotaAsignadaDeHoy): boolean {
  switch (n.condicion) {
    case 'ninguna':
      return true;
    case 'liquidar':
      return n.saldoCentavos <= 0 || n.liquidadaHoy;
    case 'abonar':
      return n.tocadaHoy || n.saldoCentavos <= 0;
  }
}

/**
 * Las que la pantalla todavia pide atender: con saldo y sin cobro de hoy.
 * Regla 11: el comentario NO la saca de la lista.
 */
export function porAtender(notas: NotaAsignadaDeHoy[]): NotaAsignadaDeHoy[] {
  return notas.filter((n) => n.saldoCentavos > 0 && !n.tocadaHoy);
}

/** El motivo por el que la tablet no deja vender, o `null`. Liquidar gana. */
export function motivoBloqueoVenta(notas: NotaAsignadaDeHoy[]): string | null {
  const pendientes = notas.filter((n) => !cumpleCondicion(n));
  if (pendientes.some((n) => n.condicion === 'liquidar')) return MOTIVO_BLOQUEO_LIQUIDAR;
  if (pendientes.some((n) => n.condicion === 'abonar')) return MOTIVO_BLOQUEO_ABONAR;
  return null;
}

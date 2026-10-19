/**
 * T-29 — a que cuenta de Tesoreria entra la cobranza. Por sucursal y metodo hay
 * vigencias con fecha "desde"; para un pago se usa la vigente en su fecha. Cambiar
 * el destino es agregar otra vigencia: lo anterior no se mueve (spec §3.3).
 */

export type MetodoCobranza = 'efectivo' | 'transferencia' | 'cheque';

export const METODOS_COBRANZA: readonly MetodoCobranza[] = [
  'efectivo',
  'transferencia',
  'cheque',
];

export interface DestinoCobranza {
  id: string;
  sucursalId: string;
  sucursalCodigo: string;
  metodo: MetodoCobranza;
  cuentaId: string;
  cuentaNombre: string;
  /** `AAAA-MM-DD`. */
  desde: string;
}

/** La cobranza de un dia, una sucursal y un metodo, ya sumada (cobros + contado). */
export interface CobranzaDia {
  fecha: string;
  sucursalId: string;
  sucursalCodigo: string;
  metodo: MetodoCobranza;
  /** Cuantos pagos (cobros + ventas de contado) forman la suma. */
  cantidad: number;
  montoCentavos: number;
}

/** La vigencia viva de (sucursal, metodo) con la `desde` mas reciente <= `fecha`; si no hay, `null`. */
export function destinoDe(
  sucursalId: string,
  metodo: MetodoCobranza,
  fecha: string,
  destinos: DestinoCobranza[],
): DestinoCobranza | null {
  let elegido: DestinoCobranza | null = null;
  for (const d of destinos) {
    if (d.sucursalId !== sucursalId || d.metodo !== metodo || d.desde > fecha)
      continue;
    if (elegido === null || d.desde > elegido.desde) elegido = d;
  }
  return elegido;
}

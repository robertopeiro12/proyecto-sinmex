/**
 * Una cobranza que el DOMINIO no acepta (T-20).
 *
 * Igual que `VentaRechazada`: no importa nada del contrato de sincronizacion.
 * `push` la traduce a su codigo (`sincronizacion/despacho-cobranza.ts`) y el
 * portal de T-21 la traducira a HTTP.
 *
 * Hay una sola razon a proposito (D10): una nota ya pagada, cancelada o
 * borrada NO se rechaza — el dinero si se cobro y rechazarlo lo perderia (D9).
 */
export type RazonRechazoCobranza =
  /**
   * La nota no existe, su cliente no es de la sucursal del vendedor, o no es
   * del cliente que dice el sobre. Una cobranza sobre una venta que aun no se
   * proyecto cae aqui y se reenvia en cada sincronizacion.
   */
  'nota-no-encontrada';

export interface RechazoCobranza {
  razon: RazonRechazoCobranza;
  /** En el espanol que leera quien tenga la tablet en la mano. */
  motivo: string;
}

export class CobranzaRechazada extends Error {
  readonly razon: RazonRechazoCobranza;

  constructor({ razon, motivo }: RechazoCobranza) {
    super(motivo);
    this.name = 'CobranzaRechazada';
    this.razon = razon;
  }
}

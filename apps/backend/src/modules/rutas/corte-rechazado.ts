/**
 * Un corte del vendedor que el DOMINIO no acepta (rediseño pieza 6).
 *
 * Como `JornadaRechazada`: no importa nada del contrato de sincronizacion.
 * `push` la traduce a su codigo (`sincronizacion/despacho-corte.ts`). La forma
 * de `datos` se rechaza antes de abrir la transaccion (`datos-corte.ts`).
 */
export type RazonRechazoCorte =
  /** Ya hay un corte vivo de ese vendedor ese dia, subido con otra clave. */
  | 'corte-duplicado'
  /**
   * El id (la clave) ya lo ocupa otro registro que no es un corte de ese
   * vendedor ese dia. Motivo neutro, como el `id-ocupado` del prospecto (T-75).
   */
  | 'id-ocupado';

export class CorteRechazado extends Error {
  readonly razon: RazonRechazoCorte;

  constructor({ razon, motivo }: { razon: RazonRechazoCorte; motivo: string }) {
    super(motivo);
    this.name = 'CorteRechazado';
    this.razon = razon;
  }
}

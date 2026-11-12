/**
 * Un movimiento de inventario que el DOMINIO no acepta (T-27 pieza 2). Igual que
 * `GastoRechazado`: no importa nada del contrato; `push` la traduce a su codigo
 * (`sincronizacion/despacho-movimiento.ts`). La forma de `datos` no esta aqui:
 * se rechaza antes de abrir la transaccion (`datos-movimiento.ts`).
 */
export type RazonRechazoMovimiento =
  /**
   * Una linea nombra una presentacion que nunca existio (bug de la tablet). Una
   * dada de baja SI se acepta: las piezas ya salieron de la camioneta. Sale como
   * `datos-invalidos` (spec).
   */
  | 'presentacion-inexistente'
  /** El id (la clave) ya lo ocupa otro movimiento. */
  | 'movimiento-id-ocupado';

export interface RechazoMovimiento {
  razon: RazonRechazoMovimiento;
  /** En el espanol que leera quien tenga la tablet en la mano. */
  motivo: string;
}

export class MovimientoRechazado extends Error {
  readonly razon: RazonRechazoMovimiento;

  constructor({ razon, motivo }: RechazoMovimiento) {
    super(motivo);
    this.name = 'MovimientoRechazado';
    this.razon = razon;
  }
}

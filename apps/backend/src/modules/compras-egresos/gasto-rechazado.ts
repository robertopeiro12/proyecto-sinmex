/**
 * Un gasto que el DOMINIO no acepta (T-30/T-31). Igual que `VisitaRechazada`:
 * no importa nada del contrato; `push` la traduce a su codigo
 * (`sincronizacion/despacho-gasto.ts`). La forma de `datos` no esta aqui: se
 * rechaza antes de abrir la transaccion (`datos-gasto.ts`).
 */
export type RazonRechazoGasto =
  /** El `campo_egreso_id` no existe (uno dado de baja si se acepta, D5). */
  | 'campo-egreso-inexistente'
  /** El id (la clave) ya lo ocupa otro gasto. */
  | 'gasto-id-ocupado';

export interface RechazoGasto {
  razon: RazonRechazoGasto;
  /** En el espanol que leera quien tenga la tablet en la mano. */
  motivo: string;
}

export class GastoRechazado extends Error {
  readonly razon: RazonRechazoGasto;

  constructor({ razon, motivo }: RechazoGasto) {
    super(motivo);
    this.name = 'GastoRechazado';
    this.razon = razon;
  }
}

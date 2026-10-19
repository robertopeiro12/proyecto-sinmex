/**
 * Una visita que el DOMINIO no acepta (T-39). Igual que `RutaRechazada`: no
 * importa nada del contrato; `push` la traduce a su codigo
 * (`sincronizacion/despacho-visita.ts`). La forma de `datos` no esta aqui: se
 * rechaza antes de abrir la transaccion (`datos-visita.ts`).
 */
export type RazonRechazoVisita =
  /** El `motivo_visita_id` no existe (uno dado de baja si se acepta, D3). */
  | 'motivo-visita-inexistente'
  /** El id (la clave) ya lo ocupa otra visita. */
  | 'visita-id-ocupado';

export interface RechazoVisita {
  razon: RazonRechazoVisita;
  /** En el espanol que leera quien tenga la tablet en la mano. */
  motivo: string;
}

export class VisitaRechazada extends Error {
  readonly razon: RazonRechazoVisita;

  constructor({ razon, motivo }: RechazoVisita) {
    super(motivo);
    this.name = 'VisitaRechazada';
    this.razon = razon;
  }
}

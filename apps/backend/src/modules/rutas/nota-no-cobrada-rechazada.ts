/**
 * Un comentario de "no cobre" que el DOMINIO no acepta. Igual que
 * `VisitaRechazada`: no importa nada del contrato; `push` la traduce a su
 * codigo (`sincronizacion/despacho-nota-no-cobrada.ts`). La forma de `datos`
 * se rechaza antes de abrir la transaccion (`datos-nota-no-cobrada.ts`).
 */
export type RazonRechazoNotaNoCobrada =
  /** La nota no existe, o no es del cliente o la sucursal del sobre (motivo neutro). */
  | 'nota-no-encontrada'
  /** El id (la clave) ya lo ocupa otro comentario. */
  | 'nota-no-cobrada-id-ocupado';

export interface RechazoNotaNoCobrada {
  razon: RazonRechazoNotaNoCobrada;
  /** En el espanol que leera quien tenga la tablet en la mano. */
  motivo: string;
}

export class NotaNoCobradaRechazada extends Error {
  readonly razon: RazonRechazoNotaNoCobrada;

  constructor({ razon, motivo }: RechazoNotaNoCobrada) {
    super(motivo);
    this.name = 'NotaNoCobradaRechazada';
    this.razon = razon;
  }
}

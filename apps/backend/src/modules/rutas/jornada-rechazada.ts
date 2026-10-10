/**
 * Una jornada que el DOMINIO no acepta (T-38).
 *
 * Igual que `CobranzaRechazada`: no importa nada del contrato de
 * sincronizacion. `push` la traduce a su codigo
 * (`sincronizacion/despacho-jornada.ts`).
 *
 * La forma de `datos` y el orden de los km no estan aqui: se rechazan antes de
 * abrir la transaccion (`datos-jornada.ts`).
 */
export type RazonRechazoJornada =
  /**
   * El vehiculo no existe, esta dado de baja (`deleted_at`) o es de otra
   * sucursal que la del vendedor. Uno desactivado (`activo = false`) NO cae
   * aqui: el kilometraje se recorrio igual.
   */
  | 'vehiculo-inexistente'
  /** Ya hay una jornada viva de ese vendedor ese dia, subida con otra clave. */
  | 'jornada-duplicada';

export interface RechazoJornada {
  razon: RazonRechazoJornada;
  /** En el espanol que leera quien tenga la tablet en la mano. */
  motivo: string;
}

export class JornadaRechazada extends Error {
  readonly razon: RazonRechazoJornada;

  constructor({ razon, motivo }: RechazoJornada) {
    super(motivo);
    this.name = 'JornadaRechazada';
    this.razon = razon;
  }
}

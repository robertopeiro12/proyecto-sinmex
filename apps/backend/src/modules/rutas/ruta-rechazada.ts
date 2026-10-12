/**
 * Un alta de ruta que el DOMINIO no acepta (T-37).
 *
 * Igual que `JornadaRechazada`: no importa nada del contrato de
 * sincronizacion. `push` la traduce a su codigo
 * (`sincronizacion/despacho-ruta-alta.ts`).
 *
 * La forma de `datos` no esta aqui: se rechaza antes de abrir la transaccion
 * (`datos-ruta-alta.ts`).
 */
export type RazonRechazoRuta =
  /**
   * El cliente no existe, esta dado de baja (`deleted_at`), es de otra sucursal
   * que la del vendedor, o es un prospecto (D7).
   */
  | 'cliente-inexistente'
  /** Ya hay una fila viva de ese vendedor, fecha y cliente, subida con otra clave. */
  | 'ruta-duplicada';

export interface RechazoRuta {
  razon: RazonRechazoRuta;
  /** En el espanol que leera quien tenga la tablet en la mano. */
  motivo: string;
}

export class RutaRechazada extends Error {
  readonly razon: RazonRechazoRuta;

  constructor({ razon, motivo }: RechazoRuta) {
    super(motivo);
    this.name = 'RutaRechazada';
    this.razon = razon;
  }
}

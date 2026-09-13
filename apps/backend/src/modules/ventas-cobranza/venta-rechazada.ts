/**
 * Una venta que el DOMINIO no acepta (T-16).
 *
 * > [!info] No importa nada del contrato de sincronizacion (D12, ADR-0009)
 * > La dependencia va de `sincronizacion/` hacia los modulos de dominio, nunca
 * > al reves. Por eso la razon es propia de ventas: `push` la traduce a su
 * > codigo de rechazo (`sincronizacion/despacho.ts`) y el portal de T-17 la
 * > traducira a HTTP.
 *
 * Es una regla de negocio que no se cumple, no un fallo tecnico: quien la
 * atrapa responde con un rechazo, no revienta.
 */
export type RazonRechazoVenta =
  /** El cliente no existe, esta dado de baja o no es de la sucursal. */
  | 'cliente-fuera-de-alcance'
  /** Una linea nombra una presentacion que no se vende (borrada, o su producto inactivo o borrado). */
  | 'presentacion-inactiva'
  /** Una linea con cantidad > 0 y el cliente no tiene ningun precio vigente para esa presentacion. */
  | 'precio-no-asignado';

export interface RechazoVenta {
  razon: RazonRechazoVenta;
  /** En el espanol que leera quien tenga la tablet en la mano. */
  motivo: string;
}

export class VentaRechazada extends Error {
  readonly razon: RazonRechazoVenta;

  constructor({ razon, motivo }: RechazoVenta) {
    super(motivo);
    this.name = 'VentaRechazada';
    this.razon = razon;
  }
}

/**
 * Un alta de prospecto que el DOMINIO no acepta (T-40).
 *
 * > [!info] No importa nada del contrato de sincronizacion (ADR-0009)
 * > La dependencia va de `sincronizacion/` hacia los modulos de dominio, nunca
 * > al reves. Por eso la razon es propia de Cartera de Clientes: el `push` la
 * > traduce a su codigo de rechazo (`sincronizacion/despacho.ts`) y, si algun
 * > dia el portal llama a `crearProspecto`, la traducira a HTTP.
 *
 * Es una regla de negocio que no se cumple, no un fallo tecnico: quien la atrapa
 * responde con un rechazo por operacion, no revienta el lote.
 *
 * Mismo patron que `VentaRechazada` de T-16, a proposito: dos modulos con la
 * misma forma se revisan y se prueban igual.
 */
export type RazonRechazoProspecto =
  /**
   * El `tipo_negocio_id` no existe o esta dado de baja.
   *
   * **No es un bug de la tablet**: su catalogo de tipos de negocio pudo quedarse
   * viejo mientras estaba en ruta, o el administrador pudo dar de baja ese tipo
   * el mismo dia. Se reintenta en la siguiente sincronizacion, que ademas le baja
   * el catalogo nuevo — igual que `presentacion-inactiva` en una venta.
   */
  'tipo-negocio-inexistente';

export interface RechazoProspecto {
  razon: RazonRechazoProspecto;
  /** En el espanol que leera quien tenga la tablet en la mano. */
  motivo: string;
}

export class ProspectoRechazado extends Error {
  readonly razon: RazonRechazoProspecto;

  constructor({ razon, motivo }: RechazoProspecto) {
    super(motivo);
    this.name = 'ProspectoRechazado';
    this.razon = razon;
  }
}

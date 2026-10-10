/**
 * Un pago del PORTAL que el dominio no acepta (T-21).
 *
 * Distinto de `CobranzaRechazada` a proposito: la tablet NO rechaza una nota
 * ya pagada (D9: el dinero si se cobro y rechazarlo lo perderia), y su unica
 * razon viaja al contrato de sincronizacion. La oficina, en cambio, tiene la
 * pantalla enfrente: si la nota que palomeo ya no tiene saldo, se le dice y
 * vuelve a cargar. `CobranzasPortalService` traduce esto a 400/409.
 */
export type RazonPagoRechazado =
  /** Una palomeada no llego entre las bloqueadas: no existe o es de otro cliente. */
  | 'nota-ajena'
  /** Una palomeada ya no es cobrable (pagada, cuenta perdida, borrada) o esta en 0. */
  | 'nota-sin-saldo'
  /** `fechaPago` antes de la palomeada mas vieja. */
  | 'fecha-anterior'
  /** Aplicar mas saldo a favor del que tiene el cliente. */
  | 'saldo-favor-insuficiente'
  /** Aplicar mas saldo a favor del que deben las palomeadas. */
  | 'excede-lo-que-deben';

export class PagoRechazado extends Error {
  readonly razon: RazonPagoRechazado;

  constructor(razon: RazonPagoRechazado, motivo: string) {
    super(motivo);
    this.name = 'PagoRechazado';
    this.razon = razon;
  }
}

/** Centavos a `$1,234.56`, sin coma flotante (igual que `formatearPesos` del portal). */
export function formatearPesos(centavos: number): string {
  const signo = centavos < 0 ? '-' : '';
  const absoluto = Math.abs(centavos);
  const enteros = Math.floor(absoluto / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${signo}$${enteros}.${String(absoluto % 100).padStart(2, '0')}`;
}

export const MOTIVO_NOTA_AJENA =
  'Una de las notas marcadas no es de este cliente o ya no existe; vuelve a cargar.';

export const motivoNotaSinSaldo = (folio: string): string =>
  `La nota ${folio} ya no tiene saldo; vuelve a cargar.`;

export const motivoFechaAnterior = (fecha: string): string =>
  `La fecha del pago no puede ser anterior a la nota más vieja que marcaste (${fecha}).`;

export const motivoSaldoFavorInsuficiente = (
  disponibleCentavos: number,
): string =>
  `El cliente solo tiene ${formatearPesos(disponibleCentavos)} de saldo a favor.`;

export const motivoExcedeLoQueDeben = (debenCentavos: number): string =>
  `Las notas marcadas solo deben ${formatearPesos(debenCentavos)}: no se puede aplicar más saldo a favor que eso.`;

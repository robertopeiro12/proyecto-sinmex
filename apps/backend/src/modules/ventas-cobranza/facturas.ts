/**
 * Reglas puras de la asignacion de facturas (T-19). Deciden, y se prueban sin
 * Postgres; las usa `FacturasService` con las ventas ya bloqueadas.
 *
 * La factura la emite el programa del SAT, fuera de JAWA: aqui solo se valida
 * que su numero se pueda anotar en esas ventas.
 */

export const LARGO_MAX_NUMERO_FACTURA = 30;

export const MOTIVO_NUMERO_INVALIDO = `El número de factura debe tener de 1 a ${LARGO_MAX_NUMERO_FACTURA} caracteres.`;

export const MOTIVO_VENTA_INEXISTENTE =
  'Una de las ventas marcadas ya no existe o fue eliminada. Vuelve a cargar la lista.';

export const MOTIVO_CARRERA =
  'Otro usuario acaba de registrar esa factura; vuelve a intentar.';

/** Una venta viva, bloqueada, con lo que hace falta para decidir. */
export interface VentaParaFacturar {
  id: string;
  folio: string;
  clienteId: string;
  status: string;
  /** De la fila bloqueada: fresco tras esperar el bloqueo. Es lo que DECIDE. */
  facturaId: string | null;
  /**
   * Solo para el texto del mensaje: se lee en otra sentencia DESPUES del
   * bloqueo. `null` si no esta facturada o si no se pudo leer.
   */
  facturaNumero: string | null;
}

/** `trim`; `null` si queda en blanco o pasa de 30 (el check de la base dice lo mismo). */
export function normalizarNumeroFactura(crudo: string): string | null {
  const numero = crudo.trim();
  return numero.length >= 1 && numero.length <= LARGO_MAX_NUMERO_FACTURA
    ? numero
    : null;
}

export const motivoDeOtroCliente = (numero: string, cliente: string): string =>
  `La factura ${numero} ya está asignada a ${cliente}.`;

export const motivoYaTieneEseNumero = (numero: string): string =>
  `El cliente ya tiene la factura ${numero}: quita estas ventas y asígnalas a esa.`;

/**
 * @param ids los pedidos, ya sin repetir
 * @param ventas las que devolvio el bloqueo (solo vivas)
 */
export function motivoAlAsignar(
  ids: readonly string[],
  ventas: readonly VentaParaFacturar[],
  clienteId: string,
): string | null {
  const porId = new Map(ventas.map((v) => [v.id, v]));
  for (const id of ids) {
    const v = porId.get(id);
    if (!v) return MOTIVO_VENTA_INEXISTENTE;
    if (v.clienteId !== clienteId)
      return `La venta ${v.folio} no es de este cliente.`;
    if (v.status === 'promocion')
      return `La venta ${v.folio} es de promoción ($0): no se factura.`;
    // Se decide por `facturaId`, no por el numero: tras esperar el bloqueo,
    // Postgres solo relee la fila bloqueada, no lo que se le haya unido.
    if (v.facturaId !== null)
      return v.facturaNumero !== null
        ? `La venta ${v.folio} ya está en la factura ${v.facturaNumero}.`
        : `La venta ${v.folio} ya está en otra factura.`;
  }
  return null;
}

export function motivoAlQuitar(
  ids: readonly string[],
  ventas: readonly VentaParaFacturar[],
  facturaId: string,
  numero: string,
): string | null {
  const porId = new Map(ventas.map((v) => [v.id, v]));
  for (const id of ids) {
    const v = porId.get(id);
    if (!v) return MOTIVO_VENTA_INEXISTENTE;
    if (v.facturaId !== facturaId)
      return `La venta ${v.folio} no está en la factura ${numero}.`;
  }
  return null;
}

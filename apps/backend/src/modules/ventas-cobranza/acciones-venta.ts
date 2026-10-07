/**
 * Que se puede hacer con una venta VIVA desde el portal (T-17, parte 2, §3.2).
 *
 * Pura y en un solo sitio: la usa el detalle (para que la pantalla pinte los
 * botones) y la usan la edicion y el borrado (para negarse con 409). Asi la
 * pantalla y el servidor no pueden discrepar.
 *
 * El permiso `venta.editar_eliminar` NO entra aqui: lo exige el guard en la
 * escritura y la pantalla lo combina con `puede()`. Una venta eliminada nunca
 * llega aqui: es 404 antes.
 */
export interface AccionesVenta {
  editable: boolean;
  motivoNoEditable: string | null;
  puedeMarcarPerdida: boolean;
}

export const MOTIVO_CON_COBROS =
  'Esta venta tiene cobros registrados: no se puede editar ni eliminar. Para quitar un cobro, ver Peticiones.';

export const MOTIVO_CUENTA_PERDIDA =
  'Esta venta está marcada como cuenta perdida: no se puede editar ni eliminar.';

/** T-19: una venta facturada no cambia sin que alguien la quite de su factura a proposito. */
export const motivoFacturada = (numero: string): string =>
  `Esta venta está en la factura ${numero}: quítala primero de la factura para editarla o eliminarla.`;

export const MOTIVO_NO_PERDIBLE =
  'Solo una venta pendiente o abonada se puede marcar como cuenta perdida.';

/** §4.4: solo lo que todavia se le debe cobrar. Aunque tenga abonos. */
export function sePuedeMarcarPerdida(status: string): boolean {
  return status === 'pendiente' || status === 'abonado';
}

/**
 * @param abonosDeCobroVivos abonos vivos con `origen = 'cobro'`. El cobro
 * automatico de contado (`venta_contado`) NO cuenta: la edicion lo reescribe.
 * @param facturaNumero el numero de su factura, o `null` si no esta facturada (T-19).
 */
export function accionesDeVenta(
  status: string,
  abonosDeCobroVivos: number,
  facturaNumero: string | null,
): AccionesVenta {
  // Una cuenta perdida no se edita: recalcular el status la devolveria a
  // `pendiente`, y deshacer una cuenta perdida no entra en esta version (§6).
  const motivo =
    abonosDeCobroVivos > 0
      ? MOTIVO_CON_COBROS
      : status === 'cuenta_perdida'
        ? MOTIVO_CUENTA_PERDIDA
        : facturaNumero !== null
          ? motivoFacturada(facturaNumero)
          : null;
  return {
    editable: motivo === null,
    motivoNoEditable: motivo,
    // La cuenta perdida no toca montos ni productos: se permite aunque este facturada.
    puedeMarcarPerdida: sePuedeMarcarPerdida(status),
  };
}

/** El mensaje del 409 de PATCH (§4.2 paso 2) y DELETE (§4.3 paso 1), o `null` si se puede. */
export function bloqueoDeEdicion(
  status: string,
  abonosDeCobroVivos: number,
  accion: 'editar' | 'eliminar',
  factura: { id: string | null; numero: string | null },
): string | null {
  if (abonosDeCobroVivos > 0)
    return `Tiene cobros registrados: no se puede ${accion}.`;
  if (status === 'cuenta_perdida')
    return `Está marcada como cuenta perdida: no se puede ${accion}.`;
  // Decide el id (de la fila bloqueada); el numero es solo texto.
  if (factura.id !== null) {
    const cual =
      factura.numero !== null ? `la factura ${factura.numero}` : 'una factura';
    return accion === 'editar'
      ? `Está en ${cual}: quítala primero de la factura para editarla.`
      : `Está en ${cual}: quítala primero de la factura.`;
  }
  return null;
}

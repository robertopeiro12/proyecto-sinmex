/** Lo que se le pide al vendedor con una nota asignada. */
export const CONDICIONES_VENTA = ['ninguna', 'liquidar', 'abonar'] as const;
export type CondicionVenta = (typeof CONDICIONES_VENTA)[number];

/** Una nota por cobrar en la ventana de notas de una ruta del dia (spec §5.4). */
export interface NotaDeRuta {
  ventaNotaId: string;
  folio: string;
  clienteId: string;
  cliente: string;
  /** `AAAA-MM-DD`, la fecha de la venta. */
  fecha: string;
  saldoCentavos: number;
  diasAtraso: number;
  /** Quien la trae ese dia, o `null`. */
  asignadaA: {
    vendedorId: string;
    nombre: string;
    condicionVenta: CondicionVenta;
  } | null;
}

export interface NotasDeRuta {
  /** Con saldo, de los clientes de su ruta: en el orden de la ruta, luego fecha y folio. */
  pendientes: NotaDeRuta[];
  /** Las de este vendedor ese dia, aunque ya no tengan saldo. */
  asignadas: NotaDeRuta[];
}

/**
 * Arma las dos listas de la ventana. `notas` trae las notas con saldo de los
 * clientes de la ruta y las asignadas a este vendedor ese dia (con o sin saldo):
 * aqui se decide a cual lista va cada una.
 */
export function armarNotasDeRuta(
  ordenClientes: readonly string[],
  notas: readonly NotaDeRuta[],
  vendedorId: string,
): NotasDeRuta {
  const posicion = new Map(ordenClientes.map((c, i) => [c, i]));
  // Un cliente que ya no esta en la ruta (no deberia tener asignadas) va al final.
  const lugar = (n: NotaDeRuta): number =>
    posicion.get(n.clienteId) ?? ordenClientes.length;
  const ordenar = (a: NotaDeRuta, b: NotaDeRuta): number =>
    lugar(a) - lugar(b) ||
    a.fecha.localeCompare(b.fecha) ||
    a.folio.localeCompare(b.folio);

  return {
    pendientes: notas
      .filter((n) => n.saldoCentavos > 0 && posicion.has(n.clienteId))
      .sort(ordenar),
    asignadas: notas
      .filter((n) => n.asignadaA?.vendedorId === vendedorId)
      .sort(ordenar),
  };
}

/**
 * El portal no deja venderle a un vendedor mas de lo que trae cargado
 * (cliente, 2026-11-12: "No puede vender mas de lo que trae cargado en su
 * inventario"). Reglas puras, sin base ni Nest; las usan
 * `VentasPortalService.registrar` y `VentasEdicionService.editar` a traves de
 * `InventarioVentaService`.
 *
 * Es la misma regla que la app (`apps/tablet/src/datos/inventario-reglas.ts`,
 * `faltantesDeVenta`): piezas vendidas MAS regaladas contra la existencia, y una
 * existencia negativa cuenta como 0. La existencia NO se calcula aqui: es
 * `existenciasPorPresentacion` del corte (`produccion/reglas-corte.ts`).
 */

/** Las piezas de una linea de la venta. */
export interface PiezasLinea {
  presentacionId: string;
  cantidad: number;
  cantidadPromocion: number;
}

export interface FaltanteVenta {
  presentacionId: string;
  faltan: number;
}

/** Vendidas + regaladas por presentacion, en el orden en que aparecen. */
function piezasPorPresentacion(
  lineas: readonly PiezasLinea[],
): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const l of lineas) {
    const piezas = l.cantidad + l.cantidadPromocion;
    if (!(piezas > 0)) continue;
    mapa.set(l.presentacionId, (mapa.get(l.presentacionId) ?? 0) + piezas);
  }
  return mapa;
}

/**
 * Lo que le falta a la venta para no dejar al vendedor en negativo.
 *
 * - `existencias`: lo que trae el vendedor ese dia por presentacion, contando
 *   todas sus ventas guardadas (tambien la que se edita, si ya es suya).
 * - `propias`: al EDITAR, las lineas guardadas de la venta, solo si sigue con
 *   el mismo vendedor (sus piezas ya salieron de su existencia y se suman de
 *   vuelta). Al registrar, o si la edicion cambia de vendedor, `[]`.
 *
 * Una presentacion que no sube respecto a lo que la venta ya tenia nunca se
 * rechaza: una edicion que baja piezas pasa aunque el vendedor ya este en
 * negativo (se vendio con la casilla apagada, o desde la tablet sin red).
 */
export function faltantesDeVentaPortal(
  existencias: ReadonlyMap<string, number>,
  lineas: readonly PiezasLinea[],
  propias: readonly PiezasLinea[] = [],
): FaltanteVenta[] {
  const yaTenia = piezasPorPresentacion(propias);
  const faltantes: FaltanteVenta[] = [];
  for (const [presentacionId, pedido] of piezasPorPresentacion(lineas)) {
    const propia = yaTenia.get(presentacionId) ?? 0;
    if (pedido <= propia) continue;
    const hay = Math.max(0, (existencias.get(presentacionId) ?? 0) + propia);
    if (pedido > hay) faltantes.push({ presentacionId, faltan: pedido - hay });
  }
  return faltantes;
}

/**
 * "No le alcanza el producto a Ana: Horchata 1 L, faltan 3; Jamaica 500 ml,
 * falta 1." `nombre` da "Producto volumen" de cada presentacion.
 */
export function mensajeFaltantes(
  vendedor: string,
  faltantes: readonly FaltanteVenta[],
  nombre: (presentacionId: string) => string,
): string {
  const partes = faltantes.map(
    (f) =>
      `${nombre(f.presentacionId)}, ${f.faltan === 1 ? 'falta 1' : `faltan ${f.faltan}`}`,
  );
  return `No le alcanza el producto a ${vendedor}: ${partes.join('; ')}.`;
}

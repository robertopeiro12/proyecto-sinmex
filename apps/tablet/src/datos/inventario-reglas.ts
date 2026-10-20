import type { Booleano, EstadoCarga, FechaISO } from './tipos';

/**
 * El inventario del vendedor (T-27 pieza 1), sin SQLite ni React.
 *
 * Viven en `src/datos/` (como `ventas-reglas.ts`) porque el repositorio de
 * ventas las vuelve a calcular DENTRO de su transaccion, y `src/datos/` no
 * importa de `src/estado/`. `src/estado/inventario.ts` las reexporta para las
 * pantallas, junto con lo que solo es de pantalla.
 *
 * Todo en piezas (spec, proceso del negocio). Solo cuentan las cargas
 * **aceptadas** (D6: el servidor las confirmo) y lo de **hoy**.
 */

export const MOTIVO_CARGA_PENDIENTE = 'Tienes una carga por aceptar';

export interface LineaCargaInventario {
  presentacion_id: string;
  piezas: number;
}

/** Lo que el inventario necesita de una carga (una `CargaConLineas` sirve tal cual). */
export interface CargaInventario {
  id: string;
  fecha: FechaISO;
  numero: number;
  estado: EstadoCarga;
  activo: Booleano;
  lineas: readonly LineaCargaInventario[];
}

/** Una linea de venta con la fecha de su venta. */
export interface LineaVentaInventario {
  fecha: FechaISO;
  presentacion_id: string;
  cantidad: number;
  cantidad_promocion: number;
}

export interface Existencia {
  cargado: number;
  vendido: number;
  regalado: number;
  /** cargado − vendido − regalado. Puede ser negativa si se vendio con el control apagado. */
  existencia: number;
}

export interface PiezasDePresentacion {
  presentacionId: string;
  cantidad: number;
}

export interface Faltante {
  presentacionId: string;
  faltan: number;
}

/**
 * Por presentacion: lo cargado (cargas **aceptadas** y vivas de `hoy`) menos lo
 * vendido y lo regalado en las ventas de `hoy` (D10: el regalo tambien sale de
 * la camioneta).
 */
export function existencias(
  cargas: readonly CargaInventario[],
  ventas: readonly LineaVentaInventario[],
  hoy: FechaISO,
): Map<string, Existencia> {
  const mapa = new Map<string, Existencia>();
  const de = (presentacionId: string): Existencia => {
    let e = mapa.get(presentacionId);
    if (!e) {
      e = { cargado: 0, vendido: 0, regalado: 0, existencia: 0 };
      mapa.set(presentacionId, e);
    }
    return e;
  };
  for (const c of cargas) {
    if (c.estado !== 'aceptada' || c.activo !== 1 || c.fecha !== hoy) continue;
    for (const l of c.lineas) de(l.presentacion_id).cargado += l.piezas;
  }
  for (const v of ventas) {
    if (v.fecha !== hoy) continue;
    const e = de(v.presentacion_id);
    e.vendido += v.cantidad;
    e.regalado += v.cantidad_promocion;
  }
  for (const e of mapa.values()) e.existencia = e.cargado - e.vendido - e.regalado;
  return mapa;
}

/** La carga pendiente y viva de `hoy` de menor numero (la que se acepta primero), o `null`. */
export function cargaPendiente<C extends Pick<CargaInventario, 'fecha' | 'numero' | 'estado' | 'activo'>>(
  cargas: readonly C[],
  hoy: FechaISO,
): C | null {
  let pendiente: C | null = null;
  for (const c of cargas) {
    if (c.estado !== 'pendiente' || c.activo !== 1 || c.fecha !== hoy) continue;
    if (pendiente === null || c.numero < pendiente.numero) pendiente = c;
  }
  return pendiente;
}

/**
 * D3: con el control prendido y una carga pendiente de hoy, no se vende.
 * Devuelve el motivo o `null`. Apagado (D7), nunca bloquea.
 */
export function bloqueoDeVenta({
  controlInventario,
  cargas,
  hoy,
}: {
  controlInventario: boolean;
  cargas: readonly Pick<CargaInventario, 'fecha' | 'numero' | 'estado' | 'activo'>[];
  hoy: FechaISO;
}): string | null {
  if (!controlInventario) return null;
  return cargaPendiente(cargas, hoy) === null ? null : MOTIVO_CARGA_PENDIENTE;
}

/**
 * D4: lo que le falta a una venta para no dejar ninguna presentacion en
 * negativo, contando piezas vendidas (`lineas`) MAS regaladas (`regalos`).
 * Una existencia negativa cuenta como 0. Vacio si el control esta apagado.
 * En el orden en que aparecen las presentaciones.
 */
export function faltantesDeVenta({
  controlInventario,
  existencias: disponibles,
  lineas,
  regalos,
}: {
  controlInventario: boolean;
  existencias: ReadonlyMap<string, Existencia>;
  lineas: readonly PiezasDePresentacion[];
  regalos: readonly PiezasDePresentacion[];
}): Faltante[] {
  if (!controlInventario) return [];
  const pedidas = new Map<string, number>();
  for (const p of [...lineas, ...regalos]) {
    // `!(x > 0)` y no `x <= 0`: una cantidad ilegible (NaN) no es un pedido.
    if (!(p.cantidad > 0)) continue;
    pedidas.set(p.presentacionId, (pedidas.get(p.presentacionId) ?? 0) + p.cantidad);
  }
  const faltantes: Faltante[] = [];
  for (const [presentacionId, pedido] of pedidas) {
    const hay = Math.max(0, disponibles.get(presentacionId)?.existencia ?? 0);
    if (pedido > hay) faltantes.push({ presentacionId, faltan: pedido - hay });
  }
  return faltantes;
}

/** "Horchata 1 L: faltan 3 piezas" (spec, revision de la venta). */
export function textoFaltante(etiqueta: string, faltan: number): string {
  return `${etiqueta}: ${faltan === 1 ? 'falta 1 pieza' : `faltan ${faltan} piezas`}`;
}

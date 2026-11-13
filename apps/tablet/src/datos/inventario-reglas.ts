import type { Booleano, EstadoCarga, FechaISO, SentidoMovimiento, TipoMovimiento } from './tipos';

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
 *
 * T-27 pieza 2: los movimientos (merma del cliente, del trayecto y consumo)
 * restan de la existencia; la merma recibida no suma (esta danada) y va a "Por
 * regresar a la planta".
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

/** Una linea de un movimiento de inventario con el tipo y la fecha de su movimiento (T-27 pieza 2). */
export interface LineaMovimientoInventario {
  fecha: FechaISO;
  tipo: TipoMovimiento;
  sentido: SentidoMovimiento;
  presentacion_id: string;
  piezas: number;
}

export interface Existencia {
  cargado: number;
  vendido: number;
  regalado: number;
  /** T-27 pieza 2: la reposicion de una merma del cliente ("Le entregué"). */
  mermaEntregada: number;
  /** Lo que se le rompio o echo a perder al vendedor en el dia. */
  mermaTrayecto: number;
  consumo: number;
  /** Lo danado que devolvio el cliente ("Recibí dañado"). NO suma a la existencia. */
  mermaRecibida: number;
  /**
   * cargado − vendido − regalado − mermaEntregada − mermaTrayecto − consumo.
   * Puede ser negativa si se vendio o registro con el control apagado.
   */
  existencia: number;
  /** La merma que regresa a la planta: mermaRecibida + mermaTrayecto. */
  mermaPorRegresar: number;
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
 * la camioneta) y, desde la pieza 2, menos la merma entregada, la del trayecto y
 * el consumo de `hoy`. La merma recibida no suma: se cuenta aparte para
 * regresarla a la planta.
 */
export function existencias(
  cargas: readonly CargaInventario[],
  ventas: readonly LineaVentaInventario[],
  hoy: FechaISO,
  movimientos: readonly LineaMovimientoInventario[] = [],
): Map<string, Existencia> {
  const mapa = new Map<string, Existencia>();
  const de = (presentacionId: string): Existencia => {
    let e = mapa.get(presentacionId);
    if (!e) {
      e = {
        cargado: 0,
        vendido: 0,
        regalado: 0,
        mermaEntregada: 0,
        mermaTrayecto: 0,
        consumo: 0,
        mermaRecibida: 0,
        existencia: 0,
        mermaPorRegresar: 0,
      };
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
  for (const m of movimientos) {
    if (m.fecha !== hoy) continue;
    const e = de(m.presentacion_id);
    // Solo la merma del cliente trae lineas `recibido` (validarMovimiento).
    if (m.sentido === 'recibido') e.mermaRecibida += m.piezas;
    else if (m.tipo === 'merma_cliente') e.mermaEntregada += m.piezas;
    else if (m.tipo === 'merma_trayecto') e.mermaTrayecto += m.piezas;
    else e.consumo += m.piezas;
  }
  for (const e of mapa.values()) {
    e.existencia = e.cargado - e.vendido - e.regalado - e.mermaEntregada - e.mermaTrayecto - e.consumo;
    e.mermaPorRegresar = e.mermaRecibida + e.mermaTrayecto;
  }
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

/**
 * D5: lo que le falta a un movimiento para no dejar ninguna presentacion en
 * negativo, contando solo las piezas que SALEN (reposicion, merma del trayecto,
 * consumo). Mismo criterio que `faltantesDeVenta`; vacio con el control apagado.
 */
export function faltantesDeMovimiento({
  controlInventario,
  existencias: disponibles,
  lineasQueSalen,
}: {
  controlInventario: boolean;
  existencias: ReadonlyMap<string, Existencia>;
  lineasQueSalen: readonly PiezasDePresentacion[];
}): Faltante[] {
  return faltantesDeVenta({ controlInventario, existencias: disponibles, lineas: lineasQueSalen, regalos: [] });
}

/** D4: piezas de consumo propio registradas `hoy` (todas: ya salieron, suban o no). */
export function consumoDelDia(movimientos: readonly LineaMovimientoInventario[], hoy: FechaISO): number {
  return movimientos
    .filter((m) => m.fecha === hoy && m.tipo === 'consumo')
    .reduce((total, m) => total + m.piezas, 0);
}

/** "Horchata 1 L: faltan 3 piezas" (spec, revision de la venta). */
export function textoFaltante(etiqueta: string, faltan: number): string {
  return `${etiqueta}: ${faltan === 1 ? 'falta 1 pieza' : `faltan ${faltan} piezas`}`;
}

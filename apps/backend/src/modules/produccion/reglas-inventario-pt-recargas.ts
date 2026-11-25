/**
 * Reglas del Inventario de PT con Recargas, sin base ni Nest: la UNICA cuenta
 * del Actual y la suma por producto. El Inicial no se calcula aqui: es el de
 * Inventario de PT con Ventas para hoy (`reglas-inventario-pt.ts`).
 * Spec: docs/superpowers/specs/2026-11-25-inventario-pt-recargas-design.md (D2, D3 y los
 * cambios del tío del 2026-11-25: es una fotografía a grandes rasgos; sin merma,
 * consumo ni descuentos).
 */
import { compararPresentaciones } from './reglas-inventario-pt';

/** Lo que se movio hoy de una presentacion (D2). Solo Registro de Operacion y cargas. */
export interface MovimientosRecargas {
  /** Renglones aceptados de cargas vivas de hoy (una pendiente no resta). */
  recargas: number;
  /** Envios que salieron. */
  envios: number;
  /** Registro `entrada` (produccion/compras) + envios recibidos. */
  entradas: number;
}

export const SIN_MOVIMIENTOS_RECARGAS: Readonly<MovimientosRecargas> =
  Object.freeze({
    recargas: 0,
    envios: 0,
    entradas: 0,
  });

const CAMPOS = Object.keys(
  SIN_MOVIMIENTOS_RECARGAS,
) as (keyof MovimientosRecargas)[];

/**
 * Un renglon de la pantalla: una presentacion (o, con "Por producto", un
 * producto: `presentacionId` null y `volumen` vacio). `null` en Inicial y
 * Actual = sin inventario inicial (nunca 0).
 */
export interface RenglonPtRecargas extends MovimientosRecargas {
  presentacionId: string | null;
  productoId: string;
  producto: string;
  volumen: string;
  inicial: number | null;
  actual: number | null;
  /** Hoy hay un ajuste: el Inicial es el del ajuste. Solo por presentacion. */
  ajustado: boolean;
}

export function sumarMovimientosRecargas(
  a: MovimientosRecargas,
  b: MovimientosRecargas,
): MovimientosRecargas {
  const r = { ...SIN_MOVIMIENTOS_RECARGAS };
  for (const c of CAMPOS) r[c] = a[c] + b[c];
  return r;
}

/** Algun campo distinto de 0. */
export function hayMovimientoRecargas(m: MovimientosRecargas): boolean {
  return CAMPOS.some((c) => m[c] !== 0);
}

/** `Actual = Inicial − Recargas − Envíos + Entradas`. */
export function actualDelDia(
  inicial: number | null,
  m: MovimientosRecargas,
): number | null {
  if (inicial === null) return null;
  return inicial - m.recargas - m.envios + m.entradas;
}

const sumaONull = (valores: (number | null)[]): number | null =>
  valores.some((v) => v === null)
    ? null
    : valores.reduce<number>((t, v) => t + (v as number), 0);

/**
 * "Por producto": un renglon por producto sumando sus presentaciones, por
 * nombre. Inicial y Actual `null` si alguna presentacion no tiene inicial; sin
 * marca "Ajustado" (solo va por presentacion).
 */
export function porProductoRecargas(
  renglones: readonly RenglonPtRecargas[],
): RenglonPtRecargas[] {
  const grupos = new Map<string, RenglonPtRecargas[]>();
  for (const r of renglones) {
    const g = grupos.get(r.productoId) ?? [];
    g.push(r);
    grupos.set(r.productoId, g);
  }
  return [...grupos.values()]
    .map((g) => ({
      productoId: g[0].productoId,
      producto: g[0].producto,
      presentacionId: null,
      volumen: '',
      ...g.reduce<MovimientosRecargas>(sumarMovimientosRecargas, {
        ...SIN_MOVIMIENTOS_RECARGAS,
      }),
      inicial: sumaONull(g.map((r) => r.inicial)),
      actual: sumaONull(g.map((r) => r.actual)),
      ajustado: false,
    }))
    .sort(
      (a, b) =>
        a.producto.localeCompare(b.producto, 'es') ||
        a.productoId.localeCompare(b.productoId),
    );
}

/** Orden de la vista por presentacion: tamano, producto, id (el de PT con Ventas). */
export function ordenarRecargasPorPresentacion(
  renglones: RenglonPtRecargas[],
): RenglonPtRecargas[] {
  return renglones.sort(compararPresentaciones);
}

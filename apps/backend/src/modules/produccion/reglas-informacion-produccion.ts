/**
 * Reglas de Informacion de Produccion, sin base ni Nest: la suma por producto y
 * el orden. Es un reporte de solo lectura de las Entradas/Compras del Registro
 * de Operacion. Spec: docs/superpowers/specs/2026-11-28-informacion-de-produccion-design.md
 */
import { compararPresentaciones } from './reglas-inventario-pt';

/** El rango mas largo que se consulta, dias incluidos (como los demas reportes). */
export const MAX_DIAS_INFORMACION = 366;

/** Un renglon del reporte: lo producido y lo comprado en el rango. */
export interface RenglonInformacion {
  /** `null` en la vista por producto. */
  presentacionId: string | null;
  productoId: string;
  producto: string;
  /** `''` en la vista por producto. */
  volumen: string;
  produccion: number;
  compras: number;
  total: number;
}

/** "Por producto": un renglon por producto sumando sus presentaciones, por nombre. */
export function porProductoInformacion(
  renglones: readonly RenglonInformacion[],
): RenglonInformacion[] {
  const grupos = new Map<string, RenglonInformacion>();
  for (const r of renglones) {
    const g = grupos.get(r.productoId);
    if (!g) {
      grupos.set(r.productoId, {
        presentacionId: null,
        productoId: r.productoId,
        producto: r.producto,
        volumen: '',
        produccion: r.produccion,
        compras: r.compras,
        total: r.total,
      });
      continue;
    }
    g.produccion += r.produccion;
    g.compras += r.compras;
    g.total += r.total;
  }
  return [...grupos.values()].sort(
    (a, b) =>
      a.producto.localeCompare(b.producto, 'es') ||
      a.productoId.localeCompare(b.productoId),
  );
}

/** Orden de la vista por presentacion: tamano, producto, id. */
export function ordenarInformacion(
  renglones: RenglonInformacion[],
): RenglonInformacion[] {
  return renglones.sort(compararPresentaciones);
}

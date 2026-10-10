import {
  normalizarDatosVenta,
  type LineaVentaNormalizada,
} from './datos-venta';
import { revisarLineas } from './reglas-venta';
import type { EntradaVentaPortal, ResultadoVentaPortal } from './venta-portal';

/**
 * Reglas puras de la EDICION de una venta desde el portal (T-17 parte 2, §4.2).
 * Puras por el mismo criterio que `venta-portal.ts`: deciden, y se prueban sin
 * Postgres. Las usa `VentasEdicionService`.
 */

/** Una linea viva tal como esta guardada. */
export interface LineaGuardada {
  id: string;
  /** uuid en minusculas (lo devuelve Postgres). */
  presentacionId: string;
  cantidad: number;
  cantidadPromocion: number;
  precioCentavos: number;
}

/**
 * Arma la venta editada (§4.2 paso 4).
 *
 * - Una presentacion que YA estaba en la venta conserva su precio guardado: es
 *   el de la nota firmada (§2). No se le exige seguir vendiendose: corregir otra
 *   linea no puede fallar porque esta se dio de baja despues.
 * - Excepcion: una linea guardada de pura promocion ($0) que ahora trae piezas
 *   vendidas se trata como NUEVA. Venderlas a $0 seria regalar, y regalar va en
 *   `cantidad_promocion` (D13); su precio sale de la lista.
 * - Una presentacion nueva toma el precio de la lista del cliente A LA FECHA
 *   DE LA VENTA (`precios`, sin `vigenteHastaHoy`) con las mismas reglas que el
 *   alta (`revisarLineas`): que se venda, y precio si trae piezas.
 * - Despues, las MISMAS reglas de forma que la tablet (`normalizarDatosVenta`).
 */
export function armarVentaEditada(
  entrada: EntradaVentaPortal,
  guardadas: readonly LineaGuardada[],
  precios: ReadonlyMap<string, number | null>,
  fecha: string,
): ResultadoVentaPortal {
  const porPresentacion = new Map(guardadas.map((g) => [g.presentacionId, g]));
  // El mapa viene en minusculas (uuid de Postgres); el DTO acepta mayusculas.
  const lineas = entrada.lineas.map((l) => ({
    ...l,
    presentacionId: l.presentacionId.toLowerCase(),
  }));

  /** El precio guardado que se conserva, o `undefined` si la linea se trata como nueva. */
  const precioConservado = (l: {
    presentacionId: string;
    cantidad: number;
  }): number | undefined => {
    const g = porPresentacion.get(l.presentacionId);
    if (!g) return undefined;
    return g.precioCentavos > 0 || l.cantidad === 0
      ? g.precioCentavos
      : undefined;
  };

  const nuevas = lineas.filter((l) => precioConservado(l) === undefined);
  const rechazo = revisarLineas(nuevas, precios);
  if (rechazo) {
    return {
      ok: false,
      tipo: 'rechazo',
      // El motivo de `revisarLineas` le habla a la tablet; a la oficina se le
      // dice que falta en la lista, y de que fecha.
      rechazo:
        rechazo.razon === 'precio-no-asignado'
          ? {
              razon: rechazo.razon,
              motivo: `Una de las presentaciones nuevas no tiene precio en la lista del cliente para el ${fecha}.`,
            }
          : rechazo,
    };
  }

  const r = normalizarDatosVenta(entrada.clienteId, {
    num_nota: entrada.numNota,
    contado_credito: entrada.contadoCredito,
    factura: entrada.factura,
    comentarios: entrada.comentarios,
    lineas: lineas.map((l) => ({
      presentacion_id: l.presentacionId,
      cantidad: l.cantidad,
      cantidad_promocion: l.cantidadPromocion,
      precio_centavos:
        precioConservado(l) ?? precios.get(l.presentacionId) ?? 0,
    })),
  });
  if (!r.ok) return { ok: false, tipo: 'invalido', motivo: r.motivo };
  return { ok: true, venta: r.venta };
}

/**
 * El % de comision congelado tras la edicion (§4.2 paso 6). Se compara en
 * minusculas: el DTO acepta uuid en mayusculas.
 */
export function pctComisionTrasEdicion(
  antes: { vendedorId: string | null; pctComision: string | null },
  vendedorNuevo: string | null,
  pctActualDelCliente: string | null,
): string | null {
  if (vendedorNuevo === null) return null;
  if (vendedorNuevo.toLowerCase() === antes.vendedorId?.toLowerCase())
    return antes.pctComision;
  return pctActualDelCliente;
}

export interface PlanDetalle {
  /** Ids de las lineas que ya no vienen: se marcan `deleted_at`. */
  borrar: string[];
  actualizar: {
    id: string;
    cantidad: number;
    cantidadPromocion: number;
    precioCentavos: number;
  }[];
  insertar: LineaVentaNormalizada[];
}

/** §4.2 paso 7. Requiere el indice parcial de la Task 1 para reinsertar una presentacion quitada antes. */
export function planDetalle(
  guardadas: readonly LineaGuardada[],
  nuevas: readonly LineaVentaNormalizada[],
): PlanDetalle {
  const porPresentacion = new Map(guardadas.map((g) => [g.presentacionId, g]));
  const siguen = new Set(nuevas.map((n) => n.presentacionId));
  const plan: PlanDetalle = {
    borrar: guardadas
      .filter((g) => !siguen.has(g.presentacionId))
      .map((g) => g.id),
    actualizar: [],
    insertar: [],
  };
  for (const n of nuevas) {
    const g = porPresentacion.get(n.presentacionId);
    if (g) {
      plan.actualizar.push({
        id: g.id,
        cantidad: n.cantidad,
        cantidadPromocion: n.cantidadPromocion,
        precioCentavos: n.precioCentavos,
      });
    } else {
      plan.insertar.push(n);
    }
  }
  return plan;
}

import {
  normalizarDatosVenta,
  type FacturaVenta,
  type VentaNormalizada,
} from './datos-venta';
import { revisarLineas, type ContadoCredito } from './reglas-venta';
import type { RechazoVenta } from './venta-rechazada';

/**
 * Reglas puras de la venta que captura la oficina en el portal (T-17).
 *
 * Puras por el mismo criterio que `reglas-venta.ts`: deciden, y se prueban sin
 * Postgres. Las usa `VentasPortalService`.
 */

/** Lo que manda el portal, ya validado por el DTO. **No trae precios** (§4.2). */
export interface EntradaVentaPortal {
  clienteId: string;
  /** `null` si no hubo nota de papel. */
  numNota: string | null;
  contadoCredito: ContadoCredito;
  factura: FacturaVenta;
  comentarios: string | null;
  lineas: {
    presentacionId: string;
    cantidad: number;
    cantidadPromocion: number;
  }[];
}

export type ResultadoVentaPortal =
  | { ok: true; venta: VentaNormalizada }
  /** Regla de negocio: el servicio lo traduce a 409. */
  | { ok: false; tipo: 'rechazo'; rechazo: RechazoVenta }
  /** Forma: el servicio lo traduce a 400. */
  | { ok: false; tipo: 'invalido'; motivo: string };

/**
 * Arma la venta con el precio **del servidor**: el de la lista del cliente
 * (con su precio especial) vigente en `fecha` (§2). El cliente no teclea ni
 * manda precios.
 *
 * `precios` es lo que devuelve `presentacionesConPrecio(cliente, fecha)` sin
 * `vigenteHastaHoy`. Primero `revisarLineas` (presentacion que no se vende, o
 * linea con piezas sin precio a esa fecha), despues las MISMAS reglas de forma
 * que la tablet (`normalizarDatosVenta`: 1-50 lineas, sin presentacion
 * repetida, enteros, tope del monto). Una linea de pura promocion sin precio
 * entra a 0 (D13).
 */
export function armarVentaPortal(
  entrada: EntradaVentaPortal,
  precios: ReadonlyMap<string, number | null>,
  fecha: string,
): ResultadoVentaPortal {
  // El mapa viene en minusculas (uuid de Postgres); el DTO acepta mayusculas.
  const lineas = entrada.lineas.map((l) => ({
    ...l,
    presentacionId: l.presentacionId.toLowerCase(),
  }));

  const rechazo = revisarLineas(lineas, precios);
  if (rechazo) {
    return {
      ok: false,
      tipo: 'rechazo',
      // El motivo de `revisarLineas` le habla a la tablet ("vuelve a
      // sincronizar"); a la oficina se le dice que falta en la lista.
      rechazo:
        rechazo.razon === 'precio-no-asignado'
          ? {
              razon: rechazo.razon,
              motivo: `Una de las presentaciones no tiene precio en la lista del cliente para el ${fecha}.`,
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
      precio_centavos: precios.get(l.presentacionId) ?? 0,
    })),
  });
  if (!r.ok) return { ok: false, tipo: 'invalido', motivo: r.motivo };
  return { ok: true, venta: r.venta };
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const FECHA_MINIMA = '2000-01-01';

/**
 * `AAAA-MM-DD` y un dia que existe en el calendario (no `2025-02-30`). Postgres
 * revienta con un 22008 ante un dia imposible: esto lo convierte en un 400.
 */
export function esFechaReal(fecha: string): boolean {
  if (!RE_FECHA.test(fecha)) return false;
  const comprobacion = new Date(`${fecha}T00:00:00Z`);
  return (
    !Number.isNaN(comprobacion.getTime()) &&
    comprobacion.toISOString().slice(0, 10) === fecha
  );
}

/**
 * La fecha de la venta: hoy o un dia pasado, nunca futura (§3).
 *
 * `hoy` es `hoyEnTijuana()`: a las 23:30 de Tijuana en UTC ya es manana, y
 * compararla con el reloj UTC dejaria pasar una venta de "manana". Se compara
 * como texto `AAAA-MM-DD`, que ordena igual que las fechas.
 *
 * @returns el motivo del rechazo, o `null` si la fecha vale.
 */
export function revisarFechaVenta(fecha: string, hoy: string): string | null {
  if (!RE_FECHA.test(fecha))
    return 'La fecha debe tener el formato AAAA-MM-DD.';
  if (!esFechaReal(fecha)) return 'Esa fecha no existe.';
  // El folio solo lleva AAMMDD: 1926 y 2026 darian el mismo y el unique
  // global lo convertiria en un 500.
  if (fecha < FECHA_MINIMA) {
    return 'La fecha de la venta no puede ser anterior al 2000-01-01.';
  }
  if (fecha > hoy) return 'La fecha de la venta no puede ser futura.';
  return null;
}

/**
 * Reglas puras de los pasos de la venta (rediseño, pieza 2): sin React, para que
 * las pantallas solo pinten lo que aqui se decide.
 */
import type { CatalogoPromociones, PromocionAplicable } from '@/datos/promociones-reglas';
import { validarAtendio } from '@/datos/ventas-reglas';

import { montoACentavos } from './gasto';
import { pesos } from '@/ui/pesos';

export type PasoVenta = 'promociones' | 'lista' | 'cobranza' | 'grabada';

export function primerPaso(hayPromociones: boolean): PasoVenta {
  return hayPromociones ? 'promociones' : 'lista';
}

/** `null` = salir de la venta. Desde `grabada` tambien se sale: ya no hay vuelta. */
export function pasoAnterior(paso: PasoVenta, hayPromociones: boolean): PasoVenta | null {
  switch (paso) {
    case 'cobranza':
      return 'lista';
    case 'lista':
      return hayPromociones ? 'promociones' : null;
    default:
      return null;
  }
}

export function checklistPromociones(
  promociones: readonly PromocionAplicable[],
  descartados: ReadonlySet<string>,
): { todas: boolean; palomeadas: number; total: number } {
  const total = promociones.length;
  const palomeadas = promociones.filter((p) => !descartados.has(p.id)).length;
  return { todas: palomeadas === total, palomeadas, total };
}

/** Si todas estan palomeadas las quita todas; si no, las pone todas. Devuelve los descartados. */
export function alternarTodas(
  promociones: readonly PromocionAplicable[],
  descartados: ReadonlySet<string>,
): Set<string> {
  return checklistPromociones(promociones, descartados).todas
    ? new Set(promociones.map((p) => p.id))
    : new Set();
}

export function presentacionPorOmision(productoId: string, catalogo: CatalogoPromociones): string | null {
  for (const [id, p] of catalogo.presentaciones) {
    if (p.productoId === productoId) return id;
  }
  return null;
}

export interface RenglonVenta {
  presentacionId: string;
  etiqueta: string;
  precioCentavos: number;
  quedan: number | null;
}

function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Mililitros de "500 ml" / "1 L" / "1.5 L"; `null` si no se entiende. */
function mililitros(volumen: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(ml|l|lt|lts)\s*$/i.exec(volumen);
  if (!m) return null;
  const n = Number((m[1] ?? '').replace(',', '.'));
  return (m[2] ?? '').toLowerCase() === 'ml' ? n : n * 1000;
}

function partes(etiqueta: string): { producto: string; volumen: string } {
  const i = etiqueta.indexOf(' · ');
  return i < 0
    ? { producto: etiqueta, volumen: '' }
    : { producto: etiqueta.slice(0, i), volumen: etiqueta.slice(i + 3) };
}

function compararEtiquetas(a: string, b: string): number {
  const pa = partes(a);
  const pb = partes(b);
  const porProducto = sinAcentos(pa.producto).localeCompare(sinAcentos(pb.producto), 'es');
  if (porProducto !== 0) return porProducto;
  const ma = mililitros(pa.volumen);
  const mb = mililitros(pb.volumen);
  if (ma !== null && mb !== null && ma !== mb) return ma - mb;
  if (ma !== null && mb === null) return -1;
  if (ma === null && mb !== null) return 1;
  return sinAcentos(pa.volumen).localeCompare(sinAcentos(pb.volumen), 'es');
}

/**
 * Las filas de la lista de venta: solo con precio, en orden de producto (sin
 * acentos) y, dentro, de menor a mayor volumen. Con control de inventario solo
 * las que tienen existencia; sin el, todas y `quedan: null`.
 */
export function renglonesVenta({
  presentaciones,
  existencias,
  controlInventario,
}: {
  presentaciones: readonly { presentacionId: string; etiqueta: string; precioCentavos: number | null }[];
  existencias: ReadonlyMap<string, { existencia: number }>;
  controlInventario: boolean;
}): RenglonVenta[] {
  const filas: RenglonVenta[] = [];
  for (const p of presentaciones) {
    if (p.precioCentavos === null || p.precioCentavos <= 0) continue;
    if (controlInventario) {
      const quedan = existencias.get(p.presentacionId)?.existencia ?? 0;
      if (quedan <= 0) continue;
      filas.push({ presentacionId: p.presentacionId, etiqueta: p.etiqueta, precioCentavos: p.precioCentavos, quedan });
    } else {
      filas.push({
        presentacionId: p.presentacionId,
        etiqueta: p.etiqueta,
        precioCentavos: p.precioCentavos,
        quedan: null,
      });
    }
  }
  return filas.sort((a, b) => compararEtiquetas(a.etiqueta, b.etiqueta));
}

export type TeclaNumerica = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

/** Teclado numerico: sin ceros a la izquierda y sin pasar de `maximo`. */
export function teclear(actual: string, tecla: TeclaNumerica | 'borrar', maximo: number | null): string {
  if (tecla === 'borrar') return actual.slice(0, -1);
  const siguiente = String(Number(actual + tecla));
  if (siguiente === '0') return '';
  if (maximo !== null && Number(siguiente) > maximo) return String(maximo);
  return siguiente;
}

export type OpcionCobranza = 'liquidar' | 'abonar' | 'credito';

export function opcionesCobranza(totalCentavos: number): OpcionCobranza[] {
  return totalCentavos > 0 ? ['liquidar', 'abonar', 'credito'] : ['liquidar'];
}

export function validarCobranzaVenta({
  opcion,
  abonoTexto,
  totalCentavos,
  atendio,
}: {
  opcion: OpcionCobranza;
  abonoTexto: string;
  totalCentavos: number;
  atendio: string;
}): { problemas: string[]; contadoCredito: 'contado' | 'credito'; abonoCentavos: number | null } {
  const problemas: string[] = [];
  const problemaAtendio = validarAtendio(atendio);
  if (problemaAtendio) problemas.push(problemaAtendio);

  let abonoCentavos: number | null = null;
  if (opcion === 'abonar') {
    const abono = montoACentavos(abonoTexto);
    if (abono === null) {
      problemas.push('Escribe cuánto abona el cliente.');
    } else if (abono >= totalCentavos) {
      problemas.push('El abono tiene que ser menor al total; si paga todo, elige Liquidar.');
    } else {
      abonoCentavos = abono;
    }
  }
  return {
    problemas,
    contadoCredito: opcion === 'liquidar' ? 'contado' : 'credito',
    abonoCentavos,
  };
}

export function textoSaldoPendiente(saldoCentavos: number): string {
  return `Saldo pendiente por liquidar ${pesos(saldoCentavos)}`;
}

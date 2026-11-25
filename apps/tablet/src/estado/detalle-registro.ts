import { leerReparto } from '@/datos/cobranzas-reglas';
import type { DetalleVenta } from '@/datos/repositorios/ventas';
import type { Cobranza, MetodoPago, SyncEstado, Venta } from '@/datos/tipos';
import { formatearHora } from '@/ui/momento';
import { pesos } from '@/ui/pesos';
import type { FiltroRegistro, RenglonRegistro } from './registros';

/**
 * "Abrir un movimiento" (rediseño pieza 5, maqueta 18; spec §11): los textos
 * del detalle de una venta o un cobro del registro del dia. Solo lectura; puro.
 * El boton Reimprimir no se pinta hasta la pieza 7.
 */

/** Los filtros fijos de abajo (maqueta 17), en su orden. */
export const FILTROS_REGISTRO: readonly { clave: FiltroRegistro; etiqueta: string }[] = [
  { clave: 'todo', etiqueta: 'Todo' },
  { clave: 'ventas', etiqueta: 'Ventas del día' },
  { clave: 'cobranza', etiqueta: 'Cobranza' },
  { clave: 'pendientes', etiqueta: 'Notas pendientes' },
];

export const MENSAJE_REGISTRO_VACIO = 'Aún no hay movimientos hoy.';
export const MENSAJE_PENDIENTES_VACIO = 'No traes notas por cobrar.';

/** El texto de la lista vacia: en Notas pendientes habla de notas, no de movimientos. */
export function mensajeRegistroVacio(filtro: FiltroRegistro): string {
  return filtro === 'pendientes' ? MENSAJE_PENDIENTES_VACIO : MENSAJE_REGISTRO_VACIO;
}

/** La tarjeta de arriba: "Hoy · 5 movimientos"; en Notas pendientes, "Hoy · 2 notas por cobrar". */
export function textoResumenRegistro(filtro: FiltroRegistro, n: number): string {
  if (filtro === 'pendientes') return `Hoy · ${n} ${n === 1 ? 'nota' : 'notas'} por cobrar`;
  return `Hoy · ${n} ${n === 1 ? 'movimiento' : 'movimientos'}`;
}

/** Un renglon "etiqueta · valor" de una tarjeta del detalle. */
export interface DatoDetalle {
  etiqueta: string;
  valor: string;
}

export const ETIQUETA_METODO_PAGO: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
};

/** "Sí" solo cuando el servidor ya la recibio; pendiente, enviando o con error: "No". */
export function textoSincronizada(estado: SyncEstado): 'Sí' | 'No' {
  return estado === 'sincronizado' ? 'Sí' : 'No';
}

/**
 * "Pagó" y "Quedó a crédito": contado paga todo; credito sin abono no paga
 * nada; con abono al vender, paga el abono y queda el resto.
 */
export function datosDePago(
  v: Pick<Venta, 'contado_credito' | 'monto_total_centavos' | 'abono_centavos'>,
): DatoDetalle[] {
  const pago = v.contado_credito === 'contado' ? v.monto_total_centavos : (v.abono_centavos ?? 0);
  return [
    { etiqueta: 'Pagó', valor: pesos(pago) },
    { etiqueta: 'Quedó a crédito', valor: pesos(v.monto_total_centavos - pago) },
  ];
}

/** Atendió (si se capturo: las ventas anteriores a la pieza 2 no lo tienen), Vendedor y Sincronizada. */
export function datosDeLaVenta(
  v: Pick<Venta, 'atendio_nombre' | 'sync_estado'>,
  vendedor: string,
): DatoDetalle[] {
  const datos: DatoDetalle[] = [];
  if (v.atendio_nombre) datos.push({ etiqueta: 'Atendió', valor: v.atendio_nombre });
  datos.push({ etiqueta: 'Vendedor', valor: vendedor });
  datos.push({ etiqueta: 'Sincronizada', valor: textoSincronizada(v.sync_estado) });
  return datos;
}

/** "Nota TJ261118JP02 · 10:15". */
export function encabezadoVenta(v: Pick<Venta, 'folio' | 'grabada_en'>): string {
  return `Nota ${v.folio} · ${formatearHora(v.grabada_en)}`;
}

export interface RenglonDetalleVenta {
  /** "24 × Jamaica 500 ml" o "4 × Mango 500 ml (promoción)". */
  texto: string;
  importeCentavos: number;
  /** La frase congelada de la promocion (T-74); `null` en lo vendido. */
  frase: string | null;
}

/**
 * Lo vendido ("24 × Jamaica 500 ml" con su importe) y despues lo regalado a
 * $0.00 con su frase. Una linea de pura promocion no sale como "0 × …". Una
 * venta sin regalos guardados (anterior a T-74) toma la promocion de sus
 * lineas, sin frase.
 */
export function renglonesDeVenta(d: Pick<DetalleVenta, 'lineas' | 'promociones'>): RenglonDetalleVenta[] {
  const vendidos = d.lineas
    .filter((l) => l.cantidad > 0)
    .map((l) => ({ texto: `${l.cantidad} × ${l.etiqueta}`, importeCentavos: l.importeCentavos, frase: null }));
  const regalos =
    d.promociones.length > 0
      ? d.promociones.map((p) => ({ cantidad: p.cantidad, etiqueta: p.etiqueta, frase: p.texto as string | null }))
      : d.lineas
          .filter((l) => l.cantidadPromocion > 0)
          .map((l) => ({ cantidad: l.cantidadPromocion, etiqueta: l.etiqueta, frase: null }));
  return [
    ...vendidos,
    ...regalos.map((r) => ({
      texto: `${r.cantidad} × ${r.etiqueta} (promoción)`,
      importeCentavos: 0,
      frase: r.frase,
    })),
  ];
}

/** Monto, Método y Sincronizada de un cobro. */
export function datosDelCobro(c: Pick<Cobranza, 'monto_centavos' | 'metodo_pago' | 'sync_estado'>): DatoDetalle[] {
  return [
    { etiqueta: 'Monto', valor: pesos(c.monto_centavos) },
    { etiqueta: 'Método', valor: ETIQUETA_METODO_PAGO[c.metodo_pago] ?? c.metodo_pago },
    { etiqueta: 'Sincronizada', valor: textoSincronizada(c.sync_estado) },
  ];
}

export interface NotaDelCobro {
  /** "Nota TJ261030JP04". */
  folio: string;
  /** "Aplicado $850.00". */
  aplicado: string;
  /** "Saldo después $0.00"; `null` si la linea no lo guardo. */
  saldoDespues: string | null;
}

export const NOTA_SIN_FOLIO = 'Nota que ya no está en la tablet';

/**
 * Las notas que toco un cobro (`reparto_json`): folio, lo aplicado y el saldo en
 * que la dejo. Un cobro viejo sin reparto guardado sale con la nota elegida y
 * todo el monto, sin saldo (no se inventa).
 */
export function notasDelCobro(
  c: Pick<Cobranza, 'venta_nota_id' | 'monto_centavos' | 'reparto_json'>,
  folioDeNota: (ventaNotaId: string) => string | null,
): NotaDelCobro[] {
  const reparto = leerReparto(c.reparto_json);
  const lineas =
    reparto.length > 0
      ? reparto
      : [{ venta_nota_id: c.venta_nota_id, monto_centavos: c.monto_centavos, saldo_despues_centavos: null }];
  return lineas.map((l) => {
    const folio = folioDeNota(l.venta_nota_id);
    return {
      folio: folio === null ? NOTA_SIN_FOLIO : `Nota ${folio}`,
      aplicado: `Aplicado ${pesos(l.monto_centavos)}`,
      saldoDespues: l.saldo_despues_centavos === null ? null : `Saldo después ${pesos(l.saldo_despues_centavos)}`,
    };
  });
}

/**
 * "Quedó a favor $X": lo que el cobro trajo de mas sobre lo aplicado a notas
 * (`reparto_json`). `null` si no sobra nada o el cobro no guardo reparto
 * (no se inventa).
 */
export function quedoAFavor(c: Pick<Cobranza, 'monto_centavos' | 'reparto_json'>): DatoDetalle | null {
  const reparto = leerReparto(c.reparto_json);
  if (reparto.length === 0) return null;
  const sobra = c.monto_centavos - reparto.reduce((suma, l) => suma + l.monto_centavos, 0);
  return sobra > 0 ? { etiqueta: 'Quedó a favor', valor: pesos(sobra) } : null;
}

export type DestinoRenglon =
  | { tipo: 'detalle'; detalle: 'venta' | 'cobro'; id: string }
  | { tipo: 'cliente'; clienteId: string };

/**
 * Que abre tocar un renglon: la venta o el cobro en su detalle. Una nota
 * pendiente abre su venta si se vendio en esta tablet; si no, la hoja del
 * cliente (para cobrarla).
 */
export function destinoRenglon(
  r: Pick<RenglonRegistro, 'tipo' | 'id' | 'clienteId'>,
  hayVenta: (ventaId: string) => boolean,
): DestinoRenglon {
  if (r.tipo === 'venta') return { tipo: 'detalle', detalle: 'venta', id: r.id };
  if (r.tipo === 'cobro') return { tipo: 'detalle', detalle: 'cobro', id: r.id };
  return hayVenta(r.id) ? { tipo: 'detalle', detalle: 'venta', id: r.id } : { tipo: 'cliente', clienteId: r.clienteId };
}

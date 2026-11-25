import type { BaseDatos } from '@/datos/base-datos';
import { leerAbonos, leerReparto } from '@/datos/cobranzas-reglas';
import { etiquetasDelCatalogo, PRODUCTO_FUERA_DE_CATALOGO } from '@/datos/repositorios/cargas';
import type { Cobranza, MomentoISO, NotaPendiente, Venta } from '@/datos/tipos';
import type { DetalleNotaPull } from '@/sincronizacion/contrato';

import type { DatosTicket } from './ticket';

/**
 * Arma la nota impresa (`DatosTicket`, rediseño pieza 7) desde la base local:
 * la venta recien grabada en esta tablet (`ticketDeVenta`) o una nota pendiente
 * del pull, para reimprimirla al cobrar o desde Ventas / Cobranza (`ticketDeNota`).
 *
 * Solo lee; `null` si lo pedido no esta en la tablet.
 */

/** Cuando la nota no dice quien vendio: venta de mostrador o nota sin detalle. */
export const VENDEDOR_DESCONOCIDO = '—';

/** El aviso de cualquier impresion que no salio (fallo, cancelada o sin datos). */
export const AVISO_NO_IMPRESO = 'No se pudo imprimir. Puedes reimprimir desde Ventas / Cobranza.';

interface Renglon {
  etiqueta: string;
  cantidad: number;
  cantidad_promocion: number;
  precio_centavos: number;
}

interface Promocion {
  etiqueta: string;
  cantidad: number;
  texto: string;
}

/**
 * La misma regla que el detalle de la venta (`renglonesDeVenta`): se venden los
 * renglones con `cantidad > 0`; las promociones salen de las aplicadas (con su
 * frase) y, solo si no hay ninguna (venta vieja), de `cantidad_promocion` de los
 * renglones, sin frase. Nunca de las dos: Piezas contaria doble.
 */
function cuerpo(lineas: Renglon[], promociones: Promocion[]): Pick<DatosTicket, 'renglones' | 'promociones'> {
  return {
    renglones: lineas
      .filter((l) => l.cantidad > 0)
      .map((l) => ({
        cantidad: l.cantidad,
        etiqueta: l.etiqueta,
        precioCentavos: l.precio_centavos,
        importeCentavos: l.cantidad * l.precio_centavos,
      })),
    promociones:
      promociones.length > 0
        ? promociones.map((p) => ({ cantidad: p.cantidad, etiqueta: p.etiqueta, texto: p.texto }))
        : lineas
            .filter((l) => l.cantidad_promocion > 0)
            .map((l) => ({ cantidad: l.cantidad_promocion, etiqueta: l.etiqueta, texto: '' })),
  };
}

function nombre(bd: BaseDatos, tabla: 'cliente' | 'vendedor' | 'sucursal', id: string | null): string | null {
  if (id === null) return null;
  return bd.getFirstSync<{ nombre: string }>(`select nombre from ${tabla} where id = $id`, { $id: id })?.nombre ?? null;
}

/** Encabezado y renglones de una venta grabada en esta tablet. */
function deLaVentaLocal(bd: BaseDatos, v: Venta) {
  const etiquetas = etiquetasDelCatalogo(bd);
  const etiqueta = (presentacionId: string) => etiquetas.get(presentacionId) ?? PRODUCTO_FUERA_DE_CATALOGO;
  const lineas = bd
    .getAllSync<{ presentacion_id: string; cantidad: number; cantidad_promocion: number; precio_centavos: number }>(
      'select presentacion_id, cantidad, cantidad_promocion, precio_centavos from venta_linea where venta_id = $id order by rowid',
      { $id: v.id },
    )
    .map((l) => ({ ...l, etiqueta: etiqueta(l.presentacion_id) }));
  const promociones = bd
    .getAllSync<{ presentacion_id: string; cantidad: number; texto: string }>(
      'select presentacion_id, cantidad, texto from venta_promocion where venta_id = $id order by rowid',
      { $id: v.id },
    )
    .map((p) => ({ cantidad: p.cantidad, texto: p.texto, etiqueta: etiqueta(p.presentacion_id) }));
  return {
    sucursal: nombre(bd, 'sucursal', v.sucursal_id) ?? '',
    momento: v.grabada_en,
    atendio: v.atendio_nombre ?? null,
    vendedor: nombre(bd, 'vendedor', v.vendedor_id) ?? VENDEDOR_DESCONOCIDO,
    ...cuerpo(lineas, promociones),
  };
}

/**
 * La venta recien grabada (o desde su detalle). De contado, LIQUIDADA; a
 * credito, el abono al vender (`abono_centavos`) es el abono del dia de la
 * venta y el saldo es total − abono. No ve los cobros posteriores: para eso
 * esta `ticketDeVentaParaReimprimir`.
 */
export function ticketDeVenta(bd: BaseDatos, ventaId: string): DatosTicket | null {
  const v = bd.getFirstSync<Venta>('select * from venta where id = $id', { $id: ventaId });
  if (!v) return null;
  const abono = v.contado_credito === 'credito' ? (v.abono_centavos ?? 0) : 0;
  return {
    folio: v.folio,
    cliente: nombre(bd, 'cliente', v.cliente_id) ?? 'Cliente',
    ...deLaVentaLocal(bd, v),
    totalCentavos: v.monto_total_centavos,
    abonos: abono > 0 ? [{ fecha: v.fecha, montoCentavos: abono }] : [],
    saldoCentavos: v.contado_credito === 'contado' ? 0 : Math.max(0, v.monto_total_centavos - abono),
    reimpresion: null,
    detalleDisponible: true,
  };
}

/** `detalle_json` tal cual bajo; un texto corrupto o sin renglones es "sin detalle". */
function leerDetalle(json: string | null): DetalleNotaPull | null {
  if (json === null) return null;
  try {
    const d = JSON.parse(json) as Partial<DetalleNotaPull> | null;
    if (!d || !Array.isArray(d.lineas)) return null;
    return { ...d, promociones: Array.isArray(d.promociones) ? d.promociones : [] } as DetalleNotaPull;
  } catch {
    return null;
  }
}

/**
 * Una nota del pull, **activa o no** (un cobro que la liquida la retira con
 * `activo = 0`). Total, saldo y abonos salen siempre de la nota (`abonos_json`
 * ya trae el abono al vender y los cobrados sin red); el encabezado y los
 * renglones, de `detalle_json` y, si no bajo, de la venta de esta tablet con el
 * mismo **folio**. Sin ninguno de los dos: `detalleDisponible: false`.
 *
 * `reimpresion`: el momento y quien cobro, al reimprimirla por un cobro.
 */
export function ticketDeNota(
  bd: BaseDatos,
  notaPendienteId: string,
  reimpresion: DatosTicket['reimpresion'],
): DatosTicket | null {
  const n = bd.getFirstSync<NotaPendiente>('select * from nota_pendiente where id = $id', { $id: notaPendienteId });
  if (!n) return null;
  const cliente = bd.getFirstSync<{ nombre: string; sucursal_id: string }>(
    'select nombre, sucursal_id from cliente where id = $id',
    { $id: n.cliente_id },
  );

  const detalle = leerDetalle(n.detalle_json);
  const local = detalle ? null : bd.getFirstSync<Venta>('select * from venta where folio = $folio', { $folio: n.folio });

  const encabezado = detalle
    ? {
        sucursal: detalle.sucursal_nombre,
        momento: detalle.creada_en,
        atendio: detalle.atendio ?? null,
        vendedor: detalle.vendedor_nombre ?? VENDEDOR_DESCONOCIDO,
        ...cuerpo(detalle.lineas, detalle.promociones),
      }
    : local
      ? deLaVentaLocal(bd, local)
      : {
          sucursal: nombre(bd, 'sucursal', cliente?.sucursal_id ?? null) ?? '',
          // Solo hay dia: medianoche **local** (sin `Z`); con `Z` saldria el dia
          // anterior en Tijuana. La hora impresa no es real.
          momento: `${n.fecha}T00:00:00`,
          atendio: null,
          vendedor: VENDEDOR_DESCONOCIDO,
          renglones: [],
          promociones: [],
        };

  return {
    folio: n.folio,
    cliente: cliente?.nombre ?? 'Cliente',
    ...encabezado,
    totalCentavos: n.monto_total_centavos,
    abonos: leerAbonos(n.abonos_json).map((a) => ({ fecha: a.fecha_pago, montoCentavos: a.monto_centavos })),
    saldoCentavos: n.saldo_centavos,
    reimpresion,
    detalleDisponible: detalle !== null || local !== null,
  };
}

/**
 * "Reimprimir" en el detalle de una venta: si ya bajo su nota pendiente (venta
 * a credito sincronizada), la nota, para que salgan los abonos de despues;
 * si no, la venta local tal como se grabo.
 */
export function ticketDeVentaParaReimprimir(bd: BaseDatos, ventaId: string): DatosTicket | null {
  const v = bd.getFirstSync<{ folio: string }>('select folio from venta where id = $id', { $id: ventaId });
  if (!v) return null;
  const nota = bd.getFirstSync<{ id: string }>('select id from nota_pendiente where folio = $folio', { $folio: v.folio });
  return (nota ? ticketDeNota(bd, nota.id, null) : null) ?? ticketDeVenta(bd, ventaId);
}

/**
 * Las notas que toco un cobro, para reimprimirlas: las de su reparto o, en un
 * cobro viejo sin reparto, la nota que eligio el vendedor. Cada una con
 * "Reimpresión <momento>" y "Cobró <quien cobro>". Una nota que ya no esta en la
 * tablet sale como `null`: la pantalla avisa que no se pudo imprimir.
 */
export function ticketsDelCobro(
  bd: BaseDatos,
  cobro: Pick<Cobranza, 'venta_nota_id' | 'vendedor_id' | 'reparto_json'>,
  momento: MomentoISO,
): (DatosTicket | null)[] {
  const reparto = leerReparto(cobro.reparto_json);
  const ids = reparto.length > 0 ? reparto.map((l) => l.venta_nota_id) : [cobro.venta_nota_id];
  const quienCobro = nombre(bd, 'vendedor', cobro.vendedor_id) ?? VENDEDOR_DESCONOCIDO;
  return [...new Set(ids)].map((id) => ticketDeNota(bd, id, { momento, cobro: quienCobro }));
}

/**
 * Imprime uno tras otro (Android abre un dialogo a la vez) y dice si **todos**
 * salieron. Un ticket `null` (lo pedido ya no esta) o una impresion que truena
 * cuentan como no impresos; nunca lanza, para que la pantalla solo avise.
 */
export async function imprimirEnOrden(
  imprimir: (d: DatosTicket) => Promise<{ ok: boolean }>,
  tickets: (DatosTicket | null)[],
): Promise<boolean> {
  let todos = tickets.length > 0;
  for (const t of tickets) {
    if (t === null) {
      todos = false;
      continue;
    }
    try {
      if (!(await imprimir(t)).ok) todos = false;
    } catch {
      todos = false;
    }
  }
  return todos;
}

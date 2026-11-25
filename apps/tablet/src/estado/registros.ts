import type { NotaQueTrae } from '@/datos/repositorios/notas-asignadas';
import type { Cobranza, Venta } from '@/datos/tipos';
import { formatearHora } from '@/ui/momento';
import { pesos } from '@/ui/pesos';
import { estadoSubida, type EstadoSubida } from './ruta-del-dia';

/**
 * "Ventas / Cobranza" (rediseño pieza 5, maqueta 17; spec §11 y §16-bis): el
 * registro de lo hecho hoy **en esta tablet**. Puro: las pantallas solo pintan.
 */

/** Los cuatro filtros de abajo: Todo, Ventas del día, Cobranza, Notas pendientes. */
export type FiltroRegistro = 'todo' | 'ventas' | 'cobranza' | 'pendientes';

export interface RenglonRegistro {
  /** Unica en la lista: `venta:<id>`, `cobro:<id>` o `nota:<id>`. */
  clave: string;
  tipo: 'venta' | 'cobro' | 'nota';
  /**
   * Lo que abre el renglon: la venta o el cobro. En una nota, su venta si es de
   * esta tablet (`ventaId`); si no, el id de la `nota_pendiente`.
   */
  id: string;
  /** Para abrir la hoja del cliente (una nota sin venta en esta tablet). */
  clienteId: string;
  /** `HH:mm` local de cuando se grabo; `null` en las notas. */
  hora: string | null;
  cliente: string;
  texto: string;
  montoCentavos: number;
  /** La pastilla de subida; `null` en las notas (no se suben). */
  estado: EstadoSubida | null;
}

export interface EntradaRegistro {
  ventas: readonly Pick<
    Venta,
    'id' | 'cliente_id' | 'folio' | 'contado_credito' | 'monto_total_centavos' | 'abono_centavos' | 'grabada_en' | 'sync_estado'
  >[];
  cobros: readonly Pick<Cobranza, 'id' | 'cliente_id' | 'venta_nota_id' | 'monto_centavos' | 'grabada_en' | 'sync_estado'>[];
  /** `notas.queTraeDelVendedor`: la regla unica de "notas que trae". */
  notas: readonly NotaQueTrae[];
  nombreCliente: (clienteId: string) => string;
  /** El folio de una `nota_pendiente` de la tablet, o `null` si ya no esta. */
  folioDeNota: (ventaNotaId: string) => string | null;
}

/** "Venta contado", "Venta crédito" o "Venta abonó $300.00". */
function textoVenta(v: EntradaRegistro['ventas'][number]): string {
  if (v.contado_credito === 'contado') return 'Venta contado';
  if (v.abono_centavos !== null && v.abono_centavos > 0) return `Venta abonó ${pesos(v.abono_centavos)}`;
  return 'Venta crédito';
}

/**
 * Los renglones del filtro y la suma de sus montos ("Hoy · N movimientos").
 * Ventas y cobros van de lo mas nuevo a lo mas viejo (con la misma hora, lo
 * grabado despues arriba). "Notas pendientes" lista `notas` en su orden, con
 * "Nota <folio>" y el saldo.
 */
export function armarRegistro(
  entrada: EntradaRegistro,
  filtro: FiltroRegistro,
): { renglones: RenglonRegistro[]; total: number } {
  const renglones = filtro === 'pendientes' ? renglonesDeNotas(entrada) : movimientos(entrada, filtro);
  return { renglones, total: renglones.reduce((s, r) => s + r.montoCentavos, 0) };
}

function renglonesDeNotas({ notas, nombreCliente }: EntradaRegistro): RenglonRegistro[] {
  return notas.map((n) => {
    const id = n.ventaId ?? n.ventaNotaId ?? n.folio;
    return {
      clave: `nota:${id}`,
      tipo: 'nota',
      id,
      clienteId: n.clienteId,
      hora: null,
      cliente: nombreCliente(n.clienteId),
      texto: `Nota ${n.folio}`,
      montoCentavos: n.saldoCentavos,
      estado: null,
    };
  });
}

function movimientos(
  { ventas, cobros, nombreCliente, folioDeNota }: EntradaRegistro,
  filtro: Exclude<FiltroRegistro, 'pendientes'>,
): RenglonRegistro[] {
  const lista: { grabadaEn: string; renglon: RenglonRegistro }[] = [];
  if (filtro !== 'cobranza') {
    for (const v of ventas) {
      lista.push({
        grabadaEn: v.grabada_en,
        renglon: {
          clave: `venta:${v.id}`,
          tipo: 'venta',
          id: v.id,
          clienteId: v.cliente_id,
          hora: formatearHora(v.grabada_en),
          cliente: nombreCliente(v.cliente_id),
          texto: textoVenta(v),
          montoCentavos: v.monto_total_centavos,
          estado: estadoSubida([v.sync_estado]),
        },
      });
    }
  }
  if (filtro !== 'ventas') {
    for (const c of cobros) {
      const folio = folioDeNota(c.venta_nota_id);
      lista.push({
        grabadaEn: c.grabada_en,
        renglon: {
          clave: `cobro:${c.id}`,
          tipo: 'cobro',
          id: c.id,
          clienteId: c.cliente_id,
          hora: formatearHora(c.grabada_en),
          cliente: nombreCliente(c.cliente_id),
          texto: folio === null ? 'Cobro' : `Cobro nota ${folio}`,
          montoCentavos: c.monto_centavos,
          estado: estadoSubida([c.sync_estado]),
        },
      });
    }
  }
  // Los momentos son ISO UTC del mismo reloj: se comparan como texto. Con la
  // misma marca, lo que llego despues a la lista (grabado despues) va arriba.
  return lista
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => (a.grabadaEn === b.grabadaEn ? b.i - a.i : a.grabadaEn < b.grabadaEn ? 1 : -1))
    .map((x) => x.renglon);
}

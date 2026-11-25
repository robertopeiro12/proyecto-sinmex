import { leerReparto } from '@/datos/cobranzas-reglas';
import type { CapturaCorte } from '@/datos/repositorios/cortes';
import type { CandadoClientes } from '@/datos/inventario-reglas';
import type { NotaAsignadaDeHoy } from '@/datos/notas-asignadas-reglas';
import type { NotaQueTrae } from '@/datos/repositorios/notas-asignadas';
import type { Cobranza, Gasto, Venta } from '@/datos/tipos';
import { pesos } from '@/ui/pesos';

/**
 * El corte del vendedor (rediseño pieza 6, spec §13, maquetas 22–24): lo que el
 * **sistema** espera en cada apartado. Puro: recibe arreglos y regresa valores;
 * la pantalla solo pinta y captura. Dinero en centavos enteros.
 */

export type Apartado = 'efectivo' | 'notas' | 'inventario';
export const APARTADOS: readonly Apartado[] = ['efectivo', 'notas', 'inventario'];

type VentaCorte = Pick<Venta, 'contado_credito' | 'monto_total_centavos' | 'abono_centavos'>;
type CobroCorte = Pick<Cobranza, 'metodo_pago' | 'monto_centavos'>;
type GastoCorte = Pick<Gasto, 'monto_centavos'>;

const suma = (valores: readonly number[]): number => valores.reduce((a, b) => a + b, 0);

/** El abono al vender solo existe en una venta a credito (en una de contado ya es el total). */
const abonoDe = (v: VentaCorte): number => (v.contado_credito === 'credito' ? (v.abono_centavos ?? 0) : 0);

export interface EfectivoEsperado {
  /** Ventas de contado de hoy (total). */
  contadoCentavos: number;
  /** Abonos al vender en ventas a credito (`venta.abono_centavos`, siempre efectivo). */
  abonosCentavos: number;
  /** Cobros de hoy pagados en efectivo. */
  cobrosEfectivoCentavos: number;
  /** "Abonos y cobros" de la maqueta 22: abonos al vender + cobros en efectivo. */
  abonosYCobrosCentavos: number;
  gastosCentavos: number;
  /** contado + abonos + cobros en efectivo − gastos. Puede ser negativo. */
  debeTraerCentavos: number;
  /** Cobros de hoy por transferencia o cheque: se muestran aparte, no son efectivo. */
  otrosMetodosCentavos: number;
}

/** Apartado Efectivo (maqueta 22): lo que debe traer segun el sistema. */
export function efectivoEsperado({
  ventas,
  cobros,
  gastos,
}: {
  ventas: readonly VentaCorte[];
  cobros: readonly CobroCorte[];
  gastos: readonly GastoCorte[];
}): EfectivoEsperado {
  const contadoCentavos = suma(ventas.filter((v) => v.contado_credito === 'contado').map((v) => v.monto_total_centavos));
  const abonosCentavos = suma(ventas.map(abonoDe));
  const cobrosEfectivoCentavos = suma(cobros.filter((c) => c.metodo_pago === 'efectivo').map((c) => c.monto_centavos));
  const otrosMetodosCentavos = suma(cobros.filter((c) => c.metodo_pago !== 'efectivo').map((c) => c.monto_centavos));
  const gastosCentavos = suma(gastos.map((g) => g.monto_centavos));
  return {
    contadoCentavos,
    abonosCentavos,
    cobrosEfectivoCentavos,
    abonosYCobrosCentavos: abonosCentavos + cobrosEfectivoCentavos,
    gastosCentavos,
    debeTraerCentavos: contadoCentavos + abonosCentavos + cobrosEfectivoCentavos - gastosCentavos,
    otrosMetodosCentavos,
  };
}

export interface ResumenDelDia {
  /** Total de las ventas de hoy, de contado y a credito. */
  ventasCentavos: number;
  /** Cobros de hoy, de todos los metodos (sin los abonos al vender). */
  cobranzaCentavos: number;
  gastosCentavos: number;
  visitados: number;
  /** Clientes de la ruta: por visitar + visitados. */
  total: number;
}

/** El resumen de arriba del corte (maquetas 22–24). */
export function resumenDelDia({
  ventas,
  cobros,
  gastos,
  porVisitar,
  visitados,
}: {
  ventas: readonly Pick<Venta, 'monto_total_centavos'>[];
  cobros: readonly Pick<Cobranza, 'monto_centavos'>[];
  gastos: readonly GastoCorte[];
  porVisitar: readonly unknown[];
  visitados: readonly unknown[];
}): ResumenDelDia {
  return {
    ventasCentavos: suma(ventas.map((v) => v.monto_total_centavos)),
    cobranzaCentavos: suma(cobros.map((c) => c.monto_centavos)),
    gastosCentavos: suma(gastos.map((g) => g.monto_centavos)),
    visitados: visitados.length,
    total: porVisitar.length + visitados.length,
  };
}

/** "Resumen del día · 6 de 6 visitados". */
export function textoResumenVisitados(resumen: Pick<ResumenDelDia, 'visitados' | 'total'>): string {
  return `Resumen del día · ${resumen.visitados} de ${resumen.total} visitados`;
}

export type EstadoNotaCorte = 'liquidada' | 'abonó' | 'nueva' | 'pendiente';

export interface RenglonNotaCorte {
  /** Unica en la lista: `nota:<folio>`. Es la que se palomea. */
  clave: string;
  folio: string;
  cliente: string;
  estado: EstadoNotaCorte;
  /** Lo que va tras el cliente: "liquidada", "abonó $400.00", "nueva" o "pendiente". */
  detalle: string;
  /** El saldo, a la derecha. */
  montoTexto: string;
  saldoCentavos: number;
}

/**
 * Apartado Notas (maqueta 23): primero **todas** las asignadas de hoy, en su
 * orden (`notasAsignadas.asignadasDeHoy()`; la liquidada hoy sale "liquidada
 * $0.00"), y luego las nuevas de hoy que trae (`queTraeDelVendedor`, origen
 * `nueva`).
 *
 * Que asignadas trae con saldo lo dice `queTraeDelVendedor` (la regla unica):
 * una asignada que no esta ahi es `liquidada` con saldo 0. Una que si esta es
 * `abonó` si un cobro de hoy en esta tablet la toco (`reparto_json`), o
 * `pendiente`. El saldo de una abonada es el menor entre el de la nota y el
 * que dejo el cobro (`saldo_despues_centavos`): el pull corre antes del push y
 * puede traer el saldo de antes del abono.
 */
export function notasDelCorte({
  asignadas,
  queTrae,
  cobros,
  nombres,
}: {
  asignadas: readonly NotaAsignadaDeHoy[];
  queTrae: readonly NotaQueTrae[];
  cobros: readonly Pick<Cobranza, 'reparto_json'>[];
  nombres: ReadonlyMap<string, string>;
}): RenglonNotaCorte[] {
  const abonado = new Map<string, number>();
  const saldoDespues = new Map<string, number>();
  for (const c of cobros) {
    for (const r of leerReparto(c.reparto_json)) {
      if (r.monto_centavos > 0) abonado.set(r.venta_nota_id, (abonado.get(r.venta_nota_id) ?? 0) + r.monto_centavos);
      if (r.saldo_despues_centavos !== null) {
        const previo = saldoDespues.get(r.venta_nota_id);
        saldoDespues.set(r.venta_nota_id, Math.min(previo ?? r.saldo_despues_centavos, r.saldo_despues_centavos));
      }
    }
  }

  const traidas = new Map<string, NotaQueTrae>();
  for (const n of queTrae) {
    if (n.origen === 'asignada' && n.ventaNotaId !== null) traidas.set(n.ventaNotaId, n);
  }

  // Un saldo nunca baja de 0 (un sobrepago en un cobro lo dejaria negativo):
  // el servidor rechaza un saldo negativo y el corte quedaria en error para siempre.
  const renglon = (
    folio: string,
    clienteId: string,
    estado: EstadoNotaCorte,
    saldo: number,
    detalle: string = estado,
  ): RenglonNotaCorte => {
    const saldoCentavos = Math.max(0, saldo);
    return {
      clave: `nota:${folio}`,
      folio,
      cliente: nombres.get(clienteId) ?? '',
      estado,
      detalle,
      montoTexto: pesos(saldoCentavos),
      saldoCentavos,
    };
  };

  const renglones: RenglonNotaCorte[] = asignadas.map((a) => {
    const trae = traidas.get(a.ventaNotaId);
    if (!trae) return renglon(a.folio, a.clienteId, 'liquidada', 0);
    const abono = abonado.get(a.ventaNotaId) ?? 0;
    if (abono > 0) {
      const despues = saldoDespues.get(a.ventaNotaId);
      const saldo = despues === undefined ? trae.saldoCentavos : Math.min(trae.saldoCentavos, despues);
      return renglon(a.folio, a.clienteId, 'abonó', saldo, `abonó ${pesos(abono)}`);
    }
    return renglon(a.folio, a.clienteId, 'pendiente', trae.saldoCentavos);
  });

  for (const n of queTrae) {
    if (n.origen === 'nueva') renglones.push(renglon(n.folio, n.clienteId, 'nueva', n.saldoCentavos));
  }
  return renglones;
}

/** "3 de 4": las palomeadas que siguen en la lista, de cuantas hay. */
export function textoNotasQueTraes(
  renglones: readonly Pick<RenglonNotaCorte, 'clave'>[],
  palomeadas: ReadonlySet<string>,
): string {
  const traidas = renglones.filter((r) => palomeadas.has(r.clave)).length;
  return `${traidas} de ${renglones.length}`;
}

/** Una fila de `filasPorRegresar` (`src/estado/inventario.ts`). */
export interface FilaPorRegresar {
  presentacionId: string;
  etiqueta: string;
  buenas: number;
  merma: number;
}

export interface InventarioDelCorte {
  renglones: { presentacionId: string; etiqueta: string; sistema: number }[];
  /** Toda la merma por regresar, en un solo renglon ("Merma · Sistema: 5"). */
  mermaSistema: number;
}

/**
 * Apartado Inventario (maqueta 24): un renglon por producto con las buenas por
 * regresar (`filasPorRegresar`, que ya descuenta la merma) y un solo total de
 * merma. Un producto con solo merma no lleva renglon propio: suma al total.
 */
export function inventarioDelCorte(filas: readonly FilaPorRegresar[]): InventarioDelCorte {
  return {
    renglones: filas
      .filter((f) => f.buenas > 0)
      .map((f) => ({ presentacionId: f.presentacionId, etiqueta: f.etiqueta, sistema: f.buenas })),
    mermaSistema: suma(filas.map((f) => Math.max(0, f.merma))),
  };
}

/** El boton Corte se enciende con los tres apartados cerrados. */
export function puedeEnviarCorte(cerrados: ReadonlySet<Apartado>): boolean {
  return APARTADOS.every((a) => cerrados.has(a));
}

/**
 * ¿Se puede entrar al Corte? Con el dia cerrado, si (resumen de solo lectura).
 * Con clientes por visitar, no, pero solo si los clientes se pueden abrir
 * (`candadoDeClientes === null`): con candado de inventario (sin carga
 * aceptada) no podria visitarlos y el dia quedaria sin cerrar.
 */
export function corteDisponible({
  porVisitar,
  candado,
  diaCerrado,
}: {
  porVisitar: number;
  candado: CandadoClientes;
  diaCerrado: boolean;
}): boolean {
  if (diaCerrado) return true;
  return !(porVisitar > 0 && candado === null);
}

/** El aviso del Corte con clientes por visitar (se llego por un enlace directo). */
export function textoFaltanPorVisitar(porVisitar: number): string {
  return porVisitar === 1 ? 'Falta 1 cliente por visitar' : `Faltan ${porVisitar} clientes por visitar`;
}

/** Piezas contadas: solo digitos (entero >= 0). Vacio, signo, punto o coma = `null`. */
export function leerPiezas(texto: string): number | null {
  const limpio = texto.trim();
  if (!/^\d+$/.test(limpio)) return null;
  const n = Number(limpio);
  return Number.isSafeInteger(n) ? n : null;
}

/** Centavos guardados al texto del campo "¿Cuánto traes?" (432500 → "4325.00"); `null` → "". */
export function textoMontoCaptura(centavos: number | null): string {
  if (centavos === null) return '';
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
}

/**
 * Lo que queda al **cerrar** el apartado Inventario (maqueta 24): un conteo por
 * cada renglon del sistema y la merma. Un campo que el vendedor no toco
 * (`piezas` sin llave, `merma` `undefined`) vale lo que dice el sistema: viene
 * prellenado, y sin guardarlo subiria como 0. Un campo tocado que no es un
 * entero >= 0 (vacio incluido) no deja cerrar: `null`.
 */
export function inventarioCapturado(
  inventario: InventarioDelCorte,
  piezas: Readonly<Record<string, string>>,
  merma: string | undefined,
): Pick<CapturaCorte, 'inventarioContado'> & { mermaContada: number } | null {
  const inventarioContado: Record<string, number> = {};
  for (const r of inventario.renglones) {
    const texto = piezas[r.presentacionId];
    const contado = texto === undefined ? r.sistema : leerPiezas(texto);
    if (contado === null) return null;
    inventarioContado[r.presentacionId] = contado;
  }
  const mermaContada = merma === undefined ? inventario.mermaSistema : leerPiezas(merma);
  if (mermaContada === null) return null;
  return { inventarioContado, mermaContada };
}

/**
 * La captura que se envia con el corte. El dia sigue abierto despues de cerrar
 * Inventario: si una venta o una merma posterior agrego un renglon al sistema,
 * ese renglon sale con lo del sistema (no con 0); igual la merma sin contar.
 */
export function capturaParaEnviar(captura: CapturaCorte, inventario: InventarioDelCorte): CapturaCorte {
  const inventarioContado = { ...captura.inventarioContado };
  for (const r of inventario.renglones) {
    if (inventarioContado[r.presentacionId] === undefined) inventarioContado[r.presentacionId] = r.sistema;
  }
  return {
    ...captura,
    inventarioContado,
    mermaContada: captura.mermaContada ?? inventario.mermaSistema,
  };
}

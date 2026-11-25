/**
 * Reglas del Inventario de PT con Ventas, sin base ni Nest: la UNICA cuenta del
 * Final y de la Merma acumulada, el encadenado de dias desde un ajuste ("borron
 * y cuenta nueva"), la suma de sucursales (Todas) y de presentaciones (por
 * producto) y la validacion del guardado de ajustes. El portal no recalcula.
 * Spec: docs/superpowers/specs/2026-11-25-inventario-pt-ventas-design.md (D2, D3, D6).
 */
import {
  esFechaReal,
  MENSAJE_FECHA_FUTURA,
  MENSAJE_FECHA_INVALIDA,
  MENSAJE_PRESENTACION_REPETIDA,
} from './reglas-comunes';
import { compararTamano } from './reglas-corte';

export const MENSAJE_SIN_RENGLONES = 'Captura al menos una presentación.';
export const MENSAJE_AJUSTE_INVALIDO =
  'El inventario inicial y la merma acumulada deben ser números enteros mayores o iguales a 0.';

/** Lo que se movio de una presentacion en una sucursal y un dia (D2). */
export interface MovimientosDia {
  ventas: number;
  /** Registro `merma` + merma de vendedores (contada o teorica) + Procesos merma de Oficina. */
  merma: number;
  consumo: number;
  promo: number;
  descuentos: number;
  /** Neto: lo que regreso el cliente suma, lo que se le entrego resta. */
  cambios: number;
  /** Registro `entrada` + envios recibidos. */
  entradas: number;
  /** Envios que salieron. */
  envios: number;
  /** Retiro de merma autorizado: solo baja la Merma acumulada. */
  retiroMerma: number;
}

export const SIN_MOVIMIENTOS: Readonly<MovimientosDia> = Object.freeze({
  ventas: 0,
  merma: 0,
  consumo: 0,
  promo: 0,
  descuentos: 0,
  cambios: 0,
  entradas: 0,
  envios: 0,
  retiroMerma: 0,
});

const CAMPOS = Object.keys(SIN_MOVIMIENTOS) as (keyof MovimientosDia)[];

export function sumarMovimientos(
  a: MovimientosDia,
  b: MovimientosDia,
): MovimientosDia {
  const r = { ...SIN_MOVIMIENTOS };
  for (const c of CAMPOS) r[c] = a[c] + b[c];
  return r;
}

/** Un ajuste vivo de una presentacion en una sucursal (D3). */
export interface AjustePt {
  fecha: string;
  inventarioInicial: number;
  mermaAcumuladaInicial: number;
}

/** El estado de una presentacion en un dia. `null` = sin inventario inicial (nunca 0). */
export interface EstadoPt {
  inicial: number | null;
  final: number | null;
  mermaAcumulada: number | null;
  /** Ese dia tiene un ajuste: su Inicial es el del ajuste. */
  ajustado: boolean;
}

export interface DiaPt extends MovimientosDia, EstadoPt {
  fecha: string;
}

/**
 * Un renglon de la pantalla: una presentacion (o, con "Por producto", un
 * producto: `presentacionId` null y `volumen` vacio).
 */
export interface RenglonPt extends MovimientosDia, EstadoPt {
  presentacionId: string | null;
  productoId: string;
  producto: string;
  volumen: string;
}

/** `Final = Inicial − Ventas − Merma − Consumo − Promo − Descuentos + Cambios + Entradas − Envíos`. */
export function finalDelDia(
  inicial: number | null,
  m: MovimientosDia,
): number | null {
  if (inicial === null) return null;
  return (
    inicial -
    m.ventas -
    m.merma -
    m.consumo -
    m.promo -
    m.descuentos +
    m.cambios +
    m.entradas -
    m.envios
  );
}

/** `Merma acumulada = la del dia anterior (o la del ajuste) + Merma − Retiro de merma`. */
export function mermaAcumuladaDelDia(
  anterior: number | null,
  m: MovimientosDia,
): number | null {
  return anterior === null ? null : anterior + m.merma - m.retiroMerma;
}

function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Los dias de `desde` a `hasta`, ambos incluidos (`[]` si `desde > hasta`). */
export function diasEntre(desde: string, hasta: string): string[] {
  const dias: string[] = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) dias.push(d);
  return dias;
}

/** Cuantos dias hay de `desde` a `hasta`, ambos incluidos. */
export function largoDelRango(desde: string, hasta: string): number {
  const ms = (f: string) => {
    const [a, m, d] = f.split('-').map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((ms(hasta) - ms(desde)) / 86_400_000) + 1;
}

/** El dia desde el que hay que encadenar: el ajuste mas reciente <= `desde`, o `desde`. */
export function inicioDeSerie(
  ajustes: readonly AjustePt[],
  desde: string,
): string {
  let inicio: string | null = null;
  for (const a of ajustes)
    if (a.fecha <= desde && (inicio === null || a.fecha > inicio))
      inicio = a.fecha;
  return inicio ?? desde;
}

/**
 * La serie de una presentacion en una sucursal de `desde` a `hasta`: arranca
 * en el ajuste mas reciente <= `desde` (o sin inventario inicial) y encadena
 * dia por dia; un ajuste reemplaza el Inicial y la Merma acumulada de arranque
 * de su dia. `movimientos` va por fecha; un dia sin entrada es todo 0.
 */
export function serie(
  ajustes: readonly AjustePt[],
  movimientos: ReadonlyMap<string, MovimientosDia>,
  desde: string,
  hasta: string,
): DiaPt[] {
  const porFecha = new Map(ajustes.map((a) => [a.fecha, a]));
  let final: number | null = null;
  let mermaAcumulada: number | null = null;
  const dias: DiaPt[] = [];
  for (const fecha of diasEntre(inicioDeSerie(ajustes, desde), hasta)) {
    const m = movimientos.get(fecha) ?? SIN_MOVIMIENTOS;
    const ajuste = porFecha.get(fecha);
    const inicial = ajuste ? ajuste.inventarioInicial : final;
    const mermaInicial = ajuste ? ajuste.mermaAcumuladaInicial : mermaAcumulada;
    final = finalDelDia(inicial, m);
    mermaAcumulada = mermaAcumuladaDelDia(mermaInicial, m);
    if (fecha >= desde)
      dias.push({
        fecha,
        ...m,
        inicial,
        final,
        mermaAcumulada,
        ajustado: ajuste !== undefined,
      });
  }
  return dias;
}

const sumaONull = (valores: (number | null)[]): number | null =>
  valores.some((v) => v === null)
    ? null
    : valores.reduce<number>((t, v) => t + (v as number), 0);

/**
 * Suma de renglones (sucursales con "Todas", presentaciones con "Por
 * producto"): movimientos sumados; Inicial, Final y Merma acumulada `null` si
 * alguna parte no tiene inventario inicial. Los datos de identidad son los del
 * primero.
 */
export function sumarRenglones<T extends MovimientosDia & EstadoPt>(
  partes: readonly T[],
): T {
  const movs = partes.reduce<MovimientosDia>((t, p) => sumarMovimientos(t, p), {
    ...SIN_MOVIMIENTOS,
  });
  return {
    ...partes[0],
    ...movs,
    inicial: sumaONull(partes.map((p) => p.inicial)),
    final: sumaONull(partes.map((p) => p.final)),
    mermaAcumulada: sumaONull(partes.map((p) => p.mermaAcumulada)),
    ajustado: partes.some((p) => p.ajustado),
  };
}

/**
 * Una sucursal "tiene datos" de una presentacion si tiene un ajuste que la
 * encadena o algun movimiento distinto de 0 en el rango.
 */
export function tieneDatos(
  ajustes: readonly AjustePt[],
  movimientos: ReadonlyMap<string, MovimientosDia>,
): boolean {
  if (ajustes.length > 0) return true;
  for (const m of movimientos.values())
    if (CAMPOS.some((c) => m[c] !== 0)) return true;
  return false;
}

/**
 * Todas (decision del controlador, 2026-11-25): una sucursal sin ajuste y sin
 * ningun movimiento en esa presentacion aporta 0 (nunca la manejo); una con
 * movimiento y sin ajuste deja la presentacion en null. Si ninguna tiene
 * datos, la presentacion queda sin inventario inicial (null, no 0).
 */
export function sumarSucursales(
  series: readonly { dias: DiaPt[]; conDatos: boolean }[],
): DiaPt[] {
  const conDatos = series.filter((s) => s.conDatos);
  const usadas = conDatos.length > 0 ? conDatos : series.slice(0, 1);
  if (usadas.length === 0) return [];
  return usadas[0].dias.map((_, i) =>
    sumarRenglones(usadas.map((s) => s.dias[i])),
  );
}

/** Orden de la vista por presentacion: tamano, producto, id. */
export function compararPresentaciones(
  a: { volumen: string; producto: string; presentacionId: string | null },
  b: { volumen: string; producto: string; presentacionId: string | null },
): number {
  return (
    compararTamano(a.volumen, b.volumen) ||
    a.producto.localeCompare(b.producto, 'es') ||
    (a.presentacionId ?? '').localeCompare(b.presentacionId ?? '')
  );
}

export function ordenarPorPresentacion(renglones: RenglonPt[]): RenglonPt[] {
  return renglones.sort(compararPresentaciones);
}

/** "Por producto": un renglon por producto sumando sus presentaciones, por nombre. */
export function porProducto(renglones: readonly RenglonPt[]): RenglonPt[] {
  const grupos = new Map<string, RenglonPt[]>();
  for (const r of renglones) {
    const g = grupos.get(r.productoId) ?? [];
    g.push(r);
    grupos.set(r.productoId, g);
  }
  return [...grupos.values()]
    .map((g) => ({ ...sumarRenglones(g), presentacionId: null, volumen: '' }))
    .sort(
      (a, b) =>
        a.producto.localeCompare(b.producto, 'es') ||
        a.productoId.localeCompare(b.productoId),
    );
}

/** Un renglon que manda "Ajustar inventario". */
export interface AjustePedido {
  presentacionId: string;
  inventarioInicial: number;
  mermaAcumuladaInicial: number;
}

const esConteo = (n: unknown) =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** Mensajes de error del guardado de ajustes; `[]` = valido. Hoy o antes (D3). */
export function validarAjustes(
  entrada: { fecha: string; renglones: readonly AjustePedido[] },
  hoyTijuana: string,
): string[] {
  const mensajes: string[] = [];
  if (!esFechaReal(entrada.fecha)) mensajes.push(MENSAJE_FECHA_INVALIDA);
  else if (entrada.fecha > hoyTijuana) mensajes.push(MENSAJE_FECHA_FUTURA);
  if (entrada.renglones.length === 0) mensajes.push(MENSAJE_SIN_RENGLONES);
  if (
    entrada.renglones.some(
      (r) =>
        !esConteo(r.inventarioInicial) || !esConteo(r.mermaAcumuladaInicial),
    )
  )
    mensajes.push(MENSAJE_AJUSTE_INVALIDO);
  const ids = entrada.renglones.map((r) => r.presentacionId.toLowerCase());
  if (new Set(ids).size !== ids.length)
    mensajes.push(MENSAJE_PRESENTACION_REPETIDA);
  return mensajes;
}

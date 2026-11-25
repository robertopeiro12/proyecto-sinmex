import { apiFetch, apiFetchSinCuerpo } from "./api";
import { claveTamano, compararTamano } from "./cortes";

// Copia normativa de `MovimientosDia`, `RenglonPt`, `InventarioPt`, `HistorialPt`,
// `DescuentosPt`, `AjustesPt` y el cuerpo de `PUT /inventario-pt/ajustes`
// (apps/backend/src/modules/produccion/inventario-pt.service.ts,
// reglas-inventario-pt.ts y dto/inventario-pt.dto.ts). El portal no importa del backend:
// un cambio de forma en un lado exige el equivalente en el otro. Spec:
// docs/superpowers/specs/2026-11-25-inventario-pt-ventas-design.md. El portal NO recalcula
// el inventario (D6): solo suma los totales por tamaño y el total del historial.

export interface MovimientosDia {
  ventas: number;
  merma: number;
  consumo: number;
  promo: number;
  descuentos: number;
  /** Neto: lo que regresó el cliente suma, lo que se le entregó resta (puede ser negativo). */
  cambios: number;
  /** Registro `entrada` + envíos recibidos de otra sucursal. */
  entradas: number;
  envios: number;
  retiroMerma: number;
}

export interface RenglonPt extends MovimientosDia {
  /** `null` en la vista por producto. */
  presentacionId: string | null;
  productoId: string;
  producto: string;
  /** `''` en la vista por producto. */
  volumen: string;
  /** `null` = "Sin inventario inicial" (no hay un ajuste anterior): celda vacía, nunca 0. */
  inicial: number | null;
  final: number | null;
  mermaAcumulada: number | null;
  /** El Inicial de ese día sale de un ajuste. */
  ajustado: boolean;
}

export type VistaPt = "presentacion" | "producto";

/** `GET /inventario-pt`. */
export interface InventarioPt {
  fecha: string;
  hoyEnTijuana: string;
  renglones: RenglonPt[];
}

export type DiaPt = RenglonPt & { fecha: string };

/** `GET /inventario-pt/historial`: del más viejo al más nuevo. */
export interface HistorialPt {
  dias: DiaPt[];
}

export type OrigenDescuentoPt = "corte" | "nomina";

/** `GET /inventario-pt/descuentos`. */
export interface DescuentosPt {
  detalle: { quien: string; origen: OrigenDescuentoPt; piezas: number }[];
}

export interface RenglonAjustePt {
  presentacionId: string;
  productoId: string;
  producto: string;
  volumen: string;
  /** El ajuste del día si lo hay; si no, el Inicial calculado. `null` si no hay cadena. */
  inventarioInicial: number | null;
  mermaAcumuladaInicial: number | null;
  ajustado: boolean;
}

/** `GET /inventario-pt/ajustes`: solo presentaciones vivas, por tamaño y producto. */
export interface AjustesPt {
  fecha: string;
  hoyEnTijuana: string;
  renglones: RenglonAjustePt[];
}

export interface RenglonGuardarAjustePt {
  presentacionId: string;
  inventarioInicial: number;
  mermaAcumuladaInicial: number;
}

/** Cuerpo de `PUT /inventario-pt/ajustes` (204). */
export interface GuardarAjustesPt {
  fecha: string;
  sucursal: string;
  comentario?: string | null;
  renglones: RenglonGuardarAjustePt[];
}

/** El historial y los descuentos se piden por una presentación o por un producto. */
export type CualPt = { presentacion: string } | { producto: string };

/** Tope del rango del historial (el servidor responde 400 con más). */
export const MAX_DIAS_HISTORIAL = 62;
/** Tope del comentario del ajuste. */
export const MAX_COMENTARIO_AJUSTE = 300;

function cual(c: CualPt): [string, string] {
  return "presentacion" in c ? ["presentacion", c.presentacion] : ["producto", c.producto];
}

export function leerInventarioPt(fecha: string, sucursal: string, vista: VistaPt): Promise<InventarioPt> {
  const params = new URLSearchParams({ fecha, sucursal, vista });
  return apiFetch<InventarioPt>(`/inventario-pt?${params.toString()}`);
}

export function leerHistorialPt(c: CualPt, desde: string, hasta: string, sucursal: string): Promise<HistorialPt> {
  const params = new URLSearchParams([cual(c), ["desde", desde], ["hasta", hasta], ["sucursal", sucursal]]);
  return apiFetch<HistorialPt>(`/inventario-pt/historial?${params.toString()}`);
}

export function leerDescuentosPt(c: CualPt, fecha: string, sucursal: string): Promise<DescuentosPt> {
  const params = new URLSearchParams([cual(c), ["fecha", fecha], ["sucursal", sucursal]]);
  return apiFetch<DescuentosPt>(`/inventario-pt/descuentos?${params.toString()}`);
}

export function leerAjustesPt(fecha: string, sucursal: string): Promise<AjustesPt> {
  const params = new URLSearchParams({ fecha, sucursal });
  return apiFetch<AjustesPt>(`/inventario-pt/ajustes?${params.toString()}`);
}

export function guardarAjustesPt(datos: GuardarAjustesPt): Promise<void> {
  return apiFetchSinCuerpo("/inventario-pt/ajustes", { method: "PUT", body: JSON.stringify(datos) });
}

/** Da de baja el ajuste de una presentación ese día: vuelve a encadenar desde el anterior. */
export function borrarAjustePt(fecha: string, sucursal: string, presentacionId: string): Promise<void> {
  const params = new URLSearchParams({ fecha, sucursal, presentacionId });
  return apiFetchSinCuerpo(`/inventario-pt/ajustes?${params.toString()}`, { method: "DELETE" });
}

// ── Reglas de la pantalla (puras) ──────────────────────────────────────────────

const MOVIMIENTOS: (keyof MovimientosDia)[] = [
  "ventas",
  "merma",
  "consumo",
  "promo",
  "descuentos",
  "cambios",
  "entradas",
  "envios",
  "retiroMerma",
];

export type TotalesPt = MovimientosDia & {
  /** `null` si algún renglón del grupo no tiene inventario inicial. */
  inicial: number | null;
  final: number | null;
  mermaAcumulada: number | null;
};

export interface GrupoPt {
  /** Volumen del primer renglón ("500 ml"). */
  tamano: string;
  renglones: RenglonPt[];
  totales: TotalesPt;
}

export function totalesHistorial(renglones: readonly MovimientosDia[]): MovimientosDia {
  const t = Object.fromEntries(MOVIMIENTOS.map((k) => [k, 0])) as unknown as MovimientosDia;
  for (const r of renglones) for (const k of MOVIMIENTOS) t[k] += r[k];
  return t;
}

/** Suma que se vuelve `null` si un renglón no tiene el dato: un total a medias engañaría. */
function sumaCompleta(renglones: readonly RenglonPt[], valor: (r: RenglonPt) => number | null): number | null {
  let total = 0;
  for (const r of renglones) {
    const v = valor(r);
    if (v === null) return null;
    total += v;
  }
  return total;
}

/** Por tamaño (`compararTamano`, de chico a grande) y dentro por producto (la tabla y la rejilla de ajustes). */
export function agruparPorTamano<T extends { producto: string; volumen: string }>(
  renglones: readonly T[],
): { tamano: string; renglones: T[] }[] {
  const porClave = new Map<string, T[]>();
  for (const r of renglones) {
    const clave = claveTamano(r.volumen);
    porClave.set(clave, [...(porClave.get(clave) ?? []), r]);
  }
  return [...porClave.values()]
    .map((rs) => [...rs].sort((a, b) => a.producto.localeCompare(b.producto, "es")))
    .sort((a, b) => compararTamano(a[0].volumen, b[0].volumen))
    .map((rs) => ({ tamano: rs[0].volumen, renglones: rs }));
}

/** Los grupos por tamaño de la tabla del día, con su total. */
export function gruposPt(renglones: readonly RenglonPt[]): GrupoPt[] {
  return agruparPorTamano(renglones).map(({ tamano, renglones: rs }) => ({
      tamano,
      renglones: rs,
      totales: {
        ...totalesHistorial(rs),
        inicial: sumaCompleta(rs, (r) => r.inicial),
        final: sumaCompleta(rs, (r) => r.final),
        mermaAcumulada: sumaCompleta(rs, (r) => r.mermaAcumulada),
      },
    }));
}

/** Días de `desde` a `hasta`, contando los dos. */
export function diasDelRango(desde: string, hasta: string): number {
  const ms = Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/** `+2`, `−2` (signo menos tipográfico), `0`. */
export function textoCambios(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return "0";
}

export function textoOrigenDescuento(o: OrigenDescuentoPt): string {
  return o === "corte" ? "Faltante del corte" : "Nómina";
}

/** Lo escrito en la rejilla de ajustes, por presentación. */
export type CapturaAjuste = Record<string, { inicial: string; merma: string }>;

const ENTERO = /^\d+$/;
const MAX_ENTERO = 2_147_483_647;
const texto = (n: number | null) => (n === null ? "" : String(n));
const valido = (t: string) => ENTERO.test(t) && Number(t) <= MAX_ENTERO;

/**
 * Los renglones que cambiaron respecto a la precarga (solo esos se guardan, D3); los
 * cambiados con un número mal escrito (`invalidos`: no entero o negativo) y los que tienen
 * uno de los dos vacíos (`incompletos`: TAB baja por la columna, así que mientras se captura
 * es normal; solo impide guardar).
 */
export function cambiosDeAjuste(
  precarga: readonly RenglonAjustePt[],
  captura: CapturaAjuste,
): { renglones: RenglonGuardarAjustePt[]; invalidos: string[]; incompletos: string[] } {
  const renglones: RenglonGuardarAjustePt[] = [];
  const invalidos: string[] = [];
  const incompletos: string[] = [];
  for (const r of precarga) {
    const c = captura[r.presentacionId];
    if (!c) continue;
    const inicial = c.inicial.trim();
    const merma = c.merma.trim();
    if (inicial === texto(r.inventarioInicial) && merma === texto(r.mermaAcumuladaInicial)) continue;
    if ((inicial !== "" && !valido(inicial)) || (merma !== "" && !valido(merma))) {
      invalidos.push(r.presentacionId);
      continue;
    }
    if (inicial === "" || merma === "") {
      incompletos.push(r.presentacionId);
      continue;
    }
    renglones.push({
      presentacionId: r.presentacionId,
      inventarioInicial: Number(inicial),
      mermaAcumuladaInicial: Number(merma),
    });
  }
  return { renglones, invalidos, incompletos };
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "del 17 al 23 de noviembre" (el título del historial); con otro año, lo dice. */
export function textoRango(desde: string, hasta: string): string {
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  if (desde === hasta) return `${d2} de ${MESES[m2 - 1]}`;
  if (a1 !== a2) return `del ${d1} de ${MESES[m1 - 1]} de ${a1} al ${d2} de ${MESES[m2 - 1]} de ${a2}`;
  if (m1 !== m2) return `del ${d1} de ${MESES[m1 - 1]} al ${d2} de ${MESES[m2 - 1]}`;
  return `del ${d1} al ${d2} de ${MESES[m2 - 1]}`;
}

import { apiFetch } from "./api";

// Copia normativa de las formas de apps/backend/src/modules/produccion/reglas-carga.ts
// (`Rejilla`, `CargaRejilla`, ...). Mismo trato que lib/rutas.ts: un cambio de forma
// en un lado exige el equivalente en el otro.

export type EstadoCarga = "pendiente" | "aceptada" | "rechazada";

export interface LineaCarga {
  presentacionId: string;
  piezas: number;
}

export interface PresentacionRejilla {
  id: string;
  productoNombre: string;
  volumen: string;
  /** `false` = dada de baja: sale solo si una carga del dia la trae y no se captura. */
  activa: boolean;
}

export interface CargaRejilla {
  id: string;
  numero: number;
  estado: EstadoCarga;
  motivoRechazo: string | null;
  version: number;
  respondidaEn: string | null;
  lineas: LineaCarga[];
}

export interface VendedorRejilla {
  id: string;
  nombre: string;
  cargas: CargaRejilla[];
}

export interface Rejilla {
  fecha: string;
  sucursal: { id: string; codigo: string; nombre: string };
  presentaciones: PresentacionRejilla[];
  vendedores: VendedorRejilla[];
}

/** El mismo tope que valida el servidor. */
export const MAX_PIEZAS_LINEA = 99_999;

export const ETIQUETA_ESTADO: Record<EstadoCarga, string> = {
  pendiente: "Pendiente",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
};

export function obtenerRejilla(fecha: string, sucursalId: string): Promise<Rejilla> {
  const params = new URLSearchParams({ fecha, sucursal: sucursalId });
  return apiFetch<Rejilla>(`/cargas?${params.toString()}`);
}

/** La carga de HOY (D8): el numero lo pone el servidor. */
export function crearCarga(datos: { vendedorId: string; lineas: LineaCarga[] }): Promise<CargaRejilla> {
  return apiFetch<CargaRejilla>("/cargas", { method: "POST", body: JSON.stringify(datos) });
}

/** Reemplaza las lineas y la regresa a pendiente (D5); 409 si cambio o ya se acepto. */
export function editarCarga(
  id: string,
  datos: { version: number; lineas: LineaCarga[] },
): Promise<CargaRejilla> {
  return apiFetch<CargaRejilla>(`/cargas/${id}`, { method: "PATCH", body: JSON.stringify(datos) });
}

export function eliminarCarga(id: string, version: number): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/cargas/${id}`, {
    method: "DELETE",
    body: JSON.stringify({ version }),
  });
}

/** Lo que se teclea en la subcolumna editable: texto por presentacion. */
export type Borrador = Record<string, string>;

/**
 * Las piezas de una carga como texto editable. Con `presentaciones` (al editar),
 * solo quedan las que siguen activas: el servidor rechaza una linea de una
 * presentacion dada de baja, y la celda de esa fila no tiene campo, asi que sin
 * este filtro una pendiente o rechazada que la trae no se podria guardar nunca.
 */
export function borradorDe(
  carga: CargaRejilla | null,
  presentaciones?: readonly PresentacionRejilla[],
): Borrador {
  const activas = presentaciones
    ? new Set(presentaciones.filter((p) => p.activa).map((p) => p.id))
    : null;
  const borrador: Borrador = {};
  for (const l of carga?.lineas ?? []) {
    if (activas && !activas.has(l.presentacionId)) continue;
    borrador[l.presentacionId] = String(l.piezas);
  }
  return borrador;
}

/**
 * Texto → lineas. Vacio o 0 no es linea (el almacenista solo llena lo que
 * entrega); cualquier otra cosa que no sea un entero de 1 a 99 999 es error.
 */
export function leerBorrador(borrador: Borrador): { lineas: LineaCarga[]; error: string | null } {
  const lineas: LineaCarga[] = [];
  for (const [presentacionId, texto] of Object.entries(borrador)) {
    const limpio = texto.trim();
    if (limpio === "" || /^0+$/.test(limpio)) continue;
    if (!/^\d+$/.test(limpio) || Number(limpio) > MAX_PIEZAS_LINEA) {
      return { lineas: [], error: "Las piezas son enteras, de 1 a 99 999." };
    }
    lineas.push({ presentacionId, piezas: Number(limpio) });
  }
  if (lineas.length === 0) return { lineas: [], error: "Captura al menos un producto." };
  return { lineas, error: null };
}

/** El total al pie mientras se edita: solo lo legible. */
export function totalBorrador(borrador: Borrador): number {
  return Object.values(borrador).reduce((total, texto) => {
    const limpio = texto.trim();
    return /^\d+$/.test(limpio) ? total + Number(limpio) : total;
  }, 0);
}

export function piezasDe(carga: CargaRejilla, presentacionId: string): number | null {
  return carga.lineas.find((l) => l.presentacionId === presentacionId)?.piezas ?? null;
}

export function totalPiezas(lineas: readonly LineaCarga[]): number {
  return lineas.reduce((total, l) => total + l.piezas, 0);
}

/** Pendiente o rechazada, y de hoy (D5, D8). El servidor lo vuelve a comprobar (409). */
export function cargaEditable(carga: CargaRejilla, esHoy: boolean): boolean {
  return esHoy && carga.estado !== "aceptada";
}

export type Columna = { tipo: "carga"; carga: CargaRejilla } | { tipo: "nueva" } | { tipo: "vacia" };

/** Las subcolumnas de un vendedor: sus cargas por numero, la nueva al final, o una vacia. */
export function columnasDeVendedor(vendedor: VendedorRejilla, conNueva: boolean): Columna[] {
  const columnas: Columna[] = vendedor.cargas.map((carga) => ({ tipo: "carga", carga }));
  if (conNueva) columnas.push({ tipo: "nueva" });
  return columnas.length > 0 ? columnas : [{ tipo: "vacia" }];
}

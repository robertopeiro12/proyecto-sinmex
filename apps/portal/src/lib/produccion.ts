import { apiFetch } from "./api";

// Copia normativa de `DiaProduccion` en
// apps/backend/src/modules/produccion/produccion.service.ts (T-25). Un cambio de
// forma en un lado exige el equivalente en el otro.

export interface LineaProduccion {
  presentacionId: string;
  producto: string;
  presentacion: string;
  /** `false` = presentación dada de baja que ese día tiene piezas: sale para no esconderlas. */
  activa: boolean;
  /** 0 = sin registro. */
  piezas: number;
}

export interface DiaProduccion {
  fecha: string;
  sucursal: { id: string; codigo: string };
  lineas: LineaProduccion[];
  totalPiezas: number;
  actualizadoEn: string | null;
}

/** El tope que valida el servidor (la columna es `integer`). */
export const MAX_PIEZAS_PRODUCCION = 2_147_483_647;

export function obtenerProduccion(fecha: string, sucursal: string): Promise<DiaProduccion> {
  const params = new URLSearchParams({ fecha, sucursal });
  return apiFetch<DiaProduccion>(`/produccion?${params.toString()}`);
}

/** Reemplaza la producción del día con TODAS las líneas; 0 da de baja la presentación. */
export function guardarProduccion(datos: {
  fecha: string;
  sucursal: string;
  lineas: { presentacionId: string; piezas: number }[];
}): Promise<DiaProduccion> {
  return apiFetch<DiaProduccion>("/produccion", { method: "PUT", body: JSON.stringify(datos) });
}

/**
 * Lo tecleado en una celda → piezas enteras. Vacío = 0 (sin registro); `null` si no es
 * un entero entre 0 y el tope.
 */
export function leerPiezas(texto: string): number | null {
  const t = texto.trim();
  if (t === "") return 0;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= MAX_PIEZAS_PRODUCCION ? n : null;
}

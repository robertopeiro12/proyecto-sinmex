import { apiFetch } from "./api";

// Copia normativa de `DiaRetorno` en
// apps/backend/src/modules/produccion/retornos.service.ts. Un cambio de forma
// en un lado exige el equivalente en el otro.

export interface LineaRetorno {
  presentacionId: string;
  producto: string;
  presentacion: string;
  /** `false` = presentación dada de baja que ese día tiene piezas: sale para no esconderlas. */
  activa: boolean;
  /** Piezas buenas que regresaron. 0 = sin registro. */
  piezas: number;
  /** Lo que el vendedor se llevó ese día en cargas aceptadas (informativo). */
  cargadas: number;
}

export interface DiaRetorno {
  fecha: string;
  vendedor: { id: string; nombre: string };
  sucursal: { id: string; codigo: string };
  lineas: LineaRetorno[];
  totalPiezas: number;
  actualizadoEn: string | null;
}

export function obtenerRetorno(fecha: string, vendedor: string): Promise<DiaRetorno> {
  const params = new URLSearchParams({ fecha, vendedor });
  return apiFetch<DiaRetorno>(`/retornos?${params.toString()}`);
}

/** Reemplaza el retorno del vendedor ese día con TODAS las líneas; 0 da de baja la presentación. */
export function guardarRetorno(datos: {
  fecha: string;
  vendedor: string;
  lineas: { presentacionId: string; piezas: number }[];
}): Promise<DiaRetorno> {
  return apiFetch<DiaRetorno>("/retornos", { method: "PUT", body: JSON.stringify(datos) });
}

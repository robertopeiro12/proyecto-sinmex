import { apiFetch } from "./api";

// Copia de `CampoEgreso` de apps/backend/src/modules/compras-egresos/campos-egreso.repository.ts
// (el portal no puede importar del backend). T-30, D2/D3.

export const PERMISO_CAMPOS_EGRESO = "campo_egreso.gestionar";

/** Los tres tipos fijos del cliente (D1): "ya deben de venir grabados". */
export const TIPOS_EGRESO = ["produccion", "operacion", "financiero"] as const;
export type TipoEgreso = (typeof TIPOS_EGRESO)[number];

export const ETIQUETA_TIPO_EGRESO: Record<TipoEgreso, string> = {
  produccion: "Producción",
  operacion: "Operación",
  financiero: "Financiero",
};

export interface CampoEgreso {
  id: string;
  nombre: string;
  tipo: TipoEgreso;
  /** El vendedor solo ve en la tablet los campos con esta casilla (respuesta 2 de Mario). */
  seUsaEnApp: boolean;
}

export type DatosCampoEgreso = Omit<CampoEgreso, "id">;

/** Solo los vivos: la baja lógica los saca de aquí (y del pull de la tablet). */
export function listarCamposEgreso(): Promise<CampoEgreso[]> {
  return apiFetch<CampoEgreso[]>("/campos-egreso");
}

export function crearCampoEgreso(datos: DatosCampoEgreso): Promise<CampoEgreso> {
  return apiFetch<CampoEgreso>("/campos-egreso", { method: "POST", body: JSON.stringify(datos) });
}

export function editarCampoEgreso(id: string, datos: DatosCampoEgreso): Promise<CampoEgreso> {
  return apiFetch<CampoEgreso>(`/campos-egreso/${id}`, { method: "PATCH", body: JSON.stringify(datos) });
}

/** 409 si el campo tiene gastos vivos en el año en curso (regla del cliente). */
export function eliminarCampoEgreso(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/campos-egreso/${id}`, { method: "DELETE" });
}

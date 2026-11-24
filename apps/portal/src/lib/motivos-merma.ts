import { apiFetch } from "./api";

// Copia de `MotivoMerma` de apps/backend/src/modules/produccion/motivos-merma.repository.ts
// (el portal no puede importar del backend). Registro de Operación, D7.

export const PERMISO_MOTIVOS_MERMA = "motivo_merma.gestionar";

export interface MotivoMerma {
  id: string;
  nombre: string;
  aplicaAlmacen: boolean;
  aplicaCliente: boolean;
  aplicaVehiculo: boolean;
  activo: boolean;
}

export type DatosMotivoMerma = Pick<MotivoMerma, "nombre" | "aplicaAlmacen" | "aplicaCliente" | "aplicaVehiculo">;

/** Solo los vivos. Con `aplica: "almacen"`, los que aplican al almacén (para el Registro de Operación). */
export function listarMotivosMerma(aplica?: "almacen"): Promise<MotivoMerma[]> {
  return apiFetch<MotivoMerma[]>(aplica ? `/motivos-merma?aplica=${aplica}` : "/motivos-merma");
}

export function crearMotivoMerma(datos: DatosMotivoMerma): Promise<MotivoMerma> {
  return apiFetch<MotivoMerma>("/motivos-merma", { method: "POST", body: JSON.stringify(datos) });
}

export function editarMotivoMerma(id: string, datos: Partial<DatosMotivoMerma>): Promise<MotivoMerma> {
  return apiFetch<MotivoMerma>(`/motivos-merma/${id}`, { method: "PATCH", body: JSON.stringify(datos) });
}

export function eliminarMotivoMerma(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/motivos-merma/${id}`, { method: "DELETE" });
}

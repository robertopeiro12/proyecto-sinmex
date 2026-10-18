import { apiFetch } from "./api";

// Copia de `MotivoVisita` de apps/backend/src/modules/rutas/motivos-visita.repository.ts
// (el portal no puede importar del backend). T-39, D5.

export const PERMISO_MOTIVOS_VISITA = "motivo_visita.gestionar";

export interface MotivoVisita {
  id: string;
  nombre: string;
  /** La tablet no deja guardar la visita sin foto. */
  exigeFoto: boolean;
  /** La tablet no deja guardar la visita sin el nombre de quien atendió. */
  exigeAtendio: boolean;
}

export type DatosMotivoVisita = Omit<MotivoVisita, "id">;

/** Solo los vivos: la baja lógica los saca de aquí (y del pull de la tablet). */
export function listarMotivosVisita(): Promise<MotivoVisita[]> {
  return apiFetch<MotivoVisita[]>("/motivos-visita");
}

export function crearMotivoVisita(datos: DatosMotivoVisita): Promise<MotivoVisita> {
  return apiFetch<MotivoVisita>("/motivos-visita", { method: "POST", body: JSON.stringify(datos) });
}

export function editarMotivoVisita(id: string, datos: DatosMotivoVisita): Promise<MotivoVisita> {
  return apiFetch<MotivoVisita>(`/motivos-visita/${id}`, { method: "PATCH", body: JSON.stringify(datos) });
}

export function eliminarMotivoVisita(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/motivos-visita/${id}`, { method: "DELETE" });
}

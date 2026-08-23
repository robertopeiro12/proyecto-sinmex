import { apiFetch } from "./api";

export interface Vehiculo {
  id: string;
  nombre: string;
  kmInicial: number | null;
  sucursalId: string;
  sucursalCodigo: string;
  activo: boolean;
}

/**
 * @param sucursal codigo a filtrar, "todas", o null/undefined para no pedir
 *   nada. Da igual lo que se mande: el backend acota el resultado a lo que el
 *   usuario puede ver.
 */
export function listarVehiculos(
  sucursal?: string | null,
): Promise<Vehiculo[]> {
  const query = sucursal ? `?sucursal=${encodeURIComponent(sucursal)}` : "";
  return apiFetch<Vehiculo[]>(`/vehiculos${query}`);
}

export function crearVehiculo(datos: {
  nombre: string;
  kmInicial: number;
  /** Solo lo manda un usuario General: al resto se le ignora (D3). */
  sucursalId?: string;
}): Promise<Vehiculo> {
  return apiFetch<Vehiculo>("/vehiculos", {
    method: "POST",
    body: JSON.stringify(datos),
  });
}

export function editarVehiculo(
  id: string,
  cambios: { nombre?: string; kmInicial?: number; activo?: boolean },
): Promise<Vehiculo> {
  return apiFetch<Vehiculo>(`/vehiculos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(cambios),
  });
}

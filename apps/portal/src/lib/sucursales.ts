import { apiFetch } from "./api";

export interface Sucursal {
  id: string;
  codigo: string;
  nombre: string;
  activa: boolean;
}

/**
 * @param sucursal codigo a filtrar, "todas", o null/undefined para no pedir
 *   nada. Da igual lo que se mande: el backend acota el resultado a lo que el
 *   usuario puede ver.
 */
export function listarSucursales(sucursal?: string | null): Promise<Sucursal[]> {
  const query = sucursal ? `?sucursal=${encodeURIComponent(sucursal)}` : "";
  return apiFetch<Sucursal[]>(`/sucursales${query}`);
}

export function crearSucursal(datos: {
  codigo: string;
  nombre: string;
}): Promise<Sucursal> {
  return apiFetch<Sucursal>("/sucursales", {
    method: "POST",
    body: JSON.stringify(datos),
  });
}

export function editarSucursal(
  id: string,
  cambios: { nombre?: string; activa?: boolean },
): Promise<Sucursal> {
  return apiFetch<Sucursal>(`/sucursales/${id}`, {
    method: "PATCH",
    body: JSON.stringify(cambios),
  });
}

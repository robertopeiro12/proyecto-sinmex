import { apiFetch } from "./api";

export interface Vendedor {
  id: string;
  nombre: string;
  login: string;
  sucursalId: string;
  sucursalCodigo: string;
  folioSegmento: string | null;
  activo: boolean;
}

/**
 * @param sucursal codigo a filtrar, "todas", o null/undefined para no pedir
 *   nada. Da igual lo que se mande: el backend acota el resultado a lo que el
 *   usuario puede ver.
 */
export function listarVendedores(
  sucursal?: string | null,
): Promise<Vendedor[]> {
  const query = sucursal ? `?sucursal=${encodeURIComponent(sucursal)}` : "";
  return apiFetch<Vendedor[]>(`/vendedores${query}`);
}

export function crearVendedor(datos: {
  nombre: string;
  login: string;
  contrasena: string;
  /** Solo lo manda un usuario General: al resto se le ignora. */
  sucursalId?: string;
}): Promise<Vendedor> {
  return apiFetch<Vendedor>("/vendedores", {
    method: "POST",
    body: JSON.stringify(datos),
  });
}

export function editarVendedor(
  id: string,
  cambios: { nombre?: string; contrasena?: string; activo?: boolean },
): Promise<Vendedor> {
  return apiFetch<Vendedor>(`/vendedores/${id}`, {
    method: "PATCH",
    body: JSON.stringify(cambios),
  });
}

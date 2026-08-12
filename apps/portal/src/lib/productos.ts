import { apiFetch } from "./api";

export interface Presentacion {
  id: string;
  volumen: string;
}

export interface Producto {
  id: string;
  nombre: string;
  activo: boolean;
  presentaciones: Presentacion[];
}

/**
 * Sin parametro de sucursal: el catalogo de sabores es de la empresa, lo que
 * varia por sucursal es el precio (T-18). No es un olvido.
 */
export function listarProductos(): Promise<Producto[]> {
  return apiFetch<Producto[]>("/productos");
}

export function crearProducto(datos: {
  nombre: string;
  presentaciones: { volumen: string }[];
}): Promise<Producto> {
  return apiFetch<Producto>("/productos", {
    method: "POST",
    body: JSON.stringify(datos),
  });
}

/**
 * `presentaciones` es la lista COMPLETA que debe quedar: las que llevan `id`
 * se conservan, las que no lo llevan se dan de alta, y las que no aparecen se
 * dan de baja. El servidor reconcilia (ver el contrato en el spec, D6).
 */
export function editarProducto(
  id: string,
  datos: {
    nombre: string;
    activo?: boolean;
    presentaciones: { id?: string; volumen: string }[];
  },
): Promise<Producto> {
  return apiFetch<Producto>(`/productos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(datos),
  });
}

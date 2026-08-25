import { apiFetch } from "./api";

export interface ListaPrecio {
  id: string;
  nombre: string;
}

export interface Precio {
  presentacionId: string;
  listaPrecioId: string;
  precio: number;
  vigenteDesde: string;
}

export function listarListasPrecio(): Promise<ListaPrecio[]> {
  return apiFetch<ListaPrecio[]>("/listas-precio");
}

/** @param sucursal codigo de la sucursal (nunca vacio: la pantalla no llama esto sin uno). */
export function listarPrecios(sucursal: string): Promise<Precio[]> {
  return apiFetch<Precio[]>(`/precios?sucursal=${encodeURIComponent(sucursal)}`);
}

/**
 * Fecha LOCAL del navegador, NUNCA `toISOString()` (que es UTC). Mismo riesgo
 * de zona horaria que `fecha_operacion` de folios (CLAUDE.md): Tijuana y
 * Mexicali estan detras de UTC, y el backend usa esta fecha tal cual para
 * `vigente_desde` (D3 del spec de T-18).
 */
function hoyLocalIso(): string {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const dia = String(ahora.getDate()).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

export function actualizarPrecio(datos: {
  presentacionId: string;
  listaPrecioId: string;
  sucursalId: string;
  precio: number;
}): Promise<Precio> {
  return apiFetch<Precio>("/precios", {
    method: "PATCH",
    body: JSON.stringify({ ...datos, vigenteDesde: hoyLocalIso() }),
  });
}

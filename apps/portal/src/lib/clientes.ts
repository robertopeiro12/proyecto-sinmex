import { apiFetch } from "./api";

// Copia normativa de las formas que devuelve
// apps/backend/src/modules/cartera-clientes/clientes.repository.ts
// (interfaces `ClienteResumen`, `ClienteDetalle`, `OverridePrecio`,
// `TipoFiltro` de ese archivo).
export type TipoCliente = "cliente" | "prospecto";
export type TipoFiltro = TipoCliente | "todos";
export type Promocion = "ninguna" | "10+1" | "20+1";

export interface ClienteResumen {
  id: string;
  nombre: string;
  telefono: string;
  tipo: TipoCliente;
  tipoNegocio: string | null;
  sucursalCodigo: string;
}

export interface OverridePrecio {
  presentacionId: string;
  precio: number;
  vigenteDesde: string;
}

export interface ClienteDetalle {
  id: string;
  nombre: string;
  domicilio: string;
  telefono: string;
  encargado: string | null;
  factura: boolean;
  tipo: TipoCliente;
  tipoNegocioId: string | null;
  listaPrecioId: string;
  pctComision: number | null;
  promocion: Promocion;
  plazoCreditoDias: number | null;
  lat: number | null;
  lng: number | null;
  comentarios: string | null;
  sucursalId: string;
  sucursalCodigo: string;
  overridesPrecio: OverridePrecio[];
  productosPromocion: string[];
}

export function listarClientes(
  sucursal: string | null,
  tipo: TipoFiltro,
): Promise<ClienteResumen[]> {
  const params = new URLSearchParams();
  if (sucursal) params.set("sucursal", sucursal);
  if (tipo !== "todos") params.set("tipo", tipo);
  const query = params.toString();
  return apiFetch<ClienteResumen[]>(`/clientes${query ? `?${query}` : ""}`);
}

export function obtenerCliente(id: string): Promise<ClienteDetalle> {
  return apiFetch<ClienteDetalle>(`/clientes/${id}`);
}

/**
 * Fecha LOCAL del navegador, NUNCA `toISOString()` (que es UTC) — mismo
 * riesgo de zona horaria que `hoyLocalIso()` de `lib/precios.ts` (T-18) y
 * `fecha_operacion` de folios (CLAUDE.md). Es la SEGUNDA copia de esta
 * función en el portal (la primera es la de precios): se duplica a
 * propósito, no se extrae todavía — mismo criterio que
 * `buscarSucursalUsuario` en el backend antes de su cuarta copia (D9 del
 * plan), aquí apenas la segunda.
 */
function hoyLocalIso(): string {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const dia = String(ahora.getDate()).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

/** Lo que arma el formulario de Cliente (Task 10), antes de decidir alta o edición. */
export interface DatosClienteFormulario {
  nombre: string;
  domicilio: string;
  telefono: string;
  encargado?: string;
  factura: boolean;
  tipoNegocioId?: string;
  listaPrecioId: string;
  pctComision?: number;
  promocion: Promocion;
  productosPromocion: string[];
  plazoCreditoDias?: number;
  lat?: number;
  lng?: number;
  comentarios?: string;
  overridesPrecio: { presentacionId: string; precio: number | null }[];
}

export function crearCliente(
  datos: DatosClienteFormulario & { tipo: TipoCliente; sucursalId?: string },
): Promise<ClienteDetalle> {
  return apiFetch<ClienteDetalle>("/clientes", {
    method: "POST",
    body: JSON.stringify({ ...datos, vigenteDesde: hoyLocalIso() }),
  });
}

export function editarCliente(
  id: string,
  datos: DatosClienteFormulario,
): Promise<ClienteDetalle> {
  return apiFetch<ClienteDetalle>(`/clientes/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ ...datos, vigenteDesde: hoyLocalIso() }),
  });
}

export function eliminarCliente(id: string): Promise<void> {
  return apiFetch<void>(`/clientes/${id}`, { method: "DELETE" });
}

/** Un solo sentido: Prospecto -> Cliente, nunca al reves. */
export function convertirACliente(id: string): Promise<ClienteDetalle> {
  return apiFetch<ClienteDetalle>(`/clientes/${id}/convertir-a-cliente`, {
    method: "POST",
  });
}

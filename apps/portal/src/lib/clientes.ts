import { apiFetch, apiFetchBlob } from "./api";

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
  /**
   * `null` en un prospecto que dio de alta un vendedor desde la app (T-40): el
   * vendedor captura la ubicacion, no la direccion. El formulario lo trata como
   * cadena vacia y lo sigue exigiendo para guardar — eso es exactamente "el
   * administrador agrega lo que falta".
   */
  domicilio: string | null;
  telefono: string;
  encargado: string | null;
  factura: boolean;
  tipo: TipoCliente;
  tipoNegocioId: string | null;
  /** `null` en un prospecto de la app (T-40): el precio lo decide el administrador. */
  listaPrecioId: string | null;
  pctComision: number | null;
  promocion: Promocion;
  plazoCreditoDias: number | null;
  lat: number | null;
  lng: number | null;
  comentarios: string | null;
  sucursalId: string;
  sucursalCodigo: string;
  /**
   * ¿Tiene foto del lugar? (T-40)
   *
   * Es lo que decide si se dibuja la miniatura. Cuando es `false` **no se dibuja
   * nada** — ni marco, ni "sin foto", ni un hueco: la foto es opcional y la
   * mayoría de los prospectos no la tiene, así que un hueco por cada uno sería
   * ruido permanente en la pantalla.
   */
  tieneFoto: boolean;
  /** Cuándo la recibió el servidor, en ISO. `null` si no hay foto. */
  fotoSubidaEn: string | null;
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

/**
 * Los bytes de la foto de un prospecto (T-40).
 *
 * Pasa por `apiFetchBlob` y no por un `<img src>` directo a la API a propósito:
 * un `<img>` no sabe refrescar la sesión, así que pasados los 15 minutos del
 * access token la miniatura saldría rota sin ningún error visible. Quien llama
 * convierte el Blob en una URL de objeto y la revoca al desmontar.
 */
export function descargarFotoCliente(id: string): Promise<Blob> {
  return apiFetchBlob(`/clientes/${id}/foto`);
}

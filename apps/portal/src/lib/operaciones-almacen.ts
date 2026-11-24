import { apiFetch, apiFetchSinCuerpo } from "./api";

// Copia de los tipos de apps/backend/src/modules/produccion/operaciones-almacen.service.ts,
// reglas-operacion.ts y dto/operacion-almacen.dto.ts (el portal no puede importar del
// backend). Un cambio de forma en un lado exige el equivalente en el otro.
// Registro de Operación, parte 1.

export type TipoOperacion = "entrada" | "envio" | "merma" | "consumo" | "descuento" | "retiro_merma";
export type EstadoRetiro = "pendiente" | "autorizado" | "rechazado";
export type OrigenEntrada = "produccion" | "compra";

export const MAX_LINEAS = 200;
export const MAX_PIEZAS = 100_000;
export const MAX_TRABAJADOR = 120;
export const MAX_COMENTARIO = 300;

export interface TipoOperacionInfo {
  tipo: TipoOperacion;
  etiqueta: string;
  /** Permiso que exige el servidor para listar, crear, corregir y dar de baja ese tipo. */
  permiso: string;
}

export const TIPOS_OPERACION: TipoOperacionInfo[] = [
  { tipo: "entrada", etiqueta: "Entradas/Compras", permiso: "operacion.entrada" },
  { tipo: "envio", etiqueta: "Envíos", permiso: "operacion.envio" },
  { tipo: "merma", etiqueta: "Merma", permiso: "operacion.merma" },
  { tipo: "consumo", etiqueta: "Consumo", permiso: "operacion.consumo" },
  { tipo: "descuento", etiqueta: "Descuentos", permiso: "operacion.descuento" },
  { tipo: "retiro_merma", etiqueta: "Retiro de merma", permiso: "operacion.retiro_merma" },
];

export function infoDeTipo(tipo: TipoOperacion): TipoOperacionInfo {
  return TIPOS_OPERACION.find((t) => t.tipo === tipo)!;
}

/** Una operación tal como la recibe el portal. */
export interface OperacionAlmacen {
  id: string;
  tipo: TipoOperacion;
  sucursal: { id: string; codigo: string };
  fecha: string;
  origen: OrigenEntrada | null;
  destino: { id: string; codigo: string } | null;
  motivo: { id: string; nombre: string } | null;
  trabajador: string | null;
  comentario: string | null;
  lineas: {
    presentacionId: string;
    nombre: string;
    producto: string;
    volumen: string;
    piezas: number;
  }[];
  piezas: number;
  capturo: string;
  /** `HH:MM` de Tijuana de la captura. */
  hora: string;
  /** Se puede corregir o dar de baja (fecha dentro de su regla y no es un envío visto desde el destino). */
  editable: boolean;
  /** Un envío visto en Entradas del destino: solo lectura ahí (no pidas su detalle por id: da 404). */
  envio: { origen: { id: string; codigo: string } } | null;
  /** Solo `retiro_merma`: pendiente, autorizado o rechazado (null en los demás tipos). */
  estado: EstadoRetiro | null;
  /** Quién autorizó o rechazó un retiro y cuándo (`en` ya viene en hora de Tijuana, `AAAA-MM-DD HH:MM`). */
  resolucion: { por: string; en: string; motivo: string | null } | null;
}

/** `GET /operaciones-almacen`. */
export interface OperacionesDelDia {
  fecha: string;
  hoy: string;
  operaciones: OperacionAlmacen[];
}

export interface LineaOperacion {
  presentacionId: string;
  piezas: number;
}

/** `PUT /operaciones-almacen/:id`: reemplaza los datos y las líneas. */
export interface DatosEditarOperacion {
  fecha: string;
  origen?: OrigenEntrada;
  /** Código de la sucursal de destino (solo en un envío). */
  destino?: string;
  motivoId?: string;
  trabajador?: string | null;
  comentario?: string | null;
  lineas: LineaOperacion[];
}

/** `POST /operaciones-almacen`. */
export interface DatosCrearOperacion extends DatosEditarOperacion {
  tipo: TipoOperacion;
  /** Código de la sucursal donde se registra (la que manda, en un envío). */
  sucursal: string;
}

export function listarOperaciones(params: {
  fecha: string;
  tipo: TipoOperacion;
  sucursal?: string;
}): Promise<OperacionesDelDia> {
  const q = new URLSearchParams({ fecha: params.fecha, tipo: params.tipo });
  if (params.sucursal) q.set("sucursal", params.sucursal);
  return apiFetch<OperacionesDelDia>(`/operaciones-almacen?${q.toString()}`);
}

export function crearOperacion(datos: DatosCrearOperacion): Promise<OperacionAlmacen> {
  return apiFetch<OperacionAlmacen>("/operaciones-almacen", { method: "POST", body: JSON.stringify(datos) });
}

export function editarOperacion(id: string, datos: DatosEditarOperacion): Promise<OperacionAlmacen> {
  return apiFetch<OperacionAlmacen>(`/operaciones-almacen/${id}`, { method: "PUT", body: JSON.stringify(datos) });
}

/** El servidor contesta 204. */
export function eliminarOperacion(id: string): Promise<void> {
  return apiFetchSinCuerpo(`/operaciones-almacen/${id}`, { method: "DELETE" });
}

/** `GET /operaciones-almacen/retiros-pendientes`: la bandeja de Peticiones (`peticiones.gestionar`). */
export function listarRetirosPendientes(sucursal: string | null): Promise<{ retiros: OperacionAlmacen[] }> {
  const q = new URLSearchParams();
  if (sucursal) q.set("sucursal", sucursal);
  const texto = q.toString();
  return apiFetch<{ retiros: OperacionAlmacen[] }>(`/operaciones-almacen/retiros-pendientes${texto ? `?${texto}` : ""}`);
}

export function autorizarRetiro(id: string): Promise<OperacionAlmacen> {
  return apiFetch<OperacionAlmacen>(`/operaciones-almacen/${encodeURIComponent(id)}/autorizar`, { method: "POST" });
}

export function rechazarRetiro(id: string, motivo: string): Promise<OperacionAlmacen> {
  return apiFetch<OperacionAlmacen>(`/operaciones-almacen/${encodeURIComponent(id)}/rechazar`, {
    method: "POST",
    body: JSON.stringify({ motivo }),
  });
}

export const MAX_MOTIVO_RECHAZO = 300;

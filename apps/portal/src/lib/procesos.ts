import { apiFetch, apiFetchSinCuerpo } from "./api";

// Copia de los tipos de apps/backend/src/modules/inventario/procesos.service.ts,
// reglas-procesos.ts y dto/proceso.dto.ts (el portal no puede importar del backend).
// Un cambio de forma en un lado exige el equivalente en el otro, en el mismo commit.
// Operación → Procesos (PR A).

export type TipoProceso = "merma" | "cambio" | "consumo" | "promocion" | "descuento";
export type MermaDe = "cliente" | "almacen";
export type SentidoProceso = "recibido" | "entregado";

export const MAX_LINEAS_PROCESO = 200;
export const MAX_PIEZAS_PROCESO = 100_000;
export const MAX_COMENTARIO_PROCESO = 300;

export interface TipoProcesoInfo {
  tipo: TipoProceso;
  /** Texto de la pestaña. */
  etiqueta: string;
  /** Para el título de la lista: "Mermas de hoy de este cliente". */
  plural: string;
  /** Texto del botón de guardar uno nuevo. */
  guardar: string;
  /** Permiso que exige el servidor para listar, crear, corregir y dar de baja ese tipo. */
  permiso: string;
}

export const TIPOS_PROCESO: TipoProcesoInfo[] = [
  { tipo: "merma", etiqueta: "Merma", plural: "Mermas", guardar: "Guardar merma", permiso: "proceso.merma" },
  { tipo: "cambio", etiqueta: "Cambios", plural: "Cambios", guardar: "Guardar cambio", permiso: "proceso.cambio" },
  { tipo: "consumo", etiqueta: "Consumos", plural: "Consumos", guardar: "Guardar consumo", permiso: "proceso.consumo" },
  { tipo: "promocion", etiqueta: "Promoción", plural: "Promociones", guardar: "Guardar promoción", permiso: "proceso.promocion" },
  { tipo: "descuento", etiqueta: "Descuentos", plural: "Descuentos", guardar: "Guardar descuento", permiso: "proceso.descuento" },
];

export function infoDeProceso(tipo: TipoProceso): TipoProcesoInfo {
  return TIPOS_PROCESO.find((t) => t.tipo === tipo)!;
}

/** Merma de cliente, Cambios y Promoción son de un cliente; el resto no lleva cliente. */
export function llevaCliente(tipo: TipoProceso, mermaDe: MermaDe | null): boolean {
  if (tipo === "merma") return mermaDe === "cliente";
  return tipo === "cambio" || tipo === "promocion";
}

/** Merma de cliente y Cambios llevan recibido y entregado, y tienen que cuadrar. */
export function llevaDosCajas(tipo: TipoProceso, mermaDe: MermaDe | null): boolean {
  return (tipo === "merma" && mermaDe === "cliente") || tipo === "cambio";
}

export interface LineaProceso {
  presentacionId: string;
  /** "Horchata 500 ml" */
  nombre: string;
  sentido: SentidoProceso;
  piezas: number;
}

/** Un proceso tal como lo recibe el portal. */
export interface Proceso {
  id: string;
  tipo: TipoProceso;
  /** AAAA-MM-DD */
  fecha: string;
  /** HH:MM de Tijuana de la captura. */
  hora: string;
  mermaDe: MermaDe | null;
  cliente: { id: string; nombre: string } | null;
  /** null = Oficina. */
  vendedor: { id: string; nombre: string } | null;
  comentario: string | null;
  /** Nombre del usuario que lo creó. */
  capturo: string;
  /** Recibido primero, luego por producto y volumen. */
  lineas: LineaProceso[];
  /** `updated_at` ISO UTC con microsegundos. */
  actualizadoEn: string;
}

/** `GET /procesos`. Orden por captura. */
export interface ProcesosDelDia {
  fecha: string;
  hoy: string;
  procesos: Proceso[];
}

/** `GET /procesos/descuentos/precarga`: solo faltantes > 0 del corte; sin corte, `[]`. */
export interface PrecargaDescuentos {
  corteHecho: boolean;
  lineas: { presentacionId: string; nombre: string; piezas: number }[];
}

/** `GET /procesos/cliente/:id`: lo que pinta la tarjeta del cliente. */
export interface ResumenCliente {
  id: string;
  nombre: string;
  tipo: "cliente" | "prospecto";
  tipoNegocio: string | null;
  diasCredito: number | null;
  deudaCentavos: number;
  notasConSaldo: number;
  /** AAAA-MM-DD o null. */
  ultimaCompra: string | null;
  promociones: string[];
}

export interface LineaDatosProceso {
  presentacionId: string;
  sentido: SentidoProceso;
  piezas: number;
}

/** `PATCH /procesos/:id`: reemplaza los datos y todas las líneas. */
export interface DatosProceso {
  fecha: string;
  clienteId: string | null;
  /** null = Oficina (no se permite en un descuento). */
  vendedorId: string | null;
  /** Solo en merma; null en los demás. */
  mermaDe: MermaDe | null;
  comentario: string | null;
  lineas: LineaDatosProceso[];
}

/** `POST /procesos`. */
export interface DatosCrearProceso extends DatosProceso {
  tipo: TipoProceso;
  /** Código de la sucursal. */
  sucursal: string;
}

export function listarProcesos(params: {
  tipo: TipoProceso;
  fecha: string;
  sucursal: string;
  cliente?: string;
}): Promise<ProcesosDelDia> {
  const q = new URLSearchParams({ tipo: params.tipo, fecha: params.fecha, sucursal: params.sucursal });
  if (params.cliente) q.set("cliente", params.cliente);
  return apiFetch<ProcesosDelDia>(`/procesos?${q.toString()}`);
}

export function crearProceso(datos: DatosCrearProceso): Promise<Proceso> {
  return apiFetch<Proceso>("/procesos", { method: "POST", body: JSON.stringify(datos) });
}

export function editarProceso(id: string, datos: DatosProceso): Promise<Proceso> {
  return apiFetch<Proceso>(`/procesos/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(datos) });
}

/** El servidor contesta 204. */
export function eliminarProceso(id: string): Promise<void> {
  return apiFetchSinCuerpo(`/procesos/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function precargaDescuentos(vendedor: string, fecha: string): Promise<PrecargaDescuentos> {
  const q = new URLSearchParams({ vendedor, fecha });
  return apiFetch<PrecargaDescuentos>(`/procesos/descuentos/precarga?${q.toString()}`);
}

export function resumenCliente(id: string): Promise<ResumenCliente> {
  return apiFetch<ResumenCliente>(`/procesos/cliente/${encodeURIComponent(id)}`);
}

/**
 * La barra de cuadre de Merma de cliente y Cambios (R4): el total entregado tiene que ser
 * igual al total recibido, de cualquier producto y tamaño. El servidor aplica la misma regla.
 */
export function cuadre(lineas: readonly { sentido: SentidoProceso; piezas: number }[]): {
  recibido: number;
  entregado: number;
  cuadra: boolean;
  texto: string;
} {
  let recibido = 0;
  let entregado = 0;
  for (const l of lineas) {
    if (l.sentido === "recibido") recibido += l.piezas;
    else entregado += l.piezas;
  }
  if (recibido === entregado) {
    return { recibido, entregado, cuadra: true, texto: `✓ Cuadra: recibió ${recibido} y se le entregaron ${entregado}.` };
  }
  const diferencia = Math.abs(recibido - entregado);
  const cola = entregado < recibido ? `faltan ${diferencia}` : `sobran ${diferencia}`;
  return { recibido, entregado, cuadra: false, texto: `Recibió ${recibido} y llevas ${entregado} entregadas — ${cola}.` };
}

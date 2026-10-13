import { ErrorApi, apiFetch } from "./api";
import { ETIQUETA_METODO_PAGO } from "./cobranzas";
import { formatearPesos } from "./ventas";

// Copia normativa de las formas de apps/backend/src/modules/ventas-cobranza/reglas-borrado-cobro.ts
// (`NotaTrasBorrar`, `BloqueoBorrado`), cobros-borrado.service.ts (`CobroEnVista`, `VistaBorrado`) y
// peticiones.repository.ts (`CobroDePeticion`, `PeticionEnBandeja`). Mismo trato que lib/cobranzas.ts:
// un cambio de forma en un lado exige el equivalente en el otro.

export type StatusPeticion = "pendiente" | "autorizada" | "denegada";

/** Cómo quedaría una nota del pago si se borra. */
export interface NotaTrasBorrar {
  notaId: string;
  folio: string;
  numNota: string | null;
  fecha: string;
  delPagoCentavos: number;
  saldoAntesCentavos: number;
  saldoDespuesCentavos: number;
  statusDespues: "pendiente" | "abonado" | "pagada" | "cuenta_perdida";
}

export interface BloqueoBorrado {
  codigo: "saldo-favor-aplicado";
  motivo: string;
}

export interface CobroEnVista {
  id: string;
  clienteId: string;
  cliente: string;
  sucursalCodigo: string;
  origen: "cobro" | "saldo_favor";
  metodoPago: string;
  montoCentavos: number;
  fechaPago: string;
  fechaOperacion: string;
  /** `null` = Oficina (o saldo a favor). */
  cobrador: string | null;
}

/** La calcula el servidor con las notas bloqueadas: aquí no se decide nada. */
export interface VistaBorrado {
  cobro: CobroEnVista;
  notas: NotaTrasBorrar[];
  saldoFavorAntesCentavos: number;
  saldoFavorDespuesCentavos: number;
  /** + excedente, - aplicación, 0 si el pago no movió saldo a favor. */
  movimientoSaldoFavorCentavos: number;
  bloqueo: BloqueoBorrado | null;
}

export interface CobroDePeticion {
  id: string;
  clienteId: string;
  cliente: string;
  montoCentavos: number;
  metodoPago: string;
  origen: "cobro" | "saldo_favor";
  fechaPago: string;
  cobrador: string | null;
  folios: string[];
}

export interface PeticionEnBandeja {
  id: string;
  tipo: "eliminar_cobro";
  status: StatusPeticion;
  sucursalCodigo: string;
  motivo: string;
  solicito: string;
  /** `AAAA-MM-DD HH:MM`, hora de Tijuana. */
  creadaEn: string;
  resolvio: string | null;
  resueltaEn: string | null;
  comentario: string | null;
  cobro: CobroDePeticion;
}

export const ETIQUETA_STATUS_PETICION: Record<StatusPeticion, string> = {
  pendiente: "Pendiente",
  autorizada: "Autorizada",
  denegada: "Denegada",
};

export const ETIQUETA_BORRADO_PEDIDO = "Borrado pedido · pendiente";

/** Motivo y comentario: el servidor rechaza más (`ck_peticion_motivo`). */
export const LARGO_MAX_TEXTO = 500;

/** El 409 de "ya se pidió", "ya se borró" o "ya se resolvió": lo que se ve en pantalla quedó viejo. */
export function esConflicto409(err: unknown): err is ErrorApi {
  return err instanceof ErrorApi && err.status === 409;
}

export function vistaBorradoDeCobro(cobroId: string): Promise<VistaBorrado> {
  return apiFetch<VistaBorrado>(`/cobros/${encodeURIComponent(cobroId)}/vista-borrado`);
}

export function vistaPreviaDePeticion(id: string): Promise<VistaBorrado> {
  return apiFetch<VistaBorrado>(`/peticiones/${encodeURIComponent(id)}/vista-previa`);
}

export function pedirBorrarCobro(cobroId: string, motivo: string): Promise<PeticionEnBandeja> {
  return apiFetch<PeticionEnBandeja>("/peticiones/eliminar-cobro", {
    method: "POST",
    body: JSON.stringify({ cobroId, motivo }),
  });
}

export function listarPeticiones(
  status: "pendiente" | "historial",
  sucursal: string | null,
): Promise<PeticionEnBandeja[]> {
  const params = new URLSearchParams({ status });
  if (sucursal) params.set("sucursal", sucursal);
  return apiFetch<PeticionEnBandeja[]>(`/peticiones?${params.toString()}`);
}

export function autorizarPeticion(id: string): Promise<PeticionEnBandeja> {
  return apiFetch<PeticionEnBandeja>(`/peticiones/${encodeURIComponent(id)}/autorizar`, { method: "POST" });
}

/** El comentario es opcional: vacío no viaja. */
export function denegarPeticion(id: string, comentario: string): Promise<PeticionEnBandeja> {
  const limpio = comentario.trim();
  return apiFetch<PeticionEnBandeja>(`/peticiones/${encodeURIComponent(id)}/denegar`, {
    method: "POST",
    body: JSON.stringify(limpio ? { comentario: limpio } : {}),
  });
}

/** "Pago de $1,000.00 · Tacos Erick · 2026-10-10 · Efectivo · cobró Juan Pérez" (§3.1). */
export function describirPago(c: {
  cliente: string;
  montoCentavos: number;
  metodoPago: string;
  origen: "cobro" | "saldo_favor";
  fechaPago: string;
  cobrador: string | null;
}): string {
  if (c.origen === "saldo_favor")
    return `Saldo a favor aplicado de ${formatearPesos(c.montoCentavos)} · ${c.cliente} · ${c.fechaPago}`;
  const metodo = ETIQUETA_METODO_PAGO[c.metodoPago] ?? c.metodoPago;
  const quien = c.cobrador ? `cobró ${c.cobrador}` : "Oficina";
  return `Pago de ${formatearPesos(c.montoCentavos)} · ${c.cliente} · ${c.fechaPago} · ${metodo} · ${quien}`;
}

export function textoPeticionEnviada(p: PeticionEnBandeja): string {
  return `Petición enviada: borrar el pago de ${formatearPesos(p.cobro.montoCentavos)} de ${p.cobro.cliente}.`;
}

export function textoAutorizada(p: PeticionEnBandeja): string {
  return `Petición autorizada: se borró el pago de ${formatearPesos(p.cobro.montoCentavos)} de ${p.cobro.cliente}.`;
}

export function textoDenegada(p: PeticionEnBandeja): string {
  return `Petición denegada: el pago de ${p.cobro.cliente} no cambia.`;
}

import { apiFetch, apiFetchSinCuerpo } from "./api";

// Copia normativa de las formas de
// apps/backend/src/modules/rutas/rutas-semanales.service.ts (`RutaSemanalResumen`,
// `ClienteDeRutaSemanal`, `RutaSemanalDetalle`). Mismo trato que lib/rutas.ts: un cambio de
// forma en un lado exige el equivalente en el otro.

/** `diaSemana`: 1 = lunes … 6 = sábado (sin domingo). */
export interface RutaSemanalResumen {
  id: string;
  diaSemana: number;
  nombre: string;
  clientes: number;
  sucursalCodigo: string;
}

/** `valido = false`: dado de baja, vuelto prospecto o de otra sucursal. */
export interface ClienteDeRutaSemanal {
  clienteId: string;
  nombre: string;
  valido: boolean;
}

export interface RutaSemanalDetalle extends RutaSemanalResumen {
  lista: ClienteDeRutaSemanal[];
}

export function listarRutasSemanales(sucursal: string | null): Promise<RutaSemanalResumen[]> {
  return apiFetch<RutaSemanalResumen[]>(`/rutas/semanales${sucursal ? `?${new URLSearchParams({ sucursal })}` : ""}`);
}

export function crearRutaSemanal(datos: {
  sucursal: string;
  diaSemana: number;
  nombre: string;
}): Promise<RutaSemanalDetalle> {
  return apiFetch<RutaSemanalDetalle>("/rutas/semanales", { method: "POST", body: JSON.stringify(datos) });
}

export function obtenerRutaSemanal(id: string): Promise<RutaSemanalDetalle> {
  return apiFetch<RutaSemanalDetalle>(`/rutas/semanales/${id}`);
}

export function renombrarRutaSemanal(id: string, nombre: string): Promise<RutaSemanalDetalle> {
  return apiFetch<RutaSemanalDetalle>(`/rutas/semanales/${id}`, { method: "PATCH", body: JSON.stringify({ nombre }) });
}

/** Reemplazo: la lista COMPLETA y en orden. */
export function guardarClientesRutaSemanal(id: string, clientes: string[]): Promise<RutaSemanalDetalle> {
  return apiFetch<RutaSemanalDetalle>(`/rutas/semanales/${id}/clientes`, {
    method: "PUT",
    body: JSON.stringify({ clientes }),
  });
}

export function eliminarRutaSemanal(id: string): Promise<void> {
  return apiFetchSinCuerpo(`/rutas/semanales/${id}`, { method: "DELETE" });
}

export function rutasDelDia(rutas: RutaSemanalResumen[], diaSemana: number): RutaSemanalResumen[] {
  return rutas.filter((r) => r.diaSemana === diaSemana);
}

/** El día de la semana (1 = lunes … 6 = sábado) de una fecha `AAAA-MM-DD`; el domingo cuenta como lunes. */
export function diaDeHoy(hoy: string): number {
  const dia = new Date(`${hoy}T12:00:00Z`).getUTCDay();
  return dia === 0 ? 1 : dia;
}

import { apiFetch } from "./api";

// Copia normativa de las formas de
// apps/backend/src/modules/ventas-cobranza/ventas-portal.service.ts
// (`PresentacionDeCatalogo`, `VentaRegistradaPortal`), ventas-portal.repository.ts
// (`Repartidor`) y del cuerpo de dto/registrar-venta.dto.ts. Mismo trato que
// lib/precios.ts: no hay tipo compartido; un cambio de forma en un lado exige el
// equivalente en el otro.

/** Una presentación del cliente con su precio a la fecha; `null` = "sin precio en la lista". */
export interface PresentacionDeCatalogo {
  presentacionId: string;
  producto: string;
  volumen: string;
  precioCentavos: number | null;
}

export interface Repartidor {
  id: string;
  nombre: string;
}

export type ContadoCredito = "contado" | "credito";
export type MetodoPagoContado = "transferencia" | "efectivo";
export type FacturaVenta = "N/A" | "pendiente";

/** El cuerpo de `POST /ventas`. **Sin precios**: los pone el servidor. */
export interface NuevaVenta {
  fecha: string;
  clienteId: string;
  /** `null` = Oficina (venta de mostrador). */
  vendedorId: string | null;
  numNota: string;
  contadoCredito: ContadoCredito;
  /** Solo en contado. */
  metodoPago?: MetodoPagoContado;
  factura: FacturaVenta;
  comentarios?: string;
  lineas: { presentacionId: string; cantidad: number; cantidadPromocion: number }[];
}

export interface VentaRegistrada {
  id: string;
  folio: string;
  montoCentavos: number;
  status: "pagada" | "pendiente" | "promocion";
}

export function obtenerCatalogoVenta(
  clienteId: string,
  fecha: string,
): Promise<PresentacionDeCatalogo[]> {
  const params = new URLSearchParams({ clienteId, fecha });
  return apiFetch<PresentacionDeCatalogo[]>(`/ventas/catalogo?${params.toString()}`);
}

export function listarRepartidores(sucursalId: string): Promise<Repartidor[]> {
  return apiFetch<Repartidor[]>(
    `/ventas/repartidores?sucursalId=${encodeURIComponent(sucursalId)}`,
  );
}

export function registrarVenta(venta: NuevaVenta): Promise<VentaRegistrada> {
  return apiFetch<VentaRegistrada>("/ventas", {
    method: "POST",
    body: JSON.stringify(venta),
  });
}

/**
 * Hoy en Tijuana, `AAAA-MM-DD`. NUNCA `toISOString()` (UTC: a las 17:00 de
 * Tijuana ya es mañana) ni la fecha local del navegador (el equipo desarrolla
 * en Europe/Madrid). Es la misma regla que `hoyEnTijuana()` del backend, que es
 * quien decide si la fecha es futura.
 */
export function hoyEnTijuana(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Tijuana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

/** Piezas tecleadas: vacío es 0; un entero de 0 en adelante; cualquier otra cosa, `null`. */
export function leerPiezas(texto: string): number | null {
  const limpio = texto.trim();
  if (limpio === "") return 0;
  return /^\d+$/.test(limpio) ? Number(limpio) : null;
}

/** Centavos a `$1,234.56`. */
export function formatearPesos(centavos: number): string {
  return `$${(centavos / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

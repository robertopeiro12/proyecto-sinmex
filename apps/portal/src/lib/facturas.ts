import { apiFetch } from "./api";
import type { StatusVenta } from "./ventas";

// Copia normativa de las formas de
// apps/backend/src/modules/ventas-cobranza/facturas.repository.ts
// (`VentaDeFactura`, `VentaPorFacturar`, `FacturaConVentas`) y de
// dto/facturas.dto.ts. Mismo trato que lib/ventas.ts: un cambio de forma en un
// lado exige el equivalente en el otro.

export interface VentaDeFactura {
  id: string;
  folio: string;
  fecha: string;
  numNota: string | null;
  montoCentavos: number;
  status: StatusVenta;
}

export interface VentaPorFacturar extends VentaDeFactura {
  factura: "N/A" | "pendiente";
}

export interface FacturaConVentas {
  id: string;
  numero: string;
  clienteId: string;
  cliente: string;
  sucursalCodigo: string;
  creadoPor: string;
  creadoEn: string;
  totalCentavos: number;
  ventas: VentaDeFactura[];
}

export const LARGO_MAX_NUMERO_FACTURA = 30;

export function listarPorFacturar(clienteId: string, incluirNA: boolean): Promise<VentaPorFacturar[]> {
  const params = new URLSearchParams({ clienteId });
  if (incluirNA) params.set("incluirNA", "true");
  return apiFetch<VentaPorFacturar[]>(`/facturas/por-facturar?${params.toString()}`);
}

export function asignarFactura(
  clienteId: string,
  numero: string,
  ventaIds: string[],
): Promise<FacturaConVentas> {
  return apiFetch<FacturaConVentas>("/facturas/asignar", {
    method: "POST",
    body: JSON.stringify({ clienteId, numero, ventaIds }),
  });
}

export function buscarFacturas(filtro: {
  numero?: string;
  clienteId?: string;
  sucursal: string | null;
}): Promise<FacturaConVentas[]> {
  const params = new URLSearchParams();
  const numero = filtro.numero?.trim();
  if (numero) params.set("numero", numero);
  if (filtro.clienteId) params.set("clienteId", filtro.clienteId);
  if (filtro.sucursal) params.set("sucursal", filtro.sucursal);
  return apiFetch<FacturaConVentas[]>(`/facturas?${params.toString()}`);
}

export function renombrarFactura(id: string, numero: string): Promise<FacturaConVentas> {
  return apiFetch<FacturaConVentas>(`/facturas/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ numero }),
  });
}

export function quitarDeFactura(
  id: string,
  ventaIds: string[],
): Promise<{ factura: FacturaConVentas | null }> {
  return apiFetch<{ factura: FacturaConVentas | null }>(`/facturas/${encodeURIComponent(id)}/quitar`, {
    method: "POST",
    body: JSON.stringify({ ventaIds }),
  });
}

export function totalSeleccionado(ventas: VentaDeFactura[], seleccion: ReadonlySet<string>): number {
  return ventas.reduce((t, v) => (seleccion.has(v.id) ? t + v.montoCentavos : t), 0);
}

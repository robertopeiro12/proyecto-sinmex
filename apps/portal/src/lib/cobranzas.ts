import { apiFetch } from "./api";
import { formatearPesos } from "./ventas";

// Copia normativa de las formas de
// apps/backend/src/modules/ventas-cobranza/cobranzas-portal.repository.ts (`AbonoAnterior`,
// `NotaPorCobrar`), cobranzas-portal.service.ts (`ClientePorCobrar`, `CobroRegistrado`),
// cobranzas.service.ts (`AplicacionDeCobro`, `PlanDeCobro`) y dto/cobranzas.dto.ts. Mismo trato
// que lib/facturas.ts: un cambio de forma en un lado exige el equivalente en el otro.

export type MetodoPagoCobro = "transferencia" | "efectivo" | "cheque";
export type OrigenAbono = "cobro" | "venta_contado" | "saldo_favor";
export type ModoCobro = "pago" | "saldo_favor";

export interface AbonoAnterior {
  fechaPago: string;
  montoCentavos: number;
  metodoPago: string;
  origen: OrigenAbono;
}

/** Una nota por cobrar (`pendiente`/`abonado`, viva), de la más vieja a la más nueva. */
export interface NotaPorCobrar {
  id: string;
  folio: string;
  /** `null` = sin nota de papel. */
  numNota: string | null;
  fecha: string;
  clienteId: string;
  cliente: string;
  sucursalCodigo: string;
  montoCentavos: number;
  saldoCentavos: number;
  status: "pendiente" | "abonado";
  abonos: AbonoAnterior[];
}

export interface ClientePorCobrar {
  id: string;
  nombre: string;
  sucursalId: string;
  sucursalCodigo: string;
  saldoFavorCentavos: number;
  notas: NotaPorCobrar[];
}

export interface AplicacionDeCobro {
  notaId: string;
  folio: string;
  numNota: string | null;
  fecha: string;
  montoCentavos: number;
  saldoAntesCentavos: number;
  saldoDespuesCentavos: number;
  status: "pagada" | "abonado";
  /** `true` si la oficina la marcó; `false` si le tocó del excedente. */
  palomeada: boolean;
}

/** Lo calcula el servidor con la misma regla que la tablet: aquí no se reparte nada. */
export interface PlanDeCobro {
  aplicaciones: AplicacionDeCobro[];
  saldoFavorCentavos: number;
}

export interface CobroRegistrado extends PlanDeCobro {
  cliente: string;
  montoCentavos: number;
}

/** El cuerpo de `POST /cobranzas`. `vendedorId: null` = Oficina. */
export interface NuevoCobro {
  clienteId: string;
  notaIds: string[];
  montoCentavos: number;
  fechaPago: string;
  metodoPago: MetodoPagoCobro;
  vendedorId: string | null;
}

/** Transferencia primero: es el default de la oficina (§3.3). */
export const METODOS_PAGO_COBRO: { valor: MetodoPagoCobro; texto: string }[] = [
  { valor: "transferencia", texto: "Transferencia" },
  { valor: "efectivo", texto: "Efectivo" },
  { valor: "cheque", texto: "Cheque" },
];

/** Cómo se nombra el método de un abono. `saldo_favor` no es dinero nuevo (T-21). */
export const ETIQUETA_METODO_PAGO: Record<string, string> = {
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  cheque: "Cheque",
  saldo_favor: "Saldo a favor",
};

export const MENSAJE_MONTO = "El monto debe ser mayor a $0 y tener a lo más 2 decimales.";

export function porCobrarDeCliente(clienteId: string): Promise<ClientePorCobrar> {
  return apiFetch<ClientePorCobrar>(`/cobranzas/por-cobrar?clienteId=${encodeURIComponent(clienteId)}`);
}

export function buscarPorCobrar(
  filtro: { fecha: string } | { numNota: string },
  sucursal: string | null,
): Promise<NotaPorCobrar[]> {
  const params = new URLSearchParams();
  if ("fecha" in filtro) params.set("fecha", filtro.fecha);
  else params.set("numNota", filtro.numNota.trim());
  if (sucursal) params.set("sucursal", sucursal);
  return apiFetch<NotaPorCobrar[]>(`/cobranzas/por-cobrar?${params.toString()}`);
}

export function vistaPreviaCobro(cuerpo: {
  clienteId: string;
  notaIds: string[];
  montoCentavos: number;
  modo: ModoCobro;
}): Promise<PlanDeCobro> {
  return apiFetch<PlanDeCobro>("/cobranzas/vista-previa", {
    method: "POST",
    body: JSON.stringify(cuerpo),
  });
}

export function registrarCobro(cobro: NuevoCobro): Promise<CobroRegistrado> {
  return apiFetch<CobroRegistrado>("/cobranzas", { method: "POST", body: JSON.stringify(cobro) });
}

export function aplicarSaldoFavor(cuerpo: {
  clienteId: string;
  notaIds: string[];
  montoCentavos: number;
}): Promise<CobroRegistrado> {
  return apiFetch<CobroRegistrado>("/cobranzas/saldo-favor", {
    method: "POST",
    body: JSON.stringify(cuerpo),
  });
}

/**
 * Lo tecleado a centavos **sin punto flotante** (`19.99 * 100` da
 * `1998.9999999999998`): se parte el texto en enteros y decimales. Acepta `$`
 * al inicio y comas de miles bien puestas (`1,500.50`); a lo más 2 decimales.
 * `null` si no se entiende o si no es mayor a 0.
 */
export function leerMontoCentavos(texto: string): number | null {
  const limpio = texto.trim().replace(/^\$/, "").trim();
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(limpio)) return null;
  const [enteros, decimales = ""] = limpio.replace(/,/g, "").split(".");
  const centavos = Number(enteros) * 100 + Number(decimales.padEnd(2, "0"));
  return Number.isSafeInteger(centavos) && centavos > 0 ? centavos : null;
}

/** Centavos al texto del campo (`"1500.50"`), sin coma flotante. */
export function textoMonto(centavos: number): string {
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;
}

/** "TJ… pagada" o "TJ… abono $200.00, debe $500.00" (§3.3). */
export function describirAplicacion(a: AplicacionDeCobro): string {
  return a.saldoDespuesCentavos === 0
    ? `${a.folio} pagada`
    : `${a.folio} abono ${formatearPesos(a.montoCentavos)}, debe ${formatearPesos(a.saldoDespuesCentavos)}`;
}

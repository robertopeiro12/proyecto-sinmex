import { apiFetch, apiFetchSinCuerpo } from "./api";
import { formatearPesos, plural } from "./formato";

/*
 * Flujo diario y Dashboard. Los tipos de respuesta son COPIA de los del backend
 * (apps/backend/src/modules/estadisticas/reglas-flujo-diario.ts y
 * reglas-detalle.ts; el portal no puede importar del backend): si cambian
 * allá, cambian aquí en el mismo commit. Dinero en centavos enteros.
 */

export interface FilaVendedorDia {
  /** `AAAA-MM-DD`. */
  fecha: string;
  vendedorId: string;
  vendedor: string;
  /** La del vendedor. */
  sucursalCodigo: string;
  /** Ruta diaria viva de ese dia. */
  clientesEnRuta: number;
  /** De esos, con venta o visita ese dia. */
  atendidosEnRuta: number;
  /** Lineas vivas, sin promocion. */
  piezas: number;
  montoCentavos: number;
  /** Abonos de origen `venta_contado`. */
  contadoCentavos: number;
  /** Abonos de origen `cobro`. */
  anterioresCentavos: number;
  /** Sobrante de cobros que fue a saldo a favor. */
  aFavorCentavos: number;
  gastoCentavos: number;
  jornadaCerrada: boolean;
  /** Nombre del vehiculo de la jornada. */
  vehiculo: string | null;
  /** Nombre de la ruta asignada ese dia (`ruta_dia` viva); `null` = sin ruta con nombre. */
  rutaNombre: string | null;
  /** Vehiculo asignado en la ruta del dia (`ruta_dia`), no el de la jornada. */
  vehiculoAsignado: string | null;
}

export interface ResumenVendedorDia extends FilaVendedorDia {
  /** contado + anteriores + aFavor. */
  cobranzaCentavos: number;
  /** cobranza - gasto. */
  tesoreriaCentavos: number;
  estatus: "en_ruta" | "terminado";
}

export interface Totales {
  rutas: number;
  piezas: number;
  montoCentavos: number;
  cobranzaCentavos: number;
  gastoCentavos: number;
  tesoreriaCentavos: number;
  clientesEnRuta: number;
  atendidosEnRuta: number;
}

export interface CobranzaOficinaDia {
  fecha: string;
  sucursalCodigo: string;
  montoCentavos: number;
}

export interface ResumenDia {
  fecha: string;
  sucursalCodigo: string;
  totales: Totales;
  oficinaCentavos: number;
}

export interface BloqueSucursal {
  sucursalCodigo: string;
  porVendedor: Totales;
  porDia: Totales;
}

export interface FlujoDiario {
  desde: string;
  hasta: string;
  /** Orden: sucursal, fecha DESC, vendedor. */
  porVendedor: ResumenVendedorDia[];
  /** Orden: sucursal, fecha DESC. */
  porDia: ResumenDia[];
  /** Uno por sucursal presente, en orden de codigo. */
  bloques: BloqueSucursal[];
  totalPorVendedor: Totales;
  /** Incluye la cobranza de la oficina. */
  totalPorDia: Totales;
}
export interface Dashboard {
  /** Hoy de Tijuana. */
  fecha: string;
  /** Orden: sucursal, vendedor. */
  vendedores: ResumenVendedorDia[];
  bloques: {
    sucursalCodigo: string;
    totales: Totales;
    enRuta: number;
    terminaron: number;
  }[];
  total: Totales & { enRuta: number; terminaron: number };
}

export type MetodoPago = "efectivo" | "transferencia" | "cheque";

export interface PagoDetalle {
  folio: string;
  cliente: string;
  montoCentavos: number;
  metodo: MetodoPago;
  /** `cobranza_abono.saldo_pendiente`: lo que queda de la nota despues de ese pago. */
  saldoPendienteCentavos: number;
  liquidada: boolean;
}

export interface NotaDetalle {
  folio: string;
  cliente: string;
  contadoCredito: "contado" | "credito";
  piezas: number;
  totalCentavos: number;
  pendienteCentavos: number;
  lineas: { producto: string; cantidad: number; precioCentavos: number }[];
}

export interface Corte {
  contadoCentavos: number;
  anterioresCentavos: number;
  aFavorCentavos: number;
  gastoCentavos: number;
  tesoreriaCentavos: number;
}

export interface VisitaDetalle {
  cliente: string;
  /** false = cliente de su ruta que no visitó (el viejo: "Cliente no visitado"). */
  visitado: boolean;
  vendio: boolean;
  /** ISO (UTC); el portal la pinta en hora de Tijuana. null si no se visitó. */
  hora: string | null;
  motivo: string | null;
  atendio: string | null;
  comentario: string | null;
}

export interface DetalleVendedorDia {
  fecha: string;
  vendedorId: string;
  vendedor: string;
  porProducto: { presentacion: string; producto: string; piezas: number }[];
  notas: NotaDetalle[];
  cobranza: {
    contado: PagoDetalle[];
    anteriores: PagoDetalle[];
    aFavor: { cliente: string; montoCentavos: number }[];
  };
  gastos: { descripcion: string; montoCentavos: number }[];
  notasCredito: {
    folio: string;
    cliente: string;
    totalCentavos: number;
    pendienteCentavos: number;
    /** La nota de papel: true entregada, false no, null sin revisar. */
    entregada: boolean | null;
  }[];
  /**
   * Notas a credito de dias ANTERIORES del vendedor marcadas como no
   * entregadas y con algo pendiente. Orden: fecha, folio.
   */
  notasNoEntregadas: NotaNoEntregada[];
  visitas: VisitaDetalle[];
  promociones: { cliente: string; producto: string; cantidad: number }[];
  /** `null` sin jornada cerrada. */
  corte: Corte | null;
}

export interface NotaNoEntregada {
  folio: string;
  cliente: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
  totalCentavos: number;
  pendienteCentavos: number;
}

export interface DetalleDia {
  fecha: string;
  sucursalCodigo: string;
  porPresentacion: { presentacion: string; piezas: number }[];
  porProducto: { producto: string; piezas: number }[];
  porVendedor: { vendedor: string; presentacion: string; piezas: number }[];
  porCliente: { cliente: string; presentacion: string; piezas: number }[];
  /** `cobrador` null = Oficina. */
  cobranza: (PagoDetalle & { cobrador: string | null })[];
  aFavor: {
    cobrador: string | null;
    cliente: string;
    montoCentavos: number;
  }[];
  gastos: { vendedor: string; descripcion: string; montoCentavos: number }[];
  visitas: (Omit<VisitaDetalle, "atendio"> & { vendedor: string })[];
  promociones: { producto: string; cantidad: number }[];
}

/* ---- Consultas ---- */

function consulta(ruta: string, params: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${ruta}?${s}` : ruta;
}

export function obtenerFlujoDiario(f: {
  desde: string;
  hasta: string;
  sucursal: string | null;
  vendedor: string | null;
}): Promise<FlujoDiario> {
  return apiFetch<FlujoDiario>(
    consulta("/reportes/flujo-diario", {
      desde: f.desde,
      hasta: f.hasta,
      sucursal: f.sucursal,
      vendedor: f.vendedor,
    }),
  );
}

export function obtenerDetalleVendedor(f: {
  fecha: string;
  vendedor: string;
  sucursal: string | null;
}): Promise<DetalleVendedorDia> {
  return apiFetch<DetalleVendedorDia>(
    consulta("/reportes/flujo-diario/vendedor", {
      fecha: f.fecha,
      vendedor: f.vendedor,
      sucursal: f.sucursal,
    }),
  );
}

/**
 * `sucursal` es obligatoria: un código. Con `vendedor`, el día trae solo lo de ese
 * vendedor y sin la oficina (igual que su renglón "Por día").
 */
export function obtenerDetalleDia(f: {
  fecha: string;
  sucursal: string;
  vendedor: string | null;
}): Promise<DetalleDia> {
  return apiFetch<DetalleDia>(
    consulta("/reportes/flujo-diario/dia", {
      fecha: f.fecha,
      sucursal: f.sucursal,
      vendedor: f.vendedor,
    }),
  );
}

export function obtenerDashboard(sucursal: string | null): Promise<Dashboard> {
  return apiFetch<Dashboard>(consulta("/dashboard", { sucursal }));
}

/**
 * `fecha` es la del Dashboard que se está viendo (`dashboard.fecha`): cerca de la
 * medianoche el detalle sigue siendo del mismo día que el renglón.
 */
export function obtenerDetalleDashboard(f: {
  vendedor: string;
  sucursal: string | null;
  fecha: string;
}): Promise<DetalleVendedorDia> {
  return apiFetch<DetalleVendedorDia>(
    consulta("/dashboard/vendedor", {
      vendedor: f.vendedor,
      sucursal: f.sucursal,
      fecha: f.fecha,
    }),
  );
}

/**
 * La casilla "Entregada" de las notas a crédito (permiso `nota_papel.revisar`). Manda todas las
 * del vendedor; una que no se puede revisar tumba el lote (400) y no se guarda nada. Responde 204.
 */
export function guardarNotasEntregadas(datos: {
  vendedor: string;
  notas: { folio: string; entregada: boolean }[];
}): Promise<void> {
  return apiFetchSinCuerpo("/dashboard/notas-entregadas", {
    method: "PUT",
    body: JSON.stringify(datos),
  });
}

/** Agrupa respetando el orden de llegada (el servidor ya ordena por sucursal). */
export function agruparPorSucursal<T extends { sucursalCodigo: string }>(
  filas: T[],
): { sucursalCodigo: string; filas: T[] }[] {
  const grupos: { sucursalCodigo: string; filas: T[] }[] = [];
  for (const fila of filas) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.sucursalCodigo === fila.sucursalCodigo)
      ultimo.filas.push(fila);
    else grupos.push({ sucursalCodigo: fila.sucursalCodigo, filas: [fila] });
  }
  return grupos;
}

export function etiquetaRutaAsignada(
  rutaNombre: string | null,
  clientesEnRuta: number,
): string {
  if (clientesEnRuta === 0) return rutaNombre ?? "Sin ruta";
  return `${rutaNombre ?? "Sin ruta"} · ${plural(clientesEnRuta, "cliente", "clientes")}`;
}

/** El vehiculo que uso (jornada) y, si es otro, el que tenia asignado. */
export function etiquetaVehiculo(
  usado: string | null,
  asignado: string | null,
): string {
  if (usado && asignado && usado !== asignado)
    return `${usado} (asignado: ${asignado})`;
  return usado ?? asignado ?? "—";
}

export function etiquetaLiquidada(p: PagoDetalle): {
  texto: "Sí" | "Abonado";
  resta: string | null;
} {
  return p.saldoPendienteCentavos > 0
    ? { texto: "Abonado", resta: formatearPesos(p.saldoPendienteCentavos) }
    : { texto: "Sí", resta: null };
}

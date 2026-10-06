import { apiFetch } from "./api";

// Copia normativa de las formas de
// apps/backend/src/modules/ventas-cobranza/ventas-portal.service.ts
// (`PresentacionDeCatalogo`, `VentaRegistradaPortal`), ventas-portal.repository.ts
// (`Repartidor`), ventas-consulta.repository.ts / ventas-consulta.service.ts
// (`VentaEncontrada`, `ResultadoBusquedaVentas`, `VentaDetalle`) y de los cuerpos
// de dto/registrar-venta.dto.ts y dto/editar-venta.dto.ts. Mismo trato que
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

/* ------------------------------------------------------------------ */
/* Buscar, editar y eliminar (T-17, parte 2)                           */
/* ------------------------------------------------------------------ */

export type StatusVenta = "pagada" | "pendiente" | "promocion" | "abonado" | "cuenta_perdida";
export type OrigenVenta = "app" | "portal";

export const ETIQUETA_STATUS: Record<StatusVenta, string> = {
  pagada: "Pagada",
  pendiente: "Pendiente",
  promocion: "Promoción",
  abonado: "Abonado",
  cuenta_perdida: "Cuenta perdida",
};

export const ETIQUETA_ORIGEN: Record<OrigenVenta, string> = {
  app: "Tablet",
  portal: "Portal",
};

/** Una fila de la búsqueda. `repartidor: null` = Oficina. */
export interface VentaEncontrada {
  id: string;
  folio: string;
  fecha: string;
  clienteId: string;
  cliente: string;
  repartidor: string | null;
  numNota: string;
  montoCentavos: number;
  status: StatusVenta;
  origen: OrigenVenta;
  saldoCentavos: number;
}

export interface ResultadoBusquedaVentas {
  ventas: VentaEncontrada[];
  /** Había más de 200: se pide acotar. */
  hayMas: boolean;
}

export interface FiltroVentas {
  desde: string;
  hasta: string;
  sucursal: string | null;
  clienteId: string | null;
  numNota: string;
}

export interface LineaDetalleVenta {
  presentacionId: string;
  producto: string;
  volumen: string;
  cantidad: number;
  cantidadPromocion: number;
  /** El guardado: el de la nota firmada (tablet) o el de la lista a la fecha (portal). */
  precioCentavos: number;
  subtotalCentavos: number;
}

export interface CobroDeVenta {
  id: string;
  fechaPago: string;
  metodoPago: string;
  montoCentavos: number;
  origen: "cobro" | "venta_contado";
}

export interface VentaDetalle {
  id: string;
  folio: string;
  fecha: string;
  clienteId: string;
  cliente: string;
  sucursalId: string;
  sucursalCodigo: string;
  vendedorId: string | null;
  repartidor: string | null;
  numNota: string;
  contadoCredito: ContadoCredito;
  factura: string;
  comentarios: string | null;
  montoCentavos: number;
  status: StatusVenta;
  origen: OrigenVenta;
  saldoCentavos: number;
  lineas: LineaDetalleVenta[];
  cobros: CobroDeVenta[];
  /** De la VENTA (sin cobros de cobranza, no es cuenta perdida); el permiso lo pone `puede()`. */
  editable: boolean;
  motivoNoEditable: string | null;
  puedeMarcarPerdida: boolean;
}

/** El cuerpo de `PATCH /ventas/:id`: el estado completo de lo editable, sin precios. */
export type CambiosVenta = Omit<NuevaVenta, "fecha" | "clienteId">;

export function buscarVentas(filtro: FiltroVentas): Promise<ResultadoBusquedaVentas> {
  const params = new URLSearchParams({ desde: filtro.desde, hasta: filtro.hasta });
  if (filtro.sucursal) params.set("sucursal", filtro.sucursal);
  if (filtro.clienteId) params.set("clienteId", filtro.clienteId);
  const numNota = filtro.numNota.trim();
  if (numNota) params.set("numNota", numNota);
  return apiFetch<ResultadoBusquedaVentas>(`/ventas?${params.toString()}`);
}

export function obtenerVenta(id: string): Promise<VentaDetalle> {
  return apiFetch<VentaDetalle>(`/ventas/${encodeURIComponent(id)}`);
}

export function editarVenta(id: string, cambios: CambiosVenta): Promise<VentaDetalle> {
  return apiFetch<VentaDetalle>(`/ventas/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(cambios),
  });
}

export function eliminarVenta(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/ventas/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function marcarCuentaPerdida(id: string): Promise<VentaDetalle> {
  return apiFetch<VentaDetalle>(`/ventas/${encodeURIComponent(id)}/cuenta-perdida`, {
    method: "POST",
  });
}

/* ------------------------------------------------------------------ */
/* Captura compartida por "Registrar venta" y "Editar venta"           */
/* ------------------------------------------------------------------ */

/** Valor del desplegable para la venta de mostrador: viaja como `vendedorId: null`. */
export const REPARTIDOR_OFICINA = "oficina";

/** Sin acentos ni mayúsculas, para buscar "jose" y encontrar "José". */
export function normalizarTexto(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Una fila de la tabla de productos. `deshabilitada` = no se captura ni viaja. */
export interface FilaProducto {
  presentacionId: string;
  producto: string;
  volumen: string;
  /** `null` = "sin precio en la lista". */
  precioCentavos: number | null;
  deshabilitada: boolean;
}

export type Captura = Record<string, { cantidad: string; promocion: string }>;

/** Registrar: el catálogo tal cual; sin precio a la fecha = deshabilitada. */
export function filasDeCatalogo(catalogo: PresentacionDeCatalogo[]): FilaProducto[] {
  return catalogo.map((p) => ({ ...p, deshabilitada: p.precioCentavos === null }));
}

/**
 * Editar (§3.3): primero las líneas de la venta con su precio GUARDADO (nunca
 * deshabilitadas: la presentación pudo darse de baja después), luego las
 * presentaciones del catálogo sin línea con el precio de la lista a la fecha.
 * Una línea de promoción ($0) muestra el precio de la lista: si se le capturan
 * piezas, el servidor cobra ese.
 */
export function filasDeEdicion(
  lineas: LineaDetalleVenta[],
  catalogo: PresentacionDeCatalogo[],
): FilaProducto[] {
  const precioDeLista = new Map(catalogo.map((p) => [p.presentacionId, p.precioCentavos]));
  const propias = new Set(lineas.map((l) => l.presentacionId));
  return [
    ...lineas.map((l) => ({
      presentacionId: l.presentacionId,
      producto: l.producto,
      volumen: l.volumen,
      precioCentavos:
        l.precioCentavos > 0 ? l.precioCentavos : (precioDeLista.get(l.presentacionId) ?? 0),
      deshabilitada: false,
    })),
    ...filasDeCatalogo(catalogo.filter((p) => !propias.has(p.presentacionId))),
  ];
}

/** Lo guardado como texto de los campos; 0 queda vacío. */
export function capturaDeLineas(lineas: LineaDetalleVenta[]): Captura {
  return Object.fromEntries(
    lineas.map((l) => [
      l.presentacionId,
      {
        cantidad: l.cantidad === 0 ? "" : String(l.cantidad),
        promocion: l.cantidadPromocion === 0 ? "" : String(l.cantidadPromocion),
      },
    ]),
  );
}

export function conCaptura(
  captura: Captura,
  presentacionId: string,
  campo: "cantidad" | "promocion",
  valor: string,
): Captura {
  return {
    ...captura,
    [presentacionId]: {
      cantidad: captura[presentacionId]?.cantidad ?? "",
      promocion: captura[presentacionId]?.promocion ?? "",
      [campo]: valor,
    },
  };
}

export type ResultadoLineas =
  | { ok: true; lineas: NuevaVenta["lineas"] }
  | { ok: false; error: string };

/** Lo tecleado → líneas del payload, **sin precios**. Una fila deshabilitada nunca viaja. */
export function lineasDeCaptura(filas: FilaProducto[], captura: Captura): ResultadoLineas {
  const lineas: NuevaVenta["lineas"] = [];
  for (const f of filas) {
    if (f.deshabilitada) continue;
    const cantidad = leerPiezas(captura[f.presentacionId]?.cantidad ?? "");
    const promocion = leerPiezas(captura[f.presentacionId]?.promocion ?? "");
    if (cantidad === null || promocion === null) {
      return { ok: false, error: "Las cantidades deben ser números enteros de 0 en adelante." };
    }
    if (cantidad + promocion > 0) {
      lineas.push({ presentacionId: f.presentacionId, cantidad, cantidadPromocion: promocion });
    }
  }
  if (lineas.length === 0) return { ok: false, error: "Captura al menos un producto." };
  return { ok: true, lineas };
}

/** Vista previa del total: el servidor recalcula. */
export function totalDeCaptura(filas: FilaProducto[], captura: Captura): number {
  return filas.reduce((total, f) => {
    if (f.deshabilitada || f.precioCentavos === null) return total;
    const piezas = leerPiezas(captura[f.presentacionId]?.cantidad ?? "");
    return total + (piezas ?? 0) * f.precioCentavos;
  }, 0);
}

/** # de nota, contado/crédito, método, factura y comentarios tal como se teclean. */
export interface CondicionesVenta {
  numNota: string;
  contadoCredito: ContadoCredito;
  metodoPago: MetodoPagoContado;
  factura: FacturaVenta;
  comentarios: string;
}

export const CONDICIONES_INICIALES: CondicionesVenta = {
  numNota: "",
  contadoCredito: "contado",
  metodoPago: "transferencia",
  factura: "N/A",
  comentarios: "",
};

/** Lo que de las condiciones viaja en el payload: método solo en contado, comentarios solo si hay. */
export function camposDeCondiciones(
  c: CondicionesVenta,
): Pick<NuevaVenta, "numNota" | "contadoCredito" | "metodoPago" | "factura" | "comentarios"> {
  const comentario = c.comentarios.trim();
  return {
    numNota: c.numNota.trim(),
    contadoCredito: c.contadoCredito,
    ...(c.contadoCredito === "contado" ? { metodoPago: c.metodoPago } : {}),
    factura: c.factura,
    ...(comentario ? { comentarios: comentario } : {}),
  };
}

/** Las condiciones de una venta guardada; el método propuesto es el de su cobro de contado. */
export function condicionesDeVenta(venta: VentaDetalle): CondicionesVenta {
  const cobro = venta.cobros.find((c) => c.origen === "venta_contado");
  return {
    numNota: venta.numNota,
    contadoCredito: venta.contadoCredito,
    metodoPago: cobro?.metodoPago === "efectivo" ? "efectivo" : "transferencia",
    factura: venta.factura === "pendiente" ? "pendiente" : "N/A",
    comentarios: venta.comentarios ?? "",
  };
}

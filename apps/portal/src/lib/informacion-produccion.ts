import { apiFetch } from "./api";
import { agruparPorTamano, type CualPt, type VistaPt } from "./inventario-pt";

// Copia normativa de `RenglonInformacion`, `InformacionProduccion`, `FilaDetalleInformacion` y
// `DetalleInformacionProduccion` (apps/backend/src/modules/produccion/
// reglas-informacion-produccion.ts, informacion-produccion.service.ts y
// informacion-produccion.repository.ts). El portal no importa del backend: un cambio de forma en
// un lado exige el equivalente en el otro. Spec:
// docs/superpowers/specs/2026-11-28-informacion-de-produccion-design.md. Solo lectura; el portal
// solo suma los totales por tamaño.

/** Un renglón del reporte: lo producido y lo comprado en el rango. */
export interface RenglonInformacion {
  /** `null` en la vista por producto. */
  presentacionId: string | null;
  productoId: string;
  producto: string;
  /** `''` en la vista por producto. */
  volumen: string;
  produccion: number;
  compras: number;
  total: number;
}

/** `GET /informacion-produccion`. */
export interface InformacionProduccion {
  desde: string;
  hasta: string;
  hoyEnTijuana: string;
  renglones: RenglonInformacion[];
}

/** Una captura (operación) que tocó lo pedido. */
export interface FilaDetalleInformacion {
  /** `AAAA-MM-DD`. */
  fecha: string;
  /** `hh:mm` de Tijuana. */
  hora: string;
  /** Código de la sucursal. */
  sucursal: string;
  origen: "produccion" | "compra";
  capturo: string;
  piezas: number;
  comentario: string | null;
}

/** `GET /informacion-produccion/detalle`. */
export interface DetalleInformacionProduccion {
  detalle: FilaDetalleInformacion[];
}

export function leerInformacionProduccion(
  desde: string,
  hasta: string,
  sucursal: string,
  vista: VistaPt,
): Promise<InformacionProduccion> {
  const params = new URLSearchParams({ desde, hasta, sucursal, vista });
  return apiFetch<InformacionProduccion>(`/informacion-produccion?${params.toString()}`);
}

export function leerDetalleInformacion(
  c: CualPt,
  desde: string,
  hasta: string,
  sucursal: string,
): Promise<DetalleInformacionProduccion> {
  const cual: [string, string] = "presentacion" in c ? ["presentacion", c.presentacion] : ["producto", c.producto];
  const params = new URLSearchParams([cual, ["desde", desde], ["hasta", hasta], ["sucursal", sucursal]]);
  return apiFetch<DetalleInformacionProduccion>(`/informacion-produccion/detalle?${params.toString()}`);
}

// ── Reglas de la pantalla (puras) ──────────────────────────────────────────────

export interface TotalesInformacion {
  produccion: number;
  compras: number;
  total: number;
}

export function totalInformacion(renglones: readonly RenglonInformacion[]): TotalesInformacion {
  return renglones.reduce(
    (t, r) => ({ produccion: t.produccion + r.produccion, compras: t.compras + r.compras, total: t.total + r.total }),
    { produccion: 0, compras: 0, total: 0 },
  );
}

export interface GrupoInformacion {
  tamano: string;
  renglones: RenglonInformacion[];
  totales: TotalesInformacion;
}

/** Los grupos por tamaño de la tabla, con su total. */
export function gruposInformacion(renglones: readonly RenglonInformacion[]): GrupoInformacion[] {
  return agruparPorTamano(renglones).map(({ tamano, renglones: rs }) => ({
    tamano,
    renglones: rs,
    totales: totalInformacion(rs),
  }));
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * El rango del título del detalle (spec D4): "del 3 al 7 nov"; un solo día, "3 nov"; meses distintos,
 * "del 28 oct al 3 nov"; años distintos, con el año en los dos.
 */
export function textoRango(desde: string, hasta: string): string {
  const [ad, md, dd] = desde.split("-").map(Number);
  const [ah, mh, dh] = hasta.split("-").map(Number);
  const dia = (d: number, m: number, a?: number) => `${d} ${MESES_CORTOS[m - 1]}${a ? ` ${a}` : ""}`;
  if (desde === hasta) return dia(dd, md);
  if (ad !== ah) return `del ${dia(dd, md, ad)} al ${dia(dh, mh, ah)}`;
  if (md !== mh) return `del ${dia(dd, md)} al ${dia(dh, mh)}`;
  return `del ${dd} al ${dia(dh, mh)}`;
}

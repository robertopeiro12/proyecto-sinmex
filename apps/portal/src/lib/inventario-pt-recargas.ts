import { apiFetch } from "./api";
import { agruparPorTamano, sumaCompleta, type CualPt, type VistaPt } from "./inventario-pt";

// Copia normativa de `MovimientosRecargas`, `RenglonPtRecargas`, `InventarioPtRecargas`,
// `FilaDetalleRecargas` y `DetallePtRecargas` (apps/backend/src/modules/produccion/
// inventario-pt-recargas.service.ts, inventario-pt-recargas.repository.ts y
// reglas-inventario-pt-recargas.ts). El portal no importa del backend: un cambio de forma en un
// lado exige el equivalente en el otro. Spec:
// docs/superpowers/specs/2026-11-25-inventario-pt-recargas-design.md. El portal NO recalcula el
// inventario: solo suma los totales por tamaño. "Hoy" lo dice el servidor (no hay fecha). Es una
// fotografía a grandes rasgos (tío, 2026-11-25): el inventario real es el de PT con Ventas.

export interface MovimientosRecargas {
  /** Renglones aceptados de cargas vivas de hoy (una pendiente no resta). */
  recargas: number;
  /** Envíos que salieron. */
  envios: number;
  /** Registro `entrada` (producción/compras) + envíos recibidos. */
  entradas: number;
}

export interface RenglonPtRecargas extends MovimientosRecargas {
  /** `null` en la vista por producto. */
  presentacionId: string | null;
  productoId: string;
  producto: string;
  /** `''` en la vista por producto. */
  volumen: string;
  /** `null` = "Sin inventario inicial": celda vacía, nunca 0. */
  inicial: number | null;
  actual: number | null;
  /** Hoy hay un ajuste: el Inicial es el del ajuste. */
  ajustado: boolean;
}

/** `GET /inventario-pt/recargas`. */
export interface InventarioPtRecargas {
  /** Hoy en Tijuana (la pantalla no tiene fecha). */
  fecha: string;
  hoyEnTijuana: string;
  /** Hora de la consulta en Tijuana, `hh:mm`. */
  consultadoEn: string;
  renglones: RenglonPtRecargas[];
}

/** A quién se le recargó: el vendedor, su n.º de carga y las piezas aceptadas. */
export interface FilaDetalleRecargas {
  quien: string;
  /** `carga.numero`. */
  carga: number;
  piezas: number;
}

/** `GET /inventario-pt/recargas/detalle`. */
export interface DetallePtRecargas {
  detalle: FilaDetalleRecargas[];
}

export function leerInventarioPtRecargas(sucursal: string, vista: VistaPt): Promise<InventarioPtRecargas> {
  const params = new URLSearchParams({ sucursal, vista });
  return apiFetch<InventarioPtRecargas>(`/inventario-pt/recargas?${params.toString()}`);
}

export function leerDetallePtRecargas(c: CualPt, sucursal: string): Promise<DetallePtRecargas> {
  const cual: [string, string] = "presentacion" in c ? ["presentacion", c.presentacion] : ["producto", c.producto];
  const params = new URLSearchParams([cual, ["sucursal", sucursal]]);
  return apiFetch<DetallePtRecargas>(`/inventario-pt/recargas/detalle?${params.toString()}`);
}

// ── Reglas de la pantalla (puras) ──────────────────────────────────────────────

const MOVIMIENTOS: (keyof MovimientosRecargas)[] = ["recargas", "envios", "entradas"];

export type TotalesPtRecargas = MovimientosRecargas & {
  /** `null` si algún renglón del grupo no tiene inventario inicial. */
  inicial: number | null;
  actual: number | null;
};

export interface GrupoPtRecargas {
  tamano: string;
  renglones: RenglonPtRecargas[];
  totales: TotalesPtRecargas;
}

/** Los grupos por tamaño de la tabla, con su total (como `gruposPt` de PT con Ventas). */
export function gruposPtRecargas(renglones: readonly RenglonPtRecargas[]): GrupoPtRecargas[] {
  return agruparPorTamano(renglones).map(({ tamano, renglones: rs }) => {
    const movimientos = Object.fromEntries(
      MOVIMIENTOS.map((k) => [k, rs.reduce((t, r) => t + r[k], 0)]),
    ) as unknown as MovimientosRecargas;
    return {
      tamano,
      renglones: rs,
      totales: {
        inicial: sumaCompleta(rs, (r) => r.inicial),
        ...movimientos,
        actual: sumaCompleta(rs, (r) => r.actual),
      },
    };
  });
}

/** El aviso "sin inventario inicial": el ajuste se captura en Inventario de PT con Ventas (aquí no se ajusta). */
export function textoSinInicialRecargas(cuantos: number, vista: VistaPt, todas: boolean): string {
  const uno = cuantos === 1;
  const que =
    vista === "producto"
      ? uno
        ? "producto sin inventario inicial"
        : "productos sin inventario inicial"
      : uno
        ? "presentación sin inventario inicial"
        : "presentaciones sin inventario inicial";
  const quien = todas ? "cada sucursal capture su ajuste" : "se capture un ajuste";
  return `${cuantos} ${que}: su Inicial y Actual quedan vacíos hasta que ${quien} en Inventario de PT con Ventas. Los movimientos de hoy sí se ven.`;
}

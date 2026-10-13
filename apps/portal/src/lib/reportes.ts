import { apiFetch } from "./api";
import type { DefinicionExcel, FilaExcel } from "./excel/definicion";

/*
 * Reporte de Kilometraje (T-50). Misma forma que
 * apps/backend/src/modules/estadisticas/reglas-kilometraje.ts (el portal no
 * puede importar del backend). Kilometros en DECIMAS de km enteras.
 */

export interface JornadaEnReporte {
  jornadaId: string;
  fecha: string;
  vendedor: string;
  kmInicialDecimas: number;
  kmFinalDecimas: number;
  kilometrosDecimas: number;
  /** `null` = sin jornada anterior; `0` = empezo donde termino la anterior. */
  saltoDecimas: number | null;
  fechaAnterior: string | null;
}

export interface VehiculoEnReporte {
  vehiculoId: string;
  nombre: string;
  placas: string | null;
  activo: boolean;
  jornadas: JornadaEnReporte[];
  totalKilometrosDecimas: number;
  totalSaltoDecimas: number;
}

export interface ReporteKilometraje {
  desde: string;
  hasta: string;
  vehiculos: VehiculoEnReporte[];
  totalKilometrosDecimas: number;
  totalSaltoDecimas: number;
}

export interface FiltrosKilometraje {
  desde: string;
  hasta: string;
  vehiculoId: string | null;
  /** Codigo, `todas`, o null: lo decide el servidor (`resolverAlcance`). */
  sucursal: string | null;
}

export function obtenerReporteKilometraje(f: FiltrosKilometraje): Promise<ReporteKilometraje> {
  const q = new URLSearchParams({ desde: f.desde, hasta: f.hasta });
  if (f.vehiculoId) q.set("vehiculo", f.vehiculoId);
  if (f.sucursal) q.set("sucursal", f.sucursal);
  return apiFetch<ReporteKilometraje>(`/reportes/kilometraje?${q.toString()}`);
}

const MENOS = "−"; // U+2212: el signo menos tipografico, no el guion.

/** `100005` → `"10,000.5"`; negativos con `−`. */
export function formatearKm(decimas: number): string {
  const texto = (Math.abs(decimas) / 10).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return decimas < 0 ? `${MENOS}${texto}` : texto;
}

/** Vacio sin salto (`null` o `0`); si no, con signo: `+150.0` / `−30.0`. */
export function formatearSalto(decimas: number | null): string {
  if (decimas === null || decimas === 0) return "";
  return decimas > 0 ? `+${formatearKm(decimas)}` : formatearKm(decimas);
}

/** `AAAA-MM-DD` → `dd/mm/aaaa`, sin pasar por `Date` (que correria el dia). */
export function formatearFecha(iso: string): string {
  const [anio, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${anio}`;
}

export function primerDiaDelMes(hoy: string): string {
  return `${hoy.slice(0, 8)}01`;
}

/** El `title` del salto en pantalla. */
export function explicarSalto(j: JornadaEnReporte): string | undefined {
  if (j.saltoDecimas === null || j.saltoDecimas === 0 || j.fechaAnterior === null) return undefined;
  return `Empezó ${formatearKm(Math.abs(j.saltoDecimas))} km distinto a como terminó la jornada anterior de este vehículo (${formatearFecha(j.fechaAnterior)}).`;
}

export function etiquetaVehiculo(v: { nombre: string; placas: string | null; activo: boolean }): string {
  return `${v.nombre}${v.placas ? ` (${v.placas})` : ""}${v.activo ? "" : " (desactivado)"}`;
}

/** Lo que dice el Excel en "Sucursal": la del usuario si esta atado a una; si no, la pedida o "Todas". */
export function etiquetaSucursal(codigoDelUsuario: string | null, pedida: string | null): string {
  if (codigoDelUsuario) return codigoDelUsuario;
  if (!pedida || pedida.toLowerCase() === "todas") return "Todas";
  return pedida.toUpperCase();
}

const km = (decimas: number): number => decimas / 10;
const saltoEnKm = (decimas: number | null): number | null =>
  decimas === null || decimas === 0 ? null : decimas / 10;

/**
 * Lo que esta en pantalla, como hoja de Excel. `filtros` son los APLICADOS en
 * la ultima consulta, no lo que el usuario tenga escrito ahora (Review Focus 5).
 */
export function definicionExcelKilometraje(
  reporte: ReporteKilometraje,
  filtros: { sucursal: string; vehiculo: string },
): DefinicionExcel {
  const filas: FilaExcel[] = [];
  for (const v of reporte.vehiculos) {
    const etiqueta = etiquetaVehiculo(v);
    filas.push({ tipo: "grupo", celdas: [etiqueta, null, null, null, null, null] });
    for (const j of v.jornadas) {
      filas.push({
        celdas: [j.fecha, j.vendedor, km(j.kmInicialDecimas), km(j.kmFinalDecimas), km(j.kilometrosDecimas), saltoEnKm(j.saltoDecimas)],
        resaltada: j.saltoDecimas !== null && j.saltoDecimas !== 0,
      });
    }
    filas.push({
      tipo: "subtotal",
      celdas: [`Total ${etiqueta}`, null, null, null, km(v.totalKilometrosDecimas), saltoEnKm(v.totalSaltoDecimas)],
    });
  }
  filas.push({
    tipo: "total",
    celdas: ["Total general", null, null, null, km(reporte.totalKilometrosDecimas), saltoEnKm(reporte.totalSaltoDecimas)],
  });

  return {
    titulo: "Reporte de Kilometraje",
    filtros: [
      ["Rango", `${formatearFecha(reporte.desde)} a ${formatearFecha(reporte.hasta)}`],
      ["Sucursal", filtros.sucursal],
      ["Vehículo", filtros.vehiculo],
    ],
    columnas: [
      { encabezado: "Fecha", tipo: "fecha", ancho: 12 },
      { encabezado: "Vendedor", tipo: "texto", ancho: 28 },
      { encabezado: "Km inicial", tipo: "numero", decimales: 1, ancho: 14 },
      { encabezado: "Km final", tipo: "numero", decimales: 1, ancho: 14 },
      { encabezado: "Kilómetros", tipo: "numero", decimales: 1, ancho: 14 },
      { encabezado: "Salto", tipo: "numero", decimales: 1, ancho: 12 },
    ],
    filas,
    nombreArchivo: `kilometraje_${reporte.desde}_a_${reporte.hasta}`,
  };
}

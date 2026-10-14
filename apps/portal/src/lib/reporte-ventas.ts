import { apiFetch } from "./api";
import type { DefinicionExcel, FilaExcel } from "./excel/definicion";
import { formatearFecha } from "./reportes";
import { ETIQUETA_STATUS } from "./ventas";

/*
 * Reporte de Ventas (T-49). Misma forma que
 * apps/backend/src/modules/estadisticas/reglas-reporte-ventas.ts (el portal no
 * puede importar del backend). Dinero en centavos enteros.
 */

export type StatusVenta = "pagada" | "pendiente" | "abonado" | "cuenta_perdida" | "promocion";

export interface VentaEnReporte {
  id: string;
  fecha: string;
  folio: string;
  cliente: string;
  numNota: string | null;
  /** `null` = venta de mostrador (Oficina). */
  repartidor: string | null;
  status: StatusVenta;
  /** "N/A", "Pendiente" o el número de factura. */
  factura: string;
  semana: number;
  cantidad: number;
  promocion: number;
  montoCentavos: number;
}

export interface TotalVentas {
  ventas: number;
  cantidad: number;
  promocion: number;
  montoCentavos: number;
}

export interface DiaDeVentas {
  fecha: string;
  ventas: VentaEnReporte[];
  subtotal: TotalVentas;
}

export interface RepartidorEnReporte extends TotalVentas {
  vendedorId: string | null;
  repartidor: string | null;
}

export interface ReporteVentas {
  desde: string;
  hasta: string;
  dias: DiaDeVentas[];
  porRepartidor: RepartidorEnReporte[];
  total: TotalVentas;
}

export function obtenerReporteVentas(f: {
  desde: string;
  hasta: string;
  /** Código, `todas`, o null: lo decide el servidor (`resolverAlcance`). */
  sucursal: string | null;
  /** Id de vendedor, `oficina`, o null (todos). */
  repartidor: string | null;
}): Promise<ReporteVentas> {
  const q = new URLSearchParams({ desde: f.desde, hasta: f.hasta });
  if (f.sucursal) q.set("sucursal", f.sucursal);
  if (f.repartidor) q.set("repartidor", f.repartidor);
  return apiFetch<ReporteVentas>(`/reportes/ventas?${q.toString()}`);
}

const MS_DIA = 24 * 60 * 60 * 1000;

const aFecha = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const aIso = (d: Date): string => d.toISOString().slice(0, 10);

/** Lunes a domingo de la semana de `hoy` (`AAAA-MM-DD`), sin zona horaria de por medio. */
export function rangoSemana(hoy: string): { desde: string; hasta: string } {
  const d = aFecha(hoy);
  const desdeLunes = (d.getUTCDay() + 6) % 7;
  const lunes = new Date(d.getTime() - desdeLunes * MS_DIA);
  return { desde: aIso(lunes), hasta: aIso(new Date(lunes.getTime() + 6 * MS_DIA)) };
}

/** Del día 1 al último día del mes de `hoy`. */
export function rangoMes(hoy: string): { desde: string; hasta: string } {
  const [anio, mes] = hoy.split("-").map(Number);
  const ultimo = new Date(Date.UTC(anio, mes, 0));
  return { desde: `${hoy.slice(0, 8)}01`, hasta: aIso(ultimo) };
}

export function nombreRepartidor(repartidor: string | null): string {
  return repartidor ?? "Oficina";
}

const pesos = (centavos: number): number => centavos / 100;
const vacias = (n: number): null[] => Array.from({ length: n }, () => null);

/**
 * Lo consultado como hoja de Excel. `filtros` son los APLICADOS en la última
 * consulta, no lo que esté escrito ahora en la pantalla.
 */
export function definicionExcelReporteVentas(
  r: ReporteVentas,
  filtros: { sucursal: string; repartidor: string },
): DefinicionExcel {
  const filas: FilaExcel[] = [];
  for (const dia of r.dias) {
    for (const v of dia.ventas) {
      filas.push({
        celdas: [
          v.fecha,
          v.folio,
          v.cliente,
          v.numNota ?? "",
          nombreRepartidor(v.repartidor),
          ETIQUETA_STATUS[v.status],
          v.factura,
          v.semana,
          v.cantidad,
          v.promocion,
          pesos(v.montoCentavos),
        ],
      });
    }
    filas.push({
      tipo: "subtotal",
      celdas: [`Total ${formatearFecha(dia.fecha)}`, ...vacias(7), dia.subtotal.cantidad, dia.subtotal.promocion, pesos(dia.subtotal.montoCentavos)],
    });
  }
  filas.push({
    tipo: "total",
    celdas: ["TOTAL", ...vacias(7), r.total.cantidad, r.total.promocion, pesos(r.total.montoCentavos)],
  });
  filas.push({ celdas: vacias(11) });
  filas.push({ tipo: "grupo", celdas: ["Resumen por repartidor", ...vacias(10)] });
  for (const p of r.porRepartidor) {
    filas.push({
      celdas: [
        null,
        null,
        `${nombreRepartidor(p.repartidor)} (${p.ventas} ${p.ventas === 1 ? "venta" : "ventas"})`,
        ...vacias(5),
        p.cantidad,
        p.promocion,
        pesos(p.montoCentavos),
      ],
    });
  }

  return {
    titulo: "Reporte de Ventas",
    filtros: [
      ["Rango", `${formatearFecha(r.desde)} a ${formatearFecha(r.hasta)}`],
      ["Sucursal", filtros.sucursal],
      ["Repartidor", filtros.repartidor],
    ],
    columnas: [
      { encabezado: "Fecha", tipo: "fecha", ancho: 12 },
      { encabezado: "Folio", tipo: "texto", ancho: 16 },
      { encabezado: "Cliente", tipo: "texto", ancho: 32 },
      { encabezado: "# nota", tipo: "texto", ancho: 10 },
      { encabezado: "Repartidor", tipo: "texto", ancho: 24 },
      { encabezado: "Status", tipo: "texto", ancho: 15 },
      { encabezado: "Factura", tipo: "texto", ancho: 14 },
      { encabezado: "Semana", tipo: "numero", ancho: 9 },
      { encabezado: "Cantidad", tipo: "numero", ancho: 11 },
      { encabezado: "Promo", tipo: "numero", ancho: 9 },
      { encabezado: "Monto", tipo: "pesos", ancho: 14 },
    ],
    filas,
    nombreArchivo: `reporte-ventas_${r.desde}_a_${r.hasta}`,
  };
}

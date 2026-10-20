import { apiFetch } from "./api";
import type { DefinicionExcel, FilaExcel } from "./excel/definicion";
import { formatearFecha } from "./reportes";
import { formatearPesos } from "./ventas";

// Copia de las formas de apps/backend/src/modules/flujo-efectivo/ (reglas-flujo.ts y
// flujo-efectivo.service.ts): el portal no puede importar del backend. Dinero en centavos enteros.

export interface DiaFlujo {
  fecha: string;
  ventasCentavos: number;
  cobradoRepartidorCentavos: number;
  cobradoOficinaCentavos: number;
  porcentajeCobro: number | null;
}

export interface ComentarioIngreso {
  fecha: string;
  folio: string;
  cliente: string;
  comentario: string;
}

export interface ComentarioEgreso {
  fecha: string;
  concepto: "Retiro" | "Traspaso" | "Gasto";
  cuenta: string;
  montoCentavos: number;
  comentario: string;
}

export interface FlujoEfectivo {
  desde: string;
  hasta: string;
  ventasTotalesCentavos: number;
  cobradoRepartidorCentavos: number;
  cobradoOficinaCentavos: number;
  ventasCobradasCentavos: number;
  porcentajeCobro: number | null;
  gastosDisponibles: boolean;
  gastosProduccionCentavos: number;
  gastosOperacionCentavos: number;
  gastosFinancierosCentavos: number;
  utilidadBrutaCentavos: number;
  utilidadOperacionCentavos: number;
  utilidadNetaCentavos: number;
  dias: DiaFlujo[];
  totalTesoreriaCentavos: number;
  tesoreriaCuentasConSaldo: number;
  tesoreriaCuentas: number;
  comentarios: { ingresos: ComentarioIngreso[]; egresos: ComentarioEgreso[] };
}

export const NOTA_SIN_GASTOS = "sin gastos registrados todavía";

export function obtenerFlujoEfectivo(p: {
  desde: string;
  hasta: string;
  sucursal?: string | null;
}): Promise<FlujoEfectivo> {
  const q = new URLSearchParams({ desde: p.desde, hasta: p.hasta });
  if (p.sucursal) q.set("sucursal", p.sucursal);
  return apiFetch<FlujoEfectivo>(`/flujo-efectivo?${q.toString()}`);
}

/** `87.5` -> `"87.5%"`; sin ventas (`null`) -> `"—"`. */
export function formatearPorcentaje(p: number | null): string {
  return p === null ? "—" : `${p}%`;
}

const pesos = (centavos: number): number => centavos / 100;

/**
 * Una hoja de tres columnas (Concepto | Monto | Detalle). El "Desglose por día" reutiliza las
 * mismas tres: fecha, ventas del día y, en Detalle, "Rep $x · Of $y · z%".
 */
export function definicionExcelFlujo(f: FlujoEfectivo, filtros: { sucursal: string }): DefinicionExcel {
  const sinGastos = f.gastosDisponibles ? "" : NOTA_SIN_GASTOS;
  const cuentas =
    f.tesoreriaCuentasConSaldo < f.tesoreriaCuentas
      ? `${f.tesoreriaCuentasConSaldo} de ${f.tesoreriaCuentas} cuentas con saldo`
      : "";
  const linea = (concepto: string, centavos: number, detalle = ""): FilaExcel => ({
    celdas: [concepto, pesos(centavos), detalle],
  });
  const filas: FilaExcel[] = [
    linea("Ventas Totales", f.ventasTotalesCentavos),
    linea("Ventas Repartidor", f.cobradoRepartidorCentavos),
    linea("Ventas Oficinas", f.cobradoOficinaCentavos),
    linea("Ventas Cobradas", f.ventasCobradasCentavos),
    { celdas: ["% de Cobro", null, formatearPorcentaje(f.porcentajeCobro)] },
    linea("Gastos de Producción", f.gastosProduccionCentavos, sinGastos),
    { tipo: "subtotal", celdas: ["Utilidad Bruta", pesos(f.utilidadBrutaCentavos), ""] },
    linea("Gastos Operativos", f.gastosOperacionCentavos, sinGastos),
    { tipo: "subtotal", celdas: ["Utilidad de Operación", pesos(f.utilidadOperacionCentavos), ""] },
    linea("Gastos Financieros", f.gastosFinancierosCentavos, sinGastos),
    { tipo: "subtotal", celdas: ["Utilidad Neta", pesos(f.utilidadNetaCentavos), ""] },
    { tipo: "total", celdas: ["Total Tesorería", pesos(f.totalTesoreriaCentavos), cuentas] },
    { celdas: [null, null, null] },
    { tipo: "grupo", celdas: ["Desglose por día", null, null] },
  ];
  for (const d of f.dias) {
    filas.push({
      celdas: [
        formatearFecha(d.fecha),
        pesos(d.ventasCentavos),
        `Rep ${formatearPesos(d.cobradoRepartidorCentavos)} · Of ${formatearPesos(d.cobradoOficinaCentavos)} · ${formatearPorcentaje(d.porcentajeCobro)}`,
      ],
    });
  }
  filas.push({ celdas: [null, null, null] });
  filas.push({ tipo: "grupo", celdas: ["Comentarios de ingresos", null, null] });
  if (f.comentarios.ingresos.length === 0) filas.push({ celdas: ["Sin comentarios en el rango.", null, null] });
  for (const c of f.comentarios.ingresos) {
    filas.push({ celdas: [`${formatearFecha(c.fecha)} · ${c.folio}`, null, `${c.cliente}: ${c.comentario}`] });
  }
  filas.push({ celdas: [null, null, null] });
  filas.push({ tipo: "grupo", celdas: ["Comentarios de egresos", null, null] });
  if (f.comentarios.egresos.length === 0) filas.push({ celdas: ["Sin comentarios en el rango.", null, null] });
  for (const c of f.comentarios.egresos) {
    filas.push({
      celdas: [`${formatearFecha(c.fecha)} · ${c.concepto} · ${c.cuenta}`, pesos(c.montoCentavos), c.comentario],
    });
  }

  return {
    titulo: "Flujo de Efectivo",
    filtros: [
      ["Rango", `${formatearFecha(f.desde)} a ${formatearFecha(f.hasta)}`],
      ["Sucursal", filtros.sucursal],
    ],
    columnas: [
      { encabezado: "Concepto", tipo: "texto", ancho: 40 },
      { encabezado: "Monto", tipo: "pesos", ancho: 16 },
      { encabezado: "Detalle", tipo: "texto", ancho: 60 },
    ],
    filas,
    nombreArchivo: `flujo-efectivo-${f.desde}-a-${f.hasta}`,
  };
}

// apps/portal/src/lib/excel/construir-libro.ts
import type { Borders, Fill } from "exceljs";
import type { Celda, ColumnaExcel, DefinicionExcel } from "./definicion";

type ModuloExcelJS = typeof import("exceljs");

/**
 * `exceljs` pesa ~1 MB: se carga SOLO al exportar, no con cada pantalla.
 * Es CommonJS: segun quien lo empaquete (Next en el navegador, Vitest en
 * Node) llega con o sin `default`.
 */
export async function cargarExcelJS(): Promise<ModuloExcelJS> {
  const modulo = (await import("exceljs")) as ModuloExcelJS & {
    default?: ModuloExcelJS;
  };
  return modulo.default ?? modulo;
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RELLENO_ENCABEZADO: Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
const RELLENO_RESALTADA: Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
const BORDE_ARRIBA: Partial<Borders> = { top: { style: "thin" } };

function formato(col: ColumnaExcel): string | undefined {
  switch (col.tipo) {
    case "numero": {
      const decimales = col.decimales ?? 0;
      return decimales > 0 ? `#,##0.${"0".repeat(decimales)}` : "#,##0";
    }
    case "pesos":
      return '"$"#,##0.00';
    case "fecha":
      return "dd/mm/yyyy";
    default:
      return undefined;
  }
}

/** Una fecha `AAAA-MM-DD` va como fecha de Excel (medianoche UTC: sin corrimiento de dia). */
function aValor(celda: Celda, col: ColumnaExcel | undefined): string | number | Date | null {
  if (col?.tipo === "fecha" && typeof celda === "string" && RE_FECHA.test(celda)) {
    return new Date(`${celda}T00:00:00Z`);
  }
  return celda;
}

/** El `.xlsx` como `ArrayBuffer`, sin tocar el DOM (se prueba en Node). */
export async function construirLibro(def: DefinicionExcel): Promise<ArrayBuffer> {
  const ExcelJS = await cargarExcelJS();
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Reporte");

  hoja.columns = def.columnas.map((c) => ({
    width: c.ancho ?? Math.max(12, c.encabezado.length + 2),
  }));

  const titulo = hoja.addRow([def.titulo]);
  titulo.getCell(1).font = { bold: true, size: 14 };
  for (const [etiqueta, valor] of def.filtros) {
    hoja.addRow([`${etiqueta}: ${valor}`]);
  }
  hoja.addRow([]);

  const encabezados = hoja.addRow(def.columnas.map((c) => c.encabezado));
  encabezados.eachCell((celda) => {
    celda.font = { bold: true };
    celda.fill = RELLENO_ENCABEZADO;
  });
  hoja.views = [{ state: "frozen", ySplit: encabezados.number }];

  for (const fila of def.filas) {
    const renglon = hoja.addRow(fila.celdas.map((c, i) => aValor(c, def.columnas[i])));
    def.columnas.forEach((col, i) => {
      const celda = renglon.getCell(i + 1);
      const numFmt = formato(col);
      if (numFmt) celda.numFmt = numFmt;
      if (fila.tipo && fila.tipo !== "normal") celda.font = { bold: true };
      if (fila.tipo === "subtotal" || fila.tipo === "total") celda.border = BORDE_ARRIBA;
      if (fila.resaltada) celda.fill = RELLENO_RESALTADA;
    });
  }

  // En Node `writeBuffer` da un Buffer y en el navegador un ArrayBuffer;
  // `new Uint8Array(...)` deja en los dos un ArrayBuffer propio y completo.
  return new Uint8Array(await libro.xlsx.writeBuffer()).buffer as ArrayBuffer;
}

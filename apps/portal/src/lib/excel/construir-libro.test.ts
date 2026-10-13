// apps/portal/src/lib/excel/construir-libro.test.ts
// @vitest-environment node
// En jsdom, `exceljs` (version de Node) no siempre se lleva con los Blob/Buffer
// del entorno; el libro no toca el DOM, asi que se prueba en Node.
import { describe, expect, it } from "vitest";
import { cargarExcelJS, construirLibro } from "./construir-libro";
import type { DefinicionExcel } from "./definicion";

const DEF: DefinicionExcel = {
  titulo: "Reporte de prueba",
  filtros: [
    ["Rango", "01/10/2026 a 13/10/2026"],
    ["Sucursal", "TJ"],
  ],
  columnas: [
    { encabezado: "Fecha", tipo: "fecha", ancho: 12 },
    { encabezado: "Vendedor", tipo: "texto", ancho: 24 },
    { encabezado: "Km", tipo: "numero", decimales: 1 },
    { encabezado: "Monto", tipo: "pesos" },
  ],
  filas: [
    { tipo: "grupo", celdas: ["Nissan-01", null, null, null] },
    { celdas: ["2026-10-01", "Juan Pérez", 10250.5, 1500] },
    { celdas: ["2026-10-02", "Pedro López", 120, null], resaltada: true },
    { tipo: "subtotal", celdas: ["Total Nissan-01", null, 10370.5, 1500] },
    { tipo: "total", celdas: ["Total general", null, 10370.5, 1500] },
  ],
  nombreArchivo: "prueba",
};

async function leer(def: DefinicionExcel) {
  const ExcelJS = await cargarExcelJS();
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await construirLibro(def));
  const hoja = libro.worksheets[0];
  if (!hoja) throw new Error("El libro no trae hoja.");
  return hoja;
}

describe("construirLibro", () => {
  it("pone titulo, filtros y encabezados congelados en negrita con fondo gris", async () => {
    const hoja = await leer(DEF);
    expect(hoja.getCell("A1").value).toBe("Reporte de prueba");
    expect(hoja.getCell("A1").font?.bold).toBe(true);
    expect(hoja.getCell("A2").value).toBe("Rango: 01/10/2026 a 13/10/2026");
    expect(hoja.getCell("A3").value).toBe("Sucursal: TJ");
    // Fila 4 en blanco; encabezados en la 5.
    expect(hoja.getRow(5).values).toEqual([undefined, "Fecha", "Vendedor", "Km", "Monto"]);
    expect(hoja.getCell("A5").font?.bold).toBe(true);
    expect(hoja.getCell("A5").fill).toMatchObject({ pattern: "solid", fgColor: { argb: "FFE5E7EB" } });
    expect(hoja.views[0]).toMatchObject({ state: "frozen", ySplit: 5 });
    expect(hoja.getColumn(1).width).toBe(12);
    expect(hoja.getColumn(3).width).toBe(12); // "Km" + 2 < 12: minimo
  });

  it("escribe numeros como numeros, fechas como fechas y cada formato", async () => {
    const hoja = await leer(DEF);
    const fecha = hoja.getCell("A7").value;
    expect(fecha).toBeInstanceOf(Date);
    expect((fecha as Date).toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(hoja.getCell("A7").numFmt).toBe("dd/mm/yyyy");
    expect(hoja.getCell("C7").value).toBe(10250.5);
    expect(typeof hoja.getCell("C7").value).toBe("number");
    expect(hoja.getCell("C7").numFmt).toBe("#,##0.0");
    expect(hoja.getCell("D7").numFmt).toBe('"$"#,##0.00');
    expect(hoja.getCell("D8").value).toBeNull();
  });

  it("negrita en grupo, subtotal y total; borde arriba en subtotal y total; resaltada en amarillo", async () => {
    const hoja = await leer(DEF);
    expect(hoja.getCell("A6").font?.bold).toBe(true); // grupo
    expect(hoja.getCell("A6").value).toBe("Nissan-01");
    expect(hoja.getCell("B8").fill).toMatchObject({ fgColor: { argb: "FFFEF3C7" } });
    const sinResaltar = hoja.getCell("A7").fill as { fgColor?: { argb?: string } } | undefined;
    expect(sinResaltar?.fgColor?.argb).not.toBe("FFFEF3C7");
    expect(hoja.getCell("A9").value).toBe("Total Nissan-01"); // texto en columna de fecha
    expect(hoja.getCell("C9").font?.bold).toBe(true);
    expect(hoja.getCell("C9").border?.top?.style).toBe("thin");
    expect(hoja.getCell("C10").font?.bold).toBe(true);
    expect(hoja.getCell("C10").border?.top?.style).toBe("thin");
  });
});

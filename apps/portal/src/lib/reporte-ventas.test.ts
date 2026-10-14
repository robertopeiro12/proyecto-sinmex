import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  definicionExcelReporteVentas,
  formatearPiezas,
  nombreRepartidor,
  obtenerReporteVentas,
  rangoMes,
  rangoSemana,
  type ReporteVentas,
} from "./reporte-ventas";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

const REPORTE: ReporteVentas = {
  desde: "2026-10-13",
  hasta: "2026-10-14",
  dias: [
    {
      fecha: "2026-10-13",
      ventas: [
        { id: "a", fecha: "2026-10-13", folio: "TJ261013AP01", cliente: "Cobach XXI", numNota: null, repartidor: "Juan Pérez", status: "pagada", factura: "N/A", semana: 42, cantidad: 20, promocion: 2, montoCentavos: 13000 },
        { id: "b", fecha: "2026-10-13", folio: "TJ261013OF01", cliente: "El Moreno", numNota: "345", repartidor: null, status: "pendiente", factura: "A780", semana: 42, cantidad: 12, promocion: 0, montoCentavos: 7850 },
      ],
      subtotal: { ventas: 2, cantidad: 32, promocion: 2, montoCentavos: 20850 },
    },
  ],
  porRepartidor: [
    { vendedorId: "j", repartidor: "Juan Pérez", ventas: 1, cantidad: 20, promocion: 2, montoCentavos: 13000 },
    { vendedorId: null, repartidor: null, ventas: 1, cantidad: 12, promocion: 0, montoCentavos: 7850 },
  ],
  total: { ventas: 2, cantidad: 32, promocion: 2, montoCentavos: 20850 },
};

describe("obtenerReporteVentas", () => {
  beforeEach(() => apiFetch.mockReset());

  it("manda rango y omite sucursal y repartidor si no hay", async () => {
    apiFetch.mockResolvedValue(REPORTE);
    await obtenerReporteVentas({ desde: "2026-10-01", hasta: "2026-10-14", sucursal: null, repartidor: null });
    expect(apiFetch).toHaveBeenCalledWith("/reportes/ventas?desde=2026-10-01&hasta=2026-10-14");
  });

  it("agrega sucursal y repartidor", async () => {
    apiFetch.mockResolvedValue(REPORTE);
    await obtenerReporteVentas({ desde: "2026-10-01", hasta: "2026-10-14", sucursal: "TJ", repartidor: "oficina" });
    expect(apiFetch).toHaveBeenCalledWith("/reportes/ventas?desde=2026-10-01&hasta=2026-10-14&sucursal=TJ&repartidor=oficina");
  });
});

describe("atajos de rango (Review Focus 3)", () => {
  it("rangoSemana: lunes a domingo", () => {
    expect(rangoSemana("2026-10-14")).toEqual({ desde: "2026-10-12", hasta: "2026-10-18" }); // miércoles
    expect(rangoSemana("2026-10-12")).toEqual({ desde: "2026-10-12", hasta: "2026-10-18" }); // lunes
    expect(rangoSemana("2026-10-18")).toEqual({ desde: "2026-10-12", hasta: "2026-10-18" }); // domingo
    expect(rangoSemana("2026-11-01")).toEqual({ desde: "2026-10-26", hasta: "2026-11-01" }); // domingo, cambio de mes
    expect(rangoSemana("2026-12-31")).toEqual({ desde: "2026-12-28", hasta: "2027-01-03" }); // cambio de año
  });

  it("rangoMes: del 1 al último día, febrero incluido", () => {
    expect(rangoMes("2026-10-14")).toEqual({ desde: "2026-10-01", hasta: "2026-10-31" });
    expect(rangoMes("2026-02-03")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(rangoMes("2028-02-29")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
    expect(rangoMes("2026-04-30")).toEqual({ desde: "2026-04-01", hasta: "2026-04-30" });
  });
});

describe("nombreRepartidor", () => {
  it("null es Oficina", () => {
    expect(nombreRepartidor(null)).toBe("Oficina");
    expect(nombreRepartidor("Juan Pérez")).toBe("Juan Pérez");
  });
});

describe("definicionExcelReporteVentas", () => {
  it("ventas, subtotal por día, TOTAL y resumen por repartidor, en pesos", () => {
    const def = definicionExcelReporteVentas(REPORTE, { sucursal: "TJ", repartidor: "Todos" });
    expect(def.titulo).toBe("Reporte de Ventas");
    expect(def.filtros).toEqual([
      ["Rango", "13/10/2026 a 14/10/2026"],
      ["Sucursal", "TJ"],
      ["Repartidor", "Todos"],
    ]);
    expect(def.columnas.map((c) => c.encabezado)).toEqual([
      "Fecha", "Folio", "Cliente", "# nota", "Repartidor", "Status", "Factura", "Semana", "Cantidad", "Promo", "Monto",
    ]);
    expect(def.columnas.map((c) => c.tipo)).toEqual([
      "fecha", "texto", "texto", "texto", "texto", "texto", "texto", "numero", "numero", "numero", "pesos",
    ]);
    expect(def.filas).toEqual([
      { celdas: ["2026-10-13", "TJ261013AP01", "Cobach XXI", "", "Juan Pérez", "Pagada", "N/A", 42, 20, 2, 130] },
      { celdas: ["2026-10-13", "TJ261013OF01", "El Moreno", "345", "Oficina", "Pendiente", "A780", 42, 12, 0, 78.5] },
      { tipo: "subtotal", celdas: ["Total 13/10/2026", null, null, null, null, null, null, null, 32, 2, 208.5] },
      { tipo: "total", celdas: ["TOTAL", null, null, null, null, null, null, null, 32, 2, 208.5] },
      { celdas: [null, null, null, null, null, null, null, null, null, null, null] },
      { tipo: "grupo", celdas: ["Resumen por repartidor", null, null, null, null, null, null, null, null, null, null] },
      { celdas: [null, null, "Juan Pérez (1 venta)", null, null, null, null, null, 20, 2, 130] },
      { celdas: [null, null, "Oficina (1 venta)", null, null, null, null, null, 12, 0, 78.5] },
    ]);
    expect(def.nombreArchivo).toBe("reporte-ventas_2026-10-13_a_2026-10-14");
  });

  it("plural en el resumen", () => {
    const def = definicionExcelReporteVentas(
      { ...REPORTE, porRepartidor: [{ ...REPORTE.porRepartidor[0], ventas: 3 }] },
      { sucursal: "Todas", repartidor: "Juan Pérez" },
    );
    expect(def.filas.at(-1)?.celdas[2]).toBe("Juan Pérez (3 ventas)");
  });
});

describe("formatearPiezas", () => {
  it("separa los miles con coma", () => {
    expect(formatearPiezas(0)).toBe("0");
    expect(formatearPiezas(999)).toBe("999");
    expect(formatearPiezas(12345)).toBe("12,345");
    expect(formatearPiezas(1234567)).toBe("1,234,567");
  });
});

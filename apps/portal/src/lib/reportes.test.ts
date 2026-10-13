import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  definicionExcelKilometraje,
  etiquetaSucursal,
  etiquetaVehiculo,
  explicarSalto,
  formatearFecha,
  formatearKm,
  formatearSalto,
  obtenerReporteKilometraje,
  primerDiaDelMes,
  type ReporteKilometraje,
} from "./reportes";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

const REPORTE: ReporteKilometraje = {
  desde: "2026-10-01",
  hasta: "2026-10-13",
  vehiculos: [
    {
      vehiculoId: "v1",
      nombre: "Nissan-01",
      placas: "ABC-123",
      activo: true,
      jornadas: [
        { jornadaId: "j1", fecha: "2026-10-01", vendedor: "Juan Pérez", kmInicialDecimas: 100000, kmFinalDecimas: 102505, kilometrosDecimas: 2505, saltoDecimas: null, fechaAnterior: null },
        { jornadaId: "j2", fecha: "2026-10-02", vendedor: "Pedro López", kmInicialDecimas: 104000, kmFinalDecimas: 105200, kilometrosDecimas: 1200, saltoDecimas: 1495, fechaAnterior: "2026-10-01" },
      ],
      totalKilometrosDecimas: 3705,
      totalSaltoDecimas: 1495,
    },
  ],
  totalKilometrosDecimas: 3705,
  totalSaltoDecimas: 1495,
};

describe("obtenerReporteKilometraje", () => {
  beforeEach(() => apiFetch.mockReset());

  it("manda rango y omite vehiculo y sucursal si no hay", async () => {
    apiFetch.mockResolvedValue(REPORTE);
    await obtenerReporteKilometraje({ desde: "2026-10-01", hasta: "2026-10-13", vehiculoId: null, sucursal: null });
    expect(apiFetch).toHaveBeenCalledWith("/reportes/kilometraje?desde=2026-10-01&hasta=2026-10-13");
  });

  it("agrega vehiculo y sucursal", async () => {
    apiFetch.mockResolvedValue(REPORTE);
    await obtenerReporteKilometraje({ desde: "2026-10-01", hasta: "2026-10-13", vehiculoId: "v1", sucursal: "TJ" });
    expect(apiFetch).toHaveBeenCalledWith(
      "/reportes/kilometraje?desde=2026-10-01&hasta=2026-10-13&vehiculo=v1&sucursal=TJ",
    );
  });
});

describe("formatos", () => {
  it("formatearKm: miles con coma y un decimal (Review Focus 3)", () => {
    expect(formatearKm(100005)).toBe("10,000.5");
    expect(formatearKm(0)).toBe("0.0");
    expect(formatearKm(-300)).toBe("−30.0");
  });

  it("formatearSalto: vacio sin salto, con signo si lo hay", () => {
    expect(formatearSalto(null)).toBe("");
    expect(formatearSalto(0)).toBe("");
    expect(formatearSalto(1500)).toBe("+150.0");
    expect(formatearSalto(-300)).toBe("−30.0");
  });

  it("formatearFecha y primerDiaDelMes", () => {
    expect(formatearFecha("2026-10-02")).toBe("02/10/2026");
    expect(primerDiaDelMes("2026-10-13")).toBe("2026-10-01");
  });

  it("explicarSalto solo cuando hay salto", () => {
    expect(explicarSalto(REPORTE.vehiculos[0].jornadas[0])).toBeUndefined();
    expect(explicarSalto(REPORTE.vehiculos[0].jornadas[1])).toBe(
      "Empezó 149.5 km distinto a como terminó la jornada anterior de este vehículo (01/10/2026).",
    );
  });

  it("etiquetas de vehiculo y sucursal", () => {
    expect(etiquetaVehiculo({ nombre: "Nissan-01", placas: "ABC-123", activo: true })).toBe("Nissan-01 (ABC-123)");
    expect(etiquetaVehiculo({ nombre: "Vieja", placas: null, activo: false })).toBe("Vieja (desactivado)");
    expect(etiquetaSucursal("TJ", null)).toBe("TJ");
    expect(etiquetaSucursal(null, "MX")).toBe("MX");
    expect(etiquetaSucursal(null, "todas")).toBe("Todas");
    expect(etiquetaSucursal(null, null)).toBe("Todas");
  });
});

describe("definicionExcelKilometraje", () => {
  it("arma titulo, filtros aplicados, columnas y filas con grupo, subtotal, total y salto resaltado", () => {
    const def = definicionExcelKilometraje(REPORTE, { sucursal: "TJ", vehiculo: "Todos" });
    expect(def.titulo).toBe("Reporte de Kilometraje");
    expect(def.filtros).toEqual([
      ["Rango", "01/10/2026 a 13/10/2026"],
      ["Sucursal", "TJ"],
      ["Vehículo", "Todos"],
    ]);
    expect(def.columnas.map((c) => c.encabezado)).toEqual(["Fecha", "Vendedor", "Km inicial", "Km final", "Kilómetros", "Salto"]);
    expect(def.nombreArchivo).toBe("kilometraje_2026-10-01_a_2026-10-13");
    expect(def.filas).toEqual([
      { tipo: "grupo", celdas: ["Nissan-01 (ABC-123)", null, null, null, null, null] },
      { celdas: ["2026-10-01", "Juan Pérez", 10000, 10250.5, 250.5, null], resaltada: false },
      { celdas: ["2026-10-02", "Pedro López", 10400, 10520, 120, 149.5], resaltada: true },
      { tipo: "subtotal", celdas: ["Total Nissan-01 (ABC-123)", null, null, null, 370.5, 149.5] },
      { tipo: "total", celdas: ["Total general", null, null, null, 370.5, 149.5] },
    ]);
  });
});

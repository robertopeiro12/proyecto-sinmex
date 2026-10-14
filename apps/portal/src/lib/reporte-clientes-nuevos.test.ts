import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  definicionExcelClientesNuevos,
  nombreConBaja,
  obtenerReporteClientesNuevos,
  textoTotalClientes,
  type ReporteClientesNuevos,
} from "./reporte-clientes-nuevos";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

const REPORTE: ReporteClientesNuevos = {
  desde: "2026-10-01",
  hasta: "2026-10-14",
  clientes: [
    { id: "1", fechaAlta: "2026-10-03", nombre: "Cobach XXI", sucursalCodigo: "TJ", tipoNegocio: "Escuela", listaPrecio: "Lista 1", telefono: "6640000001", encargado: "Lupita", usuario: "Ana Admin", dadoDeBaja: false },
    { id: "2", fechaAlta: "2026-10-09", nombre: "Abarrotes Cerrado", sucursalCodigo: "TJ", tipoNegocio: null, listaPrecio: null, telefono: "6640000002", encargado: null, usuario: null, dadoDeBaja: true },
  ],
  total: 2,
};

describe("obtenerReporteClientesNuevos", () => {
  beforeEach(() => apiFetch.mockReset());
  it("manda rango y sucursal si hay", async () => {
    apiFetch.mockResolvedValue(REPORTE);
    await obtenerReporteClientesNuevos({ desde: "2026-10-01", hasta: "2026-10-14", sucursal: null });
    expect(apiFetch).toHaveBeenLastCalledWith("/reportes/clientes-nuevos?desde=2026-10-01&hasta=2026-10-14");
    await obtenerReporteClientesNuevos({ desde: "2026-10-01", hasta: "2026-10-14", sucursal: "TJ" });
    expect(apiFetch).toHaveBeenLastCalledWith("/reportes/clientes-nuevos?desde=2026-10-01&hasta=2026-10-14&sucursal=TJ");
  });
});

describe("textos", () => {
  it("nombreConBaja y textoTotalClientes", () => {
    expect(nombreConBaja({ nombre: "X", dadoDeBaja: false })).toBe("X");
    expect(nombreConBaja({ nombre: "X", dadoDeBaja: true })).toBe("X (dado de baja)");
    expect(textoTotalClientes(0)).toBe("0 clientes nuevos");
    expect(textoTotalClientes(1)).toBe("1 cliente nuevo");
    expect(textoTotalClientes(12)).toBe("12 clientes nuevos");
  });
});

describe("definicionExcelClientesNuevos", () => {
  it("8 columnas, — para vacíos, total al final", () => {
    const def = definicionExcelClientesNuevos(REPORTE, { sucursal: "TJ" });
    expect(def.titulo).toBe("Clientes nuevos");
    expect(def.filtros).toEqual([["Rango", "01/10/2026 a 14/10/2026"], ["Sucursal", "TJ"]]);
    expect(def.columnas.map((c) => c.encabezado)).toEqual([
      "Fecha de alta", "Cliente", "Sucursal", "Tipo de negocio", "Lista de precios", "Teléfono", "Encargado", "Usuario",
    ]);
    expect(def.columnas[0].tipo).toBe("fecha");
    expect(def.filas).toEqual([
      { celdas: ["2026-10-03", "Cobach XXI", "TJ", "Escuela", "Lista 1", "6640000001", "Lupita", "Ana Admin"] },
      { celdas: ["2026-10-09", "Abarrotes Cerrado (dado de baja)", "TJ", "—", "—", "6640000002", "—", "—"] },
      { tipo: "total", celdas: ["Total: 2 clientes nuevos", null, null, null, null, null, null, null] },
    ]);
    expect(def.nombreArchivo).toBe("clientes-nuevos_2026-10-01_a_2026-10-14");
  });
});

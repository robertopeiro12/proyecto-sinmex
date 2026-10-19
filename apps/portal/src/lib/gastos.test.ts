import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { descargarFotoGasto, etiquetaVendedorGasto, horaEnTijuana, obtenerGastos } from "./gastos";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn(), apiFetchBlob: vi.fn() };
});

describe("obtenerGastos", () => {
  beforeEach(() => vi.clearAllMocks());

  it("arma la query con los filtros que vienen y omite los vacíos", async () => {
    vi.mocked(api.apiFetch).mockResolvedValue({ desde: "2026-10-20", hasta: "2026-10-20", gastos: [], totalCentavos: 0 });
    await obtenerGastos({ desde: "2026-10-01", hasta: "2026-10-20", sucursal: "TJ", vendedor: "v1", campo: null });
    expect(api.apiFetch).toHaveBeenCalledWith("/gastos?desde=2026-10-01&hasta=2026-10-20&sucursal=TJ&vendedor=v1");
    await obtenerGastos({ desde: "2026-10-01", hasta: "2026-10-01", sucursal: null, vendedor: null, campo: "c1" });
    expect(api.apiFetch).toHaveBeenLastCalledWith("/gastos?desde=2026-10-01&hasta=2026-10-01&campo=c1");
  });

  it("la foto se baja como blob de /gastos/:id/foto", async () => {
    vi.mocked(api.apiFetchBlob).mockResolvedValue(new Blob(["x"]));
    await descargarFotoGasto("g1");
    expect(api.apiFetchBlob).toHaveBeenCalledWith("/gastos/g1/foto");
  });
});

describe("horaEnTijuana", () => {
  it("pinta la hora de Tijuana, no la de UTC ni la del navegador", () => {
    // 01:30 UTC del 21 es 18:30 del 20 en Tijuana (horario de verano, UTC−7).
    expect(horaEnTijuana("2026-10-21T01:30:00.000Z")).toBe("18:30");
    // En noviembre ya es UTC−8.
    expect(horaEnTijuana("2026-11-20T16:05:00.000Z")).toBe("08:05");
  });
});

describe("etiquetaVendedorGasto", () => {
  it("un gasto sin vendedor es de la oficina", () => {
    expect(etiquetaVendedorGasto({ vendedorNombre: "Juan Pérez" })).toBe("Juan Pérez");
    expect(etiquetaVendedorGasto({ vendedorNombre: null })).toBe("Oficina");
  });
});

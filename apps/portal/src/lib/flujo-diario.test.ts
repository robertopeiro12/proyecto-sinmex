import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  agruparPorSucursal,
  etiquetaLiquidada,
  etiquetaRutaAsignada,
  obtenerDashboard,
  obtenerDetalleDashboard,
  obtenerDetalleDia,
  obtenerDetalleVendedor,
  obtenerFlujoDiario,
  type PagoDetalle,
} from "./flujo-diario";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

const pago = (saldo: number): PagoDetalle => ({
  folio: "TJ261013AP01",
  cliente: "Cobach XXI",
  montoCentavos: 5000,
  metodo: "efectivo",
  saldoPendienteCentavos: saldo,
  liquidada: saldo === 0,
});

describe("etiquetaRutaAsignada", () => {
  it("pluraliza y cubre sin ruta", () => {
    expect(etiquetaRutaAsignada(16)).toBe("Ruta del día · 16 clientes");
    expect(etiquetaRutaAsignada(1)).toBe("Ruta del día · 1 cliente");
    expect(etiquetaRutaAsignada(0)).toBe("Sin ruta");
  });
});

describe("etiquetaLiquidada", () => {
  it("abonado resta lo que falta", () => {
    expect(etiquetaLiquidada(pago(15000))).toEqual({
      texto: "Abonado",
      resta: "$150.00",
    });
  });
  it("saldo 0 es Sí", () => {
    expect(etiquetaLiquidada(pago(0))).toEqual({ texto: "Sí", resta: null });
  });
});

describe("agruparPorSucursal", () => {
  it("respeta el orden de llegada", () => {
    const g = agruparPorSucursal([
      { sucursalCodigo: "TJ", n: 1 },
      { sucursalCodigo: "TJ", n: 2 },
      { sucursalCodigo: "MX", n: 3 },
    ]);
    expect(g.map((x) => x.sucursalCodigo)).toEqual(["TJ", "MX"]);
    expect(g[0].filas).toHaveLength(2);
  });
});

describe("fetchers", () => {
  beforeEach(() => apiFetch.mockReset());

  it("obtenerFlujoDiario arma la consulta", async () => {
    apiFetch.mockResolvedValue({});
    await obtenerFlujoDiario({
      desde: "2026-11-01",
      hasta: "2026-11-09",
      sucursal: "MX",
      vendedor: "v1",
    });
    expect(apiFetch).toHaveBeenCalledWith(
      "/reportes/flujo-diario?desde=2026-11-01&hasta=2026-11-09&sucursal=MX&vendedor=v1",
    );
  });
  it("omite los nulos", async () => {
    apiFetch.mockResolvedValue({});
    await obtenerFlujoDiario({
      desde: "a",
      hasta: "b",
      sucursal: null,
      vendedor: null,
    });
    expect(apiFetch).toHaveBeenCalledWith(
      "/reportes/flujo-diario?desde=a&hasta=b",
    );
  });
  it("detalle por vendedor y por día", async () => {
    apiFetch.mockResolvedValue({});
    await obtenerDetalleVendedor({
      fecha: "2026-11-09",
      vendedor: "v1",
      sucursal: null,
    });
    expect(apiFetch).toHaveBeenLastCalledWith(
      "/reportes/flujo-diario/vendedor?fecha=2026-11-09&vendedor=v1",
    );
    await obtenerDetalleDia({
      fecha: "2026-11-09",
      sucursal: "TJ",
      vendedor: null,
    });
    expect(apiFetch).toHaveBeenLastCalledWith(
      "/reportes/flujo-diario/dia?fecha=2026-11-09&sucursal=TJ",
    );
    await obtenerDetalleDia({
      fecha: "2026-11-09",
      sucursal: "TJ",
      vendedor: "v1",
    });
    expect(apiFetch).toHaveBeenLastCalledWith(
      "/reportes/flujo-diario/dia?fecha=2026-11-09&sucursal=TJ&vendedor=v1",
    );
  });
  it("dashboard", async () => {
    apiFetch.mockResolvedValue({});
    await obtenerDashboard(null);
    expect(apiFetch).toHaveBeenLastCalledWith("/dashboard");
    await obtenerDashboard("TJ");
    expect(apiFetch).toHaveBeenLastCalledWith("/dashboard?sucursal=TJ");
    await obtenerDetalleDashboard({
      vendedor: "v1",
      sucursal: "MX",
      fecha: "2026-11-09",
    });
    expect(apiFetch).toHaveBeenLastCalledWith(
      "/dashboard/vendedor?vendedor=v1&sucursal=MX&fecha=2026-11-09",
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import {
  gruposInformacion,
  leerDetalleInformacion,
  leerInformacionProduccion,
  textoRango,
  totalInformacion,
  type RenglonInformacion,
} from "./informacion-produccion";

vi.mock("./api", () => ({ apiFetch: vi.fn(), apiFetchSinCuerpo: vi.fn() }));

const renglon = (producto: string, volumen: string, produccion: number, compras: number): RenglonInformacion => ({
  presentacionId: `p-${producto}-${volumen}`,
  productoId: `prod-${producto}`,
  producto,
  volumen,
  produccion,
  compras,
  total: produccion + compras,
});

beforeEach(() => vi.resetAllMocks());

describe("llamadas", () => {
  it("la pantalla: rango, sucursal y vista", async () => {
    vi.mocked(apiFetch).mockResolvedValue({});
    await leerInformacionProduccion("2026-11-01", "2026-11-28", "TJ", "producto");
    expect(apiFetch).toHaveBeenCalledWith(
      "/informacion-produccion?desde=2026-11-01&hasta=2026-11-28&sucursal=TJ&vista=producto",
    );
  });

  it("el detalle por presentación", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ detalle: [] });
    await leerDetalleInformacion({ presentacion: "p1" }, "2026-11-01", "2026-11-28", "todas");
    expect(apiFetch).toHaveBeenCalledWith(
      "/informacion-produccion/detalle?presentacion=p1&desde=2026-11-01&hasta=2026-11-28&sucursal=todas",
    );
  });

  it("el detalle por producto", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ detalle: [] });
    await leerDetalleInformacion({ producto: "x" }, "2026-11-01", "2026-11-28", "MX");
    expect(apiFetch).toHaveBeenCalledWith(
      "/informacion-produccion/detalle?producto=x&desde=2026-11-01&hasta=2026-11-28&sucursal=MX",
    );
  });
});

describe("totales", () => {
  it("agrupa por tamaño y suma", () => {
    const g = gruposInformacion([renglon("Horchata", "500 ml", 10, 5), renglon("Jamaica", "500 ml", 2, 0), renglon("Agua", "1 L", 1, 1)]);
    expect(g.map((x) => x.tamano)).toEqual(["500 ml", "1 L"]);
    expect(g[0].totales).toEqual({ produccion: 12, compras: 5, total: 17 });
  });

  it("total general", () => {
    expect(totalInformacion([renglon("A", "", 3, 4), renglon("B", "", 1, 1)])).toEqual({ produccion: 4, compras: 5, total: 9 });
  });
});

describe("textoRango (título del detalle, spec D4)", () => {
  it("el mismo mes: del 3 al 7 nov", () => {
    expect(textoRango("2026-11-03", "2026-11-07")).toBe("del 3 al 7 nov");
  });
  it("un solo día: 3 nov", () => {
    expect(textoRango("2026-11-03", "2026-11-03")).toBe("3 nov");
  });
  it("meses distintos: del 28 oct al 3 nov", () => {
    expect(textoRango("2026-10-28", "2026-11-03")).toBe("del 28 oct al 3 nov");
  });
  it("años distintos: lleva el año", () => {
    expect(textoRango("2025-12-28", "2026-01-03")).toBe("del 28 dic 2025 al 3 ene 2026");
  });
});

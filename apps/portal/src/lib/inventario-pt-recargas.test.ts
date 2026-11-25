import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import {
  gruposPtRecargas,
  leerDetallePtRecargas,
  leerInventarioPtRecargas,
  textoSinInicialRecargas,
  type RenglonPtRecargas,
} from "./inventario-pt-recargas";

vi.mock("./api", () => ({ apiFetch: vi.fn(), apiFetchSinCuerpo: vi.fn() }));

const renglon = (producto: string, volumen: string, m: Partial<RenglonPtRecargas> = {}): RenglonPtRecargas => ({
  presentacionId: `p-${producto}-${volumen}`,
  productoId: `prod-${producto}`,
  producto,
  volumen,
  inicial: 0,
  actual: 0,
  ajustado: false,
  recargas: 0,
  envios: 0,
  entradas: 0,
  ...m,
});

beforeEach(() => vi.resetAllMocks());

describe("llamadas", () => {
  it("la pantalla: sucursal y vista, sin fecha (siempre hoy del servidor)", async () => {
    vi.mocked(apiFetch).mockResolvedValue({});
    await leerInventarioPtRecargas("TJ", "producto");
    expect(apiFetch).toHaveBeenCalledWith("/inventario-pt/recargas?sucursal=TJ&vista=producto");
  });

  it("el detalle: presentación o producto y sucursal", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ detalle: [] });
    await leerDetallePtRecargas({ presentacion: "p1" }, "todas");
    expect(apiFetch).toHaveBeenLastCalledWith("/inventario-pt/recargas/detalle?presentacion=p1&sucursal=todas");
    await leerDetallePtRecargas({ producto: "x" }, "TJ");
    expect(apiFetch).toHaveBeenLastCalledWith("/inventario-pt/recargas/detalle?producto=x&sucursal=TJ");
  });
});

describe("gruposPtRecargas", () => {
  it("por tamaño (de chico a grande), dentro por producto, con su total", () => {
    const g = gruposPtRecargas([
      renglon("Jamaica", "500 ml", { inicial: 10, recargas: 3, envios: 1, entradas: 2, actual: 8 }),
      renglon("Agua", "1 L", { inicial: 4, actual: 4 }),
      renglon("Horchata", "500 ml", { inicial: 20, recargas: 5, actual: 15 }),
    ]);
    expect(g.map((x) => x.tamano)).toEqual(["500 ml", "1 L"]);
    expect(g[0].renglones.map((r) => r.producto)).toEqual(["Horchata", "Jamaica"]);
    expect(g[0].totales).toEqual({ inicial: 30, recargas: 8, envios: 1, entradas: 2, actual: 23 });
  });

  it("un total con algún renglón sin inicial queda vacío (null), los movimientos sí se suman", () => {
    const [g] = gruposPtRecargas([
      renglon("Agua", "1 L", { inicial: null, actual: null, recargas: 2 }),
      renglon("Horchata", "1 L", { inicial: 5, actual: 4, recargas: 1 }),
    ]);
    expect(g.totales.inicial).toBeNull();
    expect(g.totales.actual).toBeNull();
    expect(g.totales.recargas).toBe(3);
  });
});

describe("textoSinInicialRecargas", () => {
  it("manda a capturar el ajuste en PT con Ventas (aquí no se ajusta)", () => {
    expect(textoSinInicialRecargas(1, "presentacion", false)).toBe(
      "1 presentación sin inventario inicial: su Inicial y Actual quedan vacíos hasta que se capture un ajuste en Inventario de PT con Ventas. Los movimientos de hoy sí se ven.",
    );
    expect(textoSinInicialRecargas(2, "producto", true)).toMatch(
      /^2 productos sin inventario inicial: .* hasta que cada sucursal capture su ajuste en Inventario de PT con Ventas\./,
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, apiFetchSinCuerpo } from "./api";
import {
  borrarAjustePt,
  cambiosDeAjuste,
  diasDelRango,
  guardarAjustesPt,
  gruposPt,
  leerAjustesPt,
  leerDescuentosPt,
  leerHistorialPt,
  leerInventarioPt,
  textoCambios,
  textoOrigenDescuento,
  textoRango,
  totalesHistorial,
  type DiaPt,
  type RenglonAjustePt,
  type RenglonPt,
} from "./inventario-pt";

vi.mock("./api", () => ({ apiFetch: vi.fn(), apiFetchSinCuerpo: vi.fn() }));

const renglon = (
  producto: string,
  volumen: string,
  m: Partial<RenglonPt> = {},
): RenglonPt => ({
  presentacionId: `p-${producto}-${volumen}`,
  productoId: `prod-${producto}`,
  producto,
  volumen,
  inicial: 100,
  ventas: 10,
  merma: 1,
  consumo: 2,
  promo: 0,
  descuentos: 0,
  cambios: 0,
  entradas: 5,
  envios: 0,
  final: 92,
  mermaAcumulada: 3,
  retiroMerma: 0,
  ajustado: false,
  ...m,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(apiFetch).mockResolvedValue({});
  vi.mocked(apiFetchSinCuerpo).mockResolvedValue(undefined);
});

describe("llamadas", () => {
  it("lee el día con la vista", async () => {
    await leerInventarioPt("2026-11-24", "TJ", "producto");
    expect(apiFetch).toHaveBeenCalledWith("/inventario-pt?fecha=2026-11-24&sucursal=TJ&vista=producto");
  });

  it("historial y descuentos por presentación o por producto", async () => {
    await leerHistorialPt({ presentacion: "p1" }, "2026-11-18", "2026-11-24", "todas");
    expect(apiFetch).toHaveBeenLastCalledWith(
      "/inventario-pt/historial?presentacion=p1&desde=2026-11-18&hasta=2026-11-24&sucursal=todas",
    );
    await leerHistorialPt({ producto: "x" }, "2026-11-18", "2026-11-24", "TJ");
    expect(apiFetch).toHaveBeenLastCalledWith(
      "/inventario-pt/historial?producto=x&desde=2026-11-18&hasta=2026-11-24&sucursal=TJ",
    );
    await leerDescuentosPt({ producto: "x" }, "2026-11-24", "TJ");
    expect(apiFetch).toHaveBeenLastCalledWith("/inventario-pt/descuentos?producto=x&fecha=2026-11-24&sucursal=TJ");
  });

  it("ajustes: leer, guardar y dar de baja", async () => {
    await leerAjustesPt("2026-11-24", "TJ");
    expect(apiFetch).toHaveBeenLastCalledWith("/inventario-pt/ajustes?fecha=2026-11-24&sucursal=TJ");
    const cuerpo = {
      fecha: "2026-11-24",
      sucursal: "TJ",
      comentario: null,
      renglones: [{ presentacionId: "p1", inventarioInicial: 5, mermaAcumuladaInicial: 0 }],
    };
    await guardarAjustesPt(cuerpo);
    expect(apiFetchSinCuerpo).toHaveBeenLastCalledWith("/inventario-pt/ajustes", {
      method: "PUT",
      body: JSON.stringify(cuerpo),
    });
    await borrarAjustePt("2026-11-24", "TJ", "p1");
    expect(apiFetchSinCuerpo).toHaveBeenLastCalledWith(
      "/inventario-pt/ajustes?fecha=2026-11-24&sucursal=TJ&presentacionId=p1",
      { method: "DELETE" },
    );
  });
});

describe("gruposPt", () => {
  it("agrupa por tamaño (de chico a grande) con totales; dentro por producto", () => {
    const g = gruposPt([
      renglon("Jamaica", "1 L"),
      renglon("Horchata", "500 ml", { inicial: 1378, final: 1940, cambios: 2 }),
      renglon("Agua", "1 L"),
      renglon("Jamaica", "500 ml", { inicial: 940, final: 1017, cambios: -2 }),
    ]);
    expect(g.map((x) => x.tamano)).toEqual(["500 ml", "1 L"]);
    expect(g[0].renglones.map((r) => r.producto)).toEqual(["Horchata", "Jamaica"]);
    expect(g[1].renglones.map((r) => r.producto)).toEqual(["Agua", "Jamaica"]);
    expect(g[0].totales.inicial).toBe(2318);
    expect(g[0].totales.final).toBe(2957);
    expect(g[0].totales.cambios).toBe(0);
    expect(g[0].totales.ventas).toBe(20);
  });

  it("un renglón sin inventario inicial deja el total de Inicial, Final y Merma acumulada vacío", () => {
    const [g] = gruposPt([
      renglon("Horchata", "500 ml"),
      renglon("Jamaica", "500 ml", { inicial: null, final: null, mermaAcumulada: null }),
    ]);
    expect(g.totales.inicial).toBeNull();
    expect(g.totales.final).toBeNull();
    expect(g.totales.mermaAcumulada).toBeNull();
    expect(g.totales.ventas).toBe(20);
  });
});

describe("historial", () => {
  it("el total suma solo las columnas de movimiento", () => {
    const dias: DiaPt[] = [
      { ...renglon("H", "1 L"), fecha: "2026-11-23" },
      { ...renglon("H", "1 L", { ventas: 3, cambios: -1 }), fecha: "2026-11-24" },
    ];
    const t = totalesHistorial(dias);
    expect(t).toEqual({
      ventas: 13,
      merma: 2,
      consumo: 4,
      promo: 0,
      descuentos: 0,
      cambios: -1,
      entradas: 10,
      envios: 0,
      retiroMerma: 0,
    });
  });

  it("diasDelRango cuenta ambos extremos", () => {
    expect(diasDelRango("2026-11-18", "2026-11-24")).toBe(7);
    expect(diasDelRango("2026-10-31", "2026-11-01")).toBe(2);
  });
});

describe("textos", () => {
  it("cambios con signo", () => {
    expect(textoCambios(2)).toBe("+2");
    expect(textoCambios(-2)).toBe("−2");
    expect(textoCambios(0)).toBe("0");
  });

  it("origen del descuento", () => {
    expect(textoOrigenDescuento("corte")).toBe("Faltante del corte");
    expect(textoOrigenDescuento("nomina")).toBe("Nómina");
  });
});

describe("cambiosDeAjuste", () => {
  const base: RenglonAjustePt[] = [
    { presentacionId: "a", productoId: "x", producto: "Horchata", volumen: "1 L", inventarioInicial: 10, mermaAcumuladaInicial: 2, ajustado: false },
    { presentacionId: "b", productoId: "y", producto: "Jamaica", volumen: "1 L", inventarioInicial: null, mermaAcumuladaInicial: null, ajustado: false },
  ];

  it("sin tocar nada no hay cambios", () => {
    expect(cambiosDeAjuste(base, {})).toEqual({ renglones: [], invalidos: [], incompletos: [] });
    expect(cambiosDeAjuste(base, { a: { inicial: "10", merma: "2" } })).toEqual({ renglones: [], invalidos: [], incompletos: [] });
  });

  it("solo manda los renglones cambiados", () => {
    expect(cambiosDeAjuste(base, { a: { inicial: "12", merma: "2" }, b: { inicial: "", merma: "" } })).toEqual({
      renglones: [{ presentacionId: "a", inventarioInicial: 12, mermaAcumuladaInicial: 2 }],
      invalidos: [],
      incompletos: [],
    });
  });

  it("un renglón cambiado necesita los dos números enteros >= 0", () => {
    expect(cambiosDeAjuste(base, { b: { inicial: "7", merma: "" } })).toEqual({ renglones: [], invalidos: [], incompletos: ["b"] });
    expect(cambiosDeAjuste(base, { a: { inicial: "", merma: "2" } }).incompletos).toEqual(["a"]);
    expect(cambiosDeAjuste(base, { a: { inicial: "-1", merma: "2" } }).invalidos).toEqual(["a"]);
    expect(cambiosDeAjuste(base, { a: { inicial: "1.5", merma: "2" } }).invalidos).toEqual(["a"]);
    expect(cambiosDeAjuste(base, { b: { inicial: " 7 ", merma: "0" } })).toEqual({
      renglones: [{ presentacionId: "b", inventarioInicial: 7, mermaAcumuladaInicial: 0 }],
      invalidos: [],
      incompletos: [],
    });
  });
});

describe("textoRango", () => {
  it("mismo mes, distinto mes y un solo día", () => {
    expect(textoRango("2026-11-17", "2026-11-23")).toBe("del 17 al 23 de noviembre");
    expect(textoRango("2026-10-28", "2026-11-03")).toBe("del 28 de octubre al 3 de noviembre");
    expect(textoRango("2026-11-23", "2026-11-23")).toBe("23 de noviembre");
    expect(textoRango("2025-12-30", "2026-01-02")).toBe("del 30 de diciembre de 2025 al 2 de enero de 2026");
  });
});

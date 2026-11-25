import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import {
  gruposPorTamano,
  leerInventarioVendedor,
  mermaRegistrada,
  textoEstadoRecarga,
  textoFaltantesDia,
  textoHora,
  type LineaInventario,
  type RecargaInventario,
} from "./inventario-vendedor";

vi.mock("./api", () => ({ apiFetch: vi.fn() }));

const linea = (
  id: string,
  producto: string,
  volumen: string,
  m: Partial<LineaInventario> = {},
): LineaInventario => ({
  presentacionId: id,
  nombre: `${producto} ${volumen}`,
  producto,
  volumen,
  cargadas: 10,
  vendidas: 4,
  regaladas: 1,
  mermaEntregada: 0,
  mermaRecibida: 0,
  mermaAlmacen: 0,
  consumo: 0,
  cambiosEntregados: 0,
  cambiosRecibidos: 0,
  deberiaRegresar: 5,
  buenas: null,
  faltante: null,
  merma: null,
  mermaTeorica: 0,
  resultadoMerma: null,
  ...m,
});

beforeEach(() => vi.mocked(apiFetch).mockReset());

describe("leerInventarioVendedor", () => {
  it("pide fecha, sucursal y vendedor", async () => {
    vi.mocked(apiFetch).mockResolvedValue({});
    await leerInventarioVendedor("2026-11-24", "TJ", "todos");
    expect(apiFetch).toHaveBeenCalledWith(
      "/inventario-vendedor?fecha=2026-11-24&sucursal=TJ&vendedor=todos",
    );
  });
});

describe("gruposPorTamano", () => {
  it("agrupa por tamano sin importar mayusculas ni espacios, ordenado por mililitros", () => {
    const g = gruposPorTamano([
      linea("1", "Jamaica", "1 L"),
      linea("2", "Horchata", "500ML"),
      linea("3", "Tamarindo", "355 ml"),
      linea("4", "Horchata", "1 l"),
      linea("5", "Jamaica", "500 ml"),
    ]);
    expect(g.map((x) => x.tamano)).toEqual(["355 ml", "500ML", "1 l"]);
    expect(g[1].lineas.map((l) => l.presentacionId)).toEqual(["2", "5"]);
    expect(g[2].lineas.map((l) => l.producto)).toEqual(["Horchata", "Jamaica"]);
  });

  it("suma cada concepto del grupo", () => {
    const [g] = gruposPorTamano([
      linea("1", "A", "1 L", { cargadas: 10, mermaEntregada: 1, mermaAlmacen: 2 }),
      linea("2", "B", "1 L", { cargadas: 5, mermaEntregada: 3 }),
    ]);
    expect(g.totales.cargadas).toBe(15);
    expect(g.totales.mermaEntregada).toBe(4);
    expect(g.totales.mermaAlmacen).toBe(2);
  });

  it("suma con signo lo que no es null y deja null si ninguna linea lo tiene", () => {
    const [g] = gruposPorTamano([
      linea("1", "A", "1 L", { buenas: 4, faltante: 3, merma: 1, resultadoMerma: -2 }),
      linea("2", "B", "1 L", { buenas: 2, faltante: -1, merma: null, resultadoMerma: null }),
      linea("3", "C", "1 L"),
    ]);
    expect(g.totales.buenas).toBe(6);
    expect(g.totales.faltante).toBe(2);
    expect(g.totales.merma).toBe(1);
    expect(g.totales.resultadoMerma).toBe(-2);
    const [sin] = gruposPorTamano([linea("1", "A", "1 L")]);
    expect(sin.totales.buenas).toBeNull();
    expect(sin.totales.merma).toBeNull();
    expect(sin.totales.faltante).toBeNull();
    expect(sin.totales.resultadoMerma).toBeNull();
  });

  it("las teoricas null no suman y quedan null si ninguna linea las tiene", () => {
    const [g] = gruposPorTamano([
      linea("1", "A", "1 L", { deberiaRegresar: 4, mermaTeorica: null }),
      linea("2", "B", "1 L", { deberiaRegresar: null, mermaTeorica: null }),
    ]);
    expect(g.totales.deberiaRegresar).toBe(4);
    expect(g.totales.mermaTeorica).toBeNull();
  });

  it("sin lineas no hay grupos", () => {
    expect(gruposPorTamano([])).toEqual([]);
  });
});

describe("mermaRegistrada", () => {
  it("es la entregada mas la de almacen", () => {
    expect(
      mermaRegistrada(linea("1", "A", "1 L", { mermaEntregada: 2, mermaAlmacen: 3 })),
    ).toBe(5);
  });
});

describe("textoEstadoRecarga", () => {
  it.each([
    ["aceptada", "Aceptada"],
    ["pendiente", "Pendiente"],
    ["rechazada", "Rechazada"],
  ] as const)("%s", (estado, texto) => {
    expect(textoEstadoRecarga({ estado } as RecargaInventario)).toBe(texto);
  });
});

describe("textoEstadoRecarga por renglón", () => {
  const r = (estado: string, aceptados: number | null, total: number) =>
    ({ estado, renglonesAceptados: aceptados, renglones: total }) as RecargaInventario;
  it("todos aceptados: Aceptada", () => {
    expect(textoEstadoRecarga(r("aceptada", 3, 3))).toBe("Aceptada");
  });
  it("algunos: Aceptada N de M", () => {
    expect(textoEstadoRecarga(r("aceptada", 2, 3))).toBe("Aceptada 2 de 3");
  });
  it("ninguno: Rechazada", () => {
    expect(textoEstadoRecarga(r("rechazada", 0, 3))).toBe("Rechazada");
  });
  it("pendiente: Pendiente", () => {
    expect(textoEstadoRecarga(r("pendiente", null, 3))).toBe("Pendiente");
  });
});

describe("textoHora", () => {
  it.each([
    ["07:29", "7:29 a. m."],
    ["13:05", "1:05 p. m."],
    ["00:00", "12:00 a. m."],
    ["00:45", "12:45 a. m."],
    ["12:00", "12:00 p. m."],
    ["12:30", "12:30 p. m."],
    ["23:59", "11:59 p. m."],
  ])("%s", (hhmm, texto) => {
    expect(textoHora(hhmm)).toBe(texto);
  });

  it("lo que no se lee queda tal cual", () => {
    expect(textoHora("raro")).toBe("raro");
  });
});

describe("textoFaltantesDia", () => {
  it("usa la frase de la pastilla del corte", () => {
    expect(textoFaltantesDia({ piezas: 3, merma: 1 })).toBe("Faltan: 3 pz p/Almacen · 1 pz merma");
    expect(textoFaltantesDia({ piezas: 1, merma: 0 })).toBe("Faltan: 1 pz p/Almacen");
    expect(textoFaltantesDia({ piezas: 0, merma: 2 })).toBe("Faltan: 2 pz merma");
    expect(textoFaltantesDia({ piezas: 0, merma: 1 })).toBe("Faltan: 1 pz merma");
  });
  it("null si no hay nada que mostrar", () => {
    expect(textoFaltantesDia(null)).toBeNull();
    expect(textoFaltantesDia({ piezas: 0, merma: 0 })).toBeNull();
  });
});

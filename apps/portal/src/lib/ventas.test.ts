import { describe, expect, it } from "vitest";
import { formatearPesos, hoyEnTijuana, leerPiezas } from "./ventas";

describe("hoyEnTijuana", () => {
  it("a las 22:30 de Tijuana devuelve hoy, aunque en UTC ya sea mañana", () => {
    // 2026-10-07T05:30Z = 2026-10-06 22:30 en Tijuana (UTC-7, horario de verano).
    expect(hoyEnTijuana(new Date("2026-10-07T05:30:00Z"))).toBe("2026-10-06");
  });

  it("en invierno (UTC-8) tambien", () => {
    expect(hoyEnTijuana(new Date("2026-12-02T07:59:00Z"))).toBe("2026-12-01");
  });
});

describe("leerPiezas", () => {
  it.each([
    ["", 0],
    ["0", 0],
    ["24", 24],
    [" 5 ", 5],
  ])("%j son %i piezas", (texto, piezas) => {
    expect(leerPiezas(texto)).toBe(piezas);
  });

  it.each(["2.5", "-1", "abc", "1e3"])("%j no es un numero de piezas", (texto) => {
    expect(leerPiezas(texto)).toBeNull();
  });
});

describe("formatearPesos", () => {
  it("centavos a pesos con dos decimales", () => {
    expect(formatearPesos(27000)).toBe("$270.00");
    expect(formatearPesos(123456)).toBe("$1,234.56");
  });
});

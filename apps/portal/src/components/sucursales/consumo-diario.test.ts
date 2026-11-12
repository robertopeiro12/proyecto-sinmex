import { describe, expect, it } from "vitest";
import { AYUDA_CONSUMO_DIARIO, leerConsumoDiarioMax } from "./consumo-diario";

describe("leerConsumoDiarioMax (T-27 pieza 2, D4)", () => {
  it.each([
    ["1", 1],
    ["0", 0],
    ["99", 99],
    [" 7 ", 7],
    ["05", 5],
  ])("%j es %d", (texto, esperado) => {
    expect(leerConsumoDiarioMax(texto)).toBe(esperado);
  });

  it.each(["", "100", "-1", "1.5", "uno", "1e1"])("%j no vale", (texto) => {
    expect(leerConsumoDiarioMax(texto)).toBeNull();
  });

  it("la ayuda es la del spec", () => {
    expect(AYUDA_CONSUMO_DIARIO).toBe(
      "Piezas que cada vendedor puede registrar como consumo propio en un día.",
    );
  });
});

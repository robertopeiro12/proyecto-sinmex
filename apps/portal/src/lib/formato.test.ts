import { describe, expect, it } from "vitest";
import { formatearFecha, formatearFechaHora, formatearPesos, iniciales, plural } from "./formato";
import * as reportes from "./reportes";
import * as ventas from "./ventas";

describe("formatearPesos", () => {
  it("centavos con separador de miles y el signo antes del $", () => {
    expect(formatearPesos(27000)).toBe("$270.00");
    expect(formatearPesos(123456)).toBe("$1,234.56");
    expect(formatearPesos(-5000)).toBe("-$50.00");
    expect(formatearPesos(0)).toBe("$0.00");
  });

  it("lib/ventas lo sigue exportando: las importaciones viejas no se rompen", () => {
    expect(ventas.formatearPesos).toBe(formatearPesos);
  });
});

describe("formatearFecha", () => {
  it("AAAA-MM-DD → dd/mm/aaaa sin pasar por Date", () => {
    expect(formatearFecha("2026-10-02")).toBe("02/10/2026");
    expect(formatearFecha("2027-01-01")).toBe("01/01/2027");
  });

  it("Review Focus 1: lo que no es una fecha AAAA-MM-DD sale tal cual", () => {
    expect(formatearFecha("")).toBe("");
    expect(formatearFecha("2026-10-21T19:00:00.000Z")).toBe("2026-10-21T19:00:00.000Z");
    expect(formatearFecha("—")).toBe("—");
  });

  it("lib/reportes lo sigue exportando", () => {
    expect(reportes.formatearFecha).toBe(formatearFecha);
  });
});

describe("formatearFechaHora", () => {
  it("AAAA-MM-DD hh:mm (hora de Tijuana, como la manda el servidor) → dd/mm/aaaa hh:mm", () => {
    expect(formatearFechaHora("2026-10-13 09:15")).toBe("13/10/2026 09:15");
  });

  it("Review Focus 1: una hora UTC o una fecha sin hora sale tal cual (no se adivina la zona)", () => {
    expect(formatearFechaHora("2026-10-21T19:00:00.000Z")).toBe("2026-10-21T19:00:00.000Z");
    expect(formatearFechaHora("2026-10-13")).toBe("2026-10-13");
    expect(formatearFechaHora("")).toBe("");
  });
});

describe("plural", () => {
  it("uno y varios", () => {
    expect(plural(1, "venta", "ventas")).toBe("1 venta");
    expect(plural(0, "venta", "ventas")).toBe("0 ventas");
    expect(plural(3, "nota", "notas")).toBe("3 notas");
  });
});

describe("iniciales", () => {
  it("primera letra de las dos primeras palabras; una palabra da sus dos primeras letras", () => {
    expect(iniciales("Admin Local")).toBe("AL");
    expect(iniciales("  roberto  peiro garcía ")).toBe("RP");
    expect(iniciales("Roberto")).toBe("RO");
    expect(iniciales("ángel")).toBe("ÁN");
    expect(iniciales("   ")).toBe("?");
  });
});

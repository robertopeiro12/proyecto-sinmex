import { describe, expect, it } from "vitest";
import { COLOR_TODAS, colorDeSucursal, siglasDeSucursal } from "./sucursal-color";

describe("colorDeSucursal", () => {
  it("Tijuana azul pacífico y Mexicali morado jamaica, sin importar mayúsculas", () => {
    expect(colorDeSucursal("TJ")).toBe("var(--suc-tj)");
    expect(colorDeSucursal("tj")).toBe("var(--suc-tj)");
    expect(colorDeSucursal("MX")).toBe("var(--suc-mx)");
  });

  it("Review Focus 3: todas, o una sucursal sin color asignado, van en tinta", () => {
    expect(colorDeSucursal(null)).toBe(COLOR_TODAS);
    expect(colorDeSucursal("todas")).toBe(COLOR_TODAS);
    expect(colorDeSucursal("TODAS")).toBe(COLOR_TODAS);
    expect(colorDeSucursal("EN")).toBe(COLOR_TODAS);
    expect(COLOR_TODAS).toBe("var(--suc-todas)");
  });
});

describe("siglasDeSucursal", () => {
  it("el código en mayúsculas; todas dice Todas", () => {
    expect(siglasDeSucursal("tj")).toBe("TJ");
    expect(siglasDeSucursal("MX")).toBe("MX");
    expect(siglasDeSucursal(null)).toBe("Todas");
    expect(siglasDeSucursal("todas")).toBe("Todas");
  });
});

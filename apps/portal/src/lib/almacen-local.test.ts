import { afterEach, describe, expect, it, vi } from "vitest";
import { guardarLocal, leerLocal } from "./almacen-local";

describe("almacen-local", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("guarda y lee", () => {
    guardarLocal("jawa.prueba", "1");
    expect(leerLocal("jawa.prueba")).toBe("1");
    expect(leerLocal("jawa.otra")).toBeNull();
  });

  it("Review Focus 2: sin localStorage (ventana privada, datos bloqueados) no truena", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(leerLocal("jawa.prueba")).toBeNull();
    expect(() => guardarLocal("jawa.prueba", "1")).not.toThrow();
  });
});

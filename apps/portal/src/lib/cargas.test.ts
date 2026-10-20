import { describe, expect, it } from "vitest";
import {
  borradorDe,
  cargaEditable,
  columnasDeVendedor,
  leerBorrador,
  piezasDe,
  totalBorrador,
  totalPiezas,
  type CargaRejilla,
  type VendedorRejilla,
} from "./cargas";

const CARGA: CargaRejilla = {
  id: "c1",
  numero: 1,
  estado: "pendiente",
  motivoRechazo: null,
  version: 1,
  respondidaEn: null,
  lineas: [
    { presentacionId: "p1", piezas: 24 },
    { presentacionId: "p2", piezas: 12 },
  ],
};

describe("borrador de una carga (T-27)", () => {
  it("una carga nueva empieza vacia; una existente trae sus piezas como texto", () => {
    expect(borradorDe(null)).toEqual({});
    expect(borradorDe(CARGA)).toEqual({ p1: "24", p2: "12" });
  });

  it("al editar, una presentacion dada de baja sale del borrador (si no, la carga no se podria guardar)", () => {
    const presentaciones = [
      { id: "p1", productoNombre: "Horchata", volumen: "1 L", activa: true },
      { id: "p2", productoNombre: "Jamaica", volumen: "500 ml", activa: false },
    ];
    expect(borradorDe(CARGA, presentaciones)).toEqual({ p1: "24" });
    // Una que ya ni sale en la rejilla tampoco se manda.
    expect(borradorDe(CARGA, [presentaciones[1]])).toEqual({});
  });

  it("leerBorrador: vacio o 0 no es linea; el resto son piezas enteras de 1 a 99 999", () => {
    expect(leerBorrador({ p1: " 30 ", p2: "", p3: "0" })).toEqual({
      lineas: [{ presentacionId: "p1", piezas: 30 }],
      error: null,
    });
    for (const malo of ["abc", "1.5", "-3", "100000"]) {
      expect(leerBorrador({ p1: malo })).toEqual({
        lineas: [],
        error: "Las piezas son enteras, de 1 a 99 999.",
      });
    }
    expect(leerBorrador({ p1: "", p2: "0" })).toEqual({
      lineas: [],
      error: "Captura al menos un producto.",
    });
  });

  it("totalBorrador suma solo lo legible", () => {
    expect(totalBorrador({ p1: "10", p2: "abc", p3: "5" })).toBe(15);
  });
});

describe("lectura de la rejilla", () => {
  it("piezasDe y totalPiezas", () => {
    expect(piezasDe(CARGA, "p2")).toBe(12);
    expect(piezasDe(CARGA, "p9")).toBeNull();
    expect(totalPiezas(CARGA.lineas)).toBe(36);
  });

  it("solo se edita una pendiente o rechazada de hoy (D5, D8)", () => {
    expect(cargaEditable(CARGA, true)).toBe(true);
    expect(cargaEditable({ ...CARGA, estado: "rechazada" }, true)).toBe(true);
    expect(cargaEditable({ ...CARGA, estado: "aceptada" }, true)).toBe(false);
    expect(cargaEditable(CARGA, false)).toBe(false);
  });

  it("columnasDeVendedor: sus cargas, la nueva al final, o una vacia", () => {
    const vendedor: VendedorRejilla = { id: "v1", nombre: "Ana", cargas: [CARGA] };
    expect(columnasDeVendedor(vendedor, false)).toEqual([{ tipo: "carga", carga: CARGA }]);
    expect(columnasDeVendedor(vendedor, true)).toEqual([
      { tipo: "carga", carga: CARGA },
      { tipo: "nueva" },
    ]);
    expect(columnasDeVendedor({ ...vendedor, cargas: [] }, false)).toEqual([{ tipo: "vacia" }]);
    expect(columnasDeVendedor({ ...vendedor, cargas: [] }, true)).toEqual([{ tipo: "nueva" }]);
  });
});

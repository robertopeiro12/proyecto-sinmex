import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  definicionExcelFlujo,
  formatearPorcentaje,
  obtenerFlujoEfectivo,
  type FlujoEfectivo,
} from "./flujo-efectivo";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

const FLUJO: FlujoEfectivo = {
  desde: "2026-10-13",
  hasta: "2026-10-14",
  ventasTotalesCentavos: 100000,
  cobradoRepartidorCentavos: 60000,
  cobradoOficinaCentavos: 27500,
  ventasCobradasCentavos: 87500,
  porcentajeCobro: 87.5,
  gastosDisponibles: false,
  gastosProduccionCentavos: 0,
  gastosOperacionCentavos: 0,
  gastosFinancierosCentavos: 0,
  utilidadBrutaCentavos: 87500,
  utilidadOperacionCentavos: 87500,
  utilidadNetaCentavos: 87500,
  dias: [
    { fecha: "2026-10-13", ventasCentavos: 40000, cobradoRepartidorCentavos: 30000, cobradoOficinaCentavos: 0, porcentajeCobro: 75 },
    { fecha: "2026-10-14", ventasCentavos: 60000, cobradoRepartidorCentavos: 30000, cobradoOficinaCentavos: 27500, porcentajeCobro: 95.8 },
  ],
  totalTesoreriaCentavos: 250000,
  tesoreriaCuentasConSaldo: 2,
  tesoreriaCuentas: 3,
  comentarios: {
    ingresos: [{ fecha: "2026-10-13", folio: "TJ261013AP01", cliente: "Cobach XXI", comentario: "Pagó con cheque" }],
    egresos: [{ fecha: "2026-10-14", concepto: "Retiro", cuenta: "Caja TJ", montoCentavos: 5000, comentario: "Gasolina" }],
  },
};

describe("formatearPorcentaje", () => {
  it.each([
    [87.5, "87.5%"],
    [150, "150%"],
    [null, "—"],
  ])("%s -> %s", (p, esperado) => {
    expect(formatearPorcentaje(p)).toBe(esperado);
  });
});

describe("obtenerFlujoEfectivo", () => {
  beforeEach(() => apiFetch.mockReset());

  it("arma la query con sucursal", async () => {
    apiFetch.mockResolvedValue({});
    await obtenerFlujoEfectivo({ desde: "2026-10-01", hasta: "2026-10-15", sucursal: "TJ" });
    expect(apiFetch).toHaveBeenCalledWith("/flujo-efectivo?desde=2026-10-01&hasta=2026-10-15&sucursal=TJ");
  });

  it("sin sucursal no la manda", async () => {
    apiFetch.mockResolvedValue({});
    await obtenerFlujoEfectivo({ desde: "2026-10-01", hasta: "2026-10-15", sucursal: null });
    expect(apiFetch).toHaveBeenCalledWith("/flujo-efectivo?desde=2026-10-01&hasta=2026-10-15");
  });
});

describe("definicionExcelFlujo", () => {
  const def = definicionExcelFlujo(FLUJO, { sucursal: "TJ" });
  const conceptos = def.filas.map((f) => f.celdas[0]);

  it("una hoja con columnas Concepto, Monto y Detalle y los filtros", () => {
    expect(def.titulo).toBe("Flujo de Efectivo");
    expect(def.columnas.map((c) => c.encabezado)).toEqual(["Concepto", "Monto", "Detalle"]);
    expect(def.filtros).toEqual([
      ["Rango", "13/10/2026 a 14/10/2026"],
      ["Sucursal", "TJ"],
    ]);
  });

  it("el resumen sigue el orden del cliente, en pesos", () => {
    expect(conceptos.slice(0, 12)).toEqual([
      "Ventas Totales", "Ventas Repartidor", "Ventas Oficinas", "Ventas Cobradas", "% de Cobro",
      "Gastos de Producción", "Utilidad Bruta", "Gastos Operativos", "Utilidad de Operación",
      "Gastos Financieros", "Utilidad Neta", "Total Tesorería",
    ]);
    expect(def.filas[0].celdas[1]).toBe(1000);
    expect(def.filas[4].celdas).toEqual(["% de Cobro", null, "87.5%"]);
  });

  it("anota que no hay gastos registrados y las cuentas sin saldo", () => {
    const gasto = def.filas.find((f) => f.celdas[0] === "Gastos Operativos")!;
    expect(gasto.celdas[2]).toBe("sin gastos registrados todavía");
    expect(def.filas.find((f) => f.celdas[0] === "Utilidad Neta")!.celdas[2]).toBe("");
    expect(def.filas.find((f) => f.celdas[0] === "Total Tesorería")!.celdas[2]).toBe("2 de 3 cuentas con saldo");
  });

  it("sin la nota cuando hay gastos", () => {
    const d = definicionExcelFlujo({ ...FLUJO, gastosDisponibles: true, tesoreriaCuentasConSaldo: 3 }, { sucursal: "TJ" });
    expect(d.filas.find((f) => f.celdas[0] === "Gastos Operativos")!.celdas[2]).toBe("");
    expect(d.filas.find((f) => f.celdas[0] === "Total Tesorería")!.celdas[2]).toBe("");
  });

  it("desglose por día en las mismas 3 columnas: fecha, ventas y 'Rep · Of · %' en Detalle", () => {
    const i = def.filas.findIndex((f) => f.celdas[0] === "Desglose por día");
    expect(def.filas[i].tipo).toBe("grupo");
    expect(def.filas[i + 1].celdas).toEqual(["13/10/2026", 400, "Rep $300.00 · Of $0.00 · 75%"]);
    expect(def.filas[i + 2].celdas).toEqual(["14/10/2026", 600, "Rep $300.00 · Of $275.00 · 95.8%"]);
  });

  it("bloques de comentarios de ingresos y egresos", () => {
    const i = def.filas.findIndex((f) => f.celdas[0] === "Comentarios de ingresos");
    expect(def.filas[i].tipo).toBe("grupo");
    expect(def.filas[i + 1].celdas).toEqual(["13/10/2026 · TJ261013AP01", null, "Cobach XXI: Pagó con cheque"]);
    const e = def.filas.findIndex((f) => f.celdas[0] === "Comentarios de egresos");
    expect(def.filas[e].tipo).toBe("grupo");
    expect(def.filas[e + 1].celdas).toEqual(["14/10/2026 · Retiro · Caja TJ", 50, "Gasolina"]);
  });

  it("bloques vacíos dicen que no hay comentarios", () => {
    const d = definicionExcelFlujo({ ...FLUJO, comentarios: { ingresos: [], egresos: [] } }, { sucursal: "TJ" });
    const i = d.filas.findIndex((f) => f.celdas[0] === "Comentarios de ingresos");
    expect(d.filas[i + 1].celdas[0]).toBe("Sin comentarios en el rango.");
  });
});

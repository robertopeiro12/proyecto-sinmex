import { describe, expect, it } from "vitest";
import { diaAnterior, primerDiaDelMes, rangoMes, rangoSemana } from "./fechas";
import * as reporteVentas from "./reporte-ventas";
import * as reportes from "./reportes";
import * as tesoreria from "./tesoreria";

describe("diaAnterior", () => {
  it("cruza meses, años y el 29 de febrero", () => {
    expect(diaAnterior("2026-10-20")).toBe("2026-10-19");
    expect(diaAnterior("2026-03-01")).toBe("2026-02-28");
    expect(diaAnterior("2028-03-01")).toBe("2028-02-29");
    expect(diaAnterior("2027-01-01")).toBe("2026-12-31");
  });
});

describe("primerDiaDelMes", () => {
  it("el día 1 del mismo mes", () => {
    expect(primerDiaDelMes("2026-10-19")).toBe("2026-10-01");
    expect(primerDiaDelMes("2026-02-28")).toBe("2026-02-01");
  });
});

describe("rangoSemana", () => {
  it("de lunes a domingo, aunque la semana cruce de mes o de año", () => {
    expect(rangoSemana("2026-10-14")).toEqual({ desde: "2026-10-12", hasta: "2026-10-18" });
    expect(rangoSemana("2026-10-12")).toEqual({ desde: "2026-10-12", hasta: "2026-10-18" });
    expect(rangoSemana("2026-11-01")).toEqual({ desde: "2026-10-26", hasta: "2026-11-01" });
    expect(rangoSemana("2026-12-31")).toEqual({ desde: "2026-12-28", hasta: "2027-01-03" });
  });
});

describe("rangoMes", () => {
  it("del 1 al último día, febrero bisiesto incluido", () => {
    expect(rangoMes("2026-10-14")).toEqual({ desde: "2026-10-01", hasta: "2026-10-31" });
    expect(rangoMes("2026-02-10")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(rangoMes("2028-02-10")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
    expect(rangoMes("2026-12-31")).toEqual({ desde: "2026-12-01", hasta: "2026-12-31" });
  });
});

describe("los archivos de antes re-exportan las mismas funciones", () => {
  it("reporte-ventas, reportes y tesoreria", () => {
    expect(reporteVentas.rangoSemana).toBe(rangoSemana);
    expect(reporteVentas.rangoMes).toBe(rangoMes);
    expect(reportes.primerDiaDelMes).toBe(primerDiaDelMes);
    expect(tesoreria.diaAnterior).toBe(diaAnterior);
    expect(tesoreria.primerDiaDelMesDe).toBe(primerDiaDelMes);
  });
});

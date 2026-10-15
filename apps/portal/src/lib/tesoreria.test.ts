import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  definicionExcelTesoreria,
  diaAnterior,
  etiquetaSucursalCuenta,
  guardarSaldos,
  leerMontoConSignoCentavos,
  obtenerTesoreria,
  textoMontoConSigno,
  type VistaTesoreria,
} from "./tesoreria";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

describe("leerMontoConSignoCentavos", () => {
  it.each([
    ["1500", 150000],
    ["1,250.50", 125050],
    ["$1,250.5", 125050],
    ["-1,250.50", -125050],
    ["- 5", -500],
    ["-$3", -300],
    ["$-3", -300],
    ["0", 0],
    ["-0", 0],
    ["0.07", 7],
  ])("%s -> %s", (texto, esperado) => {
    expect(leerMontoConSignoCentavos(texto)).toBe(esperado);
  });

  it.each(["", "   ", "abc", "1.234", "1,25", "--5", "5-", "1e3", "999999999999999"])("%s -> null", (texto) => {
    expect(leerMontoConSignoCentavos(texto)).toBeNull();
  });
});

describe("textoMontoConSigno", () => {
  it("vuelve al texto del campo sin coma flotante", () => {
    expect(textoMontoConSigno(150050)).toBe("1500.50");
    expect(textoMontoConSigno(-150050)).toBe("-1500.50");
    expect(textoMontoConSigno(7)).toBe("0.07");
  });
});

describe("etiquetaSucursalCuenta y diaAnterior", () => {
  it("null es General; diaAnterior cruza meses y años", () => {
    expect(etiquetaSucursalCuenta(null)).toBe("General");
    expect(etiquetaSucursalCuenta("TJ")).toBe("TJ");
    expect(diaAnterior("2026-03-01")).toBe("2026-02-28");
    expect(diaAnterior("2027-01-01")).toBe("2026-12-31");
  });
});

describe("llamadas", () => {
  beforeEach(() => apiFetch.mockReset());

  it("obtenerTesoreria arma la query con sucursal", async () => {
    apiFetch.mockResolvedValue({});
    await obtenerTesoreria({ desde: "2026-10-01", hasta: "2026-10-15", sucursal: "TJ" });
    expect(apiFetch).toHaveBeenCalledWith("/tesoreria?desde=2026-10-01&hasta=2026-10-15&sucursal=TJ");
  });

  it("guardarSaldos hace PUT con el lote", async () => {
    apiFetch.mockResolvedValue({ guardados: 1 });
    await guardarSaldos({ fecha: "2026-10-15", saldos: [{ cuentaId: "a", montoCentavos: -5 }] });
    expect(apiFetch).toHaveBeenCalledWith("/tesoreria/saldos", {
      method: "PUT",
      body: JSON.stringify({ fecha: "2026-10-15", saldos: [{ cuentaId: "a", montoCentavos: -5 }] }),
    });
  });
});

describe("definicionExcelTesoreria", () => {
  const vista: VistaTesoreria = {
    desde: "2026-10-05",
    hasta: "2026-10-12",
    cuentas: [
      { id: "b", nombre: "ScotiaFiscal", sucursalCodigo: null, saldoInicioCentavos: null, saldoFinalCentavos: null },
      { id: "a", nombre: "Efectivo TJ", sucursalCodigo: "TJ", saldoInicioCentavos: 1_000_000, saldoFinalCentavos: 950_000 },
    ],
    total: { saldoInicioCentavos: 1_000_000, saldoFinalCentavos: 950_000, cuentasConSaldoInicio: 1, cuentasConSaldoFinal: 1, cuentas: 2 },
    eventos: [
      { tipo: "saldo-fijado", id: "s", fecha: "2026-10-10", cuentaId: "a", cuentaNombre: "Efectivo TJ", montoCentavos: 950_000, comentario: "Arqueo", capturo: "Ana" },
    ],
  };

  it("el total del Excel avisa por columna cuando los conteos difieren y 'N cuentas' cuando están completos", () => {
    const con = (total: Partial<typeof vista.total>) =>
      definicionExcelTesoreria({ ...vista, total: { ...vista.total, ...total } }, { sucursal: "TJ" }).filas.find(
        (f) => f.celdas[0] === "Total Tesorería",
      )!.celdas[1];
    expect(con({ cuentasConSaldoInicio: 1, cuentasConSaldoFinal: 2, cuentas: 2 })).toBe("Inicio: 1 de 2 · final: 2 de 2 con saldo");
    expect(con({ cuentasConSaldoInicio: 2, cuentasConSaldoFinal: 2, cuentas: 2 })).toBe("2 cuentas");
  });

  it("una hoja: cuentas, total y el bloque de saldos fijados", () => {
    const def = definicionExcelTesoreria(vista, { sucursal: "TJ" });
    expect(def.titulo).toBe("Tesorería");
    expect(def.nombreArchivo).toBe("tesoreria-2026-10-05-a-2026-10-12");
    expect(def.filtros).toEqual([
      ["Rango", "05/10/2026 a 12/10/2026"],
      ["Sucursal", "TJ"],
    ]);
    expect(def.columnas.map((c) => c.encabezado)).toEqual(["Cuenta", "Sucursal", "Saldo al inicio", "Saldo al final", "Comentario"]);
    expect(def.filas).toEqual([
      { celdas: ["ScotiaFiscal", "General", "Sin saldo inicial", "Sin saldo inicial", null] },
      { celdas: ["Efectivo TJ", "TJ", 10000, 9500, null] },
      { celdas: ["Total Tesorería", "1 de 2 con saldo", 10000, 9500, null], tipo: "total" },
      { celdas: ["Saldos fijados en el rango", "Fecha", null, "Monto", "Comentario"], tipo: "grupo" },
      { celdas: ["Efectivo TJ", "10/10/2026", null, 9500, "Arqueo · Capturó: Ana"] },
    ]);
  });

  it("sin eventos no hay bloque", () => {
    const def = definicionExcelTesoreria({ ...vista, eventos: [] }, { sucursal: "TJ" });
    expect(def.filas.some((f) => f.tipo === "grupo")).toBe(false);
  });
});

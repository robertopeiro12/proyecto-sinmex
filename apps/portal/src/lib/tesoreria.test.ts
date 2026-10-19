import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  definicionExcelTesoreria,
  describirEvento,
  diaAnterior,
  etiquetaSucursalCuenta,
  guardarDestino,
  guardarSaldos,
  listarMovimientos,
  leerMontoConSignoCentavos,
  obtenerTesoreria,
  primerDiaDelMesDe,
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

describe("describirEvento", () => {
  const base = { id: "x", fecha: "2026-10-10", cuentaId: "a", cuentaNombre: "Efectivo TJ" };
  it("arma concepto, cuenta y signo por tipo", () => {
    expect(describirEvento({ ...base, tipo: "deposito", montoCentavos: 1, comentario: null, capturo: "Ana" })).toEqual({ concepto: "Depósito", cuenta: "Efectivo TJ", signo: 1 });
    expect(describirEvento({ ...base, tipo: "retiro", montoCentavos: 1, comentario: null, capturo: "Ana" })).toEqual({ concepto: "Retiro", cuenta: "Efectivo TJ", signo: -1 });
    expect(
      describirEvento({ ...base, tipo: "traspaso", cuentaDestinoId: "b", cuentaDestinoNombre: "ScotiaFiscal", montoCentavos: 1, comentario: null, capturo: "Ana" }),
    ).toEqual({ concepto: "Traspaso", cuenta: "Efectivo TJ → ScotiaFiscal", signo: 0 });
    expect(
      describirEvento({ ...base, tipo: "cobranza", sucursalCodigo: "TJ", metodo: "efectivo", cantidad: 12, montoCentavos: 1 }),
    ).toEqual({ concepto: "Cobranza en efectivo · 12 cobros · TJ", cuenta: "Efectivo TJ", signo: 1 });
    expect(
      describirEvento({ ...base, tipo: "cobranza", sucursalCodigo: "MX", metodo: "cheque", cantidad: 1, montoCentavos: 1 }),
    ).toEqual({ concepto: "Cobranza en cheque · 1 cobro · MX", cuenta: "Efectivo TJ", signo: 1 });
    expect(describirEvento({ ...base, tipo: "saldo-fijado", montoCentavos: 1, comentario: null, capturo: "Ana" })).toEqual({ concepto: "Saldo fijado", cuenta: "Efectivo TJ", signo: 0 });
  });
});

describe("primerDiaDelMesDe", () => {
  it("devuelve el día 1 del mes", () => {
    expect(primerDiaDelMesDe("2026-10-19")).toBe("2026-10-01");
  });
});

describe("llamadas de movimientos y destinos", () => {
  beforeEach(() => apiFetch.mockReset());
  it("listarMovimientos arma la query; guardarDestino hace PUT", async () => {
    apiFetch.mockResolvedValue([]);
    await listarMovimientos({ desde: "2026-10-01", hasta: "2026-10-31", sucursal: null });
    expect(apiFetch).toHaveBeenCalledWith("/tesoreria/movimientos?desde=2026-10-01&hasta=2026-10-31");
    await guardarDestino({ sucursalId: "s", metodo: "efectivo", cuentaId: "a", desde: "2026-10-01" });
    expect(apiFetch).toHaveBeenLastCalledWith("/tesoreria/destinos", {
      method: "PUT",
      body: JSON.stringify({ sucursalId: "s", metodo: "efectivo", cuentaId: "a", desde: "2026-10-01" }),
    });
  });
});

describe("definicionExcelTesoreria", () => {
  const vista: VistaTesoreria = {
    desde: "2026-10-05",
    hasta: "2026-10-12",
    cuentas: [
      { id: "a", nombre: "Efectivo TJ", sucursalCodigo: "TJ", saldoInicioCentavos: 1_000_000, saldoFinalCentavos: 950_000, entradasCentavos: 20_000, salidasCentavos: 70_000, saldoFijadoEnRango: null },
    ],
    total: { saldoInicioCentavos: 1_000_000, saldoFinalCentavos: 950_000, cuentasConSaldoInicio: 1, cuentasConSaldoFinal: 1, cuentas: 1, entradasCentavos: 20_000, salidasCentavos: 70_000 },
    sinCuenta: [{ sucursalCodigo: "MX", metodo: "transferencia", montoCentavos: 325_000 }],
    eventos: [
      { tipo: "cobranza", id: "c", fecha: "2026-10-06", cuentaId: "a", cuentaNombre: "Efectivo TJ", sucursalCodigo: "TJ", metodo: "efectivo", cantidad: 2, montoCentavos: 20_000 },
      { tipo: "retiro", id: "r", fecha: "2026-10-07", cuentaId: "a", cuentaNombre: "Efectivo TJ", montoCentavos: 70_000, comentario: "Banco", capturo: "Ana" },
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

  it("una hoja: cuentas con entradas y salidas, total, cobranza sin cuenta y movimientos", () => {
    const def = definicionExcelTesoreria(vista, { sucursal: "TJ" });
    expect(def.columnas.map((c) => c.encabezado)).toEqual([
      "Cuenta", "Sucursal", "Saldo al inicio", "Entradas", "Salidas", "Saldo al final", "Comentario",
    ]);
    expect(def.filas).toEqual([
      { celdas: ["Efectivo TJ", "TJ", 10000, 200, 700, 9500, null] },
      { celdas: ["Total Tesorería", "1 cuentas", 10000, 200, 700, 9500, null], tipo: "total" },
      { celdas: ["Cobranza sin cuenta asignada", null, null, null, null, null, null], tipo: "grupo" },
      { celdas: ["MX · Transferencia", null, null, 3250, null, null, null] },
      { celdas: ["Movimientos del rango", "Fecha", "Concepto", "Entra", "Sale", null, "Comentario"], tipo: "grupo" },
      { celdas: ["Efectivo TJ", "06/10/2026", "Cobranza en efectivo · 2 cobros · TJ", 200, null, null, null] },
      { celdas: ["Efectivo TJ", "07/10/2026", "Retiro", null, 700, null, "Banco · Capturó: Ana"] },
    ]);
  });

  it("sin eventos ni cobranza sin cuenta no hay bloques", () => {
    const def = definicionExcelTesoreria({ ...vista, eventos: [], sinCuenta: [] }, { sucursal: "TJ" });
    expect(def.filas.some((f) => f.tipo === "grupo")).toBe(false);
  });
});

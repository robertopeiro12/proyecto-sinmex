import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  definicionExcelCuentasPorCobrar,
  enlaceCobrar,
  obtenerCuentasPorCobrar,
  textoVence,
  type CuentasPorCobrar,
} from "./cuentas-por-cobrar";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

const DATOS: CuentasPorCobrar = {
  hoy: "2026-10-14",
  totalCentavos: 29900,
  vencidoCentavos: 14950,
  notas: 2,
  clientes: [
    {
      clienteId: "c1",
      cliente: "Cobach XXI",
      sucursalCodigo: "TJ",
      saldoCentavos: 29900,
      vencidoCentavos: 14950,
      notas: [
        { id: "n1", fecha: "2026-09-13", folio: "TJ260913AP05", numNota: "2346", montoCentavos: 14950, abonadoCentavos: 0, saldoCentavos: 14950, status: "pendiente", vence: "2026-09-28", diasAtraso: 16 },
        { id: "n2", fecha: "2026-10-10", folio: "TJ261010AP02", numNota: null, montoCentavos: 20000, abonadoCentavos: 5050, saldoCentavos: 14950, status: "abonado", vence: null, diasAtraso: 0 },
      ],
    },
  ],
};

describe("obtenerCuentasPorCobrar", () => {
  beforeEach(() => apiFetch.mockReset());

  it("sin filtros pide la ruta limpia", async () => {
    apiFetch.mockResolvedValue(DATOS);
    await obtenerCuentasPorCobrar({ sucursal: null, soloVencidas: false });
    expect(apiFetch).toHaveBeenCalledWith("/cuentas-por-cobrar");
  });

  it("agrega sucursal y soloVencidas", async () => {
    apiFetch.mockResolvedValue(DATOS);
    await obtenerCuentasPorCobrar({ sucursal: "TJ", soloVencidas: true });
    expect(apiFetch).toHaveBeenCalledWith("/cuentas-por-cobrar?sucursal=TJ&soloVencidas=true");
  });
});

describe("textoVence", () => {
  it("sin plazo, al corriente, 1 día y varios días", () => {
    expect(textoVence({ vence: null, diasAtraso: 0 })).toBe("Sin plazo");
    expect(textoVence({ vence: "2026-10-25", diasAtraso: 0 })).toBe("25/10/2026 · Al corriente");
    expect(textoVence({ vence: "2026-10-13", diasAtraso: 1 })).toBe("13/10/2026 · 1 día");
    expect(textoVence({ vence: "2026-09-28", diasAtraso: 16 })).toBe("28/09/2026 · 16 días");
  });
});

describe("enlaceCobrar", () => {
  it("lleva cliente y nota, y la sucursal si hay", () => {
    expect(enlaceCobrar("c1", "n1", null)).toBe("/operacion/cobranza?cliente=c1&nota=n1");
    expect(enlaceCobrar("c1", "n1", "TJ")).toBe("/operacion/cobranza?cliente=c1&nota=n1&sucursal=TJ");
  });
});

describe("definicionExcelCuentasPorCobrar", () => {
  it("una fila por nota, en pesos, con total y nombre de archivo", () => {
    const def = definicionExcelCuentasPorCobrar(DATOS, { sucursal: "TJ", soloVencidas: false });
    expect(def.titulo).toBe("Cuentas por Cobrar");
    expect(def.filtros).toEqual([
      ["Fecha", "14/10/2026"],
      ["Sucursal", "TJ"],
      ["Notas", "Todas"],
    ]);
    expect(def.columnas.map((c) => c.encabezado)).toEqual([
      "Cliente", "Sucursal", "Fecha", "Folio", "# nota", "Total", "Abonado", "Saldo", "Status", "Vence", "Días de atraso",
    ]);
    expect(def.filas).toEqual([
      { celdas: ["Cobach XXI", "TJ", "2026-09-13", "TJ260913AP05", "2346", 149.5, 0, 149.5, "Pendiente", "2026-09-28", 16], resaltada: true },
      { celdas: ["Cobach XXI", "TJ", "2026-10-10", "TJ261010AP02", "", 200, 50.5, 149.5, "Abonado", "Sin plazo", 0], resaltada: false },
      { tipo: "total", celdas: ["Total", null, null, null, null, 349.5, 50.5, 299, null, null, null] },
    ]);
    expect(def.nombreArchivo).toBe("cuentas-por-cobrar-TJ-2026-10-14");
  });

  it("Todas → archivo con 'todas'; solo vencidas lo dice en los filtros", () => {
    const def = definicionExcelCuentasPorCobrar(DATOS, { sucursal: "Todas", soloVencidas: true });
    expect(def.filtros[2]).toEqual(["Notas", "Solo vencidas"]);
    expect(def.nombreArchivo).toBe("cuentas-por-cobrar-todas-2026-10-14");
  });
});

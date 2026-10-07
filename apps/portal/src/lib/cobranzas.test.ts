import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  aplicarSaldoFavor,
  buscarPorCobrar,
  describirAplicacion,
  leerMontoCentavos,
  porCobrarDeCliente,
  registrarCobro,
  textoMonto,
  vistaPreviaCobro,
} from "./cobranzas";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

describe("lib/cobranzas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetch.mockResolvedValue({});
  });

  it("porCobrarDeCliente pide por clienteId", async () => {
    await porCobrarDeCliente("c1");
    expect(apiFetch).toHaveBeenCalledWith("/cobranzas/por-cobrar?clienteId=c1");
  });

  it("buscarPorCobrar manda la fecha o el # de nota, y la sucursal si hay", async () => {
    await buscarPorCobrar({ fecha: "2026-10-01" }, "TJ");
    expect(apiFetch).toHaveBeenLastCalledWith("/cobranzas/por-cobrar?fecha=2026-10-01&sucursal=TJ");
    await buscarPorCobrar({ numNota: " 77 " }, null);
    expect(apiFetch).toHaveBeenLastCalledWith("/cobranzas/por-cobrar?numNota=77");
  });

  it("vista previa, pago y saldo a favor hacen POST con el cuerpo", async () => {
    await vistaPreviaCobro({ clienteId: "c1", notaIds: ["n1"], montoCentavos: 100, modo: "pago" });
    expect(apiFetch).toHaveBeenLastCalledWith("/cobranzas/vista-previa", {
      method: "POST",
      body: JSON.stringify({ clienteId: "c1", notaIds: ["n1"], montoCentavos: 100, modo: "pago" }),
    });
    const cobro = {
      clienteId: "c1",
      notaIds: ["n1"],
      montoCentavos: 100,
      fechaPago: "2026-10-01",
      metodoPago: "transferencia" as const,
      vendedorId: null,
    };
    await registrarCobro(cobro);
    expect(apiFetch).toHaveBeenLastCalledWith("/cobranzas", { method: "POST", body: JSON.stringify(cobro) });
    await aplicarSaldoFavor({ clienteId: "c1", notaIds: ["n1"], montoCentavos: 100 });
    expect(apiFetch).toHaveBeenLastCalledWith("/cobranzas/saldo-favor", {
      method: "POST",
      body: JSON.stringify({ clienteId: "c1", notaIds: ["n1"], montoCentavos: 100 }),
    });
  });
});

describe("leerMontoCentavos (Review Focus 4)", () => {
  it.each<[string, number]>([
    ["1500", 150000],
    ["1,500.50", 150050],
    ["$200", 20000],
    ["$ 1,234,567.89", 123456789],
    ["10.5", 1050],
    [" 0.07 ", 7],
    // 19.99 * 100 da 1998.9999999999998 en coma flotante: aquí no.
    ["19.99", 1999],
  ])("%s son %d centavos", (texto, centavos) => {
    expect(leerMontoCentavos(texto)).toBe(centavos);
  });

  it.each(["", "0", "0.00", "10.005", "1,50", "12,34.00", "-5", "abc", "1.2.3", "1e3"])(
    "%j no es un monto",
    (texto) => {
      expect(leerMontoCentavos(texto)).toBeNull();
    },
  );
});

describe("textos del cobro", () => {
  it("textoMonto escribe los centavos sin coma flotante", () => {
    expect(textoMonto(150050)).toBe("1500.50");
    expect(textoMonto(7)).toBe("0.07");
  });

  it("describirAplicacion dice si queda pagada o lo que debe (§3.3)", () => {
    const base = {
      notaId: "n1",
      folio: "TJ261001AP03",
      numNota: null,
      fecha: "2026-10-01",
      saldoAntesCentavos: 70000,
      palomeada: true,
    };
    expect(
      describirAplicacion({ ...base, montoCentavos: 70000, saldoDespuesCentavos: 0, status: "pagada" }),
    ).toBe("TJ261001AP03 pagada");
    expect(
      describirAplicacion({ ...base, montoCentavos: 20000, saldoDespuesCentavos: 50000, status: "abonado" }),
    ).toBe("TJ261001AP03 abono $200.00, debe $500.00");
  });
});

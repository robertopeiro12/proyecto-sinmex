import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import * as cobranzasLib from "@/lib/cobranzas";
import type { ClientePorCobrar, NotaPorCobrar, PlanDeCobro } from "@/lib/cobranzas";
import { AplicarSaldoFavor } from "./aplicar-saldo-favor";

vi.mock("@/lib/cobranzas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cobranzas")>();
  return { ...real, vistaPreviaCobro: vi.fn(), aplicarSaldoFavor: vi.fn() };
});

const vistaPreviaCobro = vi.mocked(cobranzasLib.vistaPreviaCobro);
const aplicarSaldoFavor = vi.mocked(cobranzasLib.aplicarSaldoFavor);

const N1: NotaPorCobrar = {
  id: "n1", folio: "TJ240401OF01", numNota: null, fecha: "2024-04-01", clienteId: "c1", cliente: "Cobach XXI",
  sucursalCodigo: "TJ", montoCentavos: 10000, saldoCentavos: 10000, status: "pendiente", abonos: [],
};
const N2: NotaPorCobrar = { ...N1, id: "n2", folio: "TJ240402OF01", fecha: "2024-04-02", saldoCentavos: 6000 };
const CLIENTE: ClientePorCobrar = {
  id: "c1", nombre: "Cobach XXI", sucursalId: "suc-tj", sucursalCodigo: "TJ", saldoFavorCentavos: 30000, notas: [N1, N2],
};
const PLAN: PlanDeCobro = {
  aplicaciones: [
    { notaId: "n1", folio: "TJ240401OF01", numNota: null, fecha: "2024-04-01", montoCentavos: 10000, saldoAntesCentavos: 10000, saldoDespuesCentavos: 0, status: "pagada", palomeada: true },
    { notaId: "n2", folio: "TJ240402OF01", numNota: null, fecha: "2024-04-02", montoCentavos: 6000, saldoAntesCentavos: 6000, saldoDespuesCentavos: 0, status: "pagada", palomeada: true },
  ],
  saldoFavorCentavos: 0,
};

function renderizar() {
  const onAplicado = vi.fn();
  const onDesactualizado = vi.fn();
  render(<AplicarSaldoFavor cliente={CLIENTE} palomeadas={[N1, N2]} onAplicado={onAplicado} onDesactualizado={onDesactualizado} />);
  return { usuario: userEvent.setup(), onAplicado, onDesactualizado };
}

describe("AplicarSaldoFavor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vistaPreviaCobro.mockResolvedValue(PLAN);
    aplicarSaldoFavor.mockResolvedValue({ ...PLAN, cliente: "Cobach XXI", montoCentavos: 16000 });
  });

  it("propone el menor entre el saldo a favor y lo que deben las marcadas", () => {
    renderizar();
    expect(screen.getByLabelText("Monto a aplicar")).toHaveValue("160.00");
  });

  it("Review Focus 3: no deja pasar más del saldo a favor", async () => {
    const { usuario } = renderizar();
    await usuario.clear(screen.getByLabelText("Monto a aplicar"));
    await usuario.type(screen.getByLabelText("Monto a aplicar"), "301");
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    expect(screen.getByRole("alert")).toHaveTextContent("No puede ser mayor al saldo a favor ($300.00).");
    expect(vistaPreviaCobro).not.toHaveBeenCalled();
  });

  it("vista previa en modo saldo_favor; aplicar avisa con el mensaje", async () => {
    const { usuario, onAplicado } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    expect(vistaPreviaCobro).toHaveBeenCalledWith({
      clienteId: "c1",
      notaIds: ["n1", "n2"],
      montoCentavos: 16000,
      modo: "saldo_favor",
    });
    await usuario.click(await screen.findByRole("button", { name: "Aplicar saldo a favor" }));
    expect(aplicarSaldoFavor).toHaveBeenCalledWith({ clienteId: "c1", notaIds: ["n1", "n2"], montoCentavos: 16000 });
    expect(onAplicado).toHaveBeenCalledWith("Saldo a favor aplicado: $160.00 a Cobach XXI");
  });

  it("muestra el 409 del servidor", async () => {
    vistaPreviaCobro.mockRejectedValue(
      new ErrorApi("x", 409, "Las notas marcadas solo deben $160.00: no se puede aplicar más saldo a favor que eso."),
    );
    const { usuario } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Las notas marcadas solo deben $160.00");
  });

  it("un 409 'ya no tiene saldo' al aplicar pide recargar el cliente con el mensaje del servidor", async () => {
    const mensaje = "La nota TJ240401OF01 ya no tiene saldo; vuelve a cargar.";
    aplicarSaldoFavor.mockRejectedValue(new ErrorApi("x", 409, mensaje));
    const { usuario, onAplicado, onDesactualizado } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    await usuario.click(await screen.findByRole("button", { name: "Aplicar saldo a favor" }));
    expect(onDesactualizado).toHaveBeenCalledWith(mensaje);
    expect(onAplicado).not.toHaveBeenCalled();
  });
});

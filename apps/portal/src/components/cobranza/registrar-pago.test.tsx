import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import * as cobranzasLib from "@/lib/cobranzas";
import type { ClientePorCobrar, NotaPorCobrar, PlanDeCobro } from "@/lib/cobranzas";
import * as ventasLib from "@/lib/ventas";
import { hoyEnTijuana } from "@/lib/ventas";
import { RegistrarPago } from "./registrar-pago";

vi.mock("@/lib/cobranzas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cobranzas")>();
  return { ...real, vistaPreviaCobro: vi.fn(), registrarCobro: vi.fn() };
});
vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return { ...real, listarRepartidores: vi.fn() };
});

const vistaPreviaCobro = vi.mocked(cobranzasLib.vistaPreviaCobro);
const registrarCobro = vi.mocked(cobranzasLib.registrarCobro);

const N1: NotaPorCobrar = {
  id: "n1", folio: "TJ240401OF01", numNota: null, fecha: "2024-04-01", clienteId: "c1", cliente: "Cobach XXI",
  sucursalCodigo: "TJ", montoCentavos: 10000, saldoCentavos: 10000, status: "pendiente", abonos: [],
};
const N2: NotaPorCobrar = {
  ...N1, id: "n2", folio: "TJ240402OF01", fecha: "2024-04-02", montoCentavos: 8000, saldoCentavos: 6000, status: "abonado",
};
const CLIENTE: ClientePorCobrar = {
  id: "c1", nombre: "Cobach XXI", sucursalId: "suc-tj", sucursalCodigo: "TJ", saldoFavorCentavos: 0, notas: [N1, N2],
};
const PLAN: PlanDeCobro = {
  aplicaciones: [
    { notaId: "n1", folio: "TJ240401OF01", numNota: null, fecha: "2024-04-01", montoCentavos: 10000, saldoAntesCentavos: 10000, saldoDespuesCentavos: 0, status: "pagada", palomeada: true },
    { notaId: "n2", folio: "TJ240402OF01", numNota: null, fecha: "2024-04-02", montoCentavos: 5000, saldoAntesCentavos: 6000, saldoDespuesCentavos: 1000, status: "abonado", palomeada: true },
  ],
  saldoFavorCentavos: 0,
};

function renderizar() {
  const onRegistrado = vi.fn();
  const onDesactualizado = vi.fn();
  render(
    <RegistrarPago cliente={CLIENTE} palomeadas={[N2, N1]} onRegistrado={onRegistrado} onDesactualizado={onDesactualizado} />,
  );
  return { usuario: userEvent.setup(), onRegistrado, onDesactualizado };
}

describe("RegistrarPago", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ventasLib.listarRepartidores).mockResolvedValue([{ id: "v1", nombre: "Ana" }]);
    vistaPreviaCobro.mockResolvedValue(PLAN);
    registrarCobro.mockResolvedValue({ ...PLAN, cliente: "Cobach XXI", montoCentavos: 15000 });
  });

  it("Review Focus 4: un monto con 3 decimales no pide vista previa y lo dice", async () => {
    const { usuario } = renderizar();
    await usuario.type(screen.getByLabelText("Monto"), "150.005");
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "El monto debe ser mayor a $0 y tener a lo más 2 decimales.",
    );
    expect(vistaPreviaCobro).not.toHaveBeenCalled();
  });

  it("Review Focus 2: una fecha anterior a la nota más vieja, o futura, se avisa sin llamar al servidor", async () => {
    const { usuario } = renderizar();
    await usuario.type(screen.getByLabelText("Monto"), "150");
    fireEvent.change(screen.getByLabelText("Fecha del pago"), { target: { value: "2024-03-31" } });
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "La fecha del pago no puede ser anterior a la nota más vieja que marcaste (2024-04-01).",
    );
    fireEvent.change(screen.getByLabelText("Fecha del pago"), { target: { value: "2999-01-01" } });
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    expect(screen.getByRole("alert")).toHaveTextContent("La fecha del pago no puede ser futura.");
    expect(vistaPreviaCobro).not.toHaveBeenCalled();
  });

  it("Review Focus 4: la vista previa va en centavos exactos y dice cómo quedan las notas", async () => {
    const { usuario } = renderizar();
    await usuario.type(screen.getByLabelText("Monto"), "1,500.50");
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    expect(vistaPreviaCobro).toHaveBeenCalledWith({
      clienteId: "c1",
      notaIds: ["n2", "n1"],
      montoCentavos: 150050,
      modo: "pago",
    });
    expect(await screen.findByText("TJ240401OF01 pagada")).toBeInTheDocument();
    expect(screen.getByText("TJ240402OF01 abono $50.00, debe $10.00")).toBeInTheDocument();
  });

  it("grabar manda Oficina, transferencia y hoy por default, y avisa con el mensaje del spec", async () => {
    const { usuario, onRegistrado } = renderizar();
    await usuario.type(screen.getByLabelText("Monto"), "150");
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    await usuario.click(await screen.findByRole("button", { name: "Grabar cobro" }));
    expect(registrarCobro).toHaveBeenCalledWith({
      clienteId: "c1",
      notaIds: ["n2", "n1"],
      montoCentavos: 15000,
      fechaPago: hoyEnTijuana(),
      metodoPago: "transferencia",
      vendedorId: null,
    });
    expect(onRegistrado).toHaveBeenCalledWith("Cobro registrado: $150.00 a Cobach XXI");
  });

  it("un repartidor y cheque viajan en el cuerpo", async () => {
    const { usuario } = renderizar();
    await screen.findByRole("option", { name: "Ana" });
    await usuario.selectOptions(screen.getByLabelText("Cobró"), "v1");
    await usuario.selectOptions(screen.getByLabelText("Método"), "cheque");
    await usuario.type(screen.getByLabelText("Monto"), "150");
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    await usuario.click(await screen.findByRole("button", { name: "Grabar cobro" }));
    expect(registrarCobro).toHaveBeenCalledWith(
      expect.objectContaining({ vendedorId: "v1", metodoPago: "cheque" }),
    );
  });

  it("cambiar el monto después de la vista previa la quita: lo que se graba es lo que se vio", async () => {
    const { usuario } = renderizar();
    await usuario.type(screen.getByLabelText("Monto"), "150");
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    await screen.findByRole("button", { name: "Grabar cobro" });
    await usuario.type(screen.getByLabelText("Monto"), "0");
    expect(screen.queryByRole("button", { name: "Grabar cobro" })).not.toBeInTheDocument();
  });

  it("muestra el mensaje del servidor cuando el 409 no es de saldo", async () => {
    registrarCobro.mockRejectedValue(new ErrorApi("x", 409, "Otro conflicto del servidor."));
    const { usuario, onRegistrado, onDesactualizado } = renderizar();
    await usuario.type(screen.getByLabelText("Monto"), "150");
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    await usuario.click(await screen.findByRole("button", { name: "Grabar cobro" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Otro conflicto del servidor.");
    expect(onRegistrado).not.toHaveBeenCalled();
    expect(onDesactualizado).not.toHaveBeenCalled();
  });

  it("un 409 'ya no tiene saldo' pide recargar el cliente con el mensaje del servidor", async () => {
    const mensaje = "La nota TJ240401OF01 ya no tiene saldo; vuelve a cargar.";
    registrarCobro.mockRejectedValue(new ErrorApi("x", 409, mensaje));
    const { usuario, onRegistrado, onDesactualizado } = renderizar();
    await usuario.type(screen.getByLabelText("Monto"), "150");
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    await usuario.click(await screen.findByRole("button", { name: "Grabar cobro" }));
    expect(onDesactualizado).toHaveBeenCalledWith(mensaje);
    expect(onRegistrado).not.toHaveBeenCalled();
  });

  it("una fecha de pago vacía dice 'Elige la fecha del pago.' antes que lo de la nota más vieja", async () => {
    const { usuario } = renderizar();
    await usuario.type(screen.getByLabelText("Monto"), "150");
    fireEvent.change(screen.getByLabelText("Fecha del pago"), { target: { value: "" } });
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Elige la fecha del pago.");
    expect(vistaPreviaCobro).not.toHaveBeenCalled();
  });
});

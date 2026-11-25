import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import * as cobranzasLib from "@/lib/cobranzas";
import type { ClientePorCobrar, NotaPorCobrar, PlanDeCobro } from "@/lib/cobranzas";
import * as ventasLib from "@/lib/ventas";
import { hoyEnTijuana } from "@/lib/ventas";
import { RecuadroCobro } from "./recuadro-cobro";

vi.mock("@/lib/cobranzas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cobranzas")>();
  return { ...real, porCobrarDeCliente: vi.fn(), vistaPreviaCobro: vi.fn(), registrarCobro: vi.fn(), aplicarSaldoFavor: vi.fn() };
});
vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return { ...real, listarRepartidores: vi.fn() };
});

const vistaPreviaCobro = vi.mocked(cobranzasLib.vistaPreviaCobro);

const N1: NotaPorCobrar = {
  id: "n1", folio: "TJ261120OF01", numNota: null, fecha: "2026-11-20", clienteId: "c1", cliente: "Cobach",
  sucursalCodigo: "TJ", montoCentavos: 200000, saldoCentavos: 200000, status: "pendiente", abonos: [],
};
const DATOS: ClientePorCobrar = {
  id: "c1", nombre: "Cobach", sucursalId: "s", sucursalCodigo: "TJ", saldoFavorCentavos: 50000, notas: [N1],
};
const plan = (monto: number): PlanDeCobro => ({
  aplicaciones: [
    { notaId: "n1", folio: "TJ261120OF01", numNota: null, fecha: "2026-11-20", montoCentavos: monto, saldoAntesCentavos: 200000, saldoDespuesCentavos: 200000 - monto, status: "abonado", palomeada: true },
  ],
  saldoFavorCentavos: 0,
});

/** Promesas que la prueba resuelve en el orden que quiere. */
function diferidas() {
  const pendientes: { resolver: (p: PlanDeCobro) => void; fallar: (e: unknown) => void }[] = [];
  vistaPreviaCobro.mockImplementation(
    () => new Promise<PlanDeCobro>((resolver, fallar) => pendientes.push({ resolver, fallar })),
  );
  return pendientes;
}

async function abrir() {
  const u = userEvent.setup();
  render(<RecuadroCobro clienteId="c1" notaIds={["n1"]} onTerminado={vi.fn()} onCancelar={vi.fn()} onSucio={vi.fn()} />);
  const recuadro = await screen.findByRole("region", { name: "Cobrar 1 nota" });
  await within(recuadro).findByLabelText("Monto");
  return { u, recuadro };
}

describe("RecuadroCobro (revisión T-2): respuestas de la vista previa fuera de orden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cobranzasLib.porCobrarDeCliente).mockResolvedValue(DATOS);
    vi.mocked(ventasLib.listarRepartidores).mockResolvedValue([]);
  });

  it("pago: la respuesta vieja que llega tarde no pisa a la nueva", async () => {
    const pendientes = diferidas();
    const { u, recuadro } = await abrir();
    await u.type(within(recuadro).getByLabelText("Monto"), "100");
    await waitFor(() => expect(pendientes).toHaveLength(1));
    await u.type(within(recuadro).getByLabelText("Monto"), "0");
    await waitFor(() => expect(pendientes).toHaveLength(2));
    pendientes[1].resolver(plan(100000));
    expect(await within(recuadro).findByText(/abono \$1,000\.00/)).toBeInTheDocument();
    pendientes[0].resolver(plan(10000));
    await new Promise((r) => setTimeout(r, 20));
    expect(within(recuadro).getByText(/abono \$1,000\.00/)).toBeInTheDocument();
    expect(within(recuadro).getByRole("button", { name: "Grabar pago" })).toBeEnabled();
  });

  it("pago: el error de una petición vieja no se pinta junto a un Así queda bueno", async () => {
    const pendientes = diferidas();
    const { u, recuadro } = await abrir();
    await u.type(within(recuadro).getByLabelText("Monto"), "100");
    await waitFor(() => expect(pendientes).toHaveLength(1));
    await u.type(within(recuadro).getByLabelText("Monto"), "0");
    await waitFor(() => expect(pendientes).toHaveLength(2));
    pendientes[1].resolver(plan(100000));
    await within(recuadro).findByText(/abono \$1,000\.00/);
    pendientes[0].fallar(new ErrorApi("x", 400, "Falló la vieja."));
    await new Promise((r) => setTimeout(r, 20));
    expect(within(recuadro).queryByText("Falló la vieja.")).toBeNull();
    expect(within(recuadro).getByRole("button", { name: "Grabar pago" })).toBeEnabled();
  });

  it("saldo a favor: la respuesta vieja que llega tarde no pisa a la nueva", async () => {
    const pendientes = diferidas();
    const { u, recuadro } = await abrir();
    await u.click(within(recuadro).getByRole("button", { name: "Usar saldo a favor ($500.00)" }));
    // La primera sale sola con el monto propuesto (500.00).
    await waitFor(() => expect(pendientes).toHaveLength(1));
    const campo = within(recuadro).getByLabelText("Monto a aplicar");
    await u.clear(campo);
    await u.type(campo, "400");
    await waitFor(() => expect(pendientes).toHaveLength(2));
    pendientes[1].resolver(plan(40000));
    expect(await within(recuadro).findByText(/abono \$400\.00/)).toBeInTheDocument();
    pendientes[0].resolver(plan(50000));
    await new Promise((r) => setTimeout(r, 20));
    expect(within(recuadro).getByText(/abono \$400\.00/)).toBeInTheDocument();
    expect(within(recuadro).getByRole("button", { name: "Aplicar saldo a favor" })).toBeEnabled();
  });
});

// Lo que probaban `RegistrarPago` y `AplicarSaldoFavor` de la Cobranza vieja (se
// borraron con ella): la misma lógica (`usePago`, `useSaldoFavor`) por el recuadro.
describe("RecuadroCobro: reglas del pago y del saldo a favor", () => {
  const A1: NotaPorCobrar = {
    id: "n1", folio: "TJ240401OF01", numNota: null, fecha: "2024-04-01", clienteId: "c1", cliente: "Cobach XXI",
    sucursalCodigo: "TJ", montoCentavos: 10000, saldoCentavos: 10000, status: "pendiente", abonos: [],
  };
  const A2: NotaPorCobrar = { ...A1, id: "n2", folio: "TJ240402OF01", fecha: "2024-04-02", montoCentavos: 8000, saldoCentavos: 6000, status: "abonado" };
  const CLIENTE: ClientePorCobrar = {
    id: "c1", nombre: "Cobach XXI", sucursalId: "suc-tj", sucursalCodigo: "TJ", saldoFavorCentavos: 30000, notas: [A1, A2],
  };
  const PLAN: PlanDeCobro = {
    aplicaciones: [
      { notaId: "n1", folio: "TJ240401OF01", numNota: null, fecha: "2024-04-01", montoCentavos: 10000, saldoAntesCentavos: 10000, saldoDespuesCentavos: 0, status: "pagada", palomeada: true },
      { notaId: "n2", folio: "TJ240402OF01", numNota: null, fecha: "2024-04-02", montoCentavos: 5000, saldoAntesCentavos: 6000, saldoDespuesCentavos: 1000, status: "abonado", palomeada: true },
    ],
    saldoFavorCentavos: 0,
  };
  const registrarCobro = vi.mocked(cobranzasLib.registrarCobro);
  const aplicarSaldoFavor = vi.mocked(cobranzasLib.aplicarSaldoFavor);
  /** Más que la pausa de la vista previa sola (300 ms). */
  const pasaLaPausa = () => new Promise((r) => setTimeout(r, 400));

  async function abrirCon() {
    const u = userEvent.setup();
    const onTerminado = vi.fn();
    render(<RecuadroCobro clienteId="c1" notaIds={["n1", "n2"]} onTerminado={onTerminado} onCancelar={vi.fn()} onSucio={vi.fn()} />);
    const recuadro = await screen.findByRole("region", { name: "Cobrar 2 notas" });
    await within(recuadro).findByLabelText("Monto");
    return { u, recuadro, onTerminado };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cobranzasLib.porCobrarDeCliente).mockResolvedValue(CLIENTE);
    vi.mocked(ventasLib.listarRepartidores).mockResolvedValue([{ id: "v1", nombre: "Ana" }]);
    vistaPreviaCobro.mockResolvedValue(PLAN);
    registrarCobro.mockResolvedValue({ ...PLAN, cliente: "Cobach XXI", montoCentavos: 15000 });
    aplicarSaldoFavor.mockResolvedValue({ ...PLAN, cliente: "Cobach XXI", montoCentavos: 16000 });
  });

  it("un monto con 3 decimales no pide vista previa y lo dice", async () => {
    const { u, recuadro } = await abrirCon();
    await u.type(within(recuadro).getByLabelText("Monto"), "150.005");
    await pasaLaPausa();
    expect(within(recuadro).getByRole("alert")).toHaveTextContent("El monto debe ser mayor a $0 y tener a lo más 2 decimales.");
    expect(vistaPreviaCobro).not.toHaveBeenCalled();
  });

  it("una fecha vacía, anterior a la nota más vieja o futura se avisa sin llamar al servidor", async () => {
    const { u, recuadro } = await abrirCon();
    await u.type(within(recuadro).getByLabelText("Monto"), "150");
    const fecha = within(recuadro).getByLabelText("Fecha");
    fireEvent.change(fecha, { target: { value: "" } });
    expect(within(recuadro).getByRole("alert")).toHaveTextContent("Elige la fecha del pago.");
    fireEvent.change(fecha, { target: { value: "2024-03-31" } });
    expect(within(recuadro).getByRole("alert")).toHaveTextContent(
      "La fecha del pago no puede ser anterior a la nota más vieja que marcaste (01/04/2024).",
    );
    fireEvent.change(fecha, { target: { value: "2999-01-01" } });
    expect(within(recuadro).getByRole("alert")).toHaveTextContent("La fecha del pago no puede ser futura.");
    await pasaLaPausa();
    expect(vistaPreviaCobro).not.toHaveBeenCalled();
  });

  it("la vista previa va en centavos exactos y dice cómo quedan las notas", async () => {
    const { u, recuadro } = await abrirCon();
    await u.type(within(recuadro).getByLabelText("Monto"), "1,500.50");
    await waitFor(() =>
      expect(vistaPreviaCobro).toHaveBeenLastCalledWith({ clienteId: "c1", notaIds: ["n1", "n2"], montoCentavos: 150050, modo: "pago" }),
    );
    expect(await within(recuadro).findByText("TJ240401OF01 pagada")).toBeInTheDocument();
    expect(within(recuadro).getByText("TJ240402OF01 abono $50.00, debe $10.00")).toBeInTheDocument();
  });

  it("grabar manda Oficina, transferencia y hoy por default, y avisa en verde", async () => {
    const { u, recuadro, onTerminado } = await abrirCon();
    await u.type(within(recuadro).getByLabelText("Monto"), "150");
    const grabar = within(recuadro).getByRole("button", { name: "Grabar pago" });
    await waitFor(() => expect(grabar).toBeEnabled());
    await u.click(grabar);
    expect(registrarCobro).toHaveBeenCalledWith({
      clienteId: "c1", notaIds: ["n1", "n2"], montoCentavos: 15000, fechaPago: hoyEnTijuana(), metodoPago: "transferencia", vendedorId: null,
    });
    expect(onTerminado).toHaveBeenCalledWith({ texto: "Cobro registrado: $150.00 a Cobach XXI", tono: "exito" });
  });

  it("un repartidor y cheque viajan en el cuerpo", async () => {
    const { u, recuadro } = await abrirCon();
    await within(recuadro).findByRole("option", { name: "Ana" });
    await u.selectOptions(within(recuadro).getByLabelText("Cobró"), "v1");
    await u.selectOptions(within(recuadro).getByLabelText("Método"), "cheque");
    await u.type(within(recuadro).getByLabelText("Monto"), "150");
    const grabar = within(recuadro).getByRole("button", { name: "Grabar pago" });
    await waitFor(() => expect(grabar).toBeEnabled());
    await u.click(grabar);
    expect(registrarCobro).toHaveBeenCalledWith(expect.objectContaining({ vendedorId: "v1", metodoPago: "cheque" }));
  });

  it("un 409 que no es de saldo se muestra; uno de 'ya no tiene saldo' termina en ámbar con el mensaje", async () => {
    registrarCobro.mockRejectedValueOnce(new ErrorApi("x", 409, "Otro conflicto del servidor."));
    const mensaje = "La nota TJ240401OF01 ya no tiene saldo; vuelve a cargar.";
    registrarCobro.mockRejectedValueOnce(new ErrorApi("x", 409, mensaje));
    const { u, recuadro, onTerminado } = await abrirCon();
    await u.type(within(recuadro).getByLabelText("Monto"), "150");
    const grabar = within(recuadro).getByRole("button", { name: "Grabar pago" });
    await waitFor(() => expect(grabar).toBeEnabled());
    await u.click(grabar);
    expect(await within(recuadro).findByRole("alert")).toHaveTextContent("Otro conflicto del servidor.");
    expect(onTerminado).not.toHaveBeenCalled();
    await u.click(grabar);
    expect(onTerminado).toHaveBeenCalledWith({ texto: mensaje, tono: "advertencia" });
  });

  it("saldo a favor: propone el menor, no deja pasar más del saldo, aplica y el 409 de saldo termina en ámbar", async () => {
    const { u, recuadro, onTerminado } = await abrirCon();
    await u.click(within(recuadro).getByRole("button", { name: "Usar saldo a favor ($300.00)" }));
    const campo = within(recuadro).getByLabelText("Monto a aplicar");
    expect(campo).toHaveValue("160.00");
    await waitFor(() =>
      expect(vistaPreviaCobro).toHaveBeenLastCalledWith({ clienteId: "c1", notaIds: ["n1", "n2"], montoCentavos: 16000, modo: "saldo_favor" }),
    );
    const aplicar = within(recuadro).getByRole("button", { name: "Aplicar saldo a favor" });
    await waitFor(() => expect(aplicar).toBeEnabled());
    await u.click(aplicar);
    expect(aplicarSaldoFavor).toHaveBeenCalledWith({ clienteId: "c1", notaIds: ["n1", "n2"], montoCentavos: 16000 });
    expect(onTerminado).toHaveBeenLastCalledWith({ texto: "Saldo a favor aplicado: $160.00 a Cobach XXI", tono: "exito" });

    vistaPreviaCobro.mockClear();
    await u.clear(campo);
    await u.type(campo, "301");
    expect(within(recuadro).getByRole("alert")).toHaveTextContent("No puede ser mayor al saldo a favor ($300.00).");
    await pasaLaPausa();
    expect(vistaPreviaCobro).not.toHaveBeenCalled();

    const mensaje = "La nota TJ240401OF01 ya no tiene saldo; vuelve a cargar.";
    aplicarSaldoFavor.mockRejectedValueOnce(new ErrorApi("x", 409, mensaje));
    await u.clear(campo);
    await u.type(campo, "160");
    await waitFor(() => expect(aplicar).toBeEnabled());
    await u.click(aplicar);
    expect(onTerminado).toHaveBeenLastCalledWith({ texto: mensaje, tono: "advertencia" });
  });
});

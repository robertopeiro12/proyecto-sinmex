import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as cobranzasLib from "@/lib/cobranzas";
import type { ClientePorCobrar, NotaPorCobrar } from "@/lib/cobranzas";
import * as ventasLib from "@/lib/ventas";
import type { VentaDetalle } from "@/lib/ventas";
import { CobranzaCliente } from "./cobranza-cliente";

vi.mock("@/lib/cobranzas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cobranzas")>();
  return {
    ...real,
    porCobrarDeCliente: vi.fn(),
    vistaPreviaCobro: vi.fn(),
    registrarCobro: vi.fn(),
    aplicarSaldoFavor: vi.fn(),
  };
});
vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return { ...real, marcarCuentaPerdida: vi.fn(), listarRepartidores: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");

const porCobrarDeCliente = vi.mocked(cobranzasLib.porCobrarDeCliente);
const marcarCuentaPerdida = vi.mocked(ventasLib.marcarCuentaPerdida);
const listarRepartidores = vi.mocked(ventasLib.listarRepartidores);

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede });
}

const N1: NotaPorCobrar = {
  id: "n1", folio: "TJ240401OF01", numNota: null, fecha: "2024-04-01", clienteId: "c1", cliente: "Cobach XXI",
  sucursalCodigo: "TJ", montoCentavos: 10000, saldoCentavos: 10000, status: "pendiente", abonos: [],
};
const N2: NotaPorCobrar = {
  ...N1, id: "n2", folio: "TJ240402OF01", numNota: "77", fecha: "2024-04-02", montoCentavos: 8000, saldoCentavos: 5000,
  status: "abonado",
  abonos: [{ fechaPago: "2024-04-03", montoCentavos: 3000, metodoPago: "saldo_favor", origen: "saldo_favor" }],
};
const DATOS: ClientePorCobrar = {
  id: "c1", nombre: "Cobach XXI", sucursalId: "suc-tj", sucursalCodigo: "TJ", saldoFavorCentavos: 0, notas: [N1, N2],
};

function renderizar(notaInicial: string | null = null) {
  const onVolver = vi.fn();
  render(<CobranzaCliente clienteId="c1" notaInicial={notaInicial} onVolver={onVolver} />);
  return { usuario: userEvent.setup(), onVolver };
}

describe("CobranzaCliente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockAuth(() => true);
    porCobrarDeCliente.mockResolvedValue(DATOS);
    listarRepartidores.mockResolvedValue([]);
  });

  it("muestra sus notas por cobrar con su saldo; la nota con la que entró ya va marcada", async () => {
    renderizar("n2");
    expect(await screen.findByText("Cobranza · Cobach XXI")).toBeInTheDocument();
    expect(porCobrarDeCliente).toHaveBeenCalledWith("c1");
    expect(screen.getByLabelText("Marcar TJ240402OF01")).toBeChecked();
    expect(screen.getByLabelText("Marcar TJ240401OF01")).not.toBeChecked();
    expect(screen.getByText("$50.00")).toBeInTheDocument();
    expect(screen.getByText("Abonado")).toBeInTheDocument();
  });

  it("los abonos anteriores dicen fecha, monto y método (Saldo a favor incluido)", async () => {
    renderizar();
    expect(await screen.findByText("1 abono")).toBeInTheDocument();
    expect(screen.getByText("2024-04-03 · $30.00 · Saldo a favor")).toBeInTheDocument();
  });

  it("el saldo a favor del cliente se ve solo si hay", async () => {
    porCobrarDeCliente.mockResolvedValue({ ...DATOS, saldoFavorCentavos: 2500 });
    renderizar();
    expect(await screen.findByText("$25.00")).toBeInTheDocument();
    expect(screen.getByText(/Saldo a favor:/)).toBeInTheDocument();
  });

  it("sin notas por cobrar lo dice", async () => {
    porCobrarDeCliente.mockResolvedValue({ ...DATOS, notas: [] });
    renderizar();
    expect(await screen.findByText("Este cliente no tiene notas por cobrar.")).toBeInTheDocument();
  });

  it("Marcar como cuenta perdida confirma, marca y recarga", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    marcarCuentaPerdida.mockResolvedValue({} as VentaDetalle);
    const { usuario } = renderizar();
    await usuario.click(await screen.findByRole("button", { name: "Marcar TJ240401OF01 como cuenta perdida" }));
    expect(confirmar).toHaveBeenCalledWith("La venta TJ240401OF01 dejará de cobrarse. ¿Continuar?");
    expect(marcarCuentaPerdida).toHaveBeenCalledWith("n1");
    expect(await screen.findByRole("status")).toHaveTextContent("La venta TJ240401OF01 quedó como cuenta perdida.");
    await waitFor(() => expect(porCobrarDeCliente).toHaveBeenCalledTimes(2));
  });

  it("si no confirma, no marca nada", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { usuario } = renderizar();
    await usuario.click(await screen.findByRole("button", { name: "Marcar TJ240401OF01 como cuenta perdida" }));
    expect(marcarCuentaPerdida).not.toHaveBeenCalled();
  });

  it("sin venta.editar_eliminar no hay botón de cuenta perdida", async () => {
    mockAuth((clave) => clave !== "venta.editar_eliminar");
    renderizar();
    await screen.findByText("Cobranza · Cobach XXI");
    expect(screen.queryByRole("button", { name: /como cuenta perdida/ })).not.toBeInTheDocument();
  });

  it("Volver avisa al padre", async () => {
    const { usuario, onVolver } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "← Volver a buscar" }));
    expect(onVolver).toHaveBeenCalledTimes(1);
  });

  it("si falla la carga lo dice", async () => {
    porCobrarDeCliente.mockRejectedValue(new Error("red"));
    renderizar();
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar la cobranza del cliente.");
  });
  it("con notas marcadas aparece Registrar pago; sin marcar, no", async () => {
    const { usuario } = renderizar();
    await screen.findByText("Cobranza · Cobach XXI");
    expect(screen.queryByRole("region", { name: "Registrar pago" })).not.toBeInTheDocument();
    await usuario.click(screen.getByLabelText("Marcar TJ240401OF01"));
    expect(screen.getByRole("region", { name: "Registrar pago" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Aplicar saldo a favor" })).not.toBeInTheDocument();
  });

  it("Aplicar saldo a favor aparece solo con saldo a favor y notas marcadas", async () => {
    porCobrarDeCliente.mockResolvedValue({ ...DATOS, saldoFavorCentavos: 2000 });
    renderizar("n1");
    expect(await screen.findByRole("region", { name: "Aplicar saldo a favor" })).toBeInTheDocument();
  });

  it("tras registrar el pago avisa y recarga la lista", async () => {
    vi.mocked(cobranzasLib.vistaPreviaCobro).mockResolvedValue({ aplicaciones: [], saldoFavorCentavos: 0 });
    vi.mocked(cobranzasLib.registrarCobro).mockResolvedValue({
      aplicaciones: [], saldoFavorCentavos: 0, cliente: "Cobach XXI", montoCentavos: 10000,
    });
    const { usuario } = renderizar("n1");
    const panel = await screen.findByRole("region", { name: "Registrar pago" });
    await usuario.type(within(panel).getByLabelText("Monto"), "100");
    await usuario.click(within(panel).getByRole("button", { name: "Vista previa" }));
    await usuario.click(await within(panel).findByRole("button", { name: "Grabar cobro" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Cobro registrado: $100.00 a Cobach XXI");
    await waitFor(() => expect(porCobrarDeCliente).toHaveBeenCalledTimes(2));
  });

  it("si la recarga falla se quita la tabla vieja y el formulario: nadie cobra sobre datos viejos", async () => {
    vi.mocked(cobranzasLib.vistaPreviaCobro).mockResolvedValue({ aplicaciones: [], saldoFavorCentavos: 0 });
    vi.mocked(cobranzasLib.registrarCobro).mockResolvedValue({
      aplicaciones: [], saldoFavorCentavos: 0, cliente: "Cobach XXI", montoCentavos: 10000,
    });
    const { usuario } = renderizar("n1");
    const panel = await screen.findByRole("region", { name: "Registrar pago" });
    porCobrarDeCliente.mockRejectedValue(new Error("red"));
    await usuario.type(within(panel).getByLabelText("Monto"), "100");
    await usuario.click(within(panel).getByRole("button", { name: "Vista previa" }));
    await usuario.click(await within(panel).findByRole("button", { name: "Grabar cobro" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("TJ240401OF01")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Registrar pago" })).not.toBeInTheDocument();
  });

  it("una recarga con la misma selección y otro saldo quita la vista previa del pago", async () => {
    vi.mocked(cobranzasLib.vistaPreviaCobro).mockResolvedValue({ aplicaciones: [], saldoFavorCentavos: 0 });
    const { usuario } = renderizar("n1");
    const panel = await screen.findByRole("region", { name: "Registrar pago" });
    await usuario.type(within(panel).getByLabelText("Monto"), "100");
    await usuario.click(within(panel).getByRole("button", { name: "Vista previa" }));
    await within(panel).findByRole("button", { name: "Grabar cobro" });
    // Alguien más cobró parte de n1: misma selección, otro saldo.
    porCobrarDeCliente.mockResolvedValue({ ...DATOS, notas: [{ ...N1, saldoCentavos: 4000 }, N2] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    marcarCuentaPerdida.mockResolvedValue({} as VentaDetalle);
    await usuario.click(screen.getByRole("button", { name: "Marcar TJ240402OF01 como cuenta perdida" }));
    await waitFor(() => expect(porCobrarDeCliente).toHaveBeenCalledTimes(2));
    await screen.findByText("$40.00");
    expect(screen.queryByRole("button", { name: "Grabar cobro" })).not.toBeInTheDocument();
  });

  it("tras un pago que no cambia el saldo a favor, el panel de saldo a favor pierde su vista previa y recalcula", async () => {
    porCobrarDeCliente.mockResolvedValue({ ...DATOS, saldoFavorCentavos: 20000 });
    vi.mocked(cobranzasLib.vistaPreviaCobro).mockResolvedValue({ aplicaciones: [], saldoFavorCentavos: 0 });
    vi.mocked(cobranzasLib.registrarCobro).mockResolvedValue({
      aplicaciones: [], saldoFavorCentavos: 0, cliente: "Cobach XXI", montoCentavos: 5000,
    });
    const { usuario } = renderizar("n1");
    const saldo = await screen.findByRole("region", { name: "Aplicar saldo a favor" });
    expect(within(saldo).getByLabelText("Monto a aplicar")).toHaveValue("100.00");
    await usuario.click(within(saldo).getByRole("button", { name: "Vista previa" }));
    await within(saldo).findByRole("button", { name: "Aplicar saldo a favor" });
    // El pago baja lo que debe n1 a $50; el saldo a favor y la selección siguen igual.
    porCobrarDeCliente.mockResolvedValue({
      ...DATOS, saldoFavorCentavos: 20000, notas: [{ ...N1, saldoCentavos: 5000 }, N2],
    });
    const pago = screen.getByRole("region", { name: "Registrar pago" });
    await usuario.type(within(pago).getByLabelText("Monto"), "50");
    await usuario.click(within(pago).getByRole("button", { name: "Vista previa" }));
    await usuario.click(await within(pago).findByRole("button", { name: "Grabar cobro" }));
    await waitFor(() => expect(porCobrarDeCliente).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Aplicar saldo a favor" })).not.toBeInTheDocument(),
    );
    expect(within(screen.getByRole("region", { name: "Aplicar saldo a favor" })).getByLabelText("Monto a aplicar")).toHaveValue("50.00");
  });
});

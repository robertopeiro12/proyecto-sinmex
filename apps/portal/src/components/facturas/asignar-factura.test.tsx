import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as clientesLib from "@/lib/clientes";
import type { ClienteResumen } from "@/lib/clientes";
import * as facturasLib from "@/lib/facturas";
import type { VentaPorFacturar } from "@/lib/facturas";
import { AsignarFactura } from "./asignar-factura";

vi.mock("@/lib/clientes");
vi.mock("@/lib/facturas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/facturas")>();
  return { ...real, listarPorFacturar: vi.fn(), asignarFactura: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");

const listarClientes = vi.mocked(clientesLib.listarClientes);
const listarPorFacturar = vi.mocked(facturasLib.listarPorFacturar);
const asignarFactura = vi.mocked(facturasLib.asignarFactura);

const CLIENTE: ClienteResumen = {
  id: "c1", nombre: "Cobach XXI", telefono: "664", tipo: "cliente", tipoNegocio: null, sucursalCodigo: "TJ",
};
const VENTAS: VentaPorFacturar[] = [
  { id: "v1", folio: "TJ240401OF01", fecha: "2024-04-01", numNota: null, montoCentavos: 10000, status: "pendiente", factura: "pendiente" },
  { id: "v2", folio: "TJ240402OF01", fecha: "2024-04-02", numNota: "77", montoCentavos: 5050, status: "abonado", factura: "pendiente" },
];

async function elegirCliente() {
  const usuario = userEvent.setup();
  render(<AsignarFactura sucursal={null} />);
  await usuario.type(screen.getByLabelText("Cliente"), "coba");
  await usuario.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
  await screen.findByText("TJ240401OF01");
  return usuario;
}

describe("AsignarFactura", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede: () => true });
    listarClientes.mockResolvedValue([CLIENTE]);
    listarPorFacturar.mockResolvedValue(VENTAS);
    asignarFactura.mockResolvedValue({
      id: "f1", numero: "A780", clienteId: "c1", cliente: "Cobach XXI", sucursalCodigo: "TJ",
      creadoPor: "Ana", creadoEn: "2026-10-07 10:00", totalCentavos: 15050, ventas: VENTAS,
    });
  });

  it("lista las pendientes del cliente; la casilla N/A vuelve a pedir con incluirNA", async () => {
    const usuario = await elegirCliente();
    expect(listarPorFacturar).toHaveBeenCalledWith("c1", false);
    await usuario.click(screen.getByLabelText("Mostrar también las N/A"));
    await waitFor(() => expect(listarPorFacturar).toHaveBeenCalledWith("c1", true));
  });

  it("marca, muestra el total y asigna con el número tecleado", async () => {
    const usuario = await elegirCliente();
    const grabar = screen.getByRole("button", { name: "Asignar" });
    expect(grabar).toBeDisabled();
    await usuario.click(screen.getByLabelText("Seleccionar todas"));
    expect(screen.getByText("Total marcado: $150.50")).toBeInTheDocument();
    await usuario.type(screen.getByLabelText("Número de factura"), " A780 ");
    await usuario.click(grabar);
    expect(asignarFactura).toHaveBeenCalledWith("c1", "A780", ["v1", "v2"]);
    expect(await screen.findByRole("status")).toHaveTextContent("Factura A780 asignada a 2 ventas ($150.50)");
  });

  it("muestra el mensaje del servidor", async () => {
    asignarFactura.mockRejectedValue(new ErrorApi("x", 409, "La factura A780 ya está asignada a Otra."));
    const usuario = await elegirCliente();
    await usuario.click(screen.getByLabelText("Marcar TJ240401OF01"));
    await usuario.type(screen.getByLabelText("Número de factura"), "A780");
    await usuario.click(screen.getByRole("button", { name: "Asignar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La factura A780 ya está asignada a Otra.");
  });

  it("sin ventas por facturar lo dice", async () => {
    listarPorFacturar.mockResolvedValue([]);
    const usuario = userEvent.setup();
    render(<AsignarFactura sucursal={null} />);
    await usuario.type(screen.getByLabelText("Cliente"), "coba");
    await usuario.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
    expect(await screen.findByText("Este cliente no tiene ventas por facturar.")).toBeInTheDocument();
  });

  it("sin el permiso no se puede asignar", async () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede: () => false });
    render(<AsignarFactura sucursal={null} />);
    expect(screen.getByText("No tienes permiso para asignar facturas.")).toBeInTheDocument();
  });
});

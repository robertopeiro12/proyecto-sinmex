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

  it("tras asignar recarga la lista y reinicia la seleccion", async () => {
    const usuario = await elegirCliente();
    listarPorFacturar.mockResolvedValue([VENTAS[1]]);
    await usuario.click(screen.getByLabelText("Marcar TJ240401OF01"));
    await usuario.type(screen.getByLabelText("Número de factura"), "A780");
    const grabar = screen.getByRole("button", { name: "Asignar" });
    await usuario.click(grabar);
    await screen.findByRole("status");
    await waitFor(() => expect(listarPorFacturar).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("TJ240401OF01")).not.toBeInTheDocument());
    expect(screen.getByText("TJ240402OF01")).toBeInTheDocument();
    expect(screen.getByText("Total marcado: $0.00")).toBeInTheDocument();
    await usuario.type(screen.getByLabelText("Número de factura"), "B1");
    expect(screen.getByRole("button", { name: "Asignar" })).toBeDisabled();
  });

  it("si falla la carga lo dice y no afirma que no hay ventas", async () => {
    listarPorFacturar.mockRejectedValue(new Error("red"));
    const usuario = userEvent.setup();
    render(<AsignarFactura sucursal={null} />);
    await usuario.type(screen.getByLabelText("Cliente"), "coba");
    await usuario.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar la lista de ventas por facturar.");
    expect(screen.queryByText("Este cliente no tiene ventas por facturar.")).not.toBeInTheDocument();
  });

  it("sin el permiso no se puede asignar", async () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede: () => false });
    render(<AsignarFactura sucursal={null} />);
    expect(screen.getByText("No tienes permiso para asignar facturas.")).toBeInTheDocument();
  });

  it("sin el permiso no pide la lista de clientes", () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede: () => false });
    render(<AsignarFactura sucursal={null} />);
    expect(listarClientes).not.toHaveBeenCalled();
  });

  it("mientras recarga no deja marcar filas viejas", async () => {
    const usuario = await elegirCliente();
    let resolver: (v: VentaPorFacturar[]) => void = () => {};
    listarPorFacturar.mockReturnValue(new Promise((r) => (resolver = r)));
    await usuario.click(screen.getByLabelText("Mostrar también las N/A"));
    await waitFor(() => expect(screen.getByLabelText("Marcar TJ240401OF01")).toBeDisabled());
    expect(screen.getByLabelText("Seleccionar todas")).toBeDisabled();
    resolver(VENTAS);
    await waitFor(() => expect(screen.getByLabelText("Marcar TJ240401OF01")).toBeEnabled());
    expect(screen.getByLabelText("Seleccionar todas")).toBeEnabled();
  });

  it("al marcar las N/A se reinicia la seleccion", async () => {
    const usuario = await elegirCliente();
    await usuario.click(screen.getByLabelText("Marcar TJ240401OF01"));
    expect(screen.getByText("Total marcado: $100.00")).toBeInTheDocument();
    await usuario.click(screen.getByLabelText("Mostrar también las N/A"));
    await waitFor(() => expect(listarPorFacturar).toHaveBeenCalledWith("c1", true));
    await waitFor(() => expect(screen.getByLabelText("Marcar TJ240401OF01")).toBeEnabled());
    expect(screen.getByLabelText("Marcar TJ240401OF01")).not.toBeChecked();
    expect(screen.getByText("Total marcado: $0.00")).toBeInTheDocument();
  });

  it("el campo de número limita el largo", async () => {
    await elegirCliente();
    expect(screen.getByLabelText("Número de factura")).toHaveAttribute("maxlength", "30");
  });

  it("si falla la carga con mensaje del servidor lo muestra, y desaparece tras una carga buena", async () => {
    listarPorFacturar.mockRejectedValueOnce(new ErrorApi("x", 403, "Sin acceso a esa sucursal."));
    const usuario = userEvent.setup();
    render(<AsignarFactura sucursal={null} />);
    await usuario.type(screen.getByLabelText("Cliente"), "coba");
    await usuario.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sin acceso a esa sucursal.");
    await usuario.click(screen.getByLabelText("Mostrar también las N/A"));
    expect(await screen.findByText("TJ240401OF01")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("el aviso verde se limpia al enviar de nuevo y al quitar el cliente", async () => {
    const usuario = await elegirCliente();
    await usuario.click(screen.getByLabelText("Marcar TJ240401OF01"));
    await usuario.type(screen.getByLabelText("Número de factura"), "A780");
    await usuario.click(screen.getByRole("button", { name: "Asignar" }));
    expect(await screen.findByRole("status")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Marcar TJ240401OF01")).toBeEnabled());

    // Nuevo envío que falla: el aviso viejo ya no debe seguir.
    asignarFactura.mockRejectedValueOnce(new ErrorApi("x", 409, "Ya existe."));
    await usuario.click(screen.getByLabelText("Marcar TJ240401OF01"));
    await usuario.type(screen.getByLabelText("Número de factura"), "A781");
    await usuario.click(screen.getByRole("button", { name: "Asignar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    // Aviso de nuevo y se quita el cliente.
    await usuario.click(screen.getByRole("button", { name: "Asignar" }));
    expect(await screen.findByRole("status")).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: /Quitar|Cambiar/ }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

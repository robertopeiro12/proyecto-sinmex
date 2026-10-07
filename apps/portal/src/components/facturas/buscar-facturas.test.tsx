import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as clientesLib from "@/lib/clientes";
import * as facturasLib from "@/lib/facturas";
import type { FacturaConVentas } from "@/lib/facturas";
import { BuscarFacturas } from "./buscar-facturas";

vi.mock("@/lib/clientes");
vi.mock("@/lib/facturas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/facturas")>();
  return { ...real, buscarFacturas: vi.fn(), renombrarFactura: vi.fn(), quitarDeFactura: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");

const buscarFacturas = vi.mocked(facturasLib.buscarFacturas);
const renombrarFactura = vi.mocked(facturasLib.renombrarFactura);
const quitarDeFactura = vi.mocked(facturasLib.quitarDeFactura);

const FACTURA: FacturaConVentas = {
  id: "f1", numero: "A708", clienteId: "c1", cliente: "Cobach XXI", sucursalCodigo: "TJ",
  creadoPor: "Ana", creadoEn: "2026-10-07 10:00", totalCentavos: 15050,
  ventas: [
    { id: "v1", folio: "TJ240401OF01", fecha: "2024-04-01", numNota: null, montoCentavos: 10000, status: "pendiente" },
    { id: "v2", folio: "TJ240402OF01", fecha: "2024-04-02", numNota: null, montoCentavos: 5050, status: "pendiente" },
  ],
};

async function buscarA708() {
  const usuario = userEvent.setup();
  render(<BuscarFacturas sucursal={null} />);
  await usuario.type(screen.getByLabelText("Número de factura a buscar"), "a708");
  await usuario.click(screen.getByRole("button", { name: "Buscar" }));
  await screen.findByText("Factura A708");
  return usuario;
}

describe("BuscarFacturas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede: () => true });
    vi.mocked(clientesLib.listarClientes).mockResolvedValue([]);
    buscarFacturas.mockResolvedValue([FACTURA]);
  });

  it("busca por número y muestra cliente, ventas y total", async () => {
    await buscarA708();
    expect(buscarFacturas).toHaveBeenCalledWith({ numero: "a708", clienteId: undefined, sucursal: null });
    const tarjeta = screen.getByRole("region", { name: "Factura A708" });
    expect(within(tarjeta).getByText(/Cobach XXI/)).toBeInTheDocument();
    expect(within(tarjeta).getByText("Total: $150.50")).toBeInTheDocument();
  });

  it("cambia el número", async () => {
    renombrarFactura.mockResolvedValue({ ...FACTURA, numero: "A780" });
    const usuario = await buscarA708();
    const campo = screen.getByLabelText("Nuevo número de A708");
    await usuario.clear(campo);
    await usuario.type(campo, "A780");
    await usuario.click(screen.getByRole("button", { name: "Guardar número" }));
    expect(renombrarFactura).toHaveBeenCalledWith("f1", "A780");
    expect(await screen.findByText("Factura A780")).toBeInTheDocument();
  });

  it("quita ventas con confirmación", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    quitarDeFactura.mockResolvedValue({ factura: { ...FACTURA, ventas: [FACTURA.ventas[1]], totalCentavos: 5050 } });
    const usuario = await buscarA708();
    await usuario.click(screen.getByLabelText("Quitar TJ240401OF01"));
    await usuario.click(screen.getByRole("button", { name: "Quitar de la factura" }));
    expect(quitarDeFactura).toHaveBeenCalledWith("f1", ["v1"]);
    expect(await screen.findByText("Total: $50.50")).toBeInTheDocument();
  });

  it("si se quitan todas, la factura desaparece y se avisa", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    quitarDeFactura.mockResolvedValue({ factura: null });
    const usuario = await buscarA708();
    await usuario.click(screen.getByLabelText("Quitar TJ240401OF01"));
    await usuario.click(screen.getByLabelText("Quitar TJ240402OF01"));
    await usuario.click(screen.getByRole("button", { name: "Quitar de la factura" }));
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining("la factura A708 desaparece"));
    expect(await screen.findByRole("status")).toHaveTextContent("La factura A708 se borró: ya no tenía ventas.");
    expect(screen.queryByText("Factura A708")).not.toBeInTheDocument();
    expect(screen.queryByText("No se encontraron facturas.")).not.toBeInTheDocument();
  });

  it("muestra el mensaje del servidor al renombrar", async () => {
    renombrarFactura.mockRejectedValue(new ErrorApi("x", 409, "La factura A780 ya está asignada a Otra."));
    const usuario = await buscarA708();
    const campo = screen.getByLabelText("Nuevo número de A708");
    await usuario.clear(campo);
    await usuario.type(campo, "A780");
    await usuario.click(screen.getByRole("button", { name: "Guardar número" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La factura A780 ya está asignada a Otra.");
  });

  it("sin resultados lo dice", async () => {
    buscarFacturas.mockResolvedValue([]);
    const usuario = userEvent.setup();
    render(<BuscarFacturas sucursal={null} />);
    await usuario.type(screen.getByLabelText("Número de factura a buscar"), "Z1");
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByText("No se encontraron facturas.")).toBeInTheDocument();
  });

  it("sin el permiso muestra el texto y no pide clientes", () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede: () => false });
    render(<BuscarFacturas sucursal={null} />);
    expect(screen.getByText("No tienes permiso para asignar facturas.")).toBeInTheDocument();
    expect(clientesLib.listarClientes).not.toHaveBeenCalled();
  });

  it("buscar sin número ni cliente muestra el error de validación", async () => {
    const usuario = userEvent.setup();
    render(<BuscarFacturas sucursal={null} />);
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Escribe un número de factura o elige un cliente.");
    expect(buscarFacturas).not.toHaveBeenCalled();
  });

  it("buscar por cliente llama con clienteId", async () => {
    vi.mocked(clientesLib.listarClientes).mockResolvedValue([
      { id: "c1", nombre: "Cobach XXI", telefono: "664", tipo: "cliente", tipoNegocio: null, sucursalCodigo: "TJ" },
    ]);
    const usuario = userEvent.setup();
    render(<BuscarFacturas sucursal="TJ" />);
    await usuario.type(screen.getByLabelText("Cliente"), "coba");
    await usuario.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("Factura A708");
    expect(buscarFacturas).toHaveBeenCalledWith({ numero: undefined, clienteId: "c1", sucursal: "TJ" });
  });

  it("cancelar el confirm no quita nada", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const usuario = await buscarA708();
    await usuario.click(screen.getByLabelText("Quitar TJ240401OF01"));
    await usuario.click(screen.getByRole("button", { name: "Quitar de la factura" }));
    expect(quitarDeFactura).not.toHaveBeenCalled();
  });

  it("el confirm de quitar solo algunas lo dice", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    const usuario = await buscarA708();
    await usuario.click(screen.getByLabelText("Quitar TJ240401OF01"));
    await usuario.click(screen.getByRole("button", { name: "Quitar de la factura" }));
    expect(confirmar).toHaveBeenCalledWith('¿Quitar 1 venta de la factura A708? Regresan a "pendiente".');
  });

  it("un error al quitar se ve dentro de la tarjeta", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    quitarDeFactura.mockRejectedValue(new ErrorApi("x", 409, "La venta ya tiene cobros."));
    const usuario = await buscarA708();
    await usuario.click(screen.getByLabelText("Quitar TJ240401OF01"));
    await usuario.click(screen.getByRole("button", { name: "Quitar de la factura" }));
    const tarjeta = screen.getByRole("region", { name: "Factura A708" });
    expect(await within(tarjeta).findByRole("alert")).toHaveTextContent("La venta ya tiene cobros.");
  });

  it("el error al renombrar queda en su tarjeta, no arriba", async () => {
    renombrarFactura.mockRejectedValue(new ErrorApi("x", 409, "Repetida."));
    const usuario = await buscarA708();
    const campo = screen.getByLabelText("Nuevo número de A708");
    await usuario.clear(campo);
    await usuario.type(campo, "A780");
    await usuario.click(screen.getByRole("button", { name: "Guardar número" }));
    const tarjeta = screen.getByRole("region", { name: "Factura A708" });
    expect(await within(tarjeta).findByRole("alert")).toHaveTextContent("Repetida.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("el aviso de borrada se limpia al buscar de nuevo", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    quitarDeFactura.mockResolvedValue({ factura: null });
    const usuario = await buscarA708();
    await usuario.click(screen.getByLabelText("Quitar TJ240401OF01"));
    await usuario.click(screen.getByLabelText("Quitar TJ240402OF01"));
    await usuario.click(screen.getByRole("button", { name: "Quitar de la factura" }));
    await screen.findByRole("status");
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("Factura A708");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("el aviso de borrada se limpia al actuar en otra tarjeta", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const OTRA: FacturaConVentas = {
      ...FACTURA,
      id: "f2",
      numero: "B1",
      ventas: [{ ...FACTURA.ventas[0], id: "v9", folio: "TJ240409OF01" }],
    };
    buscarFacturas.mockResolvedValue([FACTURA, OTRA]);
    quitarDeFactura.mockResolvedValueOnce({ factura: null }).mockRejectedValueOnce(new ErrorApi("x", 409, "Nope."));
    const usuario = await buscarA708();
    const a = screen.getByRole("region", { name: "Factura A708" });
    await usuario.click(within(a).getByLabelText("Quitar TJ240401OF01"));
    await usuario.click(within(a).getByLabelText("Quitar TJ240402OF01"));
    await usuario.click(within(a).getByRole("button", { name: "Quitar de la factura" }));
    await screen.findByRole("status");
    const b = screen.getByRole("region", { name: "Factura B1" });
    await usuario.click(within(b).getByLabelText("Quitar TJ240409OF01"));
    await usuario.click(within(b).getByRole("button", { name: "Quitar de la factura" }));
    await within(b).findByRole("alert");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("si responden las búsquedas en desorden, gana la última", async () => {
    const resolvers: ((f: FacturaConVentas[]) => void)[] = [];
    buscarFacturas.mockImplementation(() => new Promise((r) => resolvers.push(r)));
    const usuario = userEvent.setup();
    render(<BuscarFacturas sucursal={null} />);
    await usuario.type(screen.getByLabelText("Número de factura a buscar"), "A");
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    await usuario.type(screen.getByLabelText("Número de factura a buscar"), "B");
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    // La segunda responde primero; la primera llega tarde y se ignora.
    resolvers[1]([{ ...FACTURA, id: "f2", numero: "AB" }]);
    expect(await screen.findByText("Factura AB")).toBeInTheDocument();
    resolvers[0]([FACTURA]);
    await Promise.resolve();
    expect(screen.queryByText("Factura A708")).not.toBeInTheDocument();
    expect(screen.getByText("Factura AB")).toBeInTheDocument();
  });
});

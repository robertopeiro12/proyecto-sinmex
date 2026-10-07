import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as clientesLib from "@/lib/clientes";
import type { ClienteResumen } from "@/lib/clientes";
import * as cobranzasLib from "@/lib/cobranzas";
import * as ventasLib from "@/lib/ventas";
import { PantallaCobranza } from "./pantalla-cobranza";

vi.mock("@/lib/clientes");
vi.mock("@/lib/cobranzas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cobranzas")>();
  return { ...real, buscarPorCobrar: vi.fn(), porCobrarDeCliente: vi.fn() };
});
vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return { ...real, listarRepartidores: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");

const listarClientes = vi.mocked(clientesLib.listarClientes);
const buscarPorCobrar = vi.mocked(cobranzasLib.buscarPorCobrar);
const porCobrarDeCliente = vi.mocked(cobranzasLib.porCobrarDeCliente);

const CLIENTE: ClienteResumen = {
  id: "c1", nombre: "Cobach XXI", telefono: "664", tipo: "cliente", tipoNegocio: null, sucursalCodigo: "TJ",
};

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede });
}

describe("PantallaCobranza", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarClientes.mockResolvedValue([CLIENTE]);
    porCobrarDeCliente.mockResolvedValue({
      id: "c1", nombre: "Cobach XXI", sucursalId: "suc-tj", sucursalCodigo: "TJ", saldoFavorCentavos: 0, notas: [],
    });
    vi.mocked(ventasLib.listarRepartidores).mockResolvedValue([]);
  });

  it("sin cobranza.registrar lo dice y no pide nada", () => {
    mockAuth(() => false);
    render(<PantallaCobranza sucursal={null} />);
    expect(screen.getByText("No tienes permiso para registrar cobranza")).toBeInTheDocument();
    expect(listarClientes).not.toHaveBeenCalled();
  });

  it("de la búsqueda entra al cliente y vuelve", async () => {
    mockAuth(() => true);
    const usuario = userEvent.setup();
    render(<PantallaCobranza sucursal={null} />);
    await usuario.type(screen.getByLabelText("Cliente"), "coba");
    await usuario.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
    expect(await screen.findByText("Cobranza · Cobach XXI")).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "← Volver a buscar" }));
    expect(screen.getByLabelText("Fecha de la venta")).toBeInTheDocument();
  });

  it("de la búsqueda por fecha, Cobrar abre al cliente con esa nota marcada", async () => {
    mockAuth(() => true);
    const n1 = {
      id: "n1", folio: "TJ240401OF01", numNota: null, fecha: "2024-04-01", clienteId: "c1", cliente: "Cobach XXI",
      sucursalCodigo: "TJ", montoCentavos: 10000, saldoCentavos: 10000, status: "pendiente" as const, abonos: [],
    };
    const n2 = { ...n1, id: "n2", folio: "TJ240402OF01", fecha: "2024-04-02" };
    buscarPorCobrar.mockResolvedValue([n2]);
    porCobrarDeCliente.mockResolvedValue({
      id: "c1", nombre: "Cobach XXI", sucursalId: "suc-tj", sucursalCodigo: "TJ", saldoFavorCentavos: 0, notas: [n1, n2],
    });
    const usuario = userEvent.setup();
    render(<PantallaCobranza sucursal={null} />);
    fireEvent.change(screen.getByLabelText("Fecha de la venta"), { target: { value: "2024-04-02" } });
    await usuario.click(screen.getByRole("button", { name: "Buscar por fecha" }));
    await usuario.click(await screen.findByRole("button", { name: "Cobrar TJ240402OF01" }));
    expect(await screen.findByText("Cobranza · Cobach XXI")).toBeInTheDocument();
    expect(screen.getByLabelText("Marcar TJ240402OF01")).toBeChecked();
    expect(screen.getByLabelText("Marcar TJ240401OF01")).not.toBeChecked();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});

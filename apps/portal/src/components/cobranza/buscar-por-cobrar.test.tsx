import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import * as clientesLib from "@/lib/clientes";
import type { ClienteResumen } from "@/lib/clientes";
import * as cobranzasLib from "@/lib/cobranzas";
import type { NotaPorCobrar } from "@/lib/cobranzas";
import { BuscarPorCobrar } from "./buscar-por-cobrar";

vi.mock("@/lib/clientes");
vi.mock("@/lib/cobranzas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cobranzas")>();
  return { ...real, buscarPorCobrar: vi.fn() };
});

const listarClientes = vi.mocked(clientesLib.listarClientes);
const buscarPorCobrar = vi.mocked(cobranzasLib.buscarPorCobrar);

const CLIENTE: ClienteResumen = {
  id: "c1", nombre: "Cobach XXI", telefono: "664", tipo: "cliente", tipoNegocio: null, sucursalCodigo: "TJ",
};
const NOTA: NotaPorCobrar = {
  id: "n1", folio: "TJ240401OF01", numNota: "77", fecha: "2024-04-01", clienteId: "c1", cliente: "Cobach XXI",
  sucursalCodigo: "TJ", montoCentavos: 10000, saldoCentavos: 4000, status: "abonado", abonos: [],
};

function renderizar(sucursal: string | null = "TJ") {
  const onElegir = vi.fn();
  render(<BuscarPorCobrar sucursal={sucursal} onElegir={onElegir} />);
  return { usuario: userEvent.setup(), onElegir };
}

describe("BuscarPorCobrar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarClientes.mockResolvedValue([CLIENTE]);
    buscarPorCobrar.mockResolvedValue([NOTA]);
  });

  it("por cliente entra directo a su cobranza", async () => {
    const { usuario, onElegir } = renderizar();
    await usuario.type(screen.getByLabelText("Cliente"), "coba");
    await usuario.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
    expect(onElegir).toHaveBeenCalledWith("c1", null);
  });

  it("por fecha lista las notas por cobrar y un clic entra al cliente con esa nota", async () => {
    const { usuario, onElegir } = renderizar();
    fireEvent.change(screen.getByLabelText("Fecha de la venta"), { target: { value: "2024-04-01" } });
    await usuario.click(screen.getByRole("button", { name: "Buscar por fecha" }));
    expect(buscarPorCobrar).toHaveBeenCalledWith({ fecha: "2024-04-01" }, "TJ");
    expect(await screen.findByText("TJ240401OF01")).toBeInTheDocument();
    expect(screen.getByText("$40.00")).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Cobrar TJ240401OF01" }));
    expect(onElegir).toHaveBeenCalledWith("c1", "n1");
  });

  it("por # de nota", async () => {
    const { usuario } = renderizar(null);
    await usuario.type(screen.getByLabelText("# de nota"), "77");
    await usuario.click(screen.getByRole("button", { name: "Buscar por # de nota" }));
    expect(buscarPorCobrar).toHaveBeenCalledWith({ numNota: "77" }, null);
  });

  it("sin resultados lo dice", async () => {
    buscarPorCobrar.mockResolvedValue([]);
    const { usuario } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Buscar por fecha" }));
    expect(await screen.findByText("No hay notas por cobrar con esa búsqueda.")).toBeInTheDocument();
  });

  it("muestra el mensaje del servidor", async () => {
    buscarPorCobrar.mockRejectedValue(new ErrorApi("x", 400, "Esa fecha no existe."));
    const { usuario } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Buscar por fecha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Esa fecha no existe.");
  });

  it("al cambiar de sucursal se limpian los resultados de la anterior", async () => {
    const onElegir = vi.fn();
    const usuario = userEvent.setup();
    const { rerender } = render(<BuscarPorCobrar sucursal="TJ" onElegir={onElegir} />);
    await usuario.click(screen.getByRole("button", { name: "Buscar por fecha" }));
    expect(await screen.findByText("TJ240401OF01")).toBeInTheDocument();
    rerender(<BuscarPorCobrar sucursal="MX" onElegir={onElegir} />);
    expect(screen.queryByText("TJ240401OF01")).not.toBeInTheDocument();
    expect(screen.queryByText("No hay notas por cobrar con esa búsqueda.")).not.toBeInTheDocument();
  });

  it("una respuesta vieja no pisa a una búsqueda más nueva", async () => {
    let resolverVieja!: (n: NotaPorCobrar[]) => void;
    buscarPorCobrar.mockReturnValueOnce(new Promise((r) => (resolverVieja = r)));
    buscarPorCobrar.mockResolvedValueOnce([{ ...NOTA, id: "n9", folio: "TJ240409OF01" }]);
    const onElegir = vi.fn();
    const usuario = userEvent.setup();
    const { rerender } = render(<BuscarPorCobrar sucursal="TJ" onElegir={onElegir} />);
    await usuario.click(screen.getByRole("button", { name: "Buscar por fecha" }));
    // Cambia de sucursal con la primera búsqueda en el aire y busca de nuevo.
    rerender(<BuscarPorCobrar sucursal="MX" onElegir={onElegir} />);
    await usuario.click(screen.getByRole("button", { name: "Buscar por fecha" }));
    expect(await screen.findByText("TJ240409OF01")).toBeInTheDocument();
    await act(async () => resolverVieja([NOTA]));
    expect(screen.getByText("TJ240409OF01")).toBeInTheDocument();
    expect(screen.queryByText("TJ240401OF01")).not.toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as clientesLib from "@/lib/clientes";
import type { ClienteDetalle, ClienteResumen } from "@/lib/clientes";
import * as ventasLib from "@/lib/ventas";
import { hoyEnTijuana } from "@/lib/ventas";
import { PestanaVentas } from "./pestana-ventas";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/clientes");
vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return {
    ...real,
    obtenerCatalogoVenta: vi.fn(),
    listarRepartidores: vi.fn(),
    registrarVenta: vi.fn(),
    buscarVentas: vi.fn(),
  };
});

const registrarVenta = vi.mocked(ventasLib.registrarVenta);
const obtenerCatalogoVenta = vi.mocked(ventasLib.obtenerCatalogoVenta);

const cliente = (id: string, nombre: string): ClienteResumen => ({
  id,
  nombre,
  telefono: "",
  tipo: "cliente",
  tipoNegocio: null,
  sucursalCodigo: "TJ",
});
const C1 = cliente("c1", "Abarrotes Lupita");
const C2 = cliente("c2", "Mariscos Bucanero");

function mockAuth(permisos: string[]) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: null,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (c: string) => permisos.includes(c),
  });
}

describe("PestanaVentas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth(["venta.registrar"]);
    vi.mocked(clientesLib.obtenerCliente).mockResolvedValue({ id: "c1", sucursalId: "suc-tj" } as ClienteDetalle);
    vi.mocked(ventasLib.listarRepartidores).mockResolvedValue([{ id: "v-ana", nombre: "Ana Pérez" }]);
    obtenerCatalogoVenta.mockResolvedValue([
      { presentacionId: "p1", producto: "Horchata", volumen: "1 L", precioCentavos: 1000 },
    ]);
    vi.mocked(ventasLib.buscarVentas).mockResolvedValue({ ventas: [], hayMas: false });
    registrarVenta.mockResolvedValue({ id: "v9", folio: "TJ261125OF01", montoCentavos: 3000, status: "pendiente" });
  });

  it("sin cliente pide uno arriba", () => {
    render(<PestanaVentas sucursal="TJ" cliente={null} onVerEnNotas={vi.fn()} onSucio={vi.fn()} onRegistrada={vi.fn()} />);
    expect(screen.getByText("Elige un cliente arriba.")).toBeInTheDocument();
  });

  it("el formulario de Registrar venta sin buscador ni encabezado propio", async () => {
    render(<PestanaVentas sucursal="TJ" cliente={C1} onVerEnNotas={vi.fn()} onSucio={vi.fn()} onRegistrada={vi.fn()} />);
    expect(await screen.findByLabelText("Cantidad de Horchata 1 L")).toBeInTheDocument();
    expect(screen.queryByLabelText("Cliente")).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(clientesLib.listarClientes).not.toHaveBeenCalled();
  });

  it("Review Focus 5: la venta usa el cliente de arriba, no el de una selección anterior; al grabar ofrece Ver en Notas y limpia", async () => {
    const u = userEvent.setup();
    const onVerEnNotas = vi.fn();
    const onSucio = vi.fn();
    const onRegistrada = vi.fn();
    const props = { sucursal: "TJ", onVerEnNotas, onSucio, onRegistrada };
    const { rerender } = render(<PestanaVentas {...props} cliente={C1} />);
    await u.type(await screen.findByLabelText("Cantidad de Horchata 1 L"), "9");
    expect(onSucio).toHaveBeenLastCalledWith(true);

    rerender(<PestanaVentas {...props} cliente={C2} />);
    await waitFor(() => expect(obtenerCatalogoVenta).toHaveBeenLastCalledWith("c2", hoyEnTijuana()));
    // Lo escrito para el otro cliente no se arrastra.
    expect(await screen.findByLabelText("Cantidad de Horchata 1 L")).toHaveDisplayValue("");
    await u.selectOptions(await screen.findByLabelText("Repartidor"), "oficina");
    await u.type(screen.getByLabelText("Cantidad de Horchata 1 L"), "3");
    await u.click(screen.getByRole("button", { name: "Grabar" }));

    await waitFor(() => expect(registrarVenta).toHaveBeenCalledTimes(1));
    expect(registrarVenta.mock.calls[0][0]).toMatchObject({ clienteId: "c2", vendedorId: null });
    const aviso = await screen.findByText(/Venta registrada/);
    expect(aviso.closest("[data-tono]")).toHaveAttribute("data-tono", "exito");
    expect(screen.getByText("TJ261125OF01")).toBeInTheDocument();
    expect(onRegistrada).toHaveBeenCalled();
    expect(onSucio).toHaveBeenLastCalledWith(false);
    // El formulario queda limpio para la siguiente.
    expect(screen.getByLabelText("Cantidad de Horchata 1 L")).toHaveDisplayValue("");
    expect(screen.getByLabelText("Repartidor")).toHaveValue("");
    await u.click(screen.getByRole("button", { name: "Ver en Notas" }));
    expect(onVerEnNotas).toHaveBeenCalledWith("TJ261125OF01");
  });
  it("I-2: tras grabar vuelve a pedir las ventas del día, y la siguiente del mismo cliente avisa del posible duplicado", async () => {
    const u = userEvent.setup();
    const buscarVentas = vi.mocked(ventasLib.buscarVentas);
    render(<PestanaVentas sucursal="TJ" cliente={C1} onVerEnNotas={vi.fn()} onSucio={vi.fn()} onRegistrada={vi.fn()} />);
    await waitFor(() => expect(buscarVentas).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Este cliente ya tiene/)).toBeNull();

    buscarVentas.mockResolvedValue({
      ventas: [
        {
          id: "v9", folio: "TJ261125OF01", fecha: hoyEnTijuana(), clienteId: "c1", cliente: "Abarrotes Lupita",
          repartidor: null, vendedorId: null, factura: { estado: "N/A", numero: null }, numNota: null,
          montoCentavos: 3000, status: "pendiente", origen: "portal", saldoCentavos: 3000,
        },
      ],
      hayMas: false,
    });
    await u.selectOptions(await screen.findByLabelText("Repartidor"), "oficina");
    await u.type(screen.getByLabelText("Cantidad de Horchata 1 L"), "3");
    await u.click(screen.getByRole("button", { name: "Grabar" }));

    await waitFor(() => expect(buscarVentas).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Este cliente ya tiene 1 venta/)).toBeInTheDocument();
  });
});

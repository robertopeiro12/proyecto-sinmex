import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as clientesLib from "@/lib/clientes";
import type { ClienteResumen } from "@/lib/clientes";
import * as ventasLib from "@/lib/ventas";
import type { ResultadoBusquedaVentas, VentaDetalle } from "@/lib/ventas";
import { PantallaVentas } from "./pantalla-ventas";

// Mismo límite que pantalla-registrar-venta.test.tsx: se mockea la capa de red
// (lib/*.ts); las utilidades puras de lib/ventas se conservan.
vi.mock("@/lib/clientes");
vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return {
    ...real,
    buscarVentas: vi.fn(),
    obtenerVenta: vi.fn(),
    eliminarVenta: vi.fn(),
    marcarCuentaPerdida: vi.fn(),
    editarVenta: vi.fn(),
    obtenerCatalogoVenta: vi.fn(),
    listarRepartidores: vi.fn(),
  };
});
vi.mock("@/components/auth/auth-provider");

const listarClientes = vi.mocked(clientesLib.listarClientes);
const buscarVentas = vi.mocked(ventasLib.buscarVentas);
const obtenerVenta = vi.mocked(ventasLib.obtenerVenta);
const eliminarVenta = vi.mocked(ventasLib.eliminarVenta);
const editarVenta = vi.mocked(ventasLib.editarVenta);
const obtenerCatalogoVenta = vi.mocked(ventasLib.obtenerCatalogoVenta);
const listarRepartidores = vi.mocked(ventasLib.listarRepartidores);

const CLIENTE: ClienteResumen = {
  id: "c1",
  nombre: "Abarrotes Lupita",
  telefono: "664",
  tipo: "cliente",
  tipoNegocio: null,
  sucursalCodigo: "TJ",
};

const RESULTADO: ResultadoBusquedaVentas = {
  hayMas: false,
  ventas: [
    {
      id: "v1",
      folio: "TJ240304AP01",
      fecha: "2024-03-04",
      clienteId: "c1",
      cliente: "Abarrotes Lupita",
      repartidor: null,
      numNota: "1234",
      montoCentavos: 27000,
      status: "pendiente",
      origen: "app",
      saldoCentavos: 17000,
    },
  ],
};

const DETALLE: VentaDetalle = {
  id: "v1",
  folio: "TJ240304AP01",
  fecha: "2024-03-04",
  clienteId: "c1",
  cliente: "Abarrotes Lupita",
  sucursalId: "suc-tj",
  sucursalCodigo: "TJ",
  vendedorId: "v-ana",
  repartidor: "Ana Pérez",
  numNota: "1234",
  contadoCredito: "credito",
  factura: "N/A",
  comentarios: null,
  montoCentavos: 27000,
  status: "pendiente",
  origen: "app",
  saldoCentavos: 27000,
  lineas: [
    {
      presentacionId: "p1",
      producto: "Horchata",
      volumen: "1 L",
      cantidad: 30,
      cantidadPromocion: 0,
      precioCentavos: 900,
      subtotalCentavos: 27000,
    },
  ],
  cobros: [],
  editable: true,
  motivoNoEditable: null,
  puedeMarcarPerdida: true,
};

describe("PantallaVentas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede: () => true });
    listarClientes.mockResolvedValue([CLIENTE]);
    buscarVentas.mockResolvedValue(RESULTADO);
    obtenerVenta.mockResolvedValue(DETALLE);
    obtenerCatalogoVenta.mockResolvedValue([
      { presentacionId: "p1", producto: "Horchata", volumen: "1 L", precioCentavos: 1000 },
    ]);
    listarRepartidores.mockResolvedValue([{ id: "v-ana", nombre: "Ana Pérez" }]);
  });

  it("busca al abrir con hoy en Tijuana y pinta la tabla", async () => {
    render(<PantallaVentas sucursal={null} />);
    const hoy = ventasLib.hoyEnTijuana();
    expect(await screen.findByRole("button", { name: "TJ240304AP01" })).toBeInTheDocument();
    expect(buscarVentas).toHaveBeenCalledWith({ desde: hoy, hasta: hoy, sucursal: null, clienteId: null, numNota: "" });
    expect(screen.getByText("Oficina")).toBeInTheDocument();
    expect(screen.getByText("Tablet")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("$270.00")).toBeInTheDocument();
    expect(screen.getByText("$170.00")).toBeInTheDocument();
  });

  it("aplica los filtros al pulsar Buscar, con la sucursal del selector", async () => {
    const usuario = userEvent.setup();
    render(<PantallaVentas sucursal="TJ" />);
    await screen.findByRole("button", { name: "TJ240304AP01" });

    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2024-03-01" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2024-03-31" } });
    await usuario.type(screen.getByLabelText("Cliente"), "lupi");
    await usuario.click(await screen.findByRole("button", { name: /Abarrotes Lupita · TJ/ }));
    await usuario.type(screen.getByLabelText("# de nota"), "1234");
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));

    await waitFor(() =>
      expect(buscarVentas).toHaveBeenLastCalledWith({
        desde: "2024-03-01",
        hasta: "2024-03-31",
        sucursal: "TJ",
        clienteId: "c1",
        numNota: "1234",
      }),
    );
  });

  it("avisa cuando hay más de 200 ventas", async () => {
    buscarVentas.mockResolvedValue({ ...RESULTADO, hayMas: true });
    render(<PantallaVentas sucursal={null} />);
    expect(
      await screen.findByText("Hay más de 200 ventas: acota el rango o filtra por cliente."),
    ).toBeInTheDocument();
  });

  it("al elegir una venta muestra su detalle; Volver conserva los filtros y vuelve a buscar", async () => {
    const usuario = userEvent.setup();
    render(<PantallaVentas sucursal={null} />);
    await screen.findByRole("button", { name: "TJ240304AP01" });
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2024-03-01" } });
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(buscarVentas).toHaveBeenCalledTimes(2));

    await usuario.click(screen.getByRole("button", { name: "TJ240304AP01" }));
    expect(await screen.findByText("Venta TJ240304AP01")).toBeInTheDocument();
    expect(obtenerVenta).toHaveBeenCalledWith("v1");

    await usuario.click(screen.getByRole("button", { name: "Volver" }));
    expect(await screen.findByLabelText("Desde")).toHaveValue("2024-03-01");
    await waitFor(() => expect(buscarVentas).toHaveBeenCalledTimes(3));
    expect(buscarVentas).toHaveBeenLastCalledWith(expect.objectContaining({ desde: "2024-03-01" }));
  });

  it("Editar abre el formulario (sin Oficina en una venta de tablet) y al guardar muestra la venta actualizada", async () => {
    const usuario = userEvent.setup();
    editarVenta.mockResolvedValue({ ...DETALLE, montoCentavos: 9000, numNota: "1235" });
    render(<PantallaVentas sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: "TJ240304AP01" }));
    await usuario.click(await screen.findByRole("button", { name: "Editar" }));

    expect(await screen.findByText("Editar venta TJ240304AP01")).toBeInTheDocument();
    await screen.findByRole("option", { name: "Ana Pérez" });
    expect(screen.queryByRole("option", { name: "Oficina" })).not.toBeInTheDocument();

    const nota = screen.getByLabelText("Número de nota (opcional)");
    await usuario.clear(nota);
    await usuario.type(nota, "1235");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Venta TJ240304AP01")).toBeInTheDocument();
    expect(screen.getByText("1235")).toBeInTheDocument();
    expect(editarVenta).toHaveBeenCalledWith(
      "v1",
      expect.objectContaining({ numNota: "1235", vendedorId: "v-ana" }),
    );
  });

  it("Eliminar confirmado vuelve a la búsqueda y la refresca", async () => {
    const usuario = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    eliminarVenta.mockResolvedValue({ id: "v1" });
    render(<PantallaVentas sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: "TJ240304AP01" }));
    await usuario.click(await screen.findByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("button", { name: "Buscar" })).toBeInTheDocument();
    await waitFor(() => expect(buscarVentas).toHaveBeenCalledTimes(2));
  });
});

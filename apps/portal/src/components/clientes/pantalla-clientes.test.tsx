import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as clientesLib from "@/lib/clientes";
import type { ClienteDetalle, ClienteResumen } from "@/lib/clientes";
import * as tiposNegocioLib from "@/lib/tipos-negocio";
import * as productosLib from "@/lib/productos";
import * as preciosLib from "@/lib/precios";
import * as sucursalesLib from "@/lib/sucursales";
import { PantallaClientes } from "./pantalla-clientes";

// Mismo limite que pantalla-sucursales.test.tsx (T-65): se mockea la capa de
// red (lib/*.ts), no apiFetch. AuthProvider tambien se mockea porque su
// propia carga de sesion es un problema aparte de esta pantalla.
// next/navigation se mockea porque FiltroTipo (D7 del spec) usa
// useRouter/usePathname/useSearchParams, y jsdom no trae App Router.
vi.mock("@/lib/clientes");
vi.mock("@/lib/tipos-negocio");
vi.mock("@/lib/productos");
vi.mock("@/lib/precios");
vi.mock("@/lib/sucursales");
vi.mock("@/components/auth/auth-provider");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/catalogo/clientes",
  useSearchParams: () => new URLSearchParams(),
}));

const listarClientes = vi.mocked(clientesLib.listarClientes);
const obtenerCliente = vi.mocked(clientesLib.obtenerCliente);
const crearCliente = vi.mocked(clientesLib.crearCliente);
const editarCliente = vi.mocked(clientesLib.editarCliente);
const eliminarCliente = vi.mocked(clientesLib.eliminarCliente);
const usarAuthMock = vi.mocked(useAuth);

function mockAuth(puede: (clave: string) => boolean) {
  usarAuthMock.mockReturnValue({
    usuario: null,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede,
  });
}

const RESUMEN: ClienteResumen = {
  id: "1",
  nombre: "Abarrotes Lupita",
  telefono: "664-000-0000",
  tipo: "cliente",
  tipoNegocio: null,
  sucursalCodigo: "TJ",
};

const DETALLE: ClienteDetalle = {
  id: "1",
  nombre: "Abarrotes Lupita",
  domicilio: "Calle Falsa 123",
  telefono: "664-000-0000",
  encargado: null,
  factura: false,
  tipo: "cliente",
  tipoNegocioId: null,
  listaPrecioId: "lista-1",
  pctComision: null,
  promocion: "ninguna",
  plazoCreditoDias: null,
  lat: null,
  lng: null,
  comentarios: null,
  sucursalId: "suc-1",
  sucursalCodigo: "TJ",
  overridesPrecio: [],
  productosPromocion: [],
};

describe("PantallaClientes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tiposNegocioLib.listarTiposNegocio).mockResolvedValue([]);
    vi.mocked(productosLib.listarProductos).mockResolvedValue([]);
    vi.mocked(preciosLib.listarListasPrecio).mockResolvedValue([
      { id: "lista-1", nombre: "Lista 1" },
    ]);
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue([]);
  });

  it("muestra los clientes cargados y permite dar de alta cuando el usuario puede gestionar", async () => {
    mockAuth(() => true);
    listarClientes.mockResolvedValue([RESUMEN]);

    render(<PantallaClientes sucursal={null} tipo="todos" />);

    expect(await screen.findByText("Abarrotes Lupita")).toBeInTheDocument();
    expect(screen.getByText("664-000-0000")).toBeInTheDocument();
    expect(screen.getByText("Cliente")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo cliente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
  });

  it("oculta el alta, la edicion y la baja cuando el usuario no puede gestionar", async () => {
    mockAuth(() => false);
    listarClientes.mockResolvedValue([RESUMEN]);

    render(<PantallaClientes sucursal={null} tipo="todos" />);
    await screen.findByText("Abarrotes Lupita");

    expect(screen.queryByRole("button", { name: "Nuevo cliente" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
  });

  it("muestra el mensaje de error cuando la carga falla", async () => {
    mockAuth(() => true);
    listarClientes.mockRejectedValue(new Error("red caida"));

    render(<PantallaClientes sucursal={null} tipo="todos" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron cargar los clientes.",
    );
  });

  it("da de alta un cliente nuevo y recarga la lista", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarClientes.mockResolvedValueOnce([]);
    crearCliente.mockResolvedValue(DETALLE);
    listarClientes.mockResolvedValueOnce([RESUMEN]);

    render(<PantallaClientes sucursal={null} tipo="todos" />);
    await screen.findByText("No hay clientes que mostrar.");

    await usuario.click(screen.getByRole("button", { name: "Nuevo cliente" }));
    await usuario.type(screen.getByLabelText("Nombre"), "Abarrotes Lupita");
    await usuario.type(screen.getByLabelText("Domicilio / referencia"), "Calle Falsa 123");
    await usuario.type(screen.getByLabelText("Teléfono"), "664-000-0000");
    await usuario.selectOptions(screen.getByLabelText("Lista de precios"), "lista-1");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(crearCliente).toHaveBeenCalled());
    const payload = crearCliente.mock.calls[0][0];
    expect(payload.nombre).toBe("Abarrotes Lupita");
    expect(payload.listaPrecioId).toBe("lista-1");
    expect(payload.overridesPrecio).toEqual([]);
    expect(payload.productosPromocion).toEqual([]);

    expect(await screen.findByText("Abarrotes Lupita")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Nuevo cliente" })).not.toBeInTheDocument();
  });

  it("edita un cliente existente precargando su detalle completo", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarClientes.mockResolvedValueOnce([RESUMEN]);
    obtenerCliente.mockResolvedValue(DETALLE);
    editarCliente.mockResolvedValue({ ...DETALLE, nombre: "Abarrotes Lupita 2" });
    listarClientes.mockResolvedValueOnce([
      { ...RESUMEN, nombre: "Abarrotes Lupita 2" },
    ]);

    render(<PantallaClientes sucursal={null} tipo="todos" />);
    await screen.findByText("Abarrotes Lupita");

    await usuario.click(screen.getByRole("button", { name: "Editar" }));
    await waitFor(() => expect(obtenerCliente).toHaveBeenCalledWith("1"));

    const campoNombre = (await screen.findByLabelText("Nombre")) as HTMLInputElement;
    expect(campoNombre.value).toBe("Abarrotes Lupita");

    await usuario.clear(campoNombre);
    await usuario.type(campoNombre, "Abarrotes Lupita 2");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(editarCliente).toHaveBeenCalledWith("1", expect.anything()));
    expect(await screen.findByText("Abarrotes Lupita 2")).toBeInTheDocument();
  });

  it("da de baja un cliente tras confirmar, y recarga la lista", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    listarClientes.mockResolvedValueOnce([RESUMEN]);
    eliminarCliente.mockResolvedValue(undefined);
    listarClientes.mockResolvedValueOnce([]);

    render(<PantallaClientes sucursal={null} tipo="todos" />);
    await screen.findByText("Abarrotes Lupita");

    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(eliminarCliente).toHaveBeenCalledWith("1"));
    expect(await screen.findByText("No hay clientes que mostrar.")).toBeInTheDocument();
  });

  it("no llama a eliminarCliente si el usuario cancela la confirmacion", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    listarClientes.mockResolvedValue([RESUMEN]);

    render(<PantallaClientes sucursal={null} tipo="todos" />);
    await screen.findByText("Abarrotes Lupita");

    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(eliminarCliente).not.toHaveBeenCalled();
  });
});

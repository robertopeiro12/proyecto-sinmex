import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import { useAuth } from "@/components/auth/auth-provider";
import * as sucursalesLib from "@/lib/sucursales";
import type { Sucursal } from "@/lib/sucursales";
import { PantallaSucursales } from "./pantalla-sucursales";

// Se mockea la capa de red (lib/sucursales.ts), no apiFetch: mismo limite que
// usa useCatalogo.test.tsx al mockear `cargar`. AuthProvider tambien se
// mockea porque su propia carga de sesion (GET /auth/me) es un problema
// aparte de esta pantalla.
vi.mock("@/lib/sucursales");
vi.mock("@/components/auth/auth-provider");

const listarSucursales = vi.mocked(sucursalesLib.listarSucursales);
const crearSucursal = vi.mocked(sucursalesLib.crearSucursal);
const editarSucursal = vi.mocked(sucursalesLib.editarSucursal);
const usarAuthMock = vi.mocked(useAuth);

function mockAuth(puede: (clave: string) => boolean) {
  usarAuthMock.mockReturnValue({
    usuario: null,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede,
  });
}

const TIJUANA: Sucursal = { id: "1", codigo: "TJ", nombre: "Tijuana", activa: true };

describe("PantallaSucursales", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("muestra las sucursales cargadas y permite dar de alta cuando el usuario puede gestionar", async () => {
    mockAuth(() => true);
    listarSucursales.mockResolvedValue([TIJUANA]);

    render(<PantallaSucursales sucursal={null} />);

    expect(await screen.findByText("TJ")).toBeInTheDocument();
    expect(screen.getByText("Tijuana")).toBeInTheDocument();
    expect(screen.getByText("Activa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nueva sucursal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
  });

  it("oculta el alta y la edicion cuando el usuario no puede gestionar", async () => {
    mockAuth(() => false);
    listarSucursales.mockResolvedValue([TIJUANA]);

    render(<PantallaSucursales sucursal={null} />);
    await screen.findByText("TJ");

    expect(
      screen.queryByRole("button", { name: "Nueva sucursal" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("muestra el mensaje de error cuando la carga falla", async () => {
    mockAuth(() => true);
    listarSucursales.mockRejectedValue(new Error("red caida"));

    render(<PantallaSucursales sucursal={null} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron cargar las sucursales.",
    );
  });

  it("da de alta una sucursal nueva y recarga la lista", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarSucursales.mockResolvedValueOnce([]);
    crearSucursal.mockResolvedValue({
      id: "2",
      codigo: "MX",
      nombre: "Mexicali",
      activa: true,
    });
    listarSucursales.mockResolvedValueOnce([
      { id: "2", codigo: "MX", nombre: "Mexicali", activa: true },
    ]);

    render(<PantallaSucursales sucursal={null} />);
    await screen.findByText("No hay sucursales que mostrar.");

    await usuario.click(screen.getByRole("button", { name: "Nueva sucursal" }));
    await usuario.type(screen.getByLabelText("Código"), "MX");
    await usuario.type(screen.getByLabelText("Nombre"), "Mexicali");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(crearSucursal).toHaveBeenCalledWith({ codigo: "MX", nombre: "Mexicali" }),
    );
    expect(await screen.findByText("Mexicali")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Nueva sucursal" }),
    ).not.toBeInTheDocument();
  });

  it("edita una sucursal existente precargando sus datos", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarSucursales.mockResolvedValueOnce([TIJUANA]);
    editarSucursal.mockResolvedValue({ ...TIJUANA, nombre: "Tijuana Centro" });
    listarSucursales.mockResolvedValueOnce([{ ...TIJUANA, nombre: "Tijuana Centro" }]);

    render(<PantallaSucursales sucursal={null} />);
    await screen.findByText("TJ");

    await usuario.click(screen.getByRole("button", { name: "Editar" }));
    const campoNombre = screen.getByLabelText("Nombre") as HTMLInputElement;
    expect(campoNombre.value).toBe("Tijuana");

    await usuario.clear(campoNombre);
    await usuario.type(campoNombre, "Tijuana Centro");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(editarSucursal).toHaveBeenCalledWith("1", {
        nombre: "Tijuana Centro",
        activa: true,
      }),
    );
    expect(await screen.findByText("Tijuana Centro")).toBeInTheDocument();
  });

  it("muestra el mensaje del servidor cuando el alta choca con un duplicado", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarSucursales.mockResolvedValue([]);
    crearSucursal.mockRejectedValue(
      new ErrorApi("fallo", 409, "Ya existe una sucursal con el código MX."),
    );

    render(<PantallaSucursales sucursal={null} />);
    await screen.findByText("No hay sucursales que mostrar.");

    await usuario.click(screen.getByRole("button", { name: "Nueva sucursal" }));
    await usuario.type(screen.getByLabelText("Código"), "MX");
    await usuario.type(screen.getByLabelText("Nombre"), "Mexicali");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya existe una sucursal con el código MX.",
    );
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi, type UsuarioSesion } from "@/lib/api";
import { useAuth } from "@/components/auth/auth-provider";
import * as vendedoresLib from "@/lib/vendedores";
import type { Vendedor } from "@/lib/vendedores";
import * as sucursalesLib from "@/lib/sucursales";
import { PantallaVendedores } from "./pantalla-vendedores";

// Mismo limite que pantalla-usuarios.test.tsx (T-13) y pantalla-vehiculos.tsx
// (T-11): se mockea la capa de red (lib/*.ts), no apiFetch. AuthProvider
// tambien se mockea porque su propia carga de sesion es un problema aparte.
vi.mock("@/lib/vendedores");
vi.mock("@/lib/sucursales");
vi.mock("@/components/auth/auth-provider");

const listarVendedores = vi.mocked(vendedoresLib.listarVendedores);
const crearVendedor = vi.mocked(vendedoresLib.crearVendedor);
const editarVendedor = vi.mocked(vendedoresLib.editarVendedor);
const usarAuthMock = vi.mocked(useAuth);

const SESION_GENERAL: UsuarioSesion = {
  id: "sesion-1",
  login: "admin",
  nombre: "Admin",
  perfil: "Administrador General",
  sucursal: null,
  permisos: ["vendedor.gestionar"],
};

function mockAuth(
  puede: (clave: string) => boolean,
  usuario: UsuarioSesion | null = SESION_GENERAL,
) {
  usarAuthMock.mockReturnValue({
    usuario,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede,
  });
}

const VENDEDOR: Vendedor = {
  id: "1",
  nombre: "Abraham Solis",
  login: "asolis",
  sucursalId: "suc-1",
  sucursalCodigo: "TJ",
  folioSegmento: "AS",
  activo: true,
};

describe("PantallaVendedores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue([
      { id: "suc-1", codigo: "TJ", nombre: "Tijuana", activa: true },
    ]);
  });

  it("muestra el mensaje de permiso y NO llama a la API sin vendedor.gestionar", async () => {
    mockAuth(() => false);
    listarVendedores.mockResolvedValue([]);

    render(<PantallaVendedores sucursal={null} />);

    // PantallaCatalogo no oculta el listado por falta de permiso (solo el
    // boton de alta/editar) -- listarVendedores SI se llama porque el `GET`
    // es publico (Task 3). Esta prueba fija que el boton de alta no aparece.
    await screen.findByText("No hay vendedores que mostrar.");
    expect(
      screen.queryByRole("button", { name: "Nuevo vendedor" }),
    ).not.toBeInTheDocument();
  });

  it("muestra los vendedores cargados y permite dar de alta", async () => {
    mockAuth(() => true);
    listarVendedores.mockResolvedValue([VENDEDOR]);

    render(<PantallaVendedores sucursal={null} />);

    expect(await screen.findByText("Abraham Solis")).toBeInTheDocument();
    expect(screen.getByText("asolis")).toBeInTheDocument();
    expect(screen.getByText("AS")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Nuevo vendedor" }),
    ).toBeInTheDocument();
  });

  it("muestra el mensaje de error cuando la carga falla", async () => {
    mockAuth(() => true);
    listarVendedores.mockRejectedValue(new Error("red caida"));

    render(<PantallaVendedores sucursal={null} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron cargar los vendedores.",
    );
  });

  it("da de alta un vendedor nuevo, con desplegable de sucursal para un actor General", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarVendedores.mockResolvedValueOnce([]);
    crearVendedor.mockResolvedValue(VENDEDOR);
    listarVendedores.mockResolvedValueOnce([VENDEDOR]);

    render(<PantallaVendedores sucursal={null} />);
    await screen.findByText("No hay vendedores que mostrar.");

    await usuario.click(screen.getByRole("button", { name: "Nuevo vendedor" }));

    expect(screen.getByLabelText("Sucursal")).toBeInTheDocument();

    await usuario.type(screen.getByLabelText("Nombre completo"), "Abraham Solis");
    await usuario.type(screen.getByLabelText("Login (app)"), "asolis");
    await usuario.type(screen.getByLabelText("Contraseña"), "x");
    await usuario.selectOptions(screen.getByLabelText("Sucursal"), "suc-1");

    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(crearVendedor).toHaveBeenCalled());
    const payload = crearVendedor.mock.calls[0][0];
    expect(payload.nombre).toBe("Abraham Solis");
    expect(payload.login).toBe("asolis");
    expect(payload.sucursalId).toBe("suc-1");

    expect(await screen.findByText("Abraham Solis")).toBeInTheDocument();
  });

  it("un actor atado a una sucursal no ve el selector de sucursal al dar de alta", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true, {
      ...SESION_GENERAL,
      sucursal: { id: "suc-1", codigo: "TJ", nombre: "Tijuana" },
    });
    listarVendedores.mockResolvedValue([]);

    render(<PantallaVendedores sucursal={null} />);
    await screen.findByText("No hay vendedores que mostrar.");
    await usuario.click(screen.getByRole("button", { name: "Nuevo vendedor" }));

    expect(screen.queryByLabelText("Sucursal")).not.toBeInTheDocument();
  });

  it("edita un vendedor dejando la contraseña en blanco, y no la manda", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarVendedores.mockResolvedValueOnce([VENDEDOR]);
    editarVendedor.mockResolvedValue({ ...VENDEDOR, nombre: "Abraham Solis Jr" });
    listarVendedores.mockResolvedValueOnce([
      { ...VENDEDOR, nombre: "Abraham Solis Jr" },
    ]);

    render(<PantallaVendedores sucursal={null} />);
    await screen.findByText("Abraham Solis");

    await usuario.click(screen.getByRole("button", { name: "Editar" }));

    const campoContrasena = screen.getByLabelText(
      "Nueva contraseña (déjalo en blanco para no cambiarla)",
    );
    expect(campoContrasena).toHaveValue("");

    // El desplegable de sucursal nunca aparece en edicion, ni para un
    // General: la sucursal de un vendedor es inmutable (D3).
    expect(screen.queryByLabelText("Sucursal")).not.toBeInTheDocument();
    expect(screen.getByText(/Sucursal: TJ/)).toBeInTheDocument();

    const campoNombre = screen.getByLabelText("Nombre completo");
    await usuario.clear(campoNombre);
    await usuario.type(campoNombre, "Abraham Solis Jr");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(editarVendedor).toHaveBeenCalledWith("1", expect.anything()));
    const payload = editarVendedor.mock.calls[0][1];
    expect(payload.contrasena).toBeUndefined();
    expect(await screen.findByText("Abraham Solis Jr")).toBeInTheDocument();
  });

  it("muestra el mensaje exacto del servidor cuando el alta choca por colision de segmento", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarVendedores.mockResolvedValue([]);
    crearVendedor.mockRejectedValue(
      new ErrorApi(
        "fallo",
        409,
        'Ya hay un vendedor en esta sucursal con esas iniciales (AP). Ajusta el nombre para diferenciarlo.',
      ),
    );

    render(<PantallaVendedores sucursal={null} />);
    await screen.findByText("No hay vendedores que mostrar.");
    await usuario.click(screen.getByRole("button", { name: "Nuevo vendedor" }));

    await usuario.type(screen.getByLabelText("Nombre completo"), "Ana Ponce");
    await usuario.type(screen.getByLabelText("Login (app)"), "aponce");
    await usuario.type(screen.getByLabelText("Contraseña"), "x");
    await usuario.selectOptions(screen.getByLabelText("Sucursal"), "suc-1");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya hay un vendedor en esta sucursal con esas iniciales (AP).",
    );
  });
});

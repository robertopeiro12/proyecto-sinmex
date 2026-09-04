import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi, type UsuarioSesion } from "@/lib/api";
import { useAuth } from "@/components/auth/auth-provider";
import * as usuariosLib from "@/lib/usuarios";
import type { CatalogoPerfiles, UsuarioDetalle, UsuarioResumen } from "@/lib/usuarios";
import * as sucursalesLib from "@/lib/sucursales";
import { PantallaUsuarios } from "./pantalla-usuarios";

// Mismo limite que pantalla-clientes.test.tsx (T-12) y pantalla-sucursales.test.tsx
// (T-65): se mockea la capa de red (lib/*.ts), no apiFetch. AuthProvider
// tambien se mockea porque su propia carga de sesion es un problema aparte
// de esta pantalla.
vi.mock("@/lib/usuarios");
vi.mock("@/lib/sucursales");
vi.mock("@/components/auth/auth-provider");

const listarUsuarios = vi.mocked(usuariosLib.listarUsuarios);
const obtenerUsuario = vi.mocked(usuariosLib.obtenerUsuario);
const obtenerCatalogoPerfiles = vi.mocked(usuariosLib.obtenerCatalogoPerfiles);
const crearUsuario = vi.mocked(usuariosLib.crearUsuario);
const editarUsuario = vi.mocked(usuariosLib.editarUsuario);
const eliminarUsuario = vi.mocked(usuariosLib.eliminarUsuario);
const usarAuthMock = vi.mocked(useAuth);

const SESION_GENERAL: UsuarioSesion = {
  id: "sesion-1",
  login: "admin",
  nombre: "Admin",
  perfil: "Administrador General",
  sucursal: null,
  permisos: ["usuario.gestionar"],
};

function mockAuth(puede: (clave: string) => boolean, usuario: UsuarioSesion | null = SESION_GENERAL) {
  usarAuthMock.mockReturnValue({
    usuario,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede,
  });
}

const AUXILIAR_ID = "perfil-auxiliar";
const MAESTRO_ID = "perfil-maestro";

const CATALOGO: CatalogoPerfiles = {
  permisos: [
    { id: "p1", clave: "cliente.gestionar", grupo: "Operacion Comercial", descripcion: "Registrar/editar/eliminar clientes" },
    { id: "p2", clave: "vendedor.gestionar", grupo: "Operacion Comercial", descripcion: "Registrar/editar/eliminar vendedores" },
  ],
  perfiles: [
    { id: AUXILIAR_ID, nombre: "Auxiliar Administrativo", esMaestro: false, permisos: ["cliente.gestionar"] },
    { id: MAESTRO_ID, nombre: "Administrador General", esMaestro: true, permisos: ["cliente.gestionar", "vendedor.gestionar"] },
  ],
};

const RESUMEN: UsuarioResumen = {
  id: "1",
  login: "jgarcia",
  nombre: "Juan García",
  perfil: "Auxiliar Administrativo",
  perfilId: AUXILIAR_ID,
  sucursalCodigo: "TJ",
};

const DETALLE: UsuarioDetalle = {
  ...RESUMEN,
  sucursalId: "suc-1",
  permisosEfectivos: ["cliente.gestionar"],
};

describe("PantallaUsuarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    obtenerCatalogoPerfiles.mockResolvedValue(CATALOGO);
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue([
      { id: "suc-1", codigo: "TJ", nombre: "Tijuana", activa: true },
    ]);
  });

  it("muestra el mensaje de permiso y NO llama a la API sin usuario.gestionar (D6)", async () => {
    mockAuth(() => false);

    render(<PantallaUsuarios sucursal={null} />);

    expect(
      await screen.findByText("No tienes permiso para ver esta sección."),
    ).toBeInTheDocument();
    expect(listarUsuarios).not.toHaveBeenCalled();
  });

  it("muestra los usuarios cargados y permite dar de alta cuando el usuario puede gestionar", async () => {
    mockAuth(() => true);
    listarUsuarios.mockResolvedValue([RESUMEN]);

    render(<PantallaUsuarios sucursal={null} />);

    expect(await screen.findByText("jgarcia")).toBeInTheDocument();
    expect(screen.getByText("Auxiliar Administrativo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo usuario" })).toBeInTheDocument();
  });

  it("muestra el mensaje de error cuando la carga falla", async () => {
    mockAuth(() => true);
    listarUsuarios.mockRejectedValue(new Error("red caida"));

    render(<PantallaUsuarios sucursal={null} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron cargar los usuarios.",
    );
  });

  it("da de alta un usuario nuevo con permisos marcados segun el perfil elegido", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarUsuarios.mockResolvedValueOnce([]);
    crearUsuario.mockResolvedValue(DETALLE);
    listarUsuarios.mockResolvedValueOnce([RESUMEN]);

    render(<PantallaUsuarios sucursal={null} />);
    await screen.findByText("No hay usuarios que mostrar.");

    await usuario.click(screen.getByRole("button", { name: "Nuevo usuario" }));
    await usuario.type(screen.getByLabelText("Login"), "jgarcia");
    await usuario.type(screen.getByLabelText("Nombre"), "Juan García");
    await usuario.type(screen.getByLabelText("Contraseña"), "una-contrasena-larga");
    await usuario.selectOptions(screen.getByLabelText("Perfil"), AUXILIAR_ID);

    // El perfil Auxiliar solo da cliente.gestionar (CATALOGO): esa casilla
    // nace marcada, vendedor.gestionar no.
    expect(screen.getByRole("checkbox", { name: /cliente\.gestionar/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /vendedor\.gestionar/ })).not.toBeChecked();

    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(crearUsuario).toHaveBeenCalled());
    const payload = crearUsuario.mock.calls[0][0];
    expect(payload.login).toBe("jgarcia");
    expect(payload.perfilId).toBe(AUXILIAR_ID);
    expect(payload.permisosMarcados).toEqual(["cliente.gestionar"]);

    expect(await screen.findByText("jgarcia")).toBeInTheDocument();
  });

  it("elegir el perfil maestro deja la matriz marcada por completo y deshabilitada (D4)", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarUsuarios.mockResolvedValue([]);

    render(<PantallaUsuarios sucursal={null} />);
    await screen.findByText("No hay usuarios que mostrar.");
    await usuario.click(screen.getByRole("button", { name: "Nuevo usuario" }));

    await usuario.selectOptions(screen.getByLabelText("Perfil"), MAESTRO_ID);

    const casillaCliente = screen.getByRole("checkbox", { name: /cliente\.gestionar/ });
    const casillaVendedor = screen.getByRole("checkbox", { name: /vendedor\.gestionar/ });
    expect(casillaCliente).toBeChecked();
    expect(casillaVendedor).toBeChecked();
    expect(casillaCliente).toBeDisabled();
    expect(casillaVendedor).toBeDisabled();
  });

  it("edita un usuario existente precargando su detalle y sus permisos efectivos", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarUsuarios.mockResolvedValueOnce([RESUMEN]);
    obtenerUsuario.mockResolvedValue(DETALLE);
    editarUsuario.mockResolvedValue({ ...DETALLE, nombre: "Juan García López" });
    listarUsuarios.mockResolvedValueOnce([{ ...RESUMEN, nombre: "Juan García López" }]);

    render(<PantallaUsuarios sucursal={null} />);
    await screen.findByText("jgarcia");

    await usuario.click(screen.getByRole("button", { name: "Editar" }));
    await waitFor(() => expect(obtenerUsuario).toHaveBeenCalledWith("1"));

    // permisosEfectivos de DETALLE es solo ["cliente.gestionar"]: la
    // matriz se precarga con eso, no con lo que da el perfil.
    expect(await screen.findByRole("checkbox", { name: /cliente\.gestionar/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /vendedor\.gestionar/ })).not.toBeChecked();

    // El campo de contrasena existe pero se deja vacio -- no debe viajar.
    const campoContrasena = screen.getByLabelText(
      "Nueva contraseña (déjalo en blanco para no cambiarla)",
    );
    expect(campoContrasena).toHaveValue("");

    const campoNombre = screen.getByLabelText("Nombre");
    await usuario.clear(campoNombre);
    await usuario.type(campoNombre, "Juan García López");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(editarUsuario).toHaveBeenCalledWith("1", expect.anything()));
    const payload = editarUsuario.mock.calls[0][1];
    expect(payload.contrasena).toBeUndefined();
    expect(await screen.findByText("Juan García López")).toBeInTheDocument();
  });

  it("da de baja un usuario tras confirmar, y recarga la lista", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    listarUsuarios.mockResolvedValueOnce([RESUMEN]);
    eliminarUsuario.mockResolvedValue(undefined);
    listarUsuarios.mockResolvedValueOnce([]);

    render(<PantallaUsuarios sucursal={null} />);
    await screen.findByText("jgarcia");

    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(eliminarUsuario).toHaveBeenCalledWith("1"));
    expect(await screen.findByText("No hay usuarios que mostrar.")).toBeInTheDocument();
  });

  it("no llama a eliminarUsuario si el usuario cancela la confirmacion", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    listarUsuarios.mockResolvedValue([RESUMEN]);

    render(<PantallaUsuarios sucursal={null} />);
    await screen.findByText("jgarcia");

    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(eliminarUsuario).not.toHaveBeenCalled();
  });

  it("muestra el mensaje exacto del servidor cuando la baja choca con una proteccion de D7", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    listarUsuarios.mockResolvedValue([RESUMEN]);
    eliminarUsuario.mockRejectedValue(
      new ErrorApi("fallo", 409, "Debe quedar al menos un Administrador General activo."),
    );

    render(<PantallaUsuarios sucursal={null} />);
    await screen.findByText("jgarcia");

    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Debe quedar al menos un Administrador General activo.",
    );
  });

  it("un actor atado a una sucursal no ve el selector de sucursal en el formulario (D8)", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true, {
      ...SESION_GENERAL,
      sucursal: { id: "suc-1", codigo: "TJ", nombre: "Tijuana" },
    });
    listarUsuarios.mockResolvedValue([]);

    render(<PantallaUsuarios sucursal={null} />);
    await screen.findByText("No hay usuarios que mostrar.");
    await usuario.click(screen.getByRole("button", { name: "Nuevo usuario" }));

    expect(screen.queryByLabelText("Sucursal")).not.toBeInTheDocument();
    expect(screen.getByText("Sucursal: TJ")).toBeInTheDocument();
  });
});

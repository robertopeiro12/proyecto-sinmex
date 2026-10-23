import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as promocionesLib from "@/lib/promociones";
import type { Promocion } from "@/lib/promociones";
import * as productosLib from "@/lib/productos";
import * as sucursalesLib from "@/lib/sucursales";
import { PantallaPromociones } from "./pantalla-promociones";

vi.mock("@/lib/promociones", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/promociones")>();
  return { ...real, listarPromociones: vi.fn(), crearPromocion: vi.fn(), editarPromocion: vi.fn() };
});
vi.mock("@/lib/productos");
vi.mock("@/lib/sucursales");
vi.mock("@/components/auth/auth-provider");

type Sesion = NonNullable<ReturnType<typeof useAuth>["usuario"]>;
const ATADO = { sucursal: { id: "s-tj", codigo: "TJ", nombre: "Tijuana" } } as unknown as Sesion;
const GENERAL = { sucursal: null } as unknown as Sesion;

function mockAuth(puede: (clave: string) => boolean, usuario: Sesion | null = ATADO, cargando = false) {
  vi.mocked(useAuth).mockReturnValue({ usuario, cargando, cerrarSesion: vi.fn(), puede });
}

const base: Promocion = {
  id: "a",
  sucursalId: "s-tj",
  sucursalCodigo: "TJ",
  activo: true,
  audiencia: "todos",
  clienteId: null,
  clienteNombre: null,
  compraTipo: "producto",
  compraProductoId: "p-jawa",
  compraPresentacionId: null,
  compraCantidad: 10,
  regaloTipo: "mismo",
  regaloProductoId: null,
  regaloPresentacionId: null,
  regaloCantidad: 1,
  seRepite: true,
  compraNombre: "Jawa",
  regaloNombre: null,
  compraProductoCubierto: "p-jawa",
  texto: "Por cada 10 Jawa, 1 Jawa gratis",
};
const PROSPECTO: Promocion = {
  ...base,
  id: "b",
  audiencia: "prospecto",
  activo: false,
  compraCantidad: 0,
  seRepite: false,
  texto: "Bienvenida al prospecto: 1 Jawa gratis en su primera venta",
};

describe("PantallaPromociones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth(() => true);
    vi.mocked(promocionesLib.listarPromociones).mockResolvedValue([base, PROSPECTO]);
    vi.mocked(productosLib.listarProductos).mockResolvedValue([]);
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue([]);
  });

  it("sin permiso no hay botón Nueva ni Editar", async () => {
    mockAuth(() => false);
    render(<PantallaPromociones sucursal="TJ" />);
    await screen.findByText(base.texto);

    expect(screen.queryByRole("button", { name: "Nueva promoción" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("mientras carga la sesión dice Cargando…", () => {
    mockAuth(() => false, null, true);
    render(<PantallaPromociones sucursal="TJ" />);

    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(promocionesLib.listarPromociones).not.toHaveBeenCalled();
  });

  it("lista por sucursal con frase, para quién y estado", async () => {
    render(<PantallaPromociones sucursal="TJ" />);

    expect(await screen.findByText(base.texto)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Promociones" })).toBeInTheDocument();
    expect(
      screen.getByText("Los regalos por compra que la app aplica sola en cada venta."),
    ).toBeInTheDocument();
    expect(screen.getByText(PROSPECTO.texto)).toBeInTheDocument();
    expect(screen.getByText("Todos los clientes")).toBeInTheDocument();
    expect(screen.getByText("Prospectos (primera venta)")).toBeInTheDocument();
    expect(screen.getByText("Activa")).toBeInTheDocument();
    expect(screen.getByText("Inactiva")).toHaveClass("text-muted-foreground");
    expect(promocionesLib.listarPromociones).toHaveBeenCalledWith({ sucursal: "TJ" });
  });

  it("un General sin sucursal en el selector recibe el aviso y no llama a la API", () => {
    mockAuth(() => true, GENERAL);
    render(<PantallaPromociones sucursal={null} />);

    expect(screen.getByText("Elige una sucursal en el menú lateral para ver esta sección.")).toBeInTheDocument();
    expect(promocionesLib.listarPromociones).not.toHaveBeenCalled();
  });

  it("Nueva promoción abre el formulario con la sucursal del selector", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true, GENERAL);
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue([
      { id: "s-tj", codigo: "TJ", nombre: "Tijuana", activa: true, controlInventario: false, consumoDiarioMax: 1 },
      { id: "s-mx", codigo: "MX", nombre: "Mexicali", activa: true, controlInventario: false, consumoDiarioMax: 1 },
    ]);
    render(<PantallaPromociones sucursal="MX" />);
    await screen.findByText(base.texto);

    await usuario.click(screen.getByRole("button", { name: "Nueva promoción" }));

    // Modo "pantalla" (Etapa 2): el formulario reemplaza a la lista, sin ventana, con h1 del título.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← Volver a promociones" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Nueva promoción" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Nueva promoción" })).toHaveLength(1);
    const selector = await screen.findByLabelText("Sucursal");
    expect(selector).toHaveValue("s-mx");
  });

  it("← Volver regresa a la lista sin guardar nada", async () => {
    const usuario = userEvent.setup();
    render(<PantallaPromociones sucursal="TJ" />);
    await screen.findByText(base.texto);
    await usuario.click(screen.getByRole("button", { name: "Nueva promoción" }));

    await usuario.click(screen.getByRole("button", { name: "← Volver a promociones" }));

    expect(screen.getByRole("heading", { level: 1, name: "Promociones" })).toBeInTheDocument();
    expect(promocionesLib.crearPromocion).not.toHaveBeenCalled();
    expect(promocionesLib.editarPromocion).not.toHaveBeenCalled();
  });

  it("Editar abre la pantalla completa con h1 'Editar promoción'", async () => {
    const usuario = userEvent.setup();
    render(<PantallaPromociones sucursal="TJ" />);
    await screen.findByText(base.texto);

    await usuario.click(screen.getAllByRole("button", { name: "Editar" })[0]);

    expect(screen.getByRole("heading", { level: 1, name: "Editar promoción" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Editar promoción" })).toHaveLength(1);
  });

  it("recarga al cambiar el selector global", async () => {
    const { rerender } = render(<PantallaPromociones sucursal="TJ" />);
    await screen.findByText(base.texto);

    rerender(<PantallaPromociones sucursal="MX" />);

    await vi.waitFor(() =>
      expect(promocionesLib.listarPromociones).toHaveBeenLastCalledWith({ sucursal: "MX" }),
    );
    await screen.findByText(base.texto);
  });
});

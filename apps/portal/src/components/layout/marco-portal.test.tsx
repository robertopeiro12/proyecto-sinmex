import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import type { UsuarioSesion } from "@/lib/api";
import * as sucursalesLib from "@/lib/sucursales";
import type { Sucursal } from "@/lib/sucursales";
import { CLAVE_MENU_ESCONDIDO, MarcoPortal } from "./marco-portal";

vi.mock("next/navigation", () => ({ usePathname: vi.fn(), useRouter: vi.fn(), useSearchParams: vi.fn() }));
vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/sucursales", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursales")>()),
  listarSucursales: vi.fn(),
}));

const SUCURSALES: Sucursal[] = [
  { id: "s1", codigo: "TJ", nombre: "Tijuana", activa: true, controlInventario: false },
  { id: "s2", codigo: "MX", nombre: "Mexicali", activa: true, controlInventario: false },
];
const GENERAL: UsuarioSesion = { id: "u1", login: "admin", nombre: "Admin Local", perfil: "Administrador General", sucursal: null, permisos: [] };
const ATADO: UsuarioSesion = { ...GENERAL, id: "u2", sucursal: { id: "s1", codigo: "TJ", nombre: "Tijuana" } };

const cerrarSesion = vi.fn();

function preparar(query = "sucursal=TJ", usuario: UsuarioSesion = GENERAL) {
  vi.mocked(usePathname).mockReturnValue("/operacion/ventas");
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(query) as unknown as ReturnType<typeof useSearchParams>);
  vi.mocked(useRouter).mockReturnValue({ push: vi.fn() } as unknown as ReturnType<typeof useRouter>);
  vi.mocked(useAuth).mockReturnValue({ usuario, cargando: false, cerrarSesion, puede: () => true });
  vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue(SUCURSALES);
}

function renderizar() {
  return render(
    <MarcoPortal>
      <p>Contenido de la pantalla</p>
    </MarcoPortal>,
  );
}

describe("MarcoPortal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.clear();
    cerrarSesion.mockResolvedValue(undefined);
  });

  it("Review Focus 5: el contenido no empuja la página y el menú ocupa el alto de la ventana", () => {
    preparar();
    renderizar();
    const main = screen.getByText("Contenido de la pantalla").closest("main");
    expect(main).toHaveClass("min-w-0", "border-sucursal");
    expect(screen.getByRole("navigation", { name: "Menú principal" }).closest("aside")).toHaveClass("sticky", "h-dvh");
    expect(screen.getByRole("link", { name: "Ventas" })).toHaveAttribute("aria-current", "page");
  });

  it("el color de la sucursal llega a todo el marco", () => {
    preparar();
    renderizar();
    const marco = screen.getByText("Contenido de la pantalla").closest("main")?.parentElement;
    expect(marco?.style.getPropertyValue("--suc")).toBe("var(--suc-tj)");
  });

  it("la pestaña dice la pantalla y la sucursal", async () => {
    preparar();
    renderizar();
    await waitFor(() => expect(document.title).toBe("Ventas | JAWA Tijuana"));
  });

  it("con todas las sucursales la pestaña dice solo JAWA", async () => {
    preparar("");
    renderizar();
    await waitFor(() => expect(document.title).toBe("Ventas | JAWA"));
    // El botón aparece cuando llega la lista de sucursales (hay más de una para elegir).
    expect(await screen.findByRole("button", { name: /Sucursal: Todas las sucursales/ })).toBeInTheDocument();
  });

  it("un usuario atado ve su sucursal sin lista y la pestaña la dice", async () => {
    preparar("sucursal=MX", ATADO);
    renderizar();
    await waitFor(() => expect(document.title).toBe("Ventas | JAWA Tijuana"));
    expect(screen.queryByRole("button", { name: /Cambiar de sucursal/ })).not.toBeInTheDocument();
  });

  it("☰ esconde el menú y deja la franja con la sucursal y las iniciales; se recuerda", async () => {
    preparar();
    const usuario = userEvent.setup();
    const { unmount } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Esconder menú" }));
    expect(screen.queryByRole("navigation", { name: "Menú principal" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mostrar menú" })).toBeInTheDocument();
    expect(screen.getByText("TJ")).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.getByText("Contenido de la pantalla")).toBeInTheDocument();
    expect(localStorage.getItem(CLAVE_MENU_ESCONDIDO)).toBe("1");
    expect(screen.getByRole("button", { name: "Mostrar menú" })).toHaveFocus();
    unmount();

    renderizar();
    expect(await screen.findByRole("button", { name: "Mostrar menú" })).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Mostrar menú" }));
    expect(screen.getByRole("navigation", { name: "Menú principal" })).toBeInTheDocument();
    expect(localStorage.getItem(CLAVE_MENU_ESCONDIDO)).toBe("0");
    expect(screen.getByRole("button", { name: "Esconder menú" })).toHaveFocus();
  });

  it("el menú es un solo aside que se encoge y se estira (por eso puede animar su ancho)", async () => {
    preparar();
    const usuario = userEvent.setup();
    renderizar();
    const aside = screen.getByRole("navigation", { name: "Menú principal" }).closest("aside");
    expect(aside).toHaveClass("w-64");
    await waitFor(() => expect(aside).toHaveClass("transition-[width]"));
    await usuario.click(screen.getByRole("button", { name: "Esconder menú" }));
    expect(screen.getByRole("complementary", { name: "Menú escondido" })).toBe(aside);
    expect(aside).toHaveClass("w-[60px]");
  });

  it("Review Focus 2: sin localStorage el menú arranca abierto y se esconde igual", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    preparar();
    const usuario = userEvent.setup();
    renderizar();
    expect(screen.getByRole("navigation", { name: "Menú principal" })).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Esconder menú" }));
    expect(screen.getByRole("button", { name: "Mostrar menú" })).toBeInTheDocument();
  });

  it("Cerrar sesión desde el menú del usuario", async () => {
    preparar();
    const usuario = userEvent.setup();
    renderizar();
    await usuario.click(screen.getByRole("button", { name: /Admin Local/ }));
    await usuario.click(await screen.findByRole("menuitem", { name: "Cerrar sesión" }));
    expect(cerrarSesion).toHaveBeenCalledTimes(1);
  });
});

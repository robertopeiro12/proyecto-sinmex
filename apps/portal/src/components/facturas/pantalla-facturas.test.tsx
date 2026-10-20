import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as clientesLib from "@/lib/clientes";
import * as facturasLib from "@/lib/facturas";
import { PantallaFacturas } from "./pantalla-facturas";

vi.mock("@/lib/clientes");
vi.mock("@/lib/facturas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/facturas")>();
  return { ...real, listarPorFacturar: vi.fn(), buscarFacturas: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");

/** El panel que controla una pestaña (base-ui genera los ids). */
function panelDe(pestana: HTMLElement): HTMLElement | null {
  return document.getElementById(pestana.getAttribute("aria-controls") ?? "");
}

describe("PantallaFacturas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede: () => true });
    vi.mocked(clientesLib.listarClientes).mockResolvedValue([
      { id: "c1", nombre: "Cobach XXI", telefono: "664", tipo: "cliente", tipoNegocio: null, sucursalCodigo: "TJ" },
    ]);
    vi.mocked(facturasLib.listarPorFacturar).mockResolvedValue([
      { id: "v1", folio: "TJ240401OF01", fecha: "2024-04-01", numNota: null, montoCentavos: 10000, status: "pendiente", factura: "pendiente" },
    ]);
  });

  it("encabezado con su explicación, y pestañas ligadas a sus paneles con ARIA", () => {
    render(<PantallaFacturas sucursal={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Facturas" })).toBeInTheDocument();
    expect(screen.getByText(/factura del SAT/)).toBeInTheDocument();
    const asignar = screen.getByRole("tab", { name: "Asignar" });
    const buscar = screen.getByRole("tab", { name: "Buscar y corregir" });
    expect(asignar).toHaveAttribute("aria-selected", "true");
    expect(asignar).toHaveAttribute("tabindex", "0");
    expect(buscar).toHaveAttribute("tabindex", "-1");
    expect(panelDe(asignar)).toHaveAttribute("role", "tabpanel");
    expect(panelDe(asignar)).toHaveAttribute("aria-labelledby", asignar.id);
    expect(panelDe(buscar)).toHaveAttribute("aria-labelledby", buscar.id);
    expect(panelDe(buscar)).toHaveAttribute("hidden");
  });

  it("las flechas cambian de pestaña", async () => {
    const usuario = userEvent.setup();
    render(<PantallaFacturas sucursal={null} />);
    screen.getByRole("tab", { name: "Asignar" }).focus();
    await usuario.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Buscar y corregir" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Buscar y corregir" })).toHaveFocus();
    await usuario.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Asignar" })).toHaveAttribute("aria-selected", "true");
  });

  it("cambiar de pestaña no pierde las ventas marcadas", async () => {
    const usuario = userEvent.setup();
    render(<PantallaFacturas sucursal={null} />);
    await usuario.type(screen.getAllByLabelText("Cliente")[0], "coba");
    await usuario.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
    await usuario.click(await screen.findByLabelText("Marcar TJ240401OF01"));
    await waitFor(() => expect(screen.getByLabelText("Marcar TJ240401OF01")).toBeChecked());
    const asignar = screen.getByRole("tab", { name: "Asignar" });
    await usuario.click(screen.getByRole("tab", { name: "Buscar y corregir" }));
    expect(panelDe(asignar)).toHaveAttribute("hidden"); // oculto, no desmontado
    await usuario.click(asignar);
    expect(screen.getByLabelText("Marcar TJ240401OF01")).toBeChecked();
  });

  it("mientras carga la sesión dice Cargando…; sin el permiso lo dice, sin pestañas ni pedir nada", () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: true, cerrarSesion: vi.fn(), puede: () => false });
    const { unmount } = render(<PantallaFacturas sucursal={null} />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByText(/No tienes permiso/)).not.toBeInTheDocument();
    unmount();

    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede: () => false });
    render(<PantallaFacturas sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(clientesLib.listarClientes).not.toHaveBeenCalled();
  });
});

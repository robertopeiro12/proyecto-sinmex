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

  it("enlaza pestañas y paneles con ARIA y maneja tabIndex", () => {
    render(<PantallaFacturas sucursal={null} />);
    const asignar = screen.getByRole("tab", { name: "Asignar" });
    const buscar = screen.getByRole("tab", { name: "Buscar y corregir" });
    expect(asignar).toHaveAttribute("aria-controls", "panel-asignar");
    expect(buscar).toHaveAttribute("aria-controls", "panel-buscar");
    expect(asignar).toHaveAttribute("tabindex", "0");
    expect(buscar).toHaveAttribute("tabindex", "-1");
    expect(document.getElementById("panel-asignar")).toHaveAttribute("aria-labelledby", asignar.id);
    expect(document.getElementById("panel-buscar")).toHaveAttribute("aria-labelledby", buscar.id);
    expect(document.getElementById("panel-buscar")).toHaveAttribute("role", "tabpanel");
    expect(document.getElementById("panel-buscar")).toHaveAttribute("hidden");
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
    await usuario.type(screen.getByLabelText("Cliente"), "coba");
    await usuario.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
    await usuario.click(await screen.findByLabelText("Marcar TJ240401OF01"));
    await waitFor(() => expect(screen.getByLabelText("Marcar TJ240401OF01")).toBeChecked());
    await usuario.click(screen.getByRole("tab", { name: "Buscar y corregir" }));
    expect(document.getElementById("panel-asignar")).toHaveAttribute("hidden"); // oculto, no desmontado
    await usuario.click(screen.getByRole("tab", { name: "Asignar" }));
    expect(screen.getByLabelText("Marcar TJ240401OF01")).toBeChecked();
  });
});

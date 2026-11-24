import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { diaAnterior } from "@/lib/fechas";
import * as lib from "@/lib/inventario-vendedor";
import type { InventarioVendedor } from "@/lib/inventario-vendedor";
import * as vendedoresLib from "@/lib/vendedores";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaInventarioVendedor } from "./pantalla-inventario-vendedor";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/inventario-vendedor", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/inventario-vendedor")>();
  return { ...real, leerInventarioVendedor: vi.fn() };
});
vi.mock("@/lib/vendedores", () => ({ listarVendedores: vi.fn() }));

const HOY = hoyEnTijuana();

function mockAuth(permisos: string[], codigo: string | null = "TJ") {
  vi.mocked(useAuth).mockReturnValue({
    usuario: {
      id: "u1",
      login: "ana",
      nombre: "Ana",
      perfil: "Administrador General",
      sucursal: codigo ? { id: "s", codigo, nombre: codigo } : null,
      permisos,
    },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (c: string) => permisos.includes(c),
  });
}

const vacio = (): InventarioVendedor => ({
  fecha: HOY,
  hoy: HOY,
  sucursal: { id: "s", codigo: "TJ" },
  vendedor: null,
  lineas: [],
  totales: {} as InventarioVendedor["totales"],
  recargas: [],
  vendedoresSinCorte: 0,
  corte: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth(["inventario.ver"]);
  vi.mocked(lib.leerInventarioVendedor).mockResolvedValue(vacio());
  vi.mocked(vendedoresLib.listarVendedores).mockResolvedValue([
    { id: "v1", nombre: "Luis", login: "l", sucursalId: "s", sucursalCodigo: "TJ", folioSegmento: "LU", activo: true },
    { id: "v2", nombre: "Baja", login: "b", sucursalId: "s", sucursalCodigo: "TJ", folioSegmento: "BA", activo: false },
  ]);
});

describe("PantallaInventarioVendedor", () => {
  it("abre en hoy con Todos los vendedores y muestra el vacío", async () => {
    render(<PantallaInventarioVendedor sucursal={null} />);
    await waitFor(() =>
      expect(lib.leerInventarioVendedor).toHaveBeenCalledWith(HOY, "TJ", "todos"),
    );
    expect(await screen.findByText("No hubo carga ni venta ese día.")).toBeInTheDocument();
    expect(screen.getByText("Lo que cargó, vendió y regresó cada vendedor, por tamaño.")).toBeInTheDocument();
    const lista = await screen.findByRole("combobox", { name: "Vendedor" });
    const opciones = Array.from(lista.querySelectorAll("option")).map((o) => o.textContent);
    expect(opciones).toEqual(["Todos los vendedores", "Luis"]);
  });

  it("Ayer y elegir un vendedor vuelven a consultar", async () => {
    render(<PantallaInventarioVendedor sucursal={null} />);
    await screen.findByText("No hubo carga ni venta ese día.");
    await userEvent.click(screen.getByRole("button", { name: "Ayer" }));
    await waitFor(() =>
      expect(lib.leerInventarioVendedor).toHaveBeenLastCalledWith(diaAnterior(HOY), "TJ", "todos"),
    );
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Vendedor" }), "v1");
    await waitFor(() =>
      expect(lib.leerInventarioVendedor).toHaveBeenLastCalledWith(diaAnterior(HOY), "TJ", "v1"),
    );
  });

  it("General sin sucursal elegida pide elegirla", () => {
    mockAuth(["inventario.ver"], null);
    render(<PantallaInventarioVendedor sucursal={null} />);
    expect(screen.getByText(/Elige una sucursal/)).toBeInTheDocument();
    expect(lib.leerInventarioVendedor).not.toHaveBeenCalled();
  });

  it("General con sucursal del menú", async () => {
    mockAuth(["inventario.ver"], null);
    render(<PantallaInventarioVendedor sucursal="mx" />);
    await waitFor(() =>
      expect(lib.leerInventarioVendedor).toHaveBeenCalledWith(HOY, "MX", "todos"),
    );
  });

  it("sin permiso", () => {
    mockAuth([]);
    render(<PantallaInventarioVendedor sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(lib.leerInventarioVendedor).not.toHaveBeenCalled();
  });

  it("un fallo se muestra como error", async () => {
    vi.mocked(lib.leerInventarioVendedor).mockRejectedValue(new Error("x"));
    render(<PantallaInventarioVendedor sucursal={null} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

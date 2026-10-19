import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as lib from "@/lib/tesoreria";
import * as sucursalesLib from "@/lib/sucursales";
import { PestanaCuentas } from "./pestana-cuentas";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/sucursales");
vi.mock("./seccion-destinos", () => ({ SeccionDestinos: () => null }));
vi.mock("@/lib/tesoreria", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tesoreria")>();
  return {
    ...real,
    listarCuentasTesoreria: vi.fn(),
    crearCuentaTesoreria: vi.fn(),
    renombrarCuentaTesoreria: vi.fn(),
    eliminarCuentaTesoreria: vi.fn(),
  };
});

const CUENTAS = [
  { id: "g", nombre: "ScotiaFiscal", sucursalId: null, sucursalCodigo: null },
  { id: "t", nombre: "Efectivo TJ", sucursalId: "s-tj", sucursalCodigo: "TJ" },
];

function sesion(sucursal: { id: string; codigo: string; nombre: string } | null) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: { sucursal, permisos: ["tesoreria.gestionar"] } as never,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: () => true,
  });
}

describe("PestanaCuentas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lib.listarCuentasTesoreria).mockResolvedValue(CUENTAS);
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue([
      { id: "s-tj", codigo: "TJ", nombre: "Tijuana", activa: true },
    ]);
  });

  it("lista con 'General' y un General ve Editar y Eliminar en todas", async () => {
    sesion(null);
    render(<PestanaCuentas sucursal={null} />);
    const fila = (await screen.findByText("ScotiaFiscal")).closest("tr")!;
    expect(within(fila).getByText("General")).toBeInTheDocument();
    expect(within(fila).getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(within(fila).getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
  });

  it("un usuario de Tijuana no tiene botones sobre la general", async () => {
    sesion({ id: "s-tj", codigo: "TJ", nombre: "Tijuana" });
    render(<PestanaCuentas sucursal={null} />);
    const general = (await screen.findByText("ScotiaFiscal")).closest("tr")!;
    expect(within(general).queryByRole("button")).toBeNull();
    const propia = screen.getByText("Efectivo TJ").closest("tr")!;
    expect(within(propia).getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
  });

  it("eliminar pide confirmación y recarga", async () => {
    sesion(null);
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(lib.eliminarCuentaTesoreria).mockResolvedValue({ id: "t" });
    render(<PestanaCuentas sucursal={null} />);
    const fila = (await screen.findByText("Efectivo TJ")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Eliminar" }));
    expect(confirmar).toHaveBeenCalledWith(
      '¿Seguro que quieres eliminar la cuenta "Efectivo TJ"? Su historia se conserva, pero ya no aparecerá en la Tesorería.',
    );
    expect(lib.eliminarCuentaTesoreria).toHaveBeenCalledWith("t");
    expect(lib.listarCuentasTesoreria).toHaveBeenCalledTimes(2);
  });

  it("alta de un General: elige 'General (toda la empresa)' y no manda sucursalId", async () => {
    sesion(null);
    vi.mocked(lib.crearCuentaTesoreria).mockResolvedValue(CUENTAS[0]);
    render(<PestanaCuentas sucursal={null} />);
    await userEvent.click(await screen.findByRole("button", { name: "Nueva cuenta" }));
    await userEvent.type(screen.getByLabelText("Nombre de la cuenta"), "Caja Chica");
    await userEvent.selectOptions(screen.getByLabelText("Sucursal"), "general");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(lib.crearCuentaTesoreria).toHaveBeenCalledWith({ nombre: "Caja Chica" });
  });

  it("alta de un usuario atado: sin selector de sucursal", async () => {
    sesion({ id: "s-tj", codigo: "TJ", nombre: "Tijuana" });
    render(<PestanaCuentas sucursal={null} />);
    await userEvent.click(await screen.findByRole("button", { name: "Nueva cuenta" }));
    expect(screen.queryByLabelText("Sucursal")).toBeNull();
  });
});

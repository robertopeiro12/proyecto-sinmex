import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
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
      { id: "s-tj", codigo: "TJ", nombre: "Tijuana", activa: true, controlInventario: false, consumoDiarioMax: 1 },
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

  it("eliminar pide confirmar en una ventana y recarga", async () => {
    sesion(null);
    vi.mocked(lib.eliminarCuentaTesoreria).mockResolvedValue({ id: "t" });
    render(<PestanaCuentas sucursal={null} />);
    const fila = (await screen.findByText("Efectivo TJ")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Eliminar" }));
    const ventana = await screen.findByRole("alertdialog", { name: '¿Eliminar la cuenta "Efectivo TJ"?' });
    expect(within(ventana).getByText("Su historia se conserva, pero ya no aparecerá en la Tesorería.")).toBeInTheDocument();
    await userEvent.click(within(ventana).getByRole("button", { name: "Eliminar cuenta" }));
    expect(lib.eliminarCuentaTesoreria).toHaveBeenCalledWith("t");
    await waitFor(() => expect(lib.listarCuentasTesoreria).toHaveBeenCalledTimes(2));
  });

  it("cancelar la confirmación no elimina", async () => {
    sesion(null);
    render(<PestanaCuentas sucursal={null} />);
    const fila = (await screen.findByText("Efectivo TJ")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Eliminar" }));
    const ventana = await screen.findByRole("alertdialog");
    await userEvent.click(within(ventana).getByRole("button", { name: "Cancelar" }));
    expect(lib.eliminarCuentaTesoreria).not.toHaveBeenCalled();
  });

  it.each([
    [409, "Esa cuenta recibe la cobranza de TJ hoy."],
    [403, "Solo un General modifica las cuentas generales."],
  ])("un %s del servidor sale en un aviso con su mensaje y la fila sigue", async (status, mensaje) => {
    sesion(null);
    vi.mocked(lib.eliminarCuentaTesoreria).mockRejectedValue(new ErrorApi("falló", status, mensaje));
    render(<PestanaCuentas sucursal={null} />);
    const fila = (await screen.findByText("Efectivo TJ")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Eliminar" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Eliminar cuenta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(mensaje);
    expect(screen.getByText("Efectivo TJ")).toBeInTheDocument();
  });

  it("Nueva cuenta y Editar abren una ventana", async () => {
    sesion(null);
    render(<PestanaCuentas sucursal={null} />);
    await userEvent.click(await screen.findByRole("button", { name: "Nueva cuenta" }));
    expect(await screen.findByRole("dialog", { name: "Nueva cuenta" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const fila = screen.getByText("Efectivo TJ").closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Editar" }));
    expect(await screen.findByRole("dialog", { name: "Editar Efectivo TJ" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
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

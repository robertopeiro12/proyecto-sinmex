import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as lib from "@/lib/tesoreria";
import type { MovimientoManual } from "@/lib/tesoreria";
import { hoyEnTijuana } from "@/lib/ventas";
import { PestanaMovimientos } from "./pestana-movimientos";

vi.mock("@/lib/tesoreria", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tesoreria")>();
  return {
    ...real,
    listarMovimientos: vi.fn(),
    crearMovimiento: vi.fn(),
    editarMovimiento: vi.fn(),
    eliminarMovimiento: vi.fn(),
    listarCuentasTesoreria: vi.fn(),
  };
});

const HOY = hoyEnTijuana();
const CUENTAS = [
  { id: "a", nombre: "Efectivo TJ", sucursalId: "s", sucursalCodigo: "TJ" },
  { id: "b", nombre: "ScotiaFiscal", sucursalId: null, sucursalCodigo: null },
];
const MOV: MovimientoManual = {
  id: "m1", tipo: "traspaso", fecha: HOY, montoCentavos: 500_000, cuentaId: "a", cuentaNombre: "Efectivo TJ",
  cuentaDestinoId: "b", cuentaDestinoNombre: "ScotiaFiscal", comentario: "Depósito al banco", capturo: "Ana",
};

describe("PestanaMovimientos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lib.listarCuentasTesoreria).mockResolvedValue(CUENTAS);
    vi.mocked(lib.listarMovimientos).mockResolvedValue([MOV]);
    vi.mocked(lib.crearMovimiento).mockResolvedValue(MOV);
  });

  it("lista el mes en curso con el traspaso 'A → B'", async () => {
    render(<PestanaMovimientos sucursal="TJ" />);
    const lista = await screen.findByRole("table", { name: "Movimientos registrados" });
    expect(within(lista).getByText("Efectivo TJ → ScotiaFiscal")).toBeInTheDocument();
    expect(lib.listarMovimientos).toHaveBeenCalledWith({ desde: lib.primerDiaDelMesDe(HOY), hasta: HOY, sucursal: "TJ" });
  });

  it("registra un traspaso: tipo, de, a, monto con comas y comentario", async () => {
    render(<PestanaMovimientos sucursal={null} />);
    await screen.findByRole("table", { name: "Movimientos registrados" });
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "traspaso");
    await userEvent.selectOptions(screen.getByLabelText("De"), "a");
    await userEvent.selectOptions(screen.getByLabelText("A"), "b");
    await userEvent.type(screen.getByLabelText("Monto"), "5,000.00");
    await userEvent.type(screen.getByLabelText("Comentario"), "Depósito al banco");
    await userEvent.click(screen.getByRole("button", { name: "Registrar" }));
    expect(lib.crearMovimiento).toHaveBeenCalledWith({
      tipo: "traspaso", fecha: HOY, montoCentavos: 500_000, cuentaId: "a", cuentaDestinoId: "b", comentario: "Depósito al banco",
    });
    expect(lib.listarMovimientos).toHaveBeenCalledTimes(2);
  });

  it("traspaso a la misma cuenta: aviso en rojo tras tocar y Registrar bloqueado", async () => {
    render(<PestanaMovimientos sucursal={null} />);
    await screen.findByRole("table", { name: "Movimientos registrados" });
    expect(screen.getByRole("button", { name: "Registrar" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "traspaso");
    await userEvent.selectOptions(screen.getByLabelText("De"), "a");
    await userEvent.selectOptions(screen.getByLabelText("A"), "a");
    await userEvent.type(screen.getByLabelText("Monto"), "10");
    expect(screen.getByText("Elige dos cuentas distintas.")).toHaveClass("text-destructive");
    expect(screen.getByRole("button", { name: "Registrar" })).toBeDisabled();
  });

  it("editar reabre el formulario con los datos; eliminar pide confirmación", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(lib.eliminarMovimiento).mockResolvedValue({ id: "m1" });
    render(<PestanaMovimientos sucursal={null} />);
    const lista = await screen.findByRole("table", { name: "Movimientos registrados" });
    await userEvent.click(within(lista).getByRole("button", { name: "Editar" }));
    expect(screen.getByLabelText("Monto")).toHaveValue("5000.00");
    expect(screen.getByLabelText("Tipo")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await userEvent.click(within(lista).getByRole("button", { name: "Eliminar" }));
    expect(lib.eliminarMovimiento).toHaveBeenCalledWith("m1");
  });
});

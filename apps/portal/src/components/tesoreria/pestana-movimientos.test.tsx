import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as lib from "@/lib/tesoreria";
import type { MovimientoManual } from "@/lib/tesoreria";
import { formatearFecha } from "@/lib/reportes";
import { formatearPesos, hoyEnTijuana } from "@/lib/ventas";
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
  cuentaDestinoId: "b", cuentaDestinoNombre: "ScotiaFiscal", comentario: "Depósito al banco", capturo: "Ana", editable: true,
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

  it("Editar abre una ventana con el formulario de edición y el de arriba sigue diciendo Registrar operación", async () => {
    render(<PestanaMovimientos sucursal={null} />);
    const lista = await screen.findByRole("table", { name: "Movimientos registrados" });
    await userEvent.type(screen.getByLabelText("Monto"), "77");
    await userEvent.click(within(lista).getByRole("button", { name: "Editar" }));
    const ventana = await screen.findByRole("dialog", { name: "Editar traspaso" });
    expect(within(ventana).getByLabelText("Monto")).toHaveValue("5000.00");
    expect(within(ventana).getByLabelText("Tipo")).toBeDisabled();
    await userEvent.click(within(ventana).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Registrar operación" })).toBeInTheDocument();
    expect(screen.getByLabelText("Monto")).toHaveValue("77");
  });

  it("guardar la edición cierra la ventana y recarga la lista", async () => {
    vi.mocked(lib.editarMovimiento).mockResolvedValue(MOV);
    render(<PestanaMovimientos sucursal={null} />);
    const lista = await screen.findByRole("table", { name: "Movimientos registrados" });
    await userEvent.click(within(lista).getByRole("button", { name: "Editar" }));
    const ventana = await screen.findByRole("dialog", { name: "Editar traspaso" });
    await userEvent.click(within(ventana).getByRole("button", { name: "Guardar" }));
    expect(lib.editarMovimiento).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(lib.listarMovimientos).toHaveBeenCalledTimes(2);
  });

  it("Eliminar pide confirmar; Cancelar no elimina y confirmar sí", async () => {
    vi.mocked(lib.eliminarMovimiento).mockResolvedValue({ id: "m1" });
    render(<PestanaMovimientos sucursal={null} />);
    const lista = await screen.findByRole("table", { name: "Movimientos registrados" });
    await userEvent.click(within(lista).getByRole("button", { name: "Eliminar" }));
    const pregunta = await screen.findByRole("alertdialog", {
      name: `¿Eliminar el traspaso de ${formatearPesos(500_000)} del ${formatearFecha(HOY)}?`,
    });
    expect(within(pregunta).getByText("No se puede deshacer.")).toBeInTheDocument();
    await userEvent.click(within(pregunta).getByRole("button", { name: "Cancelar" }));
    expect(lib.eliminarMovimiento).not.toHaveBeenCalled();
    await userEvent.click(within(lista).getByRole("button", { name: "Eliminar" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Eliminar movimiento" }));
    expect(lib.eliminarMovimiento).toHaveBeenCalledWith("m1");
  });

  it("un movimiento no editable no muestra Editar ni Eliminar", async () => {
    vi.mocked(lib.listarMovimientos).mockResolvedValue([{ ...MOV, editable: false }]);
    render(<PestanaMovimientos sucursal={null} />);
    const lista = await screen.findByRole("table", { name: "Movimientos registrados" });
    expect(within(lista).queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(within(lista).queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
  });

  it("editar con cuentas fuera de la lista las muestra y solo manda lo cambiado", async () => {
    vi.mocked(lib.listarCuentasTesoreria).mockResolvedValue([]);
    vi.mocked(lib.editarMovimiento).mockResolvedValue(MOV);
    render(<PestanaMovimientos sucursal={null} />);
    const lista = await screen.findByRole("table", { name: "Movimientos registrados" });
    await userEvent.click(within(lista).getByRole("button", { name: "Editar" }));
    const ventana = await screen.findByRole("dialog", { name: "Editar traspaso" });
    expect(within(ventana).getByLabelText("De")).toHaveValue("a");
    expect(within(ventana).getByRole("option", { name: "Efectivo TJ" })).toBeInTheDocument();
    expect(within(ventana).getByLabelText("A")).toHaveValue("b");
    await userEvent.clear(within(ventana).getByLabelText("Comentario"));
    await userEvent.type(within(ventana).getByLabelText("Comentario"), "Otro");
    await userEvent.click(within(ventana).getByRole("button", { name: "Guardar" }));
    expect(lib.editarMovimiento).toHaveBeenCalledWith("m1", { fecha: HOY, montoCentavos: 500_000, comentario: "Otro" });
  });

  it("fecha vacía: aviso y Registrar bloqueado", async () => {
    render(<PestanaMovimientos sucursal={null} />);
    await screen.findByRole("table", { name: "Movimientos registrados" });
    await userEvent.selectOptions(screen.getByLabelText("Cuenta"), "a");
    await userEvent.type(screen.getByLabelText("Monto"), "10");
    await userEvent.clear(screen.getByLabelText("Fecha"));
    expect(screen.getByText("Elige la fecha.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar" })).toBeDisabled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as lib from "@/lib/tesoreria";
import type { SaldosDelDia } from "@/lib/tesoreria";
import { hoyEnTijuana } from "@/lib/ventas";
import { PestanaSaldos } from "./pestana-saldos";

vi.mock("@/lib/tesoreria", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tesoreria")>();
  return { ...real, obtenerSaldosDelDia: vi.fn(), guardarSaldos: vi.fn(), eliminarSaldoFijado: vi.fn() };
});

const HOY = hoyEnTijuana();
const DIA: SaldosDelDia = {
  fecha: HOY,
  cuentas: [
    { cuentaId: "a", nombre: "Efectivo TJ", sucursalCodigo: "TJ", saldo: { id: "s1", montoCentavos: 150050, comentario: "Arqueo" } },
    { cuentaId: "b", nombre: "ScotiaFiscal", sucursalCodigo: null, saldo: null },
    { cuentaId: "c", nombre: "Caja Chica", sucursalCodigo: "TJ", saldo: null },
  ],
  saldos: [
    { id: "s1", cuentaId: "a", cuentaNombre: "Efectivo TJ", sucursalCodigo: "TJ", fecha: HOY, montoCentavos: 150050, comentario: "Arqueo", capturo: "Ana" },
  ],
};

// "Efectivo TJ" sale en las dos tablas (captura y saldos fijados): se busca dentro de la de captura.
const captura = () => screen.getByRole("table", { name: "Saldos del día" });
const fila = (nombre: string) => within(captura()).getByText(nombre).closest("tr")!;

describe("PestanaSaldos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lib.obtenerSaldosDelDia).mockResolvedValue(DIA);
    vi.mocked(lib.guardarSaldos).mockResolvedValue({ guardados: 1 });
  });

  it("abre en hoy, sin fechas futuras, con las filas llenas donde ya hay saldo", async () => {
    render(<PestanaSaldos sucursal="TJ" />);
    expect(await screen.findByRole("table", { name: "Saldos del día" })).toBeInTheDocument();
    expect(lib.obtenerSaldosDelDia).toHaveBeenCalledWith({ fecha: HOY, sucursal: "TJ" });
    const fecha = screen.getByLabelText("Fecha del saldo") as HTMLInputElement;
    expect(fecha.value).toBe(HOY);
    expect(fecha.max).toBe(HOY);
    expect(within(fila("Efectivo TJ")).getByLabelText("Monto de Efectivo TJ")).toHaveValue("1500.50");
    expect(within(fila("ScotiaFiscal")).getByText("General")).toBeInTheDocument();
  });

  it("guarda solo las filas cambiadas, con signo y comentario", async () => {
    render(<PestanaSaldos sucursal={null} />);
    await screen.findByRole("table", { name: "Saldos del día" });
    await userEvent.type(screen.getByLabelText("Monto de ScotiaFiscal"), "-1,250.50");
    await userEvent.type(screen.getByLabelText("Comentario de ScotiaFiscal"), "Sobregiro");
    await userEvent.click(screen.getByRole("button", { name: "Guardar saldos" }));
    expect(lib.guardarSaldos).toHaveBeenCalledWith({
      fecha: HOY,
      saldos: [{ cuentaId: "b", montoCentavos: -125050, comentario: "Sobregiro" }],
    });
    expect(await screen.findByText(/Se guardó 1 saldo del/)).toBeInTheDocument();
  });

  it("sin cambios no llama a la API y lo dice", async () => {
    render(<PestanaSaldos sucursal={null} />);
    await screen.findByRole("table", { name: "Saldos del día" });
    await userEvent.click(screen.getByRole("button", { name: "Guardar saldos" }));
    expect(lib.guardarSaldos).not.toHaveBeenCalled();
    expect(screen.getByText("No hay cambios que guardar.")).toBeInTheDocument();
  });

  it("un monto mal escrito sale en rojo solo después de tocarlo y bloquea Guardar", async () => {
    render(<PestanaSaldos sucursal={null} />);
    await screen.findByRole("table", { name: "Saldos del día" });
    expect(screen.queryByText("Monto no válido")).toBeNull();
    await userEvent.type(screen.getByLabelText("Monto de Caja Chica"), "abc");
    expect(screen.getByText("Monto no válido")).toHaveClass("text-destructive");
    expect(screen.getByRole("button", { name: "Guardar saldos" })).toBeDisabled();
  });

  it("eliminar un saldo fijado pide confirmación y recarga", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(lib.eliminarSaldoFijado).mockResolvedValue({ id: "s1" });
    render(<PestanaSaldos sucursal={null} />);
    const lista = await screen.findByRole("table", { name: "Saldos fijados" });
    await userEvent.click(within(lista).getByRole("button", { name: "Eliminar" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(lib.eliminarSaldoFijado).toHaveBeenCalledWith("s1");
    expect(lib.obtenerSaldosDelDia).toHaveBeenCalledTimes(2);
  });
});

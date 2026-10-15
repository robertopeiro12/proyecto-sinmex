import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as excel from "@/lib/excel/exportar";
import * as lib from "@/lib/tesoreria";
import type { VistaTesoreria } from "@/lib/tesoreria";
import { hoyEnTijuana } from "@/lib/ventas";
import { PestanaVista } from "./pestana-vista";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/excel/exportar", () => ({ exportarExcel: vi.fn() }));
vi.mock("@/lib/tesoreria", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tesoreria")>();
  return { ...real, obtenerTesoreria: vi.fn() };
});

const HOY = hoyEnTijuana();
const VISTA: VistaTesoreria = {
  desde: HOY,
  hasta: HOY,
  cuentas: [
    { id: "b", nombre: "ScotiaFiscal", sucursalCodigo: null, saldoInicioCentavos: -250000, saldoFinalCentavos: -250000 },
    { id: "a", nombre: "Efectivo TJ", sucursalCodigo: "TJ", saldoInicioCentavos: null, saldoFinalCentavos: null },
  ],
  total: { saldoInicioCentavos: -250000, saldoFinalCentavos: -250000, cuentasConSaldoInicio: 1, cuentasConSaldoFinal: 1, cuentas: 2 },
  eventos: [],
};

describe("PestanaVista", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      usuario: { sucursal: null, permisos: ["tesoreria.ver"] } as never,
      cargando: false,
      cerrarSesion: vi.fn(),
      puede: () => true,
    });
    vi.mocked(lib.obtenerTesoreria).mockResolvedValue(VISTA);
  });

  it("consulta hoy al abrir y pinta General, Sin saldo inicial y negativos en rojo", async () => {
    render(<PestanaVista sucursal="TJ" />);
    expect(await screen.findByText("ScotiaFiscal")).toBeInTheDocument();
    expect(lib.obtenerTesoreria).toHaveBeenCalledWith({ desde: HOY, hasta: HOY, sucursal: "TJ" });
    const scotia = screen.getByText("ScotiaFiscal").closest("tr")!;
    expect(within(scotia).getByText("General")).toBeInTheDocument();
    expect(within(scotia).getAllByText("-$2,500.00")[0]).toHaveClass("text-destructive");
    const efectivo = screen.getByText("Efectivo TJ").closest("tr")!;
    expect(within(efectivo).getAllByText("Sin saldo inicial")).toHaveLength(2);
  });

  it("el total avisa cuántas cuentas tienen saldo", async () => {
    render(<PestanaVista sucursal={null} />);
    expect(await screen.findByText("Total Tesorería")).toBeInTheDocument();
    expect(screen.getByText("1 de 2 cuentas con saldo")).toBeInTheDocument();
  });

  it("sin saldos fijados en el rango lo dice", async () => {
    render(<PestanaVista sucursal={null} />);
    expect(await screen.findByText("Sin movimientos en el rango.")).toBeInTheDocument();
  });

  it("Ayer consulta el día anterior", async () => {
    render(<PestanaVista sucursal={null} />);
    await screen.findByText("ScotiaFiscal");
    await userEvent.click(screen.getByRole("button", { name: "Ayer" }));
    await userEvent.click(screen.getByRole("button", { name: "Mostrar" }));
    const ayer = lib.diaAnterior(HOY);
    expect(lib.obtenerTesoreria).toHaveBeenLastCalledWith({ desde: ayer, hasta: ayer, sucursal: null });
  });

  it("exporta lo consultado", async () => {
    render(<PestanaVista sucursal={null} />);
    await screen.findByText("ScotiaFiscal");
    await userEvent.click(screen.getByRole("button", { name: "Exportar a Excel" }));
    expect(excel.exportarExcel).toHaveBeenCalledWith(lib.definicionExcelTesoreria(VISTA, { sucursal: "Todas" }));
  });
});

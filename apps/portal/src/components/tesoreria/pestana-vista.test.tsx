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
    { id: "b", nombre: "ScotiaFiscal", sucursalCodigo: null, saldoInicioCentavos: -250000, saldoFinalCentavos: -250000, entradasCentavos: 0, salidasCentavos: 0, saldoFijadoEnRango: null },
    { id: "a", nombre: "Efectivo TJ", sucursalCodigo: "TJ", saldoInicioCentavos: null, saldoFinalCentavos: null, entradasCentavos: 0, salidasCentavos: 0, saldoFijadoEnRango: null },
  ],
  total: { saldoInicioCentavos: -250000, saldoFinalCentavos: -250000, cuentasConSaldoInicio: 1, cuentasConSaldoFinal: 1, cuentas: 2, entradasCentavos: 0, salidasCentavos: 0 },
  sinCuenta: [],
  gastosSinCuenta: [],
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

  it("al volver a activarse repite la consulta con el mismo rango", async () => {
    const { rerender } = render(<PestanaVista sucursal="TJ" activa />);
    await screen.findByText("ScotiaFiscal");
    expect(lib.obtenerTesoreria).toHaveBeenCalledTimes(1);
    rerender(<PestanaVista sucursal="TJ" activa={false} />);
    expect(lib.obtenerTesoreria).toHaveBeenCalledTimes(1);
    rerender(<PestanaVista sucursal="TJ" activa />);
    await screen.findByText("ScotiaFiscal");
    expect(lib.obtenerTesoreria).toHaveBeenCalledTimes(2);
    expect(lib.obtenerTesoreria).toHaveBeenLastCalledWith({ desde: HOY, hasta: HOY, sucursal: "TJ" });
  });

  it("el total avisa cuántas cuentas tienen saldo", async () => {
    render(<PestanaVista sucursal={null} />);
    expect(await screen.findByText("Total Tesorería")).toBeInTheDocument();
    expect(screen.getAllByText("1 de 2 cuentas con saldo")).toHaveLength(2);
  });

  it("avisa por columna cuando inicio y final tienen distinto número de cuentas", async () => {
    vi.mocked(lib.obtenerTesoreria).mockResolvedValue({
      ...VISTA,
      total: { ...VISTA.total, cuentasConSaldoInicio: 1, cuentasConSaldoFinal: 2, cuentas: 2 },
    });
    render(<PestanaVista sucursal={null} />);
    await screen.findByText("Total Tesorería");
    expect(screen.getAllByText("1 de 2 cuentas con saldo")).toHaveLength(1);
    expect(screen.queryByText("2 de 2 cuentas con saldo")).not.toBeInTheDocument();
  });

  it("sin saldos fijados en el rango lo dice", async () => {
    render(<PestanaVista sucursal={null} />);
    expect(await screen.findByText("Sin movimientos en el rango.")).toBeInTheDocument();
  });

  it("columnas Entradas y Salidas, marca de saldo fijado y aviso de cobranza sin cuenta", async () => {
    vi.mocked(lib.obtenerTesoreria).mockResolvedValue({
      ...VISTA,
      cuentas: [
        { id: "a", nombre: "Efectivo TJ", sucursalCodigo: "TJ", saldoInicioCentavos: 100_000, saldoFinalCentavos: 120_000, entradasCentavos: 30_000, salidasCentavos: 10_000, saldoFijadoEnRango: "2026-10-10" },
      ],
      sinCuenta: [{ sucursalCodigo: "MX", metodo: "transferencia", montoCentavos: 325_000 }],
    });
    render(<PestanaVista sucursal={null} />);
    const tabla = await screen.findByRole("table", { name: "Tesorería por cuenta" });
    expect(within(tabla).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Cuenta", "Sucursal", "Saldo al inicio", "Entradas", "Salidas", "Saldo al final",
    ]);
    const fila = within(tabla).getByText("Efectivo TJ").closest("tr")!;
    expect(within(fila).getByText("$300.00")).toBeInTheDocument();
    expect(within(fila).getByText("$100.00")).toBeInTheDocument();
    expect(within(fila).getByText("saldo fijado el 10/10/2026")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("$3,250.00 de cobranza de MX (transferencia) sin cuenta asignada");
  });

  it("movimientos del rango con concepto y cuenta de cada tipo", async () => {
    vi.mocked(lib.obtenerTesoreria).mockResolvedValue({
      ...VISTA,
      eventos: [
        { tipo: "cobranza", id: "c", fecha: HOY, cuentaId: "a", cuentaNombre: "Efectivo TJ", sucursalCodigo: "TJ", metodo: "efectivo", cantidad: 12, montoCentavos: 840_000 },
        { tipo: "traspaso", id: "t", fecha: HOY, cuentaId: "a", cuentaNombre: "Efectivo TJ", cuentaDestinoId: "b", cuentaDestinoNombre: "ScotiaFiscal", montoCentavos: 500_000, comentario: null, capturo: "Ana" },
      ],
    });
    render(<PestanaVista sucursal={null} />);
    const tabla = await screen.findByRole("table", { name: "Movimientos del rango" });
    expect(within(tabla).getByText("Cobranza en efectivo · 12 cobros · TJ")).toBeInTheDocument();
    expect(within(tabla).getByText("Efectivo TJ → ScotiaFiscal")).toBeInTheDocument();
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

  it("los gastos de ruta salen como salida con su concepto y sin comentario ni capturó", async () => {
    vi.mocked(lib.obtenerTesoreria).mockResolvedValue({
      ...VISTA,
      eventos: [
        { tipo: "gasto-ruta", id: "g", fecha: HOY, cuentaId: "a", cuentaNombre: "Efectivo TJ", sucursalCodigo: "TJ", cantidad: 2, montoCentavos: 33_050 },
      ],
    });
    render(<PestanaVista sucursal={null} />);
    const tabla = await screen.findByRole("table", { name: "Movimientos del rango" });
    const fila = within(tabla).getByText("Gastos de ruta · 2 gastos · TJ").closest("tr")!;
    expect(within(fila).getByText("-$330.50")).toBeInTheDocument();
    expect(within(fila).getAllByRole("cell").slice(-2).map((c) => c.textContent)).toEqual(["—", "—"]);
  });

  it("avisa de los gastos de ruta sin cuenta de efectivo, aunque no haya cobranza sin cuenta", async () => {
    vi.mocked(lib.obtenerTesoreria).mockResolvedValue({
      ...VISTA,
      gastosSinCuenta: [{ sucursalCodigo: "TJ", montoCentavos: 33_050 }],
    });
    render(<PestanaVista sucursal={null} />);
    const aviso = await screen.findByRole("status");
    expect(aviso).toHaveTextContent("$330.50 de gastos de ruta de TJ sin cuenta de efectivo");
    expect(aviso).toHaveTextContent(
      "Los gastos de ruta salen de la cuenta que recibe la cobranza en efectivo de su sucursal: configúrala en Cuentas → ¿A qué cuenta entra la cobranza?",
    );
    expect(aviso).not.toHaveTextContent("de cobranza de");
  });
});

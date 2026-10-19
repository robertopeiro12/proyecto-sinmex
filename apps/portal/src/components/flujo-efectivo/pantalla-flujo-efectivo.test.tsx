import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as excel from "@/lib/excel/exportar";
import * as fe from "@/lib/flujo-efectivo";
import type { FlujoEfectivo } from "@/lib/flujo-efectivo";
import { diaAnterior } from "@/lib/tesoreria";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaFlujoEfectivo } from "./pantalla-flujo-efectivo";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/flujo-efectivo", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/flujo-efectivo")>();
  return { ...real, obtenerFlujoEfectivo: vi.fn() };
});
vi.mock("@/lib/excel/exportar", () => ({ exportarExcel: vi.fn() }));

const obtener = vi.mocked(fe.obtenerFlujoEfectivo);
const exportarExcel = vi.mocked(excel.exportarExcel);

const FLUJO: FlujoEfectivo = {
  desde: "2026-10-13",
  hasta: "2026-10-14",
  ventasTotalesCentavos: 100000,
  cobradoRepartidorCentavos: 60000,
  cobradoOficinaCentavos: 27500,
  ventasCobradasCentavos: 87500,
  porcentajeCobro: 87.5,
  gastosDisponibles: false,
  gastosProduccionCentavos: 0,
  gastosOperacionCentavos: 0,
  gastosFinancierosCentavos: 0,
  utilidadBrutaCentavos: 87500,
  utilidadOperacionCentavos: 87500,
  utilidadNetaCentavos: 87500,
  dias: [
    { fecha: "2026-10-13", ventasCentavos: 40000, cobradoRepartidorCentavos: 30000, cobradoOficinaCentavos: 0, porcentajeCobro: 75 },
    { fecha: "2026-10-14", ventasCentavos: 60000, cobradoRepartidorCentavos: 30000, cobradoOficinaCentavos: 27500, porcentajeCobro: 95.8 },
  ],
  totalTesoreriaCentavos: 250000,
  tesoreriaCuentasConSaldo: 2,
  tesoreriaCuentas: 3,
  comentarios: {
    ingresos: [{ fecha: "2026-10-13", folio: "TJ261013AP01", cliente: "Cobach XXI", comentario: "Pagó con cheque" }],
    egresos: [{ fecha: "2026-10-14", concepto: "Retiro", cuenta: "Caja TJ", montoCentavos: 5000, comentario: "Gasolina" }],
  },
};

function mockAuth(permisos: string[]) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: { id: "u1", login: "ana", nombre: "Ana", perfil: "Administrador General", sucursal: null, permisos },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (clave: string) => permisos.includes(clave),
  });
}

const CONCEPTOS = [
  "Ventas Totales", "Ventas Repartidor", "Ventas Oficinas", "Ventas Cobradas", "% de Cobro",
  "Gastos de Producción", "Utilidad Bruta", "Gastos Operativos", "Utilidad de Operación",
  "Gastos Financieros", "Utilidad Neta", "Total Tesorería",
];

describe("PantallaFlujoEfectivo", () => {
  beforeEach(() => {
    obtener.mockReset();
    exportarExcel.mockReset();
    mockAuth(["flujo_efectivo.ver"]);
  });

  it("consulta hoy al abrir", async () => {
    obtener.mockResolvedValue(FLUJO);
    render(<PantallaFlujoEfectivo sucursal="TJ" />);
    const hoy = hoyEnTijuana();
    await waitFor(() => expect(obtener).toHaveBeenCalledWith({ desde: hoy, hasta: hoy, sucursal: "TJ" }));
  });

  it("muestra los conceptos en orden con sus montos", async () => {
    obtener.mockResolvedValue(FLUJO);
    render(<PantallaFlujoEfectivo sucursal={null} />);
    const tabla = await screen.findByRole("table", { name: "Flujo de Efectivo" });
    const filas = within(tabla).getAllByRole("row");
    expect(filas.map((f) => within(f).getAllByRole("cell")[0].textContent)).toEqual(CONCEPTOS);
    expect(filas[0]).toHaveTextContent("$1,000.00");
    expect(filas[4]).toHaveTextContent("87.5%");
    expect(filas[10]).toHaveTextContent("$875.00");
    expect(filas[11]).toHaveTextContent("$2,500.00");
    expect(screen.getByText("2 de 3 cuentas con saldo")).toBeInTheDocument();
  });

  it("anota que no hay gastos registrados", async () => {
    obtener.mockResolvedValue(FLUJO);
    render(<PantallaFlujoEfectivo sucursal={null} />);
    await screen.findByRole("table", { name: "Flujo de Efectivo" });
    expect(screen.getAllByText("sin gastos registrados todavía (llegan con Compras y Egresos)")).toHaveLength(3);
  });

  it("sin la nota cuando hay gastos y sin aviso de cuentas si todas tienen saldo", async () => {
    obtener.mockResolvedValue({ ...FLUJO, gastosDisponibles: true, tesoreriaCuentasConSaldo: 3 });
    render(<PantallaFlujoEfectivo sucursal={null} />);
    await screen.findByRole("table", { name: "Flujo de Efectivo" });
    expect(screen.queryByText(/sin gastos registrados/)).not.toBeInTheDocument();
    expect(screen.queryByText(/cuentas con saldo/)).not.toBeInTheDocument();
  });

  it("la utilidad negativa va en rojo", async () => {
    obtener.mockResolvedValue({ ...FLUJO, utilidadNetaCentavos: -5000 });
    render(<PantallaFlujoEfectivo sucursal={null} />);
    const monto = await screen.findByText("-$50.00");
    expect(monto).toHaveClass("text-destructive");
  });

  it("sin ventas el porcentaje es una raya", async () => {
    obtener.mockResolvedValue({ ...FLUJO, ventasTotalesCentavos: 0, porcentajeCobro: null, dias: [] });
    render(<PantallaFlujoEfectivo sucursal={null} />);
    const tabla = await screen.findByRole("table", { name: "Flujo de Efectivo" });
    expect(within(tabla).getAllByRole("row")[4]).toHaveTextContent("—");
  });

  it("desglose por día", async () => {
    obtener.mockResolvedValue(FLUJO);
    render(<PantallaFlujoEfectivo sucursal={null} />);
    const tabla = await screen.findByRole("table", { name: "Desglose por día" });
    const filas = within(tabla).getAllByRole("row");
    expect(filas).toHaveLength(3);
    expect(filas[0]).toHaveTextContent("Fecha");
    expect(filas[2]).toHaveTextContent("14/10/2026");
    expect(filas[2]).toHaveTextContent("$600.00");
    expect(filas[2]).toHaveTextContent("$275.00");
    expect(filas[2]).toHaveTextContent("95.8%");
  });

  it("comentarios de ingresos y egresos", async () => {
    obtener.mockResolvedValue(FLUJO);
    render(<PantallaFlujoEfectivo sucursal={null} />);
    const seccion = await screen.findByRole("region", { name: "Comentarios" });
    expect(within(seccion).getByText("TJ261013AP01")).toBeInTheDocument();
    expect(within(seccion).getByText("Pagó con cheque")).toBeInTheDocument();
    expect(within(seccion).getByText("Caja TJ")).toBeInTheDocument();
    expect(within(seccion).getByText("$50.00")).toBeInTheDocument();
    expect(within(seccion).getByText("Gasolina")).toBeInTheDocument();
  });

  it("comentarios vacíos", async () => {
    obtener.mockResolvedValue({ ...FLUJO, comentarios: { ingresos: [], egresos: [] } });
    render(<PantallaFlujoEfectivo sucursal={null} />);
    const seccion = await screen.findByRole("region", { name: "Comentarios" });
    expect(within(seccion).getAllByText("Sin comentarios en el rango.")).toHaveLength(2);
  });

  it("Ayer + Mostrar consulta el día anterior", async () => {
    obtener.mockResolvedValue(FLUJO);
    render(<PantallaFlujoEfectivo sucursal={null} />);
    await screen.findByRole("table", { name: "Flujo de Efectivo" });
    await userEvent.click(screen.getByRole("button", { name: "Ayer" }));
    await userEvent.click(screen.getByRole("button", { name: "Mostrar" }));
    const ayer = diaAnterior(hoyEnTijuana());
    await waitFor(() => expect(obtener).toHaveBeenLastCalledWith({ desde: ayer, hasta: ayer, sucursal: null }));
  });

  it("exporta a Excel lo consultado", async () => {
    obtener.mockResolvedValue(FLUJO);
    render(<PantallaFlujoEfectivo sucursal="TJ" />);
    await screen.findByRole("table", { name: "Flujo de Efectivo" });
    await userEvent.click(screen.getByRole("button", { name: "Exportar a Excel" }));
    await waitFor(() => expect(exportarExcel).toHaveBeenCalledTimes(1));
    expect(exportarExcel.mock.calls[0][0].titulo).toBe("Flujo de Efectivo");
  });

  it("muestra el error de la consulta", async () => {
    obtener.mockRejectedValue(new Error("boom"));
    render(<PantallaFlujoEfectivo sucursal={null} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("sin permiso, el aviso y ninguna consulta", () => {
    mockAuth([]);
    render(<PantallaFlujoEfectivo sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver el Flujo de Efectivo")).toBeInTheDocument();
    expect(obtener).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as excel from "@/lib/excel/exportar";
import * as rv from "@/lib/reporte-ventas";
import type { ReporteVentas } from "@/lib/reporte-ventas";
import * as vendedoresLib from "@/lib/vendedores";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaReporteVentas } from "./pantalla-reporte-ventas";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/reporte-ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/reporte-ventas")>();
  return { ...real, obtenerReporteVentas: vi.fn() };
});
vi.mock("@/lib/vendedores", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/vendedores")>();
  return { ...real, listarVendedores: vi.fn() };
});
vi.mock("@/lib/excel/exportar", () => ({ exportarExcel: vi.fn() }));

const obtener = vi.mocked(rv.obtenerReporteVentas);
const listarVendedores = vi.mocked(vendedoresLib.listarVendedores);
const exportarExcel = vi.mocked(excel.exportarExcel);

const REPORTE: ReporteVentas = {
  desde: "2026-10-13",
  hasta: "2026-10-14",
  dias: [
    {
      fecha: "2026-10-13",
      ventas: [
        { id: "a", fecha: "2026-10-13", folio: "TJ261013AP01", cliente: "Cobach XXI", numNota: null, repartidor: "Juan Pérez", status: "pagada", factura: "N/A", semana: 42, cantidad: 20, promocion: 2, montoCentavos: 13000 },
        { id: "b", fecha: "2026-10-13", folio: "TJ261013OF01", cliente: "El Moreno", numNota: "345", repartidor: null, status: "pendiente", factura: "A780", semana: 42, cantidad: 12, promocion: 0, montoCentavos: 7800 },
      ],
      subtotal: { ventas: 2, cantidad: 32, promocion: 2, montoCentavos: 20800 },
    },
    {
      fecha: "2026-10-14",
      ventas: [
        { id: "c", fecha: "2026-10-14", folio: "TJ261014AP01", cliente: "Los Caldotes", numNota: null, repartidor: "Ana Ruiz", status: "abonado", factura: "Pendiente", semana: 42, cantidad: 30, promocion: 0, montoCentavos: 19500 },
      ],
      subtotal: { ventas: 1, cantidad: 30, promocion: 0, montoCentavos: 19500 },
    },
  ],
  porRepartidor: [
    { vendedorId: "ana", repartidor: "Ana Ruiz", ventas: 1, cantidad: 30, promocion: 0, montoCentavos: 19500 },
    { vendedorId: "juan", repartidor: "Juan Pérez", ventas: 1, cantidad: 20, promocion: 2, montoCentavos: 13000 },
    { vendedorId: null, repartidor: null, ventas: 1, cantidad: 12, promocion: 0, montoCentavos: 7800 },
  ],
  total: { ventas: 3, cantidad: 62, promocion: 2, montoCentavos: 40300 },
};

const VENDEDORES = [
  { id: "juan", nombre: "Juan Pérez", login: "juan", sucursalId: "s", sucursalCodigo: "TJ", folioSegmento: "JP", activo: true },
  { id: "viejo", nombre: "Beto Viejo", login: "beto", sucursalId: "s", sucursalCodigo: "TJ", folioSegmento: "BV", activo: false },
];

function mockAuth(permisos: string[], codigoSucursal: string | null = null) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: {
      id: "u1", login: "ana", nombre: "Ana", perfil: "Administrador General",
      sucursal: codigoSucursal ? { id: "s", codigo: codigoSucursal, nombre: codigoSucursal } : null,
      permisos,
    },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (clave: string) => permisos.includes(clave),
  });
}

const PERMISO = "reporte_ventas.ver";

describe("PantallaReporteVentas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    obtener.mockResolvedValue(REPORTE);
    listarVendedores.mockResolvedValue(VENDEDORES);
    exportarExcel.mockResolvedValue(undefined);
  });

  it("mientras carga la sesión dice Cargando…, no \"No tienes permiso\"", () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: true, cerrarSesion: vi.fn(), puede: () => false });
    render(<PantallaReporteVentas sucursal={null} />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByText(/No tienes permiso/)).not.toBeInTheDocument();
  });

  it("sin reporte_ventas.ver lo dice y no pide nada", () => {
    mockAuth([]);
    render(<PantallaReporteVentas sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver el reporte de ventas")).toBeInTheDocument();
    expect(obtener).not.toHaveBeenCalled();
    expect(listarVendedores).not.toHaveBeenCalled();
  });

  it("no consulta al abrir; fechas por defecto hoy; Mostrar manda rango, sucursal y repartidor", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal="TJ" />);
    expect(obtener).not.toHaveBeenCalled();
    const hoy = hoyEnTijuana();
    expect(screen.getByLabelText("Desde")).toHaveValue(hoy);
    expect(screen.getByLabelText("Hasta")).toHaveValue(hoy);
    await u.selectOptions(await screen.findByLabelText("Repartidor"), "oficina");
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(obtener).toHaveBeenCalledWith({ desde: hoy, hasta: hoy, sucursal: "TJ", repartidor: "oficina" });
  });

  it("los atajos llenan las fechas sin consultar", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal={null} />);
    const hoy = hoyEnTijuana();
    await u.click(screen.getByRole("button", { name: "Esta semana" }));
    expect(screen.getByLabelText("Desde")).toHaveValue(rv.rangoSemana(hoy).desde);
    expect(screen.getByLabelText("Hasta")).toHaveValue(rv.rangoSemana(hoy).hasta);
    await u.click(screen.getByRole("button", { name: "Este mes" }));
    expect(screen.getByLabelText("Desde")).toHaveValue(rv.rangoMes(hoy).desde);
    await u.click(screen.getByRole("button", { name: "Hoy" }));
    expect(screen.getByLabelText("Hasta")).toHaveValue(hoy);
    expect(obtener).not.toHaveBeenCalled();
  });

  it("vendedor inactivo aparece en el filtro marcado (Review Focus 2)", async () => {
    mockAuth([PERMISO]);
    render(<PantallaReporteVentas sucursal={null} />);
    const filtro = await screen.findByLabelText("Repartidor");
    expect(await within(filtro).findByRole("option", { name: "Beto Viejo (inactivo)" })).toHaveValue("viejo");
    expect(within(filtro).getByRole("option", { name: "Todos" })).toHaveValue("");
    expect(within(filtro).getByRole("option", { name: "Oficina" })).toHaveValue("oficina");
  });

  it("fechas invertidas: aviso y no consulta", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal={null} />);
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-01" } });
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("La fecha inicial no puede ser posterior a la final.");
    expect(obtener).not.toHaveBeenCalled();
  });

  it("pinta ventas, subtotales por día, TOTAL, resumen por repartidor, Oficina y —", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    const tabla = await screen.findByRole("table", { name: "Ventas" });
    expect(within(tabla).getByText("TJ261013AP01")).toBeInTheDocument();
    const filaOficina = within(tabla).getByText("TJ261013OF01").closest("tr")!;
    expect(within(filaOficina).getByText("Oficina")).toBeInTheDocument();
    const filaSinNota = within(tabla).getByText("TJ261013AP01").closest("tr")!;
    expect(within(filaSinNota).getByText("—")).toBeInTheDocument();
    const subtotal = within(tabla).getByText("Total 13/10/2026").closest("tr")!;
    expect(within(subtotal).getByText("32")).toBeInTheDocument();
    expect(within(subtotal).getByText("$208.00")).toBeInTheDocument();
    const total = within(tabla).getByText("TOTAL").closest("tr")!;
    expect(within(total).getByText("62")).toBeInTheDocument();
    expect(within(total).getByText("$403.00")).toBeInTheDocument();
    const resumen = screen.getByRole("table", { name: "Resumen por repartidor" });
    expect(within(resumen).getAllByRole("row").slice(1).map((r) => r.firstChild?.textContent)).toEqual(["Ana Ruiz", "Juan Pérez", "Oficina"]);
    expect(screen.getByText("3 ventas · 62 piezas · 2 promo · $403.00")).toBeInTheDocument();
  });

  it("tabla alineada: toda celda con px-3 y números a la derecha (Review Focus 5)", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    const tabla = await screen.findByRole("table", { name: "Ventas" });
    expect(tabla).toHaveClass("table-fixed");
    for (const celda of within(tabla).getAllByRole("cell").concat(within(tabla).getAllByRole("columnheader"))) {
      expect(celda).toHaveClass("px-3");
    }
    const encabezados = within(tabla).getAllByRole("columnheader").map((h) => h.textContent);
    expect(encabezados).toEqual(["Fecha", "Folio", "Cliente", "# nota", "Repartidor", "Status", "Factura", "Semana", "Cantidad", "Promo", "Monto"]);
    const monto = within(tabla).getByText("$130.00");
    expect(monto).toHaveClass("text-right");
    expect(monto).toHaveClass("tabular-nums");
  });

  it("sin ventas lo dice y Excel queda deshabilitado", async () => {
    mockAuth([PERMISO]);
    obtener.mockResolvedValue({ ...REPORTE, dias: [], porRepartidor: [], total: { ventas: 0, cantidad: 0, promocion: 0, montoCentavos: 0 } });
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(await screen.findByText("No hay ventas en ese rango.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar a Excel" })).toBeDisabled();
  });

  it("error del servidor en role=alert", async () => {
    mockAuth([PERMISO]);
    obtener.mockRejectedValue(new ErrorApi("Bad Request", 400, "El rango no puede pasar de un año."));
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El rango no puede pasar de un año.");
  });

  it("una consulta vieja no pisa a la nueva; Actualizando… mientras (Review Focus 4)", async () => {
    mockAuth([PERMISO]);
    let soltarVieja: (r: ReporteVentas) => void = () => {};
    let soltarNueva: (r: ReporteVentas) => void = () => {};
    obtener
      .mockResolvedValueOnce(REPORTE)
      .mockImplementationOnce(() => new Promise((r) => { soltarVieja = r; }))
      .mockImplementationOnce(() => new Promise((r) => { soltarNueva = r; }));
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    await screen.findByRole("table", { name: "Ventas" });
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByText("Actualizando…")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    const soloUno: ReporteVentas = { ...REPORTE, dias: [REPORTE.dias[1]], porRepartidor: [REPORTE.porRepartidor[0]], total: { ventas: 1, cantidad: 30, promocion: 0, montoCentavos: 19500 } };
    await act(async () => { soltarNueva(soloUno); });
    await act(async () => { soltarVieja(REPORTE); });
    expect(screen.getByText("1 venta · 30 piezas · 0 promo · $195.00")).toBeInTheDocument();
    expect(screen.queryByText("TJ261013AP01")).not.toBeInTheDocument();
    expect(screen.queryByText("Actualizando…")).not.toBeInTheDocument();
  });

  it("exporta lo consultado con sucursal y repartidor aplicados", async () => {
    mockAuth([PERMISO], "TJ");
    const u = userEvent.setup();
    render(<PantallaReporteVentas sucursal={null} />);
    await screen.findByRole("option", { name: "Juan Pérez" });
    await u.selectOptions(screen.getByLabelText("Repartidor"), "juan");
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    await screen.findByRole("table", { name: "Ventas" });
    // Cambiar el filtro después de consultar no cambia lo que se exporta.
    await u.selectOptions(screen.getByLabelText("Repartidor"), "oficina");
    await u.click(screen.getByRole("button", { name: "Exportar a Excel" }));
    expect(exportarExcel).toHaveBeenCalledWith(
      rv.definicionExcelReporteVentas(REPORTE, { sucursal: "TJ", repartidor: "Juan Pérez" }),
    );
  });
});

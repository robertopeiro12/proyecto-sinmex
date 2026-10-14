import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as excel from "@/lib/excel/exportar";
import * as rcn from "@/lib/reporte-clientes-nuevos";
import type { ReporteClientesNuevos } from "@/lib/reporte-clientes-nuevos";
import { rangoMes, rangoSemana } from "@/lib/reporte-ventas";
import { primerDiaDelMes } from "@/lib/reportes";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaClientesNuevos } from "./pantalla-clientes-nuevos";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/reporte-clientes-nuevos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/reporte-clientes-nuevos")>();
  return { ...real, obtenerReporteClientesNuevos: vi.fn() };
});
vi.mock("@/lib/excel/exportar", () => ({ exportarExcel: vi.fn() }));

const obtener = vi.mocked(rcn.obtenerReporteClientesNuevos);
const exportarExcel = vi.mocked(excel.exportarExcel);

const REPORTE: ReporteClientesNuevos = {
  desde: "2026-10-01",
  hasta: "2026-10-14",
  clientes: [
    { id: "1", fechaAlta: "2026-10-03", nombre: "Cobach XXI", sucursalCodigo: "TJ", tipoNegocio: "Escuela", listaPrecio: "Lista 1", telefono: "6640000001", encargado: "Lupita", usuario: "Ana Admin", dadoDeBaja: false },
    { id: "2", fechaAlta: "2026-10-09", nombre: "Abarrotes Cerrado", sucursalCodigo: "TJ", tipoNegocio: null, listaPrecio: null, telefono: "6640000002", encargado: null, usuario: null, dadoDeBaja: true },
  ],
  total: 2,
};

function mockAuth(permisos: string[], codigoSucursal: string | null = null) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: { id: "u1", login: "ana", nombre: "Ana", perfil: "Administrador General", sucursal: codigoSucursal ? { id: "s", codigo: codigoSucursal, nombre: codigoSucursal } : null, permisos },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (clave: string) => permisos.includes(clave),
  });
}
const PERMISO = "reportes.ver";

describe("PantallaClientesNuevos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    obtener.mockResolvedValue(REPORTE);
    exportarExcel.mockResolvedValue(undefined);
  });

  it("sesión cargando → Cargando…", () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: true, cerrarSesion: vi.fn(), puede: () => false });
    render(<PantallaClientesNuevos sucursal={null} />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByText(/No tienes permiso/)).not.toBeInTheDocument();
  });

  it("sin reportes.ver lo dice y no pide nada", () => {
    mockAuth([]);
    render(<PantallaClientesNuevos sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver reportes")).toBeInTheDocument();
    expect(obtener).not.toHaveBeenCalled();
  });

  it("no consulta al abrir; fechas por defecto del día 1 a hoy; atajos solo llenan", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaClientesNuevos sucursal="TJ" />);
    const hoy = hoyEnTijuana();
    expect(obtener).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Desde")).toHaveValue(primerDiaDelMes(hoy));
    expect(screen.getByLabelText("Hasta")).toHaveValue(hoy);
    await u.click(screen.getByRole("button", { name: "Esta semana" }));
    expect(screen.getByLabelText("Desde")).toHaveValue(rangoSemana(hoy).desde);
    await u.click(screen.getByRole("button", { name: "Este mes" }));
    expect(screen.getByLabelText("Hasta")).toHaveValue(rangoMes(hoy).hasta);
    await u.click(screen.getByRole("button", { name: "Hoy" }));
    expect(screen.getByLabelText("Desde")).toHaveValue(hoy);
    expect(obtener).not.toHaveBeenCalled();
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(obtener).toHaveBeenCalledWith({ desde: hoy, hasta: hoy, sucursal: "TJ" });
  });

  it("fechas invertidas: aviso y no consulta", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaClientesNuevos sucursal={null} />);
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-01" } });
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("La fecha inicial no puede ser posterior a la final.");
    expect(obtener).not.toHaveBeenCalled();
  });

  it("pinta filas, — , (dado de baja), rango consultado y total", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaClientesNuevos sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    const tabla = await screen.findByRole("table", { name: "Clientes nuevos" });
    const fila1 = within(tabla).getByText("Cobach XXI").closest("tr")!;
    expect(within(fila1).getByText("03/10/2026")).toBeInTheDocument();
    expect(within(fila1).getByText("Ana Admin")).toBeInTheDocument();
    const fila2 = within(tabla).getByText("Abarrotes Cerrado (dado de baja)").closest("tr")!;
    expect(within(fila2).getAllByText("—")).toHaveLength(4);
    expect(screen.getByText("Del 01/10/2026 al 14/10/2026 · Sucursal: Todas")).toBeInTheDocument();
    expect(screen.getByText("2 clientes nuevos")).toBeInTheDocument();
  });

  it("tabla alineada: table-fixed, px-2 en toda celda, 8 columnas por fila", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup();
    render(<PantallaClientesNuevos sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    const tabla = await screen.findByRole("table", { name: "Clientes nuevos" });
    expect(tabla).toHaveClass("table-fixed");
    expect(tabla).toHaveClass("min-w-[57rem]");
    expect(tabla.querySelectorAll("col")).toHaveLength(8);
    for (const celda of [...within(tabla).getAllByRole("cell"), ...within(tabla).getAllByRole("columnheader")]) {
      expect(celda).toHaveClass("px-2");
    }
    for (const fila of within(tabla).getAllByRole("row")) {
      expect(fila.children).toHaveLength(8);
    }
    expect(within(tabla).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Fecha de alta", "Cliente", "Sucursal", "Tipo de negocio", "Lista de precios", "Teléfono", "Encargado", "Usuario",
    ]);
  });

  it("sin resultados lo dice y Excel deshabilitado; error del servidor en alert", async () => {
    mockAuth([PERMISO]);
    obtener.mockResolvedValueOnce({ ...REPORTE, clientes: [], total: 0 });
    const u = userEvent.setup();
    render(<PantallaClientesNuevos sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(await screen.findByText("No hay clientes nuevos en ese rango.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar a Excel" })).toBeDisabled();
    obtener.mockRejectedValueOnce(new ErrorApi("Bad Request", 400, "El rango no puede pasar de un año."));
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El rango no puede pasar de un año.");
  });

  it("una consulta vieja no pisa a la nueva; Actualizando… (Review Focus 5)", async () => {
    mockAuth([PERMISO]);
    let soltarVieja: (r: ReporteClientesNuevos) => void = () => {};
    let soltarNueva: (r: ReporteClientesNuevos) => void = () => {};
    obtener
      .mockResolvedValueOnce(REPORTE)
      .mockImplementationOnce(() => new Promise((r) => { soltarVieja = r; }))
      .mockImplementationOnce(() => new Promise((r) => { soltarNueva = r; }));
    const u = userEvent.setup();
    render(<PantallaClientesNuevos sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    await screen.findByRole("table", { name: "Clientes nuevos" });
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByText("Actualizando…")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    await act(async () => { soltarNueva({ ...REPORTE, clientes: [REPORTE.clientes[0]], total: 1 }); });
    await act(async () => { soltarVieja(REPORTE); });
    expect(screen.getByText("1 cliente nuevo")).toBeInTheDocument();
    expect(screen.queryByText("Abarrotes Cerrado (dado de baja)")).not.toBeInTheDocument();
    expect(screen.queryByText("Actualizando…")).not.toBeInTheDocument();
  });

  it("exporta lo consultado con la sucursal del usuario atado", async () => {
    mockAuth([PERMISO], "TJ");
    const u = userEvent.setup();
    render(<PantallaClientesNuevos sucursal={null} />);
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    await screen.findByRole("table", { name: "Clientes nuevos" });
    await u.click(screen.getByRole("button", { name: "Exportar a Excel" }));
    expect(exportarExcel).toHaveBeenCalledWith(rcn.definicionExcelClientesNuevos(REPORTE, { sucursal: "TJ" }));
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as excel from "@/lib/excel/exportar";
import * as reportes from "@/lib/reportes";
import type { ReporteKilometraje } from "@/lib/reportes";
import { diaAnterior } from "@/lib/fechas";
import { hoyEnTijuana } from "@/lib/ventas";
import * as vehiculosLib from "@/lib/vehiculos";
import { PantallaKilometraje } from "./pantalla-kilometraje";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/reportes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/reportes")>();
  return { ...real, obtenerReporteKilometraje: vi.fn() };
});
vi.mock("@/lib/vehiculos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/vehiculos")>();
  return { ...real, listarVehiculos: vi.fn() };
});
vi.mock("@/lib/excel/exportar", () => ({ exportarExcel: vi.fn() }));

const obtener = vi.mocked(reportes.obtenerReporteKilometraje);
const listarVehiculos = vi.mocked(vehiculosLib.listarVehiculos);
const exportarExcel = vi.mocked(excel.exportarExcel);

const REPORTE: ReporteKilometraje = {
  desde: "2026-10-01",
  hasta: "2026-10-13",
  vehiculos: [
    {
      vehiculoId: "v1",
      nombre: "Nissan-01",
      placas: "ABC-123",
      activo: true,
      jornadas: [
        { jornadaId: "j1", fecha: "2026-10-01", vendedor: "Juan Pérez", kmInicialDecimas: 100000, kmFinalDecimas: 102505, kilometrosDecimas: 2505, saltoDecimas: null, fechaAnterior: null },
        { jornadaId: "j2", fecha: "2026-10-02", vendedor: "Pedro López", kmInicialDecimas: 104000, kmFinalDecimas: 105200, kilometrosDecimas: 1200, saltoDecimas: 1495, fechaAnterior: "2026-10-01" },
      ],
      totalKilometrosDecimas: 3705,
      totalSaltoDecimas: 1495,
    },
    {
      vehiculoId: "v2",
      nombre: "Vieja",
      placas: null,
      activo: false,
      jornadas: [
        { jornadaId: "j3", fecha: "2026-10-03", vendedor: "Juan Pérez", kmInicialDecimas: 5000, kmFinalDecimas: 5600, kilometrosDecimas: 600, saltoDecimas: null, fechaAnterior: null },
      ],
      totalKilometrosDecimas: 600,
      totalSaltoDecimas: 0,
    },
  ],
  totalKilometrosDecimas: 4305,
  totalSaltoDecimas: 1495,
};

const VEHICULOS = [
  { id: "v1", nombre: "Nissan-01", placas: "ABC-123", kmInicial: 0, sucursalId: "s", sucursalCodigo: "TJ", activo: true },
  { id: "v2", nombre: "Vieja", placas: null, kmInicial: 0, sucursalId: "s", sucursalCodigo: "TJ", activo: false },
];

function mockAuth(puede: (clave: string) => boolean, codigoSucursal: string | null = null) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: {
      id: "u1",
      login: "ana",
      nombre: "Ana",
      perfil: "Administrador General",
      sucursal: codigoSucursal ? { id: "s", codigo: codigoSucursal, nombre: codigoSucursal } : null,
      permisos: [],
    },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede,
  });
}

describe("PantallaKilometraje", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarVehiculos.mockResolvedValue(VEHICULOS);
    obtener.mockResolvedValue(REPORTE);
    exportarExcel.mockResolvedValue(undefined);
  });

  it("mientras carga la sesión dice Cargando…, no \"No tienes permiso\"", () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: true, cerrarSesion: vi.fn(), puede: () => false });
    render(<PantallaKilometraje sucursal={null} />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByText(/No tienes permiso/)).not.toBeInTheDocument();
  });

  it("sin reportes.ver lo dice y no pide nada", () => {
    mockAuth(() => false);
    render(<PantallaKilometraje sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(listarVehiculos).not.toHaveBeenCalled();
    expect(obtener).not.toHaveBeenCalled();
  });

  it("arranca con el mes en curso, lista los vehiculos de la sucursal y no consulta hasta Mostrar", async () => {
    mockAuth(() => true);
    render(<PantallaKilometraje sucursal="TJ" />);
    const hoy = hoyEnTijuana();
    expect(screen.getByLabelText("Desde")).toHaveValue(`${hoy.slice(0, 8)}01`);
    expect(screen.getByLabelText("Hasta")).toHaveValue(hoy);
    expect(await screen.findByRole("option", { name: "Vieja (desactivado)" })).toBeInTheDocument();
    expect(listarVehiculos).toHaveBeenCalledWith("TJ");
    expect(obtener).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Exportar a Excel" })).toBeDisabled();
  });

  it("con fechas invertidas avisa y no consulta", async () => {
    mockAuth(() => true);
    const usuario = userEvent.setup();
    render(<PantallaKilometraje sucursal={null} />);
    // Un <input type="date"> en jsdom se cambia con un evento, no tecleando.
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2099-12-31" } });
    await usuario.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("La fecha inicial no puede ser posterior a la final.");
    expect(obtener).not.toHaveBeenCalled();
  });

  it("pinta grupos, totales y el salto resaltado con su explicacion", async () => {
    mockAuth(() => true);
    const usuario = userEvent.setup();
    render(<PantallaKilometraje sucursal="TJ" />);
    await usuario.click(screen.getByRole("button", { name: "Mostrar" }));

    // `selector: "th"`: el mismo texto esta en la lista de vehiculos del filtro.
    expect(await screen.findByText("Nissan-01 (ABC-123)", { selector: "th" })).toBeInTheDocument();
    expect(screen.getByText("Vieja (desactivado)", { selector: "th" })).toBeInTheDocument();
    // "+149.5" sale 3 veces (renglon, total del vehiculo, gran total): se busca dentro del renglon.
    const renglon = screen.getByText("02/10/2026").closest("tr") as HTMLElement;
    const salto = within(renglon).getByText("+149.5");
    expect(salto).toHaveAttribute(
      "title",
      "Empezó 149.5 km distinto a como terminó la jornada anterior de este vehículo (01/10/2026).",
    );
    expect(renglon).toHaveAttribute("data-salto", "si");
    expect(screen.getByText("01/10/2026").closest("tr")).not.toHaveAttribute("data-salto");
    const total = screen.getByText("Total general").closest("tr");
    expect(total).not.toBeNull();
    expect(within(total as HTMLElement).getByText("430.5")).toBeInTheDocument();
    expect(obtener).toHaveBeenCalledWith({
      desde: `${hoyEnTijuana().slice(0, 8)}01`,
      hasta: hoyEnTijuana(),
      vehiculoId: null,
      sucursal: "TJ",
    });
  });

  it("sin jornadas lo dice y no deja exportar", async () => {
    mockAuth(() => true);
    obtener.mockResolvedValue({ ...REPORTE, vehiculos: [], totalKilometrosDecimas: 0, totalSaltoDecimas: 0 });
    const usuario = userEvent.setup();
    render(<PantallaKilometraje sucursal={null} />);
    await usuario.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(await screen.findByText("No hay jornadas cerradas en ese rango.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar a Excel" })).toBeDisabled();
  });

  it("muestra el mensaje del servidor si la consulta falla", async () => {
    mockAuth(() => true);
    obtener.mockRejectedValue(new ErrorApi("x", 400, "El rango no puede pasar de un año."));
    const usuario = userEvent.setup();
    render(<PantallaKilometraje sucursal={null} />);
    await usuario.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El rango no puede pasar de un año.");
  });

  it("Review Focus 5: exporta lo consultado con los filtros aplicados, aunque luego se cambien", async () => {
    mockAuth(() => true, "TJ");
    const usuario = userEvent.setup();
    render(<PantallaKilometraje sucursal={null} />);
    await screen.findByRole("option", { name: "Nissan-01 (ABC-123)" });
    await usuario.selectOptions(screen.getByLabelText("Vehículo"), "v1");
    await usuario.click(screen.getByRole("button", { name: "Mostrar" }));
    await screen.findByText("Total general");

    // Cambia los filtros SIN volver a consultar.
    await usuario.selectOptions(screen.getByLabelText("Vehículo"), "");
    await usuario.click(screen.getByRole("button", { name: "Exportar a Excel" }));

    expect(exportarExcel).toHaveBeenCalledTimes(1);
    const def = exportarExcel.mock.calls[0]?.[0];
    expect(def?.filtros).toEqual([
      ["Rango", "01/10/2026 a 13/10/2026"],
      ["Sucursal", "TJ"],
      ["Vehículo", "Nissan-01 (ABC-123)"],
    ]);
    expect(def?.nombreArchivo).toBe("kilometraje_2026-10-01_a_2026-10-13");
  });

  it("el encabezado explica el reporte; los atajos cambian el rango sin consultar", async () => {
    mockAuth(() => true);
    const usuario = userEvent.setup();
    render(<PantallaKilometraje sucursal={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Reporte de Kilometraje" })).toBeInTheDocument();
    expect(screen.getByText(/Un salto avisa/)).toBeInTheDocument();
    const ayer = diaAnterior(hoyEnTijuana());
    await usuario.click(screen.getByRole("button", { name: "Ayer" }));
    expect(screen.getByLabelText("Desde")).toHaveValue(ayer);
    expect(screen.getByLabelText("Hasta")).toHaveValue(ayer);
    expect(obtener).not.toHaveBeenCalled();
    await usuario.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(obtener).toHaveBeenCalledWith({ desde: ayer, hasta: ayer, vehiculoId: null, sucursal: null });
  });
});

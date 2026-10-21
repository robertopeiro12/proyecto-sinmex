import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as lib from "@/lib/produccion";
import type { DiaProduccion } from "@/lib/produccion";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaProduccionDia } from "./pantalla-produccion-dia";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/produccion", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/produccion")>();
  return { ...real, obtenerProduccion: vi.fn(), guardarProduccion: vi.fn() };
});

const HOY = hoyEnTijuana();
const DIA: DiaProduccion = {
  fecha: HOY,
  sucursal: { id: "s", codigo: "TJ" },
  lineas: [
    { presentacionId: "p1", producto: "Jamaica", presentacion: "1 L", activa: true, piezas: 40 },
    { presentacionId: "p2", producto: "Horchata", presentacion: "1 L", activa: true, piezas: 0 },
  ],
  totalPiezas: 40,
  actualizadoEn: null,
};

function mockAuth(permisos: string[], codigoSucursal: string | null = "TJ") {
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

const PERMISO = "almacen_general.gestionar";
const piezas = (nombre: string) => screen.getByLabelText(`Piezas de ${nombre}`);

describe("PantallaProduccionDia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lib.obtenerProduccion).mockResolvedValue(DIA);
    vi.mocked(lib.guardarProduccion).mockResolvedValue({ ...DIA, totalPiezas: 55 });
  });

  it("sin permiso dice que no hay permiso", () => {
    mockAuth([]);
    render(<PantallaProduccionDia sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(lib.obtenerProduccion).not.toHaveBeenCalled();
  });

  it("con todas las sucursales pide elegir una", () => {
    mockAuth([PERMISO], null);
    render(<PantallaProduccionDia sucursal={null} />);
    expect(screen.getByText(/Elige una sucursal/)).toBeInTheDocument();
    expect(lib.obtenerProduccion).not.toHaveBeenCalled();
  });

  it("un General con ?sucursal=tj carga esa sucursal", async () => {
    mockAuth([PERMISO], null);
    render(<PantallaProduccionDia sucursal="tj" />);
    await screen.findByRole("table", { name: "Producción del día" });
    expect(lib.obtenerProduccion).toHaveBeenCalledWith(HOY, "TJ");
  });

  it("carga hoy con una fila por presentación y el total", async () => {
    mockAuth([PERMISO]);
    render(<PantallaProduccionDia sucursal={null} />);
    await screen.findByRole("table", { name: "Producción del día" });
    expect(lib.obtenerProduccion).toHaveBeenCalledWith(HOY, "TJ");
    expect(piezas("Jamaica 1 L")).toHaveValue("40");
    expect(piezas("Horchata 1 L")).toHaveValue("");
    expect(within(screen.getByRole("row", { name: /Total/ })).getByText("40")).toBeInTheDocument();
  });

  it("escribir piezas actualiza el total", async () => {
    mockAuth([PERMISO]);
    render(<PantallaProduccionDia sucursal={null} />);
    await screen.findByRole("table", { name: "Producción del día" });
    await userEvent.type(piezas("Horchata 1 L"), "15");
    expect(within(screen.getByRole("row", { name: /Total/ })).getByText("55")).toBeInTheDocument();
  });

  it("Guardar manda todas las líneas y avisa", async () => {
    mockAuth([PERMISO]);
    render(<PantallaProduccionDia sucursal={null} />);
    await screen.findByRole("table", { name: "Producción del día" });
    await userEvent.type(piezas("Horchata 1 L"), "15");
    await userEvent.click(screen.getByRole("button", { name: "Guardar producción" }));
    expect(lib.guardarProduccion).toHaveBeenCalledWith({
      fecha: HOY,
      sucursal: "TJ",
      lineas: [
        { presentacionId: "p1", piezas: 40 },
        { presentacionId: "p2", piezas: 15 },
      ],
    });
    expect(await screen.findByText("Producción guardada.")).toBeInTheDocument();
  });

  it("la fecha no permite mañana", async () => {
    mockAuth([PERMISO]);
    render(<PantallaProduccionDia sucursal={null} />);
    await screen.findByRole("table", { name: "Producción del día" });
    expect((screen.getByLabelText("Fecha") as HTMLInputElement).max).toBe(HOY);
  });

  it("cambiar de fecha con cambios sin guardar pregunta; cancelar conserva la fecha", async () => {
    mockAuth([PERMISO]);
    render(<PantallaProduccionDia sucursal={null} />);
    await screen.findByRole("table", { name: "Producción del día" });
    await userEvent.type(piezas("Horchata 1 L"), "15");
    const fecha = screen.getByLabelText("Fecha") as HTMLInputElement;
    fireEvent.change(fecha, { target: { value: "2026-01-05" } });
    const ventana = await screen.findByRole("alertdialog");
    expect(within(ventana).getByText("¿Descartar los cambios?")).toBeInTheDocument();
    await userEvent.click(within(ventana).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(fecha.value).toBe(HOY);
    expect(piezas("Horchata 1 L")).toHaveValue("15");
    expect(lib.obtenerProduccion).toHaveBeenCalledTimes(1);

    // Confirmar sí cambia el día y recarga.
    fireEvent.change(fecha, { target: { value: "2026-01-05" } });
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(lib.obtenerProduccion).toHaveBeenCalledWith("2026-01-05", "TJ"));
  });

  it("cambiar de fecha sin cambios no pregunta", async () => {
    mockAuth([PERMISO]);
    render(<PantallaProduccionDia sucursal={null} />);
    await screen.findByRole("table", { name: "Producción del día" });
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-01-05" } });
    await waitFor(() => expect(lib.obtenerProduccion).toHaveBeenCalledWith("2026-01-05", "TJ"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("el error del servidor sale en un aviso con su mensaje", async () => {
    mockAuth([PERMISO]);
    vi.mocked(lib.guardarProduccion).mockRejectedValue(new ErrorApi("x", 400, "No se puede registrar producción de una fecha futura."));
    render(<PantallaProduccionDia sucursal={null} />);
    await screen.findByRole("table", { name: "Producción del día" });
    await userEvent.type(piezas("Horchata 1 L"), "15");
    await userEvent.click(screen.getByRole("button", { name: "Guardar producción" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se puede registrar producción de una fecha futura.");
  });
});

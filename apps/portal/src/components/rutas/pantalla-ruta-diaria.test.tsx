import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as rutasLib from "@/lib/rutas";
import type { ListaDelDia, RenglonDia } from "@/lib/rutas";
import { PantallaRutaDiaria } from "./pantalla-ruta-diaria";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/rutas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rutas")>();
  return { ...real, obtenerDia: vi.fn(), quitarRutaDiaria: vi.fn(), obtenerNotas: vi.fn() };
});
vi.mock("./ventana-notas", () => ({
  VentanaNotas: ({ vendedorNombre, cuales, editable, alCerrar }: { vendedorNombre: string; cuales: string; editable: boolean; alCerrar: () => void }) => (
    <div>
      <p>
        Notas {cuales} de {vendedorNombre} {editable ? "editable" : "solo lectura"}
      </p>
      <button onClick={alCerrar}>Cerrar notas</button>
    </div>
  ),
}));
vi.mock("./ruta-de-vendedor", () => ({
  RutaDeVendedor: ({
    vendedorId,
    fecha,
    onVolver,
  }: {
    vendedorId: string;
    fecha: string;
    onVolver: (guardada: boolean) => void;
  }) => (
    <div>
      <p>
        Ruta de {vendedorId} el {fecha}
      </p>
      <button onClick={() => onVolver(true)}>Simular guardar</button>
    </div>
  ),
}));

const HOY = "2026-11-10";

const renglon = (extra: Partial<RenglonDia>): RenglonDia => ({
  vendedorId: "v1",
  vendedor: "Ricardo López",
  sucursalCodigo: "TJ",
  rutaNombre: null,
  clientes: 0,
  notasPendientes: 0,
  notasAsignadas: 0,
  vehiculo: null,
  tieneRuta: false,
  ...extra,
});

const dia = (renglones: RenglonDia[], editable = true, fecha = HOY): ListaDelDia => ({ fecha, editable, renglones });

const CON_RUTA = renglon({
  vendedorId: "v2",
  vendedor: "Juan Pérez",
  rutaNombre: "RUTA 1 (OTAY)",
  clientes: 12,
  notasPendientes: 4,
  notasAsignadas: 2,
  vehiculo: "Nissan blanca",
  tieneRuta: true,
});

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede });
}

describe("PantallaRutaDiaria (lista del día)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Martes 10 de noviembre de 2026, 23:30 en Tijuana (ya es miércoles en UTC).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T07:30:00Z"));
    mockAuth(() => true);
    vi.mocked(rutasLib.obtenerDia).mockResolvedValue(dia([renglon({}), CON_RUTA]));
    vi.mocked(rutasLib.quitarRutaDiaria).mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sin permiso lo dice y no pide nada", () => {
    mockAuth(() => false);
    render(<PantallaRutaDiaria sucursal="TJ" />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(rutasLib.obtenerDia).not.toHaveBeenCalled();
  });

  it("sin sucursal elegida pide elegirla", () => {
    render(<PantallaRutaDiaria sucursal="todas" />);
    expect(screen.getByText(/Elige una sucursal/)).toBeInTheDocument();
    expect(rutasLib.obtenerDia).not.toHaveBeenCalled();
  });

  it("pide el día de hoy de Tijuana y pinta las columnas del sistema viejo", async () => {
    render(<PantallaRutaDiaria sucursal="tj" />);
    await screen.findByText("Juan Pérez");
    expect(rutasLib.obtenerDia).toHaveBeenCalledWith(HOY, "TJ");
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Vendedor",
      "Ruta asignada",
      "Clientes asignados",
      "Notas por cobrar",
      "Vehículo",
      "Acciones",
    ]);

    const [, sinRuta, conRuta] = screen.getAllByRole("row");
    expect(within(sinRuta).getByText("Sin ruta")).toBeInTheDocument();
    expect(within(sinRuta).getByText("Sin vehículo")).toBeInTheDocument();
    expect(within(sinRuta).getByRole("button", { name: "Asignar ruta" })).toBeInTheDocument();
    expect(within(sinRuta).queryByRole("button", { name: /Quitar/ })).toBeNull();
    expect(within(sinRuta).getByText("Asigna primero su ruta")).toBeInTheDocument();

    expect(conRuta).toHaveTextContent("RUTA 1 (OTAY)");
    expect(conRuta).toHaveTextContent("Nissan blanca");
    const celdas = within(conRuta).getAllByRole("cell");
    expect(celdas[2]).toHaveTextContent("12");
    expect(celdas[3]).toHaveTextContent("2 de 4 asignadas");
    expect(within(celdas[3]).getByRole("button", { name: "Asignar" })).toBeInTheDocument();
    // Acciones: Editar y Quitar; "Asignar notas" ya vive en la columna de notas.
    expect(within(celdas[5]).getAllByRole("button").map((b) => b.textContent)).toEqual(["Editar", "Quitar"]);
    expect(within(conRuta).getByRole("button", { name: "Quitar ruta de Juan Pérez" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Asignar notas" })).toBeNull();
    expect(within(conRuta).queryByRole("button", { name: "Asignar ruta" })).toBeNull();
  });

  it("un día pasado no muestra acciones de cambio", async () => {
    vi.mocked(rutasLib.obtenerDia).mockResolvedValue(dia([renglon({}), CON_RUTA], false, "2026-11-09"));
    render(<PantallaRutaDiaria sucursal="TJ" />);
    await screen.findByText("Juan Pérez");
    expect(screen.queryByRole("button", { name: "Asignar ruta" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Quitar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Asignar" })).toBeNull();
    expect(screen.getByText(/Ese día ya pasó/)).toBeInTheDocument();
  });

  it("Asignar ruta abre la ruta del vendedor y al volver relee la lista sin recargar", async () => {
    const usuario = userEvent.setup();
    render(<PantallaRutaDiaria sucursal="TJ" />);
    const [, sinRuta] = await screen.findAllByRole("row");

    await usuario.click(within(sinRuta).getByRole("button", { name: "Asignar ruta" }));
    expect(screen.getByText(`Ruta de v1 el ${HOY}`)).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Simular guardar" }));
    expect(await screen.findByText("Juan Pérez")).toBeInTheDocument();
    expect(rutasLib.obtenerDia).toHaveBeenCalledTimes(2);
  });

  it("Quitar ruta pregunta, quita y relee la lista", async () => {
    const usuario = userEvent.setup();
    render(<PantallaRutaDiaria sucursal="TJ" />);
    const filas = await screen.findAllByRole("row");

    await usuario.click(within(filas[2]).getByRole("button", { name: "Quitar ruta de Juan Pérez" }));
    expect(await screen.findByText("¿Quitar la ruta de Juan Pérez?")).toBeInTheDocument();
    expect(rutasLib.quitarRutaDiaria).not.toHaveBeenCalled();

    await usuario.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Quitar ruta" }));
    expect(rutasLib.quitarRutaDiaria).toHaveBeenCalledWith("v2", HOY);
    await vi.waitFor(() => expect(rutasLib.obtenerDia).toHaveBeenCalledTimes(2));
  });

  it("Asignar (en Notas por cobrar) abre la ventana editable y al cerrar relee los conteos", async () => {
    const usuario = userEvent.setup();
    render(<PantallaRutaDiaria sucursal="TJ" />);
    const filas = await screen.findAllByRole("row");
    await usuario.click(within(filas[2]).getByRole("button", { name: "Asignar" }));
    expect(screen.getByText("Notas pendientes de Juan Pérez editable")).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Cerrar notas" }));
    await vi.waitFor(() => expect(rutasLib.obtenerDia).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Notas pendientes de/)).toBeNull();
  });

  it("Asignar es primario si aún no tiene asignadas y outline si ya tiene; sin notas lo dice", async () => {
    vi.mocked(rutasLib.obtenerDia).mockResolvedValue(
      dia([
        renglon({ vendedorId: "a", vendedor: "Ana", tieneRuta: true, notasPendientes: 3 }),
        CON_RUTA,
        renglon({ vendedorId: "c", vendedor: "Cris", tieneRuta: true }),
      ]),
    );
    render(<PantallaRutaDiaria sucursal="TJ" />);
    const [, ana, juan, cris] = await screen.findAllByRole("row");
    expect(within(ana).getByRole("button", { name: "Asignar" }).className).toContain("bg-primary");
    expect(within(juan).getByRole("button", { name: "Asignar" }).className).not.toContain("bg-primary");
    expect(cris).toHaveTextContent("Sin notas por cobrar");
    expect(within(cris).queryByRole("button", { name: "Asignar" })).toBeNull();
  });

  it("un día pasado: 'N de M asignadas' y Ver abre la ventana en solo lectura", async () => {
    const usuario = userEvent.setup();
    vi.mocked(rutasLib.obtenerDia).mockResolvedValue(dia([CON_RUTA], false, "2026-11-09"));
    render(<PantallaRutaDiaria sucursal="TJ" />);
    const [, juan] = await screen.findAllByRole("row");
    const notas = within(juan).getAllByRole("cell")[3];
    expect(notas).toHaveTextContent("2 de 4 asignadas");
    await usuario.click(within(notas).getByRole("button", { name: "Ver" }));
    expect(screen.getByText("Notas pendientes de Juan Pérez solo lectura")).toBeInTheDocument();
  });

  it("sin ruta semanal pero con clientes dice 'Sin ruta · N clientes'", async () => {
    vi.mocked(rutasLib.obtenerDia).mockResolvedValue(
      dia([
        renglon({ vendedorId: "a", vendedor: "Ana", clientes: 3, tieneRuta: true }),
        renglon({ vendedorId: "b", vendedor: "Beto", clientes: 1, tieneRuta: true }),
        renglon({ vendedorId: "c", vendedor: "Cris" }),
      ]),
    );
    render(<PantallaRutaDiaria sucursal="TJ" />);
    await screen.findByText("Ana");
    const [, ana, beto, cris] = screen.getAllByRole("row");
    expect(within(ana).getByText("Sin ruta · 3 clientes")).toBeInTheDocument();
    expect(within(beto).getByText("Sin ruta · 1 cliente")).toBeInTheDocument();
    expect(within(cris).getByText("Sin ruta")).toBeInTheDocument();
  });
});

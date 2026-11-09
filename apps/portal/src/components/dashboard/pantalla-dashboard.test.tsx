import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as fd from "@/lib/flujo-diario";
import type { Dashboard, DetalleVendedorDia, ResumenVendedorDia, Totales } from "@/lib/flujo-diario";
import * as sucursalesLib from "@/lib/sucursales";
import { PantallaDashboard } from "./pantalla-dashboard";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/flujo-diario", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/flujo-diario")>();
  return { ...real, obtenerDashboard: vi.fn(), obtenerDetalleDashboard: vi.fn(), guardarNotasEntregadas: vi.fn() };
});
vi.mock("@/lib/sucursales", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/sucursales")>();
  return { ...real, listarSucursales: vi.fn() };
});

const obtenerDashboard = vi.mocked(fd.obtenerDashboard);
const obtenerDetalle = vi.mocked(fd.obtenerDetalleDashboard);
const guardarNotasEntregadas = vi.mocked(fd.guardarNotasEntregadas);
const listarSucursales = vi.mocked(sucursalesLib.listarSucursales);

function fila(p: Partial<ResumenVendedorDia>): ResumenVendedorDia {
  return {
    fecha: "2026-11-09", vendedorId: "v", vendedor: "V", sucursalCodigo: "TJ",
    clientesEnRuta: 16, atendidosEnRuta: 6, piezas: 402, montoCentavos: 400000,
    contadoCentavos: 134000, anterioresCentavos: 0, aFavorCentavos: 0, gastoCentavos: 0,
    jornadaCerrada: false, vehiculo: null, cobranzaCentavos: 134000, tesoreriaCentavos: 134000,
    estatus: "en_ruta", ...p,
  };
}

const RICARDO = fila({ vendedorId: "ricardo", vendedor: "Ricardo", vehiculo: "BK-4537A" });
const RBLAS = fila({
  vendedorId: "rblas", vendedor: "RBlas", clientesEnRuta: 15, atendidosEnRuta: 15, piezas: 675,
  cobranzaCentavos: 279650, gastoCentavos: 1000, tesoreriaCentavos: 278650, jornadaCerrada: true, estatus: "terminado",
});
const LUIS = fila({ vendedorId: "luis", vendedor: "Luis", sucursalCodigo: "MX", piezas: 50 });

const TOT: Totales = {
  rutas: 2, piezas: 1077, montoCentavos: 800000, cobranzaCentavos: 413650, gastoCentavos: 1000,
  tesoreriaCentavos: 412650, clientesEnRuta: 31, atendidosEnRuta: 21,
};

const TIJUANA: Dashboard = {
  fecha: "2026-11-09",
  vendedores: [RICARDO, RBLAS],
  bloques: [{ sucursalCodigo: "TJ", totales: TOT, enRuta: 1, terminaron: 1 }],
  total: { ...TOT, enRuta: 1, terminaron: 1 },
};

const TOT_MX: Totales = { ...TOT, rutas: 1, piezas: 50 };
const TODAS: Dashboard = {
  fecha: "2026-11-09",
  vendedores: [LUIS, RICARDO, RBLAS],
  bloques: [
    { sucursalCodigo: "MX", totales: TOT_MX, enRuta: 1, terminaron: 0 },
    { sucursalCodigo: "TJ", totales: TOT, enRuta: 1, terminaron: 1 },
  ],
  total: { ...TOT, rutas: 3, piezas: 1127, enRuta: 2, terminaron: 1 },
};

const DETALLE: DetalleVendedorDia = {
  fecha: "2026-11-09", vendedorId: "rblas", vendedor: "RBlas",
  porProducto: [], notas: [],
  cobranza: { contado: [], anteriores: [], aFavor: [] },
  gastos: [], notasCredito: [], notasNoEntregadas: [], visitas: [], promociones: [],
  corte: { contadoCentavos: 279650, anterioresCentavos: 0, aFavorCentavos: 0, gastoCentavos: 1000, tesoreriaCentavos: 278650 },
};

function mockAuth(permisos: string[]) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: { id: "u1", login: "ana", nombre: "Ana", perfil: "Administrador General", sucursal: null, permisos },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (clave: string) => permisos.includes(clave),
  });
}

let visibilidad: DocumentVisibilityState = "visible";
function cambiarVisibilidad(v: DocumentVisibilityState) {
  visibilidad = v;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

async function avanzar(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

const PERMISO = "dashboard.ver";

describe("PantallaDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Solo el reloj y los intervalos: `findBy` sigue esperando con el setTimeout real.
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-11-09T18:00:00Z"));
    visibilidad = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidad });
    obtenerDashboard.mockResolvedValue(TIJUANA);
    obtenerDetalle.mockResolvedValue(DETALLE);
    listarSucursales.mockResolvedValue([
      { id: "1", codigo: "TJ", nombre: "Tijuana", activa: true, controlInventario: false },
      { id: "2", codigo: "MX", nombre: "Mexicali", activa: true, controlInventario: false },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sin permiso dashboard.ver lo dice y no pide nada", () => {
    mockAuth(["reporte_ventas.ver"]);
    render(<PantallaDashboard sucursal="TJ" />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(obtenerDashboard).not.toHaveBeenCalled();
  });

  it("título, descripción y la fecha del servidor en español", async () => {
    mockAuth([PERMISO]);
    render(<PantallaDashboard sucursal="TJ" />);
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(
      screen.getByText("Lo que llevan hoy los vendedores en ruta. Pica un vendedor o un número para ver el detalle."),
    ).toBeInTheDocument();
    expect(await screen.findByText("Hoy, lunes 9 de noviembre · se actualiza solo · hace un momento")).toBeInTheDocument();
    expect(obtenerDashboard).toHaveBeenCalledWith("TJ");
  });

  it("pide al entrar y otra vez a los 60 s; con la pestaña oculta no pide, y al volver pide de inmediato", async () => {
    mockAuth([PERMISO]);
    render(<PantallaDashboard sucursal="TJ" />);
    await screen.findByRole("button", { name: "RBlas" });
    expect(obtenerDashboard).toHaveBeenCalledTimes(1);
    await avanzar(59_000);
    expect(obtenerDashboard).toHaveBeenCalledTimes(1);
    await avanzar(1_000);
    expect(obtenerDashboard).toHaveBeenCalledTimes(2);

    cambiarVisibilidad("hidden");
    await avanzar(120_000);
    expect(obtenerDashboard).toHaveBeenCalledTimes(2);
    // Lo último que llegó fue hace 2 minutos.
    expect(screen.getByText("Hoy, lunes 9 de noviembre · se actualiza solo · hace 2 min")).toBeInTheDocument();

    cambiarVisibilidad("visible");
    expect(obtenerDashboard).toHaveBeenCalledTimes(3);
    expect(await screen.findByText(/hace un momento$/)).toBeInTheDocument();
  });

  it("deja de consultar al salir de la pantalla", async () => {
    mockAuth([PERMISO]);
    const { unmount } = render(<PantallaDashboard sucursal="TJ" />);
    await screen.findByRole("button", { name: "RBlas" });
    unmount();
    await avanzar(180_000);
    cambiarVisibilidad("visible");
    expect(obtenerDashboard).toHaveBeenCalledTimes(1);
  });

  it("con el detalle de RBlas abierto en Cobranza, la actualización lo deja abierto en Cobranza y lo vuelve a pedir", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PantallaDashboard sucursal="TJ" />);
    await u.click(await screen.findByRole("button", { name: "RBlas" }));
    expect(obtenerDetalle).toHaveBeenCalledWith({ vendedor: "rblas", sucursal: "TJ", fecha: "2026-11-09" });
    const ventana = await screen.findByRole("dialog", { name: "Venta general · RBlas · 09/11/2026" });
    await u.click(await within(ventana).findByRole("tab", { name: "Cobranza" }));
    expect(within(ventana).getByRole("tab", { name: "Cobranza" })).toHaveAttribute("aria-selected", "true");

    await avanzar(60_000);
    expect(obtenerDashboard).toHaveBeenCalledTimes(2);
    expect(obtenerDetalle).toHaveBeenCalledTimes(2);
    // La ventana sigue abierta, en Cobranza, sin "Cargando…" mientras llega.
    const sigue = screen.getByRole("dialog", { name: "Cobranza · RBlas · 09/11/2026" });
    expect(await within(sigue).findByRole("tab", { name: "Cobranza" })).toHaveAttribute("aria-selected", "true");
    expect(within(sigue).queryByText("Cargando…")).not.toBeInTheDocument();
  });

  it("cerrar la ventana con casillas sin guardar pregunta antes; sin cambios cierra directo", async () => {
    mockAuth([PERMISO, "nota_papel.revisar"]);
    const conNota: DetalleVendedorDia = {
      ...DETALLE,
      notasCredito: [{ folio: "TJ261109RB10", cliente: "Don Gallo", totalCentavos: 92000, pendienteCentavos: 92000, entregada: null }],
    };
    obtenerDetalle.mockResolvedValue(conNota);
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PantallaDashboard sucursal="TJ" />);
    await u.click(await screen.findByRole("button", { name: "RBlas" }));
    await u.click(await screen.findByRole("tab", { name: "Notas de ventas" }));
    await u.click(screen.getByRole("checkbox", { name: "Entregada TJ261109RB10" }));
    await u.click(screen.getByRole("button", { name: "Cerrar" }));
    // Pregunta; "Cancelar" deja la ventana abierta con la casilla como estaba.
    const pregunta = await screen.findByRole("alertdialog", { name: "¿Cerrar sin guardar la revisión?" });
    await u.click(within(pregunta).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("checkbox", { name: "Entregada TJ261109RB10" })).toBeChecked();
    // "Cerrar sin guardar" sí la cierra.
    await u.click(screen.getByRole("button", { name: "Cerrar" }));
    await u.click(await screen.findByRole("button", { name: "Cerrar sin guardar" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: /Notas de ventas · RBlas/ })).not.toBeInTheDocument());
    // Sin cambios: cierra sin preguntar.
    await u.click(screen.getByRole("button", { name: "RBlas" }));
    await screen.findByRole("dialog", { name: /RBlas/ });
    await u.click(screen.getByRole("button", { name: "Cerrar" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: /RBlas/ })).not.toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("guardar la revisión de notas de papel vuelve a pedir el detalle abierto, sin cerrarlo", async () => {
    mockAuth([PERMISO, "nota_papel.revisar"]);
    const conNota: DetalleVendedorDia = {
      ...DETALLE,
      notasCredito: [{ folio: "TJ261109RB10", cliente: "Don Gallo", totalCentavos: 92000, pendienteCentavos: 92000, entregada: null }],
    };
    obtenerDetalle.mockResolvedValue(conNota);
    guardarNotasEntregadas.mockResolvedValue(undefined);
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PantallaDashboard sucursal="TJ" />);
    await u.click(await screen.findByRole("button", { name: "RBlas" }));
    await u.click(await screen.findByRole("tab", { name: "Notas de ventas" }));
    await u.click(screen.getByRole("checkbox", { name: "Entregada TJ261109RB10" }));
    await u.click(screen.getByRole("button", { name: "Guardar revisión" }));
    expect(guardarNotasEntregadas).toHaveBeenCalledWith({
      vendedor: "rblas",
      notas: [{ folio: "TJ261109RB10", entregada: true }],
    });
    await vi.waitFor(() => expect(obtenerDetalle).toHaveBeenCalledTimes(2));
    const ventana = screen.getByRole("dialog", { name: "Notas de ventas · RBlas · 09/11/2026" });
    expect(within(ventana).getByRole("tab", { name: "Notas de ventas" })).toHaveAttribute("aria-selected", "true");
  });

  it("Estatus En ruta / Terminó; Corte «Ver» solo del que terminó y abre la pestaña Corte", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PantallaDashboard sucursal="TJ" />);
    const tabla = await screen.findByRole("table", { name: "Vendedores de hoy" });
    const ricardo = within(tabla).getByRole("button", { name: "Ricardo" }).closest("tr")!;
    const rblas = within(tabla).getByRole("button", { name: "RBlas" }).closest("tr")!;

    expect(within(ricardo).getByText("En ruta")).toHaveAttribute("data-tono", "informacion");
    expect(within(rblas).getByText("Terminó")).toHaveAttribute("data-tono", "exito");
    expect(within(ricardo).queryByRole("button", { name: "Corte de Ricardo" })).not.toBeInTheDocument();
    const celdas = within(ricardo).getAllByRole("cell");
    expect(celdas[celdas.length - 1]).toHaveTextContent("—");

    // Vehículo, ruta asignada, ruta x / y y "—" en Notas ant. asignadas.
    expect(within(ricardo).getByText("BK-4537A")).toBeInTheDocument();
    expect(within(ricardo).getByText("Ruta del día · 16 clientes")).toBeInTheDocument();
    expect(within(ricardo).getByText("6 / 16")).toBeInTheDocument();
    expect(within(ricardo).getByText("Pronto")).toBeInTheDocument();
    expect(celdas[9]).toHaveTextContent("—");
    // Sin vehículo en su jornada: "—".
    expect(within(rblas).getAllByRole("cell")[2]).toHaveTextContent("—");

    await u.click(within(rblas).getByRole("button", { name: "Corte de RBlas" }));
    await screen.findByRole("dialog", { name: "Corte · RBlas · 09/11/2026" });
    expect(await screen.findByRole("tab", { name: "Corte" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("table", { name: "Corte" })).toBeInTheDocument();
  });

  it("picar la Ruta x / y abre la pestaña Ruta (las visitas), como el viejo", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PantallaDashboard sucursal="TJ" />);
    const tabla = await screen.findByRole("table", { name: "Vendedores de hoy" });
    await u.click(within(tabla).getByRole("button", { name: "Ruta de Ricardo: 6 / 16" }));
    await screen.findByRole("dialog", { name: "Ruta · Ricardo · 09/11/2026" });
    expect(await screen.findByRole("tab", { name: "Ruta" })).toHaveAttribute("aria-selected", "true");
  });

  it("el resumen dice cuántos vendedores en ruta y cuántos terminaron", async () => {
    mockAuth([PERMISO]);
    render(<PantallaDashboard sucursal="TJ" />);
    expect(await screen.findByText("1 en ruta · 1 terminó")).toBeInTheDocument();
    expect(screen.getByText("1,077 pzs")).toBeInTheDocument();
  });

  it("sin vendedores: No hay vendedores en ruta hoy.", async () => {
    mockAuth([PERMISO]);
    obtenerDashboard.mockResolvedValue({
      fecha: "2026-11-09", vendedores: [], bloques: [],
      total: { ...TOT, rutas: 0, piezas: 0, enRuta: 0, terminaron: 0 },
    });
    render(<PantallaDashboard sucursal="TJ" />);
    const aviso = await screen.findByText("No hay vendedores en ruta hoy.");
    expect(aviso.closest("[data-tono]")).toHaveAttribute("data-tono", "informacion");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("con Todas: un resumen por sucursal y uno total, y la tabla en bloques", async () => {
    mockAuth([PERMISO]);
    obtenerDashboard.mockResolvedValue(TODAS);
    render(<PantallaDashboard sucursal={null} />);
    const tabla = await screen.findByRole("table", { name: "Vendedores de hoy" });
    expect(await within(tabla).findByRole("rowheader", { name: "Mexicali" })).toBeInTheDocument();
    expect(within(tabla).getByRole("rowheader", { name: "Tijuana" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Resumen de Mexicali" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Resumen de Tijuana" })).toBeInTheDocument();
    const total = screen.getByRole("region", { name: "Resumen total" });
    expect(within(total).getByText("1,127 pzs")).toBeInTheDocument();
    expect(within(total).getByText("2 en ruta · 1 terminó")).toBeInTheDocument();
  });

  it("una consulta lenta no pisa a una más nueva", async () => {
    mockAuth([PERMISO]);
    let soltarVieja: (d: Dashboard) => void = () => {};
    obtenerDashboard
      .mockResolvedValueOnce(TIJUANA)
      .mockImplementationOnce(() => new Promise((r) => { soltarVieja = r; }))
      .mockResolvedValueOnce({ ...TIJUANA, vendedores: [RICARDO] });
    render(<PantallaDashboard sucursal="TJ" />);
    await screen.findByRole("button", { name: "RBlas" });
    await avanzar(60_000); // la lenta
    cambiarVisibilidad("hidden");
    cambiarVisibilidad("visible"); // la nueva, que llega primero
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "RBlas" })).not.toBeInTheDocument();
    await act(async () => { soltarVieja(TIJUANA); });
    expect(screen.queryByRole("button", { name: "RBlas" })).not.toBeInTheDocument();
  });
});

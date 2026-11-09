import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as fd from "@/lib/flujo-diario";
import type { DetalleVendedorDia, FlujoDiario, ResumenVendedorDia, Totales } from "@/lib/flujo-diario";
import * as sucursalesLib from "@/lib/sucursales";
import * as vendedoresLib from "@/lib/vendedores";
import { PantallaFlujoDiario } from "./pantalla-flujo-diario";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/flujo-diario", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/flujo-diario")>();
  return { ...real, obtenerFlujoDiario: vi.fn(), obtenerDetalleVendedor: vi.fn(), obtenerDetalleDia: vi.fn() };
});
vi.mock("@/lib/vendedores", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/vendedores")>();
  return { ...real, listarVendedores: vi.fn() };
});
vi.mock("@/lib/sucursales", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/sucursales")>();
  return { ...real, listarSucursales: vi.fn() };
});

const obtenerFlujo = vi.mocked(fd.obtenerFlujoDiario);
const obtenerDetalle = vi.mocked(fd.obtenerDetalleVendedor);
const obtenerDetalleDia = vi.mocked(fd.obtenerDetalleDia);
const listarVendedores = vi.mocked(vendedoresLib.listarVendedores);
const listarSucursales = vi.mocked(sucursalesLib.listarSucursales);

const CEROS: Totales = {
  rutas: 0, piezas: 0, montoCentavos: 0, cobranzaCentavos: 0, gastoCentavos: 0,
  tesoreriaCentavos: 0, clientesEnRuta: 0, atendidosEnRuta: 0,
};

function fila(p: Partial<ResumenVendedorDia>): ResumenVendedorDia {
  return {
    fecha: "2026-11-09", vendedorId: "v", vendedor: "V", sucursalCodigo: "TJ",
    clientesEnRuta: 10, atendidosEnRuta: 4, piezas: 100, montoCentavos: 120000,
    contadoCentavos: 30000, anterioresCentavos: 20000, aFavorCentavos: 0, gastoCentavos: 1000,
    jornadaCerrada: true, vehiculo: null, cobranzaCentavos: 50000, tesoreriaCentavos: 49000,
    estatus: "terminado", ...p,
  };
}

const RICARDO = fila({ vendedorId: "ricardo", vendedor: "Ricardo", sucursalCodigo: "TJ" });
const LUIS = fila({ vendedorId: "luis", vendedor: "Luis", sucursalCodigo: "MX", piezas: 50 });

const TOT_TJ: Totales = { ...CEROS, rutas: 1, piezas: 100, montoCentavos: 120000, cobranzaCentavos: 50000, gastoCentavos: 1000, tesoreriaCentavos: 49000, clientesEnRuta: 10, atendidosEnRuta: 4 };
const TOT_MX: Totales = { ...TOT_TJ, piezas: 50 };
const TOT: Totales = { ...TOT_TJ, rutas: 2, piezas: 150, montoCentavos: 240000, cobranzaCentavos: 100000, gastoCentavos: 2000, tesoreriaCentavos: 98000, clientesEnRuta: 20, atendidosEnRuta: 8 };

const DOS_SUCURSALES: FlujoDiario = {
  desde: "2026-11-09",
  hasta: "2026-11-09",
  porVendedor: [RICARDO, LUIS],
  porDia: [
    { fecha: "2026-11-09", sucursalCodigo: "TJ", totales: TOT_TJ, oficinaCentavos: 0 },
    { fecha: "2026-11-09", sucursalCodigo: "MX", totales: TOT_MX, oficinaCentavos: 0 },
  ],
  bloques: [
    { sucursalCodigo: "MX", porVendedor: TOT_MX, porDia: TOT_MX },
    { sucursalCodigo: "TJ", porVendedor: TOT_TJ, porDia: TOT_TJ },
  ],
  totalPorVendedor: TOT,
  totalPorDia: TOT,
};

const UNA_SUCURSAL: FlujoDiario = {
  ...DOS_SUCURSALES,
  porVendedor: [RICARDO],
  porDia: [DOS_SUCURSALES.porDia[0]],
  bloques: [DOS_SUCURSALES.bloques[1]],
  totalPorVendedor: TOT_TJ,
  totalPorDia: TOT_TJ,
};

const DETALLE: DetalleVendedorDia = {
  fecha: "2026-11-09", vendedorId: "ricardo", vendedor: "Ricardo",
  porProducto: [{ presentacion: "500 ml", producto: "Horchata 500 ml", piezas: 100 }],
  notas: [],
  cobranza: { contado: [], anteriores: [], aFavor: [] },
  gastos: [], notasCredito: [], notasNoEntregadas: [], visitas: [], promociones: [], corte: null,
};

function mockAuth(permisos: string[]) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: { id: "u1", login: "ana", nombre: "Ana", perfil: "Administrador General", sucursal: null, permisos },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (clave: string) => permisos.includes(clave),
  });
}

const PERMISO = "reporte_ventas.ver";

describe("PantallaFlujoDiario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 07:30 UTC del 10 = 23:30 del 9 en Tijuana (PST): hoy es el 9 y "ayer" el 8. Con UTC saldría el 9 (el error).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T07:30:00Z"));
    obtenerFlujo.mockResolvedValue(UNA_SUCURSAL);
    obtenerDetalle.mockResolvedValue(DETALLE);
    listarVendedores.mockResolvedValue([]);
    listarSucursales.mockResolvedValue([
      { id: "1", codigo: "TJ", nombre: "Tijuana", activa: true, controlInventario: false },
      { id: "2", codigo: "MX", nombre: "Mexicali", activa: true, controlInventario: false },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sin permiso lo dice y no pide nada", () => {
    mockAuth([]);
    render(<PantallaFlujoDiario sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(obtenerFlujo).not.toHaveBeenCalled();
  });

  it("abre en el día anterior de Tijuana y consulta sola; sin Excel", async () => {
    mockAuth([PERMISO]);
    render(<PantallaFlujoDiario sucursal="TJ" />);
    expect(screen.getByRole("heading", { level: 1, name: "Flujo diario" })).toBeInTheDocument();
    expect(
      screen.getByText("Qué hizo cada vendedor en días pasados. Pica un vendedor o un número para ver el detalle."),
    ).toBeInTheDocument();
    expect(obtenerFlujo).toHaveBeenCalledWith({ desde: "2026-11-08", hasta: "2026-11-08", sucursal: "TJ", vendedor: null });
    expect(screen.getByLabelText("Desde")).toHaveValue("2026-11-08");
    expect(screen.getByLabelText("Hasta")).toHaveValue("2026-11-08");
    expect(screen.queryByRole("button", { name: "Exportar a Excel" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Ricardo" })).toBeInTheDocument();
  });

  it("con TJ y MX: un bloque por sucursal con su nombre y un Total", async () => {
    mockAuth([PERMISO]);
    obtenerFlujo.mockResolvedValue(DOS_SUCURSALES);
    render(<PantallaFlujoDiario sucursal={null} />);
    const tabla = await screen.findByRole("table", { name: "Por vendedor" });
    expect(await within(tabla).findByRole("rowheader", { name: "Tijuana" })).toBeInTheDocument();
    expect(within(tabla).getByRole("rowheader", { name: "Mexicali" })).toBeInTheDocument();
    const total = within(tabla).getByText(/^Total · 2 rutas$/).closest("tr")!;
    expect(within(total).getByText("150")).toBeInTheDocument();
  });

  it("picar Ricardo pide su detalle con la fecha y sucursal del renglón y abre Venta general", async () => {
    mockAuth([PERMISO]);
    obtenerFlujo.mockResolvedValue(DOS_SUCURSALES);
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PantallaFlujoDiario sucursal={null} />);
    await u.click(await screen.findByRole("button", { name: "Ricardo" }));
    expect(obtenerDetalle).toHaveBeenCalledWith({ fecha: "2026-11-09", vendedor: "ricardo", sucursal: "TJ" });
    expect(await screen.findByRole("tab", { name: "Venta general" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "Corte" })).not.toBeInTheDocument();
    // Picar otra vez lo cierra.
    await u.click(screen.getByRole("button", { name: "Ricardo" }));
    expect(screen.queryByRole("tab", { name: "Venta general" })).not.toBeInTheDocument();
  });

  it("la cobranza de arriba dice de quién es, sin avisos sueltos bajo la tabla", async () => {
    mockAuth([PERMISO]);
    render(<PantallaFlujoDiario sucursal="TJ" />);
    await screen.findByRole("table", { name: "Por vendedor" });
    const cobranza = screen.getByText("Cobranza", { selector: "dt" });
    expect(cobranza.parentElement).toHaveTextContent("Solo lo que cobraron los vendedores");
    expect(screen.queryByText(/«Por día» suma también/)).not.toBeInTheDocument();
  });

  it("picar la Cobranza del renglón abre esa pestaña; mientras llega dice Cargando… en el renglón", async () => {
    mockAuth([PERMISO]);
    let soltar: (d: DetalleVendedorDia) => void = () => {};
    obtenerDetalle.mockImplementationOnce(() => new Promise((r) => { soltar = r; }));
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PantallaFlujoDiario sucursal="TJ" />);
    await u.click(await screen.findByRole("button", { name: "Cobranza de Ricardo" }));
    const tabla = screen.getByRole("table", { name: "Por vendedor" });
    expect(within(tabla).getByText("Cargando…")).toBeInTheDocument();
    await act(async () => { soltar(DETALLE); });
    expect(screen.getByRole("tab", { name: "Cobranza" })).toHaveAttribute("aria-selected", "true");
  });

  it("picar un número abre su pestaña aunque se haya cambiado de pestaña dentro del detalle", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PantallaFlujoDiario sucursal="TJ" />);
    await u.click(await screen.findByRole("button", { name: "Cobranza de Ricardo" }));
    expect(await screen.findByRole("tab", { name: "Cobranza" })).toHaveAttribute("aria-selected", "true");
    await u.click(screen.getByRole("tab", { name: "Gastos" }));
    expect(screen.getByRole("tab", { name: "Gastos" })).toHaveAttribute("aria-selected", "true");
    // Antes el renglón recordaba "Cobranza" y este clic cerraba el detalle.
    await u.click(screen.getByRole("button", { name: "Cobranza de Ricardo" }));
    expect(screen.getByRole("tab", { name: "Cobranza" })).toHaveAttribute("aria-selected", "true");
    // Y ahora sí, otra vez el mismo número lo cierra.
    await u.click(screen.getByRole("button", { name: "Cobranza de Ricardo" }));
    expect(screen.queryByRole("tab", { name: "Cobranza" })).not.toBeInTheDocument();
    expect(obtenerDetalle).toHaveBeenCalledTimes(1);
  });

  it("Por día: picar la fecha pide el detalle de ese día y sucursal", async () => {
    mockAuth([PERMISO]);
    obtenerFlujo.mockResolvedValue(DOS_SUCURSALES);
    obtenerDetalleDia.mockResolvedValue({
      fecha: "2026-11-09", sucursalCodigo: "MX", porPresentacion: [], porProducto: [], porVendedor: [], porCliente: [],
      cobranza: [], aFavor: [], gastos: [], visitas: [], promociones: [],
    });
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PantallaFlujoDiario sucursal={null} />);
    await screen.findByRole("table", { name: "Por vendedor" });
    await u.click(screen.getByRole("tab", { name: "Por día" }));
    const tabla = screen.getByRole("table", { name: "Por día" });
    const botones = within(tabla).getAllByRole("button", { name: "09/11/2026" });
    await u.click(botones[1]);
    expect(obtenerDetalleDia).toHaveBeenCalledWith({ fecha: "2026-11-09", sucursal: "MX", vendedor: null });
    await u.click(await screen.findByRole("tab", { name: "Mermas" }));
    expect(screen.getByText("Todavía no se registran mermas en el sistema.")).toBeInTheDocument();
  });

  it("Por día es de toda la sucursal: sin selector de vendedor y su consulta ignora al vendedor elegido", async () => {
    mockAuth([PERMISO]);
    listarVendedores.mockResolvedValue([
      { id: "ricardo", nombre: "Ricardo", login: "ricardo", sucursalId: "1", sucursalCodigo: "TJ", folioSegmento: "RI", activo: true },
    ]);
    obtenerDetalleDia.mockResolvedValue({
      fecha: "2026-11-09", sucursalCodigo: "TJ", porPresentacion: [], porProducto: [], porVendedor: [], porCliente: [],
      cobranza: [], aFavor: [], gastos: [], visitas: [], promociones: [],
    });
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PantallaFlujoDiario sucursal="TJ" />);
    await screen.findByRole("option", { name: "Ricardo" });
    await u.selectOptions(screen.getByLabelText("Vendedor"), "ricardo");
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    // Por vendedor con el filtro, y Por día siempre de todos.
    expect(obtenerFlujo).toHaveBeenCalledWith({ desde: "2026-11-08", hasta: "2026-11-08", sucursal: "TJ", vendedor: "ricardo" });
    expect(obtenerFlujo).toHaveBeenLastCalledWith({ desde: "2026-11-08", hasta: "2026-11-08", sucursal: "TJ", vendedor: null });
    await screen.findByRole("table", { name: "Por vendedor" });
    await u.click(screen.getByRole("tab", { name: "Por día" }));
    expect(screen.queryByLabelText("Vendedor")).not.toBeInTheDocument();
    const tabla = screen.getByRole("table", { name: "Por día" });
    await u.click(within(tabla).getByRole("button", { name: "09/11/2026" }));
    expect(obtenerDetalleDia).toHaveBeenCalledWith({ fecha: "2026-11-09", sucursal: "TJ", vendedor: null });
    await u.click(screen.getByRole("tab", { name: "Por vendedor" }));
    expect(screen.getByLabelText("Vendedor")).toHaveValue("ricardo");
  });

  it("las cifras de arriba siguen a la pestaña; en Por día la cobranza se desglosa en vendedores y oficina", async () => {
    mockAuth([PERMISO]);
    const CON_OFICINA: FlujoDiario = {
      ...UNA_SUCURSAL,
      porDia: [{ ...UNA_SUCURSAL.porDia[0], totales: { ...TOT_TJ, cobranzaCentavos: 54000 }, oficinaCentavos: 4000 }],
      totalPorDia: { ...TOT_TJ, cobranzaCentavos: 54000, tesoreriaCentavos: 53000 },
    };
    obtenerFlujo.mockResolvedValue(CON_OFICINA);
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PantallaFlujoDiario sucursal="TJ" />);
    await screen.findByRole("table", { name: "Por vendedor" });
    const cifra = () => screen.getByText("Cobranza", { selector: "dt" }).parentElement;
    expect(cifra()).toHaveTextContent("$500.00");
    await u.click(screen.getByRole("tab", { name: "Por día" }));
    expect(cifra()).toHaveTextContent("$540.00");
    expect(cifra()).toHaveTextContent("Vendedores $500.00 · Oficina $40.00");
    await u.click(screen.getByRole("tab", { name: "Por vendedor" }));
    expect(cifra()).toHaveTextContent("$500.00");
    expect(cifra()).toHaveTextContent("Solo lo que cobraron los vendedores");
  });

  it("Por día sin cobranza de la oficina no menciona a la oficina", async () => {
    mockAuth([PERMISO]);
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PantallaFlujoDiario sucursal="TJ" />);
    await screen.findByRole("table", { name: "Por vendedor" });
    await u.click(screen.getByRole("tab", { name: "Por día" }));
    expect(screen.getByText("Cobranza", { selector: "dt" }).parentElement).not.toHaveTextContent("Oficina");
  });

  it("cambiar de pestaña no hace que las pestañas avisen que cambió su valor inicial", async () => {
    mockAuth([PERMISO]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PantallaFlujoDiario sucursal="TJ" />);
    await screen.findByRole("table", { name: "Por vendedor" });
    await u.click(screen.getByRole("tab", { name: "Por día" }));
    await u.click(screen.getByRole("tab", { name: "Por vendedor" }));
    const mensajes = [...error.mock.calls, ...warn.mock.calls].map((c) => c.join(" "));
    expect(mensajes.filter((m) => m.includes("default value"))).toEqual([]);
    error.mockRestore();
    warn.mockRestore();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as clientesLib from "@/lib/clientes";
import type { ClienteResumen } from "@/lib/clientes";
import * as cobranzasLib from "@/lib/cobranzas";
import type { ClientePorCobrar, NotaPorCobrar, PlanDeCobro } from "@/lib/cobranzas";
import * as facturasLib from "@/lib/facturas";
import { rangoMes } from "@/lib/fechas";
import * as ventasLib from "@/lib/ventas";
import { hoyEnTijuana, type VentaDetalle, type VentaEncontrada } from "@/lib/ventas";
import { PestanaNotas } from "./pestana-notas";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/clientes", () => ({ listarClientes: vi.fn() }));
vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return { ...real, buscarVentas: vi.fn(), obtenerVenta: vi.fn(), listarRepartidores: vi.fn() };
});
vi.mock("@/lib/cobranzas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cobranzas")>();
  return {
    ...real,
    porCobrarDeCliente: vi.fn(),
    vistaPreviaCobro: vi.fn(),
    registrarCobro: vi.fn(),
    aplicarSaldoFavor: vi.fn(),
  };
});
vi.mock("@/lib/facturas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/facturas")>();
  return { ...real, asignarFactura: vi.fn(), buscarFacturas: vi.fn() };
});

const buscarVentas = vi.mocked(ventasLib.buscarVentas);
const obtenerVenta = vi.mocked(ventasLib.obtenerVenta);
const porCobrarDeCliente = vi.mocked(cobranzasLib.porCobrarDeCliente);
const vistaPreviaCobro = vi.mocked(cobranzasLib.vistaPreviaCobro);
const registrarCobro = vi.mocked(cobranzasLib.registrarCobro);
const aplicarSaldoFavor = vi.mocked(cobranzasLib.aplicarSaldoFavor);
const asignarFactura = vi.mocked(facturasLib.asignarFactura);

const HOY = hoyEnTijuana();
const TODOS = ["cobranza.registrar", "venta.asignar_factura", "venta.editar_eliminar"];

function mockAuth(permisos: string[]) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: null,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (c: string) => permisos.includes(c),
  });
}

const CLIENTE: ClienteResumen = {
  id: "c1",
  nombre: "Cafetería ITT",
  telefono: "",
  tipo: "cliente",
  tipoNegocio: null,
  sucursalCodigo: "TJ",
};

const venta = (m: Partial<VentaEncontrada>): VentaEncontrada => ({
  id: "v1",
  folio: "TJ261124RI03",
  fecha: "2026-11-24",
  clienteId: "c1",
  cliente: "Cafetería ITT",
  repartidor: "Ricardo",
  vendedorId: "ri",
  numNota: "1520",
  montoCentavos: 80000,
  status: "pendiente",
  origen: "app",
  saldoCentavos: 80000,
  factura: { estado: "pendiente", numero: null },
  ...m,
});

// El servidor las da de la más nueva a la más vieja.
const V1 = venta({});
const V2 = venta({
  id: "v2",
  folio: "TJ261120RI05",
  fecha: "2026-11-20",
  numNota: null,
  montoCentavos: 70000,
  status: "abonado",
  saldoCentavos: 45000,
  factura: { estado: "N/A", numero: null },
});
const V3 = venta({
  id: "v3",
  folio: "TJ261118OF02",
  fecha: "2026-11-18",
  repartidor: null,
  vendedorId: null,
  numNota: "1488",
  montoCentavos: 75000,
  saldoCentavos: 75000,
  factura: { estado: "facturada", numero: "F-10233" },
});

const nota = (v: VentaEncontrada): NotaPorCobrar => ({
  id: v.id,
  folio: v.folio,
  numNota: v.numNota,
  fecha: v.fecha,
  clienteId: "c1",
  cliente: "Cafetería ITT",
  sucursalCodigo: "TJ",
  montoCentavos: v.montoCentavos,
  saldoCentavos: v.saldoCentavos,
  status: v.status === "abonado" ? "abonado" : "pendiente",
  abonos: [],
});

const POR_COBRAR: ClientePorCobrar = {
  id: "c1",
  nombre: "Cafetería ITT",
  sucursalId: "suc-tj",
  sucursalCodigo: "TJ",
  saldoFavorCentavos: 0,
  notas: [nota(V3), nota(V2), nota(V1)],
};

const PLAN: PlanDeCobro = {
  aplicaciones: [
    { notaId: "v2", folio: "TJ261120RI05", numNota: null, fecha: "2026-11-20", montoCentavos: 45000, saldoAntesCentavos: 45000, saldoDespuesCentavos: 0, status: "pagada", palomeada: true },
    { notaId: "v1", folio: "TJ261124RI03", numNota: "1520", fecha: "2026-11-24", montoCentavos: 55000, saldoAntesCentavos: 80000, saldoDespuesCentavos: 25000, status: "abonado", palomeada: true },
  ],
  saldoFavorCentavos: 0,
};

const DETALLE = {
  id: "v1",
  folio: "TJ261124RI03",
  fecha: "2026-11-24",
  clienteId: "c1",
  cliente: "Cafetería ITT",
  sucursalId: "suc-tj",
  sucursalCodigo: "TJ",
  vendedorId: "ri",
  repartidor: "Ricardo",
  numNota: "1520",
  contadoCredito: "credito",
  factura: "pendiente",
  facturaNumero: null,
  comentarios: null,
  montoCentavos: 80000,
  status: "pendiente",
  origen: "app",
  saldoCentavos: 80000,
  lineas: [],
  cobros: [],
  editable: true,
  motivoNoEditable: null,
  puedeMarcarPerdida: true,
  firma: { esperada: false, nombre: null, subidaEn: null },
  editada: false,
} as VentaDetalle;

function renderizar(props: Partial<Parameters<typeof PestanaNotas>[0]> = {}) {
  const onSucio = vi.fn();
  const onCambio = vi.fn();
  render(<PestanaNotas sucursal="TJ" cliente={CLIENTE} onSucio={onSucio} onCambio={onCambio} {...props} />);
  return { u: userEvent.setup(), onSucio, onCambio };
}

/** Las filas de la tabla de notas (sin el encabezado). */
function filas() {
  return within(screen.getByRole("table", { name: "Notas" })).getAllByRole("row").slice(1);
}

async function palomear(u: ReturnType<typeof userEvent.setup>, ...folios: string[]) {
  for (const f of folios) await u.click(await screen.findByRole("checkbox", { name: `Marcar ${f}` }));
}

describe("PestanaNotas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth(TODOS);
    vi.mocked(clientesLib.listarClientes).mockResolvedValue([CLIENTE]);
    vi.mocked(ventasLib.listarRepartidores).mockResolvedValue([{ id: "ri", nombre: "Ricardo" }]);
    buscarVentas.mockResolvedValue({ ventas: [V1, V2, V3], hayMas: false });
    porCobrarDeCliente.mockResolvedValue(POR_COBRAR);
    vistaPreviaCobro.mockResolvedValue(PLAN);
    registrarCobro.mockResolvedValue({ ...PLAN, cliente: "Cafetería ITT", montoCentavos: 100000 });
    aplicarSaldoFavor.mockResolvedValue({ ...PLAN, cliente: "Cafetería ITT", montoCentavos: 15000 });
    obtenerVenta.mockResolvedValue(DETALLE);
  });

  it("con cliente: Con saldo por omisión, de la más vieja a la más nueva, con las columnas del boceto", async () => {
    renderizar();
    await waitFor(() =>
      expect(buscarVentas).toHaveBeenCalledWith({ sucursal: "TJ", clienteId: "c1", filtro: "con_saldo" }),
    );
    expect(screen.getByRole("radio", { name: "Con saldo" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByPlaceholderText("Folio o # de nota")).toBeInTheDocument();
    const encabezados = within(screen.getByRole("table", { name: "Notas" }))
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(encabezados).toEqual(["Marcar todas", "Folio", "Fecha", "# nota", "Vendedor", "Total", "Saldo", "Status", "Factura", "Ver"]);
    await waitFor(() => expect(filas()).toHaveLength(3));
    const [f1, f2, f3] = filas();
    expect(f1).toHaveTextContent(/TJ261118OF02.*18\/11\/2026.*1488.*Oficina.*\$750\.00.*\$750\.00.*Pendiente.*F-10233.*Ver/);
    expect(f2).toHaveTextContent(/TJ261120RI05.*20\/11\/2026.*—.*Ricardo.*\$700\.00.*\$450\.00.*Abonado.*N\/A/);
    expect(f3).toHaveTextContent(/TJ261124RI03.*Pendiente.*Pendiente/);
    // El saldo en ámbar.
    expect(within(f2).getByText("$450.00")).toHaveClass("text-warning");
    // Sin pastillas (boceto 2).
    expect(f1.querySelector("[data-tono]")).toBeNull();
  });

  it("Por facturar y Todas: Todas trae el filtro de fechas (este mes) y pide con Mostrar", async () => {
    const { u } = renderizar();
    await waitFor(() => expect(buscarVentas).toHaveBeenCalledTimes(1));
    await u.click(screen.getByRole("radio", { name: "Por facturar" }));
    await waitFor(() =>
      expect(buscarVentas).toHaveBeenLastCalledWith({ sucursal: "TJ", clienteId: "c1", filtro: "por_facturar" }),
    );
    expect(screen.queryByLabelText("Desde")).toBeNull();
    await u.click(screen.getByRole("radio", { name: "Todas" }));
    const mes = rangoMes(HOY);
    await waitFor(() =>
      expect(buscarVentas).toHaveBeenLastCalledWith({ sucursal: "TJ", clienteId: "c1", filtro: "todas", desde: mes.desde, hasta: mes.hasta }),
    );
    expect(screen.getByLabelText("Desde")).toHaveValue(mes.desde);
    // Todas: de la más nueva a la más vieja (el orden del servidor).
    await waitFor(() => expect(filas()[0]).toHaveTextContent("TJ261124RI03"));
    await u.click(screen.getByRole("button", { name: "Ayer" }));
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    const ayer = buscarVentas.mock.calls.at(-1)![0];
    expect(ayer.desde).toBe(ayer.hasta);
    expect(ayer.desde! < HOY).toBe(true);
  });

  it("sin cliente: Con saldo y Por facturar piden uno; Todas busca en la sucursal, con columna Cliente y sin casillas", async () => {
    const { u } = renderizar({ cliente: null });
    expect(await screen.findByText("Elige un cliente arriba.")).toBeInTheDocument();
    await u.click(screen.getByRole("radio", { name: "Por facturar" }));
    expect(screen.getByText("Elige un cliente arriba.")).toBeInTheDocument();
    expect(buscarVentas).not.toHaveBeenCalled();
    await u.click(screen.getByRole("radio", { name: "Todas" }));
    const mes = rangoMes(HOY);
    await waitFor(() =>
      expect(buscarVentas).toHaveBeenCalledWith({ sucursal: "TJ", filtro: "todas", desde: mes.desde, hasta: mes.hasta }),
    );
    await waitFor(() => expect(filas()).toHaveLength(3));
    expect(within(screen.getByRole("table", { name: "Notas" })).getByRole("columnheader", { name: "Cliente" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("el buscador: un folio busca el folio exacto y un número busca el # de nota en cualquier fecha", async () => {
    const { u } = renderizar({ cliente: null });
    const caja = screen.getByPlaceholderText("Folio o # de nota");
    await u.type(caja, " tj261124ri03{Enter}");
    await waitFor(() =>
      expect(buscarVentas).toHaveBeenLastCalledWith({ sucursal: "TJ", filtro: "todas", folio: "TJ261124RI03" }),
    );
    expect(screen.queryByText("Elige un cliente arriba.")).toBeNull();
    await u.clear(caja);
    await u.type(caja, "1520{Enter}");
    await waitFor(() =>
      expect(buscarVentas).toHaveBeenLastCalledWith({
        sucursal: "TJ",
        filtro: "todas",
        numNota: "1520",
        desde: "2020-01-01",
        hasta: HOY,
      }),
    );
    // Vaciar la caja y Enter vuelve al filtro.
    await u.clear(caja);
    await u.type(caja, "{Enter}");
    expect(await screen.findByText("Elige un cliente arriba.")).toBeInTheDocument();
  });

  it("palomear: la barra suma saldo; Anotar factura solo si todas están pendientes; Cobrar según el permiso", async () => {
    const { u } = renderizar();
    await palomear(u, "TJ261124RI03", "TJ261120RI05");
    const barra = screen.getByRole("region", { name: "Notas marcadas" });
    expect(barra).toHaveTextContent("2 notas");
    expect(barra).toHaveTextContent("saldo $1,250.00");
    // TJ261120RI05 es N/A: no se puede anotar factura.
    expect(within(barra).queryByRole("button", { name: "Anotar factura" })).toBeNull();
    expect(within(barra).getByRole("button", { name: "Cobrar 2 notas…" })).toBeInTheDocument();
    await u.click(screen.getByRole("checkbox", { name: "Marcar TJ261120RI05" }));
    expect(within(barra).getByRole("button", { name: "Anotar factura" })).toBeInTheDocument();
    expect(within(barra).getByRole("button", { name: "Cobrar 1 nota…" })).toBeInTheDocument();
  });

  it("sin permisos no salen Cobrar ni Anotar factura", async () => {
    mockAuth([]);
    const { u } = renderizar();
    await palomear(u, "TJ261124RI03");
    const barra = screen.getByRole("region", { name: "Notas marcadas" });
    expect(within(barra).queryByRole("button")).toBeNull();
  });

  it("Marcar todas palomea las del cliente y la nota inicial llega palomeada", async () => {
    const { u } = renderizar({ notaInicial: "v2" });
    expect(await screen.findByRole("checkbox", { name: "Marcar TJ261120RI05" })).toBeChecked();
    await u.click(screen.getByRole("checkbox", { name: "Marcar todas" }));
    expect(screen.getByRole("region", { name: "Notas marcadas" })).toHaveTextContent("3 notas");
  });

  it("Review Focus 1 + R3: cobrar graba lo mismo que Cobranza, con Cancelar y Grabar pago juntos después de Así queda", async () => {
    const { u, onSucio, onCambio } = renderizar();
    await palomear(u, "TJ261124RI03", "TJ261120RI05");
    await u.click(screen.getByRole("button", { name: "Cobrar 2 notas…" }));
    const recuadro = await screen.findByRole("region", { name: "Cobrar 2 notas" });
    // R3: el botón de la barra se oculta con el recuadro abierto.
    expect(screen.queryByRole("button", { name: "Cobrar 2 notas…" })).toBeNull();
    expect(porCobrarDeCliente).toHaveBeenCalledWith("c1");

    await u.type(within(recuadro).getByLabelText("Monto"), "1000");
    expect(onSucio).toHaveBeenLastCalledWith(true);
    await u.selectOptions(within(recuadro).getByLabelText("Método"), "efectivo");
    // La vista previa sale sola (la misma llamada de Cobranza).
    const asi = await within(recuadro).findByRole("region", { name: "Vista previa" });
    expect(asi).toHaveTextContent("Así queda");
    expect(vistaPreviaCobro).toHaveBeenLastCalledWith({ clienteId: "c1", notaIds: ["v2", "v1"], montoCentavos: 100000, modo: "pago" });

    const cancelar = within(recuadro).getByRole("button", { name: "Cancelar" });
    const grabar = within(recuadro).getByRole("button", { name: "Grabar pago" });
    expect(cancelar.parentElement).toBe(grabar.parentElement);
    expect(cancelar.parentElement).toHaveClass("justify-end");
    // Después de "Así queda".
    expect(asi.compareDocumentPosition(grabar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await u.click(grabar);
    await waitFor(() =>
      expect(registrarCobro).toHaveBeenCalledWith({
        clienteId: "c1",
        notaIds: ["v2", "v1"],
        montoCentavos: 100000,
        fechaPago: HOY,
        metodoPago: "efectivo",
        vendedorId: null,
      }),
    );
    expect(await screen.findByText("Cobro registrado: $1,000.00 a Cafetería ITT")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Cobrar 2 notas" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Notas marcadas" })).toBeNull();
    await waitFor(() => expect(buscarVentas).toHaveBeenCalledTimes(2));
    expect(onCambio).toHaveBeenCalled();
    expect(onSucio).toHaveBeenLastCalledWith(false);
  });

  it("Review Focus 1: el 409 'ya no tiene saldo' avisa en ámbar y recarga la lista", async () => {
    registrarCobro.mockRejectedValue(new ErrorApi("x", 409, "La nota TJ261120RI05 ya no tiene saldo."));
    const { u } = renderizar();
    await palomear(u, "TJ261120RI05");
    await u.click(screen.getByRole("button", { name: "Cobrar 1 nota…" }));
    const recuadro = await screen.findByRole("region", { name: "Cobrar 1 nota" });
    await u.type(within(recuadro).getByLabelText("Monto"), "450");
    await within(recuadro).findByRole("region", { name: "Vista previa" });
    await u.click(within(recuadro).getByRole("button", { name: "Grabar pago" }));
    const aviso = await screen.findByText("La nota TJ261120RI05 ya no tiene saldo.");
    expect(aviso.closest("[data-tono]")).toHaveAttribute("data-tono", "advertencia");
    await waitFor(() => expect(buscarVentas).toHaveBeenCalledTimes(2));
  });

  it("Cancelar cierra el recuadro y vuelve el botón de la barra", async () => {
    const { u, onSucio } = renderizar();
    await palomear(u, "TJ261124RI03");
    await u.click(screen.getByRole("button", { name: "Cobrar 1 nota…" }));
    const recuadro = await screen.findByRole("region", { name: "Cobrar 1 nota" });
    await u.type(within(recuadro).getByLabelText("Monto"), "5");
    await u.click(within(recuadro).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("region", { name: "Cobrar 1 nota" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cobrar 1 nota…" })).toBeInTheDocument();
    expect(onSucio).toHaveBeenLastCalledWith(false);
  });

  it("Usar saldo a favor: aplica con la misma regla (modo saldo_favor)", async () => {
    porCobrarDeCliente.mockResolvedValue({ ...POR_COBRAR, saldoFavorCentavos: 15000 });
    const { u } = renderizar();
    await palomear(u, "TJ261120RI05");
    await u.click(screen.getByRole("button", { name: "Cobrar 1 nota…" }));
    const recuadro = await screen.findByRole("region", { name: "Cobrar 1 nota" });
    await u.click(await within(recuadro).findByRole("button", { name: "Usar saldo a favor ($150.00)" }));
    expect(within(recuadro).getByLabelText("Monto a aplicar")).toHaveValue("150.00");
    await within(recuadro).findByRole("region", { name: "Vista previa" });
    expect(vistaPreviaCobro).toHaveBeenLastCalledWith({ clienteId: "c1", notaIds: ["v2"], montoCentavos: 15000, modo: "saldo_favor" });
    await u.click(within(recuadro).getByRole("button", { name: "Aplicar saldo a favor" }));
    await waitFor(() => expect(aplicarSaldoFavor).toHaveBeenCalledWith({ clienteId: "c1", notaIds: ["v2"], montoCentavos: 15000 }));
    expect(await screen.findByText("Saldo a favor aplicado: $150.00 a Cafetería ITT")).toBeInTheDocument();
  });

  it("Anotar factura: la ventana manda el número para las marcadas y recarga", async () => {
    asignarFactura.mockResolvedValue({
      id: "f1", numero: "F-200", clienteId: "c1", cliente: "Cafetería ITT", sucursalCodigo: "TJ",
      creadoPor: "Lupe", creadoEn: "2026-11-25T10:00:00Z", totalCentavos: 80000, ventas: [],
    });
    const { u, onCambio } = renderizar();
    await palomear(u, "TJ261124RI03");
    await u.click(screen.getByRole("button", { name: "Anotar factura" }));
    const ventana = await screen.findByRole("dialog", { name: "Anotar factura" });
    await u.type(within(ventana).getByLabelText("Número de factura"), " F-200 ");
    await u.click(within(ventana).getByRole("button", { name: "Anotar factura" }));
    await waitFor(() => expect(asignarFactura).toHaveBeenCalledWith("c1", "F-200", ["v1"]));
    expect(await screen.findByText("Factura F-200 anotada en 1 venta ($800.00).")).toBeInTheDocument();
    await waitFor(() => expect(buscarVentas).toHaveBeenCalledTimes(2));
    expect(onCambio).toHaveBeenCalled();
  });

  it("Buscar factura abre el buscador de facturas de hoy en una ventana", async () => {
    const { u } = renderizar();
    await u.click(await screen.findByRole("button", { name: "Buscar factura" }));
    const ventana = await screen.findByRole("dialog", { name: "Buscar factura" });
    expect(within(ventana).getByLabelText("Número de factura a buscar")).toBeInTheDocument();
  });

  it("Ver › abre el detalle dentro de la pestaña y ← Volver a Notas regresa y recarga", async () => {
    const { u } = renderizar();
    await waitFor(() => expect(filas()).toHaveLength(3));
    await u.click(screen.getByRole("button", { name: "Ver TJ261124RI03" }));
    expect(await screen.findByRole("heading", { name: "Venta TJ261124RI03" })).toBeInTheDocument();
    expect(obtenerVenta).toHaveBeenCalledWith("v1");
    expect(screen.queryByRole("table", { name: "Notas" })).toBeNull();
    await u.click(screen.getByRole("button", { name: "← Volver a Notas" }));
    await waitFor(() => expect(filas()).toHaveLength(3));
    expect(buscarVentas).toHaveBeenCalledTimes(2);
  });

  it("revisión T-2 (5): con el recuadro de cobro abierto no se puede ver, filtrar, buscar ni anotar factura", async () => {
    const { u } = renderizar();
    await palomear(u, "TJ261124RI03");
    const barra = screen.getByRole("region", { name: "Notas marcadas" });
    expect(within(barra).getByRole("button", { name: "Anotar factura" })).toBeEnabled();
    await u.click(screen.getByRole("button", { name: "Cobrar 1 nota…" }));
    await screen.findByRole("region", { name: "Cobrar 1 nota" });
    for (const folio of ["TJ261118OF02", "TJ261120RI05", "TJ261124RI03"])
      expect(screen.getByRole("button", { name: `Ver ${folio}` })).toBeDisabled();
    for (const f of ["Con saldo", "Por facturar", "Todas"]) expect(screen.getByRole("radio", { name: f })).toBeDisabled();
    expect(screen.getByPlaceholderText("Folio o # de nota")).toBeDisabled();
    expect(within(barra).getByRole("button", { name: "Anotar factura" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Buscar factura" })).toBeDisabled();
    // Al cancelar vuelve todo.
    await u.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Ver TJ261124RI03" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "Todas" })).toBeEnabled();
  });
  it("con más de 200 notas avisa que acote las fechas o elija un cliente", async () => {
    buscarVentas.mockResolvedValue({ ventas: [V1, V2, V3], hayMas: true });
    const { u } = renderizar({ cliente: null });
    await u.click(await screen.findByRole("radio", { name: "Todas" }));
    expect(await screen.findByText("Hay más de 200 notas: acota las fechas o elige un cliente.")).toBeInTheDocument();
  });

  it("Todas con fechas invertidas avisa y no vuelve a buscar", async () => {
    const { u } = renderizar();
    await u.click(await screen.findByRole("radio", { name: "Todas" }));
    await waitFor(() => expect(buscarVentas).toHaveBeenLastCalledWith(expect.objectContaining({ filtro: "todas" })));
    const llamadas = buscarVentas.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2099-12-31" } });
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("La fecha inicial no puede ser posterior a la final.");
    expect(buscarVentas).toHaveBeenCalledTimes(llamadas);
  });
});

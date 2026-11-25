import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as clientesLib from "@/lib/clientes";
import * as procesosLib from "@/lib/procesos";
import type { Proceso, ResumenCliente } from "@/lib/procesos";
import * as productosLib from "@/lib/productos";
import * as vendedoresLib from "@/lib/vendedores";
import { diaAnterior } from "@/lib/fechas";
import { formatearDiaLargo } from "@/lib/formato";
import * as ventasLib from "@/lib/ventas";
import * as cobranzasLib from "@/lib/cobranzas";
import { hoyEnTijuana, type VentaDetalle, type VentaEncontrada } from "@/lib/ventas";
import { PantallaProcesos } from "./pantalla-procesos";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/procesos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/procesos")>();
  return {
    ...real,
    listarProcesos: vi.fn(),
    crearProceso: vi.fn(),
    editarProceso: vi.fn(),
    eliminarProceso: vi.fn(),
    precargaDescuentos: vi.fn(),
    resumenCliente: vi.fn(),
  };
});
vi.mock("@/lib/clientes", () => ({ listarClientes: vi.fn(), obtenerCliente: vi.fn() }));
vi.mock("@/lib/vendedores", () => ({ listarVendedores: vi.fn() }));
vi.mock("@/lib/productos", () => ({ listarProductos: vi.fn() }));
vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return {
    ...real,
    buscarVentas: vi.fn(),
    obtenerVenta: vi.fn(),
    listarRepartidores: vi.fn(),
    obtenerCatalogoVenta: vi.fn(),
    registrarVenta: vi.fn(),
  };
});
vi.mock("@/lib/cobranzas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cobranzas")>();
  return { ...real, porCobrarDeCliente: vi.fn(), vistaPreviaCobro: vi.fn(), registrarCobro: vi.fn() };
});

const HOY = hoyEnTijuana();
const TODOS = ["proceso.merma", "proceso.cambio", "proceso.consumo", "proceso.promocion", "proceso.descuento"];

function mockAuth(permisos: string[], codigo: string | null = "TJ") {
  vi.mocked(useAuth).mockReturnValue({
    usuario: {
      id: "u1",
      login: "lupe",
      nombre: "Lupe",
      perfil: "Administrador General",
      sucursal: codigo ? { id: "s", codigo, nombre: codigo } : null,
      permisos,
    },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (c: string) => permisos.includes(c),
  });
}

const cliente = (id: string, nombre: string) => ({
  id,
  nombre,
  telefono: "",
  tipo: "cliente" as const,
  tipoNegocio: "Restaurante",
  sucursalCodigo: "TJ",
});

const resumen = (id: string, nombre: string, m: Partial<ResumenCliente> = {}): ResumenCliente => ({
  id,
  nombre,
  tipo: "cliente",
  tipoNegocio: "Restaurante",
  diasCredito: 15,
  deudaCentavos: 124000,
  notasConSaldo: 3,
  ultimaCompra: "2026-11-22",
  promociones: ["compra 10, lleva 1"],
  saldoFavorCentavos: 0,
  ...m,
});

const proceso = (m: Partial<Proceso> = {}): Proceso => ({
  id: "x1",
  tipo: "merma",
  fecha: HOY,
  hora: "08:15",
  mermaDe: "cliente",
  cliente: { id: "c1", nombre: "Mariscos Bucanero" },
  vendedor: { id: "v1", nombre: "Ricardo" },
  comentario: null,
  capturo: "Lupe",
  lineas: [
    { presentacionId: "p2", nombre: "Horchata 500 ml", sentido: "recibido", piezas: 5 },
    { presentacionId: "p3", nombre: "Jamaica 500 ml", sentido: "entregado", piezas: 5 },
  ],
  actualizadoEn: "2026-11-24T16:15:00.123456Z",
  ...m,
});

const delDia = (procesos: Proceso[]) => ({ fecha: HOY, hoy: HOY, procesos });

/** La única nota con saldo de cada cliente (mismo folio, otro id). */
const notaDe = (clienteId: string): VentaEncontrada => ({
  id: clienteId === "c1" ? "v2" : "v2b",
  folio: "TJ261120RI05",
  fecha: "2026-11-20",
  clienteId,
  cliente: clienteId,
  repartidor: "Ricardo",
  vendedorId: "v1",
  numNota: null,
  montoCentavos: 70000,
  status: "abonado",
  origen: "app",
  saldoCentavos: 45000,
  factura: { estado: "N/A", numero: null },
});

async function elegirCliente(u: ReturnType<typeof userEvent.setup>, texto: string, nombre: RegExp) {
  await u.type(screen.getByPlaceholderText("Escribe el nombre del cliente"), texto);
  await u.click(await screen.findByRole("option", { name: nombre }));
}

/** "+ Agregar producto" de una caja, busca y elige; luego escribe las piezas. */
async function agregar(u: ReturnType<typeof userEvent.setup>, caja: string, busqueda: string, nombre: string, piezas: string) {
  await u.click(screen.getByRole("button", { name: `Agregar producto a ${caja}` }));
  await u.type(screen.getByRole("searchbox", { name: `Buscar producto para ${caja}` }), busqueda);
  await u.click(await screen.findByRole("option", { name: nombre }));
  const campo = screen.getByRole("textbox", { name: `Piezas de ${nombre} en ${caja}` });
  await u.clear(campo);
  if (piezas !== "") await u.type(campo, piezas);
}

describe("PantallaProcesos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(procesosLib.listarProcesos).mockResolvedValue(delDia([]));
    vi.mocked(procesosLib.resumenCliente).mockImplementation(async (id) =>
      id === "c1" ? resumen("c1", "Mariscos Bucanero") : resumen("c2", "Tienda Lupita", { deudaCentavos: 0, notasConSaldo: 0, promociones: [] }),
    );
    vi.mocked(clientesLib.listarClientes).mockResolvedValue([cliente("c1", "Mariscos Bucanero"), cliente("c2", "Tienda Lupita")]);
    vi.mocked(clientesLib.obtenerCliente).mockResolvedValue({ id: "c1", sucursalId: "s" } as Awaited<ReturnType<typeof clientesLib.obtenerCliente>>);
    vi.mocked(ventasLib.buscarVentas).mockImplementation(async (f) => ({ ventas: f.clienteId ? [notaDe(f.clienteId)] : [], hayMas: false }));
    vi.mocked(ventasLib.obtenerVenta).mockResolvedValue({ id: "v2", folio: "TJ261120RI05", lineas: [], cobros: [], firma: { esperada: false, nombre: null, subidaEn: null } } as unknown as VentaDetalle);
    vi.mocked(ventasLib.listarRepartidores).mockResolvedValue([]);
    vi.mocked(ventasLib.obtenerCatalogoVenta).mockResolvedValue([{ presentacionId: "p1", producto: "Horchata", volumen: "1 L", precioCentavos: 1000 }]);
    vi.mocked(ventasLib.registrarVenta).mockResolvedValue({ id: "v9", folio: "TJ261125OF01", montoCentavos: 3000, status: "pendiente" });
    vi.mocked(cobranzasLib.porCobrarDeCliente).mockResolvedValue({
      id: "c1", nombre: "Mariscos Bucanero", sucursalId: "s", sucursalCodigo: "TJ", saldoFavorCentavos: 0,
      notas: [{ id: "v2", folio: "TJ261120RI05", numNota: null, fecha: "2026-11-20", clienteId: "c1", cliente: "Mariscos Bucanero", sucursalCodigo: "TJ", montoCentavos: 70000, saldoCentavos: 45000, status: "abonado", abonos: [] }],
    });
    vi.mocked(cobranzasLib.vistaPreviaCobro).mockResolvedValue({ aplicaciones: [], saldoFavorCentavos: 0 });
    vi.mocked(vendedoresLib.listarVendedores).mockResolvedValue([
      { id: "v1", nombre: "Ricardo", login: "ricardo", sucursalId: "s", sucursalCodigo: "TJ", folioSegmento: "RI", activo: true },
      { id: "v2", nombre: "Pedro", login: "pedro", sucursalId: "s", sucursalCodigo: "TJ", folioSegmento: "PE", activo: true },
      { id: "v3", nombre: "Baja", login: "baja", sucursalId: "s", sucursalCodigo: "TJ", folioSegmento: "BA", activo: false },
    ]);
    vi.mocked(productosLib.listarProductos).mockResolvedValue([
      { id: "pr1", nombre: "Horchata", activo: true, presentaciones: [{ id: "p1", volumen: "1 L" }, { id: "p2", volumen: "500 ml" }] },
      { id: "pr2", nombre: "Jamaica", activo: true, presentaciones: [{ id: "p3", volumen: "500 ml" }] },
      { id: "pr3", nombre: "Viejo", activo: false, presentaciones: [{ id: "p4", volumen: "1 L" }] },
    ]);
  });

  it("sin ningún permiso queda Notas (solo pide sesión) y abre en ella", async () => {
    mockAuth(["otro"]);
    render(<PantallaProcesos sucursal={null} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Notas"]);
    expect(await screen.findByRole("radio", { name: "Con saldo" })).toBeInTheDocument();
    expect(vendedoresLib.listarVendedores).not.toHaveBeenCalled();
  });

  it("Ventas (venta.registrar) y Notas van antes de Merma; abre en la primera", async () => {
    mockAuth(["venta.registrar", "proceso.merma"]);
    render(<PantallaProcesos sucursal={null} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Ventas", "Notas", "Merma"]);
    expect(screen.getByRole("tab", { name: "Ventas" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Elige un cliente arriba.")).toBeInTheDocument();
  });

  it("la línea del cliente suma A favor $X si tiene saldo a favor", async () => {
    mockAuth(TODOS);
    vi.mocked(procesosLib.resumenCliente).mockResolvedValue(resumen("c1", "Mariscos Bucanero", { saldoFavorCentavos: 15000 }));
    const u = userEvent.setup();
    render(<PantallaProcesos sucursal={null} />);
    await elegirCliente(u, "maris", /Mariscos Bucanero/);
    const linea = (await screen.findByText(/Última compra/)).closest("p")!;
    expect(linea).toHaveTextContent("Crédito 15 días · Debe $1,240.00 en 3 notas · A favor $150.00 · Última compra dom 22 nov · 1 promoción");
  });

  it("Review Focus 3: cambiar de cliente limpia casillas y recuadro de cobro (pregunta si hay un cobro a medio capturar)", async () => {
    mockAuth([...TODOS, "cobranza.registrar"]);
    const u = userEvent.setup();
    render(<PantallaProcesos sucursal={null} />);
    await elegirCliente(u, "maris", /Mariscos Bucanero/);
    await u.click(await screen.findByRole("checkbox", { name: "Marcar TJ261120RI05" }));
    await u.click(screen.getByRole("button", { name: "Cobrar 1 nota…" }));
    const recuadro = await screen.findByRole("region", { name: "Cobrar 1 nota" });
    await u.type(within(recuadro).getByLabelText("Monto"), "100");

    await u.click(screen.getByRole("button", { name: "Quitar cliente" }));
    const pregunta = await screen.findByRole("alertdialog");
    await u.click(within(pregunta).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("region", { name: "Cobrar 1 nota" })).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: "Quitar cliente" }));
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Descartar" }));
    await elegirCliente(u, "lupi", /Tienda Lupita/);
    await waitFor(() =>
      expect(ventasLib.buscarVentas).toHaveBeenLastCalledWith({ sucursal: "TJ", clienteId: "c2", filtro: "con_saldo" }),
    );
    expect(screen.queryByRole("region", { name: "Cobrar 1 nota" })).toBeNull();
    expect(await screen.findByRole("checkbox", { name: "Marcar TJ261120RI05" })).not.toBeChecked();
    expect(screen.queryByRole("region", { name: "Notas marcadas" })).toBeNull();
  });

  it("Review Focus 3: cambiar de cliente con el detalle abierto lo cierra sin preguntar", async () => {
    mockAuth(TODOS);
    const u = userEvent.setup();
    render(<PantallaProcesos sucursal={null} />);
    await elegirCliente(u, "maris", /Mariscos Bucanero/);
    await u.click(await screen.findByRole("button", { name: "Ver TJ261120RI05" }));
    expect(await screen.findByRole("button", { name: "← Volver a Notas" })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Quitar cliente" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "← Volver a Notas" })).toBeNull();
    expect(await screen.findByText("Elige un cliente arriba.")).toBeInTheDocument();
  });

  it("Ventas: tras grabar, Ver en Notas pasa a Notas buscando ese folio", async () => {
    mockAuth(["venta.registrar"]);
    const u = userEvent.setup();
    render(<PantallaProcesos sucursal={null} />);
    await elegirCliente(u, "maris", /Mariscos Bucanero/);
    await u.selectOptions(await screen.findByLabelText("Repartidor"), "oficina");
    await u.type(await screen.findByLabelText("Cantidad de Horchata 1 L"), "3");
    await u.click(screen.getByRole("button", { name: "Grabar" }));
    await u.click(await screen.findByRole("button", { name: "Ver en Notas" }));
    expect(screen.getByRole("tab", { name: "Notas" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(ventasLib.buscarVentas).toHaveBeenLastCalledWith({ sucursal: "TJ", clienteId: "c1", filtro: "todas", folio: "TJ261125OF01" }),
    );
    expect(screen.getByPlaceholderText("Folio o # de nota")).toHaveValue("TJ261125OF01");
    // La línea del cliente se volvió a pedir (la venta cambia su deuda).
    expect(vi.mocked(procesosLib.resumenCliente).mock.calls.filter(([id]) => id === "c1").length).toBeGreaterThan(1);
  });

  it("con todas las sucursales pide elegir una", () => {
    mockAuth(TODOS, null);
    render(<PantallaProcesos sucursal={null} pestanaInicial="merma" />);
    expect(screen.getByText(/Elige una sucursal/)).toBeInTheDocument();
  });

  it("solo salen las pestañas con su permiso", async () => {
    mockAuth(["proceso.consumo", "proceso.merma"]);
    render(<PantallaProcesos sucursal={null} pestanaInicial="merma" />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Notas", "Merma", "Consumos"]);
    expect(await screen.findByText("Elige un cliente arriba.")).toBeInTheDocument();
  });

  it("el cliente elegido: una sola línea de texto, sin pastillas", async () => {
    mockAuth(TODOS);
    const u = userEvent.setup();
    render(<PantallaProcesos sucursal={null} pestanaInicial="merma" />);
    await elegirCliente(u, "maris", /Mariscos Bucanero/);
    const linea = (await screen.findByText(/Última compra/)).closest("p")!;
    expect(linea).toHaveTextContent("Crédito 15 días · Debe $1,240.00 en 3 notas · Última compra dom 22 nov · 1 promoción");
    expect(within(linea).getByText("Debe $1,240.00")).toHaveClass("text-warning");
    expect(linea.querySelector("[data-tono]")).toBeNull();
    // El nombre va dentro del campo, con ✕ para quitarlo.
    expect(screen.getByRole("button", { name: "Quitar cliente" })).toBeInTheDocument();
    await u.hover(within(linea).getByRole("button", { name: "1 promoción" }));
    expect(await screen.findByText("compra 10, lleva 1")).toBeInTheDocument();
  });

  it("sin deuda ni promociones no las menciona; un prospecto empieza con Prospecto", async () => {
    mockAuth(TODOS);
    const u = userEvent.setup();
    vi.mocked(procesosLib.resumenCliente).mockResolvedValue(
      resumen("c2", "Tienda Lupita", { tipo: "prospecto", diasCredito: null, deudaCentavos: 0, notasConSaldo: 0, promociones: [], ultimaCompra: null }),
    );
    render(<PantallaProcesos sucursal={null} pestanaInicial="merma" />);
    await elegirCliente(u, "lupi", /Tienda Lupita/);
    const linea = (await screen.findByText(/Contado/)).closest("p")!;
    expect(linea).toHaveTextContent(/^Prospecto · Contado$/);
  });

  it("sin cliente: Merma de cliente, Cambios y Promoción piden uno; Consumos y Merma de almacén capturan", async () => {
    mockAuth(TODOS);
    const u = userEvent.setup();
    render(<PantallaProcesos sucursal={null} pestanaInicial="merma" />);
    expect(await screen.findByText("Elige un cliente arriba.")).toBeInTheDocument();
    // Merma de cliente sin cliente: solo el aviso, sin la lista de toda la sucursal.
    expect(screen.queryByRole("heading", { name: /Mermas/ })).toBeNull();
    expect(procesosLib.listarProcesos).not.toHaveBeenCalled();
    await u.click(screen.getByRole("radio", { name: "De almacén" }));
    expect(screen.queryByText("Elige un cliente arriba.")).toBeNull();
    expect(screen.getByRole("button", { name: "Agregar producto a Productos dañados" })).toBeInTheDocument();
    expect(screen.queryByText("Le entregué")).toBeNull();

    await u.click(screen.getByRole("tab", { name: "Cambios" }));
    expect(await screen.findByText("Elige un cliente arriba.")).toBeInTheDocument();
    await u.click(screen.getByRole("tab", { name: "Promoción" }));
    expect(await screen.findByText("Elige un cliente arriba.")).toBeInTheDocument();
    await u.click(screen.getByRole("tab", { name: "Consumos" }));
    expect(await screen.findByRole("button", { name: "Agregar producto a Productos" })).toBeInTheDocument();
    expect(screen.queryByText("Elige un cliente arriba.")).toBeNull();
    await waitFor(() =>
      expect(procesosLib.listarProcesos).toHaveBeenLastCalledWith({ tipo: "consumo", fecha: HOY, sucursal: "TJ" }),
    );
  });

  it("merma de cliente: no deja guardar si no cuadra y manda el cuerpo exacto", async () => {
    mockAuth(TODOS);
    const u = userEvent.setup();
    vi.mocked(procesosLib.crearProceso).mockResolvedValue(proceso());
    render(<PantallaProcesos sucursal={null} pestanaInicial="merma" />);
    await elegirCliente(u, "maris", /Mariscos Bucanero/);
    await waitFor(() =>
      expect(procesosLib.listarProcesos).toHaveBeenLastCalledWith({ tipo: "merma", fecha: HOY, sucursal: "TJ", cliente: "c1" }),
    );
    await u.selectOptions(screen.getByLabelText("Recogió"), "Ricardo");
    expect(screen.queryByRole("option", { name: "Baja" })).toBeNull();
    await agregar(u, "Recibí dañado", "horch", "Horchata 500 ml", "5");
    await agregar(u, "Le entregué", "jam", "Jamaica 500 ml", "3");
    expect(screen.getByRole("status")).toHaveTextContent("Recibió 5 · entregó 3 — faltan 2");
    expect(screen.getByRole("button", { name: "Guardar merma" })).toBeDisabled();

    await agregar(u, "Le entregué", "horch", "Horchata 1 L", "2");
    expect(screen.getByRole("status")).toHaveTextContent("Recibió 5 · entregó 5 ✓");
    expect(screen.queryByRole("button", { name: "Limpiar" })).toBeNull();
    await u.type(screen.getByRole("textbox", { name: "Comentario" }), "  venían rotas ");
    await u.click(screen.getByRole("button", { name: "Guardar merma" }));
    expect(procesosLib.crearProceso).toHaveBeenCalledWith({
      tipo: "merma",
      sucursal: "TJ",
      fecha: HOY,
      clienteId: "c1",
      vendedorId: "v1",
      mermaDe: "cliente",
      comentario: "venían rotas",
      lineas: [
        { presentacionId: "p2", sentido: "recibido", piezas: 5 },
        { presentacionId: "p3", sentido: "entregado", piezas: 3 },
        { presentacionId: "p1", sentido: "entregado", piezas: 2 },
      ],
    });
    // Tras guardar, la captura queda limpia y la lista se vuelve a pedir.
    await waitFor(() => expect(screen.queryByRole("textbox", { name: /Piezas de/ })).toBeNull());
    expect(vi.mocked(procesosLib.listarProcesos).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("consumo de Oficina manda vendedor null y sin cliente", async () => {
    mockAuth(["proceso.consumo"]);
    const u = userEvent.setup();
    vi.mocked(procesosLib.crearProceso).mockResolvedValue(proceso({ tipo: "consumo" }));
    render(<PantallaProcesos sucursal={null} pestanaInicial="consumo" />);
    await agregar(u, "Productos", "jam", "Jamaica 500 ml", "2");
    await u.click(screen.getByRole("button", { name: "Guardar consumo" }));
    expect(procesosLib.crearProceso).toHaveBeenCalledWith({
      tipo: "consumo",
      sucursal: "TJ",
      fecha: HOY,
      clienteId: null,
      vendedorId: null,
      mermaDe: null,
      comentario: null,
      lineas: [{ presentacionId: "p3", sentido: "entregado", piezas: 2 }],
    });
  });

  it("un 400 o 409 del servidor sale en rojo", async () => {
    mockAuth(["proceso.consumo"]);
    const u = userEvent.setup();
    vi.mocked(procesosLib.crearProceso).mockRejectedValue(
      new ErrorApi("x", 400, "La fecha no puede ser posterior a hoy."),
    );
    render(<PantallaProcesos sucursal={null} pestanaInicial="consumo" />);
    await agregar(u, "Productos", "jam", "Jamaica 500 ml", "2");
    await u.click(screen.getByRole("button", { name: "Guardar consumo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La fecha no puede ser posterior a hoy.");
  });

  it("la lista pinta los productos en texto; Editar carga el registro y Cancelar lo suelta", async () => {
    mockAuth(TODOS);
    const u = userEvent.setup();
    vi.mocked(procesosLib.listarProcesos).mockResolvedValue(delDia([proceso({ comentario: "rotas" })]));
    vi.mocked(procesosLib.editarProceso).mockResolvedValue(proceso());
    render(<PantallaProcesos sucursal={null} pestanaInicial="merma" />);
    await elegirCliente(u, "maris", /Mariscos Bucanero/);
    expect(await screen.findByRole("heading", { name: "Mermas de hoy" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Hora", "Recogió", "Recibido", "Entregado", "Capturó", "Acciones"]);
    const fila = within(await screen.findByRole("row", { name: /08:15/ }));
    expect(fila.getByText("Horchata 500 ml × 5")).toBeInTheDocument();
    expect(fila.getByText("Jamaica 500 ml × 5")).toBeInTheDocument();
    expect(fila.queryAllByText(/×/).every((e) => !e.closest("[data-tono]"))).toBe(true);
    expect(fila.getByText("Ricardo")).toBeInTheDocument();

    await u.click(fila.getByRole("button", { name: "Editar" }));
    expect(screen.getByRole("textbox", { name: "Piezas de Horchata 500 ml en Recibí dañado" })).toHaveValue("5");
    expect(screen.getByRole("textbox", { name: "Piezas de Jamaica 500 ml en Le entregué" })).toHaveValue("5");
    expect(screen.getByRole("textbox", { name: "Comentario" })).toHaveValue("rotas");
    expect(screen.getByLabelText("Recogió")).toHaveValue("v1");
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();

    await u.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("textbox", { name: /Piezas de/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Guardar merma" })).toBeInTheDocument();

    await u.click(fila.getByRole("button", { name: "Editar" }));
    await u.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(procesosLib.editarProceso).toHaveBeenCalledWith("x1", {
      fecha: HOY,
      clienteId: "c1",
      vendedorId: "v1",
      mermaDe: "cliente",
      comentario: "rotas",
      lineas: [
        { presentacionId: "p2", sentido: "recibido", piezas: 5 },
        { presentacionId: "p3", sentido: "entregado", piezas: 5 },
      ],
    });
  });

  it("Eliminar confirma antes de dar de baja", async () => {
    mockAuth(TODOS);
    const u = userEvent.setup();
    vi.mocked(procesosLib.listarProcesos).mockResolvedValue(delDia([proceso()]));
    vi.mocked(procesosLib.eliminarProceso).mockResolvedValue();
    render(<PantallaProcesos sucursal={null} pestanaInicial="merma" />);
    await elegirCliente(u, "maris", /Mariscos Bucanero/);
    const fila = within(await screen.findByRole("row", { name: /08:15/ }));
    await u.click(fila.getByRole("button", { name: "Eliminar" }));
    const ventana = await screen.findByRole("alertdialog");
    expect(procesosLib.eliminarProceso).not.toHaveBeenCalled();
    await u.click(within(ventana).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(procesosLib.eliminarProceso).toHaveBeenCalledWith("x1"));
  });

  it("merma sin cliente filtrado lista toda la sucursal y dice Almacén", async () => {
    mockAuth(TODOS);
    const u = userEvent.setup();
    vi.mocked(procesosLib.listarProcesos).mockResolvedValue(
      delDia([proceso({ id: "a1", hora: "09:00", mermaDe: "almacen", cliente: null, vendedor: null, lineas: [{ presentacionId: "p1", nombre: "Horchata 1 L", sentido: "recibido", piezas: 2 }] })]),
    );
    render(<PantallaProcesos sucursal={null} pestanaInicial="merma" />);
    await u.click(screen.getByRole("radio", { name: "De almacén" }));
    const fila = within(await screen.findByRole("row", { name: /09:00/ }));
    expect(fila.getByText("Almacén")).not.toHaveAttribute("data-tono");
    expect(fila.getByText("Oficina")).not.toHaveAttribute("data-tono");
    expect(fila.getByText("Horchata 1 L × 2")).toBeInTheDocument();
    expect(procesosLib.listarProcesos).toHaveBeenLastCalledWith({ tipo: "merma", fecha: HOY, sucursal: "TJ" });
  });

  it("cambiar de cliente pregunta si hay algo escrito y no deja lo del otro cliente (Review Focus 5)", async () => {
    mockAuth(TODOS);
    const u = userEvent.setup();
    render(<PantallaProcesos sucursal={null} pestanaInicial="merma" />);
    await elegirCliente(u, "maris", /Mariscos Bucanero/);
    await agregar(u, "Recibí dañado", "horch", "Horchata 500 ml", "5");

    await u.click(screen.getByRole("button", { name: "Quitar cliente" }));
    const ventana = await screen.findByRole("alertdialog");
    await u.click(within(ventana).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("textbox", { name: "Piezas de Horchata 500 ml en Recibí dañado" })).toHaveValue("5");

    await u.click(screen.getByRole("button", { name: "Quitar cliente" }));
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Descartar" }));
    await elegirCliente(u, "lupi", /Tienda Lupita/);
    expect(screen.queryByRole("textbox", { name: /Piezas de/ })).toBeNull();
    await waitFor(() =>
      expect(procesosLib.listarProcesos).toHaveBeenLastCalledWith({ tipo: "merma", fecha: HOY, sucursal: "TJ", cliente: "c2" }),
    );
  });

  it("cambiar de pestaña con algo escrito pregunta y limpia", async () => {
    mockAuth(TODOS);
    const u = userEvent.setup();
    render(<PantallaProcesos sucursal={null} pestanaInicial="merma" />);
    await u.click(screen.getByRole("tab", { name: "Consumos" }));
    await agregar(u, "Productos", "jam", "Jamaica 500 ml", "2");
    await u.click(screen.getByRole("tab", { name: "Descuentos" }));
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    // Mientras la ventana se cierra el resto de la pantalla sigue inerte: se espera a que vuelva.
    expect(await screen.findByRole("tab", { name: "Consumos" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox", { name: "Piezas de Jamaica 500 ml en Productos" })).toHaveValue("2");

    await u.click(screen.getByRole("tab", { name: "Descuentos" }));
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Descartar" }));
    expect(await screen.findByRole("tab", { name: "Descuentos" })).toHaveAttribute("aria-selected", "true");
    await u.click(screen.getByRole("tab", { name: "Consumos" }));
    expect(await screen.findByRole("button", { name: "Agregar producto a Productos" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Piezas de/ })).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("Descuentos: sin Oficina; al elegir vendedor precarga los faltantes del corte", async () => {
    mockAuth(["proceso.descuento"]);
    const u = userEvent.setup();
    vi.mocked(procesosLib.precargaDescuentos).mockResolvedValue({
      corteHecho: true,
      lineas: [{ presentacionId: "p1", nombre: "Horchata 1 L", piezas: 3 }],
    });
    vi.mocked(procesosLib.crearProceso).mockResolvedValue(proceso({ tipo: "descuento" }));
    render(<PantallaProcesos sucursal={null} pestanaInicial="descuento" />);
    const vendedor = await screen.findByLabelText("Vendedor");
    expect(within(vendedor).queryByRole("option", { name: "Oficina" })).toBeNull();
    expect(screen.getByRole("button", { name: "Guardar descuento" })).toBeDisabled();
    await u.selectOptions(vendedor, "Pedro");
    await waitFor(() => expect(procesosLib.precargaDescuentos).toHaveBeenCalledWith("v2", HOY));
    const campo = await screen.findByRole("textbox", { name: "Piezas de Horchata 1 L en Productos" });
    expect(campo).toHaveValue("3");
    await u.clear(campo);
    await u.type(campo, "2");
    await u.click(screen.getByRole("button", { name: "Guardar descuento" }));
    expect(procesosLib.crearProceso).toHaveBeenCalledWith({
      tipo: "descuento",
      sucursal: "TJ",
      fecha: HOY,
      clienteId: null,
      vendedorId: "v2",
      mermaDe: null,
      comentario: null,
      lineas: [{ presentacionId: "p1", sentido: "entregado", piezas: 2 }],
    });
  });

  it("Descuentos sin corte hecho avisa y no precarga nada", async () => {
    mockAuth(["proceso.descuento"]);
    const u = userEvent.setup();
    vi.mocked(procesosLib.precargaDescuentos).mockResolvedValue({ corteHecho: false, lineas: [] });
    render(<PantallaProcesos sucursal={null} pestanaInicial="descuento" />);
    await u.selectOptions(await screen.findByLabelText("Vendedor"), "Pedro");
    expect(await screen.findByText("Ese día no tiene corte hecho: no hay faltantes que precargar.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Piezas de/ })).toBeNull();
  });

  it("Merma: pasar a Almacén descarta lo de Le entregué, preguntando antes", async () => {
    mockAuth(TODOS);
    const u = userEvent.setup();
    render(<PantallaProcesos sucursal={null} pestanaInicial="merma" />);
    await elegirCliente(u, "maris", /Mariscos Bucanero/);
    await agregar(u, "Recibí dañado", "horch", "Horchata 500 ml", "5");
    await agregar(u, "Le entregué", "jam", "Jamaica 500 ml", "5");

    await u.click(screen.getByRole("radio", { name: "De almacén" }));
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("radio", { name: "De este cliente" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Piezas de Jamaica 500 ml en Le entregué" })).toHaveValue("5");

    await u.click(screen.getByRole("radio", { name: "De almacén" }));
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Descartar" }));
    expect(await screen.findByRole("radio", { name: "De almacén" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Piezas de Horchata 500 ml en Productos dañados" })).toHaveValue("5");
    await u.click(screen.getByRole("radio", { name: "De este cliente" }));
    expect(screen.queryByRole("textbox", { name: /en Le entregué/ })).toBeNull();
  });

  it("Merma: pasar a Almacén sin nada en Le entregué no pregunta", async () => {
    mockAuth(TODOS);
    const u = userEvent.setup();
    render(<PantallaProcesos sucursal={null} pestanaInicial="merma" />);
    await elegirCliente(u, "maris", /Mariscos Bucanero/);
    await agregar(u, "Recibí dañado", "horch", "Horchata 500 ml", "5");
    await u.click(screen.getByRole("radio", { name: "De almacén" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("radio", { name: "De almacén" })).toBeChecked();
  });

  it("Descuentos: picar Hoy cuando ya es hoy no vuelve a precargar ni borra lo corregido", async () => {
    mockAuth(["proceso.descuento"]);
    const u = userEvent.setup();
    vi.mocked(procesosLib.precargaDescuentos).mockResolvedValue({
      corteHecho: true,
      lineas: [{ presentacionId: "p1", nombre: "Horchata 1 L", piezas: 3 }],
    });
    render(<PantallaProcesos sucursal={null} pestanaInicial="descuento" />);
    await u.selectOptions(await screen.findByLabelText("Vendedor"), "Pedro");
    const campo = await screen.findByRole("textbox", { name: "Piezas de Horchata 1 L en Productos" });
    await u.clear(campo);
    await u.type(campo, "2");
    await u.click(screen.getByRole("button", { name: "Hoy" }));
    expect(screen.getByLabelText("Día")).toHaveValue(HOY);
    expect(procesosLib.precargaDescuentos).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "Piezas de Horchata 1 L en Productos" })).toHaveValue("2");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("el día como en las demás pantallas: campo Día con Hoy · Ayer y el día escrito; filtra la lista y es el de la captura", async () => {
    mockAuth(["proceso.consumo"]);
    const u = userEvent.setup();
    const AYER = diaAnterior(HOY);
    vi.mocked(procesosLib.crearProceso).mockResolvedValue(proceso({ tipo: "consumo" }));
    render(<PantallaProcesos sucursal={null} pestanaInicial="consumo" />);
    const dia = await screen.findByLabelText("Día");
    expect(dia).toHaveAttribute("type", "date");
    expect(dia).toHaveAttribute("max", HOY);
    expect(screen.queryByRole("radio", { name: "Otro día" })).toBeNull();
    expect(screen.getByText(`Hoy, ${formatearDiaLargo(HOY)}`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Consumos de hoy" })).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: "Ayer" }));
    expect(dia).toHaveValue(AYER);
    expect(screen.getByText(`Ayer, ${formatearDiaLargo(AYER)}`)).toBeInTheDocument();
    await waitFor(() => expect(procesosLib.listarProcesos).toHaveBeenLastCalledWith({ tipo: "consumo", fecha: AYER, sucursal: "TJ" }));
    expect(screen.getByRole("heading", { name: `Consumos del ${formatearDiaLargo(AYER)}` })).toBeInTheDocument();

    const antier = diaAnterior(AYER);
    fireEvent.change(dia, { target: { value: antier } });
    expect(await screen.findByText(formatearDiaLargo(antier))).toBeInTheDocument();
    await agregar(u, "Productos", "jam", "Jamaica 500 ml", "2");
    await u.click(screen.getByRole("button", { name: "Guardar consumo" }));
    expect(procesosLib.crearProceso).toHaveBeenCalledWith(expect.objectContaining({ fecha: antier }));
    // Guardar conserva el día elegido.
    await waitFor(() => expect(screen.getByLabelText("Día")).toHaveValue(antier));
  });

  it("Descuentos: cambiar de vendedor con algo corregido pregunta antes de reemplazarlo", async () => {
    mockAuth(["proceso.descuento"]);
    const u = userEvent.setup();
    vi.mocked(procesosLib.precargaDescuentos).mockImplementation(async (vendedor) => ({
      corteHecho: true,
      lineas: [{ presentacionId: vendedor === "v2" ? "p1" : "p3", nombre: vendedor === "v2" ? "Horchata 1 L" : "Jamaica 500 ml", piezas: 3 }],
    }));
    render(<PantallaProcesos sucursal={null} pestanaInicial="descuento" />);
    const vendedor = await screen.findByLabelText("Vendedor");
    await u.selectOptions(vendedor, "Pedro");
    const campo = await screen.findByRole("textbox", { name: "Piezas de Horchata 1 L en Productos" });
    await u.clear(campo);
    await u.type(campo, "2");

    await u.selectOptions(vendedor, "Ricardo");
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByLabelText("Vendedor")).toHaveValue("v2");
    expect(screen.getByRole("textbox", { name: "Piezas de Horchata 1 L en Productos" })).toHaveValue("2");
    expect(procesosLib.precargaDescuentos).toHaveBeenCalledTimes(1);

    await u.selectOptions(screen.getByLabelText("Vendedor"), "Ricardo");
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Descartar" }));
    expect(await screen.findByRole("textbox", { name: "Piezas de Jamaica 500 ml en Productos" })).toHaveValue("3");
    expect(screen.queryByRole("textbox", { name: "Piezas de Horchata 1 L en Productos" })).toBeNull();
    expect(screen.getByLabelText("Vendedor")).toHaveValue("v1");
  });

  it("Descuentos: sin corregir nada, cambiar de vendedor no pregunta; volver a Elige un vendedor vacía la caja", async () => {
    mockAuth(["proceso.descuento"]);
    const u = userEvent.setup();
    vi.mocked(procesosLib.precargaDescuentos).mockResolvedValue({
      corteHecho: true,
      lineas: [{ presentacionId: "p1", nombre: "Horchata 1 L", piezas: 3 }],
    });
    render(<PantallaProcesos sucursal={null} pestanaInicial="descuento" />);
    const vendedor = await screen.findByLabelText("Vendedor");
    await u.selectOptions(vendedor, "Pedro");
    await screen.findByRole("textbox", { name: "Piezas de Horchata 1 L en Productos" });
    await u.selectOptions(vendedor, "Ricardo");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(procesosLib.precargaDescuentos).toHaveBeenLastCalledWith("v1", HOY));

    await u.selectOptions(screen.getByLabelText("Vendedor"), "");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: /Piezas de/ })).toBeNull());
    expect(screen.getByRole("button", { name: "Guardar descuento" })).toBeDisabled();
  });

  it("Descuentos: el aviso rojo de una precarga fallida se limpia cuando la siguiente sale bien", async () => {
    mockAuth(["proceso.descuento"]);
    const u = userEvent.setup();
    vi.mocked(procesosLib.precargaDescuentos)
      .mockRejectedValueOnce(new ErrorApi("x", 404, "No existe ese vendedor."))
      .mockResolvedValue({ corteHecho: true, lineas: [{ presentacionId: "p1", nombre: "Horchata 1 L", piezas: 3 }] });
    render(<PantallaProcesos sucursal={null} pestanaInicial="descuento" />);
    const vendedor = await screen.findByLabelText("Vendedor");
    await u.selectOptions(vendedor, "Pedro");
    expect(await screen.findByRole("alert")).toHaveTextContent("No existe ese vendedor.");
    await u.selectOptions(vendedor, "Ricardo");
    await screen.findByRole("textbox", { name: "Piezas de Horchata 1 L en Productos" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Descuentos (I-1): si la precarga del vendedor nuevo falla, la caja queda vacía y no se puede guardar", async () => {
    mockAuth(["proceso.descuento"]);
    const u = userEvent.setup();
    vi.mocked(procesosLib.precargaDescuentos)
      .mockResolvedValueOnce({ corteHecho: true, lineas: [{ presentacionId: "p1", nombre: "Horchata 1 L", piezas: 3 }] })
      .mockRejectedValueOnce(new ErrorApi("x", 404, "No existe ese vendedor."));
    render(<PantallaProcesos sucursal={null} pestanaInicial="descuento" />);
    const vendedor = await screen.findByLabelText("Vendedor");
    await u.selectOptions(vendedor, "Pedro");
    await screen.findByRole("textbox", { name: "Piezas de Horchata 1 L en Productos" });
    expect(screen.getByRole("button", { name: "Guardar descuento" })).toBeEnabled();
    await u.selectOptions(vendedor, "Ricardo");
    expect(await screen.findByRole("alert")).toHaveTextContent("No existe ese vendedor.");
    expect(screen.queryByRole("textbox", { name: /Piezas de/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Guardar descuento" })).toBeDisabled();
  });

  it("Descuentos (I-1): mientras la precarga va en camino no se puede guardar ni tocar la caja", async () => {
    mockAuth(["proceso.descuento"]);
    const u = userEvent.setup();
    let responder: (v: Awaited<ReturnType<typeof procesosLib.precargaDescuentos>>) => void = () => {};
    vi.mocked(procesosLib.precargaDescuentos)
      .mockResolvedValueOnce({ corteHecho: true, lineas: [{ presentacionId: "p1", nombre: "Horchata 1 L", piezas: 3 }] })
      .mockImplementationOnce(() => new Promise((r) => (responder = r)));
    render(<PantallaProcesos sucursal={null} pestanaInicial="descuento" />);
    const vendedor = await screen.findByLabelText("Vendedor");
    await u.selectOptions(vendedor, "Pedro");
    await screen.findByRole("textbox", { name: "Piezas de Horchata 1 L en Productos" });
    await u.selectOptions(vendedor, "Ricardo");
    await waitFor(() => expect(procesosLib.precargaDescuentos).toHaveBeenLastCalledWith("v1", HOY));
    expect(screen.queryByRole("textbox", { name: /Piezas de/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Guardar descuento" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Agregar producto a Productos" })).toBeDisabled();
    responder({ corteHecho: true, lineas: [{ presentacionId: "p3", nombre: "Jamaica 500 ml", piezas: 2 }] });
    expect(await screen.findByRole("textbox", { name: "Piezas de Jamaica 500 ml en Productos" })).toHaveValue("2");
    expect(screen.getByRole("button", { name: "Guardar descuento" })).toBeEnabled();
  });

  it("Descuentos (I-1): una precarga que llega tarde, de un vendedor que ya no está elegido, se ignora", async () => {
    mockAuth(["proceso.descuento"]);
    const u = userEvent.setup();
    type Precarga = Awaited<ReturnType<typeof procesosLib.precargaDescuentos>>;
    const pendientes: Record<string, (v: Precarga) => void> = {};
    vi.mocked(procesosLib.precargaDescuentos).mockImplementation((v) => new Promise<Precarga>((r) => (pendientes[v] = r)));
    render(<PantallaProcesos sucursal={null} pestanaInicial="descuento" />);
    const vendedor = await screen.findByLabelText("Vendedor");
    await u.selectOptions(vendedor, "Pedro");
    await u.selectOptions(vendedor, "Ricardo");
    await waitFor(() => expect(pendientes.v1).toBeDefined());
    pendientes.v1({ corteHecho: true, lineas: [{ presentacionId: "p3", nombre: "Jamaica 500 ml", piezas: 2 }] });
    await screen.findByRole("textbox", { name: "Piezas de Jamaica 500 ml en Productos" });
    pendientes.v2({ corteHecho: true, lineas: [{ presentacionId: "p1", nombre: "Horchata 1 L", piezas: 3 }] });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("textbox", { name: "Piezas de Horchata 1 L en Productos" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Piezas de Jamaica 500 ml en Productos" })).toHaveValue("2");
    expect(screen.getByLabelText("Vendedor")).toHaveValue("v1");
  });

  it("Descuentos (m-2): si en la lista del día ya hay un descuento del vendedor elegido, avisa sin bloquear", async () => {
    mockAuth(["proceso.descuento"]);
    const u = userEvent.setup();
    vi.mocked(procesosLib.listarProcesos).mockResolvedValue(
      delDia([proceso({ tipo: "descuento", mermaDe: null, cliente: null, vendedor: { id: "v2", nombre: "Pedro" }, lineas: [{ presentacionId: "p1", nombre: "Horchata 1 L", sentido: "entregado", piezas: 3 }] })]),
    );
    vi.mocked(procesosLib.precargaDescuentos).mockResolvedValue({ corteHecho: true, lineas: [{ presentacionId: "p1", nombre: "Horchata 1 L", piezas: 3 }] });
    render(<PantallaProcesos sucursal={null} pestanaInicial="descuento" />);
    const vendedor = await screen.findByLabelText("Vendedor");
    await screen.findByRole("table", { name: "Descuentos del día" });
    expect(screen.queryByText(/Ya hay un descuento de/)).toBeNull();
    await u.selectOptions(vendedor, "Ricardo");
    await screen.findByRole("textbox", { name: "Piezas de Horchata 1 L en Productos" });
    expect(screen.queryByText(/Ya hay un descuento de/)).toBeNull();
    await u.selectOptions(vendedor, "Pedro");
    expect(await screen.findByText("Ya hay un descuento de Pedro para ese día.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar descuento" })).toBeEnabled());
  });
});

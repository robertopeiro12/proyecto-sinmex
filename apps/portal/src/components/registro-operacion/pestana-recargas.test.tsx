import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as cargasLib from "@/lib/cargas";
import type { CargaRejilla, Rejilla } from "@/lib/cargas";
import * as motivosLib from "@/lib/motivos-merma";
import * as ops from "@/lib/operaciones-almacen";
import * as productosLib from "@/lib/productos";
import * as sucursalesLib from "@/lib/sucursales";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaRegistroOperacion } from "./pantalla-registro-operacion";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/operaciones-almacen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/operaciones-almacen")>()),
  listarOperaciones: vi.fn(),
}));
vi.mock("@/lib/productos", () => ({ listarProductos: vi.fn() }));
vi.mock("@/lib/motivos-merma", () => ({ listarMotivosMerma: vi.fn() }));
vi.mock("@/lib/sucursales", () => ({ listarSucursales: vi.fn() }));
vi.mock("@/lib/cargas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cargas")>()),
  obtenerRejilla: vi.fn(),
  crearCarga: vi.fn(),
  editarCarga: vi.fn(),
  eliminarCarga: vi.fn(),
}));

const HOY = hoyEnTijuana();
const TODOS = ["operacion.entrada", "carga.gestionar", "operacion.envio", "operacion.merma", "operacion.consumo", "operacion.descuento"];

function mockAuth(permisos: string[], conSucursal = true) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: {
      id: "u1",
      login: "ana",
      nombre: "Ana",
      perfil: "x",
      sucursal: conSucursal ? { id: "s-TJ", codigo: "TJ", nombre: "TJ" } : null,
      permisos,
    },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (c: string) => permisos.includes(c),
  });
}

const carga = (id: string, numero: number, estado: CargaRejilla["estado"], m: Partial<CargaRejilla> = {}): CargaRejilla => ({
  id,
  numero,
  estado,
  motivoRechazo: null,
  version: 3,
  respondidaEn: null,
  lineas: [{ presentacionId: "p1", piezas: 50 }],
  ...m,
});

const rejilla = (): Rejilla => ({
  fecha: HOY,
  sucursal: { id: "s-TJ", codigo: "TJ", nombre: "Tijuana" },
  presentaciones: [
    { id: "p1", productoNombre: "Horchata", volumen: "500 ml", activa: true },
    { id: "p3", productoNombre: "Horchata", volumen: "1 L", activa: true },
    { id: "p2", productoNombre: "Jamaica", volumen: "500 ml", activa: true },
    { id: "p0", productoNombre: "Horchata", volumen: "355 ml", activa: true },
    { id: "p5", productoNombre: "Agua de limón", volumen: "500 ml", activa: true },
  ],
  vendedores: [
    { id: "v1", nombre: "Ricardo", cargas: [carga("c1", 1, "aceptada"), carga("c2", 2, "pendiente")] },
    { id: "v2", nombre: "Juan Pérez", cargas: [carga("c3", 1, "rechazada", { motivoRechazo: "Faltó hielo" })] },
    { id: "v3", nombre: "Pedro Ruiz", cargas: [] },
  ],
});

const nueva = (producto: string, vendedor: string) => screen.getByLabelText(`Piezas nuevas de ${producto} para ${vendedor}`);

async function abrir(pestana: string | null = "recarga", permisos = TODOS) {
  mockAuth(permisos);
  render(<PantallaRegistroOperacion sucursal={null} pestana={pestana} />);
}

async function abrirRejilla() {
  await abrir();
  await screen.findByRole("table", { name: "Recargas de hoy" });
}

describe("Pestaña Recargas del Registro de Operación", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ops.listarOperaciones).mockResolvedValue({ fecha: HOY, hoy: HOY, operaciones: [] });
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue([
      { id: "s-TJ", codigo: "TJ", nombre: "Tijuana", activa: true, controlInventario: false, consumoDiarioMax: 1 },
    ]);
    vi.mocked(cargasLib.obtenerRejilla).mockImplementation(async () => rejilla());
    vi.mocked(productosLib.listarProductos).mockResolvedValue([]);
    vi.mocked(motivosLib.listarMotivosMerma).mockResolvedValue([]);
  });

  it("sale solo con carga.gestionar y en el orden del cliente", async () => {
    await abrir(null);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Entradas/Compras", "Recargas", "Envíos", "Merma", "Consumo", "Descuentos"]);
  });

  it("sin el permiso no hay pestaña", async () => {
    await abrir(null, ["operacion.entrada"]);
    expect(screen.queryByRole("tab", { name: "Recargas" })).toBeNull();
  });

  it("sin ningún permiso: pantalla sin permiso", async () => {
    await abrir("recarga", []);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(cargasLib.obtenerRejilla).not.toHaveBeenCalled();
  });

  it("con todas las sucursales pide elegir una", async () => {
    mockAuth(["carga.gestionar"], false);
    render(<PantallaRegistroOperacion sucursal="todas" pestana="recarga" />);
    expect(screen.getByText(/Elige una sucursal/)).toBeInTheDocument();
    expect(cargasLib.obtenerRejilla).not.toHaveBeenCalled();
  });

  it("pide la rejilla de hoy y de la sucursal del menú, sin fecha ni selector", async () => {
    await abrirRejilla();
    expect(cargasLib.obtenerRejilla).toHaveBeenCalledWith(HOY, "s-TJ");
    expect(document.querySelector("input[type=date]")).toBeNull();
    expect(screen.queryByLabelText(/sucursal/i)).toBeNull();
    expect(screen.getByText(/Inventario por vendedor → Recargas/)).toBeInTheDocument();
  });

  it("renglones por tamaño y, dentro, por nombre de producto", async () => {
    await abrirRejilla();
    const orden = screen.getAllByLabelText(/^Piezas nuevas de .* para Ricardo$/).map((c) => c.getAttribute("aria-label"));
    expect(orden).toEqual([
      "Piezas nuevas de Horchata 355 ml para Ricardo",
      "Piezas nuevas de Agua de limón 500 ml para Ricardo",
      "Piezas nuevas de Horchata 500 ml para Ricardo",
      "Piezas nuevas de Jamaica 500 ml para Ricardo",
      "Piezas nuevas de Horchata 1 L para Ricardo",
    ]);
    const grupos = screen.getAllByRole("rowheader").filter((th) => th.getAttribute("scope") === "rowgroup");
    expect(grupos.map((g) => g.textContent)).toEqual(["355 ml", "500 ml", "1 L"]);
  });

  it("una columna por vendedor con sus cargas de hoy, su estado y el motivo del rechazo", async () => {
    await abrirRejilla();
    for (const nombre of ["Ricardo", "Juan Pérez", "Pedro Ruiz"]) {
      expect(screen.getByRole("columnheader", { name: nombre })).toBeInTheDocument();
    }
    const subencabezados = screen.getAllByRole("columnheader").map((th) => th.textContent ?? "");
    expect(subencabezados.filter((t) => /^n\.º 1Aceptada/.test(t))).toHaveLength(1);
    expect(subencabezados.filter((t) => /^n\.º 2Pendiente/.test(t))).toHaveLength(1);
    expect(subencabezados.filter((t) => /^n\.º 1Rechazada.*Faltó hielo/.test(t))).toHaveLength(1);
    expect(subencabezados.filter((t) => t === "Nueva")).toHaveLength(3);
    // Las 50 piezas de Horchata 500 ml de cada carga, en solo lectura.
    expect(within(document.querySelector("tbody")!).getAllByText("50")).toHaveLength(3);
  });

  it("el encabezado de vendedores y la columna de productos quedan fijos", async () => {
    await abrirRejilla();
    const thead = document.querySelector("thead")!;
    expect(thead.className).toMatch(/\bsticky\b/);
    expect(thead.className).toMatch(/\btop-0\b/);
    const filasProducto = [...document.querySelectorAll("tbody tr")].filter((tr) => tr.querySelector("input"));
    expect(filasProducto.length).toBeGreaterThan(0);
    for (const tr of filasProducto) {
      const primera = tr.firstElementChild!;
      expect(primera.className).toMatch(/\bsticky\b/);
      expect(primera.className).toMatch(/\bleft-0\b/);
    }
  });

  it("TAB baja al siguiente producto del mismo vendedor y luego pasa al siguiente vendedor; Shift+TAB regresa", async () => {
    const u = userEvent.setup();
    await abrirRejilla();
    await u.click(nueva("Horchata 355 ml", "Ricardo"));
    await u.tab();
    expect(nueva("Agua de limón 500 ml", "Ricardo")).toHaveFocus();
    await u.click(nueva("Horchata 1 L", "Ricardo"));
    await u.tab();
    expect(nueva("Horchata 355 ml", "Juan Pérez")).toHaveFocus();
    await u.tab({ shift: true });
    expect(nueva("Horchata 1 L", "Ricardo")).toHaveFocus();
  });

  it("en las orillas TAB no se cancela: desde el último campo del último vendedor y Shift+TAB desde el primero sale de la rejilla", async () => {
    await abrirRejilla();
    expect(fireEvent.keyDown(nueva("Horchata 1 L", "Pedro Ruiz"), { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(nueva("Horchata 355 ml", "Ricardo"), { key: "Tab", shiftKey: true })).toBe(true);
    // En medio sí se cancela (lo mueve la rejilla).
    expect(fireEvent.keyDown(nueva("Horchata 355 ml", "Ricardo"), { key: "Tab" })).toBe(false);
  });

  it("Guardar recarga crea una carga por vendedor con piezas, con sus líneas, y avisa", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.crearCarga).mockImplementation(async ({ vendedorId }) =>
      carga(`n-${vendedorId}`, vendedorId === "v1" ? 3 : 2, "pendiente"),
    );
    await abrirRejilla();
    const guardar = screen.getByRole("button", { name: "Guardar recarga" });
    expect(guardar).toBeDisabled();
    await u.type(nueva("Horchata 500 ml", "Juan Pérez"), "20");
    await u.type(nueva("Jamaica 500 ml", "Juan Pérez"), "5");
    await u.type(nueva("Horchata 1 L", "Ricardo"), "7");
    expect(guardar).toBeEnabled();
    await u.click(guardar);
    await waitFor(() => expect(cargasLib.crearCarga).toHaveBeenCalledTimes(2));
    expect(cargasLib.crearCarga).toHaveBeenCalledWith({ vendedorId: "v1", lineas: [{ presentacionId: "p3", piezas: 7 }] });
    expect(cargasLib.crearCarga).toHaveBeenCalledWith({
      vendedorId: "v2",
      lineas: [
        { presentacionId: "p1", piezas: 20 },
        { presentacionId: "p2", piezas: 5 },
      ],
    });
    expect(await screen.findByText("Recargas guardadas: Ricardo n.º 3, Juan Pérez n.º 2.")).toBeInTheDocument();
    await waitFor(() => expect(cargasLib.obtenerRejilla).toHaveBeenCalledTimes(2));
    expect(nueva("Horchata 500 ml", "Juan Pérez")).toHaveValue("");
  });

  it("un valor inválido se marca y deshabilita Guardar recarga", async () => {
    const u = userEvent.setup();
    await abrirRejilla();
    await u.type(nueva("Horchata 500 ml", "Ricardo"), "4a");
    expect(nueva("Horchata 500 ml", "Ricardo")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Guardar recarga" })).toBeDisabled();
  });

  it("si una falla, la guardada se limpia y la fallida se queda con su error en rojo", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.crearCarga).mockImplementation(async ({ vendedorId }) => {
      if (vendedorId === "v2") throw new ErrorApi("Malo", 400, "El vendedor ya no está activo.");
      return carga("n", 3, "pendiente");
    });
    await abrirRejilla();
    await u.type(nueva("Horchata 500 ml", "Ricardo"), "7");
    await u.type(nueva("Horchata 500 ml", "Juan Pérez"), "20");
    await u.click(screen.getByRole("button", { name: "Guardar recarga" }));
    expect(await screen.findByText("Recarga guardada: Ricardo n.º 3.")).toBeInTheDocument();
    const encabezadoJuan = screen.getByRole("columnheader", { name: /Juan Pérez/ });
    expect(within(encabezadoJuan).getByText("El vendedor ya no está activo.")).toHaveClass("text-destructive");
    await waitFor(() => expect(cargasLib.obtenerRejilla).toHaveBeenCalledTimes(2));
    expect(nueva("Horchata 500 ml", "Ricardo")).toHaveValue("");
    expect(nueva("Horchata 500 ml", "Juan Pérez")).toHaveValue("20");
    expect(screen.getByText("El vendedor ya no está activo.")).toBeInTheDocument();
    // Otra vez: solo se intenta la que falló.
    vi.mocked(cargasLib.crearCarga).mockClear();
    vi.mocked(cargasLib.crearCarga).mockResolvedValue(carga("n2", 2, "pendiente"));
    await u.click(screen.getByRole("button", { name: "Guardar recarga" }));
    await waitFor(() => expect(cargasLib.crearCarga).toHaveBeenCalledTimes(1));
    expect(cargasLib.crearCarga).toHaveBeenCalledWith({ vendedorId: "v2", lineas: [{ presentacionId: "p1", piezas: 20 }] });
    expect(await screen.findByText("Recarga guardada: Juan Pérez n.º 2.")).toBeInTheDocument();
  });

  it("el mensaje rojo de un vendedor se quita en cuanto se tocan sus campos", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.crearCarga).mockRejectedValue(new ErrorApi("Malo", 400, "El vendedor ya no está activo."));
    await abrirRejilla();
    await u.type(nueva("Horchata 500 ml", "Juan Pérez"), "20");
    await u.click(screen.getByRole("button", { name: "Guardar recarga" }));
    expect(await within(screen.getByRole("columnheader", { name: /Juan Pérez/ })).findByText("El vendedor ya no está activo.")).toBeInTheDocument();
    await u.type(nueva("Jamaica 500 ml", "Juan Pérez"), "1");
    expect(within(screen.getByRole("columnheader", { name: /Juan Pérez/ })).queryByText("El vendedor ya no está activo.")).toBeNull();
  });

  it("si falla un vendedor que ya no sale en la rejilla, su nombre y mensaje van al aviso y su borrador se limpia", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.crearCarga).mockRejectedValue(new ErrorApi("Malo", 400, "El vendedor ya no está activo."));
    await abrirRejilla();
    vi.mocked(cargasLib.obtenerRejilla).mockImplementation(async () => {
      const r = rejilla();
      r.vendedores = r.vendedores.filter((v) => v.id !== "v2");
      return r;
    });
    await u.type(nueva("Horchata 500 ml", "Juan Pérez"), "20");
    await u.click(screen.getByRole("button", { name: "Guardar recarga" }));
    await waitFor(() => expect(screen.queryByRole("columnheader", { name: /Juan Pérez/ })).toBeNull());
    expect(screen.getByRole("alert")).toHaveTextContent("Juan Pérez: El vendedor ya no está activo.");
    expect(screen.getByRole("button", { name: "Guardar recarga" })).toBeDisabled();
    expect(screen.getByText("Nuevas: 0 piezas")).toBeInTheDocument();
  });

  it("un 0 en Nueva cuenta como vacío: no se marca ni se manda", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.crearCarga).mockResolvedValue(carga("n", 3, "pendiente"));
    await abrirRejilla();
    await u.type(nueva("Horchata 500 ml", "Ricardo"), "0");
    expect(nueva("Horchata 500 ml", "Ricardo")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: "Guardar recarga" })).toBeDisabled();
    await u.type(nueva("Jamaica 500 ml", "Ricardo"), "2");
    await u.click(screen.getByRole("button", { name: "Guardar recarga" }));
    await waitFor(() => expect(cargasLib.crearCarga).toHaveBeenCalledWith({ vendedorId: "v1", lineas: [{ presentacionId: "p2", piezas: 2 }] }));
  });

  it("totales por columna en un pie fijo: cada carga, cada Nueva y la corrección abierta", async () => {
    const u = userEvent.setup();
    await abrirRejilla();
    const pie = document.querySelector("tfoot")!;
    expect(pie.className).toMatch(/\bsticky\b/);
    expect(pie.className).toMatch(/\bbottom-0\b/);
    const totales = () => [...pie.querySelectorAll("td")].map((td) => td.textContent);
    // Ricardo: n.º 1, n.º 2, Nueva · Juan: n.º 1, Nueva · Pedro: Nueva
    expect(totales()).toEqual(["50", "50", "0", "50", "0", "0"]);
    await u.type(nueva("Horchata 500 ml", "Pedro Ruiz"), "7");
    await u.type(nueva("Jamaica 500 ml", "Pedro Ruiz"), "5");
    expect(totales()).toEqual(["50", "50", "0", "50", "0", "12"]);
    await u.click(screen.getByRole("button", { name: "Editar la recarga n.º 2 de Ricardo" }));
    await u.type(screen.getByLabelText("Piezas de Jamaica 500 ml en la recarga n.º 2 de Ricardo"), "4");
    expect(totales()).toEqual(["50", "54", "0", "50", "0", "12"]);
  });

  it("la subcolumna de una carga rechazada lleva fondo rojo tenue", async () => {
    await abrirRejilla();
    expect(document.querySelectorAll("tbody td.bg-destructive-soft\\/40").length).toBe(5);
  });

  it("cambiar de pestaña y volver conserva lo escrito", async () => {
    const u = userEvent.setup();
    await abrirRejilla();
    await u.type(nueva("Horchata 500 ml", "Ricardo"), "7");
    await u.click(screen.getByRole("tab", { name: "Merma" }));
    await u.click(screen.getByRole("tab", { name: "Recargas" }));
    expect(nueva("Horchata 500 ml", "Ricardo")).toHaveValue("7");
  });

  it("con piezas escritas sin guardar, salir de la página avisa", async () => {
    const u = userEvent.setup();
    await abrirRejilla();
    const sinNada = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(sinNada);
    expect(sinNada.defaultPrevented).toBe(false);
    await u.type(nueva("Horchata 500 ml", "Ricardo"), "7");
    const conAlgo = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(conAlgo);
    expect(conAlgo.defaultPrevented).toBe(true);
  });

  it("abrir la captura de otra pestaña con piezas escritas pregunta antes de perderlas", async () => {
    const u = userEvent.setup();
    await abrirRejilla();
    await u.type(nueva("Horchata 500 ml", "Ricardo"), "7");
    await u.click(screen.getByRole("tab", { name: "Merma" }));
    await u.click(await screen.findByRole("button", { name: "Registrar merma" }));
    expect(await screen.findByText("¿Salir sin guardar la recarga?")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByText("¿Salir sin guardar la recarga?")).toBeNull());
    await u.click(screen.getByRole("tab", { name: "Recargas" }));
    expect(nueva("Horchata 500 ml", "Ricardo")).toHaveValue("7");
    await u.click(screen.getByRole("tab", { name: "Merma" }));
    await u.click(screen.getByRole("button", { name: "Registrar merma" }));
    await u.click(await screen.findByRole("button", { name: "Salir sin guardar" }));
    expect(await screen.findByRole("button", { name: /Volver a Merma/ })).toBeInTheDocument();
  });

  it("Descartar pregunta y limpia lo escrito", async () => {
    const u = userEvent.setup();
    await abrirRejilla();
    await u.type(nueva("Horchata 500 ml", "Ricardo"), "7");
    await u.click(screen.getByRole("button", { name: "Descartar" }));
    await u.click(await screen.findByRole("button", { name: "Descartar lo escrito" }));
    await waitFor(() => expect(nueva("Horchata 500 ml", "Ricardo")).toHaveValue(""));
  });

  it("una aceptada no tiene Editar ni Eliminar; pendiente y rechazada sí, con aria-label de cuál", async () => {
    await abrirRejilla();
    expect(screen.queryByRole("button", { name: "Editar la recarga n.º 1 de Ricardo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Eliminar la recarga n.º 1 de Ricardo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Editar la recarga n.º 2 de Ricardo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar la recarga n.º 2 de Ricardo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar la recarga n.º 1 de Juan Pérez" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar la recarga n.º 1 de Juan Pérez" })).toBeInTheDocument();
  });

  it("editar una pendiente convierte su subcolumna en campos y manda la versión; bloquea lo demás", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.editarCarga).mockResolvedValue(carga("c2", 2, "pendiente"));
    await abrirRejilla();
    await u.click(screen.getByRole("button", { name: "Editar la recarga n.º 2 de Ricardo" }));
    const campo = screen.getByLabelText("Piezas de Horchata 500 ml en la recarga n.º 2 de Ricardo");
    expect(campo).toHaveValue("50");
    expect(nueva("Horchata 500 ml", "Ricardo")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Editar la recarga n.º 1 de Juan Pérez" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Guardar recarga" })).toBeDisabled();
    await u.clear(campo);
    await u.type(campo, "60");
    await u.type(screen.getByLabelText("Piezas de Jamaica 500 ml en la recarga n.º 2 de Ricardo"), "4");
    await u.click(screen.getByRole("button", { name: "Guardar la recarga n.º 2 de Ricardo" }));
    expect(cargasLib.editarCarga).toHaveBeenCalledWith("c2", {
      version: 3,
      lineas: [
        { presentacionId: "p1", piezas: 60 },
        { presentacionId: "p2", piezas: 4 },
      ],
    });
    expect(await screen.findByText("Recarga n.º 2 de Ricardo guardada.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Piezas de Horchata 500 ml en la recarga n.º 2 de Ricardo")).toBeNull();
  });

  it("editar una rechazada también manda la versión; Cancelar la deja como estaba", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.editarCarga).mockResolvedValue(carga("c3", 1, "pendiente"));
    await abrirRejilla();
    await u.click(screen.getByRole("button", { name: "Editar la recarga n.º 1 de Juan Pérez" }));
    await u.click(screen.getByRole("button", { name: "Cancelar la edición de la recarga n.º 1 de Juan Pérez" }));
    expect(screen.queryByLabelText(/en la recarga n\.º 1 de Juan Pérez/)).toBeNull();
    await u.click(screen.getByRole("button", { name: "Editar la recarga n.º 1 de Juan Pérez" }));
    await u.click(screen.getByRole("button", { name: "Guardar la recarga n.º 1 de Juan Pérez" }));
    expect(cargasLib.editarCarga).toHaveBeenCalledWith("c3", { version: 3, lineas: [{ presentacionId: "p1", piezas: 50 }] });
  });

  it("al editar una carga con un producto dado de baja avisa que se quita", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.obtenerRejilla).mockImplementation(async () => {
      const r = rejilla();
      r.presentaciones.push({ id: "p4", productoNombre: "Viejo", volumen: "1 L", activa: false });
      r.vendedores[1].cargas[0].lineas = [{ presentacionId: "p1", piezas: 5 }, { presentacionId: "p4", piezas: 9 }];
      return r;
    });
    await abrirRejilla();
    expect(screen.queryByLabelText("Piezas nuevas de Viejo 1 L para Ricardo")).toBeNull();
    await u.click(screen.getByRole("button", { name: "Editar la recarga n.º 1 de Juan Pérez" }));
    expect(screen.getByText("Viejo 1 L ya no se vende; al guardar se quita de la recarga.")).toBeInTheDocument();
  });

  it("un 409 al editar se queda en rojo después de recargar la rejilla", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.editarCarga).mockRejectedValue(new ErrorApi("Conflicto", 409, "Ya la aceptó el vendedor."));
    await abrirRejilla();
    await u.click(screen.getByRole("button", { name: "Editar la recarga n.º 2 de Ricardo" }));
    await u.click(screen.getByRole("button", { name: "Guardar la recarga n.º 2 de Ricardo" }));
    await waitFor(() => expect(cargasLib.obtenerRejilla).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByLabelText(/en la recarga n\.º 2 de Ricardo/)).toBeNull());
    expect(screen.getByRole("alert")).toHaveTextContent("Ya la aceptó el vendedor.");
  });

  it("eliminar confirma con la ventana del portal y manda la versión", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.eliminarCarga).mockResolvedValue({ id: "c3" });
    const confirmar = vi.spyOn(window, "confirm");
    await abrirRejilla();
    await u.click(screen.getByRole("button", { name: "Eliminar la recarga n.º 1 de Juan Pérez" }));
    expect(await screen.findByText("¿Eliminar la recarga n.º 1 de Juan Pérez?")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Eliminar recarga" }));
    await waitFor(() => expect(cargasLib.eliminarCarga).toHaveBeenCalledWith("c3", 3));
    expect(confirmar).not.toHaveBeenCalled();
    expect(await screen.findByText("Recarga n.º 1 de Juan Pérez eliminada.")).toBeInTheDocument();
    await waitFor(() => expect(cargasLib.obtenerRejilla).toHaveBeenCalledTimes(2));
  });

  it("el 409 al eliminar se queda a la vista en rojo después de recargar", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.eliminarCarga).mockRejectedValue(new ErrorApi("Conflicto", 409, "Ya la aceptó el vendedor."));
    await abrirRejilla();
    await u.click(screen.getByRole("button", { name: "Eliminar la recarga n.º 1 de Juan Pérez" }));
    await u.click(await screen.findByRole("button", { name: "Eliminar recarga" }));
    await waitFor(() => expect(cargasLib.obtenerRejilla).toHaveBeenCalledTimes(2));
    await screen.findByRole("table", { name: "Recargas de hoy" });
    expect(screen.getByRole("alert")).toHaveTextContent("Ya la aceptó el vendedor.");
  });

  it("sin vendedores: mensaje y sin rejilla", async () => {
    vi.mocked(cargasLib.obtenerRejilla).mockImplementation(async () => ({ ...rejilla(), vendedores: [] }));
    await abrir();
    expect(await screen.findByText("Esta sucursal no tiene vendedores activos.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Recargas de hoy" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Guardar recarga" })).toBeNull();
  });

  it("una respuesta tardía no pisa a la más reciente", async () => {
    const u = userEvent.setup();
    let soltarVieja: (r: Rejilla) => void = () => {};
    vi.mocked(cargasLib.obtenerRejilla)
      .mockImplementationOnce(async () => rejilla())
      .mockImplementationOnce(() => new Promise<Rejilla>((ok) => (soltarVieja = ok)))
      .mockImplementation(async () => ({ ...rejilla(), vendedores: [{ id: "v9", nombre: "Nuevo", cargas: [] }] }));
    vi.mocked(cargasLib.eliminarCarga).mockResolvedValue({ id: "x" });
    await abrirRejilla();
    await u.click(screen.getByRole("button", { name: "Eliminar la recarga n.º 1 de Juan Pérez" }));
    await u.click(await screen.findByRole("button", { name: "Eliminar recarga" }));
    await waitFor(() => expect(cargasLib.obtenerRejilla).toHaveBeenCalledTimes(2));
    await u.click(await screen.findByRole("button", { name: "Eliminar la recarga n.º 2 de Ricardo" }));
    await u.click(await screen.findByRole("button", { name: "Eliminar recarga" }));
    expect(await screen.findByRole("columnheader", { name: "Nuevo" })).toBeInTheDocument();
    soltarVieja(rejilla());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("columnheader", { name: "Ricardo" })).toBeNull();
  });
});

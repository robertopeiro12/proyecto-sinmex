import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as cargasLib from "@/lib/cargas";
import type { CargaRejilla, Rejilla } from "@/lib/cargas";
import * as ops from "@/lib/operaciones-almacen";
import * as sucursalesLib from "@/lib/sucursales";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaRegistroOperacion } from "./pantalla-registro-operacion";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/operaciones-almacen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/operaciones-almacen")>()),
  listarOperaciones: vi.fn(),
}));
vi.mock("@/lib/productos", () => ({ listarProductos: vi.fn() }));
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

function mockAuth(permisos: string[]) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: { id: "u1", login: "ana", nombre: "Ana", perfil: "x", sucursal: { id: "s-TJ", codigo: "TJ", nombre: "TJ" }, permisos },
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
    { id: "p0", productoNombre: "Horchata", volumen: "355 ml", activa: true },
    { id: "p1", productoNombre: "Horchata", volumen: "500 ml", activa: true },
    { id: "p2", productoNombre: "Jamaica", volumen: "500 ml", activa: true },
    { id: "p3", productoNombre: "Horchata", volumen: "1 L", activa: true },
    { id: "p4", productoNombre: "Viejo", volumen: "1 L", activa: false },
  ],
  vendedores: [
    { id: "v1", nombre: "Ricardo", cargas: [carga("c1", 1, "aceptada"), carga("c2", 2, "pendiente")] },
    { id: "v2", nombre: "Juan Pérez", cargas: [carga("c3", 1, "rechazada", { motivoRechazo: "Faltó hielo" })] },
    { id: "v3", nombre: "Pedro Ruiz", cargas: [] },
  ],
});

async function abrir(pestana: string | null = "recarga", permisos = TODOS) {
  mockAuth(permisos);
  render(<PantallaRegistroOperacion sucursal={null} pestana={pestana} />);
}

describe("Pestaña Recargas del Registro de Operación", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ops.listarOperaciones).mockResolvedValue({ fecha: HOY, hoy: HOY, operaciones: [] });
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue([
      { id: "s-TJ", codigo: "TJ", nombre: "Tijuana", activa: true, controlInventario: false, consumoDiarioMax: 1 },
    ]);
    vi.mocked(cargasLib.obtenerRejilla).mockImplementation(async () => rejilla());
  });

  it("sale solo con carga.gestionar y en el orden del cliente", async () => {
    await abrir(null);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Entradas/Compras", "Recargas", "Envíos", "Merma", "Consumo", "Descuentos"]);
  });

  it("sin el permiso no hay pestaña", async () => {
    await abrir(null, ["operacion.entrada"]);
    expect(screen.queryByRole("tab", { name: "Recargas" })).toBeNull();
  });

  it("la lista pide la rejilla de hoy y de la sucursal del menú, sin fecha ni selector", async () => {
    await abrir();
    await screen.findByText("Juan Pérez");
    expect(cargasLib.obtenerRejilla).toHaveBeenCalledWith(HOY, "s-TJ");
    expect(document.querySelector("input[type=date]")).toBeNull();
    expect(screen.queryByLabelText(/sucursal/i)).toBeNull();
    expect(screen.getByText(/Inventario por vendedor → Recargas/)).toBeInTheDocument();
  });

  it("filas con estado, productos y motivo del rechazo; Editar/Eliminar solo si no está aceptada", async () => {
    await abrir();
    const aceptada = within(await screen.findByRole("row", { name: /Ricardo.*Aceptada/ }));
    expect(aceptada.queryByRole("button", { name: /^Editar/ })).toBeNull();
    expect(aceptada.getByText("Horchata 500 ml × 50")).toBeInTheDocument();
    const pendiente = within(screen.getByRole("row", { name: /Ricardo.*Pendiente/ }));
    expect(pendiente.getByRole("button", { name: /^Editar/ })).toBeInTheDocument();
    const rechazada = within(screen.getByRole("row", { name: /Juan Pérez/ }));
    expect(rechazada.getByText("Rechazada")).toBeInTheDocument();
    expect(rechazada.getByText("Faltó hielo")).toBeInTheDocument();
    expect(rechazada.getByRole("button", { name: /^Eliminar/ })).toBeInTheDocument();
  });

  it("Registrar abre la captura con vendedor y todos los productos activos por tamaño; TAB pasa al siguiente", async () => {
    const u = userEvent.setup();
    await abrir();
    await u.click(await screen.findByRole("button", { name: "Registrar recarga" }));
    expect(screen.getByRole("button", { name: /Volver a Recargas/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Vendedor")).toBeEnabled();
    expect(screen.getByText("500 ml")).toBeInTheDocument();
    expect(screen.getByText("1 L")).toBeInTheDocument();
    expect(screen.queryByLabelText("Piezas de Viejo 1 L")).toBeNull();
    const primero = screen.getByLabelText("Piezas de Horchata 500 ml");
    await u.click(primero);
    await u.tab();
    expect(screen.getByLabelText("Piezas de Jamaica 500 ml")).toHaveFocus();
  });

  it("guardar sin vendedor o sin piezas está deshabilitado; crea con las líneas no vacías", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.crearCarga).mockResolvedValue(carga("n", 3, "pendiente"));
    await abrir();
    await u.click(await screen.findByRole("button", { name: "Registrar recarga" }));
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    await u.type(screen.getByLabelText("Piezas de Horchata 500 ml"), "20");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    await u.selectOptions(screen.getByLabelText("Vendedor"), "v3");
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    expect(cargasLib.crearCarga).toHaveBeenCalledWith({ vendedorId: "v3", lineas: [{ presentacionId: "p1", piezas: 20 }] });
    expect(await screen.findByRole("button", { name: "Registrar recarga" })).toBeInTheDocument();
  });

  it("editar manda la versión y deja fijo al vendedor", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.editarCarga).mockResolvedValue(carga("c2", 2, "pendiente"));
    await abrir();
    await u.click(within(await screen.findByRole("row", { name: /Ricardo.*Pendiente/ })).getByRole("button", { name: /^Editar/ }));
    expect(screen.getByLabelText("Vendedor")).toBeDisabled();
    const campo = screen.getByLabelText("Piezas de Horchata 500 ml");
    expect(campo).toHaveValue("50");
    await u.clear(campo);
    await u.type(campo, "60");
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    expect(cargasLib.editarCarga).toHaveBeenCalledWith("c2", { version: 3, lineas: [{ presentacionId: "p1", piezas: 60 }] });
  });

  it("un 409 muestra el mensaje y vuelve a pedir la lista", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.editarCarga).mockRejectedValue(new ErrorApi("Conflicto", 409, "Ya la aceptó el vendedor."));
    await abrir();
    await u.click(within(await screen.findByRole("row", { name: /Ricardo.*Pendiente/ })).getByRole("button", { name: /^Editar/ }));
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya la aceptó el vendedor.");
    await waitFor(() => expect(cargasLib.obtenerRejilla).toHaveBeenCalledTimes(2));
  });

  it("eliminar confirma con la ventana del portal y llama eliminarCarga", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.eliminarCarga).mockResolvedValue({ id: "c3" });
    const confirmar = vi.spyOn(window, "confirm");
    await abrir();
    await u.click(within(await screen.findByRole("row", { name: /Juan Pérez/ })).getByRole("button", { name: /^Eliminar/ }));
    expect(await screen.findByText("¿Eliminar la recarga n.º 1 de Juan Pérez?")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Eliminar recarga" }));
    await waitFor(() => expect(cargasLib.eliminarCarga).toHaveBeenCalledWith("c3", 3));
    expect(confirmar).not.toHaveBeenCalled();
    expect(await screen.findByText("Recarga n.º 1 de Juan Pérez eliminada.")).toBeInTheDocument();
  });

  it("al eliminar desaparece el aviso de guardado anterior", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.crearCarga).mockResolvedValue(carga("n", 3, "pendiente"));
    vi.mocked(cargasLib.eliminarCarga).mockResolvedValue({ id: "c3" });
    await abrir();
    await u.click(await screen.findByRole("button", { name: "Registrar recarga" }));
    await u.type(screen.getByLabelText("Piezas de Horchata 500 ml"), "20");
    await u.selectOptions(screen.getByLabelText("Vendedor"), "v3");
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText(/Recarga guardada/)).toBeInTheDocument();
    await u.click(within(await screen.findByRole("row", { name: /Juan Pérez/ })).getByRole("button", { name: /^Eliminar/ }));
    await u.click(await screen.findByRole("button", { name: "Eliminar recarga" }));
    expect(await screen.findByText("Recarga n.º 1 de Juan Pérez eliminada.")).toBeInTheDocument();
    expect(screen.queryByText(/Recarga guardada/)).toBeNull();
  });

  it("el 409 al eliminar se queda a la vista en rojo después de recargar la lista", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.eliminarCarga).mockRejectedValue(new ErrorApi("Conflicto", 409, "Ya la aceptó el vendedor."));
    await abrir();
    await u.click(within(await screen.findByRole("row", { name: /Juan Pérez/ })).getByRole("button", { name: /^Eliminar/ }));
    await u.click(await screen.findByRole("button", { name: "Eliminar recarga" }));
    await waitFor(() => expect(cargasLib.obtenerRejilla).toHaveBeenCalledTimes(2));
    await screen.findByText("Juan Pérez");
    expect(screen.getByRole("alert")).toHaveTextContent("Ya la aceptó el vendedor.");
  });

  it("Editar y Eliminar dicen de qué recarga son", async () => {
    await abrir();
    expect(await screen.findByRole("button", { name: "Editar la recarga n.º 2 de Ricardo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar la recarga n.º 1 de Juan Pérez" })).toBeInTheDocument();
  });

  it("sin vendedores: mensaje y botón deshabilitado", async () => {
    vi.mocked(cargasLib.obtenerRejilla).mockImplementation(async () => ({ ...rejilla(), vendedores: [] }));
    await abrir();
    expect(await screen.findByText("Esta sucursal no tiene vendedores activos.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar recarga" })).toBeDisabled();
  });

  it("al editar una carga con un producto dado de baja avisa que se quita", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.obtenerRejilla).mockImplementation(async () => {
      const r = rejilla();
      r.vendedores[1].cargas[0].lineas = [{ presentacionId: "p1", piezas: 5 }, { presentacionId: "p4", piezas: 9 }];
      return r;
    });
    await abrir();
    await u.click(within(await screen.findByRole("row", { name: /Juan Pérez/ })).getByRole("button", { name: /^Editar/ }));
    expect(screen.getByRole("status")).toHaveTextContent("Viejo 1 L ya no se vende; al guardar se quita de la recarga.");
  });

  it("el aviso de guardado no se queda pegado: se va al abrir una captura, al volver y al cambiar de pestaña", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.crearCarga).mockResolvedValue(carga("n", 3, "pendiente"));
    async function guardarUna() {
      await u.click(await screen.findByRole("button", { name: "Registrar recarga" }));
      await u.type(screen.getByLabelText("Piezas de Horchata 500 ml"), "20");
      await u.selectOptions(screen.getByLabelText("Vendedor"), "v3");
      await u.click(screen.getByRole("button", { name: "Guardar" }));
      await screen.findByText(/Recarga guardada/);
    }
    await abrir();
    await guardarUna();
    await u.click(screen.getByRole("button", { name: "Registrar recarga" }));
    await u.click(screen.getByRole("button", { name: /Volver a Recargas/ }));
    await screen.findByRole("button", { name: "Registrar recarga" });
    expect(screen.queryByText(/Recarga guardada/)).toBeNull();
    await guardarUna();
    await u.click(screen.getByRole("tab", { name: "Merma" }));
    await u.click(screen.getByRole("tab", { name: "Recargas" }));
    await screen.findByRole("button", { name: "Registrar recarga" });
    expect(screen.queryByText(/Recarga guardada/)).toBeNull();
  });

  it("mientras guarda dice Guardando… y deshabilita los campos", async () => {
    const u = userEvent.setup();
    vi.mocked(cargasLib.crearCarga).mockReturnValue(new Promise(() => {}));
    await abrir();
    await u.click(await screen.findByRole("button", { name: "Registrar recarga" }));
    await u.type(screen.getByLabelText("Piezas de Horchata 500 ml"), "20");
    await u.selectOptions(screen.getByLabelText("Vendedor"), "v3");
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.getByRole("button", { name: "Guardando…" })).toBeDisabled();
    expect(screen.getByLabelText("Piezas de Horchata 500 ml")).toBeDisabled();
    expect(screen.getByLabelText("Vendedor")).toBeDisabled();
  });

  it("el foco va al primer campo de piezas al elegir vendedor y al abrir una edición", async () => {
    const u = userEvent.setup();
    await abrir();
    await u.click(await screen.findByRole("button", { name: "Registrar recarga" }));
    await u.selectOptions(screen.getByLabelText("Vendedor"), "v3");
    expect(screen.getByLabelText("Piezas de Horchata 355 ml")).toHaveFocus();
  });

  it("al abrir una edición el foco va al primer campo", async () => {
    const u = userEvent.setup();
    await abrir();
    await u.click(within(await screen.findByRole("row", { name: /Ricardo.*Pendiente/ })).getByRole("button", { name: /^Editar/ }));
    expect(document.activeElement).toBe(screen.getAllByRole("textbox")[0]);
  });
});

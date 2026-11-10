import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as semanalesLib from "@/lib/rutas-semanales";
import type { RutaSemanalResumen } from "@/lib/rutas-semanales";
import { PantallaRutaSemanal } from "./pantalla-ruta-semanal";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/rutas-semanales", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rutas-semanales")>();
  return { ...real, listarRutasSemanales: vi.fn(), crearRutaSemanal: vi.fn(), eliminarRutaSemanal: vi.fn() };
});
vi.mock("./editar-ruta-semanal", () => ({
  EditarRutaSemanal: ({ id, onVolver }: { id: string; onVolver: () => void }) => (
    <div>
      <p>Editando {id}</p>
      <button onClick={onVolver}>← Volver a Ruta Semanal</button>
    </div>
  ),
}));

const ruta = (id: string, diaSemana: number, nombre: string, clientes = 3): RutaSemanalResumen => ({
  id,
  diaSemana,
  nombre,
  clientes,
  sucursalCodigo: "TJ",
});

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede });
}

describe("PantallaRutaSemanal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Miércoles 11 de noviembre de 2026, mediodía en Tijuana.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T20:00:00Z"));
    mockAuth(() => true);
    vi.mocked(semanalesLib.listarRutasSemanales).mockResolvedValue([
      ruta("r1", 1, "Zona Centro"),
      ruta("r3", 3, "Playas", 5),
    ]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sin permiso lo dice y no pide nada", () => {
    mockAuth(() => false);
    render(<PantallaRutaSemanal sucursal="TJ" />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(semanalesLib.listarRutasSemanales).not.toHaveBeenCalled();
  });

  it("sin sucursal elegida pide elegirla", () => {
    render(<PantallaRutaSemanal sucursal="todas" />);
    expect(screen.getByText(/Elige una sucursal/)).toBeInTheDocument();
    expect(semanalesLib.listarRutasSemanales).not.toHaveBeenCalled();
  });

  it("las pestañas son Lunes a Sábado y abre en la de hoy", async () => {
    render(<PantallaRutaSemanal sucursal="TJ" />);
    const pestanas = await screen.findAllByRole("tab");
    expect(pestanas.map((p) => p.textContent)).toEqual(["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]);
    expect(screen.getByRole("tab", { name: "Miércoles" })).toHaveAttribute("aria-selected", "true");
    expect(semanalesLib.listarRutasSemanales).toHaveBeenCalledWith("TJ");
  });

  it("la tabla muestra Ruta y Clientes del día y no hay buscador de rutas", async () => {
    render(<PantallaRutaSemanal sucursal="TJ" />);
    const tabla = await screen.findByRole("table");
    expect(within(tabla).getByRole("columnheader", { name: "Ruta" })).toBeInTheDocument();
    expect(within(tabla).getByRole("columnheader", { name: "Clientes" })).toBeInTheDocument();
    expect(within(tabla).getByText("Playas")).toBeInTheDocument();
    expect(within(tabla).queryByText("Zona Centro")).toBeNull();
    expect(screen.queryByText("Buscar ruta")).toBeNull();
  });

  // Va ANTES de cualquier otra prueba que cambie de pestaña: Base UI avisa una sola vez por
  // módulo, así que después ya no se vería.
  it("cambiar de pestaña no le cambia el valor inicial a las pestañas (aviso de Base UI)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const usuario = userEvent.setup();
    render(<PantallaRutaSemanal sucursal="TJ" />);
    await screen.findByText("Playas");
    await usuario.click(screen.getByRole("tab", { name: "Lunes" }));
    await screen.findByText("Zona Centro");
    const mensajes = [...error.mock.calls, ...aviso.mock.calls].map((c) => c.map(String).join(" "));
    expect(mensajes.filter((m) => m.includes("default value"))).toEqual([]);
    expect(screen.getByRole("tab", { name: "Lunes" })).toHaveAttribute("aria-selected", "true");
  });

  it("cambiar de pestaña muestra las rutas de ese día; vacío dice 'Sin rutas'", async () => {
    const usuario = userEvent.setup();
    render(<PantallaRutaSemanal sucursal="TJ" />);
    await screen.findByText("Playas");
    await usuario.click(screen.getByRole("tab", { name: "Lunes" }));
    expect(await screen.findByText("Zona Centro")).toBeInTheDocument();
    await usuario.click(screen.getByRole("tab", { name: "Viernes" }));
    expect(await screen.findByText("Sin rutas este día.")).toBeInTheDocument();
  });

  it("Crear ruta abre una ventana con solo Nombre y, al crear, abre la edición", async () => {
    vi.mocked(semanalesLib.crearRutaSemanal).mockResolvedValue({ ...ruta("nueva", 3, "Otay"), lista: [] });
    const usuario = userEvent.setup();
    render(<PantallaRutaSemanal sucursal="TJ" />);
    await screen.findByText("Playas");
    await usuario.click(screen.getByRole("button", { name: "Crear ruta" }));
    const ventana = await screen.findByRole("dialog");
    expect(within(ventana).getAllByRole("textbox")).toHaveLength(1);
    await usuario.type(within(ventana).getByLabelText("Nombre"), "Otay");
    await usuario.click(within(ventana).getByRole("button", { name: "Crear ruta" }));

    expect(semanalesLib.crearRutaSemanal).toHaveBeenCalledWith({ sucursal: "TJ", diaSemana: 3, nombre: "Otay" });
    expect(await screen.findByText("Editando nueva")).toBeInTheDocument();
  });

  it("un error al crear (nombre repetido) se ve en la ventana", async () => {
    const { ErrorApi } = await import("@/lib/api");
    vi.mocked(semanalesLib.crearRutaSemanal).mockRejectedValue(new ErrorApi("conflicto", 409, "Ya hay una ruta con ese nombre el miércoles."));
    const usuario = userEvent.setup();
    render(<PantallaRutaSemanal sucursal="TJ" />);
    await screen.findByText("Playas");
    await usuario.click(screen.getByRole("button", { name: "Crear ruta" }));
    const ventana = await screen.findByRole("dialog");
    await usuario.type(within(ventana).getByLabelText("Nombre"), "Playas");
    await usuario.click(within(ventana).getByRole("button", { name: "Crear ruta" }));
    expect(await within(ventana).findByText(/Ya hay una ruta con ese nombre/)).toBeInTheDocument();
  });

  it("la tabla trae la columna Acciones con Editar y Eliminar", async () => {
    const usuario = userEvent.setup();
    render(<PantallaRutaSemanal sucursal="TJ" />);
    const tabla = await screen.findByRole("table");
    expect(within(tabla).getByRole("columnheader", { name: "Acciones" })).toBeInTheDocument();
    await usuario.click(within(tabla).getByRole("button", { name: "Editar" }));
    expect(screen.getByText("Editando r3")).toBeInTheDocument();
  });

  it("Eliminar pregunta, elimina y recarga la lista", async () => {
    vi.mocked(semanalesLib.eliminarRutaSemanal).mockResolvedValue(undefined);
    const usuario = userEvent.setup();
    render(<PantallaRutaSemanal sucursal="TJ" />);
    await usuario.click(await screen.findByRole("button", { name: "Eliminar" }));
    expect(await screen.findByText("¿Eliminar la ruta Playas?")).toBeInTheDocument();
    expect(semanalesLib.eliminarRutaSemanal).not.toHaveBeenCalled();
    await usuario.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Eliminar" }));
    expect(semanalesLib.eliminarRutaSemanal).toHaveBeenCalledWith("r3");
    await vi.waitFor(() => expect(semanalesLib.listarRutasSemanales).toHaveBeenCalledTimes(2));
  });

  it("Eliminar se deshabilita mientras se borra", async () => {
    let terminar: () => void = () => {};
    vi.mocked(semanalesLib.eliminarRutaSemanal).mockReturnValue(new Promise<void>((r) => (terminar = r)));
    const usuario = userEvent.setup();
    render(<PantallaRutaSemanal sucursal="TJ" />);
    const boton = await screen.findByRole("button", { name: "Eliminar" });
    await usuario.click(boton);
    await usuario.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Eliminar" }));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Eliminar" })).toBeDisabled());
    terminar();
    await vi.waitFor(() => expect(semanalesLib.listarRutasSemanales).toHaveBeenCalledTimes(2));
  });

  it("Eliminar cancelado no elimina", async () => {
    const usuario = userEvent.setup();
    render(<PantallaRutaSemanal sucursal="TJ" />);
    await usuario.click(await screen.findByRole("button", { name: "Eliminar" }));
    await usuario.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    expect(semanalesLib.eliminarRutaSemanal).not.toHaveBeenCalled();
  });

  it("el 409 de eliminar (ruta en uso) se ve en un aviso", async () => {
    const { ErrorApi } = await import("@/lib/api");
    vi.mocked(semanalesLib.eliminarRutaSemanal).mockRejectedValue(new ErrorApi("conflicto", 409, "La ruta está en uso."));
    const usuario = userEvent.setup();
    render(<PantallaRutaSemanal sucursal="TJ" />);
    await usuario.click(await screen.findByRole("button", { name: "Eliminar" }));
    await usuario.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Eliminar" }));
    expect(await screen.findByText("La ruta está en uso.")).toBeInTheDocument();
  });

  it("picar una ruta abre su edición y al volver recarga la lista", async () => {
    const usuario = userEvent.setup();
    render(<PantallaRutaSemanal sucursal="TJ" />);
    await usuario.click(await screen.findByRole("button", { name: "Playas" }));
    expect(screen.getByText("Editando r3")).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "← Volver a Ruta Semanal" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(semanalesLib.listarRutasSemanales).toHaveBeenCalledTimes(2);
  });
});
